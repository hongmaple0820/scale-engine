import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getScaleEngineVersion, getScaleEngineReleaseManifest, SCALE_ENGINE_VERSION } from '../../src/version.js'

describe('version', () => {
  it('uses package.json as the runtime version source', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }

    expect(getScaleEngineVersion()).toBe(packageJson.version)
    expect(SCALE_ENGINE_VERSION).toBe(packageJson.version)
  })

  it('returns a schema-versioned manifest with explicit unknown provenance in source mode', () => {
    const manifest = getScaleEngineReleaseManifest()
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.package.version).toBe(SCALE_ENGINE_VERSION)
    expect(manifest.source).toEqual({ commit: null, dirty: null })
    expect(manifest.build).toEqual({ timestamp: null, node: null })
  })

  it('keeps a single release readiness script for publishing gates', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { scripts: Record<string, string> }
    const script = packageJson.scripts['release:check']

    expect(script).toContain('npm run typecheck')
    expect(script).toContain('npm run lint')
    expect(script).toContain('npm test')
    expect(script).toContain('npm run smoke:setup')
    expect(script).toContain('npm run smoke:providers -- --write-report')
    expect(script).toContain('npm run build')
    expect(script).toContain('npm audit --omit=dev')
    expect(script).toContain('npm pack --dry-run')
    expect(script).toContain('npm run typecheck --prefix packages/dsh-scale')
  })

  it('exposes repeatable real-provider rehearsal scripts and keeps stricter variants explicit', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as { scripts: Record<string, string>; files: string[] }

    expect(packageJson.scripts['smoke:providers']).toBe('node scripts/workflow/provider-rehearsal.mjs')
    expect(packageJson.scripts['smoke:gbrain']).toContain('--require-gbrain')
    expect(packageJson.scripts['smoke:graphify']).toContain('--require-graphify')
    expect(packageJson.scripts['release:check']).not.toContain('--require-gbrain')
    expect(packageJson.scripts['release:check']).not.toContain('--require-graphify')
    expect(packageJson.files).toContain('scripts/workflow/lib')
    expect(packageJson.files).toContain('scripts/workflow/provider-rehearsal.mjs')
  })
  it('makes tag publishing use the full release gate and rejects mismatched tags', () => {
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf-8')
    expect(workflow).toContain('TAG_VERSION="${GITHUB_REF_NAME#v}"')
    expect(workflow).toContain('run: npm run release:check')
  })
})
