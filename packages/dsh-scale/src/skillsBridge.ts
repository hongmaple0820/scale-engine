// dsh-scale: Skills Bridge (T2.2) — exposes SCALE's phase-workflow skills
// (.scale/skills/<PHASE>/<name>.md) to DSH's skills registry through a
// provider. Registration is synchronous (plan §6 T2.2 / dsh-skill contract);
// body loading happens lazily in get().
//
// Deliberately NOT registered: skills.json domain routing metadata — those
// entries reference external skills from global roots (~/.agents/skills …)
// that DSH's own skill-filesystem discovery owns; duplicating them here
// would shadow or double-list third-party skills.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillCandidate, SkillDefinition, SkillProvider } from './dshTypes.js'

export const SCALE_SKILL_PROVIDER = 'scale-engine'
/** Mid-range: project entries outrank runtime, which outrank user entries (dsh-skill ranks). */
const SCALE_SKILL_RANK = 100

export interface ScaleSkillEntry {
  /** kebab-case skill name (from the `# skill:` header, falling back to filename) */
  name: string
  /** phase directory (DEFINE/BUILD/VERIFY/…) */
  phase: string
  description: string
  whenToUse?: string
  path: string
}

function parseSkillMarkdown(text: string, fallbackName: string): { name: string; description: string; whenToUse?: string } {
  const nameMatch = text.match(/^#\s+skill:\s*(.+)$/m)
  const purposeMatch = text.match(/^##\s+Purpose\s*$/m)
  const description = purposeMatch
    ? (() => {
        const after = text.slice((purposeMatch.index ?? 0) + purposeMatch[0].length)
        const nextSection = after.match(/^##\s/m)
        return (nextSection ? after.slice(0, nextSection.index) : after).trim().split('\n')[0] ?? ''
      })()
    : ''
  const triggerMatch = text.match(/^##\s+Triggers\s*$/m)
  let whenToUse: string | undefined
  if (triggerMatch) {
    const after = text.slice((triggerMatch.index ?? 0) + triggerMatch[0].length)
    const nextSection = after.match(/^##\s/m)
    const triggers = (nextSection ? after.slice(0, nextSection.index) : after)
      .split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean)
    if (triggers.length > 0) whenToUse = triggers.join('; ').slice(0, 200)
  }
  return {
    name: (nameMatch?.[1] ?? fallbackName).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''),
    description: description || `SCALE ${fallbackName} phase workflow skill`,
    whenToUse,
  }
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Scan .scale/skills/ phase directories for skill markdown files (sync — called once per list()). */
export function scanScaleSkills(projectDir: string): ScaleSkillEntry[] {
  const root = join(projectDir, '.scale', 'skills')
  let phases: string[]
  try {
    phases = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }

  const entries: ScaleSkillEntry[] = []
  for (const phase of phases) {
    let files: string[]
    try {
      files = readdirSync(join(root, phase)).filter(f => f.endsWith('.md') && f !== '_INDEX.md')
    } catch {
      continue
    }
    for (const file of files) {
      const relPath = `.scale/skills/${phase}/${file}`
      let text = ''
      try {
        text = readFileSync(join(root, phase, file), 'utf-8')
      } catch {
        continue
      }
      const fallback = file.replace(/\.md$/, '')
      const parsed = parseSkillMarkdown(text, fallback)
      if (!KEBAB.test(parsed.name)) continue
      entries.push({
        name: parsed.name,
        phase,
        description: parsed.description,
        whenToUse: parsed.whenToUse,
        path: relPath,
      })
    }
  }
  return entries
}

function toCandidate(entry: ScaleSkillEntry): SkillCandidate {
  return {
    name: entry.name,
    description: entry.description,
    invocation: { modelInvocable: true, userInvocable: true },
    source: entry.path,
    provider: SCALE_SKILL_PROVIDER,
    rank: SCALE_SKILL_RANK,
    ...(entry.whenToUse ? { whenToUse: entry.whenToUse } : {}),
    path: entry.path,
    locator: entry,
  }
}

/**
 * Build the DSH skill provider for a project. create() itself is synchronous
 * (contract); the disk scan runs inside list().
 */
export function createScaleSkillProvider(projectDir: () => string): SkillProvider {
  return {
    name: SCALE_SKILL_PROVIDER,
    async list() {
      return scanScaleSkills(projectDir()).map(toCandidate)
    },
    async get(candidate) {
      const entry = candidate.locator as ScaleSkillEntry | undefined
      const relPath = entry?.path ?? (typeof candidate.path === 'string' ? candidate.path : null)
      if (!relPath) return undefined
      try {
        const content = readFileSync(join(projectDir(), relPath), 'utf-8')
        return { ...candidate, content } satisfies SkillDefinition
      } catch {
        return undefined
      }
    },
  }
}
