// Catalogue H motion titles: `motion-title`, a caption-independent title
// whose variants are the 24 named text-animation effects of the HyperFrames
// vocabulary (hyperframes-animation, adapters/animate-text.md): 7 per
// character, 8 per word, 2 per line and 7 on the whole element. The effects
// are implemented here from their names and descriptions (no upstream
// specs are vendored), as seek-safe ops on per-character, per-word and
// per-line spans. Before this module only kinetic-words' "scale" and "rise"
// existed outside captions. Registered in kit/core/catalog-h.mjs.
//
// Lines are wrapped here (the conservative advance model), each line is one
// row of inline-block word spans (and character spans inside them), and the
// browser lays the row out, the same DOM in both renderers.

import {brandTextScale, timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, clip, createHBase, fitText, inkOn, mixColor, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, el, riseOps, set, tw} from './catalog-h-view.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

export const TEXT_EFFECTS = Object.freeze({
  character: ['soft-blur-in', 'per-character-rise', 'typewriter', 'bottom-up-letters', 'top-down-letters', 'stagger-from-center', 'stagger-from-edges'],
  word: ['per-word-crossfade', 'spring-scale-in', 'shared-axis-y', 'blur-out-up', 'kinetic-center-build', 'short-slide-right', 'short-slide-down', 'depth-parallax-words'],
  line: ['mask-reveal-up', 'line-by-line-slide'],
  element: ['micro-scale-fade', 'shimmer-sweep', 'fade-through', 'shared-axis-z', 'scale-down-fade', 'focus-blur-resolve', 'shared-axis-x']
});
// The default (first) is the most broadly useful; the rest follow the groups.
const TITLE_VARIANTS = Object.freeze(['per-character-rise', ...Object.values(TEXT_EFFECTS).flat().filter(name => name !== 'per-character-rise')]);
const UNIT_OF = Object.fromEntries(Object.entries(TEXT_EFFECTS).flatMap(([unit, names]) => names.map(name => [name, unit])));
// Effects whose letters or lines rise through a mask: their rows clip.
const MASKED = new Set(['bottom-up-letters', 'top-down-letters', 'mask-reveal-up']);

/** Greedy wrap with the conservative advance model → lines of words. */
function wrap(words, size, width) {
  const lines = [];
  const space = textWidth(' ', size, 'display');
  let line = [], used = 0;
  for (const word of words) {
    const w = textWidth(word, size, 'display');
    if (line.length && used + space + w > width) { lines.push(line); line = [word]; used = w; } else { line.push(word); used += (line.length > 1 ? space : 0) + w; }
  }
  if (line.length) lines.push(line);
  return lines;
}

