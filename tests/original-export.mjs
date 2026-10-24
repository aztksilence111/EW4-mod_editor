import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, dll, startEditor } from './helpers/editor.mjs';

const editor = await startEditor(5208, 'original-export');
const checks = [];
const apply = p => editor.request('apply', { revision:p.revision, taskId:p.taskId, token:p.token });
const project = () => editor.request('project');
try {
  const initial = await editor.request('author');
  await editor.request('restore', { revision:initial.revision, document:JSON.stringify({...initial,scenarios:['conquest1','conquest2']}) });
  const source = path => readFileSync(join(root,'.local/rewrite/data',path));
  const commander = source('original/def_commander.xml').toString().replace('name="Napoleon"', 'name="Napoleon_Raw"');
  const draft = await editor.request('author');
  await editor.request('restore', { revision:draft.revision, document:JSON.stringify({...draft,files:{...draft.files,'original/def_commander.xml':Buffer.from(commander).toString('base64')}}) });
  await apply(await editor.request('preview', { revision:(await project()).revision,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[{domain:'commanders',field:'infantry',operation:'add',value:1,filter:{ids:[1]}}] }));
  const frames = ['fra','rus','gbr','aus'].map(id => source(`client/ui/image_flag_hd/${id}1.png`).toString('base64'));
  await apply(await editor.request('countries-preview', { revision:(await project()).revision,taskId:crypto.randomUUID(),countries:[
    {originalId:null,id:'raw.republic',name:'原格式共和国',color:'#318b6a',unitVariant:'fra',visualVariant:'fra',flag:'fra',frames,image:frames[1]},
    {originalId:'fra',id:'fra',name:'原格式法国',color:'#318b6a',unitVariant:'fra',visualVariant:'fra',flag:'fra'}
  ],assignments:[{scenario:'conquest1',faction:0,country:'raw.republic'}] }));
  await apply(await editor.request('preview', { revision:(await project()).revision, taskId:crypto.randomUUID(), scenarios:['conquest1'], rules:[{domain:'factions',field:'food',operation:'add',value:17,filter:{country:'fra'}}] }));
  await apply(await editor.request('events-preview', { revision:(await project()).revision, taskId:crypto.randomUUID(),scenario:'conquest1',faction:0,
    events:[{id:'root',condition:{type:'round',value:999},effects:[],popup:{title:'Raw export',text:'Branch',choices:[{id:'yes',text:'Yes',effects:[]}]}},{id:'next',condition:{type:'always'},effects:[{type:'state',key:'scenario/original-export',value:7}]}],
    graph:{links:[{id:'branch',source:'root',target:'next',kind:'result',choice:'yes'}],positions:{root:{x:50,y:50},next:{x:400,y:50}},joins:{}} }));
  const before = await editor.request('author'); const revision = before.revision;
  const zip = await editor.fetch('export-original', {revision}); assert.equal(zip.status,200,await zip.clone().text());
  assert.match(zip.headers.get('content-disposition'),/original-resources.zip/);
  const output = join(root,'.local/runtime-compatibility'); mkdirSync(output,{recursive:true});
  writeFileSync(join(output,'original-resources.zip'),Buffer.from(await zip.arrayBuffer()));
  for (const scope of ['commanders','countries']) {
    const scoped = await editor.fetch('export-original',{revision,scope});
    assert.equal(scoped.status,200,await scoped.clone().text());
    assert.match(scoped.headers.get('content-disposition'),new RegExp(scope+'-resources.zip'));
    writeFileSync(join(output,scope+'-resources.zip'),Buffer.from(await scoped.arrayBuffer()));
  }
  for (const scope of ['project','commanders','countries']) {
    const legacy = await editor.fetch('export-original',{revision,scope,layout:'legacy'});
    assert.equal(legacy.status,200,await legacy.clone().text());
    assert.match(legacy.headers.get('content-disposition'),/assets-resources.zip/);
    writeFileSync(join(output,scope+'-assets-resources.zip'),Buffer.from(await legacy.arrayBuffer()));
  }
  checks.push('legacy assets paths and PNG/XML atlases export alongside complete Rewrite resources and a path report');
  checks.push('commander and country resource ZIPs retain shared definitions, portraits, flags, bindings and event dependencies');
  const single = await editor.fetch('export-btl',{revision,scenario:'conquest1'}); assert.equal(single.status,200,await single.clone().text());
  assert.match(single.headers.get('content-disposition'),/conquest1.btl/);
  const bytes = Buffer.from(await single.arrayBuffer());
  assert.deepEqual(bytes,Buffer.from(before.files['original/conquest1.btl'],'base64'));
  writeFileSync(join(output,'original-conquest1.btl'),bytes);
  const unchanged = await editor.fetch('export-btl',{revision,scenario:'conquest2'}); assert.equal(unchanged.status,200);
  const baseline = await editor.request('scenario/conquest2');
  assert.deepEqual(Buffer.from(await unchanged.arrayBuffer()),Buffer.from(baseline.bytes,'base64'));
  checks.push('original ZIP and single BTL download with original names and unchanged bytes');
  await editor.request('export-original',{revision:revision-1},400);
  await editor.request('export-original',{revision,scope:'../countries'},400);
  await editor.request('export-original',{revision,scope:null},400);
  await editor.request('export-original',{revision,layout:'../assets'},400);
  await editor.request('export-btl',{revision:revision-1,scenario:'conquest1'},400);
  await editor.request('export-btl',{revision,scenario:'../conquest1'},400);
  await editor.request('export-btl',{revision,scenario:'campaign1_01'},400);
  assert.deepEqual(await editor.request('author'),before); checks.push('all export modes preserve author state and reject stale or unknown scenarios');
  const mod = await editor.fetch('export',{revision,id:'original-export-check',name:'Original export check',version:'1.0.0'});
  assert.equal(mod.status,200,await mod.clone().text());
  writeFileSync(join(output,'original-resources.ew4mod'),Buffer.from(await mod.arrayBuffer()));
  const runtime = spawnSync('dotnet',['run','--project','tests/runtime/RuntimeCompatibility.csproj','-p:BridgeOutput='+dirname(dll),'--',root,'--original-export'],{cwd:root,encoding:'utf8',timeout:180000});
  assert.equal(runtime.status,0,runtime.stdout+runtime.stderr); checks.push('resource ZIP preserves event tree files and runs as a Rewrite resource overlay');
  checks.push('ew4mod export remains available with equivalent resource bytes');
  writeFileSync(join(root,'.local/original-export-result.json'),JSON.stringify({checks:checks.length,cases:checks,home:editor.home},null,2));
  console.log(JSON.stringify({checks:checks.length,cases:checks,runtime:runtime.stdout.trim()}));
} finally { await editor.stop(); }
