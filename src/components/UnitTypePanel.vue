<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, type Overview, type Preview, type ScenarioView } from '../core/editor/api'

const props = defineProps<{ overview: Overview; scenario: string; view: ScenarioView | null; cells: number[]; disabled: boolean }>()
const emit = defineEmits<{ changed: [] }>()
interface UnitRow { id: string; attributes: Record<string, any>; visual: Record<string, any>; recruitment: Record<string, any>[] }
interface UnitCatalog { revision: number; supported: boolean; units: UnitRow[] }
const catalog = ref<UnitCatalog | null>(null)
const search = ref('')
const selected = ref('ew4.unit.fra.militia.0')
const originalId = ref<string | null>(null)
const templateId = ref('')
const id = ref('mod.unit.custom.0')
const name = ref('新兵种')
const description = ref('')
const visualTemplate = ref('')
const attributes = ref<Record<string, any>>({})
const advanced = ref('{}')
const recruit = ref(true)
const building = ref('city')
const minimumLevel = ref(1)
const money = ref(100), industry = ref(0), food = ref(0)
const countries = ref<string[]>([]), scenarios = ref<string[]>([])
const busy = ref(false), error = ref(''), notice = ref('')
const preview = ref<Preview | null>(null)
const faction = ref(0), instance = ref('mod.reinforcement.first'), cell = ref(0), ready = ref(true)
let generation = 0
const numbers: Record<string, string> = { max_health: '满兵力', movement: '移动力', minimum_attack: '最低攻击', maximum_attack: '最高攻击', minimum_range: '最小射程', maximum_range: '最大射程', food_consumption: '每回合粮耗', kill_experience: '击杀经验', ignition_numerator: '点燃概率分子', ignition_denominator: '点燃概率分母' }
const advancedKeys = ['attack_bands', 'damage_multipliers', 'traits', 'skill_slots']
const visible = computed(() => catalog.value?.units.filter(u => `${u.id} ${u.visual?.name}`.toLowerCase().includes(search.value.toLowerCase())) ?? [])
const current = computed(() => catalog.value?.units.find(u => u.id === selected.value))
const locked = computed(() => busy.value || props.disabled)
async function run(action: () => Promise<void>) { busy.value = true; error.value = ''; try { await action() } catch (e) { error.value = (e as Error).message } finally { busy.value = false } }
async function load() {
  const seq = ++generation
  const next = await api<UnitCatalog>('unit-types')
  if (seq !== generation) return
  catalog.value = next
  if (!next.units.some(u => u.id === selected.value)) selected.value = next.units[0]?.id ?? ''
  preview.value = null
}
watch(() => props.overview.revision, () => run(load), { immediate: true })
watch(() => props.cells, cells => { if (cells.length === 1) cell.value = cells[0]! }, { deep: true })
watch(() => props.scenario, () => { preview.value = null; faction.value = 0 })
function choose(copy: boolean) {
  const row = current.value; if (!row) return
  originalId.value = copy ? null : row.id
  templateId.value = row.id
  id.value = copy ? 'mod.unit.custom.' + (catalog.value?.units.filter(u => u.id.startsWith('mod.unit.custom.')).length ?? 0) : row.id
  name.value = copy ? row.visual.name + '（新兵种）' : row.visual.name
  description.value = row.visual.description ?? ''; visualTemplate.value = row.id
  attributes.value = Object.fromEntries(Object.entries(structuredClone(JSON.parse(JSON.stringify(row.attributes)))).filter(([k]) => k in numbers || ['category', 'grade', 'weapon'].includes(k)))
  advanced.value = JSON.stringify(Object.fromEntries(advancedKeys.filter(k => row.attributes[k] != null).map(k => [k, row.attributes[k]])), null, 2)
  const offer = row.recruitment.find(o => o.id === row.id + '.recruit')
  recruit.value = copy || !!offer; building.value = offer?.buildingKinds?.[0] ?? (attributes.value.category === 'naval' ? 'port' : 'city')
  minimumLevel.value = offer?.minimumLevel ?? 1
  money.value = offer?.cost.money ?? 100; industry.value = offer?.cost.industry ?? 0; food.value = offer?.cost.food ?? 0
  countries.value = [...(offer?.countries ?? [])]; scenarios.value = [...(offer?.scenarios ?? [])]
  preview.value = null; notice.value = ''
}
watch([selected, id, name, description, visualTemplate, attributes, advanced, recruit, building, minimumLevel, money, industry, food, countries, scenarios, faction, instance, cell, ready], () => { preview.value = null }, { deep: true })
async function plan() {
  const extras = JSON.parse(advanced.value)
  if (!extras || Array.isArray(extras) || typeof extras !== 'object' || Object.keys(extras).some(k => !advancedKeys.includes(k))) throw Error('高级属性仅支持攻击次数、倍率、标签和技能槽字段')
  preview.value = await api<Preview>('unit-types-preview', { revision: props.overview.revision, taskId: crypto.randomUUID(), units: [{ originalId: originalId.value, id: id.value, template: templateId.value, name: name.value, description: description.value,
    visualTemplate: visualTemplate.value, attributes: { ...attributes.value, ...extras }, recruitment: recruit.value ? { buildingKinds: [building.value], minimumLevel: minimumLevel.value, cost: { money: money.value, industry: industry.value, food: food.value }, countries: countries.value, scenarios: scenarios.value } : null }] })
}
async function deploy() {
  preview.value = await api<Preview>('unit-types-deploy-preview', { revision: props.overview.revision, taskId: crypto.randomUUID(), scenario: props.scenario, faction: faction.value, profile: selected.value, unit: instance.value, cell: cell.value, ready: ready.value })
}
async function apply() {
  const p = preview.value; if (!p) return
  await api('apply', { revision: p.revision, taskId: p.taskId, token: p.token })
  preview.value = null; notice.value = '已应用，可在工程工具栏撤销或导出 Mod。'; emit('changed')
}
</script>

