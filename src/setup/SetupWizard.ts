import { resolve } from 'node:path'
import {
  bootstrapDependencies,
  type DependencyBootstrapOptions,
  type DependencyBootstrapReport,
} from '../bootstrap/DependencyBootstrap.js'
import type { ScaleLanguage } from '../i18n/Language.js'
import {
  useMemoryProvider,
  type MemoryProviderRoutingConfig,
  type MemoryProviderUseReport,
  type MemoryProviderWriteMode,
} from '../memory/MemoryProviders.js'
import {
  askCliMultiSelect,
  askCliSelect,
  createCliPromptSession,
  type CliChoice,
  type CliPromptSession,
} from '../cli/CliUx.js'

export interface SetupWizardOptions {
  projectDir?: string
  scaleDir?: string
  packIds?: string[]
  includeIds?: string[]
  onlyIds?: string[]
  promptPacks?: boolean
  apply?: boolean
  yes?: boolean
  interactive?: boolean
  lang?: ScaleLanguage
  memoryProvider?: string
  memoryMode?: MemoryProviderRoutingConfig['mode']
  memoryEndpoint?: string
  memoryWriteMode?: MemoryProviderWriteMode
  allowExternalWrite?: boolean
  promptLanguage?: boolean
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  bootstrap?: (options: DependencyBootstrapOptions) => Promise<DependencyBootstrapReport>
  switchMemoryProvider?: typeof useMemoryProvider
}

export interface SetupWizardInteractiveChoices {
  lang?: ScaleLanguage
  packIds?: string[]
  memoryProvider?: string
  memoryMode?: MemoryProviderRoutingConfig['mode']
  installIds?: string[]
}

export interface SetupWizardReport {
  ok: boolean
  lang: ScaleLanguage
  projectDir: string
  interactive: boolean
  requestedApply: boolean
  applied: boolean
  plan: DependencyBootstrapReport
  final: DependencyBootstrapReport
  memoryProviderSwitch?: MemoryProviderUseReport
  prompts: string[]
  interactiveChoices?: SetupWizardInteractiveChoices
}

export async function runSetupWizard(options: SetupWizardOptions = {}): Promise<SetupWizardReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  let lang = options.lang ?? 'zh'
  const bootstrap = options.bootstrap ?? bootstrapDependencies
  const prompts: string[] = []
  const interactiveChoices: SetupWizardInteractiveChoices = {}
  let shouldApply = Boolean(options.apply || options.yes)
  const interactive = Boolean(options.interactive)
  let memoryProvider = options.memoryProvider
  let memoryMode = options.memoryMode
  let packIds = options.packIds
  let planOptions: DependencyBootstrapOptions
  let plan: DependencyBootstrapReport

  let promptSession: CliPromptSession | undefined
  try {
    if (interactive) promptSession = createCliPromptSession(options.input, options.output)

    if (promptSession && options.promptLanguage) {
      lang = await askCliSelect(promptSession, {
        title: lang === 'zh' ? '安装语言' : 'Setup language',
        message: lang === 'zh' ? '选择安装过程的显示语言。' : 'Choose the display language for setup.',
        lang,
        defaultValue: lang,
        choices: [
          { value: 'zh', label: '中文' },
          { value: 'en', label: 'English' },
        ],
      })
      interactiveChoices.lang = lang
    }

    if (promptSession && options.promptPacks) {
      const packChoice = await askCliSelect(promptSession, {
        title: lang === 'zh' ? '安装能力包' : 'Capability pack',
        message: lang === 'zh'
          ? '工作流本体已可独立使用，第三方能力可以现在安装，也可以之后再装。'
          : 'The core workflow works without optional third-party capabilities.',
        lang,
        defaultValue: 'standard',
        choices: packChoices(lang),
      })
      packIds = normalizePackChoice(packChoice)
      interactiveChoices.packIds = packIds
    }
    planOptions = {
      projectDir,
      scaleDir: options.scaleDir,
      packIds,
      includeIds: options.includeIds,
      onlyIds: options.onlyIds,
      apply: false,
    }
    plan = await bootstrap(planOptions)

    if (promptSession && !memoryProvider && shouldPromptMemoryProvider(plan)) {
      memoryProvider = await askCliSelect(promptSession, {
        title: lang === 'zh' ? '记忆供应商' : 'Memory provider',
        message: lang === 'zh'
          ? 'gbrain 是默认推荐；也可以跳过，稍后再配置。'
          : 'gbrain is recommended by default; you can skip and configure it later.',
        lang,
        defaultValue: 'gbrain',
        choices: [
          { value: 'gbrain', label: 'gbrain', hint: lang === 'zh' ? '图记忆 CLI 模式，推荐。' : 'Graph memory CLI mode, recommended.' },
          { value: 'skip', label: lang === 'zh' ? '跳过' : 'Skip', hint: lang === 'zh' ? '不修改记忆路由。' : 'Do not change memory routing.' },
        ],
      })
      interactiveChoices.memoryProvider = memoryProvider
    }

    if (promptSession && memoryProvider && memoryProvider !== 'skip' && !memoryMode) {
      memoryMode = await askCliSelect<MemoryProviderRoutingConfig['mode']>(promptSession, {
        title: lang === 'zh' ? 'gbrain 路由模式' : 'gbrain routing mode',
        message: lang === 'zh'
          ? 'external-first 优先使用外部记忆，失败时再回落。'
          : 'external-first uses external memory first, then falls back when needed.',
        lang,
        defaultValue: 'external-first',
        choices: [
          { value: 'external-first', label: 'external-first' },
          { value: 'auto', label: 'auto' },
        ],
      })
      interactiveChoices.memoryMode = memoryMode
    }

    const readyIds = plan.items.filter(item => item.status === 'ready').map(item => item.id)
    if (!shouldApply && promptSession && readyIds.length > 0) {
      const installChoice = await askCliMultiSelect(promptSession, {
        title: lang === 'zh' ? '执行安装' : 'Run installation',
        message: lang === 'zh'
          ? '只会安装状态为 ready 的项目；缺少前置依赖的项目会留在修复建议里。'
          : 'Only ready items will be installed; blocked items remain in the fix suggestions.',
        lang,
        allowAll: true,
        allowNone: true,
        choices: readyIds.map(id => ({ value: id, label: id })),
      })
      shouldApply = installChoice.all || installChoice.values.length > 0
      if (installChoice.values.length > 0) interactiveChoices.installIds = installChoice.values
    }
  } finally {
    if (promptSession) prompts.push(...promptSession.prompts.map(prompt => prompt.trim()))
    promptSession?.rl.close()
  }

  const final = shouldApply
    ? await bootstrap({ ...planOptions, onlyIds: interactiveChoices.installIds ?? options.onlyIds, apply: true })
    : plan
  const memoryProviderSwitch = memoryProvider && memoryProvider !== 'skip'
    ? (options.switchMemoryProvider ?? useMemoryProvider)({
      projectDir,
      scaleDir: options.scaleDir,
      provider: memoryProvider,
      mode: memoryMode,
      endpoint: options.memoryEndpoint,
      writeMode: options.memoryWriteMode,
      allowExternalWrite: options.allowExternalWrite,
    })
    : undefined

  return {
    ok: final.ok && (memoryProviderSwitch?.ok ?? true),
    lang,
    projectDir,
    interactive,
    requestedApply: Boolean(options.apply || options.yes),
    applied: shouldApply,
    plan,
    final,
    memoryProviderSwitch,
    prompts,
    interactiveChoices: Object.keys(interactiveChoices).length > 0 ? interactiveChoices : undefined,
  }
}

