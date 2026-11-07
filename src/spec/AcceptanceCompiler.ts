// SCALE Engine — P1-B 验收标准 → 可执行检查编译器
//
// 把 EARS+ 验收标准（MySpecCriterion / SpecPayload.successCriteria）编译成
// verification.json 可承载的 check 条目：
//   { checkId, clauseId, kind: command|checklist|property, commandTemplate?, needsHuman }
//
// 设计原则（对标 CMU/Google SDD 实证研究 arXiv 2608.25202 的工具缺口）：
//   1) 可测的句式编译为可执行 check（command / property）；
//   2) 模糊/主观的句式降级为 checklist 并标 needsHuman —— **不假装都能自动化**；
//   3) 每个 clause 都能双向追溯到至少一个 check（traceability）；
//   4) 输出 coverage 指标（可自动化占比），作为 spec 质量的显式信号。
//
// 纯函数：无 fs、无 store、无 LLM。可复现、可单测。

export type AcceptanceCheckKind = 'command' | 'checklist' | 'property'

export interface AcceptanceCriterionInput {
  /** requirement/clause id（如 FR-AUTH-001 / AC-1） */
  id: string
  /** 逐字 EARS+ 行 */
  text: string
  /** 可选的 EARS 分类（event/state/error/conditional/ubiquitous） */
  kind?: string
}

export interface AcceptanceCheck {
  checkId: string
  clauseId: string
  clauseText: string
  kind: AcceptanceCheckKind
  needsHuman: boolean
  /** kind=command/property 时的命令模板；needsHuman 时为 undefined */
  commandTemplate?: string
  rationale: string
}

export interface CompileTraceability {
  clauseId: string
  checkIds: string[]
}

export interface CompileSummary {
  total: number
  automatable: number
  needsHuman: number
  byKind: Record<AcceptanceCheckKind, number>
}

export interface CompileResult {
  checks: AcceptanceCheck[]
  traceability: CompileTraceability[]
  summary: CompileSummary
  /** automatable / total，0..1 */
  coverage: number
}

export interface CompileOptions {
  /** 测试运行器命令前缀，默认 `npm test --`。会拼 ` --grep "<checkId>"`。 */
  testRunner?: string
}

/** 主观/模糊措辞——没有客观判据，必须人工核验。 */
const VAGUE_MARKERS =
  /\b(user[- ]friendly|intuitive|reasonable|robust|clean|nice|good|appropriate|adequate|as expected|graceful|seamless|elegant|delightful|simple to use|easy to use)\b/i

/** 可度量的数值/边界判据——适合 property-based 断言。 */
const NUMERIC_MARKERS =
  /(\d+(?:\.\d+)?\s*(ms|millisecond|second|sec|s|%|percent|bytes?|kb|mb|gb|times?|requests?|rps|qps)\b)|(\b(at most|at least|no more than|no fewer than|no less than|greater than|less than)\b)|(<=|>=|≤|≥|\bexceed\b)/i

/** 明确的、可被测试断言的动词（成功/失败/状态变化/副作用）。 */
const ASSERTIVE_VERBS =
  /\b(return|returns|reject|rejects|accept|accepts|persist|persists|emit|emits|throw|throws|fail|fails|pass|passes|create|creates|delete|deletes|update|updates|store|stores|log|logs|deny|denies|allow|allows|redirect|redirects|respond|responds|reject with|status|code|equal|contains|match|matches)\b/i

function normalizeKind(kind: string | undefined): 'event' | 'state' | 'error' | 'conditional' | 'ubiquitous' | undefined {
  if (!kind) return undefined
  const k = kind.toLowerCase()
  if (k === 'event' || k === 'state' || k === 'error' || k === 'conditional' || k === 'ubiquitous') return k
  return undefined
}

function slugId(clauseId: string): string {
  return clauseId.trim().replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'clause'
}

/**
 * 分类单条验收标准。返回 check 的判定结果（不含 checkId 生成）。
 */
