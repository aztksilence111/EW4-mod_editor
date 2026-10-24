<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Plus, Upload, Download, Play, X, Flag, ArrowUp, ArrowDown } from 'lucide-vue-next'
import Papa from 'papaparse'
import { api, download, exportMod, type Overview, type CountryDraft, type Preview, type ScenarioView } from '../core/editor/api'

const props = defineProps<{ overview: Overview; scenario: string; view: ScenarioView | null; disabled: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const rows = ref<CountryDraft[]>([])
const selected = ref(0)
const checked = ref<string[]>([])
const search = ref('')
const busy = ref(false)
const error = ref('')
const preview = ref<Preview | null>(null)
const bulkColor = ref('#4477aa')
const resourceLayout = ref<'rewrite' | 'legacy'>('rewrite')
const imageInput = ref<HTMLInputElement>()
const framesInput = ref<HTMLInputElement>()
const csvInput = ref<HTMLInputElement>()
const pendingFrames = ref<{ name: string; data: string }[]>([])
const tick = ref(0)
const timer = setInterval(() => { tick.value = (tick.value + 1) % 4 }, 100)
onBeforeUnmount(() => clearInterval(timer))
const assignments = ref<Record<number, string>>({})
const current = computed(() => rows.value[selected.value])
const visible = computed(() => rows.value.filter(r => `${r.id} ${r.name}`.toLowerCase().includes(search.value.toLowerCase())))
const flagCodes = computed(() => [...new Set(props.overview.countries.map(c => c.flag).filter((f): f is string => !!f))].sort())
const dirty = computed(() => rows.value.filter(r => r.originalId === null || JSON.stringify({ ...props.overview.countries.find(c => c.id === r.originalId), originalId: r.originalId }) !== JSON.stringify(r)))
function reset() {
  rows.value = props.overview.countries.map(r => ({ ...r, originalId: r.id }))
  selected.value = Math.min(selected.value, Math.max(0, rows.value.length - 1))
  checked.value = []; preview.value = null; pendingFrames.value = []; assignments.value = {}
}
watch(() => props.overview.revision, reset, { immediate: true })
watch(() => props.scenario, () => { assignments.value = {}; preview.value = null })
watch([rows, assignments], () => { preview.value = null }, { deep: true })
watch(selected, () => { pendingFrames.value = [] })
function add() {
  let n = 1; while (rows.value.some(r => r.id === `country_${n}`)) n++
  const id = `country_${n}`
  rows.value.push({ ...(current.value ?? rows.value.find(r => r.id === 'fra')!), originalId: null, id, name: '新国家', color: '#4477aa', image: undefined, frames: undefined })
  selected.value = rows.value.length - 1; search.value = ''
}
async function run(action: () => Promise<void>) {
  if (busy.value || props.disabled) return
  busy.value = true; error.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
async function encoded(file: File) {
  if (file.size > 3 * 1024 * 1024) throw Error('国旗 PNG 不能超过 3 MiB')
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(file)
  })
}
async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''
  const row = current.value; if (file && row) row.image = await encoded(file)
}
async function uploadFrames(event: Event) {
  const input = event.target as HTMLInputElement; const files = Array.from(input.files ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); input.value = ''
  if (files.length !== 4) throw Error('请选择完整的 4 帧 PNG')
  pendingFrames.value = await Promise.all(files.map(async file => ({ name: file.name, data: await encoded(file) })))
}
function useFrames() { if (current.value && pendingFrames.value.length === 4) { current.value.frames = pendingFrames.value.map(f => f.data); pendingFrames.value = [] } }
function moveFrame(index: number, step: number) {
  const other = index + step; if (other < 0 || other > 3) return
  const frames = pendingFrames.value; [frames[index], frames[other]] = [frames[other]!, frames[index]!]
}
function src(row: CountryDraft, frame: number) {
  const data = frame === 0 ? row.image ?? row.frames?.[0] : row.frames?.[frame - 1] ?? row.image
  const original = props.overview.countries.find(c => c.id === row.originalId)
  const source = row.flag === original?.flag ? original : props.overview.countries.find(c => c.flag === row.flag && !!row.flag)
  return data ? 'data:image/png;base64,' + data : source ? `/editor-api/country-image?id=${encodeURIComponent(source.id)}&frame=${frame}&revision=${props.overview.revision}` : ''
}
async function makePreview() {
  preview.value = null
  const signature = JSON.stringify([rows.value, assignments.value])
  const result = await api<Preview>('countries-preview', { revision: props.overview.revision, taskId: crypto.randomUUID(), countries: dirty.value,
    assignments: Object.entries(assignments.value).map(([faction, country]) => ({ scenario: props.scenario, faction: Number(faction), country })) })
  if (signature === JSON.stringify([rows.value, assignments.value])) preview.value = result
}
async function apply() {
  if (!preview.value) return
  await api('apply', { revision: props.overview.revision, token: preview.value.token, taskId: preview.value.taskId }); preview.value = null; emit('changed')
}
function exportCsv() {
  download(new Blob(['\uFEFF' + Papa.unparse(rows.value.map(({ originalId, id, name, color, unitVariant, visualVariant, flag }) => ({ originalId, id, name, color, unitVariant, visualVariant, flag })))], { type: 'text/csv;charset=utf-8' }), 'countries.csv')
}
async function exportResources() {
  await exportMod({ revision: props.overview.revision, scope: 'countries', layout: resourceLayout.value }, 'countries' + (resourceLayout.value === 'legacy' ? '-assets' : ''), 'original')
}
async function importCsv(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return
  const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: 'greedy' })
  const fields = ['originalId', 'id', 'name', 'color', 'unitVariant', 'visualVariant', 'flag']
  if (parsed.errors.length || parsed.meta.renamedHeaders || !fields.every(f => parsed.meta.fields?.includes(f)) || parsed.meta.fields?.some(f => !fields.includes(f))) throw Error('国家 CSV 表头或格式无效')
  const imported = rows.value.map(r => ({ ...r })); const ids = new Set<string>()
  for (const row of parsed.data) {
    const key = row.originalId || row.id!
    if (ids.has(key)) throw Error('CSV 包含重复国家: ' + key); ids.add(key)
    const index = row.originalId ? imported.findIndex(r => r.originalId === row.originalId) : -1
    if (row.originalId && index < 0) throw Error('原国家不存在: ' + row.originalId)
    const draft = { ...(index < 0 ? {} : imported[index]), ...row, originalId: row.originalId || null,
      color: row.color || null, unitVariant: row.unitVariant || null, visualVariant: row.visualVariant || null, flag: row.flag || null } as CountryDraft
    if (index < 0) imported.push(draft); else imported[index] = draft
  }
  rows.value = imported
}
</script>

