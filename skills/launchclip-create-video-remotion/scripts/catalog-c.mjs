// Catalogue C: footage-led modules (RFC §3 footage-led lane, §5 punch-in and
// callout). Contract: docs/KIT_CONTRACTS.md ("Footage-led lane").
//
//   punch-in          word-timed zoom on the base recording (a camera, not an overlay)
//   zoom-through      rush into a cut and burst out of the next take (a camera)
//   footage-callout   claim sticker anchored to a point on the footage by a leader line
//   lower-third       name and title bar above the caption band
//   emphasis-caption  big word-pop over the footage; hides the captions
//   masthead          one huge word behind the presenter's head (layer behind)
//   dolly-zoom        the room plate pushes in behind a still presenter
//
// (`callout` is already an editorial kind, a text card, so the anchored
// sticker is `footage-callout`.)
//
// Same conventions as catalogue B (kit/core/catalog-b.mjs): MODULES[id].resolve
// (params, ctx) → a JSON-only model; catalogCView(model) is the static element
// tree both renderers draw (HyperFrames serialises it, Remotion renders it as
// React elements), and catalogCTimeline(model) is the renderer-neutral op list
// (GSAP tl.set/tl.fromTo on one side, frameState() on the other). Times are
// absolute seconds; params give them as seconds from the scene start (`at`),
// and a story hit whose event matches a module event name times that event
// when params do not.
//
// Camera. A module that moves the base carries `model.camera`:
//   {target: "base", focus: {x, y} (canvas px), scale, punchAt, releaseAt,
//    samples: [{t, scale, x, y}]}   one sample per frame over the scene.
// The samples scale the full-frame base about `focus` (transform-origin at
// the canvas centre, so x = (1 - s)(fx - W/2), y = (1 - s)(fy - H/2)); with
// s ≥ 1 the scaled frame always covers the canvas. cameraOps(models) merges
// every camera into one op list on the BASE_CAMERA target: HyperFrames sets
// it on each root base <video>, Remotion on the base layer wrapper. The spring
// is integrated per frame by motion.mjs springValue, so the samples are a pure
// function of time and seeking is safe.
//
// Hard rules (RFC §5): boxes inside the Shorts safe zone (or landscape
// title-safe zone) and above the caption band unless the module hides
// captions; key text at least 44 px at 1080 (scaled by min(width, height) /
// 1080); every text/fill pair at least 3:1 (throws otherwise); no blur.

import {formatBound, withinBounds} from './bounds.mjs';
import {motionBlurPx, springValue} from './motion.mjs';
import {grammarEase, grammarStagger, grammarTweens} from './grammar.mjs';
import {CATALOG_B_STYLE, contrastRatio, fitText, makeCheck, mixColor, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, sampleTime, set, svgRoot, transformString, tw} from './catalog-b-view.mjs';
import {profileGeometry} from './layout-check.mjs';

export const BASE_CAMERA = 'lc-base-camera';
export const CAMERA_IDENTITY = Object.freeze({x: 0, y: 0, scaleX: 1, scaleY: 1});
export const PUNCH_SPRING = Object.freeze({in: {damping: 16, stiffness: 170}, out: {damping: 22, stiffness: 220, overshootClamping: true}});

const ROLE_NAMES = ['primary', 'accent', 'paper'];
const FONT_FALLBACK = {
  display: "Impact,'Arial Narrow Bold','Arial Black',sans-serif",
  body: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  meta: "ui-monospace,'SF Mono',Menlo,Consolas,monospace"
};
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const at = 'seconds from scene start (optional; else a matching hit, else a default)';

function fontStack(name, role, check, path) {
  if (name === undefined) return FONT_FALLBACK[role];
  if (typeof name !== 'string' || !/^[a-zA-Z0-9 -]{1,40}$/.test(name)) check.fail(path, 'must be a font name of letters, digits, spaces or hyphens');
  const family = name.split(/[-\s]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
  return `'${family}',${FONT_FALLBACK[role]}`;
}

// ---------------------------------------------------------------------------
// Shared base (catalogue B's createBase, with shorter minimum durations, a
// full-canvas root and footage-aware context)

export function createFootageBase(moduleId, params, ctx, {allowed, required = [], hidesCaptions = false, minDuration = 1.5}) {
  if (!ctx || typeof ctx !== 'object') throw new Error(`${moduleId}: ctx is required`);
  const id = ctx.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,59}$/.test(id)) throw new Error(`${moduleId}: ctx.id must be a lowercase DOM-safe id`);
  const prefix = `${id} (${moduleId}): `;
  const check = makeCheck(prefix);
  check.obj(params ?? {}, 'params', allowed, required);
  params = params ?? {};
  const format = ctx.format ?? {};
  const width = check.int(format.width, 'format.width', 240, 7680), height = check.int(format.height, 'format.height', 240, 7680);
  const fps = check.num(format.fps ?? 30, 'format.fps', 1, 120);
  const start = check.num(ctx.start, 'start', 0, 86400), duration = check.num(ctx.duration, 'duration', minDuration, 3600);
  const canvas = {width, height};
  const portrait = height > width;
  const unit = Math.min(width, height) / 1080;
  const u = v => r2(v * unit);

  const colorsIn = ctx.brand?.colors ?? {};
  const colors = {};
  for (const key of ['bg', 'primary', 'accent', 'ink', 'paper']) {
    if (!HEX6.test(colorsIn[key] ?? '')) check.fail(`brand.colors.${key}`, 'must be a six-digit hex colour');
    colors[key] = colorsIn[key].toLowerCase();
  }
  const fontsIn = ctx.brand?.fonts ?? {};
  const fonts = {display: fontStack(fontsIn.display, 'display', check, 'brand.fonts.display'), body: fontStack(fontsIn.body, 'body', check, 'brand.fonts.body'), meta: fontStack(fontsIn.meta, 'meta', check, 'brand.fonts.meta')};
  const theme = {surface: colors.bg, foreground: colors.paper, muted: mixColor(colors.paper, colors.bg, 0.62), border: mixColor(colors.paper, colors.bg, 0.18), accentText: colors.ink,
    primary: colors.primary, accent: colors.accent, ink: colors.ink, paper: colors.paper, bg: colors.bg, panel: mixColor(colors.paper, colors.bg, 0.06)};
  const contrast = {};
  const requireContrast = (name, fg, bg, label) => {
    const ratio = contrastRatio(fg, bg);
    contrast[name] = Math.round(ratio * 100) / 100;
    if (ratio < 3) check.fail(label, `has contrast ${ratio.toFixed(2)}:1 (${fg} on ${bg}); text needs at least 3:1`);
    return ratio;
  };
  const resolveColor = (value, path, fallback, on, onLabel) => {
    const raw = value ?? fallback;
    let hex;
    if (ROLE_NAMES.includes(raw)) hex = colors[raw];
    else if (typeof raw === 'string' && HEX6.test(raw)) hex = raw.toLowerCase();
    else check.fail(path, `must be ${ROLE_NAMES.join(', ')} or a six-digit hex colour`);
    requireContrast(`${path}/${onLabel}`, hex, on, `${path} (${raw}) on ${onLabel}`);
    return hex;
  };

  const geometry = profileGeometry(canvas, portrait ? 'shorts' : 'landscape');
  const zone = geometry.safeZone, band = geometry.captionBand;
  const bottom = hidesCaptions ? zone.y + zone.height : Math.min(zone.y + zone.height, band.y - 30 * unit);
  const up = v => Math.ceil(v * 100 - 1e-6) / 100, down = v => Math.floor(v * 100 + 1e-6) / 100;
  const sx = up(zone.x), sy = up(zone.y);
  const safe = {x: sx, y: sy, width: r2(down(zone.x + zone.width) - sx), height: r2(down(bottom) - sy)};

  const end = rt(start + duration);
  const hits = Array.isArray(ctx.hits) ? ctx.hits.filter(hit => hit && typeof hit.event === 'string' && typeof hit.at === 'number') : [];
  /** Absolute time for event `name`: params `at` (scene-relative) > ctx hit > fallback (scene-relative). */
  const timeOf = (name, value, path, fallback, {min = 0, max = duration} = {}) => {
    let rel;
    if (value !== undefined) rel = check.num(value, path, 0, duration);
    else {
      const hit = hits.find(entry => entry.event === name);
      rel = hit ? hit.at - start : fallback;
    }
    if (!withinBounds(rel, min, max)) check.fail(value !== undefined ? path : `${path} (default for "${name}")`, `must fall between ${formatBound(min)} s and ${formatBound(max)} s after the scene start; got ${r2(rel)} s${value === undefined ? ' — lengthen the scene or set it explicitly' : ''}`);
    return rt(start + rel);
  };
  const min = {key: Math.ceil(CATALOG_B_STYLE.minKeyText * unit * 100 - 1e-6) / 100, meta: Math.ceil(CATALOG_B_STYLE.minMetaText * unit * 100 - 1e-6) / 100};
  const events = [];
  const model = {id, module: moduleId, canvas, aspect: ctx.aspect ?? (portrait ? '9:16' : '16:9'), fps, unit: r2(unit), start: rt(start), duration: rt(duration), end, track: 2,
    rect: {x: 0, y: 0, width, height}, safe, motion: null, content: null, events, layout: null, hidesCaptions, theme, fonts, contrast, objects: {}, minTextPx: null};
  /** motion: {enterStart?, enterEnd, exitStart, exitDuration?, enterFrom?, exitTo?, enterEase?, exitEase?, origin?}. */
  const finish = (content, {rect, role = 'text', minTextPx = null, motion}) => {
    const enterFrom = {opacity: 1, x: 0, y: 0, scale: 1, ...(motion.enterFrom ?? {})};
    const exitTo = {opacity: 0, x: 0, y: 0, scale: 1, ...(motion.exitTo ?? {})};
    const exitStart = rt(motion.exitStart);
    model.motion = {enterStart: rt(motion.enterStart ?? start), enterEnd: rt(motion.enterEnd), exitStart, end, enterDuration: rt(motion.enterEnd - (motion.enterStart ?? start)), exitDuration: rt(end - exitStart),
      enterFrom, exitTo, enterEase: grammarEase(ctx.grammar, motion.enterEase ?? 'power3.out'), exitEase: grammarEase(ctx.grammar, motion.exitEase ?? 'power2.in'), origin: motion.origin ?? {x: r2(width / 2), y: r2(height / 2)}};
    model.content = content;
    model.rect = {...rect};
    model.minTextPx = minTextPx;
    if (minTextPx !== null && minTextPx + 1e-9 < min.key) throw new Error(`${prefix}key text ${minTextPx}px is below ${min.key}px`);
    model.events.sort((a, b) => a.time - b.time);
    model.layout = {canvas, rect: {...rect}, motion: {enterEnd: model.motion.enterEnd, exitStart, end}, role, minTextPx, hidesCaptions};
    return model;
  };
  return {id, check, params, canvas, portrait, unit, u, fps, start, duration, end, safe, zone, band, colors, theme, fonts, requireContrast, resolveColor, timeOf, min, events, model, finish};
}

