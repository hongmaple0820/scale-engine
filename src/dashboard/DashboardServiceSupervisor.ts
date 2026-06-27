import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

export type DashboardServiceState = 'running' | 'starting' | 'stopped' | 'unhealthy' | 'unknown'

export interface DashboardServiceOptions {
  projectDir?: string
  scaleDir?: string
  host?: string
  port?: number
  intervalMs?: number
  timeoutMs?: number
}

export interface DashboardServicePaths {
  serviceDir: string
  statusPath: string
  supervisorPidPath: string
  serverPidPath: string
  logPath: string
  serverLogPath: string
  launcherPath: string
}

export interface DashboardServiceStatus {
  status: DashboardServiceState
  projectDir: string
  scaleDir: string
  host: string
  port: number
  url: string
  healthUrl: string
  serviceDir: string
  statusPath: string
  logPath: string
  serverLogPath: string
  launcherPath: string
  supervisorPid?: number
  serverPid?: number
  supervisorAlive: boolean
  serverAlive: boolean
  lastHeartbeatAt?: number
  lastStartedAt?: number
  lastRestartAt?: number
  restartCount: number
  lastError?: string
  taskName?: string
  installed: boolean
}

interface DashboardServiceStatusFile {
  status?: DashboardServiceState
  projectDir?: string
  scaleDir?: string
  host?: string
  port?: number
  supervisorPid?: number
  serverPid?: number
  lastHeartbeatAt?: number
  lastStartedAt?: number
  lastRestartAt?: number
  restartCount?: number
  lastError?: string
  taskName?: string
}

export function normalizeDashboardServiceOptions(options: DashboardServiceOptions = {}): Required<DashboardServiceOptions> {
  const projectDir = resolve(options.projectDir ?? process.env.SCALE_DASHBOARD_PROJECT_DIR ?? process.cwd())
  return {
    projectDir,
    scaleDir: resolve(options.scaleDir ?? join(projectDir, '.scale')),
    host: options.host ?? process.env.SCALE_DASHBOARD_HOST ?? '127.0.0.1',
    port: options.port ?? parsePort(process.env.SCALE_DASHBOARD_PORT, 3210),
    intervalMs: options.intervalMs ?? parsePositiveInt(process.env.SCALE_DASHBOARD_WATCH_INTERVAL_MS, 10000),
    timeoutMs: options.timeoutMs ?? parsePositiveInt(process.env.SCALE_DASHBOARD_HEALTH_TIMEOUT_MS, 8000),
  }
}

export function dashboardServicePaths(options: DashboardServiceOptions = {}): DashboardServicePaths {
  const normalized = normalizeDashboardServiceOptions(options)
  const serviceDir = join(normalized.scaleDir, 'artifacts', 'dashboard-service')
  return {
    serviceDir,
    statusPath: join(serviceDir, 'status.json'),
    supervisorPidPath: join(serviceDir, 'supervisor.pid'),
    serverPidPath: join(serviceDir, 'server.pid'),
    logPath: join(serviceDir, 'daemon.log'),
    serverLogPath: join(serviceDir, 'server.log'),
    launcherPath: join(serviceDir, 'dashboard-service.ps1'),
  }
}

export function readDashboardServiceStatus(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  const normalized = normalizeDashboardServiceOptions(options)
  const paths = dashboardServicePaths(normalized)
  const stored = readStatusFile(paths.statusPath)
  const supervisorPid = stored.supervisorPid ?? readPidFile(paths.supervisorPidPath)
  const serverPid = stored.serverPid ?? readPidFile(paths.serverPidPath)
  const supervisorAlive = Boolean(supervisorPid && isProcessAlive(supervisorPid))
  const serverAlive = Boolean(serverPid && isProcessAlive(serverPid))
  const state = stored.status ?? (supervisorAlive ? 'running' : 'stopped')
  const status: DashboardServiceState = state === 'running' && !supervisorAlive
    ? serverAlive ? 'unknown' : 'stopped'
    : state
  const host = stored.host ?? normalized.host
  const port = stored.port ?? normalized.port
  const projectDir = stored.projectDir ? resolve(stored.projectDir) : normalized.projectDir
  const scaleDir = stored.scaleDir ? resolve(stored.scaleDir) : normalized.scaleDir
  return {
    status,
    projectDir,
    scaleDir,
    host,
    port,
    url: dashboardServiceUrl(host, port),
    healthUrl: `${dashboardServiceUrl(host, port)}/api/health`,
    serviceDir: paths.serviceDir,
    statusPath: paths.statusPath,
    logPath: paths.logPath,
    serverLogPath: paths.serverLogPath,
    launcherPath: paths.launcherPath,
    supervisorPid,
    serverPid,
    supervisorAlive,
    serverAlive,
    lastHeartbeatAt: stored.lastHeartbeatAt,
    lastStartedAt: stored.lastStartedAt,
    lastRestartAt: stored.lastRestartAt,
    restartCount: stored.restartCount ?? 0,
    lastError: status === 'running' ? undefined : stored.lastError,
    taskName: stored.taskName ?? dashboardTaskName(projectDir),
    installed: existsSync(paths.launcherPath),
  }
}

