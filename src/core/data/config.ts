import { ref, watch } from 'vue'
import commandersXmlRaw from '/src/core/data/def_commanders.xml?raw'
import stringtableIniRaw from '/src/core/data/stringtable_cn.ini?raw'
import itemsXmlRaw from './def_item.xml?raw'


const STORAGE_KEY = 'ew4-editor-config-v6'

export type DisplayMode = 'chinese' | 'english'

export type TerrainMode = 'simple' | 'text' | 'image'

export interface DisplayConfig {
  buildingAlpha: number
  hexLineAlpha: number
  riverWidth: number
  breathSpeed: number
  actualCommander: boolean
  actualBuilding: boolean
  actualUnit: boolean
  terrainMode: TerrainMode
  terrainAlpha: number
}
export interface CityCustom {
  cn?: string
  en?: string
}

export interface CommanderEntry {
  id: number
  en: string
  cn: string
}

export interface ItemEntry {
  id: number
  en: string
  cn: string
}

export interface EditorConfig {
  unitNames: Record<string, string>
  unitAbbrs: Record<string, string>
  buildingNames: Record<string, string>
  cityNames: Record<string, CityCustom>
  countryNames: Record<string, string>
  battleNames: Record<string, string>
  commanders: CommanderEntry[]
  items: ItemEntry[]
  displayMode: DisplayMode
  display: DisplayConfig
}

export const DEFAULT_DISPLAY: DisplayConfig = {
  buildingAlpha: 0.85,
  hexLineAlpha: 0.35,
  riverWidth: 2,
  breathSpeed: 0.8,
  actualCommander: false,
  actualBuilding: false,
  actualUnit: false,
  terrainMode: 'simple',
  terrainAlpha: 1,
}

export const editorConfig = ref<EditorConfig>({
  unitNames: {},
  unitAbbrs: {},
  buildingNames: {},
  cityNames: {},
  countryNames: {},
  battleNames: {},
  commanders: [],
  items: [],
  displayMode: 'chinese',
  display: { ...DEFAULT_DISPLAY },
})

try {
  const s = localStorage.getItem(STORAGE_KEY)
  if (s) {
    const parsed = JSON.parse(s)
    editorConfig.value = {
      unitNames: parsed.unitNames ?? {},
      unitAbbrs: parsed.unitAbbrs ?? {},
      buildingNames: parsed.buildingNames ?? {},
                cityNames: parsed.cityNames ?? {},
      countryNames: parsed.countryNames ?? {},
      battleNames: parsed.battleNames ?? {},
      commanders: Array.isArray(parsed.commanders) ? parsed.commanders : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
      displayMode: parsed.displayMode ?? 'chinese',
            display: {
        buildingAlpha: parsed.display?.buildingAlpha ?? DEFAULT_DISPLAY.buildingAlpha,
        hexLineAlpha: parsed.display?.hexLineAlpha ?? DEFAULT_DISPLAY.hexLineAlpha,
        riverWidth: parsed.display?.riverWidth ?? DEFAULT_DISPLAY.riverWidth,
        breathSpeed: parsed.display?.breathSpeed ?? DEFAULT_DISPLAY.breathSpeed,
        actualCommander: parsed.display?.actualCommander ?? false,
        actualBuilding: parsed.display?.actualBuilding ?? false,
        actualUnit: parsed.display?.actualUnit ?? false,
        terrainMode: parsed.display?.terrainMode ?? 'image',
        terrainAlpha: parsed.display?.terrainAlpha ?? 1,
      },
    }
  }
} catch (e) {
  console.warn('[config] 读取失败', e)
}

watch(
  editorConfig,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(editorConfig.value))
    } catch (e) {
      console.warn('[config] 保存失败', e)
    }
  },
  { deep: true }
)

/* ===== 单位名称 ===== */
export function getUnitName(id: number, fallback: string): string {
  const v = editorConfig.value.unitNames[String(id)]
  return v && v.trim() ? v : fallback
}
export function setUnitName(id: number, name: string) {
  editorConfig.value.unitNames[String(id)] = name
}

/* ===== 单位缩写 ===== */
export function getUnitAbbr(id: number): string {
  const v = editorConfig.value.unitAbbrs[String(id)]
  return v && v.trim() ? v : ''
}
export function setUnitAbbr(id: number, abbr: string) {
  editorConfig.value.unitAbbrs[String(id)] = abbr
}

/* ===== 建筑名称 ===== */
export function getBuildingName(id: number, fallback: string): string {
  const v = editorConfig.value.buildingNames[String(id)]
  return v && v.trim() ? v : fallback
}
export function setBuildingName(id: number, name: string) {
  editorConfig.value.buildingNames[String(id)] = name
}

