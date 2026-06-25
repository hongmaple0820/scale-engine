import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
    timeout: 10_000,
  })
}

describe('hook-safe CLI commands', () => {
  it('runs gate before-stop without initializing the artifact engine', async () => {
    const projectDir = makeDir('scale-hook-safe-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale(['gate', 'before-stop', '--session-id', 'hook-test', '--hook-safe'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  })

  it('runs meta-governance without initializing the artifact engine', async () => {
    const projectDir = makeDir('scale-meta-governance-project-')
    const scaleDir = join(projectDir, '.scale')

    const result = await runScale(['meta-governance', '--scale-dir', scaleDir, '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toHaveLength(7)
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  })

  it('prints help for hook-sensitive commands without timing out', async () => {
    const projectDir = makeDir('scale-hook-help-project-')
    const scaleDir = join(projectDir, '.scale')

    const gateHelp = await runScale(['gate', 'before-stop', '--help'], scaleDir, projectDir)
    const metaHelp = await runScale(['meta-governance', '--help'], scaleDir, projectDir)

    expect(gateHelp.exitCode).toBe(0)
    expect(metaHelp.exitCode).toBe(0)
    expect(existsSync(join(scaleDir, 'scale.db'))).toBe(false)
  })
})
