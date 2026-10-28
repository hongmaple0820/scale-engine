import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  exportProfileToOpenFormat,
  importProfileFromOpenFormat,
  resolveVerificationPolicy,
  resolveVerificationProfile,
  resolveVerificationTargets,
} from '../../src/workflow/VerificationProfile.js'
import type { VerificationMatrix } from '../../src/workflow/VerificationProfile.js'

let dirs: string[] = []

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-profile-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.scale'), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of dirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
  dirs = []
})

describe('resolveVerificationProfile', () => {
  it('falls back to root auto-detection when no matrix exists', () => {
    const dir = makeProject()

    const resolved = resolveVerificationProfile({ projectDir: dir })

    expect(resolved.config.cwd).toBe(dir)
    expect(resolved.profileName).toBe('auto')
    expect(resolved.warnings[0]).toContain('No verification matrix found')
  })

  it('resolves service commands and cwd from .scale/verification.json', () => {
    const dir = makeProject()
    mkdirSync(join(dir, 'services', 'api'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: {
          commands: {
            build: 'npm run build',
            lint: 'npm run lint',
          },
        },
      },
      services: [
        {
          name: 'api',
          path: 'services/api',
          type: 'node',
          commands: {
            test: 'npm test',
          },
        },
      ],
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationProfile({ projectDir: dir, service: 'api' })

    expect(resolved.profileName).toBe('default')
    expect(resolved.service?.name).toBe('api')
    expect(resolved.config.cwd).toBe(join(dir, 'services', 'api'))
    expect(resolved.config.build).toBe('npm run build')
    expect(resolved.config.lint).toBe('npm run lint')
    expect(resolved.config.test).toBe('npm test')
  })

  it('resolves all required services for a service matrix run', () => {
    const dir = makeProject()
    mkdirSync(join(dir, 'services', 'api'), { recursive: true })
    mkdirSync(join(dir, 'services', 'worker'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: {
          commands: { test: 'npm test' },
        },
      },
      services: [
        { name: 'api', path: 'services/api', required: true },
        { name: 'worker', path: 'services/worker', required: true },
        { name: 'docs', path: 'docs', required: false },
      ],
      policy: {
        artifactGate: 'block',
        artifactGateLevels: ['L', 'CRITICAL'],
      },
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationTargets({ projectDir: dir, service: 'all' })

    expect(resolved.profileName).toBe('default')
    expect(resolved.targets.map(target => target.service?.name)).toEqual(['api', 'worker'])
    expect(resolved.targets.map(target => target.config.cwd)).toEqual([
      join(dir, 'services', 'api'),
      join(dir, 'services', 'worker'),
    ])
    expect(resolved.targets.every(target => target.config.test === 'npm test')).toBe(true)
    expect(resolved.policy).toMatchObject({
      artifactGate: 'block',
      artifactGateLevels: ['L', 'CRITICAL'],
    })
  })

  it('resolves engineering standards gate policy from the verification matrix', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      policy: {
        engineeringStandardsGate: 'block',
      },
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationTargets({ projectDir: dir })

    expect(resolved.policy).toMatchObject({
      engineeringStandardsGate: 'block',
    })
  })

  it('resolves product smoke profile commands and policy', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: { commands: {} },
        productSmoke: {
          commands: {
            smoke: 'powershell -ExecutionPolicy Bypass -File scripts/qa/product-smoke.ps1',
          },
        },
      },
      policy: {
        productSmokeGate: 'block',
      },
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationProfile({ projectDir: dir, profile: 'productSmoke' })

    expect(resolved.profileName).toBe('productSmoke')
    expect(resolved.config.smoke).toBe('powershell -ExecutionPolicy Bypass -File scripts/qa/product-smoke.ps1')
    expect(resolved.policy).toMatchObject({
      productSmokeGate: 'block',
    })
  })

  it('resolves ecosystem readiness policy and normalizes invalid packs', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      policy: {
        ecosystemReadinessGate: 'block',
        ecosystemReadinessPacks: ['ui', 'invalid-pack', 'knowledge', 'ui'],
      },
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationTargets({ projectDir: dir })

    expect(resolved.policy).toMatchObject({
      ecosystemReadinessGate: 'block',
      ecosystemReadinessPacks: ['ui', 'knowledge'],
    })
  })

  it('resolves explicit ci verification profile commands', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: { commands: { test: 'npm test' } },
        ci: {
          commands: {
            build: 'npm run build',
            lint: 'npm run lint',
            test: 'npm run test:ci',
          },
          services: ['root'],
        },
      },
      services: [
        { name: 'root', path: '.', required: true },
      ],
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationTargets({ projectDir: dir, profile: 'ci' })

    expect(resolved.profileName).toBe('ci')
    expect(resolved.warnings).toEqual([])
    expect(resolved.targets).toHaveLength(1)
    expect(resolved.targets[0].config).toMatchObject({
      build: 'npm run build',
      lint: 'npm run lint',
      test: 'npm run test:ci',
    })
  })

  it('uses profile service selection when no service is requested', () => {
    const dir = makeProject()
    mkdirSync(join(dir, 'services', 'api'), { recursive: true })
    mkdirSync(join(dir, 'services', 'gateway'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'backend',
      profiles: {
        backend: {
          services: ['api', 'gateway'],
          commands: { build: 'npm run build' },
        },
      },
      services: [
        { name: 'api', path: 'services/api' },
        { name: 'gateway', path: 'services/gateway' },
      ],
    }, null, 2), 'utf-8')

    const resolved = resolveVerificationTargets({ projectDir: dir })

    expect(resolved.targets.map(target => target.service?.name)).toEqual(['api', 'gateway'])
    expect(resolved.targets.every(target => target.config.build === 'npm run build')).toBe(true)
  })

  it('resolves explicit comma-separated and array service selections', () => {
    const dir = makeProject()
    mkdirSync(join(dir, 'services', 'api'), { recursive: true })
    mkdirSync(join(dir, 'services', 'gateway'), { recursive: true })
    mkdirSync(join(dir, 'services', 'worker'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: { test: 'npm test' } } },
      services: [
        { name: 'api', path: 'services/api' },
        { name: 'gateway', path: 'services/gateway' },
        { name: 'worker', path: 'services/worker' },
      ],
    }, null, 2), 'utf-8')

    const fromCli = resolveVerificationTargets({ projectDir: dir, service: 'api,gateway' })
    const fromTask = resolveVerificationTargets({ projectDir: dir, services: ['gateway', 'worker'] })

    expect(fromCli.targets.map(target => target.service?.name)).toEqual(['api', 'gateway'])
    expect(fromTask.targets.map(target => target.service?.name)).toEqual(['gateway', 'worker'])
  })

  it('provides language-aware defaults for Go and Python services', () => {
    const dir = makeProject()
    mkdirSync(join(dir, 'services', 'go-api'), { recursive: true })
    mkdirSync(join(dir, 'services', 'py-worker'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: {} } },
      services: [
        { name: 'go-api', path: 'services/go-api', type: 'go' },
        { name: 'py-worker', path: 'services/py-worker', type: 'python' },
      ],
    }, null, 2), 'utf-8')

    const go = resolveVerificationProfile({ projectDir: dir, service: 'go-api' })
    const python = resolveVerificationProfile({ projectDir: dir, service: 'py-worker' })

    expect(go.config).toMatchObject({
      build: 'go build ./...',
      lint: 'go vet ./...',
      test: 'go test ./...',
      coverage: 'go test ./... -cover',
    })
    expect(python.config).toMatchObject({
      build: 'python -m compileall .',
      lint: 'python -m ruff check .',
      test: 'python -m pytest',
      coverage: 'python -m pytest --cov=.',
    })
  })
})

