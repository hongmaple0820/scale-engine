import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const externalCommand = vi.hoisted(() => ({
  externalCommandExists: vi.fn(),
}))

const gbrainRuntime = vi.hoisted(() => ({
  runGbrainCommandSync: vi.fn(),
}))

vi.mock('../../src/core/ExternalCommand.js', () => externalCommand)
vi.mock('../../src/core/GbrainRuntime.js', () => gbrainRuntime)

import { inspectGbrainCliHealth, inspectMemoryProviders } from '../../src/memory/MemoryProviders.js'

const degradedDoctor = JSON.stringify({
  schema_version: 2,
  status: 'unhealthy',
  health_score: 55,
  checks: [
    { name: 'resolver_health', status: 'fail', message: 'skill resolver warnings' },
    { name: 'connection', status: 'ok', message: 'Connected, 0 pages' },
    { name: 'schema_version', status: 'ok', message: 'Version 80' },
    { name: 'brain_score', status: 'ok', message: 'Brain score 100/100' },
  ],
})

const projectNotReadyDoctor = JSON.stringify({
  schema_version: 2,
  status: 'unhealthy',
  health_score: 70,
  checks: [
    { name: 'resolver_health', status: 'fail', message: 'skill resolver warnings' },
    { name: 'connection', status: 'warn', message: 'Could not connect to configured DB' },
    { name: 'skill_brain_first', status: 'ok' },
  ],
})

const currentDoctorWithOptionalWarnings = JSON.stringify({
  schema_version: 2,
  status: 'warnings',
  health_score: 95,
  checks: [
    { name: 'resolver_health', status: 'fail', message: 'skill resolver warnings' },
    { name: 'connection', status: 'ok', message: 'Connected, 0 pages' },
    { name: 'skill_brain_first', status: 'ok' },
  ],
})

