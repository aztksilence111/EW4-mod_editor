<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import MapToolsMenu from './MapToolsMenu.vue'
import type { BtlProject } from '../core/formats/types'
import {
  editorConfig,
  setDisplayMode,
  setBuildingAlpha,
  setHexLineAlpha,
  setRiverWidth,
  setBreathSpeed,
  resetDisplay,
} from '../core/data/config'

const props = defineProps<{
  status: string
  project: BtlProject | null
  terrainMode: boolean
  clipActive: boolean
}>()

const emit = defineEmits<{
  (e: 'import', file: File): void
  (e: 'export'): void
  (e: 'open-map-select'): void
  (e: 'toggle-terrain-mode'): void
  (e: 'start-clip'): void
  (e: 'cancel-clip'): void
  (e: 'export-terrain-bin'): void
  (e: 'open-campaign'): void
  (e: 'open-conquest'): void
  (e: 'save-now'): void
  (e: 'clear-draft'): void
  (e: 'export-pack'): void
  (e: 'import-pack'): void
  (e: 'export-offline-html'): void
  (e: 'change'): void
  (e: 'open-actual-display'): void
}>()

const collapsed = ref(false)

try {
  const saved = localStorage.getItem('ew4-topbar-collapsed')
  if (saved === 'true') collapsed.value = true
} catch {}

watch(collapsed, (v) => {
  try { localStorage.setItem('ew4-topbar-collapsed', String(v)) } catch {}
})

const showLevelMenu = ref(false)
const showDisplayMenu = ref(false)

const info = computed(() => props.project?.info ?? null)

function onBtlChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) emit('import', file)
}

function toggleLevelMenu() {
  showLevelMenu.value = !showLevelMenu.value
  showDisplayMenu.value = false
}
function toggleDisplayMenu() {
  showDisplayMenu.value = !showDisplayMenu.value
  showLevelMenu.value = false
}

function pickLevel(action: () => void) {
  action()
  showLevelMenu.value = false
}

function pickMode(mode: 'chinese' | 'english') {
  setDisplayMode(mode)
}
function onAlphaSlider(e: Event) {
  setBuildingAlpha(parseFloat((e.target as HTMLInputElement).value))
}
function onHexLineSlider(e: Event) {
  setHexLineAlpha(parseFloat((e.target as HTMLInputElement).value))
}
function onRiverSlider(e: Event) {
  setRiverWidth(parseFloat((e.target as HTMLInputElement).value))
}
function onBreathSlider(e: Event) {
  setBreathSpeed(parseFloat((e.target as HTMLInputElement).value))
}

function setField(field: string, e: Event) {
  if (!props.project) return
  const v = parseInt((e.target as HTMLInputElement).value, 10)
  ;(props.project.info as any)[field] = isNaN(v) ? 0 : v
  emit('change')
}
</script>

