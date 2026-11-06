import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const homeArg = args.find(a => a.startsWith('--home='));
const home = resolve(root, homeArg?.slice(7) || '.local');
if (home !== join(root, '.local') && !home.startsWith(join(root, '.local') + '\\') && !home.startsWith(join(root, '.local') + '/')) throw Error('Snapshot home must be inside .local');
const rewrite = resolve(args.find(a => !a.startsWith('--')) || process.env.EW4_REWRITE_ROOT || join(root, '../o4mod/rewrite'));
if (!existsSync(join(rewrite, 'data/original/def_commander.xml'))) throw Error('Expected rewrite source directory with data/original');
const snapshot = join(home, 'rewrite');
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
const player = join(rewrite, 'Ew4.Web/wwwroot');
if (existsSync(join(player, 'story-player.js'))) {
  mkdirSync(join(snapshot, 'player'), { recursive: true });
  for (const file of ['story-player.js', 'story-player.css', 'story-icons']) cpSync(join(player, file), join(snapshot, 'player', file), { recursive: true });
}
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
writeFileSync(join(home, 'baseline.json'), JSON.stringify({ schema: 1, source: rewrite, commit, files: hashes }, null, 2));
console.log(`Local baseline: ${Object.keys(hashes).length} files, engine ${commit}. No game state copied.`);
