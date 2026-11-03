// Static action manifests (v3 plan §5.1). Declared ahead of implementation so
// pricing, approval and exposure decisions are reviewed once; `availableIn`
// keeps M2/M4 actions out of every surface until their milestone lands.

import type { MediaActionManifest, MediaActionSurface } from './types.js'

const ALL_SURFACES: MediaActionSurface[] = ['mcp', 'rest', 'dsh', 'cli']

const CONTROL_PARAMS = {
  project: { type: 'string', description: 'Media project id (default: default)' },
  idempotencyKey: { type: 'string', description: 'Deduplicate repeated creates' },
} as const

export const MEDIA_ACTION_MANIFESTS: readonly MediaActionManifest[] = Object.freeze([
  {
    id: 'media.generate_image',
    title: 'Generate image',
    description: 'Generate a still image from a prompt through a registered image provider.',
    risk: 'low',
    cost: { pricingKey: 'image.default', unit: 'image' },
    approval: { mode: 'threshold', thresholdCny: 1 },
    longRunning: false,
    availableIn: 'M0',
    invoke: { toolName: 'media_create_task', fixed: { type: 'generate_image' } },
    surfaces: ALL_SURFACES,
    paramsSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image prompt' },
        size: { type: 'string', description: 'Output size as WIDTHxHEIGHT' },
        providerId: { type: 'string', description: 'Registered image provider id' },
        model: { type: 'string', description: 'Optional model override' },
        ...CONTROL_PARAMS,
      },
      required: ['prompt'],
    },
  },
  {
    id: 'media.render_storyboard',
    title: 'Render storyboard',
    description: 'Render an authored storyboard to MP4 with the local FFmpeg pipeline.',
    risk: 'medium',
    cost: { pricingKey: 'local:render', unit: 'render_minute' },
    approval: { mode: 'never' },
    longRunning: true,
    availableIn: 'M0',
    invoke: { toolName: 'media_create_task', fixed: { type: 'render' } },
    surfaces: ALL_SURFACES,
    paramsSchema: {
      type: 'object',
      properties: {
        storyboard: { type: 'object', description: 'Storyboard DSL document (schemaVersion 0.1–0.3; asset:// refs require 0.3)' },
        ...CONTROL_PARAMS,
      },
      required: ['storyboard'],
    },
  },
  {
    id: 'media.generate_video',
    title: 'Generate video',
    description: 'Generate a short video from a prompt or a first frame through a video provider.',
    risk: 'high',
    cost: { pricingKey: 'video.default', unit: 'video_second' },
    approval: { mode: 'threshold', thresholdCny: 5 },
    longRunning: true,
    availableIn: 'M2',
    invoke: { toolName: 'media_create_task', fixed: { type: 'generate_video' } },
    surfaces: ALL_SURFACES,
    paramsSchema: {
      type: 'object',
      properties: {
        videoRequest: { type: 'object', description: 'Video generation request (prompt, durationSeconds, aspectRatio, resolution)' },
        ...CONTROL_PARAMS,
      },
      required: ['videoRequest'],
    },
  },
  {
    id: 'media.generate_speech',
    title: 'Generate speech',
    description: 'Synthesize speech audio from text through a speech provider.',
    risk: 'low',
    cost: { pricingKey: 'speech.default', unit: 'speech_char' },
    approval: { mode: 'threshold', thresholdCny: 2 },
    longRunning: false,
    availableIn: 'M2',
    invoke: { toolName: 'media_create_task', fixed: { type: 'generate_speech' } },
    surfaces: ALL_SURFACES,
    paramsSchema: {
      type: 'object',
      properties: {
        speechRequest: { type: 'object', description: 'Speech generation request (text, voice, format)' },
        ...CONTROL_PARAMS,
      },
      required: ['speechRequest'],
    },
  },
  {
    id: 'media.export',
    title: 'Export package',
    description: 'Compose assets, subtitles and metadata into a deterministic export package.',
    risk: 'low',
    cost: { pricingKey: 'local:export', unit: 'export' },
    approval: { mode: 'never' },
    longRunning: true,
    availableIn: 'M4',
    invoke: { toolName: 'media_create_task', fixed: { type: 'export' } },
    surfaces: ALL_SURFACES,
    paramsSchema: {
      type: 'object',
      properties: {
        exportRequest: { type: 'object', description: 'Export composition request' },
        ...CONTROL_PARAMS,
      },
      required: ['exportRequest'],
    },
  },
  {
    id: 'media.publish_prepare',
    title: 'Prepare publish package',
    description:
      'Export mode that also carries publish metadata. Same job type as media.export; the publish block in the request selects this action.',
    risk: 'medium',
    cost: { pricingKey: 'local:export', unit: 'export' },
    approval: { mode: 'threshold', thresholdCny: 0 },
    longRunning: true,
    availableIn: 'M4',
    invoke: { toolName: 'media_create_task', fixed: { type: 'export' } },
    surfaces: ALL_SURFACES,
    paramsSchema: {
      type: 'object',
      properties: {
        exportRequest: {
          type: 'object',
          description: 'Export composition request including a publish block',
          properties: { publish: { type: 'object' } },
          required: ['publish'],
        },
        ...CONTROL_PARAMS,
      },
      required: ['exportRequest'],
    },
  },
])
