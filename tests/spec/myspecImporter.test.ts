// MySpec importer — parsing, mapping, digest, and traceability against a
// synthetic but faithful MySpec bundle (4-file SDD export, EARS+ criteria).

import { describe, expect, it } from 'vitest'
import {
  buildSpecDigest,
  checkTraceability,
  mapToSpecPayload,
  parseInvariants,
  parseMySpecBundle,
  parseRequirements,
  parseTasks,
  slugifyBundleName,
  type MySpecBundleFiles,
} from '../../src/spec/MySpecImporter.js'

const BUNDLE: MySpecBundleFiles = {
  constitution: [
    '# Project Constitution',
    '',
    '## Invariants',
    '- [INV-01] Guest checkout MUST NEVER require account creation.',
    '- [INV-02] All payment operations MUST be idempotent.',
    '- Sessions expire after 30 minutes of inactivity.',
    '- [INV-03] PII leaves the boundary only through the audit sink.',
  ].join('\n'),
  requirements: [
    '# Requirements',
    '',
    '## FR-AUTH-001 — Guest checkout session',
    'As a guest shopper, I want to complete checkout without an account.',
    '',
    'Acceptance Criteria:',
    '- WHEN the guest confirms the order, THEN the checkout service SHALL create an anonymous session.',
    '- IF the session token is expired, THEN the checkout service SHALL restart the flow without data loss.',
    '',
    '## FR-PAY-002 — Idempotent payment retry',
    'As a returning payer, I want retried payments to never double-charge.',
    '',
    'Acceptance Criteria:',
    '- WHILE a payment intent is pending, THEN the payment service SHALL deduplicate by intent id.',
    '- WHEN the payer retries within 30 minutes, THEN the payment service SHALL return the original result.',
    '',
    '## Out of Scope',
    '- Loyalty points accrual',
  ].join('\n'),
  solution: [
    '# Solution',
    '```mermaid',
    'flowchart LR; A[Cart] --> B{Guest?}; B -->|yes| C[Anonymous session]',
    '```',
    'Session tokens are JWTs with 30-minute expiry; idempotency keys live in Redis.',
  ].join('\n'),
  tasks: [
    '# Tasks',
    '',
    '- [ ] Implement anonymous session issuance for FR-AUTH-001',
    '- [ ] Add expired-token restart path for FR-AUTH-001',
    '- [x] Redis idempotency key store for FR-PAY-002',
    '- [ ] Document the retry window decision (no requirement reference)',
    '- [ ] Cleanup scripts for FR-PAY-999 (does not exist)',
  ].join('\n'),
}

describe('parseInvariants', () => {
  it('extracts [INV-xx] lines and MUST bullets, ignoring plain ones', () => {
    const invariants = parseInvariants(BUNDLE.constitution)
    expect(invariants).toHaveLength(3)
    expect(invariants[0]).toContain('[INV-01]')
    expect(invariants[1]).toContain('[INV-02]')
  })
})

describe('parseRequirements', () => {
  it('groups EARS+ lines under requirement headings with ids', () => {
    const stories = parseRequirements(BUNDLE.requirements)
    expect(stories).toHaveLength(2)
    const auth = stories.find(s => s.title.includes('FR-AUTH-001'))!
    expect(auth.criteria).toHaveLength(2)
    expect(auth.criteria[0].id).toBe('FR-AUTH-001')
    expect(auth.criteria[0].kind).toBe('event')       // WHEN … SHALL
    expect(auth.criteria[1].kind).toBe('error')        // IF … THEN … SHALL
  })
})

describe('parseTasks', () => {
  it('parses checkboxes, done state, and FR references', () => {
    const tasks = parseTasks(BUNDLE.tasks)
    expect(tasks).toHaveLength(5)
    expect(tasks[2].done).toBe(true)
    expect(tasks[0].requirementRefs).toEqual(['FR-AUTH-001'])
    expect(tasks[3].requirementRefs).toEqual([])
    expect(tasks[4].requirementRefs).toEqual(['FR-PAY-999'])
  })
})

describe('mapToSpecPayload', () => {
  it('maps criteria → successCriteria, invariants → constraints, error criteria → edgeCases', () => {
    const parsed = parseMySpecBundle(BUNDLE)
    const payload = mapToSpecPayload(parsed)
    expect(payload.successCriteria).toHaveLength(4)
    expect(payload.successCriteria[0]).toContain('FR-AUTH-001:')
    expect(payload.constraints).toHaveLength(3)
    expect(payload.edgeCases).toHaveLength(1)
    expect(payload.verificationSurface).toHaveLength(4)
    expect(payload.ambiguityScore!).toBeLessThanOrEqual(0.2)
  })
})

describe('buildSpecDigest', () => {
  it('produces SCALE spec markdown the session injector can pick up', () => {
    const parsed = parseMySpecBundle(BUNDLE)
    const digest = buildSpecDigest('Checkout Flow', parsed)
    expect(digest).toContain('# Spec: Checkout Flow (MySpec import)')
    expect(digest).toContain('## Success Criteria')
    expect(digest).toContain('- [ ] FR-AUTH-001: WHEN the guest confirms the order')
    expect(digest).toContain('## Constraints')
    expect(digest).toContain('scale spec import-myspec')
  })

  it('slugifies bundle names for filesystem safety', () => {
    expect(slugifyBundleName('Checkout Flow! v2')).toBe('checkout-flow-v2')
    expect(slugifyBundleName('')).toBe('myspec-import')
  })
})

describe('checkTraceability (the conformance gate core)', () => {
  it('flags untraced criteria, phantom refs, and open tasks', () => {
    const parsed = parseMySpecBundle(BUNDLE)
    const report = checkTraceability(parsed)
    expect(report.criteriaCount).toBe(4)
    expect(report.taskCount).toBe(5)
    // FR-PAY-002 has a task (done) → traced; the WHILE/WHEN pair both map to FR-PAY-002
    expect(report.untracedCriteria).toEqual([])
    expect(report.phantomRefs).toEqual([{ task: 'Cleanup scripts for FR-PAY-999 (does not exist)', ref: 'FR-PAY-999' }])
    expect(report.openTasks).toHaveLength(4)
    expect(report.ok).toBe(false) // phantom refs break traceability
  })

  it('fully traced bundle passes', () => {
    const files: MySpecBundleFiles = {
      ...BUNDLE,
      tasks: [
        '# Tasks',
        '',
        '- [x] Cover FR-AUTH-001',
        '- [x] Cover FR-PAY-002',
      ].join('\n'),
    }
    const report = checkTraceability(parseMySpecBundle(files))
    expect(report.ok).toBe(true)
    expect(report.untracedCriteria).toEqual([])
    expect(report.phantomRefs).toEqual([])
    expect(report.openTasks).toEqual([])
  })
})
