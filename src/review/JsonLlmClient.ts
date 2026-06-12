// SCALE Engine — JSON LLM client (P1.4 / P2.2)
// A thin, env-gated wrapper around an OpenAI-compatible /chat/completions
// endpoint that returns parsed JSON. Mirrors the proven pattern in
// src/cortex/ReflexionEngine.ts: callers stay deterministic and offline by
// default (isEnabled() === false ⇒ they use their own heuristic fallback), and
// only reach the network when a local model is explicitly configured.

import { logger } from '../core/logger.js'
import { resolveLocalModelConfig } from '../routing/LocalModelProvider.js'

export interface JsonLlmRequest {
  system: string
  user: string
  /** Soft cap for the completion. Defaults to 600. */
  maxTokens?: number
  /** Sampling temperature. Defaults to 0.2 (judges want low variance). */
  temperature?: number
  /** Abort the request after this many ms. Defaults to 20000. */
  timeoutMs?: number
}

export interface JsonLlmResult<T> {
  data: T
  modelUsed: string
  tokensUsed: number
}

/**
 * Enabled only when a local model is explicitly configured. We intentionally
 * gate on SCALE_LOCAL_MODEL (and not the defaulted base URL/api key) so the
 * default developer + CI flow never attempts a network call.
 */
export function isLlmEnabled(): boolean {
  return Boolean(process.env.SCALE_LOCAL_MODEL)
}

export class JsonLlmClient {
  constructor(private readonly enabledOverride?: boolean) {}

  isEnabled(): boolean {
    return this.enabledOverride ?? isLlmEnabled()
  }

  /**
   * Call the model and parse its reply as JSON. Throws on any failure
   * (disabled, network error, non-2xx, non-JSON reply) so the caller can fall
   * back to a deterministic heuristic — exactly like ReflexionEngine does.
   */
  async completeJson<T>(request: JsonLlmRequest): Promise<JsonLlmResult<T>> {
    if (!this.isEnabled()) {
      throw new Error('JsonLlmClient is disabled (set SCALE_LOCAL_MODEL to enable)')
    }

    const config = resolveLocalModelConfig()
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.name,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 600,
      }),
      signal: AbortSignal.timeout(request.timeoutMs ?? 20000),
    })

    if (!response.ok) {
      throw new Error(`LLM endpoint returned ${response.status}`)
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { total_tokens?: number }
    }
    const content = payload.choices?.[0]?.message?.content ?? ''
    const data = parseJsonReply<T>(content)
    if (data === null) {
      throw new Error('LLM reply was not valid JSON')
    }

    return {
      data,
      modelUsed: config.name,
      tokensUsed: payload.usage?.total_tokens ?? 0,
    }
  }
}

/**
 * Best-effort JSON extraction: accepts a bare JSON object or one wrapped in a
 * ```json fenced block (a common local-model habit). Returns null on failure.
 */
export function parseJsonReply<T>(content: string): T | null {
  const trimmed = content.trim()
  const candidates: string[] = []

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1].trim())
  candidates.push(trimmed)

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      continue
    }
  }
  logger.debug({ content: trimmed.slice(0, 200) }, 'JsonLlmClient: failed to parse JSON reply')
  return null
}
