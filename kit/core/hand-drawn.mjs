// hand-drawn (docs/rd/hand-drawn-reveal.md): an illustration drawn the way a
// person draws it. A pen puts the ink outline down stroke by stroke, then
// colours the object in, instead of the picture wiping on in one sweep.
//
// The objects are the illustration module's closed vocabulary (a drawn
// object, a world-kit prop, or an icon at hero scale), so the art is already
// vector: its shapes are read from the view tree (kit/core/path-geometry.mjs)
// and every stroke is a dash draw-on both renderers share. Order:
//   object by object   the subject is inked and coloured before the second starts
//   outline first      the largest closed shape (the silhouette) goes down first
//   then the inside    each next stroke starts nearest to ink already down, so
//                      inner lines grow out of drawn ones
//   colour             the finished art is uncovered top to bottom under an inset
//                      clip while the pen zigzags along the clip's edge
// Budget: the ink gets a share of the scene; strokes past RATE a second are
// left to arrive with the colour (the shortest first), never sped up.
// The pen (kit/core/sketch-pens.mjs) is one div moved by per-frame set ops
// computed from the same points as the dash, so its tip stays on the line.

import {timingRules, frameSamples, progress} from './catalog-b-base.mjs';
import {createHBase, fitText, r2, rt} from './catalog-h-base.mjs';
import {abs, drawOps, el, label, set, strokePath, tw} from './catalog-h-view.mjs';
import {svgRoot} from './catalog-b-view.mjs';
import {EDITORIAL_OBJECTS, objectGeometry, objectLook} from './illustration-objects.mjs';
import {aspectOf, objectSpec, subjectNodes} from './illustration.mjs';
import {area, bounds, pointAt, polylineLength, shapeSubpaths, toPathD, walkShapes} from './path-geometry.mjs';
import {PENS, PEN_INK, penNode, penTipLift} from './sketch-pens.mjs';

export const HAND_PENS = Object.freeze([...PENS, 'none']);
const PAPER = '#f7f3ea', INK = '#22252b';
// Strokes a second a hand can believably draw.
const RATE = 6;
const EASE = 'power1.inOut';
const SOFT = 0.5;
// How far the stage pushes in over the scene.
const PUSH = 1.1, KICK = 1.08;

const OBJECT_PARAM = `{object (drawn in detail: ${EDITORIAL_OBJECTS.join(', ')}; else a world-kit prop: bench, mug, …; else an icon name), icon? (the icon drawn when object is none of those)}`;

// --- Strokes from the art ---------------------------------------------------

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const num = v => (typeof v === 'number' ? v : 0);
const alphaOf = c => {
  const m = /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(String(c ?? ''));
  return m ? Number(m[1]) : 1;
};

/** A soft shape (a shadow, a tint) is coloured, never inked. */
function soft(node) {
  const a = node.attrs ?? {}, s = node.style ?? {};
  const fillNone = a.fill === undefined || a.fill === 'none';
  const strokeNone = a.stroke === undefined || a.stroke === 'none';
  if (fillNone && strokeNone) return true;
  const opacity = Number(a.opacity ?? s.opacity ?? 1);
  const fillOpacity = Number(a.fillOpacity ?? 1);
  return opacity < SOFT || (strokeNone && (fillOpacity < SOFT || alphaOf(a.fill) < SOFT));
}

/** Every stroke of a node list placed in a rect: [{points, closed, length, area}], px in the rect. */
export function strokesOf(nodes, {min = 2} = {}) {
  const out = [], seen = new Set();
  const visit = (node, x, y) => {
    if (!node || typeof node !== 'object') return;
    const st = node.style ?? {};
    const nx = x + num(st.left), ny = y + num(st.top);
    if (node.tag === 'svg') {
      for (const {node: shape, matrix} of walkShapes(node)) {
        if (soft(shape)) continue;
        for (const sub of shapeSubpaths(shape, mul([1, 0, 0, 1, nx, ny], matrix))) {
          const length = polylineLength(sub.points);
          if (length < min) continue;
          const b = bounds([sub.points]);
          // A tint and its outline share a shape: ink it once.
          const key = [b.x, b.y, b.width, b.height, length].map(v => Math.round(v / 2)).join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({points: sub.points, closed: sub.closed, length, area: sub.closed ? area(sub.points) : 0});
        }
      }
      return;
    }
    for (const child of node.children ?? []) visit(child, nx, ny);
  };
  for (const node of nodes) visit(node, 0, 0);
  return out;
}

