// SCALE Engine — 验证命令目录（供 guardrail 检测器共享）
// 来源优先级：.scale/verification.json（profiles[].commands + services[].commands）
// > 关键词正则（仅在无 verification.json 或其中无命令时作为后备）。
// GitHub issue #36：PrematureDoneDetector 此前只对 Bash 命令文本做硬编码关键词正则，
// 配置了不含 test/lint/build 字样验证命令的项目永远无法通过 before-stop 门禁。
//
// 匹配语义（均基于规范化命令文本，见 normalizeCommand）：
// 1) 会话命令包含配置命令（容忍 rtk/npx 包装前缀与尾部追加参数）；
// 2) 配置命令以会话命令为前缀（会话运行了配置命令的截断形态）；
// 3) 入口一致：首个 token + 首个含路径分隔符的 token 完全相同
//    （同一脚本不同参数值，如 --timeout-ms 差异，仍算命中）。

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** 关键词后备正则：仅当 verification.json 缺失或无命令时生效。 */
const VERIFICATION_KEYWORD_RE = /\b(test|lint|build|typecheck|tsc|vitest|jest|playwright|preflight|verify)\b/i

/** 前缀/包含比对的最小规范化长度，避免短 token（如 "npm run"）前缀误命中。 */
const COMMAND_PREFIX_MIN = 12

export interface VerificationCommandCatalog {
  /** Version declared by .scale/verification.json; 1 is the legacy/default schema. */
  version: number
  /** 全部 profile + service 的命令（去重），用于匹配判定。 */
  commands: string[]
  /** default profile（或 defaultProfile 指向的 profile）的命令，用于建议文案。 */
  suggestionCommands: string[]
  source: 'verification-matrix' | 'keyword-fallback'
}

export function loadVerificationCommandCatalog(
  projectDir = process.env.SCALE_PROJECT_DIR ?? process.cwd(),
  scaleDir = process.env.SCALE_DIR ?? '.scale',
): VerificationCommandCatalog {
  const root = isAbsolute(scaleDir) ? scaleDir : join(resolve(projectDir), scaleDir)
  const matrixPath = join(root, 'verification.json')
  if (!existsSync(matrixPath)) {
    return { version: Number.isInteger(matrix.version) ? Number(matrix.version) : 1, commands: [], suggestionCommands: [], source: 'keyword-fallback' }
  }
  try {
    const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8').replace(/^\uFEFF/, '')) as {
      version?: number
      defaultProfile?: string
      profiles?: Record<string, { commands?: Record<string, unknown> } | undefined>
      services?: Array<{ commands?: Record<string, unknown> }>
    }
    const commands: string[] = []
    for (const profile of Object.values(matrix.profiles ?? {})) {
      collectCommands(profile?.commands, commands)
    }
    for (const service of matrix.services ?? []) {
      collectCommands(service?.commands, commands)
    }
    if (commands.length === 0) {
      return { commands: [], suggestionCommands: [], source: 'keyword-fallback' }
    }
    const profileName = matrix.defaultProfile ?? 'default'
    const suggestionCommands: string[] = []
    collectCommands(matrix.profiles?.[profileName]?.commands, suggestionCommands)
    return {
      version: Number.isInteger(matrix.version) ? Number(matrix.version) : 1,
      commands: [...new Set(commands)],
      suggestionCommands,
      source: 'verification-matrix',
    }
  } catch {
    return { commands: [], suggestionCommands: [], source: 'keyword-fallback' }
  }
}

function collectCommands(source: Record<string, unknown> | undefined, sink: string[]): void {
  if (!source) return
  for (const value of Object.values(source)) {
    if (typeof value === 'string' && value.trim().length > 0) sink.push(value.trim())
  }
}

const SHELL_TOOL_ALIASES = new Set([
  'bash', 'shell', 'terminal', 'powershell', 'powershell_core', 'pwsh',
  'cmd', 'command', 'run_command', 'execute_command', 'run_terminal_command',
])

/** Canonical shell adapter name; unknown MCP tools intentionally return null. */
export function normalizeShellToolName(tool: unknown): string | null {
  if (typeof tool !== 'string') return null
  const normalized = tool.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return SHELL_TOOL_ALIASES.has(normalized) ? normalized : null
}

export function isVerificationCommand(
  command: string | undefined | null,
  catalog: VerificationCommandCatalog = loadVerificationCommandCatalog(),
): boolean {
  if (typeof command !== 'string' || command.trim().length === 0) return false
  if (catalog.source === 'verification-matrix') {
    return matchesConfiguredVerification(command, catalog.commands)
  }
  return VERIFICATION_KEYWORD_RE.test(command)
}

/** before-stop 门禁建议文案：优先输出项目配置的验证命令，pnpm 三连仅作兜底。 */
export function verificationSuggestion(catalog: VerificationCommandCatalog): string {
  if (catalog.suggestionCommands.length === 0) {
    return 'pnpm test && pnpm lint && pnpm build'
  }
  const priority = ['test', 'lint', 'build', 'typecheck', 'coverage', 'smoke']
  const selected: string[] = []
  for (const key of priority) {
    const match = catalog.suggestionCommands.find(cmd => normalizeCommand(cmd).includes(key))
    if (match && !selected.includes(match)) selected.push(match)
  }
  const chosen = selected.length > 0
    ? selected.slice(0, 3)
    : catalog.suggestionCommands.slice(0, 3)
  return chosen.join(' && ')
}

function matchesConfiguredVerification(command: string, configured: string[]): boolean {
  const normalized = normalizeCommand(command)
  if (normalized.length < COMMAND_PREFIX_MIN) return false
  const commandEntry = entryPointTokens(normalized)
  return configured.some(entry => {
    const target = normalizeCommand(entry)
    if (target.length < COMMAND_PREFIX_MIN) return false
    if (normalized.includes(target) || target.startsWith(normalized)) return true
    const targetEntry = entryPointTokens(target)
    return commandEntry.length > 0 && commandEntry.join(' ') === targetEntry.join(' ')
  })
}

/**
 * 命令入口：首个 token + 首个含路径分隔符的 token（如 scripts/workflow/run-vitest.mjs）。
 * 无路径 token 时取前两个 token。
 */
function entryPointTokens(normalized: string): string[] {
  const tokens = normalized.split(' ').filter(Boolean)
  const pathToken = tokens.find(token => token.includes('/'))
  if (pathToken) return [tokens[0], pathToken]
  return tokens.slice(0, 2)
}

/** 命令文本规范化：压空白、去引号、反斜杠转正斜杠、小写、剥 rtk 包装前缀。 */
export function normalizeCommand(value: string): string {
  let normalized = value
    .replace(/\s+/g, ' ')
    .replace(/["']/g, '')
    .replace(/\\/g, '/')
    .trim()
    .toLowerCase()
  if (normalized.startsWith('rtk ')) normalized = normalized.slice(4)
  return normalized
}
