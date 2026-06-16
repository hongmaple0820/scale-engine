// SCALE Engine 鈥?Project Anatomy
// Scans project directory and generates a file map with descriptions and token estimates.
// Inspired by OpenWolf's anatomy system.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, basename, dirname } from 'node:path'
import { estimateTokens } from './ContextBudget.js'

export interface AnatomyEntry {
  file: string
  description: string
  tokens: number
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.mp4', '.avi', '.mov', '.webm', '.ogg',
  '.sqlite', '.db', '.wasm', '.lock',
])

const DEFAULT_EXCLUDE = ['node_modules', '.git', 'dist', 'build', '.scale', '.wolf', 'coverage', '.next', '__pycache__']

const ALWAYS_EXCLUDE_FILES = new Set(['.env', '.env.local', '.env.production', '.env.staging', '.env.development'])

export class ProjectAnatomy {
  scan(projectDir: string, opts?: { maxFiles?: number; excludePatterns?: string[] }): Map<string, AnatomyEntry[]> {
    const maxFiles = opts?.maxFiles ?? 500
    const excludePatterns = opts?.excludePatterns ?? DEFAULT_EXCLUDE
    const entries = new Map<string, AnatomyEntry[]>()
    const state = { fileCount: 0 }
    this.walkDir(projectDir, projectDir, excludePatterns, maxFiles, entries, state)
    return entries
  }

