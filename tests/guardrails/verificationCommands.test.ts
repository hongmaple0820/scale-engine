// Tests: 验证命令目录（#36）— .scale/verification.json 加载、命令匹配、建议文案
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  loadVerificationCommandCatalog,
  isVerificationCommand,
  verificationSuggestion,
  normalizeCommand,
} from '../../src/guardrails/verificationCommands.js'

const TMP = './tmp/test-verification-commands'

describe('verification command catalog (#36)', () => {
  const originalEnv = { projectDir: process.env.SCALE_PROJECT_DIR, scaleDir: process.env.SCALE_DIR }

  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
    process.env.SCALE_PROJECT_DIR = resolve(TMP)
    process.env.SCALE_DIR = '.scale'
  })

  afterEach(() => {
    if (originalEnv.projectDir === undefined) delete process.env.SCALE_PROJECT_DIR
    else process.env.SCALE_PROJECT_DIR = originalEnv.projectDir
    if (originalEnv.scaleDir === undefined) delete process.env.SCALE_DIR
    else process.env.SCALE_DIR = originalEnv.scaleDir
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  function writeMatrix(scaleDirName = '.scale'): void {
    mkdirSync(join(TMP, scaleDirName), { recursive: true })
    writeFileSync(join(TMP, scaleDirName, 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: {
          commands: {
            smoke: 'powershell -File tools/validate-patterns.ps1',
            lint: 'node scripts/workflow/lint.mjs',
          },
        },
      },
      services: [
        { name: 'assets', path: './assets', commands: { test: 'python -m pytest assets' } },
      ],
    }), 'utf-8')
  }

  it('falls back to keyword mode without verification.json', () => {
    const catalog = loadVerificationCommandCatalog()
    expect(catalog.source).toBe('keyword-fallback')
    expect(catalog.commands).toHaveLength(0)
    expect(isVerificationCommand('npm test', catalog)).toBe(true)
    expect(isVerificationCommand('powershell -File tools/validate-patterns.ps1', catalog)).toBe(false)
  })

  it('collects commands from profiles and services', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(catalog.source).toBe('verification-matrix')
    expect(catalog.commands).toContain('powershell -File tools/validate-patterns.ps1')
    expect(catalog.commands).toContain('node scripts/workflow/lint.mjs')
    expect(catalog.commands).toContain('python -m pytest assets')
  })

  it('matches a configured keyword-free command exactly (#36 repro)', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('powershell -File tools/validate-patterns.ps1', catalog)).toBe(true)
  })

  it('matches with an rtk prefix and trailing extra args', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('rtk powershell -File tools/validate-patterns.ps1 --report out.json', catalog)).toBe(true)
  })

  it('matches with backslash paths and extra flags', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('powershell -File tools\\validate-patterns.ps1 -Verbose', catalog)).toBe(true)
  })

  it('matches a script entry point with different flag values', () => {
    mkdirSync(join(TMP, '.scale'), { recursive: true })
    writeFileSync(join(TMP, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: { test: 'node scripts/workflow/run-vitest.mjs --timeout-ms 900000' } } },
    }), 'utf-8')
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('node scripts/workflow/run-vitest.mjs --timeout-ms 300000 tests/guardrails', catalog)).toBe(true)
  })

  it('does not accept a truncated prefix that never invokes the configured script', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('powershell -File', catalog)).toBe(false)
    expect(isVerificationCommand('powershell -File tools/validate-patterns', catalog)).toBe(false)
    expect(isVerificationCommand('node scripts/workflow/lint', catalog)).toBe(false)
  })

  it('does not accept configured command text embedded in an inert shell argument', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('echo "powershell -File tools/validate-patterns.ps1"', catalog)).toBe(false)
    expect(isVerificationCommand('printf \'%s\\n\' "powershell -File tools/validate-patterns.ps1"', catalog)).toBe(false)
    expect(isVerificationCommand('powershell -File tools/validate-patterns.ps1', catalog)).toBe(true)
    expect(isVerificationCommand('powershell -File tools/validate-patterns.ps1 --report out.json', catalog)).toBe(true)
  })

  it('does not treat unrelated commands as verification', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    expect(isVerificationCommand('npm install', catalog)).toBe(false)
    expect(isVerificationCommand('node scripts/build-assets.js', catalog)).toBe(false)
  })

  it('suggests configured commands instead of the pnpm triple (#36)', () => {
    writeMatrix()
    const catalog = loadVerificationCommandCatalog()
    const suggestion = verificationSuggestion(catalog)
    // 建议必须来自 verification.json 配置的命令（priority 选中的 lint，或 smoke 兜底）
    expect(
      suggestion.includes('node scripts/workflow/lint.mjs')
      || suggestion.includes('powershell -File tools/validate-patterns.ps1'),
    ).toBe(true)
    expect(suggestion).not.toContain('pnpm test')
  })

  it('keeps the pnpm triple as the last-resort suggestion', () => {
    expect(verificationSuggestion({ commands: [], suggestionCommands: [], source: 'keyword-fallback' }))
      .toBe('pnpm test && pnpm lint && pnpm build')
  })

  it('normalizes quoting, slashes, whitespace and rtk prefixes', () => {
    expect(normalizeCommand('  RTK  "npm"   Run\\Build  ')).toBe('npm run/build')
  })

  it('ignores a broken verification.json and falls back to keywords', () => {
    mkdirSync(join(TMP, '.scale'), { recursive: true })
    writeFileSync(join(TMP, '.scale', 'verification.json'), '{ not json', 'utf-8')
    const catalog = loadVerificationCommandCatalog()
    expect(catalog.source).toBe('keyword-fallback')
    expect(isVerificationCommand('npm test', catalog)).toBe(true)
  })

  it('tolerates a UTF-8 BOM written by PowerShell tooling', () => {
    mkdirSync(join(TMP, '.scale'), { recursive: true })
    writeFileSync(join(TMP, '.scale', 'verification.json'), '\uFEFF' + JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: { default: { commands: { smoke: 'powershell -File tools/validate-patterns.ps1' } } },
    }), 'utf-8')
    const catalog = loadVerificationCommandCatalog()
    expect(catalog.source).toBe('verification-matrix')
    expect(isVerificationCommand('powershell -File tools/validate-patterns.ps1', catalog)).toBe(true)
  })
})
