<script setup lang="ts">
// Infinite-canvas storyboard editor (v3 plan §17 P5 "无限画布").
// Scene cards live on a transform layer (translate + scale): wheel zooms
// around the cursor, drag on the canvas pans, dragging a card reorders the
// scene array by horizontal position (drop snaps to the rail). The inspector
// edits duration and v0.2 transitions (fade / slide / wipe + direction);
// Save issues PUT /api/media/tasks/:id/storyboard — server-side validation
// is the gate, client errors surface verbatim.
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NForm, NFormItem, NInput, NInputNumber, NSelect, NSpace, NTag } from 'naive-ui'

interface SceneElement {
  type: 'text' | 'rect' | 'image'
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
}

interface Scene {
  id: string
  durationMs: number
  elements: SceneElement[]
  transitionOut?: { type: 'fade' | 'slide' | 'wipe'; direction?: string; durationMs: number }
}

interface Storyboard {
  schemaVersion: string
  title?: string
  canvas: { width: number; height: number; fps: number; background: string }
  scenes: Scene[]
  subtitles?: Array<{ startMs: number; endMs: number; text: string }>
}

const props = defineProps<{
  storyboard: Storyboard
  saving?: boolean
}>()

const emit = defineEmits<{
  save: []
}>()

const CARD_W = 220
const CARD_H = 132
const GAP = 56
const RAIL_Y = 90

const view = reactive({ x: 40, y: 20, scale: 0.8 })
const scenes = ref<Scene[]>(structuredClone(props.storyboard.scenes))
const selected = ref<number | null>(null)
const drag = ref<null | { kind: 'pan' | 'card'; index?: number; startX: number; startY: number; originX: number; originY: number; cardX?: number; cardY?: number; moved?: boolean }>(null)
const cardPositions = ref<Array<{ x: number; y: number }>>([])

watch(
  () => props.storyboard,
  value => {
    scenes.value = structuredClone(value.scenes)
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
  const text = scene.elements.find(element => element.type === 'text') as { content?: string } | undefined
  return text?.content ? text.content.slice(0, 40) : `${scene.elements.length} elements`
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
        <n-tag size="small" :bordered="false" type="info">schema {{ storyboard.schemaVersion }}</n-tag>
        <n-button size="tiny" type="primary" :loading="saving" @click="emit('save')">保存（PUT 校验）</n-button>
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
          </n-form>
          <div class="text-sm muted" style="margin-top: 8px">
            元素 {{ selectedScene.elements.length }} 个（元素级编辑经 JSON/后续版本；此处管结构与时序）
          </div>
        </n-card>
        <n-card v-else size="small" title="检查器">
          <span class="muted text-sm">点击场景卡选中</span>
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
.text-sm { font-size: 12px; }
</style>
