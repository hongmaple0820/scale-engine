// asset:// ref grammar (M1): shape, charset and traversal guards are the
// boundary; filesystem checks happen in materialize.

import { describe, expect, it } from 'vitest'
import {
  ASSET_REF_MAX_LENGTH,
  assetRefExternalPath,
  assetRefExternalSrc,
  assetRefFrom,
  assetRefTaskPath,
  collectAssetRefs,
  isAssetRef,
  parseAssetRef,
  tryParseAssetRef,
} from '../../../src/media/assets/refs.js'
import type { Storyboard } from '../../../src/media/types.js'

function rejectionCode(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

describe('asset:// refs', () => {
  it('parses the canonical shape', () => {
    const raw = 'asset://job-2026-10-29-1a2b3c4d/assets/generated/hero.png'
    const ref = parseAssetRef(raw)
    expect(ref).toEqual({ raw, taskId: 'job-2026-10-29-1a2b3c4d', rest: 'generated/hero.png' })
    expect(isAssetRef(raw)).toBe(true)
    expect(isAssetRef('covers/cover.png')).toBe(false)
    expect(tryParseAssetRef(raw)).toEqual(ref)
    expect(tryParseAssetRef('asset://bad')).toBeNull()
  })

  it('rejects malformed refs with MEDIA_ASSET_REF_INVALID', () => {
    const malformed: unknown[] = [
      42,
      'https://example.com/x.png',
      'asset://job-1',
      'asset://job-1/other/x.png',
      'asset://job-1/assets/',
      'asset://job-1/assets/../x.png',
      'asset://job-1/assets/a/../../x.png',
      'asset://job-1/assets//etc/x.png',
      'asset://job-1/assets/C:/x.png',
      'asset://job-1/assets/a\\b.png',
      'asset://job-1/assets/a%2Fb.png',
      'asset://../assets/x.png',
      'asset://bad task/assets/x.png',
      `asset://job-1/assets/${'a'.repeat(ASSET_REF_MAX_LENGTH)}.png`,
    ]
    for (const value of malformed) {
      expect(rejectionCode(() => parseAssetRef(value)), String(value)).toBe('MEDIA_ASSET_REF_INVALID')
    }
  })

  it('maps refs to task-relative and asset-relative paths', () => {
    const ref = parseAssetRef('asset://job-1/assets/generated/a.png')
    expect(assetRefTaskPath(ref)).toBe('assets/generated/a.png')
    expect(assetRefExternalPath(ref)).toBe('assets/external/job-1/generated/a.png')
    expect(assetRefExternalSrc(ref)).toBe('external/job-1/generated/a.png')
  })

  it('builds refs only from valid task-relative asset paths', () => {
    expect(assetRefFrom('job-1', 'assets/generated/a.png')).toBe('asset://job-1/assets/generated/a.png')
    expect(assetRefFrom('job-1', 'assets\\generated\\a.png')).toBe('asset://job-1/assets/generated/a.png')
    expect(rejectionCode(() => assetRefFrom('job-1', 'output/final.mp4'))).toBe('MEDIA_ASSET_REF_INVALID')
    expect(rejectionCode(() => assetRefFrom('bad id', 'assets/a.png'))).toBe('MEDIA_ASSET_REF_INVALID')
  })

  it('collects only image-element refs with their positions', () => {
    const board: Storyboard = {
      schemaVersion: '0.3',
      canvas: { width: 320, height: 320, fps: 24, background: '#101010' },
      scenes: [
        {
          id: 's1',
          durationMs: 500,
          elements: [
            { type: 'text', content: 'x', fontFamily: 'Arial', fontSize: 12, color: '#ffffff', x: 0, y: 0 },
            { type: 'image', src: 'covers/plain.png', x: 0, y: 0, width: 10, height: 10 },
            { type: 'image', src: 'asset://job-1/assets/generated/a.png', x: 0, y: 0, width: 10, height: 10 },
          ],
        },
      ],
    }
    const nodes = collectAssetRefs(board)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ sceneIndex: 0, elementIndex: 2, ref: { taskId: 'job-1', rest: 'generated/a.png' } })
  })
})
