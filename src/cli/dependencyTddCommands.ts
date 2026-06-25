// SCALE Engine — Dependency, TDD, Stats, and Metrics Commands
import { defineCommand } from 'citty'
import { getEngine, SCALE_DIR, PROJECT_DIR, isTruthyFlag, commandEvidence } from './engineBootstrap.js'
import { auditDependencies } from '../guardrails/DependencyAuditor.js'
import {
  createTddSlice,
  evaluateTddSlice,
  renderTddSliceMarkdown,
} from '../workflow/TddLoop.js'
import { removeWorkflowOpenTask } from '../workflow/WorkflowOpenTasks.js'
import { TaskMetricsStore } from '../workflow/TaskMetricsStore.js'
import { WorkflowArtifactWriter } from '../workflow/WorkflowArtifactWriter.js'
import {
  appendTddSliceArtifact,
} from '../workflow/TaskArtifactScaffolder.js'

function parseCommaList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  return String(value).split(',').map(s => s.trim()).filter(s => s.length > 0)
}

export const dependencyAuditCommand = defineCommand({
  meta: { name: 'audit', description: 'Audit lockfile-scoped dependency supply-chain risk' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    mode: { type: 'string', description: 'Audit mode: compatibility, strict, or offline' },
    'changed-packages': { type: 'string', description: 'Comma-separated package names to audit instead of direct dependencies' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const mode = args.mode === 'compatibility' || args.mode === 'strict' || args.mode === 'offline'
      ? args.mode
      : undefined
    const report = auditDependencies({
      projectDir: args.dir ? String(args.dir) : PROJECT_DIR,
      mode,
      changedPackages: parseCommaList(args['changed-packages']),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`SCALE Dependency Audit: ${report.ok ? 'OK' : 'FAILED'}`)
      console.log(`  Packages audited: ${report.summary.packagesAudited}`)
      console.log(`  Findings: ${report.summary.totalFindings}`)
      console.log(`  Mode: ${report.mode}`)
      for (const finding of report.findings.slice(0, 20)) {
        console.log(`  [${finding.severity}] ${finding.ruleId} ${finding.packageName}${finding.version ? `@${finding.version}` : ''}: ${finding.message}`)
      }
      if (report.findings.length > 20) console.log(`  ... ${report.findings.length - 20} more finding(s)`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

export const dependencyCommand = defineCommand({
  meta: { name: 'dependency', description: 'Supply-chain dependency governance' },
  subCommands: { audit: dependencyAuditCommand },
})

export const tddSliceCommand = defineCommand({
  meta: { name: 'slice', description: 'Create and evaluate a TDD vertical slice' },
  args: {
    'task-id': { type: 'string', required: true },
    behavior: { type: 'string', required: true },
    'public-interface': { type: 'string', required: true },
    'failing-test': { type: 'string', required: true },
    'test-file': { type: 'string', required: true },
    'impl-files': { type: 'string', required: true },
    'red-exit-code': { type: 'string', description: 'Exit code from the RED command' },
    'red-summary': { type: 'string', description: 'Short RED output summary' },
    'green-exit-code': { type: 'string', description: 'Exit code from the GREEN command' },
    'green-summary': { type: 'string', description: 'Short GREEN output summary' },
    'refactor-exit-code': { type: 'string', description: 'Exit code from the REFACTOR command' },
    'refactor-summary': { type: 'string', description: 'Short REFACTOR output summary' },
    'artifact-dir': { type: 'string', description: 'Task artifact directory where verification.md should be updated' },
    write: { type: 'boolean', default: false, description: 'Append TDD slice output to the task verification artifact' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const failingTest = String(args['failing-test'])
    const slice = createTddSlice({
      taskId: String(args['task-id']),
      behavior: String(args.behavior),
      publicInterface: String(args['public-interface']),
      failingTestCommand: failingTest,
      testFile: String(args['test-file']),
      implementationFiles: parseCommaList(args['impl-files']),
      redEvidence: commandEvidence(failingTest, args['red-exit-code'], args['red-summary']),
      greenEvidence: commandEvidence(failingTest, args['green-exit-code'], args['green-summary']),
      refactorEvidence: commandEvidence(failingTest, args['refactor-exit-code'], args['refactor-summary']),
    })
    const evaluation = evaluateTddSlice(slice)
    const artifactPath = isTruthyFlag(args.write)
      ? appendTddSliceArtifact({
          projectDir: PROJECT_DIR,
          artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']) : undefined,
          slice,
        }) ?? undefined
      : undefined
    let tddStatePath: string | undefined
    if (slice.redEvidence && slice.greenEvidence && slice.refactorEvidence) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      writer.writeTDDEvidence({
        timestamp: new Date().toISOString(),
        taskId: slice.taskId,
        red: slice.redEvidence.exitCode !== 0,
        green: slice.greenEvidence.exitCode === 0,
        refactor: slice.refactorEvidence.exitCode === 0,
        testFirst: slice.redEvidence.exitCode !== 0,
        testFile: slice.testFile,
        implFile: slice.implementationFiles[0] ?? '',
      })
      writer.updateCurrentState({
        taskId: slice.taskId,
        phase: 'verify',
        artifactsDir: args['artifact-dir'] ? String(args['artifact-dir']).replace(/\\/g, '/') : undefined,
        filesModified: slice.implementationFiles,
        openTasks: removeWorkflowOpenTask(writer.readCurrentState()?.openTasks, 'tdd-slice'),
      })
      tddStatePath = writer.tddEvidencePath(slice.taskId)
    }
    if (args.json) {
      console.log(JSON.stringify({ slice, evaluation, artifactPath, tddStatePath }, null, 2))
      return
    }
    console.log(renderTddSliceMarkdown(slice))
    if (evaluation.blockers.length > 0) {
      console.log('\nBlockers:')
      for (const blocker of evaluation.blockers) console.log(`  - ${blocker}`)
    }
    if (artifactPath) console.log(`\nArtifact: ${artifactPath}`)
    if (tddStatePath) console.log(`TDD state: ${tddStatePath}`)
  },
})

export const tddCommand = defineCommand({
  meta: { name: 'tdd', description: 'TDD vertical slice workflows' },
  subCommands: { slice: tddSliceCommand },
})

export const statsCommand = defineCommand({
  meta: { name: 'stats', description: 'Show engine stats' },
  args: {},
  async run() {
    const { store, eventBus } = getEngine()
    const s = store.stats()
    const events = await eventBus.query({ limit: 1000 })
    console.log(JSON.stringify({ ...s, eventCount: events.length }, null, 2))
  },
})

export const metricsListCommand = defineCommand({
  meta: { name: 'list', description: 'List M/L task workflow metrics' },
  args: {
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const store = new TaskMetricsStore(SCALE_DIR)
    const records = store.list()
    const summary = store.summarize()
    if (args.json) {
      console.log(JSON.stringify({ summary, records }, null, 2))
      return
    }
    console.log('\nWorkflow Metrics')
    console.log(`  Total tasks: ${summary.total}`)
    console.log(`  First-pass verification rate: ${(summary.firstPassRate * 100).toFixed(1)}%`)
    console.log(`  Average fix iterations: ${summary.averageFixIterations.toFixed(2)}`)
    console.log(`  Artifact completeness: ${(summary.artifactCompletenessRate * 100).toFixed(1)}%`)
    for (const record of records.slice(-10)) {
      console.log(`  - ${record.date} ${record.level} ${record.taskName}: ${record.finalGateStatus}`)
    }
  },
})

export const metricsCommand = defineCommand({
  meta: { name: 'metrics', description: 'Inspect workflow task metrics' },
  subCommands: { list: metricsListCommand },
})
