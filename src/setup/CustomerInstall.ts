import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createAdapter, SUPPORTED_AGENTS } from '../adapters/index.js'
import type { AgentPlatform } from '../artifact/types.js'
import { autoDetectGovernancePack, classifyProject, detectPlatform } from '../api/quickstart.js'
import {
  getBootstrapPlanForProfile,
  getProfile,
  listProfiles,
} from '../config/profiles.js'
import type { ScaleLanguage } from '../i18n/Language.js'
import { writeGovernanceTemplates } from '../workflow/GovernanceTemplates.js'
import { verifySetup, type SetupVerificationReport } from './SetupVerification.js'
import { runSetupWizard, type SetupWizardReport } from './SetupWizard.js'
import {
  askCliConfirm,
  askCliSelect,
  createCliPromptSession,
  type CliChoice,
  type CliProgressEvent,
  type CliPromptSession,
} from '../cli/CliUx.js'
import {
  ensureDir,
  governanceModeFromScenario,
  writeConfigYaml,
} from '../cli/engineBootstrap.js'

export interface CustomerInstallOptions {
  projectDir?: string
  scaleDir?: string
  agent?: string
  profile?: string
  governancePack?: string
  dependencyPack?: DependencyPackChoice
  packIds?: string[]
  includeIds?: string[]
  apply?: boolean
  yes?: boolean
  interactive?: boolean
  skipDeps?: boolean
  skipVerify?: boolean
  lang?: ScaleLanguage
  memoryProvider?: string
  memoryMode?: 'auto' | 'local-only' | 'external-first'
  memoryEndpoint?: string
  memoryWriteMode?: 'disabled' | 'candidate-only' | 'enabled'
  allowExternalWrite?: boolean
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  onProgress?: (event: CliProgressEvent) => void
}

export interface CustomerInstallSelection {
  agent: string
  agents: string[]
  profile: string
  governancePack: string
  dependencyPackLabel: string
  dependencyPacks: string[]
  applyDependencies: boolean
  language: ScaleLanguage
}

export interface CustomerInstallInitReport {
  settingsPath: string
  knowledgeDocPath: string
  scaleDir: string
  thresholdsPath: string
  configPath: string
  languagePolicyPath: string
  created: string[]
  skipped: string[]
}

export interface CustomerInstallReport {
  ok: boolean
  lang: ScaleLanguage
  projectDir: string
  selection: CustomerInstallSelection
  init: CustomerInstallInitReport
  setup?: SetupWizardReport
  verification?: SetupVerificationReport
  steps: CliProgressEvent[]
  warnings: string[]
  nextSteps: string[]
}

export type DependencyPackChoice = 'core' | 'recommended' | 'full' | 'ui' | 'memory-knowledge'

const CUSTOMER_AGENT_DEFAULT = 'codex'
const RECOMMENDED_AGENT_GROUP = ['codex', 'claude-code', 'cursor', 'qoder', 'cline', 'windsurf'] as const

