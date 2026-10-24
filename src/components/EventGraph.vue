<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { VueFlow, Handle, Position, MarkerType, useVueFlow, type Connection, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { GitBranch, Trash2, Network, Plus } from 'lucide-vue-next'
import { dependencies, type ScriptEvent, type EventGraph, type EventLink } from '../core/editor/events'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

const props = defineProps<{ events: ScriptEvent[]; graph: EventGraph; selected?: string; disabled: boolean }>()
const emit = defineEmits<{ select: [id: string]; graph: [graph: EventGraph]; add: [] }>()
const nodes = ref<Node[]>([])
const selectedEdge = ref('')
const target = ref('')
const kind = ref<'condition' | 'result'>('condition')
const choice = ref('')
const { fitView } = useVueFlow()
const current = computed(() => props.events.find(e => e.id === props.selected))
const activeEdge = computed(() => props.graph.links.find(e => e.id === selectedEdge.value))
const edgeChoices = computed(() => props.events.find(e => e.id === activeEdge.value?.source)?.popup?.choices ?? [])
const edges = computed(() => [
  ...props.graph.links.map(link => ({ id: link.id, source: link.source, target: link.target, sourceHandle: link.kind === 'condition' ? 'condition' : link.choice ? 'choice:' + link.choice : 'result',
    label: link.kind === 'condition' ? '完成条件' : link.choice ? '选项 · ' + link.choice : '结果触发', markerEnd: MarkerType.ArrowClosed,
    selected: selectedEdge.value === link.id, style: { stroke: link.kind === 'condition' ? '#287e71' : '#b26a27', strokeWidth: 2 }, labelStyle: { fill: '#334947', fontSize: 11 } })),
  ...props.events.flatMap(event => dependencies(event).filter(id => props.events.some(e => e.id === id) && !props.graph.links.some(e => e.source === id && e.target === event.id && e.kind === 'condition')).map(id => ({ id: 'ref:' + id + ':' + event.id, source: id, target: event.id, sourceHandle: 'condition', label: '条件引用', markerEnd: MarkerType.ArrowClosed, style: { stroke: '#68838b', strokeDasharray: '5 4' } }))),
])
watch(() => [props.events.map(e => [e.id, e.popup?.title, e.popup?.choices.map(c => [c.id, c.text])]), props.graph.positions, props.selected], () => {
  nodes.value = props.events.map((event, i) => ({ id: event.id, type: 'event', position: props.graph.positions[event.id] ?? { x: 70 + Math.floor(i / 4) * 340, y: 70 + i % 4 * 260 },
    data: { event }, selected: event.id === props.selected, draggable: !props.disabled, deletable: false }))
}, { immediate: true, deep: true })
function update(patch: Partial<EventGraph>) { emit('graph', { ...props.graph, ...patch }) }
function connect(connection: Connection) {
  if (props.disabled || !connection.source || !connection.target || connection.source === connection.target) return
  const handle = connection.sourceHandle ?? 'condition'
  const link: EventLink = { id: crypto.randomUUID(), source: connection.source, target: connection.target, kind: handle === 'condition' ? 'condition' : 'result' }
  if (handle.startsWith('choice:')) link.choice = handle.slice(7)
  if (props.graph.links.some(e => e.source === link.source && e.target === link.target && e.kind === link.kind && e.choice === link.choice)) return
  update({ links: [...props.graph.links, link] }); selectedEdge.value = link.id
}
function quickConnect() { if (props.selected && target.value) connect({ source: props.selected, target: target.value, sourceHandle: kind.value === 'condition' ? 'condition' : choice.value ? 'choice:' + choice.value : 'result', targetHandle: null }) }
async function layout() {
  const depths = new Map<string, number>()
  function depth(id: string, seen = new Set<string>()): number {
    if (seen.has(id)) return 0
    if (depths.has(id)) return depths.get(id)!
    const event = props.events.find(e => e.id === id)
    const parents = [...props.graph.links.filter(e => e.target === id).map(e => e.source), ...dependencies(event)]
    const value = parents.length ? 1 + Math.max(...parents.map(p => depth(p, new Set([...seen, id])))) : 0
    depths.set(id, value); return value
  }
  const counts = new Map<number, number>()
  const positions = Object.fromEntries(props.events.map(event => { const d = depth(event.id), row = counts.get(d) ?? 0; counts.set(d, row + 1); return [event.id, { x: 70 + d * 340, y: 70 + row * 280 }] }))
  update({ positions }); await nextTick(); fitView({ padding: .15, duration: 200 })
}
function changeLink(key: 'kind' | 'choice', value: string) {
  update({ links: props.graph.links.map(e => e.id === selectedEdge.value ? { ...e, [key]: value, ...(key === 'kind' ? { choice: undefined } : {}) } as EventLink : e) })
}
</script>

<template>
  <div class="graph-surface">
    <div class="graph-tools"><button title="添加事件" :disabled="disabled" @click="emit('add')"><Plus :size="16" /></button><button title="自动排列" :disabled="disabled || !events.length" @click="layout"><Network :size="16" /></button><span>{{ events.length }} 个事件 · {{ graph.links.length }} 条连线</span></div>
    <div class="flow-canvas" aria-label="事件连线画布">
      <VueFlow v-model:nodes="nodes" :edges="edges" :min-zoom=".15" :max-zoom="2" :delete-key-code="null" :nodes-connectable="!disabled" :edges-updatable="false" fit-view-on-init @connect="connect" @node-click="emit('select', $event.node.id)" @node-drag-stop="update({ positions: { ...graph.positions, [$event.node.id]: { ...$event.node.position } } })" @edge-click="selectedEdge = $event.edge.id">
        <Background :gap="24" pattern-color="#bdcbc7" :size="1" />
        <Controls :show-interactive="false" />
        <template #node-event="{ data, selected: active }"><div class="event-block" :class="{ active }"><Handle type="target" :position="Position.Left" /><div class="event-title"><GitBranch :size="16" /><strong>{{ data.event.popup?.title || data.event.id }}</strong></div><small>{{ data.event.id }}</small><div class="event-port">完成条件<Handle id="condition" type="source" :position="Position.Right" /></div><div class="event-port result">执行结果<Handle id="result" type="source" :position="Position.Right" /></div><div v-for="c in data.event.popup?.choices" :key="c.id" class="event-port choice">{{ c.text || c.id }}<Handle :id="'choice:' + c.id" type="source" :position="Position.Right" /></div></div></template>
      </VueFlow>
    </div>
    <div v-if="activeEdge" class="connection-editor"><strong>{{ activeEdge.source }} → {{ activeEdge.target }}</strong><select :value="activeEdge.kind" aria-label="连线类型" :disabled="disabled" @change="changeLink('kind', ($event.target as HTMLSelectElement).value)"><option value="condition">前置完成条件</option><option value="result">结果触发</option></select><select v-if="activeEdge.kind === 'result'" :value="activeEdge.choice ?? ''" aria-label="连线来源选项" :disabled="disabled" @change="changeLink('choice', ($event.target as HTMLSelectElement).value)"><option value="">公共结果</option><option v-for="c in edgeChoices" :key="c.id" :value="c.id">{{ c.text || c.id }}</option></select><button title="删除连线" :disabled="disabled" @click="update({ links: graph.links.filter(e => e.id !== selectedEdge) }); selectedEdge = ''"><Trash2 :size="16" /></button></div>
    <div v-if="current" class="connection-editor"><strong>{{ current.id }} →</strong><select v-model="target" aria-label="连接目标事件"><option value="">选择事件</option><option v-for="e in events.filter(e => e.id !== selected)" :key="e.id" :value="e.id">{{ e.id }}</option></select><select v-model="kind" aria-label="新连线类型"><option value="condition">前置完成条件</option><option value="result">结果触发</option></select><select v-if="kind === 'result'" v-model="choice" aria-label="新连线选项"><option value="">公共结果</option><option v-for="c in current.popup?.choices" :key="c.id" :value="c.id">{{ c.text || c.id }}</option></select><button title="连接事件" :disabled="disabled || !target" @click="quickConnect"><Plus :size="16" /></button></div>
  </div>
</template>

<style scoped>
.graph-surface { display:flex; flex-direction:column; min-height:360px; height:100%; min-width:0; background:#eef3f1; }.graph-tools,.connection-editor { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:8px 12px; background:#f9fbfa; border-bottom:1px solid #cedbd6; }.graph-tools span { color:#5d7067; font-size:12px; margin-left:auto; }.flow-canvas { flex:1; min-height:300px; }.event-block { width:230px; box-sizing:border-box; background:white; border:1px solid #8ea79e; border-radius:4px; color:#253932; padding:12px 0 0; box-shadow:0 2px 5px #173e2910; }.event-block.active { border:2px solid #267868; }.event-title { display:flex; gap:7px; padding:0 14px; align-items:center; }.event-title strong { font-size:13px; overflow-wrap:anywhere; }.event-block>small { display:block; padding:5px 14px 12px; color:#6f7d77; font-size:11px; overflow-wrap:anywhere; }.event-port { position:relative; padding:7px 16px; border-top:1px solid #e1e9e5; font-size:11px; text-align:right; color:#267b6c; }.event-port.result { color:#a66221; }.event-port.choice { color:#496e98; }.event-port :deep(.vue-flow__handle) { width:10px; height:10px; border:2px solid white; background:currentColor; }.event-block>:deep(.vue-flow__handle) { width:12px; height:12px; background:#56786b; border:2px solid white; }.connection-editor { border-top:1px solid #cedbd6; border-bottom:0; font-size:12px; }.connection-editor strong { overflow-wrap:anywhere; min-width:0; max-width:100%; font-weight:500; }button,select { min-height:30px; min-width:0; max-width:100%; border:1px solid #bacbc3; background:white; color:#2c483c; border-radius:4px; padding:4px 7px; font:12px system-ui; }button { display:flex; align-items:center; justify-content:center; cursor:pointer; }button:disabled { opacity:.45; }.connection-editor select { flex:1; max-width:220px; }
</style>
