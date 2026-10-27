// Catalogue D module `evidence-clip`: a capture of a real public page
// (launchclip evidence capture, src/evidence/) playing inside a glass frame
// with a brand-accent rim glow, a source tag (publisher · date) under it, and
// optional post moves on top: zooms to boxes in the clip and a cursor that
// glides between points. Registered in kit/core/catalog-d.mjs. Contract:
// docs/KIT_CONTRACTS.md ("Evidence clip"); capture side: docs/EVIDENCE_CAPTURE.md.
//
// Same shape as photo-scene and product-demo: resolve(params, ctx) → a
// JSON-only model, evidenceClipView(model) → {media, overlay} (the <video>,
// then the frame, cursor and source tag above it), evidenceClipTimeline(model)
// → renderer-neutral ops. The video is root media: HyperFrames hoists it to
// the composition root and the overlay one z-index above.
//
// The capture already carries its own beats (scroll, selection, focus ring,
// pins); this module frames it. Its camera is a slow push-in over the whole
// scene (1 → 1 + push, about the window centre) so the frame never holds
// still, times any `focus` zooms, which ease in and out on easeInOutSine with
// the scale in log space. One sample per frame becomes a set on both the video
// and the overlay's camera layer, so the frame, cursor and video move as one.

import {fitText, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, sampleTime, set, tw} from './catalog-b-view.mjs';
import {createFootageBase} from './catalog-c.mjs';
import {grammarDuration} from './grammar.mjs';

export const EVIDENCE_CLIP_TIMING = Object.freeze({minDuration: 2, fade: 0.4, zoomIn: 0.8, zoomOut: 0.7, hold: 2, glide: 0.7, tagLead: 0.35, leadOut: 0.3});
const T = EVIDENCE_CLIP_TIMING;
const FRAMES = ['glass', 'none'];

const ease = p => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, p)))) / 2;

function localVideo(check, value, path) {
  if (typeof value !== 'string' || !value.startsWith('assets/') || value.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(value) || !/\.(mp4|webm|mov)$/i.test(value)) check.fail(path, `must be a project-local assets/ video (.mp4, .webm or .mov); got ${JSON.stringify(value)}`);
  return value;
}

/** A launchclip.evidence.v1 sidecar → evidence-clip params (the clip, its size and the source tag). */
export function evidenceClipParams(record, {src, sourceStart = 0, frame, push, focus, cursor} = {}) {
  const date = record.provenance?.published_at ?? null;
  const params = {media: {src: src ?? `assets/evidence/${record.video}`, sourceStart}, viewport: {width: record.viewport.width, height: record.viewport.height}};
  const publisher = record.provenance?.publisher;
  if (publisher) params.source = {publisher: String(publisher).slice(0, 40), ...(date ? {date: shortDate(date)} : {})};
  if (frame) params.frame = frame;
  if (push !== undefined) params.push = push;
  if (focus) params.focus = focus;
  if (cursor) params.cursor = cursor;
  return params;
}

/** "2026-10-16T17:45:34Z" → "Oct 16, 2026" (UTC). */
export function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 24);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * Focus zooms → camera keys [{t, s, f}] (canvas px). Each zoom eases in over
 * zoomIn, holds, and eases back out unless the next one starts within it, in
 * which case the camera pans straight to it.
 */
export function focusKeys(focus, {start, end, centre}) {
  const rest = {s: 1, f: centre};
  const keys = [{t: start, ...rest}];
  focus.forEach((item, i) => {
    const next = focus[i + 1];
    const inAt = Math.max(keys.at(-1).t, item.at);
    keys.push({t: inAt, s: keys.at(-1).s, f: keys.at(-1).f});
    keys.push({t: rt(Math.min(end, inAt + T.zoomIn)), s: item.s, f: item.f});
    const outAt = Math.min(item.until, end - T.zoomOut, next ? next.at : Infinity);
    if (next && next.at <= item.until + 0.05) return;
    keys.push({t: rt(Math.max(keys.at(-1).t, outAt)), s: item.s, f: item.f});
    keys.push({t: rt(Math.min(end, Math.max(keys.at(-1).t, outAt) + T.zoomOut)), ...rest});
  });
  return keys;
}

/** The camera at t: {s, f} between keys (log-space scale). */
export function focusAt(keys, t) {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  if (!b || b.t <= a.t) return {s: a.s, f: a.f};
  const p = ease((t - a.t) / (b.t - a.t));
  return {s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p), f: {x: a.f.x + (b.f.x - a.f.x) * p, y: a.f.y + (b.f.y - a.f.y) * p}};
}

