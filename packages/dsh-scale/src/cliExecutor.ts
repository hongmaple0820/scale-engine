// dsh-scale: SCALE CLI executor — spawns the real `scale` CLI from the
// resolved main package (dist/api/cli.js, the `bin` entry) with a hard
// timeout and bounded output. Never throws: every failure is a return value
// (a throwing command handler settles as an error result, but staying inside
// the contract is cheaper than relying on that).

import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliRunResult {
  ok: boolean
  exitCode: number | null
  output: string
}

const OUTPUT_CAP = 20_000
const DEFAULT_TIMEOUT_MS = 120_000
const PKG_DIR = join('node_modules', '@hongmaple0820', 'scale-engine')

/**
 * Locate <main package>/dist/api/cli.js by walking up from this module
 * looking for the installed package. Filesystem probing (not require.resolve):
 * the main package is ESM-only — its `exports` map has just an `import`
 * condition, so a CJS resolve of the bare name always throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Symlinks (npm file:, pnpm) are realpath'd
 * to the physical package root.
 */
export function resolveScaleCli(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, PKG_DIR)
    if (existsSync(candidate)) {
      const root = realpathSync(candidate)
      const cli = join(root, 'dist', 'api', 'cli.js')
      return existsSync(cli) ? cli : null
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Run `scale <args...>` in projectDir. Output (stdout+stderr) is capped;
 * timeout kills the child and reports failure. Never rejects.
 */
export function runScaleCli(
  args: string[],
  projectDir: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<CliRunResult> {
  const cli = resolveScaleCli()
  if (!cli) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      output: 'scale CLI not found: @hongmaple0820/scale-engine is not installed (or dist/ not built) next to dsh-scale',
    })
  }

  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: projectDir,
      env: { ...process.env, SCALE_DIR: '.scale' },
      windowsHide: true,
    })

    const cap = (chunk: string) => {
      if (output.length >= OUTPUT_CAP) return
      output = (output + chunk).slice(0, OUTPUT_CAP)
    }
    child.stdout.on('data', (d) => cap(String(d)))
    child.stderr.on('data', (d) => cap(String(d)))

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ ok: false, exitCode: null, output: `${output}\n[scale] timed out after ${timeoutMs}ms` })
    }, timeoutMs)

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, exitCode: null, output: `spawn failed: ${err.message}` })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, exitCode: code, output })
    })
  })
}
