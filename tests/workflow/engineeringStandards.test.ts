import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  baselineEngineeringStandards,
  doctorEngineeringStandards,
  engineeringStandardsBaselinePath,
  engineeringStandardsPolicyPath,
  engineeringStandardsPolicyTemplate,
  frameworksCatalogPath,
  scanEngineeringStandards,
  settleEngineeringStandards,
} from '../../src/workflow/EngineeringStandards.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scale-standards-'))
  dirs.push(dir)
  return dir
}

function write(projectDir: string, relativePath: string, content: string): void {
  const target = join(projectDir, ...relativePath.split('/'))
  mkdirSync(target.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

describe('EngineeringStandards', () => {
  it('resolves absolute scale directories without nesting them under the project path', () => {
    const projectDir = makeProject()
    const scaleDir = makeProject()

    expect(engineeringStandardsPolicyPath(projectDir, scaleDir)).toBe(join(scaleDir, 'engineering-standards.json'))
    expect(engineeringStandardsBaselinePath(projectDir, scaleDir)).toBe(join(scaleDir, 'engineering-standards-baseline.json'))
    expect(frameworksCatalogPath(projectDir, scaleDir)).toBe(join(scaleDir, 'frameworks.json'))
  })

  it('flags sensitive logs, raw SQL construction, unsafe UI sinks, and empty catch blocks', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/business/upload.ts', `
export async function upload(req: { body: { token: string; id: string } }, db: { query: (sql: string) => Promise<void> }) {
  console.log('upload token', req.body.token)
  await db.query('SELECT * FROM files WHERE id = ' + req.body.id)
  try {
    return document.body.innerHTML = req.body.token
  } catch (error) {
  }
}
`)
    write(projectDir, 'src/cli/report.ts', `
export function printReport(summary: string) {
  console.log(summary)
}
`)

    const report = scanEngineeringStandards({ projectDir })

    expect(report.summary.totalFindings).toBeGreaterThanOrEqual(4)
    expect(report.summary.blockingFindings).toBeGreaterThanOrEqual(3)
    expect(report.findings.map(finding => finding.ruleId)).toEqual(expect.arrayContaining([
      'sensitive-log',
      'raw-sql-construction',
      'unsafe-html-sink',
      'empty-catch',
    ]))
    expect(report.findings.some(finding => finding.path === 'src/cli/report.ts' && finding.ruleId === 'ad-hoc-console-log')).toBe(false)
  })

  it('keeps standards doctor non-ok when blocking findings exist', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/service/auth.ts', `
export function login(password: string) {
  logger.info('password=' + password)
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'fail', ruleId: 'sensitive-log' }),
    ]))
  })

  it('flags ad-hoc output and sensitive output in non-TypeScript services', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'internal/service/auth.go', `
package service

import "fmt"

func Login(token string) {
  fmt.Println("debug login")
  fmt.Println("token", token)
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warn',
        ruleId: 'ad-hoc-console-log',
        path: 'internal/service/auth.go',
        line: 7,
      }),
      expect.objectContaining({
        severity: 'fail',
        ruleId: 'sensitive-log',
        path: 'internal/service/auth.go',
        line: 8,
      }),
    ]))
  })

  it('does not flag console calls embedded in generated script strings', () => {
    const projectDir = makeProject()
    write(projectDir, 'src/hooks/generator.ts', `
export function generatedHook(): string {
  return String.raw\`
const input = JSON.parse(process.argv[2] || "{}")
if (!input.file_path) { console.log("[PASS]"); process.exit(0) }
console.error("[HOOK] generated runtime message")
\`
}

export const smoke = {
  command: 'node -e "console.log(\\'scale-eval-ok\\')"',
}

export const detector = /\\bconsole\\.(?:log|error)\\s*\\(/
`)

    const report = scanEngineeringStandards({ projectDir })

    expect(report.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/hooks/generator.ts', ruleId: 'ad-hoc-console-log' }),
    ]))
  })

  it('blocks hardcoded secret-like assignments', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/service/payment.ts', `
export function getPaymentConfig() {
  const apiToken = "sk_live_1234567890abcdef"
  return { apiToken }
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'fail',
        category: 'security',
        ruleId: 'hardcoded-secret',
        path: 'src/service/payment.ts',
        line: 3,
      }),
    ]))
  })

  it('does not flag regex literals that describe output calls', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/rules/outputMatcher.ts', String.raw`
export function matchesOutputCall(line: string): boolean {
  return /\bconsole\.(?:log|debug|info|warn|error)\s*\(|\bfmt\.Print(?:f|ln)?\s*\(|\bprint(?:ln)?\s*\(|\bSystem\.out\.print(?:ln)?\s*\(/.test(line)
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.findings.some(finding => finding.ruleId === 'ad-hoc-console-log')).toBe(false)
  })

  it('allows explicit baseline findings while keeping new violations visible', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({
      version: 1,
      baselineFindings: [
        { ruleId: 'empty-catch', path: 'src/legacy/old.ts', reason: 'legacy debt tracked separately' },
      ],
    }, null, 2))
    write(projectDir, 'src/legacy/old.ts', 'try { work() } catch (error) {}\n')
    write(projectDir, 'src/legacy/new.ts', 'try { work() } catch (error) {}\n')

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/legacy/old.ts' && finding.ruleId === 'empty-catch')).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/legacy/new.ts' && finding.ruleId === 'empty-catch')).toBe(true)
  })

  it('supports line-specific baselines without hiding new violations in the same file', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({
      version: 1,
      baselineFindings: [
        { ruleId: 'empty-catch', path: 'src/legacy/old.ts', line: 1, reason: 'legacy debt tracked separately' },
      ],
    }, null, 2))
    write(projectDir, 'src/legacy/old.ts', [
      'try { oldWork() } catch (error) {}',
      'try { newWork() } catch (error) {}',
      '',
    ].join('\n'))

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/legacy/old.ts' && finding.ruleId === 'empty-catch' && finding.line === 1)).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/legacy/old.ts' && finding.ruleId === 'empty-catch' && finding.line === 2)).toBe(true)
  })

  it('loads external baseline findings from .scale/engineering-standards-baseline.json', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({ version: 1 }, null, 2))
    write(projectDir, '.scale/engineering-standards-baseline.json', JSON.stringify({
      version: 1,
      findings: [
        { ruleId: 'empty-catch', path: 'src/legacy/old.ts', reason: 'legacy debt tracked separately' },
      ],
    }, null, 2))
    write(projectDir, 'src/legacy/old.ts', 'try { oldWork() } catch (error) {}\n')
    write(projectDir, 'src/legacy/new.ts', 'try { newWork() } catch (error) {}\n')

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/legacy/old.ts' && finding.ruleId === 'empty-catch')).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/legacy/new.ts' && finding.ruleId === 'empty-catch')).toBe(true)
  })

  it('can scan only changed files so legacy untouched findings do not block a focused task', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({ version: 1 }, null, 2))
    write(projectDir, 'src/legacy/old.ts', 'try { oldWork() } catch (error) {}\n')
    write(projectDir, 'src/feature/new.ts', 'try { newWork() } catch (error) {}\n')

    const report = doctorEngineeringStandards({
      projectDir,
      changedFiles: ['src/feature/new.ts'],
    })

    expect(report.ok).toBe(false)
    expect(report.scan.summary.filesScanned).toBe(1)
    expect(report.findings.some(finding => finding.path === 'src/legacy/old.ts')).toBe(false)
    expect(report.findings.some(finding => finding.path === 'src/feature/new.ts' && finding.ruleId === 'empty-catch')).toBe(true)
  })

  it('generates a baseline file and legacy debt classification report from current full-scan findings', () => {
    const projectDir = makeProject()
    const artifactDir = 'docs/worklog/tasks/2026-05-15-standards-baseline'
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({ version: 1 }, null, 2))
    write(projectDir, 'src/legacy/auth.ts', `
export function login(token: string, db: { query: (sql: string) => Promise<void> }) {
  console.log('token', token)
  return db.query('SELECT * FROM users WHERE token = ' + token)
}
`)
    write(projectDir, 'src/legacy/cleanup.ts', 'try { cleanup() } catch (error) {}\n')
    write(projectDir, 'src/legacy/auth.test.ts', `
export function testLogin(token: string) {
  console.log('token', token)
}
`)

    const report = baselineEngineeringStandards({
      projectDir,
      writeBaseline: true,
      artifactsDir: artifactDir,
      taskId: 'TASK-BASELINE',
      reason: 'legacy rollout baseline',
    })

    expect(report.wroteBaseline).toBe(true)
    expect(report.baselineEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'sensitive-log', path: 'src/legacy/auth.ts', line: 3 }),
      expect.objectContaining({ ruleId: 'raw-sql-construction', path: 'src/legacy/auth.ts', line: 4 }),
      expect.objectContaining({ ruleId: 'empty-catch', path: 'src/legacy/cleanup.ts', line: 1 }),
    ]))
    expect(report.debt.byCategory.logging.total).toBeGreaterThanOrEqual(1)
    expect(report.debt.byScope.production.total).toBeGreaterThanOrEqual(1)
    expect(report.debt.byScope.test.total).toBeGreaterThanOrEqual(1)
    expect(report.debt.byRule['sensitive-log'].total).toBeGreaterThanOrEqual(1)
    expect(report.legacyDebtPath).toBe(join(projectDir, 'docs', 'worklog', 'tasks', '2026-05-15-standards-baseline', 'standards-legacy-debt.md'))
    expect(readFileSync(report.legacyDebtPath!, 'utf-8')).toContain('SCALE Engineering Standards Legacy Debt Classification')
    const baseline = JSON.parse(readFileSync(join(projectDir, '.scale', 'engineering-standards-baseline.json'), 'utf-8')) as {
      version: number
      findings: Array<{ ruleId: string; path: string; line?: number; reason: string }>
    }
    expect(baseline.version).toBe(1)
    expect(baseline.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'sensitive-log', path: 'src/legacy/auth.ts', line: 3, reason: 'legacy rollout baseline' }),
    ]))

    expect(doctorEngineeringStandards({ projectDir }).ok).toBe(true)
  })

  it('supports evidence-pattern exceptions without hiding other findings in the same file', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({
      version: 1,
      allowedFindingPatterns: [
        {
          ruleId: 'ad-hoc-console-log',
          path: 'src/capabilities/InstalledSkillsIntegration.ts',
          evidencePattern: 'python3 -c .*print\\(',
          reason: 'The embedded command probes the local Python runtime.',
        },
      ],
    }, null, 2))
    write(projectDir, 'src/capabilities/InstalledSkillsIntegration.ts', `
export const probe = "python3 -c \\"print('ready')\\""
export function debug(value: string) {
  console.log('debug value', value)
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(true)
    expect(report.findings.some(finding =>
      finding.ruleId === 'ad-hoc-console-log' &&
      finding.evidence?.includes('python3 -c'),
    )).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warn',
        ruleId: 'ad-hoc-console-log',
        path: 'src/capabilities/InstalledSkillsIntegration.ts',
        line: 4,
      }),
    ]))
  })

  it('can promote configured warning rules into blocking findings', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', JSON.stringify({
      version: 1,
      blockingRules: ['ad-hoc-console-log'],
    }, null, 2))
    write(projectDir, 'src/business/debug.ts', `
export function debug(value: string) {
  console.log('debug value', value)
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.scan.summary.blockingFindings).toBe(1)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'fail',
        ruleId: 'ad-hoc-console-log',
        path: 'src/business/debug.ts',
      }),
    ]))
  })

  it('flags framework catalog banned imports', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/frameworks.json', JSON.stringify({
      version: 1,
      bannedImports: [
        {
          source: '@legacy/orm',
          replacement: '@/infrastructure/db',
          reason: 'Use the project repository boundary instead of the legacy ORM client.',
        },
      ],
    }, null, 2))
    write(projectDir, 'src/service/user.ts', `
import { db } from '@legacy/orm'

export function loadUser(id: string) {
  return db.user.find(id)
}
`)

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(false)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'fail',
        category: 'framework',
        ruleId: 'banned-import',
        path: 'src/service/user.ts',
        line: 2,
      }),
    ]))
  })

  it('reports malformed framework catalog against the framework source file', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, '.scale/frameworks.json', '{ bad json')
    write(projectDir, 'src/domain/user.ts', 'export const user = true\n')

    const report = doctorEngineeringStandards({ projectDir })

    expect(report.ok).toBe(true)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warn',
        ruleId: 'frameworks-catalog-warning',
        path: join(projectDir, '.scale', 'frameworks.json'),
      }),
    ]))
  })

  it('warns when framework catalog review is stale', () => {
    const projectDir = makeProject()
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, '.scale/frameworks.json', JSON.stringify({
      version: 1,
      lastReviewedAt: '2026-01-01',
      reviewIntervalDays: 30,
      bannedImports: [],
    }, null, 2))
    write(projectDir, 'src/domain/user.ts', 'export const user = true\n')

    const report = doctorEngineeringStandards({
      projectDir,
      now: new Date('2026-05-15T00:00:00Z'),
    })

    expect(report.ok).toBe(true)
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warn',
        ruleId: 'frameworks-catalog-stale',
        path: join(projectDir, '.scale', 'frameworks.json'),
      }),
    ]))
  })

  it('writes task standards settlement evidence', () => {
    const projectDir = makeProject()
    const artifactDir = 'docs/worklog/tasks/2026-05-15-standards'
    write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
    write(projectDir, 'src/domain/user.ts', 'export const user = true\n')

    const report = settleEngineeringStandards({
      projectDir,
      taskId: 'TASK-STANDARDS',
      artifactsDir: artifactDir,
    })

    expect(report.ok).toBe(true)
    expect(report.standardsImpactPath).toBe(join(projectDir, 'docs', 'worklog', 'tasks', '2026-05-15-standards', 'standards-impact.md'))
    expect(existsSync(report.standardsImpactPath!)).toBe(true)
    expect(readFileSync(report.standardsImpactPath!, 'utf-8')).toContain('SCALE Engineering Standards Settlement')
  })

  describe('AST confirmation (P1.1) suppresses regex false positives', () => {
    it('does not flag eval / new Function that only appear in strings or comments', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/safe.ts', [
        'export function describe(): string {',
        "  const note = 'never call eval(userInput) here'",
        '  // new Function(body) would be unsafe, so we avoid it',
        '  return note',
        '}',
        '',
      ].join('\n'))

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'unsafe-code-execution')).toBe(false)
    })

    it('still flags a real eval call', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/danger.ts', 'export const run = (code: string) => eval(code)\n')

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'unsafe-code-execution')).toBe(true)
    })

    it('does not flag @ts-ignore text living inside a string literal', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/message.ts', [
        'export const help = [',
        "  '// @ts-ignore is discouraged in this codebase',",
        '].join("\\n")',
        '',
      ].join('\n'))

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'ts-ignore')).toBe(false)
    })

    it('does not flag the literal token ": any" inside a string', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/label.ts', "export const label = 'kind: any of the above'\n")

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'type-escape')).toBe(false)
    })

    it('still flags a real any-typed annotation', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/loose.ts', 'export function take(value: any): void { void value }\n')

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'type-escape')).toBe(true)
    })

    it('does not flag an empty catch block that only appears inside a string literal', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/snippet.ts', "export const example = 'try { work() } catch (error) {}'\n")

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'empty-catch')).toBe(false)
    })

    it('still flags a genuinely empty catch block', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      write(projectDir, 'src/domain/swallow.ts', 'export function run(work: () => void): void { try { work() } catch (error) {} }\n')

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'empty-catch')).toBe(true)
    })

    it('falls back to the regex result when the file cannot be parsed', () => {
      const projectDir = makeProject()
      write(projectDir, '.scale/engineering-standards.json', engineeringStandardsPolicyTemplate())
      // Deliberately unparseable TS — AST layer returns null, so the regex
      // pre-filter result must still surface (fail open, no lost coverage).
      write(projectDir, 'src/domain/broken.ts', 'export function bad( { try { work() } catch (error) {}\n')

      const report = scanEngineeringStandards({ projectDir })

      expect(report.findings.some(f => f.ruleId === 'empty-catch')).toBe(true)
    })
  })
})
