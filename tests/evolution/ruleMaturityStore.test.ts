import { mkdirSync, mkdtempSync, rmSync, writeFileSync }
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
      evidenceId: 'SHADOW-EVIDENCE-1',
    })
    expect(updated.shadowHits).toBe(1)
    expect(new PersistentRuleMaturityStore({ projectDir: store.projectDir }).get('IMPROVE-100'))
      .toMatchObject({ stage: 'shadow', shadowHits: 1, evidenceIds: ['SHADOW-EVIDENCE-1'] })
  })

  it('requires unique evidence ids and prevents duplicate observations from inflating hit counts', () => {
    const store = createStore()
    store.create({
      ruleId: 'IMPROVE-101',
      rollback: 'Delete the shadow record.',
      defectEvidenceIds: ['FAILURE-101'],
    })
    store.recordHit({ ruleId: 'IMPROVE-101', evidenceId: 'SHADOW-EVIDENCE-1' })

    expect(() => store.recordHit({
      ruleId: 'IMPROVE-101',
      evidenceId: 'SHADOW-EVIDENCE-1',
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
        evidenceId: `SHADOW-EVIDENCE-${index}`,
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
