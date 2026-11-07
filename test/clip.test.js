// clip (kit/core/catalog-d-clip.mjs): one full-frame shot of supplied footage
// cut to the narration — crop focus, source window, a gentle Ken Burns move
// on stills, a grammar entrance, callouts above the caption band — drawn the
// same by both renderers and seen by layout-check and the movement gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {MODULES, clipTimeline, clipView} from '@launchclip/core/catalog-d.mjs';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {resolveStory, validateStory} from '@launchclip/core/story.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {validateModuleParams} from '@launchclip/core/module-schemas.mjs';
import {sceneDrift} from '@launchclip/core/ambient.mjs';
import {checkLayout, layoutExtras, profileGeometry} from '@launchclip/core/layout-check.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-d.mjs';
import {checkStoryboard} from '../src/storyboard_planner.js';
import {moduleParamErrors} from '../src/story_cli.js';
import {sceneModels} from '@launchclip/core/render-segments.mjs';
import {holdGate} from '../src/movement_guardrails.js';
import {assertMatchesFrameState} from './helpers/frame_state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const brand = {colors: {bg: '#10132a', primary: '#7c70ff', accent: '#22c3ee', ink: '#10132a', paper: '#f4f2ff'}, fonts: {display: 'space-grotesk', body: 'inter', meta: 'jetbrains-mono'}};
const PORTRAIT = {width: 1080, height: 1920, fps: 30, duration: 12};
const AUDIO = {voice: 'assets/audio/narration.wav', words: 'NARRATION.json'};
const story = (scenes, extra = {}) => ({schema: 'launchclip.story.v1', lane: 'voiceover-motion', audio: AUDIO, format: PORTRAIT, brand, scenes: Array.isArray(scenes) ? scenes : [scenes], overlays: [{type: 'captions', style: 'word-highlight'}], ...extra});
const scene = (params, extra = {}) => ({id: 's2', module: 'clip', start: 4, end: 8, params: {media: 'assets/footage/ute.mp4', ...params}, ...extra});
const resolve = (params, extra = {}, storyExtra = {}) => { const s = scene(params, extra); return resolveModule(s, story(s, storyExtra)); };

// The footage's corners through its transform (about the move's pivot).
function covers(sample, origin, canvas) {
  const map = (x, y) => ({x: origin.x + (x - origin.x) * sample.scale + sample.x, y: origin.y + (y - origin.y) * sample.scale + sample.y});
  const tl = map(0, 0), br = map(canvas.width, canvas.height);
  return tl.x <= 1e-6 && tl.y <= 1e-6 && br.x >= canvas.width - 1e-6 && br.y >= canvas.height - 1e-6;
}

test('clip: a video crops about its focus, plays its source window and holds its frame by default', () => {
  const model = resolve({media: {src: 'assets/footage/ute.mp4', sourceStart: 2.5, sourceEnd: 9}, focus: {x: 0.3, y: 0.6}});
  assert.equal(model.content.media.kind, 'video');
  assert.deepEqual([model.content.media.sourceStart, model.content.media.sourceEnd], [2.5, 9]);
  assert.equal(model.content.objectPosition, '30% 60%');
  assert.equal(model.content.move, 'none');
  assert.equal(model.content.enter, 'cut');
  assert.equal(model.content.samples.length, 0, 'no per-frame move on a held video');
  assert.equal(model.hidesCaptions, false);
  // Full-frame footage: media that other scenes may sit over, moving on its own.
  assert.equal(model.layout.role, 'media');
  assert.deepEqual(model.layout.rect, {x: 0, y: 0, width: 1080, height: 1920});
  assert.deepEqual(model.layout.allowOcclusion, ['*']);
  assert.equal(model.layout.drift, false);
  assert.equal(model.layout.live, true);
  const view = clipView(model);
  assert.equal(view.media.tag, 'video');
  assert.equal(view.media.style.objectFit, 'cover');
  assert.equal(view.media.style.objectPosition, '30% 60%');
});

