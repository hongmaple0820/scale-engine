import { mkdirSync, openSync, writeFileSync } from 'node:fs'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import {
  dashboardServicePaths,
  isProcessAlive,
  killProcess,
  normalizeDashboardServiceOptions,
  readDashboardServiceStatus,
  resolveDashboardHttpEntrypoint,
  writeDashboardServiceStatus,
  type DashboardServiceOptions,
} from './DashboardServiceSupervisor.js'
import { findAvailablePort } from '../api/DashboardHttpConfig.js'

interface WorkerOptions extends Required<DashboardServiceOptions> {}

let serverProcess: ChildProcess | null = null
let stopping = false
let consecutiveHealthFailures = 0

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const paths = dashboardServicePaths(options)
  mkdirSync(paths.serviceDir, { recursive: true })
  writeFileSync(paths.supervisorPidPath, `${process.pid}\n`, 'utf-8')
  log(options, `supervisor started pid=${process.pid}`)
  writeDashboardServiceStatus(options, {
    status: 'starting',
    supervisorPid: process.pid,
    lastStartedAt: Date.now(),
  })

  process.once('SIGINT', () => stop(options, 'SIGINT'))
  process.once('SIGTERM', () => stop(options, 'SIGTERM'))

  while (!stopping) {
    try {
      const health = await checkHealth(options)
      if (!health.ok) {
        consecutiveHealthFailures += 1
        if (shouldRestartAfterFailure(options, consecutiveHealthFailures, health.error)) {
          await restartServer(options, health.error)
          consecutiveHealthFailures = 0
        } else {
          const current = readDashboardServiceStatus(options)
          const serverPid = current.serverPid ?? serverProcess?.pid
          const serverAlive = Boolean(serverPid && isProcessAlive(serverPid))
          const transient = isTransientHealthFailure(health.error)
          writeDashboardServiceStatus(options, {
            status: serverAlive && transient ? 'running' : 'unhealthy',
            supervisorPid: process.pid,
            serverPid,
            lastError: health.error,
          })
        }
      } else {
        consecutiveHealthFailures = 0
        const current = readDashboardServiceStatus(options)
        writeDashboardServiceStatus(options, {
          status: 'running',
          supervisorPid: process.pid,
          serverPid: current.serverPid ?? serverProcess?.pid,
          lastHeartbeatAt: Date.now(),
          lastError: undefined,
        })
      }
    } catch (error) {
      await restartServer(options, error instanceof Error ? error.message : String(error))
    }
    await delay(options.intervalMs)
  }
}

async function restartServer(options: WorkerOptions, reason?: string): Promise<void> {
  const current = readDashboardServiceStatus(options)
  const stalePid = current.serverPid
  const hasKnownServer = Boolean(serverProcess?.pid || stalePid)
  if (serverProcess?.pid && isProcessAlive(serverProcess.pid)) killProcess(serverProcess.pid)
  if (stalePid && stalePid !== serverProcess?.pid && isProcessAlive(stalePid)) killProcess(stalePid)
  const killedPortOwner = killStaleDashboardPortOwner(options)
  const requestedPort = options.port
  options.port = await findAvailablePort(options.port, options.host)
  if (options.port !== requestedPort) {
    log(options, `dashboard port ${requestedPort} unavailable; using ${options.port}`)
  }
  const restartCount = current.restartCount + (hasKnownServer || killedPortOwner ? 1 : 0)
  const verb = hasKnownServer || killedPortOwner ? 'restarting' : 'starting'
  log(options, `${verb} dashboard server reason=${reason || 'unhealthy'} restart=${restartCount}`)
  const serverLog = openSync(dashboardServicePaths(options).serverLogPath, 'a')
  const entrypoint = resolveDashboardHttpEntrypoint(options.projectDir)
  serverProcess = spawn(process.execPath, [entrypoint, String(options.port)], {
    cwd: options.projectDir,
    stdio: ['ignore', serverLog, serverLog],
    windowsHide: true,
    env: {
      ...process.env,
      SCALE_DASHBOARD_PROJECT_DIR: options.projectDir,
      SCALE_DASHBOARD_PORT: String(options.port),
      SCALE_DASHBOARD_HOST: options.host,
    },
  })
  const launchedPid = serverProcess.pid
  if (serverProcess.pid) writeFileSync(dashboardServicePaths(options).serverPidPath, `${serverProcess.pid}\n`, 'utf-8')
  serverProcess.once('exit', (code, signal) => {
    log(options, `dashboard server exited pid=${launchedPid ?? '-'} code=${code ?? '-'} signal=${signal ?? '-'}`)
  })
  writeDashboardServiceStatus(options, {
    status: 'starting',
    supervisorPid: process.pid,
    serverPid: serverProcess.pid,
    lastRestartAt: Date.now(),
    restartCount,
    lastError: reason,
  })
  await delay(1500)
}

