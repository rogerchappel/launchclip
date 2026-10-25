// Catalogue H view helpers shared by the element modules: title and source
// lines, text labels, count-up samples, and the chart grid. Built on the
// catalogue B tree helpers (kit/core/catalog-b-view.mjs).

import {abs, el, sampleTime, set, text, tw} from './catalog-b-view.mjs';
import {frameSamples, progress} from './catalog-b-base.mjs';
import {r2, rt} from './catalog-h-base.mjs';

export {abs, el, set, text, tw};

/** One line (or wrapped block) of text at (x, y), `w` wide. */
export function label(id, x, y, w, value, {size, family, color, align = 'left', weight, lineHeight = 1.2, spacing, wrap = false, extra = {}}) {
  const style = abs(x, y, w, undefined, {textAlign: align, fontFamily: family, fontSize: size, lineHeight: String(lineHeight), color, ...(weight ? {fontWeight: weight} : {}),
    ...(spacing ? {letterSpacing: spacing} : {}), ...(wrap ? {whiteSpace: 'normal'} : {}), ...extra});
  return text(id, style, value);
}

/** Title (top) and source (bottom) nodes for content {title, source} in a W × H rect. */
export function chromeNodes(model) {
  const {theme, fonts} = model;
  const c = model.content;
  const W = model.rect.width, H = model.rect.height;
  const out = [];
  if (c.title) out.push(label(`${model.id}-title`, 0, 0, W, c.title.text, {size: c.title.size, family: fonts.body, color: theme.foreground, weight: 650, lineHeight: 1.15, wrap: c.title.lines > 1, align: c.align ?? 'left'}));
  if (c.source) out.push(label(`${model.id}-source`, 0, H - c.source.size * 1.3, W, c.source.text, {size: c.source.size, family: fonts.meta, color: theme.muted, spacing: '0.06em', align: c.align ?? 'left'}));
  return out;
}

/** Title and source fade in with the module (title first). */
export function chromeOps(model, ops) {
  const {id, start, motion} = model;
  const c = model.content;
  if (c.title) {
    set(ops, `${id}-title`, start, {opacity: 0, x: 0, y: r2(18 * model.unit)});
    tw(ops, `${id}-title`, motion.enterStart + 0.08, 0.45, 'power3.out', {opacity: 0, y: r2(18 * model.unit)}, {opacity: 1, y: 0});
  }
  if (c.source) {
    set(ops, `${id}-source`, start, {opacity: 0});
    tw(ops, `${id}-source`, c.buildEnd ?? motion.enterEnd, 0.4, 'power1.out', {opacity: 0}, {opacity: 1});
  }
}

/** Per-frame count-up text from `from` to `to` over [t, t + duration] with `ease`. */
export function countSamples(model, t, duration, ease, from, to, format) {
  return frameSamples(t, rt(t + duration), model.fps, time => ({text: format(from + (to - from) * progress(time, t, duration, ease))}));
}

/** tl.set ops for count-up samples on `target`, starting from `initial`. */
export function countOps(ops, target, start, initial, samples) {
  set(ops, target, start, {text: initial});
  for (const s of samples) set(ops, target, sampleTime(s.t), {text: s.text});
}

/** Faint horizontal grid lines across a plot box at fractions `levels` (0 = bottom). */
export function gridNodes(id, plot, levels, color, unit) {
  return levels.map((f, i) => el('div', `${id}-grid-${i}`, abs(plot.x, r2(plot.y + plot.height * (1 - f) - unit), plot.width, r2(2 * unit), {background: color, opacity: 0, transformOrigin: '0% 50%'})));
}

export function gridOps(ops, id, count, start, at) {
  for (let i = 0; i < count; i++) {
    set(ops, `${id}-grid-${i}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${id}-grid-${i}`, rt(at + i * 0.05), 0.5, 'power2.out', {opacity: 0, scaleX: 0}, {opacity: 1, scaleX: 1});
  }
}

/** Arc path (clockwise on screen from a0 to a1, degrees from +x). */
export function arcPath(cx, cy, r, a0, a1) {
  const rad = d => d * Math.PI / 180;
  const p = d => `${r2(cx + r * Math.cos(rad(d)))} ${r2(cy + r * Math.sin(rad(d)))}`;
  const sweep = a1 - a0;
  if (sweep >= 359.99) return `M${p(a0)} A${r2(r)} ${r2(r)} 0 1 1 ${p(a0 + 180)} A${r2(r)} ${r2(r)} 0 1 1 ${p(a0 + 359.99)}`;
  return `M${p(a0)} A${r2(r)} ${r2(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${p(a1)}`;
}

/** A stroked path that draws on (pathLength 1). */
export function strokePath(id, d, color, width, {opacity, cap = 'round', dash = true, extra = {}} = {}) {
  return el('path', id, dash ? {strokeDasharray: 1, strokeDashoffset: 1} : null, [], {d, stroke: color, strokeWidth: width, strokeLinecap: cap, strokeLinejoin: 'round', fill: 'none', ...(dash ? {pathLength: 1} : {}), ...(opacity === undefined ? {} : {strokeOpacity: opacity}), ...extra});
}

/** Draw-on ops for a strokePath: offset `from` → `to` over `duration`. */
export function drawOps(ops, id, start, at, duration, ease, to = 0, from = 1) {
  set(ops, id, start, {strokeDashoffset: from});
  tw(ops, id, at, duration, ease, {strokeDashoffset: from}, {strokeDashoffset: to});
}

/** A pop: opacity 0 → 1 and scale `from` → 1 at `at`. */
export function popOps(ops, id, start, at, {from = 0.4, duration = 0.45, ease = 'back.out(1.7)', fade = 0.18} = {}) {
  set(ops, id, start, {opacity: 0, x: 0, y: 0, scaleX: from, scaleY: from});
  tw(ops, id, at, fade, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, id, at, duration, ease, {scaleX: from, scaleY: from}, {scaleX: 1, scaleY: 1});
}

/** A fade and rise of `dy` px at `at`. */
export function riseOps(ops, id, start, at, dy, {duration = 0.45, ease = 'power3.out', dx = 0} = {}) {
  set(ops, id, start, {opacity: 0, x: dx, y: dy});
  tw(ops, id, at, duration, ease, {opacity: 0, x: dx, y: dy}, {opacity: 1, x: 0, y: 0});
}

/** Fade to `to` opacity (a dim for highlights). */
export function fadeOps(ops, id, at, from, to, duration = 0.35) {
  tw(ops, id, at, duration, 'power2.out', {opacity: from}, {opacity: to});
}
