import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, dll, startEditor } from './helpers/editor.mjs';

let editor = await startEditor(5206, 'event-graphs');
const checks = [];
const project = () => editor.request('project');
const apply = p => editor.request('apply', { revision: p.revision, taskId: p.taskId, token: p.token });
const preview = async (events, graph, faction = 0, scenario = 'conquest1', status = 200, legacy = []) => editor.request('events-preview', { revision: (await project()).revision, taskId: crypto.randomUUID(), scenario, faction, events, graph, legacy }, status);
const event = (id, key = id) => ({ id, condition: { type: 'always' }, effects: [{ type: 'state', key: 'scenario/' + key, value: 1 }] });
const link = (id, source, target, kind = 'condition', choice) => ({ id, source, target, kind, ...(choice ? { choice } : {}) });
try {
  const author = await editor.request('author');
  await editor.request('restore', { revision: author.revision, document: JSON.stringify({ ...author, scenarios: ['conquest1', 'conquest2', 'campaign1_01'] }) });
  const events = [
    { id: 'root', condition: { type: 'round', value: 999 }, effects: [{ type: 'food', value: 31 }], popup: { title: 'Branch', text: 'Choose', choices: [{ id: 'yes', text: 'Yes', effects: [] }, { id: 'no', text: 'No', effects: [] }] } },
    event('left'), event('right'), event('join'), event('rejected'), event('either'),
  ];
  const graph = { links: [link('a','root','left','result','yes'), link('b','root','right','result','yes'), link('c','left','join'), link('d','right','join'), link('e','root','rejected','result','no'), link('f','left','either'), link('g','rejected','either')],
    positions: { root: { x: 30, y: 60 }, left: { x: 360, y: 10 }, right: { x: 360, y: 260 }, join: { x: 700, y: 90 } }, joins: { join: 'all', either: 'any' } };
  const initial = await editor.request('author'); const p = await preview(events, graph);
  assert.deepEqual(await editor.request('author'), initial); await apply(p);
  let loaded = await editor.request('events/conquest1?faction=0'); assert.deepEqual(loaded.events, events);
  for (const key of ['links','positions','joins']) assert.deepEqual(loaded.graph[key], graph[key]); checks.push('scoped graph preview is atomic and source/positions/links round-trip');
  const other = [{ ...event('root','other-country'), condition: { type: 'round', value: 1000 } }];
  await apply(await preview(other, {}, 1));
  await apply(await preview([{ ...event('root','other-btl'), condition: { type: 'round', value: 1000 } }], {}, 0, 'conquest2'));
  assert.deepEqual((await editor.request('events/conquest1?faction=0')).events, events);
  assert.deepEqual((await editor.request('events/conquest1?faction=1')).events, other);
  const compiled = (await editor.request('events/conquest1')).events;
  assert.equal(new Set(compiled.map(e => e.id)).size, 7); checks.push('same local IDs remain isolated across countries and BTLs');
  const beforeErrors = await editor.request('author');
  await preview(events, { ...graph, links: [...graph.links, link('bad','missing','left')] }, 0, 'conquest1', 400);
  await preview(events, { ...graph, links: [...graph.links, link('cycle','join','root')] }, 0, 'conquest1', 400);
  await preview(events, { ...graph, links: [link('missing-choice','root','left','result','absent')] }, 0, 'conquest1', 400);
  await preview([...events, events[0]], graph, 0, 'conquest1', 400);
  await preview(events, { ...graph, joins: { join: 'invalid' } }, 0, 'conquest1', 400);
  await preview([{ ...event('invalid'), condition: { type: 'event_completed', key: 'missing' } }], {}, 0, 'conquest1', 400);
  await editor.request('events-preview', { revision: (await project()).revision, taskId: crypto.randomUUID(), scenario:'conquest1', events: [] }, 400);
  assert.deepEqual(await editor.request('author'), beforeErrors); checks.push('invalid links, cycles, choices, joins and references reject atomically');
  const changed = { ...graph, positions: { ...graph.positions, left: { x: 450, y: 150 } } };
  await apply(await preview(events, changed));
  await editor.request('history', { revision: (await project()).revision, direction: 'undo' });
  assert.deepEqual((await editor.request('events/conquest1?faction=0')).graph.positions, graph.positions);
  await editor.request('history', { revision: (await project()).revision, direction: 'redo' });
  assert.deepEqual((await editor.request('events/conquest1?faction=0')).graph.positions, changed.positions); checks.push('node movement persists through undo and redo');
  const native = await editor.request('events/campaign1_01'); const sample = native.legacy.find(e => native.factions.some(f => f.country === e.country));
  if (sample) {
    const slot = native.factions.findIndex(f => f.country === sample.country);
    const scoped = await editor.request('events/campaign1_01?faction=' + slot);
    assert(scoped.legacy.every(e => e.country === sample.country));
    await preview([], {}, (slot + 1) % native.factions.length, 'campaign1_01', 400, [{ ...sample, round: sample.round + 1 }]);
    checks.push('native BTL event edits cannot cross the selected country');
  }
  const countries = (await project()).countries;
  const gbr = countries.find(c => c.id === 'gbr');
  const renamed = { ...gbr, originalId: 'gbr', name: 'Same ID renamed' };
  await apply(await editor.request('countries-preview', { revision: (await project()).revision, taskId: crypto.randomUUID(), countries: [renamed] }));
  const strings = Buffer.from((await editor.request('author')).files['original/stringtable_cn.ini'],'base64').toString('utf8');
  assert(strings.includes('Same ID renamed')); assert.equal((await project()).countries.find(c => c.id === 'gbr').name, renamed.name); checks.push('same-ID country names synchronize into source strings');
  await apply(await editor.request('countries-preview', { revision: (await project()).revision, taskId: crypto.randomUUID(),
    countries: [{ originalId:null,id:'graph.owner',name:'Graph owner',color:'#218765',unitVariant:'fra',visualVariant:'fra',flag:'fra' }],
    assignments:[{scenario:'conquest1',faction:0,country:'graph.owner'}] }));
  assert.deepEqual((await editor.request('events/conquest1?faction=0')).events, events);
  assert(JSON.stringify((await editor.request('events/conquest1')).events).includes('conquest1.faction.0.graph.owner'));
  checks.push('country reassignment preserves its graph and rebinds compiled faction references');
  const home = editor.home; await editor.stop(); editor = await startEditor(5207,'event-graphs-restart',home);
  assert.deepEqual((await editor.request('events/conquest1?faction=0')).graph.positions, changed.positions); checks.push('scoped graph survives restart');
  const response = await editor.fetch('export', { revision: (await project()).revision, id:'event-graphs-check',name:'Event graph checks',version:'1.0.0' });
  assert.equal(response.status,200,await response.clone().text());
  mkdirSync(join(root,'.local/runtime-compatibility'),{recursive:true});
  writeFileSync(join(root,'.local/runtime-compatibility/event-graphs.ew4mod'),Buffer.from(await response.arrayBuffer()));
  const runtime = spawnSync('dotnet',['run','--project','tests/runtime/RuntimeCompatibility.csproj','-p:BridgeOutput='+dirname(dll),'--',root,'--event-graphs'],{cwd:root,encoding:'utf8',timeout:180000});
  assert.equal(runtime.status,0,runtime.stdout+runtime.stderr); checks.push('Rewrite executes choice branches, concurrent paths and all/any joins, and restores save');
  writeFileSync(join(root,'.local/event-graphs-result.json'),JSON.stringify({checks:checks.length,cases:checks,home},null,2));
  console.log(JSON.stringify({checks:checks.length,cases:checks,runtime:runtime.stdout.trim()}));
} finally { await editor.stop(); }