<template>
  <div class="country-panel" :aria-busy="busy">
    <div class="actions"><input v-model="search" aria-label="搜索国家" placeholder="国家 ID / 名称" /><button title="添加国家" :disabled="busy || disabled" @click="add"><Plus :size="16" /></button><button title="导出国家 CSV" @click="exportCsv"><Download :size="16" /></button><button title="导入国家 CSV" :disabled="busy || disabled" @click="csvInput?.click()"><Upload :size="16" /></button><input ref="csvInput" hidden type="file" accept=".csv" @change="run(() => importCsv($event))" /><span>{{ rows.length }} 国 · 待修改 {{ dirty.length }}</span></div>
    <div class="actions"><select v-model="resourceLayout" aria-label="国家资源目录" :disabled="busy || disabled"><option value="rewrite">Rewrite 原目录</option><option value="legacy">原版 assets 目录 + Rewrite 补充</option></select><button :disabled="busy || disabled || dirty.length > 0 || Object.keys(assignments).length > 0" title="导出已应用的国家定义、国旗和剧本绑定" @click="run(exportResources)"><Download :size="16" />导出国家资源 ZIP</button></div>
    <fieldset :disabled="busy || disabled">
      <div class="country-table"><table><thead><tr><th><input type="checkbox" aria-label="选择全部国家" :checked="visible.length > 0 && visible.every(r => checked.includes(r.originalId ?? r.id))" @change="checked = ($event.target as HTMLInputElement).checked ? visible.map(r => r.originalId ?? r.id) : []" /></th><th>ID</th><th>名称</th><th>领土颜色</th><th>国旗</th></tr></thead><tbody><tr v-for="row in visible" :key="rows.indexOf(row)" :class="{ active: current === row }" @click="selected = rows.indexOf(row)"><td><input v-model="checked" type="checkbox" :value="row.originalId ?? row.id" :aria-label="'选择国家 ' + row.id" /></td><td><input v-model="row.id" :aria-label="'国家 ID ' + (row.originalId ?? row.id)" /></td><td><input v-model="row.name" :aria-label="'国家名称 ' + (row.originalId ?? row.id)" /></td><td><div class="color-field"><input type="color" :value="row.color?.slice(0, 7) ?? '#808080'" :aria-label="'领土色板 ' + row.id" @input="row.color = ($event.target as HTMLInputElement).value" /><input v-model="row.color" placeholder="#RRGGBB[AA]" :aria-label="'领土颜色 ' + row.id" /></div></td><td><button class="flag-select" :title="'编辑国旗 ' + row.id" @click="selected = rows.indexOf(row)"><img v-if="row.flag || row.flagImage || row.image || row.frames" :src="src(row, 0)" alt="" /><Flag v-else :size="16" /></button></td></tr></tbody></table></div>
      <div class="actions"><input v-model="bulkColor" type="color" aria-label="批量领土颜色" /><button :disabled="!checked.length" @click="rows.filter(r => checked.includes(r.originalId ?? r.id)).forEach(r => r.color = bulkColor)">应用颜色到所选 {{ checked.length }} 国</button><button title="重置国家修改" @click="reset"><X :size="16" /></button></div>
      <div v-if="current" class="flag-editor">
        <h3>{{ current.name }} · {{ current.id }}</h3>
        <div class="variant-fields"><label>兵种模板<select v-model="current.unitVariant" aria-label="国家兵种模板"><option :value="null">沿用剧本</option><option v-for="v in overview.variants" :key="v">{{ v }}</option></select></label><label>兵模模板<select v-model="current.visualVariant" aria-label="国家兵模模板"><option :value="null">沿用兵种</option><option v-for="v in overview.variants" :key="v">{{ v }}</option></select></label><label>国旗模板<select v-model="current.flag" aria-label="国家国旗模板" @change="current.flagImage = null; current.image = undefined; current.frames = undefined"><option :value="null">自定义图片</option><option v-for="v in flagCodes" :key="v">{{ v }}</option></select></label></div>
        <div class="flag-previews"><figure><img v-if="current.flag || current.flagImage || current.image" :src="src(current, 0)" alt="静态国旗" /><figcaption>静态国旗</figcaption></figure><figure><img v-if="current.frames || current.flag || current.flagImage || current.image" :src="current.frames ? src(current, tick + 1) : current.image ? src(current, 0) : src(current, tick + 1)" alt="飘动国旗预览" /><figcaption>动画 · 4 帧 / 100 ms</figcaption></figure></div>
        <div class="actions"><button @click="imageInput?.click()"><Upload :size="15" />静态 PNG</button><button @click="framesInput?.click()"><Upload :size="15" />四帧 PNG</button><button v-if="current.frames" title="取消已上传动画" @click="current.frames = undefined"><X :size="16" /></button><input ref="imageInput" hidden type="file" accept="image/png" @change="run(() => uploadImage($event))" /><input ref="framesInput" hidden type="file" accept="image/png" multiple @change="run(() => uploadFrames($event))" /></div>
        <div v-if="pendingFrames.length" class="frame-order"><div v-for="(frame, i) in pendingFrames" :key="frame.name"><img :src="'data:image/png;base64,' + frame.data" :alt="'第 ' + (i + 1) + ' 帧'" /><span>{{ i + 1 }} · {{ frame.name }}</span><button title="前移帧" :disabled="i === 0" @click="moveFrame(i, -1)"><ArrowUp :size="14" /></button><button title="后移帧" :disabled="i === 3" @click="moveFrame(i, 1)"><ArrowDown :size="14" /></button></div><button @click="useFrames">采用此顺序</button></div>
      </div>
      <details v-if="view"><summary>{{ scenario }} · 国家绑定</summary><div class="bindings"><label v-for="f in view.factions" :key="f.index">槽位 {{ f.index }} · {{ f.id }}<select :value="assignments[f.index] ?? f.id" :aria-label="'绑定国家槽位 ' + f.index" @change="assignments[f.index] = ($event.target as HTMLSelectElement).value"><option v-for="r in rows" :key="r.id" :value="r.id">{{ r.name }} · {{ r.id }}</option></select></label></div></details>
    </fieldset>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="actions"><button :disabled="busy || disabled || (!dirty.length && !Object.keys(assignments).length)" @click="run(makePreview)"><Play :size="15" />预览国家修改</button><button v-if="preview" :disabled="busy || disabled || !preview.count" @click="run(apply)">应用国家修改 · {{ preview.count }}</button></div>
    <div v-if="preview" class="diff"><div v-for="(d, i) in preview.changes" :key="i"><strong>{{ d.object }} · {{ d.field }}</strong><span>{{ d.before }}</span><span>{{ d.after }}</span></div></div>
  </div>