const fraction = (check, value, path, low = 0, high = 1) => {
  check.obj(value, path, ['x', 'y'], ['x', 'y']);
  return {x: check.num(value.x, `${path}.x`, low, high), y: check.num(value.y, `${path}.y`, low, high)};
};

// ---------------------------------------------------------------------------
// punch-in: a spring zoom on the base toward a focus point

// Each step springs from the previous scale to its own (in: a zoom-in step,
// out: a zoom-out step); the release springs whatever is left back to 1.
function punchScale(t, {steps, releaseAt, fps}) {
  let s = 1, previous = 1;
  for (const step of steps) {
    if (t < step.at - 1e-9) break;
    const spring = step.scale >= previous ? PUNCH_SPRING.in : PUNCH_SPRING.out;
    s += (step.scale - previous) * springValue(t, {start: step.at, fps, ...spring});
    previous = step.scale;
  }
  const pout = t < releaseAt - 1e-9 ? 0 : springValue(t, {start: releaseAt, fps, ...PUNCH_SPRING.out});
  return Math.max(1, 1 + (s - 1) * (1 - pout));
}

// Velocity-shaped zoom blur (motion.mjs motionBlurPx): the speed of the frame
// edge, so a step or release blurs for a few frames and settles to 0.
function punchBlur(s, previous, {half, max}) {
  return r2(motionBlurPx(Math.abs(s - previous) * half, {max, shutter: 0.5}));
}

function resolvePunchIn(params, ctx) {
  const b = createFootageBase('punch-in', params, ctx, {allowed: ['scale', 'at', 'focus', 'release', 'steps', 'blur'], minDuration: CATALOG_C_TIMING['punch-in'].minDuration});
  const {check, canvas, fps, start, end, duration} = b;
  const p = b.params;
  const baseFocus = ctx.base?.focus && Number.isFinite(ctx.base.focus.x) && Number.isFinite(ctx.base.focus.y) ? ctx.base.focus : {x: 0.5, y: 0.42};
  const focusIn = p.focus === undefined ? baseFocus : fraction(check, p.focus, 'params.focus');
  const release = p.release === undefined ? Math.min(0.5, r2(duration * 0.3)) : check.num(p.release, 'params.release', 0.3, 2);
  const latest = duration - release - CATALOG_C_TIMING['punch-in'].releaseHold;
  let steps;
  if (p.steps !== undefined) {
    if (p.at !== undefined || p.scale !== undefined) check.fail('params.steps', 'replaces at and scale; set either steps or at/scale');
    if (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > 4) check.fail('params.steps', 'must be 1–4 steps [{at, scale}]');
    steps = p.steps.map((step, i) => {
      check.obj(step, `params.steps[${i}]`, ['at', 'scale'], ['at', 'scale']);
      return {at: b.timeOf(`step-${i}`, step.at, `params.steps[${i}].at`, 0, {min: 0, max: latest}), scale: check.num(step.scale, `params.steps[${i}].scale`, 1, 1.35)};
    });
    steps.forEach((step, i) => {
      if (i && step.at - steps[i - 1].at < CATALOG_C_TIMING['punch-in'].stepGap - 1e-6) check.fail(`params.steps[${i}].at`, `must be at least ${CATALOG_C_TIMING['punch-in'].stepGap} s after the step before it`);
      if (i && Math.abs(step.scale - steps[i - 1].scale) < 0.03) check.fail(`params.steps[${i}].scale`, 'must differ from the step before it by at least 0.03');
    });
    if (steps[0].scale < 1.06) check.fail('params.steps[0].scale', 'must zoom in (1.06 or more)');
  } else {
    const scale = p.scale === undefined ? 1.12 : check.num(p.scale, 'params.scale', 1.06, 1.25);
    steps = [{at: b.timeOf('punch', p.at, 'params.at', 0, {min: 0, max: latest}), scale}];
  }
  const blurMax = p.blur === undefined || p.blur === false ? 0 : p.blur === true ? b.u(14) : check.num(p.blur, 'params.blur', 2, 30);
  const punchAt = steps[0].at;
  const scale = Math.max(...steps.map(step => step.scale));
  const releaseAt = rt(end - release);
  if (releaseAt - steps.at(-1).at < 0.25 - 1e-6) check.fail('params.release', `leaves ${r2(releaseAt - steps.at(-1).at)} s between the last step and the release; it needs 0.25 s`);
  const focus = {x: r2(focusIn.x * canvas.width), y: r2(focusIn.y * canvas.height)};
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const half = Math.hypot(canvas.width, canvas.height) / 2;
  const at = t => punchScale(t, {steps, releaseAt, fps});
  const sample = t => {
    const s = at(t);
    const out = {scale: Math.round(s * 1e5) / 1e5, x: r2((1 - s) * (focus.x - cx)) || 0, y: r2((1 - s) * (focus.y - cy)) || 0};
    if (blurMax) out.blur = punchBlur(s, at(t - 1 / fps), {half, max: blurMax});
    return out;
  };
  const samples = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let f = first; f <= last; f++) samples.push({t: rt(f / fps), ...sample(f / fps)});
  // The camera always lands back on identity at the scene end.
  const identity = {scale: 1, x: 0, y: 0, ...(blurMax ? {blur: 0} : {})};
  if (!samples.length || samples.at(-1).t < end - 1e-6) samples.push({t: end, ...identity});
  else Object.assign(samples.at(-1), identity);
  b.events.push({id: `${b.id}-punch`, name: 'punch', time: punchAt, endTime: rt(Math.min(releaseAt, punchAt + 0.45)), role: 'emphasis', cue: 'whoosh'});
  steps.slice(1).forEach((step, i) => b.events.push({id: `${b.id}-step-${i + 1}`, name: `step-${i + 1}`, time: step.at, endTime: rt(Math.min(releaseAt, step.at + 0.45)), role: 'emphasis', cue: step.scale > steps[i].scale ? 'whoosh' : 'whoosh-soft'}));
  b.events.push({id: `${b.id}-release`, name: 'release', time: releaseAt, endTime: end, role: 'release'});
  b.model.camera = {target: 'base', focus, scale, punchAt, releaseAt, samples, ...(p.steps !== undefined ? {steps} : {}), ...(blurMax ? {blur: blurMax} : {})};
  return b.finish({scale, focus, focusFraction: {x: focusIn.x, y: focusIn.y}, punchAt, releaseAt, release, ...(p.steps !== undefined ? {steps} : {}), ...(blurMax ? {blur: blurMax} : {})}, {
    rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'decor', minTextPx: null,
    motion: {enterEnd: Math.min(releaseAt, punchAt + 0.45), exitStart: releaseAt, exitTo: {opacity: 1}}
  });
}

