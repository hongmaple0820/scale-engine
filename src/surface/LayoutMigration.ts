// Layout v2 migration (plan 2026-10-24 §3) — move flat .scale entries into
// the six buckets and leave a compatibility link (junction on Windows,
// symlink elsewhere) at every legacy flat path.
//
// Why links instead of first sweeping all 129 hardcoded join(scaleDir, …)
// call sites: any missed literal would silently read a fresh/empty location
// after the move. With legacy-path links, every existing reader keeps
// resolving the moved data unchanged; the literal sweep stays possible as
// non-blocking hygiene (resolveScalePath already understands both layouts).
//
// Three-phase per entry (move → link → record) so an interrupted migration
// can simply be re-run; rollback reverses from the recorded report.

import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isLayoutV2, resolveV2Path } from './ScaleSurface.js'

export interface MigrationReport {
  migratedAt: string
  layout: 2
  /** legacy flat name → bucket-relative target */
  moved: Array<{ from: string; to: string }>
  /** legacy flat name → link created at that path */
  links: string[]
  skipped: string[]
}

const BUCKETS = ['config', 'state', 'evidence', 'specs', 'reports', 'cache']
const KEEP_IN_PLACE = new Set(['manifest.json', 'layout.json', 'tmp'])

function reportPath(scaleDir: string): string {
  return join(scaleDir, 'state', 'migration-report.json')
}

function makeLink(linkPath: string, targetPath: string): void {
  if (existsSync(linkPath)) return
  // junctions resolve their target against the link's own directory when
  // given a relative path — always hand them an absolute target
  const absoluteTarget = resolve(targetPath)
  if (lstatSync(absoluteTarget).isFile()) {
    // Windows junctions can only alias directories — files get a hard link
    // (same volume inside .scale, no elevation needed).
    linkSync(absoluteTarget, linkPath)
    return
  }
  if (process.platform === 'win32') {
    symlinkSync(absoluteTarget, linkPath, 'junction')
  } else {
    symlinkSync(absoluteTarget, linkPath)
  }
}

/**
 * Migrate a legacy flat .scale/ to layout v2. Idempotent: bucket dirs and
 * already-migrated entries are skipped. Throws on the first entry whose link
 * cannot be created (a missing compat link would break legacy readers).
 */
export function migrateLayoutV2(projectDir: string, scaleDir = join(projectDir, '.scale')): MigrationReport {
  if (isLayoutV2(scaleDir)) {
    const previous = loadReport(scaleDir)
    return previous
      ? { ...previous, skipped: [...previous.skipped, 'already-v2'] }
      : { migratedAt: new Date().toISOString(), layout: 2, moved: [], links: [], skipped: ['already-v2'] }
  }
  if (!existsSync(scaleDir)) {
    throw new Error(`no .scale directory at ${scaleDir} — run scale init first`)
  }

  // ensure buckets exist
  for (const bucket of BUCKETS) mkdirSync(join(scaleDir, bucket), { recursive: true })

  const report: MigrationReport = { migratedAt: new Date().toISOString(), layout: 2, moved: [], links: [], skipped: [] }

  for (const name of readdirSync(scaleDir)) {
    if (BUCKETS.includes(name) || KEEP_IN_PLACE.has(name)) continue
    const from = join(scaleDir, name)
    const to = resolveV2Path(scaleDir, name)
    if (from === to) { report.skipped.push(name); continue }
    if (existsSync(to)) {
      // bucket target already occupied (partial earlier run) — treat as done
      report.skipped.push(name)
      continue
    }
    renameSync(from, to)
    try {
      makeLink(from, to)
    } catch (error) {
      // restore and abort: a legacy path without its compat link breaks readers
      rmSync(from, { force: true })
      renameSync(to, from)
      throw new Error(`migration aborted at "${name}": compat link creation failed (${error instanceof Error ? error.message : String(error)}) — entry restored, nothing lost`)
    }
    report.moved.push({ from: name, to: to.slice(scaleDir.length + 1) })
    report.links.push(name)
  }

  writeFileSync(join(scaleDir, 'layout.json'), JSON.stringify({ version: 2, migratedAt: report.migratedAt }, null, 2) + '\n', 'utf-8')
  mkdirSync(join(scaleDir, 'state'), { recursive: true })
  writeFileSync(reportPath(scaleDir), JSON.stringify(report, null, 2) + '\n', 'utf-8')
  return report
}

/**
 * Rollback a v2 migration: remove compat links, move entries back out of
 * buckets, delete layout.json. Only reverses what the report recorded.
 */
export function rollbackLayoutV2(projectDir: string, scaleDir = join(projectDir, '.scale')): MigrationReport {
  const report = loadReport(scaleDir)
  if (!report) throw new Error('no migration report found — nothing to roll back')
  if (!isLayoutV2(scaleDir)) throw new Error('layout is not v2 — nothing to roll back')

  // reverse order so nested moves undo cleanly
  for (const entry of [...report.moved].reverse()) {
    const linkPath = join(scaleDir, entry.from)
    const realPath = join(scaleDir, entry.to)
    // remove the compat link first (on Windows it is a junction entry itself)
    try { unlinkSync(linkPath) } catch { /* may already be gone */ }
    if (existsSync(realPath)) renameSync(realPath, linkPath)
  }
  // remove now-empty bucket dirs (only if empty — never drop real content)
  for (const bucket of BUCKETS) {
    const dir = join(scaleDir, bucket)
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true })
    } catch { /* non-empty or busy — leave it */ }
  }
  try { rmSync(reportPath(scaleDir), { force: true }) } catch { /* best effort */ }
  try { rmSync(join(scaleDir, 'layout.json'), { force: true }) } catch { /* best effort */ }
  return report
}

export function loadReport(scaleDir: string): MigrationReport | null {
  try {
    return JSON.parse(readFileSync(reportPath(scaleDir), 'utf-8')) as MigrationReport
  } catch {
    return null
  }
}
