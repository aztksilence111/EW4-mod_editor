import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, startEditor } from './helpers/editor.mjs';

const b64 = value => Buffer.from(value).toString('base64');
const source = relative => readFileSync(join(root, '.local/rewrite/data', relative));
const replaceOnce = (bytes, from, to) => {
  const text = bytes.toString('utf8');
  assert.equal(text.includes(from), true, `fixture text missing: ${from}`);
  return Buffer.from(text.replace(from, to), 'utf8');
};

let editor = await startEditor(5188, 'resources');
try {
  const initial = await editor.request('author');
  const commander = replaceOnce(source('original/def_commander.xml'),
    '<commander id="1" name="Napoleon"', '<commander id="1" name="Napoleon_Test"');
  const cities = replaceOnce(source('original/def_areaname.xml'),
    '<areaname id="1" name="LONDON"', '<areaname id="1" name="LONDON_TEST"');
  const strings = replaceOnce(source('original/stringtable_cn.ini'), 'name_fra=法国', 'name_fra=法兰西测试');
  const files = {
    ...initial.files,
    'original/def_commander.xml': b64(commander),
    'original/def_areaname.xml': b64(cities),
    'original/stringtable_cn.ini': b64(strings),
  };
  const restored = await editor.request('restore', {
    revision: initial.revision,
    document: JSON.stringify({ ...initial, files }),
  });
  assert.equal(restored.revision, initial.revision + 1);

  const author = await editor.request('author');
  const manifest = JSON.parse(Buffer.from(author.files['client/manifest.json'], 'base64'));
  assert.equal(manifest.commanders['1'], 'Napoleon_Test');
  assert(manifest.atlases.commanders1_hd['Napoleon_Test.png']);
  assert.deepEqual(
    Buffer.from(author.files['client/ui/commanders1_hd/Napoleon_Test.png'], 'base64'),
    source('client/ui/commanders1_hd/Napoleon.png'),
  );
  assert.equal(manifest.strings.name_fra, '法兰西测试');

  const cityNames = JSON.parse(Buffer.from(author.files['frontend/city-names.json'], 'base64'));
  assert.equal(cityNames.cities['1'], 'LONDON_TEST');
  const countries = JSON.parse(Buffer.from(author.files['client/countries.json'], 'base64'));
  assert.equal(countries.countries.fra.name, '法兰西测试');

  const validated = await editor.request('validate', {});
  assert.equal(validated.valid, true);

  const invalidManifest = { ...author, files: { ...author.files } };
  const invalid = JSON.parse(Buffer.from(invalidManifest.files['client/manifest.json'], 'base64'));
  invalid.atlases.commanders1_hd['Napoleon_Test.png'].x = 999999;
  invalidManifest.files['client/manifest.json'] = b64(Buffer.from(JSON.stringify(invalid)));
  const rejected = await editor.request('restore', {
    revision: author.revision,
    document: JSON.stringify({ ...invalidManifest, revision: author.revision }),
  }, 400);
  assert.match(rejected.error, /图集坐标超出贴图/);
  const exported = await editor.fetch('export', {
    revision: author.revision, id: 'resource-check', name: 'Resource check', version: '1.0.0',
  });
  assert.equal(exported.status, 200);
  assert((await exported.arrayBuffer()).byteLength > 1024);

  const report = {
    checks: 8,
    cases: [
      'commander rename updates manifest and atlas alias',
      'string table updates manifest labels',
      'city names are emitted as frontend resource',
      'country names are regenerated from strings',
      'resource validation accepts synchronized project',
      'out-of-bounds atlas coordinates are rejected before export',
      'export validates and packages synchronized resources',
      'restore remains atomic through resource synchronization',
    ],
    home: editor.home,
  };
  writeFileSync(join(root, '.local/resources-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await editor.stop();
}
