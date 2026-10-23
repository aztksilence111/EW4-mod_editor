<script setup lang="ts">
import {
  CONQUEST_MAPS,
  CONQUEST_DEFAULT_AGES,
} from '../core/data/battleList'
import { getBattleTitle } from '../core/data/config'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', file: string): void
}>()

function conquestTitle(ageKey: string, idx: number): string {
  const custom = getBattleTitle(ageKey)
  if (custom && custom !== ageKey) return custom
  return CONQUEST_DEFAULT_AGES[idx] ?? `征服 ${idx + 1}`
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span>选择征服</span>
        <button class="close" @click="emit('close')">×</button>
      </div>
      <div class="body">
        <div
          v-for="(c, i) in CONQUEST_MAPS"
          :key="c.id"
          class="row"
          @click="emit('pick', c.file)"
        >
          <span class="id">{{ c.id }}</span>
          <span class="name">{{ conquestTitle(c.ageKey, i) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.dialog {
  background: #1f2937; border: 1px solid #374151; border-radius: 8px;
  width: min(420px, 92vw); overflow: hidden;
  box-shadow: 0 12px 32px rgba(0,0,0,0.6);
}
.head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: #111827;
  border-bottom: 1px solid #374151; font-weight: 600; color: #f3f4f6;
}
.close {
  border: none; background: transparent; color: #9ca3af;
  font-size: 22px; line-height: 1; padding: 0 6px; cursor: pointer;
}
.close:hover { color: #f87171; }
.body { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.row {
  display: flex; gap: 10px; align-items: center;
  padding: 10px 14px; background: #111827; border: 1px solid #374151;
  border-radius: 6px; cursor: pointer;
}
.row:hover { background: #1e3a8a; border-color: #2563eb; }
.id { color: #fbbf24; font-weight: 600; min-width: 20px; text-align: center; }
.name { color: #e5e7eb; }
</style>