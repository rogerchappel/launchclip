// Catalogue H channel furniture (VISUAL_GAP_MAP C5): the pieces a channel
// puts round its videos rather than in them. Every surface is the rim-glass
// panel (kit/core/panels.mjs) whatever the story's own panel, so the
// furniture reads as the channel's on any style; colours are the brand's.
//
//   logo-sting         intro/outro: a glass logo tile lands over a reflective
//                      floor in rain, rising particles or clear air, then the
//                      channel name resolves out of a blur
//   subscribe-cta      a glass pill slides in, a cursor clicks Subscribe, the
//                      button turns to Subscribed, the bell rings, the like
//                      fills, and the pill slides out; placeable mid-video
//                      on an overlay track
//   channel-watermark  a small glass corner mark held across scenes
//
// The logo is params.logo (an assets/ image) or a monogram from the name.
// Rain and particles are seek-safe loop ops on tiled sheets (a linear wrap,
// catalog-b-view.mjs loopValue), so any frame is a pure function of time.

import {timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, createHBase, fitText, inkOn, r2, rt, textWidth} from './catalog-h-base.mjs';
import {abs, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {iconNode} from './icons.mjs';
import {panelSurfaceStyle, withAlpha} from './panels.mjs';
import {hashString, seededRandom} from './ambient.mjs';

const TIMING = timingRules();
const OVERFLOW = {'data-layout-allow-overflow': 'true'};

// The channel's mark: an image, or up to three letters from the name.
function channelMark(b, p) {
  const {check} = b;
  const name = check.str(p.name, 'params.name', 32);
  const logo = p.logo === undefined ? null : check.asset(p.logo, 'params.logo');
  const auto = name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toUpperCase();
  const monogram = p.monogram === undefined ? auto : check.str(p.monogram, 'params.monogram', 3);
  return {name, logo, monogram};
}

// The layout gate sees what the module draws (a pill, a corner mark), not its whole rect, so an overlay collides only where it really covers.
function boxLayout(model, box) {
  model.layout.rect = {x: r2(model.rect.x + box.x), y: r2(model.rect.y + box.y), width: box.width, height: box.height};
  return model;
}

const glass = (model, radius) => panelSurfaceStyle('rim-glass', {colors: model.theme, unit: model.unit, radius: radius / model.unit});

// The mark inside a square of side `size` at (x, y): the logo image, or the monogram in the display face with a rim-coloured glow.
function markNode(model, mark, x, y, size, {id = null} = {}) {
  const {theme, fonts} = model;
  if (mark.logo) return el('img', id, abs(r2(x + size * 0.19), r2(y + size * 0.19), r2(size * 0.62), r2(size * 0.62), {objectFit: 'contain', display: 'block'}), [], {src: mark.logo, alt: ''});
  const letters = [...mark.monogram].length;
  const fs = r2(size * (letters > 2 ? 0.3 : letters > 1 ? 0.38 : 0.5));
  return label(id, x, r2(y + size / 2 - fs * 0.6), size, mark.monogram, {size: fs, family: fonts.display, color: theme.paper, align: 'center', weight: 800,
    extra: {textShadow: `0 0 ${r2(fs * 0.35)}px ${withAlpha(theme.primary, 0.7)}`}});
}

// A tile of streaks (rain) or dots (particles) as an SVG data URI, seeded by the module id.
function weatherTile(kind, seed, w, h, color, u, near) {
  const random = seededRandom(hashString(`${seed}:${kind}:${near ? 'near' : 'far'}`));
  let body = '';
  if (kind === 'rain') {
    const count = near ? 26 : 70;
    for (let i = 0; i < count; i++) {
      const x = random() * w, y = random() * h, len = (near ? 70 : 34) * u * (0.6 + random() * 0.8), a = (near ? 0.55 : 0.35) * (0.4 + random() * 0.6);
      // A copy one tile up, so a streak crossing the seam wraps.
      for (const dy of [0, -h]) body += `<line x1="${r2(x)}" y1="${r2(y + dy)}" x2="${r2(x - len * 0.08)}" y2="${r2(y + dy + len)}" stroke="${color}" stroke-opacity="${r2(a)}" stroke-width="${r2((near ? 2.4 : 1.3) * u)}" stroke-linecap="round"/>`;
    }
  } else {
    const count = near ? 14 : 46;
    for (let i = 0; i < count; i++) {
      const x = random() * w, y = random() * h, r = (near ? 4.5 : 1.8) * u * (0.6 + random() * 0.8), a = (near ? 0.5 : 0.6) * (0.35 + random() * 0.65);
      for (const dy of [0, h]) body += `<circle cx="${r2(x)}" cy="${r2(y + dy)}" r="${r2(r)}" fill="${color}" fill-opacity="${r2(a)}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">${body}</svg>`;
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

// ---------------------------------------------------------------------------
// logo-sting

const STING_VARIANTS = Object.freeze(['rain', 'particles', 'clear']);

function stingResolve(params, ctx) {
  const b = createHBase('logo-sting', params, ctx, {allowed: ['name', 'logo', 'monogram', 'tagline', 'at'], required: ['name'], variants: STING_VARIANTS, hidesCaptions: true});
  const {check, u, rect} = b;
  const p = b.params;
  const mark = channelMark(b, p);
  const tagline = p.tagline === undefined ? null : check.str(p.tagline, 'params.tagline', 48);
  const W = rect.width, H = rect.height;
  const T = r2(Math.min(W * 0.36, H * 0.4, u(400)));
  const tile = {x: r2((W - T) / 2), y: r2(H * 0.4 - T / 2 - u(30)), size: T};
  const floorY = r2(tile.y + T + T * 0.07);
  const nameFit = fitText(check, 'params.name', mark.name, {family: 'display', width: W * 0.8, preferred: u(96), min: b.min.key, maxLines: 1});
  const tagFit = tagline ? fitText(check, 'params.tagline', tagline, {family: 'meta', width: W * 0.8, preferred: u(34), min: b.min.meta, maxLines: 1}) : null;
  const nameY = r2(floorY + T * 0.34);
  const tagY = r2(nameY + nameFit.size * 1.3);
  if ((tagFit ? tagY + tagFit.size * 1.3 : nameY + nameFit.size * 1.2) > H + 1e-6) check.fail('params', 'the name and tagline do not fit under the logo; shorten them or give the scene a taller rect');
  const land = b.timeOf('logo', p.at, 'params.at', 0.6);
  const nameAt = rt(land + 0.5);
  if (nameAt - b.start > b.lastEvent) check.fail('params.at', 'leaves no time for the name before the exit; lengthen the scene or land the logo earlier');
  b.events.push({id: `${b.id}-logo`, name: 'logo', time: land, role: 'emphasis', cue: 'shimmer'});
  b.events.push({id: `${b.id}-name`, name: 'name', time: nameAt, role: 'emphasis', cue: 'whoosh-soft'});
  // Weather covers the canvas behind the rect: px relative to the rect.
  const canvas = {x: r2(-rect.x), y: r2(-rect.y), width: b.canvas.width, height: b.canvas.height};
  const tileH = r2(u(520)), tileW = r2(u(420));
  const content = {variant: b.variant, mark, tagline, tile, floorY, nameY, tagY, nameSize: r2(nameFit.size), tagSize: tagFit ? r2(tagFit.size) : 0, land, nameAt, canvas, tileW, tileH,
    weather: b.variant === 'clear' ? null : {near: weatherTile(b.variant, b.id, tileW, tileH, b.colors.paper, b.unit, true), far: weatherTile(b.variant, b.id, tileW, tileH, b.colors.primary, b.unit, false)}};
  return b.finish(content, {minTextPx: tagFit ? Math.min(nameFit.size, b.min.key) : nameFit.size});
}

function stingView(model) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const {x, y, size: T} = c.tile;
  const W = model.rect.width;
  const out = [];
  if (c.weather) for (const depth of ['far', 'near']) {
    out.push(el('div', `${id}-${depth}`, {...abs(c.canvas.x, r2(c.canvas.y - c.tileH), c.canvas.width, r2(c.canvas.height + c.tileH * 2)), backgroundImage: c.weather[depth], backgroundSize: `${c.tileW}px ${c.tileH}px`,
      opacity: 0, ...(depth === 'near' ? {filter: `blur(${r2(1.6 * u)}px)`} : {})}, [], OVERFLOW));
  }
  // The floor: a sheen under the tile and a lit line across it.
  out.push(el('div', `${id}-sheen`, {...abs(r2(W * 0.1), r2(c.floorY - T * 0.45), r2(W * 0.8), r2(T * 0.9)), background: `radial-gradient(closest-side, ${withAlpha(theme.primary, 0.2)} 0%, ${withAlpha(theme.primary, 0.06)} 55%, ${withAlpha(theme.primary, 0)} 100%)`, opacity: 0}));
  out.push(el('div', `${id}-floor`, {...abs(r2(W * 0.08), c.floorY, r2(W * 0.84), r2(2 * u)), background: `linear-gradient(90deg, ${withAlpha(theme.primary, 0)} 0%, ${withAlpha(theme.primary, 0.85)} 50%, ${withAlpha(theme.primary, 0)} 100%)`,
    boxShadow: `0 0 ${r2(16 * u)}px ${withAlpha(theme.primary, 0.6)}`, transformOrigin: '50% 50%', opacity: 0}));
  // The reflection: the tile mirrored under the floor (a static flip about the
  // wrapper's centre, so its mask still covers it), fading with depth.
  const tileNodes = (prefix) => [el('div', null, {...abs(0, 0, T, T), ...glass(model, T * 0.22)}), markNode(model, c.mark, 0, 0, T),
    el('div', null, {...abs(0, 0, T, T), borderRadius: r2(T * 0.22), overflow: 'hidden'}, [
      el('div', `${id}-${prefix}shine`, {...abs(0, 0, T, T), background: 'linear-gradient(115deg, #ffffff00 30%, #ffffff4d 45%, #ffffff00 60%)', opacity: 0})])];
  out.push(el('div', null, {...abs(x, r2(c.floorY + T * 0.07), T, T), transform: 'scaleY(-1)', transformOrigin: '50% 50%',
    maskImage: 'linear-gradient(to top, #000000 0%, #00000059 30%, #00000000 62%)', WebkitMaskImage: 'linear-gradient(to top, #000000 0%, #00000059 30%, #00000000 62%)'}, [
    el('div', `${id}-reflection`, {...abs(0, 0, T, T), opacity: 0}, tileNodes('r'))]));
  out.push(el('div', `${id}-mark`, {...abs(x, y, T, T), opacity: 0, transformOrigin: '50% 50%'}, tileNodes('')));
  out.push(label(`${id}-name`, 0, c.nameY, W, c.mark.name, {size: c.nameSize, family: fonts.display, color: theme.paper, align: 'center', weight: 800, spacing: '0.01em', extra: {opacity: 0}}));
  if (c.tagline) out.push(label(`${id}-tagline`, 0, c.tagY, W, c.tagline, {size: c.tagSize, family: fonts.meta, color: theme.primary, align: 'center', spacing: '0.12em', extra: {opacity: 0}}));
  return out;
}

function stingTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content;
  const T = c.tile.size;
  if (c.weather) {
    const end = motion.end;
    for (const [depth, speed] of [['far', 380], ['near', 900]]) {
      set(ops, `${id}-${depth}`, start, {opacity: 0, x: 0, y: 0});
      tw(ops, `${id}-${depth}`, start, 0.8, 'power1.out', {opacity: 0}, {opacity: depth === 'near' ? 0.7 : 0.9});
      // Rain falls a tile per cycle; particles rise.
      const cycle = rt((c.tileH / (speed * u)) * (c.variant === 'rain' ? 1 : 6));
      const repeats = Math.max(1, Math.ceil((end - start) / cycle));
      ops.push({type: 'loop', target: `${id}-${depth}`, start, cycle, repeats, from: {y: c.variant === 'rain' ? 0 : r2(c.tileH)}, to: {y: c.variant === 'rain' ? r2(c.tileH) : 0}});
    }
  }
  set(ops, `${id}-floor`, start, {opacity: 0, scaleX: 0, scaleY: 1});
  tw(ops, `${id}-floor`, rt(c.land - 0.35), 0.8, 'power3.out', {opacity: 0, scaleX: 0}, {opacity: 1, scaleX: 1});
  set(ops, `${id}-sheen`, start, {opacity: 0});
  tw(ops, `${id}-sheen`, c.land, 0.7, 'power2.out', {opacity: 0}, {opacity: 1});
  // The tile drops onto the floor out of a blur; its reflection rises to meet it.
  const drop = r2(T * 0.16);
  set(ops, `${id}-mark`, start, {opacity: 0, x: 0, y: -drop, scaleX: 0.88, scaleY: 0.88, blur: r2(16 * u)});
  tw(ops, `${id}-mark`, rt(c.land - 0.6), 0.6, 'power3.out', {opacity: 0, y: -drop, scaleX: 0.88, scaleY: 0.88, blur: r2(16 * u)}, {opacity: 1, y: 0, scaleX: 1, scaleY: 1, blur: 0});
  set(ops, `${id}-reflection`, start, {opacity: 0, x: 0, y: -drop});
  tw(ops, `${id}-reflection`, rt(c.land - 0.6), 0.6, 'power3.out', {opacity: 0, y: -drop}, {opacity: 0.45, y: 0});
  for (const prefix of ['', 'r']) {
    set(ops, `${id}-${prefix}shine`, start, {opacity: 0, x: -T, y: 0});
    set(ops, `${id}-${prefix}shine`, rt(c.land + 0.15), {opacity: 1});
    tw(ops, `${id}-${prefix}shine`, rt(c.land + 0.15), 0.8, 'power2.inOut', {x: -T}, {x: T});
  }
  set(ops, `${id}-name`, start, {opacity: 0, x: 0, y: r2(10 * u), blur: r2(14 * u)});
  tw(ops, `${id}-name`, c.nameAt, 0.6, 'power3.out', {opacity: 0, y: r2(10 * u), blur: r2(14 * u)}, {opacity: 1, y: 0, blur: 0});
  if (c.tagline) riseOps(ops, `${id}-tagline`, start, rt(c.nameAt + 0.3), r2(10 * u));
}

export const logoSting = {
  id: 'logo-sting',
  describe: 'A channel intro or outro: a glass logo tile drops onto a reflective, lit floor in falling rain (or rising particles, or clear air), a shine sweeps it, and the channel name resolves out of a blur with an optional tagline. Hides captions.',
  params: {name: 'string ≤ 32, the channel name', logo: 'assets/… image (optional; default: a monogram)', monogram: 'string ≤ 3 (default: the name\'s initials)', tagline: 'string ≤ 48 under the name (optional)',
    at: 'seconds from the scene start the logo lands (default 0.6)', variant: VARIANT_PARAM},
  events: ['logo', 'name'], timing: TIMING, variants: STING_VARIANTS,
  resolve: stingResolve, view: stingView, timeline: stingTimeline
};

// ---------------------------------------------------------------------------
// subscribe-cta

const CTA_VARIANTS = Object.freeze(['pill', 'compact']);
const CTA_POSITIONS = ['left', 'center', 'right'];

function ctaResolve(params, ctx) {
  const b = createHBase('subscribe-cta', params, ctx, {allowed: ['name', 'logo', 'monogram', 'label', 'done', 'position', 'bell', 'like', 'at'], required: ['name'], variants: CTA_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const mark = channelMark(b, p);
  const text = {label: p.label === undefined ? 'Subscribe' : check.str(p.label, 'params.label', 14), done: p.done === undefined ? 'Subscribed' : check.str(p.done, 'params.done', 14)};
  const position = p.position === undefined ? 'center' : check.oneOf(p.position, 'params.position', CTA_POSITIONS);
  const bell = p.bell === undefined ? true : check.bool(p.bell, 'params.bell');
  // The like joins the full pill on a wide canvas; a portrait pill keeps to avatar, name, button and bell.
  const like = p.like === undefined ? b.variant === 'pill' && !b.portrait : check.bool(p.like, 'params.like');
  const compact = b.variant === 'compact';
  const H = r2(Math.max(u(compact ? 92 : 112), b.min.key * 2.3));
  const pad = r2(H * 0.16), avatar = r2(H * 0.72), gap = r2(H * 0.2);
  const nameSize = r2(Math.max(b.min.key, H * 0.34));
  const btnSize = r2(Math.max(b.min.key, H * 0.3));
  const nameW = compact ? 0 : r2(textWidth(mark.name, nameSize, 'body') * 1.04);
  const btnW = r2(Math.max(textWidth(text.label, btnSize, 'body'), textWidth(text.done, btnSize, 'body')) + H * 0.6);
  const btnH = r2(H * 0.62);
  const icon = r2(H * 0.42);
  const icons = (bell ? 1 : 0) + (like ? 1 : 0);
  const W = r2(pad + avatar + gap + (compact ? 0 : nameW + gap) + btnW + icons * (gap + icon) + pad * 1.6);
  if (W > rect.width + 1e-6) check.fail(compact ? 'params.label' : 'params.name', `makes the pill ${Math.round(W)} px wide, wider than the rect (${Math.round(rect.width)} px); shorten it or use the compact variant`);
  const x = position === 'left' ? 0 : position === 'right' ? r2(rect.width - W) : r2((rect.width - W) / 2);
  const pill = {x, y: r2(rect.height - H), width: W, height: H};
  let cursor = r2(pad + avatar + gap);
  const nameX = cursor;
  if (!compact) cursor = r2(cursor + nameW + gap);
  const btn = {x: cursor, y: r2((H - btnH) / 2), width: btnW, height: btnH};
  cursor = r2(cursor + btnW + gap);
  const bellBox = bell ? {x: cursor, y: r2((H - icon) / 2), size: icon} : null;
  if (bell) cursor = r2(cursor + icon + gap);
  const likeBox = like ? {x: cursor, y: r2((H - icon) / 2), size: icon} : null;
  // In, click, out: the click needs the pill settled and time after it for the bell and like.
  const inAt = rt(b.start + Math.min(0.2, b.duration * 0.05));
  const click = b.timeOf('click', p.at, 'params.at', Math.max(1.3, b.duration * 0.42), {min: 1.1});
  const outAt = rt(b.motion.exitStart - 0.25);
  if (outAt - click < 1.1) check.fail(p.at === undefined ? 'scene' : 'params.at', `leaves ${r2(outAt - click)} s between the click and the slide out; it needs 1.1 s (lengthen the scene to at least ${r2(click - b.start + 1.1 + 0.25 + b.motion.exitDuration)} s or click earlier)`);
  b.events.push({id: `${b.id}-in`, name: 'in', time: inAt, role: 'enter', cue: 'whoosh-soft'});
  b.events.push({id: `${b.id}-click`, name: 'click', time: click, role: 'emphasis', cue: 'click'});
  if (bell) b.events.push({id: `${b.id}-bell`, name: 'bell', time: rt(click + 0.35), role: 'emphasis', cue: 'ding-soft'});
  b.events.push({id: `${b.id}-out`, name: 'out', time: outAt, role: 'exit', cue: 'whoosh-soft'});
  const fill = b.colors.accent;
  const content = {variant: b.variant, mark, text, pill, pad, avatar, nameX, nameSize, btn, btnSize, bellBox, likeBox, inAt, click, outAt, fill, onFill: inkOn(b.colors, fill), compact};
  // The pill slides on its own; the root only fades, so nothing drifts upward on the way out.
  b.model.motion.enterFrom = {opacity: 0, x: 0, y: 0, scale: 1};
  b.model.motion.exitTo = {opacity: 0, x: 0, y: 0, scale: 1};
  return boxLayout(b.finish(content, {minTextPx: Math.min(btnSize, compact ? btnSize : nameSize)}), pill);
}

// An arrow pointer, white with a dark edge, tip at (0, 0) of its box.
function pointerNode(id, x, y, size, ink) {
  const d = 'M2 2 L2 30 L9.5 23.5 L14.5 34 L19.5 31.5 L14.5 21.5 L24 21.5 Z';
  return el('div', id, {...abs(x, y, size, size), opacity: 0, transformOrigin: '8% 6%'}, [
    el('svg', null, {position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible', filter: `drop-shadow(0 ${r2(size * 0.06)}px ${r2(size * 0.1)}px #00000099)`},
      [el('path', null, null, [], {d, fill: '#ffffff', stroke: ink, strokeWidth: 1.8, strokeLinejoin: 'round'})], {width: size, height: size, viewBox: '0 0 36 36', fill: 'none'})]);
}

function ctaView(model) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const P = c.pill, B = c.btn;
  const inner = [el('div', null, {...abs(0, 0, P.width, P.height), ...glass(model, P.height / 2)})];
  const ay = r2((P.height - c.avatar) / 2);
  inner.push(el('div', null, {...abs(c.pad, ay, c.avatar, c.avatar), ...glass(model, c.avatar / 2)}), markNode(model, c.mark, c.pad, ay, c.avatar));
  if (!c.compact) inner.push(label(null, c.nameX, r2(P.height / 2 - c.nameSize * 0.6), r2(c.btn.x - c.nameX), c.mark.name, {size: c.nameSize, family: fonts.body, color: theme.paper, weight: 650}));
  // The button: Subscribe in the accent, crossfading to Subscribed on glass.
  const btnStyle = {borderRadius: r2(B.height / 2), boxSizing: 'border-box'};
  inner.push(el('div', `${id}-button`, {...abs(B.x, B.y, B.width, B.height), transformOrigin: '50% 50%'}, [
    el('div', `${id}-done`, {...abs(0, 0, B.width, B.height), ...btnStyle, background: withAlpha(theme.paper, 0.1), border: `${r2(1.5 * u)}px solid ${withAlpha(theme.paper, 0.35)}`, opacity: 0}, [
      label(null, 0, r2(B.height / 2 - c.btnSize * 0.6), B.width, c.text.done, {size: c.btnSize, family: fonts.body, color: theme.paper, align: 'center', weight: 700})]),
    el('div', `${id}-sub`, {...abs(0, 0, B.width, B.height), ...btnStyle, background: c.fill, boxShadow: `0 0 ${r2(18 * u)}px ${withAlpha(c.fill, 0.5)}`}, [
      label(null, 0, r2(B.height / 2 - c.btnSize * 0.6), B.width, c.text.label, {size: c.btnSize, family: fonts.body, color: c.onFill, align: 'center', weight: 800})]),
    el('div', `${id}-ripple`, {...abs(0, 0, B.width, B.height), ...btnStyle, border: `${r2(3 * u)}px solid ${theme.paper}`, opacity: 0, transformOrigin: '50% 50%'})]));
  if (c.bellBox) inner.push(el('div', `${id}-bell`, {...abs(c.bellBox.x, c.bellBox.y, c.bellBox.size, c.bellBox.size), transformOrigin: '50% 12%'}, [
    iconNode('bell', {size: c.bellBox.size, color: theme.paper, stroke: 2.2})]));
  if (c.likeBox) inner.push(el('div', `${id}-like`, {...abs(c.likeBox.x, c.likeBox.y, c.likeBox.size, c.likeBox.size), transformOrigin: '50% 50%'}, [
    iconNode('thumbs-up', {size: c.likeBox.size, color: theme.paper, stroke: 2.2}),
    el('div', `${id}-liked`, {...abs(0, 0, c.likeBox.size, c.likeBox.size), opacity: 0}, [iconNode('thumbs-up', {size: c.likeBox.size, color: theme.primary, stroke: 2.2, mode: 'duotone', tint: theme.primary, tintOpacity: 0.85})])]));
  const size = r2(P.height * 0.42);
  const tip = {x: r2(P.x + B.x + B.width * 0.62), y: r2(P.y + B.y + B.height * 0.62)};
  return [el('div', `${id}-pill`, {...abs(P.x, P.y, P.width, P.height), opacity: 0}, inner), pointerNode(`${id}-pointer`, tip.x, tip.y, size, theme.bg)];
}

function ctaTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  const P = c.pill;
  const below = r2(P.height * 1.4);
  set(ops, `${id}-pill`, start, {opacity: 0, x: 0, y: below, scaleX: 0.96, scaleY: 0.96});
  tw(ops, `${id}-pill`, c.inAt, 0.25, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-pill`, c.inAt, 0.7, 'back.out(1.4)', {y: below, scaleX: 0.96, scaleY: 0.96}, {y: 0, scaleX: 1, scaleY: 1});
  // The pointer glides in from the lower right, presses, and leaves.
  const from = {x: r2(160 * u), y: r2(120 * u)};
  set(ops, `${id}-pointer`, start, {opacity: 0, ...from, scaleX: 1, scaleY: 1});
  tw(ops, `${id}-pointer`, rt(c.click - 0.75), 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-pointer`, rt(c.click - 0.75), 0.65, 'power3.inOut', {...from}, {x: 0, y: 0});
  tw(ops, `${id}-pointer`, c.click, 0.08, 'power2.in', {scaleX: 1, scaleY: 1}, {scaleX: 0.84, scaleY: 0.84});
  tw(ops, `${id}-pointer`, rt(c.click + 0.08), 0.16, 'power2.out', {scaleX: 0.84, scaleY: 0.84}, {scaleX: 1, scaleY: 1});
  tw(ops, `${id}-pointer`, rt(c.click + 0.55), 0.45, 'power2.in', {opacity: 1, x: 0, y: 0}, {opacity: 0, x: r2(90 * u), y: r2(70 * u)});
  // The press, then Subscribed.
  set(ops, `${id}-button`, start, {scaleX: 1, scaleY: 1});
  tw(ops, `${id}-button`, c.click, 0.08, 'power2.in', {scaleX: 1, scaleY: 1}, {scaleX: 0.93, scaleY: 0.93});
  tw(ops, `${id}-button`, rt(c.click + 0.08), 0.35, 'back.out(2.4)', {scaleX: 0.93, scaleY: 0.93}, {scaleX: 1, scaleY: 1});
  // Out, then in: the two labels differ in length, so they never show at once.
  set(ops, `${id}-sub`, start, {opacity: 1});
  tw(ops, `${id}-sub`, rt(c.click + 0.04), 0.1, 'power1.in', {opacity: 1}, {opacity: 0});
  set(ops, `${id}-done`, start, {opacity: 0});
  tw(ops, `${id}-done`, rt(c.click + 0.14), 0.18, 'power1.out', {opacity: 0}, {opacity: 1});
  set(ops, `${id}-ripple`, start, {opacity: 0, scaleX: 1, scaleY: 1});
  tw(ops, `${id}-ripple`, c.click, 0.5, 'power2.out', {opacity: 0.8, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: 1.18, scaleY: 1.5});
  if (c.bellBox) {
    // The bell swings, each swing smaller.
    set(ops, `${id}-bell`, start, {rotation: 0});
    const swings = [22, -18, 12, -7, 0];
    let t = rt(c.click + 0.35), last = 0;
    for (const angle of swings) { tw(ops, `${id}-bell`, t, 0.11, 'sine.inOut', {rotation: last}, {rotation: angle}); last = angle; t = rt(t + 0.11); }
  }
  if (c.likeBox) {
    popOps(ops, `${id}-liked`, start, rt(c.click + 0.6), {from: 0.4, duration: 0.4, ease: 'back.out(2.6)'});
    set(ops, `${id}-like`, start, {scaleX: 1, scaleY: 1});
    tw(ops, `${id}-like`, rt(c.click + 0.6), 0.4, 'back.out(2.6)', {scaleX: 0.7, scaleY: 0.7}, {scaleX: 1, scaleY: 1});
  }
  tw(ops, `${id}-pill`, c.outAt, 0.5, 'power3.in', {opacity: 1, y: 0}, {opacity: 0, y: below});
}

export const subscribeCta = {
  id: 'subscribe-cta',
  describe: 'A subscribe prompt for mid-video: a glass pill (avatar, channel name, Subscribe button, bell, like) slides in, a pointer clicks the button, it turns to Subscribed, the bell rings and the like fills, then the pill slides out. Sits above the captions; put it on an overlay track (track 1+) over a scene.',
  params: {name: 'string ≤ 32, the channel name', logo: 'assets/… image (optional; default: a monogram)', monogram: 'string ≤ 3 (default: the name\'s initials)', label: 'button text ≤ 14 (default Subscribe)',
    done: 'after the click ≤ 14 (default Subscribed)', position: 'left | center | right (default center)', bell: 'true | false (default true)', like: 'true | false (default true; false in compact and portrait)',
    at: 'seconds from the scene start of the click (default 42% of the scene, at least 1.3)', variant: VARIANT_PARAM},
  events: ['in', 'click', 'bell', 'out'], timing: TIMING, variants: CTA_VARIANTS,
  resolve: ctaResolve, view: ctaView, timeline: ctaTimeline
};

// ---------------------------------------------------------------------------
// channel-watermark

const MARK_VARIANTS = Object.freeze(['glass', 'bare']);
const CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

function watermarkResolve(params, ctx) {
  const b = createHBase('channel-watermark', params, ctx, {allowed: ['name', 'logo', 'monogram', 'corner', 'opacity', 'showName'], required: ['name'], variants: MARK_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const mark = channelMark(b, p);
  const corner = p.corner === undefined ? 'top-right' : check.oneOf(p.corner, 'params.corner', CORNERS);
  const opacity = p.opacity === undefined ? 0.7 : check.num(p.opacity, 'params.opacity', 0.3, 1);
  const showName = p.showName === undefined ? false : check.bool(p.showName, 'params.showName');
  const size = r2(u(b.portrait ? 84 : 72));
  const nameSize = r2(Math.max(b.min.meta, size * 0.36));
  const nameW = showName ? r2(textWidth(mark.name, nameSize, 'body') * 1.04 + size * 0.3) : 0;
  const W = r2(size + nameW), H = size;
  const right = corner.endsWith('right'), bottom = corner.startsWith('bottom');
  const box = {x: right ? r2(rect.width - W) : 0, y: bottom ? r2(rect.height - H) : 0, width: W, height: H};
  const model = boxLayout(b.finish({variant: b.variant, mark, corner, opacity, showName, size, nameSize, box, right}, {minTextPx: b.min.key}), box);
  // A low-opacity corner bug is decor to the layout gate: scenes may pass under it.
  model.layout.role = 'decor';
  return model;
}

function watermarkView(model) {
  const {id, fonts, theme} = model;
  const c = model.content;
  const {x, y, width, height} = c.box;
  const S = c.size;
  // The mark sits at the outer edge; the name, when shown, reads inward from it.
  const mx = c.right ? r2(width - S) : 0;
  const kids = [];
  if (c.variant === 'glass') kids.push(el('div', null, {...abs(mx, 0, S, S), ...glass(model, S * 0.26)}));
  kids.push(markNode(model, c.mark, mx, 0, S));
  if (c.showName) kids.push(label(null, c.right ? 0 : r2(S * 1.3), r2(S / 2 - c.nameSize * 0.6), r2(width - S * 1.3), c.mark.name, {size: c.nameSize, family: fonts.body, color: theme.paper, weight: 650, align: c.right ? 'right' : 'left'}));
  return [el('div', `${id}-mark`, {...abs(x, y, width, height), opacity: 0}, kids)];
}

function watermarkTimeline(model, ops) {
  const {id, start, motion} = model;
  const c = model.content;
  set(ops, `${id}-mark`, start, {opacity: 0});
  tw(ops, `${id}-mark`, motion.enterStart, 0.6, 'power1.out', {opacity: 0}, {opacity: c.opacity});
}

export const channelWatermark = {
  id: 'channel-watermark',
  describe: 'A small corner watermark of the channel\'s mark (glass chip or bare), held at low opacity across the scenes it spans; put it on a high overlay track over the whole video.',
  params: {name: 'string ≤ 32, the channel name', logo: 'assets/… image (optional; default: a monogram)', monogram: 'string ≤ 3', corner: 'top-right | top-left | bottom-right | bottom-left (default top-right)',
    opacity: '0.3–1 (default 0.7)', showName: 'true | false: the name beside the mark (default false)', variant: VARIANT_PARAM},
  events: [], timing: TIMING, variants: MARK_VARIANTS,
  resolve: watermarkResolve, view: watermarkView, timeline: watermarkTimeline
};

export const CHANNEL_MODULES = [logoSting, subscribeCta, channelWatermark];
