import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { bootstrapDependencies, type DependencyBootstrapPackId, type DependencyBootstrapReport } from '../bootstrap/DependencyBootstrap.js'
import { inspectCodeIntelligence, type CodeIntelligenceStatusReport } from '../codegraph/CodeIntelligence.js'
import { inspectEnvironment, type EnvironmentCommandCheck, type EnvironmentDoctorReport } from '../env/EnvironmentDoctor.js'
import { inspectMemoryProviders, type MemoryProviderStatusReport } from '../memory/MemoryProviders.js'
import { inspectToolCapabilities, type ToolCapabilityReport } from '../tools/ToolCapabilityRegistry.js'

export interface SetupVerificationOptions {
  projectDir?: string
  scaleDir?: string
  packIds?: string[]
  includeIds?: string[]
}

export interface SetupVerificationReport {
  ok: boolean
  generatedAt: string
  projectDir: string
  scaleDir: string
  packIds: DependencyBootstrapPackId[]
  includeIds: string[]
  dependencyBootstrap: DependencyBootstrapReport
  environment: EnvironmentDoctorReport
  memoryProviders: MemoryProviderStatusReport
  codeIntelligence: CodeIntelligenceStatusReport
  toolCapabilities: ToolCapabilityReport
  summary: {
    blockingIssues: string[]
    dependencyStatus: {
      failed: string[]
      manualReview: string[]
      needsInit: string[]
      versionDrift: string[]
    }
    warningCount: number
    runtimeWarnings: number
    installedTools: number
    totalTools: number
    availableMemoryProviders: number
    availableCodeProviders: number
  }
  warnings: string[]
  recommendations: string[]
}

export async function verifySetup(options: SetupVerificationOptions = {}): Promise<SetupVerificationReport> {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? '.scale'
  const dependencyBootstrap = await bootstrapDependencies({
    projectDir,
    scaleDir,
    packIds: options.packIds,
    includeIds: options.includeIds,
    apply: false,
  })
  const includesMemory = dependencyBootstrap.packIds.includes('full') || dependencyBootstrap.packIds.includes('memory')
  const includesKnowledge = dependencyBootstrap.packIds.includes('full') || dependencyBootstrap.packIds.includes('knowledge')
  const environment = inspectEnvironment()
  const memoryProviders = includesMemory
    ? inspectMemoryProviders({ projectDir, scaleDir })
    : skippedMemoryProvidersReport(projectDir, dependencyBootstrap.scaleDir)
  const codeIntelligence = includesKnowledge
    ? inspectCodeIntelligence({ projectDir, scaleDir })
    : skippedCodeIntelligenceReport(projectDir, dependencyBootstrap.scaleDir)
  const toolIds = dependencyBootstrap.items.map(item => item.id)
  const toolCapabilities = inspectToolCapabilities({
    projectDir,
    homeDir: homedir(),
    toolIds,
  })

  const blockingIssues: string[] = []
  const warnings: string[] = []
  const nonBlockingDependencies = resolveNonBlockingDependencyIds(dependencyBootstrap, memoryProviders)
  const dependencyStatus = {
    failed: dependencyBootstrap.items.filter(item => item.status === 'failed').map(item => item.id),
    manualReview: dependencyBootstrap.items
      .filter(item => item.status === 'manual-review' && !nonBlockingDependencies.has(item.id))
      .map(item => item.id),
    needsInit: dependencyBootstrap.items
      .filter(item => item.status === 'needs-init' && !nonBlockingDependencies.has(item.id))
      .map(item => item.id),
    versionDrift: dependencyBootstrap.items.filter(item => item.status === 'version-drift').map(item => item.id),
  }

  if (dependencyStatus.failed.length > 0) {
    blockingIssues.push(`Dependency bootstrap failed: ${dependencyStatus.failed.join(', ')}`)
  }
  if (dependencyStatus.manualReview.length > 0) {
    blockingIssues.push(`Manual review required: ${dependencyStatus.manualReview.join(', ')}`)
  }
  if (dependencyStatus.needsInit.length > 0) {
    blockingIssues.push(`Initialization required: ${dependencyStatus.needsInit.join(', ')}`)
  }
  if (dependencyStatus.versionDrift.length > 0) {
    blockingIssues.push(`Version drift detected: ${dependencyStatus.versionDrift.join(', ')}`)
  }

  const dependencyItemsById = new Map(dependencyBootstrap.items.map(item => [item.id, item]))
  const missingRuntime = dependencyBootstrap.runtimeChecks.filter(check => check.status === 'missing')
  for (const check of missingRuntime) {
    const blocksVerification = check.requiredFor.some(id => {
      const item = dependencyItemsById.get(id)
      return !item || (item.status !== 'installed' && item.status !== 'installed-now')
    })
    const message = `Missing runtime dependency: ${check.label} (${check.requiredFor.join(', ')})`
    if (blocksVerification) blockingIssues.push(message)
  }

  const warnedRuntime = dependencyBootstrap.runtimeChecks.filter(check => check.status === 'warn')
  for (const check of warnedRuntime) {
    if (shouldWarnForRuntimeCheck(check.requiredFor, dependencyItemsById)) {
      warnings.push(compactMessage(`Runtime warning: ${check.label} - ${check.reason}`))
    }
  }

  const brokenEnvironmentChecks = environment.checks.filter(check =>
    check.required && (check.status === 'missing' || check.status === 'fail'),
  )
  for (const check of brokenEnvironmentChecks) {
    blockingIssues.push(`Required environment check failed: ${check.label} - ${check.reason}`)
  }

  if (!toolCapabilities.ok) {
    const missingTools = toolCapabilities.tools.filter(tool => !tool.installed).map(tool => tool.id)
    const blockingMissingTools = missingTools.filter(id => !nonBlockingDependencies.has(id))
    if (blockingMissingTools.length > 0) {
      blockingIssues.push(`Missing governed capabilities: ${blockingMissingTools.join(', ')}`)
    } else if (missingTools.length > 0) {
      warnings.push(`Optional governed capabilities unavailable in this runtime: ${missingTools.join(', ')}`)
    }
  }

  if (includesMemory && memoryProviders.availableProviderCount === 0) {
    blockingIssues.push('No memory provider is currently available')
  }

  if (includesKnowledge && codeIntelligence.availableProviderCount === 0 && !codeIntelligence.fallback.available) {
    blockingIssues.push('No code intelligence provider or fallback is available')
  }

  for (const check of environment.checks) {
    if (check.required || check.status !== 'warn') continue
    if (shouldSuppressEnvironmentWarning(check, dependencyItemsById)) continue
    warnings.push(compactMessage(`${check.id}: ${check.reason}`))
  }
  warnings.push(...memoryProviders.warnings.map(item => compactMessage(item)))

  const recommendations = uniqueStrings([
    ...dependencyBootstrap.postCheckCommands,
    ...dependencyBootstrap.recommendations,
    ...environment.recommendations,
    ...codeIntelligence.recommendations,
    `scale tool doctor --tools ${toolIds.join(',')} --json`,
  ].filter(Boolean))

  return {
    ok: blockingIssues.length === 0,
    generatedAt: new Date().toISOString(),
    projectDir,
    scaleDir: dependencyBootstrap.scaleDir,
    packIds: dependencyBootstrap.packIds,
    includeIds: dependencyBootstrap.includeIds,
    dependencyBootstrap,
    environment,
    memoryProviders,
    codeIntelligence,
    toolCapabilities,
    summary: {
      blockingIssues,
      dependencyStatus,
      warningCount: warnings.length,
      runtimeWarnings: warnedRuntime.length,
      installedTools: toolCapabilities.summary.installed,
      totalTools: toolCapabilities.summary.total,
      availableMemoryProviders: memoryProviders.availableProviderCount,
      availableCodeProviders: codeIntelligence.availableProviderCount,
    },
    warnings: uniqueStrings(warnings),
    recommendations,
  }
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map(item => item.trim()).filter(Boolean))]
}

