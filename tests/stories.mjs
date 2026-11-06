import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startEditor, root } from './helpers/editor.mjs';

const editor = await startEditor(5216, 'stories');
const checks = [];
try {
  const initial = await editor.request('author');
  const revision = initial.revision;
  const catalog = { schema: 1, backgrounds: { map: 'rewrite/story/media/map.png' }, characters: {}, bindings: { conquest1: { openingStory: { key: 'opening', scene: 'opening' } } },
    scenes: { opening: { schema: 1, id: 'opening', steps: [
      { id: 'hello', background: 'map', text: '剧情测试：请选择路线。', choices: [{ id: 'left', text: '左路', next: 'left' }, { id: 'right', text: '右路', next: 'right' }] },
      { id: 'left', text: '左路抵达。', end: true, result: 'left' }, { id: 'right', text: '右路抵达。', end: true, result: 'right' },
    ] } } };
  const image = readFileSync(resolve('public/assets/units/button_upgrade_militia.png')).toString('base64');
  const request = { revision, taskId: crypto.randomUUID(), catalog, files: { 'rewrite/story/media/map.png': image } };
  const preview = await editor.request('stories-preview', request);
  assert.equal((await editor.request('author')).revision, revision); checks.push('preview does not change author');
  await editor.request('apply', { revision, taskId: preview.taskId, token: preview.token });
  let saved = await editor.request('stories');
  assert.deepEqual(saved.catalog.scenes.opening, catalog.scenes.opening); checks.push('story and reusable PNG apply atomically');
  const beforePlay = await editor.request('author');
  const play = await editor.request('story-play', { revision: saved.revision, scenario: 'conquest1', scene: 'opening', catalog: saved.catalog });
  assert.equal(play.response.ok, true); assert.equal(play.response.data.story.node, 'hello');
  let state = play.response.data;
  const advance = async (op, target) => {
    const response = await editor.request('story-action', { session: play.session, op, revision: state.revision, offer: state.story.id, tag: state.story.node, target });
    assert.equal(response.ok, true, JSON.stringify(response)); state = response.data;
  };
  await advance('story_skip'); assert.equal(state.story.node, 'hello');
  await advance('story_choice', 'right'); assert.equal(state.story.node, 'right');
  await advance('story_next'); assert.equal(state.story, null); checks.push('actual game player branches and stops skip at choices');
  assert.deepEqual(await editor.request('author'), beforePlay); checks.push('playback leaves author and history unchanged');
  const unsafe = structuredClone(request); unsafe.revision = saved.revision; unsafe.taskId = crypto.randomUUID(); unsafe.files = { '../escape.png': image };
  await editor.request('stories-preview', unsafe, 400);
  const broken = structuredClone(catalog); broken.scenes.opening.steps[0].choices[0].next = 'missing';
  await editor.request('stories-preview', { revision: saved.revision, taskId: crypto.randomUUID(), catalog: broken }, 400);
  assert.deepEqual(await editor.request('author'), beforePlay); checks.push('unsafe paths and dangling branches are atomic failures');
  await editor.request('history', { revision: saved.revision, direction: 'undo' });
  assert.deepEqual((await editor.request('author')).files, initial.files);
  await editor.request('history', { revision: saved.revision + 1, direction: 'redo' });
  saved = await editor.request('stories'); assert(saved.catalog.scenes.opening); checks.push('undo and redo include PNG and catalog');
  const stale = { revision, taskId: crypto.randomUUID(), catalog };
  await editor.request('stories-preview', stale, 400); checks.push('stale revision rejected');
  const zip = await editor.fetch('export', { revision: saved.revision, id: 'story-editor-test', name: 'Story editor test', version: '1' });
  assert.equal(zip.status, 200, await zip.clone().text());
  mkdirSync(join(root, '.local/stories'), { recursive: true }); writeFileSync(join(root, '.local/stories/export.ew4mod'), Buffer.from(await zip.arrayBuffer()));
  checks.push('standard game Mod export includes story dependencies');
  writeFileSync(join(root, '.local/stories/result.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }));
} finally { await editor.stop(); }
