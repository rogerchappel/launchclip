// Catalogue I exploded view: one object drawn as solid parts in a fixed
// 30-degree isometric projection, in four tones with one lit accent part and
// ink outlines: the camera sits close on the assembled object, pulls back as it comes apart along its axes, holds with its labels
// beside it, and snaps back. No leader lines or arrows: a label sits at the
// height of its part, outside the drawing.
//
// The projection is orthographic, so a part moving through space is a plain
// 2D translate on screen: every part is one div holding its SVG faces, moved
// by x/y ops, and both renderers draw the same tree (no CSS 3D context).
// Paint order is the DOM order, fixed for the scene: resolve finds one
// back-to-front order that holds at every sampled instant of the explode and
// the snap, and rejects a parts list that has none.
//
// World axes: x runs right and toward the viewer, y left and toward the
// viewer, z up. A box shows its top, its +x face (right) and its +y face
// (left). Registered in kit/core/catalog-h.mjs.

import {luminance, progress, timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {contrastRatio, createHBase, fitText, mixColor, r2, rt} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, set, tw} from './catalog-h-view.mjs';
import {at3d, rect3d, sceneBox} from './catalog-i-3d-base.mjs';

const C30 = Math.cos(Math.PI / 6);
const EPS = 1e-6;
export const TONES = Object.freeze(['deep', 'mid', 'light', 'pale']);
const TONE_MIX = {deep: 0.3, mid: 0.5, light: 0.72, pale: 0.92};
export const MAX_PARTS = 48;
const EXPLODE = {duration: 0.65, span: 0.45, ease: 'power2.inOut'}, SNAP = {duration: 0.4, span: 0.2, ease: 'power3.in'};

/** World [x, y, z] → screen [x, y] (30° isometric, unit scale). */
export const iso = ([x, y, z]) => [(x - y) * C30, (x + y) / 2 - z];

// ---------------------------------------------------------------------------
// Built-in objects. box(at = min corner, size = [w, d, h]); cyl(at = centre
// of the base, size = [diameter, height]); explode = [dx, dy, dz], one axis.

const box = (at, size, tone, explode = [0, 0, 0], extra = {}) => ({shape: 'box', at, size, tone, explode, ...extra});
const cyl = (at, size, tone, explode = [0, 0, 0], extra = {}) => ({shape: 'cylinder', at, size, tone, explode, ...extra});
const row = (n, fn) => Array.from({length: n}, (_, i) => fn(i));

