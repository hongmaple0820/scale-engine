import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import * as childProcess from 'node:child_process'
import { estimateTokens } from '../context/ContextBudget.js'
import { externalCommandExists, runExternalCommandSync } from '../core/ExternalCommand.js'

export type CodeIntelligenceProviderType = 'external-cli' | 'artifact'
export type CodeIntelligenceCapability = 'symbols' | 'callers' | 'callees' | 'impact' | 'context' | 'summary' | 'module-map'

export interface CodeIntelligenceProviderConfig {
  id: string
  type: CodeIntelligenceProviderType
  enabled?: boolean
  command?: string
  manifest?: string
  capabilities?: CodeIntelligenceCapability[]
  source?: string
  installHint?: string
  projectInitHint?: string
  serveCommand?: string
}

export interface CodeIntelligenceConfig {
  version: string
  providers: CodeIntelligenceProviderConfig[]
  fallback: {
    enabled: boolean
    tools: string[]
  }
}

export interface CodeIntelligenceProviderStatus {
  id: string
  type: CodeIntelligenceProviderType
  enabled: boolean
  available: boolean
  capabilities: CodeIntelligenceCapability[]
  reason: string
  source?: string
  installHint?: string
  projectInitHint?: string
  serveCommand?: string
}

export interface CodeIntelligenceStatusReport {
  projectDir: string
  scaleDir: string
  configPath: string
  configExists: boolean
  projectIndexPath: string
  projectIndexExists: boolean
  providers: CodeIntelligenceProviderStatus[]
  fallback: {
    enabled: boolean
    tools: string[]
    available: boolean
    reason: string
  }
  availableProviderCount: number
  recommendations: string[]
}

export interface CodeGraphHit {
  provider: string
  file: string
  symbol?: string
  line?: number
  reason: string
  confidence: number
}

export interface CodeGraphRoiMetrics {
  graphHits: number
  fallbackCount: number
  baselineFileReads: number
  recommendedFileReads: number
  fileReadsSaved: number
  toolCallsSaved: number
}

export interface CodeGraphQueryReport {
  projectDir: string
  generatedAt: string
  mode: 'query' | 'impact' | 'context' | 'roi'
  query: string
  provider?: string
  fallbackUsed: boolean
  hits: CodeGraphHit[]
  files: string[]
  symbols: string[]
  confidence: number
  roi: CodeGraphRoiMetrics
  warnings: string[]
}

export interface CodeGraphContextFile {
  path: string
  estimatedTokens: number
  included: boolean
  reason: string
}

export interface CodeGraphContextReport extends CodeGraphQueryReport {
  budget: number
  totalEstimatedTokens: number
  contextFiles: CodeGraphContextFile[]
  omitted: CodeGraphContextFile[]
}

export interface CodeGraphRoiReport {
  projectDir: string
  generatedAt: string
  query: string
  provider?: string
  fallbackUsed: boolean
  metrics: CodeGraphRoiMetrics
  recommendation: 'keep-default' | 'keep-optional' | 'needs-evidence'
  evidenceLevel: 'measured' | 'estimated'
}

export type ArchitectureLayer = 'api' | 'service' | 'data' | 'ui' | 'utility' | 'config' | 'test' | 'unknown'

export interface TopologyNode {
  id: string
  kind: 'file' | 'function' | 'class' | 'constant' | 'module'
  name: string
  filePath: string
  line?: number
  signature?: string
  layer?: ArchitectureLayer
  domain?: string
}

export interface TopologyEdge {
  source: string
  target: string
  kind: 'calls' | 'imports' | 'extends' | 'implements' | 'depends-on'
}

export interface TopologyGraph {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  generatedAt: string
  provider: string
  projectDir: string
}

type ArtifactSymbol = {
  name: string
  file?: string
  path?: string
  callers?: unknown[]
  callees?: unknown[]
  dependencies?: unknown[]
  dependents?: unknown[]
}

type ArtifactFile = {
  path?: string
  file?: string
  symbols?: unknown[]
  imports?: unknown[]
  dependsOn?: unknown[]
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.go', '.java', '.py', '.rs', '.cs',
  '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.vue', '.svelte', '.sql',
])

const IGNORED_DIRS = new Set([
  '.git',
  '.scale',
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  '.worktrees',
])

const CODEGRAPH_SOURCE = 'https://github.com/colbymchenry/codegraph'
const CODEGRAPH_INSTALL_HINT = 'npx @colbymchenry/codegraph or npm i -g @colbymchenry/codegraph'
const CODEGRAPH_PROJECT_INIT_HINT = 'codegraph init -i'
const CODEGRAPH_SERVE_COMMAND = 'codegraph serve --mcp'
const GRAPHIFY_SOURCE = 'https://github.com/safishamsi/graphify'
const GRAPHIFY_INSTALL_HINT = 'uv tool install graphify && graphify install --platform codex'