test('clip: a still gets a gentle Ken Burns push that keeps the frame covered and never stops', () => {
  const canvas = {width: 1080, height: 1920};
  const still = resolve({media: 'assets/photos/camp.jpg'});
  assert.equal(still.content.media.kind, 'image');
  assert.deepEqual([still.content.move, still.content.zoom], ['push-in', 0.06]);
  for (const move of ['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down']) {
    for (const focus of [{x: 0.5, y: 0.5}, {x: 0, y: 1}]) {
      const {samples, origin} = resolve({media: 'assets/photos/camp.jpg', move, focus, zoom: 0.1}).content;
      assert.equal(samples.length, 4 * 30 + 1);
      for (const sample of samples) assert.ok(covers(sample, origin, canvas), `${move} ${JSON.stringify(focus)} at ${sample.t}`);
      for (let i = 1; i < samples.length; i++) assert.notDeepEqual({...samples[i], t: 0}, {...samples[i - 1], t: 0}, `${move} holds still at ${samples[i].t}`);
    }
  }
  // The move's pivot stays off the very edge even when the crop focus is on it.
  assert.deepEqual(resolve({media: 'assets/photos/camp.jpg', focus: {x: 0, y: 1}}).content.pivot, {x: 0.15, y: 0.85});
  // A still with no move holds, so it is not live (the hold gate then judges it).
  assert.equal(resolve({media: 'assets/photos/camp.jpg', move: 'none'}).layout.live, false);
});

test('clip: the entrance follows the motion grammar', () => {
  // editorial: a cut (the scene's in transition does the dressing).
  const cut = resolve({});
  assert.equal(cut.content.enter, 'cut');
  assert.equal(cut.motion.enterEnd, 4);
  // snappy and playful settle: a scale from 1.06 to 1 on the grammar's ease, with no dip to the background.
  const snappy = resolve({}, {}, {motion: {grammar: 'snappy'}});
  assert.equal(snappy.content.enter, 'settle');
  assert.equal(snappy.motion.enterFrom.opacity, 1);
  const {samples} = snappy.content;
  assert.equal(samples[0].scale, 1.06);
  assert.equal(samples.at(-1).scale, 1);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].scale <= samples[i - 1].scale + 1e-9, 'the settle only eases in');
  // cinematic gives a video a slow 3% push, so the shot never sits still.
  const cinematic = resolve({}, {}, {motion: {grammar: 'cinematic'}});
  assert.deepEqual([cinematic.content.move, cinematic.content.zoom], ['push-in', 0.03]);
  // fade: opacity in over the grammar's enter duration; exit fade on request.
  const fade = resolve({enter: 'fade', exit: 'fade'});
  assert.equal(fade.motion.enterFrom.opacity, 0);
  assert.equal(fade.motion.exitTo.opacity, 0);
  const ops = clipTimeline(fade);
  assert.ok(ops.some(op => op.type === 'tween' && op.target === 's2-media' && op.from.opacity === 0 && op.to.opacity === 1));
  assert.ok(ops.some(op => op.type === 'tween' && op.target === 's2-media' && op.from.opacity === 1 && op.to.opacity === 0));
  // The opening plate rests on frame 0 (kit/core/modules.mjs openingSettled), so a fade there does not fade.
  const opening = resolveModule({...scene({enter: 'fade'}), start: 0, end: 4}, story({...scene({enter: 'fade'}), start: 0, end: 4}));
  assert.equal(opening.motion.enterFrom.opacity, 1);
  assert.ok(!clipTimeline(opening).some(op => op.type === 'tween' && op.target === 's2-media' && op.to.opacity === 1));
});

