#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

function parseArgs(argv) {
  const parsed = {
    timeoutMs: 0,
    logFile: '',
    command: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      parsed.command = argv.slice(index + 1)
      break
    }
    if (arg === '--timeout-ms') {
      parsed.timeoutMs = Number.parseInt(argv[++index] ?? '', 10)
      continue
    }
    if (arg.startsWith('--timeout-ms=')) {
      parsed.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10)
      continue
    }
    if (arg === '--log-file') {
      parsed.logFile = argv[++index] ?? ''
      continue
    }
    if (arg.startsWith('--log-file=')) {
      parsed.logFile = arg.slice('--log-file='.length)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer')
  }
  if (!parsed.logFile) throw new Error('--log-file is required')
  if (parsed.command.length === 0) throw new Error('command is required after --')
  return parsed
}

function writeBoth(stream, chunk, log) {
  stream.write(chunk)
  log.write(chunk)
}

async function closeLog(log) {
  await new Promise(resolve => log.end(resolve))
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }

  const log = createWriteStream(options.logFile, { flags: 'w' })
  const [rawCommand, ...rawArgs] = options.command
  const command = rawCommand === 'node' ? process.execPath : rawCommand
  let timedOut = false
  let spawnError = null

  const child = spawn(command, rawArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  const timeout = setTimeout(() => {
    timedOut = true
    const message = `\nCommand timed out after ${options.timeoutMs}ms\n`
    process.stderr.write(message)
    log.write(message)
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 5_000).unref()
  }, options.timeoutMs)

  child.stdout.on('data', chunk => writeBoth(process.stdout, chunk, log))
  child.stderr.on('data', chunk => writeBoth(process.stderr, chunk, log))
  child.on('error', error => {
    spawnError = error
    const message = `${error instanceof Error ? error.message : String(error)}\n`
    process.stderr.write(message)
    log.write(message)
  })

  const result = await new Promise(resolve => {
    child.on('close', (code, signal) => resolve({ code, signal }))
  })

  clearTimeout(timeout)
  await closeLog(log)

  if (timedOut) process.exit(124)
  if (spawnError) process.exit(127)
  if (typeof result.code === 'number') process.exit(result.code)
  process.stderr.write(`Command terminated by signal ${result.signal ?? 'unknown'}\n`)
  process.exit(1)
}

await main()
