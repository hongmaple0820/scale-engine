import { execa, type Options } from 'execa'

const SHELL_META = new Set(['|', '&', ';', '<', '>', '`', '$', '(', ')'])

export interface ParsedCommand {
  file: string
  args: string[]
}

export interface SafeCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface SafeCommandOptions {
  cwd?: string
  timeout?: number
  allowShell?: boolean
  env?: NodeJS.ProcessEnv
}

export function parseCommandLine(command: string): ParsedCommand {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

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

    if (SHELL_META.has(char)) {
      throw new Error(`Shell metacharacter "${char}" is not allowed in verification commands. Use package scripts or set SCALE_ALLOW_SHELL_COMMANDS=1 for a trusted local run.`)
    }

    current += char
  }

  if (quote) throw new Error('Unterminated quote in command')
  if (current) tokens.push(current)
  if (tokens.length === 0) throw new Error('Command is empty')

  return { file: tokens[0], args: tokens.slice(1) }
}

export async function runSafeCommand(command: string, options: SafeCommandOptions = {}): Promise<SafeCommandResult> {
  const allowShell = options.allowShell || process.env.SCALE_ALLOW_SHELL_COMMANDS === '1'
  const execaOptions: Options = {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    reject: false,
  }

  const result = allowShell
    ? await execa(command, { ...execaOptions, shell: true })
    : await runWithoutShell(command, execaOptions)

  return {
    exitCode: result.exitCode ?? 1,
    stdout: commandOutputToString(result.stdout),
    stderr: commandOutputToString(result.stderr),
  }
}

function commandOutputToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  if (value instanceof Uint8Array) return new TextDecoder().decode(value)
  return String(value)
}

async function runWithoutShell(command: string, options: Options) {
  const parsed = parseCommandLine(command)
  return execa(parsed.file, parsed.args, {
    ...options,
    shell: false,
  })
}