test('clip: callouts sit in one slot above the caption band, one after another, each held for its reading time', () => {
  const model = resolve({callouts: ['Payload 1,100 kg', {text: 'Rated for corrugations', emphasis: true}]});
  const band = profileGeometry({width: 1080, height: 1920}).captionBand;
  const safe = profileGeometry({width: 1080, height: 1920}).safeZone;
  const [a, b] = model.content.callouts;
  for (const c of [a, b]) {
    assert.ok(c.box.y + c.box.height <= band.y, `${c.text} above the caption band`);
    assert.ok(c.box.x >= safe.x && c.box.x + c.box.width <= safe.x + safe.width, `${c.text} inside the safe zone`);
    assert.ok(c.until - c.at >= 1.2 - 1e-9);
    assert.ok(c.size >= 44);
  }
  assert.equal(a.box.y, b.box.y, 'one slot');
  assert.ok(b.at >= a.until + 0.15 - 1e-9, 'one after another');
  assert.equal(b.color, '#7c70ff');
  assert.deepEqual(model.events.map(event => event.name), ['enter', 'callout-0', 'callout-1']);
  const part = model.layout.parts[0];
  assert.equal(part.role, 'text');
  assert.equal(part.rect.y, a.box.y);
  // top: the slot moves to the top of the safe zone.
  assert.equal(resolve({callouts: ['On the beach'], position: 'top'}).content.callouts[0].box.y, safe.y);
  // A hit on callout-<i> times it.
  const hit = resolve({callouts: ['Low centre of gravity']}, {hits: [{at: 5, event: 'callout-0'}]});
  assert.equal(hit.content.callouts[0].at, 5);
});

test('clip: params validation names the param', () => {
  assert.throws(() => resolve({media: 'https://cdn.example.com/a.mp4'}), /params\.media must be a project-local assets\/ video/);
  assert.throws(() => resolve({media: 'assets/a.gif'}), /params\.media must be a project-local assets\/ video/);
  assert.throws(() => resolve({media: {src: 'assets/a.jpg', kind: 'video'}}), /params\.media\.kind is video but assets\/a\.jpg is a still/);
  assert.throws(() => resolve({media: {src: 'assets/a.jpg', sourceStart: 1}}), /params\.media\.sourceStart is for videos only/);
  assert.throws(() => resolve({media: {src: 'assets/a.mp4', sourceStart: 3, sourceEnd: 2}}), /params\.media\.sourceEnd must be after sourceStart/);
  assert.throws(() => resolve({media: {src: 'assets/a.mp4', sourceStart: 1, sourceEnd: 3}}), /params\.media\.sourceEnd leaves a 2 s source window \(1–3 s\) for a 4 s render window \(the scene plus any transition into the next scene, which keeps this shot drawn\); shorten the scene or widen the window/);
  assert.throws(() => resolve({move: 'spin'}), /params\.move must be one of none, push-in/);
  assert.throws(() => resolve({move: 'push-in', zoom: 0.3}), /params\.zoom must be between 0\.02 and 0\.15/);
  assert.throws(() => resolve({zoom: 0.05}), /params\.zoom needs a move/);
  assert.throws(() => resolve({focus: {x: 1.2, y: 0.5}}), /params\.focus\.x must be between 0 and 1/);
  assert.throws(() => resolve({enter: 'spin'}), /params\.enter must be one of cut, fade, settle/);
  assert.throws(() => resolve({callouts: ['a', 'b', 'c', 'd']}), /params\.callouts must be an array of 1–3/);
  assert.throws(() => resolve({callouts: [{text: 'x'.repeat(37)}]}), /params\.callouts\[0\]\.text must be a string of 1–36/);
  assert.throws(() => resolve({callouts: [{text: 'Three short words', at: 1, until: 1.5}]}), /params\.callouts\[0\]\.until leaves "Three short words" on screen 0\.5 s; it needs 1\.2 s to read/);
  assert.throws(() => resolve({callouts: [{text: 'First', at: 0.3, until: 2}, {text: 'Second', at: 2}]}), /params\.callouts\[1\]\.at must come at least 0\.15 s after the previous callout leaves/);
  assert.throws(() => resolve({callouts: [{text: 'Late', at: 3.5}]}), /params\.callouts\[0\]\.at must fall between/);
  assert.throws(() => resolve({rect: {x: 0, y: 0, width: 10, height: 10}}), /params\.rect is not supported|params\.rect/);
  // validateStory runs the same checks through the registry.
  const bad = story(scene({move: 'spin'}));
  const result = validateStory(bad, {modules: knownModules(), moduleParams: validateModuleParams});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(entry => /scenes\[0\]\.params\.move must be one of "none", "push-in"/.test(entry)), result.errors.join('\n'));
  // The param schema is compiled from the module's params summary.
  assert.deepEqual(validateModuleParams('clip', {media: {src: 'assets/footage/ute.mp4', sourceStart: 1, sourceEnd: 6}, focus: {x: 0.2, y: 0.5}, move: 'pan-left', zoom: 0.05, enter: 'settle', exit: 'fade', callouts: [{text: 'One', at: 0.4}], position: 'top'}), []);
});

