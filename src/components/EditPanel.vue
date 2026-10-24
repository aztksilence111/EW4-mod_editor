<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type {
  BtlProject,
  BinProject,
  BtlArmyV2,
  BtlBuildV2,
  BtlShopV2,
  BtlBarV2,
  BtlBarCommanderV2,
} from '../core/formats/types'
import { UNITS, getUnitMaxGrade } from '../core/data/units'
import { editorConfig, getCommanderName, getItemDisplayName } from '../core/data/config'
import { addArmy as transactAddArmy, addBuild as transactAddBuild, removeArmy as transactRemoveArmy, removeBuild as transactRemoveBuild, BtlTransactionError } from '../core/formats/btlTransactions'

const props = defineProps<{
  project: BtlProject | null
  terrain: BinProject | null
  selected: { x: number; y: number } | null
}>()

const emit = defineEmits<{
  (e: 'change'): void
  (e: 'replace', project: BtlProject): void
}>()

const activeSection = ref<'army' | 'build' | 'terrain'>('army')
const version = ref(0)

watch(
  () => [props.project, props.selected],
  () => { version.value++ }
)

const clipboardArmy = ref<BtlArmyV2 | null>(null)
const clipboardBuild = ref<BtlBuildV2 | null>(null)

const binW = computed(() => props.terrain?.info.mapW ?? 0)

const tileIndex = computed(() => {
  if (!props.selected || !props.terrain) return -1
  return props.selected.y * binW.value + props.selected.x
})

const localIdx = computed(() => {
  if (!props.selected || !props.project) return -1
  const p = props.project
  const lx = props.selected.x - p.info.mapX
  const ly = props.selected.y - p.info.mapY
  if (lx < 0 || lx >= p.info.mapW || ly < 0 || ly >= p.info.mapH) return -1
  return ly * p.info.mapW + lx
})

const binTile = computed(() => {
  if (!props.terrain || tileIndex.value < 0) return null
  return props.terrain.tiles[tileIndex.value] ?? null
})

const build = computed(() => {
  if (!props.project || tileIndex.value < 0) return null
  return props.project.builds.find((b) => b.index === tileIndex.value) ?? null
})

const army = computed(() => {
  if (!props.project || tileIndex.value < 0) return null
  return props.project.armies.find((a) => a.index === tileIndex.value) ?? null
})

const legionId = computed(() => {
  if (!props.project || localIdx.value < 0) return -1
  const t = props.project.tiles[localIdx.value]
  return t ? t.legion : -1
})

const legionOptions = computed(() => {
  if (!props.project) return []
  return props.project.legions.map((l, i) => {
    let cc = ''
    for (let k = 0; k < l.country.length; k++) {
      const b = l.country[k]
      if (b === 0) break
      cc += String.fromCharCode(b)
    }
    return { index: i, label: `军团 ${i + 1} · ${cc || '(空)'}` }
  })
})

const GRADE_LABELS = ['一编', '二编', '三编']

function gradeLabel(g: number): string {
  if (g >= 0 && g < GRADE_LABELS.length) return `${g} ${GRADE_LABELS[g]}`
  return `${g}`
}

function gradeOptions(armyType: number, currentGrade: number): number[] {
  void version.value
  const max = getUnitMaxGrade(armyType)
  const opts: number[] = []
  for (let g = 0; g <= max; g++) opts.push(g)
  if (currentGrade > max && currentGrade >= 0 && !opts.includes(currentGrade)) {
    opts.push(currentGrade)
  }
  return opts
}

const commanderOptions = computed(() => {
  const arr: { id: number; label: string }[] = [{ id: 0, label: '（无）' }]
  for (const c of editorConfig.value.commanders) {
    arr.push({
      id: c.id,
      label: `${c.id} ${c.cn && c.cn.trim() ? c.cn : c.en}`,
    })
  }
  return arr
})

