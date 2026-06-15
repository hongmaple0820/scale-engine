import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

let dirs: string[] = []
const CLI_ENTRY = join(process.cwd(), 'src/api/cli.ts')
const TSX_LOADER = pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href

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
  return execa('node', ['--import', TSX_LOADER, CLI_ENTRY, ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

describe('environment doctor CLI', () => {
  it('reports cross-platform command and runtime readiness as JSON', async () => {
    const scaleDir = makeDir('scale-env-doctor-scale-')
    const projectDir = makeDir('scale-env-doctor-project-')

    const result = await runScale(['doctor', 'env', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = JSON.parse(result.stdout) as {
      ok: boolean
      status: string
      platform: string
      node: { version: string; status: string }
      path: { entryCount: number }
      checks: Array<{ id: string; status: string; category: string; required: boolean; version?: string }>
      recommendations: string[]
    }
    expect(report.ok).toBe(true)
    expect(report.status).toMatch(/healthy|degraded/)
    expect(report.platform).toBe(process.platform)
    expect(report.node.version).toBe(process.version)
    expect(report.node.status).toBe('ok')
    expect(report.path.entryCount).toBeGreaterThan(0)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'git', category: 'core', required: true }),
      expect.objectContaining({ id: 'npm', category: 'core', required: true }),
      expect.objectContaining({ id: 'npx', category: 'core', required: true }),
      expect.objectContaining({ id: 'rtk', category: 'third-party', required: false }),
      expect.objectContaining({ id: 'gbrain', category: 'third-party', required: false }),
      expect.objectContaining({ id: 'graphify', category: 'third-party', required: false }),
      expect.objectContaining({ id: 'codegraph', category: 'third-party', required: false }),
      expect.objectContaining({ id: 'gitnexus', category: 'third-party', required: false }),
    ]))
    const gbrain = report.checks.find(check => check.id === 'gbrain')
    if (gbrain?.version) expect(gbrain.version.trim().startsWith('{')).toBe(false)
    expect(report.recommendations.join('\n')).toContain('npm run smoke:setup')
  }, 60_000)
})
