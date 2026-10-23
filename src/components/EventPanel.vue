<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BtlProject, BtlEventV2 } from '../core/formats/types'

const props = defineProps<{
  project: BtlProject | null
  changeVersion?: number
}>()

const emit = defineEmits<{
  (e: 'change'): void
}>()

const search = ref('')
const selectedIdx = ref(0)
const version = ref(0)

watch(
  () => [props.project, props.changeVersion],
  () => {
    version.value++
  }
)

const TRIGGER_OPTIONS = [
  { value: 0, label: '建筑' },
  { value: 1, label: '部队' },
  { value: 2, label: '回合' },
]

const STATUS_OPTIONS = [
  { value: 0, label: '士气上升' },
  { value: 1, label: '士气下降' },
  { value: 2, label: '士气大降' },
  { value: 3, label: '混乱' },
  { value: 4, label: '（空）' },
  { value: 5, label: '燃烧' },
]

function triggerLabel(v: number): string {
  const o = TRIGGER_OPTIONS.find((x) => x.value === v)
  return o ? o.label : ''
}

function statusLabel(v: number): string {
  const o = STATUS_OPTIONS.find((x) => x.value === v)
  return o ? o.label : ''
}

function bytesToString(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0) break
    s += String.fromCharCode(b)
  }
  return s
}

function stringToBytes(str: string, len: number): Uint8Array {
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    out[i] = i < str.length ? str.charCodeAt(i) & 0xff : 0
  }
  return out
}

const buildSet = computed(() => {
  void version.value
  const s = new Set<number>()
  if (props.project) for (const b of props.project.builds) s.add(b.index)
  return s
})

const armySet = computed(() => {
  void version.value
  const s = new Set<number>()
  if (props.project) for (const a of props.project.armies) s.add(a.index)
  return s
})

function eventSummary(e: BtlEventV2): { left: string; right: string } {
  let left = ''
  if (e.trigger === 0) {
    const exists = buildSet.value.has(e.eventID)
    left = exists ? `建筑#${e.eventID} 被占领` : `建筑#${e.eventID}（未写入）`
  } else if (e.trigger === 1) {
    const exists = armySet.value.has(e.eventID)
    left = exists ? `部队#${e.eventID} 被消灭` : `部队#${e.eventID}（未写入）`
  } else if (e.trigger === 2) {
    left = `第 ${e.round} 回合`
  } else {
    left = `触发 ${e.trigger}`
  }

  const statusText = statusLabel(e.status) || `状态 ${e.status}`
  let right = statusText

  const legionStr = bytesToString(e.legion)
  if (legionStr) {
    right += ` · ${legionStr} 军团`
  } else if (e.dialogue !== 0) {
    right += ` · 目标#${e.dialogue}`
  }

  return { left, right }
}

const filteredEvents = computed(() => {
  void version.value
  if (!props.project) return []
  const kw = search.value.trim().toLowerCase()
  const all = props.project.events.map((e, i) => ({ i, e }))
  if (!kw) return all
  return all.filter(({ e, i }) => {
    if (String(i).includes(kw)) return true
    if (String(e.eventID).includes(kw)) return true
    if (String(e.trigger).includes(kw)) return true
    if (String(e.status).includes(kw)) return true
    if (String(e.round).includes(kw)) return true
    if (String(e.dialogue).includes(kw)) return true
    if (bytesToString(e.legion).toLowerCase().includes(kw)) return true
    if (triggerLabel(e.trigger).includes(kw)) return true
    if (statusLabel(e.status).includes(kw)) return true
    return false
  })
})

const rows = computed(() => {
  void version.value
  return filteredEvents.value.map((r) => ({
    i: r.i,
    e: r.e,
    summary: eventSummary(r.e),
  }))
})

const current = computed<BtlEventV2 | null>(() => {
  void version.value
  if (!props.project) return null
  return props.project.events[selectedIdx.value] ?? null
})

