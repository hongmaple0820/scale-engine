import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from 'citty'
import { setupCommand } from '../../src/cli/initConfigCommands.js'
import { ensureGitInitialized, finalizeGitInitialization, inspectGitGuardian } from '../../src/setup/GitGuardian.js'
import { runSetupWizard } from '../../src/setup/SetupWizard.js'
import { verifySetup } from '../../src/setup/SetupVerification.js'

vi.mock('../../src/setup/GitGuardian.js', () => ({ ensureGitInitialized: vi.fn(), finalizeGitInitialization: vi.fn(), inspectGitGuardian: vi.fn() }))
vi.mock('../../src/setup/SetupWizard.js', () => ({ runSetupWizard: vi.fn() }))
vi.mock('../../src/setup/SetupVerification.js', () => ({ verifySetup: vi.fn() }))
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.clearAllMocks()
  process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(runSetupWizard).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof runSetupWizard>>)
  vi.mocked(verifySetup).mockResolvedValue({ ok: true } as Awaited<ReturnType<typeof verifySetup>>)
  vi.mocked(inspectGitGuardian).mockReturnValue({ repository: { status: 'none' }, subrepos: { warnings: [] } } as ReturnType<typeof inspectGitGuardian>)
  vi.mocked(ensureGitInitialized).mockReturnValue({ ok: true, initialized: true, warnings: [] } as ReturnType<typeof ensureGitInitialized>)
  vi.mocked(finalizeGitInitialization).mockImplementation((_dir, report) => report)
})
afterEach(() => { vi.restoreAllMocks(); process.exitCode = originalExitCode })

describe('setup Git opt-in contract', () => {
  it('plan mode only inspects and never initializes', async () => {
    await runCommand(setupCommand, { rawArgs: ['--dir', '.', '--pack', 'memory', '--json'] })
    expect(inspectGitGuardian).toHaveBeenCalledOnce()
    expect(ensureGitInitialized).not.toHaveBeenCalled()
    expect(finalizeGitInitialization).not.toHaveBeenCalled()
  })
  it('verify mode performs no GitGuardian operations', async () => {
    await runCommand(setupCommand, { rawArgs: ['--dir', '.', '--verify', '--json'] })
    expect(verifySetup).toHaveBeenCalledOnce()
    expect(ensureGitInitialized).not.toHaveBeenCalled()
    expect(inspectGitGuardian).not.toHaveBeenCalled()
  })
  it('explicit apply prepares Git before wizard, then finalizes only .gitignore', async () => {
    await runCommand(setupCommand, { rawArgs: ['--dir', '.', '--apply', '--pack', 'memory', '--json'] })
    expect(ensureGitInitialized).toHaveBeenCalledWith(expect.any(String), { commit: false, nestedStrategy: 'reuse' })
    expect(vi.mocked(ensureGitInitialized).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(runSetupWizard).mock.invocationCallOrder[0]!)
    expect(vi.mocked(runSetupWizard).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(finalizeGitInitialization).mock.invocationCallOrder[0]!)
    expect(finalizeGitInitialization).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ok: true }), [])
  })
  it('--no-git overrides explicit apply', async () => {
    await runCommand(setupCommand, { rawArgs: ['--dir', '.', '--apply', '--no-git', '--json'] })
    expect(ensureGitInitialized).not.toHaveBeenCalled()
    expect(inspectGitGuardian).not.toHaveBeenCalled()
    expect(finalizeGitInitialization).not.toHaveBeenCalled()
  })
  it('broken repository prevents executing the wizard', async () => {
    vi.mocked(ensureGitInitialized).mockReturnValue({ ok: false, warnings: ['broken'], message: 'broken' } as ReturnType<typeof ensureGitInitialized>)
    await runCommand(setupCommand, { rawArgs: ['--dir', '.', '--apply', '--json'] })
    expect(runSetupWizard).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})
