// SCALE Engine — Workflow and Evidence Commands
import { defineCommand } from 'citty'
import { execFileSync } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { SCALE_DIR } from './engineBootstrap.js'
import { recallMemoryProviders, type MemoryProviderRecallReport } from '../memory/MemoryProviders.js'
import { listWorkflowPresets, getPresetsByScenario } from '../workflows/presets.js'
import { EvidenceStore } from '../workflow/EvidenceStore.js'
import { ReleaseDeploymentLedger, type DeploymentRecordInput, type DeploymentStatus } from '../workflow/ReleaseDeploymentLedger.js'
import { createWorkflowEffectivenessReport, renderWorkflowEffectivenessReport } from '../workflow/WorkflowEffectiveness.js'

const DEFAULT_WORKFLOW_MEMORY_QUERY = 'workflow effectiveness memory recall'

export const workflowListCommand = defineCommand({
  meta: { name: 'list', description: 'List all workflow presets' },
  args: {
    scenario: { type: 'string', description: 'Filter by scenario mode (sandbox/standard/critical)' },
    json: { type: 'boolean', default: false, description: 'Output workflow presets as JSON' },
  },
  async run({ args }) {
    const presets = args.scenario
      ? getPresetsByScenario(args.scenario as 'sandbox' | 'standard' | 'critical')
      : listWorkflowPresets()

    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        scenario: args.scenario ?? null,
        count: presets.length,
        presets: presets.map(preset => ({
          id: preset.id,
          name: preset.name,
          nameZh: preset.nameZh,
          description: preset.description,
          scenarioMode: preset.scenarioMode,
          requiredArtifacts: preset.requiredArtifacts,
          steps: preset.steps,
        })),
      }, null, 2))
      return
    }

    if (presets.length === 0) {
      console.log('No workflow presets found.')
      return
    }

    console.log('\n📋 SCALE Engine Workflow Presets')
    console.log('═══════════════════════════════════════════════════════')

    for (const preset of presets) {
      const modeEmoji = { sandbox: '🏖️', standard: '⚙️', critical: '🔒' }[preset.scenarioMode]
      const mandatorySteps = preset.steps.filter((s) => s.isMandatory).length
      const totalSteps = preset.steps.length

      console.log(`\n  ${preset.nameZh} (${preset.id})`)
      console.log(`  ${preset.description}`)
      console.log(`  Mode: ${modeEmoji} ${preset.scenarioMode} · Steps: ${mandatorySteps}/${totalSteps} mandatory`)

      if (preset.requiredArtifacts.length > 0) {
        console.log(`  Requires: ${preset.requiredArtifacts.map((a) => `${a.type}${a.status ? `(${a.status})` : ''}`).join(', ')}`)
      }

      for (const step of preset.steps) {
        const marker = step.isMandatory ? '●' : '○'
        const gate = step.verificationGate ? ` ⊓ ${step.verificationGate}` : ''
        console.log(`    ${marker} ${step.stepId}: ${step.action}${gate}`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════════')
    console.log('\nUsage: scale workflow show <preset-id>')
  },
})

export const workflowEffectivenessCommand = defineCommand({
  meta: { name: 'effectiveness', description: 'Measure workflow effectiveness across gates, evals, memory, skills, and delivery signals' },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    days: { type: 'string', default: '30', description: 'Lookback period in days' },
    'memory-query': { type: 'string', description: 'Read-only provider recall query used to measure memory quality' },
    'skip-memory-recall': { type: 'boolean', default: false, description: 'Skip read-only provider recall probe' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const days = Number.parseInt(String(args.days ?? '30'), 10)
    const memoryRecall = args['skip-memory-recall']
      ? null
      : await recallWorkflowEffectivenessMemory(projectDir, optionalArg(args['memory-query']) ?? DEFAULT_WORKFLOW_MEMORY_QUERY)
    const report = createWorkflowEffectivenessReport({
      projectDir,
      scaleDir: SCALE_DIR,
      lookbackDays: Number.isFinite(days) ? days : 30,
      deps: {
        memoryRecall,
      },
    })

    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }

    process.stdout.write(`${renderWorkflowEffectivenessReport(report)}\n`)
  },
})

async function recallWorkflowEffectivenessMemory(projectDir: string, query: string): Promise<MemoryProviderRecallReport | null> {
  try {
    return await recallMemoryProviders({
      projectDir,
      scaleDir: SCALE_DIR,
      query,
      task: 'workflow effectiveness',
      limit: 5,
    })
  } catch {
    return null
  }
}

