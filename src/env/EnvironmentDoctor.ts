import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { delimiter, extname } from 'node:path'
import { runGbrainCommandSync } from '../core/GbrainRuntime.js'
import { resolveExternalCommandPath } from '../core/ExternalCommand.js'

export type EnvironmentCheckStatus = 'ok' | 'warn' | 'missing' | 'fail'
export type EnvironmentCheckCategory = 'core' | 'shell' | 'runtime' | 'third-party'

export interface EnvironmentCommandCheck {
  id: string
  label: string
  category: EnvironmentCheckCategory
  status: EnvironmentCheckStatus
  required: boolean
  candidates: string[]
  detectedCommand?: string
  resolvedPath?: string
  version?: string
  reason: string
  installHint?: string
  requiredFor: string[]
}

export interface EnvironmentDoctorReport {
  ok: boolean
  status: 'healthy' | 'degraded' | 'broken'
  generatedAt: string
  platform: NodeJS.Platform
  arch: string
  release: string
  node: {
    version: string
    execPath: string
    status: EnvironmentCheckStatus
    reason: string
  }
  shell: {
    defaultShell?: string
    comspec?: string
    detected: Array<{ id: string; available: boolean; path?: string }>
  }
  path: {
    delimiter: string
    entryCount: number
    entriesPreview: string[]
  }
  checks: EnvironmentCommandCheck[]
  warnings: string[]
  recommendations: string[]
}

export interface InspectEnvironmentOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  arch?: string
  release?: string
  homedir?: string
  execPath?: string
  nodeVersion?: string
  commandResolver?: (command: string) => string | null
  commandRunner?: (command: string, args: string[], resolvedPath?: string) => CommandRunResult
}

interface CommandRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface CommandCandidate {
  command: string
  args: string[]
  display: string
}

const CHECK_DEFINITIONS: Array<{
  id: string
  label: string
  category: EnvironmentCheckCategory
  required: boolean
  candidates: CommandCandidate[]
  requiredFor: string[]
  installHint?: string
}> = [
  {
    id: 'git',
    label: 'Git',
    category: 'core',
    required: true,
    candidates: [{ command: 'git', args: ['--version'], display: 'git' }],
    requiredFor: ['repository workflow', 'release verification'],
    installHint: 'Install Git and re-open the shell so git is on PATH.',
  },
  {
    id: 'npm',
    label: 'npm',
    category: 'core',
    required: true,
    candidates: [{ command: 'npm', args: ['--version'], display: 'npm' }],
    requiredFor: ['scale install', 'codegraph install', 'node-library workflow'],
    installHint: 'Install Node.js 20+; npm is bundled with Node.js.',
  },
  {
    id: 'npx',
    label: 'npx',
    category: 'core',
    required: true,
    candidates: [{ command: 'npx', args: ['--version'], display: 'npx' }],
    requiredFor: ['awesome-design-md', 'ui-ux-pro-max', 'frontend-design'],
    installHint: 'Install Node.js 20+; npx is bundled with npm.',
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    category: 'shell',
    required: false,
    candidates: [
      { command: 'pwsh', args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], display: 'pwsh' },
      { command: 'powershell', args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], display: 'powershell' },
    ],
    requiredFor: ['Windows workflow wrappers', 'RTK Windows proxy'],
    installHint: 'Install PowerShell 7+ or use Windows PowerShell where available.',
  },
  {
    id: 'bash',
    label: 'Bash',
    category: 'shell',
    required: false,
    candidates: [{ command: 'bash', args: ['--version'], display: 'bash' }],
    requiredFor: ['Unix workflow wrappers', 'make targets'],
    installHint: 'Install Bash through Git for Windows, WSL, or the OS package manager.',
  },
  {
    id: 'cargo',
    label: 'Rust/Cargo',
    category: 'runtime',
    required: false,
    candidates: [{ command: 'cargo', args: ['--version'], display: 'cargo' }],
    requiredFor: ['rtk install'],
    installHint: 'Install Rust with rustup, then re-open the shell so cargo is on PATH.',
  },
  {
    id: 'bun',
    label: 'Bun',
    category: 'runtime',
    required: false,
    candidates: [{ command: 'bun', args: ['--version'], display: 'bun' }],
    requiredFor: ['gbrain install'],
    installHint: 'Install Bun from https://bun.sh and re-open the shell.',
  },
  {
    id: 'python',
    label: 'Python',
    category: 'runtime',
    required: false,
    candidates: [
      { command: 'python', args: ['--version'], display: 'python' },
      { command: 'python3', args: ['--version'], display: 'python3' },
      { command: 'py', args: ['--version'], display: 'py' },
    ],
    requiredFor: ['graphify install'],
    installHint: 'Install Python 3.10+ and ensure it is on PATH.',
  },
  {
    id: 'python-installer',
    label: 'Python installer',
    category: 'runtime',
    required: false,
    candidates: [
      { command: 'uv', args: ['--version'], display: 'uv' },
      { command: 'pipx', args: ['--version'], display: 'pipx' },
      { command: 'pip', args: ['--version'], display: 'pip' },
      { command: 'pip3', args: ['--version'], display: 'pip3' },
      { command: 'python', args: ['-m', 'pip', '--version'], display: 'python -m pip' },
      { command: 'python3', args: ['-m', 'pip', '--version'], display: 'python3 -m pip' },
    ],
    requiredFor: ['graphify install'],
    installHint: 'Install uv or pipx first; pip is supported only as a fallback.',
  },
  {
    id: 'rtk',
    label: 'RTK',
    category: 'third-party',
    required: false,
    candidates: [{ command: 'rtk', args: ['--version'], display: 'rtk' }],
    requiredFor: ['governed CLI proxy', 'token savings evidence'],
    installHint: 'Install with cargo, then run `rtk init -g --codex` and `rtk gain`.',
  },
  {
    id: 'gbrain',
    label: 'GBrain',
    category: 'third-party',
    required: false,
    candidates: [{ command: 'gbrain', args: ['doctor', '--json'], display: 'gbrain doctor --json' }],
    requiredFor: ['memory provider routing', 'cross-session recall'],
    installHint: 'Install with Bun and run `gbrain init --pglite` before autonomous recall.',
  },
  {
    id: 'graphify',
    label: 'Graphify',
    category: 'third-party',
    required: false,
    candidates: [{ command: 'graphify', args: ['--version'], display: 'graphify' }],
    requiredFor: ['knowledge graph provider'],
    installHint: 'Install with `uv tool install graphify && graphify install --platform codex`.',
  },
  {
    id: 'codegraph',
    label: 'CodeGraph',
    category: 'third-party',
    required: false,
    candidates: [{ command: 'codegraph', args: ['--version'], display: 'codegraph' }],
    requiredFor: ['code intelligence provider'],
    installHint: 'Install with `npm install -g @colbymchenry/codegraph` and run `codegraph init -i` per project.',
  },
  {
    id: 'gitnexus',
    label: 'GitNexus',
    category: 'third-party',
    required: false,
    candidates: [{ command: 'gitnexus', args: ['--version'], display: 'gitnexus' }],
    requiredFor: ['optional code intelligence provider'],
    installHint: 'Install explicitly with `npm install -g gitnexus`, then run `gitnexus analyze --index-only` per project.',
  },
]

