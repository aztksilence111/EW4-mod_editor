<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Trash2, Copy, ArrowUp, ArrowDown, Play, Download, Upload, X, ArrowLeft } from 'lucide-vue-next'
import { api, download, type Preview } from '../core/editor/api'
import { createCondition, type ScriptEvent, type EventDocument, type LegacyEventRow, type EventGraph as GraphData } from '../core/editor/events'
import EventConditionTree from './EventConditionTree.vue'
import EventEffects from './EventEffects.vue'
import EventGraph from './EventGraph.vue'

const props = defineProps<{ revision: number; scenario: string; cells: number[]; disabled: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const document = ref<EventDocument | null>(null)
const events = ref<ScriptEvent[]>([])
const legacy = ref<LegacyEventRow[]>([])
const selected = ref(-1)
const faction = ref(0)
const graph = ref<GraphData>({ links: [], positions: {}, joins: {} })
const savedGraph = ref('')
const mode = ref('scripted')
const busy = ref(false)
const error = ref('')
const preview = ref<Preview | null>(null)
const jsonInput = ref<HTMLInputElement>()
const imageInput = ref<HTMLInputElement>()
const images = ref<Record<string, string>>({})
const current = computed(() => events.value[selected.value])
const eventIds = computed(() => events.value.map(e => e.id))
const changedLegacy = computed(() => legacy.value.filter((e, i) => JSON.stringify(e) !== JSON.stringify(document.value?.legacy[i])))
const dirty = computed(() => document.value && (JSON.stringify(events.value) !== JSON.stringify(document.value.events) || JSON.stringify(graph.value) !== savedGraph.value || changedLegacy.value.length > 0))
async function run(action: () => Promise<void>) {
  if (busy.value || props.disabled) return
  busy.value = true; error.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
let generation = 0
async function load() {
  const ticket = ++generation; const scenario = props.scenario; const countrySlot = faction.value
  busy.value = true
  try {
    const result = await api<EventDocument>('events/' + scenario + '?faction=' + countrySlot)
    if (ticket !== generation || scenario !== props.scenario || countrySlot !== faction.value) return
    document.value = result; events.value = structuredClone(result.events); legacy.value = structuredClone(result.legacy)
    graph.value = { links: result.graph?.links ?? [], positions: result.graph?.positions ?? {}, joins: result.graph?.joins ?? {} }
    savedGraph.value = JSON.stringify(graph.value)
    selected.value = -1; preview.value = null; images.value = {}
  } finally { if (ticket === generation) busy.value = false }
}
watch(() => [props.revision, props.scenario, faction.value], (next, previous) => { if (previous && next[1] !== previous[1]) faction.value = 0; preview.value = null; error.value = ''; void load().catch(e => { error.value = String(e) }) }, { immediate: true })
watch([events, legacy, images, graph], () => { preview.value = null }, { deep: true })
function selectFaction(event: Event) {
  const input = event.target as HTMLSelectElement
  if (dirty.value && !window.confirm('当前国家的事件修改尚未保存，切换后将放弃这些修改。继续切换？')) { input.value = String(faction.value); return }
  faction.value = Number(input.value)
}
function uniqueId(base: string) { let id = base, n = 1; while (events.value.some(e => e.id === id)) id = base + '_' + n++; return id }
function add() { events.value.push({ id: uniqueId('event'), condition: createCondition('round'), effects: [] }); selected.value = events.value.length - 1 }
function duplicate() { if (!current.value) return; events.value.push({ ...JSON.parse(JSON.stringify(current.value)), id: uniqueId(current.value.id + '_copy') }); selected.value = events.value.length - 1 }
function remove() { const id = current.value?.id; if (!id) return; events.value.splice(selected.value, 1); graph.value.links = graph.value.links.filter(e => e.source !== id && e.target !== id); delete graph.value.positions[id]; delete graph.value.joins[id]; selected.value = -1 }
function move(step: number) { const i = selected.value, next = i + step; [events.value[i], events.value[next]] = [events.value[next]!, events.value[i]!]; selected.value = next }
function rename(event: Event) {
  if (!current.value) return
  const before = current.value.id, after = (event.target as HTMLInputElement).value.trim()
  if (!after || events.value.some(e => e !== current.value && e.id === after)) { (event.target as HTMLInputElement).value = before; error.value = '事件 ID 不能为空或重复'; return }
  current.value.id = after
  if (before === after) return
  function patch(node: any) { if (!node || typeof node !== 'object') return; if (['event_completed','event_count'].includes(node.type) && node.key === before) node.key = after; Object.values(node).forEach(patch) }
  events.value.forEach(patch)
  graph.value.links.forEach(e => { if (e.source === before) e.source = after; if (e.target === before) e.target = after })
  if (graph.value.positions[before]) { graph.value.positions[after] = graph.value.positions[before]; delete graph.value.positions[before] }
  if (graph.value.joins[before]) { graph.value.joins[after] = graph.value.joins[before]; delete graph.value.joins[before] }
}
function popup(enabled: boolean) { if (!current.value) return; if (enabled) current.value.popup = { title: '', text: '', choices: [{ id: 'ok', text: '确认', effects: [] }] }; else { graph.value.links = graph.value.links.filter(e => e.source !== current.value!.id || !e.choice); delete current.value.popup } }
function addChoice() { current.value?.popup?.choices.push({ id: 'choice_' + crypto.randomUUID().slice(0, 8), text: '新选项', effects: [] }) }
function renameChoice(index: number, event: Event) {
  const choices = current.value?.popup?.choices; const choice = choices?.[index]; if (!choice) return
  const input = event.target as HTMLInputElement, after = input.value.trim(), before = choice.id
  if (!after || choices?.some(c => c !== choice && c.id === after)) { input.value = before; error.value = '选项 ID 不能为空或重复'; return }
  choice.id = after; graph.value.links.forEach(e => { if (e.source === current.value?.id && e.choice === before) e.choice = after })
}
function removeChoice(index: number) {
  const choice = current.value?.popup?.choices[index]; if (!choice) return
  graph.value.links = graph.value.links.filter(e => e.source !== current.value?.id || e.choice !== choice.id)
  current.value!.popup!.choices.splice(index, 1)
}
function openInsufficient(event: Event) { if ((event.target as HTMLDetailsElement).open && current.value && !current.value.insufficientResourcesEffects) current.value.insufficientResourcesEffects = [] }
function repeat(enabled: boolean) { if (!current.value) return; if (enabled) current.value.repeat = { everyRounds: 1, startRound: 1 }; else delete current.value.repeat }
async function makePreview() {
  preview.value = null
  if (!document.value || document.value.revision !== props.revision || document.value.scenario !== props.scenario) throw Error('事件数据已过期，请重新载入')
  const signature = JSON.stringify([events.value, legacy.value, images.value, graph.value, faction.value]); const scenario = props.scenario
  const result = await api<Preview>('events-preview', { revision: props.revision, taskId: crypto.randomUUID(), scenario,
    events: events.value, legacy: changedLegacy.value, images: images.value, faction: faction.value, graph: graph.value })
  if (scenario === props.scenario && signature === JSON.stringify([events.value, legacy.value, images.value, graph.value, faction.value])) preview.value = result
}
async function apply() { if (!preview.value) return; await api('apply', { revision: props.revision, taskId: preview.value.taskId, token: preview.value.token }); preview.value = null; emit('changed') }
function exportJson() { download(new Blob([JSON.stringify({ events: events.value, graph: graph.value }, null, 2)], { type: 'application/json' }), props.scenario + '-f' + faction.value + '-events.json') }
async function importJson(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return
  if (file.size > 2 * 1024 * 1024) throw Error('事件 JSON 不能超过 2 MiB')
  const imported = JSON.parse(await file.text()); const data = Array.isArray(imported) ? imported : imported.events
  if (!Array.isArray(data) || data.length > 1024 || data.some(e => !e || typeof e.id !== 'string' || !e.condition || !Array.isArray(e.effects ?? []))) throw Error('事件 JSON 必须为事件数组')
  events.value = data.map(e => ({ ...e, effects: e.effects ?? [] })); selected.value = 0
  graph.value = { links: imported.graph?.links ?? [], positions: imported.graph?.positions ?? {}, joins: imported.graph?.joins ?? {} }
}
async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; const target = current.value?.popup; if (!file || !target) return
  if (file.size > 4 * 1024 * 1024) throw Error('事件 PNG 不能超过 4 MiB')
  const bytes = await file.arrayBuffer(); const digest = await crypto.subtle.digest('SHA-256', bytes)
  const path = 'rewrite/images/event-' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24) + '.png'
  const encoded = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]!); r.onerror = () => reject(Error('图片读取失败')); r.readAsDataURL(file) })
  images.value[path] = encoded; target.image = path
}
const legacyEffects = ['士气上升','士气下降','士气大降','混乱','对白 / 无效果','环境扩散']
</script>