/* ===== 城市名称 ===== */
export function getCityDisplayName(id: number, defCn: string, defEn: string): string {
  const custom = editorConfig.value.cityNames[String(id)]
  if (editorConfig.value.displayMode === 'english') {
    if (custom?.en && custom.en.trim()) return custom.en
    return defEn || defCn
  }
  if (custom?.cn && custom.cn.trim()) return custom.cn
  return defCn || defEn
}
export function setCityNameCN(id: number, name: string) {
  const cur = editorConfig.value.cityNames[String(id)] ?? {}
  editorConfig.value.cityNames[String(id)] = { ...cur, cn: name }
}
export function setCityNameEN(id: number, name: string) {
  const cur = editorConfig.value.cityNames[String(id)] ?? {}
  editorConfig.value.cityNames[String(id)] = { ...cur, en: name }
}
export function getCityCustom(id: number): CityCustom {
  return editorConfig.value.cityNames[String(id)] ?? {}
}

/** 内置国家代码 → 中文名（用于兜底） */
export const DEFAULT_COUNTRIES: Record<string, string> = {
  fra: '法国',
  gbr: '大不列颠',
  rus: '俄国',
  spa: '西班牙',
  aus: '奥地利',
  pru: '普鲁士',
  tur: '奥斯曼土耳其',
  den: '丹麦',
  swe: '瑞典',
  por: '葡萄牙',
  bav: '巴伐利亚',
  per: '波斯',
  ned: '荷兰',
  usa: '美国',
  koi: '意大利',
  rhc: '莱茵联邦',
  hre: '神圣罗马帝国',
  pol: '波兰',
  nap: '那不勒斯王国',
  bad: '巴登',
  bru: '不伦瑞克',
  hes: '黑森州',
  mek: '梅克伦堡',
  old: '奥尔登堡',
  sax: '萨克森',
  wur: '符腾堡',
  nas: '拿索',
  che: '瑞士',
  pap: '教皇国',
  nds: '两西西里王国',
  pie: '皮尔蒙特',
  egy: '埃及',
  tri: '的黎波里塔尼亚',
  tun: '突尼斯',
  alg: '阿尔及利亚',
  mar: '摩洛哥',
  wal: '瓦拉吉亚',
  mol: '摩尔达维亚',
  srb: '塞尔维亚',
  ind: '印第安人',
}

/** 列出所有可选国家（内置 + 自定义），按代码排序 */
export function getAllCountries(): { code: string; name: string }[] {
  const set = new Set<string>()
  for (const k of Object.keys(DEFAULT_COUNTRIES)) set.add(k)
  for (const k of Object.keys(editorConfig.value.countryNames)) set.add(k)
  return Array.from(set)
    .sort()
    .map((code) => ({ code, name: getCountryName(code) }))
}

/* ===== 国家名称 ===== */
export function getCountryName(code: string): string {
  if (!code) return ''
  const v = editorConfig.value.countryNames[code]
  if (v && v.trim()) return v
  return DEFAULT_COUNTRIES[code] ?? code
}
export function setCountryName(code: string, name: string) {
  editorConfig.value.countryNames[code] = name
}

/* ===== 显示模式与参数 ===== */
export function setDisplayMode(mode: DisplayMode) {
  editorConfig.value.displayMode = mode
}
export function setBuildingAlpha(v: number) {
  editorConfig.value.display.buildingAlpha = Math.max(0, Math.min(1, v))
}
export function setHexLineAlpha(v: number) {
  editorConfig.value.display.hexLineAlpha = Math.max(0, Math.min(1, v))
}
export function setRiverWidth(v: number) {
  editorConfig.value.display.riverWidth = Math.max(0, Math.min(3.2, v))
}
export function setBreathSpeed(v: number) {
  editorConfig.value.display.breathSpeed = Math.max(0, Math.min(5, v))
}

export function setActualCommander(v: boolean) {
  editorConfig.value.display.actualCommander = v
}
export function setActualBuilding(v: boolean) {
  editorConfig.value.display.actualBuilding = v
}
export function setActualUnit(v: boolean) {
  editorConfig.value.display.actualUnit = v
}

export function setTerrainMode(mode: TerrainMode) {
  editorConfig.value.display.terrainMode = mode
}
export function setTerrainAlpha(v: number) {
  editorConfig.value.display.terrainAlpha = Math.max(0, Math.min(1, v))
}

/* ===== 重置 ===== */
export function resetAllNames() {
  editorConfig.value.unitNames = {}
  editorConfig.value.unitAbbrs = {}
  editorConfig.value.buildingNames = {}
  editorConfig.value.cityNames = {}
  editorConfig.value.countryNames = {}
}
export function resetDisplay() {
  editorConfig.value.display = { ...DEFAULT_DISPLAY }
}

