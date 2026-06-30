// SCALE Engine — Doctor (W10)
// 环境诊断 + 健康检查
// Usage: scale doctor

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { getBootstrapPlanForProfile, getProfile, type ProfileBootstrapPlan } from '../config/profiles.js'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { computeGovernanceDrift } from '../workflow/GovernanceLock.js'
import { doctorEngineeringStandards } from '../workflow/EngineeringStandards.js'
import { doctorResourceAssets } from '../workflow/ResourceGovernance.js'
import { doctorRuntimeEvidence } from '../runtime/RuntimeDoctor.js'
import { inspectWorkspaceSafety } from '../workflow/WorkspaceSafety.js'
import { inspectCodeIntelligence, type CodeIntelligenceStatusReport } from '../codegraph/CodeIntelligence.js'
import { inspectMemoryProviders, type MemoryProviderStatusReport } from '../memory/MemoryProviders.js'
import { inspectToolCapabilities, type ToolCapabilityReport } from '../tools/ToolCapabilityRegistry.js'
import { inspectBetterSqlite3Runtime } from '../env/EnvironmentDoctor.js'

export interface DiagnosticResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
  fix?: string
  optional?: boolean // Optional checks don't affect overall health
  category?: 'governance' | 'knowledge-graph' | 'runtime' | 'memory'
}

export interface DoctorReport {
  overall: 'healthy' | 'degraded' | 'broken'
  checks: DiagnosticResult[]
  timestamp: number
  bootstrapPlan?: ProfileBootstrapPlan
  knowledgeGraph?: {
    available: boolean
    pythonVersion?: string
    graphifyInstalled?: boolean
    codegraphInstalled?: boolean
    codegraphProjectInitialized?: boolean
  }
  memoryProviders?: {
    available: boolean
    gbrainAvailable: boolean
    hrainAvailable: boolean
    defaultOrder: string[]
    mode: string
  }
}

interface DoctorDeps {
  execSyncImpl?: typeof execSync
  inspectCodeIntelligenceImpl?: typeof inspectCodeIntelligence
  inspectMemoryProvidersImpl?: typeof inspectMemoryProviders
  inspectToolCapabilitiesImpl?: typeof inspectToolCapabilities
}

export class Doctor {
  constructor(
    private projectDir: string = '.',
    private scaleDir: string = '.scale',
    private deps: DoctorDeps = {},
  ) {}

  async diagnose(): Promise<DoctorReport> {
    const checks: DiagnosticResult[] = []
    const bootstrapPlan = this.resolveBootstrapPlan()
    const codeIntelligence = this.inspectCodeIntelligence()
    const memoryProviders = this.inspectMemoryProviders()
    const toolCapabilities = this.inspectToolCapabilities(['graphify', 'codegraph', 'gbrain'])

    checks.push(this.checkScaleDir())
    checks.push(this.checkEventsDir())
    checks.push(this.checkArtifactsDir())
    checks.push(this.checkSettingsJson())
    checks.push(this.checkKnowledgeDoc())
    checks.push(this.checkRulesDir())
    checks.push(this.checkHooksDir())
    checks.push(this.checkNodeVersion())
    checks.push(this.checkArtifactStoreNativeRuntime())
    checks.push(this.checkDiskUsage())
    checks.push(this.checkGitignore())
    const gitWorkspaceCheck = this.checkGitWorkspace()
    checks.push(gitWorkspaceCheck)

    const governanceTemplatesCheck = this.checkGovernanceTemplates()
    const verificationMatrixCheck = this.checkVerificationMatrix()
    const skillRoutingPolicyCheck = this.checkSkillRoutingPolicy()
    const toolPolicyCheck = this.checkToolPolicy()
    const resourcePolicyCheck = this.checkResourcePolicy()
    const engineeringStandardsCheck = gitWorkspaceCheck.status === 'fail'
      ? this.skippedEngineeringStandardsForWorkspaceConflict()
      : this.checkEngineeringStandards()
    const governanceDriftCheck = this.checkGovernanceDrift()
    governanceTemplatesCheck.optional = true
    verificationMatrixCheck.optional = true
    skillRoutingPolicyCheck.optional = true
    toolPolicyCheck.optional = true
    resourcePolicyCheck.optional = true
    engineeringStandardsCheck.optional = true
    governanceDriftCheck.optional = true
    governanceTemplatesCheck.category = 'governance'
    verificationMatrixCheck.category = 'governance'
    skillRoutingPolicyCheck.category = 'governance'
    toolPolicyCheck.category = 'governance'
    resourcePolicyCheck.category = 'governance'
    engineeringStandardsCheck.category = 'governance'
    governanceDriftCheck.category = 'governance'
    checks.push(governanceTemplatesCheck)
    checks.push(verificationMatrixCheck)
    checks.push(skillRoutingPolicyCheck)
    checks.push(toolPolicyCheck)
    checks.push(resourcePolicyCheck)
    checks.push(engineeringStandardsCheck)
    checks.push(governanceDriftCheck)

    const runtimeEvidenceCheck = this.checkRuntimeEvidence()
    runtimeEvidenceCheck.optional = true
    runtimeEvidenceCheck.category = 'runtime'
    checks.push(runtimeEvidenceCheck)

    const configHealthCheck = this.checkConfigHealth()
    configHealthCheck.optional = true
    configHealthCheck.category = 'governance'
    checks.push(configHealthCheck)

    // Optional knowledge graph checks (non-blocking)
    const pythonCheck = this.checkPython(bootstrapPlan)
    const graphifyCheck = this.checkGraphifyCli(toolCapabilities, bootstrapPlan)
    const graphifyArtifactCheck = this.checkGraphifyArtifact(codeIntelligence)
    const codegraphCheck = this.checkCodegraph(toolCapabilities, bootstrapPlan)
    const codegraphProjectCheck = this.checkCodegraphProject(codeIntelligence)
    const memoryRoutingCheck = this.checkMemoryProviders(memoryProviders, bootstrapPlan)
    pythonCheck.optional = true
    graphifyCheck.optional = true
    graphifyArtifactCheck.optional = true
    codegraphCheck.optional = true
    codegraphProjectCheck.optional = true
    memoryRoutingCheck.optional = true
    pythonCheck.category = 'knowledge-graph'
    graphifyCheck.category = 'knowledge-graph'
    graphifyArtifactCheck.category = 'knowledge-graph'
    codegraphCheck.category = 'knowledge-graph'
    codegraphProjectCheck.category = 'knowledge-graph'
    memoryRoutingCheck.category = 'memory'
    checks.push(pythonCheck)
    checks.push(graphifyCheck)
    checks.push(graphifyArtifactCheck)
    checks.push(codegraphCheck)
    checks.push(codegraphProjectCheck)
    checks.push(memoryRoutingCheck)

    // Calculate overall health excluding optional checks
    const coreChecks = checks.filter((c) => !c.optional)
    const fails = coreChecks.filter((c) => c.status === 'fail').length
    const warns = coreChecks.filter((c) => c.status === 'warn').length
    const overall = fails > 0 ? 'broken' : warns > 0 ? 'degraded' : 'healthy'

    // Knowledge graph availability metadata
    const knowledgeGraph = {
      available: graphifyArtifactCheck.status === 'ok' || codegraphProjectCheck.status === 'ok',
      pythonVersion: pythonCheck.status === 'ok' ? pythonCheck.message : undefined,
      graphifyInstalled: graphifyCheck.status === 'ok',
      codegraphInstalled: codegraphCheck.status === 'ok',
      codegraphProjectInitialized: codegraphProjectCheck.status === 'ok',
    }

    return {
      overall,
      checks,
      timestamp: Date.now(),
      bootstrapPlan,
      knowledgeGraph,
      memoryProviders: {
        available: memoryProviders.availableProviderCount > 0,
        gbrainAvailable: Boolean(memoryProviders.providers.find(provider => provider.id === 'gbrain')?.available),
        hrainAvailable: Boolean(memoryProviders.providers.find(provider => provider.id === 'hrain')?.available),
        defaultOrder: [...memoryProviders.routing.defaultOrder],
        mode: memoryProviders.routing.mode,
      },
    }
  }