<template>
  <div class="event-panel" :aria-busy="busy">
    <div class="actions scope-toolbar"><strong>{{ scenario }}.btl</strong><select :value="faction" aria-label="事件树所属国家" :disabled="busy || disabled" @change="selectFaction"><option v-for="(f, slot) in document?.factions" :key="f.id" :value="slot">{{ f.name }} · {{ f.country }} · 槽位 {{ slot }}</option></select><div class="modes"><button :class="{ active: mode === 'scripted' }" @click="mode = 'scripted'">Rewrite 事件树 · {{ events.length }}</button><button :class="{ active: mode === 'legacy' }" @click="mode = 'legacy'">BTL 事件 · {{ legacy.length }}</button></div><button title="导出事件 JSON" @click="exportJson"><Download :size="16" /></button><button title="导入事件 JSON" :disabled="busy || disabled" @click="jsonInput?.click()"><Upload :size="16" /></button><input ref="jsonInput" type="file" hidden accept=".json" @change="run(() => importJson($event))" /></div>
    <fieldset :disabled="busy || disabled || !document" :class="{ 'script-layout': mode === 'scripted', 'detail-open': !!current }">
      <template v-if="mode === 'scripted'">
        <EventGraph :events="events" :graph="graph" :selected="current?.id" :disabled="busy || disabled" @graph="graph = $event" @select="selected = events.findIndex(e => e.id === $event)" @add="add" />
        <aside v-if="current && document" class="event-details" aria-label="事件详情">
          <div class="actions detail-heading"><button title="返回事件画布" @click="selected = -1"><ArrowLeft :size="16" /></button><h3>事件详情</h3><button title="复制事件" @click="duplicate"><Copy :size="16" /></button><button title="删除事件" @click="remove"><Trash2 :size="16" /></button><button title="上移执行顺序" :disabled="selected === 0" @click="move(-1)"><ArrowUp :size="16" /></button><button title="下移执行顺序" :disabled="selected === events.length - 1" @click="move(1)"><ArrowDown :size="16" /></button></div>
          <label>事件 ID<input :value="current.id" aria-label="事件 ID" maxlength="128" @change="rename" /></label>
          <label v-if="graph.links.some(e => e.target === current?.id)">前置连线汇合<select :value="graph.joins[current.id] ?? 'all'" aria-label="前置连线汇合" @change="graph.joins[current!.id] = ($event.target as HTMLSelectElement).value as 'all' | 'any'"><option value="all">全部满足 · 并发汇合</option><option value="any">任一满足 · 分支汇合</option></select></label>
          <h3>触发条件</h3><EventConditionTree :node="current.condition" :document="document" :event-ids="eventIds" :cells="cells" />
          <div class="actions"><label class="toggle"><input type="checkbox" :checked="!!current.repeat" @change="repeat(($event.target as HTMLInputElement).checked)" />周期触发</label><label class="toggle"><input type="checkbox" :checked="!!current.popup" @change="popup(($event.target as HTMLInputElement).checked)" />弹窗与选项</label></div>
          <div v-if="current.repeat" class="repeat-fields"><label>间隔回合<input v-model.number="current.repeat.everyRounds" aria-label="间隔回合" type="number" min="1" /></label><label>开始回合<input v-model.number="current.repeat.startRound" aria-label="开始回合" type="number" min="1" /></label><label>结束回合<input :value="current.repeat.endRound" aria-label="结束回合" type="number" min="1" @input="current.repeat.endRound = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined" /></label><label>最多次数<input :value="current.repeat.maxOccurrences" aria-label="最多次数" type="number" min="1" @input="current.repeat.maxOccurrences = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined" /></label></div>
          <h3>{{ current.popup ? '公共效果' : '执行效果' }}</h3><EventEffects :effects="current.effects" :document="document" :event-ids="eventIds" :cells="cells" />
          <template v-if="current.popup">
            <h3>弹窗</h3><label>标题<input v-model="current.popup.title" aria-label="弹窗标题" /></label><label>正文<textarea v-model="current.popup.text" aria-label="弹窗正文" rows="4" /></label>
            <div class="actions"><button @click="imageInput?.click()"><Upload :size="15" />弹窗 PNG</button><input ref="imageInput" hidden type="file" accept="image/png" @change="run(() => uploadImage($event))" /><button v-if="current.popup.image" title="移除弹窗图片" @click="delete current.popup.image"><Trash2 :size="15" /></button></div>
            <img v-if="current.popup.image" class="popup-image" :src="images[current.popup.image] ? 'data:image/png;base64,' + images[current.popup.image] : '/editor-api/event-image?path=' + encodeURIComponent(current.popup.image) + '&revision=' + revision" alt="弹窗图片预览" />
            <label>图片路径<input :value="current.popup.image" aria-label="弹窗图片路径" @input="current.popup.image = ($event.target as HTMLInputElement).value || undefined" /></label><label>图片描述<input v-model="current.popup.imageAlt" aria-label="弹窗图片描述" /></label>
            <section v-for="(choice, index) in current.popup.choices" :key="index" class="choice">
              <div class="actions"><h3>选项 {{ index + 1 }}</h3><button title="删除选项" :disabled="current.popup.choices.length <= 1" @click="removeChoice(index)"><Trash2 :size="15" /></button></div>
              <div class="choice-fields"><label>选项 ID<input :value="choice.id" aria-label="选项 ID" @change="renameChoice(index, $event)" /></label><label>按钮文字<input v-model="choice.text" aria-label="选项文字" /></label></div>
              <label class="toggle"><input type="checkbox" :checked="!!choice.condition" @change="choice.condition = ($event.target as HTMLInputElement).checked ? createCondition() : undefined" />可选条件</label><EventConditionTree v-if="choice.condition" :node="choice.condition" :document="document" :event-ids="eventIds" :cells="cells" /><EventEffects :effects="choice.effects" :document="document" :event-ids="eventIds" :cells="cells" />
            </section><button class="add-choice" @click="addChoice"><Plus :size="15" />选项</button>
          </template>
          <details @toggle="openInsufficient"><summary>资源不足分支</summary><EventEffects v-if="current.insufficientResourcesEffects" :effects="current.insufficientResourcesEffects" :document="document" :event-ids="eventIds" :cells="cells" /></details>
        </aside>
      </template>
      <template v-else><div class="legacy-events"><details v-for="event in legacy" :key="event.slot"><summary>事件 {{ event.id }} · 槽位 {{ event.slot }} · {{ legacyEffects[event.effect] ?? event.effect }}</summary><div class="legacy-fields"><label>触发<select v-model.number="event.condition" aria-label="BTL 触发类型"><option :value="0">建筑占领</option><option :value="1">部队消灭</option><option :value="2">回合</option></select></label><label>效果<select v-model.number="event.effect" aria-label="BTL 效果"><option v-for="(label, value) in legacyEffects" :key="value" :value="value">{{ label }}</option></select></label><label>回合<input v-model.number="event.round" aria-label="BTL 回合" type="number" min="0" /></label><label>对白 ID<input v-model.number="event.dialogue" aria-label="BTL 对白" type="number" min="0" /></label><label>效果地块<input v-model.number="event.cell" aria-label="BTL 地块" type="number" /></label><label>国家<select v-model="event.country" aria-label="BTL 国家"><option v-for="f in document?.factions" :key="f.country" :value="f.country">{{ f.name }} · {{ f.country }}</option><option v-if="!document?.factions.some(f => f.country === event.country)" :value="event.country">{{ event.country || '默认目标' }}</option></select></label></div><p>关联建筑 {{ event.sites.join(', ') || '无' }} · 部队 {{ event.armies.join(', ') || '无' }}</p></details></div></template>
    </fieldset>
    <datalist id="event-factions"><option value="@player">所属国家</option><option value="@active">当前行动势力</option><option v-for="f in document?.factions" :key="f.id" :value="f.id">{{ f.name }}</option><option v-for="e in events.flatMap(e => [...e.effects, ...(e.popup?.choices.flatMap(c => c.effects) ?? [])]).filter(e => e.type === 'faction_create')" :key="e.faction" :value="e.faction">{{ e.name }}</option></datalist><datalist id="event-units"><option v-for="u in document?.units" :key="u.id" :value="u.id">地块 {{ u.cell }}</option></datalist>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="actions save-toolbar"><button :disabled="busy || disabled || !dirty" @click="run(makePreview)"><Play :size="15" />预览事件修改</button><button v-if="preview" :disabled="busy || disabled || !preview.count" @click="run(apply)">应用事件修改 · {{ preview.count }}</button><span v-if="dirty">未保存</span><button v-if="preview" title="关闭差异预览" @click="preview = null"><X :size="15" /></button></div>
    <div v-if="preview" class="event-diff"><div v-for="(d, index) in preview.changes" :key="index"><strong>{{ d.object }} · {{ d.field }}</strong><span>{{ d.before }}</span><span>{{ d.after }}</span></div></div>
  </div>