/* ===== 将领 ===== */
export function findCommanderById(id: number): CommanderEntry | null {
  if (id <= 0) return null
  const list = editorConfig.value.commanders
  for (const c of list) if (c.id === id) return c
  if (id >= 20101 && id <= 20106) {
    for (const c of list) if (c.id === 1) return c
  }
  const base = Math.floor(id / 100)
  for (const c of list) if (c.id === base) return c
  return null
}

export function getCommanderDisplayName(id: number): string {
  const c = findCommanderById(id)
  if (!c) return ''
  return c.cn && c.cn.trim() ? c.cn : c.en
}

export function getCommanderName(id: number): string {
  if (id <= 0) return ''
  const c = findCommanderById(id)
  if (!c) return `#${id}`
  return c.cn && c.cn.trim() ? c.cn : c.en
}

export function setCommanderCN(id: number, name: string) {
  for (const c of editorConfig.value.commanders) {
    if (c.id === id) {
      c.cn = name
      editorConfig.value.commanders = [...editorConfig.value.commanders]
      return
    }
  }
}

export function importCommandersXml(xml: string): { ok: boolean; count: number } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, count: 0 }
    const nodes = doc.getElementsByTagName('commander')
    const existing = new Map<number, CommanderEntry>()
    for (const c of editorConfig.value.commanders) existing.set(c.id, c)
    let count = 0
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const idAttr = n.getAttribute('id')
      const nameAttr = n.getAttribute('name')
      if (!idAttr || !nameAttr) continue
      const id = parseInt(idAttr, 10)
      if (isNaN(id)) continue
      const cur = existing.get(id)
      existing.set(id, { id, en: nameAttr, cn: cur?.cn ?? '' })
      count++
    }
    editorConfig.value.commanders = [...existing.values()].sort((a, b) => a.id - b.id)
    return { ok: true, count }
  } catch (e) {
    console.warn('[config] 将领 XML 解析失败', e)
    return { ok: false, count: 0 }
  }
}

export function importStringtableIni(ini: string): {
  ok: boolean
  count: number
  countryCount: number
  battleCount: number
} {
  try {
    const text = ini.replace(/^\uFEFF/, '')
    const countryMap = new Map<string, string>()
    const nameMap = new Map<string, string>()
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^(?:name|title|text)_([^=]+?)\s*=\s*(.+)$/)
      if (!m) continue
      const key = m[1].trim()
      const val = m[2].trim()
      if (!key || !val) continue
      if (/^[a-z]{3}$/.test(key)) {
        if (!countryMap.has(key)) countryMap.set(key, val)
      } else {
        if (!nameMap.has(key)) nameMap.set(key, val)
      }
    }
    let cmdCount = 0
    for (const c of editorConfig.value.commanders) {
      const cn = nameMap.get(c.en)
      if (cn) {
        c.cn = cn
        cmdCount++
      }
    }
    editorConfig.value.commanders = [...editorConfig.value.commanders]
    let countryCount = 0
    for (const [code, name] of countryMap) {
      editorConfig.value.countryNames[code] = name
      countryCount++
    }
    let battleCount = 0
    for (const [k, v] of nameMap) {
      editorConfig.value.battleNames[k] = v
      battleCount++
    }
    editorConfig.value.battleNames = { ...editorConfig.value.battleNames }

    // 顺带匹配物品中文名
    for (const it of editorConfig.value.items) {
      const cn = nameMap.get(it.en)
      if (cn) it.cn = cn
    }
    editorConfig.value.items = [...editorConfig.value.items]

    return { ok: true, count: cmdCount, countryCount, battleCount }
  } catch (e) {
    console.warn('[config] stringtable 解析失败', e)
    return { ok: false, count: 0, countryCount: 0, battleCount: 0 }
  }
}

/** 查战役/章节名称，找不到就返回原值 */
export function getBattleTitle(name: string): string {
  return editorConfig.value.battleNames[name] || name
}

export async function loadBuiltinCommanders(): Promise<void> {
  // 1) 将领 XML
  try {
    const r = importCommandersXml(commandersXmlRaw)
    console.log('[config] 内置将领 XML 解析结果 =', r,
      '，将领数量 =', editorConfig.value.commanders.length)
  } catch (e) {
    console.error('[config] 内置将领 XML 解析异常', e)
  }
  // 2) 物品 XML
  try {
    const r = importItemsXml(itemsXmlRaw)
    console.log('[config] 内置物品 XML 解析结果 =', r,
      '，物品数量 =', editorConfig.value.items.length)
  } catch (e) {
    console.error('[config] 内置物品 XML 解析异常', e)
  }
  // 3) INI（此时将领和物品都已就绪，可匹配中文名）
  try {
    const r = importStringtableIni(stringtableIniRaw)
    console.log('[config] 内置 stringtable 解析结果 =', r,
      '，国家数量 =', Object.keys(editorConfig.value.countryNames).length)
  } catch (e) {
    console.error('[config] 内置 stringtable 解析异常', e)
  }
}

