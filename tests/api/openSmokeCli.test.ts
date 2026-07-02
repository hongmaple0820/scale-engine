import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardServiceStatus } from '../../src/dashboard/DashboardServiceSupervisor.js'
import { buildDashboardPageUrl, createOpenCommandReport, normalizeOpenArgs } from '../../src/cli/openCommands.js'
import { normalizeSmokeArgs, runSmokeChecks } from '../../src/cli/smokeCommands.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('open and smoke CLI helpers', () => {
  it('builds dashboard page URLs without opening a real browser in tests', () => {
    const projectDir = makeProject('scale-open-cli-')
    const scaleDir = join(projectDir, '.scale')
    const report = createOpenCommandReport({
      projectDir,
      scaleDir,
      host: '127.0.0.1',
      port: 43212,
      page: 'integrations',
      openBrowser: true,
    }, {
      ensureService: () => fakeDashboardStatus(projectDir, scaleDir, 43212),
      openBrowser: (url) => {
        expect(url).toBe('http://127.0.0.1:43212/#integrations')
        return { ok: true, command: 'test-open' }
      },
    })

    expect(buildDashboardPageUrl('http://127.0.0.1:3210/', '#agents')).toBe('http://127.0.0.1:3210/#agents')
    expect(report.ok).toBe(true)
    expect(report.opened).toBe(true)
    expect(report.browserCommand).toBe('test-open')
    expect(report.nextActions[0]).toContain('scale smoke')
    expect(report.nextActions[0]).toContain('--port 43212')
    expect(report.nextActions[1]).toContain('--port 43212')
    expect(normalizeOpenArgs({ dir: projectDir, browser: false }).openBrowser).toBe(false)
  })

  it('runs the local smoke message loop and writes an acceptance report', async () => {
    const projectDir = makeProject('scale-smoke-cli-')
    const scaleDir = join(projectDir, '.scale')
    writeScaleInstallFiles(scaleDir)

    const report = await runSmokeChecks({
      projectDir,
      scaleDir,
      startDashboard: false,
      port: 43212,
      sessionId: 'vitest-smoke',
      agentId: 'vitest-agent',
      messageText: 'Vitest smoke message loop.',
    })

    expect(report.status).toBe('passed')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'scale-install', status: 'pass' }),
      expect.objectContaining({ id: 'dashboard-health', status: 'skip' }),
      expect.objectContaining({ id: 'agent-control-loop', status: 'pass' }),
    ]))
    expect(report.artifacts.reportPath).toBeTruthy()
    expect(existsSync(report.artifacts.reportPath ?? '')).toBe(true)
    expect(report.nextActions).toContain(`scale open --dir ${projectDir} --port 43212`)
    expect(report.nextActions).toContain('http://127.0.0.1:43212/#agents')
    expect(normalizeSmokeArgs({ dir: projectDir, dashboard: false }).startDashboard).toBe(false)
  }, 120_000)
})

function makeProject(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  dirs.push(dir)
  return dir
}

function writeScaleInstallFiles(scaleDir: string): void {
  mkdirSync(scaleDir, { recursive: true })
  writeFileSync(join(scaleDir, 'config.yaml'), 'version: 1\n', 'utf-8')
  writeFileSync(join(scaleDir, 'workspace.json'), JSON.stringify({ id: 'smoke', name: 'Smoke Project' }, null, 2), 'utf-8')
  writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({ profiles: {} }, null, 2), 'utf-8')
}

function fakeDashboardStatus(projectDir: string, scaleDir: string, port = 3210): DashboardServiceStatus {
  return {
    status: 'running',
    projectDir,
    scaleDir,
    host: '127.0.0.1',
    port,
    url: `http://127.0.0.1:${port}`,
    healthUrl: `http://127.0.0.1:${port}/api/health`,
    serviceDir: join(scaleDir, 'artifacts', 'dashboard-service'),
    statusPath: join(scaleDir, 'artifacts', 'dashboard-service', 'status.json'),
    logPath: join(scaleDir, 'artifacts', 'dashboard-service', 'daemon.log'),
    serverLogPath: join(scaleDir, 'artifacts', 'dashboard-service', 'server.log'),
    launcherPath: join(scaleDir, 'artifacts', 'dashboard-service', 'dashboard-service.ps1'),
    supervisorPid: 123,
    serverPid: 456,
    supervisorAlive: true,
    serverAlive: true,
    restartCount: 0,
    installed: false,
  }
}