  serialize(sections: Map<string, AnatomyEntry[]>): string {
    const lines: string[] = [
      '# anatomy.md',
      '',
      `> Auto-maintained by SCALE Engine. Last scanned: ${new Date().toISOString()}`,
      '',
    ]

    let fileCount = 0
    let totalTokens = 0
    for (const [, list] of sections) {
      fileCount += list.length
      totalTokens += list.reduce((s, e) => s + e.tokens, 0)
    }

    lines.push(`> Files: ${fileCount} | Total: ~${totalTokens} tokens`)
    lines.push('')

    const sortedKeys = [...sections.keys()].sort()
    for (const key of sortedKeys) {
      lines.push(`## ${key}`)
      lines.push('')
      const entries = sections.get(key)!
      entries.sort((a, b) => a.file.localeCompare(b.file))
      for (const entry of entries) {
        const desc = entry.description ? ` - ${entry.description}` : ''
        lines.push(`- \`${entry.file}\`${desc} (~${entry.tokens} tok)`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  parse(content: string): Map<string, AnatomyEntry[]> {
    const sections = new Map<string, AnatomyEntry[]>()
    let currentSection = ''

    for (const line of content.split('\n')) {
      const sectionMatch = line.match(/^## (.+)/)
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim()
        if (!sections.has(currentSection)) sections.set(currentSection, [])
        continue
      }
      if (!currentSection) continue

      const entryMatch = line.match(/^- `([^`]+)`(?:\s+-\s+(.+?))?\s*\(~(\d+)\s+tok\)$/)
      if (entryMatch) {
        sections.get(currentSection)!.push({
          file: entryMatch[1],
          description: entryMatch[2] || '',
          tokens: parseInt(entryMatch[3], 10),
        })
      }
    }

    return sections
  }

  updateEntry(
    sections: Map<string, AnatomyEntry[]>,
    relPath: string,
    fileContent: string,
    action: 'upsert' | 'delete',
  ): void {
    const dir = dirname(relPath)
    const fileName = basename(relPath)
    const sectionKey = dir === '.' ? './' : dir + '/'

    if (action === 'delete') {
      const entries = sections.get(sectionKey)
      if (entries) {
        const idx = entries.findIndex(e => e.file === fileName)
        if (idx !== -1) entries.splice(idx, 1)
        if (entries.length === 0) sections.delete(sectionKey)
      }
      return
    }

    const desc = this.extractDescriptionFromContent(fileContent, relPath)
    const tokens = estimateTokens(fileContent)

    if (!sections.has(sectionKey)) sections.set(sectionKey, [])
    const entries = sections.get(sectionKey)!
    const idx = entries.findIndex(e => e.file === fileName)
    const entry: AnatomyEntry = { file: fileName, description: desc, tokens }

    if (idx !== -1) {
      entries[idx] = entry
    } else {
      entries.push(entry)
    }
  }

  extractDescription(filePath: string): string {
    let content: string
    try {
      const fd = filePath
      content = readFileSync(fd, 'utf-8')
    } catch {
      return ''
    }
    return this.extractDescriptionFromContent(content, filePath)
  }

  extractDescriptionFromContent(content: string, filePath: string): string {
    const MAX_DESC = 120
    const name = basename(filePath)
    const ext = extname(name).toLowerCase()

    if (!content.trim()) return ''

    const cap = (s: string) => s.length <= MAX_DESC ? s : s.slice(0, MAX_DESC - 3) + '...'

    // Known config files
    const known: Record<string, string> = {
      'package.json': 'Node.js package manifest',
      'tsconfig.json': 'TypeScript configuration',
      '.gitignore': 'Git ignore rules',
      'README.md': 'Project documentation',
      'Dockerfile': 'Docker container definition',
      'docker-compose.yml': 'Docker Compose services',
      'Cargo.toml': 'Rust package manifest',
      'go.mod': 'Go module definition',
    }
    if (known[name]) return known[name]

    // Markdown heading
    if (ext === '.md' || ext === '.mdx') {
      const m = content.match(/^#{1,2}\s+(.+)$/m)
      if (m) return cap(m[1].trim())
    }

    // JSDoc / PHPDoc / Javadoc
    const jm = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/)
    if (jm) {
      const l = jm[1].replace(/\*\/$/, '').trim()
      if (l && !l.startsWith('@') && l.length > 5) return cap(l)
    }

    // Python docstring
    if (ext === '.py') {
      const dm = content.match(/^(?:#[^\n]*\n)*\s*(?:"""(.+?)"""|'''(.+?)''')/s)
      if (dm) {
        const first = (dm[1] || dm[2]).split('\n')[0].trim()
        if (first && first.length > 3) return cap(first)
      }
    }

    // Rust doc comments
    if (ext === '.rs') {
      const lines = content.split('\n')
      for (const line of lines.slice(0, 20)) {
        const m = line.match(/^\s*(?:\/\/\/|\/\/!)\s*(.+)/)
        if (m && m[1].length > 5) return cap(m[1].trim())
      }
    }

    // Go package comment
    if (ext === '.go') {
      const m = content.match(/\/\/\s*Package\s+\w+\s+(.*)/)
      if (m) return cap(m[1].trim())
    }

    // TS/JS 鈥?exports summary
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
      const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
        .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean) as string[]
      if (exports.length > 0 && exports.length <= 4) return cap(`Exports ${exports.join(', ')}`)
      if (exports.length > 4) return cap(`Exports ${exports.slice(0, 3).join(', ')} + ${exports.length - 3} more`)
    }

    // Python 鈥?class + functions
    if (ext === '.py') {
      const cls = content.match(/class\s+(\w+)/)
      const funcs = (content.match(/def\s+(\w+)/g) || []).map(f => f.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith('_')) as string[]
      if (cls && funcs.length > 0) return cap(`${cls[1]}: ${funcs.slice(0, 4).join(', ')}`)
      if (funcs.length > 0) return cap(funcs.slice(0, 4).join(', '))
    }

    // Header comment fallback
    const hdrLines = content.split('\n')
    for (const line of hdrLines.slice(0, 10)) {
      const t = line.trim()
      if (!t || t.startsWith('#!') || t.startsWith('namespace') || t.startsWith('use ') || t.startsWith('import ') || t.startsWith('from ') || t.startsWith('require') || t.startsWith('module ')) continue
      const cm = t.match(/^(?:\/\/|#|--)\s*(.+)/)
      if (cm) {
        const text = cm[1].trim()
        const lower = text.toLowerCase()
        if (text.length > 5 && !lower.startsWith('copyright') && !lower.startsWith('license') && !lower.startsWith('@')) {
          return cap(text)
        }
      }
      if (!t.startsWith('//') && !t.startsWith('#') && !t.startsWith('/*') && !t.startsWith('*') && !t.startsWith('--')) break
    }

    // Last resort 鈥?first declaration
    const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/)
    if (declM) return `Declares ${declM[1]}`

    return ''
  }

  private walkDir(
    dir: string,
    rootDir: string,
    excludePatterns: string[],
    maxFiles: number,
    entries: Map<string, AnatomyEntry[]>,
    state: { fileCount: number },
  ): void {
    if (state.fileCount >= maxFiles) return

    let items: string[]
    try {
      items = readdirSync(dir)
    } catch {
      return
    }

    items.sort()

    for (const item of items) {
      const fullPath = join(dir, item)
      const relPath = relative(rootDir, fullPath).replace(/\\/g, '/')

      if (this.shouldExclude(relPath, item, excludePatterns)) continue

      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        this.walkDir(fullPath, rootDir, excludePatterns, maxFiles, entries, state)
        if (state.fileCount >= maxFiles) return
      } else if (stat.isFile()) {
        if (state.fileCount >= maxFiles) return
        const ext = extname(item).toLowerCase()
        if (BINARY_EXTENSIONS.has(ext)) continue
        if (stat.size > 1024 * 1024) continue // skip > 1MB

        let content: string
        try {
          content = readFileSync(fullPath, 'utf-8')
        } catch {
          continue
        }

        const desc = this.extractDescriptionFromContent(content, fullPath)
        const tokens = estimateTokens(content)
        const section = relative(rootDir, dir).replace(/\\/g, '/') || '.'
        const sectionKey = section === '.' ? './' : section + '/'

        if (!entries.has(sectionKey)) entries.set(sectionKey, [])
        entries.get(sectionKey)!.push({ file: item, description: desc, tokens })

        state.fileCount++
        if (state.fileCount >= maxFiles) return
      }
    }
  }

  private shouldExclude(relPath: string, name: string, excludePatterns: string[]): boolean {
    // Always exclude sensitive files
    if (ALWAYS_EXCLUDE_FILES.has(name)) return true
    if (name.startsWith('.env.')) return true

    const parts = relPath.split('/')
    for (const pattern of excludePatterns) {
      if (parts.includes(pattern)) return true
    }
    return false
  }
}
