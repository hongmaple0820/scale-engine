import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createExistingProjectOnboardingPlan,
  renderExistingProjectOnboardingMarkdown,
} from '../../src/product/index.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.length = 0
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-existing-project-'))
  tempDirs.push(dir)
  return dir
}

function writeProjectFile(root: string, filePath: string, content: string): void {
  const fullPath = join(root, filePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

describe('existing project onboarding', () => {
  it('creates a codebase map, planning docs, and risk register for a legacy project', () => {
    const root = makeTempDir()
    writeProjectFile(root, 'package.json', '{"scripts":{"test":"vitest"}}')
    writeProjectFile(root, 'README.md', '# Legacy Demo')
    writeProjectFile(root, 'src/main.ts', 'export function main() { return "ok" }')
    writeProjectFile(root, 'src/modules/auth/controller.ts', 'export class AuthController {}')
    writeProjectFile(root, 'src/modules/auth/service.ts', 'export class AuthService {}')
    writeProjectFile(root, 'src/legacy/report.ts', 'export function oldReport() { return true }')
    writeProjectFile(root, 'tests/auth.test.ts', 'import { expect, it } from "vitest"; it("works", () => expect(true).toBe(true))')

    const plan = createExistingProjectOnboardingPlan({
      projectDir: root,
      projectName: 'LegacyDemo',
      mode: 'legacy',
      maxFiles: 50,
    })

    expect(plan.version).toBe('existing-project-onboarding-plan-v1')
    expect(plan.projectName).toBe('LegacyDemo')
    expect(plan.inventory.packageFiles).toContain('package.json')
    expect(plan.inventory.docs).toContain('README.md')
    expect(plan.inventory.tests).toContain('tests/auth.test.ts')
    expect(plan.inventory.entrypoints).toContain('src/main.ts')
    expect(plan.inventory.moduleCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/modules/auth/' }),
    ]))
    expect(plan.riskRegister).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy-hotspots-present', severity: 'high' }),
    ]))
    expect(plan.generatedFiles.map(file => file.path)).toEqual([
      'docs/project/codebase-map.md',
      'docs/project/project-plan.md',
      'docs/project/module-boundaries.md',
      'docs/project/legacy-risk-register.md',
      'docs/project/development-guide.md',
    ])
    expect(plan.generatedFiles.find(file => file.path.endsWith('codebase-map.md'))?.content)
      .toContain('src/modules/auth/controller.ts')
  })

  it('renders a concise onboarding summary', () => {
    const root = makeTempDir()
    writeProjectFile(root, 'go.mod', 'module example.com/demo')
    writeProjectFile(root, 'cmd/server/main.go', 'package main')

    const plan = createExistingProjectOnboardingPlan({
      projectDir: root,
      projectName: 'GoDemo',
      mode: 'mature',
    })
    const markdown = renderExistingProjectOnboardingMarkdown(plan)

    expect(markdown).toContain('# Existing Project Onboarding: GoDemo')
    expect(markdown).toContain('- language hints: go')
    expect(markdown).toContain('docs/project/project-plan.md')
  })

  it('rejects unknown onboarding modes', () => {
    const root = makeTempDir()
    writeProjectFile(root, 'package.json', '{}')

    expect(() => createExistingProjectOnboardingPlan({
      projectDir: root,
      mode: 'rewrite',
    })).toThrow('Invalid existing project onboarding mode')
  })
})
