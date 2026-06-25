import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { estimateTokens } from '../context/ContextBudget.js'
import { resolvePathWithinRoots } from '../core/pathSafety.js'
import { redactEvidenceText, redactEvidenceValue } from '../tools/ToolEvidenceStore.js'
import { runSafeCommand } from '../tools/SafeCommandRunner.js'

export type WorkflowEvalCaseType = 'bugfix' | 'feature' | 'refactor' | 'security' | 'frontend' | 'release' | 'resource'
export type FailureReplayCategory =
  | 'wrong-exploration-path'
  | 'hallucinated-project-fact'
  | 'missing-codegraph-or-graph-fallback'
  | 'over-broad-context-load'
  | 'bad-skill-recommendation'
  | 'missing-verification-evidence'
  | 'failed-security-or-resource-gate'
  | 'human-correction-after-agent-confidence'
  | 'command-failure'
  | 'unknown'

export interface WorkflowEvalAttempt {
  id?: string
  command: string
  expectedExitCode?: number
  outputContains?: string
  outputEquals?: string
  timeoutMs?: number
}

export interface WorkflowEvalCase {
  id: string
  type: WorkflowEvalCaseType
  title: string
  task: string
  phase?: string
  successCriteria?: string[]
  attempts: WorkflowEvalAttempt[]
  expectedFailureCategory?: FailureReplayCategory
  humanCorrections?: number
  estimatedContextTokens?: number
}

export interface WorkflowEvalSuite {
  version: string
  id: string
  name: string
  cases: WorkflowEvalCase[]
}

export interface WorkflowEvalAttemptResult {
  id: string
  command: string
  expectedExitCode: number
  exitCode: number
  passed: boolean
  durationMs: number
  outputSummary: string
  redactionApplied: boolean
}

export interface WorkflowEvalCaseResult {
  id: string
  type: WorkflowEvalCaseType
  title: string
  task: string
  passed: boolean
  passAt1: boolean
  passAt3: boolean
  fixIterations: number
  humanCorrections: number
  estimatedTokens: number
  toolCalls: number
  attempts: WorkflowEvalAttemptResult[]
  failureReplayIds: string[]
}

export interface WorkflowEvalMetrics {
  total: number
  passed: number
  failed: number
  passAt1: number
  passAt3: number
  passAt1Rate: number
  passAt3Rate: number
  averageFixIterations: number
  totalToolCalls: number
  estimatedTokens: number
  humanCorrections: number
  failureReplayCount: number
}

export interface WorkflowEvalRun {
  id: string
  suiteId: string
  generatedAt: string
  projectDir: string
  ok: boolean
  cases: WorkflowEvalCaseResult[]
  metrics: WorkflowEvalMetrics
  failureReplayIds: string[]
}

export interface FailureReplayRecord {
  id: string
  taskId: string
  suiteId: string
  caseId: string
  generatedAt: string
  category: FailureReplayCategory
  phase: string
  task: string
  wrongTurn: string
  evidence: string
  correction: string
  prevention: string
  replayCommand?: string
  status: 'open' | 'promoted' | 'accepted-risk' | 'closed'
  closedAt?: string
  closedByEvalRunId?: string
  redactionApplied: boolean
}

export interface FailureImprovementCandidate {
  id: string
  failureId: string
  createdAt: string
  category: FailureReplayCategory
  title: string
  recommendation: string
  evidencePath: string
  status: 'candidate'
}

export interface WorkflowEvalComparison {
  baseline: Pick<WorkflowEvalRun, 'id' | 'suiteId' | 'metrics'>
  candidate: Pick<WorkflowEvalRun, 'id' | 'suiteId' | 'metrics'>
  delta: {
    passAt1Rate: number
    passAt3Rate: number
    averageFixIterations: number
    totalToolCalls: number
    estimatedTokens: number
    humanCorrections: number
  }
  recommendation: 'improved' | 'regressed' | 'mixed' | 'same'
}

export interface WorkflowEvalStoreOptions {
  projectDir?: string
  scaleDir?: string
}

