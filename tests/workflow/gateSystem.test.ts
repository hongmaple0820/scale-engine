import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { EventBus } from '../../src/core/eventBus.js'
import { BuildGate, CoverageGate, ExplorationGate, GateSystem, PlanningGate, ProductSmokeGate, SecurityGate, TDDGate, runShellCommand } from '../../src/workflow/gates/GateSystem.js'
import { WorkflowArtifactWriter } from '../../src/workflow/WorkflowArtifactWriter.js'

let dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

function nodePrintCommand(text: string): string {
  const codes = Array.from(text).map(char => char.charCodeAt(0)).join(',')
  return `node -e "process.stdout.write(String.fromCharCode(${codes}))"`
}

describe('runShellCommand', () => {
  it('runs a command through the platform shell', async () => {
    const result = await runShellCommand('node -e "process.stdout.write(String(40 + 2))"', 10_000)

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('42')
    expect(result.stderr).toBe('')
  })

  it('captures non-zero exits without throwing', async () => {
    const result = await runShellCommand('node -e "process.stderr.write(\\"bad\\"); process.exit(7)"', 10_000)

    expect(result.code).toBe(7)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('bad')
  })

  it('runs a command in the requested working directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-shell-cwd-'))
    dirs.push(dir)

    const result = await runShellCommand('node -e "process.stdout.write(process.cwd())"', 10_000, dir)

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(dir)
    expect(result.cwd).toBe(dir)
  })

  it('compresses verbose output and records optional command-run evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-shell-evidence-'))
    dirs.push(dir)
    const command = `node -e "for(let i=0;i<180;i++) console.log('noise '+i); console.log('Tests 1 passed')"`

    const result = await runShellCommand(command, 10_000, dir, {
      commandRunEvidence: {
        projectDir: dir,
        taskId: 'task-1',
        gate: 'G5',
      },
    })

    expect(result.code).toBe(0)
    expect(result.outputCompression?.savedEstimatedTokens).toBeGreaterThan(0)
    expect(result.commandRunEvidenceId).toMatch(/^CMD-/)
    const evidenceDir = join(dir, '.scale', 'evidence', 'command-runs', 'task-1')
    expect(readdirSync(evidenceDir)).toContain(`${result.commandRunEvidenceId}.json`)
  })
})

describe('BuildGate', () => {
  it('passes when the build command exits successfully', async () => {
    const gate = new BuildGate({
      command: 'node -v',
      source: 'override',
      reason: 'test build command',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidenceItems?.[0].command).toBe('node -v')
    expect(result.evidenceItems?.[0].cwd).toBe(process.cwd())
    expect(result.evidenceItems?.[0].startedAt).toBeTypeOf('number')
    expect(result.evidenceItems?.[0].endedAt).toBeTypeOf('number')
    expect(result.evidenceItems?.[0].outputHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fails when the build command exits non-zero', async () => {
    const gate = new BuildGate({
      command: 'node -e "process.exit(2)"',
      source: 'override',
      reason: 'test failing build command',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers[0]).toContain('Build failed')
  })
})

describe('TDDGate', () => {
  it('passes non-strict mode while marking TDD as not strictly verified', async () => {
    const gate = new TDDGate()

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidenceItems?.[0].detail).toContain('not strictly verified')
  })

  it('blocks strict mode without evidence', async () => {
    const gate = new TDDGate(undefined, true)

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('BLOCKED')
    expect(result.blockers[0]).toContain('TDD evidence file is required')
  })

  it('passes when evidence file contains the full TDD cycle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-tdd-'))
    dirs.push(dir)
    const evidencePath = join(dir, 'tdd.json')
    writeFileSync(evidencePath, JSON.stringify({
      red: true,
      green: true,
      refactor: true,
      testFirst: true,
      verifiedAt: Date.now(),
    }), 'utf-8')
    const gate = new TDDGate(evidencePath, true)

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidenceItems?.[0].path).toBe(evidencePath)
    expect(result.evidenceItems?.[0].outputHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('ExplorationGate', () => {
  it('uses current workflow state as the authoritative exploration contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-current-'))
    dirs.push(dir)
    const writer = new WorkflowArtifactWriter(dir)
    writer.writeCurrentState({
      schemaVersion: 1,
      taskId: 'task-001',
      level: 'M',
      phase: 'explore',
      exploredFiles: ['a.ts', 'b.ts', 'c.ts'],
      fileCount: 3,
      mainContradiction: 'gate and artifact contract mismatch',
      completedGates: [],
      openTasks: [],
      filesModified: [],
      updatedAt: '2026-05-14T00:00:00Z',
    })

    const gate = new ExplorationGate(writer)
    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.evidenceItems?.[0].path).toBe('.scale/state/current.json')
  })
})

