import { describe, expect, it, vi } from 'vitest'
import {
  evaluateEcosystemReadinessGate,
  normalizeEcosystemReadinessGateMode,
  normalizeEcosystemReadinessPacks,
  normalizeEcosystemReadinessSkillScope,
} from '../../src/workflow/EcosystemReadinessGate.js'
import type { SetupVerificationReport } from '../../src/setup/SetupVerification.js'
import type { SkillDoctorReport } from '../../src/skills/SkillDoctor.js'

function makeSetupReport(overrides: Partial<SetupVerificationReport> = {}): SetupVerificationReport {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    projectDir: '/tmp/project',
    scaleDir: '.scale',
    packIds: ['full'],
    includeIds: [],
    dependencyBootstrap: {} as SetupVerificationReport['dependencyBootstrap'],
    environment: {} as SetupVerificationReport['environment'],
    memoryProviders: {} as SetupVerificationReport['memoryProviders'],
    codeIntelligence: {} as SetupVerificationReport['codeIntelligence'],
    toolCapabilities: {
      ok: true,
      summary: { total: 2, installed: 2, missing: 0 },
      tools: [
        { id: 'rtk', name: 'RTK', category: 'cli', requiredFor: [], installed: true, status: 'installed', checkedPaths: ['PATH:rtk'] },
        { id: 'codegraph', name: 'CodeGraph', category: 'cli', requiredFor: [], installed: true, status: 'installed', checkedPaths: ['PATH:codegraph'] },
      ],
    },
    summary: {
      blockingIssues: [],
      dependencyStatus: { failed: [], manualReview: [], needsInit: [], versionDrift: [] },
      warningCount: 0,
      runtimeWarnings: 0,
      installedTools: 2,
      totalTools: 2,
      availableMemoryProviders: 1,
      availableCodeProviders: 1,
    },
    warnings: [],
    recommendations: ['scale tool doctor --tools rtk,codegraph --json'],
    ...overrides,
  }
}

function makeSkillReport(overrides: Partial<SkillDoctorReport> = {}): SkillDoctorReport {
  return {
    ok: true,
    total: 2,
    installed: 2,
    missing: 0,
    waived: 0,
    sourceRoots: {
      primaryRoot: '.scale/skills',
      fallbackRoots: ['skills'],
      globalRoots: ['~/.agents/skills'],
    },
    skills: [
      {
        id: 'web-access',
        name: 'Web Access',
        description: 'web research',
        source: 'https://example.test/web-access',
        installCommand: 'install web-access',
        trust: 'ecosystem',
        readiness: 'required',
        executionType: 'skill-file',
        checkedPaths: ['/tmp/web-access/SKILL.md'],
        installed: true,
        status: 'installed',
      },
      {
        id: 'impeccable',
        name: 'Impeccable',
        description: 'ui anti-pattern gate',
        source: 'https://example.test/ui',
        installCommand: 'install impeccable',
        trust: 'ecosystem',
        readiness: 'required',
        executionType: 'skill-file',
        checkedPaths: ['/tmp/impeccable/SKILL.md'],
        installed: true,
        status: 'installed',
      },
    ],
    missingByReadiness: { required: [], recommended: [], optional: [] },
    installedByReadiness: { required: ['web-access', 'impeccable'], recommended: [], optional: [] },
    waivedByReadiness: { required: [], recommended: [], optional: [] },
    ...overrides,
  }
}

