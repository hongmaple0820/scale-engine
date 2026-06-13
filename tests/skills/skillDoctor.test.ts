import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectRequiredWorkflowSkills, inspectWorkflowSkills } from '../../src/skills/SkillDoctor.js'

describe('SkillDoctor', () => {
  it('reports workflow skill installation status from real skill files', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      const skillDir = join(homeDir, '.agents', 'skills', 'frontend-design')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: frontend-design\n---\n', 'utf-8')

      const report = inspectWorkflowSkills({ projectDir, homeDir })
      const frontend = report.skills.find(skill => skill.id === 'frontend-design')
      const reviewer = report.skills.find(skill => skill.id === 'code-reviewer')

      expect(report.total).toBeGreaterThan(0)
      expect(frontend).toMatchObject({
        id: 'frontend-design',
        installed: true,
        status: 'installed',
      })
      expect(frontend?.detectedPath).toBe(join(skillDir, 'SKILL.md'))
      expect(reviewer).toMatchObject({
        id: 'code-reviewer',
        installed: false,
        status: 'missing',
      })
      expect(reviewer?.installCommand).toContain('google-gemini')
      expect(report.ok).toBe(false)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('reports required skill installation gaps for a task', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      const skillDir = join(homeDir, '.agents', 'skills', 'frontend-design')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: frontend-design\n---\n', 'utf-8')

      const report = inspectRequiredWorkflowSkills(['frontend-design', 'code-reviewer', 'unknown-skill'], {
        projectDir,
        homeDir,
      })

      expect(report.ok).toBe(false)
      expect(report.installed).toEqual(['frontend-design'])
      expect(report.missing).toEqual(['code-reviewer', 'unknown-skill'])
      expect(report.unknown).toEqual(['unknown-skill'])
      expect(report.skills.map(skill => skill.id)).toEqual(['frontend-design', 'code-reviewer'])
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('understands tool orchestration skills required by routing policy', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      for (const skillId of ['web-access', 'ui-ux-pro-max']) {
        const skillDir = join(homeDir, '.agents', 'skills', skillId)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${skillId}\n---\n`, 'utf-8')
      }

      const report = inspectRequiredWorkflowSkills(['web-access', 'ui-ux-pro-max', 'cua'], {
        projectDir,
        homeDir,
        commandExists: () => false,
        resolveCommandPath: () => null,
      })

      expect(report.unknown).toEqual([])
      expect(report.installed).toEqual(['web-access', 'ui-ux-pro-max'])
      expect(report.missing).toEqual(['cua'])
      expect(report.skills.find(skill => skill.id === 'web-access')?.source).toBe('https://github.com/eze-is/web-access')
      expect(report.skills.find(skill => skill.id === 'ui-ux-pro-max')?.source).toBe('https://github.com/nextlevelbuilder/ui-ux-pro-max-skill')
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('checks cli-command workflow skills via PATH instead of requiring SKILL.md files', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      const report = inspectWorkflowSkills({
        projectDir,
        homeDir,
        commandExists: command => command === 'codex' || command === 'agent-browser',
        resolveCommandPath: command => command === 'codex' || command === 'agent-browser' ? `C:\\tools\\${command}.cmd` : null,
      })

      expect(report.skills.find(skill => skill.id === 'codex-cli')).toMatchObject({
        executionType: 'cli-command',
        installed: true,
        detectedPath: 'C:\\tools\\codex.cmd',
      })
      expect(report.skills.find(skill => skill.id === 'agent-browser')).toMatchObject({
        executionType: 'cli-command',
        installed: true,
        detectedPath: 'C:\\tools\\agent-browser.cmd',
      })
      expect(report.skills.find(skill => skill.id === 'gemini-cli')).toMatchObject({
        executionType: 'cli-command',
        installed: false,
        missingReason: 'Command not found on PATH: gemini',
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('checks mcp-tool workflow skills through explicit MCP availability flags', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    try {
      const report = inspectWorkflowSkills({
        projectDir,
        homeDir,
        env: { SCALE_MCP_CHROME_DEVTOOLS: 'true' },
        commandExists: () => false,
        resolveCommandPath: () => null,
      })

      expect(report.skills.find(skill => skill.id === 'mcp-chrome-devtools')).toMatchObject({
        executionType: 'mcp-tool',
        checkedPaths: ['env:SCALE_MCP_CHROME_DEVTOOLS'],
        detectedPath: 'env:SCALE_MCP_CHROME_DEVTOOLS',
        installed: true,
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })

  it('honors explicit recommended skill waivers without marking the skill installed', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'scale-skill-home-'))
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-skill-project-'))
    const scaleDir = join(projectDir, '.scale')
    try {
      mkdirSync(scaleDir, { recursive: true })
      writeFileSync(join(scaleDir, 'skills.json'), JSON.stringify({
        version: 1,
        policy: {
          waivedRecommendedSkills: [
            {
              id: 'mcp-chrome-devtools',
              reason: 'Chrome DevTools MCP is provided by the host agent profile in interactive runs.',
              expiresAt: '2026-12-31',
            },
          ],
        },
      }, null, 2), 'utf-8')

      const report = inspectWorkflowSkills({
        projectDir,
        homeDir,
        env: { SCALE_MCP_CHROME_DEVTOOLS: undefined },
        commandExists: () => false,
        resolveCommandPath: () => null,
      })

      expect(report.missingByReadiness.recommended).not.toContain('mcp-chrome-devtools')
      expect(report.waivedByReadiness.recommended).toContain('mcp-chrome-devtools')
      expect(report.skills.find(skill => skill.id === 'mcp-chrome-devtools')).toMatchObject({
        installed: false,
        status: 'waived',
        waiverExpiresAt: '2026-12-31',
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
