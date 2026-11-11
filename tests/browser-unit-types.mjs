import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { root, startEditor, stopProcess, requireFreePort } from './helpers/editor.mjs';

await requireFreePort(5175);
const editor = await startEditor(5189, 'browser-unit-types');
let ui, browser; let checks = 0;
try {
  ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5175'], { cwd: root, env: { ...process.env, EW4_EDITOR_API_PORT: '5189' }, stdio: 'ignore' });
  for (let i = 0; ; i++) { if (ui.exitCode !== null || i >= 150) throw Error('Vite startup failed'); try { if ((await fetch('http://127.0.0.1:5175')).ok) break; } catch {} await delay(100); }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const initial = await editor.request('author');
  mkdirSync(join(root, '.local/screenshots'), { recursive: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    await editor.request('restore', { revision: (await editor.request('project')).revision, document: JSON.stringify({ ...initial, scenarios: ['conquest1', 'conquest2'] }) });
    const page = await browser.newPage({ viewport }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) errors.push(response.status() + ' ' + response.url()); });
    await page.goto('http://127.0.0.1:5175', { waitUntil: 'networkidle' });
    await expect(page.getByLabel('当前剧本', { exact: true })).toBeEnabled({ timeout: 120000 });
    await page.getByRole('button', { name: '内容编辑', exact: true }).click();
    await page.getByRole('button', { name: '兵种', exact: true }).click();
    const idle = async () => {
      await expect(page.locator('.content-workspace')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
      await expect(page.locator('.unit-types')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
      await expect(page.getByRole('button', { name: '复制为独立新兵种', exact: true })).toBeEnabled({ timeout: 120000 });
    };
    await idle();
    await page.getByLabel('兵种模板', { exact: true }).selectOption('ew4.unit.fra.militia.0');
    await page.getByRole('button', { name: '复制为独立新兵种', exact: true }).click();
    await page.getByLabel('独立兵种 ID').fill('browser.unit.rifle.0'); await page.getByLabel('兵种名称', { exact: true }).fill('独立步兵测试');
    await page.getByLabel('满兵力', { exact: true }).fill('555');
    await page.getByLabel('可招募国家', { exact: true }).selectOption(['fra']);
    await page.getByRole('button', { name: '预览兵种修改', exact: true }).click(); await idle();
    await expect(page.getByRole('button', { name: '应用兵种预览', exact: true })).toBeVisible(); checks++;
    await page.getByLabel('兵种名称', { exact: true }).fill('独立步兵修订');
    await expect(page.getByRole('button', { name: '应用兵种预览', exact: true })).toHaveCount(0); checks++;
    await page.getByRole('button', { name: '预览兵种修改', exact: true }).click(); await idle();
    await page.getByRole('button', { name: '应用兵种预览', exact: true }).click(); await idle();
    await expect.poll(async () => (await editor.request('unit-types')).units.find(u => u.id === 'browser.unit.rifle.0')?.attributes.max_health, { timeout: 120000 }).toBe(555); checks++;
    await page.getByRole('button', { name: '国家', exact: true }).click();
    await page.getByRole('button', { name: '兵种', exact: true }).click(); await idle();
    await page.getByLabel('兵种模板', { exact: true }).selectOption('browser.unit.rifle.0');
    await page.getByRole('button', { name: '编辑所选兵种', exact: true }).click();
    await expect(page.getByLabel('独立兵种 ID')).toHaveAttribute('readonly', ''); checks++;
    await expect(page.getByLabel('满兵力', { exact: true })).toHaveValue('555'); checks++;
    await page.getByLabel('兵种模板', { exact: true }).selectOption('ew4.unit.fra.frigate.0');
    await page.getByRole('button', { name: '复制为独立新兵种', exact: true }).click();
    await expect(page.getByLabel('招募建筑', { exact: true })).toHaveValue('port'); checks++;
    await page.getByLabel('独立兵种 ID').fill('browser.unit.cruiser.0'); await page.getByLabel('兵种名称', { exact: true }).fill('独立巡洋舰测试');
    await page.getByRole('button', { name: '预览兵种修改', exact: true }).click(); await idle();
    await page.getByRole('button', { name: '应用兵种预览', exact: true }).click(); await idle();
    await expect.poll(async () => (await editor.request('unit-types')).units.some(u => u.id === 'browser.unit.cruiser.0'), { timeout: 120000 }).toBe(true); checks++;
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert(size.scroll <= size.width + 1, JSON.stringify(size)); checks++;
    assert.deepEqual(errors, []); checks++;
    await page.locator('.panel-body:visible').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: join(root, `.local/screenshots/unit-types-${viewport.width}.png`) });
    await page.close();
  }
  console.log(JSON.stringify({ unitTypeBrowserChecks: checks, errors: 0 }));
} catch (error) {
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    console.error((await page.locator('.error:visible').allTextContents()).join('\n'));
    await page.screenshot({ path: join(root, '.local/screenshots/unit-types-failed.png') });
  }
  throw error;
} finally { await browser?.close(); if (ui) await stopProcess(ui); await editor.stop(); }
