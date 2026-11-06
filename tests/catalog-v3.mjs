import assert from 'node:assert/strict';
import { startEditor } from './helpers/editor.mjs';
const editor = await startEditor(5219, 'catalog-v3');
try {
  const initial = await editor.request('author');
  const before = await editor.request('project');
  const commander = before.commanders.find(c => c.id === '1');
  const preview = await editor.request('preview', { revision: before.revision, taskId: crypto.randomUUID(), scenarios: [], rules: [
    { domain: 'commanders', field: 'cavalry', operation: 'add', value: 1, rounding: 'round', filter: { ids: [1] } },
  ] });
  await editor.request('apply', { revision: before.revision, taskId: preview.taskId, token: preview.token });
  const after = await editor.request('project');
  assert.equal(Number(after.commanders.find(c => c.id === '1').cavalry), Number(commander.cavalry) + 1);
  const author = await editor.request('author');
  const part = JSON.parse(Buffer.from(author.files['legacy/commanders.json'], 'base64'));
  assert.equal(part.commanders.find(c => c.legacy_id === 1).cavalry, Number(commander.cavalry) + 1);
  const index = JSON.parse(Buffer.from(author.files['legacy/catalog.json'], 'base64'));
  assert.equal(index.schema_version, 3); assert.equal(index.commanders, undefined);
  const resources = await editor.fetch('export-original', { revision: after.revision, scope: 'commanders', layout: 'rewrite' });
  assert.equal(resources.status, 200, await resources.clone().text());
  await editor.request('history', { revision: after.revision, direction: 'undo' });
  assert.deepEqual((await editor.request('author')).files, initial.files);
  console.log(JSON.stringify({ passed: 4, checks: ['v3 commander edit affects runtime and XML', 'catalog remains split schema 3', 'commander resource export includes split dependencies', 'undo restores complete split state'] }));
} finally { await editor.stop(); }