test('clip: the source window is checked against the render window, which includes the next transition', () => {
  // s1's window covers its scene (0–4 s) but not the next scene's dot-wipe
  // overlap, which keeps s1 drawn past 4 s; the compile resolves s1 with that
  // render end, so validation must too (or the render draws a placeholder).
  const two = (inType) => resolveStory(story([
    {id: 's1', module: 'clip', start: 0, end: 4, params: {media: {src: 'assets/footage/ute.mp4', sourceStart: 1, sourceEnd: 5}}},
    {id: 's2', module: 'clip', start: 4, end: 8, in: {type: inType, dur: 0.5}, params: {media: 'assets/footage/ute.mp4'}}
  ]));
  for (const type of ['dot-wipe', 'whip']) {
    const resolved = two(type);
    assert.equal(sceneModels(resolved).get('s1'), null, `${type}: the compile resolves s1 over its render window`);
    const errors = moduleParamErrors(resolved);
    assert.equal(errors.length, 1, `${type}: ${errors.join('; ')}`);
    assert.match(errors[0], /s1.*params\.media\.sourceEnd leaves a 4 s source window \(1–5 s\) for a 4\.\d+ s render window/);
  }
  // A cut adds no overlap: the 4 s window fits.
  assert.deepEqual(moduleParamErrors(two('cut')), []);
  // Widening the window past the overlap passes and compiles.
  const wide = two('dot-wipe');
  wide.scenes[0].params.media.sourceEnd = 6;
  assert.deepEqual(moduleParamErrors(wide), []);
  assert.ok(sceneModels(wide).get('s1'));
});

test('clip: HyperFrames hoists a video with its callouts above it; a still stays in the layer; both match the evaluator', () => {
  const video = resolve({media: {src: 'assets/footage/ute.mp4', sourceStart: 1.5}, callouts: ['Payload 1,100 kg']}, {}, {motion: {grammar: 'snappy'}});
  const hoisted = EMITTERS.clip(video);
  assert.match(hoisted.html, /^<video id="s2-media" class="clip" data-start="4" data-duration="4" data-track-index="2" data-media-start="1\.5" data-module="clip"/);
  assert.match(hoisted.html, /object-fit:cover;object-position:50% 50%/);
  assert.match(hoisted.overlay, /^<div id="s2-overlay" class="clip"[^>]* data-track-index="3"/);
  assert.match(hoisted.overlay, /id="s2-callout-0"/);
  const times = [4, 4.1, 4.3, 4.45, 4.7, 5, 6.5, 7.7, 7.99, 8, 5.2, 4.2];
  assertMatchesFrameState(clipTimeline(video), hoisted.motion, times, 'clip video');
  const still = resolve({media: 'assets/photos/camp.jpg', callouts: ['Sets up in two minutes']});
  const out = EMITTERS.clip(still);
  assert.equal(out.overlay, undefined);
  assert.match(out.html, /^<div id="s2-frame" class="clip" data-start="4" data-duration="4" data-track-index="2" data-module="clip"/);
  assert.ok(out.html.indexOf('s2-media') < out.html.indexOf('s2-overlay'), 'the callouts are drawn above the footage');
  for (const op of clipTimeline(still)) assert.ok(out.html.includes(`id="${op.target}"`), op.target);
  assertMatchesFrameState(clipTimeline(still), out.motion, times, 'clip still');
});