/** Drawing order: the silhouette first, then each stroke that starts nearest to ink already down (reversed if its end is nearer). */
export function orderStrokes(strokes) {
  if (!strokes.length) return [];
  const rest = [...strokes];
  const firstAt = rest.reduce((best, s, i) => ((s.area || s.length * 0.01) > (rest[best].area || rest[best].length * 0.01) ? i : best), 0);
  const out = [rest.splice(firstAt, 1)[0]];
  const inked = [];
  const ink = s => { const step = Math.max(1, Math.floor(s.points.length / 24)); for (let i = 0; i < s.points.length; i += step) inked.push(s.points[i]); };
  const near = p => inked.reduce((best, q) => Math.min(best, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2), Infinity);
  ink(out[0]);
  while (rest.length) {
    let bi = 0, bd = Infinity, flip = false;
    rest.forEach((s, i) => {
      const a = near(s.points[0]), z = s.closed ? Infinity : near(s.points[s.points.length - 1]);
      if (a < bd) { bd = a; bi = i; flip = false; }
      if (z < bd) { bd = z; bi = i; flip = true; }
    });
    const s = rest.splice(bi, 1)[0];
    const next = flip ? {...s, points: [...s.points].reverse()} : s;
    out.push(next);
    ink(next);
  }
  return out;
}

/** Strokes timed over [t0, t0 + span]: kept to RATE a second (the longest kept), each timed by its length, with the pen's travel between. */
export function timeStrokes(strokes, t0, span) {
  if (!strokes.length) return [];
  const max = Math.max(1, Math.floor(span * RATE));
  let kept = strokes;
  if (strokes.length > max) {
    const keep = new Set([strokes[0], ...[...strokes.slice(1)].sort((a, b) => b.length - a.length).slice(0, max - 1)]);
    kept = strokes.filter(s => keep.has(s));
  }
  const travel = kept.length > 1 ? Math.min(0.12, (span * 0.25) / (kept.length - 1)) : 0;
  const drawTime = span - travel * (kept.length - 1);
  const weights = kept.map(s => s.length ** 0.6), total = weights.reduce((a, b) => a + b, 0);
  let t = t0;
  return kept.map((s, i) => {
    const duration = Math.max(0.04, drawTime * weights[i] / total);
    const out = {...s, at: rt(t), duration: rt(duration)};
    t += duration + travel;
    return out;
  });
}

// The paper reaches past the frame on every side, so the story's ambient drift and the kicks never show an edge.
const BLEED = 0.08;
const groundOf = (rect, canvas) => {
  const m = Math.max(canvas.width, canvas.height) * BLEED;
  return {x: r2(-rect.x - m), y: r2(-rect.y - m), width: r2(canvas.width + 2 * m), height: r2(canvas.height + 2 * m)};
};

// --- Model ------------------------------------------------------------------

