<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import type { BtlProject, BinProject } from '../core/formats/types'
import { terrainColor } from '../core/formats/bin'
import { UNITS, unitBadgeText, campColor } from '../core/data/units'
import { getBuildingSymbol, getStrongPointHighlight, getDefenseIcon, getCapitalSprite } from '../core/data/buildings'
import { getCityById } from '../core/data/cities'
import { editorConfig, getCityDisplayName, getUnitAbbr } from '../core/data/config'
import {
  commanderAtlasHd,
  commanderAtlasLd,
  buildingAtlasHd,
  buildingAtlasLd,
  getUnitImage,
  drawSpriteCentered,
  setAtlasLoadCallback,
} from '../core/data/spriteAtlas'
import {
  tilesAtlas,
  setTilesLoadCallback,
} from '../core/data/tilesAtlas'
import {
  getTerrainImage,
  getTerrainName,
  getTerrainSymbol,
} from '../core/data/terrainTypes'
import { editorConfig as _cfg } from '../core/data/config'


const props = defineProps<{
  project: BtlProject | null
  terrain: BinProject | null
  mode: string
  selected: { x: number; y: number } | null
  selectedCells?: number[]
  jurisdictionCenters?: number[] | null
  changeVersion?: number
  terrainMode?: boolean
  clipActive?: boolean
  clipStart?: { x: number; y: number } | null
  clipEnd?: { x: number; y: number } | null
}>()

const emit = defineEmits<{
  (e: 'tile-click', x: number, y: number): void
}>()

const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

const HEX_W = 32
const HEX_H = 36

const EDGES: Array<{
  bit: number
  p1: [number, number]
  p2: [number, number]
}> = [
  { bit: 0x20, p1: [0, -1], p2: [1, -0.5] },
  { bit: 0x01, p1: [1, -0.5], p2: [1, 0.5] },
  { bit: 0x02, p1: [1, 0.5], p2: [0, 1] },
  { bit: 0x04, p1: [0, 1], p2: [-1, 0.5] },
  { bit: 0x08, p1: [-1, 0.5], p2: [-1, -0.5] },
  { bit: 0x10, p1: [-1, -0.5], p2: [0, -1] },
]

import { DEFENSE_B64 } from '../core/data/imgData/defense_b64'

// 工事图标预加载
const defenseImages: Record<number, HTMLImageElement> = {}
{
  const initTypes = [1, 2, 3]
  for (const t of initTypes) {
    const file = getDefenseIcon(t)
    if (!file) continue
    const b64 = DEFENSE_B64[file]
    if (!b64) continue
    const img = new Image()
    img.onload = () => { try { draw() } catch { /* 初始化前忽略 */ } }
    img.onerror = () => console.warn('[MapView] 工事图标加载失败', file)
    img.src = `data:image/png;base64,${b64}`
    defenseImages[t] = img
  }
}

let ctx: CanvasRenderingContext2D | null = null
let dpr = 1

const view = { offsetX: 0, offsetY: 0, scale: 1 }
let dragging = false, dragStartX = 0, dragStartY = 0, lastX = 0, lastY = 0
let dragMoved = false, pinchDist = 0
let pinchCenterX = 0, pinchCenterY = 0
let animFrameId: number | null = null

const mapW = computed(() => {
  if (props.terrain) return props.terrain.info.mapW
  if (props.project) return props.project.info.mapW
  return 40
})
const mapH = computed(() => {
  if (props.terrain) return props.terrain.info.mapH
  if (props.project) return props.project.info.mapH
  return 40
})
/** 当前显示的地块范围（bin 坐标）：默认只显示截取范围，地形/截取模式显示全地图 */
const viewRange = computed(() => {
  const t = props.terrain
  const p = props.project
  if (!t) {
    return { x0: 0, y0: 0, w: mapW.value, h: mapH.value }
  }
   const terrainOnly = props.terrainMode === true
  const clipping = props.clipActive === true

  if (terrainOnly || clipping || !p) {
    return { x0: 0, y0: 0, w: t.info.mapW, h: t.info.mapH }
  }

  const x0 = Math.max(0, p.info.mapX)
  const y0 = Math.max(0, p.info.mapY)
  const x1 = Math.min(t.info.mapW, p.info.mapX + p.info.mapW)
  const y1 = Math.min(t.info.mapH, p.info.mapY + p.info.mapH)
  return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
})
const hasStrongPoints = computed(() => {
  const p = props.project
  if (!p) return false
  for (const b of p.builds) if (getStrongPointHighlight(b.strongPoint)) return true
  for (const a of p.armies) if (getStrongPointHighlight(a.strongPoint)) return true
  return false
})

