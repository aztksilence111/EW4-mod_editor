import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

async function load(file) {
  const text = ts.transpileModule(readFileSync(resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'));
}
const { parseBtl, serializeBtl } = await load('src/core/formats/btl.ts');
const { parseBin, serializeBin } = await load('src/core/formats/bin.ts');
const { serializeProject, reviveProject } = await load('src/core/storage/projectPack.ts');
const arrayBuffer = bytes => Uint8Array.from(bytes).buffer;
const btlFiles = ['campaigns','conquests'].flatMap(dir => readdirSync('public/' + dir).filter(f => f.endsWith('.btl')).map(f => `public/${dir}/${f}`));

test('all 93 upstream BTL files round-trip byte for byte', () => {
  assert.equal(btlFiles.length, 93);
  for (const file of btlFiles) {
    const bytes = readFileSync(file);
    assert.deepEqual(Buffer.from(serializeBtl(parseBtl(arrayBuffer(bytes)))), bytes, file);
  }
});
test('extended bytes survive a no-op and project save; body edits cannot bypass the bridge', () => {
  const body = readFileSync(btlFiles[0]);
  const trailer = Buffer.concat([Buffer.from('EW4XBTL\0'), Buffer.from([1,0,0,0,1,0,0,0]), Buffer.from('TEST'), Buffer.from([1,0,0,0,0,0,0,0,3,0,0,0]), Buffer.from('abc')]);
  const bytes = Buffer.concat([body,trailer]);
  const parsed = reviveProject(JSON.parse(JSON.stringify(serializeProject(parseBtl(arrayBuffer(bytes))))));
  assert.deepEqual(Buffer.from(serializeBtl(parsed)), bytes);
  parsed.legions[0].food++;
  assert.throws(() => serializeBtl(parsed), /Rewrite/);
});
test('truncation, invalid version and numeric overflow reject', () => {
  const body = readFileSync(btlFiles[0]);
  assert.throws(() => parseBtl(arrayBuffer(body.subarray(0,60))));
  assert.throws(() => parseBtl(arrayBuffer(body.subarray(0,body.length-1))));
  const badVersion = Buffer.from(body); badVersion.writeInt32LE(1,0); assert.throws(() => parseBtl(arrayBuffer(badVersion)));
  const parsed = parseBtl(arrayBuffer(body)); parsed.legions[0].food = 2**40; assert.throws(() => serializeBtl(parsed), /越界/);
});
test('BIN accepts the exact rewrite header and rejects old broken export and trailers', () => {
  for (const name of ['europe.bin','america.bin']) {
    const bytes = readFileSync('public/maps/' + name); const parsed = parseBin(arrayBuffer(bytes));
    assert.equal(Buffer.from(parsed.info.bom).toString(), 'YSAE');
    assert.deepEqual(Buffer.from(serializeBin(parsed)),bytes);
    parsed.tiles[0].backTile=256;assert.throws(()=>serializeBin(parsed),/越界/);
    const bad = Buffer.from(bytes); bad.set([0xef,0xbb,0xbf,0]); assert.throws(() => parseBin(arrayBuffer(bad)), /文件头/);
    assert.throws(() => parseBin(arrayBuffer(Buffer.concat([bytes,Buffer.alloc(1)]))));
  }
});
