<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  title: string
  initialWidth?: number
  initialHeight?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const x = ref(40)
const y = ref(80)
const width = ref(400)
const height = ref(320)

let dragging = false
let dragStartX = 0
let dragStartY = 0
let dragStartFrameX = 0
let dragStartFrameY = 0

let resizing = false
let resizeStartX = 0
let resizeStartY = 0
let resizeStartW = 0
let resizeStartH = 0

function getLayout() {
  const vw = window.innerWidth
  const vh = window.innerHeight

  const topbar = document.querySelector('.topbar') as HTMLElement | null
  const infoRow = document.querySelector('.info-row') as HTMLElement | null
  const bottomTabs = document.querySelector('.tabs') as HTMLElement | null

  const topH = (topbar?.offsetHeight ?? 0) + (infoRow?.offsetHeight ?? 0)
  const bottomH = bottomTabs?.offsetHeight ?? 0
  const topPad = topH > 0 ? 6 : 8
  const bottomPad = bottomH > 0 ? 6 : 8

  return {
    vw,
    vh,
    top: topH + topPad,
    bottom: vh - bottomH - bottomPad,
  }
}

function initSize() {
  const { vw, vh, top, bottom } = getLayout()
  const usableW = vw - 16
  const usableH = Math.max(200, bottom - top)

  const w = Math.min(props.initialWidth ?? 640, usableW)
  const h = Math.min(props.initialHeight ?? 540, usableH)

  width.value = w
  height.value = h
  x.value = Math.max(8, Math.floor((vw - w) / 2))
  y.value = top + Math.floor((usableH - h) / 2)
}

function onTitleDown(e: PointerEvent) {
  dragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartFrameX = x.value
  dragStartFrameY = y.value
  try {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  } catch {}
}

function onTitleMove(e: PointerEvent) {
  if (!dragging) return
  const { vw, top, bottom } = getLayout()
  let nx = dragStartFrameX + (e.clientX - dragStartX)
  let ny = dragStartFrameY + (e.clientY - dragStartY)
  nx = Math.max(-width.value + 60, Math.min(vw - 60, nx))
  ny = Math.max(top - 20, Math.min(bottom - 40, ny))
  x.value = nx
  y.value = ny
}

function onTitleUp(e: PointerEvent) {
  dragging = false
  try {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {}
}

function onResizeDown(e: PointerEvent) {
  e.stopPropagation()
  e.preventDefault()
  resizing = true
  resizeStartX = e.clientX
  resizeStartY = e.clientY
  resizeStartW = width.value
  resizeStartH = height.value
  try {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  } catch {}
}

function onResizeMove(e: PointerEvent) {
  if (!resizing) return
  const { vw, bottom } = getLayout()
  const w = Math.max(240, Math.min(vw - x.value - 4, resizeStartW + (e.clientX - resizeStartX)))
  const h = Math.max(160, Math.min(bottom - y.value, resizeStartH + (e.clientY - resizeStartY)))
  width.value = w
  height.value = h
}

function onResizeUp(e: PointerEvent) {
  resizing = false
  try {
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {}
}

function onWindowResize() {
  const { vw, vh, top, bottom } = getLayout()
  if (x.value + width.value > vw) width.value = Math.max(240, vw - x.value - 4)
  if (y.value + height.value > bottom) {
    height.value = Math.max(160, bottom - y.value)
  }
  if (y.value < top) y.value = top
  if (y.value + height.value > vh) height.value = Math.max(160, vh - y.value - 4)
}

onMounted(() => {
  initSize()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('orientationchange', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('orientationchange', onWindowResize)
})
</script>

<template>
  <div
    class="window-frame"
    :style="{
      left: x + 'px',
      top: y + 'px',
      width: width + 'px',
      height: height + 'px',
    }"
  >
    <div
      class="title-bar"
      @pointerdown="onTitleDown"
      @pointermove="onTitleMove"
      @pointerup="onTitleUp"
      @pointercancel="onTitleUp"
    >
      <span class="title-text">{{ title }}</span>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>
    <div class="frame-body">
      <slot />
    </div>
    <div
      class="resize-handle"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeUp"
      @pointercancel="onResizeUp"
    ></div>
  </div>
</template>

<style scoped>
.window-frame {
  position: fixed;
  display: flex;
  flex-direction: column;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  z-index: 80;
}

.title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #111827;
  border-bottom: 1px solid #374151;
  cursor: move;
  touch-action: none;
  user-select: none;
  flex-shrink: 0;
}

.title-text {
  font-size: 13px;
  font-weight: 600;
  color: #f3f4f6;
}

.close-btn {
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 22px;
  line-height: 1;
  padding: 0 6px;
  cursor: pointer;
}

.close-btn:hover { color: #f87171; }

.frame-body {
  flex: 1 1 auto;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  touch-action: none;
  background:
    linear-gradient(135deg,
      transparent 45%,
      #6b7280 45%, #6b7280 55%,
      transparent 55%, transparent 65%,
      #6b7280 65%, #6b7280 75%,
      transparent 75%);
}
</style>