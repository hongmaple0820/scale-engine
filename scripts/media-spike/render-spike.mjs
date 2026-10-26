#!/usr/bin/env node
// P0.5 render spike (v3 plan §7.3): deterministic frame capture via
// Playwright/Chromium + FFmpeg encode on Windows. Proves the chain the media
// workflow gates on: 1080p30 CJK composition, audio mux with fades, burned
// subtitles, non-ASCII output path, subprocess cleanup, perf metrics.
//
// Committed inputs : scene.json (declarative Scene DSL), subs.srt, this script.
// Runtime artifacts: ~/tools/media-spike/ (frames, audio, MP4, metrics) — kept
// outside the repo on purpose (binary artifacts are not committable).
//
// Usage: node scripts/media-spike/render-spike.mjs [--ffmpeg <path>] [--ffprobe <path>]

import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const scriptDir = dirname(fileURLToPath(import.meta.url))
const work = join(homedir(), 'tools', 'media-spike')
const framesDir = join(work, 'frames')
const outputPath = join(work, '输出 测试', 'final.mp4') // non-ASCII + space on purpose

// --- ffmpeg/ffprobe resolution -------------------------------------------------

function firstExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const probe = spawnSync(candidate, ['-version'], { encoding: 'utf-8', shell: false })
    if (probe.status === 0) return candidate
  }
  return undefined
}

function resolveBin(flag, envKey, names) {
  const fromArg = process.argv[process.argv.indexOf(flag) + 1]
  const fromEnv = process.env[envKey]
  const wingetLinks = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')
  const portable = join(homedir(), 'tools', 'ffmpeg-dl')
  return firstExecutable([
    fromArg,
    fromEnv,
    ...names.map(name => join(wingetLinks, `${name}.exe`)),
    ...names.flatMap(name => {
      try {
        return readdirSync(portable, { recursive: true })
          .filter(rel => rel === `${name}.exe` || rel.endsWith(`\\${name}.exe`))
          .map(rel => join(portable, rel))
      } catch {
        return []
      }
    }),
    ...names,
  ])
}

const ffmpeg = resolveBin('--ffmpeg', 'FFMPEG_BIN', ['ffmpeg'])
const ffprobe = resolveBin('--ffprobe', 'FFPROBE_BIN', ['ffprobe'])
if (!ffmpeg || !ffprobe) {
  console.error(JSON.stringify({ ok: false, error: 'ffmpeg/ffprobe not found; pass --ffmpeg/--ffprobe' }))
  process.exit(2)
}

const run = (bin, args, opts = {}) => {
  const started = Date.now()
  const result = spawnSync(bin, args, { encoding: 'utf-8', shell: false, ...opts })
  return { code: result.status, ms: Date.now() - started, stderr: (result.stderr ?? '').split('\n').slice(-6).join('\n') }
}

// --- scene DSL → page ----------------------------------------------------------

const scene = JSON.parse(readFileSync(join(scriptDir, 'scene.json'), 'utf-8'))
const { width, height, fps, background } = scene.canvas
const totalMs = scene.scenes.reduce((sum, s) => sum + s.durationMs, 0)
const totalFrames = Math.round((totalMs / 1000) * fps)

const elementHtml = (el) => {
  const base = `position:absolute;left:${el.x === 'center' ? 0 : el.x}px;top:${el.y}px;` +
    (el.x === 'center' ? 'width:100%;text-align:center;' : `width:${el.width}px;`) +
    (el.type === 'text'
      ? `font-family:'${el.fontFamily}';font-size:${el.fontSize}px;color:${el.color};line-height:1.4;`
      : `height:${el.height}px;background:${el.color};border-radius:${el.radius ?? 0}px;`)
  const content = el.type === 'text' ? escapeHtml(el.content) : ''
  return `<div class="el" style="${base}">${content}</div>`
}
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const scenesHtml = scene.scenes
  .map(
    (s, i) =>
      `<div class="scene" id="scene-${i}" style="position:absolute;inset:0;">` +
      s.elements.map(elementHtml).join('') +
      `</div>`,
  )
  .join('\n')

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${background};}
  #stage{position:relative;width:${width}px;height:${height}px;background:${background};overflow:hidden;}
  *{box-sizing:border-box;}
</style></head>
<body><div id="stage">${scenesHtml}</div>
<script>
  const SCENES = ${JSON.stringify(scene.scenes)};
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
  const clamp01 = (p) => Math.max(0, Math.min(1, p));

  window.__renderFrame = function (tMs) {
    let start = 0, active = 0;
    for (let i = 0; i < SCENES.length; i++) {
      if (tMs < start + SCENES[i].durationMs) { active = i; break; }
      start += SCENES[i].durationMs; active = i;
    }
    const local = tMs - start;
    SCENES.forEach((s, i) => {
      const el = document.getElementById('scene-' + i);
      const show = i === active;
      el.style.display = show ? 'block' : 'none';
      if (!show) return;
      const fade = s.transitionOut?.type === 'fade'
        ? clamp01((s.durationMs - local) / Math.max(1, s.transitionOut.durationMs))
        : 1;
      el.style.opacity = String(fade);
      s.elements.forEach((e, j) => {
        const node = el.children[j];
        const a = e.animation;
        if (!a) { node.style.opacity = '1'; return; }
        const p = easeOutCubic(clamp01((local - (a.delayMs ?? 0)) / Math.max(1, a.durationMs)));
        switch (a.type) {
          case 'fadeIn':
            node.style.opacity = String(p); break;
          case 'fadeInUp':
            node.style.opacity = String(p);
            node.style.transform = 'translateY(' + (1 - p) * 32 + 'px)'; break;
          case 'slideUp':
            node.style.opacity = String(Math.min(1, p * 1.6));
            node.style.transform = 'translateY(' + (1 - p) * 120 + 'px)'; break;
          case 'progressBar':
            node.style.width = String((e.width ?? 0) * p) + 'px'; break;
          default:
            node.style.opacity = '1';
        }
      });
    });
  };
  window.__renderFrame(0);
