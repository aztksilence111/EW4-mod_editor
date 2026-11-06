import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { startEditor } from './helpers/editor.mjs';

const editor = await startEditor(5344, 'browser-scenario-tools');
const dist = resolve('dist');
const server = createServer((req, res) => {
  const path = resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
  try {
    assert(path.startsWith(dist));
    const file = path === dist ? resolve(dist, 'index.html') : path;
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});
let browser;
let checks = 0;
try {
  await new Promise(r => server.listen(5343, '127.0.0.1', r));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  mkdirSync('.local/scenario-tools/screenshots', { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 960 : 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/editor-api/**', async route => {
      const request = route.request();
      const response = await editor.fetch(request.url().split('/editor-api/')[1], request.method() === 'POST' ? request.postDataJSON() : undefined);
      await route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto('http://127.0.0.1:5343/');
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    await page.getByRole('button', { name: '新建剧本', exact: true }).click();
    await expect(page.getByLabel('新剧本底图')).toContainText('东亚');
    await page.getByLabel('新剧本底图').selectOption('3');
    await page.getByLabel('新剧本 ID', { exact: true }).fill('custom_browser_' + width);
    await page.getByRole('button', { name: '创建空白剧本', exact: true }).click();
    await expect(page.getByLabel('当前剧本', { exact: true })).toHaveValue('custom_browser_' + width, { timeout: 120000 });
    await expect(page.getByLabel('编辑对象', { exact: true })).toHaveValue('territory');
    checks += 2;
    await page.getByRole('button', { name: '验证导出', exact: true }).click();
    const author = await editor.request('author');
    const bytes = Buffer.from(author.files['original/custom_browser_' + width + '.btl'], 'base64');
    const input = page.getByLabel('检查导出文件', { exact: true }).locator('input[type="file"]');
    await input.setInputFiles({ name: 'custom_browser.btl', mimeType: 'application/octet-stream', buffer: bytes });
    await expect(page.locator('.export-inspection .report')).toContainText('检查通过', { timeout: 120000 });
    await expect(page.locator('.export-inspection .report')).toContainText('请完成部署');
    checks += 2;
    await page.locator('.export-inspection .report').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/scenario-tools/screenshots/check-${width}.png` });
    await input.setInputFiles({ name: 'broken.btl', mimeType: 'application/octet-stream', buffer: Buffer.from('broken') });
    await expect(page.locator('.export-inspection .report')).toContainText('检查未通过', { timeout: 120000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存检查报告', exact: true }).click();
    assert((await download).suggestedFilename().endsWith('.check.json'));
    assert.deepEqual(errors, []);
    checks += 3;
    await page.close();
  }
  console.log(`Scenario tools desktop/mobile UI: ${checks} checks passed.`);
} finally {
  await browser?.close(); await editor.stop();
  await new Promise(r => server.close(r));
}
