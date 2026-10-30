<script setup lang="ts">
// Infinite-canvas storyboard editor (v3 plan §17 P5 "无限画布").
// Scene cards live on a transform layer (translate + scale): wheel zooms
// around the cursor, drag on the canvas pans, dragging a card reorders the
// scene array by horizontal position (drop snaps to the rail). The inspector
// edits duration and v0.2 transitions (fade / slide / wipe + direction);
// Save issues PUT /api/media/tasks/:id/storyboard — server-side validation
// is the gate, client errors surface verbatim.
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NForm, NFormItem, NInput, NInputNumber, NSelect, NSpace, NSwitch, NTag } from 'naive-ui'

type SubtitleMode = 'none' | 'burn' | 'srt' | 'both'

interface SceneElement {
  type: 'text' | 'rect' | 'image' | 'video'
  content?: string
  fontFamily?: string
  fontSize?: number
  color?: string
  x?: number | 'center'
  y?: number
  width?: number
  height?: number
  radius?: number
  src?: string
  // video (DSL 0.4)
  fit?: 'cover' | 'contain'
  muted?: boolean
  trimStartMs?: number
  trimEndMs?: number
  loop?: boolean
}

interface AudioTrack {
  src: string
  kind: 'narration' | 'bgm'
  volume?: number
  loop?: boolean
  fadeInMs?: number
  fadeOutMs?: number
}

interface Scene {
  id: string
  durationMs: number
  elements: SceneElement[]
  transitionOut?: { type: 'fade' | 'slide' | 'wipe'; direction?: string; durationMs: number }
  narrationText?: string
}

interface Storyboard {
  schemaVersion: string
  title?: string
  canvas: { width: number; height: number; fps: number; background: string }
  scenes: Scene[]
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>
  audioTracks?: AudioTrack[]
  subtitleOptions?: { mode: SubtitleMode; source?: 'auto' | 'file'; src?: string }
}

interface AssetOption {
  label: string
  value: string
}

const props = defineProps<{
  storyboard: Storyboard
  saving?: boolean
  /** asset:// refs of succeeded tasks' images (M1 "插入生成结果") */
  assetOptions?: AssetOption[]
}>()

const emit = defineEmits<{
  save: []
  'update:storyboard': [storyboard: Storyboard]
}>()

const CARD_W = 220
const CARD_H = 132
const GAP = 56
const RAIL_Y = 90

const view = reactive({ x: 40, y: 20, scale: 0.8 })
const scenes = ref<Scene[]>(structuredClone(props.storyboard.scenes))
const audioTracks = ref<AudioTrack[]>(structuredClone(props.storyboard.audioTracks ?? []))
const subtitleMode = ref<SubtitleMode>(props.storyboard.subtitleOptions?.mode ?? 'none')
const selected = ref<number | null>(null)
const drag = ref<null | { kind: 'pan' | 'card'; index?: number; startX: number; startY: number; originX: number; originY: number; cardX?: number; cardY?: number; moved?: boolean }>(null)
const cardPositions = ref<Array<{ x: number; y: number }>>([])

let lastEmitted: Storyboard | null = null

watch(
  () => props.storyboard,
  value => {
    // ignore the echo of our own save so the current selection survives
    if (value === lastEmitted) return
    scenes.value = structuredClone(value.scenes)
    audioTracks.value = structuredClone(value.audioTracks ?? [])
    subtitleMode.value = value.subtitleOptions?.mode ?? 'none'
    layoutRail()
    selected.value = null
  },
  { immediate: true },
)

function layoutRail() {
  cardPositions.value = scenes.value.map((_, index) => ({ x: 30 + index * (CARD_W + GAP), y: RAIL_Y }))
}
layoutRail()

function cardStyle(index: number): Record<string, string> {
  const position = cardPositions.value[index] ?? { x: 30, y: RAIL_Y }
  return {
    left: `${position.x}px`,
    top: `${position.y}px`,
    width: `${CARD_W}px`,
    minHeight: `${CARD_H}px`,
  }
}

const worldStyle = computed(() => ({
  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
  transformOrigin: '0 0',
}))

