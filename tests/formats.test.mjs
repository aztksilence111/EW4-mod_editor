import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

async function load(file) {
  const text = ts.transpileModule(readFileSync(resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
}
const { parseBtl, serializeBtl } = await load('src/core/formats/btl.ts');
const { inspectBtlReferences, assertValidBtlReferences } = await load('src/core/formats/btlValidation.ts');
const transactionSource = readFileSync('src/core/formats/btlTransactions.ts', 'utf8').replace(/^import .*\r?\n/, '');
const validationSource = readFileSync('src/core/formats/btlValidation.ts', 'utf8').replace(/^import .*\r?\n/, '').replace(/export interface[\s\S]*?\n}\r?\n\r?\n/, '').replace(/export /g, '');
const transactionText = ts.transpileModule(validationSource + '\n' + transactionSource.replace(/^import .*\r?\n/, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const transaction = await import('data:text/javascript;base64,' + Buffer.from(transactionText).toString('base64'));
const { addArmy, removeArmy, addBuild, removeBuild, BtlTransactionError } = transaction;
const { parseBin, serializeBin } = await load('src/core/formats/bin.ts');
const { serializeProject, reviveProject } = await load('src/core/storage/projectPack.ts');
const arrayBuffer = bytes => Uint8Array.from(bytes).buffer;
const btlFiles = ['campaigns','conquests'].flatMap(dir => readdirSync('public/' + dir).filter(f => f.endsWith('.btl')).map(f => `public/${dir}/${f}`));

test('all 93 upstream BTL files round-trip byte for byte', () => {
  assert.equal(btlFiles.length, 93);
  for (const file of btlFiles) {
    const bytes = readFileSync(file);
    assert.deepEqual(Buffer.from(serializeBtl(parseBtl(arrayBuffer(bytes)))), bytes, file);
  }
});
test('BTL reference index accepts upstream records and exposes stable reverse references', () => {
  for (const file of btlFiles) {
    const project = parseBtl(arrayBuffer(readFileSync(file)));
    const report = inspectBtlReferences(project);
    assert.equal(report.valid, true, `${file}: ${report.errors.map(e => e.message).join('; ')}`);
    assert.equal(report.eventIds.length, project.events.length);
    for (const [cell, rows] of Object.entries(report.buildsByCell)) assert.equal(rows.length, 1, `${file} build ${cell}`);
  }
  const project = parseBtl(arrayBuffer(readFileSync(btlFiles[0])));
  project.events[0].eventID = project.events[1].eventID;
  assert.throws(() => assertValidBtlReferences(project), /事件 ID/);
  project.events[0].eventID = 999999;
  assert(inspectBtlReferences(project).warnings.some(e => e.code === 'dangling_event'));
});
test('BTL reference index checks absolute cells against the loaded world map', () => {
  const project = parseBtl(arrayBuffer(readFileSync('public/conquests/conquest1.btl')));
  assert.equal(inspectBtlReferences(project, { width: 79, height: 68 }).valid, true);
  const cell = project.builds[0].index;
  project.builds[0].index = 0;
  const report = inspectBtlReferences(project, { width: 79, height: 68 });
  assert.equal(report.valid, false);
  assert(report.errors.some(e => e.code === 'cell_outside_scenario'));
  project.builds[0].index = cell;
});
test('preserve-slot transactions clean references and roll back on conflicts', () => {
  const source = parseBtl(arrayBuffer(readFileSync('public/conquests/conquest1.btl')));
  const cell = source.armies[0].index;
  const before = JSON.stringify(source);
  const removed = removeArmy(source, cell);
  assert.equal(JSON.stringify(source), before);
  assert.equal(removed.project.armies.some(a => a.index === cell), false);
  assert(removed.project.armies.some(a => a.index < 0));
  assert.equal(removed.project.info.armyCount, source.info.armyCount);
  assert.equal(removed.project.info.shopCount, source.info.shopCount);
  assert.equal(removed.project.info.barCount, source.info.barCount);
  assert.throws(() => addArmy(source, { ...source.armies[0], index: cell }), BtlTransactionError);
  const buildCell = source.builds[0].index;
  const buildRemoved = removeBuild(source, buildCell);
  assert.equal(buildRemoved.project.builds.filter(b => b.index === buildCell).length, 0);
  const added = addBuild(buildRemoved.project, { ...source.builds[0], index: buildCell });
  assert.equal(added.project.builds.filter(b => b.index === buildCell).length, 1);
  assert.equal(added.project.info.buildCount, source.info.buildCount);
});
test('preserve-slot deletes keep co-located services, event effects and other entity bindings intact', () => {
  const project = parseBtl(arrayBuffer(readFileSync('public/conquests/conquest1.btl')));
  const cell = project.builds.find(b => project.armies.some(a => a.index === b.index)).index;
  project.shops.push({ index: cell, items: Array.from({ length: 14 }, () => ({ itemID: -1, number: 0 })) });
  project.bars.push({ index: cell, slot: 5, commanders: Array.from({ length: 5 }, () => ({ commanderID: -1, price: 0, industry: 0, medal: 0, round: 0 })) });
  project.fires.push({ index: cell, fireType: 1 });
  project.events.push(
    { eventID: 10000, trigger: 0, status: 0, round: 0, dialogue: 0, index: cell, legion: new Uint8Array(20) },
    { eventID: 10001, trigger: 1, status: 0, round: 0, dialogue: 0, index: cell, legion: new Uint8Array(20) },
  );
  project.armies.find(a => a.index === cell).event = 100;
  project.events.push({ eventID: 100, trigger: 1, status: 5, round: 0, dialogue: 0, index: cell, legion: new Uint8Array(20) });
  const armyBinding = removeBuild(project, cell).project.armies.find(a => a.index === cell);
  assert.equal(armyBinding.event, 100);
  const withoutArmy = removeArmy(project, cell).project;
  assert.equal(withoutArmy.shops.some(s => s.index === cell), true);
  assert.equal(withoutArmy.bars.some(b => b.index === cell), true);
  assert.equal(withoutArmy.fires.some(f => f.index === cell), true);
  assert.equal(withoutArmy.events.find(e => e.eventID === 10000).index, cell);
  assert.deepEqual(withoutArmy.events, project.events, 'event.index is an effect cell, not an entity trigger reference');
  const withoutBuild = removeBuild(withoutArmy, cell).project;
  assert.deepEqual(withoutBuild.shops, project.shops);
  assert.deepEqual(withoutBuild.bars, project.bars);
  assert.deepEqual(withoutBuild.fires, project.fires);
  assert.deepEqual(withoutBuild.events, project.events);
});

test('Rewrite export blocks incompatible draft tombstones until restored', () => {
  const source = parseBtl(arrayBuffer(readFileSync('public/conquests/conquest1.btl')));
  const row = source.armies[0];
  const removed = removeArmy(source, row.index).project;
  assert.throws(() => serializeBtl(removed), /Rewrite.*部队.*负 cell/);
  const restored = addArmy(removed, row).project;
  assert.deepEqual(Buffer.from(serializeBtl(restored)), Buffer.from(serializeBtl(source)));
  const siteRemoved = removeBuild(source, source.builds[0].index).project;
  assert.doesNotThrow(() => serializeBtl(siteRemoved));
  for (const [section, record, label] of [
    ['shops', { index: -1 }, '商店'], ['bars', { index: -1 }, '酒馆'], ['fires', { index: -1 }, '火焰'],
  ]) {
    const project = structuredClone(source);
    project[section].push(record);
    assert.throws(() => serializeBtl(project), new RegExp(`Rewrite.*${label}.*负 cell`));
  }
});

test('event bindings use signed bytes and effect coordinates are checked only when consumed', () => {
  const source = parseBtl(arrayBuffer(readFileSync('public/conquests/conquest1.btl')));
  source.events.push({ eventID: 0, trigger: 0, status: 0, round: 0, dialogue: -1, index: 999999, legion: new Uint8Array(20) });
  source.info.eventCount++;
  source.armies[0].event = 0;
  const bounds = { width: 79, height: 68 };
  assert.equal(inspectBtlReferences(source, bounds).valid, true);
  assert(!inspectBtlReferences(source, bounds).warnings.some(e => e.path === 'armies[0].event'));
  source.events[0].eventID = 99;
  assert(inspectBtlReferences(source, bounds).warnings.some(e => e.path === 'armies[0].event' && e.code === 'dangling_event'));
  source.armies[0].event = 128;
  assert(!inspectBtlReferences(source, bounds).warnings.some(e => e.path === 'armies[0].event'));
  source.armies[0].event = -1;
  assert(inspectBtlReferences(source, bounds).errors.some(e => e.code === 'event_reference_byte'));
  source.armies[0].event = 255;
  source.events[0].status = 5;
  assert(inspectBtlReferences(source, bounds).errors.some(e => e.code === 'event_cell'));
  source.events[0].status = 0;
  source.shops.push({ index: 0 }); source.info.shopCount++;
  source.bars.push({ index: 0 }); source.info.barCount++;
  assert.equal(inspectBtlReferences(source, bounds).valid, true, 'Commerce may exist outside the active scenario rectangle');
});
test('building additions preserve installation-only sites and reuse only explicit tombstones', () => {
  const source = parseBtl(arrayBuffer(readFileSync('public/conquests/conquest1.btl')));
  const installation = source.builds.find(b => b.constructionType === 255 && b.installationType > 0 && b.installationType < 255);
  assert(installation);
  assert.throws(() => addBuild(source, { ...source.builds[0], index: installation.index }), BtlTransactionError);
  const before = structuredClone(source.builds);
  const added = addBuild(source, { ...source.builds[0], index: 716 }).project;
  assert.deepEqual(added.builds.slice(0, before.length), before);
  assert.equal(added.builds.length, before.length + 1);
  const removed = removeBuild(added, 716).project;
  const reused = addBuild(removed, { ...source.builds[0], index: 716 }).project;
  assert.equal(reused.builds.length, added.builds.length);
  assert.deepEqual(reused.builds.slice(0, before.length), before);
  reused.builds.at(-1).bridges[0] = 99;
  assert.deepEqual(source.builds, before, 'New record bridge arrays must not alias the source project');
  const duplicate = structuredClone(source);
  duplicate.builds.push(structuredClone(installation));
  duplicate.info.buildCount++;
  assert(inspectBtlReferences(duplicate).errors.some(e => e.code === 'duplicate_cell'));
});
test('extended bytes survive a no-op and project save; body edits cannot bypass the bridge', () => {
  const body = readFileSync(btlFiles[0]);
  const trailer = Buffer.concat([Buffer.from('EW4XBTL\0'), Buffer.from([1,0,0,0,1,0,0,0]), Buffer.from('TEST'), Buffer.from([1,0,0,0,0,0,0,0,3,0,0,0]), Buffer.from('abc')]);
  const bytes = Buffer.concat([body,trailer]);
  const parsed = reviveProject(JSON.parse(JSON.stringify(serializeProject(parseBtl(arrayBuffer(bytes))))));
  assert.deepEqual(Buffer.from(serializeBtl(parsed)), bytes);
  parsed.legions[0].food++;
  assert.throws(() => serializeBtl(parsed), /Rewrite/);
});
test('truncation, invalid version and numeric overflow reject', () => {
  const body = readFileSync(btlFiles[0]);
  assert.throws(() => parseBtl(arrayBuffer(body.subarray(0,60))));
  assert.throws(() => parseBtl(arrayBuffer(body.subarray(0,body.length-1))));
  const badVersion = Buffer.from(body); badVersion.writeInt32LE(1,0); assert.throws(() => parseBtl(arrayBuffer(badVersion)));
  const parsed = parseBtl(arrayBuffer(body)); parsed.legions[0].food = 2**40; assert.throws(() => serializeBtl(parsed), /越界/);
});
test('BIN accepts the exact rewrite header and rejects old broken export and trailers', () => {
  for (const name of ['europe.bin','america.bin']) {
    const bytes = readFileSync('public/maps/' + name); const parsed = parseBin(arrayBuffer(bytes));
    assert.equal(Buffer.from(parsed.info.bom).toString(), 'YSAE');
    assert.deepEqual(Buffer.from(serializeBin(parsed)),bytes);
    parsed.tiles[0].backTile=256;assert.throws(()=>serializeBin(parsed),/越界/);
    const bad = Buffer.from(bytes); bad.set([0xef,0xbb,0xbf,0]); assert.throws(() => parseBin(arrayBuffer(bad)), /文件头/);
    assert.throws(() => parseBin(arrayBuffer(Buffer.concat([bytes,Buffer.alloc(1)]))));
  }
});
