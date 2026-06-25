import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryFabric } from '../../src/memory/MemoryFabric.js'
import { RuntimeEvidenceLedger } from '../../src/runtime/RuntimeEvidenceLedger.js'
import { SessionLedger } from '../../src/runtime/SessionLedger.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'
import type { KnowledgeEntry } from '../../src/artifact/types.js'
import type { Instinct } from '../../src/cortex/InstinctExtractor.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-memory-fabric-'))
  dirs.push(dir)
  return dir
}

function knowledgeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'KB-1',
    type: 'FIX',
    title: 'OAuth callback state rule',
    tags: ['oauth', 'redis', 'callback'],
    contentRef: 'docs/knowledge/oauth.md',
    relevance: 0.91,
    accessCount: 3,
    verified: true,
    createdAt: 1,
    ...overrides,
  }
}

function instinct(overrides: Partial<Instinct> = {}): Instinct {
  return {
    id: 'instinct-memory-fabric',
    trigger: 'memory fabric cortex recall',
    confidence: 0.7,
    domain: 'governance',
    source: 'test',
    scope: 'global',
    action: '## Action\nUse Cortex lessons inside the memory context pack',
    evidence: ['[2026-06-13] memory fabric cortex recall'],
    observations: 5,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    appliedCount: 2,
    hitRate: 0.4,
    ...overrides,
  }
}

