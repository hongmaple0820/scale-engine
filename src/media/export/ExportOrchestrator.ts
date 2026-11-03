// Export orchestrator (M4): re-encode a succeeded render task's final.mp4 into
// fixed-spec profiles, cut covers, side-copy or burn the source SRT, and —
// when publish metadata is present — emit publish/manifest.json. The source
// task is strictly read-only; every artifact lands in the NEW export task dir.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EvidenceWriter } from '../evidence/EvidenceWriter.js'
import { MediaError } from '../errors.js'
import { appendJobEvent } from '../jobs/JobStore.js'
import type { AssetRecord, ExportJobRequest } from '../types.js'
import {
  extractStill,
  mediaBinVersion,
  probeVideo,
  requireMediaBin,
  transcodeExport,
} from '../render/FfmpegAdapter.js'
import { sha256File } from '../assets/hash.js'
import { buildPublishManifest, publishManifestPath } from './PublishPackage.js'
import { EXPORT_PROFILE_IDS, resolveExportProfile } from './profiles.js'

export interface ExportOrchestratorOptions {
  taskDir: string
  taskId: string
  request: ExportJobRequest
  sourceTask: { id: string; dir: string }
  isCancelled?: () => boolean
  onStage?: (info: { stage: string; ms: number }) => void
  ffmpegBin?: string
  ffprobeBin?: string
}

export interface ExportOutcome {
  status: 'succeeded'
  output: AssetRecord
  extras?: AssetRecord[]
  stages: Array<{ stage: string; ms: number }>
}

interface StageHooks {
  onStage?: (info: { stage: string; ms: number }) => void
  isCancelled?: () => boolean
}

