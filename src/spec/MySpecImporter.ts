// SCALE Engine — MySpec spec bundle importer
// -------------------------------------------
// Ingests a MySpec (https://myspec.dev) 4-file SDD bundle into SCALE's two
// spec layers:
//   1. the `.scale/specs/` markdown layer (session injection + review input)
//   2. the artifact layer (Spec/Plan/Task hierarchy under the FSM)
//
// Bundle shape (MySpec export):
//   constitution.md — WHY: invariants ([INV-xx] … / MUST / MUST NEVER lines)
//   requirements.md — WHAT: user stories with EARS+ acceptance criteria
//                     (WHEN/WHILE/IF … THEN … SHALL, IDs like FR-AUTH-001)
//   solution.md     — HOW: design + Mermaid diagrams
//   tasks.md        — THE PLAN: checkbox task list referencing requirement IDs
//
// This module is pure (no fs, no store): parsing, mapping, traceability.

import type { SpecPayload } from '../artifact/types.js'

export interface MySpecBundleFiles {
  constitution: string
  requirements: string
  solution: string
  tasks: string
}

export interface MySpecCriterion {
  /** requirement id extracted from the line or nearest heading (e.g. FR-AUTH-001) */
  id: string
  /** the verbatim EARS+ line */
  text: string
  /** error-handling criteria (IF … THEN … SHALL) also feed edgeCases */
  kind: 'event' | 'state' | 'error' | 'conditional' | 'ubiquitous'
}

export interface MySpecStory {
  title: string
  criteria: MySpecCriterion[]
}

export interface MySpecTask {
  text: string
  done: boolean
  /** requirement ids referenced in the task text (FR-…) */
  requirementRefs: string[]
}