  private checkScaleDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir)
    if (!existsSync(dir)) {
      return { name: '.scale directory', status: 'fail', message: 'Missing .scale/ directory', fix: 'Run: scale init' }
    }
    return { name: '.scale directory', status: 'ok', message: `Found at ${dir}` }
  }

  private checkEventsDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'events')
    if (!existsSync(dir)) {
      return { name: 'Events directory', status: 'fail', message: 'Missing events/ directory', fix: 'Run: scale init' }
    }
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      const totalSize = files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0)
      const sizeMB = (totalSize / 1024 / 1024).toFixed(2)
      if (totalSize > 100 * 1024 * 1024) {
        return { name: 'Events directory', status: 'warn', message: `${files.length} files, ${sizeMB}MB — consider archiving`, fix: 'Archive old event files' }
      }
      return { name: 'Events directory', status: 'ok', message: `${files.length} files, ${sizeMB}MB` }
    } catch {
      return { name: 'Events directory', status: 'ok', message: 'Empty (fresh install)' }
    }
  }

  private checkArtifactsDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'artifacts')
    if (!existsSync(dir)) {
      return { name: 'Artifacts directory', status: 'fail', message: 'Missing artifacts/ directory', fix: 'Run: scale init' }
    }
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
      return { name: 'Artifacts directory', status: 'ok', message: `${files.length} artifacts` }
    } catch {
      return { name: 'Artifacts directory', status: 'ok', message: 'Empty' }
    }
  }

  private checkSettingsJson(): DiagnosticResult {
    const candidates: Array<{ agent: string; path: string }> = [
      { agent: 'claude-code', path: join(this.projectDir, '.claude', 'settings.json') },
      { agent: 'claude-code', path: join(this.projectDir, '.claude', 'settings.local.json') },
      { agent: 'codex', path: join(this.projectDir, '.codex', 'hooks.json') },
      { agent: 'cursor', path: join(this.projectDir, '.cursor', 'settings.json') },
      { agent: 'gemini', path: join(this.projectDir, '.gemini', 'settings.json') },
      { agent: 'openclaw', path: join(this.projectDir, '.openclaw', 'settings.json') },
      { agent: 'hermes', path: join(this.projectDir, '.hermes', 'settings.json') },
      { agent: 'trae', path: join(this.projectDir, '.trae', 'settings.json') },
      { agent: 'workbuddy', path: join(this.projectDir, '.workbuddy', 'settings.json') },
      { agent: 'vsc', path: join(this.projectDir, '.vscode', 'scale.json') },
      { agent: 'qcoder', path: join(this.projectDir, '.qwen', 'settings.json') },
      { agent: 'qoder', path: join(this.projectDir, '.qoder', 'settings.json') },
      { agent: 'jcode', path: join(this.projectDir, '.jcode', 'settings.json') },
      { agent: 'windsurf', path: join(this.projectDir, '.windsurf', 'settings.json') },
      { agent: 'kiro', path: join(this.projectDir, '.kiro', 'settings.json') },
      { agent: 'cline', path: join(this.projectDir, '.cline', 'settings.json') },
      { agent: 'kilocode', path: join(this.projectDir, '.kilocode', 'settings.json') },
      { agent: 'antigravity', path: join(this.projectDir, '.agents', 'hooks.json') },
    ]
    const found = candidates.find((c) => existsSync(c.path))
    if (!found) {
      return {
        name: 'Agent settings',
        status: 'warn',
        message: 'No agent settings found (.claude/.codex/.cursor/.gemini/.openclaw/.hermes/.trae/.workbuddy/.vscode/.qwen/.qoder/.jcode/.windsurf/.kiro/.cline/.kilocode/.agents)',
        fix: 'Run: scale init --agent <platform>',
      }
    }
    try {
      const content = JSON.parse(readFileSync(found.path, 'utf-8'))
      const collectHookEntries = (entries: unknown[]): Array<{ command?: unknown; description?: unknown; hooks?: unknown[] }> => {
        const flattened: Array<{ command?: unknown; description?: unknown; hooks?: unknown[] }> = []
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue
          flattened.push(entry as { command?: unknown; description?: unknown; hooks?: unknown[] })
          if (Array.isArray((entry as { hooks?: unknown[] }).hooks)) {
            flattened.push(...collectHookEntries((entry as { hooks?: unknown[] }).hooks ?? []))
          }
        }
        return flattened
      }
      const hookEntries = collectHookEntries(
        Object.values(content.hooks ?? {}).flatMap((value) => Array.isArray(value) ? value : []),
      )
      const hasScaleHooks = hookEntries.some((entry) => {
        const command = typeof entry.command === 'string' ? entry.command : ''
        const description = typeof entry.description === 'string' ? entry.description : ''
        return /(^|\s)scale\s/.test(command)
          || command.includes('.claude/hooks/')
          || command.includes('scripts/hooks/')
          || /scale|workflow/i.test(description)
      })
      if (!hasScaleHooks) {
        return {
          name: 'Agent settings',
          status: 'warn',
          message: `${found.path} exists but no SCALE hooks`,
          fix: `Run: scale init --agent ${found.agent} to inject hooks`,
        }
      }
      const hookCount = Object.values(content.hooks ?? {}).flat().length
      const hasLegacyBeforeStopHook = hookEntries.some((entry) => {
        const command = typeof entry.command === 'string' ? entry.command : ''
        return /\bscale\s+gate\s+before-stop\b/.test(command)
          && !/\s--hook-safe(?:\s|$)/.test(command)
          && !/\s--enforce(?:\s|$)/.test(command)
      })
      if (hasLegacyBeforeStopHook) {
        return {
          name: 'Agent settings',
          status: 'warn',
          message: `${hookCount} hooks configured (${found.agent}); before-stop hook uses legacy command form`,
          fix: 'Refresh hooks with: scale init --agent ' + found.agent + ' or add --hook-safe to scale gate before-stop hook commands',
        }
      }
      return { name: 'Agent settings', status: 'ok', message: `${hookCount} hooks configured (${found.agent})` }
    } catch {
      return { name: 'Agent settings', status: 'fail', message: `${found.path} is invalid JSON`, fix: 'Fix JSON syntax' }
    }
  }

  private checkKnowledgeDoc(): DiagnosticResult {
    const paths = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', 'GEMINI.md', '.hermes.md', 'TRAE.md', 'WORKBUDDY.md', 'VSC.md', 'QWEN.md', 'JCODE.md', '.qoder/rules/SCALE.md', '.kiro/rules/SCALE.md', '.windsurf/rules.md', '.clinerules/SCALE.md', '.agents/rules/SCALE.md']
    for (const name of paths) {
      const p = join(this.projectDir, name)
      if (existsSync(p)) {
        const lines = readFileSync(p, 'utf-8').split('\n').length
        if (lines > 200) {
          return { name: 'Knowledge doc', status: 'warn', message: `${name}: ${lines} lines (>200 — compliance may drop)`, fix: 'Split low-frequency rules to .claude/rules/' }
        }
        return { name: 'Knowledge doc', status: 'ok', message: `${name}: ${lines} lines` }
      }
    }
    return { name: 'Knowledge doc', status: 'warn', message: 'No knowledge doc found', fix: 'Run: scale init' }
  }

  private checkRulesDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'rules')
    if (!existsSync(dir)) {
      return { name: 'Rules directory', status: 'ok', message: 'Not created yet (no evolved rules)' }
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    return { name: 'Rules directory', status: 'ok', message: `${files.length} rules` }
  }

  private checkHooksDir(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir, 'hooks')
    if (!existsSync(dir)) {
      return { name: 'Hooks directory', status: 'ok', message: 'Not created yet (no evolved hooks)' }
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.sh'))
    return { name: 'Hooks directory', status: 'ok', message: `${files.length} hooks` }
  }

  private checkNodeVersion(): DiagnosticResult {
    const version = process.version
    const major = parseInt(version.slice(1).split('.')[0])
    if (major < 22) {
      return { name: 'Node.js version', status: 'fail', message: `${version} — requires >=22`, fix: 'Upgrade Node.js to v22+' }
    }
    return { name: 'Node.js version', status: 'ok', message: version }
  }

  private checkArtifactStoreNativeRuntime(): DiagnosticResult {
    const check = inspectBetterSqlite3Runtime()
    return {
      name: 'Artifact store native runtime',
      status: check.status === 'fail' || check.status === 'missing'
        ? 'fail'
        : check.status === 'warn' ? 'warn' : 'ok',
      message: check.reason,
      fix: check.status === 'ok' ? undefined : check.installHint,
    }
  }

  private checkDiskUsage(): DiagnosticResult {
    const dir = join(this.projectDir, this.scaleDir)
    if (!existsSync(dir)) return { name: 'Disk usage', status: 'ok', message: 'N/A' }
    try {
      let totalSize = 0
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f)
          const s = statSync(p)
          if (s.isDirectory()) walk(p)
          else totalSize += s.size
        }
      }
      walk(dir)
      const mb = (totalSize / 1024 / 1024).toFixed(2)
      if (totalSize > 500 * 1024 * 1024) {
        return { name: 'Disk usage', status: 'warn', message: `${mb}MB — consider cleanup`, fix: 'Archive old events/checkpoints' }
      }
      return { name: 'Disk usage', status: 'ok', message: `${mb}MB` }
    } catch {
      return { name: 'Disk usage', status: 'ok', message: 'Unable to calculate' }
    }
  }

  private checkGitignore(): DiagnosticResult {
    const p = join(this.projectDir, this.scaleDir, '.gitignore')
    if (!existsSync(p)) {
      return { name: '.scale/.gitignore', status: 'warn', message: 'Missing — runtime data may be committed', fix: 'Run: scale init' }
    }
    return { name: '.scale/.gitignore', status: 'ok', message: 'Present' }
  }

  private checkGitWorkspace(): DiagnosticResult {
    const safety = inspectWorkspaceSafety(this.projectDir)
    if (!safety.gitRepository) {
      return {
        name: 'Git workspace',
        status: 'ok',
        message: safety.message,
      }
    }
    if (safety.blocked) {
      return {
        name: 'Git workspace',
        status: 'fail',
        message: safety.message,
        fix: 'Resolve merge conflicts first, then rerun: scale doctor && scale preflight --json',
      }
    }
    return {
      name: 'Git workspace',
      status: 'ok',
      message: safety.message,
    }
  }

  private checkGovernanceTemplates(): DiagnosticResult {
    const required = [
      join(this.projectDir, 'docs', 'workflow', 'README.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'explore.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'mini-prd.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'skill-plan.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'ui-spec.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'visual-review.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'api-contract.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'security-review.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'resource-impact.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'standards-impact.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'architecture-review.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'db-change-plan.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'e2e-plan.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'plan.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'verification.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'review.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'summary.md'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'github-actions-scale-preflight.yml'),
      join(this.projectDir, 'docs', 'workflow', 'templates', 'pre-push-scale-preflight.sh'),
      join(this.projectDir, 'docs', 'worklog', 'metrics.md'),
    ]
    const missing = required.filter((path) => !existsSync(path))
    if (missing.length > 0) {
      return {
        name: 'Governance templates',
        status: 'warn',
        message: `${missing.length} governance templates missing`,
        fix: 'Run: scale init to generate workflow governance templates',
      }
    }
    return { name: 'Governance templates', status: 'ok', message: `${required.length} templates present` }
  }

  private checkVerificationMatrix(): DiagnosticResult {
    const path = join(this.projectDir, this.scaleDir, 'verification.json')
    if (!existsSync(path)) {
      return {
        name: 'Verification matrix',
        status: 'warn',
        message: 'Missing .scale/verification.json',
        fix: 'Run: scale init or create a service-aware verification matrix',
      }
    }
    try {
      const matrix = JSON.parse(readFileSync(path, 'utf-8')) as {
        profiles?: unknown
        services?: unknown
        policy?: { artifactGate?: unknown }
      }
      const artifactGate = matrix.policy?.artifactGate
      if (artifactGate && artifactGate !== 'off' && artifactGate !== 'warn' && artifactGate !== 'block') {
        return {
          name: 'Verification matrix',
          status: 'warn',
          message: 'Invalid policy.artifactGate; expected off, warn, or block',
          fix: 'Update .scale/verification.json policy.artifactGate',
        }
      }
      const serviceCount = Array.isArray(matrix.services) ? matrix.services.length : 0
      const profileCount = matrix.profiles && typeof matrix.profiles === 'object' ? Object.keys(matrix.profiles).length : 0
      return { name: 'Verification matrix', status: 'ok', message: `${profileCount} profiles, ${serviceCount} services` }
    } catch {
      return {
        name: 'Verification matrix',
        status: 'fail',
        message: '.scale/verification.json is invalid JSON',
        fix: 'Fix JSON syntax or regenerate with scale init',
      }
    }
  }

  private checkSkillRoutingPolicy(): DiagnosticResult {
    const path = join(this.projectDir, this.scaleDir, 'skills.json')
    if (!existsSync(path)) {
      return {
        name: 'Skill routing policy',
        status: 'warn',
        message: 'Missing .scale/skills.json',
        fix: 'Run: scale init to generate active skill routing policy',
      }
    }
    try {
      const config = JSON.parse(readFileSync(path, 'utf-8')) as {
        policy?: { mode?: unknown; enforceLevels?: unknown }
        domains?: unknown
      }
      const mode = config.policy?.mode
      if (mode && mode !== 'off' && mode !== 'warn' && mode !== 'block') {
        return {
          name: 'Skill routing policy',
          status: 'warn',
          message: 'Invalid policy.mode; expected off, warn, or block',
          fix: 'Update .scale/skills.json policy.mode',
        }
      }
      const domainCount = config.domains && typeof config.domains === 'object' ? Object.keys(config.domains).length : 0
      if (domainCount === 0) {
        return {
          name: 'Skill routing policy',
          status: 'warn',
          message: 'No skill routing domains configured',
          fix: 'Regenerate with scale init or add domains to .scale/skills.json',
        }
      }
      return { name: 'Skill routing policy', status: 'ok', message: `${domainCount} domains` }
    } catch {
      return {
        name: 'Skill routing policy',
        status: 'fail',
        message: '.scale/skills.json is invalid JSON',
        fix: 'Fix JSON syntax or regenerate with scale init',
      }
    }
  }

  private checkToolPolicy(): DiagnosticResult {
    const path = join(this.projectDir, this.scaleDir, 'tools.json')
    if (!existsSync(path)) {
      return {
        name: 'Tool policy',
        status: 'warn',
        message: 'Missing .scale/tools.json',
        fix: 'Run: scale init to generate active tool orchestration policy',
      }
    }
    try {
      const config = JSON.parse(readFileSync(path, 'utf-8')) as {
        mode?: unknown
        tools?: unknown
      }
      const mode = config.mode
      if (mode && mode !== 'off' && mode !== 'advisory' && mode !== 'evidence-required' && mode !== 'block') {
        return {
          name: 'Tool policy',
          status: 'warn',
          message: 'Invalid mode; expected off, advisory, evidence-required, or block',
          fix: 'Update .scale/tools.json mode',
        }
      }
      const toolCount = config.tools && typeof config.tools === 'object' ? Object.keys(config.tools).length : 0
      if (toolCount === 0) {
        return {
          name: 'Tool policy',
          status: 'warn',
          message: 'No tool orchestration entries configured',
          fix: 'Regenerate with scale init or add tools to .scale/tools.json',
        }
      }
      return { name: 'Tool policy', status: 'ok', message: `${toolCount} tools, mode ${String(mode ?? 'evidence-required')}` }
    } catch {
      return {
        name: 'Tool policy',
        status: 'fail',
        message: '.scale/tools.json is invalid JSON',
        fix: 'Fix JSON syntax or regenerate with scale init',
      }
    }
  }

  private checkResourcePolicy(): DiagnosticResult {
    const path = join(this.projectDir, this.scaleDir, 'resource-policy.json')
    if (!existsSync(path)) {
      return {
        name: 'Resource policy',
        status: 'warn',
        message: 'Missing .scale/resource-policy.json',
        fix: 'Run: scale init --governance-pack resource-governance or standard',
      }
    }
    try {
      const report = doctorResourceAssets({ projectDir: this.projectDir, scaleDir: this.scaleDir })
      const failCount = report.findings.filter(finding => finding.severity === 'fail').length
      const warnCount = report.findings.filter(finding => finding.severity === 'warn').length
      if (failCount > 0) {
        return {
          name: 'Resource policy',
          status: 'warn',
          message: `${failCount} blocking resource issue(s), ${warnCount} warning(s)`,
          fix: 'Run: scale assets doctor --json',
        }
      }
      return { name: 'Resource policy', status: warnCount > 0 ? 'warn' : 'ok', message: `${report.scan.summary.total} resources, ${warnCount} warning(s)` }
    } catch {
      return {
        name: 'Resource policy',
        status: 'fail',
        message: '.scale/resource-policy.json is invalid or resource scan failed',
        fix: 'Fix JSON syntax or regenerate with scale init',
      }
    }
  }

  private checkEngineeringStandards(): DiagnosticResult {
    const path = join(this.projectDir, this.scaleDir, 'engineering-standards.json')
    if (!existsSync(path)) {
      return {
        name: 'Engineering standards',
        status: 'warn',
        message: 'Missing .scale/engineering-standards.json',
        fix: 'Run: scale init --governance-pack standard',
      }
    }
    try {
      const report = doctorEngineeringStandards({ projectDir: this.projectDir, scaleDir: this.scaleDir })
      const failCount = report.findings.filter(finding => finding.severity === 'fail').length
      const warnCount = report.findings.filter(finding => finding.severity === 'warn').length
      if (failCount > 0) {
        return {
          name: 'Engineering standards',
          status: 'warn',
          message: `${failCount} blocking standard issue(s), ${warnCount} warning(s)`,
          fix: 'Run: scale standards doctor --json',
        }
      }
      return {
        name: 'Engineering standards',
        status: warnCount > 0 ? 'warn' : 'ok',
        message: `${report.scan.summary.filesScanned} files scanned, ${warnCount} warning(s)`,
      }
    } catch {
      return {
        name: 'Engineering standards',
        status: 'fail',
        message: '.scale/engineering-standards.json is invalid or standards scan failed',
        fix: 'Fix JSON syntax or regenerate with scale init',
      }
    }
  }

  private skippedEngineeringStandardsForWorkspaceConflict(): DiagnosticResult {
    return {
      name: 'Engineering standards',
      status: 'warn',
      message: 'Skipped because the git workspace has unresolved conflicts',
      fix: 'Resolve merge conflicts first, then rerun: scale standards doctor --json',
    }
  }

  private checkGovernanceDrift(): DiagnosticResult {
    const drift = computeGovernanceDrift(this.projectDir)
    if (!drift.lockExists) {
      return {
        name: 'Governance drift',
        status: 'warn',
        message: 'Missing .scale/governance.lock.json',
        fix: 'Run: scale init --governance-pack standard',
      }
    }
    if (drift.missing.length > 0 || drift.changed.length > 0) {
      return {
        name: 'Governance drift',
        status: 'warn',
        message: `${drift.missing.length} missing, ${drift.changed.length} changed generated governance files`,
        fix: 'Run: scale governance diff',
      }
    }
    return {
      name: 'Governance drift',
      status: 'ok',
      message: `${drift.clean.length} generated governance files clean`,
    }
  }

  private checkPython(bootstrapPlan: ProfileBootstrapPlan): DiagnosticResult {
    try {
      const version = this.runExecSync('python3 --version').trim()
      const match = version.match(/Python (\d+)\.(\d+)/)
      if (match) {
        const major = parseInt(match[1])
        const minor = parseInt(match[2])
        if (major >= 3 && minor >= 8) {
          return { name: 'Python version', status: 'ok', message: version }
        }
        return { name: 'Python version', status: 'warn', message: `${version} — graphify requires >=3.8`, fix: 'Upgrade Python to 3.8+' }
      }
      return { name: 'Python version', status: 'ok', message: version }
    } catch {
      // Try python (without 3) for Windows
      try {
        const version = this.runExecSync('python --version').trim()
        return { name: 'Python version', status: 'ok', message: version }
      } catch {
        return {
          name: 'Python version',
          status: 'warn',
          message: 'Not installed — knowledge graph requires Python',
          fix: `Install Python 3.8+, then run: ${this.knowledgeBootstrapApplyCommand(bootstrapPlan)}`,
        }
      }
    }
  }

  private checkGraphifyCli(toolCapabilities: ToolCapabilityReport, bootstrapPlan: ProfileBootstrapPlan): DiagnosticResult {
    const graphify = toolCapabilities.tools.find(tool => tool.id === 'graphify')
    if (graphify?.installed) {
      return { name: 'Graphify CLI', status: 'ok', message: graphify.version ?? graphify.detectedPath ?? 'installed' }
    }
    return {
      name: 'Graphify CLI',
      status: 'warn',
      message: graphify?.missingReason ?? 'Graphify CLI is not installed',
      fix: `Run: ${this.knowledgeBootstrapApplyCommand(bootstrapPlan)}`,
    }
  }

  private checkGraphifyArtifact(codeIntelligence: CodeIntelligenceStatusReport): DiagnosticResult {
    const graphify = codeIntelligence.providers.find(provider => provider.id === 'graphify')
    if (graphify?.available) {
      return { name: 'Graphify artifact', status: 'ok', message: graphify.reason }
    }
    return {
      name: 'Graphify artifact',
      status: 'warn',
      message: graphify?.reason ?? 'Graphify artifact is not available',
      fix: 'Run: scale codegraph status --json and generate graphify-out/graph.json before relying on graph-backed knowledge recall',
    }
  }

  private checkCodegraph(toolCapabilities: ToolCapabilityReport, bootstrapPlan: ProfileBootstrapPlan): DiagnosticResult {
    const codegraph = toolCapabilities.tools.find(tool => tool.id === 'codegraph')
    if (codegraph?.installed) {
      return { name: 'CodeGraph CLI', status: 'ok', message: codegraph.version ?? codegraph.detectedPath ?? 'installed' }
    }
    return {
      name: 'CodeGraph CLI',
      status: 'warn',
      message: codegraph?.missingReason ?? 'CodeGraph CLI is not installed',
      fix: `Run: ${this.knowledgeBootstrapApplyCommand(bootstrapPlan)}`,
    }
  }

  private checkCodegraphProject(codeIntelligence: CodeIntelligenceStatusReport): DiagnosticResult {
    if (codeIntelligence.projectIndexExists) {
      return { name: 'CodeGraph project index', status: 'ok', message: `Found at ${codeIntelligence.projectIndexPath}` }
    }
    return {
      name: 'CodeGraph project index',
      status: 'warn',
      message: 'Project is not initialized for CodeGraph',
      fix: 'Run: scale codegraph init',
    }
  }

  private checkMemoryProviders(memoryProviders: MemoryProviderStatusReport, bootstrapPlan: ProfileBootstrapPlan): DiagnosticResult {
    const availableProviders = memoryProviders.providers.filter(provider => provider.available)
    if (availableProviders.length > 0) {
      return {
        name: 'Memory provider routing',
        status: memoryProviders.warnings.length > 0 ? 'warn' : 'ok',
        message: `mode=${memoryProviders.routing.mode}; order=${memoryProviders.routing.defaultOrder.join(' -> ')}; available=${availableProviders.map(provider => provider.id).join(', ')}`,
        fix: memoryProviders.warnings.length > 0 ? 'Run: scale memory provider status --json' : undefined,
      }
    }
    return {
      name: 'Memory provider routing',
      status: 'warn',
      message: `mode=${memoryProviders.routing.mode}; order=${memoryProviders.routing.defaultOrder.join(' -> ')}; no available provider`,
      fix: `Run: ${this.memoryBootstrapApplyCommand(bootstrapPlan)}`,
    }
  }

  private checkRuntimeEvidence(): DiagnosticResult {
    try {
      const report = doctorRuntimeEvidence({
        projectDir: this.projectDir,
        scaleDir: this.scaleDir,
        level: 'S',
      })
      const failCount = report.checks.filter(check => check.status === 'fail').length
      const warnCount = report.checks.filter(check => check.status === 'warn').length
      if (failCount > 0) {
        return {
          name: 'Runtime evidence',
          status: 'warn',
          message: `${failCount} runtime issue(s), ${warnCount} warning(s)`,
          fix: 'Run: scale runtime doctor --json',
        }
      }
      return {
        name: 'Runtime evidence',
        status: warnCount > 0 ? 'warn' : 'ok',
        message: `${report.evidence.total} evidence record(s), ${warnCount} warning(s)`,
      }
    } catch {
      return {
        name: 'Runtime evidence',
        status: 'warn',
        message: 'Runtime evidence doctor could not inspect local state',
        fix: 'Run: scale runtime doctor --json',
      }
    }
  }

  private checkConfigHealth(): DiagnosticResult {
    const configPath = join(this.projectDir, this.scaleDir, 'config.yaml')
    if (!existsSync(configPath)) {
      return {
        name: 'Config health',
        status: 'warn',
        message: 'No config.yaml found',
        fix: 'Run: scale init (or scale config profile --set standard)',
      }
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      const issues: string[] = []
      const recommendations: string[] = []

      // Check profile
      const profileMatch = content.match(/^profile:\s*(.+)$/m)
      const profileId = profileMatch?.[1]?.trim() || 'standard'
      const profile = getProfile(profileId)
      const bootstrapPlan = getBootstrapPlanForProfile(profile.id)

      if (profile.id !== profileId) {
        issues.push(`Unknown profile "${profileId}", falling back to standard`)
      }

      // Check legacy vector-search config drift
      if (content.includes('backend: qdrant')) {
        issues.push('Legacy Qdrant backend configured; default knowledge and recall flow now expects graphify + codegraph instead of Qdrant')
        recommendations.push('Update .scale/config.yaml to use graphify-backed knowledge, or rerun: scale config profile --set advanced')
      }

      // Check evolution enabled without eval setup
      if (content.includes('evolution:') && content.includes('enabled: true')) {
        const evalPath = existsSync(join(this.projectDir, this.scaleDir, 'evals'))
          ? join(this.projectDir, this.scaleDir, 'evals')
          : join(this.projectDir, this.scaleDir, 'eval')
        if (!existsSync(evalPath)) {
          recommendations.push('Evolution enabled but no .scale/eval/ directory — run: scale eval init')
        }
      }

      // Check profile-scenario mismatch
      const thresholdsPath = join(this.projectDir, this.scaleDir, 'thresholds.json')
      if (existsSync(thresholdsPath)) {
        try {
          const thresholds = JSON.parse(readFileSync(thresholdsPath, 'utf-8'))
          const scenario = thresholds.gates?.G7_security?.required ? 'critical' : thresholds.gates?.G3_build?.required ? 'standard' : 'sandbox'
          const expectedProfile = scenario === 'sandbox' ? 'minimal' : scenario === 'critical' ? 'advanced' : 'standard'
          if (profileId !== expectedProfile) {
            recommendations.push(`Profile "${profileId}" may not match scenario "${scenario}" (suggest: ${expectedProfile})`)
          }
        } catch (error) {
          recommendations.push(`Could not parse ${thresholdsPath}; run: scale config doctor`)
          void error
        }
      }

      if (bootstrapPlan.packs.length > 0 && profile.defaults.knowledge.enabled) {
        recommendations.push(`Bootstrap profile-aligned dependencies with: ${bootstrapPlan.inspectCommand}`)
      }

      if (issues.length > 0) {
        return {
          name: 'Config health',
          status: 'warn',
          message: issues.join('; '),
          fix: recommendations.length > 0 ? recommendations.join('; ') : 'Run: scale config profile --set standard',
        }
      }

      const summary = `profile=${profile.name}`
      const recSuffix = recommendations.length > 0 ? ` — ${recommendations.join('; ')}` : ''
      return {
        name: 'Config health',
        status: recommendations.length > 0 ? 'warn' : 'ok',
        message: `${summary}${recSuffix}`,
      }
    } catch {
      return {
        name: 'Config health',
        status: 'fail',
        message: 'config.yaml exists but could not be parsed',
        fix: 'Run: scale config profile --set standard to regenerate',
      }
    }
  }

  private resolveBootstrapPlan(): ProfileBootstrapPlan {
    return getBootstrapPlanForProfile(this.readProfileId())
  }

  private readProfileId(): string {
    const configPath = join(this.projectDir, this.scaleDir, 'config.yaml')
    if (!existsSync(configPath)) return 'standard'
    try {
      const content = readFileSync(configPath, 'utf-8')
      const match = content.match(/^profile:\s*(.+)$/m)
      return match?.[1]?.trim() || 'standard'
    } catch {
      return 'standard'
    }
  }

  private inspectCodeIntelligence(): CodeIntelligenceStatusReport {
    return (this.deps.inspectCodeIntelligenceImpl ?? inspectCodeIntelligence)({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
    })
  }

  private inspectMemoryProviders(): MemoryProviderStatusReport {
    return (this.deps.inspectMemoryProvidersImpl ?? inspectMemoryProviders)({
      projectDir: this.projectDir,
      scaleDir: this.scaleDir,
    })
  }

  private inspectToolCapabilities(toolIds: string[]): ToolCapabilityReport {
    return (this.deps.inspectToolCapabilitiesImpl ?? inspectToolCapabilities)({
      projectDir: this.projectDir,
      toolIds,
    })
  }

  private runExecSync(command: string): string {
    return String((this.deps.execSyncImpl ?? execSync)(command, { encoding: 'utf-8', timeout: 5000 }))
  }

  private knowledgeBootstrapApplyCommand(bootstrapPlan: ProfileBootstrapPlan): string {
    return bootstrapPlan.packs.includes('knowledge')
      ? bootstrapPlan.applyCommand
      : 'scale setup --pack knowledge --apply --yes'
  }

  private memoryBootstrapApplyCommand(bootstrapPlan: ProfileBootstrapPlan): string {
    return bootstrapPlan.packs.includes('memory')
      ? bootstrapPlan.applyCommand
      : 'scale setup --pack memory --memory-provider hrain --memory-mode local-only --apply --yes'
  }

  formatReport(report: DoctorReport): string {
    return this.formatReportAscii(report)
    const icon = { healthy: '✅', degraded: '⚠️', broken: '❌' }
    const statusIcon = { ok: '✅', warn: '⚠️', fail: '❌' }
    const lines: string[] = [
      `\n${icon[report.overall]} SCALE Engine Health: ${report.overall.toUpperCase()}`,
      `${'─'.repeat(50)}`,
    ]

    // Core checks first
    for (const check of report.checks.filter((c) => !c.optional)) {
      lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
      if (check.fix) lines.push(`     💡 Fix: ${check.fix}`)
    }

    lines.push(`${'─'.repeat(50)}`)

    const governanceChecks = report.checks.filter((c) => c.optional && c.category === 'governance')
    if (governanceChecks.length > 0) {
      lines.push('')
      lines.push('Project Governance (Optional):')
      for (const check of governanceChecks) {
        lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
        if (check.fix) lines.push(`     Fix: ${check.fix}`)
      }
    }

    // Knowledge graph section (optional checks)
    const optionalChecks = report.checks.filter((c) => c.optional && c.category === 'knowledge-graph')
    if (optionalChecks.length > 0) {
      lines.push('')
      lines.push('📦 Knowledge Graph (Optional):')
      for (const check of optionalChecks) {
        lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
        if (check.fix) lines.push(`     💡 Fix: ${check.fix}`)
      }
    }

    const memoryChecks = report.checks.filter((c) => c.optional && c.category === 'memory')
    if (memoryChecks.length > 0) {
      lines.push('')
      lines.push('Memory Providers (Optional):')
      for (const check of memoryChecks) {
        lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
        if (check.fix) lines.push(`     Fix: ${check.fix}`)
      }
    }

    // Knowledge graph status summary
    if (report.knowledgeGraph) {
      const knowledgeGraph = report.knowledgeGraph!
      lines.push('')
      if (knowledgeGraph.available) {
        lines.push('  ✅ Code knowledge graph available')
        if (knowledgeGraph.codegraphProjectInitialized) {
          lines.push('  → Use: scale codegraph context --symbol <Symbol>')
        }
        if (knowledgeGraph.graphifyInstalled) {
          lines.push('  → Use: scale graphify .')
        }
      } else {
        lines.push('  ⚠️ Code knowledge graph not available (optional feature)')
        lines.push('  → Install CodeGraph: npx @colbymchenry/codegraph')
        lines.push('  → Install Graphify: uv tool install graphify && graphify install --platform codex')
      }
      lines.push(`${'─'.repeat(50)}`)
    }

    const runtimeChecks = report.checks.filter((c) => c.optional && c.category === 'runtime')
    if (runtimeChecks.length > 0) {
      lines.push('')
      lines.push('Runtime Evidence (Optional):')
      for (const check of runtimeChecks) {
        lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
        if (check.fix) lines.push(`     Fix: ${check.fix}`)
      }
      lines.push(`${'-'.repeat(50)}`)
    }

    const ok = report.checks.filter((c) => c.status === 'ok').length
    const warn = report.checks.filter((c) => c.status === 'warn').length
    const fail = report.checks.filter((c) => c.status === 'fail').length
    const optional = report.checks.filter((c) => c.optional).length
    lines.push(`  ${ok} passed, ${warn} warnings, ${fail} failures (${optional} optional)`)
    return lines.join('\n')
  }

  private formatReportAscii(report: DoctorReport): string {
    const icon = { healthy: '[OK]', degraded: '[WARN]', broken: '[FAIL]' } as const
    const statusIcon = { ok: '[OK]', warn: '[WARN]', fail: '[FAIL]' } as const
    const divider = '-'.repeat(50)
    const lines: string[] = [
      '',
      `${icon[report.overall]} SCALE Engine Health: ${report.overall.toUpperCase()}`,
      divider,
    ]

    for (const check of report.checks.filter((c) => !c.optional)) {
      lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
      if (check.fix) lines.push(`     Fix: ${check.fix}`)
    }

    lines.push(divider)

    const appendSection = (title: string, category: NonNullable<DiagnosticResult['category']>) => {
      const sectionChecks = report.checks.filter((c) => c.optional && c.category === category)
      if (sectionChecks.length === 0) return
      lines.push('')
      lines.push(title)
      for (const check of sectionChecks) {
        lines.push(`  ${statusIcon[check.status]} ${check.name}: ${check.message}`)
        if (check.fix) lines.push(`     Fix: ${check.fix}`)
      }
    }

    appendSection('Project Governance (Optional):', 'governance')
    appendSection('Knowledge Graph (Optional):', 'knowledge-graph')
    appendSection('Memory Providers (Optional):', 'memory')
    appendSection('Runtime Evidence (Optional):', 'runtime')

    if (report.knowledgeGraph) {
      const knowledgeGraph = report.knowledgeGraph
      lines.push('')
      if (knowledgeGraph.available) {
        lines.push('  [OK] Code knowledge graph available')
        if (report.knowledgeGraph.codegraphProjectInitialized) {
          lines.push('  -> Use: scale codegraph context --symbol <Symbol>')
        }
        if (report.knowledgeGraph.graphifyInstalled) {
          lines.push('  -> Use: scale graphify .')
        }
      } else {
        lines.push('  [WARN] Code knowledge graph not available (optional feature)')
        lines.push(`  -> Bootstrap inspect: ${report.bootstrapPlan?.inspectCommand ?? 'scale setup --pack knowledge --json'}`)
        lines.push(`  -> Bootstrap apply: ${report.bootstrapPlan?.packs.includes('knowledge') ? report.bootstrapPlan.applyCommand : 'scale setup --pack knowledge --apply --yes'}`)
      }
      lines.push(divider)
    }

    if (report.memoryProviders && !report.memoryProviders.available) {
      lines.push(`  -> Memory bootstrap: ${report.bootstrapPlan?.packs.includes('memory') ? report.bootstrapPlan.applyCommand : 'scale setup --pack memory --memory-provider hrain --memory-mode local-only --apply --yes'}`)
      lines.push(divider)
    }

    const ok = report.checks.filter((c) => c.status === 'ok').length
    const warn = report.checks.filter((c) => c.status === 'warn').length
    const fail = report.checks.filter((c) => c.status === 'fail').length
    const optional = report.checks.filter((c) => c.optional).length
    lines.push(`  ${ok} passed, ${warn} warnings, ${fail} failures (${optional} optional)`)
    return lines.join('\n')
  }
}
