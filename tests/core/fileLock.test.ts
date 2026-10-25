// FileLock (concurrency phase 1, spike docs/plans/2026-10-25 §3/§4):
// - N truly-parallel child processes incrementing a shared file lose nothing
//   (the lost-update bug InstinctStore had)
// - stale locks (crash residue) are stealable after TTL
// - InstinctStore.save: parallel savers of the same trigger merge losslessly
//
// NOTE: children require() the BUILT dist/ — run `npx tsc` before this suite
// after touching src/core/FileLock.ts or src/cortex/InstinctStore.ts.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  acquireFileSync,
  FileLockTimeoutError,
  withFileLockSync,
} from '../../src/core/FileLock.js'
import { InstinctStore } from '../../src/cortex/InstinctStore.js'

const root = mkdtempSync(join(tmpdir(), 'scale-filelock-'))
const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const dist = (...p: string[]) => join(repoRoot, 'dist', ...p)

afterAll(() => rmSync(root, { recursive: true, force: true }))

function runChildrenConcurrently(scriptFile: string, args: string[], count: number): Promise<void> {
  const children = Array.from({ length: count }, () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [scriptFile, ...args], { timeout: 90_000 })
      let stderr = ''
      child.stderr.on('data', d => { stderr += d })
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error(`worker exited ${code}: ${stderr.slice(0, 300)}`))
      })
    }),
  )
  return Promise.all(children).then(() => undefined)
}

describe('FileLock primitive', () => {
  it('mutual exclusion within one process', () => {
    const lockRoot = join(root, 'basic')
    const a = acquireFileSync('k', lockRoot)
    expect(() => acquireFileSync('k', lockRoot, { waitMs: 150 })).toThrow(FileLockTimeoutError)
    a.release()
    const b = acquireFileSync('k', lockRoot)
    b.release()
  })

  it('stale lock (crash residue) is stolen after TTL', () => {
    const lockRoot = join(root, 'stale')
    mkdirSync(lockRoot, { recursive: true })
    // simulate a crashed holder: lock dir with aged metadata
    const abandoned = acquireFileSync('steal-me', lockRoot)
    void abandoned // never released — simulates a crash
    const lockDir = join(lockRoot, readdirSync(lockRoot).find(n => n.endsWith('.lock'))!)
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 424242, at: Date.now() - 60_000 }), 'utf-8')
    const acquired = acquireFileSync('steal-me', lockRoot, { ttlMs: 5_000, waitMs: 2_000 })
    expect(existsSync(lockDir)).toBe(true) // same dir name, now owned by us
    acquired.release()
  })

  it('withFileLockSync always releases on throw', () => {
    const lockRoot = join(root, 'release')
    expect(() => withFileLockSync('k', lockRoot, () => { throw new Error('boom') })).toThrow('boom')
    expect(withFileLockSync('k', lockRoot, () => 1, { waitMs: 300 })).toBe(1)
  })
})

describe('multi-process lost-update protection (spike acceptance §4.1)', () => {
  it('12 truly-parallel processes × 10 increments on one file lose nothing', async () => {
    const dir = join(root, 'mp')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'counter.json')
    writeFileSync(target, JSON.stringify({ n: 0 }), 'utf-8')

    const scriptFile = join(dir, 'worker.cjs')
    writeFileSync(scriptFile, `
const { withFileLockSync } = require(${JSON.stringify(dist('core', 'FileLock.js'))})
const fs = require('fs')
const path = require('path')
const target = process.argv[2]
for (let i = 0; i < 10; i++) {
  withFileLockSync('counter', path.join(path.dirname(target), 'locks'), () => {
    const v = JSON.parse(fs.readFileSync(target, 'utf-8'))
    v.n += 1
    fs.writeFileSync(target, JSON.stringify(v))
  })
}
`, 'utf-8')

    await runChildrenConcurrently(scriptFile, [target], 12)
    expect(JSON.parse(readFileSync(target, 'utf-8')).n).toBe(120)
  }, 120_000)
})

describe('InstinctStore concurrency (spike acceptance)', () => {
  it('10 parallel savers of the same trigger merge observations losslessly', async () => {
    const dir = join(root, 'instinct-mp')
    mkdirSync(join(dir, '.scale', 'instincts'), { recursive: true })

    const scriptFile = join(dir, 'save-worker.cjs')
    writeFileSync(scriptFile, `
const { InstinctStore } = require(${JSON.stringify(dist('cortex', 'InstinctStore.js'))})
const store = new InstinctStore(process.argv[2])
store.save({
  id: '', trigger: 'before claiming a gate passed', confidence: 0.9, domain: 'governance',
  source: 'worker', scope: 'global',
  action: 'Run the gate command and attach output before reporting any pass.',
  evidence: ['e'], observations: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  appliedCount: 0, hitRate: 0,
})
`, 'utf-8')

    const baseDir = join(dir, '.scale', 'instincts')
    await runChildrenConcurrently(scriptFile, [baseDir], 10)

    const store = new InstinctStore(baseDir)
    const saved = store.loadAll().find(i => i.trigger === 'before claiming a gate passed')
    expect(saved?.observations).toBe(10) // every +1 merge survived
  }, 120_000)
})
