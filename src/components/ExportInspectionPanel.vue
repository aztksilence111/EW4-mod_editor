<script setup lang="ts">
import { ref } from 'vue'
import { api, download } from '../core/editor/api'

interface Report {
  valid: boolean; scenarios: number; sha256: string; baseline: string; revision: number
  issues: { severity: string; file: string; stage: string; code: string; message: string }[]
}
const busy = ref(false)
const error = ref('')
const name = ref('')
const report = ref<Report | null>(null)
const mode = ref('auto')
async function inspect(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]; input.value = ''
  if (!file || busy.value) return
  name.value = file.name; report.value = null; error.value = ''; busy.value = true
  try {
    if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('请选择非空、20 MiB 以内的文件')
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    report.value = await api<Report>('inspect-export', { name: file.name, data: btoa(binary), mode: mode.value })
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
function saveReport() {
  download(new Blob([JSON.stringify({ name: name.value, ...report.value }, null, 2)], { type: 'application/json' }), name.value + '.check.json')
}
</script>

<template>
  <section class="export-inspection" aria-label="检查导出文件" :aria-busy="busy">
    <h3>检查导出文件</h3>
    <p>选择已导出的 BTL、资源 ZIP 或 .ew4mod，检查文件结构、资源引用和引擎开局；检查不会导入或修改当前工程。</p>
    <label>单个 BTL 模式<select v-model="mode" aria-label="BTL 检查模式" :disabled="busy" @change="report = null"><option value="auto">自动（原文件名优先，否则按玩家配置判断）</option><option value="campaign">战役</option><option value="conquest">征服</option></select></label>
    <label class="file-button">{{ busy ? '正在检查…' : '选择文件并检查' }}<input type="file" aria-label="检查导出文件" accept=".btl,.zip,.ew4mod" :disabled="busy" @change="inspect" /></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="report" class="report" aria-live="polite">
      <strong>{{ name }}：{{ report.valid ? '检查通过' : '检查未通过' }}</strong>
      <p>{{ report.issues.filter(i => i.severity === 'error').length }} 个错误 · {{ report.issues.filter(i => i.severity === 'warning').length }} 个提示 · {{ report.scenarios }} 个剧本</p>
      <ul><li v-for="(issue, i) in report.issues" :key="i" :class="issue.severity"><strong>{{ issue.severity === 'error' ? '错误' : '提示' }}</strong> · {{ issue.file }} · {{ issue.stage }}<br />{{ issue.message }} <small>({{ issue.code }})</small></li></ul>
      <p>检查基于当前编辑器的游戏资源和引擎版本，未包含的资源使用基线补齐。通过表示本次检查未发现错误；画面效果及后续回合仍需试玩确认。</p>
      <button @click="saveReport">保存检查报告</button>
    </div>
  </section>
</template>

<style scoped>
.export-inspection { display:flex; flex-direction:column; gap:10px; border-top:1px solid #c9d5ce; padding-top:12px; }h3,p { margin:0; }p,li { font-size:12px; line-height:1.6; }h3 { font-size:14px; }.file-button,button { border:1px solid #b8c8bf; border-radius:5px; padding:8px; cursor:pointer; background:#f8faf7; color:#22382f; }.file-button { display:flex; flex-direction:column; gap:8px; }input { max-width:100%; }ul { padding-left:18px; max-height:280px; overflow:auto; }li { margin:8px 0; overflow-wrap:anywhere; }.error { color:#a42f28; }.warning { color:#795315; }.report { display:flex; flex-direction:column; gap:8px; overflow-wrap:anywhere; user-select:text; }
</style>