</script></body></html>`

// --- main ----------------------------------------------------------------------

const metrics = {
  ffmpeg: ffmpeg,
  node: process.version,
  startedAt: new Date().toISOString(),
  canvas: { width, height, fps },
  totalFrames,
  totalMs,
}
let failed = (message) => {
  console.error(JSON.stringify({ ok: false, ...metrics, error: message }, null, 1))
  process.exit(1)
}

rmSync(work, { recursive: true, force: true })
mkdirSync(framesDir, { recursive: true })
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(join(work, 'page.html'), pageHtml, 'utf-8')
writeFileSync(join(work, 'spike.srt'), readFileSync(join(scriptDir, 'subs.srt'), 'utf-8'), 'utf-8')

// 1) deterministic frame capture
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
await page.goto('file:///' + join(work, 'page.html').replace(/\\/g, '/'))
const captureStarted = Date.now()
let lastCheckpoint = captureStarted
const perCheckpointMs = []
for (let f = 0; f < totalFrames; f++) {
  await page.evaluate((t) => window.__renderFrame(t), Math.round((f * 1000) / fps))
  await page.screenshot({ path: join(framesDir, `f${String(f).padStart(5, '0')}.png`), type: 'png' })
  if ((f + 1) % 100 === 0) {
    perCheckpointMs.push(Date.now() - lastCheckpoint)
    lastCheckpoint = Date.now()
  }
}
await browser.close()
metrics.captureMs = Date.now() - captureStarted
metrics.avgMsPerFrame = Math.round(metrics.captureMs / totalFrames)
metrics.per100FramesMs = perCheckpointMs

// 2) audio track (sine + fade in/out) — proves the audio path without assets
const audioResult = run(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${totalMs / 1000}`,
  '-af', 'afade=t=in:d=1,afade=t=out:st=14:d=1,volume=0.35',
  '-ar', '48000', '-ac', '2', join(work, 'audio.wav'),
])
if (audioResult.code !== 0) failed('audio synthesis failed: ' + audioResult.stderr)
metrics.audioMs = audioResult.ms

// 3) encode + burn subtitles + write to the non-ASCII output path
const encodeResult = run(ffmpeg, [
  '-y', '-framerate', String(fps), '-i', join(framesDir, 'f%05d.png'),
  '-i', join(work, 'audio.wav'),
  '-vf', "subtitles=spike.srt:force_style='FontName=Microsoft YaHei,FontSize=15'",
  '-c:v', scene.output.videoCodec, '-preset', scene.output.preset, '-crf', String(scene.output.crf),
  '-pix_fmt', scene.output.pixelFormat,
  '-c:a', 'aac', '-b:a', '160k',
  '-shortest', outputPath,
], { cwd: work })
if (encodeResult.code !== 0) failed('encode failed: ' + encodeResult.stderr)
metrics.encodeMs = encodeResult.ms
metrics.outputBytes = statSync(outputPath).size

// 4) probe the product
const probe = run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outputPath])
if (probe.code !== 0) failed('ffprobe failed: ' + probe.stderr)
const probed = JSON.parse(
  spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outputPath], { encoding: 'utf-8' }).stdout,
)
metrics.probe = {
  durationSec: Number(probed.format.duration),
  video: probed.streams.find((s) => s.codec_type === 'video')?.codec_name,
  audio: probed.streams.find((s) => s.codec_type === 'audio')?.codec_name,
  width: probed.streams.find((s) => s.codec_type === 'video')?.width,
  height: probed.streams.find((s) => s.codec_type === 'video')?.height,
}

// 5) verification stills (mid-scene, mid-subtitle) for human inspection
for (const sec of [2.5, 7.5, 12.5]) {
  run(ffmpeg, ['-y', '-ss', String(sec), '-i', outputPath, '-frames:v', '1', join(work, `check-${sec}s.png`)])
}

// 6) subprocess cleanup check — no lingering ffmpeg/chrome after the run
const tasklist = spawnSync('tasklist', [], { encoding: 'utf-8' }).stdout ?? ''
metrics.leftoverProcesses = {
  ffmpeg: (tasklist.match(/ffmpeg\.exe/gi) ?? []).length,
  chrome: (tasklist.match(/chrome\.exe/gi) ?? []).length,
}

metrics.peakRssKb = process.resourceUsage().maxRSS
metrics.totalMsActual = Date.now() - new Date(metrics.startedAt).getTime()
metrics.ok = true
writeFileSync(join(work, 'metrics.json'), JSON.stringify(metrics, null, 1), 'utf-8')
console.log(JSON.stringify(metrics, null, 1))
