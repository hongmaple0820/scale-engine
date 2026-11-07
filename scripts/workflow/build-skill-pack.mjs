#!/usr/bin/env node
// P3-A: build/validate the SKILL.md pack (Anthropic Agent Skills convention:
// each skill is a directory with SKILL.md carrying YAML frontmatter name+description).
//
// Usage: node scripts/workflow/build-skill-pack.mjs [--json] [--out <dir>]
// Reads skills-pack/<name>/SKILL.md, validates frontmatter, and emits a manifest.
// It does NOT publish anything; publishing to a skills marketplace is a separate,
// account-gated step.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const packDir = join(repoRoot, 'skills-pack')

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const fields = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/)
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

function main() {
  const json = process.argv.includes('--json')
  const outIdx = process.argv.indexOf('--out')
  const outDir = outIdx >= 0 ? resolve(process.argv[outIdx + 1]) : null

  if (!existsSync(packDir)) {
    console.error(`[build-skill-pack] skills-pack/ not found at ${packDir}`)
    process.exitCode = 1
    return
  }

  const skills = []
  const problems = []
  for (const entry of readdirSync(packDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillPath = join(packDir, entry.name, 'SKILL.md')
    if (!existsSync(skillPath)) { problems.push(`${entry.name}: missing SKILL.md`); continue }
    const fm = parseFrontmatter(readFileSync(skillPath, 'utf-8'))
    if (!fm) { problems.push(`${entry.name}: missing YAML frontmatter`); continue }
    if (!fm.name) problems.push(`${entry.name}: frontmatter missing "name"`)
    if (!fm.description) problems.push(`${entry.name}: frontmatter missing "description"`)
    skills.push({ name: fm.name || entry.name, version: fm.version || '0.0.0', description: fm.description || '', path: `skills-pack/${entry.name}/SKILL.md` })
  }

  const manifest = { version: 1, generatedAt: new Date().toISOString(), skills, problems, ok: problems.length === 0 }

  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  }

  if (json) {
    console.log(JSON.stringify(manifest, null, 2))
  } else {
    console.log(`\nSKILL.md pack: ${skills.length} skill(s), ${problems.length} problem(s)`)
    for (const s of skills) console.log(`  [${s.name}@${s.version}] ${s.description.slice(0, 70)}`)
    for (const p of problems) console.log(`  x ${p}`)
  }
  if (!manifest.ok) process.exitCode = 1
}

main()
