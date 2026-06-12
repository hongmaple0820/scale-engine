// SCALE Engine — G23 Test Integrity Gate (P1.2, PR-D1)
// Detects "fake green" test tampering by analysing the test-file diff:
// assertion count drops, newly introduced skip/only, weakened assertions, and
// inflated timeouts. PR-D1 ships advisory (warn-only); enforcement + verify→ship
// hash consistency + coverage regression land in PR-D2.

import type { GateResult, GateStage, GateEvidence } from '../types.js'
import type { TestIntegrityEvidence, TestIntegrityFinding } from '../../artifact/types.js'
import type { IGate } from './GateSystem.js'
import { execSync } from 'node:child_process'

type RequiredLevel = 'S' | 'M' | 'L' | 'ALWAYS' | 'CRITICAL'

function createEvidence(input: Omit<GateEvidence, 'id'>): GateEvidence {
  return {
    id: `EVID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...input,
  }
}

function textEvidence(items: GateEvidence[]): string {
  return items.map(item => `${item.label}: ${item.detail}`).join('\n')
}

/** Matches test files by filename suffix or by living under a tests/__tests__ dir. */
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/

/** expect(...) / assert(...) / assert.* / .should / should(...) — line-level assertion signal. */
const ASSERTION_PATTERN = /\bexpect\s*\(|\bassert\s*\(|\bassert\.|\.should\b|\bshould\s*\(/

const SKIP_PATTERN = /\b(?:describe|context|suite|it|test|bench)\.skip\b|\.skip\s*\(|\bx(?:it|describe|test|context)\s*\(/
const ONLY_PATTERN = /\b(?:describe|context|suite|it|test|bench)\.only\b|\.only\s*\(|\bf(?:it|describe|test)\s*\(/
const WEAKENED_PATTERN = /expect\.any\s*\(|expect\.anything\s*\(|\.toBeTruthy\s*\(|\.toBeFalsy\s*\(|\.toBeDefined\s*\(|\.toBeUndefined\s*\(|\.toBeNull\s*\(/
const TIMEOUT_PATTERN = /\b(?:jest|vi)\.setTimeout\s*\(|testTimeout\s*[:=]|\bsetTimeout\s*\(|\btimeout\s*[:=]\s*\d{4,}/

export interface ParsedDiffLine {
  file: string
  /** '+' added, '-' removed, ' ' context. */
  origin: '+' | '-' | ' '
  text: string
}

export interface TestIntegrityAnalysis {
  analyzedFiles: string[]
  preChangeAssertionCount: number
  postChangeAssertionCount: number
  assertionCountDelta: number
  findings: TestIntegrityFinding[]
  flaggedPatterns: string[]
}

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path)
}

/** Parse a unified `git diff` into per-line records limited to test files. */
export function parseTestDiff(diff: string): ParsedDiffLine[] {
  const lines: ParsedDiffLine[] = []
  let currentFile = ''
  let inTestFile = false
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git')) {
      currentFile = ''
      inTestFile = false
      continue
    }
    if (raw.startsWith('+++ ')) {
      const path = raw.slice(4).replace(/^b\//, '').trim()
      currentFile = path === '/dev/null' ? currentFile : path
      inTestFile = isTestFile(currentFile)
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('@@') || raw.startsWith('index ')) continue
    if (!inTestFile || !currentFile) continue
    if (raw.startsWith('+')) lines.push({ file: currentFile, origin: '+', text: raw.slice(1) })
    else if (raw.startsWith('-')) lines.push({ file: currentFile, origin: '-', text: raw.slice(1) })
    else if (raw.startsWith(' ')) lines.push({ file: currentFile, origin: ' ', text: raw.slice(1) })
  }
  return lines
}

/** Pure heuristic analysis of a unified test diff. Exported for unit testing. */
export function analyzeTestDiff(diff: string): TestIntegrityAnalysis {
  const parsed = parseTestDiff(diff)
  const analyzedFiles = [...new Set(parsed.map(line => line.file))].sort()

  // Pre side = context + removed; post side = context + added. Approximates the
  // assertion balance within the changed hunks (whole-file counts arrive with AST in P1.1).
  let preChangeAssertionCount = 0
  let postChangeAssertionCount = 0
  for (const line of parsed) {
    const hasAssertion = ASSERTION_PATTERN.test(line.text)
    if (!hasAssertion) continue
    if (line.origin === '-' || line.origin === ' ') preChangeAssertionCount++
    if (line.origin === '+' || line.origin === ' ') postChangeAssertionCount++
  }
  const assertionCountDelta = postChangeAssertionCount - preChangeAssertionCount

  const findings: TestIntegrityFinding[] = []
  if (assertionCountDelta < 0) {
    findings.push({
      file: analyzedFiles.join(', ') || '(test files)',
      kind: 'assertion-removed',
      severity: 'block',
      detail: `Net assertion count dropped by ${Math.abs(assertionCountDelta)} (pre=${preChangeAssertionCount}, post=${postChangeAssertionCount})`,
    })
  }

  for (const line of parsed) {
    if (line.origin !== '+') continue
    const text = line.text
    if (SKIP_PATTERN.test(text)) {
      findings.push({ file: line.file, kind: 'skip-added', severity: 'block', detail: `Introduced skipped test: ${text.trim().slice(0, 120)}` })
    }
    if (ONLY_PATTERN.test(text)) {
      findings.push({ file: line.file, kind: 'only-added', severity: 'block', detail: `Introduced focused (.only) test: ${text.trim().slice(0, 120)}` })
    }
    if (WEAKENED_PATTERN.test(text)) {
      findings.push({ file: line.file, kind: 'weakened-assertion', severity: 'warn', detail: `Weakened assertion: ${text.trim().slice(0, 120)}` })
    }
    if (TIMEOUT_PATTERN.test(text)) {
      findings.push({ file: line.file, kind: 'timeout-inflated', severity: 'warn', detail: `Test timeout changed: ${text.trim().slice(0, 120)}` })
    }
  }

  const flaggedPatterns = findings.map(f => `[${f.severity}] ${f.kind}: ${f.detail}`)
  return { analyzedFiles, preChangeAssertionCount, postChangeAssertionCount, assertionCountDelta, findings, flaggedPatterns }
}

export interface TestIntegrityGateOptions {
  /** Working directory used to run git. Defaults to process.cwd(). */
  cwd?: string
  /** Diff base ref; the gate analyses `git diff <baseRef>`. Defaults to 'HEAD'. */
  baseRef?: string
  /** Pre-supplied unified diff (skips git invocation). Primarily for tests. */
  diff?: string
  /** When true (PR-D1 default) the gate never blocks — it only surfaces findings. */
  advisory?: boolean
}

/**
 * G23 — Test Integrity. Advisory in PR-D1: always PASSED, surfaces heuristic
 * findings as evidence. PR-D2 wires it into verify/ship and flips `block`
 * severity findings into real blockers under the `full`/`ci` profiles (E1).
 */
export class TestIntegrityGate implements IGate {
  stage = 'G23' as GateStage
  name = 'Test Integrity'
  description = 'Detect test weakening (assertion drops, skip/only, weakened matchers, inflated timeouts)'
  requiredLevel: RequiredLevel = 'M'

  private cwd: string
  private baseRef: string
  private injectedDiff?: string
  private advisory: boolean

  constructor(options: TestIntegrityGateOptions = {}) {
    this.cwd = options.cwd ?? process.cwd()
    this.baseRef = options.baseRef ?? 'HEAD'
    this.injectedDiff = options.diff
    this.advisory = options.advisory ?? true
  }

  private collectDiff(): string {
    if (this.injectedDiff !== undefined) return this.injectedDiff
    try {
      return execSync(`git diff ${this.baseRef}`, { encoding: 'utf-8', stdio: 'pipe', cwd: this.cwd, maxBuffer: 32 * 1024 * 1024 })
    } catch {
      return ''
    }
  }

  async execute(): Promise<GateResult> {
    const startedAt = Date.now()
    const analysis = analyzeTestDiff(this.collectDiff())

    const evidence: TestIntegrityEvidence = {
      analyzedFiles: analysis.analyzedFiles,
      preChangeAssertionCount: analysis.preChangeAssertionCount,
      postChangeAssertionCount: analysis.postChangeAssertionCount,
      assertionCountDelta: analysis.assertionCountDelta,
      flaggedPatterns: analysis.flaggedPatterns,
      findings: analysis.findings,
      advisory: this.advisory,
    }

    const blockingFindings = analysis.findings.filter(f => f.severity === 'block')
    // PR-D1: advisory — never block. PR-D2 will drive blocking via profile policy.
    const blockers = this.advisory ? [] : blockingFindings.map(f => `${f.kind}: ${f.detail}`)
    const passed = blockers.length === 0

    const summaryDetail = analysis.analyzedFiles.length === 0
      ? 'No test files changed; nothing to analyse.'
      : `Analyzed ${analysis.analyzedFiles.length} test file(s); assertion delta ${analysis.assertionCountDelta >= 0 ? '+' : ''}${analysis.assertionCountDelta}; ${analysis.findings.length} finding(s)${this.advisory ? ' (advisory)' : ''}.`

    const evidenceItems: GateEvidence[] = [
      createEvidence({
        kind: 'scan',
        label: 'Test integrity summary',
        passed: passed && blockingFindings.length === 0,
        detail: summaryDetail,
        source: JSON.stringify(evidence),
      }),
      ...analysis.findings.map(finding => createEvidence({
        kind: 'scan',
        label: `Test integrity finding (${finding.kind})`,
        passed: this.advisory ? true : finding.severity !== 'block',
        detail: `[${finding.severity}] ${finding.file}: ${finding.detail}`,
      })),
    ]

    return {
      gate: this.stage,
      status: passed ? 'PASSED' : 'FAILED',
      passed,
      evidence: textEvidence(evidenceItems),
      evidenceItems,
      blockers,
      durationMs: Date.now() - startedAt,
    }
  }
}
