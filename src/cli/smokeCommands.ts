import { defineCommand } from 'citty'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DashboardServer } from '../dashboard/DashboardServer.js'
import {
  ensureDashboardService,
  type DashboardServiceOptions,
  type DashboardServiceStatus,
} from '../dashboard/DashboardServiceSupervisor.js'
import { buildDashboardPageUrl } from './openCommands.js'

export type SmokeCheckStatus = 'pass' | 'warn' | 'fail' | 'skip'
export type SmokeReportStatus = 'passed' | 'degraded' | 'failed'

export interface SmokeCheck {
  id: string
  label: string
  status: SmokeCheckStatus
  message: string
  evidence?: Record<string, unknown>
}

export interface SmokeCommandOptions extends DashboardServiceOptions {
  sessionId?: string
  agentId?: string
  messageText?: string
  startDashboard?: boolean
  healthTimeoutMs?: number
}

export interface SmokeCommandReport {
  ok: boolean
  status: SmokeReportStatus
  projectDir: string
  scaleDir: string
  dashboard?: {
    url: string
    healthUrl: string
    status: DashboardServiceStatus['status']
    supervisorAlive: boolean
    serverAlive: boolean
  }
  checks: SmokeCheck[]
  artifacts: {
    reportPath?: string
  }
  nextActions: string[]
}

interface SmokeCommandDeps {
  ensureService?: (options: DashboardServiceOptions) => DashboardServiceStatus
  fetchHealth?: (url: string, timeoutMs: number) => Promise<{ ok: boolean; status?: number; error?: string; body?: unknown }>
}

const DEFAULT_PROJECT_DIR = process.env.SCALE_PROJECT_DIR ?? process.cwd()
const DEFAULT_SESSION_ID = 'scale-smoke'
const DEFAULT_AGENT_ID = 'scale-smoke-agent'

export const smokeCommand = defineCommand({
  meta: { name: 'smoke', description: 'Run a one-command SCALE install, dashboard, and message-channel acceptance check' },
  args: {
    dir: { type: 'string', default: DEFAULT_PROJECT_DIR, description: 'Project directory' },
    'scale-dir': { type: 'string', description: 'Scale directory; defaults to <dir>/.scale' },
    host: { type: 'string', default: process.env.SCALE_DASHBOARD_HOST ?? '127.0.0.1', description: 'Dashboard host' },
    port: { type: 'string', default: process.env.SCALE_DASHBOARD_PORT ?? '3210', description: 'Dashboard port' },
    session: { type: 'string', default: DEFAULT_SESSION_ID, description: 'Agent Control smoke-test session id' },
    'agent-id': { type: 'string', default: DEFAULT_AGENT_ID, description: 'Agent id used to claim the smoke-test message' },
    text: { type: 'string', default: 'SCALE smoke test: verify dashboard message loop.', description: 'Smoke-test message text' },
    dashboard: { type: 'boolean', default: true, description: 'Start dashboard daemon and run HTTP health check; use --no-dashboard to skip' },
    'timeout-ms': { type: 'string', default: '10000', description: 'Dashboard health-check timeout in milliseconds' },
    json: { type: 'boolean', default: false, description: 'Print JSON output' },
  },
  async run({ args }) {
    const report = await runSmokeChecks(normalizeSmokeArgs(args))
    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      renderSmokeReport(report)
    }
    if (report.status === 'failed') process.exitCode = 1
  },
})

export function normalizeSmokeArgs(args: Record<string, unknown>): SmokeCommandOptions {
  const projectDir = resolve(String(args.dir ?? DEFAULT_PROJECT_DIR))
  return {
    projectDir,
    scaleDir: args['scale-dir'] ? resolve(String(args['scale-dir'])) : join(projectDir, '.scale'),
    host: String(args.host ?? '127.0.0.1'),
    port: parsePort(args.port, 3210),
    sessionId: String(args.session ?? DEFAULT_SESSION_ID),
    agentId: String(args['agent-id'] ?? DEFAULT_AGENT_ID),
    messageText: String(args.text ?? 'SCALE smoke test: verify dashboard message loop.'),
    startDashboard: args.dashboard !== false && args['no-dashboard'] !== true,
    healthTimeoutMs: parsePositiveInt(args['timeout-ms'], 10000),
  }
}

