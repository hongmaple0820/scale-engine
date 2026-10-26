<script setup lang="ts">
// Media Studio (v3 plan §13, P5 rebuild on the Vue 3 + naive-ui stack).
// API consumer only — every write is server-validated by /api/media/*.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NInput,
  NInputGroup,
  NInputNumber,
  NSelect,
  NSpace,
  NStatistic,
  NTabPane,
  NTabs,
  NTag,
} from 'naive-ui'
import MediaCanvasEditor from './MediaCanvasEditor.vue'

interface MediaJob {
  id: string
  type: 'render' | 'generate_image'
  status: string
  attempt: number
  updatedAt: string
  stage?: string
  error?: { code: string; message: string }
  outputs: Array<{ id: string; path: string; kind: string; bytes: number; sha256: string }>
}

interface EvidenceEvent {
  at: string
  action: string
  result: 'ok' | 'error'
}

interface GalleryAsset {
  taskId: string
  scope: string
  path: string
  bytes: number
}

interface ProviderSummary {
  id: string
  kind: string
  enabled: boolean
  configured: boolean
  message: string
}

interface Storyboard {
  schemaVersion: string
  title?: string
  canvas: { width: number; height: number; fps: number; background: string }
  scenes: Array<Record<string, unknown>>
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>
}

const STATUS_TAG: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  succeeded: 'success',
  failed: 'error',
  failed_validation: 'error',
  cancelled: 'default',
  interrupted: 'warning',
  running: 'warning',
  packaging: 'warning',
  validated: 'info',
  created: 'info',
}

const project = ref(localStorage.getItem('media-project') || 'default')
const tasks = ref<MediaJob[]>([])
const assets = ref<GalleryAsset[]>([])
const providers = ref<ProviderSummary[]>([])
const health = ref<Record<string, string>>({})
const selectedTaskId = ref<string | null>(null)
const detail = ref<{ job: MediaJob; storyboard: Storyboard | null; evidence: EvidenceEvent[] } | null>(null)
const newTaskJson = ref('')
const newTaskKey = ref('')
const feedback = ref('')
const activeTab = ref('tasks')
const editorStoryboard = ref<Storyboard | null>(null)
const saving = ref(false)
let pollTimer: number | undefined

const projectOptions = computed(() => [project.value, 'default'].filter((v, i, arr) => arr.indexOf(v) === i).map(v => ({ label: v, value: v })))

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (!response.ok) throw new Error(`${body.code ?? response.status}: ${body.error ?? response.statusText}`)
  return body
}

const post = (path: string, payload?: unknown) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {}) })

async function refresh() {
  try {
    const [taskData, assetData, providerData, healthData] = await Promise.all([
      api<{ tasks: MediaJob[] }>(`/api/media/tasks?project=${encodeURIComponent(project.value)}`),
      api<{ assets: GalleryAsset[] }>(`/api/media/assets?project=${encodeURIComponent(project.value)}`).catch(() => ({ assets: [] })),
      api<{ providers: ProviderSummary[] }>('/api/media/providers').catch(() => ({ providers: [] })),
      api<Record<string, string>>('/api/media/health').catch(() => ({})),
    ])
    tasks.value = taskData.tasks
    assets.value = assetData.assets
    providers.value = providerData.providers
    health.value = healthData
    if (selectedTaskId.value) await loadDetail(selectedTaskId.value, true)
  } catch (error) {
    feedback.value = `刷新失败：${error instanceof Error ? error.message : String(error)}`
  }
}

async function loadDetail(taskId: string, silent = false) {
  try {
    detail.value = await api(`/api/media/tasks/${encodeURIComponent(taskId)}?project=${encodeURIComponent(project.value)}`)
    selectedTaskId.value = taskId
    if (!silent) feedback.value = ''
  } catch (error) {
    if (!silent) feedback.value = `详情加载失败：${error instanceof Error ? error.message : String(error)}`
  }
}