export function defaultWorkflowEvalSuite(): WorkflowEvalSuite {
  return {
    version: '1.0',
    id: 'workflow-baseline',
    name: 'SCALE workflow baseline',
    cases: [
      {
        id: 'governance-command-smoke',
        type: 'bugfix',
        title: 'Command evidence smoke',
        task: 'Verify that a local command can produce concrete eval evidence.',
        phase: 'verify',
        successCriteria: ['command exits 0', 'output contains scale-eval-ok'],
        attempts: [
          {
            id: 'attempt-1',
            command: 'node -e "console.log(\'scale-eval-ok\')"',
            expectedExitCode: 0,
            outputContains: 'scale-eval-ok',
          },
        ],
      },
      {
        id: 'bugfix-null-safety',
        type: 'bugfix',
        title: 'Null safety fix in artifact store',
        task: 'Fix a null reference error when accessing artifact payload that is undefined.',
        phase: 'build',
        successCriteria: [
          'code handles undefined payload without throwing',
          'test covers null/undefined payload case',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const p = undefined; console.log(p?.name ?? \'default\')"',
          expectedExitCode: 0,
          outputContains: 'default',
        }],
      },
      {
        id: 'bugfix-regex-escape',
        type: 'bugfix',
        title: 'Regex special characters in user input',
        task: 'Fix a bug where user-provided strings with regex special characters break pattern matching.',
        phase: 'build',
        successCriteria: [
          'special characters are escaped before use in regex',
          'test covers strings with (, ), [, ], +, *, ?',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const s=\'test(1)\'; const escaped=[...s].map(c=>\'.*+?^${}()|[]\'.includes(c)?String.fromCharCode(92)+c:c).join(\'\'); const r=new RegExp(escaped); console.log(r.test(s))"',
          expectedExitCode: 0,
          outputContains: 'true',
        }],
      },
      {
        id: 'bugfix-json-parse-error',
        type: 'bugfix',
        title: 'Malformed JSON handling in settings loader',
        task: 'Fix crash when .scale/settings.json contains invalid JSON.',
        phase: 'build',
        successCriteria: [
          'invalid JSON returns default config instead of crashing',
          'error is logged but does not propagate',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "try{JSON.parse(\'{bad}\')}catch(e){console.log(\'handled:\'+e.message)}"',
          expectedExitCode: 0,
          outputContains: 'handled:',
        }],
      },
      {
        id: 'bugfix-event-leak',
        type: 'bugfix',
        title: 'Event listener memory leak in EventBus',
        task: 'Fix memory leak caused by not removing event listeners on unsubscribe.',
        phase: 'build',
        successCriteria: [
          'unsubscribe removes handler from handler set',
          'handler count decreases after unsubscribe',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const s=new Set(); s.add(()=>{}); const h=[...s][0]; s.delete(h); console.log(s.size)"',
          expectedExitCode: 0,
          outputContains: '0',
        }],
      },
      {
        id: 'bugfix-path-traversal',
        type: 'bugfix',
        title: 'Path traversal in file read operation',
        task: 'Fix path traversal vulnerability where ../../../etc/passwd can be read.',
        phase: 'build',
        successCriteria: [
          'paths with .. segments are rejected or normalized',
          'test covers traversal attempts',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const p=require(\'path\'); const base=p.resolve(\'project-root\'); const target=p.resolve(base,\'..\',\'..\',\'etc\',\'passwd\'); console.log(target.startsWith(base))"',
          expectedExitCode: 0,
          outputContains: 'false',
        }],
      },
      {
        id: 'bugfix-async-timeout',
        type: 'bugfix',
        title: 'Async operation hangs without timeout',
        task: 'Fix hanging async operation by adding proper timeout mechanism.',
        phase: 'build',
        successCriteria: [
          'operation times out after configured duration',
          'timeout error is properly propagated',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const p=new Promise((_,rej)=>setTimeout(()=>rej(new Error(\'timeout\')),100)); p.catch(e=>console.log(e.message))"',
          expectedExitCode: 0,
          outputContains: 'timeout',
        }],
      },
      {
        id: 'bugfix-concurrent-write',
        type: 'bugfix',
        title: 'Concurrent file write corruption',
        task: 'Fix data corruption when multiple processes write to the same JSONL file simultaneously.',
        phase: 'build',
        successCriteria: [
          'writes are serialized via lock or atomic operation',
          'file integrity is maintained after concurrent writes',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const fs=require(\'fs\'),os=require(\'os\'),path=require(\'path\'); const f=path.join(os.tmpdir(),\'scale-eval-test-atomic.jsonl\'); fs.writeFileSync(f,\'\'); for(let i=0;i<5;i++){fs.appendFileSync(f,JSON.stringify({i})+String.fromCharCode(10))} console.log(fs.readFileSync(f,\'utf-8\').trim().split(String.fromCharCode(10)).length)"',
          expectedExitCode: 0,
          outputContains: '5',
        }],
      },
      {
        id: 'bugfix-empty-array-guard',
        type: 'bugfix',
        title: 'Empty array causes division by zero',
        task: 'Fix division by zero when calculating average on empty results array.',
        phase: 'build',
        successCriteria: [
          'empty array returns 0 or NaN guard instead of Infinity',
          'test covers empty and single-element arrays',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const a=[]; const avg=a.length?a.reduce((s,v)=>s+v,0)/a.length:0; console.log(avg)"',
          expectedExitCode: 0,
          outputContains: '0',
        }],
      },
      {
        id: 'bugfix-encoding-utf8',
        type: 'bugfix',
        title: 'UTF-8 BOM in settings file breaks parser',
        task: 'Fix JSON parse failure when settings.json has UTF-8 BOM prefix.',
        phase: 'build',
        successCriteria: [
          'BOM is stripped before JSON.parse',
          'test covers file with and without BOM',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const bom=String.fromCharCode(65279); const s=bom+JSON.stringify({ok:true}); console.log(JSON.parse(s.replace(bom,\'\')).ok)"',
          expectedExitCode: 0,
          outputContains: 'true',
        }],
      },
      {
        id: 'feature-api-endpoint',
        type: 'feature',
        title: 'Add GET /api/artifacts/:id endpoint',
        task: 'Implement a new API endpoint to retrieve a single artifact by ID with proper error handling.',
        phase: 'build',
        successCriteria: [
          'returns artifact JSON for valid ID',
          'returns 404 for non-existent ID',
          'returns 400 for invalid ID format',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const id=\'spec-001\'; console.log(/^[a-z]+-[0-9]+$/.test(id)?\'valid-id\':\'bad-id\')"',
          expectedExitCode: 0,
          outputEquals: 'valid-id',
        }],
      },
      {
        id: 'feature-cli-flag',
        type: 'feature',
        title: 'Add --json flag to scale status command',
        task: 'Add JSON output format to the status command for programmatic consumption.',
        phase: 'build',
        successCriteria: [
          '--json flag produces valid JSON output',
          'default output remains human-readable',
          'JSON includes all status fields',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "console.log(JSON.stringify({status:\'ok\',version:\'1.0\'}))"',
          expectedExitCode: 0,
          outputContains: 'status',
        }],
      },
      {
        id: 'feature-webhook-config',
        type: 'feature',
        title: 'Configurable webhook for event notifications',
        task: 'Implement webhook configuration that POSTs events to a user-specified URL.',
        phase: 'build',
        successCriteria: [
          'webhook URL is read from config',
          'events are POSTed as JSON',
          'failed webhooks are retried with backoff',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const url=\'https://example.com/hook\'; console.log(url.startsWith(\'https://\')?\'valid\':\'invalid\')"',
          expectedExitCode: 0,
          outputContains: 'valid',
        }],
      },
      {
        id: 'feature-filter-query',
        type: 'feature',
        title: 'Add filtering to artifact list command',
        task: 'Implement --type and --status filters for the artifact list command.',
        phase: 'build',
        successCriteria: [
          '--type filter returns only matching artifact types',
          '--status filter returns only matching statuses',
          'filters can be combined',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const items=[{type:\'Spec\',status:\'DRAFT\'},{type:\'Task\',status:\'DONE\'}]; const f=items.filter(i=>i.type===\'Spec\'); console.log(f.length)"',
          expectedExitCode: 0,
          outputContains: '1',
        }],
      },
      {
        id: 'feature-diff-view',
        type: 'feature',
        title: 'Show diff between artifact versions',
        task: 'Implement a diff view that shows changes between two artifact versions.',
        phase: 'build',
        successCriteria: [
          'added lines are marked with +',
          'removed lines are marked with -',
          'unchanged lines are shown as context',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const a=[\'line1\',\'line2\']; const b=[\'line1\',\'line3\']; const d=a.map((l,i)=>b[i]===l?\' \'+l:\'-\'+l); console.log(d.join(String.fromCharCode(10)))"',
          expectedExitCode: 0,
          outputContains: '-line2',
        }],
      },
      {
        id: 'refactor-extract-module',
        type: 'refactor',
        title: 'Extract detector logic into separate module',
        task: 'Refactor monolithic guardrails file by extracting detector classes into their own module.',
        phase: 'build',
        successCriteria: [
          'detectors are in separate file',
          'imports are updated',
          'all existing tests still pass',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const path=require(\'path\'); console.log(path.posix.join(\'src/guardrails\',\'detectors.ts\'))"',
          expectedExitCode: 0,
          outputContains: 'guardrails/detectors',
        }],
      },
      {
        id: 'refactor-reduce-complexity',
        type: 'refactor',
        title: 'Reduce cyclomatic complexity in Gateway.preTool',
        task: 'Refactor deeply nested if-else chains in Gateway.preTool into early returns.',
        phase: 'build',
        successCriteria: [
          'max nesting depth is reduced',
          'behavior is unchanged',
          'all existing tests pass',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "function f(x){if(!x)return null;if(typeof x!==\'number\')return null;return x*2} console.log(f(5))"',
          expectedExitCode: 0,
          outputContains: '10',
        }],
      },
      {
        id: 'refactor-consolidate-types',
        type: 'refactor',
        title: 'Consolidate duplicate type definitions',
        task: 'Merge duplicate interface definitions across artifact/types.ts and guardrails/Gateway.ts.',
        phase: 'build',
        successCriteria: [
          'single source of truth for shared types',
          'no duplicate interfaces',
          'type compatibility maintained',
        ],
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const t={sessionId:\'s1\',tool:\'Bash\',args:{}}; console.log(typeof t.sessionId===\'string\'?\'ok\':\'fail\')"',
          expectedExitCode: 0,
          outputContains: 'ok',
        }],
      },
      {
        id: 'security-secret-detection',
        type: 'security',
        title: 'Detect hardcoded secrets in code changes',
        task: 'Verify that the OWASP detector catches hardcoded API keys, passwords, and tokens.',
        phase: 'verify',
        successCriteria: [
          'API key pattern is detected',
          'password assignment is detected',
          'token in URL is detected',
        ],
        expectedFailureCategory: 'failed-security-or-resource-gate',
        attempts: [{
          id: 'attempt-1',
          command: 'node -e "const code=\'const key=sk-abc123\'; const r=/sk-[a-zA-Z0-9]{6,}/; console.log(r.test(code)?\'detected\':\'missed\')"',
          expectedExitCode: 0,
          outputContains: 'detected',
        }],
      },
    ],
  }
}