const DEFAULT_CODEGRAPH_PROVIDER: CodeIntelligenceProviderConfig = {
  id: 'codegraph',
  type: 'external-cli',
  enabled: true,
  command: 'codegraph',
  capabilities: ['symbols', 'callers', 'callees', 'impact', 'context', 'summary', 'module-map'],
  source: CODEGRAPH_SOURCE,
  installHint: CODEGRAPH_INSTALL_HINT,
  projectInitHint: CODEGRAPH_PROJECT_INIT_HINT,
  serveCommand: CODEGRAPH_SERVE_COMMAND,
}

const DEFAULT_GRAPHIFY_PROVIDER: CodeIntelligenceProviderConfig = {
  id: 'graphify',
  type: 'artifact',
  enabled: true,
  manifest: 'graphify-out/graph.json',
  capabilities: ['symbols', 'callers', 'callees', 'impact', 'context', 'summary', 'module-map'],
  source: GRAPHIFY_SOURCE,
  installHint: GRAPHIFY_INSTALL_HINT,
}

let execFileSyncImpl: typeof childProcess.execFileSync = childProcess.execFileSync

export function setCodeIntelligenceExecFileSyncForTesting(impl?: typeof childProcess.execFileSync): void {
  execFileSyncImpl = impl ?? childProcess.execFileSync
}

export function defaultCodeIntelligenceConfig(): CodeIntelligenceConfig {
  return {
    version: '1.0',
    providers: [
      { ...DEFAULT_CODEGRAPH_PROVIDER },
      { ...DEFAULT_GRAPHIFY_PROVIDER },
    ],
    fallback: {
      enabled: true,
      tools: ['internal-scan', 'rg', 'read'],
    },
  }
}

export function codeIntelligenceConfigPath(projectDir = process.cwd(), scaleDir = '.scale'): string {
  return join(resolveScaleRoot(projectDir, scaleDir), 'code-intelligence.json')
}

export function writeCodeIntelligenceConfig(options: {
  projectDir?: string
  scaleDir?: string
  force?: boolean
} = {}): { path: string; written: boolean; config: CodeIntelligenceConfig } {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const path = codeIntelligenceConfigPath(projectDir, options.scaleDir)
  if (existsSync(path) && !options.force) {
    return { path, written: false, config: loadCodeIntelligenceConfig(projectDir, options.scaleDir).config }
  }
  mkdirSync(dirname(path), { recursive: true })
  const config = defaultCodeIntelligenceConfig()
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  return { path, written: true, config }
}

export function loadCodeIntelligenceConfig(projectDir = process.cwd(), scaleDir = '.scale'): {
  config: CodeIntelligenceConfig
  path: string
  exists: boolean
} {
  const path = codeIntelligenceConfigPath(projectDir, scaleDir)
  if (!existsSync(path)) {
    return { config: defaultCodeIntelligenceConfig(), path, exists: false }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<CodeIntelligenceConfig>
    return {
      path,
      exists: true,
      config: {
        version: parsed.version ?? '1.0',
        providers: Array.isArray(parsed.providers)
          ? parsed.providers.map(provider => hydrateProviderConfig(provider as CodeIntelligenceProviderConfig))
          : [],
        fallback: {
          enabled: parsed.fallback?.enabled !== false,
          tools: Array.isArray(parsed.fallback?.tools) ? parsed.fallback.tools.map(String) : ['internal-scan', 'rg', 'read'],
        },
      },
    }
  } catch {
    return { config: defaultCodeIntelligenceConfig(), path, exists: true }
  }
}

export function inspectCodeIntelligence(options: {
  projectDir?: string
  scaleDir?: string
} = {}): CodeIntelligenceStatusReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const loaded = loadCodeIntelligenceConfig(projectDir, options.scaleDir)
  const projectIndexPath = codegraphProjectIndexPath(projectDir)
  const projectIndexExists = existsSync(projectIndexPath)
  const providers = loaded.config.providers.map(providerStatus(projectDir))
  const availableProviderCount = providers.filter(provider => provider.available).length
  const fallbackAvailable = loaded.config.fallback.enabled
  return {
    projectDir,
    scaleDir: resolveScaleRoot(projectDir, options.scaleDir),
    configPath: loaded.path,
    configExists: loaded.exists,
    projectIndexPath,
    projectIndexExists,
    providers,
    fallback: {
      enabled: loaded.config.fallback.enabled,
      tools: loaded.config.fallback.tools,
      available: fallbackAvailable,
      reason: fallbackAvailable ? 'internal source scan fallback is available' : 'fallback is disabled by policy',
    },
    availableProviderCount,
    recommendations: recommendations(loaded.exists, providers, fallbackAvailable, projectIndexExists),
  }
}

