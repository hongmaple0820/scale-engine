import type { TopologyGraph, TopologyNode } from '../codegraph/CodeIntelligence.js'

export interface BusinessDomain {
  name: string
  nodes: string[]
  confidence: number
}

export interface DomainFlow {
  name: string
  domain: string
  steps: string[]
}

export interface DomainMapping {
  domains: BusinessDomain[]
  flows: DomainFlow[]
  unmappedNodes: string[]
}

interface DomainPattern {
  domain: string
  pathPatterns: string[]
  symbolPatterns: RegExp[]
}

const DEFAULT_DOMAIN_PATTERNS: DomainPattern[] = [
  {
    domain: 'Authentication',
    pathPatterns: ['**/auth/**', '**/authentication/**', '**/login/**', '**/session/**', '**/oauth/**', '**/jwt/**'],
    symbolPatterns: [/auth/i, /login/i, /logout/i, /session/i, /token/i, /jwt/i, /credential/i, /password/i],
  },
  {
    domain: 'Authorization',
    pathPatterns: ['**/permission/**', '**/permissions/**', '**/rbac/**', '**/acl/**', '**/policy/**', '**/policies/**'],
    symbolPatterns: [/permission/i, /authorize/i, /acl/i, /rbac/i, /role/i, /guard/i, /access.?control/i],
  },
  {
    domain: 'User Management',
    pathPatterns: ['**/user/**', '**/users/**', '**/account/**', '**/accounts/**', '**/profile/**'],
    symbolPatterns: [/user/i, /account/i, /profile/i, /member/i, /subscriber/i],
  },
  {
    domain: 'Governance',
    pathPatterns: ['**/governance/**', '**/guardrails/**', '**/gate*/**', '**/policy/**', '**/detector*/**'],
    symbolPatterns: [/govern/i, /guardrail/i, /gate/i, /detector/i, /policy/i, /compliance/i],
  },
  {
    domain: 'Workflow',
    pathPatterns: ['**/workflow/**', '**/workflows/**', '**/pipeline/**', '**/orchestrat*/**', '**/fsm/**'],
    symbolPatterns: [/workflow/i, /pipeline/i, /orchestrat/i, /fsm/i, /state.?machine/i, /phase/i],
  },
  {
    domain: 'Artifact Management',
    pathPatterns: ['**/artifact/**', '**/artifacts/**', '**/document*/**'],
    symbolPatterns: [/artifact/i, /document/i, /report/i, /evidence/i],
  },
  {
    domain: 'Knowledge',
    pathPatterns: ['**/knowledge/**', '**/memory/**', '**/brain/**', '**/learning/**'],
    symbolPatterns: [/knowledge/i, /memory/i, /brain/i, /learn/i, /instinct/i, /lesson/i],
  },
  {
    domain: 'CLI',
    pathPatterns: ['**/cli/**', '**/command*/**', '**/terminal/**'],
    symbolPatterns: [/cli/i, /command/i, /terminal/i, /arg/i, /flag/i, /subcommand/i],
  },
  {
    domain: 'Monitoring',
    pathPatterns: ['**/monitor*/**', '**/metric*/**', '**/telemetry/**', '**/observ*/**', '**/dashboard/**', '**/event*/**'],
    symbolPatterns: [/metric/i, /monitor/i, /telemetry/i, /observ/i, /dashboard/i, /event/i, /log/i],
  },
  {
    domain: 'Security',
    pathPatterns: ['**/security/**', '**/crypto/**', '**/encrypt*/**', '**/secret*/**'],
    symbolPatterns: [/security/i, /encrypt/i, /decrypt/i, /hash/i, /secret/i, /sanitize/i, /xss/i, /csrf/i, /owasp/i],
  },
  {
    domain: 'Testing',
    pathPatterns: ['**/test/**', '**/tests/**', '**/__tests__/**', '**/e2e/**', '**/eval/**'],
    symbolPatterns: [/test/i, /mock/i, /stub/i, /fixture/i, /assert/i, /expect/i, /eval/i],
  },
  {
    domain: 'AI/LLM Integration',
    pathPatterns: ['**/ai/**', '**/llm/**', '**/agent*/**', '**/prompt*/**', '**/model*/**', '**/routing/**'],
    symbolPatterns: [/agent/i, /llm/i, /prompt/i, /model/i, /token/i, /embedding/i, /completion/i],
  },
]

