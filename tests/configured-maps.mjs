import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { startEditor } from './helpers/editor.mjs';

async function format(file) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
const { parseBtl } = await format('src/core/formats/btl.ts');
const { parseBin } = await format('src/core/formats/bin.ts');
const editor = await startEditor(5345, 'configured-maps');
const results = [];
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
try {
  const initial = await editor.request('author');
  await editor.request('restore', { revision: initial.revision, document: JSON.stringify({ ...initial, scenarios: ['conquest1'] }) });
  const maps = await editor.request('maps');
  for (const name of ['japan', 'hre']) {
    const map = maps.find(m => m.name === name);
    check(map?.width > 0 && map.height > 0, name + ': map registered');
    let { revision } = await editor.request('project');
    const id = 'custom_full_' + name;
    await editor.request('new-scenario', { revision, id, mapId: map.id, template: 'conquest1' });
    const view = await editor.request('scenario/' + id);
    const terrainResponse = await editor.fetch('terrain/' + map.id);
    const terrain = parseBin(await terrainResponse.arrayBuffer());
    const btl = parseBtl(Uint8Array.from(Buffer.from(view.bytes, 'base64')).buffer);
    check(btl.info.mapId === map.id && btl.info.mapX === 0 && btl.info.mapY === 0, name + ': correct world and origin');
    check(btl.info.mapW === terrain.info.mapW && btl.info.mapH === terrain.info.mapH && btl.tiles.length === terrain.tiles.length, name + ': full BIN rectangle without crop');
    check(btl.tiles.every(t => t.legion === 255) && view.reverseReferences.valid, name + ': clean initial ownership and references');
    const land = view.jurisdictionEditing.editableCells;
    const cell = land.at(-1);
    check(Number.isInteger(cell) && cell >= 0, name + ': land editable near the map end');
    ({ revision } = await editor.request('project'));
    const preview = await editor.request('preview', { revision, taskId: crypto.randomUUID(), scenarios: [id], rules: [
      { domain: 'territory', field: 'owner', operation: 'set', value: 0, rounding: 'round', targetCountry: view.factions[0].id, filter: { mapId: map.id, cells: [cell] } },
    ] });
    check(preview.count > 0, name + ': far-edge territory edit preview');
    await editor.request('apply', { revision, taskId: preview.taskId, token: preview.token });
    const author = await editor.request('author');
    const response = await editor.fetch('export-btl', { revision: author.revision, scenario: id });
    check(response.ok, name + ': full BTL exports');
    const exported = Buffer.from(await response.arrayBuffer());
    const edited = parseBtl(Uint8Array.from(exported).buffer);
    check(edited.tiles[cell].legion === view.factions[0].index, name + ': exported far-edge ownership and coordinate correct');
    const report = await editor.request('inspect-export', { name: id + '.btl', data: exported.toString('base64') });
    check(report.valid, name + ': real engine startup passes: ' + JSON.stringify(report.issues.filter(i => i.severity === 'error')));
    const out = resolve('.local/scenario-tools/configured-maps');
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, id + '.btl'), exported);
    writeFileSync(resolve(out, id + '.check.json'), JSON.stringify(report, null, 2));
    results.push({ name, id: map.id, width: map.width, height: map.height, cells: btl.tiles.length, verifiedCell: cell, valid: report.valid });
  }
  const out = resolve('.local/scenario-tools/configured-maps');
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify({ checks, maps: results }, null, 2));
  console.log(JSON.stringify({ checks, maps: results }));
} finally { await editor.stop(); }