export function queryCodeGraph(options: {
  projectDir?: string
  scaleDir?: string
  query: string
}): CodeGraphQueryReport {
  return runCodeGraphQuery({ ...options, mode: 'query' })
}

export function impactCodeGraph(options: {
  projectDir?: string
  scaleDir?: string
  symbol: string
}): CodeGraphQueryReport {
  return runCodeGraphQuery({
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
    query: options.symbol,
    mode: 'impact',
  })
}

export function buildCodeGraphContext(options: {
  projectDir?: string
  scaleDir?: string
  symbol: string
  budget?: number
}): CodeGraphContextReport {
  const budget = options.budget ?? 2000
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const externalContext = queryExternalCodeGraphContext({
    projectDir,
    scaleDir: options.scaleDir,
    query: options.symbol,
  })
  if (externalContext) {
    let total = 0
    const contextFiles: CodeGraphContextFile[] = []
    for (const file of externalContext.files) {
      const absolute = resolve(projectDir, file)
      const tokens = existsSync(absolute) && statSync(absolute).isFile()
        ? estimateTokens(readFileSync(absolute, 'utf-8'))
        : 0
      const included = total + tokens <= budget
      if (included) total += tokens
      contextFiles.push({
        path: file,
        estimatedTokens: tokens,
        included,
        reason: included ? 'within codegraph context budget' : `omitted because it would exceed budget ${budget}`,
      })
    }
    return {
      projectDir,
      generatedAt: new Date().toISOString(),
      mode: 'context',
      query: options.symbol,
      provider: 'codegraph',
      fallbackUsed: false,
      hits: externalContext.hits,
      files: externalContext.files,
      symbols: externalContext.symbols,
      confidence: confidence(externalContext.hits.length, false),
      roi: roiMetrics(externalContext.hits.length, false, externalContext.files.length),
      warnings: [`CodeGraph context summary: ${externalContext.summary}`],
      budget,
      totalEstimatedTokens: total,
      contextFiles,
      omitted: contextFiles.filter(file => !file.included),
    }
  }
  const base = impactCodeGraph(options)
  let total = 0
  const contextFiles: CodeGraphContextFile[] = []
  for (const file of base.files) {
    const absolute = resolve(options.projectDir ?? process.cwd(), file)
    const tokens = existsSync(absolute) && statSync(absolute).isFile()
      ? estimateTokens(readFileSync(absolute, 'utf-8'))
      : 0
    const included = total + tokens <= budget
    if (included) total += tokens
    contextFiles.push({
      path: file,
      estimatedTokens: tokens,
      included,
      reason: included ? 'within codegraph context budget' : `omitted because it would exceed budget ${budget}`,
    })
  }
  return {
    ...base,
    mode: 'context',
    budget,
    totalEstimatedTokens: total,
    contextFiles,
    omitted: contextFiles.filter(file => !file.included),
  }
}

export function createCodeGraphRoiReport(options: {
  projectDir?: string
  scaleDir?: string
  query?: string
  symbol?: string
}): CodeGraphRoiReport {
  const report = options.symbol
    ? impactCodeGraph({ projectDir: options.projectDir, scaleDir: options.scaleDir, symbol: options.symbol })
    : queryCodeGraph({ projectDir: options.projectDir, scaleDir: options.scaleDir, query: options.query ?? '' })
  return {
    projectDir: report.projectDir,
    generatedAt: new Date().toISOString(),
    query: report.query,
    provider: report.provider,
    fallbackUsed: report.fallbackUsed,
    metrics: report.roi,
    recommendation: report.fallbackUsed ? 'needs-evidence' : 'keep-optional',
    evidenceLevel: report.fallbackUsed ? 'estimated' : 'measured',
  }
}

export function dumpCodeGraphData(options: {
  projectDir?: string
  scaleDir?: string
}): TopologyGraph {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const status = inspectCodeIntelligence({ projectDir, scaleDir: options.scaleDir })
  const warnings: string[] = []

  // Priority 1: artifact manifest (graph.json)
  const artifactProvider = status.providers.find(p => p.available && p.type === 'artifact')
  if (artifactProvider) {
    const config = loadCodeIntelligenceConfig(projectDir, options.scaleDir).config
    const providerConfig = config.providers.find(p => p.id === artifactProvider.id)
    if (providerConfig?.manifest) {
      const result = dumpArtifactManifest(projectDir, providerConfig)
      if (result.nodes.length > 0) return result
    }
  }

  // Priority 2: codegraph CLI (full index)
  const externalProvider = status.providers.find(p => p.available && p.type === 'external-cli' && p.id === 'codegraph')
  if (externalProvider && status.projectIndexExists) {
    const result = dumpExternalCodeGraph(projectDir)
    if (result.nodes.length > 0) return result
  }

  // Priority 3: fallback file walk
  return dumpFallbackTopology(projectDir)
}