function resolve(params, ctx) {
  const b = createHBase('hand-drawn', params, ctx, {allowed: ['subject', 'second', 'pen', 'barrel', 'text'], required: ['subject']});
  const {check, u, rect} = b;
  const p = b.params;
  const subject = objectSpec(check, p.subject, 'params.subject');
  const second = p.second === undefined ? null : objectSpec(check, p.second, 'params.second');
  const pen = p.pen === undefined ? 'marker' : check.oneOf(p.pen, 'params.pen', HAND_PENS);
  const barrel = p.barrel === undefined ? null : check.str(p.barrel, 'params.barrel', 24);
  if (barrel && pen === 'none') check.fail('params.barrel', 'is printed on the pen; give a pen');
  const text = p.text === undefined ? null : check.str(p.text, 'params.text', 32);

  // Layout: the line across the top, the objects side by side below it, low and large.
  const W = rect.width, H = rect.height;
  const band = text ? r2(H * 0.2) : 0;
  const objects = [subject, second].filter(Boolean);
  // Two objects stack in a tall frame and sit side by side in a wide one; each sits low in its slot.
  const n = objects.length, tall = H > W;
  const slotW = tall ? W : W / n, slotH = tall ? (H - band) / n : H - band;
  const boxes = objects.map((spec, i) => {
    const aspect = aspectOf(spec), maxW = slotW * 0.92, maxH = slotH * 0.88;
    const w = Math.min(maxW, maxH * aspect), h = w / aspect;
    const sx = tall ? 0 : slotW * i, sy = band + (tall ? slotH * i : 0);
    return {x: r2(sx + (slotW - w) / 2), y: r2(sy + (slotH - h) * 0.7), width: r2(w), height: r2(h)};
  });
  const textFit = text ? fitText(check, 'params.text', text, {family: 'display', width: W, preferred: r2(Math.min(u(96), band * 0.6)), min: b.min.key}) : null;

  // The art each object is drawn as (the illustration module's own drawing), and its strokes.
  const look = objectLook(b.colors, b.unit);
  const content = {colors: b.colors, look, accent: b.colors.accent, primary: b.colors.primary, bg: b.colors.bg, fg: INK, muted: b.theme.muted, seed: `${subject.object}|hand-drawn`};
  b.model.content = content;
  const art = objects.map((spec, i) => subjectNodes(b.model, spec, spec.drawn ? objectGeometry(spec.drawn, boxes[i], {days: 28}) : null, boxes[i], `${b.id}-o${i}`));

  // Timing: the pen comes in, each object is inked then coloured in turn, the drawing holds, the pen leaves.
  // The paper is there on frame 0 and the pen is already moving: no fade up from an empty frame.
  const penIn = rt(b.start);
  const begin = rt(penIn + 0.3);
  const holdFrom = rt(b.start + b.lastEvent - 0.2);
  const share = (holdFrom - begin) / objects.length;
  if (share < 1.2) check.fail('duration', `gives each object ${r2(share)} s to draw; a hand-drawn object needs at least 1.2 s: lengthen the scene or drop the second object`);
  const pieces = objects.map((spec, i) => {
    const t0 = rt(begin + share * i);
    const ink = r2(share * 0.6), colour = r2(share * 0.3);
    const all = strokesOf(art[i], {min: r2(3 * b.unit)});
    if (!all.length) check.fail(`params.${i ? 'second' : 'subject'}`, `"${spec.object}" has no lines to draw`);
    const strokes = timeStrokes(orderStrokes(all), t0, ink);
    const area = bounds(all.map(s => s.points));
    return {strokes, total: all.length, colourAt: rt(t0 + ink + 0.12), colour, area};
  });
  b.events.push({id: `${b.id}-draw`, name: 'draw', time: begin, endTime: rt(begin + share * 0.6), role: 'emphasis', cue: 'pen-scribble'});
  pieces.forEach((piece, i) => { const first = piece.strokes[0]; b.events.push({id: `${b.id}-outline-${i}`, name: `outline-${i}`, time: rt(first.at + first.duration), role: 'emphasis'}); });
  pieces.forEach((piece, i) => b.events.push({id: `${b.id}-colour-${i}`, name: `colour-${i}`, time: piece.colourAt, endTime: rt(piece.colourAt + piece.colour), role: 'emphasis', cue: 'pen-scribble'}));
  const doneAt = rt(pieces.at(-1).colourAt + pieces.at(-1).colour);

  Object.assign(content, {objects, boxes, pieces, pen, barrel, penIn, doneAt, inkWidth: r2((pen === 'none' ? PEN_INK.fountain : PEN_INK[pen]).width * b.unit), ink: INK,
    text: textFit ? {text, size: textFit.size} : null, ground: groundOf(rect, b.canvas)});
  // Paper cuts to paper: no fade through the background.
  b.motion.enterFrom = {opacity: 1, x: 0, y: 0, scale: 1};
  b.motion.exitTo = {opacity: 1, x: 0, y: 0, scale: 1};
  const model = b.finish(content, {minTextPx: textFit?.size ?? b.min.key});
  model.art = art;
  // The paper fills the frame like a picture (src/visual_density.js counts it as drawn, not footage).
  model.layout.parts = [{id: 'plate', role: 'media', rect: {x: 0, y: 0, width: b.canvas.width, height: b.canvas.height}, over: ['self']}];
  return model;
}

