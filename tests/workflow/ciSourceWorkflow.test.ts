import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

type WorkflowStep = {
  name?: string
  id?: string
  run?: string
  uses?: string
  ['continue-on-error']?: boolean
}

type WorkflowJob = {
  needs?: string | string[]
  strategy?: {
    matrix?: {
      os?: string[]
    }
  }
  steps: WorkflowStep[]
  ['timeout-minutes']?: number
}

type Workflow = {
  name: string
  permissions?: Record<string, string>
  jobs: Record<string, WorkflowJob>
}

function loadWorkflow(path: string): Workflow {
  return yaml.load(readFileSync(join(process.cwd(), path), 'utf-8')) as Workflow
}

describe('source CI workflow', () => {
  it('dogfoods the local source CLI and blocks failed SCALE fast-lane gates', () => {
    const workflow = loadWorkflow('.github/workflows/ci-source.yml')
    const gateJob = workflow.jobs.gate
    const scaleStep = gateJob.steps.find(step => step.id === 'gate-fast-lane')

    expect(workflow.name).toBe('Source CI')
    expect(workflow.permissions).toMatchObject({ contents: 'read' })
    expect(Object.keys(workflow.jobs).sort()).toEqual(['audit', 'build', 'check', 'gate', 'test'])
    expect(workflow.jobs.check['timeout-minutes']).toBeGreaterThanOrEqual(8)
    expect(workflow.jobs.build.needs).toBe('check')
    expect(workflow.jobs.audit.needs).toBe('check')
    expect(workflow.jobs.test.needs).toBe('build')
    expect(gateJob.needs).toBe('build')
    expect(gateJob.strategy?.matrix?.os).toEqual(['ubuntu-latest', 'macos-latest'])
    expect(gateJob['timeout-minutes']).toBeGreaterThanOrEqual(12)
    expect(scaleStep).toBeDefined()
    expect(scaleStep?.['continue-on-error']).not.toBe(true)
    expect(scaleStep?.run).toContain('scripts/workflow/run-command-with-timeout.mjs')
    expect(scaleStep?.run).toContain('--timeout-ms 420000')
    expect(scaleStep?.run).toContain('node dist/api/cli.js preflight')
    expect(scaleStep?.run).toContain('--profile ci')
    expect(scaleStep?.run).toContain('--preflight-profile fast-lane')
    expect(scaleStep?.run).toContain('exit "${status}"')
    expect(scaleStep?.run).not.toContain('timeout 420s')
    expect(scaleStep?.run).not.toContain('@hongmaple0820/scale-engine')
  })

  it('keeps the published package gate clearly separated from source CI', () => {
    const workflow = loadWorkflow('.github/workflows/scale-gate.yml')
    const job = workflow.jobs['published-package-gates']
    const commands = job.steps.map(step => step.run ?? '').join('\n')

    expect(workflow.name).toBe('Published Package Gate Check')
    expect(workflow.permissions).toMatchObject({ contents: 'read' })
    expect(commands).toContain('npm install -g @hongmaple0820/scale-engine')
    expect(commands).toContain('scale preflight --json --profile ci --preflight-profile ci')
    expect(commands).not.toContain('node dist/api/cli.js preflight')
  })
})
