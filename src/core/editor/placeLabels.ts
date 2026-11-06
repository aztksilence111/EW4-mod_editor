export interface PlaceCenter { cell: number; name: string | null; kind: string; country: string | null }
export interface PlaceLabel extends PlaceCenter { label: string; named: boolean; countryName: string }

const kinds: Record<string, string> = { city: '城市', industry: '工厂', stable: '马厩' }
const directions = ['东', '东南', '南', '西南', '西', '西北', '北', '东北']
const point = (cell: number, width: number) => {
  const row = Math.floor(cell / width)
  return { x: cell % width * 32 + (row % 2 ? 16 : 0), y: row * 27 }
}
export function describePlaces(centers: PlaceCenter[], width: number, countries: { id: string; name: string }[]): PlaceLabel[] {
  const named = centers.filter(c => c.name?.trim() && !['城市', '工厂', '马厩'].includes(c.name.trim()))
  const countryNames = new Map(countries.map(c => [c.id, c.name]))
  return centers.map(center => {
    const ownName = named.includes(center)
    let label = ownName ? center.name!.trim() : ''
    if (!label) {
      const p = point(center.cell, width)
      // Same-owner anchors avoid naming a frontier facility after a foreign city.
      const anchors = named.filter(c => c.country === center.country)
      let nearest: PlaceCenter | undefined, distance = Infinity
      for (const anchor of anchors) {
        const q = point(anchor.cell, width), d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
        if (d < distance) { nearest = anchor; distance = d }
      }
      const kind = kinds[center.kind] ?? center.kind
      if (nearest) {
        const q = point(nearest.cell, width)
        const direction = directions[(Math.round(Math.atan2(p.y - q.y, p.x - q.x) / (Math.PI / 4)) + 8) % 8]
        label = `${nearest.name!.trim()}${direction}侧${kind}`
      } else label = `未命名${kind}（${center.cell % width}, ${Math.floor(center.cell / width)}）`
    }
    return { ...center, label, named: ownName, countryName: countryNames.get(center.country ?? '') ?? center.country ?? '无归属' }
  })
}