export function inspectEnvironment(options: InspectEnvironmentOptions = {}): EnvironmentDoctorReport {
  const env = options.env ?? process.env
  const currentPlatform = options.platform ?? platform()
  const currentArch = options.arch ?? arch()
  const currentRelease = options.release ?? release()
  const currentNodeVersion = options.nodeVersion ?? process.version
  const currentExecPath = options.execPath ?? process.execPath
  const resolver = options.commandResolver ?? resolveExternalCommandPath
  const runner = options.commandRunner ?? runCommand
  const pathEntries = String(env.PATH ?? env.Path ?? '')
    .split(currentPlatform === 'win32' ? ';' : delimiter)
    .map(entry => entry.trim())
    .filter(Boolean)

  const checks = CHECK_DEFINITIONS.map(definition => inspectCommand(definition, resolver, runner, currentPlatform))
  const nodeStatus = nodeVersionStatus(currentNodeVersion)
  const warnings = buildWarnings(checks, nodeStatus)
  const recommendations = buildRecommendations(checks, nodeStatus)
  const requiredFailures = checks.filter(check => check.required && (check.status === 'missing' || check.status === 'fail')).length
  const warnCount = checks.filter(check => check.status === 'warn').length + (nodeStatus.status === 'warn' ? 1 : 0)
  const status = nodeStatus.status === 'fail' || requiredFailures > 0
    ? 'broken'
    : warnCount > 0 ? 'degraded' : 'healthy'

  return {
    ok: status !== 'broken',
    status,
    generatedAt: new Date().toISOString(),
    platform: currentPlatform,
    arch: currentArch,
    release: currentRelease,
    node: {
      version: currentNodeVersion,
      execPath: currentExecPath,
      status: nodeStatus.status,
      reason: nodeStatus.reason,
    },
    shell: {
      defaultShell: env.SHELL,
      comspec: env.ComSpec,
      detected: shellCandidates(currentPlatform).map(command => ({
        id: command,
        available: Boolean(resolver(command)),
        path: resolver(command) ?? undefined,
      })),
    },
    path: {
      delimiter: currentPlatform === 'win32' ? ';' : delimiter,
      entryCount: pathEntries.length,
      entriesPreview: pathEntries.slice(0, 12),
    },
    checks,
    warnings,
    recommendations,
  }
}