function dumpArtifactManifest(projectDir: string, provider: CodeIntelligenceProviderConfig): TopologyGraph {
  if (!provider.manifest) return emptyTopology(projectDir, provider.id)
  const manifest = resolveProjectPath(projectDir, provider.manifest)
  if (!existsSync(manifest)) return emptyTopology(projectDir, provider.id)
  try {
    const content = readFileSync(manifest, 'utf-8')
    const parsed = JSON.parse(content) as { symbols?: ArtifactSymbol[]; files?: ArtifactFile[] }
    const symbols = Array.isArray(parsed.symbols) ? parsed.symbols : []
    const files = Array.isArray(parsed.files) ? parsed.files : []
    const nodes: TopologyNode[] = []
    const edges: TopologyEdge[] = []
    const nodeIds = new Set<string>()

    // Symbol nodes
    for (const sym of symbols) {
      const name = String(sym.name ?? '')
      const file = normalizeManifestPath(sym.file ?? sym.path)
      if (!name) continue
      const id = file ? `${file}::${name}` : name
      nodeIds.add(id)
      nodes.push({
        id,
        kind: guessSymbolKind(name),
        name,
        filePath: file || '',
      })

      // Edges from callers/callees/dependencies
      for (const callee of stringifyArray(sym.callees)) {
        const target = resolveEdgeTarget(callee, symbols)
        if (target) edges.push({ source: id, target, kind: 'calls' })
      }
      for (const dep of stringifyArray(sym.dependencies)) {
        const target = resolveEdgeTarget(dep, symbols)
        if (target) edges.push({ source: id, target, kind: 'depends-on' })
      }
      for (const caller of stringifyArray(sym.callers)) {
        const target = resolveEdgeTarget(caller, symbols)
        if (target) edges.push({ source: target, target: id, kind: 'calls' })
      }
      for (const dependent of stringifyArray(sym.dependents)) {
        const target = resolveEdgeTarget(dependent, symbols)
        if (target) edges.push({ source: target, target: id, kind: 'depends-on' })
      }
    }

    // File nodes (for files not yet represented by symbols)
    for (const file of files) {
      const path = normalizeManifestPath(file.path ?? file.file)
      if (!path) continue
      const fileId = `file:${path}`
      if (!nodeIds.has(fileId)) {
        nodeIds.add(fileId)
        nodes.push({ id: fileId, kind: 'file', name: path.split('/').pop() ?? path, filePath: path })
      }
      // Import edges
      for (const imp of stringifyArray(file.imports)) {
        const targetFile = normalizeManifestPath(imp)
        if (targetFile) {
          const targetId = `file:${targetFile}`
          edges.push({ source: fileId, target: targetId, kind: 'imports' })
        }
      }
      // dependsOn edges
      for (const dep of stringifyArray(file.dependsOn)) {
        const targetFile = normalizeManifestPath(dep)
        if (targetFile) {
          const targetId = `file:${targetFile}`
          edges.push({ source: fileId, target: targetId, kind: 'depends-on' })
        }
      }
    }

    return {
      nodes: dedupeTopologyNodes(nodes),
      edges: dedupeTopologyEdges(edges),
      generatedAt: new Date().toISOString(),
      provider: provider.id,
      projectDir,
    }
  } catch {
    return emptyTopology(projectDir, provider.id)
  }
}

function dumpExternalCodeGraph(projectDir: string): TopologyGraph {
  try {
    // Use codegraph CLI to get a broad dump via empty query
    const output = runExternalCommandSync('codegraph', ['query', '', '-p', projectDir, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }, {
      execFileSync: execFileSyncImpl,
      spawnSync: childProcess.spawnSync,
    })
    const parsed = JSON.parse(String(output)) as Array<{
      node?: { kind?: string; name?: string; qualifiedName?: string; filePath?: string; startLine?: number }
    }>
    const nodes: TopologyNode[] = []
    const seen = new Set<string>()
    for (const entry of parsed) {
      const file = normalizeManifestPath(entry.node?.filePath)
      const name = String(entry.node?.qualifiedName ?? entry.node?.name ?? '').trim()
      if (!file || !name) continue
      const id = `${file}::${name}`
      if (seen.has(id)) continue
      seen.add(id)
      nodes.push({
        id,
        kind: mapCodeGraphKind(entry.node?.kind),
        name,
        filePath: file,
        line: entry.node?.startLine,
      })
    }
    return {
      nodes,
      edges: [], // CLI doesn't return edge data in query mode
      generatedAt: new Date().toISOString(),
      provider: 'codegraph',
      projectDir,
    }
  } catch {
    return emptyTopology(projectDir, 'codegraph')
  }
}

