export interface EventNode { type: string; [key: string]: any }
export interface ScriptEvent { id: string; condition: EventNode; effects: EventNode[]; popup?: { title: string; text: string; image?: string; imageAlt?: string; choices: { id: string; text: string; condition?: EventNode; effects: EventNode[] }[] }; repeat?: { everyRounds: number; startRound: number; endRound?: number; maxOccurrences?: number }; insufficientResourcesEffects?: EventNode[] }
export interface LegacyEventRow { slot: number; id: number; condition: number; effect: number; round: number; dialogue: number; cell: number; country: string; sites: number[]; armies: number[] }
export interface EventLink { id: string; source: string; target: string; kind: 'condition' | 'result'; choice?: string }
export interface EventGraph { links: EventLink[]; positions: Record<string, { x: number; y: number }>; joins: Record<string, 'all' | 'any'> }
export interface EventDocument { revision: number; scenario: string; faction?: number; path: string; events: ScriptEvent[]; graph?: Partial<EventGraph>; legacy: LegacyEventRow[]; factions: { id: string; country: string; name: string }[]; units: { id: string; cell: number }[] }
export const conditionLabels: Record<string, string> = {
  always: '始终满足', all: '全部满足', any: '任一满足', not: '条件取反', round: '回合', money: '金币', industry: '工业', food: '粮食',
  city_count: '城市数量', objective_count: '目标数量', territory_count: '领土数量', unit_count: '部队数量', kill_count: '击杀数量',
  unit_health: '部队兵力', building_level: '建筑等级', state: '剧情变量', cells_owned: '占领指定地块', unit_at: '部队到达',
  unit_alive: '部队存活', unit_destroyed: '部队被消灭', commander_alive: '将领存活', commander_dead: '将领死亡',
  faction_defeated: '势力战败', faction_exists: '势力存在', faction_active: '势力未出局', faction_camp: '势力阵营',
  active_faction: '当前行动势力', player_faction: '玩家控制势力', event_completed: '前置事件完成', event_count: '事件触发次数', relation: '外交关系', script: 'Lua 条件',
}
export const effectLabels: Record<string, string> = {
  money: '增加金币', industry: '增加工业', food: '增加粮食', set_money: '设置金币', set_industry: '设置工业', set_food: '设置粮食',
  camp: '修改阵营', cells_owner: '转移地块', unit_owner: '转移部队', morale: '士气', environment: '环境强度', environment_spread: '环境扩散', heal: '恢复兵力', destroy_unit: '消灭部队',
  state: '设置剧情变量', add_state: '增加剧情变量', victory: '胜利', defeat: '失败', relation: '外交关系', faction_create: '创建势力', faction_revive: '复活势力', faction_identity: '修改国号旗帜颜色',
  player_control: '切换玩家控制', victory_rules: '替换胜负规则', victory_default: '恢复默认胜负', ending: '剧情结局',
}
export const victoryLabels: Record<string, string> = { all: '全部满足', any: '任一满足', enemy_factions_defeated: '敌对势力战败', factions_defeated: '指定势力战败', units_destroyed: '指定部队被消灭', units_lost: '失去指定部队', cells_owned: '占领指定地块', cells_lost: '失去指定地块', enemy_objectives_cleared: '清除敌方目标', round_reached: '到达回合', resources: '资源目标', script: 'Lua 条件' }
export const fieldLabels: Record<string, string> = { faction: '势力', otherFaction: '另一势力', relation: '关系', camp: '阵营', unit: '部队', commander: '将领 ID', cells: '地块', key: '变量 / 事件 ID', profile: '兵种 ID', category: '兵种类别', value: '数值', compare: '比较', script: 'Lua 路径', function: '函数名', name: '国号', templateFaction: '模板势力', country: '国家 ID', unitVariant: '兵种模板', flag: '国旗代码', flagImage: '国旗 PNG 路径', color: '领土颜色', outcome: '结局结果', round: '回合', factions: '势力 ID', units: '部队 ID' }
export function createCondition(type = 'always'): EventNode {
  if (['all', 'any', 'not'].includes(type)) return { type, conditions: [{ type: 'always' }] }
  const node: EventNode = { type }
  if (['round','money','industry','food','city_count','objective_count','territory_count','unit_count','kill_count','unit_health','building_level','state','event_count'].includes(type)) Object.assign(node, { compare: 'ge', value: 1 })
  if (['event_completed', 'event_count'].includes(type)) node.key = ''
  if (type === 'state') node.key = 'scenario/state'
  if (['cells_owned','unit_at','building_level'].includes(type)) node.cells = []
  if (type === 'relation') Object.assign(node, { otherFaction: '@active', relation: 'hostile' })
  return node
}
export function createEffect(type = 'money'): EventNode {
  const node: EventNode = { type, faction: '@player' }
  if (['money','industry','food','set_money','set_industry','set_food','morale','environment','environment_spread','heal','state','add_state'].includes(type)) node.value = 0
  if (['state','add_state'].includes(type)) node.key = 'scenario/state'
  if (['cells_owner','environment','environment_spread'].includes(type)) node.cells = []
  if (type === 'faction_create') Object.assign(node, { faction: 'reinforcement', name: '新势力', camp: 'allied', templateFaction: '@player' })
  if (type === 'faction_identity') node.name = '新国号'
  if (type === 'relation') Object.assign(node, { otherFaction: '@active', relation: 'hostile' })
  if (type === 'ending') Object.assign(node, { key: 'ending_1', outcome: 'victory' })
  if (type === 'victory_rules') node.victoryRules = { win: { type: 'enemy_factions_defeated' } }
  return node
}
export function conditionFields(type: string): string[] {
  if (['always','all','any','not'].includes(type)) return []
  const fields: string[] = []
  if (!['round','state','event_completed','event_count','unit_at','unit_alive','unit_destroyed','unit_health','commander_alive','commander_dead','building_level','script'].includes(type)) fields.push('faction')
  if (['money','industry','food','round','city_count','objective_count','territory_count','unit_count','kill_count','unit_health','building_level','state','event_count'].includes(type)) fields.push('compare','value')
  if (['city_count','objective_count','territory_count','unit_count','cells_owned','faction_camp'].includes(type)) fields.push('camp')
  if (['unit_at','unit_alive','unit_destroyed','unit_health'].includes(type)) fields.push('unit')
  if (['commander_alive','commander_dead'].includes(type)) fields.push('commander')
  if (['cells_owned','unit_at','building_level'].includes(type)) fields.push('cells')
  if (['state','event_completed','event_count','kill_count'].includes(type)) fields.push('key')
  if (type === 'unit_count') fields.push('profile','category')
  if (type === 'relation') fields.push('otherFaction','relation')
  if (type === 'script') fields.push('script','function','value')
  return fields
}
export function effectFields(type: string): string[] {
  const fields: string[] = ['faction']
  if (['money','industry','food','set_money','set_industry','set_food','morale','environment','environment_spread','heal','state','add_state'].includes(type)) fields.push('value')
  if (['camp','faction_create'].includes(type)) fields.push('camp')
  if (['unit_owner','heal','destroy_unit'].includes(type)) fields.push('unit')
  if (['cells_owner','environment','environment_spread'].includes(type)) fields.push('cells')
  if (['state','add_state','ending'].includes(type)) fields.push('key')
  if (type === 'relation') fields.push('otherFaction','relation')
  if (type === 'faction_create') fields.push('country','name','templateFaction','unitVariant','flag','flagImage','color')
  if (type === 'faction_identity') fields.push('name','flag','flagImage','color')
  if (type === 'ending') fields.push('outcome')
  return fields
}
export function dependencies(node: any): string[] {
  if (!node || typeof node !== 'object') return []
  const refs = ['event_completed','event_count'].includes(node.type) && node.key ? [String(node.key)] : []
  return [...new Set([...refs, ...Object.values(node).flatMap(v => typeof v === 'object' ? dependencies(v) : [])])]
}
