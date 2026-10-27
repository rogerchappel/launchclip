// Catalogue I: particles and grids at scale, drawn on a <canvas> by the
// frame-pure particle engine (kit/core/particles.mjs) under DOM text that
// rides catalogue H's op list. Registered in kit/core/catalog-h.mjs, so both
// renderers draw these modules through catalogue H's emitters, which paint
// every canvas in model.content.paint (docs/KIT_CONTRACTS.md, "Particles and
// paint plans").
//
//   dot-field       a big count shown honestly: one dot per token, filling
//                   as the counter counts, pulled back from close-up dots to
//                   a density field inside a framing bracket.
//   particle-text   a number or word (dot-matrix face) assembling from, or
//                   dissolving into, glowing particles.
//   particle-logo   one or two marks (an icon or an SVG path) drawn in
//                   particles inside a tilted orbiting ring, side by side.
//   particle-cloud  ascending steps leading to a dashed target box ("Next
//                   flagship") that a drifting particle cloud gathers round.

import {VARIANT_PARAM, FORMAT_PARAM, createHBase, fitText, numberFormat, r2, rt, textWidth} from './catalog-h-base.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {abs, countOps, countSamples, el, label, riseOps, set, tw} from './catalog-h-view.mjs';
import {DATA_TONE, dataTone} from './catalog-h-data.mjs';
import {hex2} from './catalog-b-view.mjs';
import {iconPath, isIcon} from './icons.mjs';
import {DOT_MATRIX_CHARS, MAX_FIELD, dotMatrixColumns, dotMatrixPoints, rgbOf} from './particles.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

/** The canvas node a paint plan draws on: the whole module rect. */
export function paintCanvas(model, suffix = 'paint') {
  const W = Math.ceil(model.rect.width), H = Math.ceil(model.rect.height);
  return el('canvas', `${model.id}-${suffix}`, abs(0, 0, W, H), [], {width: W, height: H});
}

/** A plan for the module's canvas: {width, height, layers, glow?}. */
export function plan(b, layers, glow = null) {
  return {width: Math.ceil(b.rect.width), height: Math.ceil(b.rect.height), layers, ...(glow ? {glow} : {})};
}

/** Four L-shaped corner marks around a box (the framing bracket). */
function bracketNodes(id, box, color, unit) {
  const arm = r2(Math.min(box.width, box.height) * 0.08 + 14 * unit), w = r2(3 * unit);
  const corner = (k, x, y, sides) => el('div', `${id}-br-${k}`, abs(x, y, arm, arm, {opacity: 0, [`border${sides[0]}`]: `${w}px solid ${color}`, [`border${sides[1]}`]: `${w}px solid ${color}`, boxSizing: 'border-box'}));
  const pad = r2(10 * unit);
  return [corner(0, box.x - pad, box.y - pad, ['Top', 'Left']), corner(1, r2(box.x + box.width + pad - arm), box.y - pad, ['Top', 'Right']),
    corner(2, box.x - pad, r2(box.y + box.height + pad - arm), ['Bottom', 'Left']), corner(3, r2(box.x + box.width + pad - arm), r2(box.y + box.height + pad - arm), ['Bottom', 'Right'])];
}

function bracketOps(ops, id, start, at, unit) {
  for (let k = 0; k < 4; k++) {
    const dx = r2((k % 2 ? 1 : -1) * 18 * unit), dy = r2((k < 2 ? -1 : 1) * 18 * unit);
    set(ops, `${id}-br-${k}`, start, {opacity: 0, x: dx, y: dy});
    tw(ops, `${id}-br-${k}`, at, 0.5, 'power3.out', {opacity: 0, x: dx, y: dy}, {opacity: 1, x: 0, y: 0});
  }
}

// ---------------------------------------------------------------------------
// dot-field

const FIELD_VARIANTS = Object.freeze(['pull-back', 'still']);

