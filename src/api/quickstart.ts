// SCALE Engine — Quick Start / One-Click Install
// 自动检测平台、配置物理约束、可选安装知识图谱

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { AgentPlatform } from '../artifact/types.js'
import { bootstrapDependencies, type DependencyBootstrapReport } from '../bootstrap/DependencyBootstrap.js'
import { inspectCodeIntelligence, type CodeIntelligenceStatusReport } from '../codegraph/CodeIntelligence.js'
import { getBootstrapPlanForProfile } from '../config/profiles.js'
import { inspectToolCapabilities, type ToolCapabilityReport } from '../tools/ToolCapabilityRegistry.js'
import { writeGovernanceTemplates } from '../workflow/GovernanceTemplates.js'

export interface PlatformDetectionResult {
  platform: AgentPlatform | null
  confidence: number
  suggestions: string[]
}

interface PackageJsonLike {
  scripts?: Record<string, string>
  dependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  workspaces?: unknown
  main?: unknown
  module?: unknown
  exports?: unknown
}

// Auto-detect the best governance pack based on project files
export function autoDetectGovernancePack(projectDir: string): string {
  const pkgPath = join(projectDir, 'package.json')
  if (existsSync(join(projectDir, 'src-tauri')) || existsSync(join(projectDir, 'electron'))) return 'desktop-app'
  if (existsSync(join(projectDir, 'pom.xml')) || existsSync(join(projectDir, 'build.gradle')) || existsSync(join(projectDir, 'build.gradle.kts'))) {
    if (existsSync(pkgPath) || existsSync(join(projectDir, 'frontend')) || existsSync(join(projectDir, 'vue'))) return 'spring-vue-admin'
    return 'enterprise-admin'
  }
  if (existsSync(pkgPath)) {
    try {
      const pkg = readPackageJson(pkgPath)
      const scripts = Object.keys(pkg.scripts ?? {})
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      if (deps.electron || deps['@tauri-apps/api'] || deps['@tauri-apps/cli']) return 'desktop-app'
      if (pkg.workspaces || existsSync(join(projectDir, 'pnpm-workspace.yaml')) || existsSync(join(projectDir, 'turbo.json'))) {
        return 'microservice-platform'
      }

      // Check for frontend frameworks
      if (deps.react || deps.next || deps.vue || deps['@angular/core'] ||
          (pkg.scripts?.build ?? '').includes('vite') || (pkg.scripts?.build ?? '').includes('webpack')) {
        return 'frontend-app'
      }
      // Check for library
      if (pkg.main || pkg.module || pkg.exports) {
        return 'node-library'
      }
    } catch {}
  }
  if (existsSync(join(projectDir, 'go.mod'))) return 'go-service-matrix'
  if (existsSync(join(projectDir, 'pyproject.toml')) || existsSync(join(projectDir, 'requirements.txt'))) return 'python-service'
  // Check for monorepo
  if (existsSync(join(projectDir, 'lerna.json')) || existsSync(join(projectDir, 'nx.json')) ||
      existsSync(join(projectDir, 'turbo.json'))) {
    const pkgPath = join(projectDir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = readPackageJson(pkgPath)
        if (pkg.workspaces) return 'moe-workspace'
      } catch {}
    }
    return 'project-scaffold'
  }
  return 'standard'
}

export interface ProjectClassification {
  language: 'node' | 'go' | 'python' | 'java' | 'unknown'
  framework?: string
  isMonorepo: boolean
  isLibrary: boolean
  recommendedPack: string
  recommendedProfile: 'minimal' | 'standard' | 'critical'
  suggestedService?: string
}