// --- View -------------------------------------------------------------------

function view(model) {
  const {id, fonts} = model;
  const c = model.content, G = c.ground;
  const W = model.rect.width, H = model.rect.height;
  const kids = [];
  c.pieces.forEach((piece, i) => {
    kids.push(el('div', `${id}-art-${i}`, abs(0, 0, W, H, {clipPath: 'inset(0% 0% 100% 0%)'}), model.art[i]));
    kids.push(el('div', null, abs(0, 0, W, H), [svgRoot(W, H, piece.strokes.map((s, k) => strokePath(`${id}-ink-${i}-${k}`, toPathD(s.points, s.closed), c.ink, c.inkWidth)))]));
  });
  // The line is on the page from frame 0, so the opening frame is never empty paper.
  if (c.text) kids.push(label(`${id}-line`, 0, r2((H * 0.2 - c.text.size * 1.2) / 2), W, c.text.text, {size: c.text.size, family: fonts.display, color: c.ink, align: 'center', weight: 700}));
  if (c.pen !== 'none') kids.push(penNode(`${id}-pen`, c.pen, {u: model.unit, ink: c.ink, body: c.primary, ...(c.barrel ? {barrel: {text: c.barrel}} : {}), family: fonts.body}));
  // The drawing sits on a stage that pushes in slowly through the scene, so the hold never freezes.
  return [el('div', `${id}-paper`, abs(G.x, G.y, G.width, G.height, {background: PAPER})), el('div', `${id}-kick`, abs(0, 0, W, H, {transformOrigin: '50% 50%'}), [el('div', `${id}-stage`, abs(0, 0, W, H, {transformOrigin: '50% 60%'}), kids)])];
}

// --- Timeline ---------------------------------------------------------------

/** Where the pen tip is at time t: on the stroke being drawn, travelling (lifted) between, zigzagging along the colour's edge. */
export function penPath(model) {
  const c = model.content, u = model.unit, lift = penTipLift(c.pen === 'none' ? 'marker' : c.pen) * u;
  const W = model.rect.width, H = model.rect.height;
  const off = [r2(W + 120 * u), r2(H + 80 * u)];
  const legs = [];
  // On frame 0 the pen is already on the page, low and to the right, on its way to the first line.
  let at = c.penIn, from = [r2(W * 0.78), r2(H * 0.86)];
  const travel = (to, t1, ease = EASE) => {
    const a = from, t0 = at;
    if (t1 > t0) legs.push({t0, t1, fn: t => { const s = progress(t, t0, t1 - t0, ease); return {x: a[0] + (to[0] - a[0]) * s, y: a[1] + (to[1] - a[1]) * s - lift * Math.sin(Math.PI * s), lifted: Math.sin(Math.PI * s)}; }});
    at = t1; from = to;
  };
  for (const piece of c.pieces) {
    for (const s of piece.strokes) {
      travel(s.points[0], s.at);
      const pts = s.points;
      legs.push({t0: s.at, t1: rt(s.at + s.duration), fn: t => { const [x, y] = pointAt(pts, progress(t, s.at, s.duration, EASE)); return {x, y, lifted: 0}; }});
      at = rt(s.at + s.duration); from = pts[pts.length - 1];
    }
    const A = piece.area, zigs = Math.max(3, Math.round(A.height / (c.inkWidth * 9)));
    const zig = (t) => {
      const s = progress(t, piece.colourAt, piece.colour, 'none'), w = (s * zigs) % 2;
      return {x: A.x + A.width * (w < 1 ? w : 2 - w), y: A.y + A.height * s, lifted: 0};
    };
    travel([A.x, A.y], piece.colourAt);
    legs.push({t0: piece.colourAt, t1: rt(piece.colourAt + piece.colour), fn: zig});
    at = rt(piece.colourAt + piece.colour);
    const end = zig(at); from = [end.x, end.y];
  }
  // The pen leaves slowly through the rest of the scene, so the finished drawing never sits still.
  travel(off, rt(Math.max(at + 0.6, model.end - 0.05)), 'power2.in');
  return {legs, from: c.penIn, to: at};
}