export async function runCustomerInstall(options: CustomerInstallOptions = {}): Promise<CustomerInstallReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? join(projectDir, '.scale')
  let lang = options.lang ?? 'zh'
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY)
  const steps: CliProgressEvent[] = []
  const warnings: string[] = []
  const totalSteps = 6
  let stepIndex = 0
  let promptSession: CliPromptSession | undefined

  const emit = (status: CliProgressEvent['status'], label: string, detail?: string) => {
    if (status === 'run' || status === 'skip') stepIndex += 1
    const event = { index: Math.min(stepIndex, totalSteps), total: totalSteps, status, label, detail }
    steps.push(event)
    options.onProgress?.(event)
  }

  try {
    if (interactive) promptSession = createCliPromptSession(options.input, options.output)

    emit('run', lang === 'zh' ? '选择安装语言' : 'Choose install language')
    if (promptSession && !options.lang) {
      lang = await askCliSelect(promptSession, {
        title: 'SCALE install language',
        message: 'Choose the language used by the installer and written into agent instructions.',
        lang: 'en',
        defaultValue: lang,
        choices: [
          { value: 'zh', label: '中文', hint: '安装提示和后续 Agent 对话默认使用中文。' },
          { value: 'en', label: 'English', hint: 'Installer prompts and agent language policy use English.' },
        ],
      })
    }
    emit('ok', lang === 'zh' ? '安装语言已确认' : 'Install language confirmed', lang)

    emit('run', lang === 'zh' ? '检测项目' : 'Detect project')
    const classification = classifyProject(projectDir)
    const detection = detectPlatform(projectDir)
    const detectedAgent = detection.platform ?? undefined
    const defaultAgent = normalizeAgentChoice(options.agent ?? detectedAgent ?? 'recommended')
    const defaultGovernancePack = options.governancePack ?? classification.recommendedPack ?? autoDetectGovernancePack(projectDir)
    const defaultProfile = options.profile ?? classification.recommendedProfile ?? 'standard'
    emit('ok', lang === 'zh' ? '项目检测完成' : 'Project detected', projectSummary(classification, detectedAgent, defaultGovernancePack))

    emit('run', lang === 'zh' ? '选择安装配置' : 'Resolve install choices')
    const agentChoice = promptSession && !options.agent
      ? await askCliSelect(promptSession, {
        title: lang === 'zh' ? '选择 Agent 平台' : 'Agent platform',
        message: lang === 'zh'
          ? '推荐一次安装常用平台；也可以选择 all 一次写入全部已支持平台配置。'
          : 'Recommended installs common adapters; all writes every supported adapter config.',
        lang,
        defaultValue: defaultAgent,
        choices: agentChoices(lang, detectedAgent),
      })
      : defaultAgent
    const agents = resolveAgentSelection(agentChoice, detectedAgent)

    const profile = promptSession && !options.profile
      ? await askCliSelect(promptSession, {
        title: lang === 'zh' ? '选择治理强度' : 'Governance profile',
        message: lang === 'zh'
          ? '首次安装推荐 standard；高级能力可以之后升级。'
          : 'standard is recommended for first install; advanced capabilities can be added later.',
        lang,
        defaultValue: defaultProfile,
        choices: profileChoices(lang),
      })
      : defaultProfile

    const governancePack = promptSession && !options.governancePack
      ? await askCliSelect(promptSession, {
        title: lang === 'zh' ? '选择项目模板' : 'Project template',
        message: lang === 'zh'
          ? '安装器已根据项目结构预选模板。'
          : 'The installer preselects a template from project structure.',
        lang,
        defaultValue: defaultGovernancePack,
        choices: governancePackChoices(lang, defaultGovernancePack),
      })
      : defaultGovernancePack

    const dependencyChoice = promptSession && !options.packIds && !options.dependencyPack && !options.skipDeps
      ? await askCliSelect(promptSession, {
        title: lang === 'zh' ? '选择第三方能力' : 'Third-party capabilities',
        message: lang === 'zh'
          ? '核心工作流不依赖第三方 CLI；可先只安装本体，之后再加记忆/知识图谱/UI skills。'
          : 'The core workflow does not require third-party CLIs; optional memory/knowledge/UI skills can be added later.',
        lang,
        defaultValue: 'core',
        choices: dependencyPackChoices(lang, profile, governancePack),
      })
      : options.dependencyPack ?? 'custom'

    const dependencyPacks = options.skipDeps
      ? []
      : options.packIds ?? packsFromChoice(dependencyChoice, profile, governancePack)
    const dependencyPackLabel = options.skipDeps
      ? 'core'
      : dependencyChoice === 'custom' ? (dependencyPacks.join(',') || 'core') : dependencyChoice
    let applyDependencies = Boolean(options.apply || options.yes)
    if (promptSession && dependencyPacks.length > 0 && !applyDependencies) {
      applyDependencies = await askCliConfirm(promptSession, {
        title: lang === 'zh' ? '现在安装第三方能力吗' : 'Install third-party capabilities now?',
        message: lang === 'zh'
          ? '会先做计划和前置检查；缺少运行时的项目不会强行安装。'
          : 'SCALE will plan and check prerequisites first; blocked items will not be forced.',
        lang,
        defaultValue: false,
      })
    }
    emit('ok', lang === 'zh' ? '安装配置已确认' : 'Install choices resolved', `${formatAgents(agents)}, ${profile}, ${governancePack}, deps=${dependencyPackLabel}`)

    emit('run', lang === 'zh' ? '初始化工作流' : 'Initialize workflow')
    const init = await initializeProject({
      projectDir,
      scaleDir,
      agents,
      profile,
      governancePack,
      lang,
    })
    emit('ok', lang === 'zh' ? '工作流初始化完成' : 'Workflow initialized', `${init.created.length} created, ${init.skipped.length} skipped`)

    let setup: SetupWizardReport | undefined
    if (options.skipDeps || dependencyPacks.length === 0) {
      emit('skip', lang === 'zh' ? '第三方能力安装' : 'Third-party capabilities', lang === 'zh' ? '使用核心工作流模式' : 'core workflow mode')
    } else {
      emit('run', lang === 'zh' ? '规划/安装第三方能力' : 'Plan/install third-party capabilities', dependencyPacks.join(','))
      setup = await runSetupWizard({
        projectDir,
        scaleDir,
        packIds: dependencyPacks,
        includeIds: options.includeIds,
        apply: applyDependencies,
        yes: options.yes,
        interactive: false,
        lang,
        memoryProvider: options.memoryProvider ?? (dependencyPacks.includes('memory') || dependencyPacks.includes('full') ? 'hrain' : undefined),
        memoryMode: options.memoryMode ?? (dependencyPacks.includes('memory') || dependencyPacks.includes('full') ? 'local-only' : undefined),
        memoryEndpoint: options.memoryEndpoint,
        memoryWriteMode: options.memoryWriteMode,
        allowExternalWrite: options.allowExternalWrite,
      })
      if (!setup.ok) warnings.push(...setup.final.recommendations)
      emit(setup.ok ? 'ok' : 'warn', lang === 'zh' ? '第三方能力处理完成' : 'Third-party capability step finished', setup.applied ? 'applied' : 'planned')
    }

    let verification: SetupVerificationReport | undefined
    if (options.skipVerify) {
      emit('skip', lang === 'zh' ? '安装验收' : 'Install verification')
    } else {
      emit('run', lang === 'zh' ? '安装验收' : 'Verify installation')
      verification = await verifySetup({
        projectDir,
        scaleDir,
        packIds: dependencyPacks,
        includeIds: options.includeIds,
      })
      warnings.push(...verification.warnings)
      if (!verification.ok) warnings.push(...verification.summary.blockingIssues)
      emit(verification.ok ? 'ok' : 'warn', lang === 'zh' ? '安装验收完成' : 'Verification finished', verification.ok ? 'passed' : `${verification.summary.blockingIssues.length} blocker(s)`)
    }

    const selection = {
      agent: formatAgents(agents),
      agents,
      profile,
      governancePack,
      dependencyPackLabel,
      dependencyPacks,
      applyDependencies,
      language: lang,
    }
    return {
      ok: Boolean((setup?.ok ?? true) && (verification?.ok ?? true)),
      lang,
      projectDir,
      selection,
      init,
      setup,
      verification,
      steps,
      warnings: uniqueStrings(warnings),
      nextSteps: buildCustomerNextSteps(selection),
    }
  } finally {
    promptSession?.rl.close()
  }
}

