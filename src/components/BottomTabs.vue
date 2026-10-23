<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  active: string
}>()

const emit = defineEmits<{
  (e: 'change', tab: string): void
}>()

const ALL_TABS = [
  { key: 'edit', label: '编辑' },
  { key: 'legion', label: '战役军团' },
  { key: 'event', label: '战役事件' },
  { key: 'config', label: '配置文件' },
]

const collapsed = ref(false)

try {
  const saved = localStorage.getItem('ew4-bottomtabs-collapsed')
  if (saved === 'true') collapsed.value = true
} catch {}

watch(collapsed, (v) => {
  try { localStorage.setItem('ew4-bottomtabs-collapsed', String(v)) } catch {}
})
</script>

<template>
  <!-- ==================== 展开状态：完整底栏 ==================== -->
  <nav v-if="!collapsed" class="tabs">
    <button
      class="tab collapse"
      title="收起底部栏"
      @click="collapsed = true"
    >◀</button>
    <button
      v-for="t in ALL_TABS"
      :key="t.key"
      class="tab"
      :class="{ active: props.active === t.key }"
      @click="emit('change', t.key)"
    >
      {{ t.label }}
    </button>
  </nav>

  <!-- ==================== 折叠状态：右下角浮层 ==================== -->
  <div v-else class="float-bottom-right">
    <button
      class="float-pill collapse"
      title="展开底部栏"
      @click="collapsed = false"
    >◀</button>
    <button
      class="float-pill"
      :class="{ active: props.active === 'edit' }"
      @click="emit('change', 'edit')"
    >编辑</button>
  </div>
</template>

<style scoped>
/* ================ 展开状态 ================ */
.tabs {
  position: relative;
  z-index: 60;
  display: flex;
  overflow-x: auto;
  background: #1f2937;
  border-top: 1px solid #374151;
  padding-bottom: env(safe-area-inset-bottom);
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
  flex: 1 0 auto;
  min-width: 64px;
  padding: 11px 10px;
  border: none;
  background: transparent;
  color: #9ca3af;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.tab.active {
  color: #fff;
  background: #2563eb;
}
.tab.collapse {
  flex: 0 0 auto;
  min-width: 40px;
  max-width: 40px;
  color: #93c5fd;
  font-size: 12px;
  border-right: 1px solid #374151;
}
.tab.collapse:hover { background: #374151; }

/* ================ 折叠状态：右下角浮层 ================ */
.float-bottom-right {
  position: fixed;
  bottom: calc(8px + env(safe-area-inset-bottom));
  right: 8px;
  display: flex;
  gap: 6px;
  z-index: 100;
  align-items: center;
}
.float-pill {
  padding: 10px 14px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(31, 41, 55, 0.92);
  color: #e5e7eb;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  line-height: 1;
}
.float-pill:hover { background: #374151; }
.float-pill.collapse {
  padding: 10px 12px;
  color: #93c5fd;
}
.float-pill.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
</style>