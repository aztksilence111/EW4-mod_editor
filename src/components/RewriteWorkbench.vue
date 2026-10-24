<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import Papa from 'papaparse'
import { Users, Layers, ShieldCheck, Undo2, Redo2, Download, Upload, X, MousePointer2, Hand, Scan, RefreshCw, FileDown, Play, Trash2, Swords } from 'lucide-vue-next'
import type { BtlProject, BinProject } from '../core/formats/types'
import { parseBtl } from '../core/formats/btl'
import { parseBin } from '../core/formats/bin'
import { api, fromBase64, download, exportMod, type Overview, type Rule, type Preview, type ModPreview, type ScenarioView } from '../core/editor/api'

const emit = defineEmits<{
  loaded: [project: BtlProject, terrain: BinProject, view: ScenarioView]
  selection: [cells: number[]]
  layer: [enabled: boolean]
  legacy: []
}>()
const overview = ref<Overview | null>(null)
const scenario = ref('conquest1')
const view = ref<ScenarioView | null>(null)
const panel = ref('commanders')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const search = ref('')
const country = ref('')
const selectedCommanders = ref<number[]>([])
const selectedScenarios = ref<string[]>(['conquest1', 'conquest2'])
const selectedCells = ref<number[]>([])
const selectionMode = ref('pan')
const rectangleStart = ref<{ x: number; y: number } | null>(null)
const jurisdictionLayer = ref(false)
const domain = ref('commanders')
const field = ref('cavalry')
const operation = ref('add')
const value = ref(1)
const rounding = ref('round')
const targetCountry = ref('fra')
const center = ref(-1)
const armyType = ref('')
const commander = ref('')
const skillId = ref('ew4.skill.0')
const skillSlot = ref(0)
const skillLevel = ref(1)
const selectionScope = ref('all')
const rules = ref<Rule[]>([])
const preview = ref<Preview | null>(null)
const armyRows = ref<{ slot: number; cell: number; type: number; commander: number }[]>([])
const selectedArmySlots = ref<number[]>([])
const deletionPreview = ref<Preview | null>(null)
const deletionSignature = () => JSON.stringify([overview.value?.revision, scenario.value, selectedArmySlots.value])
const modId = ref('my-rewrite-mod')
const modName = ref('我的 Rewrite Mod')
const modVersion = ref('0.1.0')
const importRef = ref<HTMLInputElement | null>(null)
const recipeRef = ref<HTMLInputElement | null>(null)
const csvRef = ref<HTMLInputElement | null>(null)
const packageRef = ref<HTMLInputElement | null>(null)
const packageFile = ref<File | null>(null)
const importMode = ref('merge')
const conflictPolicy = ref('reject')
const modPreview = ref<ModPreview | null>(null)
const referenceStatus = computed(() => {
  const report = view.value?.reverseReferences
  if (!report) return ''
  if (report.valid) return `引用校验通过 · ${report.byCell.length} 个关联地块`
  return `引用冲突 ${report.conflicts.length} 项 · ${report.byCell.length} 个关联地块`
})
const fieldLabels: Record<string, string> = { rank: '军衔', nobilityrank: '爵位', star: '星级', infantry: '步兵', cavalry: '骑兵', artillery: '炮兵', warship: '海军', fort: '要塞', business: '经济', movement: '移动', training: '训练', skill1: '技能槽 1', skill2: '技能槽 2', skill3: '技能槽 3', skill4: '技能槽 4', skillBinding: '注册技能绑定', item1: '装备槽 1', item2: '装备槽 2', price: '金钱', industry: '工业', food: '粮食', isNPC: 'AI 控制', camp: '阵营', armyType: '兵种', armyGrade: '等级', strengthNow: '当前兵力', strengthMax: '最大兵力', morale: '士气', commander: '携带将领', areaName: '城市 ID', constructionType: '建筑类型', constructionLevel: '建筑等级', constructionStyle: '建筑风格', capitalStyle: '首都风格', installationType: '设施类型', strongPoint: '据点标记', owner: '领土归属', center: '辖区中心' }
const domains: Record<string, string> = { commanders: '将领定义', factions: '国家资源', armies: '剧本部队', builds: '城市设施', territory: '领土归属', jurisdictions: '手工辖区' }
const fields: Record<string, string[]> = {
  commanders: ['rank','nobilityrank','star','infantry','cavalry','artillery','warship','fort','business','movement','training','skill1','skill2','skill3','skill4','item1','item2','skillBinding'],
  factions: ['price','industry','food','isNPC','camp'], armies: ['armyType','armyGrade','strengthNow','strengthMax','training','movement','morale','commander'],
  builds: ['areaName','constructionType','constructionLevel','constructionStyle','capitalStyle','installationType','strongPoint'], territory: ['owner'], jurisdictions: ['center'],
}
const visible = computed(() => overview.value?.commanders.filter(c => (!country.value || c.country === country.value) && (!search.value || `${c.id} ${c.name} ${c.displayName}`.toLowerCase().includes(search.value.toLowerCase()))) ?? [])
const countries = computed(() => [...new Set(overview.value?.commanders.map(c => c.country) ?? [])].sort())
const isMapDomain = computed(() => ['armies','builds','territory','jurisdictions'].includes(domain.value))
const isSkillBinding = computed(() => domain.value === 'commanders' && field.value === 'skillBinding')
watch(domain, v => { field.value = fields[v]?.[0] ?? ''; if (['territory','jurisdictions'].includes(v)) operation.value = 'set' })
watch([rules, selectedScenarios], () => { preview.value = null }, { deep: true })
watch([selectedArmySlots, scenario], () => { deletionPreview.value = null }, { deep: true })
watch(jurisdictionLayer, v => emit('layer', v))
watch([importMode, conflictPolicy, packageFile], () => { modPreview.value = null })
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
async function loadScenario() {
  preview.value = null; deletionPreview.value = null; selectedArmySlots.value = []; rectangleStart.value = null
  const next = await api<ScenarioView>('scenario/' + scenario.value)
  const terrainResponse = await fetch('/editor-api/terrain/' + next.mapId)
  if (!terrainResponse.ok) throw new Error('地图读取失败')
  const terrain = parseBin(await terrainResponse.arrayBuffer())
  view.value = next; selectedCells.value = []; emit('selection', [])
  const project = parseBtl(fromBase64(next.bytes))
  armyRows.value = project.armies.map((army, slot) => ({ slot, cell: army.index, type: army.armyType, commander: army.commander }))
  emit('loaded', project, terrain, next)
}
async function refresh() {
  modPreview.value = null; preview.value = null; deletionPreview.value = null
  overview.value = await api<Overview>('project')
  if (!overview.value.scenarios.some(s => s.id === scenario.value)) scenario.value = overview.value.scenarios[0]?.id ?? ''
  await loadScenario()
}
function togglePanel(key: string) {
  panel.value = panel.value === key ? '' : key
  if (key === 'commanders') domain.value = 'commanders'
}
function selectTile(x: number, y: number) {
  if (!view.value || selectionMode.value === 'pan') return
  const cell = y * view.value.mapWidth + x
  if (selectionMode.value === 'point') {
    selectedCells.value = selectedCells.value.includes(cell) ? selectedCells.value.filter(c => c !== cell) : [...selectedCells.value, cell]
  } else if (!rectangleStart.value) { rectangleStart.value = { x, y }; selectedCells.value = [cell] }
  else {
    const start = rectangleStart.value; const result: number[] = []
    for (let row = Math.min(y, start.y); row <= Math.max(y, start.y); row++)
      for (let col = Math.min(x, start.x); col <= Math.max(x, start.x); col++) result.push(row * view.value.mapWidth + col)
    selectedCells.value = result; rectangleStart.value = null
  }
  emit('selection', selectedCells.value)
}
defineExpose({ selectTile })
function selectMapArmies() {
  selectedArmySlots.value = armyRows.value.filter(a => selectedCells.value.includes(a.cell)).map(a => a.slot)
  panel.value = 'armies'
}
async function previewArmyDeletion() {
  if (!overview.value || !view.value || !selectedArmySlots.value.length) return
  deletionPreview.value = null
  const signature = deletionSignature()
  const result = await api<Preview>('preview', { revision: overview.value.revision, taskId: crypto.randomUUID(),
    scenarios: [scenario.value], rules: [{ domain: 'armies', field: 'record', operation: 'delete', value: 0,
      filter: { ids: [...selectedArmySlots.value], mapId: view.value.mapId } }] })
  if (signature !== deletionSignature()) throw new Error('部队选择已变化，请重新预览')
  deletionPreview.value = result
}
async function applyArmyDeletion() {
  const candidate = deletionPreview.value
  if (!candidate || !overview.value) return
  deletionPreview.value = null
  await api('apply', { revision: candidate.revision, token: candidate.token, taskId: candidate.taskId })
  await refresh(); notice.value = '部队删除已保存'
}
function addRule() {
  error.value = ''; preview.value = null
  if (selectionScope.value === 'selected' && isMapDomain.value && selectedCells.value.length === 0) { error.value = '地图选区为空'; return }
  const ids = domain.value === 'commanders' ? (selectedCommanders.value.length ? selectedCommanders.value.filter(id => visible.value.some(c => Number(c.id) === id)) : visible.value.map(c => Number(c.id))) : undefined
  rules.value.push({ domain: domain.value, field: field.value, operation: operation.value, value: Number(value.value), rounding: rounding.value,
    filter: { country: country.value || undefined, ids, cells: isMapDomain.value && selectionScope.value === 'selected' ? [...selectedCells.value] : undefined,
      mapId: isMapDomain.value && selectionScope.value === 'selected' ? view.value?.mapId : undefined,
      armyType: armyType.value === '' ? undefined : Number(armyType.value), commander: commander.value === '' ? undefined : Number(commander.value) },
    targetCountry: targetCountry.value, center: Number(center.value), skillId: domain.value === 'commanders' && field.value === 'skillBinding' ? skillId.value : undefined,
    skillSlot: domain.value === 'commanders' && field.value === 'skillBinding' ? Number(skillSlot.value) : undefined,
    skillLevel: domain.value === 'commanders' && field.value === 'skillBinding' ? Number(skillLevel.value) : undefined })
  panel.value = 'batch'
}
async function makePreview() {
  if (!overview.value) return
  preview.value = null
  const signature = JSON.stringify([rules.value, selectedScenarios.value])
  const result = await api<Preview>('preview', { revision: overview.value.revision, taskId: crypto.randomUUID(), scenarios: selectedScenarios.value, rules: rules.value })
  if (signature !== JSON.stringify([rules.value, selectedScenarios.value])) throw new Error('规则已变化，请重新预览')
  preview.value = result
}
async function apply() {
  if (!preview.value || !overview.value) return
  await api('apply', { revision: overview.value.revision, token: preview.value.token, taskId: preview.value.taskId })
  preview.value = null; await refresh(); notice.value = '整批修改已保存'
}
async function history(direction: string) {
  if (!overview.value) return
  await api('history', { revision: overview.value.revision, direction }); preview.value = null; await refresh()
}
async function saveAuthor() {
  const response = await fetch('/editor-api/author'); if (!response.ok) throw new Error('工程导出失败')
  download(await response.blob(), modId.value + '.ew4author')
}
async function validateProject() {
  const result = await api<{ scenarios: number }>('validate', {})
  notice.value = `${result.scenarios} 个剧本验证通过`
}
async function packageProject() {
  if (!overview.value) return
  await exportMod({ revision: overview.value.revision, id: modId.value, name: modName.value, version: modVersion.value }, modId.value)
  notice.value = '内容包已导出'
}
async function restoreAuthor(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !overview.value) return
  await api('restore', { revision: overview.value.revision, document: await file.text() }); preview.value = null; await refresh(); input.value = ''
}
function selectPackage(event: Event) {
  const input = event.target as HTMLInputElement
  packageFile.value = input.files?.[0] ?? null; input.value = ''
}
async function previewPackage() {
  if (!packageFile.value || !overview.value) return
  modPreview.value = null
  if (packageFile.value.size > 20 * 1024 * 1024) throw new Error('内容包不能超过 20 MiB')
  const encoded = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1]!)
    reader.onerror = () => reject(new Error('内容包读取失败'))
    reader.readAsDataURL(packageFile.value!)
  })
  modPreview.value = await api<ModPreview>('mod-preview', { revision: overview.value.revision,
    taskId: crypto.randomUUID(), package: encoded, mode: importMode.value, conflict: conflictPolicy.value })
}
async function applyPackage() {
  if (!modPreview.value?.token || !overview.value) return
  const metadata = modPreview.value.package
  await api('apply', { revision: overview.value.revision, taskId: modPreview.value.taskId, token: modPreview.value.token })
  preview.value = null; await refresh()
  modId.value = metadata.id; modName.value = metadata.name; modVersion.value = metadata.version
  notice.value = '内容包已导入并保存'
}
function exportRecipe() { download(new Blob([JSON.stringify({ schema: 1, scenarios: selectedScenarios.value, rules: rules.value }, null, 2)], { type: 'application/json' }), 'recipe.json') }
async function importRecipe(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return
  const data = JSON.parse(await file.text())
  if (data.schema !== 1 || !Array.isArray(data.rules) || !Array.isArray(data.scenarios)) throw new Error('配方格式无效')
  if (data.scenarios.some((id: string) => !overview.value?.scenarios.some(s => s.id === id))) throw new Error('配方含未知剧本')
  rules.value = data.rules; selectedScenarios.value = data.scenarios; input.value = ''
}
function exportCsv() {
  if (!overview.value) return
  const rows = visible.value.map(c => Object.fromEntries(['schema','sourceHash','id','name','country',...fields.commanders.filter(f => f !== 'skillBinding')].map(f =>
    [f, f === 'schema' ? '1' : f === 'sourceHash' ? overview.value!.commanderSourceHash : c[f]])))
  download(new Blob(['\uFEFF' + Papa.unparse(rows)], { type: 'text/csv;charset=utf-8' }), 'commanders.csv')
}
async function importCsv(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file || !overview.value) return
  const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: 'greedy' })
  if (parsed.errors.length || parsed.meta.renamedHeaders) throw new Error('CSV列数、引号或重复表头无效')
  preview.value = await api<Preview>('csv-preview', { revision: overview.value.revision, taskId: crypto.randomUUID(), rows: parsed.data })
  panel.value = 'batch'; input.value = ''
}
onMounted(() => run(refresh))
</script>

