<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BtlProject, BtlLegionV2 } from '../core/formats/types'
import { getCountryName, getAllCountries, getUnitAbbr } from '../core/data/config'
import { UNITS } from '../core/data/units'

const props = defineProps<{
  project: BtlProject | null
}>()

const emit = defineEmits<{
  (e: 'change'): void
}>()

const selectedIdx = ref(0)

watch(
  () => props.project,
  () => {
    selectedIdx.value = 0
  }
)

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

const countryOptions = computed(() => getAllCountries())

const legionOptions = computed(() => {
  if (!props.project) return []
  return props.project.legions.map((l, i) => {
    const cc = bytesToString(l.country)
    const cn = getCountryName(cc)
    const label = cn && cn !== cc
      ? `军团 ${i + 1} · ${cc} · ${cn}`
      : `军团 ${i + 1} · ${cc || '(空)'}`
    return { index: i, label }
  })
})

const current = computed<BtlLegionV2 | null>(() => {
  if (!props.project) return null
  return props.project.legions[selectedIdx.value] ?? null
})

const countryCode = computed(() => {
  if (!current.value) return ''
  return bytesToString(current.value.country)
})

function onCountrySelect(e: Event) {
  if (!current.value) return
  const v = (e.target as HTMLSelectElement).value
  current.value.country = stringToBytes(v, current.value.country.length)
  current.value.legion = stringToBytes(v, current.value.legion.length)
  emit('change')
}

const colorHex = computed({
  get: () =>
    current.value
      ? (current.value.color >>> 0).toString(16).padStart(8, '0').toUpperCase()
      : '',
  set: (v: string) => {
    if (!current.value) return
    const n = parseInt(v.replace(/[^0-9a-fA-F]/g, ''), 16)
    current.value.color = isNaN(n) ? 0 : n >>> 0
    emit('change')
  },
})

const colorPreview = computed(() => {
  if (!current.value) return '#000'
  const argb = current.value.color >>> 0
  const s = argb.toString(16).padStart(8, '0')
  const a = parseInt(s.substring(0, 2), 16)
  const b = parseInt(s.substring(2, 4), 16)
  const g = parseInt(s.substring(4, 6), 16)
  const r = parseInt(s.substring(6, 8), 16)
  const nA = Math.min(100, a)
  const nB = 0xff - Math.floor(((0xff - b) * nA) / 100)
  const nG = 0xff - Math.floor(((0xff - g) * nA) / 100)
  const nR = 0xff - Math.floor(((0xff - r) * nA) / 100)
  return `rgb(${nR}, ${nG}, ${nB})`
})

/** 科技索引 → 单位缩写或单位名（用于显示） */
function techUnitLabel(i: number): string {
  const u = UNITS[i]
  if (!u) return ''
  const custom = getUnitAbbr(i)
  return custom || u.name
}

function onNum(e: Event, setter: (v: number) => void) {
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  setter(isNaN(v) ? 0 : v)
}

function onFloat(e: Event, setter: (v: number) => void) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  setter(isNaN(v) ? 0 : v)
}

function setField(field: keyof BtlLegionV2, value: number) {
  if (!current.value) return
  ;(current.value as any)[field] = value
  emit('change')
}
</script>

