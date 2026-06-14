// W10 Tests: Doctor + Health Check
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Doctor } from '../../src/api/doctor.js'
import { ClaudeCodeAdapter } from '../../src/adapters/ClaudeCodeAdapter.js'
import { writeGovernanceTemplates } from '../../src/workflow/GovernanceTemplates.js'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { execSync } from 'node:child_process'

const TMP = './tmp/test-doctor'

describe('Doctor', () => {
  beforeEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('reports broken on empty project', async () => {
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    expect(report.overall).toBe('broken')
    expect(report.checks.some((c) => c.status === 'fail')).toBe(true)
    expect(report.checks.find((c) => c.name === '.scale directory')?.status).toBe('fail')
  })

  it('reports healthy after scale init', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    expect(report.overall).toBe('healthy')
    // Core checks should all be ok (optional checks like Python/Graphify may be warn)
    expect(report.checks.filter((c) => !c.optional).every((c) => c.status === 'ok')).toBe(true)
    expect(report.checks.find((c) => c.name === 'CodeGraph CLI')).toMatchObject({
      optional: true,
      category: 'knowledge-graph',
    })
    expect(report.checks.find((c) => c.name === 'CodeGraph project index')).toMatchObject({
      optional: true,
      category: 'knowledge-graph',
    })
  })

  it('warns on missing hooks in settings.json', async () => {
    mkdirSync(join(TMP, '.scale', 'events'), { recursive: true })
    mkdirSync(join(TMP, '.scale', 'artifacts'), { recursive: true })
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    writeFileSync(join(TMP, '.claude', 'settings.json'), '{}', 'utf-8')
    writeFileSync(join(TMP, 'CLAUDE.md'), '# Test', 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck?.status).toBe('warn')
    expect(settingsCheck?.message).toContain('no SCALE hooks')
  })

  it('treats repository workflow shell hooks as SCALE hooks', async () => {
    mkdirSync(join(TMP, '.scale', 'events'), { recursive: true })
    mkdirSync(join(TMP, '.scale', 'artifacts'), { recursive: true })
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    writeFileSync(join(TMP, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: '', command: 'bash .claude/hooks/session-start-reminder.sh', timeout: 3000, description: 'Show concise scale-engine workflow entry points.' },
        ],
        PreToolUse: [
          { matcher: 'Write|Edit|MultiEdit', command: 'bash scripts/hooks/check-dangerous-file.sh', timeout: 3000, description: 'Block edits to secrets, runtime databases, and generated dependency output.' },
        ],
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(TMP, 'CLAUDE.md'), '# Test', 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('hooks configured'),
    })
  })

  it('treats nested qoder-style hook commands as SCALE hooks', async () => {
    mkdirSync(join(TMP, '.scale', 'events'), { recursive: true })
    mkdirSync(join(TMP, '.scale', 'artifacts'), { recursive: true })
    mkdirSync(join(TMP, '.qoder'), { recursive: true })
    mkdirSync(join(TMP, '.qoder', 'rules'), { recursive: true })
    writeFileSync(join(TMP, '.qoder', 'settings.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            command: '',
            hooks: [{ matcher: '', type: 'command', command: 'scale gate pre-tool Bash --args-json "$ARGS" --session-id "$SESSION_ID"' }],
          },
        ],
      },
    }, null, 2), 'utf-8')
    writeFileSync(join(TMP, '.qoder', 'rules', 'SCALE.md'), '# Test', 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('qoder'),
    })
  })

  it('warns on large knowledge doc', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    // Overwrite CLAUDE.md with 250 lines
    const bigContent = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`).join('\n')
    writeFileSync(join(TMP, 'CLAUDE.md'), bigContent, 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const kdCheck = report.checks.find((c) => c.name === 'Knowledge doc')
    expect(kdCheck?.status).toBe('warn')
    expect(kdCheck?.message).toContain('>200')
  })

  it('checks Node.js version', async () => {
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const nodeCheck = report.checks.find((c) => c.name === 'Node.js version')
    expect(nodeCheck?.status).toBe('ok')
    expect(nodeCheck?.message).toMatch(/^v\d+/)
  })

  it('formatReport produces readable output', async () => {
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const formatted = doc.formatReport(report)
    expect(formatted).toContain('SCALE Engine Health')
    expect(formatted).toContain('passed')
  })

  it('detect .gitignore presence', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const giCheck = report.checks.find((c) => c.name === '.scale/.gitignore')
    expect(giCheck?.status).toBe('ok')
  })

  it('reports generated governance templates and verification matrix', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    writeGovernanceTemplates(TMP, { mode: 'standard', projectName: 'Doctor Test' })

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()

    expect(report.checks.find((c) => c.name === 'Governance templates')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(report.checks.find((c) => c.name === 'Verification matrix')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(report.checks.find((c) => c.name === 'Skill routing policy')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(report.checks.find((c) => c.name === 'Tool policy')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(report.checks.find((c) => c.name === 'Resource policy')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(report.checks.find((c) => c.name === 'Engineering standards')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(report.checks.find((c) => c.name === 'Governance drift')).toMatchObject({
      status: 'ok',
      optional: true,
      category: 'governance',
    })
    expect(doc.formatReport(report)).toContain('Project Governance (Optional)')
  })

  it('reports runtime evidence as an optional doctor section', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()

    expect(report.checks.find((c) => c.name === 'Runtime evidence')).toMatchObject({
      optional: true,
      category: 'runtime',
    })
    expect(doc.formatReport(report)).toContain('Runtime Evidence (Optional)')
  })

  it('warns when generated governance files drift', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    writeGovernanceTemplates(TMP, { mode: 'standard', projectName: 'Doctor Test' })
    writeFileSync(join(TMP, 'docs', 'workflow', 'README.md'), '# Changed\n', 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()

    expect(report.checks.find((c) => c.name === 'Governance drift')).toMatchObject({
      status: 'warn',
      optional: true,
      category: 'governance',
    })
  })

  it('fails when the git workspace has unresolved merge conflicts', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    writeGovernanceTemplates(TMP, { mode: 'standard', projectName: 'Doctor Test' })
    await execa('git', ['init'], { cwd: TMP })
    await execa('git', ['config', 'user.email', 'scale-test@example.com'], { cwd: TMP })
    await execa('git', ['config', 'user.name', 'SCALE Test'], { cwd: TMP })
    writeFileSync(join(TMP, 'conflict.txt'), 'base\n', 'utf-8')
    await execa('git', ['add', 'conflict.txt'], { cwd: TMP })
    await execa('git', ['commit', '-m', 'base'], { cwd: TMP })
    await execa('git', ['checkout', '-b', 'left'], { cwd: TMP })
    writeFileSync(join(TMP, 'conflict.txt'), 'left\n', 'utf-8')
    await execa('git', ['commit', '-am', 'left'], { cwd: TMP })
    await execa('git', ['checkout', '-b', 'right', 'HEAD~1'], { cwd: TMP })
    writeFileSync(join(TMP, 'conflict.txt'), 'right\n', 'utf-8')
    await execa('git', ['commit', '-am', 'right'], { cwd: TMP })
    await execa('git', ['merge', 'left'], { cwd: TMP, reject: false })

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()

    expect(report.overall).toBe('broken')
    expect(report.checks.find((c) => c.name === 'Git workspace')).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('conflict.txt'),
    })
    expect(report.checks.find((c) => c.name === 'Engineering standards')).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('Skipped because the git workspace has unresolved conflicts'),
    })
  }, 120_000)

  it('rules and hooks check on fresh install', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    expect(report.checks.find((c) => c.name === 'Rules directory')?.status).toBe('ok')
    expect(report.checks.find((c) => c.name === 'Hooks directory')?.status).toBe('ok')
  })

  it('disk usage check works', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const diskCheck = report.checks.find((c) => c.name === 'Disk usage')
    expect(diskCheck?.status).toBe('ok')
    expect(diskCheck?.message).toContain('MB')
  })

  it('invalid settings.json detected', async () => {
    mkdirSync(join(TMP, '.scale', 'events'), { recursive: true })
    mkdirSync(join(TMP, '.scale', 'artifacts'), { recursive: true })
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    writeFileSync(join(TMP, '.claude', 'settings.json'), '{bad json', 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const settingsCheck = report.checks.find((c) => c.name === 'Agent settings')
    expect(settingsCheck?.status).toBe('fail')
    expect(settingsCheck?.message).toContain('invalid JSON')
  })

  it('uses profile-aware bootstrap fixes for missing knowledge and memory dependencies', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    writeFileSync(join(TMP, '.scale', 'config.yaml'), 'profile: advanced\n', 'utf-8')

    const doc = new Doctor(TMP, '.scale', {
      execSyncImpl: (() => 'Python 3.11.7') as unknown as typeof execSync,
      inspectToolCapabilitiesImpl: () => ({
        ok: false,
        summary: { total: 3, installed: 0, missing: 3 },
        tools: [
          { id: 'graphify', name: 'Graphify', category: 'cli', command: 'graphify', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:graphify'], installed: false, status: 'missing', missingReason: 'command not found: graphify' },
          { id: 'codegraph', name: 'CodeGraph', category: 'cli', command: 'codegraph', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:codegraph'], installed: false, status: 'missing', missingReason: 'command not found: codegraph' },
          { id: 'gbrain', name: 'GBrain', category: 'cli', command: 'gbrain', versionArgs: ['--version'], requiredFor: [], checkedPaths: ['PATH:gbrain'], installed: false, status: 'missing', missingReason: 'command not found: gbrain' },
        ],
      }),
      inspectCodeIntelligenceImpl: () => ({
        projectDir: TMP,
        scaleDir: join(TMP, '.scale'),
        configPath: join(TMP, '.scale', 'code-intelligence.json'),
        configExists: true,
        projectIndexPath: join(TMP, '.codegraph'),
        projectIndexExists: false,
        providers: [
          { id: 'codegraph', type: 'external-cli', enabled: true, available: false, capabilities: ['context'], reason: 'command not found: codegraph' },
          { id: 'graphify', type: 'artifact', enabled: true, available: false, capabilities: ['context'], reason: 'manifest not found: graphify-out/graph.json' },
        ],
        fallback: { enabled: true, tools: ['internal-scan'], available: true, reason: 'internal source scan fallback is available' },
        availableProviderCount: 0,
        recommendations: [],
      }),
      inspectMemoryProvidersImpl: () => ({
        projectDir: TMP,
        scaleDir: join(TMP, '.scale'),
        configPath: join(TMP, '.scale', 'memory-providers.json'),
        configExists: true,
        routing: {
          mode: 'external-first',
          defaultOrder: ['gbrain'],
          allowExternalWrite: false,
          requireEvidence: true,
          maxResultsPerProvider: 5,
        },
        providers: [
          {
            id: 'gbrain',
            kind: 'gbrain',
            enabled: true,
            available: false,
            selectedByDefault: true,
            priority: 95,
            capabilities: ['graph-recall'],
            safetyLevel: 'review-required',
            writeMode: 'disabled',
            reason: 'gbrain requires install or endpoint configuration',
          },
        ],
        availableProviderCount: 0,
        warnings: [],
      }),
    } as any)

    const report = await doc.diagnose()
    expect(report.bootstrapPlan?.packs).toEqual(['external-cli', 'memory', 'knowledge'])
    expect(report.checks.find((c) => c.name === 'CodeGraph CLI')?.fix).toBe('Run: scale setup --pack external-cli,memory,knowledge --memory-provider gbrain --memory-mode external-first --apply --yes')
    expect(report.checks.find((c) => c.name === 'Graphify CLI')?.fix).toBe('Run: scale setup --pack external-cli,memory,knowledge --memory-provider gbrain --memory-mode external-first --apply --yes')
    expect(report.checks.find((c) => c.name === 'Memory provider routing')).toMatchObject({
      optional: true,
      category: 'memory',
      fix: 'Run: scale setup --pack external-cli,memory,knowledge --memory-provider gbrain --memory-mode external-first --apply --yes',
    })
    const formatted = doc.formatReport(report)
    expect(formatted).toContain('Memory Providers (Optional):')
    expect(formatted).toContain('Bootstrap inspect: scale setup --pack external-cli,memory,knowledge --memory-provider gbrain --memory-mode external-first --json')
  })

  it('flags legacy qdrant config drift and recommends graphify migration', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    writeFileSync(join(TMP, '.scale', 'config.yaml'), [
      'profile: advanced',
      'storage:',
      '  knowledge:',
      '    backend: qdrant',
    ].join('\n'), 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const configHealth = report.checks.find((c) => c.name === 'Config health')
    expect(configHealth?.status).toBe('warn')
    expect(configHealth?.message).toContain('Legacy Qdrant backend configured')
    expect(configHealth?.fix).toContain('graphify-backed knowledge')
    expect(configHealth?.fix).toContain('scale setup --pack external-cli,memory,knowledge --memory-provider gbrain --memory-mode external-first --json')
  })

  it('accepts .scale/evals as a valid evolution directory', async () => {
    const adapter = new ClaudeCodeAdapter()
    await adapter.init({ projectDir: TMP })
    mkdirSync(join(TMP, '.scale', 'evals'), { recursive: true })
    writeFileSync(join(TMP, '.scale', 'config.yaml'), [
      'profile: advanced',
      'evolution:',
      '  enabled: true',
    ].join('\n'), 'utf-8')

    const doc = new Doctor(TMP)
    const report = await doc.diagnose()
    const configHealth = report.checks.find((c) => c.name === 'Config health')
    expect(configHealth?.message).not.toContain('.scale/eval/')
  })
})
