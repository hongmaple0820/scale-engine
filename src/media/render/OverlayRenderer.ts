// Transparent overlay layer for video scenes (M3). Text/rect/image elements of
// a video scene are rendered once by the same trusted HTML template used for
// image scenes, with a transparent stage, then composited onto the clip by
// ffmpeg. Animations are intentionally dropped: a video scene gets a static
// overlay (documented limitation — use an image scene when motion matters).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SceneElement, Storyboard, StoryboardScene } from '../types.js'
import { buildPageHtml } from './SceneRenderer.js'
import { captureStill } from './FrameCapture.js'

/** Elements the HTML layer can draw (video is what we overlay onto). */
type OverlayElement = Exclude<SceneElement, { type: 'video' }>

const isOverlayElement = (element: SceneElement): element is OverlayElement => element.type !== 'video'

/** Strip animations so the overlay renders fully visible in its single frame. */
function staticElement(element: OverlayElement): OverlayElement {
  if (!element.animation) return element
  const { animation: _animation, ...rest } = element
  return rest as OverlayElement
}

export function overlayElementsOf(scene: StoryboardScene): OverlayElement[] {
  return scene.elements.filter(isOverlayElement)
}

export interface OverlayOptions {
  taskDir: string
  storyboard: Storyboard
  scene: StoryboardScene
  sceneIndex: number
}

export interface OverlayResult {
  /** absolute path to the transparent PNG */
  overlayPath: string
  elementCount: number
  captureMs: number
}

/**
 * Render the scene's non-video elements to `<taskDir>/render/overlays/`.
 * Returns undefined when the scene has nothing to overlay.
 */
export async function renderSceneOverlay(options: OverlayOptions): Promise<OverlayResult | undefined> {
  const elements = overlayElementsOf(options.scene).map(staticElement)
  if (elements.length === 0) return undefined

  const overlayDir = join(options.taskDir, 'render', 'overlays')
  mkdirSync(overlayDir, { recursive: true })
  const pagePath = join(overlayDir, `scene-${String(options.sceneIndex).padStart(3, '0')}.html`)
  const overlayPath = join(overlayDir, `scene-${String(options.sceneIndex).padStart(3, '0')}.png`)

  // A synthetic single-scene board keeps buildPageHtml's timeline simple; the
  // duration only needs to be positive for the boot render.
  const synthetic: Storyboard = {
    ...options.storyboard,
    scenes: [{ id: options.scene.id, durationMs: 1000, elements }],
  }
  writeFileSync(pagePath, buildPageHtml(synthetic, { assetsPrefix: '../../assets', transparent: true }), 'utf-8')
  const still = await captureStill({
    pageHtmlPath: pagePath,
    outPath: overlayPath,
    width: options.storyboard.canvas.width,
    height: options.storyboard.canvas.height,
  })
  return { overlayPath, elementCount: elements.length, captureMs: still.captureMs }
}
