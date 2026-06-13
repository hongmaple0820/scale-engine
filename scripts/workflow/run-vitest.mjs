#!/usr/bin/env node
import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_ARGS = [
  'vitest',
  'run',
  '--reporter',
  'dot',
  '--pool=forks',
  '--maxWorkers=4',
  '--minWorkers=1',
]

const options = parseArgs(process.argv.slice(2))
const commandArgs = [...DEFAULT_ARGS, ...options.vitestArgs]
const invocation = buildInvocation(commandArgs)
let timedOut = false
let child

child = spawn(invocation.command, invocation.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  detached: process.platform !== 'win32',
  windowsHide: true,
})

const timer = setTimeout(() => {
  timedOut = true
  process.stderr.write(`\n[scale-engine] vitest timed out after ${options.timeoutMs}ms; terminating process tree.\n`)
  terminateProcessTree(child.pid)
}, options.timeoutMs)

child.on('exit', (code, signal) => {
  clearTimeout(timer)
  if (timedOut) {
    process.exitCode = 124
    return
  }
  if (typeof code === 'number') {
    process.exitCode = code
    return
  }
  process.stderr.write(`[scale-engine] vitest exited via signal ${signal ?? 'unknown'}.\n`)
  process.exitCode = 1
})

child.on('error', error => {
  clearTimeout(timer)
  process.stderr.write(`[scale-engine] failed to start vitest: ${error.message}\n`)
  process.exitCode = 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearTimeout(timer)
    terminateProcessTree(child?.pid)
    process.exit(130)
  })
}

function parseArgs(args) {
  const parsed = {
    timeoutMs: Number.parseInt(process.env.SCALE_TEST_TIMEOUT_MS ?? '', 10),
    vitestArgs: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number.parseInt(args[++index] ?? '', 10)
      continue
    }
    if (arg.startsWith('--timeout-ms=')) {
      parsed.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10)
      continue
    }
    parsed.vitestArgs.push(arg)
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    parsed.timeoutMs = DEFAULT_TIMEOUT_MS
  }
  return parsed
}

function terminateProcessTree(pid) {
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      try { process.kill(pid, 'SIGKILL') } catch (error) { ignoreExitedProcess(error) }
    })
    return
  }
  try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch (error) { ignoreExitedProcess(error) } }
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch (error) { ignoreExitedProcess(error) } }
  }, 2000).unref()
}

function ignoreExitedProcess(error) {
  if (process.env.SCALE_TEST_DEBUG) {
    process.stderr.write(`[scale-engine] process tree cleanup notice: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

function buildInvocation(args) {
  const configured = process.env.SCALE_VITEST_RUNNER
  if (configured) return { command: configured, args }
  if (process.platform !== 'win32') return { command: 'npx', args }
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', ['npx', ...args].map(windowsQuote).join(' ')],
  }
}

function windowsQuote(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}