function mapPixelW() { return mapW.value * HEX_W + HEX_W / 2 }
function mapPixelH() { return (mapH.value - 1) * HEX_H * 0.75 + HEX_H }
function hexCenter(col: number, row: number) {
  const offset = (row & 1) === 1 ? HEX_W / 2 : 0
  return { cx: col * HEX_W + offset + HEX_W / 2, cy: row * HEX_H * 0.75 + HEX_H / 2 }
}
function hexPath(cx: number, cy: number) {
  if (!ctx) return
  ctx.beginPath()
  ctx.moveTo(cx, cy - HEX_H / 2)
  ctx.lineTo(cx + HEX_W / 2, cy - HEX_H / 4)
  ctx.lineTo(cx + HEX_W / 2, cy + HEX_H / 4)
  ctx.lineTo(cx, cy + HEX_H / 2)
  ctx.lineTo(cx - HEX_W / 2, cy + HEX_H / 4)
  ctx.lineTo(cx - HEX_W / 2, cy - HEX_H / 4)
  ctx.closePath()
}
function pixelToHex(px: number, py: number) {
  const estRow = Math.floor(py / (HEX_H * 0.75))
  let best: { col: number; row: number; dist: number } | null = null
  for (let dr = -1; dr <= 1; dr++) {
    const row = estRow + dr
    if (row < 0 || row >= mapH.value) continue
    const offset = (row & 1) === 1 ? HEX_W / 2 : 0
    const estCol = Math.floor((px - offset) / HEX_W)
    for (let dc = -1; dc <= 1; dc++) {
      const col = estCol + dc
      if (col < 0 || col >= mapW.value) continue
      const { cx, cy } = hexCenter(col, row)
      const dist = Math.hypot(px - cx, py - cy)
      if (!best || dist < best.dist) best = { col, row, dist }
    }
  }
  if (best && best.dist <= HEX_H / 2) return { col: best.col, row: best.row }
  return null
}
function argbToCSS(argb: number): string {
  const s = (argb >>> 0).toString(16).padStart(8, '0')
  let nA = parseInt(s.substring(0, 2), 16); if (nA > 100) nA = 100
  const b = parseInt(s.substring(2, 4), 16), g = parseInt(s.substring(4, 6), 16), r = parseInt(s.substring(6, 8), 16)
  const nB = 0xff - Math.floor(((0xff - b) * nA) / 100)
  const nG = 0xff - Math.floor(((0xff - g) * nA) / 100)
  const nR = 0xff - Math.floor(((0xff - r) * nA) / 100)
  return `rgb(${nR}, ${nG}, ${nB})`
}
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  return `${parseInt(h.substring(0, 2), 16)},${parseInt(h.substring(2, 4), 16)},${parseInt(h.substring(4, 6), 16)}`
}

function resize() {
  const wrap = wrapRef.value, canvas = canvasRef.value
  if (!wrap || !canvas) return
  dpr = window.devicePixelRatio || 1
  const rect = wrap.getBoundingClientRect()
  canvas.width = Math.floor(rect.width * dpr)
  canvas.height = Math.floor(rect.height * dpr)
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height + 'px'
  ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  draw()
}
function fitToView() {
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const range = viewRange.value

  // 计算范围像素宽高
  const start = hexCenter(range.x0, range.y0)
  const end = hexCenter(range.x0 + range.w - 1, range.y0 + range.h - 1)
  const pw = end.cx - start.cx + HEX_W
  const ph = end.cy - start.cy + HEX_H

  const s = Math.min(rect.width / pw, rect.height / ph) * 0.95
  view.scale = Math.max(0.05, Math.min(4, s))

  // 让范围居中
  const rangeCenterX = start.cx + pw / 2
  const rangeCenterY = start.cy + ph / 2
  view.offsetX = rect.width / 2 - rangeCenterX * view.scale
  view.offsetY = rect.height / 2 - rangeCenterY * view.scale
}

