import { afterEach, describe, expect, it } from 'vitest'
import { execa } from 'execa'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

async function runScale(args: string[], scaleDir: string, projectDir: string) {
  return execa('node', ['--import', 'tsx', 'src/api/cli.ts', ...args], {
    env: {
      ...process.env,
      SCALE_DIR: scaleDir,
      SCALE_PROJECT_DIR: projectDir,
      SCALE_LOG_LEVEL: undefined,
    },
    reject: false,
  })
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

function writeSkill(projectDir: string, skillId: string) {
  const dir = join(projectDir, '.agents', 'skills', skillId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${skillId}\n---\n# ${skillId}\n`, 'utf-8')
}

function writeFrontendProject(projectDir: string) {
  mkdirSync(join(projectDir, 'src', 'pages'), { recursive: true })
  writeFileSync(join(projectDir, 'package.json'), '{"scripts":{"test":"vitest"}}\n', 'utf-8')
  writeFileSync(join(projectDir, 'src', 'pages', 'upload.tsx'), 'export function UploadPage() { return <main /> }\n', 'utf-8')
}

describe('skill radar CLI', () => {
  it('recommends composable UI and browser capabilities with evidence requirements', async () => {
    const scaleDir = makeDir('scale-skill-radar-scale-')
    const projectDir = makeDir('scale-skill-radar-project-')
    writeFrontendProject(projectDir)
    writeSkill(projectDir, 'frontend-design')
    writeSkill(projectDir, 'ui-ux-pro-max')
    writeSkill(projectDir, 'web-access')

    const result = await runScale([
      'skill',
      'radar',
      '--task',
      'Design upload UI and run browser E2E checks',
      '--files',
      'src/pages/upload.tsx',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      projectDir: string
      detectedDomains: Array<{ domain: string }>
      recommendations: Array<{ id: string; confidence: number; safetyLevel: string; action: string; requiredEvidence: string[] }>
      requiredEvidence: string[]
    }>(result.stdout)
    expect(report.ok).toBe(true)
    expect(report.projectDir).toBe(projectDir)
    expect(report.detectedDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'ui' }),
      expect.objectContaining({ domain: 'browserAutomation' }),
    ]))
    expect(report.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'frontend-design', safetyLevel: 'trusted' }),
      expect.objectContaining({ id: 'ui-ux-pro-max', safetyLevel: 'review-required' }),
      expect.objectContaining({ id: 'web-access', safetyLevel: 'restricted' }),
    ]))
    expect(report.recommendations.find(item => item.id === 'frontend-design')?.confidence).toBeGreaterThanOrEqual(0.7)
    expect(report.requiredEvidence).toEqual(expect.arrayContaining(['screenshot', 'visual-review', 'console-summary']))
  }, 120_000)

  it('blocks desktop automation by default through tool policy', async () => {
    const scaleDir = makeDir('scale-skill-radar-scale-')
    const projectDir = makeDir('scale-skill-radar-project-')

    const result = await runScale([
      'skill',
      'radar',
      '--task',
      'Automate WPS desktop workflow with CUA',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(1)
    const report = parseJson<{
      ok: boolean
      recommendations: Array<{ id: string; safetyLevel: string; action: string; policyEnabled: boolean; fallback: string }>
      fallbacks: string[]
    }>(result.stdout)
    expect(report.ok).toBe(false)
    expect(report.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'cua',
        safetyLevel: 'blocked',
        action: 'blocked',
        policyEnabled: false,
      }),
    ]))
    expect(report.fallbacks.join('\n')).toContain('manual operator checklist')
  }, 120_000)

  it('recommends planning and memory capabilities with attribution-aware evidence', async () => {
    const scaleDir = makeDir('scale-skill-radar-scale-')
    const projectDir = makeDir('scale-skill-radar-project-')

    const result = await runScale([
      'skill',
      'radar',
      '--task',
      'Use long-running planning with findings progress and persistent memory knowledge recall through gbrain',
      '--json',
    ], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      ok: boolean
      detectedDomains: Array<{ domain: string }>
      recommendations: Array<{ id: string; category: string; safetyLevel: string; requiredEvidence: string[] }>
      requiredEvidence: string[]
    }>(result.stdout)
    expect(report.ok).toBe(true)
    expect(report.detectedDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'planning' }),
      expect.objectContaining({ domain: 'memory' }),
    ]))
    expect(report.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'planning-with-files', category: 'planning', safetyLevel: 'review-required' }),
      expect.objectContaining({ id: 'gbrain', category: 'memory', safetyLevel: 'review-required' }),
    ]))
    expect(report.requiredEvidence).toEqual(expect.arrayContaining([
      'task-plan',
      'plan-attestation',
      'memory-provider-health',
      'privacy-boundary',
      'data-retention-policy',
    ]))
  }, 120_000)

  it('adds supply-chain safety details to skill doctor output', async () => {
    const scaleDir = makeDir('scale-skill-radar-scale-')
    const projectDir = makeDir('scale-skill-radar-project-')

    const result = await runScale(['skill', 'doctor', '--supply-chain', '--json'], scaleDir, projectDir)

    expect(result.exitCode).toBe(0)
    const report = parseJson<{
      installation: { total: number }
      supplyChain: {
        ok: boolean
        evaluated: number
        warnings: number
        entries: Array<{ id: string; requiredChecks: string[] }>
      }
    }>(result.stdout)
    expect(report.installation.total).toBeGreaterThan(0)
    expect(report.supplyChain.ok).toBe(true)
    expect(report.supplyChain.evaluated).toBeGreaterThan(0)
    expect(report.supplyChain.warnings).toBeGreaterThan(0)
    expect(report.supplyChain.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'frontend-design',
        requiredChecks: expect.arrayContaining(['pin-source-revision']),
      }),
    ]))
  }, 120_000)
})
