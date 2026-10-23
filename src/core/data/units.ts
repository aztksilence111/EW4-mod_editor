export interface UnitDef {
  id: number
  name: string
  abbr: string
  english: string
  icon: string
  /** 允许的最大编队编号：0=一编，1=二编，2=三编 */
  maxGrade: number
}

export const UNITS: UnitDef[] = [
  { id: 0, name: '民兵', abbr: '民', english: 'Militia', icon: 'button_upgrade_militia.png', maxGrade: 2 },
  { id: 1, name: '线列步兵', abbr: '线', english: 'Line Infantry', icon: 'button_upgrade_line.png', maxGrade: 2 },
  { id: 2, name: '轻步兵', abbr: '步', english: 'Light Infantry', icon: 'button_upgrade_light.png', maxGrade: 2 },
  { id: 3, name: '掷弹兵', abbr: '掷', english: 'Grenadier', icon: 'button_upgrade_grenadier.png', maxGrade: 2 },
  { id: 4, name: '近卫军', abbr: '卫', english: 'Guards', icon: 'button_upgrade_guard.png', maxGrade: 2 },
  { id: 5, name: '机枪', abbr: '枪', english: 'Machine Gun', icon: 'button_upgrade_machinegun.png', maxGrade: 1 },
  { id: 6, name: '轻骑兵', abbr: '骑', english: 'Light Cavalry', icon: 'button_upgrade_lightcavalry.png', maxGrade: 1 },
  { id: 7, name: '重骑兵', abbr: '重', english: 'Heavy Cavalry', icon: 'button_upgrade_heavycavalry.png', maxGrade: 1 },
  { id: 8, name: '近卫骑兵', abbr: '近', english: 'Guards Cavalry', icon: 'button_upgrade_lancer.png', maxGrade: 1 },
  { id: 9, name: '装甲车', abbr: '装', english: 'Armored Car', icon: 'button_upgrade_armored.png', maxGrade: 1 },
  { id: 10, name: '轻炮', abbr: '轻', english: 'Light Artillery', icon: 'button_upgrade_lightartillery.png', maxGrade: 1 },
  { id: 11, name: '重炮', abbr: '炮', english: 'Heavy Artillery', icon: 'button_upgrade_heavyartillery.png', maxGrade: 1 },
  { id: 12, name: '围城炮', abbr: '围', english: 'Siege Artillery', icon: 'button_upgrade_fortressartillery.png', maxGrade: 1 },
  { id: 13, name: '火箭车', abbr: '火', english: 'Rocket', icon: 'button_upgrade_rocket.png', maxGrade: 1 },
  { id: 14, name: '私掠船', abbr: '私', english: 'Privateer', icon: 'button_upgrade_ship1.png', maxGrade: 0 },
  { id: 15, name: '护卫舰', abbr: '护', english: 'Frigate', icon: 'button_upgrade_ship2.png', maxGrade: 0 },
  { id: 16, name: '战舰', abbr: '战', english: 'Battleship', icon: 'button_upgrade_ship3.png', maxGrade: 0 },
  { id: 17, name: '铁甲舰', abbr: '铁', english: 'Ironclad', icon: 'button_upgrade_ship4.png', maxGrade: 0 },
  { id: 18, name: '小型要塞', abbr: '小', english: 'Small Fortress', icon: 'button_upgrade_fortress1.png', maxGrade: 0 },
  { id: 19, name: '要塞', abbr: '塞', english: 'Fortress', icon: 'button_upgrade_fortress2.png', maxGrade: 0 },
  { id: 20, name: '大型要塞', abbr: '大', english: 'Large Fortress', icon: 'button_upgrade_fortress3.png', maxGrade: 0 },
  { id: 21, name: '海岸炮', abbr: '岸', english: 'Coastal Fort', icon: 'button_upgrade_coastalartillery.png', maxGrade: 0 },
]

export function getUnitById(id: number): UnitDef | undefined {
  return UNITS.find((u) => u.id === id)
}

export function getUnitMaxGrade(armyType: number): number {
  const u = getUnitById(armyType)
  return u?.maxGrade ?? 0
}

export function unitBadgeText(
  armyType: number,
  armyGrade: number,
  customAbbr?: string
): string {
  const u = getUnitById(armyType)
  const abbr = customAbbr && customAbbr.trim() ? customAbbr : u?.abbr ?? '?'
  if (armyGrade >= 0 && armyGrade < 100) return abbr + (armyGrade + 1)
  return abbr
}

export function campColor(camp: number): string {
  switch (camp) {
    case 1: return '#2563eb'
    case 2: return '#dc2626'
    case 3: return '#16a34a'
    case 4: return '#0b1220'
    default: return '#6b7280'
  }
}