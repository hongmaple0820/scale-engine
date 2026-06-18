import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

type LearningHealthReport = {
  ok: boolean
  failures: Array<{ id: string; file?: string; message: string }>
}

type LearningHealthModule = {
  runLearningHealth: (options: { root: string; checks?: string[] }) => LearningHealthReport
}

let dirs: string[] = []

function write(root: string, relPath: string, content: string) {
  const path = join(root, relPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-learning-health-'))
  dirs.push(dir)
  write(dir, '.scale/skills/manifest.json', JSON.stringify({ name: 'demo-skills' }, null, 2))
  write(dir, '.scale/skills.json', JSON.stringify({
    version: 1,
    skillSources: {
      primaryRoot: '.scale/skills',
      fallbackRoots: ['skills'],
      globalRoots: ['~/.agents/skills'],
    },
  }, null, 2))
  write(dir, '.scale/memory-providers.json', JSON.stringify({
    version: '1.0',
    routing: {
      mode: 'external-first',
      defaultOrder: ['gbrain'],
      allowExternalWrite: false,
      requireEvidence: true,
      maxResultsPerProvider: 5,
    },
    providers: [],
  }, null, 2))
  write(dir, '.scale/verification.json', JSON.stringify({
    version: 1,
    profiles: {
      default: { commands: { 'learning-health': 'node scripts/workflow/learning-health.mjs' } },
      ci: { commands: { 'learning-health': 'node scripts/workflow/learning-health.mjs' } },
    },
  }, null, 2))
  write(dir, 'package.json', JSON.stringify({
    files: ['.scale/skills', 'scripts/workflow/learning-health.mjs'],
    scripts: {
      'learning:health': 'node scripts/workflow/learning-health.mjs',
      'release:check': 'npm run learning:health && npm test',
    },
  }, null, 2))
  write(dir, 'docs/workflow/templates/verification.md', '# Verification\n\n## Regression / Stability Checks\n\n## Learning Evidence\n')
  write(dir, 'docs/workflow/templates/summary.md', '# Summary\n\n## Learning And Prevention\n')
  write(dir, '.github/workflows/publish.yml', 'steps:\n  - run: npm run learning:health\n')
  write(dir, '.github/workflows/ci-source.yml', 'steps:\n  - run: npm run learning:health\n')
  write(dir, '.github/workflows/scale-gate.yml', 'steps:\n  - run: npm run learning:health\n')
  return dir
}

async function learningHealth(): Promise<LearningHealthModule> {
  return await import('../../scripts/workflow/learning-health.mjs') as LearningHealthModule
}

afterEach(() => {
  for (const dir of dirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
  dirs = []
})

describe('learning-health gate', () => {
  it('passes when skill roots, memory policy, release files, and verification chain are wired', async () => {
    const dir = makeProject()
    const { runLearningHealth } = await learningHealth()

    const report = runLearningHealth({ root: dir })

    expect(report.ok).toBe(true)
    expect(report.failures).toEqual([])
  })

  it('blocks missing canonical skill roots', async () => {
    const dir = makeProject()
    write(dir, '.scale/skills.json', JSON.stringify({
      version: 1,
      skillSources: {
        primaryRoot: 'skills',
        fallbackRoots: [],
      },
    }, null, 2))
    const { runLearningHealth } = await learningHealth()

    const report = runLearningHealth({ root: dir, checks: ['skill-source-policy'] })

    expect(report.ok).toBe(false)
    expect(report.failures.map(failure => failure.message)).toEqual(expect.arrayContaining([
      'skillSources.primaryRoot must be .scale/skills for repo-local reusable skills',
      'skillSources.fallbackRoots must keep skills for legacy project compatibility',
    ]))
  })

  it('blocks release checks that skip the learning gate', async () => {
    const dir = makeProject()
    write(dir, 'package.json', JSON.stringify({
      files: ['.scale/skills', 'scripts/workflow/learning-health.mjs'],
      scripts: {
        'release:check': 'npm test',
      },
    }, null, 2))
    const { runLearningHealth } = await learningHealth()

    const report = runLearningHealth({ root: dir, checks: ['learning-verification-chain'] })

    expect(report.ok).toBe(false)
    expect(report.failures.map(failure => failure.message)).toEqual(expect.arrayContaining([
      'release:check must start with npm run learning:health before other release gates',
      'package scripts must expose learning:health',
    ]))
  })

  it('blocks CI and release workflows that skip the learning gate', async () => {
    const dir = makeProject()
    write(dir, '.github/workflows/publish.yml', 'steps:\n  - run: npm test\n')
    const { runLearningHealth } = await learningHealth()

    const report = runLearningHealth({ root: dir, checks: ['learning-verification-chain'] })

    expect(report.ok).toBe(false)
    expect(report.failures).toContainEqual(expect.objectContaining({
      file: '.github/workflows/publish.yml',
      message: 'CI/release workflow must run npm run learning:health before publish or gate execution',
    }))
  })

  it('blocks artifact templates that drop learning evidence sections', async () => {
    const dir = makeProject()
    write(dir, 'docs/workflow/templates/verification.md', '# Verification\n\n## Commands Run\n')
    const { runLearningHealth } = await learningHealth()

    const report = runLearningHealth({ root: dir, checks: ['learning-artifact-templates'] })

    expect(report.ok).toBe(false)
    expect(report.failures.map(failure => failure.message)).toEqual(expect.arrayContaining([
      'missing required learning section: ## Regression / Stability Checks',
      'missing required learning section: ## Learning Evidence',
    ]))
  })
})
