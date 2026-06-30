import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentOsCapabilityRegistry, buildAgentOsCapabilityReport } from '../../src/os/CapabilityDescriptors.js'
import type { ToolCapabilityReport } from '../../src/tools/ToolCapabilityRegistry.js'
import type { ResolvedToolPolicy } from '../../src/tools/ToolPolicy.js'
import { safeRmSync } from '../helpers/fs.js'

const policy: ResolvedToolPolicy = {
  version: 1,
  mode: 'evidence-required',
  warnings: [],
  tools: {
    rtk: {
      enabled: true,
      requiredFor: ['externalCli'],
      recommendedFor: ['review'],
      destructiveActions: 'block',
      command: 'rtk',
      evidenceRequired: true,
    },
    'desktop-cua': {
      enabled: false,
      requiredFor: ['desktopAutomation'],
      destructiveActions: 'block',
      command: 'cua',
      evidenceRequired: true,
    },
    playwright: {
      enabled: true,
      requiredFor: ['e2e'],
      recommendedFor: ['browserAutomation'],
      destructiveActions: 'confirm',
      command: 'npx playwright',
      evidenceRequired: true,
    },
  },
}

const toolReport: ToolCapabilityReport = {
  ok: false,
  summary: { total: 3, installed: 2, missing: 1 },
  tools: [
    {
      id: 'rtk',
      name: 'RTK',
      category: 'cli',
      command: 'rtk',
      versionArgs: ['--version'],
      requiredFor: ['externalCli'],
      recommendedFor: ['review'],
      installed: true,
      status: 'installed',
      checkedPaths: ['PATH:rtk'],
      version: 'rtk 1.0.0',
    },
    {
      id: 'desktop-cua',
      name: 'CUA',
      category: 'desktop',
      command: 'cua',
      versionArgs: ['--version'],
      requiredFor: ['desktopAutomation'],
      installed: false,
      status: 'missing',
      checkedPaths: ['PATH:cua'],
      missingReason: 'Command not found: cua',
    },
    {
      id: 'playwright',
      name: 'Playwright',
      category: 'browser',
      command: 'npx',
      versionArgs: ['playwright', '--version'],
      requiredFor: ['e2e'],
      recommendedFor: ['browserAutomation'],
      installed: true,
      status: 'installed',
      checkedPaths: ['PATH:npx'],
      version: 'Version 1.50.0',
    },
  ],
}

describe('Agent OS capability descriptors', () => {
  it('adds trust, side effects, approval policy, and parity metadata over tool capability checks', () => {
    const report = buildAgentOsCapabilityReport({
      projectDir: '/tmp/project',
      scaleDir: '/tmp/project/.scale',
      policy,
      toolReport,
    })

    expect(report.summary).toMatchObject({
      total: 3,
      available: 2,
      blocked: 1,
      approvalRequired: 3,
    })
    expect(report.descriptors.find(item => item.id === 'rtk')).toMatchObject({
      kind: 'cli',
      status: 'available',
      trust: 'trusted',
      approvalPolicy: 'always',
      requiredEvidence: ['command', 'exit-code', 'output-summary'],
    })
    expect(report.descriptors.find(item => item.id === 'desktop-cua')).toMatchObject({
      kind: 'desktop',
      status: 'blocked',
      trust: 'blocked',
      policyEnabled: false,
    })
    expect(report.descriptors.find(item => item.id === 'playwright')).toMatchObject({
      kind: 'browser',
      status: 'available',
      trust: 'restricted',
      approvalPolicy: 'on-risk',
    })
    expect(report.parity.map(item => item.agentTool)).toEqual([
      'capability_list',
      'capability_doctor',
      'capability_map',
    ])
  })

  it('normalizes known skill aliases to governed capability ids', () => {
    const report = buildAgentOsCapabilityReport({
      projectDir: '/tmp/project',
      scaleDir: '/tmp/project/.scale',
      policy,
      capabilityIds: ['cua'],
    })

    expect(report.descriptors).toHaveLength(1)
    expect(report.descriptors[0]).toMatchObject({
      id: 'desktop-cua',
      kind: 'desktop',
      trust: 'blocked',
      policyEnabled: false,
    })
  })

  it('persists project capability registrations and merges them into reports', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scale-capability-registry-'))
    try {
      const scaleDir = join(projectDir, '.scale')
      const registry = new AgentOsCapabilityRegistry({
        projectDir,
        scaleDir,
        now: () => new Date('2026-06-28T00:00:00.000Z'),
      })
      const registered = registry.register({
        id: 'im-bridge',
        kind: 'connector',
        displayName: 'IM Bridge',
        trust: 'restricted',
        sideEffects: ['read', 'write', 'network'],
        requiredEvidence: ['bridge-registration', 'heartbeat'],
        projectRefs: ['cc-connect'],
        requiredFor: ['remote-session'],
      })
      expect(registered).toMatchObject({
        id: 'im-bridge',
        kind: 'connector',
        status: 'available',
        trust: 'restricted',
        approvalPolicy: 'on-risk',
        projectRefs: ['cc-connect'],
      })

      const report = buildAgentOsCapabilityReport({
        projectDir,
        scaleDir,
        registry,
        toolReport: { ok: true, summary: { total: 0, installed: 0, missing: 0 }, tools: [] },
        policy,
      })
      expect(report.descriptors).toContainEqual(expect.objectContaining({
        id: 'im-bridge',
        kind: 'connector',
        requiredEvidence: ['bridge-registration', 'heartbeat'],
      }))
      expect(report.summary.total).toBe(1)

      const trusted = registry.trust('im-bridge', 'trusted')
      expect(trusted).toMatchObject({ trust: 'trusted', policyEnabled: true })
      const disabled = registry.disable('im-bridge', 'bridge token rotated')
      expect(disabled).toMatchObject({
        status: 'disabled',
        policyEnabled: false,
        missingReason: 'bridge token rotated',
      })
      expect(new AgentOsCapabilityRegistry({ projectDir, scaleDir }).list()[0]).toMatchObject({
        id: 'im-bridge',
        status: 'disabled',
      })
    } finally {
      safeRmSync(projectDir)
    }
  })
})
