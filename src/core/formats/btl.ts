import type {
  BtlProject,
  BtlInfo,
  BtlLegionV2,
  BtlTileV2,
  BtlBuildV2,
  BtlArmyV2,
  BtlFireV2,
  BtlShopV2,
  BtlBarV2,
  BtlEventV2,
} from './types'

class Reader {
  private view: DataView
  private offset = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
  }

  get pos() {
    return this.offset
  }

  u8(): number {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, true)
    this.offset += 2
    return v
  }

  i32(): number {
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  bytes(n: number): Uint8Array {
    const arr = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n)
    this.offset += n
    return arr.slice()
  }
}

export function parseBtl(buffer: ArrayBuffer): BtlProject {
  if (buffer.byteLength < 72) throw new Error('BTL 文件头被截断')
  const r = new Reader(buffer)

  const info: BtlInfo = {
    version: r.i32(),
    mapId: r.i32(),
    mapX: r.i32(),
    mapY: r.i32(),
    mapW: r.i32(),
    mapH: r.i32(),
    legionCount: r.i32(),
    buildCount: r.i32(),
    armyCount: r.i32(),
    eventCount: r.i32(),
    shopCount: r.i32(),
    victoryType: r.i32(),
    victoryRound: r.i32(),
    greatVictoryRound: r.i32(),
    barCount: r.i32(),
    commander: r.i32(),
    fireCount: r.i32(),
    unknown17: r.i32(),
  }

  if (info.version !== 2) throw new Error('仅支持已验证的 BTL v2')
  const counts = [info.legionCount, info.buildCount, info.armyCount, info.eventCount, info.shopCount, info.barCount, info.fireCount]
  if (counts.some(n => n < 0 || n > 1000000)) throw new Error('BTL 记录数量无效')
  const bodySize = 72 + info.legionCount * 180 + info.mapW * info.mapH + info.buildCount * 16 + info.armyCount * 32 + info.fireCount * 8 + info.shopCount * 116 + info.barCount * 108 + info.eventCount * 44
  if (!Number.isSafeInteger(bodySize) || bodySize > buffer.byteLength) throw new Error('BTL 主体被截断')
  if (info.mapW <= 0 || info.mapH <= 0 || info.mapW > 1000 || info.mapH > 1000) {
    throw new Error(
      `地图尺寸异常（${info.mapW}×${info.mapH}），可能不是 .btl 文件，或文件已加密`
    )
  }

  const legions: BtlLegionV2[] = []
  for (let i = 0; i < info.legionCount; i++) {
    const legion: BtlLegionV2 = {
      price: r.i32(),
      industry: r.i32(),
      food: r.i32(),
      isNPC: r.i32(),
      camp: r.i32(),
      defeat: r.i32(),
      legion: r.bytes(16),
      country: r.bytes(16),
      taxRate: r.f32(),
      strength: r.f32(),
      color: r.u32(),
      technologies: [],
      commanderCount: 0,
      unknown13: 0,
    }
    for (let k = 0; k < 26; k++) legion.technologies.push(r.i32())
    legion.commanderCount = r.i32()
    legion.unknown13 = r.i32()
    legions.push(legion)
  }

  const tileCount = info.mapW * info.mapH
  const tiles: BtlTileV2[] = []
  for (let i = 0; i < tileCount; i++) {
    tiles.push({ legion: r.u8() })
  }

  const builds: BtlBuildV2[] = []
  for (let i = 0; i < info.buildCount; i++) {
    builds.push({
      index: r.i16(),
      areaName: r.i16(),
      constructionType: r.u8(),
      constructionLevel: r.u8(),
      constructionShop: r.u8(),
      constructionStyle: r.u8(),
      capitalStyle: r.u8(),
      installationType: r.u8(),
      strongPoint: r.u8(),
      event: r.u8(),
      bridges: [r.u8(), r.u8(), r.u8()],
      fireType: r.u8(),
    })
  }

  const armies: BtlArmyV2[] = []
  for (let i = 0; i < info.armyCount; i++) {
    armies.push({
      index: r.i16(),
      armyType: r.u8(),
      armyGrade: r.u8(),
      strengthNow: r.i16(),
      strengthMax: r.i16(),
      damageCount: r.i32(),
      training: r.u8(),
      movement: r.u8(),
      morale: r.u8(),
      unknown09: r.u8(),
      commander: r.i16(),
      moved: r.u8(),
      strongPoint: r.u8(),
      unknown13: r.u8(),
      dir: r.u8(),
      hasTroopship: r.u8(),
      attacked: r.u8(),
      unknown17: r.u8(),
      unknown18: r.u8(),
      event: r.u8(),
      buildRound: r.u8(),
      unknown21: r.i16(),
      unknown22: r.u8(),
      fireType: r.u8(),
    })
  }

  const fires: BtlFireV2[] = []
  for (let i = 0; i < info.fireCount; i++) {
    fires.push({ index: r.i32(), fireType: r.i32() })
  }

  const shops: BtlShopV2[] = []
  for (let i = 0; i < info.shopCount; i++) {
    const items = []
    for (let k = 0; k < 14; k++) {
      items.push({ itemID: r.i32(), number: r.i32() })
    }
    shops.push({ items, index: r.i32() })
  }

  const bars: BtlBarV2[] = []
  for (let i = 0; i < info.barCount; i++) {
    const commanders = []
    for (let k = 0; k < 5; k++) {
      commanders.push({
        commanderID: r.i32(),
        price: r.i32(),
        industry: r.i32(),
        medal: r.i32(),
        round: r.i32(),
      })
    }
    bars.push({ commanders, slot: r.i32(), index: r.i32() })
  }

  const events: BtlEventV2[] = []
  for (let i = 0; i < info.eventCount; i++) {
    events.push({
      eventID: r.i32(),
      trigger: r.i32(),
      status: r.i32(),
      round: r.i32(),
      dialogue: r.i32(),
      index: r.i32(),
      legion: r.bytes(20),
    })
  }

  return { info, legions, tiles, builds, armies, fires, shops, bars, events,
    originalBytes: Array.from(new Uint8Array(buffer)), originalBodyLength: r.pos }
}

