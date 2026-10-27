// Story versions and migrations (kit/core/story-migrations.mjs): a story's
// version is its schema plus engine.revision; migrateStory walks the
// registry from the story's version to the engine's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {STORY_MIGRATIONS, STORY_REVISION, migrateStory, migrationProblems, stampStory, storyVersion} from '../kit/core/story-migrations.mjs';
import {STORY_SCHEMA, validateStory} from '../kit/core/story.mjs';
import {globalSettings} from '../src/render_segments.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const minimal = () => JSON.parse(readFileSync(path.join(ROOT, 'examples', 'story', 'minimal', 'storyboard.json'), 'utf8'));

// A registry for the tests: revision 1 renames scenes[].params.caption to label; v2 moves title under meta.
const V1 = 'launchclip.story.v1', V2 = 'launchclip.story.v2';
const RENAME = {id: 'v1.1-caption-to-label', from: {schema: V1, revision: 0}, to: {schema: V1, revision: 1}, describe: 'params.caption is now params.label', migrate(story) {
  for (const scene of story.scenes ?? []) if (scene.params && 'caption' in scene.params) { scene.params.label = scene.params.caption; delete scene.params.caption; }
  return story;
}};
const MAJOR = {id: 'v2.0-title-in-meta', from: {schema: V1, revision: 1}, to: {schema: V2, revision: 0}, describe: 'title moves to meta.title', migrate(story) {
  story.meta = {...story.meta, title: story.title};
  delete story.title;
  return story;
}};

test('the shipped registry is sound and ends at the current revision', () => {
  assert.equal(STORY_REVISION, 0);
  assert.deepEqual(migrationProblems(), []);
  assert.ok(Object.isFrozen(STORY_MIGRATIONS));
});

test('a current story comes back as it is, with nothing applied', () => {
  const story = minimal();
  const result = migrateStory(story);
  assert.equal(result.story, story);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.from, {schema: STORY_SCHEMA, revision: 0});
  assert.deepEqual(storyVersion(stampStory(story, {version: '0.2.0'})), {schema: STORY_SCHEMA, revision: STORY_REVISION});
});

test('migrations run in order, on a copy, and stamp each revision', () => {
  const story = {...minimal(), title: 'T', scenes: [{id: 's1', module: 'x', params: {caption: 'Hi'}}]};
  const before = JSON.stringify(story);
  const one = migrateStory(story, {migrations: [RENAME], current: {schema: V1, revision: 1}});
  assert.deepEqual(one.applied, ['v1.1-caption-to-label']);
  assert.deepEqual(one.story.scenes[0].params, {label: 'Hi'});
  assert.deepEqual(one.story.engine, {revision: 1});
  assert.equal(JSON.stringify(story), before, 'the input is untouched');
  const both = migrateStory(story, {migrations: [RENAME, MAJOR], current: {schema: V2, revision: 0}});
  assert.deepEqual(both.applied, ['v1.1-caption-to-label', 'v2.0-title-in-meta']);
  assert.equal(both.story.schema, V2);
  assert.equal(both.story.meta.title, 'T');
  assert.equal(both.story.engine, undefined, 'revision 0 of a new major needs no stamp');
  // Starting part-way along skips the steps already taken.
  assert.deepEqual(migrateStory(one.story, {migrations: [RENAME, MAJOR], current: {schema: V2, revision: 0}}).applied, ['v2.0-title-in-meta']);
  // The writer's version survives a migration.
  assert.deepEqual(migrateStory({...story, engine: {version: '0.1.0'}}, {migrations: [RENAME], current: {schema: V1, revision: 1}}).story.engine, {version: '0.1.0', revision: 1});
});

test('a story newer than the engine, or with no path forward, is refused with a clear error', () => {
  assert.throws(() => migrateStory({...minimal(), engine: {revision: 3}}), /launchclip\.story\.v1@3, newer than this engine reads \(launchclip\.story\.v1@0\); upgrade launchclip/);
  assert.throws(() => migrateStory({...minimal(), schema: 'launchclip.story.v9'}), /newer than this engine reads/);
  assert.throws(() => migrateStory(minimal(), {migrations: [], current: {schema: V1, revision: 1}}), /no migration from launchclip\.story\.v1@0 toward launchclip\.story\.v1@1/);
  const broken = {...RENAME, migrate() { throw new Error('boom'); }};
  assert.throws(() => migrateStory(minimal(), {migrations: [broken], current: {schema: V1, revision: 1}}), /migration v1\.1-caption-to-label \(launchclip\.story\.v1@0 → launchclip\.story\.v1@1\) failed: boom/);
  // Not a launchclip story: validateStory says so, migrateStory leaves it alone.
  assert.deepEqual(migrateStory({schema: 'other'}).applied, []);
});

test('migrationProblems catches registries that skip, repeat or stop short', () => {
  assert.deepEqual(migrationProblems([RENAME, MAJOR], {current: {schema: V2, revision: 0}}), []);
  const skip = {...RENAME, to: {schema: V1, revision: 2}};
  assert.match(migrationProblems([skip], {current: {schema: V1, revision: 2}}).join('\n'), /must step forward by one/);
  assert.match(migrationProblems([RENAME, RENAME], {current: {schema: V1, revision: 1}}).join('\n'), /id is used twice/);
  assert.match(migrationProblems([RENAME], {current: {schema: V1, revision: 2}}).join('\n'), /ends at launchclip\.story\.v1@1, not the current launchclip\.story\.v1@2/);
  assert.match(migrationProblems([{id: 'x', from: {schema: V1, revision: 0}, to: {schema: V1, revision: 1}}], {current: {schema: V1, revision: 1}}).join('\n'), /needs a migrate\(story\) function/);
});

test('validateStory accepts the engine stamp and refuses a revision it does not read', () => {
  const errors = (engine) => validateStory({...minimal(), engine}).errors;
  assert.deepEqual(errors({version: '0.2.0', revision: 0}), []);
  assert.deepEqual(validateStory(stampStory(minimal(), {version: '0.2.0'})).warnings, []);
  assert.match(errors({revision: 1}).join('\n'), /engine\.revision 1 is newer than this engine reads \(launchclip\.story\.v1 revision 0\); upgrade launchclip/);
  assert.match(errors({revision: -1}).join('\n'), /engine\.revision must be a whole number from 0/);
  assert.match(errors({version: ''}).join('\n'), /engine\.version must be the launchclip version/);
  assert.match(errors({build: 1}).join('\n'), /engine\.build is not supported/);
  assert.match(errors('0.2.0').join('\n'), /engine must be \{version\?, revision\?\}/);
});

test('the stamp never reaches a frame: render segments ignore it', () => {
  const story = minimal();
  assert.deepEqual(globalSettings(stampStory(story, {version: '9.9.9'})).top, globalSettings(story).top);
});
