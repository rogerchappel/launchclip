// The particle engine (kit/core/particles.mjs): seeded, frame-pure painting
// of paint plans, the dot-matrix face, the fill order, and the runtime
// HyperFrames inlines drawing exactly what Remotion's import draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PARTICLE_RUNTIME, dotMatrixColumns, dotMatrixPoints, fillOrder, paintParticles, particleHash} from '../kit/core/particles.mjs';

/** A 2D context that records every call and property write, in order. */
function recorder(width = 800, height = 600) {
  const log = [];
  const canvas = {width, height, ownerDocument: {createElement: () => offscreen()}};
  const ctx = new Proxy({canvas}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createImageData') return (w, h) => ({data: new Uint8ClampedArray(w * h * 4)});
      return (...args) => { log.push([key, ...args.map(a => (a && typeof a === 'object' && !Array.isArray(a) ? '[obj]' : a))]); };
    },
    set(_target, key, value) { if (key !== 'canvas') log.push(['=', key, value]); return true; }
  });
  return {ctx, log};
}
function offscreen() {
  const c = {width: 0, height: 0, getContext: () => recorder(c.width, c.height).ctx};
  return c;
}
globalThis.Path2D ??= class { moveTo() {} arc() {} rect() {} roundRect() {} lineTo() {} };

const PLAN = {width: 800, height: 600, glow: {alpha: 0.5, blur: 6}, layers: [
  {kind: 'field', x: 10, y: 10, w: 400, h: 200, cols: 200, rows: 50, count: 10000, rgb: [70, 212, 255], empty: 0.07, at: 0, t0: 0.2, t1: 2, ease: 'none', seed: 11, shuffle: true, zoom: [{t: 0.2, s: 8, fx: 0.1, fy: 0.2}, {t: 1.8, s: 1, fx: 0.5, fy: 0.5}]},
  {kind: 'swarm', pts: dotMatrixPoints('42', {x: 450, y: 50, width: 300, height: 200}).pts, rgb: [255, 255, 255], size: 2, seed: 3, alpha: 1, at: 0.5, assemble: {t: 0.5, dur: 1, spread: 0.5, cx: 600, cy: 150, r: 300}, dissolve: {t: 2.5, dur: 1, spread: 0.5, dx: 40, dy: -20, r: 60}, shimmer: 0.4},
  {kind: 'ring', cx: 400, cy: 400, rx: 120, ry: 40, rot: -0.3, count: 400, width: 0.3, omega: 0.5, size: 2, rgb: [1, 2, 3], seed: 31, at: 0.2, dur: 1, half: 'back'},
  {kind: 'cloud', box: {x: 300, y: 350, w: 200, h: 80}, count: 300, spread: 60, drift: 6, rgb: [1, 2, 3], size: 2, seed: 51, at: 0.4, dur: 1, from: {x: 50, y: 580}},
  {kind: 'cells', grids: [{x: 20, y: 300, cols: 10, rows: 10, cell: 12, gap: 3, radius: 3, count: 100, slots: 100, order: 'bottom-up', rgb: [1, 2, 3], empty: 0.1, at: 0, t0: 0.3, t1: 1.5,
    segs: [{from: 0, to: 20, rgb: [9, 9, 9]}], hl: {from: 0, to: 5, rgb: [200, 0, 0], t: 2, step: 0.02, dim: 0.3}, tick: {count: 30, t0: 2.2, t1: 2.8, rgb: [0, 200, 0], ink: [0, 0, 0]}}]}
]};

const draw = (paint, t) => { const {ctx, log} = recorder(); paint(ctx, PLAN, t); return log; };

test('painting is a pure function of (plan, t), whatever was painted before', () => {
  for (const t of [0.1, 0.9, 1.7, 2.4, 3.2]) {
    const fresh = draw(paintParticles, t);
    assert.ok(fresh.length > 10, `t=${t} paints`);
    // Seek forwards and backwards through other times first: the same calls.
    draw(paintParticles, 3.3); draw(paintParticles, 0.05);
    assert.deepEqual(draw(paintParticles, t), fresh, `t=${t}`);
  }
});

test('the inlined runtime is self-contained and paints exactly what the module paints', () => {
  const window = {};
  new Function('window', PARTICLE_RUNTIME)(window);
  assert.equal(typeof window.lcPaintParticles, 'function');
  for (const t of [0.6, 1.4, 2.9]) assert.deepEqual(draw(window.lcPaintParticles, t), draw(paintParticles, t), `t=${t}`);
});

test('the fill order visits every token once, the same way every time', () => {
  const n = 54321, order = fillOrder(n, 11), seen = new Uint8Array(n);
  for (const index of order) { assert.equal(seen[index], 0); seen[index] = 1; }
  assert.deepEqual(fillOrder(n, 11), order);
  assert.notDeepEqual([...fillOrder(n, 12).slice(0, 20)], [...order.slice(0, 20)]);
  for (let i = 0; i < 1000; i++) { const h = particleHash(i, 7); assert.ok(h >= 0 && h < 1); }
});

test('dot-matrix text: narrow punctuation, sub × sub particles per LED, centred in its box', () => {
  assert.equal(dotMatrixColumns('1'), 3);
  assert.equal(dotMatrixColumns('1,050,000'), dotMatrixColumns('1050000') + 2 * 3);
  const {pts, pitch, width} = dotMatrixPoints('8', {x: 0, y: 0, width: 500, height: 70, sub: 3});
  assert.equal(pitch, 10);
  assert.equal(pts.length / 2, 17 * 9, 'an 8 lights 17 LEDs');
  assert.equal(width, 50);
  for (let i = 0; i < pts.length; i += 2) assert.ok(pts[i] >= 225 && pts[i] <= 275 && pts[i + 1] >= 0 && pts[i + 1] <= 70);
  assert.throws(() => dotMatrixPoints('é', {x: 0, y: 0, width: 10, height: 10}), /no glyph/);
});
