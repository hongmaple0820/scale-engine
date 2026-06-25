#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const smokeRoot = mkdtempSync(join(tmpdir(), 'scale-package-smoke-'))
const scaleDir = join(smokeRoot, '.scale')

const requiredPackFiles = [
  'dist/api/cli.js',
  'dist/cli/gateInlineCommands.js',
  'dist/cli/metaGovernanceCommands.js',
  'dist/workflow/gates/GateSystem.js',
  'dist/workflow/gates/MetaGovernanceGates.js',
]

try {
  verifyDistExists()
  verifyPackContents()
  verifyCliEntrypoints()
  console.log('[scale-engine] package smoke passed')
} catch (error) {
  console.error(`[scale-engine] package smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(smokeRoot, { recursive: true, force: true })
}

function verifyDistExists() {
  const cliEntry = join(repoRoot, 'dist', 'api', 'cli.js')
  if (!existsSync(cliEntry)) {
    throw new Error('dist/api/cli.js is missing; run npm run build before package smoke')
  }
}

function verifyPackContents() {
  const result = run('npm pack dry-run', 'npm', ['pack', '--dry-run', '--json'], {
    timeoutMs: 60_000,
    shell: process.platform === 'win32',
  })
  let packEntries
  try {
    packEntries = JSON.parse(result.stdout)
  } catch {
    throw new Error(`npm pack --dry-run --json returned invalid JSON: ${summarize(result.stdout || result.stderr)}`)
  }
  const files = new Set(
    (packEntries?.[0]?.files ?? [])
      .map(file => String(file.path ?? '').replace(/\\/g, '/'))
      .filter(Boolean),
  )
  const missing = requiredPackFiles.filter(file => !files.has(file))
  if (missing.length > 0) {
    throw new Error(`npm pack is missing required files: ${missing.join(', ')}`)
  }
}

function verifyCliEntrypoints() {
  const env = {
    ...process.env,
    SCALE_DIR: scaleDir,
    SCALE_PROJECT_DIR: smokeRoot,
    SCALE_LOG_LEVEL: '',
  }
  const cli = join(repoRoot, 'dist', 'api', 'cli.js')

  run('meta-governance help', process.execPath, [cli, 'meta-governance', '--help'], {
    timeoutMs: 5_000,
    env,
  })
  run('gate before-stop help', process.execPath, [cli, 'gate', 'before-stop', '--help'], {
    timeoutMs: 5_000,
    env,
  })
  run('gate before-stop hook-safe', process.execPath, [cli, 'gate', 'before-stop', '--session-id', 'package-smoke', '--hook-safe'], {
    timeoutMs: 5_000,
    env,
  })
  assertNoScaleDb('gate before-stop hook-safe')

  const meta = run('meta-governance json', process.execPath, [cli, 'meta-governance', '--scale-dir', scaleDir, '--json'], {
    allowedExitCodes: [0, 1],
    timeoutMs: 10_000,
    env,
  })
  try {
    JSON.parse(meta.stdout)
  } catch {
    throw new Error(`meta-governance --json returned invalid JSON: ${summarize(meta.stdout || meta.stderr)}`)
  }
  assertNoScaleDb('meta-governance')
}

function assertNoScaleDb(label) {
  const dbPath = join(scaleDir, 'scale.db')
  if (existsSync(dbPath)) {
    throw new Error(`${label} initialized scale.db; hook-safe/package smoke commands must not start the full artifact engine`)
  }
}

function run(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: options.timeoutMs ?? 15_000,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: options.shell ?? false,
  })
  if (result.error) {
    throw new Error(`${label} failed: ${result.error.message}`)
  }
  const allowed = options.allowedExitCodes ?? [0]
  if (!allowed.includes(result.status ?? 1)) {
    throw new Error(`${label} exited ${result.status}: ${summarize(result.stderr || result.stdout)}`)
  }
  return result
}

function summarize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
}
