import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { root, dll, startEditor } from './helpers/editor.mjs';

const runtime = spawnSync('dotnet', ['run', '--project', join(root, 'tests/runtime/RuntimeCompatibility.csproj'),
  '-p:BridgeOutput=' + dirname(dll), '--', root, '--structural'], { cwd: root, stdio: 'inherit' });
if (runtime.error) throw runtime.error;
assert.equal(runtime.status, 0, 'Structural runtime checks failed');
const directory = join(root, '.local/runtime-compatibility');
const evidence = JSON.parse(readFileSync(join(directory, 'structural-result.json')));
const input = readFileSync(join(directory, 'structural-input.btl'));
const expected = readFileSync(join(directory, 'structural-first.btl'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(input), evidence.fixtureSha256, 'Run the structural runtime harness first');
const path = 'original/conquest1.btl';
let editor = await startEditor(5193, 'structural');
const cases = [];
const rule = (ids, extra = {}) => ({ domain: 'armies', field: 'record', operation: 'delete', value: 0, filter: { ids }, ...extra });
const request = async rules => editor.request('preview', { revision: (await editor.request('project')).revision,
  taskId: crypto.randomUUID(), scenarios: ['conquest1'], rules });
async function restore(bytes = input, files = {}) {
  const author = await editor.request('author');
  await editor.request('restore', { revision: author.revision, document: JSON.stringify({ ...author, scenarios: ['conquest1'],
    files: { [path]: bytes.toString('base64'), ...files } }) });
}
async function reject(name, rules, pattern) {
  const before = await editor.request('author');
  const disk = readFileSync(join(editor.home, 'author.json'));
  const result = await editor.request('preview', { revision: before.revision, taskId: crypto.randomUUID(), scenarios: ['conquest1'], rules }, 400);
  if (pattern) assert.match(result.error, pattern);
  assert.deepEqual(await editor.request('author'), before, name);
  assert.deepEqual(readFileSync(join(editor.home, 'author.json')), disk, name + ' persisted partial state');
  cases.push(name + ': rejected atomically');
}
function optional(bytes, required = false) {
  const header = Buffer.alloc(16);
  header.write('TEST'); header.writeUInt32LE(1, 4); header.writeUInt32LE(Number(required), 8); header.writeUInt32LE(3, 12);
  const result = Buffer.concat([bytes, header, Buffer.from('abc')]);
  const bodyLength = 72 + bytes.readInt32LE(24) * 180 + bytes.readInt32LE(16) * bytes.readInt32LE(20)
    + bytes.readInt32LE(28) * 16 + bytes.readInt32LE(32) * 32 + bytes.readInt32LE(64) * 8
    + bytes.readInt32LE(40) * 116 + bytes.readInt32LE(56) * 108 + bytes.readInt32LE(36) * 44;
  result.writeUInt32LE(bytes.readUInt32LE(bodyLength + 12) + 1, bodyLength + 12);
  return result;
}
try {
  await restore();
  const before = await editor.request('author');
  const disk = readFileSync(join(editor.home, 'author.json'));
  const preview = await request([rule([0])]);
  assert.equal(preview.count, 1);
  assert.deepEqual(preview.slotMigrations, [{ file: path, ruleIndex: 0,
    oldToNew: Array.from({ length: evidence.armyCount }, (_, i) => i === 0 ? null : i - 1) }]);
  assert.deepEqual(await editor.request('author'), before);
  assert.deepEqual(readFileSync(join(editor.home, 'author.json')), disk);
  cases.push('preview: explicit per-rule migration and no side effects');

  for (const [name, candidate] of [
    ['empty IDs', rule([])], ['missing IDs', rule(undefined)], ['duplicate IDs', rule([0, 0])],
    ['negative ID', rule([-1])], ['out-of-range ID', rule([evidence.armyCount])],
    ['invalid field', rule([0], { field: 'training' })], ['invalid value', rule([0], { value: 1 })],
    ['filter mismatch', rule([0], { filter: { ids: [0], armyType: 999 } })],
    ['wrong map', rule([0], { filter: { ids: [0], cells: [input.readInt16LE(72)], mapId: -1 } })],
    ['victory target', rule([evidence.armyCount - 1])], ['lose target', rule([1])],
  ]) await reject(name, [candidate]);
  await reject('later rule failure', [rule([0]), { domain: 'armies', field: 'armyGrade', operation: 'set', value: 99, filter: {} }]);
  const sequence = await request([rule([0]), rule([2])]);
  assert.deepEqual(sequence.slotMigrations.map(m => m.ruleIndex), [0, 1]);
  assert.equal(sequence.slotMigrations[1].oldToNew.length, evidence.armyCount - 1);
  assert.equal(sequence.slotMigrations[1].oldToNew[2], null);
  cases.push('sequential rules: mappings use each preceding candidate');
  await editor.request('apply', { revision: before.revision, taskId: preview.taskId, token: preview.token });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), expected);
  const duplicate = await editor.request('apply', { revision: before.revision, taskId: preview.taskId, token: preview.token });
  assert.equal(duplicate.duplicate, true);
  cases.push('apply: matches actual runtime-verified BTL and retry is idempotent');

  for (const [direction, bytes] of [['undo', input], ['redo', expected]]) {
    await editor.request('history', { revision: (await editor.request('project')).revision, direction });
    assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), bytes);
  }
  cases.push('undo/redo: complete body and extension restoration');
  const stale = await request([rule([2])]);
  await editor.request('history', { revision: stale.revision, direction: 'undo' });
  await editor.request('apply', { revision: stale.revision, taskId: stale.taskId, token: stale.token }, 400);
  cases.push('stale structural preview: rejected');

  await restore(optional(input));
  await reject('unknown optional extension', [rule([0])], /未知扩展/);
  const optionalAuthor = await editor.request('author');
  await editor.request('restore', { revision: optionalAuthor.revision,
    document: JSON.stringify({ ...optionalAuthor, files: { [path]: optional(input, true).toString('base64') } }) }, 400);
  assert.deepEqual(await editor.request('author'), optionalAuthor);
  cases.push('unknown required extension: restore rejected atomically');

  const json = value => Buffer.from(JSON.stringify(value)).toString('base64');
  for (const [name, manifest, files] of [
    ['external victory', { VictoryRules: 'rewrite/victory.json' }, { 'rewrite/victory.json': json({ conquest1: { win: { type: 'enemy_factions_defeated' } } }) }],
    ['external events', { scenarioEvents: 'rewrite/events.json' }, { 'rewrite/events.json': json({ conquest1: [] }) }],
    ['registered script', { scripts: ['rewrite/test.lua'] }, { 'rewrite/test.lua': Buffer.from('function noop(ctx) return 1 end').toString('base64') }],
    ['implicit skill script', { skills: ['rewrite/skills.json'] }, {
      'rewrite/skills.json': json([{ id: 'test.skill', effects: [{ script: 'rewrite/test.lua', function: 'noop' }] }]),
      'rewrite/test.lua': Buffer.from('function noop(ctx) return 1 end').toString('base64'),
    }],
  ]) {
    await restore(input, { 'rewrite/extension.json': json({ schema: 1, apiVersion: 1, ...manifest }), ...files });
    await reject(name, [rule([0])], /尚不支持部队槽位迁移/);
  }
  await restore();
  const final = await request([rule([0])]);
  await editor.request('apply', { revision: final.revision, taskId: final.taskId, token: final.token });
  const validation = await editor.request('validate', {});
  assert.equal(validation.valid, true);
  assert.equal(validation.scenarios, 1);
  const author = await editor.request('author');
  const response = await editor.fetch('export', { revision: author.revision, id: 'structural-army-delete', name: 'Structural army deletion', version: '0.1.0' });
  if (!response.ok) assert.fail(await response.text());
  const packageBytes = Buffer.from(await response.arrayBuffer());
  assert.equal(packageBytes.subarray(0, 2).toString(), 'PK');
  writeFileSync(join(directory, 'structural-army-delete.ew4mod'), packageBytes);
  cases.push('full country validation and standard mod export');
  const home = editor.home;
  await editor.stop();
  editor = await startEditor(5194, 'structural-restart', home);
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), expected);
  await editor.request('history', { revision: (await editor.request('project')).revision, direction: 'undo' });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), input);
  cases.push('process restart: structural result and undo survive');
  writeFileSync(join(directory, 'structural-author-result.json'), JSON.stringify({ checks: cases.length, cases,
    home, packageBytes: packageBytes.length, fixtureSha256: hash(input), outputSha256: hash(expected) }, null, 2));
  console.log(`Structural author API: ${cases.length} checks passed`);
} finally { await editor.stop(); }