export function renderEnvironmentDoctor(report: EnvironmentDoctorReport): string {
  const lines = [
    '',
    'SCALE Environment Doctor',
    `  Status: ${report.status.toUpperCase()}`,
    `  OS: ${report.platform} ${report.arch} ${report.release}`,
    `  Node: ${report.node.version} (${report.node.status})`,
    `  PATH entries: ${report.path.entryCount}`,
  ]
  for (const check of report.checks) {
    lines.push(`  [${check.status.toUpperCase()}] ${check.id}: ${check.reason}`)
    if (check.detectedCommand && check.version) lines.push(`    detected: ${check.detectedCommand} (${check.version})`)
    if ((check.status === 'missing' || check.status === 'fail' || check.status === 'warn') && check.installHint) {
      lines.push(`    fix: ${check.installHint}`)
    }
  }
  for (const warning of report.warnings) lines.push(`  [WARN] ${warning}`)
  for (const recommendation of report.recommendations) lines.push(`  [NEXT] ${recommendation}`)
  return lines.join('\n')
}

function inspectCommand(
  definition: typeof CHECK_DEFINITIONS[number],
  resolver: NonNullable<InspectEnvironmentOptions['commandResolver']>,
  runner: NonNullable<InspectEnvironmentOptions['commandRunner']>,
  currentPlatform: NodeJS.Platform,
): EnvironmentCommandCheck {
  let firstFailed: EnvironmentCommandCheck | undefined
  for (const candidate of definition.candidates) {
    const resolved = resolver(candidate.command)
    if (!resolved) continue
    const result = runner(candidate.command, candidate.args, resolved)
    const output = `${result.stdout}\n${result.stderr}`.trim()
    const interpreted = interpretSpecialCheckResult(definition.id, output, resolved, currentPlatform, result.exitCode)
    const version = resolveSpecialVersion(definition.id, output, runner, resolved) ?? interpreted?.version ?? firstLine(output)
    if (result.exitCode === 0) {
      const status = interpreted ?? commandVersionStatus(definition.id, version)
      return {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        status: status.status,
        required: definition.required,
        candidates: definition.candidates.map(item => item.display),
        detectedCommand: candidate.display,
        resolvedPath: resolved,
        version,
        reason: status.reason ?? `${definition.label} is available via ${candidate.display}.`,
        installHint: definition.installHint,
        requiredFor: definition.requiredFor,
      }
    }
    if (interpreted) {
      return {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        status: interpreted.status,
        required: definition.required,
        candidates: definition.candidates.map(item => item.display),
        detectedCommand: candidate.display,
        resolvedPath: resolved,
        version,
        reason: interpreted.reason,
        installHint: definition.installHint,
        requiredFor: definition.requiredFor,
      }
    }
    firstFailed ??= {
      id: definition.id,
      label: definition.label,
      category: definition.category,
      status: 'warn',
      required: definition.required,
      candidates: definition.candidates.map(item => item.display),
      detectedCommand: candidate.display,
      resolvedPath: resolved,
      reason: `${definition.label} was found but health/version command failed: ${summarizeFailureOutput(definition.id, output)}`,
      installHint: definition.installHint,
      requiredFor: definition.requiredFor,
    }
  }
  if (firstFailed) return firstFailed
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    status: definition.required ? 'fail' : 'missing',
    required: definition.required,
    candidates: definition.candidates.map(item => item.display),
    reason: `${definition.label} was not detected on PATH.`,
    installHint: definition.installHint,
    requiredFor: definition.requiredFor,
  }
}

function runCommand(command: string, args: string[], resolvedPath?: string): CommandRunResult {
  if (command === 'gbrain') {
    const result = runGbrainCommandSync(args, {
      timeout: 20_000,
      env: process.env,
    })
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
  const executable = resolveWindowsCommandShim(resolvedPath ?? command)
  const wrapperArgs = isWindowsCommandWrapper(executable)
    ? ['/d', '/c', 'call', executable, ...args]
    : args
  const result: SpawnSyncReturns<string> = spawnSync(
    isWindowsCommandWrapper(executable) ? process.env.ComSpec ?? 'cmd.exe' : executable,
    wrapperArgs,
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  )
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? result.error?.message ?? ''),
  }
}

