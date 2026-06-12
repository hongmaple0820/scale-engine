import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { createGateStatusReport, preflightGateStages } from '../../src/workflow/GateCatalog.js'

const dirs: string[] = []

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('GateCatalog', () => {
  it('reports core, meta, profile, and extension gate status from verification policy', () => {
    const projectDir = makeDir('scale-gates-project-')
    const scaleDir = join(projectDir, '.scale')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      policy: {
        engineeringStandardsGate: 'block',
        productSmokeGate: 'warn',
      },
    }), 'utf-8')

    const report = createGateStatusReport({ projectDir, scaleDir })

    expect(report.summary.coreStages).toBe(15)
    expect(report.summary.metaStages).toBe(9)
    expect(report.summary.extensionGates).toBe(3)
    expect(report.extensions.find(gate => gate.id === 'engineering-standards')).toMatchObject({
      active: true,
      blocking: true,
      mode: 'block',
    })
    expect(report.profiles.find(profile => profile.id === 'preflight:quick')?.stages).toEqual(['G3', 'G0', 'G4', 'G5'])
    expect(report.profiles.find(profile => profile.id === 'preflight:fast-lane')?.stages).toEqual(['G3', 'G0', 'G4', 'G5'])
    expect(report.profiles.find(profile => profile.id === 'preflight:fast-lane')?.description).toContain('S-level')
    expect(report.warnings.some(warning => warning.includes('VisualGate'))).toBe(true)
  })

  it('keeps preflight profile stage lists centralized', () => {
    expect(preflightGateStages('quick')).toEqual(['G3', 'G0', 'G4', 'G5'])
    expect(preflightGateStages('fast-lane')).toEqual(['G3', 'G0', 'G4', 'G5'])
    expect(preflightGateStages('full')).toEqual(['G3', 'G0', 'G4', 'G5', 'G6', 'G7'])
    expect(preflightGateStages('ci')).toEqual(['G3', 'G0', 'G4', 'G5', 'G6', 'G7'])
  })

  it('defaults engineering standards to blocking when no verification matrix exists', () => {
    const projectDir = makeDir('scale-gates-default-project-')

    const report = createGateStatusReport({ projectDir, scaleDir: join(projectDir, '.scale') })

    expect(report.extensions.find(gate => gate.id === 'engineering-standards')).toMatchObject({
      active: true,
      blocking: true,
      mode: 'block',
    })
  })
})
