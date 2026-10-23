<script setup lang="ts">
import {
  editorConfig,
  setActualCommander,
  setActualBuilding,
  setActualUnit,
  setTerrainMode,
  setTerrainAlpha,
} from '../core/data/config'

type TerrainMode = 'simple' | 'text' | 'image'

function onTerrainModeChange(mode: TerrainMode) {
  setTerrainMode(mode)
}
function onTerrainAlphaChange(e: Event) {
  setTerrainAlpha(parseFloat((e.target as HTMLInputElement).value))
}

const emit = defineEmits<{
  (e: 'close'): void
}>()

const d = editorConfig.value.display
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span>实际显示</span>
        <button class="close" @click="emit('close')">×</button>
      </div>
      <div class="body">
        <p class="hint">
          图片需放在编辑器同目录的 <code>assets/</code> 下。找不到则自动降级为文字/符号。
        </p>

        <div class="terrain-block">
          <div class="terrain-title">地形显示模式</div>
          <div class="terrain-modes">
            <label class="mode-btn" :class="{ active: d.terrainMode === 'simple' }">
              <input type="radio" name="tmod" value="simple"
                     :checked="d.terrainMode === 'simple'"
                     @change="onTerrainModeChange('simple')" />
              简易地形
            </label>
            <label class="mode-btn" :class="{ active: d.terrainMode === 'text' }">
              <input type="radio" name="tmod" value="text"
                     :checked="d.terrainMode === 'text'"
                     @change="onTerrainModeChange('text')" />
              文字地形
            </label>
            <label class="mode-btn" :class="{ active: d.terrainMode === 'image' }">
              <input type="radio" name="tmod" value="image"
                     :checked="d.terrainMode === 'image'"
                     @change="onTerrainModeChange('image')" />
              实际地形
            </label>
          </div>
          <div class="terrain-alpha">
            <span>透明度</span>
            <input type="range" min="0" max="1" step="0.05"
                   :value="d.terrainAlpha"
                   @input="onTerrainAlphaChange" />
            <span class="alpha-value">{{ d.terrainAlpha.toFixed(2) }}</span>
          </div>
        </div>

        <label class="row">
          <input
            type="checkbox"
            :checked="d.actualCommander"
            @change="(e) => setActualCommander((e.target as HTMLInputElement).checked)"
          />
          <div>
            <div class="title">将领小头像</div>
            <div class="desc">替换兵牌上的金色 G</div>
          </div>
        </label>

        <label class="row">
          <input
            type="checkbox"
            :checked="d.actualBuilding"
            @change="(e) => setActualBuilding((e.target as HTMLInputElement).checked)"
          />
          <div>
            <div class="title">实际建筑</div>
            <div class="desc">替换黑底方块，并显示等级图标</div>
          </div>
        </label>

        <label class="row">
          <input
            type="checkbox"
            :checked="d.actualUnit"
            @change="(e) => setActualUnit((e.target as HTMLInputElement).checked)"
          />
          <div>
            <div class="title">实际兵牌</div>
            <div class="desc">替换圆形文字，保留阵营底色</div>
          </div>
        </label>
      </div>
    </div>
  </div>
</template>

.terrain-block {
  margin: 10px 0 6px;
  padding: 10px;
  border: 1px solid #374151;
  border-radius: 6px;
  background: #111827;
}
.terrain-title {
  color: #93c5fd;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.terrain-modes {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.mode-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid #374151;
  border-radius: 4px;
  background: #0f172a;
  color: #d1d5db;
  font-size: 12px;
  cursor: pointer;
}
.mode-btn.active {
  border-color: #2563eb;
  background: #1e3a8a;
  color: #fff;
}
.mode-btn input {
  margin: 0;
}
.terrain-alpha {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #9ca3af;
}
.terrain-alpha input[type="range"] {
  flex: 1;
}
.alpha-value {
  width: 32px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

<style scoped>
.mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 250;
}
.dialog {
  background: #1f2937; border: 1px solid #374151; border-radius: 8px;
  width: min(420px, 92vw); overflow: hidden;
  box-shadow: 0 12px 32px rgba(0,0,0,0.6);
}
.head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: #111827;
  border-bottom: 1px solid #374151; font-weight: 600; color: #f3f4f6;
}
.close {
  border: none; background: transparent; color: #9ca3af;
  font-size: 22px; padding: 0 6px; cursor: pointer;
}
.close:hover { color: #f87171; }
.body { padding: 12px 14px 16px; }
.hint {
  color: #6b7280; font-size: 11px; line-height: 1.5;
  margin: 0 0 10px;
}
.hint code {
  background: #111827; padding: 1px 4px; border-radius: 3px;
}
.row {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px; border-radius: 6px; cursor: pointer;
  border: 1px solid #374151; margin-bottom: 6px;
}
.row:hover { background: #111827; }
.row input {
  margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0;
}
.title { color: #e5e7eb; font-size: 13px; }
.desc { color: #9ca3af; font-size: 11px; margin-top: 2px; }
</style>