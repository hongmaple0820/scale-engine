import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { VerificationCommandConfig } from './VerificationCommands.js'
import { type VerificationProtocol } from './VerificationSchema.js'

export type VerificationCommandName = 'build' | 'lint' | 'test' | 'coverage' | 'smoke'
export type VerificationArtifactGateMode = 'off' | 'warn' | 'block'
export type VerificationArtifactGateLevel = 'M' | 'L' | 'CRITICAL'
export type VerificationEngineeringStandardsGateMode = 'off' | 'warn' | 'block'
export type VerificationEcosystemReadinessGateMode = 'off' | 'warn' | 'block'
export type VerificationEcosystemReadinessSkillScope = 'required' | 'recommended' | 'all'

export interface VerificationService {
  name: string
  path: string
  type?: 'node' | 'go' | 'python' | 'custom'
  required?: boolean
  commands?: Partial<Record<VerificationCommandName, string>>
}

export interface VerificationProfileEntry {
  commands?: Partial<Record<VerificationCommandName, string>>
  services?: string[]
}

export interface VerificationPolicy {
  mode?: string
  optionalToolsWarnOnly?: boolean
  artifactGate?: VerificationArtifactGateMode
  artifactGateLevels?: VerificationArtifactGateLevel[]
  engineeringStandardsGate?: VerificationEngineeringStandardsGateMode
  productSmokeGate?: VerificationEngineeringStandardsGateMode
  ecosystemReadinessGate?: VerificationEcosystemReadinessGateMode
  ecosystemReadinessPacks?: string[]
  ecosystemReadinessSkillScope?: VerificationEcosystemReadinessSkillScope
}

export interface VerificationMatrix {
  version?: number
  defaultProfile?: string
  profiles?: Record<string, VerificationProfileEntry>
  services?: VerificationService[]
  exclude?: string[]
  policy?: VerificationPolicy
}

export interface ResolveVerificationProfileOptions {
  projectDir?: string
  scaleDir?: string
  profile?: string
  service?: string
  services?: string[]
}

export interface ResolvedVerificationProfile {
  config: VerificationCommandConfig
  profileName: string
  service?: VerificationService
  matrix?: VerificationMatrix
  policy: VerificationPolicy
  warnings: string[]
}

export interface ResolvedVerificationTargets {
  targets: ResolvedVerificationProfile[]
  profileName: string
  matrix?: VerificationMatrix
  policy: VerificationPolicy
  warnings: string[]
}

export const DEFAULT_VERIFICATION_POLICY: VerificationPolicy = {
  optionalToolsWarnOnly: true,
  artifactGate: 'warn',
  artifactGateLevels: ['M', 'L', 'CRITICAL'],
  engineeringStandardsGate: 'block',
  productSmokeGate: 'warn',
  ecosystemReadinessGate: 'warn',
  ecosystemReadinessPacks: ['full'],
  ecosystemReadinessSkillScope: 'required',
}

export function loadVerificationMatrix(
  projectDir = process.cwd(),
  scaleDir = '.scale',
): VerificationMatrix | null {
  const path = verificationMatrixPath(projectDir, scaleDir)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as VerificationMatrix
}

export function resolveVerificationProfile(
  options: ResolveVerificationProfileOptions = {},
): ResolvedVerificationProfile {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? '.scale'
  const matrix = loadVerificationMatrix(projectDir, scaleDir)
  const warnings: string[] = []

  if (!matrix) {
    return {
      config: { cwd: projectDir },
      profileName: options.profile ?? 'auto',
      policy: resolveVerificationPolicy(null),
      warnings: [`No verification matrix found at ${verificationMatrixPath(projectDir, scaleDir)}; using package script auto-detection.`],
    }
  }

  const profileName = options.profile ?? matrix.defaultProfile ?? 'default'
  const profile = matrix.profiles?.[profileName]
  if (options.profile && !profile) {
    warnings.push(`Verification profile "${options.profile}" was not found; using service or auto-detected commands.`)
  }

  const service = options.service
    ? matrix.services?.find(candidate => candidate.name === options.service)
    : undefined
  if (options.service && !service) {
    warnings.push(`Verification service "${options.service}" was not found; using project root.`)
  }

  const cwd = service ? resolve(projectDir, service.path) : projectDir
  const commands = {
    ...defaultCommandsForService(service),
    ...(profile?.commands ?? {}),
    ...(service?.commands ?? {}),
  }

  return {
    config: {
      cwd,
      build: commands.build,
      lint: commands.lint,
      test: commands.test,
      coverage: commands.coverage,
      smoke: commands.smoke,
    },
    profileName,
    service,
    matrix,
    policy: resolveVerificationPolicy(matrix),
    warnings,
  }
}

