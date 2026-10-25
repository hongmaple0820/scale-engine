// scale uninstall — manifest-driven removal of SCALE's footprint in a project
// (plan 2026-10-24 §2.4).
//
// Dry-run by default (same contract as scale clean). --exec performs:
//   - AGENTS.md / CLAUDE.md: strip the SCALE:BEGIN/END section only (the file
//     itself belongs to the project and may host other content)
//   - regenerable generated docs (manifest kind=external & regenerable, e.g.
//     workflow templates): deleted
//   - platform configs (.claude/settings.json …): NOT deleted wholesale —
//     they may contain the user's own settings. Listed for manual review.
//   - .scale/: removed entirely unless --keep-evidence, which archives
//     evidence/ + specs/ (+ config layer) into scale-archive-<date>.tar.gz first
//   - registered-but-manifest-missing entries are reported, not acted on

import { defineCommand } from 'citty'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadManifest, KNOWLEDGE_DOCS, PLATFORM_SURFACE } from '../surface/ScaleSurface.js'

const SECTION_BEGIN = '<!-- SCALE:BEGIN -->'
const SECTION_END = '<!-- SCALE:END -->'

/** Strip the SCALE:BEGIN/END section from a knowledge doc (exported for tests). */
export function stripScaleSection(text: string): { text: string; removed: boolean } {
  const begin = text.indexOf(SECTION_BEGIN)
  if (begin === -1) return { text, removed: false }
  const end = text.indexOf(SECTION_END, begin)
  const stop = end === -1 ? text.length : end + SECTION_END.length
  const before = text.slice(0, begin)
  const after = text.slice(stop)
  // swallow the blank lines the section leaves behind
  return { text: before.replace(/\r?\n\s*$/, '\n\n') + after.replace(/^\r?\n+/, ''), removed: true }
}

function dirSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      total += entry.isDirectory() ? dirSize(full) : statSync(full).size
    }
  } catch { /* unreadable */ }
  return total
}

function tarArchive(sourceDir: string, outFile: string): boolean {
  // Windows 10+/macOS/linux all ship a bsdtar-compatible tar
  const result = spawnSync('tar', ['-czf', outFile, '-C', sourceDir, '.'], { encoding: 'utf-8' })
  return result.status === 0
}

export const uninstallCommand = defineCommand({
  meta: { name: 'uninstall', description: 'Remove the SCALE footprint from a project (manifest-driven; dry-run by default). Plan 2026-10-24' },
  args: {
    exec: { type: 'boolean', default: false, description: 'Actually uninstall (default is a dry-run listing)' },
    dir: { type: 'string', default: '.', description: 'Project directory' },
    'keep-evidence': { type: 'boolean', default: true, description: 'Archive evidence/specs/config into scale-archive-<date>.tar.gz before removing .scale (default true; --no-keep-evidence to skip)' },
  },
  async run({ args }) {
    const projectDir = String(args.dir || '.')
    const scaleDir = join(projectDir, '.scale')
    const manifest = loadManifest(scaleDir)

    const docStrips: string[] = []
    const deletions: string[] = []
    const manual: string[] = []
    const unregistered: string[] = []

    // 1. knowledge docs: strip SCALE section
    for (const doc of KNOWLEDGE_DOCS) {
      const file = join(projectDir, doc)
      if (existsSync(file) && readFileSync(file, 'utf-8').includes(SECTION_BEGIN)) docStrips.push(doc)
    }

    // 2. manifest external entries
    for (const w of manifest.writings) {
      if (w.kind !== 'external') continue
      const file = join(projectDir, w.path)
      if (!existsSync(file)) continue
      if (w.regenerable) deletions.push(w.path)
      else if (w.path === 'AGENTS.md' || w.path === 'CLAUDE.md') continue // handled as doc strip
      else manual.push(w.path)
    }

    // 3. fallback platform scan for unregistered legacy installs
    for (const paths of Object.values(PLATFORM_SURFACE)) {
      for (const rel of paths) {
        if (rel === 'AGENTS.md') continue
        if (existsSync(join(projectDir, rel)) && !manual.includes(rel)
          && !manifest.writings.some(w => w.path === rel)) unregistered.push(rel)
      }
    }

    const scaleExists = existsSync(scaleDir)
    const scaleBytes = scaleExists ? dirSize(scaleDir) : 0
    const keepEvidence = args['keep-evidence'] !== false

    console.log('\nSCALE 卸载计划（dry-run，--exec 执行）:')
    if (docStrips.length) {
      console.log('\n  摘除 SCALE 段落（保留文件本身）:')
      for (const d of docStrips) console.log(`    ${d}`)
    }
    if (deletions.length) {
      console.log('\n  删除生成文档:')
      for (const d of deletions) console.log(`    ${d}`)
    }
    if (manual.length || unregistered.length) {
      console.log('\n  ⚠️  需人工确认的平台配置（含用户自身设置，不自动删）:')
      for (const m of manual) console.log(`    ${m}`)
      for (const u of unregistered) console.log(`    ${u} (未登记)`)
    }
    if (scaleExists) {
      console.log(`\n  删除 .scale/（${(scaleBytes / 1024).toFixed(1)} KB）${keepEvidence ? '—— evidence/specs/config 先归档' : '—— 不归档（--no-keep-evidence）'}`)
    }
    if (!docStrips.length && !deletions.length && !scaleExists) {
      console.log('\n  未发现 SCALE 产出。')
      return
    }
    if (!args.exec) {
      console.log('\n这是 dry-run。执行: scale uninstall --exec [--no-keep-evidence]')
      return
    }

    // ---- exec ----
    for (const doc of docStrips) {
      try {
        const file = join(projectDir, doc)
        const stripped = stripScaleSection(readFileSync(file, 'utf-8'))
        writeFileSync(file, stripped.text, 'utf-8')
      } catch { /* best-effort */ }
    }
    for (const rel of deletions) {
      try { rmSync(join(projectDir, rel), { recursive: true, force: true }) } catch { /* best-effort */ }
    }

    if (scaleExists) {
      if (keepEvidence) {
        const keep = ['evidence', 'specs', 'config', 'config.yaml', 'policy.yaml', 'thresholds.json', 'skills.json', 'tools.json', 'output-policy.json', 'memory-providers.json', 'manifest.json', 'layout.json']
          .filter(name => existsSync(join(scaleDir, name)))
        if (keep.length > 0) {
          const staging = join(projectDir, '.scale-archive-staging')
          rmSync(staging, { recursive: true, force: true })
          mkdirSync(staging, { recursive: true })
          for (const name of keep) {
            try {
              spawnSync(process.platform === 'win32' ? 'cmd' : 'cp', process.platform === 'win32'
                ? ['/d', 'c', 'xcopy', join(scaleDir, name), join(staging, name), '/e', '/i', '/q', '/y']
                : ['-r', join(scaleDir, name), staging], { encoding: 'utf-8' })
            } catch { /* best-effort per entry */ }
          }
          const archive = join(projectDir, `scale-archive-${new Date().toISOString().slice(0, 10)}.tar.gz`)
          if (tarArchive(staging, archive)) console.log(`  归档: ${archive}`)
          else console.log('  ⚠️  归档失败（tar 不可用）——.scale/ 未删除以保护证据。手动归档后重试。')
          rmSync(staging, { recursive: true, force: true })
          if (!existsSync(archive)) return
        }
      }
      rmSync(scaleDir, { recursive: true, force: true })
    }

    console.log('\n卸载完成。平台配置文件保留在原处（见上方人工清单）——确认无他用后可自行删除 SCALE 相关键/文件。')
  },
})
