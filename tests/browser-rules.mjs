import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { startEditor } from './helpers/editor.mjs';

const editor = await startEditor(5348, 'browser-rules');
const dist = resolve('dist');
const server = createServer((req, res) => {
  const path = resolve(dist, '.' + new URL(req.url, 'http://localhost').pathname);
  try {
    assert(path === dist || path.startsWith(dist + sep));
    const file = path === dist ? resolve(dist, 'index.html') : path;
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.statusCode = 404; res.end(); }
});
const checks = [];
let browser;
try {
  await new Promise(r => server.listen(5349, '127.0.0.1', r));
  const original = await editor.request('author');
  await editor.request('restore', { revision: original.revision, document: JSON.stringify({ ...original, scenarios: ['conquest1'] }) });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  mkdirSync('.local/latest-rules/screenshots', { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 960 : 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/editor-api/**', async route => {
      const request = route.request();
      const response = await editor.fetch(request.url().split('/editor-api/')[1], request.method() === 'POST' ? request.postDataJSON() : undefined);
      await route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto('http://127.0.0.1:5349/', { waitUntil: 'networkidle' });
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    await page.getByRole('button', { name: '内容编辑', exact: true }).click();
    await page.getByRole('button', { name: '扩展规则', exact: true }).click();
    const workbench = page.getByLabel('扩展规则工作区');
    await expect(workbench).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
    await expect(page.getByLabel('扩展模块')).toContainText('空地分层');
    await page.getByRole('button', { name: '接口说明', exact: true }).click();
    await expect(workbench.locator('.guide')).toContainText('unit-layers');
    checks.push(width + ': latest engine modules and offline guide');
    await expect(page.getByLabel('规则示例')).toContainText('空地分层');
    await page.getByRole('button', { name: '放入示例草稿', exact: true }).click();
    await expect(page.getByLabel('规则文件内容')).toHaveValue(/surfaceCapacity/);
    await page.getByRole('button', { name: '校验并预览规则', exact: true }).click();
    await expect(page.getByRole('button', { name: '应用规则修改', exact: true })).toBeEnabled({ timeout: 120000 });
    await page.getByRole('button', { name: '应用规则修改', exact: true }).click();
    await expect(workbench).toContainText('扩展规则已应用', { timeout: 120000 });
    assert((await editor.request('author')).files['rewrite/unit-layers.json']);
    checks.push(width + ': official example preview and apply');
    await page.getByLabel('规则文件内容').fill('{ broken');
    await page.getByRole('button', { name: '校验并预览规则', exact: true }).click();
    await expect(workbench.getByRole('alert')).toBeVisible({ timeout: 120000 });
    await expect(page.getByRole('button', { name: '应用规则修改', exact: true })).toBeDisabled();
    checks.push(width + ': invalid JSON blocked');
    await page.getByRole('button', { name: '放弃本地草稿', exact: true }).click();
    await expect(workbench).toHaveAttribute('aria-busy', 'false');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `.local/latest-rules/screenshots/rules-${width}.png` });
    checks.push(width + ': responsive interface without runtime errors');
    await page.close();
    const state = await editor.request('author');
    await editor.request('history', { revision: state.revision, direction: 'undo' });
  }
  writeFileSync('.local/latest-rules/browser-result.json', JSON.stringify({ passed: checks.length, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await browser?.close(); await editor.stop(); await new Promise(r => server.close(r)); }
