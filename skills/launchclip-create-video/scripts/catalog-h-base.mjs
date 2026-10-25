// Catalogue H base: shared model helpers for the element library (charts,
// counters, frames and motion titles). Conventions are catalogue B's (one
// static view tree, one renderer-neutral op list, `at` from the scene start,
// hits time events of the same name); see kit/core/catalog-b.mjs.
//
// What catalogue H adds:
// - variants: every module exports its VARIANTS (the default, its original
//   look, first). params.variant wins, then the style's story.variants[module]
//   (ctx.variants), then the first (docs/SEEDED_STYLES_RFC.md §3.2). Variants
//   change layout, shapes and entrances, never the params.
// - a series palette drawn from the brand, every colour at least 3:1 on bg;
// - number formatting (plain, currency, percent, unit, compact);
// - two op props beyond catalogue B's: `blur` (px, a CSS blur filter) and
//   clipT/clipR/clipB/clipL (percent insets of a CSS clip-path). A tween that
//   sets one clip edge sets all four. Nothing is blurred once it settles.

import {contrastRatio, createBase, fitText, mixColor, r2, rt, textWidth} from './catalog-b-base.mjs';

export {r2, rt, textWidth, fitText, mixColor, contrastRatio};

/**
 * A module's designed variant: params.variant, else ctx.variants[moduleId]
 * (the style's choice), else the first.
 */
export function variantOf(moduleId, variants, value, ctx, check) {
  const style = ctx?.variants && typeof ctx.variants === 'object' ? ctx.variants[moduleId] : undefined;
  const name = value ?? style ?? variants[0];
  if (variants.includes(name)) return name;
  const path = value !== undefined ? 'params.variant' : `style variants.${moduleId}`;
  return check.fail(path, `must be one of ${variants.join(', ')} (the ${moduleId} variants); got ${JSON.stringify(name)}`);
}

export const VARIANT_PARAM = 'the module\'s designed look, one of its VARIANTS (optional; default: the style\'s variants[module], else the first)';

/**
 * createBase (frame-safe) plus the variant and the catalogue H helpers:
 * {variant, series(n), formatter, label(), at(), colorOf()}.
 */
export function createHBase(moduleId, params, ctx, {allowed, required = [], variants = ['default'], hidesCaptions = false}) {
  const raw = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const {variant: variantIn, ...rest} = raw;
  const b = createBase(moduleId, rest, ctx, {allowed, required, hidesCaptions, frameSafe: true});
  b.variant = variantOf(moduleId, variants, variantIn, ctx, b.check);
  b.model.variant = b.variant;
  b.series = n => seriesColors(b.colors, n);
  return b;
}

// ---------------------------------------------------------------------------
// Colour

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * `n` series colours from the brand: primary, accent, paper, then blends of
 * them. Each keeps at least 3:1 on bg (graphics contrast); blends that do
 * not are skipped.
 */
export function seriesColors(colors, n) {
  const {primary, accent, paper, bg} = colors;
  const candidates = [primary, accent, paper, mixColor(primary, accent, 0.5), mixColor(primary, paper, 0.55), mixColor(accent, paper, 0.55),
    mixColor(primary, bg, 0.72), mixColor(accent, bg, 0.72), mixColor(paper, bg, 0.7), mixColor(primary, accent, 0.25), mixColor(primary, accent, 0.75), mixColor(paper, bg, 0.5)];
  const out = [];
  for (const color of candidates) if (!out.includes(color) && contrastRatio(color, bg) >= 3) out.push(color);
  if (!out.length) out.push(paper);
  return Array.from({length: n}, (_, i) => out[i % out.length]);
}

/** A tone name (primary, accent, paper) or hex → hex; checks 3:1 on bg. */
export function toneColor(b, value, path, fallback = 'primary') {
  const raw = value ?? fallback;
  if (typeof raw === 'string' && HEX6.test(raw)) return b.resolveColor(raw, path, fallback);
  return b.resolveColor(b.check.oneOf(raw, path, ['primary', 'accent', 'paper']), path, fallback);
}