describe('resolveVerificationPolicy normalization', () => {
  it('keeps valid gate modes, levels, packs, and skill scope', () => {
    const policy = resolveVerificationPolicy({
      profiles: {},
      policy: {
        artifactGate: 'off',
        engineeringStandardsGate: 'warn',
        productSmokeGate: 'off',
        ecosystemReadinessGate: 'block',
        artifactGateLevels: ['M', 'CRITICAL'],
        ecosystemReadinessPacks: ['ui', 'invalid-pack', 'ui'],
        ecosystemReadinessSkillScope: 'all',
      },
    })

    expect(policy).toMatchObject({
      artifactGate: 'off',
      engineeringStandardsGate: 'warn',
      productSmokeGate: 'off',
      ecosystemReadinessGate: 'block',
      artifactGateLevels: ['M', 'CRITICAL'],
      ecosystemReadinessPacks: ['ui'],
      ecosystemReadinessSkillScope: 'all',
    })
  })

  it('falls back to defaults for unknown gate modes and empty lists', () => {
    const policy = resolveVerificationPolicy({
      profiles: {},
      policy: {
        artifactGate: 'bogus',
        engineeringStandardsGate: 'bogus',
        productSmokeGate: 'bogus',
        ecosystemReadinessGate: 'bogus',
        artifactGateLevels: ['X'],
        ecosystemReadinessPacks: ['unknown-pack'],
        ecosystemReadinessSkillScope: 'bogus',
      },
    } as unknown as VerificationMatrix)

    expect(policy).toMatchObject({
      artifactGate: 'warn',
      engineeringStandardsGate: 'block',
      productSmokeGate: 'warn',
      ecosystemReadinessGate: 'warn',
      artifactGateLevels: ['M', 'L', 'CRITICAL'],
      ecosystemReadinessPacks: ['full'],
      ecosystemReadinessSkillScope: 'required',
    })
  })

  it('treats non-array pack and level values as unset', () => {
    const policy = resolveVerificationPolicy({
      profiles: {},
      policy: {
        artifactGateLevels: 'L',
        ecosystemReadinessPacks: 'ui',
      },
    } as unknown as VerificationMatrix)

    expect(policy.artifactGateLevels).toEqual(['M', 'L', 'CRITICAL'])
    expect(policy.ecosystemReadinessPacks).toEqual(['full'])
  })

  it('returns defaults when no matrix or policy is present', () => {
    expect(resolveVerificationPolicy(null)).toMatchObject({
      optionalToolsWarnOnly: true,
      artifactGate: 'warn',
      engineeringStandardsGate: 'block',
      ecosystemReadinessSkillScope: 'required',
    })
    expect(resolveVerificationPolicy(undefined)).toEqual(resolveVerificationPolicy(null))
  })
})