test('clip: layout-check lets graphics sit over the footage and checks the callouts as text', () => {
  const model = resolve({callouts: ['Payload 1,100 kg']});
  const extras = layoutExtras(model.layout, {id: 's2', start: 4, end: 8, canvas: {width: 1080, height: 1920}});
  assert.deepEqual(extras.allowOcclusion, ['*']);
  assert.equal(extras.parts.length, 1);
  assert.equal(extras.parts[0].id, 's2-callouts');
  assert.equal(extras.parts[0].role, 'text');
  // A lower-third over the clip on track 1 is no collision; the callouts still are checked against it.
  const footage = {id: 's2', role: 'media', rect: model.layout.rect, start: 4, end: 8, allowOcclusion: extras.allowOcclusion};
  const card = {id: 's3', role: 'text', rect: {x: 120, y: 400, width: 600, height: 200}, start: 4, end: 8};
  const report = checkLayout({canvas: {width: 1080, height: 1920}, elements: [footage, card, ...extras.parts], profile: 'shorts', duration: 12});
  assert.ok(!report.findings.some(f => f.rule === 'collision'), JSON.stringify(report.findings));
  // The planner's check sees the same: a clip-led storyboard passes the layout check.
  const checked = checkStoryboard(story([
    {id: 's1', module: 'clip', start: 0, end: 4, params: {media: 'assets/photos/camp.jpg', callouts: [{text: 'Built for corrugations'}]}},
    {id: 's2', module: 'clip', start: 4, end: 8, params: {media: {src: 'assets/footage/ute.mp4', sourceStart: 3}}},
    {id: 's3', module: 'clip', start: 8, end: 12, in: {type: 'fade', dur: 0.4}, params: {media: {src: 'assets/footage/ute.mp4', sourceStart: 12}, focus: {x: 0.7, y: 0.5}}}
  ]));
  assert.equal(checked.ok, true, checked.errors.join('\n'));
  assert.ok(!checked.warnings.some(entry => /layout: (collision|safe-zone|caption-band)/.test(entry)), checked.warnings.join('\n'));
});

test('clip: the footage moves on its own, so ambient drift leaves it alone and the hold gate counts it as live', () => {
  const s = scene({});
  const st = story(s);
  const model = resolveModule(s, st);
  assert.equal(sceneDrift(st, s, model, {window: {start: 4, end: 8}, geometry: profileGeometry({width: 1080, height: 1920})}), null);
  const live = resolveStory(story([{id: 's1', module: 'clip', start: 0, end: 12, params: {media: 'assets/footage/ute.mp4'}}]));
  assert.equal(holdGate(live).status, 'passed', JSON.stringify(holdGate(live).findings));
  // A still that holds is a static hold.
  const still = resolveStory(story([{id: 's1', module: 'clip', start: 0, end: 12, params: {media: 'assets/photos/camp.jpg', move: 'none'}}]));
  assert.equal(holdGate(still).status, 'failed');
});

test('clip is registered in both renderers, the planner and the skill references', () => {
  assert.equal(typeof MODULES.clip.resolve, 'function');
  assert.ok(knownModules().includes('clip'));
  assert.match(readFileSync(path.join(ROOT, 'kit/remotion/catalog/registry-d.ts'), 'utf8'), /clip: Clip/);
  for (const skill of ['launchclip-create-video', 'launchclip-create-video-remotion']) {
    assert.match(readFileSync(path.join(ROOT, `skills/${skill}/references/storyboard-modules.md`), 'utf8'), /### clip \(keeps captions\)/);
  }
});

test('clip: callout pills read on a phone and hug their text', () => {
  const model = resolve({callouts: ['Hardwood: natural timber']});
  const [callout] = model.content.callouts;
  // A long label in a 9:16 frame wraps to two lines rather than shrinking to small print.
  assert.ok(callout.size >= 68, `callout size ${callout.size}`);
  assert.equal(callout.lines, 2);
  assert.ok(callout.box.height > callout.size * 2, `pill height ${callout.box.height}`);
  const short = resolve({callouts: ['Payload 1,100 kg']}).content.callouts[0];
  assert.equal(short.lines, 1);
  assert.ok(short.size > 64, `short callout size ${short.size}`);
  const {overlay} = clipView(model);
  const pill = JSON.stringify(overlay);
  assert.match(pill, /"width":"fit-content"/);
  assert.match(pill, new RegExp(`"maxWidth":${callout.box.width}`));
});
