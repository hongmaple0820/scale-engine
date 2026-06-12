// SCALE Engine — Session Preamble Tests

import { afterEach, describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  collectSessionPreamble,
  formatPreambleForAgent,
  type SessionPreamble,
} from '../../src/workflow/SessionPreamble.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import type { Instinct } from '../../src/cortex/InstinctExtractor.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function cortexPreamble(overrides: Partial<SessionPreamble['cortex']> = {}): SessionPreamble['cortex'] {
  return {
    instinctCount: 0,
    instinctsApplied: [],
    content: '',
    ...overrides,
  }
}

function makeInstinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: 'instinct-session-test',
    trigger: 'runtime preamble test',
    confidence: 0.9,
    domain: 'governance',
    source: 'test',
    scope: 'global',
    action: '## Action\nAlways check runtime preamble instincts before planning',
    evidence: ['[2026-06-12] G8: runtime preamble test'],
    observations: 5,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    appliedCount: 0,
    hitRate: 0,
    ...overrides,
  }
}

describe('collectSessionPreamble', () => {
  it('collects preamble with default options', () => {
    const preamble = collectSessionPreamble()
    expect(preamble.sessionId).toBeDefined()
    expect(preamble.sessionId.length).toBe(8)
    expect(preamble.timestamp).toBeDefined()
    expect(preamble.scaleVersion).toBeDefined()
    expect(preamble.projectSlug).toBeDefined()
    expect(preamble.warnings).toBeDefined()
  })

  it('collects git branch when in a git repo', () => {
    const preamble = collectSessionPreamble()
    // We're in a git repo during testing
    expect(preamble.gitBranch).not.toBe('unknown')
  })

  it('uses custom projectDir and scaleDir', () => {
    const preamble = collectSessionPreamble({
      projectDir: process.cwd(),
      scaleDir: '.scale',
    })
    expect(preamble.projectSlug).toBeDefined()
    expect(preamble.verificationProfile).toBeDefined()
  })

  it('gracefully handles non-git directory', () => {
    const preamble = collectSessionPreamble({ projectDir: '/tmp' })
    // May have warnings about git, but should not throw
    expect(preamble.sessionId).toBeDefined()
  })

  it('includes high-confidence Cortex instincts in the collected preamble', () => {
    const projectDir = makeDir('scale-session-preamble-project-')
    const scaleDir = makeDir('scale-session-preamble-scale-')
    const savedId = new InstinctStore(join(scaleDir, 'instincts')).save(makeInstinct())

    const preamble = collectSessionPreamble({ projectDir, scaleDir })

    expect(preamble.cortex.instinctCount).toBe(1)
    expect(preamble.cortex.instinctsApplied).toEqual([savedId])
    expect(preamble.cortex.content).toContain('Always check runtime preamble instincts before planning')
  })
})

describe('formatPreambleForAgent', () => {
  it('formats preamble as readable text', () => {
    const preamble: SessionPreamble = {
      sessionId: 'abc12345',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'main',
      gitRoot: '/home/user/project',
      projectSlug: 'my-project',
      scaleVersion: '0.31.0',
      activeRunCount: 3,
      learningCount: 12,
      verificationProfile: 'default',
      governanceMode: 'standard',
      cortex: cortexPreamble(),
      warnings: [],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).toContain('SESSION: abc12345')
    expect(formatted).toContain('BRANCH: main')
    expect(formatted).toContain('PROJECT: my-project')
    expect(formatted).toContain('SCALE_VERSION: 0.31.0')
    expect(formatted).toContain('ACTIVE_RUNS: 3')
    expect(formatted).toContain('LEARNINGS: 12')
    expect(formatted).toContain('VERIFICATION_PROFILE: default')
    expect(formatted).toContain('GOVERNANCE_MODE: standard')
    expect(formatted).toContain('CORTEX_INSTINCTS: 0')
  })

  it('includes warnings when present', () => {
    const preamble: SessionPreamble = {
      sessionId: 'test',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'unknown',
      gitRoot: '/tmp',
      projectSlug: 'test',
      scaleVersion: '0.31.0',
      activeRunCount: 0,
      learningCount: 0,
      verificationProfile: 'default',
      governanceMode: 'standard',
      cortex: cortexPreamble(),
      warnings: ['Not in a git repository'],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).toContain('WARNINGS: Not in a git repository')
  })

  it('omits warnings line when no warnings', () => {
    const preamble: SessionPreamble = {
      sessionId: 'test',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'main',
      gitRoot: '/project',
      projectSlug: 'test',
      scaleVersion: '0.31.0',
      activeRunCount: 0,
      learningCount: 0,
      verificationProfile: 'default',
      governanceMode: 'standard',
      cortex: cortexPreamble(),
      warnings: [],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).not.toContain('WARNINGS')
  })

  it('formats Cortex injection content for agent-visible preamble text', () => {
    const preamble: SessionPreamble = {
      sessionId: 'test',
      timestamp: '2026-05-21T10:00:00Z',
      gitBranch: 'main',
      gitRoot: '/project',
      projectSlug: 'test',
      scaleVersion: '0.31.0',
      activeRunCount: 0,
      learningCount: 0,
      verificationProfile: 'default',
      governanceMode: 'standard',
      cortex: cortexPreamble({
        instinctCount: 1,
        instinctsApplied: ['instinct-1'],
        content: 'SCALE Cortex Instincts:\nAlways run product smoke',
      }),
      warnings: [],
    }

    const formatted = formatPreambleForAgent(preamble)
    expect(formatted).toContain('CORTEX_INSTINCTS: 1')
    expect(formatted).toContain('CORTEX_APPLIED: instinct-1')
    expect(formatted).toContain('CORTEX_SESSION_INJECTION:')
    expect(formatted).toContain('Always run product smoke')
  })
})
