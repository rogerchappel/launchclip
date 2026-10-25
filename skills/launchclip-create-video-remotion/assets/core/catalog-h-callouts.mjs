// Catalogue H callouts: speech-bubble (speech or thought), tooltip and
// callout-arrow. Bubble outlines are SVG: a stroked layer under a filled
// layer of the same shapes, so overlapping parts (a cloud's bumps, a tail)
// read as one outlined shape. Registered in kit/core/catalog-h.mjs.

import {CATALOG_B_STYLE, timingRules} from './catalog-b-base.mjs';
import {svgRoot} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, fitText, inkOn, mixColor, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, drawOps, el, label, popOps, riseOps, set, strokePath, tw} from './catalog-h-view.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const point = '{x, y} canvas px';
const TIMING = timingRules({rules: ['the callout lands at at']});
const SERIF = CATALOG_B_STYLE.serif;

/** A canvas point (or a rect-local default) → rect-local {x, y}, inside the canvas. */
function localPoint(b, raw, path, fallback) {
  if (raw === undefined) return fallback;
  b.check.obj(raw, path, ['x', 'y'], ['x', 'y']);
  const x = b.check.num(raw.x, `${path}.x`, 0, b.canvas.width), y = b.check.num(raw.y, `${path}.y`, 0, b.canvas.height);
  return {x: r2(x - b.rect.x), y: r2(y - b.rect.y)};
}

// ---------------------------------------------------------------------------
// speech-bubble

const BUBBLE_VARIANTS = Object.freeze(['rounded', 'comic', 'chat']);
const TAILS = ['bottom-left', 'bottom-right', 'left', 'right'];

/** Rounded rect with a tail ending at (px, py) on `side` → path data. */
function bubblePath(x, y, w, h, r, side, px, py, base) {
  const R = Math.min(r, h / 2, w / 2);
  const parts = [`M${r2(x + R)} ${r2(y)}`, `H${r2(x + w - R)}`, `A${R} ${R} 0 0 1 ${r2(x + w)} ${r2(y + R)}`];
  if (side === 'right') parts.push(`V${r2(y + h / 2 - base / 2)}`, `L${r2(px)} ${r2(py)}`, `L${r2(x + w)} ${r2(y + h / 2 + base / 2)}`);
  parts.push(`V${r2(y + h - R)}`, `A${R} ${R} 0 0 1 ${r2(x + w - R)} ${r2(y + h)}`);
  if (side === 'bottom-right') parts.push(`H${r2(x + w * 0.72 + base / 2)}`, `L${r2(px)} ${r2(py)}`, `L${r2(x + w * 0.72 - base / 2)} ${r2(y + h)}`);
  if (side === 'bottom-left') parts.push(`H${r2(x + w * 0.28 + base / 2)}`, `L${r2(px)} ${r2(py)}`, `L${r2(x + w * 0.28 - base / 2)} ${r2(y + h)}`);
  parts.push(`H${r2(x + R)}`, `A${R} ${R} 0 0 1 ${r2(x)} ${r2(y + h - R)}`);
  if (side === 'left') parts.push(`V${r2(y + h / 2 + base / 2)}`, `L${r2(px)} ${r2(py)}`, `L${r2(x)} ${r2(y + h / 2 - base / 2)}`);
  parts.push(`V${r2(y + R)}`, `A${R} ${R} 0 0 1 ${r2(x + R)} ${r2(y)}`, 'Z');
  return parts.join(' ');
}

/** A thought cloud: an ellipse ringed by bumps, plus trailing puffs toward (px, py). */
function cloudCircles(x, y, w, h, px, py) {
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const circles = [{cx, cy, rx: rx * 0.94, ry: ry * 0.86}];
  const n = Math.max(10, Math.round((w + h) / (h * 0.28)));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = Math.min(w, h) * (0.2 + 0.05 * Math.sin(i * 2.3));
    circles.push({cx: cx + Math.cos(a) * (rx - r * 0.55), cy: cy + Math.sin(a) * (ry - r * 0.55), rx: r, ry: r});
  }
  // Puffs from the cloud's edge toward the tail point, shrinking.
  const ex = cx + (px - cx) * 0.62, ey = cy + (py - cy) * 0.66;
  [0.11, 0.07, 0.045].forEach((f, i) => {
    const k = (i + 1) / 3.2;
    circles.push({cx: ex + (px - ex) * k, cy: ey + (py - ey) * k, rx: Math.min(w, h) * f, ry: Math.min(w, h) * f, puff: true});
  });
  return circles.map(c => ({cx: r2(c.cx), cy: r2(c.cy), rx: r2(c.rx), ry: r2(c.ry), puff: Boolean(c.puff)}));
}

