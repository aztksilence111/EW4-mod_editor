<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { BinProject } from '../core/formats/types'
import { BUILTIN_MAPS } from '../core/data/builtinMaps'

const props = defineProps<{
  currentTerrain: BinProject | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick-builtin', file: string): void
  (e: 'pick-file', file: File): void
}>()

const LAST_KEY = 'ew4-last-map'
const lastChoice = ref('')

onMounted(() => {
  lastChoice.value = localStorage.getItem(LAST_KEY) ?? ''
})

function chooseBuiltin(file: string, mapId: number) {
  localStorage.setItem(LAST_KEY, `builtin:${mapId}`)
  lastChoice.value = `builtin:${mapId}`
  emit('pick-builtin', file)
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  localStorage.setItem(LAST_KEY, `file:${file.name}`)
  lastChoice.value = `file:${file.name}`
  emit('pick-file', file)
}

function isBuiltinActive(mapId: number) {
  return lastChoice.value === `builtin:${mapId}`
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-head">
        <span>选择地图</span>
        <button class="close" @click="emit('close')">×</button>
      </div>
      <div class="dialog-body">
        <div class="hint" v-if="currentTerrain">
          当前地形：{{ currentTerrain.info.mapW }}×{{ currentTerrain.info.mapH }}
        </div>
        <div class="hint" v-else>
          尚未加载地形，请选择一张地图开始编辑。
        </div>

        <div class="section-title">内置地图</div>
        <div class="builtin-list">
          <button
            v-for="m in BUILTIN_MAPS"
            :key="m.id"
            class="builtin-btn"
            :class="{ active: isBuiltinActive(m.id) }"
            @click="chooseBuiltin(m.file, m.id)"
          >
            <span class="builtin-label">{{ m.name }}</span>
            <span v-if="isBuiltinActive(m.id)" class="tag">上次选择</span>
          </button>
        </div>

        <div class="section-title">导入本地 .bin</div>
        <label class="btn">
          选择文件...
          <input type="file" accept=".bin,application/octet-stream" style="display:none"
                 @change="onFileChange" />
        </label>
        <div v-if="lastChoice.startsWith('file:')" class="last-file">
          上次导入：{{ lastChoice.replace('file:', '') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.dialog {
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 8px;
  min-width: 320px;
  max-width: 90vw;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
}
.dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #111827;
  border-bottom: 1px solid #374151;
  font-weight: 600;
  color: #f3f4f6;
}
.close {
  border: none; background: transparent; color: #9ca3af;
  font-size: 22px; line-height: 1; padding: 0 6px; cursor: pointer;
}
.close:hover { color: #f87171; }
.dialog-body { padding: 12px 14px; overflow-y: auto; }
.hint { color: #9ca3af; font-size: 12px; margin-bottom: 8px; }
.section-title {
  color: #93c5fd;
  font-weight: 600;
  font-size: 12px;
  margin: 12px 0 6px;
}
.builtin-list { display: flex; flex-direction: column; gap: 6px; }
.builtin-btn {
  padding: 10px 12px;
  border: 1px solid #4b5563;
  background: #374151;
  color: #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.builtin-btn:hover { background: #4b5563; }
.builtin-btn.active {
  border-color: #2563eb;
  background: #1e3a8a;
}
.tag {
  font-size: 11px;
  color: #93c5fd;
  border: 1px solid #2563eb;
  border-radius: 10px;
  padding: 1px 6px;
}
.btn {
  display: inline-block;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid #4b5563;
  background: #374151;
  color: #e5e7eb;
  font-size: 13px;
  cursor: pointer;
  margin-top: 4px;
}
.last-file {
  margin-top: 6px;
  font-size: 11px;
  color: #6b7280;
  word-break: break-all;
}
</style>