async function initializeProject(options: {
  projectDir: string
  scaleDir: string
  agents: string[]
  profile: string
  governancePack: string
  lang: ScaleLanguage
}): Promise<CustomerInstallInitReport> {
  ensureDir(options.scaleDir)
  const scenario = getProfile(options.profile).defaults.scenario
  const created: string[] = []
  const skipped: string[] = []
  const knowledgeDocPaths: string[] = []
  let settingsPath = ''
  let knowledgeDocPath = ''
  for (const agent of options.agents) {
    const adapter = createAdapter(agent)
    const result = await adapter.init({
      projectDir: options.projectDir,
      scaleDir: options.scaleDir,
      agentType: agent as AgentPlatform,
      scenarioMode: scenario,
      thresholdsPath: join(options.scaleDir, 'thresholds.json'),
    })
    if (!settingsPath) settingsPath = result.settingsPath
    if (!knowledgeDocPath) knowledgeDocPath = result.knowledgeDocPath
    knowledgeDocPaths.push(result.knowledgeDocPath)
    created.push(...result.created)
    skipped.push(...result.skipped)
  }
  const projectName = options.projectDir.split(/[/\\]/).pop() || 'Project'
  const governance = writeGovernanceTemplates(options.projectDir, {
    mode: governanceModeFromScenario(scenario),
    projectName,
    pack: options.governancePack,
  })
  const configPath = writeConfigYaml(options.projectDir, options.profile, projectName, options.agents, options.lang)
  const thresholdsPath = writeThresholds(options.scaleDir, scenario)
  const languagePolicyPath = writeAgentLanguagePolicy({
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
    lang: options.lang,
    agents: options.agents,
    knowledgeDocPaths,
  })
  return {
    settingsPath,
    knowledgeDocPath,
    scaleDir: options.scaleDir,
    thresholdsPath,
    configPath,
    languagePolicyPath,
    created: uniqueStrings([...created, ...governance.created, configPath, thresholdsPath, languagePolicyPath]),
    skipped: uniqueStrings([...skipped, ...governance.skipped]),
  }
}

