#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_CORE_DOCS = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/README.md',
  'docs/guides/GETTING_STARTED.md',
  'docs/guides/DEVELOPMENT_WORKFLOW.md',
  'docs/workflow/README.md',
  'docs/workflow/GATES_AND_SCORE.md',
]

const DEFAULT_CONFIG_FILES = [
  'package.json',
  '.agent/project.json',
  '.scale/verification.json',
  '.scale/skills.json',
  '.scale/memory-providers.json',
  '.scale/resource-policy.json',
  '.scale/workspace.json',
]

const ROOT_ARTIFACT_EXTENSIONS = new Set([
  '.7z',
  '.gif',
  '.har',
  '.jpeg',
  '.jpg',
  '.log',
  '.mov',
  '.mp4',
  '.png',
  '.tar',
  '.tgz',
  '.trace',
  '.webm',
  '.zip',
])

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
])

const MOJIBAKE_PATTERNS = [
  /\uFFFD/,
  /(?:Ã.|Â.|â€™|â€œ|â€�|â€“|â€”)/,
  /(?:鈥|鉁|锛|閫|瀛|涔|鐨|瑙|璇|浠|闂|妫|鏂){2,}/,
]

const MERGE_MARKER_PATTERN = /^(<<<<<<<|=======|>>>>>>>)(?: .*)?$/m
const SECRET_PATTERN = /\b(password|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*['"]?[A-Za-z0-9_./+=-]{16,}/i

function normalizePath(path) {
  return path.replace(/\\/g, '/')
}

function toDisplayPath(root, path) {
  return normalizePath(relative(root, path))
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
}

function command(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function trackedAndUntrackedChanges(root) {
  return Array.from(new Set([
    ...command(root, ['diff', '--name-only', 'HEAD']),
    ...command(root, ['ls-files', '--others', '--exclude-standard']),
  ])).map(normalizePath)
}

function loadResourcePolicy(root) {
  const path = join(root, '.scale', 'resource-policy.json')
  if (!existsSync(path)) return { maxGitFileSizeBytes: 5 * 1024 * 1024 }
  try {
    const policy = JSON.parse(readText(path))
    return {
      maxGitFileSizeBytes: Number(policy.maxGitFileSizeBytes) || 5 * 1024 * 1024,
    }
  } catch {
    return { maxGitFileSizeBytes: 5 * 1024 * 1024 }
  }
}

function findDuplicateJsonKeys(text) {
  let i = 0
  const duplicates = []

  function fail(message) {
    throw new Error(`${message} at offset ${i}`)
  }

  function skipWhitespace() {
    while (/\s/.test(text[i] || '')) i += 1
  }

  function parseString() {
    skipWhitespace()
    if (text[i] !== '"') fail('expected string')
    const start = i
    i += 1
    while (i < text.length) {
      const char = text[i]
      if (char === '\\') {
        i += 2
        continue
      }
      if (char === '"') {
        i += 1
        return JSON.parse(text.slice(start, i))
      }
      i += 1
    }
    fail('unterminated string')
  }

  function parsePrimitive() {
    const start = i
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i += 1
    if (start === i) fail('expected value')
  }

  function parseArray(path) {
    i += 1
    skipWhitespace()
    if (text[i] === ']') {
      i += 1
      return
    }
    let index = 0
    while (i < text.length) {
      parseValue([...path, String(index)])
      index += 1
      skipWhitespace()
      if (text[i] === ',') {
        i += 1
        continue
      }
      if (text[i] === ']') {
        i += 1
        return
      }
      fail('expected comma or closing array')
    }
  }

  function parseObject(path) {
    i += 1
    const seen = new Set()
    skipWhitespace()
    if (text[i] === '}') {
      i += 1
      return
    }
    while (i < text.length) {
      const key = parseString()
      const keyPath = [...path, key].join('.') || key
      if (seen.has(key)) duplicates.push(keyPath)
      seen.add(key)
      skipWhitespace()
      if (text[i] !== ':') fail('expected colon')
      i += 1
      parseValue([...path, key])
      skipWhitespace()
      if (text[i] === ',') {
        i += 1
        skipWhitespace()
        continue
      }
      if (text[i] === '}') {
        i += 1
        return
      }
      fail('expected comma or closing object')
    }
  }

  function parseValue(path) {
    skipWhitespace()
    const char = text[i]
    if (char === '{') return parseObject(path)
    if (char === '[') return parseArray(path)
    if (char === '"') {
      parseString()
      return
    }
    parsePrimitive()
  }

  parseValue([])
  skipWhitespace()
  if (i < text.length) fail('unexpected trailing content')
  return duplicates
}

function inspectTextFile(root, relPath, failures, detail) {
  const path = join(root, relPath)
  if (!existsSync(path)) {
    failures.push({ id: 'source-doc-health', file: relPath, message: 'required maintained document is missing' })
    return
  }
  const text = readText(path)
  detail.documents += 1
  if (MERGE_MARKER_PATTERN.test(text)) {
    failures.push({ id: 'source-doc-health', file: relPath, message: 'merge marker detected' })
  }
  if (MOJIBAKE_PATTERNS.some(pattern => pattern.test(text))) {
    failures.push({ id: 'source-doc-health', file: relPath, message: 'possible mojibake or replacement characters detected' })
  }
  if (SECRET_PATTERN.test(text)) {
    failures.push({ id: 'source-doc-health', file: relPath, message: 'possible hardcoded secret detected' })
  }
}

function checkSourceDocHealth(root) {
  const failures = []
  const detail = { documents: 0 }
  for (const relPath of DEFAULT_CORE_DOCS) inspectTextFile(root, relPath, failures, detail)
  return { id: 'source-doc-health', failures, detail }
}

function checkConfigHealth(root) {
  const failures = []
  const detail = { files: 0 }
  for (const relPath of DEFAULT_CONFIG_FILES) {
    const path = join(root, relPath)
    if (!existsSync(path)) continue
    detail.files += 1
    const text = readText(path)
    try {
      JSON.parse(text)
    } catch (error) {
      failures.push({ id: 'config-health', file: relPath, message: `invalid JSON: ${error.message}` })
      continue
    }
    try {
      const duplicates = findDuplicateJsonKeys(text)
      for (const duplicate of duplicates) {
        failures.push({ id: 'config-health', file: relPath, message: `duplicate JSON key: ${duplicate}` })
      }
    } catch (error) {
      failures.push({ id: 'config-health', file: relPath, message: `duplicate-key scan failed: ${error.message}` })
    }
  }
  return { id: 'config-health', failures, detail }
}

function checkChangeDocumentationCoupling(root) {
  const changedFiles = trackedAndUntrackedChanges(root)
  const workflowImpact = changedFiles.filter(file =>
    file.startsWith('src/') ||
    file.startsWith('scripts/') ||
    file.startsWith('.github/workflows/') ||
    file.startsWith('.agent/') ||
    file.startsWith('.scale/') ||
    file === 'package.json' ||
    file === 'Makefile'
  )
  const docImpact = changedFiles.filter(file =>
    file === 'README.md' ||
    file === 'AGENTS.md' ||
    file === 'CLAUDE.md' ||
    file.startsWith('docs/workflow/') ||
    file.startsWith('docs/guides/') ||
    file.startsWith('docs/start/')
  )
  const failures = []
  if (workflowImpact.length > 0 && docImpact.length === 0) {
    failures.push({
      id: 'change-documentation-coupling',
      message: 'workflow/source/config changes require an entry doc, workflow doc, guide, or start doc update',
      files: workflowImpact.slice(0, 20),
    })
  }
  return {
    id: 'change-documentation-coupling',
    failures,
    detail: { changedFiles: changedFiles.length, workflowImpact: workflowImpact.length, docImpact: docImpact.length },
  }
}

function checkRootArtifactPlacement(root) {
  const failures = []
  const entries = readdirSync(root, { withFileTypes: true })
  let inspectedRootFiles = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    inspectedRootFiles += 1
    const relPath = entry.name
    const lower = entry.name.toLowerCase()
    const ext = extname(lower)
    if (ROOT_ARTIFACT_EXTENSIONS.has(ext)) {
      failures.push({
        id: 'root-artifact-placement',
        file: relPath,
        message: 'runtime/media/archive artifact must be moved under docs/assets, tests/artifacts, .scale/reports, or .agent/logs',
      })
    }
  }
  return { id: 'root-artifact-placement', failures, detail: { inspectedRootFiles } }
}

function checkChangedFileSizePolicy(root) {
  const policy = loadResourcePolicy(root)
  const changedFiles = trackedAndUntrackedChanges(root)
  const failures = []
  let oversizedFiles = 0
  for (const file of changedFiles) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const stat = statSync(path)
    if (!stat.isFile()) continue
    if (stat.size > policy.maxGitFileSizeBytes) {
      oversizedFiles += 1
      failures.push({
        id: 'changed-file-size-policy',
        file,
        message: `changed file exceeds maxGitFileSizeBytes (${stat.size} > ${policy.maxGitFileSizeBytes})`,
      })
    }
  }
  return {
    id: 'changed-file-size-policy',
    failures,
    detail: { maxGitFileSizeBytes: policy.maxGitFileSizeBytes, oversizedFiles },
  }
}

function markdownFilesForLinkCheck(root) {
  const changedMarkdown = trackedAndUntrackedChanges(root).filter(file => file.endsWith('.md'))
  return Array.from(new Set([...DEFAULT_CORE_DOCS, ...changedMarkdown]))
    .filter(file => existsSync(join(root, file)))
}

function extractMarkdownTargets(text) {
  const targets = []
  const pattern = /!?\[[^\]]*]\(([^)]+)\)/g
  let match
  while ((match = pattern.exec(text))) {
    const rawTarget = match[1].trim()
    if (!rawTarget || rawTarget.startsWith('#')) continue
    if (/^(https?:|mailto:|tel:)/i.test(rawTarget)) continue
    targets.push(rawTarget.split('#')[0])
  }
  return targets.filter(Boolean)
}

