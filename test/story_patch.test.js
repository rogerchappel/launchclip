// Story patches (kit/core/story-patch.mjs, src/story_patch.js): chat edits
// as RFC 6902 JSON Patch, checked like a planned storyboard, and the render
// segments each edit invalidates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {applyJsonPatch, applyStoryPatch, formatPointer, messagePointer, parsePointer} from '../kit/core/story-patch.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file) => JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
// The promo golden: six catalogue scenes over real narration words.
const promo = () => read('examples/story/promo-16x9/storyboard.json');
const narration = read('examples/story/promo-16x9/NARRATION.json');
const WORDS = Array.isArray(narration) ? narration : narration.words;
const patchPromo = (patch, options = {}) => applyStoryPatch(promo(), patch, {words: WORDS, ...options});
const HOOK = 0; // s1, hook-title
const NEW_HEADLINE = 'Ship release notes in minutes, never in days.';

test('RFC 6901 pointers parse, format and escape', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/a~1b/c~0d/0'), ['a/b', 'c~d', '0']);
  assert.equal(formatPointer(['a/b', 'c~d', '0']), '/a~1b/c~0d/0');
  assert.throws(() => parsePointer('scenes/0'), /is not a JSON Pointer/);
  assert.throws(() => parsePointer('/a~2'), /bad escape/);
  assert.equal(messagePointer('scenes[2].params.rows[0].label must not be empty'), '/scenes/2/params/rows/0/label');
  assert.equal(messagePointer('format.width must be a positive integer'), '/format/width');
  assert.equal(messagePointer('a story with no path'), '/a');
  // Against the story, prose names no path; a missing field still does.
  const story = {schema: 'launchclip.story.v1', scenes: []};
  assert.equal(messagePointer('story must be a JSON object', story), '');
  assert.equal(messagePointer('scene inside: starts 0.2 s before section s5', story), '');
  assert.equal(messagePointer('lane must be one of motion, voiceover-motion, footage-led', story), '/lane');
  assert.equal(messagePointer('scenes[0].id must be a lowercase identifier', story), '/scenes/0/id');
});

