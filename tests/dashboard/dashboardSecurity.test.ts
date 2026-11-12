import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DashboardServer } from '../../src/dashboard/DashboardServer.js'
import { assertDashboardSecurityConfig, DashboardRateLimiter, dashboardAuthorizationAllows, hasValidDashboardBearerToken, isDashboardLoopbackHost, isDashboardOriginAllowed, isDashboardHostAllowed, normalizeDashboardAllowedHosts, normalizeDashboardAllowedOrigins, parseDashboardScopedTokens, requiredDashboardScope, resolveDashboardAuthorization } from '../../src/dashboard/DashboardSecurity.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Dashboard security primitives', () => {
  it('classifies loopback hosts without treating wildcard binds as local', () => {
    expect(isDashboardLoopbackHost('127.0.0.1')).toBe(true)
    expect(isDashboardLoopbackHost('::1')).toBe(true)
    expect(isDashboardLoopbackHost('localhost')).toBe(true)
    expect(isDashboardLoopbackHost('0.0.0.0')).toBe(false)
    expect(isDashboardLoopbackHost('192.168.1.10')).toBe(false)
    expect(isDashboardHostAllowed('attacker.example', '127.0.0.1')).toBe(false)
    expect(isDashboardHostAllowed('localhost:3210', '127.0.0.1')).toBe(true)
    expect(isDashboardHostAllowed('dashboard.example:443', '0.0.0.0', ['dashboard.example'])).toBe(true)
    expect(normalizeDashboardAllowedHosts('[2001:db8::10]')).toEqual(['2001:db8::10'])
    expect(isDashboardHostAllowed('[2001:db8::10]:443', '::', ['2001:db8::10'])).toBe(true)
    expect(isDashboardHostAllowed('[::1]:3210', '::1')).toBe(true)
    expect(isDashboardHostAllowed('trusted.example@attacker.example', '0.0.0.0', ['attacker.example'])).toBe(false)
    expect(isDashboardHostAllowed('dashboard.example/path', '0.0.0.0', ['dashboard.example'])).toBe(false)
    expect(isDashboardHostAllowed(' dashboard.example', '0.0.0.0', ['dashboard.example'])).toBe(false)
  })

  it('allows only same-origin or explicitly configured browser origins', () => {
    expect(isDashboardOriginAllowed('http://127.0.0.1:3210', 'http://127.0.0.1:3210/api/health')).toBe(true)
    expect(isDashboardOriginAllowed('https://evil.example', 'http://127.0.0.1:3210/api/health')).toBe(false)
    expect(isDashboardOriginAllowed('https://console.example', 'https://dashboard.internal/api/health', ['https://console.example'])).toBe(true)
  })

  it('requires explicit host allowlists for non-loopback binds', () => {
    expect(normalizeDashboardAllowedHosts('dashboard.example,localhost')).toEqual(['dashboard.example', 'localhost'])
    expect(normalizeDashboardAllowedHosts('')).toEqual([])
    expect(normalizeDashboardAllowedHosts(undefined)).toEqual([])
    expect(() => normalizeDashboardAllowedHosts('https://dashboard.example')).toThrow('hostnames or IP addresses')
    expect(() => normalizeDashboardAllowedHosts('*.example.com')).toThrow('hostnames or IP addresses')
  })

  it('requires exact HTTP(S) origins in the allowlist', () => {
    expect(normalizeDashboardAllowedOrigins('https://console.example,http://localhost:3210')).toEqual(['https://console.example', 'http://localhost:3210'])
    expect(() => normalizeDashboardAllowedOrigins('https://console.example/path')).toThrow('exact HTTP(S) origins')
  })

  it('allows scoped credentials to satisfy remote binding requirements without an admin token', () => {
    expect(() => assertDashboardSecurityConfig('0.0.0.0', undefined, ['localhost'])).toThrow('SCOPED_TOKENS')
    expect(() => assertDashboardSecurityConfig('0.0.0.0', undefined, ['localhost'], true)).not.toThrow()
    expect(() => assertDashboardSecurityConfig('127.0.0.1', undefined, ['dashboard.example'], true)).not.toThrow()
  })

  it('parses scoped bearer tokens and rejects malformed or duplicate credentials', () => {
    const token = 'a'.repeat(32)
    expect(parseDashboardScopedTokens(JSON.stringify([{ id: 'viewer', token, scopes: ['dashboard:read', 'agent-control:read'] }]))).toEqual([
      { id: 'viewer', token, scopes: ['dashboard:read', 'agent-control:read'] },
    ])
    expect(() => parseDashboardScopedTokens('{broken')).toThrow('JSON array')
    expect(() => parseDashboardScopedTokens(JSON.stringify([{ id: 'viewer', token: 'short', scopes: ['dashboard:read'] }]))).toThrow('at least 32 characters')
    expect(() => parseDashboardScopedTokens(JSON.stringify([
      { id: 'viewer', token, scopes: ['dashboard:read'] },
      { id: 'viewer', token: 'b'.repeat(32), scopes: ['dashboard:read'] },
    ]))).toThrow('unique')
  })

  it('maps Dashboard routes to least-privilege scopes', () => {
    expect(requiredDashboardScope('GET', '/api/health')).toBe('dashboard:read')
    expect(requiredDashboardScope('POST', '/api/agent-control/sessions/s1/messages')).toBe('agent-control:write')
    expect(requiredDashboardScope('GET', '/api/integrations/agent-connect')).toBe('integrations:read')
    expect(requiredDashboardScope('PUT', '/api/integrations/agent-connect')).toBe('integrations:admin')
    expect(requiredDashboardScope('POST', '/api/v1/bridges/register')).toBe('bridge:admin')
    expect(requiredDashboardScope('POST', '/api/v1/restart')).toBe('dashboard:admin')
    expect(requiredDashboardScope('POST', '/api/v1/reload')).toBe('dashboard:admin')
    expect(requiredDashboardScope('POST', '/api/v1/projects/demo/model')).toBe('agent-control:admin')
    expect(requiredDashboardScope('POST', '/api/v1/cron/nightly/exec')).toBe('tasks:admin')
    expect(requiredDashboardScope('POST', '/api/v1/governance/config/policy')).toBe('governance:admin')
    expect(requiredDashboardScope('POST', '/api/lessons/lesson-1/approve')).toBe('governance:admin')
    expect(requiredDashboardScope('POST', '/api/agent-control/sessions/s1/enable-local-executor')).toBe('agent-control:admin')
  })

  it('resolves scoped and admin bearer tokens without widening scoped permissions', () => {
    const adminToken = 'admin'.padEnd(32, 'x')
    const viewerToken = 'viewer'.padEnd(32, 'x')
    const scopedTokens = parseDashboardScopedTokens(JSON.stringify([{ id: 'viewer', token: viewerToken, scopes: ['dashboard:read'] }]))
    const viewer = resolveDashboardAuthorization('Bearer ' + viewerToken, adminToken, scopedTokens)
    const admin = resolveDashboardAuthorization('Bearer ' + adminToken, adminToken, scopedTokens)
    expect(viewer?.kind).toBe('scoped')
    expect(dashboardAuthorizationAllows(viewer!, 'dashboard:read')).toBe(true)
    expect(dashboardAuthorizationAllows(viewer!, 'agent-control:write')).toBe(false)
    expect(dashboardAuthorizationAllows(viewer!, 'agent-control:admin')).toBe(false)
    const agentAdmin = { principal: 'agent-admin', kind: 'scoped' as const, scopes: ['agent-control:admin'] as Array<'agent-control:admin'> }
    expect(dashboardAuthorizationAllows(agentAdmin, 'agent-control:read')).toBe(true)
    expect(dashboardAuthorizationAllows(agentAdmin, 'agent-control:write')).toBe(true)
    expect(dashboardAuthorizationAllows(agentAdmin, 'integrations:write')).toBe(false)
    expect(dashboardAuthorizationAllows(admin!, 'agent-control:write')).toBe(true)
  })

  it('enforces fixed-window request limits and resets expired buckets', () => {
    const limiter = new DashboardRateLimiter(2)
    expect(limiter.consume('principal:read', 2, 1000, 0)).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(limiter.consume('principal:read', 2, 1000, 100)).toEqual({ allowed: true, retryAfterSeconds: 0 })
    expect(limiter.consume('principal:read', 2, 1000, 200)).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(limiter.consume('principal:read', 2, 1000, 1000)).toEqual({ allowed: true, retryAfterSeconds: 0 })
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
    const rebound = await app.request('/api/health', { headers: { Host: 'attacker.example', Origin: 'https://attacker.example' } })
    expect(rebound.status).toBe(403)
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
    await app.request('/api/integrations/agent-connect')
    await app.request('/bridge/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const expandedAudit = readFileSync(auditPath, 'utf8')
    expect(expandedAudit).toContain('GET')
    expect(expandedAudit).toContain('/api/integrations/agent-connect')
    expect(expandedAudit).toContain('/bridge/events')
    expect(expandedAudit).not.toContain('sensitive payload')
  })

  it('fails closed when the mutation audit cannot be written', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-audit-fail-'))
    roots.push(projectDir)
    const blocker = join(projectDir, 'audit-parent')
    writeFileSync(blocker, 'not a directory')
    const app = new DashboardServer({ projectDir, auditPath: join(blocker, 'audit.jsonl') }).getApp()
    const response = await app.request('/api/knowledge-base/documents/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'must-not-write', content: 'no side effect' }),
    })
    expect(response.status).toBe(503)
  })

  it('allows an allowlisted preflight but still requires a bearer token for the actual request', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-preflight-'))
    roots.push(projectDir)
    const token = '0123456789abcdef0123456789abcdef'
    const app = new DashboardServer({ projectDir, host: '0.0.0.0', authToken: token, allowedHosts: ['localhost'], allowedOrigins: ['https://console.example'] }).getApp()
    const preflight = await app.request('/api/health', { method: 'OPTIONS', headers: { Origin: 'https://console.example', 'Access-Control-Request-Method': 'GET' } })
    expect(preflight.status).toBe(204)
    const unauthorized = await app.request('/api/health', { headers: { Origin: 'https://console.example' } })
    expect(unauthorized.status).toBe(401)
  })

  it('rate limits repeated remote authentication failures and returns Retry-After', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-auth-rate-limit-'))
    roots.push(projectDir)
    const token = '0123456789abcdef0123456789abcdef'
    const app = new DashboardServer({ host: '0.0.0.0', authToken: token, allowedHosts: ['localhost'], allowedOrigins: ['https://console.example'] }).getApp()
    const headers = { Origin: 'https://console.example' }
    const paths = ['/api/health', '/health', '/api/project', '/api/projects', '/api/state']
    for (let index = 0; index < 10; index += 1) {
      expect((await app.request(paths[index % paths.length]!, { headers })).status).toBe(401)
    }
    const limited = await app.request('/api/health', { headers })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('allows scoped remote tokens only the configured read permissions', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-scoped-auth-'))
    roots.push(projectDir)
    const adminToken = 'admin'.padEnd(32, 'x')
    const viewerToken = 'viewer'.padEnd(32, 'x')
    const app = new DashboardServer({
      host: '0.0.0.0',
      authToken: adminToken,
      scopedTokens: [{ id: 'viewer', token: viewerToken, scopes: ['dashboard:read', 'integrations:read'] }],
      allowedHosts: ['localhost'],
    }).getApp()
    const headers = { Authorization: 'Bearer ' + viewerToken }
    expect((await app.request('/api/health', { headers })).status).toBe(200)
    expect((await app.request('/api/integrations/agent-connect', { headers })).status).toBe(200)
    const denied = await app.request('/api/agent-control/sessions/s1/messages', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'not allowed' }),
    })
    expect(denied.status).toBe(403)
    expect(await denied.text()).toContain('required scope')
  })

  it('supports scoped-only authentication on non-loopback bindings', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-scoped-only-'))
    roots.push(projectDir)
    const viewerToken = 'viewer'.padEnd(32, 'x')
    const app = new DashboardServer({
      projectDir,
      host: '0.0.0.0',
      scopedTokens: [{ id: 'viewer', token: viewerToken, scopes: ['dashboard:read'] }],
      allowedHosts: ['localhost'],
    }).getApp()
    expect((await app.request('/api/health')).status).toBe(401)
    expect((await app.request('/api/health', { headers: { Authorization: 'Bearer ' + viewerToken } })).status).toBe(200)
    const denied = await app.request('/api/agent-control/sessions/s1/messages', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + viewerToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'not allowed' }),
    })
    expect(denied.status).toBe(403)
  })

  it('requires a valid bearer token for non-loopback bindings', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-dashboard-remote-'))
    roots.push(projectDir)
    const token = '0123456789abcdef0123456789abcdef'
    const app = new DashboardServer({ projectDir, host: '0.0.0.0', authToken: token, allowedHosts: ['localhost'] }).getApp()
    expect((await app.request('/api/health')).status).toBe(401)
    expect((await app.request('/api/health', { headers: { Authorization: 'Bearer ' + token } })).status).toBe(200)
  })

  it('rejects non-loopback bindings without an operator token', () => {
    expect(() => new DashboardServer({ host: '0.0.0.0' })).toThrow('Non-loopback Dashboard binding requires SCALE_DASHBOARD_TOKEN or at least one SCALE_DASHBOARD_SCOPED_TOKENS entry')
  })
})