<template>
  <header class="rewrite-toolbar">
    <strong>EW4 <span>Rewrite Mod 编辑器</span></strong>
    <select v-model="scenario" aria-label="当前剧本" :disabled="busy" @change="run(loadScenario)"><option v-for="s in overview?.scenarios" :key="s.id" :value="s.id">{{ s.name }} · {{ s.id }}{{ s.modified ? ' *' : '' }}</option></select>
    <div class="view-tabs"><button v-for="(label, key) in { commanders: '将领', armies: '部队', batch: '批处理', export: '验证导出' }" :key="key" :class="{ active: panel === key }" @click="togglePanel(key)"><component :is="key === 'commanders' ? Users : key === 'armies' ? Swords : key === 'batch' ? Layers : ShieldCheck" :size="16" />{{ label }}</button></div>
    <button title="撤销整批" :disabled="busy || !overview?.canUndo" @click="run(() => history('undo'))"><Undo2 :size="18" /></button>
    <button title="重做整批" :disabled="busy || !overview?.canRedo" @click="run(() => history('redo'))"><Redo2 :size="18" /></button>
    <span class="revision">r{{ overview?.revision ?? 0 }}</span>
    <button title="刷新工程" :disabled="busy" @click="run(refresh)"><RefreshCw :size="16" /></button>
    <button class="legacy" @click="emit('legacy')">原版示例</button>
  </header>
  <div class="map-tools">
    <button v-for="(icon, key) in { pan: Hand, point: MousePointer2, rectangle: Scan }" :key="key" :class="{ active: selectionMode === key }" :title="key === 'pan' ? '平移' : key === 'point' ? '点选' : '矩形选区：两个角点'" @click="selectionMode = key; rectangleStart = null"><component :is="icon" :size="18" /></button>
    <span>{{ selectedCells.length }} 格{{ rectangleStart ? ' · 待选终点' : '' }}</span>
    <button title="清空选区" @click="selectedCells = []; emit('selection', [])"><X :size="16" /></button>
    <button title="选择选区部队" :disabled="busy || !selectedCells.length" @click="selectMapArmies"><Swords :size="16" /></button>
    <label><input v-model="jurisdictionLayer" type="checkbox" />辖区层</label>
    <span v-if="view" class="reference-status" :class="{ invalid: !view.reverseReferences.valid }" :title="view.reverseReferences.conflicts.map(c => c.detail).join('\n')">{{ referenceStatus }}</span>
  </div>
  <div v-if="busy || error || notice" class="feedback" :class="{ error }" role="status">{{ busy ? '正在处理…' : error || notice }}</div>
  <aside v-if="panel" class="author-panel" :aria-busy="busy">
    <div class="panel-heading"><h2>{{ panel === 'commanders' ? '将领定义' : panel === 'armies' ? '剧本部队' : panel === 'batch' ? '批处理' : '验证与导出' }}</h2><span>{{ overview?.files.length ?? 0 }} 个覆盖文件</span><button title="关闭面板" @click="panel = ''"><X :size="18" /></button></div>
    <div v-if="panel === 'armies'" class="panel-body army-panel">
      <div class="filters"><span>{{ scenario }} · {{ armyRows.length }} 支部队 · 已选 {{ selectedArmySlots.length }}</span><button title="选择选区部队" :disabled="busy || !selectedCells.length" @click="selectMapArmies"><Swords :size="16" /></button><button title="清空部队选择" :disabled="busy || !selectedArmySlots.length" @click="selectedArmySlots = []"><X :size="16" /></button></div>
      <div class="actions"><button :disabled="busy || !selectedArmySlots.length" @click="run(previewArmyDeletion)"><Trash2 :size="16" />预览删除</button><button v-if="deletionPreview" title="取消删除预览" :disabled="busy" @click="deletionPreview = null"><X :size="16" /></button><button v-if="deletionPreview" :disabled="busy || !deletionPreview.count" @click="run(applyArmyDeletion)"><Trash2 :size="16" />应用删除</button></div>
      <template v-if="deletionPreview">
        <div class="deletion-summary">删除 {{ deletionPreview.count }} 支部队 · {{ deletionPreview.affectedScenarios }} 个剧本</div>
        <div class="table-scroll deletion-targets"><table><thead><tr><th>删除目标</th><th>原槽位</th></tr></thead><tbody><tr v-for="(change, i) in deletionPreview.changes" :key="i"><td>{{ change.object }}</td><td>{{ change.before }}</td></tr></tbody></table></div>
        <div v-for="migration in deletionPreview.slotMigrations" :key="migration.file + ':' + migration.ruleIndex" class="migration-section"><h3>{{ migration.file }} · 槽位迁移</h3><div class="table-scroll migration-table"><table><thead><tr><th>原槽位</th><th>新槽位</th></tr></thead><tbody><tr v-for="(next, old) in migration.oldToNew" :key="old"><td>{{ old }}</td><td :class="{ removed: next === null }">{{ next === null ? '删除' : next }}</td></tr></tbody></table></div></div>
      </template>
      <div v-else class="table-scroll armies-table"><table><thead><tr><th>选择</th><th>当前槽位</th><th>地块</th><th>兵种</th><th>将领</th></tr></thead><tbody><tr v-for="army in armyRows" :key="army.slot"><td><input v-model="selectedArmySlots" type="checkbox" :value="army.slot" :disabled="busy" :aria-label="'选择部队槽位 ' + army.slot" /></td><td>{{ army.slot }}</td><td>{{ army.cell }}</td><td>{{ army.type }}</td><td>{{ army.commander }}</td></tr></tbody></table></div>
    </div>
    <div v-else-if="panel === 'commanders'" class="panel-body">
      <div class="filters"><input v-model="search" placeholder="将领 ID / 名称" aria-label="搜索将领" /><select v-model="country" aria-label="将领国家"><option value="">全部国家</option><option v-for="c in countries" :key="c">{{ c }}</option></select><span>{{ visible.length }} 位 · 已选 {{ selectedCommanders.length }}</span><button title="导出 CSV" :disabled="busy || !visible.length" @click="exportCsv"><FileDown :size="16" /></button><button title="导入 CSV" :disabled="busy" @click="csvRef?.click()"><Upload :size="16" /></button><input ref="csvRef" hidden type="file" accept=".csv" @change="run(() => importCsv($event))" /></div>
      <div class="table-scroll commanders-table"><table><thead><tr><th><input type="checkbox" title="选择筛选结果" :checked="visible.length > 0 && visible.every(c => selectedCommanders.includes(Number(c.id)))" @change="selectedCommanders = ($event.target as HTMLInputElement).checked ? visible.map(c => Number(c.id)) : []" /></th><th>ID</th><th>将领</th><th>国家</th><th>原定义技能</th><th>最终有效技能</th><th v-for="f in ['infantry','cavalry','artillery','warship','movement','training']" :key="f">{{ fieldLabels[f] }}</th></tr></thead><tbody><tr v-for="c in visible" :key="c.id"><td><input v-model="selectedCommanders" type="checkbox" :value="Number(c.id)" :aria-label="'选择 ' + c.displayName" /></td><td>{{ c.id }}</td><td :title="c.name">{{ c.displayName }}</td><td>{{ c.country }}</td><td class="skill-cell" :title="c.originalSkills.map(s => s.description).join('\n')">{{ c.originalSkills.map(s => s.name).join('、') || '无' }}</td><td class="skill-cell" :title="c.effectiveSkills.map(s => s.description).join('\n')">{{ c.effectiveSkills.map(s => s.name).join('、') || '无' }}{{ c.skillBinding ? ' · 绑定' : '' }}</td><td v-for="f in ['infantry','cavalry','artillery','warship','movement','training']" :key="f">{{ c[f] }}</td></tr></tbody></table></div>
      <div class="rule-controls"><select v-model="field" aria-label="将领字段"><option v-for="f in fields.commanders" :key="f" :value="f">{{ fieldLabels[f] }}</option></select><template v-if="!isSkillBinding"><select v-model="operation" aria-label="运算"><option value="set">赋值</option><option value="add">增加</option><option value="multiply">倍率</option></select><input v-model.number="value" type="number" aria-label="数值" /><select v-model="rounding" aria-label="取整方式"><option value="round">四舍五入</option><option value="floor">向下取整</option><option value="ceil">向上取整</option></select></template><button :disabled="busy || !visible.length" @click="domain = 'commanders'; addRule()"><Layers :size="15" />加入批处理</button></div>
      <div v-if="field === 'skillBinding'" class="rule-controls skill-binding-controls"><select v-model="skillId" aria-label="注册技能"><option v-for="skill in overview?.skills" :key="skill.id" :value="skill.id">{{ skill.name }} · {{ skill.id }}</option></select><input v-model.number="skillSlot" type="number" min="0" max="15" aria-label="技能槽位" /><input v-model.number="skillLevel" type="number" min="1" max="99" aria-label="技能等级" /><select v-model="operation" aria-label="绑定操作"><option value="set">替换槽位</option><option value="remove">移除槽位</option></select></div>
    </div>
    <div v-else-if="panel === 'batch'" class="panel-body">
      <div class="scenario-picker"><label>目标剧本 <span>{{ selectedScenarios.length }} / {{ overview?.scenarios.length }}</span></label><div><label v-for="s in overview?.scenarios" :key="s.id"><input v-model="selectedScenarios" type="checkbox" :value="s.id" />{{ s.id }}</label></div></div>
      <div class="rule-controls"><select v-model="domain" aria-label="编辑对象"><option v-for="(label, key) in domains" :key="key" :value="key">{{ label }}</option></select><select v-model="field" aria-label="修改字段"><option v-for="f in fields[domain]" :key="f" :value="f">{{ fieldLabels[f] }}</option></select><select v-model="country" aria-label="筛选国家"><option value="">全部国家</option><option v-for="c in [...new Set([...countries, ...(view?.factions.map(f => f.id) ?? [])])]" :key="c">{{ c }}</option></select></div>
      <div class="rule-controls">
        <template v-if="!['territory','jurisdictions'].includes(domain) && !isSkillBinding"><select v-model="operation" aria-label="批量运算"><option value="set">赋值</option><option value="add">增加</option><option value="multiply">倍率</option></select><input v-model.number="value" type="number" aria-label="批量数值" /><select v-model="rounding" aria-label="批量取整"><option value="round">四舍五入</option><option value="floor">向下取整</option><option value="ceil">向上取整</option></select></template>
        <template v-if="isSkillBinding"><select v-model="skillId" aria-label="注册技能"><option v-for="skill in overview?.skills" :key="skill.id" :value="skill.id">{{ skill.name }} · {{ skill.id }}</option></select><input v-model.number="skillSlot" type="number" min="0" max="15" aria-label="技能槽位" /><input v-model.number="skillLevel" type="number" min="1" max="99" aria-label="技能等级" /><select v-model="operation" aria-label="绑定操作"><option value="set">替换槽位</option><option value="remove">移除槽位</option></select></template>
        <input v-if="domain === 'territory'" v-model="targetCountry" placeholder="目标国家 ID" aria-label="目标国家" />
        <input v-if="domain === 'jurisdictions'" v-model.number="center" type="number" aria-label="辖区中心格号，-1 为无辖区" placeholder="中心格号" />
        <select v-if="isMapDomain" v-model="selectionScope" aria-label="地图范围"><option value="all">全部区域</option><option value="selected">地图选区 {{ selectedCells.length }} 格</option></select>
        <input v-if="domain === 'armies'" v-model="armyType" type="number" placeholder="兵种筛选" aria-label="兵种筛选" /><input v-if="domain === 'armies'" v-model="commander" type="number" placeholder="携带将领筛选" aria-label="携带将领筛选" />
        <button :disabled="busy" @click="addRule"><Layers :size="15" />添加规则</button>
      </div>
      <ol class="rules"><li v-for="(rule, i) in rules" :key="i"><span>{{ domains[rule.domain] }} · {{ fieldLabels[rule.field] }} · {{ rule.operation }} {{ rule.field === 'skillBinding' ? rule.skillId + ' @' + rule.skillSlot : ['territory'].includes(rule.domain) ? rule.targetCountry : rule.domain === 'jurisdictions' ? rule.center : rule.value }} <small>{{ rule.filter.country || '全部国家' }}{{ rule.filter.cells ? ' · ' + rule.filter.cells.length + ' 格' : '' }}{{ rule.filter.ids ? ' · ' + rule.filter.ids.length + ' 位' : '' }}</small></span><button title="移除规则" :disabled="busy" @click="rules.splice(i, 1)"><X :size="14" /></button></li></ol>
      <div class="actions"><button :disabled="busy || !rules.length" @click="run(makePreview)"><Play :size="15" />预览差异</button><button title="导出配方" :disabled="busy" @click="exportRecipe"><FileDown :size="16" /></button><button title="导入配方" :disabled="busy" @click="recipeRef?.click()"><Upload :size="16" /></button><input ref="recipeRef" hidden type="file" accept=".json" @change="run(() => importRecipe($event))" /></div>
      <template v-if="preview"><div class="preview-heading"><span>{{ preview.count }} 项变化 · {{ preview.affectedScenarios }} 个剧本</span><button :disabled="busy || !preview.count" @click="run(apply)">应用整批</button></div><div class="table-scroll diff-table"><table><thead><tr><th>文件 / 对象</th><th>字段</th><th>原值</th><th>新值</th></tr></thead><tbody><tr v-for="(d, i) in preview.changes.slice(0, 500)" :key="i"><td>{{ d.file }}<small>{{ d.object }}</small></td><td>{{ fieldLabels[d.field] || d.field }}</td><td>{{ d.before }}</td><td class="changed">{{ d.after }}</td></tr></tbody></table></div><span v-if="preview.count > 500">显示前 500 项</span></template>
    </div>
    <div v-else class="panel-body export-panel">
      <dl><dt>基础资源</dt><dd>{{ overview?.baseline }}</dd><dt>工程 ID</dt><dd>{{ overview?.id }}</dd><dt>修订</dt><dd>{{ overview?.revision }}</dd></dl>
      <div class="actions"><button :disabled="busy" @click="run(validateProject)"><ShieldCheck :size="16" />完整校验</button><button :disabled="busy" @click="run(saveAuthor)"><Download :size="16" />作者工程</button><button :disabled="busy" @click="importRef?.click()"><Upload :size="16" />恢复工程</button><input ref="importRef" hidden type="file" accept=".ew4author" @change="run(() => restoreAuthor($event))" /></div>
      <h3>导入内容包</h3>
      <div class="actions"><button :disabled="busy" @click="packageRef?.click()"><Upload :size="16" />选择 .ew4mod</button><span class="package-name">{{ packageFile?.name ?? '未选择文件' }}</span><input ref="packageRef" hidden type="file" accept=".ew4mod" @change="selectPackage" /></div>
      <label>导入方式<select v-model="importMode" :disabled="busy"><option value="merge">合并到当前工程</option><option value="replace">替换整个工程内容</option></select></label>
      <label v-if="importMode === 'merge'">文件冲突<select v-model="conflictPolicy" :disabled="busy"><option value="reject">有冲突时暂停</option><option value="keep">保留工程文件</option><option value="incoming">采用包内文件</option></select></label>
      <div class="actions"><button :disabled="busy || !packageFile" @click="run(previewPackage)"><Scan :size="16" />预览导入</button><button v-if="modPreview?.token" :disabled="busy || !modPreview.count" @click="run(applyPackage)"><Upload :size="16" />应用导入</button></div>
      <template v-if="modPreview"><p>{{ modPreview.package.name }} · {{ modPreview.package.version }} · {{ modPreview.count }} 项变化 · {{ modPreview.affectedScenarios }} 个剧本</p><ul v-if="modPreview.package.warnings.length" class="file-list"><li v-for="warning in modPreview.package.warnings" :key="warning">{{ warning }}</li></ul><p v-if="modPreview.conflicts.length">{{ modPreview.conflicts.length }} 个文件冲突{{ modPreview.token ? '' : '，请选择处理方式后重新预览' }}</p><ul class="file-list"><li v-for="conflict in modPreview.conflicts" :key="conflict.path">{{ conflict.path }}</li></ul><div v-if="modPreview.changes.length" class="table-scroll import-diff"><table><thead><tr><th>文件</th><th>原值</th><th>新值</th></tr></thead><tbody><tr v-for="(change, i) in modPreview.changes" :key="i"><td>{{ change.file }}</td><td>{{ change.before }}</td><td>{{ change.after }}</td></tr></tbody></table></div></template>
      <h3>导出内容包</h3>
      <label>Mod ID<input v-model="modId" pattern="[a-z0-9_.\-]+" /></label><label>名称<input v-model="modName" /></label><label>版本<input v-model="modVersion" /></label>
      <button class="export-button" :disabled="busy || !overview" @click="run(packageProject)"><Download :size="17" />校验并导出 .ew4mod</button>
      <ul class="file-list"><li v-for="file in overview?.overrides" :key="file.path"><span>{{ file.path }}</span><small> · {{ file.source ?? '本地修改' }}{{ file.edited ? ' · 已再编辑' : '' }}</small></li></ul>
    </div>
  </aside>
