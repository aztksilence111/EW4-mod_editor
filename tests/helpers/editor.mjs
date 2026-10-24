import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

export const root = resolve(import.meta.dirname, '../..');
export const dll = resolve(root, process.env.EW4_EDITOR_TEST_DLL ?? 'bridge/bin/Debug/net10.0/Ew4.Editor.dll');

export async function stopProcess(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
}

export async function requireFreePort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

export async function startEditor(port, label, existingHome) {
  await requireFreePort(port);
  const home = existingHome ?? join(root, '.local/tests', `${label}-${crypto.randomUUID()}`);
  if (!existingHome) {
    mkdirSync(home, { recursive: true });
    copyFileSync(join(root, '.local/baseline.json'), join(home, 'baseline.json'));
    symlinkSync(join(root, '.local/rewrite'), join(home, 'rewrite'), 'junction');
  }
  const child = spawn('dotnet', [dll], { cwd: root, env: { ...process.env, EW4_EDITOR_HOME: home, EW4_EDITOR_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', data => { logs = (logs + data).slice(-6000); });
  child.stderr.on('data', data => { logs = (logs + data).slice(-6000); });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  const base = `http://127.0.0.1:${port}/editor-api/`;
  const editor = {
    home, child, base,
    async fetch(path, body) {
      return fetch(base + path, {
        ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EW4-Editor': '1' }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(600000),
      });
    },
    async request(path, body, expected = 200) {
      const response = await editor.fetch(path, body);
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw Error(`Invalid API response: ${path} (${response.status}): ${text.slice(0, 500)}\n${logs.slice(-3500)}`); }
      assert.equal(response.status, expected, JSON.stringify(data));
      return data;
    },
    stop: () => stopProcess(child),
  };
  try {
    for (let i = 0; i < 150; i++) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error(`Editor exited: ${logs}`);
      try {
        const response = await fetch(base + 'project', { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          return editor;
        }
      } catch (error) { if (child.exitCode !== null) throw error; }
      await delay(100);
    }
    throw Error(`Editor startup timed out: ${logs}`);
  } catch (error) { await editor.stop(); throw error; }
}

export const snapshot = author => ({ files: author.files, scenarios: author.scenarios, sources: author.sources });
export const foodRule = value => ({ domain: 'factions', field: 'food', operation: 'add', value, rounding: 'round', filter: { country: 'fra' } });

export async function editFood(editor, scenarios, value) {
  const { revision } = await editor.request('project');
  const preview = await editor.request('preview', { revision, taskId: crypto.randomUUID(), scenarios, rules: [foodRule(value)] });
  return editor.request('apply', { revision, taskId: preview.taskId, token: preview.token });
}
