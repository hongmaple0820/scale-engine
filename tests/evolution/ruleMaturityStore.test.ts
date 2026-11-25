import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersistentRuleMaturityStore } from '../../src/evolution/RuleMaturityStore.js'

describe('PersistentRuleMaturityStore', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function createStore() {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-rule-maturity-'))
    roots.push(projectDir)
    return new PersistentRuleMaturityStore({ projectDir })
  }

  it('persists non-blocking shadow records and evidence across store instances', () => {
    const store = createStore()
    const created = store.create({
      ruleId: 'IMPROVE-100',
      rollback: 'Remove the shadow rule record; no hook has been installed.',
      defectEvidenceIds: ['FAILURE-100'],
    })

    expect(created.stage).toBe('shadow')
    expect(created.shadowHits).toBe(0)

    const updated = store.recordHit({
      ruleId: 'IMPROVE-100',
      evidenceId: `sha256:${'1'.repeat(64)}`,
    })
    expect(updated.shadowHits).toBe(1)
    expect(new PersistentRuleMaturityStore({ projectDir: store.projectDir }).get('IMPROVE-100'))
      .toMatchObject({ stage: 'shadow', shadowHits: 1, evidenceIds: [`sha256:${'1'.repeat(64)}`] })
  })

  it('persists evidence artifact provenance and rejects unsafe manifest paths', () => {
    const store = createStore()
    store.create({
      ruleId: 'IMPROVE-PROVENANCE',
      rollback: 'Remove the shadow record.',
      defectEvidenceIds: ['FAILURE-PROVENANCE'],
    })
    const artifactPath = join(store.projectDir, 'artifacts', 'shadow', 'run-1.json')
    mkdirSync(join(store.projectDir, 'artifacts', 'shadow'), { recursive: true })
    const artifactContent = JSON.stringify({ observation: 'verified shadow result' })
    writeFileSync(artifactPath, artifactContent, 'utf-8')
    const evidenceId = `sha256:${createHash('sha256').update(artifactContent).digest('hex')}`
    const recorded = store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId,
      evidenceArtifact: { path: 'artifacts/shadow/run-1.json', sizeBytes: Buffer.byteLength(artifactContent) },
      now: 1_800_000_000_000,
    })

    expect(recorded.evidenceManifestVersion).toBe(1)
    expect(recorded.evidenceArtifacts).toEqual([{
      evidenceId,
      path: 'artifacts/shadow/run-1.json',
      sizeBytes: Buffer.byteLength(artifactContent),
      recordedAt: 1_800_000_000_000,
      falsePositive: false,
    }])
    expect(new PersistentRuleMaturityStore({ projectDir: store.projectDir }).get('IMPROVE-PROVENANCE'))
      .toMatchObject({ shadowHits: 1, evidenceArtifacts: recorded.evidenceArtifacts })

    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'a'.repeat(64)}`,
      evidenceArtifact: { path: 'artifacts/shadow/run-1.json', sizeBytes: Buffer.byteLength(artifactContent) },
    })).toThrow('digest does not match its evidence id')
    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'a'.repeat(64)}`,
      evidenceArtifact: { path: 'artifacts/shadow/run-1.json', sizeBytes: Buffer.byteLength(artifactContent) + 1 },
    })).toThrow('size does not match its metadata')
    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'a'.repeat(64)}`,
      evidenceArtifact: { path: 'artifacts/shadow/missing.json', sizeBytes: 1 },
    })).toThrow('Shadow evidence artifact verification failed')
    expect(store.get('IMPROVE-PROVENANCE')?.shadowHits).toBe(1)

    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'b'.repeat(64)}`,
      evidenceArtifact: { path: '../outside.json', sizeBytes: 1 },
    })).toThrow('safe project-relative path')
    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'e'.repeat(64)}`,
      evidenceArtifact: { path: 'C:/outside.json', sizeBytes: 1 },
    })).toThrow('safe project-relative path')
    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'f'.repeat(64)}`,
      evidenceArtifact: { path: 'artifacts\\..\\outside.json', sizeBytes: 1 },
    })).toThrow('safe project-relative path')

    expect(() => store.recordHit({
      ruleId: 'IMPROVE-PROVENANCE',
      evidenceId: `sha256:${'9'.repeat(64)}`,
      evidenceArtifact: { path: '/outside.json', sizeBytes: 1 },
    })).toThrow('safe project-relative path')
  })

  it('fails closed when a recorded evidence artifact is tampered with or missing', () => {
    const store = createStore()
    store.create({
      ruleId: 'IMPROVE-INTEGRITY',
      rollback: 'Remove the shadow record.',
      defectEvidenceIds: ['FAILURE-INTEGRITY'],
    })
    const artifactPath = join(store.projectDir, 'artifacts', 'shadow', 'integrity.json')
    mkdirSync(join(store.projectDir, 'artifacts', 'shadow'), { recursive: true })
    const original = 'original evidence payload'
    writeFileSync(artifactPath, original, 'utf-8')
    const evidenceId = `sha256:${createHash('sha256').update(original).digest('hex')}`
    store.recordHit({
      ruleId: 'IMPROVE-INTEGRITY',
      evidenceId,
      evidenceArtifact: { path: 'artifacts/shadow/integrity.json', sizeBytes: Buffer.byteLength(original) },
    })

    writeFileSync(artifactPath, 'tampered evidence payload', 'utf-8')
    expect(() => store.get('IMPROVE-INTEGRITY')).toThrow('digest does not match its manifest')
    expect(() => store.evaluate('IMPROVE-INTEGRITY')).toThrow('digest does not match its manifest')

    rmSync(artifactPath, { force: true })
    expect(() => store.list()).toThrow('Unverified rule maturity evidence artifact')
  })

  it('keeps legacy records readable but refuses to silently create an incomplete provenance manifest', () => {
    const store = createStore()
    const created = store.create({
      ruleId: 'IMPROVE-LEGACY',
      rollback: 'Remove the shadow record.',
      defectEvidenceIds: ['FAILURE-LEGACY'],
    })
    const legacyEvidenceId = `sha256:${'c'.repeat(64)}`
    const legacy = {
      ...created,
      shadowHits: 1,
      evidenceIds: [legacyEvidenceId],
    }
    writeFileSync(join(store.recordsDir, 'IMPROVE-LEGACY.json'), JSON.stringify(legacy), 'utf-8')

    expect(store.get('IMPROVE-LEGACY')).toMatchObject({ shadowHits: 1, evidenceIds: [legacyEvidenceId] })
    expect(() => store.recordHit({
      ruleId: 'IMPROVE-LEGACY',
      evidenceId: `sha256:${'d'.repeat(64)}`,
      evidenceArtifact: { path: 'artifacts/new.json', sizeBytes: 10 },
    })).toThrow('Legacy Shadow record')
  })

  it('requires unique evidence ids and prevents duplicate observations from inflating hit counts', () => {
    const store = createStore()
    store.create({
      ruleId: 'IMPROVE-101',
      rollback: 'Delete the shadow record.',
      defectEvidenceIds: ['FAILURE-101'],
    })
    store.recordHit({ ruleId: 'IMPROVE-101', evidenceId: `sha256:${'1'.repeat(64)}` })

    expect(() => store.recordHit({
      ruleId: 'IMPROVE-101',
      evidenceId: `sha256:${'1'.repeat(64)}`,
    })).toThrow('already recorded')
    expect(store.get('IMPROVE-101')?.shadowHits).toBe(1)
  })

  it('evaluates promotion thresholds but never promotes the persisted stage', () => {
    const store = createStore()
    store.create({
      ruleId: 'IMPROVE-102',
      rollback: 'Remove the shadow record.',
      defectEvidenceIds: ['FAILURE-102'],
    })
    for (let index = 0; index < 10; index++) {
      store.recordHit({
        ruleId: 'IMPROVE-102',
        evidenceId: `sha256:${String(index).padStart(64, '0')}`,
        falsePositive: index < 2,
      })
    }

    expect(store.evaluate('IMPROVE-102')).toMatchObject({
      eligible: true,
      nextStage: 'candidate-hook',
      blockers: [],
    })
    expect(store.get('IMPROVE-102')?.stage).toBe('shadow')
  })

  it('fails closed when another process holds the maturity record lock', () => {
    const store = createStore()
    mkdirSync(store.recordsDir, { recursive: true })
    writeFileSync(join(store.recordsDir, 'IMPROVE-105.json.lock'), 'locked', 'utf-8')

    expect(() => store.create({
      ruleId: 'IMPROVE-105',
      rollback: 'Remove the shadow record.',
      defectEvidenceIds: ['FAILURE-105'],
    })).toThrow('being updated by another process')
  })

  it('rejects caller-supplied evidence ids that are not SHA-256 content digests', () => {
    const store = createStore()
    store.create({
      ruleId: 'IMPROVE-106',
      rollback: 'Remove the shadow record.',
      defectEvidenceIds: ['FAILURE-106'],
    })

    expect(() => store.recordHit({
      ruleId: 'IMPROVE-106',
      evidenceId: 'made-up-evidence-id',
    })).toThrow('must be a SHA-256 digest')
    expect(store.get('IMPROVE-106')?.shadowHits).toBe(0)
  })

  it('rejects records without rollback and defect evidence', () => {
    const store = createStore()
    expect(() => store.create({
      ruleId: 'IMPROVE-103',
      rollback: ' ',
      defectEvidenceIds: ['FAILURE-103'],
    })).toThrow('rollback')
    expect(() => store.create({
      ruleId: 'IMPROVE-104',
      rollback: 'Remove it.',
      defectEvidenceIds: [],
    })).toThrow('defect evidence')
  })
})
