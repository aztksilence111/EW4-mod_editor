export const commanderFieldLabels = {
  rank: '军衔', nobilityrank: '爵位', star: '星级', infantry: '步兵', cavalry: '骑兵',
  artillery: '炮兵', warship: '海军', fort: '要塞', business: '经济', movement: '移动',
  training: '训练', skill1: '技能槽 1', skill2: '技能槽 2', skill3: '技能槽 3', skill4: '技能槽 4',
  item1: '装备槽 1', item2: '装备槽 2',
} as const

export type CommanderField = keyof typeof commanderFieldLabels
export const commanderFields = Object.keys(commanderFieldLabels) as CommanderField[]
export interface CommanderRule {
  field: CommanderField
  operation: 'set' | 'add' | 'multiply'
  value: number
  rounding: 'round' | 'floor' | 'ceil'
  ids: number[]
}

export function computeCommanderValue(before: number, rule: CommanderRule): number {
  if (!commanderFields.includes(rule.field)) throw new Error('不支持的原版将领字段')
  if (!['set', 'add', 'multiply'].includes(rule.operation) || !['round', 'floor', 'ceil'].includes(rule.rounding))
    throw new Error('无效批处理运算')
  if (!Number.isFinite(rule.value)) throw new Error('数值必须为有限数字')
  const value = rule.operation === 'set' ? rule.value : rule.operation === 'add' ? before + rule.value : before * rule.value
  // Match the author's server rounding, including negative half values.
  const after = rule.rounding === 'round' ? Math.sign(value) * Math.floor(Math.abs(value) + 0.5) : Math[rule.rounding](value)
  if (!Number.isSafeInteger(after)) throw new Error('计算结果超出整数范围')
  return after
}
