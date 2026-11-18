// SCALE Engine — Eval CLI Commands
// Extracted from api/cli.ts: workflow eval baseline, failure replay, and comparison commands.

import { createHash } from 'node:crypto'
import { defineCommand } from 'citty'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import {
  WorkflowEvalStore,
  compareWorkflowEvalRuns,
  renderWorkflowEvalReport,
  runWorkflowEvalSuite,
} from '../eval/WorkflowEval.js'
import { createBenchmarkFromWorkflowEval, publishBenchmark } from '../eval/BenchmarkPublisher.js'
import { PersistentRuleMaturityStore } from '../evolution/RuleMaturityStore.js'
import { resolvePathWithinRoots } from '../core/pathSafety.js'
import { runGoldenSuite, type GoldenSuite } from '../eval/GoldenEval.js'
import { PROJECT_DIR, isTruthyFlag, resolveScaleDirForProject } from './engineBootstrap.js'
import { SCALE_ENGINE_VERSION } from '../version.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSinceDays(value: unknown): number | undefined {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text === 'all') return undefined
  const match = text.match(/^(\d+)(d|day|days)?$/)
  if (!match) return undefined
  const days = Number.parseInt(match[1], 10)
  return Number.isFinite(days) && days > 0 ? days : undefined
}

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

const evalInit = defineCommand({
  meta: { name: 'init', description: 'Create a lightweight workflow eval suite under .scale/evals' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    suite: { type: 'string', default: 'workflow-baseline', description: 'Suite id' },
    force: { type: 'boolean', default: false, description: 'Overwrite the existing suite file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const result = store.initSuite(String(args.suite ?? 'workflow-baseline'), isTruthyFlag(args.force))
    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }
    console.log(`SCALE Workflow Eval Suite: ${result.written ? 'written' : 'exists'}`)
    console.log(`  Suite: ${result.suite.id}`)
    console.log(`  Path: ${result.path}`)
    console.log(`  Cases: ${result.suite.cases.length}`)
  },
})

