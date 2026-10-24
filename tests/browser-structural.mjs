import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { root, dll, startEditor, stopProcess, requireFreePort } from './helpers/editor.mjs';
import { sha256 } from './helpers/import-fixture.mjs';

const directory = join(root, '.local/runtime-compatibility');
const input = readFileSync(join(directory, 'structural-input.btl'));
const expected = readFileSync(join(directory, 'structural-first.btl'));
const evidence = JSON.parse(readFileSync(join(directory, 'structural-result.json')));
assert.equal(sha256(input), evidence.fixtureSha256, 'Structural fixture changed');
await requireFreePort(5175);
const editor = await startEditor(5195, 'browser-structural');
let ui, browser;
const report = [];
try {
  ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5175'], { cwd: root,
    env: { ...process.env, EW4_EDITOR_API_PORT: '5195' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const stream of [ui.stdout, ui.stderr]) stream.on('data', data => { logs = (logs + data).slice(-3000); });
  for (let i = 0; ; i++) {
    if (ui.exitCode !== null || i === 150) throw Error('Vite startup failed: ' + logs);
    try { if ((await fetch('http://127.0.0.1:5175', { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  mkdirSync(join(root, '.local/screenshots'), { recursive: true });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const author = await editor.request('author');
    await editor.request('restore', { revision: author.revision, document: JSON.stringify({ ...author,
      scenarios: ['conquest1'], files: { 'original/conquest1.btl': input.toString('base64') } }) });
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (response.status() < 400 || path === '/favicon.ico') return;
      if (response.status() === 400 && ['/editor-api/preview', '/editor-api/apply'].includes(path)) return;
      errors.push(response.status() + ' ' + path);
    });
    await page.goto('http://127.0.0.1:5175', { waitUntil: 'networkidle' });
    const idle = () => expect(page.locator('.author-panel')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
    await idle();
    await page.getByRole('button', { name: '部队', exact: true }).click();
    const checkbox = slot => page.getByLabel('选择部队槽位 ' + slot, { exact: true });
    const preview = async () => { await page.getByRole('button', { name: '预览删除', exact: true }).click(); await idle(); };
    const unchanged = async before => assert.deepEqual(await editor.request('author'), before);
    const screenshot = name => page.screenshot({ path: join(root, `.local/screenshots/structural-${name}-${viewport.width}.png`) });
    const before = await editor.request('author');
    assert.equal(await page.locator('.armies-table tbody tr').count(), evidence.armyCount);
    await expect(page.getByRole('button', { name: '预览删除', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await page.getByTitle('点选', { exact: true }).click();
    const scenario = await editor.request('scenario/conquest1');
    const box = await page.locator('canvas').boundingBox();
    const hex = (x, y) => ({ x: x * 32 + (y % 2 ? 16 : 0) + 16, y: y * 27 + 18 });
    const left = input.readInt32LE(8), top = input.readInt32LE(12);
    const w = input.readInt32LE(16), h = input.readInt32LE(20);
    const start = hex(left, top), end = hex(left + w - 1, top + h - 1);
    const pw = end.x - start.x + 32, ph = end.y - start.y + 36;
    const scale = Math.max(0.05, Math.min(4, Math.min(box.width / pw, box.height / ph) * 0.95));
    const armyOffset = 72 + input.readInt32LE(24) * 180 + w * h + input.readInt32LE(28) * 16;
    let mapSlot;
    for (let slot = 0; slot < evidence.armyCount; slot++) {
      const cell = input.readInt16LE(armyOffset + slot * 32);
      const point = hex(cell % scenario.mapWidth, Math.floor(cell / scenario.mapWidth));
      const position = { x: box.x + box.width / 2 + (point.x - start.x - pw / 2) * scale,
        y: box.y + box.height / 2 + (point.y - start.y - ph / 2) * scale };
      if (!await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS', position)) continue;
      await page.mouse.click(position.x, position.y); mapSlot = slot; break;
    }
    assert.notEqual(mapSlot, undefined, 'No visible army cell for map selection');
    await page.locator('.map-tools').getByTitle('选择选区部队', { exact: true }).click();
    await expect(checkbox(mapSlot)).toBeChecked();
    await page.getByTitle('清空部队选择', { exact: true }).click();
    await checkbox(0).check(); await checkbox(Math.floor((evidence.armyCount - 1) / 2)).check();
    await preview();
    await expect(page.locator('.deletion-summary')).toHaveText('删除 2 支部队 · 1 个剧本');
    assert.equal(await page.locator('.deletion-targets tbody tr').count(), 2);
    assert.equal(await page.locator('.migration-table tbody tr').count(), evidence.armyCount);
    await unchanged(before);
    await screenshot('multiple');
    await page.getByTitle('取消删除预览', { exact: true }).click();
    await unchanged(before);
    await expect(page.getByRole('button', { name: '应用删除', exact: true })).toHaveCount(0);
    await checkbox(Math.floor((evidence.armyCount - 1) / 2)).uncheck();
    await preview();
    await expect(page.locator('.migration-table tbody tr').first()).toHaveText('0删除');
    await expect(page.locator('.migration-table tbody tr').nth(1)).toHaveText('10');
    await screenshot('preview');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // A revision change outside this tab must reject the old token without changing the newer state.
    const stale = await editor.request('preview', { revision: before.revision, taskId: crypto.randomUUID(),
      scenarios: ['conquest1'], rules: [{ domain: 'factions', field: 'food', operation: 'add', value: 1, filter: { country: 'fra' } }] });
    await editor.request('apply', { revision: stale.revision, taskId: stale.taskId, token: stale.token });
    const newer = await editor.request('author');
    await page.getByRole('button', { name: '应用删除', exact: true }).click(); await idle();
    await expect(page.locator('.feedback.error')).toBeVisible(); await unchanged(newer);
    await expect(page.getByRole('button', { name: '应用删除', exact: true })).toHaveCount(0);
    await editor.request('history', { revision: newer.revision, direction: 'undo' });
    await page.getByTitle('刷新工程', { exact: true }).click(); await idle();
    await expect(checkbox(0)).not.toBeChecked();
    // Referenced VICT targets surface the bridge rejection and preserve all state.
    await checkbox(1).check();
    const protectedState = await editor.request('author');
    await preview();
    await expect(page.locator('.feedback.error')).toContainText('胜负');
    await unchanged(protectedState);
    await checkbox(1).uncheck(); await checkbox(0).check(); await preview();
    await expect(page.locator('.feedback.error')).toHaveCount(0);
    await page.getByRole('button', { name: '应用删除', exact: true }).click(); await idle();
    await expect(page.getByRole('status')).toHaveText('部队删除已保存');
    assert.equal(await page.locator('.armies-table tbody tr').count(), evidence.armyCount - 1);
    const applied = await editor.request('author');
    assert.deepEqual(Buffer.from(applied.files['original/conquest1.btl'], 'base64'), expected);
    await expect(checkbox(0)).not.toBeChecked();
    for (const [direction, bytes] of [['undo', input], ['redo', expected]]) {
      await page.getByTitle(direction === 'undo' ? '撤销整批' : '重做整批', { exact: true }).click(); await idle();
      assert.deepEqual(Buffer.from((await editor.request('author')).files['original/conquest1.btl'], 'base64'), bytes);
      assert.equal(await page.locator('.armies-table tbody tr').count(), bytes.readInt32LE(32));
    }
    await screenshot('applied');
    const colors = await page.locator('canvas').evaluate(canvas => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const values = new Set(); for (let i = 0; i < data.length; i += Math.max(4, Math.floor(data.length / 6400) * 4)) values.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      return values.size;
    });
    assert(colors > 12, 'Map canvas is blank');
    await page.getByRole('button', { name: '验证导出', exact: true }).click();
    const downloaded = page.waitForEvent('download', { timeout: 120000 });
    await page.getByRole('button', { name: '校验并导出 .ew4mod', exact: true }).click();
    const download = await downloaded;
    const packageBytes = readFileSync(await download.path());
    writeFileSync(join(directory, `structural-browser-${viewport.width}.ew4mod`), packageBytes);
    await idle();
    assert.deepEqual(errors, []);
    report.push({ viewport, mapSelection: true, multipleSelection: true, cancelWithoutWrite: true, staleRejected: true, victoryProtected: true,
      applyUndoRedo: true, canvasColors: colors, outputSha256: sha256(expected), packageBytes: packageBytes.length, errors });
    await page.close();
  }
  await browser.close(); browser = null;
  writeFileSync(join(directory, 'structural-browser-result.json'), JSON.stringify(report, null, 2));
  const runtime = spawnSync('dotnet', ['run', '--project', join(root, 'tests/runtime/RuntimeCompatibility.csproj'),
    '-p:BridgeOutput=' + dirname(dll), '--', root, '--structural-browser'], { cwd: root, stdio: 'inherit' });
  if (runtime.error) throw runtime.error;
  assert.equal(runtime.status, 0, 'Downloaded package runtime checks failed');
  console.log('Structural browser: desktop/mobile selection, preview, cancel, rejection, apply, history, export passed');
} finally {
  if (browser) await browser.close();
  if (ui) await stopProcess(ui);
  await editor.stop();
}
