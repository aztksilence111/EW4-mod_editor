import europeB64 from './maps/europe_b64'
import americaB64 from './maps/america_b64'

export interface BuiltinMap {
  id: number
  name: string
  file: string
  mapId: number
}

export const BUILTIN_MAPS: BuiltinMap[] = [
  { id: 1, name: '欧洲地图 (europe.bin)', file: 'europe.bin', mapId: 1 },
  { id: 2, name: '美洲地图 (america.bin)', file: 'america.bin', mapId: 2 },
]

const B64_MAP: Record<string, string> = {
  'europe.bin': europeB64,
  'america.bin': americaB64,
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const len = bin.length
  const buf = new ArrayBuffer(len)
  const view = new Uint8Array(buf)
  for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i)
  return buf
}

export async function loadBuiltinMap(file: string): Promise<ArrayBuffer> {
  const b64 = B64_MAP[file]
  if (!b64) throw new Error(`未知的内置地图：${file}`)
  return b64ToArrayBuffer(b64)
}