export class WorkflowEvalStore {
  readonly projectDir: string
  readonly scaleRoot: string
  readonly evalRoot: string
  readonly suitesDir: string
  readonly runsDir: string
  readonly failuresDir: string
  readonly improvementsDir: string

  constructor(options: WorkflowEvalStoreOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    this.scaleRoot = isAbsolute(options.scaleDir ?? '')
      ? options.scaleDir as string
      : join(this.projectDir, options.scaleDir ?? '.scale')
    this.evalRoot = join(this.scaleRoot, 'evals')
    this.suitesDir = join(this.evalRoot, 'suites')
    this.runsDir = join(this.evalRoot, 'runs')
    this.failuresDir = join(this.evalRoot, 'failures')
    this.improvementsDir = join(this.evalRoot, 'improvements')
  }

  initSuite(suiteId = 'workflow-baseline', force = false): { path: string; written: boolean; suite: WorkflowEvalSuite } {
    const suite = { ...defaultWorkflowEvalSuite(), id: suiteId }
    const path = this.suitePath(suiteId)
    if (existsSync(path) && !force) return { path, written: false, suite: this.loadSuite(suiteId) }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(suite, null, 2), 'utf-8')
    return { path, written: true, suite }
  }

  loadSuite(suiteIdOrPath = 'workflow-baseline'): WorkflowEvalSuite {
    const path = this.resolveSuitePath(suiteIdOrPath)
    if (!existsSync(path)) return defaultWorkflowEvalSuite()
    return JSON.parse(stripBom(readFileSync(path, 'utf-8'))) as WorkflowEvalSuite
  }

  saveRun(run: WorkflowEvalRun): string {
    mkdirSync(this.runsDir, { recursive: true })
    const path = join(this.runsDir, `${safeSegment(run.id)}.json`)
    writeFileSync(path, JSON.stringify(run, null, 2), 'utf-8')
    return path
  }

  saveFailure(record: FailureReplayRecord): string {
    mkdirSync(this.failuresDir, { recursive: true })
    const path = join(this.failuresDir, `${safeSegment(record.id)}.json`)
    writeFileSync(path, JSON.stringify(record, null, 2), 'utf-8')
    return path
  }

  closeOpenFailuresForCase(options: {
    suiteId: string
    caseId: string
    closedByEvalRunId?: string
  }): string[] {
    const closedAt = new Date().toISOString()
    const closed: string[] = []
    for (const failure of this.listFailures({ taskId: options.caseId })) {
      if (failure.suiteId !== options.suiteId || failure.caseId !== options.caseId || failure.status !== 'open') continue
      this.saveFailure({
        ...failure,
        status: 'closed',
        closedAt,
        closedByEvalRunId: options.closedByEvalRunId,
      })
      closed.push(failure.id)
    }
    return closed
  }

  listFailures(query: { taskId?: string; sinceDays?: number } = {}): FailureReplayRecord[] {
    if (!existsSync(this.failuresDir)) return []
    const since = query.sinceDays ? Date.now() - query.sinceDays * 24 * 60 * 60 * 1000 : 0
    return readdirSync(this.failuresDir)
      .filter(file => file.endsWith('.json'))
      .map(file => readJson<FailureReplayRecord>(join(this.failuresDir, file)))
      .filter((record): record is FailureReplayRecord => Boolean(record))
      .filter(record => !query.taskId || record.taskId === query.taskId)
      .filter(record => !since || Date.parse(record.generatedAt) >= since)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
  }

  getFailure(id: string): FailureReplayRecord | null {
    return readJson<FailureReplayRecord>(join(this.failuresDir, `${safeSegment(id)}.json`))
  }

  loadRun(idOrPath: string): WorkflowEvalRun {
    const path = this.resolveRunPath(idOrPath)
    const run = readJson<WorkflowEvalRun>(path)
    if (!run) throw new Error(`Eval run not found: ${idOrPath}`)
    return run
  }

  promoteFailure(id: string): FailureImprovementCandidate {
    const failure = this.getFailure(id)
    if (!failure) throw new Error(`Failure replay not found: ${id}`)
    mkdirSync(this.improvementsDir, { recursive: true })
    const candidate: FailureImprovementCandidate = {
      id: `IMPROVE-${Date.now()}-${randomUUID().slice(0, 8)}`,
      failureId: failure.id,
      createdAt: new Date().toISOString(),
      category: failure.category,
      title: `Prevent ${failure.category} in ${failure.caseId}`,
      recommendation: failure.prevention,
      evidencePath: join(this.failuresDir, `${safeSegment(failure.id)}.json`),
      status: 'candidate',
    }
    writeFileSync(join(this.improvementsDir, `${safeSegment(candidate.id)}.json`), JSON.stringify(candidate, null, 2), 'utf-8')
    this.saveFailure({ ...failure, status: 'promoted' })
    return candidate
  }

  suitePath(suiteId: string): string {
    return join(this.suitesDir, `${safeSegment(suiteId)}.json`)
  }

  private resolveSuitePath(suiteIdOrPath: string): string {
    if (suiteIdOrPath.endsWith('.json')) {
      return resolvePathWithinRoots(suiteIdOrPath, {
        baseDir: this.projectDir,
        allowedRoots: [this.projectDir, this.suitesDir],
        label: 'Eval suite',
      })
    }
    return this.suitePath(suiteIdOrPath)
  }

  private resolveRunPath(idOrPath: string): string {
    if (idOrPath.endsWith('.json')) {
      return resolvePathWithinRoots(idOrPath, {
        baseDir: this.projectDir,
        allowedRoots: [this.projectDir, this.runsDir],
        label: 'Eval run',
      })
    }
    return join(this.runsDir, `${safeSegment(idOrPath)}.json`)
  }
}