/**
 * Camera {s, f} plus the push → {scale, x, y} for a transform about the
 * canvas origin: the focus point moves to the centre (it is the centre at
 * rest), then the push scales about the centre.
 */
export function evidenceTransform({s, f}, push, centre) {
  const x = centre.x - s * f.x, y = centre.y - s * f.y;
  return {scale: Math.round(push * s * 1e5) / 1e5, x: r2(push * x + centre.x * (1 - push)) || 0, y: r2(push * y + centre.y * (1 - push)) || 0};
}

function resolveEvidenceClip(params, ctx) {
  const colors = {...(ctx?.brand?.colors ?? {})};
  colors.accent = colors.accent ?? colors.primary;
  colors.ink = colors.ink ?? '#0b0d12';
  const b = createFootageBase('evidence-clip', params, {...ctx, brand: {...(ctx?.brand ?? {}), colors}}, {allowed: ['media', 'viewport', 'source', 'frame', 'push', 'focus', 'cursor', 'title'], required: ['media', 'viewport'], minDuration: T.minDuration});
  const {check, canvas, fps, start, end, duration, u, theme} = b;
  const p = b.params;
  check.obj(p.media, 'params.media', ['src', 'sourceStart'], ['src']);
  const media = {kind: 'video', src: localVideo(check, p.media.src, 'params.media.src'), sourceStart: p.media.sourceStart === undefined ? 0 : check.num(p.media.sourceStart, 'params.media.sourceStart', 0, 3600)};
  check.obj(p.viewport, 'params.viewport', ['width', 'height'], ['width', 'height']);
  const viewport = {width: check.int(p.viewport.width, 'params.viewport.width', 320, 7680), height: check.int(p.viewport.height, 'params.viewport.height', 240, 4320)};
  const frame = p.frame === undefined ? 'glass' : check.oneOf(p.frame, 'params.frame', FRAMES);
  const pushBy = p.push === undefined ? 0.04 : check.num(p.push, 'params.push', 0, 0.12);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);

  // Source tag: "Publisher · Oct 16, 2026" in a glass pill under the window; publisher and date on two lines when one is too wide (portrait).
  let source = null;
  if (p.source !== undefined) {
    check.obj(p.source, 'params.source', ['publisher', 'date'], ['publisher']);
    const parts = [check.str(p.source.publisher, 'params.source.publisher', 40), p.source.date === undefined ? null : check.str(p.source.date, 'params.source.date', 24)].filter(Boolean);
    const padX = u(26), padY = u(14), dot = u(26);
    const room = b.safe.width - padX * 2 - dot;
    const preferred = Math.max(b.min.key, u(30));
    const lines = textWidth(parts.join('  ·  '), preferred, 'meta') <= room ? [parts.join('  ·  ')] : parts;
    const size = Math.min(...lines.map((line, i) => fitText(check, `params.source${lines.length > 1 ? `.${i ? 'date' : 'publisher'}` : ''}`, line, {family: 'meta', width: room, preferred, min: b.min.key, maxLines: 1}).size));
    const textW = Math.max(...lines.map(line => textWidth(line, size, 'meta')));
    source = {lines, size, padX, padY, width: r2(textW + padX * 2 + dot), height: r2(size * 1.25 * lines.length + padY * 2)};
  }

  // Window: the clip's aspect fitted in the safe zone above the caption band, leaving room for the tag and the bezel.
  const bezel = frame === 'glass' ? u(14) : 0;
  const gap = source ? u(22) : 0;
  const zone = b.safe;
  const aspect = viewport.width / viewport.height;
  const room = {width: zone.width - bezel * 2, height: zone.height - bezel * 2 - (source ? source.height + gap : 0)};
  const width = Math.min(room.width, room.height * aspect), height = width / aspect;
  const blockH = height + bezel * 2 + (source ? source.height + gap : 0);
  const rect = {x: r2(zone.x + (zone.width - width) / 2), y: r2(zone.y + (zone.height - blockH) / 2 + bezel), width: r2(width), height: r2(height)};
  if (source) source.box = {x: r2(rect.x + rect.width / 2 - source.width / 2), y: r2(rect.y + rect.height + bezel + gap), width: source.width, height: source.height};
  const k = rect.width / viewport.width;
  const toCanvas = (pt) => ({x: r2(rect.x + pt.x * k), y: r2(rect.y + pt.y * k)});
  const centre = {x: r2(rect.x + rect.width / 2), y: r2(rect.y + rect.height / 2)};

  // Focus zooms: boxes in clip px, in order, not overlapping.
  const focusIn = p.focus === undefined ? [] : check.arr(p.focus, 'params.focus', 0, 4);
  let lastAt = -Infinity;
  const focus = focusIn.map((item, i) => {
    const path = `params.focus[${i}]`;
    check.obj(item, path, ['at', 'box', 'scale', 'until'], ['at', 'box']);
    const at = rt(start + check.num(item.at, `${path}.at`, 0, duration - 1));
    if (at < lastAt) check.fail(`${path}.at`, 'must not be earlier than the previous focus');
    check.obj(item.box, `${path}.box`, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    const bx = check.num(item.box.x, `${path}.box.x`, 0, viewport.width), by = check.num(item.box.y, `${path}.box.y`, 0, viewport.height);
    const bw = check.num(item.box.width, `${path}.box.width`, 8, viewport.width - bx), bh = check.num(item.box.height, `${path}.box.height`, 8, viewport.height - by);
    const fill = Math.min((0.6 * canvas.width) / (bw * k), (0.6 * canvas.height) / (bh * k));
    const s = item.scale === undefined ? Math.round(Math.min(2, Math.max(1.15, fill)) * 1e4) / 1e4 : check.num(item.scale, `${path}.scale`, 1.05, 2.5);
    const until = item.until === undefined ? rt(at + T.zoomIn + T.hold) : rt(start + check.num(item.until, `${path}.until`, item.at + 0.5, duration));
    lastAt = until;
    return {index: i, at, until, s, f: toCanvas({x: bx + bw / 2, y: by + bh / 2}), box: {x: bx, y: by, width: bw, height: bh}};
  });
  const keys = focusKeys(focus, {start, end, centre});
  const samples = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let n = first; n <= last; n++) {
    const t = n / fps;
    const push = 1 + pushBy * Math.min(1, Math.max(0, (t - start) / duration));
    samples.push({t: rt(t), ...evidenceTransform(focusAt(keys, t), push, centre)});
  }
  for (const item of focus) b.events.push({id: `${b.id}-focus-${item.index}`, name: `focus-${item.index}`, time: item.at, endTime: rt(item.at + T.zoomIn), role: 'move', cue: 'whoosh-soft'});

  // Post cursor: points in clip px; it appears at the first and glides to each next, arriving at its time.
  const cursorIn = p.cursor === undefined ? [] : check.arr(p.cursor, 'params.cursor', 0, 12);
  let prevAt = -Infinity;
  const cursor = cursorIn.map((item, i) => {
    const path = `params.cursor[${i}]`;
    check.obj(item, path, ['at', 'x', 'y', 'click'], ['at', 'x', 'y']);
    const at = rt(start + check.num(item.at, `${path}.at`, 0, duration - T.leadOut));
    if (at < prevAt + 0.2) check.fail(`${path}.at`, 'must be at least 0.2 s after the previous point');
    prevAt = at;
    const pt = toCanvas({x: check.num(item.x, `${path}.x`, 0, viewport.width), y: check.num(item.y, `${path}.y`, 0, viewport.height)});
    const click = item.click === undefined ? false : check.bool(item.click, `${path}.click`);
    if (click) b.events.push({id: `${b.id}-click-${i}`, name: `click-${i}`, time: at, endTime: rt(at + 0.12), role: 'action', cue: 'click'});
    return {index: i, at, x: pt.x, y: pt.y, click};
  });

  const fadeIn = grammarDuration(ctx?.grammar, 'enter', T.fade, {min: 0.2, max: 0.8}), fadeOut = grammarDuration(ctx?.grammar, 'exit', T.fade, {min: 0.2, max: 0.8});
  b.events.push({id: `${b.id}-enter`, name: 'enter', time: rt(start + fadeIn), role: 'enter'});
  if (source) {
    source.at = rt(Math.min(end - T.leadOut - 0.4, start + fadeIn + T.tagLead));
    b.events.push({id: `${b.id}-source`, name: 'source', time: source.at, endTime: rt(source.at + 0.4), role: 'emphasis'});
  }
  const content = {media, viewport, frame, title, rect, bezel, radius: u(16), accent: colors.accent, surface: theme.bg, paper: theme.paper, muted: theme.muted, source, focus, cursor, keys, samples, push: pushBy, cursorSize: u(34)};
  const outer = {x: r2(rect.x - bezel), y: r2(rect.y - bezel), width: r2(rect.width + bezel * 2), height: r2(blockH)};
  const model = b.finish(content, {rect: outer, role: 'media', minTextPx: source ? source.size : null,
    motion: {enterEnd: rt(start + fadeIn), exitStart: rt(end - fadeOut), enterFrom: {opacity: 0}, exitTo: {opacity: 0}, enterEase: 'power2.out', exitEase: 'power2.in'}});
  // Its own push is the rest motion.
  model.layout.drift = false;
  return model;
}

