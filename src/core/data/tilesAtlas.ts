import tilesXmlRaw from './spriteXml/tiles_hd.xml?raw'

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
  if (document.querySelector('parsererror')) throw new Error('Invalid tile XML')
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

class TilesAtlas {
  img: HTMLImageElement | null = null
  sprites: Record<string, Sprite>
  loaded = false

  constructor(xml: string) {
    this.sprites = parseXml(xml)
    const img = new Image()
    img.onload = () => {
      this.img = img
      this.loaded = true
      if (onLoaded) onLoaded()
    }
    img.onerror = () => console.warn('[tilesAtlas] 加载失败')
    img.src = `${import.meta.env.BASE_URL}assets/tiles_hd.png`
  }

  get(name: string): Sprite | null {
    return this.sprites[name] ?? null
  }
}

let onLoaded: (() => void) | null = null
export function setTilesLoadCallback(cb: () => void) {
  onLoaded = cb
}

export const tilesAtlas = new TilesAtlas(tilesXmlRaw)
