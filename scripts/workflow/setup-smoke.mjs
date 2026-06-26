#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ensureMirroredGbrainInvocation,
  normalizeGbrainSpawnResult,
  resolveDirectWindowsGbrainInvocation,
  shouldRetryWithMirroredGbrain,
} from './lib/gbrain-runtime.mjs'
import { summarizeCommandOutput } from './lib/report-output.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const options = parseArgs(process.argv.slice(2))
const smokeRoot = options.tempDir
  ? resolve(options.tempDir)
  : mkSmokeRoot()
const projectDir = join(smokeRoot, 'project')
const scaleDir = join(smokeRoot, '.scale')
const homeDir = join(smokeRoot, 'home')
const appDataDir = join(homeDir, 'AppData', 'Roaming')
const localAppDataDir = join(homeDir, 'AppData', 'Local')
const gbrainHomeDir = join(smokeRoot, 'gbrain-home')
const gbrainAuditDir = join(smokeRoot, 'gbrain-audit')
const scaleInvocation = parseCommandLine(options.scaleCommand ?? 'node --import tsx src/api/cli.ts')
const scaleCommand = formatCommand(scaleInvocation.file, scaleInvocation.args)
const headlessSetupIds = 'rtk,gbrain,graphify,codegraph'
const results = []

mkdirSync(projectDir, { recursive: true })
mkdirSync(scaleDir, { recursive: true })
mkdirSync(appDataDir, { recursive: true })
mkdirSync(localAppDataDir, { recursive: true })

try {
  runSetupSmoke()
  writeSummary('passed')
} catch (error) {
  writeSummary('failed', error)
  process.exitCode = 1
} finally {
  if (!options.keepTemp && !options.tempDir) rmSync(smokeRoot, { recursive: true, force: true })
}

