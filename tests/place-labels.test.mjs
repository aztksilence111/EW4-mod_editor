import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync('src/core/editor/placeLabels.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { describePlaces } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('custom names survive; unnamed facilities use a same-owner geographic anchor', () => {
  const places = describePlaces([
    { cell: 55, name: '迪化', kind: 'city', country: 'yang' },
    { cell: 56, name: '工厂', kind: 'industry', country: 'yang' },
    { cell: 57, name: '哈密', kind: 'city', country: 'hami' },
    { cell: 44, name: null, kind: 'stable', country: 'yang' },
    { cell: 11, name: null, kind: 'city', country: 'unknown' },
    { cell: 33, name: '承化寺', kind: 'city', country: 'cheng' },
  ], 10, [{ id: 'yang', name: '杨增新' }]);
  assert.equal(places[0].label, '迪化');
  assert.equal(places[1].label, '迪化东侧工厂');
  assert.equal(places[1].countryName, '杨增新');
  assert.equal(places[1].named, false);
  assert.equal(places[3].label, '迪化西北侧马厩');
  assert.equal(places[4].label, '未命名城市（1, 1）');
  assert.equal(places[5].label, '承化寺');
  assert.equal(places[5].named, true);
});
