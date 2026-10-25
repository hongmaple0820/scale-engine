// scale uninstall — the AGENTS.md SCALE-section strip is the delicate part
// (it edits a file the project owns); manifest-driven actions are covered by
// the live dry-run in session verification.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { stripScaleSection } from '../../src/cli/uninstallCommands.js'

const root = mkdtempSync(join(tmpdir(), 'scale-uninstall-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const BEGIN = '<!-- SCALE:BEGIN -->'
const END = '<!-- SCALE:END -->'

describe('stripScaleSection', () => {
  it('removes the marked section and keeps the project content intact', () => {
    const before = `# My project\n\nOwn content.\n\n${BEGIN}\n## SCALE workflow\ngovernance body\n${END}\n\nMore own content.\n`
    const { text, removed } = stripScaleSection(before)
    expect(removed).toBe(true)
    expect(text).toContain('# My project')
    expect(text).toContain('Own content.')
    expect(text).toContain('More own content.')
    expect(text).not.toContain('SCALE:BEGIN')
    expect(text).not.toContain('SCALE:END')
    expect(text).not.toContain('governance body')
  })

  it('is a no-op without markers (foreign file untouched)', () => {
    const before = '# Just a readme\nnothing scale-related\n'
    const { text, removed } = stripScaleSection(before)
    expect(removed).toBe(false)
    expect(text).toBe(before)
  })

  it('handles a BEGIN without END by truncating the tail (corrupt marker)', () => {
    const before = `# P\n\nown\n\n${BEGIN}\norphaned section\n`
    const { text, removed } = stripScaleSection(before)
    expect(removed).toBe(true)
    expect(text).toContain('# P')
    expect(text).toContain('own')
    expect(text).not.toContain('orphaned section')
  })
})
