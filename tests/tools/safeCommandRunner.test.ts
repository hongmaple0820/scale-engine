import { describe, expect, it } from 'vitest'
import { parseCommandLine, runSafeCommand } from '../../src/tools/SafeCommandRunner.js'

describe('SafeCommandRunner', () => {
  it('parses quoted argv without invoking a shell', () => {
    expect(parseCommandLine('node -e "process.stdout.write(String(40 + 2))"')).toEqual({
      file: 'node',
      args: ['-e', 'process.stdout.write(String(40 + 2))'],
    })
  })

  it('runs ordinary commands without shell semantics', async () => {
    const result = await runSafeCommand('node -e "process.stdout.write(String(40 + 2))"', { timeout: 10_000 })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('42')
  })

  it('blocks unquoted shell metacharacters by default', async () => {
    await expect(runSafeCommand('node -v && node -e "process.exit(9)"')).rejects.toThrow('Shell metacharacter "&" is not allowed')
  })

  it('can ignore the env-based shell override when the caller disables it', async () => {
    process.env.SCALE_ALLOW_SHELL_COMMANDS = '1'
    try {
      await expect(
        runSafeCommand('node -v && node -e "process.exit(9)"', { allowShellFromEnv: false }),
      ).rejects.toThrow('Shell metacharacter "&" is not allowed')
    } finally {
      delete process.env.SCALE_ALLOW_SHELL_COMMANDS
    }
  })
})
