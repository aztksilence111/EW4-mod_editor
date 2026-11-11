import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium, expect } from '@playwright/test';

const base = process.argv[2] || 'http://127.0.0.1:56245';
const folder = resolve('../o4mod/build/independent-unit-checks');
const fixture = JSON.parse(readFileSync(join(folder, 'fixture.json')));
const output = resolve('.local/screenshots'); mkdirSync(output, { recursive: true });
let checks = 0;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); const errors = [], missing = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => startupReady && document.documentElement.dataset.fontsReady === 'true', { timeout: 120000 });
    for (const item of fixture.cases) {
      await page.evaluate(async item => { await load(item.slot, 0); }, item);
      await page.waitForFunction(() => state && !busy);
      await page.evaluate(async item => { await selectCell(item.cell, true); }, item);
      await page.waitForFunction(() => selection && !busy);
      await page.evaluate(item => openRecruitment(item.cell), item);
      const result = await page.evaluate(item => ({
        selectedOffers: selection.offers.filter(o => o.profile === item.profile).length,
        customCards: [...document.querySelectorAll('.recruit-cards button')].filter(b => b.getAttribute('aria-label') === item.profile).length,
        oldOffers: selection.offers.filter(o => o.profile.startsWith('ew4.unit.')).length,
        profile: manifest.profiles[item.profile], player: state.playerFaction,
      }), item);
      assert.equal(result.selectedOffers, 1, JSON.stringify({ item, result })); checks++;
      assert.equal(result.customCards, 1); checks++;
      assert(result.oldOffers > 0); checks++;
      await page.getByRole('button', { name: item.profile, exact: true }).click();
      await expect(page.getByRole('heading', { name: item.profile, exact: true })).toBeVisible(); checks++;
      await expect(page.locator('#detail-confirm')).toBeEnabled(); checks++;
      const snapshot = join(output, `unit-recruitment-${item.slot}-${viewport.width}.png`);
      await page.screenshot({ path: snapshot });
      await page.locator('#detail-confirm').click();
      await page.waitForFunction(item => !busy && state.units.some(u => u.cell === item.cell && u.profile === item.profile), item, { timeout: 30000 }); checks++;
      await page.evaluate(() => rpc('save', { slot: 3, mode: 2 }));
      await page.evaluate(() => load(3, 2));
      assert(await page.evaluate(item => state.units.some(u => u.cell === item.cell && u.profile === item.profile), item)); checks++;
    }
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); checks += 2;
    await page.close();
  }
  console.log(JSON.stringify({ unitRecruitmentBrowserChecks: checks, errors: 0 }));
} finally { await browser.close(); }