async function submitTask() {
  let storyboard: unknown
  try {
    storyboard = JSON.parse(newTaskJson.value)
  } catch (error) {
    feedback.value = `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
    return
  }
  try {
    const result = await post(`/api/media/tasks?project=${encodeURIComponent(project.value)}`, {
      storyboard,
      idempotencyKey: newTaskKey.value || undefined,
    })
    const created = result as { taskId: string; deduplicated?: boolean }
    feedback.value = `已创建 ${created.taskId}${created.deduplicated ? '（幂等命中）' : ''}`
    selectedTaskId.value = created.taskId
    await refresh()
  } catch (error) {
    feedback.value = `创建失败：${error instanceof Error ? error.message : String(error)}`
  }
}

async function cancelTask(taskId: string) {
  await post(`/api/media/tasks/${encodeURIComponent(taskId)}/cancel?project=${encodeURIComponent(project.value)}`).catch(error => (feedback.value = String(error)))
  await refresh()
}

async function retryTask(taskId: string) {
  await post(`/api/media/tasks/${encodeURIComponent(taskId)}/retry?project=${encodeURIComponent(project.value)}`).catch(error => (feedback.value = String(error)))
  await refresh()
}

async function recoverAll() {
  await post(`/api/media/recover?project=${encodeURIComponent(project.value)}`).catch(error => (feedback.value = String(error)))
  await refresh()
}

function openInEditor(job: MediaJob) {
  if (!detail.value?.storyboard) {
    feedback.value = '该任务没有可编辑的 storyboard'
    return
  }
  editorStoryboard.value = structuredClone(detail.value.storyboard)
  selectedTaskId.value = job.id
  activeTab.value = 'canvas'
}

async function saveEditor() {
  if (!editorStoryboard.value || !selectedTaskId.value) return
  saving.value = true
  try {
    await api(
      `/api/media/tasks/${encodeURIComponent(selectedTaskId.value)}/storyboard?project=${encodeURIComponent(project.value)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storyboard: editorStoryboard.value }) },
    )
    feedback.value = 'storyboard 已保存'
    await loadDetail(selectedTaskId.value, true)
  } catch (error) {
    feedback.value = `保存失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    saving.value = false
  }
}

function assetPreview(asset: GalleryAsset): string {
  return `/api/media/assets/content?project=${encodeURIComponent(project.value)}&taskId=${encodeURIComponent(asset.taskId)}&path=${encodeURIComponent(asset.path)}`
}

function assetKind(asset: GalleryAsset): 'image' | 'video' | 'audio' | 'file' {
  const extension = asset.path.slice(asset.path.lastIndexOf('.')).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) return 'image'
  if (['.mp4', '.webm'].includes(extension)) return 'video'
  if (['.wav', '.mp3'].includes(extension)) return 'audio'
  return 'file'
}

const busy = computed(() => tasks.value.some(task => ['running', 'packaging'].includes(task.status)))

onMounted(() => {
  void refresh()
  pollTimer = window.setInterval(() => {
    if (document.hidden) return
    void refresh()
  }, 3000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
watch(project, value => localStorage.setItem('media-project', value))

const editableStatuses = ['created', 'validated', 'failed', 'interrupted', 'failed_validation']
</script>

<template>
  <div class="media-studio">
    <div class="metric-grid">
      <n-card><n-statistic label="任务" :value="tasks.length" /></n-card>
      <n-card><n-statistic label="进行中" :value="tasks.filter(t => ['running', 'packaging'].includes(t.status)).length" /></n-card>
      <n-card><n-statistic label="成功" :value="tasks.filter(t => t.status === 'succeeded').length" /></n-card>
      <n-card><n-statistic label="素材" :value="assets.length" /></n-card>
      <n-card>
        <n-statistic label="ffmpeg">
          <n-tag :type="health.ffmpeg && health.ffmpeg !== 'missing' ? 'success' : 'error'" size="small">
            {{ health.ffmpeg && health.ffmpeg !== 'missing' ? 'ok' : 'missing' }}
          </n-tag>
        </n-statistic>
      </n-card>
    </div>

    <n-alert v-if="feedback" type="info" closable @close="feedback = ''">{{ feedback }}</n-alert>

    <n-tabs v-model:tab="activeTab" type="line" animated>
      <n-tab-pane name="tasks" tab="任务队列">
        <n-space vertical>
          <n-space align="center">
            <n-select v-model:value="project" :options="projectOptions" style="width: 160px" tag filterable />
            <n-button @click="recoverAll">恢复中断任务</n-button>
            <n-button @click="refresh">刷新</n-button>
            <n-tag v-if="busy" type="warning" size="small">渲染进行中…</n-tag>
          </n-space>
          <n-card v-for="task in tasks" :key="task.id" size="small"
            :class="['task-card', { selected: selectedTaskId === task.id }]"
            @click="loadDetail(task.id)">
            <n-space justify="space-between" align="center">
              <n-space align="center">
                <n-tag :type="STATUS_TAG[task.status] ?? 'default'" size="small">{{ task.status }}</n-tag>
                <span class="mono">{{ task.id }}</span>
                <n-tag size="tiny" :bordered="false">{{ task.type }}</n-tag>
                <span class="muted">attempt {{ task.attempt }}</span>
                <span v-if="task.error" class="error-text">{{ task.error.code }}</span>
              </n-space>
              <n-space>
                <n-button v-if="['running', 'packaging'].includes(task.status)" size="tiny" @click.stop="cancelTask(task.id)">取消</n-button>
                <n-button v-if="['failed', 'interrupted', 'failed_validation'].includes(task.status)" size="tiny" @click.stop="retryTask(task.id)">重试</n-button>
                <n-button v-if="detail?.job?.id === task.id && detail?.storyboard && editableStatuses.includes(task.status)" size="tiny" type="primary" @click.stop="openInEditor(task)">画布编辑</n-button>
              </n-space>
            </n-space>
          </n-card>
          <n-empty v-if="tasks.length === 0" description="暂无任务 — 在「新建任务」粘贴 storyboard JSON" />
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="canvas" tab="画布编辑器">
        <div v-if="editorStoryboard && selectedTaskId" class="editor-wrap">
          <media-canvas-editor
            :key="selectedTaskId"
            v-model:storyboard="editorStoryboard"
            :saving="saving"
            @save="saveEditor"
          />
        </div>
        <n-empty v-else description="从「任务队列」选择一个可编辑任务，点「画布编辑」进入" />
      </n-tab-pane>

      <n-tab-pane name="gallery" tab="素材库">
        <div class="asset-grid">
          <n-card v-for="asset in [...assets].reverse().slice(0, 60)" :key="asset.taskId + asset.path" size="small">
            <img v-if="assetKind(asset) === 'image'" :src="assetPreview(asset)" class="asset-preview" loading="lazy">
            <video v-else-if="assetKind(asset) === 'video'" :src="assetPreview(asset)" controls class="asset-preview" />
            <audio v-else-if="assetKind(asset) === 'audio'" :src="assetPreview(asset)" controls style="width: 100%" />
            <div v-else class="muted asset-preview">{{ assetKind(asset) }}</div>
            <div class="mono asset-path">{{ asset.taskId }}</div>
            <div class="asset-path">{{ asset.path }}</div>
          </n-card>
          <n-empty v-if="assets.length === 0" description="暂无素材" />
        </div>
      </n-tab-pane>

      <n-tab-pane name="new" tab="新建任务">
        <n-space vertical>
          <div class="text-sm">
            <span v-for="provider in providers" :key="provider.id" style="margin-right: 14px">
              <n-tag :type="provider.enabled ? (provider.configured ? 'success' : 'warning') : 'default'" size="tiny">
                {{ provider.enabled ? (provider.configured ? 'ready' : 'unconfigured') : 'disabled' }}
              </n-tag>
              {{ provider.id }} ({{ provider.kind }})
            </span>
          </div>
          <n-input v-model:value="newTaskJson" type="textarea" placeholder="粘贴 storyboard JSON（Scene DSL v0.2，见 docs/media/storyboard-format.md）" :rows="10" />
          <n-input-group>
            <n-input v-model:value="newTaskKey" placeholder="idempotency key（可选）" style="width: 300px" />
            <n-button type="primary" @click="submitTask">创建渲染任务</n-button>
          </n-input-group>
        </n-space>
      </n-tab-pane>
    </n-tabs>

    <n-card v-if="detail" :title="`任务详情 · ${detail.job.id}`" size="small" class="detail-card">
      <n-space vertical>
        <n-space align="center">
          <n-tag :type="STATUS_TAG[detail.job.status] ?? 'default'" size="small">{{ detail.job.status }}</n-tag>
          <span class="muted">{{ detail.job.type }} · attempt {{ detail.job.attempt }}</span>
          <n-tag v-if="detail.job.error" type="error" size="small">{{ detail.job.error.code }}</n-tag>
        </n-space>
        <div v-for="output in detail.job.outputs" :key="output.id" class="text-sm">
          <span class="mono">{{ output.path }}</span>
          <span class="muted">  {{ output.bytes }} bytes · sha256 {{ output.sha256.slice(0, 12) }}…</span>
          <img
            v-if="output.path.endsWith('.png') || output.path.endsWith('.jpg') || output.path.endsWith('.jpeg') || output.path.endsWith('.webp')"
            :src="`/api/media/assets/content?project=${encodeURIComponent(project)}&taskId=${encodeURIComponent(detail.job.id)}&path=${encodeURIComponent(output.path)}`"
            class="asset-preview detail-preview"
          >
          <video
            v-else-if="output.path.endsWith('.mp4') || output.path.endsWith('.webm')"
            :src="`/api/media/assets/content?project=${encodeURIComponent(project)}&taskId=${encodeURIComponent(detail.job.id)}&path=${encodeURIComponent(output.path)}`"
            controls
            class="detail-preview"
          />
        </div>
        <div v-if="detail.evidence.length" class="evidence">
          <div v-for="event in detail.evidence" :key="event.at + event.action" class="text-sm">
            <span class="muted">{{ event.at.slice(11, 19) }}</span>
            <span :class="event.result === 'ok' ? 'ok-text' : 'error-text'"> {{ event.result === 'ok' ? '✓' : '✗' }} {{ event.action }}</span>
          </div>
        </div>
      </n-space>
    </n-card>
  </div>
</template>

<style scoped>
.media-studio { display: flex; flex-direction: column; gap: 14px; }
.task-card { cursor: pointer; }
.task-card.selected { outline: 2px solid var(--accent, #38bdf8); }
.mono { font-family: ui-monospace, monospace; font-size: 12px; }
.muted { color: rgba(128, 128, 140, 0.9); font-size: 12px; }
.text-sm { font-size: 13px; }
.error-text { color: #ef4444; font-size: 12px; }
.ok-text { color: #22c55e; }
.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.asset-preview { width: 100%; border-radius: 6px; object-fit: cover; min-height: 60px; }
.asset-path { font-size: 11px; word-break: break-all; }
.evidence { max-height: 220px; overflow: auto; border-top: 1px solid rgba(128, 128, 140, 0.25); padding-top: 6px; }
.detail-card { margin-top: 8px; }
.detail-preview { max-width: 380px; margin-top: 6px; border-radius: 6px; display: block; }
.editor-wrap { min-height: 560px; }
</style>