function dumpFallbackTopology(projectDir: string): TopologyGraph {
  const files = sourceFiles(projectDir)
  const nodes: TopologyNode[] = files.map(file => {
    const rel = normalizePath(relative(projectDir, file))
    return {
      id: `file:${rel}`,
      kind: 'file' as const,
      name: rel.split('/').pop() ?? rel,
      filePath: rel,
    }
  })
  return {
    nodes,
    edges: [],
    generatedAt: new Date().toISOString(),
    provider: 'fallback-file-walk',
    projectDir,
  }
}

function resolveEdgeTarget(ref: string, symbols: ArtifactSymbol[]): string | undefined {
  const asPath = normalizeManifestPath(ref)
  if (asPath && hasFileExtension(asPath)) {
    // Reference is a file path — find a symbol in that file
    const sym = symbols.find(s => normalizeManifestPath(s.file ?? s.path) === asPath)
    return sym ? `${asPath}::${sym.name}` : `file:${asPath}`
  }
  // Reference is a symbol name
  const sym = symbols.find(s => String(s.name) === ref)
  if (sym) {
    const file = normalizeManifestPath(sym.file ?? sym.path)
    return file ? `${file}::${ref}` : ref
  }
  return undefined
}

function guessSymbolKind(name: string): TopologyNode['kind'] {
  if (/^[A-Z]/.test(name)) return 'class'
  if (/^[A-Z_][A-Z_0-9]*$/.test(name)) return 'constant'
  return 'function'
}

function mapCodeGraphKind(kind?: string): TopologyNode['kind'] {
  switch (kind?.toLowerCase()) {
    case 'class': case 'struct': case 'interface': case 'type': return 'class'
    case 'function': case 'method': case 'constructor': return 'function'
    case 'constant': case 'enum': return 'constant'
    case 'module': case 'namespace': case 'package': return 'module'
    default: return 'function'
  }
}

function dedupeTopologyNodes(nodes: TopologyNode[]): TopologyNode[] {
  const seen = new Set<string>()
  return nodes.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true })
}

