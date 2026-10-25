// scale clean — output-surface cleaning (plan 2026-10-24 §2.4)
//
// Contract: dry-run by default; --exec deletes; NEVER touches evidence/,
// specs/, or the config layer — that exclusion is structural (classify +
// CLEANABLE_KINDS), not a path blacklist.

import { defineCommand } from 'citty'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifyScalePath,
  CLEANABLE_KINDS,
  sweepScaleTmp,
} from '../surface/ScaleSurface.js'

interface CleanCandidate {
  path: string
  kind: string
  reason: string
  sizeBytes: number
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) total += dirSize(full)
      else total += statSync(full).size
    }
  } catch {
    // unreadable — count as 0
  }
  return total
}

function collect(scaleDir: string, reportsMinAgeDays: number): CleanCandidate[] {
  const out: CleanCandidate[] = []
  const now = Date.now()
  const reportsCutoff = now - reportsMinAgeDays * 24 * 60 * 60 * 1000

  if (!existsSync(scaleDir)) return out

  // tmp/: TTL rule regardless of --exec input age (sweepScaleTmp semantics)
  const tmpDir = join(scaleDir, 'tmp')
  if (existsSync(tmpDir)) {
    for (const entry of readdirSync(tmpDir)) {
      out.push({ path: `.scale/tmp/${entry}`, kind: 'tmp', reason: 'TTL 72h', sizeBytes: dirSize(join(tmpDir, entry)) })
    }
  }

  // cache/ and reports/: kind-level candidates
  for (const [dir, kind, reason] of [
    ['cache', 'cache', '可再生缓存'],
    ['reports', 'reports', `可再生报告（>${reportsMinAgeDays}天）`],
  ] as const) {
    const full = join(scaleDir, dir)
    if (!existsSync(full)) continue
    for (const entry of readdirSync(full)) {
      if (dir === 'reports') {
        try {
          if (now - statSync(join(full, entry)).mtimeMs < reportsCutoff) continue
        } catch {
          continue
        }
      }
      out.push({ path: `.scale/${dir}/${entry}`, kind, reason, sizeBytes: dirSize(join(full, entry)) })
    }
  }
  return out
}

export const cleanCommand = defineCommand({
  meta: { name: 'clean', description: 'Clean regenerable SCALE output (tmp/cache/reports). Dry-run by default; never touches evidence/specs/config' },
  args: {
    exec: { type: 'boolean', default: false, description: 'Actually delete (default is dry-run listing)' },
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'reports-days': { type: 'string', default: '30', description: 'Minimum age (days) for reports/ entries (default 30)' },
  },
  async run({ args }) {
    const projectDir = String(args.dir || '.')
    const scaleDir = join(projectDir, '.scale')
    const reportsDays = Math.max(0, Number(args['reports-days'] ?? 30) || 0)

    const candidates = collect(scaleDir, reportsDays)
    const totalBytes = candidates.reduce((sum, c) => sum + c.sizeBytes, 0)

    // Structural guard: a candidate outside CLEANABLE kinds is a bug — abort loudly.
    for (const candidate of candidates) {
      const kind = classifyScalePath(candidate.path.replace(/^\.scale\//, ''))
      if (!CLEANABLE_KINDS.has(kind)) {
        console.error(`[clean] internal error: non-cleanable path classified as candidate (${candidate.path} → ${kind}); aborting`)
        process.exitCode = 1
        return
      }
    }

    if (candidates.length === 0) {
      console.log('无可清理项（evidence/specs/config 永不清理）。')
      return
    }

    console.log(`\n${args.exec ? '清理' : '将清理（dry-run，加 --exec 执行）'} ${candidates.length} 项，共 ${(totalBytes / 1024).toFixed(1)} KB:`)
    for (const c of candidates.slice(0, 50)) {
      console.log(`  [${c.kind}] ${c.path}  (${(c.sizeBytes / 1024).toFixed(1)} KB, ${c.reason})`)
    }
    if (candidates.length > 50) console.log(`  … 共 ${candidates.length} 项`)

    if (!args.exec) {
      console.log('\n这是 dry-run。执行: scale clean --exec')
      return
    }

    let removed = 0
    for (const c of candidates) {
      try {
        rmSync(join(projectDir, c.path), { recursive: true, force: true })
        removed += 1
      } catch {
        // best-effort per entry
      }
    }
    // tmp TTL sweep for stragglers (entries removed individually above)
    sweepScaleTmp(scaleDir)
    console.log(`\n已删除 ${removed}/${candidates.length} 项。evidence/specs/config 未触碰。`)
  },
})
