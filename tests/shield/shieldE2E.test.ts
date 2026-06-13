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
