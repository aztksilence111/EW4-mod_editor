import cmLdXml from './spriteXml/commandermark.xml?raw'
import cmHdXml from './spriteXml/commandermark_hd.xml?raw'
import bLdXml from './spriteXml/buildings.xml?raw'
import bHdXml from './spriteXml/buildings_hd.xml?raw'

interface Sprite {
  x: number
  y: number
  w: number
  h: number
  refx?: number
  refy?: number
}

function parseXml(xml: string): Record<string, Sprite> {
  const out: Record<string, Sprite> = {}
  const document = new DOMParser().parseFromString(`<Atlas>${xml}</Atlas>`, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error('Invalid sprite XML')
  for (const element of document.querySelectorAll('Image')) {
    out[element.getAttribute('name')!] = {
      x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')),
      w: Number(element.getAttribute('w')), h: Number(element.getAttribute('h')),
      refx: element.hasAttribute('refx') ? Number(element.getAttribute('refx')) : undefined,
      refy: element.hasAttribute('refy') ? Number(element.getAttribute('refy')) : undefined,
    }
  }
  return out
}

export class SpriteAtlas {
  img: HTMLImageElement | null = null
  sprites: Record<string, Sprite> = {}
  loaded = false

  constructor(public src: string, xml: string, base64?: string) {
    this.sprites = parseXml(xml)
    const img = new Image()
    img.onload = () => {
      this.img = img
      this.loaded = true
      if (onAtlasLoaded) onAtlasLoaded()
    }
    img.onerror = () => {
      console.warn('[spriteAtlas] 加载失败：', src)
    }
    img.src = base64 ? `data:image/png;base64,${base64}` : src
  }

  get(name: string): Sprite | null {
    return this.sprites[name] ?? null
  }
}

let onAtlasLoaded: (() => void) | null = null
export function setAtlasLoadCallback(cb: () => void) {
  onAtlasLoaded = cb
}

import { UNITS_B64 } from './imgData/units_b64'

const base = import.meta.env.BASE_URL

// 将领头像：优先用 HD，图缺失时 fallback 到 LD
export const commanderAtlasHd = new SpriteAtlas(
  `${base}assets/commandermark_hd.png`, cmHdXml
)
export const commanderAtlasLd = new SpriteAtlas(
  `${base}assets/commandermark.png`, cmLdXml
)

// 建筑图集
export const buildingAtlasHd = new SpriteAtlas(
  `${base}assets/buildings_hd.png`, bHdXml
)
export const buildingAtlasLd = new SpriteAtlas(
  `${base}assets/buildings.png`, bLdXml
)

/* ===== 兵牌单独加载 ===== */
const unitImageCache: Record<string, HTMLImageElement | null> = {}

export function getUnitImage(iconFile: string): HTMLImageElement | null {
  if (iconFile in unitImageCache) return unitImageCache[iconFile]
  const b64 = UNITS_B64[iconFile]
  if (!b64) {
    unitImageCache[iconFile] = null
    return null
  }
  const img = new Image()
  img.onload = () => { if (onAtlasLoaded) onAtlasLoaded() }
  img.onerror = () => {
    unitImageCache[iconFile] = null
  }
  img.src = `data:image/png;base64,${b64}`
  unitImageCache[iconFile] = img
  return img
}

/* ===== 绘制辅助 ===== */

/** 把 atlas 里某个 sprite 绘制在以 (cx, cy) 为中心、宽为 targetW 的位置 */
export function drawSpriteCentered(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  name: string,
  cx: number,
  cy: number,
  targetW: number,
  targetH?: number
): boolean {
  if (!atlas.loaded || !atlas.img) return false
  const s = atlas.get(name)
  if (!s) return false
  const h = targetH ?? (targetW * s.h / s.w)
  ctx.drawImage(
    atlas.img,
    s.x, s.y, s.w, s.h,
    cx - targetW / 2, cy - h / 2, targetW, h
  )
  return true
}