// The examples from RFC 6902 appendix A.
test('applyJsonPatch follows RFC 6902', () => {
  const ok = (doc, patch) => { const result = applyJsonPatch(doc, patch); assert.equal(result.ok, true, JSON.stringify(result.error)); return result.doc; };
  assert.deepEqual(ok({foo: 'bar'}, [{op: 'add', path: '/baz', value: 'qux'}]), {foo: 'bar', baz: 'qux'});
  assert.deepEqual(ok({foo: ['bar', 'baz']}, [{op: 'add', path: '/foo/1', value: 'qux'}]), {foo: ['bar', 'qux', 'baz']});
  assert.deepEqual(ok({baz: 'qux', foo: 'bar'}, [{op: 'remove', path: '/baz'}]), {foo: 'bar'});
  assert.deepEqual(ok({foo: ['bar', 'qux', 'baz']}, [{op: 'remove', path: '/foo/1'}]), {foo: ['bar', 'baz']});
  assert.deepEqual(ok({baz: 'qux', foo: 'bar'}, [{op: 'replace', path: '/baz', value: 'boo'}]), {baz: 'boo', foo: 'bar'});
  assert.deepEqual(ok({foo: {bar: 'baz', waldo: 'fred'}, qux: {corge: 'grault'}}, [{op: 'move', from: '/foo/waldo', path: '/qux/thud'}]), {foo: {bar: 'baz'}, qux: {corge: 'grault', thud: 'fred'}});
  assert.deepEqual(ok({foo: ['all', 'grass', 'cows', 'eat']}, [{op: 'move', from: '/foo/1', path: '/foo/3'}]), {foo: ['all', 'cows', 'eat', 'grass']});
  assert.deepEqual(ok({baz: 'qux', foo: ['a', 2, 'c']}, [{op: 'test', path: '/baz', value: 'qux'}, {op: 'test', path: '/foo/1', value: 2}]), {baz: 'qux', foo: ['a', 2, 'c']});
  assert.deepEqual(ok({foo: 'bar'}, [{op: 'add', path: '/child', value: {grandchild: {}}}]), {foo: 'bar', child: {grandchild: {}}});
  assert.deepEqual(ok({foo: ['bar']}, [{op: 'add', path: '/foo/-', value: ['abc', 'def']}]), {foo: ['bar', ['abc', 'def']]});
  assert.deepEqual(ok({'/': 9, '~1': 10}, [{op: 'test', path: '/~01', value: 10}]), {'/': 9, '~1': 10});
  assert.deepEqual(ok({a: {b: 1}}, [{op: 'copy', from: '/a', path: '/c'}]), {a: {b: 1}, c: {b: 1}});
  assert.deepEqual(ok({a: 1}, [{op: 'replace', path: '', value: [1]}]), [1]);

  const fail = (doc, patch) => { const result = applyJsonPatch(doc, patch); assert.equal(result.ok, false); return result.error; };
  assert.deepEqual(fail({baz: 'qux'}, [{op: 'test', path: '/baz', value: 'bar'}]), {op: 0, path: '/baz', message: 'test failed: /baz is "qux", not "bar"'});
  assert.deepEqual(fail({foo: 'bar'}, [{op: 'add', path: '/baz/bat', value: 'qux'}]), {op: 0, path: '/baz/bat', message: '/baz does not exist (needed by /baz/bat)'});
  assert.deepEqual(fail({foo: ['bar', 'baz']}, [{op: 'add', path: '/foo/3', value: 'x'}]), {op: 0, path: '/foo/3', message: '/foo/3: index 3 is outside the array (length 2)'});
  assert.equal(fail({a: 1}, [{op: 'replace', path: '/b', value: 2}]).message, '/b does not exist');
  assert.equal(fail({a: 1}, [{op: 'remove', path: '/b'}]).message, '/b does not exist');
  assert.equal(fail({a: {b: 1}}, [{op: 'move', from: '/a', path: '/a/b/c'}]).message, 'cannot move /a into its own child /a/b/c');
  assert.equal(fail({a: 1}, [{op: 'add', path: '/b'}]).message, 'add needs a value');
  assert.equal(fail({a: 1}, [{op: 'merge', path: '/b', value: 1}]).message, 'op must be one of add, remove, replace, move, copy, test');
  assert.equal(fail({a: 1}, {op: 'add'}).message, 'a patch must be an array of operations');
});

test('patches are atomic: a failing op leaves no partial edit and the input is never changed', () => {
  const doc = {a: 1, list: [1, 2]};
  const result = applyJsonPatch(doc, [{op: 'replace', path: '/a', value: 2}, {op: 'remove', path: '/list/0'}, {op: 'test', path: '/a', value: 3}]);
  assert.equal(result.ok, false);
  assert.equal(result.error.op, 2);
  assert.deepEqual(doc, {a: 1, list: [1, 2]});
  const good = applyJsonPatch(doc, [{op: 'add', path: '/list/-', value: {x: 1}}]);
  good.doc.list[2].x = 9;
  assert.deepEqual(doc, {a: 1, list: [1, 2]});
});

test('applyStoryPatch: a good edit validates, resolves and passes the layout check', () => {
  const story = promo();
  const result = applyStoryPatch(story, [{op: 'test', path: `/scenes/${HOOK}/module`, value: 'hook-title'}, {op: 'replace', path: `/scenes/${HOOK}/params/headline`, value: NEW_HEADLINE}], {words: WORDS});
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.story.scenes[HOOK].params.headline, NEW_HEADLINE);
  assert.ok(result.resolved.resolved.frames > 0);
  assert.notEqual(story.scenes[HOOK].params.headline, NEW_HEADLINE, 'the input story is untouched');
});