function titleResolve(params, ctx) {
  const b = createHBase('motion-title', params, ctx, {allowed: ['text', 'kicker', 'sub', 'highlight', 'align', 'plate', 'tone', 'at', 'speed'], required: ['text'], variants: TITLE_VARIANTS, hidesCaptions: true});
  const {check, u, rect} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 90);
  const kicker = p.kicker === undefined ? null : check.str(p.kicker, 'params.kicker', 32).toUpperCase();
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 90);
  const align = p.align === undefined ? 'center' : check.oneOf(p.align, 'params.align', ['center', 'left']);
  const plate = p.plate === undefined ? false : check.bool(p.plate, 'params.plate');
  const speed = p.speed === undefined ? 1 : check.num(p.speed, 'params.speed', 0.5, 2);
  const accent = toneColor(b, p.tone, 'params.tone');
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 16) check.fail('params.text', 'has more than 16 words; a title is a few words');
  const highlight = new Set();
  if (p.highlight !== undefined) {
    const list = Array.isArray(p.highlight) ? p.highlight : [p.highlight];
    check.arr(list, 'params.highlight', 1, 3);
    for (const [i, w] of list.entries()) {
      const want = check.str(w, `params.highlight[${i}]`, 30).toLowerCase();
      const index = words.findIndex((word, k) => !highlight.has(k) && word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === want.replace(/[^\p{L}\p{N}]/gu, ''));
      if (index < 0) check.fail(`params.highlight[${i}]`, `must be a whole word of params.text ("${w}" is not)`);
      highlight.add(index);
    }
  }
  const W = rect.width, H = rect.height;
  const pad = plate ? r2(u(70)) : 0;
  const inner = W - pad * 2;
  const kickerSize = kicker ? r2(Math.max(b.min.meta, u(32))) : 0;
  const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'body', width: inner, preferred: u(46), min: b.min.key, maxLines: 2}) : null;
  const extraH = (kicker ? kickerSize * 1.4 + u(26) : 0) + (subFit ? subFit.size * 1.25 * subFit.lines + u(30) : 0) + pad * 2;
  // The largest size whose wrapped lines (at most 4) fit the width and height:
  // first at the brand face's real width (a wide face gets smaller type, so no
  // word breaks), then at the calibrated width.
  let size, lines;
  const scale = brandTextScale('display');
  for (const fitW of scale > 1 ? [inner / scale, inner] : [inner]) {
    for (size = u(b.portrait ? 170 : 150); size >= b.min.key; size -= 2) {
      lines = wrap(words, size, fitW);
      if (lines.length <= 4 && lines.every(line => textWidth(line.join(' '), size, 'display') <= fitW) && lines.length * size * 1.02 + extraH <= H) break;
    }
    if (size >= b.min.key) break;
  }
  if (size < b.min.key) check.fail('params.text', 'does not fit the rect at the 44 px floor; shorten it');
  size = r2(size);
  const lineH = r2(size * 1.02);
  const blockH = r2(lines.length * lineH + extraH);
  const top = r2((H - blockH) / 2);
  const t0 = b.timeOf('title', p.at, 'params.at', 0.5);
  const unit = UNIT_OF[b.variant];
  // Units in reading order: lines → words → characters, with global indices.
  let wordIndex = 0, charIndex = 0;
  const rows = lines.map((line, li) => ({index: li, words: line.map(word => {
    const entry = {text: word, index: wordIndex, highlight: highlight.has(wordIndex), chars: [...word].map(ch => ({ch, index: charIndex++}))};
    wordIndex++;
    return entry;
  })}));
  const counts = {character: charIndex, word: wordIndex, line: lines.length, element: 1};
  const step = {character: 0.032, word: 0.11, line: 0.14, element: 0}[unit] / speed;
  const each = {character: 0.5, word: 0.55, line: 0.7, element: 0.8}[unit] / speed;
  // Total build span; character effects compress their stagger to fit 1.4 s.
  const n = counts[unit];
  const stride = unit === 'character' ? Math.min(step, (1.4 / speed) / Math.max(1, n)) : step;
  const buildEnd = rt(t0 + stride * Math.max(0, n - 1) + each);
  b.events.push({id: `${b.id}-title`, name: 'title', time: t0, endTime: buildEnd, role: 'title', cue: unit === 'character' && b.variant === 'typewriter' ? 'keystroke-soft' : 'whoosh'});
  if (buildEnd > b.start + b.lastEvent + 1e-6) check.fail('params.text', `builds until ${r2(buildEnd - b.start)} s with ${b.variant}; lengthen the scene, shorten the text or raise speed`);
  const ink = b.colors.paper;
  const plateFill = plate ? b.colors.primary : null;
  const content = {variant: b.variant, unit, rows, counts, size, lineH, top, align, pad, plate: plateFill, ink: plate ? inkOn(b.colors, plateFill) : ink, accent: plate ? inkOn(b.colors, plateFill) : accent,
    kicker: kicker ? {text: kicker, size: kickerSize} : null, sub: subFit ? {text: sub, size: subFit.size, lines: subFit.lines} : null, t0, stride: rt(stride), each: rt(each), buildEnd, speed,
    muted: plate ? mixColor(inkOn(b.colors, plateFill), plateFill, 0.7) : b.theme.muted, shimmer: mixColor('#ffffff', accent, 0.5), blockH};
  return b.finish(content, {minTextPx: Math.min(size, subFit ? subFit.size : Infinity)});
}

const ids = (model) => ({
  line: i => `${model.id}-l${i}`,
  word: i => `${model.id}-w${i}`,
  char: i => `${model.id}-c${i}`
});

