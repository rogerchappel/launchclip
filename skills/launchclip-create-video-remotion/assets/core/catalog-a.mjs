// Catalogue A: big-type storytelling modules (STORYBOARD_ENGINE_RFC.md §5).
//
//   hook-title       frame-0 visible opening claim or question
//   kinetic-words    1–3 words per beat, word-timed
//   count-up         one big number that counts to its value, then hits
//   equation-lockup  a formula whose terms land one by one
//   cta              end card with an action, a handle and a pulsing accent
//
// Renderer-neutral, plain ESM, imports only sibling kit/core files. Each
// module turns (params, ctx) into a resolved model; the HyperFrames emitter
// (kit/hyperframes/catalog-a.mjs) and the Remotion components
// (kit/remotion/catalog/*.tsx) draw that model and nothing else. Contract:
// docs/KIT_CONTRACTS.md, "Wave 2".
//
// The model carries everything both renderers need to stay in step:
//
//   styles      node name → static CSS declarations (camelCase keys, string
//               values). Node "root" is the module element itself; every
//               other node renders as `#<id>-<node>`. Static styles never set
//               opacity, transform or filter on a node that is animated.
//   classes     class name → CSS declarations for repeated parts (equation
//               atoms), rendered as `#<id> .<class>` in HyperFrames.
//   animations  [{node, start, duration, ease, from, to}] in absolute
//               seconds. Props: opacity, x, y (px), scale, scaleX, rotation
//               (deg), blur (px) and color (hex). For any node and prop the
//               tweens never overlap and each starts where the previous one
//               ended, so GSAP renders the same value whichever direction it
//               seeks from. sampleNode() evaluates them with motion.mjs.
//   texts       [{node, initial, frames:[{time, text}]}] discrete text states
//               (count-up digits), the editorial textFrames() pattern.
//
// Hard rules enforced here (RFC §5): the footprint stays inside the Shorts
// safe zone (or landscape title-safe), above the caption band when captions
// stay visible; key text is at least 44 px at 1080 (scaled with the canvas);
// every brand colour pair used for text or a filled accent clears 3:1 WCAG
// contrast or resolve() throws; blur is 0 at settle.
import {profileGeometry} from './layout-check.mjs';
import {fontFamilyName, fontStack, fontWidthScale} from './fonts.mjs';
import {countUp, splitWords, tween} from './motion.mjs';
import {grammarDuration, grammarEase, grammarStagger, grammarTweens} from './grammar.mjs';

export const CATALOG_A_IDS = Object.freeze(['hook-title', 'kinetic-words', 'count-up', 'equation-lockup', 'cta']);
export const ANIMATED_PROPS = Object.freeze(['opacity', 'x', 'y', 'scale', 'scaleX', 'rotation', 'blur', 'color']);
export const MIN_CONTRAST = 3;

// ---------------------------------------------------------------------------
// Validation helpers. Messages start with the parameter path.

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function fields(value, path, allowed, required = []) {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key} is not a known parameter (allowed: ${allowed.join(', ')})`);
  for (const key of required) if (value[key] === undefined) throw new Error(`${path}.${key} is required`);
}
function text(value, path, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error(`${path} must be a string of ${min}–${max} characters`);
  if (/[<>]/.test(value)) throw new Error(`${path} must not contain < or >`);
  return value.trim().replace(/\s+/g, ' ');
}
function number(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${path} must be a number between ${min} and ${max}`);
  return value;
}
function integer(value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${path} must be an integer between ${min} and ${max}`);
  return value;
}
function bool(value, path) {
  if (typeof value !== 'boolean') throw new Error(`${path} must be true or false`);
  return value;
}
function oneOf(value, path, options) {
  if (!options.includes(value)) throw new Error(`${path} must be one of ${options.map(option => JSON.stringify(option)).join(', ')}`);
  return value;
}
function optional(value, fallback, check) { return value === undefined ? fallback : check(value); }

// Scene-relative time inside [0, duration - tail].
function sceneTime(value, path, duration, tail = 0) {
  const max = Math.max(0, duration - tail);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max + 1e-9) throw new Error(`${path} must be seconds from the scene start between 0 and ${round(max, 3)} (the scene is ${round(duration, 3)} s)`);
  return value;
}

const round = (value, digits = 2) => { const f = 10 ** digits; return Math.round(value * f) / f; };
const T = value => round(value, 6);
const px = value => `${round(value)}px`;
const em = value => `${round(value, 3)}em`;

// ---------------------------------------------------------------------------
// Colour

const HEX6 = /^#[0-9a-f]{6}$/i;

function channels(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function relativeLuminance(hex) {
  const [r, g, b] = channels(hex).map(value => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio of two #rrggbb colours (1–21). */
export function contrastRatio(a, b) {
  if (!HEX6.test(a) || !HEX6.test(b)) throw new Error('contrastRatio expects #rrggbb colours');
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `amount` (0–1) over `bg`, as #rrggbb. */
export function mixHex(fg, bg, amount) {
  const a = channels(fg), b = channels(bg);
  return `#${a.map((c, i) => Math.round(c * amount + b[i] * (1 - amount)).toString(16).padStart(2, '0')).join('')}`;
}
const alpha = (hex, value) => `${hex}${Math.round(value * 255).toString(16).padStart(2, '0')}`;

function brandTheme(brand) {
  if (!isObject(brand) || !isObject(brand.colors)) throw new Error('brand.colors must be an object with bg, paper and primary');
  const color = (name, fallback) => {
    const value = brand.colors[name] ?? fallback;
    if (value === undefined) throw new Error(`brand.colors.${name} is required`);
    if (typeof value !== 'string' || !HEX6.test(value)) throw new Error(`brand.colors.${name} must be a six-digit hex colour`);
    return value.toLowerCase();
  };
  const bg = color('bg'), paper = color('paper'), primary = color('primary');
  const accent = color('accent', primary), ink = color('ink', bg);
  return {bg, paper, primary, accent, ink, muted: mixHex(paper, bg, .62), faint: mixHex(paper, bg, .18)};
}

/** Throws when a brand colour pair falls below MIN_CONTRAST. Returns the ratio. */
function requireContrast(record, label, fg, bg) {
  const ratio = contrastRatio(fg, bg);
  if (ratio < MIN_CONTRAST) throw new Error(`brand contrast too low: ${label} (${fg} on ${bg}) is ${ratio.toFixed(2)}:1; it needs at least ${MIN_CONTRAST}:1. Pick brand colours or params.color with more contrast`);
  record[label] = round(ratio, 2);
  return ratio;
}

function moduleTheme(brand, colorRole, path) {
  const base = brandTheme(brand);
  const emphasis = base[oneOf(colorRole, path, ['primary', 'accent'])];
  const theme = {...base, emphasis, surface: base.bg, foreground: base.paper, border: base.faint, accentText: emphasis};
  const contrast = {};
  requireContrast(contrast, 'paper on bg', base.paper, base.bg);
  requireContrast(contrast, 'muted on bg', base.muted, base.bg);
  requireContrast(contrast, `${colorRole} on bg`, emphasis, base.bg);
  return {theme, contrast};
}

// ---------------------------------------------------------------------------
// Fonts. Brand font ids ("anton", "space-grotesk") resolve through the
// bundled font registry (fonts.mjs) into stacks that name only bundled
// families, identical in both renderers. Missing roles use the registry's
// role defaults (Anton, Inter, JetBrains Mono; STIX Two Text for maths).

function familyName(value, path) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9 _-]{1,48}$/.test(value)) throw new Error(`${path} must be a font family name of letters, digits, spaces or dashes`);
  return fontFamilyName(value);
}
function brandFonts(brand) {
  const fonts = isObject(brand?.fonts) ? brand.fonts : {};
  const stack = role => fontStack(fonts[role] ? familyName(fonts[role], `brand.fonts.${role}`) : null, role);
  return {display: stack('display'), body: stack('body'), meta: stack('meta'), math: fontStack(null, 'math')};
}
// Text-fit kinds for brand.fonts: the role's width table scaled by how much
// wider the brand family sets than the role default (fontWidthScale), so a
// wide display face such as Unbounded gets smaller type instead of overflowing.
function fitKinds(brand) {
  const fonts = isObject(brand?.fonts) ? brand.fonts : {};
  const kind = role => ({kind: role, scale: fontWidthScale(typeof fonts[role] === 'string' ? fontFamilyName(fonts[role]) : null, role)});
  return {display: kind('display'), body: kind('body'), meta: kind('meta')};
}

// ---------------------------------------------------------------------------
// Text measurement: a conservative per-character width model in em. The
// renderers lay text out with CSS, so this only sizes type and estimates the
// footprint; line breaks it chooses are rendered as explicit lines.