export const OBJECTS = Object.freeze({
  // A rack server: lid off, sockets, memory, fans and drive bays lift out of the chassis.
  server: [
    box([0, 0, 0], [240, 320, 8], 'deep', undefined, {label: 'Chassis'}),
    box([-6, 0, 0], [6, 320, 60], 'deep', [-90, 0, 0]),
    box([240, 0, 0], [6, 320, 60], 'deep', [90, 0, 0]),
    box([12, 12, 8], [216, 200, 5], 'mid', [0, 0, 20], {label: 'Mainboard'}),
    box([40, 50, 13], [56, 56, 10], 'mid', [0, 0, 70], {accent: true, label: 'Processor'}),
    box([36, 46, 23], [64, 64, 30], 'light', [0, 0, 135], {label: 'Heatsink'}),
    box([140, 50, 13], [56, 56, 10], 'mid', [0, 0, 70]),
    box([136, 46, 23], [64, 64, 30], 'light', [0, 0, 135]),
    ...row(4, i => box([106 + i * 8, 40, 13], [5, 110, 28], 'pale', [0, 0, 100], i === 3 ? {label: 'Memory'} : {})),
    ...row(3, i => cyl([50 + i * 70, 185, 13], [52, 40], 'light', [0, 0, 30], i === 2 ? {label: 'Fans'} : {})),
    ...row(4, i => box([10 + i * 56, 232, 8], [52, 88, 52], 'pale', [0, 130, 0], i === 0 ? {label: 'Drives'} : {})),
    ...row(4, i => box([16 + i * 56, 320, 46], [12, 2, 6], 'deep', [0, 130, 0])),
    box([-6, 0, 60], [252, 320, 6], 'pale', [0, 0, 400], {label: 'Lid'}),
    ...row(3, i => box([14 + i * 76, 20, 66], [60, 280, 3], 'light', [0, 0, 400]))
  ],
  // A phone lying on its back: glass, display and the parts in the tray rise in layers.
  phone: [
    box([0, 0, 0], [140, 290, 6], 'deep', undefined, {label: 'Back cover'}),
    box([0, 0, 6], [6, 290, 14], 'deep'), box([134, 0, 6], [6, 290, 14], 'deep'), box([6, 0, 6], [128, 6, 14], 'deep'), box([6, 284, 6], [128, 6, 14], 'deep'),
    box([14, 14, 6], [112, 86, 5], 'mid', [0, 0, 40], {label: 'Logic board'}),
    box([30, 30, 11], [34, 34, 5], 'mid', [0, 0, 90], {accent: true, label: 'Processor'}),
    cyl([104, 36, 11], [28, 9], 'light', [0, 0, 90], {label: 'Cameras'}), cyl([104, 72, 11], [20, 9], 'light', [0, 0, 90]),
    box([14, 110, 6], [112, 150, 8], 'light', [0, 0, 40], {label: 'Battery'}),
    cyl([70, 185, 14], [68, 2], 'pale', [0, 0, 90], {label: 'Charging coil'}),
    box([14, 264, 6], [22, 14, 8], 'mid', [0, 0, 40]), box([40, 264, 6], [60, 14, 8], 'mid', [0, 0, 40]),
    box([3, 3, 20], [134, 284, 4], 'mid', [0, 0, 330], {label: 'Display'}),
    box([0, 0, 24], [140, 290, 3], 'pale', [0, 0, 400], {label: 'Glass'})
  ],
  // A battery pack: six cells in a tray under their strips, the safety board and the lid.
  battery: [
    box([0, 0, 0], [220, 150, 8], 'deep', undefined, {label: 'Tray'}),
    box([0, -6, 0], [220, 6, 140], 'deep', [0, -110, 0]),
    box([-6, 0, 0], [6, 150, 140], 'deep', [-80, 0, 0]),
    box([220, 0, 0], [6, 150, 140], 'deep', [80, 0, 0]),
    ...row(6, i => cyl([40 + (i % 3) * 70, 40 + Math.floor(i / 3) * 70, 8], [60, 110], 'light', [0, 0, 70], i === 4 ? {accent: true, label: 'Cells'} : {})),
    ...row(6, i => cyl([40 + (i % 3) * 70, 40 + Math.floor(i / 3) * 70, 118], [20, 6], 'pale', [0, 0, 70])),
    ...row(3, i => box([28 + i * 70, 22, 124], [24, 106, 3], 'pale', [0, 0, 190], i === 2 ? {label: 'Nickel strips'} : {})),
    box([20, 30, 127], [180, 90, 5], 'mid', [0, 0, 290], {label: 'Safety board'}),
    box([90, 60, 132], [40, 30, 6], 'deep', [0, 0, 290]),
    box([-6, -6, 140], [232, 162, 6], 'pale', [0, 0, 420], {label: 'Lid'})
  ]
});

// ---------------------------------------------------------------------------
// Geometry and paint order

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
/** A part's world bounds {min, max} with its explode applied at fraction e. */
export function bounds(part, e = 0) {
  const [x, y, z] = part.at;
  const [min, max] = part.shape === 'box' ? [[x, y, z], add(part.at, part.size)] : [[x - part.size[0] / 2, y - part.size[0] / 2, z], [x + part.size[0] / 2, y + part.size[0] / 2, z + part.size[1]]];
  return {min: add(min, part.explode, e), max: add(max, part.explode, e)};
}
/** Screen box of world bounds: [x0, y0, x1, y1] (unit scale). */
function screenBox({min, max}) {
  return [(min[0] - max[1]) * C30, (min[0] + min[1]) / 2 - max[2], (max[0] - min[1]) * C30, (max[0] + max[1]) / 2 - min[2]];
}
// a stands wholly on the viewer's side of b along some axis.
const inFront = (a, b) => [0, 1, 2].some(k => a.min[k] >= b.max[k] - EPS);

