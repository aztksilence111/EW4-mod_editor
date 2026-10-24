import type { BtlProject } from './types'

export interface BtlMapBounds {
  width: number
  height: number
}

export interface BtlValidationIssue {
  code: string
  path: string
  message: string
}

export interface BtlReferenceReport {
  valid: boolean
  errors: BtlValidationIssue[]
  warnings: BtlValidationIssue[]
  eventIds: number[]
  buildsByCell: Record<string, number[]>
  armiesByCell: Record<string, number[]>
  shopsByCell: Record<string, number[]>
  barsByCell: Record<string, number[]>
  firesByCell: Record<string, number[]>
}

/**
 * Build the references used by structural edits before a BTL is serialized.
 * `index` is a world-map cell; callers may provide the world dimensions when
 * they have the matching BIN loaded. Draft tombstones remain editable; the
 * serializer separately blocks sections whose tombstones Rewrite rejects.
 */
export function inspectBtlReferences(project: BtlProject, bounds?: BtlMapBounds): BtlReferenceReport {
  const errors: BtlValidationIssue[] = []
  const warnings: BtlValidationIssue[] = []
  const add = (target: BtlValidationIssue[], code: string, path: string, message: string) =>
    target.push({ code, path, message })
  const maps = {
    buildsByCell: Object.create(null) as Record<string, number[]>,
    armiesByCell: Object.create(null) as Record<string, number[]>,
    shopsByCell: Object.create(null) as Record<string, number[]>,
    barsByCell: Object.create(null) as Record<string, number[]>,
    firesByCell: Object.create(null) as Record<string, number[]>,
  }
  const area = project.info.mapW * project.info.mapH
  if (!Number.isInteger(area) || area <= 0 || project.tiles.length !== area) {
    add(errors, 'tile_count', 'tiles', `归属格数 ${project.tiles.length} 与剧本尺寸 ${project.info.mapW}×${project.info.mapH} 不符`)
  }
  if (project.info.legionCount !== project.legions.length || project.info.buildCount !== project.builds.length
    || project.info.armyCount !== project.armies.length || project.info.eventCount !== project.events.length
    || project.info.shopCount !== project.shops.length || project.info.barCount !== project.bars.length
    || project.info.fireCount !== project.fires.length) {
    add(errors, 'header_count', 'info', 'BTL 头部记录数量与当前数组长度不一致')
  }
  project.tiles.forEach((tile, i) => {
    if (tile.legion !== 255 && (tile.legion < 0 || tile.legion >= project.legions.length)) {
      add(errors, 'tile_legion', `tiles[${i}].legion`, `归属军团 ${tile.legion} 不存在`)
    }
  })

  function checkCell(kind: keyof typeof maps, cell: number, index: number, requireScenario = true) {
    const path = `${kind}[${index}].index`
    if (!Number.isInteger(cell) || cell < 0) {
      add(errors, 'cell_negative', path, `地图 cell ${cell} 无效`)
    } else if (bounds && (cell >= bounds.width * bounds.height
      || requireScenario && (cell % bounds.width < project.info.mapX
      || cell % bounds.width >= project.info.mapX + project.info.mapW
      || Math.floor(cell / bounds.width) < project.info.mapY
      || Math.floor(cell / bounds.width) >= project.info.mapY + project.info.mapH))) {
      add(errors, 'cell_outside_scenario', path, `地图 cell ${cell} 不在剧本矩形内`)
    }
    const key = String(cell)
    ;(maps[kind][key] ??= []).push(index)
  }

  project.builds.forEach((row, i) => { if (row.index >= 0) checkCell('buildsByCell', row.index, i) })
  project.armies.forEach((row, i) => { if (row.index >= 0) checkCell('armiesByCell', row.index, i) })
  project.shops.forEach((row, i) => { if (row.index >= 0) checkCell('shopsByCell', row.index, i, false) })
  project.bars.forEach((row, i) => { if (row.index >= 0) checkCell('barsByCell', row.index, i, false) })
  project.fires.forEach((row, i) => { if (row.index >= 0) checkCell('firesByCell', row.index, i) })

  const uniqueCells = (kind: keyof typeof maps) => {
    for (const [cell, indexes] of Object.entries(maps[kind])) {
      if (indexes.length > 1) add(errors, 'duplicate_cell', kind, `cell ${cell} 有重复的 ${kind} 记录: ${indexes.join(', ')}`)
    }
  }
  for (const kind of Object.keys(maps) as (keyof typeof maps)[]) uniqueCells(kind)

  const eventIds = project.events.map((event) => event.eventID)
  const eventSet = new Set<number>()
  project.events.forEach((event, i) => {
    if (!Number.isInteger(event.eventID) || event.eventID < 0) add(errors, 'event_id', `events[${i}].eventID`, '事件 ID 必须是非负整数')
    if (eventSet.has(event.eventID)) add(errors, 'duplicate_event_id', `events[${i}].eventID`, `事件 ID ${event.eventID} 重复`)
    eventSet.add(event.eventID)
    // Only effect 5 dereferences a terrain cell in Rewrite.
    if (bounds && event.status === 5 && (event.index < 0 || event.index >= bounds.width * bounds.height
      || event.index % bounds.width < project.info.mapX || event.index % bounds.width >= project.info.mapX + project.info.mapW
      || Math.floor(event.index / bounds.width) < project.info.mapY || Math.floor(event.index / bounds.width) >= project.info.mapY + project.info.mapH)) {
      add(errors, 'event_cell', `events[${i}].index`, `事件效果 cell ${event.index} 不在剧本矩形内`)
    }
  })
  const checkEventRef = (value: number, path: string) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) add(errors, 'event_reference_byte', path, '事件引用必须是 0..255 字节')
    else if (value < 128 && !eventSet.has(value)) add(warnings, 'dangling_event', path, `引用了不存在的事件 ID ${value}，Rewrite 会报告未解析绑定`)
  }
  project.builds.forEach((row, i) => { if (row.index >= 0) checkEventRef(row.event, `builds[${i}].event`) })
  project.armies.forEach((row, i) => { if (row.index >= 0) checkEventRef(row.event, `armies[${i}].event`) })

  // An absent world BIN means the rectangle check is necessarily deferred.
  if (!bounds) add(warnings, 'map_bounds_deferred', 'info', '未提供世界地图尺寸，绝对 cell 的上界检查已延后')
  return { valid: errors.length === 0, errors, warnings, eventIds, ...maps }
}

export function assertValidBtlReferences(project: BtlProject, bounds?: BtlMapBounds): BtlReferenceReport {
  const report = inspectBtlReferences(project, bounds)
  if (!report.valid) throw new Error(`BTL 引用校验失败：${report.errors[0].message}`)
  return report
}