const ellipsePath = c => `M${r2(c.cx - c.rx)} ${c.cy} A${c.rx} ${c.ry} 0 1 0 ${r2(c.cx + c.rx)} ${c.cy} A${c.rx} ${c.ry} 0 1 0 ${r2(c.cx - c.rx)} ${c.cy} Z`;

function bubbleResolve(params, ctx) {
  const b = createHBase('speech-bubble', params, ctx, {allowed: ['text', 'type', 'tail', 'name', 'at'], required: ['text'], variants: BUBBLE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 120);
  // params.kind is reserved for the scene, so the bubble's form is params.type.
  const kind = p.type === undefined ? 'speech' : check.oneOf(p.type, 'params.type', ['speech', 'thought']);
  const tail = p.tail === undefined ? 'bottom-left' : check.oneOf(p.tail, 'params.tail', TAILS);
  const name = p.name === undefined ? null : check.str(p.name, 'params.name', 24);
  const W = rect.width, H = rect.height;
  const thought = kind === 'thought';
  const side = tail === 'left' || tail === 'right';
  const tailLen = r2(u(thought ? 150 : 90));
  const maxW = r2(Math.min(W - (side ? tailLen : 0), u(900)) * (thought ? 0.8 : 0.92));
  const comic = b.variant === 'comic';
  const fit = fitText(check, 'params.text', text, {family: 'body', width: maxW - u(thought ? 120 : 90), preferred: u(comic ? 62 : 56), min: b.min.key, maxLines: thought ? 4 : 5});
  const longest = Math.min(maxW - u(thought ? 120 : 90), textWidth(text, fit.size, 'body') / fit.lines * 1.12);
  const bw = r2(Math.max(u(thought ? 420 : 300), longest + u(thought ? 130 : 96)));
  const nameSize = r2(Math.max(b.min.meta, u(30)));
  const bh = r2(fit.size * 1.25 * fit.lines + u(thought ? 130 : 84) + (name && b.variant === 'chat' ? nameSize * 1.4 : 0));
  const totalW = bw + (side ? tailLen : 0), totalH = bh + (side ? 0 : tailLen) + (name && b.variant !== 'chat' ? nameSize * 1.5 : 0);
  if (totalH > H) check.fail('params.text', 'makes the bubble too tall for the rect; shorten it');
  const ox = r2((W - totalW) / 2 + (tail === 'left' ? tailLen : 0)), oy = r2((H - totalH) / 2 + (name && b.variant !== 'chat' ? nameSize * 1.5 : 0));
  const tip = tail === 'left' ? {x: r2(ox - tailLen), y: r2(oy + bh * 0.75)} : tail === 'right' ? {x: r2(ox + bw + tailLen), y: r2(oy + bh * 0.75)}
    : {x: r2(ox + bw * (tail === 'bottom-left' ? 0.16 : 0.84)), y: r2(oy + bh + tailLen)};
  const fill = b.variant === 'chat' ? b.colors.primary : comic ? '#ffffff' : b.theme.panel;
  const ink = b.variant === 'chat' ? inkOn(b.colors, fill) : comic ? '#111114' : b.theme.foreground;
  const t = b.timeOf('pop', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-pop`, name: 'pop', time: t, endTime: rt(t + 0.45), role: 'emphasis', cue: 'pop'});
  const shape = thought ? {circles: cloudCircles(ox, oy, bw, bh, tip.x, tip.y)} : {d: bubblePath(ox, oy, bw, bh, b.variant === 'chat' ? u(44) : u(56), side ? tail : tail, tip.x, tip.y, u(70))};
  const content = {variant: b.variant, kind, text, size: fit.size, lines: fit.lines, name, nameSize, box: {x: ox, y: oy, width: bw, height: bh}, tip, shape, fill, ink, t,
    stroke: comic ? r2(u(9)) : b.variant === 'rounded' ? r2(u(3)) : 0, strokeColor: comic ? '#111114' : b.theme.border, muted: b.theme.muted, tilt: comic ? -2 : 0};
  return b.finish(content, {minTextPx: fit.size});
}

function bubbleView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const B = c.box;
  const shapes = c.shape.circles ? c.shape.circles.map(ellipsePath) : [c.shape.d];
  const layers = [];
  if (c.stroke) layers.push(...shapes.map(d => el('path', null, null, [], {d, fill: c.strokeColor, stroke: c.strokeColor, strokeWidth: r2(c.stroke * 2), strokeLinejoin: 'round'})));
  layers.push(...shapes.map(d => el('path', null, null, [], {d, fill: c.fill})));
  const kids = [svgRoot(W, H, layers)];
  let ty = r2(B.y + (B.height - c.size * 1.25 * c.lines) / 2);
  if (c.name && c.variant === 'chat') {
    kids.push(label(null, r2(B.x + 44 * u), r2(B.y + 30 * u), r2(B.width - 88 * u), c.name, {size: c.nameSize, family: fonts.meta, color: c.ink, spacing: '0.08em', extra: {opacity: 0.75}}));
    ty = r2(ty + c.nameSize * 0.7);
  }
  kids.push(label(`${id}-text`, r2(B.x + (c.kind === 'thought' ? 60 : 44) * u), ty, r2(B.width - (c.kind === 'thought' ? 120 : 88) * u), c.text, {size: c.size, family: fonts.body, color: c.ink, weight: c.variant === 'comic' ? 700 : 600, lineHeight: 1.25, wrap: true, align: 'center', extra: {opacity: 0}}));
  const out = [el('div', `${id}-bubble`, {...abs(0, 0, W, H), opacity: 0, transformOrigin: `${c.tip.x}px ${c.tip.y}px`, ...(c.tilt ? {transform: `rotate(${c.tilt}deg)`} : {})}, kids)];
  if (c.name && c.variant !== 'chat') out.push(label(`${id}-name`, B.x, r2(B.y - c.nameSize * 1.5), B.width, c.name.toUpperCase(), {size: c.nameSize, family: fonts.meta, color: c.muted, spacing: '0.14em', extra: {opacity: 0}}));
  return out;
}

function bubbleTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  set(ops, `${id}-bubble`, start, {opacity: 0, x: 0, y: 0, rotation: c.tilt, scaleX: 0.2, scaleY: 0.2});
  tw(ops, `${id}-bubble`, c.t, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-bubble`, c.t, 0.5, 'back.out(1.9)', {scaleX: 0.2, scaleY: 0.2}, {scaleX: 1, scaleY: 1});
  riseOps(ops, `${id}-text`, start, rt(c.t + 0.18), r2(10 * u), {duration: 0.35});
  if (c.name && c.variant !== 'chat') riseOps(ops, `${id}-name`, start, rt(c.t + 0.1), r2(8 * u));
}

export const speechBubble = {
  id: 'speech-bubble',
  describe: 'A speech or thought bubble pops out of its tail with the line inside: a soft rounded bubble, a bold comic bubble with an ink outline, or a chat message; optional speaker name.',
  params: {text: 'string ≤ 120, required', type: '"speech" | "thought"', tail: `${TAILS.map(t => `"${t}"`).join(' | ')} (default bottom-left)`, name: 'speaker ≤ 24 (optional)', at: `pops: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['pop'], timing: TIMING, variants: BUBBLE_VARIANTS,
  resolve: bubbleResolve, view: bubbleView, timeline: bubbleTimeline
};

// ---------------------------------------------------------------------------
// tooltip

const TOOLTIP_VARIANTS = Object.freeze(['dark', 'light', 'brand']);

function tooltipResolve(params, ctx) {
  const b = createHBase('tooltip', params, ctx, {allowed: ['text', 'title', 'target', 'at'], required: ['text'], variants: TOOLTIP_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 70);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 28);
  const W = rect.width, H = rect.height;
  const target = localPoint(b, p.target, 'params.target', {x: r2(W / 2), y: r2(H * 0.62)});
  const maxW = r2(Math.min(W, u(760)));
  const pad = r2(u(34));
  const textFit = fitText(check, 'params.text', text, {family: 'body', width: maxW - pad * 2, preferred: u(46), min: b.min.key, maxLines: 3});
  const titleSize = title ? fitText(check, 'params.title', title, {family: 'body', width: maxW - pad * 2, preferred: u(34), min: b.min.meta}).size : 0;
  const boxW = r2(Math.min(maxW, Math.max(textWidth(text, textFit.size, 'body') / textFit.lines * 1.1, title ? textWidth(title, titleSize, 'body') : 0) + pad * 2));
  const boxH = r2(pad * 2 + textFit.size * 1.25 * textFit.lines + (title ? titleSize * 1.3 + u(8) : 0));
  const arrow = r2(u(26)), gap = r2(u(34));
  const above = target.y - gap - arrow - boxH >= 0;
  if (!above && target.y + gap + arrow + boxH > H) check.fail('params.target', 'leaves no room for the tooltip above or below it inside the rect');
  const x = r2(Math.min(Math.max(target.x - boxW / 2, 0), W - boxW));
  const y = r2(above ? target.y - gap - arrow - boxH : target.y + gap + arrow);
  const fill = b.variant === 'light' ? b.colors.paper : b.variant === 'brand' ? b.colors.primary : mixColor('#000000', b.colors.bg, 0.4);
  const ink = b.variant === 'dark' ? b.colors.paper : inkOn(b.colors, fill);
  const t = b.timeOf('show', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-show`, name: 'show', time: t, endTime: rt(t + 0.5), role: 'emphasis', cue: 'pop-soft'});
  const content = {variant: b.variant, text, title, size: textFit.size, lines: textFit.lines, titleSize, pad, box: {x, y, width: boxW, height: boxH}, above, arrow, target, t, fill, ink,
    border: b.variant === 'dark' ? b.theme.border : 'transparent', dot: b.colors.primary === fill ? b.colors.accent : b.colors.primary};
  return b.finish(content, {minTextPx: textFit.size});
}

