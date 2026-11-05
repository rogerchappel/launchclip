// Media layouts (kit/core/catalog-d-media-layouts.mjs): library footage
// inside the motion design (split-screen, landscape-card, picture-in-picture,
// media-compare, media-stat, media-list, media-grid), at 9:16, 16:9 and 1:1,
// footage from the first visible frame, text clear of the captions and the
// logo, seen by layout-check, both renderers, the shot provider and the
// planner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {MEDIA_LAYOUTS, MODULES, countUp, mediaLayoutTimeline, mediaLayoutView} from '@launchclip/core/catalog-d.mjs';
import {knownModules, resolveModule} from '@launchclip/core/modules.mjs';
import {checkLayout, layoutExtras} from '@launchclip/core/layout-check.mjs';
import {validateModuleParams} from '@launchclip/core/module-schemas.mjs';
import {planningPrompt, suggestModules} from '@launchclip/core/planning-prompt.mjs';
import {resolveStory} from '@launchclip/core/story.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-d.mjs';
import {checkStoryboard} from '../src/storyboard_planner.js';
import {holdGate} from '../src/movement_guardrails.js';
import {resolveShots, shotPrompt, shotRequests} from '../src/asset_provider.js';
import {assertMatchesFrameState} from './helpers/frame_state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const brand = {colors: {bg: '#0b1116', primary: '#5fc4c4', accent: '#e8b04a', ink: '#0b1116', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}, '1:1': {width: 1080, height: 1080, fps: 30}};
const story = (scenes, format = FORMATS['9:16'], extra = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {...format, duration: Math.max(...scenes.map(s => s.end))}, brand, scenes, ...extra});
const VIDEO = 'assets/shots/ridge.mp4', STILL = 'assets/shots/boards.jpg';

// One scene per layout and variant, as the sample storyboard renders them.
const SCENES = [
  {module: 'split-screen', params: {media: VIDEO, kicker: 'Corrugations', title: 'Why slide-ons ride smoother', body: 'Weight sits low, over the axle'}},
  {module: 'split-screen', params: {media: STILL, variant: 'bottom', divider: 'blend', title: 'Three jobs a year', items: [{text: 'Wash the deck', at: 0.6}, {text: 'Oil the boards', at: 1.4}, {text: 'Seal the ends', at: 2.2}]}},
  {module: 'landscape-card', params: {media: VIDEO, kicker: 'On the beach', title: 'Drop your tyre pressures first', caption: 'Around 18 psi on soft sand', chip: 'Beach driving'}},
  {module: 'picture-in-picture', params: {media: VIDEO, kicker: 'Payload', title: 'What a ute can carry', stat: {value: '1,100 kg', label: 'after the camper is on'}}},
  {module: 'picture-in-picture', params: {media: STILL, variant: 'bottom-left', title: 'Before you leave', items: ['Water', 'Fuel', 'Recovery gear']}},
  {module: 'media-compare', params: {title: 'Hardwood or composite?', left: {media: STILL, label: 'Hardwood'}, right: {media: VIDEO, label: 'Composite'}, pick: 'right'}},
  {module: 'media-stat', params: {media: STILL, kicker: 'Tray weight', value: '1,200 kg', label: 'rated payload', source: 'Spec sheet'}},
  {module: 'media-stat', params: {media: VIDEO, variant: 'behind', value: '30+', label: 'years building campers'}},
  {module: 'media-list', params: {title: 'Before you buy', items: [{text: 'Check your payload', media: STILL}, {text: 'Measure the tray', media: STILL, at: 0.9}, {text: 'Ask about the warranty', at: 1.8}]}},
  {module: 'media-grid', params: {title: 'Three deck options', items: [{media: STILL, label: 'Hardwood'}, {media: VIDEO, label: 'Composite', at: 0.9}, {media: STILL, label: 'Aluminium', at: 1.8}]}},
  {module: 'media-grid', params: {items: [{media: STILL, label: 'Wash'}, {media: STILL, label: 'Sand', at: 0.7}, {media: STILL, label: 'Oil', at: 1.4}, {media: VIDEO, label: 'Seal', at: 2.1}]}}
].map((scene, i) => ({id: `m${i}`, start: 0, end: 4, ...scene}));

const resolve = (scene, format = FORMATS['9:16'], extra = {}) => resolveModule(scene, story([scene], format, extra));
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

