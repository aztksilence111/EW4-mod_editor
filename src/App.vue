<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, watch } from 'vue'
import TopBar from './components/TopBar.vue'
import MapView from './components/MapView.vue'
import BottomTabs from './components/BottomTabs.vue'
import WindowFrame from './components/WindowFrame.vue'
import EditPanel from './components/EditPanel.vue'
import LegionPanel from './components/LegionPanel.vue'
import EventPanel from './components/EventPanel.vue'
import ConfigPanel from './components/ConfigPanel.vue'
import MapSelectDialog from './components/MapSelectDialog.vue'
import CampaignSelectDialog from './components/CampaignSelectDialog.vue'
import ConquestSelectDialog from './components/ConquestSelectDialog.vue'
import { parseBtl, serializeBtl } from './core/formats/btl'
import { assertValidBtlReferences } from './core/formats/btlValidation'
import { parseBin, serializeBin } from './core/formats/bin'
import { loadBuiltinMap } from './core/data/builtinMaps'
import { loadBuiltinCommanders, exportConfig, importConfig } from './core/data/config'
import { loadCampaignBtl, loadConquestBtl } from './core/data/battleList'
import { saveDraft, loadDraft, clearDraft } from './core/storage/draftDb'
import {
  type ProjectPack,
  serializeProject,
  reviveProject,
  serializeTerrain,
  reviveTerrain,
} from './core/storage/projectPack'
import type { BtlProject, BinProject } from './core/formats/types'
import ActualDisplayDialog from './components/ActualDisplayDialog.vue'
import RewriteWorkbench from './components/RewriteWorkbench.vue'
import type { ScenarioView } from './core/editor/api'

const rewriteMode = ref(true)
const workbench = ref<InstanceType<typeof RewriteWorkbench> | null>(null)
const selectedCells = ref<number[]>([])
const jurisdictionCenters = ref<number[] | null>(null)
const showJurisdictions = ref(false)
function onRewriteLoaded(p: BtlProject, t: BinProject, view: ScenarioView) {
  project.value = p; terrain.value = t; jurisdictionCenters.value = view.jurisdictions ?? view.effectiveJurisdictions
  selectedTile.value = null; changeVersion.value++; updateStatus(view.id)
}
function useLegacyMode() {
  rewriteMode.value = false; project.value = null; terrain.value = null
  selectedCells.value = []; jurisdictionCenters.value = null; showJurisdictions.value = false
  showMapSelect.value = true
}

const openWindow = ref<string>('')
const status = ref('未导入文件')
const project = shallowRef<BtlProject | null>(null)
const terrain = shallowRef<BinProject | null>(null)
const selectedTile = ref<{ x: number; y: number } | null>(null)
const changeVersion = ref(0)
const terrainMode = ref(false)
const showMapSelect = ref(false)
const showCampaignSelect = ref(false)
const showConquestSelect = ref(false)

const clipActive = ref(false)
const clipStart = ref<{ x: number; y: number } | null>(null)
const clipEnd = ref<{ x: number; y: number } | null>(null)

const mode = computed(() => 'terrain')
const showActualDisplay = ref(false)

/* ============ 内嵌工程读取 ============ */

function readEmbeddedProject(): ProjectPack | null {
  const el = document.getElementById('__EMBEDDED_PROJECT__')
  if (!el) return null
  const txt = (el.textContent ?? '').trim()
  if (!txt || txt === 'null') return null
  try {
    return JSON.parse(txt)
  } catch (e) {
    console.warn('[App] 内嵌工程解析失败', e)
    return null
  }
}

/* ============ 自动保存 ============ */

let saveTimer: number | null = null
let saveInFlight = false
let pendingSave = false