</template>

<style scoped>
.rewrite-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:7px; background:#f4f6f6; color:#20262c; padding:10px 14px; border-bottom:1px solid #c8d0d1; z-index:65; }
.rewrite-toolbar strong { font-size:18px; margin-right:10px; white-space:nowrap; }.rewrite-toolbar strong span { font-size:13px; font-weight:500; }
button { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:32px; padding:5px 9px; background:#f8faf9; color:#253237; border:1px solid #c1ccce; border-radius:4px; font-size:12px; white-space:nowrap; }
button:hover { background:#e4ece9; }button:disabled { opacity:.45; cursor:default; }button.active,.actions>button:first-child,.preview-heading button,.export-button { background:#236d59; color:white; border-color:#236d59; }
.view-tabs { display:flex; gap:3px; }.revision { font-size:12px; color:#57646a; }.legacy { margin-left:auto; }
input,select { box-sizing:border-box; min-height:32px; min-width:0; max-width:100%; border:1px solid #bcc9c9; border-radius:4px; background:#fff; color:#1f2b30; padding:5px 7px; font:12px system-ui; }
input[type=number] { width:95px; }input[type=checkbox] { min-height:auto; accent-color:#236d59; }select { max-width:240px; }
.map-tools { position:absolute; top:76px; left:12px; z-index:55; display:flex; flex-wrap:wrap; align-items:center; gap:5px; max-width:calc(100% - 24px); padding:5px; background:#f6f8f6; color:#263532; border:1px solid #b9c8c4; border-radius:4px; font-size:12px; }
.map-tools label { display:flex; align-items:center; gap:4px; }.feedback { position:fixed; bottom:18px; left:16px; z-index:150; max-width:calc(100% - 48px); max-height:25vh; overflow:auto; padding:10px 14px; border:1px solid #86ac98; background:#e4f1e9; color:#22533d; font-size:13px; white-space:pre-wrap; }.feedback.error { background:#fff0ed; color:#9e3027; border-color:#dcaba2; }
.reference-status { color:#236d59; max-width:360px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.reference-status.invalid { color:#a63b2d; font-weight:600; }
.author-panel { position:absolute; z-index:60; top:120px; bottom:16px; right:14px; width:min(760px,calc(100% - 28px)); display:flex; flex-direction:column; background:#f8faf9; color:#253237; border:1px solid #b9c8c4; border-radius:5px; box-shadow:0 8px 22px #0002; }
.panel-heading { display:flex; align-items:center; gap:12px; padding:10px 12px; border-bottom:1px solid #cbd5d1; }.panel-heading h2 { font-size:15px; margin:0; }.panel-heading span { flex:1; color:#60706c; font-size:12px; }.panel-heading button { border:0; }
.panel-body { padding:12px; overflow:auto; flex:1; min-height:0; display:flex; flex-direction:column; gap:12px; }.filters,.rule-controls,.actions { display:flex; align-items:center; flex-wrap:wrap; gap:7px; }.filters span { font-size:12px; color:#6c7771; }.filters input { flex:1; min-width:150px; }
.table-scroll { overflow:auto; border:1px solid #d7dfdb; background:white; flex-shrink:0; }.commanders-table { flex:1; min-height:160px; }.diff-table { max-height:300px; }table { border-collapse:collapse; font-size:12px; width:100%; white-space:nowrap; user-select:text; }th,td { padding:7px 9px; border-bottom:1px solid #e2e8e5; text-align:left; }thead { position:sticky; top:0; z-index:1; background:#edf2ef; color:#52615a; }th { font-weight:500; }tr:hover td { background:#f2f7f3; }td small { display:block; color:#71827a; font-size:11px; }.changed { color:#137254; font-weight:600; }
.skill-cell { max-width:180px; white-space:normal; line-height:1.35; }
.armies-table { flex:1; min-height:140px; }.deletion-summary { font-size:13px; color:#9e3027; }.deletion-targets { max-height:160px; }.migration-section { min-width:0; }.migration-section h3 { margin:0 0 8px; font-size:12px; overflow-wrap:anywhere; }.migration-table { max-height:230px; }.removed { color:#9e3027; font-weight:600; }
.scenario-picker>label { display:flex; justify-content:space-between; font-size:13px; margin-bottom:7px; }.scenario-picker>div { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); max-height:126px; overflow:auto; padding:6px; background:#edf2ef; border:1px solid #d3ddd7; }.scenario-picker>div label { display:flex; gap:5px; align-items:center; font-size:11px; padding:3px; }
.rules { margin:0; padding-left:22px; font-size:12px; }.rules li { padding:7px 0; border-bottom:1px solid #d4ddd6; }.rules li>span { display:inline-block; width:calc(100% - 40px); }.rules small { display:block; color:#61766a; margin-top:4px; }.rules button { min-height:24px; padding:2px 5px; }
.preview-heading { display:flex; justify-content:space-between; align-items:center; font-size:13px; }.export-panel>label { font-size:12px; display:flex; flex-direction:column; gap:6px; max-width:380px; }.export-panel dl { margin:0; font-size:12px; user-select:text; }.export-panel dt { color:#6a7870; margin-bottom:4px; }.export-panel dd { margin:0 0 12px; overflow-wrap:anywhere; }.export-button { align-self:flex-start; }.file-list { font-size:12px; margin:0; padding-left:18px; user-select:text; overflow-wrap:anywhere; }
.export-panel h3 { margin:8px 0 0; font-size:14px; }.package-name { font-size:12px; overflow-wrap:anywhere; min-width:0; }.import-diff { max-height:220px; flex:none; }.import-diff td { max-width:230px; white-space:normal; overflow-wrap:anywhere; }.export-panel p { margin:0; font-size:12px; overflow-wrap:anywhere; }
@media(max-width:800px) { .rewrite-toolbar { padding:7px; gap:5px; }.rewrite-toolbar strong { width:100%; }.rewrite-toolbar select { flex:1; max-width:100%; }.view-tabs { order:2; }.legacy { font-size:11px; }.author-panel { top:220px; bottom:8px; right:8px; width:calc(100% - 16px); }.map-tools { top:150px; left:8px; }.panel-body { padding:9px; }.scenario-picker>div { grid-template-columns:repeat(2,minmax(0,1fr)); }.commanders-table { min-height:120px; }.rule-controls>* { flex:1; }.rule-controls button { flex-basis:100%; } }
</style>
