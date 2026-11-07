// SCALE Engine — P1-C spec↔code drift 持续检测
//
// 问题（CMU/Google SDD 实证研究 arXiv 2608.25202）：多数团队只在改动「完成后」
// 才核对 spec 是否漂移，导致 spec 与代码长期失配。正确做法是**持续检测**，并在
// 检测到漂移时产出**草拟更新**（append-only），由人工确认后才写回 spec——
// 绝不自动改写规范。
//
// 本模块是纯函数：给定 spec 条款 + 本次变更文件，判断代码是否触及了 spec 引用
// 的路径/模块、而 spec 自身未被更新，从而产出 drift 建议。

export interface DriftClause {
  id: string
  text: string
}

export interface DriftInput {
  clauses: DriftClause[]
  /** 本次变更涉及的文件（相对路径）。 */
  changedFiles: string[]
  /** 本次变更里属于「spec 文件」的路径；若这些都不在 changedFiles，说明 spec 未同步更新。 */
  specFiles?: string[]
  /** 参与匹配的 token 最小长度，默认 4。 */
  minTokenLength?: number
}

export interface DriftFinding {
  clauseId: string
  /** 触发漂移判断的 spec 引用 token。 */
  matchedTokens: string[]
  /** 命中这些 token 的变更文件。 */
  changedFiles: string[]
  reason: string
  /** append-only 草拟更新（仅建议，不自动写入）。 */
  suggestedUpdate: string
}

export interface DriftReport {
  findings: DriftFinding[]
  /** spec 文件本次是否被更新。 */
  specTouched: boolean
  /** 无漂移即 true。 */
  ok: boolean
  /** 检测到的漂移条款数。 */
  driftCount: number
}

const STOPWORDS = new Set([
  'when', 'then', 'shall', 'while', 'where', 'with', 'that', 'this', 'from', 'into',
  'user', 'system', 'should', 'must', 'valid', 'return', 'returns', 'reject', 'rejects',
  'accept', 'accepts', 'persist', 'persists', 'the', 'and', 'for', 'not', 'are', 'was',
])

/** 从条款文本里提取像「路径 / 带扩展名的文件 / camelCase / snake_case 标识符」的 token。 */
export function extractCodeTokens(text: string, minTokenLength = 4): string[] {
  const raw = text.match(/[A-Za-z0-9_./-]{4,}/g) ?? []
  const tokens = new Set<string>()
  for (const candidate of raw) {
    const lower = candidate.toLowerCase()
    if (STOPWORDS.has(lower)) continue
    // 只保留「像代码」的 token：含路径分隔符、扩展名、或 camel/snake 形态
    const looksLikePath = /[./]/.test(candidate)
    const looksLikeIdent = /[a-z][A-Z]|_/.test(candidate)
    if (!looksLikePath && !looksLikeIdent) continue
    if (candidate.length < minTokenLength) continue
    tokens.add(lower)
  }
  return [...tokens]
}

function fileContainsToken(file: string, tokens: string[]): string[] {
  const lower = file.toLowerCase()
  return tokens.filter(token => lower.includes(token))
}

export function detectSpecDrift(input: DriftInput): DriftReport {
  const minTokenLength = input.minTokenLength ?? 4
  const specFiles = (input.specFiles ?? []).map(f => f.toLowerCase())
  const changed = input.changedFiles.map(f => f.replace(/\\/g, '/').toLowerCase())

  // spec 文件本次是否被更新：None configured → 视为已 touched（无法判断时避免误报）。
  const specTouched = specFiles.length === 0
    ? true
    : changed.some(file => specFiles.some(spec => file.endsWith(spec) || file === spec))

  if (specTouched) {
    return { findings: [], specTouched: true, ok: true, driftCount: 0 }
  }

  const findings: DriftFinding[] = []
  for (const clause of input.clauses) {
    const tokens = extractCodeTokens(clause.text, minTokenLength)
    if (tokens.length === 0) continue
    const hitFiles: string[] = []
    const hitTokens = new Set<string>()
    for (const file of changed) {
      const matched = fileContainsToken(file, tokens)
      if (matched.length > 0) {
        hitFiles.push(file)
        matched.forEach(t => hitTokens.add(t))
      }
    }
    if (hitFiles.length === 0) continue
    findings.push({
      clauseId: clause.id,
      matchedTokens: [...hitTokens],
      changedFiles: [...new Set(hitFiles)],
      reason: `Code touching "${[...hitTokens].join(', ')}" changed, but no spec file was updated in this change set.`,
      suggestedUpdate: `- ${clause.id}: [${new Date().toISOString().slice(0, 10)}] code change touched ${hitFiles.slice(0, 3).join(', ')}; confirm the clause still holds or append a delta.`,
    })
  }

  return {
    findings,
    specTouched: false,
    ok: findings.length === 0,
    driftCount: findings.length,
  }
}
