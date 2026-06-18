import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

type DocsHealthReport = {
  ok: boolean
  failures: Array<{ id: string; file?: string; message: string }>
}

type DocsHealthModule = {
  runDocsHealth: (options: { root: string; checks?: string[] }) => DocsHealthReport
}

let dirs: string[] = []

function write(root: string, relPath: string, content: string) {
  const path = join(root, relPath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-docs-health-'))
  dirs.push(dir)

  for (const file of [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/README.md',
    'docs/guides/GETTING_STARTED.md',
    'docs/guides/DEVELOPMENT_WORKFLOW.md',
    'docs/workflow/README.md',
    'docs/workflow/GATES_AND_SCORE.md',
  ]) {
    write(dir, file, `# ${file}\n\nMaintained document.\n`)
  }

  write(dir, 'package.json', JSON.stringify({ name: 'demo' }, null, 2))
  write(dir, '.agent/project.json', JSON.stringify({ version: '1.1' }, null, 2))
  write(dir, '.scale/verification.json', JSON.stringify({ version: 1, profiles: { default: {} } }, null, 2))
  write(dir, '.scale/resource-policy.json', JSON.stringify({ version: 1, maxGitFileSizeBytes: 16 }, null, 2))
  write(dir, '.scale/workspace.json', JSON.stringify({ version: 1 }, null, 2))
  return dir
}

async function docsHealth(): Promise<DocsHealthModule> {
  return await import('../../scripts/workflow/docs-health.mjs') as DocsHealthModule
}

afterEach(() => {
  for (const dir of dirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
  dirs = []
})

describe('docs-health gate', () => {
  it('passes a healthy maintained documentation and config surface', async () => {
    const dir = makeProject()
    const { runDocsHealth } = await docsHealth()

    const report = runDocsHealth({ root: dir, checks: ['source-doc-health', 'config-health', 'markdown-link-health'] })

    expect(report.ok).toBe(true)
    expect(report.failures).toEqual([])
  })

  it('blocks duplicate JSON keys in workflow config', async () => {
    const dir = makeProject()
    write(dir, '.scale/verification.json', '{ "profiles": { "ci": {}, "ci": {} } }\n')
    const { runDocsHealth } = await docsHealth()

    const report = runDocsHealth({ root: dir, checks: ['config-health'] })

    expect(report.ok).toBe(false)
    expect(report.failures[0].message).toContain('duplicate JSON key: profiles.ci')
  })

  it('blocks maintained docs with merge markers or mojibake signatures', async () => {
    const dir = makeProject()
    write(dir, 'docs/workflow/README.md', '# Broken\n\n<<<<<<< HEAD\ncontent\n=======\n鈥滀贡鐮佲€�\n>>>>>>> branch\n')
    const { runDocsHealth } = await docsHealth()

    const report = runDocsHealth({ root: dir, checks: ['source-doc-health'] })

    expect(report.ok).toBe(false)
    expect(report.failures.map(failure => failure.message)).toEqual(expect.arrayContaining([
      'merge marker detected',
      'possible mojibake or replacement characters detected',
    ]))
  })

  it('blocks root-level runtime artifacts', async () => {
    const dir = makeProject()
    write(dir, 'debug-screenshot.png', 'not really a png')
    const { runDocsHealth } = await docsHealth()

    const report = runDocsHealth({ root: dir, checks: ['root-artifact-placement'] })

    expect(report.ok).toBe(false)
    expect(report.failures[0]).toMatchObject({
      id: 'root-artifact-placement',
      file: 'debug-screenshot.png',
    })
  })

  it('blocks broken internal markdown links', async () => {
    const dir = makeProject()
    write(dir, 'docs/workflow/README.md', '# Workflow\n\nSee [missing](missing.md).\n')
    const { runDocsHealth } = await docsHealth()

    const report = runDocsHealth({ root: dir, checks: ['markdown-link-health'] })

    expect(report.ok).toBe(false)
    expect(report.failures[0].message).toContain('broken internal markdown link: missing.md')
  })
})
