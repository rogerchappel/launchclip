// Catalogue I exploded view (kit/core/catalog-i-exploded.mjs): the isometric
// geometry, the one-accent and four-tone rules, the paint order at every
// frame, and the ops both renderers draw from.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MODULES, catalogHTimeline, catalogHView} from '@launchclip/core/catalog-h.mjs';
import {MAX_PARTS, OBJECTS, TONES, bounds, explodeFraction, iso, paintOrder} from '@launchclip/core/catalog-i-exploded.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {EMITTERS} from '../kit/hyperframes/catalog-h.mjs';
import {knownModules} from '@launchclip/core/modules.mjs';
import {SAMPLES} from '../scripts/element-samples.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}, fonts: {display: 'anton', body: 'space-grotesk', meta: 'jetbrains-mono'}};
const light = {colors: {bg: '#f5f1e8', primary: '#b7791f', accent: '#1f6feb', ink: '#f5f1e8', paper: '#14161c'}, fonts: brand.fonts};
const FORMATS = {'9:16': {width: 1080, height: 1920, fps: 30}, '16:9': {width: 1920, height: 1080, fps: 30}};
const resolve = (params, aspect = '16:9', overrides = {}) => ({...MODULES['exploded-view'].resolve(params, {id: 'scene', start: 1, duration: 5, format: FORMATS[aspect], brand, aspect, hits: [], ...overrides}), module: 'exploded-view'});
const box = (at, size, extra = {}) => ({shape: 'box', at, size, tone: 'mid', ...extra});
const PAIR = [box([0, 0, 0], [100, 100, 20]), box([0, 0, 20], [100, 100, 20], {accent: true, explode: [0, 0, 80], label: 'Top'})];
const near = (a, b) => Math.abs(a - b) < 0.02;

test('the projection is a 30-degree isometric one', () => {
  assert.deepEqual(iso([0, 0, 0]), [0, 0]);
  assert.ok(near(iso([1, 0, 0])[0], Math.cos(Math.PI / 6)) && near(iso([1, 0, 0])[1], 0.5));
  assert.ok(near(iso([0, 1, 0])[0], -Math.cos(Math.PI / 6)) && near(iso([0, 1, 0])[1], 0.5));
  assert.deepEqual(iso([0, 0, 1]), [0, -1]);
  assert.deepEqual(bounds({shape: 'cylinder', at: [10, 10, 5], size: [8, 20], explode: [0, 0, 10]}, 0.5), {min: [6, 6, 10], max: [14, 14, 30]});
});

test('it is registered with both renderers and has a sample', () => {
  assert.ok(knownModules().includes('exploded-view') && EMITTERS['exploded-view'] && SAMPLES['exploded-view']);
});

test('built-in objects keep the rules: four tones, one accent, one-axis explodes', () => {
  for (const [name, parts] of Object.entries(OBJECTS)) {
    assert.ok(parts.length >= 12 && parts.length <= MAX_PARTS, name);
    assert.equal(parts.filter(part => part.accent).length, 1, name);
    for (const part of parts) {
      assert.ok(TONES.includes(part.tone), name);
      assert.ok(part.explode.filter(Boolean).length <= 1, name);
    }
  }
});

test('resolve enforces the rules on a parts list', () => {
  assert.throws(() => resolve({}), /exactly one of object/);
  assert.throws(() => resolve({object: 'server', parts: PAIR}), /exactly one of object/);
  assert.throws(() => resolve({object: 'toaster'}), /params\.object/);
  assert.throws(() => resolve({parts: PAIR.map(part => ({...part, accent: false}))}), /exactly one part with accent/);
  assert.throws(() => resolve({parts: PAIR.map(part => ({...part, accent: true}))}), /exactly one part with accent/);
  assert.throws(() => resolve({parts: [PAIR[0], {...PAIR[1], tone: 'gold'}]}), /tone must be one of deep, mid, light, pale/);
  assert.throws(() => resolve({parts: [PAIR[0], {...PAIR[1], explode: [10, 0, 80]}]}), /one axis/);
  assert.throws(() => resolve({parts: [PAIR[0], {...PAIR[1], explode: undefined}]}), /at least one part with an explode/);
  assert.throws(() => resolve({parts: [PAIR[0], {...PAIR[1], at: [0, 0, 10]}]}), /overlaps part/);
  // The top part passes down through the one under it.
  assert.throws(() => resolve({parts: [PAIR[0], {...PAIR[1], explode: [0, 0, -80]}]}), /overlaps part|no fixed paint order/);
  assert.throws(() => resolve({object: 'server'}, '16:9', {duration: 2.5}), /snapAt|params\.at/);
  assert.equal(resolve({parts: PAIR}).content.parts.length, 2);
});

