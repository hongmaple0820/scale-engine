import type { TopologyGraph, TopologyNode, ArchitectureLayer } from '../codegraph/CodeIntelligence.js'

export interface TourStop {
  nodeId: string
  title: string
  description: string
  layer: ArchitectureLayer
  relatedNodes: string[]
  order: number
}

export interface GuidedTour {
  name: string
  stops: TourStop[]
  estimatedMinutes: number
}

const LAYER_DESCRIPTIONS: Record<ArchitectureLayer, string> = {
  api: 'API layer — handles external requests and routes them to the appropriate services',
  service: 'Service layer — contains business logic and orchestrates operations',
  data: 'Data layer — manages data persistence, models, and storage',
  ui: 'UI layer — renders the user interface and handles user interactions',
  utility: 'Utility layer — provides shared helpers and common functionality',
  config: 'Configuration layer — defines settings and initialization',
  test: 'Test layer — verifies correctness through automated tests',
  unknown: 'Unclassified component',
}

export function generateTour(graph: TopologyGraph, options: { maxStops?: number; focusDomain?: string } = {}): GuidedTour {
  const maxStops = options.maxStops ?? 20
  const entryPoints = findEntryPoints(graph)
  const orderedNodes = bfsFromEntries(graph, entryPoints)
  const stops: TourStop[] = []

  for (const nodeId of orderedNodes) {
    if (stops.length >= maxStops) break
    const node = graph.nodes.find(n => n.id === nodeId)
    if (!node) continue

    const relatedNodes = findRelatedNodes(graph, nodeId)
    stops.push({
      nodeId,
      title: formatNodeTitle(node),
      description: generateStopDescription(node, graph),
      layer: node.layer ?? 'unknown',
      relatedNodes,
      order: stops.length + 1,
    })
  }

  return {
    name: options.focusDomain
      ? `${options.focusDomain} Architecture Tour`
      : 'Architecture Tour',
    stops,
    estimatedMinutes: Math.max(1, Math.ceil(stops.length * 0.5)),
  }
}

function findEntryPoints(graph: TopologyGraph): string[] {
  const incomingCount = new Map<string, number>()
  for (const edge of graph.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
  }

  // Entry points: nodes with no incoming edges, preferring main/index/app/server
  const noIncoming = graph.nodes.filter(n => (incomingCount.get(n.id) ?? 0) === 0)
  const priorityNames = ['main', 'index', 'app', 'server', 'cli', 'entry', 'run', 'start']

  const sorted = noIncoming.sort((a, b) => {
    const aPriority = priorityNames.findIndex(name => a.name.toLowerCase().includes(name))
    const bPriority = priorityNames.findIndex(name => b.name.toLowerCase().includes(name))
    const aRank = aPriority === -1 ? 999 : aPriority
    const bRank = bPriority === -1 ? 999 : bPriority
    return aRank - bRank
  })

  // If no entry points found, use all file-level nodes
  if (sorted.length === 0) {
    return graph.nodes.filter(n => n.kind === 'file').slice(0, 5).map(n => n.id)
  }

  return sorted.slice(0, 10).map(n => n.id)
}

function bfsFromEntries(graph: TopologyGraph, entries: string[]): string[] {
  const visited = new Set<string>()
  const order: string[] = []
  const queue = [...entries]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    order.push(current)

    // Follow outgoing edges (dependencies, calls)
    for (const edge of graph.edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target)
      }
    }
  }

  // Add any unvisited nodes at the end
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      order.push(node.id)
    }
  }

  return order
}

function findRelatedNodes(graph: TopologyGraph, nodeId: string): string[] {
  const related = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.source === nodeId) related.add(edge.target)
    if (edge.target === nodeId) related.add(edge.source)
  }
  return Array.from(related).slice(0, 5)
}

function formatNodeTitle(node: TopologyNode): string {
  const layerTag = node.layer ? `[${node.layer.toUpperCase()}] ` : ''
  const kindTag = node.kind === 'file' ? '' : ` (${node.kind})`
  return `${layerTag}${node.name}${kindTag}`
}

function generateStopDescription(node: TopologyNode, graph: TopologyGraph): string {
  const layerDesc = LAYER_DESCRIPTIONS[node.layer ?? 'unknown']
  const parts: string[] = [layerDesc]

  if (node.filePath) {
    parts.push(`Located in ${node.filePath}`)
  }

  // Count connections
  const outgoing = graph.edges.filter(e => e.source === node.id).length
  const incoming = graph.edges.filter(e => e.target === node.id).length
  if (outgoing > 0 || incoming > 0) {
    const connDesc: string[] = []
    if (outgoing > 0) connDesc.push(`depends on ${outgoing}`)
    if (incoming > 0) connDesc.push(`depended on by ${incoming}`)
    parts.push(`Connections: ${connDesc.join(', ')}`)
  }

  return parts.join('. ') + '.'
}
