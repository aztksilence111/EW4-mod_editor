<script setup lang="ts">
import { ref, computed } from 'vue'
import { UNITS } from '../core/data/units'
import { BUILDING_DEFAULTS, BUILDING_SYMBOLS } from '../core/data/buildings'
import { CITIES } from '../core/data/cities'
import { TERRAIN_TYPES } from '../core/data/terrainTypes'
import {
  editorConfig,
  setUnitName,
  setUnitAbbr,
  setBuildingName,
  setCityNameCN,
  setCityNameEN,
  getCityCustom,
  setCommanderCN,
  setCountryName,
  setItemCN,
  importCommandersXml,
  importStringtableIni,
  importItemsXml,
  resetAllNames,
  exportConfig,
  importConfig,
  importAreaXml,
} 



from '../core/data/config'

defineProps<{
  status: string
}>()

type TabKey = 'unit' | 'building' | 'city' | 'commander' | 'country' | 'item' | 'terrain'
const activeTab = ref<TabKey>('unit')

const unitRows = computed(() =>
  UNITS.map((u) => ({
    id: u.id,
    english: u.english,
    defaultName: u.name,
    defaultAbbr: u.abbr,
    customName: editorConfig.value.unitNames[String(u.id)] ?? '',
    customAbbr: editorConfig.value.unitAbbrs[String(u.id)] ?? '',
  }))
)

const buildingRows = computed(() =>
  BUILDING_DEFAULTS.map((name, id) => ({
    id,
    symbol: BUILDING_SYMBOLS[id] ?? '?',
    defaultName: name,
    custom: editorConfig.value.buildingNames[String(id)] ?? '',
  }))
)

const cityRows = computed(() =>
  CITIES.map(([cn, en], id) => {
    const custom = getCityCustom(id)
    return {
      id,
      defCn: cn,
      defEn: en,
      customCn: custom.cn ?? '',
      customEn: custom.en ?? '',
    }
  }).filter((r) => r.id > 0 && (r.defCn || r.defEn))
)

const commanderRows = computed(() =>
  editorConfig.value.commanders.map((c) => ({
    id: c.id,
    en: c.en,
    cn: c.cn,
  }))
)

const countryRows = computed(() =>
  Object.entries(editorConfig.value.countryNames)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code))
)

const itemRows = computed(() =>
  editorConfig.value.items.map((it) => ({
    id: it.id,
    en: it.en,
    cn: it.cn,
  }))
)

function onUnitNameInput(id: number, e: Event) {
  setUnitName(id, (e.target as HTMLInputElement).value)
}
function onUnitAbbrInput(id: number, e: Event) {
  setUnitAbbr(id, (e.target as HTMLInputElement).value)
}
function onBuildingInput(id: number, e: Event) {
  setBuildingName(id, (e.target as HTMLInputElement).value)
}
function onCityCNInput(id: number, e: Event) {
  setCityNameCN(id, (e.target as HTMLInputElement).value)
}
function onCityENInput(id: number, e: Event) {
  setCityNameEN(id, (e.target as HTMLInputElement).value)
}
function onCommanderCNInput(id: number, e: Event) {
  setCommanderCN(id, (e.target as HTMLInputElement).value)
}
function onCountryNameInput(code: string, e: Event) {
  setCountryName(code, (e.target as HTMLInputElement).value)
}
function onItemCNInput(id: number, e: Event) {
  setItemCN(id, (e.target as HTMLInputElement).value)
}

function onReset() {
  if (confirm('确定清空所有自定义名称，恢复默认？')) resetAllNames()
}

function onExport() {
  const json = exportConfig()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'ew4-config.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function onImportJsonClick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      if (importConfig(text)) alert('导入成功')
      else alert('导入失败：文件格式不正确')
    }
    reader.readAsText(file)
  }
  input.click()
}

function onImportAreaXmlClick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xml,application/xml,text/xml'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const r = importAreaXml(text)
      if (r.ok) alert(`导入成功，共 ${r.count} 条地名`)
      else alert('导入失败：XML 格式不正确')
    }
    reader.readAsText(file)
  }
  input.click()
}

function onImportCommandersXmlClick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xml,application/xml,text/xml'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const r = importCommandersXml(text)
      if (r.ok) alert(`导入成功，共 ${r.count} 位将领`)
      else alert('导入失败：XML 格式不正确')
    }
    reader.readAsText(file)
  }
  input.click()
}