async function doSave() {
  if (rewriteMode.value) return
  if (saveInFlight) {
    pendingSave = true
    return
  }
  saveInFlight = true
  try {
    const p = project.value
    const t = terrain.value
    const rawRecord = {
      projectRaw: p ? serializeProject(p) : null,
      terrainRaw: t ? serializeTerrain(t) : null,
      selectedTile: selectedTile.value,
      sourceName: status.value,
      savedAt: Date.now(),
    }
    // 用 JSON 深拷贝，剥离所有 Proxy / 非普通对象
    const plainRecord = JSON.parse(JSON.stringify(rawRecord))
    await saveDraft(plainRecord)
    console.log('[draft] 已自动保存', new Date().toLocaleTimeString())
  } catch (e) {
    console.warn('[draft] 保存失败', e)
  } finally {
    saveInFlight = false
    if (pendingSave) {
      pendingSave = false
      doSave()
    }
  }
}

function scheduleSave() {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = window.setTimeout(doSave, 1500)
}

watch(
  () => [changeVersion.value, terrain.value, selectedTile.value],
  () => scheduleSave(),
  { deep: false }
)

/* ============ 启动恢复 ============ */

async function restoreDraft() {
  try {
    const d = await loadDraft()
    if (!d) return
    if (!d.projectRaw && !d.terrainRaw) return

    const when = new Date(d.savedAt).toLocaleString()
    const ok = confirm(
      `检测到上次未保存的工作（${when}）\n来源：${d.sourceName || '（未知）'}\n\n是否恢复？`
    )
    if (!ok) {
      await clearDraft()
      return
    }
    if (d.terrainRaw) terrain.value = reviveTerrain(d.terrainRaw)
    if (d.projectRaw) project.value = reviveProject(d.projectRaw)
    if (d.selectedTile) selectedTile.value = d.selectedTile
    status.value = d.sourceName || '已恢复草稿'
    changeVersion.value++
  } catch (e) {
    console.warn('[draft] 恢复失败', e)
  }
}

/* ============ 通用 ============ */

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (typeof file.arrayBuffer === 'function') {
      file.arrayBuffer().then(resolve).catch(() => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
        reader.readAsArrayBuffer(file)
      })
    } else {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
      reader.readAsArrayBuffer(file)
    }
  })
}

function updateStatus(fileName?: string) {
  const parts: string[] = []
  if (fileName) parts.push(fileName)
  const p = project.value
  if (p) {
    parts.push(`军团 ${p.legions.length}`)
    parts.push(`建筑 ${p.builds.length}`)
    parts.push(`部队 ${p.armies.length}`)
    parts.push(`事件 ${p.events.length}`)
  }
  const t = terrain.value
  if (t) parts.push(`地形 ${t.info.mapW}×${t.info.mapH}`)
  if (terrainMode.value) parts.push('地形模式')
  status.value = parts.length ? parts.join(' - ') : '未导入文件'
}

/* ============ 导入/导出 BTL ============ */

async function onImportFile(file: File) {
  try {
    status.value = `正在读取 ${file.name}...`
    const buffer = await readFileAsArrayBuffer(file)
    if (!buffer || buffer.byteLength === 0) throw new Error('文件内容为空')
    const p = parseBtl(buffer)
    project.value = p
    changeVersion.value++
    updateStatus(file.name)
    if (p.info.mapId === 1 || p.info.mapId === 2) {
      try { await loadBuiltinForId(p.info.mapId) } catch (e) { console.warn(e) }
    }
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    status.value = '导入 BTL 失败：' + msg
    alert('导入 BTL 失败：' + msg)
  }
}

async function onImportTerrain(file: File) {
  try {
    status.value = `正在读取地形 ${file.name}...`
    const buffer = await readFileAsArrayBuffer(file)
    if (!buffer || buffer.byteLength === 0) throw new Error('文件内容为空')
    const t = parseBin(buffer)
    terrain.value = t
    changeVersion.value++
    showMapSelect.value = false
    updateStatus()
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    status.value = '导入地形失败：' + msg
    alert('导入地形失败：' + msg)
  }
}

async function loadBuiltinForId(mapId: number) {
  const file = mapId === 1 ? 'europe.bin' : mapId === 2 ? 'america.bin' : null
  if (!file) return
  try {
    status.value = `正在加载内置地图 ${file}...`
    const buf = await loadBuiltinMap(file)
    terrain.value = parseBin(buf)
    changeVersion.value++
    updateStatus()
  } catch (e) {
    console.warn('[App] 内置地图加载失败', e)
  }
}

