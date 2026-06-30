import { existsSync, writeFileSync } from 'node:fs'
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
  profile: string
  governancePack: string
  dependencyPackLabel: string
  dependencyPacks: string[]
  applyDependencies: boolean
}

export interface CustomerInstallInitReport {
  settingsPath: string
  knowledgeDocPath: string
  scaleDir: string
  thresholdsPath: string
  configPath: string
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

export async function runCustomerInstall(options: CustomerInstallOptions = {}): Promise<CustomerInstallReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? join(projectDir, '.scale')
  const lang = options.lang ?? 'zh'
  const interactive = options.interactive ?? Boolean(process.stdin.isTTY)
  const steps: CliProgressEvent[] = []
  const warnings: string[] = []
  const totalSteps = 5
  let stepIndex = 0
  let promptSession: CliPromptSession | undefined

  const emit = (status: CliProgressEvent['status'], label: string, detail?: string) => {
    if (status === 'run' || status === 'skip') stepIndex += 1
    const event = { index: Math.min(stepIndex, totalSteps), total: totalSteps, status, label, detail }
    steps.push(event)
    options.onProgress?.(event)
  }

  try {
    emit('run', lang === 'zh' ? '检测项目' : 'Detect project')
    const classification = classifyProject(projectDir)
    const detection = detectPlatform(projectDir)
    const detectedAgent = detection.platform ?? undefined
    const defaultAgent = normalizeAgent(options.agent ?? detectedAgent ?? CUSTOMER_AGENT_DEFAULT)
    const defaultGovernancePack = options.governancePack ?? classification.recommendedPack ?? autoDetectGovernancePack(projectDir)
    const defaultProfile = options.profile ?? classification.recommendedProfile ?? 'standard'
    emit('ok', lang === 'zh' ? '项目检测完成' : 'Project detected', projectSummary(classification, detectedAgent, defaultGovernancePack))

    if (interactive) promptSession = createCliPromptSession(options.input, options.output)

    emit('run', lang === 'zh' ? '选择安装配置' : 'Resolve install choices')
    const agent = promptSession && !options.agent
      ? await askCliSelect(promptSession, {
        title: lang === 'zh' ? '选择 Agent 入口' : 'Agent entry',
        message: lang === 'zh'
          ? '安装器会为所选 Agent 写入对应配置和规则文件。'
          : 'The installer writes adapter-specific config and rule files.',
        lang,
        defaultValue: defaultAgent,
        choices: agentChoices(detectedAgent),
      })
      : defaultAgent

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
    emit('ok', lang === 'zh' ? '安装配置已确认' : 'Install choices resolved', `${agent}, ${profile}, ${governancePack}, deps=${dependencyPackLabel}`)

    emit('run', lang === 'zh' ? '初始化工作流' : 'Initialize workflow')
    const init = await initializeProject({
      projectDir,
      scaleDir,
      agent,
      profile,
      governancePack,
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
      agent,
      profile,
      governancePack,
      dependencyPackLabel,
      dependencyPacks,
      applyDependencies,
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
  agent: string
  profile: string
  governancePack: string
}): Promise<CustomerInstallInitReport> {
  ensureDir(options.scaleDir)
  const scenario = getProfile(options.profile).defaults.scenario
  const adapter = createAdapter(options.agent)
  const result = await adapter.init({
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
    agentType: options.agent as AgentPlatform,
    scenarioMode: scenario,
    thresholdsPath: join(options.scaleDir, 'thresholds.json'),
  })
  const projectName = options.projectDir.split(/[/\\]/).pop() || 'Project'
  const governance = writeGovernanceTemplates(options.projectDir, {
    mode: governanceModeFromScenario(scenario),
    projectName,
    pack: options.governancePack,
  })
  const configPath = writeConfigYaml(options.projectDir, options.profile, projectName, [options.agent])
  const thresholdsPath = writeThresholds(options.scaleDir, scenario)
  return {
    settingsPath: result.settingsPath,
    knowledgeDocPath: result.knowledgeDocPath,
    scaleDir: result.scaleDir,
    thresholdsPath,
    configPath,
    created: uniqueStrings([...result.created, ...governance.created, configPath, thresholdsPath]),
    skipped: uniqueStrings([...result.skipped, ...governance.skipped]),
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

function normalizeAgent(value: string): string {
  return SUPPORTED_AGENTS.includes(value as AgentPlatform) ? value : CUSTOMER_AGENT_DEFAULT
}

function agentChoices(detectedAgent?: string): Array<CliChoice<string>> {
  return uniqueStrings([
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
    hint: agent === detectedAgent ? 'Detected in this project.' : undefined,
  }))
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
    minimal: '最小规则，适合试用和原型。',
    standard: '推荐默认值，包含常用门禁和验证要求。',
    advanced: '完整治理，包含记忆、知识和进化能力。',
    'china-local': '面向国内本地模型环境的配置。',
  }
  return hints[profileId] ?? '标准治理配置。'
}

function governancePackChoices(lang: ScaleLanguage, detectedPack: string): Array<CliChoice<string>> {
  const packs = uniqueStrings([
    detectedPack,
    'standard',
    'frontend-app',
    'node-library',
    'go-service-matrix',
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
  const steps = [
    'scale doctor --dir .',
    'scale status --dir .',
    'scale define "<feature>" --dir .',
  ]
  if (selection.dependencyPacks.length > 0 && !selection.applyDependencies) {
    steps.unshift(`scale setup --pack ${selection.dependencyPacks.join(',')} --apply --yes --dir .`)
  }
  return steps
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}
