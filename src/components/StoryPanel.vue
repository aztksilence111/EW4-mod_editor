<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Plus, Trash2, Play, Upload, FolderOpen, Check, X, Code, ArrowUp, ArrowDown, Image } from 'lucide-vue-next'
import { api, type Preview } from '../core/editor/api'
import EventConditionTree from './EventConditionTree.vue'
import EventEffects from './EventEffects.vue'
import { createCondition, type EventDocument } from '../core/editor/events'

const props = defineProps<{ revision: number; scenario: string }>()
const emit = defineEmits<{ applied: []; dirty: [value: boolean] }>()
const catalog = ref<any>({ schema: 1, scenes: {}, backgrounds: {}, characters: {}, bindings: {} })
const images = ref<string[]>([])
const sceneId = ref('')
const selected = ref(0)
const busy = ref(false)
const error = ref('')
const saved = ref('')
const preview = ref<Preview | null>(null)
const zipInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const advanced = ref(false)
const json = ref('')
const filter = ref('')
const imagePath = ref('')
const frame = ref<HTMLIFrameElement | null>(null)
const playback = ref<any>(null)
const playing = ref(false)
const eventDocument = ref<EventDocument | null>(null)
const scene = computed<any>(() => catalog.value.scenes?.[sceneId.value])
const step = computed<any>(() => scene.value?.steps?.[selected.value])
const dirty = computed(() => saved.value !== JSON.stringify(catalog.value))
const filteredImages = computed(() => images.value.filter(p => !filter.value || p.toLowerCase().includes(filter.value.toLowerCase())))
watch(dirty, value => emit('dirty', value))
watch(catalog, () => { preview.value = null }, { deep: true })
watch(() => props.revision, () => { preview.value = null; void run(load) }, { immediate: true })
watch(() => [props.revision, props.scenario], async () => { try { eventDocument.value = await api<EventDocument>('events/' + props.scenario) } catch (e) { error.value = String(e) } }, { immediate: true })
async function run(action: () => Promise<void> | void) { if (busy.value) return; busy.value = true; error.value = ''; try { await action() } catch (e) { error.value = e instanceof Error ? e.message : String(e) } finally { busy.value = false } }
async function load() {
  const data = await api<any>('stories')
  catalog.value = data.catalog; images.value = data.images; saved.value = JSON.stringify(data.catalog)
  if (!scene.value) sceneId.value = Object.keys(data.catalog.scenes)[0] ?? ''
  selected.value = 0
}
function unique(base: string, keys: string[]) { let id = base, i = 1; while (keys.includes(id)) id = base + '_' + i++; return id }
function addScene() {
  const id = unique('scene', Object.keys(catalog.value.scenes)); catalog.value.scenes[id] = { schema: 1, id, steps: [{ id: 'line', text: '' }] }
  sceneId.value = id; selected.value = 0
}
function removeScene() {
  const id = sceneId.value
  if (!confirm('删除场景 ' + id + '？')) return
  delete catalog.value.scenes[id]
  for (const binding of Object.values(catalog.value.bindings ?? {}) as any[]) {
    if (binding.openingStory?.scene === id) delete binding.openingStory
    binding.endingStories = (binding.endingStories ?? []).filter((e: any) => e.scene !== id)
  }
  sceneId.value = Object.keys(catalog.value.scenes)[0] ?? ''; selected.value = 0
}
function addStep() { const steps = scene.value.steps; steps.push({ id: unique('line', steps.map((s: any) => s.id)), text: '' }); selected.value = steps.length - 1 }
function removeStep() {
  const id = step.value.id
  if (scene.value.steps.some((s: any) => s.next === id || s.choices?.some((c: any) => c.next === id))) { error.value = '该步骤仍被分支引用，请先修改跳转'; return }
  scene.value.steps.splice(selected.value, 1); selected.value = Math.max(0, selected.value - 1)
}
function renameStep(event: Event) {
  const input = event.target as HTMLInputElement, id = input.value.trim(), old = step.value.id
  if (!/^[\w.-]{1,128}$/.test(id) || scene.value.steps.some((s: any) => s !== step.value && s.id === id)) { input.value = old; error.value = '步骤 ID 无效或重复'; return }
  step.value.id = id
  for (const s of scene.value.steps) { if (s.next === old) s.next = id; for (const c of s.choices ?? []) if (c.next === old) c.next = id }
}
function move(delta: number) { const steps = scene.value.steps, i = selected.value; [steps[i], steps[i + delta]] = [steps[i + delta], steps[i]]; selected.value += delta }
function choice() { const choices = step.value.choices ??= []; choices.push({ id: unique('choice', choices.map((c: any) => c.id)), text: '新选项' }); delete step.value.end; delete step.value.result }
function endStep(event: Event) {
  step.value.end = (event.target as HTMLInputElement).checked
  if (step.value.end) { delete step.value.next; delete step.value.choices } else delete step.value.result
}
function bind(kind: string, event: Event) {
  const id = (event.target as HTMLSelectElement).value
  const binding = catalog.value.bindings[props.scenario] ??= {}
  if (kind === 'opening') { if (id) binding.openingStory = { key: 'opening.' + props.scenario, scene: id }; else delete binding.openingStory }
  else {
    const endings = binding.endingStories ??= []
    const index = endings.findIndex((e: any) => e.outcome === kind && !e.ending)
    if (index >= 0) endings.splice(index, 1)
    if (id) endings.push({ key: 'ending.' + kind + '.' + props.scenario, outcome: kind, scene: id })
  }
}
function binding(kind: string) { const b = catalog.value.bindings[props.scenario]; return kind === 'opening' ? b?.openingStory?.scene ?? '' : b?.endingStories?.find((e: any) => e.outcome === kind && !e.ending)?.scene ?? '' }
function addBackground() { if (!imagePath.value) return; const id = unique('background', Object.keys(catalog.value.backgrounds)); catalog.value.backgrounds[id] = imagePath.value; if (step.value) step.value.background = id }
function addCharacter() {
  if (!imagePath.value) return
  const id = unique('character', Object.keys(catalog.value.characters)); catalog.value.characters[id] = { name: '新角色', poses: { standing: { width: 800, height: 1200, image: imagePath.value } } }
}
function addActor() {
  const character = Object.keys(catalog.value.characters)[0]; if (!character || !step.value) return
  const actors = step.value.actors ??= []; actors.push({ id: unique('actor', actors.map((a: any) => a.id)), character, slot: 'center' })
}
function addAnimation() { const animations = step.value.animations ??= []; animations.push({ actor: step.value.actors?.[0]?.id ?? '', type: 'hop', durationMs: 300, amplitude: 12, wait: true }) }
async function fileBase64(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(Error('素材读取失败')); reader.readAsDataURL(file) }) }
async function importFiles(event: Event, zipped: boolean) {
  const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []); input.value = ''
  if (!files.length) return
  if (dirty.value && !confirm('导入素材后将重新载入已应用工程，放弃当前未保存的剧情修改？')) return
  preview.value = null
  const request: any = { revision: props.revision, taskId: crypto.randomUUID() }
  if (zipped) { if (files[0]!.size > 256 * 1024 * 1024) throw Error('ZIP 最大为 256 MiB'); request.package = await fileBase64(files[0]!) }
  else {
    if (files.length > 4096 || files.reduce((n, f) => n + f.size, 0) > 256 * 1024 * 1024) throw Error('素材超过 4096 文件 / 256 MiB')
    request.files = {}; for (const f of files) request.files[f.webkitRelativePath || f.name] = await fileBase64(f)
  }
  preview.value = await api<Preview>('stories-preview', request)
}
async function makePreview() { preview.value = null; preview.value = await api<Preview>('stories-preview', { revision: props.revision, taskId: crypto.randomUUID(), catalog: catalog.value }) }
async function apply() { const p = preview.value; if (!p) return; await api('apply', { revision: p.revision, taskId: p.taskId, token: p.token }); preview.value = null; emit('applied') }
async function play() {
  playback.value = await api('story-play', { revision: props.revision, scenario: props.scenario, scene: sceneId.value, catalog: catalog.value }); playing.value = true
}
function message(event: MessageEvent) { if (event.origin === location.origin && event.source === frame.value?.contentWindow && event.data?.type === 'ew4-story-ready' && playback.value) frame.value.contentWindow?.postMessage(JSON.parse(JSON.stringify({ type: 'ew4-story-start', ...playback.value })), location.origin) }
function folder() {
  const native = (window as any).ew4Native
  if (!native) { folderInput.value?.click(); return }
  if (dirty.value && !confirm('导入素材后将重新载入已应用工程，放弃当前未保存的剧情修改？')) return
  native.chooseFolder(props.revision)
}
function folderPreview(event: Event) { const reply = (event as CustomEvent).detail; const body = JSON.parse(reply.body); if (reply.status !== 200) error.value = body.error; else preview.value = body }
onMounted(() => { window.addEventListener('message', message); window.addEventListener('ew4-folder-preview', folderPreview) })
onBeforeUnmount(() => { window.removeEventListener('message', message); window.removeEventListener('ew4-folder-preview', folderPreview); emit('dirty', false) })
function toggleJson() { json.value = JSON.stringify(catalog.value, null, 2); advanced.value = !advanced.value }
function applyJson() { const data = JSON.parse(json.value); if (data.schema !== 1 || !data.scenes || !data.characters || !data.backgrounds) throw Error('剧情目录结构无效'); catalog.value = data; advanced.value = false; if (!scene.value) sceneId.value = Object.keys(data.scenes)[0] ?? '' }
</script>

