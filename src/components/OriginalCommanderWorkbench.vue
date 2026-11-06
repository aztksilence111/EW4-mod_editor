<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, FileDown, FileUp, FolderOpen, Layers, Map as MapIcon, Plus, Redo2, Save, Undo2, Upload, X } from 'lucide-vue-next'
import Papa from 'papaparse'
import { commanderFields, commanderFieldLabels, type CommanderField, type CommanderRule } from '../core/editor/commanderFields'
import { compareOriginalCommanderXml, originalCommanderCsvRules, previewOriginalCommanders, readOriginalCommanders, type CommanderDiff } from '../core/editor/originalCommanders'
import { getCommanderName, getCountryName } from '../core/data/config'

const props = defineProps<{ xml: string }>()
const emit = defineEmits<{ (e: 'update:xml', xml: string): void; (e: 'map'): void; (e: 'save'): void; (e: 'export-pack'): void; (e: 'import-pack'): void }>()
const labels: Record<string, string> = { ...commanderFieldLabels, name: '名称键', country: '国家', image: '头像', price: '价格', drawlots: '抽取' }
const search = ref(''), country = ref(''), selected = ref<number[]>([])
const field = ref<CommanderField>('cavalry'), operation = ref<CommanderRule['operation']>('add')
const value = ref(1), rounding = ref<CommanderRule['rounding']>('round')
const rules = ref<CommanderRule[]>([]), error = ref(''), notice = ref('')
const preview = ref<{ xml: string; changes: CommanderDiff[]; source: string } | null>(null)
const undo = ref<{ before: string; after: string }[]>([]), redo = ref<{ before: string; after: string }[]>([])
const csvInput = ref<HTMLInputElement | null>(null), xmlInput = ref<HTMLInputElement | null>(null), recipeInput = ref<HTMLInputElement | null>(null)
const rows = computed(() => readOriginalCommanders(props.xml))
const countries = computed(() => [...new Set(rows.value.map(row => row.country))].sort())
const visible = computed(() => rows.value.filter(row => (!country.value || row.country === country.value) &&
  (!search.value || `${row.id} ${row.name} ${getCommanderName(row.id)}`.toLowerCase().includes(search.value.toLowerCase()))))
