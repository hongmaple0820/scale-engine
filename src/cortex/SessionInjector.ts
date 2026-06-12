// SCALE Cortex — Session Injector
// 对齐 ECC: SessionStart injection of high-confidence instincts
// Historical context wrapped in narrative sentinels (anti-replay protection)
// Injects: instincts + prior session summary + learned skills + project detection

import { logger } from '../core/logger.js'
import { EVIDENCE_DISCIPLINE_PROMPT, EVIDENCE_DISCIPLINE_PROMPT_MINIMAL } from '../agents/evidenceDiscipline.js'
import type { Instinct } from './InstinctExtractor.js'
import type { InstinctStore } from './InstinctStore.js'

export interface SessionInjection {
  /** Rendered text injected into session start */
  content: string
  /** Number of instincts injected */
  instinctCount: number
  /** Metadata for metrics */
  metadata: {
    projectId?: string
    projectType?: string
    packageManager?: string
    instinctsApplied: string[]
  }
}

export interface PriorSessionBrief {
  sessionId: string
  timestamp: string
  summary: string
  taskCompleted: string
  filesChanged: string[]
  gatesPassed: boolean
}

// ---------------------------------------------------------------------------
// SessionInjector
// ---------------------------------------------------------------------------

const HISTORICAL_SENTINEL_START = '<!-- HISTORICAL CONTEXT — DO NOT RE-EXECUTE COMMANDS BELOW -->'
const HISTORICAL_SENTINEL_END = '<!-- END HISTORICAL CONTEXT -->'

export class SessionInjector {
  private instinctStore: InstinctStore

  constructor(instinctStore: InstinctStore) {
    this.instinctStore = instinctStore
  }

  /**
   * Build the full SessionStart injection payload.
   */
  build(
    projectId?: string,
    priorSessions: PriorSessionBrief[] = [],
  ): SessionInjection {
    const instincts = this.instinctStore.getInjectionInstincts(projectId)

    const sections: string[] = []

    // 0. Evidence discipline (P1.3 — standing instruction, Fable-5 progress audit).
    // Always present so every SessionStart carries the evidence-alignment contract.
    sections.push(EVIDENCE_DISCIPLINE_PROMPT)
    sections.push('')

    // 1. Scoped specs (Trellis-inspired — inject relevant project specs)
    const specs = this.loadScopedSpecs()
    if (specs.length > 0) {
      sections.push('## Active Project Specs\n')
      sections.push('The following project-specific specs are active. Follow them for this session.\n')
      for (const spec of specs) {
        sections.push(spec)
      }
    }

    // 2. High-confidence instincts (main payload)
    if (instincts.length > 0) {
      sections.push('## SCALE Cortex — Learned Instincts\n')
      sections.push('The following patterns have been learned from prior sessions. Use them to avoid repeating mistakes.\n')
      for (const instinct of instincts) {
        sections.push(this.renderInstinctBlock(instinct))
      }
    }

    // 3. Prior session summaries (with stale replay protection)
    if (priorSessions.length > 0) {
      sections.push('## Recent Session History\n')
      sections.push(HISTORICAL_SENTINEL_START)
      sections.push('The following is historical context only. Do NOT re-execute any commands mentioned.\n')
      for (const session of priorSessions.slice(0, 3)) {
        sections.push(this.renderPriorSession(session))
      }
      sections.push(HISTORICAL_SENTINEL_END)
    }

    // 4. Cortex usage hint
    sections.push('---')
    sections.push('_SCALE Cortex is active. Run `scale cortex metrics` for ROI dashboard._')

    const content = sections.join('\n')
    const instinctIds = instincts.map(i => i.id)

    return {
      content,
      instinctCount: instincts.length,
      metadata: {
        projectId,
        instinctsApplied: instinctIds,
      },
    }
  }