test('paintOrder: back to front, and no order for parts that swap sides', () => {
  const b = (min, max) => ({min, max});
  const floor = b([0, 0, 0], [10, 10, 1]), lid = b([0, 0, 1], [10, 10, 2]), front = b([10, 0, 0], [11, 10, 2]);
  assert.deepEqual(paintOrder([[lid, floor, front]]).order, [1, 0, 2]);
  assert.equal(paintOrder([[floor, b([5, 5, 0], [15, 15, 1])]]).error, 'intersect');
  assert.equal(paintOrder([[floor, lid], [floor, b([0, 0, -2], [10, 10, -1])]]).error, 'cross');
});

test('every object, aspect and brand: the paint order is back to front at every frame, and the ops match the geometry', () => {
  for (const object of Object.keys(OBJECTS)) for (const aspect of ['9:16', '16:9']) for (const b of [brand, light]) {
    const tag = `${object} ${aspect} ${b.colors.bg}`;
    const model = resolve({object, title: 'What is inside'}, aspect, {brand: b});
    const c = model.content, ops = catalogHTimeline(model);
    const out = EMITTERS['exploded-view'](model);
    assert.doesNotMatch(out.html + out.motion, /undefined|NaN|Infinity/, tag);
    assert.ok(model.minTextPx >= 44 * model.unit - 1e-6, tag);
    assert.deepEqual([...c.order].sort((x, y) => x - y), c.world.map((_, i) => i), tag);
    const rank = new Map(c.order.map((part, at) => [part, at]));
    for (let t = model.start; t <= model.end; t += 1 / model.fps) {
      const state = frameState(ops, t);
      const boxes = c.world.map((part, i) => bounds(part, explodeFraction(c, i, t)));
      // The frame's own order agrees with the fixed one wherever two parts overlap on screen.
      const now = paintOrder([boxes]);
      assert.ok(now.order, `${tag} t=${t.toFixed(3)}: parts ${now.a} and ${now.b} ${now.error}`);
      for (let a = 0; a < boxes.length; a++) for (let d = 0; d < boxes.length; d++) {
        if (a === d || rank.get(a) < rank.get(d)) continue;
        // a is painted after d: d must not stand wholly in front of a while a is nowhere in front of d.
        const front = (p, q) => [0, 1, 2].some(k => p.min[k] >= q.max[k] - 1e-6);
        const [sa, sd] = [boxes[a], boxes[d]].map(({min, max}) => [min[0] - max[1], (min[0] + min[1]) / 2 - max[2], max[0] - min[1], (max[0] + max[1]) / 2 - min[2]]);
        const overlap = sa[0] < sd[2] - 1e-6 && sd[0] < sa[2] - 1e-6 && sa[1] < sd[3] - 1e-6 && sd[1] < sa[3] - 1e-6;
        assert.ok(!(overlap && front(boxes[d], boxes[a]) && !front(boxes[a], boxes[d])), `${tag} t=${t.toFixed(3)}: part ${a} is painted over part ${d}, which is in front of it`);
      }
      // The ops put each part where the geometry says it is.
      for (const part of c.parts) {
        const e = explodeFraction(c, part.index, t), props = state.get(`${model.id}-p${part.index}`) ?? {x: 0, y: 0};
        assert.ok(near(props.x, part.dx * e) && near(props.y, part.dy * e), `${tag} t=${t.toFixed(3)} part ${part.index}`);
      }
    }
    // Assembled at both ends, apart in the hold, labels only in the hold.
    const hold = frameState(ops, (c.explodeEnd + c.snapAt) / 2), end = frameState(ops, c.snapEnd + 0.01);
    for (const part of c.parts) {
      if (!part.dx && !part.dy) continue;
      assert.ok(near(hold.get(`${model.id}-p${part.index}`).x, part.dx) && near(end.get(`${model.id}-p${part.index}`).y, 0), tag);
    }
    for (const l of c.labels) {
      assert.equal(hold.get(`${model.id}-l${l.part}`).opacity, 1, tag);
      assert.equal(end.get(`${model.id}-l${l.part}`).opacity, 0, tag);
      // Labels stay outside the drawing's area.
      assert.ok(l.x + c.colW <= c.area.x + 1e-6 || l.x >= c.area.x + c.area.w - 1e-6, tag);
    }
    // The DOM order of the parts is the paint order.
    const obj = catalogHView(model).children.find(node => node.id === `${model.id}-obj`);
    assert.deepEqual(obj.children.map(node => node.id), c.order.map(i => `${model.id}-p${i}`), tag);
  }
});