function writeThresholds(scaleDir: string, scenario: 'sandbox' | 'standard' | 'critical'): string {
  ensureDir(scaleDir)
  const thresholdsPath = join(scaleDir, 'thresholds.json')
  if (existsSync(thresholdsPath)) return thresholdsPath
  const coverageThreshold = scenario === 'critical' ? 85 : 80
  writeFileSync(thresholdsPath, JSON.stringify({
    coverage: { minimum: coverageThreshold, unit: 'percent' },
    retry: { bruteMaximum: 3, unit: 'count' },
    severity: { blockLevel: scenario === 'sandbox' ? 'HIGH' : 'CRITICAL' },
    gates: {
      G3_build: { required: scenario !== 'sandbox', exitCode: 0 },
      G4_lint: { required: scenario !== 'sandbox', exitCode: 0 },
      G5_tests: { required: scenario !== 'sandbox', allPass: true },
      G6_coverage: { required: scenario !== 'sandbox', minimum: coverageThreshold },
      G7_security: { required: scenario === 'critical', noCritical: true },
    },
  }, null, 2))
  return thresholdsPath
}

function writeAgentLanguagePolicy(options: {
  projectDir: string
  scaleDir: string
  lang: ScaleLanguage
  agents: string[]
  knowledgeDocPaths: string[]
}): string {
  ensureDir(options.scaleDir)
  const policyPath = join(options.scaleDir, 'agent-language.md')
  const languageName = options.lang === 'zh' ? 'Chinese (Simplified)' : 'English'
  const content = `# SCALE Agent Language Policy

Language: ${options.lang}
Display name: ${languageName}
Agents: ${options.agents.join(', ')}

## Required Behavior

- The agent must respond to the user in ${languageName} unless the user explicitly asks for another language.
- Generated user-facing documents should use ${languageName} by default.
- Code identifiers, commands, package names, file paths, and logs should keep their original spelling.
- If a third-party tool returns output in another language, summarize it in ${languageName} and keep exact commands unchanged.
`
  writeFileSync(policyPath, content, 'utf-8')
  for (const docPath of uniqueStrings(options.knowledgeDocPaths)) {
    appendLanguagePolicyLink(docPath, options.lang, policyPath)
  }
  return policyPath
}