// ---------------------------------------------------------------------------
// View and timeline

// The arrow on a 26-unit box: its fill, and the outline 1.4 units outside it.
const CURSOR_FILL = [[3.5, 2.5], [3.5, 20.5], [8.2, 16.4], [11.6, 23.6], [14.9, 22.1], [11.6, 15.1], [18, 14.9]];
const CURSOR_EDGE = [[2.1, -0.8], [2.1, 23.6], [7.7, 18.8], [10.9, 25.6], [16.8, 22.9], [13.7, 16.4], [21.4, 16.2]];

/** Element trees: {media, overlay}. media is the <video>; overlay holds the camera layer (frame, cursor) and the source tag. */
export function evidenceClipView(model) {
  const {id, canvas, fonts, unit} = model;
  const c = model.content, R = c.rect, B = c.bezel;
  const media = el('video', `${id}-media`, abs(R.x, R.y, R.width, R.height, {objectFit: 'fill', borderRadius: c.radius, background: '#000000',
    opacity: 0, transformOrigin: `${r2(-R.x)}px ${r2(-R.y)}px`}), [], {src: c.media.src, muted: '', playsinline: ''});
  const kids = [];
  if (c.frame === 'glass') {
    // The bezel: a translucent glass border round the clip (it never covers the clip), a hairline at the
    // clip's edge, and the accent rim glow outside.
    kids.push(el('div', `${id}-bezel`, abs(R.x - B, R.y - B, R.width + B * 2, R.height + B * 2, {boxSizing: 'border-box', border: `${B}px solid ${c.paper}12`, borderRadius: c.radius + B,
      boxShadow: `0 0 0 ${r2(1.5 * unit)}px ${c.accent}8c, 0 0 ${r2(28 * unit)}px ${c.accent}59, 0 0 ${r2(90 * unit)}px ${c.accent}26, 0 ${r2(40 * unit)}px ${r2(90 * unit)}px #000000a6, inset 0 0 0 ${r2(1 * unit)}px ${c.paper}2e`})));
  }
  if (c.cursor.length) {
    // An arrow drawn with two clip-path polygons (a white outline, a black fill), so both renderers draw it from style alone.
    const poly = (pts) => `polygon(${pts.map(([x, y]) => `${r2((x / 26) * 100)}% ${r2((y / 26) * 100)}%`).join(', ')})`;
    kids.push(el('div', `${id}-cursor`, abs(0, 0, c.cursorSize, c.cursorSize, {opacity: 0, filter: `drop-shadow(0 ${r2(2 * unit)}px ${r2(4 * unit)}px #00000080)`}), [
      el('div', `${id}-cursor-edge`, abs(0, 0, c.cursorSize, c.cursorSize, {background: '#ffffff', clipPath: poly(CURSOR_EDGE)})),
      el('div', `${id}-cursor-fill`, abs(0, 0, c.cursorSize, c.cursorSize, {background: '#111111', clipPath: poly(CURSOR_FILL)}))
    ]));
  }
  const cam = el('div', `${id}-cam`, abs(0, 0, canvas.width, canvas.height, {transformOrigin: '0px 0px'}), kids);
  const roots = [cam];
  if (c.source) {
    const S = c.source;
    roots.push(el('div', `${id}-source`, abs(S.box.x, S.box.y, S.box.width, S.box.height, {boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: r2(12 * unit), padding: `${S.padY}px ${S.padX}px`,
      borderRadius: r2(S.height / 2), background: `${c.surface}d9`, border: `${r2(1 * unit)}px solid ${c.paper}33`, color: c.paper, fontFamily: fonts.meta, fontSize: S.size, lineHeight: '1.25', whiteSpace: 'nowrap',
      boxShadow: `0 ${r2(12 * unit)}px ${r2(30 * unit)}px #00000080`, opacity: 0, transformOrigin: '50% 50%'}), [
      el('div', `${id}-source-dot`, {width: r2(10 * unit), height: r2(10 * unit), borderRadius: '50%', background: c.accent, boxShadow: `0 0 ${r2(10 * unit)}px ${c.accent}`, flex: 'none'}),
      el('div', `${id}-source-text`, {display: 'flex', flexDirection: 'column'}, S.lines.map((line, i) => el('div', `${id}-source-line-${i}`, {color: i ? c.muted : c.paper}, [line])))
    ]));
  }
  const overlay = el('div', `${id}-overlay`, abs(0, 0, canvas.width, canvas.height, {opacity: 0, pointerEvents: 'none'}), roots);
  return {media, overlay};
}

