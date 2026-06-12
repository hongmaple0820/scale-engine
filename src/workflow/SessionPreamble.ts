// SCALE Engine — Session Preamble (v0.31.0)
// Automatic environment context collection before workflow execution.
// Inspired by gstack's preamble pattern: collect branch, sessions, learnings, etc.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { SCALE_ENGINE_VERSION } from '../version.js'
import { InstinctStore } from '../cortex/InstinctStore.js'
import { SessionInjector } from '../cortex/SessionInjector.js'
import { logger } from '../core/logger.js'

const SILENT_GIT_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore']

// ============================================================================
// Types
// ============================================================================

export interface SessionPreamble {
  sessionId: string
  timestamp: string
  gitBranch: string
  gitRoot: string
  projectSlug: string
  scaleVersion: string
  activeRunCount: number
  learningCount: number
  verificationProfile: string
  governanceMode: string
  cortex: SessionPreambleCortex
  warnings: string[]
}

export interface SessionPreambleCortex {
  instinctCount: number
  instinctsApplied: string[]
  content: string
  warning?: string
}

export interface PreambleOptions {
  projectDir?: string
  scaleDir?: string
}

// ============================================================================
// Collector
// ============================================================================

export function collectSessionPreamble(opts?: PreambleOptions): SessionPreamble {
  const projectDir = opts?.projectDir ?? process.cwd()
  const scaleDir = opts?.scaleDir ?? '.scale'
  const scaleRoot = resolveScaleRoot(projectDir, scaleDir)

  const warnings: string[] = []

  // Git branch
  let gitBranch = 'unknown'
  try {
    gitBranch = execSync('git branch --show-current', {
      cwd: projectDir, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
    }).trim()
  } catch {
    warnings.push('Not in a git repository or git not available')
  }

  // Git root
  let gitRoot = projectDir
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: projectDir, encoding: 'utf-8', timeout: 5000, stdio: SILENT_GIT_STDIO,
    }).trim()
  } catch (error) {
    logger.debug({ error, projectDir }, 'Unable to resolve git root for session preamble')
    // Use projectDir as fallback
  }

  // Project slug
  const projectSlug = deriveProjectSlug(projectDir)

  // Active run count
  const activeRunCount = countActiveRuns(scaleRoot)

  // Learning count
  const learningCount = countLearnings(scaleRoot, projectSlug)

  // Verification profile
  const verificationProfile = resolveCurrentProfile(scaleRoot)

  // Governance mode (default)
  const governanceMode = 'standard'

  // Cortex SessionStart injection
  const cortex = collectCortexInjection(scaleRoot, projectSlug)
  if (cortex.warning) warnings.push(cortex.warning)

  return {
    sessionId: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
    gitBranch,
    gitRoot,
    projectSlug,
    scaleVersion: SCALE_ENGINE_VERSION,
    activeRunCount,
    learningCount,
    verificationProfile,
    governanceMode,
    cortex,
    warnings,
  }
}

// ============================================================================
// Formatter
// ============================================================================

export function formatPreambleForAgent(preamble: SessionPreamble): string {
  const lines: string[] = [
    `SESSION: ${preamble.sessionId}`,
    `BRANCH: ${preamble.gitBranch}`,
    `PROJECT: ${preamble.projectSlug}`,
    `SCALE_VERSION: ${preamble.scaleVersion}`,
    `ACTIVE_RUNS: ${preamble.activeRunCount}`,
    `LEARNINGS: ${preamble.learningCount}`,
    `VERIFICATION_PROFILE: ${preamble.verificationProfile}`,
    `GOVERNANCE_MODE: ${preamble.governanceMode}`,
    `CORTEX_INSTINCTS: ${preamble.cortex.instinctCount}`,
  ]

  if (preamble.cortex.instinctsApplied.length > 0) {
    lines.push(`CORTEX_APPLIED: ${preamble.cortex.instinctsApplied.join(',')}`)
  }

  if (preamble.warnings.length > 0) {
    lines.push(`WARNINGS: ${preamble.warnings.join('; ')}`)
  }

  if (preamble.cortex.content.trim()) {
    lines.push('', 'CORTEX_SESSION_INJECTION:', preamble.cortex.content)
  }

  return lines.join('\n')
}

// ============================================================================
// Helpers
// ============================================================================

function deriveProjectSlug(projectDir: string): string {
  try {
    return basename(projectDir).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  } catch {
    return 'unknown'
  }
}

function resolveScaleRoot(projectDir: string, scaleDir: string): string {
  return isAbsolute(scaleDir) ? scaleDir : join(projectDir, scaleDir)
}

function collectCortexInjection(scaleRoot: string, projectSlug: string): SessionPreambleCortex {
  try {
    const store = new InstinctStore(join(scaleRoot, 'instincts'), { createDirs: false })
    const injection = new SessionInjector(store).build(projectSlug)
    return {
      instinctCount: injection.instinctCount,
      instinctsApplied: injection.metadata.instinctsApplied,
      content: injection.content,
    }
  } catch (error) {
    return {
      instinctCount: 0,
      instinctsApplied: [],
      content: '',
      warning: `Cortex injection unavailable: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function countActiveRuns(scaleDir: string): number {
  const runsDir = join(scaleDir, 'ai-os', 'runs')
  if (!existsSync(runsDir)) return 0
  try {
    return readdirSync(runsDir).filter(f => f.endsWith('.json')).length
  } catch {
    return 0
  }
}

function countLearnings(scaleDir: string, projectSlug: string): number {
  const learningsDir = join(scaleDir, 'learnings')
  if (!existsSync(learningsDir)) return 0
  try {
    const jsonlPath = join(learningsDir, `${projectSlug}.jsonl`)
    if (!existsSync(jsonlPath)) return 0
    const content = readFileSync(jsonlPath, 'utf-8')
    return content.split('\n').filter(line => line.trim()).length
  } catch {
    return 0
  }
}

function resolveCurrentProfile(scaleRoot: string): string {
  try {
    const matrixPath = join(scaleRoot, 'verification-matrix.json')
    if (existsSync(matrixPath)) {
      const matrix = JSON.parse(readFileSync(matrixPath, 'utf-8')) as { defaultProfile?: string }
      return matrix.defaultProfile ?? 'default'
    }
  } catch (error) {
    logger.debug({ error, scaleRoot }, 'Unable to resolve current verification profile')
  }
  return 'default'
}
