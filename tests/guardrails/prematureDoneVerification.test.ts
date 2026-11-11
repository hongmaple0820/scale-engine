import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { EventBus } from '../../src/core/eventBus.js'
import { PrematureDoneDetector } from '../../src/guardrails/detectors.js'
import { GUARDRAILS_DETECTOR_VERSIONS, GUARDRAILS_POLICY_VERSION } from '../../src/guardrails/versions.js'

const ROOT = resolve('./tmp/test-premature-verification-evidence')
const SESSION = 'verification-regression'

describe('PrematureDoneDetector verification evidence', () => {
  const originalProjectDir = process.env.SCALE_PROJECT_DIR
  const originalScaleDir = process.env.SCALE_DIR
  let bus: EventBus

  beforeEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(join(ROOT, '.scale'), { recursive: true })
    writeFileSync(join(ROOT, '.scale', 'verification.json'), JSON.stringify({
      version: 1,
      defaultProfile: 'default',
      profiles: {
        default: { commands: { smoke: 'powershell -File tools/validate-patterns.ps1' } },
      },
    }))
    process.env.SCALE_PROJECT_DIR = ROOT
    process.env.SCALE_DIR = '.scale'
    bus = new EventBus({ eventsDir: join(ROOT, 'events') })
  })

  afterEach(() => {
    if (originalProjectDir === undefined) delete process.env.SCALE_PROJECT_DIR
    else process.env.SCALE_PROJECT_DIR = originalProjectDir
    if (originalScaleDir === undefined) delete process.env.SCALE_DIR
    else process.env.SCALE_DIR = originalScaleDir
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  })

  function addEdit(): void {
    bus.emit('tool.completed', { tool: 'Edit', args: { file_path: 'assets/pattern.json' }, exitCode: 0 }, { sessionId: SESSION })
  }

  async function checkStop() {
    return new PrematureDoneDetector().check({ sessionId: SESSION }, { eventBus: bus, cache: new Map() })
  }


  it('reports the detector, policy, and verification-matrix versions', async () => {
    addEdit()
    const result = await checkStop()
    expect(result.triggered).toBe(true)
    const events = await bus.query({
      sessionId: SESSION,
      types: ['behavior.premature_done'],
      limit: 1,
    })
    expect(events[0]?.payload).toMatchObject({
      detector: 'premature-done',
      detectorVersion: GUARDRAILS_DETECTOR_VERSIONS['premature-done'],
      policyVersion: GUARDRAILS_POLICY_VERSION,
      verificationMatrixVersion: 1,
      reason: 'no_verification',
    })
  })


  it('reports versioned evidence when verification predates the last edit', async () => {
    bus.emit('verification.recorded', {
      tool: 'verification-service',
      command: 'powershell -File tools/validate-patterns.ps1',
      passed: true,
    }, { sessionId: SESSION })
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    addEdit()

    const result = await checkStop()
    expect(result.triggered).toBe(true)
    const events = await bus.query({
      sessionId: SESSION,
      types: ['behavior.premature_done'],
      limit: 1,
    })
    expect(events[0]?.payload).toMatchObject({
      detector: 'premature-done',
      detectorVersion: GUARDRAILS_DETECTOR_VERSIONS['premature-done'],
      policyVersion: GUARDRAILS_POLICY_VERSION,
      verificationMatrixVersion: 1,
      reason: 'stale_verification',
    })
  })

  it.each(['Bash', 'PowerShell', 'pwsh', 'cmd', 'Terminal'])('accepts a successful configured command from %s', async tool => {
    addEdit()
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    bus.emit('tool.completed', {
      tool,
      args: { command: 'powershell -File tools/validate-patterns.ps1' },
      exitCode: 0,
      output: 'validation passed',
    }, { sessionId: SESSION })
    expect((await checkStop()).triggered).toBe(false)
  })

  it('blocks when the latest configured verification command failed', async () => {
    addEdit()
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    bus.emit('tool.completed', {
      tool: 'PowerShell',
      args: { command: 'powershell -File tools/validate-patterns.ps1' },
      exitCode: 0,
      output: 'validation passed',
    }, { sessionId: SESSION })
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    bus.emit('tool.failed', {
      tool: 'PowerShell',
      args: { command: 'powershell -File tools/validate-patterns.ps1' },
      exitCode: 1,
      output: 'validation failed',
    }, { sessionId: SESSION })
    const result = await checkStop()
    expect(result.triggered).toBe(true)
    expect(result.reason).toContain('最近一次验证失败')
  })

  it('does not accept a matching command string from an unrelated MCP tool', async () => {
    addEdit()
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    bus.emit('tool.completed', {
      tool: 'mcp__filesystem__write_file',
      args: { command: 'powershell -File tools/validate-patterns.ps1' },
      exitCode: 0,
      output: 'not a shell execution',
    }, { sessionId: SESSION })
    const result = await checkStop()
    expect(result.triggered).toBe(true)
    expect(result.reason).toContain('未运行任何验证命令')
  })

  it('does not let a successful verification hide a later failed attempt', async () => {
    addEdit()
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    bus.emit('tool.completed', {
      tool: 'Bash',
      args: { command: 'powershell -File tools/validate-patterns.ps1' },
      exitCode: 0,
    }, { sessionId: SESSION })
    await new Promise(resolveDelay => setTimeout(resolveDelay, 3))
    bus.emit('tool.failed', {
      tool: 'Bash',
      args: { command: 'powershell -File tools/validate-patterns.ps1' },
      exitCode: 1,
    }, { sessionId: SESSION })
    expect((await checkStop()).triggered).toBe(true)
  })
})