function titleView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const I = ids(model);
  const perChar = c.unit === 'character';
  const kids = [];
  const inner = [];
  if (c.kicker) {
    inner.push(el('div', `${id}-kicker`, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: c.kicker.size, lineHeight: '1.4', letterSpacing: '0.16em', color: c.plate ? c.ink : c.accent, opacity: 0, marginBottom: r2(26 * u)}, [c.kicker.text]));
  }
  const wordNode = word => {
    const style = {display: 'inline-block', whiteSpace: 'pre', color: word.highlight ? c.accent : c.ink, ...(c.unit === 'word' ? {opacity: 0} : {})};
    const children = perChar ? word.chars.map(ch => el('span', I.char(ch.index), {display: 'inline-block', whiteSpace: 'pre', opacity: 0}, [ch.ch])) : [word.text];
    return el('span', I.word(word.index), style, children);
  };
  const rowsNodes = c.rows.map(row => {
    const words = [];
    row.words.forEach((word, k) => { if (k) words.push(' '); words.push(wordNode(word)); });
    const masked = MASKED.has(c.variant);
    const lineNode = el('div', I.line(row.index), {display: 'block', whiteSpace: 'pre', ...(c.unit === 'line' ? {opacity: 0} : {})}, words);
    // Masked effects rise through their row: the row clips, the line moves.
    return el('div', null, {margin: 0, height: c.lineH, lineHeight: `${c.lineH}px`, overflow: masked ? 'hidden' : 'visible', textAlign: c.align}, [lineNode]);
  });
  const block = el('div', `${id}-block`, {fontFamily: fonts.display, fontSize: c.size, color: c.ink, position: 'relative', ...(c.unit === 'element' ? {opacity: 0} : {})}, rowsNodes);
  inner.push(block);
  if (c.variant === 'shimmer-sweep') {
    // A copy of the block in the shimmer colour, seen through a moving band.
    inner.push(el('div', `${id}-shimmer`, {...abs(0, c.kicker ? r2(c.kicker.size * 1.4 + 26 * u) : 0, r2(W - c.pad * 2), r2(c.rows.length * c.lineH)), fontFamily: fonts.display, fontSize: c.size, color: c.shimmer, clipPath: 'inset(0% 100% 0% -15%)'},
      c.rows.map(row => el('div', null, {margin: 0, height: c.lineH, lineHeight: `${c.lineH}px`, whiteSpace: 'pre', textAlign: c.align}, [row.words.map(w => w.text).join(' ')]))));
  }
  if (c.sub) inner.push(el('div', `${id}-sub`, {margin: 0, marginTop: r2(30 * u), whiteSpace: c.sub.lines > 1 ? 'normal' : 'nowrap', fontFamily: fonts.body, fontWeight: 600, fontSize: c.sub.size, lineHeight: '1.25', color: c.muted, textAlign: c.align, opacity: 0}, [c.sub.text]));
  const content = el('div', null, {...abs(c.pad, c.pad, r2(W - c.pad * 2), undefined), textAlign: c.align}, inner);
  kids.push(el('div', `${id}-frame`, {...abs(0, c.top, W, c.blockH), boxSizing: 'border-box', ...(c.plate ? {background: c.plate, borderRadius: r2(36 * u)} : {})}, [content]));
  return kids;
}

/** Stagger order 0..n−1 for an effect over `n` units. */
function orderOf(variant, n) {
  if (variant === 'stagger-from-center') { const mid = (n - 1) / 2; return i => Math.abs(i - mid); }
  if (variant === 'stagger-from-edges') { const mid = (n - 1) / 2; return i => mid - Math.abs(i - mid); }
  return i => i;
}