// ---------------------------------------------------------------------------
// zoom-through: hide a cut in the recording. The base rushes toward the
// presenter with zoom blur over the last frames before the cut, and bursts
// back out of the next take after it. A camera on the base, like punch-in;
// the cut is a base trim boundary (default: the one nearest the scene's middle).

export function baseCuts(base) {
  const segments = base?.segments ?? [];
  return segments.slice(0, -1).map(segment => segment.end);
}

function resolveZoomThrough(params, ctx) {
  const b = createFootageBase('zoom-through', params, ctx, {allowed: ['at', 'scale', 'rush', 'burst', 'focus', 'blur'], minDuration: CATALOG_C_TIMING['zoom-through'].minDuration});
  const {check, canvas, fps, start, end, duration, portrait} = b;
  const p = b.params;
  const scale = p.scale === undefined ? 2.6 : check.num(p.scale, 'params.scale', 1.6, 3.5);
  const rush = p.rush === undefined ? 0.3 : check.num(p.rush, 'params.rush', 0.15, 0.6);
  const burst = p.burst === undefined ? 0.4 : check.num(p.burst, 'params.burst', 0.2, 0.8);
  const blurMax = p.blur === false ? 0 : p.blur === undefined || p.blur === true ? b.u(24) : check.num(p.blur, 'params.blur', 2, 40);
  // The cut: params.at, a hit named "cut", else the base cut nearest the
  // middle of the scene, else the middle itself (one take: a fake cut).
  const cuts = baseCuts(ctx.base).filter(t => t - rush >= start - 1e-6 && t + burst <= end + 1e-6);
  const middle = start + duration / 2;
  const nearest = cuts.length ? cuts.reduce((best, t) => (Math.abs(t - middle) < Math.abs(best - middle) ? t : best)) - start : duration / 2;
  const cutAt = b.timeOf('cut', p.at, 'params.at', r2(nearest), {min: rush, max: duration - burst});
  const head = ctx.subject?.head ?? null;
  const focusIn = p.focus !== undefined ? fraction(check, p.focus, 'params.focus')
    : head ? {x: (head.x + head.width / 2) / canvas.width, y: (head.y + head.height * 0.7) / canvas.height}
    : ctx.base?.focus ?? {x: 0.5, y: portrait ? 0.45 : 0.5};
  const focus = {x: r2(focusIn.x * canvas.width), y: r2(focusIn.y * canvas.height)};
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const half = Math.hypot(canvas.width, canvas.height) / 2;
  const rushAt = rt(cutAt - rush), doneAt = rt(cutAt + burst);
  // Accelerate in (power3.in) to the cut, decelerate out (power3.out) after it.
  const at = t => {
    if (t < rushAt - 1e-9 || t >= doneAt - 1e-9) return 1;
    if (t < cutAt - 1e-9) return 1 + (scale - 1) * ((t - rushAt) / rush) ** 3;
    return scale - (scale - 1) * (1 - (1 - (t - cutAt) / burst) ** 3);
  };
  const samples = [];
  for (let f = Math.ceil(start * fps - 1e-6); f <= Math.floor(end * fps + 1e-6); f++) {
    const t = f / fps;
    const s = at(t);
    const sample = {t: rt(t), scale: Math.round(s * 1e5) / 1e5, x: r2((1 - s) * (focus.x - cx)) || 0, y: r2((1 - s) * (focus.y - cy)) || 0};
    if (blurMax) {
      // Blur from the frame edge's speed; across the cut, the speed either side.
      const prev = t - 1 / fps < cutAt - 1e-9 && t >= cutAt - 1e-9 ? at(t + 1 / fps) : at(t - 1 / fps);
      sample.blur = punchBlur(s, prev, {half, max: blurMax});
    }
    samples.push(sample);
  }
  const identity = {scale: 1, x: 0, y: 0, ...(blurMax ? {blur: 0} : {})};
  if (!samples.length || samples.at(-1).t < end - 1e-6) samples.push({t: end, ...identity});
  else Object.assign(samples.at(-1), identity);
  b.events.push({id: `${b.id}-rush`, name: 'rush', time: rushAt, endTime: cutAt, role: 'transition', cue: 'whoosh'});
  b.events.push({id: `${b.id}-cut`, name: 'cut', time: cutAt, endTime: doneAt, role: 'emphasis', cue: 'impact'});
  b.model.camera = {target: 'base', focus, scale, punchAt: rushAt, releaseAt: doneAt, samples, cut: cutAt, onCut: cuts.some(t => Math.abs(t - cutAt) < 1e-3), ...(blurMax ? {blur: blurMax} : {})};
  return b.finish({scale, focus, cutAt, rushAt, doneAt, rush, burst, onCut: b.model.camera.onCut}, {
    rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'decor', minTextPx: null,
    motion: {enterStart: rushAt, enterEnd: cutAt, exitStart: cutAt, exitTo: {opacity: 1}}
  });
}

function punchInView() {
  return [];
}

function punchInTimeline() {}

// ---------------------------------------------------------------------------
// footage-callout: a claim sticker with a leader line to a point on the footage

const STICKER_TONES = ['primary', 'paper', 'dark'];
const SIDES = ['auto', 'above', 'below', 'left', 'right'];

function rotatePoint(p, c, deg) {
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  return {x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos};
}

