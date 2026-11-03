// M3 template flow: every builtin template must survive plan → assemble →
// createJob with mock media. The full render leg is opt-in (MEDIA_M3_FULL_RENDER=1)
// because three 1080p boards take minutes on CI machines; the skip is explicit.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'
import { assembleTemplate, planTemplate } from '../../../src/media/templates/assemble.js'
import { createJob, runJob } from '../../../src/media/jobs/JobService.js'
import { resolveMediaBin } from '../../../src/media/render/FfmpegAdapter.js'
import type { Storyboard } from '../../../src/media/types.js'

const nodeRequire = createRequire(import.meta.url)
const ffmpeg = resolveMediaBin('ffmpeg')
const binsReady = Boolean(ffmpeg && resolveMediaBin('ffprobe'))
let playwrightReady = false
try {
  nodeRequire.resolve('playwright')
  playwrightReady = true
} catch {
  // full render leg unavailable
}
const fullRender = process.env.MEDIA_M3_FULL_RENDER === '1'

const root = mkdtempSync(join(tmpdir(), 'media-template-flow-'))
const fixtures = join(root, 'fixtures')
mkdirSync(fixtures, { recursive: true })
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

function ffmpegRun(args: string[]): void {
  const result = spawnSync(ffmpeg as string, args, { encoding: 'utf-8', shell: false, windowsHide: true })
  expect(result.status, result.stderr).toBe(0)
}

function makeImage(name: string, color: string): string {
  const path = join(fixtures, name)
  ffmpegRun(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=1`, '-frames:v', '1', path])
  return path
}

function makeTone(name: string, durationSec: number): string {
  const path = join(fixtures, name)
  ffmpegRun([
    '-y', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${durationSec}`,
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', path,
  ])
  return path
}

const fastOutput = { videoCodec: 'libx264', pixelFormat: 'yuv420p', audioCodec: 'aac', crf: 30, preset: 'ultrafast' }

async function createAndMaybeRender(board: Storyboard, assets: Record<string, string>, key: string): Promise<void> {
  const created = createJob({
    root,
    storyboard: { ...board, output: fastOutput },
    ...(key ? { idempotencyKey: key } : {}),
  })
  for (const [name, source] of Object.entries(assets)) {
    const target = join(created.taskDir, 'assets', name)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  if (!fullRender) return
  const job = await runJob({ root, taskId: created.job.id })
  expect(job.status, job.error?.message).toBe('succeeded')
  expect(job.outputs?.[0].path).toBe('output/final.mp4')
}

describe('template plan → assemble → createJob (M3)', () => {
  it.runIf(binsReady)('talking-head: image + narration + voiceover', async () => {
    makeImage('talk.png', '0x1d4ed8')
    makeTone('talk-vo.wav', 0.6)
    const plan = planTemplate('talking-head', {
      media: 'generated/talk.png',
      narration: '你好，世界。',
      voiceover: 'voice/talk-vo.wav',
    })
    expect(plan.slots.every(slot => !slot.missing)).toBe(true)
    const board = assembleTemplate('talking-head', {
      media: 'generated/talk.png',
      narration: '你好，世界。',
      voiceover: 'voice/talk-vo.wav',
    })
    expect(board.scenes).toHaveLength(1)
    await createAndMaybeRender(board, {
      'generated/talk.png': join(fixtures, 'talk.png'),
      'voice/talk-vo.wav': join(fixtures, 'talk-vo.wav'),
    }, 'template-talking-head')
  }, 600000)

  it.runIf(binsReady)('product-showcase: 3 images + BGM', async () => {
    ;['a', 'b', 'c'].forEach((name, index) => makeImage(`show-${name}.png`, ['0x0ea5e9', '0x22c55e', '0xf59e0b'][index]))
    makeTone('show-bgm.wav', 0.8)
    const slots = {
      media: ['generated/show-a.png', 'generated/show-b.png', 'generated/show-c.png'],
      headline: '新品发布',
      bgm: 'music/show-bgm.wav',
    }
    const plan = planTemplate('product-showcase', slots)
    expect(plan.draft.scenes).toHaveLength(3)
    const board = assembleTemplate('product-showcase', slots)
    await createAndMaybeRender(board, {
      'generated/show-a.png': join(fixtures, 'show-a.png'),
      'generated/show-b.png': join(fixtures, 'show-b.png'),
      'generated/show-c.png': join(fixtures, 'show-c.png'),
      'music/show-bgm.wav': join(fixtures, 'show-bgm.wav'),
    }, 'template-product-showcase')
  }, 600000)

  it.runIf(binsReady)('fast-cuts: 4 images + captions + voiceover', async () => {
    ;['1', '2', '3', '4'].forEach((name, index) => makeImage(`cut-${name}.png`, ['0x334155', '0x475569', '0x64748b', '0x94a3b8'][index]))
    makeTone('cut-vo.wav', 0.8)
    const slots = {
      images: ['generated/cut-1.png', 'generated/cut-2.png', 'generated/cut-3.png', 'generated/cut-4.png'],
      captions: ['第一张。', '第二张。', '第三张。', '第四张。'],
      voiceover: 'voice/cut-vo.wav',
    }
    const plan = planTemplate('fast-cuts', slots)
    expect(plan.draft.scenes).toHaveLength(4)
    const board = assembleTemplate('fast-cuts', slots)
    await createAndMaybeRender(board, {
      'generated/cut-1.png': join(fixtures, 'cut-1.png'),
      'generated/cut-2.png': join(fixtures, 'cut-2.png'),
      'generated/cut-3.png': join(fixtures, 'cut-3.png'),
      'generated/cut-4.png': join(fixtures, 'cut-4.png'),
      'voice/cut-vo.wav': join(fixtures, 'cut-vo.wav'),
    }, 'template-fast-cuts')
  }, 600000)
})

it.skipIf(binsReady)('skips template flow tests because FFmpeg/ffprobe are not installed', () => {
  expect(binsReady).toBe(false)
})

it.skipIf(!binsReady || playwrightReady)('skips the full template render leg because Chromium is unavailable', () => {
  expect(binsReady && playwrightReady).toBe(false)
})

it.skipIf(fullRender)('skips the (slow) full template render leg; set MEDIA_M3_FULL_RENDER=1 to run it', () => {
  expect(fullRender).toBe(false)
})
