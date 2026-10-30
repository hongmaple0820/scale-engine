// Built-in template catalog (M3 v1): three fixed lines. Metadata only — the
// builders live in assemble.ts so this file stays a declarative contract.

import type { MediaTemplateId, TemplateDefinition } from './types.js'

export const BUILTIN_TEMPLATES: readonly TemplateDefinition[] = [
  {
    id: 'talking-head',
    name: '口播讲解',
    description: '9:16 竖屏，一条视频或图片作背景，配一段旁白并自动生成字幕。',
    aspectRatio: '9:16',
    canvas: { width: 1080, height: 1920, fps: 30, background: '#0b1220' },
    schemaVersion: '0.4',
    slots: [
      {
        key: 'media',
        label: '背景视频/图片',
        kind: 'media',
        required: true,
        description: '一条视频（mp4/mov/webm）或一张图片（png/jpg/webp）',
      },
      {
        key: 'title',
        label: '标题',
        kind: 'text',
        required: false,
        maxChars: 60,
        description: '画面顶部的标题文字，可留空',
      },
      {
        key: 'narration',
        label: '旁白文本',
        kind: 'narration',
        required: true,
        maxChars: 500,
        description: '口播文案；决定成片时长并生成字幕',
      },
      {
        key: 'voiceover',
        label: '旁白音频',
        kind: 'audio',
        required: false,
        description: '可选：已生成的旁白音频（mp3/wav/m4a/aac），作为 narration 音轨',
      },
    ],
  },
  {
    id: 'product-showcase',
    name: '产品展示',
    description: '16:9 横屏，3–6 个图片或视频镜头，可配 BGM。',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080, fps: 30, background: '#0b1220' },
    schemaVersion: '0.4',
    slots: [
      {
        key: 'media',
        label: '镜头素材',
        kind: 'media',
        required: true,
        multiple: true,
        minItems: 3,
        maxItems: 6,
        description: '3–6 个图片或视频，按顺序各占一个镜头',
      },
      {
        key: 'headline',
        label: '主标题',
        kind: 'text',
        required: false,
        maxChars: 80,
        description: '叠加在首个镜头上的标题文字',
      },
      {
        key: 'bgm',
        label: '背景音乐',
        kind: 'audio',
        required: false,
        description: '可选：循环播放的背景音乐（mp3/wav/m4a/aac）',
      },
    ],
  },
  {
    id: 'fast-cuts',
    name: '图文快剪',
    description: '1:1 方屏，4–8 张图片按节拍切换，可配逐图字幕与旁白。',
    aspectRatio: '1:1',
    canvas: { width: 1080, height: 1080, fps: 30, background: '#0b1220' },
    schemaVersion: '0.4',
    slots: [
      {
        key: 'images',
        label: '图片',
        kind: 'image',
        required: true,
        multiple: true,
        minItems: 4,
        maxItems: 8,
        description: '4–8 张图片，按顺序每张一个镜头',
      },
      {
        key: 'captions',
        label: '逐图字幕',
        kind: 'text',
        required: false,
        multiple: true,
        maxItems: 8,
        maxChars: 200,
        description: '可选：与图片一一对应的字幕文本；提供旁白音频时每张图都必须有字幕',
      },
      {
        key: 'voiceover',
        label: '旁白音频',
        kind: 'audio',
        required: false,
        description: '可选：旁白音频；自动字幕将使用逐图字幕文本',
      },
    ],
  },
]

export const TEMPLATE_IDS: readonly MediaTemplateId[] = BUILTIN_TEMPLATES.map(template => template.id)

export function getBuiltinTemplate(id: string): TemplateDefinition | undefined {
  return BUILTIN_TEMPLATES.find(template => template.id === id)
}