<template>
  <!-- ==================== 展开状态：完整顶栏 ==================== -->
  <template v-if="!collapsed">
    <header class="topbar">
      <div class="left">
        <div class="title">EW4 编辑器</div>
        <button
          class="collapse-btn"
          title="收起顶部栏"
          @click="collapsed = true"
        >◀</button>
      </div>
      <div class="actions">
        <div class="dropdown-wrap">
          <button class="btn primary" @click="toggleLevelMenu">关卡功能 ▾</button>
          <div v-if="showLevelMenu" class="dropdown">
            <button class="dropdown-item" @click="pickLevel(() => emit('open-campaign'))">
              选择战役
            </button>
            <button class="dropdown-item" @click="pickLevel(() => emit('open-conquest'))">
              选择征服
            </button>
            <div class="separator"></div>
            <label class="dropdown-item" @click.stop>
              导入 BTL
              <input
                type="file"
                accept=".btl,.sav,application/octet-stream,*/*"
                style="display: none"
                @change="(e) => { onBtlChange(e); showLevelMenu = false; }"
              />
            </label>
            <button class="dropdown-item" @click="pickLevel(() => emit('export'))">
              导出 BTL
            </button>
          </div>
        </div>

        <MapToolsMenu
          :terrain-mode="terrainMode"
          :clip-active="clipActive"
          @open-map-select="emit('open-map-select')"
          @toggle-terrain-mode="emit('toggle-terrain-mode')"
          @start-clip="emit('start-clip')"
          @cancel-clip="emit('cancel-clip')"
          @export-terrain-bin="emit('export-terrain-bin')"
        />

        <div class="dropdown-wrap">
          <button class="btn" @click="toggleDisplayMenu">显示设置 ▾</button>
          <div v-if="showDisplayMenu" class="dropdown">
            <div class="dropdown-title">实际显示</div>
            <button
              class="dropdown-item accent-btn"
              @click="emit('open-actual-display'); showDisplayMenu = false"
            >
              打开「实际显示」设置
            </button>

            <div class="dropdown-title">名称语言</div>
            <button class="dropdown-item"
                    :class="{ active: editorConfig.displayMode === 'chinese' }"
                    @click="pickMode('chinese')">中文名显示</button>
            <button class="dropdown-item"
                    :class="{ active: editorConfig.displayMode === 'english' }"
                    @click="pickMode('english')">英文名显示</button>

            <div class="dropdown-title">建筑底色不透明度</div>
            <div class="slider-row">
              <input type="range" min="0" max="1" step="0.01"
                     :value="editorConfig.display.buildingAlpha" @input="onAlphaSlider" />
              <input type="number" min="0" max="1" step="0.01"
                     :value="editorConfig.display.buildingAlpha" @input="onAlphaSlider"
                     class="num-input" />
            </div>

            <div class="dropdown-title">六边形边缘不透明度</div>
            <div class="slider-row">
              <input type="range" min="0" max="1" step="0.01"
                     :value="editorConfig.display.hexLineAlpha" @input="onHexLineSlider" />
              <input type="number" min="0" max="1" step="0.01"
                     :value="editorConfig.display.hexLineAlpha" @input="onHexLineSlider"
                     class="num-input" />
            </div>

            <div class="dropdown-title">河流粗细（最大 3.2）</div>
            <div class="slider-row">
              <input type="range" min="0" max="3.2" step="0.1"
                     :value="editorConfig.display.riverWidth" @input="onRiverSlider" />
              <input type="number" min="0" max="3.2" step="0.1"
                     :value="editorConfig.display.riverWidth" @input="onRiverSlider"
                     class="num-input" />
            </div>

            <div class="dropdown-title">据点呼吸速度（0 = 不播放）</div>
            <div class="slider-row">
              <input type="range" min="0" max="5" step="0.1"
                     :value="editorConfig.display.breathSpeed" @input="onBreathSlider" />
              <input type="number" min="0" max="5" step="0.1"
                     :value="editorConfig.display.breathSpeed" @input="onBreathSlider"
                     class="num-input" />
            </div>

            <div class="dropdown-title">本地草稿</div>
            <button class="dropdown-item" @click="emit('save-now')">立即保存草稿</button>
            <button class="dropdown-item reset-btn" @click="emit('clear-draft')">清空本地草稿</button>

            <div class="dropdown-title">工程文件</div>
            <button class="dropdown-item" @click="emit('export-pack')">导出工程包 (.ew4p)</button>
            <button class="dropdown-item" @click="emit('import-pack')">导入工程包 (.ew4p)</button>
            <button class="dropdown-item accent" @click="emit('export-offline-html')">导出离线项目 (.html)</button>

            <button class="dropdown-item reset-btn" @click="resetDisplay">
              恢复显示默认值
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="info-row">
      <div class="status-text">{{ status }}</div>

      <div v-if="info" class="fields">
        <div class="item">
          <label>胜利条件</label>
          <input type="number" :value="info.victoryType"
                 @change="(e) => setField('victoryType', e)" />
        </div>
        <div class="item">
          <label>胜利回合</label>
          <input type="number" :value="info.victoryRound"
                 @change="(e) => setField('victoryRound', e)" />
        </div>
        <div class="item">
          <label>重大胜利回合</label>
          <input type="number" :value="info.greatVictoryRound"
                 @change="(e) => setField('greatVictoryRound', e)" />
        </div>
        <div class="item">
          <label>军团长</label>
          <input type="number" :value="info.commander"
                 @change="(e) => setField('commander', e)" />
        </div>
        <div class="item">
          <label>地图X</label>
          <input type="number" :value="info.mapX"
                 @change="(e) => setField('mapX', e)" />
        </div>
        <div class="item">
          <label>地图Y</label>
          <input type="number" :value="info.mapY"
                 @change="(e) => setField('mapY', e)" />
        </div>
        <div class="item">
          <label>地图宽</label>
          <input type="number" :value="info.mapW"
                 @change="(e) => setField('mapW', e)" />
        </div>
        <div class="item">
          <label>地图高</label>
          <input type="number" :value="info.mapH"
                 @change="(e) => setField('mapH', e)" />
        </div>
      </div>
    </div>
  </template>

  <!-- ==================== 折叠状态：右上角浮层 ==================== -->
  <div v-else class="float-top-right">
    <button
      class="float-pill collapse"
      title="展开顶部栏"
      @click="collapsed = false"
    >◀</button>

    <div class="dropdown-wrap">
      <button class="float-pill" @click="toggleLevelMenu">关卡功能 ▾</button>
      <div v-if="showLevelMenu" class="dropdown">
        <button class="dropdown-item" @click="pickLevel(() => emit('open-campaign'))">
          选择战役
        </button>
        <button class="dropdown-item" @click="pickLevel(() => emit('open-conquest'))">
          选择征服
        </button>
        <div class="separator"></div>
        <label class="dropdown-item" @click.stop>
          导入 BTL
          <input
            type="file"
            accept=".btl,.sav,application/octet-stream,*/*"
            style="display: none"
            @change="(e) => { onBtlChange(e); showLevelMenu = false; }"
          />
        </label>
        <button class="dropdown-item" @click="pickLevel(() => emit('export'))">
          导出 BTL
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ================ 展开状态 ================ */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  padding-top: calc(10px + env(safe-area-inset-top));
  background: #1f2937;
  border-bottom: 1px solid #374151;
  position: relative;
  z-index: 20;
}
.left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.collapse-btn {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid #4b5563;
  background: #374151;
  color: #e5e7eb;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}
.collapse-btn:hover { background: #4b5563; }
.title { font-size: 16px; font-weight: 600; flex-shrink: 0; }
.actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  justify-content: flex-end; align-items: center;
}
.btn {
  display: inline-block; padding: 8px 12px; border-radius: 6px;
  border: 1px solid #4b5563; background: #374151; color: #e5e7eb;
  font-size: 13px; cursor: pointer; user-select: none; line-height: 1.2;
}
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #1f2937;
  border-bottom: 1px solid #374151;
  font-size: 12px;
  overflow-x: auto;
  scrollbar-width: none;
}
.info-row::-webkit-scrollbar { display: none; }
.status-text {
  color: #9ca3af; white-space: nowrap; flex-shrink: 0; font-size: 12px;
}
.fields {
  display: flex; gap: 8px; flex-wrap: nowrap; align-items: center;
  margin-left: auto;
}
.item { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.item label { color: #9ca3af; font-size: 11px; white-space: nowrap; }
.item input {
  width: 64px; padding: 3px 5px; border: 1px solid #4b5563;
  border-radius: 3px; background: #111827; color: #e5e7eb;
  font-size: 12px; box-sizing: border-box;
}
.item input:focus { outline: none; border-color: #2563eb; }

.dropdown-wrap { position: relative; }
.dropdown {
  position: absolute; right: 0; top: calc(100% + 4px);
  background: #1f2937; border: 1px solid #374151; border-radius: 6px;
  min-width: 200px; box-shadow: 0 8px 20px rgba(0,0,0,0.5);
  z-index: 100; overflow: hidden; max-height: 75vh; overflow-y: auto;
}
.dropdown-title {
  padding: 6px 12px; font-size: 11px; color: #6b7280;
  border-bottom: 1px solid #374151; background: #111827; margin-top: 2px;
}
.dropdown-item {
  display: block; width: 100%; padding: 8px 12px; border: none;
  background: transparent; color: #e5e7eb; font-size: 13px;
  text-align: left; cursor: pointer;
}
.dropdown-item:hover { background: #374151; }
.dropdown-item.active { color: #93c5fd; font-weight: 600; }
.dropdown-item.active::before { content: '✓ '; }
.dropdown-item.accent { color: #34d399; }
.dropdown-item.accent-btn { color: #fbbf24; }
.separator { height: 1px; background: #374151; margin: 2px 0; }
.slider-row {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
}
.slider-row input[type='range'] { flex: 1; min-width: 0; }
.num-input {
  width: 54px; padding: 3px 4px; border: 1px solid #4b5563;
  border-radius: 3px; background: #0f172a; color: #e5e7eb;
  font-size: 12px; text-align: center;
}
.reset-btn { border-top: 1px solid #374151; color: #fbbf24; }

/* ================ 折叠状态：右上角浮层 ================ */
.float-top-right {
  position: fixed;
  top: calc(8px + env(safe-area-inset-top));
  right: 8px;
  display: flex;
  gap: 6px;
  z-index: 100;
  align-items: center;
}
.float-pill {
  padding: 8px 12px;
  border-radius: 18px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(31, 41, 55, 0.92);
  color: #e5e7eb;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  line-height: 1;
}
.float-pill:hover { background: #374151; }
.float-pill.collapse {
  padding: 8px 10px;
  color: #93c5fd;
}
</style>