export function resolveVerificationTargets(
  options: ResolveVerificationProfileOptions = {},
): ResolvedVerificationTargets {
  const projectDir = resolve(options.projectDir ?? process.cwd())
  const scaleDir = options.scaleDir ?? '.scale'
  const matrix = loadVerificationMatrix(projectDir, scaleDir)

  if (!matrix) {
    const target = resolveVerificationProfile(options)
    return {
      targets: [target],
      profileName: target.profileName,
      policy: target.policy,
      warnings: target.warnings,
    }
  }

  const profileName = options.profile ?? matrix.defaultProfile ?? 'default'
  const profile = matrix.profiles?.[profileName]
  const serviceNames = selectServiceNames(matrix, profile, options.service, options.services)

  if (serviceNames.length === 0) {
    const target = resolveVerificationProfile({ ...options, profile: profileName, service: undefined })
    return {
      targets: [target],
      profileName,
      matrix,
      policy: resolveVerificationPolicy(matrix),
      warnings: target.warnings,
    }
  }

  const targets = serviceNames.map(service => resolveVerificationProfile({
    ...options,
    profile: profileName,
    service,
  }))
  return {
    targets,
    profileName,
    matrix,
    policy: resolveVerificationPolicy(matrix),
    warnings: targets.flatMap(target => target.warnings),
  }
}

export function resolveVerificationPolicy(matrix: VerificationMatrix | null | undefined): VerificationPolicy {
  const policy = matrix?.policy ?? {}
  return {
    ...DEFAULT_VERIFICATION_POLICY,
    ...policy,
    artifactGate: normalizeArtifactGate(policy.artifactGate) ?? DEFAULT_VERIFICATION_POLICY.artifactGate,
    artifactGateLevels: normalizeArtifactGateLevels(policy.artifactGateLevels),
    engineeringStandardsGate: normalizeEngineeringStandardsGate(policy.engineeringStandardsGate) ?? DEFAULT_VERIFICATION_POLICY.engineeringStandardsGate,
    productSmokeGate: normalizeEngineeringStandardsGate(policy.productSmokeGate) ?? DEFAULT_VERIFICATION_POLICY.productSmokeGate,
    ecosystemReadinessGate: normalizeEngineeringStandardsGate(policy.ecosystemReadinessGate) ?? DEFAULT_VERIFICATION_POLICY.ecosystemReadinessGate,
    ecosystemReadinessPacks: normalizeEcosystemReadinessPacks(policy.ecosystemReadinessPacks),
    ecosystemReadinessSkillScope: normalizeEcosystemReadinessSkillScope(policy.ecosystemReadinessSkillScope) ?? DEFAULT_VERIFICATION_POLICY.ecosystemReadinessSkillScope,
  }
}

function selectServiceNames(
  matrix: VerificationMatrix,
  profile: VerificationProfileEntry | undefined,
  requestedService: string | undefined,
  requestedServices: string[] = [],
): string[] {
  const requested = unique([
    ...requestedServices,
    ...splitServiceNames(requestedService),
  ])
  if (requested.includes('all')) {
    if (profile?.services?.length) return profile.services
    return (matrix.services ?? [])
      .filter(service => service.required !== false)
      .map(service => service.name)
  }
  if (requested.length > 0) return requested
  return profile?.services ?? []
}

function splitServiceNames(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(service => service.trim())
    .filter(Boolean)
}

