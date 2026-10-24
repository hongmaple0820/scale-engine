// dsh-scale evidenceBridge — async, failures-only by default (plan §6 T1.3):
// sync writeFileSync on every tool call would block the DSH Electron host.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  pendingEvidenceWrites,
  recordToolEvidence,
  resetEvidenceBridge,
} from '../../packages/dsh-scale/src/evidenceBridge.js'

const root = mkdtempSync(join(tmpdir(), 'dsh-evidence-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  resetEvidenceBridge()
})

function runtimeFiles(projectDir: string): string[] {
  const dir = join(projectDir, '.scale', 'evidence', 'runtime')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json'))
}

function readRecord(projectDir: string, file: string) {
  return JSON.parse(readFileSync(join(projectDir, '.scale', 'evidence', 'runtime', file), 'utf-8'))
}

describe('recordToolEvidence — failures-only (default)', () => {
  it('records failed tool calls as RTE-*.json with status failed', async () => {
    const projectDir = join(root, 'failures')
    recordToolEvidence({
      toolName: 'pwsh',
      args: { command: 'rm -rf /' },
      result: 'Error: [destructive]',
      error: true,
      projectDir,
      sessionId: 'agent-1',
    })
    await pendingEvidenceWrites()

    const files = runtimeFiles(projectDir)
    expect(files).toHaveLength(1)
    const record = readRecord(projectDir, files[0])
    expect(files[0]).toMatch(/^RTE-/)
    expect(record.kind).toBe('tool')
    expect(record.status).toBe('failed')
    expect(record.sessionId).toBe('agent-1')
    expect(record.metadata?.source).toBe('dsh-scale')
  })

  it('does NOT record successful calls in failures-only mode (plan U8 write-volume guard)', async () => {
    const projectDir = join(root, 'skip-success')
    recordToolEvidence({
      toolName: 'read',
      args: { file_path: 'README.md' },
      result: 'ok',
      error: false,
      projectDir,
    })
    await pendingEvidenceWrites()
    expect(runtimeFiles(projectDir)).toHaveLength(0)
    // and no .scale tree got created for a purely skipped call
    expect(existsSync(join(projectDir, '.scale'))).toBe(false)
  })
})

describe('recordToolEvidence — mode all', () => {
  it('records both successful and failed calls', async () => {
    const projectDir = join(root, 'all-mode')
    recordToolEvidence({
      toolName: 'read', args: {}, result: 'ok', error: false,
      projectDir, mode: 'all',
    })
    recordToolEvidence({
      toolName: 'pwsh', args: { command: 'rm -rf /' }, result: 'blocked', error: true,
      projectDir, mode: 'all',
    })
    await pendingEvidenceWrites()
    const files = runtimeFiles(projectDir)
    expect(files).toHaveLength(2)
    const statuses = files.map(f => readRecord(projectDir, f).status).sort()
    expect(statuses).toEqual(['failed', 'passed'])
  })
})

describe('recordToolEvidence — robustness', () => {
  it('serializes writes and never rejects (fire-and-forget contract)', async () => {
    const projectDir = join(root, 'burst')
    for (let i = 0; i < 10; i++) {
      recordToolEvidence({
        toolName: 'pwsh', args: { i }, result: 'x', error: true,
        projectDir,
      })
    }
    await expect(pendingEvidenceWrites()).resolves.toBeUndefined()
    expect(runtimeFiles(projectDir)).toHaveLength(10)
  })
})
