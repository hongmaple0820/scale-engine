import { defineCommand } from 'citty'
import { PROJECT_DIR, isTruthyFlag } from './engineBootstrap.js'
import { renderCliError, renderProgressLine } from './CliUx.js'
import { normalizeLanguage, resolveCliLanguage } from '../i18n/Language.js'
import {
  runCustomerInstall,
  type CustomerInstallReport,
  type DependencyPackChoice,
} from '../setup/CustomerInstall.js'

export const installCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Customer-first one-command SCALE workflow installation',
  },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    agent: { type: 'string', default: '', description: 'Agent adapter, for example codex, claude-code, cursor, qoder' },
    profile: { type: 'string', default: '', description: 'Governance profile: minimal, standard, advanced, china-local' },
    'governance-pack': { type: 'string', default: '', description: 'Governance template pack, for example frontend-app or node-library' },
    pack: { type: 'string', default: '', description: 'Capability pack: core, recommended, full, ui, memory-knowledge, or comma-separated pack ids' },
    include: { type: 'string', default: '', description: 'Additional dependency ids to include explicitly' },
    apply: { type: 'boolean', default: false, description: 'Install ready third-party capabilities after planning' },
    yes: { type: 'boolean', default: false, description: 'Confirm third-party installation without prompting' },
    interactive: { type: 'boolean', default: true, description: 'Use standardized prompts when values are omitted' },
    'no-deps': { type: 'boolean', default: false, description: 'Install core workflow only, without dependency planning' },
    'skip-verify': { type: 'boolean', default: false, description: 'Skip setup verification' },
    lang: { type: 'string', description: 'Output language zh/en' },
    'memory-provider': { type: 'string', description: 'Memory provider to configure during install. Supported defaults: hrain, gbrain' },
    'memory-mode': { type: 'string', description: 'Memory routing mode: auto, local-only, external-first' },
    'memory-endpoint': { type: 'string', description: 'Optional memory provider endpoint' },
    'memory-write-mode': { type: 'string', description: 'Memory write mode: disabled, candidate-only, enabled' },
    'allow-external-write': { type: 'boolean', default: false, description: 'Allow external memory writes' },
    json: { type: 'boolean', default: false, description: 'Output machine-readable install report' },
  },
  async run({ args }) {
    const explicitLang = optionalString(args.lang)
    const lang = resolveCliLanguage({ lang: explicitLang, projectDir: String(args.dir ?? PROJECT_DIR) })
    try {
      const pack = parseInstallPack(args.pack)
      if (!isTruthyFlag(args.json)) console.log(renderInstallBanner(lang))
      const report = await runCustomerInstall({
        projectDir: String(args.dir ?? PROJECT_DIR),
        agent: optionalString(args.agent),
        profile: optionalString(args.profile),
        governancePack: optionalString(args['governance-pack']),
        dependencyPack: pack.dependencyPack,
        packIds: pack.packIds,
        includeIds: parseCommaList(args.include),
        apply: isTruthyFlag(args.apply),
        yes: isTruthyFlag(args.yes),
        interactive: isTruthyFlag(args.interactive) && !isTruthyFlag(args.json) && Boolean(process.stdin.isTTY),
        skipDeps: isTruthyFlag(args['no-deps']),
        skipVerify: isTruthyFlag(args['skip-verify']),
        lang: explicitLang ? normalizeLanguage(lang) : undefined,
        memoryProvider: optionalString(args['memory-provider']),
        memoryMode: normalizeMemoryModeArg(args['memory-mode']),
        memoryEndpoint: optionalString(args['memory-endpoint']),
        memoryWriteMode: normalizeMemoryWriteModeArg(args['memory-write-mode']),
        allowExternalWrite: isTruthyFlag(args['allow-external-write']) ? true : undefined,
        onProgress: isTruthyFlag(args.json) ? undefined : event => console.log(renderProgressLine(event)),
      })
      if (args.json) {
        console.log(JSON.stringify(report, null, 2))
      } else {
        renderInstallReport(report)
      }
      if (!report.ok) process.exitCode = 1
    } catch (error) {
      if (args.json) {
        console.log(JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2))
      } else {
        console.error(renderCliError(error, lang, {
          title: lang === 'zh' ? 'SCALE 安装失败' : 'SCALE install failed',
          command: 'scale install',
        }))
      }
      process.exitCode = 1
    }
  },
})