describe('resolveVerificationProfile fallbacks', () => {
  it('warns when an explicit profile and service are missing', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: { test: 'npm test' } } },
      services: [{ name: 'api', path: 'services/api' }],
    }), 'utf-8')

    const resolved = resolveVerificationProfile({ projectDir: dir, profile: 'missing', service: 'ghost' })

    expect(resolved.profileName).toBe('missing')
    expect(resolved.service).toBeUndefined()
    expect(resolved.config.cwd).toBe(dir)
    expect(resolved.warnings).toEqual([
      expect.stringContaining('Verification profile "missing" was not found'),
      expect.stringContaining('Verification service "ghost" was not found'),
    ])
  })

  it('supports an absolute scale directory', () => {
    const dir = makeProject()
    const scaleDir = join(dir, 'custom-scale')
    mkdirSync(scaleDir, { recursive: true })
    writeFileSync(join(scaleDir, 'verification.json'), JSON.stringify({
      version: 1,
      profiles: { default: { commands: { test: 'custom test' } } },
    }), 'utf-8')

    const resolved = resolveVerificationProfile({ projectDir: dir, scaleDir })

    expect(resolved.config.test).toBe('custom test')
    expect(resolved.config.cwd).toBe(dir)
  })

  it('adds no language defaults for custom or missing service types', () => {
    const dir = makeProject()
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      profiles: { default: { commands: {} } },
      services: [
        { name: 'custom-tool', path: '.', type: 'custom' },
        { name: 'plain', path: '.' },
        { name: 'mystery', path: '.', type: 'rust' },
      ],
    }), 'utf-8')

    for (const service of ['custom-tool', 'plain', 'mystery']) {
      // `toEqual` ignores undefined-valued keys, so this also fails if an
      // unknown/missing service type starts contributing language defaults.
      expect(resolveVerificationProfile({ projectDir: dir, service }).config).toEqual({ cwd: dir })
    }
  })

  it('falls back to a single auto target when no matrix exists', () => {
    const dir = makeProject()

    const resolved = resolveVerificationTargets({ projectDir: dir })

    expect(resolved.profileName).toBe('auto')
    expect(resolved.targets).toHaveLength(1)
    expect(resolved.targets[0].profileName).toBe('auto')
    expect(resolved.warnings[0]).toContain('No verification matrix found')
  })

  it('prefers profile services when all is requested', () => {
    const dir = makeProject()
    mkdirSync(join(dir, 'services', 'api'), { recursive: true })
    mkdirSync(join(dir, 'services', 'worker'), { recursive: true })
    writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { services: ['api'], commands: { test: 'npm test' } } },
      services: [
        { name: 'api', path: 'services/api' },
        { name: 'worker', path: 'services/worker' },
      ],
    }), 'utf-8')

    const resolved = resolveVerificationTargets({ projectDir: dir, service: 'all' })

    expect(resolved.targets.map(target => target.service?.name)).toEqual(['api'])
  })
})

describe('open verification protocol', () => {
  it('round-trips a resolved profile', () => {
    const dir = makeProject()
    const resolved = resolveVerificationProfile({ projectDir: dir })

    const protocol = exportProfileToOpenFormat(resolved)
    const exported = protocol.profiles['auto'].services['root']

    expect(exported.commands).toEqual({ build: '', lint: '', test: '', coverage: '' })
    expect(exported.policy.mode).toBe('standard')

    const imported = importProfileFromOpenFormat(protocol)
    expect(imported.config).toEqual({ build: '', lint: '', test: '', coverage: '' })
    expect(imported.policy.mode).toBe('standard')
  })

  it('maps minimal and critical policy modes', () => {
    const dir = makeProject()

    for (const mode of ['minimal', 'critical']) {
      writeFileSync(join(dir, '.scale', 'verification.json'), JSON.stringify({
        version: 1,
        defaultProfile: 'default',
        profiles: { default: { commands: {} } },
        policy: { mode },
      }), 'utf-8')

      const protocol = exportProfileToOpenFormat(resolveVerificationProfile({ projectDir: dir }))
      expect(protocol.profiles['default'].services['root'].policy.mode).toBe(mode)
    }
  })

  it('rejects protocols without a profile or service', () => {
    const dir = makeProject()
    const protocol = exportProfileToOpenFormat(resolveVerificationProfile({ projectDir: dir }))

    expect(() => importProfileFromOpenFormat({ ...protocol, profiles: {} }))
      .toThrow('No profile found in protocol')

    expect(() => importProfileFromOpenFormat({
      ...protocol,
      profiles: { empty: { description: 'empty', services: {} } },
    })).toThrow('No service found in profile')
  })
})
