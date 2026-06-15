import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

function writeProject(projectDir: string) {
  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, 'src', 'user.ts'), 'export function createUser() { return "ok" }\n', 'utf-8')
  writeFileSync(join(projectDir, 'src', 'api.ts'), 'import { createUser } from "./user"\nexport const route = createUser\n', 'utf-8')
  writeFileSync(join(projectDir, 'src', 'db.ts'), 'export const db = new Map()\n', 'utf-8')
}

function writeGraphConfig(scaleDir: string, projectDir: string) {
  mkdirSync(scaleDir, { recursive: true })
  writeFileSync(join(projectDir, 'codegraph-manifest.json'), JSON.stringify({
    symbols: [
      {
        name: 'UserService.create',
        file: 'src/user.ts',
        callers: ['src/api.ts'],
        callees: ['src/db.ts'],
      },
    ],
    files: [
      { path: 'src/user.ts', symbols: ['UserService.create'] },
    ],
  }, null, 2), 'utf-8')
  writeFileSync(join(scaleDir, 'code-intelligence.json'), JSON.stringify({
    version: '1.0',
    providers: [
      {
        id: 'test-graph',
        type: 'artifact',
        enabled: true,
        manifest: 'codegraph-manifest.json',
        capabilities: ['symbols', 'impact', 'context'],
      },
    ],
    fallback: {
      enabled: true,
      tools: ['internal-scan'],
    },
  }, null, 2), 'utf-8')
}

describe('codegraph CLI', () => {
  it('initializes code intelligence provider configuration', async () => {
    const scaleDir = makeDir('scale-codegraph-cli-scale-')
    const projectDir = makeDir('scale-codegraph-cli-project-')

    const result = await runScale(['codegraph', 'init', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      written: boolean
      path: string
      config: { providers: Array<{ id: string }>; fallback: { enabled: boolean } }
    }>(result.stdout)
    expect(report.written).toBe(true)
    expect(report.path.replace(/\\/g, '/')).toContain('/code-intelligence.json')
    expect(report.config.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codegraph', source: 'https://github.com/colbymchenry/codegraph' }),
      expect.objectContaining({ id: 'graphify', source: 'https://github.com/safishamsi/graphify' }),
      expect.objectContaining({ id: 'gitnexus', source: 'https://github.com/abhigyanpatwari/GitNexus' }),
    ]))
    expect(report.config.fallback.enabled).toBe(true)
  }, 120_000)

  it('reports explicit fallback when no provider config exists', async () => {
    const scaleDir = makeDir('scale-codegraph-cli-scale-')
    const projectDir = makeDir('scale-codegraph-cli-project-')
    writeProject(projectDir)

    const result = await runScale(['codegraph', 'status', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      configExists: boolean
      projectIndexExists: boolean
      projectIndexPath: string
      availableProviderCount: number
      providers: Array<{ id: string; source?: string }>
      fallback: { available: boolean }
      recommendations: string[]
    }>(result.stdout)
    expect(report.configExists).toBe(false)
    expect(report.projectIndexExists).toBe(false)
    expect(report.projectIndexPath.replace(/\\/g, '/')).toContain('/.codegraph')
    expect(report.availableProviderCount).toBeGreaterThanOrEqual(0)
    expect(report.providers.find(provider => provider.id === 'codegraph')?.source).toBe('https://github.com/colbymchenry/codegraph')
    expect(report.fallback.available).toBe(true)
    expect(report.recommendations.join('\n')).toContain('Run scale codegraph init to create .scale/code-intelligence.json.')
  }, 120_000)

  it('uses internal source scan fallback for query when graph data is unavailable', async () => {
    const scaleDir = makeDir('scale-codegraph-cli-scale-')
    const projectDir = makeDir('scale-codegraph-cli-project-')
    writeProject(projectDir)

    const result = await runScale(['codegraph', 'query', 'createUser', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      fallbackUsed: boolean
      provider?: string
      files: string[]
      roi: { fallbackCount: number; fileReadsSaved: number }
    }>(result.stdout)
    expect(report.fallbackUsed).toBe(true)
    expect(report.provider).toBeUndefined()
    expect(report.files).toContain('src/user.ts')
    expect(report.roi.fallbackCount).toBe(1)
    expect(report.roi.fileReadsSaved).toBeGreaterThanOrEqual(0)
  }, 120_000)

  it('uses an artifact graph provider for impact and includes exploration ROI', async () => {
    const scaleDir = makeDir('scale-codegraph-cli-scale-')
    const projectDir = makeDir('scale-codegraph-cli-project-')
    writeProject(projectDir)
    writeGraphConfig(scaleDir, projectDir)

    const result = await runScale(['codegraph', 'impact', '--symbol', 'UserService.create', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      provider?: string
      fallbackUsed: boolean
      files: string[]
      symbols: string[]
      roi: { graphHits: number; fileReadsSaved: number }
    }>(result.stdout)
    expect(report.provider).toBe('test-graph')
    expect(report.fallbackUsed).toBe(false)
    expect(report.files).toEqual(expect.arrayContaining(['src/user.ts', 'src/api.ts', 'src/db.ts']))
    expect(report.symbols).toContain('UserService.create')
    expect(report.roi.graphHits).toBeGreaterThan(0)
    expect(report.roi.fileReadsSaved).toBeGreaterThan(0)
  }, 120_000)

  it('builds budgeted codegraph context and can include code intelligence in governance ROI', async () => {
    const scaleDir = makeDir('scale-codegraph-cli-scale-')
    const projectDir = makeDir('scale-codegraph-cli-project-')
    writeProject(projectDir)
    writeGraphConfig(scaleDir, projectDir)

    const context = await runScale(['codegraph', 'context', '--symbol', 'UserService.create', '--budget', '10', '--json'], scaleDir, projectDir)
    expect(context.exitCode).toBe(0)
    const contextReport = parseJson<{
      totalEstimatedTokens: number
      omitted: Array<{ path: string }>
      contextFiles: Array<{ path: string; included: boolean }>
    }>(context.stdout)
    expect(contextReport.contextFiles.length).toBeGreaterThan(0)
    expect(contextReport.totalEstimatedTokens).toBeLessThanOrEqual(10)

    const roi = await runScale(['governance', 'roi', '--symbol', 'UserService.create', '--json'], scaleDir, projectDir)
    expect(roi.exitCode).toBe(0)
    const roiReport = parseJson<{
      modules: Array<{ module: string; evidenceLevel: string }>
    }>(roi.stdout)
    expect(roiReport.modules).toEqual(expect.arrayContaining([
      expect.objectContaining({ module: 'code-intelligence', evidenceLevel: 'measured' }),
    ]))
  }, 120_000)
})