function defaultCommandsForService(service: VerificationService | undefined): Partial<Record<VerificationCommandName, string>> {
  if (!service?.type || service.type === 'node' || service.type === 'custom') return {}
  if (service.type === 'go') {
    return {
      build: 'go build ./...',
      lint: 'go vet ./...',
      test: 'go test ./...',
      coverage: 'go test ./... -cover',
    }
  }
  if (service.type === 'python') {
    return {
      build: 'python -m compileall .',
      lint: 'python -m ruff check .',
      test: 'python -m pytest',
      coverage: 'python -m pytest --cov=.',
    }
  }
  return {}
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function verificationMatrixPath(projectDir: string, scaleDir: string): string {
  const root = isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
  return join(root, 'verification.json')
}

function normalizeArtifactGate(value: unknown): VerificationArtifactGateMode | undefined {
  if (value === 'off' || value === 'warn' || value === 'block') return value
  return undefined
}

function normalizeEngineeringStandardsGate(value: unknown): VerificationEngineeringStandardsGateMode | undefined {
  if (value === 'off' || value === 'warn' || value === 'block') return value
  return undefined
}

function normalizeEcosystemReadinessPacks(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_VERIFICATION_POLICY.ecosystemReadinessPacks ?? ['full']
  const valid = new Set(['ui', 'memory', 'knowledge', 'external-cli', 'full'])
  const packs = value
    .map(item => String(item).trim())
    .filter(item => valid.has(item))
  return packs.length > 0 ? [...new Set(packs)] : DEFAULT_VERIFICATION_POLICY.ecosystemReadinessPacks ?? ['full']
}

function normalizeEcosystemReadinessSkillScope(value: unknown): VerificationEcosystemReadinessSkillScope | undefined {
  if (value === 'required' || value === 'recommended' || value === 'all') return value
  return undefined
}

function normalizeArtifactGateLevels(value: unknown): VerificationArtifactGateLevel[] {
  if (!Array.isArray(value)) return DEFAULT_VERIFICATION_POLICY.artifactGateLevels ?? ['M', 'L', 'CRITICAL']
  const levels = value.filter((level): level is VerificationArtifactGateLevel =>
    level === 'M' || level === 'L' || level === 'CRITICAL',
  )
  return levels.length > 0 ? levels : DEFAULT_VERIFICATION_POLICY.artifactGateLevels ?? ['M', 'L', 'CRITICAL']
}

/** Export a resolved verification profile to the open protocol format */
export function exportProfileToOpenFormat(profile: ResolvedVerificationProfile): VerificationProtocol {
  const config = profile.config
  const policy = profile.policy

  // Use the mode field if present; default to 'standard' for the protocol
  const rawMode = policy.mode
  const protocolMode: 'minimal' | 'standard' | 'critical' =
    rawMode === 'minimal' || rawMode === 'critical' ? rawMode : 'standard'

  return {
    $schema: 'https://scale-engine.dev/verification-protocol-v1.schema.json',
    version: '1.0.0',
    project: {
      name: process.env['npm_package_name'] ?? 'unknown',
      language: 'node',
    },
    profiles: {
      [profile.profileName ?? 'default']: {
        description: `${profile.profileName ?? 'default'} verification profile`,
        services: {
          root: {
            type: 'node',
            commands: {
              build: config.build ?? '',
              lint: config.lint ?? '',
              test: config.test ?? '',
              coverage: config.coverage ?? '',
            },
            policy: {
              mode: protocolMode,
              artifactGate: policy.artifactGate ?? 'block',
              engineeringStandardsGate: policy.engineeringStandardsGate ?? 'warn',
              productSmokeGate: policy.productSmokeGate ?? 'warn',
              ecosystemReadinessGate: policy.ecosystemReadinessGate ?? 'warn',
              ecosystemReadinessPacks: policy.ecosystemReadinessPacks ?? ['full'],
              ecosystemReadinessSkillScope: policy.ecosystemReadinessSkillScope ?? 'required',
            },
          },
        },
      },
    },
  }
}

/** Import configuration from the open protocol format */
export function importProfileFromOpenFormat(
  protocol: VerificationProtocol,
): { config: Partial<VerificationCommandConfig>; policy: Partial<VerificationPolicy> } {
  const profileEntry = Object.values(protocol.profiles)[0]
  if (!profileEntry) throw new Error('No profile found in protocol')
  const service = Object.values(profileEntry.services)[0]
  if (!service) throw new Error('No service found in profile')

  return {
    config: {
      build: service.commands['build'],
      lint: service.commands['lint'],
      test: service.commands['test'],
      coverage: service.commands['coverage'],
    },
    policy: {
      mode: service.policy.mode,
      artifactGate: service.policy.artifactGate,
      engineeringStandardsGate: service.policy.engineeringStandardsGate,
      productSmokeGate: service.policy.productSmokeGate,
      ecosystemReadinessGate: service.policy.ecosystemReadinessGate,
      ecosystemReadinessPacks: service.policy.ecosystemReadinessPacks,
      ecosystemReadinessSkillScope: service.policy.ecosystemReadinessSkillScope,
    },
  }
}