function renderInstallReport(report: CustomerInstallReport): void {
  const lang = report.lang
  if (lang === 'zh') {
    console.log('\nSCALE 安装结果')
    console.log(`  项目: ${report.projectDir}`)
    console.log(`  语言: ${report.selection.language}`)
    console.log(`  Agent: ${report.selection.agent}`)
    console.log(`  Agent 明细: ${report.selection.agents.join(', ')}`)
    console.log(`  Profile: ${report.selection.profile}`)
    console.log(`  模板: ${report.selection.governancePack}`)
    console.log(`  第三方能力: ${report.selection.dependencyPackLabel}`)
    console.log(`  结果: ${report.ok ? '完成' : '需要处理'}`)
    console.log(`  配置: ${report.init.configPath}`)
    console.log(`  规则: ${report.init.knowledgeDocPath}`)
    console.log(`  语言规范: ${report.init.languagePolicyPath}`)
    console.log(`  数据目录: ${report.init.scaleDir}`)
    if (report.warnings.length > 0) {
      console.log(`\n需要关注 (${Math.min(report.warnings.length, 8)}/${report.warnings.length}):`)
      for (const warning of report.warnings.slice(0, 8)) console.log(`  - ${warning}`)
    }
    console.log('\n下一步:')
    for (const step of report.nextSteps) {
      console.log(`  ${step}`)
      console.log(`    ${explainNextStep(step, lang)}`)
    }
    return
  }

  console.log('\nSCALE Install Result')
  console.log(`  Project: ${report.projectDir}`)
  console.log(`  Language: ${report.selection.language}`)
  console.log(`  Agent: ${report.selection.agent}`)
  console.log(`  Agents: ${report.selection.agents.join(', ')}`)
  console.log(`  Profile: ${report.selection.profile}`)
  console.log(`  Template: ${report.selection.governancePack}`)
  console.log(`  Capabilities: ${report.selection.dependencyPackLabel}`)
  console.log(`  Result: ${report.ok ? 'complete' : 'needs attention'}`)
  console.log(`  Config: ${report.init.configPath}`)
  console.log(`  Rules: ${report.init.knowledgeDocPath}`)
  console.log(`  Language policy: ${report.init.languagePolicyPath}`)
  console.log(`  Data dir: ${report.init.scaleDir}`)
  if (report.warnings.length > 0) {
    console.log(`\nAttention (${Math.min(report.warnings.length, 8)}/${report.warnings.length}):`)
    for (const warning of report.warnings.slice(0, 8)) console.log(`  - ${warning}`)
  }
  console.log('\nNext:')
  for (const step of report.nextSteps) {
    console.log(`  ${step}`)
    console.log(`    ${explainNextStep(step, lang)}`)
  }
}

function renderInstallBanner(lang: 'zh' | 'en'): string {
  const subtitle = lang === 'zh'
    ? 'AI 工作流 + Agent OS 治理安装器'
    : 'AI Workflow + Agent OS governance installer'
  return [
    '+------------------------------------------------------------+',
    '| SCALE Engine                                               |',
    `| ${padRight(subtitle, 58)} |`,
    '| Author: hongmaple0820                                      |',
    '| Source: https://github.com/hongmaple0820/scale-engine       |',
    '+------------------------------------------------------------+',
  ].join('\n')
}

function padRight(value: string, width: number): string {
  const text = value.length > width ? value.slice(0, width) : value
  return `${text}${' '.repeat(Math.max(0, width - text.length))}`
}

function explainNextStep(step: string, lang: 'zh' | 'en'): string {
  if (step.startsWith('scale setup ')) {
    return lang === 'zh'
      ? '安装可选第三方能力；核心工作流已经可用，这一步只补齐增强能力。'
      : 'Installs optional third-party capabilities; the core workflow already works.'
  }
  if (step.startsWith('scale doctor')) {
    return lang === 'zh'
      ? '检查当前项目的 SCALE 配置、运行时和治理健康度。'
      : 'Checks SCALE config, runtime, and governance health for this project.'
  }
  if (step.startsWith('scale status')) {
    return lang === 'zh'
      ? '查看当前任务、证据、门禁和工作流状态。'
      : 'Shows task, evidence, gate, and workflow status.'
  }
  if (step.startsWith('scale define')) {
    return lang === 'zh'
      ? '开始一个需求，把自然语言功能描述转成可执行规格。把 <feature> 换成你的需求。'
      : 'Starts a requirement and turns a feature description into an executable spec. Replace <feature>.'
  }
  return lang === 'zh' ? '按需执行。' : 'Run when needed.'
}

function parseInstallPack(value: unknown): { dependencyPack?: DependencyPackChoice; packIds?: string[] } {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return {}
  if (['core', 'none', 'no-deps', 'workflow'].includes(raw)) return { dependencyPack: 'core' }
  if (['recommended', 'recommend', 'default'].includes(raw)) return { dependencyPack: 'recommended' }
  if (['full', 'all'].includes(raw)) return { dependencyPack: 'full' }
  if (raw === 'ui') return { dependencyPack: 'ui' }
  if (['memory-knowledge', 'knowledge-memory', 'ai-os'].includes(raw)) return { dependencyPack: 'memory-knowledge' }
  return { packIds: parseCommaList(raw) }
}

function parseCommaList(value: unknown): string[] {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function optionalString(value: unknown): string | undefined {
  const raw = String(value ?? '').trim()
  return raw ? raw : undefined
}

function normalizeMemoryModeArg(value: unknown): 'auto' | 'local-only' | 'external-first' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'local-only' || normalized === 'external-first') return normalized
  return undefined
}

function normalizeMemoryWriteModeArg(value: unknown): 'disabled' | 'candidate-only' | 'enabled' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'disabled' || normalized === 'candidate-only' || normalized === 'enabled') return normalized
  return undefined
}