</template>

<style scoped>
.country-panel { display:flex; flex-direction:column; gap:12px; min-height:0; font-size:12px; }fieldset { border:0; padding:0; margin:0; display:flex; flex-direction:column; gap:12px; min-width:0; }button,input,select { font:inherit; border:1px solid #bcc9c9; border-radius:4px; color:#253237; background:white; min-height:32px; box-sizing:border-box; max-width:100%; min-width:0; padding:5px 7px; }button { display:inline-flex; align-items:center; justify-content:center; gap:5px; cursor:pointer; }button:disabled { opacity:.45; cursor:default; }input[type=checkbox] { min-height:0; }input[type=color] { width:36px; padding:2px; flex:none; }.actions { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }.actions>input:not([type=color]) { flex:1; min-width:120px; }.country-table { overflow:auto; max-height:310px; border:1px solid #d7dfdb; }table { border-collapse:collapse; width:100%; }th,td { padding:5px; border-bottom:1px solid #d7dfdb; text-align:left; }th { position:sticky; top:0; background:#edf2ef; z-index:1; font-weight:500; }td>input { width:135px; }.color-field { display:flex; gap:4px; }.color-field>input:not([type=color]) { width:112px; }.active td { background:#e2efe9; }.flag-select { width:54px; height:34px; padding:2px; }.flag-select img { max-width:44px; max-height:26px; object-fit:contain; }.flag-editor { border-top:1px solid #cbd5d1; padding-top:10px; }h3 { font-size:13px; margin:0 0 10px; overflow-wrap:anywhere; }.variant-fields { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }label { display:flex; flex-direction:column; gap:5px; }select { width:100%; }.flag-previews { display:flex; gap:20px; margin:12px 0; }figure { margin:0; width:148px; }figure img { width:100%; height:70px; object-fit:contain; background:repeating-conic-gradient(#dce3e0 0% 25%,#f4f6f5 0% 50%) 0 0 / 12px 12px; image-rendering:pixelated; }figcaption { margin-top:5px; color:#60706c; }.frame-order { margin-top:8px; display:flex; flex-direction:column; gap:4px; }.frame-order>div { display:flex; align-items:center; gap:5px; }.frame-order img { width:60px; height:36px; object-fit:contain; }.frame-order span { flex:1; overflow-wrap:anywhere; min-width:0; }summary { cursor:pointer; }.bindings { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; }.error { color:#a03428; margin:0; }.diff { display:flex; flex-direction:column; gap:10px; }.diff>div { display:flex; flex-direction:column; gap:4px; overflow-wrap:anywhere; }.diff span { white-space:pre-wrap; color:#52615a; }@media(max-width:600px) { .variant-fields,.bindings { grid-template-columns:1fr; } }
</style>
