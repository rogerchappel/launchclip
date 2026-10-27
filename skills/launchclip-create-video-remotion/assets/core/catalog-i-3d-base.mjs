// Catalogue I base: rendered 3D objects for the element library, drawn with
// CSS 3D transforms (no WebGL, per the portable-module rule in
// docs/DUAL_RENDERER_PLAN.md), so HyperFrames and Remotion paint the same
// planes from the same view tree and op list (catalogue H's conventions;
// kit/core/catalog-h.mjs).
//
// The rig, outermost first:
//
//   cam    2D zoom and pan of the flattened render (animated: x, y, scale)
//   stage  `perspective` P px, perspective-origin at the pivot
//   tilt   static rotateX(T): the floor leans back, the camera looks down
//          at (90 − T)°; the pivot is the floor's origin
//   turn   rotation θ about the world vertical (animated: the orbit)
//   slot   one object's floor point (left/top; animated x, y slide it)
//   stand  static rotateX(−90deg): a vertical plane through the floor point.
//          Inside it x is world x, −y is up and +z is toward the viewer, so a
//          box is the classic CSS cube and scaleY on a child grows it up.
//
// Every animated element is a pure 2D transform (the op props catalogue B
// already has), so the orbit is the `turn` rotation, a bar grows by scaleY
// inside its stand and a label faces the camera by counter-rotating with the
// turn ("billboard"). Nothing between the stage and a face carries opacity,
// filter, clip or overflow (each would flatten the 3D context): fades are on
// leaf faces and labels only.
//
// project() is the same transform chain in plain JS, so a module fits its
// scene into the rect over the whole orbit and sizes its text from the
// projected scale, and the tests check the frame without a browser.

import {fitText, r2, rt, titleBlock} from './catalog-h-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {abs, el, set, tw} from './catalog-h-view.mjs';
import {mixColor} from './catalog-b-base.mjs';

const RAD = Math.PI / 180;
const PRESERVE = {transformStyle: 'preserve-3d'};
const POINT = (x, y, extra = {}) => abs(x, y, 0, 0, {...PRESERVE, ...extra});

// ---------------------------------------------------------------------------
// Params and events shared by the modules

/** Text sizes round up, so a size over a projected scale never dips under its floor. */
export const up2 = v => Math.ceil(v * 100 - 1e-9) / 100;
export const at3d = 'seconds from scene start (optional; else a matching hit, else a default)';
export const rect3d = '{x, y, width, height} canvas px inside the safe zone (optional)';
export const ORBIT_PARAM = 'degrees the camera orbits over the scene, 0–30 (optional; 0 holds it still)';

/** Default event time `fallback` (scene-relative) clamped into the module's window, then timeOf. */
export function cueTime(b, name, value, path, fallback, min) {
  return b.timeOf(name, value, path, Math.max(min, Math.min(fallback, b.lastEvent)), {min: Math.max(0, min - 1e-6)});
}

/** An item index from an integer or a label (params.highlight: 2 or "Terra"). */
export function itemIndex(check, value, path, items) {
  if (typeof value === 'string') {
    const i = items.findIndex(item => item.label === value);
    return i >= 0 ? i : check.fail(path, `must be an index or one of the labels (${items.map(item => JSON.stringify(item.label)).join(', ')})`);
  }
  return check.int(value, path, 0, items.length - 1);
}

/** The orbit sweep (deg) from params.orbit, centred on `heading` (deg; negative looks from the left). */
export function orbitOf(check, value, fallback, heading = 0) {
  const o = value === undefined ? fallback : check.num(value, 'params.orbit', 0, 30);
  return [heading - o / 2, heading + o / 2];
}

/** The chrome block (title and source) and the scene box under it. */
export function sceneBox(b, p) {
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = b.rect.width, H = b.rect.height;
  return {tb, W, H, top: tb.top, avail: r2(H - tb.top - tb.bottom), centre: {x: W / 2, y: tb.top + (H - tb.top - tb.bottom) / 2}};
}

// ---------------------------------------------------------------------------
// Camera and projection

