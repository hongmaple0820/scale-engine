import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, runCommand } from 'citty'
import { gitCommand } from '../../src/cli/gitCommands.js'
import { installCommand } from '../../src/cli/installCommands.js'
import { addSubrepo, ensureGitInitialized, inspectGitGuardian } from '../../src/setup/GitGuardian.js'
import { runCustomerInstall } from '../../src/setup/CustomerInstall.js'

vi.mock('../../src/setup/GitGuardian.js', () => ({
  addSubrepo: vi.fn(), ensureGitInitialized: vi.fn(), inspectGitGuardian: vi.fn(),
}))
vi.mock('../../src/setup/CustomerInstall.js', () => ({ runCustomerInstall: vi.fn() }))

const originalExitCode = process.exitCode
beforeEach(() => {
  vi.clearAllMocks()
  process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

function status(status: 'none' | 'broken' = 'none') {
  return {
    repository: { status, projectDir: '/fixture', ownsRepository: false, message: status },
    subrepos: { configPath: '/fixture/.scale/subrepos.json', mode: 'none' as const, repos: [], warnings: [] },
  }
}
function init(ok = true, committed = true) {
  return { ok, status: 'none' as const, initialized: ok, reused: false, committed,
    warnings: [], nextSteps: [], message: 'fixture' }
}

describe('GitGuardian CLI contracts (no filesystem or Git writes)', () => {
  it('parses --no-git as the negated git flag, not a literal no-git key', () => {
    const parsed = parseArgs(['--no-git', '--json'], installCommand.args!)
    expect(parsed.git).toBe(false)
  })

  it('passes --no-git and nested choice into the installer', async () => {
    vi.mocked(runCustomerInstall).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof runCustomerInstall>>)
    await runCommand(installCommand, { rawArgs: ['--dir', '/fixture', '--no-git', '--git-init-nested', '--json'] })
    expect(runCustomerInstall).toHaveBeenCalledWith(expect.objectContaining({ noGit: true, gitInitNested: true, interactive: false }))
  })

  it('enables Git preparation by default in install', async () => {
    vi.mocked(runCustomerInstall).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof runCustomerInstall>>)
    await runCommand(installCommand, { rawArgs: ['--dir', '/fixture', '--json'] })
    expect(runCustomerInstall).toHaveBeenCalledWith(expect.objectContaining({ noGit: false, gitInitNested: false }))
  })

  it('status returns JSON without initializing a repository', async () => {
    vi.mocked(inspectGitGuardian).mockReturnValue(status())
    await runCommand(gitCommand, { rawArgs: ['status', '--dir', '/fixture', '--json'] })
    expect(inspectGitGuardian).toHaveBeenCalledWith('/fixture')
    expect(ensureGitInitialized).not.toHaveBeenCalled()
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toEqual(status())
  })

  it('broken repository gives a failing exit code even in JSON mode', async () => {
    vi.mocked(inspectGitGuardian).mockReturnValue(status('broken'))
    await runCommand(gitCommand, { rawArgs: ['status', '--dir', '/fixture', '--json'] })
    expect(process.exitCode).toBe(1)
  })

  it('dry run does not call initialization', async () => {
    vi.mocked(inspectGitGuardian).mockReturnValue(status())
    await runCommand(gitCommand, { rawArgs: ['init', '--dir', '/fixture', '--dry-run', '--json'] })
    expect(ensureGitInitialized).not.toHaveBeenCalled()
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toMatchObject({ dryRun: true, wouldInit: true })
  })

  it.each([[false, false], [true, false]])('init reports failure for ok=%s committed=%s', async (ok, committed) => {
    vi.mocked(ensureGitInitialized).mockReturnValue(init(ok, committed))
    await runCommand(gitCommand, { rawArgs: ['init', '--dir', '/fixture', '--json'] })
    expect(process.exitCode).toBe(1)
  })

  it('init passes explicit branch and nested strategy', async () => {
    vi.mocked(ensureGitInitialized).mockReturnValue(init())
    await runCommand(gitCommand, { rawArgs: ['init', '--dir', '/fixture', '--branch', 'dev', '--nested', '--json'] })
    expect(ensureGitInitialized).toHaveBeenCalledWith('/fixture', { defaultBranch: 'dev', nestedStrategy: 'init' })
    expect(process.exitCode).toBe(0)
  })

  it('subrepo --no-clone really disables clone with the parser', async () => {
    vi.mocked(addSubrepo).mockReturnValue({ ok: true, path: 'packages/app', remote: 'https://example.test/app.git', configPath: '', warnings: [], message: 'ok' })
    await runCommand(gitCommand, { rawArgs: ['subrepo', 'add', 'packages/app', 'https://example.test/app.git', '--dir', '/fixture', '--no-clone', '--json'] })
    expect(addSubrepo).toHaveBeenCalledWith('/fixture', { path: 'packages/app', remote: 'https://example.test/app.git', strategy: 'submodule' }, { runSubmoduleAdd: false })
  })

  it('subrepo validation errors stay machine-readable', async () => {
    await runCommand(gitCommand, { rawArgs: ['subrepo', 'add', 'packages/app', 'https://example.test/app.git', '--dir', '/fixture', '--strategy', 'invalid', '--json'] })
    expect(addSubrepo).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0]![0])).toMatchObject({ ok: false })
  })
})
