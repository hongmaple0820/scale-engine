import { defineCommand } from 'citty'
import {
  ensureDashboardService,
  installDashboardService,
  readDashboardServiceStatus,
  restartDashboardService,
  startDashboardService,
  stopDashboardService,
  tailDashboardServiceLog,
  uninstallDashboardService,
  type DashboardServiceOptions,
  type DashboardServiceStatus,
} from '../dashboard/DashboardServiceSupervisor.js'

export const dashboardCommand = defineCommand({
  meta: { name: 'dashboard', description: 'Dashboard service, resident daemon, and watchdog controls' },
  subCommands: {
    daemon: defineCommand({
      meta: { name: 'daemon', description: 'Manage the resident dashboard watchdog' },
      subCommands: {
        start: serviceCommand('start', 'Start the resident dashboard watchdog'),
        ensure: serviceCommand('ensure', 'Start the watchdog if it is not already running'),
        stop: serviceCommand('stop', 'Stop the watchdog and dashboard server'),
        restart: serviceCommand('restart', 'Restart the watchdog and dashboard server'),
        status: serviceCommand('status', 'Show dashboard watchdog status'),
        logs: defineCommand({
          meta: { name: 'logs', description: 'Print dashboard watchdog logs' },
          args: {
            ...commonArgs(),
            lines: { type: 'string', default: '80', description: 'Number of log lines to print' },
          },
          run({ args }) {
            const text = tailDashboardServiceLog(serviceOptions(args), Number(args.lines ?? 80))
            console.log(text || 'No dashboard service log found.')
          },
        }),
        install: serviceCommand('install', 'Install the watchdog as an OS login task where supported'),
        uninstall: serviceCommand('uninstall', 'Remove the OS login task where supported'),
      },
    }),
  },
})

function serviceCommand(action: 'start' | 'ensure' | 'stop' | 'restart' | 'status' | 'install' | 'uninstall', description: string) {
  return defineCommand({
    meta: { name: action, description },
    args: commonArgs(),
    run({ args }) {
      const options = serviceOptions(args)
      const status = runAction(action, options)
      if (args.json) {
        console.log(JSON.stringify(status, null, 2))
        return
      }
      renderStatus(status)
    },
  })
}

function commonArgs() {
  return {
    dir: { type: 'string', default: process.env.SCALE_DASHBOARD_PROJECT_DIR ?? process.cwd(), description: 'Project directory' },
    'scale-dir': { type: 'string', description: 'Scale directory; defaults to <dir>/.scale' },
    host: { type: 'string', default: process.env.SCALE_DASHBOARD_HOST ?? '127.0.0.1', description: 'Dashboard host for health checks' },
    port: { type: 'string', default: process.env.SCALE_DASHBOARD_PORT ?? '3210', description: 'Dashboard port' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  } as const
}

function serviceOptions(args: Record<string, unknown>): DashboardServiceOptions {
  const projectDir = String(args.dir ?? process.cwd())
  const port = parsePort(args.port, 3210)
  return {
    projectDir,
    scaleDir: args['scale-dir'] ? String(args['scale-dir']) : undefined,
    host: String(args.host ?? '127.0.0.1'),
    port,
  }
}

function parsePort(value: unknown, fallback: number): number {
  const port = Number(value ?? fallback)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback
}

function runAction(action: string, options: DashboardServiceOptions): DashboardServiceStatus {
  if (action === 'start') return startDashboardService(options)
  if (action === 'ensure') return ensureDashboardService(options)
  if (action === 'stop') return stopDashboardService(options)
  if (action === 'restart') return restartDashboardService(options)
  if (action === 'install') return installDashboardService(options)
  if (action === 'uninstall') return uninstallDashboardService(options)
  return readDashboardServiceStatus(options)
}

function renderStatus(status: DashboardServiceStatus): void {
  console.log('SCALE Dashboard Service')
  console.log(`  Status: ${status.status}`)
  console.log(`  URL: ${status.url}`)
  console.log(`  Project: ${status.projectDir}`)
  console.log(`  Supervisor: ${status.supervisorAlive ? `alive pid=${status.supervisorPid}` : 'not running'}`)
  console.log(`  Server: ${status.serverAlive ? `alive pid=${status.serverPid}` : 'not running'}`)
  console.log(`  Restarts: ${status.restartCount}`)
  console.log(`  Installed: ${status.installed ? status.taskName ?? 'yes' : 'no'}`)
  console.log(`  Last heartbeat: ${status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toISOString() : '-'}`)
  if (status.lastError) console.log(`  Last error: ${status.lastError}`)
  console.log(`  Logs: ${status.logPath}`)
}
