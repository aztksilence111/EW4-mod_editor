<script setup lang="ts">
import { computed } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import { conditionLabels, victoryLabels, conditionFields, createCondition, type EventNode, type EventDocument } from '../core/editor/events'
import EventRuleFields from './EventRuleFields.vue'
const props = defineProps<{ node: EventNode; document: EventDocument; eventIds: string[]; cells: number[]; victory?: boolean; depth?: number }>()
const labels = computed(() => props.victory ? victoryLabels : conditionLabels)
const compound = computed(() => ['all','any','not'].includes(props.node.type))
const fields = computed(() => !props.victory ? conditionFields(props.node.type) : ({ factions_defeated: ['factions'], units_destroyed: ['units'], units_lost: ['units'], cells_owned: ['cells'], cells_lost: ['cells'], round_reached: ['round'], script: ['script','function'] }[props.node.type] ?? []))
function change(event: Event) {
  const type = (event.target as HTMLSelectElement).value
  for (const key of Object.keys(props.node)) delete props.node[key]
  Object.assign(props.node, props.victory ? { type, ...(['all','any'].includes(type) ? { conditions: [{ type: 'enemy_factions_defeated' }] } : type === 'resources' ? { resources: { money: 0, industry: 0, food: 0 } } : type === 'round_reached' ? { round: 1 } : {}) } : createCondition(type))
}
</script>
<template>
  <div class="condition-tree">
    <select :value="node.type" aria-label="胜负条件类型" v-if="victory" @change="change"><option v-for="(label, type) in labels" :key="type" :value="type">{{ label }}</option></select>
    <select v-else :value="node.type" aria-label="触发条件类型" @change="change"><option v-for="(label, type) in labels" :key="type" :value="type">{{ label }}</option></select>
    <template v-if="compound"><div v-for="(child, i) in node.conditions" :key="i" class="condition-child"><EventConditionTree :node="child" :document="document" :event-ids="eventIds" :cells="cells" :victory="victory" :depth="(depth ?? 0) + 1" /><button title="移除子条件" :disabled="node.conditions.length <= 1" @click="node.conditions.splice(i, 1)"><X :size="15" /></button></div><button v-if="node.type !== 'not'" :disabled="(depth ?? 0) >= 10" @click="node.conditions.push(victory ? { type: 'enemy_factions_defeated' } : createCondition())"><Plus :size="15" />子条件</button></template>
    <EventRuleFields v-else :node="node" :fields="fields" :document="document" :event-ids="eventIds" :cells="cells" />
    <div v-if="victory && node.type === 'resources'" class="resources"><label v-for="(label, key) in { money: '金币', industry: '工业', food: '粮食' }" :key="key">{{ label }}<input v-model.number="node.resources[key]" type="number" min="0" /></label></div>
  </div>
</template>
<style scoped>
.condition-tree { min-width:0; flex:1; }select,input,button { box-sizing:border-box; max-width:100%; min-width:0; min-height:32px; padding:5px 7px; font:12px system-ui; color:#253237; background:white; border:1px solid #bcc9c9; border-radius:4px; }button { display:inline-flex; align-items:center; gap:4px; cursor:pointer; }.condition-child { display:flex; align-items:flex-start; gap:6px; margin:8px 0 8px 5px; padding-left:10px; border-left:2px solid #afc9bb; }.condition-child>button { flex:none; }.resources { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }.resources label { display:flex; flex-direction:column; gap:4px; flex:1; min-width:65px; }.resources input { width:100%; }
</style>
