import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync }
import { join, resolve } from 'node:path'
import {
  createShadowRuleMaturity,
  evaluateRulePromotion,
  recordShadowHit,
  type RuleMaturityRecord,
  type RulePromotionDecision,
  type RulePromotionThresholds,
} from './RuleMaturity.js'

export interface PersistentRuleMaturityStoreOptions {
  projectDir?: string
  scaleDir?: string
}

function safeId(value: string): string {
  const id = value.trim()
  if (!id || id === '.' || id === '..' || !/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error('Invalid rule maturity id')
  }
  return id
}

function readRecord(path: string): RuleMaturityRecord | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RuleMaturityRecord
  } catch {
    throw new Error(`Invalid rule maturity record: ${path}`)
  }
}

/**
 * Persistent evidence ledger for non-blocking Shadow rules.
 * It records observations and eligibility only; it never writes hooks or policies.
 */
export class PersistentRuleMaturityStore {
  readonly projectDir: string
  readonly recordsDir: string

  constructor(options: PersistentRuleMaturityStoreOptions = {}) {
    this.projectDir = resolve(options.projectDir ?? process.cwd())
    const scaleDir = resolve(options.scaleDir ?? join(this.projectDir, '.scale'))
    this.recordsDir = join(scaleDir, 'evals', 'rule-maturity')
  }

  private recordPath(ruleId: string): string {
    return join(this.recordsDir, `${safeId(ruleId)}.json`)
  }

  get(ruleId: string): RuleMaturityRecord | null {
    return readRecord(this.recordPath(ruleId))
  }

  list(): RuleMaturityRecord[] {
    if (!existsSync(this.recordsDir)) return []
    return readdirSync(this.recordsDir)
      .filter(file => file.endsWith('.json'))
      .map(file => readRecord(join(this.recordsDir, file)))
      .filter((record): record is RuleMaturityRecord => Boolean(record))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  create(input: { ruleId: string; rollback: string; defectEvidenceIds: string[] }): RuleMaturityRecord {
    const ruleId = safeId(input.ruleId)
    if (!input.rollback.trim()) throw new Error('A rollback method is required')
    if (!input.defectEvidenceIds.length || input.defectEvidenceIds.some(id => !id.trim())) {
      throw new Error('At least one defect evidence id is required')
    }
    return this.withLock(ruleId, () => {
      mkdirSync(this.recordsDir, { recursive: true })
      const path = this.recordPath(ruleId)
      if (existsSync(path)) throw new Error(`Shadow maturity record already exists: ${ruleId}`)
      const record = createShadowRuleMaturity({
        ruleId,
        rollback: input.rollback.trim(),
        defectEvidenceIds: input.defectEvidenceIds,
      })
      this.write(record)
      return record
    })
  }

  recordHit(input: { ruleId: string; evidenceId: string; falsePositive?: boolean; now?: number }): RuleMaturityRecord {
    return this.withLock(input.ruleId, () => {
      const current = this.get(input.ruleId)
      if (!current) throw new Error(`Shadow maturity record not found: ${input.ruleId}`)
      const evidenceId = input.evidenceId.trim()
      if (!evidenceId) throw new Error('A unique shadow evidence id is required')
      if (current.evidenceIds.includes(evidenceId)) {
        throw new Error(`Shadow evidence already recorded: ${evidenceId}`)
      }
      const updated = recordShadowHit(current, {
        evidenceId,
        falsePositive: input.falsePositive,
        now: input.now,
      })
      this.write(updated)
      return updated
    })
  }

  evaluate(ruleId: string, thresholds: RulePromotionThresholds = {}): RulePromotionDecision {
    const record = this.get(ruleId)
    if (!record) throw new Error(`Shadow maturity record not found: ${ruleId}`)
    return evaluateRulePromotion(record, thresholds)
  }

  private withLock<T>(ruleId: string, operation: () => T): T {
    mkdirSync(this.recordsDir, { recursive: true })
    const lockPath = `${this.recordPath(ruleId)}.lock`
    let lockFd: number
    try {
      lockFd = openSync(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(`Shadow maturity record is being updated by another process: ${ruleId}`)
      }
      throw error
    }
    try {
      return operation()
    } finally {
      closeSync(lockFd)
      unlinkSync(lockPath)
    }
  }

  private write(record: RuleMaturityRecord): void {
    mkdirSync(this.recordsDir, { recursive: true })
    const path = this.recordPath(record.ruleId)
    const temporary = `${path}.${process.pid}.${record.updatedAt}.tmp`
    writeFileSync(temporary, JSON.stringify(record, null, 2), { encoding: 'utf-8', flag: 'wx' })
    renameSync(temporary, path)
  }
}
