<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api, download, type Preview } from '../core/editor/api'

interface Module { key: string; name: string; path: string; guide: string; initial: unknown }
interface Rules { revision: number; apiVersion: number; engineSource: string; manifest: Record<string, unknown>; modules: Module[]; files: { path: string; modified: boolean; bytes: number }[] }
const props = defineProps<{ revision: number; disabled: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const model = ref<Rules | null>(null)
const drafts = ref<Record<string, string | null>>({})
const path = ref('rewrite/extension.json')
const text = ref('')
const moduleKey = ref('unitLayers')
const filter = ref('')
const newPath = ref('rewrite/custom-rules.json')
const preview = ref<Preview | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const guides = ref<Record<string, string>>({})
const guideOpen = ref(false)
const examples = ref<{ id: string; name: string; files: Record<string, string> }[]>([])
const exampleId = ref('unit-layers')
const activeModule = computed(() => model.value?.modules.find(m => m.key === moduleKey.value))
const guide = computed(() => guides.value[activeModule.value?.guide ?? ''] ?? '')
const dirtyCount = computed(() => Object.keys(drafts.value).length)
const paths = computed(() => [...new Set([...(model.value?.files.map(f => f.path) ?? []), ...Object.keys(drafts.value)])].filter(p => !filter.value || p.toLowerCase().includes(filter.value.toLowerCase())))
const png = computed(() => path.value.endsWith('.png'))
let reading = 0
function encode(value: string) {
  const bytes = new TextEncoder().encode(value); let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
function decode(value: string) { return new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))) }
function updateText(value: string) { text.value = value; drafts.value[path.value] = encode(value); preview.value = null }
async function run(action: () => Promise<void>) {
  if (busy.value || props.disabled) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false }
}
async function load() {
  model.value = await api<Rules>('rules')
  if (!dirtyCount.value) await selectFile(path.value)
  else notice.value = '工程修订已变化，保留本地规则草稿；重新预览时会按当前工程校验。'
}
async function selectFile(next: string) {
  const token = ++reading
  const draft = drafts.value[next]
  if (draft !== undefined) { path.value = next; text.value = draft === null || next.endsWith('.png') ? '' : decode(draft); return }
  const file = await api<{ text: string | null }>('rule-file?path=' + encodeURIComponent(next))
  if (token !== reading) return
  path.value = next; text.value = file.text ?? ''
}
async function addModule() {
  const module = activeModule.value
  if (!module || !model.value) return
  const existing = drafts.value['rewrite/extension.json']
  const manifest = existing ? JSON.parse(decode(existing)) : JSON.parse(JSON.stringify(model.value.manifest))
  const registered = manifest[module.key]
  if (registered) { await selectFile(Array.isArray(registered) ? registered[0] : registered); return }
  manifest.schema = 1; manifest.apiVersion = 3
  manifest[module.key] = ['skills', 'statuses'].includes(module.key) ? [module.path] : module.path
  drafts.value['rewrite/extension.json'] = encode(JSON.stringify(manifest, null, 2))
  drafts.value[module.path] = encode(JSON.stringify(module.initial, null, 2))
  preview.value = null; filter.value = ''; await selectFile(module.path)
  notice.value = '已加入本地草稿及扩展注册。请参考接口说明配置，预览通过后再应用。'
}
async function createFile() {
  if (!/^(rewrite|legacy|client|frontend)\/.+\.(json|lua)$/.test(newPath.value)) throw new Error('请输入合法的规则资源相对路径，例如 rewrite/custom-rules.json')
  if (paths.value.includes(newPath.value)) throw new Error('文件已存在，请从列表选择')
  drafts.value[newPath.value] = encode(newPath.value.endsWith('.json') ? '{}' : '-- Lua rules\n')
  preview.value = null; filter.value = ''; await selectFile(newPath.value)
}
async function addExample() {
  const example = examples.value.find(e => e.id === exampleId.value)
  if (!example || !model.value) return
  const incoming = { ...example.files }
  const current = drafts.value['rewrite/extension.json']
  const manifest = current ? JSON.parse(decode(current)) : JSON.parse(JSON.stringify(model.value.manifest))
  const added = JSON.parse(decode(incoming['rewrite/extension.json']!))
  for (const [key, value] of Object.entries(added)) {
    if (key === 'schema' || key === 'apiVersion') continue
    manifest[key] = Array.isArray(value) ? [...new Set([...(manifest[key] ?? []), ...value])] : value
  }
  manifest.schema = 1; manifest.apiVersion = 3
  incoming['rewrite/extension.json'] = encode(JSON.stringify(manifest, null, 2))
  Object.assign(drafts.value, incoming); preview.value = null; filter.value = ''
  await selectFile(Object.keys(incoming).find(p => p !== 'rewrite/extension.json' && p.endsWith('.json')) ?? 'rewrite/extension.json')
  notice.value = '已将示例放入本地草稿，同名文件按示例替换；请预览后应用。示例以 conquest1 / 法国为演示目标，使用前调整剧本、国家和格号。'
}
async function importFiles(event: Event) {
  const input = event.target as HTMLInputElement; const files = [...(input.files ?? [])]; input.value = ''
  const incoming: Record<string, string> = {}
  for (const file of files) {
    if (file.size > 4 * 1024 * 1024) throw new Error('单个规则资源不能超过 4 MiB')
    const target = file.name === 'extension.json' ? 'rewrite/extension.json'
      : files.length === 1 ? newPath.value : 'rewrite/' + file.name
    if (!/^(rewrite|legacy|client|frontend)\/.+\.(json|lua|png)$/.test(target)) throw new Error('目标路径须为受支持的 JSON / Lua / PNG 规则资源')
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    if (incoming[target]) throw new Error('导入路径重复: ' + target)
    incoming[target] = btoa(binary)
  }
  Object.assign(drafts.value, incoming); preview.value = null
  const target = Object.keys(incoming)[0]; if (target) { filter.value = ''; await selectFile(target) }
}
async function makePreview() {
  const signature = JSON.stringify(drafts.value)
  const result = await api<Preview>('rules-preview', { revision: props.revision, taskId: crypto.randomUUID(), files: drafts.value })
  if (signature !== JSON.stringify(drafts.value)) throw new Error('规则草稿已变化，请重新预览')
  preview.value = result; notice.value = '文件、资源依赖及游戏引擎开局校验通过。'
}
async function apply() {
  const candidate = preview.value; if (!candidate) return
  await api('apply', { revision: candidate.revision, taskId: candidate.taskId, token: candidate.token })
  drafts.value = {}; preview.value = null; emit('changed'); await load(); notice.value = '扩展规则已应用，纳入作者工程及导出。'
}
function saveFile() {
  const draft = drafts.value[path.value]
  const bytes = draft && png.value ? Uint8Array.from(atob(draft), c => c.charCodeAt(0)) : new TextEncoder().encode(text.value)
  download(new Blob([bytes]), path.value.split('/').at(-1)!)
}
async function discard() { drafts.value = {}; preview.value = null; await load() }
watch(() => props.revision, () => { preview.value = null; void run(load) }, { immediate: true })
watch(() => props.disabled, disabled => { if (!disabled && model.value?.revision !== props.revision) void run(load) })
void fetch('/rule-guides.json').then(r => r.ok ? r.json() : {}).then(value => { guides.value = value }).catch(() => {})
void fetch('/rule-examples.json').then(r => r.ok ? r.json() : []).then(value => { examples.value = value }).catch(() => {})
</script>

