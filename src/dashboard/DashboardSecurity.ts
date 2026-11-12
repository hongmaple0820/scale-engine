import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export interface DashboardAuditEvent {
  event: 'request.started' | 'request.completed'
  requestId: string
  timestamp: number
  method: string
  path: string
  origin: string | null
  actor: 'loopback' | 'bearer-token' | 'scoped-token'
  status?: number
}

export function isDashboardLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '::1'
    || normalized === '::ffff:127.0.0.1' || (isIP(normalized) === 4 && normalized.startsWith('127.'))
}

export function normalizeDashboardAllowedOrigins(value: string | string[] | undefined): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',')
  const origins = new Set<string>()
  for (const entry of entries) {
    const candidate = entry.trim()
    if (!candidate) continue
    let parsed: URL
    try { parsed = new URL(candidate) } catch {
      throw new Error('Invalid Dashboard allowed origin: ' + candidate)
    }
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.origin !== candidate.replace(/\/$/, '')
      || parsed.username || parsed.password) {
      throw new Error('Dashboard allowed origins must be exact HTTP(S) origins: ' + candidate)
    }
    origins.add(parsed.origin)
  }
  return [...origins]
}

export function normalizeDashboardAllowedHosts(value: string | string[] | undefined): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',')
  const hosts = new Set<string>()
  for (const entry of entries) {
    const candidate = entry.trim().toLowerCase()
    if (!candidate) continue
    if (candidate.includes('/') || candidate.includes('@') || candidate.includes('://') || candidate.includes('*')) {
      throw new Error('Dashboard allowed hosts must be hostnames or IP addresses: ' + candidate)
    }
    let hostname: string
    try { hostname = new URL('http://' + candidate).hostname.toLowerCase().replace(/^\[|\]$/g, '') } catch {
      throw new Error('Invalid Dashboard allowed host: ' + candidate)
    }
    const normalizedCandidate = candidate.replace(/^\[|\]$/g, '')
    if (!hostname || hostname !== normalizedCandidate) {
      throw new Error('Dashboard allowed hosts must not include paths or credentials: ' + candidate)
    }
    hosts.add(hostname)
  }
  return [...hosts]
}

export function assertDashboardSecurityConfig(host: string, token: string | undefined, allowedHosts: string[] = [], hasScopedTokens = false): void {
  const hasPublicHostAlias = allowedHosts.some(allowedHost => !isDashboardLoopbackHost(allowedHost))
  if ((!isDashboardLoopbackHost(host) || hasPublicHostAlias) && !token?.trim() && !hasScopedTokens) {
    throw new Error('Non-loopback Dashboard binding requires SCALE_DASHBOARD_TOKEN or at least one SCALE_DASHBOARD_SCOPED_TOKENS entry.')
  }
  if (!isDashboardLoopbackHost(host) && allowedHosts.length === 0) {
    throw new Error('Non-loopback Dashboard binding requires SCALE_DASHBOARD_ALLOWED_HOSTS.')
  }
  if (token?.trim() && token.trim().length < 32) {
    throw new Error('SCALE_DASHBOARD_TOKEN must contain at least 32 characters.')
  }
}