function fieldResolve(params, ctx) {
  const b = createHBase('dot-field', params, ctx, {allowed: ['count', 'label', 'legend', 'tone', 'order', 'format', 'at', 'fillDuration'], required: ['count'], variants: FIELD_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const count = check.int(p.count, 'params.count', 100, MAX_FIELD);
  const text = p.label === undefined ? null : check.str(p.label, 'params.label', 40);
  const legend = p.legend === undefined ? '1 dot = 1 token' : check.str(p.legend, 'params.legend', 32);
  const color = dataTone(b, p.tone, 'params.tone', 'accent');
  const order = p.order === undefined ? 'scatter' : check.oneOf(p.order, 'params.order', ['scatter', 'reading']);
  const fmt = numberFormat(check, p.format, 'params.format');
  const W = rect.width, H = rect.height;

  // Header: the counter and its label on one line, the legend at the right.
  const total = fmt.format(count);
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const legendW = r2(textWidth(legend, legendSize, 'meta') + legendSize * 1.2);
  const counterSize = fitText(check, 'params.count', total, {family: 'display', width: (W - legendW) * 0.55, preferred: u(b.portrait ? 120 : 104), min: b.min.key}).size;
  const counterW = r2(textWidth(total, counterSize, 'display') + u(8));
  const labelFit = text ? fitText(check, 'params.label', text, {family: 'body', width: W - legendW - u(48), preferred: u(44), min: b.min.key}) : null;
  const headerH = r2(counterSize * 1.1 + (labelFit ? labelFit.size * 1.3 : 0));
  const gap = u(44);
  const box = {x: u(14), y: r2(headerH + gap), width: r2(W - u(28)), height: r2(H - headerH - gap - u(14))};
  if (box.height < u(200)) check.fail('params', 'leaves too little height for the field; enlarge rect');
  const cols = Math.max(1, Math.round(Math.sqrt(count * box.width / box.height)));
  const rows = Math.ceil(count / cols);

  // Timing: field and bracket in, then the fill and the counter together.
  const appearAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const latest = b.start + b.lastEvent;
  const fillDuration = p.fillDuration === undefined ? Math.max(1.2, Math.min(4.5, latest - appearAt - 0.6)) : check.num(p.fillDuration, 'params.fillDuration', 0.6, 30);
  const t0 = rt(appearAt + 0.3), t1 = rt(t0 + fillDuration);
  if (t1 > latest + 1e-6) check.fail('params.fillDuration', `ends the fill ${r2(t1 - latest)} s after the last event time; shorten it or lengthen the scene`);
  b.events.push({id: `${b.id}-build`, name: 'build', time: appearAt, endTime: t1, role: 'emphasis', cue: 'whoosh-soft'});
  b.events.push({id: `${b.id}-filled`, name: 'filled', time: t1, endTime: rt(t1 + 0.4), role: 'emphasis', cue: 'hit-soft'});

  const fit = Math.min(box.width / cols, box.height / rows);
  const close = Math.max(1, 7 / fit);
  const zoom = b.variant === 'pull-back' && close > 1.5
    ? [{t: t0, s: close, fx: Math.min(0.5, box.width / (fit * close) / 2 / cols), fy: Math.min(0.5, box.height / (fit * close) / 2 / rows)}, {t: rt(t0 + fillDuration * 0.85), s: 1, fx: 0.5, fy: 0.5}]
    : [{t: t0, s: 1, fx: 0.5, fy: 0.5}];
  const layer = {kind: 'field', x: box.x, y: box.y, w: box.width, h: box.height, cols, rows, count, rgb: rgbOf(color), empty: 0.07, at: appearAt, t0, t1, ease: 'none', seed: 11,
    shuffle: order !== 'reading', zoom};
  const content = {variant: b.variant, count, total, color, box, legend, legendSize, legendW, counterSize, counterW, label: labelFit ? {text, size: labelFit.size} : null, headerH,
    appearAt, t0, t1, buildEnd: t1, samples: countSamples(b.model, t0, fillDuration, 'none', 0, count, v => fmt.format(Math.min(count, Math.floor(v + 1e-6)))),
    ink: b.theme.foreground, muted: b.theme.muted, paint: {[`${b.id}-paint`]: plan(b, [layer])}};
  return b.finish(content, {minTextPx: Math.min(counterSize, labelFit?.size ?? Infinity)});
}

function fieldView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, W = model.rect.width;
  const kids = [paintCanvas(model), ...bracketNodes(id, c.box, c.muted, u)];
  kids.push(label(`${id}-count`, 0, 0, c.counterW, '0', {size: c.counterSize, family: fonts.display, color: c.ink, lineHeight: 1.1, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  if (c.label) {
    kids.push(label(`${id}-label`, 0, r2(c.counterSize * 1.1), r2(W - c.legendW - 24 * u), c.label.text, {size: c.label.size, family: fonts.body, color: c.muted, weight: 600, extra: {opacity: 0}}));
  }
  const ly = r2(c.headerH - c.legendSize * 1.4);
  const dot = r2(c.legendSize * 0.42);
  kids.push(el('div', `${id}-legend`, abs(r2(W - c.legendW), ly, c.legendW, r2(c.legendSize * 1.3), {opacity: 0}), [
    el('div', null, abs(0, r2((c.legendSize * 1.3 - dot) / 2), dot, dot, {borderRadius: '50%', background: c.color})),
    label(null, r2(dot + c.legendSize * 0.5), 0, r2(c.legendW - dot - c.legendSize * 0.5), c.legend, {size: c.legendSize, family: fonts.meta, color: c.muted, align: 'right'})
  ]));
  return kids;
}

function fieldTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  bracketOps(ops, id, start, c.appearAt, u);
  riseOps(ops, `${id}-count`, start, c.appearAt, r2(20 * u));
  countOps(ops, `${id}-count`, start, '0', c.samples);
  if (c.label) riseOps(ops, `${id}-label`, start, rt(c.appearAt + 0.12), r2(16 * u));
  riseOps(ops, `${id}-legend`, start, rt(c.appearAt + 0.25), r2(12 * u));
}

export const dotField = {
  id: 'dot-field',
  describe: `A huge count shown honestly ("1,050,000 tokens in context, 1 dot = 1 token"): one dot per unit (up to ${MAX_FIELD.toLocaleString('en-US')}) fills a bracketed field in a scatter as the counter counts up, pulling back from close-up dots to a density field.`,
  params: {count: `integer 100–${MAX_FIELD}, one dot each`, label: 'string ≤ 40 beside the counter ("tokens in context") (optional)', legend: 'string ≤ 32 at the top right (default "1 dot = 1 token")',
    tone: `the dots: ${DATA_TONE} (default accent)`, order: '"scatter" (default; dots land all over) or "reading" (left to right, top to bottom)', format: FORMAT_PARAM,
    fillDuration: 'seconds the fill and the counter take (default: to just before the exit, 1.2–4.5 s)', at: `field in: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'filled'], timing: timingRules({rules: ['the field and bracket appear at at; the fill and the counter run together from 0.3 s later', 'pull-back starts on dots about 7 px wide and ends on the whole field at 85% of the fill']}), variants: FIELD_VARIANTS,
  resolve: fieldResolve, view: fieldView, timeline: fieldTimeline
};

// ---------------------------------------------------------------------------
// particle-text

const TEXT_VARIANTS = Object.freeze(['led', 'dust']);
const TEXT_MODES = ['assemble', 'dissolve', 'both'];
const glowOf = (b, alpha = 0.6) => ({alpha, blur: r2(Math.max(3, b.u(7)))});

function textResolve(params, ctx) {
  const b = createHBase('particle-text', params, ctx, {allowed: ['text', 'kicker', 'sub', 'tone', 'mode', 'at', 'dissolveAt'], required: ['text'], variants: TEXT_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 14);
  for (const ch of text.toUpperCase()) if (!DOT_MATRIX_CHARS.includes(ch)) check.fail('params.text', `has ${JSON.stringify(ch)}, which the dot-matrix face does not draw; use A–Z, 0–9, space and ${DOT_MATRIX_CHARS.replace(/[A-Z0-9 ]/g, '')}`);
  const kicker = p.kicker === undefined ? null : check.str(p.kicker, 'params.kicker', 40);
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 60);
  const color = dataTone(b, p.tone, 'params.tone', 'accent');
  const mode = p.mode === undefined ? 'assemble' : check.oneOf(p.mode, 'params.mode', TEXT_MODES);
  if (p.dissolveAt !== undefined && mode === 'assemble') check.fail('params.dissolveAt', 'needs params.mode "dissolve" or "both"');
  const W = rect.width, H = rect.height;
  const kickerFit = kicker ? fitText(check, 'params.kicker', kicker, {family: 'body', width: W, preferred: u(44), min: b.min.key}) : null;
  const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'body', width: W, preferred: u(48), min: b.min.key, maxLines: 2}) : null;
  const kickerH = kickerFit ? r2(kickerFit.size * 1.3 + u(28)) : 0, subH = subFit ? r2(subFit.size * 1.25 * subFit.lines + u(36)) : 0;
  const cols = dotMatrixColumns(text);
  const boxH = Math.min(H - kickerH - subH, W / cols * 7, u(b.portrait ? 520 : 460));
  const boxW = r2(boxH / 7 * cols);
  if (boxH < u(140)) check.fail('params.text', `is too long to draw at a readable size here (${cols} columns); shorten it or drop the kicker or sub`);
  const top = r2((H - kickerH - boxH - subH) / 2);
  const box = {x: r2((W - boxW) / 2), y: r2(top + kickerH), width: boxW, height: r2(boxH)};
  const dust = b.variant === 'dust';
  const {pts, pitch} = dotMatrixPoints(text, {...box, sub: dust ? 6 : 4, seed: 5, jitter: dust ? 0.9 : 0.15});

  const startAt = b.timeOf('assemble', p.at, 'params.at', 0.5);
  const assemble = mode === 'dissolve' ? null : {t: startAt, dur: 1.1, spread: 0.7, cx: r2(box.x + box.width / 2 + (dust ? box.width * 0.4 : 0)), cy: r2(box.y + box.height / 2), r: r2(Math.max(W, H) * (dust ? 0.45 : 0.6))};
  const assembled = assemble ? rt(startAt + 1.8) : startAt;
  if (assemble) b.events.push({id: `${b.id}-assemble`, name: 'assemble', time: startAt, endTime: assembled, role: 'emphasis', cue: 'whoosh-soft'});
  let dissolve = null;
  if (mode !== 'assemble') {
    const earliest = assembled - b.start + 0.2;
    const fallback = Math.max(earliest, b.lastEvent - 1.2);
    const time = b.timeOf('dissolve', p.dissolveAt, 'params.dissolveAt', Math.min(fallback, b.lastEvent), {min: Math.min(earliest, b.lastEvent)});
    dissolve = {t: time, dur: 1.1, spread: 0.6, dx: r2(box.width * 0.35), dy: r2(-box.height * 0.25), r: r2(box.height * 0.6)};
    b.events.push({id: `${b.id}-dissolve`, name: 'dissolve', time, endTime: rt(time + 1.7), role: 'emphasis', cue: 'whoosh-soft'});
  }
  const size = r2(Math.max(1.2, pitch / (dust ? 6 : 4) * (dust ? 0.6 : 0.62)));
  const layers = [{kind: 'swarm', pts, rgb: rgbOf(color), size, seed: 3, alpha: 1, at: assemble ? startAt : b.start, ...(assemble ? {assemble} : {}), ...(dissolve ? {dissolve} : {}), shimmer: r2(pitch * 0.04)}];
  // Loose dust round the text, drifting.
  layers.push({kind: 'cloud', box, count: Math.round(pts.length * 0.12), spread: r2(box.height * 0.45), drift: r2(pitch * 0.5), rgb: rgbOf(color), size: r2(size * 0.9), seed: 19, at: assemble ? rt(startAt + 0.4) : b.start, dur: 1.2});
  const content = {variant: b.variant, mode, text, color, box, kicker: kickerFit ? {text: kicker, size: kickerFit.size, y: r2(top)} : null,
    sub: subFit ? {text: sub, size: subFit.size, lines: subFit.lines, y: r2(box.y + box.height + u(36))} : null, startAt, assembled, dissolve: dissolve?.t ?? null, buildEnd: assembled,
    ink: b.theme.foreground, muted: b.theme.muted, paint: {[`${b.id}-paint`]: plan(b, layers, glowOf(b))}};
  return b.finish(content, {minTextPx: Math.min(kickerFit?.size ?? Infinity, subFit?.size ?? Infinity, b.min.key * 4)});
}

function textView(model) {
  const {id, fonts} = model;
  const c = model.content, W = model.rect.width;
  const kids = [paintCanvas(model)];
  if (c.kicker) kids.push(label(`${id}-kicker`, 0, c.kicker.y, W, c.kicker.text, {size: c.kicker.size, family: fonts.body, color: c.muted, align: 'center', weight: 650, extra: {opacity: 0}}));
  if (c.sub) kids.push(label(`${id}-sub`, 0, c.sub.y, W, c.sub.text, {size: c.sub.size, family: fonts.body, color: c.ink, align: 'center', weight: 600, wrap: c.sub.lines > 1, extra: {opacity: 0}}));
  return kids;
}

function textTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  if (c.kicker) riseOps(ops, `${id}-kicker`, start, c.startAt, r2(14 * u));
  if (c.sub) riseOps(ops, `${id}-sub`, start, rt(c.assembled - 0.5), r2(18 * u));
  if (c.dissolve !== null) for (const part of ['kicker', 'sub']) if (c[part]) tw(ops, `${id}-${part}`, rt(c.dissolve + 0.3), 0.6, 'power2.in', {opacity: 1}, {opacity: 0});
}

export const particleText = {
  id: 'particle-text',
  describe: 'A number or short word (≤ 14 characters) in a dot-matrix face that assembles from a swirl of glowing particles, dissolves into drifting dust, or both ("60%" streaming in, then blowing away), with an optional kicker above and a line under.',
  params: {text: 'string ≤ 14: A–Z, 0–9, space and $ % . , + - × ≈ / : ! ? # \'', kicker: 'string ≤ 40 above (optional)', sub: 'string ≤ 60 under (optional)',
    mode: '"assemble" (default), "dissolve" (starts whole) or "both"', tone: `the particles: ${DATA_TONE} (default accent)`,
    at: `assemble start: ${at}`, dissolveAt: `the dissolve: ${at} (mode dissolve or both; default about 1.2 s before the exit)`, variant: VARIANT_PARAM, rect},
  events: ['assemble', 'dissolve'], timing: timingRules({rules: ['particles fly in over about 1.8 s from at', 'the dissolve takes about 1.7 s and must start after the text has assembled']}), variants: TEXT_VARIANTS,
  resolve: textResolve, view: textView, timeline: textTimeline
};

// ---------------------------------------------------------------------------
// particle-logo

const LOGO_VARIANTS = Object.freeze(['ring', 'halo']);
const VIEWBOX = /^-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/;

function logoShape(b, logo, path) {
  const {check} = b;
  if ((logo.icon === undefined) === (logo.path === undefined)) check.fail(path, 'needs exactly one of icon or path');
  if (logo.icon !== undefined) {
    if (!isIcon(logo.icon)) check.fail(`${path}.icon`, `must be an icon name from kit/core/icons.mjs (got ${JSON.stringify(logo.icon)})`);
    return {d: iconPath(logo.icon), vb: [0, 0, 24, 24], mode: 'stroke', sw: 2.4};
  }
  check.obj(logo.path, `${path}.path`, ['d', 'viewBox', 'rule'], ['d', 'viewBox']);
  const d = check.str(logo.path.d, `${path}.path.d`, 20000);
  if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/.test(d)) check.fail(`${path}.path.d`, 'must be SVG path data');
  if (!VIEWBOX.test(String(logo.path.viewBox))) check.fail(`${path}.path.viewBox`, 'must be "minX minY width height"');
  const rule = logo.path.rule === undefined ? 'nonzero' : check.oneOf(logo.path.rule, `${path}.path.rule`, ['nonzero', 'evenodd']);
  return {d, vb: logo.path.viewBox.split(' ').map(Number), mode: 'fill', rule};
}

function logoResolve(params, ctx) {
  const b = createHBase('particle-logo', params, ctx, {allowed: ['logos', 'at'], required: ['logos'], variants: LOGO_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.logos, 'params.logos', 1, 2);
  const W = rect.width, H = rect.height, n = p.logos.length;
  const colW = W / n;
  const logos = p.logos.map((logo, i) => {
    const path = `params.logos[${i}]`;
    check.obj(logo, path, ['icon', 'path', 'label', 'sub', 'tone'], ['label']);
    return {shape: logoShape(b, logo, path), label: check.str(logo.label, `${path}.label`, 24), sub: logo.sub === undefined ? null : check.str(logo.sub, `${path}.sub`, 36),
      color: dataTone(b, logo.tone, `${path}.tone`, i ? 'primary' : 'accent')};
  });
  const labelSize = Math.min(...logos.map((l, i) => fitText(check, `params.logos[${i}].label`, l.label, {family: 'display', width: colW * 0.9, preferred: u(64), min: b.min.key}).size));
  const subSize = logos.some(l => l.sub) ? Math.min(...logos.filter(l => l.sub).map(l => fitText(check, 'params.logos[].sub', l.sub, {family: 'body', width: colW * 0.9, preferred: Math.max(b.min.key, u(40)), min: b.min.key}).size)) : 0;
  const textH = r2(labelSize * 1.2 + (subSize ? subSize * 1.3 + u(6) : 0));
  const size = r2(Math.min(colW * (b.portrait && n > 1 ? 0.42 : 0.36), (H - textH - u(60)) * 0.5));
  const ringR = r2(size * 1.05);
  // The tilted ring reaches about 0.62 of its radius above and below the centre (a halo, all of it).
  const reach = b.variant === 'halo' ? ringR * 1.15 : Math.max(size / 2, ringR * 0.62);
  const blockH = 2 * reach + u(36) + textH;
  const startAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const layers = [], back = [], front = [];
  logos.forEach((logo, i) => {
    const cx = r2(colW * (i + 0.5)), cy = r2((H - blockH) / 2 + reach);
    const t = rt(startAt + i * 0.35);
    Object.assign(logo, {cx, cy, t, labelY: r2(cy + reach + u(36))});
    const rgb = rgbOf(logo.color);
    const ring = {kind: 'ring', cx, cy, rx: ringR, ry: r2(ringR * (b.variant === 'halo' ? 0.92 : 0.3)), rot: b.variant === 'halo' ? 0 : -0.32, count: b.variant === 'halo' ? 2200 : 2600,
      width: b.variant === 'halo' ? 0.12 : 0.28, omega: 0.55, size: r2(Math.max(1.4, u(2.6))), rgb, seed: 31 + i, at: t, dur: 1};
    back.push({...ring, half: 'back'});
    front.push({...ring, half: 'front'});
    layers.push({kind: 'swarm', shape: {...logo.shape, x: r2(cx - size / 2), y: r2(cy - size / 2), size, step: r2(Math.max(2.2, size / 70))}, rgb, size: r2(Math.max(1.4, u(2.6))), seed: 41 + i, alpha: 0.95,
      at: t, assemble: {t: rt(t + 0.15), dur: 1, spread: 0.6, cx, cy, r: ringR}, shimmer: r2(u(0.8))});
  });
  b.events.push({id: `${b.id}-build`, name: 'build', time: startAt, endTime: rt(startAt + (n - 1) * 0.35 + 1.8), role: 'emphasis', cue: 'whoosh-soft'});
  const content = {variant: b.variant, logos: logos.map(({shape, ...rest}) => rest), labelSize, subSize, colW: r2(colW), startAt, buildEnd: rt(startAt + 1.8),
    ink: b.theme.foreground, muted: b.theme.muted, paint: {[`${b.id}-paint`]: plan(b, [...back, ...layers, ...front], glowOf(b, 0.7))}};
  return b.finish(content, {minTextPx: Math.min(labelSize, subSize || Infinity)});
}

function logoView(model) {
  const {id, fonts} = model;
  const c = model.content;
  const kids = [paintCanvas(model)];
  c.logos.forEach((logo, i) => {
    kids.push(label(`${id}-l-${i}`, r2(logo.cx - c.colW / 2), logo.labelY, c.colW, logo.label, {size: c.labelSize, family: fonts.display, color: c.ink, align: 'center', extra: {opacity: 0}}));
    if (logo.sub) kids.push(label(`${id}-s-${i}`, r2(logo.cx - c.colW / 2), r2(logo.labelY + c.labelSize * 1.2 + 6 * model.unit), c.colW, logo.sub, {size: c.subSize, family: fonts.body, color: logo.color, align: 'center', weight: 600, extra: {opacity: 0}}));
  });
  return kids;
}

function logoTimeline(model, ops) {
  const {id, start, unit: u} = model;
  model.content.logos.forEach((logo, i) => {
    riseOps(ops, `${id}-l-${i}`, start, rt(logo.t + 0.9), r2(18 * u));
    if (logo.sub) riseOps(ops, `${id}-s-${i}`, start, rt(logo.t + 1.05), r2(14 * u));
  });
}

export const particleLogo = {
  id: 'particle-logo',
  describe: 'One or two marks drawn in glowing particles, each inside a tilted ring of orbiting particles, side by side with a name under each (two labs, two products). A mark is an icon, or a brand\'s own SVG path when the scene shows that party\'s real evidence.',
  params: {logos: '[{icon? (an icon name) | path? {d, viewBox "minX minY w h", rule? nonzero|evenodd}, label ≤ 24, sub? ≤ 36, tone?}] 1–2', at: `build start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build'], timing: timingRules({rules: ['each ring spins up and its mark assembles over about 1.8 s; a second logo follows 0.35 s later']}), variants: LOGO_VARIANTS,
  resolve: logoResolve, view: logoView, timeline: logoTimeline
};

// ---------------------------------------------------------------------------
// particle-cloud

const CLOUD_VARIANTS = Object.freeze(['stairs', 'single']);

function cloudResolve(params, ctx) {
  const b = createHBase('particle-cloud', params, ctx, {allowed: ['target', 'steps', 'tone', 'at', 'cloudAt'], required: ['target'], variants: CLOUD_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.obj(p.target, 'params.target', ['label', 'sub'], ['label']);
  const steps = p.steps === undefined ? [] : (check.arr(p.steps, 'params.steps', 1, 4), p.steps);
  // A look, not a param: "single" validates the steps and draws the target alone.
  const boxes = [...steps, p.target].map((s, i) => {
    const path = i < steps.length ? `params.steps[${i}]` : 'params.target';
    check.obj(s, path, ['label', 'sub'], ['label']);
    return {label: check.str(s.label, `${path}.label`, 24), sub: s.sub === undefined ? null : check.str(s.sub, `${path}.sub`, 32)};
  });
  if (b.variant === 'single') boxes.splice(0, steps.length);
  const color = dataTone(b, p.tone, 'params.tone', 'accent');
  const W = rect.width, H = rect.height, n = boxes.length;
  const bw = r2(Math.min(W * (n > 1 ? (b.portrait ? 0.56 : 0.26) : 0.5), u(560)));
  const labelSize = Math.min(...boxes.map((x, i) => fitText(check, `box ${i} label`, x.label, {family: 'body', width: bw - u(56), preferred: u(46), min: b.min.key}).size));
  const subSize = r2(Math.max(b.min.meta, u(28)));
  const bh = r2(labelSize * 1.25 + (boxes.some(x => x.sub) ? subSize * 1.3 : 0) + u(44));
  const spread = r2(Math.min(u(150), bh * 1.3));
  const usableH = H - spread * 1.2, usableW = W - spread;
  const stepX = n > 1 ? (usableW - bw) / (n - 1) : 0, stepY = n > 1 ? Math.min(bh * 1.15, (usableH - bh) / (n - 1)) : 0;
  const x0 = n > 1 ? r2(spread * 0.2) : r2((W - bw) / 2), y0 = n > 1 ? r2(H - (H - (n - 1) * stepY - bh) / 2 - bh) : r2((H - bh) / 2);
  const startAt = b.timeOf('build', p.at, 'params.at', 0.5);
  boxes.forEach((box, i) => Object.assign(box, {x: r2(x0 + i * stepX), y: r2(y0 - i * stepY), t: rt(startAt + i * 0.28)}));
  const target = boxes[n - 1];
  const cloudFallback = target.t - b.start + 0.45;
  const cloudAt = b.timeOf('cloud', p.cloudAt, 'params.cloudAt', Math.min(cloudFallback, b.lastEvent), {min: Math.min(cloudFallback - 0.3, b.lastEvent)});
  b.events.push({id: `${b.id}-build`, name: 'build', time: startAt, endTime: rt(target.t + 0.5), role: 'emphasis', cue: 'pop'});
  b.events.push({id: `${b.id}-cloud`, name: 'cloud', time: cloudAt, endTime: rt(cloudAt + 1.6), role: 'emphasis', cue: 'whoosh-soft'});
  const from = n > 1 ? {x: r2(boxes[0].x + bw * 0.3), y: r2(boxes[0].y + bh)} : null;
  const rgb = rgbOf(color);
  const layers = [{kind: 'cloud', box: {x: target.x, y: target.y, w: bw, h: bh}, count: 7000, spread, drift: r2(u(9)), rgb, size: r2(Math.max(1.2, u(2.4))), seed: 51, at: cloudAt, dur: 1.4, ...(from ? {from} : {})}];
  // A low haze of dust along the steps.
  if (n > 1) layers.push({kind: 'cloud', box: {x: boxes[0].x, y: r2(boxes[0].y + bh * 0.6), w: r2(target.x + bw - boxes[0].x), h: r2(bh * 0.4)}, count: 1600, spread: r2(spread * 0.4), drift: r2(u(6)), rgb, size: r2(Math.max(1.2, u(2.2))), seed: 61, at: rt(cloudAt - 0.2), dur: 1.2});
  const content = {variant: b.variant, boxes, bw, bh, labelSize, subSize, color, startAt, cloudAt, buildEnd: rt(cloudAt + 1),
    ink: b.theme.foreground, muted: b.theme.muted, panel: b.theme.panel, border: b.theme.border, paint: {[`${b.id}-paint`]: plan(b, layers, glowOf(b, 0.55))}};
  return b.finish(content, {minTextPx: labelSize});
}

function cloudView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, n = c.boxes.length;
  const kids = [];
  c.boxes.forEach((box, i) => {
    const target = i === n - 1;
    const border = target ? `${r2(2.5 * u)}px dashed ${hex2(c.color, 0.85)}` : `${r2(2 * u)}px solid ${c.border}`;
    kids.push(el('div', `${id}-b-${i}`, abs(box.x, box.y, c.bw, c.bh, {opacity: 0, borderRadius: r2(18 * u), border, background: target ? hex2(c.color, 0.07) : hex2(c.panel, 0.92),
      boxShadow: target ? `0 0 ${r2(40 * u)}px ${hex2(c.color, 0.25)}` : `0 ${r2(18 * u)}px ${r2(40 * u)}px rgba(0,0,0,0.45)`, boxSizing: 'border-box'}), [
      label(null, r2(26 * u), r2(20 * u), r2(c.bw - 52 * u), box.label, {size: c.labelSize, family: fonts.body, color: target ? c.ink : c.ink, weight: 700}),
      ...(box.sub ? [label(null, r2(26 * u), r2(20 * u + c.labelSize * 1.25), r2(c.bw - 52 * u), box.sub, {size: c.subSize, family: fonts.meta, color: c.muted})] : [])
    ]));
  });
  kids.push(paintCanvas(model));
  return kids;
}

function cloudTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content, n = c.boxes.length;
  c.boxes.forEach((box, i) => riseOps(ops, `${id}-b-${i}`, start, i === n - 1 ? rt(Math.max(box.t, c.cloudAt + 0.3)) : box.t, r2(30 * u), {dx: r2(-20 * u)}));
}

export const particleCloud = {
  id: 'particle-cloud',
  describe: 'Up to four ascending steps (a model line-up) leading to a dashed target box ("Next flagship") that a drifting cloud of glowing particles streams up the steps to gather round; or the target alone, wrapped in its cloud.',
  params: {target: '{label ≤ 24, sub? ≤ 32} the dashed box the cloud gathers round', steps: '[{label ≤ 24, sub? ≤ 32}] 1–4 steps below it, lowest first (the stairs variant draws them)',
    tone: `the particles: ${DATA_TONE} (default accent)`, at: `first step in: ${at}`, cloudAt: `the cloud: ${at} (default 0.45 s after the last step)`, variant: VARIANT_PARAM, rect},
  events: ['build', 'cloud'], timing: timingRules({rules: ['steps rise 0.28 s apart from at; the cloud streams in after them and the target box shows inside it']}), variants: CLOUD_VARIANTS,
  resolve: cloudResolve, view: cloudView, timeline: cloudTimeline
};

export const PARTICLE_MODULES = [dotField, particleText, particleLogo, particleCloud];