function zoom(factor: number, centerX?: number, centerY?: number) {
  const viewport = viewportRef.value
  const cx = centerX ?? (viewport ? viewport.clientWidth / 2 : 400)
  const cy = centerY ?? (viewport ? viewport.clientHeight / 2 : 300)
  const next = Math.min(2, Math.max(0.25, view.scale * factor))
  const ratio = next / view.scale
  // keep the world point under the cursor stationary
  view.x = cx - (cx - view.x) * ratio
  view.y = cy - (cy - view.y) * ratio
  view.scale = next
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const rect = viewportRef.value?.getBoundingClientRect()
  zoom(event.deltaY < 0 ? 1.1 : 0.9, event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0))
}

function fit() {
  const viewport = viewportRef.value
  if (!viewport) return
  const contentWidth = scenes.value.length * (CARD_W + GAP) + GAP
  const scale = Math.min(1.2, Math.max(0.25, viewport.clientWidth / contentWidth))
  view.scale = scale
  view.x = 16
  view.y = 16
}

const viewportRef = ref<HTMLElement | null>(null)

function viewportPoint(event: PointerEvent): { x: number; y: number } {
  const rect = viewportRef.value?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

function onViewportPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const point = viewportPoint(event)
  drag.value = { kind: 'pan', startX: point.x, startY: point.y, originX: view.x, originY: view.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onCardPointerDown(event: PointerEvent, index: number) {
  if (event.button !== 0) return
  event.stopPropagation()
  const point = viewportPoint(event)
  selected.value = index
  drag.value = {
    kind: 'card',
    index,
    startX: point.x,
    startY: point.y,
    originX: cardPositions.value[index].x,
    originY: cardPositions.value[index].y,
    moved: false,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const state = drag.value
  if (!state) return
  const point = viewportPoint(event)
  const dx = point.x - state.startX
  const dy = point.y - state.startY
  if (state.kind === 'pan') {
    view.x = state.originX + dx
    view.y = state.originY + dy
    return
  }
  if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true
  const index = state.index ?? 0
  cardPositions.value[index] = {
    x: state.originX + dx / view.scale,
    y: state.originY + dy / view.scale,
  }
}

function onPointerUp() {
  const state = drag.value
  drag.value = null
  if (!state || state.kind !== 'card' || !state.moved) return
  // reorder scenes by current card x (drop snaps back to the rail)
  const order = cardPositions.value
    .map((position, index) => ({ index, x: position.x }))
    .sort((a, b) => a.x - b.x)
    .map(entry => entry.index)
  const reordered = order.map(index => scenes.value[index])
  const changed = order.some((value, slot) => value !== slot)
  if (changed) {
    scenes.value = reordered
    selected.value = order.indexOf(state.index ?? 0)
  }
  layoutRail()
}

function addScene() {
  const index = scenes.value.length + 1
  scenes.value.push({
    id: `scene-${index}-${Date.now().toString(36).slice(-4)}`,
    durationMs: 1000,
    elements: [{ type: 'text', content: `场景 ${index}`, fontFamily: 'Microsoft YaHei', fontSize: 48, color: '#f8fafc', x: 'center', y: 240 }],
    transitionOut: { type: 'fade', durationMs: 300 },
  })
  layoutRail()
  selected.value = scenes.value.length - 1
}

function removeScene() {
  if (selected.value === null || scenes.value.length <= 1) return
  scenes.value.splice(selected.value, 1)
  layoutRail()
  selected.value = null
}

const selectedScene = computed(() => (selected.value === null ? null : scenes.value[selected.value] ?? null))

const selectedVideo = computed<SceneElement | null>(() => {
  const element = selectedScene.value?.elements.find(entry => entry.type === 'video')
  return element ?? null
})

function setVideoFit(fit: 'cover' | 'contain') {
  if (selectedVideo.value) selectedVideo.value.fit = fit
}

function setVideoTrim(which: 'start' | 'end', value: number | null) {
  const video = selectedVideo.value
  if (!video || value === null) return
  const next = Math.max(0, Math.round(value))
  if (which === 'start') video.trimStartMs = next
  else video.trimEndMs = next
}

function setVideoLoop(loop: boolean) {
  if (selectedVideo.value) selectedVideo.value.loop = loop
}

/** muted defaults to true; the switch exposes "keep the clip's own audio". */
function setVideoKeepAudio(keep: boolean) {
  if (selectedVideo.value) selectedVideo.value.muted = !keep
}

const newTrackKind = ref<'narration' | 'bgm'>('narration')
const newTrackSrc = ref('')

function addAudioTrack() {
  const src = newTrackSrc.value.trim()
  if (!src) return
  audioTracks.value.push({ src, kind: newTrackKind.value, volume: 1, ...(newTrackKind.value === 'bgm' ? { loop: true } : {}) })
  newTrackSrc.value = ''
}

function removeAudioTrack(index: number) {
  audioTracks.value.splice(index, 1)
}

const subtitleOptions: Array<{ label: string; value: SubtitleMode }> = [
  { label: '不生成字幕', value: 'none' },
  { label: '烧录进画面', value: 'burn' },
  { label: '仅导出 SRT', value: 'srt' },
  { label: '烧录 + 导出 SRT', value: 'both' },
]

const fitOptions = [
  { label: 'cover（裁切填满）', value: 'cover' },
  { label: 'contain（留边）', value: 'contain' },
]

const trackKindOptions = [
  { label: '旁白 narration', value: 'narration' },
  { label: '背景乐 bgm', value: 'bgm' },
]

const insertRef = ref<string | null>(null)
const imageOptions = computed(() => props.assetOptions ?? [])

// 0.4 as soon as video/audio/narration/subtitles appear; 0.3 for asset://;
// inserting a slide/wipe into a 0.1 board promotes it to 0.2 (validator rules).
const schemaVersion = computed(() => {
  const needsV04 = scenes.value.some(scene =>
    scene.elements.some(element => element.type === 'video') || Boolean(scene.narrationText?.trim()),
  ) || audioTracks.value.length > 0 || subtitleMode.value !== 'none'
  if (needsV04) return '0.4'
  const hasAssetRef = scenes.value.some(scene =>
    scene.elements.some(element => typeof element.src === 'string' && element.src.startsWith('asset://')),
  )
  if (hasAssetRef) return '0.3'
  const hasV02Transition = scenes.value.some(scene => scene.transitionOut && scene.transitionOut.type !== 'fade')
  return hasV02Transition && props.storyboard.schemaVersion === '0.1' ? '0.2' : props.storyboard.schemaVersion
})

function insertAsset() {
  if (selected.value === null || !insertRef.value) return
  const scene = scenes.value[selected.value]
  scene.elements.push({
    type: 'image',
    src: insertRef.value,
    x: 'center',
    y: 0,
    width: props.storyboard.canvas.width,
    height: props.storyboard.canvas.height,
  })
  insertRef.value = null
}

function storyboardSnapshot(): Storyboard {
  const snapshot: Storyboard = {
    ...props.storyboard,
    schemaVersion: schemaVersion.value,
    scenes: structuredClone(scenes.value),
  }
  if (audioTracks.value.length > 0) snapshot.audioTracks = structuredClone(audioTracks.value)
  else delete snapshot.audioTracks
  if (subtitleMode.value !== 'none') {
    snapshot.subtitleOptions = {
      ...(props.storyboard.subtitleOptions ?? {}),
      mode: subtitleMode.value,
      source: props.storyboard.subtitleOptions?.source ?? 'auto',
    }
  } else {
    delete snapshot.subtitleOptions
  }
  return snapshot
}

function onSave() {
  const snapshot = storyboardSnapshot()
  lastEmitted = snapshot
  emit('update:storyboard', snapshot)
  emit('save')
}

const transitionOptions = [
  { label: 'fade（淡出）', value: 'fade' },
  { label: 'slide（滑出，v0.2）', value: 'slide' },
  { label: 'wipe（擦除，v0.2）', value: 'wipe' },
]
const directionOptions = [
  { label: 'left', value: 'left' },
  { label: 'right', value: 'right' },
  { label: 'up', value: 'up' },
  { label: 'down', value: 'down' },
]

function setTransitionType(type: 'fade' | 'slide' | 'wipe') {
  if (selected.value === null) return
  const scene = scenes.value[selected.value]
  scene.transitionOut = {
    type,
    direction: type === 'fade' ? undefined : 'left',
    durationMs: Math.min(scene.transitionOut?.durationMs ?? 300, scene.durationMs),
  }
}

function setTransitionDirection(direction: string) {
  if (selected.value === null) return
  const scene = scenes.value[selected.value]
  if (scene.transitionOut && scene.transitionOut.type !== 'fade') scene.transitionOut.direction = direction
}

function setTransitionDuration(ms: number | null) {
  if (selected.value === null || ms === null) return
  const scene = scenes.value[selected.value]
  if (scene.transitionOut) scene.transitionOut.durationMs = Math.max(0, Math.min(ms, scene.durationMs))
}

const totalSeconds = computed(() => (scenes.value.reduce((sum, scene) => sum + scene.durationMs, 0) / 1000).toFixed(1))

function excerpt(scene: Scene): string {
  const video = scene.elements.find(element => element.type === 'video')
  if (video) return `🎞 ${video.src ?? ''}${video.loop ? ' · loop' : ''}`
  const text = scene.elements.find(element => element.type === 'text') as { content?: string } | undefined
  if (text?.content) return text.content.slice(0, 40)
  return `${scene.elements.length} elements`
}
</script>

<template>
  <div class="canvas-shell">
    <div class="canvas-toolbar">
      <n-space align="center">
        <n-button size="tiny" @click="zoom(0.9)">−</n-button>
        <n-tag size="small">{{ Math.round(view.scale * 100) }}%</n-tag>
        <n-button size="tiny" @click="zoom(1.1)">＋</n-button>
        <n-button size="tiny" @click="fit">适应</n-button>
        <n-button size="tiny" @click="addScene">＋ 场景</n-button>
        <n-button size="tiny" :disabled="selected === null" @click="removeScene">删除所选</n-button>
        <n-tag size="small" :bordered="false">{{ scenes.length }} 幕 · {{ totalSeconds }}s</n-tag>
        <n-tag size="small" :bordered="false" type="info">schema {{ schemaVersion }}</n-tag>
        <n-button size="tiny" type="primary" :loading="saving" @click="onSave">保存（PUT 校验）</n-button>
      </n-space>
    </div>

    <div class="canvas-body">
      <div
        ref="viewportRef"
        class="canvas-viewport"
        @wheel="onWheel"
        @pointerdown="onViewportPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div class="canvas-world" :style="worldStyle">
          <div
            v-for="(scene, index) in scenes"
            :key="scene.id + index"
            class="scene-card"
            :class="{ selected: selected === index, dragging: drag?.kind === 'card' && drag.index === index }"
            :style="cardStyle(index)"
            @pointerdown="onCardPointerDown($event, index)"
          >
            <div class="card-head">
              <span class="mono">{{ scene.id }}</span>
              <n-tag size="tiny" :bordered="false">{{ scene.durationMs }}ms</n-tag>
            </div>
            <div class="card-body">{{ excerpt(scene) }}</div>
            <div class="card-foot">
              <n-tag size="tiny" :bordered="false" type="info">{{ scene.transitionOut?.type ?? 'cut' }}</n-tag>
              <span v-if="scene.transitionOut?.direction" class="muted">{{ scene.transitionOut.direction }}</span>
              <span class="muted">{{ scene.elements.length }} 元素</span>
              <n-tag v-if="scene.elements.some(element => element.type === 'video')" size="tiny" :bordered="false">视频</n-tag>
              <n-tag v-if="scene.narrationText" size="tiny" :bordered="false">旁白</n-tag>
            </div>
          </div>
          <svg v-if="scenes.length > 1" class="rail" :width="30 + scenes.length * (CARD_W + GAP)" height="600">
            <line
              v-for="index in scenes.length - 1"
              :key="index"
              :x1="30 + (index - 1) * (CARD_W + GAP) + CARD_W + 8"
              :y1="RAIL_Y + CARD_H / 2"
              :x2="30 + index * (CARD_W + GAP) - 8"
              :y2="RAIL_Y + CARD_H / 2"
              class="rail-line"
            />
          </svg>
        </div>
        <div class="canvas-hint">滚轮缩放 · 拖空白平移 · 拖卡片排序</div>
      </div>

      <div class="inspector">
        <n-card v-if="selectedScene" size="small" :title="`检查器 · ${selectedScene.id}`">
          <n-form size="small" label-placement="left" :label-width="72">
            <n-form-item label="时长">
              <n-input-number v-model:value="selectedScene.durationMs" :min="100" :max="60000" :step="100" style="width: 100%">
                <template #suffix>ms</template>
              </n-input-number>
            </n-form-item>
            <n-form-item label="旁白文本">
              <n-input
                v-model:value="selectedScene.narrationText"
                type="textarea"
                :rows="2"
                placeholder="自动字幕的唯一文本来源（0.4，≤500 字）"
              />
            </n-form-item>
            <template v-if="selectedVideo">
              <n-form-item label="视频适配">
                <n-select
                  :value="selectedVideo.fit ?? 'cover'"
                  :options="fitOptions"
                  @update:value="(value: 'cover' | 'contain') => setVideoFit(value)"
                />
              </n-form-item>
              <n-form-item label="裁切窗口">
                <n-space>
                  <n-input-number
                    :value="selectedVideo.trimStartMs ?? 0"
                    :min="0"
                    :step="100"
                    size="small"
                    style="width: 120px"
                    @update:value="(value: number | null) => setVideoTrim('start', value)"
                  >
                    <template #suffix>起 ms</template>
                  </n-input-number>
                  <n-input-number
                    :value="selectedVideo.trimEndMs ?? 0"
                    :min="0"
                    :step="100"
                    size="small"
                    style="width: 120px"
                    @update:value="(value: number | null) => setVideoTrim('end', value)"
                  >
                    <template #suffix>止 ms</template>
                  </n-input-number>
                </n-space>
              </n-form-item>
              <n-form-item label="视频开关">
                <n-space align="center">
                  <n-switch :value="selectedVideo.loop === true" size="small" @update:value="setVideoLoop">循环</n-switch>
                  <n-switch :value="selectedVideo.muted === false" size="small" @update:value="setVideoKeepAudio">保留原声</n-switch>
                </n-space>
              </n-form-item>
            </template>
            <n-form-item label="转场">
              <n-select
                :value="selectedScene.transitionOut?.type ?? 'fade'"
                :options="transitionOptions"
                @update:value="(type: string) => setTransitionType(type as 'fade' | 'slide' | 'wipe')"
              />
            </n-form-item>
            <n-form-item v-if="selectedScene.transitionOut && selectedScene.transitionOut.type !== 'fade'" label="方向">
              <n-select
                :value="selectedScene.transitionOut.direction ?? 'left'"
                :options="directionOptions"
                @update:value="setTransitionDirection"
              />
            </n-form-item>
            <n-form-item label="转场时长">
              <n-input-number
                :value="selectedScene.transitionOut?.durationMs ?? 0"
                :min="0"
                :max="selectedScene.durationMs"
                :step="50"
                style="width: 100%"
                @update:value="setTransitionDuration"
              >
                <template #suffix>ms</template>
              </n-input-number>
            </n-form-item>
            <n-form-item label="插素材">
              <n-space vertical style="width: 100%">
                <n-select
                  v-model:value="insertRef"
                  :options="imageOptions"
                  size="small"
                  filterable
                  clearable
                  :placeholder="imageOptions.length ? '选择已完成任务的图片' : '暂无已完成的图片任务'"
                  :disabled="imageOptions.length === 0"
                />
                <n-button size="tiny" :disabled="!insertRef" @click="insertAsset">插入图片元素（asset://）</n-button>
              </n-space>
            </n-form-item>
          </n-form>
          <div class="text-sm muted" style="margin-top: 8px">
            元素 {{ selectedScene.elements.length }} 个（可插入已完成任务的生成图片；文本/矩形编辑经 JSON）
          </div>
        </n-card>
        <n-card v-else size="small" title="检查器">
          <span class="muted text-sm">点击场景卡选中</span>
        </n-card>

        <n-card size="small" title="音轨与字幕（0.4）" style="margin-top: 8px">
          <n-form size="small" label-placement="left" :label-width="72">
            <n-form-item label="字幕">
              <n-select
                :value="subtitleMode"
                :options="subtitleOptions"
                @update:value="(value: SubtitleMode) => (subtitleMode = value)"
              />
            </n-form-item>
          </n-form>
          <div v-for="(track, index) in audioTracks" :key="`${track.kind}-${index}`" class="audio-track">
            <n-space justify="space-between" align="center">
              <n-tag size="tiny">{{ track.kind }}</n-tag>
              <span class="mono track-src">{{ track.src }}</span>
              <n-button size="tiny" @click="removeAudioTrack(index)">移除</n-button>
            </n-space>
            <n-space align="center" style="margin-top: 4px">
              <n-input-number
                :value="track.volume ?? 1"
                :min="0"
                :max="1"
                :step="0.05"
                size="tiny"
                style="width: 100px"
                @update:value="(value: number | null) => (track.volume = value ?? 1)"
              />
              <n-switch :value="track.loop === true" size="small" @update:value="(value: boolean) => (track.loop = value)">
                循环
              </n-switch>
            </n-space>
          </div>
          <n-space align="center" style="margin-top: 6px">
            <n-select v-model:value="newTrackKind" :options="trackKindOptions" size="tiny" style="width: 130px" />
            <n-input v-model:value="newTrackSrc" size="tiny" placeholder="voice/vo.mp3（assets 内）" style="width: 150px" />
            <n-button size="tiny" :disabled="!newTrackSrc.trim()" @click="addAudioTrack">添加音轨</n-button>
          </n-space>
          <div class="muted text-sm" style="margin-top: 6px">
            自动字幕读取各幕「旁白文本」；新增音轨/字幕会把分镜升到 schema 0.4。
          </div>
        </n-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas-shell { display: flex; flex-direction: column; gap: 8px; height: 600px; }
.canvas-toolbar { display: flex; }
.canvas-body { display: flex; gap: 10px; flex: 1; min-height: 0; }
.canvas-viewport {
  position: relative; flex: 1; overflow: hidden; border-radius: 8px;
  background: repeating-conic-gradient(rgba(128,128,140,0.08) 0% 25%, transparent 0% 50%) 50% / 24px 24px;
  touch-action: none; cursor: grab;
}
.canvas-viewport:active { cursor: grabbing; }
.canvas-world { position: absolute; inset: 0; will-change: transform; }
.scene-card {
  position: absolute; border-radius: 10px; padding: 10px; cursor: grab; user-select: none;
  background: var(--card-bg, rgba(30, 36, 52, 0.95)); border: 1px solid rgba(128,128,140,0.35);
  box-shadow: 0 4px 14px rgba(0,0,0,0.25);
}
.scene-card.selected { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.4); }
.scene-card.dragging { opacity: 0.85; cursor: grabbing; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.card-body { margin: 8px 0; font-size: 12px; min-height: 42px; opacity: 0.9; }
.card-foot { display: flex; gap: 6px; align-items: center; font-size: 11px; }
.mono { font-family: ui-monospace, monospace; font-size: 11px; }
.muted { color: rgba(128,128,140,0.9); font-size: 11px; }
.rail { position: absolute; left: 0; top: 0; pointer-events: none; }
.rail-line { stroke: rgba(56,189,248,0.55); stroke-width: 2; stroke-dasharray: 6 5; }
.canvas-hint { position: absolute; right: 10px; bottom: 8px; font-size: 11px; color: rgba(128,128,140,0.8); pointer-events: none; }
.inspector { width: 300px; overflow: auto; }
.audio-track {
  margin-top: 6px; padding: 6px 8px; border-radius: 6px;
  background: rgba(128, 128, 140, 0.1); border: 1px solid rgba(128, 128, 140, 0.2);
}
.track-src { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text-sm { font-size: 12px; }
</style>
