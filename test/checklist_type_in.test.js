// Footage checklist type-in (docs/SUBJECT_EFFECTS_RFC.md §6.2): in the
// footage-led lane each row fades in on its at word and its label types in
// letter by letter on the frame grid, then ticks on doneAt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TYPE_IN, checklistTypeIn} from '../kit/core/editorial-core.mjs';
import {resolveModule} from '../kit/core/modules.mjs';
import {resolveStory} from '../kit/core/story.mjs';
import {EMITTERS} from '../kit/hyperframes/editorial-ui-modules.mjs';
import {collectTyping} from '../src/sfx/typing.js';
import {readStorySubject} from '../src/subject/project.js';

const PROJECT = fileURLToPath(new URL('../examples/story/subject-data', import.meta.url));

async function resolved(lane = 'footage-led') {
  const story = JSON.parse(readFileSync(join(PROJECT, 'storyboard.json'), 'utf8'));
  story.lane = lane;
  if (lane !== 'footage-led') { story.base = null; story.scenes = story.scenes.filter((scene) => scene.module === 'checklist'); }
  return resolveStory(story, {subject: lane === 'footage-led' ? await readStorySubject(PROJECT, story) : null});
}
const checklist = async (lane) => { const story = await resolved(lane); return resolveModule(story.scenes.find((scene) => scene.module === 'checklist'), story); };

test('footage-led checklist rows type in on the frame grid and finish before the tick', async () => {
  const model = await checklist();
  assert.equal(model.content.typeIn, true);
  for (const row of model.content.rows) {
    assert.equal(row.typed.length, [...row.label].length);
    assert.equal(row.typed[0].time, row.time, 'the first letter lands on the at word');
    assert.equal(row.typed.at(-1).text, row.label);
    row.typed.forEach((frame, k) => {
      assert.equal(frame.text, row.label.slice(0, k + 1));
      if (k) {
        assert.ok(frame.time >= row.typed[k - 1].time, 'letters never go back in time');
        assert.ok(Math.abs(frame.time * 30 - Math.round(frame.time * 30)) < 1e-4, `letter ${k} at ${frame.time} is on the frame grid`);
      }
    });
    assert.ok(row.typeEnd <= row.time + TYPE_IN.window + 1 / 30);
    if (row.doneTime !== null) assert.ok(row.typeEnd <= row.doneTime - TYPE_IN.beforeDone + 1 / 30, 'typed before it ticks');
  }
  const typing = model.events.filter((event) => /typing-start$/.test(event.id));
  assert.deepEqual(typing.map((event) => event.time), model.content.rows.map((row) => row.time));
});

test('outside the footage-led lane the checklist is unchanged', async () => {
  const model = await checklist('motion');
  assert.equal(model.content.typeIn, undefined);
  assert.ok(model.content.rows.every((row) => row.typed === undefined));
  assert.equal(checklistTypeIn({content: {}}).content.typeIn, undefined, 'non-checklist models pass through');
});

test('the emitter hides each row until its time and sets the label letter by letter', async () => {
  const model = await checklist();
  const out = EMITTERS.checklist(model);
  const row = model.content.rows[0];
  assert.match(out.html, new RegExp(`id="${model.id}-label-0" class="ui-label"`));
  assert.ok(out.motion.includes(`tl.set("#${model.id}-row-0", {opacity:0}, ${model.start});`));
  assert.ok(out.motion.includes(`tl.to("#${model.id}-row-0", {opacity:1,duration:${TYPE_IN.fade}}, ${row.time});`));
  assert.ok(out.motion.includes(`tl.set("#${model.id}-label-0", {textContent:''}, ${model.start});`));
  for (const frame of row.typed) assert.ok(out.motion.includes(`tl.set("#${model.id}-label-0", {textContent:${JSON.stringify(frame.text)}}, ${frame.time});`), frame.text);
  const plain = EMITTERS.checklist(await checklist('motion'));
  assert.doesNotMatch(plain.motion, /-label-0/);
});

test('the typing track gets keystrokes for each row', async () => {
  const story = await resolved();
  const {chars} = collectTyping(story, {models: (scene) => resolveModule(scene, story)});
  const model = await checklist();
  for (const row of model.content.rows) assert.ok(chars.some((char) => char.at > row.time && char.at <= row.typeEnd + 1 / 30), `keys while row ${row.index} types`);
});
