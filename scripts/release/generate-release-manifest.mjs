import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const readText = path => readFileSync(resolve(root, path), 'utf8')
const packageJson = readJson('package.json')
const pluginPackage = readJson('packages/dsh-scale/package.json')
const version = String(packageJson.version ?? '')
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)

// Release tags publish to the default npm dist-tag. Keep this generator stable-only;
// prerelease builds need a separate workflow that explicitly chooses an npm tag.
if (!versionMatch) {
  throw new Error(\`Release manifest requires a stable x.y.z package version; received: \${version}\`)
}
const semver = versionMatch.slice(1, 4).map(Number)

function isFullGitSha(value) {
  return value.length === 40 && Array.from(value).every(char => '0123456789abcdefABCDEF'.includes(char))
}

if (semver.length !== 3 || semver.some(part => !isNumericPart(part))) {
  throw new Error(`Invalid package version: ${version}`)
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = Number(left[index]) - Number(right[index])
    if (delta !== 0) return delta
  }
  return 0
}

const peerRange = pluginPackage.peerDependencies?.[packageJson.name]
const minimumPeerMatch = /^>=(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(peerRange ?? ''))
if (!minimumPeerMatch) {
  throw new Error(\`dsh-scale peer dependency must use a stable >=x.y.z range; received: \${peerRange ?? 'missing'}\`)
}
const minimumPeer = minimumPeerMatch.slice(1, 4).map(Number)
if (compareVersion(semver, minimumPeer) < 0) {
  throw new Error(`dsh-scale requires SCALE Engine ${peerRange}, but package version is ${version}`)
}

for (const readmePath of ['README.md', 'README.en.md']) {
  const readme = readText(readmePath)
  if (!readme.includes(`version-${version}-`) || !readme.includes(`# SCALE Engine v${version}`)) {
    throw new Error(`${readmePath} version badge/heading must match package.json version ${version}`)
  }
}
if (!readText('CHANGELOG.md').includes(`## ${version} -`)) {
  throw new Error(`CHANGELOG.md must contain a release section for ${version}`)
}

const envSha = process.env.GITHUB_SHA?.trim() ?? ''
const candidateSha = isFullGitSha(envSha) ? envSha : git(['rev-parse', 'HEAD'])
const sourceCommit = isFullGitSha(candidateSha) ? candidateSha : null
const dirty = git(['status', '--porcelain']).length > 0
if (process.env.GITHUB_ACTIONS === 'true' && (!sourceCommit || dirty)) {
  throw new Error('Release builds require a clean checkout and a full 40-character Git SHA.')
}

const manifest = {
  schemaVersion: 1,
  package: {
    name: packageJson.name,
    version,
    engines: packageJson.engines ?? {},
  },
  source: {
    commit: sourceCommit,
    dirty,
  },
  build: {
    timestamp: new Date().toISOString(),
    node: process.version,
  },
  plugins: {
    dshScale: {
      name: pluginPackage.name,
      version: pluginPackage.version,
      peerDependencies: pluginPackage.peerDependencies ?? {},
    },
  },
}

const outputDir = resolve(root, 'dist')
mkdirSync(outputDir, { recursive: true })
const outputPath = resolve(outputDir, 'release-manifest.json')
writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + String.fromCharCode(10), 'utf8')
process.stdout.write(`Release manifest written: ${outputPath}` + String.fromCharCode(10))
