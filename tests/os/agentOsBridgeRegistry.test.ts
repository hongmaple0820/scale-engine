import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentOsBridgeRegistry, verifyAgentOsBridgeToken } from '../../src/os/AgentOsBridgeRegistry.js'
import { safeRmSync } from '../helpers/fs.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) safeRmSync(dir)
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('AgentOsBridgeRegistry', () => {
  it('persists bridge registrations, stores only token hashes, and records bridge events', () => {
    const projectDir = makeDir('scale-agent-os-bridge-registry-')
    const scaleDir = join(projectDir, '.scale')
    const registry = new AgentOsBridgeRegistry({
      projectDir,
      scaleDir,
      now: () => new Date('2026-06-28T10:00:00.000Z'),
    })

    const registered = registry.register({
      bridgeId: 'BRIDGE-IM',
      name: 'IM Bridge',
      kind: 'im',
      endpoint: 'https://example.test/bridge',
      token: 'secret-token',
      scopes: ['tasks:read', 'events:read', 'tasks:write'],
      capabilityIds: ['im-bridge'],
      metadata: { projectRef: 'cc-connect' },
    })

    expect(registered.token).toBe('secret-token')
    expect(registered.bridge).toEqual(expect.objectContaining({
      bridgeId: 'BRIDGE-IM',
      name: 'IM Bridge',
      kind: 'im',
      status: 'registered',
      endpoint: 'https://example.test/bridge',
      scopes: ['tasks:read', 'events:read', 'tasks:write'],
      capabilityIds: ['im-bridge'],
    }))
    expect(registered.bridge.tokenHash).not.toContain('secret-token')
    expect(verifyAgentOsBridgeToken(registered.bridge, 'secret-token')).toBe(true)

    const persisted = readFileSync(join(scaleDir, 'bridges.json'), 'utf-8')
    expect(persisted).toContain('BRIDGE-IM')
    expect(persisted).not.toContain('secret-token')

    const reloaded = new AgentOsBridgeRegistry({ projectDir, scaleDir })
    expect(reloaded.list()).toEqual([expect.objectContaining({
      bridgeId: 'BRIDGE-IM',
      tokenHash: registered.bridge.tokenHash,
    })])

    const heartbeat = reloaded.heartbeat('BRIDGE-IM', 'secret-token')
    expect(heartbeat.bridge).toEqual(expect.objectContaining({
      bridgeId: 'BRIDGE-IM',
      status: 'online',
      lastHeartbeatAt: expect.any(String),
    }))

    const ledger = readFileSync(join(scaleDir, 'ledger', 'events.jsonl'), 'utf-8')
    expect(ledger).toContain('"bridge.registered"')
    expect(ledger).toContain('"bridge.heartbeat"')
    expect(ledger).toContain('"bridgeId":"BRIDGE-IM"')
  })

  it('rejects heartbeats with invalid bridge tokens', () => {
    const projectDir = makeDir('scale-agent-os-bridge-token-')
    const scaleDir = join(projectDir, '.scale')
    const registry = new AgentOsBridgeRegistry({ projectDir, scaleDir })
    registry.register({
      bridgeId: 'BRIDGE-REMOTE',
      name: 'Remote Agent Bridge',
      kind: 'remote-agent',
      token: 'correct-token',
    })

    expect(() => registry.heartbeat('BRIDGE-REMOTE', 'wrong-token')).toThrow('Invalid bridge token')
  })
})