function titleTimeline(model, ops) {
  const {start, unit: u} = model;
  const c = model.content;
  const I = ids(model);
  const em = c.size;
  const t0 = c.t0, each = c.each;
  const id = model.id;
  if (c.kicker) riseOps(ops, `${id}-kicker`, start, rt(Math.max(start, t0 - 0.2)), r2(12 * u), {duration: 0.4});
  if (c.sub) riseOps(ops, `${id}-sub`, start, rt(c.buildEnd - each * 0.4), r2(14 * u), {duration: 0.5});
  const n = c.counts[c.unit];
  const order = orderOf(c.variant, n);
  const at = i => rt(t0 + c.stride * order(i));
  const target = i => (c.unit === 'character' ? I.char(i) : c.unit === 'word' ? I.word(i) : c.unit === 'line' ? I.line(i) : `${id}-block`);
  const from = (i, props) => set(ops, target(i), start, props);
  const go = (i, dur, ease, a, b2, delay = 0) => tw(ops, target(i), rt(at(i) + delay), dur, ease, a, b2);
  for (let i = 0; i < n; i++) {
    switch (c.variant) {
      case 'soft-blur-in':
        from(i, {opacity: 0, blur: r2(10 * u)}); go(i, each, 'power2.out', {opacity: 0, blur: r2(10 * u)}, {opacity: 1, blur: 0}); break;
      case 'per-character-rise':
        from(i, {opacity: 0, x: 0, y: r2(em * 0.5)}); go(i, each, 'power3.out', {opacity: 0, y: r2(em * 0.5)}, {opacity: 1, y: 0}); break;
      case 'typewriter':
        // Stepped: each letter appears whole on its beat, no interpolation.
        from(i, {opacity: 0}); set(ops, target(i), at(i), {opacity: 1}); break;
      case 'bottom-up-letters':
        from(i, {opacity: 1, x: 0, y: r2(em * 1.05)}); go(i, each, 'power3.out', {y: r2(em * 1.05)}, {y: 0}); break;
      case 'top-down-letters':
        from(i, {opacity: 1, x: 0, y: r2(-em * 1.05)}); go(i, each, 'power3.out', {y: r2(-em * 1.05)}, {y: 0}); break;
      case 'stagger-from-center':
      case 'stagger-from-edges':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 0.2, scaleY: 0.2}); go(i, 0.2, 'power1.out', {opacity: 0}, {opacity: 1}); go(i, each, 'back.out(2)', {scaleX: 0.2, scaleY: 0.2}, {scaleX: 1, scaleY: 1}); break;
      case 'per-word-crossfade':
        from(i, {opacity: 0}); go(i, each, 'power1.inOut', {opacity: 0}, {opacity: 1}); break;
      case 'spring-scale-in':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 0.3, scaleY: 0.3}); go(i, 0.15, 'power1.out', {opacity: 0}, {opacity: 1}); go(i, each * 1.4, 'elastic.out(1, 0.55)', {scaleX: 0.3, scaleY: 0.3}, {scaleX: 1, scaleY: 1}); break;
      case 'shared-axis-y':
        from(i, {opacity: 0, x: 0, y: r2(em * 0.35)}); go(i, each, 'power2.out', {opacity: 0, y: r2(em * 0.35)}, {opacity: 1, y: 0}); break;
      case 'blur-out-up': {
        // Fades in softly, holds, then blurs out upward before the exit.
        from(i, {opacity: 0, x: 0, y: 0, blur: 0}); go(i, each, 'power1.out', {opacity: 0}, {opacity: 1});
        const out = rt(model.motion.exitStart - 0.5 + c.stride * i * 0.5);
        tw(ops, target(i), out, 0.45, 'power2.in', {opacity: 1, y: 0, blur: 0}, {opacity: 0, y: r2(-em * 0.4), blur: r2(12 * u)});
        break;
      }
      case 'kinetic-center-build':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 1.5, scaleY: 1.5}); go(i, 0.12, 'power1.out', {opacity: 0}, {opacity: 1}); go(i, each, 'power4.out', {scaleX: 1.5, scaleY: 1.5}, {scaleX: 1, scaleY: 1}); break;
      case 'short-slide-right':
        from(i, {opacity: 0, x: r2(-em * 0.45), y: 0}); go(i, each, 'power3.out', {opacity: 0, x: r2(-em * 0.45)}, {opacity: 1, x: 0}); break;
      case 'short-slide-down':
        from(i, {opacity: 0, x: 0, y: r2(-em * 0.45)}); go(i, each, 'power3.out', {opacity: 0, y: r2(-em * 0.45)}, {opacity: 1, y: 0}); break;
      case 'depth-parallax-words': {
        // Alternate words come from in front of and behind the page.
        const s = i % 2 ? 0.55 : 1.7;
        from(i, {opacity: 0, x: 0, y: 0, scaleX: s, scaleY: s, blur: r2(8 * u)}); go(i, each * 1.2, 'power3.out', {opacity: 0, scaleX: s, scaleY: s, blur: r2(8 * u)}, {opacity: 1, scaleX: 1, scaleY: 1, blur: 0}); break;
      }
      case 'mask-reveal-up':
        from(i, {opacity: 1, x: 0, y: c.lineH}); go(i, each, 'power4.out', {y: c.lineH}, {y: 0}); break;
      case 'line-by-line-slide':
        from(i, {opacity: 0, x: r2(-em * 0.8), y: 0}); go(i, each, 'power3.out', {opacity: 0, x: r2(-em * 0.8)}, {opacity: 1, x: 0}); break;
      case 'micro-scale-fade':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 0.96, scaleY: 0.96}); go(i, each * 0.7, 'power2.out', {opacity: 0, scaleX: 0.96, scaleY: 0.96}, {opacity: 1, scaleX: 1, scaleY: 1}); break;
      case 'shimmer-sweep':
        from(i, {opacity: 0}); go(i, 0.35, 'power1.out', {opacity: 0}, {opacity: 1});
        set(ops, `${id}-shimmer`, start, clip(0, 100, 0, -15));
        tw(ops, `${id}-shimmer`, rt(t0 + 0.3), 1.0 / c.speed, 'power1.inOut', clip(0, 100, 0, -15), clip(0, -15, 0, 100));
        break;
      case 'fade-through':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 0.92, scaleY: 0.92}); go(i, each * 0.45, 'power1.in', {opacity: 0}, {opacity: 1}, each * 0.15); go(i, each, 'power2.out', {scaleX: 0.92, scaleY: 0.92}, {scaleX: 1, scaleY: 1}); break;
      case 'shared-axis-z':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 0.8, scaleY: 0.8}); go(i, each, 'power2.out', {opacity: 0, scaleX: 0.8, scaleY: 0.8}, {opacity: 1, scaleX: 1, scaleY: 1}); break;
      case 'scale-down-fade':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 1.35, scaleY: 1.35}); go(i, each, 'power3.out', {opacity: 0, scaleX: 1.35, scaleY: 1.35}, {opacity: 1, scaleX: 1, scaleY: 1}); break;
      case 'focus-blur-resolve':
        from(i, {opacity: 0, x: 0, y: 0, scaleX: 1.05, scaleY: 1.05, blur: r2(22 * u)}); go(i, each * 1.2, 'power2.out', {opacity: 0, scaleX: 1.05, scaleY: 1.05, blur: r2(22 * u)}, {opacity: 1, scaleX: 1, scaleY: 1, blur: 0}); break;
      case 'shared-axis-x':
        from(i, {opacity: 0, x: r2(em * 0.6), y: 0}); go(i, each, 'power2.out', {opacity: 0, x: r2(em * 0.6)}, {opacity: 1, x: 0}); break;
      default: throw new Error(`motion-title: no timeline for ${c.variant}`);
    }
  }
  // Character effects keep each word's span still; masked letters show at once.
  if (c.variant === 'bottom-up-letters' || c.variant === 'top-down-letters') for (let i = 0; i < n; i++) set(ops, target(i), start, {opacity: 1});
}

export const motionTitle = {
  id: 'motion-title',
  describe: 'A title that animates in with one of the 24 named text effects (its variants: per character, per word, per line or the whole element), with an optional kicker, sub-line, highlighted words and brand plate. Hides captions.',
  params: {text: 'string ≤ 90 (≤ 16 words), required', kicker: 'string ≤ 32 above (optional)', sub: 'string ≤ 90 below (optional)', highlight: 'whole word or [words] 1–3 to colour with tone', align: '"center" | "left"',
    plate: 'boolean: set the title on a brand-colour plate', tone: 'primary | accent | paper | #rrggbb (highlight colour)', speed: 'stagger speed 0.5–2 (default 1)', at: `build start: ${at}`,
    variant: `${VARIANT_PARAM}; one of the effects: ${Object.values(TEXT_EFFECTS).flat().join(', ')}`, rect},
  events: ['title'], timing: timingRules({rules: ['the build ends before the exit; long text with a character effect compresses its stagger to 1.4 s']}), variants: TITLE_VARIANTS,
  resolve: titleResolve, view: titleView, timeline: titleTimeline
};

export const TEXT = [motionTitle];
