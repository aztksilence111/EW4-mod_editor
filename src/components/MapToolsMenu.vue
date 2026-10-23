<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  terrainMode: boolean
  clipActive: boolean
}>()

const emit = defineEmits<{
  (e: 'open-map-select'): void
  (e: 'toggle-terrain-mode'): void
  (e: 'start-clip'): void
  (e: 'cancel-clip'): void
  (e: 'export-terrain-bin'): void
}>()

const open = ref(false)

function toggle() {
  open.value = !open.value
}

function pick(action: () => void) {
  action()
  open.value = false
}
</script>

<template>
  <div class="tools-wrap">
    <button class="btn" @click="toggle">地图工具 ▾</button>
    <div v-if="open" class="dropdown">
      <button class="dropdown-item" @click="pick(() => emit('open-map-select'))">
        选择地图
      </button>
      <button
        class="dropdown-item"
        :class="{ active: terrainMode }"
        @click="pick(() => emit('toggle-terrain-mode'))"
      >
        {{ terrainMode ? '✓ 地形模式' : '地形模式' }}
      </button>
      <button
        class="dropdown-item"
        :disabled="clipActive"
        @click="pick(() => emit('start-clip'))"
      >
        截取地图
      </button>
      <button
        v-if="clipActive"
        class="dropdown-item danger"
        @click="pick(() => emit('cancel-clip'))"
      >
        取消截取
      </button>
      <button
        v-if="terrainMode"
        class="dropdown-item accent"
        @click="pick(() => emit('export-terrain-bin'))"
      >
        导出地图 bin
      </button>
    </div>
  </div>
</template>

<style scoped>
.tools-wrap { position: relative; }
.btn {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #4b5563;
  background: #374151;
  color: #e5e7eb;
  font-size: 13px;
  cursor: pointer;
}
.dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  min-width: 160px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
  z-index: 100;
  overflow: hidden;
}
.dropdown-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: #e5e7eb;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.dropdown-item:hover { background: #374151; }
.dropdown-item:disabled { opacity: 0.4; cursor: not-allowed; }
.dropdown-item.active { color: #93c5fd; font-weight: 600; }
.dropdown-item.accent { color: #fbbf24; }
.dropdown-item.danger { color: #f87171; }
</style>