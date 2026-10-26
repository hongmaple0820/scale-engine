// Governance convergence: the live .scale/*.json files and the built-in
// default copies in SkillPolicy.ts / ToolPolicy.ts must stay in sync
// (rule-source convergence, 2026-10-24). Drift between them silently changes
// routing for fresh installs (GovernanceTemplates regenerate from the
// defaults) versus this repo (live files) — the 2026-10-25 media P0 task hit
// exactly this double-edit risk and codified it as a test.
//
// enabled / destructiveActions are intentionally exempt from tool comparison:
// this repo disables codex-cli/gemini-cli/suno-api locally and tightens
// destructive levels — deliberate local overrides of the same default
// entries. Identity fields (ids, requiredFor/recommendedFor, command,
// mcpToolName) must still match.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SKILL_ROUTING_POLICY } from '../../src/skills/routing/SkillPolicy.js'
import { DEFAULT_TOOL_POLICY } from '../../src/tools/ToolPolicy.js'

const repoRoot = process.cwd()

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value].map(sorted).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sorted(entry)]),
    )
  }
  return value
}

const jsonEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

describe('skill routing policy convergence (.scale/skills.json ↔ SkillPolicy defaults)', () => {
  const live = JSON.parse(readFileSync(join(repoRoot, '.scale', 'skills.json'), 'utf-8')) as {
    domains: Record<string, Record<string, unknown>>
  }
  const defaults = DEFAULT_SKILL_ROUTING_POLICY.domains

  it('declares the same domain set as the built-in defaults', () => {
    expect(Object.keys(live.domains).sort()).toEqual(Object.keys(defaults).sort())
  })

  it('every domain matches its built-in default (structural fields)', () => {
    for (const [domain, cfg] of Object.entries(live.domains)) {
      const expected = defaults[domain]
      expect(expected, `domain "${domain}" missing from SkillPolicy defaults`).toBeDefined()
      expect(jsonEqual(cfg.detect ?? {}, expected.detect ?? {}), `detect mismatch in "${domain}"`).toBe(true)
      for (const field of [
        'requiredSkills',
        'recommendedSkills',
        'requiredArtifacts',
        'requiredVerification',
        'blockLevels',
      ] as const) {
        expect(
          jsonEqual(cfg[field] ?? [], (expected as Record<string, unknown>)[field] ?? []),
          `${field} mismatch in "${domain}"`,
        ).toBe(true)
      }
    }
  })
})

describe('tool policy convergence (.scale/tools.json ↔ ToolPolicy defaults)', () => {
  const live = JSON.parse(readFileSync(join(repoRoot, '.scale', 'tools.json'), 'utf-8')) as {
    tools: Record<string, Record<string, unknown>>
  }
  const defaults = DEFAULT_TOOL_POLICY.tools

  it('declares the same tool set as the built-in defaults', () => {
    expect(Object.keys(live.tools).sort()).toEqual(Object.keys(defaults).sort())
  })

  it('every tool matches its built-in default (identity fields)', () => {
    for (const [id, cfg] of Object.entries(live.tools)) {
      const expected = defaults[id]
      expect(expected, `tool "${id}" missing from ToolPolicy defaults`).toBeDefined()
      expect(jsonEqual(cfg.requiredFor ?? [], expected.requiredFor ?? []), `requiredFor mismatch in "${id}"`).toBe(true)
      expect(
        jsonEqual(cfg.recommendedFor ?? [], expected.recommendedFor ?? []),
        `recommendedFor mismatch in "${id}"`,
      ).toBe(true)
      expect(cfg.command ?? undefined, `command mismatch in "${id}"`).toEqual(expected.command ?? undefined)
      expect(cfg.mcpToolName ?? undefined, `mcpToolName mismatch in "${id}"`).toEqual(expected.mcpToolName ?? undefined)
    }
  })
})