function runSetupSmoke() {
  const baseEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: appDataDir,
    LOCALAPPDATA: localAppDataDir,
    SCALE_DIR: scaleDir,
    SCALE_PROJECT_DIR: projectDir,
    SCALE_LOG_LEVEL: '',
    GBRAIN_HOME: gbrainHomeDir,
    GBRAIN_AUDIT_DIR: gbrainAuditDir,
    GBRAIN_NO_BANNER: '1',
  }
  initProject(baseEnv)
  initIsolatedGbrain(baseEnv)

  const init = runJson('scale-init-json', [
    'init',
    '--dir',
    projectDir,
    '--governance-pack',
    'standard',
    '--json',
  ], baseEnv)
  assert(init.ok === true, 'scale init should succeed in a fresh project')
  assert(init.dependencyBootstrapCommand === 'scale setup --pack external-cli --memory-provider gbrain --memory-mode external-first --json', 'scale init should direct users to governed setup with gbrain')
  assertArrayContains(init.workflowCapabilities, ['browser', 'search', 'computer'], 'scale init should record workflow capability defaults')

  const zh = runCommand('bootstrap-ui-zh', ['bootstrap', 'deps', '--dir', projectDir, '--pack', 'ui', '--lang', 'zh'], baseEnv)
  assertIncludes(zh.stdout, 'SCALE 依赖安装计划', 'Chinese bootstrap output should use Chinese title')
  assertIncludes(zh.stdout, '运行时依赖:', 'Chinese bootstrap output should show runtime dependencies')
  assertIncludes(zh.stdout, 'awesome-design-md', 'Chinese bootstrap output should include awesome-design-md')
  assertIncludes(zh.stdout, 'ui-ux-pro-max', 'Chinese bootstrap output should include ui-ux-pro-max')

  const en = runCommand('bootstrap-ui-en', ['bootstrap', 'deps', '--dir', projectDir, '--pack', 'ui', '--lang', 'en'], baseEnv)
  assertIncludes(en.stdout, 'SCALE Dependency Bootstrap', 'English bootstrap output should use English title')
  assertIncludes(en.stdout, 'Runtime dependencies:', 'English bootstrap output should show runtime dependencies')

  const deps = runJson('bootstrap-external-memory-knowledge-json', [
    'bootstrap',
    'deps',
    '--dir',
    projectDir,
    '--pack',
    'external-cli,memory,knowledge',
    '--json',
  ], baseEnv)
  assertArrayContains(deps.runtimeChecks?.map(check => check.id), ['node', 'npm', 'cargo', 'bun', 'python', 'python-installer'], 'dependency plan should report all runtime dependency checks')
  assertArrayContains(deps.items?.map(item => item.id), ['rtk', 'gbrain', 'graphify', 'codegraph', 'lark-cli', 'lark-skills'], 'dependency plan should include governed third-party and Feishu/Lark capabilities')
  assertIncludes(deps.postCheckCommands?.join('\n') ?? '', 'lark-cli,lark-skills', 'default dependency plan should surface Feishu/Lark doctor commands')
  assert(deps.apply === false, 'bootstrap smoke must not run installers')

  const envDoctor = runJson('doctor-env-json', ['doctor', 'env', '--json'], baseEnv)
  assert(envDoctor.ok === true, 'environment doctor should pass when required core commands are available')
  assertArrayContains(envDoctor.checks?.map(check => check.id), ['git', 'npm', 'npx', 'rtk', 'gbrain', 'graphify', 'codegraph'], 'environment doctor should report core and third-party commands')
  assert(envDoctor.checks?.find(check => check.id === 'gbrain')?.status === 'ok', 'environment doctor should validate gbrain when an isolated brain is initialized')

  const gbrainMemory = runJson('setup-memory-gbrain-json', [
    'setup',
    '--dir',
    projectDir,
    '--pack',
    'memory',
    '--memory-provider',
    'gbrain',
    '--memory-mode',
    'external-first',
    '--json',
  ], baseEnv)
  assert(gbrainMemory.memoryProviderSwitch?.provider === 'gbrain', 'setup should switch to gbrain provider')
  assert(gbrainMemory.memoryProviderSwitch?.mode === 'external-first', 'gbrain provider should support external-first mode')
  assert(gbrainMemory.memoryProviderSwitch?.nextOrder?.[0] === 'gbrain', 'gbrain should become the first provider')
  assert(gbrainMemory.memoryProviderSwitch?.previousOrder?.every(provider => provider === 'gbrain'), 'setup memory routing should not include legacy memory providers')
  assert(gbrainMemory.memoryProviderSwitch?.nextOrder?.every(provider => provider === 'gbrain'), 'setup memory routing should remain gbrain-only')
  assert(existsSync(gbrainMemory.memoryProviderSwitch?.path ?? ''), 'setup should write memory provider config')
  assert(gbrainMemory.final?.runtimeChecks?.some(check => check.id === 'bun'), 'memory setup should expose Bun runtime check for gbrain')

  const apply = runJson('setup-governed-apply-json', [
    'setup',
    '--dir',
    projectDir,
    '--pack',
    'external-cli,memory,knowledge',
    '--only',
    headlessSetupIds,
    '--apply',
    '--memory-provider',
    'gbrain',
    '--memory-mode',
    'external-first',
    '--json',
  ], baseEnv)
  assert(apply.final?.ok === true, 'setup apply should succeed for external-cli, memory, and knowledge packs')
  assert(apply.final?.complete === true, 'setup apply should leave the selected packs fully installed')
  assert(apply.final?.summary?.needsInit === 0, 'setup apply should not leave RTK, GBrain, Graphify, or CodeGraph uninitialized')
  assert(apply.memoryProviderSwitch?.provider === 'gbrain', 'setup apply should keep gbrain as the selected provider')
  assert(existsSync(join(projectDir, '.codegraph')), 'setup apply should initialize a CodeGraph index in the target project')
  assert(existsSync(join(projectDir, 'graphify-out', 'graph.json')), 'setup apply should generate a Graphify graph artifact without LLM usage')
  assert(existsSync(join(projectDir, '.git', 'hooks', 'post-commit')), 'setup apply should install the Graphify post-commit hook')
  assert(existsSync(join(projectDir, '.git', 'hooks', 'post-checkout')), 'setup apply should install the Graphify post-checkout hook')
  assert(
    ['installed', 'installed-now'].includes(apply.final?.items?.find(item => item.id === 'rtk')?.status),
    'setup apply should leave RTK in an installed state after Codex initialization',
  )
  assert(
    ['installed', 'installed-now'].includes(apply.final?.items?.find(item => item.id === 'graphify')?.status),
    'setup apply should leave Graphify in an installed state after hook and graph initialization',
  )
  assert((apply.final?.postCheckSummary?.warned ?? 0) === 0, 'setup apply should not leave memory/code post-checks in a warned state')

  const verify = runJson('setup-governed-verify-json', [
    'setup',
    '--verify',
    '--dir',
    projectDir,
    '--pack',
    'external-cli,memory,knowledge',
    '--only',
    headlessSetupIds,
    '--json',
  ], baseEnv)
  assert(verify.ok === true, 'setup verify should pass after governed apply in the isolated home')
  assert((verify.summary?.blockingIssues?.length ?? 0) === 0, 'setup verify should not report any blocking dependency issues after apply')

  const codegraph = runJson('codegraph-status-json', ['codegraph', 'status', '--dir', projectDir, '--json'], baseEnv)
  assertArrayContains(codegraph.providers?.map(provider => provider.id), ['codegraph', 'graphify'], 'codegraph status should expose CodeGraph and Graphify providers')
  assert(codegraph.projectIndexExists === true, 'codegraph status should report the target project index after setup apply')
}

