// SCALE Engine — Output Surface Governance (plan: docs/plans/2026-10-24-scale-output-governance-plan.md)
// --------------------------------------------------------------------------------------
// Single registry for everything SCALE writes into a target project:
//   - manifest.json under .scale/ records every write OUTSIDE .scale (platform
//     configs, AGENTS.md sections, generated docs) plus the config layer inside
//   - classifyScalePath() decides what may be auto-cleaned (tmp/cache/reports)
//     and what never may (evidence/specs/config)
//   - resolveScalePath() provides dual-layout reads (legacy flat .scale vs v2
//     six-bucket layout) so migration stays non-breaking
//   - sweepScaleTmp() implements the 72h TTL for .scale/tmp/
//
// Registration happens at the ORCHESTRATION layer (quickstart / CustomerInstall)
// using the created/skipped lists adapters already return — no adapter changes.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SurfaceKind =
  | 'config'    // user-editable governance files — never auto-cleaned
  | 'state'     // runtime state — clean --all candidates
  | 'evidence'  // governance record — never cleaned
  | 'specs'     // governance record — never cleaned
  | 'reports'   // regenerable output — clean candidates
  | 'tmp'       // 72h TTL
  | 'cache'     // regenerable — clean candidates
  | 'external'  // outside .scale (platform configs, doc sections) — manifest-tracked

export interface ManifestEntry {
  /** project-relative path with forward slashes */
  path: string
  kind: SurfaceKind
  platform?: string
  /** how a re-run merges (json-merge / markers / overwrite) */
  idempotent?: string
  writtenAt: string
  /** the scale command or module that wrote it */
  by: string
  regenerable?: boolean
}

export interface SurfaceManifest {
  version: 1
  scaleVersion?: string
  writings: ManifestEntry[]
}

// ---------------------------------------------------------------------------
// Canonical platform surface (fallback scan + doctor --surface)
// Mirrors src/api/quickstart.ts platform path map; extend with adapters.
// ---------------------------------------------------------------------------

export const PLATFORM_SURFACE: Record<string, string[]> = {
  'claude-code': ['.claude/settings.json'],
  codex: ['.codex/config.toml', '.codex/hooks.json'],
  zcode: ['.zcode/config.json'],
  'deepseek-tui': ['.deepseek/instructions.md'],
  cursor: ['.cursor/rules/scale.mdc', '.cursor/mcp.json'],
  gemini: ['.gemini/settings.json'],
  opencode: ['AGENTS.md'],
  windsurf: ['.windsurf/rules/scale.md'],
  cline: ['.clinerules/scale.md'],
  kilocode: ['.kilocode/rules/scale.md'],
  roo: ['.roo/rules/scale.md'],
  antigravity: ['.antigrules/scale.md'],
  aider: ['.aider.conf.yml', 'CONVENTIONS.md'],
}

/** Knowledge docs every platform merge into (idempotent markers). */
export const KNOWLEDGE_DOCS = ['AGENTS.md', 'CLAUDE.md', '.scale/agent-language.md']

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function manifestPath(scaleDir: string): string {
  return join(scaleDir, 'manifest.json')
}

export function loadManifest(scaleDir: string): SurfaceManifest {
  const file = manifestPath(scaleDir)
  if (!existsSync(file)) return { version: 1, writings: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as SurfaceManifest
    if (!Array.isArray(parsed.writings)) return { version: 1, writings: [] }
    return parsed
  } catch {
    return { version: 1, writings: [] }
  }
}

function saveManifest(scaleDir: string, manifest: SurfaceManifest): void {
  mkdirSync(scaleDir, { recursive: true })
  writeFileSync(manifestPath(scaleDir), JSON.stringify(manifest, null, 2), 'utf-8')
}

export interface RecordWritingInput {
  /** absolute or project-relative path; stored project-relative, forward slashes */
  path: string
  kind?: SurfaceKind
  platform?: string
  idempotent?: string
  by?: string
  regenerable?: boolean
}

/**
 * Register writings in the manifest (merge by path). Never throws — a broken
 * registry must not break the write it describes.
 */
