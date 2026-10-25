// Catalogue G shared base: the card frame every visual-vocabulary module
// sits in (docs/VIDEO_QUALITY_RFC.md §8), on top of catalogue B's createBase
// (brand colours and contrast, fonts, timing, root motion).
//
// Where a module goes depends on the lane:
// - plate: the motion lanes, and a footage-led scene with `insert: true`.
//   The content is centred in the safe zone, above the caption band, on the
//   scene's plate (no card unless `surface: "card"`).
// - overlay: a footage-led scene over the recording. The content sits on an
//   opaque brand card placed clear of the presenter's head (measured from the
//   subject when there is one, else the default head box): under the head,
//   else above it in 9:16; beside it, else under or above it, in 16:9. When
//   no region fits, resolve fails and says so (shorten, or use an insert).
// - `params.rect` places it explicitly (a footage layout's panel, say).
//
// Modules describe their content with measure(width, maxHeight) → {height,
// …layout} or null (does not fit that width), and draw rect-local from the
// box place() returns.

import {contrastRatio, createBase, mixColor, r2, rt, textWidth, timingRules} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {headRect} from './catalog-c.mjs';
import {iconNode, iconPath} from './icons.mjs';

export const CARD_SURFACES = Object.freeze(['card', 'plate']);
export const CARD_PARAMS = Object.freeze({
  variant: 'one of the module\'s VARIANTS, its designed look (optional; default: the style\'s variants[module], else the first); usually leave it to the style',
  surface: 'card | plate (default: card over footage, plate on a plate or insert)',
  rect: '{x, y, width, height} canvas px inside the safe zone (optional; default: placed by lane)'
});
export const at = 'seconds from scene start (optional; else a matching hit, else a default)';
// Beats may start with the scene: the card's first content enters with it.
export const cardTiming = (rules = []) => ({...timingRules({rules}), leadIn: 0});
// The card enters this long before its first beat, so the box never shows empty.
const ENTER_LEAD = 0.15;

/**
 * A module's designed variant (docs/SEEDED_STYLES_RFC.md §3.2): a per-scene
 * params.variant wins, then the style's choice (ctx.variants[moduleId], from
 * story.variants), then the first, which is the module's original look.
 * Variants change layout, shapes and entrances, never the params.
 */
export function variantOf(moduleId, variants, value, ctx, check) {
  const style = ctx?.variants && typeof ctx.variants === 'object' ? ctx.variants[moduleId] : undefined;
  const name = value ?? style ?? variants[0];
  if (variants.includes(name)) return name;
  const path = value !== undefined ? 'params.variant' : `style variants.${moduleId}`;
  return check.fail(path, `must be one of ${variants.join(', ')} (the ${moduleId} variants); got ${JSON.stringify(name)}`);
}

/**
 * createBase plus placement. Returns the createBase object with
 * {overlay, surface, pad, variant, place(measure, {maxWidth}) → {rect, x, y, width, layout}}.
 * `variants` is the module's VARIANTS list (the first is the default).
 */
