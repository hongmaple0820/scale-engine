import { describe, expect, it } from 'vitest'
import { planIssues } from '../../src/integrations/GitHubIssuePlanner.js'

describe('planIssues (P3-D)', () => {
  it('produces one dry-run issue draft per task', () => {
    const plan = planIssues([
      { id: 'TASK-1', title: 'Add login', level: 'M' },
      { id: 'TASK-2', title: 'Harden OAuth', level: 'CRITICAL', filesInvolved: ['src/auth/oauth.ts'] },
    ])
    expect(plan.dryRun).toBe(true)
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues[0].title).toBe('[TASK-1] Add login')
    expect(plan.issues[0].labels).toContain('scale:level-m')
    expect(plan.issues[1].labels).toContain('scale:level-critical')
  })

  it('includes verification guidance in the body', () => {
    const plan = planIssues([{ id: 'T-1', title: 'x', level: 'L' }])
    expect(plan.issues[0].body).toContain('scale verify-task --effort')
    expect(plan.issues[0].body).toContain('scale review --isolated --fresh-gate block')
  })

  it('lists files involved when provided', () => {
    const plan = planIssues([{ id: 'T-2', title: 'y', filesInvolved: ['src/a.ts', 'src/b.ts'] }])
    expect(plan.issues[0].body).toContain('src/a.ts')
    expect(plan.issues[0].body).toContain('src/b.ts')
  })

  it('truncates very long titles', () => {
    const plan = planIssues([{ id: 'T-3', title: 'x'.repeat(400) }])
    expect(plan.issues[0].title.length).toBeLessThanOrEqual(250)
  })
})
