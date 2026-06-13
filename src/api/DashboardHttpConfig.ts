import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, join, resolve } from 'node:path'
import type { DashboardProjectSummary } from '../dashboard/DashboardServer.js'

export interface DashboardHttpEnv {
  SCALE_DASHBOARD_HOST?: string
  HOST?: string
  SCALE_DASHBOARD_PORT?: string
  PORT?: string
  SCALE_DASHBOARD_AUTO_PORT?: string
  SCALE_DASHBOARD_PROJECT_DIR?: string
  SCALE_DASHBOARD_PROJECTS?: string
}

export interface DashboardPortConfig {
  port: number
  auto: boolean
}

export interface DashboardLaunchProject extends DashboardProjectSummary {
  port: number
  host: string
  url: string
}

export interface DashboardLaunchPlan {
  host: string
  projects: DashboardLaunchProject[]
}

export function parseDashboardPort(value: string | undefined, fallback = 3210): DashboardPortConfig {
  if (!value) return { port: fallback, auto: false }
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'auto') return { port: fallback, auto: true }
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid dashboard port: ${value}`)
  }
  return { port, auto: false }
}

export function parseDashboardProjects(env: DashboardHttpEnv, cwd = process.cwd()): DashboardProjectSummary[] {
  const multi = env.SCALE_DASHBOARD_PROJECTS?.trim()
  if (multi) {
    return multi
      .split(';')
      .map(entry => entry.trim())
      .filter(Boolean)
      .map((entry, index) => parseProjectEntry(entry, cwd, index))
  }

  const projectDir = resolve(env.SCALE_DASHBOARD_PROJECT_DIR ?? cwd)
  return [projectSummary(projectDir)]
}

export async function resolveDashboardLaunchPlan(
  env: DashboardHttpEnv = process.env,
  cwd = process.cwd(),
): Promise<DashboardLaunchPlan> {
  const host = env.SCALE_DASHBOARD_HOST ?? env.HOST ?? '0.0.0.0'
  const portConfig = parseDashboardPort(env.SCALE_DASHBOARD_PORT ?? env.PORT, 3210)
  const projects = parseDashboardProjects(env, cwd)
  const autoPort = portConfig.auto || truthy(env.SCALE_DASHBOARD_AUTO_PORT) || projects.length > 1
  let nextPort = portConfig.port
  const launchProjects: DashboardLaunchProject[] = []

  for (const project of projects) {
    const port = autoPort ? await findAvailablePort(nextPort, host) : nextPort
    const url = dashboardUrl(host, port)
    launchProjects.push({
      ...project,
      port,
      host,
      url,
      current: false,
    })
    nextPort = port + 1
  }

  return {
    host,
    projects: launchProjects.map(project => ({ ...project, current: false })),
  }
}

export async function findAvailablePort(startPort: number, host: string): Promise<number> {
  for (let port = startPort; port <= 65535; port += 1) {
    if (await canListen(port, host)) return port
  }
  throw new Error(`No available dashboard port at or above ${startPort}`)
}

function parseProjectEntry(entry: string, cwd: string, index: number): DashboardProjectSummary {
  const [rawName, rawPath] = splitProjectEntry(entry)
  const projectDir = resolve(cwd, rawPath)
  const name = rawName || basename(projectDir) || `project-${index + 1}`
  return projectSummary(projectDir, name)
}

function splitProjectEntry(entry: string): [string | undefined, string] {
  const separator = entry.includes('|') ? '|' : entry.includes('=') ? '=' : ''
  if (!separator) return [undefined, entry]
  const [name, ...rest] = entry.split(separator)
  const path = rest.join(separator).trim()
  return [name.trim() || undefined, path || entry]
}

function projectSummary(projectDir: string, name = basename(projectDir) || 'project'): DashboardProjectSummary {
  const scaleDir = join(projectDir, '.scale')
  const id = safeProjectId(name)
  return {
    id,
    name,
    projectDir,
    scaleDir,
  }
}

function dashboardUrl(host: string, port: number): string {
  const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  return `http://${displayHost}:${port}`
}

function truthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function safeProjectId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'project'
}

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise(resolveListen => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolveListen(false))
    server.once('listening', () => {
      server.close(() => resolveListen(true))
    })
    server.listen({ port, host })
  })
}

export function assertDashboardProjectsExist(projects: DashboardProjectSummary[]): string[] {
  return projects
    .filter(project => !existsSync(project.projectDir))
    .map(project => project.projectDir)
}