export function recordWritings(scaleDir: string, entries: RecordWritingInput[], by = 'scale'): number {
  if (entries.length === 0) return 0
  try {
    const manifest = loadManifest(scaleDir)
    const byPath = new Map(manifest.writings.map(w => [w.path, w]))
    let added = 0
    for (const entry of entries) {
      if (!entry.path) continue
      const rel = normalizeRel(entry.path)
      const kind = entry.kind ?? inferKind(rel)
      const record: ManifestEntry = {
        path: rel,
        kind,
        ...(entry.platform ? { platform: entry.platform } : {}),
        ...(entry.idempotent ? { idempotent: entry.idempotent } : {}),
        writtenAt: new Date().toISOString(),
        by: entry.by ?? by,
        ...(entry.regenerable !== undefined ? { regenerable: entry.regenerable } : {}),
      }
      if (!byPath.has(rel)) added += 1
      byPath.set(rel, record)
    }
    manifest.writings = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
    saveManifest(scaleDir, manifest)
    return added
  } catch {
    return 0
  }
}

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/')
}

/**
 * Orchestration-layer hook: record everything an init/setup run wrote.
 * Paths inside .scale/ are only recorded when they belong to the config layer;
 * everything outside .scale is always recorded (that is the contract).
 */
export function recordSurfaceFromInit(
  projectDir: string,
  created: string[],
  by: string,
  platform?: string,
): number {
  const scaleDir = join(projectDir, '.scale')
  const entries: RecordWritingInput[] = []
  for (const path of created) {
    const rel = normalizeRel(relative(projectDir, path))
    // skip anything outside the project — cross-drive relatives come back as
    // absolute paths (no ../ prefix), so test for both shapes
    if (!rel || rel.startsWith('../') || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) continue
    if (rel.startsWith('.scale/')) {
      // only the config layer inside .scale is manifest-tracked
      const inner = rel.slice('.scale/'.length)
      if (CONFIG_LAYER.test(inner)) entries.push({ path: rel, kind: 'config', by })
      continue
    }
    entries.push({
      path: rel,
      kind: inferKind(rel),
      platform,
      idempotent: IDempotenceOf(rel),
      by,
      // generated workflow docs are regenerable — uninstall may remove them
      ...(rel.startsWith('docs/workflow/') ? { regenerable: true } : {}),
    })
  }
  return recordWritings(scaleDir, entries, by)
}

const CONFIG_LAYER = /^(config\.yaml|policy\.yaml|thresholds\.json|agent-language\.md|output-policy\.json|memory-providers\.json|skills\.json|tools\.json)$/

function IDempotenceOf(rel: string): string | undefined {
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md' || rel.endsWith('.md')) return 'markers'
  if (rel.endsWith('.json') || rel.endsWith('.toml')) return 'json-merge'
  return undefined
}

function inferKind(rel: string): SurfaceKind {
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md' || rel === 'CONTEXT.md') return 'external'
  if (rel.startsWith('.scale/')) return classifyScalePath(rel.slice('.scale/'.length))
  return 'external'
}

// ---------------------------------------------------------------------------
// Classification (doctor --surface / scale clean share this)
// ---------------------------------------------------------------------------

/** Classify a .scale/-internal relative path into its governance bucket. */
export function classifyScalePath(rel: string): Exclude<SurfaceKind, 'external'> {
  const p = rel.replace(/\\/g, '/')
  if (p.startsWith('evidence/')) return 'evidence'
  if (p.startsWith('specs/')) return 'specs'
  if (p.startsWith('reports/')) return 'reports'
  if (p.startsWith('tmp/')) return 'tmp'
  if (p.startsWith('cache/') || p.startsWith('vectors/') || p.startsWith('worktrees/')) return 'cache'
  if (p.startsWith('events/') || p.startsWith('phases/') || p.startsWith('ledger/')
    || p.startsWith('agents/') || p.startsWith('release/') || p.startsWith('judges/')
    || p.startsWith('evals/') || p.startsWith('memory/') || p.startsWith('metrics/')
    || p.startsWith('artifacts/') || p.startsWith('checkpoints/') || p.startsWith('state/')
    || p.startsWith('instincts/') || p.startsWith('workflows/')) return 'state'
  // single files: editable → config, machine-generated → state
  if (CONFIG_LAYER.test(p)) return 'config'
  return 'state'
}