<template>
  <section class="rule-workbench" aria-label="扩展规则工作区" :aria-busy="busy">
    <p>API {{ model?.apiVersion ?? 3 }} · {{ model?.engineSource }}。编辑完整 JSON / Lua 规则及图片资源；应用前使用当前 R 引擎检查资源与开局。</p>
    <div class="rule-actions"><select v-model="moduleKey" aria-label="扩展模块" :disabled="busy || disabled"><option v-for="module in model?.modules" :key="module.key" :value="module.key">{{ module.name }}</option></select><button :disabled="busy || disabled" @click="run(addModule)">打开 / 添加模块</button><button @click="guideOpen = !guideOpen">接口说明</button></div>
    <div class="rule-actions"><select v-model="exampleId" aria-label="规则示例"><option v-for="example in examples" :key="example.id" :value="example.id">{{ example.name }}</option></select><button :disabled="busy || disabled || !examples.length" @click="run(addExample)">放入示例草稿</button></div>
    <pre v-if="guideOpen" class="guide">{{ guide || '接口说明未载入，可参考随版本发布的 Mod 接口文档。' }}</pre>
    <p v-if="error" class="error" role="alert">{{ error }}</p><p v-else-if="busy || notice" role="status">{{ busy ? '正在校验与处理…' : notice }}</p>
    <div class="rule-layout">
      <aside><input v-model="filter" type="search" aria-label="搜索规则文件" placeholder="文件路径 / 模块名" /><select :value="path" size="14" aria-label="规则文件" :disabled="busy || disabled" @change="run(() => selectFile(($event.target as HTMLSelectElement).value))"><option v-for="file in paths" :key="file" :value="file">{{ file }}{{ file in drafts ? ' *' : '' }}</option></select></aside>
      <div class="rule-editor"><strong>{{ path }}{{ path in drafts ? ' · 本地草稿' : '' }}</strong><textarea v-if="!png" :value="text" aria-label="规则文件内容" spellcheck="false" :disabled="busy || disabled" @input="updateText(($event.target as HTMLTextAreaElement).value)" /><p v-else>PNG 素材已加入本地草稿，应用时校验图片格式。</p><div class="rule-actions"><button :disabled="busy || disabled || png" @click="run(async () => updateText(JSON.stringify(JSON.parse(text), null, 2)))">格式化 JSON</button><button :disabled="busy || disabled || png" @click="saveFile">保存此文件</button><button :disabled="busy || disabled" @click="drafts[path] = null; preview = null; notice = '已暂存恢复基线 / 移除覆盖文件，引用此文件的注册也需同步调整。'">恢复此文件基线</button></div></div>
    </div>
    <div class="rule-actions"><input v-model="newPath" aria-label="新规则文件路径" placeholder="rewrite/custom-rules.json" /><button :disabled="busy || disabled" @click="run(createFile)">新建文件</button><label>导入 JSON / Lua / PNG<input type="file" accept=".json,.lua,.png" multiple :disabled="busy || disabled" @change="run(() => importFiles($event))" /></label></div>
    <p>单文件导入使用上方目标路径；多文件导入放入 rewrite/，extension.json 保持为扩展注册表。完整目录资源包可在“验证导出”导入 .ew4mod。未应用草稿在切换分类时保留；关闭页面前请保存文件或应用。</p>
    <div class="rule-actions"><span>{{ dirtyCount }} 份草稿</span><button :disabled="busy || disabled || !dirtyCount" @click="run(makePreview)">校验并预览规则</button><button :disabled="busy || disabled || !preview?.count" @click="run(apply)">应用规则修改</button><button :disabled="busy || disabled || !dirtyCount" @click="run(discard)">放弃本地草稿</button></div>
    <ul v-if="preview"><li v-for="change in preview.changes" :key="change.file">{{ change.file }} · {{ change.before }} → {{ change.after }}</li></ul>
  </section>
