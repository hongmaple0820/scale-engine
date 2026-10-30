// M4 交付 composable: state + handlers for the "交付" tab. API consumer only —
// every write is server-validated by /api/media/tasks (type=export). Publish
// metadata is plain user input; the engine never generates it.
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'

export interface DeliveryJob {
  id: string
  type: 'render' | 'generate_image' | 'generate_video' | 'generate_speech' | 'export'
  status: string
  updatedAt: string
}

export const EXPORT_PROFILES = [
  { label: '16:9 · 1080p（横版）', value: '16x9-1080p' },
  { label: '9:16 · 1080p（竖版）', value: '9x16-1080p' },
  { label: '1:1 · 1080p（方形）', value: '1x1-1080p' },
] as const

export const SUBTITLE_MODES = [
  { label: '旁挂 SRT', value: 'srt' },
  { label: '烧录进画面', value: 'burn' },
  { label: '不带字幕', value: 'none' },
] as const

const PLATFORM_HINT_OPTIONS = [
  { label: 'douyin', value: 'douyin' },
  { label: 'xiaohongshu', value: 'xiaohongshu' },
  { label: 'shipinhao', value: 'shipinhao' },
  { label: 'bilibili', value: 'bilibili' },
] as const

export const EXPORT_PLATFORM_HINT_OPTIONS = PLATFORM_HINT_OPTIONS

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as T & { code?: string; message?: string }
  if (!response.ok) {
    throw new Error(payload.message ?? payload.code ?? `HTTP ${response.status}`)
  }
  return payload
}

export interface UseExportDeliveryOptions {
  tasks: Ref<DeliveryJob[]>
  /** current project id (also the query param for POST /api/media/tasks) */
  project: Ref<string>
  /** called after a task is created (select it + switch tab + refresh) */
  onCreated?: (taskId: string) => void
}

export function useExportDelivery(options: UseExportDeliveryOptions) {
  const exportSourceId = ref<string | null>(null)
  const exportProfiles = ref<Array<(typeof EXPORT_PROFILES)[number]['value']>>(['16x9-1080p', '9x16-1080p'])
  const exportCoverAt = ref(0)
  const exportSubtitles = ref<(typeof SUBTITLE_MODES)[number]['value']>('srt')
  const exportTitle = ref('')
  const exportDescription = ref('')
  const exportTags = ref('')
  const exportPlatformHints = ref<string[]>([])
  const exportBusy = ref(false)
  const exportFeedback = ref('')

  const exportableTasks = computed(() =>
    options.tasks.value.filter(task => task.type === 'render' && task.status === 'succeeded'),
  )

  const exportSourceOptions = computed(() =>
    exportableTasks.value.map(task => ({
      label: `${task.id}（${new Date(task.updatedAt).toLocaleString()}）`,
      value: task.id,
    })),
  )

  function resetExportForm(): void {
    exportTitle.value = ''
    exportDescription.value = ''
    exportTags.value = ''
    exportPlatformHints.value = []
    exportCoverAt.value = 0
    exportSubtitles.value = 'srt'
  }

  async function createExport(): Promise<void> {
    if (!exportSourceId.value) {
      exportFeedback.value = '请选择一个已成功的成片任务'
      return
    }
    if (exportProfiles.value.length === 0) {
      exportFeedback.value = '请至少选择一个导出规格'
      return
    }
    const publish = exportTitle.value.trim()
      ? {
          title: exportTitle.value.trim(),
          ...(exportDescription.value.trim() ? { description: exportDescription.value.trim() } : {}),
          ...(exportTags.value.trim()
            ? { tags: exportTags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) }
            : {}),
          ...(exportPlatformHints.value.length > 0 ? { platformHints: [...exportPlatformHints.value] } : {}),
        }
      : undefined
    exportBusy.value = true
    try {
      const created = await postJson<{ taskId: string; status?: string }>(
        `/api/media/tasks?project=${encodeURIComponent(options.project.value)}`,
        {
          type: 'export',
          exportRequest: {
            sourceTaskId: exportSourceId.value,
            profiles: [...exportProfiles.value],
            coverAtSec: exportCoverAt.value,
            subtitles: exportSubtitles.value,
            ...(publish ? { publish } : {}),
          },
        },
      )
      exportFeedback.value = `导出任务已创建：${created.taskId}${created.status === 'awaiting_approval' ? '（待审批）' : ''}`
      options.onCreated?.(created.taskId)
      resetExportForm()
    } catch (error) {
      exportFeedback.value = `创建导出失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      exportBusy.value = false
    }
  }

  watch(exportSourceId, value => {
    if (value) exportFeedback.value = ''
  })

  return {
    EXPORT_PROFILES,
    SUBTITLE_MODES,
    EXPORT_PLATFORM_HINT_OPTIONS,
    exportSourceId,
    exportProfiles,
    exportCoverAt,
    exportSubtitles,
    exportTitle,
    exportDescription,
    exportTags,
    exportPlatformHints,
    exportBusy,
    exportFeedback,
    exportableTasks,
    exportSourceOptions,
    createExport,
  }
}