function drawStrongPointRing(cx: number, cy: number, color: string, now: number) {
  if (!ctx) return
  const rgb = hexToRgb(color)
  const innerR = HEX_W / 2
  const maxR = innerR * 1.25

  ctx.strokeStyle = color
  ctx.lineWidth = 1.5   // 原 3 → 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 0.5   // 原 1 → 0.5
  ctx.beginPath()
  ctx.arc(cx, cy, innerR - 2, 0, Math.PI * 2)
  ctx.stroke()

  const speed = editorConfig.value.display.breathSpeed
  if (speed > 0) {
    const phase = ((now / 1000) * speed) % 1
    const r = innerR + (maxR - innerR) * phase
    const alpha = 0.9 * (1 - phase)
    ctx.strokeStyle = `rgba(${rgb}, ${alpha})`
    ctx.lineWidth = 1.25  // 原 2.5 → 1.25
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()

    const phase2 = phase - 0.18
    if (phase2 > 0) {
      const r2 = innerR + (maxR - innerR) * phase2
      const alpha2 = 0.55 * (1 - phase2)
      ctx.strokeStyle = `rgba(${rgb}, ${alpha2})`
      ctx.lineWidth = 0.75  // 原 1.5 → 0.75
      ctx.beginPath()
      ctx.arc(cx, cy, r2, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

/** 找将领头像 sprite 名 */
function commanderSpriteName(commanderId: number): string | null {
  if (commanderId <= 0) return null
  const p = props.project
  if (!p) return null
  // 先找精确
  for (const l of p.legions) {
    // 遍历不行，改用 config 里的 commanders
  }
  const entry = editorConfig.value.commanders.find(
    (c) => c.id === commanderId
  )
  if (entry) return `${entry.en}.png`
  // 变体处理
  if (commanderId >= 20101 && commanderId <= 20106) {
    return 'Napoleon.png'
  }
  const base = Math.floor(commanderId / 100)
  const entry2 = editorConfig.value.commanders.find((c) => c.id === base)
  return entry2 ? `${entry2.en}.png` : null
}

/** 建筑 sprite 名 */
function buildingSpriteName(constructionType: number, constructionLevel: number): string | null {
  const lv = Math.max(1, constructionLevel)
  switch (constructionType) {
    case 0: {
      // 7 级及以上使用城市群图
      if (lv >= 7) return 'city_west_lv7_up.png'
      return `city_west_lv${lv}.png`
    }
    case 1: return `factory_west_lv${Math.min(lv, 4)}.png`
    case 2: return `stable_west_lv${Math.min(lv, 3)}.png`
    case 3: return `port_${Math.min(lv, 4)}.png`
    case 4: return `farm_1_lv${Math.min(lv, 3)}.png`
    default: return null
  }
}

/** 等级图标 sprite 名 */
function buildingLevelIconName(constructionLevel: number): string {
  if (constructionLevel <= 0) return ''
  if (constructionLevel >= 7) return 'buildinglevel_max.png'
  return `buildinglevel_${constructionLevel}.png`
}



function drawArmyMark(
  col: number,
  row: number,
  armyType: number,
  armyGrade: number,
  camp: number,
  direction: number,
  commanderId: number
) {
  if (!ctx) return
  const { cx, cy } = hexCenter(col, row)
  const d = editorConfig.value.display

  const isFort = armyType >= 18 && armyType <= 21
  const r = HEX_W * 0.42
  const rFort = HEX_W * 0.46
  const fw = rFort * 2
  const fh = rFort * 1.75

  const baseColor = campColor(camp)

  // ===== 多层叠加底图（仅圆形兵牌，要塞不叠加） =====
  if (!isFort) {
    // 每层半径（基于 HEX_W）
    const layerRadii: number[] = []
    if (armyGrade >= 2) layerRadii.push(HEX_W * 0.54) // 三编：最底层（更大）
    if (armyGrade >= 1) layerRadii.push(HEX_W * 0.48) // 二编/三编：中层
    if (armyGrade >= 1) layerRadii.push(HEX_W * 0.43) // 二编/三编：上层

    // 从底往上画
    for (const lr of layerRadii) {
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 6
      ctx.shadowOffsetY = 3
      ctx.beginPath()
      ctx.arc(cx, cy, lr, 0, Math.PI * 2)
      ctx.fillStyle = baseColor
      ctx.fill()
      ctx.restore()

      // 层间描边，让叠加更清晰
      ctx.beginPath()
      ctx.arc(cx, cy, lr, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  // ===== 正面圆底 / 横六边形 =====
  if (isFort) {
    ctx.beginPath()
    ctx.moveTo(cx - fw / 2, cy)
    ctx.lineTo(cx - fw / 4, cy - fh / 2)
    ctx.lineTo(cx + fw / 4, cy - fh / 2)
    ctx.lineTo(cx + fw / 2, cy)
    ctx.lineTo(cx + fw / 4, cy + fh / 2)
    ctx.lineTo(cx - fw / 4, cy + fh / 2)
    ctx.closePath()
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }
  ctx.fillStyle = baseColor
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // ===== 兵牌主内容 =====
  let drewUnit = false
  if (d.actualUnit) {
    const u = UNITS[armyType]
    if (u && u.icon) {
      const img = getUnitImage(u.icon)
      if (img && img.complete && img.naturalWidth > 0) {
        const inner = r * 1.7
        ctx.save()
        if (isFort) {
          ctx.beginPath()
          ctx.moveTo(cx - fw / 2, cy)
          ctx.lineTo(cx - fw / 4, cy - fh / 2)
          ctx.lineTo(cx + fw / 4, cy - fh / 2)
          ctx.lineTo(cx + fw / 2, cy)
          ctx.lineTo(cx + fw / 4, cy + fh / 2)
          ctx.lineTo(cx - fw / 4, cy + fh / 2)
          ctx.closePath()
          ctx.clip()
        } else {
          ctx.beginPath()
          ctx.arc(cx, cy, r - 1, 0, Math.PI * 2)
          ctx.clip()
        }
        ctx.drawImage(img, cx - inner / 2, cy - inner / 2, inner, inner)
        ctx.restore()
        drewUnit = true
      }
    }
  }
  if (!drewUnit) {
    const abbr = getUnitAbbr(armyType)
    const text = unitBadgeText(armyType, armyGrade, abbr)
    ctx.font = `bold ${Math.round(r * 0.85)}px "PingFang SC","Microsoft YaHei",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(text, cx, cy - r * 0.08)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, cx, cy - r * 0.08)
  }

  // ===== 将领 G（未开启实际显示时兜底） =====
  if (!d.actualCommander && commanderId > 0) {
    const gr = r * 0.42
    const gx = cx - r * 0.7
    const gy = cy - r * 0.7
    ctx.beginPath()
    ctx.arc(gx, gy, gr, 0, Math.PI * 2)
    ctx.fillStyle = '#fbbf24'
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.font = `bold ${Math.round(gr * 1.4)}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1f2937'
    ctx.fillText('G', gx, gy + gr * 0.05)
  }

  // ===== 方向箭头 =====
  const arrow = direction === 1 ? '→' : '←'
  const arrowSize = Math.round(r * 0.55)
  ctx.font = `bold ${arrowSize}px "PingFang SC","Microsoft YaHei",sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const ax = cx
  const ay = cy + r - r * 0.08
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(0,0,0,0.95)'
  ctx.strokeText(arrow, ax, ay)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(arrow, ax, ay)
}

/** 将领头像：屏幕尺寸固定，不随缩放变小 */
function drawCommanderMark(col: number, row: number, commanderId: number) {
  if (!ctx) return
  const d = editorConfig.value.display
  if (!d.actualCommander) return

  const { cx, cy } = hexCenter(col, row)
  const r = HEX_W * 0.42

  const screenSize = 22
  const worldSize = screenSize / view.scale

  const gx = cx - r * 0.65
  const gy = cy - r * 0.65

  ctx.beginPath()
  ctx.arc(gx, gy, worldSize / 2 + 1, 0, Math.PI * 2)
  ctx.fillStyle = '#fbbf24'
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.9)'
  ctx.lineWidth = 1.5 / view.scale
  ctx.stroke()

  const spriteName = commanderSpriteName(commanderId)
  if (!spriteName) {
    ctx.font = `bold ${Math.round(worldSize * 0.7)}px Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1f2937'
    ctx.fillText('G', gx, gy + worldSize * 0.03)
    return
  }
  if (
    drawSpriteCentered(ctx, commanderAtlasHd, spriteName, gx, gy, worldSize) ||
    drawSpriteCentered(ctx, commanderAtlasLd, spriteName, gx, gy, worldSize)
  ) {
    return
  }
  ctx.font = `bold ${Math.round(worldSize * 0.7)}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#1f2937'
  ctx.fillText('G', gx, gy + worldSize * 0.03)
}
function drawBuildingBlock(
  col: number,
  row: number,
  constructionType: number,
  constructionLevel: number,
  capitalStyle: number,
  constructionShop: number
) {
  if (!ctx) return
  const { cx, cy } = hexCenter(col, row)
  const size = HEX_W * 0.72
  const half = size / 2
  const radius = Math.max(2, size * 0.12)
  const alpha = editorConfig.value.display.buildingAlpha
  const d = editorConfig.value.display

  let drew = false
  if (d.actualBuilding) {
    const atlasHd = buildingAtlasHd
    const atlasLd = buildingAtlasLd
    const atlas = atlasHd.loaded ? atlasHd : atlasLd

    if (atlas.loaded && atlas.img) {
      const bottomY = cy + HEX_H * 0.32

      // 1) 基础建筑图：7 级城用小一些的基础图，奇观单独放大
      const isCapital = constructionType === 0 && constructionLevel >= 7
      const baseW = isCapital ? HEX_W * 0.8 : HEX_W * 1.05

      const baseName = buildingSpriteName(constructionType, constructionLevel)
      if (baseName) {
        const s = atlas.get(baseName)
        if (s) {
          const targetH = (baseW * s.h) / s.w
          ctx.drawImage(
            atlas.img,
            s.x, s.y, s.w, s.h,
            cx - baseW / 2, bottomY - targetH, baseW, targetH
          )
          drew = true
        }
      }

      // 2) 首都奇观（大小固定，不受基础图影响）
      const capSpriteName = isCapital ? getCapitalSprite(capitalStyle) : null
      if (capSpriteName) {
        const cs = atlas.get(capSpriteName)
        if (cs) {
          const capW = HEX_W * 1.05 * 0.65
          const capH = (capW * cs.h) / cs.w
          const capCy = cy - HEX_H * 0.04
          ctx.drawImage(
            atlas.img,
            cs.x, cs.y, cs.w, cs.h,
            cx - capW / 2, capCy - capH / 2, capW, capH
          )
        }
      }
      // 3) 等级图标 + 附属图标
      if (drew) {
        const iconSize = HEX_W * 0.42
        // 等级图标位置：更靠下，确保在建筑图下方清晰可见
        const lvY = cy + HEX_H * 0.46

        // 罗马数字等级图标（7 级用 buildinglevel_max）
        const lvName = buildingLevelIconName(constructionLevel)
        if (lvName) {
          if (!drawSpriteCentered(ctx, atlasHd, lvName, cx, lvY, iconSize, iconSize)) {
            drawSpriteCentered(ctx, atlasLd, lvName, cx, lvY, iconSize, iconSize)
          }
        }

        // 附属图标（酒馆/市场/商店），显示在等级图标右侧
        // 1 = 市场，2 = 商店，3 = 酒馆
        let subName: string | null = null
        if (constructionShop === 1) subName = 'marker_trade.png'
        else if (constructionShop === 2) subName = 'marker_shop.png'
        else if (constructionShop === 3) subName = 'marker_bar.png'

        if (subName) {
          const subSize = iconSize * 0.9
          const subX = cx + iconSize * 0.7
          if (!drawSpriteCentered(ctx, atlasHd, subName, subX, lvY, subSize, subSize)) {
            drawSpriteCentered(ctx, atlasLd, subName, subX, lvY, subSize, subSize)
          }
        }
      }
    }
  }

  if (drew) return

  // 兜底：黑底 + 符号
  const x0 = cx - half
  const y0 = cy - half
  ctx.beginPath()
  ctx.moveTo(x0 + radius, y0)
  ctx.lineTo(x0 + size - radius, y0)
  ctx.quadraticCurveTo(x0 + size, y0, x0 + size, y0 + radius)
  ctx.lineTo(x0 + size, y0 + size - radius)
  ctx.quadraticCurveTo(x0 + size, y0 + size, x0 + size - radius, y0 + size)
  ctx.lineTo(x0 + radius, y0 + size)
  ctx.quadraticCurveTo(x0, y0 + size, x0, y0 + size - radius)
  ctx.lineTo(x0, y0 + radius)
  ctx.quadraticCurveTo(x0, y0, x0 + radius, y0)
  ctx.closePath()

  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 1.8
  ctx.stroke()

  const symbol = getBuildingSymbol(constructionType)
  let text = symbol
  if (constructionLevel > 0 && constructionLevel < 100 &&
      constructionType !== 11 && constructionType !== 12 && constructionType !== 13) {
    text = `${symbol}${constructionLevel}`
  }
  const fontSize = text.length >= 2 ? Math.round(size * 0.52) : Math.round(size * 0.72)
  ctx.font = `bold ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0,0,0,1)'
  ctx.strokeText(text, cx, cy)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, cx, cy)
}

/** 工事图标：绘制在六边形底部，不超出下边缘 */
function drawDefenseIcon(cx: number, cy: number, installationType: number) {
  if (!ctx) return
  const img = defenseImages[installationType]

  const bottomY = cy + HEX_H / 2
  const halfW = HEX_W / 2

  let targetW = HEX_W * 0.88
  let targetH = 20

  if (img && img.complete && img.naturalWidth > 0) {
    const aspect = img.naturalHeight / img.naturalWidth
    targetH = targetW * aspect
    const maxH = HEX_H * 0.55
    if (targetH > maxH) {
      targetH = maxH
      targetW = targetH / aspect
    }
  }

  const x = cx - targetW / 2
  const y = bottomY - targetH - 1
  const finalX = Math.max(cx - halfW + 1, Math.min(cx + halfW - targetW - 1, x))

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, finalX, y, targetW, targetH)
  } else {
    const label = installationType === 1 ? '掩' : installationType === 2 ? '栏' : '壕'
    const fontSize = Math.round(HEX_W * 0.42)
    ctx.font = `bold ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    const ty = bottomY - 2
    ctx.strokeText(label, cx, ty)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, cx, ty)
  }
}


function drawCityLabel(col: number, row: number, areaName: number) {
  if (!ctx) return
  const city = getCityById(areaName)
  if (!city) return
  const name = getCityDisplayName(areaName, city.cn, city.en)
  if (!name) return
  const { cx, cy } = hexCenter(col, row)
  const size = HEX_W * 0.72
  const nameSize = Math.max(10, Math.round(HEX_W * 0.34))
  ctx.font = `bold ${nameSize}px "PingFang SC","Microsoft YaHei",sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const ty = cy + size / 2 + nameSize * 0.85
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.95)'
  ctx.strokeText(name, cx, ty); ctx.fillStyle = '#fef3c7'; ctx.fillText(name, cx, ty)
}

function drawTerrainOverlay(col: number, row: number, foreTile: number, foreIdx: number) {
  if (!ctx) return
  if (foreTile === 0 || foreTile === 255) return

  const { cx, cy } = hexCenter(col, row)
  const mode = editorConfig.value.display.terrainMode

  if (mode === 'image') {
    // 图集未加载时降级显示文字
    if (!tilesAtlas.loaded || !tilesAtlas.img) {
      const name = getTerrainName(foreTile)
      if (name) {
        const text = `${name}${foreIdx}`
        ctx.font = `bold ${Math.round(HEX_W * 0.32)}px "PingFang SC","Microsoft YaHei",sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(0,0,0,0.9)'
        ctx.strokeText(text, cx, cy)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(text, cx, cy)
      }
      return
    }

    const imgName = getTerrainImage(foreTile, foreIdx)
    if (!imgName) return
    const sp = tilesAtlas.get(imgName)
    if (!sp) {
      console.warn('[MapView] sprite 不存在:', imgName, 'foreTile=', foreTile, 'foreIdx=', foreIdx)
      return
    }

    const scale = 0.3
    const dw = sp.w * scale
    const dh = sp.h * scale
    const refx = (sp.refx ?? sp.w / 2) * scale
    const refy = (sp.refy ?? sp.h / 2) * scale
    ctx.drawImage(
      tilesAtlas.img,
      sp.x, sp.y, sp.w, sp.h,
      cx - refx, cy - refy, dw, dh
    )
  } else if (mode === 'text') {
    const name = getTerrainName(foreTile)
    if (!name) return
    const text = `${name}${foreIdx}`
    ctx.font = `bold ${Math.round(HEX_W * 0.32)}px "PingFang SC","Microsoft YaHei",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.strokeText(text, cx, cy)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, cx, cy)
  } else {
    const symbol = getTerrainSymbol(foreTile)
    if (!symbol) return
    ctx.font = `bold ${Math.round(HEX_W * 0.55)}px "PingFang SC","Microsoft YaHei",sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(symbol, cx, cy)
    ctx.fillStyle = '#1f2937'
    ctx.fillText(symbol, cx, cy)
  }
}

function drawWaterEdge(cx: number, cy: number, mask: number) {
  if (!ctx) return
  const width = Math.min(editorConfig.value.display.riverWidth, HEX_W * 0.1)
  if (width <= 0) return
  ctx.save()
  ctx.strokeStyle = '#4a90d9'; ctx.lineWidth = width; ctx.lineCap = 'round'
  for (const seg of EDGES) {
    if (mask & seg.bit) {
      ctx.beginPath()
      ctx.moveTo(cx + (seg.p1[0] * HEX_W) / 2, cy + (seg.p1[1] * HEX_H) / 2)
      ctx.lineTo(cx + (seg.p2[0] * HEX_W) / 2, cy + (seg.p2[1] * HEX_H) / 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}





function drawBridge(cx: number, cy: number, bridges: number[]) {
  if (!ctx) return
  const d = editorConfig.value.display

  // 兜底：没开实际显示时用白线
  if (!d.actualBuilding) {
    ctx.save()
    ctx.lineCap = 'round'
    const railW = 2.2
    const borderW = 4.2
    const railGap = HEX_W * 0.22
    for (const seg of EDGES) {
      const v = [0, 0, 0]
      for (let i = 0; i < 3; i++) if (bridges[i] === seg.bit) v[i] = 1
      if (!v[0] && !v[1] && !v[2]) continue
      const ex = (seg.p1[0] + seg.p2[0]) / 2
      const ey = (seg.p1[1] + seg.p2[1]) / 2
      const mx = cx + (ex * HEX_W) / 2
      const my = cy + (ey * HEX_H) / 2
      let dx = mx - cx
      let dy = my - cy
      const len = Math.hypot(dx, dy)
      if (len === 0) continue
      dx /= len; dy /= len
      const x1 = cx + dx * len * 0.12, y1 = cy + dy * len * 0.12
      const x2 = cx + dx * len * 1.10, y2 = cy + dy * len * 1.10
      const px = -dy, py = dx
      for (const offset of [-railGap / 2, railGap / 2]) {
        const ax = x1 + px * offset, ay = y1 + py * offset
        const bx = x2 + px * offset, by = y2 + py * offset
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
        ctx.strokeStyle = 'rgba(0,0,0,1)'; ctx.lineWidth = borderW; ctx.stroke()
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = railW; ctx.stroke()
      }
    }
    ctx.restore()
    return
  }

  const atlas = buildingAtlasHd.loaded ? buildingAtlasHd : buildingAtlasLd
  if (!atlas.loaded || !atlas.img) return

  // 值 → 分序号（方向类别）
  const dirClassMap: Record<number, number> = {
    1: 1, 8: 1,     // 水平
    2: 2, 16: 2,    // 左上-右下
    4: 3, 32: 3,    // 左下-右上
  }

  // 只画朝右、右下、左下的桥（对面格负责另一半）
  const shouldDraw = [1, 2, 4]

  // 方向单位向量（屏幕坐标，y 向下）
  const dirVectors: Record<number, [number, number]> = {
    1: [1, 0],            // 右
    2: [0.5, 0.866],      // 右下
    4: [-0.5, 0.866],     // 左下
  }

  for (let idx = 0; idx < bridges.length; idx++) {
    const v = bridges[idx]
    if (!shouldDraw.includes(v)) continue

    const dirClass = dirClassMap[v]
    const name = `bridge_${idx + 1}_${dirClass}.png`
    const s = atlas.get(name)
    if (!s) continue

    // 图片缩放：稍微缩小避免过大，桥长约 2 格宽
    const scale = 0.3
    const displayW = s.w * scale
    const displayH = s.h * scale

    // 锚点：格子中心 + 半格方向偏移 = 两格交界处
    const [dx, dy] = dirVectors[v]
    const dist = HEX_W * 0.5
    const imgCx = cx + dx * dist
    const imgCy = cy + dy * dist

    ctx.drawImage(
      atlas.img,
      s.x, s.y, s.w, s.h,
      imgCx - displayW / 2, imgCy - displayH / 2,
      displayW, displayH
    )
  }
}






function draw() {
  const canvas = canvasRef.value
  if (!ctx || !canvas) return
  const now = performance.now()
  const w = canvas.width / dpr, h = canvas.height / dpr
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(view.offsetX, view.offsetY)
  ctx.scale(view.scale, view.scale)

  const mw = mapW.value, mh = mapH.value
  const t = props.terrain, p = props.project
  const terrainOnly = props.terrainMode === true

  if (t) {
    // 计算显示范围
    const range = viewRange.value
    const R0 = Math.max(0, range.y0)
    const R1 = Math.min(mh, range.y0 + range.h)
    const C0 = Math.max(0, range.x0)
    const C1 = Math.min(mw, range.x0 + range.w)

    for (let row = R0; row < R1; row++) {
      for (let col = C0; col < C1; col++) {
        const tile = t.tiles[row * mw + col]
        if (!tile) continue
        const { cx, cy } = hexCenter(col, row)
        ctx.fillStyle = terrainColor(tile.backTile, tile.foreTile)
        hexPath(cx, cy); ctx.fill()
      }
    }

    if (p && !terrainOnly) {
      const btlW = p.info.mapW, btlH = p.info.mapH
      const mapX = p.info.mapX, mapY = p.info.mapY
      for (let by = 0; by < btlH; by++) {
        for (let bx = 0; bx < btlW; bx++) {
          const btlTile = p.tiles[by * btlW + bx]
          if (!btlTile) continue
          const idx = btlTile.legion
          if (idx === 0xff || idx < 0) continue
          const legion = p.legions[idx]
          if (!legion) continue
          const col = bx + mapX, row = by + mapY
          if (col < 0 || col >= mw || row < 0 || row >= mh) continue
          const { cx, cy } = hexCenter(col, row)
          ctx.fillStyle = argbToCSS(legion.color)
          hexPath(cx, cy); ctx.fill()
        }
      }
    }

    // 地形面层（森林/沙漠/山岗/山脉/海洋）——画在军团涂色之上
    {
      const alpha = editorConfig.value.display.terrainAlpha
      if (alpha > 0) {
        const prevAlpha = ctx.globalAlpha
        ctx.globalAlpha = alpha
        for (let row = R0; row < R1; row++) {
          for (let col = C0; col < C1; col++) {
            const tile = t.tiles[row * mw + col]
            if (!tile) continue
            drawTerrainOverlay(col, row, tile.foreTile, tile.foreIdx)
          }
        }
        ctx.globalAlpha = prevAlpha
      }
    }

    for (let row = R0; row < R1; row++) {
      for (let col = C0; col < C1; col++) {
        const tile = t.tiles[row * mw + col]
        if (!tile) continue
        if (tile.waterPass > 0 && tile.waterPass < 64) {
          const { cx, cy } = hexCenter(col, row)
          drawWaterEdge(cx, cy, tile.waterPass)
        }
      }
    }

    const hexAlpha = editorConfig.value.display.hexLineAlpha
    if (hexAlpha > 0) {
      ctx.strokeStyle = `rgba(0, 0, 0, ${hexAlpha})`
      ctx.lineWidth = 1
      for (let row = R0; row < R1; row++) {
        for (let col = C0; col < C1; col++) {
          const { cx, cy } = hexCenter(col, row)
          hexPath(cx, cy); ctx.stroke()
        }
      }
    }
  } else if (p) {
    for (let row = 0; row < mh; row++) {
      for (let col = 0; col < mw; col++) {
        const tile = p.tiles[row * mw + col]
        if (!tile) continue
        const idx = tile.legion
        if (idx === 0xff || idx < 0) continue
        const legion = p.legions[idx]
        if (!legion) continue
        const { cx, cy } = hexCenter(col, row)
        ctx.fillStyle = argbToCSS(legion.color)
        hexPath(cx, cy); ctx.fill()
      }
    }
  }

  if (p && t && !terrainOnly && (props.mode === 'build' || props.mode === 'terrain')) {
    const binW = t.info.mapW
    for (const build of p.builds) {
      const gx = build.index % binW
      const gy = Math.floor(build.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      if (build.constructionType === 0xff) continue
      if (build.bridges.some((m) => m > 0 && m < 64)) continue
                  drawBuildingBlock(
        gx, gy,
        build.constructionType,
        build.constructionLevel,
        build.capitalStyle,
        build.constructionShop
      )
    }
  }

    if (p && t) {
    const binW = t.info.mapW
    for (const build of p.builds) {
      const gx = build.index % binW
      const gy = Math.floor(build.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      const { cx, cy } = hexCenter(gx, gy)
      drawBridge(cx, cy, build.bridges)
    }
  }

  if (p && t && !terrainOnly && (props.mode === 'army' || props.mode === 'terrain')) {
    const binW = t.info.mapW, btlW = p.info.mapW
    const mapX = p.info.mapX, mapY = p.info.mapY
    for (const army of p.armies) {
      const gx = army.index % binW
      const gy = Math.floor(army.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      const bx = gx - mapX, by = gy - mapY
      let camp = 0
      if (bx >= 0 && bx < btlW && by >= 0 && by < p.info.mapH) {
        const btlTile = p.tiles[by * btlW + bx]
        if (btlTile) {
          const idx = btlTile.legion
          if (idx !== 0xff && idx >= 0) {
            const legion = p.legions[idx]
            if (legion) camp = legion.camp
          }
        }
      }
          drawArmyMark(
        gx,
        gy,
        army.armyType,
        army.armyGrade,
        camp,
        army.dir === 1 ? 1 : 0,
        army.commander
      )
      
    }
  }
  // 工事图标（在兵牌之后绘制）
  if (p && t && !terrainOnly) {
    const binW = t.info.mapW
    for (const build of p.builds) {
      const gx = build.index % binW
      const gy = Math.floor(build.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      if (build.installationType < 1 || build.installationType > 3) continue
      const { cx, cy } = hexCenter(gx, gy)
      drawDefenseIcon(cx, cy, build.installationType)
    }
  }

  if (p && t && !terrainOnly && (props.mode === 'build' || props.mode === 'terrain')) {
    const binW = t.info.mapW
    for (const build of p.builds) {
      const gx = build.index % binW
      const gy = Math.floor(build.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      if (build.constructionType === 0xff) continue
      if (build.bridges.some((m) => m > 0 && m < 64)) continue
      drawCityLabel(gx, gy, build.areaName)
    }
  }

  if (p && t && !terrainOnly) {
    const binW = t.info.mapW
    const drawn = new Set<number>()
    for (const build of p.builds) {
      const gx = build.index % binW
      const gy = Math.floor(build.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      const hl = getStrongPointHighlight(build.strongPoint)
      if (!hl) continue
      if (drawn.has(build.index)) continue
      drawn.add(build.index)
      const { cx, cy } = hexCenter(gx, gy)
      drawStrongPointRing(cx, cy, hl === 'red' ? '#FF3030' : '#FFD700', now)
    }
    for (const army of p.armies) {
      const gx = army.index % binW
      const gy = Math.floor(army.index / binW)
      if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
      const hl = getStrongPointHighlight(army.strongPoint)
      if (!hl) continue
      if (drawn.has(army.index)) continue
      drawn.add(army.index)
      const { cx, cy } = hexCenter(gx, gy)
      drawStrongPointRing(cx, cy, hl === 'red' ? '#FF3030' : '#FFD700', now)
    }
  }

  if (props.clipStart) {
    const { cx, cy } = hexCenter(props.clipStart.x, props.clipStart.y)
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 3
    hexPath(cx, cy); ctx.stroke()
  }
  if (props.clipStart && props.clipEnd) {
    const x0 = Math.min(props.clipStart.x, props.clipEnd.x)
    const x1 = Math.max(props.clipStart.x, props.clipEnd.x)
    const y0 = Math.min(props.clipStart.y, props.clipEnd.y)
    const y1 = Math.max(props.clipStart.y, props.clipEnd.y)

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    for (let row = 0; row < mh; row++) {
      for (let col = 0; col < mw; col++) {
        const inside = col >= x0 && col <= x1 && row >= y0 && row <= y1
        if (inside) continue
        const { cx, cy } = hexCenter(col, row)
        hexPath(cx, cy); ctx.fill()
      }
    }
    ctx.strokeStyle = '#22c55e'
    ctx.lineWidth = 2
    for (let row = y0; row <= y1; row++) {
      for (let col = x0; col <= x1; col++) {
        const { cx, cy } = hexCenter(col, row)
        hexPath(cx, cy); ctx.stroke()
      }
    }
  }

  // 将领头像（覆盖在据点之上）
  if (p && t && !terrainOnly) {
    const binW = t.info.mapW
    if (editorConfig.value.display.actualCommander) {
      for (const army of p.armies) {
        if (army.commander <= 0) continue
        const gx = army.index % binW
        const gy = Math.floor(army.index / binW)
        if (gx < 0 || gx >= mw || gy < 0 || gy >= mh) continue
        drawCommanderMark(gx, gy, army.commander)
      }
    }
  }

  if (p && t && props.jurisdictionCenters) {
    for (let i = 0; i < props.jurisdictionCenters.length; i++) {
      const center = props.jurisdictionCenters[i]!
      if (center < 0) continue
      const { cx, cy } = hexCenter(i % p.info.mapW + p.info.mapX, Math.floor(i / p.info.mapW) + p.info.mapY)
      ctx.fillStyle = `hsla(${(center * 137) % 360},65%,50%,0.25)`
      hexPath(cx, cy); ctx.fill()
    }
  }
  if (t && props.selectedCells) {
    ctx.strokeStyle = '#10e6c0'; ctx.lineWidth = 2
    ctx.fillStyle = 'rgba(16,230,192,0.18)'
    for (const cell of props.selectedCells) {
      const { cx, cy } = hexCenter(cell % t.info.mapW, Math.floor(cell / t.info.mapW))
      hexPath(cx, cy); ctx.fill(); ctx.stroke()
    }
  }
  if (props.selected) {
    const { x, y } = props.selected
    const { cx, cy } = hexCenter(x, y)
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3
    hexPath(cx, cy); ctx.stroke()
  }

  ctx.restore()
}

let rafPending = false
function scheduleDraw() {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    draw()
  })
}


function startAnim() {
  if (animFrameId !== null) return
  const loop = () => { draw(); animFrameId = requestAnimationFrame(loop) }
  animFrameId = requestAnimationFrame(loop)
}
function stopAnim() {
  if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null }
}
/** 最小缩放：让屏幕最多显示"范围 + 上下左右各5格" */
function getMinScale(): number {
  const wrap = wrapRef.value
  if (!wrap) return 0.05
  const rect = wrap.getBoundingClientRect()
  const range = viewRange.value
  const mw = range.w + 10
  const mh = range.h + 10
  const pw = mw * HEX_W
  const ph = mh * HEX_H
  const s = Math.min(rect.width / pw, rect.height / ph) * 0.95
  return Math.max(0.02, s)
}

function clampScale(s: number) {
  const minS = getMinScale()
  return Math.min(4, Math.max(minS, s))
}

function onPointerDown(e: PointerEvent) {
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  dragging = true
  dragStartX = e.clientX; dragStartY = e.clientY
  lastX = e.clientX; lastY = e.clientY
  dragMoved = false
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) dragMoved = true
  view.offsetX += e.clientX - lastX
  view.offsetY += e.clientY - lastY
  lastX = e.clientX; lastY = e.clientY
  scheduleDraw()
}
function onPointerUp(e: PointerEvent) {
  dragging = false
  try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* */ }
  if (!dragMoved) {
    const canvas = canvasRef.value
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const worldX = (cx - view.offsetX) / view.scale
    const worldY = (cy - view.offsetY) / view.scale
    const hit = pixelToHex(worldX, worldY)
    if (hit) emit('tile-click', hit.col, hit.row)
  }
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  const factor = e.deltaY < 0 ? 1.15 : 0.87
  const next = clampScale(view.scale * factor)
  if (next === view.scale) return // 到极限就不再动

  const ratio = next / view.scale
  view.offsetX = mx - (mx - view.offsetX) * ratio
  view.offsetY = my - (my - view.offsetY) * ratio
  view.scale = next
  draw()
}
function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    dragging = false
    const [a, b] = [e.touches[0], e.touches[1]]
    pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)

    // 记录捏合中心的屏幕坐标（相对 canvas）
    const canvas = canvasRef.value
    if (canvas) {
      const rect = canvas.getBoundingClientRect()
      pinchCenterX = (a.clientX + b.clientX) / 2 - rect.left
      pinchCenterY = (a.clientY + b.clientY) / 2 - rect.top
    }
  }
}
function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2 && pinchDist > 0) {
    e.preventDefault()
    const [a, b] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    const factor = dist / pinchDist
    const next = clampScale(view.scale * factor)
    if (next === view.scale) {
      pinchDist = dist
      return
    }
    const ratio = next / view.scale
    view.offsetX = pinchCenterX - (pinchCenterX - view.offsetX) * ratio
    view.offsetY = pinchCenterY - (pinchCenterY - view.offsetY) * ratio
    view.scale = next
    pinchDist = dist
    scheduleDraw()
  }
}
function onTouchEnd() { pinchDist = 0 }
function onDoubleClick() {
  fitToView()
  draw()
}

let resizeObserver: ResizeObserver | null = null

// 只重绘，不动视图
watch(
  () => [
    props.mode, props.selected, props.changeVersion, props.selectedCells, props.jurisdictionCenters,
    props.terrainMode, props.clipStart, props.clipEnd,
    editorConfig.value.displayMode,
    editorConfig.value.display.buildingAlpha,
    editorConfig.value.display.hexLineAlpha,
    editorConfig.value.display.riverWidth,
    editorConfig.value.display.terrainMode,
    editorConfig.value.display.terrainAlpha,
    JSON.stringify(editorConfig.value.cityNames),
  ],
  () => { draw() }
)

// 切换地图时，重新适应屏幕一次
watch(
  () => [props.project, props.terrain],
  () => { resize(); fitToView(); draw() }
)

// 显示范围变化时（截取完成 / 切换地形模式 / 进入截取模式），重新适应屏幕
watch(
  () => viewRange.value,
  () => { fitToView(); draw() },
  { deep: false }
)

// 进入/退出截取模式时，重新适应屏幕
watch(
  () => props.clipActive,
  () => { fitToView(); draw() }
)

watch(
  [hasStrongPoints, () => editorConfig.value.display.breathSpeed, () => props.terrainMode],
  ([has, speed, terrainOnly]) => {
    if (has && speed > 0 && !terrainOnly) startAnim()
    else { stopAnim(); draw() }
  }
)

onMounted(() => {
  setAtlasLoadCallback(() => { draw() })
    setTilesLoadCallback(() => { draw() })
  resize()
  // 只重绘，不再 fitToView()，避免键盘弹出/屏幕旋转时地图被重置
  resizeObserver = new ResizeObserver(() => { resize() })
  if (wrapRef.value) resizeObserver.observe(wrapRef.value)
  window.addEventListener('resize', resize)
  if (hasStrongPoints.value && editorConfig.value.display.breathSpeed > 0 && !props.terrainMode) {
    startAnim()
  }
})
onBeforeUnmount(() => {
  stopAnim()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <div ref="wrapRef" class="map-wrap">
    <canvas
      ref="canvasRef"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel="onWheel"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    ></canvas>
  </div>
</template>

<style scoped>
.map-wrap { position: relative; width: 100%; height: 100%; overflow: hidden; background: #0b1220; }
canvas { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
