// Catalogue B shared base: the safe expression parser, WCAG colour maths,
// path-prefixed validation, text metrics, ticks, and createBase(), which turns
// ctx into the common model shape (canvas, safe-zone rect, theme, fonts,
// motion, event timing). Module files (catalog-b-<id>.mjs) build on it; the
// registry and conventions live in catalog-b.mjs.
//
// Imports only sibling kit/core files, so it bundles into Remotion and copies
// into skills unchanged.

import {formatBound, withinBounds} from './bounds.mjs';
import {getEase} from './motion.mjs';
import {grammarDuration, grammarEase} from './grammar.mjs';
import {profileGeometry} from './layout-check.mjs';
import {fontStack as registryStack} from './fonts.mjs';

export const SAMPLE_LEAD = 0.0005;

export const CATALOG_B_STYLE = Object.freeze({
  enterDuration: 0.5,
  exitDuration: 0.35,
  enterEase: 'power3.out',
  exitEase: 'power2.in',
  minKeyText: 44,
  minMetaText: 26,
  serif: registryStack(null, 'serif'),
  letterSpacing: Object.freeze({meta: '0.14em', display: '0.01em'})
});

// Timing shared by every catalogue B module (seconds, scene-relative): scenes
// of at least minDuration; event times between leadIn (the enter) and scene −
// leadOut (the exit plus 0.3 s). A grammar that shortens the enter or exit
// only widens that window. timingRules() merges a module's own gaps and rules.
export const CATALOG_B_TIMING = Object.freeze({minDuration: 2, leadIn: CATALOG_B_STYLE.enterDuration, leadOut: CATALOG_B_STYLE.exitDuration + 0.3, exitHold: 0.3});
export function timingRules({gaps = [], rules = []} = {}) {
  return {minDuration: CATALOG_B_TIMING.minDuration, leadIn: CATALOG_B_TIMING.leadIn, leadOut: Math.round(CATALOG_B_TIMING.leadOut * 1000) / 1000, gaps, rules};
}

const ROLE_NAMES = ['primary', 'accent', 'paper'];
// Conservative average advance per character, as a fraction of font size.
// Calibrated on the bundled role defaults (fonts.mjs FONT_REGISTRY advances): Anton,
// Inter at 650, JetBrains Mono and Instrument Serif, with headroom for mixed case.
const ADVANCE = {display: 0.56, body: 0.6, meta: 0.62, serif: 0.5};

// ---------------------------------------------------------------------------
// Safe expression parser (no eval, no Function)

const FUNCTIONS = Object.freeze({exp: Math.exp, log: Math.log, ln: Math.log, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, abs: Math.abs});
const CONSTANTS = Object.freeze({pi: Math.PI, e: Math.E});
const MAX_EXPRESSION = 160, MAX_DEPTH = 24, MAX_NODES = 160;

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
      if (!match) throw new Error(`unexpected "${ch}" at ${i}`);
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new Error(`invalid number "${match[0]}"`);
      tokens.push({type: 'num', value, pos: i});
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      const match = /^[a-zA-Z]+/.exec(source.slice(i));
      tokens.push({type: 'id', value: match[0].toLowerCase(), pos: i});
      i += match[0].length;
      continue;
    }
    const op = ch === '−' ? '-' : ch === '×' || ch === '·' ? '*' : ch === '÷' ? '/' : ch;
    if ('+-*/^()'.includes(op)) { tokens.push({type: 'op', value: op, pos: i}); i++; continue; }
    throw new Error(`unexpected "${ch}" at ${i}`);
  }
  return tokens;
}

/**
 * Parse a small arithmetic expression in one variable. Grammar:
 *   expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)*
 *   unary := ('+'|'-') unary | power ; power := atom ('^' unary)?   (right-assoc)
 *   atom := number | t | x | pi | e | fn '(' expr ')' | '(' expr ')'
 * fn ∈ exp, log (natural), ln, sqrt, sin, cos, abs. `t` and `x` both name the
 * variable. Implicit multiplication is rejected. Returns {source, ast,
 * evaluate(value)}; evaluate throws when the result is not finite.
 */
