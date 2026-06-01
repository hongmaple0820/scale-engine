import { describe, expect, it } from 'vitest'
import { classifyLayers, DEFAULT_LAYER_RULES, getLayerColor } from '../../src/topology/LayerClassifier.js'
import type { TopologyGraph } from '../../src/codegraph/CodeIntelligence.js'

function makeGraph(nodes: Array<{ id: string; filePath: string; name?: string; kind?: 'file' | 'function' | 'class' }>): TopologyGraph {
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      kind: n.kind ?? 'file',
      name: n.name ?? n.id,
      filePath: n.filePath,
    })),
    edges: [],
    generatedAt: new Date().toISOString(),
    provider: 'test',
    projectDir: '/test',
  }
}

describe('classifyLayers', () => {
  it('classifies API layer from path patterns', () => {
    const graph = makeGraph([
      { id: '1', filePath: 'src/api/users.ts' },
      { id: '2', filePath: 'src/routes/auth.ts' },
      { id: '3', filePath: 'src/controllers/userController.ts' },
    ])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('api')
    expect(result.nodes[1].layer).toBe('api')
    expect(result.nodes[2].layer).toBe('api')
  })

  it('classifies service layer', () => {
    const graph = makeGraph([{ id: '1', filePath: 'src/services/AuthService.ts' }])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('service')
  })

  it('classifies data layer', () => {
    const graph = makeGraph([
      { id: '1', filePath: 'src/models/User.ts' },
      { id: '2', filePath: 'src/repository/UserRepository.ts' },
      { id: '3', filePath: 'src/store/sessionStore.ts' },
    ])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('data')
    expect(result.nodes[1].layer).toBe('data')
    expect(result.nodes[2].layer).toBe('data')
  })

  it('classifies UI layer', () => {
    const graph = makeGraph([{ id: '1', filePath: 'src/components/Header.tsx' }])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('ui')
  })

  it('classifies test layer with highest priority', () => {
    const graph = makeGraph([
      { id: '1', filePath: 'src/api/users.test.ts' },
      { id: '2', filePath: 'tests/integration/auth.spec.ts' },
    ])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('test')
    expect(result.nodes[1].layer).toBe('test')
  })

  it('classifies utility layer', () => {
    const graph = makeGraph([{ id: '1', filePath: 'src/utils/format.ts' }])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('utility')
  })

  it('classifies config layer', () => {
    const graph = makeGraph([{ id: '1', filePath: 'src/config/database.config.ts' }])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('config')
  })

  it('returns unknown for unmatched paths', () => {
    const graph = makeGraph([{ id: '1', filePath: 'README.md' }])
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('unknown')
  })

  it('uses symbol-name-based fallback for function nodes', () => {
    const graph = {
      nodes: [{
        id: '1',
        kind: 'function' as const,
        name: 'getUserController',
        filePath: '',
      }],
      edges: [],
      generatedAt: new Date().toISOString(),
      provider: 'test',
      projectDir: '/test',
    }
    const result = classifyLayers(graph)
    expect(result.nodes[0].layer).toBe('api')
  })

  it('applies custom rules', () => {
    const graph = makeGraph([{ id: '1', filePath: 'src/custom/foo.ts' }])
    const result = classifyLayers(graph, [{ layer: 'service', patterns: ['**/custom/**'] }])
    expect(result.nodes[0].layer).toBe('service')
  })

  it('getLayerColor returns a color for every layer', () => {
    const layers = ['api', 'service', 'data', 'ui', 'utility', 'config', 'test', 'unknown']
    for (const layer of layers) {
      expect(getLayerColor(layer as any)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