function shouldRestartAfterFailure(options: WorkerOptions, failures: number, reason?: string): boolean {
  const current = readDashboardServiceStatus(options)
  const knownPid = serverProcess?.pid ?? current.serverPid
  const knownServerAlive = Boolean(knownPid && isProcessAlive(knownPid))
  if (knownServerAlive && isTransientHealthFailure(reason)) return false
  return knownServerAlive ? failures >= 6 : failures >= 1
}

function isTransientHealthFailure(reason?: string): boolean {
  const text = String(reason || '').toLowerCase()
  return text.includes('aborted')
    || text.includes('timeout')
    || text.includes('timed out')
    || text.includes('fetch failed')
}

async function checkHealth(options: WorkerOptions): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(`http://${options.host}:${options.port}/api/health`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return { ok: false, error: `health returned ${response.status}` }
    const body = await response.json().catch(() => ({})) as { projectDir?: string }
    if (body.projectDir && body.projectDir !== options.projectDir) {
      return { ok: false, error: `health project mismatch: ${body.projectDir}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function stop(options: WorkerOptions, signal: string): void {
  stopping = true
  log(options, `supervisor stopping signal=${signal}`)
  if (serverProcess?.pid && isProcessAlive(serverProcess.pid)) killProcess(serverProcess.pid)
  writeDashboardServiceStatus(options, {
    status: 'stopped',
    supervisorPid: undefined,
    serverPid: undefined,
  })
  process.exit(0)
}

function parseArgs(args: string[]): WorkerOptions {
  const values: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]
    if (!item?.startsWith('--')) continue
    const key = item.slice(2)
    const value = args[index + 1]
    if (value && !value.startsWith('--')) {
      values[key] = value
      index += 1
    }
  }
  return normalizeDashboardServiceOptions({
    projectDir: values['project-dir'],
    scaleDir: values['scale-dir'],
    host: values.host,
    port: values.port ? Number(values.port) : undefined,
    intervalMs: values['interval-ms'] ? Number(values['interval-ms']) : undefined,
    timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined,
  })
}

function log(options: WorkerOptions, message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`
  mkdirSync(dashboardServicePaths(options).serviceDir, { recursive: true })
  writeFileSync(dashboardServicePaths(options).logPath, line, { encoding: 'utf-8', flag: 'a' })
}

function killStaleDashboardPortOwner(options: WorkerOptions): boolean {
  const pid = findPortOwnerPid(options.port)
  if (!pid || pid === process.pid || pid === serverProcess?.pid) return false
  const command = readProcessCommandLine(pid)
  const normalized = command.replace(/\\/g, '/').toLowerCase()
  const looksLikeScaleDashboard = normalized.includes('/dist/api/http.js') || normalized.includes('@hongmaple0820/scale-engine')
  if (!looksLikeScaleDashboard) {
    log(options, `port ${options.port} is occupied by non-dashboard pid=${pid}; leaving it alone`)
    return false
  }
  log(options, `killing stale dashboard port owner pid=${pid}`)
  killProcess(pid)
  return true
}

function findPortOwnerPid(port: number): number | undefined {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
      ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const pid = Number(output.split(/\r?\n/).find(Boolean))
      return Number.isInteger(pid) && pid > 0 ? pid : undefined
    }
    const output = execFileSync('sh', ['-c', `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null | head -n 1`], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const pid = Number(output)
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

function readProcessCommandLine(pid: number): string {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -First 1 -ExpandProperty CommandLine)`,
      ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch((error) => {
  const options = normalizeDashboardServiceOptions()
  log(options, `supervisor fatal error=${error instanceof Error ? error.stack || error.message : String(error)}`)
  writeDashboardServiceStatus(options, {
    status: 'unhealthy',
    supervisorPid: process.pid,
    lastError: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