<template>
  <section class="unit-types" :aria-busy="busy">
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="catalog && !catalog.supported">当前工程的冻结引擎未包含独立兵种招募接口。请以新版 R 源码建立新工程基线。</p>
    <template v-if="catalog?.supported">
      <p>从现有兵种复制为新 ID，保留原兵种。属性、兵模和招募条件随完整 Mod 导出。</p>
      <div class="unit-grid">
        <div class="unit-list"><input v-model="search" aria-label="搜索兵种" placeholder="兵种 ID / 名称" />
          <select v-model="selected" size="12" aria-label="兵种模板"><option v-for="u in visible" :key="u.id" :value="u.id">{{ u.visual?.name ?? u.id }} · {{ u.id }}</option></select>
          <button :disabled="locked || !current" @click="choose(true)">复制为独立新兵种</button><button :disabled="locked || !current" @click="choose(false)">编辑所选兵种</button>
        </div>
        <fieldset :disabled="locked || !visualTemplate"><legend>{{ originalId ? '编辑兵种' : '新兵种' }}</legend>
          <div class="unit-fields">
            <label>兵种 ID<input v-model="id" :readonly="originalId !== null" aria-label="独立兵种 ID" /></label>
            <label>名称<input v-model="name" aria-label="兵种名称" /></label>
            <label>类别<select v-model="attributes.category" aria-label="兵种类别"><option v-for="(label, key) in { infantry: '步兵', cavalry: '骑兵', artillery: '炮兵', naval: '海军', fort: '要塞' }" :key="key" :value="key">{{ label }}</option></select></label>
            <label>等级键<input v-model="attributes.grade" aria-label="兵种等级键" /></label>
            <label v-for="(label, key) in numbers" :key="key">{{ label }}<input v-model.number="attributes[key]" type="number" min="0" step="1" :aria-label="label" /></label>
            <label>武器<select v-model="attributes.weapon" aria-label="武器类型"><option v-for="w in ['gun', 'guns', 'mgun', 'cannon', 'rocket', 'cold']" :key="w">{{ w }}</option></select></label>
            <label>兵模和卡图模板<select v-model="visualTemplate" aria-label="兵模和卡图模板"><option v-for="u in catalog.units" :key="u.id" :value="u.id">{{ u.visual?.name ?? u.id }} · {{ u.id }}</option></select></label>
          </div>
          <label>描述<textarea v-model="description" aria-label="兵种描述" rows="2" /></label>
          <details><summary>高级属性：攻击次数、倍率、标签和技能槽</summary><textarea v-model="advanced" aria-label="高级兵种属性 JSON" rows="8" spellcheck="false" /></details>
          <label class="check"><input v-model="recruit" type="checkbox" aria-label="开放独立招募" />开放独立招募</label>
          <div v-if="recruit" class="unit-fields">
            <label>招募建筑<select v-model="building" aria-label="招募建筑"><option v-for="(label, key) in { city: '城市', industry: '工厂', stable: '马厩', port: '港口' }" :key="key" :value="key">{{ label }}</option></select></label>
            <label>最低建筑等级<input v-model.number="minimumLevel" aria-label="最低建筑等级" type="number" min="1" /></label>
            <label>金钱<input v-model.number="money" aria-label="招募金钱" type="number" min="0" /></label><label>工业<input v-model.number="industry" aria-label="招募工业" type="number" min="0" /></label><label>粮食<input v-model.number="food" aria-label="招募粮食" type="number" min="0" /></label>
            <label>可招募国家（不选即全部）<select v-model="countries" multiple aria-label="可招募国家"><option v-for="c in overview.countries" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
            <label>可招募剧本（不选即全部）<select v-model="scenarios" multiple aria-label="可招募剧本"><option v-for="s in overview.scenarios" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
          </div>
          <button @click="run(plan)">预览兵种修改</button>
        </fieldset>
      </div>
      <details class="deployment"><summary>将已应用兵种作为开局增援部署</summary>
        <p>当前剧本 {{ scenario }}。可先在地图选择一个本国空格，增援保存在事件配置中。</p>
        <div class="unit-fields"><label>国家<select v-model.number="faction" aria-label="增援国家"><option v-for="f in view?.factions" :key="f.index" :value="f.index">{{ f.index }} · {{ f.id }}</option></select></label>
          <label>部队实例 ID<input v-model="instance" aria-label="增援实例 ID" /></label><label>地图格号<input v-model.number="cell" type="number" min="0" aria-label="增援格号" /></label>
          <label class="check"><input v-model="ready" type="checkbox" />开局即可行动</label></div>
        <button :disabled="locked || !current" @click="run(deploy)">预览开局增援</button>
      </details>
      <div v-if="preview" class="unit-preview"><p>预览 {{ preview.count }} 项修改</p><ul><li v-for="c in preview.changes" :key="c.file + c.object">{{ c.object }} · {{ c.field }}</li></ul><button :disabled="locked" @click="run(apply)">应用兵种预览</button><button :disabled="locked" @click="preview = null">取消预览</button></div>
    </template>
  </section>