function appendLanguagePolicyLink(docPath: string, lang: ScaleLanguage, policyPath: string): void {
  if (!existsSync(docPath)) return
  const markerStart = '<!-- scale-engine:language-policy:start -->'
  const markerEnd = '<!-- scale-engine:language-policy:end -->'
  const relativePolicy = policyPath.startsWith(process.cwd()) ? policyPath : policyPath
  const block = [
    '',
    markerStart,
    '## SCALE Language Policy',
    '',
    lang === 'zh'
      ? `- 默认使用中文与用户沟通，除非用户明确要求其他语言。`
      : `- Use English with the user by default unless the user explicitly asks for another language.`,
    `- Follow the project language policy at \`${relativePolicy}\`.`,
    markerEnd,
    '',
  ].join('\n')
  const current = readFileSync(docPath, 'utf-8')
  const pattern = new RegExp(`${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\n?`, 'm')
  const next = pattern.test(current)
    ? current.replace(pattern, block.trimStart())
    : `${current.trimEnd()}\n${block}`
  writeFileSync(docPath, next, 'utf-8')
}

function normalizeAgentChoice(value: string): string {
  const raw = value.trim().toLowerCase()
  if (!raw || raw === 'default') return CUSTOMER_AGENT_DEFAULT
  if (['all', 'all-supported', 'all-platforms', '全部', '所有'].includes(raw)) return 'all'
  if (['recommended', 'recommend', 'common', '常用', '推荐'].includes(raw)) return 'recommended'
  if (raw.includes(',')) return raw
  return SUPPORTED_AGENTS.includes(raw as AgentPlatform) ? raw : CUSTOMER_AGENT_DEFAULT
}

function resolveAgentSelection(value: string, detectedAgent?: string): string[] {
  const normalized = normalizeAgentChoice(value)
  if (normalized === 'all') return [...SUPPORTED_AGENTS]
  if (normalized === 'recommended') {
    return uniqueStrings([detectedAgent, ...RECOMMENDED_AGENT_GROUP].filter(Boolean) as string[])
  }
  const selected = normalized
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => normalizeAgentChoice(item))
    .flatMap(item => {
      if (item === 'all') return [...SUPPORTED_AGENTS]
      if (item === 'recommended') return [...RECOMMENDED_AGENT_GROUP]
      return [item]
    })
    .filter(agent => SUPPORTED_AGENTS.includes(agent as AgentPlatform))
  return uniqueStrings(selected.length > 0 ? selected : [CUSTOMER_AGENT_DEFAULT])
}

function formatAgents(agents: string[]): string {
  if (agents.length === SUPPORTED_AGENTS.length) return `all-supported (${agents.length})`
  if (agents.length > 3) return `${agents.slice(0, 3).join(',')} +${agents.length - 3}`
  return agents.join(',')
}

function agentChoices(lang: ScaleLanguage, detectedAgent?: string): Array<CliChoice<string>> {
  const choices: Array<CliChoice<string>> = [
    {
      value: 'recommended',
      label: lang === 'zh' ? '推荐组合' : 'recommended',
      hint: 'codex, claude-code, cursor, qoder, cline, windsurf',
    },
    {
      value: 'all',
      label: lang === 'zh' ? '全部已支持平台' : 'all-supported',
      hint: lang === 'zh' ? '为当前项目写入所有已支持 Agent 适配器配置。' : 'Write config for every supported agent adapter in this project.',
    },
  ]
  choices.push(...uniqueStrings([
    detectedAgent,
    CUSTOMER_AGENT_DEFAULT,
    'claude-code',
    'qoder',
    'cursor',
    'cline',
    'windsurf',
    ...SUPPORTED_AGENTS,
  ].filter(Boolean) as string[]).map(agent => ({
    value: agent,
    label: agent,
    hint: agent === detectedAgent ? (lang === 'zh' ? '已在当前项目检测到。' : 'Detected in this project.') : undefined,
  })))
  return choices
}

