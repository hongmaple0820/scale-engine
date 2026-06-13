// SCALE Cortex — Instinct Extractor
// 对齐 ECC: Observation Log → Pattern Detection → Instinct Creation
// Confidence scoring: 0.3 tentative → 0.5 moderate → 0.7 strong → 0.9 near-certain

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { logger } from '../core/logger.js'
import { dedupeCortexObservations, loadGateEvidenceObservations } from './GateEvidenceObservations.js'

// ---------------------------------------------------------------------------
// Instinct types (aligned with ECC format)
// ---------------------------------------------------------------------------

export interface Instinct {
  id: string
  trigger: string          // Pattern that fires this instinct (regex or keyword)
  confidence: number       // 0.3 | 0.5 | 0.7 | 0.9
  domain: string           // e.g., "governance", "security", "testing"
  source: string           // Where this came from: observation file path
  scope: 'project' | 'global'
  projectId?: string
  action: string           // Markdown body: what to DO
  evidence: string[]       // Evidence lines that support this instinct
  observations: number     // How many times observed
  createdAt: string
  updatedAt: string
  appliedCount: number     // Times this instinct was injected and used
  hitRate: number          // appliedCount / injectionCount
}

export interface Observation {
  timestamp: string
  sessionId: string
  gateName: string
  gateStatus: 'PASS' | 'FAIL' | 'WARN'
  errorPattern?: string
  filePaths: string[]
  rootCause?: string
  resolution?: string
  tokensUsed: number
  modelUsed: string
}

export interface PatternMatch {
  pattern: string
  count: number
  observations: Observation[]
  rootCauses: string[]
  resolutions: string[]
}

// ---------------------------------------------------------------------------
// InstinctExtractor
// ---------------------------------------------------------------------------

export class InstinctExtractor {
  private scaleDir: string
  private observationsDir: string
  private instinctsDir: string

  constructor(baseDir: string = join(process.cwd(), '.scale')) {
    this.scaleDir = baseDir
    this.observationsDir = join(baseDir, 'observations')
    this.instinctsDir = join(baseDir, 'instincts')
  }

