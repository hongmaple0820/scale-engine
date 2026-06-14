import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyDependencyBootstrapPostActions,
  hasCodexRtkInstructions,
  runDependencyBootstrapPostChecks,
  type DependencyBootstrapItemReport,
} from '../../src/bootstrap/DependencyBootstrap.js'

function installedItem(id: string): DependencyBootstrapItemReport {
  return {
    id,
    name: id,
    kind: id === 'awesome-design-md' ? 'skill' : 'cli',
    packs: id === 'gbrain' ? ['memory'] : ['knowledge'],
    source: `https://example.com/${id}`,
    installed: true,
    status: 'installed',
    installSupported: false,
    detectedBy: `PATH:${id}`,
    prerequisites: [],
  }
}

describe('dependency bootstrap post-checks', () => {
  it('summarizes tool, memory, and code-intelligence checks with warn/fail separation', () => {
    const results = runDependencyBootstrapPostChecks({
      projectDir: 'E:/project/demo',
      scaleDir: 'E:/project/demo/.scale',
      packIds: ['memory', 'knowledge'],
      items: [installedItem('gbrain'), installedItem('codegraph'), installedItem('graphify')],
      homeDir: 'C:/Users/tester',
    }, {
      inspectTools: () => ({
        ok: true,
        summary: { total: 3, installed: 3, missing: 0 },
        tools: [
          { id: 'gbrain', name: 'GBrain', category: 'cli', requiredFor: [], checkedPaths: ['PATH:gbrain'], installed: true, status: 'installed' },
          { id: 'codegraph', name: 'CodeGraph', category: 'cli', requiredFor: [], checkedPaths: ['PATH:codegraph'], installed: true, status: 'installed' },
          { id: 'graphify', name: 'Graphify', category: 'cli', requiredFor: [], checkedPaths: ['PATH:graphify'], installed: true, status: 'installed' },
        ],
      }),
      inspectMemory: () => ({
        projectDir: 'E:/project/demo',
        scaleDir: 'E:/project/demo/.scale',
        configPath: 'E:/project/demo/.scale/memory-providers.json',
        configExists: true,
        routing: {
          mode: 'external-first',
          defaultOrder: ['gbrain'],
          allowExternalWrite: false,
          requireEvidence: true,
          maxResultsPerProvider: 5,
        },
        providers: [
          {
            id: 'gbrain',
            kind: 'gbrain',
            enabled: true,
            available: true,
            selectedByDefault: true,
            priority: 95,
            capabilities: ['graph-recall'],
            safetyLevel: 'review-required',
            writeMode: 'disabled',
            reason: 'gbrain CLI is available for default graph-backed recall',
          },
        ],
        availableProviderCount: 1,
        warnings: [],
      }),
      inspectCode: () => ({
        projectDir: 'E:/project/demo',
        scaleDir: 'E:/project/demo/.scale',
        configPath: 'E:/project/demo/.scale/code-intelligence.json',
        configExists: true,
        projectIndexPath: 'E:/project/demo/.codegraph',
        projectIndexExists: false,
        providers: [
          {
            id: 'codegraph',
            type: 'external-cli',
            enabled: true,
            available: true,
            capabilities: ['context'],
            reason: 'command available: codegraph; project index missing (.codegraph/)',
          },
          {
            id: 'graphify',
            type: 'artifact',
            enabled: true,
            available: false,
            capabilities: ['context'],
            reason: 'manifest not found: graphify-out/graph.json',
          },
        ],
        fallback: {
          enabled: true,
          tools: ['rg'],
          available: true,
          reason: 'internal source scan fallback is available',
        },
        availableProviderCount: 1,
        recommendations: [],
      }),
    })

    expect(results.map(result => result.id)).toEqual(['tool-capabilities', 'memory-provider', 'code-intelligence'])
    expect(results.find(result => result.id === 'tool-capabilities')).toMatchObject({
      status: 'passed',
      summary: '3/3 selected tools are available',
    })
    expect(results.find(result => result.id === 'memory-provider')).toMatchObject({
      status: 'passed',
    })
    expect(results.find(result => result.id === 'code-intelligence')).toMatchObject({
      status: 'failed',
      summary: 'codegraph=available; graphify-artifact=missing; projectIndex=missing',
    })
  })

  it('fails post-checks when gbrain is unavailable', () => {
    const results = runDependencyBootstrapPostChecks({
      projectDir: 'E:/project/demo',
      scaleDir: 'E:/project/demo/.scale',
      packIds: ['memory'],
      items: [installedItem('gbrain')],
      homeDir: 'C:/Users/tester',
    }, {
      inspectTools: () => ({
        ok: false,
        summary: { total: 1, installed: 0, missing: 1 },
        tools: [
          { id: 'gbrain', name: 'GBrain', category: 'cli', requiredFor: [], checkedPaths: ['PATH:gbrain'], installed: false, status: 'missing' },
        ],
      }),
      inspectMemory: () => ({
        projectDir: 'E:/project/demo',
        scaleDir: 'E:/project/demo/.scale',
        configPath: 'E:/project/demo/.scale/memory-providers.json',
        configExists: true,
        routing: {
          mode: 'external-first',
          defaultOrder: ['gbrain'],
          allowExternalWrite: false,
          requireEvidence: true,
          maxResultsPerProvider: 5,
        },
        providers: [
          {
            id: 'gbrain',
            kind: 'gbrain',
            enabled: true,
            available: false,
            selectedByDefault: true,
            priority: 95,
            capabilities: ['graph-recall'],
            safetyLevel: 'review-required',
            writeMode: 'disabled',
            reason: 'gbrain doctor failed in this runtime',
          },
        ],
        availableProviderCount: 0,
        warnings: [],
      }),
    })

    expect(results.find(result => result.id === 'tool-capabilities')).toMatchObject({
      status: 'failed',
      details: {
        missing: ['gbrain'],
      },
    })
    expect(results.find(result => result.id === 'memory-provider')).toMatchObject({
      status: 'failed',
      details: {
        gbrainReason: 'gbrain doctor failed in this runtime',
      },
    })
  })

  it('scopes post-actions to the selected packs and keeps provider-order messaging readable', () => {
    const memoryActions = applyDependencyBootstrapPostActions(
      'E:/project/demo',
      'E:/project/demo/.scale',
      [installedItem('gbrain')],
      {
        writeMemoryConfig: () => ({ path: 'E:/project/demo/.scale/memory-providers.json', written: true }),
        switchMemoryProvider: () => ({
          ok: true,
          provider: 'gbrain',
          mode: 'external-first',
          path: 'E:/project/demo/.scale/memory-providers.json',
          previousOrder: ['gbrain'],
          nextOrder: ['gbrain'],
          warnings: [],
        }),
        writeCodeConfig: () => ({ path: 'E:/project/demo/.scale/code-intelligence.json', written: true }),
      },
    )

    expect(memoryActions).toEqual([
      'Wrote E:/project/demo/.scale/memory-providers.json',
      'Memory provider order unchanged: gbrain',
    ])

    const knowledgeActions = applyDependencyBootstrapPostActions(
      'E:/project/demo',
      'E:/project/demo/.scale',
      [installedItem('codegraph')],
      {
        writeMemoryConfig: () => ({ path: 'E:/project/demo/.scale/memory-providers.json', written: true }),
        switchMemoryProvider: () => ({
          ok: true,
          provider: 'gbrain',
          mode: 'external-first',
          path: 'E:/project/demo/.scale/memory-providers.json',
          previousOrder: ['gbrain'],
          nextOrder: ['gbrain'],
          warnings: [],
        }),
        writeCodeConfig: () => ({ path: 'E:/project/demo/.scale/code-intelligence.json', written: false }),
      },
    )

    expect(knowledgeActions).toEqual([
      'Reused E:/project/demo/.scale/code-intelligence.json',
    ])
  })

  it('recognizes Codex RTK mode from global instructions without requiring a shell hook', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-rtk-home-'))
    const codexDir = join(homeDir, '.codex')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(join(codexDir, 'RTK.md'), '# RTK\n', 'utf-8')
    writeFileSync(join(codexDir, 'AGENTS.md'), '@C:\\Users\\tester\\.codex\\RTK.md\n', 'utf-8')

    try {
      expect(hasCodexRtkInstructions(homeDir)).toBe(true)
      writeFileSync(join(codexDir, 'AGENTS.md'), '# no reference\n', 'utf-8')
      expect(hasCodexRtkInstructions(homeDir)).toBe(false)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})