const legionText = computed({
  get: () => {
    void version.value
    return current.value ? bytesToString(current.value.legion) : ''
  },
  set: (v: string) => {
    if (!current.value) return
    current.value.legion = stringToBytes(v, current.value.legion.length)
    version.value++
    emit('change')
  },
})

function onNum(e: Event, setter: (v: number) => void) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  setter(isNaN(v) ? 0 : v)
}

function setField(field: keyof BtlEventV2, value: number) {
  if (!current.value) return
  ;(current.value as any)[field] = value
  version.value++
  emit('change')
}

function addEvent() {
  if (!props.project) return
  let maxId = -1
  for (const e of props.project.events) {
    if (e.eventID > maxId) maxId = e.eventID
  }
  const newEvent: BtlEventV2 = {
    eventID: maxId + 1,
    trigger: 0,
    status: 0,
    round: 0,
    dialogue: 0,
    index: props.project.events.length,
    legion: new Uint8Array(20),
  }
  props.project.events.push(newEvent)
  selectedIdx.value = props.project.events.length - 1
  search.value = ''
  version.value++
  emit('change')
}

function removeEvent() {
  if (!props.project) return
  const i = selectedIdx.value
  if (i < 0 || i >= props.project.events.length) return
  props.project.events.splice(i, 1)
  if (selectedIdx.value >= props.project.events.length) {
    selectedIdx.value = Math.max(0, props.project.events.length - 1)
  }
  version.value++
  emit('change')
}

function selectEvent(i: number) {
  selectedIdx.value = i
}
</script>

<template>
  <div class="panel">
    <div v-if="!project" class="hint">请先导入 BTL 文件</div>

    <template v-else>
      <div class="toolbar">
        <input
          class="search"
          type="text"
          placeholder="搜索 ID / 触发 / 状态"
          v-model="search"
        />
        <button class="btn primary" @click="addEvent">新增</button>
        <button class="btn danger" @click="removeEvent">删除</button>
      </div>

      <div class="list">
        <div
          v-for="row in rows"
          :key="row.i"
          class="list-item"
          :class="{ active: row.i === selectedIdx }"
          @click="selectEvent(row.i)"
        >
          <div class="li-id">#{{ row.i }} · ID {{ row.e.eventID }}</div>
          <div class="li-desc">
            <span class="li-left">{{ row.summary.left }}</span>
            <span class="sep">→</span>
            <span class="li-right">{{ row.summary.right }}</span>
          </div>
        </div>
        <div v-if="rows.length === 0" class="list-empty">无匹配事件</div>
      </div>

      <div v-if="current" class="detail">
        <div class="grid compact">
          <!-- 第一行：事件ID / 触发 -->
          <label>事件ID</label>
          <input
            type="number"
            :value="current.eventID"
            @change="(e) => onNum(e, (v) => setField('eventID', v))"
          />

          <label>触发</label>
          <div class="enum-cell">
            <select
              class="enum-select"
              :value="String(current.trigger)"
              @change="
                (e) =>
                  setField(
                    'trigger',
                    Number((e.target as HTMLSelectElement).value)
                  )
              "
            >
              <option
                v-for="o in TRIGGER_OPTIONS"
                :key="o.value"
                :value="String(o.value)"
              >
                {{ o.label }}
              </option>
            </select>
            <input
              class="enum-num"
              type="number"
              :value="current.trigger"
              @change="(e) => onNum(e, (v) => setField('trigger', v))"
            />
          </div>

          <!-- 第二行：状态 / 回合 -->
          <label>状态</label>
          <div class="enum-cell">
            <select
              class="enum-select"
              :value="String(current.status)"
              @change="
                (e) =>
                  setField(
                    'status',
                    Number((e.target as HTMLSelectElement).value)
                  )
              "
            >
              <option
                v-for="o in STATUS_OPTIONS"
                :key="o.value"
                :value="String(o.value)"
              >
                {{ o.label }}
              </option>
            </select>
            <input
              class="enum-num"
              type="number"
              :value="current.status"
              @change="(e) => onNum(e, (v) => setField('status', v))"
            />
          </div>

          <label>回合</label>
          <input
            type="number"
            :value="current.round"
            @change="(e) => onNum(e, (v) => setField('round', v))"
          />

          <!-- 第三行：对话 / 索引 -->
          <label>对话</label>
          <input
            type="number"
            :value="current.dialogue"
            @change="(e) => onNum(e, (v) => setField('dialogue', v))"
          />
          <label>索引</label>
          <input
            type="number"
            :value="current.index"
            @change="(e) => onNum(e, (v) => setField('index', v))"
          />

          <!-- 第四行：军团 -->
          <label>军团</label>
          <input type="text" v-model="legionText" class="span3" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  padding: 8px 10px 12px;
  font-size: 13px;
  color: #d1d5db;
}

