// Subject contract in story v1 (docs/SUBJECT_EFFECTS_RFC.md §5): base.subject,
// scene layer, and resolveStory filling "auto" from the project's mattes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStory, resolveStory, storyBase, subjectMode} from '@launchclip/core/story.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const MATTE = {src: 'assets/subject/0.000-6.000.webm', in: 0, out: 6, info: 'assets/subject/0.000-6.000.json'};

function story({base = {src: 'assets/recording.mp4'}, layer = 'behind', lane = 'footage-led', scene = {}} = {}) {
  return {schema: 'launchclip.story.v1', lane, format: {width: 1080, height: 1920, fps: 30, duration: 6}, brand, base,
    scenes: [{id: 'word', module: 'emphasis-caption', track: 1, start: 1, end: 4, ...(layer ? {layer} : {}), params: {text: 'FOCUS'}, ...scene}]};
}
const errors = (value) => validateStory(value).errors.join('\n');

test('base.subject accepts auto, off and explicit mattes', () => {
  assert.equal(errors(story({base: {src: 'assets/recording.mp4', subject: 'auto'}})), '');
  assert.equal(errors(story({base: {src: 'assets/recording.mp4', subject: {mattes: [MATTE]}}})), '');
  assert.equal(errors(story({base: {src: 'assets/recording.mp4', subject: 'off'}, layer: null})), '');
});

test('base.subject rejects bad modes and mattes', () => {
  const base = (subject) => story({base: {src: 'assets/recording.mp4', subject}, layer: null});
  assert.match(errors(base('maybe')), /base\.subject must be "auto" or "off"/);
  assert.match(errors(base({mattes: [{...MATTE, src: 'assets/subject/a.mp4'}]})), /must be an alpha \.webm/);
  assert.match(errors(base({mattes: [{...MATTE, src: '../a.webm'}]})), /project-relative path/);
  assert.match(errors(base({mattes: [{...MATTE, out: 0}]})), /needs in and out source seconds/);
  assert.match(errors(base({mattes: [MATTE, {...MATTE, in: 5, out: 8}]})), /overlaps the matte before it/);
  assert.match(errors(base({mattes: [{...MATTE, alpha: true}]})), /\.alpha is not supported/);
  assert.match(errors(base({tracks: []})), /base\.subject must be "auto", "off" or \{mattes/);
});

test('scene layer: values, lane, inserts and subject off', () => {
  assert.equal(errors(story({layer: 'front'})), '');
  assert.equal(errors(story({layer: 'split'})), '');
  assert.match(errors(story({layer: 'under'})), /\.layer must be one of front, behind, split/);
  assert.match(errors(story({base: {src: 'assets/recording.mp4', subject: 'off'}})), /needs the subject, but base\.subject is "off"/);
  const motion = {...story({lane: 'motion', base: null}), base: undefined};
  delete motion.base;
  assert.match(errors(motion), /needs the footage-led lane/);
  assert.match(errors(story({scene: {insert: true, track: 0, module: 'count-up', params: {value: 3, label: 'x'}}})), /an insert covers the whole frame/);
});

test('subjectMode and storyBase report the subject', () => {
  assert.equal(subjectMode({src: 'assets/r.mp4'}), 'auto');
  assert.equal(subjectMode('assets/r.mp4'), 'auto');
  assert.equal(subjectMode({src: 'assets/r.mp4', subject: 'off'}), 'off');
  assert.equal(subjectMode({src: 'assets/r.mp4', subject: {mattes: []}}), 'mattes');
  const base = storyBase(resolveStory(story({base: {src: 'assets/recording.mp4', subject: {mattes: [MATTE]}}})));
  assert.deepEqual(base.subject, {mode: 'mattes', mattes: [MATTE]});
  assert.deepEqual(storyBase(resolveStory(story())).subject, {mode: 'auto', mattes: []});
});

test('resolveStory fills an auto subject from the project mattes, never an explicit or off one', () => {
  const later = {...MATTE, src: 'assets/subject/b.webm', in: 8, out: 9};
  const filled = resolveStory(story(), {subject: [later, MATTE]});
  assert.deepEqual(filled.base.subject.mattes.map((matte) => matte.in), [0, 8]);
  const legacy = resolveStory({...story(), base: 'assets/recording.mp4'}, {subject: [MATTE]});
  assert.deepEqual(legacy.base, {src: 'assets/recording.mp4', subject: {mattes: [MATTE]}});
  const off = resolveStory(story({base: {src: 'assets/recording.mp4', subject: 'off'}, layer: null}), {subject: [MATTE]});
  assert.equal(off.base.subject, 'off');
  const explicit = {src: 'assets/subject/x.webm', in: 1, out: 2};
  assert.deepEqual(resolveStory(story({base: {src: 'assets/recording.mp4', subject: {mattes: [explicit]}}}), {subject: [MATTE]}).base.subject.mattes, [explicit]);
});

test('mattes accept a plate, and explicit mattes take summaries from the loader', () => {
  const plated = {...MATTE, plate: 'assets/subject/0.000-6.000.plate.jpg'};
  assert.equal(errors(story({base: {src: 'assets/recording.mp4', subject: {mattes: [plated]}}})), '');
  assert.match(errors(story({base: {src: 'assets/recording.mp4', subject: {mattes: [{...MATTE, plate: 'assets/p.gif'}]}}})), /plate must be the range's plate image/);
  const summary = {framing: 'medium', head: {x: 0.5, y: 0.3, w: 0.2, h: 0.2}};
  const resolved = resolveStory(story({base: {src: 'assets/recording.mp4', subject: {mattes: [plated]}}}), {subject: [{...plated, summary}]});
  assert.deepEqual(resolved.base.subject.mattes[0].summary, summary);
  assert.deepEqual(storyBase(resolved).subject.mattes[0].plate, plated.plate);
});