function resolveCallout(params, ctx) {
  const b = createFootageBase('footage-callout', params, ctx, {allowed: ['text', 'label', 'point', 'side', 'tone', 'tilt', 'at'], required: ['text', 'point'], minDuration: 1.5});
  const {check, u, canvas, safe, colors, theme, start, end, duration} = b;
  const p = b.params;
  const claim = check.str(p.text, 'params.text', 42);
  const label = p.label === undefined ? null : check.str(p.label, 'params.label', 24).toUpperCase();
  const point = fraction(check, p.point, 'params.point', 0.04, 0.96);
  const side = p.side === undefined ? 'auto' : check.oneOf(p.side, 'params.side', SIDES);
  const tone = p.tone === undefined ? 'primary' : check.oneOf(p.tone, 'params.tone', STICKER_TONES);
  const tilt = p.tilt === undefined ? -2 : check.num(p.tilt, 'params.tilt', -6, 6);
  const fill = tone === 'primary' ? colors.primary : tone === 'paper' ? colors.paper : colors.bg;
  const ink = tone === 'dark' ? colors.paper : colors.ink;
  b.requireContrast('text/sticker', ink, fill, `params.text on the ${tone} sticker`);
  const labelInk = tone === 'dark' ? colors.primary : mixColor(ink, fill, 0.78);
  if (label) b.requireContrast('label/sticker', labelInk, fill, `params.label on the ${tone} sticker`);
  const lineColor = tone === 'dark' ? colors.primary : fill;
  const halo = colors.bg;

  // Size: claim in the display face, up to two lines.
  const padX = u(34), padY = u(24), maxW = Math.min(safe.width, u(700));
  const fit = fitText(check, 'params.text', claim, {family: 'display', width: maxW - padX * 2, preferred: u(66), min: b.min.key, maxLines: 2});
  const labelSize = r2(Math.max(b.min.meta, u(30)));
  const claimW = fit.lines === 1 ? textWidth(claim, fit.size, 'display') : maxW - padX * 2;
  const labelW = label ? textWidth(label, labelSize, 'meta', 0.14) : 0;
  if (label && labelW > maxW - padX * 2) check.fail('params.label', `is too long for the sticker (${Math.round(labelW)} px in ${Math.round(maxW - padX * 2)} px); shorten it`);
  const boxW = r2(Math.min(maxW, Math.max(claimW, labelW, u(220)) + padX * 2));
  const labelBlock = label ? labelSize * 1.25 + u(10) : 0;
  const boxH = r2(padY * 2 + labelBlock + fit.lines * fit.size * 1.06);

  // Placement: beside the point at a leader-line gap, inside the safe zone.
  const P = {x: r2(point.x * canvas.width), y: r2(point.y * canvas.height)};
  const gap = u(120);
  const sin = Math.abs(Math.sin(tilt * Math.PI / 180));
  const mx = (boxH / 2) * sin, my = (boxW / 2) * sin; // rotated bounding-box growth
  const zx0 = safe.x + mx, zx1 = safe.x + safe.width - mx, zy0 = safe.y + my, zy1 = safe.y + safe.height - my;
  const clampX = x => Math.min(Math.max(x, zx0), zx1 - boxW), clampY = y => Math.min(Math.max(y, zy0), zy1 - boxH);
  const place = s => {
    let x, y;
    if (s === 'above') { x = clampX(P.x - boxW / 2); y = P.y - gap - boxH; }
    else if (s === 'below') { x = clampX(P.x - boxW / 2); y = P.y + gap; }
    else if (s === 'left') { x = P.x - gap - boxW; y = clampY(P.y - boxH / 2); }
    else { x = P.x + gap; y = clampY(P.y - boxH / 2); }
    const fits = x >= zx0 - 1e-6 && x + boxW <= zx1 + 1e-6 && y >= zy0 - 1e-6 && y + boxH <= zy1 + 1e-6;
    const covers = P.x > x - u(24) && P.x < x + boxW + u(24) && P.y > y - u(24) && P.y < y + boxH + u(24);
    return fits && !covers ? {x: r2(x), y: r2(y), side: s} : null;
  };
  const vertical = P.y > safe.y + safe.height / 2 ? ['above', 'below'] : ['below', 'above'];
  const horizontal = P.x > canvas.width / 2 ? ['left', 'right'] : ['right', 'left'];
  const order = side === 'auto' ? [...vertical, ...horizontal] : [side];
  const placed = order.map(place).find(Boolean);
  if (!placed) check.fail(side === 'auto' ? 'params.point' : 'params.side', `leaves no room for a ${Math.round(boxW)}×${Math.round(boxH)} px sticker ${side === 'auto' ? 'on any side' : side} of the point inside the safe zone${b.hidesCaptions ? '' : ' above the caption band'}; move the point, pick another side or shorten the text`);
  const box = {x: placed.x, y: placed.y, width: boxW, height: boxH};
  const centre = {x: box.x + boxW / 2, y: box.y + boxH / 2};
  // Leader: from the point to the nearest box edge (rotated with the sticker), tucked under the box.
  const near = {x: Math.min(Math.max(P.x, box.x + u(28)), box.x + boxW - u(28)), y: Math.min(Math.max(P.y, box.y + u(20)), box.y + boxH - u(20))};
  if (placed.side === 'above') near.y = box.y + boxH - u(6);
  if (placed.side === 'below') near.y = box.y + u(6);
  if (placed.side === 'left') near.x = box.x + boxW - u(6);
  if (placed.side === 'right') near.x = box.x + u(6);
  const anchor = rotatePoint(near, centre, tilt);
  const corners = [[box.x, box.y], [box.x + boxW, box.y], [box.x, box.y + boxH], [box.x + boxW, box.y + boxH]].map(([x, y]) => rotatePoint({x, y}, centre, tilt));
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  const bounds = {x: r2(Math.min(...xs)), y: r2(Math.min(...ys)), width: r2(Math.max(...xs) - Math.min(...xs)), height: r2(Math.max(...ys) - Math.min(...ys))};

  const dotAt = b.timeOf('point', p.at, 'params.at', 0.1, {min: 0, max: duration - CATALOG_C_TIMING['footage-callout'].leadOut});
  const lineAt = rt(dotAt + 0.12), stickerAt = rt(dotAt + 0.36);
  const exitStart = rt(end - 0.3);
  b.events.push({id: `${b.id}-point`, name: 'point', time: dotAt, endTime: rt(dotAt + 0.3), role: 'anchor', cue: 'tick'});
  b.events.push({id: `${b.id}-sticker`, name: 'sticker', time: stickerAt, endTime: rt(stickerAt + 0.45), role: 'emphasis', cue: 'pop'});
  const content = {text: claim, label, tone, tilt, side: placed.side, point: P, box, bounds, anchor: {x: r2(anchor.x), y: r2(anchor.y)},
    textSize: fit.size, lines: fit.lines, labelSize, padX, padY, fill, ink, labelInk, lineColor, halo,
    dot: {radius: u(15), ring: u(38), ringWidth: u(5), haloWidth: u(6)}, lineWidth: u(6), radius: u(18),
    times: {dot: dotAt, line: lineAt, sticker: stickerAt}};
  return b.finish(content, {rect: bounds, role: 'text', minTextPx: fit.size,
    motion: {enterEnd: rt(stickerAt + 0.45), exitStart, exitTo: {opacity: 0, scale: 0.96}, origin: {x: r2(centre.x), y: r2(centre.y)}}});
}

function calloutView(model) {
  const {id, fonts} = model;
  const c = model.content, B = c.box, D = c.dot, u = model.unit;
  const line = `M${c.point.x} ${c.point.y} L${c.anchor.x} ${c.anchor.y}`;
  const dash = {strokeDasharray: 1, strokeDashoffset: 1};
  const kids = [
    svgRoot(model.canvas.width, model.canvas.height, [
      el('path', `${id}-halo`, {...dash, opacity: 0.55}, [], {d: line, stroke: c.halo, strokeWidth: c.lineWidth + c.dot.haloWidth * 2, strokeLinecap: 'round', pathLength: 1}),
      el('path', `${id}-line`, {...dash}, [], {d: line, stroke: c.lineColor, strokeWidth: c.lineWidth, strokeLinecap: 'round', pathLength: 1})
    ]),
    el('div', `${id}-ring`, abs(c.point.x - D.ring, c.point.y - D.ring, D.ring * 2, D.ring * 2, {boxSizing: 'border-box', borderRadius: '50%', border: `${D.ringWidth}px solid ${c.lineColor}`, opacity: 0, transform: transformString({scaleX: 0.4, scaleY: 0.4}), transformOrigin: '50% 50%'})),
    el('div', `${id}-dot`, abs(c.point.x - D.radius, c.point.y - D.radius, D.radius * 2, D.radius * 2, {boxSizing: 'border-box', borderRadius: '50%', background: c.lineColor, border: `${D.ringWidth}px solid ${c.halo}`, transform: transformString({scaleX: 0, scaleY: 0}), transformOrigin: '50% 50%'}))
  ];
  const inner = [];
  if (c.label) inner.push(el('div', null, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: c.labelSize, lineHeight: '1.25', letterSpacing: '0.14em', fontWeight: 600, color: c.labelInk, marginBottom: 10 * u}, [c.label]));
  inner.push(el('div', null, {margin: 0, fontFamily: fonts.display, fontSize: c.textSize, lineHeight: '1.06', fontWeight: 400, color: c.ink, overflowWrap: 'break-word'}, [c.text]));
  kids.push(el('div', `${id}-sticker`, abs(B.x, B.y, B.width, B.height, {boxSizing: 'border-box', padding: `${c.padY}px ${c.padX}px`, borderRadius: c.radius, background: c.fill,
    border: c.tone === 'dark' ? `${3 * u}px solid ${c.lineColor}` : 'none', boxShadow: `0 ${14 * u}px ${36 * u}px #00000073`, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center',
    opacity: 0, transform: transformString({rotation: c.tilt, scaleX: 0.6, scaleY: 0.6}), transformOrigin: '50% 50%'}), inner));
  return kids;
}

function calloutTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content, T = c.times;
  set(ops, `${id}-dot`, start, {scaleX: 0, scaleY: 0});
  tw(ops, `${id}-dot`, T.dot, 0.3, 'back.out(2)', {scaleX: 0, scaleY: 0}, {scaleX: 1, scaleY: 1});
  set(ops, `${id}-ring`, start, {opacity: 0, scaleX: 0.4, scaleY: 0.4});
  tw(ops, `${id}-ring`, T.dot, 0.42, 'power2.out', {opacity: 0, scaleX: 0.4, scaleY: 0.4}, {opacity: 0.9, scaleX: 1, scaleY: 1});
  for (const part of ['halo', 'line']) {
    set(ops, `${id}-${part}`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-${part}`, T.line, 0.3, 'power2.out', {strokeDashoffset: 1}, {strokeDashoffset: 0});
  }
  set(ops, `${id}-sticker`, start, {opacity: 0, rotation: c.tilt, scaleX: 0.6, scaleY: 0.6});
  tw(ops, `${id}-sticker`, T.sticker, 0.18, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-sticker`, T.sticker, 0.45, 'back.out(1.7)', {scaleX: 0.6, scaleY: 0.6}, {scaleX: 1, scaleY: 1});
}

// ---------------------------------------------------------------------------
// lower-third: name and title bar

const LOWER_THIRD_TONES = ['dark', 'primary'];

function resolveLowerThird(params, ctx) {
  const b = createFootageBase('lower-third', params, ctx, {allowed: ['name', 'title', 'at', 'align', 'tone'], required: ['name'], minDuration: CATALOG_C_TIMING['lower-third'].minDuration});
  const {check, u, safe, colors, theme, end, duration} = b;
  const p = b.params;
  const name = check.str(p.name, 'params.name', 32);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const align = p.align === undefined ? 'left' : check.oneOf(p.align, 'params.align', ['left', 'center']);
  const tone = p.tone === undefined ? 'dark' : check.oneOf(p.tone, 'params.tone', LOWER_THIRD_TONES);
  const panel = tone === 'dark' ? colors.bg : colors.primary;
  const nameInk = tone === 'dark' ? colors.paper : colors.ink;
  const titleInk = tone === 'dark' ? theme.muted : mixColor(colors.ink, colors.primary, 0.8);
  const bar = tone === 'dark' ? colors.primary : colors.ink;
  b.requireContrast('name/panel', nameInk, panel, `params.name on the ${tone} panel`);
  if (title) b.requireContrast('title/panel', titleInk, panel, `params.title on the ${tone} panel`);
  const barW = u(12), padL = u(30), padR = u(40), padY = u(24);
  const maxText = safe.width - barW - padL - padR;
  const nameFit = fitText(check, 'params.name', name, {family: 'body', width: maxText, preferred: u(62), min: b.min.key, maxLines: 1});
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: maxText, preferred: u(44), min: b.min.key, maxLines: 1}) : null;
  const textW = Math.max(textWidth(name, nameFit.size, 'body'), title ? textWidth(title, titleFit.size, 'body') : 0);
  const width = r2(Math.min(safe.width, Math.max(u(420), textW + barW + padL + padR)));
  const gapLines = u(6);
  const height = r2(padY * 2 + nameFit.size * 1.15 + (titleFit ? gapLines + titleFit.size * 1.2 : 0));
  const x = r2(align === 'left' ? safe.x : safe.x + (safe.width - width) / 2);
  const y = r2(safe.y + safe.height - height);
  const t0 = b.timeOf('name', p.at, 'params.at', 0, {min: 0, max: duration - CATALOG_C_TIMING['lower-third'].leadOut});
  const exitStart = rt(end - 0.32);
  b.events.push({id: `${b.id}-name`, name: 'name', time: t0, endTime: rt(t0 + 0.55), role: 'title', cue: 'whoosh'});
  if (title) b.events.push({id: `${b.id}-title`, name: 'title', time: rt(t0 + 0.3), endTime: rt(t0 + 0.65), role: 'subtitle'});
  const content = {name, title, align, tone, panel, nameInk, titleInk, bar, barW, padL, padR, padY, gapLines, nameSize: nameFit.size, titleSize: titleFit?.size ?? null,
    box: {x, y, width, height}, slide: u(60), radius: u(10), times: {bar: t0, panel: rt(t0 + 0.08), name: rt(t0 + 0.18), title: rt(t0 + 0.3)}};
  return b.finish(content, {rect: {x, y, width, height}, role: 'text', minTextPx: Math.min(nameFit.size, titleFit?.size ?? Infinity),
    motion: {enterEnd: rt(t0 + 0.65), exitStart, exitTo: {opacity: 0, x: -u(40)}}});
}

function lowerThirdView(model) {
  const {id, fonts} = model;
  const c = model.content, B = c.box;
  const kids = [
    el('div', `${id}-panel`, abs(B.x, B.y, B.width, B.height, {boxSizing: 'border-box', borderRadius: c.radius, background: c.panel, boxShadow: `0 ${12 * model.unit}px ${32 * model.unit}px #00000066`, opacity: 0, transform: transformString({x: -c.slide})}), [
      el('div', `${id}-name`, abs(c.barW + c.padL, c.padY, B.width - c.barW - c.padL - c.padR, undefined, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 700, fontSize: c.nameSize, lineHeight: '1.15', color: c.nameInk, opacity: 0, transform: transformString({y: 16 * model.unit})}), [c.name]),
      ...(c.title ? [el('div', `${id}-title`, abs(c.barW + c.padL, c.padY + c.nameSize * 1.15 + c.gapLines, B.width - c.barW - c.padL - c.padR, undefined, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 500, fontSize: c.titleSize, lineHeight: '1.2', color: c.titleInk, opacity: 0, transform: transformString({y: 16 * model.unit})}), [c.title])] : [])
    ]),
    el('div', `${id}-bar`, abs(B.x, B.y, c.barW, B.height, {background: c.bar, borderRadius: `${c.radius}px 0 0 ${c.radius}px`, transform: transformString({scaleY: 0}), transformOrigin: '50% 100%'}))
  ];
  return kids;
}

function lowerThirdTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content, T = c.times, lift = 16 * model.unit;
  set(ops, `${id}-bar`, start, {scaleX: 1, scaleY: 0});
  tw(ops, `${id}-bar`, T.bar, 0.3, 'power3.out', {scaleY: 0}, {scaleY: 1});
  set(ops, `${id}-panel`, start, {opacity: 0, x: -c.slide});
  tw(ops, `${id}-panel`, T.panel, 0.45, 'power3.out', {opacity: 0, x: -c.slide}, {opacity: 1, x: 0});
  for (const part of c.title ? ['name', 'title'] : ['name']) {
    set(ops, `${id}-${part}`, start, {opacity: 0, y: lift});
    tw(ops, `${id}-${part}`, T[part], 0.35, 'power2.out', {opacity: 0, y: lift}, {opacity: 1, y: 0});
  }
}

// ---------------------------------------------------------------------------
// emphasis-caption: a big word-pop over the footage (hides the captions)

const POSITIONS = ['center', 'upper', 'lower'];

function resolveEmphasis(params, ctx) {
  const b = createFootageBase('emphasis-caption', params, ctx, {allowed: ['text', 'at', 'stagger', 'color', 'position'], required: ['text'], hidesCaptions: true, minDuration: 0.8});
  const {check, u, safe, colors, canvas, end, duration, portrait} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 24);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 3) check.fail('params.text', `must be 1–3 words; got ${words.length}`);
  const stroke = colors.bg;
  const color = b.resolveColor(p.color, 'params.color', 'primary', stroke, 'brand.colors.bg (outline)');
  const position = p.position === undefined ? 'center' : check.oneOf(p.position, 'params.position', POSITIONS);
  const stagger = p.stagger === undefined ? grammarStagger(ctx.grammar, 0.09, {max: 0.3}) : check.num(p.stagger, 'params.stagger', 0, 0.3);
  // The word block spans 88% of the safe width (the RFC hero fill is 70–90%).
  const blockW = r2(safe.width * 0.88);
  const fit = fitText(check, 'params.text', text, {family: 'display', width: blockW - u(24), preferred: u(portrait ? 180 : 150), min: Math.max(b.min.key, u(96)), maxLines: 2});
  const height = r2(fit.lines * fit.size * 1.04 + u(24));
  const ref = canvas.height / (portrait ? 1920 : 1080);
  const centreY = position === 'upper' ? (portrait ? 520 : 300) * ref : position === 'lower' ? (portrait ? 1250 : 800) * ref : (portrait ? 860 : 540) * ref;
  const y = r2(Math.min(Math.max(centreY - height / 2, safe.y), safe.y + safe.height - height));
  const rect = {x: r2(safe.x + (safe.width - blockW) / 2), y, width: blockW, height};
  const t0 = b.timeOf('pop', p.at, 'params.at', 0.05, {min: 0, max: Math.max(0, duration - CATALOG_C_TIMING['emphasis-caption'].leadOut - stagger * (words.length - 1))});
  const exitStart = rt(Math.max(t0 + stagger * (words.length - 1) + 0.4, end - 0.25));
  const items = words.map((word, i) => ({index: i, text: word, time: rt(t0 + i * stagger)}));
  b.events.push({id: `${b.id}-pop`, name: 'pop', time: t0, endTime: rt(t0 + 0.38), role: 'emphasis', cue: 'impact'});
  for (const item of items.slice(1)) b.events.push({id: `${b.id}-word-${item.index}`, name: `word-${item.index}`, time: item.time, endTime: rt(item.time + 0.38), role: 'beat'});
  const content = {text, words: items, color, stroke, strokeWidth: u(10), size: fit.size, lines: fit.lines, position, stagger, rise: u(30), shadow: `0 ${u(10)}px ${u(28)}px #000000a6`};
  return b.finish(content, {rect, role: 'hero', minTextPx: fit.size,
    motion: {enterEnd: rt(items.at(-1).time + 0.38), exitStart, exitTo: {opacity: 0, scale: 1.08}, origin: {x: r2(rect.x + rect.width / 2), y: r2(rect.y + rect.height / 2)}}});
}

