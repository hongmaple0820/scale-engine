import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildCodeGraphContext, dumpCodeGraphData, inspectCodeIntelligence, queryCodeGraph, setCodeIntelligenceExecFileSyncForTesting } from '../../src/codegraph/CodeIntelligence.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
  setCodeIntelligenceExecFileSyncForTesting()
})

function makeProject(initialized = false): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-code-intelligence-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'user.ts'), 'export function createUser() { return "ok" }\n', 'utf-8')
  writeFileSync(join(dir, 'src', 'api.ts'), 'import { createUser } from "./user"\nexport const route = createUser\n', 'utf-8')
  if (initialized) mkdirSync(join(dir, '.codegraph'), { recursive: true })
  return dir
}

function mockCodegraphCli() {
  setCodeIntelligenceExecFileSyncForTesting(((command, args, options) => {
    if ((command === 'where' || command === 'where.exe' || command === 'which') && Array.isArray(args) && args[0] === 'codegraph') {
      return options && typeof options === 'object' && 'encoding' in options
        ? 'C:\\tools\\codegraph.exe'
        : Buffer.from('C:\\tools\\codegraph.exe')
    }

    if (String(command).replace(/\\/g, '/').endsWith('/codegraph.exe') && Array.isArray(args) && args[0] === 'query') {
      return JSON.stringify([
        {
          node: {
            kind: 'function',
            name: 'createUser',
            qualifiedName: 'createUser',
            filePath: 'src/user.ts',
            startLine: 1,
          },
        },
      ])
    }

    if (String(command).replace(/\\/g, '/').endsWith('/codegraph.exe') && Array.isArray(args) && args[0] === 'context') {
      return JSON.stringify({
        summary: 'Found 2 relevant code symbols across 2 files.',
        entryPoints: [
          {
            kind: 'function',
            name: 'createUser',
            qualifiedName: 'createUser',
            filePath: 'src/user.ts',
            startLine: 1,
          },
          {
            kind: 'constant',
            name: 'route',
            qualifiedName: 'route',
            filePath: 'src/api.ts',
            startLine: 2,
          },
        ],
        relatedFiles: ['src/user.ts', 'src/api.ts'],
      })
    }

    throw new Error(`Unexpected command: ${String(command)} ${(args ?? []).join(' ')}`)
  }) as typeof import('node:child_process').execFileSync)
}

describe('CodeIntelligence external CodeGraph integration', () => {
  it('reports upstream metadata and init guidance for CodeGraph', () => {
    const projectDir = makeProject(false)
    mockCodegraphCli()

    const report = inspectCodeIntelligence({ projectDir })

    expect(report.projectIndexExists).toBe(false)
    expect(report.projectIndexPath.replace(/\\/g, '/')).toContain('/.codegraph')
    expect(report.providers.find(provider => provider.id === 'codegraph')).toMatchObject({
      available: true,
      source: 'https://github.com/colbymchenry/codegraph',
      installHint: 'npx @colbymchenry/codegraph or npm i -g @colbymchenry/codegraph',
      projectInitHint: 'codegraph init -i',
      serveCommand: 'codegraph serve --mcp',
    })
    expect(report.recommendations).toContain('Run codegraph init -i in the project root to build the local .codegraph/ index.')
  })

  it('uses CodeGraph query JSON when the project index exists', () => {
    const projectDir = makeProject(true)
    mockCodegraphCli()

    const report = queryCodeGraph({ projectDir, query: 'createUser' })

    expect(report.provider).toBe('codegraph')
    expect(report.fallbackUsed).toBe(false)
    expect(report.files).toContain('src/user.ts')
    expect(report.symbols).toContain('createUser')
    expect(report.hits[0]).toMatchObject({
      provider: 'codegraph',
      file: 'src/user.ts',
      symbol: 'createUser',
    })
  })

  it('uses CodeGraph context JSON to build budgeted context', () => {
    const projectDir = makeProject(true)
    mockCodegraphCli()

    const report = buildCodeGraphContext({ projectDir, symbol: 'createUser', budget: 50 })

    expect(report.provider).toBe('codegraph')
    expect(report.fallbackUsed).toBe(false)
    expect(report.contextFiles.map(file => file.path)).toEqual(expect.arrayContaining(['src/user.ts', 'src/api.ts']))
    expect(report.warnings.join('\n')).toContain('CodeGraph context summary:')
    expect(report.totalEstimatedTokens).toBeLessThanOrEqual(50)
  })
})

describe('dumpCodeGraphData', () => {
  it('dumps topology from artifact manifest', () => {
    const projectDir = makeProject()
    mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
    writeFileSync(join(projectDir, 'graphify-out', 'graph.json'), JSON.stringify({
      symbols: [
        { name: 'createUser', file: 'src/user.ts', callees: [], callers: ['route'] },
        { name: 'route', file: 'src/api.ts', callees: ['createUser'], callers: [] },
      ],
      files: [
        { path: 'src/user.ts', symbols: ['createUser'], imports: [] },
        { path: 'src/api.ts', symbols: ['route'], imports: ['src/user.ts'] },
      ],
    }), 'utf-8')

    const graph = dumpCodeGraphData({ projectDir })

    expect(graph.provider).toBe('graphify')
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2)
    expect(graph.edges.length).toBeGreaterThanOrEqual(1)

    const createNode = graph.nodes.find(n => n.name === 'createUser')
    expect(createNode).toBeDefined()
    expect(createNode!.kind).toBe('function')
    expect(createNode!.filePath).toBe('src/user.ts')

    const callEdge = graph.edges.find(e => e.kind === 'calls')
    expect(callEdge).toBeDefined()
  })

  it('dumps topology from codegraph CLI', () => {
    const projectDir = makeProject(true)
    mockCodegraphCli()

    const graph = dumpCodeGraphData({ projectDir })

    expect(graph.provider).toBe('codegraph')
    expect(graph.nodes.length).toBeGreaterThanOrEqual(1)
    const createNode = graph.nodes.find(n => n.name === 'createUser')
    expect(createNode).toBeDefined()
    expect(createNode!.kind).toBe('function')
    expect(createNode!.filePath).toBe('src/user.ts')
  })

  it('falls back to file walk when no provider is available', () => {
    const projectDir = makeProject()

    const graph = dumpCodeGraphData({ projectDir })

    expect(graph.provider).toBe('fallback-file-walk')
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2)
    expect(graph.edges.length).toBe(0)
    expect(graph.nodes.every(n => n.kind === 'file')).toBe(true)
  })
})
