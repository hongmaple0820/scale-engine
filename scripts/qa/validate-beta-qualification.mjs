#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

const REQUIRED_STAGES = [
  'install',
  'upgrade-migration',
  'ai-os-plan',
  'governed-run',
  'dashboard-health',
  'benchmark-eval',
  'smoke-preflight',
  'package-build',
]
const STAGE_STATUSES = new Set(['passed', 'failed', 'blocked', 'not-applicable'])
const OVERALL_STATUSES = new Set(['passed', 'failed', 'blocked', 'pending-review'])
const REVIEW_DECISIONS = new Set(['pending', 'approved', 'rejected'])
const SHA_PATTERN = /^[a-f0-9]{40}$/
const errors = []

function fail(path, message) {
  errors.push(`${path}: ${message}`)
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseIsoTimestamp(value) {
  if (!nonEmpty(value)) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const offsetHourText = match[10]
  const offsetMinuteText = match[11]
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = Number(offsetHourText ?? 0)
  const offsetMinute = Number(offsetMinuteText ?? 0)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function safeArtifactPath(value) {
  if (!nonEmpty(value) || isAbsolute(value) || /^[a-zA-Z]:/.test(value) || /^[\\/]/.test(value)) {
    return false
  }
  const segments = value.split(/[\\/]/)
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

function checkObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object')
    return false
  }
  return true
}

function validate(record) {
  if (!checkObject(record, 'root')) return
  if (record.schemaVersion !== 1) fail('schemaVersion', 'must equal 1')
  if (!['node-ts-library', 'python-service', 'multi-package-app'].includes(record.qualificationId)) {
    fail('qualificationId', 'must be one of node-ts-library, python-service, multi-package-app')
  }
  if (!nonEmpty(record.runId)) fail('runId', 'must be a non-empty string')
  if (!OVERALL_STATUSES.has(record.status)) fail('status', 'must be passed, failed, blocked, or pending-review')

  const source = record.source
  if (checkObject(source, 'source')) {
    if (!nonEmpty(source.scaleEngineVersion)) fail('source.scaleEngineVersion', 'is required')
    if (!SHA_PATTERN.test(source.scaleEngineCommit ?? '')) fail('source.scaleEngineCommit', 'must be a full 40-character Git SHA')
    if (!nonEmpty(source.fixtureRepository)) fail('source.fixtureRepository', 'is required')
    if (!SHA_PATTERN.test(source.fixtureCommit ?? '')) fail('source.fixtureCommit', 'must be a full 40-character Git SHA')
  }

  const environment = record.environment
  if (checkObject(environment, 'environment')) {
    for (const key of ['os', 'architecture', 'node', 'npm', 'python']) {
      if (!nonEmpty(environment[key])) fail(`environment.${key}`, 'is required; use not-applicable when appropriate')
    }
  }

  if (!Array.isArray(record.stages)) {
    fail('stages', 'must be an array')
  } else {
    const seen = new Set()
    for (const [index, stage] of record.stages.entries()) {
      const path = `stages[${index}]`
      if (!checkObject(stage, path)) continue
      if (!nonEmpty(stage.id)) fail(`${path}.id`, 'is required')
      if (seen.has(stage.id)) fail(`${path}.id`, 'must be unique')
      seen.add(stage.id)
      if (!nonEmpty(stage.command)) fail(`${path}.command`, 'must contain the exact command')
      if (!Number.isInteger(stage.exitCode)) fail(`${path}.exitCode`, 'must be an integer')
      const startedAt = parseIsoTimestamp(stage.startedAt)
      const finishedAt = parseIsoTimestamp(stage.finishedAt)
      if (startedAt === null) fail(`${path}.startedAt`, 'must be a valid ISO-8601 timestamp with timezone')
      if (finishedAt === null) fail(`${path}.finishedAt`, 'must be a valid ISO-8601 timestamp with timezone')
      if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
        fail(`${path}.finishedAt`, 'must not be earlier than startedAt')
      }
      if (!safeArtifactPath(stage.stdoutArtifact)) fail(`${path}.stdoutArtifact`, 'must be a non-empty relative artifact path without parent traversal')
      if (!(stage.stderrArtifact === null || safeArtifactPath(stage.stderrArtifact))) {
        fail(`${path}.stderrArtifact`, 'must be a non-empty relative artifact path without parent traversal, or null')
      }
      if (!STAGE_STATUSES.has(stage.status)) fail(`${path}.status`, 'has an unsupported status')
      if (!Array.isArray(stage.reportArtifacts)) fail(`${path}.reportArtifacts`, 'must be an array')
      else if (stage.reportArtifacts.some(item => !safeArtifactPath(item))) fail(`${path}.reportArtifacts`, 'must contain only relative artifact paths without parent traversal')
      if (!Array.isArray(stage.notes)) fail(`${path}.notes`, 'must be an array')
      else if (stage.notes.some(item => typeof item !== 'string')) fail(`${path}.notes`, 'must contain only strings')
      if (stage.status === 'passed' && stage.exitCode !== 0) fail(`${path}.exitCode`, 'must be 0 for a passed stage')
      if (stage.status === 'failed' && stage.exitCode === 0) fail(`${path}.exitCode`, 'must be non-zero for a failed stage')
    }
    if (record.status === 'passed') {
      for (const id of REQUIRED_STAGES) {
        const stage = record.stages.find(item => item?.id === id)
        if (!stage) fail('stages', `passed record is missing required stage: ${id}`)
        else if (stage.status !== 'passed') fail(`stages.${id}`, 'must be passed for an overall passed record')
      }
    }
  }

  if (!Array.isArray(record.residualRisks)) fail('residualRisks', 'must be an array')
  else if (record.residualRisks.some(item => !nonEmpty(item))) {
    fail('residualRisks', 'must contain only non-empty strings')
  }
  if (checkObject(record.review, 'review')) {
    if (!nonEmpty(record.review.reviewer)) fail('review.reviewer', 'is required')
    const reviewedAt = parseIsoTimestamp(record.review.reviewedAt)
    if (reviewedAt === null) {
      fail('review.reviewedAt', 'must be a valid ISO-8601 timestamp with timezone')
    } else if (Array.isArray(record.stages)) {
      const finishedTimes = record.stages
        .filter(stage => stage && typeof stage === 'object')
        .map(stage => parseIsoTimestamp(stage.finishedAt))
        .filter(timestamp => timestamp !== null)
      if (finishedTimes.length > 0 && reviewedAt < Math.max(...finishedTimes)) {
        fail('review.reviewedAt', 'must not be earlier than the latest stage finishedAt')
      }
    }
    if (!REVIEW_DECISIONS.has(record.review.decision)) fail('review.decision', 'must be pending, approved, or rejected')
    if (record.status === 'passed' && record.review.decision !== 'approved') {
      fail('review.decision', 'must be approved for an overall passed record')
    }
  }
}

const args = process.argv.slice(2)
const positional = args.filter(arg => !arg.startsWith('--'))
const requirePassedFlags = args.filter(arg => arg === '--require-passed')
const input = positional[0]
const requirePassed = requirePassedFlags.length === 1
if (positional.length !== 1 || requirePassedFlags.length > 1
  || args.some(arg => arg.startsWith('--') && arg !== '--require-passed')) {
  console.error('Usage: npm run qa:beta-evidence -- <record.json> [--require-passed]')
  process.exit(2)
}

let record
try {
  record = JSON.parse(readFileSync(resolve(input), 'utf8'))
} catch (error) {
  console.error(`[beta-evidence] unable to read JSON: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
}

validate(record)
if (requirePassed && record.status !== 'passed') fail('status', '--require-passed expects an approved passed record')

if (errors.length > 0) {
  console.error(`[beta-evidence] invalid: ${errors.length} issue(s)`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(JSON.stringify({
  ok: true,
  qualificationId: record.qualificationId,
  runId: record.runId,
  status: record.status,
  requiredStages: REQUIRED_STAGES.length,
  recordedStages: record.stages.length,
}, null, 2))