/**
 * One back-to-front paint order (part indices) that is right for every list
 * of bounds in `frames`, or {error, a, b}. Two parts are compared where
 * their screen boxes overlap; a pair that swaps sides, or interpenetrates,
 * has no fixed order.
 */
export function paintOrder(frames) {
  const n = frames[0].length;
  const over = new Set(); // "a>b": a is painted after b
  for (const boxes of frames) {
    const screens = boxes.map(screenBox);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const s = screens[a], t = screens[b];
      if (s[0] >= t[2] - EPS || t[0] >= s[2] - EPS || s[1] >= t[3] - EPS || t[1] >= s[3] - EPS) continue;
      const ab = inFront(boxes[a], boxes[b]), ba = inFront(boxes[b], boxes[a]);
      if (!ab && !ba) return {error: 'intersect', a, b};
      if (ab !== ba) over.add(ab ? `${a}>${b}` : `${b}>${a}`);
    }
  }
  for (const key of over) { const [a, b] = key.split('>'); if (over.has(`${b}>${a}`)) return {error: 'cross', a: +a, b: +b}; }
  // Kahn's sort, the farthest ready part first.
  const depth = frames[0].map(({min, max}) => min[0] + max[0] + min[1] + max[1] + min[2] + max[2]);
  const under = Array.from({length: n}, () => []), waiting = new Array(n).fill(0);
  for (const key of over) { const [a, b] = key.split('>'); under[+b].push(+a); waiting[+a]++; }
  const order = [], done = new Array(n).fill(false);
  while (order.length < n) {
    let next = -1;
    for (let i = 0; i < n; i++) if (!done[i] && !waiting[i] && (next < 0 || depth[i] < depth[next])) next = i;
    if (next < 0) { const a = done.indexOf(false); return {error: 'cycle', a, b: a}; }
    done[next] = true; order.push(next);
    for (const a of under[next]) waiting[a]--;
  }
  return {order};
}

/** How far part `i` is along its explode at absolute time t (0 assembled, 1 apart). */
export function explodeFraction(content, i, t) {
  const p = content.world[i];
  if (t >= p.snapAt) return 1 - progress(t, p.snapAt, SNAP.duration, SNAP.ease);
  return progress(t, p.explodeAt, EXPLODE.duration, EXPLODE.ease);
}

const pt = ([x, y]) => `${r2(x)} ${r2(y)}`;
/** A part's faces as SVG paths at scale k about screen origin o: [{d, face: top | left | right | line}]. */
function facePaths(part, k, o) {
  const P = p => { const [x, y] = iso(p); return [o.x + x * k, o.y + y * k]; };
  const poly = points => `M${points.map(p => pt(P(p))).join(' L')} Z`;
  const {min: [x0, y0, z0], max: [x1, y1, z1]} = bounds(part);
  if (part.shape === 'box') return [
    {face: 'left', d: poly([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]])},
    {face: 'right', d: poly([[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]])},
    {face: 'top', d: poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]])}
  ];
  // A circle on the floor projects to an axis-aligned ellipse.
  const r = part.size[0] / 2, rx = r * Math.SQRT2 * C30 * k, ry = r * Math.SQRT1_2 * k;
  const [cx, top] = P([part.at[0], part.at[1], z1]), bottom = P([part.at[0], part.at[1], z0])[1];
  const A = `A${r2(rx)} ${r2(ry)} 0 0`, a = 75 * Math.PI / 180, sx = cx + rx * Math.cos(a), sy = ry * Math.sin(a);
  return [
    {face: 'left', d: `M${pt([cx - rx, top])} L${pt([cx - rx, bottom])} ${A} 0 ${pt([cx + rx, bottom])} L${pt([cx + rx, top])} Z`},
    {face: 'right', d: `M${pt([sx, top + sy])} L${pt([sx, bottom + sy])} ${A} 0 ${pt([cx + rx, bottom])} L${pt([cx + rx, top])} ${A} 1 ${pt([sx, top + sy])} Z`, bare: true},
    {face: 'line', d: `M${pt([cx - rx, top])} L${pt([cx - rx, bottom])} ${A} 0 ${pt([cx + rx, bottom])} L${pt([cx + rx, top])}`},
    {face: 'top', d: `M${pt([cx - rx, top])} ${A} 1 ${pt([cx + rx, top])} ${A} 1 ${pt([cx - rx, top])} Z`}
  ];
}

