import { describe, expect, it } from 'vitest'
import { decideEscalation } from '../../src/routing/ModelEscalation.js'

describe('decideEscalation (P4-E)', () => {
  it('does not escalate below threshold', () => {
    const d = decideEscalation({ consecutiveNoProgress: 2, primaryModel: 'haiku', escalateTo: 'opus' })
    expect(d.escalate).toBe(false)
  })

  it('escalates at threshold', () => {
    const d = decideEscalation({ consecutiveNoProgress: 3, primaryModel: 'haiku', escalateTo: 'opus' })
    expect(d.escalate).toBe(true)
    expect(d.target).toBe('opus')
  })

  it('does not escalate twice', () => {
    const d = decideEscalation({ consecutiveNoProgress: 5, primaryModel: 'haiku', escalateTo: 'opus', alreadyEscalated: true })
    expect(d.escalate).toBe(false)
    expect(d.reason).toContain('Already escalated')
  })

  it('skips when budget too low', () => {
    const d = decideEscalation({ consecutiveNoProgress: 4, primaryModel: 'haiku', escalateTo: 'opus', remainingBudgetTokens: 500 })
    expect(d.escalate).toBe(false)
    expect(d.reason).toContain('budget')
  })

  it('skips when target equals primary model', () => {
    const d = decideEscalation({ consecutiveNoProgress: 4, primaryModel: 'opus', escalateTo: 'opus' })
    expect(d.escalate).toBe(false)
  })
})
