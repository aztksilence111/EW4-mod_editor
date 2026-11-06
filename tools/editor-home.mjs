import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
export function editorHome(root) {
  return resolve(root, process.env.EW4_EDITOR_BASELINE_HOME || ['.local/r3-20261107', '.local/r3', '.local'].find(p => existsSync(resolve(root, p, 'baseline.json'))) || '.local');
}
