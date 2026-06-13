// SCALE Cortex — Instinct Store
// 对齐 ECC: hierarchical filesystem-based storage under .scale/instincts/
// Future: SQLite-backed in Cortex v2

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../core/logger.js'
import type { Instinct } from './InstinctExtractor.js'
import {
  deriveScopedInstinctId,
  normalizeInstinctTrigger,
  validateInstinct,
} from './InstinctValidation.js'

export type InstinctAuditOperation = 'save' | 'replace' | 'delete' | 'apply' | 'reject' | 'restore'

export interface InstinctAuditEntry {
  auditId: string
  ts: string
  op: InstinctAuditOperation
  id: string
  scope?: Instinct['scope']
  projectId?: string
  before?: Instinct
  after?: Instinct
  reason?: string
  reasons?: string[]
}

export interface InstinctStoreOptions {
  createDirs?: boolean
}

export interface InjectionInstinctOptions {
  minConfidence?: number
  allowModerateFallback?: boolean
  fallbackMinConfidence?: number
  fallbackMinObservations?: number
  fallbackLimit?: number
}

// ---------------------------------------------------------------------------
// InstinctStore
// ---------------------------------------------------------------------------

export class InstinctStore {
  private baseDir: string

  constructor(baseDir: string = join(process.cwd(), '.scale', 'instincts'), options: InstinctStoreOptions = {}) {
    this.baseDir = baseDir
    if (options.createDirs !== false && !existsSync(baseDir)) mkdirSync(baseDir, { recursive: true })
  }

  /**
   * Save an instinct to disk.
   * Deduplication: within the same scope/project/trigger, only keep the higher-confidence one.
   */
  save(instinct: Instinct): string {
    const candidate = this.normalizeForSave(instinct)
    const validation = validateInstinct(candidate)
    if (!validation.ok) {
      logger.warn({ id: candidate.id, reasons: validation.reasons }, 'Rejected invalid instinct')
      this.appendAudit({
        op: 'reject',
        id: candidate.id || 'unknown',
        scope: candidate.scope,
        projectId: candidate.projectId,
        after: cloneInstinct(candidate),
        reason: 'validation-failed',
        reasons: validation.reasons,
      })
      return ''
    }

    candidate.id = deriveScopedInstinctId(candidate.trigger, candidate.scope, candidate.projectId)

    const existing = this.findByKey(candidate.trigger, candidate.scope, candidate.projectId)
    if (existing && existing.confidence >= candidate.confidence) {
      // Keep existing. Increment observation count.
      const before = cloneInstinct(existing)
      const after = {
        ...existing,
        observations: existing.observations + candidate.observations,
        updatedAt: new Date().toISOString(),
      }
      this.writeInstinctFile(after)
      this.appendAudit({
        op: 'save',
        id: after.id,
        scope: after.scope,
        projectId: after.projectId,
        before,
        after: cloneInstinct(after),
        reason: 'dedup-merge-lower-confidence',
      })
      return after.id
    }

    // New or higher-confidence instinct replaces existing
    if (existing) {
      const before = cloneInstinct(existing)
      this.removeInstinctFile(existing.id)
      candidate.updatedAt = new Date().toISOString()
      this.writeInstinctFile(candidate)
      this.appendAudit({
        op: 'replace',
        id: candidate.id,
        scope: candidate.scope,
        projectId: candidate.projectId,
        before,
        after: cloneInstinct(candidate),
        reason: 'higher-confidence-replacement',
      })
      return candidate.id
    }

    candidate.updatedAt = new Date().toISOString()
    this.writeInstinctFile(candidate)
    this.appendAudit({
      op: 'save',
      id: candidate.id,
      scope: candidate.scope,
      projectId: candidate.projectId,
      after: cloneInstinct(candidate),
      reason: 'new-instinct',
    })
    return candidate.id
  }

