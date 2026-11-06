import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync('src/core/editor/commanderFields.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { computeCommanderValue, commanderFields } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
test('shared native fields exclude R bindings and round like the author engine', () => {
  assert.equal(commanderFields.length, 17); assert(!commanderFields.includes('skillBinding'));
  const rule = { field: 'cavalry', operation: 'multiply', value: 1.5, rounding: 'round', ids: [1] };
  assert.equal(computeCommanderValue(3, rule), 5);
  assert.equal(computeCommanderValue(-3, rule), -5);
  assert.equal(computeCommanderValue(3, { ...rule, rounding: 'floor' }), 4);
  assert.throws(() => computeCommanderValue(3, { ...rule, field: 'skillBinding' }));
  assert.throws(() => computeCommanderValue(3, { ...rule, value: Infinity }));
  assert.throws(() => computeCommanderValue(3, { ...rule, operation: 'unknown' }));
});
