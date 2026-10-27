// Catalogue I social cards (kit/core/catalog-i-social.mjs): the post card's
// validation, platforms and looks, the highlight sweep and focus, the source
// line, and both renderers' output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline, catalogHView} from '../kit/core/catalog-h.mjs';
import {PLATFORMS, countText, sourceLine} from '../kit/core/catalog-i-social.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {hyperframesEmitters} from '../kit/hyperframes/story-compiler.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {DEMO_POSTS, SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '16:9', overrides = {}) => ({id: 'scene', start: 1, duration: 8, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
export const IDS = ['social-post', 'social-stack', 'social-sort', 'social-wall'];

/** Every op target is a node id, and every node id is in the HyperFrames HTML. */
export function assertSameIds(model, label) {
  const out = EMITTERS[model.module](model);
  assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, label);
  const ids = [];
  const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.push(node.id); (node.children ?? []).forEach(walk); } };
  walk(catalogHView(model));
  for (const target of new Set(catalogHTimeline(model).map(op => op.target))) assert.ok(ids.includes(target), `${label}: op target ${target} is in the view`);
  for (const nodeId of ids) assert.ok(out.html.includes(`id="${nodeId}"`), `${label}: ${nodeId} in the HyperFrames HTML`);
}

/** Every text string in a view tree, joined. */
const texts = node => (typeof node === 'string' ? node : (node.children ?? []).map(texts).join(' '));

test('the social modules are registered in the registry, both renderers and the samples', () => {
  for (const id of IDS) {
    assert.ok(knownModules().includes(id), id);
    assert.ok(EMITTERS[id] && hyperframesEmitters()[id], id);
    assert.ok(SAMPLES[id], id);
  }
  assert.deepEqual([...VARIANTS['social-post']], ['glass', 'native', 'light']);
});

test('social-post: every look and platform resolves in both aspects and brands, with the same ids in both renderers', () => {
  for (const variant of VARIANTS['social-post']) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) for (const key of Object.keys(DEMO_POSTS)) {
    const label = `${variant} ${aspect} ${b.colors.bg} ${key}`;
    const model = resolve('social-post', {...DEMO_POSTS[key], variant}, aspect, {brand: b});
    assert.ok(model.minTextPx >= 44 - 1e-6, `${label} body ${model.minTextPx}`);
    assert.ok(model.hidesCaptions, label);
    assertSameIds(model, label);
  }
  assert.deepEqual(new Set(Object.values(DEMO_POSTS).map(p => p.platform)), new Set(PLATFORMS.filter(p => p !== 'generic')));
});

test('social-post: the card shows the post, the tick, the counts and a source line', () => {
  const model = resolve('social-post');
  const all = texts(catalogHView(model));
  for (const part of ['Dana Demo', '@demo_dana', '6:06 AM', 'Oct 25, 2026', '1M', 'Views', '5.5K', '169', 'example.com/changelog', '@demo_kai']) assert.ok(all.includes(part), part);
  assert.match(all, /@demo_dana · Demo account · not a real post/);
  assert.deepEqual(['999', '1K', '5.5K', '79.2K', '237K', '1M', '1.2B', '12K'], [999, 1000, 5512, 79200, 237300, 1000000, 1.2e9, '12K'].map(countText));
  const real = {platform: 'x', name: 'Ada', handle: 'ada', text: 'Hello', date: 'Oct 25, 2026', source: {url: 'https://x.com/ada/status/1', captured_at: '2026-10-26T10:00:00Z', schema: 'launchclip.capture.v1'}};
  assert.equal(sourceLine(resolve('social-post', real).content.post), 'X · @ada · Oct 25, 2026 · x.com');
  assert.equal(sourceLine(resolve('social-post', {...real, date: undefined}).content.post), 'X · @ada · 2026-10-26 · x.com');
});