export function parseExpression(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('expression must be a non-empty string');
  if (source.length > MAX_EXPRESSION) throw new Error(`expression must be at most ${MAX_EXPRESSION} characters`);
  const tokens = tokenize(source);
  let index = 0, nodes = 0;
  const peek = () => tokens[index];
  const node = value => { if (++nodes > MAX_NODES) throw new Error('expression is too complex'); return value; };
  const expect = value => {
    const token = tokens[index];
    if (!token || token.type !== 'op' || token.value !== value) throw new Error(`expected "${value}"${token ? ` at ${token.pos}` : ' at end'}`);
    index++;
  };
  const isOp = (token, ...values) => token && token.type === 'op' && values.includes(token.value);
  function expr(depth) {
    if (depth > MAX_DEPTH) throw new Error('expression is nested too deeply');
    let left = term(depth);
    while (isOp(peek(), '+', '-')) { const op = tokens[index++].value; left = node({op, left, right: term(depth)}); }
    return left;
  }
  function term(depth) {
    let left = unary(depth);
    while (isOp(peek(), '*', '/')) { const op = tokens[index++].value; left = node({op, left, right: unary(depth)}); }
    return left;
  }
  function unary(depth) {
    if (depth > MAX_DEPTH) throw new Error('expression is nested too deeply');
    if (isOp(peek(), '-')) { index++; return node({op: 'neg', arg: unary(depth + 1)}); }
    if (isOp(peek(), '+')) { index++; return unary(depth + 1); }
    return power(depth);
  }
  function power(depth) {
    const base = atom(depth);
    if (isOp(peek(), '^')) { index++; return node({op: '^', left: base, right: unary(depth + 1)}); }
    return base;
  }
  function atom(depth) {
    const token = tokens[index];
    if (!token) throw new Error('unexpected end of expression');
    if (token.type === 'num') { index++; return node({num: token.value}); }
    if (token.type === 'id') {
      index++;
      if (token.value === 't' || token.value === 'x') return node({variable: true});
      if (Object.hasOwn(CONSTANTS, token.value)) return node({num: CONSTANTS[token.value]});
      if (Object.hasOwn(FUNCTIONS, token.value)) {
        expect('(');
        const arg = expr(depth + 1);
        expect(')');
        return node({fn: token.value, arg});
      }
      throw new Error(`unknown name "${token.value}" (use t or x, pi, e, ${Object.keys(FUNCTIONS).join(', ')})`);
    }
    if (isOp(token, '(')) { index++; const inner = expr(depth + 1); expect(')'); return inner; }
    throw new Error(`unexpected "${token.value}" at ${token.pos}`);
  }
  const ast = expr(0);
  if (index < tokens.length) {
    const token = tokens[index];
    throw new Error(token.type === 'op' ? `unexpected "${token.value}" at ${token.pos}` : `missing operator before "${token.value}" at ${token.pos}`);
  }
  if (!hasVariable(ast)) throw new Error('expression must use the variable t (or x)');
  const evaluate = value => {
    const result = evaluateNode(ast, value);
    if (!Number.isFinite(result)) throw new Error(`expression is not finite at ${value}`);
    return result;
  };
  return Object.freeze({source, ast, evaluate});
}

function hasVariable(ast) {
  if (ast.variable) return true;
  return ['left', 'right', 'arg'].some(key => ast[key] && hasVariable(ast[key]));
}
function evaluateNode(ast, value) {
  if (ast.num !== undefined) return ast.num;
  if (ast.variable) return value;
  if (ast.fn) return FUNCTIONS[ast.fn](evaluateNode(ast.arg, value));
  if (ast.op === 'neg') return -evaluateNode(ast.arg, value);
  const a = evaluateNode(ast.left, value), b = evaluateNode(ast.right, value);
  switch (ast.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '^': return Math.pow(a, b);
    default: throw new Error(`unknown operator ${ast.op}`);
  }
}

// ---------------------------------------------------------------------------
// Colour

const HEX6 = /^#[0-9a-fA-F]{6}$/;
function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function toHex(channels) { return `#${channels.map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`; }

