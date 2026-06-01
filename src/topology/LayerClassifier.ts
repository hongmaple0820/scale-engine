import type { ArchitectureLayer, TopologyGraph, TopologyNode } from '../codegraph/CodeIntelligence.js'

export interface LayerRule {
  layer: ArchitectureLayer
  patterns: string[]
}

export const DEFAULT_LAYER_RULES: LayerRule[] = [
  { layer: 'api', patterns: ['**/api/**', '**/routes/**', '**/controllers/**', '**/handlers/**', '**/endpoints/**'] },
  { layer: 'service', patterns: ['**/service/**', '**/services/**', '**/domain/**', '**/core/**', '**/business/**'] },
  { layer: 'data', patterns: ['**/model/**', '**/models/**', '**/repository/**', '**/repositories/**', '**/store/**', '**/stores/**', '**/db/**', '**/database/**', '**/schema/**', '**/entities/**'] },
  { layer: 'ui', patterns: ['**/components/**', '**/views/**', '**/pages/**', '**/dashboard/**', '**/templates/**', '**/layouts/**'] },
  { layer: 'utility', patterns: ['**/util/**', '**/utils/**', '**/helpers/**', '**/lib/**', '**/common/**', '**/shared/**', '**/tools/**'] },
  { layer: 'config', patterns: ['**/config/**', '**/configuration/**', '**/*.config.*', '**/setup/**', '**/settings/**'] },
  { layer: 'test', patterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/tests/**', '**/__mocks__/**', '**/fixtures/**', '**/test/**'] },
]

const LAYER_COLORS: Record<ArchitectureLayer, string> = {
  api: '#3b82f6',
  service: '#22c55e',
  data: '#f97316',
  ui: '#a855f7',
  utility: '#6b7280',
  config: '#eab308',
  test: '#ec4899',
  unknown: '#374151',
}

export function getLayerColor(layer: ArchitectureLayer): string {
  return LAYER_COLORS[layer] ?? LAYER_COLORS.unknown
}

export function classifyLayers(graph: TopologyGraph, customRules?: LayerRule[]): TopologyGraph {
  const rules = customRules ?? DEFAULT_LAYER_RULES
  return {
    ...graph,
    nodes: graph.nodes.map(node => ({
      ...node,
      layer: classifyNode(node, rules),
    })),
  }
}

function classifyNode(node: TopologyNode, rules: LayerRule[]): ArchitectureLayer {
  // Test files are highest priority — always classify first
  if (isTestFile(node.filePath)) return 'test'

  // Path-based rules
  for (const rule of rules) {
    if (rule.layer === 'test') continue // already handled
    for (const pattern of rule.patterns) {
      if (matchesPattern(node.filePath, pattern)) return rule.layer
    }
  }

  // Symbol-name-based fallback for non-file nodes
  if (node.kind !== 'file') {
    const nameLayer = classifyBySymbolName(node.name)
    if (nameLayer) return nameLayer
  }

  return 'unknown'
}

function isTestFile(path: string): boolean {
  if (!path) return false
  const lower = path.toLowerCase()
  return (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('__tests__/') ||
    lower.includes('/tests/') ||
    lower.includes('/__mocks__/') ||
    lower.includes('/fixtures/') ||
    lower.endsWith('.test') ||
    lower.endsWith('.spec')
  )
}

function classifyBySymbolName(name: string): ArchitectureLayer | undefined {
  if (!name) return undefined
  const lower = name.toLowerCase()

  // API patterns
  if (/^(get|post|put|patch|delete|head|options)[A-Z]/.test(name)) return 'api'
  if (/router|controller|handler|endpoint|middleware/i.test(lower)) return 'api'

  // Service patterns
  if (/service|manager|processor|executor|orchestrator|coordinator/i.test(lower)) return 'service'

  // Data patterns
  if (/repository|model|entity|schema|migration|dao|dto/i.test(lower)) return 'data'

  // UI patterns
  if (/component|view|page|template|layout|widget|render/i.test(lower)) return 'ui'

  // Utility patterns
  if (/util|helper|common|shared|lib|format|parse|validate|transform/i.test(lower)) return 'utility'

  // Config patterns
  if (/config|setting|option|env|constant/i.test(lower)) return 'config'

  return undefined
}

function matchesPattern(path: string, pattern: string): boolean {
  if (!path) return false
  const normalized = path.replace(/\\/g, '/')
  const regex = globToRegex(pattern)
  return regex.test(normalized)
}

function globToRegex(glob: string): RegExp {
  let regexStr = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`(^|/)${regexStr}($|/)`)
}
