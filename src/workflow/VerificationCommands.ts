import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface VerificationCommandConfig {
  build?: string
  lint?: string
  test?: string
  coverage?: string
  smoke?: string
  runtimeEvidence?: VerificationRuntimeEvidenceConfig
  tddEvidence?: string
  tddStrict?: boolean
  cwd?: string
  scaleDir?: string
}

export interface VerificationRuntimeEvidenceConfig {
  projectDir?: string
  scaleDir?: string
  taskId?: string
  sessionId?: string
  profile?: string
}

export interface ResolvedVerificationCommand {
  command?: string
  source: 'override' | 'package-script' | 'fallback' | 'missing'
  reason: string
  cwd?: string
}

export interface ResolvedVerificationCommands {
  packageManager: string
  build: ResolvedVerificationCommand
  lint: ResolvedVerificationCommand
  test: ResolvedVerificationCommand
  coverage: ResolvedVerificationCommand
  smoke: ResolvedVerificationCommand
  runtimeEvidence?: VerificationRuntimeEvidenceConfig
  tddEvidence?: string
  tddStrict?: boolean
}

interface PackageJson {
  packageManager?: string
  scripts?: Record<string, string>
}

export function detectVerificationCommands(
  cwd = process.cwd(),
  overrides: VerificationCommandConfig = {},
): ResolvedVerificationCommands {
  const pkg = readPackageJson(cwd)
  const scripts = pkg?.scripts ?? {}
  const packageManager = detectPackageManager(cwd, pkg)

  return {
    packageManager,
    build: withCwd(resolveBuildCommand(packageManager, scripts, overrides.build), cwd),
    lint: withCwd(resolveScriptCommand(packageManager, scripts, 'lint', overrides.lint), cwd),
    test: withCwd(resolveScriptCommand(packageManager, scripts, 'test', overrides.test), cwd),
    coverage: withCwd(resolveCoverageCommand(packageManager, scripts, overrides.coverage), cwd),
    smoke: withCwd(resolveScriptCommand(packageManager, scripts, 'smoke', overrides.smoke), cwd),
    runtimeEvidence: overrides.runtimeEvidence,
    tddEvidence: overrides.tddEvidence,
    tddStrict: overrides.tddStrict,
  }
}

function withCwd(command: ResolvedVerificationCommand, cwd: string): ResolvedVerificationCommand {
  return { ...command, cwd }
}

function readPackageJson(cwd: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as PackageJson
  } catch {
    return null
  }
}

function detectPackageManager(cwd: string, pkg: PackageJson | null): string {
  const declared = pkg?.packageManager?.split('@')[0]
  if (declared) return declared

  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm'
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun'
  return 'npm'
}

function resolveScriptCommand(
  packageManager: string,
  scripts: Record<string, string>,
  scriptName: string,
  override?: string,
): ResolvedVerificationCommand {
  if (override?.trim()) {
    return {
      command: override.trim(),
      source: 'override',
      reason: `provided by CLI/config override for ${scriptName}`,
    }
  }

  if (!scripts[scriptName]) {
    return {
      source: 'missing',
      reason: `package.json has no "${scriptName}" script`,
    }
  }

  return {
    command: runScriptCommand(packageManager, scriptName),
    source: 'package-script',
    reason: `detected package.json "${scriptName}" script`,
  }
}

function resolveCoverageCommand(
  packageManager: string,
  scripts: Record<string, string>,
  override?: string,
): ResolvedVerificationCommand {
  if (override?.trim()) {
    return {
      command: override.trim(),
      source: 'override',
      reason: 'provided by CLI/config override for coverage',
    }
  }

  if (scripts.coverage) {
    return {
      command: runScriptCommand(packageManager, 'coverage'),
      source: 'package-script',
      reason: 'detected package.json "coverage" script',
    }
  }

  return {
    source: 'missing',
    reason: 'package.json has no "coverage" script; add one or pass --coverage-cmd for full coverage gates',
  }
}

function resolveBuildCommand(
  packageManager: string,
  scripts: Record<string, string>,
  override?: string,
): ResolvedVerificationCommand {
  if (override?.trim()) {
    return {
      command: override.trim(),
      source: 'override',
      reason: 'provided by CLI/config override for build',
    }
  }

  if (scripts.build) {
    return {
      command: runScriptCommand(packageManager, 'build'),
      source: 'package-script',
      reason: 'detected package.json "build" script',
    }
  }

  if (scripts.typecheck) {
    return {
      command: runScriptCommand(packageManager, 'typecheck'),
      source: 'fallback',
      reason: 'no "build" script; using package.json "typecheck" script',
    }
  }

  return {
    source: 'missing',
    reason: 'package.json has neither "build" nor "typecheck" script',
  }
}

function runScriptCommand(packageManager: string, scriptName: string): string {
  if (packageManager === 'npm') {
    return scriptName === 'test' ? 'npm test' : `npm run ${scriptName}`
  }
  if (packageManager === 'yarn') {
    return `yarn ${scriptName}`
  }
  if (packageManager === 'bun') {
    return `bun run ${scriptName}`
  }
  return scriptName === 'test' ? `${packageManager} test` : `${packageManager} run ${scriptName}`
}
