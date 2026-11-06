import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const url = process.env.EW4_EDITOR_UI_URL || 'http://127.0.0.1:5176';
const originalXml = readFileSync('src/core/data/def_commanders.xml', 'utf8');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
try {
  mkdirSync('.local/original-commanders', { recursive: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? 'original-test' : undefined));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    const beforeR = await page.evaluate(async () => (await (await fetch('/editor-api/project')).json()));
    await page.getByRole('button', { name: '内容编辑', exact: true }).click();
    await page.getByLabel('将领字段', { exact: true }).selectOption('skillBinding');
    await page.getByRole('button', { name: '原版', exact: true }).click();
    await page.locator('.mask:visible .dialog-head .close').click();
    await page.getByRole('button', { name: '内容编辑', exact: true }).click();
    const panel = page.locator('.original-content'), row = panel.locator('[data-commander="1"]');
    const cavalry = row.locator('[data-field="cavalry"]');
    await expect(cavalry).toHaveText('3');
    assert.equal(await panel.getByLabel('原版将领字段', { exact: true }).locator('option[value="skillBinding"]').count(), 0);
    await panel.getByLabel('搜索原版将领').fill('Napoleon');
    await panel.getByLabel('选择原版将领 1', { exact: true }).check();
    await panel.getByLabel('原版将领字段', { exact: true }).selectOption('cavalry');
    await panel.getByLabel('原版批量数值').fill('2');
    await panel.getByRole('button', { name: '加入批处理', exact: true }).click();
    await panel.getByRole('button', { name: '预览批处理', exact: true }).click();
    await expect(panel.locator('.diff-table tbody tr')).toHaveCount(1);
    await expect(cavalry).toHaveText('3');
    await panel.getByRole('button', { name: '应用配置', exact: true }).click();
    await expect(cavalry).toHaveText('5');
    await panel.getByTitle('撤销', { exact: true }).click(); await expect(cavalry).toHaveText('3');
    await panel.getByTitle('重做', { exact: true }).click(); await expect(cavalry).toHaveText('5');
    checks.push(viewport.width + ': filter, multi-select batch preview/apply and undo/redo');

    const xmlDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出将领 XML', exact: true }).click();
    const xml = readFileSync(await (await xmlDownload).path(), 'utf8');
    const comparison = await page.evaluate(({ before, after }) => {
      const parser = new DOMParser();
      const original = [...parser.parseFromString(before, 'text/xml').querySelectorAll('commander')];
      const exported = [...parser.parseFromString(after, 'text/xml').querySelectorAll('commander')];
      const changes = [];
      for (let i = 0; i < original.length; i++) {
        if (exported[i].attributes.length !== original[i].attributes.length) throw Error('Attribute count changed');
        for (const attribute of original[i].attributes) {
          const value = exported[i].getAttribute(attribute.name);
          if (value !== attribute.value) changes.push([original[i].getAttribute('id'), attribute.name, attribute.value, value]);
        }
      }
      return { changes, count: exported.length, originalCount: original.length };
    }, { before: originalXml, after: xml });
    assert.equal(comparison.count, comparison.originalCount);
    assert.deepEqual(comparison.changes, [['1', 'cavalry', '3', '5']]);
    assert(!xml.includes('rewrite') && !xml.includes('skillBinding'));
    checks.push(viewport.width + ': original XML retains all other attributes and rows');

    const csvFile = text => ({ name: 'commanders.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
    const csvInput = panel.getByLabel('导入原版将领 CSV 文件');
    await csvInput.setInputFiles(csvFile('schema,id,name,country,skillBinding\n1,1,Napoleon,fra,ew4.skill.42'));
    await expect(panel.getByRole('alert')).toContainText('扩展字段'); await expect(cavalry).toHaveText('5');
    await csvInput.setInputFiles(csvFile('schema,id,rank\n1,1,999'));
    await expect(panel.getByRole('alert')).toContainText('原版范围'); await expect(cavalry).toHaveText('5');
    await panel.getByLabel('导入原版将领 XML 文件').setInputFiles({ name: 'r.xml', mimeType: 'application/xml', buffer: Buffer.from(xml.replace('<commander ', '<commander skillBinding="r" ')) });
    await expect(panel.getByRole('alert')).toContainText('扩展字段');
    await csvInput.setInputFiles(csvFile('schema,sourceHash,id,name,country,cavalry\n1,r-native,1,Napoleon,fra,7'));
    await expect(panel.locator('.diff-table tbody tr')).toHaveCount(1); await expect(cavalry).toHaveText('5');
    await panel.getByRole('button', { name: '应用配置', exact: true }).click(); await expect(cavalry).toHaveText('7');
    checks.push(viewport.width + ': compatible R native CSV accepted; extension and out-of-range inputs rejected atomically');

    const packDownload = page.waitForEvent('download');
    await panel.getByRole('button', { name: '导出工程', exact: true }).click();
    const pack = JSON.parse(readFileSync(await (await packDownload).path(), 'utf8'));
    assert.equal(pack.target, 'original'); assert(pack.originalCommanderXml);
    await panel.getByTitle('撤销', { exact: true }).click(); await expect(cavalry).toHaveText('5');
    const chooser = page.waitForEvent('filechooser');
    await panel.getByTitle('导入原版工程', { exact: true }).click();
    await (await chooser).setFiles({ name: 'original.ew4p', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
    await expect(cavalry).toHaveText('7');
    await panel.getByTitle('保存原版草稿', { exact: true }).click();
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('ew4-editor'); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
      try { return await new Promise(resolve => { const request = db.transaction('draft').objectStore('draft').get('current'); request.onsuccess = () => resolve(request.result?.originalCommanderXml); }); }
      finally { db.close(); }
    })).toContain('cavalry="7"');
    await page.getByRole('button', { name: 'R 版', exact: true }).click();
    await expect(page.getByLabel('将领字段', { exact: true })).toHaveValue('skillBinding');
    await page.getByRole('button', { name: '原版', exact: true }).click(); await expect(cavalry).toHaveText('7');
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '原版', exact: true }).click();
    await page.locator('.mask:visible .dialog-head .close').click();
    await page.getByRole('button', { name: '内容编辑', exact: true }).click();
    await expect(cavalry).toHaveText('7');
    const afterR = await page.evaluate(async () => (await (await fetch('/editor-api/project')).json()));
    assert.deepEqual(afterR, beforeR);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `.local/original-commanders/editor-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    checks.push(viewport.width + ': project and draft recovery, independent version drafts, untouched R author and responsive UI');
    await context.close();
  }
  writeFileSync('.local/original-commanders/result.json', JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