async function stage<T>(
  name: string,
  fn: () => T | Promise<T>,
  hooks: StageHooks,
  evidence: EvidenceWriter,
  taskDir: string,
): Promise<T> {
  if (hooks.isCancelled?.()) throw new MediaError('MEDIA_JOB_CANCELLED', `cancelled before ${name}`, { retryable: false })
  const started = Date.now()
  try {
    const result = await fn()
    const ms = Date.now() - started
    hooks.onStage?.({ stage: name, ms })
    appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'stage_done', data: { stage: name, ms } })
    evidence.append(`stage:${name}`, 'ok', { ms })
    return result
  } catch (error) {
    const ms = Date.now() - started
    appendJobEvent(taskDir, { at: new Date().toISOString(), type: 'stage_failed', data: { stage: name, ms } })
    evidence.append(`stage:${name}`, 'error', { ms, error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function runExport(options: ExportOrchestratorOptions): Promise<ExportOutcome> {
  const { taskDir, taskId, request, sourceTask } = options
  const evidence = new EvidenceWriter(taskDir, taskId)
  const hooks: StageHooks = { onStage: options.onStage, isCancelled: options.isCancelled }

  const ffmpeg = await stage('resolve_bins', () => requireMediaBin('ffmpeg', options.ffmpegBin), hooks, evidence, taskDir)
  const ffprobe = await stage('resolve_bins', () => requireMediaBin('ffprobe', options.ffprobeBin), hooks, evidence, taskDir)
  evidence.append('bin_versions', 'ok', { ffmpeg: mediaBinVersion(ffmpeg), ffprobe: mediaBinVersion(ffprobe) })

  const sourceVideoPath = join(sourceTask.dir, 'output', 'final.mp4')
  if (!existsSync(sourceVideoPath)) {
    throw new MediaError('MEDIA_EXPORT_SOURCE_INVALID', `source video missing: ${sourceTask.id}/output/final.mp4`)
  }
  const sourceSrtPath = join(sourceTask.dir, 'output', 'subtitles.srt')
  const hasSourceSrt = existsSync(sourceSrtPath)
  const subtitleMode = request.subtitles ?? 'srt'
  // burn needs the SRT where the ffmpeg filter's relative path resolves (cwd=taskDir)
  if (subtitleMode === 'burn' && hasSourceSrt) copyFileSync(sourceSrtPath, join(taskDir, 'subtitles.srt'))

  const probe = await stage('inspect_source', () => probeVideo(ffprobe, sourceVideoPath), hooks, evidence, taskDir)
  evidence.append('export_source', 'ok', {
    sourceTaskId: sourceTask.id,
    durationSec: probe.durationSec ?? null,
    width: probe.width ?? null,
    height: probe.height ?? null,
    subtitlesSource: hasSourceSrt ? 'srt' : 'none',
  })

  const exportsDir = join(taskDir, 'output', 'exports')
  mkdirSync(exportsDir, { recursive: true })
  const profileIds = request.profiles ?? [...EXPORT_PROFILE_IDS]
  const coverAtSec = request.coverAtSec ?? 0
  const maxCoverAt = Math.max(0, (probe.durationSec ?? 1) - 0.1)
  const assetRecords: AssetRecord[] = []

  for (const profileId of profileIds) {
    const profile = resolveExportProfile(profileId)
    const outputPath = join(exportsDir, `${profile.fileBase}.mp4`)

    await stage(`transcode:${profileId}`, () => {
      const result = transcodeExport({
        ffmpeg,
        input: sourceVideoPath,
        outputPath,
        width: profile.width,
        height: profile.height,
        ...(subtitleMode === 'burn' && hasSourceSrt ? { subtitleFile: 'subtitles.srt' } : {}),
        workCwd: taskDir,
      })
      if (result.code !== 0) {
        throw new MediaError('MEDIA_ENCODE_FAILED', `export transcode for ${profileId} exited ${result.code}: ${result.stderrTail}`)
      }
      if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
        throw new MediaError('MEDIA_ENCODE_FAILED', `export transcode for ${profileId} produced no output`)
      }
    }, hooks, evidence, taskDir)

    const coverPath = join(exportsDir, `${profile.fileBase}-cover.jpg`)
    await stage(`cover:${profileId}`, () => {
      const still = extractStill({
        ffmpeg,
        input: outputPath,
        atSec: Math.min(coverAtSec, maxCoverAt),
        outPath: coverPath,
      })
      if (still.code !== 0 || !existsSync(coverPath)) {
        throw new MediaError('MEDIA_ENCODE_FAILED', `cover extraction failed for ${profileId}: ${still.stderrTail}`)
      }
    }, hooks, evidence, taskDir)

    assetRecords.push({
      id: `asset-${taskId}-${profile.fileBase}`,
      path: `output/exports/${profile.fileBase}.mp4`,
      kind: 'video',
      bytes: statSync(outputPath).size,
      sha256: sha256File(outputPath),
      probe: probeVideo(ffprobe, outputPath),
    })
    assetRecords.push({
      id: `asset-${taskId}-${profile.fileBase}-cover`,
      path: `output/exports/${profile.fileBase}-cover.jpg`,
      kind: 'image',
      bytes: statSync(coverPath).size,
      sha256: sha256File(coverPath),
    })
    evidence.append('export_profile', 'ok', { profile: profileId })

    if (subtitleMode === 'srt' && hasSourceSrt) {
      const srtPath = join(exportsDir, `${profile.fileBase}.srt`)
      copyFileSync(sourceSrtPath, srtPath)
      assetRecords.push({
        id: `asset-${taskId}-${profile.fileBase}-srt`,
        path: `output/exports/${profile.fileBase}.srt`,
        kind: 'other',
        bytes: statSync(srtPath).size,
        sha256: sha256File(srtPath),
      })
    }
  }

  if (request.publish) {
    const manifest = buildPublishManifest({
      sourceTaskId: sourceTask.id,
      title: request.publish.title,
      ...(request.publish.description ? { description: request.publish.description } : {}),
      ...(request.publish.tags ? { tags: request.publish.tags } : {}),
      ...(request.publish.platformHints ? { platformHints: request.publish.platformHints } : {}),
      assets: profileIds.map(profileId => {
        const base = resolveExportProfile(profileId).fileBase
        return {
          profile: profileId,
          video: `${base}.mp4`,
          cover: `${base}-cover.jpg`,
          ...(subtitleMode === 'srt' && hasSourceSrt ? { subtitles: `${base}.srt` } : {}),
        }
      }),
    })
    mkdirSync(join(taskDir, 'publish'), { recursive: true })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(publishManifestPath(taskDir), JSON.stringify(manifest, null, 1), 'utf-8')
    evidence.append('publish_manifest', 'ok', { path: 'publish/manifest.json', profiles: profileIds })
  }

  const [output, ...extras] = assetRecords
  return { status: 'succeeded', output, extras, stages: [] }
}