function timeline(model, ops) {
  const {id, start} = model;
  const c = model.content, H = model.rect.height;
  set(ops, `${id}-stage`, start, {scaleX: 1, scaleY: 1});
  tw(ops, `${id}-stage`, start, rt(model.end - start), 'none', {scaleX: 1, scaleY: 1}, {scaleX: PUSH, scaleY: PUSH});
  // A camera kick as each colour pass starts: in 8% and back, slow → fast → slow, no overshoot.
  set(ops, `${id}-kick`, start, {scaleX: 1, scaleY: 1});
  for (const piece of c.pieces) {
    tw(ops, `${id}-kick`, piece.colourAt, 0.3, 'power2.inOut', {scaleX: 1, scaleY: 1}, {scaleX: KICK, scaleY: KICK});
    tw(ops, `${id}-kick`, rt(piece.colourAt + 0.3), 0.7, 'power2.inOut', {scaleX: KICK, scaleY: KICK}, {scaleX: 1, scaleY: 1});
  }
  c.pieces.forEach((piece, i) => {
    for (const [k, s] of piece.strokes.entries()) drawOps(ops, `${id}-ink-${i}-${k}`, start, s.at, s.duration, EASE);
    // The colour is uncovered from the art's top to its bottom, then the whole layer opens (soft shadows outside the lines).
    const top = r2(100 * (1 - piece.area.y / H)), bottom = r2(Math.max(0, 100 * (1 - (piece.area.y + piece.area.height) / H)));
    set(ops, `${id}-art-${i}`, start, {clipT: 0, clipR: 0, clipB: 100, clipL: 0});
    set(ops, `${id}-art-${i}`, piece.colourAt, {clipT: 0, clipR: 0, clipB: top, clipL: 0});
    tw(ops, `${id}-art-${i}`, piece.colourAt, piece.colour, 'none', {clipT: 0, clipR: 0, clipB: top, clipL: 0}, {clipT: 0, clipR: 0, clipB: bottom, clipL: 0});
    set(ops, `${id}-art-${i}`, rt(piece.colourAt + piece.colour), {clipT: 0, clipR: 0, clipB: 0, clipL: 0});
  });
  if (c.pen === 'none') return;
  const path = penPath(model), pid = `${id}-pen`;
  const legAt = t => path.legs.find(leg => t <= leg.t1 + 1e-9) ?? path.legs.at(-1);
  set(ops, pid, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1});
  set(ops, pid, path.from, {opacity: 1});
  for (const sample of frameSamples(path.from, path.to, model.fps, t => legAt(t).fn(t))) {
    const k = r2(1 + 0.05 * sample.lifted);
    set(ops, pid, sample.t, {x: r2(sample.x), y: r2(sample.y), scaleX: k, scaleY: k});
  }
  set(ops, pid, rt(path.to + 0.01), {opacity: 0});
}

export const handDrawn = {
  id: 'hand-drawn',
  describe: `An illustration drawn on by hand, whiteboard-explainer style: a pen inks the object's outline stroke by stroke (silhouette first, inner lines growing out of drawn ones), then colours it in, on a paper plate. One object, or two side by side drawn one after the other (${EDITORIAL_OBJECTS.join(', ')} drawn in detail; else a world-kit prop, or an icon at hero scale). An optional line of free type across the top, and a brand or sponsor name on the pen's barrel. For an explainer's opening or a concept that is easier to watch being drawn than to read.`,
  params: {subject: `${OBJECT_PARAM} the object drawn first`, second: `${OBJECT_PARAM} optional: drawn beside it, after it`, pen: `${HAND_PENS.join(' | ')} (default marker): the pen that draws, none for lines with no pen`,
    barrel: 'string ≤ 24 (optional): a brand or sponsor name printed on the pen', text: 'string ≤ 32, one line of free type across the top (optional; the caption usually says it)'},
  events: ['draw', 'outline-0', 'colour-0', 'outline-1', 'colour-1'], timing: timingRules({rules: ['the pen draws from 0.35 s after the entrance; each object gets an equal share: 60% ink, 30% colour', 'at most 6 strokes a second; the shortest strokes past that arrive with the colour', 'the drawing holds 0.6 s before the exit']}), variants: ['default'],
  resolve, view, timeline
};