describe('PlanningGate', () => {
  it('uses current workflow state to select the intended plan artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scale-plan-current-'))
    dirs.push(dir)
    const writer = new WorkflowArtifactWriter(dir)
    writer.writePlanResult({
      timestamp: '2026-05-14T00:00:00Z',
      planId: 'plan-valid',
      specId: 'spec-001',
      hasBoundaryAnalysis: true,
      hasExceptionHandling: true,
      hasRollbackStrategy: true,
      modules: [],
      consensusRounds: 1,
      verdict: 'APPROVE',
    })
    writer.writePlanResult({
      timestamp: '2026-05-14T00:00:01Z',
      planId: 'plan-invalid',
      specId: 'spec-001',
      hasBoundaryAnalysis: false,
      hasExceptionHandling: false,
      hasRollbackStrategy: false,
      modules: [],
      consensusRounds: 1,
      verdict: 'ITERATE',
    })
    writer.updateCurrentState({ lastPlanId: 'plan-valid' })

    const gate = new PlanningGate(writer)
    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.evidence).toContain('plan-valid')
  })
})

describe('CoverageGate', () => {
  it('passes when parsed coverage is at least 80', async () => {
    const gate = new CoverageGate({
      command: nodePrintCommand('All files | 100.00 | 100.00 | 100.00 | 100.00 | 85.50'),
      source: 'override',
      reason: 'test coverage command',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidence).toContain('Coverage: 85.5%')
  })

  it('parses Vitest v2 text coverage tables', async () => {
    const gate = new CoverageGate({
      command: nodePrintCommand([
        'File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s',
        '-------------------|---------|----------|---------|---------|-------------------',
        'All files          |   87.57 |    83.48 |      90 |   87.57 |',
        ' GateCatalog.ts    |   99.28 |    76.19 |     100 |   99.28 | 278-279',
      ].join('\n')),
      source: 'override',
      reason: 'test vitest coverage command',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.evidence).toContain('Coverage: 87.57%')
  })

  it('fails when parsed coverage is below 80', async () => {
    const gate = new CoverageGate({
      command: nodePrintCommand('All files | 100.00 | 100.00 | 100.00 | 100.00 | 79.99'),
      source: 'override',
      reason: 'test low coverage command',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers[0]).toContain('below 80% threshold')
  })

  it('fails when coverage output cannot be parsed', async () => {
    const gate = new CoverageGate({
      command: nodePrintCommand('tests passed without coverage table'),
      source: 'override',
      reason: 'test unparseable coverage command',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers).toContain('Coverage percentage could not be parsed')
  })
})

describe('ProductSmokeGate', () => {
  it('passes when the product smoke command exits successfully', async () => {
    const gate = new ProductSmokeGate({
      command: nodePrintCommand('copy task completed through gateway'),
      source: 'override',
      reason: 'test product smoke command',
    })

    const result = await gate.execute()

    expect(result.gate).toBe('G8')
    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidenceItems?.[0].label).toBe('Product smoke command')
  })

  it('records passed product smoke runtime evidence when configured', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-product-smoke-runtime-'))
    dirs.push(projectDir)
    const scaleDir = join(projectDir, '.scale')
    const gate = new ProductSmokeGate({
      command: nodePrintCommand('copy task completed through gateway'),
      source: 'override',
      reason: 'test product smoke command',
    }, {
      projectDir,
      scaleDir,
      taskId: 'TASK-SMOKE',
      sessionId: 'SESSION-SMOKE',
      profile: 'productSmoke',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    const evidenceDir = join(scaleDir, 'evidence', 'runtime')
    expect(existsSync(evidenceDir)).toBe(true)
    const records = readdirSync(evidenceDir).filter(file => file.endsWith('.json'))
    expect(records.length).toBe(1)
    const record = JSON.parse(readFileSync(join(evidenceDir, records[0]), 'utf-8'))
    expect(record).toMatchObject({
      taskId: 'TASK-SMOKE',
      sessionId: 'SESSION-SMOKE',
      kind: 'command',
      status: 'passed',
      metadata: {
        productSmoke: true,
        realProductPath: true,
        gate: 'G8',
        profile: 'productSmoke',
      },
    })
  })

  it('does not pass or record runtime evidence when the smoke report is skipped', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-product-smoke-skipped-'))
    dirs.push(projectDir)
    const scaleDir = join(projectDir, '.scale')
    const report = JSON.stringify({
      version: 1,
      status: 'skipped',
      message: 'No enabled product smoke probes',
      results: [],
    })
    const gate = new ProductSmokeGate({
      command: nodePrintCommand(report),
      source: 'override',
      reason: 'test skipped product smoke command',
    }, {
      projectDir,
      scaleDir,
      profile: 'productSmoke',
    })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers).toContain('Product smoke did not run real probes: No enabled product smoke probes')
    expect(existsSync(join(scaleDir, 'evidence', 'runtime'))).toBe(false)
  })

  it('fails when the product smoke command exits non-zero', async () => {
    const gate = new ProductSmokeGate({
      command: 'node -e "process.stderr.write(\\"route mismatch\\"); process.exit(2)"',
      source: 'override',
      reason: 'test failing product smoke command',
    })

    const result = await gate.execute()

    expect(result.gate).toBe('G8')
    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers[0]).toContain('Product smoke failed')
    expect(result.evidenceItems?.[0].exitCode).toBe(2)
  })
})

describe('SecurityGate', () => {
  function createSecurityFixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'scale-security-'))
    dirs.push(dir)
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(dir, relativePath)
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, content, 'utf-8')
    }
    return dir
  }

  it('passes when source files contain no built-in security findings', async () => {
    const rootDir = createSecurityFixture({
      'src/index.ts': 'export const value = process.env.SAFE_VALUE ?? "fallback"\n',
    })
    const gate = new SecurityGate({ rootDir })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.status).toBe('PASSED')
    expect(result.evidenceItems?.[0].detail).toContain('no built-in security findings')
  })

  it('blocks hardcoded secrets with file and line evidence', async () => {
    const rootDir = createSecurityFixture({
      'src/config.ts': 'export const apiKey = "abc123456789"\n',
    })
    const gate = new SecurityGate({ rootDir })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers[0]).toContain('secret.assignment')
    expect(result.blockers[0]).toContain('src/config.ts:1')
    expect(result.evidenceItems?.some(item => item.detail.includes('CRITICAL line 1'))).toBe(true)
  })

  it('records high-risk findings without blocking in compatibility mode', async () => {
    const rootDir = createSecurityFixture({
      'src/run.ts': [
        'try {',
        '  runUserInput()',
        '} catch (error) {',
        '}',
        'await execa(command, { shell: true })',
        'document.body.innerHTML = userHtml',
      ].join('\n'),
    })
    const gate = new SecurityGate({ rootDir })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.evidenceItems?.some(item => item.detail.includes('HIGH line'))).toBe(true)
    expect(result.evidence).toContain('high=')
  })

  it('blocks high-risk findings in strict mode', async () => {
    const rootDir = createSecurityFixture({
      'src/run.ts': 'try { risky() } catch (error) {}\n',
    })
    const gate = new SecurityGate({ rootDir, strict: true })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('logic.empty-catch'),
    ]))
  })

  it('does not treat test fixtures as real security findings', async () => {
    const rootDir = createSecurityFixture({
      'tests/security.test.ts': 'const text = \'+const apiKey = "abc123456789"\\n\'\n',
      'src/index.ts': 'export const ok = true\n',
    })
    const gate = new SecurityGate({ rootDir, scanDirs: ['src', 'tests'] })

    const result = await gate.execute()

    expect(result.passed).toBe(true)
  })

  it('runs dependency audit as a G7 dependency sub-gate', async () => {
    const rootDir = createSecurityFixture({
      'src/index.ts': 'export const ok = true\n',
      'package.json': JSON.stringify({ dependencies: { 'risky-pkg': '^1.0.0' } }, null, 2),
      'package-lock.json': JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { 'risky-pkg': '^1.0.0' } },
          'node_modules/risky-pkg': {
            version: '1.0.0',
            main: 'index.js',
          },
        },
      }, null, 2),
      'node_modules/risky-pkg/index.js': 'module.exports = eval("process.env.SECRET")\n',
    })
    const gate = new SecurityGate({ rootDir })

    const result = await gate.execute()

    expect(result.passed).toBe(false)
    expect(result.status).toBe('FAILED')
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('dependency.eval'),
    ]))
    expect(result.evidenceItems?.some(item => item.label === 'G7 dependency audit')).toBe(true)
  })

  it('runs G7 against the configured verification target cwd', async () => {
    const targetDir = createSecurityFixture({
      'src/index.ts': 'const apiKey = "abc123456789"\n',
    })
    const eventsDir = mkdtempSync(join(tmpdir(), 'scale-g7-events-'))
    dirs.push(eventsDir)
    const gateSystem = new GateSystem(new EventBus({ eventsDir }), { cwd: targetDir })

    const result = await gateSystem.executeGate('G7')

    expect(result.passed).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('secret.assignment in src/index.ts'),
    ]))
  })
})
