<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  BATTLE_LINES,
  battlesForChapter,
  parseBattleZoneIdx,
  type BattleEntry,
} from '../core/data/battleList'
import { getBattleTitle } from '../core/data/config'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'pick', file: string): void
}>()

const selectedChapter = ref(0)

const chapters = computed(() =>
  BATTLE_LINES.map((l, i) => ({
    idx: i + 1,
    key: l.name,
    title: getBattleTitle(l.name) || l.name,
    hide: l.hide,
  })).filter((c) => !c.hide)
)

const battles = computed(() => {
  if (selectedChapter.value === 0) return []
  return battlesForChapter(selectedChapter.value)
})

function battleDisplay(b: BattleEntry) {
  const idx = parseBattleZoneIdx(b.name)
  const title = getBattleTitle(b.name) || b.name
  return { idx, title, hasBranch: !!b.file2 }
}

function onPickMain(b: BattleEntry) {
  emit('pick', b.file)
}
function onPickBranch(b: BattleEntry) {
  emit('pick', b.file2!)
}

function branchLabel(b: BattleEntry): string {
  if (!b.countries) return '分支'
  return b.countries.split(',').map((s) => s.toUpperCase()).join('/')
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span>选择战役</span>
        <button class="close" @click="emit('close')">×</button>
      </div>

      <div class="chapters-bar">
        <div class="section-title">章节</div>
        <div class="chapter-scroll">
          <button
            v-for="c in chapters"
            :key="c.key"
            class="chapter-btn"
            :class="{ active: selectedChapter === c.idx }"
            @click="selectedChapter = c.idx"
          >
            {{ c.idx }} · {{ c.title }}
          </button>
          <div v-if="chapters.length === 0" class="empty">
            未能读取章节，请确认 INI 已导入
          </div>
        </div>
      </div>

      <div class="battles">
        <div class="section-title">
          {{ selectedChapter > 0 ? '关卡' : '请选择章节' }}
        </div>
        <div v-if="selectedChapter > 0" class="battle-list">
          <div v-for="b in battles" :key="b.name" class="battle-row">
            <div class="battle-main">
              <span class="idx">{{ battleDisplay(b).idx }}</span>
              <span class="name">{{ battleDisplay(b).title }}</span>
            </div>
            <div class="battle-actions">
              <template v-if="b.file2">
                <span class="branch-hint">{{ branchLabel(b) }}</span>
                <button class="btn" @click="onPickMain(b)">主</button>
                <button class="btn" @click="onPickBranch(b)">副</button>
              </template>
              <button v-else class="btn primary" @click="onPickMain(b)">加载</button>
            </div>
          </div>
        </div>
        <div v-else class="empty">请选择章节</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 200;
  padding: 8px;
  box-sizing: border-box;
}
.dialog {
  background: #1f2937; border: 1px solid #374151; border-radius: 8px;
  width: min(520px, 100%);
  max-height: 92vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: #111827;
  border-bottom: 1px solid #374151; font-weight: 600; color: #f3f4f6;
  flex-shrink: 0;
}
.close {
  border: none; background: transparent; color: #9ca3af;
  font-size: 22px; line-height: 1; padding: 0 6px; cursor: pointer;
}
.close:hover { color: #f87171; }

/* 章节：横向一行滚动 */
.chapters-bar {
  padding: 8px 12px 4px;
  border-bottom: 1px solid #374151;
  flex-shrink: 0;
}
.section-title {
  color: #93c5fd; font-weight: 600; font-size: 12px; margin-bottom: 6px;
}
.chapter-scroll {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 4px;
}


.chapter-btn {
  flex: 0 0 calc((100% - 12px) / 3);   /* 每行 3 个，宽度一致（2 个 6px 间隙） */
  padding: 8px 6px;
  border-radius: 6px;
  border: 1px solid #374151;
  background: #111827;
  color: #d1d5db;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  cursor: pointer;
  box-sizing: border-box;
}
.chapter-btn:hover { background: #1e293b; }
.chapter-btn.active {
  background: #2563eb; border-color: #2563eb; color: #fff;
}

/* 关卡列表 */
.battles {
  flex: 1 1 auto;
  display: flex; flex-direction: column;
  padding: 8px 12px 12px;
  min-height: 0;
}
.battle-list {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex; flex-direction: column; gap: 5px;
}
.battle-row {
  display: flex; justify-content: space-between; align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 6px;
}
.battle-row:hover { background: #1e293b; }
.battle-main {
  display: flex; gap: 8px; align-items: center;
  min-width: 0;
  flex: 1 1 auto;
}
.idx {
  color: #fbbf24; font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 20px; text-align: right;
  flex-shrink: 0;
}
.name {
  color: #e5e7eb;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.battle-actions {
  display: flex; gap: 4px; align-items: center;
  flex-shrink: 0;
}
.branch-hint {
  color: #9ca3af; font-size: 10px;
  margin-right: 2px;
}
.btn {
  padding: 5px 10px; border-radius: 4px;
  border: 1px solid #4b5563; background: #374151;
  color: #e5e7eb; font-size: 12px; cursor: pointer;
  white-space: nowrap;
}
.btn:hover { background: #4b5563; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.empty { color: #6b7280; font-size: 12px; padding: 8px 2px; }
</style>