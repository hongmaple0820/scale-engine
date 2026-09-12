import { createServer, type Server } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  findAvailablePort,
  parseDashboardPort,
  resolveDashboardLaunchPlan,
} from '../../src/api/DashboardHttpConfig.js'

const host = '127.0.0.1'
const tempDirs: string[] = []

afterAll(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseDashboardPort', () => {
  it('falls back to 3210 when no port is configured', () => {
    expect(parseDashboardPort(undefined)).toEqual({ port: 3210, auto: false })
    expect(parseDashboardPort('')).toEqual({ port: 3210, auto: false })
  })

  it('recognizes the auto keyword', () => {
    expect(parseDashboardPort('auto')).toEqual({ port: 3210, auto: true })
    expect(parseDashboardPort(' AUTO ')).toEqual({ port: 3210, auto: true })
  })

  it('accepts explicit ports and rejects invalid values', () => {
    expect(parseDashboardPort('3255')).toEqual({ port: 3255, auto: false })
    expect(() => parseDashboardPort('not-a-port')).toThrow('Invalid dashboard port: not-a-port')
    expect(() => parseDashboardPort('0')).toThrow('Invalid dashboard port: 0')
    expect(() => parseDashboardPort('70000')).toThrow('Invalid dashboard port: 70000')
  })
})

describe('findAvailablePort', () => {
  it('returns the next port when the requested one is occupied', async () => {
    const holders = await occupyPorts(1)
    try {
      const port = await findAvailablePort(holders[0].port, host)
      expect(port).toBe(holders[0].port + 1)
    } finally {
      closeAll(holders)
    }
  })

  it('falls back past ten consecutive occupied ports', async () => {
    const holders = await occupyConsecutivePorts(10)
    try {
      const port = await findAvailablePort(holders[0].port, host)
      expect(port).toBe(holders[0].port + 10)
    } finally {
      closeAll(holders)
    }
  })

  it('returns the requested port when it is free', async () => {
    const holders = await occupyPorts(1)
    try {
      const port = await findAvailablePort(holders[0].port + 1, host)
      expect(port).toBe(holders[0].port + 1)
    } finally {
      closeAll(holders)
    }
  })
})

describe('resolveDashboardLaunchPlan', () => {
  it('keeps the configured port without probing in single-project mode', async () => {
    const holders = await occupyPorts(1)
    const projectDir = tempProjectDir()
    try {
      const plan = await resolveDashboardLaunchPlan({
        SCALE_DASHBOARD_HOST: host,
        SCALE_DASHBOARD_PORT: String(holders[0].port),
      }, projectDir)
      expect(plan.host).toBe(host)
      expect(plan.projects).toHaveLength(1)
      expect(plan.projects[0].port).toBe(holders[0].port)
      expect(plan.projects[0].url).toBe(`http://${host}:${holders[0].port}`)
    } finally {
      closeAll(holders)
    }
  })

  it('probes upward in auto mode when the configured port is occupied', async () => {
    const holders = await occupyPorts(2)
    const projectDir = tempProjectDir()
    try {
      const plan = await resolveDashboardLaunchPlan({
        SCALE_DASHBOARD_HOST: host,
        SCALE_DASHBOARD_PORT: String(holders[0].port),
        SCALE_DASHBOARD_AUTO_PORT: '1',
      }, projectDir)
      expect(plan.projects[0].port).toBe(holders[0].port + 2)
    } finally {
      closeAll(holders)
    }
  })

  it('assigns consecutive probed ports to multiple projects', async () => {
    const holders = await occupyPorts(1)
    const projectDir = tempProjectDir()
    const otherProjectDir = tempProjectDir()
    try {
      const plan = await resolveDashboardLaunchPlan({
        SCALE_DASHBOARD_HOST: host,
        SCALE_DASHBOARD_PORT: String(holders[0].port),
        SCALE_DASHBOARD_PROJECTS: `first|${projectDir};second|${otherProjectDir}`,
      }, projectDir)
      expect(plan.projects).toHaveLength(2)
      expect(plan.projects.map(project => project.port)).toEqual([
        holders[0].port + 1,
        holders[0].port + 2,
      ])
      expect(plan.projects.map(project => project.name)).toEqual(['first', 'second'])
    } finally {
      closeAll(holders)
    }
  })
})

interface PortHolder {
  port: number
  server: Server
}

async function occupyPorts(count: number): Promise<PortHolder[]> {
  const holders: PortHolder[] = []
  for (let attempt = 0; attempt < 8 && holders.length === 0; attempt += 1) {
    const base = 21000 + Math.floor(Math.random() * 20000)
    try {
      for (let offset = 0; offset < count; offset += 1) {
        holders.push(await listenOn(base + offset))
      }
    } catch {
      closeAll(holders)
      holders.length = 0
    }
  }
  if (holders.length !== count) throw new Error('failed to occupy ports for the test')
  return holders
}

async function occupyConsecutivePorts(count: number): Promise<PortHolder[]> {
  return occupyPorts(count)
}

async function listenOn(port: number): Promise<PortHolder> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', error => reject(error))
    server.once('listening', () => resolve({ port, server }))
    server.listen({ port, host })
  })
}

function closeAll(holders: PortHolder[]): void {
  for (const holder of holders) holder.server.close()
}

function tempProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-dashboard-http-config-'))
  tempDirs.push(dir)
  return dir
}