// Auto-classify project structure
export function classifyProject(projectDir: string): ProjectClassification {
  const result: ProjectClassification = {
    language: 'unknown',
    isMonorepo: false,
    isLibrary: false,
    recommendedPack: 'standard',
    recommendedProfile: 'standard',
  }

  const pkgPath = join(projectDir, 'package.json')
  if (existsSync(join(projectDir, 'pom.xml')) || existsSync(join(projectDir, 'build.gradle')) || existsSync(join(projectDir, 'build.gradle.kts'))) {
    result.language = 'java'
    result.framework = 'spring-boot'
    result.recommendedPack = existsSync(pkgPath) ? 'spring-vue-admin' : 'enterprise-admin'
  }
  if (existsSync(pkgPath)) {
    result.language = 'node'
    try {
      const pkg = readPackageJson(pkgPath)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      if (deps.electron || deps['@tauri-apps/api'] || deps['@tauri-apps/cli'] || existsSync(join(projectDir, 'src-tauri'))) {
        result.framework = deps['@tauri-apps/api'] || existsSync(join(projectDir, 'src-tauri')) ? 'tauri' : 'electron'
        result.recommendedPack = 'desktop-app'
      } else if (pkg.workspaces || existsSync(join(projectDir, 'lerna.json')) || existsSync(join(projectDir, 'nx.json')) || existsSync(join(projectDir, 'pnpm-workspace.yaml')) || existsSync(join(projectDir, 'turbo.json'))) {
        result.isMonorepo = true
        result.recommendedPack = 'microservice-platform'
      }

      if (deps.react) { result.framework = result.framework ?? 'react'; result.recommendedPack = result.recommendedPack === 'standard' ? 'frontend-app' : result.recommendedPack }
      else if (deps.next) { result.framework = 'next'; result.recommendedPack = 'frontend-app' }
      else if (deps.vue) { result.framework = result.framework ?? 'vue'; result.recommendedPack = result.recommendedPack === 'standard' ? 'frontend-app' : result.recommendedPack }
      else if (deps.express || deps.fastify || deps.koa) { result.framework = result.framework ?? 'express'; result.recommendedPack = result.recommendedPack === 'standard' ? 'node-library' : result.recommendedPack }

      if (!result.framework && (pkg.main || pkg.module || pkg.exports)) {
        result.isLibrary = true
        result.recommendedPack = 'node-library'
      }

      const scripts = pkg.scripts ?? {}
      const hasTest = Object.keys(scripts).some(k => k.includes('test'))
      const hasLint = Object.keys(scripts).some(k => k.includes('lint'))
      if (!hasTest || !hasLint) result.recommendedProfile = 'minimal'
    } catch {}
  }

  if (existsSync(join(projectDir, 'go.mod'))) { result.language = 'go'; result.recommendedPack = 'go-service-matrix' }
  if (existsSync(join(projectDir, 'pyproject.toml')) || existsSync(join(projectDir, 'requirements.txt'))) { result.language = 'python'; result.recommendedPack = 'python-service' }

  return result
}

export function detectPlatform(projectDir: string = '.'): PlatformDetectionResult {
  const checks: Array<{ platform: AgentPlatform; paths: string[] }> = [
    { platform: 'claude-code', paths: [join(projectDir, '.claude', 'settings.json')] },
    { platform: 'codex', paths: [join(projectDir, '.codex', 'config.toml')] },
    { platform: 'cursor', paths: [join(projectDir, '.cursorrules')] },
    { platform: 'gemini', paths: [join(projectDir, '.gemini', 'settings.json')] },
    { platform: 'qoder', paths: [join(projectDir, '.qoder', 'settings.json')] },
    { platform: 'jcode', paths: [join(projectDir, '.jcode', 'settings.json')] },
    { platform: 'aider', paths: [join(projectDir, '.aider.conf.yml')] },
    { platform: 'deepseek-tui', paths: [join(projectDir, '.deepseek', 'instructions.md')] },
    { platform: 'windsurf', paths: [join(projectDir, '.windsurf', 'settings.json'), join(projectDir, '.windsurfrc')] },
    { platform: 'kimi', paths: [join(projectDir, '.kimi', 'settings.json')] },
    { platform: 'doubao', paths: [join(projectDir, '.doubao', 'settings.json')] },
    { platform: 'kiro', paths: [join(projectDir, '.kiro', 'settings.json')] },
    { platform: 'cline', paths: [join(projectDir, '.cline', 'settings.json'), join(projectDir, '.clinerules')] },
    { platform: 'kilocode', paths: [join(projectDir, '.kilocode', 'settings.json')] },
    { platform: 'antigravity', paths: [join(projectDir, '.agents', 'hooks.json'), join(projectDir, '.agents', 'rules')] },
  ]
  for (const check of checks) {
    for (const p of check.paths) if (existsSync(p)) return { platform: check.platform, confidence: 1.0, suggestions: [] }
  }
  return { platform: null, confidence: 0, suggestions: ['codex', 'claude-code', 'cursor', 'qoder', 'cline', 'windsurf'] }
}

export const PHYSICAL_CONSTRAINTS = [
  { id: 'block-dangerous', severity: 'critical', matcher: 'Bash', command: 'scale guard dangerous' },
  { id: 'block-secrets', severity: 'critical', matcher: 'Edit|Write', command: 'scale guard secrets' },
  { id: 'detect-retry', severity: 'high', matcher: '', command: 'scale guard retry' },
]

