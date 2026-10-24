import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, dll, startEditor } from './helpers/editor.mjs';

let editor=await startEditor(5210,'jurisdictions');
const checks=[];
const apply=p=>editor.request('apply',{revision:p.revision,taskId:p.taskId,token:p.token});
const preview=async(cells,center,expected=200)=>editor.request('preview',{
  revision:(await editor.request('project')).revision,taskId:crypto.randomUUID(),scenarios:['conquest1'],
  rules:[{domain:'jurisdictions',field:'center',operation:'set',value:0,center,filter:{cells,mapId:1}}]},expected);
try {
  const initial=await editor.request('author');
  await editor.request('restore',{revision:initial.revision,document:JSON.stringify({...initial,scenarios:['conquest1','conquest2','campaign1_01']})});
  const source=await editor.request('scenario/conquest1'),data=source.jurisdictionEditing;
  const local=cell=>(Math.floor(cell/source.mapWidth)-data.top)*data.width+cell%source.mapWidth-data.left;
  assert(data.supported && data.centers.length>0 && data.editableCells.length>0);
  assert(data.centers.every(c=>source.effectiveJurisdictions[local(c.cell)]===c.cell));
  assert(data.editableCells.every(c=>!data.centers.some(root=>root.cell===c)));
  const campaign=(await editor.request('scenario/campaign1_01')).jurisdictionEditing;
  assert.equal(campaign.supported,true);assert(campaign.centers.length>0);
  checks.push('runtime-derived centers and editable land cells are available for conquest and campaign modes');
  const cell=data.editableCells.find(c=>source.effectiveJurisdictions[local(c)]>=0);assert.notEqual(cell,undefined);
  const before=await editor.request('author');
  const p=await preview([cell],-1);
  assert(p.changes.some(c=>c.object==='JURI'&&c.field==='initialization'));
  assert.deepEqual(await editor.request('author'),before);
  await apply(p);
  const cleared=await editor.request('scenario/conquest1');
  assert.equal(cleared.jurisdictions[local(cell)],-1);
  assert(cleared.extensions.includes('JURI'));
  for(let i=0;i<source.effectiveJurisdictions.length;i++)if(i!==local(cell))assert.equal(cleared.jurisdictions[i],source.effectiveJurisdictions[i]);
  assert.equal(cleared.bytes,source.bytes,'legacy BTL body preserved');
  checks.push('preview is atomic; first JURI freezes all unselected automatic assignments and preserves body bytes');
  const target=data.centers.find(c=>c.cell!==source.effectiveJurisdictions[local(cell)]).cell;
  await apply(await preview([cell],target));
  const assigned=await editor.request('author');
  assert.equal((await editor.request('scenario/conquest1')).jurisdictions[local(cell)],target);
  assert.equal((await editor.request('scenario/conquest2')).jurisdictions,null);
  await preview([cell],-2,400);
  await preview([data.centers[0].cell],-1,400);
  const forbidden=Array.from({length:data.width*data.height},(_,i)=>(data.top+Math.floor(i/data.width))*source.mapWidth+data.left+i%data.width)
    .find(c=>!data.editableCells.includes(c)&&!data.centers.some(root=>root.cell===c));
  assert.notEqual(forbidden,undefined);await preview([forbidden],target,400);
  assert.deepEqual(await editor.request('author'),assigned);
  checks.push('reassignment is scenario-scoped; invalid centers, center removal and sea/port assignment reject atomically');
  await editor.request('history',{revision:assigned.revision,direction:'undo'});
  assert.equal((await editor.request('scenario/conquest1')).jurisdictions[local(cell)],-1);
  await editor.request('history',{revision:(await editor.request('project')).revision,direction:'redo'});
  const home=editor.home;await editor.stop();editor=await startEditor(5212,'jurisdictions-restart',home);
  const after=await editor.request('scenario/conquest1');assert.equal(after.jurisdictions[local(cell)],target);
  const out=join(root,'.local/runtime-compatibility');mkdirSync(out,{recursive:true});
  const response=await editor.fetch('export-btl',{revision:after.revision,scenario:'conquest1'});
  assert.equal(response.status,200,await response.clone().text());
  const exported=Buffer.from(await response.arrayBuffer());
  assert.deepEqual(exported,Buffer.from((await editor.request('author')).files['original/conquest1.btl'],'base64'));
  writeFileSync(join(out,'jurisdictions.btl'),exported);
  writeFileSync(join(out,'jurisdictions.json'),JSON.stringify({cell,target},null,2));
  const runtime=spawnSync('dotnet',['run','--project','tests/runtime/RuntimeCompatibility.csproj','-p:BridgeOutput='+dirname(dll),'--',root,'--jurisdictions'],{cwd:root,encoding:'utf8',timeout:180000});
  assert.equal(runtime.status,0,runtime.stdout+runtime.stderr);
  checks.push('undo/redo, restart, original BTL export and real Rewrite startup/save restore retain assignments');
  writeFileSync(join(root,'.local/jurisdictions-result.json'),JSON.stringify({checks,home},null,2));
  console.log(JSON.stringify({checks,runtime:runtime.stdout.trim()}));
} finally {await editor.stop();}
