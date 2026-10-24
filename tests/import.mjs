import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, startEditor, snapshot, editFood } from './helpers/editor.mjs';
import { importFixture, sha256 } from './helpers/import-fixture.mjs';

const fixture = await importFixture();
const port = 5189;
let editor = await startEditor(port, 'import');
const checks = [];
const check = (name, assertion) => { assertion(); checks.push(name); };
const packageBytes = readFileSync(fixture.path);
const path = 'original/conquest1.btl';
const preview = async (mode = 'replace', conflict = 'reject', overrides = {}) => editor.request('mod-preview', {
  revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), package: packageBytes.toString('base64'), mode, conflict, ...overrides,
});
const apply = p => editor.request('apply', { revision: p.revision, taskId: p.taskId, token: p.token });
const history = async direction => editor.request('history', { revision: (await editor.request('project')).revision, direction });

try {
  const original = await editor.request('author');
  const originalProject = await editor.request('project');
  const p = await preview();
  check('replace preview contains file and scenario changes', () => { assert(p.token); assert.equal(p.affectedScenarios, 1); assert(p.changes.some(d => d.file === path)); });
  assert.deepEqual(await editor.request('author'), original);
  checks.push('preview does not mutate author state');
  await apply(p);
  const imported = await editor.request('author');
  const project = await editor.request('project');
  check('replace installs exact package bytes and scenario list', () => { assert.deepEqual(imported.files, fixture.files); assert.deepEqual(imported.scenarios, ['conquest1']); });
  check('source records package hash and file hash', () => { assert.equal(imported.sources[0].packageHash, fixture.packageHash); assert.equal(imported.sources[0].files[path], sha256(Buffer.from(fixture.files[path], 'base64'))); });
  check('overview exposes unedited provenance', () => { assert.equal(project.overrides[0].source, 'editor-import-fixture'); assert.equal(project.overrides[0].edited, false); assert.equal(project.overrides[0].hash, imported.sources[0].files[path]); });
  assert.equal((await apply(p)).duplicate, true);
  assert.deepEqual(await editor.request('author'), imported);
  checks.push('duplicate apply is idempotent');
  await history('undo');
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(original));
  assert.equal((await editor.request('project')).scenarios.length, originalProject.scenarios.length);
  checks.push('undo restores files, sources and implicit baseline scenarios');
  await history('redo');
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(imported));
  checks.push('redo restores imported snapshot');
  const stale = await preview();
  await editFood(editor, ['conquest1'], 1);
  const edited = await editor.request('author');
  assert.equal((await editor.request('project')).overrides[0].edited, true);
  checks.push('local edit marks imported file as edited');
  await editor.request('apply', { revision: edited.revision, taskId: stale.taskId, token: stale.token }, 400);
  assert.deepEqual(await editor.request('author'), edited);
  checks.push('stale import cannot overwrite newer edits');

  await editor.request('restore', { revision: edited.revision, document: JSON.stringify({ ...edited, scenarios: ['conquest2'] }) });
  await editFood(editor, ['conquest2'], 7);
  const local = await editor.request('author');
  const rejected = await preview('merge', 'reject');
  check('reject lists conflicting hashes and has no apply token', () => {
    assert.equal(rejected.token, ''); assert.equal(rejected.count, 0); assert.equal(rejected.conflicts.length, 1);
    assert.equal(rejected.conflicts[0].currentHash, sha256(Buffer.from(local.files[path], 'base64')));
    assert.equal(rejected.conflicts[0].incomingHash, imported.sources[0].files[path]);
    assert.match(rejected.conflicts[0].baselineHash, /^[a-f0-9]{64}$/);
  });
  assert.deepEqual(await editor.request('author'), local);
  const keep = await preview('merge', 'keep');
  await apply(keep);
  const kept = await editor.request('author');
  check('keep preserves local bytes and provenance and unions scenarios', () => { assert.deepEqual(kept.files, local.files); assert.deepEqual(kept.sources, local.sources); assert.deepEqual(kept.scenarios, ['conquest2', 'conquest1']); });
  await history('undo');
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(local));
  const incoming = await preview('merge', 'incoming');
  await apply(incoming);
  const merged = await editor.request('author');
  check('incoming replaces conflict and preserves unrelated local file', () => { assert.equal(merged.files[path], fixture.files[path]); assert.equal(merged.files['original/conquest2.btl'], local.files['original/conquest2.btl']); assert.deepEqual(merged.scenarios, ['conquest2', 'conquest1']); assert.equal(merged.sources.length, 1); });
  await history('undo');
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(local));
  await history('redo');
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(merged));
  checks.push('merge undo and redo restore full snapshots');
  const beforeNoOp = await editor.request('author');
  const noOp = await preview('merge');
  check('identical merge has no conflicts or changes', () => { assert.equal(noOp.count, 0); assert.deepEqual(noOp.conflicts, []); });
  await apply(noOp);
  assert.deepEqual(await editor.request('author'), beforeNoOp);

  const replacement = await preview();
  await apply(replacement);
  assert.deepEqual(snapshot(await editor.request('author')), snapshot(imported));
  checks.push('replace removes unrelated overrides and shrinks scenarios');
  const beforeInvalid = await editor.request('author');
  for (const invalid of [{ mode: 'unknown' }, { conflict: 'unknown' }, { package: Buffer.from('not a zip').toString('base64') }, { revision: -1 }]) {
    await editor.request('mod-preview', { revision: beforeInvalid.revision, taskId: crypto.randomUUID(), package: packageBytes.toString('base64'), mode: 'replace', conflict: 'reject', ...invalid }, 400);
  }
  assert.deepEqual(await editor.request('author'), beforeInvalid);
  checks.push('invalid imports leave full author state unchanged');
  const legacy = { ...original, schema: 1, undo: [original.files], redo: [fixture.files] };
  await editor.request('restore', { revision: beforeInvalid.revision, document: JSON.stringify(legacy) });
  assert.equal((await editor.request('author')).schema, 2);
  checks.push('schema-1 author migrates to schema-2');
  const beforeRestart = await editor.request('author');
  await editor.stop();
  editor = await startEditor(5190, 'import-restart', editor.home);
  assert.deepEqual(await editor.request('author'), beforeRestart);
  await history('undo');
  const restoredImport = await editor.request('author');
  assert.deepEqual(snapshot(restoredImport), snapshot(imported));
  checks.push('process restart preserves imported history and undo');
  const report = { checks: checks.length, cases: checks, fixtureCached: fixture.cached, packageBytes: fixture.packageBytes, packageHash: fixture.packageHash, home: editor.home };
  writeFileSync(join(root, '.local/import-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await editor.stop(); }
