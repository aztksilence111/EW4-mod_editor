import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { editorHome } from './editor-home.mjs';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.tmp/latest-r3-build');
const env = { ...process.env, EW4_EDITOR_BASELINE_HOME: editorHome(root), EW4_EDITOR_TEST_DLL: resolve(output, 'Ew4.Editor.dll') };
execFileSync('dotnet', ['build', 'bridge/Ew4.Editor.csproj', '-o', output, '-v:q'], { cwd: root, env, stdio: 'inherit' });
execFileSync(process.execPath, [process.argv.includes('--browser') ? 'tests/browser-rules.mjs' : 'tests/rules.mjs'], { cwd: root, env, stdio: 'inherit' });