function resolveWindowsCommandShim(executable: string): string {
  if (process.platform !== 'win32') return executable
  if (!/[\\/]/.test(executable) || extname(executable)) return executable
  for (const extension of ['.cmd', '.exe', '.bat', '.com']) {
    const candidate = `${executable}${extension}`
    if (existsSync(candidate)) return candidate
  }
  return executable
}

function isWindowsCommandWrapper(executable: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)
}

function nodeVersionStatus(value: string): { status: EnvironmentCheckStatus; reason: string } {
  const version = parseSemver(value)
  if (!version) return { status: 'warn', reason: `Could not parse Node.js version: ${value}` }
  if (version.major < 20) return { status: 'fail', reason: `Node.js ${value} is below the required 20.x baseline.` }
  return { status: 'ok', reason: `Node.js ${value} satisfies the 20+ baseline.` }
}

function commandVersionStatus(id: string, version: string): { status: EnvironmentCheckStatus; reason?: string } {
  if (id === 'python') {
    const parsed = parseSemver(version)
    if (!parsed || parsed.major < 3 || (parsed.major === 3 && parsed.minor < 10)) {
      return { status: 'warn', reason: `${version || 'Python'} is detected, but Graphify requires Python 3.10+.` }
    }
  }
  if (id === 'python-installer' && version && !/^(uv|pipx)\b/i.test(version)) {
    return { status: 'warn', reason: `${version} is available, but uv or pipx is preferred for isolated graphify installs.` }
  }
  return { status: 'ok' }
}

function buildWarnings(checks: EnvironmentCommandCheck[], nodeStatus: { status: EnvironmentCheckStatus; reason: string }): string[] {
  const warnings: string[] = []
  if (nodeStatus.status !== 'ok') warnings.push(nodeStatus.reason)
  for (const check of checks) {
    if (check.required && (check.status === 'missing' || check.status === 'fail')) warnings.push(`${check.id} is required: ${check.reason}`)
    if (!check.required && check.status === 'warn') warnings.push(`${check.id}: ${check.reason}`)
  }
  return warnings
}

function buildRecommendations(checks: EnvironmentCommandCheck[], nodeStatus: { status: EnvironmentCheckStatus; reason: string }): string[] {
  const recommendations = new Set<string>()
  if (nodeStatus.status !== 'ok') recommendations.add('Install Node.js 20+ before running SCALE workflow commands.')
  for (const check of checks) {
    if ((check.status === 'missing' || check.status === 'fail' || check.status === 'warn') && check.installHint) {
      recommendations.add(check.installHint)
    }
  }
  recommendations.add('Use `npm run smoke:setup` as the cross-platform setup smoke; use `make setup-smoke` only where make is installed.')
  return [...recommendations]
}

function shellCandidates(currentPlatform: NodeJS.Platform): string[] {
  return currentPlatform === 'win32'
    ? ['powershell', 'pwsh', 'cmd', 'bash']
    : ['bash', 'sh', 'pwsh']
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? ''
}

function interpretSpecialCheckResult(
  id: string,
  output: string,
  resolvedPath: string | undefined,
  currentPlatform: NodeJS.Platform,
  exitCode?: number,
): { status: EnvironmentCheckStatus; reason: string; version?: string } | null {
  if (id === 'bash'
    && currentPlatform === 'win32'
    && isWindowsSystemBashLauncher(resolvedPath)
    && typeof exitCode === 'number'
    && exitCode !== 0) {
    return {
      status: 'missing',
      reason: 'Windows bash launcher is present, but no usable Bash runtime is configured.',
    }
  }
  if (id === 'gbrain') return interpretGbrainDoctorOutput(output)
  return null
}

function summarizeFailureOutput(id: string, output: string): string {
  const line = firstLine(output)
  if (id === 'gbrain') {
    const interpreted = interpretGbrainDoctorOutput(output)
    if (interpreted) return interpreted.reason
  }
  if (!line) return 'no output'
  if (id === 'gbrain') {
    const parsed = parseGbrainDoctorReport(output)
    if (parsed) {
      const failingChecks = gbrainDoctorChecks(parsed)
        .filter(check => check.status && check.status !== 'ok')
        .map(check => check.name)
        .filter(Boolean)
      if (failingChecks.length > 0) {
        return `gbrain doctor reported ${failingChecks.length} non-ok check(s): ${failingChecks.slice(0, 4).join(', ')}`
      }
      if (typeof parsed.status === 'string') return `gbrain doctor status=${parsed.status}`
    }
  }
  return compactText(line)
}