/**
 * A camera for a rect: {tilt T (deg), perspective P (px), orbit [θ0, θ1]
 * (deg), zoom [z0, z1], pivot {x, y} (rect px)}. pivot is set by fitScene.
 */
export function camera({tilt = 64, perspective = 2600, orbit = [-7, 7], zoom = [1, 1], pan = [[0, 0], [0, 0]]} = {}) {
  return {tilt, perspective, orbit: [...orbit], zoom: [...zoom], pan: pan.map(p => [...p]), pivot: {x: 0, y: 0}};
}

/**
 * Screen position (rect px) of floor point (x, y) at height z, at turn θ
 * (deg) and zoom/pan, plus the local magnification s (P / (P − depth)).
 */
export function project(cam, [x, y, z], theta = 0, zoom = 1, pan = [0, 0], centre = null) {
  const c = Math.cos(theta * RAD), s = Math.sin(theta * RAD);
  const xr = x * c - y * s, yr = x * s + y * c;
  const T = cam.tilt * RAD;
  const Y = yr * Math.cos(T) - z * Math.sin(T);
  const Z = yr * Math.sin(T) + z * Math.cos(T);
  const m = cam.perspective / (cam.perspective - Z);
  const px = cam.pivot.x + xr * m, py = cam.pivot.y + Y * m;
  const o = centre ?? cam.pivot;
  return {x: o.x + (px - o.x) * zoom + pan[0], y: o.y + (py - o.y) * zoom + pan[1], s: m * zoom};
}

/** The camera states the fit must hold: the orbit ends and middle at the zoom range's ends. */
export function cameraStates(cam) {
  const [a, b] = cam.orbit;
  const out = [];
  for (const theta of [a, (a + b) / 2, b]) for (const k of [0, 1]) out.push({theta, zoom: cam.zoom[k], pan: cam.pan[k]});
  return out;
}

/**
 * Fit a scene into W × H: `build(k)` returns {points: [[x,y,z]], labels:
 * [{at: [x,y,z], w, h, ax, ay}]} for world scale k (labels are screen px
 * boxes anchored at ax, ay ∈ [0, 1] of their box). Returns {k, pivot,
 * bounds}: the largest k (≤ kMax) whose projection stays inside the rect at
 * every camera state, centred.
 */
export function fitScene(cam, W, H, build, {kMax = 4, margin = 0, centre = null} = {}) {
  const boundsAt = (k) => {
    const scene = build(k);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const states = cameraStates(cam);
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const st of states) {
      for (const p of scene.points) { const q = project(cam, p, st.theta, st.zoom, st.pan, cam.zoomCentre); add(q.x, q.y); }
      for (const l of scene.labels ?? []) {
        const q = project(cam, l.at, st.theta, st.zoom, st.pan, cam.zoomCentre);
        add(q.x - l.w * l.ax * q.s, q.y - l.h * l.ay * q.s);
        add(q.x + l.w * (1 - l.ax) * q.s, q.y + l.h * (1 - l.ay) * q.s);
      }
    }
    return {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0};
  };
  const aw = W - 2 * margin, ah = H - 2 * margin;
  cam.pivot = {x: 0, y: 0};
  cam.zoomCentre = {x: 0, y: 0};
  let k = 1;
  for (let i = 0; i < 12; i++) {
    const b = boundsAt(k);
    const ratio = Math.min(aw / b.w, ah / b.h);
    k = Math.min(kMax, k * (ratio > 1 ? ratio ** 0.85 : ratio));
  }
  for (let i = 0; i < 40; i++) {
    const b = boundsAt(k);
    if (b.w <= aw + 1e-6 && b.h <= ah + 1e-6) break;
    k *= 0.985;
  }
  // Centre: the pivot (and the zoom centre with it) shifts the whole frame.
  const cx = centre?.x ?? W / 2, cy = centre?.y ?? H / 2;
  for (let i = 0; i < 3; i++) {
    const b = boundsAt(k);
    cam.pivot = {x: cam.pivot.x + cx - (b.x0 + b.x1) / 2, y: cam.pivot.y + cy - (b.y0 + b.y1) / 2};
    cam.zoomCentre = {...cam.pivot};
  }
  cam.pivot = {x: r2(cam.pivot.x), y: r2(cam.pivot.y)};
  cam.zoomCentre = {...cam.pivot};
  return {k, bounds: boundsAt(k)};
}

