// Catalogue C: footage-led modules (RFC §3 footage-led lane, §5 punch-in and
// callout). Contract: docs/KIT_CONTRACTS.md ("Footage-led lane").
//
//   punch-in          word-timed zoom on the base recording (a camera, not an overlay)
//   footage-callout   claim sticker anchored to a point on the footage by a leader line
//   lower-third       name and title bar above the caption band
//   emphasis-caption  big word-pop over the footage; hides the captions
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

import {springValue} from './motion.mjs';
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
    if (rel < min - 1e-9 || rel > max + 1e-9) check.fail(value !== undefined ? path : `${path} (default for "${name}")`, `must fall between ${r2(min)} s and ${r2(max)} s after the scene start; got ${r2(rel)} s${value === undefined ? ' — lengthen the scene or set it explicitly' : ''}`);
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
      enterFrom, exitTo, enterEase: motion.enterEase ?? 'power3.out', exitEase: motion.exitEase ?? 'power2.in', origin: motion.origin ?? {x: r2(width / 2), y: r2(height / 2)}};
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

function punchScale(t, {scale, punchAt, releaseAt, fps}) {
  if (t < punchAt - 1e-9) return 1;
  const pin = springValue(t, {start: punchAt, fps, ...PUNCH_SPRING.in});
  const pout = t < releaseAt - 1e-9 ? 0 : springValue(t, {start: releaseAt, fps, ...PUNCH_SPRING.out});
  return Math.max(1, 1 + (scale - 1) * pin * (1 - pout));
}