// ---------------------------------------------------------------------------
// Resolve

const VEC = 'three numbers';
function partsOf(check, raw, path) {
  check.arr(raw, path, 2, MAX_PARTS);
  const parts = raw.map((part, i) => {
    const at = `${path}[${i}]`;
    check.obj(part, at, ['shape', 'at', 'size', 'tone', 'accent', 'explode', 'label'], ['shape', 'at', 'size', 'tone']);
    const shape = check.oneOf(part.shape, `${at}.shape`, ['box', 'cylinder']);
    const vec = (value, name, n, min, max) => check.arr(value, `${at}.${name}`, n, n).map((v, k) => check.num(v, `${at}.${name}[${k}]`, min, max));
    const explode = part.explode === undefined ? [0, 0, 0] : vec(part.explode, 'explode', 3, -2000, 2000);
    if (explode.filter(v => v !== 0).length > 1) check.fail(`${at}.explode`, 'moves along one axis: at most one of its three numbers is not 0');
    return {shape, at: vec(part.at, 'at', 3, -2000, 2000), size: vec(part.size, 'size', shape === 'box' ? 3 : 2, 1, 2000), tone: check.oneOf(part.tone, `${at}.tone`, TONES),
      accent: part.accent === undefined ? false : check.bool(part.accent, `${at}.accent`), explode, label: part.label === undefined ? null : check.str(part.label, `${at}.label`, 18)};
  });
  const lit = parts.filter(part => part.accent).length;
  if (lit !== 1) check.fail(path, `needs exactly one part with accent: true (the lit part); got ${lit}`);
  if (!parts.some(part => part.explode.some(v => v !== 0))) check.fail(path, 'needs at least one part with an explode');
  return parts;
}