test('media layouts: registered in catalogue D, both renderers, the schemas and the skill references', () => {
  const registry = readFileSync(path.join(ROOT, 'kit/remotion/catalog/registry-d.ts'), 'utf8');
  assert.match(registry, /MEDIA_LAYOUT_COMPONENTS/);
  for (const {id} of MEDIA_LAYOUTS) {
    assert.equal(typeof MODULES[id].resolve, 'function', id);
    assert.ok(knownModules().includes(id), id);
    assert.equal(typeof EMITTERS[id], 'function', id);
    assert.match(readFileSync(path.join(ROOT, 'kit/remotion/catalog/MediaLayout.tsx'), 'utf8'), new RegExp(`'${id}'`));
    for (const skill of ['launchclip-create-video', 'launchclip-create-video-remotion']) {
      assert.match(readFileSync(path.join(ROOT, `skills/${skill}/references/storyboard-modules.md`), 'utf8'), new RegExp(`### ${id} \\(keeps captions\\)`), `${skill}: ${id}`);
    }
  }
  for (const scene of SCENES) assert.deepEqual(validateModuleParams(scene.module, scene.params), [], scene.id);
});

for (const [aspect, format] of Object.entries(FORMATS)) {
  test(`media layouts at ${aspect}: footage from the first frame, text inside the module safe area`, () => {
    for (const scene of SCENES) {
      const model = resolve(scene, format);
      const label = `${aspect} ${scene.id} ${scene.module}`;
      const {windows, texts} = model.content;
      assert.ok(windows.length >= 1, label);
      // The first window opens the scene, and no text shows before it.
      assert.equal(windows[0].at, model.start, label);
      for (const t of texts) assert.ok(t.at >= windows[0].at, `${label}: ${t.key} before the footage`);
      // At its reveal a window is the footage itself: its media node is drawn the moment it shows.
      const view = mediaLayoutView(model);
      const ops = mediaLayoutTimeline(model);
      windows.forEach((win, i) => {
        const node = view.windows[i];
        const media = win.media.kind === 'video' ? node : node.children[0];
        assert.equal(media.tag, win.media.kind === 'video' ? 'video' : 'img', label);
        assert.equal(media.attrs.src, win.media.src, label);
        const shown = frameState(ops, win.at + 0.1).get(`${model.id}-win-${i}`);
        assert.ok(shown.opacity > 0, `${label}: window ${i} visible 0.1 s after its reveal`);
      });
      // Text sits in the module safe area (above the caption band, inside the frame's safe rect).
      for (const t of texts) assert.ok(inside(t.box, model.safe), `${label}: ${t.key} ${JSON.stringify(t.box)} leaves ${JSON.stringify(model.safe)}`);
      // Floating windows stay in the safe area too; full-bleed footage may run to the frame's edges.
      for (const win of windows) {
        const bleeds = win.rect.x <= 0 || win.rect.y <= 0 || win.rect.x + win.rect.width >= model.canvas.width || win.rect.y + win.rect.height >= model.canvas.height;
        if (!bleeds) assert.ok(inside(win.rect, model.safe), `${label}: window ${JSON.stringify(win.rect)}`);
        assert.ok(inside(win.rect, {x: 0, y: 0, ...model.canvas}), label);
      }
      assert.equal(model.hidesCaptions, false, label);
      assert.equal(model.layout.live, true, label);
      assert.equal(model.layout.drift, false, label);
    }
  });
}

test('media layouts: text keeps out of the brand frame\'s logo-safe rect', () => {
  const frame = {safe: {x: 80, y: 420, width: 860, height: 1030}};
  // ctx.frame.safe (kit/core/brand-frame.mjs) narrows the module safe area.
  const split = resolveModule(SCENES[1], story([SCENES[1]]));
  const narrowed = MODULES['split-screen'].resolve(SCENES[1].params, {id: 'm1', format: FORMATS['9:16'], start: 0, duration: 4, brand, frame});
  assert.ok(narrowed.safe.y >= frame.safe.y, 'the safe area starts under the logo');
  for (const t of narrowed.content.texts) assert.ok(t.box.y >= frame.safe.y - 0.5, `${t.key} under the logo row`);
  assert.ok(split.safe.y < narrowed.safe.y);
});

test('media layouts: entrances follow the motion grammar, and an opening scene rests its opacity', () => {
  const scene = SCENES[2];
  const at = (grammar) => {
    const model = resolveModule({...scene, start: 1, end: 5}, story([{...scene, start: 1, end: 5}], FORMATS['9:16'], {motion: {grammar}}));
    return frameState(mediaLayoutTimeline(model), model.start).get(`${model.id}-win-0`);
  };
  assert.ok(at('playful').scaleX < at('editorial').scaleX, 'playful pops from smaller');
  assert.ok(at('cinematic').scaleX > 1, 'cinematic settles down from larger');
  assert.equal(at('documentary').scaleX, 1, 'documentary is a plain fade');
  // The opening plate is drawn on frame 0: the footage is fully visible.
  const opening = resolveModule(scene, story([scene]));
  assert.equal(frameState(mediaLayoutTimeline(opening), 0).get(`${opening.id}-win-0`).opacity, 1);
});