export function isDashboardHostAllowed(hostHeader: string | undefined, bindHost: string, allowedHosts: string[] = []): boolean {
  if (!hostHeader || hostHeader !== hostHeader.trim()) return false
  let requestHost: string
  try {
    const parsed = new URL('http://' + hostHeader)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false
    requestHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch { return false }
  if (allowedHosts.includes(requestHost)) return true
  return isDashboardLoopbackHost(bindHost) && isDashboardLoopbackHost(requestHost)
}

export function isDashboardOriginAllowed(origin: string, requestUrl: string, allowedOrigins: string[] = []): boolean {
  try {
    const parsed = new URL(origin)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false
    return parsed.origin === new URL(requestUrl).origin || allowedOrigins.includes(parsed.origin)
  } catch { return false }
}

export function hasValidDashboardBearerToken(authorization: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match) return false
  const actual = Buffer.from(match[1]!, 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const DASHBOARD_SCOPES = [
  'dashboard:read',
  'dashboard:write',
  'dashboard:admin',
  'agent-control:read',
  'agent-control:write',
  'agent-control:admin',
  'integrations:read',
  'integrations:write',
  'integrations:admin',
  'bridge:read',
  'bridge:write',
  'bridge:admin',
  'tasks:read',
  'tasks:write',
  'tasks:admin',
  'governance:read',
  'governance:write',
  'governance:admin',
] as const

export type DashboardScope = typeof DASHBOARD_SCOPES[number]

export interface DashboardScopedToken {
  id: string
  token: string
  scopes: DashboardScope[]
}

export interface DashboardAuthorization {
  principal: string
  kind: 'admin' | 'scoped'
  scopes: Array<DashboardScope | '*'>
}

export function parseDashboardScopedTokens(value: string | undefined): DashboardScopedToken[] {
  if (!value?.trim()) return []
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch {
    throw new Error('SCALE_DASHBOARD_SCOPED_TOKENS must be a JSON array.')
  }
  if (!Array.isArray(parsed)) throw new Error('SCALE_DASHBOARD_SCOPED_TOKENS must be a JSON array.')
  const ids = new Set<string>()
  const tokens = new Set<string>()
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Dashboard scoped token ${index + 1} must be an object.`)
    }
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const token = typeof record.token === 'string' ? record.token.trim() : ''
    const scopes = Array.isArray(record.scopes) ? record.scopes : []
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) throw new Error(`Dashboard scoped token ${index + 1} has an invalid id.`)
    if (token.length < 32) throw new Error(`Dashboard scoped token "${id}" must contain at least 32 characters.`)
    if (ids.has(id) || tokens.has(token)) throw new Error('Dashboard scoped token ids and values must be unique.')
    if (scopes.length === 0 || scopes.some(scope => typeof scope !== 'string' || !DASHBOARD_SCOPES.includes(scope as DashboardScope))) {
      throw new Error(`Dashboard scoped token "${id}" has invalid or empty scopes.`)
    }
    ids.add(id)
    tokens.add(token)
    return { id, token, scopes: [...new Set(scopes as DashboardScope[])] }
  })
}

export function assertDashboardScopedTokens(adminToken: string | undefined, scopedTokens: DashboardScopedToken[]): void {
  const normalizedAdmin = adminToken?.trim()
  if (normalizedAdmin && scopedTokens.some(entry => entry.token === normalizedAdmin)) {
    throw new Error('Dashboard scoped tokens must not reuse SCALE_DASHBOARD_TOKEN.')
  }
}

export function resolveDashboardAuthorization(
  authorization: string | undefined,
  adminToken: string | undefined,
  scopedTokens: DashboardScopedToken[] = [],
): DashboardAuthorization | null {
  if (hasValidDashboardBearerToken(authorization, adminToken)) {
    return { principal: 'admin', kind: 'admin', scopes: ['*'] }
  }
  for (const entry of scopedTokens) {
    if (hasValidDashboardBearerToken(authorization, entry.token)) {
      return { principal: entry.id, kind: 'scoped', scopes: entry.scopes }
    }
  }
  return null
}

export function requiredDashboardScope(method: string, path: string): DashboardScope {
  const verb = method.toUpperCase()
  const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)
  const scope = (read: DashboardScope, mutation: DashboardScope): DashboardScope => write ? mutation : read

  if (path === '/api/v1/restart' || path === '/api/v1/reload'
    || path.startsWith('/api/dashboard/service/actions/')
    || path === '/api/v1/capabilities/map') return 'dashboard:admin'
  if (/^\/api\/v1\/cron\/[^/]+\/exec$/.test(path)) return 'tasks:admin'
  if (/^\/api\/v1\/projects\/[^/]+\/model$/.test(path)) return 'agent-control:admin'
  if (path.startsWith('/api/agent-control') || path.startsWith('/api/v1/projects/')) {
    if (path.includes('/enable-local-executor')) return 'agent-control:admin'
    return scope('agent-control:read', 'agent-control:write')
  }
  if (path.startsWith('/api/integrations')) {
    if (/\/(auth|config|setup|bootstrap-local|acceptance|bridge\/start|bridge\/stop)(\/|$)/i.test(path)
      || path.startsWith('/api/integrations/feishu/actions/')
      || path === '/api/integrations/agent-connect'
      || path === '/api/integrations/feishu/route'
      || path === '/api/integrations/knowledge/tencent-ima') {
      return write ? 'integrations:admin' : 'integrations:read'
    }
    return scope('integrations:read', 'integrations:write')
  }
  if (path.startsWith('/api/v1/bridges') || path.startsWith('/bridge/') || path.startsWith('/agent-connect/')) {
    if (path === '/api/v1/bridges/register' || verb === 'DELETE') return 'bridge:admin'
    return scope('bridge:read', 'bridge:write')
  }
  if (path.startsWith('/api/v1/tasks')) return scope('tasks:read', 'tasks:write')
  if (path.startsWith('/api/v1/governance')) {
    if (path.startsWith('/api/v1/governance/config/')) return 'governance:admin'
    return scope('governance:read', 'governance:write')
  }
  if (/^\/api\/lessons\/[^/]+\/(approve|reject)$/.test(path)
    || /^\/api\/knowledge\/local\/[^/]+\/review$/.test(path)) return 'governance:admin'
  return scope('dashboard:read', 'dashboard:write')
}

export function dashboardAuthorizationAllows(authorization: DashboardAuthorization, scope: DashboardScope): boolean {
  const domainAdmin = `${scope.split(':')[0]}:admin` as DashboardScope
  return authorization.scopes.includes('*') || authorization.scopes.includes('dashboard:admin')
    || authorization.scopes.includes(scope) || authorization.scopes.includes(domainAdmin)
}

export function appendDashboardAuditEvent(path: string, event: DashboardAuditEvent): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a', mode: 0o600 })
}


export interface DashboardConfirmationChallenge {
  token: string
  expiresAt: number
}

interface StoredDashboardConfirmation {
  principal: string
  method: string
  path: string
  expiresAt: number
}

/** Short-lived, single-use confirmation tokens bound to one principal and exact HTTP action. */
export class DashboardConfirmationStore {
  private readonly challenges = new Map<string, StoredDashboardConfirmation>()

  constructor(private readonly ttlMs = 60_000, private readonly maxEntries = 512) {}

  issue(principal: string, method: string, path: string, now = Date.now()): DashboardConfirmationChallenge {
    this.prune(now)
    while (this.challenges.size >= this.maxEntries) {
      const oldest = this.challenges.keys().next().value
      if (oldest === undefined) break
      this.challenges.delete(oldest)
    }
    const token = randomBytes(32).toString('hex')
    const expiresAt = now + Math.max(1_000, this.ttlMs)
    this.challenges.set(token, { principal, method: method.toUpperCase(), path, expiresAt })
    return { token, expiresAt }
  }

  consume(token: string | undefined, principal: string, method: string, path: string, now = Date.now()): boolean {
    if (!token) return false
    const challenge = this.challenges.get(token)
    if (!challenge) return false
    this.challenges.delete(token)
    return challenge.expiresAt > now
      && challenge.principal === principal
      && challenge.method === method.toUpperCase()
      && challenge.path === path
  }

  private prune(now: number): void {
    for (const [token, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(token)
    }
  }
}

export function requiresDashboardConfirmation(method: string, path: string): boolean {
  const verb = method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) return false
  return path === '/api/v1/restart'
    || path === '/api/v1/reload'
    || path === '/api/dashboard/service/actions/restart'
    || path === '/api/v1/capabilities/map'
    || /^\/api\/v1\/projects\/[^/]+\/model$/.test(path)
    || /^\/api\/v1\/cron\/[^/]+\/exec$/.test(path)
    || /^\/api\/agent-control\/sessions\/[^/]+\/enable-local-executor$/.test(path)
    || /^\/api\/v1\/governance\/config\/.+$/.test(path)
    || /^\/api\/lessons\/[^/]+\/approve$/.test(path)
    || /^\/api\/knowledge\/local\/[^/]+\/review$/.test(path)
    || (path.startsWith('/api/integrations/') && (
      /\/(auth|config|setup|bootstrap-local|acceptance|bridge\/start|bridge\/stop)(\/|$)/i.test(path)
      || path.startsWith('/api/integrations/feishu/actions/')
      || path === '/api/integrations/agent-connect'
      || path === '/api/integrations/feishu/route'
      || path === '/api/integrations/knowledge/tencent-ima'
    ))
    || path === '/api/v1/bridges/register'
    || (verb === 'DELETE' && (path.startsWith('/api/v1/bridges/') || path.startsWith('/bridge/sessions/')))
}

export interface DashboardRateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
}

/** Process-local fixed-window limiter for Dashboard HTTP requests. */
export class DashboardRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>()

  constructor(private readonly maxEntries = 4096) {}

  consume(key: string, limit: number, windowMs: number, now = Date.now()): DashboardRateLimitDecision {
    const normalizedLimit = Math.max(1, Math.floor(limit))
    const normalizedWindow = Math.max(1, Math.floor(windowMs))
    const current = this.windows.get(key)
    if (!current || current.resetAt <= now) {
      this.prune(now)
      this.windows.set(key, { count: 1, resetAt: now + normalizedWindow })
      return { allowed: true, retryAfterSeconds: 0 }
    }
    if (current.count >= normalizedLimit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      }
    }
    current.count += 1
    return { allowed: true, retryAfterSeconds: 0 }
  }

  private prune(now: number): void {
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key)
    }
    while (this.windows.size >= this.maxEntries) {
      const oldest = this.windows.keys().next().value
      if (oldest === undefined) break
      this.windows.delete(oldest)
    }
  }
}