function explodedResolve(params, ctx) {
  const b = createHBase('exploded-view', params, ctx, {allowed: ['object', 'parts', 'title', 'source', 'at', 'snapAt'], variants: ['default']});
  const {check, u} = b;
  const p = b.params;
  if ((p.object === undefined) === (p.parts === undefined)) check.fail('params', `needs exactly one of object (${Object.keys(OBJECTS).join(', ')}) or parts`);
  const parts = partsOf(check, p.object === undefined ? p.parts : OBJECTS[check.oneOf(p.object, 'params.object', Object.keys(OBJECTS))], p.object === undefined ? 'params.parts' : `object ${p.object}`);
  const n = parts.length;

  // Timing: the part that travels farthest leaves first and lands last (of equals, the nearest), so a stack peels from the outside in.
  const explodeAt = b.timeOf('explode', p.at, 'params.at', 0.7);
  const explodeEnd = rt(explodeAt + EXPLODE.span + EXPLODE.duration);
  const snapLength = SNAP.span + SNAP.duration;
  const snapMin = explodeEnd - b.start + 0.4, snapMax = b.duration - b.motion.exitDuration - snapLength - 0.1;
  const snapAt = b.timeOf('snap', p.snapAt, 'params.snapAt', Math.max(snapMin, snapMax - 0.05), {min: snapMin - 1e-6, max: snapMax});
  const snapEnd = rt(snapAt + snapLength);
  b.events.push({id: `${b.id}-explode`, name: 'explode', time: explodeAt, endTime: explodeEnd, role: 'emphasis', cue: 'pop'});
  b.events.push({id: `${b.id}-snap`, name: 'snap', time: snapAt, endTime: snapEnd, role: 'emphasis', cue: 'hit-soft'});
  const depth = parts.map(part => { const {min, max} = bounds(part); return min[0] + max[0] + min[1] + max[1] + min[2] + max[2]; });
  const rank = new Array(n);
  const travel = parts.map(part => Math.hypot(...part.explode));
  // Of two parts that travel as far, the one ahead along the way out leaves first.
  const lead = parts.map((part, i) => { const {min, max} = bounds(part); return travel[i] ? part.explode.reduce((sum, v, axis) => sum + v * (min[axis] + max[axis]), 0) / travel[i] : 0; });
  [...parts.keys()].sort((i, j) => travel[j] - travel[i] || lead[j] - lead[i] || depth[j] - depth[i] || i - j).forEach((i, k) => { rank[i] = n > 1 ? k / (n - 1) : 0; });
  const timed = parts.map((part, i) => ({...part, explodeAt: rt(explodeAt + rank[i] * EXPLODE.span), snapAt: rt(snapAt + (1 - rank[i]) * SNAP.span)}));

  // Paint order over the explode and the snap, sampled finer than any frame rate in use.
  const times = [];
  for (const [t0, t1] of [[explodeAt, explodeEnd], [snapAt, snapEnd]]) for (let t = t0; t < t1 + 1 / 240; t += 1 / 120) times.push(Math.min(t, t1));
  const clock = {world: timed};
  const painted = paintOrder(times.map(t => timed.map((part, i) => bounds(part, explodeFraction(clock, i, t)))));
  if (painted.error) {
    const where = p.object === undefined ? `params.parts[${painted.a}]` : `object ${p.object} part ${painted.a}`;
    check.fail(where, painted.error === 'intersect' ? `overlaps part ${painted.b} in space; parts are solid and may only touch`
      : `has no fixed paint order with part ${painted.b} as the object comes apart; move them apart along one axis only`);
  }

  // Layout: labels in columns beside the drawing (one column in portrait), the drawing fitted to the rest.
  const box = sceneBox(b, p);
  const labelled = timed.map((part, i) => ({part, i})).filter(({part}) => part.label);
  const columns = !labelled.length ? 0 : b.portrait ? 1 : 2;
  const gap = u(28), colW = columns ? r2(box.W * (b.portrait ? 0.4 : 0.22)) : 0;
  const size = Math.min(...labelled.map(({part, i}) => fitText(check, `parts[${i}].label`, part.label, {family: 'body', width: colW, preferred: u(48), min: b.min.key}).size), u(48));
  const area = {x: columns === 2 ? colW + gap : 0, y: box.top, w: box.W - columns * (colW + gap), h: box.avail};
  const points = timed.flatMap(part => [0, 1].flatMap(e => { const [x0, y0, x1, y1] = screenBox(bounds(part, e)); return [[x0, y0], [x1, y1]]; }));
  const lo = [Math.min(...points.map(q => q[0])), Math.min(...points.map(q => q[1]))], hi = [Math.max(...points.map(q => q[0])), Math.max(...points.map(q => q[1]))];
  const pad = u(10);
  const k = Math.min((area.w - 2 * pad) / (hi[0] - lo[0]), (area.h - 2 * pad) / (hi[1] - lo[1]));
  const origin = {x: r2(area.x + area.w / 2 - k * (lo[0] + hi[0]) / 2), y: r2(area.y + area.h / 2 - k * (lo[1] + hi[1]) / 2)};

  // The camera: close on the assembled object, pulling back as it comes apart.
  const whole = timed.map(part => screenBox(bounds(part)));
  const a0 = [Math.min(...whole.map(q => q[0])), Math.min(...whole.map(q => q[1]))], a1 = [Math.max(...whole.map(q => q[2])), Math.max(...whole.map(q => q[3]))];
  const zs = Math.min(1.7, (area.w - 2 * pad) / (k * (a1[0] - a0[0])), (area.h - 2 * pad) / (k * (a1[1] - a0[1])));
  const pivot = {x: r2(area.x + area.w / 2), y: r2(area.y + area.h / 2)};
  const zoom = zs < 1.05 ? null : {scale: r2(zs), x: r2(-zs * (origin.x + k * (a0[0] + a1[0]) / 2 - pivot.x)), y: r2(-zs * (origin.y + k * (a0[1] + a1[1]) / 2 - pivot.y))};

  // A label sits at the height of its part once apart, on the part's side of the drawing.
  const lineH = r2(size * 1.25);
  if (labelled.length * lineH > columns * area.h) check.fail('params.parts', `has ${labelled.length} labels; at most ${Math.floor(columns * area.h / lineH)} fit beside the drawing`);
  const centre = area.x + area.w / 2;
  const spots = labelled.map(({part, i}) => { const s = screenBox(bounds(part, 1)); return {i, x: origin.x + k * (s[0] + s[2]) / 2, y: origin.y + k * (s[1] + s[3]) / 2}; }).sort((a, c) => a.y - c.y);
  let turn = 0;
  const perSide = Math.floor(area.h / lineH);
  const sides = {left: [], right: []};
  for (const spot of spots) {
    let side = columns === 1 ? 'right' : Math.abs(spot.x - centre) > 0.12 * area.w ? (spot.x < centre ? 'left' : 'right') : turn++ % 2 ? 'left' : 'right';
    if (columns === 2 && sides[side].length >= perSide) side = side === 'left' ? 'right' : 'left';
    sides[side].push(spot);
  }
  const labels = [];
  for (const [side, list] of Object.entries(sides)) {
    let y = area.y;
    for (const spot of list) { spot.top = Math.max(y, spot.y - lineH / 2); y = spot.top + lineH; }
    let floor = area.y + area.h;
    for (const spot of [...list].reverse()) { spot.top = Math.min(spot.top, floor - lineH); floor = spot.top; }
    for (const spot of list) labels.push({part: spot.i, side, text: timed[spot.i].label, x: side === 'left' ? 0 : r2(box.W - colW), y: r2(spot.top), at: rt(timed[spot.i].explodeAt + EXPLODE.duration - 0.15)});
  }

  // Tones: four steps between the brand's dark and light ends, a touch of primary; each face a shade of its tone.
  const [dark, bright] = luminance(b.colors.bg) < luminance(b.colors.paper) ? [b.colors.bg, b.colors.paper] : [b.colors.paper, b.colors.bg];
  const shade = tone => ({top: tone, left: mixColor(tone, dark, 0.8), right: mixColor(tone, dark, 0.6)});
  const tones = Object.fromEntries(TONES.map(name => [name, shade(mixColor(b.colors.primary, mixColor(bright, dark, TONE_MIX[name]), 0.12))]));
  const accent = {top: mixColor(b.colors.accent, '#ffffff', 0.72), left: b.colors.accent, right: mixColor(b.colors.accent, dark, 0.7)};
  const ink = mixColor('#000000', dark, 0.4);

  const out = painted.order.map(i => {
    const part = timed[i];
    const [dx, dy] = iso(part.explode);
    const s = screenBox(bounds(part));
    return {index: i, accent: part.accent, tone: part.tone, faces: facePaths(part, k, origin), dx: r2(dx * k), dy: r2(dy * k), explodeAt: part.explodeAt, snapAt: part.snapAt,
      box: {x: r2(origin.x + k * s[0]), y: r2(origin.y + k * s[1]), w: r2(k * (s[2] - s[0])), h: r2(k * (s[3] - s[1]))}};
  });
  const content = {variant: b.variant, title: box.tb.title, source: box.tb.source, object: p.object ?? null, W: box.W, H: box.H, k: r2(k), origin, area, pivot, zoom, colW, parts: out, order: painted.order, world: timed, labels,
    labelSize: size, lineH, tones, accentTone: accent, ink, stroke: r2(Math.max(1.5, 2.5 * b.unit)), accentText: contrastRatio(b.colors.accent, b.colors.bg) >= 3 ? b.colors.accent : b.theme.foreground,
    explodeAt, explodeEnd, snapAt, snapEnd, buildEnd: explodeEnd};
  return b.finish(content, {minTextPx: r2(Math.min(size, box.tb.title ? box.tb.title.size : Infinity))});
}