export function writeDashboardServiceStatus(options: DashboardServiceOptions, update: DashboardServiceStatusFile): DashboardServiceStatus {
  const normalized = normalizeDashboardServiceOptions(options)
  const paths = dashboardServicePaths(normalized)
  mkdirSync(paths.serviceDir, { recursive: true })
  const previous = readStatusFile(paths.statusPath)
  const next: DashboardServiceStatusFile = {
    ...previous,
    projectDir: normalized.projectDir,
    scaleDir: normalized.scaleDir,
    host: normalized.host,
    port: normalized.port,
    restartCount: previous.restartCount ?? 0,
    taskName: previous.taskName ?? dashboardTaskName(normalized.projectDir),
    ...update,
  }
  writeFileSync(paths.statusPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')
  if (next.supervisorPid) writeFileSync(paths.supervisorPidPath, `${next.supervisorPid}\n`, 'utf-8')
  if (next.serverPid) writeFileSync(paths.serverPidPath, `${next.serverPid}\n`, 'utf-8')
  return readDashboardServiceStatus(normalized)
}

export function startDashboardService(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  const normalized = normalizeDashboardServiceOptions(options)
  const current = readDashboardServiceStatus(normalized)
  if (current.supervisorAlive) return current
  const workerPath = resolveDashboardWorkerPath(normalized.projectDir)
  const paths = dashboardServicePaths(normalized)
  mkdirSync(paths.serviceDir, { recursive: true })
  const out = openSync(paths.logPath, 'a')
  const child = spawn(process.execPath, [
    workerPath,
    '--project-dir', normalized.projectDir,
    '--scale-dir', normalized.scaleDir,
    '--host', normalized.host,
    '--port', String(normalized.port),
    '--interval-ms', String(normalized.intervalMs),
    '--timeout-ms', String(normalized.timeoutMs),
  ], {
    cwd: normalized.projectDir,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: {
      ...process.env,
      SCALE_DASHBOARD_PROJECT_DIR: normalized.projectDir,
      SCALE_DASHBOARD_PORT: String(normalized.port),
      SCALE_DASHBOARD_HOST: normalized.host,
    },
  })
  child.unref()
  return writeDashboardServiceStatus(normalized, {
    status: 'starting',
    supervisorPid: child.pid,
    lastStartedAt: Date.now(),
    lastError: undefined,
  })
}

export function ensureDashboardService(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  const status = readDashboardServiceStatus(options)
  if (status.supervisorAlive && (status.status === 'running' || status.status === 'starting')) return status
  return startDashboardService(options)
}

export function stopDashboardService(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  const normalized = normalizeDashboardServiceOptions(options)
  const status = readDashboardServiceStatus(normalized)
  for (const pid of [status.serverPid, status.supervisorPid]) {
    if (pid && isProcessAlive(pid)) killProcess(pid)
  }
  const paths = dashboardServicePaths(normalized)
  for (const pidPath of [paths.serverPidPath, paths.supervisorPidPath]) {
    if (existsSync(pidPath)) unlinkSync(pidPath)
  }
  return writeDashboardServiceStatus(normalized, {
    status: 'stopped',
    serverPid: undefined,
    supervisorPid: undefined,
    lastError: undefined,
  })
}

export function restartDashboardService(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  stopDashboardService(options)
  return startDashboardService(options)
}

export function installDashboardService(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  const normalized = normalizeDashboardServiceOptions(options)
  const paths = dashboardServicePaths(normalized)
  mkdirSync(paths.serviceDir, { recursive: true })
  const taskName = dashboardTaskName(normalized.projectDir)
  const cliPath = resolveCliEntrypoint(normalized.projectDir)
  const launcher = [
    '$ErrorActionPreference = "Stop"',
    `$env:SCALE_DASHBOARD_PROJECT_DIR = ${psQuote(normalized.projectDir)}`,
    `$env:SCALE_DASHBOARD_PORT = ${psQuote(String(normalized.port))}`,
    `$env:SCALE_DASHBOARD_HOST = ${psQuote(normalized.host)}`,
    `Set-Location ${psQuote(normalized.projectDir)}`,
    `& ${psQuote(process.execPath)} ${psQuote(cliPath)} dashboard daemon ensure --dir ${psQuote(normalized.projectDir)} --port ${normalized.port} --host ${psQuote(normalized.host)} | Out-Null`,
  ].join('\n')
  writeFileSync(paths.launcherPath, `${launcher}\n`, 'utf-8')
  if (process.platform === 'win32') {
    execFileSync('schtasks.exe', [
      '/Create',
      '/TN', taskName,
      '/SC', 'ONLOGON',
      '/TR', `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${paths.launcherPath}"`,
      '/F',
    ], { stdio: 'ignore' })
  }
  return writeDashboardServiceStatus(normalized, {
    taskName,
    status: readDashboardServiceStatus(normalized).status,
  })
}

export function uninstallDashboardService(options: DashboardServiceOptions = {}): DashboardServiceStatus {
  const normalized = normalizeDashboardServiceOptions(options)
  const paths = dashboardServicePaths(normalized)
  const taskName = dashboardTaskName(normalized.projectDir)
  if (process.platform === 'win32') {
    try {
      execFileSync('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], { stdio: 'ignore' })
    } catch {
      // The task may not exist. Status rendering below still tells the truth.
    }
  }
  if (existsSync(paths.launcherPath)) unlinkSync(paths.launcherPath)
  return writeDashboardServiceStatus(normalized, { taskName, status: readDashboardServiceStatus(normalized).status })
}

export function tailDashboardServiceLog(options: DashboardServiceOptions = {}, lines = 80): string {
  const status = readDashboardServiceStatus(options)
  if (!existsSync(status.logPath)) return ''
  const content = readFileSync(status.logPath, 'utf-8')
  return content.split(/\r?\n/).slice(-Math.max(1, lines)).join('\n')
}

export function resolveDashboardHttpEntrypoint(projectDir = process.cwd()): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const distPeer = resolve(here, '..', 'api', 'http.js')
  if (existsSync(distPeer)) return distPeer
  const projectDist = resolve(projectDir, 'dist', 'api', 'http.js')
  if (existsSync(projectDist)) return projectDist
  throw new Error('Dashboard HTTP entrypoint not found. Run npm run build first.')
}

function resolveDashboardWorkerPath(projectDir: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const distWorker = resolve(here, 'DashboardServiceWorker.js')
  if (existsSync(distWorker)) return distWorker
  const projectWorker = resolve(projectDir, 'dist', 'dashboard', 'DashboardServiceWorker.js')
  if (existsSync(projectWorker)) return projectWorker
  throw new Error('Dashboard service worker not found. Run npm run build first.')
}

function resolveCliEntrypoint(projectDir: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const distCli = resolve(here, '..', 'api', 'cli.js')
  if (existsSync(distCli)) return distCli
  const projectCli = resolve(projectDir, 'dist', 'api', 'cli.js')
  if (existsSync(projectCli)) return projectCli
  throw new Error('SCALE CLI entrypoint not found. Run npm run build first.')
}

function readStatusFile(path: string): DashboardServiceStatusFile {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as DashboardServiceStatusFile
  } catch {
    return {}
  }
}

function readPidFile(path: string): number | undefined {
  if (!existsSync(path)) return undefined
  const pid = Number(readFileSync(path, 'utf-8').trim())
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function killProcess(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
}

function dashboardTaskName(projectDir: string): string {
  return `SCALE-Dashboard-${safeName(projectDir)}`
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/^[a-z]:/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'project'
}

function dashboardServiceUrl(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  return `http://${displayHost}:${port}`
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
