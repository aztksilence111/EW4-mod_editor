<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type Overview } from '../core/editor/api'

const props = defineProps<{ overview: Overview; scenario: string; busy: boolean }>()
const emit = defineEmits<{ create: [request: { id: string; mapId: number; template: string }] }>()
const maps = ref<{ id: number; name: string; width: number; height: number }[]>([])
const mapId = ref(3)
const id = ref('custom_eastasia')
const template = ref(props.scenario)
const error = ref('')
const names: Record<string, string> = { europe: '欧洲', america: '美洲', eastasia: '东亚', japan: '日本', hre: '神圣罗马帝国' }
onMounted(async () => {
  try {
    maps.value = await api('maps')
    if (!maps.value.some(m => m.id === mapId.value)) mapId.value = maps.value[0]?.id ?? 0
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
})
</script>

<template>
  <div class="scenario-create">
    <p>从已配置底图创建空白剧本，无需已有的同地图 BTL。</p>
    <p>复制模板中的国家、阵营和资源配置；领土从无归属开始，不复制城市、部队、事件或扩展。创建后可撤销。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <label>底图<select v-model="mapId" aria-label="新剧本底图" :disabled="busy"><option v-for="map in maps" :key="map.id" :value="map.id">{{ names[map.name] ?? map.name }} · {{ map.width }}×{{ map.height }}</option></select></label>
    <label>新剧本 ID<input v-model="id" aria-label="新剧本 ID" pattern="custom_[A-Za-z0-9_]+" :disabled="busy" /></label>
    <label>国家配置模板<select v-model="template" aria-label="国家配置模板" :disabled="busy"><option v-for="s in overview.scenarios" :key="s.id" :value="s.id">{{ s.name }} · {{ s.id }}</option></select></label>
    <p>新剧本按战役模式创建，第一个非中立国家设为玩家；请继续分配领土和部署，再检查导出文件。</p>
    <button :disabled="busy || !maps.length || !/^custom_[A-Za-z0-9_]+$/.test(id) || !template" @click="emit('create', { id, mapId, template })">创建空白剧本</button>
  </div>
</template>

<style scoped>
.scenario-create { display:flex; flex-direction:column; gap:12px; padding:14px; overflow:auto; }
p { margin:0; font-size:12px; line-height:1.6; }label { display:flex; flex-direction:column; gap:6px; font-size:12px; }input,select,button { padding:8px; border:1px solid #b8c8bf; border-radius:5px; max-width:100%; min-width:0; }button { background:#236d59; color:white; cursor:pointer; }button:disabled { opacity:.45; cursor:default; }
</style>
