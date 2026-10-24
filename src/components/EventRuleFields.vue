<script setup lang="ts">
import type { EventDocument, EventNode } from '../core/editor/events'
import { fieldLabels } from '../core/editor/events'
const props = defineProps<{ node: EventNode; fields: string[]; document: EventDocument; eventIds: string[]; cells: number[] }>()
function value(key: string, event: Event) {
  const text = (event.target as HTMLInputElement).value
  if (['cells','factions','units'].includes(key)) props.node[key] = text.trim() ? text.split(/[,\s]+/).map(v => key === 'cells' ? Number(v) : v) : []
  else if (['value','round'].includes(key)) props.node[key] = Number(text)
  else if (text) props.node[key] = text
  else delete props.node[key]
}
</script>
<template>
  <div class="event-fields">
    <label v-for="key in fields" :key="key">{{ fieldLabels[key] || key }}
      <select v-if="key === 'compare'" :value="node[key] ?? 'ge'" :aria-label="fieldLabels[key]" @change="value(key, $event)"><option value="eq">等于</option><option value="ne">不等于</option><option value="gt">大于</option><option value="ge">大于等于</option><option value="lt">小于</option><option value="le">小于等于</option></select>
      <select v-else-if="key === 'relation' || key === 'outcome'" :value="node[key]" :aria-label="fieldLabels[key]" @change="value(key, $event)"><option v-for="v in key === 'outcome' ? ['victory','defeat'] : ['allied','neutral','hostile','default']" :key="v">{{ v }}</option></select>
      <select v-else-if="key === 'key' && ['event_completed','event_count'].includes(node.type)" :value="node.key" aria-label="前置事件" @change="value(key, $event)"><option value="">选择事件</option><option v-for="id in eventIds" :key="id">{{ id }}</option></select>
      <template v-else><input :value="Array.isArray(node[key]) ? node[key].join(', ') : node[key]" :type="['value','round'].includes(key) ? 'number' : 'text'" :aria-label="fieldLabels[key] || key" :placeholder="key === 'faction' ? '@player' : key === 'cells' ? '0, 1, 2' : ''" :list="['faction','otherFaction','templateFaction'].includes(key) ? 'event-factions' : key === 'unit' ? 'event-units' : undefined" @input="value(key, $event)" /><button v-if="key === 'cells'" type="button" :disabled="!cells.length" @click="node.cells = [...cells]">选区 {{ cells.length }} 格</button></template>
    </label>
  </div>
</template>
<style scoped>
.event-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:8px 0; }label { display:flex; flex-direction:column; gap:4px; min-width:0; font-size:12px; }input,select,button { width:100%; min-width:0; box-sizing:border-box; min-height:32px; border:1px solid #bcc9c9; border-radius:4px; padding:5px 7px; background:white; color:#253237; font:inherit; }button { cursor:pointer; }@media(max-width:500px) { .event-fields { grid-template-columns:1fr; } }
</style>