const itemOptions = computed(() => {
  const arr: { id: number; label: string }[] = [{ id: -1, label: '（空）' }]
  for (const it of editorConfig.value.items) {
    arr.push({
      id: it.id,
      label: `${it.id} ${it.cn && it.cn.trim() ? it.cn : it.en}`,
    })
  }
  return arr
})

const commanderDisplayName = computed(() => {
  const a = army.value
  if (!a) return ''
  if (a.commander <= 0) return ''
  return getCommanderName(a.commander)
})

/* ===== 商店/酒馆 ===== */

const shopData = computed<BtlShopV2 | null>(() => {
  void version.value
  if (!props.project || tileIndex.value < 0) return null
  return props.project.shops.find((s) => s.index === tileIndex.value) ?? null
})

const barData = computed<BtlBarV2 | null>(() => {
  void version.value
  if (!props.project || tileIndex.value < 0) return null
  return props.project.bars.find((b) => b.index === tileIndex.value) ?? null
})

function ensureShop(): BtlShopV2 | null {
  if (!props.project || tileIndex.value < 0) return null
  let s = props.project.shops.find((sh) => sh.index === tileIndex.value)
  if (!s) {
    s = {
      index: tileIndex.value,
      items: Array.from({ length: 14 }, () => ({ itemID: -1, number: 0 })),
    }
    props.project.shops.push(s)
    version.value++
  }
  return s
}

function ensureBar(): BtlBarV2 | null {
  if (!props.project || tileIndex.value < 0) return null
  let b = props.project.bars.find((ba) => ba.index === tileIndex.value)
  if (!b) {
    b = {
      index: tileIndex.value,
      slot: 5,
      commanders: Array.from({ length: 5 }, () => ({
        commanderID: -1, price: 0, industry: 0, medal: 0, round: 0,
      })),
    }
    props.project.bars.push(b)
    version.value++
  }
  return b
}

function removeShop() {
  if (!props.project) return
  const i = props.project.shops.findIndex((s) => s.index === tileIndex.value)
  if (i >= 0) props.project.shops.splice(i, 1)
}

function removeBar() {
  if (!props.project) return
  const i = props.project.bars.findIndex((b) => b.index === tileIndex.value)
  if (i >= 0) props.project.bars.splice(i, 1)
}

/* ===== 字段编辑 ===== */

function onNum(e: Event, setter: (v: number) => void) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  setter(isNaN(v) ? 0 : v)
}

function onBinField(field: string, value: number) {
  if (!binTile.value) return
  ;(binTile.value as any)[field] = value
  emit('change')
}

function onBuildField(field: string, value: number) {
  if (!build.value) return
  ;(build.value as any)[field] = value
  version.value++
  emit('change')
}

function onBuildBridge(idx: number, value: number) {
  if (!build.value) return
  build.value.bridges[idx] = value
  version.value++
  emit('change')
}

function onBuildShopSelect(e: Event) {
  if (!build.value) return
  const v = parseInt((e.target as HTMLSelectElement).value, 10)
  const oldVal = build.value.constructionShop
  const newVal = isNaN(v) ? 0 : v
  build.value.constructionShop = newVal

  if (props.project && tileIndex.value >= 0) {
    if (oldVal === 2 && newVal !== 2) removeShop()
    if (oldVal === 3 && newVal !== 3) removeBar()
    if (newVal === 2 && oldVal !== 2) ensureShop()
    if (newVal === 3 && oldVal !== 3) ensureBar()
  }

  version.value++
  emit('change')
}

function onArmyField(field: string, value: number) {
  if (!army.value) return
  ;(army.value as any)[field] = value
  version.value++
  emit('change')
}

function onLegionSelect(e: Event) {
  if (!props.project || localIdx.value < 0) return
  const v = parseInt((e.target as HTMLSelectElement).value, 10)
  props.project.tiles[localIdx.value].legion = isNaN(v) ? 255 : v
  version.value++
  emit('change')
}

function onArmyTypeSelect(e: Event) {
  const v = parseInt((e.target as HTMLSelectElement).value, 10)
  const newType = isNaN(v) ? -1 : v
  onArmyField('armyType', newType)

  if (army.value) {
    const max = getUnitMaxGrade(newType)
    if (army.value.armyGrade > max) {
      onArmyField('armyGrade', max)
    }
  }
}