function checkMarkdownLinkHealth(root) {
  const failures = []
  const files = markdownFilesForLinkCheck(root)
  let links = 0
  for (const relPath of files) {
    const path = join(root, relPath)
    const text = readText(path)
    for (const target of extractMarkdownTargets(text)) {
      links += 1
      const cleanTarget = decodeURI(target)
      const resolved = resolve(dirname(path), cleanTarget)
      if (!resolved.startsWith(root) || (!existsSync(resolved))) {
        failures.push({ id: 'markdown-link-health', file: relPath, message: `broken internal markdown link: ${target}` })
      }
    }
  }
  return { id: 'markdown-link-health', failures, detail: { documents: files.length, links } }
}

const CHECKS = new Map([
  ['source-doc-health', checkSourceDocHealth],
  ['config-health', checkConfigHealth],
  ['change-documentation-coupling', checkChangeDocumentationCoupling],
  ['root-artifact-placement', checkRootArtifactPlacement],
  ['changed-file-size-policy', checkChangedFileSizePolicy],
  ['markdown-link-health', checkMarkdownLinkHealth],
])

export function runDocsHealth(options = {}) {
  const root = resolve(options.root ?? process.cwd())
  const requestedChecks = options.checks?.length ? options.checks : Array.from(CHECKS.keys())
  const checks = []
  const failures = []

  for (const id of requestedChecks) {
    const check = CHECKS.get(id)
    if (!check) {
      failures.push({ id: 'unknown-check', message: `unknown docs-health check: ${id}` })
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
    console.log(`[docs-health] ${check.id}: ${check.status}`)
  }
  for (const failure of report.failures) {
    const file = failure.file ? `${failure.file}: ` : ''
    console.error(`[docs-health] FAIL ${failure.id}: ${file}${failure.message}`)
  }
  console.log(report.ok ? '[docs-health] passed' : '[docs-health] failed')
}

function usage() {
  console.log(`Usage: node scripts/workflow/docs-health.mjs [--json] [--report path] [--check id] [--root path]

Checks:
  ${Array.from(CHECKS.keys()).join('\n  ')}`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    usage()
    return
  }
  const report = runDocsHealth(options)
  if (options.report) {
    const reportPath = resolve(options.root ?? process.cwd(), options.report)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printHuman(report)
  }
  if (!report.ok) process.exit(1)
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(currentFile).href) {
  main()
}
