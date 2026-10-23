// Catalogue D: product-demo, a recorded product flow (demo autopilot,
// src/demo/record.js) edited by its own action log. Contract:
// docs/KIT_CONTRACTS.md ("Product demo").
//
//   product-demo   the flow's clip in a window (or full bleed), a camera that
//                  zooms to each clicked or typed-into element's bounding box,
//                  an accent outline as each action lands, callout pills as
//                  features appear, and click / keystroke / whoosh / pop SFX
//                  events on the action times.
//
// Same conventions as catalogue C (kit/core/catalog-c.mjs): resolve(params,
// ctx) → a JSON-only model; productDemoView(model) is the static element tree
// both renderers draw, productDemoTimeline(model) the renderer-neutral op
// list. The view has two roots: `media` (the <video>, which HyperFrames hoists
// to the composition root, because it only seeks root media) and `overlay`
// (highlights and callouts, drawn above the video; the story compiler hoists
// it too, one z-index above).
//
// Camera. Zooms are pure functions of time: cameraKeys() turns the actions
// into keyframes {t, s, f} (scale and the canvas point to centre), cameraAt()
// eases between them (log-space scale, easeInOutSine, the focus kept inside
// the clamp), and cameraTransform() turns a state into {scale, x, y} for a
// transform about the canvas origin, clamped so the zoomed video never pulls
// away from the canvas edge it already covers. One sample per frame becomes a tl.set-style op on both the
// video and the overlay's camera layer, so seeking is safe and both renderers
// read the same numbers.

import {contrastRatio, fitText, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, sampleTime, set, tw} from './catalog-b-view.mjs';
import {createFootageBase} from './catalog-c.mjs';
import {grammarTweens} from './grammar.mjs';

export const PRODUCT_DEMO_TIMING = Object.freeze({
  minDuration: 2,
  leadOut: 0.2,
  // The camera starts zoomLead before an action and settles `settle` before
  // it, so the click lands on a still frame.
  zoomLead: 1.2,
  zoomIn: 0.8,
  settle: 0.4,
  // A move between targets takes pan..panMax s by its on-screen distance.
  pan: 0.6,
  panMax: 1.1,
  // No camera move is shorter than this, however close the actions are, and
  // actions closer than `cluster` share one shot that frames them all.
  minMove: 0.45,
  cluster: 0.8,
  hold: 1.1,
  zoomOut: 0.9,
  merge: 2.2,
  // After a click that changes the page, the camera, outline and callout
  // leave this soon: what they framed is gone.
  navLeave: 0.3,
  callout: 2.2,
  // A click's callout shows this long before the click.
  calloutLead: 0.6,
  fade: 0.3
});
const T = PRODUCT_DEMO_TIMING;
const ACTION_TYPES = ['click', 'type', 'focus'];
const FRAMES = ['window', 'full'];
const ZOOM_FILL = 0.5;

// easeInOutSine: still at both ends, and at most 1.6× the average speed
// (easeInOutCubic peaks at 3×, which reads as a lurch mid-zoom).
const ease = p => (1 - Math.cos(Math.PI * p)) / 2;

// ---------------------------------------------------------------------------
// Zoom math (pure; unit-tested in test/product_demo.test.js)

/** A box in recording viewport px → canvas px inside the video rect. */
export function mapBox(box, rect, viewport) {
  const kx = rect.width / viewport.width, ky = rect.height / viewport.height;
  return {x: r2(rect.x + box.x * kx), y: r2(rect.y + box.y * ky), width: r2(box.width * kx), height: r2(box.height * ky)};
}

/** Zoom that makes a canvas box fill at most `fill` of the canvas, within [1, max]. */
export function zoomScale(box, canvas, {max = 1.8, fill = ZOOM_FILL} = {}) {
  const want = Math.min((fill * canvas.width) / Math.max(1, box.width), (fill * canvas.height) / Math.max(1, box.height));
  return Math.round(Math.min(max, Math.max(1, want)) * 1e4) / 1e4;
}

/**
 * Camera state {s, f} → {scale, x, y}: p' = s·p + (x, y) on canvas px, with the
 * focus f moved to the canvas centre and then clamped per axis. When the
 * scaled video is at least the canvas size on an axis it keeps covering the
 * canvas; when it is smaller it stays fully on screen.
 */