function onImportIniClick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.ini,text/plain'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const r = importStringtableIni(text)
      if (r.ok) {
        alert(`导入成功\n将领中文名：${r.count} 位\n国家中文名：${r.countryCount} 个`)
      } else {
        alert('导入失败：INI 格式不正确')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

function onImportItemsXmlClick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.xml,application/xml,text/xml'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      const r = importItemsXml(text)
      if (r.ok) alert(`导入成功，共 ${r.count} 件物品`)
      else alert('导入失败：XML 格式不正确')
    }
    reader.readAsText(file)
  }
  input.click()
}
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <button class="btn" @click="onReset">恢复默认</button>
      <button class="btn" @click="onImportJsonClick">导入 JSON</button>
      <button class="btn" @click="onExport">导出 JSON</button>
      <button class="btn" @click="onImportCommandersXmlClick">导入 def_commanders.xml</button>
      <button class="btn" @click="onImportIniClick">导入 stringtable_cn.ini</button>
      <button class="btn" @click="onImportAreaXmlClick">导入 def_areaname.xml</button>
      <button class="btn" @click="onImportItemsXmlClick">导入 def_item.xml</button>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'unit' }"
              @click="activeTab = 'unit'">单位</button>
      <button class="tab" :class="{ active: activeTab === 'building' }"
              @click="activeTab = 'building'">建筑</button>
      <button class="tab" :class="{ active: activeTab === 'city' }"
              @click="activeTab = 'city'">地名</button>
      <button class="tab" :class="{ active: activeTab === 'commander' }"
              @click="activeTab = 'commander'">将领</button>
      <button class="tab" :class="{ active: activeTab === 'country' }"
              @click="activeTab = 'country'">国家</button>
      <button class="tab" :class="{ active: activeTab === 'item' }"
              @click="activeTab = 'item'">物品</button>
      <button class="tab" :class="{ active: activeTab === 'terrain' }"
              @click="activeTab = 'terrain'">地形</button>
    </div>

    <div v-if="activeTab === 'unit'" class="list">
      <div class="head-row unit-head">
        <span class="col-id">序号</span>
        <span class="col-en">英文</span>
        <span class="col-def">默认</span>
        <span class="col-abbr">缩写</span>
        <span class="col-custom">自定义名称</span>
      </div>
      <div v-for="row in unitRows" :key="row.id" class="data-row unit-row">
        <span class="col-id">{{ row.id }}</span>
        <span class="col-en">{{ row.english }}</span>
        <span class="col-def">{{ row.defaultName }}</span>
        <span class="col-abbr">
          <input type="text" maxlength="2" :value="row.customAbbr"
                 :placeholder="row.defaultAbbr"
                 @input="(e) => onUnitAbbrInput(row.id, e)" />
        </span>
        <span class="col-custom">
          <input type="text" :value="row.customName" :placeholder="row.defaultName"
                 @input="(e) => onUnitNameInput(row.id, e)" />
        </span>
      </div>
    </div>

    <div v-else-if="activeTab === 'building'" class="list">
      <div class="head-row">
        <span class="col-id">序号</span>
        <span class="col-en">符号</span>
        <span class="col-def">默认</span>
        <span class="col-custom">自定义</span>
      </div>
      <div v-for="row in buildingRows" :key="row.id" class="data-row">
        <span class="col-id">{{ row.id }}</span>
        <span class="col-en">{{ row.symbol }}</span>
        <span class="col-def">{{ row.defaultName }}</span>
        <span class="col-custom">
          <input type="text" :value="row.custom" :placeholder="row.defaultName"
                 @input="(e) => onBuildingInput(row.id, e)" />
        </span>
      </div>
    </div>

    <div v-else-if="activeTab === 'city'" class="list">
      <div class="head-row city-head">
        <span class="col-id">编号</span>
        <span class="col-def">默认中文</span>
        <span class="col-def">默认英文</span>
        <span class="col-custom">中文自定义</span>
        <span class="col-custom">英文自定义</span>
      </div>
      <div v-for="row in cityRows" :key="row.id" class="data-row city-row">
        <span class="col-id">{{ row.id }}</span>
        <span class="col-def">{{ row.defCn }}</span>
        <span class="col-def en">{{ row.defEn }}</span>
        <span class="col-custom">
          <input type="text" :value="row.customCn" :placeholder="row.defCn"
                 @input="(e) => onCityCNInput(row.id, e)" />
        </span>
        <span class="col-custom">
          <input type="text" :value="row.customEn" :placeholder="row.defEn"
                 @input="(e) => onCityENInput(row.id, e)" />
        </span>
      </div>
    </div>

    <div v-else-if="activeTab === 'commander'" class="list">
      <div class="head-row commander-head">
        <span class="col-id">编号</span>
        <span class="col-en">英文</span>
        <span class="col-custom">中文（可修改）</span>
      </div>
      <div v-for="row in commanderRows" :key="row.id" class="data-row commander-row">
        <span class="col-id">{{ row.id }}</span>
        <span class="col-en">{{ row.en }}</span>
        <span class="col-custom">
          <input type="text" :value="row.cn" :placeholder="row.en"
                 @input="(e) => onCommanderCNInput(row.id, e)" />
        </span>
      </div>
      <div v-if="commanderRows.length === 0" class="empty-hint">
        尚未导入将领，请点击上方按钮导入 def_commanders.xml 与 stringtable_cn.ini
      </div>
    </div>

    <div v-else-if="activeTab === 'country'" class="list">
      <div class="head-row country-head">
        <span class="col-id">代码</span>
        <span class="col-custom">中文名（可修改）</span>
      </div>
      <div v-for="row in countryRows" :key="row.code" class="data-row country-row">
        <span class="col-id">{{ row.code }}</span>
        <span class="col-custom">
          <input type="text" :value="row.name" :placeholder="row.code"
                 @input="(e) => onCountryNameInput(row.code, e)" />
        </span>
      </div>
      <div v-if="countryRows.length === 0" class="empty-hint">
        尚未导入国家，请点击上方按钮导入 stringtable_cn.ini
      </div>
    </div>

    <div v-else-if="activeTab === 'item'" class="list">
      <div class="head-row item-head">
        <span class="col-id">编号</span>
        <span class="col-en">英文</span>
        <span class="col-custom">中文（可修改）</span>
      </div>
      <div v-for="row in itemRows" :key="row.id" class="data-row item-row">
        <span class="col-id">{{ row.id }}</span>
        <span class="col-en">{{ row.en }}</span>
        <span class="col-custom">
          <input type="text" :value="row.cn" :placeholder="row.en"
                 @input="(e) => onItemCNInput(row.id, e)" />
        </span>
      </div>
      <div v-if="itemRows.length === 0" class="empty-hint">
        尚未导入物品，请点击上方按钮导入 def_item.xml
      </div>
    </div>

    <div v-else class="list">
      <div class="head-row terrain-head">
        <span class="col-id">序号</span>
        <span class="col-en">符号</span>
        <span class="col-def">中文名</span>
        <span class="col-def">图片数</span>
      </div>
      <div v-for="t in TERRAIN_TYPES" :key="t.key" class="data-row terrain-row">
        <span class="col-id">{{ t.tileNum }}</span>
        <span class="col-en">{{ t.symbol }}</span>
        <span class="col-def">{{ t.name }}</span>
        <span class="col-def">{{ t.images.length }}</span>
      </div>
    </div>

  </div>
