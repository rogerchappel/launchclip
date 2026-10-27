// Catalogue I base: the explainer modules' shared pieces, on top of
// catalogue H's base and view helpers (kit/core/catalog-h-base.mjs,
// catalog-h-view.mjs): a glass card with a rim glow, a glow pill, a dashed
// line that draws on (a dashed path under a mask that draws), cue
// scheduling for N reveals, and ISO date helpers. Everything is frame-pure:
// static styles plus ops on element ids, as in catalogue H.

import {hex2, svgRoot} from './catalog-b-view.mjs';
import {r2, rt} from './catalog-h-base.mjs';
import {abs, el, label, set, tw} from './catalog-h-view.mjs';

export const AT = 'seconds from scene start (optional; else a matching hit, else a default)';
export const RECT = '{x, y, width, height} canvas px inside the safe zone (optional)';
export const REVEAL_ID = /^[a-z][a-z0-9-]{0,23}$/;

/** A glass panel: translucent surface, a 2 px rim in `rim` and a soft outer glow. */
export function glassStyle(model, rim, {radius = 24, glow = 0.18, fill = 0.8} = {}) {
  const u = model.unit;
  return {boxSizing: 'border-box', borderRadius: r2(radius * u), background: hex2(model.theme.panel, fill), border: `${r2(2 * u)}px solid ${hex2(rim, 0.55)}`,
    boxShadow: `0 0 ${r2(30 * u)}px ${hex2(rim, glow)}, inset 0 ${r2(1 * u)}px 0 ${hex2('#ffffff', 0.06)}`};
}

/** A glass card node at `box` ({x, y, width, height}) holding `children`. */
export function glassCard(id, model, box, rim, children = [], opts = {}) {
  return el('div', id, {...abs(box.x, box.y, box.width, box.height), ...glassStyle(model, rim, opts), ...(opts.extra ?? {})}, children);
}

/** A rounded pill with one centred line of text. */
export function pillNode(id, box, text, {size, family, color, background, border = 'none', weight = 700, spacing, glow = null, extra = {}}) {
  return el('div', id, {...abs(box.x, box.y, box.width, box.height), boxSizing: 'border-box', borderRadius: 999, background, border, ...(glow ? {boxShadow: `0 0 ${glow.blur}px ${glow.color}`} : {}), ...extra}, [
    label(null, 0, r2((box.height - size * 1.2) / 2), box.width, text, {size, family, color, align: 'center', weight, lineHeight: 1.2, spacing})
  ]);
}

/**
 * A dashed path that draws on: the dashes sit under a mask whose solid copy
 * of the path strokes on (drawMaskOps on `${id}-m`). Returns one svg node
 * covering W × H.
 */
export function dashedPath(id, W, H, d, color, width, {dash = 10, gap = 9, opacity = 1} = {}) {
  return svgRoot(W, H, [
    el('defs', null, null, [el('mask', `${id}-mask`, null, [
      el('path', `${id}-m`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d, stroke: '#ffffff', strokeWidth: r2(width + 6), strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none', pathLength: 1})
    ], {maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H})]),
    el('path', null, null, [], {d, stroke: color, strokeWidth: width, strokeDasharray: `${r2(dash)} ${r2(gap)}`, strokeLinecap: 'round', fill: 'none', strokeOpacity: opacity, mask: `url(#${id}-mask)`})
  ]);
}

export function drawMaskOps(ops, id, start, at, duration = 0.6, ease = 'power2.inOut') {
  set(ops, `${id}-m`, start, {strokeDashoffset: 1});
  tw(ops, `${id}-m`, at, duration, ease, {strokeDashoffset: 1}, {strokeDashoffset: 0});
}

/**
 * Times for a list of cues {name, at, path, gap}: an explicit at or a hit,
 * else a default that walks forward from `first` (scene-relative) by each
 * cue's gap, squeezed so the last one fits before the exit.
 */
export function scheduleCues(b, cues, first, {tail = 0.2} = {}) {
  const latest = b.lastEvent - tail;
  const total = cues.slice(0, -1).reduce((sum, cue) => sum + cue.gap, 0);
  const span = Math.max(0, latest - first);
  const k = total > span && total > 0 ? span / total : 1;
  let cursor = first;
  for (const cue of cues) {
    cue.time = b.timeOf(cue.name, cue.at, cue.path, Math.min(cursor, latest), {min: Math.max(0, Math.min(first, latest) - 1e-6)});
    cursor = cue.time - b.start + cue.gap * k;
  }
  return cues;
}

/** A validated reveal id (lowercase, digits, hyphens), unique in `seen`. */
export function revealId(check, value, path, fallback, seen) {
  const id = value === undefined ? fallback : check.str(value, path, 24);
  if (!REVEAL_ID.test(id)) check.fail(path, 'must be lowercase letters, digits or hyphens, starting with a letter');
  if (seen.has(id)) check.fail(path, `repeats "${id}"`);
  seen.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Dates (UTC, deterministic)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86400000;

/** 'YYYY-MM-DD' → day number (days since 1970-01-01, UTC). */
export function parseDate(check, value, path) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) check.fail(path, `must be a date "YYYY-MM-DD"; got ${JSON.stringify(value)}`);
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) check.fail(path, `is not a calendar date (${value})`);
  return Math.round(t / DAY);
}

/** Day number → {year, month (0–11), date, weekday (0 = Sunday), monthName, weekdayName}. */
export function dayParts(day) {
  const t = new Date(day * DAY);
  return {year: t.getUTCFullYear(), month: t.getUTCMonth(), date: t.getUTCDate(), weekday: t.getUTCDay(), monthName: MONTHS[t.getUTCMonth()], weekdayName: WEEKDAYS[t.getUTCDay()]};
}

export {r2, rt};