function compactMessage(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}

function shouldWarnForRuntimeCheck(
  requiredFor: string[],
  dependencyItemsById: Map<string, DependencyBootstrapReport['items'][number]>,
): boolean {
  return requiredFor.some(id => {
    const item = dependencyItemsById.get(id)
    return !item || (item.status !== 'installed' && item.status !== 'installed-now')
  })
}

function shouldSuppressEnvironmentWarning(
  check: EnvironmentCommandCheck,
  dependencyItemsById: Map<string, DependencyBootstrapReport['items'][number]>,
): boolean {
  const relatedItems = ENVIRONMENT_WARNING_TOOL_MAP[check.id] ?? []
  if (relatedItems.length === 0) return false
  return relatedItems.every(id => {
    const item = dependencyItemsById.get(id)
    if (!item) return false
    return item.status === 'installed' || item.status === 'installed-now'
  })
}

const ENVIRONMENT_WARNING_TOOL_MAP: Record<string, string[]> = {
  cargo: ['rtk'],
  bun: ['gbrain'],
  python: ['graphify'],
  'python-installer': ['graphify'],
  npm: ['codegraph'],
  npx: ['awesome-design-md', 'ui-ux-pro-max', 'frontend-design'],
}

function resolveNonBlockingDependencyIds(
  _dependencyBootstrap: DependencyBootstrapReport,
  _memoryProviders: MemoryProviderStatusReport,
): Set<string> {
  return new Set<string>()
}

function skippedMemoryProvidersReport(projectDir: string, scaleDir: string): MemoryProviderStatusReport {
  const configPath = join(resolveScaleRoot(projectDir, scaleDir), 'memory-providers.json')
  return {
    projectDir,
    scaleDir,
    configPath,
    configExists: existsSync(configPath),
    routing: {
      mode: 'external-first',
      defaultOrder: ['gbrain'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers: [],
    availableProviderCount: 0,
    warnings: [],
  }
}

function skippedCodeIntelligenceReport(projectDir: string, scaleDir: string): CodeIntelligenceStatusReport {
  const configPath = join(resolveScaleRoot(projectDir, scaleDir), 'code-intelligence.json')
  const projectIndexPath = join(projectDir, '.codegraph')
  return {
    projectDir,
    scaleDir,
    configPath,
    configExists: existsSync(configPath),
    projectIndexPath,
    projectIndexExists: existsSync(projectIndexPath),
    providers: [],
    fallback: {
      enabled: false,
      tools: [],
      available: false,
      reason: 'code intelligence check skipped because the knowledge pack is not selected',
    },
    availableProviderCount: 0,
    recommendations: [],
  }
}

function resolveScaleRoot(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}
