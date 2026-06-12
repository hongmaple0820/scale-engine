// SCALE Engine — LLM-as-Judge (P1.4)
// Independent, advisory check of whether a diff actually satisfies the Spec's
// declared outcome / verificationSurface. The verdict is written into the
// review record as *advisory* evidence (decision K1): it never participates in
// the pass/fail decision and never blocks ship.
//
// Like ReflexionEngine, the judge runs an env-gated LLM when SCALE_LOCAL_MODEL
// is configured and otherwise falls back to a deterministic heuristic, so the
// default developer + CI flow stays offline, free and reproducible.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../core/logger.js'
import { JsonLlmClient } from './JsonLlmClient.js'

export type JudgeDecision = 'pass' | 'fail' | 'uncertain'

export interface JudgeVerdict {
  /** Advisory call on whether the diff meets the Spec outcome. */
  decision: JudgeDecision
  /** 0..1 self-reported confidence. */
  confidence: number
  rationale: string
  /** verificationSurface entries with no corresponding evidence in the diff. */
  unmetSurfaces: string[]
  /** Model name, or 'heuristic' when the LLM path was not taken. */
  modelUsed: string
  /** Versioned prompt identifier, e.g. "spec-conformance.v1". */
  promptVersion: string
  /** Always true — kept explicit so consumers never gate on this verdict. */
  advisory: true
  createdAt: number
}

export interface JudgeInput {
  outcome?: string
  verificationSurface: string[]
  /** Pre-trimmed diff summary (changed files + salient added lines). */
  diffSummary: string
  reviewFindings: { critical: number; high: number; medium: number; low: number }
}

interface JudgePromptRecord {
  id: string
  version: string
  system: string
  rubric: string
  createdAt: number
}

const DEFAULT_PROMPT: JudgePromptRecord = {
  id: 'spec-conformance',
  version: 'v1',
  system:
    'You are an independent code-review judge. Decide only whether the diff actually achieves the stated outcome and exercises every declared verification surface. ' +
    'You are advisory: do not approve work that lacks evidence. Output strict JSON only.',
  rubric:
    'pass = every verification surface is plausibly addressed by the diff and no critical/high review finding contradicts the outcome. ' +
    'fail = the diff clearly does not achieve the outcome or leaves a declared surface unaddressed. ' +
    'uncertain = evidence is insufficient to decide.',
  createdAt: 0,
}

/**
 * Loads/persists the versioned judge prompt under `.scale/judges/<id>.json`
 * (decision L1) so the rubric is auditable and can drift independently of code.
 */
export class JudgePromptStore {
  private readonly dir: string

  constructor(scaleDir = process.env.SCALE_DIR ?? '.scale') {
    this.dir = join(scaleDir, 'judges')
  }

  load(id = DEFAULT_PROMPT.id): JudgePromptRecord {
    const file = join(this.dir, `${id}.json`)
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf-8')) as JudgePromptRecord
      } catch {
        logger.warn({ file }, 'JudgePromptStore: corrupt prompt file, using bundled default')
      }
    } else if (id === DEFAULT_PROMPT.id) {
      this.write({ ...DEFAULT_PROMPT, createdAt: Date.now() })
    }
    return { ...DEFAULT_PROMPT, createdAt: DEFAULT_PROMPT.createdAt || Date.now() }
  }

  private write(record: JudgePromptRecord): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf-8')
  }
}

export class LlmJudge {
  constructor(
    private readonly client: JsonLlmClient = new JsonLlmClient(),
    private readonly promptStore: JudgePromptStore = new JudgePromptStore(),
  ) {}

  async judge(input: JudgeInput): Promise<JudgeVerdict> {
    const prompt = this.promptStore.load()
    const promptVersion = `${prompt.id}.${prompt.version}`

    if (!this.client.isEnabled()) {
      return this.heuristicVerdict(input, promptVersion)
    }

    try {
      const { data, modelUsed } = await this.client.completeJson<{
        decision?: string
        confidence?: number
        rationale?: string
        unmetSurfaces?: string[]
      }>({
        system: `${prompt.system}\n\nRubric: ${prompt.rubric}`,
        user: this.buildUserPrompt(input),
      })
      return {
        decision: normalizeDecision(data.decision),
        confidence: clampConfidence(data.confidence),
        rationale: (data.rationale ?? '').slice(0, 1000) || 'No rationale provided.',
        unmetSurfaces: Array.isArray(data.unmetSurfaces) ? data.unmetSurfaces.slice(0, 50) : [],
        modelUsed,
        promptVersion,
        advisory: true,
        createdAt: Date.now(),
      }
    } catch (err) {
      logger.warn({ err }, 'LlmJudge: LLM call failed, falling back to heuristic')
      return this.heuristicVerdict(input, promptVersion)
    }
  }

  private buildUserPrompt(input: JudgeInput): string {
    return [
      `Outcome: ${input.outcome ?? '(not declared)'}`,
      '',
      'Verification surfaces (each must be addressed):',
      ...(input.verificationSurface.length ? input.verificationSurface.map(s => `- ${s}`) : ['- (none declared)']),
      '',
      'Review findings:',
      `critical=${input.reviewFindings.critical} high=${input.reviewFindings.high} medium=${input.reviewFindings.medium} low=${input.reviewFindings.low}`,
      '',
      'Diff summary:',
      input.diffSummary.slice(0, 6000) || '(empty diff)',
      '',
      'Output JSON: { "decision": "pass|fail|uncertain", "confidence": 0.0-1.0, "rationale": "...", "unmetSurfaces": ["..."] }',
    ].join('\n')
  }

  /**
   * Deterministic fallback: a surface is "unmet" when none of its significant
   * tokens appear in the diff summary; any unmet surface or any critical/high
   * review finding turns the advisory verdict negative.
   */
  private heuristicVerdict(input: JudgeInput, promptVersion: string): JudgeVerdict {
    const haystack = input.diffSummary.toLowerCase()
    const unmetSurfaces = input.verificationSurface.filter(surface => !surfaceMentioned(surface, haystack))
    const blockingFindings = input.reviewFindings.critical + input.reviewFindings.high

    let decision: JudgeDecision
    let confidence: number
    let rationale: string
    if (blockingFindings > 0) {
      decision = 'fail'
      confidence = 0.6
      rationale = `${blockingFindings} critical/high review finding(s) contradict a "done" claim.`
    } else if (input.verificationSurface.length === 0) {
      decision = 'uncertain'
      confidence = 0.3
      rationale = 'No verification surface declared; cannot judge conformance from the diff alone.'
    } else if (unmetSurfaces.length > 0) {
      decision = 'uncertain'
      confidence = 0.4
      rationale = `${unmetSurfaces.length}/${input.verificationSurface.length} verification surface(s) have no matching evidence in the diff.`
    } else {
      decision = 'pass'
      confidence = 0.5
      rationale = 'All declared verification surfaces appear in the diff and no critical/high findings were raised.'
    }

    return {
      decision,
      confidence,
      rationale,
      unmetSurfaces,
      modelUsed: 'heuristic',
      promptVersion,
      advisory: true,
      createdAt: Date.now(),
    }
  }
}

function surfaceMentioned(surface: string, haystackLower: string): boolean {
  const tokens = surface
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(token => token.length >= 4)
  if (tokens.length === 0) return haystackLower.includes(surface.toLowerCase())
  return tokens.some(token => haystackLower.includes(token))
}

function normalizeDecision(value: string | undefined): JudgeDecision {
  const normalized = (value ?? '').toLowerCase()
  if (normalized === 'pass') return 'pass'
  if (normalized === 'fail') return 'fail'
  return 'uncertain'
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}
