import { describe, expect, it } from 'vitest'
import { createBenchmarkFromWorkflowEval } from '../../src/eval/BenchmarkPublisher.js'
import type { WorkflowEvalRun } from '../../src/eval/WorkflowEval.js'

describe('BenchmarkPublisher workflow eval adapter', () => {
  it('converts workflow eval run metrics into benchmark data', () => {
    const run: WorkflowEvalRun = {
      id: 'EVAL-test',
      suiteId: 'workflow-baseline',
      generatedAt: '2026-06-12T00:00:00.000Z',
      projectDir: '/tmp/project',
      ok: true,
      failureReplayIds: [],
      metrics: {
        total: 2,
        passed: 2,
        failed: 0,
        passAt1: 1,
        passAt3: 2,
        passAt1Rate: 0.5,
        passAt3Rate: 1,
        averageFixIterations: 0.5,
        totalToolCalls: 3,
        estimatedTokens: 300,
        humanCorrections: 0,
        failureReplayCount: 0,
      },
      cases: [
        {
          id: 'bugfix-case',
          type: 'bugfix',
          title: 'Bugfix case',
          task: 'Fix bug',
          passed: true,
          passAt1: true,
          passAt3: true,
          fixIterations: 0,
          humanCorrections: 0,
          estimatedTokens: 100,
          toolCalls: 1,
          failureReplayIds: [],
          attempts: [
            {
              id: 'attempt-1',
              command: 'node -v',
              expectedExitCode: 0,
              exitCode: 0,
              passed: true,
              durationMs: 20,
              outputSummary: 'ok',
              redactionApplied: false,
            },
          ],
        },
        {
          id: 'security-case',
          type: 'security',
          title: 'Security case',
          task: 'Check security',
          passed: true,
          passAt1: false,
          passAt3: true,
          fixIterations: 1,
          humanCorrections: 0,
          estimatedTokens: 200,
          toolCalls: 2,
          failureReplayIds: [],
          attempts: [
            {
              id: 'attempt-1',
              command: 'node -e "process.exit(1)"',
              expectedExitCode: 0,
              exitCode: 1,
              passed: false,
              durationMs: 40,
              outputSummary: 'failed',
              redactionApplied: false,
            },
            {
              id: 'attempt-2',
              command: 'node -v',
              expectedExitCode: 0,
              exitCode: 0,
              passed: true,
              durationMs: 60,
              outputSummary: 'ok',
              redactionApplied: false,
            },
          ],
        },
      ],
    }

    const benchmark = createBenchmarkFromWorkflowEval(run, '0.48.0')

    expect(benchmark.version).toBe('0.48.0')
    expect(benchmark.summary).toMatchObject({
      passAt1: 0.5,
      passAt3: 1,
      totalCases: 2,
      avgDurationMs: 60,
      avgTokens: 150,
      avgCostUsd: 0,
    })
    expect(benchmark.byCategory.bugfix).toMatchObject({ total: 1, passed: 1, avgDurationMs: 20, avgTokens: 100 })
    expect(benchmark.byCategory.security).toMatchObject({ total: 1, passed: 1, avgDurationMs: 100, avgTokens: 200 })
    expect(benchmark.trends).toEqual([{ date: '2026-06-12', passAt1: 0.5, totalCases: 2 }])
  })
})