export interface ParsedMySpecBundle {
  invariants: string[]
  stories: MySpecStory[]
  criteria: MySpecCriterion[]
  design: string
  tasks: MySpecTask[]
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const INV_LINE = /^\s*(?:[-*]\s*)?\[?(INV-[A-Z0-9-]+)\]?\s*(.+)$/
const EARS_LINE = /\b(WHEN|WHILE|IF|WHERE|THEN)\b.*\bSHALL\b/
const REQ_ID = /\b([A-Z]{2,6}(?:-[A-Z0-9]+)*-\d{2,})\b/g

function classifyCriterion(text: string): MySpecCriterion['kind'] {
  if (/\bIF\b.*\bTHEN\b/.test(text)) return 'error'
  if (/\bWHILE\b/.test(text)) return 'state'
  if (/\bIF\b/.test(text)) return 'conditional'
  if (/\bWHEN\b/.test(text)) return 'event'
  return 'ubiquitous'
}

function lastReqId(text: string): string | undefined {
  const ids = [...text.matchAll(REQ_ID)].map(m => m[1])
  return ids[ids.length - 1]
}

/** Pull [INV-xx]/MUST-NEVER invariant lines out of constitution.md. */
export function parseInvariants(constitution: string): string[] {
  const out: string[] = []
  for (const raw of constitution.split(/\r?\n/)) {
    const m = raw.match(INV_LINE)
    if (m) {
      out.push(`[${m[1]}] ${m[2].trim()}`)
      continue
    }
    const t = raw.trim()
    if (/^[-*]\s/.test(t) && /\bMUST(\s+NEVER)?\b/.test(t)) out.push(t.replace(/^[-*]\s*/, ''))
  }
  return out
}

/** Split requirements.md into stories; EARS+ lines become criteria. */
export function parseRequirements(requirements: string): MySpecStory[] {
  const stories: MySpecStory[] = []
  const lines = requirements.split(/\r?\n/)
  let current: MySpecStory | null = null
  let headingReqId: string | undefined

  const pushCriterion = (line: string) => {
    if (!current) {
      current = { title: '(untitled)', criteria: [] }
      stories.push(current)
    }
    const text = line.trim().replace(/^[-*]\s+/, '')
    const id = lastReqId(text) ?? lastReqId(headingReqId ?? '') ?? `AC-${current.criteria.length + 1}`
    current.criteria.push({ id, text, kind: classifyCriterion(text) })
  }

  for (const line of lines) {
    const heading = line.match(/^(#{2,4})\s+(.*)$/)
    if (heading) {
      const title = heading[2].trim()
      // a heading that is itself a story or a requirement group (FR-AUTH-001 — …)
      if (/^as a\b/i.test(title) || /\b(requirement|story|feature)\b/i.test(title) || REQ_ID.test(title)) {
        REQ_ID.lastIndex = 0
        current = { title, criteria: [] }
        stories.push(current)
        headingReqId = lastReqId(title)
        continue
      }
      // any other heading ends the current story block
      if (current && current.criteria.length > 0) current = null
      headingReqId = undefined
      continue
    }
    const t = line.trim()
    if (!t) continue
    if (EARS_LINE.test(t)) pushCriterion(line)
  }
  return stories.filter(s => s.criteria.length > 0)
}

/** Parse tasks.md checkbox items and their FR-… references. */
export function parseTasks(tasks: string): MySpecTask[] {
  const out: MySpecTask[] = []
  for (const raw of tasks.split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/)
    if (!m) continue
    const text = m[2].trim()
    REQ_ID.lastIndex = 0
    out.push({
      text,
      done: m[1].toLowerCase() === 'x',
      requirementRefs: [...text.matchAll(REQ_ID)].map(x => x[1]),
    })
  }
  return out
}

export function parseMySpecBundle(files: MySpecBundleFiles): ParsedMySpecBundle {
  const stories = parseRequirements(files.requirements)
  const criteria = stories.flatMap(s => s.criteria)
  return {
    invariants: parseInvariants(files.constitution),
    stories,
    criteria,
    design: files.solution.trim(),
    tasks: parseTasks(files.tasks),
  }
}

// ---------------------------------------------------------------------------
// Mapping → SCALE SpecPayload
// ---------------------------------------------------------------------------

/** Ambiguity mirrors the DEFINE-phase heuristic: criteria count lowers score. */
function ambiguityFromCriteria(criteriaCount: number): number {
  let score = 0.2
  if (criteriaCount >= 2) score -= 0.03
  if (criteriaCount >= 3) score -= 0.02
  return Math.max(0.05, Number(score.toFixed(2)))
}

export function mapToSpecPayload(parsed: ParsedMySpecBundle): SpecPayload {
  const errorCriteria = parsed.criteria.filter(c => c.kind === 'error').map(c => c.text)
  return {
    what: parsed.stories[0]?.title
      ?? parsed.criteria[0]?.text
      ?? 'MySpec imported requirements',
    successCriteria: parsed.criteria.map(c => `${c.id}: ${c.text}`),
    outOfScope: [],
    edgeCases: errorCriteria,
    northStar: parsed.invariants[0] ?? 'Spec-driven delivery with traceable acceptance criteria',
    ambiguityScore: ambiguityFromCriteria(parsed.criteria.length),
    // constitution invariants become non-regression constraints
    constraints: parsed.invariants,
    // every EARS+ criterion is testable by construction — that is the surface
    verificationSurface: parsed.criteria.map(c => `${c.id} (EARS+ acceptance criterion)`),
  }
}

// ---------------------------------------------------------------------------
// Spec digest (`.scale/specs/<slug>.md` — SCALE spec markdown shape)
// ---------------------------------------------------------------------------

export function slugifyBundleName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'myspec-import'
}

export function buildSpecDigest(name: string, parsed: ParsedMySpecBundle): string {
  const lines: string[] = [
    `# Spec: ${name} (MySpec import)`,
    '',
    '**ID**: myspec-import',
    '**Status**: FROZEN',
    `**Ambiguity Score**: ${ambiguityFromCriteria(parsed.criteria.length)}`,
    '**Source**: MySpec SDD bundle (constitution/requirements/solution/tasks)',
    '',
    '## What',
    parsed.stories.map(s => `- ${s.title}`).join('\n') || '(no stories parsed)',
    '',
    '## Success Criteria',
    ...parsed.criteria.map(c => `- [ ] ${c.id}: ${c.text}`),
    '',
    '## Out of Scope',
    '(see imported requirements.md)',
    '',
    '## Edge Cases',
    ...(parsed.criteria.filter(c => c.kind === 'error').map(c => `- ${c.text}`) || ['(none defined)']),
    '',
    '## North Star',
    parsed.invariants[0] ?? 'User value delivered',
  ]
  if (parsed.invariants.length > 0) {
    lines.push('', '## Constraints', ...parsed.invariants.map(i => `- ${i}`))
  }
  lines.push('', '---', '*Imported by `scale spec import-myspec` — originals under `.scale/specs/myspec/`*')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Traceability (the conformance gate's core check)
// ---------------------------------------------------------------------------

export interface TraceabilityReport {
  /** criteria ids no task references */
  untracedCriteria: string[]
  /** task references to requirement ids that do not exist in requirements.md */
  phantomRefs: Array<{ task: string; ref: string }>
  /** unchecked tasks at import/verify time */
  openTasks: string[]
  criteriaCount: number
  taskCount: number
  ok: boolean
}

export function checkTraceability(parsed: ParsedMySpecBundle): TraceabilityReport {
  const knownIds = new Set(parsed.criteria.map(c => c.id))
  const referenced = new Set(parsed.tasks.flatMap(t => t.requirementRefs))

  const untracedCriteria = parsed.criteria
    .filter(c => !referenced.has(c.id))
    .map(c => c.id)

  const phantomRefs: Array<{ task: string; ref: string }> = []
  for (const task of parsed.tasks) {
    for (const ref of task.requirementRefs) {
      if (!knownIds.has(ref)) phantomRefs.push({ task: task.text, ref })
    }
  }

  const openTasks = parsed.tasks.filter(t => !t.done).map(t => t.text)

  return {
    untracedCriteria,
    phantomRefs,
    openTasks,
    criteriaCount: parsed.criteria.length,
    taskCount: parsed.tasks.length,
    ok: untracedCriteria.length === 0 && phantomRefs.length === 0,
  }
}
