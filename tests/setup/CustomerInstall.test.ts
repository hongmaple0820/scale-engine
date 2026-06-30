import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runCustomerInstall } from '../../src/setup/CustomerInstall.js'

describe('customer install', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('installs the core workflow through one customer-facing command path', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-install-'))
    tempDirs.push(projectDir)
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({
      scripts: { build: 'echo build' },
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
    }, null, 2))

    const report = await runCustomerInstall({
      projectDir,
      agent: 'codex',
      profile: 'standard',
      governancePack: 'frontend-app',
      interactive: false,
      skipDeps: true,
      lang: 'en',
    })

    expect(report.ok).toBe(true)
    expect(report.selection).toMatchObject({
      agent: 'codex',
      profile: 'standard',
      governancePack: 'frontend-app',
      dependencyPacks: [],
      applyDependencies: false,
    })
    expect(existsSync(join(projectDir, '.scale', 'config.yaml'))).toBe(true)
    expect(existsSync(join(projectDir, '.scale', 'thresholds.json'))).toBe(true)
    expect(existsSync(join(projectDir, 'AGENTS.md'))).toBe(true)
    expect(report.steps.map(step => step.status)).toEqual(expect.arrayContaining(['run', 'ok', 'skip']))
    expect(report.nextSteps).toContain('scale doctor --dir .')
  })
})