/** The smallest screen magnification of a world point over the camera states. */
export function minScale(cam, point) {
  return Math.min(...cameraStates(cam).map(st => project(cam, point, st.theta, st.zoom, st.pan, cam.zoomCentre).s));
}

/** Screen height of a world-vertical unit at a point (front faces): sin T × magnification, the smallest over the camera states. */
export function faceScale(cam, point) {
  return Math.min(...cameraStates(cam).map(st => {
    const a = project(cam, point, st.theta, st.zoom, st.pan, cam.zoomCentre);
    const b = project(cam, [point[0], point[1], point[2] + 1], st.theta, st.zoom, st.pan, cam.zoomCentre);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }));
}

/** Screen length of a world-x unit at a point (text across a front face), the smallest over the camera states. */
export function faceWidthScale(cam, point) {
  return Math.min(...cameraStates(cam).map(st => {
    const a = project(cam, point, st.theta, st.zoom, st.pan, cam.zoomCentre);
    const b = project(cam, [point[0] + 1, point[1], point[2]], st.theta, st.zoom, st.pan, cam.zoomCentre);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }));
}

// ---------------------------------------------------------------------------
// Rig nodes and ops

/** The rig: cam → stage → tilt → turn, with `floor` nodes in floor coords. */
export function rigNodes(id, cam, W, H, floor, {behind = [], front = []} = {}) {
  const {x: px, y: py} = cam.pivot;
  const turn = el('div', `${id}-turn`, POINT(0, 0, {transformOrigin: '0px 0px'}), floor);
  const tilt = el('div', null, POINT(px, py, {transform: `rotateX(${cam.tilt}deg)`, transformOrigin: '0px 0px'}), [turn]);
  const stage = el('div', null, abs(0, 0, W, H, {perspective: cam.perspective, perspectiveOrigin: `${px}px ${py}px`}), [tilt]);
  return el('div', `${id}-cam`, abs(0, 0, W, H, {transformOrigin: `${px}px ${py}px`}), [...behind, stage, ...front]);
}

/** Orbit and zoom ops over [t0, t1]; every billboard target counter-rotates with the turn. */
export function rigOps(ops, id, cam, start, t0, t1, billboards = [], {ease = 'sine.inOut'} = {}) {
  const [a, b] = cam.orbit;
  set(ops, `${id}-turn`, start, {rotation: a});
  for (const target of billboards) set(ops, target, start, {rotation: -a});
  if (a !== b) {
    tw(ops, `${id}-turn`, t0, rt(t1 - t0), ease, {rotation: a}, {rotation: b});
    for (const target of billboards) tw(ops, target, t0, rt(t1 - t0), ease, {rotation: -a}, {rotation: -b});
  }
  const [z0, z1] = cam.zoom, [p0, p1] = cam.pan;
  set(ops, `${id}-cam`, start, {x: p0[0], y: p0[1], scaleX: z0, scaleY: z0});
  if (z0 !== z1 || p0[0] !== p1[0] || p0[1] !== p1[1]) tw(ops, `${id}-cam`, t0, rt(t1 - t0), ease, {x: p0[0], y: p0[1], scaleX: z0, scaleY: z0}, {x: p1[0], y: p1[1], scaleX: z1, scaleY: z1});
}

/** One object's floor point; `id` set when the slot moves (slide-outs). */
export function slot(id, x, y, kids) {
  return el('div', id, POINT(r2(x), r2(y), {transformOrigin: '0px 0px'}), kids);
}

/** A vertical plane through the slot: x right, −y up, +z toward the viewer. */
export function stand(kids, id = null) {
  return el('div', id, POINT(0, 0, {transform: 'rotateX(-90deg)', transformOrigin: '0px 0px'}), kids);
}

