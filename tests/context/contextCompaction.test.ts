import { describe, expect, it } from 'vitest'
import { compactMessages, totalTokens, type CompactMessage } from '../../src/context/ContextCompaction.js'

function msg(content: string, tokens: number): CompactMessage {
  return { role: 'user', content, tokens }
}

describe('compactMessages (P4-B)', () => {
  it('does not compact when within budget', () => {
    const messages = [msg('a', 100), msg('b', 100)]
    const r = compactMessages({ messages, budgetTokens: 1000 })
    expect(r.compacted).toBe(false)
    expect(r.kept).toHaveLength(2)
    expect(r.summarizedPrefixCount).toBe(0)
  })

  it('compacts over budget: keeps tail, summarizes prefix', () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, 500))
    const r = compactMessages({ messages, budgetTokens: 2000, keepTail: 3 })
    expect(r.compacted).toBe(true)
    expect(r.kept).toHaveLength(3)
    expect(r.kept[r.kept.length - 1].content).toBe('m9')
    expect(r.summarizedPrefixCount).toBe(7)
    expect(r.summaryPlaceholder?.role).toBe('system')
    expect(r.estimatedTokens).toBeLessThan(totalTokens(messages))
  })

  it('estimates tokens from content length when absent', () => {
    const r = compactMessages({ messages: [{ role: 'user', content: 'x'.repeat(400) }], budgetTokens: 50 })
    expect(r.compacted).toBe(true)
  })
})
