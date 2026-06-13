import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveVerificationProfile, resolveVerificationTargets } from '../../src/workflow/VerificationProfile.js'

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
