import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, startEditor, dll } from './helpers/editor.mjs';

let editor = await startEditor(5198, 'unit-types');
const checks = [];
const check = (label, condition) => { assert(condition, label); checks.push(label); };
const apply = preview => editor.request('apply', { revision: preview.revision, taskId: preview.taskId, token: preview.token });
const preview = async (units, expected = 200) => editor.request('unit-types-preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), units }, expected);
const draft = (id, template, extra = {}) => ({ originalId: null, id, template, visualTemplate: template, name: '独立测试兵种', description: '保留原兵种的新类型', attributes: { max_health: 401 },
  recruitment: { buildingKinds: [template.includes('frigate') ? 'port' : 'city'], minimumLevel: 1, cost: { money: 87, industry: 13, food: 5 }, countries: ['fra'], scenarios: ['conquest1'] }, ...extra });
const artifact = join(editor.home, 'verification'); mkdirSync(artifact);
try {
  const initial = await editor.request('author');
  await editor.request('restore', { revision: initial.revision, document: JSON.stringify({ ...initial, scenarios: ['conquest1', 'conquest2'] }) });
  const before = await editor.request('author');
  const catalog = await editor.request('unit-types'); check('new engine detected', catalog.supported && catalog.units.length >= 369);
  const rows = [draft('editor.unit.rifle.0', 'ew4.unit.fra.militia.0'), draft('editor.unit.cruiser.0', 'ew4.unit.fra.frigate.0')];
  const p = await preview(rows);
  check('preview leaves author unchanged', JSON.stringify(await editor.request('author')) === JSON.stringify(before));
  await apply(p);
  let author = await editor.request('author');
  const decode = path => JSON.parse(Buffer.from(author.files[path], 'base64'));
  check('two independent profiles added', decode('legacy/units.json').units.filter(u => rows.some(r => r.id === u.id)).length === 2);
  check('old profiles retained', decode('legacy/units.json').units.find(u => u.id === 'ew4.unit.fra.militia.0').max_health === 60);
  check('independent recruitment groups', decode('client/manifest.json').profiles['editor.unit.rifle.0'].recruitGroup === 'editor.unit.rifle.0');
  check('explicit animation binding copied', decode('client/unit-visuals.json').profiles['editor.unit.rifle.0'] === 'Militia fra 1');
  check('two additive recruitment offers', decode('rewrite/unit-recruitment.json').offers.length === 2);
  for (const [label, units] of [
    ['duplicate ID', [rows[0]]], ['case collision', [draft('EDITOR.UNIT.RIFLE.0', 'ew4.unit.fra.militia.0')]],
    ['missing template', [draft('editor.unit.bad.0', 'missing.unit')]], ['bad profile value', [draft('editor.unit.bad.0', 'ew4.unit.fra.militia.0', { attributes: { max_health: -1 } })]],
    ['unknown attribute', [draft('editor.unit.bad.0', 'ew4.unit.fra.militia.0', { attributes: { typo: 10 } })]],
    ['unknown recruitment building', [draft('editor.unit.bad.0', 'ew4.unit.fra.militia.0', { recruitment: { ...rows[0].recruitment, buildingKinds: ['typo'] } })]],
  ]) { const rejected = await preview(units, 400); check(label + ' rejected', !!rejected.error); }
  check('invalid edits atomic', JSON.stringify(await editor.request('author')) === JSON.stringify(author));
  await editor.request('history', { revision: author.revision, direction: 'undo' });
  check('whole batch undo', JSON.stringify((await editor.request('author')).files) === JSON.stringify(before.files));
  await editor.request('history', { revision: (await editor.request('project')).revision, direction: 'redo' });
  author = await editor.request('author');
  const stale = await preview([draft('editor.unit.stale.0', 'ew4.unit.fra.militia.0')]);
  const change = await preview([draft('editor.unit.rifle.0', 'ew4.unit.fra.militia.0', { originalId: 'editor.unit.rifle.0', attributes: { max_health: 401, movement: 9 } })]);
  await apply(change); const rejected = await editor.request('apply', { revision: stale.revision, taskId: stale.taskId, token: stale.token }, 400);
  check('stale preview rejected', !!rejected.error);
  const commanderBefore = (await editor.request('project')).commanders.find(c => c.id === '1').movement;
  const commanderPreview = await editor.request('preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), scenarios: ['conquest1'],
    rules: [{ domain: 'commanders', field: 'movement', operation: 'add', value: 1, rounding: 'round', filter: { ids: [1] } }] });
  await apply(commanderPreview);
  check('split commander edits retain independent profiles', (await editor.request('unit-types')).units.some(u => u.id === 'editor.unit.rifle.0')
    && Number((await editor.request('project')).commanders.find(c => c.id === '1').movement) === Number(commanderBefore) + 1);
  const view = await editor.request('scenario/conquest1');
  const events = await editor.request('events/conquest1');
  const faction = view.factions.find(f => f.id === 'fra').index;
  // A generated list of legal opening cells comes from a native runtime check rather than hardcoded map coordinates.
  // Use the existing jurisdiction center list: cities and farmland are verified, traversable owned land.
  const candidates = view.jurisdictionEditing.centers.filter(c => c.country === events.factions.find(f => f.country === 'fra').id).map(c => c.cell);
  let deployed;
  for (const cell of candidates) {
    const response = await editor.fetch('unit-types-deploy-preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), scenario: 'conquest1', faction, profile: 'editor.unit.rifle.0', unit: 'editor.check.spawn', cell, ready: true });
    const body = await response.json();
    if (response.ok) { deployed = body; break; }
  }
  assert(deployed, 'expected an empty French opening city/farmland');
  await apply(deployed); checks.push('opening reinforcement preview and apply');
  const exports = await editor.fetch('export', { revision: (await editor.request('project')).revision, id: 'editor-unit-types', name: 'Independent unit check', version: '1.0' });
  if (!exports.ok) throw Error((await exports.text()).slice(0, 400));
  writeFileSync(join(artifact, 'units.ew4mod'), Buffer.from(await exports.arrayBuffer())); checks.push('standard Mod export');
  const home = editor.home; await editor.stop(); editor = await startEditor(5198, 'unit-types-restarted', home);
  check('restart retains new profile and deployment', (await editor.request('unit-types')).units.some(u => u.id === 'editor.unit.rifle.0') && (await editor.request('events/conquest1')).events.some(e => e.id === 'editor.spawn.editor.check.spawn'));
  const runtime = spawnSync('dotnet', ['run', '--project', 'tests/unit-runtime/UnitTypes.csproj', '-p:BridgeOutput=' + resolve(dll, '..'), '--', root, editor.home, artifact], { cwd: root, encoding: 'utf8', timeout: 240000 });
  assert.equal(runtime.status, 0, (runtime.stdout + runtime.stderr).slice(-2500));
  console.log(runtime.stdout.trim());
  console.log(JSON.stringify({ unitTypeEditorChecks: checks.length, errors: 0 }));
} finally { await editor.stop(); }
