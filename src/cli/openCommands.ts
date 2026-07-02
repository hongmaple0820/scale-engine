import { defineCommand } from 'citty'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  ensureDashboardService,
  type DashboardServiceOptions,
  type DashboardServiceStatus,
  waitForDashboardServiceReady,
} from '../dashboard/DashboardServiceSupervisor.js'

export interface OpenCommandOptions extends DashboardServiceOptions {
  page?: string
  openBrowser?: boolean
}

export interface BrowserOpenResult {
  ok: boolean
  command?: string
  error?: string
}

export interface OpenCommandReport {
  ok: boolean
  url: string
  opened: boolean
  browserCommand?: string
  dashboard: DashboardServiceStatus
  warnings: string[]
  nextActions: string[]
}

interface OpenCommandDeps {
  ensureService?: (options: DashboardServiceOptions) => DashboardServiceStatus
  waitForService?: (options: DashboardServiceOptions, timeoutMs?: number) => DashboardServiceStatus
  openBrowser?: (url: string) => BrowserOpenResult
}

const DEFAULT_PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
const DEFAULT_PAGE = 'agents'

export const openCommand = defineCommand({
  meta: { name: 'open', description: 'Start the Agent OS dashboard and open the visual control panel' },
  args: {
    dir: { type: 'string', default: DEFAULT_PROJECT_DIR, description: 'Project directory' },
    'scale-dir': { type: 'string', description: 'Scale directory; defaults to <dir>/.scale' },
    host: { type: 'string', default: process.env.SCALE_DASHBOARD_HOST ?? '127.0.0.1', description: 'Dashboard host' },
    port: { type: 'string', default: process.env.SCALE_DASHBOARD_PORT ?? '3210', description: 'Dashboard port' },
    page: { type: 'string', default: DEFAULT_PAGE, description: 'Dashboard page or hash route, for example agents or integrations' },
    browser: { type: 'boolean', default: true, description: 'Open the dashboard in the system browser; use --no-browser to print only' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  run({ args }) {
    const report = createOpenCommandReport(normalizeOpenArgs(args, Boolean(args.json)))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    renderOpenReport(report)
  },
})

export function normalizeOpenArgs(args: Record<string, unknown>, jsonMode = false): OpenCommandOptions {
  const projectDir = resolve(String(args.dir ?? DEFAULT_PROJECT_DIR))
  return {
    projectDir,
    scaleDir: args['scale-dir'] ? resolve(String(args['scale-dir'])) : undefined,
    host: String(args.host ?? '127.0.0.1'),
    port: parsePort(args.port, 3210),
    page: String(args.page ?? DEFAULT_PAGE),
    openBrowser: !jsonMode && args.browser !== false && args['no-browser'] !== true,
  }
}

export function createOpenCommandReport(options: OpenCommandOptions, deps: OpenCommandDeps = {}): OpenCommandReport {
  const ensureService = deps.ensureService ?? ensureDashboardService
  const waitForService = deps.waitForService ?? waitForDashboardServiceReady
  const openBrowser = deps.openBrowser ?? openUrlInBrowser
  const serviceOptions = {
    projectDir: options.projectDir,
    scaleDir: options.scaleDir,
    host: options.host,
    port: options.port,
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
  }
  let dashboard = ensureService(serviceOptions)
  if (!deps.ensureService || deps.waitForService) {
    dashboard = waitForService(serviceOptions, options.timeoutMs)
  }
  const url = buildDashboardPageUrl(dashboard.url, options.page)
  const warnings: string[] = []
  let opened = false
  let browserCommand: string | undefined

  if (options.openBrowser) {
    const result = openBrowser(url)
    opened = result.ok
    browserCommand = result.command
    if (!result.ok) warnings.push(result.error ?? 'Browser could not be opened automatically.')
  }

  if (!dashboard.supervisorAlive && !dashboard.serverAlive) {
    const optionsHint = dashboardCliOptions({ host: dashboard.host, port: dashboard.port })
    warnings.push(`Dashboard daemon is starting or not yet reporting a live process. Run scale smoke --dir .${optionsHint} if the page does not load.`)
  }
  const optionsHint = dashboardCliOptions({ host: dashboard.host, port: dashboard.port })

  return {
    ok: dashboard.status === 'running' || dashboard.status === 'starting' || dashboard.supervisorAlive || dashboard.serverAlive,
    url,
    opened,
    browserCommand,
    dashboard,
    warnings,
    nextActions: [
      `scale smoke --dir ${quotePathForDisplay(dashboard.projectDir)}${optionsHint}`,
      `scale dashboard daemon status --dir ${quotePathForDisplay(dashboard.projectDir)}${optionsHint}`,
    ],
  }
}

export function buildDashboardPageUrl(baseUrl: string, page = DEFAULT_PAGE): string {
  const base = trimTrailingSlash(baseUrl)
  const normalized = String(page ?? '').trim()
  if (!normalized) return base
  if (/^https?:\/\//i.test(normalized)) return normalized
  if (normalized.startsWith('#')) return `${base}/${normalized}`
  if (normalized.startsWith('/')) return `${base}${normalized}`
  return `${base}/#${normalized.replace(/^#+/, '')}`
}

export function openUrlInBrowser(url: string): BrowserOpenResult {
  const command = browserCommand(url)
  if (!command) return { ok: false, error: `No browser opener is configured for platform ${process.platform}.` }
  const result = spawnSync(command.file, command.args, {
    stdio: 'ignore',
    windowsHide: true,
  })
  if (result.error) return { ok: false, command: command.label, error: result.error.message }
  if (typeof result.status === 'number' && result.status !== 0) {
    return { ok: false, command: command.label, error: `${command.label} exited with code ${result.status}.` }
  }
  return { ok: true, command: command.label }
}

function browserCommand(url: string): { file: string; args: string[]; label: string } | null {
  if (process.platform === 'win32') {
    return { file: 'cmd.exe', args: ['/c', 'start', '', url], label: 'cmd /c start' }
  }
  if (process.platform === 'darwin') {
    return { file: 'open', args: [url], label: 'open' }
  }
  if (process.platform === 'linux') {
    return { file: 'xdg-open', args: [url], label: 'xdg-open' }
  }
  return null
}

function renderOpenReport(report: OpenCommandReport): void {
  console.log('SCALE Agent OS')
  console.log(`  Dashboard: ${report.url}`)
  console.log(`  Service: ${report.dashboard.status}`)
  console.log(`  Project: ${report.dashboard.projectDir}`)
  console.log(`  Browser: ${report.opened ? `opened via ${report.browserCommand ?? 'system opener'}` : 'not opened'}`)
  for (const warning of report.warnings) console.log(`  Warning: ${warning}`)
  if (!report.opened) console.log(`  Open manually: ${report.url}`)
  console.log('')
  console.log('Next:')
  for (const action of report.nextActions) console.log(`  ${action}`)
}

function parsePort(value: unknown, fallback: number): number {
  const port = Number(value ?? fallback)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function dashboardCliOptions(input: { host?: string; port?: number }): string {
  const parts: string[] = []
  if (input.host && input.host !== '127.0.0.1') parts.push(`--host ${input.host}`)
  if (input.port && input.port !== 3210) parts.push(`--port ${input.port}`)
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

function quotePathForDisplay(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}
