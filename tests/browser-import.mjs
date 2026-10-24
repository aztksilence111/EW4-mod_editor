import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { importFixture } from './helpers/import-fixture.mjs';
import { root, startEditor, stopProcess, requireFreePort } from './helpers/editor.mjs';

const fixture = await importFixture();
await requireFreePort(5175);
const editor = await startEditor(5186, 'browser-import');
let ui;
try {
  ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5175'], { cwd: root, env: { ...process.env, EW4_EDITOR_API_PORT: '5186' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  ui.stdout.on('data', data => { logs = (logs + data).slice(-3000); });
  ui.stderr.on('data', data => { logs = (logs + data).slice(-3000); });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (ui.exitCode !== null) throw Error(logs);
    try { const response = await fetch('http://127.0.0.1:5175', { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  if (!ready) throw Error(`Vite startup timed out: ${logs}`);
  const browser = spawn(process.execPath, ['tests/browser.mjs'], { cwd: root, env: { ...process.env,
    EW4_EDITOR_UI_URL: 'http://127.0.0.1:5175', EW4_EDITOR_BROWSER_PACKAGE: fixture.path,
    EW4_EDITOR_BROWSER_FIXTURE: join(root, '.local/fixtures/import-smoke.json'),
  }, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { browser.once('exit', resolve); browser.once('error', reject); });
  if (code !== 0) throw Error(`Browser import checks failed (${code})`);
} finally {
  if (ui) await stopProcess(ui);
  await editor.stop();
}
