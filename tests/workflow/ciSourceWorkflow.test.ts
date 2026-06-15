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
    const job = workflow.jobs.source
    const scaleStep = job.steps.find(step => step.id === 'gate-fast-lane')

    expect(workflow.name).toBe('Source CI')
    expect(workflow.permissions).toMatchObject({ contents: 'read' })
    expect(job['timeout-minutes']).toBeGreaterThanOrEqual(25)
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
