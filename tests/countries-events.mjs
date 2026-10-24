import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, dll, startEditor } from './helpers/editor.mjs';

let editor = await startEditor(5200, 'countries-events');
const checks = [];
const check = (name, action) => { action(); checks.push(name); };
const country = (id, name, extra = {}) => ({ originalId: id, id, name, color: '#247a4d80', unitVariant: 'fra', visualVariant: 'fra', flag: 'fra', ...extra });
const decoded = (author, path) => JSON.parse(Buffer.from(author.files[path], 'base64'));
const previewCountries = async (countries, assignments = [], expected = 200) => editor.request('countries-preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), countries, assignments }, expected);
const previewEvents = async (events, legacy = [], expected = 200, scenario = 'conquest1') => editor.request('events-preview', { revision: (await editor.request('project')).revision, taskId: crypto.randomUUID(), scenario, events, legacy }, expected);
const apply = preview => editor.request('apply', { revision: preview.revision, taskId: preview.taskId, token: preview.token });
try {
  const initial = await editor.request('author');
  await editor.request('restore', { revision: initial.revision, document: JSON.stringify({ ...initial, scenarios: ['conquest1','conquest2','campaign1_01'] }) });
  const before = await editor.request('author');
  const frames = ['fra','rus','gbr','aus'].map(c => readFileSync(join(root, `.local/rewrite/data/client/ui/image_flag_hd/${c}1.png`)).toString('base64'));
  const p = await previewCountries([
    country(null, '测试共和国', { id: 'test.republic', frames, image: frames[1] }),
    country('fra', '法兰西新名称', { id: '法兰西.test' }),
  ]);
  check('country preview is atomic', () => assert(p.count >= 3));
  assert.deepEqual(await editor.request('author'), before);
  await apply(p);
  let author = await editor.request('author');
  let registry = decoded(author, 'client/countries.json');
  check('country rename retains legacy alias', () => { assert.equal(registry.aliases.fra, '法兰西.test'); assert.equal(registry.countries['法兰西.test'].name, '法兰西新名称'); });
  const flag = registry.countries['test.republic'].flag;
  const atlas = decoded(author, 'client/manifest.json');
  check('four animation frames packed at both resolutions', () => { for (const name of ['buildings','buildings_hd']) for (let i = 1; i <= 4; i++) assert(atlas.atlases[name][flag + i + '.png']); });
  const frameHashes = new Set();
  for (let frame = 0; frame <= 4; frame++) {
    const response = await editor.fetch(`country-image?id=test.republic&frame=${frame}`);
    assert.equal(response.status, 200); const image = Buffer.from(await response.arrayBuffer()).toString('base64');
    if (frame > 0) frameHashes.add(image); else assert.equal(image, frames[1]);
  }
  check('custom animation frames remain distinct and menu image loads', () => assert.equal(frameHashes.size, 4));
  const invalidBefore = await editor.request('author');
  assert.match((await previewCountries([country(null, '重复国家', { id: 'test.republic' })], [], 400)).error, /已存在/);
  assert.match((await previewCountries([country(null, '错误帧数', { id: 'bad.frames', frames: frames.slice(0, 3) })], [], 400)).error, /4 帧/);
  assert.match((await previewCountries([country(null, '错误颜色', { id: 'bad.color', color: 'red' })], [], 400)).error, /color/);
  assert.match((await previewCountries([country(null, '错误兵种', { id: 'bad.variant', unitVariant: 'no_such_variant' })], [], 400)).error, /variant/);
  assert.deepEqual(await editor.request('author'), invalidBefore); checks.push('invalid IDs, incomplete PNG frames, colors and variants roll back');
  await editor.request('history', { revision: author.revision, direction: 'undo' });
  check('country batch undo', () => assert.equal((decoded(author, 'client/countries.json')).countries['test.republic'].name, '测试共和国'));
  const undone = await editor.request('author'); assert.deepEqual(undone.files, before.files);
  await editor.request('history', { revision: undone.revision, direction: 'redo' });
  author = await editor.request('author');
  const scenario = await editor.request('scenario/conquest1');
  const faction = scenario.factions.find(f => f.id === 'fra').index;
  const assignment = await previewCountries([], [{ scenario: 'conquest1', faction, country: 'test.republic' }]); await apply(assignment);
  check('new country binds via CNTR without changing base bytes', () => assert.equal(assignment.changes[0].after, 'test.republic'));
  const afterBinding = await editor.request('scenario/conquest1'); assert.equal(afterBinding.factions[faction].id, 'test.republic');
  assert.equal(afterBinding.factions[faction].color >>> 0, 0x804d7a24);
  const events = [
    { id: 'supply', condition: { type: 'round', compare: 'ge', value: 999 }, effects: [{ type: 'add_state', key: 'scenario/supply', value: 1 }, { type: 'food', value: 25 }] },
    { id: 'council', condition: { type: 'all', conditions: [{ type: 'event_completed', key: 'supply' }, { type: 'state', key: 'scenario/supply', value: 1 }] }, effects: [{ type: 'money', value: 5 }], popup: { title: '军议', text: '测试分支', choices: [{ id: 'yes', text: '接受', effects: [{ type: 'state', key: 'scenario/branch', value: 7 }] }, { id: 'no', text: '拒绝', effects: [{ type: 'state', key: 'scenario/branch', value: 8 }] }] } },
    { id: 'aftermath', condition: { type: 'event_completed', key: 'council' }, effects: [{ type: 'state', key: 'scenario/complete', value: 1 }] },
  ];
  const eventBefore = await editor.request('author');
  const eventPreview = await previewEvents(events); assert.deepEqual(await editor.request('author'), eventBefore); await apply(eventPreview);
  const loaded = await editor.request('events/conquest1'); assert.deepEqual(loaded.events, events); checks.push('event condition tree and popup branches round-trip');
  await apply(await previewEvents([{ id: 'other-scenario', condition: { type: 'round', value: 1000 }, effects: [] }], [], 200, 'conquest2'));
  const invalidEvents = await editor.request('author');
  await previewEvents([...events, events[0]], [], 400);
  await previewEvents([{ ...events[0], condition: { type: 'event_completed', key: 'missing' } }], [], 400);
  await previewEvents([{ ...events[0], effects: [{ type: 'unknown', value: 1 }] }], [], 400);
  assert.deepEqual(await editor.request('author'), invalidEvents); checks.push('duplicate events, missing dependencies and unknown effects rejected atomically');
  const nativeDocument = await editor.request('events/campaign1_01');
  assert(nativeDocument.legacy.length > 0);
  {
    const native = nativeDocument.legacy.find(e => e.effect !== 5) ?? nativeDocument.legacy[0];
    const edit = { ...native, round: native.round + 1 };
    await apply(await previewEvents(nativeDocument.events, [edit], 200, 'campaign1_01'));
    const updated = await editor.request('events/campaign1_01'); assert.equal(updated.legacy[native.slot].round, edit.round);
    checks.push('BTL event edits retain CNTR and event bindings');
  }
  author = await editor.request('author');
  await editor.request('restore', { revision: author.revision, document: JSON.stringify(author) });
  registry = decoded(await editor.request('author'), 'client/countries.json');
  assert.equal(registry.countries['法兰西.test'].name, '法兰西新名称'); assert(registry.countries['test.republic']);
  check('restore preserves added countries, custom names and event groups', () => assert.equal(decoded(author, 'rewrite/editor-events.json').conquest2[0].id, 'other-scenario'));
  const home = editor.home; await editor.stop(); editor = await startEditor(5202, 'countries-events-restart', home);
  assert.deepEqual((await editor.request('events/conquest1')).events, events); checks.push('restart restores resource and event transactions');
  const latest = await editor.request('project');
  const exported = await editor.fetch('export', { revision: latest.revision, id: 'country-events-check', name: 'Country events check', version: '1.0.0' });
  assert.equal(exported.status, 200, await exported.clone().text());
  const directory = join(root, '.local/runtime-compatibility'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'countries-events.ew4mod'), Buffer.from(await exported.arrayBuffer()));
  const runtime = spawnSync('dotnet', ['run', '--project', 'tests/runtime/RuntimeCompatibility.csproj', '-p:BridgeOutput=' + dirname(dll), '--', root, '--countries-events'], { cwd: root, encoding: 'utf8', timeout: 180000 });
  assert.equal(runtime.status, 0, runtime.stdout + runtime.stderr); checks.push('standard export starts, executes branch tree and restores save in Rewrite');
  writeFileSync(join(root, '.local/countries-events-result.json'), JSON.stringify({ checks: checks.length, cases: checks, home }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, cases: checks, runtime: runtime.stdout.trim() }));
} finally { await editor.stop(); }