// Mean advance (em) per character class, measured in Chrome on the bundled
// role defaults (display Anton 400, body Inter at 650, meta JetBrains Mono,
// math STIX Two Text) and padded about 5%. A brand family wider than its role
// default scales the table (fitKinds / fontWidthScale in fonts.mjs). Operators
// and arrows outside the latin subset come from STIX Two Math.
const NARROW = /[.,:;'!|iIl1()\[\]’‘"]/;
const WIDE = /[MWmw@%&]/;
const OPERATOR = /[=+−×÷∝≈<>≤≥≠→·]/;
const WIDTHS = {
  display: {upper: .48, lower: .48, narrow: .28, wide: .81, space: .25, digit: .5, op: .53},
  body: {upper: .71, lower: .59, narrow: .37, wide: .96, space: .27, digit: .65, op: .72},
  meta: {upper: .6, lower: .6, narrow: .6, wide: .6, space: .6, digit: .6, op: .7},
  math: {upper: .64, lower: .52, narrow: .36, wide: .86, space: .25, digit: .5, op: .74}
};

/** kind: 'display' | 'body' | 'meta' | 'math', or a fitKinds() entry {kind, scale}. */
export function textWidth(value, size, kind = 'body', tracking = 0) {
  const w = WIDTHS[typeof kind === 'string' ? kind : kind.kind];
  const scale = typeof kind === 'string' ? 1 : kind.scale;
  let total = 0, count = 0;
  for (const ch of String(value)) {
    count++;
    if (ch === ' ') total += w.space;
    else if (/[0-9]/.test(ch)) total += w.digit;
    else if (NARROW.test(ch)) total += w.narrow;
    else if (WIDE.test(ch)) total += w.wide;
    else if (OPERATOR.test(ch)) total += w.op;
    else if (/\p{Lu}/u.test(ch)) total += w.upper;
    else total += w.lower;
  }
  return (total * scale + tracking * count) * size;
}

/**
 * Break `tokens` (strings, kept whole) into at most `maxLines` lines no wider
 * than `maxWidth`, minimising the widest line (balanced, no widows). Returns
 * an array of token arrays, or null when a token alone is too wide or the
 * tokens need more lines.
 */
function balance(tokens, maxWidth, lines, measure) {
  const n = tokens.length;
  if (lines > n) return null;
  const width = (i, j) => measure(tokens.slice(i, j).join(' '));
  for (const token of tokens) if (measure(token) > maxWidth) return null;
  // cost[l][j]: smallest possible widest line for tokens[0..j) in exactly l lines.
  const cost = Array.from({length: lines + 1}, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({length: lines + 1}, () => new Array(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let l = 1; l <= lines; l++) for (let j = l; j <= n; j++) for (let i = l - 1; i < j; i++) {
    if (cost[l - 1][i] === Infinity) continue;
    const w = width(i, j);
    if (w > maxWidth) continue;
    const c = Math.max(cost[l - 1][i], w);
    if (c < cost[l][j] - 1e-9) { cost[l][j] = c; cut[l][j] = i; }
  }
  if (cost[lines][n] === Infinity) return null;
  const result = [];
  let j = n;
  for (let l = lines; l > 0; l--) { const i = cut[l][j]; result.unshift(tokens.slice(i, j)); j = i; }
  return result;
}

/**
 * Size (step 2) and balanced line breaks for a block of display copy. Each
 * line count gets its largest fitting size; the winner maximises size with a
 * 6% penalty per extra line, so "HOT COFFEE / COOLS FAST" beats one word per
 * line at a hair larger size.
 */
function fitLines(tokens, {kind, maxWidth, maxLines, maxSize, minSize, lineHeight, maxHeight, tracking = 0}) {
  let best = null;
  for (let count = 1; count <= Math.min(maxLines, tokens.length); count++) {
    for (let size = Math.floor(maxSize); size >= minSize; size -= 2) {
      if (count * size * lineHeight > maxHeight) continue;
      const lines = balance(tokens, maxWidth, count, value => textWidth(value, size, kind, tracking));
      if (!lines) continue;
      const score = size * (1 - .06 * (count - 1));
      if (!best || score > best.score + 1e-9) best = {size, lines, score};
      break;
    }
  }
  return best && {size: best.size, lines: best.lines};
}

// ---------------------------------------------------------------------------
// Stage geometry

function stage(ctx, {captions}) {
  const width = ctx.format.width, height = ctx.format.height;
  const portrait = height > width;
  const geometry = profileGeometry({width, height}, portrait ? 'shorts' : 'landscape');
  const k = Math.min(width, height) / 1080;
  const safe = geometry.safeZone, band = geometry.captionBand;
  const zone = {...safe};
  // Captions stay visible: keep a 40 px gutter above the caption band.
  if (captions) zone.height = Math.max(0, band.y - 40 * k - safe.y);
  return {canvas: {width, height}, portrait, k, zone, safeZone: safe, captionBand: band, centerY: geometry.centerOfMassY, minText: 44 * k};
}

function rectParam(value, st, path) {
  fields(value, path, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
  for (const key of ['x', 'y', 'width', 'height']) number(value[key], `${path}.${key}`, 0, 10000);
  const z = st.zone;
  const inside = value.x >= z.x - .5 && value.y >= z.y - .5 && value.x + value.width <= z.x + z.width + .5 && value.y + value.height <= z.y + z.height + .5;
  if (!inside) throw new Error(`${path} must stay inside the safe zone x ${round(z.x)}–${round(z.x + z.width)}, y ${round(z.y)}–${round(z.y + z.height)}`);
  return {x: value.x, y: value.y, width: value.width, height: value.height};
}

/** Footprint of a block of `height` px, centred near the profile's centre of mass. */
function placeBlock(st, height, rect, what) {
  const z = st.zone;
  if (rect) {
    if (height > rect.height + 1) throw new Error(`${what} needs ${Math.ceil(height)} px but params.rect is ${round(rect.height)} px tall`);
    return rect;
  }
  if (height > z.height + 1) throw new Error(`${what} needs ${Math.ceil(height)} px but the safe zone is ${round(z.height)} px tall; shorten the copy`);
  const y = Math.min(Math.max(st.centerY - height / 2, z.y), z.y + z.height - height);
  return {x: round(z.x), y: round(y), width: round(z.width), height: round(height)};
}

// ---------------------------------------------------------------------------
// Animation bookkeeping and frame-pure sampling

function animator() {
  const animations = [];
  const add = (node, start, duration, ease, from, to) => {
    for (const prop of Object.keys(to)) if (!ANIMATED_PROPS.includes(prop) || !(prop in from)) throw new Error(`internal: bad animated prop ${prop}`);
    animations.push({node, start: T(start), duration: T(duration), ease, from, to});
  };
  return {animations, add};
}

function nodeTracks(model, node) {
  const tracks = {};
  for (const a of model.animations) {
    if (a.node !== node) continue;
    for (const prop of Object.keys(a.to)) (tracks[prop] ??= []).push(a);
  }
  for (const list of Object.values(tracks)) list.sort((a, b) => a.start - b.start);
  return tracks;
}

/** Animated prop values of `node` before any of its tweens run. */
export function initialNodeProps(model, node) {
  const out = {};
  for (const [prop, list] of Object.entries(nodeTracks(model, node))) out[prop] = list[0].from[prop];
  return out;
}

/**
 * Animated prop values of `node` at absolute time t: the latest tween that
 * has started decides (GSAP timeline semantics), evaluated with motion.mjs.
 */
export function sampleNode(model, node, t) {
  const out = {};
  for (const [prop, list] of Object.entries(nodeTracks(model, node))) {
    let active = null;
    for (const a of list) if (a.start <= t + 1e-9) active = a;
    out[prop] = active ? tween(t, {from: active.from[prop], to: active.to[prop], start: active.start, duration: active.duration, ease: active.ease}) : list[0].from[prop];
  }
  return out;
}

/** Text of a discrete text node at absolute time t. */
export function textAt(model, node, t) {
  const entry = model.texts.find(item => item.node === node);
  if (!entry) return null;
  let value = entry.initial;
  for (const frame of entry.frames) if (frame.time <= t + 1e-9) value = frame.text;
  return value;
}

/** Every node that has at least one animation. */
export function animatedNodes(model) { return [...new Set(model.animations.map(a => a.node))]; }

const num = value => String(Math.round(value * 1e4) / 1e4);

/**
 * Animated prop values → CSS declarations (camelCase), the same composition
 * GSAP's CSSPlugin writes: translate(x, y) rotate(r) scale(sx, sy).
 */
export function cssFromProps(props) {
  const out = {};
  if ('opacity' in props) out.opacity = num(props.opacity);
  if ('color' in props) out.color = props.color;
  if ('blur' in props) out.filter = `blur(${num(props.blur)}px)`;
  if (['x', 'y', 'scale', 'scaleX', 'rotation'].some(prop => prop in props)) {
    const sx = props.scaleX ?? props.scale ?? 1, sy = props.scale ?? 1;
    out.transform = `translate(${num(props.x ?? 0)}px, ${num(props.y ?? 0)}px) rotate(${num(props.rotation ?? 0)}deg) scale(${num(sx)}, ${num(sy)})`;
  }
  return out;
}

/** Node name → DOM id: the root is the module id, everything else `<id>-<node>`. */
export const nodeId = (model, node) => (node === 'root' ? model.id : `${model.id}-${node}`);

// ---------------------------------------------------------------------------
// Shared model assembly

function baseContext(ctx) {
  if (!isObject(ctx)) throw new Error('ctx must be an object');
  const {id, start, duration, format} = ctx;
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error('ctx.id must be a scene id of letters, digits, _ or -');
  number(start, 'ctx.start', 0, 86400);
  number(duration, 'ctx.duration', .5, 600);
  if (!isObject(format)) throw new Error('ctx.format must be an object');
  integer(format.width, 'ctx.format.width', 160, 7680);
  integer(format.height, 'ctx.format.height', 160, 7680);
  number(format.fps ?? 30, 'ctx.format.fps', 1, 240);
  return {id, start, duration, end: T(start + duration), fps: format.fps ?? 30, grammar: ctx.grammar ?? null};
}

function assemble({module, ctx, base, st, rect, theme, contrast, fonts, hidesCaptions, motion, content, styles, classes = {}, anim, texts = [], events}) {
  const {id, start, duration, end} = base;
  // Inherited text defaults are pinned on the root so the page around the
  // module (HyperFrames document, Remotion AbsoluteFill) cannot leak in.
  // Flex children never shrink: when copy runs taller than the estimated
  // footprint, empty rules and bars would otherwise collapse to 0 px.
  for (const [node, style] of Object.entries(styles)) if (node !== 'root' && style.position !== 'absolute' && !('flexShrink' in style)) style.flexShrink = '0';
  styles.root = {...styles.root, color: theme.paper, fontFamily: fonts.body, fontSize: px(44 * st.k), lineHeight: '1.2', letterSpacing: 'normal', fontStyle: 'normal', fontWeight: '400', WebkitFontSmoothing: 'antialiased'};
  // Motion grammar (grammar.mjs): entrance, exit and pop eases follow the
  // story's grammar; editorial leaves every ease as designed.
  grammarTweens(anim.animations, base.grammar);
  const model = {
    id, module, aspect: ctx.aspect ?? (st.portrait ? '9:16' : '16:9'), canvas: st.canvas, start, duration, end, fps: base.fps,
    track: ctx.track ?? 0, scale: round(st.k, 4), rect, safeZone: st.zone, minTextPx: round(st.minText, 2),
    theme, contrast, fonts, hidesCaptions,
    motion: {enter: T(motion.enterEnd - start), exit: T(end - motion.exitStart), enterStart: start, enterEnd: T(motion.enterEnd), exitStart: T(motion.exitStart), end,
      enterFrom: motion.enterFrom, exitTo: motion.exitTo, enterEase: grammarEase(base.grammar, motion.enterEase, {props: motion.enterFrom}), exitEase: grammarEase(base.grammar, motion.exitEase, {props: motion.exitTo})},
    content, styles, classes, animations: anim.animations, texts,
    events: events.map(event => ({...event, time: T(event.time), ...(event.endTime !== undefined ? {endTime: T(event.endTime)} : {})})).sort((a, b) => a.time - b.time),
    layout: {canvas: st.canvas, rect, motion: {enterEnd: T(motion.enterEnd), exitStart: T(motion.exitStart), end}}
  };
  const minFont = Math.min(...content.keyTextPx);
  if (minFont < st.minText - .01) throw new Error(`key text would be ${minFont}px, below the ${round(st.minText)}px floor; shorten the copy`);
  return model;
}

const rootStyle = (rect, extra = {}) => ({position: 'absolute', left: px(rect.x), top: px(rect.y), width: px(rect.width), height: px(rect.height), boxSizing: 'border-box', ...extra});
const glowStyle = (color, w, h, offsetY = 0) => ({position: 'absolute', left: '50%', top: '50%', width: px(w), height: px(h), marginLeft: px(-w / 2), marginTop: px(-h / 2 + offsetY), borderRadius: '50%', background: `radial-gradient(closest-side, ${alpha(color, .26)}, ${alpha(color, .1)} 55%, ${alpha(color, 0)})`, pointerEvents: 'none'});

function standardExit(anim, base, st, exit = .3) {
  exit = grammarDuration(base.grammar, 'exit', exit, {min: .18, max: .45});
  const exitStart = base.end - exit;
  anim.add('root', exitStart, exit, 'power2.in', {opacity: 1, y: 0}, {opacity: 0, y: -40 * st.k});
  return {exitStart, exitTo: {opacity: 0, y: round(-40 * st.k)}, exitEase: 'power2.in'};
}

/** Words of `value` grouped so that each emphasis phrase stays one token. */
function phraseTokens(value, phrases, path) {
  const words = splitWords(value).map(word => word.text);
  const tokens = words.map(word => ({text: word, emphasis: null}));
  phrases.forEach((phrase, index) => {
    const target = splitWords(phrase).map(word => word.text.toLowerCase());
    const clean = word => word.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '');
    const strip = list => list.map(clean);
    let found = -1;
    for (let i = 0; i + target.length <= tokens.length && found < 0; i++) {
      const slice = tokens.slice(i, i + target.length);
      if (slice.some(token => token.emphasis !== null || token.merged)) continue;
      if (strip(slice.map(token => token.text)).join(' ') === strip(target).join(' ')) found = i;
    }
    if (found < 0) throw new Error(`${path}[${index}].text ${JSON.stringify(phrase)} must match whole words of the headline`);
    const merged = {text: tokens.slice(found, found + target.length).map(token => token.text).join(' '), emphasis: index};
    tokens.splice(found, target.length, merged);
  });
  return tokens;
}

// ---------------------------------------------------------------------------
// hook-title

function resolveHookTitle(params, ctx) {
  const base = baseContext(ctx), d = base.duration;
  fields(params, 'params', ['headline', 'emphasis', 'kicker', 'kickerAt', 'eyebrow', 'color', 'align', 'rect'], ['headline']);
  if (d < 1.5) throw new Error('hook-title needs a scene of at least 1.5 s');
  const headline = text(params.headline, 'params.headline', 90);
  const eyebrow = optional(params.eyebrow, null, value => text(value, 'params.eyebrow', 32));
  const kicker = optional(params.kicker, null, value => text(value, 'params.kicker', 18));
  if (params.kickerAt !== undefined && !kicker) throw new Error('params.kickerAt needs params.kicker');
  const kickerAt = kicker ? optional(params.kickerAt, Math.min(d * .55, d - .9), value => sceneTime(value, 'params.kickerAt', d, .6)) : null;
  const align = optional(params.align, 'center', value => oneOf(value, 'params.align', ['center', 'left']));
  const colorRole = optional(params.color, 'primary', value => value);
  const emphasisInput = optional(params.emphasis, [], value => {
    if (typeof value === 'string') value = [{text: value}];
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) throw new Error('params.emphasis must be a phrase or a list of 1–3 {text, at, color?}');
    return value;
  });
  const emphasis = emphasisInput.map((entry, index) => {
    const path = `params.emphasis[${index}]`;
    fields(entry, path, ['text', 'at', 'color'], ['text']);
    return {
      text: text(entry.text, `${path}.text`, 40),
      at: optional(entry.at, Math.min(.45 + index * .9, d - .8), value => sceneTime(value, `${path}.at`, d, .5)),
      colorRole: optional(entry.color, colorRole, value => oneOf(value, `${path}.color`, ['primary', 'accent']))
    };
  });
  const {theme, contrast} = moduleTheme(ctx.brand, colorRole, 'params.color');
  for (const entry of emphasis) requireContrast(contrast, `${entry.colorRole} on bg`, theme[entry.colorRole], theme.bg);
  if (kicker) requireContrast(contrast, `ink on ${colorRole}`, theme.ink, theme.emphasis);
  const fonts = brandFonts(ctx.brand), fk = fitKinds(ctx.brand);
  const st = stage(ctx, {captions: false});
  const k = st.k, rect = params.rect === undefined ? null : rectParam(params.rect, st, 'params.rect');
  const width = (rect ?? st.zone).width * .94;

  const tokens = phraseTokens(headline, emphasis.map(entry => entry.text), 'params.emphasis');
  const lineHeight = .98;
  const eyebrowSize = Math.ceil(44 * k), eyebrowGap = Math.round(30 * k), ruleGap = Math.ceil(44 * k);
  const kickerSize = Math.round(84 * k), kickerGap = Math.round(56 * k);
  const chrome = (eyebrow ? eyebrowSize * 1.2 + eyebrowGap + 6 * k + ruleGap : 0) + (kicker ? kickerGap + kickerSize * 1.36 : 0);
  const fit = fitLines(tokens.map(token => token.text.toUpperCase()), {kind: fk.display, maxWidth: width, maxLines: 5, maxSize: (st.portrait ? 176 : 150) * k, minSize: 72 * k, lineHeight, maxHeight: (rect ?? st.zone).height - chrome});
  if (!fit) throw new Error('params.headline is too long to set at 72 px or more in five lines; shorten it');
  if (eyebrow && textWidth(eyebrow.toUpperCase(), eyebrowSize, fk.meta, .16) > width) throw new Error('params.eyebrow is too wide for the safe zone; shorten it');
  // Rebuild the lines from tokens (balance worked on upper-cased strings).
  let cursor = 0;
  const lines = fit.lines.map(line => line.map(() => tokens[cursor++]));
  const size = fit.size;
  const blockHeight = chrome + lines.length * size * lineHeight;
  const box = placeBlock(st, blockHeight, rect, 'hook-title');

  const anim = animator();
  const s = base.start, end = base.end;
  const enterEnd = s + Math.min(1.3, d * .45);
  anim.add('root', s, enterEnd - s, 'expo.out', {scale: 1.035}, {scale: 1});
  const exit = standardExit(anim, base, st);
  anim.add('glow', s, Math.min(1.6, d * .4), 'sine.inOut', {opacity: .45}, {opacity: .9});
  anim.add('glow', s + Math.min(1.6, d * .4), Math.max(.1, exit.exitStart - s - Math.min(1.6, d * .4)), 'sine.inOut', {opacity: .9}, {opacity: .6});
  if (eyebrow) {
    anim.add('eyebrow', s + .1, .5, 'power2.out', {opacity: 0, y: 16 * k}, {opacity: 1, y: 0});
    anim.add('rule', s + .05, .6, 'power3.inOut', {scaleX: 0}, {scaleX: 1});
  }
  const words = [];
  let wordIndex = 0;
  const lineModels = lines.map((line, lineIndex) => ({index: lineIndex, words: line.map(token => {
    const word = {index: wordIndex++, text: token.text, emphasis: token.emphasis};
    words.push(word);
    return word;
  })}));
  for (const word of words) anim.add(`word-${word.index}`, s + word.index * .035, .7, 'power3.out', {y: 30 * k}, {y: 0});
  const events = [{id: `${base.id}-title`, time: s, role: 'title', cue: 'whoosh'}];
  const emphasisModels = emphasis.map((entry, index) => {
    const word = words.find(item => item.emphasis === index);
    const at = s + entry.at, color = theme[entry.colorRole];
    const node = `word-${word.index}`;
    anim.add(`${node}-text`, at, .22, 'power2.out', {color: theme.paper}, {color});
    anim.add(node, at, .14, 'power2.out', {scale: 1}, {scale: 1.1});
    anim.add(node, at + .14, .45, 'power3.out', {scale: 1.1}, {scale: 1});
    anim.add(`${node}-bar`, at + .04, .42, 'expo.out', {scaleX: 0}, {scaleX: 1});
    anim.add(`${node}-glow`, at, .18, 'power2.out', {opacity: 0}, {opacity: .95});
    anim.add(`${node}-glow`, at + .18, .8, 'power2.inOut', {opacity: .95}, {opacity: .45});
    events.push({id: `${base.id}-emphasis-${index}`, time: at, role: 'emphasis', cue: 'impact'});
    return {index, text: entry.text, word: word.index, time: T(at), color, settleTime: T(at + .59)};
  });
  if (kicker) {
    const at = s + kickerAt;
    anim.add('kicker', at, .16, 'power1.out', {opacity: 0}, {opacity: 1});
    anim.add('kicker', at, .5, 'back.out(2.2)', {scale: .3, rotation: -14}, {scale: 1, rotation: -4});
    events.push({id: `${base.id}-kicker`, time: at, role: 'kicker', cue: 'pop'});
  }

  const flexAlign = align === 'center' ? 'center' : 'flex-start';
  const styles = {
    root: rootStyle(box, {display: 'flex', flexDirection: 'column', alignItems: flexAlign, justifyContent: 'center', textAlign: align, transformOrigin: '50% 50%'}),
    glow: glowStyle(theme.emphasis, box.width * 1.25, Math.max(box.height * 1.1, 600 * k)),
    eyebrow: {position: 'relative', fontFamily: fonts.meta, fontSize: px(eyebrowSize), lineHeight: '1.2', letterSpacing: '0.16em', textTransform: 'uppercase', color: theme.muted, fontWeight: '600', whiteSpace: 'nowrap'},
    rule: {position: 'relative', width: px(96 * k), height: px(6 * k), marginTop: px(eyebrowGap), marginBottom: px(ruleGap), borderRadius: px(3 * k), background: theme.emphasis, transformOrigin: align === 'center' ? '50% 50%' : '0% 50%'},
    headline: {position: 'relative', margin: '0', fontFamily: fonts.display, fontSize: px(size), lineHeight: String(lineHeight), letterSpacing: '0.005em', textTransform: 'uppercase', color: theme.paper, fontWeight: '400'},
    kicker: {position: 'relative', marginTop: px(kickerGap), padding: `${em(.1)} ${em(.36)} ${em(.06)}`, borderRadius: px(18 * k), background: theme.emphasis, color: theme.ink, fontFamily: fonts.display, fontSize: px(kickerSize), lineHeight: '1.2', textTransform: 'uppercase', whiteSpace: 'nowrap', transformOrigin: '50% 60%', boxShadow: `0 ${px(18 * k)} ${px(48 * k)} ${alpha(theme.emphasis, .28)}`}
  };
  for (const line of lineModels) styles[`line-${line.index}`] = {display: 'block', whiteSpace: 'nowrap'};
  for (const word of words) {
    styles[`word-${word.index}`] = {display: 'inline-block', position: 'relative', transformOrigin: '50% 60%'};
    if (word.emphasis !== null) {
      const color = emphasisModels[word.emphasis].color;
      styles[`word-${word.index}-glow`] = {position: 'absolute', left: '0', top: '0', right: '0', color, filter: `blur(${px(24 * k)})`, whiteSpace: 'nowrap'};
      styles[`word-${word.index}-text`] = {position: 'relative', whiteSpace: 'nowrap'};
      styles[`word-${word.index}-bar`] = {position: 'absolute', left: '0', right: '0', bottom: em(-.03), height: em(.07), borderRadius: em(.035), background: color, transformOrigin: '0% 50%'};
    }
  }
  return assemble({module: 'hook-title', ctx, base, st, rect: box, theme, contrast, fonts, hidesCaptions: true,
    motion: {enterEnd, enterFrom: {opacity: 1, scale: 1.035}, enterEase: 'expo.out', ...exit},
    content: {headline, eyebrow, kicker, kickerTime: kicker ? T(s + kickerAt) : null, align, size, lineHeight, lines: lineModels, emphasis: emphasisModels, keyTextPx: [size, ...(kicker ? [kickerSize] : []), ...(eyebrow ? [eyebrowSize] : [])]},
    styles, anim, events});
}

// ---------------------------------------------------------------------------
// kinetic-words

function resolveKineticWords(params, ctx) {
  const base = baseContext(ctx), d = base.duration;
  fields(params, 'params', ['words', 'variant', 'layout', 'color', 'rect'], ['words']);
  const variant = optional(params.variant, 'scale', value => oneOf(value, 'params.variant', ['scale', 'rise']));
  const layout = optional(params.layout, 'replace', value => oneOf(value, 'params.layout', ['replace', 'stack']));
  const colorRole = optional(params.color, 'primary', value => value);
  const {theme, contrast} = moduleTheme(ctx.brand, colorRole, 'params.color');
  const maxBeats = layout === 'stack' ? 5 : 12;
  if (!Array.isArray(params.words) || params.words.length < 1 || params.words.length > maxBeats) throw new Error(`params.words must list 1–${maxBeats} beats for the ${layout} layout`);
  const minGap = layout === 'replace' ? .3 : .2;
  const beats = params.words.map((entry, index) => {
    const path = `params.words[${index}]`;
    fields(entry, path, ['text', 'at', 'emphasis', 'color'], ['text', 'at']);
    const value = text(entry.text, `${path}.text`, 28);
    const parts = splitWords(value).map(word => word.text);
    if (parts.length > 3) throw new Error(`${path}.text must be 1–3 words (one beat); split it into more beats`);
    const role = optional(entry.color, colorRole, color => oneOf(color, `${path}.color`, ['primary', 'accent']));
    if (role !== colorRole) requireContrast(contrast, `${role} on bg`, theme[role], theme.bg);
    return {index, text: value, parts, at: sceneTime(entry.at, `${path}.at`, d, .45), emphasis: optional(entry.emphasis, false, flag => bool(flag, `${path}.emphasis`)), color: theme[role]};
  });
  beats.forEach((beat, index) => {
    if (index && beat.at < beats[index - 1].at + minGap - 1e-6) throw new Error(`params.words[${index}].at must be at least ${minGap} s after the previous beat`);
  });
  const fonts = brandFonts(ctx.brand), fk = fitKinds(ctx.brand);
  const st = stage(ctx, {captions: false});
  const k = st.k, rect = params.rect === undefined ? null : rectParam(params.rect, st, 'params.rect');
  const area = rect ?? st.zone;
  const width = area.width * .92, lineHeight = .92;
  const maxSize = (st.portrait ? 360 : 280) * k, minSize = 88 * k;
  const barGap = 30 * k, barHeight = 14 * k;
  let sizes, blockHeight;
  if (layout === 'replace') {
    for (const beat of beats) {
      const fit = fitLines(beat.parts.map(part => part.toUpperCase()), {kind: fk.display, maxWidth: width, maxLines: beat.parts.length, maxSize, minSize, lineHeight, maxHeight: Math.min(area.height, 760 * k)});
      if (!fit) throw new Error(`params.words[${beat.index}].text is too long to set at ${Math.round(minSize)} px or more; shorten it`);
      // Prefer one line; stack the words only when one line would be small.
      const one = fitLines([beat.parts.join(' ').toUpperCase()], {kind: fk.display, maxWidth: width, maxLines: 1, maxSize, minSize, lineHeight, maxHeight: area.height});
      const chosen = one && (one.size >= 150 * k || beat.parts.length === 1 || one.size >= fit.size * .8) ? one : fit;
      beat.size = chosen.size;
      beat.lines = chosen === one ? [beat.parts.join(' ')] : chosen.lines.map(line => line.join(' '));
    }
    sizes = beats.map(beat => beat.size);
    blockHeight = Math.max(...beats.map(beat => beat.lines.length * beat.size * lineHeight + (beat.emphasis ? barGap + barHeight : 0)));
  } else {
    let size = null;
    for (let candidate = Math.floor(maxSize * .8); candidate >= minSize; candidate -= 2) {
      const fits = beats.every(beat => textWidth(beat.text.toUpperCase(), candidate, fk.display) <= width);
      if (fits && beats.length * candidate * 1.0 <= area.height) { size = candidate; break; }
    }
    if (!size) throw new Error(`params.words do not fit the stack layout at ${Math.round(minSize)} px or more; use fewer or shorter beats`);
    for (const beat of beats) { beat.size = size; beat.lines = [beat.text]; }
    sizes = [size];
    blockHeight = beats.length * size * 1.0;
  }
  const box = placeBlock(st, blockHeight, rect, 'kinetic-words');

  const anim = animator();
  const s = base.start;
  const exit = standardExit(anim, base, st);
  const events = [];
  beats.forEach((beat, index) => {
    const at = s + beat.at;
    const next = beats[index + 1] ? s + beats[index + 1].at : null;
    const gap = next === null ? exit.exitStart - at : next - at;
    const enter = Math.max(.18, Math.min(variant === 'rise' ? .42 : .34, gap - .12));
    const node = `beat-${index}`;
    // A beat at or before the scene's first frame is the frame-0 hook: it is
    // already settled on frame 0, with no enter animation (as hook-title).
    const settled = beat.at <= 1 / base.fps + 1e-6;
    beat.time = T(at);
    beat.settleTime = T(settled ? at : at + enter);
    if (settled) {
      // No enter: the node's resting style is its first-frame state.
    } else if (variant === 'scale') {
      anim.add(node, at, enter, 'expo.out', {opacity: 0, scale: 1.5, blur: 16 * k}, {opacity: 1, scale: 1, blur: 0});
    } else {
      anim.add(node, at, .06, 'none', {opacity: 0}, {opacity: 1});
      beat.lines.forEach((_, line) => anim.add(`${node}-line-${line}`, at + line * .06, enter, 'power4.out', {y: beat.size * 1.25}, {y: 0}));
    }
    if (layout === 'replace' && next !== null) {
      const out = Math.min(.12, gap - enter);
      const props = variant === 'scale' ? [{opacity: 1, scale: 1, blur: 0}, {opacity: 0, scale: .9, blur: 6 * k}] : [{opacity: 1}, {opacity: 0}];
      anim.add(node, next - out, out, 'power2.in', props[0], props[1]);
    }
    if (layout === 'stack' && next !== null && !beat.emphasis) anim.add(`${node}-text`, next, .3, 'power2.out', {color: theme.paper}, {color: theme.muted});
    if (beat.emphasis && layout === 'replace' && !settled) anim.add(`${node}-bar`, at + .08, .36, 'expo.out', {scaleX: 0}, {scaleX: 1});
    events.push({id: `${base.id}-beat-${index}`, time: at, role: 'beat', cue: beat.emphasis ? 'impact' : 'pop'});
  });
  const styles = {root: rootStyle(box, layout === 'stack' ? {display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center'} : {})};
  for (const beat of beats) {
    const node = `beat-${beat.index}`, color = beat.emphasis ? beat.color : theme.paper;
    styles[node] = layout === 'replace'
      ? {position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', transformOrigin: '50% 50%'}
      : {position: 'relative', display: 'block', transformOrigin: '50% 50%'};
    styles[`${node}-text`] = {display: 'block', fontFamily: fonts.display, fontSize: px(beat.size), lineHeight: String(layout === 'stack' ? 1.0 : lineHeight), textTransform: 'uppercase', whiteSpace: 'nowrap', color,
      ...(beat.emphasis ? {textShadow: `0 0 ${px(42 * k)} ${alpha(beat.color, .45)}`} : {})};
    beat.lines.forEach((_, line) => {
      styles[`${node}-mask-${line}`] = {display: 'block', overflow: variant === 'rise' ? 'hidden' : 'visible', padding: `${em(.06)} ${em(.04)}`, margin: `${em(-.06)} 0`};
      styles[`${node}-line-${line}`] = {display: 'block', position: 'relative'};
    });
    if (beat.emphasis && layout === 'replace') styles[`${node}-bar`] = {width: px(150 * k), height: px(barHeight), marginTop: px(barGap), borderRadius: px(barHeight / 2), background: beat.color, transformOrigin: '50% 50%'};
  }
  return assemble({module: 'kinetic-words', ctx, base, st, rect: box, theme, contrast, fonts, hidesCaptions: true,
    motion: {enterEnd: beats[0].settleTime, enterFrom: variant === 'scale' ? {opacity: 0, scale: 1.5} : {opacity: 0, y: round(beats[0].size * 1.25)}, enterEase: variant === 'scale' ? 'expo.out' : 'power4.out', ...exit},
    content: {variant, layout, lineHeight, beats: beats.map(({index, text: value, lines, size, emphasis, color, time, settleTime}) => ({index, text: value, lines, size, emphasis, color, time, settleTime})), keyTextPx: sizes},
    styles, anim, events});
}

// ---------------------------------------------------------------------------
// count-up

export function formatNumber(value, {decimals = 0, separator = true} = {}) {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = separator ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
  const negative = value < 0 && Number(fixed) !== 0;
  return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

function resolveCountUp(params, ctx) {
  const base = baseContext(ctx), d = base.duration;
  fields(params, 'params', ['value', 'from', 'prefix', 'suffix', 'decimals', 'separator', 'label', 'note', 'countAt', 'countDuration', 'hit', 'color', 'rect'], ['value', 'label']);
  const value = number(params.value, 'params.value', -1e12, 1e12);
  const from = optional(params.from, 0, input => number(input, 'params.from', -1e12, 1e12));
  if (from === value) throw new Error('params.from must differ from params.value');
  const decimals = optional(params.decimals, 0, input => integer(input, 'params.decimals', 0, 3));
  const separator = optional(params.separator, true, input => bool(input, 'params.separator'));
  const prefix = optional(params.prefix, '', input => text(input, 'params.prefix', 4));
  const suffix = optional(params.suffix, '', input => text(input, 'params.suffix', 6));
  const label = text(params.label, 'params.label', 60);
  const note = optional(params.note, null, input => text(input, 'params.note', 48));
  const countAt = optional(params.countAt, .35, input => sceneTime(input, 'params.countAt', d, 1));
  const countDuration = optional(params.countDuration, 1.2, input => number(input, 'params.countDuration', .3, 6));
  const hit = optional(params.hit, 'underline', input => oneOf(input, 'params.hit', ['underline', 'spark', 'both', 'none']));
  const colorRole = optional(params.color, 'primary', input => input);
  const {theme, contrast} = moduleTheme(ctx.brand, colorRole, 'params.color');
  const fonts = brandFonts(ctx.brand), fk = fitKinds(ctx.brand);
  const st = stage(ctx, {captions: true});
  const k = st.k, rect = params.rect === undefined ? null : rectParam(params.rect, st, 'params.rect');
  const area = rect ?? st.zone;
  const s = base.start, fps = base.fps;
  const exitDur = .3;
  const stateFrames = Math.max(1, Math.round(countDuration * fps));
  const countStart = s + countAt, hitTime = countStart + stateFrames / fps;
  if (hitTime + .55 > base.end - exitDur + 1e-9) throw new Error(`params.countAt + params.countDuration must leave 0.85 s before the scene ends (the count ends at ${round(hitTime - s, 3)} s of ${round(d, 3)} s)`);

  const format = input => formatNumber(input, {decimals, separator});
  const finalDigits = format(value), initialDigits = format(from);
  const widest = [finalDigits, initialDigits].sort((a, b) => b.length - a.length)[0];
  const affix = .62;
  const widthAt = size => textWidth(widest, size, fk.display) + (prefix ? textWidth(prefix, size * affix, fk.display) + size * .04 : 0) + (suffix ? textWidth(suffix, size * affix, fk.display) + size * .04 : 0);
  const maxWidth = area.width * .9;
  let numberSize = Math.floor((st.portrait ? 420 : 320) * k);
  while (numberSize > 120 * k && widthAt(numberSize) > maxWidth) numberSize -= 2;
  if (widthAt(numberSize) > maxWidth) throw new Error('params.value with its prefix and suffix is too wide; use fewer digits or a shorter suffix');
  const labelSize = Math.round(62 * k), noteSize = Math.ceil(44 * k);
  const labelFit = fitLines(splitWords(label).map(word => word.text), {kind: fk.body, maxWidth: area.width * .86, maxLines: 2, maxSize: labelSize, minSize: labelSize, lineHeight: 1.2, maxHeight: labelSize * 2.5});
  if (!labelFit) throw new Error('params.label is too long for two lines; shorten it');
  if (note && textWidth(note.toUpperCase(), noteSize, fk.meta, .08) > area.width) throw new Error('params.note is too wide for one line; shorten it');
  const numberHeight = numberSize * 1.0, labelGap = 40 * k, noteGap = 22 * k;
  const blockHeight = numberHeight + 40 * k + labelGap + labelFit.lines.length * labelSize * 1.2 + (note ? noteGap + noteSize * 1.3 : 0);
  const box = placeBlock(st, blockHeight, rect, 'count-up');

  const frames = [];
  for (let frame = 0; frame <= stateFrames; frame++) {
    const time = countStart + frame / fps;
    const textValue = format(countUp(time, {from, to: value, start: countStart, frames: stateFrames, fps}));
    if (!frames.length ? textValue !== initialDigits : textValue !== frames[frames.length - 1].text) frames.push({time: T(time), text: textValue});
  }
  if (frames.length && frames[frames.length - 1].text !== finalDigits) frames.push({time: T(hitTime), text: finalDigits});

  const anim = animator();
  const exit = standardExit(anim, base, st, exitDur);
  anim.add('number', s, .5, 'power3.out', {opacity: 0, y: 40 * k}, {opacity: 1, y: 0});
  anim.add('number', hitTime, .12, 'power2.out', {scale: 1}, {scale: 1.07});
  anim.add('number', hitTime + .12, .42, 'power3.out', {scale: 1.07}, {scale: 1});
  anim.add('digits', hitTime, .24, 'power2.out', {color: theme.paper}, {color: theme.emphasis});
  anim.add('label', s + .15, .5, 'power3.out', {opacity: 0, y: 24 * k}, {opacity: 1, y: 0});
  if (note) anim.add('note', s + .3, .5, 'power3.out', {opacity: 0, y: 18 * k}, {opacity: 1, y: 0});
  anim.add('glow', s, .6, 'power2.out', {opacity: 0}, {opacity: .55});
  anim.add('glow', hitTime, .2, 'power2.out', {opacity: .55}, {opacity: 1});
  anim.add('glow', hitTime + .2, .8, 'power2.inOut', {opacity: 1}, {opacity: .7});
  const underline = hit === 'underline' || hit === 'both', spark = hit === 'spark' || hit === 'both';
  if (underline) anim.add('bar', hitTime + .02, .45, 'expo.out', {scaleX: 0}, {scaleX: 1});
  const estimated = widthAt(numberSize);
  const sparks = [];
  if (spark) {
    // A fan over the sides and top (165°–375°, 0° = right, 90° = down) so no
    // ray crosses the underline or the label below the number.
    const count = 11, a = estimated / 2 + 40 * k, b = numberSize * .5 + 40 * k;
    for (let i = 0; i < count; i++) {
      const angle = 165 + (i / (count - 1)) * 210, rad = angle * Math.PI / 180;
      const r = (a * b) / Math.sqrt((b * Math.cos(rad)) ** 2 + (a * Math.sin(rad)) ** 2);
      const node = `spark-${i}-ray`;
      anim.add(node, hitTime, .16, 'power2.out', {x: r, scaleX: 0}, {x: r + 28 * k, scaleX: 1});
      anim.add(node, hitTime + .16, .32, 'power2.in', {x: r + 28 * k, scaleX: 1}, {x: r + 84 * k, scaleX: 0});
      sparks.push({index: i, angle: round(angle, 3), radius: round(r)});
    }
  }
  const events = [
    {id: `${base.id}-count`, time: countStart, endTime: hitTime, role: 'count', cue: 'riser'},
    {id: `${base.id}-hit`, time: hitTime, role: 'hit', cue: 'impact'}
  ];
  const styles = {
    root: rootStyle(box, {display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center'}),
    glow: glowStyle(theme.emphasis, Math.min(estimated * 1.5 + 200 * k, st.canvas.width * 1.1), numberSize * 2.4, -(blockHeight - numberHeight) / 2),
    number: {position: 'relative', display: 'inline-flex', alignItems: 'baseline', justifyContent: 'center', whiteSpace: 'nowrap', fontFamily: fonts.display, fontSize: px(numberSize), lineHeight: '1', color: theme.paper, fontVariantNumeric: 'tabular-nums', transformOrigin: '50% 55%', paddingBottom: px(40 * k)},
    prefix: {fontSize: em(affix), color: theme.emphasis, marginRight: em(.04 / affix)},
    digits: {position: 'relative'},
    suffix: {fontSize: em(affix), color: theme.emphasis, marginLeft: em(.04 / affix)},
    bar: {position: 'absolute', left: '0', right: '0', bottom: px(8 * k), height: px(14 * k), borderRadius: px(7 * k), background: theme.emphasis, transformOrigin: '50% 50%'},
    sparks: {position: 'absolute', left: '50%', top: px(numberSize * .5), width: '0', height: '0'},
    label: {position: 'relative', marginTop: px(labelGap), fontFamily: fonts.body, fontSize: px(labelSize), lineHeight: '1.2', fontWeight: '600', color: theme.paper, maxWidth: px(area.width * .9)},
    note: {position: 'relative', marginTop: px(noteGap), fontFamily: fonts.meta, fontSize: px(noteSize), lineHeight: '1.3', letterSpacing: '0.08em', textTransform: 'uppercase', color: theme.muted, whiteSpace: 'nowrap'}
  };
  labelFit.lines.forEach((_, index) => { styles[`label-line-${index}`] = {display: 'block'}; });
  // Only nodes that are rendered keep a style.
  if (!prefix) delete styles.prefix;
  if (!suffix) delete styles.suffix;
  if (!note) delete styles.note;
  if (!underline) delete styles.bar;
  if (!spark) delete styles.sparks;
  for (const item of sparks) {
    styles[`spark-${item.index}`] = {position: 'absolute', left: '0', top: '0', width: '0', height: '0', transform: `rotate(${item.angle}deg)`};
    styles[`spark-${item.index}-ray`] = {position: 'absolute', left: '0', top: px(-5 * k), width: px(56 * k), height: px(10 * k), borderRadius: px(5 * k), background: theme.emphasis, transformOrigin: '0% 50%'};
  }
  return assemble({module: 'count-up', ctx, base, st, rect: box, theme, contrast, fonts, hidesCaptions: false,
    motion: {enterEnd: s + .5, enterFrom: {opacity: 0, y: round(40 * k)}, enterEase: 'power3.out', ...exit},
    content: {value, from, prefix, suffix, decimals, separator, label, labelLines: labelFit.lines.map(line => line.join(' ')), note, hit, underline, spark, sparks,
      countStart: T(countStart), countEnd: T(hitTime), stateFrames, numberSize, initialText: initialDigits, finalText: finalDigits, keyTextPx: [numberSize, labelSize, ...(note ? [noteSize] : [])]},
    styles, texts: [{node: 'digits', initial: initialDigits, frames}], anim, events});
}

// ---------------------------------------------------------------------------
// equation-lockup

const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'lim', 'sqrt', 'det']);
const BINARY = new Set(['=', '+', '−', '-', '×', '·', '÷', '∝', '≈', '<', '>', '≤', '≥', '≠', '→', '/']);
const GREEK = /[Ͱ-Ͽ]/;

function scriptAtoms(value) {
  // A sub/superscript: multi-letter words stay upright ("room"), single
  // letters are variables.
  if (/^[A-Za-z]{2,}$/.test(value)) return [{type: 'fn', text: value}];
  return tokenizeMath(value);
}

/** One term string → atoms [{type, text, sub?, sup?}] or a fraction {type:'frac', num, den}. */
export function tokenizeMath(value) {
  const fraction = /^([^/\s()]+|\([^/]*\))\/([^/\s()]+|\([^/]*\))$/.exec(value);
  if (fraction) return [{type: 'frac', num: tokenizeMath(fraction[1]), den: tokenizeMath(fraction[2])}];
  const atoms = [];
  const pattern = /([A-Za-zͰ-Ͽ]+|\d+(?:\.\d+)?|\s+|[()[\]{}]|.)(?:_(\{[^}]*\}|[A-Za-z0-9Ͱ-Ͽ]+))?(?:\^(\{[^}]*\}|[A-Za-z0-9Ͱ-Ͽ−+-]+))?/gu;
  let match;
  while ((match = pattern.exec(value))) {
    const [, body, sub, sup] = match;
    if (/^\s+$/.test(body)) continue;
    let atom;
    if (/^\d/.test(body)) atom = {type: 'num', text: body};
    else if (/^[A-Za-z]+$/.test(body) && FUNCTIONS.has(body)) atom = {type: 'fn', text: body};
    else if (/^[A-Za-zͰ-Ͽ]+$/.test(body)) atom = {type: 'var', text: body};
    else if (/^[()[\]{}]$/.test(body)) atom = {type: 'paren', text: body};
    else atom = {type: 'op', text: body === '-' ? '−' : body === '*' ? '·' : body};
    const strip = part => part.replace(/^\{|\}$/g, '');
    if (sub) atom.sub = scriptAtoms(strip(sub));
    if (sup) atom.sup = scriptAtoms(strip(sup));
    atoms.push(atom);
  }
  // Operators are unary at the start or right after an opening bracket.
  atoms.forEach((atom, index) => {
    if (atom.type !== 'op') return;
    const previous = atoms[index - 1];
    atom.unary = !previous || (previous.type === 'paren' && '([{'.includes(previous.text)) || previous.type === 'op';
    if (!BINARY.has(atom.text)) atom.unary = true;
  });
  return atoms;
}

function atomsWidth(atoms, kind = 'math') {
  let width = 0;
  for (const atom of atoms) {
    if (atom.type === 'frac') { width += Math.max(atomsWidth(atom.num), atomsWidth(atom.den)) * .84 + .2; continue; }
    width += textWidth(atom.text, 1, kind);
    if (atom.type === 'op') width += atom.unary ? .06 : .44;
    const scripts = Math.max(atom.sub ? atomsWidth(atom.sub) : 0, atom.sup ? atomsWidth(atom.sup) : 0);
    width += scripts * .58 + (scripts ? .04 : 0);
  }
  return width;
}

function splitEquation(value) {
  const terms = [];
  let depth = 0, current = '';
  for (const ch of value) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) { if (current) terms.push(current); current = ''; continue; }
    current += ch;
  }
  if (current) terms.push(current);
  return terms;
}

function resolveEquationLockup(params, ctx) {
  const base = baseContext(ctx), d = base.duration;
  fields(params, 'params', ['equation', 'terms', 'name', 'note', 'highlight', 'highlightAt', 'at', 'stagger', 'color', 'rect']);
  if ((params.equation === undefined) === (params.terms === undefined)) throw new Error('params needs exactly one of params.equation or params.terms');
  let terms;
  if (params.equation !== undefined) {
    terms = splitEquation(text(params.equation, 'params.equation', 64));
  } else {
    if (!Array.isArray(params.terms) || params.terms.length < 1) throw new Error('params.terms must list 1–9 term strings');
    terms = params.terms.map((term, index) => text(term, `params.terms[${index}]`, 28));
  }
  if (terms.length > 9) throw new Error(`${params.equation !== undefined ? 'params.equation' : 'params.terms'} must have 1–9 terms; group terms with parentheses`);
  const name = optional(params.name, null, value => text(value, 'params.name', 48));
  const note = optional(params.note, null, value => text(value, 'params.note', 70));
  const at = optional(params.at, .35, value => sceneTime(value, 'params.at', d, 1));
  const stagger = optional(params.stagger, grammarStagger(base.grammar, .22, {min: .06, max: .6}), value => number(value, 'params.stagger', .06, 1.5));
  let highlight = null;
  if (params.highlight !== undefined) {
    if (typeof params.highlight === 'number') highlight = integer(params.highlight, 'params.highlight', 0, terms.length - 1);
    else if (typeof params.highlight === 'string') {
      highlight = terms.indexOf(params.highlight.trim());
      if (highlight < 0) throw new Error(`params.highlight must be a term index or one of ${terms.map(term => JSON.stringify(term)).join(', ')}`);
    } else throw new Error('params.highlight must be a term index or a term string');
  }
  if (params.highlightAt !== undefined && highlight === null) throw new Error('params.highlightAt needs params.highlight');
  const colorRole = optional(params.color, 'primary', value => value);
  const {theme, contrast} = moduleTheme(ctx.brand, colorRole, 'params.color');
  const fonts = brandFonts(ctx.brand), fk = fitKinds(ctx.brand);
  const st = stage(ctx, {captions: false});
  const k = st.k, rect = params.rect === undefined ? null : rectParam(params.rect, st, 'params.rect');
  const area = rect ?? st.zone;
  const s = base.start, exitDur = .3;

  const termModels = terms.map((source, index) => {
    const atoms = tokenizeMath(source);
    const opOnly = atoms.length === 1 && atoms[0].type === 'op';
    if (opOnly) atoms[0].unary = false;
    return {index, source, atoms, opOnly, time: T(s + at + index * stagger)};
  });
  termModels.forEach((term, index) => {
    const previous = termModels[index - 1];
    term.gap = index === 0 || term.opOnly || previous.opOnly ? 0 : .18;
    if (term.opOnly) term.atoms[0].wide = true;
  });
  const emWidth = termModels.reduce((sum, term) => sum + atomsWidth(term.atoms) + term.gap + (term.opOnly ? .2 : 0), 0);
  const maxWidth = area.width * .9;
  const size = Math.floor(Math.min((st.portrait ? 150 : 140) * k, maxWidth / emWidth));
  if (size < 64 * k) throw new Error('the equation is too long to set at 64 px or more on one line; split it or shorten it');
  const lastLand = termModels[termModels.length - 1].time + .42;
  const highlightAt = highlight === null ? null : optional(params.highlightAt, Math.min(lastLand - s + .35, d - exitDur - .7), value => sceneTime(value, 'params.highlightAt', d, .6));
  if (lastLand > base.end - exitDur - .3 + 1e-9) throw new Error(`the terms land at ${round(lastLand - s, 3)} s, too late for a ${round(d, 3)} s scene; lower params.at or params.stagger`);
  if (highlightAt !== null && s + highlightAt < termModels[highlight].time + .42 - 1e-6) throw new Error('params.highlightAt must come after the highlighted term has landed');

  const nameSize = Math.round(46 * k), noteSize = Math.round(52 * k);
  if (name && textWidth(name.toUpperCase(), nameSize, fk.body, .14) > area.width) throw new Error('params.name is too wide for one line; shorten it');
  const noteFit = note ? fitLines(splitWords(note).map(word => word.text), {kind: fk.body, maxWidth: area.width * .86, maxLines: 2, maxSize: noteSize, minSize: noteSize, lineHeight: 1.25, maxHeight: noteSize * 2.6}) : null;
  if (note && !noteFit) throw new Error('params.note is too long for two lines; shorten it');
  const eqPad = 46 * k, eqHeight = size * 1.5 + eqPad * 2;
  const blockHeight = (name ? nameSize * 1.25 + 30 * k : 0) + 2 * k * 2 + eqHeight + (note ? 34 * k + noteFit.lines.length * noteSize * 1.25 : 0);
  const box = placeBlock(st, blockHeight, rect, 'equation-lockup');
  const ruleWidth = Math.min(box.width, emWidth * size + 120 * k);

  const anim = animator();
  const exit = standardExit(anim, base, st, exitDur);
  anim.add('rule-top', s, .7, 'power3.inOut', {scaleX: 0}, {scaleX: 1});
  anim.add('rule-bottom', s + .1, .7, 'power3.inOut', {scaleX: 0}, {scaleX: 1});
  if (name) anim.add('name', s + .1, .5, 'power3.out', {opacity: 0, y: 18 * k}, {opacity: 1, y: 0});
  const events = [];
  for (const term of termModels) {
    const node = `term-${term.index}`;
    anim.add(node, term.time, .3, 'power1.out', {opacity: 0}, {opacity: 1});
    anim.add(node, term.time, .5, 'power3.out', {y: size * .45}, {y: 0});
    anim.add(node, term.time, .42, 'power2.out', {blur: 12 * k}, {blur: 0});
    events.push({id: `${base.id}-term-${term.index}`, time: term.time, role: 'term', cue: 'tick'});
  }
  events.push({id: `${base.id}-lockup`, time: lastLand, role: 'lockup', cue: 'impact'});
  anim.add('glow', lastLand - .3, .8, 'power2.out', {opacity: 0}, {opacity: .8});
  if (note) anim.add('note', lastLand + .15, .5, 'power3.out', {opacity: 0, y: 20 * k}, {opacity: 1, y: 0});
  if (highlight !== null) {
    const time = s + highlightAt, node = `term-${highlight}`;
    anim.add(`${node}-box`, time, .25, 'power1.out', {opacity: 0}, {opacity: 1});
    anim.add(`${node}-box`, time, .45, 'back.out(1.6)', {scale: .86}, {scale: 1});
    anim.add(`${node}-text`, time, .3, 'power2.out', {color: theme.paper}, {color: theme.emphasis});
    events.push({id: `${base.id}-highlight`, time, role: 'highlight', cue: 'pop'});
  }
  const styles = {
    root: rootStyle(box, {display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center'}),
    glow: glowStyle(theme.emphasis, ruleWidth * 1.2, eqHeight * 2.2, ((name ? nameSize * 1.25 + 30 * k : 0) - (note ? 34 * k + noteFit.lines.length * noteSize * 1.25 : 0)) / 2),
    name: {position: 'relative', marginBottom: px(30 * k), fontFamily: fonts.body, fontSize: px(nameSize), lineHeight: '1.25', fontWeight: '600', letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.muted, whiteSpace: 'nowrap'},
    'rule-top': {position: 'relative', width: px(ruleWidth), height: px(3 * k), background: mixHex(theme.paper, theme.bg, .32), transformOrigin: '50% 50%'},
    eq: {position: 'relative', padding: `${px(eqPad)} 0`, fontFamily: fonts.math, fontSize: px(size), lineHeight: '1.5', color: theme.paper, whiteSpace: 'nowrap'},
    'rule-bottom': {position: 'relative', width: px(ruleWidth), height: px(3 * k), background: mixHex(theme.paper, theme.bg, .32), transformOrigin: '50% 50%'},
    note: {position: 'relative', marginTop: px(34 * k), fontFamily: fonts.body, fontSize: px(noteSize), lineHeight: '1.25', color: theme.muted, maxWidth: px(area.width * .9)}
  };
  if (noteFit) noteFit.lines.forEach((_, index) => { styles[`note-line-${index}`] = {display: 'block'}; });
  for (const term of termModels) {
    styles[`term-${term.index}`] = {position: 'relative', display: 'inline-block', marginLeft: em(term.gap), transformOrigin: '50% 50%'};
    styles[`term-${term.index}-text`] = {position: 'relative', display: 'inline-block', color: theme.paper};
    if (term.index === highlight) styles[`term-${term.index}-box`] = {position: 'absolute', left: em(-.1), right: em(-.1), top: em(.1), bottom: em(.04), borderRadius: em(.12), border: `${px(3 * k)} solid ${theme.emphasis}`, background: alpha(theme.emphasis, .14), transformOrigin: '50% 50%'};
  }
  const classes = {
    var: {fontStyle: 'italic'},
    fn: {fontStyle: 'normal'},
    num: {fontStyle: 'normal'},
    paren: {fontStyle: 'normal', fontWeight: '300'},
    op: {fontStyle: 'normal', margin: `0 ${em(.22)}`},
    'op-unary': {fontStyle: 'normal', margin: `0 ${em(.05)} 0 0`},
    'op-wide': {fontStyle: 'normal', margin: `0 ${em(.3)}`},
    sub: {fontSize: em(.58), verticalAlign: em(-.32), marginLeft: em(.03), lineHeight: '1'},
    sup: {fontSize: em(.58), verticalAlign: em(.62), marginLeft: em(.03), lineHeight: '1'},
    frac: {display: 'inline-flex', flexDirection: 'column', alignItems: 'center', verticalAlign: em(.62), fontSize: em(.84), lineHeight: '1.08', margin: `0 ${em(.08)}`},
    'frac-num': {display: 'block', padding: `0 ${em(.1)} ${em(.04)}`},
    'frac-bar': {display: 'block', alignSelf: 'stretch', height: em(.06), background: 'currentColor', borderRadius: em(.03)},
    'frac-den': {display: 'block', padding: `${em(.06)} ${em(.1)} 0`}
  };
  return assemble({module: 'equation-lockup', ctx, base, st, rect: box, theme, contrast, fonts, hidesCaptions: true,
    motion: {enterEnd: lastLand, enterFrom: {opacity: 0, y: round(size * .45)}, enterEase: 'power3.out', ...exit},
    content: {name, note, noteLines: noteFit ? noteFit.lines.map(line => line.join(' ')) : [], size, terms: termModels, highlight, highlightTime: highlightAt === null ? null : T(s + highlightAt), lockupTime: T(lastLand), ruleWidth: round(ruleWidth),
      keyTextPx: [size, ...(name ? [nameSize] : []), ...(note ? [noteSize] : [])]},
    styles, classes, anim, events});
}

// ---------------------------------------------------------------------------
// cta

// 24×24 stroke icons, drawn with stroke="currentColor".
export const CTA_ICONS = Object.freeze({
  arrow: '<path d="M4 12h15"/><path d="m13 5 7 7-7 7"/>',
  plus: '<path d="M12 4v16"/><path d="M4 12h16"/>',
  loop: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'
});

function resolveCta(params, ctx) {
  const base = baseContext(ctx), d = base.duration;
  fields(params, 'params', ['action', 'emphasis', 'detail', 'handle', 'icon', 'loop', 'color', 'rect'], ['action']);
  if (d < 2) throw new Error('cta needs a scene of at least 2 s');
  const action = text(params.action, 'params.action', 40);
  const detail = optional(params.detail, null, value => text(value, 'params.detail', 60));
  const handle = optional(params.handle, null, value => {
    const clean = text(value, 'params.handle', 32);
    if (/\s/.test(clean)) throw new Error('params.handle must be one handle or URL without spaces');
    return clean;
  });
  const loop = optional(params.loop, false, value => bool(value, 'params.loop'));
  const icon = optional(params.icon, loop ? 'loop' : 'arrow', value => oneOf(value, 'params.icon', [...Object.keys(CTA_ICONS), 'none']));
  if (icon !== 'none' && !handle && params.icon !== undefined) throw new Error('params.icon needs params.handle (the icon sits in the handle pill)');
  const colorRole = optional(params.color, 'primary', value => value);
  const {theme, contrast} = moduleTheme(ctx.brand, colorRole, 'params.color');
  if (handle) requireContrast(contrast, `ink on ${colorRole}`, theme.ink, theme.emphasis);
  const emphasisText = optional(params.emphasis, null, value => text(value, 'params.emphasis', 30));
  const tokens = phraseTokens(action, emphasisText ? [emphasisText] : [], 'params.emphasis');
  const fonts = brandFonts(ctx.brand), fk = fitKinds(ctx.brand);
  const st = stage(ctx, {captions: false});
  const k = st.k, rect = params.rect === undefined ? null : rectParam(params.rect, st, 'params.rect');
  const area = rect ?? st.zone;
  const detailSize = Math.round(52 * k), handleSize = Math.round(50 * k), iconSize = Math.round(50 * k);
  const pillPadY = 26 * k, pillPadX = 46 * k, pillGap = 64 * k, detailGap = 30 * k;
  const pillWidth = handle ? textWidth(handle, handleSize, fk.meta) + pillPadX * 2 + (icon !== 'none' ? iconSize + 20 * k : 0) : 0;
  if (pillWidth > area.width) throw new Error(`params.handle '${handle}' needs ${Math.ceil(pillWidth)} px; the pill fits ${Math.floor(area.width)} px at this size: shorten it${/^(https?:\/\/)?(www\.)?github\.com\//i.test(handle) ? ", or drop the 'github.com/' prefix" : /^https?:\/\//i.test(handle) ? ", or drop the 'https://' prefix" : ''}${icon !== 'none' ? ", or set icon: 'none'" : ''}`);
  const detailFit = detail ? fitLines(splitWords(detail).map(word => word.text), {kind: fk.body, maxWidth: area.width * .86, maxLines: 2, maxSize: detailSize, minSize: detailSize, lineHeight: 1.25, maxHeight: detailSize * 2.6}) : null;
  if (detail && !detailFit) throw new Error('params.detail is too long for two lines; shorten it');
  const chrome = (detail ? detailGap + detailFit.lines.length * detailSize * 1.25 : 0) + (handle ? pillGap + handleSize * 1.2 + pillPadY * 2 : 0);
  const lineHeight = .95;
  const fit = fitLines(tokens.map(token => token.text.toUpperCase()), {kind: fk.display, maxWidth: area.width * .92, maxLines: 4, maxSize: (st.portrait ? 168 : 140) * k, minSize: 72 * k, lineHeight, maxHeight: area.height - chrome});
  if (!fit) throw new Error('params.action is too long to set at 72 px or more in four lines; shorten it');
  let cursor = 0;
  const words = [];
  const lines = fit.lines.map((line, index) => ({index, words: line.map(() => { const token = tokens[cursor++]; const word = {index: words.length, text: token.text, emphasis: token.emphasis !== null}; words.push(word); return word; })}));
  const size = fit.size;
  const box = placeBlock(st, lines.length * size * lineHeight + chrome, rect, 'cta');

  const anim = animator();
  const s = base.start, end = base.end;
  const exitDur = loop ? .5 : .3;
  let exit;
  if (loop) {
    const exitStart = end - exitDur;
    anim.add('root', exitStart, exitDur, 'power1.inOut', {opacity: 1}, {opacity: 0});
    exit = {exitStart, exitTo: {opacity: 0}, exitEase: 'power1.inOut'};
  } else exit = standardExit(anim, base, st, exitDur);
  for (const word of words) anim.add(`word-${word.index}`, s + .05 + word.index * .06, .55, 'expo.out', {opacity: 0, y: size * .5, blur: 10 * k}, {opacity: 1, y: 0, blur: 0});
  const actionSettle = s + .05 + (words.length - 1) * .06 + .55;
  if (detail) anim.add('detail', s + .4, .5, 'power3.out', {opacity: 0, y: 20 * k}, {opacity: 1, y: 0});
  anim.add('glow', s, .8, 'power2.out', {opacity: 0}, {opacity: .8});
  const events = [{id: `${base.id}-action`, time: s, role: 'action', cue: 'whoosh'}];
  const pulses = [];
  let pillTime = null;
  if (handle) {
    pillTime = Math.min(s + .6, exit.exitStart - .6);
    anim.add('pill', pillTime, .2, 'power1.out', {opacity: 0}, {opacity: 1});
    anim.add('pill', pillTime, .5, 'back.out(1.7)', {scale: .5}, {scale: 1});
    events.push({id: `${base.id}-handle`, time: pillTime, role: 'handle', cue: 'pop'});
    // Pulse: grow and fade, reset scale while invisible, fade back in. Every
    // segment starts where the previous ended (seek-safe).
    const period = 1.2;
    for (let t = pillTime + .55, n = 0; t + 1.02 <= exit.exitStart; t += period, n++) {
      anim.add('ring', t, .08, 'power1.out', {opacity: 0}, {opacity: .85});
      anim.add('ring', t + .08, .82, 'power1.out', {opacity: .85}, {opacity: 0});
      anim.add('ring', t, .9, 'power2.out', {scale: 1}, {scale: 1.22});
      anim.add('ring', t + .9, .12, 'none', {scale: 1.22}, {scale: 1});
      if (icon === 'arrow') {
        anim.add('icon', t, .25, 'power2.out', {x: 0}, {x: 9 * k});
        anim.add('icon', t + .25, .4, 'power2.inOut', {x: 9 * k}, {x: 0});
      }
      pulses.push({index: n, time: T(t)});
    }
    if (icon === 'loop') {
      const spinStart = loop ? Math.max(pillTime + .55, exit.exitStart - .35) : pillTime + .5;
      anim.add('icon', spinStart, .8, 'power2.inOut', {rotation: 0}, {rotation: 360});
    }
  }
  if (loop) events.push({id: `${base.id}-loop`, time: exit.exitStart, role: 'loop', cue: 'whoosh'});
  const styles = {
    root: rootStyle(box, {display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center'}),
    glow: glowStyle(theme.emphasis, box.width * 1.3, Math.max(box.height * 1.2, 640 * k)),
    action: {position: 'relative', margin: '0', fontFamily: fonts.display, fontSize: px(size), lineHeight: String(lineHeight), textTransform: 'uppercase', color: theme.paper, fontWeight: '400'},
    detail: {position: 'relative', marginTop: px(detailGap), fontFamily: fonts.body, fontSize: px(detailSize), lineHeight: '1.25', color: theme.muted, fontWeight: '500'},
    pill: {position: 'relative', display: 'inline-flex', marginTop: px(pillGap), transformOrigin: '50% 50%'},
    ring: {position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', borderRadius: px(999), border: `${px(4 * k)} solid ${theme.emphasis}`, transformOrigin: '50% 50%'},
    'pill-body': {position: 'relative', display: 'inline-flex', alignItems: 'center', gap: px(20 * k), padding: `${px(pillPadY)} ${px(pillPadX)}`, borderRadius: px(999), background: theme.emphasis, color: theme.ink, fontFamily: fonts.meta, fontSize: px(handleSize), lineHeight: '1.2', fontWeight: '700', whiteSpace: 'nowrap', boxShadow: `0 ${px(20 * k)} ${px(60 * k)} ${alpha(theme.emphasis, .35)}`},
    icon: {display: 'block', width: px(iconSize), height: px(iconSize), flex: 'none', transformOrigin: '50% 50%'}
  };
  for (const line of lines) styles[`line-${line.index}`] = {display: 'block', whiteSpace: 'nowrap'};
  for (const word of words) styles[`word-${word.index}`] = {display: 'inline-block', position: 'relative', ...(word.emphasis ? {color: theme.emphasis} : {})};
  if (detailFit) detailFit.lines.forEach((_, index) => { styles[`detail-line-${index}`] = {display: 'block'}; });
  return assemble({module: 'cta', ctx, base, st, rect: box, theme, contrast, fonts, hidesCaptions: true,
    motion: {enterEnd: handle ? Math.max(actionSettle, pillTime + .5) : actionSettle, enterFrom: {opacity: 0, y: round(size * .5)}, enterEase: 'expo.out', ...exit},
    content: {action, emphasis: emphasisText, detail, detailLines: detailFit ? detailFit.lines.map(line => line.join(' ')) : [], handle, icon: handle ? icon : 'none', iconPaths: handle && icon !== 'none' ? CTA_ICONS[icon] : null, loop, size, lineHeight, lines,
      pillTime: pillTime === null ? null : T(pillTime), pulses, keyTextPx: [size, ...(detail ? [detailSize] : []), ...(handle ? [handleSize] : [])]},
    styles, anim, events});
}

// ---------------------------------------------------------------------------
// Registry

const COLOR = {type: 'string', enum: ['primary', 'accent'], default: 'primary', description: 'brand colour role for emphasis'};
const RECT = {type: 'object', optional: true, description: '{x,y,width,height} canvas px inside the safe zone; default: centred near the centre of mass'};

export const MODULES = {
  'hook-title': {
    describe: 'Opening claim or question, readable on frame 0, with 1–3 kinetic emphasis words and an optional kicker sticker. Hides captions.',
    params: {
      headline: {type: 'string', max: 90, required: true, description: 'the opening line (set in display caps, up to five balanced lines)'},
      emphasis: {type: 'string | [{text, at?, color?}]', max: 3, description: 'whole words of the headline that light up at `at` (scene seconds) with a bar and glow'},
      kicker: {type: 'string', max: 18, description: 'short sticker line that pops in, e.g. "Why?"'},
      kickerAt: {type: 'seconds', description: 'scene seconds for the kicker pop'},
      eyebrow: {type: 'string', max: 32, description: 'small mono label above the headline'},
      color: COLOR, align: {type: 'string', enum: ['center', 'left'], default: 'center'}, rect: RECT
    },
    events: ['title', 'emphasis-<n>', 'kicker'],
    resolve: resolveHookTitle
  },
  'kinetic-words': {
    describe: 'Lands 1–3 words per beat, timed to the voice; each beat replaces the last (or stacks into a sentence). Hides captions.',
    params: {
      words: {type: '[{text, at, emphasis?, color?}]', required: true, max: 12, description: 'beats: 1–3 words each, `at` in scene seconds (at least 0.3 s apart)'},
      variant: {type: 'string', enum: ['scale', 'rise'], default: 'scale', description: 'scale: punch in from large and blurred; rise: lines rise through a mask'},
      layout: {type: 'string', enum: ['replace', 'stack'], default: 'replace', description: 'stack keeps up to 5 beats on screen and dims earlier ones'},
      color: COLOR, rect: RECT
    },
    events: ['beat-<n>'],
    resolve: resolveKineticWords
  },
  'count-up': {
    describe: 'One big number that counts from `from` to `value` with prefix/suffix, then hits with an underline and/or spark burst. Keeps captions.',
    params: {
      value: {type: 'number', required: true}, from: {type: 'number', default: 0},
      prefix: {type: 'string', max: 4, description: 'e.g. "$"'}, suffix: {type: 'string', max: 6, description: 'e.g. "%", "k", "×"'},
      decimals: {type: 'integer', min: 0, max: 3, default: 0}, separator: {type: 'boolean', default: true, description: 'thousands commas'},
      label: {type: 'string', max: 60, required: true, description: 'what the number means (two lines at most)'},
      note: {type: 'string', max: 48, description: 'source or qualifier in small mono caps'},
      countAt: {type: 'seconds', default: .35}, countDuration: {type: 'seconds', min: .3, max: 6, default: 1.2},
      hit: {type: 'string', enum: ['underline', 'spark', 'both', 'none'], default: 'underline'},
      color: COLOR, rect: RECT
    },
    events: ['count', 'hit'],
    resolve: resolveCountUp
  },
  'equation-lockup': {
    describe: 'Names a law or formula: typeset terms land one by one, an optional term is boxed, with a name above and a caption line below. Hides captions.',
    params: {
      equation: {type: 'string', max: 64, description: 'e.g. "dT/dt = −k (T − T_room)"; spaces outside parentheses split terms; a/b is a fraction, x_sub and x^2 are scripts'},
      terms: {type: '[string]', max: 9, description: 'explicit terms instead of `equation`'},
      name: {type: 'string', max: 48, description: 'the law\'s name, set in small caps above'},
      note: {type: 'string', max: 70, description: 'one caption line below'},
      highlight: {type: 'integer | string', description: 'term index or exact term text to box in the emphasis colour'},
      highlightAt: {type: 'seconds'}, at: {type: 'seconds', default: .35, description: 'first term lands'}, stagger: {type: 'seconds', default: .22},
      color: COLOR, rect: RECT
    },
    events: ['term-<n>', 'lockup', 'highlight'],
    resolve: resolveEquationLockup
  },
  cta: {
    describe: 'End card: big action line, optional detail, and a handle/URL pill with a pulsing ring; `loop: true` fades to the background for a seamless loop. Hides captions.',
    params: {
      action: {type: 'string', max: 40, required: true, description: 'e.g. "Follow for part two"'},
      emphasis: {type: 'string', max: 30, description: 'whole words of the action to colour'},
      detail: {type: 'string', max: 60}, handle: {type: 'string', max: 32, description: '@handle or URL, no spaces'},
      icon: {type: 'string', enum: ['arrow', 'plus', 'loop', 'bell', 'none'], default: 'arrow (loop when loop is true)'},
      loop: {type: 'boolean', default: false}, color: COLOR, rect: RECT
    },
    events: ['action', 'handle', 'loop'],
    resolve: resolveCta
  }
};

for (const [name, entry] of Object.entries(MODULES)) {
  const inner = entry.resolve;
  entry.resolve = (params, ctx) => {
    try { return inner(params ?? {}, ctx); }
    catch (error) { throw new Error(`${name}: ${error.message}`); }
  };
  Object.freeze(entry);
}
Object.freeze(MODULES);
