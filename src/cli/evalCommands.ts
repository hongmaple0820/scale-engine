// SCALE Engine — Eval CLI Commands
// Extracted from api/cli.ts: workflow eval baseline, failure replay, and comparison commands.

import { defineCommand } from 'citty'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  WorkflowEvalStore,
  compareWorkflowEvalRuns,
  renderWorkflowEvalReport,
  runWorkflowEvalSuite,
} from '../eval/WorkflowEval.js'
import { createBenchmarkFromWorkflowEval, publishBenchmark } from '../eval/BenchmarkPublisher.js'
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
  },
})