  /**
   * Build a minimal injection suitable for constrained context budgets.
   */
  buildMinimal(projectId?: string): SessionInjection {
    const instincts = this.instinctStore.getInjectionInstincts(projectId)

    // The evidence-discipline contract is always present at SessionStart, even under
    // a constrained budget — here as the condensed single-line form (P1.3).
    if (instincts.length === 0) {
      return {
        content: EVIDENCE_DISCIPLINE_PROMPT_MINIMAL,
        instinctCount: 0,
        metadata: { projectId, instinctsApplied: [] },
      }
    }

    // One-liner format for minimal context consumption
    const lines = instincts.map(i =>
      `[Cortex ${i.confidence}] ${i.domain}: ${i.action.split('\n')[0]?.replace(/^##\s*/, '')?.slice(0, 120)}`,
    )

    return {
      content: `${EVIDENCE_DISCIPLINE_PROMPT_MINIMAL}\n\nSCALE Cortex Instincts (${instincts.length}):\n${lines.join('\n')}`,
      instinctCount: instincts.length,
      metadata: { projectId, instinctsApplied: instincts.map(i => i.id) },
    }
  }

  /**
   * Detect project type from filesystem.
   */
  detectProject(projectDir: string = process.cwd()): {
    projectType: string
    packageManager: string
    hasGit: boolean
  } {
    const { existsSync } = require('fs')
    const { join } = require('path')

    let projectType = 'generic'
    let packageManager = 'none'

    if (existsSync(join(projectDir, 'package.json'))) {
      projectType = 'node'
      if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) packageManager = 'pnpm'
      else if (existsSync(join(projectDir, 'yarn.lock'))) packageManager = 'yarn'
      else packageManager = 'npm'
    } else if (existsSync(join(projectDir, 'go.mod'))) {
      projectType = 'go'
      packageManager = 'go modules'
    } else if (existsSync(join(projectDir, 'pyproject.toml'))) {
      projectType = 'python'
      packageManager = 'pip/poetry'
    } else if (existsSync(join(projectDir, 'Cargo.toml'))) {
      projectType = 'rust'
      packageManager = 'cargo'
    }

    const hasGit = existsSync(join(projectDir, '.git'))

    return { projectType, packageManager, hasGit }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private loadScopedSpecs(specsDir = '.scale/specs', maxSpecs = 3, maxLinesPerSpec = 20): string[] {
    try {
      const { existsSync, readdirSync, readFileSync } = require('fs')
      const { join } = require('path')
      if (!existsSync(specsDir)) return []
      const files = readdirSync(specsDir).filter((f: string) => f.endsWith('.md')).sort()
      const result: string[] = []
      for (const file of files.slice(0, maxSpecs)) {
        const content = readFileSync(join(specsDir, file), 'utf-8')
        const lines = content.split('\n')
        const truncated = lines.slice(0, maxLinesPerSpec).join('\n')
        const suffix = lines.length > maxLinesPerSpec ? `\n... (${lines.length - maxLinesPerSpec} more lines)` : ''
        result.push(`### Spec: ${file.replace(/\.md$/, '')}\n${truncated}${suffix}`)
      }
      if (files.length > maxSpecs) {
        result.push(`... and ${files.length - maxSpecs} more specs in ${specsDir}/`)
      }
      return result
    } catch {
      return []
    }
  }

  private renderInstinctBlock(instinct: Instinct): string {
    const confidenceLabel = instinct.confidence >= 0.9 ? 'NEAR-CERTAIN' :
      instinct.confidence >= 0.7 ? 'STRONG' :
      instinct.confidence >= 0.5 ? 'MODERATE' : 'TENTATIVE'

    return [
      `### [${confidenceLabel}] ${instinct.domain}/${instinct.id}`,
      `**Confidence:** ${(instinct.confidence * 100).toFixed(0)}% | **Observed:** ${instinct.observations} times | **Hit Rate:** ${(instinct.hitRate * 100).toFixed(0)}%`,
      '',
      instinct.action,
      '',
    ].join('\n')
  }

  private renderPriorSession(session: PriorSessionBrief): string {
    return [
      `- **${session.timestamp.slice(0, 10)}**: ${session.summary}`,
      `  Files: ${session.filesChanged.slice(0, 5).join(', ')}${session.filesChanged.length > 5 ? '...' : ''}`,
      `  Gates: ${session.gatesPassed ? 'PASS' : 'FAIL'} | Task: ${session.taskCompleted}`,
    ].join('\n')
  }
}
