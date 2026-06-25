import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectToolCapabilities } from '../../src/tools/ToolCapabilityRegistry.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function writeSkill(root: string, skillId: string): string {
  const dir = join(root, '.agents', 'skills', skillId)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  writeFileSync(file, `---\nname: ${skillId}\n---\n`, 'utf-8')
  return file
}

describe('ToolCapabilityRegistry', () => {
  it('detects installed skill files and CLI tool versions through injectable probes', () => {
    const homeDir = makeDir('scale-tools-home-')
    const projectDir = makeDir('scale-tools-project-')
    const webAccessPath = writeSkill(homeDir, 'web-access')

    const report = inspectToolCapabilities({
      projectDir,
      homeDir,
      toolIds: ['web-access', 'agent-browser', 'codex-cli'],
      commandExists: command => command === 'codex',
      runVersion: command => ({ ok: command === 'codex', stdout: 'codex 1.2.3' }),
    })

    expect(report.ok).toBe(false)
    expect(report.tools.find(tool => tool.id === 'web-access')).toMatchObject({
      id: 'web-access',
      category: 'skill',
      installed: true,
      status: 'installed',
      detectedPath: webAccessPath,
    })
    expect(report.tools.find(tool => tool.id === 'codex-cli')).toMatchObject({
      id: 'codex-cli',
      category: 'cli',
      installed: true,
      status: 'installed',
      version: 'codex 1.2.3',
    })
    expect(report.tools.find(tool => tool.id === 'agent-browser')).toMatchObject({
      installed: false,
      status: 'missing',
    })
    expect(report.summary).toMatchObject({
      total: 3,
      installed: 2,
      missing: 1,
    })
  })

  it('reports MCP tools from explicit environment flags without assuming availability', () => {
    const report = inspectToolCapabilities({
      projectDir: makeDir('scale-tools-project-'),
      homeDir: makeDir('scale-tools-home-'),
      toolIds: ['mcp-chrome-devtools'],
      env: {
        SCALE_MCP_CHROME_DEVTOOLS: '1',
      },
    })

    expect(report.ok).toBe(true)
    expect(report.tools[0]).toMatchObject({
      id: 'mcp-chrome-devtools',
      category: 'mcp',
      installed: true,
      status: 'installed',
    })
  })

  it('detects taste-skill through upstream alias skill directories', () => {
    const projectDir = makeDir('scale-tools-project-')
    const aliasPath = writeSkill(projectDir, 'design-taste-frontend')

    const report = inspectToolCapabilities({
      projectDir,
      homeDir: makeDir('scale-tools-home-'),
      toolIds: ['taste-skill'],
    })

    expect(report.ok).toBe(true)
    expect(report.tools[0]).toMatchObject({
      id: 'taste-skill',
      installed: true,
      status: 'installed',
      detectedPath: aliasPath,
    })
  })

  it('treats a CLI as missing when the version probe fails even if the command exists', () => {
    const report = inspectToolCapabilities({
      projectDir: makeDir('scale-tools-project-'),
      homeDir: makeDir('scale-tools-home-'),
      toolIds: ['playwright'],
      commandExists: command => command === 'npx',
      runVersion: () => ({ ok: false, stderr: 'playwright package is not installed' }),
    })

    expect(report.ok).toBe(false)
    expect(report.tools[0]).toMatchObject({
      id: 'playwright',
      installed: false,
      status: 'missing',
      missingReason: 'playwright package is not installed',
    })
  })

  it('detects memory and knowledge CLIs through the shared tool doctor catalog', () => {
    const report = inspectToolCapabilities({
      projectDir: makeDir('scale-tools-project-'),
      homeDir: makeDir('scale-tools-home-'),
      toolIds: ['gbrain', 'codegraph', 'graphify', 'gitnexus'],
      commandExists: command => ['gbrain', 'codegraph', 'graphify', 'gitnexus'].includes(command),
      runVersion: command => ({ ok: true, stdout: `${command} 1.0.0` }),
    })

    expect(report.ok).toBe(true)
    expect(report.tools.map(tool => tool.id)).toEqual(['gbrain', 'codegraph', 'graphify', 'gitnexus'])
    expect(report.tools.every(tool => tool.installed)).toBe(true)
    expect(report.tools.find(tool => tool.id === 'gbrain')?.installHint).toBe('scale setup --pack memory --memory-provider gbrain --memory-mode external-first --apply --yes')
    expect(report.tools.find(tool => tool.id === 'codegraph')?.installHint).toBe('scale setup --pack knowledge --apply --yes')
    expect(report.tools.find(tool => tool.id === 'graphify')?.installHint).toBe('scale setup --pack knowledge --apply --yes')
    expect(report.tools.find(tool => tool.id === 'gitnexus')?.installHint).toBe('scale setup --pack knowledge --apply --yes')
  })

  it('detects policy-selected skills that are not in the static tool catalog', () => {
    const projectDir = makeDir('scale-tools-project-')
    const skillPath = writeSkill(projectDir, 'code-reviewer')

    const report = inspectToolCapabilities({
      projectDir,
      homeDir: makeDir('scale-tools-home-'),
      toolIds: ['code-reviewer'],
    })

    expect(report.ok).toBe(true)
    expect(report.tools).toHaveLength(1)
    expect(report.tools[0]).toMatchObject({
      id: 'code-reviewer',
      name: 'Code Reviewer',
      category: 'skill',
      installed: true,
      status: 'installed',
      detectedPath: skillPath,
    })
  })
})
