<script setup lang="ts">
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-vue-next'
import { effectLabels, effectFields, createEffect, type EventNode, type EventDocument } from '../core/editor/events'
import EventRuleFields from './EventRuleFields.vue'
import EventConditionTree from './EventConditionTree.vue'
const props = defineProps<{ effects: EventNode[]; document: EventDocument; eventIds: string[]; cells: number[] }>()
function change(index: number, event: Event) { props.effects[index] = createEffect((event.target as HTMLSelectElement).value) }
function move(index: number, step: number) { const other = index + step; [props.effects[index], props.effects[other]] = [props.effects[other]!, props.effects[index]!] }
</script>
<template>
  <div class="event-effects"><section v-for="(effect, i) in effects" :key="i"><div class="effect-heading"><span>{{ i + 1 }}</span><select :value="effect.type" aria-label="事件效果类型" @change="change(i, $event)"><option v-for="(label, type) in effectLabels" :key="type" :value="type">{{ label }}</option></select><button title="上移效果" :disabled="i === 0" @click="move(i, -1)"><ArrowUp :size="14" /></button><button title="下移效果" :disabled="i === effects.length - 1" @click="move(i, 1)"><ArrowDown :size="14" /></button><button title="删除效果" @click="effects.splice(i, 1)"><Trash2 :size="14" /></button></div><EventRuleFields :node="effect" :fields="effectFields(effect.type)" :document="document" :event-ids="eventIds" :cells="cells" />
    <details v-if="!['player_control','victory_rules','victory_default','ending','faction_create','faction_identity'].includes(effect.type)"><summary>Lua 处理器</summary><EventRuleFields :node="effect" :fields="['script','function']" :document="document" :event-ids="eventIds" :cells="cells" /></details>
    <div v-if="effect.type === 'victory_rules'" class="victory"><label>判定优先<select v-model="effect.victoryRules.priority"><option value="defeat">失败</option><option value="victory">胜利</option></select></label><h4>胜利条件</h4><EventConditionTree :node="effect.victoryRules.win" :document="document" :event-ids="eventIds" :cells="cells" victory /><label><input type="checkbox" :checked="!!effect.victoryRules.lose" @change="effect.victoryRules.lose = ($event.target as HTMLInputElement).checked ? { type: 'round_reached', round: 30 } : undefined" />失败条件</label><EventConditionTree v-if="effect.victoryRules.lose" :node="effect.victoryRules.lose" :document="document" :event-ids="eventIds" :cells="cells" victory /></div>
  </section><button @click="effects.push(createEffect())"><Plus :size="15" />效果</button></div>
</template>
<style scoped>
.event-effects { display:flex; flex-direction:column; gap:10px; }section { border-bottom:1px solid #d7dfdb; padding-bottom:8px; min-width:0; }.effect-heading { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }.effect-heading select { flex:1; }.effect-heading span { width:18px; }button,select { box-sizing:border-box; max-width:100%; min-width:0; min-height:32px; padding:5px 7px; font:12px system-ui; color:#253237; background:white; border:1px solid #bcc9c9; border-radius:4px; }button { display:inline-flex; align-items:center; justify-content:center; gap:4px; cursor:pointer; }.event-effects>button { align-self:flex-start; }summary { font-size:12px; cursor:pointer; }.victory { padding-left:10px; border-left:2px solid #c2b16e; }h4 { font-size:12px; margin:10px 0; }.victory>label { display:flex; align-items:center; gap:6px; margin:8px 0; }
</style>
