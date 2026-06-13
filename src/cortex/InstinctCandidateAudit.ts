import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Instinct } from './InstinctExtractor.js'
import type { InstinctAuditEntry } from './InstinctStore.js'
import { deriveScopedInstinctId, normalizeInstinctTrigger } from './InstinctValidation.js'

export function recordCandidateRejection(
  instinctsDir: string,
  instinct: Instinct,
  reason: string,
  reasons: string[],
): InstinctAuditEntry {
  if (!existsSync(instinctsDir)) mkdirSync(instinctsDir, { recursive: true })

  const candidate = normalizeCandidate(instinct)
  const entry: InstinctAuditEntry = {
    auditId: `audit-${Date.now()}-${randomUUID().slice(0, 8)}`,
    ts: new Date().toISOString(),
    op: 'reject',
    id: candidate.id,
    scope: candidate.scope,
    projectId: candidate.projectId,
    after: candidate,
    reason,
    reasons,
  }

  writeFileSync(join(instinctsDir, '.audit.jsonl'), `${JSON.stringify(entry)}\n`, {
    encoding: 'utf-8',
    flag: 'a',
  })
  return entry
}

function normalizeCandidate(instinct: Instinct): Instinct {
  const trigger = normalizeInstinctTrigger(instinct.trigger ?? '')
  const scope = instinct.scope ?? 'project'
  const projectId = instinct.projectId?.trim() || undefined
  return {
    ...instinct,
    id: deriveScopedInstinctId(trigger, scope, projectId),
    trigger,
    action: (instinct.action ?? '').trim(),
    scope,
    projectId,
  }
}