function profileChoices(lang: ScaleLanguage): Array<CliChoice<string>> {
  return listProfiles().map(profile => ({
    value: profile.id,
    label: `${profile.name} (${profile.id})`,
    hint: lang === 'zh' ? zhProfileHint(profile.id) : profile.description,
  }))
}

function zhProfileHint(profileId: string): string {
  const hints: Record<string, string> = {
    minimal: '体验/原型：只保留轻量提示和基础安全，不强压交付门禁。',
    standard: '团队默认：拦截危险操作，要求可见验证，适合多数项目。',
    advanced: '严格交付：更强证据、记忆/知识能力和发布前检查。',
    'china-local': '本地优先：面向 Qwen/GLM/DeepSeek/Ollama，不默认依赖外部线上服务。',
  }
  return hints[profileId] ?? '标准治理配置：边界清晰，先保证可用。'
}

function governancePackChoices(lang: ScaleLanguage, detectedPack: string): Array<CliChoice<string>> {
  const packs = uniqueStrings([
    detectedPack,
    'standard',
    'frontend-app',
    'node-library',
    'enterprise-admin',
    'spring-vue-admin',
    'microservice-platform',
    'go-service-matrix',
    'python-service',
    'desktop-app',
    'agent-os-workbench',
    'moe-workspace',
    'resource-governance',
  ])
  return packs.map(pack => ({
    value: pack,
    label: pack,
    hint: pack === detectedPack
      ? (lang === 'zh' ? '根据项目结构推荐。' : 'Recommended from project structure.')
      : undefined,
  }))
}

function dependencyPackChoices(lang: ScaleLanguage, profile: string, governancePack: string): Array<CliChoice<DependencyPackChoice>> {
  const recommended = getBootstrapPlanForProfile(profile, governancePack).packs
  return [
    {
      value: 'core',
      label: lang === 'zh' ? '只安装工作流本体' : 'Core workflow only',
      hint: lang === 'zh' ? '推荐首次安装；不要求 Bun/Cargo/Python。' : 'Recommended for first install; does not require Bun/Cargo/Python.',
    },
    {
      value: 'recommended',
      label: lang === 'zh' ? '推荐能力包' : 'Recommended capabilities',
      hint: recommended.length > 0 ? recommended.join(', ') : (lang === 'zh' ? '当前 profile 无额外依赖。' : 'No extra dependency for this profile.'),
    },
    { value: 'full', label: lang === 'zh' ? '完整能力包' : 'Full capabilities' },
    { value: 'ui', label: lang === 'zh' ? 'UI skills' : 'UI skills' },
    { value: 'memory-knowledge', label: lang === 'zh' ? '记忆 + 知识图谱' : 'Memory + knowledge' },
  ]
}

function packsFromChoice(choice: string, profile: string, governancePack: string): string[] {
  if (choice === 'core') return []
  if (choice === 'recommended') return getBootstrapPlanForProfile(profile, governancePack).packs
  if (choice === 'full') return ['full']
  if (choice === 'ui') return ['ui']
  if (choice === 'memory-knowledge') return ['memory', 'knowledge']
  return []
}

function projectSummary(
  classification: ReturnType<typeof classifyProject>,
  detectedAgent: string | undefined,
  governancePack: string,
): string {
  const framework = classification.framework ? `/${classification.framework}` : ''
  return `${classification.language}${framework}, agent=${detectedAgent ?? 'not detected'}, pack=${governancePack}`
}

function buildCustomerNextSteps(selection: CustomerInstallSelection): string[] {
  const featureHint = selection.language === 'zh' ? '你的功能' : 'your feature'
  const steps = [
    'scale open --dir .',
    'scale smoke --dir .',
    `scale define "${featureHint}" --dir .`,
  ]
  if (selection.dependencyPacks.length > 0 && !selection.applyDependencies) {
    steps.unshift(`scale setup --pack ${selection.dependencyPacks.join(',')} --apply --yes --dir .`)
  }
  return steps
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
