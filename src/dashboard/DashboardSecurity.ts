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
  const normalized = host.trim().toLowerCase().replace(/^\\[|\\]$/g, '')
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
      || parsed.origin !== candidate.replace(/\\/$/, '')
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
    if (candidate.includes('/') || candidate.includes('@') || candidate.includes('://') || candidate.includes('*')) {
      throw new Error('Dashboard allowed hosts must be hostnames or IP addresses: ' + candidate)
    }
    let hostname: string
    try { hostname = new URL('http://' + candidate).hostname.toLowerCase().replace(/^\\[|\\]$/g, '') } catch {
      throw new Error('Invalid Dashboard allowed host: ' + candidate)
    }
    const normalizedCandidate = candidate.replace(/^\\[|\\]$/g, '')
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
  if (!hostHeader) return false
  let requestHost: string
  try {
    requestHost = new URL('http://' + hostHeader).hostname.toLowerCase().replace(/^\\[|\\]$/g, '')
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
  const match = authorization?.match(/^Bearer\\s+(.+)$/i)
  if (!match) return false
  const actual = Buffer.from(match[1]!, 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function appendDashboardAuditEvent(path: string, event: DashboardAuditEvent): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(event) + '\\n', { encoding: 'utf8', flag: 'a', mode: 0o600 })
}