export function createCardBase(moduleId, params, ctx, {allowed, required = [], variants = ['default']}) {
  const raw = params && typeof params === 'object' ? params : {};
  const {rect: rectIn, surface: surfaceIn, variant: variantIn, ...rest} = raw;
  const b = createBase(moduleId, rest, ctx, {allowed, required});
  const {check, u, canvas, portrait} = b;
  b.variant = variantOf(moduleId, variants, variantIn, ctx, check);
  b.model.variant = b.variant;
  // A footage layout's panel (ctx.layout.safe, footage-layouts) holds the
  // card like a plate; a brand frame's safe area (ctx.frame.safe, style v3)
  // narrows the zone. Both are optional.
  const panel = rectOf(ctx?.layout?.safe);
  const safe = intersect(intersect(b.safe, rectOf(ctx?.frame?.safe)), panel);
  const overlay = ctx?.lane === 'footage-led' && ctx?.insert !== true && !panel;
  const surface = surfaceIn === undefined ? (overlay ? 'card' : 'plate') : check.oneOf(surfaceIn, 'params.surface', CARD_SURFACES);
  const pad = surface === 'card' ? u(32) : 0;
  let fixed = null;
  if (rectIn !== undefined) {
    check.obj(rectIn, 'params.rect', ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    check.num(rectIn.width, 'params.rect.width', u(360), safe.width);
    check.num(rectIn.height, 'params.rect.height', u(200), safe.height);
    check.num(rectIn.x, 'params.rect.x', safe.x, safe.x + safe.width - rectIn.width);
    check.num(rectIn.y, 'params.rect.y', safe.y, safe.y + safe.height - rectIn.height);
    fixed = {...rectIn, name: 'rect', align: 'center'};
  }
  const regions = () => {
    if (fixed) return [fixed];
    if (!overlay) return [{...safe, name: panel ? 'panel' : 'plate', align: 'center'}];
    const head = headRect(ctx, canvas, portrait);
    const gap = u(32);
    const right = safe.x + safe.width, bottom = safe.y + safe.height;
    const below = {x: safe.x, y: head.y + head.height + gap, width: safe.width, name: 'below', align: 'end'};
    below.height = bottom - below.y;
    const above = {x: safe.x, y: safe.y, width: safe.width, height: head.y - gap - safe.y, name: 'above', align: 'start'};
    const sides = [
      {x: head.x + head.width + gap, y: safe.y, width: right - (head.x + head.width + gap), height: safe.height, name: 'right', align: 'center'},
      {x: safe.x, y: safe.y, width: head.x - gap - safe.x, height: safe.height, name: 'left', align: 'center'}
    ].sort((a, c) => c.width - a.width);
    return (portrait ? [below, above] : [...sides, below, above]).filter(region => region.width >= u(360) && region.height >= u(160));
  };
  b.overlay = overlay;
  // Content scales tried largest first: a plate fills the frame (the hero
  // fill rule), a rect or a layout panel grows its type until the content
  // fills it (like the editorial modules' density "fill"), a card beside the
  // presenter stays compact.
  b.scales = fixed || panel ? [2, 1.75, 1.5, 1.25, 1, 0.82, 0.68] : overlay ? [1, 0.82, 0.68] : [1.5, 1.25, 1, 0.82, 0.68];
  // Content centred in a region it does not size (a plate, a panel or a rect)
  // spreads its spacing into the room left over (spread()).
  b.fills = !(surface === 'card' && !fixed);
  // Titles over a list read in paper (or primary when that is the stronger),
  // at least 4.5:1 on the brand background.
  const onBg = color => contrastRatio(color, b.colors.bg);
  b.titleColor = onBg(b.colors.paper) >= 4.5 || onBg(b.colors.paper) >= onBg(b.colors.primary) ? b.colors.paper : b.colors.primary;
  b.surface = surface;
  b.pad = pad;
  b.place = (measure, {maxWidth = Infinity} = {}) => {
    let firstError = null, least = Infinity;
    for (const region of regions()) {
      const width = r2(Math.min(region.width, maxWidth));
      const inner = width - pad * 2;
      let layout = null;
      try { layout = measure(inner, region.height - pad * 2); } catch (error) { firstError ??= error; continue; }
      if (!layout) continue;
      const height = r2(layout.height + pad * 2);
      least = Math.min(least, height);
      if (height > region.height + 1e-6) continue;
      // The card takes its content's height; a plate (or an explicit rect)
      // keeps the whole region so the content centres in it.
      const own = surface === 'card' && !fixed;
      const rect = own ? {width, height} : {width: r2(region.width), height: r2(region.height)};
      rect.x = r2(region.x + (region.width - rect.width) / 2);
      rect.y = r2(region.align === 'end' ? region.y + region.height - rect.height : region.align === 'start' ? region.y : region.y + (region.height - rect.height) / 2);
      Object.assign(b.model.rect, {x: rect.x, y: rect.y, width: rect.width, height: rect.height});
      b.model.placement = region.name;
      b.model.surface = surface;
      const x = r2((rect.width - inner) / 2), y = r2((rect.height - layout.height) / 2);
      return {rect: b.model.rect, x, y, width: r2(inner), layout};
    }
    if (firstError) throw firstError;
    return check.fail('params', overlay
      ? `do not fit beside the presenter: the content needs at least ${Math.round(least)} px and the room clear of their head is smaller; shorten it, or make the scene an insert`
      : `do not fit the safe zone (they need at least ${Math.round(least)} px); shorten them`);
  };
  b.model.content = null;
  // Beats may fall from the scene start (catalogue B's default floor is the
  // end of the enter).
  const timeOf = b.timeOf;
  b.timeOf = (name, value, path, fallback, {min = 0, max} = {}) => timeOf(name, value, path, fallback, {min, max});
  // The panel and its first content land together: when the first beat comes
  // later (an explicit `at` or a hit), the enter waits for it.
  const finish = b.finish;
  b.finish = (content, options) => {
    const m = b.motion;
    const first = Math.min(...b.events.filter(event => event.name !== 'enter').map(event => event.time));
    const enterStart = rt(Math.min(Math.max(b.start, first - ENTER_LEAD), m.exitStart - m.enterDuration));
    if (Number.isFinite(first) && enterStart > m.enterStart) {
      m.enterStart = enterStart;
      m.enterEnd = rt(enterStart + m.enterDuration);
      b.events.find(event => event.name === 'enter').time = m.enterEnd;
    }
    return finish(content, options);
  };
  return b;
}

const rectOf = value => (value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key])) && value.width > 0 && value.height > 0 ? value : null);
function intersect(a, b) {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const width = r2(Math.min(a.x + a.width, b.x + b.width) - x), height = r2(Math.min(a.y + a.height, b.y + b.height) - y);
  return width > 0 && height > 0 ? {x: r2(x), y: r2(y), width, height} : a;
}

