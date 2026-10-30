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
  /**
   * Global storyboard time at local frame 0 (ms). Per-scene segment capture
   * passes the scene's start so the page's `__renderFrame` sees absolute time.
   */
  timeOffsetMs?: number
  /** first file index (per-scene segments keep 0; global capture keeps 0) */
  frameStart?: number
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
  screenshot(options: { path: string; type: 'png'; omitBackground?: boolean }): Promise<unknown>
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
  const timeOffsetMs = options.timeOffsetMs ?? 0
  const frameStart = options.frameStart ?? 0
  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    })
    await page.goto('file:///' + options.pageHtmlPath.replace(/\\/g, '/'))
    for (let frame = 0; frame < options.totalFrames; frame++) {
      if (options.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', 'capture cancelled by request', { retryable: false })
      const globalMs = timeOffsetMs + Math.round((frame * 1000) / options.fps)
      await page.evaluate((t: number) => (globalThis as unknown as { __renderFrame(t: number): void }).__renderFrame(t), globalMs)
      const padded = String(frameStart + frame).padStart(5, '0')
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

export interface StillCaptureOptions {
  pageHtmlPath: string
  outPath: string
  width: number
  height: number
}

/**
 * Capture one frame with a transparent background (video-scene overlay layer).
 * The page's own boot call renders t=0; overlays are static by construction.
 */
export async function captureStill(options: StillCaptureOptions): Promise<{ captureMs: number }> {
  const chromium = loadChromium()
  const started = Date.now()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    })
    await page.goto('file:///' + options.pageHtmlPath.replace(/\\/g, '/'))
    await page.screenshot({ path: options.outPath, type: 'png', omitBackground: true })
  } finally {
    await browser.close().catch(() => undefined)
  }
  return { captureMs: Date.now() - started }
}
