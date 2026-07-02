import { stdin as defaultInput, stdout as defaultOutput } from 'node:process'
import { createInterface, type Interface } from 'node:readline'
import type { ScaleLanguage } from '../i18n/Language.js'

export interface CliChoice<T extends string = string> {
  value: T
  label: string
  hint?: string
}

export interface CliPromptSession {
  rl: Interface
  output: NodeJS.WritableStream
  iterator: AsyncIterator<string>
  prompts: string[]
}

export interface CliSelectOptions<T extends string = string> {
  title: string
  message?: string
  choices: Array<CliChoice<T>>
  defaultValue?: T
  lang?: ScaleLanguage
}

export interface CliMultiSelectOptions<T extends string = string> {
  title: string
  message?: string
  choices: Array<CliChoice<T>>
  lang?: ScaleLanguage
  allowAll?: boolean
  allowNone?: boolean
}

export interface CliMultiSelectResult<T extends string = string> {
  all: boolean
  values: T[]
}

export type CliProgressStatus = 'run' | 'ok' | 'warn' | 'fail' | 'skip'

export interface CliProgressEvent {
  index: number
  total: number
  label: string
  status: CliProgressStatus
  detail?: string
}

export function createCliPromptSession(
  input: NodeJS.ReadableStream = defaultInput,
  output: NodeJS.WritableStream = defaultOutput,
): CliPromptSession {
  const rl = createInterface({ input, crlfDelay: Infinity })
  return {
    rl,
    output,
    iterator: rl[Symbol.asyncIterator](),
    prompts: [],
  }
}

export async function askCliSelect<T extends string>(
  session: CliPromptSession,
  options: CliSelectOptions<T>,
): Promise<T> {
  if (options.choices.length === 0) throw new Error(`No choices available for prompt: ${options.title}`)
  const defaultIndex = Math.max(0, options.choices.findIndex(choice => choice.value === options.defaultValue))
  const title = formatSelectPrompt(options, defaultIndex)
  session.prompts.push(title)
  for (;;) {
    session.output.write(title)
    const answer = await readLine(session)
    const selected = resolveChoice(answer, options.choices, defaultIndex)
    if (selected) return selected.value
    session.output.write(invalidChoiceMessage(options.lang ?? 'zh', options.choices.length))
  }
}

export async function askCliConfirm(
  session: CliPromptSession,
  options: { title: string; message?: string; defaultValue?: boolean; lang?: ScaleLanguage },
): Promise<boolean> {
  const lang = options.lang ?? 'zh'
  const suffix = options.defaultValue ? 'Y/n' : 'y/N'
  const prompt = [
    '',
    options.title,
    options.message ? `  ${options.message}` : undefined,
    `> ${lang === 'zh' ? '请输入' : 'Enter'} ${suffix}: `,
  ].filter(Boolean).join('\n')
  session.prompts.push(prompt)
  for (;;) {
    session.output.write(prompt)
    const answer = (await readLine(session)).trim().toLowerCase()
    if (!answer) return Boolean(options.defaultValue)
    if (['y', 'yes', '1', 'true', '是', '好', '确认'].includes(answer)) return true
    if (['n', 'no', '0', 'false', '否', '不', '跳过'].includes(answer)) return false
    session.output.write(lang === 'zh' ? '  输入无效，请输入 y 或 n。\n' : '  Invalid input. Enter y or n.\n')
  }
}

export async function askCliMultiSelect<T extends string>(
  session: CliPromptSession,
  options: CliMultiSelectOptions<T>,
): Promise<CliMultiSelectResult<T>> {
  if (options.choices.length === 0) return { all: false, values: [] }
  const lang = options.lang ?? 'zh'
  const prompt = formatMultiSelectPrompt(options)
  session.prompts.push(prompt)
  for (;;) {
    session.output.write(prompt)
    const raw = (await readLine(session)).trim().toLowerCase()
    if (!raw) return { all: false, values: [] }
    if (options.allowAll !== false && ['all', 'a', 'yes', 'y', '全部', '全选'].includes(raw)) {
      return { all: true, values: [] }
    }
    if (options.allowNone !== false && ['none', 'n', 'no', 'skip', '跳过', '不安装'].includes(raw)) {
      return { all: false, values: [] }
    }
    const values = raw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => resolveChoice(item, options.choices, -1)?.value)
      .filter((item): item is T => Boolean(item))
    if (values.length > 0) return { all: false, values: [...new Set(values)] }
    session.output.write(invalidChoiceMessage(lang, options.choices.length, true))
  }
}