export interface KnowledgeGraphResult {
  available: boolean
  pythonVersion?: string
  graphifyInstalled: boolean
  graphifyVersion?: string
  codegraphInstalled?: boolean
  codegraphVersion?: string
  codegraphProjectInitialized?: boolean
  graphifyArtifactPresent?: boolean
  instructions?: string[]
}

interface KnowledgeGraphDeps {
  execSyncImpl?: typeof execSync
  inspectToolCapabilitiesImpl?: typeof inspectToolCapabilities
  inspectCodeIntelligenceImpl?: typeof inspectCodeIntelligence
  bootstrapDependenciesImpl?: (options: {
    projectDir?: string
    scaleDir?: string
    packIds?: string[]
    apply?: boolean
  }) => Promise<DependencyBootstrapReport>
}

export interface QuickStartResult {
  success: boolean
  platform: AgentPlatform | null
  created: string[]
  skipped: string[]
  constraintsApplied: number
  workflowCapabilities: string[]
  capabilitiesEnabled: string[]
  knowledgeGraph?: KnowledgeGraphResult
  dependencyBootstrapCommand: string
  nextSteps: string[]
}

export function governanceNextSteps(options: {
  includeAgentInit?: boolean
  includeDependencyBootstrap?: boolean
  profileId?: string
  governancePack?: string
} = {}): string[] {
  const steps: string[] = []
  const bootstrapPlan = getBootstrapPlanForProfile(options.profileId ?? 'standard', options.governancePack)
  const setupPackArg = bootstrapPlan.packs.join(',')
  if (options.includeAgentInit) {
    steps.push('scale init --agent <platform>  # optional: add agent-specific hooks later')
  }
  if (options.includeDependencyBootstrap !== false) {
    steps.push(`scale setup --pack ${setupPackArg} --memory-provider hrain --memory-mode local-only --json  # inspect third-party skills, CLIs, memory, and knowledge providers`)
    steps.push(`scale setup --pack ${setupPackArg} --memory-provider hrain --memory-mode local-only --apply --yes  # install and initialize governed third-party capabilities`)
    steps.push(`scale setup --verify --pack ${setupPackArg} --json  # prove setup is usable before relying on the workflow`)
  }
  steps.push(
    'scale doctor',
    'scale create Spec "<feature>"',
    'edit .scale/product-smoke.json and enable a real product-path probe',
    'scale preflight --profile productSmoke --json',
    'scale runtime final-check --level M --json',
  )
  return steps
}