/** A moving group inside a stand (scaleY grows it from the floor; y drops it). */
export function group(id, kids, {x = 0, y = 0} = {}) {
  return el('div', id, POINT(r2(x), r2(y), {transformOrigin: '0px 0px'}), kids);
}

/**
 * The faces of a box in stand coords: w wide (x centred), h tall standing on
 * height e (−y), d deep (z centred). styles: {front, back, left, right, top,
 * bottom} → style or null (skipped); kids: {front: [...], top: [...]}.
 */
export function boxFaces(prefix, {w, h, d, e = 0, x = 0}, styles, kids = {}) {
  const y0 = r2(-(e + h)), x0 = r2(x - w / 2);
  const face = (name, box, transform) => {
    const style = styles[name];
    if (!style) return null;
    return el('div', prefix ? `${prefix}-${name}` : null, abs(box[0], box[1], box[2], box[3], {transform, boxSizing: 'border-box', ...style}), kids[name] ?? []);
  };
  return [
    face('back', [x0, y0, r2(w), r2(h)], `translateZ(${r2(-d / 2)}px) rotateY(180deg)`),
    face('bottom', [x0, r2(-e - d / 2), r2(w), r2(d)], 'rotateX(-90deg)'),
    face('left', [r2(x0 - d / 2), y0, r2(d), r2(h)], 'rotateY(-90deg)'),
    face('right', [r2(x0 + w - d / 2), y0, r2(d), r2(h)], 'rotateY(90deg)'),
    face('top', [x0, r2(y0 - d / 2), r2(w), r2(d)], 'rotateX(90deg)'),
    face('front', [x0, y0, r2(w), r2(h)], `translateZ(${r2(d / 2)}px)`)
  ].filter(Boolean);
}

/**
 * The side facets and top/bottom discs of an upright cylinder in stand
 * coords (radius r, height h, on height e): n facets.
 */
export function cylinderFaces(prefix, {r, h, e = 0, n = 14}, {side, top, bottom = null}) {
  const out = [];
  const wFacet = r2(2 * r * Math.sin(Math.PI / n) + 0.6);
  const inset = r2(r * Math.cos(Math.PI / n));
  const y0 = r2(-(e + h));
  for (let i = 0; i < n; i++) {
    const a = r2((360 / n) * i);
    const style = typeof side === 'function' ? side(i, a) : side;
    out.push(el('div', null, abs(r2(-wFacet / 2), y0, wFacet, r2(h), {transform: `rotateY(${a}deg) translateZ(${inset}px)`, ...style})));
  }
  if (bottom) out.push(el('div', null, abs(r2(-r), r2(-e - r), r2(2 * r), r2(2 * r), {transform: 'rotateX(-90deg)', borderRadius: '50%', ...bottom})));
  if (top) out.push(el('div', prefix ? `${prefix}-top` : null, abs(r2(-r), r2(y0 - r), r2(2 * r), r2(2 * r), {transform: 'rotateX(90deg)', borderRadius: '50%', boxSizing: 'border-box', ...top})));
  return out;
}

/**
 * A billboard: a screen-parallel plane at floor point (x, y), height z, that
 * counter-rotates with the turn (target `${id}`). `kids` are laid out in a
 * w × h box anchored at (ax, ay) of the box (0.5, 1: bottom centre on the point).
 */
export function billboard(id, cam, [x, y, z], {w, h, ax = 0.5, ay = 1}, kids) {
  const face = el('div', null, abs(r2(-w * ax), r2(-h * ay), r2(w), r2(h), {transform: `translateZ(${r2(z)}px) rotateX(${-cam.tilt}deg)`, transformOrigin: `${r2(w * ax)}px ${r2(h * ay)}px`}), kids);
  return el('div', null, POINT(r2(x), r2(y)), [el('div', id, POINT(0, 0, {transformOrigin: '0px 0px'}), [face])]);
}