describe('EcosystemReadinessGate', () => {
  it('skips checks when policy disables the gate', async () => {
    const report = await evaluateEcosystemReadinessGate({
      projectDir: '/tmp/project',
      scaleDir: '.scale',
      policy: { ecosystemReadinessGate: 'off' },
    })

    expect(report).toMatchObject({
      mode: 'off',
      checked: false,
      ok: true,
      blocked: false,
    })
  })

  it('warns but does not block when setup or skill doctor is incomplete in warn mode', async () => {
    const verifySetup = vi.fn().mockResolvedValue(makeSetupReport({
      ok: false,
      toolCapabilities: {
        ok: false,
        summary: { total: 2, installed: 1, missing: 1 },
        tools: [
          { id: 'rtk', name: 'RTK', category: 'cli', requiredFor: [], installed: true, status: 'installed', checkedPaths: ['PATH:rtk'] },
          { id: 'gbrain', name: 'GBrain', category: 'cli', requiredFor: [], installed: false, status: 'missing', checkedPaths: ['PATH:gbrain'] },
        ],
      },
      summary: {
        blockingIssues: ['Missing governed capabilities: gbrain'],
        dependencyStatus: { failed: [], manualReview: [], needsInit: [], versionDrift: [] },
        warningCount: 0,
        runtimeWarnings: 0,
        installedTools: 1,
        totalTools: 2,
        availableMemoryProviders: 1,
        availableCodeProviders: 1,
      },
    }))
    const inspectWorkflowSkills = vi.fn().mockReturnValue(makeSkillReport({
      ok: false,
      installed: 1,
      missing: 1,
      skills: [
        {
          id: 'web-access',
          name: 'Web Access',
          description: 'web research',
          source: 'https://example.test/web-access',
          installCommand: 'install web-access',
          trust: 'ecosystem',
          readiness: 'required',
          executionType: 'skill-file',
          checkedPaths: ['/tmp/web-access/SKILL.md'],
          installed: true,
          status: 'installed',
        },
        {
          id: 'agent-browser',
          name: 'Agent Browser',
          description: 'browser automation',
          source: 'https://example.test/browser',
          installCommand: 'install agent-browser',
          trust: 'ecosystem',
          readiness: 'recommended',
          executionType: 'cli-command',
          checkedPaths: ['/tmp/agent-browser/SKILL.md'],
          installed: false,
          status: 'missing',
        },
      ],
      missingByReadiness: { required: [], recommended: ['agent-browser'], optional: [] },
      installedByReadiness: { required: ['web-access'], recommended: [], optional: [] },
    }))

    const report = await evaluateEcosystemReadinessGate({
      projectDir: '/tmp/project',
      scaleDir: '.scale',
      policy: { ecosystemReadinessGate: 'warn', ecosystemReadinessPacks: ['memory'] },
      deps: { verifySetup, inspectWorkflowSkills },
    })

    expect(report.ok).toBe(false)
    expect(report.blocked).toBe(false)
    expect(report.summary.missingTools).toEqual(['gbrain'])
    expect(report.summary.missingWorkflowSkills).toEqual(['agent-browser'])
    expect(report.summary.blockingMissingWorkflowSkills).toEqual([])
    expect(report.summary.blockingIssues).toEqual(['Missing governed capabilities: gbrain'])
    expect(report.warnings).toContain('Non-blocking workflow skills missing: agent-browser')
  })

  it('keeps recommended skill gaps non-blocking under the default required scope', async () => {
    const inspectWorkflowSkills = vi.fn().mockReturnValue(makeSkillReport({
      ok: false,
      installed: 1,
      missing: 1,
      skills: [
        {
          id: 'web-access',
          name: 'Web Access',
          description: 'web research',
          source: 'https://example.test/web-access',
          installCommand: 'install web-access',
          trust: 'ecosystem',
          readiness: 'required',
          executionType: 'skill-file',
          checkedPaths: ['/tmp/web-access/SKILL.md'],
          installed: true,
          status: 'installed',
        },
        {
          id: 'agent-browser',
          name: 'Agent Browser',
          description: 'browser automation',
          source: 'https://example.test/browser',
          installCommand: 'install agent-browser',
          trust: 'ecosystem',
          readiness: 'recommended',
          executionType: 'cli-command',
          checkedPaths: ['/tmp/agent-browser/SKILL.md'],
          installed: false,
          status: 'missing',
        },
      ],
      missingByReadiness: { required: [], recommended: ['agent-browser'], optional: [] },
      installedByReadiness: { required: ['web-access'], recommended: [], optional: [] },
    }))

    const report = await evaluateEcosystemReadinessGate({
      projectDir: '/tmp/project',
      scaleDir: '.scale',
      policy: { ecosystemReadinessGate: 'block' },
      deps: { verifySetup: vi.fn().mockResolvedValue(makeSetupReport()), inspectWorkflowSkills },
    })

    expect(report.ok).toBe(true)
    expect(report.blocked).toBe(false)
    expect(report.summary.skillScope).toBe('required')
    expect(report.summary.missingRecommendedWorkflowSkills).toEqual(['agent-browser'])
    expect(report.summary.blockingMissingWorkflowSkills).toEqual([])
    expect(report.summary.blockingIssues).toEqual([])
    expect(report.warnings).toEqual(['Non-blocking workflow skills missing: agent-browser'])
  })

  it('uses the configured skill scope to decide blocking workflow skill gaps', async () => {
    const inspectWorkflowSkills = vi.fn().mockReturnValue(makeSkillReport({
      ok: false,
      installed: 1,
      missing: 1,
      skills: [
        {
          id: 'web-access',
          name: 'Web Access',
          description: 'web research',
          source: 'https://example.test/web-access',
          installCommand: 'install web-access',
          trust: 'ecosystem',
          readiness: 'required',
          executionType: 'skill-file',
          checkedPaths: ['/tmp/web-access/SKILL.md'],
          installed: true,
          status: 'installed',
        },
        {
          id: 'agent-browser',
          name: 'Agent Browser',
          description: 'browser automation',
          source: 'https://example.test/browser',
          installCommand: 'install agent-browser',
          trust: 'ecosystem',
          readiness: 'recommended',
          executionType: 'cli-command',
          checkedPaths: ['/tmp/agent-browser/SKILL.md'],
          installed: false,
          status: 'missing',
        },
      ],
      missingByReadiness: { required: [], recommended: ['agent-browser'], optional: [] },
      installedByReadiness: { required: ['web-access'], recommended: [], optional: [] },
    }))

    const report = await evaluateEcosystemReadinessGate({
      projectDir: '/tmp/project',
      scaleDir: '.scale',
      policy: { ecosystemReadinessGate: 'block', ecosystemReadinessSkillScope: 'recommended' },
      deps: { verifySetup: vi.fn().mockResolvedValue(makeSetupReport()), inspectWorkflowSkills },
    })

    expect(report.blocked).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.summary.skillScope).toBe('recommended')
    expect(report.summary.blockingMissingWorkflowSkills).toEqual(['agent-browser'])
    expect(report.summary.blockingIssues).toContain('Missing recommended workflow skills: agent-browser')
    expect(report.warnings).toContain('Workflow skill readiness is not OK for recommended scope: agent-browser')
  })

  it('blocks required workflow skill gaps under the default required scope', async () => {
    const inspectWorkflowSkills = vi.fn().mockReturnValue(makeSkillReport({
      ok: false,
      installed: 1,
      missing: 1,
      skills: [
        {
          id: 'web-access',
          name: 'Web Access',
          description: 'web research',
          source: 'https://example.test/web-access',
          installCommand: 'install web-access',
          trust: 'ecosystem',
          readiness: 'required',
          executionType: 'skill-file',
          checkedPaths: ['/tmp/web-access/SKILL.md'],
          installed: true,
          status: 'installed',
        },
        {
          id: 'code-reviewer',
          name: 'Code Reviewer',
          description: 'code review',
          source: 'https://example.test/code-reviewer',
          installCommand: 'install code-reviewer',
          trust: 'official',
          readiness: 'required',
          executionType: 'skill-file',
          checkedPaths: ['/tmp/code-reviewer/SKILL.md'],
          installed: false,
          status: 'missing',
        },
      ],
      missingByReadiness: { required: ['code-reviewer'], recommended: [], optional: [] },
      installedByReadiness: { required: ['web-access'], recommended: [], optional: [] },
    }))

    const report = await evaluateEcosystemReadinessGate({
      projectDir: '/tmp/project',
      scaleDir: '.scale',
      policy: { ecosystemReadinessGate: 'block' },
      deps: { verifySetup: vi.fn().mockResolvedValue(makeSetupReport()), inspectWorkflowSkills },
    })

    expect(report.blocked).toBe(true)
    expect(report.ok).toBe(false)
    expect(report.summary.skillScope).toBe('required')
    expect(report.summary.blockingMissingWorkflowSkills).toEqual(['code-reviewer'])
    expect(report.summary.blockingIssues).toContain('Missing required workflow skills: code-reviewer')
    expect(report.warnings).toContain('Workflow skill readiness is not OK for required scope: code-reviewer')
  })

  it('blocks when policy is block and readiness is incomplete', async () => {
    const verifySetup = vi.fn().mockResolvedValue(makeSetupReport({
      ok: false,
      summary: {
        blockingIssues: ['Manual review required: rtk'],
        dependencyStatus: { failed: [], manualReview: ['rtk'], needsInit: [], versionDrift: [] },
        warningCount: 0,
        runtimeWarnings: 0,
        installedTools: 1,
        totalTools: 2,
        availableMemoryProviders: 1,
        availableCodeProviders: 1,
      },
    }))

    const report = await evaluateEcosystemReadinessGate({
      projectDir: '/tmp/project',
      scaleDir: '.scale',
      policy: { ecosystemReadinessGate: 'block' },
      deps: { verifySetup, inspectWorkflowSkills: vi.fn().mockReturnValue(makeSkillReport()) },
    })

    expect(report.blocked).toBe(true)
    expect(report.summary.blockingIssues).toContain('Manual review required: rtk')
  })

  it('normalizes mode and packs defensively', () => {
    expect(normalizeEcosystemReadinessGateMode('block')).toBe('block')
    expect(normalizeEcosystemReadinessGateMode('invalid')).toBe('warn')
    expect(normalizeEcosystemReadinessPacks(['ui', 'unknown', 'knowledge', 'ui'])).toEqual(['ui', 'knowledge'])
    expect(normalizeEcosystemReadinessPacks([])).toEqual(['full'])
    expect(normalizeEcosystemReadinessSkillScope('recommended')).toBe('recommended')
    expect(normalizeEcosystemReadinessSkillScope('invalid')).toBe('required')
  })
})
