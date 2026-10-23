import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
if (!existsSync(join(root, '.local/baseline.json'))) throw Error('Run npm run setup first.');
execFileSync('dotnet', ['build', 'bridge/Ew4.Editor.csproj', '-v:q'], { cwd: root, stdio: 'inherit' });
const api = spawn('dotnet', ['bridge/bin/Debug/net10.0/Ew4.Editor.dll'], { cwd: root, stdio: 'inherit' });
const ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, stdio: 'inherit' });
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; api.kill(); ui.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
api.on('exit', code => stop(code || 0));
ui.on('exit', code => stop(code || 0));
