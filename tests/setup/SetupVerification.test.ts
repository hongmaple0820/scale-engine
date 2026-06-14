import { describe, expect, it, vi, beforeEach } from 'vitest'

const bootstrap = vi.hoisted(() => ({
  bootstrapDependencies: vi.fn(),
}))

const codeIntelligence = vi.hoisted(() => ({
  inspectCodeIntelligence: vi.fn(),
}))

const environmentDoctor = vi.hoisted(() => ({
  inspectEnvironment: vi.fn(),
}))

const memoryProviders = vi.hoisted(() => ({
  inspectMemoryProviders: vi.fn(),
}))

const toolCapabilities = vi.hoisted(() => ({
  inspectToolCapabilities: vi.fn(),
}))

vi.mock('../../src/bootstrap/DependencyBootstrap.js', () => bootstrap)
vi.mock('../../src/codegraph/CodeIntelligence.js', () => codeIntelligence)
vi.mock('../../src/env/EnvironmentDoctor.js', () => environmentDoctor)
vi.mock('../../src/memory/MemoryProviders.js', () => memoryProviders)
vi.mock('../../src/tools/ToolCapabilityRegistry.js', () => toolCapabilities)

import { verifySetup } from '../../src/setup/SetupVerification.js'

describe('verifySetup', () => {
  beforeEach(() => {
    bootstrap.bootstrapDependencies.mockReset()
    codeIntelligence.inspectCodeIntelligence.mockReset()
    environmentDoctor.inspectEnvironment.mockReset()
    memoryProviders.inspectMemoryProviders.mockReset()
    toolCapabilities.inspectToolCapabilities.mockReset()
  })

  it('keeps guidance in recommendations instead of counting it as warnings', async () => {
    bootstrap.bootstrapDependencies.mockResolvedValue({
      ok: true,
      complete: true,
      projectDir: process.cwd(),
      scaleDir: '.scale',
      packIds: ['full'],
      includeIds: [],
      apply: false,
      runtimeChecks: [],
      items: [
        {
          id: 'gbrain',
          name: 'GBrain',
          kind: 'cli',
          packs: ['memory'],
          source: 'https://github.com/garrytan/gbrain',
          installed: true,
          status: 'installed',
          installSupported: false,
          detectedBy: 'PATH:gbrain',
          prerequisites: [],
        },
      ],
      summary: {
        total: 1,
        installed: 1,
        ready: 0,
        manualReview: 0,
        needsInit: 0,
        versionDrift: 0,
        installedNow: 0,
        failed: 0,
      },
      postActions: [],
      postChecks: [],
      postCheckSummary: { total: 0, passed: 0, warned: 0, failed: 0 },
      postCheckCommands: ['scale tool doctor --tools gbrain --json'],
      rollbackHints: [],
      recommendations: ['After GBrain is installed, validate remote health.'],
    })

    environmentDoctor.inspectEnvironment.mockReturnValue({
      ok: true,
      status: 'healthy',
      generatedAt: new Date().toISOString(),
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      node: {
        version: 'v22.13.1',
        execPath: 'C:\\node\\node.exe',
        status: 'ok',
        reason: 'Node is healthy.',
      },
      shell: {
        defaultShell: 'powershell',
        comspec: 'cmd.exe',
        detected: [],
      },
      path: {
        delimiter: ';',
        entryCount: 1,
        entriesPreview: ['C:\\tools'],
      },
      checks: [],
      warnings: [],
      recommendations: ['Use `npm run smoke:setup`.'],
    })

    memoryProviders.inspectMemoryProviders.mockReturnValue({
      projectDir: process.cwd(),
      scaleDir: '.scale',
      configPath: '.scale/memory-providers.json',
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
          available: true,
          selectedByDefault: true,
          priority: 95,
          capabilities: ['semantic-recall'],
          safetyLevel: 'review-required',
          writeMode: 'disabled',
          reason: 'gbrain core recall is available.',
        },
      ],
      availableProviderCount: 1,
      warnings: [],
    })

    codeIntelligence.inspectCodeIntelligence.mockReturnValue({
      projectDir: process.cwd(),
      scaleDir: '.scale',
      configPath: '.scale/code-intelligence.json',
      configExists: true,
      projectIndexPath: '.codegraph',
      projectIndexExists: true,
      providers: [],
      fallback: {
        enabled: true,
        tools: ['rg'],
        available: true,
        reason: 'fallback available',
      },
      availableProviderCount: 1,
      recommendations: ['Run `scale codegraph status --json`.'],
    })

    toolCapabilities.inspectToolCapabilities.mockReturnValue({
      ok: true,
      summary: {
        total: 1,
        installed: 1,
        missing: 0,
      },
      tools: [
        {
          id: 'gbrain',
          name: 'GBrain',
          category: 'cli',
          checkedPaths: ['PATH:gbrain'],
          installed: true,
          status: 'installed',
        },
      ],
    })

    const report = await verifySetup({ packIds: ['full'] })

    expect(report.ok).toBe(true)
    expect(report.summary.warningCount).toBe(0)
    expect(report.warnings).toEqual([])
    expect(report.recommendations).toEqual(expect.arrayContaining([
      'scale tool doctor --tools gbrain --json',
      'After GBrain is installed, validate remote health.',
      'Run `scale codegraph status --json`.',
      'Use `npm run smoke:setup`.',
    ]))
  })

  it('blocks setup readiness when gbrain is not initialized', async () => {
    bootstrap.bootstrapDependencies.mockResolvedValue({
      ok: true,
      complete: true,
      projectDir: process.cwd(),
      scaleDir: '.scale',
      packIds: ['memory'],
      includeIds: [],
      apply: false,
      runtimeChecks: [],
      items: [
        {
          id: 'gbrain',
          name: 'GBrain',
          kind: 'cli',
          packs: ['memory'],
          source: 'https://github.com/garrytan/gbrain',
          installed: true,
          status: 'needs-init',
          installSupported: false,
          detectedBy: 'PATH:gbrain',
          prerequisites: [],
        },
      ],
      summary: {
        total: 1,
        installed: 0,
        ready: 0,
        manualReview: 0,
        needsInit: 1,
        versionDrift: 0,
        installedNow: 0,
        failed: 0,
      },
      postActions: [],
      postChecks: [],
      postCheckSummary: { total: 0, passed: 0, warned: 0, failed: 0 },
      postCheckCommands: ['scale memory provider status --json'],
      rollbackHints: [],
      recommendations: ['Validate memory provider status after setup.'],
    })

    environmentDoctor.inspectEnvironment.mockReturnValue({
      ok: true,
      status: 'healthy',
      generatedAt: new Date().toISOString(),
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      node: {
        version: 'v22.13.1',
        execPath: 'C:\\node\\node.exe',
        status: 'ok',
        reason: 'Node is healthy.',
      },
      shell: {
        defaultShell: 'powershell',
        comspec: 'cmd.exe',
        detected: [],
      },
      path: {
        delimiter: ';',
        entryCount: 1,
        entriesPreview: ['C:\\tools'],
      },
      checks: [],
      warnings: [],
      recommendations: [],
    })

    memoryProviders.inspectMemoryProviders.mockReturnValue({
      projectDir: process.cwd(),
      scaleDir: '.scale',
      configPath: '.scale/memory-providers.json',
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
          capabilities: ['semantic-recall'],
          safetyLevel: 'review-required',
          writeMode: 'disabled',
          reason: 'gbrain doctor failed in this runtime',
        },
      ],
      availableProviderCount: 0,
      warnings: [],
    })

    codeIntelligence.inspectCodeIntelligence.mockReturnValue({
      projectDir: process.cwd(),
      scaleDir: '.scale',
      configPath: '.scale/code-intelligence.json',
      configExists: true,
      projectIndexPath: '.codegraph',
      projectIndexExists: true,
      providers: [],
      fallback: {
        enabled: true,
        tools: ['rg'],
        available: true,
        reason: 'fallback available',
      },
      availableProviderCount: 1,
      recommendations: [],
    })

    toolCapabilities.inspectToolCapabilities.mockReturnValue({
      ok: false,
      summary: {
        total: 1,
        installed: 0,
        missing: 1,
      },
      tools: [
        {
          id: 'gbrain',
          name: 'GBrain',
          category: 'cli',
          checkedPaths: ['PATH:gbrain'],
          installed: false,
          status: 'missing',
        },
      ],
    })

    const report = await verifySetup({ packIds: ['memory'] })

    expect(report.ok).toBe(false)
    expect(report.summary.blockingIssues).toEqual(expect.arrayContaining([
      'Initialization required: gbrain',
      'Missing governed capabilities: gbrain',
      'No memory provider is currently available',
    ]))
    expect(report.summary.dependencyStatus.needsInit).toEqual(['gbrain'])
  })

  it('skips memory and code provider probes when their packs are not selected', async () => {
    bootstrap.bootstrapDependencies.mockResolvedValue({
      ok: true,
      complete: true,
      projectDir: process.cwd(),
      scaleDir: '.scale',
      packIds: ['external-cli'],
      includeIds: [],
      apply: false,
      runtimeChecks: [],
      items: [
        {
          id: 'rtk',
          name: 'RTK',
          kind: 'cli',
          packs: ['external-cli'],
          source: 'https://github.com/rtk-ai/rtk',
          installed: true,
          status: 'installed',
          installSupported: false,
          detectedBy: 'PATH:rtk',
          prerequisites: [],
        },
      ],
      summary: {
        total: 1,
        installed: 1,
        ready: 0,
        manualReview: 0,
        needsInit: 0,
        versionDrift: 0,
        installedNow: 0,
        failed: 0,
      },
      postActions: [],
      postChecks: [],
      postCheckSummary: { total: 0, passed: 0, warned: 0, failed: 0 },
      postCheckCommands: ['scale tool doctor --tools rtk --json'],
      rollbackHints: [],
      recommendations: [],
    })

    environmentDoctor.inspectEnvironment.mockReturnValue({
      ok: true,
      status: 'healthy',
      generatedAt: new Date().toISOString(),
      platform: 'win32',
      arch: 'x64',
      release: '10.0.19045',
      node: {
        version: 'v22.13.1',
        execPath: 'C:\\node\\node.exe',
        status: 'ok',
        reason: 'Node is healthy.',
      },
      shell: {
        defaultShell: 'powershell',
        comspec: 'cmd.exe',
        detected: [],
      },
      path: {
        delimiter: ';',
        entryCount: 1,
        entriesPreview: ['C:\\tools'],
      },
      checks: [],
      warnings: [],
      recommendations: [],
    })

    toolCapabilities.inspectToolCapabilities.mockReturnValue({
      ok: true,
      summary: {
        total: 1,
        installed: 1,
        missing: 0,
      },
      tools: [
        {
          id: 'rtk',
          name: 'RTK',
          category: 'cli',
          checkedPaths: ['PATH:rtk'],
          installed: true,
          status: 'installed',
        },
      ],
    })

    const report = await verifySetup({ packIds: ['external-cli'] })

    expect(memoryProviders.inspectMemoryProviders).not.toHaveBeenCalled()
    expect(codeIntelligence.inspectCodeIntelligence).not.toHaveBeenCalled()
    expect(report.ok).toBe(true)
    expect(report.memoryProviders.providers).toEqual([])
    expect(report.codeIntelligence.providers).toEqual([])
    expect(report.summary.availableMemoryProviders).toBe(0)
    expect(report.summary.availableCodeProviders).toBe(0)
  })
})
