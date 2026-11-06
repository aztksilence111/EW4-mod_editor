import assert from 'node:assert/strict';
import { startEditor, snapshot } from './helpers/editor.mjs';
import { crc32, inflateRawSync } from 'node:zlib';

function unzip(bytes) {
  const entries = new Map();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = bytes.readUInt32LE(end + 16);
  while (bytes.readUInt32LE(at) === 0x02014b50) {
    const size = bytes.readUInt32LE(at + 20), method = bytes.readUInt16LE(at + 10);
    const nameLength = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + size);
    entries.set(bytes.toString('utf8', at + 46, at + 46 + nameLength), method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, data] of entries) {
    const label = Buffer.from(name), header = Buffer.alloc(30), index = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(label.length, 26);
    index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6);
    index.writeUInt32LE(crc32(data), 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(label.length, 28); index.writeUInt32LE(offset, 42);
    locals.push(header, label, data); central.push(index, label); offset += header.length + label.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const editor = await startEditor(5341, 'scenario-tools');
let checks = 0;
const check = (ok, message) => { assert(ok, message); checks++; };
const inspect = (name, bytes) => editor.request('inspect-export', { name, data: Buffer.from(bytes).toString('base64') });
try {
  const untouched = await editor.request('author');
  await editor.request('restore', { revision: untouched.revision, document: JSON.stringify({ ...untouched, scenarios: ['conquest1'] }) });
  const initial = await editor.request('author');
  const maps = await editor.request('maps');
  const eastasia = maps.find(m => m.name === 'eastasia');
  check(eastasia?.width > 0 && eastasia?.height > 0, 'configured East Asia available without BTL');
  const template = initial.scenarios?.[0] ?? 'conquest1';
  await editor.request('new-scenario', { revision: initial.revision, id: 'custom_eastasia_test', mapId: eastasia.id, template });
  let author = await editor.request('author');
  const view = await editor.request('scenario/custom_eastasia_test');
  const bytes = Buffer.from(author.files['original/custom_eastasia_test.btl'], 'base64');
  check(bytes.readInt32LE(4) === eastasia.id && bytes.readInt32LE(16) === eastasia.width && bytes.readInt32LE(20) === eastasia.height, 'full configured map rectangle');
  const factionCount = bytes.readInt32LE(24);
  const ownerOffset = 72 + factionCount * 180;
  check([...bytes.subarray(ownerOffset, ownerOffset + eastasia.width * eastasia.height)].every(n => n === 255), 'all territory starts neutral');
  check(view.reverseReferences.valid && bytes.readInt32LE(28) === 0 && bytes.readInt32LE(32) === 0 && bytes.readInt32LE(36) === 0, 'no stale entities or references');
  const cell = view.jurisdictionEditing.editableCells[0];
  check(Number.isInteger(cell), 'blank map exposes editable land cells');
  const preview = await editor.request('preview', { revision: author.revision, taskId: crypto.randomUUID(), scenarios: ['custom_eastasia_test'], rules: [
    { domain: 'territory', field: 'owner', operation: 'set', value: 0, rounding: 'round', targetCountry: view.factions[0].id, filter: { cells: [cell], mapId: eastasia.id } },
  ] });
  check(preview.count > 0, 'territory can be edited without importing a BTL');
  await editor.request('apply', { revision: author.revision, taskId: preview.taskId, token: preview.token });
  const edited = await editor.request('author');
  check(edited.files['original/custom_eastasia_test.btl'] !== author.files['original/custom_eastasia_test.btl'], 'territory edit persists');
  await editor.request('history', { revision: edited.revision, direction: 'undo' });
  author = await editor.request('author');
  await editor.request('new-scenario', { revision: initial.revision, id: 'custom_stale', mapId: eastasia.id, template }, 400);
  await editor.request('new-scenario', { revision: author.revision, id: 'custom_eastasia_test', mapId: eastasia.id, template }, 400);
  await editor.request('new-scenario', { revision: author.revision, id: 'custom_invalid', mapId: 999999, template }, 400);
  const valid = await inspect('custom_eastasia_test.btl', bytes);
  check(valid.valid && valid.issues.some(i => i.code === 'empty_scenario'), 'blank BTL passes structure/startup with playability warning');
  check(valid.issues.every(i => !i.file.includes('custom_export_check')), 'standalone report preserves actual uploaded filename');
  const bad = Buffer.from(bytes); bad.writeInt32LE(eastasia.width + 1, 16);
  const malformed = await inspect('broken.btl', bad);
  check(!malformed.valid && malformed.issues.some(i => i.file === 'broken.btl'), 'malformed BTL reports named file');
  const badOwner = Buffer.from(bytes); badOwner[ownerOffset] = 127;
  check(!(await inspect('bad-owner.btl', badOwner)).valid, 'invalid country slot rejected');
  const btlResponse = await editor.fetch('export-btl', { revision: author.revision, scenario: 'custom_eastasia_test' });
  check(btlResponse.ok && Buffer.from(await btlResponse.arrayBuffer()).equals(bytes), 'new BTL exports byte-for-byte');
  const response = await editor.fetch('export-original', { revision: author.revision, scope: 'project', layout: 'rewrite' });
  assert(response.ok, await response.clone().text());
  const resourceZip = Buffer.from(await response.arrayBuffer());
  const zipReport = await inspect('resources.zip', resourceZip);
  check(zipReport.valid && zipReport.scenarios > 1, 'exported ZIP validates against baseline: ' + JSON.stringify(zipReport.issues.filter(i => i.severity === 'error').slice(0, 8)));
  const modResponse = await editor.fetch('export', { revision: author.revision, id: 'inspection-test', name: 'Inspection test', version: '1.0' });
  assert(modResponse.ok, await modResponse.clone().text());
  const mod = Buffer.from(await modResponse.arrayBuffer());
  check((await inspect('test.ew4mod', mod)).valid, 'standard content package validates');
  const tampered = unzip(mod);
  tampered.set('original/custom_eastasia_test.btl', badOwner);
  check(!(await inspect('tampered.ew4mod', zip(tampered))).valid, 'content hash tampering detected');
  const legacyResponse = await editor.fetch('export-original', { revision: author.revision, scope: 'project', layout: 'legacy' });
  assert(legacyResponse.ok, await legacyResponse.clone().text());
  const legacy = Buffer.from(await legacyResponse.arrayBuffer());
  check((await inspect('assets.zip', legacy)).valid, 'legacy layout validates retained and deployed resources');
  const brokenAssets = unzip(legacy); brokenAssets.set('assets/custom_eastasia_test.btl', badOwner);
  check(!(await inspect('broken-assets.zip', zip(brokenAssets))).valid, 'mismatched deployment assets detected');
  check(!(await inspect('traversal.zip', zip(new Map([['../escape.btl', bytes]])))).valid, 'archive traversal rejected');
  check(!(await inspect('duplicates.zip', zip(new Map([['original/a.btl', bytes], ['original/A.btl', bytes]])))).valid, 'case-insensitive archive duplicates rejected');
  check((await inspect('renamed.btl', await (await editor.fetch('export-btl', { revision: author.revision, scenario: 'conquest1' })).arrayBuffer())).valid, 'renamed conquest BTL auto-detects game mode');
  check(JSON.stringify(snapshot(await editor.request('author'))) === JSON.stringify(snapshot(author)), 'file inspections do not mutate author state or history');
  await editor.request('history', { revision: author.revision, direction: 'undo' });
  check(!((await editor.request('project')).scenarios.some(s => s.id === 'custom_eastasia_test')), 'undo removes created scenario');
  const undone = await editor.request('author');
  check(JSON.stringify(snapshot(undone)) === JSON.stringify(snapshot(initial)), 'undo restores original files and scenario list');
  await editor.request('history', { revision: undone.revision, direction: 'redo' });
  check((await editor.request('project')).scenarios.some(s => s.id === 'custom_eastasia_test'), 'redo restores created scenario');
  const redone = await editor.request('author');
  await editor.stop();
  const restarted = await startEditor(5342, 'scenario-tools-restart', editor.home);
  try { check(JSON.stringify(snapshot(await restarted.request('author'))) === JSON.stringify(snapshot(redone)), 'created scenario survives restart'); }
  finally { await restarted.stop(); }
  console.log(`Scenario creation and export inspection: ${checks} checks passed.`);
} finally { await editor.stop(); }