export function mapDomains(graph: TopologyGraph, customPatterns?: DomainPattern[]): DomainMapping {
  const patterns = customPatterns ?? DEFAULT_DOMAIN_PATTERNS
  const domainAssignments = new Map<string, Map<string, number>>() // domain -> nodeId -> confidence

  for (const node of graph.nodes) {
    const matches = matchNodeDomains(node, patterns)
    for (const { domain, confidence } of matches) {
      if (!domainAssignments.has(domain)) domainAssignments.set(domain, new Map())
      domainAssignments.get(domain)!.set(node.id, confidence)
    }
  }

  const domains: BusinessDomain[] = []
  for (const [domain, nodeMap] of domainAssignments) {
    const nodeIds = Array.from(nodeMap.keys())
    const avgConfidence = Array.from(nodeMap.values()).reduce((a, b) => a + b, 0) / nodeMap.size
    if (nodeIds.length >= 2) {
      domains.push({ name: domain, nodes: nodeIds, confidence: Math.round(avgConfidence * 100) / 100 })
    }
  }

  // Sort by node count descending
  domains.sort((a, b) => b.nodes.length - a.nodes.length)

  const mappedNodeIds = new Set(domains.flatMap(d => d.nodes))
  const unmappedNodes = graph.nodes.map(n => n.id).filter(id => !mappedNodeIds.has(id))

  // Detect flows: BFS through edges within each domain
  const flows = detectFlows(graph, domains)

  return { domains, flows, unmappedNodes }
}

function matchNodeDomains(node: TopologyNode, patterns: DomainPattern[]): Array<{ domain: string; confidence: number }> {
  const results: Array<{ domain: string; confidence: number }> = []
  const normalizedPath = node.filePath?.replace(/\\/g, '/') ?? ''

  for (const pattern of patterns) {
    let confidence = 0

    // Path pattern match (high confidence)
    for (const pathPattern of pattern.pathPatterns) {
      if (matchesGlob(normalizedPath, pathPattern)) {
        confidence = Math.max(confidence, 0.85)
        break
      }
    }

    // Symbol name match (medium confidence)
    for (const symRegex of pattern.symbolPatterns) {
      if (symRegex.test(node.name)) {
        confidence = Math.max(confidence, 0.6)
        break
      }
    }

    if (confidence > 0) {
      results.push({ domain: pattern.domain, confidence })
    }
  }

  return results
}

function detectFlows(graph: TopologyGraph, domains: BusinessDomain[]): DomainFlow[] {
  const flows: DomainFlow[] = []
  const nodeToDomain = new Map<string, string>()
  for (const domain of domains) {
    for (const nodeId of domain.nodes) {
      nodeToDomain.set(nodeId, domain.name)
    }
  }

  // For each domain, find entry points (nodes with no incoming edges within domain)
  for (const domain of domains) {
    const domainNodeSet = new Set(domain.nodes)
    const incomingCount = new Map<string, number>()
    for (const edge of graph.edges) {
      if (domainNodeSet.has(edge.source) && domainNodeSet.has(edge.target)) {
        incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1)
      }
    }

    const entryPoints = domain.nodes.filter(id => (incomingCount.get(id) ?? 0) === 0)
    if (entryPoints.length === 0 && domain.nodes.length > 0) {
      entryPoints.push(domain.nodes[0])
    }

    // BFS from each entry point to find flows
    for (const entry of entryPoints.slice(0, 3)) {
      const steps = bfsWithinDomain(graph, entry, domainNodeSet)
      if (steps.length >= 2) {
        flows.push({
          name: `${domain.name} flow`,
          domain: domain.name,
          steps,
        })
      }
    }
  }

  return flows
}

function bfsWithinDomain(graph: TopologyGraph, start: string, domainNodes: Set<string>): string[] {
  const visited = new Set<string>()
  const queue: string[] = [start]
  const order: string[] = []

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    order.push(current)

    for (const edge of graph.edges) {
      if (edge.source === current && domainNodes.has(edge.target) && !visited.has(edge.target)) {
        queue.push(edge.target)
      }
    }
  }

  return order
}

function matchesGlob(path: string, glob: string): boolean {
  if (!path) return false
  const regexStr = glob
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`(^|/)${regexStr}($|/)`).test(path)
}
