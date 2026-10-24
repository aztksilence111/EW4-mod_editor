import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { root, startEditor } from './helpers/editor.mjs';

// Use the live UI with an isolated API; never change the preview author's data.
const ui = process.env.EW4_EDITOR_UI_URL || 'http://127.0.0.1:5175';
const editor = await startEditor(5209,'browser-original-export');
let browser;
const checks = [];
try {
  const initial = await editor.request('author');
  await editor.request('restore',{revision:initial.revision,document:JSON.stringify({...initial,scenarios:['conquest1','conquest2']})});
  const before = await editor.request('author');
  browser = await chromium.launch({channel:'msedge',headless:true});
  mkdirSync(join(root,'.local/screenshots'),{recursive:true});
  for (const viewport of [{width:1440,height:960},{width:390,height:844}]) {
    const page = await browser.newPage({viewport});
    const errors = [], requests = [];
    page.on('pageerror',e => errors.push(e.message));
    page.on('response',r => {if(r.status()>=400 && !r.url().endsWith('favicon.ico')) errors.push(r.status()+' '+r.url());});
    await page.route('**/editor-api/**',async route => {
      const request = route.request();
      if(request.method()==='POST' && request.url().includes('/export')) requests.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});
      const response = await route.fetch({url:editor.base + request.url().split('/editor-api/')[1],timeout:300000});
      await route.fulfill({response});
    });
    await page.goto(ui,{waitUntil:'networkidle'});
    await expect(page.getByLabel('当前剧本',{exact:true})).toBeEnabled({timeout:120000});
    await page.getByRole('button',{name:'内容编辑',exact:true}).click();
    const idle = () => expect(page.locator('.content-workspace')).toHaveAttribute('aria-busy','false',{timeout:180000});
    const download = async (button,filename,signature) => {
      const [file] = await Promise.all([page.waitForEvent('download',{timeout:300000}),button.click()]);
      assert.equal(file.suggestedFilename(),filename);
      const bytes = readFileSync(await file.path()); assert(bytes.length>100);
      if(signature) assert.equal(bytes.subarray(0,2).toString(),signature);
      await idle();
    };
    await idle();
    await page.getByLabel('将领资源目录',{exact:true}).selectOption('legacy');
    await download(page.getByRole('button',{name:'导出将领资源 ZIP',exact:true}),'commanders-assets-resources.zip','PK');
    assert.equal(requests.at(-1).body.scope,'commanders'); assert.equal(requests.at(-1).body.layout,'legacy');
    await page.getByRole('button',{name:'国家',exact:true}).click();
    const countryExport=page.getByRole('button',{name:'导出国家资源 ZIP',exact:true});
    await expect(countryExport).toBeEnabled();
    await page.getByTitle('添加国家',{exact:true}).click(); await expect(countryExport).toBeDisabled();
    await page.getByTitle('重置国家修改',{exact:true}).click(); await expect(countryExport).toBeEnabled();
    await download(countryExport,'countries-resources.zip','PK');
    assert.equal(requests.at(-1).body.scope,'countries');
    await page.getByRole('button',{name:'验证导出',exact:true}).click();
    await page.getByLabel('导出格式',{exact:true}).selectOption('original');
    await page.getByLabel('资源范围',{exact:true}).selectOption('project');
    await page.getByLabel('资源目录布局',{exact:true}).selectOption('legacy');
    await page.locator('.export-panel').evaluate(el => { el.scrollTop=el.scrollHeight; });
    await page.screenshot({path:join(root,`.local/screenshots/original-export-${viewport.width}.png`)});
    await download(page.getByRole('button',{name:'校验并导出资源 ZIP',exact:true}),'my-rewrite-mod-assets-resources.zip','PK');
    assert.equal(requests.at(-1).body.layout,'legacy'); assert.equal(requests.at(-1).body.scope,'project');
    await page.getByLabel('导出格式',{exact:true}).selectOption('btl');
    await download(page.getByRole('button',{name:'校验并导出 .btl',exact:true}),'conquest1.btl');
    assert.equal(requests.at(-1).path,'/editor-api/export-btl');
    if(viewport.width===1440) {
      await page.getByLabel('导出格式',{exact:true}).selectOption('mod');
      await download(page.getByRole('button',{name:'校验并导出 .ew4mod',exact:true}),'my-rewrite-mod.ew4mod','PK');
    }
    assert.deepEqual(errors,[]); checks.push(`${viewport.width}: scoped resource layouts, pending-country guard, original ZIP/BTL downloads, no browser errors`);
    await page.unrouteAll({behavior:'ignoreErrors'}); await page.close();
  }
  assert.deepEqual(await editor.request('author'),before);
  writeFileSync(join(root,'.local/browser-original-export-result.json'),JSON.stringify({checks,home:editor.home},null,2));
  console.log(JSON.stringify({checks}));
} catch(error) {
  if(browser) for(const page of browser.contexts().flatMap(c=>c.pages())) {
    await page.screenshot({path:join(root,'.local/screenshots/original-export-failure.png')}).catch(()=>{});
    console.error(await page.locator('[role=status]').allTextContents().catch(()=>[]));
    await page.unrouteAll({behavior:'ignoreErrors'});
  }
  throw error;
} finally {if(browser) await browser.close(); await editor.stop();}
