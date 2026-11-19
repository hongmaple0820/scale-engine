import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, posix, resolve, sep } from 'node:path'
import {
  createShadowRuleMaturity,
  evaluateRulePromotion,
  recordShadowHit,
  type RuleMaturityRecord,
  type ShadowEvidenceArtifact,
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

function validateRecord(record: RuleMaturityRecord, path: string): RuleMaturityRecord {
  if (!Array.isArray(record.evidenceIds) || !Number.isInteger(record.shadowHits) || record.shadowHits < 0) {
    throw new Error(`Invalid rule maturity record: ${path}`)
  }
  const artifacts = record.evidenceArtifacts
  // Legacy records intentionally remain readable without provenance metadata.
  if (artifacts === undefined) return record
  if (!Array.isArray(artifacts) || artifacts.length !== record.shadowHits) {
    throw new Error(`Invalid rule maturity evidence manifest: ${path}`)
  }
  const ids = new Set<string>()
  for (const artifact of artifacts) {
    if (!artifact || !/^sha256:[a-f0-9]{64}$/.test(artifact.evidenceId)
      || !record.evidenceIds.includes(artifact.evidenceId) || ids.has(artifact.evidenceId)
      || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0
      || !Number.isFinite(artifact.recordedAt) || typeof artifact.falsePositive !== 'boolean'
      || typeof artifact.path !== 'string' || !artifact.path || isAbsolute(artifact.path)
      || posix.normalize(artifact.path) !== artifact.path
      || artifact.path === '..' || artifact.path.startsWith('../')) {
      throw new Error(`Invalid rule maturity evidence manifest: ${path}`)
    }
    ids.add(artifact.evidenceId)
  }
  if (ids.size !== record.evidenceIds.length) {
    throw new Error(`Invalid rule maturity evidence manifest: ${path}`)
  }
  return record
}

function readRecord(path: string): RuleMaturityRecord | null {
  if (!existsSync(path)) return null
  try {
    return validateRecord(JSON.parse(readFileSync(path, 'utf-8')) as RuleMaturityRecord, path)
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

  recordHit(input: { ruleId: string; evidenceId: string; evidenceArtifact?: Omit<ShadowEvidenceArtifact, 'evidenceId' | 'recordedAt' | 'falsePositive'>; falsePositive?: boolean; now?: number }): RuleMaturityRecord {
    return this.withLock(input.ruleId, () => {
      const current = this.get(input.ruleId)
      if (!current) throw new Error(`Shadow maturity record not found: ${input.ruleId}`)
      const evidenceId = input.evidenceId.trim()
      if (!/^sha256:[a-f0-9]{64}$/.test(evidenceId)) {
        throw new Error('Shadow evidence id must be a SHA-256 digest in the form sha256:<64 lowercase hex characters>')
      }
      if (current.evidenceIds.includes(evidenceId)) {
        throw new Error(`Shadow evidence already recorded: ${evidenceId}`)
      }
      const now = input.now ?? Date.now()
      if (input.evidenceArtifact && current.shadowHits > 0 && current.evidenceArtifacts === undefined) {
        throw new Error('Legacy Shadow record has observations without artifact provenance; start a new record to enable a complete evidence manifest')
      }
      let evidenceArtifact: ShadowEvidenceArtifact | undefined
      if (input.evidenceArtifact) {
        const artifactPath = input.evidenceArtifact.path.split(sep).join('/')
        if (!artifactPath || isAbsolute(artifactPath) || posix.normalize(artifactPath) !== artifactPath
          || artifactPath === '..' || artifactPath.startsWith('../')
          || !Number.isSafeInteger(input.evidenceArtifact.sizeBytes) || input.evidenceArtifact.sizeBytes < 0) {
          throw new Error('Shadow evidence artifact must have a safe project-relative path and valid byte size')
        }
        evidenceArtifact = {
          ...input.evidenceArtifact,
          path: artifactPath,
          evidenceId,
          recordedAt: now,
          falsePositive: Boolean(input.falsePositive),
        }
      } else if (current.evidenceArtifacts !== undefined) {
        throw new Error('Shadow evidence artifact metadata is required once provenance tracking is enabled')
      }
      const updated = recordShadowHit(current, {
        evidenceId,
        evidenceArtifact,
        falsePositive: input.falsePositive,
        now,
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
