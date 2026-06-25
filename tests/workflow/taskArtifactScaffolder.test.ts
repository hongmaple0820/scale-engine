import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendVerificationArtifact, checkTaskArtifactCompleteness, scaffoldTaskArtifacts } from '../../src/workflow/TaskArtifactScaffolder.js'
import { createSkillPlan, resolveSkillRoutingPolicy } from '../../src/skills/routing/index.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-artifacts-'))
  dirs.push(dir)
  return dir
}

describe('TaskArtifactScaffolder', () => {
  it('creates standard task artifacts for M/L work', () => {
    const projectDir = makeProject()

    const result = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-1',
      taskName: 'Implement Upload Retry',
      description: 'Implement upload retry behavior',
      level: 'L',
      services: ['netdisk'],
      skillPlan: createSkillPlan({
        taskId: 'TASK-1',
        taskName: 'Implement Upload Retry',
        description: 'Implement upload retry UI',
        level: 'L',
        files: ['src/components/upload.tsx'],
        policy: resolveSkillRoutingPolicy(null),
      }),
    })

    expect(result.relativeDir).toContain('.planning/tasks/')
    expect(result.created).toEqual(expect.arrayContaining([
      join(result.dir!, 'skill-plan.md'),
      join(result.dir!, 'runtime.md'),
      join(result.dir!, 'reality-check.md'),
      join(result.dir!, 'resource-cleanup.md'),
      join(result.dir!, 'standards-impact.md'),
      join(result.dir!, 'architecture-review.md'),
      join(result.dir!, 'skill-evidence.md'),
      join(result.dir!, 'ui-spec.md'),
      join(result.dir!, 'visual-review.md'),
    ]))
    expect(existsSync(join(result.dir!, 'mini-prd.md'))).toBe(true)
    expect(readFileSync(join(result.dir!, 'plan.md'), 'utf-8')).toContain('**Task ID**: TASK-1')
  })

  it('skips full artifacts for S work', () => {
    const projectDir = makeProject()

    const result = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-1',
      taskName: 'Typo',
      description: 'Fix typo',
      level: 'S',
    })

    expect(result.created).toEqual([])
    expect(result.relativeDir).toBeUndefined()
  })

  it('creates docs impact artifacts when skill routing requires documentation evidence', () => {
    const projectDir = makeProject()
    const skillPlan = createSkillPlan({
      taskId: 'TASK-DOCS',
      taskName: 'Document CLI',
      description: 'Update docs and README for CLI behavior',
      level: 'M',
      files: ['docs/workflow/README.md', 'src/api/cli.ts'],
      policy: resolveSkillRoutingPolicy(null),
    })

    const result = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-DOCS',
      taskName: 'Document CLI',
      description: 'Update docs and README for CLI behavior',
      level: 'M',
      skillPlan,
    })

    expect(result.created).toEqual(expect.arrayContaining([
      join(result.dir!, 'docs-impact.md'),
      join(result.dir!, 'skill-evidence.md'),
    ]))
  })

  it('appends verification evidence to verification.md', () => {
    const projectDir = makeProject()
    const result = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-1',
      taskName: 'Service Matrix',
      description: 'Verify service matrix',
      level: 'M',
      services: ['api'],
    })

    const path = appendVerificationArtifact({
      projectDir,
      artifactsDir: result.relativeDir,
      taskId: 'TASK-1',
      profile: 'default',
      services: ['api'],
      passed: true,
      gateResults: [{
        gate: 'G5',
        status: 'PASSED',
        passed: true,
        evidence: 'test passed',
        blockers: [],
        durationMs: 1,
        evidenceItems: [{
          id: 'E1',
          kind: 'command',
          label: 'Test command',
          passed: true,
          detail: 'ok',
          command: 'npm test',
          exitCode: 0,
          cwd: projectDir,
        }],
      }],
    })

    expect(path).toBe(join(result.dir!, 'verification.md'))
    const content = readFileSync(path!, 'utf-8')
    expect(content).toContain('SCALE Verification Run')
    expect(content).toContain('| npm test | PASS |')
  })

  it('requires substantive content, not only generated placeholders', () => {
    const projectDir = makeProject()
    const result = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-1',
      taskName: 'Artifact Quality',
      description: 'Verify artifact quality checks',
      level: 'L',
      services: ['api'],
    })

    const initial = checkTaskArtifactCompleteness({
      projectDir,
      artifactsDir: result.relativeDir,
      level: 'L',
    })
    expect(initial.complete).toBe(false)
    expect(initial.incomplete.map(item => item.file)).toContain('mini-prd.md')

    writeFileSync(join(result.dir!, 'explore.md'), '# Explore\n\ncurrent behavior documented\nmain conflict documented\n', 'utf-8')
    writeFileSync(join(result.dir!, 'mini-prd.md'), '# Mini-PRD\n\nuser goal\nexception one\nacceptance criteria\n', 'utf-8')
    writeFileSync(join(result.dir!, 'skill-plan.md'), '# Skill Plan\n\n## Detected Intents\n\n## Required Skills\n\n- none\n', 'utf-8')
    writeFileSync(join(result.dir!, 'plan.md'), '# Plan\n\napproach\nrollback plan\nhuman confirmation recorded before execution\n', 'utf-8')
    writeFileSync(join(result.dir!, 'runtime.md'), '# Runtime Contract\n\nconfiguration source documented\nservice topology documented\n', 'utf-8')
    writeFileSync(join(result.dir!, 'reality-check.md'), '# Reality Check\n\n## Confirmed\n\n- tested behavior\n\n## Fact Sources\n\n- command evidence and source file read\n\n## Not Verified\n\n- provider callback\n\n## Unsupported Claims\n\n- none after evidence review\n\n## Stub / Fake / Partial\n\n- no stubs\n\n## Credential-Gated\n\n- OAuth success\n\n## Environment-Gated\n\n- cloud test env\n\n## User-Visible Risk\n\n- incomplete provider coverage\n', 'utf-8')
    writeFileSync(join(result.dir!, 'resource-cleanup.md'), '# Resource Cleanup\n\nnew resources classified\ndocs promotion none\n', 'utf-8')
    writeFileSync(join(result.dir!, 'standards-impact.md'), '# Standards Impact\n\n## Standards Checked\n\n- Source files / docs: .scale/engineering-standards.json, .scale/frameworks.json, docs/standards/\n- Commands: scale standards doctor --changed --json\n\n## Findings\n\n| Severity | Rule | Path | Decision |\n| --- | --- | --- | --- |\n| LOW | example | src/example.ts | accept |\n', 'utf-8')
    writeFileSync(join(result.dir!, 'architecture-review.md'), '# Architecture Review\n\n## Architecture Sources\n\n- CodeGraph context confirmed boundary\n- docs/architecture reviewed\n\n## Decision\n\nApproved: no boundary violations\n', 'utf-8')
    writeFileSync(join(result.dir!, 'review.md'), '# Review\n\ncode review passed\nresidual risk none\n', 'utf-8')
    writeFileSync(join(result.dir!, 'summary.md'), '# Summary\n\ndelivered changes\nremaining risk none\n', 'utf-8')
    appendVerificationArtifact({
      projectDir,
      artifactsDir: result.relativeDir,
      taskId: 'TASK-1',
      profile: 'default',
      services: ['api'],
      gateResults: [],
      passed: true,
    })

    expect(checkTaskArtifactCompleteness({
      projectDir,
      artifactsDir: result.relativeDir,
      level: 'L',
    }).complete).toBe(true)
  })

  it('does not overwrite existing artifact files', () => {
    const projectDir = makeProject()
    const first = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-1',
      taskName: 'Existing',
      description: 'Existing',
      level: 'M',
    })
    writeFileSync(join(first.dir!, 'review.md'), 'custom review', 'utf-8')

    const second = scaffoldTaskArtifacts({
      projectDir,
      taskId: 'TASK-1',
      taskName: 'Existing',
      description: 'Existing',
      level: 'M',
    })

    expect(second.created).toHaveLength(0)
    expect(second.skipped).toHaveLength(12)
    expect(readFileSync(join(first.dir!, 'review.md'), 'utf-8')).toBe('custom review')
  })
})