async function onPickBuiltin(file: string) {
  try {
    showMapSelect.value = false
    status.value = `正在加载 ${file}...`
    const buf = await loadBuiltinMap(file)
    terrain.value = parseBin(buf)
    changeVersion.value++
    updateStatus()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    alert('加载内置地图失败：' + msg)
  }
}

async function onPickCampaign(file: string) {
  try {
    showCampaignSelect.value = false
    status.value = `正在加载战役 ${file}...`
    const buf = await loadCampaignBtl(file)
    const p = parseBtl(buf)
    project.value = p
    changeVersion.value++
    updateStatus(file)
    if (p.info.mapId === 1 || p.info.mapId === 2) {
      try { await loadBuiltinForId(p.info.mapId) } catch (e) { console.warn(e) }
    }
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    alert(`加载战役失败：${msg}\n\n请确认文件已放置在 public/campaigns/ 目录`)
  }
}

async function onPickConquest(file: string) {
  try {
    showConquestSelect.value = false
    status.value = `正在加载征服 ${file}...`
    const buf = await loadConquestBtl(file)
    const p = parseBtl(buf)
    project.value = p
    changeVersion.value++
    updateStatus(file)
    if (p.info.mapId === 1 || p.info.mapId === 2) {
      try { await loadBuiltinForId(p.info.mapId) } catch (e) { console.warn(e) }
    }
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    alert(`加载征服失败：${msg}\n\n请确认文件已放置在 public/conquests/ 目录`)
  }
}

function onExport() {
  if (!project.value) { alert('请先导入 BTL 文件'); return }
  try {
    assertValidBtlReferences(project.value, terrain.value
      ? { width: terrain.value.info.mapW, height: terrain.value.info.mapH }
      : undefined)
    const buf = serializeBtl(project.value)
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'export.btl'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    status.value = '已导出 export.btl'
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : String(e)
    alert('导出失败：' + msg)
  }
}

