import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
      SCALE_MCP_CHROME_DEVTOOLS: undefined,
    },
    reject: false,
  })
}

const CLI_TEST_TIMEOUT_MS = 120_000

describe('tool CLI', () => {
  it('prints resolved tool policy as JSON', async () => {
    const scaleDir = makeDir('scale-tool-cli-')
    const projectDir = makeDir('scale-tool-project-')

    const result = await runScale(['tool', 'policy', '--dir', projectDir, '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { mode: string; tools: Record<string, unknown> }
    expect(parsed.mode).toBe('evidence-required')
    expect(parsed.tools).toHaveProperty('web-access')
    expect(parsed.tools).toHaveProperty('agent-browser')
  }, CLI_TEST_TIMEOUT_MS)

  it('prints tool doctor status as JSON', async () => {
    const scaleDir = makeDir('scale-tool-cli-')
    const projectDir = makeDir('scale-tool-project-')
    const skillDir = join(projectDir, '.agents', 'skills', 'web-access')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: web-access\n---\n', 'utf-8')

    const result = await runScale(['tool', 'doctor', '--dir', projectDir, '--tools', 'web-access,mcp-chrome-devtools', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const parsed = JSON.parse(result.stdout) as { ok: boolean; tools: Array<{ id: string; installed: boolean }> }
    expect(parsed.ok).toBe(false)
    expect(parsed.tools.find(tool => tool.id === 'web-access')?.installed).toBe(true)
    expect(parsed.tools.find(tool => tool.id === 'mcp-chrome-devtools')?.installed).toBe(false)
  }, CLI_TEST_TIMEOUT_MS)

  it('creates a tool execution plan from task intent as JSON', async () => {
    const scaleDir = makeDir('scale-tool-cli-')
    const projectDir = makeDir('scale-tool-project-')

    const result = await runScale([
      'tool',
      'plan',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-UI',
      '--task',
      'Build frontend ui with responsive browser review',
      '--level',
      'M',
      '--files',
      'src/components/Upload.tsx',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { steps: Array<{ toolId: string }> }
    expect(parsed.steps.map(step => step.toolId)).toEqual(expect.arrayContaining(['impeccable', 'taste-skill', 'awesome-design-md', 'ui-ux-pro-max']))
  }, CLI_TEST_TIMEOUT_MS)

  it('dry-runs a tool execution plan and writes evidence', async () => {
    const scaleDir = makeDir('scale-tool-cli-')
    const projectDir = makeDir('scale-tool-project-')
    for (const skillId of ['impeccable']) {
      const skillDir = join(projectDir, '.agents', 'skills', skillId)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${skillId}\n---\n`, 'utf-8')
    }

    const result = await runScale([
      'tool',
      'run',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-UI',
      '--task',
      'Build frontend ui with responsive browser review',
      '--level',
      'M',
      '--files',
      'src/components/Upload.tsx',
      '--dry-run',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout) as { ok: boolean; dryRun: boolean; evidence: Array<{ status: string }> }
    expect(parsed).toMatchObject({ ok: true, dryRun: true })
    expect(parsed.evidence.length).toBeGreaterThanOrEqual(1)
    expect(parsed.evidence.every(item => item.status === 'skipped')).toBe(true)
  }, CLI_TEST_TIMEOUT_MS)

  it('checks tool execution evidence and blocks missing or skipped required evidence', async () => {
    const scaleDir = makeDir('scale-tool-cli-')
    const projectDir = makeDir('scale-tool-project-')
    for (const skillId of ['impeccable']) {
      const skillDir = join(projectDir, '.agents', 'skills', skillId)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${skillId}\n---\n`, 'utf-8')
    }

    const missing = await runScale([
      'tool',
      'evidence',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-UI',
      '--task',
      'Build frontend ui with responsive browser review',
      '--level',
      'M',
      '--files',
      'src/components/Upload.tsx',
      '--json',
    ], scaleDir, projectDir)

    expect(missing.exitCode).toBe(1)
    const missingResult = JSON.parse(missing.stdout) as { complete: boolean; blocked: boolean; missing: Array<{ toolId: string }> }
    expect(missingResult.complete).toBe(false)
    expect(missingResult.blocked).toBe(true)
    expect(missingResult.missing.map(item => item.toolId)).toEqual(expect.arrayContaining(['impeccable']))

    const dryRun = await runScale([
      'tool',
      'run',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-UI',
      '--task',
      'Build frontend ui with responsive browser review',
      '--level',
      'M',
      '--files',
      'src/components/Upload.tsx',
      '--dry-run',
      '--json',
    ], scaleDir, projectDir)
    expect(dryRun.exitCode).toBe(0)

    const skipped = await runScale([
      'tool',
      'evidence',
      '--dir',
      projectDir,
      '--task-id',
      'TASK-UI',
      '--task',
      'Build frontend ui with responsive browser review',
      '--level',
      'M',
      '--files',
      'src/components/Upload.tsx',
      '--json',
    ], scaleDir, projectDir)

    expect(skipped.exitCode).toBe(1)
    const skippedResult = JSON.parse(skipped.stdout) as { skipped: Array<{ toolId: string }> }
    expect(skippedResult.skipped.map(item => item.toolId)).toEqual(expect.arrayContaining(['impeccable']))
  }, CLI_TEST_TIMEOUT_MS)
})
