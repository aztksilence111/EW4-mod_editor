import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, startEditor } from './helpers/editor.mjs';

let editor = await startEditor(5187, 'skills');
const cases = [];
const b64 = value => Buffer.from(value).toString('base64');
try {
  const initialAuthor = await editor.request('author');
  let project = await editor.request('project');
  const commander = project.commanders.find(row => row.id === '1');
  assert.equal(commander.originalSkills.length, 4);
  assert.deepEqual(commander.originalSkills.map(skill => skill.id), commander.effectiveSkills.map(skill => skill.id));
  assert.equal(commander.skillBinding, false);
  cases.push('overview exposes original and effective skills side by side');

  const rule = { domain: 'commanders', field: 'skillBinding', operation: 'set', value: 0,
    skillId: 'ew4.skill.2', skillSlot: 1, skillLevel: 3, rounding: 'round', filter: { ids: [1] } };
  const preview = await editor.request('preview', { revision: project.revision, taskId: crypto.randomUUID(), scenarios: [], rules: [rule] });
  assert.equal(preview.count, 1); assert.equal(preview.affectedScenarios, 95); assert.equal(preview.changes[0].field, 'skillBinding');
  await editor.request('apply', { revision: project.revision, taskId: preview.taskId, token: preview.token });
  let author = await editor.request('author');
  const catalog = JSON.parse(Buffer.from(author.files['legacy/catalog.json'], 'base64'));
  const entry = catalog.commanders.find(row => row.id === 'ew4.commander.1');
  assert.equal(entry.skill_slots[1].id, 'ew4.skill.2'); assert.equal(entry.skill_slots[1].level, 3);
  project = await editor.request('project');
  const changed = project.commanders.find(row => row.id === '1');
  assert.equal(changed.originalSkills[1].id, 'ew4.skill.3');
  assert.equal(changed.effectiveSkills[1].id, 'ew4.skill.2');
  assert.equal(changed.skillBinding, true);
  cases.push('binding preview and apply preserve original XML and change effective catalog skill');

  await editor.request('history', { revision: project.revision, direction: 'undo' });
  project = await editor.request('project');
  assert.equal(project.commanders.find(row => row.id === '1').skillBinding, false);
  await editor.request('history', { revision: project.revision, direction: 'redo' });
  assert.equal((await editor.request('project')).commanders.find(row => row.id === '1').effectiveSkills[1].id, 'ew4.skill.2');
  cases.push('binding undo and redo restore effective skill state');

  const before = await editor.request('author');
  await editor.request('preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), scenarios: [], rules: [{ ...rule, skillId: 'ew4.skill.999' }] }, 400);
  assert.deepEqual(await editor.request('author'), before);
  cases.push('unknown registered skill is rejected atomically');

  const extension = JSON.stringify({ schema: 1, apiVersion: 2, skills: ['rewrite/skills.json'], commanderBindings: 'rewrite/commander-bindings.json' });
  const registered = JSON.stringify([{ id: 'demo.skill', nameKey: 'name_demo_skill', descriptionKey: 'desc_demo_skill', kind: 'passive', target: 'self', effects: [] }]);
  const bindings = JSON.stringify([{ target: 'ew4.commander.1', mode: 'append', skills: [{ id: 'demo.skill', instanceId: 'demo.1', level: 2, order: 0 }] }]);
  author = await editor.request('author');
  await editor.request('restore', { revision: author.revision, document: JSON.stringify({ ...initialAuthor, files: {
    ...initialAuthor.files, 'rewrite/extension.json': b64(extension), 'rewrite/skills.json': b64(registered), 'rewrite/commander-bindings.json': b64(bindings),
  } }) });
  project = await editor.request('project');
  assert(project.skills.some(skill => skill.id === 'demo.skill'));
  assert(project.commanders.find(row => row.id === '1').effectiveSkills.some(skill => skill.id === 'demo.skill'));
  const extensionPreview = await editor.request('preview', { revision: project.revision, taskId: crypto.randomUUID(), scenarios: [], rules: [{ ...rule, skillId: 'demo.skill', skillSlot: 1 }] });
  assert.equal(extensionPreview.count, 1); assert.equal(extensionPreview.affectedScenarios, 95);
  await editor.request('apply', { revision: project.revision, taskId: extensionPreview.taskId, token: extensionPreview.token });
  author = await editor.request('author');
  const savedBindings = JSON.parse(Buffer.from(author.files['rewrite/commander-bindings.json'], 'base64'));
  assert.equal(savedBindings.at(-1).mode, 'replace'); assert.equal(savedBindings.at(-1).skills[1].id, 'demo.skill');
  assert.equal(author.files['legacy/catalog.json'], undefined);
  cases.push('registered Rewrite binding file is edited without mutating legacy catalog');

  const report = { checks: cases.length, cases, home: editor.home };
  writeFileSync(join(root, '.local/skills-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await editor.stop(); }