function resolvePunchIn(params, ctx) {
  const b = createFootageBase('punch-in', params, ctx, {allowed: ['scale', 'at', 'focus', 'release'], minDuration: 0.8});
  const {check, canvas, fps, start, end, duration} = b;
  const p = b.params;
  const scale = p.scale === undefined ? 1.12 : check.num(p.scale, 'params.scale', 1.06, 1.25);
  const baseFocus = ctx.base?.focus && Number.isFinite(ctx.base.focus.x) && Number.isFinite(ctx.base.focus.y) ? ctx.base.focus : {x: 0.5, y: 0.42};
  const focusIn = p.focus === undefined ? baseFocus : fraction(check, p.focus, 'params.focus');
  const release = p.release === undefined ? Math.min(0.5, r2(duration * 0.3)) : check.num(p.release, 'params.release', 0.3, 2);
  const punchAt = b.timeOf('punch', p.at, 'params.at', 0, {min: 0, max: duration - release - 0.25});
  const releaseAt = rt(end - release);
  if (releaseAt - punchAt < 0.25 - 1e-9) check.fail('params.release', `leaves ${r2(releaseAt - punchAt)} s between the punch and the release; it needs 0.25 s`);
  const focus = {x: r2(focusIn.x * canvas.width), y: r2(focusIn.y * canvas.height)};
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const sample = t => {
    const s = punchScale(t, {scale, punchAt, releaseAt, fps});
    return {scale: Math.round(s * 1e5) / 1e5, x: r2((1 - s) * (focus.x - cx)), y: r2((1 - s) * (focus.y - cy))};
  };
  const samples = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let f = first; f <= last; f++) samples.push({t: rt(f / fps), ...sample(f / fps)});
  // The camera always lands back on identity at the scene end.
  if (!samples.length || samples.at(-1).t < end - 1e-6) samples.push({t: end, scale: 1, x: 0, y: 0});
  else Object.assign(samples.at(-1), {scale: 1, x: 0, y: 0});
  b.events.push({id: `${b.id}-punch`, name: 'punch', time: punchAt, endTime: rt(Math.min(releaseAt, punchAt + 0.45)), role: 'emphasis', cue: 'whoosh'});
  b.events.push({id: `${b.id}-release`, name: 'release', time: releaseAt, endTime: end, role: 'release'});
  b.model.camera = {target: 'base', focus, scale, punchAt, releaseAt, samples};
  return b.finish({scale, focus, focusFraction: {x: focusIn.x, y: focusIn.y}, punchAt, releaseAt, release}, {
    rect: {x: 0, y: 0, width: canvas.width, height: canvas.height}, role: 'decor', minTextPx: null,
    motion: {enterEnd: Math.min(releaseAt, punchAt + 0.45), exitStart: releaseAt, exitTo: {opacity: 1}}
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

  const dotAt = b.timeOf('point', p.at, 'params.at', 0.1, {min: 0, max: duration - 1.1});
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
  const b = createFootageBase('lower-third', params, ctx, {allowed: ['name', 'title', 'at', 'align', 'tone'], required: ['name'], minDuration: 2});
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
  const t0 = b.timeOf('name', p.at, 'params.at', 0, {min: 0, max: duration - 1.2});
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
  const stagger = p.stagger === undefined ? 0.09 : check.num(p.stagger, 'params.stagger', 0, 0.3);
  const fit = fitText(check, 'params.text', text, {family: 'display', width: safe.width - u(40), preferred: u(portrait ? 180 : 150), min: Math.max(b.min.key, u(96)), maxLines: 2});
  const height = r2(fit.lines * fit.size * 1.04 + u(24));
  const ref = canvas.height / (portrait ? 1920 : 1080);
  const centreY = position === 'upper' ? (portrait ? 520 : 300) * ref : position === 'lower' ? (portrait ? 1250 : 800) * ref : (portrait ? 860 : 540) * ref;
  const y = r2(Math.min(Math.max(centreY - height / 2, safe.y), safe.y + safe.height - height));
  const rect = {x: safe.x, y, width: safe.width, height};
  const t0 = b.timeOf('pop', p.at, 'params.at', 0.05, {min: 0, max: Math.max(0, duration - 0.45 - stagger * (words.length - 1))});
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
// Registry, root, camera

const DEFINITIONS = [
  {id: 'punch-in', describe: 'Footage-led: a spring zoom on the base recording toward a focus point, timed to a word (a camera on the base, not an overlay).',
    params: {scale: '1.06–1.25 (default 1.12)', at, focus: '{x, y} canvas fractions (default base.focus, else {0.5, 0.42})', release: 'seconds before the scene end when the zoom springs back (0.3–2, default min(0.5, 30% of the scene))'},
    events: ['punch', 'release'], resolve: resolvePunchIn, view: punchInView, timeline: punchInTimeline},
  {id: 'footage-callout', describe: 'Footage-led: a claim sticker anchored to a point on the footage by a leader line, placed inside the safe zone.',
    params: {text: 'claim ≤ 42 chars, up to 2 lines', label: 'kicker ≤ 24 (optional)', point: '{x, y} canvas fractions 0.04–0.96 (the anchored spot)', side: 'auto|above|below|left|right', tone: 'primary|paper|dark', tilt: 'degrees −6–6 (default −2)', at},
    events: ['point', 'sticker'], resolve: resolveCallout, view: calloutView, timeline: calloutTimeline},
  {id: 'lower-third', describe: 'Footage-led: a name and title bar that slides in above the caption band.',
    params: {name: 'string ≤ 32', title: 'string ≤ 48 (optional)', align: 'left|center', tone: 'dark|primary', at},
    events: ['name', 'title'], resolve: resolveLowerThird, view: lowerThirdView, timeline: lowerThirdTimeline},
  {id: 'emphasis-caption', describe: 'Footage-led: one to three big words that pop over the footage; hides the captions while on screen.',
    params: {text: '1–3 words, ≤ 24 chars', color: 'primary|accent|paper or #hex (≥ 3:1 on the bg outline)', position: 'center|upper|lower', stagger: 'seconds between words (default 0.09)', at},
    events: ['pop', 'word-<i>'], resolve: resolveEmphasis, view: emphasisView, timeline: emphasisTimeline}
];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, resolve: def.resolve}]));
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
  return ops;
}

/**
 * One op list for every camera in `models` (any resolved models; those without
 * `camera` are ignored), on `target` (default BASE_CAMERA): identity at 0, then
 * one tl.set-style op per camera sample (at t - SAMPLE_LEAD), cameras applied
 * in start order. Both compilers apply it to the base layer.
 */
export function cameraOps(models, {target = BASE_CAMERA} = {}) {
  const cameras = (models ?? []).filter(model => model?.camera && Array.isArray(model.camera.samples)).sort((a, b) => a.start - b.start);
  if (!cameras.length) return [];
  const ops = [{type: 'set', target, time: 0, props: {...CAMERA_IDENTITY}}];
  for (const model of cameras) {
    for (const s of model.camera.samples) ops.push({type: 'set', target, time: Math.max(0, sampleTime(s.t)), props: {x: s.x, y: s.y, scaleX: s.scale, scaleY: s.scale}});
  }
  return ops;
}

/** Camera windows that overlap in time ([[idA, idB], …]); the later camera wins while both run. */
export function cameraOverlaps(models) {
  const cameras = (models ?? []).filter(model => model?.camera).sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 1; i < cameras.length; i++) for (let j = 0; j < i; j++) if (cameras[j].end > cameras[i].start + 1e-6) out.push([cameras[j].sceneId ?? cameras[j].id, cameras[i].sceneId ?? cameras[i].id]);
  return out;
}
