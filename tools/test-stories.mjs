import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { editorHome } from './editor-home.mjs';
const root = resolve(import.meta.dirname, '..');
const env = { ...process.env, EW4_EDITOR_BASELINE_HOME: editorHome(root), EW4_EDITOR_TEST_DLL: resolve(root, '.local/build-r3-final/Ew4.Editor.dll') };
execFileSync('dotnet', ['build', 'bridge/Ew4.Editor.csproj', '-o', '.local/build-r3-final', '-v:q'], { cwd: root, env, stdio: 'inherit' });
execFileSync(process.execPath, [process.argv.includes('--browser') ? 'tests/browser-stories.mjs' : 'tests/stories.mjs'], { cwd: root, env, stdio: 'inherit' });