/* ===== 导入导出 JSON ===== */
export function exportConfig(): string {
  return JSON.stringify(editorConfig.value, null, 2)
}

export function importConfig(json: string): boolean {
  try {
    const parsed = JSON.parse(json)
    editorConfig.value = {
      unitNames: parsed.unitNames ?? {},
      unitAbbrs: parsed.unitAbbrs ?? {},
      buildingNames: parsed.buildingNames ?? {},
      cityNames: parsed.cityNames ?? {},
      countryNames: parsed.countryNames ?? {},
            battleNames: parsed.battleNames ?? {},
      commanders: Array.isArray(parsed.commanders) ? parsed.commanders : [],
      items: Array.isArray(parsed.items) ? parsed.items : [],
      displayMode: parsed.displayMode ?? 'chinese',
            display: {
        buildingAlpha: parsed.display?.buildingAlpha ?? DEFAULT_DISPLAY.buildingAlpha,
        hexLineAlpha: parsed.display?.hexLineAlpha ?? DEFAULT_DISPLAY.hexLineAlpha,
        riverWidth: parsed.display?.riverWidth ?? DEFAULT_DISPLAY.riverWidth,
        breathSpeed: parsed.display?.breathSpeed ?? DEFAULT_DISPLAY.breathSpeed,
        actualCommander: parsed.display?.actualCommander ?? false,
        actualBuilding: parsed.display?.actualBuilding ?? false,
        actualUnit: parsed.display?.actualUnit ?? false,
        terrainMode: parsed.display?.terrainMode ?? 'image',
        terrainAlpha: parsed.display?.terrainAlpha ?? 1,
      },
    }
    return true
  } catch {
    return false
  }
}

export function importAreaXml(xml: string): { ok: boolean; count: number } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, count: 0 }
    const nodes = doc.getElementsByTagName('areaname')
    let count = 0
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const id = n.getAttribute('id')
      const name = n.getAttribute('name')
      if (!id || !name) continue
      const numId = parseInt(id, 10)
      if (isNaN(numId)) continue
      const cur = editorConfig.value.cityNames[id] ?? {}
      editorConfig.value.cityNames[id] = { ...cur, en: name }
      count++
    }
    return { ok: true, count }
  } catch (e) {
    console.warn('[config] XML 解析失败', e)
    return { ok: false, count: 0 }
  }
}

/* ===== 物品 ===== */

export function findItemById(id: number): ItemEntry | null {
  if (id < 0) return null
  // 精确匹配
  const exact = editorConfig.value.items.find((it) => it.id === id)
  if (exact) return exact
  // 变体归约：ID ≥ 10000 时取后 4 位或低 2 位
  if (id >= 10000) {
    const tail4 = id % 10000
    const t4 = editorConfig.value.items.find((it) => it.id === tail4)
    if (t4) return t4
    const tail2 = id % 100
    const t2 = editorConfig.value.items.find((it) => it.id === tail2)
    if (t2) return t2
  }
  return null
}

export function getItemDisplayName(id: number): string {
  if (id < 0) return ''
  const it = findItemById(id)
  if (!it) return `#${id}`
  return it.cn && it.cn.trim() ? it.cn : it.en
}

export function setItemCN(id: number, name: string) {
  for (const it of editorConfig.value.items) {
    if (it.id === id) {
      it.cn = name
      editorConfig.value.items = [...editorConfig.value.items]
      return
    }
  }
}

/**
 * 导入 def_item.xml
 * 只保留基础 ID（< 10000），跳过 1NNNN 的变体
 */
export function importItemsXml(xml: string): { ok: boolean; count: number } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, count: 0 }
    const nodes = doc.getElementsByTagName('item')

    // 保留已有中文自定义
    const existing = new Map<number, ItemEntry>()
    for (const it of editorConfig.value.items) existing.set(it.id, it)

    const map = new Map<number, ItemEntry>()
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      const idAttr = n.getAttribute('id')
      const nameAttr = n.getAttribute('name')
      if (!idAttr || !nameAttr) continue
      const id = parseInt(idAttr, 10)
      if (isNaN(id) || id < 0) continue
      if (id >= 10000) continue  // 跳过变体
      const cur = existing.get(id)
      map.set(id, { id, en: nameAttr, cn: cur?.cn ?? '' })
    }

    editorConfig.value.items = [...map.values()].sort((a, b) => a.id - b.id)
    return { ok: true, count: map.size }
  } catch (e) {
    console.warn('[config] 物品 XML 解析失败', e)
    return { ok: false, count: 0 }
  }
}
