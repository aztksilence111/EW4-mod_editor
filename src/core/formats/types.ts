export interface BtlInfo {
  version: number
  mapId: number
  mapX: number
  mapY: number
  mapW: number
  mapH: number
  legionCount: number
  buildCount: number
  armyCount: number
  eventCount: number
  shopCount: number
  victoryType: number
  victoryRound: number
  greatVictoryRound: number
  barCount: number
  commander: number
  fireCount: number
  unknown17: number
}

export interface BtlLegionV2 {
  price: number
  industry: number
  food: number
  isNPC: number
  camp: number
  defeat: number
  legion: Uint8Array
  country: Uint8Array
  taxRate: number
  strength: number
  color: number
  technologies: number[]
  commanderCount: number
  unknown13: number
}

export interface BtlTileV2 {
  legion: number
}

export interface BtlBuildV2 {
  index: number
  areaName: number
  constructionType: number
  constructionLevel: number
  constructionShop: number
  constructionStyle: number
  capitalStyle: number
  installationType: number
  strongPoint: number
  event: number
  bridges: number[]
  fireType: number
}

export interface BtlArmyV2 {
  index: number
  armyType: number
  armyGrade: number
  strengthNow: number
  strengthMax: number
  damageCount: number
  training: number
  movement: number
  morale: number
  unknown09: number
  commander: number
  moved: number
  strongPoint: number
  unknown13: number
  dir: number
  hasTroopship: number
  attacked: number
  unknown17: number
  unknown18: number
  event: number
  buildRound: number
  unknown21: number
  unknown22: number
  fireType: number
}

export interface BtlFireV2 {
  index: number
  fireType: number
}

export interface BtlShopItemV2 {
  itemID: number
  number: number
}

export interface BtlShopV2 {
  items: BtlShopItemV2[]
  index: number
}

export interface BtlBarCommanderV2 {
  commanderID: number
  price: number
  industry: number
  medal: number
  round: number
}

export interface BtlBarV2 {
  commanders: BtlBarCommanderV2[]
  slot: number
  index: number
}

export interface BtlEventV2 {
  eventID: number
  trigger: number
  status: number
  round: number
  dialogue: number
  index: number
  legion: Uint8Array
}

export interface BtlProject {
  originalBytes?: number[]
  originalBodyLength?: number
  info: BtlInfo
  legions: BtlLegionV2[]
  tiles: BtlTileV2[]
  builds: BtlBuildV2[]
  armies: BtlArmyV2[]
  fires: BtlFireV2[]
  shops: BtlShopV2[]
  bars: BtlBarV2[]
  events: BtlEventV2[]
}


export interface BinInfo {
  bom: Uint8Array
  version: number
  mapW: number
  mapH: number
}

export interface BinTile {
  backTile: number
  backIdx: number
  backRefX: number
  backRefY: number
  foreTile: number
  foreIdx: number
  foreRefX: number
  foreRefY: number
  waterPass: number
  landPass: number
  unknown10: number
  unknown11: number
}

export interface BinProject {
  info: BinInfo
  tiles: BinTile[]
}
