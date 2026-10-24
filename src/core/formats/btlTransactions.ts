import type { BtlArmyV2, BtlBuildV2, BtlProject } from './types'
import { inspectBtlReferences, type BtlMapBounds, type BtlValidationIssue } from './btlValidation'

export interface BtlTransactionResult { project: BtlProject; changes: string[] }
export class BtlTransactionError extends Error {
  constructor(public readonly issues: BtlValidationIssue[]) {
    super(issues[0]?.message ?? 'BTL 事务失败')
    this.name = 'BtlTransactionError'
  }
}

const clone = <T>(value: T): T => structuredClone(value)
const issue = (code: string, path: string, message: string): BtlValidationIssue => ({ code, path, message })
const emptyArmy = (index: number): BtlArmyV2 => ({ index, armyType: 0, armyGrade: 0, strengthNow: 0, strengthMax: 0, damageCount: 0, training: 0, movement: 0, morale: 0, unknown09: 0, commander: -1, moved: 0, strongPoint: 0, unknown13: 0, dir: 0, hasTroopship: 0, attacked: 0, unknown17: 0, unknown18: 0, event: 255, buildRound: 0, unknown21: 0, unknown22: 0, fireType: 0 })
const emptyBuild = (index: number): BtlBuildV2 => ({ index, areaName: -1, constructionType: 255, constructionLevel: 0, constructionShop: 0, constructionStyle: 0, capitalStyle: 0, installationType: 0, strongPoint: 0, event: 255, bridges: [0, 0, 0], fireType: 0 })

function finish(project: BtlProject, bounds?: BtlMapBounds, changes: string[] = []): BtlTransactionResult {
  project.info = { ...project.info, buildCount: project.builds.length, armyCount: project.armies.length, shopCount: project.shops.length, barCount: project.bars.length, fireCount: project.fires.length, eventCount: project.events.length, legionCount: project.legions.length }
  const report = inspectBtlReferences(project, bounds)
  if (!report.valid) throw new BtlTransactionError(report.errors)
  return { project, changes }
}

export function addArmy(project: BtlProject, row: Omit<BtlArmyV2, 'index'> & { index?: number }, bounds?: BtlMapBounds): BtlTransactionResult {
  const next = clone(project); const index = row.index ?? -1
  if (index < 0) throw new BtlTransactionError([issue('cell_negative', 'army.index', '新增部队必须指定有效地图 cell')])
  if (next.armies.some(a => a.index === index)) throw new BtlTransactionError([issue('duplicate_cell', 'armies', `cell ${index} 已有部队` )])
  const slot = next.armies.findIndex(a => a.index < 0)
  const value = { ...row, index } as BtlArmyV2
  if (slot >= 0) next.armies[slot] = value; else next.armies.push(value)
  return finish(next, bounds, [`army:${slot >= 0 ? slot : next.armies.length - 1}@${index}:add`])
}

export function removeArmy(project: BtlProject, cell: number, bounds?: BtlMapBounds): BtlTransactionResult {
  const next = clone(project); const slot = next.armies.findIndex(a => a.index === cell)
  if (slot < 0) throw new BtlTransactionError([issue('missing_army', `armies@${cell}`, `cell ${cell} 没有部队` )])
  next.armies[slot] = emptyArmy(-1)
  return finish(next, bounds, [`army:${slot}@${cell}:remove`])
}

export function addBuild(project: BtlProject, row: Omit<BtlBuildV2, 'index'> & { index?: number }, bounds?: BtlMapBounds): BtlTransactionResult {
  const next = clone(project); const index = row.index ?? -1
  if (index < 0) throw new BtlTransactionError([issue('cell_negative', 'build.index', '新增建筑必须指定有效地图 cell')])
  if (next.builds.some(b => b.index === index)) throw new BtlTransactionError([issue('duplicate_cell', 'builds', `cell ${index} 已有建筑或设施` )])
  // A site without a construction can still contain installations and bridges.
  const slot = next.builds.findIndex(b => b.index < 0)
  const value = { ...row, index, bridges: [...row.bridges] } as BtlBuildV2
  if (slot >= 0) next.builds[slot] = value; else next.builds.push(value)
  return finish(next, bounds, [`build:${slot >= 0 ? slot : next.builds.length - 1}@${index}:add`])
}

export function removeBuild(project: BtlProject, cell: number, bounds?: BtlMapBounds): BtlTransactionResult {
  const next = clone(project); const slot = next.builds.findIndex(b => b.index === cell)
  if (slot < 0) throw new BtlTransactionError([issue('missing_build', `builds@${cell}`, `cell ${cell} 没有建筑` )])
  next.builds[slot] = emptyBuild(-1)
  // Commerce, environment and event effects exist independently of this site.
  return finish(next, bounds, [`build:${slot}@${cell}:remove`])
}
