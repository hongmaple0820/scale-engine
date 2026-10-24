import * as childProcess from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

type CommandRuntime = {
  execFileSync: typeof childProcess.execFileSync
  spawnSync: typeof childProcess.spawnSync
}

const DEFAULT_RUNTIME: CommandRuntime = {
  execFileSync: childProcess.execFileSync,
  spawnSync: childProcess.spawnSync,
}

export function resolveExternalCommandPath(
  command: string,
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): string | null {
  try {
    const lookup = process.platform === 'win32' ? 'where.exe' : 'which'
    const output = runtime.execFileSync(lookup, [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = String(output)
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean)
    return match ?? null
  } catch {
    return null
  }
}

export function externalCommandExists(
  command: string,
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): boolean {
  return Boolean(resolveExternalCommandPath(command, runtime))
}

/**
 * Windows 上把无扩展名的命令解析为可执行的真实文件。
 * npm 全局安装的 CLI（lark-cli / claude / codex 等）是 .cmd 垫片，
 * 直接 spawn 无扩展名路径会 ENOENT。
 */
export function resolveWindowsCommandShim(executable: string): string {
  if (process.platform !== 'win32') return executable
  if (!/[\\/]/.test(executable) || extname(executable)) return executable
  for (const extension of ['.cmd', '.exe', '.bat', '.com']) {
    const candidate = `${executable}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return executable
}

export interface SpawnInvocation {
  executable: string
  args: string[]
}

/**
 * 为 child_process.spawn 构造跨平台调用：
 * - 已能解析到真实路径的命令直接用；
 * - Windows 上是 .cmd/.bat 垫片时，改走 cmd.exe /d /c call 包装（spawn 不认这些扩展名）；
 * - 解析不到的命令原样返回，让 spawn 报出原始错误。
 */
export function buildSpawnInvocation(
  command: string,
  args: string[],
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): SpawnInvocation {
  const resolvedPath = resolveExternalCommandPath(command, runtime)
  const resolved = resolveWindowsCommandShim(resolvedPath ?? command)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return {
      executable: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/c', 'call', resolved, ...args],
    }
  }
  return { executable: resolved, args }
}

export function runExternalCommandSync(
  command: string,
  args: string[],
  options: childProcess.ExecFileSyncOptions = {},
  runtime: CommandRuntime = DEFAULT_RUNTIME,
): string | Buffer {
  const resolved = resolveWindowsCommandShim(resolveExternalCommandPath(command, runtime) ?? command)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const result = runtime.spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'call', resolved, ...args], {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv | undefined,
      encoding: options.encoding as BufferEncoding | undefined,
      input: options.input as string | Buffer | undefined,
      maxBuffer: options.maxBuffer,
      shell: false,
      stdio: options.stdio as childProcess.StdioOptions | undefined,
      timeout: options.timeout,
      windowsHide: options.windowsHide,
    })
    if (result.error) throw result.error
    if (typeof result.status === 'number' && result.status !== 0) {
      const message = typeof result.stderr === 'string'
        ? result.stderr.trim()
        : result.stderr?.toString('utf8').trim()
      const error = new Error(message || `Command failed: ${resolved} ${args.join(' ')}`) as Error & {
        status?: number | null
        stdout?: string | Buffer | null
        stderr?: string | Buffer | null
      }
      error.status = result.status
      error.stdout = result.stdout
      error.stderr = result.stderr
      throw error
    }
    return result.stdout ?? ''
  }
  return runtime.execFileSync(resolved, args, options)
}