class Writer {
  private view: DataView
  private offset = 0

  constructor(size: number) {
    this.view = new DataView(new ArrayBuffer(size))
  }

  u8(v: number) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error('BTL 字节数值越界')
    this.view.setUint8(this.offset, v & 0xff)
    this.offset += 1
  }
  i16(v: number) {
    if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new Error('BTL Int16 数值越界')
    this.view.setInt16(this.offset, v | 0, true)
    this.offset += 2
  }
  i32(v: number) {
    if (!Number.isInteger(v) || v < -2147483648 || v > 2147483647) throw new Error('BTL Int32 数值越界')
    this.view.setInt32(this.offset, v | 0, true)
    this.offset += 4
  }
  u32(v: number) {
    if (!Number.isInteger(v) || v < 0 || v > 4294967295) throw new Error('BTL UInt32 数值越界')
    this.view.setUint32(this.offset, v >>> 0, true)
    this.offset += 4
  }
  f32(v: number) {
    if (!Number.isFinite(v)) throw new Error('BTL 浮点数无效')
    this.view.setFloat32(this.offset, v, true)
    this.offset += 4
  }
  bytes(src: Uint8Array, len: number) {
    for (let i = 0; i < len; i++) {
      this.view.setUint8(this.offset + i, i < src.length ? src[i] : 0)
    }
    this.offset += len
  }

     result(): ArrayBuffer {
    return this.view.buffer as ArrayBuffer
  }
}