export const workflowDeployRecordCommand = defineCommand({
  meta: { name: 'record', description: 'Record a release/deployment event for DORA workflow metrics' },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    service: { type: 'string', default: 'scale-engine', description: 'Service name' },
    environment: { type: 'string', default: 'production', description: 'Deployment environment' },
    status: { type: 'string', default: 'succeeded', description: 'succeeded, failed, or rolled-back' },
    version: { type: 'string', description: 'Released version' },
    'git-tag': { type: 'string', description: 'Infer version, commit, commit timestamp, and release timestamp from a local Git tag' },
    commit: { type: 'string', description: 'Git commit SHA' },
    'commit-time': { type: 'string', description: 'Commit timestamp' },
    'started-at': { type: 'string', description: 'Deployment start timestamp' },
    'completed-at': { type: 'string', description: 'Deployment completion timestamp' },
    'failed-at': { type: 'string', description: 'Failure timestamp for failed/rolled-back deployments' },
    'restored-at': { type: 'string', description: 'Recovery completion timestamp' },
    source: { type: 'string', description: 'manual, ci, release, or ship' },
    evidence: { type: 'string', description: 'Comma-separated evidence paths or URLs' },
    notes: { type: 'string', description: 'Short notes for this deployment event' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const ledger = new ReleaseDeploymentLedger(resolveCliScaleDir(projectDir))
    const gitTag = optionalArg(args['git-tag'])
    const gitTagDefaults = gitTag ? inferDeploymentFromGitTag(projectDir, gitTag) : undefined
    const explicitCommit = optionalArg(args.commit)
    if (gitTagDefaults && explicitCommit && explicitCommit !== gitTagDefaults.commitSha) {
      throw new Error(`Explicit --commit ${explicitCommit} does not match --git-tag ${gitTag} (${gitTagDefaults.commitSha})`)
    }
    const record = ledger.record({
      service: optionalArg(args.service),
      environment: optionalArg(args.environment),
      status: parseDeploymentStatus(args.status),
      version: optionalArg(args.version) ?? gitTagDefaults?.version,
      commitSha: explicitCommit ?? gitTagDefaults?.commitSha,
      commitTimestamp: optionalArg(args['commit-time']) ?? gitTagDefaults?.commitTimestamp,
      startedAt: optionalArg(args['started-at']),
      completedAt: optionalArg(args['completed-at']) ?? gitTagDefaults?.completedAt,
      failedAt: optionalArg(args['failed-at']),
      restoredAt: optionalArg(args['restored-at']),
      source: parseDeploymentSource(args.source, gitTagDefaults ? 'release' : 'manual'),
      evidencePaths: [
        ...(gitTagDefaults?.evidencePaths ?? []),
        ...parseDeployEvidencePaths(args.evidence),
      ],
      notes: combineNotes(optionalArg(args.notes), gitTagDefaults?.notes),
    })

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, record }, null, 2)}\n`)
      return
    }

    process.stdout.write(`Recorded deployment ${record.id} (${record.status}) at ${record.completedAt}\n`)
  },
})

export const workflowDeployListCommand = defineCommand({
  meta: { name: 'list', description: 'List deployment events and summarize DORA workflow metrics' },
  args: {
    dir: { type: 'string', default: process.cwd(), description: 'Project directory' },
    days: { type: 'string', default: '30', description: 'Lookback period in days' },
    service: { type: 'string', description: 'Filter by service' },
    environment: { type: 'string', description: 'Filter by environment' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = String(args.dir ?? process.cwd())
    const days = Number.parseInt(String(args.days ?? '30'), 10)
    const lookbackDays = Number.isFinite(days) ? days : 30
    const query = {
      lookbackDays,
      service: optionalArg(args.service),
      environment: optionalArg(args.environment),
    }
    const ledger = new ReleaseDeploymentLedger(resolveCliScaleDir(projectDir))
    const records = ledger.list(query)
    const metrics = ledger.summarize(query)

    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, metrics, records }, null, 2)}\n`)
      return
    }

    process.stdout.write([
      'SCALE Deployment Ledger',
      `Period: last ${lookbackDays} day(s)`,
      `Records: ${metrics.totalRecords}`,
      `Deployment frequency: ${metrics.deploymentFrequencyPerDay} successful deploys/day`,
      `Lead time: ${metrics.leadTimeHours === null ? 'missing' : `${metrics.leadTimeHours}h`}`,
      `Change failure rate: ${metrics.changeFailureRate === null ? 'missing' : `${(metrics.changeFailureRate * 100).toFixed(1)}%`}`,
      `Restore time: ${metrics.restoreTimeHours === null ? 'missing' : `${metrics.restoreTimeHours}h`}`,
      '',
      ...records.map(record => `  ${record.id}  ${record.service}/${record.environment}  ${record.status}  ${record.version ?? '-'}  ${record.completedAt}`),
    ].join('\n') + '\n')
  },
})

export const workflowDeployCommand = defineCommand({
  meta: { name: 'deploy', description: 'Deployment evidence ledger for workflow effectiveness metrics' },
  subCommands: { record: workflowDeployRecordCommand, list: workflowDeployListCommand },
})

export const workflowCommand = defineCommand({
  meta: { name: 'workflow', description: 'Workflow preset management and effectiveness reporting' },
  subCommands: { list: workflowListCommand, effectiveness: workflowEffectivenessCommand, deploy: workflowDeployCommand },
})

function resolveCliScaleDir(projectDir: string): string {
  return isAbsolute(SCALE_DIR) ? SCALE_DIR : resolve(projectDir, SCALE_DIR)
}

