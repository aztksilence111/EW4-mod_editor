import type { BtlProject, BinProject } from '../formats/types'

export interface ProjectPack {
  version: 1
  savedAt: number
  sourceName: string
  project: any | null
  terrain: any | null
  config: any | null
}

export function serializeProject(p: BtlProject): any {
  return {
    originalBytes: p.originalBytes,
    originalBodyLength: p.originalBodyLength,
    info: { ...p.info },
    legions: p.legions.map((l) => ({
      price: l.price, industry: l.industry, food: l.food,
      isNPC: l.isNPC, camp: l.camp, defeat: l.defeat,
      legion: Array.from(l.legion), country: Array.from(l.country),
      taxRate: l.taxRate, strength: l.strength, color: l.color,
      technologies: [...l.technologies],
      commanderCount: l.commanderCount, unknown13: l.unknown13,
    })),
    tiles: p.tiles.map((t) => ({ legion: t.legion })),
    builds: p.builds.map((b) => ({ ...b, bridges: [...b.bridges] })),
    armies: p.armies.map((a) => ({ ...a })),
    fires: p.fires.map((f) => ({ ...f })),
    shops: p.shops.map((s) => ({
      items: s.items.map((it) => ({ ...it })),
      index: s.index,
    })),
    bars: p.bars.map((b) => ({
      commanders: b.commanders.map((c) => ({ ...c })),
      slot: b.slot, index: b.index,
    })),
    events: p.events.map((e) => ({
      ...e, legion: Array.from(e.legion),
    })),
  }
}

export function reviveProject(obj: any): BtlProject {
  return {
    originalBytes: obj.originalBytes,
    originalBodyLength: obj.originalBodyLength,
    info: obj.info,
    legions: obj.legions.map((l: any) => ({
      ...l,
      legion: new Uint8Array(l.legion),
      country: new Uint8Array(l.country),
    })),
    tiles: obj.tiles.map((t: any) => ({ legion: t.legion })),
    builds: obj.builds.map((b: any) => ({ ...b })),
    armies: obj.armies.map((a: any) => ({ ...a })),
    fires: obj.fires.map((f: any) => ({ ...f })),
    shops: obj.shops.map((s: any) => ({
      items: s.items.map((it: any) => ({ ...it })),
      index: s.index,
    })),
    bars: obj.bars.map((b: any) => ({
      commanders: b.commanders.map((c: any) => ({ ...c })),
      slot: b.slot, index: b.index,
    })),
    events: obj.events.map((e: any) => ({
      ...e, legion: new Uint8Array(e.legion),
    })),
  }
}

export function serializeTerrain(t: BinProject): any {
  return {
    info: { ...t.info, bom: Array.from(t.info.bom) },
    tiles: t.tiles.map((tile) => ({ ...tile })),
  }
}

export function reviveTerrain(obj: any): BinProject {
  return {
    info: { ...obj.info, bom: new Uint8Array(obj.info.bom) },
    tiles: obj.tiles.map((t: any) => ({ ...t })),
  }
}
