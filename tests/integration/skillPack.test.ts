import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACK = join(process.cwd(), 'skills-pack')

function frontmatter(text: string): Record<string, string> | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const fields: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/)
    if (kv) fields[kv[1]] = kv[2].trim()
  }
  return fields
}

describe('SKILL.md pack (P3-A)', () => {
  it('ships at least three SKILL.md skills with Anthropic-convention frontmatter', () => {
    expect(existsSync(PACK)).toBe(true)
    const skillDirs = readdirSync(PACK, { withFileTypes: true }).filter(e => e.isDirectory())
    expect(skillDirs.length).toBeGreaterThanOrEqual(3)
    for (const dir of skillDirs) {
      const skillPath = join(PACK, dir.name, 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)
      const fm = frontmatter(readFileSync(skillPath, 'utf-8'))
      expect(fm).not.toBeNull()
      expect(fm!.name).toBeTruthy()
      expect(fm!.description).toBeTruthy()
    }
  })

  it('each skill name matches its directory', () => {
    for (const dir of readdirSync(PACK, { withFileTypes: true }).filter(e => e.isDirectory())) {
      const fm = frontmatter(readFileSync(join(PACK, dir.name, 'SKILL.md'), 'utf-8'))
      expect(fm!.name).toBe(dir.name)
    }
  })
})
