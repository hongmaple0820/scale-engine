// Trusted scene renderer (v3 plan §6): turns a *validated* storyboard into a
// static HTML page with a `__renderFrame(tMs)` function. Deterministic by
// construction — animation state is a pure function of the injected time, no
// rAF, no user code. Values reaching this file have passed the validator, but
// text is still HTML-escaped and only whitelisted style properties are ever
// interpolated.

import type { ElementAnimation, SceneElement, Storyboard } from '../types.js'

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function elementStyle(element: SceneElement): string {
  const left = element.x === 'center' ? 'left:0;width:100%;text-align:center;' : `left:${element.x}px;`
  const base = `position:absolute;top:${element.y}px;${base_box(element)}`
  if (element.type === 'text') {
    return `${base}${left}font-family:'${element.fontFamily}';font-size:${element.fontSize}px;color:${element.color};line-height:1.4;`
  }
  if (element.type === 'rect') {
    return `${base}${left}height:${element.height}px;background:${element.color};border-radius:${element.radius ?? 0}px;`
  }
  return `${base}${left}height:${element.height}px;`
}

function base_box(element: SceneElement): string {
  // images carry explicit width/height; text uses the centering box; rect uses width
  if (element.type === 'rect') return `width:${element.width}px;`
  if (element.type === 'image') return `width:${element.width}px;`
  return ''
}

function elementContent(element: SceneElement, assetsPrefix: string): string {
  if (element.type === 'text') return escapeHtml(element.content)
  if (element.type === 'image') return `<img src="${assetsPrefix}/${element.src.split('\\').join('/')}" style="width:100%;height:100%;object-fit:fill;display:block;">`
  return ''
}

function animationScript(): string {
  return `
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  const clamp01 = (p) => Math.max(0, Math.min(1, p));
  function applyAnimation(node, animation, localMs, targetWidth) {
    if (!animation) { node.style.opacity = '1'; return; }
    const p = easeOutCubic(clamp01((localMs - (animation.delayMs || 0)) / Math.max(1, animation.durationMs)));
    switch (animation.type) {
      case 'fadeIn': node.style.opacity = String(p); break;
      case 'fadeInUp':
        node.style.opacity = String(p);
        node.style.transform = 'translateY(' + (1 - p) * 32 + 'px)'; break;
      case 'slideUp':
        node.style.opacity = String(Math.min(1, p * 1.6));
        node.style.transform = 'translateY(' + (1 - p) * 120 + 'px)'; break;
      case 'progressBar': node.style.width = String(targetWidth * p) + 'px'; break;
    }
  }`
}

export interface BuildPageOptions {
  /** prefix for image src resolution relative to the page location (default: task assets) */
  assetsPrefix?: string
}

export function buildPageHtml(storyboard: Storyboard, options: BuildPageOptions = {}): string {
  const assetsPrefix = options.assetsPrefix ?? '../assets'
  const { width, height, background } = storyboard.canvas
  const scenesHtml = storyboard.scenes
    .map(
      (scene, index) =>
        `<div class="scene" id="scene-${index}" style="position:absolute;inset:0;display:none;">` +
        scene.elements.map(el => `<div class="el" style="${elementStyle(el)}">${elementContent(el, assetsPrefix)}</div>`).join('') +
        '</div>',
    )
    .join('\n')

  const scenesPayload = JSON.stringify(
    storyboard.scenes.map(scene => ({
      durationMs: scene.durationMs,
      transitionOut: scene.transitionOut ?? null,
      animations: scene.elements.map(el => (el as { animation?: ElementAnimation }).animation ?? null),
      rectWidths: scene.elements.map(el => (el.type === 'rect' ? el.width : 0)),
    })),
  )

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${background};}
  #stage{position:relative;width:${width}px;height:${height}px;background:${background};overflow:hidden;}
  *{box-sizing:border-box;}
  img{-webkit-user-drag:none;}
</style></head>
<body><div id="stage">${scenesHtml}</div>
<script>
  const SCENES = ${scenesPayload};
  ${animationScript()}
  window.__renderFrame = function (tMs) {
    let start = 0, active = SCENES.length - 1;
    for (let i = 0; i < SCENES.length; i++) {
      if (tMs < start + SCENES[i].durationMs) { active = i; break; }
      start += SCENES[i].durationMs;
    }
    const local = tMs - start;
    SCENES.forEach((s, i) => {
      const el = document.getElementById('scene-' + i);
      if (i !== active) { el.style.display = 'none'; el.style.transform = 'none'; el.style.clipPath = 'none'; return; }
      el.style.display = 'block';
      const tail = s.transitionOut ? clamp01((s.durationMs - local) / Math.max(1, s.transitionOut.durationMs)) : 1;
      const gone = 1 - tail;
      if (!s.transitionOut || s.transitionOut.type === 'fade') {
        el.style.opacity = String(tail);
        el.style.transform = 'none';
        el.style.clipPath = 'none';
      } else if (s.transitionOut.type === 'slide') {
        const dx = s.transitionOut.direction === 'left' ? -100 : s.transitionOut.direction === 'right' ? 100 : 0;
        const dy = s.transitionOut.direction === 'up' ? -100 : s.transitionOut.direction === 'down' ? 100 : 0;
        el.style.opacity = '1';
        el.style.transform = 'translate(' + (dx * gone) + '%, ' + (dy * gone) + '%)';
        el.style.clipPath = 'none';
      } else {
        const insets = {
          left: 'inset(0 0 0 ' + (gone * 100) + '%)',
          right: 'inset(0 ' + (gone * 100) + '% 0 0)',
          up: 'inset(0 0 ' + (gone * 100) + '% 0)',
          down: 'inset(' + (gone * 100) + '% 0 0 0)',
        };
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.clipPath = insets[s.transitionOut.direction] || insets.left;
      }
      const nodes = el.children;
      s.animations.forEach((animation, j) => applyAnimation(nodes[j], animation, local, s.rectWidths[j]));
    });
  };
  window.__renderFrame(0);
</script></body></html>`
}

/** SRT text for the (validated) storyboard subtitles, burned by FFmpeg when present. */
export function buildSrt(storyboard: Storyboard): string | undefined {
  if (!storyboard.subtitles || storyboard.subtitles.length === 0) return undefined
  const stamp = (ms: number) => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    const msec = Math.floor(ms % 1000)
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msec, 3)}`
  }
  return storyboard.subtitles
    .map((cue, i) => `${i + 1}\n${stamp(cue.startMs)} --> ${stamp(cue.endMs)}\n${cue.text}`)
    .join('\n\n') + '\n'
}