function initProject(env) {
  writeFileSync(join(projectDir, 'AGENTS.md'), '# Setup smoke project\n', 'utf-8')
  writeFileSync(join(projectDir, 'smoke.ts'), 'export const setupSmoke = "ready"\n', 'utf-8')
  const result = spawnStructured('git', ['init'], {
    cwd: projectDir,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  })
  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  results.push({
    name: 'git-init-project',
    command: 'git init',
    exitCode: typeof result.status === 'number' ? result.status : 1,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    stdoutTail: summarizeCommandOutput('git-init-project', 'stdout', stdout),
    stderrTail: summarizeCommandOutput('git-init-project', 'stderr', stderr + (result.error ? `\n${result.error.message}` : '')),
  })
  if (result.status !== 0) {
    throw new Error(`git-init-project failed with exit code ${result.status ?? 1}\n${stderr || stdout}`)
  }
}

function initIsolatedGbrain(env) {
  const startedAt = new Date().toISOString()
  const result = spawnStructured('gbrain', ['init', '--pglite', '--no-embedding'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  })
  const normalized = normalizeGbrainSpawnResult(['init', '--pglite', '--no-embedding'], result)
  const { stdout, stderr, exitCode, timedOut, recoveredTimeout } = normalized
  results.push({
    name: 'gbrain-init-isolated-home',
    command: 'gbrain init --pglite --no-embedding',
    exitCode,
    timedOut,
    recoveredTimeout,
    startedAt,
    endedAt: new Date().toISOString(),
    stdoutTail: summarizeCommandOutput('gbrain-init-isolated-home', 'stdout', stdout),
    stderrTail: summarizeCommandOutput('gbrain-init-isolated-home', 'stderr', stderr),
  })
  if (exitCode !== 0) {
    throw new Error(`gbrain-init-isolated-home failed with exit code ${exitCode}\n${summarizeCommandOutput('gbrain-init-isolated-home', 'stderr', stderr) || summarizeCommandOutput('gbrain-init-isolated-home', 'stdout', stdout)}`)
  }
}

function runJson(name, args, env) {
  const result = runCommand(name, args, env)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(`${name} did not return valid JSON: ${error.message}\n${result.stdout}`)
  }
}

function runCommand(name, args, env) {
  const commandArgs = [...scaleInvocation.args, ...args]
  const commandLine = formatCommand(scaleInvocation.file, commandArgs)
  if (options.verbose) process.stdout.write(`[RUN] ${commandLine}\n`)
  const startedAt = new Date().toISOString()
  const result = spawnStructured(scaleInvocation.file, commandArgs, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  })
  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  const exitCode = typeof result.status === 'number' ? result.status : 1
  const entry = {
    name,
    command: commandLine,
    exitCode,
    startedAt,
    endedAt: new Date().toISOString(),
    stdoutTail: summarizeCommandOutput(name, 'stdout', stdout),
    stderrTail: summarizeCommandOutput(name, 'stderr', stderr + (result.error ? `\n${result.error.message}` : '')),
  }
  results.push(entry)
  if (exitCode !== 0) {
    throw new Error(`${name} failed with exit code ${exitCode}\n${entry.stderrTail || entry.stdoutTail}`)
  }
  return { stdout, stderr, exitCode }
}