function optionalArg(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized ? normalized : undefined
}

function parseDeploymentStatus(value: unknown): DeploymentStatus {
  const normalized = optionalArg(value) ?? 'succeeded'
  if (normalized === 'succeeded' || normalized === 'failed' || normalized === 'rolled-back') return normalized
  throw new Error(`Invalid deployment status: ${normalized}`)
}

function parseDeploymentSource(value: unknown, fallback: DeploymentRecordInput['source']): DeploymentRecordInput['source'] {
  const normalized = optionalArg(value) ?? fallback
  if (normalized === 'manual' || normalized === 'ci' || normalized === 'release' || normalized === 'ship') return normalized
  throw new Error(`Invalid deployment source: ${normalized}`)
}

function parseDeployEvidencePaths(value: unknown): string[] {
  return optionalArg(value)
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean) ?? []
}

interface GitTagDeploymentDefaults {
  version: string
  commitSha: string
  commitTimestamp?: string
  completedAt?: string
  evidencePaths: string[]
  notes: string
}

function inferDeploymentFromGitTag(projectDir: string, tag: string): GitTagDeploymentDefaults {
  validateGitTagName(projectDir, tag)
  const commitSha = gitOutput(projectDir, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  const commitTimestamp = optionalArg(gitOutput(projectDir, ['show', '-s', '--format=%cI', commitSha]))
  const tagTimestamp = optionalArg(tryGitOutput(projectDir, ['for-each-ref', `refs/tags/${tag}`, '--format=%(creatordate:iso-strict)']))
  return {
    version: tag,
    commitSha,
    commitTimestamp,
    completedAt: tagTimestamp ?? commitTimestamp,
    evidencePaths: [`git:tag:${tag}`],
    notes: `gitTag=${tag}`,
  }
}

function validateGitTagName(projectDir: string, tag: string): void {
  try {
    execFileSync('git', ['check-ref-format', `refs/tags/${tag}`], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 10000,
    })
  } catch {
    throw new Error(`Invalid Git tag name: ${tag}`)
  }
}

function gitOutput(projectDir: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim()
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '').trim()
      : ''
    throw new Error(`Git command failed: git ${args.join(' ')}${stderr ? `: ${stderr}` : ''}`)
  }
}

function tryGitOutput(projectDir: string, args: string[]): string | undefined {
  try {
    return gitOutput(projectDir, args)
  } catch {
    return undefined
  }
}

function combineNotes(...notes: Array<string | undefined>): string | undefined {
  const combined = notes.filter((note): note is string => Boolean(note)).join('; ')
  return combined || undefined
}

export const evidenceListCommand = defineCommand({
  meta: { name: 'list', description: 'List persisted gate evidence records' },
  args: {
    limit: { type: 'string', default: '20', description: 'Maximum number of records' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const store = new EvidenceStore(SCALE_DIR)
    const records = store.listGateResults(parseInt(args.limit, 10) || 20)
    if (args.json) {
      console.log(JSON.stringify(records, null, 2))
      return
    }
    if (records.length === 0) {
      console.log('No evidence records found.')
      return
    }
    console.log('\nSCALE Evidence Records')
    for (const record of records) {
      const status = record.passed ? 'PASS' : record.status
      const blockers = record.blockers.length > 0 ? ` blockers=${record.blockers.length}` : ''
      console.log(`  ${record.id}  ${record.gate}  ${status}  ${new Date(record.createdAt).toISOString()}${blockers}`)
    }
    console.log('\nUsage: scale evidence show <id>')
  },
})

export const evidenceShowCommand = defineCommand({
  meta: { name: 'show', description: 'Show a persisted gate evidence record' },
  args: {
    id: { type: 'positional', required: true },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const store = new EvidenceStore(SCALE_DIR)
    const record = store.getGateResult(args.id)
    if (!record) {
      console.error(`Evidence record not found: ${args.id}`)
      process.exit(1)
    }
    if (args.json) {
      console.log(JSON.stringify(record, null, 2))
      return
    }
    console.log(`\nEvidence: ${record.id}`)
    console.log(`Gate: ${record.gate}`)
    console.log(`Status: ${record.status}`)
    console.log(`Passed: ${record.passed}`)
    console.log(`Created: ${new Date(record.createdAt).toISOString()}`)
    console.log(`Duration: ${record.durationMs}ms`)
    if (record.blockers.length > 0) {
      console.log('\nBlockers:')
      for (const blocker of record.blockers) console.log(`  - ${blocker}`)
    }
    console.log('\nEvidence Items:')
    for (const item of record.evidenceItems) {
      const status = item.passed ? 'PASS' : 'FAIL'
      const target = item.command ?? item.path ?? ''
      console.log(`  - [${status}] ${item.label}${target ? ` (${target})` : ''}`)
      console.log(`    ${item.detail}`)
    }
  },
})

export const evidenceCommand = defineCommand({
  meta: { name: 'evidence', description: 'Persisted gate evidence inspection' },
  subCommands: { list: evidenceListCommand, show: evidenceShowCommand },
})
