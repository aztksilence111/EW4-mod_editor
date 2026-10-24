import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { root, dll, startEditor } from './helpers/editor.mjs';

function runtime(mode) {
  const result = spawnSync('dotnet', ['run', '--project', join(root, 'tests/runtime/RuntimeCompatibility.csproj'),
    '-p:BridgeOutput=' + dirname(dll), '--', root, mode], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Deployment runtime checks failed');
}
runtime('--deployment');

const dir = join(root, '.local/runtime-compatibility');
const evidence = JSON.parse(readFileSync(join(dir, 'deployment-result.json')));
const input = readFileSync(join(dir, 'structural-input.btl'));
const expected = readFileSync(join(dir, 'deployment-default.btl'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(input), evidence.fixtureSha256);
assert.equal(hash(expected), evidence.outputSha256);
const path = 'original/conquest1.btl';
const encode = bytes => Buffer.from(bytes).toString('base64');
const deployment = cell => ({ cell, armyType: 0, armyGrade: 0, commander: -1 });
const rule = (cell, extra = {}) => ({ domain: 'armies', field: 'record', operation: 'append', value: 0,
  filter: { mapId: evidence.mapId, cells: [cell] }, deployment: deployment(cell), ...extra });
let editor = await startEditor(5197, 'deployment');
const cases = [];
async function restore(bytes = input, files = {}) {
  const author = await editor.request('author');
  await editor.request('restore', { revision: author.revision, document: JSON.stringify({ ...author,
    scenarios: ['conquest1'], files: { [path]: encode(bytes), ...files } }) });
}
async function preview(rules, scenarios = ['conquest1']) {
  const project = await editor.request('project');
  return editor.request('preview', { revision: project.revision, taskId: crypto.randomUUID(), scenarios, rules });
}
async function reject(name, rules, pattern, scenarios = ['conquest1']) {
  const before = await editor.request('author');
  const disk = readFileSync(join(editor.home, 'author.json'));
  const response = await editor.fetch('preview', { revision: before.revision, taskId: crypto.randomUUID(), scenarios, rules });
  const text = await response.text();
  assert.equal(response.status, 400, name + ': ' + text);
  const result = text ? JSON.parse(text) : {};
  if (pattern) assert.match(result.error, pattern);
  assert.deepEqual(await editor.request('author'), before, name + ' changed author');
  assert.deepEqual(readFileSync(join(editor.home, 'author.json')), disk, name + ' persisted partial state');
  cases.push(name + ': rejected atomically');
}
try {
  await restore();
  const before = await editor.request('author');
  const disk = readFileSync(join(editor.home, 'author.json'));
  const first = await preview([rule(evidence.cell)]);
  assert.equal(first.count, 1);
  assert.deepEqual(first.slotMigrations, [{ file: path, ruleIndex: 0, oldToNew: Array.from({ length: evidence.armyCount }, (_, i) => i) }]);
  assert.equal(first.changes[0].after.cell, evidence.cell);
  assert.equal(first.changes[0].after.state70, -1);
  assert.equal(first.changes[0].after.commander, -1);
  assert.deepEqual(await editor.request('author'), before);
  assert.deepEqual(readFileSync(join(editor.home, 'author.json')), disk);
  cases.push('preview: resolved defaults, identity mapping and no memory/disk side effects');
  await editor.request('apply', { revision: first.revision, taskId: first.taskId, token: first.token });
  const applied = await editor.request('author');
  const output = Buffer.from(applied.files[path], 'base64');
  assert.deepEqual(output, expected);
  const duplicate = await editor.request('apply', { revision: first.revision, taskId: first.taskId, token: first.token });
  assert.equal(duplicate.duplicate, true);
  cases.push('apply: runtime-verified exact bytes and idempotent retry');
  await reject('occupied target', [rule(evidence.cell)], /已有部队/);
  await editor.request('history', { revision: (await editor.request('project')).revision, direction: 'undo' });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), input);
  await editor.request('history', { revision: (await editor.request('project')).revision, direction: 'redo' });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), output); cases.push('undo/redo: exact byte restoration');
  await restore();
  for (const [name, extra] of [
    ['missing deployment', { deployment: undefined }], ['missing cell', { deployment: {} }],
    ['invalid field', { field: 'training' }], ['invalid value', { value: 1 }],
    ['missing map', { filter: { cells: [evidence.cell] } }],
    ['wrong map', { filter: { mapId: -1, cells: [evidence.cell] } }],
    ['missing target selection', { filter: { mapId: evidence.mapId } }],
    ['multi-cell target', { filter: { ...rule(evidence.cell).filter, cells: [evidence.cell, evidence.secondCell] } }],
    ['mismatched target', { filter: { ...rule(evidence.cell).filter, cells: [evidence.secondCell] } }],
    ['slot filter', { filter: { ...rule(evidence.cell).filter, ids: [] } }],
    ['text filter', { filter: { ...rule(evidence.cell).filter, search: '' } }],
    ['unit filter', { filter: { ...rule(evidence.cell).filter, armyType: 0 } }],
    ['commander filter', { filter: { ...rule(evidence.cell).filter, commander: -1 } }],
    ['country mismatch', { filter: { ...rule(evidence.cell).filter, country: 'not-a-country' } }],
    ['naval on land', { deployment: { cell: evidence.cell, armyType: 14 } }],
    ['invalid unit', { deployment: { cell: evidence.cell, armyType: 22 } }],
    ['invalid commander', { deployment: { cell: evidence.cell, commander: 32767 } }],
    ['invalid health', { deployment: { cell: evidence.cell, strengthNow: 101, strengthMax: 100 } }],
  ]) await reject(name, [rule(evidence.cell, extra)]);
  await reject('land on sea', [rule(evidence.seaCell)], /不可通行/);
  await reject('negative cell', [rule(-1)]);
  await reject('cell overflow', [rule(32768)]);
  await reject('multi-scenario', [rule(evidence.cell)], /明确选择一个剧本/, ['conquest1', 'conquest2']);
  await reject('later batch failure', [rule(evidence.cell), { domain: 'armies', field: 'armyGrade', operation: 'set', value: 99, filter: {} }]);
  await reject('duplicate deployment batch', [rule(evidence.cell), rule(evidence.cell)], /已有部队/);
  const sequence = await preview([rule(evidence.cell), rule(evidence.secondCell, { deployment: { cell: evidence.secondCell, armyType: 1, armyGrade: 1 } })]);
  assert.deepEqual(sequence.slotMigrations.map(m => m.oldToNew.length), [evidence.armyCount, evidence.armyCount + 1]);
  await editor.request('apply', { revision: sequence.revision, taskId: sequence.taskId, token: sequence.token });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), readFileSync(join(dir, 'deployment-second.btl')));
  cases.push('sequential appends: tail slots and bytes use each preceding candidate');
  await restore();
  const deletion = ids => ({ domain: 'armies', field: 'record', operation: 'delete', value: 0, filter: { ids } });
  const roundtrip = await preview([rule(evidence.cell), deletion([evidence.armyCount])]);
  await editor.request('apply', { revision: roundtrip.revision, taskId: roundtrip.taskId, token: roundtrip.token });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), input);
  cases.push('append then delete: restores exact original body and extensions');
  const mixed = await preview([deletion([0]), rule(evidence.cell)]);
  assert.equal(mixed.slotMigrations[0].oldToNew[0], null);
  assert.equal(mixed.slotMigrations[1].oldToNew.length, evidence.armyCount - 1);
  await editor.request('apply', { revision: mixed.revision, taskId: mixed.taskId, token: mixed.token });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), readFileSync(join(dir, 'deployment-after-delete.btl')));
  cases.push('delete then append: uses preceding slot identities and verified bytes');
  await restore();
  const stale = await preview([rule(evidence.cell)]);
  const other = await preview([rule(evidence.secondCell)]);
  await editor.request('apply', { revision: other.revision, taskId: other.taskId, token: other.token });
  const changed = await editor.request('author');
  await editor.request('apply', { revision: stale.revision, taskId: stale.taskId, token: stale.token }, 400);
  assert.deepEqual(await editor.request('author'), changed); cases.push('stale preview: refused without state change');
  for (const [label, bytes, candidate] of [
    ['commander and explicit strength', 'deployment-commander.btl', rule(evidence.cell, { deployment: { cell: evidence.cell, commander: evidence.commander, strengthNow: 50, strengthMax: 100 } })],
    ['naval sea deployment', 'deployment-naval.btl', rule(evidence.seaCell, { deployment: { cell: evidence.seaCell, armyType: 14 } })],
  ]) {
    await restore(); const previewed = await preview([candidate]);
    await editor.request('apply', { revision: previewed.revision, taskId: previewed.taskId, token: previewed.token });
    assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), readFileSync(join(dir, bytes)));
    cases.push(label + ': matches runtime-verified writer');
  }
  for (const owner of [255, 128, 127]) {
    await restore(readFileSync(join(dir, `deployment-owner-${owner}.btl`)));
    await reject('unowned/unresolved signed owner ' + owner, [rule(evidence.cell)], /有效军团/);
  }
  function optional(required = false) {
    const header = Buffer.alloc(16); header.write('TEST'); header.writeUInt32LE(1, 4);
    header.writeUInt32LE(Number(required), 8); header.writeUInt32LE(3, 12);
    const bytes = Buffer.concat([input, header, Buffer.from('abc')]);
    const bodyLength = 72 + input.readInt32LE(24) * 180 + input.readInt32LE(16) * input.readInt32LE(20)
      + input.readInt32LE(28) * 16 + input.readInt32LE(32) * 32 + input.readInt32LE(64) * 8
      + input.readInt32LE(40) * 116 + input.readInt32LE(56) * 108 + input.readInt32LE(36) * 44;
    bytes.writeUInt32LE(input.readUInt32LE(bodyLength + 12) + 1, bodyLength + 12); return bytes;
  }
  await restore(optional()); await reject('unknown optional BTL block', [rule(evidence.cell)], /未知扩展/);
  const unknown = await editor.request('author');
  await editor.request('restore', { revision: unknown.revision, document: JSON.stringify({ ...unknown, files: { [path]: encode(optional(true)) } }) }, 400);
  assert.deepEqual(await editor.request('author'), unknown); cases.push('unknown required block: restore rejected atomically');
  const json = value => encode(JSON.stringify(value));
  for (const [label, manifest, files] of [
    ['external victory', { VictoryRules: 'rewrite/victory.json' }, { 'rewrite/victory.json': json({ conquest1: { win: { type: 'enemy_factions_defeated' } } }) }],
    ['external scenario events', { scenarioEvents: 'rewrite/events.json' }, { 'rewrite/events.json': json({ conquest1: [] }) }],
    ['registered script', { scripts: ['rewrite/test.lua'] }, { 'rewrite/test.lua': encode('function noop(ctx) return 1 end') }],
    ['implicit skill script', { skills: ['rewrite/skills.json'] }, {
      'rewrite/skills.json': json([{ id: 'test.skill', effects: [{ script: 'rewrite/test.lua', function: 'noop' }] }]),
      'rewrite/test.lua': encode('function noop(ctx) return 1 end'),
    }],
  ]) {
    await restore(input, { 'rewrite/extension.json': json({ schema: 1, apiVersion: 1, ...manifest }), ...files });
    await reject(label, [rule(evidence.cell)], /尚不支持部队槽位迁移或追加/);
  }
  await restore();
  const final = await preview([rule(evidence.cell)]);
  await editor.request('apply', { revision: final.revision, taskId: final.taskId, token: final.token });
  const validation = await editor.request('validate', {}); assert.equal(validation.valid, true); cases.push('validate: all playable factions pass');
  const author = await editor.request('author');
  const response = await editor.fetch('export', { revision: author.revision, id: 'deployment-army-append', name: 'Deployment army append', version: '0.1.0' });
  assert.equal(response.status, 200); const packageBytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(dir, 'deployment-army-append.ew4mod'), packageBytes); cases.push('export: standard package created');
  const exported = await editor.request('author');
  const home = editor.home; await editor.stop(); editor = await startEditor(5198, 'deployment-restart', home);
  assert.deepEqual(await editor.request('author'), exported);
  await editor.request('history', { revision: exported.revision, direction: 'undo' });
  assert.deepEqual(Buffer.from((await editor.request('author')).files[path], 'base64'), input);
  cases.push('restart: full author state and undo survive process restart');
  writeFileSync(join(dir, 'deployment-author-result.json'), JSON.stringify({ checks: cases.length, cases, home,
    packageBytes: packageBytes.length, fixtureSha256: hash(input), outputSha256: hash(expected) }, null, 2));
  console.log(`Deployment author API: ${cases.length} checks passed`);
} finally { await editor.stop(); }
runtime('--deployment-export');
