import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardServer } from '../../src/dashboard/DashboardServer.js'
import { hasValidDashboardBearerToken, isDashboardLoopbackHost, isDashboardOriginAllowed, normalizeDashboardAllowedOrigins } from '../../src/dashboard/DashboardSecurity.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Dashboard security primitives', () => {
  it('classifies loopback hosts without treating wildcard binds as local', () => {
    expect(isDashboardLoopbackHost('127.0.0.1')).toBe(true)
    expect(isDashboardLoopbackHost('::1')).toBe(true)
    expect(isDashboardLoopbackHost('localhost')).toBe(true)
    expect(isDashboardLoopbackHost('0.0.0.0')).toBe(false)
    expect(isDashboardLoopbackHost('192.168.1.10')).toBe(false)
  })

  it('allows only same-origin or explicitly configured browser origins', () => {
    expect(isDashboardOriginAllowed('http://127.0.0.1:3210', 'http://127.0.0.1:3210/api/health')).toBe(true)
    expect(isDashboardOriginAllowed('https://evil.example', 'http://127.0.0.1:3210/api/health')).toBe(false)
    expect(isDashboardOriginAllowed('https://console.example', 'https://dashboard.internal/api/health', ['https://console.example'])).toBe(true)
  })

  it('requires exact HTTP(S) origins in the allowlist', () => {
    expect(normalizeDashboardAllowedOrigins('https://console.example,http://localhost:3210')).toEqual(['https://console.example', 'http://localhost:3210'])
    expect(() => normalizeDashboardAllowedOrigins('https://console.example/path')).toThrow('exact HTTP(S) origins')
  })

  it('compares bearer tokens without accepting missing or malformed values', () => {
    expect(hasValidDashboardBearerToken('Bearer abc', 'abc')).toBe(true)
    expect(hasValidDashboardBearerToken('Bearer ab', 'abc')).toBe(false)
    expect(hasValidDashboardBearerToken(undefined, 'abc')).toBe(false)
  })
})

describe('DashboardServer security middleware', () => {
  it('rejects foreign origins and audits mutations without logging request bodies', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-security-'))
    roots.push(projectDir)
    const scaleDir = join(projectDir, '.scale')
    const auditPath = join(scaleDir, 'audit', 'dashboard-security.jsonl')
    const app = new DashboardServer({ projectDir, scaleDir, auditPath }).getApp()
    const blocked = await app.request('/api/knowledge-base/documents/import', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', content: 'sensitive payload' }),
    })
    expect(blocked.status).toBe(403)
    const accepted = await app.request('/api/knowledge-base/documents/import', {
      method: 'POST',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'security-test', content: 'safe' }),
    })
    expect(accepted.status).toBe(200)
    const audit = readFileSync(auditPath, 'utf8')
    expect(audit).toContain('request.started')
    expect(audit).toContain('request.completed')
    expect(audit).toContain('/api/knowledge-base/documents/import')
    expect(audit).not.toContain('sensitive payload')
  })

  it('requires a valid bearer token for non-loopback bindings', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-remote-'))
    roots.push(projectDir)
    const token = '0123456789abcdef0123456789abcdef'
    const app = new DashboardServer({ projectDir, host: '0.0.0.0', authToken: token }).getApp()
    expect((await app.request('/api/health')).status).toBe(401)
    expect((await app.request('/api/health', { headers: { Authorization: 'Bearer ' + token } })).status).toBe(200)
  })

  it('rejects non-loopback bindings without an operator token', () => {
    expect(() => new DashboardServer({ host: '0.0.0.0' })).toThrow('Non-loopback Dashboard binding requires SCALE_DASHBOARD_TOKEN')
  })
})
