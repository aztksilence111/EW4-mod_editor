import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const out = '.local/screenshots'; mkdirSync(out, { recursive:true });
const browser = await chromium.launch({ channel:'msedge', headless:true });
const report = [];
try {
  for (const viewport of [{width:1440,height:960},{width:390,height:844}]) {
    const page = await browser.newPage({viewport}); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url())});
    await page.goto('http://127.0.0.1:5174', {waitUntil:'networkidle'});
    await page.locator('.commanders-table tbody tr').first().waitFor({timeout:20000});
    await page.waitForFunction(()=>document.querySelector('canvas')?.width>0);
    const canvas=page.locator('canvas');
    const colors=await canvas.evaluate(el=>{
      const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;
      const colors=new Set(); for(let i=0;i<data.length;i+=Math.max(4,Math.floor(data.length/1600/4)*4))colors.add(`${data[i]},${data[i+1]},${data[i+2]}`); return colors.size;
    });
    assert(colors>12,'Canvas is blank');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Page overflows viewport');
    await page.screenshot({path:`${out}/commanders-${viewport.width}.png`});
    await page.getByRole('textbox',{name:'搜索将领'}).fill('Napoleon');
    assert((await page.locator('.commanders-table tbody tr').count())>=1);
    await page.locator('.commanders-table tbody tr').first().getByRole('checkbox').check();
    await page.getByRole('button',{name:'加入批处理'}).click();
    await page.getByRole('button',{name:'预览差异'}).click();
    await page.getByRole('button',{name:'应用整批'}).waitFor({timeout:120000});
    assert.equal(await page.locator('.diff-table tbody tr').count(),1);
    await page.screenshot({path:`${out}/preview-${viewport.width}.png`});
    await page.getByRole('button',{name:'验证导出',exact:true}).click();
    await page.getByRole('button',{name:'校验并导出 .ew4mod'}).waitFor();
    await page.screenshot({path:`${out}/export-${viewport.width}.png`});
    await page.getByRole('button',{name:'关闭面板'}).click();
    await page.screenshot({path:`${out}/map-${viewport.width}.png`});
    report.push({viewport,canvasColors:colors,errors}); assert.deepEqual(errors,[]);
    await page.close();
  }
  writeFileSync('.local/browser-result.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
