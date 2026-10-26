// Skills governance audit — REQUIRED references must resolve against the
// configured skill roots, and waivers must not be expired. Productized from
// the 2026-10-24 one-off audit that found 37/64 references missing and a
// waiver expired for three months (governance debt the assessment called out).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'

export interface SkillsAuditOptions {
  /** include global roots (~/.agents/skills …) in resolution — false checks project-local roots only (CI-safe) */
  includeGlobalRoots?: boolean
  now?: Date
}

export interface MissingRef {
  domain: string
  id: string
  required: boolean
}

export interface ExpiredWaiver {
  id: string
  expiresAt: string
}

export interface SkillsAuditReport {
  ok: boolean
  roots: string[]
  totalReferenced: number
  present: number
  missing: MissingRef[]
  missingRequired: number
  expiredWaivers: ExpiredWaiver[]
  waiverCount: number
}

interface SkillsJsonShape {
  policy?: {
    waivedRecommendedSkills?: Array<{ id: string; expiresAt?: string }>
  }
  skillSources?: {
    primaryRoot?: string
    fallbackRoots?: string[]
    globalRoots?: string[]
  }
  domains?: Record<string, { requiredSkills?: string[]; recommendedSkills?: string[] }>
}

function expandTilde(path: string, home: string): string {
  return path.startsWith('~') ? join(home, path.slice(1)) : path
}

function collectRoots(projectDir: string, config: SkillsJsonShape, includeGlobal: boolean, home: string): string[] {
  const roots = [
    config.skillSources?.primaryRoot,
    ...(config.skillSources?.fallbackRoots ?? []),
    ...(includeGlobal ? config.skillSources?.globalRoots ?? [] : []),
  ].filter((r): r is string => typeof r === 'string' && r.length > 0)
  return roots.map(r => (isAbsolute(r) || r.startsWith('~') ? expandTilde(r, home) : join(projectDir, r)))
}

function installedSkillNames(roots: string[]): Set<string> {
  const names = new Set<string>()
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        // Skill installers (e.g. wewrite install.sh) symlink skill dirs into
        // the roots; a symlinked directory does not report isDirectory().
        if (entry.isDirectory() || isSymlinkedDir(join(root, entry.name))) names.add(entry.name.toLowerCase())
      }
    } catch {
      // root absent — contributes nothing
    }
  }
  return names
}

function isSymlinkedDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false // broken symlink — contributes nothing
  }
}

export function auditSkills(projectDir: string, options: SkillsAuditOptions = {}): SkillsAuditReport {
  const now = options.now ?? new Date()
  const configPath = join(projectDir, '.scale', 'skills.json')
  let config: SkillsJsonShape = {}
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8')) as SkillsJsonShape
  } catch {
    return {
      ok: false,
      roots: [],
      totalReferenced: 0,
      present: 0,
      missing: [{ domain: '(config)', id: '.scale/skills.json unreadable or missing', required: true }],
      missingRequired: 1,
      expiredWaivers: [],
      waiverCount: 0,
    }
  }

  const roots = collectRoots(projectDir, config, options.includeGlobalRoots !== false, homedir())
  const installed = installedSkillNames(roots)

  const missing: MissingRef[] = []
  let total = 0
  let present = 0
  for (const [domain, cfg] of Object.entries(config.domains ?? {})) {
    const required = cfg.requiredSkills ?? []
    const recommended = cfg.recommendedSkills ?? []
    const waived = new Set((config.policy?.waivedRecommendedSkills ?? []).map(w => w.id))
    for (const id of [...required, ...recommended]) {
      const isRequired = required.includes(id)
      if (waived.has(id) && !isRequired) continue // waived recommended entries are deliberate non-blocking gaps
      total += 1
      const key = id.toLowerCase()
      const hit = [...installed].some(n => n === key || n.startsWith(`${key}-`) || n.includes(key))
      if (hit) present += 1
      else missing.push({ domain, id, required: isRequired })
    }
  }

  const expiredWaivers: ExpiredWaiver[] = []
  const waivers = config.policy?.waivedRecommendedSkills ?? []
  for (const waiver of waivers) {
    if (!waiver.expiresAt) continue
    const expiry = Date.parse(waiver.expiresAt)
    if (Number.isFinite(expiry) && expiry < now.getTime()) {
      expiredWaivers.push({ id: waiver.id, expiresAt: waiver.expiresAt })
    }
  }

  const missingRequired = missing.filter(m => m.required).length
  return {
    ok: missingRequired === 0 && expiredWaivers.length === 0,
    roots,
    totalReferenced: total,
    present,
    missing,
    missingRequired,
    expiredWaivers,
    waiverCount: waivers.length,
  }
}

/** CI self-check view: project-local roots only (global roots are machine-specific). */
export function auditSkillsForCI(projectDir: string): SkillsAuditReport {
  return auditSkills(projectDir, { includeGlobalRoots: false })
}
