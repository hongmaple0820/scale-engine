#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REQUIRED_PROFILE_COMMANDS = ['default', 'ci']
const REQUIRED_WORKFLOWS = [
  '.github/workflows/publish.yml',
  '.github/workflows/ci-source.yml',
  '.github/workflows/scale-gate.yml',
]

function normalizePath(path) {
  return path.replace(/\\/g, '/')
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
}

function readJson(root, relPath, failures, checkId) {
  const path = join(root, relPath)
  if (!existsSync(path)) {
    failures.push({ id: checkId, file: relPath, message: 'required governance file is missing' })
    return null
  }
  try {
    return JSON.parse(readText(path))
  } catch (error) {
    failures.push({ id: checkId, file: relPath, message: `invalid JSON: ${error.message}` })
    return null
  }
}

function hasPackageFile(packageJson, relPath) {
  return Array.isArray(packageJson?.files)
    && packageJson.files.map(String).map(normalizePath).includes(relPath)
}

function commandText(profile) {
  return Object.values(profile?.commands ?? {}).map(String).join('\n')
}

function checkSkillSourcePolicy(root) {
  const failures = []
  const skills = readJson(root, '.scale/skills.json', failures, 'skill-source-policy')
  const manifestPath = '.scale/skills/manifest.json'
  const sourceRoots = skills?.skillSources ?? {}
  if (sourceRoots.primaryRoot !== '.scale/skills') {
    failures.push({
      id: 'skill-source-policy',
      file: '.scale/skills.json',
      message: 'skillSources.primaryRoot must be .scale/skills for repo-local reusable skills',
    })
  }
  if (!Array.isArray(sourceRoots.fallbackRoots) || !sourceRoots.fallbackRoots.includes('skills')) {
    failures.push({
      id: 'skill-source-policy',
      file: '.scale/skills.json',
      message: 'skillSources.fallbackRoots must keep skills for legacy project compatibility',
    })
  }
  if (!existsSync(join(root, manifestPath))) {
    failures.push({
      id: 'skill-source-policy',
      file: manifestPath,
      message: 'repo-local skill manifest must live under the canonical .scale/skills root',
    })
  }
  return {
    id: 'skill-source-policy',
    failures,
    detail: {
      primaryRoot: sourceRoots.primaryRoot ?? null,
      manifest: existsSync(join(root, manifestPath)),
    },
  }
}

function checkLearningMemoryPolicy(root) {
  const failures = []
  const memory = readJson(root, '.scale/memory-providers.json', failures, 'learning-memory-policy')
  const routing = memory?.routing ?? {}
  if (routing.requireEvidence !== true) {
    failures.push({
      id: 'learning-memory-policy',
      file: '.scale/memory-providers.json',
      message: 'routing.requireEvidence must stay true so memory recall needs evidence, not provider presence alone',
    })
  }
  if (routing.allowExternalWrite !== false) {
    failures.push({
      id: 'learning-memory-policy',
      file: '.scale/memory-providers.json',
      message: 'routing.allowExternalWrite must default to false; learned notes should be reviewed before external writes',
    })
  }
  if (!Array.isArray(routing.defaultOrder) || !routing.defaultOrder.includes('gbrain')) {
    failures.push({
      id: 'learning-memory-policy',
      file: '.scale/memory-providers.json',
      message: 'routing.defaultOrder must include gbrain as the reviewed external memory provider',
    })
  }
  return {
    id: 'learning-memory-policy',
    failures,
    detail: {
      requireEvidence: routing.requireEvidence ?? null,
      allowExternalWrite: routing.allowExternalWrite ?? null,
      defaultOrder: routing.defaultOrder ?? [],
    },
  }
}

function checkLearningVerificationChain(root) {
  const failures = []
  const verification = readJson(root, '.scale/verification.json', failures, 'learning-verification-chain')
  const profiles = verification?.profiles ?? {}
  for (const name of REQUIRED_PROFILE_COMMANDS) {
    const text = commandText(profiles[name])
    if (!text.includes('learning-health.mjs')) {
      failures.push({
        id: 'learning-verification-chain',
        file: '.scale/verification.json',
        message: `profile ${name} must run scripts/workflow/learning-health.mjs`,
      })
    }
  }
  const packageJson = readJson(root, 'package.json', failures, 'learning-verification-chain')
  const releaseCheck = String(packageJson?.scripts?.['release:check'] ?? '').trim()
  if (!/^npm run learning:health\b/.test(releaseCheck)) {
    failures.push({
      id: 'learning-verification-chain',
      file: 'package.json',
      message: 'release:check must start with npm run learning:health before other release gates',
    })
  }
  if (!String(packageJson?.scripts?.['learning:health'] ?? '').includes('learning-health.mjs')) {
    failures.push({
      id: 'learning-verification-chain',
      file: 'package.json',
      message: 'package scripts must expose learning:health',
    })
  }
  for (const workflow of REQUIRED_WORKFLOWS) {
    const path = join(root, workflow)
    if (!existsSync(path)) {
      failures.push({
        id: 'learning-verification-chain',
        file: workflow,
        message: 'required CI/release workflow is missing from learning gate coverage',
      })
      continue
    }
    const text = readText(path)
    if (!text.includes('npm run learning:health')) {
      failures.push({
        id: 'learning-verification-chain',
        file: workflow,
        message: 'CI/release workflow must run npm run learning:health before publish or gate execution',
      })
    }
  }
  return {
    id: 'learning-verification-chain',
    failures,
    detail: {
      profiles: REQUIRED_PROFILE_COMMANDS,
      workflows: REQUIRED_WORKFLOWS,
      releaseCheckWired: /^npm run learning:health\b/.test(releaseCheck),
    },
  }
}

