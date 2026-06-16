// SCALE Engine — Tool, Agent, and Team CLI commands
// Extracted from src/api/cli.ts for modularity.

import { defineCommand } from 'citty'
import { resolve } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { SCALE_DIR, PROJECT_DIR, isTruthyFlag, resolveScaleDirForProject } from './engineBootstrap.js'
import { inspectToolCapabilities } from '../tools/ToolCapabilityRegistry.js'
import { evaluateToolEvidenceGate } from '../tools/ToolEvidenceGate.js'
import { ToolEvidenceStore } from '../tools/ToolEvidenceStore.js'
import { ToolOrchestrator } from '../tools/ToolOrchestrator.js'
import { loadToolPolicy, toolPolicyTemplate, type ResolvedToolPolicy, type ToolOrchestrationMode } from '../tools/ToolPolicy.js'
import { createSkillPlan, loadSkillRoutingPolicy } from '../skills/routing/index.js'
import { listLeadershipPresets, renderLeadershipPresetsMarkdown } from '../agents/LeadershipPresets.js'
import { AgentPool } from '../agents/AgentPool.js'
import { PROFESSIONAL_AGENTS, getProfile, listProfiles } from '../agents/profiles.js'
import { createAcpCollaborationPlan, renderAcpCollaborationPlanMarkdown } from '../agents/AcpCollaboration.js'
import { createExternalAgentCatalogPlan, listExternalAgentCatalogs, renderExternalAgentCatalogMarkdown, type ExternalAgentImportMode } from '../agents/ExternalAgentCatalog.js'
import { createAiOsPlan } from '../runtime/AiOsRuntime.js'
import type { GovernanceMode } from '../governance/ProgressiveGovernance.js'
import { createThirdPartyUpdateReport } from '../workflow/UpgradeManager.js'
import { removeWorkflowOpenTask, toolEvidenceRunCompletesOpenTask } from '../workflow/WorkflowOpenTasks.js'
import { WorkflowArtifactWriter } from '../workflow/WorkflowArtifactWriter.js'
import type { TaskArtifactLevel } from '../workflow/TaskArtifactScaffolder.js'

// ============================================================================
// Helpers
// ============================================================================

function normalizeTaskArtifactLevel(value: unknown): TaskArtifactLevel {
  const normalized = String(value ?? 'M').trim().toUpperCase()
  if (normalized === 'S' || normalized === 'M' || normalized === 'L' || normalized === 'CRITICAL') {
    return normalized
  }
  throw new Error(`Invalid task level "${String(value)}"; expected S, M, L, or CRITICAL.`)
}

function normalizeToolMode(value: unknown): ToolOrchestrationMode {
  const normalized = String(value ?? 'evidence-required')
  if (normalized === 'off' || normalized === 'advisory' || normalized === 'evidence-required' || normalized === 'block') return normalized
  return 'evidence-required'
}

function parseToolIds(value: unknown): string[] | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined
  return raw.split(',').map(item => item.trim()).filter(Boolean)
}

function parseCommaList(value: unknown): string[] {
  return parseToolIds(value) ?? []
}

function parsePositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid ${name}: expected a positive integer.`)
  return parsed
}

function normalizeAgentGovernanceMode(value: unknown): GovernanceMode | undefined {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const normalized = String(value).trim()
  if (normalized === 'minimal' || normalized === 'standard' || normalized === 'expanded' || normalized === 'critical') return normalized
  throw new Error(`Invalid --requested-mode "${String(value)}"; expected minimal, standard, expanded, or critical.`)
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)]
}

function createToolExecutionPlanFromArgs(args: Record<string, unknown>) {
  const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
  const level = normalizeTaskArtifactLevel(args.level ?? 'M')
  const skillPolicy = loadSkillRoutingPolicy(projectDir, SCALE_DIR)
  const skillPlan = createSkillPlan({
    taskId: String(args['task-id'] ?? `TOOL-${Date.now()}`),
    taskName: String(args.task ?? 'Tool orchestration task'),
    description: String(args.task ?? ''),
    level,
    files: parseCommaList(args.files),
    services: parseCommaList(args.services),
    policy: skillPolicy,
  })
  const toolPolicy = loadToolPolicy(projectDir, SCALE_DIR)
  const toolIds = uniqueStrings([
    ...skillPlan.requiredSkills,
    ...skillPlan.recommendedSkills,
    ...Object.keys(toolPolicy.tools).filter(toolId => {
      const config = toolPolicy.tools[toolId]
      const domains = new Set(skillPlan.intents.map(intent => intent.domain))
      return config.enabled && (
        config.requiredFor.some(domain => domains.has(domain)) ||
        (config.recommendedFor ?? []).some(domain => domains.has(domain))
      )
    }),
  ])
  const capabilityReport = inspectToolCapabilities({
    projectDir,
    toolIds,
  })
  const orchestrator = new ToolOrchestrator({
    projectDir,
    policy: toolPolicy,
    capabilityReport,
    evidenceStore: new ToolEvidenceStore({ projectDir, scaleDir: SCALE_DIR }),
  })
  return {
    projectDir,
    skillPlan,
    orchestrator,
    plan: orchestrator.plan({ skillPlan }),
    capabilityReport,
  }
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// ============================================================================
// tool command - Skills/MCP/CLI orchestration governance
// ============================================================================

const toolPolicyCommand = defineCommand({
  meta: { name: 'policy', description: 'Show resolved tool orchestration policy' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    mode: { type: 'string', description: 'Render a starter policy mode instead of reading .scale/tools.json' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const policy: ResolvedToolPolicy = args.mode
      ? JSON.parse(toolPolicyTemplate(normalizeToolMode(args.mode))) as ResolvedToolPolicy
      : loadToolPolicy(args.dir, SCALE_DIR)
    if (args.json) {
      console.log(JSON.stringify(policy, null, 2))
      return
    }
    console.log('\nSCALE Tool Policy')
    console.log(`  Mode: ${policy.mode}`)
    console.log(`  Tools: ${Object.keys(policy.tools).length}`)
    for (const [id, config] of Object.entries(policy.tools)) {
      const state = config.enabled ? '[ON]' : '[OFF]'
      console.log(`  ${state} ${id}: requiredFor=${config.requiredFor.join(',') || 'none'}`)
    }
  },
})

const toolDoctorCommand = defineCommand({
  meta: { name: 'doctor', description: 'Check skill, MCP, and CLI tool availability' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    tools: { type: 'string', description: 'Comma-separated tool ids to check' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const report = inspectToolCapabilities({
      projectDir: args.dir,
      toolIds: parseToolIds(args.tools),
    })
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('\nSCALE Tool Doctor')
      console.log(`  Installed: ${report.summary.installed}/${report.summary.total}`)
      for (const entry of report.tools) {
        console.log(`  ${entry.installed ? '[OK]' : '[MISSING]'} ${entry.id}`)
        if (entry.detectedPath) console.log(`    path: ${entry.detectedPath}`)
        if (entry.version) console.log(`    version: ${entry.version}`)
        if (entry.missingReason) console.log(`    reason: ${entry.missingReason}`)
        if (!entry.installed && entry.installHint) console.log(`    install: ${entry.installHint}`)
      }
    }
    if (!report.ok) process.exitCode = 1
  },
})

const toolPlanCommand = defineCommand({
  meta: { name: 'plan', description: 'Create a tool execution plan from task intent' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', required: true, description: 'Task id for evidence linkage' },
    task: { type: 'string', required: true, description: 'Task description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = createToolExecutionPlanFromArgs(args)
    if (args.json) {
      console.log(JSON.stringify(result.plan, null, 2))
      return
    }
    console.log('\nSCALE Tool Plan')
    console.log(`  Task: ${result.plan.taskId}`)
    console.log(`  Mode: ${result.plan.mode}`)
    console.log(`  Steps: ${result.plan.steps.length}`)
    for (const step of result.plan.steps) {
      console.log(`  ${step.status === 'ready' ? '[READY]' : '[MISSING]'} ${step.toolId} (${step.adapter}) required=${step.required}`)
    }
    for (const blocker of result.plan.blockers) console.log(`  [BLOCKER] ${blocker}`)
    for (const warning of result.plan.warnings) console.log(`  [WARN] ${warning}`)
  },
})

const toolRunCommand = defineCommand({
  meta: { name: 'run', description: 'Run or dry-run a tool execution plan and write tool evidence' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', required: true, description: 'Task id for evidence linkage' },
    task: { type: 'string', required: true, description: 'Task description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    'dry-run': { type: 'boolean', default: false, description: 'Plan and record skipped evidence without executing tools' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const result = createToolExecutionPlanFromArgs(args)
    const report = await result.orchestrator.run(result.plan, {
      dryRun: isTruthyFlag(args['dry-run']),
    })
    if (toolEvidenceRunCompletesOpenTask(report)) {
      const writer = new WorkflowArtifactWriter(SCALE_DIR)
      const current = writer.readCurrentState()
      if (current?.taskId === report.taskId) {
        writer.updateCurrentState({
          taskId: report.taskId,
          openTasks: removeWorkflowOpenTask(current.openTasks, 'tool-evidence'),
        })
      }
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log('\nSCALE Tool Run')
      console.log(`  Task: ${report.taskId}`)
      console.log(`  Dry-run: ${report.dryRun}`)
      console.log(`  Evidence: ${report.evidence.length}`)
      for (const record of report.evidence) {
        console.log(`  [${record.status.toUpperCase()}] ${record.tool} -> ${record.id}`)
      }
      for (const blocker of report.blockers) console.log(`  [BLOCKER] ${blocker}`)
      for (const warning of report.warnings) console.log(`  [WARN] ${warning}`)
    }
    if (!report.ok) process.exitCode = 1
  },
})

const toolEvidenceCommand = defineCommand({
  meta: { name: 'evidence', description: 'Check required tool execution evidence for a task' },
  args: {
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'task-id': { type: 'string', required: true, description: 'Task id for evidence linkage' },
    task: { type: 'string', required: true, description: 'Task description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    mode: { type: 'string', description: 'Override tool gate mode: off, advisory, evidence-required, or block' },
    'allow-skipped': { type: 'boolean', default: false, description: 'Allow skipped/manual fallback evidence to satisfy required tools' },
    json: { type: 'boolean', default: false },
  },
  run({ args }) {
    const result = createToolExecutionPlanFromArgs(args)
    const gate = evaluateToolEvidenceGate({
      projectDir: result.projectDir,
      level: normalizeTaskArtifactLevel(args.level ?? 'M'),
      plan: result.plan,
      evidenceStore: new ToolEvidenceStore({ projectDir: result.projectDir, scaleDir: SCALE_DIR }),
      mode: args.mode ? normalizeToolMode(args.mode) : result.plan.mode,
      allowSkipped: isTruthyFlag(args['allow-skipped']),
    })
    if (args.json) {
      console.log(JSON.stringify(gate, null, 2))
    } else {
      console.log('\nSCALE Tool Evidence Gate')
      console.log(`  Task: ${gate.taskId ?? args['task-id']}`)
      console.log(`  Mode: ${gate.mode}`)
      console.log(`  Complete: ${gate.complete}`)
      console.log(`  Required tools: ${gate.requiredTools.join(', ') || 'none'}`)
      for (const item of gate.missing) console.log(`  [MISSING] ${item.toolId}: ${item.reason}`)
      for (const item of gate.failed) console.log(`  [FAILED] ${item.toolId}: ${item.reason}`)
      for (const item of gate.skipped) console.log(`  [SKIPPED] ${item.toolId}: ${item.reason}`)
      for (const item of gate.passed) console.log(`  [PASS] ${item.toolId}: ${item.evidenceId ?? 'evidence'}`)
      for (const warning of gate.warnings) console.log(`  [WARN] ${warning}`)
    }
    if (gate.blocked) process.exitCode = 1
  },
})

const toolOutdatedCommand = defineCommand({
  meta: { name: 'outdated', description: 'List MCP, browser, desktop, and external CLI update surfaces without installing anything' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = createThirdPartyUpdateReport(['cli', 'mcp', 'browser', 'desktop'])
    if (args.json) {
      console.log(JSON.stringify({ ...report, projectDir: resolve(String(args.dir ?? PROJECT_DIR)) }, null, 2))
      return
    }
    console.log('\nSCALE Tool Outdated')
    console.log(`  Policy: ${report.policy}`)
    console.log(`  Tools: ${report.summary.total}`)
    console.log(`  Review required: ${report.reviewRequired}`)
    console.log(`  Blocked: ${report.summary.blocked}`)
    for (const entry of report.entries) {
      console.log(`  [${entry.updatePolicy}] ${entry.id} category=${entry.category} trust=${entry.trust} latest=${entry.latestVersion}`)
      if (entry.source) console.log(`    source: ${entry.source}`)
      console.log(`    reason: ${entry.reason}`)
    }
  },
})

export const toolCommand = defineCommand({
  meta: { name: 'tool', description: 'Skills, MCP, browser, desktop, and external CLI governance' },
  subCommands: { policy: toolPolicyCommand, doctor: toolDoctorCommand, plan: toolPlanCommand, run: toolRunCommand, evidence: toolEvidenceCommand, outdated: toolOutdatedCommand },
})

// ============================================================================
// agent commands — Multi-Agent 协作系统 (Phase 9)
// ============================================================================

const agentPool = new AgentPool()

const agentSpawn = defineCommand({
  meta: { name: 'spawn', description: 'Spawn a new agent instance' },
  args: {
    profile: { type: 'positional', required: true, description: 'Agent profile ID (e.g., frontend-agent)' },
  },
  async run({ args }) {
    const profile = getProfile(args.profile)
    if (!profile) {
      console.error(`Profile not found: ${args.profile}`)
      console.log(`Available profiles: ${listProfiles().join(', ')}`)
      process.exit(1)
    }
    const agent = agentPool.spawn(args.profile)
    console.log(JSON.stringify({ ok: true, agentId: agent.id, profile: agent.profile.name, status: agent.status }, null, 2))
  },
})

const agentList = defineCommand({
  meta: { name: 'list', description: 'List all agent instances' },
  args: {},
  async run() {
    const agents = agentPool.listAll()
    if (agents.length === 0) {
      console.log('No agent instances spawned.')
      return
    }
    console.log(`\n🤖 Agent Instances (${agents.length})`)
    console.log('──────────────────────────────────────────────')
    for (const a of agents) {
      const statusEmoji = { idle: '💤', running: '🔄', blocked: '🚫', completed: '✅', failed: '❌', recycled: '♻️' }[a.status]
      console.log(`  ${statusEmoji} ${a.id} (${a.profile.name})`)
      if (a.assignedTask) console.log(`     Task: ${a.assignedTask}`)
    }
  },
})

const agentProfiles = defineCommand({
  meta: { name: 'profiles', description: 'List available agent profiles' },
  args: {},
  async run() {
    console.log(`\n📋 Agent Profiles (${PROFESSIONAL_AGENTS.length})`)
    console.log('──────────────────────────────────────────────')
    for (const p of PROFESSIONAL_AGENTS) {
      const modelEmoji = { fast: '⚡', balanced: '⚖️', powerful: '🧠' }[p.preferredModel]
      console.log(`  ${modelEmoji} ${p.id} — ${p.name}`)
      console.log(`     Role: ${p.inheritsRole} · Domain: ${p.domain}`)
      console.log(`     Capabilities: ${p.capabilities.slice(0, 3).join(', ')}...`)
    }
  },
})

const agentLeaders = defineCommand({
  meta: { name: 'leaders', description: 'List SCALE leader presets such as CEO and CTO' },
  args: {
    output: { type: 'string', alias: 'o', description: 'Write markdown guide to file' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const presets = listLeadershipPresets()
    if (args.json) {
      console.log(JSON.stringify(presets, null, 2))
      return
    }
    const markdown = renderLeadershipPresetsMarkdown()
    if (args.output) {
      const outputPath = resolve(PROJECT_DIR, args.output)
      ensureDir(resolve(outputPath, '..'))
      writeFileSync(outputPath, markdown, 'utf-8')
      console.log(`[OK] 领导者角色指南已生成: ${outputPath}`)
      return
    }
    console.log(markdown)
  },
})

const agentCatalog = defineCommand({
  meta: { name: 'catalog', description: 'Show external agent role catalogs such as agency-agents-zh' },
  args: {
    catalog: { type: 'string', default: 'agency-agents-zh', description: 'External catalog id' },
    mode: { type: 'string', description: 'Import mode: reference-only, convert-to-yaml, or install-to-adapter' },
    tools: { type: 'string', description: 'Comma-separated tool ids to include' },
    'target-dir': { type: 'string', description: 'Target directory for converted external agents' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const plan = createExternalAgentCatalogPlan({
      catalogId: String(args.catalog ?? 'agency-agents-zh'),
      mode: args.mode ? String(args.mode) as ExternalAgentImportMode : undefined,
      tools: parseCommaList(args.tools),
      targetDir: args['target-dir'] ? String(args['target-dir']) : undefined,
    })
    if (args.json) {
      console.log(JSON.stringify({
        catalogs: listExternalAgentCatalogs(),
        plan,
      }, null, 2))
      return
    }
    console.log(renderExternalAgentCatalogMarkdown(plan.catalog))
    console.log('Adoption Plan')
    console.log(`  Mode: ${plan.mode}`)
    console.log(`  Target: ${plan.targetDir}`)
    console.log(`  Mapped tools: ${plan.mappedTools.map(tool => tool.toolId).join(', ') || 'none'}`)
    console.log(`  External-only tools: ${plan.externalOnlyTools.map(tool => tool.toolId).join(', ') || 'none'}`)
    for (const step of plan.steps) console.log(`  step: ${step}`)
    for (const gate of plan.gates) console.log(`  gate: ${gate}`)
    for (const warning of plan.warnings) console.log(`  warning: ${warning}`)
  },
})

const agentAcpPlan = defineCommand({
  meta: { name: 'acp-plan', description: 'Create an ACP-first collaboration plan across agent platforms' },
  args: {
    task: { type: 'string', required: true, description: 'Task or collaboration goal' },
    platforms: { type: 'string', description: 'Comma-separated platforms, e.g. codex,claude-code,gemini-cli' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const plan = createAcpCollaborationPlan({
      task: String(args.task),
      platforms: parseCommaList(args.platforms),
    })
    if (args.json) {
      console.log(JSON.stringify(plan, null, 2))
      return
    }
    console.log(renderAcpCollaborationPlanMarkdown(plan))
  },
})

const agentPlan = defineCommand({
  meta: { name: 'plan', description: 'Predict agent roles, DAG handoffs, review gates, and token budget for a task' },
  args: {
    dir: { type: 'string', default: PROJECT_DIR, description: 'Project directory' },
    'task-id': { type: 'string', description: 'Task id' },
    task: { type: 'string', required: true, description: 'Task or requirement description' },
    level: { type: 'string', default: 'M', description: 'Task level: S, M, L, or CRITICAL' },
    files: { type: 'string', description: 'Comma-separated changed or target files' },
    services: { type: 'string', description: 'Comma-separated affected services' },
    budget: { type: 'string', description: 'Token budget used to allocate per-agent context' },
    'requested-mode': { type: 'string', description: 'Requested governance mode: minimal, standard, expanded, or critical' },
    json: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const projectDir = resolve(String(args.dir ?? PROJECT_DIR))
    const scaleDir = resolveScaleDirForProject(projectDir)
    const plan = await createAiOsPlan({
      projectDir,
      scaleDir,
      taskId: args['task-id'] ? String(args['task-id']) : undefined,
      task: String(args.task),
      level: normalizeTaskArtifactLevel(args.level),
      files: parseCommaList(args.files),
      services: parseCommaList(args.services),
      budget: parsePositiveInt(args.budget, '--budget'),
      requestedMode: normalizeAgentGovernanceMode(args['requested-mode']),
    })
    const report = {
      version: plan.version,
      generatedAt: plan.generatedAt,
      task: plan.task,
      governance: {
        effectiveMode: plan.governance.effectiveMode,
        workflowProfile: plan.adaptiveWorkflow.profile,
        evaluatorRisk: plan.evaluator.riskLevel,
      },
      toolStrategy: plan.toolStrategy.summary,
      agentCollaboration: plan.agentCollaboration,
      recommendations: plan.agentCollaboration.recommendations,
    }
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    console.log('SCALE Agent Collaboration Plan')
    console.log(`  Task: ${report.task.taskId ?? 'n/a'} ${report.task.task}`)
    console.log(`  Governance: ${report.governance.effectiveMode}; workflow ${report.governance.workflowProfile}; evaluator ${report.governance.evaluatorRisk}`)
    console.log(`  Mode: ${report.agentCollaboration.mode}`)
    console.log(`  Roles: ${report.agentCollaboration.summary.totalRoles}; required ${report.agentCollaboration.summary.requiredRoles}; reviewers ${report.agentCollaboration.summary.reviewerRoles}`)
    console.log(`  Review gates: ${report.agentCollaboration.summary.reviewGateCount}; handoffs ${report.agentCollaboration.summary.handoffCount}`)
    console.log(`  Budget: ${report.agentCollaboration.budget.assignedTokens}/${report.agentCollaboration.budget.totalTokens} assigned; reserve ${report.agentCollaboration.budget.reserveTokens}`)
    for (const role of report.agentCollaboration.roles) {
      console.log(`  - ${role.profileId}: ${role.responsibility}, ${role.required ? 'required' : 'advisory'}, ${role.budgetTokens} tokens`)
    }
    for (const recommendation of report.recommendations) console.log(`  recommendation: ${recommendation}`)
  },
})

export const agentCommand = defineCommand({
  meta: { name: 'agent', description: 'Multi-Agent system management' },
  subCommands: { plan: agentPlan, spawn: agentSpawn, list: agentList, profiles: agentProfiles, leaders: agentLeaders, catalog: agentCatalog, 'acp-plan': agentAcpPlan },
})

// ============================================================================
// team commands — 团队协作 (Phase 9)
// ============================================================================

const teamCreate = defineCommand({
  meta: { name: 'create', description: 'Create an agent team for a task' },
  args: {
    profiles: { type: 'string', required: true, description: 'Comma-separated profile IDs' },
    task: { type: 'string', description: 'Task description' },
  },
  async run({ args }) {
    const profileIds = args.profiles.split(',').map(p => p.trim())
    const agents = []
    for (const profileId of profileIds) {
      const profile = getProfile(profileId)
      if (!profile) {
        console.error(`Profile not found: ${profileId}`)
        process.exit(1)
      }
      agents.push(agentPool.spawn(profileId))
    }
    const teamId = `TEAM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    console.log(JSON.stringify({
      ok: true,
      teamId,
      agents: agents.map(a => ({ id: a.id, profile: a.profile.name })),
      leader: agents[0].profile.name,
      description: args.task,
    }, null, 2))
  },
})

const teamStatus = defineCommand({
  meta: { name: 'status', description: 'Show team status' },
  args: {
    team: { type: 'positional', required: true, description: 'Team ID' },
  },
  async run({ args }) {
    // Simplified: show all agents in pool
    const agents = agentPool.listAll()
    const running = agents.filter(a => a.status === 'running').length
    const completed = agents.filter(a => a.status === 'completed').length
    console.log(JSON.stringify({
      teamId: args.team,
      total: agents.length,
      running,
      completed,
      failed: agents.filter(a => a.status === 'failed').length,
      agents: agents.map(a => ({ id: a.id, status: a.status })),
    }, null, 2))
  },
})

export const teamCommand = defineCommand({
  meta: { name: 'team', description: 'Agent team orchestration' },
  subCommands: { create: teamCreate, status: teamStatus },
})