</template>

<style scoped>
.rule-workbench { display:flex; flex-direction:column; gap:12px; min-height:0; flex:1; padding:16px 24px; overflow:auto; color:#253237; }p { margin:0; font-size:12px; line-height:1.6; }.rule-actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }.rule-layout { display:grid; grid-template-columns:minmax(160px,260px) minmax(0,1fr); gap:12px; min-height:350px; }aside,.rule-editor { display:flex; flex-direction:column; gap:8px; min-width:0; }textarea { flex:1; min-height:320px; font:13px/1.6 Consolas,monospace; tab-size:2; resize:vertical; }input,select,button,textarea { box-sizing:border-box; min-width:0; max-width:100%; border:1px solid #bcc9c9; border-radius:5px; padding:8px; background:white; color:#253237; }aside select { flex:1; width:100%; }strong { overflow-wrap:anywhere; font-size:13px; }button { cursor:pointer; }button:disabled { opacity:.45; cursor:default; }.error { color:#a42f28; }.guide { white-space:pre-wrap; max-height:320px; overflow:auto; background:#edf3ef; padding:12px; font-size:12px; }ul { margin:0; padding-left:20px; font-size:12px; overflow-wrap:anywhere; }label { font-size:12px; }label input { display:block; }@media(max-width:650px) { .rule-workbench { padding:12px; }.rule-layout { grid-template-columns:1fr; }aside select { height:120px; }.rule-editor textarea { min-height:300px; } }
</style>
<style scoped>
.rule-workbench > * { flex-shrink: 0; }
.rule-layout { flex: none; }
@media (max-width: 650px) {
  .rule-layout { min-height: 0; }
  aside select { flex: none; height: 120px; }
  .rule-editor textarea { flex: none; height: 360px; }
}
</style>
