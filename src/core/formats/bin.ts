import type { BinProject, BinInfo, BinTile } from './types'

export function parseBin(buffer: ArrayBuffer): BinProject {
  if (buffer.byteLength < 16) {
    throw new Error('文件太小，不是有效的 .bin 文件')
  }

  const view = new DataView(buffer)
  let offset = 0

  const bom = new Uint8Array(buffer, 0, 4).slice()
  offset = 4
  const version = view.getInt32(offset, true); offset += 4
  const mapW = view.getInt32(offset, true); offset += 4
  const mapH = view.getInt32(offset, true); offset += 4
  if (String.fromCharCode(...bom) !== 'YSAE' || version !== 1) throw new Error('不支持的 BIN 文件头或版本')

  if (mapW <= 0 || mapH <= 0 || mapW > 1000 || mapH > 1000) {
    throw new Error(
      `地图尺寸异常（${mapW}×${mapH}），可能不是 .bin 地形文件`
    )
  }

  const expected = 16 + mapW * mapH * 12
  if (buffer.byteLength !== expected) {
    throw new Error(
      `文件大小不足：需要至少 ${expected} 字节，实际 ${buffer.byteLength} 字节`
    )
  }

  const count = mapW * mapH
  const tiles: BinTile[] = new Array(count)
  for (let i = 0; i < count; i++) {
    tiles[i] = {
      backTile: view.getUint8(offset++),
      backIdx: view.getUint8(offset++),
      backRefX: view.getUint8(offset++),
      backRefY: view.getUint8(offset++),
      foreTile: view.getUint8(offset++),
      foreIdx: view.getUint8(offset++),
      foreRefX: view.getUint8(offset++),
      foreRefY: view.getUint8(offset++),
      waterPass: view.getUint8(offset++),
      landPass: view.getUint8(offset++),
      unknown10: view.getUint8(offset++),
      unknown11: view.getUint8(offset++),
    }
  }

  const info: BinInfo = { bom, version, mapW, mapH }
  return { info, tiles }
}

export function serializeBin(project: BinProject): ArrayBuffer {
  const { info, tiles } = project
  if (String.fromCharCode(...info.bom) !== 'YSAE' || info.version !== 1 || !Number.isInteger(info.mapW) || !Number.isInteger(info.mapH)
      || info.mapW < 1 || info.mapH < 1 || info.mapW > 1000 || info.mapH > 1000 || tiles.length !== info.mapW * info.mapH)
    throw new Error('BIN 文件头、尺寸或格数无效')
  const bytes = new Uint8Array(16 + tiles.length * 12)
  bytes.set(info.bom)
  const view = new DataView(bytes.buffer)
  view.setInt32(4, info.version, true); view.setInt32(8, info.mapW, true); view.setInt32(12, info.mapH, true)
  const fields: (keyof BinTile)[] = ['backTile','backIdx','backRefX','backRefY','foreTile','foreIdx','foreRefX','foreRefY','waterPass','landPass','unknown10','unknown11']
  let offset = 16
  for (const tile of tiles) for (const field of fields) {
    const value = tile[field]
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`BIN ${field} 字节数值越界`)
    bytes[offset++] = value
  }
  return bytes.buffer
}

/**
 * 根据地形数据返回颜色。
 * - 底层：backTile=0 陆地（浅绿），backTile=1 海洋（蓝）
 * - 面层：2~6 森林（深绿），7 沙漠（沙黄），8 山岗（土黄），9 山脉（褐）
 */
export function terrainColor(backTile: number, foreTile: number): string {
  // 森林
  if (foreTile >= 2 && foreTile <= 6) return '#2d6a4f'
  // 沙漠
  if (foreTile === 7) return '#e6c67a'
  // 山岗
  if (foreTile === 8) return '#c9a66b'
  // 山脉
  if (foreTile === 9) return '#8b6f47'
  // 海洋
  if (backTile === 1) return '#4a90d9'
  // 陆地（默认）
  return '#a8d5a2'
}
