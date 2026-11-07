import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runGoldenSuite, type GoldenSuite } from '../../src/eval/GoldenEval.js'

let dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-golden-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function suite(cases: GoldenSuite['cases']): GoldenSuite {
  return { version: 1, id: 'test', name: 'Test Suite', cases }
}

describe('runGoldenSuite (P1-D)', () => {
  it('passes file-exists / json-field / text-contains / markdown-section / regex', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'pkg.json'), JSON.stringify({ type: 'module', bin: { scale: 'dist/cli.js' }, n: 3 }))
    writeFileSync(join(dir, 'doc.md'), '# Guide\n\nContains scale install here.\n')
    writeFileSync(join(dir, 'code.ts'), 'export const x = 42\n')

    const report = runGoldenSuite(suite([
      {
        id: 'c1',
        description: 'manifest',
        assertions: [
          { type: 'file-exists', path: 'pkg.json' },
          { type: 'json-field', path: 'pkg.json', field: 'type', equals: 'module' },
          { type: 'json-field', path: 'pkg.json', field: 'bin.scale', fieldType: 'string' },
          { type: 'json-field', path: 'pkg.json', field: 'n', fieldType: 'number' },
        ],
      },
      {
        id: 'c2',
        description: 'docs and code',
        assertions: [
          { type: 'markdown-section', path: 'doc.md', contains: 'Guide' },
          { type: 'text-contains', path: 'doc.md', contains: 'scale install' },
          { type: 'regex', path: 'code.ts', pattern: 'export const' },
        ],
      },
    ]), dir)

    expect(report.ok).toBe(true)
    expect(report.failedAssertions).toBe(0)
    expect(report.totalAssertions).toBe(7)
  })

  it('fails missing file and wrong json value', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'pkg.json'), JSON.stringify({ type: 'commonjs' }))

    const report = runGoldenSuite(suite([
      {
        id: 'bad',
        description: 'should fail',
        assertions: [
          { type: 'file-exists', path: 'missing.json' },
          { type: 'json-field', path: 'pkg.json', field: 'type', equals: 'module' },
          { type: 'json-field', path: 'pkg.json', field: 'nope', fieldType: 'string' },
        ],
      },
    ]), dir)

    expect(report.ok).toBe(false)
    expect(report.failedAssertions).toBe(3)
    expect(report.cases[0].passed).toBe(false)
  })

  it('fails on invalid JSON target', () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    const report = runGoldenSuite(suite([
      { id: 'c', description: 'bad json', assertions: [{ type: 'json-field', path: 'broken.json', field: 'a', fieldType: 'string' }] },
    ]), dir)
    expect(report.ok).toBe(false)
    expect(report.cases[0].assertions[0].detail).toContain('invalid JSON')
  })

  it('an empty suite is vacuously ok', () => {
    const report = runGoldenSuite(suite([]), makeDir())
    expect(report.ok).toBe(true)
    expect(report.totalAssertions).toBe(0)
  })
})
