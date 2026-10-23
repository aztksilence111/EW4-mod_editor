export interface TerrainType {
  key: string
  name: string
  symbol: string
  category: 'land' | 'sea' | 'forest' | 'desert' | 'hill' | 'mountain'
  tileNum: number
  images: string[]
}

export const TERRAIN_TYPES: TerrainType[] = [
  { key: 'land', name: '陆地', symbol: '', category: 'land', tileNum: 0, images: [] },
  { key: 'sea', name: '波浪', symbol: '≈', category: 'sea', tileNum: 1, images: [
    'wave_1.png', 'wave_2.png', 'wave_3.png', 'wave_4.png',
    'wave_5.png', 'wave_6.png', 'wave_7.png',
  ]},
  { key: 'cactus', name: '仙人掌', symbol: '♂', category: 'forest', tileNum: 2, images: [
    'cactus_1.png', 'cactus_2.png', 'cactus_3.png',
    'cactus_4.png', 'cactus_5.png', 'cactus_6.png',
  ]},
  { key: 'cedar', name: '雪松', symbol: '♀', category: 'forest', tileNum: 3, images: [
    'cedar_1.png', 'cedar_2.png', 'cedar_3.png',
    'cedar_4.png', 'cedar_5.png', 'cedar_6.png',
  ]},
  { key: 'cypress', name: '柏树', symbol: '♂', category: 'forest', tileNum: 4, images: [
    'cypress_1.png', 'cypress_2.png', 'cypress_3.png',
    'cypress_4.png', 'cypress_5.png', 'cypress_6.png',
  ]},
  { key: 'palm', name: '棕榈', symbol: '♀', category: 'forest', tileNum: 5, images: [
    'palm_1.png', 'palm_2.png', 'palm_3.png',
    'palm_4.png', 'palm_5.png', 'palm_6.png',
  ]},
  { key: 'pine', name: '松树', symbol: '♀', category: 'forest', tileNum: 6, images: [
    'pine_1.png', 'pine_2.png', 'pine_3.png',
    'pine_4.png', 'pine_5.png', 'pine_6.png',
  ]},
  { key: 'desert', name: '沙丘', symbol: '⌒', category: 'desert', tileNum: 7, images: [
    'desert_1.png', 'desert_2.png', 'desert_3.png', 'desert_4.png', 'desert_5.png',
    'desert_6.png', 'desert_7.png', 'desert_8.png', 'desert_9.png',
  ]},
  { key: 'hill', name: '山岗', symbol: '⌒', category: 'hill', tileNum: 8, images: [
    'hill_1.png', 'hill_2.png', 'hill_3.png', 'hill_4.png', 'hill_5.png', 'hill_6.png',
  ]},
  { key: 'mountain', name: '山脉', symbol: '∧', category: 'mountain', tileNum: 9, images: [
    'mountain_1.png', 'mountain_2.png', 'mountain_3.png',
    'mountain_4.png', 'mountain_5.png', 'mountain_6.png',
  ]},
]

export function findTerrainByTileNum(n: number): TerrainType | null {
  if (n < 0) return null
  return TERRAIN_TYPES.find((t) => t.tileNum === n) ?? null
}

export function getTerrainImage(tileNum: number, idx: number): string | null {
  const t = findTerrainByTileNum(tileNum)
  if (!t) return null
  if (idx < 0 || idx >= t.images.length) return null
  return t.images[idx]
}

export function getTerrainName(tileNum: number): string {
  return findTerrainByTileNum(tileNum)?.name ?? ''
}

export function getTerrainSymbol(tileNum: number): string {
  return findTerrainByTileNum(tileNum)?.symbol ?? ''
}