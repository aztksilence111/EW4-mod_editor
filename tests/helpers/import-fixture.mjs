import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, dll, startEditor, editFood, snapshot } from './editor.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function importFixture(port = 5185) {
  const directory = join(root, '.local/fixtures');
  const path = join(directory, 'import-smoke.ew4mod');
  const metadataPath = join(directory, 'import-smoke.json');
  const key = sha256(Buffer.concat([Buffer.from('import-fixture-v1'), readFileSync(join(root, '.local/baseline.json')), readFileSync(dll)]));
  if (existsSync(path) && existsSync(metadataPath)) {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (metadata.key === key && metadata.packageHash === sha256(readFileSync(path))) return { path, ...metadata, cached: true };
  }
  const editor = await startEditor(port, 'fixture');
  try {
    const original = await editor.request('author');
    await editor.request('restore', { revision: original.revision, document: JSON.stringify({ ...original, scenarios: ['conquest1'] }) });
    await editFood(editor, ['conquest1'], 100);
    const author = await editor.request('author');
    const response = await editor.fetch('export', { revision: author.revision, id: 'editor-import-fixture', name: 'Editor import fixture', version: '0.1.0' });
    if (!response.ok) throw Error(await response.text());
    const bytes = Buffer.from(await response.arrayBuffer());
    const metadata = { key, packageHash: sha256(bytes), packageBytes: bytes.length, ...snapshot(author) };
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, bytes);
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    return { path, ...metadata, cached: false };
  } finally { await editor.stop(); }
}