export function renderProgressLine(event: CliProgressEvent): string {
  const width = 24
  const done = event.total <= 0 ? width : Math.max(0, Math.min(width, Math.round((event.index / event.total) * width)))
  const bar = `${'#'.repeat(done)}${'-'.repeat(width - done)}`
  const percent = event.total <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((event.index / event.total) * 100)))
  const status = {
    run: 'RUN',
    ok: 'OK',
    warn: 'WARN',
    fail: 'FAIL',
    skip: 'SKIP',
  }[event.status]
  const detail = event.detail ? ` - ${event.detail}` : ''
  return `[${bar}] ${String(percent).padStart(3, ' ')}% ${event.index}/${event.total} ${status} ${event.label}${detail}`
}

export function renderCliError(error: unknown, lang: ScaleLanguage, context?: {
  title?: string
  command?: string
  next?: string[]
}): string {
  const message = error instanceof Error ? error.message : String(error)
  const stackHint = error instanceof Error && error.stack
    ? error.stack.split('\n').slice(1, 3).map(line => line.trim()).filter(Boolean)
    : []
  const lines = lang === 'zh'
    ? [
        '',
        context?.title ?? 'SCALE 操作失败',
        '',
        `原因: ${message}`,
        context?.command ? `命令: ${context.command}` : undefined,
        ...stackHint.map(line => `  位置: ${line}`),
        '',
        '建议:',
        ...(context?.next?.length ? context.next.map(item => `    - ${item}`) : [
          '    - 使用 --json 获取机器可读错误信息',
          '    - 运行 scale doctor --dir . 检查项目状态',
          '    - 修复上方原因后重新执行同一条命令',
        ]),
      ]
    : [
        '',
        context?.title ?? 'SCALE operation failed',
        '',
        `Reason: ${message}`,
        context?.command ? `Command: ${context.command}` : undefined,
        ...stackHint.map(line => `  Location: ${line}`),
        '',
        'Try:',
        ...(context?.next?.length ? context.next.map(item => `    - ${item}`) : [
          '    - Re-run with --json for machine-readable output',
          '    - Run scale doctor --dir . to inspect project state',
          '    - Fix the reason above, then retry the same command',
        ]),
      ]
  return lines.filter(Boolean).join('\n')
}

async function readLine(session: CliPromptSession): Promise<string> {
  const answer = await session.iterator.next()
  return answer.done ? '' : String(answer.value)
}

function formatSelectPrompt<T extends string>(options: CliSelectOptions<T>, defaultIndex: number): string {
  const lines = ['', options.title]
  if (options.message) lines.push(`  ${options.message}`)
  options.choices.forEach((choice, index) => {
    const recommended = index === defaultIndex ? (options.lang === 'en' ? ' (recommended)' : '（推荐）') : ''
    lines.push(`  ${index + 1}. ${choice.label}${recommended}`)
    if (choice.hint) lines.push(`     ${choice.hint}`)
  })
  lines.push(`> ${options.lang === 'en' ? 'Choose number/ID, Enter for default' : '输入编号/ID，直接回车使用默认值'} [${defaultIndex + 1}]: `)
  return lines.join('\n')
}

function formatMultiSelectPrompt<T extends string>(options: CliMultiSelectOptions<T>): string {
  const lang = options.lang ?? 'zh'
  const lines = ['', options.title]
  if (options.message) lines.push(`  ${options.message}`)
  options.choices.forEach((choice, index) => {
    lines.push(`  ${index + 1}. ${choice.label}`)
    if (choice.hint) lines.push(`     ${choice.hint}`)
  })
  const all = options.allowAll === false ? '' : (lang === 'zh' ? 'all=全部，' : 'all=all, ')
  const none = options.allowNone === false ? '' : (lang === 'zh' ? '回车=跳过' : 'Enter=skip')
  lines.push(`> ${lang === 'zh' ? '输入编号/ID，逗号分隔；' : 'Enter numbers/IDs separated by comma; '}${all}${none}: `)
  return lines.join('\n')
}

function resolveChoice<T extends string>(
  raw: string,
  choices: Array<CliChoice<T>>,
  defaultIndex: number,
): CliChoice<T> | undefined {
  const normalized = raw.trim().toLowerCase()
  if (!normalized && defaultIndex >= 0) return choices[defaultIndex]
  const index = Number.parseInt(normalized, 10)
  if (Number.isFinite(index) && index > 0 && index <= choices.length) return choices[index - 1]
  return choices.find(choice => choice.value.toLowerCase() === normalized || choice.label.toLowerCase() === normalized)
}

function invalidChoiceMessage(lang: ScaleLanguage, total: number, multi = false): string {
  if (lang === 'en') {
    return multi
      ? `  Invalid choice. Enter all, press Enter, or use numbers from 1-${total} separated by commas.\n`
      : `  Invalid choice. Enter a number from 1-${total}.\n`
  }
  return multi
    ? `  输入无效。请输入 all、直接回车，或输入 1-${total} 的编号并用逗号分隔。\n`
    : `  输入无效。请输入 1-${total} 之间的编号。\n`
}