export async function runSmokeChecks(options: SmokeCommandOptions, deps: SmokeCommandDeps = {}): Promise<SmokeCommandReport> {
  const projectDir = resolve(options.projectDir ?? DEFAULT_PROJECT_DIR)
  const scaleDir = resolve(options.scaleDir ?? join(projectDir, '.scale'))
  const checks: SmokeCheck[] = []
  const ensureService = deps.ensureService ?? ensureDashboardService
  const fetchHealth = deps.fetchHealth ?? waitForHealth
  let dashboard: SmokeCommandReport['dashboard']

  const projectExists = existsSync(projectDir)
  checks.push({
    id: 'project-directory',
    label: 'Project directory',
    status: projectExists ? 'pass' : 'fail',
    message: projectExists ? 'Project directory is reachable.' : `Project directory does not exist: ${projectDir}`,
    evidence: { projectDir },
  })

  const installed = inspectScaleInstall(scaleDir)
  checks.push({
    id: 'scale-install',
    label: 'SCALE install',
    status: installed.ok ? 'pass' : 'fail',
    message: installed.ok
      ? `SCALE project files detected (${installed.files.join(', ')}).`
      : 'SCALE project files are missing. Run scale install --dir . first.',
    evidence: { scaleDir, files: installed.files },
  })

  if (projectExists && installed.ok && options.startDashboard !== false) {
    try {
      const service = ensureService({
        projectDir,
        scaleDir,
        host: options.host,
        port: options.port,
        intervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs,
      })
      dashboard = {
        url: buildDashboardPageUrl(service.url, 'agents'),
        healthUrl: service.healthUrl,
        status: service.status,
        supervisorAlive: service.supervisorAlive,
        serverAlive: service.serverAlive,
      }
      const health = await fetchHealth(service.healthUrl, options.healthTimeoutMs ?? 10000)
      checks.push({
        id: 'dashboard-health',
        label: 'Dashboard health',
        status: health.ok ? 'pass' : 'fail',
        message: health.ok
          ? `Dashboard health endpoint responded with HTTP ${health.status ?? 200}.`
          : `Dashboard health endpoint did not become ready: ${health.error ?? 'unknown error'}`,
        evidence: { url: dashboard.url, healthUrl: service.healthUrl, status: health.status, body: health.body },
      })
    } catch (error) {
      checks.push({
        id: 'dashboard-health',
        label: 'Dashboard health',
        status: 'fail',
        message: `Dashboard daemon check failed: ${errorMessage(error)}`,
      })
    }
  } else if (options.startDashboard === false) {
    checks.push({
      id: 'dashboard-health',
      label: 'Dashboard health',
      status: 'skip',
      message: 'Dashboard daemon startup was skipped by --no-dashboard.',
    })
  }

  if (projectExists && installed.ok) {
    checks.push(await runAgentControlSmoke(projectDir, scaleDir, {
      sessionId: options.sessionId ?? DEFAULT_SESSION_ID,
      agentId: options.agentId ?? DEFAULT_AGENT_ID,
      messageText: options.messageText ?? 'SCALE smoke test: verify dashboard message loop.',
    }))
  } else {
    checks.push({
      id: 'agent-control-loop',
      label: 'Agent Control message loop',
      status: 'skip',
      message: 'Skipped because the project is not initialized with SCALE.',
    })
  }

  const report = finalizeSmokeReport({
    projectDir,
    scaleDir,
    dashboard,
    checks,
  })
  report.artifacts.reportPath = writeSmokeReport(report)
  return report
}

async function runAgentControlSmoke(
  projectDir: string,
  scaleDir: string,
  input: { sessionId: string; agentId: string; messageText: string },
): Promise<SmokeCheck> {
  const server = new DashboardServer({ projectDir, scaleDir })
  try {
    const sent = await dashboardJson<{ ok: boolean; message?: { id?: string; status?: string; dryRun?: boolean } }>(
      server,
      `/api/agent-control/sessions/${encodeURIComponent(input.sessionId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          text: input.messageText,
          from: 'scale-smoke',
          dryRun: true,
        }),
      },
    )
    const messageId = sent.message?.id
    if (!messageId) throw new Error('Agent Control did not return a message id.')

    const claimed = await dashboardJson<{ ok: boolean; message?: { id?: string; status?: string; claimedBy?: string } }>(
      server,
      `/api/agent-control/sessions/${encodeURIComponent(input.sessionId)}/messages/${encodeURIComponent(messageId)}/claim`,
      {
        method: 'POST',
        body: JSON.stringify({ agentId: input.agentId, note: 'SCALE smoke claim.' }),
      },
    )
    const completed = await dashboardJson<{
      ok: boolean
      message?: { id?: string; status?: string; result?: string }
      reply?: { id?: string; status?: string }
    }>(
      server,
      `/api/agent-control/sessions/${encodeURIComponent(input.sessionId)}/messages/${encodeURIComponent(messageId)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({
          agentId: input.agentId,
          status: 'completed',
          text: 'SCALE smoke reply: message loop completed.',
        }),
      },
    )
    const summary = await dashboardJson<{ ok: boolean; summary?: { messageCount?: number; completedMessages?: number; markdown?: string } }>(
      server,
      `/api/agent-control/sessions/${encodeURIComponent(input.sessionId)}/summary`,
      { method: 'POST' },
    )

    const statuses = [sent.message?.status, claimed.message?.status, completed.message?.status]
    const pass = sent.ok && claimed.ok && completed.ok && summary.ok && completed.message?.status === 'completed'
    return {
      id: 'agent-control-loop',
      label: 'Agent Control message loop',
      status: pass ? 'pass' : 'fail',
      message: pass
        ? 'Message send, claim, complete, reply, and summary all succeeded in dry-run mode.'
        : `Agent Control loop returned unexpected statuses: ${statuses.join(' -> ')}`,
      evidence: {
        sessionId: input.sessionId,
        messageId,
        dryRun: sent.message?.dryRun,
        statuses,
        replyStatus: completed.reply?.status,
        summaryMessages: summary.summary?.messageCount,
        summaryCompleted: summary.summary?.completedMessages,
      },
    }
  } catch (error) {
    return {
      id: 'agent-control-loop',
      label: 'Agent Control message loop',
      status: 'fail',
      message: `Agent Control smoke loop failed: ${errorMessage(error)}`,
    }
  }
}

