import { stdin as defaultInput, stdout as defaultOutput } from 'node:process'
import { createInterface, type Interface } from 'node:readline'
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

interface PromptSession {
  rl: Interface
  output: NodeJS.WritableStream
  iterator: AsyncIterator<string>
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

  let promptSession: PromptSession | undefined
  try {
    if (interactive) promptSession = createPromptSession(options.input ?? defaultInput, options.output ?? defaultOutput)

    if (promptSession && options.promptLanguage) {
      const question = languageQuestion(lang)
      prompts.push(question.trim())
      lang = normalizeLanguageChoice(await askLine(promptSession, question), lang)
      interactiveChoices.lang = lang
    }

    if (promptSession && options.promptPacks) {
      const question = packQuestion(lang)
      prompts.push(question.trim())
      packIds = normalizePackChoice(await askLine(promptSession, question))
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
      const question = memoryProviderQuestion(lang)
      prompts.push(question.trim())
      memoryProvider = normalizeMemoryProviderChoice(await askLine(promptSession, question))
      interactiveChoices.memoryProvider = memoryProvider
    }

    if (promptSession && memoryProvider && memoryProvider !== 'skip' && !memoryMode) {
      const question = memoryModeQuestion(lang)
      prompts.push(question.trim())
      memoryMode = normalizeMemoryModeChoice(await askLine(promptSession, question))
      interactiveChoices.memoryMode = memoryMode
    }

    const readyIds = plan.items.filter(item => item.status === 'ready').map(item => item.id)
    if (!shouldApply && promptSession && readyIds.length > 0) {
      const question = installQuestion(lang, readyIds)
      prompts.push(question.trim())
      const installChoice = normalizeInstallChoice(await askLine(promptSession, question), readyIds)
      shouldApply = installChoice.apply
      if (installChoice.ids.length > 0) interactiveChoices.installIds = installChoice.ids
    }
  } finally {
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

function languageQuestion(lang: ScaleLanguage): string {
  return lang === 'zh'
    ? '选择安装语言 zh/en，默认 zh: '
    : 'Choose setup language zh/en, default en: '
}

function packQuestion(lang: ScaleLanguage): string {
  return lang === 'zh'
    ? '选择安装包 1=推荐标准(external-cli,memory,knowledge,ui) 2=最小(external-cli) 3=全部 4=只安装UI 5=只安装记忆 6=只安装知识，默认 1: '
    : 'Choose packs 1=standard(external-cli,memory,knowledge,ui) 2=minimal(external-cli) 3=full 4=ui 5=memory 6=knowledge, default 1: '
}

function memoryProviderQuestion(lang: ScaleLanguage): string {
  return lang === 'zh'
    ? `选择记忆供应商:
  1=gbrain (图记忆，CLI模式，推荐)
  2=skip (跳过)
  默认 1: `
    : `Choose memory provider:
  1=gbrain (graph memory, CLI mode, recommended)
  2=skip
  Default 1: `
}

function memoryModeQuestion(lang: ScaleLanguage): string {
  return lang === 'zh'
    ? '选择 gbrain 路由模式 external-first/auto，默认 external-first: '
    : 'Choose gbrain routing mode external-first/auto, default external-first: '
}

function installQuestion(lang: ScaleLanguage, readyIds: string[]): string {
  const list = readyIds.map((id, index) => `${index + 1}=${id}`).join(', ')
  return lang === 'zh'
    ? `发现可安装项：${list}。输入 all 安装全部，输入编号/ID 逗号分隔只安装部分，直接回车跳过: `
    : `Ready to install: ${list}. Type all for all, comma-separated numbers/IDs for selected items, or press Enter to skip: `
}

function normalizeLanguageChoice(value: string, fallback: ScaleLanguage): ScaleLanguage {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'en' || normalized === 'english') return 'en'
  if (normalized === 'zh' || normalized === 'cn' || normalized === 'chinese' || normalized === '中文') return 'zh'
  return fallback
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

function normalizeMemoryProviderChoice(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === '1') return 'gbrain'
  if (normalized === '2' || normalized === 'none' || normalized === 'no' || normalized === 'skip') return 'skip'
  if (normalized === 'gbrain') return 'gbrain'
  return 'gbrain'
}

function normalizeMemoryModeChoice(value: string): MemoryProviderRoutingConfig['mode'] {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'auto' || normalized === '2') return 'auto'
  return 'external-first'
}

function createPromptSession(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): PromptSession {
  const rl = createInterface({ input, crlfDelay: Infinity })
  return {
    rl,
    output,
    iterator: rl[Symbol.asyncIterator](),
  }
}

function normalizeInstallChoice(value: string, readyIds: string[]): { apply: boolean; ids: string[] } {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return { apply: false, ids: [] }
  if (normalized === 'all' || normalized === 'a' || normalized === 'y' || normalized === 'yes' || normalized === '全部') {
    return { apply: true, ids: [] }
  }
  const ids = normalized
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const index = Number.parseInt(item, 10)
      if (Number.isFinite(index) && index > 0) return readyIds[index - 1]
      return readyIds.find(id => id.toLowerCase() === item)
    })
    .filter((item): item is string => Boolean(item))
  return { apply: ids.length > 0, ids: [...new Set(ids)] }
}

async function askLine(promptSession: PromptSession, question: string): Promise<string> {
  promptSession.output.write(question)
  const answer = await promptSession.iterator.next()
  return answer.done ? '' : answer.value
}