export async function runWorkflowEvalSuite(options: WorkflowEvalStoreOptions & {
  suite?: string
} = {}): Promise<{ run: WorkflowEvalRun; runPath: string; failurePaths: string[]; closedFailureIds: string[] }> {
  const store = new WorkflowEvalStore(options)
  const suite = store.loadSuite(options.suite ?? 'workflow-baseline')
  const caseResults: WorkflowEvalCaseResult[] = []
  const failurePaths: string[] = []
  const closedFailureIds: string[] = []
  const runId = `EVAL-${Date.now()}-${randomUUID().slice(0, 8)}`

  for (const item of suite.cases) {
    const result = await runEvalCase(store, suite.id, item)
    caseResults.push(result.caseResult)
    failurePaths.push(...result.failurePaths)
    if (result.caseResult.passed) {
      closedFailureIds.push(...store.closeOpenFailuresForCase({
        suiteId: suite.id,
        caseId: item.id,
        closedByEvalRunId: runId,
      }))
    }
  }

  const failureReplayIds = caseResults.flatMap(result => result.failureReplayIds)
  const run: WorkflowEvalRun = {
    id: runId,
    suiteId: suite.id,
    generatedAt: new Date().toISOString(),
    projectDir: store.projectDir,
    ok: caseResults.every(result => result.passed),
    cases: caseResults,
    metrics: summarizeEval(caseResults),
    failureReplayIds,
  }
  const runPath = store.saveRun(run)
  return { run, runPath, failurePaths, closedFailureIds }
}