</template>

<style scoped>
.panel { padding: 8px 10px 12px; font-size: 12px; color: #d1d5db; }
.toolbar { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.btn {
  padding: 5px 12px; border-radius: 4px; border: 1px solid #4b5563;
  background: #374151; color: #e5e7eb; font-size: 12px; cursor: pointer;
}
.btn:hover { background: #4b5563; }
.tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.tab {
  flex: 1 0 auto; min-width: 56px;
  padding: 6px 8px; border: 1px solid #374151; border-radius: 4px;
  background: #111827; color: #9ca3af; font-size: 12px; cursor: pointer;
}
.tab.active { background: #2563eb; border-color: #2563eb; color: #fff; }

.list { border: 1px solid #374151; border-radius: 6px; background: #0f172a; overflow: hidden; }
.head-row, .data-row {
  display: grid; grid-template-columns: 56px 1fr 1fr 1.4fr;
  gap: 4px; padding: 4px 8px; align-items: center; font-size: 12px;
}
.unit-head, .unit-row {
  grid-template-columns: 48px 1.2fr 1fr 60px 1.4fr;
}
.city-head, .city-row {
  grid-template-columns: 48px 1fr 1fr 1.1fr 1.1fr;
}
.commander-head, .commander-row {
  grid-template-columns: 56px 1.4fr 1.4fr;
}
.country-head, .country-row {
  grid-template-columns: 80px 1.6fr;
}
.item-head, .item-row {
  grid-template-columns: 56px 1.4fr 1.4fr;
}

.terrain-head, .terrain-row {
  grid-template-columns: 56px 1fr 1.6fr 1fr;
}

.head-row { background: #1f2937; color: #93c5fd; font-weight: 600; font-size: 11px; }
.data-row { border-top: 1px solid #1f2937; }
.data-row:hover { background: #1e293b; }

.col-id, .col-en, .col-def {
  color: #d1d5db; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.col-en { color: #9ca3af; font-family: ui-monospace, monospace; font-size: 11px; }
.col-def.en { font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1; }

.col-custom input, .col-abbr input {
  width: 100%; padding: 3px 6px; border: 1px solid #4b5563; border-radius: 3px;
  background: #1f2937; color: #e5e7eb; font-size: 12px; box-sizing: border-box;
  text-align: center;
}
.col-custom input { text-align: left; }
.col-custom input:focus, .col-abbr input:focus {
  outline: none; border-color: #2563eb;
}
.empty-hint { padding: 14px; color: #6b7280; font-size: 12px; text-align: center; }
</style>