const evalRun = defineCommand({
  meta: { name: 'run', description: 'Run a workflow eval suite and preserve failure replay artifacts' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    suite: { type: 'string', default: 'workflow-baseline', description: 'Suite id or JSON path' },
    'publish-benchmark': { type: 'boolean', default: false, description: 'Publish eval run metrics through BenchmarkPublisher' },
    'benchmark-output': { type: 'string', description: 'Benchmark output directory (default: .scale/benchmarks/eval)' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const result = await runWorkflowEvalSuite({
      projectDir,
      scaleDir,
      suite: String(args.suite ?? 'workflow-baseline'),
    })
    const benchmarkPath = args['publish-benchmark']
      ? publishBenchmark(
          createBenchmarkFromWorkflowEval(result.run, SCALE_ENGINE_VERSION),
          args['benchmark-output']
            ? resolve(projectDir, String(args['benchmark-output']))
            : resolve(scaleDir, 'benchmarks', 'eval'),
        )
      : undefined
    if (args.json) {
      console.log(JSON.stringify(benchmarkPath ? { ...result, benchmarkPath } : result, null, 2))
      if (!result.run.ok) process.exitCode = 1
      return
    }
    console.log(`SCALE Workflow Eval: ${result.run.ok ? 'PASS' : 'FAIL'}`)
    console.log(`  Run: ${result.run.id}`)
    console.log(`  Suite: ${result.run.suiteId}`)
    console.log(`  Pass@1: ${(result.run.metrics.passAt1Rate * 100).toFixed(1)}%`)
    console.log(`  Pass@3: ${(result.run.metrics.passAt3Rate * 100).toFixed(1)}%`)
    console.log(`  Tool calls: ${result.run.metrics.totalToolCalls}`)
    console.log(`  Estimated tokens: ${result.run.metrics.estimatedTokens}`)
    console.log(`  Failures: ${result.run.metrics.failureReplayCount}`)
    console.log(`  Closed failures: ${result.closedFailureIds.length}`)
    console.log(`  Run path: ${result.runPath}`)
    if (benchmarkPath) console.log(`  Benchmark path: ${benchmarkPath}`)
    for (const failurePath of result.failurePaths) console.log(`  Failure replay: ${failurePath}`)
    if (!result.run.ok) process.exitCode = 1
  },
})

const evalCompare = defineCommand({
  meta: { name: 'compare', description: 'Compare two workflow eval runs by pass rate, iterations, tool calls, and token estimate' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    baseline: { type: 'string', required: true, description: 'Baseline run id or JSON path' },
    candidate: { type: 'string', required: true, description: 'Candidate run id or JSON path' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const comparison = compareWorkflowEvalRuns({
      projectDir,
      scaleDir,
      baseline: String(args.baseline),
      candidate: String(args.candidate),
    })
    if (args.json) {
      console.log(JSON.stringify(comparison, null, 2))
      return
    }
    console.log(`SCALE Workflow Eval Compare: ${comparison.recommendation}`)
    console.log(`  Baseline: ${comparison.baseline.id}`)
    console.log(`  Candidate: ${comparison.candidate.id}`)
    console.log(`  Delta Pass@1: ${(comparison.delta.passAt1Rate * 100).toFixed(1)}%`)
    console.log(`  Delta Pass@3: ${(comparison.delta.passAt3Rate * 100).toFixed(1)}%`)
    console.log(`  Delta fix iterations: ${comparison.delta.averageFixIterations.toFixed(2)}`)
    console.log(`  Delta tool calls: ${comparison.delta.totalToolCalls}`)
    console.log(`  Delta estimated tokens: ${comparison.delta.estimatedTokens}`)
    console.log(`  Delta human corrections: ${comparison.delta.humanCorrections}`)
  },
})

const evalReport = defineCommand({
  meta: { name: 'report', description: 'Render a Markdown workflow eval report from a saved run' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    run: { type: 'string', required: true, description: 'Run id or JSON path' },
    output: { type: 'string', alias: 'o', description: 'Write report to a Markdown file' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({ projectDir, scaleDir })
    const run = store.loadRun(String(args.run))
    const markdown = renderWorkflowEvalReport(run)
    const outputPath = args.output ? resolve(projectDir, String(args.output)) : undefined
    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, markdown, 'utf-8')
    }
    if (args.json) {
      console.log(JSON.stringify({ runId: run.id, outputPath, markdown }, null, 2))
      return
    }
    if (outputPath) console.log(`Workflow eval report written: ${outputPath}`)
    else console.log(markdown)
  },
})

const evalFailures = defineCommand({
  meta: { name: 'failures', description: 'List failure replay records for workflow improvement' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Filter by task/case id' },
    since: { type: 'string', default: '30d', description: 'Window such as 30d; use all for no date filter' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const failures = store.listFailures({
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      sinceDays: parseSinceDays(args.since),
    })
    if (args.json) {
      console.log(JSON.stringify({ count: failures.length, failures }, null, 2))
      return
    }
    console.log(`SCALE Failure Replays: ${failures.length}`)
    for (const failure of failures) {
      console.log(`  [${failure.status}] ${failure.id} ${failure.category} task=${failure.taskId}`)
      console.log(`    prevention: ${failure.prevention}`)
    }
  },
})

const evalReplay = defineCommand({
  meta: { name: 'replay', description: 'Show failure replay records by failure id or task id' },
  args: {
    id: { type: 'positional', description: 'Failure replay id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task/case id to replay' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const failures = args.id
      ? [store.getFailure(String(args.id))].filter(Boolean)
      : store.listFailures({ taskId: args['task-id'] ? String(args['task-id']) : undefined })
    if (args.json) {
      console.log(JSON.stringify({ count: failures.length, failures }, null, 2))
      if (failures.length === 0) process.exitCode = 1
      return
    }
    if (failures.length === 0) {
      console.log('No failure replay records found.')
      process.exitCode = 1
      return
    }
    for (const failure of failures) {
      if (!failure) continue
      console.log(`Failure Replay: ${failure.id}`)
      console.log(`  Task: ${failure.task}`)
      console.log(`  Category: ${failure.category}`)
      console.log(`  Phase: ${failure.phase}`)
      console.log(`  Wrong turn: ${failure.wrongTurn}`)
      console.log(`  Evidence: ${failure.evidence}`)
      console.log(`  Correction: ${failure.correction}`)
      console.log(`  Prevention: ${failure.prevention}`)
      if (failure.replayCommand) console.log(`  Replay command: ${failure.replayCommand}`)
    }
  },
})

const evalPromoteFailure = defineCommand({
  meta: { name: 'promote-failure', description: 'Promote a failure replay into a workflow improvement candidate' },
  args: {
    id: { type: 'positional', required: true, description: 'Failure replay id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const store = new WorkflowEvalStore({
      projectDir,
      scaleDir,
    })
    const candidate = store.promoteFailure(String(args.id))
    if (args.json) {
      console.log(JSON.stringify(candidate, null, 2))
      return
    }
    console.log(`Workflow improvement candidate: ${candidate.id}`)
    console.log(`  Failure: ${candidate.failureId}`)
    console.log(`  Category: ${candidate.category}`)
    console.log(`  Recommendation: ${candidate.recommendation}`)
  },
})

const evalImprovements = defineCommand({
  meta: { name: 'improvements', description: 'List workflow improvement candidates and review decisions' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const store = new WorkflowEvalStore({ projectDir, scaleDir: resolveScaleDirForProject(projectDir) })
    const improvements = store.listImprovements()
    if (args.json) {
      console.log(JSON.stringify({ count: improvements.length, improvements }, null, 2))
      return
    }
    console.log(`SCALE Workflow Improvements: ${improvements.length}`)
    for (const item of improvements) {
      console.log(`  [${item.status}]${item.shadowStatus ? ` [shadow:${item.shadowStatus}]` : ''} ${item.id} failure=${item.failureId}`)
      if (item.reviews?.length) console.log(`    reviewed by ${item.reviews[item.reviews.length - 1].reviewer}: ${item.reviews[item.reviews.length - 1].rationale}`)
    }
  },
})

const evalReviewImprovement = defineCommand({
  meta: { name: 'review-improvement', description: 'Accept or reject a workflow improvement candidate with an auditable rationale' },
  args: {
    id: { type: 'positional', required: true, description: 'Improvement candidate id' },
    decision: { type: 'string', required: true, description: 'accept or reject' },
    reviewer: { type: 'string', required: true, description: 'Reviewer identity' },
    rationale: { type: 'string', required: true, description: 'Reason for the decision' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const decision = String(args.decision).toLowerCase()
    if (decision !== 'accept' && decision !== 'reject') {
      throw new Error('Decision must be either accept or reject')
    }
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const store = new WorkflowEvalStore({ projectDir, scaleDir: resolveScaleDirForProject(projectDir) })
    const candidate = store.reviewImprovement({
      id: String(args.id),
      decision: decision === 'accept' ? 'accepted' : 'rejected',
      reviewer: String(args.reviewer),
      rationale: String(args.rationale),
    })
    if (args.json) {
      console.log(JSON.stringify(candidate, null, 2))
      return
    }
    console.log(`Workflow improvement ${candidate.status}: ${candidate.id}`)
    console.log(`  Reviewer: ${candidate.reviews?.[candidate.reviews.length - 1]?.reviewer}`)
    console.log(`  Rationale: ${candidate.reviews?.[candidate.reviews.length - 1]?.rationale}`)
    if (candidate.shadowStatus) console.log('  Shadow replay: pending (not executed automatically)')
    console.log('  Production policies and hooks were not modified.')
  },
})

const evalShadowInit = defineCommand({
  meta: { name: 'shadow-init', description: 'Create a persistent non-blocking Shadow maturity record from an accepted improvement' },
  args: {
    id: { type: 'positional', required: true, description: 'Accepted improvement candidate id' },
    rollback: { type: 'string', required: true, description: 'Documented rollback procedure' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const evalStore = new WorkflowEvalStore({ projectDir, scaleDir })
    const candidate = evalStore.getImprovement(String(args.id))
    if (!candidate) throw new Error(`Workflow improvement candidate not found: ${String(args.id)}`)
    if (candidate.status !== 'accepted') {
      throw new Error('Only an accepted improvement candidate can enter Shadow maturity tracking')
    }
    const sourceFailure = evalStore.getFailure(candidate.failureId)
    if (!sourceFailure || sourceFailure.id !== candidate.failureId) {
      throw new Error(`Source failure evidence is missing or invalid for improvement candidate: ${candidate.id}`)
    }
    const store = new PersistentRuleMaturityStore({ projectDir, scaleDir })
    const record = store.create({
      ruleId: candidate.id,
      rollback: String(args.rollback),
      defectEvidenceIds: [candidate.failureId],
    })
    if (args.json) {
      console.log(JSON.stringify({ record, note: 'Evidence tracking only; no replay executed and no production policy or hook changed.' }, null, 2))
      return
    }
    console.log(`Shadow maturity record created: ${record.ruleId}`)
    console.log('  Stage: shadow (non-blocking)')
    console.log('  Replay: not executed; submit observed evidence with shadow-hit')
    console.log('  Production policies and hooks were not modified.')
  },
})

const evalShadowHit = defineCommand({
  meta: { name: 'shadow-hit', description: 'Record one externally observed Shadow evaluation with unique evidence' },
  args: {
    id: { type: 'positional', required: true, description: 'Shadow rule id (improvement candidate id)' },
    'evidence-file': { type: 'string', required: true, description: 'Reviewable evidence artifact path within the project directory' },
    'false-positive': { type: 'boolean', default: false, description: 'Mark this observation as a false positive' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const evidencePath = resolvePathWithinRoots(String(args['evidence-file']), {
      baseDir: projectDir,
      allowedRoots: [projectDir],
      label: 'Shadow evidence',
    })
    if (!existsSync(evidencePath) || !statSync(evidencePath).isFile()) {
      throw new Error('Shadow evidence must be an existing regular file')
    }
    const evidenceStat = statSync(evidencePath)
    if (evidenceStat.size > 10 * 1024 * 1024) {
      throw new Error('Shadow evidence file exceeds the 10 MiB limit')
    }
    const digest = createHash('sha256').update(readFileSync(evidencePath)).digest('hex')
    const evidenceId = `sha256:${digest}`
    const store = new PersistentRuleMaturityStore({ projectDir, scaleDir })
    const record = store.recordHit({
      ruleId: String(args.id),
      evidenceId,
      falsePositive: Boolean(args['false-positive']),
    })
    const evidenceArtifact = { path: relative(projectDir, evidencePath), sha256: digest }
    if (args.json) {
      console.log(JSON.stringify({ record, evidenceArtifact }, null, 2))
      return
    }
    console.log(`Shadow evidence recorded: ${record.ruleId}`)
    console.log(`  Artifact: ${evidenceArtifact.path}`)
    console.log(`  SHA-256: ${digest}`)
    console.log(`  Hits: ${record.shadowHits}`)
    console.log(`  False positives: ${record.falsePositiveCount}`)
  },
})

const evalShadowStatus = defineCommand({
  meta: { name: 'shadow-status', description: 'Show persistent Shadow maturity evidence' },
  args: {
    id: { type: 'positional', required: true, description: 'Shadow rule id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const store = new PersistentRuleMaturityStore({ projectDir, scaleDir: resolveScaleDirForProject(projectDir) })
    const record = store.get(String(args.id))
    if (!record) throw new Error(`Shadow maturity record not found: ${String(args.id)}`)
    if (args.json) {
      console.log(JSON.stringify(record, null, 2))
      return
    }
    console.log(`Shadow maturity: ${record.ruleId}`)
    console.log(`  Stage: ${record.stage}`)
    console.log(`  Hits: ${record.shadowHits}`)
    console.log(`  False positives: ${record.falsePositiveCount}`)
    console.log(`  Evidence ids: ${record.evidenceIds.join(', ') || '(none)'}`)
    console.log(`  Rollback: ${record.rollback}`)
  },
})

const evalShadowEvaluate = defineCommand({
  meta: { name: 'shadow-evaluate', description: 'Evaluate Shadow evidence against rule maturity thresholds without promoting a rule' },
  args: {
    id: { type: 'positional', required: true, description: 'Shadow rule id' },
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const store = new PersistentRuleMaturityStore({ projectDir, scaleDir: resolveScaleDirForProject(projectDir) })
    const decision = store.evaluate(String(args.id))
    if (args.json) {
      console.log(JSON.stringify({ ...decision, note: 'Eligibility only; no stage promotion, hook generation, or production policy change.' }, null, 2))
      return
    }
    console.log(`Shadow maturity eligible: ${decision.eligible ? 'yes' : 'no'}`)
    console.log(`  Next review stage: ${decision.nextStage}`)
    for (const blocker of decision.blockers) console.log(`  Blocker: ${blocker}`)
    console.log('  No stage promotion or production policy change was performed.')
  },
})

const evalGolden = defineCommand({
  meta: { name: 'golden', description: 'P1-D: run the deterministic golden artifact-contract suite (CI merge gate)' },
  args: {
    suite: { type: 'string', default: 'evals/golden/artifact-contracts.json', description: 'Golden suite JSON path' },
    dir: { type: 'string', default: process.cwd(), description: 'Project root the assertions run against' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const suitePath = resolve(String(args.suite))
    if (!existsSync(suitePath)) throw new Error(`golden suite not found: ${suitePath}`)
    const suite = JSON.parse(readFileSync(suitePath, 'utf-8')) as GoldenSuite
    const report = runGoldenSuite(suite, resolve(String(args.dir)))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) process.exitCode = 1
      return
    }
    console.log(`\nGolden suite: ${report.suiteName} (${report.suiteId})`)
    for (const c of report.cases) {
      console.log(`  [${c.passed ? 'OK' : 'FAIL'}] ${c.id} — ${c.description}`)
      if (!c.passed) for (const a of c.assertions) if (!a.passed) console.log(`       x ${a.detail}`)
    }
    console.log(`\n  ${report.passedAssertions}/${report.totalAssertions} assertions passed (${report.cases.filter(c => c.passed).length}/${report.cases.length} cases)`)
    if (!report.ok) process.exitCode = 1
  },
})

// ---------------------------------------------------------------------------
// Composite eval command (exported)
// ---------------------------------------------------------------------------

export const evalCommand = defineCommand({
  meta: { name: 'eval', description: 'Workflow eval harness, pass@k metrics, and failure replay' },
  subCommands: {
    init: evalInit,
    run: evalRun,
    compare: evalCompare,
    report: evalReport,
    failures: evalFailures,
    replay: evalReplay,
    'promote-failure': evalPromoteFailure,
    improvements: evalImprovements,
    'review-improvement': evalReviewImprovement,
    'shadow-init': evalShadowInit,
    'shadow-hit': evalShadowHit,
    'shadow-status': evalShadowStatus,
    'shadow-evaluate': evalShadowEvaluate,
    golden: evalGolden,
  },
})