/** The text colour (ink, paper or bg) that reads best on `fill`. */
export function inkOn(colors, fill) {
  let best = colors.paper, ratio = 0;
  for (const option of [colors.ink, colors.paper, colors.bg]) {
    const r = contrastRatio(option, fill);
    if (r > ratio) { best = option; ratio = r; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Number formatting

export const FORMAT_PARAM = '{style?: "number" | "currency" | "percent" | "unit", currency? (ISO code, "USD"), unit? ("km", "ms", "users"), decimals? 0–3, compact? (12.4K, 3.1M), separator? (thousands commas, default true), prefix?, suffix?}';
const CURRENCY = {USD: '$', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', KRW: '₩', BRL: 'R$', CHF: 'CHF ', SEK: 'kr ', MXN: 'MX$', SGD: 'S$', HKD: 'HK$'};
const COMPACT = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

/**
 * Validated number format → {format(value) → string, decimals}. Deterministic
 * (no locale lookup): the same text in Node and in both renderers.
 */
export function numberFormat(check, raw, path = 'params.format', {decimals: fallbackDecimals = 0} = {}) {
  const f = raw === undefined ? {} : check.obj(raw, path, ['style', 'currency', 'unit', 'decimals', 'compact', 'separator', 'prefix', 'suffix']);
  const style = f.style === undefined ? (f.currency ? 'currency' : f.unit ? 'unit' : 'number') : check.oneOf(f.style, `${path}.style`, ['number', 'currency', 'percent', 'unit']);
  const currency = style === 'currency' ? check.oneOf(f.currency ?? 'USD', `${path}.currency`, Object.keys(CURRENCY)) : null;
  const unit = f.unit === undefined ? '' : check.str(f.unit, `${path}.unit`, 10);
  if (style === 'unit' && !unit) check.fail(`${path}.unit`, 'is required for style "unit"');
  const decimals = f.decimals === undefined ? fallbackDecimals : check.int(f.decimals, `${path}.decimals`, 0, 3);
  const compact = f.compact === undefined ? false : check.bool(f.compact, `${path}.compact`);
  const separator = f.separator === undefined ? true : check.bool(f.separator, `${path}.separator`);
  // Affixes keep their spaces (" / 5"), so they are checked but not trimmed.
  const prefix = f.prefix === undefined ? '' : (check.str(f.prefix, `${path}.prefix`, 4), f.prefix);
  const suffix = f.suffix === undefined ? '' : (check.str(f.suffix, `${path}.suffix`, 6), f.suffix);
  const format = value => {
    let v = Math.abs(value), tail = '';
    if (compact) for (const [size, letter] of COMPACT) if (v >= size) { v /= size; tail = letter; break; }
    // Compact numbers below the first step (860, not 860.0) keep no decimals when whole.
    let digits = v.toFixed(compact && !tail && Number.isInteger(v) ? 0 : decimals);
    if (separator) {
      const [whole, frac] = digits.split('.');
      digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
    }
    const sign = value < 0 && Number(v.toFixed(decimals)) !== 0 ? '−' : '';
    let text = `${digits}${tail}`;
    if (style === 'currency') text = `${CURRENCY[currency]}${text}`;
    else if (style === 'percent') text = `${text}%`;
    else if (style === 'unit') text = /^[°%′″'"]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
    return `${sign}${prefix}${text}${suffix}`;
  };
  return {format, decimals, style};
}

// ---------------------------------------------------------------------------
// Data

/** [{label, value, color?}] → validated rows. */
export function dataRows(b, raw, path, {min = 2, max = 8, labelMax = 24, allowNegative = false, extra = []} = {}) {
  const {check} = b;
  check.arr(raw, path, min, max);
  return raw.map((row, i) => {
    check.obj(row, `${path}[${i}]`, ['label', 'value', 'color', ...extra], ['label', 'value']);
    return {...row, label: check.str(row.label, `${path}[${i}].label`, labelMax), value: check.num(row.value, `${path}[${i}].value`, allowNegative ? -1e12 : 0, 1e12),
      color: row.color === undefined ? null : toneColor(b, row.color, `${path}[${i}].color`)};
  });
}

/** Optional title and source lines at the top and bottom of the rect → {title, source, top, bottom}. */
export function titleBlock(b, {title, source, width}) {
  const {check, u} = b;
  const W = width ?? b.rect.width;
  const t = title === undefined ? null : check.str(title, 'params.title', 60);
  const s = source === undefined ? null : check.str(source, 'params.source', 80);
  const titleFit = t ? fitText(check, 'params.title', t, {family: 'body', width: W, preferred: u(60), min: b.min.key, maxLines: 2}) : null;
  const sourceFit = s ? fitText(check, 'params.source', s, {family: 'meta', width: W, preferred: u(28), min: b.min.meta, maxLines: 1}) : null;
  const top = titleFit ? r2(titleFit.size * 1.15 * titleFit.lines + u(36)) : 0;
  const bottom = sourceFit ? r2(sourceFit.size * 1.3 + u(24)) : 0;
  return {title: titleFit ? {text: t, size: titleFit.size, lines: titleFit.lines} : null, source: sourceFit ? {text: s, size: sourceFit.size} : null, top, bottom};
}

/** Clip insets (percent) as op props. */
export const clip = (t = 0, r = 0, bottom = 0, l = 0) => ({clipT: t, clipR: r, clipB: bottom, clipL: l});
export const clipCss = p => `inset(${r2(p.clipT)}% ${r2(p.clipR)}% ${r2(p.clipB)}% ${r2(p.clipL)}%)`;

/** Build timing for `count` items over `span` seconds from `start` → per-item start. */
export function stagger(start, count, span, each) {
  const step = count > 1 ? Math.min(each, Math.max(0, span) / (count - 1)) : 0;
  return Array.from({length: count}, (_, i) => rt(start + i * step));
}