function onDirChange(e: Event) {
  if (!army.value) return
  const v = parseInt((e.target as HTMLSelectElement).value, 10)
  army.value.dir = v === 1 ? 1 : 0
  version.value++
  emit('change')
}

/* ===== 商店物品 ===== */

function onShopItemNum(idx: number, e: Event) {
  const s = ensureShop()
  if (!s) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  s.items[idx].number = isNaN(v) ? 0 : v
  version.value++
  emit('change')
}

function onShopItemSelect(idx: number, id: number) {
  const s = ensureShop()
  if (!s) return
  s.items[idx].itemID = isNaN(id) ? -1 : id
  version.value++
  emit('change')
}

/* ===== 酒馆将领 ===== */

function onBarSlot(e: Event) {
  const b = ensureBar()
  if (!b) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  b.slot = isNaN(v) ? 5 : v
  version.value++
  emit('change')
}

function onBarCmdField(idx: number, field: keyof BtlBarCommanderV2, e: Event) {
  const b = ensureBar()
  if (!b) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  ;(b.commanders[idx] as any)[field] = isNaN(v) ? 0 : v
  version.value++
  emit('change')
}

function onBarCmdSelect(idx: number, id: number) {
  const b = ensureBar()
  if (!b) return
  b.commanders[idx].commanderID = isNaN(id) ? -1 : id
  version.value++
  emit('change')
}

/* ===== 复制/粘贴/删除 ===== */