// ---------------------------------------------------------------------------
// View and timeline

function explodedView(model) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const nodes = c.parts.map(part => {
    const fill = part.accent ? c.accentTone : c.tones[part.tone];
    const line = {stroke: c.ink, strokeWidth: c.stroke, strokeLinejoin: 'round', strokeLinecap: 'round'};
    const faces = part.faces.map(f => el('path', null, null, [], f.face === 'line' ? {d: f.d, fill: 'none', ...line} : {d: f.d, fill: fill[f.face], ...(f.bare ? {} : line)}));
    const kids = [el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, faces, {width: c.W, height: c.H, viewBox: `0 0 ${c.W} ${c.H}`})];
    // The lit part glows onto what is behind it.
    if (part.accent) kids.unshift(el('div', null, abs(r2(part.box.x - part.box.w * 0.6), r2(part.box.y - part.box.h * 0.6), r2(part.box.w * 2.2), r2(part.box.h * 2.2),
      {background: `radial-gradient(closest-side, ${hex2(c.accentTone.left, 0.5)} 0%, ${hex2(c.accentTone.left, 0)} 100%)`})));
    return el('div', `${id}-p${part.index}`, abs(0, 0, c.W, c.H), kids);
  });
  const labels = c.labels.map(l => label(`${id}-l${l.part}`, l.x, l.y, c.colW, l.text, {size: c.labelSize, family: fonts.body, weight: 600, lineHeight: 1.25, align: l.side === 'left' ? 'right' : 'left',
    color: c.world[l.part].accent ? c.accentText : theme.foreground, extra: {opacity: 0}}));
  return [...chromeNodes(model), el('div', `${id}-obj`, abs(0, 0, c.W, c.H, {transformOrigin: `${c.pivot.x}px ${c.pivot.y}px`}), nodes), ...labels];
}

function explodedTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  if (c.zoom) {
    const near = {x: c.zoom.x, y: c.zoom.y, scaleX: c.zoom.scale, scaleY: c.zoom.scale}, far = {x: 0, y: 0, scaleX: 1, scaleY: 1};
    set(ops, `${id}-obj`, start, near);
    // The pull-back leads the parts out and the push-in follows them home, so they stay in frame.
    tw(ops, `${id}-obj`, rt(Math.max(start, c.explodeAt - 0.15)), 0.75, 'power2.inOut', near, far);
    tw(ops, `${id}-obj`, rt(c.snapAt + SNAP.span), rt(SNAP.duration + 0.08), 'power2.inOut', far, near);
  }
  for (const part of c.parts) {
    if (!part.dx && !part.dy) continue;
    const target = `${id}-p${part.index}`, apart = {x: part.dx, y: part.dy};
    set(ops, target, start, {x: 0, y: 0});
    tw(ops, target, part.explodeAt, EXPLODE.duration, EXPLODE.ease, {x: 0, y: 0}, apart);
    tw(ops, target, part.snapAt, SNAP.duration, SNAP.ease, apart, {x: 0, y: 0});
  }
  for (const l of c.labels) {
    const target = `${id}-l${l.part}`, dx = r2((l.side === 'left' ? 1 : -1) * 16 * u);
    set(ops, target, start, {opacity: 0, x: dx, y: 0});
    tw(ops, target, l.at, 0.35, 'power2.out', {opacity: 0, x: dx}, {opacity: 1, x: 0});
    tw(ops, target, rt(c.snapAt - 0.1), 0.2, 'power1.in', {opacity: 1}, {opacity: 0});
  }
}

export const explodedViewModule = {
  id: 'exploded-view',
  describe: `One object as an isometric drawing of solid parts, in four tones with a single lit accent part and ink outlines, that comes apart along its axes, holds with its labels beside it, and snaps back. Built-in objects: ${Object.keys(OBJECTS).join(', ')}; or a parts list.`,
  params: {object: `a built-in object: ${Object.keys(OBJECTS).join(' | ')} (this or parts)`,
    parts: `[{shape: box | cylinder, at: [x, y, z] (box: its low corner; cylinder: the centre of its base; x right, y left, both toward the viewer, z up), size: box [w, d, h] | cylinder [diameter, height], tone: ${TONES.join(' | ')}, accent? (true on exactly one part: the lit one), explode? [dx, dy, dz] (one axis only), label? ≤ 18}] 2–${MAX_PARTS}; parts are solid and may touch but not overlap`,
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `the explode: ${at3d}`, snapAt: 'the snap back: seconds from scene start (optional; default just before the exit)', rect: rect3d},
  events: ['explode', 'snap'], timing: timingRules({rules: ['the explode takes about 1.1 s from at, the outermost part first; the snap back takes 0.6 s and ends before the exit', 'needs a scene of 4 s or more']}), variants: ['default'],
  resolve: explodedResolve, view: explodedView, timeline: explodedTimeline
};

export const EXPLODED_MODULES = [explodedViewModule];