function emphasisView(model) {
  const {id, fonts} = model;
  const c = model.content, R = model.rect;
  const words = c.words.map(word => el('span', `${id}-w-${word.index}`, {display: 'inline-block', margin: `0 ${0.12 * c.size}px`, opacity: 0, transform: transformString({y: c.rise, scaleX: 0.3, scaleY: 0.3}), transformOrigin: '50% 70%'}, [word.text]));
  return [el('div', `${id}-words`, abs(R.x, R.y, R.width, R.height, {display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', textAlign: 'center',
    fontFamily: fonts.display, fontWeight: 400, fontSize: c.size, lineHeight: '1.04', color: c.color, WebkitTextStroke: `${c.strokeWidth}px ${c.stroke}`, paintOrder: 'stroke fill', textShadow: c.shadow}), words)];
}

function emphasisTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  for (const word of c.words) {
    const target = `${id}-w-${word.index}`;
    set(ops, target, start, {opacity: 0, x: 0, y: c.rise, scaleX: 0.3, scaleY: 0.3});
    tw(ops, target, word.time, 0.12, 'none', {opacity: 0}, {opacity: 1});
    tw(ops, target, word.time, 0.38, 'back.out(2.2)', {y: c.rise, scaleX: 0.3, scaleY: 0.3}, {y: 0, scaleX: 1, scaleY: 1});
  }
}

// ---------------------------------------------------------------------------
// masthead: one huge word behind the presenter, like a magazine cover
// (layer "behind": the head covers the lower part of the letters)

// Where a head sits when the matte has no summary yet (canvas fractions).
const DEFAULT_HEAD = {portrait: {x: 0.4, y: 0.26, w: 0.2, h: 0.12}, landscape: {x: 0.44, y: 0.18, w: 0.12, h: 0.24}};
// The letters' baseline sits this far down the head, so the head covers
// their lower part; Anton-like display faces have caps about 0.72 em tall.
const MASTHEAD_BASELINE = 0.35;
const CAP = 0.72;

export function headRect(ctx, canvas, portrait) {
  if (ctx.subject?.head) return {...ctx.subject.head, measured: true};
  const d = DEFAULT_HEAD[portrait ? 'portrait' : 'landscape'];
  return {x: d.x * canvas.width, y: d.y * canvas.height, width: d.w * canvas.width, height: d.h * canvas.height, measured: false};
}

function resolveMasthead(params, ctx) {
  const b = createFootageBase('masthead', params, ctx, {allowed: ['word', 'kicker', 'color', 'at', 'stagger'], required: ['word'], minDuration: CATALOG_C_TIMING.masthead.minDuration});
  const {check, u, safe, colors, canvas, portrait, end, duration} = b;
  const p = b.params;
  const word = check.str(p.word, 'params.word', 12).toUpperCase();
  if (/\s/.test(word)) check.fail('params.word', 'must be one word');
  const kicker = p.kicker === undefined ? null : check.str(p.kicker, 'params.kicker', 32).toUpperCase();
  const color = b.resolveColor(p.color, 'params.color', 'paper', colors.bg, 'brand.colors.bg (shadow)');
  const stagger = p.stagger === undefined ? grammarStagger(ctx.grammar, 0.05, {max: 0.12}) : check.num(p.stagger, 'params.stagger', 0, 0.12);
  const head = headRect(ctx, canvas, portrait);
  // Size: the word spans up to 90% of the safe width, then shrinks if the
  // headroom cannot hold it with the baseline on the head.
  const blockW = r2(safe.width * 0.9);
  const fit = fitText(check, 'params.word', word, {family: 'display', width: blockW, preferred: u(portrait ? 420 : 300), min: u(150), maxLines: 1});
  const kickerSize = r2(Math.max(b.min.meta, u(30)));
  const kickerH = kicker ? r2(kickerSize * 1.3 + u(12)) : 0;
  const baseline = head.y + head.height * MASTHEAD_BASELINE;
  const room = baseline - safe.y - kickerH;
  const size = r2(Math.min(fit.size, room / 0.9));
  if (size < u(150) - 1e-6) check.fail('params.word', `needs headroom: with the presenter's head at ${Math.round(head.y)} px there is room for ${Math.max(0, Math.round(room))} px of letters above it, and a masthead needs ${Math.round(u(150) * 0.9)} px. Use it on a medium or wide shot, or pick another module`);
  const lineH = r2(size * 0.9);
  const top = r2(Math.max(safe.y + kickerH, baseline - lineH));
  const rect = {x: r2(safe.x + (safe.width - blockW) / 2), y: r2(top - kickerH), width: blockW, height: r2(lineH + kickerH)};
  // How much of the letters' cap height the head covers in its column.
  const capTop = top + lineH - size * CAP - size * 0.05;
  const covered = r2(Math.max(0, Math.min(1, (top + lineH - Math.max(capTop, head.y)) / (size * CAP))));
  const t0 = b.timeOf('title', p.at, 'params.at', 0.05, {min: 0, max: Math.max(0, duration - CATALOG_C_TIMING.masthead.leadOut - stagger * (word.length - 1))});
  const letters = [...word].map((char, i) => ({index: i, char, time: rt(t0 + i * stagger)}));
  const settle = rt(letters.at(-1).time + 0.5);
  b.events.push({id: `${b.id}-title`, name: 'title', time: t0, endTime: settle, role: 'title', cue: 'whoosh'});
  b.model.layer = 'behind';
  const exitStart = rt(Math.max(settle, end - 0.35));
  const content = {word, kicker, color, size, lineH, kickerSize, kickerH, letters, stagger, rise: r2(size * 0.32), covered, placement: head.measured ? 'measured' : 'default',
    head: {x: r2(head.x), y: r2(head.y), width: r2(head.width), height: r2(head.height)}, shadow: `0 ${u(8)}px ${u(30)}px #00000080`};
  return b.finish(content, {rect, role: 'hero', minTextPx: size,
    motion: {enterEnd: settle, exitStart, exitTo: {opacity: 0, y: -u(30)}, origin: {x: r2(rect.x + rect.width / 2), y: r2(rect.y + rect.height / 2)}}});
}

function mastheadView(model) {
  const {id, fonts} = model;
  const c = model.content, R = model.rect;
  const kids = [];
  if (c.kicker) kids.push(el('div', `${id}-kicker`, abs(R.x, R.y, R.width, c.kickerH, {textAlign: 'center', whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: c.kickerSize, lineHeight: '1.3', letterSpacing: '0.24em', fontWeight: 600, color: c.color, textShadow: c.shadow, opacity: 0}), [c.kicker]));
  const letters = c.letters.map(letter => el('span', `${id}-l-${letter.index}`, {display: 'inline-block', opacity: 0, transform: transformString({y: c.rise})}, [letter.char]));
  kids.push(el('div', `${id}-word`, abs(R.x, R.y + c.kickerH, R.width, c.lineH, {display: 'flex', justifyContent: 'center', alignItems: 'flex-end', whiteSpace: 'nowrap',
    fontFamily: fonts.display, fontWeight: 400, fontSize: c.size, lineHeight: '0.9', letterSpacing: '0.01em', color: c.color, textShadow: c.shadow}), letters));
  return kids;
}

function mastheadTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  if (c.kicker) {
    set(ops, `${id}-kicker`, start, {opacity: 0});
    tw(ops, `${id}-kicker`, c.letters.at(-1).time, 0.4, 'power2.out', {opacity: 0}, {opacity: 1});
  }
  for (const letter of c.letters) {
    const target = `${id}-l-${letter.index}`;
    set(ops, target, start, {opacity: 0, y: c.rise});
    tw(ops, target, letter.time, 0.3, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, letter.time, 0.5, 'power3.out', {y: c.rise}, {y: 0});
  }
}

// ---------------------------------------------------------------------------
// dolly-zoom: the room pushes in or falls away while the presenter holds
// still. It scales the matte's room plate (the room without the presenter)
// behind the subject, so the presenter's own outline never shows around the
// cut-out, and holds the subject at identity with a subjectCamera.

function resolveDollyZoom(params, ctx) {
  const b = createFootageBase('dolly-zoom', params, ctx, {allowed: ['direction', 'scale', 'at', 'move', 'release'], minDuration: CATALOG_C_TIMING['dolly-zoom'].minDuration});
  const {check, canvas, fps, start, end, duration} = b;
  const p = b.params;
  const direction = p.direction === undefined ? 'push' : check.oneOf(p.direction, 'params.direction', ['push', 'pull']);
  const scale = p.scale === undefined ? 1.3 : check.num(p.scale, 'params.scale', 1.12, 1.6);
  const move = p.move === undefined ? Math.min(1.6, r2(duration * 0.6)) : check.num(p.move, 'params.move', 1, 2.5);
  const release = direction === 'pull' ? 0 : p.release === undefined ? 0.5 : check.num(p.release, 'params.release', 0.3, 1);
  if (direction === 'pull' && p.release !== undefined) check.fail('params.release', 'applies to a push only; a pull ends on the recording\'s own framing');
  const moveAt = b.timeOf('move', p.at, 'params.at', 0, {min: 0, max: duration - move - release - CATALOG_C_TIMING['dolly-zoom'].hold});
  if (ctx.subject?.framing === 'close-up') check.fail('params', 'needs room around the presenter (framing medium or wide); this stretch of the recording is a close-up. Use punch-in instead');
  const head = headRect(ctx, canvas, canvas.height > canvas.width);
  const origin = {x: r2(head.x + head.width / 2), y: r2(head.y + head.height / 2)};
  const plate = ctx.subject?.plate ?? null;
  const releaseAt = rt(end - release);
  const from = direction === 'push' ? 1 : scale, to = direction === 'push' ? scale : 1;
  // The subject holds still: identity on every frame of the scene.
  const samples = [];
  for (let f = Math.ceil(start * fps - 1e-6); f <= Math.floor(end * fps + 1e-6); f++) samples.push({t: rt(f / fps), scale: 1, x: 0, y: 0});
  b.model.layer = 'behind';
  b.model.subjectCamera = {samples};
  b.events.push({id: `${b.id}-move`, name: 'move', time: moveAt, endTime: rt(moveAt + move), role: 'emphasis', cue: 'riser'});
  if (release) b.events.push({id: `${b.id}-release`, name: 'release', time: releaseAt, endTime: end, role: 'release'});
  const content = {direction, scale, from, to, move, moveAt, release, releaseAt, origin, plate, ease: 'power2.inOut'};
  return b.finish(content, {rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'decor', minTextPx: null,
    motion: {enterEnd: rt(moveAt + move), exitStart: release ? releaseAt : end, exitTo: {opacity: 1}}});
}

function dollyZoomView(model) {
  const {id} = model;
  const c = model.content, W = model.canvas.width, H = model.canvas.height;
  if (!c.plate) return [];
  const img = el('img', `${id}-plate`, abs(0, 0, W, H, {objectFit: c.plate.fit, objectPosition: `${c.plate.focus.x * 100}% ${c.plate.focus.y * 100}%`}), [], {src: c.plate.src, alt: ''});
  return [el('div', `${id}-room`, abs(0, 0, W, H, {overflow: 'hidden', transformOrigin: `${c.origin.x}px ${c.origin.y}px`, transform: transformString({scaleX: c.from, scaleY: c.from})}), [img])];
}

function dollyZoomTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  if (!c.plate) return;
  set(ops, `${id}-room`, start, {scaleX: c.from, scaleY: c.from});
  tw(ops, `${id}-room`, c.moveAt, c.move, c.ease, {scaleX: c.from, scaleY: c.from}, {scaleX: c.to, scaleY: c.to});
  if (c.release) tw(ops, `${id}-room`, c.releaseAt, c.release, 'power2.inOut', {scaleX: c.to, scaleY: c.to}, {scaleX: 1, scaleY: 1});
}

// ---------------------------------------------------------------------------
// Registry, root, camera

// Timing constants per module (seconds, scene-relative), the single source for
// the checks above and each MODULES entry's `timing` table.
export const CATALOG_C_TIMING = Object.freeze({
  'punch-in': Object.freeze({minDuration: 0.8, releaseHold: 0.25, stepGap: 0.3}),
  'zoom-through': Object.freeze({minDuration: 0.8}),
  'footage-callout': Object.freeze({minDuration: 1.5, leadOut: 1.1}),
  'lower-third': Object.freeze({minDuration: 2, leadOut: 1.2}),
  'emphasis-caption': Object.freeze({minDuration: 0.8, leadOut: 0.45}),
  masthead: Object.freeze({minDuration: 1.5, leadOut: 0.9}),
  'dolly-zoom': Object.freeze({minDuration: 1.8, hold: 0.2})
});
const TIMING_C = {
  'punch-in': {minDuration: CATALOG_C_TIMING['punch-in'].minDuration, leadIn: 0, leadOut: null, gaps: [], rules: [`at (and every steps[i].at) ≤ scene − release − ${CATALOG_C_TIMING['punch-in'].releaseHold} s (release 0.3–2 s, default min(0.5, 0.3 × scene))`, `steps at least ${CATALOG_C_TIMING['punch-in'].stepGap} s apart`]},
  'zoom-through': {minDuration: CATALOG_C_TIMING['zoom-through'].minDuration, leadIn: null, leadOut: null, gaps: [], rules: ['the cut (at) needs rush before it and burst after it inside the scene (rush 0.15–0.6 s, default 0.3; burst 0.2–0.8 s, default 0.4)']},
  'footage-callout': {minDuration: CATALOG_C_TIMING['footage-callout'].minDuration, leadIn: 0, leadOut: CATALOG_C_TIMING['footage-callout'].leadOut, gaps: [], rules: []},
  'lower-third': {minDuration: CATALOG_C_TIMING['lower-third'].minDuration, leadIn: 0, leadOut: CATALOG_C_TIMING['lower-third'].leadOut, gaps: [], rules: []},
  'emphasis-caption': {minDuration: CATALOG_C_TIMING['emphasis-caption'].minDuration, leadIn: 0, leadOut: CATALOG_C_TIMING['emphasis-caption'].leadOut, gaps: [], rules: [`at ≤ scene − ${CATALOG_C_TIMING['emphasis-caption'].leadOut} s − stagger × (words − 1) (stagger 0–0.3 s, default 0.09)`]},
  masthead: {minDuration: CATALOG_C_TIMING.masthead.minDuration, leadIn: 0, leadOut: CATALOG_C_TIMING.masthead.leadOut, gaps: [], rules: [`at ≤ scene − ${CATALOG_C_TIMING.masthead.leadOut} s − stagger × (letters − 1) (stagger 0–0.12 s, default 0.05)`]},
  'dolly-zoom': {minDuration: CATALOG_C_TIMING['dolly-zoom'].minDuration, leadIn: 0, leadOut: null, gaps: [], rules: [`at ≤ scene − move − release − ${CATALOG_C_TIMING['dolly-zoom'].hold} s (move 1–2.5 s, default min(1.6, 0.6 × scene); release 0.3–1 s, push only)`]}
};

