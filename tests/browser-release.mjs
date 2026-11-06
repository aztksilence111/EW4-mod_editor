import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
try {
  mkdirSync('.local/delivery', { recursive: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
    await page.goto(process.env.EW4_EDITOR_UI_URL || 'http://127.0.0.1:5184', { waitUntil: 'networkidle' });
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    assert(await page.locator('canvas').first().evaluate(canvas => { const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; return pixels.some(value => value > 0); }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `.local/delivery/map-${viewport.width}.png` });
    await page.getByRole('button', { name: '内容编辑', exact: true }).click();
    await page.getByRole('button', { name: '剧情', exact: true }).click();
    await expect(page.locator('.story-editor')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
    await expect(page.getByRole('button', { name: '导入素材 ZIP', exact: true })).toBeEnabled();
    assert.deepEqual(errors, []);
    checks.push(viewport.width + ': standalone UI/API/resources and nonblank map');
    await page.close();
  }
  writeFileSync('.local/delivery/result.json', JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser.close(); }