<template>
  <div class="story-editor" :aria-busy="busy">
    <div class="actions">
      <button :disabled="busy" @click="zipInput?.click()"><Upload :size="16" />导入素材 ZIP</button><button :disabled="busy" @click="folder"><FolderOpen :size="16" />导入素材文件夹</button>
      <input ref="zipInput" hidden type="file" accept=".zip,.ew4mod,application/zip" @change="run(() => importFiles($event, true))" /><input ref="folderInput" hidden type="file" webkitdirectory multiple @change="run(() => importFiles($event, false))" />
      <button :disabled="busy" title="编辑完整剧情 JSON" @click="toggleJson"><Code :size="16" /></button>
      <button :disabled="busy || !scene" @click="run(play)"><Play :size="16" />播放预览</button><button :disabled="busy || !Object.keys(catalog.scenes).length" @click="run(makePreview)"><Check :size="16" />校验修改</button>
      <span>{{ dirty ? '未保存' : '已保存' }} · {{ images.length }} 张素材</span>
    </div>
    <div v-if="error" class="error" role="alert">{{ error }}</div>
    <div v-if="preview" class="diff">
      <div class="actions"><strong>{{ preview.count }} 个文件变更</strong><button :disabled="busy || !preview.count" @click="run(apply)"><Check :size="16" />应用到 R 版工程</button><button title="取消预览" @click="preview = null"><X :size="16" /></button></div>
      <ul><li v-for="d in preview.changes" :key="d.file">{{ d.file }}</li></ul>
    </div>
    <div v-if="advanced" class="json-editor"><textarea v-model="json" aria-label="完整剧情 JSON" spellcheck="false" /><button @click="run(applyJson)"><Check :size="16" />载入 JSON</button></div>
    <div class="bindings"><label v-for="(label, kind) in { opening: '开局剧情', victory: '胜利剧情', defeat: '失败剧情' }" :key="kind">{{ label }} · {{ scenario }}<select :value="binding(kind)" :aria-label="label" @change="bind(kind, $event)"><option value="">无</option><option v-for="id in Object.keys(catalog.scenes)" :key="id">{{ id }}</option></select></label></div>
    <div class="story-columns">
      <aside class="scene-list"><div class="actions"><h3>场景</h3><button title="新增场景" @click="addScene"><Plus :size="16" /></button><button title="删除场景" :disabled="!scene" @click="removeScene"><Trash2 :size="16" /></button></div>
        <select v-model="sceneId" aria-label="剧情场景" @change="selected = 0"><option v-for="id in Object.keys(catalog.scenes)" :key="id">{{ id }}</option></select>
        <ol><li v-for="(s, index) in scene?.steps" :key="index"><button :class="{ active: selected === index }" @click="selected = Number(index)"><span>{{ s.id }}</span><small>{{ s.text || s.textKey || '空台词' }}</small></button></li></ol>
        <div class="actions"><button title="新增步骤" :disabled="!scene" @click="addStep"><Plus :size="16" /></button><button title="删除步骤" :disabled="!step || scene.steps.length <= 1" @click="removeStep"><Trash2 :size="16" /></button><button title="上移步骤" :disabled="!step || selected === 0" @click="move(-1)"><ArrowUp :size="16" /></button><button title="下移步骤" :disabled="!step || selected === scene.steps.length - 1" @click="move(1)"><ArrowDown :size="16" /></button></div>
      </aside>
      <main v-if="step" class="step-editor">
        <div class="fields"><label>步骤 ID<input :value="step.id" aria-label="剧情步骤 ID" @change="renameStep" /></label><label>背景<select v-model="step.background" aria-label="剧情背景"><option :value="undefined">继承</option><option v-for="(_, id) in catalog.backgrounds" :key="id">{{ id }}</option></select></label><label>说话演员<input v-model="step.speaker" aria-label="说话演员" /></label><label>姓名覆盖<input v-model="step.name" aria-label="剧情姓名" /></label></div>
        <label>台词<textarea v-model="step.text" aria-label="剧情台词" rows="5" maxlength="16000" /></label><label v-if="step.textKey">共享文本键<input v-model="step.textKey" /></label>
        <div class="fields"><label>后续步骤<select v-model="step.next" :disabled="step.end" aria-label="后续步骤"><option :value="undefined">顺序播放</option><option v-for="s in scene.steps.filter((s: any) => s !== step)" :key="s.id">{{ s.id }}</option></select></label><label>等待毫秒<input v-model.number="step.waitMs" type="number" min="0" max="60000" aria-label="剧情等待毫秒" /></label><label class="toggle"><input type="checkbox" :checked="step.end" @change="endStep" />结束场景</label><label v-if="step.end">结果 ID<input v-model="step.result" aria-label="剧情结果 ID" /></label></div>
        <div class="actions"><h3>演员</h3><button title="新增演员" :disabled="!Object.keys(catalog.characters).length" @click="addActor"><Plus :size="16" /></button><label class="toggle"><input v-model="step.clearActors" type="checkbox" />清场</label></div>
        <div v-for="(actor, i) in step.actors" :key="i" class="actor fields"><label>演员 ID<input v-model="actor.id" /></label><label>角色<select v-model="actor.character" @change="delete actor.pose; delete actor.expression; delete actor.parts"><option v-for="(c, id) in catalog.characters" :key="id" :value="id">{{ c.name }} · {{ id }}</option></select></label><label>动作<select v-model="actor.pose"><option :value="undefined">默认</option><option v-for="(_, id) in catalog.characters[actor.character]?.poses" :key="id">{{ id }}</option></select></label><label>站位<select v-model="actor.slot"><option v-for="(label, id) in { left: '左', midLeft: '中左', center: '中', midRight: '中右', right: '右' }" :key="id" :value="id">{{ label }}</option></select></label><label class="toggle"><input v-model="actor.mirror" type="checkbox" />镜像</label><button title="删除演员" @click="step.actors.splice(i, 1)"><Trash2 :size="15" /></button></div>
        <div class="actions"><h3>选项分支</h3><button title="新增剧情选项" @click="choice"><Plus :size="16" /></button></div>
        <div v-for="(c, i) in step.choices" :key="i" class="choice"><div class="fields"><label>ID<input v-model="c.id" /></label><label>文字<input v-model="c.text" /></label><label>跳转<select v-model="c.next"><option :value="undefined">顺序播放</option><option v-for="s in scene.steps.filter((s: any) => s !== step)" :key="s.id">{{ s.id }}</option></select></label><button title="删除剧情选项" @click="step.choices.splice(i, 1)"><Trash2 :size="15" /></button></div><details v-if="eventDocument"><summary>条件与效果</summary><label class="toggle"><input type="checkbox" :checked="!!c.condition" @change="($event.target as HTMLInputElement).checked ? c.condition = createCondition() : delete c.condition" />限制选项条件</label><EventConditionTree v-if="c.condition" :node="c.condition" :document="eventDocument" :event-ids="eventDocument.events.map(e => e.id)" :cells="[]" /><EventEffects :effects="c.effects ?? (c.effects = [])" :document="eventDocument" :event-ids="eventDocument.events.map(e => e.id)" :cells="[]" /></details></div>
        <div class="actions"><h3>动画</h3><button title="新增剧情动画" @click="addAnimation"><Plus :size="16" /></button></div>
        <div v-for="(animation, i) in step.animations" :key="i" class="fields actor"><label>演员 ID<input v-model="animation.actor" /></label><label>类型<select v-model="animation.type"><option v-for="(label, id) in { hop: '跳动', shake: '晃动', move: '移动', fade: '淡入' }" :key="id" :value="id">{{ label }}</option></select></label><label>毫秒<input v-model.number="animation.durationMs" type="number" min="1" max="60000" /></label><label>幅度<input v-model.number="animation.amplitude" type="number" min="0" /></label><label v-if="animation.type === 'move'">横向偏移<input v-model.number="animation.x" type="number" /></label><label v-if="animation.type === 'move'">纵向偏移<input v-model.number="animation.y" type="number" /></label><label class="toggle"><input v-model="animation.wait" type="checkbox" />等待动画</label><button title="删除剧情动画" @click="step.animations.splice(i, 1)"><Trash2 :size="15" /></button></div>
      </main>
      <aside class="media-editor"><h3>共享素材</h3><input v-model="filter" aria-label="筛选剧情素材" placeholder="筛选素材路径" /><select v-model="imagePath" aria-label="剧情素材"><option value="">选择 PNG</option><option v-for="path in filteredImages" :key="path">{{ path }}</option></select>
        <img v-if="imagePath" class="media-image" :src="'/editor-api/story-image?path=' + encodeURIComponent(imagePath) + '&revision=' + revision" alt="素材预览" />
        <div class="actions"><button :disabled="!imagePath" @click="addBackground"><Image :size="15" />背景</button><button :disabled="!imagePath" @click="addCharacter"><Plus :size="15" />角色</button></div>
        <label v-for="(c, id) in catalog.characters" :key="id">{{ id }}<input v-model="c.name" :aria-label="'角色姓名 ' + id" /></label>
        <label v-for="(path, id) in catalog.backgrounds" :key="id">{{ id }}<select v-model="catalog.backgrounds[id]"><option v-for="p in images" :key="p">{{ p }}</option></select></label>
      </aside>
    </div>
    <div v-if="playing" class="playback" role="dialog" aria-label="剧情播放预览"><iframe ref="frame" src="/story-preview.html" title="剧情播放器" /><button title="关闭剧情预览" @click="playing = false; playback = null"><X :size="20" /></button></div>
  </div>