test('applyStoryPatch reports each failure with its stage and JSON Pointer', () => {
  // patch: the failing op's index and path; no story comes back.
  const bad = patchPromo([{op: 'replace', path: '/scenes/99/params', value: {}}]);
  assert.equal(bad.ok, false);
  assert.equal(bad.story, null);
  assert.deepEqual(bad.errors, [{stage: 'patch', path: '/scenes/99/params', message: '/scenes/99 does not exist', op: 0}]);
  // validate: a param schema error, at the param.
  const long = patchPromo([{op: 'replace', path: `/scenes/${HOOK}/params/headline`, value: 'x'.repeat(95)}]);
  assert.equal(long.ok, false);
  assert.ok(long.story, 'the patched story comes back so an editor can show it');
  assert.equal(long.resolved, null);
  assert.deepEqual(long.errors, [{stage: 'validate', path: `/scenes/${HOOK}/params/headline`, message: `scenes[${HOOK}].params.headline must be at most 90 characters (it has 95)`}]);
  // validate: story-level rules too.
  assert.deepEqual(patchPromo([{op: 'replace', path: '/format/fps', value: 0}]).errors.map(({stage, path}) => ({stage, path})), [{stage: 'validate', path: '/format/fps'}]);
  // resolve: an anchor with no narration word.
  const anchored = patchPromo([{op: 'replace', path: '/scenes/1/start', value: 'word:nonexistent'}]);
  assert.deepEqual(anchored.errors.map(({stage, path}) => ({stage, path})), [{stage: 'resolve', path: '/scenes/1/start'}]);
  // params: a value only the module itself can reject (emphasis must be words of the headline).
  const emphasis = patchPromo([{op: 'replace', path: `/scenes/${HOOK}/params/emphasis`, value: 'notaword'}]);
  assert.deepEqual(emphasis.errors.map(({stage, path}) => ({stage, path})), [{stage: 'params', path: `/scenes/${HOOK}/params`}]);
  assert.match(emphasis.errors[0].message, /emphasis/);
});

test('applyStoryPatch reports layout findings against the scene', () => {
  // The data-story golden (9:16, captions): s4's step rail moved down into the caption band.
  const story = read('examples/story/data-story-9x16/storyboard.json');
  const words = read('examples/story/data-story-9x16/NARRATION.json').words;
  const patch = [{op: 'test', path: '/scenes/3/module', value: 'step-rail'}, {op: 'add', path: '/scenes/3/params/rect', value: {x: 90, y: 1100, width: 900, height: 400}}];
  const result = applyStoryPatch(story, patch, {words});
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 2);
  assert.ok(result.errors.every((entry) => entry.stage === 'layout' && entry.path === '/scenes/3'), JSON.stringify(result.errors));
  assert.ok(result.errors.some((entry) => /^caption-band /.test(entry.message)));
  assert.ok(result.errors.some((entry) => /^safe-zone /.test(entry.message)));
  assert.equal(result.layout.errors, result.errors.length);
  assert.ok(result.resolved, 'layout runs on the resolved story');
  assert.deepEqual(applyStoryPatch(story, patch, {words, layout: false}).errors, []);
});

test('applyStoryPatch refuses a story newer than the engine before patching', () => {
  const result = applyStoryPatch({...promo(), engine: {revision: 5}}, []);
  assert.deepEqual(result.errors.map(({stage}) => stage), ['migrate']);
});

test('story-patch.mjs and story-migrations.mjs stay pure ESM: sibling kit/core imports only', () => {
  for (const name of ['story-patch.mjs', 'story-migrations.mjs']) {
    const source = readFileSync(path.join(ROOT, 'kit', 'core', name), 'utf8');
    for (const [, specifier] of source.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(specifier, /^\.\/[a-z0-9-]+\.mjs$/, `${name}: ${specifier}`);
  }
});