function checkReleasePackageSurface(root) {
  const failures = []
  const packageJson = readJson(root, 'package.json', failures, 'release-package-surface')
  for (const relPath of ['.scale/skills', 'scripts/workflow/learning-health.mjs']) {
    if (!hasPackageFile(packageJson, relPath)) {
      failures.push({
        id: 'release-package-surface',
        file: 'package.json',
        message: `package files must include ${relPath}`,
      })
    }
  }
  return {
    id: 'release-package-surface',
    failures,
    detail: {
      files: packageJson?.files ?? [],
    },
  }
}

function checkLearningArtifactTemplates(root) {
  const failures = []
  const required = [
    {
      file: 'docs/workflow/templates/verification.md',
      markers: ['## Regression / Stability Checks', '## Learning Evidence'],
    },
    {
      file: 'docs/workflow/templates/summary.md',
      markers: ['## Learning And Prevention'],
    },
  ]
  for (const item of required) {
    const path = join(root, item.file)
    if (!existsSync(path)) {
      failures.push({ id: 'learning-artifact-templates', file: item.file, message: 'required learning artifact template is missing' })
      continue
    }
    const text = readText(path)
    for (const marker of item.markers) {
      if (!text.includes(marker)) {
        failures.push({
          id: 'learning-artifact-templates',
          file: item.file,
          message: `missing required learning section: ${marker}`,
        })
      }
    }
  }
  return {
    id: 'learning-artifact-templates',
    failures,
    detail: {
      files: required.map(item => item.file),
    },
  }
}

const CHECKS = new Map([
  ['skill-source-policy', checkSkillSourcePolicy],
  ['learning-memory-policy', checkLearningMemoryPolicy],
  ['learning-verification-chain', checkLearningVerificationChain],
  ['release-package-surface', checkReleasePackageSurface],
  ['learning-artifact-templates', checkLearningArtifactTemplates],
])

export function runLearningHealth(options = {}) {
  const root = resolve(options.root ?? process.cwd())
  const requestedChecks = options.checks?.length ? options.checks : Array.from(CHECKS.keys())
  const checks = []
  const failures = []

  for (const id of requestedChecks) {
    const check = CHECKS.get(id)
    if (!check) {
      failures.push({ id: 'unknown-check', message: `unknown learning-health check: ${id}` })
      continue
    }
    const result = check(root)
    checks.push({
      id: result.id,
      status: result.failures.length === 0 ? 'passed' : 'failed',
      detail: result.detail,
    })
    failures.push(...result.failures)
  }

  return {
    ok: failures.length === 0,
    root,
    checks,
    failures,
    warnings: [],
  }
}

function parseArgs(argv) {
  const options = { json: false, checks: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
    } else if (arg === '--report') {
      options.report = argv[++i]
    } else if (arg === '--check') {
      options.checks.push(argv[++i])
    } else if (arg === '--root') {
      options.root = argv[++i]
    } else if (arg === '-h' || arg === '--help') {
      options.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

function printHuman(report) {
  for (const check of report.checks) {
    console.log(`[learning-health] ${check.id}: ${check.status}`)
  }
  for (const failure of report.failures) {
    const file = failure.file ? `${failure.file}: ` : ''
    console.error(`[learning-health] FAIL ${failure.id}: ${file}${failure.message}`)
  }
  console.log(report.ok ? '[learning-health] passed' : '[learning-health] failed')
}

function usage() {
  console.log(`Usage: node scripts/workflow/learning-health.mjs [--json] [--report path] [--check id] [--root path]

Checks:
  ${Array.from(CHECKS.keys()).join('\n  ')}`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }
  const report = runLearningHealth(options)
  if (options.report) {
    const reportPath = resolve(options.root ?? process.cwd(), options.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else printHuman(report)
  if (!report.ok) process.exit(1)
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  main()
}