describe('MemoryProviders gbrain health', () => {
  beforeEach(() => {
    externalCommand.externalCommandExists.mockReset()
    gbrainRuntime.runGbrainCommandSync.mockReset()
  })

  it('treats configured gbrain as available when only non-recall doctor checks fail', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: `${degradedDoctor}\n[doctor.db_checks] done`,
      stderr: '',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const health = inspectGbrainCliHealth()

    expect(health).toMatchObject({
      available: true,
      degraded: true,
      status: 'unhealthy',
      healthScore: 55,
    })
    expect(health.reason).toContain('optional doctor warnings: resolver_health')
  })

  it('keeps gbrain unavailable when no brain is configured', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: '',
      stderr: 'No brain configured. Run: gbrain init',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const report = inspectMemoryProviders()
    const gbrain = report.providers.find(provider => provider.id === 'gbrain')

    expect(gbrain).toMatchObject({
      available: false,
      reason: 'gbrain CLI is installed but no brain is configured; run `gbrain init --pglite` before autonomous recall',
    })
  })

  it('marks gbrain provider available for recall-ready doctor output with optional warnings', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: degradedDoctor,
      stderr: '',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const report = inspectMemoryProviders()
    const gbrain = report.providers.find(provider => provider.id === 'gbrain')

    expect(gbrain).toMatchObject({
      id: 'gbrain',
      available: true,
    })
    expect(gbrain?.reason).toContain('optional doctor warnings: resolver_health')
  })

  it('accepts current gbrain doctor output without legacy schema checks when connection is ok', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: currentDoctorWithOptionalWarnings,
      stderr: '',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const health = inspectGbrainCliHealth()

    expect(health).toMatchObject({
      available: true,
      degraded: true,
      status: 'warnings',
      healthScore: 95,
    })
    expect(health.reason).toContain('optional doctor warnings: resolver_health')
  })

  it('runs gbrain doctor in the inspected project directory before declaring provider readiness', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: projectNotReadyDoctor,
      stderr: '',
      exitCode: 1,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const projectDir = resolve('E:/project/scale-engine')
    const health = inspectGbrainCliHealth({ projectDir })
    const report = inspectMemoryProviders({ projectDir })
    const gbrain = report.providers.find(provider => provider.id === 'gbrain')

    expect(gbrainRuntime.runGbrainCommandSync).toHaveBeenCalledWith(['doctor', '--json'], {
      timeout: 10_000,
      cwd: projectDir,
    })
    expect(gbrain).toMatchObject({
      id: 'gbrain',
      available: false,
      reason: 'gbrain doctor reported core recall issue(s): connection (Could not connect to configured DB)',
    })
    expect(health).toMatchObject({
      available: false,
      issues: ['connection'],
      recoveryHint: 'Configured gbrain DB is unreachable. If this is a local PGLite brain, back up the database directory before reinitializing; otherwise configure a reachable Postgres URL.',
      nextCommands: [
        'gbrain doctor --json',
        'gbrain init --url <postgresql://...> --non-interactive',
        'scale memory provider status --json',
      ],
    })
  })

  it('passes configured project-local gbrain home to doctor checks', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: JSON.stringify({
        status: 'healthy',
        health_score: 100,
        checks: [
          { name: 'connection', status: 'ok' },
          { name: 'schema_version', status: 'ok' },
        ],
      }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const projectDir = mkdtempSync(join(tmpdir(), 'scale-memory-provider-home-'))
    mkdirSync(join(projectDir, '.scale'), { recursive: true })
    writeFileSync(join(projectDir, '.scale', 'memory-providers.json'), JSON.stringify({
      version: '1.0',
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
          priority: 95,
          homeDir: '.scale/memory/gbrain-home',
          capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
          safetyLevel: 'review-required',
          writeMode: 'disabled',
        },
      ],
    }), 'utf-8')

    const report = inspectMemoryProviders({ projectDir })
    const homeDir = resolve(projectDir, '.scale/memory/gbrain-home')

    expect(report.providers.find(provider => provider.id === 'gbrain')).toMatchObject({
      id: 'gbrain',
      available: true,
    })
    expect(gbrainRuntime.runGbrainCommandSync).toHaveBeenCalledWith(['doctor', '--json'], {
      timeout: 10_000,
      cwd: projectDir,
      env: expect.objectContaining({
        GBRAIN_HOME: homeDir,
        GBRAIN_AUDIT_DIR: join(homeDir, 'audit'),
      }),
    })
  })

  it('treats an explicit providers list as authoritative', () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation(() => ({
      stdout: JSON.stringify({
        status: 'healthy',
        health_score: 100,
        checks: [
          { name: 'connection', status: 'ok' },
          { name: 'schema_version', status: 'ok' },
        ],
      }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
      usedMirroredRuntime: false,
      recoveredTimeout: false,
    }))

    const projectDir = mkdtempSync(join(tmpdir(), 'scale-memory-provider-authoritative-'))
    mkdirSync(join(projectDir, '.scale'), { recursive: true })
    writeFileSync(join(projectDir, '.scale', 'memory-providers.json'), JSON.stringify({
      version: '1.0',
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
          priority: 95,
          capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
          safetyLevel: 'review-required',
          writeMode: 'disabled',
        },
      ],
    }), 'utf-8')

    const report = inspectMemoryProviders({ projectDir })

    expect(report.routing.defaultOrder).toEqual(['gbrain'])
    expect(report.providers.map(provider => provider.id)).toEqual(['gbrain'])
    expect(report.availableProviderCount).toBe(1)
    expect(report.warnings).toEqual([])
  })

  it('recalls gbrain query output that times out after producing results', async () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      if (args[0] === 'doctor') return {
        stdout: JSON.stringify({
          status: 'healthy',
          health_score: 100,
          checks: [
            { name: 'connection', status: 'ok' },
            { name: 'schema_version', status: 'ok' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      if (args[0] === 'query') {
        return {
          stdout: '[1.0000] scale-note -- Sentinel memory result',
          stderr: 'spawnSync bun.exe ETIMEDOUT',
          exitCode: 1,
          timedOut: true,
          usedMirroredRuntime: false,
          recoveredTimeout: false,
        }
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const { recallMemoryProviders } = await import('../../src/memory/MemoryProviders.js')
    const report = await recallMemoryProviders({
      provider: 'gbrain',
      query: 'Sentinel',
      limit: 3,
    })

    expect(report.ok).toBe(true)
    expect(report.selectedProviders).toEqual(['gbrain'])
    expect(report.items[0]).toMatchObject({
      provider: 'gbrain',
      title: 'scale-note',
      summary: 'Sentinel memory result',
    })
  })

  it('falls back to gbrain keyword search when hybrid query returns no results', async () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      if (args[0] === 'doctor') return {
        stdout: JSON.stringify({
          status: 'healthy',
          health_score: 100,
          checks: [
            { name: 'connection', status: 'ok' },
            { name: 'schema_version', status: 'ok' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      if (args[0] === 'query') return {
        stdout: 'No results.',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      if (args[0] === 'search') return {
        stdout: '[0.3964] scale-engine-workflow-effectiveness-memory-recall -- Workflow effectiveness provider recall lesson\n[last-retrieved] write-back failed (best-effort): duplicate key',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const { recallMemoryProviders } = await import('../../src/memory/MemoryProviders.js')
    const report = await recallMemoryProviders({
      provider: 'gbrain',
      query: 'workflow effectiveness',
      limit: 3,
    })

    expect(report.ok).toBe(true)
    expect(report.selectedProviders).toEqual(['gbrain'])
    expect(gbrainRuntime.runGbrainCommandSync).toHaveBeenCalledWith(['search', 'workflow effectiveness'], expect.any(Object))
    expect(report.items[0]).toMatchObject({
      provider: 'gbrain',
      title: 'scale-engine-workflow-effectiveness-memory-recall',
      summary: 'Workflow effectiveness provider recall lesson',
    })
  })

  it('passes configured project-local gbrain home to recall queries', async () => {
    externalCommand.externalCommandExists.mockReturnValue(true)
    gbrainRuntime.runGbrainCommandSync.mockImplementation((args: string[]) => {
      if (args[0] === 'doctor') return {
        stdout: JSON.stringify({
          status: 'healthy',
          health_score: 100,
          checks: [
            { name: 'connection', status: 'ok' },
            { name: 'schema_version', status: 'ok' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
      return {
        stdout: '[1.0000] scale-note -- Project-local memory result',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        usedMirroredRuntime: false,
        recoveredTimeout: false,
      }
    })

    const projectDir = mkdtempSync(join(tmpdir(), 'scale-memory-provider-recall-home-'))
    mkdirSync(join(projectDir, '.scale'), { recursive: true })
    writeFileSync(join(projectDir, '.scale', 'memory-providers.json'), JSON.stringify({
      version: '1.0',
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
          priority: 95,
          homeDir: '.scale/memory/gbrain-home',
          capabilities: ['semantic-recall', 'graph-recall', 'session-memory', 'mcp'],
          safetyLevel: 'review-required',
          writeMode: 'disabled',
        },
      ],
    }), 'utf-8')

    const { recallMemoryProviders } = await import('../../src/memory/MemoryProviders.js')
    const report = await recallMemoryProviders({
      projectDir,
      provider: 'gbrain',
      query: 'Project-local',
      limit: 3,
    })
    const homeDir = resolve(projectDir, '.scale/memory/gbrain-home')

    expect(report.ok).toBe(true)
    expect(gbrainRuntime.runGbrainCommandSync).toHaveBeenCalledWith(['query', 'Project-local'], {
      timeout: 8_000,
      env: expect.objectContaining({
        GBRAIN_HOME: homeDir,
        GBRAIN_AUDIT_DIR: join(homeDir, 'audit'),
        GBRAIN_OUTPUT_MODE: expect.any(String),
      }),
    })
  })
})