test('social-post: validation keeps posts real and demo posts obviously fictional', () => {
  const r = params => resolve('social-post', params);
  const base = {name: 'Ada', handle: 'ada', text: 'Hello world'};
  assert.throws(() => r({...base, demo: true}), /demo post must say so/);
  assert.throws(() => r({...DEMO_POSTS.dana, source: {url: 'https://x.com/demo_dana/status/1'}}), /cannot be set on a demo post/);
  assert.throws(() => r({...base, source: {url: 'x.com/ada'}}), /source\.url must be the http\(s\) address/);
  assert.throws(() => r({...base, source: {url: 'https://x.com/ada/status/1', schema: 'other'}}), /launchclip\.capture\.v1/);
  assert.throws(() => r({...base, source: {screenshot: 'https://example.com/a.png'}}), /screenshot must be a project-local assets/);
  assert.throws(() => r({...base, platform: 'myspace'}), /platform must be one of/);
  assert.throws(() => r({name: 'Ada', text: 'Hi'}), /handle is required for X posts/);
  assert.throws(() => r({...base, platform: 'reddit'}), /community is required/);
  assert.throws(() => r({...base, title: 'A title'}), /title is for Reddit/);
  assert.throws(() => r({...base, highlight: 'not here'}), /params\.highlight must be a phrase of the post's text/);
  assert.throws(() => r({...base, text: 'word '.repeat(119)}), /params\.text does not fit/);
  assert.doesNotThrow(() => r({...base, text: 'Line one\nLine two'}));
  assert.throws(() => r({...base, text: 'Tab\there'}), /control characters/);
});

test('social-post: the highlight sweeps its phrase left to right on its hit, then the card steps into focus', () => {
  const model = resolve('social-post', SAMPLES['social-post'], '16:9', {hits: [{event: 'highlight', at: 3.2}]});
  const hl = model.events.find(e => e.name === 'highlight');
  assert.equal(hl.time, 3.2);
  const focus = model.events.find(e => e.name === 'focus');
  assert.ok(focus.time > hl.endTime, 'focus after the sweep');
  const [phrase] = model.content.phrases;
  assert.equal(phrase.bars.length, 5, 'previews in under a minute');
  for (let i = 1; i < phrase.bars.length; i++) assert.ok(phrase.bars[i].start > phrase.bars[i - 1].start, 'reading order');
  const ops = catalogHTimeline(model);
  const bar = `scene-card-hl-${phrase.bars[0].k}`;
  assert.equal(frameState(ops, 3.1).get(bar).scaleX, 0);
  assert.equal(frameState(ops, hl.endTime + 0.01).get(bar).scaleX, 1);
  const settled = frameState(ops, model.motion.exitStart - 0.01);
  assert.equal(settled.get('scene-card').blur, 0);
  assert.equal(settled.get('scene-card-glow').opacity, 1);
  assert.ok(Math.abs(settled.get('scene-card').scaleX - 1.035) < 1e-6);
  // Two phrases: their own events, the second after the first.
  const two = resolve('social-post', {...DEMO_POSTS.dana, highlight: [{text: 'render queue'}, {text: 'what breaks', at: 4}]});
  assert.deepEqual(two.events.filter(e => e.name.startsWith('highlight')).map(e => [e.name, e.time]), [['highlight', two.events.find(e => e.name === 'highlight').time], ['highlight-2', 5]]);
});

const MULTI = ['social-stack', 'social-sort', 'social-wall'];

test('stack, sort and wall resolve in every variant, aspect and brand, with no NaN and the same ids in both renderers', () => {
  for (const id of MULTI) for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) for (const look of ['glass', 'native', 'light']) {
    const label = `${id}/${variant} ${aspect} ${b.colors.bg} ${look}`;
    const model = resolve(id, {...SAMPLES[id], variant, look}, aspect, {brand: b});
    assert.ok(model.minTextPx >= 44 - 1e-6, `${label} key text ${model.minTextPx}`);
    const settled = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
    for (const [target, props] of settled) for (const [key, value] of Object.entries(props)) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${label}: ${target}.${key}`);
    assertSameIds(model, label);
  }
  assert.deepEqual([...VARIANTS['social-stack']], ['cascade', 'list']);
});

test('social-stack: the focused post lands last, in front and sharp; the others sit back, blurred and dimmed', () => {
  const model = resolve('social-stack', {...SAMPLES['social-stack'], focus: 1, highlight: 'middle of the lineup'});
  const c = model.content;
  assert.deepEqual(c.order, [0, 2, 1]);
  const s = frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
  assert.equal(s.get('scene-p1').blur, 0);
  assert.equal(s.get('scene-p1').opacity, 1);
  assert.ok(s.get('scene-p0').blur > s.get('scene-p2').blur && s.get('scene-p2').blur > 0, 'deeper is blurrier');
  assert.ok(s.get('scene-p0').scaleX < s.get('scene-p2').scaleX && s.get('scene-p2').scaleX < 1, 'deeper is smaller');
  assert.equal(s.get('scene-p1-glow').opacity, 1);
  // The focused card paints last, so it is on top.
  const view = catalogHView(model);
  const cards = view.children.filter(n => /^scene-p\d$/.test(n.id)).map(n => n.id);
  assert.equal(cards.at(-1), 'scene-p1');
  assert.match(texts(view), /@demo_rho · Demo account · not a real post · also @demo_kai, @demo_lumen/);
  assert.throws(() => resolve('social-stack', {posts: [SAMPLES['social-stack'].posts[0]]}), /params\.posts must be an array of 2–5/);
  assert.throws(() => resolve('social-stack', {...SAMPLES['social-stack'], focus: 3}), /params\.focus/);
});

test('social-sort: cards pile in the middle, then fly to their columns and settle square', () => {
  const model = resolve('social-sort');
  const c = model.content;
  const ops = catalogHTimeline(model);
  const sortAt = model.events.find(e => e.name === 'sort').time;
  const before = frameState(ops, sortAt - 0.01), after = frameState(ops, model.motion.exitStart - 0.01);
  for (let i = 0; i < c.posts.length; i++) {
    assert.ok(Math.abs(before.get(`scene-p${i}`).rotation) > 0, 'turned in the pile');
    assert.deepEqual([after.get(`scene-p${i}`).x, after.get(`scene-p${i}`).y, after.get(`scene-p${i}`).rotation], [0, 0, 0]);
  }
  // Landscape: posts 0 and 2 share the left column, 1 is on the right.
  assert.equal(c.place[0].x, c.place[2].x);
  assert.ok(c.place[1].x > c.place[0].x);
  assert.ok(c.place[2].y > c.place[0].y);
  const portrait = resolve('social-sort', SAMPLES['social-sort'], '9:16').content;
  assert.ok(portrait.heads[1].y > portrait.place[2].y, 'portrait bands stack top to bottom');
  assert.equal(after.get('scene-head-0').opacity, 1);
  assert.throws(() => resolve('social-sort', {...SAMPLES['social-sort'], posts: SAMPLES['social-sort'].posts.map(p => ({...p, column: 2}))}), /column must be an integer between 0 and 1/);
  assert.throws(() => resolve('social-sort', {...SAMPLES['social-sort'], columns: ['Only one']}), /params\.columns must be an array of 2–3/);
});

test('social-wall: a drifting depth field, then the pulled posts come forward sharp while the field dims', () => {
  const model = resolve('social-wall');
  const c = model.content;
  const field = c.tiles.filter(t => !t.front), pulled = c.tiles.filter(t => t.front);
  assert.equal(field.length, 18);
  assert.equal(pulled.length, 2);
  for (const t of field) assert.ok(t.blur > 0 && t.scale < 0.55, 'the field is small and soft');
  for (let k = 1; k < field.length; k++) assert.ok(field[k].z <= field[k - 1].z, 'painted far to near');
  const ops = catalogHTimeline(model);
  const pull = model.events.find(e => e.name === 'pull');
  const early = frameState(ops, 1), late = frameState(ops, 2), done = frameState(ops, model.motion.exitStart - 0.01);
  assert.notEqual(early.get('scene-t0').x, late.get('scene-t0').x, 'the field drifts');
  const k = c.tiles.indexOf(pulled[0]);
  assert.equal(done.get(`scene-t${k}`).blur, 0);
  assert.equal(done.get(`scene-t${k}`).scaleX, c.frontScale);
  assert.ok(done.get('scene-t0').opacity < frameState(ops, pull.time - 0.01).get('scene-t0').opacity, 'the field dims');
  assert.ok(model.events.find(e => e.name === 'highlight').time > pull.endTime - 0.2);
  assert.throws(() => resolve('social-wall', {...SAMPLES['social-wall'], focus: [0, 0]}), /two different posts/);
  assert.throws(() => resolve('social-wall', {...SAMPLES['social-wall'], drift: 'sideways'}), /params\.drift/);
});

test('validateStory warns when a social post has no source.url, but not for demo posts', async () => {
  const {validateStory} = await import('../kit/core/story.mjs');
  const story = scenes => ({schema: 'launchclip.story.v1', title: 'Social', lane: 'motion', format: {width: 1920, height: 1080, fps: 30, duration: 6, platform: 'youtube'}, brand, base: null, scenes});
  const real = {platform: 'x', name: 'Ada', handle: 'ada', text: 'Hello'};
  const warnings = validateStory(story([
    {id: 's1', module: 'social-post', start: 0, end: 3, params: real},
    {id: 's2', module: 'social-stack', start: 3, end: 6, params: {posts: [{...real, source: {url: 'https://x.com/ada/status/1'}}, real, DEMO_POSTS.kai]}}
  ])).warnings.join('\n');
  assert.match(warnings, /scene s1 \(social-post\) shows a post with no params\.source\.url/);
  assert.match(warnings, /scene s2 \(social-stack\) shows a post with no params\.posts\[1\]\.source\.url/);
  assert.doesNotMatch(warnings, /posts\[0\]|posts\[2\]/);
});

test('a whole launchclip.capture.v1 record can be the source; its other fields are ignored', () => {
  const capture = {schema: 'launchclip.capture.v1', url: 'https://x.com/ada/status/1', captured_at: '2026-10-26T10:00:00Z', screenshot: 'assets/captures/ada.png', claim: 'c1', claims: ['c1']};
  const model = resolve('social-post', {name: 'Ada', handle: 'ada', text: 'Hello', source: capture});
  assert.equal(model.content.post.source.screenshot, 'assets/captures/ada.png');
  assert.throws(() => resolve('social-post', {name: 'Ada', handle: 'ada', text: 'Hello', source: 'https://x.com'}), /source must be an object/);
});
