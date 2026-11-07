import { defineCommand } from 'citty'
import { join } from 'node:path'
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
  meta: { name: 'dashboard', description: 'Dashboard service, resident daemon, watchdog controls, and capability overview' },
  subCommands: {
    serve: defineCommand({
      meta: { name: 'serve', description: 'Run the dashboard HTTP server in the foreground (canonical entry, replaces `npm run serve`)' },
      args: commonArgs(),
      async run({ args }) {
        const { DashboardServer } = await import('../dashboard/DashboardServer.js')
        const { resolveDashboardLaunchPlan } = await import('../api/DashboardHttpConfig.js')
        const env = {
          ...process.env,
          SCALE_DASHBOARD_PROJECT_DIR: String(args.dir),
          SCALE_DASHBOARD_PORT: String(args.port),
          SCALE_DASHBOARD_HOST: String(args.host),
        }
        const plan = await resolveDashboardLaunchPlan(env, String(args.dir))
        const servers: Array<{ stop: () => void }> = []
        for (const project of plan.projects) {
          const server = new DashboardServer({
            port: project.port,
            host: project.host,
            projectDir: project.projectDir,
            scaleDir: project.scaleDir,
            projectName: project.name,
            projectUrl: project.url,
            currentProjectId: project.id,
            projects: plan.projects,
          })
          await server.start()
          servers.push(server)
          console.log(`SCALE Dashboard is running: ${project.url}/ (${project.projectDir})`)
        }
        const stop = () => {
          for (const server of servers) server.stop()
          process.exit(0)
        }
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
        await new Promise<void>(() => { /* keep the process alive until signal */ })
      },
    }),
    capabilities: defineCommand({
      meta: { name: 'capabilities', description: 'Show capability tier and dashboard data-source readiness (first-screen overview data)' },
      args: commonArgs(),
      async run({ args }) {
        const { buildCapabilityOverview } = await import('../dashboard/CapabilityOverview.js')
        const projectDir = String(args.dir)
        const scaleDir = args['scale-dir'] ? String(args['scale-dir']) : join(projectDir, '.scale')
        const overview = buildCapabilityOverview({ projectDir, scaleDir })
        if (args.json) {
          console.log(JSON.stringify(overview, null, 2))
          return
        }
        console.log('\nSCALE Capability Overview')
        console.log(`  Tier: ${overview.tier.label}`)
        console.log(`  ${overview.tier.summary}`)
        console.log(`  Upgrade: ${overview.tier.upgradeCommand}`)
        console.log(`  Data sources ready: ${overview.readyRatio}`)
        for (const source of overview.sources) {
          console.log(`  [${source.ready ? 'ready' : 'empty'}] ${source.label} — ${source.reason}`)
        }
      },
    }),
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
