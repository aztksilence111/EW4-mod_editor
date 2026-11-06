import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { startEditor, snapshot } from './helpers/editor.mjs';
const editor = await startEditor(5347, 'latest-rules');
const examples = JSON.parse(readFileSync('public/rule-examples.json'));
const checks = [];
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
async function preview(files, expected = 200) { return editor.request('rules-preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), files }, expected) }
async function apply(p) { return editor.request('apply', { revision: p.revision, taskId: p.taskId, token: p.token }) }
try {
  const original = await editor.request('author');
  await editor.request('restore', { revision: original.revision, document: JSON.stringify({ ...original, scenarios: ['conquest1'] }) });
  const initial = await editor.request('author');
  const rules = await editor.request('rules');
  assert.equal(rules.apiVersion, 3); assert(rules.engineSource.startsWith('47f8067')); checks.push('latest engine identity');
  for (const module of rules.modules) {
    const manifest = { ...rules.manifest, schema: 1, apiVersion: 3, [module.key]: ['skills', 'statuses'].includes(module.key) ? [module.path] : module.path };
    await preview({ 'rewrite/extension.json': encode(manifest), [module.path]: encode(module.initial) });
    checks.push('valid module skeleton: ' + module.key);
  }
  for (const example of examples) {
    const p = await preview(example.files);
    assert(p.count > 0, example.id); checks.push('current-engine official example: ' + example.id);
    assert.deepEqual(snapshot(await editor.request('author')), snapshot(initial), 'preview mutated author');
  }
  const layered = examples.find(e => e.id === 'unit-layers');
  const p = await preview(layered.files); await apply(p);
  const changed = await editor.request('author');
  assert(changed.files['rewrite/unit-layers.json']); checks.push('apply layer configuration');
  const response = await editor.fetch('export', { revision: changed.revision, id: 'latest-rules', name: 'Latest rules', version: '1.0' });
  assert(response.ok, await response.clone().text());
  const bytes = Buffer.from(await response.arrayBuffer());
  const report = await editor.request('inspect-export', { name: 'latest.ew4mod', data: bytes.toString('base64') });
  assert(report.valid, JSON.stringify(report.issues)); checks.push('new layer package exports and revalidates');
  await editor.request('rules-preview', { revision: initial.revision, taskId: crypto.randomUUID(), files: layered.files }, 400); checks.push('stale revision rejected');
  await preview({ '../escape.json': encode({}) }, 400); checks.push('path traversal rejected');
  await preview({ 'rewrite/invalid.lua': Buffer.from([0xff]).toString('base64') }, 400); checks.push('invalid UTF-8 Lua rejected');
  await preview({ 'rewrite/unit-layers.json': encode({ enabled: true, airCapacity: 0, profiles: {} }) }, 400); checks.push('invalid engine configuration rejected');
  await preview({ 'rewrite/unit-layers.json': null }, 400); checks.push('registered dependency deletion rejected');
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(changed)); checks.push('all failed previews atomic');
  const modPreview = await editor.request('mod-preview', { revision: changed.revision, taskId: crypto.randomUUID(), package: bytes.toString('base64'), mode: 'replace', conflict: 'incoming' });
  await apply(modPreview); checks.push('new-interface content package reimports');
  const state = await editor.request('author');
  await editor.request('history', { revision: state.revision, direction: 'undo' });
  const afterImportUndo = await editor.request('author');
  await editor.request('history', { revision: afterImportUndo.revision, direction: 'undo' });
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(initial)); checks.push('rule history undo restores prior resources');
  const undone = await editor.request('author');
  await editor.request('history', { revision: undone.revision, direction: 'redo' });
  assert((await editor.request('author')).files['rewrite/unit-layers.json']); checks.push('rule history redo');
  mkdirSync('.local/latest-rules', { recursive: true });
  writeFileSync('.local/latest-rules/result.json', JSON.stringify({ passed: checks.length, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await editor.stop(); }
