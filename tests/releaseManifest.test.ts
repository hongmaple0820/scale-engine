import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = process.cwd()
const generator = readFileSync(resolve(repoRoot, 'scripts/release/generate-release-manifest.mjs'), 'utf8')
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function createFixture(options: { version?: string; peerRange?: string; git?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'scale-release-manifest-'))
  fixtures.push(root)
  mkdirSync(join(root, 'scripts/release'), { recursive: true })
  mkdirSync(join(root, 'packages/dsh-scale'), { recursive: true })
  writeFileSync(join(root, 'scripts/release/generate-release-manifest.mjs'), generator)
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@hongmaple0820/scale-engine',
    version: options.version ?? '0.58.0',
    engines: { node: '>=22.12.0' },
  }))
  writeFileSync(join(root, 'packages/dsh-scale/package.json'), JSON.stringify({
    name: '@hongmaple0820/dsh-scale',
    version: '0.1.2',
    peerDependencies: { '@hongmaple0820/scale-engine': options.peerRange ?? '>=0.55.0' },
  }))
  for (const name of ['README.md', 'README.en.md']) {
    writeFileSync(join(root, name), `# SCALE Engine v${options.version ?? '0.58.0'}\nhttps://img.shields.io/badge/version-${options.version ?? '0.58.0'}-blue\n`)
  }
  writeFileSync(join(root, 'CHANGELOG.md'), `## ${options.version ?? '0.58.0'} - 2026-11-16\n\nRelease notes.\n`)
  writeFileSync(join(root, '.gitignore'), 'dist/\n')
  if (options.git !== false) {
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'scale-test@example.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'SCALE test'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  }
  return root
}

function runGenerator(root: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['scripts/release/generate-release-manifest.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_SHA: '', ...extraEnv },
  })
}

describe('release manifest generator contract', () => {
  it('writes package, plugin, build and full source provenance for a clean stable release', () => {
    const root = createFixture()
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const result = runGenerator(root, { GITHUB_SHA: sha })
    expect(result.status).toBe(0)
    const manifest = JSON.parse(readFileSync(join(root, 'dist/release-manifest.json'), 'utf8'))
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.package).toMatchObject({ name: '@hongmaple0820/scale-engine', version: '0.58.0' })
    expect(manifest.source).toEqual({ commit: sha, dirty: false })
    expect(manifest.build.node).toBe(process.version)
    expect(Number.isNaN(Date.parse(manifest.build.timestamp))).toBe(false)
    expect(manifest.plugins.dshScale).toMatchObject({
      name: '@hongmaple0820/dsh-scale',
      version: '0.1.2',
      peerDependencies: { '@hongmaple0820/scale-engine': '>=0.55.0' },
    })
  })

  it('rejects a release build without a full Git SHA', () => {
    const result = runGenerator(createFixture({ git: false }))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Release builds require a clean checkout and a full 40-character Git SHA')
  })

  it('rejects a dirty release checkout even when GITHUB_SHA is present', () => {
    const root = createFixture()
    writeFileSync(join(root, 'README.md'), 'modified after commit')
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const result = runGenerator(root, { GITHUB_SHA: sha })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Release builds require a clean checkout and a full 40-character Git SHA')
  })

  it('rejects prerelease and non-semver package versions until a tagged prerelease workflow exists', () => {
    for (const version of ['0.58.0-rc.1', '0.58.0+build.7', '00.58.0', '0.58.0.1']) {
      const result = runGenerator(createFixture({ version }))
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('Release manifest requires a stable x.y.z package version')
    }
  })

  it('rejects an invalid or unsupported plugin peer range', () => {
    const result = runGenerator(createFixture({ peerRange: '>=0.55.0 <1.0.0' }))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('dsh-scale peer dependency must use a stable >=x.y.z range')
  })

  it('rejects a main package version below the plugin minimum peer version', () => {
    const result = runGenerator(createFixture({ version: '0.54.9', peerRange: '>=0.55.0' }))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('dsh-scale requires SCALE Engine >=0.55.0')
  })
})
