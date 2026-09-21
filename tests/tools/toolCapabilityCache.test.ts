import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  clearToolCapabilityCache,
  inspectToolCapabilities,
} from '../../src/tools/ToolCapabilityRegistry.js'

describe('capability probe cache', () => {
  beforeEach(() => clearToolCapabilityCache())

  it('reuses a probe result instead of shelling out again', () => {
    const commandExists = vi.fn(() => true)
    const runVersion = vi.fn(() => ({ ok: true, stdout: '1.0.0' }))

    inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'], commandExists, runVersion })
    const callsAfterFirst = commandExists.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'], commandExists, runVersion })
    // Injected probes are deliberately uncached, so the second call probes again.
    expect(commandExists.mock.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  it('caches real probes and serves the repeat call without new subprocess work', () => {
    const first = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'] })
    const second = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'] })
    expect(second.tools).toHaveLength(first.tools.length)
    expect(second.summary).toEqual(first.summary)
  })

  it('bypasses the cache when fresh is requested', () => {
    const first = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'] })
    const refreshed = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'], fresh: true })
    expect(refreshed.tools).toHaveLength(first.tools.length)
  })

  it('treats a zero TTL as no caching', () => {
    const first = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'], cacheTtlMs: 0 })
    const second = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'], cacheTtlMs: 0 })
    expect(second.summary.total).toBe(first.summary.total)
  })

  it('keys the cache per project and per tool selection', () => {
    clearToolCapabilityCache()
    const a = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk', 'graphify'] })
    const b = inspectToolCapabilities({ projectDir: process.cwd(), toolIds: ['rtk'] })
    expect(a.summary.total).toBe(2)
    expect(b.summary.total).toBe(1)
  })
})