export function cameraTransform({s, f}, rect, canvas) {
  const axis = (pos, size, focus, full) => {
    const want = full / 2 - s * focus;
    const a = -s * pos, b = full - s * (pos + size);
    return Math.min(Math.max(want, Math.min(a, b)), Math.max(a, b));
  };
  const x = axis(rect.x, rect.width, f.x, canvas.width), y = axis(rect.y, rect.height, f.y, canvas.height);
  return {scale: Math.round(s * 1e5) / 1e5, x: r2(x) || 0, y: r2(y) || 0};
}

const sameBox = (a, b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
const same = (a, b) => Math.abs(a.s - b.s) < 1e-6 && Math.abs(a.f.x - b.f.x) < 1e-6 && Math.abs(a.f.y - b.f.y) < 1e-6;

/**
 * A move from target a to b: its length (longer for a longer on-screen
 * travel) and, when the two are far apart at their zoom, the scale to pull
 * back to halfway, so the move reads as a dolly rather than a whip pan.
 */
function moveBetween(a, b, canvas) {
  const span = Math.max(Math.abs(b.f.x - a.f.x) / canvas.width, Math.abs(b.f.y - a.f.y) / canvas.height);
  const d = T.pan + (T.panMax - T.pan) * Math.min(1, span * Math.max(a.s, b.s));
  // Pull back at most 60% of the way to 1 (in log scale): deeper reads as a zoom-out and back.
  const low = Math.min(a.s, b.s), dip = Math.max(low ** 0.4, Math.min(low, 0.7 / Math.max(span, 1e-6)));
  return {d, dip: dip < low - 0.02 ? Math.round(dip * 1e4) / 1e4 : null};
}

/**
 * Targets closer than T.cluster to the previous one merge into one target
 * that frames them all: the first one's time, the last one's until and
 * navigation, the centre of their foci and a scale no closer than any of
 * them, pulled back so their foci stay in the middle 60% of the canvas.
 */
function clusterTargets(targets, canvas) {
  const groups = [];
  for (const target of targets) {
    const group = groups.at(-1);
    if (group && target.at - group.at(-1).at < T.cluster) group.push(target);
    else groups.push([target]);
  }
  return groups.map(group => {
    if (group.length === 1) return group[0];
    const xs = group.map(t => t.f.x), ys = group.map(t => t.f.y), last = group.at(-1);
    const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
    const s = Math.max(1, Math.min(...group.map(t => t.s), (0.6 * canvas.width) / Math.max(dx, 1), (0.6 * canvas.height) / Math.max(dy, 1)));
    return {at: group[0].at, until: Math.max(...group.map(t => t.until ?? t.at)), navigates: Boolean(last.navigates), s: Math.round(s * 1e4) / 1e4,
      f: {x: r2((Math.max(...xs) + Math.min(...xs)) / 2), y: r2((Math.max(...ys) + Math.min(...ys)) / 2)}};
  });
}

/**
 * Keyframes for a list of zoom targets [{at, until?, navigates?, s, f}]
 * (absolute seconds, sorted): {t, s, f, dip?} with identity {s: 1, f: centre}
 * outside the shots; `dip` on a key pulls the move into it back to that
 * scale halfway. Each zoom starts T.zoomLead before its action and settles
 * T.settle before it. The camera stays on a target for T.hold (through any
 * typing), or T.navLeave after a click that navigates, then moves straight to
 * the next target, unless the gap is long (T.merge, or room to zoom out and
 * back in after a navigation): then it zooms out and back in. Close actions
 * squeeze moves, never below T.minMove, so a move may land just after its
 * action. Every shot zooms out by `end` when there is room (otherwise it
 * holds and the scene's fade covers it).
 */
export function cameraKeys(targets, {start, end, centre, canvas = {width: centre.x * 2, height: centre.y * 2}}) {
  const wide = {s: 1, f: centre};
  const keys = [{t: start, s: 1, f: {...centre}}];
  const key = (t, state, dip) => keys.push({t: rt(t), s: state.s, f: {...state.f}, ...(dip ? {dip} : {})});
  const leaveOf = target => (target.navigates ? target.at + T.navLeave : Math.max(target.at + T.hold, (target.until ?? target.at) + 0.4));
  let shot = null;
  const zoomOut = from => {
    const outStart = Math.max(keys.at(-1).t, Math.min(from, end - T.zoomOut));
    if (end - outStart < T.minMove) return;
    if (outStart > keys.at(-1).t) key(outStart, shot);
    key(Math.min(end, outStart + T.zoomOut), wide);
    shot = null;
  };
  for (const target of clusterTargets(targets, canvas)) {
    const arrive = target.at - T.settle;
    if (target.at > end - 0.3) break;
    if (target.s <= 1.02) {
      // A cluster too spread out to zoom into: be wide by the time it starts.
      if (shot) zoomOut(Math.max(shot.at + 0.1, Math.min(leaveOf(shot), arrive - T.zoomOut)));
      continue;
    }
    if (shot && arrive - leaveOf(shot) >= (shot.navigates ? T.zoomOut + T.zoomIn + 0.2 : T.merge)) zoomOut(leaveOf(shot));
    if (shot) {
      const {d, dip} = moveBetween(shot, target, canvas);
      // After a navigation the move fills the gap (up to panMax + 0.3 s) and pulls all the way out.
      const length = shot.navigates ? Math.min(T.panMax + 0.3, Math.max(d, arrive - leaveOf(shot))) : d;
      const moveStart = Math.max(keys.at(-1).t, shot.at + 0.1, arrive - length);
      // Rather than whip across, a tight move may land just after its action.
      const moveEnd = Math.max(arrive, moveStart + T.minMove, Math.min(moveStart + length, target.at + 0.15));
      if (moveEnd > end - 0.3) break;
      // A squeezed move pulls back less, so it never whips the scale.
      const pull = shot.navigates ? 1 : dip;
      const low = Math.min(shot.s, target.s), squeeze = Math.min(1, (moveEnd - moveStart) / Math.max(d, length));
      if (moveStart > keys.at(-1).t) key(moveStart, shot);
      key(moveEnd, target, pull && Math.round(low * (pull / low) ** squeeze * 1e4) / 1e4);
    } else {
      const inStart = Math.max(keys.at(-1).t, target.at - T.zoomLead);
      const inEnd = Math.max(arrive, inStart + T.minMove);
      if (inEnd > end - 0.3) break;
      if (inStart > keys.at(-1).t) key(inStart, wide);
      key(inEnd, target);
    }
    shot = target;
  }
  if (shot) zoomOut(leaveOf(shot));
  return keys;
}

// The focus range on one axis that cameraTransform leaves unclamped at scale s.
function focusRange(s, pos, size, full) {
  const a = -s * pos, b = full - s * (pos + size);
  return [(full / 2 - Math.max(a, b)) / s, (full / 2 - Math.min(a, b)) / s];
}
const toUnit = (s, value, pos, size, full) => {
  const [lo, hi] = focusRange(s, pos, size, full);
  return hi - lo < 1e-6 ? 0.5 : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
};
const fromUnit = (s, unit, pos, size, full) => {
  const [lo, hi] = focusRange(s, pos, size, full);
  return lo + unit * (hi - lo);
};

/**
 * Camera state at absolute time t: {s, f}, eased between keyframes
 * (easeInOutSine; scale in log space, dipping when the key asks). With
 * `view` ({rect, canvas}) the focus travels inside the range cameraTransform
 * allows at each scale, so a move never stops dead against the clamp.
 */
export function cameraAt(keys, t, view) {
  if (t <= keys[0].t) return {s: keys[0].s, f: {...keys[0].f}};
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t > b.t) continue;
    const span = b.t - a.t;
    const p = span <= 0 ? 1 : ease((t - a.t) / span);
    let logS = Math.log(a.s) * (1 - p) + Math.log(b.s) * p;
    if (b.dip) logS -= Math.max(0, (Math.log(a.s) + Math.log(b.s)) / 2 - Math.log(b.dip)) * Math.sin(Math.PI * p);
    const s = Math.max(1, Math.exp(logS));
    if (!view) return {s, f: {x: a.f.x + (b.f.x - a.f.x) * p, y: a.f.y + (b.f.y - a.f.y) * p}};
    const {rect, canvas} = view;
    const axis = (k, pos, size, full) => fromUnit(s, toUnit(a.s, a.f[k], pos, size, full) * (1 - p) + toUnit(b.s, b.f[k], pos, size, full) * p, pos, size, full);
    return {s, f: {x: axis('x', rect.x, rect.width, canvas.width), y: axis('y', rect.y, rect.height, canvas.height)}};
  }
  const last = keys.at(-1);
  return {s: last.s, f: {...last.f}};
}

