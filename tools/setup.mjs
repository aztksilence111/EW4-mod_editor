import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const rewrite = resolve(process.argv[2] || process.env.EW4_REWRITE_ROOT || join(root, '../o4mod/rewrite'));
if (!existsSync(join(rewrite, 'data/original/def_commander.xml'))) throw Error('Expected rewrite source directory with data/original');
const snapshot = join(root, '.local/rewrite');
if (existsSync(snapshot)) throw Error('Snapshot exists. Use a new checkout to select a new engine baseline.');
mkdirSync(snapshot, { recursive: true });
const hashes = {};
for (const name of ['Ew4.Core', 'Ew4.Legacy', 'Ew4.Persistence', 'Ew4.Client', 'Ew4.Mods']) {
  cpSync(join(rewrite, name), join(snapshot, name), {
    recursive: true,
    filter: source => !/[/\\](bin|obj)([/\\]|$)/.test(source),
  });
}
cpSync(join(rewrite, 'data'), join(snapshot, 'data'), { recursive: true });
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) scan(p);
    else hashes[relative(snapshot, p).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(p)).digest('hex');
  }
}
scan(snapshot);
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rewrite, encoding: 'utf8' }).trim(); } catch {}
writeFileSync(join(root, '.local/baseline.json'), JSON.stringify({ schema: 1, source: rewrite, commit, files: hashes }, null, 2));
console.log(`Local baseline: ${Object.keys(hashes).length} files, engine ${commit}. No game state copied.`);
