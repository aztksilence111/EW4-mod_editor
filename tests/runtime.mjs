import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, startEditor } from './helpers/editor.mjs';

const editor = await startEditor(5192, 'runtime-restore');
const path = 'original/conquest1.btl';
const directory = join(root, '.local/runtime-compatibility');
const cases = [];
try {
  const original = await editor.request('author');
  for (const name of ['negative-army', 'negative-market', 'negative-tavern', 'negative-fire']) {
    const candidate = { ...original, scenarios: ['conquest1'], files: { ...original.files,
      [path]: readFileSync(join(directory, name + '.btl')).toString('base64'),
    } };
    await editor.request('restore', { revision: original.revision, document: JSON.stringify(candidate) }, 400);
    assert.deepEqual(await editor.request('author'), original, name + ' rejection must be atomic');
    cases.push(name + ': author restore rejected atomically');
  }
  const bytes = readFileSync(join(directory, 'site-delete-preserves-market.btl'));
  await editor.request('restore', { revision: original.revision, document: JSON.stringify({ ...original,
    scenarios: ['conquest1'], files: { ...original.files, [path]: bytes.toString('base64') },
  }) });
  const author = await editor.request('author');
  assert.equal(author.files[path], bytes.toString('base64'));
  assert.equal((await editor.request('scenario/conquest1')).reverseReferences.valid, true);
  cases.push('negative site with independent commerce: author restore accepted');
  const response = await editor.fetch('export', { revision: author.revision,
    id: 'editor-site-tombstone', name: 'Site tombstone compatibility', version: '0.1.0',
  });
  if (!response.ok) assert.fail(await response.text());
  const packageBytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(directory, 'site-tombstone.ew4mod'), packageBytes);
  cases.push('negative site with independent commerce: standard package export accepted');
  writeFileSync(join(directory, 'author-result.json'), JSON.stringify({ checks: cases.length, cases, home: editor.home, packageBytes: packageBytes.length }, null, 2));
  console.log(`Rewrite author restore/export: ${cases.length} checks passed`);
} finally { await editor.stop(); }