function spawnStructured(command, args, options) {
  const direct = resolveDirectWindowsGbrainInvocation(command, args, resolveCommandPath)
  if (direct) {
    const result = spawnSync(direct.command, direct.args, {
      ...options,
      cwd: options.cwd ?? direct.cwd,
      shell: false,
      windowsHide: true,
    })
    if (!shouldRetryWithMirroredGbrain(direct, result)) return result
    const mirrored = ensureMirroredGbrainInvocation(direct)
    return spawnSync(mirrored.command, mirrored.args, {
      ...options,
      cwd: options.cwd ?? mirrored.cwd,
      shell: false,
      windowsHide: true,
    })
  }
  const resolved = resolveWindowsCommandShim(resolveCommandPath(command) ?? command)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const comspec = process.env.ComSpec || 'cmd.exe'
    return spawnSync(comspec, ['/d', '/c', 'call', resolved, ...args], {
      ...options,
      shell: false,
      windowsHide: true,
    })
  }
  return spawnSync(resolved, args, {
    ...options,
    shell: false,
    windowsHide: true,
  })
}

function resolveWindowsCommandShim(command) {
  if (process.platform !== 'win32') return command
  if (!/[\\/]/.test(command) || extname(command)) return command
  for (const extension of ['.cmd', '.exe', '.bat', '.com']) {
    const candidate = `${command}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return command
}

function resolveCommandPath(command) {
  if (/[\\/]/.test(command)) return command
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = spawnSync(lookup, [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  })
  if (result.status !== 0) return null
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) ?? null
}

function parseArgs(args) {
  const parsed = {
    keepTemp: false,
    verbose: false,
    timeoutMs: 120_000,
    scaleCommand: undefined,
    tempDir: undefined,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--keep-temp') parsed.keepTemp = true
    else if (arg === '--verbose') parsed.verbose = true
    else if (arg === '--scale-command') parsed.scaleCommand = args[++index]
    else if (arg === '--temp-dir') parsed.tempDir = args[++index]
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number.parseInt(args[++index] ?? '', 10)
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node scripts/workflow/setup-smoke.mjs [--scale-command "scale"] [--keep-temp] [--verbose]\n')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) parsed.timeoutMs = 120_000
  return parsed
}

function mkSmokeRoot() {
  return join(tmpdir(), `scale-setup-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

function parseCommandLine(command) {
  const tokens = []
  let current = ''
  let quote = null

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote) {
      if (char === quote) {
        quote = null
      } else if (quote === '"' && char === '\\' && index + 1 < command.length) {
        index += 1
        current += command[index]
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    if (char === '\\' && index + 1 < command.length) {
      index += 1
      current += command[index]
      continue
    }
    current += char
  }
  if (quote) throw new Error(`Unterminated quote in scale command: ${command}`)
  if (current) tokens.push(current)
  if (tokens.length === 0) throw new Error('Scale command is empty')
  return { file: tokens[0], args: tokens.slice(1) }
}

function formatCommand(command, args) {
  return [command, ...args].map(quoteArg).join(' ')
}

function quoteArg(value) {
  const raw = String(value)
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(raw)) return raw
  return `"${raw.replace(/(["\\$`])/g, '\\$1')}"`
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertIncludes(value, expected, message) {
  if (!String(value).includes(expected)) throw new Error(`${message}; missing ${expected}`)
}

function assertArrayContains(actual, expected, message) {
  const values = new Set(Array.isArray(actual) ? actual : [])
  const missing = expected.filter(value => !values.has(value))
  if (missing.length > 0) throw new Error(`${message}; missing: ${missing.join(', ')}`)
}

function writeSummary(status, error) {
  const report = {
    version: 1,
    status,
    scaleCommand,
    repoRoot,
    projectDir,
    scaleDir,
    homeDir,
    results,
    error: error ? String(error.stack ?? error.message ?? error) : undefined,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