/** Renderer-neutral ops: fades, the per-frame camera on the video and camera layer, the cursor's glides, the source tag. */
export function evidenceClipTimeline(model) {
  const {id, start, end} = model;
  const c = model.content, m = model.motion;
  const ops = [];
  for (const target of [`${id}-media`, `${id}-overlay`]) {
    set(ops, target, start, {opacity: 0});
    tw(ops, target, start, m.enterDuration, m.enterEase, {opacity: 0}, {opacity: 1});
    tw(ops, target, m.exitStart, m.exitDuration, m.exitEase, {opacity: 1}, {opacity: 0});
    set(ops, target, end, {opacity: 0});
  }
  let previous = null;
  for (const sample of c.samples) {
    const key = `${sample.x},${sample.y},${sample.scale}`;
    if (key === previous) continue;
    previous = key;
    for (const target of [`${id}-media`, `${id}-cam`]) ops.push({type: 'set', target, time: Math.max(0, sampleTime(sample.t)), props: {x: sample.x, y: sample.y, scaleX: sample.scale, scaleY: sample.scale}});
  }
  if (c.cursor.length) {
    const target = `${id}-cursor`, tip = (pt) => ({x: r2(pt.x - c.cursorSize * 3.5 / 26), y: r2(pt.y - c.cursorSize * 2.5 / 26)});
    const first = c.cursor[0];
    set(ops, target, start, {opacity: 0, ...tip(first), scaleX: 1, scaleY: 1});
    tw(ops, target, Math.max(start, first.at - 0.3), 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    for (let i = 1; i < c.cursor.length; i++) {
      const a = c.cursor[i - 1], b = c.cursor[i];
      const from = Math.max(a.at + 0.05, b.at - T.glide);
      tw(ops, target, from, rt(b.at - from), 'sine.inOut', tip(a), tip(b));
    }
    for (const point of c.cursor.filter(item => item.click)) {
      tw(ops, target, point.at, 0.08, 'power2.out', {scaleX: 1, scaleY: 1}, {scaleX: 0.86, scaleY: 0.86});
      tw(ops, target, rt(point.at + 0.08), 0.12, 'power2.out', {scaleX: 0.86, scaleY: 0.86}, {scaleX: 1, scaleY: 1});
    }
  }
  if (c.source) {
    const target = `${id}-source`;
    set(ops, target, start, {opacity: 0, y: model.unit * 16});
    tw(ops, target, c.source.at, 0.45, 'power3.out', {opacity: 0, y: model.unit * 16}, {opacity: 1, y: 0});
  }
  return ops;
}

export const evidenceClip = {
  id: 'evidence-clip',
  describe: 'A capture of a real public page (launchclip evidence capture: a PR diff, a model card, an announcement, an article) playing in a glass window with an accent rim glow and a source tag (publisher · date), with optional post zooms to boxes in the clip and a gliding cursor. Keeps captions.',
  params: {
    media: '{src: "assets/evidence/<id>.mp4", sourceStart?: seconds}',
    viewport: '{width, height} of the capture in px (from <id>.evidence.json) — build with evidenceClipParams(sidecar) or launchclip evidence scene',
    source: '{publisher ≤ 40, date? ≤ 24} the tag under the window (default from the sidecar provenance)',
    frame: 'glass|none (default glass)',
    push: '0–0.12, the slow push-in over the scene (default 0.04)',
    focus: '[{at, box: {x, y, width, height} capture px, scale? 1.05–2.5, until?}] ≤ 4, in order: post zooms on top of the capture\'s own beats',
    cursor: '[{at, x, y (capture px), click?}] ≤ 12, ≥ 0.2 s apart: a post cursor that glides to each point by its time',
    title: 'string ≤ 60 (optional, for logs)'
  },
  events: ['enter', 'source', 'focus-<i>', 'click-<i>'],
  timing: {minDuration: T.minDuration, leadIn: 0, leadOut: T.leadOut, gaps: [],
    rules: [`focus[].at in order; each zooms in over ${T.zoomIn} s, holds to until (default ${T.hold} s after landing) and eases out over ${T.zoomOut} s unless the next starts first`, `cursor[].at at least 0.2 s apart; each glide takes up to ${T.glide} s and lands on the point's time`]},
  resolve: resolveEvidenceClip
};
