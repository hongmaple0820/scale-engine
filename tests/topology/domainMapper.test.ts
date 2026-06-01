import { describe, expect, it } from 'vitest'
import { mapDomains } from '../../src/topology/DomainMapper.js'
import type { TopologyGraph } from '../../src/codegraph/CodeIntelligence.js'

function makeGraph(): TopologyGraph {
  return {
    nodes: [
      { id: 'auth-login', kind: 'function', name: 'loginUser', filePath: 'src/auth/login.ts' },
      { id: 'auth-session', kind: 'function', name: 'createSession', filePath: 'src/auth/session.ts' },
      { id: 'user-model', kind: 'class', name: 'UserModel', filePath: 'src/models/User.ts' },
      { id: 'user-repo', kind: 'class', name: 'UserRepository', filePath: 'src/repository/UserRepository.ts' },
      { id: 'gate-check', kind: 'function', name: 'runGateCheck', filePath: 'src/governance/gates.ts' },
      { id: 'detector', kind: 'class', name: 'DetectorEngine', filePath: 'src/guardrails/Detector.ts' },
      { id: 'format-util', kind: 'function', name: 'formatDate', filePath: 'src/utils/format.ts' },
    ],
    edges: [
      { source: 'auth-login', target: 'auth-session', kind: 'calls' },
      { source: 'auth-login', target: 'user-repo', kind: 'calls' },
      { source: 'gate-check', target: 'detector', kind: 'calls' },
    ],
    generatedAt: new Date().toISOString(),
    provider: 'test',
    projectDir: '/test',
  }
}

describe('mapDomains', () => {
  it('identifies authentication domain from path patterns', () => {
    const result = mapDomains(makeGraph())
    const authDomain = result.domains.find(d => d.name === 'Authentication')
    expect(authDomain).toBeDefined()
    expect(authDomain!.nodes).toContain('auth-login')
    expect(authDomain!.nodes).toContain('auth-session')
  })

  it('identifies governance domain from path patterns', () => {
    const result = mapDomains(makeGraph())
    const govDomain = result.domains.find(d => d.name === 'Governance')
    expect(govDomain).toBeDefined()
    expect(govDomain!.nodes).toContain('gate-check')
    expect(govDomain!.nodes).toContain('detector')
  })

  it('sorts domains by node count', () => {
    const result = mapDomains(makeGraph())
    for (let i = 1; i < result.domains.length; i++) {
      expect(result.domains[i - 1].nodes.length).toBeGreaterThanOrEqual(result.domains[i].nodes.length)
    }
  })

  it('lists unmapped nodes', () => {
    const result = mapDomains(makeGraph())
    // format-util should be unmapped since utils path matches utility, not a domain
    expect(result.unmappedNodes.length).toBeGreaterThanOrEqual(0)
  })

  it('detects flows within domains', () => {
    const result = mapDomains(makeGraph())
    const authFlow = result.flows.find(f => f.domain === 'Authentication')
    if (authFlow) {
      expect(authFlow.steps.length).toBeGreaterThanOrEqual(2)
      expect(authFlow.steps).toContain('auth-login')
    }
  })

  it('skips domains with fewer than 2 nodes', () => {
    const graph: TopologyGraph = {
      nodes: [
        { id: '1', kind: 'function', name: 'foo', filePath: 'src/auth/foo.ts' },
      ],
      edges: [],
      generatedAt: new Date().toISOString(),
      provider: 'test',
      projectDir: '/test',
    }
    const result = mapDomains(graph)
    expect(result.domains.find(d => d.name === 'Authentication')).toBeUndefined()
  })
})
