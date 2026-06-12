// SCALE Engine — Fresh-context verifier sub-agent (P2.2)
// An independent verification pass that judges whether a diff actually
// satisfies the Spec, deliberately fed ONLY the declared verification surface,
// the diff and a gate summary — and *no* build-agent conversation/history
// (decision N1). The isolated input is what eliminates the build agent's
// self-rationalisation bias.
//
// Like LlmJudge / ReflexionEngine it is env-gated (SCALE_LOCAL_MODEL) with a
// deterministic heuristic fallback, and it is advisory only (decision O1): the
// verdict is recorded but never blocks ship in this PR.

import { logger } from '../core/logger.js'
import { JsonLlmClient } from './JsonLlmClient.js'

export type FreshVerifyDecision = 'verified' | 'unverified' | 'uncertain'

export interface FreshVerifyVerdict {
  decision: FreshVerifyDecision
  confidence: number
  rationale: string
  /** verificationSurface entries with no corresponding evidence in the diff. */
  unmetSurfaces: string[]
  modelUsed: string
  /** Always true — fresh verification never blocks ship in this PR. */
  advisory: true
  createdAt: number
}

export interface FreshVerifyInput {
  outcome?: string
  /** The ONLY success contract the verifier is allowed to reason from. */
  verificationSurface: string[]
  /** Pre-trimmed diff summary (changed files + salient added lines). */
  diffSummary: string
  /** Short, factual gate/test outcome summary. No build-agent reasoning. */
  gateSummary: string
}

const SYSTEM_PROMPT =
  'You are an independent verification sub-agent. You did NOT write this code and have NO access to the author\'s reasoning. ' +
  'Using only the declared verification surface, the diff and the gate summary, decide whether the outcome is independently verifiable from the artifacts alone. ' +
  'Do not assume intent that is not evidenced by the diff. Output strict JSON only.'

export class FreshContextVerifier {
  constructor(private readonly client: JsonLlmClient = new JsonLlmClient()) {}

  async verify(input: FreshVerifyInput): Promise<FreshVerifyVerdict> {
    if (!this.client.isEnabled()) {
      return this.heuristicVerdict(input)
    }

    try {
      const { data, modelUsed } = await this.client.completeJson<{
        decision?: string
        confidence?: number
        rationale?: string
        unmetSurfaces?: string[]
      }>({
        system: SYSTEM_PROMPT,
        user: this.buildUserPrompt(input),
      })
      return {
        decision: normalizeDecision(data.decision),
        confidence: clampConfidence(data.confidence),
        rationale: (data.rationale ?? '').slice(0, 1000) || 'No rationale provided.',
        unmetSurfaces: Array.isArray(data.unmetSurfaces) ? data.unmetSurfaces.slice(0, 50) : [],
        modelUsed,
        advisory: true,
        createdAt: Date.now(),
      }
    } catch (err) {
      logger.warn({ err }, 'FreshContextVerifier: LLM call failed, falling back to heuristic')
      return this.heuristicVerdict(input)
    }
  }

  private buildUserPrompt(input: FreshVerifyInput): string {
    return [
      `Stated outcome: ${input.outcome ?? '(not declared)'}`,
      '',
      'Verification surfaces (the ONLY contract you may verify against):',
      ...(input.verificationSurface.length ? input.verificationSurface.map(s => `- ${s}`) : ['- (none declared)']),
      '',
      'Gate summary:',
      input.gateSummary || '(none)',
      '',
      'Diff (the only evidence available to you):',
      input.diffSummary.slice(0, 6000) || '(empty diff)',
      '',
      'Output JSON: { "decision": "verified|unverified|uncertain", "confidence": 0.0-1.0, "rationale": "...", "unmetSurfaces": ["..."] }',
    ].join('\n')
  }

  /**
   * Deterministic fallback. Unlike the build agent, the fresh verifier trusts
   * only artifacts: a surface is verified iff its significant tokens appear in
   * the diff. Any unmet surface yields "unverified"; no surface at all is
   * "uncertain" (nothing to independently verify against).
   */
  private heuristicVerdict(input: FreshVerifyInput): FreshVerifyVerdict {
    const haystack = input.diffSummary.toLowerCase()
    const unmetSurfaces = input.verificationSurface.filter(surface => !surfaceMentioned(surface, haystack))

    let decision: FreshVerifyDecision
    let confidence: number
    let rationale: string
    if (input.verificationSurface.length === 0) {
      decision = 'uncertain'
      confidence = 0.3
      rationale = 'No verification surface declared; cannot independently verify the outcome from the diff.'
    } else if (unmetSurfaces.length > 0) {
      decision = 'unverified'
      confidence = 0.5
      rationale = `${unmetSurfaces.length}/${input.verificationSurface.length} verification surface(s) have no supporting evidence in the diff.`
    } else {
      decision = 'verified'
      confidence = 0.5
      rationale = 'Every declared verification surface has supporting evidence in the diff.'
    }

    return {
      decision,
      confidence,
      rationale,
      unmetSurfaces,
      modelUsed: 'heuristic',
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

function normalizeDecision(value: string | undefined): FreshVerifyDecision {
  const normalized = (value ?? '').toLowerCase()
  if (normalized === 'verified') return 'verified'
  if (normalized === 'unverified') return 'unverified'
  return 'uncertain'
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5
  return Math.max(0, Math.min(1, value))
}
