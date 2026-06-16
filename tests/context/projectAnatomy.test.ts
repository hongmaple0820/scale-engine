import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectAnatomy } from '../../src/context/ProjectAnatomy.js'

function makeTestDir(): string {
  const dir = join(tmpdir(), `scale-test-anatomy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch { /* Windows may lock files */ }
}

describe('ProjectAnatomy', () => {
  let anatomy: ProjectAnatomy
  let testDir: string

  beforeEach(() => {
    anatomy = new ProjectAnatomy()
    testDir = makeTestDir()
  })

  afterEach(() => {
    cleanupDir(testDir)
  })

  describe('scan', () => {
    it('scans a directory and returns entries grouped by section', () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      writeFileSync(join(testDir, 'src', 'index.ts'), 'export function main() {}')
      writeFileSync(join(testDir, 'src', 'utils.ts'), 'export function helper() {}')
      writeFileSync(join(testDir, 'package.json'), '{"name":"test"}')

      const sections = anatomy.scan(testDir)

      expect(sections.size).toBeGreaterThan(0)
      // src/ section should have 2 files
      const srcEntries = sections.get('src/')
      expect(srcEntries).toBeDefined()
      expect(srcEntries!.length).toBe(2)
      // ./ section should have package.json
      const rootEntries = sections.get('./')
      expect(rootEntries).toBeDefined()
      expect(rootEntries!.some(e => e.file === 'package.json')).toBe(true)
    })

    it('respects maxFiles limit', () => {
      mkdirSync(join(testDir, 'src'), { recursive: true })
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(testDir, 'src', `file${i}.ts`), `export const v${i} = ${i}`)
      }

      const sections = anatomy.scan(testDir, { maxFiles: 3 })
      let total = 0
      for (const [, list] of sections) total += list.length
      expect(total).toBeLessThanOrEqual(3)
    })

    it('respects maxFiles limit across nested directories', () => {
      for (const dir of ['a', 'b', 'c']) {
        mkdirSync(join(testDir, dir), { recursive: true })
        for (let i = 0; i < 4; i++) {
          writeFileSync(join(testDir, dir, `file${i}.ts`), `export const ${dir}${i} = ${i}`)
        }
      }

      const sections = anatomy.scan(testDir, { maxFiles: 5 })
      let total = 0
      for (const [, list] of sections) total += list.length
      expect(total).toBeLessThanOrEqual(5)
    })

    it('excludes node_modules and .git by default', () => {
      mkdirSync(join(testDir, 'node_modules', 'pkg'), { recursive: true })
      mkdirSync(join(testDir, '.git', 'objects'), { recursive: true })
      mkdirSync(join(testDir, 'src'), { recursive: true })
      writeFileSync(join(testDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}')
      writeFileSync(join(testDir, '.git', 'config'), '[core]')
      writeFileSync(join(testDir, 'src', 'main.ts'), 'export const x = 1')

      const sections = anatomy.scan(testDir)

      for (const [key, entries] of sections) {
        expect(key).not.toContain('node_modules')
        expect(key).not.toContain('.git')
        for (const entry of entries) {
          expect(entry.file).not.toBe('index.js') // from node_modules
        }
      }
    })

    it('excludes binary files', () => {
      mkdirSync(join(testDir, 'assets'), { recursive: true })
      writeFileSync(join(testDir, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      writeFileSync(join(testDir, 'assets', 'readme.md'), '# Assets')

      const sections = anatomy.scan(testDir)
      const assetEntries = sections.get('assets/')
      expect(assetEntries).toBeDefined()
      expect(assetEntries!.length).toBe(1)
      expect(assetEntries![0].file).toBe('readme.md')
    })

    it('excludes .env files', () => {
      writeFileSync(join(testDir, '.env'), 'SECRET=abc')
      writeFileSync(join(testDir, '.env.local'), 'SECRET=def')
      writeFileSync(join(testDir, 'src.ts'), 'export const x = 1')

      const sections = anatomy.scan(testDir)
      for (const [, entries] of sections) {
        for (const entry of entries) {
          expect(entry.file).not.toBe('.env')
          expect(entry.file).not.toBe('.env.local')
        }
      }
    })
  })

  describe('extractDescription', () => {
    it('extracts JSDoc comment', () => {
      const file = join(testDir, 'service.ts')
      writeFileSync(file, '/**\n * User authentication service\n * Handles JWT tokens\n */\nexport class AuthService {}')

      const desc = anatomy.extractDescription(file)
      expect(desc).toContain('User authentication service')
    })

    it('extracts Python docstring', () => {
      const file = join(testDir, 'model.py')
      writeFileSync(file, '"""User model for the database."""\nclass User:\n    pass')

      const desc = anatomy.extractDescription(file)
      expect(desc).toContain('User model for the database')
    })

    it('extracts exports from TypeScript', () => {
      const file = join(testDir, 'types.ts')
      writeFileSync(file, 'export interface User { name: string }\nexport type Role = "admin" | "user"')

      const desc = anatomy.extractDescription(file)
      expect(desc).toContain('User')
    })

    it('returns known description for package.json', () => {
      const file = join(testDir, 'package.json')
      writeFileSync(file, '{"name":"test"}')

      const desc = anatomy.extractDescription(file)
      expect(desc).toBe('Node.js package manifest')
    })

    it('returns empty for empty file', () => {
      const file = join(testDir, 'empty.ts')
      writeFileSync(file, '')

      const desc = anatomy.extractDescription(file)
      expect(desc).toBe('')
    })

    it('extracts markdown heading', () => {
      const file = join(testDir, 'guide.md')
      writeFileSync(file, '# My Project\n\nThis is a great project.')

      const desc = anatomy.extractDescription(file)
      expect(desc).toBe('My Project')
    })
  })

  describe('serialize and parse', () => {
    it('round-trips through serialize and parse', () => {
      const sections = new Map<string, Array<{ file: string; description: string; tokens: number }>>()
      sections.set('src/', [
        { file: 'index.ts', description: 'Main entry point', tokens: 150 },
        { file: 'utils.ts', description: 'Helpers', tokens: 80 },
      ])
      sections.set('./', [
        { file: 'package.json', description: 'Node.js package manifest', tokens: 30 },
      ])

      const serialized = anatomy.serialize(sections)
      expect(serialized).toContain('## src/')
      expect(serialized).toContain('`index.ts` - Main entry point (~150 tok)')
      expect(serialized).toContain('## ./')
      expect(serialized).toContain('`package.json` - Node.js package manifest (~30 tok)')

      const parsed = anatomy.parse(serialized)
      expect(parsed.get('src/')!.length).toBe(2)
      expect(parsed.get('src/')![0].file).toBe('index.ts')
      expect(parsed.get('src/')![0].description).toBe('Main entry point')
      expect(parsed.get('src/')![0].tokens).toBe(150)
    })

    it('handles entries without descriptions', () => {
      const sections = new Map<string, Array<{ file: string; description: string; tokens: number }>>()
      sections.set('src/', [
        { file: 'index.ts', description: '', tokens: 100 },
      ])

      const serialized = anatomy.serialize(sections)
      expect(serialized).toContain('`index.ts` (~100 tok)')

      const parsed = anatomy.parse(serialized)
      expect(parsed.get('src/')![0].description).toBe('')
    })
  })

  describe('updateEntry', () => {
    it('upserts a new entry', () => {
      const sections = new Map<string, AnatomyEntry[]>()
      anatomy.updateEntry(sections, 'src/main.ts', 'export function main() {}', 'upsert')

      const entries = sections.get('src/')
      expect(entries).toBeDefined()
      expect(entries!.length).toBe(1)
      expect(entries![0].file).toBe('main.ts')
      expect(entries![0].tokens).toBeGreaterThan(0)
    })

    it('upserts an existing entry', () => {
      const sections = new Map<string, AnatomyEntry[]>()
      sections.set('src/', [{ file: 'main.ts', description: 'Old', tokens: 10 }])

      anatomy.updateEntry(sections, 'src/main.ts', 'export function main() { return 42 }', 'upsert')

      expect(sections.get('src/')!.length).toBe(1)
      expect(sections.get('src/')![0].description).not.toBe('Old')
    })

    it('deletes an entry', () => {
      const sections = new Map<string, AnatomyEntry[]>()
      sections.set('src/', [
        { file: 'main.ts', description: 'Main', tokens: 100 },
        { file: 'utils.ts', description: 'Utils', tokens: 50 },
      ])

      anatomy.updateEntry(sections, 'src/main.ts', '', 'delete')

      expect(sections.get('src/')!.length).toBe(1)
      expect(sections.get('src/')![0].file).toBe('utils.ts')
    })

    it('removes section when last entry is deleted', () => {
      const sections = new Map<string, AnatomyEntry[]>()
      sections.set('src/', [{ file: 'main.ts', description: 'Main', tokens: 100 }])

      anatomy.updateEntry(sections, 'src/main.ts', '', 'delete')

      expect(sections.has('src/')).toBe(false)
    })
  })

  describe('estimateTokens', () => {
    it('estimates token count from content length', () => {
      const content = 'x'.repeat(400)
      // estimateTokens uses Math.ceil(content.length / 4)
      const sections = new Map<string, AnatomyEntry[]>()
      anatomy.updateEntry(sections, 'test.ts', content, 'upsert')
      expect(sections.get('./')![0].tokens).toBe(100)
    })
  })
})

type AnatomyEntry = { file: string; description: string; tokens: number }
