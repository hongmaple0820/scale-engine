import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { EventBus } from '../../src/core/eventBus.js'
import { DangerousCommandDetector, SecretLeakDetector } from '../../src/guardrails/advancedDetectors.js'
import { isVerificationEvidenceEvent } from '../../src/guardrails/detectors.js'
import { normalizeShellToolName, type VerificationCommandCatalog } from '../../src/guardrails/verificationCommands.js'
import { GUARDRAILS_DETECTOR_VERSIONS, GUARDRAILS_POLICY_VERSION, guardrailsVersionReport } from '../../src/guardrails/versions.js'

type Fixture = {
  schemaVersion: number
  policyVersion: number
  detectorVersions: Record<string, string>
  dangerousCommands: Array<{ id: string; tool: string; args: Record<string, unknown>; expected: { triggered: boolean; severity?: string } }>
  secretLeak: Array<{ id: string; tool: string; args: Record<string, unknown>; expected: { triggered: boolean; severity?: string } }>
  shellTools: Array<{ id: string; input: string; expected: string | null }>
  verificationEvents: Array<{ id: string; type: string; payload: unknown; expected: boolean }>
  verificationCatalog: {
    version: number
    defaultProfile: string
    profiles: Record<string, { commands: Record<string, string> }>
  }
}

const fixtures = JSON.parse(readFileSync(
  new URL('../fixtures/shield/guardrails-v1.json', import.meta.url),
  'utf-8',
)) as Fixture

describe('Shield / Guardrails versioned regression corpus', () => {
  const previousSecretMode = process.env.SCALE_SECRET_LEAK_MODE

  beforeEach(() => {
    process.env.SCALE_SECRET_LEAK_MODE = 'block'
  })

  afterEach(() => {
    if (previousSecretMode === undefined) delete process.env.SCALE_SECRET_LEAK_MODE
    else process.env.SCALE_SECRET_LEAK_MODE = previousSecretMode
    if (existsSync('./tmp/shield-fixture-events')) rmSync('./tmp/shield-fixture-events', { recursive: true, force: true })
  })

  it('declares the exact detector and policy versions exercised by this corpus', () => {
    expect(fixtures.schemaVersion).toBe(1)
    expect(fixtures.policyVersion).toBe(GUARDRAILS_POLICY_VERSION)
    expect(fixtures.detectorVersions).toEqual(GUARDRAILS_DETECTOR_VERSIONS)
    expect(guardrailsVersionReport()).toEqual({
      policyVersion: fixtures.policyVersion,
      detectors: fixtures.detectorVersions,
    })
  })

  it.each(fixtures.secretLeak)('secret-leak fixture: $id', async fixture => {
    const bus = new EventBus({ eventsDir: './tmp/shield-fixture-events' })
    const result = await new SecretLeakDetector().check(
      { sessionId: fixture.id, tool: fixture.tool, args: fixture.args },
      { eventBus: bus, cache: new Map() },
    )
    expect(result.triggered).toBe(fixture.expected.triggered)
    if (fixture.expected.severity) expect(result.severity).toBe(fixture.expected.severity)
    else expect(result.severity).toBeUndefined()

    if (fixture.expected.triggered) {
      const events = await bus.query({ sessionId: fixture.id, types: ['tool.blocked'], limit: 1 })
      expect(events[0]?.payload).toMatchObject({
        detector: 'secret-leak',
        detectorVersion: fixtures.detectorVersions['secret-leak'],
        policyVersion: fixtures.policyVersion,
      })
    }
  })


  it.each(fixtures.dangerousCommands)('dangerous-command fixture: $id', async fixture => {
    const bus = new EventBus({ eventsDir: './tmp/shield-fixture-events' })
    const result = await new DangerousCommandDetector().check(
      { sessionId: fixture.id, tool: fixture.tool, args: fixture.args },
      { eventBus: bus, cache: new Map() },
    )
    expect(result.triggered).toBe(fixture.expected.triggered)
    if (fixture.expected.severity) expect(result.severity).toBe(fixture.expected.severity)
  })

  it.each(fixtures.shellTools)('shell adapter fixture: $id', fixture => {
    expect(normalizeShellToolName(fixture.input)).toBe(fixture.expected)
  })

  it.each(fixtures.verificationEvents)('verification evidence fixture: $id', fixture => {
    const catalog: VerificationCommandCatalog = {
      version: fixtures.verificationCatalog.version,
      source: 'verification-matrix',
      commands: Object.values(fixtures.verificationCatalog.profiles.default.commands),
      suggestionCommands: Object.values(fixtures.verificationCatalog.profiles.default.commands),
    }
    expect(isVerificationEvidenceEvent({ type: fixture.type, payload: fixture.payload }, catalog))
      .toBe(fixture.expected)
  })
})