function tooltipView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const B = c.box;
  const kids = [];
  const d = r2(26 * u);
  kids.push(el('div', `${id}-pulse`, abs(r2(c.target.x - d), r2(c.target.y - d), r2(d * 2), r2(d * 2), {boxSizing: 'border-box', borderRadius: '50%', border: `${r2(4 * u)}px solid ${c.dot}`, opacity: 0})));
  kids.push(el('div', `${id}-dot`, abs(r2(c.target.x - d / 2), r2(c.target.y - d / 2), d, d, {borderRadius: '50%', background: c.dot, boxShadow: `0 0 0 ${r2(6 * u)}px ${c.dot}40`, opacity: 0})));
  const ax = r2(Math.min(Math.max(c.target.x - B.x, 40 * u), B.width - 40 * u));
  const inner = [el('div', null, abs(r2(ax - c.arrow), c.above ? r2(B.height - 2 * u) : r2(-c.arrow + 2 * u), r2(c.arrow * 2), c.arrow, {background: c.fill, clipPath: c.above ? 'polygon(0% 0%, 100% 0%, 50% 100%)' : 'polygon(50% 0%, 100% 100%, 0% 100%)'}))];
  let y = c.pad;
  if (c.title) { inner.push(label(null, c.pad, y, r2(B.width - c.pad * 2), c.title, {size: c.titleSize, family: fonts.body, color: c.ink, weight: 700, lineHeight: 1.3, extra: {opacity: 0.8}})); y += c.titleSize * 1.3 + 8 * u; }
  inner.push(label(null, c.pad, r2(y), r2(B.width - c.pad * 2), c.text, {size: c.size, family: fonts.body, color: c.ink, weight: 600, lineHeight: 1.25, wrap: c.lines > 1}));
  kids.push(el('div', `${id}-tip`, {...abs(B.x, B.y, B.width, B.height), boxSizing: 'border-box', borderRadius: r2(22 * u), background: c.fill, border: `${r2(2 * u)}px solid ${c.border}`, boxShadow: `0 ${r2(18 * u)}px ${r2(40 * u)}px #000000a6`, opacity: 0}, inner));
  return kids;
}

function tooltipTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  popOps(ops, `${id}-dot`, start, c.t, {from: 0});
  set(ops, `${id}-pulse`, start, {opacity: 0, x: 0, y: 0, scaleX: 1, scaleY: 1});
  const cycle = 1.2, repeats = Math.ceil((model.end - c.t) / cycle) + 1;
  ops.push({type: 'loop', target: `${id}-pulse`, start: rt(c.t + 0.2), cycle, repeats, from: {scaleX: 0.6, scaleY: 0.6, opacity: 0.9}, to: {scaleX: 2.2, scaleY: 2.2, opacity: 0}});
  riseOps(ops, `${id}-tip`, start, rt(c.t + 0.15), r2((c.above ? 16 : -16) * u), {duration: 0.45});
}

export const tooltip = {
  id: 'tooltip',
  describe: 'A tooltip points at a spot on screen: a pulsing dot lands on the target and a box with an arrow rises beside it (above, or below when there is no room); dark, light or brand.',
  params: {text: 'string ≤ 70, required', title: 'string ≤ 28 (optional)', target: `${point} the tooltip points at (default the centre, a little low)`, at: `shows: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['show'], timing: TIMING, variants: TOOLTIP_VARIANTS,
  resolve: tooltipResolve, view: tooltipView, timeline: tooltipTimeline
};

// ---------------------------------------------------------------------------
// callout-arrow

const ARROW_VARIANTS = Object.freeze(['curve', 'straight', 'sketch']);

function arrowResolve(params, ctx) {
  const b = createHBase('callout-arrow', params, ctx, {allowed: ['text', 'target', 'from', 'circle', 'at', 'tone'], required: ['text'], variants: ARROW_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 40);
  const W = rect.width, H = rect.height;
  const target = localPoint(b, p.target, 'params.target', {x: r2(W * 0.68), y: r2(H * 0.66)});
  const from = localPoint(b, p.from, 'params.from', {x: r2(W * 0.08), y: r2(H * 0.16)});
  const circle = p.circle === undefined ? true : check.bool(p.circle, 'params.circle');
  const color = toneColor(b, p.tone, 'params.tone');
  const sketch = b.variant === 'sketch';
  const size = fitText(check, 'params.text', text, {family: sketch ? 'serif' : 'body', width: W * 0.7, preferred: u(sketch ? 72 : 52), min: b.min.key, maxLines: 2});
  const textW = Math.min(W * 0.7, textWidth(text, size.size, sketch ? 'serif' : 'body') / size.lines * 1.1);
  const pill = b.variant === 'curve';
  const box = {x: r2(Math.min(Math.max(from.x, 0), W - textW - u(60))), y: r2(Math.min(Math.max(from.y, 0), H - size.size * 1.25 * size.lines - u(40))), width: r2(textW + (pill ? u(60) : u(10))), height: r2(size.size * 1.25 * size.lines + (pill ? u(36) : u(8)))};
  // The arrow leaves the label's nearest edge and stops short of the target (or its ring).
  const ringR = circle ? r2(u(74)) : 0;
  const sx = target.x > box.x + box.width ? box.x + box.width + u(16) : target.x < box.x ? box.x - u(16) : box.x + box.width / 2;
  const sy = target.y > box.y + box.height ? box.y + box.height + u(16) : target.y < box.y ? box.y - u(16) : box.y + box.height / 2;
  const dx = target.x - sx, dy = target.y - sy, len = Math.hypot(dx, dy);
  if (len < u(160)) check.fail('params.target', 'is too close to the label for an arrow; move one of them');
  const stop = (ringR + u(18)) / len;
  const ex = r2(target.x - dx * stop), ey = r2(target.y - dy * stop);
  let d;
  if (b.variant === 'straight') d = `M${r2(sx)} ${r2(sy)} L${ex} ${ey}`;
  else {
    // A quadratic bow to one side, a third of the length.
    const nx = -dy / len, ny = dx / len, bow = len * (sketch ? 0.22 : 0.3);
    d = `M${r2(sx)} ${r2(sy)} Q${r2((sx + ex) / 2 + nx * bow)} ${r2((sy + ey) / 2 + ny * bow)} ${ex} ${ey}`;
  }
  // Arrowhead along the final direction.
  const qx = b.variant === 'straight' ? sx : (sx + ex) / 2 + (-dy / len) * len * (sketch ? 0.22 : 0.3), qy = b.variant === 'straight' ? sy : (sy + ey) / 2 + (dx / len) * len * (sketch ? 0.22 : 0.3);
  const ang = Math.atan2(ey - qy, ex - qx), hl = u(44), spread = 0.5;
  const head = `M${r2(ex - hl * Math.cos(ang - spread))} ${r2(ey - hl * Math.sin(ang - spread))} L${ex} ${ey} L${r2(ex - hl * Math.cos(ang + spread))} ${r2(ey - hl * Math.sin(ang + spread))}`;
  const t = b.timeOf('point', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-point`, name: 'point', time: t, endTime: rt(t + 0.9), role: 'emphasis', cue: 'whoosh-soft'});
  const ring = circle ? `M${r2(target.x + ringR)} ${target.y} A${ringR} ${r2(ringR * 0.78)} -8 1 1 ${r2(target.x + ringR - 1)} ${r2(target.y - 6 * b.unit)} ${sketch ? `A${r2(ringR * 1.05)} ${r2(ringR * 0.8)} -8 0 1 ${r2(target.x + ringR * 0.5)} ${r2(target.y - ringR * 0.75)}` : ''}` : null;
  const content = {variant: b.variant, text, size: size.size, lines: size.lines, box, d, head, ring, target, t, color, stroke: r2(u(sketch ? 7 : 8)), ink: b.theme.foreground, onColor: inkOn(b.colors, color), pill};
  return b.finish(content, {minTextPx: size.size});
}

