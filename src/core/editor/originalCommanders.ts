import builtinXml from '../data/def_commanders.xml?raw'
import itemsXml from '../data/def_item.xml?raw'
import { commanderFields, computeCommanderValue, type CommanderField, type CommanderRule } from './commanderFields'

export { builtinXml as originalCommanderXml }
export interface OriginalCommander {
  id: number
  name: string
  country: string
  values: Record<CommanderField, number>
}
export interface CommanderDiff { id: number; field: string; before: number | string; after: number | string }
const baseAttributes = new Set(['id', 'name', 'country', 'drawlots', 'image', 'price', ...commanderFields])

function documentXml(xml: string): XMLDocument {
  if (xml.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('将领 XML 过大或含外部声明')
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'commanders' || doc.documentElement.attributes.length) throw new Error('需要原版 commanders XML')
  return doc
}
const builtinRows = [...documentXml(builtinXml).documentElement.children]
const nativeIds = new Set(builtinRows.map(row => Number(row.getAttribute('id'))))
const nativeCountries = new Set(builtinRows.map(row => row.getAttribute('country')))
const nativeItems = new Set([...new DOMParser().parseFromString(itemsXml, 'text/xml').querySelectorAll('item')].map(row => Number(row.getAttribute('id'))))

export function assertCommanderValue(field: CommanderField, value: number): void {
  const min = field.startsWith('skill') || field.startsWith('item') ? -1 : 0
  const max = field === 'rank' ? 14 : field === 'nobilityrank' ? 9 : field.startsWith('skill') ? 39 : 32767
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${field} 超出原版范围 ${min}..${max}`)
  if (field.startsWith('item') && value !== -1 && !nativeItems.has(value)) throw new Error('原版不存在装备 ID ' + value)
}

export function readOriginalCommanders(xml: string): OriginalCommander[] {
  const doc = documentXml(xml), ids = new Set<number>(), allowedIds = nativeIds
  const rows = [...doc.documentElement.children].map(row => {
    if (row.tagName !== 'commander' || row.children.length || row.textContent?.trim() || [...row.attributes].some(a => !baseAttributes.has(a.name)))
      throw new Error('原版将领 XML 不接受扩展字段或扩展节点')
    const id = Number(row.getAttribute('id'))
    if (!allowedIds.has(id) || ids.has(id)) throw new Error('将领 ID 不属于原版或重复: ' + id)
    ids.add(id)
    const name = row.getAttribute('name'), country = row.getAttribute('country')
    if (!name || !country) throw new Error('将领缺少名称或国家')
    if (!nativeCountries.has(country)) throw new Error('原版不存在国家 ' + country)
    const image = row.getAttribute('image')
    if (image !== null && (!/^[\w '.-]+\.png$/i.test(image) || image.includes('..'))) throw new Error('需要原版 PNG 头像文件名')
    for (const key of ['price', 'drawlots']) {
      const raw = row.getAttribute(key)
      if (raw !== null && (!/^\d+$/.test(raw) || Number(raw) > 2147483647)) throw new Error('原版字段无效: ' + key)
    }
    const values = {} as Record<CommanderField, number>
    for (const field of commanderFields) {
      const raw = row.getAttribute(field)
      if (raw === null || !/^-?\d+$/.test(raw)) throw new Error('将领缺少整数字段 ' + field)
      values[field] = Number(raw); assertCommanderValue(field, values[field])
    }
    return { id, name, country, values }
  })
  if (rows.length !== allowedIds.size) throw new Error('需要完整原版将领表；局部批改请导入 CSV')
  return rows
}

export function compareOriginalCommanderXml(before: string, after: string): CommanderDiff[] {
  readOriginalCommanders(before); readOriginalCommanders(after)
  const original = new Map([...documentXml(before).documentElement.children].map(row => [Number(row.getAttribute('id')), row]))
  return [...documentXml(after).documentElement.children].flatMap(row => [...baseAttributes].filter(key => key !== 'id' &&
    row.getAttribute(key) !== original.get(Number(row.getAttribute('id')))!.getAttribute(key)).map(field => ({
      id: Number(row.getAttribute('id')), field, before: original.get(Number(row.getAttribute('id')))!.getAttribute(field) ?? '', after: row.getAttribute(field) ?? '',
    })))
}

export function previewOriginalCommanders(xml: string, rules: CommanderRule[]): { xml: string; changes: CommanderDiff[] } {
  const rows = readOriginalCommanders(xml), byId = new Map(rows.map(row => [row.id, row])), changes: CommanderDiff[] = []
  for (const rule of rules) {
    if (!Array.isArray(rule.ids) || !rule.ids.length) throw new Error('批处理未选择将领')
    for (const id of new Set(rule.ids)) {
      const row = byId.get(id)
      if (!row) throw new Error('原版不存在将领 ' + id)
      const before = row.values[rule.field], after = computeCommanderValue(before, rule)
      assertCommanderValue(rule.field, after)
      if (before !== after) { changes.push({ id, field: rule.field, before, after }); row.values[rule.field] = after }
    }
  }
  const doc = documentXml(xml)
  for (const row of [...doc.documentElement.children]) {
    const result = byId.get(Number(row.getAttribute('id')))!
    for (const field of commanderFields) if (Number(row.getAttribute(field)) !== result.values[field]) row.setAttribute(field, String(result.values[field]))
  }
  return { xml: changes.length ? new XMLSerializer().serializeToString(doc) : xml, changes }
}

export function originalCommanderCsvRules(xml: string, rows: Record<string, string>[]): CommanderRule[] {
  const existing = new Map(readOriginalCommanders(xml).map(row => [row.id, row])), ids = new Set<number>()
  const allowed = new Set(['schema', 'sourceHash', 'target', 'id', 'name', 'country', ...commanderFields])
  return rows.flatMap(row => {
    if (Object.keys(row).some(key => !allowed.has(key)) || row.target && row.target !== 'original') throw new Error('CSV 含原版不支持的扩展字段或目标版本')
    if (row.schema && row.schema !== '1') throw new Error('不支持的 CSV 版本')
    const id = Number(row.id), current = existing.get(id)
    if (!current || ids.has(id)) throw new Error('CSV 将领 ID 不存在或重复: ' + row.id)
    ids.add(id)
    if (row.name && row.name !== current.name || row.country && row.country !== current.country) throw new Error('CSV 将领身份与当前表不一致: ' + id)
    const fields = commanderFields.filter(field => row[field] !== undefined && row[field] !== '')
    if (!fields.length) throw new Error('CSV 缺少可编辑字段')
    return fields.map(field => {
      if (!/^-?\d+$/.test(row[field]!)) throw new Error('CSV 需要整数: ' + field)
      const value = Number(row[field]); assertCommanderValue(field, value)
      return { field, ids: [id], value, operation: 'set' as const, rounding: 'round' as const }
    })
  })
}