const targets = computed(() => selected.value.length ? visible.value.filter(row => selected.value.includes(row.id)) : visible.value)
const columns: CommanderField[] = ['rank', 'nobilityrank', 'star', 'infantry', 'cavalry', 'artillery', 'warship', 'movement', 'training', 'skill1', 'skill2', 'skill3', 'skill4', 'item1', 'item2']
let expectedXml: string | null = null
watch(() => props.xml, xml => {
  preview.value = null
  if (xml !== expectedXml) { undo.value = []; redo.value = []; rules.value = [] }
  expectedXml = null
})
watch(rules, () => { preview.value = null }, { deep: true })
function run(action: () => void) {
  error.value = ''; notice.value = ''
  try { action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function addRule() {
  const rule: CommanderRule = { field: field.value, operation: operation.value, value: value.value, rounding: rounding.value, ids: targets.value.map(row => row.id) }
  previewOriginalCommanders(props.xml, [rule])
  rules.value.push(rule)
}
function makePreview(nextRules = rules.value) {
  preview.value = { ...previewOriginalCommanders(props.xml, nextRules), source: props.xml }
  if (!preview.value.changes.length) notice.value = '没有字段变化'
}
function setXml(xml: string) { expectedXml = xml; emit('update:xml', xml) }
function apply() {
  if (!preview.value || preview.value.source !== props.xml) throw new Error('预览已过期，请重新预览')
  if (!preview.value.changes.length && preview.value.xml === props.xml) return
  readOriginalCommanders(preview.value.xml)
  undo.value.push({ before: props.xml, after: preview.value.xml }); redo.value = []
  setXml(preview.value.xml); preview.value = null; rules.value = []; notice.value = '原版将领配置已应用'
}
function history(direction: 'undo' | 'redo') {
  const source = direction === 'undo' ? undo.value : redo.value, target = direction === 'undo' ? redo.value : undo.value
  const entry = source.at(-1)
  if (!entry) return
  if (props.xml !== (direction === 'undo' ? entry.after : entry.before)) throw new Error('历史已过期')
  source.pop(); target.push(entry); setXml(direction === 'undo' ? entry.before : entry.after)
  rules.value = []; preview.value = null
}
function exportCsv() {
  const data = visible.value.map(row => ({ schema: 1, target: 'original', id: row.id, name: row.name, country: row.country, ...row.values }))
  download('\uFEFF' + Papa.unparse(data), 'original-commanders.csv', 'text/csv;charset=utf-8')
}
async function importFile(event: Event, type: 'csv' | 'xml' | 'recipe') {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''
  if (!file) return
  error.value = ''; notice.value = ''
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('文件不能超过 4 MiB')
    const source = props.xml, text = await file.text()
    if (source !== props.xml) throw new Error('配置已变化，请重新导入')
    if (type === 'csv') {
      const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' })
      if (parsed.errors.length || !parsed.data.length) throw new Error('CSV 格式错误或为空')
      const imported = originalCommanderCsvRules(props.xml, parsed.data)
      makePreview(imported)
    } else if (type === 'xml') {
      const changes = compareOriginalCommanderXml(props.xml, text)
      preview.value = { xml: text, changes, source: props.xml }
    } else {
      const recipe = JSON.parse(text)
      if (recipe.schema !== 1 || recipe.target !== 'original' || !Array.isArray(recipe.rules) || recipe.rules.length > 4096) throw new Error('需要原版将领批处理配方')
      previewOriginalCommanders(props.xml, recipe.rules)
      rules.value = recipe.rules
      notice.value = `已导入 ${rules.value.length} 条规则`
    }
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
</script>

<template>
  <section class="original-content" aria-label="原版将领批量配置">
    <header class="content-heading"><h1>将领配置</h1><span>{{ rows.length }} 位 · 原版</span><button title="返回地图" @click="emit('map')"><MapIcon :size="17" /></button></header>
    <div class="content-tools">
      <button title="撤销" :disabled="!undo.length" @click="run(() => history('undo'))"><Undo2 :size="17" /></button>
      <button title="重做" :disabled="!redo.length" @click="run(() => history('redo'))"><Redo2 :size="17" /></button>
      <button title="保存原版草稿" @click="emit('save')"><Save :size="17" /></button>
      <button @click="emit('export-pack')"><Download :size="16" />导出工程</button>
      <button title="导入原版工程" @click="emit('import-pack')"><FolderOpen :size="17" /></button>
      <button @click="xmlInput?.click()"><Upload :size="16" />导入将领 XML</button>
      <button @click="run(() => download(xml, 'def_commander.xml', 'application/xml'))"><Download :size="16" />导出将领 XML</button>
      <button title="导入 CSV" @click="csvInput?.click()"><FileUp :size="17" /></button>
      <button title="导出筛选结果 CSV" @click="run(exportCsv)"><FileDown :size="17" /></button>
      <input ref="xmlInput" type="file" accept=".xml" hidden aria-label="导入原版将领 XML 文件" @change="importFile($event, 'xml')" />
      <input ref="csvInput" type="file" accept=".csv" hidden aria-label="导入原版将领 CSV 文件" @change="importFile($event, 'csv')" />
      <input ref="recipeInput" type="file" accept=".json" hidden aria-label="导入原版将领配方文件" @change="importFile($event, 'recipe')" />
    </div>
    <div class="filters"><input v-model="search" aria-label="搜索原版将领" placeholder="将领 ID / 名称" /><select v-model="country" aria-label="原版将领国家"><option value="">全部国家</option><option v-for="id in countries" :key="id" :value="id">{{ getCountryName(id) }} · {{ id }}</option></select><span>{{ visible.length }} 位 · 本次 {{ targets.length }} 位</span><button :disabled="!selected.length" @click="selected = []">清空选择</button></div>
    <div v-if="error" class="error" role="alert">{{ error }}</div><div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div class="table-scroll commander-table"><table><thead><tr><th><input type="checkbox" aria-label="选择全部筛选将领" :checked="visible.length > 0 && visible.every(row => selected.includes(row.id))" @change="selected = ($event.target as HTMLInputElement).checked ? visible.map(row => row.id) : []" /></th><th>ID</th><th>将领</th><th>国家</th><th v-for="key in columns" :key="key">{{ commanderFieldLabels[key] }}</th></tr></thead><tbody><tr v-for="row in visible" :key="row.id" :data-commander="row.id"><td><input v-model="selected" type="checkbox" :value="row.id" :aria-label="'选择原版将领 ' + row.id" /></td><td>{{ row.id }}</td><td :title="row.name">{{ getCommanderName(row.id) }}</td><td>{{ row.country }}</td><td v-for="key in columns" :key="key" :data-field="key">{{ row.values[key] }}</td></tr></tbody></table></div>
    <div class="rule-controls"><select v-model="field" aria-label="原版将领字段"><option v-for="key in commanderFields" :key="key" :value="key">{{ commanderFieldLabels[key] }}</option></select><select v-model="operation" aria-label="原版批量运算"><option value="set">赋值</option><option value="add">增加</option><option value="multiply">倍率</option></select><input v-model.number="value" type="number" aria-label="原版批量数值" /><select v-model="rounding" aria-label="原版批量取整"><option value="round">四舍五入</option><option value="floor">向下取整</option><option value="ceil">向上取整</option></select><button :disabled="!targets.length" @click="run(addRule)"><Plus :size="16" />加入批处理</button></div>
    <div v-if="rules.length" class="rules"><div v-for="(rule, index) in rules" :key="index"><span>{{ commanderFieldLabels[rule.field] }} · {{ { set: '赋值', add: '增加', multiply: '倍率' }[rule.operation] }} {{ rule.value }} · {{ rule.ids.length }} 位</span><button title="移除规则" @click="rules.splice(index, 1)"><X :size="15" /></button></div></div>
    <div class="content-tools"><button :disabled="!rules.length" @click="run(() => makePreview())"><Layers :size="16" />预览批处理</button><button :disabled="!preview" @click="run(apply)">应用配置</button><button :disabled="!preview" @click="preview = null">取消预览</button><button title="导入配方" @click="recipeInput?.click()"><FileUp :size="17" /></button><button title="导出配方" :disabled="!rules.length" @click="run(() => download(JSON.stringify({ schema: 1, target: 'original', rules }, null, 2), 'original-commander-recipe.json', 'application/json'))"><FileDown :size="17" /></button></div>
    <div v-if="preview" class="diff-area"><strong>{{ preview.changes.length }} 项字段变化</strong><div class="table-scroll diff-table"><table><thead><tr><th>将领</th><th>字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody><tr v-for="(change, index) in preview.changes" :key="index"><td>{{ getCommanderName(change.id) }} · {{ change.id }}</td><td>{{ labels[change.field] }}</td><td>{{ change.before }}</td><td>{{ change.after }}</td></tr></tbody></table></div></div>
  </section>
</template>

<style scoped>
.original-content { flex:1; min-height:0; overflow:auto; padding:14px 18px; display:flex; flex-direction:column; gap:10px; color:#263d35; background:#f5f7f6; }
.content-heading,.content-tools,.filters,.rule-controls { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.content-heading h1 { font-size:18px; margin:0; }.content-heading span,.filters span { font-size:12px; color:#63746e; }.content-heading button { margin-left:auto; }
button { display:inline-flex; align-items:center; justify-content:center; gap:5px; padding:7px 9px; min-height:34px; border:1px solid #bdcbc5; border-radius:4px; background:#fff; color:#275341; cursor:pointer; font-size:12px; }button:disabled { opacity:.45; cursor:default; }button:hover:enabled { background:#e6efeb; }
input:not([type=checkbox]),select { min-width:0; max-width:100%; padding:7px 8px; border:1px solid #bdcbc5; border-radius:3px; background:white; color:#263d35; font-size:12px; }.rule-controls input { width:100px; }.filters input { width:220px; }
.table-scroll { overflow:auto; border:1px solid #d5ded9; flex-shrink:0; background:white; }.commander-table { flex:1 0 200px; max-height:48vh; }table { border-collapse:collapse; font-size:12px; white-space:nowrap; width:100%; }th,td { padding:7px 9px; border-bottom:1px solid #e2e7e4; text-align:left; }thead { position:sticky; top:0; background:#eaf0ed; z-index:1; }th { font-weight:500; }
.rules { max-height:140px; overflow:auto; border-top:1px solid #d5ded9; }.rules>div { display:flex; align-items:center; justify-content:space-between; padding:5px 0; font-size:12px; }.error { color:#a82b25; font-size:13px; }.notice { color:#24724d; font-size:13px; }.diff-area strong { display:block; margin-bottom:6px; font-size:12px; }.diff-table { max-height:210px; }
@media(max-width:600px) { .original-content { padding:10px; }.filters input { flex:1; width:150px; }.filters select { flex:1; }.rule-controls>* { flex:1 1 100px; }.commander-table { max-height:40vh; flex-basis:180px; } }
</style>
