import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export interface DashboardAuditEvent {
  event: 'request.started' | 'request.completed'
  requestId: string
  timestamp: number
  method: string
  path: string
  origin: string | null
  actor: 'loopback' | 'bearer-token'
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

export function assertDashboardSecurityConfig(host: string, token: string | undefined, allowedHosts: string[] = []): void {
  const hasPublicHostAlias = allowedHosts.some(allowedHost => !isDashboardLoopbackHost(allowedHost))
  if ((!isDashboardLoopbackHost(host) || hasPublicHostAlias) && !token?.trim()) {
    throw new Error('Non-loopback Dashboard binding requires SCALE_DASHBOARD_TOKEN (at least 32 characters).')
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

export function appendDashboardAuditEvent(path: string, event: DashboardAuditEvent): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(event) + '\n', { encoding: 'utf8', flag: 'a', mode: 0o600 })
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