  /**
   * Load all instincts from disk.
   */
  loadAll(): Instinct[] {
    const instincts: Instinct[] = []
    if (!existsSync(this.baseDir)) return instincts

    try {
      for (const domain of readdirSync(this.baseDir)) {
        const domainDir = join(this.baseDir, domain)
        if (!domain.endsWith('.yaml') && existsSync(domainDir) && !domain.startsWith('.')) {
          // Directory-based domain
          try {
            for (const file of readdirSync(domainDir)) {
              if (!file.endsWith('.yaml')) continue
              const instinct = this.parseInstinctFile(join(domainDir, file))
              if (instinct) instincts.push(instinct)
            }
          } catch (err) {
            logger.warn({ err, domain }, 'Skipped unreadable instinct domain')
          }
        } else if (domain.endsWith('.yaml')) {
          // Flat file in root
          const instinct = this.parseInstinctFile(join(this.baseDir, domain))
          if (instinct) instincts.push(instinct)
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load instincts')
    }

    return instincts.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Get instincts filtered by confidence threshold and scope.
   */
  query(options: {
    minConfidence?: number
    domain?: string
    scope?: 'project' | 'global'
    projectId?: string
  }): Instinct[] {
    let instincts = this.loadAll()

    if (options.minConfidence) {
      instincts = instincts.filter(i => i.confidence >= options.minConfidence!)
    }
    if (options.domain) {
      instincts = instincts.filter(i => i.domain === options.domain)
    }
    if (options.scope) {
      instincts = instincts.filter(i => i.scope === options.scope)
    }
    if (options.projectId) {
      instincts = instincts.filter(i => !i.projectId || i.projectId === options.projectId)
    }

    return instincts
  }

  /**
   * Get instincts for SessionStart injection.
   *
   * Default callers only receive strong instincts (0.7+). SessionStart may opt
   * into a conservative reviewed-moderate fallback when no strong instinct is
   * available, so runtime learning can still be measured without injecting
   * tentative or under-observed patterns.
   */
  getInjectionInstincts(projectId?: string, options: InjectionInstinctOptions = {}): Instinct[] {
    const minConfidence = options.minConfidence ?? 0.7
    const scopedProject = projectId?.trim()
    const inScope = (instinct: Instinct) =>
      instinct.scope === 'global' ||
      !instinct.projectId ||
      Boolean(scopedProject && instinct.projectId === scopedProject)

    const strong = this.query({ minConfidence }).filter(inScope)
    if (strong.length > 0 || !options.allowModerateFallback) return strong

    const fallbackMinConfidence = options.fallbackMinConfidence ?? 0.5
    const fallbackMinObservations = options.fallbackMinObservations ?? 3
    const fallbackLimit = options.fallbackLimit ?? 3
    return this.query({ minConfidence: fallbackMinConfidence })
      .filter(inScope)
      .filter(instinct =>
        instinct.confidence < minConfidence &&
        instinct.observations >= fallbackMinObservations,
      )
      .slice(0, fallbackLimit)
  }

  /**
   * Find an instinct by trigger pattern.
   */
  findByTrigger(trigger: string): Instinct | null {
    return this.findByKey(trigger)
  }

  /**
   * Find an instinct by trigger pattern within an optional scope/project key.
   */
  findByKey(trigger: string, scope?: Instinct['scope'], projectId?: string): Instinct | null {
    const normalizedTrigger = normalizeInstinctTrigger(trigger)
    const normalizedProjectId = projectId?.trim() || undefined
    if (!normalizedTrigger) return null

    if (scope) {
      const scoped = this.findById(deriveScopedInstinctId(normalizedTrigger, scope, normalizedProjectId))
      if (scoped) return scoped
    }

    return this.loadAll().find(instinct => {
      if (normalizeInstinctTrigger(instinct.trigger) !== normalizedTrigger) return false
      if (scope && instinct.scope !== scope) return false
      if (normalizedProjectId !== undefined) return (instinct.projectId ?? '') === normalizedProjectId
      if (scope === 'project') return !instinct.projectId
      return true
    }) ?? null
  }

  /**
   * Find an instinct by ID.
   */
  findById(id: string): Instinct | null {
    const filePath = this.locateInstinctFile(id)
    return filePath ? this.parseInstinctFile(filePath) : null
  }

  /**
   * Delete an instinct by ID.
   */
  delete(id: string): boolean {
    const instinct = this.findById(id)
    if (!instinct) return false

    const before = cloneInstinct(instinct)
    try {
      const removed = this.removeInstinctFile(id)
      if (!removed) return false
      this.appendAudit({
        op: 'delete',
        id,
        scope: before.scope,
        projectId: before.projectId,
        before,
        reason: 'delete',
      })
      return true
    } catch (err) {
      logger.warn({ err, id }, 'Failed to delete instinct')
      return false
    }
  }

  /**
   * Record an instinct was applied (for hit rate tracking).
   */
  recordApplication(id: string, success: boolean): void {
    const instinct = this.findById(id)
    if (!instinct) return

    const before = cloneInstinct(instinct)
    instinct.appliedCount++
    instinct.hitRate = instinct.observations > 0
      ? instinct.appliedCount / instinct.observations
      : 0
    instinct.updatedAt = new Date().toISOString()

    this.writeInstinctFile(instinct)
    this.appendAudit({
      op: 'apply',
      id,
      scope: instinct.scope,
      projectId: instinct.projectId,
      before,
      after: cloneInstinct(instinct),
      reason: success ? 'application-succeeded' : 'application-failed',
    })
  }

  /**
   * Read append-only instinct audit history, optionally filtered by instinct id.
   */
  history(id?: string): InstinctAuditEntry[] {
    const auditPath = this.auditPath()
    if (!existsSync(auditPath)) return []
    try {
      return readFileSync(auditPath, 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          try { return JSON.parse(line) as InstinctAuditEntry } catch { return null }
        })
        .filter((entry): entry is InstinctAuditEntry => Boolean(entry))
        .filter(entry => !id || entry.id === id)
    } catch (err) {
      logger.warn({ err }, 'Failed to read instinct audit history')
      return []
    }
  }

  /**
   * Restore the store to the `before` snapshot of an audit entry. If an initial
   * save had no `before`, restore undoes that save by deleting the created item.
   */
  restore(auditId: string): boolean {
    const entry = this.history().find(item => item.auditId === auditId)
    if (!entry) return false

    const current = entry.id ? this.findById(entry.id) : null
    if (entry.before) {
      this.writeInstinctFile(entry.before)
      this.appendAudit({
        op: 'restore',
        id: entry.before.id,
        scope: entry.before.scope,
        projectId: entry.before.projectId,
        before: current ? cloneInstinct(current) : undefined,
        after: cloneInstinct(entry.before),
        reason: `restore:${entry.auditId}`,
      })
      return true
    }

    if (entry.after) {
      const before = this.findById(entry.after.id)
      const removed = this.removeInstinctFile(entry.after.id)
      this.appendAudit({
        op: 'restore',
        id: entry.after.id,
        scope: entry.after.scope,
        projectId: entry.after.projectId,
        before: before ? cloneInstinct(before) : undefined,
        reason: `restore:${entry.auditId}`,
      })
      return removed
    }

    return false
  }

  /**
   * Get store statistics.
   */
  stats(): { total: number; byDomain: Record<string, number>; byConfidence: Record<string, number> } {
    const all = this.loadAll()
    const byDomain: Record<string, number> = {}
    const byConfidence: Record<string, number> = {
      'near-certain (0.9)': 0,
      'strong (0.7)': 0,
      'moderate (0.5)': 0,
      'tentative (0.3)': 0,
    }

    for (const i of all) {
      byDomain[i.domain] = (byDomain[i.domain] ?? 0) + 1
      if (i.confidence >= 0.9) byConfidence['near-certain (0.9)']++
      else if (i.confidence >= 0.7) byConfidence['strong (0.7)']++
      else if (i.confidence >= 0.5) byConfidence['moderate (0.5)']++
      else byConfidence['tentative (0.3)']++
    }

    return { total: all.length, byDomain, byConfidence }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private normalizeForSave(instinct: Instinct): Instinct {
    return {
      ...instinct,
      trigger: normalizeInstinctTrigger(instinct.trigger ?? ''),
      action: (instinct.action ?? '').trim(),
      projectId: instinct.projectId?.trim() || undefined,
      scope: instinct.scope ?? 'project',
    }
  }

  private writeInstinctFile(instinct: Instinct): void {
    const domainDir = join(this.baseDir, instinct.domain)
    if (!existsSync(domainDir)) mkdirSync(domainDir, { recursive: true })

    const filePath = join(domainDir, `${instinct.id}.yaml`)
    const yaml = this.serializeInstinct(instinct)
    writeFileSync(filePath, yaml, 'utf-8')
  }

  private locateInstinctFile(id: string): string | null {
    if (!existsSync(this.baseDir)) return null

    try {
      for (const entry of readdirSync(this.baseDir)) {
        const full = join(this.baseDir, entry)
        if (existsSync(full) && !entry.startsWith('.') && !entry.endsWith('.yaml')) {
          const filePath = join(full, `${id}.yaml`)
          if (existsSync(filePath)) return filePath
        }
      }
    } catch (err) {
      logger.warn({ err, id }, 'Failed to locate instinct file')
    }

    const flatPath = join(this.baseDir, `${id}.yaml`)
    return existsSync(flatPath) ? flatPath : null
  }

  private removeInstinctFile(id: string): boolean {
    const filePath = this.locateInstinctFile(id)
    if (!filePath) return false
    unlinkSync(filePath)
    return true
  }

  private auditPath(): string {
    return join(this.baseDir, '.audit.jsonl')
  }

  private appendAudit(input: Omit<InstinctAuditEntry, 'auditId' | 'ts'>): InstinctAuditEntry {
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true })
    const entry: InstinctAuditEntry = {
      auditId: `audit-${Date.now()}-${randomUUID().slice(0, 8)}`,
      ts: new Date().toISOString(),
      ...input,
    }
    writeFileSync(this.auditPath(), `${JSON.stringify(entry)}\n`, { encoding: 'utf-8', flag: 'a' })
    return entry
  }

  private serializeInstinct(instinct: Instinct): string {
    const frontmatter = [
      `id: ${instinct.id}`,
      `trigger: "${instinct.trigger.replace(/"/g, '\\"')}"`,
      `confidence: ${instinct.confidence}`,
      `domain: ${instinct.domain}`,
      `source: "${instinct.source}"`,
      `scope: ${instinct.scope}`,
      `project_id: ${instinct.projectId ?? ''}`,
      `observations: ${instinct.observations}`,
      `applied_count: ${instinct.appliedCount}`,
      `hit_rate: ${instinct.hitRate.toFixed(2)}`,
      `created_at: ${instinct.createdAt}`,
      `updated_at: ${instinct.updatedAt}`,
    ].join('\n')

    const evidence = instinct.evidence.map(e => `  - "${e}"`).join('\n')

    return [
      '---',
      frontmatter,
      '---',
      '',
      instinct.action,
      '',
      '## Evidence',
      evidence,
      '',
    ].join('\n')
  }

  private parseInstinctFile(filePath: string): Instinct | null {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (!fmMatch) return null

      const frontmatter = fmMatch[1]
      const body = fmMatch[2] ?? ''

      const getYamlVal = (key: string): string => {
        const m = frontmatter.match(new RegExp(`^${key}:[^\\S\\r\\n]*([^\\r\\n]*)$`, 'm'))
        return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : ''
      }

      return {
        id: getYamlVal('id'),
        trigger: getYamlVal('trigger'),
        confidence: parseFloat(getYamlVal('confidence')) || 0.3,
        domain: getYamlVal('domain') || 'general',
        source: getYamlVal('source'),
        scope: (getYamlVal('scope') as 'project' | 'global') || 'project',
        projectId: getYamlVal('project_id') || undefined,
        action: body.trim(),
        evidence: [],
        observations: parseInt(getYamlVal('observations'), 10) || 0,
        createdAt: getYamlVal('created_at') || new Date().toISOString(),
        updatedAt: getYamlVal('updated_at') || new Date().toISOString(),
        appliedCount: parseInt(getYamlVal('applied_count'), 10) || 0,
        hitRate: parseFloat(getYamlVal('hit_rate')) || 0,
      }
    } catch (err) {
      logger.warn({ err, path: filePath }, 'Failed to parse instinct file')
      return null
    }
  }
}

function cloneInstinct(instinct: Instinct): Instinct {
  return {
    ...instinct,
    evidence: [...instinct.evidence],
  }
}