test('media layouts: layout-check allows a label on its own tile and still checks everything else', () => {
  const grid = resolve(SCENES[9]);
  const extras = layoutExtras(grid.layout, {id: 'm9', start: 0, end: 4, canvas: grid.canvas});
  const label = extras.parts.find(part => part.id === 'm9-label-1');
  assert.deepEqual(label.allowOcclusion, ['m9-win-1']);
  const main = {id: 'm9', role: 'media', rect: grid.layout.rect, start: 0, end: 4};
  const report = checkLayout({canvas: grid.canvas, elements: [main, ...extras.parts], profile: 'shorts', duration: 4});
  assert.deepEqual(report.findings.filter(f => f.severity === 'error'), []);
  // A card from another scene over a tile is still a collision.
  const intruder = {id: 'x', role: 'text', rect: grid.content.windows[1].rect, start: 0, end: 4};
  const clash = checkLayout({canvas: grid.canvas, elements: [main, ...extras.parts, intruder], profile: 'shorts', duration: 4});
  assert.ok(clash.findings.some(f => f.rule === 'collision' && f.ids.includes('x')));
});

test('media layouts: a storyboard of every layout passes the planner\'s checks with captions on', () => {
  const words = [];
  const scenes = SCENES.map((scene, i) => ({...scene, start: i * 4, end: (i + 1) * 4}));
  for (let t = 0.2; t < scenes.length * 4 - 0.5; t += 0.45) words.push({text: 'word', start: Number(t.toFixed(2)), end: Number((t + 0.3).toFixed(2))});
  for (const [aspect, format] of Object.entries(FORMATS)) {
    const checked = checkStoryboard(story(scenes, format, {audio: {voice: 'assets/audio/narration.wav', words: 'NARRATION.json'}, overlays: [{type: 'captions', style: 'word-highlight'}]}), {words});
    assert.equal(checked.ok, true, `${aspect}: ${checked.errors.join('\n')}`);
    assert.ok(!checked.warnings.some(entry => /layout: (collision|safe-zone|caption-band|min-text-size)/.test(entry)), `${aspect}: ${checked.warnings.join('\n')}`);
  }
  const resolved = resolveStory(story(scenes));
  assert.equal(holdGate(resolved).status, 'passed', JSON.stringify(holdGate(resolved).findings));
});

test('media layouts: text that cannot fit fails with the room it needs', () => {
  const long = {...SCENES[0], params: {...SCENES[0].params, body: undefined, items: ['A very long first list item here', 'A very long second list item now', 'A very long third list item too', 'And a fourth that will not fit']}};
  delete long.params.body;
  assert.throws(() => resolve(long), /needs \d+ px of text height but the layout leaves \d+ px|too long/);
  assert.throws(() => resolve({...SCENES[0], params: {media: VIDEO}}), /needs a title, body, stat or items/);
  assert.throws(() => resolve({...SCENES[9], params: {items: [{media: STILL, at: 1}, {media: STILL}]}}), /first tile opens the scene/);
});

test('media layouts: a figure counts up to its exact text', () => {
  assert.deepEqual(countUp('1,200 kg'), {prefix: '', value: 1200, decimals: 0, grouped: true, suffix: ' kg'});
  assert.deepEqual(countUp('$4.5M'), {prefix: '$', value: 4.5, decimals: 1, grouped: false, suffix: 'M'});
  assert.equal(countUp('Lots'), null);
  const model = resolve(SCENES[6]);
  const ops = mediaLayoutTimeline(model);
  const value = model.content.texts.find(t => t.key === 'stat');
  assert.equal(frameState(ops, value.at + 0.05).get(`${model.id}-stat`).text.endsWith(' kg'), true);
  assert.equal(frameState(ops, model.end - 0.5).get(`${model.id}-stat`).text, '1,200 kg');
});

test('media layouts: HyperFrames hoists each video window; stills stay in the scene layer; GSAP matches frameState', () => {
  const grid = resolve(SCENES[9]);
  const out = EMITTERS['media-grid'](grid);
  const videos = out.html.match(/<video\b[^>]*>/g) ?? [];
  assert.equal(videos.length, 1);
  assert.match(videos[0], /class="clip"/);
  assert.match(videos[0], /data-media-start="0"/);
  // Timed as the scene's own layer, so the compiler gives it a track of its own and seeks it with the scene.
  assert.ok(videos[0].includes(`data-start="${grid.start}" data-duration="${grid.duration}"`), videos[0]);
  assert.ok(out.overlay.includes('m9-label-0'), 'the labels are in the hoisted overlay, above the video');
  const stills = EMITTERS['media-stat'](resolve(SCENES[6]));
  assert.equal(stills.overlay, undefined);
  assert.match(stills.html, /<img\b[^>]*src="assets\/shots\/boards.jpg"/);
  for (const scene of SCENES) {
    const model = resolve(scene);
    const emitted = EMITTERS[scene.module](model);
    const times = [0, 0.05, 0.2, 0.5, 1, 1.5, 2.2, 3, 3.8, 3.99];
    assertMatchesFrameState(mediaLayoutTimeline(model), emitted.motion, times, scene.id);
  }
});