function shouldPromptMemoryProvider(plan: DependencyBootstrapReport): boolean {
  return plan.packIds.includes('memory') || plan.items.some(item => item.id === 'gbrain')
}

function packChoices(lang: ScaleLanguage): Array<CliChoice<string>> {
  return [
    {
      value: 'standard',
      label: lang === 'zh' ? '标准能力包' : 'Standard pack',
      hint: lang === 'zh' ? 'external-cli, memory, knowledge, ui。' : 'external-cli, memory, knowledge, ui.',
    },
    {
      value: 'minimal',
      label: lang === 'zh' ? '最小能力包' : 'Minimal pack',
      hint: lang === 'zh' ? '只规划 external-cli。' : 'Plans external-cli only.',
    },
    { value: 'full', label: lang === 'zh' ? '完整能力包' : 'Full pack' },
    { value: 'ui', label: lang === 'zh' ? '只安装 UI skills' : 'UI skills only' },
    { value: 'memory', label: lang === 'zh' ? '只安装记忆能力' : 'Memory only' },
    { value: 'knowledge', label: lang === 'zh' ? '只安装知识图谱能力' : 'Knowledge only' },
  ]
}

function normalizePackChoice(value: string): string[] {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === '1' || normalized === 'standard' || normalized === '推荐' || normalized === '标准') {
    return ['external-cli', 'memory', 'knowledge', 'ui']
  }
  if (normalized === '2' || normalized === 'minimal' || normalized === 'min' || normalized === '最小') return ['external-cli']
  if (normalized === '3' || normalized === 'full' || normalized === 'all' || normalized === '全部') return ['full']
  if (normalized === '4' || normalized === 'ui') return ['ui']
  if (normalized === '5' || normalized === 'memory' || normalized === '记忆') return ['memory']
  if (normalized === '6' || normalized === 'knowledge' || normalized === '知识') return ['knowledge']
  const selected = normalized
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item === 'external' || item === 'cli' ? 'external-cli' : item)
    .filter(item => ['external-cli', 'memory', 'knowledge', 'ui', 'full'].includes(item))
  return selected.length > 0 ? selected : ['external-cli', 'memory', 'knowledge', 'ui']
}