function copyArmy() {
  if (!army.value) return
  clipboardArmy.value = JSON.parse(JSON.stringify(army.value))
}
function pasteArmy() {
  if (!props.project || !clipboardArmy.value || tileIndex.value < 0) return
  try {
    let next = army.value ? transactRemoveArmy(props.project, tileIndex.value, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project : props.project
    const copy: BtlArmyV2 = JSON.parse(JSON.stringify(clipboardArmy.value)); copy.index = tileIndex.value
    next = transactAddArmy(next, copy, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project
    emit('replace', next); version.value++
  } catch (e) { alert(e instanceof BtlTransactionError ? e.message : String(e)) }
}
function deleteArmy() {
  if (!props.project) return
  try { emit('replace', transactRemoveArmy(props.project, tileIndex.value, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project); version.value++ }
  catch (e) { alert(e instanceof BtlTransactionError ? e.message : String(e)) }
}

function copyBuild() {
  if (!build.value) return
  clipboardBuild.value = JSON.parse(JSON.stringify(build.value))
}
function pasteBuild() {
  if (!props.project || !clipboardBuild.value || tileIndex.value < 0) return
  try {
    let next = build.value ? transactRemoveBuild(props.project, tileIndex.value, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project : props.project
    const copy: BtlBuildV2 = JSON.parse(JSON.stringify(clipboardBuild.value)); copy.index = tileIndex.value
    next = transactAddBuild(next, copy, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project
    emit('replace', next); version.value++
  } catch (e) { alert(e instanceof BtlTransactionError ? e.message : String(e)) }
}
function deleteBuild() {
  if (!props.project) return
  try { emit('replace', transactRemoveBuild(props.project, tileIndex.value, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project); version.value++ }
  catch (e) { alert(e instanceof BtlTransactionError ? e.message : String(e)) }
}

/* ===== 新增 ===== */

function addArmy() {
  if (!props.project || tileIndex.value < 0) return
  if (army.value) {
    alert('此地块已有部队')
    return
  }
  if (localIdx.value < 0) {
    alert('地块索引异常，无法新增')
    return
  }

  // 部队归属 = 地块当前军团（不修改 tiles）
  const cur = props.project.tiles[localIdx.value]
  if (!cur) {
    alert('地块数据缺失')
    return
  }
  if (cur.legion === 255 || cur.legion === -1) {
    if (!confirm('该地块当前无军团归属（255），新增部队可能无法在游戏中显示。\n是否继续？')) {
      return
    }
  }

  const newArmy: BtlArmyV2 = {
    index: tileIndex.value,
    armyType: 0,         // 民兵
    armyGrade: 0,        // 一编
    strengthNow: 90,
    strengthMax: 90,
    damageCount: 0,
    training: 0,
    movement: 6,
    morale: 0,
    unknown09: 0,
    commander: -1,
    moved: 0,
    strongPoint: 0,
    unknown13: 0,
    dir: 0,
    hasTroopship: 0,
    attacked: 0,
    unknown17: 0,
    unknown18: 0,
    event: 255,
    buildRound: 0,
    unknown21: 0,
    unknown22: 0,
    fireType: 0,
  }
  try { emit('replace', transactAddArmy(props.project, newArmy, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project); version.value++; }
  catch (e) { alert(e instanceof BtlTransactionError ? e.message : String(e)) }
}

function addBuild() {
  if (!props.project || tileIndex.value < 0) return
  if (build.value) {
    alert('此地块已有建筑')
    return
  }

  // 一级城市模板
  const newBuild: BtlBuildV2 = {
    index: tileIndex.value,
    areaName: -1,
    constructionType: 0,     // 城市
    constructionLevel: 1,    // 一级
    constructionShop: 0,
    constructionStyle: 1,
    capitalStyle: 255,
    installationType: 255,
    strongPoint: 0,
    event: 255,
    bridges: [0, 0, 0],
    fireType: 0,
  }
  try { emit('replace', transactAddBuild(props.project, newBuild, props.terrain ? { width: props.terrain.info.mapW, height: props.terrain.info.mapH } : undefined).project); version.value++; }
  catch (e) { alert(e instanceof BtlTransactionError ? e.message : String(e)) }
}

function getShopItemName(itemID: number): string {
  if (itemID < 0) return ''
  return getItemDisplayName(itemID)
}

function getBarCommanderName(id: number): string {
  if (id <= 0) return ''
  return getCommanderName(id)
}

/* ===== 快捷键：C 复制 / D 删除 / V 粘贴（仅部队） ===== */

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function onKeyDown(e: KeyboardEvent) {
  if (isEditableTarget(e.target)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  const key = e.key.toLowerCase()
  if (key === 'c') {
    if (army.value) {
      copyArmy()
      e.preventDefault()
    }
  } else if (key === 'd') {
    if (army.value) {
      deleteArmy()
      e.preventDefault()
    }
  } else if (key === 'v') {
    if (clipboardArmy.value) {
      pasteArmy()
      e.preventDefault()
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div class="panel">
    <div v-if="!selected || tileIndex < 0" class="empty">
      点击地图上的地块以读取信息
    </div>

    <template v-else>
      <div class="kbd-hint">
        快捷键：<b>C</b> 复制 · <b>D</b> 删除 · <b>V</b> 粘贴
      </div>

      <div class="top-row">
        <div class="id-box">
          <span class="lbl">地块ID</span>
          <span class="val">{{ tileIndex }}</span>
        </div>
        <div class="legion-box">
          <span class="lbl">军团</span>
          <select :value="String(legionId)" @change="onLegionSelect">
            <option value="-1">（无）</option>
            <option value="255">（无归属）</option>
            <option v-for="o in legionOptions" :key="o.index" :value="String(o.index)">
              {{ o.label }}
            </option>
          </select>
        </div>
      </div>

      <div class="tabs">
        <button class="tab" :class="{ active: activeSection === 'army' }"
                @click="activeSection = 'army'">部队</button>
        <button class="tab" :class="{ active: activeSection === 'build' }"
                @click="activeSection = 'build'">建筑</button>
        <button class="tab" :class="{ active: activeSection === 'terrain' }"
                @click="activeSection = 'terrain'">地形</button>
      </div>

      <!-- 部队 -->
      <div v-if="activeSection === 'army'" class="section">
        <div class="section-head">
          <span>部队</span>
                    <span class="actions">
            <button class="mini-btn primary" :disabled="!!army" @click="addArmy">新增</button>
            <button class="mini-btn" :disabled="!army" @click="copyArmy">复制</button>
            <button class="mini-btn" :disabled="!clipboardArmy" @click="pasteArmy">粘贴</button>
            <button class="mini-btn danger" :disabled="!army" @click="deleteArmy">删除</button>
          </span>
        </div>

        <div v-if="army" class="grid compact">
          <label>兵种</label>
          <select :value="String(army.armyType)" @change="onArmyTypeSelect">
            <option value="-1">（空）</option>
            <option v-for="u in UNITS" :key="u.id" :value="String(u.id)">
              {{ u.id }} {{ u.name }}
            </option>
          </select>
          <label>编制</label>
          <select
            :value="String(army.armyGrade)"
            @change="(e) => onNum(e, (v) => onArmyField('armyGrade', v))"
          >
            <option
              v-for="g in gradeOptions(army.armyType, army.armyGrade)"
              :key="g"
              :value="String(g)"
            >
              {{ gradeLabel(g) }}
            </option>
          </select>

          <label>当前兵力</label>
          <input type="number" :value="army.strengthNow"
                 @change="(e) => onNum(e, (v) => onArmyField('strengthNow', v))" />
          <label>最大兵力</label>
          <input type="number" :value="army.strengthMax"
                 @change="(e) => onNum(e, (v) => onArmyField('strengthMax', v))" />

          <label>伤害</label>
          <input type="number" :value="army.damageCount"
                 @change="(e) => onNum(e, (v) => onArmyField('damageCount', v))" />
          <label>训练</label>
          <input type="number" :value="army.training"
                 @change="(e) => onNum(e, (v) => onArmyField('training', v))" />

          <label>移动力</label>
          <input type="number" :value="army.movement"
                 @change="(e) => onNum(e, (v) => onArmyField('movement', v))" />
          <label>士气</label>
          <input type="number" :value="army.morale"
                 @change="(e) => onNum(e, (v) => onArmyField('morale', v))" />

          <label>将领</label>
          <select
            :value="String(army.commander)"
            @change="(e) => onArmyField('commander', Number((e.target as HTMLSelectElement).value))"
          >
            <option v-for="c in commanderOptions" :key="c.id" :value="String(c.id)">
              {{ c.label }}
            </option>
          </select>
          <label>方向</label>
          <select :value="String(army.dir === 1 ? 1 : 0)" @change="onDirChange">
            <option value="0">← 左</option>
            <option value="1">→ 右</option>
          </select>

          <label>据点</label>
          <input type="number" :value="army.strongPoint"
                 @change="(e) => onNum(e, (v) => onArmyField('strongPoint', v))" />
          <label>运输船</label>
          <input type="number" :value="army.hasTroopship"
                 @change="(e) => onNum(e, (v) => onArmyField('hasTroopship', v))" />

          <label>未知09</label>
          <input type="number" :value="army.unknown09"
                 @change="(e) => onNum(e, (v) => onArmyField('unknown09', v))" />
          <label>事件</label>
          <input type="number" :value="army.event"
                 @change="(e) => onNum(e, (v) => onArmyField('event', v))" />

          <label>火焰</label>
          <input type="number" :value="army.fireType"
                 @change="(e) => onNum(e, (v) => onArmyField('fireType', v))" />
          <label>建造</label>
          <input type="number" :value="army.buildRound"
                 @change="(e) => onNum(e, (v) => onArmyField('buildRound', v))" />

          <label>已移动</label>
          <input type="number" :value="army.moved"
                 @change="(e) => onNum(e, (v) => onArmyField('moved', v))" />
          <label>已攻击</label>
          <input type="number" :value="army.attacked"
                 @change="(e) => onNum(e, (v) => onArmyField('attacked', v))" />

          <label>未知13</label>
          <input type="number" :value="army.unknown13"
                 @change="(e) => onNum(e, (v) => onArmyField('unknown13', v))" />
          <label>未知17</label>
          <input type="number" :value="army.unknown17"
                 @change="(e) => onNum(e, (v) => onArmyField('unknown17', v))" />

          <label>未知18</label>
          <input type="number" :value="army.unknown18"
                 @change="(e) => onNum(e, (v) => onArmyField('unknown18', v))" />
          <label>未知21</label>
          <input type="number" :value="army.unknown21"
                 @change="(e) => onNum(e, (v) => onArmyField('unknown21', v))" />

          <label>未知22</label>
          <input type="number" :value="army.unknown22"
                 @change="(e) => onNum(e, (v) => onArmyField('unknown22', v))" />
          <span></span><span></span>
        </div>
        <div v-else class="hint">此地块无部队</div>
      </div>

      <!-- 建筑 -->
      <div v-else-if="activeSection === 'build'" class="section">
        <div class="section-head">
          <span>建筑</span>
                    <span class="actions">
            <button class="mini-btn primary" :disabled="!!build" @click="addBuild">新增</button>
            <button class="mini-btn" :disabled="!build" @click="copyBuild">复制</button>
            <button class="mini-btn" :disabled="!clipboardBuild" @click="pasteBuild">粘贴</button>
            <button class="mini-btn danger" :disabled="!build" @click="deleteBuild">删除</button>
          </span>
        </div>

        <div v-if="build" class="grid compact">
          <label>区域</label>
          <input type="number" :value="build.areaName"
                 @change="(e) => onNum(e, (v) => onBuildField('areaName', v))" />
          <label>类型</label>
          <input type="number" :value="build.constructionType"
                 @change="(e) => onNum(e, (v) => onBuildField('constructionType', v))" />

          <label>等级</label>
          <input type="number" :value="build.constructionLevel"
                 @change="(e) => onNum(e, (v) => onBuildField('constructionLevel', v))" />
          <label>设施</label>
          <select :value="String(build.constructionShop)" @change="onBuildShopSelect">
            <option value="0">无</option>
            <option value="1">市场</option>
            <option value="2">商店</option>
            <option value="3">酒馆</option>
          </select>

          <label>样式</label>
          <input type="number" :value="build.constructionStyle"
                 @change="(e) => onNum(e, (v) => onBuildField('constructionStyle', v))" />
          <label>首都样式</label>
          <input type="number" :value="build.capitalStyle"
                 @change="(e) => onNum(e, (v) => onBuildField('capitalStyle', v))" />

          <label>工事</label>
          <input type="number" :value="build.installationType"
                 @change="(e) => onNum(e, (v) => onBuildField('installationType', v))" />
          <label>据点</label>
          <input type="number" :value="build.strongPoint"
                 @change="(e) => onNum(e, (v) => onBuildField('strongPoint', v))" />

          <label>事件</label>
          <input type="number" :value="build.event"
                 @change="(e) => onNum(e, (v) => onBuildField('event', v))" />
          <label>火焰</label>
          <input type="number" :value="build.fireType"
                 @change="(e) => onNum(e, (v) => onBuildField('fireType', v))" />
        </div>
        <div v-else class="hint">此地块无建筑</div>

        <div v-if="build" class="subsection">
          <div class="sub-head">桥梁</div>
          <div class="grid compact">
            <label>桥梁1</label>
            <input type="number" :value="build.bridges[0]"
                   @change="(e) => onNum(e, (v) => onBuildBridge(0, v))" />
            <label>桥梁2</label>
            <input type="number" :value="build.bridges[1]"
                   @change="(e) => onNum(e, (v) => onBuildBridge(1, v))" />
            <label>桥梁3</label>
            <input type="number" :value="build.bridges[2]"
                   @change="(e) => onNum(e, (v) => onBuildBridge(2, v))" />
            <span></span><span></span>
          </div>
        </div>

        <!-- 商店物品 -->
        <div v-if="build && build.constructionShop === 2" class="subsection">
          <div class="sub-head">商店物品（14 项）</div>
          <div class="shop-list">
            <div v-for="i in 14" :key="i - 1" class="shop-row">
              <span class="shop-idx">{{ i }}</span>
              <select
                class="shop-item-select"
                :value="String(shopData?.items[i - 1]?.itemID ?? -1)"
                @change="(e) => onShopItemSelect(i - 1, Number((e.target as HTMLSelectElement).value))"
              >
                <option v-for="it in itemOptions" :key="it.id" :value="String(it.id)">
                  {{ it.label }}
                </option>
              </select>
              <input type="number" class="shop-num-input"
                     :value="shopData?.items[i - 1]?.number ?? 0"
                     @change="(e) => onShopItemNum(i - 1, e)" />
            </div>
          </div>
        </div>

        <!-- 酒馆将领 -->
        <div v-if="build && build.constructionShop === 3" class="subsection">
          <div class="sub-head">酒馆将领（5 位）</div>
          <div class="grid compact">
            <label>席位数</label>
            <input type="number" :value="barData?.slot ?? 5"
                   @change="onBarSlot" />
            <span></span><span></span>
          </div>
          <div v-for="i in 5" :key="i - 1" class="bar-block">
            <div class="bar-title">将军 {{ i }}</div>
            <div class="grid compact">
              <label>将领</label>
              <select
                :value="String(barData?.commanders[i - 1]?.commanderID ?? -1)"
                @change="(e) => onBarCmdSelect(i - 1, Number((e.target as HTMLSelectElement).value))"
              >
                <option value="-1">（空）</option>
                <option v-for="c in commanderOptions" :key="c.id" :value="String(c.id)">
                  {{ c.label }}
                </option>
              </select>
              <label>价格</label>
              <input type="number" :value="barData?.commanders[i - 1]?.price ?? 0"
                     @change="(e) => onBarCmdField(i - 1, 'price', e)" />
              <label>工业</label>
              <input type="number" :value="barData?.commanders[i - 1]?.industry ?? 0"
                     @change="(e) => onBarCmdField(i - 1, 'industry', e)" />
              <label>勋章</label>
              <input type="number" :value="barData?.commanders[i - 1]?.medal ?? 0"
                     @change="(e) => onBarCmdField(i - 1, 'medal', e)" />
              <label>回合</label>
              <input type="number" :value="barData?.commanders[i - 1]?.round ?? 0"
                     @change="(e) => onBarCmdField(i - 1, 'round', e)" />
            </div>
          </div>
        </div>
      </div>

      <!-- 地形 -->
      <div v-else class="section">
        <div class="section-head"><span>地形</span></div>
        <div v-if="binTile" class="grid compact">
          <label>底层</label>
          <input type="number" :value="binTile.backTile"
                 @change="(e) => onNum(e, (v) => onBinField('backTile', v))" />
          <label>底层编号</label>
          <input type="number" :value="binTile.backIdx"
                 @change="(e) => onNum(e, (v) => onBinField('backIdx', v))" />

          <label>面层</label>
          <input type="number" :value="binTile.foreTile"
                 @change="(e) => onNum(e, (v) => onBinField('foreTile', v))" />
          <label>面层编号</label>
          <input type="number" :value="binTile.foreIdx"
                 @change="(e) => onNum(e, (v) => onBinField('foreIdx', v))" />

          <label>水边缘</label>
          <input type="number" :value="binTile.waterPass"
                 @change="(e) => onNum(e, (v) => onBinField('waterPass', v))" />
          <label>陆边缘</label>
          <input type="number" :value="binTile.landPass"
                 @change="(e) => onNum(e, (v) => onBinField('landPass', v))" />

          <label>偏移X</label>
          <input type="number" :value="binTile.backRefX"
                 @change="(e) => onNum(e, (v) => onBinField('backRefX', v))" />
          <label>偏移Y</label>
          <input type="number" :value="binTile.backRefY"
                 @change="(e) => onNum(e, (v) => onBinField('backRefY', v))" />
        </div>
        <div v-else class="hint">尚未导入地形 .bin</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel { padding: 8px 10px 12px; font-size: 13px; color: #d1d5db; }
.empty { color: #9ca3af; padding: 16px 8px; text-align: center; font-size: 12px; }

.kbd-hint {
  color: #6b7280;
  font-size: 11px;
  padding: 2px 4px 6px;
  user-select: none;
}
.kbd-hint b {
  color: #93c5fd;
  font-weight: 600;
}

.top-row { display: flex; gap: 6px; margin-bottom: 8px; }
.id-box {
  display: flex; align-items: center; gap: 4px; padding: 4px 8px;
  border: 1px solid #374151; border-radius: 4px; background: #111827;
  flex-shrink: 0;
}
.id-box .lbl { color: #9ca3af; font-size: 12px; }
.id-box .val { color: #f3f4f6; font-weight: 600; }

.legion-box {
  display: flex; align-items: center; gap: 4px; padding: 4px 6px;
  border: 1px solid #374151; border-radius: 4px; background: #111827;
  flex: 1; min-width: 0;
}
.legion-box .lbl { color: #9ca3af; font-size: 12px; flex-shrink: 0; }
.legion-box select {
  flex: 1; min-width: 0; padding: 2px 4px;
  border: 1px solid #4b5563; border-radius: 3px;
  background: #1f2937; color: #e5e7eb; font-size: 12px;
}

.tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.tab {
  flex: 1; padding: 6px 8px; border: 1px solid #374151; border-radius: 4px;
  background: #111827; color: #9ca3af; font-size: 12px; cursor: pointer;
}
.tab.active { background: #2563eb; border-color: #2563eb; color: #fff; }

.section {
  border: 1px solid #374151; border-radius: 6px;
  padding: 6px 8px 8px; background: #111827;
}
.section-head {
  display: flex; align-items: center; justify-content: space-between;
  font-weight: 600; color: #93c5fd; margin-bottom: 6px; font-size: 12px;
}
.actions { display: flex; gap: 4px; }
.mini-btn {
  padding: 3px 8px; border: 1px solid #4b5563; border-radius: 4px;
  background: #374151; color: #e5e7eb; font-size: 11px; cursor: pointer;
}
.mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mini-btn.danger { border-color: #7f1d1d; background: #7f1d1d; color: #fecaca; }
.mini-btn.danger:disabled { opacity: 0.35; }

.mini-btn.primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}
.mini-btn.primary:disabled {
  opacity: 0.35;
}

.subsection { margin-top: 8px; }
.sub-head { font-weight: 600; color: #93c5fd; margin-bottom: 4px; font-size: 12px; }

.grid.compact {
  display: grid; grid-template-columns: 62px 1fr 62px 1fr;
  gap: 3px 6px; align-items: center;
}
.grid.compact label { color: #9ca3af; font-size: 11px; }
.grid.compact input,
.grid.compact select {
  width: 100%; min-width: 0; padding: 3px 5px;
  border: 1px solid #4b5563; border-radius: 3px;
  background: #1f2937; color: #e5e7eb; font-size: 12px;
  box-sizing: border-box;
}
.grid.compact input:focus,
.grid.compact select:focus { outline: none; border-color: #2563eb; }

.shop-list { display: flex; flex-direction: column; gap: 3px; }
.shop-row {
  display: grid; grid-template-columns: 24px 1fr 60px;
  gap: 4px; align-items: center; font-size: 12px;
}
.shop-idx { color: #6b7280; text-align: right; font-size: 11px; }
.shop-item-select, .shop-num-input {
  width: 100%; min-width: 0; padding: 3px 5px;
  border: 1px solid #4b5563; border-radius: 3px;
  background: #1f2937; color: #e5e7eb; font-size: 12px;
  box-sizing: border-box;
}
.shop-num-input { text-align: center; }

.bar-block {
  margin-top: 6px; padding: 6px;
  border: 1px dashed #374151; border-radius: 4px;
}
.bar-title {
  color: #fbbf24; font-size: 11px; font-weight: 600;
  margin-bottom: 4px;
}

.hint { color: #6b7280; font-size: 12px; padding: 8px 0; }
</style>
