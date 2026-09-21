import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { PolicyCompiler } from '../../src/shield/PolicyCompiler.js'
import { shouldPatchShieldSettings } from '../../src/cli/shieldCommands.js'

const dirs: string[] = []

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function runHook(projectDir: string, input: object): { exitCode: number; stderr: string; stdout: string } {
  const hookPath = join(projectDir, '.claude', 'hooks', 'shield-pre-tool.js')
  return runHookScript(hookPath, input)
}

function runHookScript(hookPath: string, input: object): { exitCode: number; stderr: string; stdout: string } {
  const result = spawnSync('node', [hookPath, JSON.stringify(input)], {
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

describe('Shield E2E', () => {
  it('compiles default policy and generates hook scripts', () => {
    const dir = makeDir('shield-e2e-compile-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    const output = compiler.compile(dir)

    expect(output.hooks.length).toBeGreaterThan(0)
    expect(output.policyHash).toBeTruthy()

    // Combined hook must exist
    const combinedPath = join(dir, '.claude', 'hooks', 'shield-pre-tool.js')
    expect(existsSync(combinedPath)).toBe(true)

    // Hook content must contain policy hash
    const content = readFileSync(combinedPath, 'utf-8')
    expect(content).toContain(output.policyHash)
  })

  it('blocks rm -rf command via subprocess', () => {
    const dir = makeDir('shield-e2e-rmrf-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHook(dir, {
      session_id: 'test',
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/data' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('SCALE SHIELD BLOCKED')
  })

  it('blocks git push --force via subprocess', () => {
    const dir = makeDir('shield-e2e-gitforce-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHook(dir, {
      session_id: 'test',
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'git push --force origin main' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('SCALE SHIELD BLOCKED')
  })

  it('blocks DROP TABLE via subprocess', () => {
    const dir = makeDir('shield-e2e-drop-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHook(dir, {
      session_id: 'test',
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'DROP TABLE users' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('SCALE SHIELD BLOCKED')
  })

  it('blocks Write to .scale/ path via subprocess', () => {
    const dir = makeDir('shield-e2e-write-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHook(dir, {
      session_id: 'test',
      cwd: dir,
      tool_name: 'Write',
      tool_input: { file_path: '.scale/policy.yaml' },
    })

    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('SCALE SHIELD BLOCKED')
  })

  it('allows safe commands via subprocess', () => {
    const dir = makeDir('shield-e2e-safe-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const safeInputs = [
      { tool_name: 'Bash', tool_input: { command: 'npm test' } },
      { tool_name: 'Bash', tool_input: { command: 'git status' } },
      { tool_name: 'Bash', tool_input: { command: 'ls -la' } },
      { tool_name: 'Read', tool_input: { file_path: 'src/index.ts' } },
      { tool_name: 'Write', tool_input: { file_path: 'src/index.ts' } },
    ]

    for (const input of safeInputs) {
      const result = runHook(dir, { session_id: 'test', cwd: dir, ...input })
      expect(result.exitCode).toBe(0)
    }
  })

  it('warns instead of silently skipping unreadable gate state', () => {
    const dir = makeDir('shield-e2e-gate-state-warn-')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    mkdirSync(join(dir, '.hook-state'), { recursive: true })
    writeFileSync(join(dir, '.hook-state', 'Stop.json'), '{not-json', 'utf-8')

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHook(dir, {
      session_id: 'test',
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "test"' },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('SCALE SHIELD WARN')
    expect(result.stderr).toContain('Gate state check skipped')
  })

  it('warns instead of silently ignoring hook state write failures', () => {
    const dir = makeDir('shield-e2e-state-write-warn-')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    const cwdFile = join(dir, 'not-a-directory')
    writeFileSync(cwdFile, 'file cwd', 'utf-8')

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHook(dir, {
      session_id: 'test',
      cwd: cwdFile,
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('SCALE SHIELD WARN')
    expect(result.stderr).toContain('Hook state write skipped')
  })

  it('warns instead of silently ignoring invalid custom rule patterns', () => {
    const dir = makeDir('shield-e2e-custom-pattern-warn-')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'policy.yaml'), `version: 1
rules:
  - id: custom-invalid
    description: Invalid custom regex
    hookType: PreToolUse
    matcher: Bash
    action: block
    conditions:
      - type: custom
        pattern: [
        message: invalid
settings:
  blockMode: strict
`)

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = runHookScript(join(dir, '.claude', 'hooks', 'shield-custom-invalid.js'), {
      session_id: 'test',
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    })

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('SCALE SHIELD WARN')
    expect(result.stderr).toContain('Invalid custom rule pattern ignored')
  })

  it('verify detects tampered hook script', () => {
    const dir = makeDir('shield-e2e-tamper-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    const output = compiler.compile(dir)

    // Tamper with the hook — replace the policy hash to simulate tampering
    const hookPath = join(dir, '.claude', 'hooks', 'shield-pre-tool.js')
    const original = readFileSync(hookPath, 'utf-8')
    writeFileSync(hookPath, original.replace(output.policyHash, 'TAMPERED0000'), 'utf-8')

    const result = compiler.verify(dir)
    expect(result.valid).toBe(false)
    expect(result.mismatches.length).toBeGreaterThan(0)
  })

  it('verify passes for unmodified hook', () => {
    const dir = makeDir('shield-e2e-verify-')
    mkdirSync(join(dir, '.scale'), { recursive: true })

    const compiler = new PolicyCompiler()
    compiler.compile(dir)

    const result = compiler.verify(dir)
    expect(result.valid).toBe(true)
    expect(result.mismatches).toEqual([])
  })

  it('patches settings idempotently without duplicate shield hook registrations', () => {
    const dir = makeDir('shield-e2e-settings-')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Write|Edit', command: 'bash scripts/hooks/check-tdd.sh', timeout: 3000 },
          { type: 'command', command: 'node .claude/hooks/shield-pre-tool.js', timeout: 5000 },
          { type: 'command', command: 'node .claude/hooks/shield-pre-tool.js', timeout: 5000 },
        ],
      },
    }, null, 2), 'utf-8')

    const compiler = new PolicyCompiler()
    const output = compiler.compile(dir)
    compiler.writeSettingsPatches(output)
    compiler.writeSettingsPatches(output)

    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'))
    const preToolHooks = settings.hooks.PreToolUse as Array<Record<string, unknown>>
    const shieldHooks = preToolHooks.filter(hook => String(hook.command ?? '').includes('shield-pre-tool'))
    expect(shieldHooks).toHaveLength(1)
    expect(preToolHooks.some(hook => hook.command === 'bash scripts/hooks/check-tdd.sh')).toBe(true)
  })

  it('recognizes no-patch flag variants from CLI args', () => {
    expect(shouldPatchShieldSettings({})).toBe(true)
    expect(shouldPatchShieldSettings({ 'no-patch': true })).toBe(false)
    expect(shouldPatchShieldSettings({ noPatch: true })).toBe(false)
    expect(shouldPatchShieldSettings({ noPatch: 'true' })).toBe(false)
    expect(shouldPatchShieldSettings({ patch: false })).toBe(false)
    expect(shouldPatchShieldSettings({ patch: 'false' })).toBe(false)
    expect(shouldPatchShieldSettings({ 'no-patch': false, noPatch: true })).toBe(false)
  })

  it('compiles custom policy.yaml with extra rules', () => {
    const dir = makeDir('shield-e2e-custom-')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'policy.yaml'), `version: 1
rules:
  - id: custom-block-wget
    description: Block wget
    hookType: PreToolUse
    matcher: Bash
    action: block
    conditions:
      - type: dangerous_command
        message: wget is not allowed
settings:
  blockMode: strict
`)

    const compiler = new PolicyCompiler()
    const output = compiler.compile(dir)

    expect(output.hooks.length).toBeGreaterThan(0)
    // The combined hook should include the custom rule's condition
    const combinedPath = join(dir, '.claude', 'hooks', 'shield-pre-tool.js')
    const content = readFileSync(combinedPath, 'utf-8')
    expect(content).toContain('strict')
  })
})

describe('Shield Stop hook — dirty worktree', () => {
  function makeGitRepo(prefix: string): string {
    const dir = makeDir(prefix)
    mkdirSync(join(dir, '.scale'), { recursive: true })
    const git = (args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8' })
    git(['init', '-q'])
    git(['config', 'user.email', 'test@example.com'])
    git(['config', 'user.name', 'Test'])
    writeFileSync(join(dir, 'README.md'), '# repo\n', 'utf-8')
    git(['add', 'README.md'])
    git(['commit', '-qm', 'chore: init'])
    return dir
  }

  /** Commit the compiled .scale/.claude baseline so only the change under test stays dirty. */
  function commitBaseline(dir: string): void {
    spawnSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf-8' })
    spawnSync('git', ['commit', '-qm', 'chore: baseline'], { cwd: dir, encoding: 'utf-8' })
  }

  function runStopHook(projectDir: string, cwd = projectDir) {
    const hookPath = join(projectDir, '.claude', 'hooks', 'shield-require-clean-worktree.js')
    return runHookScript(hookPath, { tool_name: 'Stop', cwd })
  }

  it('registers the Stop hook in settings while keeping PreToolUse intact', () => {
    const dir = makeGitRepo('shield-stop-register-')
    mkdirSync(join(dir, '.claude'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }, null, 2), 'utf-8')
    const compiler = new PolicyCompiler()
    compiler.writeSettingsPatches(compiler.compile(dir))

    const settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'))
    expect(Array.isArray(settings.hooks.PreToolUse)).toBe(true)
    expect(settings.hooks.PreToolUse[0].command).toContain('shield-pre-tool.js')
    expect(Array.isArray(settings.hooks.Stop)).toBe(true)
    expect(settings.hooks.Stop[0].command).toContain('shield-require-clean-worktree.js')

    // Idempotent: compiling again must not duplicate the Stop entries.
    compiler.writeSettingsPatches(compiler.compile(dir))
    const again = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf-8'))
    expect(again.hooks.Stop).toHaveLength(1)
  })

  it('warns on a dirty worktree without failing the session (warn mode)', () => {
    const dir = makeGitRepo('shield-stop-dirty-')
    new PolicyCompiler().compile(dir)
    commitBaseline(dir)
    writeFileSync(join(dir, 'README.md'), '# changed\n', 'utf-8')

    const result = runStopHook(dir)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('[SCALE SHIELD WARN]')
    expect(result.stderr).toContain('Uncommitted changes detected')
    expect(result.stderr).toContain('README.md')
    expect(result.stderr).not.toContain('[SCALE SHIELD BLOCKED]')
  })

  it('stays silent once the worktree is committed', () => {
    const dir = makeGitRepo('shield-stop-clean-')
    new PolicyCompiler().compile(dir)
    writeFileSync(join(dir, 'README.md'), '# changed\n', 'utf-8')
    commitBaseline(dir)

    const result = runStopHook(dir)
    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe('')
  })

  it('ignores allowlisted tool artifacts so they never block session end', () => {
    const dir = makeGitRepo('shield-stop-allow-')
    new PolicyCompiler().compile(dir)
    commitBaseline(dir)
    mkdirSync(join(dir, 'output'), { recursive: true })
    writeFileSync(join(dir, 'output', 'report.json'), '{}\n', 'utf-8')
    mkdirSync(join(dir, '.workbuddy'), { recursive: true })
    writeFileSync(join(dir, '.workbuddy', 'state.json'), '{}\n', 'utf-8')

    const result = runStopHook(dir)
    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe('')
  })

  it('reports staged-but-uncommitted changes as dirty', () => {
    const dir = makeGitRepo('shield-stop-staged-')
    new PolicyCompiler().compile(dir)
    commitBaseline(dir)
    writeFileSync(join(dir, 'README.md'), '# staged change\n', 'utf-8')
    spawnSync('git', ['add', 'README.md'], { cwd: dir, encoding: 'utf-8' })

    const result = runStopHook(dir)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('Uncommitted changes detected')
  })

  it('fails open outside a git repository', () => {
    const dir = makeDir('shield-stop-nogit-')
    mkdirSync(join(dir, '.scale'), { recursive: true })
    new PolicyCompiler().compile(dir)

    const result = runStopHook(dir)
    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain('Uncommitted changes detected')
  })
})
