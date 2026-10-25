// Catalogue H boxes and frames (catalog-h-frames.mjs, catalog-h-paper.mjs,
// catalog-h-callouts.mjs): registration, variants, and each element's
// landing state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, VARIANTS, catalogHTimeline} from '../kit/core/catalog-h.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {knownModules} from '../kit/core/modules.mjs';
import {seeded, tornPolygon} from '../kit/core/catalog-h-paper.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const ctx = (aspect = '9:16', overrides = {}) => ({id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides});
const resolve = (id, params = SAMPLES[id], aspect, overrides) => ({...MODULES[id].resolve(params, ctx(aspect, overrides)), module: id});
const settled = model => frameState(catalogHTimeline(model), model.motion.exitStart - 0.01);
const FRAMES = ['device-frame', 'window-chrome', 'polaroid', 'sticker', 'torn-paper', 'tape-note', 'badge', 'ribbon', 'speech-bubble', 'tooltip', 'callout-arrow'];

test('every frame is registered, with variants that resolve and settle in both aspects', () => {
  for (const id of FRAMES) {
    assert.ok(knownModules().includes(id) && EMITTERS[id], id);
    assert.ok(VARIANTS[id].length >= 3, id);
    for (const variant of VARIANTS[id]) for (const aspect of ['9:16', '16:9']) {
      const model = resolve(id, {...SAMPLES[id], variant}, aspect);
      const out = EMITTERS[id](model);
      assert.doesNotMatch(out.html + out.motion, /undefined|NaN/, `${id}/${variant} ${aspect}`);
      for (const [target, props] of settled(model)) {
        if (props.clipB !== undefined) assert.equal(props.clipB + props.clipR + props.clipL, 0, `${id}/${variant}: ${target} still clipped`);
        if (props.scaleX !== undefined && !target.endsWith('-pulse')) assert.ok(Math.abs(props.scaleX - 1) < 1e-6 || target === model.id, `${id}/${variant}: ${target} scale ${props.scaleX}`);
      }
    }
  }
});

test('device-frame: every device, a mock screen without an image, the image with one', () => {
  for (const device of ['browser', 'phone', 'laptop', 'tablet']) {
    const model = resolve('device-frame', {device, title: 'Hello'}, '16:9');
    assert.equal(model.content.device, device);
    assert.match(EMITTERS['device-frame'](model).html, /id="scene-ui-0"/);
  }
  const shot = resolve('device-frame', {device: 'laptop', image: 'assets/testsrc.png'});
  const html = EMITTERS['device-frame'](shot).html;
  assert.match(html, /<img[^>]+src="assets\/testsrc\.png"/);
  assert.doesNotMatch(html, /scene-ui-0/);
  assert.throws(() => resolve('device-frame', {image: 'https://example.com/a.png'}), /project-local/);
  assert.throws(() => resolve('device-frame', {device: 'watch'}), /params\.device/);
});

test('window-chrome: terminal lines type on in order and the cursor blinks after', () => {
  const model = resolve('window-chrome', {...SAMPLES['window-chrome'], variant: 'terminal'});
  const ops = catalogHTimeline(model);
  const [first, second] = model.content.rows;
  assert.ok(second.time >= first.time + first.type - 1e-6, 'the second line waits for the first');
  const mid = frameState(ops, first.time + first.type / 2).get('scene-line-0');
  assert.ok(mid.clipR > 0 && mid.clipR < 100);
  const blinks = ops.filter(op => op.target === 'scene-cursor' && op.type === 'set' && op.time > model.start);
  assert.ok(blinks.length >= 2 && blinks.some(op => op.props.opacity === 0));
  assert.throws(() => resolve('window-chrome', {title: 'Empty'}), /needs lines or an image/);
});

test('paper: torn edges are deterministic, stickers and badges land at their tilt', () => {
  assert.equal(tornPolygon(seeded('same text'), {bottom: true}), tornPolygon(seeded('same text'), {bottom: true}));
  assert.notEqual(tornPolygon(seeded('one'), {bottom: true}), tornPolygon(seeded('two'), {bottom: true}));
  const sticker = settled(resolve('sticker', {...SAMPLES.sticker, tilt: 6})).get('scene-sticker');
  assert.equal(sticker.rotation, 6);
  assert.equal(settled(resolve('badge')).get('scene-badge').rotation, -10);
  assert.throws(() => resolve('sticker', {}), /needs text or an icon/);
  assert.throws(() => resolve('badge', {text: 'A very long badge'}), /params\.text/);
  const tape = resolve('tape-note', {...SAMPLES['tape-note'], variant: 'corners'});
  assert.equal(tape.content.tape.pieces.length, 2);
  // The polaroid develops: its dark layer has faded by the hold.
  assert.equal(settled(resolve('polaroid')).get('scene-develop').opacity, 0);
});

test('callouts: bubbles pop from their tail, tooltips flip below when there is no room above', () => {
  const thought = resolve('speech-bubble', {text: 'What if it made itself?', type: 'thought', tail: 'bottom-right'});
  assert.ok(thought.content.shape.circles.filter(c => c.puff).length === 3);
  const speech = resolve('speech-bubble', {text: 'Hi', tail: 'left'}, '16:9');
  assert.ok(speech.content.tip.x < speech.content.box.x, 'a left tail points left');
  assert.match(EMITTERS['speech-bubble'](speech).html, new RegExp(`transform-origin:${speech.content.tip.x}px ${speech.content.tip.y}px`));
  const high = resolve('tooltip', {text: 'Up here', target: {x: 540, y: 300}});
  assert.equal(high.content.above, false);
  assert.equal(resolve('tooltip', {text: 'Down here', target: {x: 540, y: 1000}}).content.above, true);
  const arrow = resolve('callout-arrow', SAMPLES['callout-arrow'], '16:9');
  const state = settled(arrow);
  for (const part of ['shaft', 'head', 'ring']) assert.equal(state.get(`scene-${part}`).strokeDashoffset, 0, part);
  assert.throws(() => resolve('callout-arrow', {text: 'Close', from: {x: 400, y: 600}, target: {x: 420, y: 620}}), /too close/);
});
