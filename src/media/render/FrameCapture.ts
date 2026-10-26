// Frame capture via Playwright/Chromium (P0.5 spike productized). The page's
// animation state is driven by explicit time injection — frames are a pure
// function of tMs, so a re-run with the same storyboard yields identical
// frames. Playwright is an optional dependency: absence surfaces as
// MEDIA_BIN_MISSING with install guidance instead of a crash.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { MediaError } from '../errors.js'

export interface CaptureOptions {
  pageHtmlPath: string
  framesDir: string
  width: number
  height: number
  fps: number
  totalFrames: number
  /** called every ~30 frames with (completed, total) for progress reporting */
  onProgress?: (completed: number, total: number) => void
  /** return true to abort between frames (cooperative cancel) */
  isCancelled?: () => boolean
}

export interface CaptureResult {
  framesDir: string
  totalFrames: number
  captureMs: number
  avgMsPerFrame: number
}

// minimal structural types so the module compiles without playwright's types
interface PlaywrightPage {
  goto(url: string): Promise<unknown>
  evaluate<R>(fn: (t: number) => R, arg: number): Promise<R>
  screenshot(options: { path: string; type: 'png' }): Promise<unknown>
}
interface PlaywrightBrowser {
  newPage(options: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<PlaywrightPage>
  close(): Promise<void>
}
interface PlaywrightChromium {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>
}

function loadChromium(): PlaywrightChromium {
  try {
    // optional dependency — resolved lazily (createRequire: this is an ESM module)
    return createRequire(import.meta.url)('playwright').chromium as PlaywrightChromium
  } catch {
    throw new MediaError('MEDIA_BIN_MISSING', 'playwright is not installed; run: npm i playwright && npx playwright install chromium', { retryable: false })
  }
}

export async function captureFrames(options: CaptureOptions): Promise<CaptureResult> {
  const chromium = loadChromium()
  mkdirSync(options.framesDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const started = Date.now()
  let completed = 0
  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    })
    await page.goto('file:///' + options.pageHtmlPath.replace(/\\/g, '/'))
    for (let frame = 0; frame < options.totalFrames; frame++) {
      if (options.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', 'capture cancelled by request', { retryable: false })
      await page.evaluate((t: number) => (globalThis as unknown as { __renderFrame(t: number): void }).__renderFrame(t), Math.round((frame * 1000) / options.fps))
      const padded = String(frame).padStart(5, '0')
      await page.screenshot({ path: join(options.framesDir, `f${padded}.png`), type: 'png' })
      completed = frame + 1
      if (completed % 30 === 0) options.onProgress?.(completed, options.totalFrames)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  const captureMs = Date.now() - started
  return { framesDir: options.framesDir, totalFrames: completed, captureMs, avgMsPerFrame: Math.round(captureMs / Math.max(1, completed)) }
}
