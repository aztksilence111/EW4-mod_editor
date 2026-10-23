export const BUILDING_DEFAULTS: string[] = [
  '城市', '工厂', '马厩', '军港', '农场',
  '市场', '商店', '酒馆',
  '战壕', '栅栏', '掩体',
  '关键', '特殊',
  '事件',
  '桥梁',
]

export const BUILDING_SYMBOLS: string[] = [
  '城', '工', '马', '港', '农',
  '市', '商', '酒',
  '壕', '栏', '掩',
  '★', '▲',
  '○',
  '桥',
]

export function getBuildingDefaultName(id: number): string {
  return BUILDING_DEFAULTS[id] ?? `建筑${id}`
}

export function getBuildingSymbol(id: number): string {
  return BUILDING_SYMBOLS[id] ?? '?'
}

/**
 * 据点高亮色。
 * 由 build.strongPoint 字段控制，不是 constructionType。
 * strongPoint: 1=关键(红)，2=特殊(黄)，其它=无
 */
export function getStrongPointHighlight(
  strongPoint: number
): 'red' | 'yellow' | null {
  if (strongPoint === 1) return 'red'
  if (strongPoint === 2) return 'yellow'
  return null
}

/** 工事图标映射（installationType → defense 目录下的图标） */
export const DEFENSE_ICONS: Record<number, string> = {
  2: 'defense_bunker.png', // 掩体
  1: 'defense_fences.png', // 栅栏
  3: 'defense_moat.png',   // 战壕
}

/** 按 installationType 取图标文件名，取不到返回 null */
export function getDefenseIcon(installationType: number): string | null {
  return DEFENSE_ICONS[installationType] ?? null
}

export function isDefenseType(installationType: number): boolean {
  return installationType >= 1 && installationType <= 3
}
/**
 * 首都奇观贴图，按图片文件名字母顺序排序：
 * au, ca, common, eg, es, fr, gb, it, pu, ru, tk, us
 * capitalStyle 0~11 依次对应
 */
export const CAPITAL_SPRITES: string[] = [
  'capital_au.png',      // 0  奥地利（美泉宫）
  'capital_ca.png',      // 1  加拿大
  'capital_common.png',  // 2  通用
  'capital_eg.png',      // 3  埃及
  'capital_es.png',      // 4  西班牙
  'capital_fr.png',      // 5  法国
  'capital_gb.png',      // 6  英国
  'capital_it.png',      // 7  意大利
  'capital_pu.png',      // 8  普鲁士
  'capital_ru.png',      // 9  俄罗斯（克里姆林宫）
  'capital_tk.png',      // 10 土耳其
  'capital_us.png',      // 11 美国
]

export function getCapitalSprite(capitalStyle: number): string | null {
  if (capitalStyle < 0 || capitalStyle >= CAPITAL_SPRITES.length) return null
  return CAPITAL_SPRITES[capitalStyle]
}