export function serializeBtl(p: BtlProject): ArrayBuffer {
  // Rewrite skips negative sites, but rejects tombstones in these sections.
  for (const [name, rows] of [['部队', p.armies], ['商店', p.shops], ['酒馆', p.bars], ['火焰', p.fires]] as const) {
    const slot = rows.findIndex(row => row.index < 0)
    if (slot >= 0) throw new Error(`Rewrite 不支持${name}负 cell 空槽（槽位 ${slot}）；请恢复该记录，结构删除需使用经过验证的 bridge writer`)
  }
  if (p.tiles.length !== p.info.mapW * p.info.mapH) throw new Error('BTL 归属格数与剧本尺寸不符')
  const size =
    18 * 4 +
    p.legions.length * 180 +
    p.tiles.length * 1 +
    p.builds.length * 16 +
    p.armies.length * 32 +
    p.fires.length * 8 +
    p.shops.length * 116 +
    p.bars.length * 108 +
    p.events.length * 44

  const w = new Writer(size)
  const info = p.info

  // BTLINFO
  w.i32(info.version)
  w.i32(info.mapId)
  w.i32(info.mapX)
  w.i32(info.mapY)
  w.i32(info.mapW)
  w.i32(info.mapH)
  w.i32(p.legions.length)
  w.i32(p.builds.length)
  w.i32(p.armies.length)
  w.i32(p.events.length)
  w.i32(p.shops.length)
  w.i32(info.victoryType)
  w.i32(info.victoryRound)
  w.i32(info.greatVictoryRound)
  w.i32(p.bars.length)
  w.i32(info.commander)
  w.i32(p.fires.length)
  w.i32(info.unknown17)

  // BTLLEGIONV2
  for (const l of p.legions) {
    w.i32(l.price)
    w.i32(l.industry)
    w.i32(l.food)
    w.i32(l.isNPC)
    w.i32(l.camp)
    w.i32(l.defeat)
    w.bytes(l.legion, 16)
    w.bytes(l.country, 16)
    w.f32(l.taxRate)
    w.f32(l.strength)
    w.u32(l.color)
    for (let k = 0; k < 26; k++) w.i32(l.technologies[k] ?? 0)
    w.i32(l.commanderCount)
    w.i32(l.unknown13)
  }

  // BTLTILEV2
  for (const t of p.tiles) w.u8(t.legion)

  // BTLBUILDV2
  for (const b of p.builds) {
    w.i16(b.index)
    w.i16(b.areaName)
    w.u8(b.constructionType)
    w.u8(b.constructionLevel)
    w.u8(b.constructionShop)
    w.u8(b.constructionStyle)
    w.u8(b.capitalStyle)
    w.u8(b.installationType)
    w.u8(b.strongPoint)
    w.u8(b.event)
    w.u8(b.bridges[0] ?? 0)
    w.u8(b.bridges[1] ?? 0)
    w.u8(b.bridges[2] ?? 0)
    w.u8(b.fireType)
  }

  // BTLARMYV2
  for (const a of p.armies) {
    w.i16(a.index)
    w.u8(a.armyType)
    w.u8(a.armyGrade)
    w.i16(a.strengthNow)
    w.i16(a.strengthMax)
    w.i32(a.damageCount)
    w.u8(a.training)
    w.u8(a.movement)
    w.u8(a.morale)
    w.u8(a.unknown09)
    w.i16(a.commander)
    w.u8(a.moved)
    w.u8(a.strongPoint)
    w.u8(a.unknown13)
    w.u8(a.dir)
    w.u8(a.hasTroopship)
    w.u8(a.attacked)
    w.u8(a.unknown17)
    w.u8(a.unknown18)
    w.u8(a.event)
    w.u8(a.buildRound)
    w.i16(a.unknown21)
    w.u8(a.unknown22)
    w.u8(a.fireType)
  }

  // BTLFIREV2
  for (const f of p.fires) {
    w.i32(f.index)
    w.i32(f.fireType)
  }

  // BTLSHOPV2
  for (const s of p.shops) {
    for (let k = 0; k < 14; k++) {
      const it = s.items[k] ?? { itemID: -1, number: 0 }
      w.i32(it.itemID)
      w.i32(it.number)
    }
    w.i32(s.index)
  }

  // BTLBARV2
  for (const b of p.bars) {
    for (let k = 0; k < 5; k++) {
      const c =
        b.commanders[k] ??
        { commanderID: -1, price: 0, industry: 0, medal: 0, round: 0 }
      w.i32(c.commanderID)
      w.i32(c.price)
      w.i32(c.industry)
      w.i32(c.medal)
      w.i32(c.round)
    }
    w.i32(b.slot)
    w.i32(b.index)
  }

  // BTLEVENTV2
  for (const e of p.events) {
    w.i32(e.eventID)
    w.i32(e.trigger)
    w.i32(e.status)
    w.i32(e.round)
    w.i32(e.dialogue)
    w.i32(e.index)
    w.bytes(e.legion, 20)
  }

  const body = w.result()
  if (p.originalBytes && p.originalBodyLength !== undefined && p.originalBytes.length > p.originalBodyLength) {
    const original = new Uint8Array(p.originalBytes)
    if (body.byteLength !== p.originalBodyLength || !new Uint8Array(body).every((b, i) => b === original[i]))
      throw new Error('扩展 BTL 必须通过 Rewrite 作者服务保存，禁止丢弃扩展或直接改写主体')
    return original.buffer
  }
  return body
}
