import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const readText = path => readFileSync(resolve(root, path), 'utf8')
const packageJson = readJson('package.json')
const pluginPackage = readJson('packages/dsh-scale/package.json')
const version = String(packageJson.version ?? '')
const versionMatch = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.exec(version)

// Release tags publish to the default npm dist-tag. Keep this generator stable-only;
// prerelease builds need a separate workflow that explicitly chooses an npm tag.
if (!versionMatch) {
  throw new Error(`Release manifest requires a stable x.y.z package version; received: ${version}`)
}
const semver = versionMatch.slice(1, 4).map(Number)

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const delta = left[index] - right[index]
    if (delta !== 0) return delta
  }
  return 0
}

