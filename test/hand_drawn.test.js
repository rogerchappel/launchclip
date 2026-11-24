import test from 'node:test';
import assert from 'node:assert/strict';
import {handDrawn, orderStrokes, penPath, timeStrokes} from '../kit/core/hand-drawn.mjs';
import {pointAt} from '../kit/core/path-geometry.mjs';

const ctx = (duration = 7) => ({id: 'hd', start: 0, duration, format: {width: 1080, height: 1920, fps: 30},
  brand: {colors: {bg: '#101820', primary: '#2f7de1', accent: '#f2a93b', ink: '#101820', paper: '#f4f1ea'}, fonts: {}}});
const line = (x0, y0, x1, y1) => ({points: [[x0, y0], [x1, y1]], closed: false, length: Math.hypot(x1 - x0, y1 - y0), area: 0});

test('hand-drawn: the silhouette goes down first, then the stroke nearest the ink', () => {
  const box = {points: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], closed: true, length: 400, area: 10000};
  const far = line(500, 500, 600, 600), near = line(110, 50, 200, 50), touching = line(300, 50, 205, 50);
  const order = orderStrokes([far, near, box, touching]);
  assert.equal(order[0], box);
  assert.equal(order[1], near);
  // Its end is nearer the ink, so it is drawn from that end.
  assert.deepEqual(order[2].points[0], [205, 50]);
});

test('hand-drawn: at most 6 lines a second, each after the last, inside the span', () => {
  const strokes = Array.from({length: 40}, (_, i) => line(0, i, 10 + i, i));
  const timed = timeStrokes(strokes, 1, 2);
  assert.ok(timed.length > 1 && timed.length <= 12, `${timed.length} lines`);
  assert.equal(timed[0].points, strokes[0].points);
  const last = timed.at(-1);
  assert.ok(last.at + last.duration <= 3 + 1e-6);
  for (let i = 1; i < timed.length; i++) assert.ok(timed[i].at >= timed[i - 1].at + timed[i - 1].duration - 1e-6);
});

test('hand-drawn: the pen keeps a hand\'s pace and colours with a steady sweep, whatever the pen', () => {
  for (const pen of ['pencil', 'marker']) {
    const model = handDrawn.resolve({subject: {object: 'deck'}, pen}, ctx());
    const {strokes} = model.content.pieces[0];
    // Lines after the silhouette are drawn at no more than 2200 px a second (unit 1 at 1080 wide).
    for (const s of strokes.slice(1)) assert.ok(s.length / s.duration <= 2200 * 1.02, `${pen}: ${Math.round(s.length / s.duration)} px/s`);
    const ops = [];
    handDrawn.timeline(model, ops);
    const at = ops.filter(o => o.target === 'hd-pen' && o.type === 'set' && o.props.x !== undefined && o.time > 0);
    let turns = 0;
    for (let i = 2; i < at.length; i++) {
      const a = [at[i - 1].props.x - at[i - 2].props.x, at[i - 1].props.y - at[i - 2].props.y], b = [at[i].props.x - at[i - 1].props.x, at[i].props.y - at[i - 1].props.y];
      if (a[0] * b[0] + a[1] * b[1] < 0) turns++;
    }
    // A thin pencil once swept 8 times a second; the pen now turns back about twice.
    assert.ok(turns / (at.at(-1).time - at[0].time) < 3, `${pen}: ${turns} turns`);
  }
});

test('hand-drawn: the pen tip is on the line being drawn', () => {
  const model = handDrawn.resolve({subject: {object: 'clock'}, barrel: 'ACME'}, ctx());
  const path = penPath(model);
  const s = model.content.pieces[0].strokes[3];
  const t = s.at + s.duration / 2;
  const leg = path.legs.find(l => t >= l.t0 && t <= l.t1);
  const at = leg.fn(t);
  // power1.inOut at the midpoint is exactly half the length.
  const [x, y] = pointAt(s.points, 0.5);
  assert.ok(Math.hypot(at.x - x, at.y - y) < 0.5);
});

test('hand-drawn: two objects are drawn one after the other, each inked before it is coloured', () => {
  const model = handDrawn.resolve({subject: {object: 'laptop'}, second: {object: 'rocket'}, pen: 'fountain'}, ctx());
  const [a, b] = model.content.pieces;
  const end = p => p.strokes.at(-1).at + p.strokes.at(-1).duration;
  assert.ok(end(a) <= a.colourAt && a.colourAt + a.colour <= b.strokes[0].at + 1e-6 && end(b) <= b.colourAt);
  // A tall frame stacks them.
  assert.ok(model.content.boxes[1].y > model.content.boxes[0].y + model.content.boxes[0].height * 0.5);
  const names = model.events.map(e => e.name);
  for (const name of ['draw', 'outline-0', 'colour-0', 'outline-1', 'colour-1']) assert.ok(names.includes(name), name);
});

test('hand-drawn: a barrel needs a pen, and a scene too short to draw in is refused', () => {
  assert.throws(() => handDrawn.resolve({subject: {object: 'clock'}, pen: 'none', barrel: 'ACME'}, ctx()), /barrel/);
  assert.throws(() => handDrawn.resolve({subject: {object: 'clock'}, second: {object: 'deck'}}, ctx(2.5)), /at least 1.2 s/);
});

test('hand-drawn: the view and the timeline name the same parts', () => {
  const model = handDrawn.resolve({subject: {object: 'deck'}, pen: 'pencil', text: 'Oil it once a year'}, ctx());
  const ops = [];
  handDrawn.timeline(model, ops);
  const ids = new Set();
  const walk = n => { if (n && typeof n === 'object') { if (n.id) ids.add(n.id); (n.children ?? []).forEach(walk); } };
  handDrawn.view(model).forEach(walk);
  for (const op of ops) assert.ok(ids.has(op.target), `${op.target} is in the view`);
});