/** Kinds `scale clean` may ever touch. evidence/specs/config are structurally excluded. */
export const CLEANABLE_KINDS: ReadonlySet<SurfaceKind> = new Set(['tmp', 'cache', 'reports'] as const)

// ---------------------------------------------------------------------------
// Dual-layout resolution (v2 six-bucket ↔ legacy flat)
// ---------------------------------------------------------------------------

const V2_MAP: Array<{ dir: string; names: string[] }> = [
  { dir: 'config', names: ['config.yaml', 'policy.yaml', 'thresholds.json', 'agent-language.md', 'output-policy.json', 'memory-providers.json', 'skills.json', 'tools.json', 'assets.json', 'frameworks.json', 'governance.lock.json', 'product-smoke.json', 'output-policy.json'] },
  { dir: 'state', names: ['events', 'phases', 'ledger', 'agents', 'release', 'judges', 'evals', 'memory', 'metrics', 'artifacts', 'checkpoints', 'integrations'] },
  { dir: 'evidence', names: ['evidence'] },
  { dir: 'specs', names: ['specs'] },
  { dir: 'reports', names: ['reports'] },
  { dir: 'cache', names: ['cache', 'vectors', 'worktrees', 'scale.db', 'scale.db-journal', 'knowledge.db'] },
]

export function isLayoutV2(scaleDir: string): boolean {
  try {
    const layout = JSON.parse(readFileSync(join(scaleDir, 'layout.json'), 'utf-8')) as { version?: number }
    return layout.version === 2
  } catch {
    return false
  }
}

/**
 * Resolve a logical .scale name against the active layout. v2 maps flat names
 * into buckets; legacy returns the flat path unchanged.
 */
/** Bucket dirs that are their own flat name — data stays at .scale/<name>. */
const V2_SELF_BUCKETS = ['config', 'state', 'evidence', 'specs', 'reports', 'tmp', 'cache']

/** v2-bucket resolution independent of the active layout (migration targets). */
export function resolveV2Path(scaleDir: string, name: string): string {
  // self-bucket paths (evidence, evidence/runtime, tmp/…) are already in
  // place — moving them would mean renaming a directory into itself
  for (const bucket of V2_SELF_BUCKETS) {
    if (name === bucket || name.startsWith(`${bucket}/`)) return join(scaleDir, name)
  }
  for (const entry of V2_MAP) {
    if (entry.names.includes(name)) return join(scaleDir, entry.dir, name)
    const root = entry.names.find(n => name.startsWith(`${n}/`))
    if (root) return join(scaleDir, entry.dir, name)
  }
  return join(scaleDir, 'state', name)
}

export function resolveScalePath(scaleDir: string, name: string): string {
  if (!isLayoutV2(scaleDir)) return join(scaleDir, name)
  return resolveV2Path(scaleDir, name)
}

// ---------------------------------------------------------------------------
// tmp root + TTL sweep (T1)
// ---------------------------------------------------------------------------

export const TMP_TTL_MS = 72 * 60 * 60 * 1000

export function scaleTmpDir(scaleDir: string): string {
  const dir = join(scaleDir, 'tmp')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Remove .scale/tmp/ entries older than ttlMs. Returns removed count; never throws. */
export function sweepScaleTmp(scaleDir: string, ttlMs = TMP_TTL_MS, now = Date.now()): number {
  const dir = join(scaleDir, 'tmp')
  if (!existsSync(dir)) return 0
  let removed = 0
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        const mtime = statSync(full).mtimeMs
        if (now - mtime > ttlMs) {
          rmSync(full, { recursive: true, force: true })
          removed += 1
        }
      } catch {
        // unreadable entry — leave it
      }
    }
  } catch {
    return removed
  }
  return removed
}

// ---------------------------------------------------------------------------
// Probe-based consolidated roots (T2.3) — new projects write under .scale/,
// legacy projects keep their existing location; readers check both.
// ---------------------------------------------------------------------------