/** fg composited at `alpha` over bg, as #rrggbb. */
export function mixColor(fg, bg, alpha) {
  const a = rgb(fg), b = rgb(bg);
  return toHex(a.map((c, i) => c * alpha + b[i] * (1 - alpha)));
}
/** WCAG 2 relative luminance. */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG 2 contrast ratio, 1..21. */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const alphaHex = (hex, alpha) => `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Validation helpers (path-prefixed messages)

export function makeCheck(prefix) {
  const fail = (path, message) => { throw new Error(`${prefix}${path} ${message}`); };
  const isObj = value => value && typeof value === 'object' && !Array.isArray(value);
  return {
    fail,
    obj(value, path, allowed, required = []) {
      if (!isObj(value)) fail(path, 'must be an object');
      for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, `is not supported (allowed: ${allowed.join(', ')})`);
      for (const key of required) if (value[key] === undefined) fail(`${path}.${key}`, 'is required');
      return value;
    },
    num(value, path, min, max) {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, `must be a number between ${formatBound(min)} and ${formatBound(max)}`);
      if (!withinBounds(value, min, max)) fail(path, `must be between ${formatBound(min)} and ${formatBound(max)}, got ${value}`);
      return value;
    },
    int(value, path, min, max) {
      if (!Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer between ${min} and ${max}`);
      return value;
    },
    str(value, path, max, min = 1) {
      if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(path, `must be a string of ${min}–${max} characters`);
      if (/[\u0000-\u001f<>]/.test(value)) fail(path, 'must not contain control characters or angle brackets');
      return value.trim();
    },
    bool(value, path) { if (typeof value !== 'boolean') fail(path, 'must be true or false'); return value; },
    oneOf(value, path, options) { if (!options.includes(value)) fail(path, `must be one of ${options.join(', ')}`); return value; },
    arr(value, path, min, max) {
      if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must be an array of ${min}–${max} entries`);
      return value;
    },
    asset(value, path) {
      if (typeof value !== 'string' || !value.length || value.length > 200) fail(path, 'must be a project-local assets/ path');
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('\\') || value.split(/[\\/]/).includes('..') || !value.startsWith('assets/')) fail(path, `must be a project-local assets/ path (no URLs, "..", or leading slash); got ${JSON.stringify(value)}`);
      if (!/^[a-zA-Z0-9_./ -]+$/.test(value)) fail(path, 'may only contain letters, digits, space, _ . / -');
      if (!/\.(svg|png|jpe?g|webp)$/i.test(value)) fail(path, 'must be an .svg, .png, .jpg or .webp image');
      return value;
    }
  };
}

// ---------------------------------------------------------------------------
// Text metrics, numbers, ticks

export function textWidth(text, size, family, letterSpacingEm = 0) {
  return [...String(text)].length * size * (ADVANCE[family] + letterSpacingEm);
}
// Greedy word wrap with the conservative advance model → line count.
function lineCount(text, size, family, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  let lines = 1, used = 0;
  const space = size * ADVANCE[family];
  for (const word of words) {
    const w = textWidth(word, size, family);
    if (w > width) return Infinity;
    if (used && used + space + w > width) { lines++; used = w; } else used += (used ? space : 0) + w;
  }
  return lines;
}
// Largest size in [min, preferred] (step 2) where text fits maxLines lines.
export function fitText(check, path, text, {family, width, preferred, min, maxLines = 1}) {
  for (let size = Math.floor(preferred); size >= Math.ceil(min); size -= 2) {
    const lines = lineCount(text, size, family, width);
    if (lines <= maxLines) return {size, lines};
  }
  return check.fail(path, `is too long: ${JSON.stringify(text)} does not fit ${maxLines} line${maxLines === 1 ? '' : 's'} at ${Math.ceil(min)} px in ${Math.round(width)} px; shorten it`);
}

export function formatNumber(value, decimals = null) {
  const places = decimals ?? (Math.abs(value - Math.round(value)) < 1e-9 ? 0 : Math.abs(value * 10 - Math.round(value * 10)) < 1e-9 ? 1 : 2);
  const fixed = Math.abs(value).toFixed(places);
  return `${value < 0 && Number(fixed) !== 0 ? '−' : ''}${fixed}`;
}
export function withUnit(text, unit) {
  if (!unit) return text;
  return /^[°%′″'"]/.test(unit) ? `${text}${unit}` : `${text} ${unit}`;
}
export function decimalsOf(value) {
  const text = String(value);
  return text.includes('.') ? Math.min(3, text.split('.')[1].length) : 0;
}
export function niceStep(range, target = 5) {
  const raw = range / target, power = 10 ** Math.floor(Math.log10(raw)), f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power;
}
export function ticks(min, max, target = 5) {
  const step = niceStep(max - min, target), out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v * 1e9) / 1e9 || 0);
  return out;
}
export const r2 = value => Math.round(value * 100) / 100;
export const rt = value => Math.round(value * 10000) / 10000;
export const overlaps = (a, b, pad = 0) => a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;

// ---------------------------------------------------------------------------
// Shared base: canvas, safe zone, colours, fonts, motion, timing

function fontStack(name, role, check, path) {
  if (name === undefined) return registryStack(null, role);
  if (typeof name !== 'string' || !/^[a-zA-Z0-9 -]{1,40}$/.test(name)) check.fail(path, 'must be a font name of letters, digits, spaces or hyphens');
  return registryStack(name, role);
}

export function createBase(moduleId, params, ctx, {allowed, required = [], hidesCaptions = false}) {
  if (!ctx || typeof ctx !== 'object') throw new Error(`${moduleId}: ctx is required`);
  const id = ctx.id;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,59}$/.test(id)) throw new Error(`${moduleId}: ctx.id must be a lowercase DOM-safe id`);
  const prefix = `${id} (${moduleId}): `;
  const check = makeCheck(prefix);
  check.obj(params ?? {}, 'params', [...allowed, 'rect'], required);
  params = params ?? {};
  const format = ctx.format ?? {};
  const width = check.int(format.width, 'format.width', 240, 7680), height = check.int(format.height, 'format.height', 240, 7680);
  const fps = check.num(format.fps ?? 30, 'format.fps', 1, 120);
  const start = check.num(ctx.start, 'start', 0, 86400), duration = check.num(ctx.duration, 'duration', CATALOG_B_TIMING.minDuration, 3600);
  const canvas = {width, height};
  const portrait = height > width;
  const aspect = ctx.aspect ?? (portrait ? '9:16' : '16:9');
  const unit = Math.min(width, height) / 1080;

  // Colours
  const brand = ctx.brand ?? {};
  const colorsIn = brand.colors ?? {};
  const colors = {};
  for (const key of ['bg', 'primary', 'accent', 'ink', 'paper']) {
    if (!HEX6.test(colorsIn[key] ?? '')) check.fail(`brand.colors.${key}`, 'must be a six-digit hex colour');
    colors[key] = colorsIn[key].toLowerCase();
  }
  const fontsIn = brand.fonts ?? {};
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
  requireContrast('paper/bg', colors.paper, colors.bg, 'brand.colors.paper on brand.colors.bg');
  requireContrast('muted/bg', theme.muted, colors.bg, 'muted text (paper at 62% over bg)');
  const resolveColor = (value, path, fallback, on = colors.bg, onLabel = 'brand.colors.bg') => {
    const raw = value ?? fallback;
    let hex;
    if (ROLE_NAMES.includes(raw)) hex = colors[raw];
    else if (typeof raw === 'string' && HEX6.test(raw)) hex = raw.toLowerCase();
    else check.fail(path, `must be ${ROLE_NAMES.join(', ')} or a six-digit hex colour`);
    requireContrast(`${path}/${onLabel}`, hex, on, `${path} (${raw}) on ${onLabel}`);
    return hex;
  };

  // Safe zone: Shorts (portrait) or title-safe (landscape). Modules that keep
  // captions stay above the caption band.
  const geometry = profileGeometry(canvas, portrait ? 'shorts' : 'landscape');
  const zone = geometry.safeZone, band = geometry.captionBand;
  const captionGap = 30 * unit;
  const bottom = hidesCaptions ? zone.y + zone.height : Math.min(zone.y + zone.height, band.y - captionGap);
  // Round inward to 0.01 px so the rect never pokes outside the zone.
  const up = v => Math.ceil(v * 100 - 1e-6) / 100, down = v => Math.floor(v * 100 + 1e-6) / 100;
  const sx = up(zone.x), sy = up(zone.y);
  const safe = {x: sx, y: sy, width: r2(down(zone.x + zone.width) - sx), height: r2(down(bottom) - sy)};
  let rect = {...safe};
  if (params.rect !== undefined) {
    check.obj(params.rect, 'params.rect', ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    const r = params.rect;
    check.num(r.width, 'params.rect.width', 0.5 * safe.width, safe.width);
    check.num(r.height, 'params.rect.height', 0.35 * safe.height, safe.height);
    check.num(r.x, 'params.rect.x', safe.x, safe.x + safe.width - r.width);
    check.num(r.y, 'params.rect.y', safe.y, safe.y + safe.height - r.height);
    rect = {x: r.x, y: r.y, width: r.width, height: r.height};
  }

  // Motion
  // Motion grammar (grammar.mjs): editorial keeps CATALOG_B_STYLE exactly.
  // Event windows keep the editorial bounds, so a slower grammar never makes
  // a default event time invalid.
  const S = CATALOG_B_STYLE, grammar = ctx.grammar ?? null;
  const enterDuration = grammarDuration(grammar, 'enter', S.enterDuration, {min: 0.3, max: 0.7}), exitDuration = grammarDuration(grammar, 'exit', S.exitDuration, {min: 0.2, max: 0.5});
  const end = rt(start + duration);
  const motion = {enterStart: rt(start), enterEnd: rt(start + enterDuration), exitStart: rt(end - exitDuration), end, enterDuration, exitDuration,
    enterFrom: {opacity: 0, x: 0, y: r2(40 * unit), scale: 0.97}, exitTo: {opacity: 0, x: 0, y: r2(-28 * unit), scale: 1},
    enterEase: grammarEase(grammar, S.enterEase), exitEase: grammarEase(grammar, S.exitEase)};
  const hits = Array.isArray(ctx.hits) ? ctx.hits.filter(hit => hit && typeof hit.event === 'string' && typeof hit.at === 'number') : [];
  // Latest allowed event time leaves 0.3 s before the exit begins.
  const lastEvent = duration - Math.min(exitDuration, S.exitDuration) - CATALOG_B_TIMING.exitHold;
  /** Absolute time for event `name`: params `at` (scene-relative) > ctx hit > fallback (scene-relative). */
  const timeOf = (name, at, path, fallback, {min = Math.min(enterDuration, S.enterDuration), max = lastEvent} = {}) => {
    let rel;
    if (at !== undefined) rel = check.num(at, path, 0, duration);
    else {
      const hit = hits.find(entry => entry.event === name);
      rel = hit ? hit.at - start : fallback;
    }
    if (!withinBounds(rel, min, max)) check.fail(at !== undefined ? path : `${path} (default for "${name}")`, `must fall between ${formatBound(min)} s and ${formatBound(max)} s after the scene start; got ${r2(rel)} s${at === undefined ? ' — lengthen the scene or set it explicitly' : ''}`);
    return rt(start + rel);
  };

  // Minimums round up so scaled canvases never dip below the floor.
  const min = {key: Math.ceil(S.minKeyText * unit * 100 - 1e-6) / 100, meta: Math.ceil(S.minMetaText * unit * 100 - 1e-6) / 100};
  const events = [{id: `${id}-enter`, name: 'enter', time: motion.enterEnd, role: 'enter'}];
  const model = {id, module: moduleId, canvas, aspect, fps, unit: r2(unit), start: rt(start), duration: rt(duration), end, track: 2, rect, safe, motion, content: null, events,
    layout: null, hidesCaptions, theme, fonts, contrast, objects: {}, minTextPx: min.key};
  const finish = (content, {minTextPx = min.key} = {}) => {
    model.content = content;
    model.minTextPx = minTextPx;
    if (minTextPx + 1e-9 < min.key) throw new Error(`${prefix}key text ${minTextPx}px is below ${min.key}px`);
    model.events.sort((a, b) => a.time - b.time);
    model.layout = {canvas, rect: {...rect}, motion: {enterEnd: motion.enterEnd, exitStart: motion.exitStart, end}, role: 'hero', minTextPx, hidesCaptions};
    return model;
  };
  return {id, check, params, canvas, portrait, unit, fps, start, duration, end, rect, safe, colors, theme, fonts, resolveColor, requireContrast, motion, timeOf, lastEvent, min, events, model, finish, u: v => r2(v * unit)};
}

/** Per-frame samples over [t0, t1] (absolute). fn(t) → object merged with {t}. */
export function frameSamples(t0, t1, fps, fn) {
  const out = [];
  const first = Math.ceil(t0 * fps - 1e-6), last = Math.floor(t1 * fps + 1e-6);
  for (let f = first; f <= last; f++) out.push({t: rt(f / fps), ...fn(f / fps)});
  if (!out.length || out[out.length - 1].t < t1 - 1e-6) out.push({t: rt(t1), ...fn(t1)});
  return out;
}
export const progress = (t, start, duration, easeName) => getEase(easeName)(Math.min(1, Math.max(0, (t - start) / duration)));

/**
 * Sample index for absolute time t: the last sample whose time is at or
 * before t + SAMPLE_LEAD (the same rule GSAP applies to the tl.set calls).
 * Returns -1 before the first sample.
 */
export function sampleIndex(samples, t) {
  let lo = 0, hi = samples.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t - SAMPLE_LEAD <= t + 1e-9) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