</template>

<style scoped>
.unit-types{display:grid;gap:12px;padding:4px;min-width:0;font:14px/1.5 system-ui,sans-serif;color:#263746}.unit-types p{margin:0;line-height:1.6}.unit-grid{display:grid;grid-template-columns:minmax(190px,1fr) minmax(0,3fr);gap:16px}.unit-list{display:flex;flex-direction:column;gap:8px;min-width:0}.unit-list select{width:100%;min-height:250px;font-size:12px}.unit-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px}.unit-types label{display:flex;flex-direction:column;gap:5px;margin-bottom:8px}.unit-types input,.unit-types select,.unit-types textarea{width:100%;box-sizing:border-box;min-width:0;font:inherit;border:1px solid #c8d2da;border-radius:5px;padding:6px 8px;background:#fff;color:inherit}.unit-types input:focus,.unit-types select:focus,.unit-types textarea:focus{outline:2px solid #93c5b6;outline-offset:1px}.unit-types fieldset{min-width:0;border:1px solid #d6dde7;border-radius:8px;padding:12px}.unit-types .check{flex-direction:row;align-items:center}.check input{width:auto}.unit-types details{margin:8px 0}.unit-types button{margin:4px 4px 4px 0;font:inherit;padding:7px 10px;border:1px solid #b7c9c3;border-radius:5px;background:#f2f8f5;color:#205f4d;cursor:pointer}.unit-types button:disabled{opacity:.5;cursor:default}.unit-preview{padding:12px;background:#eef5ff;border-radius:8px}.error{color:#b42318}.deployment{border-top:1px solid #d6dde7;padding-top:10px}@media(max-width:760px){.unit-grid{grid-template-columns:1fr}.unit-list select{min-height:170px;max-height:200px}.unit-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:400px){.unit-fields{grid-template-columns:1fr}}
</style>