/** When the camera starts to leave `state` at or after t (null when it never does). */
export function cameraLeaves(keys, state, t) {
  for (let i = 0; i + 1 < keys.length; i++) if (keys[i].t >= t - 1e-6 && same(keys[i], state) && !same(keys[i + 1], state)) return keys[i].t;
  return null;
}

/** One camera sample per frame from start to end: [{t, scale, x, y}]. */
export function cameraSamples(keys, {start, end, fps, rect, canvas}) {
  const out = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let frame = first; frame <= last; frame++) {
    const t = frame / fps;
    out.push({t: rt(t), ...cameraTransform(cameraAt(keys, t, {rect, canvas}), rect, canvas)});
  }
  return out;
}

/** Map a canvas point through a camera transform. */
export const throughCamera = (point, cam) => ({x: point.x * cam.scale + cam.x, y: point.y * cam.scale + cam.y});

// ---------------------------------------------------------------------------
// Action log → params (used by the CLI and the skills)

/**
 * A demo/<flow>.actions.json record → product-demo params for a scene that
 * shows the clip from `sourceStart` for `duration` seconds. Actions outside
 * the window are dropped; times become scene-relative. A click or typing
 * that leaves the page on another URL than before it is marked navigates.
 */
export function productDemoParams(record, {src, sourceStart = 0, duration, frame, zoom, title} = {}) {
  const window = duration ?? record.duration - sourceStart;
  const rel = t => Math.round((t - sourceStart) * 1000) / 1000;
  const actions = [];
  const callouts = [];
  let url = null;
  for (const action of record.actions ?? []) {
    const before = url;
    url = action.url ?? url;
    const at = rel(action.at ?? action.start);
    if (!ACTION_TYPES.includes(action.type) && !(action.callout && action.box)) continue;
    if (at < 0 || at > window - T.leadOut) continue;
    if (ACTION_TYPES.includes(action.type) && action.box) {
      const entry = {at, type: action.type, box: action.box};
      if (action.type === 'type' && action.keys?.length) {
        entry.keys = action.keys.map(rel).filter(t => t >= 0 && t <= window - 0.05).slice(0, 40);
        entry.until = entry.keys.at(-1) ?? at;
      }
      if (action.label) entry.label = String(action.label).slice(0, 40);
      if (before && action.url && action.url !== before) entry.navigates = true;
      actions.push(entry);
    }
    if (action.callout && action.box && callouts.length < 4) {
      // A click's or typing's callout shows as the cursor reaches the element;
      // anything else's once it has appeared.
      const lead = ACTION_TYPES.includes(action.type) ? Math.max(0, at - T.calloutLead) : rel(action.end ?? action.at ?? action.start) - 0.25;
      const cAt = Math.min(lead, window - 1.2);
      if (cAt >= 0) callouts.push({at: Math.round(cAt * 1000) / 1000, text: String(action.callout).slice(0, 42), box: action.box});
    }
  }
  const params = {media: {src: src ?? `assets/demo/${record.video}`, sourceStart}, viewport: {width: record.viewport.width, height: record.viewport.height}, actions};
  if (callouts.length) params.callouts = callouts;
  if (frame) params.frame = frame;
  if (zoom !== undefined) params.zoom = zoom;
  if (title) params.title = title;
  return params;
}

