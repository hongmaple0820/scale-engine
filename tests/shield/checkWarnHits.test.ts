// checkWarnHits — the warn-level half of the DSH shield bridge. checkToolInput
// silently drops warn matches (only severity 'block' is considered), so the
// bridge needs this dedicated entry point to map warn → ask (plan §6 T1.1).

import { describe, expect, it } from 'vitest'
import { checkWarnHits } from '../../src/shield/ProtectedPaths.js'

describe('checkWarnHits', () => {
  it('flags destructive-adjacent commands', () => {
    const hits = checkWarnHits('git checkout -- src/')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].severity).toBe('warn')
    expect(hits[0].reason).toBeTruthy()
  })

  it('returns no warn hits for harmless commands', () => {
    expect(checkWarnHits('ls -la')).toHaveLength(0)
    expect(checkWarnHits('npm test')).toHaveLength(0)
  })

  it('warn hits are distinct from block hits (severity partition)', () => {
    // rm -rf is block-level: it must not surface again as a warn hit
    expect(checkWarnHits('rm -rf /')).toHaveLength(0)
  })
})