async function dashboardJson<T>(server: DashboardServer, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await server.getApp().request(path, { ...init, headers })
  const payload = await response.json().catch(async () => ({ error: await response.text().catch(() => response.statusText) })) as unknown
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error?: unknown }).error)
      : response.statusText
    throw new Error(`Dashboard request failed (${response.status}): ${message}`)
  }
  return payload as T
}

function inspectScaleInstall(scaleDir: string): { ok: boolean; files: string[] } {
  const required = ['config.yaml', 'workspace.json', 'verification.json', 'skills.json', 'tools.json']
  const files = required.filter(file => existsSync(join(scaleDir, file)))
  return {
    ok: existsSync(scaleDir) && files.length >= 3,
    files,
  }
}

function finalizeSmokeReport(input: {
  projectDir: string
  scaleDir: string
  dashboard?: SmokeCommandReport['dashboard']
  checks: SmokeCheck[]
}): SmokeCommandReport {
  const status = input.checks.some(check => check.status === 'fail')
    ? 'failed'
    : input.checks.some(check => check.status === 'warn')
      ? 'degraded'
      : 'passed'
  const dashboardUrl = input.dashboard?.url ?? buildDashboardPageUrl(`http://127.0.0.1:3210`, 'agents')
  return {
    ok: status !== 'failed',
    status,
    projectDir: input.projectDir,
    scaleDir: input.scaleDir,
    dashboard: input.dashboard,
    checks: input.checks,
    artifacts: {},
    nextActions: status === 'failed'
      ? [
          `scale install --dir ${quotePathForDisplay(input.projectDir)}`,
          `scale open --dir ${quotePathForDisplay(input.projectDir)} --no-browser`,
          `scale dashboard daemon logs --dir ${quotePathForDisplay(input.projectDir)} --lines 120`,
        ]
      : [
          `scale open --dir ${quotePathForDisplay(input.projectDir)}`,
          dashboardUrl,
        ],
  }
}

function writeSmokeReport(report: SmokeCommandReport): string | undefined {
  try {
    const smokeDir = join(report.scaleDir, 'artifacts', 'smoke')
    mkdirSync(smokeDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const reportPath = join(smokeDir, `smoke-${stamp}.json`)
    const persisted: SmokeCommandReport = {
      ...report,
      artifacts: {
        ...report.artifacts,
        reportPath,
      },
    }
    writeFileSync(reportPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf-8')
    return reportPath
  } catch {
    return undefined
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<{ ok: boolean; status?: number; error?: string; body?: unknown }> {
  const deadline = Date.now() + Math.max(1000, timeoutMs)
  let lastError = 'health check timed out'
  while (Date.now() <= deadline) {
    const result = await fetchJsonWithTimeout(url, 1200)
    if (result.ok) return result
    lastError = result.error ?? `HTTP ${result.status ?? 'unknown'}`
    await sleep(400)
  }
  return { ok: false, error: lastError }
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; status?: number; error?: string; body?: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const body = await response.json().catch(async () => ({ text: await response.text().catch(() => '') })) as unknown
    return {
      ok: response.ok,
      status: response.status,
      body,
      error: response.ok ? undefined : response.statusText,
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  } finally {
    clearTimeout(timer)
  }
}

function renderSmokeReport(report: SmokeCommandReport): void {
  console.log('SCALE Smoke')
  console.log(`  Result: ${report.status}`)
  console.log(`  Project: ${report.projectDir}`)
  if (report.dashboard) console.log(`  Dashboard: ${report.dashboard.url}`)
  if (report.artifacts.reportPath) console.log(`  Report: ${report.artifacts.reportPath}`)
  console.log('')
  for (const check of report.checks) {
    console.log(`${statusMark(check.status)} ${check.label}: ${check.message}`)
  }
  console.log('')
  console.log('Next:')
  for (const action of report.nextActions) console.log(`  ${action}`)
}

function statusMark(status: SmokeCheckStatus): string {
  if (status === 'pass') return '[OK]'
  if (status === 'warn') return '[WARN]'
  if (status === 'skip') return '[SKIP]'
  return '[FAIL]'
}

function parsePort(value: unknown, fallback: number): number {
  const port = Number(value ?? fallback)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function quotePathForDisplay(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}
