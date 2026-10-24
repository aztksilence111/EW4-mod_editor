import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { snapshot, foodRule } from './helpers/editor.mjs';
import { sha256 } from './helpers/import-fixture.mjs';
const out = '.local/screenshots'; mkdirSync(out, { recursive:true });
const fixture = process.env.EW4_EDITOR_BROWSER_FIXTURE ? JSON.parse(readFileSync(process.env.EW4_EDITOR_BROWSER_FIXTURE, 'utf8')) : null;
const browser = await chromium.launch({ channel:'msedge', headless:true });
const report = [];
try {
  for (const viewport of [{width:1440,height:960},{width:390,height:844}]) {
    const page = await browser.newPage({viewport}); const errors=[];
    const expectedDialogs = [];
    page.on('dialog', dialog => {
      if (dialog.type() === 'alert' && /Rewrite.*部队.*负 cell/.test(dialog.message())) {
        expectedDialogs.push(dialog.message()); dialog.accept(); return;
      }
      if (dialog.type() !== 'confirm') errors.push(`Unexpected ${dialog.type()}: ${dialog.message()}`);
      dialog.accept();
    });
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url())});
    await page.goto(process.env.EW4_EDITOR_UI_URL || 'http://127.0.0.1:5174', {waitUntil:'networkidle'});
    await page.locator('.commanders-table tbody tr').first().waitFor({timeout:20000});
    await expect(page.locator('.author-panel')).toHaveAttribute('aria-busy','false', { timeout:120000 });
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
    let importResult;
    if (process.env.EW4_EDITOR_BROWSER_PACKAGE) {
      const readAuthor = async () => {
        const response = await page.request.get(new URL('/editor-api/author', page.url()).href);
        assert(response.ok()); return response.json();
      };
      const post = async (path, body) => {
        const response = await page.request.post(new URL('/editor-api/' + path, page.url()).href, { data: body, headers: { 'X-EW4-Editor': '1' } });
        const data = await response.json(); assert(response.ok(), JSON.stringify(data)); return data;
      };
      const history = async direction => {
        const { revision } = await readAuthor();
        await page.getByTitle(direction === 'undo' ? '撤销整批' : '重做整批', { exact:true }).click();
        await expect(page.locator('.revision')).toHaveText(`r${revision + 1}`);
        await expect(page.locator('.author-panel')).toHaveAttribute('aria-busy', 'false');
      };
      const before = await readAuthor();
      const packageHash = sha256(readFileSync(process.env.EW4_EDITOR_BROWSER_PACKAGE));
      const mode = page.getByLabel('导入方式');
      const policy = page.getByLabel('文件冲突');
      const applyImport = page.getByRole('button',{name:'应用导入',exact:true});
      const previewImport = async () => {
        await page.getByRole('button',{name:'预览导入',exact:true}).click();
        await expect(page.locator('.author-panel')).toHaveAttribute('aria-busy', 'false', { timeout:600000 });
        await expect(page.locator('.feedback.error')).toHaveCount(0);
      };
      await page.locator('input[type=file][accept=".ew4mod"]').setInputFiles(process.env.EW4_EDITOR_BROWSER_PACKAGE);
      await mode.selectOption('replace');
      await previewImport();
      await expect(applyImport).toBeEnabled();
      assert((await page.locator('.import-diff tbody tr').count())>0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Import preview overflows viewport');
      assert.deepEqual(await readAuthor(), before, 'Preview changed author state');
      await applyImport.scrollIntoViewIfNeeded();
      await page.screenshot({path:`${out}/import-${viewport.width}.png`});
      await mode.selectOption('merge');
      await expect(applyImport).toHaveCount(0);
      await mode.selectOption('replace');
      await previewImport();
      await applyImport.click();
      await expect(page.getByRole('status')).toHaveText('内容包已导入并保存');
      const imported = await readAuthor();
      assert.equal(imported.sources[0].packageHash, packageHash);
      if (fixture) {
        assert.deepEqual(imported.files, fixture.files);
        assert.deepEqual(imported.scenarios, fixture.scenarios);
        await expect(page.getByLabel('当前剧本').locator('option')).toHaveCount(fixture.scenarios.length);
      }
      await page.screenshot({path:`${out}/import-applied-${viewport.width}.png`});
      await history('undo');
      assert.deepEqual(snapshot(await readAuthor()), snapshot(before));
      await history('redo');
      assert.deepEqual(snapshot(await readAuthor()), snapshot(imported));
      if (fixture) {
        const local = await post('preview', { revision:(await readAuthor()).revision, taskId:crypto.randomUUID(), scenarios:['conquest1'], rules:[foodRule(1)] });
        await post('apply', { revision:local.revision, taskId:local.taskId, token:local.token });
        await page.getByTitle('刷新工程', { exact:true }).click();
        await expect(page.locator('.author-panel')).toHaveAttribute('aria-busy','false');
        const edited = await readAuthor();
        await mode.selectOption('merge');
        await policy.selectOption('reject');
        await previewImport();
        await expect(page.locator('.export-panel')).toContainText('1 个文件冲突，');
        await expect(applyImport).toHaveCount(0);
        assert.deepEqual(await readAuthor(), edited);
        await page.screenshot({path:`${out}/import-conflict-${viewport.width}.png`});
        await policy.selectOption('keep');
        await previewImport();
        await expect(applyImport).toBeDisabled();
        assert.deepEqual(await readAuthor(), edited);
        await policy.selectOption('incoming');
        await expect(applyImport).toHaveCount(0);
        await previewImport();
        await expect(applyImport).toBeEnabled();
        await applyImport.click();
        await expect(page.getByRole('status')).toHaveText('内容包已导入并保存');
        assert.deepEqual(snapshot(await readAuthor()), snapshot(imported));
        await history('undo');
        assert.deepEqual(snapshot(await readAuthor()), snapshot(edited));
        await history('undo');
      }
      await history('undo');
      assert.deepEqual(snapshot(await readAuthor()), snapshot(before));
      importResult = { packageHash, applied:true, undoRedo:true, conflictPolicies:!!fixture };
    }
    await page.getByRole('button',{name:'关闭面板'}).click();
    await page.screenshot({path:`${out}/map-${viewport.width}.png`});
    // Exercise the original BTL editor's preserve-slot transaction through the UI.
    await page.getByRole('button',{name:'原版示例'}).click();
    await page.getByRole('button',{name:/欧洲地图/}).click();
    await page.getByRole('button',{name:/关卡功能/}).click();
    await page.getByRole('button',{name:'选择征服'}).click();
    await page.locator('.dialog .row').first().click();
    await expect(page.locator('.status-text')).toContainText('军团 19', { timeout: 120000 });
    const legacyCanvas = page.locator('canvas');
    const legacyBox = await legacyCanvas.boundingBox();
    assert(legacyBox, 'Legacy map canvas missing');
    const hexCenter = (x, y) => ({ x: x * 32 + (y % 2 ? 16 : 0) + 16, y: y * 27 + 18 });
    const start = hexCenter(2, 3), end = hexCenter(69, 55), target = hexCenter(5, 9);
    const pw = end.x - start.x + 32, ph = end.y - start.y + 36;
    const scale = Math.max(0.05, Math.min(4, Math.min(legacyBox.width / pw, legacyBox.height / ph) * 0.95));
    await page.mouse.click(legacyBox.x + legacyBox.width / 2 + (target.x - start.x - pw / 2) * scale,
      legacyBox.y + legacyBox.height / 2 + (target.y - start.y - ph / 2) * scale);
    await page.getByRole('button',{name:'编辑',exact:true}).click();
    await expect(page.locator('.panel')).not.toContainText('点击地图上的地块以读取信息');
    await page.locator('.panel .legion-box select').selectOption('0');
    const addArmyButton = page.locator('.panel').getByRole('button',{name:'新增',exact:true});
    await expect(addArmyButton).toBeEnabled();
    await addArmyButton.click();
    await expect(page.locator('.panel')).toContainText('兵种');
    const deleteArmyButton = page.locator('.panel').getByRole('button',{name:'删除',exact:true});
    await expect(deleteArmyButton).toBeEnabled();
    await deleteArmyButton.click();
    await expect(page.locator('.panel')).toContainText('此地块无部队');
    await page.getByRole('button',{name:/关卡功能/}).click();
    let blockedDownloads = 0;
    const recordBlockedDownload = () => blockedDownloads++;
    page.on('download', recordBlockedDownload);
    await page.getByRole('button',{name:'导出 BTL',exact:true}).click();
    await expect.poll(() => expectedDialogs.length).toBe(1);
    assert.equal(blockedDownloads, 0, 'Incompatible draft must not download');
    page.off('download', recordBlockedDownload);
    await page.locator('.panel').getByRole('button',{name:'新增',exact:true}).click();
    await expect(page.locator('.panel')).toContainText('兵种');
    await page.locator('.panel').getByRole('button',{name:'建筑',exact:true}).click();
    await page.locator('.panel').getByRole('button',{name:'新增',exact:true}).click();
    await expect(page.locator('.panel')).toContainText('首都样式');
    await page.screenshot({path:`${out}/legacy-transaction-${viewport.width}.png`});
    const exportBtlButton = page.getByRole('button',{name:'导出 BTL',exact:true});
    if (!await exportBtlButton.isVisible()) await page.getByRole('button',{name:/关卡功能/}).click();
    const downloaded = page.waitForEvent('download').catch(async error => {
      await page.screenshot({path:`${out}/legacy-export-failure-${viewport.width}.png`});
      throw Error(`${error.message}; dialogs=${JSON.stringify(expectedDialogs)}; errors=${JSON.stringify(errors)}`);
    });
    const [btlDownload] = await Promise.all([downloaded, exportBtlButton.click()]);
    const btlBytes = readFileSync(await btlDownload.path());
    mkdirSync('.local/runtime-compatibility', { recursive:true });
    writeFileSync(`.local/runtime-compatibility/browser-${viewport.width}.btl`, btlBytes);
    assert.equal(btlBytes.readInt32LE(0),2);
    assert.equal(btlBytes.readInt32LE(28),349,'Building addition must be saved');
    assert.equal(btlBytes.readInt32LE(32),253,'Restored army must reuse its draft slot');
    report.push({viewport,canvasColors:colors,import:importResult,legacyTransaction:{addRemoveArmy:true,incompatibleExportBlocked:true,restoreArmy:true,addBuilding:true,exportBytes:btlBytes.length},errors}); assert.deepEqual(errors,[]);
    await page.close();
  }
  writeFileSync('.local/browser-result.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} finally { await browser.close(); }