<template>
  <div class="panel">
    <div v-if="!project" class="hint">请先导入 BTL 文件</div>

    <template v-else>
      <div class="row-top">
        <label>军团</label>
        <select v-model.number="selectedIdx">
          <option v-for="o in legionOptions" :key="o.index" :value="o.index">
            {{ o.label }}
          </option>
        </select>
      </div>

      <div v-if="current" class="sections">
        <div class="section">
          <div class="section-head">基本信息</div>
          <div class="grid">
            <label>国家</label>
            <select :value="countryCode" @change="onCountrySelect">
              <option v-for="c in countryOptions" :key="c.code" :value="c.code">
                {{ c.code }} · {{ c.name }}
              </option>
            </select>

            <label>金币</label>
            <input type="number" :value="current.price"
                   @change="(e) => onNum(e, (v) => setField('price', v))" />
            <label>工业</label>
            <input type="number" :value="current.industry"
                   @change="(e) => onNum(e, (v) => setField('industry', v))" />

            <label>食物</label>
            <input type="number" :value="current.food"
                   @change="(e) => onNum(e, (v) => setField('food', v))" />
            <label>是否电脑</label>
            <input type="number" :value="current.isNPC"
                   @change="(e) => onNum(e, (v) => setField('isNPC', v))" />

            <label>阵营</label>
            <input type="number" :value="current.camp"
                   @change="(e) => onNum(e, (v) => setField('camp', v))" />
            <label>失败条件</label>
            <input type="number" :value="current.defeat"
                   @change="(e) => onNum(e, (v) => setField('defeat', v))" />
          </div>
        </div>

        <div class="section">
          <div class="section-head">数值</div>
          <div class="grid">
            <label>税率</label>
            <input type="number" step="0.001" :value="current.taxRate"
                   @change="(e) => onFloat(e, (v) => setField('taxRate', v))" />
            <label>加成</label>
            <input type="number" step="0.001" :value="current.strength"
                   @change="(e) => onFloat(e, (v) => setField('strength', v))" />

            <label>颜色</label>
            <div class="color-row">
              <input type="text" v-model="colorHex" class="hex-input" />
              <span class="color-swatch" :style="{ background: colorPreview }"></span>
            </div>

            <label>将军数</label>
            <input type="number" :value="current.commanderCount"
                   @change="(e) => onNum(e, (v) => setField('commanderCount', v))" />
            <label>未知13</label>
            <input type="number" :value="current.unknown13"
                   @change="(e) => onNum(e, (v) => setField('unknown13', v))" />
          </div>
        </div>

        <div class="section">
          <div class="section-head">科技（26 项）</div>
          <div class="tech-grid">
            <div v-for="(t, i) in current.technologies" :key="i" class="tech-cell">
              <span class="tech-idx">{{ i }}</span>
              <span class="tech-name">{{ techUnitLabel(i) }}</span>
              <input type="number" :value="t"
                     @change="(e) => {
                       const n = parseInt((e.target as HTMLInputElement).value, 10)
                       current!.technologies[i] = isNaN(n) ? 0 : n
                       emit('change')
                     }" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel { padding: 10px 12px 16px; font-size: 13px; color: #d1d5db; }
.hint { color: #9ca3af; padding: 16px; text-align: center; }

.row-top {
  display: flex; align-items: center; gap: 8px; margin-bottom: 10px;
}
.row-top label { color: #9ca3af; font-size: 12px; flex-shrink: 0; }
.row-top select {
  flex: 1; padding: 5px 6px; background: #111827; color: #e5e7eb;
  border: 1px solid #4b5563; border-radius: 4px; font-size: 13px; min-width: 0;
}

.section {
  border: 1px solid #374151; border-radius: 6px; padding: 8px;
  margin-bottom: 10px; background: #111827;
}
.section-head {
  font-weight: 600; margin-bottom: 6px; color: #93c5fd;
}

.grid {
  display: grid; grid-template-columns: 84px 1fr 84px 1fr;
  gap: 6px 8px; align-items: center;
}
.grid label { color: #9ca3af; font-size: 12px; }
.grid input,
.grid select {
  width: 100%; padding: 4px 6px; border: 1px solid #4b5563;
  border-radius: 4px; background: #1f2937; color: #e5e7eb;
  font-size: 13px; box-sizing: border-box; min-width: 0;
}
.grid input:focus,
.grid select:focus { outline: none; border-color: #2563eb; }

.color-row { display: flex; align-items: center; gap: 6px; }
.color-swatch {
  width: 22px; height: 22px; border-radius: 4px;
  border: 1px solid #4b5563; flex-shrink: 0;
}
.hex-input { flex: 1; text-transform: uppercase; }

.tech-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px 6px;
}
.tech-cell {
  display: grid; grid-template-columns: 20px 72px 1fr;
  align-items: center; gap: 4px;
}
.tech-idx { color: #6b7280; font-size: 11px; text-align: right; }
.tech-name {
  color: #93c5fd; font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tech-cell input {
  width: 100%; padding: 3px 4px; border: 1px solid #4b5563;
  border-radius: 3px; background: #1f2937; color: #e5e7eb; font-size: 12px;
}
</style>