import { describe, expect, it } from 'vitest'
import { generateTour } from '../../src/topology/TourGenerator.js'
import type { TopologyGraph } from '../../src/codegraph/CodeIntelligence.js'

function makeGraph(): TopologyGraph {
  return {
    nodes: [
      { id: 'main', kind: 'file', name: 'index.ts', filePath: 'src/index.ts', layer: 'api' },
      { id: 'service', kind: 'class', name: 'UserService', filePath: 'src/services/UserService.ts', layer: 'service' },
      { id: 'repo', kind: 'class', name: 'UserRepo', filePath: 'src/repository/UserRepo.ts', layer: 'data' },
      { id: 'model', kind: 'class', name: 'User', filePath: 'src/models/User.ts', layer: 'data' },
      { id: 'util', kind: 'function', name: 'formatDate', filePath: 'src/utils/format.ts', layer: 'utility' },
    ],
    edges: [
      { source: 'main', target: 'service', kind: 'calls' },
      { source: 'service', target: 'repo', kind: 'calls' },
      { source: 'repo', target: 'model', kind: 'depends-on' },
      { source: 'service', target: 'util', kind: 'calls' },
    ],
    generatedAt: new Date().toISOString(),
    provider: 'test',
    projectDir: '/test',
  }
}

describe('generateTour', () => {
  it('generates a tour with stops in dependency order', () => {
    const tour = generateTour(makeGraph())
    expect(tour.stops.length).toBeGreaterThanOrEqual(4)
    expect(tour.name).toBe('Architecture Tour')

    // main should come before service
    const mainIdx = tour.stops.findIndex(s => s.nodeId === 'main')
    const serviceIdx = tour.stops.findIndex(s => s.nodeId === 'service')
    expect(mainIdx).toBeLessThan(serviceIdx)
  })

  it('respects maxStops option', () => {
    const tour = generateTour(makeGraph(), { maxStops: 2 })
    expect(tour.stops.length).toBeLessThanOrEqual(2)
  })

  it('includes layer info in each stop', () => {
    const tour = generateTour(makeGraph())
    for (const stop of tour.stops) {
      expect(stop.layer).toBeDefined()
      expect(stop.title).toContain('[')
    }
  })

  it('includes related nodes', () => {
    const tour = generateTour(makeGraph())
    const mainStop = tour.stops.find(s => s.nodeId === 'main')
    expect(mainStop).toBeDefined()
    expect(mainStop!.relatedNodes).toContain('service')
  })

  it('estimates reading time', () => {
    const tour = generateTour(makeGraph())
    expect(tour.estimatedMinutes).toBeGreaterThanOrEqual(1)
  })

  it('uses custom tour name when focusDomain is provided', () => {
    const tour = generateTour(makeGraph(), { focusDomain: 'Auth' })
    expect(tour.name).toBe('Auth Architecture Tour')
  })

  it('generates descriptions with file paths', () => {
    const tour = generateTour(makeGraph())
    const mainStop = tour.stops.find(s => s.nodeId === 'main')
    expect(mainStop!.description).toContain('index.ts')
  })
})
