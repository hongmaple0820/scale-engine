import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { RuntimeEvidenceLedger, type RuntimeEvidenceSummary } from './RuntimeEvidenceLedger.js'
import { SessionLedger, type RuntimeSessionLevel } from './SessionLedger.js'
import { loadVerificationMatrix, resolveVerificationPolicy } from '../workflow/VerificationProfile.js'

export type RuntimeDoctorStatus = 'ok' | 'warn' | 'fail'

export interface RuntimeDoctorCheck {
  name: string
  status: RuntimeDoctorStatus
  message: string
  fix?: string
}

export interface RuntimeDoctorOptions {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  sessionId?: string
  level?: RuntimeSessionLevel
}

export interface RuntimeDoctorReport {
  ok: boolean
  blocked: boolean
  checks: RuntimeDoctorCheck[]
  evidence: RuntimeEvidenceSummary
}

export function doctorRuntimeEvidence(options: RuntimeDoctorOptions = {}): RuntimeDoctorReport {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleRoot = isAbsolute(options.scaleDir ?? '')
    ? options.scaleDir as string
    : join(projectDir, options.scaleDir ?? '.scale')
  const evidenceDir = join(scaleRoot, 'evidence', 'runtime')
  const sessionsDir = join(scaleRoot, 'events', 'sessions')
  const evidenceLedger = new RuntimeEvidenceLedger({ projectDir, scaleDir: scaleRoot, createDirs: false })
  const sessionLedger = new SessionLedger({ projectDir, scaleDir: scaleRoot, createDirs: false })
  const policy = resolveVerificationPolicy(loadVerificationMatrix(projectDir, scaleRoot))
  const evidence = evidenceLedger.summary({
    taskId: options.taskId,
    sessionId: options.sessionId,
  })
  const evidenceRecords = evidenceLedger.list({
    taskId: options.taskId,
    sessionId: options.sessionId,
    limit: Number.MAX_SAFE_INTEGER,
  })

  const checks: RuntimeDoctorCheck[] = []
  checks.push(checkDirectory('Runtime evidence directory', evidenceDir, 'Run: scale runtime record ...'))
  checks.push(checkDirectory('Runtime session directory', sessionsDir, 'Run: scale runtime start --session-id <id>'))
  checks.push(checkSessionJsonl(sessionsDir, options.sessionId))

  if (options.sessionId) {
    const events = sessionLedger.listEvents(options.sessionId)
    checks.push(events.length > 0
      ? { name: 'Runtime session events', status: 'ok', message: `${events.length} event(s) for ${options.sessionId}` }
      : { name: 'Runtime session events', status: 'warn', message: `No events recorded for ${options.sessionId}`, fix: 'Run: scale runtime start or append runtime events' })
  }

  if (evidence.failed > 0) {
    checks.push({
      name: 'Runtime failed evidence',
      status: 'fail',
      message: `${evidence.failed} failed runtime evidence record(s)`,
      fix: 'Fix the failing command/tool output and record a passing evidence item',
    })
  } else {
    checks.push({
      name: 'Runtime failed evidence',
      status: 'ok',
      message: evidence.expectedRed > 0
        ? `No unresolved failed runtime evidence records; ${evidence.expectedRed} expected red reproduction record(s)`
        : evidence.resolvedFailed > 0
          ? `No unresolved failed runtime evidence records; ${evidence.resolvedFailed} resolved failed record(s)`
        : 'No failed runtime evidence records',
    })
  }

  const level = options.level ?? 'M'
  if (level !== 'S' && evidence.passed === 0) {
    checks.push({
      name: 'Runtime completion evidence',
      status: 'warn',
      message: `No passed evidence recorded for ${scopeLabel(options)}`,
      fix: 'Record at least one passed command, gate, tool, browser, or skill evidence before claiming completion',
    })
  } else {
    checks.push({
      name: 'Runtime completion evidence',
      status: 'ok',
      message: `${evidence.passed} passed evidence record(s)`,
    })
  }

  const productSmokeMode = policy.productSmokeGate ?? 'warn'
  if (level !== 'S' && productSmokeMode !== 'off') {
    const productSmokePassed = evidenceRecords.some(record => record.status === 'passed' && isProductSmokeEvidence(record))
    const productSmokeFailed = evidenceRecords.some(record => record.status === 'failed' && isProductSmokeEvidence(record))
    if (productSmokePassed) {
      checks.push({
        name: 'Runtime product smoke evidence',
        status: 'ok',
        message: 'Passed product smoke evidence recorded',
      })
    } else {
      checks.push({
        name: 'Runtime product smoke evidence',
        status: productSmokeMode === 'block' || productSmokeFailed ? 'fail' : 'warn',
        message: productSmokeFailed
          ? 'Product smoke evidence failed and no later passed product smoke evidence was recorded'
          : 'No passed product smoke evidence recorded for this M/L/CRITICAL task',
        fix: 'Run a real product-path smoke check and record it with metadata.productSmoke=true or metadata.realProductPath=true',
      })
    }
  }

  const blocked = checks.some(check => check.status === 'fail')
  return {
    ok: !blocked,
    blocked,
    checks,
    evidence,
  }
}

function isProductSmokeEvidence(record: { title: string; summary: string; metadata?: Record<string, unknown> }): boolean {
  const metadata = record.metadata ?? {}
  if (metadata.productSmoke === true || metadata.realProductPath === true) return true
  if (metadata.gate === 'G8' || metadata.gate === 'productSmoke') return true
  const text = `${record.title}\n${record.summary}`.toLowerCase()
  return text.includes('product smoke') || text.includes('real product path')
}

function checkDirectory(name: string, dir: string, fix: string): RuntimeDoctorCheck {
  if (!existsSync(dir)) {
    return { name, status: 'warn', message: `Missing ${dir}`, fix }
  }
  return { name, status: 'ok', message: `Found ${dir}` }
}

function checkSessionJsonl(sessionsDir: string, sessionId?: string): RuntimeDoctorCheck {
  if (!existsSync(sessionsDir)) {
    return { name: 'Runtime session JSONL', status: 'warn', message: 'No session JSONL directory yet' }
  }

  const files = sessionId
    ? [`${safePathSegment(sessionId)}.jsonl`].filter(file => existsSync(join(sessionsDir, file)))
    : readdirSync(sessionsDir).filter(file => file.endsWith('.jsonl'))

  for (const file of files) {
    const path = join(sessionsDir, file)
    const lines = readFileSync(path, 'utf-8').split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      try {
        JSON.parse(line)
      } catch {
        return {
          name: 'Runtime session JSONL',
          status: 'fail',
          message: `${file} contains invalid JSONL`,
          fix: 'Remove or repair the invalid session event line',
        }
      }
    }
  }

  return {
    name: 'Runtime session JSONL',
    status: 'ok',
    message: `${files.length} session file(s) parse cleanly`,
  }
}

function scopeLabel(options: RuntimeDoctorOptions): string {
  if (options.taskId && options.sessionId) return `${options.taskId}/${options.sessionId}`
  return options.taskId ?? options.sessionId ?? 'current scope'
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'unknown-session'
}