/**
 * A list layout spread to fill maxHeight: the room left over (to 90% of
 * maxHeight) goes into its gaps, given as {key: [count, cap]} (layout[key]
 * is used count times and grows to at most cap px). → the layout with the
 * new gaps and height.
 */
export function spread(layout, maxHeight, gaps) {
  const uses = Object.values(gaps).reduce((sum, [count]) => sum + count, 0);
  const extra = maxHeight * 0.9 - layout.height;
  if (!(extra > 0) || !uses) return layout;
  const out = {...layout};
  let added = 0;
  for (const [key, [count, cap]] of Object.entries(gaps)) {
    const grow = Math.max(0, Math.min(extra / uses, cap - layout[key]));
    out[key] = r2(layout[key] + grow);
    added += grow * count;
  }
  out.height = r2(layout.height + added);
  return out;
}

/** The opaque brand card behind a module's content (null on a plate). */
export function cardSurface(model) {
  if (model.surface !== 'card') return null;
  const {theme, unit: u, rect} = model;
  return el('div', null, abs(0, 0, rect.width, rect.height, {boxSizing: 'border-box', borderRadius: r2(32 * u), background: theme.bg,
    border: `${r2(2 * u)}px solid ${theme.border}`, boxShadow: `0 ${r2(18 * u)}px ${r2(48 * u)}px #00000073`}));
}

/**
 * The first layout variant (thunks, in preference order) whose height fits
 * maxHeight, else the shortest that resolves (so a failure reports the least
 * height needed); rethrows the first error when none resolves.
 */
export function pick(variants, maxHeight) {
  let least = null, error = null;
  for (const variant of variants) {
    let out;
    try { out = variant(); } catch (caught) { error ??= caught; continue; }
    if (!out) continue;
    if (out.height <= maxHeight + 1e-6) return out;
    if (!least || out.height < least.height) least = out;
  }
  if (least) return least;
  if (error) throw error;
  return null;
}

/**
 * A flex column filling a box (rect-local), centring its children
 * vertically: text takes its real rendered height, so measured heights (which
 * are conservative) never leave gaps. Children use flow() nodes.
 */
export const column = (x, y, width, height, children, {align = 'center', gap = 0} = {}) => el('div', null, abs(x, y, width, height, {display: 'flex', flexDirection: 'column', justifyContent: 'center',
  alignItems: align === 'center' ? 'center' : 'flex-start', gap}), children);
/** A row of the same kind (icon beside text). */
export const row = (x, y, width, height, children, {gap = 0} = {}) => el('div', null, abs(x, y, width, height, {display: 'flex', flexDirection: 'row', alignItems: 'center', gap}), children);
/** An in-flow box (flex child) of a fixed width and optional height. */
export const flow = (id, width, height, style, children) => el('div', id, {position: 'relative', flex: 'none', width, ...(height === undefined ? {} : {height}), ...style}, children);
/** In-flow wrapped text. */
export const flowText = (id, width, style, value) => flow(id, width, undefined, {margin: 0, whiteSpace: 'normal', overflowWrap: 'break-word', ...style}, [value]);

/** Wrapped text block (rect-local). */
export const block = (id, x, y, width, style, value, extra = {}) => el('div', id, abs(x, y, width, undefined, {margin: 0, whiteSpace: 'normal', overflowWrap: 'break-word', ...style, ...extra}), [value]);

// ---------------------------------------------------------------------------
// Shared motion

export const POP = Object.freeze({opacity: 0, y: 0, scale: 0.6});
export const RISE = Object.freeze({opacity: 0, y: 26, scale: 1});

