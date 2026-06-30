import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentOsCortexPromotionPipeline } from '../../src/os/index.js'
import { safeRmSync } from '../helpers/fs.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) safeRmSync(dir)
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('AgentOsCortexPromotionPipeline', () => {
  it('promotes shadow rules only after maturity evidence and approval', () => {
    const projectDir = makeDir('scale-agent-os-cortex-promotion-')
    const scaleDir = join(projectDir, '.scale')
    const pipeline = new AgentOsCortexPromotionPipeline({ projectDir, scaleDir })

    const proposed = pipeline.propose({
      title: 'Require validation before completion',
      description: 'Completion claims must include command or review evidence.',
      source: 'failure-learning',
      sourceEvidenceIds: ['RTE-FAILED-VALIDATION'],
      pattern: 'complete without validation',
      enforcement: 'hook',
      rollback: 'Disable the hook and keep the prompt reminder.',
      taskId: 'TASK-CORTEX',
    })

    expect(proposed.proposal.maturity.stage).toBe('shadow')
    expect(proposed.report.summary.shadowRules).toBe(1)
    expect(existsSync(join(scaleDir, 'cortex', 'promotions.json'))).toBe(true)

    let current = proposed
    for (let index = 0; index < 10; index += 1) {
      current = pipeline.recordShadowHit({
        proposalId: proposed.proposal.id,
        evidenceId: `RTE-SHADOW-${index}`,
        taskId: 'TASK-CORTEX',
      })
    }

    expect(current.proposal.maturity.shadowHits).toBe(10)
    expect(current.report.validations[0]?.promotionDecision.eligible).toBe(true)

    const approved = pipeline.approve({
      proposalId: proposed.proposal.id,
      approvedBy: 'test-reviewer',
      taskId: 'TASK-CORTEX',
    })
    expect(approved.proposal.maturity).toEqual(expect.objectContaining({
      stage: 'approved-blocking',
      approvedBy: 'test-reviewer',
    }))
    expect(approved.report.summary.approvedBlocking).toBe(1)
    expect(pipeline.list()).toEqual([expect.objectContaining({ id: proposed.proposal.id })])

    const ledger = readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"cortex.promotion"')
    expect(ledger).toContain('"stage":"approved-blocking"')
  })
})