function onExportTerrainBin() {
  if (!terrain.value) { alert('请先加载地形 .bin'); return }
  try {
    const buf = serializeBin(terrain.value)
    const blob = new Blob([buf], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'world.bin'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    status.value = '已导出 world.bin'
  } catch (e) {
    console.error(e)
    alert('导出地形失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

/* ============ 工程包 ============ */

function buildPack(): ProjectPack {
  return {
    version: 1,
    savedAt: Date.now(),
    sourceName: status.value,
    project: project.value ? serializeProject(project.value) : null,
    terrain: terrain.value ? serializeTerrain(terrain.value) : null,
    config: JSON.parse(exportConfig()),
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function onExportPack() {
  try {
    const pack = buildPack()
    const json = JSON.stringify(pack)
    const blob = new Blob([json], { type: 'application/json' })
    const name = prompt('工程文件名（不含扩展名）', 'myproject') || 'myproject'
    downloadBlob(blob, `${name}.ew4p`)
    status.value = '已导出工程包 ' + name + '.ew4p'
  } catch (e) {
    console.error(e)
    alert('导出工程失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

function onImportPackClick() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.ew4p,.json,application/json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      try {
        const pack: ProjectPack = JSON.parse(text)
        if (!pack || typeof pack !== 'object') throw new Error('格式错误')
        if (pack.terrain) terrain.value = reviveTerrain(pack.terrain)
        if (pack.project) project.value = reviveProject(pack.project)
        if (pack.config) importConfig(JSON.stringify(pack.config))
        status.value = `已导入工程：${file.name}`
        changeVersion.value++
        alert('导入工程成功')
      } catch (e) {
        console.error(e)
        alert('导入工程失败：文件格式不正确')
      }
    }
    reader.readAsText(file)
  }
  input.click()
}

/* ============ 导出离线 HTML ============ */

async function onExportOfflineHtml() {
  alert('当前使用分包构建，请导出作者工程或工程包。离线单文件分发将在后续版本恢复。')
}

/* ============ 其它 ============ */

function onTabChange(tab: string) {
  if (openWindow.value === tab) openWindow.value = ''
  else openWindow.value = tab
}

function onTileClick(x: number, y: number) {
  if (rewriteMode.value) { selectedTile.value = { x, y }; workbench.value?.selectTile(x, y); return }
  if (clipActive.value) {
    if (!clipStart.value) {
      clipStart.value = { x, y }
      status.value = `已选起点 (${x}, ${y})，请点击右下角`
    } else if (!clipEnd.value) {
      clipEnd.value = { x, y }
      status.value = `已选终点 (${x}, ${y})，请点击确认`
      setTimeout(() => {
        if (confirm('确认截取？范围外的建筑/部队/归属数据将被移除')) {
          applyClip()
        } else {
          // 取消本次选点，但保留截取模式
          clipStart.value = null
          clipEnd.value = null
          status.value = '已取消本次选点，请点击左上角重新开始'
        }
      }, 100)
    }
    return
  }
  selectedTile.value = { x, y }
}

function applyClip() {
  const p = project.value
  const t = terrain.value
  if (!p || !t || !clipStart.value || !clipEnd.value) return
  const sx = clipStart.value.x, sy = clipStart.value.y
  const ex = clipEnd.value.x, ey = clipEnd.value.y
  const x0 = Math.min(sx, ex), x1 = Math.max(sx, ex)
  const y0 = Math.min(sy, ey), y1 = Math.max(sy, ey)
  const binW = t.info.mapW
  const oldMapX = p.info.mapX, oldMapY = p.info.mapY
  const oldMapW = p.info.mapW, oldMapH = p.info.mapH
  p.info.mapX = x0; p.info.mapY = y0
  p.info.mapW = x1 - x0 + 1; p.info.mapH = y1 - y0 + 1
  p.builds = p.builds.filter((b) => {
    const gx = b.index % binW, gy = Math.floor(b.index / binW)
    return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1
  })
  p.armies = p.armies.filter((a) => {
    const gx = a.index % binW, gy = Math.floor(a.index / binW)
    return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1
  })
  const newTiles: typeof p.tiles = []
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) {
      const lx = gx - oldMapX, ly = gy - oldMapY
      if (lx >= 0 && lx < oldMapW && ly >= 0 && ly < oldMapH) {
        const oldTile = p.tiles[ly * oldMapW + lx]
        newTiles.push(oldTile ? { legion: oldTile.legion } : { legion: 0xff })
      } else newTiles.push({ legion: 0xff })
    }
  }
  p.tiles = newTiles
  changeVersion.value++
  clipActive.value = false
  clipStart.value = null
  clipEnd.value = null
  updateStatus()
  alert(`截取完成，新地图 ${p.info.mapW}×${p.info.mapH}`)
}

function onProjectChange() {
  changeVersion.value++
  updateStatus()
}

function onProjectReplace(next: BtlProject) {
  project.value = next
  changeVersion.value++
  updateStatus()
}

async function onSaveNow() {
  status.value = '正在保存草稿...'
  await doSave()
  status.value = '草稿已保存'
  setTimeout(() => updateStatus(), 800)
}

async function onClearDraft() {
  if (!confirm('确定清空本地草稿？（当前编辑内容会保留，仅删除快照）')) return
  await clearDraft()
  status.value = '本地草稿已清空'
  setTimeout(() => updateStatus(), 800)
}

/* ============ 生命周期 ============ */

onMounted(async () => {
  await loadBuiltinCommanders()
  if (rewriteMode.value) return

  const embedded = readEmbeddedProject()
  if (embedded) {
    try {
      if (embedded.terrain) terrain.value = reviveTerrain(embedded.terrain)
      if (embedded.project) project.value = reviveProject(embedded.project)
      if (embedded.config) importConfig(JSON.stringify(embedded.config))
      if (embedded.sourceName) status.value = embedded.sourceName
      changeVersion.value++
      console.log('[App] 已从内嵌数据恢复')
      if (!terrain.value) showMapSelect.value = true
      return
    } catch (e) {
      console.warn('[App] 内嵌工程恢复失败', e)
    }
  }

  await restoreDraft()
  if (!terrain.value) showMapSelect.value = true
})
</script>

<template>
  <div class="app">
    <RewriteWorkbench v-if="rewriteMode" ref="workbench" @loaded="onRewriteLoaded" @selection="selectedCells = $event" @layer="showJurisdictions = $event" @legacy="useLegacyMode" />
    <button v-else class="return-rewrite" @click="rewriteMode = true; showMapSelect = false; openWindow = ''">返回 Rewrite 工程</button>
    <TopBar
      v-if="!rewriteMode"
      :status="status"
      :project="project"
      :terrain-mode="terrainMode"
      :clip-active="clipActive"
      @open-actual-display="showActualDisplay = true"
      @import="onImportFile"
      @export="onExport"
      @open-map-select="showMapSelect = true"
      @toggle-terrain-mode="terrainMode = !terrainMode; updateStatus()"
      @start-clip="clipActive = true; clipStart = null; clipEnd = null; status = '请在图中点击左上角'"
      @cancel-clip="clipActive = false; clipStart = null; clipEnd = null; updateStatus()"
      @export-terrain-bin="onExportTerrainBin"
      @open-campaign="showCampaignSelect = true"
      @open-conquest="showConquestSelect = true"
      @change="onProjectChange"
      @save-now="onSaveNow"
      @clear-draft="onClearDraft"
      @export-pack="onExportPack"
      @import-pack="onImportPackClick"
      @export-offline-html="onExportOfflineHtml"
    />

        <ActualDisplayDialog
      v-if="showActualDisplay"
      @close="showActualDisplay = false"
    />

    <div class="map-container">
      <MapView
        :project="project"
        :terrain="terrain"
        :mode="mode"
        :selected="selectedTile"
        :selected-cells="rewriteMode ? selectedCells : []"
        :jurisdiction-centers="showJurisdictions ? jurisdictionCenters : null"
        :change-version="changeVersion"
        :terrain-mode="terrainMode"
        :clip-active="clipActive"
        :clip-start="clipStart"
        :clip-end="clipEnd"
        @tile-click="onTileClick"
      />

      <WindowFrame
        v-if="openWindow === 'edit'"
        title="编辑"
        :initial-width="380"
        :initial-height="460"
        @close="openWindow = ''"
      >
        <EditPanel
          :project="project"
          :terrain="terrain"
          :selected="selectedTile"
          @change="onProjectChange"
          @replace="onProjectReplace"
        />
      </WindowFrame>

      <WindowFrame
        v-else-if="openWindow === 'legion'"
        title="战役军团"
        @close="openWindow = ''"
      >
        <LegionPanel :project="project" @change="onProjectChange" />
      </WindowFrame>

      <WindowFrame
        v-else-if="openWindow === 'event'"
        title="战役事件"
        @close="openWindow = ''"
      >
        <EventPanel
          :project="project"
          :change-version="changeVersion"
          @change="onProjectChange"
        />
      </WindowFrame>

      <WindowFrame
        v-else-if="openWindow === 'config'"
        title="名称设定"
        :initial-width="700"
        :initial-height="540"
        @close="openWindow = ''"
      >
        <ConfigPanel :status="status" />
      </WindowFrame>
    </div>

    <BottomTabs v-if="!rewriteMode" :active="openWindow" @change="onTabChange" />

    <MapSelectDialog
      v-if="showMapSelect"
      :current-terrain="terrain"
      @close="showMapSelect = false"
      @pick-builtin="onPickBuiltin"
      @pick-file="onImportTerrain"
    />

    <CampaignSelectDialog
      v-if="showCampaignSelect"
      @close="showCampaignSelect = false"
      @pick="onPickCampaign"
    />

    <ConquestSelectDialog
      v-if="showConquestSelect"
      @close="showConquestSelect = false"
      @pick="onPickConquest"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  height: 100dvh;
}
.return-rewrite { border:0; padding:5px; color:#153f31; background:#dbe9e1; }
.map-container {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
</style>