/** Hidden at the scene start, then a back-out pop at `time`. */
export function pop(ops, model, target, time, {scale = POP.scale, duration = 0.5} = {}) {
  set(ops, target, model.start, {opacity: 0, x: 0, y: 0, scaleX: scale, scaleY: scale});
  tw(ops, target, time, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, target, time, duration, 'back.out(1.7)', {scaleX: scale, scaleY: scale}, {scaleX: 1, scaleY: 1});
}

/** Hidden at the scene start, then a short rise into place at `time`. */
export function rise(ops, model, target, time, {distance = RISE.y, duration = 0.45} = {}) {
  const dy = r2(distance * model.unit);
  set(ops, target, model.start, {opacity: 0, x: 0, y: dy});
  tw(ops, target, time, duration, 'power3.out', {opacity: 0, y: dy}, {opacity: 1, y: 0});
}

/** A gentle up-and-down bob from `from` until `until` (absolute seconds). */
export function bob(ops, target, from, until, amplitude, period = 1.4) {
  let t = from, up = true;
  while (t + period / 2 <= until) {
    // Each half ends where the next starts in floating point too (107.79 + 0.7
    // is 108.49000000000001, which HyperFrames' lint reads as an overlap).
    const start = rt(t), next = rt(t + period / 2);
    const duration = start + period / 2 > next ? Number((next - start - 1e-6).toFixed(6)) : period / 2;
    tw(ops, target, start, duration, 'sine.inOut', {y: up ? 0 : -amplitude}, {y: up ? -amplitude : 0});
    t += period / 2;
    up = !up;
  }
}

/** Event time stagger, clamped to the module's latest allowed event. */
export const after = (b, time, delta) => rt(Math.min(time + delta, b.start + b.lastEvent));

/** A validated icon name param (null when absent). */
export function iconParam(check, value, path) {
  if (value === undefined) return null;
  try { iconPath(value); } catch (error) { check.fail(path, `is not an icon: ${error.message}`); }
  return value;
}

/** An icon on a tinted rounded tile, in flow (id animates the whole tile). */
export function iconTile(id, name, size, color, unit, {glyph = 0.56} = {}) {
  const g = r2(size * glyph), inset = r2((size - g) / 2);
  return flow(id, size, size, {transformOrigin: '50% 50%'}, [
    el('div', null, abs(0, 0, size, size, {boxSizing: 'border-box', borderRadius: r2(size * 0.28), background: `${color}24`, border: `${r2(2 * unit)}px solid ${color}66`})),
    iconNode(name, {x: inset, y: inset, size: g, color})
  ]);
}

// ---------------------------------------------------------------------------
// Variant helpers: brand fills that keep text legible on any palette.

/** The text colour that reads best on `fill` (ink, paper or bg) → {color, ratio}. */
export function inkOn(b, fill) {
  let color = b.colors.ink, ratio = 0;
  for (const option of [b.colors.ink, b.colors.paper, b.colors.bg]) {
    const r = contrastRatio(option, fill);
    if (r > ratio) { color = option; ratio = r; }
  }
  return {color, ratio};
}

/**
 * A solid shape with text on it: the brand `tone` when its best text colour
 * reaches `min`:1, else the panel tone with paper text →
 * {fill, ink, solid: whether the brand tone held}.
 */
export function solidFill(b, tone = 'primary', min = 3) {
  const fill = b.colors[tone];
  const best = inkOn(b, fill);
  if (best.ratio >= min) return {fill, ink: best.color, solid: true};
  return {fill: b.theme.panel, ink: b.theme.foreground, solid: false};
}

/**
 * A translucent tint of `tone` behind text of colour `text`, as strong as
 * `alpha` while the text keeps `min`:1 on the tint over bg → #RRGGBBAA.
 */
export function tintBehind(b, tone, text, {alpha = 0.34, min = 4.5} = {}) {
  const fill = b.colors[tone];
  for (let a = alpha; a > 0.06; a -= 0.04) if (contrastRatio(text, mixColor(fill, b.colors.bg, a)) >= min) return `${fill}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  return `${fill}0f`;
}

/**
 * The lines fitText's conservative wrap makes of `text` (catalogue B's
 * advance model), for a variant that draws per line. The model overestimates
 * widths, so each forced line fits the browser's real width too.
 */
export function wrapWords(text, size, family, width) {
  const lines = [];
  const space = textWidth(' ', size, family);
  let line = '', used = 0;
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const w = textWidth(word, size, family);
    if (used && used + space + w > width) { lines.push(line); line = word; used = w; } else { line = line ? `${line} ${word}` : word; used += (used ? space : 0) + w; }
  }
  if (line) lines.push(line);
  return lines;
}
