import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const name='EW4-mod_editor';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}}).trim();
const credential=execFileSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
const token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
if(!token)throw Error('GitHub credential unavailable');
async function api(route,method='GET',body){
  const response=await fetch('https://api.github.com'+route,{method,signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','User-Agent':'ew4-mod-editor','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();if(!response.ok)throw Error(`${method} ${route}: HTTP ${response.status} ${data.message}`);return data;
}
const user=await api('/user');
if(process.argv[2]==='identity'){
  git('config','user.name',user.login);git('config','user.email',`${user.id}+${user.login}@users.noreply.github.com`);
  console.log(`Repository identity configured for ${user.login}`);
}else if(process.argv[2]==='create'){
  const existing=await fetch(`https://api.github.com/repos/${user.login}/${name}`,{headers:{Authorization:'Bearer '+token,'User-Agent':'ew4-mod-editor'}});
  if(existing.status!==404)throw Error('Repository name is already in use or unavailable; refusing to modify an existing repository');
  const created=await api('/user/repos','POST',{name,private:false,description:'European War 4 Rewrite batch Mod editor, based on the existing Vue/Canvas editor',auto_init:false});
  git('remote','add','origin',created.clone_url);console.log(JSON.stringify({url:created.html_url,visibility:created.visibility}));
}else if(process.argv[2]==='push-api'){
  const repo=`/repos/${user.login}/${name}`;
  let refs;
  try { refs=await api(repo+'/git/matching-refs/heads/'); }
  catch(error) { if(!error.message.includes('HTTP 409 Git Repository is empty'))throw error;refs=[]; }
  const checkpoint=join(root,'.local/github-upload.json');
  const uploadState=existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):{};
  let seed=uploadState.seed??null;
  if(refs.length && !(refs.length===1 && refs[0].ref==='refs/heads/main' && refs[0].object.sha===seed))
    throw Error('REST initial upload requires an empty repository or its own recorded initialization commit');
  const commit=execFileSync('git',['cat-file','commit','HEAD'],{cwd:root,encoding:'utf8'}),split=commit.indexOf('\n\n');
  const metadata=commit.slice(0,split).split('\n');
  if(metadata.some(line=>line.startsWith('parent ')))throw Error('REST initial upload requires a root commit');
  function person(kind){
    const match=metadata.find(line=>line.startsWith(kind+' ')).match(/^\w+ (.*) <(.*)> (\d+) ([+-]\d+)$/);
    if(match[4]!=='+0000')throw Error('UTC commit dates required to preserve exact commit identity');
    return {name:match[1],email:match[2],date:new Date(Number(match[3])*1000).toISOString()};
  }
  const author=person('author'),committer=person('committer');
  if(!refs.length){
    // GitHub rejects Git Database writes until an empty repository has its first commit.
    const initialized=await api(repo+'/contents/README.md','PUT',{message:'Initialize repository for source upload',
      content:Buffer.from(git('show','HEAD:README.md')+'\n').toString('base64'),author,committer});
    seed=initialized.commit.sha;writeFileSync(checkpoint,JSON.stringify({seed}));
  }
  const entries=git('ls-tree','-r','HEAD').split('\n').map(line=>{
    const [mode,type,sha,file]=line.split(/\s+/,4);if(type!=='blob')throw Error('Only regular source blobs are supported');return {path:file,mode,type,sha};
  });
  const known=new Set(uploadState.tree?(await api(repo+'/git/trees/'+uploadState.tree+'?recursive=1')).tree.map(e=>e.sha):[]);
  const blobs=[...new Set(entries.map(e=>e.sha))].filter(sha=>!known.has(sha));
  await Promise.all(Array.from({length:4},async()=>{
    while(blobs.length){
      const sha=blobs.shift();
      const bytes=execFileSync('git',['cat-file','blob',sha],{cwd:root,maxBuffer:32*1024*1024});
      const uploaded=await api(repo+'/git/blobs','POST',{content:bytes.toString('base64'),encoding:'base64'});
      if(uploaded.sha!==sha)throw Error('Source blob identity mismatch');
    }
  }));
  const tree=await api(repo+'/git/trees','POST',{tree:entries});
  if(tree.sha!==git('rev-parse','HEAD^{tree}'))throw Error('Remote source tree identity mismatch');
  writeFileSync(checkpoint,JSON.stringify({seed,tree:tree.sha}));
  const created=await api(repo+'/git/commits','POST',{message:commit.slice(split+2),tree:tree.sha,parents:[],author,committer});
  writeFileSync(checkpoint,JSON.stringify({seed,tree:tree.sha,commit:created.sha}));
  if(created.sha!==git('rev-parse','HEAD'))throw Error('Remote commit identity mismatch');
  const current=await api(repo+'/git/ref/heads/main');
  if(current.object.sha!==seed)throw Error('Remote changed during upload; refusing to replace it');
  await api(repo+'/git/refs/heads/main','PATCH',{sha:created.sha,force:true});
  console.log(JSON.stringify({uploaded:entries.length,tree:tree.sha,sha:created.sha}));
}else if(process.argv[2]==='verify'){
  const repo=await api(`/repos/${user.login}/${name}`);const head=await api(`/repos/${user.login}/${name}/commits/main`);
  if(repo.private||head.sha!==git('rev-parse','HEAD'))throw Error('Remote visibility or HEAD mismatch');
  console.log(JSON.stringify({url:repo.html_url,visibility:repo.visibility,sha:head.sha}));
}else throw Error('Usage: node tools/publish-repository.mjs identity|create|push-api|verify');