  /**
   * Load observations from .scale/observations/ directory.
   */
  loadObservations(): Observation[] {
    const observations: Observation[] = []

    if (existsSync(this.observationsDir)) {
      try {
        for (const file of readdirSync(this.observationsDir)) {
          if (!file.endsWith('.jsonl')) continue
          const lines = readFileSync(join(this.observationsDir, file), 'utf-8')
            .split('\n')
            .filter(Boolean)
          for (const [index, line] of lines.entries()) {
            try {
              observations.push(JSON.parse(line))
            } catch (err) {
              logger.debug({ err, file, lineNumber: index + 1 }, 'Skipped malformed observation line')
            }
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to load observations')
      }
    }

    return dedupeCortexObservations([
      ...observations,
      ...loadGateEvidenceObservations(this.scaleDir),
    ])
  }

  /**
   * Detect patterns from observations.
   * Groups failures by error pattern, finds recurring root causes.
   */
  detectPatterns(observations: Observation[]): PatternMatch[] {
    const failures = observations.filter(o => o.gateStatus === 'FAIL')
    const patterns = new Map<string, PatternMatch>()

    for (const obs of failures) {
      const key = obs.errorPattern ?? obs.gateName

      if (!patterns.has(key)) {
        patterns.set(key, {
          pattern: key,
          count: 0,
          observations: [],
          rootCauses: [],
          resolutions: [],
        })
      }

      const match = patterns.get(key)!
      match.count++
      match.observations.push(obs)
      if (obs.rootCause && !match.rootCauses.includes(obs.rootCause)) {
        match.rootCauses.push(obs.rootCause)
      }
      if (obs.resolution && !match.resolutions.includes(obs.resolution)) {
        match.resolutions.push(obs.resolution)
      }
    }

    // Sort by count descending
    return Array.from(patterns.values()).sort((a, b) => b.count - a.count)
  }

  /**
   * Extract instincts from detected patterns.
   */
  extract(patterns: PatternMatch[]): Instinct[] {
    const instincts: Instinct[] = []

    for (const pattern of patterns) {
      if (pattern.count < 1) continue

      // Compute confidence
      const confidence = this.computeConfidence(pattern.count, pattern.rootCauses.length)

      // Determine domain
      const domain = this.inferDomain(pattern.pattern)

      // Generate trigger from pattern
      const trigger = this.generateTrigger(pattern)

      // Build action
      const action = this.buildAction(pattern)

      const id = `instinct-${createHash('sha256').update(pattern.pattern).digest('hex').slice(0, 10)}`

      instincts.push({
        id,
        trigger,
        confidence,
        domain,
        source: `extracted from ${pattern.count} observations`,
        scope: confidence >= 0.7 ? 'global' : 'project',
        action,
        evidence: pattern.observations.slice(0, 5).map(o =>
          `[${o.timestamp}] ${o.gateName}: ${o.errorPattern ?? 'failure'}`),
        observations: pattern.count,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        appliedCount: 0,
        hitRate: 0,
      })
    }

    return instincts.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Record an observation for future instinct extraction.
   */
  recordObservation(obs: Observation): void {
    if (!existsSync(this.observationsDir)) {
      mkdirSync(this.observationsDir, { recursive: true })
    }

    const today = new Date().toISOString().slice(0, 10)
    const file = join(this.observationsDir, `${today}.jsonl`)

    writeFileSync(file, JSON.stringify(obs) + '\n', { flag: 'a' })
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private computeConfidence(count: number, rootCauseCount: number): number {
    if (count >= 10 && rootCauseCount >= 3) return 0.9  // near-certain
    if (count >= 5) return 0.7   // strong
    if (count >= 2) return 0.5   // moderate
    return 0.3                    // tentative
  }

  private inferDomain(pattern: string): string {
    const lower = pattern.toLowerCase()
    if (lower.includes('security') || lower.includes('secret') || lower.includes('vuln')) return 'security'
    if (lower.includes('test') || lower.includes('coverage') || lower.includes('assert')) return 'testing'
    if (lower.includes('lint') || lower.includes('style') || lower.includes('format')) return 'code-quality'
    if (lower.includes('build') || lower.includes('compile') || lower.includes('type')) return 'build'
    if (lower.includes('governance') || lower.includes('gate') || lower.includes('policy')) return 'governance'
    if (lower.includes('import') || lower.includes('dependency') || lower.includes('module')) return 'dependencies'
    return 'general'
  }

  private generateTrigger(pattern: PatternMatch): string {
    // Use the most frequent root cause as trigger
    if (pattern.rootCauses.length > 0) {
      return pattern.rootCauses[0]
    }
    return `gate:${pattern.pattern}`
  }

  private buildAction(pattern: PatternMatch): string {
    const lines: string[] = [
      `## Trigger`,
      `${pattern.pattern}`,
      '',
      `## Observed Behavior`,
      `This failure pattern has been observed ${pattern.count} time(s).`,
      '',
    ]

    if (pattern.rootCauses.length > 0) {
      lines.push('## Root Causes')
      for (const rc of pattern.rootCauses.slice(0, 3)) {
        lines.push(`- ${rc}`)
      }
      lines.push('')
    }

    if (pattern.resolutions.length > 0) {
      lines.push('## Known Resolutions')
      for (const r of pattern.resolutions.slice(0, 3)) {
        lines.push(`- ${r}`)
      }
      lines.push('')
    }

    lines.push('## Recommended Action')
    lines.push(`Before performing actions matching "${pattern.pattern}", review the known resolutions above.`)
    lines.push(`If this is a recurrence, escalate by running: scale auto-fix`)

    return lines.join('\n')
  }
}