function interpretGbrainDoctorOutput(output: string): { status: EnvironmentCheckStatus; reason: string; version?: string } | null {
  const parsed = parseGbrainDoctorReport(output)
  if (!parsed) return null

  if (gbrainCoreRecallReady(parsed)) {
    const optionalIssues = gbrainDoctorChecks(parsed)
      .filter(check => check.status !== 'ok' && !GBRAIN_CORE_RECALL_CHECKS.has(check.name))
      .map(check => check.name)
      .filter(Boolean)
    return {
      status: 'ok',
      reason: optionalIssues.length > 0
        ? `GBrain core recall is available; optional doctor warnings: ${optionalIssues.slice(0, 4).join(', ')}`
        : 'GBrain core recall is available.',
    }
  }

  const coreIssues = gbrainDoctorChecks(parsed)
    .filter(check => check.status !== 'ok' && GBRAIN_CORE_RECALL_CHECKS.has(check.name))
    .map(check => check.name)
    .filter(Boolean)
  if (coreIssues.length > 0) {
    return {
      status: 'warn',
      reason: `gbrain doctor reported core recall issue(s): ${coreIssues.join(', ')}`,
    }
  }

  const nonOkChecks = gbrainDoctorChecks(parsed)
    .filter(check => check.status !== 'ok')
    .map(check => check.name)
    .filter(Boolean)
  if (nonOkChecks.length > 0) {
    return {
      status: 'warn',
      reason: `gbrain doctor reported ${nonOkChecks.length} non-ok check(s): ${nonOkChecks.slice(0, 4).join(', ')}`,
    }
  }

  if (typeof parsed.status === 'string') {
    return {
      status: 'ok',
      reason: `gbrain doctor status=${parsed.status}`,
    }
  }

  return null
}

function compactText(value: string, maxLength = 200): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function resolveSpecialVersion(
  id: string,
  output: string,
  runner: NonNullable<InspectEnvironmentOptions['commandRunner']>,
  resolvedPath: string | undefined,
): string | undefined {
  if (id !== 'gbrain') return undefined
  return resolveGbrainVersion(output, runner, resolvedPath)
}

function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3] ?? '0', 10),
  }
}

function isWindowsSystemBashLauncher(resolvedPath: string | undefined): boolean {
  if (!resolvedPath) return false
  return /[\\/]windows[\\/]system32[\\/]bash\.exe$/i.test(resolvedPath)
}

interface GbrainDoctorReport {
  status?: unknown
  checks?: unknown
}

interface GbrainDoctorCheck {
  name: string
  status: string
}

const GBRAIN_CORE_RECALL_CHECKS = new Set(['connection', 'schema_version', 'brain_score'])

function resolveGbrainVersion(
  output: string,
  runner: NonNullable<InspectEnvironmentOptions['commandRunner']>,
  resolvedPath: string | undefined,
): string {
  const versionProbe = runner('gbrain', ['--version'], resolvedPath)
  const versionLine = firstLine(`${versionProbe.stdout}\n${versionProbe.stderr}`)
  if (versionProbe.exitCode === 0 && versionLine && !looksLikeJson(versionLine)) {
    return compactText(versionLine, 80)
  }

  const parsed = parseGbrainDoctorReport(output)
  if (typeof parsed?.status === 'string') {
    return `gbrain doctor status=${parsed.status}`
  }
  return 'gbrain doctor --json'
}

function parseGbrainDoctorReport(output: string): GbrainDoctorReport | null {
  const json = extractFirstJsonObject(output)
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    return isRecord(parsed) ? parsed as GbrainDoctorReport : null
  } catch {
    return null
  }
}

function extractFirstJsonObject(output: string): string | null {
  const start = output.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < output.length; index += 1) {
    const char = output[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return output.slice(start, index + 1)
    }
  }
  return null
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function gbrainCoreRecallReady(report: GbrainDoctorReport): boolean {
  const checks = gbrainDoctorChecks(report)
  const connection = checks.find(check => check.name === 'connection')
  if (connection) {
    if (connection.status !== 'ok') return false

    const legacyRecallChecks = checks.filter(check => check.name === 'schema_version' || check.name === 'brain_score')
    if (legacyRecallChecks.length > 0) return legacyRecallChecks.some(check => check.status === 'ok')

    return true
  }

  const status = typeof report.status === 'string' ? report.status.toLowerCase() : undefined
  return status === 'healthy' || status === 'ok'
}

function gbrainDoctorChecks(report: GbrainDoctorReport): GbrainDoctorCheck[] {
  if (!Array.isArray(report.checks)) return []
  return report.checks
    .filter(isRecord)
    .map(check => ({
      name: String(check.name ?? ''),
      status: String(check.status ?? ''),
    }))
    .filter(check => check.name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