function arrowView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const paths = [strokePath(`${id}-shaft`, c.d, c.color, c.stroke), strokePath(`${id}-head`, c.head, c.color, c.stroke)];
  if (c.variant === 'sketch') paths.unshift(strokePath(`${id}-shaft-echo`, c.d.replace(/(-?\d+(\.\d+)?) (-?\d+(\.\d+)?)/g, (m, x, _a, y) => `${r2(Number(x) + 5 * u)} ${r2(Number(y) - 4 * u)}`), c.color, r2(c.stroke * 0.5), {opacity: 0.55}));
  if (c.ring) paths.push(strokePath(`${id}-ring`, c.ring, c.color, c.stroke));
  const B = c.box;
  const labelNode = c.pill
    ? el('div', `${id}-label`, {...abs(B.x, B.y, B.width, B.height), boxSizing: 'border-box', borderRadius: r2(B.height / 2), background: c.color, opacity: 0}, [
      label(null, 0, r2(18 * u), B.width, c.text, {size: c.size, family: fonts.body, color: c.onColor, align: 'center', weight: 700, lineHeight: 1.25, wrap: c.lines > 1})])
    : label(`${id}-label`, B.x, B.y, B.width, c.text, {size: c.size, family: c.variant === 'sketch' ? SERIF : fonts.body, color: c.variant === 'sketch' ? c.color : c.ink, weight: c.variant === 'sketch' ? undefined : 700, lineHeight: 1.25, wrap: c.lines > 1, extra: {opacity: 0, ...(c.variant === 'sketch' ? {fontStyle: 'italic'} : {})}});
  return [svgRoot(W, H, paths), labelNode];
}

function arrowTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  popOps(ops, `${id}-label`, start, c.t, {from: 0.7, duration: 0.4});
  if (c.variant === 'sketch') drawOps(ops, `${id}-shaft-echo`, start, rt(c.t + 0.3), 0.5, 'power2.inOut');
  drawOps(ops, `${id}-shaft`, start, rt(c.t + 0.25), 0.5, 'power2.inOut');
  drawOps(ops, `${id}-head`, start, rt(c.t + 0.72), 0.2, 'power2.out');
  if (c.ring) drawOps(ops, `${id}-ring`, start, rt(c.t + 0.85), 0.55, 'power2.inOut');
}

export const calloutArrow = {
  id: 'callout-arrow',
  describe: 'A label and an arrow that draws on from it to a point on screen, then rings the target: a curved arrow from a pill, a straight one, or a hand-drawn sketch with an italic note.',
  params: {text: 'string ≤ 40, required', target: `${point} the arrow points at (default lower right)`, from: `${point} where the label sits (default upper left)`, circle: 'boolean: ring the target (default true)', tone: 'primary | accent | paper | #rrggbb', at: `points: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['point'], timing: TIMING, variants: ARROW_VARIANTS,
  resolve: arrowResolve, view: arrowView, timeline: arrowTimeline
};

export const CALLOUTS = [speechBubble, tooltip, calloutArrow];
