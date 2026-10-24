import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { root, startEditor } from './helpers/editor.mjs';

const editor = await startEditor(5211, 'browser-jurisdictions');
let browser;
const checks = [];
try {
  const initial = await editor.request('author');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  mkdirSync(join(root, '.local/screenshots'), { recursive: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await editor.request('restore', { revision: (await editor.request('project')).revision,
      document: JSON.stringify({ ...initial, scenarios: ['conquest1', 'conquest2'] }) });
    const before = await editor.request('author');
    const source = await editor.request('scenario/conquest1');
    const data = source.jurisdictionEditing;
    const local = cell => (Math.floor(cell / source.mapWidth) - data.top) * data.width + cell % source.mapWidth - data.left;
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) errors.push(response.status() + ' ' + response.url()); });
    await page.route('**/editor-api/**', async route => {
      const response = await route.fetch({ url: editor.base + route.request().url().split('/editor-api/')[1], timeout: 180000 });
      await route.fulfill({ response });
    });
    await page.goto(process.env.EW4_EDITOR_UI_URL || 'http://127.0.0.1:5175', { waitUntil: 'networkidle' });
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    await page.getByRole('button', { name: '辖区', exact: true }).click();
    const idle = () => expect(page.locator('.jurisdiction-panel')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
    const target = page.getByLabel('目标辖区中心', { exact: true });
    const preview = page.getByRole('button', { name: '预览辖区修改', exact: true });
    const apply = page.getByRole('button', { name: '应用辖区修改', exact: true });
    await idle();
    await expect(page.getByLabel('辖区层', { exact: true })).toBeChecked();
    assert.equal(await target.locator('option').count(), data.centers.length + 1);
    const box = await page.locator('canvas').boundingBox();
    const hex = (x, y) => ({ x: x * 32 + (y % 2 ? 16 : 0) + 16, y: y * 27 + 18 });
    const start = hex(data.left, data.top), end = hex(data.left + data.width - 1, data.top + data.height - 1);
    const pw = end.x - start.x + 32, ph = end.y - start.y + 36;
    const scale = Math.max(.05, Math.min(4, Math.min(box.width / pw, box.height / ph) * .95));
    const position = cell => {
      const point = hex(cell % source.mapWidth, Math.floor(cell / source.mapWidth));
      return { x: box.x + box.width / 2 + (point.x - start.x - pw / 2) * scale,
        y: box.y + box.height / 2 + (point.y - start.y - ph / 2) * scale };
    };
    const visible = cell => page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS', position(cell));
    const click = async cell => { const p = position(cell); await page.mouse.click(p.x, p.y); };
    await page.getByTitle('从地图拾取辖区中心', { exact: true }).click();
    let center;
    for (const c of data.centers) if (await visible(c.cell)) { center = c.cell; break; }
    assert.notEqual(center, undefined, 'A center must remain accessible with the picker open');
    await click(center);
    await expect(target).toHaveValue(String(center));
    await page.getByRole('button', { name: '选中此辖区', exact: true }).click();
    const count = data.editableCells.filter(c => source.effectiveJurisdictions[local(c)] === center).length;
    await expect(page.locator('.jurisdiction-editor')).toContainText(`已选 ${count} 格`);
    await target.selectOption('-1');
    const pixels = () => page.locator('canvas').evaluate(canvas => canvas.toDataURL());
    const painted = await pixels();
    await preview.click(); await idle(); await expect(apply).toBeVisible();
    assert.notEqual(await pixels(), painted, 'Map overlay must change during preview');
    assert.deepEqual(await editor.request('author'), before);
    await page.screenshot({ path: join(root, `.local/screenshots/jurisdictions-preview-${viewport.width}.png`) });
    await page.getByTitle('取消辖区预览', { exact: true }).click();
    await expect(apply).toHaveCount(0);
    assert.equal(await pixels(), painted, 'Cancel must restore actual overlay');
    await preview.click(); await idle();
    await target.selectOption(String(center)); await expect(apply).toHaveCount(0);
    await target.selectOption('-1'); await preview.click(); await idle();
    await apply.click(); await idle();
    const after = await editor.request('scenario/conquest1');
    for (const c of data.editableCells.filter(c => source.effectiveJurisdictions[local(c)] === center)) assert.equal(after.jurisdictions[local(c)], -1);
    assert.equal((await editor.request('scenario/conquest2')).jurisdictions, null);
    await page.getByTitle('撤销整批', { exact: true }).click(); await idle();
    assert.equal((await editor.request('scenario/conquest1')).jurisdictions, null);
    await page.getByTitle('重做整批', { exact: true }).click(); await idle();
    assert.deepEqual((await editor.request('scenario/conquest1')).jurisdictions, after.jurisdictions);
    let cell;
    for (const c of data.editableCells) if (await visible(c)) { cell = c; break; }
    assert.notEqual(cell, undefined, 'Map selection must remain accessible');
    await page.getByTitle('点选', { exact: true }).click(); await click(cell);
    await expect(page.locator('.jurisdiction-editor')).toContainText('已选 1 格 · 可修改 1 格');
    await click(cell); await expect(preview).toBeDisabled();
    let corner;
    for (const c of data.editableCells) {
      if (c !== cell && Math.floor(c / source.mapWidth) === Math.floor(cell / source.mapWidth) && Math.abs(c - cell) <= 3 && await visible(c)) { corner = c; break; }
    }
    assert.notEqual(corner, undefined, 'Two rectangle corners must remain accessible');
    await page.getByTitle('矩形选区：两个角点', { exact: true }).click();
    await click(cell); await click(corner);
    await expect(page.locator('.jurisdiction-editor')).toContainText(`已选 ${Math.abs(corner - cell) + 1} 格`);
    await target.selectOption(String(center)); await preview.click(); await idle(); await expect(apply).toBeVisible();
    await page.getByTitle('清空选区', { exact: true }).click(); await expect(apply).toHaveCount(0); await expect(preview).toBeDisabled();
    await page.getByTitle('点选', { exact: true }).click();
    if (await visible(center)) {
      await click(center); await expect(preview).toBeDisabled();
      await expect(page.locator('.jurisdiction-editor')).toContainText('略过中心、海格或港口 1 格');
    }
    await page.getByLabel('当前剧本', { exact: true }).selectOption('conquest2'); await idle();
    await expect(page.locator('.jurisdiction-editor')).toContainText('已选 0 格');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const colors = await page.locator('canvas').evaluate(canvas => {
      const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set(); for (let i = 0; i < image.length; i += 160) colors.add(`${image[i]},${image[i+1]},${image[i+2]}`);
      return colors.size;
    });
    assert(colors > 20, 'Canvas must contain rendered terrain');
    assert.deepEqual(errors, []);
    checks.push(`${viewport.width}: center picker, selection, preview pixels/cancel/invalidation, apply/history/scenario isolation, nonblank canvas and no overflow`);
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.close();
  }
  writeFileSync(join(root, '.local/browser-jurisdictions-result.json'), JSON.stringify({ checks, home: editor.home }, null, 2));
  console.log(JSON.stringify({ checks }));
} catch (error) {
  if (browser) for (const page of browser.contexts().flatMap(c => c.pages())) {
    await page.screenshot({ path: join(root, '.local/screenshots/jurisdictions-failure.png') }).catch(() => {});
    console.error(await page.locator('[role=status]').allTextContents().catch(() => []));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
  throw error;
} finally { if (browser) await browser.close(); await editor.stop(); }
