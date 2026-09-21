import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAdapter } from '../../src/adapters/index.js'
import { ensureGitInitialized, finalizeGitInitialization, type GitInitReport } from '../../src/setup/GitGuardian.js'
import { runCustomerInstall } from '../../src/setup/CustomerInstall.js'

vi.mock('../../src/setup/GitGuardian.js', () => ({ ensureGitInitialized: vi.fn(), finalizeGitInitialization: vi.fn() }))
vi.mock('../../src/adapters/index.js', () => ({ createAdapter: vi.fn(), SUPPORTED_AGENTS: ['codex'] }))
vi.mock('../../src/api/quickstart.js', () => ({
  classifyProject: () => ({ language: 'typescript', recommendedPack: 'standard', recommendedProfile: 'standard' }),
  detectPlatform: () => ({}), autoDetectGovernancePack: () => 'standard',
}))
vi.mock('../../src/workflow/GovernanceTemplates.js', () => ({ writeGovernanceTemplates: () => ({ created: [], skipped: [] }) }))
vi.mock('../../src/setup/SetupVerification.js', () => ({ verifySetup: vi.fn() }))
vi.mock('../../src/setup/SetupWizard.js', () => ({ runSetupWizard: vi.fn() }))
vi.mock('../../src/cli/engineBootstrap.js', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  return {
    ensureDir: (dir: string) => fs.mkdirSync(dir, { recursive: true }),
    governanceModeFromScenario: () => 'standard',
    writeConfigYaml: (dir: string) => {
      const file = path.join(dir, '.scale', 'config.yaml')
      fs.writeFileSync(file, 'version: 1\n')
      return file
    },
  }
})

let root: string
let dir: string
let counter = 0
let gitReport: GitInitReport
const calls: string[] = []
beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'scale-install-git-contract-')) })
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })
beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  dir = join(root, String(++counter))
  mkdirSync(dir)
  gitReport = { ok: true, status: 'none', initialized: true, reused: false, committed: false, warnings: [], nextSteps: [], message: 'ready' }
  vi.mocked(ensureGitInitialized).mockImplementation(() => {
    calls.push('git')
    expect(existsSync(join(dir, '.scale'))).toBe(false)
    return gitReport
  })
  vi.mocked(finalizeGitInitialization).mockImplementation((projectDir, report) => {
    calls.push('commit')
    expect(projectDir).toBe(dir)
    expect(report).toBe(gitReport)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    return Object.assign(report, { committed: true, commit: 'fixture-commit' })
  })
  vi.mocked(createAdapter).mockReturnValue({
    init: async () => {
      calls.push('adapter')
      mkdirSync(join(dir, '.scale', 'empty'), { recursive: true })
      const doc = join(dir, 'AGENTS.md')
      writeFileSync(doc, '# Fixture\n')
      return { settingsPath: '', knowledgeDocPath: doc, scaleDir: join(dir, '.scale'), created: [join(dir, '.scale', 'empty'), doc], skipped: [] }
    },
  } as unknown as ReturnType<typeof createAdapter>)
})
const options = () => ({ projectDir: dir, agent: 'codex', interactive: false, skipDeps: true, skipVerify: true, lang: 'en' as const })

describe('customer install Git lifecycle integration', () => {
  it('prepares Git before files, then commits only explicit relative regular files', async () => {
    const report = await runCustomerInstall(options())
    expect(calls).toEqual(['git', 'adapter', 'commit'])
    expect(ensureGitInitialized).toHaveBeenCalledWith(dir, { commit: false, nestedStrategy: 'reuse' })
    const files = vi.mocked(finalizeGitInitialization).mock.calls[0]![2]
    expect(files).toEqual(expect.arrayContaining(['AGENTS.md', '.scale/config.yaml', '.scale/thresholds.json', '.scale/agent-language.md']))
    expect(files).not.toContain('.scale/empty')
    expect(report.git?.committed).toBe(true)
    expect(report.steps.every(step => step.total === 8)).toBe(true)
  })
  it('--no-git skips detection, initialization and commit', async () => {
    const report = await runCustomerInstall({ ...options(), noGit: true })
    expect(calls).toEqual(['adapter'])
    expect(report.git).toBeUndefined()
    expect(ensureGitInitialized).not.toHaveBeenCalled()
    expect(finalizeGitInitialization).not.toHaveBeenCalled()
  })
  it('existing repositories are not committed and warnings propagate', async () => {
    Object.assign(gitReport, { status: 'repo', initialized: false, reused: true, warnings: ['dirty repository'] })
    const report = await runCustomerInstall(options())
    expect(finalizeGitInitialization).not.toHaveBeenCalled()
    expect(report.warnings).toContain('dirty repository')
  })
  it('broken Git stops installation before generated files exist', async () => {
    Object.assign(gitReport, { ok: false, initialized: false, status: 'broken', warnings: ['broken fixture'] })
    await expect(runCustomerInstall(options())).rejects.toThrow('broken fixture')
    expect(createAdapter).not.toHaveBeenCalled()
    expect(existsSync(join(dir, '.scale'))).toBe(false)
  })
  it('passes explicit nested init without granting parent modification', async () => {
    await runCustomerInstall({ ...options(), gitInitNested: true })
    expect(ensureGitInitialized).toHaveBeenCalledWith(dir, { commit: false, nestedStrategy: 'init' })
  })
  it('commit failure preserves successful installation with actionable warning', async () => {
    vi.mocked(finalizeGitInitialization).mockImplementation((_dir, report) => Object.assign(report, {
      committed: false, warnings: ['identity missing'], nextSteps: ['configure Git identity and review the index'],
    }))
    const report = await runCustomerInstall(options())
    expect(report.ok).toBe(true)
    expect(report.git?.committed).toBe(false)
    expect(report.warnings).toContain('identity missing')
    expect(report.nextSteps).toContain('configure Git identity and review the index')
  })
})
