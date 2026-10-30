<script setup lang="ts">
// Media Studio (v3 plan §13, P5 rebuild on the Vue 3 + naive-ui stack).
// API consumer only — every write is server-validated by /api/media/*.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
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
import { useExportDelivery } from '../composables/useExportDelivery.js'

interface MediaJob {
  id: string
  type: 'render' | 'generate_image' | 'generate_video' | 'generate_speech' | 'export'
  status: string
  attempt: number
  updatedAt: string
  stage?: string
  error?: { code: string; message: string }
  outputs: Array<{ id: string; path: string; kind: string; bytes: number; sha256: string }>
  approval?: { id: string; status: string; estimatedCny?: number | null }
  cost?: { estimatedCny?: number | null; actualCny?: number | null }
  provider?: { providerId: string; jobId: string }
}

interface ApprovalRecord {
  id: string
  taskId: string
  status: string
  estimatedCny?: number | null
  expiresAt: string
  decidedBy?: string
}

interface BudgetSummary {
  day: string
  budgetCny: number
  spentCny: number
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

interface TemplateSlot {
  key: string
  label: string
  kind: 'media' | 'image' | 'text' | 'narration' | 'audio'
  required: boolean
  multiple?: boolean
  minItems?: number
  maxItems?: number
  maxChars?: number
  description: string
}

interface MediaTemplate {
  id: string
  name: string
  description: string
  aspectRatio: string
  canvas: { width: number; height: number; fps: number; background: string }
  slots: TemplateSlot[]
}

interface TemplatePlan {
  templateId: string
  templateName: string
  aspectRatio: string
  draft: { schemaVersion: string; scenes: Array<{ durationMs: number }> }
  slots: Array<{ key: string; label: string; values: string[]; missing: boolean }>
  estimate: { estimatedCny: number | null; pricingKey?: string; quantity?: number | null }
  warnings: string[]
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
  awaiting_approval: 'warning',
  validated: 'info',
  created: 'info',
}

const project = ref(localStorage.getItem('media-project') || 'default')
const tasks = ref<MediaJob[]>([])
const assets = ref<GalleryAsset[]>([])
const providers = ref<ProviderSummary[]>([])
const templates = ref<MediaTemplate[]>([])
const approvals = ref<ApprovalRecord[]>([])
const budget = ref<BudgetSummary | null>(null)
const health = ref<Record<string, string>>({})
const selectedTaskId = ref<string | null>(null)
const detail = ref<{ job: MediaJob; storyboard: Storyboard | null; evidence: EvidenceEvent[] } | null>(null)
const newTaskJson = ref('')
const newTaskKey = ref('')
const feedback = ref('')
const activeTab = ref('tasks')
const editorStoryboard = ref<Storyboard | null>(null)
const saving = ref(false)
// M3 template wizard: previews are pure (/api/media/plan), the final board is
// assembled server-side and then handed to the normal task API.
const wizardTemplateId = ref<string | null>(null)
const wizardSlotValues = ref<Record<string, string>>({})
const wizardPlan = ref<TemplatePlan | null>(null)
const wizardBusy = ref(false)
const wizardFeedback = ref('')
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
    const [taskData, assetData, providerData, healthData, approvalData, budgetData, templateData] = await Promise.all([
      api<{ tasks: MediaJob[] }>(`/api/media/tasks?project=${encodeURIComponent(project.value)}`),
      api<{ assets: GalleryAsset[] }>(`/api/media/assets?project=${encodeURIComponent(project.value)}`).catch(() => ({ assets: [] })),
      api<{ providers: ProviderSummary[] }>('/api/media/providers').catch(() => ({ providers: [] })),
      api<Record<string, string>>('/api/media/health').catch(() => ({})),
      api<{ approvals: ApprovalRecord[] }>(`/api/media/approvals?project=${encodeURIComponent(project.value)}`).catch(() => ({ approvals: [] })),
      api<{ budget: BudgetSummary }>(`/api/media/budget?project=${encodeURIComponent(project.value)}`).catch(() => ({ budget: null })),
      api<{ templates: MediaTemplate[] }>('/api/media/templates').catch(() => ({ templates: [] })),
    ])
    tasks.value = taskData.tasks
    assets.value = assetData.assets
    providers.value = providerData.providers
    templates.value = templateData.templates
    health.value = healthData
    approvals.value = approvalData.approvals
    budget.value = budgetData.budget
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

async function decideApproval(approval: ApprovalRecord, approve: boolean, run = false) {
  try {
    await post(`/api/media/approvals/${encodeURIComponent(approval.id)}/decide?project=${encodeURIComponent(project.value)}`, { approve, run })
    feedback.value = approve ? `已批准 ${approval.id}${run ? '，任务已启动' : ''}` : `已拒绝 ${approval.id}`
  } catch (error) {
    feedback.value = `审批失败：${error instanceof Error ? error.message : String(error)}`
  }
  await refresh()
}

function formatCny(value?: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `¥${value.toFixed(2)}` : '未定价'
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

// M1: only succeeded tasks' images can be referenced; the server re-checks
// project ownership, source status and the ref shape on save/render.
const REF_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const insertableAssets = computed(() => {
  const succeeded = new Set(tasks.value.filter(task => task.status === 'succeeded').map(task => task.id))
  return [...assets.value]
    .filter(asset =>
      asset.scope === 'assets' &&
      succeeded.has(asset.taskId) &&
      asset.path.startsWith('assets/') &&
      REF_IMAGE_EXTENSIONS.some(extension => asset.path.toLowerCase().endsWith(extension)),
    )
    .reverse()
    .map(asset => ({
      label: `${asset.taskId} · ${asset.path.slice('assets/'.length)}`,
      value: `asset://${asset.taskId}/${asset.path}`,
    }))
})

const templateOptions = computed(() => templates.value.map(template => ({
  label: `${template.name} · ${template.aspectRatio}`,
  value: template.id,
})))

const wizardTemplate = computed(() => templates.value.find(template => template.id === wizardTemplateId.value) ?? null)

const wizardPlanSummary = computed(() => {
  const plan = wizardPlan.value
  if (!plan) return null
  const totalMs = plan.draft.scenes.reduce((sum, scene) => sum + scene.durationMs, 0)
  return {
    scenes: plan.draft.scenes.length,
    seconds: (totalMs / 1000).toFixed(1),
    estimate: formatCny(plan.estimate.estimatedCny),
    missing: plan.slots.filter(slot => slot.missing).map(slot => slot.label),
  }
})

function slotPayload(): Record<string, unknown> {
  const template = wizardTemplate.value
  if (!template) return {}
  const payload: Record<string, unknown> = {}
  for (const slot of template.slots) {
    const raw = (wizardSlotValues.value[slot.key] ?? '').trim()
    if (!raw) continue
    payload[slot.key] = slot.multiple
      ? raw.split('\n').map(value => value.trim()).filter(Boolean)
      : raw
  }
  return payload
}

async function previewWizard() {
  if (!wizardTemplateId.value) {
    wizardFeedback.value = '请先选择模板'
    return
  }
  wizardBusy.value = true
  try {
    const result = await post('/api/media/plan', { templateId: wizardTemplateId.value, slots: slotPayload() }) as { plan: TemplatePlan }
    wizardPlan.value = result.plan
    wizardFeedback.value = result.plan.warnings.length > 0 ? `方案已生成（${result.plan.warnings.length} 条提示）` : '方案已生成'
  } catch (error) {
    wizardPlan.value = null
    wizardFeedback.value = `预览失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    wizardBusy.value = false
  }
}

async function assembleWizard() {
  if (!wizardTemplateId.value) {
    wizardFeedback.value = '请先选择模板'
    return
  }
  wizardBusy.value = true
  try {
    const assembled = await post(
      `/api/media/templates/${encodeURIComponent(wizardTemplateId.value)}/assemble`,
      { slots: slotPayload() },
    ) as { storyboard: Storyboard }
    const created = await post(`/api/media/tasks?project=${encodeURIComponent(project.value)}`, {
      storyboard: assembled.storyboard,
    }) as { taskId: string; status?: string }
    wizardFeedback.value = `已创建 ${created.taskId}${created.status === 'awaiting_approval' ? '（待审批）' : ''}`
    selectedTaskId.value = created.taskId
    activeTab.value = 'tasks'
    await refresh()
  } catch (error) {
    wizardFeedback.value = `创建失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    wizardBusy.value = false
  }
}

watch(wizardTemplateId, () => {
  wizardSlotValues.value = {}
  wizardPlan.value = null
  wizardFeedback.value = ''
})

const busy = computed(() => tasks.value.some(task => ['running', 'packaging'].includes(task.status)))

// M4 交付: multi-profile export of a succeeded render (logic in the composable;
// publish metadata is plain user input — the engine never generates it).
const {
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
} = useExportDelivery({
  tasks,
  project,
  onCreated: taskId => {
    selectedTaskId.value = taskId
    activeTab.value = 'tasks'
    void refresh()
  },
})

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
                <n-tag v-if="task.approval" size="tiny" :type="task.approval.status === 'pending' ? 'warning' : 'default'">
                  审批 {{ task.approval.status }}
                </n-tag>
                <span v-if="task.cost" class="muted">成本 {{ formatCny(task.cost.actualCny ?? task.cost.estimatedCny) }}</span>
                <span v-if="task.provider" class="muted mono">{{ task.provider.providerId }}:{{ task.provider.jobId.slice(0, 12) }}</span>
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

      <n-tab-pane name="approvals" tab="审批与预算">
        <n-space vertical>
          <n-card size="small" title="今日预算">
            <n-space align="center">
              <n-statistic
                label="已用 / 预算 (CNY)"
                :value="budget ? `${budget.spentCny.toFixed(2)} / ${budget.budgetCny.toFixed(2)}` : '—'"
              />
              <span class="muted">{{ budget?.day ?? '' }}</span>
            </n-space>
          </n-card>
          <n-card v-for="approval in approvals" :key="approval.id" size="small">
            <n-space justify="space-between" align="center">
              <n-space align="center">
                <n-tag :type="approval.status === 'pending' ? 'warning' : approval.status === 'approved' ? 'success' : 'default'" size="small">
                  {{ approval.status }}
                </n-tag>
                <span class="mono">{{ approval.taskId }}</span>
                <span class="muted">估算 {{ formatCny(approval.estimatedCny) }}</span>
                <span class="muted">到期 {{ approval.expiresAt.slice(0, 16).replace('T', ' ') }}</span>
                <span v-if="approval.decidedBy" class="muted">by {{ approval.decidedBy }}</span>
              </n-space>
              <n-space v-if="approval.status === 'pending'">
                <n-button size="tiny" type="primary" @click="decideApproval(approval, true, true)">批准并运行</n-button>
                <n-button size="tiny" @click="decideApproval(approval, true)">批准</n-button>
                <n-button size="tiny" type="error" @click="decideApproval(approval, false)">拒绝</n-button>
              </n-space>
            </n-space>
          </n-card>
          <n-empty v-if="approvals.length === 0" description="没有审批记录" />
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="delivery" tab="交付">
        <n-space vertical>
          <n-card size="small" title="导出成片（多规格交付，仅本地产包，不上传平台）">
            <n-space vertical>
              <n-select
                v-model:value="exportSourceId"
                :options="exportSourceOptions"
                placeholder="选择源成片任务（type=render 且已成功）"
                filterable
                :disabled="exportBusy"
              />
              <n-empty v-if="exportableTasks.length === 0 && exportSourceId === null" description="没有可导出的成片任务 — 先在任务队列完成一个渲染" size="small" />
              <n-space align="center">
                <span class="muted">规格：</span>
                <n-checkbox-group v-model:value="exportProfiles" :disabled="exportBusy">
                  <n-space>
                    <n-checkbox v-for="profile in EXPORT_PROFILES" :key="profile.value" :value="profile.value" :label="profile.label" />
                  </n-space>
                </n-checkbox-group>
              </n-space>
              <n-space align="center">
                <span class="muted">封面取帧（秒）：</span>
                <n-input-number v-model:value="exportCoverAt" :min="0" :max="3600" :step="0.5" size="small" style="width: 140px" :disabled="exportBusy" />
                <span class="muted">字幕：</span>
                <n-select v-model:value="exportSubtitles" :options="[...SUBTITLE_MODES]" size="small" style="width: 160px" :disabled="exportBusy" />
              </n-space>
              <n-space align="center" :wrap="false" style="width: 100%">
                <span class="muted" style="flex-shrink: 0">发布元数据（可选，纯手工输入）：</span>
              </n-space>
              <n-input v-model:value="exportTitle" placeholder="标题（选填 — 填写后生成 publish/manifest.json）" :maxlength="120" :disabled="exportBusy" />
              <n-input v-model:value="exportDescription" type="textarea" placeholder="描述（选填）" :maxlength="2000" :autosize="{ minRows: 2, maxRows: 4 }" :disabled="exportBusy" />
              <n-input v-model:value="exportTags" placeholder="标签，逗号分隔（选填，如：教程, 产品演示）" :disabled="exportBusy" />
              <n-select
                v-model:value="exportPlatformHints"
                :options="[...EXPORT_PLATFORM_HINT_OPTIONS]"
                multiple
                placeholder="平台提示（仅写入 manifest，不产生任何上传）"
                :disabled="exportBusy"
              />
              <n-space>
                <n-button type="primary" :loading="exportBusy" @click="createExport">创建导出任务</n-button>
                <span class="muted">输出写入新任务目录 output/exports/，源任务保持只读</span>
              </n-space>
              <n-alert v-if="exportFeedback" type="info" size="small">{{ exportFeedback }}</n-alert>
            </n-space>
          </n-card>
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="canvas" tab="画布编辑器">
        <div v-if="editorStoryboard && selectedTaskId" class="editor-wrap">
          <media-canvas-editor
            :key="selectedTaskId"
            v-model:storyboard="editorStoryboard"
            :saving="saving"
            :asset-options="insertableAssets"
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

      <n-tab-pane name="wizard" tab="模板向导">
        <n-space vertical>
          <n-card size="small" title="选择一个模板">
            <n-space vertical>
              <n-select
                v-model:value="wizardTemplateId"
                :options="templateOptions"
                placeholder="选择模板（口播 / 产品展示 / 快剪）"
                style="max-width: 420px"
              />
              <div v-if="wizardTemplate" class="text-sm muted">
                {{ wizardTemplate.description }} · {{ wizardTemplate.canvas.width }}×{{ wizardTemplate.canvas.height }} @{{ wizardTemplate.canvas.fps }}fps
              </div>
              <n-empty v-if="templates.length === 0" description="模板目录不可用（服务端未启用 M3 路由）" />
            </n-space>
          </n-card>

          <n-card v-if="wizardTemplate" size="small" :title="`槽位 · ${wizardTemplate.name}`">
            <n-form size="small" label-placement="left" :label-width="120">
              <n-form-item v-for="slot in wizardTemplate.slots" :key="slot.key" :label="slot.label">
                <n-space vertical style="width: 100%">
                  <n-input
                    v-if="slot.multiple"
                    v-model:value="wizardSlotValues[slot.key]"
                    type="textarea"
                    :rows="4"
                    :placeholder="`${slot.description}（每行一项）`"
                  />
                  <n-input v-else v-model:value="wizardSlotValues[slot.key]" :placeholder="slot.description" />
                  <span class="muted text-sm">
                    {{ slot.kind }} · {{ slot.required ? '必填' : '可选' }}
                    <template v-if="slot.multiple"> · 数量 {{ slot.minItems ?? 1 }}–{{ slot.maxItems ?? '∞' }}</template>
                    <template v-if="slot.maxChars"> · ≤{{ slot.maxChars }} 字</template>
                  </span>
                </n-space>
              </n-form-item>
            </n-form>
            <n-space>
              <n-button size="small" :loading="wizardBusy" @click="previewWizard">预览方案</n-button>
              <n-button size="small" type="primary" :loading="wizardBusy" @click="assembleWizard">组装并创建任务</n-button>
            </n-space>
            <n-alert v-if="wizardFeedback" type="info" closable style="margin-top: 8px" @close="wizardFeedback = ''">
              {{ wizardFeedback }}
            </n-alert>
          </n-card>

          <n-card v-if="wizardPlan && wizardPlanSummary" size="small" title="方案预览（纯校验，不落盘）">
            <n-space vertical>
              <n-space align="center">
                <n-tag size="small" type="info">{{ wizardPlan.templateName }}</n-tag>
                <n-tag size="small">{{ wizardPlan.aspectRatio }}</n-tag>
                <n-tag size="small">{{ wizardPlanSummary.scenes }} 幕 · {{ wizardPlanSummary.seconds }}s</n-tag>
                <n-tag size="small">估算 {{ wizardPlanSummary.estimate }}</n-tag>
                <n-tag v-if="wizardPlanSummary.missing.length" size="small" type="warning">
                  占位：{{ wizardPlanSummary.missing.join('、') }}
                </n-tag>
              </n-space>
              <div v-for="warning in wizardPlan.warnings" :key="warning" class="text-sm muted">· {{ warning }}</div>
              <pre class="plan-json">{{ JSON.stringify(wizardPlan.draft, null, 2) }}</pre>
            </n-space>
          </n-card>
        </n-space>
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
          <n-input v-model:value="newTaskJson" type="textarea" placeholder="粘贴 storyboard JSON（Scene DSL 0.4，见 docs/media/storyboard-format.md）" :rows="10" />
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
          <n-tag v-if="detail.job.cost" size="tiny" :bordered="false">
            成本 {{ formatCny(detail.job.cost.actualCny ?? detail.job.cost.estimatedCny) }}
          </n-tag>
          <n-tag v-if="detail.job.approval" size="tiny" :type="detail.job.approval.status === 'pending' ? 'warning' : 'default'">
            审批 {{ detail.job.approval.status }}
          </n-tag>
          <n-tag v-if="detail.job.provider" size="tiny" :bordered="false">
            {{ detail.job.provider.providerId }} · {{ detail.job.provider.jobId.slice(0, 16) }}
          </n-tag>
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
.plan-json {
  max-height: 280px; overflow: auto; margin: 0; padding: 8px; border-radius: 6px;
  background: rgba(128, 128, 140, 0.12); font-size: 11px; line-height: 1.45;
}
</style>
