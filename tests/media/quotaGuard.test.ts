// Storage preflight (M2): a project over quota (or a nearly full disk) must
// fail before any provider spend or byte is written. Both limits are env-tunable
// and invalid values fall back to defaults.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertStorageAvailable,
  freeBytesOf,
  minFreeBytes,
  openWorkspace,
  projectQuotaBytes,
  createJob,
  runJob,
  MediaError,
} from '../../src/media/index.js'

const root = mkdtempSync(join(tmpdir(), 'media-quota-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ENV_KEYS = ['MEDIA_PROJECT_QUOTA_MB', 'MEDIA_MIN_FREE_MB', 'MEDIA_APPROVAL_MODE'] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

beforeEach(clearEnv)
afterEach(clearEnv)

describe('quota guard', () => {
  it('parses limits from the environment and ignores invalid values', () => {
    clearEnv()
    expect(projectQuotaBytes()).toBe(2048 * 1024 * 1024)
    expect(minFreeBytes()).toBe(1024 * 1024 * 1024)
    process.env.MEDIA_PROJECT_QUOTA_MB = '10'
    expect(projectQuotaBytes()).toBe(10 * 1024 * 1024)
    process.env.MEDIA_PROJECT_QUOTA_MB = '-1'
    expect(projectQuotaBytes()).toBe(2048 * 1024 * 1024)
  })

  it('refuses work when the project is over quota', () => {
    clearEnv()
    const workspace = openWorkspace(root, 'quota')
    mkdirSync(workspace.projectDir, { recursive: true })
    writeFileSync(join(workspace.projectDir, 'blob.bin'), Buffer.alloc(4096))
    process.env.MEDIA_PROJECT_QUOTA_MB = '0.001' // ~1 KB, well below the blob
    process.env.MEDIA_MIN_FREE_MB = '0'
    try {
      assertStorageAvailable(workspace)
      throw new Error('expected assertStorageAvailable to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MediaError)
      expect((error as MediaError).code).toBe('MEDIA_QUOTA_EXCEEDED')
    }
  })

  it('lets a job fail cleanly on quota before touching a provider', async () => {
    clearEnv()
    const created = createJob({
      root,
      projectId: 'quota',
      type: 'generate_image',
      imageRequest: { prompt: 'quota', size: '1024x1024', providerId: 'mock' },
    })
    // Padding keeps the check deterministic even when this test runs alone.
    const workspace = openWorkspace(root, 'quota')
    writeFileSync(join(workspace.projectDir, 'padding.bin'), Buffer.alloc(8192))
    process.env.MEDIA_PROJECT_QUOTA_MB = '0.001'
    process.env.MEDIA_MIN_FREE_MB = '0'
    await expect(runJob({ root, projectId: 'quota', taskId: created.job.id })).rejects.toThrow(/over the 0 MB quota/)
  })

  it('reports disk-free bytes when the platform supports statfs', () => {
    const free = freeBytesOf(openWorkspace(root, 'default').projectDir)
    if (free !== undefined) expect(free).toBeGreaterThan(0)
  })
})