/**
 * Workflow docs root: generated templates live under .scale/reports/workflow
 * for any project with a .scale dir (every scale project), falling back to
 * the legacy user docs/workflow location for pre-0.57 projects that have it.
 */
export function workflowDocsRoot(projectDir: string): string {
  const modern = join(projectDir, '.scale', 'reports', 'workflow')
  if (existsSync(modern)) return modern
  const legacy = join(projectDir, 'docs', 'workflow')
  if (existsSync(legacy)) return legacy
  return modern
}

/**
 * Where NEW workflow-doc writes go: projects that already have docs/workflow
 * keep it (zero disruption, lock keys unchanged); clean projects keep their
 * docs/ free of generated output (plan 2026-10-24 §3.4).
 */
export function workflowDocsWriteRoot(projectDir: string): string {
  const legacy = join(projectDir, 'docs', 'workflow')
  if (existsSync(legacy)) return legacy
  return join(projectDir, '.scale', 'reports', 'workflow')
}

/** Map a logical docs/workflow/... path to its physical location. */
export function workflowDocPhysicalPath(projectDir: string, logicalPath: string): string {
  if (logicalPath.startsWith('docs/workflow/')) {
    return join(workflowDocsWriteRoot(projectDir), logicalPath.slice('docs/workflow/'.length))
  }
  return join(projectDir, logicalPath)
}

/** Planning task root: .scale/state/planning when .scale exists, else legacy .planning. */
export function planningRoot(projectDir: string): string {
  return existsSync(join(projectDir, '.scale'))
    ? join(projectDir, '.scale', 'state', 'planning')
    : join(projectDir, '.planning')
}

/** Workflow agent-state dir: .scale/state/agent when .scale exists, else legacy .agent/state. */
export function agentStateRoot(projectDir: string): string {
  return existsSync(join(projectDir, '.scale'))
    ? join(projectDir, '.scale', 'state', 'agent')
    : join(projectDir, '.agent', 'state')
}

// ---------------------------------------------------------------------------
// doctor --surface listing
// ---------------------------------------------------------------------------

export interface SurfaceListing {
  roots: Array<{ path: string; kind: SurfaceKind | 'root'; note?: string }>
  external: ManifestEntry[]
  unregistered: string[]
  missing: string[]
  scaleEntryCount: number
}

/** Build the four-class surface listing for a project. */
export function listSurface(projectDir: string, scaleDir = join(projectDir, '.scale')): SurfaceListing {
  const manifest = loadManifest(scaleDir)
  const external = manifest.writings.filter(w => w.kind === 'external')
  const unregistered: string[] = []
  for (const [platform, paths] of Object.entries(PLATFORM_SURFACE)) {
    for (const rel of paths) {
      if (existsSync(join(projectDir, rel)) && !manifest.writings.some(w => w.path === rel)) {
        unregistered.push(rel)
        void platform
      }
    }
  }
  for (const rel of KNOWLEDGE_DOCS) {
    if (existsSync(join(projectDir, rel)) && !manifest.writings.some(w => w.path === rel)) {
      unregistered.push(rel)
    }
  }
  const missing = manifest.writings.filter(w => w.kind === 'external' && !existsSync(join(projectDir, w.path))).map(w => w.path)

  let scaleEntryCount = 0
  try {
    scaleEntryCount = readdirSync(scaleDir).length
  } catch {
    scaleEntryCount = 0
  }

  const roots: SurfaceListing['roots'] = [
    { path: '.scale/evidence/', kind: 'evidence', note: '治理证据 — 永不自动清理' },
    { path: '.scale/specs/', kind: 'specs', note: '规范 — 永不自动清理' },
    { path: '.scale/config 层', kind: 'config', note: '用户可编辑 — clean 不触碰' },
    { path: '.scale/state/', kind: 'state', note: '运行状态 — clean --all 候选' },
    { path: '.scale/reports/', kind: 'reports', note: '可再生 — clean 候选' },
    { path: '.scale/tmp/', kind: 'tmp', note: '72h TTL 自愈' },
    { path: '.scale/cache/', kind: 'cache', note: '可再生 — clean 候选' },
  ]
  return { roots, external, unregistered, missing, scaleEntryCount }
}
