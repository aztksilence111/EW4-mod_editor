import { spawn } from 'node:child_process';
import { mkdirSync, copyFileSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const home = join(root, '.local/tests', crypto.randomUUID());
mkdirSync(home, { recursive: true });
copyFileSync(join(root,'.local/baseline.json'), join(home,'baseline.json'));
symlinkSync(join(root,'.local/rewrite'), join(home,'rewrite'), 'junction');
const server = spawn('dotnet',['bridge/bin/Debug/net10.0/Ew4.Editor.dll'], { cwd:root, env:{...process.env,EW4_EDITOR_HOME:home,EW4_EDITOR_PORT:'5185'}, stdio:['ignore','pipe','pipe'] });
let logs=''; server.stdout.on('data',d=>{logs+=d}); server.stderr.on('data',d=>{logs+=d});
let checks=0;
const base='http://127.0.0.1:5185/editor-api/';
async function request(path,body,expected=200) {
  const response=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-EW4-Editor':'1'},body:JSON.stringify(body)});
  const data=await response.json(); assert.equal(response.status,expected,JSON.stringify(data)); checks++; return data;
}
function rule(domain,field,value,filter={},operation='add') { return {domain,field,value,filter,operation,rounding:'round'} }
function block(tag,payload,flags=1) {
  const data=Buffer.isBuffer(payload)?payload:Buffer.from(JSON.stringify(payload));const header=Buffer.alloc(16);
  header.write(tag,0,'ascii');header.writeUInt32LE(1,4);header.writeUInt32LE(flags,8);header.writeUInt32LE(data.length,12);return Buffer.concat([header,data]);
}
function container(body,blocks) {
  const header=Buffer.alloc(16);header.write('EW4XBTL\0',0,'ascii');header.writeUInt32LE(1,8);header.writeUInt32LE(blocks.length,12);return Buffer.concat([body,header,...blocks]);
}
function readBlocks(bytes,length) {
  const result=[];for(let cursor=length+16;cursor<bytes.length;){const end=cursor+16+bytes.readUInt32LE(cursor+12);result.push(bytes.subarray(cursor,end));cursor=end;}return result;
}
try {
  let ready=false;
  for(let i=0;i<100;i++){ try{const r=await fetch(base+'project');if(r.ok){ready=true;break}}catch{} await delay(100) }
  assert(ready,logs);
  const original=await request('project'); assert(original.commanders.length>500); assert.equal(original.scenarios.length,95);
  const source=await request('scenario/conquest1'); assert(source.factions.some(f=>f.id==='fra'));
  const taskId=crypto.randomUUID();
  const preview=await request('preview',{revision:0,taskId,scenarios:['conquest1','conquest2'],rules:[rule('commanders','cavalry',1,{ids:[1]}),rule('factions','food',100,{country:'fra'})]});
  assert.equal(preview.count,3); assert.equal(preview.affectedScenarios,95);
  const applied=await request('apply',{revision:0,taskId,token:preview.token}); assert.equal(applied.revision,1);
  const retry=await request('apply',{revision:0,taskId,token:preview.token}); assert.equal(retry.duplicate,true);
  const changed=await request('project'); assert.equal(Number(changed.commanders.find(c=>c.id==='1').cavalry),Number(original.commanders.find(c=>c.id==='1').cavalry)+1);
  await request('preview',{revision:0,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('factions','food',1)]},400);
  await request('preview',{revision:1,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('factions','food',2**40)]},400);
  assert.equal((await request('project')).revision,1);
  const stale=await request('preview',{revision:1,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('factions','food',1,{country:'fra'})]});
  await request('history',{revision:1,direction:'undo'});
  assert.deepEqual((await request('project')).commanders,original.commanders);
  assert.equal((await request('scenario/conquest1')).sha256,source.sha256);
  await request('apply',{revision:2,taskId:stale.taskId,token:stale.token},400);
  await request('history',{revision:2,direction:'redo'});
  const now=await request('project');
  const csvFields=['id','name','country','rank','nobilityrank','star','infantry','cavalry','artillery','warship','fort','business','movement','training','skill1','skill2','skill3','skill4','item1','item2'];
  const rows=now.commanders.map(c=>({schema:'1',sourceHash:now.commanderSourceHash,...Object.fromEntries(csvFields.map(key=>[key,c[key]]))}));
  const csv=await request('csv-preview',{revision:3,taskId:crypto.randomUUID(),rows}); assert.equal(csv.count,0);
  await request('csv-preview',{revision:3,taskId:crypto.randomUUID(),rows:[rows[0],rows[0]]},400);
  await request('csv-preview',{revision:3,taskId:crypto.randomUUID(),rows:[{...rows[0],surprise:'1'}]},400);
  await request('csv-preview',{revision:3,taskId:crypto.randomUUID(),rows:[{...rows[0],sourceHash:'old'}]},400);
  await request('csv-preview',{revision:3,taskId:crypto.randomUUID(),rows:[{...rows[0],skill1:'99'}]},400);
  const armyRule=rule('armies','training',1,{country:'fra'});
  const army=await request('preview',{revision:3,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[armyRule]}); assert(army.count>0);
  const buildings=await request('preview',{revision:3,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('builds','constructionLevel',1,{country:'fra'})]}); assert(buildings.count>0);
  await request('preview',{revision:3,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('factions','food',1,{country:'fra'}),rule('armies','armyGrade',99)]},400);
  assert.equal((await request('project')).revision,3);
  let revision=3;
  const current=await request('scenario/conquest1');const body=Buffer.from(current.bytes,'base64');
  const left=body.readInt32LE(8),top=body.readInt32LE(12),width=body.readInt32LE(16);
  const full=i=>(top+Math.floor(i/width))*current.mapWidth+left+i%width;
  const local=current.effectiveJurisdictions.findIndex((center,i)=>center>=0&&center!==full(i));assert(local>=0);
  const juri=await request('preview',{revision,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[{...rule('jurisdictions','center',0,{cells:[full(local)],mapId:current.mapId},'set'),center:-1}]});
  assert(juri.count>=1);await request('apply',{revision,taskId:juri.taskId,token:juri.token});revision++;
  const manual=await request('scenario/conquest1');assert.equal(manual.jurisdictions[local],-1);
  const withJuri=await request('author');const juriBytes=Buffer.from(withJuri.files['original/conquest1.btl'],'base64');
  const hash=createHash('sha256').update(body).digest('hex');
  const mixed=container(body,[...readBlocks(juriBytes,body.length),block('CNTR',{schema:1,baseSha256:hash,factions:current.factions.map(f=>f.id)}),block('VICT',{schema:1,baseSha256:hash,rules:{win:{type:'enemy_factions_defeated'}}})]);
  const mixedAuthor={...withJuri,files:{...withJuri.files,'original/conquest1.btl':mixed.toString('base64')}};
  await request('restore',{revision,document:JSON.stringify(mixedAuthor)});revision++;
  const owner=body[72+180*current.factions.length+local];const target=current.factions.find(f=>f.index!==owner).id;
  const known=await request('preview',{revision,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('factions','food',1,{country:'fra'}),{...rule('territory','owner',0,{cells:[full(local)],mapId:current.mapId},'set'),targetCountry:target}]});
  await request('apply',{revision,taskId:known.taskId,token:known.token});revision++;
  const rebound=await request('scenario/conquest1');assert.deepEqual([...rebound.extensions].sort(),['CNTR','JURI','VICT']);
  const newBody=Buffer.from(rebound.bytes,'base64'),newHash=createHash('sha256').update(newBody).digest('hex');
  const knownAuthor=await request('author');const newBytes=Buffer.from(knownAuthor.files['original/conquest1.btl'],'base64');
  const allowed=new Set([72+180*current.factions.length+local]);const food=72+180*current.factions.findIndex(f=>f.id==='fra')+8;
  for(let i=food;i<food+4;i++)allowed.add(i);
  for(let i=0;i<body.length;i++)if(!allowed.has(i))assert.equal(newBody[i],body[i],`Untouched BTL byte ${i}`);
  for(const b of readBlocks(newBytes,newBody.length)) {
    if(b.toString('ascii',0,4)==='JURI')assert.equal(b.subarray(48,80).toString('hex'),newHash);
    else assert.equal(JSON.parse(b.subarray(16)).baseSha256,newHash);
  }
  const optional=container(newBody,[...readBlocks(newBytes,newBody.length),block('TEST',Buffer.from('abc'),0)]);
  await request('restore',{revision,document:JSON.stringify({...knownAuthor,files:{...knownAuthor.files,'original/conquest1.btl':optional.toString('base64')}})});revision++;
  await request('preview',{revision,taskId:crypto.randomUUID(),scenarios:['conquest1'],rules:[rule('factions','food',1,{country:'fra'})]},400);
  assert.equal((await request('author')).files['original/conquest1.btl'],optional.toString('base64'));
  const required=container(newBody,[block('TEST',Buffer.from('abc'))]);
  await request('restore',{revision,document:JSON.stringify({...knownAuthor,files:{...knownAuthor.files,'original/conquest1.btl':required.toString('base64')}})},400);
  await request('restore',{revision,document:JSON.stringify(knownAuthor)});revision++;
  const bad=await fetch(base+'history',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); assert.equal(bad.status,403);checks++;
  const foreign=await fetch(base+'project',{headers:{Origin:'https://example.com'}});assert.equal(foreign.status,403);checks++;
  const validation=await request('validate',{});assert.equal(validation.scenarios,95);
  const author=await request('author');
  const exported=await fetch(base+'export',{method:'POST',headers:{'Content-Type':'application/json','X-EW4-Editor':'1'},body:JSON.stringify({revision,id:'editor-smoke-test',name:'Editor smoke test',version:'0.1.0'})});
  if(!exported.ok) throw Error(await exported.text());
  const bytes=Buffer.from(await exported.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');checks++;
  writeFileSync(join(home,'smoke.ew4mod'),bytes);
  await request('restore',{revision,document:JSON.stringify(author)});
  const report={checks,commanders:original.commanders.length,scenarios:95,changes:preview.count,packageBytes:bytes.length,home};
  writeFileSync(join(root,'.local/integration-result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {
  server.kill(); await new Promise(resolve=>server.once('exit',resolve));
}