const DEFINITIONS = [
  {id: 'punch-in', describe: 'Footage-led: a spring zoom on the base recording toward a focus point, timed to a word (a camera on the base, not an overlay). Steps punch in, further in or back out on successive words; blur adds a few frames of zoom blur on each move.',
    params: {scale: '1.06–1.25 (default 1.12)', at, focus: '{x, y} canvas fractions (default base.focus, else {0.5, 0.42})', release: 'seconds before the scene end when the zoom springs back (0.3–2, default min(0.5, 30% of the scene))',
      steps: '[{at, scale}] 1–4, instead of at/scale: each springs to its scale (1–1.35; the first ≥ 1.06), at least 0.3 s apart', blur: 'true (14 px at 1080) or 2–30 px: velocity-shaped zoom blur, 0 once settled (default off)'},
    events: ['punch', 'step-<i>', 'release'], resolve: resolvePunchIn, view: punchInView, timeline: punchInTimeline},
  {id: 'zoom-through', describe: 'Footage-led: hides a cut in the recording. The frame rushes toward the presenter with zoom blur into the cut and bursts back out of the next take, for "but wait", a contrast or a jump between takes. A camera on the base; defaults to the edit\'s cut nearest the scene\'s middle.',
    params: {at: 'the cut, seconds from scene start (default: the nearest cut in the edit, else the middle)', scale: '1.6–3.5 (default 2.6)', rush: 'seconds into the cut (0.15–0.6, default 0.3)', burst: 'seconds out of it (0.2–0.8, default 0.4)', focus: '{x, y} canvas fractions (default the presenter\'s face)', blur: 'true (default, 24 px at 1080), false, or 2–40 px'},
    events: ['rush', 'cut'], resolve: resolveZoomThrough, view: punchInView, timeline: punchInTimeline},
  {id: 'footage-callout', describe: 'Footage-led: a claim sticker anchored to a point on the footage by a leader line, placed inside the safe zone.',
    params: {text: 'claim ≤ 42 chars, up to 2 lines', label: 'kicker ≤ 24 (optional)', point: '{x, y} canvas fractions 0.04–0.96 (the anchored spot)', side: 'auto|above|below|left|right', tone: 'primary|paper|dark', tilt: 'degrees −6–6 (default −2)', at},
    events: ['point', 'sticker'], resolve: resolveCallout, view: calloutView, timeline: calloutTimeline},
  {id: 'lower-third', describe: 'Footage-led: a name and title bar that slides in above the caption band.',
    params: {name: 'string ≤ 32', title: 'string ≤ 48 (optional)', align: 'left|center', tone: 'dark|primary', at},
    events: ['name', 'title'], resolve: resolveLowerThird, view: lowerThirdView, timeline: lowerThirdTimeline},
  {id: 'emphasis-caption', describe: 'Footage-led: one to three big words that pop over the footage; hides the captions while on screen.',
    params: {text: '1–3 words, ≤ 24 chars', color: 'primary|accent|paper or #hex (≥ 3:1 on the bg outline)', position: 'center|upper|lower', stagger: 'seconds between words (default 0.09)', at},
    events: ['pop', 'word-<i>'], resolve: resolveEmphasis, view: emphasisView, timeline: emphasisTimeline},
  {id: 'masthead', describe: 'Footage-led, behind the presenter: one huge word (a product name or the one idea) rises in letter by letter at the top of the frame, and the presenter\'s head covers its lower part like a magazine cover. Needs headroom: medium or wide shots.',
    params: {word: 'one word ≤ 12 chars (uppercased)', kicker: 'small line above it ≤ 32 (optional)', color: 'paper (default)|primary|accent or #hex (≥ 3:1 on brand bg)', stagger: 'seconds between letters (0–0.12, default 0.05)', at},
    events: ['title'], needs: ['subject'], layer: 'behind', aspects: ['9:16', '16:9'], mood: ['bold', 'editorial', 'premium', 'launch'],
    resolve: resolveMasthead, view: mastheadView, timeline: mastheadTimeline},
  {id: 'dolly-zoom', describe: 'Footage-led, behind the presenter: the room pushes in (or falls away) over one eased beat while the presenter holds still, a dolly zoom for a realisation or a turn. Needs a medium or wide shot and the matte\'s room plate.',
    params: {direction: 'push (default) | pull (starts on a cut, the room falls away)', scale: '1.12–1.6 (default 1.3)', move: 'seconds the zoom takes (1–2.5)', release: 'push: seconds to ease back before the scene end (0.3–1, default 0.5)', at},
    events: ['move', 'release'], needs: ['subject'], layer: 'behind', aspects: ['9:16', '16:9'], mood: ['cinematic', 'dramatic', 'premium'],
    resolve: resolveDollyZoom, view: dollyZoomView, timeline: dollyZoomTimeline}
];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: TIMING_C[def.id], resolve: def.resolve,
  ...(def.needs ? {needs: def.needs} : {}), ...(def.layer ? {layer: def.layer} : {}), ...(def.aspects ? {aspects: def.aspects} : {}), ...(def.mood ? {mood: def.mood} : {})}]));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue C: unknown module ${model?.module}`);
  return def;
}

/** Static element tree for a catalogue C model: a full-canvas root (initial state at scene start). */
export function catalogCView(model) {
  const m = model.motion, f = m.enterFrom;
  return el('div', model.id, abs(0, 0, model.canvas.width, model.canvas.height, {
    boxSizing: 'border-box', opacity: f.opacity, transform: transformString({x: f.x, y: f.y, scaleX: f.scale, scaleY: f.scale}), transformOrigin: `${m.origin.x}px ${m.origin.y}px`
  }), definition(model).view(model));
}

/** Renderer-neutral animation ops for a catalogue C model, root first. */
export function catalogCTimeline(model) {
  const def = definition(model);
  const m = model.motion, f = m.enterFrom, e = m.exitTo;
  const from = {opacity: f.opacity, x: f.x, y: f.y, scaleX: f.scale, scaleY: f.scale};
  const identity = {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1};
  const ops = [];
  set(ops, model.id, model.start, from);
  if (m.enterDuration > 0 && JSON.stringify(from) !== JSON.stringify(identity)) tw(ops, model.id, m.enterStart, m.enterDuration, m.enterEase, from, identity);
  if (m.exitDuration > 0) tw(ops, model.id, m.exitStart, m.exitDuration, m.exitEase, identity, {opacity: e.opacity, x: e.x, y: e.y, scaleX: e.scale, scaleY: e.scale});
  set(ops, model.id, model.end, {opacity: 0});
  def.timeline(model, ops);
  // Motion grammar: pops (back/elastic eases) follow the story's grammar.
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}

/**
 * One op list for every camera in `models` (any resolved models; those without
 * `camera` are ignored), on `target` (default BASE_CAMERA): identity at 0, then
 * one tl.set-style op per camera sample (at t - SAMPLE_LEAD), cameras applied
 * in start order. Both compilers apply it to the base layer.
 */
// roomFilterAt(t): the base's room filter at t ("none" when untreated; the
// subject layer's room treatments). A blurred sample sets the whole filter,
// so it carries the room's filter too, and the room is not lost.
export function cameraOps(models, {target = BASE_CAMERA, roomFilterAt = null} = {}) {
  const cameras = (models ?? []).filter(model => model?.camera && Array.isArray(model.camera.samples)).sort((a, b) => a.start - b.start);
  if (!cameras.length) return [];
  const ops = [{type: 'set', target, time: 0, props: {...CAMERA_IDENTITY}}];
  for (const model of cameras) {
    for (const s of model.camera.samples) ops.push({type: 'set', target, time: Math.max(0, sampleTime(s.t)), props: cameraSampleProps(s, roomFilterAt ? roomFilterAt(s.t) : 'none')});
  }
  return ops;
}

/** A camera sample as set props: transform, plus a CSS filter when the sample carries zoom blur. */
export function cameraSampleProps(s, roomFilter = 'none') {
  const props = {x: s.x, y: s.y, scaleX: s.scale, scaleY: s.scale};
  if (s.blur !== undefined) {
    const parts = [roomFilter && roomFilter !== 'none' ? roomFilter : null, s.blur > 0 ? `blur(${s.blur}px)` : null].filter(Boolean);
    props.filter = parts.length ? parts.join(' ') : 'none';
  }
  return props;
}

/** Camera windows that overlap in time ([[idA, idB], …]); the later camera wins while both run. */
export function cameraOverlaps(models) {
  const cameras = (models ?? []).filter(model => model?.camera).sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 1; i < cameras.length; i++) for (let j = 0; j < i; j++) if (cameras[j].end > cameras[i].start + 1e-6) out.push([cameras[j].sceneId ?? cameras[j].id, cameras[i].sceneId ?? cameras[i].id]);
  return out;
}