test('media layouts: a scene may ask the library for a shot in each footage slot', async () => {
  const shot = (shows, type = 'any') => ({kind: 'shot', shows, type});
  const board = story([
    {id: 'cmp', module: 'media-compare', start: 0, end: 4, params: {left: {media: shot('hardwood decking'), label: 'Hardwood'}, right: {media: shot('composite decking'), label: 'Composite'}}},
    {id: 'list', module: 'media-list', start: 4, end: 8, params: {items: [{text: 'Check the payload', media: shot('a loaded ute tray')}, {text: 'Measure the tray', media: shot('a tape on a ute tray')}, {text: 'Ask about the warranty'}]}},
    {id: 'land', module: 'landscape-card', start: 8, end: 12, params: {media: shot('a ute camper side-on on a beach', 'video'), title: 'On the beach'}}
  ]);
  const requests = shotRequests(board);
  assert.deepEqual(requests.map(r => [r.scene.id, r.slot, r.still]), [
    ['cmp', 'left.media', false], ['cmp', 'right.media', false], ['list', 'items.0.media', true], ['list', 'items.1.media', true], ['land', 'media', false]
  ]);
  const asked = [];
  const assets = {async findShot(request) {
    asked.push(request);
    if (request.shows === 'a tape on a ute tray') return null;
    return request.still ? {url: `https://media.example/${asked.length}.jpg`, kind: 'image'} : {url: `https://media.example/${asked.length}.mp4`, kind: 'video', sourceStart: 1.5, crop_hint: {x: 0.3, y: 0.6}};
  }};
  const found = await resolveShots(board, {assets, format: FORMATS['9:16']});
  assert.deepEqual(found.errors, []);
  const [cmp, list] = found.storyboard.scenes;
  // Both options keep their own shot; each is placed with its start and crop.
  assert.match(cmp.params.left.media.src, /^assets\/shots\/cmp-[0-9a-f]{10}\.mp4$/);
  assert.match(cmp.params.right.media.src, /^assets\/shots\/cmp-[0-9a-f]{10}\.mp4$/);
  assert.notEqual(cmp.params.left.media.src, cmp.params.right.media.src);
  assert.deepEqual({...cmp.params.left.media, src: 'x'}, {kind: 'video', src: 'x', sourceStart: 1.5, focus: {x: 0.3, y: 0.6}});
  assert.equal(cmp.params.left.label, 'Hardwood');
  // A thumbnail is a still; a missed one leaves the row with its number, and the list stays a list.
  assert.ok(Array.isArray(list.params.items));
  assert.match(list.params.items[0].media, /^assets\/shots\/list-[0-9a-f]{10}\.jpg$/);
  assert.equal(list.params.items[1].media, undefined);
  assert.equal(list.params.items[1].text, 'Measure the tray');
  assert.ok(found.warnings.some(w => /scene list: .*keeps its placeholder/.test(w)), found.warnings.join('\n'));
  // A landscape card asks for landscape footage.
  assert.equal(asked.find(r => r.scene_id === 'land').orientation, 'landscape');
  assert.equal(shotRequests(found.storyboard).length, 0);
  // Placed, every scene resolves.
  for (const scene of found.storyboard.scenes) assert.ok(resolveModule(scene, {...found.storyboard, scenes: [scene]}));
});

test('media layouts: the planner offers them for footage lines, with "use when" rows', () => {
  const prompt = shotPrompt({min: 3, max: 8});
  for (const {id} of MEDIA_LAYOUTS) assert.match(prompt, new RegExp(`\\b${id}\\b`), id);
  assert.match(prompt, /media-compare params\.left\.media and params\.right\.media/);
  const hints = suggestModules('Hardwood or composite? There are three options for the deck. A 79 Series carries 1,200 kg.', {lane: 'motion'});
  assert.ok(hints[0].modules.includes('media-compare'), JSON.stringify(hints));
  assert.ok(hints[1].modules.includes('media-grid'), JSON.stringify(hints));
  assert.ok(hints[2].modules.includes('media-stat'), JSON.stringify(hints));
  const full = planningPrompt({lane: 'motion'});
  for (const {id} of MEDIA_LAYOUTS) assert.match(full, new RegExp(`### ${id}`), id);
});