.hint {
  color: #9ca3af;
  padding: 16px;
  text-align: center;
}

.toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.search {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid #4b5563;
  border-radius: 4px;
  background: #111827;
  color: #e5e7eb;
  font-size: 12px;
}

.search:focus {
  outline: none;
  border-color: #2563eb;
}

.btn {
  padding: 5px 12px;
  border-radius: 4px;
  border: 1px solid #4b5563;
  background: #374151;
  color: #e5e7eb;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.btn.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

.btn.danger {
  background: #7f1d1d;
  border-color: #7f1d1d;
  color: #fecaca;
}

/* 事件列表 */
.list {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid #374151;
  border-radius: 6px;
  background: #0f172a;
  margin-bottom: 8px;
  -webkit-overflow-scrolling: touch;
}

.list-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px;
  border-bottom: 1px solid #1f2937;
  cursor: pointer;
  font-size: 12px;
}

.list-item:last-child {
  border-bottom: none;
}

.list-item:hover {
  background: #1e293b;
}

.list-item.active {
  background: #1e40af;
  color: #fff;
}

.li-id {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.li-desc {
  color: #9ca3af;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.list-item.active .li-desc {
  color: #dbeafe;
}

.li-right {
  color: #fbbf24;
}

.list-item.active .li-right {
  color: #fde68a;
}

.sep {
  opacity: 0.6;
  margin: 0 4px;
}

.list-empty {
  padding: 14px 8px;
  color: #6b7280;
  text-align: center;
  font-size: 12px;
}

/* 详情 */
.detail {
  border: 1px solid #374151;
  border-radius: 6px;
  padding: 8px;
  background: #111827;
}

.grid.compact {
  display: grid;
  grid-template-columns: 56px 1fr 56px 1fr;
  gap: 5px 8px;
  align-items: center;
}

.grid.compact > label {
  color: #9ca3af;
  font-size: 11px;
  white-space: nowrap;
}

/* 统一的输入框样式 */
.grid.compact input,
.grid.compact select {
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #4b5563;
  border-radius: 3px;
  background: #1f2937;
  color: #e5e7eb;
  font-size: 12px;
  box-sizing: border-box;
}

.grid.compact input:focus,
.grid.compact select:focus {
  outline: none;
  border-color: #2563eb;
}

/* 去掉数字输入框自带的上下小箭头 */
.grid.compact input[type='number']::-webkit-outer-spin-button,
.grid.compact input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.grid.compact input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

/* 枚举字段：下拉框在左，数字框在右 */
.enum-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 用提高优先级的方式确保下拉框宽度固定 */
.enum-cell .enum-select {
  width: 74px;
  flex-shrink: 0;
  padding-right: 18px;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 6'%3E%3Cpath fill='%239ca3af' d='M0 0l4 6 4-6z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
  background-size: 7px 5px;
}

.enum-cell .enum-num {
  flex: 1;
  min-width: 0;
  text-align: center;
}

/* 军团占满整行剩余列 */
.span3 {
  grid-column: 2 / -1;
}
</style>