describe('MemoryFabric', () => {
  it('builds a compact context pack from runtime evidence, session events, knowledge, and graph status', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    const sessionLedger = new SessionLedger({ projectDir, scaleDir })
    sessionLedger.start({ sessionId: 'SESSION-1', taskId: 'TASK-1', level: 'M', summary: 'OAuth bind fix' })
    sessionLedger.append('SESSION-1', {
      type: 'phase.completed',
      phase: 'verify',
      message: 'gateway smoke passed',
    })
    new RuntimeEvidenceLedger({ projectDir, scaleDir }).record({
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      kind: 'command',
      title: 'OAuth callback smoke',
      status: 'passed',
      exitCode: 0,
      summary: 'callback returned code=200',
    })
    mkdirSync(join(projectDir, 'graphify-out'), { recursive: true })
    writeFileSync(join(projectDir, 'graphify-out', 'GRAPH_REPORT.md'), '# Graph\n\nnetdisk -> gateway\n', 'utf-8')

    const recallByVector = vi.fn().mockResolvedValue([knowledgeEntry()])
    const fabric = new MemoryFabric({
      projectDir,
      scaleDir,
      knowledgeBase: { recallByVector },
    })

    const pack = await fabric.createContextPack({
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      task: 'Fix OAuth callback state lookup through Redis',
      level: 'M',
      files: ['src/oauth/callback.ts'],
      budgetTokens: 4_000,
    })

    expect(pack.task).toMatchObject({
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      level: 'M',
    })
    expect(pack.budget.used).toBeLessThanOrEqual(pack.budget.limit)
    expect(pack.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'runtime-evidence', included: true }),
      expect.objectContaining({ id: 'session-events', included: true }),
      expect.objectContaining({ id: 'cortex-instincts', included: false }),
      expect.objectContaining({ id: 'knowledge', included: true }),
      expect.objectContaining({ id: 'graph', included: true }),
    ]))
    expect(pack.sections.find(section => section.id === 'runtime-evidence')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'OAuth callback smoke', status: 'passed' }),
    ]))
    expect(pack.sections.find(section => section.id === 'session-events')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session-event', eventType: 'phase.completed', message: 'gateway smoke passed' }),
    ]))
    expect(pack.sections.find(section => section.id === 'knowledge')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'OAuth callback state rule', verified: true }),
    ]))
    expect(pack.sections.find(section => section.id === 'graph')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: expect.stringContaining('GRAPH_REPORT.md') }),
    ]))
    expect(recallByVector).toHaveBeenCalledWith(expect.stringContaining('OAuth callback'), 5)
  })

  it('includes Cortex learned instincts in the context pack', async () => {
    const projectDir = makeProject()
    const scaleDir = '.scale'
    const store = new InstinctStore(join(projectDir, scaleDir, 'instincts'))
    const savedId = store.save(instinct({
      trigger: 'workflow evidence required',
      action: [
        '## Trigger',
        'Workflow evidence was missing',
        '',
        '## Recommended Action',
        'Record verification evidence before marking the task complete.',
      ].join('\n'),
    }))

    const pack = await new MemoryFabric({ projectDir, scaleDir }).createContextPack({
      task: 'Continue workflow evidence hardening',
      level: 'M',
      budgetTokens: 4_000,
    })
    const cortexSection = pack.sections.find(section => section.id === 'cortex-instincts')

    expect(cortexSection).toMatchObject({ included: true })
    expect(cortexSection?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'cortex-instinct',
        id: savedId,
        trigger: 'workflow evidence required',
        action: 'Record verification evidence before marking the task complete.',
        confidence: 0.7,
        hitRate: 0.4,
      }),
    ]))
  })

  it('keeps high-priority evidence and omits lower-priority sections when token budget is tight', async () => {
    const projectDir = makeProject()
    new RuntimeEvidenceLedger({ projectDir }).record({
      taskId: 'TASK-2',
      sessionId: 'SESSION-2',
      kind: 'command',
      title: 'failing verification',
      status: 'failed',
      exitCode: 1,
      summary: 'unit tests failed in auth module',
    })

    const fabric = new MemoryFabric({
      projectDir,
      knowledgeBase: {
        recallByVector: vi.fn().mockResolvedValue([
          knowledgeEntry({
            id: 'KB-LONG',
            title: 'Long optional implementation detail',
            tags: ['optional', 'details'],
          }),
        ]),
      },
    })

    const pack = await fabric.createContextPack({
      taskId: 'TASK-2',
      sessionId: 'SESSION-2',
      task: 'Fix failing verification',
      level: 'M',
      budgetTokens: 90,
    })

    expect(pack.sections.find(section => section.id === 'runtime-evidence')).toMatchObject({
      included: true,
    })
    expect(pack.omittedSections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge', reason: expect.stringContaining('budget') }),
    ]))
    expect(pack.budget.overBudget).toBe(false)
  })

  it('does not preview knowledge content outside the project and redacts sensitive previews', async () => {
    const projectDir = makeProject()
    const outsideDir = makeProject()
    const insideKnowledgeDir = join(projectDir, 'docs', 'knowledge')
    mkdirSync(insideKnowledgeDir, { recursive: true })
    writeFileSync(join(insideKnowledgeDir, 'safe.md'), 'token=raw-secret-value\nUse Redis state lookup.', 'utf-8')
    writeFileSync(join(outsideDir, 'outside.md'), 'outside secret should never be read', 'utf-8')

    const fabric = new MemoryFabric({
      projectDir,
      knowledgeBase: {
        recallByVector: vi.fn().mockResolvedValue([
          knowledgeEntry({
            id: 'KB-SAFE',
            title: 'Safe project knowledge',
            contentRef: 'docs/knowledge/safe.md',
          }),
          knowledgeEntry({
            id: 'KB-OUTSIDE',
            title: 'Outside knowledge',
            contentRef: join(outsideDir, 'outside.md'),
          }),
        ]),
      },
    })

    const pack = await fabric.createContextPack({
      task: 'Use memory safely',
      budgetTokens: 4_000,
    })
    const knowledgeItems = pack.sections.find(section => section.id === 'knowledge')?.items ?? []

    expect(knowledgeItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'KB-SAFE', preview: expect.stringContaining('[REDACTED]') }),
      expect.objectContaining({ id: 'KB-OUTSIDE', preview: undefined }),
    ]))
    expect(JSON.stringify(knowledgeItems)).not.toContain('raw-secret-value')
    expect(JSON.stringify(knowledgeItems)).not.toContain('outside secret')
  })

  it('does not preview knowledge content through a project-local symlink or junction', async () => {
    const projectDir = makeProject()
    const outsideDir = makeProject()
    const insideKnowledgeDir = join(projectDir, 'docs', 'knowledge')
    mkdirSync(insideKnowledgeDir, { recursive: true })
    writeFileSync(join(outsideDir, 'outside.md'), 'outside via link should never be read', 'utf-8')
    symlinkSync(
      outsideDir,
      join(insideKnowledgeDir, 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const fabric = new MemoryFabric({
      projectDir,
      knowledgeBase: {
        recallByVector: vi.fn().mockResolvedValue([
          knowledgeEntry({
            id: 'KB-LINK',
            title: 'Linked outside knowledge',
            contentRef: 'docs/knowledge/outside-link/outside.md',
          }),
        ]),
      },
    })

    const pack = await fabric.createContextPack({
      task: 'Use memory safely',
      budgetTokens: 4_000,
    })
    const knowledgeItems = pack.sections.find(section => section.id === 'knowledge')?.items ?? []

    expect(knowledgeItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'KB-LINK', preview: undefined }),
    ]))
    expect(JSON.stringify(knowledgeItems)).not.toContain('outside via link')
  })
})
