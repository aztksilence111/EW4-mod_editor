import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = '.local/place-labels';
mkdirSync(output, { recursive: true });
let checks = 0;
const check = (ok, message) => { assert(ok, message); checks++; };
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 960 : 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.drawnPlaceLabels = [];
      window.guideCityDrawn = false;
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        if (window.drawnPlaceLabels.length < 20000) window.drawnPlaceLabels.push(text);
        if (text === '城2' && args[0] === 1984 && args[1] === 1935) window.guideCityDrawn = true;
        return original.call(this, text, ...args);
      };
    });
    await page.goto('http://127.0.0.1:5174/?scenario=conquest7');
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    await expect(page.getByLabel('当前剧本', { exact: true })).toHaveValue('conquest7');
    checks++;
    await page.getByRole('button', { name: '辖区', exact: true }).click();
    const search = page.getByLabel('搜索辖区', { exact: true });
    const target = page.getByLabel('目标辖区中心', { exact: true });
    await expect(target.locator('option[value="6831"]')).toHaveCount(1, { timeout: 120000 });
    await search.fill('迪化');
    const options = await target.locator('option').allTextContents();
    check(options.some(s => s.includes('迪化') && s.includes('杨增新')), 'search resolves current Mod names and country: ' + JSON.stringify(options));
    check(options.some(s => /迪化.+侧(工厂|马厩)/.test(s)), 'unnamed facility gets a geographic label');
    check(options.length > 1 && options.length < 30, 'search narrows the list');
    await search.fill('喀什');
    await target.selectOption('7597');
    const pixelsBefore = await page.locator('canvas').evaluate(c => c.toDataURL());
    await page.getByTitle('定位目标辖区', { exact: true }).click();
    await expect.poll(() => page.locator('canvas').evaluate(c => c.toDataURL())).not.toBe(pixelsBefore);
    check(await page.evaluate(() => window.drawnPlaceLabels.includes('喀什')), 'actual canvas paints custom city names');
    await search.fill('承化寺');
    check((await target.locator('option').allTextContents()).some(s => s.includes('承化寺')), 'new Mod city remains searchable');
    await search.fill('');
    await target.selectOption('7597');
    await page.getByTitle('定位目标辖区', { exact: true }).click();
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width * (width >= 800 ? .36 : .5), box.y + box.height * (width >= 800 ? .48 : .86));
    await page.screenshot({ path: `${output}/editor-${width}.png` });
    await expect(page.getByRole('tooltip')).toContainText('喀什');
    await search.fill('贵德');
    await target.selectOption('11279');
    await page.getByTitle('定位目标辖区', { exact: true }).click();
    check(await page.evaluate(() => window.guideCityDrawn), 'Guide renders its level-two city despite having a bridge');
    await page.mouse.move(box.x + box.width * (width >= 800 ? .36 : .5), box.y + box.height * (width >= 800 ? .48 : .86));
    await expect(page.getByRole('tooltip')).toContainText('贵德');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    const colors = await page.locator('canvas').evaluate(c => {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const result = new Set(); for (let i = 0; i < data.length; i += 320) result.add(`${data[i]},${data[i+1]},${data[i+2]}`);
      return result.size;
    });
    check(colors > 30, 'map is nonblank');
    check(errors.length === 0, JSON.stringify(errors));
    await page.screenshot({ path: `${output}/editor-${width}.png` });
    await page.close();
  }
  writeFileSync(`${output}/verification.json`, JSON.stringify({ checks, errors: 0, scope: 'read-only current C15 naming/search/location/hover; desktop/mobile' }, null, 2));
  console.log(JSON.stringify({ checks, errors: 0 }));
} finally { await browser.close(); }