/** A flat floor decal (shadow, glow, grid) centred on (x, y), in floor coords. */
export function decal(id, x, y, w, h, style) {
  return el('div', id, abs(r2(x - w / 2), r2(y - h / 2), r2(w), r2(h), style));
}

// ---------------------------------------------------------------------------
// Glass

/**
 * Glass materials from the style roles: the fill tone (a hex) and the rim
 * (the accent mixed toward paper). Returns per-face styles {front, back,
 * left, right, top, bottom}. strength 0–1 (1: a highlighted, glowing bar).
 */
export function glassFaces(theme, tone, u, {strength = 0.5, rim = null, glow = 0} = {}) {
  const rimColor = rim ?? mixColor(theme.accent, theme.paper, 0.35);
  const a = v => Math.max(0, Math.min(1, v));
  const fill = (top, bottom) => `linear-gradient(180deg, ${hex2(tone, a(top))} 0%, ${hex2(tone, a(bottom))} 100%)`;
  const line = r2(Math.max(1, 1.6 * u));
  const halo = glow > 0 ? `, 0 0 ${r2(46 * u * glow)}px ${hex2(tone, a(0.55 * glow))}` : '';
  const edge = alpha => `${line}px solid ${hex2(rimColor, a(alpha))}`;
  const inner = alpha => `inset 0 0 ${r2(22 * u)}px ${hex2(tone, a(alpha))}`;
  return {
    front: {background: fill(0.22 + 0.5 * strength, 0.08 + 0.3 * strength), border: edge(0.55 + 0.4 * strength), boxShadow: `${inner(0.25 + 0.4 * strength)}${halo}`},
    back: {background: fill(0.1 + 0.2 * strength, 0.04 + 0.1 * strength), border: edge(0.25)},
    left: {background: fill(0.12 + 0.35 * strength, 0.04 + 0.2 * strength), border: edge(0.4 + 0.3 * strength), boxShadow: inner(0.18 + 0.3 * strength)},
    right: {background: fill(0.14 + 0.35 * strength, 0.05 + 0.2 * strength), border: edge(0.4 + 0.3 * strength), boxShadow: inner(0.18 + 0.3 * strength)},
    top: {background: `linear-gradient(135deg, ${hex2(theme.paper, a(0.18 + 0.2 * strength))} 0%, ${hex2(tone, a(0.3 + 0.45 * strength))} 60%, ${hex2(tone, a(0.18 + 0.3 * strength))} 100%)`, border: edge(0.7 + 0.3 * strength), boxShadow: `${inner(0.3 + 0.4 * strength)}${halo}`},
    bottom: null
  };
}

/** A soft glow pool on the floor under the scene (a radial gradient decal). */
export function floorGlow(id, tone, x, y, w, h, alpha = 0.32) {
  return decal(id, x, y, w, h, {borderRadius: '50%', background: `radial-gradient(closest-side, ${hex2(tone, alpha)} 0%, ${hex2(tone, alpha * 0.4)} 55%, ${hex2(tone, 0)} 100%)`});
}

/** A faint floor grid (lines every `step` px) fading out at the edges. */
export function floorGrid(id, color, x, y, w, h, step, u, alpha = 0.22) {
  const line = r2(Math.max(1, 1.4 * u));
  const c = hex2(color, alpha);
  return decal(id, x, y, w, h, {
    backgroundImage: `linear-gradient(${c} ${line}px, transparent ${line}px), linear-gradient(90deg, ${c} ${line}px, transparent ${line}px)`,
    backgroundSize: `${r2(step)}px ${r2(step)}px`, backgroundPosition: 'center center',
    maskImage: 'radial-gradient(closest-side, #000 35%, transparent 100%)', WebkitMaskImage: 'radial-gradient(closest-side, #000 35%, transparent 100%)'
  });
}

/** fitText with the preferred size never below the minimum (projected sizes can dip under it). */
export function fitSize(check, path, text, opts) {
  return fitText(check, path, text, {...opts, preferred: Math.max(opts.preferred, Math.ceil(opts.min))});
}