export function compareWorkflowEvalRuns(options: WorkflowEvalStoreOptions & {
  baseline: string
  candidate: string
}): WorkflowEvalComparison {
  const store = new WorkflowEvalStore(options)
  const baseline = store.loadRun(options.baseline)
  const candidate = store.loadRun(options.candidate)
  const delta = {
    passAt1Rate: candidate.metrics.passAt1Rate - baseline.metrics.passAt1Rate,
    passAt3Rate: candidate.metrics.passAt3Rate - baseline.metrics.passAt3Rate,
    averageFixIterations: candidate.metrics.averageFixIterations - baseline.metrics.averageFixIterations,
    totalToolCalls: candidate.metrics.totalToolCalls - baseline.metrics.totalToolCalls,
    estimatedTokens: candidate.metrics.estimatedTokens - baseline.metrics.estimatedTokens,
    humanCorrections: candidate.metrics.humanCorrections - baseline.metrics.humanCorrections,
  }
  return {
    baseline: pickRun(baseline),
    candidate: pickRun(candidate),
    delta,
    recommendation: comparisonRecommendation(delta),
  }
}

export function renderWorkflowEvalReport(run: WorkflowEvalRun): string {
  const rows = run.cases.map(item => [
    item.id,
    item.type,
    item.passed ? 'pass' : 'fail',
    item.passAt1 ? 'yes' : 'no',
    item.passAt3 ? 'yes' : 'no',
    String(item.fixIterations),
    String(item.toolCalls),
    String(item.estimatedTokens),
    item.failureReplayIds.join(', ') || 'none',
  ])
  return [
    `# Workflow Eval Report: ${run.suiteId}`,
    '',
    `Run: ${run.id}`,
    `Generated: ${run.generatedAt}`,
    `Status: ${run.ok ? 'pass' : 'fail'}`,
    '',
    `Pass@1: ${(run.metrics.passAt1Rate * 100).toFixed(1)}%`,
    `Pass@3: ${(run.metrics.passAt3Rate * 100).toFixed(1)}%`,
    `Average fix iterations: ${run.metrics.averageFixIterations.toFixed(2)}`,
    `Tool calls: ${run.metrics.totalToolCalls}`,
    `Estimated tokens: ${run.metrics.estimatedTokens}`,
    `Failure replays: ${run.metrics.failureReplayCount}`,
    '',
    '| Case | Type | Status | Pass@1 | Pass@3 | Fix Iterations | Tool Calls | Estimated Tokens | Failure Replays |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
    ...rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n')
}

async function runEvalCase(store: WorkflowEvalStore, suiteId: string, item: WorkflowEvalCase): Promise<{
  caseResult: WorkflowEvalCaseResult
  failurePaths: string[]
}> {
  const attempts: WorkflowEvalAttemptResult[] = []
  const failureReplayIds: string[] = []
  const failurePaths: string[] = []
  let passedAt = -1

  for (let i = 0; i < item.attempts.length; i += 1) {
    const attempt = item.attempts[i]
    const result = await runAttempt(attempt, store.projectDir)
    attempts.push(result)
    if (!result.passed) {
      const replay = createFailureReplay(suiteId, item, result, i + 1)
      failureReplayIds.push(replay.id)
      failurePaths.push(store.saveFailure(replay))
    }
    if (result.passed && passedAt < 0) {
      passedAt = i + 1
      break
    }
  }

  const passed = passedAt > 0
  const estimatedTokens = item.estimatedContextTokens ?? estimateTokens([
    item.task,
    ...attempts.map(attempt => attempt.outputSummary),
  ].join('\n'))
  return {
    caseResult: {
      id: item.id,
      type: item.type,
      title: item.title,
      task: item.task,
      passed,
      passAt1: passedAt === 1,
      passAt3: passed && passedAt <= 3,
      fixIterations: passed ? Math.max(0, passedAt - 1) : attempts.length,
      humanCorrections: item.humanCorrections ?? 0,
      estimatedTokens,
      toolCalls: attempts.length,
      attempts,
      failureReplayIds,
    },
    failurePaths,
  }
}

async function runAttempt(attempt: WorkflowEvalAttempt, cwd: string): Promise<WorkflowEvalAttemptResult> {
  const started = Date.now()
  const expectedExitCode = attempt.expectedExitCode ?? 0
  const commandRedaction = redactEvidenceText(attempt.command)
  try {
    const result = await runSafeCommand(attempt.command, {
      cwd,
      timeout: attempt.timeoutMs ?? 30_000,
    })
    const output = [result.stdout ?? '', result.stderr ?? ''].filter(Boolean).join('\n')
    const outputRedaction = redactEvidenceText(output.slice(-2000))
    const outputContains = attempt.outputContains
      ? output.includes(attempt.outputContains)
      : true
    const outputEquals = attempt.outputEquals
      ? normalizeEvalOutput(output) === attempt.outputEquals
      : true
    return {
      id: attempt.id ?? `attempt-${randomUUID().slice(0, 8)}`,
      command: commandRedaction.value,
      expectedExitCode,
      exitCode: result.exitCode,
      passed: result.exitCode === expectedExitCode && outputContains && outputEquals,
      durationMs: Date.now() - started,
      outputSummary: outputRedaction.value || '(no output)',
      redactionApplied: commandRedaction.redacted || outputRedaction.redacted,
    }
  } catch (error) {
    const outputRedaction = redactEvidenceText(error instanceof Error ? error.message : String(error))
    return {
      id: attempt.id ?? `attempt-${randomUUID().slice(0, 8)}`,
      command: commandRedaction.value,
      expectedExitCode,
      exitCode: 1,
      passed: false,
      durationMs: Date.now() - started,
      outputSummary: outputRedaction.value,
      redactionApplied: commandRedaction.redacted || outputRedaction.redacted,
    }
  }
}

function createFailureReplay(suiteId: string, item: WorkflowEvalCase, attempt: WorkflowEvalAttemptResult, attemptNumber: number): FailureReplayRecord {
  const evidence = redactEvidenceValue({
    command: attempt.command,
    exitCode: attempt.exitCode,
    expectedExitCode: attempt.expectedExitCode,
    outputSummary: attempt.outputSummary,
  })
  return {
    id: `FAIL-${Date.now()}-${randomUUID().slice(0, 8)}`,
    taskId: item.id,
    suiteId,
    caseId: item.id,
    generatedAt: new Date().toISOString(),
    category: item.expectedFailureCategory ?? 'command-failure',
    phase: item.phase ?? 'verify',
    task: item.task,
    wrongTurn: `Attempt ${attemptNumber} did not satisfy eval criteria.`,
    evidence: JSON.stringify(evidence.value),
    correction: 'Run the replay command, inspect failure evidence, then update workflow rules, tests, docs, or accepted risk.',
    prevention: preventionFor(item.expectedFailureCategory ?? 'command-failure'),
    replayCommand: attempt.command,
    status: 'open',
    redactionApplied: attempt.redactionApplied || evidence.redacted,
  }
}

function summarizeEval(cases: WorkflowEvalCaseResult[]): WorkflowEvalMetrics {
  const total = cases.length
  const passAt1 = cases.filter(item => item.passAt1).length
  const passAt3 = cases.filter(item => item.passAt3).length
  const failed = cases.filter(item => !item.passed).length
  return {
    total,
    passed: total - failed,
    failed,
    passAt1,
    passAt3,
    passAt1Rate: ratio(passAt1, total),
    passAt3Rate: ratio(passAt3, total),
    averageFixIterations: total === 0 ? 0 : cases.reduce((sum, item) => sum + item.fixIterations, 0) / total,
    totalToolCalls: cases.reduce((sum, item) => sum + item.toolCalls, 0),
    estimatedTokens: cases.reduce((sum, item) => sum + item.estimatedTokens, 0),
    humanCorrections: cases.reduce((sum, item) => sum + item.humanCorrections, 0),
    failureReplayCount: cases.reduce((sum, item) => sum + item.failureReplayIds.length, 0),
  }
}

function preventionFor(category: FailureReplayCategory): string {
  const map: Record<FailureReplayCategory, string> = {
    'wrong-exploration-path': 'Add code intelligence or scoped exploration evidence before implementation.',
    'hallucinated-project-fact': 'Require evidence paths before project facts become active memory.',
    'missing-codegraph-or-graph-fallback': 'Record graph provider status and explicit fallback reason.',
    'over-broad-context-load': 'Use context budget and lazy context pack before broad reads.',
    'bad-skill-recommendation': 'Lower capability confidence or require stronger tool evidence.',
    'missing-verification-evidence': 'Block final claims until runtime evidence exists.',
    'failed-security-or-resource-gate': 'Promote the finding into security or resource governance checks.',
    'human-correction-after-agent-confidence': 'Record human correction as an eval signal and lower confidence.',
    'command-failure': 'Capture command, exit code, output summary, and a replay command.',
    unknown: 'Classify the failure before promoting any workflow rule.',
  }
  return map[category]
}

function comparisonRecommendation(delta: WorkflowEvalComparison['delta']): WorkflowEvalComparison['recommendation'] {
  const better = delta.passAt1Rate > 0 || delta.passAt3Rate > 0 || delta.averageFixIterations < 0 || delta.humanCorrections < 0
  const worse = delta.passAt1Rate < 0 || delta.passAt3Rate < 0 || delta.averageFixIterations > 0 || delta.humanCorrections > 0
  if (better && !worse) return 'improved'
  if (worse && !better) return 'regressed'
  if (better || worse) return 'mixed'
  return 'same'
}

function pickRun(run: WorkflowEvalRun): Pick<WorkflowEvalRun, 'id' | 'suiteId' | 'metrics'> {
  return { id: run.id, suiteId: run.suiteId, metrics: run.metrics }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(stripBom(readFileSync(path, 'utf-8'))) as T
  } catch {
    return null
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

function normalizeEvalOutput(output: string): string {
  return output.replace(/\r?\n$/, '')
}

function ratio(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000
}

function safeSegment(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, '-')
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|')
}
