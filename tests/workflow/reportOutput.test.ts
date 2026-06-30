import { describe, expect, it } from 'vitest'
import { summarizeCommandOutput, summarizeCommandRecord } from '../../scripts/workflow/lib/report-output.mjs'

describe('report output helpers', () => {
  it('suppresses gbrain recommended-skills boilerplate from stderr', () => {
    const stderr = [
      'The system cannot find the path specified.',
      '',
      '========================================================================',
      'gbrain 0.37.11.0 — RECOMMENDED SKILLS FOR THE AGENT TO INSTALL',
      '========================================================================',
      'The user owns this decision.',
      '========================================================================',
    ].join('\n')

    expect(summarizeCommandOutput('gbrain-init', 'stderr', stderr)).toBe('')
  })

  it('summarizes gbrain init stdout to the durable readiness lines', () => {
    const stdout = [
      '  76 migration(s) applied',
      '',
      '═══════════════════════════════════════════════════════════════',
      '[gbrain] search mode tentatively set to: conservative',
      'To see what is running: gbrain search modes',
      '',
      'Brain ready at C:\\temp\\.gbrain\\brain.pglite',
      '0 pages. Engine: PGLite (local Postgres).',
      'Next: gbrain import <dir>',
      '',
      'When you outgrow local: gbrain migrate --to supabase',
      '',
      '--- GBrain Mod Status ---',
      'Skills: 43 loaded',
    ].join('\n')

    expect(summarizeCommandOutput('gbrain-init', 'stdout', stdout)).toBe([
      '76 migration(s) applied',
      'Brain ready at C:\\temp\\.gbrain\\brain.pglite',
      '0 pages. Engine: PGLite (local Postgres).',
      'Next: gbrain import <dir>',
      'When you outgrow local: gbrain migrate --to supabase',
    ].join('\n'))
  })

  it('summarizes graphify benchmark output and strips unreadable separator noise', () => {
    const stdout = [
      'graphify token reduction benchmark',
      '����������������������������������������',
      '  Corpus:          1,348,800 words ~1,798,400 tokens (naive)',
      '  Graph:           26,976 nodes, 53,061 edges',
      '  Avg query cost:  ~15,328 tokens',
      '  Reduction:       117.3x fewer tokens per query',
    ].join('\n')

    expect(summarizeCommandOutput('graphify-benchmark', 'stdout', stdout)).toBe([
      'graphify token reduction benchmark',
      'Corpus:          1,348,800 words ~1,798,400 tokens (naive)',
      'Graph:           26,976 nodes, 53,061 edges',
      'Avg query cost:  ~15,328 tokens',
      'Reduction:       117.3x fewer tokens per query',
    ].join('\n'))
  })

  it('summarizeCommandRecord drops raw stdout and stderr payloads', () => {
    const summarized = summarizeCommandRecord({
      name: 'graphify-rebuild',
      command: 'python -c "from graphify.watch import _rebuild_code; _rebuild_code(Path(\'.\'))"',
      exitCode: 0,
      stdout: '[graphify watch] Rebuilt (no clustering): 10 nodes, 20 edges\n[graphify watch] graph.json updated in repo\\graphify-out',
      stderr: '',
      timedOut: false,
      startedAt: '2026-05-25T00:00:00.000Z',
      endedAt: '2026-05-25T00:00:01.000Z',
    })

    expect('stdout' in summarized).toBe(false)
    expect('stderr' in summarized).toBe(false)
    expect(summarized.stdoutTail).toContain('graph.json updated')
  })
})
