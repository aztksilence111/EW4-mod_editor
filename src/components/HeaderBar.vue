<script setup lang="ts">
import { computed } from 'vue'
import type { BtlProject } from '../core/formats/types'

const props = defineProps<{
  project: BtlProject | null
}>()

const emit = defineEmits<{
  (e: 'change'): void
}>()

const info = computed(() => props.project?.info ?? null)

function setField(field: string, e: Event) {
  if (!props.project) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  ;(props.project.info as any)[field] = isNaN(v) ? 0 : v
  emit('change')
}

function setFloat(field: string, e: Event) {
  if (!props.project) return
  const v = parseFloat((e.target as HTMLInputElement).value)
  ;(props.project.info as any)[field] = isNaN(v) ? 0 : v
  emit('change')
}
</script>

<template>
  <div class="header-bar">
    <div v-if="!info" class="empty">未导入 BTL</div>
    <template v-else>
      <div class="item">
        <label>胜利条件</label>
        <input type="number" :value="info.victoryType" @change="(e) => setField('victoryType', e)" />
      </div>
      <div class="item">
        <label>胜利回合</label>
        <input type="number" :value="info.victoryRound" @change="(e) => setField('victoryRound', e)" />
      </div>
      <div class="item">
        <label>重大胜利回合</label>
        <input type="number" :value="info.greatVictoryRound" @change="(e) => setField('greatVictoryRound', e)" />
      </div>
      <div class="item">
        <label>军团长</label>
        <input type="number" :value="info.commander" @change="(e) => setField('commander', e)" />
      </div>
      <div class="item">
        <label>地图X</label>
        <input type="number" :value="info.mapX" @change="(e) => setField('mapX', e)" />
      </div>
      <div class="item">
        <label>地图Y</label>
        <input type="number" :value="info.mapY" @change="(e) => setField('mapY', e)" />
      </div>
      <div class="item">
        <label>地图宽</label>
        <input type="number" :value="info.mapW" @change="(e) => setField('mapW', e)" />
      </div>
      <div class="item">
        <label>地图高</label>
        <input type="number" :value="info.mapH" @change="(e) => setField('mapH', e)" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.header-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 6px 10px;
  background: #1f2937;
  border-bottom: 1px solid #374151;
  font-size: 12px;
  scrollbar-width: none;
}
.header-bar::-webkit-scrollbar { display: none; }
.empty { color: #6b7280; padding: 2px 6px; }
.item {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.item label { color: #9ca3af; font-size: 11px; white-space: nowrap; }
.item input {
  width: 70px;
  padding: 3px 5px;
  border: 1px solid #4b5563;
  border-radius: 3px;
  background: #111827;
  color: #e5e7eb;
  font-size: 12px;
  box-sizing: border-box;
}
.item input:focus { outline: none; border-color: #2563eb; }
</style>