// ---------------------------------------------------------------------------
// Resolve

const box = (check, value, path, viewport) => {
  check.obj(value, path, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
  const out = {};
  for (const [key, max] of [['x', viewport.width], ['y', viewport.height], ['width', viewport.width], ['height', viewport.height]]) out[key] = check.num(value[key], `${path}.${key}`, key === 'width' || key === 'height' ? 1 : -max, max);
  return out;
};

function localVideo(check, value, path) {
  if (typeof value !== 'string' || !value.startsWith('assets/') || value.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(value) || !/\.(mp4|webm|mov)$/i.test(value)) check.fail(path, `must be a project-local assets/ video (.mp4, .webm or .mov); got ${JSON.stringify(value)}`);
  return value;
}

function resolveProductDemo(params, ctx) {
  // Brands without accent/ink still resolve: accent falls back to primary.
  const colors = {...(ctx?.brand?.colors ?? {})};
  colors.accent = colors.accent ?? colors.primary;
  colors.ink = colors.ink ?? '#0b0d12';
  const b = createFootageBase('product-demo', params, {...ctx, brand: {...(ctx?.brand ?? {}), colors}}, {allowed: ['media', 'viewport', 'actions', 'callouts', 'frame', 'zoom', 'title'], required: ['media', 'actions'], minDuration: T.minDuration});
  const {check, canvas, safe, fps, start, end, duration, u, unit} = b;
  const p = b.params;
  check.obj(p.media, 'params.media', ['src', 'sourceStart'], ['src']);
  const media = {kind: 'video', src: localVideo(check, p.media.src, 'params.media.src'), sourceStart: p.media.sourceStart === undefined ? 0 : check.num(p.media.sourceStart, 'params.media.sourceStart', 0, 3600)};
  const viewport = p.viewport === undefined ? {width: 1920, height: 1080} : (check.obj(p.viewport, 'params.viewport', ['width', 'height'], ['width', 'height']), {width: check.int(p.viewport.width, 'params.viewport.width', 320, 7680), height: check.int(p.viewport.height, 'params.viewport.height', 240, 4320)});
  const frame = p.frame === undefined ? 'window' : check.oneOf(p.frame, 'params.frame', FRAMES);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  let zoomMax = 1.8;
  if (p.zoom === false) zoomMax = 1;
  else if (p.zoom !== undefined) { check.obj(p.zoom, 'params.zoom', ['max']); if (p.zoom.max !== undefined) zoomMax = check.num(p.zoom.max, 'params.zoom.max', 1, 2.5); }

  // Video rect: full bleed, or the recording's aspect fitted in the safe zone.
  const aspect = viewport.width / viewport.height;
  let rect;
  if (frame === 'full') {
    if (Math.abs(aspect - canvas.width / canvas.height) > 0.02) check.fail('params.frame', `"full" needs a recording with the canvas aspect (${canvas.width}×${canvas.height}); this one is ${viewport.width}×${viewport.height}. Use "window"`);
    rect = {x: 0, y: 0, width: canvas.width, height: canvas.height};
  } else {
    // The whole safe zone: captions may sit over the bottom of the window.
    const zone = b.zone;
    const width = Math.min(zone.width, zone.height * aspect), height = width / aspect;
    rect = {x: r2(zone.x + (zone.width - width) / 2), y: r2(zone.y + (zone.height - height) / 2), width: r2(width), height: r2(height)};
  }
  const radius = frame === 'full' ? 0 : u(18);
  const centre = {x: canvas.width / 2, y: canvas.height / 2};

  // Actions: absolute times, canvas boxes and zoom targets.
  check.arr(p.actions, 'params.actions', 0, 24);
  let previousAt = -Infinity;
  const actions = p.actions.map((action, index) => {
    const path = `params.actions[${index}]`;
    check.obj(action, path, ['at', 'type', 'box', 'keys', 'until', 'label', 'navigates']);
    const at = check.num(action.at, `${path}.at`, 0, duration - T.leadOut);
    if (at < previousAt) check.fail(`${path}.at`, 'must not be earlier than the previous action');
    previousAt = at;
    const type = check.oneOf(action.type, `${path}.type`, ACTION_TYPES);
    const canvasBox = mapBox(box(check, action.box, `${path}.box`, viewport), rect, viewport);
    // A scene cut short mid-typing keeps the keystrokes it shows: later ones are dropped and until is clamped.
    const keys = action.keys === undefined ? [] : check.arr(action.keys, `${path}.keys`, 0, 40).map((value, k) => check.num(value, `${path}.keys[${k}]`, 0, 3600)).filter(value => value <= duration).map(value => rt(start + value));
    const until = action.until === undefined ? null : rt(start + Math.min(check.num(action.until, `${path}.until`, at, 3600), duration));
    const label = action.label === undefined ? null : check.str(action.label, `${path}.label`, 40);
    const navigates = action.navigates === undefined ? false : check.bool(action.navigates, `${path}.navigates`);
    const s = zoomScale(canvasBox, canvas, {max: zoomMax});
    const f = {x: r2(canvasBox.x + canvasBox.width / 2), y: r2(canvasBox.y + canvasBox.height / 2)};
    return {index, type, at: rt(start + at), until, keys, label, navigates, box: canvasBox, s, f};
  });

  const keys = cameraKeys(zoomMax > 1 ? actions.filter(action => action.s > 1.02) : [], {start, end, centre, canvas});
  const samples = cameraSamples(keys, {start, end, fps, rect, canvas});
  const camAt = t => cameraTransform(cameraAt(keys, t, {rect, canvas}), rect, canvas);

  // Callouts: pills beside their anchor as seen through the camera.
  const callouts = [];
  if (p.callouts !== undefined) {
    check.arr(p.callouts, 'params.callouts', 0, 4);
    const ink = contrastRatio(colors.ink, colors.primary) >= contrastRatio(colors.paper, colors.primary) ? colors.ink : colors.paper;
    b.requireContrast('callout/primary', ink, colors.primary, 'callout text on brand.colors.primary');
    let lastEnd = -Infinity;
    p.callouts.forEach((callout, index) => {
      const path = `params.callouts[${index}]`;
      check.obj(callout, path, ['at', 'text', 'box', 'duration']);
      const at = rt(start + check.num(callout.at, `${path}.at`, 0, duration - 1));
      if (at < lastEnd - 1e-6) check.fail(`${path}.at`, `overlaps the previous callout (it shows until ${r2(lastEnd - start)} s)`);
      const text = check.str(callout.text, `${path}.text`, 42);
      const anchor = mapBox(box(check, callout.box, `${path}.box`, viewport), rect, viewport);
      const wanted = callout.duration === undefined ? T.callout : check.num(callout.duration, `${path}.duration`, 0.8, 6);
      if (Math.min(at + wanted, end - T.leadOut) - at < 0.8) check.fail(`${path}.at`, `leaves ${r2(Math.min(at + wanted, end - T.leadOut) - at)} s on screen before the scene ends; it needs 0.8 s`);
      // The action it points at: the first one on the same element from just
      // before the callout to 1.5 s after it. The callout leaves with that
      // element: when the click navigates, or when the camera moves off it.
      const owner = actions.find(action => action.at >= at - 0.3 && action.at <= at + 1.5 && sameBox(action.box, anchor));
      let until = Math.min(at + wanted, end - T.leadOut);
      if (owner?.navigates) until = Math.min(until, owner.at + T.navLeave);
      const leaves = owner && cameraLeaves(keys, owner, owner.at - T.zoomLead);
      if (leaves !== null && leaves !== undefined && leaves > at) until = Math.min(until, leaves + 0.1);
      until = rt(Math.max(until, Math.min(at + 0.5, end - T.leadOut)));
      const fit = fitText(check, `${path}.text`, text, {family: 'body', width: safe.width - u(80), preferred: Math.max(b.min.key, u(46)), min: b.min.key, maxLines: 1});
      const padX = u(30), padY = u(18);
      const width = r2(textWidth(text, fit.size, 'body') + padX * 2), height = r2(fit.size * 1.2 + padY * 2);
      // Where the anchor will be once the camera settles on it (0.45 s in, or the action's moment).
      const cam = camAt(owner ? Math.min(Math.max(owner.at, at), until) : Math.min(at + 0.45, until));
      const tl = throughCamera(anchor, cam), br = throughCamera({x: anchor.x + anchor.width, y: anchor.y + anchor.height}, cam);
      const seen = {x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y};
      const gap = u(28);
      const x = Math.min(Math.max(seen.x + seen.width / 2 - width / 2, safe.x), safe.x + safe.width - width);
      const below = seen.y + seen.height + gap, above = seen.y - gap - height;
      const bottom = b.band.y - u(24);
      const y = below + height <= bottom ? below : above >= safe.y ? above : Math.min(Math.max(seen.y + seen.height / 2 - height / 2, safe.y), bottom - height);
      callouts.push({index, at, until, text, size: fit.size, padX, padY, box: {x: r2(x), y: r2(y), width, height}, ink, fill: colors.primary, radius: r2(height / 2)});
      lastEnd = until;
    });
  }

  // SFX events on the action log.
  for (const action of actions) {
    if (action.type === 'click') b.events.push({id: `${b.id}-click-${action.index}`, name: `click-${action.index}`, time: action.at, endTime: rt(action.at + 0.12), role: 'action', cue: 'click'});
    action.keys.forEach((time, k) => b.events.push({id: `${b.id}-key-${action.index}-${k}`, name: `key-${action.index}-${k}`, time, endTime: rt(time + 0.08), role: 'beat', cue: 'keystroke-soft'}));
  }
  for (let k = 0; k + 1 < keys.length; k++) {
    if (keys[k].s === 1 && keys[k + 1].s >= 1.3) b.events.push({id: `${b.id}-zoom-${k}`, name: `zoom-${k}`, time: keys[k].t, endTime: keys[k + 1].t, role: 'move', cue: 'whoosh-soft'});
  }
  for (const callout of callouts) b.events.push({id: `${b.id}-callout-${callout.index}`, name: `callout-${callout.index}`, time: callout.at, endTime: rt(callout.at + 0.4), role: 'emphasis', cue: 'pop'});

  b.model.camera = null;
  const content = {media, viewport, frame, title, rect, radius, shadow: frame === 'full' ? 'none' : `0 ${u(30)}px ${u(80)}px #00000080`,
    accent: colors.accent, stroke: r2(Math.max(3, 4 * unit)), pad: u(10),
    actions: actions.map(({index, type, at, until, label, navigates, box: canvasBox, s}) => ({index, type, at, until, label, navigates, box: canvasBox, s})),
    keys, samples, callouts};
  return b.finish(content, {rect, role: 'media', minTextPx: callouts.length ? Math.min(...callouts.map(c => c.size)) : null,
    motion: {enterEnd: rt(start + T.fade), exitStart: rt(end - T.fade), enterFrom: {opacity: 0}, exitTo: {opacity: 0}}});
}

// ---------------------------------------------------------------------------
// View and timeline

/** Element trees: {media, overlay}. media is the <video>; overlay holds the camera layer and callouts. */
export function productDemoView(model) {
  const {id, canvas} = model;
  const c = model.content, R = c.rect;
  const media = el('video', `${id}-media`, abs(R.x, R.y, R.width, R.height, {objectFit: 'fill', borderRadius: c.radius, boxShadow: c.shadow, background: '#000000',
    opacity: 0, transformOrigin: `${r2(-R.x)}px ${r2(-R.y)}px`}), [], {src: c.media.src, muted: '', playsinline: ''});
  const highlights = c.actions.filter(action => action.type !== 'focus').map(action => {
    const B = action.box, P = c.pad;
    return el('div', `${id}-hl-${action.index}`, abs(B.x - P, B.y - P, B.width + P * 2, B.height + P * 2, {boxSizing: 'border-box', border: `${c.stroke}px solid ${c.accent}`, borderRadius: model.unit * 14,
      boxShadow: `0 0 0 ${model.unit * 6}px ${c.accent}33`, opacity: 0, transformOrigin: '50% 50%'}));
  });
  const cam = el('div', `${id}-cam`, abs(0, 0, canvas.width, canvas.height, {transformOrigin: '0px 0px'}), highlights);
  const pills = c.callouts.map(callout => el('div', `${id}-callout-${callout.index}`, abs(callout.box.x, callout.box.y, callout.box.width, callout.box.height, {
    boxSizing: 'border-box', padding: `${callout.padY}px ${callout.padX}px`, borderRadius: callout.radius, background: callout.fill, color: callout.ink,
    fontFamily: model.fonts.body, fontWeight: 700, fontSize: callout.size, lineHeight: '1.2', whiteSpace: 'nowrap', textAlign: 'center',
    boxShadow: `0 ${model.unit * 14}px ${model.unit * 36}px #00000066`, opacity: 0, transformOrigin: '50% 50%'}), [callout.text]));
  const overlay = el('div', `${id}-overlay`, abs(0, 0, canvas.width, canvas.height, {opacity: 0, pointerEvents: 'none', overflow: 'hidden'}), [cam, ...pills]);
  return {media, overlay};
}

/** Renderer-neutral ops: fades on both roots, per-frame camera on the video and the camera layer, highlights, callouts. */
export function productDemoTimeline(model) {
  const {id, start, end} = model;
  const c = model.content, m = model.motion;
  const ops = [];
  for (const target of [`${id}-media`, `${id}-overlay`]) {
    set(ops, target, start, {opacity: 0});
    tw(ops, target, start, m.enterDuration, 'power2.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, m.exitStart, m.exitDuration, 'power2.in', {opacity: 1}, {opacity: 0});
    set(ops, target, end, {opacity: 0});
  }
  let previous = null;
  for (const sample of c.samples) {
    const props = {x: sample.x, y: sample.y, scaleX: sample.scale, scaleY: sample.scale};
    const key = `${sample.x},${sample.y},${sample.scale}`;
    if (key === previous) continue;
    previous = key;
    for (const target of [`${id}-media`, `${id}-cam`]) ops.push({type: 'set', target, time: Math.max(0, sampleTime(sample.t)), props});
  }
  for (const action of c.actions.filter(entry => entry.type !== 'focus')) {
    const target = `${id}-hl-${action.index}`;
    // After a navigation the outline goes with the page it was drawn on.
    const out = rt(Math.min(end - 0.05, action.navigates ? action.at + T.navLeave - 0.15 : Math.max(action.at + 0.9, (action.until ?? action.at) + 0.3)));
    const fade = action.navigates ? 0.15 : 0.35;
    set(ops, target, start, {opacity: 0, scaleX: 1.12, scaleY: 1.12});
    tw(ops, target, action.at, Math.max(0.04, Math.min(0.28, out - action.at)), 'power3.out', {opacity: 0, scaleX: 1.12, scaleY: 1.12}, {opacity: 1, scaleX: 1, scaleY: 1});
    tw(ops, target, out, Math.max(0.04, Math.min(fade, end - out)), 'power2.in', {opacity: 1, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: 1, scaleY: 1});
  }
  for (const callout of c.callouts) {
    const target = `${id}-callout-${callout.index}`;
    set(ops, target, start, {opacity: 0, y: model.unit * 18, scaleX: 0.9, scaleY: 0.9});
    tw(ops, target, callout.at, 0.4, 'back.out(1.7)', {opacity: 0, y: model.unit * 18, scaleX: 0.9, scaleY: 0.9}, {opacity: 1, y: 0, scaleX: 1, scaleY: 1});
    // A short callout (cut at a navigation) fades once it has popped in.
    const fadeAt = rt(Math.max(callout.at + 0.4, callout.until - 0.25));
    tw(ops, target, fadeAt, Math.max(0.1, rt(callout.until - fadeAt)), 'power2.in', {opacity: 1, y: 0, scaleX: 1, scaleY: 1}, {opacity: 0, y: 0, scaleX: 0.96, scaleY: 0.96});
  }
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}

const DEFINITIONS = [
  {id: 'product-demo', describe: 'A recorded product flow (launchclip demo record) in a window or full bleed, with zooms to each clicked or typed-into element, accent outlines as actions land, callout pills and click/keystroke SFX, all timed from the flow\'s action log.',
    params: {
      media: '{src: "assets/demo/<flow>.mp4", sourceStart: seconds into the clip (default 0)}',
      viewport: '{width, height} of the recording in CSS px (default 1920×1080; from <flow>.actions.json)',
      actions: '[{at (s from scene start), type: click|type|focus, box: {x, y, width, height} viewport px, keys?: [s], until?: s, label?, navigates?: true when it changes the page}] ≤ 24 — build with productDemoParams(<flow>.actions.json)',
      callouts: '[{at, text ≤ 42 chars, box (the element it points at), duration? 0.8–6 s (default 2.2)}] ≤ 4, not overlapping; one on an action\'s box ends when that action navigates or the camera leaves it',
      frame: 'window|full (full needs the canvas aspect; default window)',
      zoom: 'false, or {max: 1–2.5 (default 1.8)}',
      title: 'string ≤ 48 (optional, for logs)'
    },
    events: ['click-<i>', 'key-<i>-<k>', 'zoom-<k>', 'callout-<i>']}
];

const TIMING_D = {
  'product-demo': {minDuration: T.minDuration, leadIn: 0, leadOut: T.leadOut, gaps: [],
    rules: [`actions[].at: in order; zooms start ${T.zoomLead} s before each action and settle ${T.settle} s before it, hold ${T.hold} s (${T.navLeave} s after a click that navigates), and pan to the next action unless the gap is over ${T.merge} s`, `callouts[].at ≤ scene − 1 s; each shows ${T.callout} s by default, must not overlap the next, and ends when its action navigates or the camera leaves it`]}
};

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: TIMING_D[def.id], resolve: resolveProductDemo}]));