</template>

<style scoped>
.event-panel { height:100%; gap:0 !important; overflow:hidden; }.scope-toolbar,.save-toolbar { padding:9px 14px; flex:none; border-bottom:1px solid #ccd9d2; }.save-toolbar { border-top:1px solid #ccd9d2; border-bottom:0; }.save-toolbar span { color:#a66221; }.scope-toolbar>select { flex:1; max-width:330px; }.scope-toolbar>strong { font-size:12px; font-weight:500; }.event-panel>fieldset { flex:1; min-height:0; overflow:auto; }.event-panel>fieldset.script-layout { display:grid; grid-template-columns:minmax(0,1fr); gap:0; overflow:hidden; }.event-panel>fieldset.script-layout.detail-open { grid-template-columns:minmax(0,1fr) 420px; }.event-details { display:flex; flex-direction:column; min-width:0; gap:12px; padding:14px; overflow:auto; border-left:1px solid #c6d5cc; background:#fff; }.detail-heading h3 { flex:1; }.event-diff { max-height:180px; padding:12px; overflow:auto; flex:none; }.event-panel>.error { padding:8px 14px; flex:none; max-height:100px; overflow:auto; }.legacy-events { padding:14px; }@media(max-width:1000px) { .event-panel>fieldset.script-layout.detail-open { grid-template-columns:minmax(0,1fr) 340px; } }@media(max-width:700px) { .event-panel>fieldset.script-layout.detail-open { grid-template-columns:minmax(0,1fr); }.detail-open>:deep(.graph-surface) { display:none; }.event-details { border-left:0; }.scope-toolbar>select { max-width:none; }.scope-toolbar .modes { width:100%; } }
.event-panel,fieldset { display:flex; flex-direction:column; gap:12px; min-width:0; font-size:12px; }fieldset { border:0; padding:0; margin:0; }button,input,select,textarea { box-sizing:border-box; max-width:100%; min-width:0; min-height:32px; padding:5px 7px; font:12px system-ui; color:#253237; background:white; border:1px solid #bcc9c9; border-radius:4px; }button { display:inline-flex; align-items:center; justify-content:center; gap:5px; cursor:pointer; }button:disabled { opacity:.45; cursor:default; }button.active { border-color:#236d59; background:#e4f1e9; }.actions,.modes { display:flex; align-items:center; flex-wrap:wrap; gap:5px; }label { display:flex; flex-direction:column; gap:5px; min-width:0; }label.toggle { flex-direction:row; align-items:center; gap:5px; }input[type=checkbox] { min-height:0; }.event-graph { display:flex; overflow:auto; gap:16px; max-height:260px; padding:3px 0; flex-shrink:0; }.graph-column { display:flex; flex-direction:column; gap:7px; width:180px; flex:none; }.graph-column button { display:flex; flex-direction:column; align-items:stretch; text-align:left; gap:7px; padding:9px; width:100%; white-space:normal; overflow-wrap:anywhere; border-radius:4px; }.graph-column span,.graph-column small { display:flex; align-items:center; gap:4px; }.graph-column small { color:#60706c; font-size:11px; }.graph-column .cycle { border-color:#c47746; }h3 { font-size:13px; margin:4px 0 0; }summary { cursor:pointer; font-size:12px; padding:5px 0; }.repeat-fields,.choice-fields,.legacy-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }.choice { border-top:1px solid #cbd5d1; padding-top:10px; display:flex; flex-direction:column; gap:10px; }.choice>.actions h3 { flex:1; }.add-choice { align-self:flex-start; }.popup-image { width:100%; max-height:200px; object-fit:contain; }.error { color:#a03428; margin:0; }.empty { color:#60706c; padding:10px 0; margin:0; }.event-diff>div { display:flex; flex-direction:column; gap:5px; margin-bottom:10px; overflow-wrap:anywhere; }.event-diff span { white-space:pre-wrap; color:#52615a; }.legacy-events>details { padding:5px 0; border-bottom:1px solid #d7dfdb; }.legacy-events p { margin:8px 0; color:#60706c; }@media(max-width:500px) { .repeat-fields,.choice-fields,.legacy-fields { grid-template-columns:1fr; } }
</style>