function classifyCriterion(
  criterion: AcceptanceCriterionInput,
): { kind: AcceptanceCheckKind; needsHuman: boolean; rationale: string } {
  const text = criterion.text
  const earsKind = normalizeKind(criterion.kind)

  // 1) 显式模糊措辞且无任何数值判据 → checklist（人工）
  if (VAGUE_MARKERS.test(text) && !NUMERIC_MARKERS.test(text)) {
    return {
      kind: 'checklist',
      needsHuman: true,
      rationale: 'Subjective wording with no objective threshold; a human must verify.',
    }
  }

  // 2) 含可度量数值/边界 → property（property-based 断言）
  if (NUMERIC_MARKERS.test(text)) {
    return {
      kind: 'property',
      needsHuman: false,
      rationale: 'Contains a measurable threshold/boundary suitable for a property-based assertion.',
    }
  }

  // 3) EARS 行为类（event/state/error/conditional）或含明确断言动词 → command
  if (earsKind && earsKind !== 'ubiquitous') {
    return {
      kind: 'command',
      needsHuman: false,
      rationale: `EARS ${earsKind} criterion is a behavioral assertion; drive it with an executable test.`,
    }
  }
  if (ASSERTIVE_VERBS.test(text)) {
    return {
      kind: 'command',
      needsHuman: false,
      rationale: 'Contains an assertive verb with an observable outcome; drive it with an executable test.',
    }
  }

  // 4) 兜底：无可观测判据 → checklist（人工）
  return {
    kind: 'checklist',
    needsHuman: true,
    rationale: 'No observable outcome detected; falls back to a human checklist item.',
  }
}

export function compileAcceptanceChecks(
  criteria: AcceptanceCriterionInput[],
  options: CompileOptions = {},
): CompileResult {
  const runner = (options.testRunner ?? 'npm test --').trim()
  const perClause = new Map<string, number>()
  const checks: AcceptanceCheck[] = []

  for (const criterion of criteria) {
    const slug = slugId(criterion.id)
    const index = (perClause.get(slug) ?? 0) + 1
    perClause.set(slug, index)
    const checkId = `CHK-${slug}${index > 1 ? `-${index}` : ''}`
    const verdict = classifyCriterion(criterion)
    const check: AcceptanceCheck = {
      checkId,
      clauseId: criterion.id,
      clauseText: criterion.text.trim(),
      kind: verdict.kind,
      needsHuman: verdict.needsHuman,
      rationale: verdict.rationale,
    }
    if (!verdict.needsHuman && verdict.kind === 'command') {
      check.commandTemplate = `${runner} --grep "${checkId}"`
    } else if (!verdict.needsHuman && verdict.kind === 'property') {
      check.commandTemplate = `${runner} --grep "${checkId}" # property assertion required`
    }
    checks.push(check)
  }

  // traceability: clause → checkIds（保持输入顺序）
  const traceMap = new Map<string, string[]>()
  for (const check of checks) {
    const list = traceMap.get(check.clauseId) ?? []
    list.push(check.checkId)
    traceMap.set(check.clauseId, list)
  }
  const traceability: CompileTraceability[] = [...traceMap.entries()].map(([clauseId, checkIds]) => ({ clauseId, checkIds }))

  const byKind: Record<AcceptanceCheckKind, number> = { command: 0, checklist: 0, property: 0 }
  for (const check of checks) byKind[check.kind] += 1
  const needsHuman = checks.filter(c => c.needsHuman).length
  const automatable = checks.length - needsHuman
  const total = checks.length

  return {
    checks,
    traceability,
    summary: { total, automatable, needsHuman, byKind },
    coverage: total === 0 ? 0 : Number((automatable / total).toFixed(3)),
  }
}

/**
 * 从 SpecPayload.successCriteria（形如 `FR-X: WHEN … SHALL …` 或纯文本）
 * 提取 clause id + text，再编译。用于 `scale verify` / review 侧的无 bundle 场景。
 */
export function compileFromSuccessCriteria(successCriteria: string[], options: CompileOptions = {}): CompileResult {
  const criteria: AcceptanceCriterionInput[] = successCriteria.map((raw, i) => {
    const m = raw.match(/^([A-Z][A-Z0-9-]+-\d{2,})\s*[:：]\s*(.+)$/)
    if (m) return { id: m[1], text: m[2] }
    return { id: `AC-${i + 1}`, text: raw }
  })
  return compileAcceptanceChecks(criteria, options)
}