function dedupeTopologyEdges(edges: TopologyEdge[]): TopologyEdge[] {
  const seen = new Set<string>()
  return edges.filter(e => {
    const key = `${e.source}->${e.target}:${e.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function emptyTopology(projectDir: string, provider: string): TopologyGraph {
  return { nodes: [], edges: [], generatedAt: new Date().toISOString(), provider, projectDir }
}

function runCodeGraphQuery(options: {
  projectDir?: string
  scaleDir?: string
  query: string
  mode: 'query' | 'impact'
}): CodeGraphQueryReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const query = options.query.trim()
  const status = inspectCodeIntelligence({ projectDir, scaleDir: options.scaleDir })
  const available = status.providers.find(provider => provider.available && provider.type === 'artifact')
  const externalAvailable = status.providers.find(provider => provider.available && provider.type === 'external-cli')
  const warnings: string[] = []
  let hits: CodeGraphHit[] = []
  let provider: string | undefined
  let fallbackUsed = false

  if (available) {
    const config = loadCodeIntelligenceConfig(projectDir, options.scaleDir).config
    const providerConfig = config.providers.find(item => item.id === available.id)
    if (providerConfig) {
      hits = queryArtifactProvider(projectDir, providerConfig, query, options.mode)
      provider = providerConfig.id
      if (hits.length === 0) warnings.push(`Provider ${providerConfig.id} returned no hits for "${query}".`)
    }
  } else if (externalAvailable?.id === 'codegraph' && status.projectIndexExists && options.mode === 'query') {
    const externalQuery = queryExternalCodeGraph(projectDir, query)
    if (externalQuery) {
      hits = externalQuery.hits
      provider = externalAvailable.id
      warnings.push(...externalQuery.warnings)
      if (hits.length === 0) warnings.push(`Provider ${externalAvailable.id} returned no hits for "${query}".`)
    }
  } else if (externalAvailable) {
    if (externalAvailable.id === 'codegraph' && !status.projectIndexExists) {
      warnings.push('CodeGraph CLI is installed, but this project has no .codegraph/ index yet; run codegraph init -i to enable upstream graph queries.')
    } else {
      warnings.push(`External provider ${externalAvailable.id} is available, but no command adapter is configured yet; using fallback unless an artifact provider is configured.`)
    }
  }

  if (hits.length === 0 && status.fallback.enabled) {
    fallbackUsed = true
    provider = undefined
    hits = fallbackSourceScan(projectDir, query)
    warnings.push('Used internal source scan fallback because no graph provider produced hits.')
  } else if (hits.length === 0) {
    warnings.push('Fallback is disabled by code-intelligence policy.')
  }

  const files = unique(hits.map(hit => hit.file).filter(Boolean))
  const symbols = unique(hits.map(hit => hit.symbol).filter((value): value is string => Boolean(value)))
  const roi = roiMetrics(hits.length, fallbackUsed, files.length)
  return {
    projectDir,
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    query,
    provider,
    fallbackUsed,
    hits,
    files,
    symbols,
    confidence: confidence(hits.length, fallbackUsed),
    roi,
    warnings,
  }
}

function providerStatus(projectDir: string): (provider: CodeIntelligenceProviderConfig) => CodeIntelligenceProviderStatus {
  return provider => {
    const enabled = provider.enabled !== false
    const capabilities = provider.capabilities ?? []
    const projectIndexExists = existsSync(codegraphProjectIndexPath(projectDir))
    if (!enabled) {
      return {
        id: provider.id,
        type: provider.type,
        enabled,
        available: false,
        capabilities,
        reason: 'provider disabled by policy',
        source: provider.source,
        installHint: provider.installHint,
        projectInitHint: provider.projectInitHint,
        serveCommand: provider.serveCommand,
      }
    }
    if (provider.type === 'artifact') {
      const manifest = provider.manifest ? resolveProjectPath(projectDir, provider.manifest) : ''
      const available = Boolean(manifest && existsSync(manifest))
      return {
        id: provider.id,
        type: provider.type,
        enabled,
        available,
        capabilities,
        reason: available ? `manifest found at ${provider.manifest}` : `manifest not found: ${provider.manifest ?? '(missing)'}`,
        source: provider.source,
        installHint: provider.installHint,
        projectInitHint: provider.projectInitHint,
        serveCommand: provider.serveCommand,
      }
    }
    if (provider.type === 'external-cli') {
      const available = provider.command ? commandExists(provider.command) : false
      const readinessSuffix = provider.id === 'codegraph'
        ? projectIndexExists
          ? '; project index found at .codegraph/'
          : '; project index missing (.codegraph/)'
        : ''
      return {
        id: provider.id,
        type: provider.type,
        enabled,
        available,
        capabilities,
        reason: available ? `command available: ${provider.command}${readinessSuffix}` : `command not found: ${provider.command ?? '(missing)'}`,
        source: provider.source,
        installHint: provider.installHint,
        projectInitHint: provider.projectInitHint,
        serveCommand: provider.serveCommand,
      }
    }
    return {
      id: provider.id,
      type: provider.type,
      enabled,
      available: false,
      capabilities,
      reason: 'unknown provider type',
      source: provider.source,
      installHint: provider.installHint,
      projectInitHint: provider.projectInitHint,
      serveCommand: provider.serveCommand,
    }
  }
}

function queryArtifactProvider(projectDir: string, provider: CodeIntelligenceProviderConfig, query: string, mode: 'query' | 'impact'): CodeGraphHit[] {
  if (!provider.manifest) return []
  const manifest = resolveProjectPath(projectDir, provider.manifest)
  if (!existsSync(manifest)) return []
  const content = readFileSync(manifest, 'utf-8')
  if (extname(manifest).toLowerCase() === '.json') {
    try {
      return queryJsonManifest(projectDir, provider.id, content, query, mode)
    } catch {
      return []
    }
  }
  return queryTextManifest(projectDir, provider.id, provider.manifest, content, query)
}

function queryJsonManifest(projectDir: string, provider: string, content: string, query: string, mode: 'query' | 'impact'): CodeGraphHit[] {
  const parsed = JSON.parse(content) as { symbols?: ArtifactSymbol[]; files?: ArtifactFile[] }
  const symbols = Array.isArray(parsed.symbols) ? parsed.symbols : []
  const files = Array.isArray(parsed.files) ? parsed.files : []
  const symbolByName = new Map(symbols.map(symbol => [String(symbol.name), symbol]))
  const hits: CodeGraphHit[] = []
  const lower = query.toLowerCase()

  for (const symbol of symbols) {
    const name = String(symbol.name ?? '')
    const file = normalizeManifestPath(symbol.file ?? symbol.path)
    if (!name || !file) continue
    if (name.toLowerCase().includes(lower) || file.toLowerCase().includes(lower)) {
      hits.push({ provider, file, symbol: name, reason: 'symbol matched graph manifest', confidence: 0.86 })
      if (mode === 'impact') {
        for (const ref of relatedFiles(symbol, symbolByName)) {
          hits.push({ provider, file: ref, symbol: name, reason: 'related caller/callee from graph manifest', confidence: 0.78 })
        }
      }
    }
  }

  for (const file of files) {
    const path = normalizeManifestPath(file.path ?? file.file)
    if (!path) continue
    const fileSymbols = stringifyList(file.symbols)
    if (path.toLowerCase().includes(lower) || fileSymbols.toLowerCase().includes(lower)) {
      hits.push({ provider, file: path, reason: 'file matched graph manifest', confidence: 0.7 })
    }
  }

  return dedupeHits(hits.filter(hit => existsOrLooksLikePath(projectDir, hit.file)))
}

function queryTextManifest(projectDir: string, provider: string, manifestPath: string, content: string, query: string): CodeGraphHit[] {
  const lower = query.toLowerCase()
  return content.split(/\r?\n/).flatMap((line, index) => {
    if (!line.toLowerCase().includes(lower)) return []
    return [{
      provider,
      file: normalizePath(manifestPath),
      line: index + 1,
      reason: 'text graph artifact matched query',
      confidence: 0.45,
    }]
  }).filter(hit => existsOrLooksLikePath(projectDir, hit.file)).slice(0, 30)
}

function fallbackSourceScan(projectDir: string, query: string): CodeGraphHit[] {
  if (!query) return []
  const files = sourceFiles(projectDir)
  const lower = query.toLowerCase()
  const hits: CodeGraphHit[] = []
  for (const file of files) {
    const content = safeRead(file)
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].toLowerCase().includes(lower)) continue
      hits.push({
        provider: 'fallback-internal-scan',
        file: normalizePath(relative(projectDir, file)),
        line: i + 1,
        reason: 'fallback source text match',
        confidence: 0.35,
      })
      break
    }
    if (hits.length >= 30) break
  }
  return hits
}

function sourceFiles(projectDir: string): string[] {
  const files: string[] = []
  walk(projectDir, projectDir, files)
  return files
}

function walk(dir: string, projectDir: string, files: string[]) {
  const base = normalizePath(relative(projectDir, dir)).split('/').pop() ?? ''
  if (IGNORED_DIRS.has(base)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(absolute, projectDir, files)
      continue
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(absolute)
  }
}

function relatedFiles(symbol: ArtifactSymbol, symbolByName: Map<string, ArtifactSymbol>): string[] {
  const refs = [
    ...stringifyArray(symbol.callers),
    ...stringifyArray(symbol.callees),
    ...stringifyArray(symbol.dependencies),
    ...stringifyArray(symbol.dependents),
  ]
  return unique(refs.flatMap(ref => {
    const asPath = normalizeManifestPath(ref)
    if (asPath && hasFileExtension(asPath)) return [asPath]
    const related = symbolByName.get(ref)
    const relatedPath = normalizeManifestPath(related?.file ?? related?.path)
    return relatedPath ? [relatedPath] : []
  }))
}

function stringifyArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      return String(record.file ?? record.path ?? record.name ?? '')
    }
    return ''
  }).filter(Boolean) : []
}

function stringifyList(value: unknown): string {
  return stringifyArray(value).join(' ')
}

function normalizeManifestPath(value: unknown): string {
  if (!value) return ''
  return normalizePath(String(value).trim())
}

function existsOrLooksLikePath(projectDir: string, file: string): boolean {
  return hasFileExtension(file) || existsSync(resolve(projectDir, file))
}

function hasFileExtension(path: string): boolean {
  return Boolean(extname(path))
}

function roiMetrics(hitCount: number, fallbackUsed: boolean, fileCount: number): CodeGraphRoiMetrics {
  const baselineFileReads = Math.max(fileCount + 4, hitCount, 1)
  const recommendedFileReads = fileCount
  return {
    graphHits: fallbackUsed ? 0 : hitCount,
    fallbackCount: fallbackUsed ? 1 : 0,
    baselineFileReads,
    recommendedFileReads,
    fileReadsSaved: Math.max(0, baselineFileReads - recommendedFileReads),
    toolCallsSaved: Math.max(0, (fallbackUsed ? 1 : 3) - 1),
  }
}

function confidence(hitCount: number, fallbackUsed: boolean): number {
  if (hitCount === 0) return 0
  return fallbackUsed ? 0.35 : Math.min(0.9, 0.55 + hitCount * 0.05)
}

function recommendations(configExists: boolean, providers: CodeIntelligenceProviderStatus[], fallbackAvailable: boolean, projectIndexExists: boolean): string[] {
  const output: string[] = []
  const codegraph = providers.find(provider => provider.id === 'codegraph')
  if (!configExists) output.push('Run scale codegraph init to create .scale/code-intelligence.json.')
  if (codegraph && !codegraph.available && codegraph.installHint) {
    output.push(`Install CodeGraph from ${codegraph.source ?? CODEGRAPH_SOURCE}: ${codegraph.installHint}.`)
  }
  if (codegraph?.available && !projectIndexExists) {
    output.push('Run codegraph init -i in the project root to build the local .codegraph/ index.')
  }
  if (providers.every(provider => !provider.available)) output.push('No graph provider is available; exploration will use explicit fallback.')
  if (!fallbackAvailable) output.push('Fallback is disabled; missing providers may leave code intelligence unavailable.')
  return output
}

function commandExists(command: string): boolean {
  return externalCommandExists(command, {
    execFileSync: execFileSyncImpl,
    spawnSync: childProcess.spawnSync,
  })
}

function resolveScaleRoot(projectDir: string, scaleDir = '.scale'): string {
  return isAbsolute(scaleDir) ? scaleDir : resolve(projectDir, scaleDir)
}

function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean).map(normalizePath)))
}

function dedupeHits(hits: CodeGraphHit[]): CodeGraphHit[] {
  const seen = new Set<string>()
  return hits.filter(hit => {
    const key = `${hit.provider}:${hit.file}:${hit.symbol ?? ''}:${hit.line ?? ''}:${hit.reason}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hydrateProviderConfig(provider: CodeIntelligenceProviderConfig): CodeIntelligenceProviderConfig {
  const defaults = provider.id === 'codegraph'
    ? DEFAULT_CODEGRAPH_PROVIDER
    : provider.id === 'graphify'
      ? DEFAULT_GRAPHIFY_PROVIDER
      : undefined
  return {
    ...(defaults ?? {}),
    ...provider,
    capabilities: provider.capabilities ?? defaults?.capabilities,
    source: provider.source ?? defaults?.source,
    installHint: provider.installHint ?? defaults?.installHint,
    projectInitHint: provider.projectInitHint ?? defaults?.projectInitHint,
    serveCommand: provider.serveCommand ?? defaults?.serveCommand,
  }
}

function codegraphProjectIndexPath(projectDir: string): string {
  return join(projectDir, '.codegraph')
}

function queryExternalCodeGraph(projectDir: string, query: string): { hits: CodeGraphHit[]; warnings: string[] } | null {
  try {
    const output = runExternalCommandSync('codegraph', ['query', query, '-p', projectDir, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }, {
      execFileSync: execFileSyncImpl,
      spawnSync: childProcess.spawnSync,
    })
    const parsed = JSON.parse(String(output)) as Array<{
      node?: {
        kind?: string
        name?: string
        qualifiedName?: string
        filePath?: string
        startLine?: number
      }
    }>
    const hits = parsed.flatMap((entry, index) => {
      const file = normalizeManifestPath(entry.node?.filePath)
      const symbol = String(entry.node?.qualifiedName ?? entry.node?.name ?? '').trim()
      if (!file) return []
      return [{
        provider: 'codegraph',
        file,
        symbol: symbol || undefined,
        line: entry.node?.startLine,
        reason: `CodeGraph CLI symbol search match${entry.node?.kind ? ` (${entry.node.kind})` : ''}`,
        confidence: Math.max(0.55, Math.min(0.95, 0.9 - index * 0.05)),
      }]
    })
    return {
      hits: dedupeHits(hits.filter(hit => existsOrLooksLikePath(projectDir, hit.file))),
      warnings: [],
    }
  } catch (error) {
    return {
      hits: [],
      warnings: [`CodeGraph CLI query failed: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function queryExternalCodeGraphContext(options: {
  projectDir: string
  scaleDir?: string
  query: string
}): { summary: string; hits: CodeGraphHit[]; files: string[]; symbols: string[] } | null {
  const status = inspectCodeIntelligence({ projectDir: options.projectDir, scaleDir: options.scaleDir })
  const provider = status.providers.find(item => item.id === 'codegraph' && item.available)
  if (!provider || !status.projectIndexExists) return null
  try {
    const output = runExternalCommandSync('codegraph', ['context', options.query, '-p', options.projectDir, '--format', 'json', '--no-code'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }, {
      execFileSync: execFileSyncImpl,
      spawnSync: childProcess.spawnSync,
    })
    const parsed = JSON.parse(String(output)) as {
      summary?: string
      entryPoints?: Array<{
        kind?: string
        name?: string
        qualifiedName?: string
        filePath?: string
        startLine?: number
      }>
      relatedFiles?: string[]
    }
    const hits = Array.isArray(parsed.entryPoints)
      ? parsed.entryPoints.flatMap((entry, index) => {
          const file = normalizeManifestPath(entry.filePath)
          const symbol = String(entry.qualifiedName ?? entry.name ?? '').trim()
          if (!file) return []
          return [{
            provider: 'codegraph',
            file,
            symbol: symbol || undefined,
            line: entry.startLine,
            reason: `CodeGraph CLI context entry point${entry.kind ? ` (${entry.kind})` : ''}`,
            confidence: Math.max(0.55, Math.min(0.92, 0.88 - index * 0.05)),
          }]
        })
      : []
    const files = unique((parsed.relatedFiles ?? []).map(file => normalizeManifestPath(file)).filter(Boolean))
    if (hits.length === 0 && files.length === 0) return null
    return {
      summary: parsed.summary ?? 'CodeGraph returned related files and entry points.',
      hits: dedupeHits(hits.filter(hit => existsOrLooksLikePath(options.projectDir, hit.file))),
      files,
      symbols: unique(hits.map(hit => hit.symbol).filter((value): value is string => Boolean(value))),
    }
  } catch {
    return null
  }
}