export async function quickStart(projectDir: string = '.', options?: {
  installKnowledgeGraph?: boolean
  governancePack?: string
  profileId?: string
}): Promise<QuickStartResult> {
  const bootstrapPlan = getBootstrapPlanForProfile(options?.profileId ?? 'standard', options?.governancePack)
  const setupPackArg = bootstrapPlan.packs.join(',')
  const result: QuickStartResult = {
    success: false, platform: null, created: [], skipped: [],
    constraintsApplied: 0,
    workflowCapabilities: ['browser', 'search', 'computer'],
    capabilitiesEnabled: ['browser', 'search', 'computer'],
    dependencyBootstrapCommand: `scale setup --pack ${setupPackArg} --memory-provider hrain --memory-mode local-only --json`,
    nextSteps: [],
  }
  const detection = detectPlatform(projectDir)
  result.platform = detection.platform
  const governanceOnly = !detection.platform && Boolean(options?.governancePack)
  if (!detection.platform && !governanceOnly) {
    result.nextSteps.push('scale init --agent <platform>')
    return result
  }
  const scaleDir = join(projectDir, '.scale')
  for (const dir of ['events', 'artifacts', 'rules', 'hooks', 'checkpoints']) {
    const fullDir = join(scaleDir, dir)
    if (!existsSync(fullDir)) { mkdirSync(fullDir, { recursive: true }); result.created.push(fullDir) }
    else { result.skipped.push(fullDir) }
  }
  const gitignorePath = join(scaleDir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*.db\n*.db-journal\nevents/\ncheckpoints/\nevidence/\nstate/\nhooks/*.sh\n')
    result.created.push(gitignorePath)
  }
  result.constraintsApplied = detection.platform ? PHYSICAL_CONSTRAINTS.length : 0
  const projectName = projectDir.split(/[/\\]/).pop() || 'Project'
  const governance = writeGovernanceTemplates(projectDir, { mode: 'standard', projectName, pack: options?.governancePack })
  result.created.push(...governance.created)
  result.skipped.push(...governance.skipped)

  // Optional: Install governed knowledge dependencies (codegraph/graphify)
  if (options?.installKnowledgeGraph) {
    result.knowledgeGraph = await installKnowledgeGraph(projectDir, { scaleDir: '.scale' })
    if (result.knowledgeGraph.available) {
      if (result.knowledgeGraph.codegraphInstalled) {
        result.nextSteps.push('codegraph init -i .  # Build local CodeGraph index')
      }
      if (result.knowledgeGraph.graphifyInstalled) {
        result.nextSteps.push('scale graphify .  # Build code knowledge graph')
      }
    }
  } else {
    result.knowledgeGraph = checkKnowledgeGraphAvailability(projectDir, { scaleDir: '.scale' })
  }

  result.success = true
  result.nextSteps.push(...governanceNextSteps({
    includeAgentInit: !detection.platform,
    includeDependencyBootstrap: true,
    profileId: options?.profileId ?? 'standard',
    governancePack: options?.governancePack,
  }))
  return result
}

/**
 * Check if CodeGraph or Graphify are available (without installing)
 */
export function checkKnowledgeGraphAvailability(projectDir: string = '.', deps: KnowledgeGraphDeps & {
  scaleDir?: string
} = {}): KnowledgeGraphResult {
  const inspectTools = deps.inspectToolCapabilitiesImpl ?? inspectToolCapabilities
  const inspectCode = deps.inspectCodeIntelligenceImpl ?? inspectCodeIntelligence
  const execSyncImpl = deps.execSyncImpl ?? execSync
  const toolReport = inspectTools({
    projectDir,
    toolIds: ['codegraph', 'graphify'],
  })
  const codeReport = inspectCode({
    projectDir,
    scaleDir: deps.scaleDir,
  })
  const codegraphTool = toolReport.tools.find(tool => tool.id === 'codegraph')
  const graphifyTool = toolReport.tools.find(tool => tool.id === 'graphify')
  const graphifyProvider = codeReport.providers.find(provider => provider.id === 'graphify')
  const result: KnowledgeGraphResult = {
    available: false,
    graphifyInstalled: Boolean(graphifyTool?.installed),
    graphifyVersion: graphifyTool?.version,
    codegraphInstalled: Boolean(codegraphTool?.installed),
    codegraphVersion: codegraphTool?.version,
    codegraphProjectInitialized: codeReport.projectIndexExists,
    graphifyArtifactPresent: Boolean(graphifyProvider?.available),
  }

  try {
    result.pythonVersion = execSyncImpl('python3 --version', { encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    try {
      result.pythonVersion = execSyncImpl('python --version', { encoding: 'utf-8', timeout: 5000 }).trim()
    } catch {
      // Python is optional when Graphify is already installed.
    }
  }

  const instructions: string[] = []
  if (!result.codegraphInstalled || !result.graphifyInstalled) {
    instructions.push('scale setup --pack knowledge --json')
    instructions.push('scale setup --pack knowledge --apply --yes')
  }
  if (!result.pythonVersion && !result.graphifyInstalled && !result.graphifyArtifactPresent) {
    instructions.push('Install Python 3.10+ to enable Graphify CLI installation.')
  }
  if (result.codegraphInstalled && !result.codegraphProjectInitialized) {
    instructions.push('codegraph init -i .')
  }
  if (result.graphifyInstalled && !result.graphifyArtifactPresent) {
    instructions.push('Generate graphify-out/graph.json before relying on graph-backed knowledge recall.')
  }

  result.available = result.graphifyInstalled || Boolean(result.codegraphInstalled)
  result.instructions = instructions.length > 0 ? uniqueStrings(instructions) : undefined
  return result
}

/**
 * Attempt to install knowledge graph dependencies through the governed bootstrap path.
 */
export async function installKnowledgeGraph(projectDir: string = '.', deps: KnowledgeGraphDeps & {
  scaleDir?: string
} = {}): Promise<KnowledgeGraphResult> {
  const bootstrap = deps.bootstrapDependenciesImpl ?? bootstrapDependencies
  const bootstrapReport = await bootstrap({
    projectDir,
    scaleDir: deps.scaleDir,
    packIds: ['knowledge'],
    apply: true,
  })
  const result = checkKnowledgeGraphAvailability(projectDir, deps)
  const instructions = uniqueStrings([
    ...(result.instructions ?? []),
    ...bootstrapReport.recommendations,
    ...bootstrapReport.postCheckCommands,
    'scale setup --verify --pack knowledge --json',
  ])
  result.instructions = instructions.length > 0 ? instructions : undefined
  return result
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function readPackageJson(path: string): PackageJsonLike {
  const parsed = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as unknown
  if (!parsed || typeof parsed !== 'object') return {}
  return parsed as PackageJsonLike
}