</template>

<style scoped>
.story-editor{display:flex;flex-direction:column;gap:12px;padding:14px;min-height:0;color:#253237}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.actions span{font-size:12px;color:#60716b}h3{font-size:14px;margin:0 8px 0 0}button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:34px;border:1px solid #bcc9c9;border-radius:4px;padding:5px 9px;background:#f8faf9;color:#253237;cursor:pointer}button:disabled{opacity:.45;cursor:default}button.active{background:#236d59;color:white}.bindings,.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.fields{grid-template-columns:repeat(2,minmax(0,1fr))}label{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}input,select,textarea{width:100%;min-width:0;max-width:100%;box-sizing:border-box;padding:7px;border:1px solid #bcc9c9;border-radius:4px;font:13px system-ui;background:white;color:#253237}textarea{resize:vertical}.toggle{flex-direction:row;align-items:center}.toggle input{width:auto}.story-columns{display:grid;grid-template-columns:190px minmax(0,1fr) 240px;gap:16px}.scene-list,.step-editor,.media-editor{display:flex;flex-direction:column;gap:10px;min-width:0}.scene-list ol{list-style:none;padding:0;margin:0;max-height:55vh;overflow:auto}.scene-list li button{width:100%;display:flex;align-items:start;flex-direction:column;text-align:left;margin-bottom:4px}.scene-list small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.actor,.choice{border-top:1px solid #ccd6d2;padding-top:10px}.media-image{width:100%;height:140px;object-fit:contain;background:#e8edeb}.error{color:#a82c24;overflow-wrap:anywhere}.diff{border-block:1px solid #a7c9b8;padding:10px 0}.diff ul{max-height:160px;overflow:auto;font-size:12px;overflow-wrap:anywhere}.json-editor textarea{height:50vh;font-family:monospace}.playback{position:fixed;inset:0;z-index:200;background:#101416}.playback iframe{width:100%;height:100%;border:0}.playback>button{position:absolute;right:10px;top:64px;background:#eee;z-index:201}.media-editor select{font-size:11px}
@media(max-width:1000px){.story-columns{grid-template-columns:150px minmax(0,1fr)}.media-editor{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.media-editor h3{grid-column:1/-1}}@media(max-width:600px){.story-editor{padding:10px}.story-columns{grid-template-columns:minmax(0,1fr)}.scene-list ol{max-height:140px}.bindings{grid-template-columns:minmax(0,1fr)}.media-editor{display:flex}.playback>button{top:60px}.fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
<style scoped>
.story-editor{flex:1;overflow:auto}.story-editor>*{flex-shrink:0}summary{cursor:pointer;font-size:12px;margin:8px 0}
</style>
