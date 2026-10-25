// Catalogue G proof cards: stat-card, quote-card and excerpt
// (docs/VIDEO_QUALITY_RFC.md §8). These show real material only, so each
// refuses what would make it up: a figure needs its source, a quote a named
// attribution, and an excerpt shows the supplied lines verbatim with their
// source. Same shape and layout approach as catalog-g-cards.mjs.

import {fitText, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, sampleTime, set, tw} from './catalog-b-view.mjs';
import {CARD_PARAMS, after, cardTiming, column, createCardBase, flow, flowText, iconParam, pick, pop, rise, row, solidFill, tintBehind, wrapWords} from './catalog-g-base.mjs';
import {iconNode} from './icons.mjs';

const hidden = {opacity: 0};

// Values that stand in for a source rather than name one.
const PLACEHOLDER_SOURCE = /^(sources?|tbd|tba|todo|n\/?a|none|unknown|example|sample|placeholder|dummy|fake|made[ -]?up|hypothetical|illustrative|lorem\b.*|citation needed|\?+|-+|\.+)$/i;
// Attributions that do not name who said it.
const GENERIC_AUTHOR = /^(anonymous|anon|unknown|someone|somebody|people|everyone|users?|customers?|clients?|a (happy |real |satisfied )?(customer|user|client|founder|developer|fan|friend)|happy customer|satisfied customer|our (customers?|users?)|the internet)$/i;

function sourceParam(check, value, path, what) {
  const source = check.str(value, path, 60);
  if (PLACEHOLDER_SOURCE.test(source)) check.fail(path, `must name where ${what} comes from (a report, a dashboard, a URL or a person), not ${JSON.stringify(source)}`);
  return source;
}

// ---------------------------------------------------------------------------
// stat-card: a real figure that counts up, with its label and source.

/** "$1,240.5k" → {prefix: "$", number: 1240.5, decimals: 1, grouped: true, suffix: "k"} or null. */
export function parseFigure(value) {
  const match = /^([^\d]*?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(.*)$/.exec(value);
  if (!match) return null;
  const [, prefix, whole, fraction = '', suffix] = match;
  return {prefix, number: Number(`${whole.replace(/,/g, '')}${fraction}`), decimals: fraction ? fraction.length - 1 : 0, grouped: whole.includes(','), suffix};
}
const formatFigure = (figure, n) => {
  let text = n.toFixed(figure.decimals);
  if (figure.grouped) {
    const [w, f] = text.split('.');
    text = `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`;
  }
  return `${figure.prefix}${text}${figure.suffix}`;
};

// Variants: giant (the figure big over its label, the original), ring (the
// figure inside a ring that sweeps to the share it states, or all the way),
// bar (the figure over a bar that fills with the count) and ticker (each digit
// on its own tile, rolling with the count).
export const STAT_VARIANTS = Object.freeze(['giant', 'ring', 'bar', 'ticker']);

/** The share a figure states, 0–1: a percentage up to 100, else null. */
export function figureShare(figure) {
  return figure && figure.suffix.trim().startsWith('%') && !figure.prefix.trim() && figure.number <= 100 ? figure.number / 100 : null;
}

/** "1,240" at n → the digits of n (same decimals), zero-padded into the value's digit slots. */
function tickerText(value, figure, n) {
  const slots = value.replace(/[^\d]/g, '').length;
  const digits = n.toFixed(figure.decimals).replace(/[^\d]/g, '').padStart(slots, '0').slice(-slots);
  let i = 0;
  return [...value].map(char => (/\d/.test(char) ? digits[i++] : char)).join('');
}

function resolveStat(params, ctx) {
  const b = createCardBase('stat-card', params, ctx, {allowed: ['value', 'label', 'source', 'icon', 'count', 'tone', 'at'], required: ['value', 'label', 'source'], variants: STAT_VARIANTS});
  const {check, u, portrait, theme, fps} = b;
  const p = b.params;
  const value = check.str(p.value, 'params.value', 12);
  if (!/\d/.test(value)) check.fail('params.value', 'must be a figure with at least one digit ("87%", "3.2×", "$1.4M")');
  const label = check.str(p.label, 'params.label', 48);
  const source = sourceParam(check, p.source, 'params.source', 'the figure');
  const glyph = iconParam(check, p.icon, 'params.icon');
  const figure = parseFigure(value);
  const count = p.count === undefined ? Boolean(figure) : check.bool(p.count, 'params.count');
  if (count && !figure) check.fail('params.count', `needs a value that starts with a number ("${value}" does not); set count: false`);
  const tone = p.tone === undefined ? 'primary' : check.oneOf(p.tone, 'params.tone', ['primary', 'accent', 'paper']);
  const valueColor = b.resolveColor(tone, 'params.tone', 'primary');
  const sourceText = `Source: ${source}`;
  const fitLabel = (width, k, preferred = 50, maxLines = 2) => fitText(check, 'params.label', label, {family: 'body', width, preferred: Math.max(b.min.key, u(preferred * Math.max(1, k * 0.9))), min: b.min.key, maxLines});
  const fitSource = (width, k) => fitText(check, 'params.source', sourceText, {family: 'meta', width, preferred: u(28 * Math.max(1, k * 0.85)), min: b.min.meta, maxLines: 2});
  const variant = (width, k) => {
    const mode = 'stack';
    const iconSize = glyph ? u(110 * k) : 0, iconGap = glyph ? u(20 * k) : 0;
    const big = fitText(check, 'params.value', value, {family: 'display', width, preferred: u((portrait ? 250 : 230) * k), min: u(96), maxLines: 1});
    const lab = fitText(check, 'params.label', label, {family: 'body', width, preferred: u(50 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2});
    const src = fitSource(width, k);
    const labelGap = u(14 * k), sourceGap = u(22 * k);
    return {mode, iconSize, iconGap, value: big, label: lab, source: src, labelGap, sourceGap,
      height: r2(iconSize + iconGap + big.size * 1.0 + labelGap + lab.lines * lab.size * 1.2 + sourceGap + src.lines * src.size * 1.3)};
  };
  // A short room: the figure on the left, the label and source beside it.
  const inline = (width, k) => {
    const gap = u(32), valueW = r2(width * 0.42), textW = r2(width - valueW - gap);
    const big = fitText(check, 'params.value', value, {family: 'display', width: valueW, preferred: u(170 * k), min: u(88), maxLines: 1});
    const lab = fitText(check, 'params.label', label, {family: 'body', width: textW, preferred: u(46), min: b.min.key, maxLines: 3});
    const src = fitText(check, 'params.source', sourceText, {family: 'meta', width: textW, preferred: u(26), min: b.min.meta, maxLines: 2});
    const sourceGap = u(12);
    const textH = r2(lab.lines * lab.size * 1.2 + sourceGap + src.lines * src.size * 1.3);
    return {mode: 'inline', iconSize: 0, iconGap: 0, value: big, label: lab, source: src, labelGap: 0, sourceGap, gap, valueW, textW, height: r2(Math.max(big.size, textH))};
  };
  // ring: the figure inside a ring; the label and source under it (9:16) or
  // beside it (16:9).
  const ring = (width, k) => {
    const beside = !portrait;
    const d = r2(Math.min(u((portrait ? 520 : 560) * k), beside ? width * 0.45 : width)), stroke = r2(d * 0.07);
    const big = fitText(check, 'params.value', value, {family: 'display', width: r2(d * 0.62), preferred: r2(d * 0.3), min: u(80), maxLines: 1});
    const textW = beside ? r2(width - d - u(64 * k)) : width;
    if (textW < u(320)) return null;
    const lab = fitLabel(textW, k, beside ? 58 : 50, beside ? 3 : 2), src = fitSource(textW, k), labelGap = u(30 * k), sourceGap = u(18 * k);
    const textH = r2(lab.lines * lab.size * 1.2 + sourceGap + src.lines * src.size * 1.3);
    return {mode: 'ring', beside, d, stroke, value: big, label: lab, source: src, labelGap, sourceGap, textW, gap: u(64 * k), textH, height: r2(beside ? Math.max(d, textH) : d + labelGap + textH)};
  };
  // bar: the figure, a bar under it, then the label and source.
  const bar = (width, k) => {
    const big = fitText(check, 'params.value', value, {family: 'display', width, preferred: u((portrait ? 230 : 220) * k), min: u(96), maxLines: 1});
    const lab = fitLabel(width, k), src = fitSource(width, k);
    const barH = u(34 * k), barGap = u(24 * k), labelGap = u(26 * k), sourceGap = u(16 * k);
    return {mode: 'bar', value: big, label: lab, source: src, barH, barGap, labelGap, sourceGap,
      height: r2(big.size * 1.0 + barGap + barH + labelGap + lab.lines * lab.size * 1.2 + sourceGap + src.lines * src.size * 1.3)};
  };
  // ticker: a tile per digit (other characters stand between them).
  const ticker = (width, k) => {
    const chars = [...value], digits = chars.filter(char => /\d/.test(char)).length;
    // A tile is 0.78 em wide with 0.1 em between; another character, set at
    // 0.8 em, takes its own width (symbols like % or $ up to a full em).
    const otherEm = chars.filter(char => !/\d/.test(char)).reduce((sum, char) => sum + 0.8 * (/[%$€£¥×#&@+]/.test(char) ? 1.1 : textWidth(char, 1, 'display')) + 0.1, 0);
    const size = r2(Math.min(u((portrait ? 210 : 220) * k), width / (digits * 0.88 + otherEm)));
    if (size < u(96)) return null;
    const lab = fitLabel(width, k), src = fitSource(width, k), labelGap = u(30 * k), sourceGap = u(16 * k);
    const tileH = r2(size * 1.18);
    return {mode: 'ticker', size, tileW: r2(size * 0.78), tileH, gapW: r2(size * 0.1), value: {size, lines: 1}, label: lab, source: src, labelGap, sourceGap,
      height: r2(tileH + labelGap + lab.lines * lab.size * 1.2 + sourceGap + src.lines * src.size * 1.3)};
  };
  const shaped = {ring, bar, ticker}[b.variant];
  const measure = (width, maxHeight) => pick([...(shaped ? b.scales.map(k => () => shaped(width, k)) : []), ...[...b.scales, 0.55].map(k => () => variant(width, k)), ...[1, 0.8].map(k => () => inline(width, k))], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : b.variant === 'ring' ? 1400 : 1100)});
  const L = box.layout;
  const t0 = b.timeOf('count', p.at, 'params.at', 0.1);
  const countFor = count ? 0.9 : 0;
  const hitAt = after(b, t0, countFor);
  const samples = [];
  const format = L.mode === 'ticker' ? (n => tickerText(value, figure, n)) : (n => formatFigure(figure, n));
  if (count) {
    for (let f = Math.ceil(t0 * fps - 1e-6); f / fps < hitAt - 1e-6; f++) {
      const q = Math.min(1, Math.max(0, (f / fps - t0) / countFor));
      samples.push({t: rt(f / fps), text: format(figure.number * (1 - (1 - q) ** 3))});
    }
    samples.push({t: hitAt, text: value});
  }
  const labelAt = after(b, t0, 0.2), sourceAt = after(b, hitAt, 0.1);
  b.events.push({id: `${b.id}-count`, name: 'count', time: t0, endTime: hitAt, role: 'count', ...(count ? {cue: 'riser'} : {})});
  b.events.push({id: `${b.id}-hit`, name: 'hit', time: hitAt, endTime: rt(hitAt + 0.3), role: 'hit', cue: 'impact'});
  const content = {box: {x: box.x, y: box.y, width: box.width}, layout: L, value, label, source, sourceText, icon: L.mode === 'stack' ? glyph : null, count, start: count ? format(0) : value, samples,
    valueColor, labelColor: theme.foreground, sourceColor: theme.muted, iconColor: b.colors.primary, t0, hitAt, labelAt, sourceAt};
  // The share the ring or bar fills: the percentage it states, else all of it.
  if (L.mode === 'ring' || L.mode === 'bar') Object.assign(content, {share: figureShare(figure) ?? 1, track: theme.border, fill: valueColor});
  if (L.mode === 'ticker') Object.assign(content, {tileFill: theme.panel, tileEdge: theme.border, tileInk: valueColor, chars: [...value].map(char => /\d/.test(char))});
  return b.finish(content, {minTextPx: Math.min(L.value.size, L.label.size)});
}

function statView(model) {
  const {id, fonts} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (STAT_VIEWS[L.mode]) return STAT_VIEWS[L.mode](model);
  if (L.mode === 'inline') {
    return [el('div', null, abs(B.x, B.y, B.width, L.height, {display: 'flex', alignItems: 'center', gap: L.gap}), [
      flowText(`${id}-value`, L.valueW, {...hidden, fontFamily: fonts.display, fontSize: L.value.size, lineHeight: '1', color: c.valueColor, textAlign: 'right', whiteSpace: 'nowrap', transformOrigin: '100% 60%'}, c.start),
      flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column'}, [
        flowText(`${id}-label`, L.textW, {...hidden, fontFamily: fonts.body, fontWeight: 600, fontSize: L.label.size, lineHeight: '1.2', color: c.labelColor}, c.label),
        flowText(`${id}-source`, L.textW, {...hidden, marginTop: L.sourceGap, fontFamily: fonts.meta, fontSize: L.source.size, lineHeight: '1.3', color: c.sourceColor}, c.sourceText)
      ])
    ])];
  }
  return [column(B.x, B.y, B.width, L.height, [
    c.icon ? flow(`${id}-icon`, L.iconSize, L.iconSize, {...hidden, marginBottom: L.iconGap, transformOrigin: '50% 50%'}, [iconNode(c.icon, {size: L.iconSize, color: c.iconColor})]) : null,
    flowText(`${id}-value`, B.width, {...hidden, fontFamily: fonts.display, fontSize: L.value.size, lineHeight: '1', color: c.valueColor, textAlign: 'center', whiteSpace: 'nowrap', transformOrigin: '50% 60%'}, c.start),
    flowText(`${id}-label`, B.width, {...hidden, marginTop: L.labelGap, fontFamily: fonts.body, fontWeight: 600, fontSize: L.label.size, lineHeight: '1.2', color: c.labelColor, textAlign: 'center'}, c.label),
    flowText(`${id}-source`, B.width, {...hidden, marginTop: L.sourceGap, fontFamily: fonts.meta, fontSize: L.source.size, lineHeight: '1.3', color: c.sourceColor, textAlign: 'center'}, c.sourceText)
  ].filter(Boolean))];
}

const statText = (model, width, align, top = 0) => {
  const {id, fonts} = model;
  const c = model.content, L = c.layout;
  return [
    flowText(`${id}-label`, width, {...hidden, marginTop: top, fontFamily: fonts.body, fontWeight: 600, fontSize: L.label.size, lineHeight: '1.2', color: c.labelColor, textAlign: align}, c.label),
    flowText(`${id}-source`, width, {...hidden, marginTop: L.sourceGap, fontFamily: fonts.meta, fontSize: L.source.size, lineHeight: '1.3', color: c.sourceColor, textAlign: align}, c.sourceText)
  ];
};

const STAT_VIEWS = {
  ring(model) {
    const {id, fonts} = model;
    const c = model.content, L = c.layout, B = c.box;
    const r = r2((L.d - L.stroke) / 2), half = r2(L.d / 2);
    // pathLength 1 makes the dash offset the unswept share of the ring.
    const circle = (key, color, extra) => el('circle', key, extra?.style ?? null, [], {cx: half, cy: half, r, stroke: color, strokeWidth: L.stroke, fill: 'none', ...extra?.attrs});
    const dial = flow(null, L.d, L.d, {}, [
      el('svg', null, abs(0, 0, L.d, L.d, {overflow: 'visible'}), [
        circle(null, c.track),
        circle(`${id}-arc`, c.fill, {style: {strokeDasharray: 1, strokeDashoffset: 1}, attrs: {pathLength: 1, strokeLinecap: 'round', transform: `rotate(-90 ${half} ${half})`}})
      ], {width: L.d, height: L.d, viewBox: `0 0 ${L.d} ${L.d}`, fill: 'none'}),
      el('div', `${id}-value`, abs(0, 0, L.d, L.d, {...hidden, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, fontFamily: fonts.display, fontSize: L.value.size, lineHeight: '1', color: c.valueColor, whiteSpace: 'nowrap', transformOrigin: '50% 50%'}), [c.start])
    ]);
    if (L.beside) return [row(B.x, B.y, B.width, L.height, [dial, flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column'}, statText(model, L.textW, 'left'))], {gap: L.gap})];
    return [column(B.x, B.y, B.width, L.height, [dial, ...statText(model, B.width, 'center', L.labelGap)])];
  },
  bar(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    return [column(B.x, B.y, B.width, L.height, [
      flowText(`${id}-value`, B.width, {...hidden, fontFamily: fonts.display, fontSize: L.value.size, lineHeight: '1', color: c.valueColor, whiteSpace: 'nowrap', transformOrigin: '0% 60%'}, c.start),
      flow(null, B.width, L.barH, {marginTop: L.barGap, borderRadius: r2(L.barH / 2), background: c.track}, [
        el('div', `${id}-fill`, abs(0, 0, r2(B.width * c.share), L.barH, {borderRadius: r2(L.barH / 2), background: c.fill, transformOrigin: '0% 50%', transform: 'scale(0, 1)'}))
      ]),
      ...statText(model, B.width, 'left', L.labelGap)
    ], {align: 'start'})];
  },
  ticker(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const tiles = [...c.value].map((char, i) => (c.chars[i]
      ? flow(`${id}-tile-${i}`, L.tileW, L.tileH, {...hidden, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: r2(L.size * 0.12), background: c.tileFill,
        border: `${r2(2 * unit)}px solid ${c.tileEdge}`, transformOrigin: '50% 50%'}, [el('div', `${id}-digit-${i}`, {margin: 0, fontFamily: fonts.display, fontSize: L.size, lineHeight: '1', color: c.tileInk}, [c.start[i]])])
      : flow(`${id}-tile-${i}`, undefined, L.tileH, {...hidden, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontSize: r2(L.size * 0.8), lineHeight: '1', color: c.tileInk, whiteSpace: 'nowrap'}, [char])));
    return [column(B.x, B.y, B.width, L.height, [
      flow(null, B.width, L.tileH, {display: 'flex', justifyContent: 'center', alignItems: 'center', gap: L.gapW}, tiles),
      ...statText(model, B.width, 'center', L.labelGap)
    ])];
  }
};

function statTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, mode = c.layout.mode;
  const countFor = Math.max(0.3, c.hitAt - c.t0);
  if (mode === 'ring') {
    set(ops, `${id}-arc`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-arc`, c.t0, countFor, 'power3.out', {strokeDashoffset: 1}, {strokeDashoffset: r2((1 - c.share) * 1000) / 1000});
    pop(ops, model, `${id}-value`, rt(Math.max(start, c.t0 - 0.1)), {scale: 0.7, duration: 0.45});
    for (const s_ of c.samples) set(ops, `${id}-value`, sampleTime(s_.t), {text: s_.text});
    tw(ops, `${id}-value`, c.hitAt, 0.4, 'back.out(2.2)', {scaleX: 1.08, scaleY: 1.08}, {scaleX: 1, scaleY: 1});
  } else if (mode === 'bar') {
    rise(ops, model, `${id}-value`, rt(Math.max(start, c.t0 - 0.1)), {distance: 20, duration: 0.35});
    for (const s_ of c.samples) set(ops, `${id}-value`, sampleTime(s_.t), {text: s_.text});
    set(ops, `${id}-fill`, start, {scaleX: 0, scaleY: 1});
    tw(ops, `${id}-fill`, c.t0, countFor, 'power3.out', {scaleX: 0}, {scaleX: 1});
    tw(ops, `${id}-value`, c.hitAt, 0.4, 'back.out(2.2)', {scaleX: 1.06, scaleY: 1.06}, {scaleX: 1, scaleY: 1});
  } else if (mode === 'ticker') {
    [...c.value].forEach((char, i) => {
      const at = rt(Math.max(start, c.t0 - 0.12 + i * 0.04));
      set(ops, `${id}-tile-${i}`, start, {opacity: 0, x: 0, y: r2(36 * unit), scaleX: 1, scaleY: 1});
      tw(ops, `${id}-tile-${i}`, at, 0.4, 'power3.out', {opacity: 0, y: r2(36 * unit)}, {opacity: 1, y: 0});
      if (!c.chars[i]) return;
      // Each digit tile shows its slot of the count, then flips once on the hit.
      let last = c.start[i];
      for (const s_ of c.samples) if (s_.text[i] !== last) { set(ops, `${id}-digit-${i}`, sampleTime(s_.t), {text: s_.text[i]}); last = s_.text[i]; }
      tw(ops, `${id}-tile-${i}`, rt(c.hitAt + i * 0.03), 0.4, 'back.out(2)', {scaleY: 0.82}, {scaleY: 1});
    });
  } else {
    if (c.icon) pop(ops, model, `${id}-icon`, rt(Math.max(model.start, c.t0 - 0.15)));
    rise(ops, model, `${id}-value`, rt(Math.max(model.start, c.t0 - 0.1)), {distance: 20, duration: 0.35});
    for (const s of c.samples) set(ops, `${id}-value`, sampleTime(s.t), {text: s.text});
    // The hit: a short pulse when the count lands.
    tw(ops, `${id}-value`, c.hitAt, 0.4, 'back.out(2.2)', {scaleX: 1.08, scaleY: 1.08}, {scaleX: 1, scaleY: 1});
  }
  rise(ops, model, `${id}-label`, c.labelAt, {distance: 16});
  rise(ops, model, `${id}-source`, c.sourceAt, {distance: 10});
}

export const statCard = {
  id: 'stat-card',
  describe: 'One real figure, big, that counts up to its value and lands, with a label and its source line ("Source: …", required). For a number the script states: a result, a price, a count. Never for a made-up or illustrative figure.',
  params: {value: 'the figure as said ≤ 12, with a digit ("87%", "3.2×", "$1,400")', label: 'what it measures ≤ 48', source: 'where it comes from ≤ 60 (required; not a placeholder)', icon: 'icon name (optional)', count: 'boolean (default true when the value starts with a number)', tone: 'value colour: primary (default) | accent | paper', at: 'count start', ...CARD_PARAMS},
  events: ['count', 'hit'],
  timing: cardTiming(['the count runs 0.9 s from at and hits on the exact value']),
  mood: ['editorial', 'launch', 'bold'],
  variants: STAT_VARIANTS,
  resolve: resolveStat, view: statView, timeline: statTimeline
};

// ---------------------------------------------------------------------------
// quote-card: a real quote with a named attribution.

// Variants: mark (a quote mark over the words, the original), pull (a primary
// bar that draws down the left of a larger quote, an initial on a disc in the
// byline), bubble (the quote in a speech bubble that pops from its tail at
// the byline) and centered (a big mark that drops in over the quote set in
// the display face, a rule and the name).
export const QUOTE_VARIANTS = Object.freeze(['mark', 'pull', 'bubble', 'centered']);

function resolveQuote(params, ctx) {
  const b = createCardBase('quote-card', params, ctx, {allowed: ['quote', 'author', 'role', 'source', 'highlight', 'at'], required: ['quote', 'author'], variants: QUOTE_VARIANTS});
  const {check, u, portrait, theme, colors} = b;
  const p = b.params;
  const quote = check.str(p.quote, 'params.quote', 180).replace(/^["“”']+|["“”']+$/g, '');
  const author = check.str(p.author, 'params.author', 40);
  if (GENERIC_AUTHOR.test(author.replace(/^[—–-]\s*/, ''))) check.fail('params.author', `needs a real attribution: the named person or organisation who said it, not ${JSON.stringify(author)}`);
  const role = p.role === undefined ? null : check.str(p.role, 'params.role', 48);
  const source = p.source === undefined ? null : sourceParam(check, p.source, 'params.source', 'the quote');
  const highlight = p.highlight === undefined ? null : check.str(p.highlight, 'params.highlight', 60);
  if (highlight && !quote.includes(highlight)) check.fail('params.highlight', 'must be a part of params.quote, exactly as written');
  const meta = [role, source].filter(Boolean).join(' · ') || null;
  const markColor = b.resolveColor('primary', 'quote mark colour (brand.colors.primary)', 'primary');
  const variant = (width, k) => {
    const mark = u(84 * k), markGap = u(18 * k);
    const text = fitText(check, 'params.quote', quote, {family: 'body', width, preferred: u((portrait ? 62 : 58) * k), min: b.min.key, maxLines: portrait ? 7 : 5});
    const name = fitText(check, 'params.author', `— ${author}`, {family: 'body', width, preferred: u(46 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 1});
    const sub = meta ? fitText(check, 'params.role', meta, {family: 'meta', width, preferred: u(28 * Math.max(1, k * 0.85)), min: b.min.meta, maxLines: 2}) : null;
    const nameGap = u(30 * k), subGap = u(8);
    return {mode: 'mark', mark, markGap, text, name, sub, nameGap, subGap,
      height: r2(mark + markGap + text.lines * text.size * 1.3 + nameGap + name.size * 1.2 + (sub ? subGap + sub.lines * sub.size * 1.3 : 0))};
  };
  const fitQuote = (width, k, family, preferred, maxLines) => fitText(check, 'params.quote', quote, {family, width, preferred: Math.max(b.min.key, u(preferred * k)), min: b.min.key, maxLines});
  const fitName = (width, k) => fitText(check, 'params.author', author, {family: 'body', width, preferred: Math.max(b.min.key, u(44 * Math.max(1, k * 0.9))), min: b.min.key, maxLines: 1});
  const fitMeta = (width, k) => (meta ? fitText(check, 'params.role', meta, {family: 'meta', width, preferred: u(28 * Math.max(1, k * 0.85)), min: b.min.meta, maxLines: 2}) : null);
  // The attribution row: an initial on a disc, the name and the meta line.
  const measureByline = (width, k) => {
    const avatar = u(96 * k), gap = u(24 * k), textW = r2(width - avatar - gap);
    const name = fitName(textW, k), sub = fitMeta(textW, k), subGap = u(6);
    return {avatar, gap, textW, name, sub, subGap, height: r2(Math.max(avatar, name.size * 1.2 + (sub ? subGap + sub.lines * sub.size * 1.3 : 0)))};
  };
  // pull: a primary bar down the left, a larger quote, then the byline.
  const pull = (width, k) => {
    const bar = u(10), barGap = u(44 * k), textW = r2(width - bar - barGap);
    const text = fitQuote(textW, k, 'body', portrait ? 66 : 62, portrait ? 7 : 5), by = measureByline(textW, k), byGap = u(40 * k);
    const quoteH = r2(text.lines * text.size * 1.28);
    return {mode: 'pull', bar, barGap, textW, text, by, byGap, quoteH, height: r2(quoteH + byGap + by.height)};
  };
  // bubble: the quote in a speech bubble whose tail points at the byline.
  const bubble = (width, k) => {
    const pad = u(48 * k), tail = u(44 * k), inner = r2(width - pad * 2);
    const text = fitQuote(inner, k, 'body', portrait ? 58 : 56, portrait ? 7 : 5), by = measureByline(width, k);
    const bubbleH = r2(pad * 2 + text.lines * text.size * 1.3), byGap = r2(tail * 0.9 + u(22 * k));
    return {mode: 'bubble', pad, tail, inner, text, by, bubbleH, byGap, height: r2(bubbleH + byGap + by.height)};
  };
  // centered: a big mark, the quote centred in the display face, a rule and the name.
  const centered = (width, k) => {
    const mark = u(120 * k), markGap = u(14 * k);
    const text = fitQuote(width, k, 'display', portrait ? 76 : 72, portrait ? 7 : 4);
    const name = fitName(width, k), sub = fitMeta(width, k), ruleGap = u(30 * k), rule = u(5), nameGap = u(22 * k), subGap = u(6);
    return {mode: 'centered', mark, markGap, text, name, sub, ruleGap, rule, nameGap, subGap,
      height: r2(mark + markGap + text.lines * text.size * 1.12 + ruleGap + rule + nameGap + name.size * 1.2 + (sub ? subGap + sub.lines * sub.size * 1.3 : 0))};
  };
  const shaped = {pull, bubble, centered}[b.variant];
  const measure = (width, maxHeight) => pick([...(shaped ? b.scales.map(k => () => shaped(width, k)) : []), ...[...b.scales, 0.6].map(k => () => variant(width, k))], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : b.variant === 'mark' ? 1300 : 1400)});
  const L = box.layout;
  const t0 = b.timeOf('quote', p.at, 'params.at', 0.15);
  const authorAt = after(b, t0, 0.45);
  b.events.push({id: `${b.id}-quote`, name: 'quote', time: t0, endTime: rt(t0 + 0.5), role: 'title', cue: 'whoosh'});
  b.events.push({id: `${b.id}-author`, name: 'author', time: authorAt, endTime: rt(authorAt + 0.45), role: 'detail'});
  let highlightAt = null;
  if (highlight) {
    highlightAt = b.timeOf('highlight', undefined, 'params.highlight', authorAt - b.start + 0.35);
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.4), role: 'emphasis', cue: 'tick'});
  }
  const [before, after_] = highlight ? [quote.slice(0, quote.indexOf(highlight)), quote.slice(quote.indexOf(highlight) + highlight.length)] : [quote, ''];
  const content = {box: {x: box.x, y: box.y, width: box.width}, layout: L, quote, author, meta, highlight, parts: [before, highlight, after_],
    markColor, textColor: theme.foreground, nameColor: colors.primary, metaColor: theme.muted, highlightFill: colors.primary, highlightInk: theme.surface, t0, authorAt, highlightAt};
  if (L.mode !== 'mark') {
    const solid = solidFill(b, 'primary', 4.5), quoteW = L.mode === 'pull' ? L.textW : L.mode === 'bubble' ? L.inner : box.width;
    // A highlight that fits on one line sweeps in on a marker; a longer one
    // wraps with its marker shown from the start.
    const family = L.mode === 'centered' ? 'display' : 'body';
    Object.assign(content, {initial: [...author.replace(/^[—–-]\s*/, '')][0].toUpperCase(), avatarFill: solid.fill, avatarInk: solid.ink, highlightFill: solid.fill, highlightInk: solid.ink,
      sweep: Boolean(highlight) && textWidth(highlight, L.text.size, family) <= quoteW, panel: theme.panel, border: theme.border, ruleColor: colors.primary});
  }
  return b.finish(content, {minTextPx: Math.min(L.text.size, (L.name ?? L.by.name).size)});
}

/** The quote's words, the highlight in a span: a marker that sweeps in behind it, or (wrapping) a static one. */
function quoteWords(model, width, style, align) {
  const {id, unit} = model;
  const c = model.content;
  const [before, words, rest] = c.parts;
  if (!c.highlight) return flowText(`${id}-quote`, width, {...hidden, ...style, textAlign: align}, c.quote);
  const mark = c.sweep
    ? el('span', null, {position: 'relative', display: 'inline-block', whiteSpace: 'nowrap', color: c.highlightInk}, [
      el('span', `${id}-highlight`, abs(r2(-6 * unit), 0, `calc(100% + ${r2(12 * unit)}px)`, '100%', {borderRadius: r2(6 * unit), background: c.highlightFill, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})),
      el('span', null, {position: 'relative'}, [words])
    ])
    : el('span', `${id}-highlight`, {color: c.highlightInk, background: c.highlightFill, borderRadius: r2(6 * unit), boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'}, [words]);
  return el('div', `${id}-quote`, {...hidden, position: 'relative', flex: 'none', width, margin: 0, whiteSpace: 'normal', overflowWrap: 'break-word', ...style, textAlign: align}, [before, mark, rest]);
}

/** The byline: an initial on a disc, the name and the meta line. */
function byline(model, by, align = 'left') {
  const {id, fonts} = model;
  const c = model.content;
  return [
    flow(`${id}-avatar`, by.avatar, by.avatar, {...hidden, borderRadius: '50%', background: c.avatarFill, display: 'flex', alignItems: 'center', justifyContent: 'center', transformOrigin: '50% 50%'}, [
      el('div', null, {margin: 0, fontFamily: fonts.display, fontSize: r2(by.avatar * 0.5), lineHeight: '1', color: c.avatarInk}, [c.initial])
    ]),
    flow(`${id}-author`, by.textW, undefined, {...hidden, display: 'flex', flexDirection: 'column', gap: by.subGap}, [
      flowText(null, by.textW, {fontFamily: fonts.body, fontWeight: 650, fontSize: by.name.size, lineHeight: '1.2', color: c.textColor, textAlign: align}, c.author),
      c.meta ? flowText(null, by.textW, {fontFamily: fonts.meta, fontSize: by.sub.size, lineHeight: '1.3', color: c.metaColor, textAlign: align}, c.meta) : null
    ].filter(Boolean))
  ];
}

const QUOTE_VIEWS = {
  pull(model) {
    const {id, fonts} = model;
    const c = model.content, L = c.layout, B = c.box;
    return [row(B.x, B.y, B.width, L.height, [
      flow(`${id}-mark`, L.bar, L.height, {borderRadius: L.bar, background: c.ruleColor, transformOrigin: '50% 0%', transform: 'scale(1, 0)'}, []),
      flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}, [
        quoteWords(model, L.textW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.text.size, lineHeight: '1.28', color: c.textColor}, 'left'),
        flow(null, L.textW, L.by.height, {marginTop: L.byGap, display: 'flex', alignItems: 'center', gap: L.by.gap}, byline(model, L.by))
      ])
    ], {gap: L.barGap})];
  },
  bubble(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const edge = r2(2 * unit), t = L.tail;
    const bubble = el('div', `${id}-mark`, abs(0, 0, B.width, L.bubbleH, {transformOrigin: `${r2(L.by.avatar / 2)}px 100%`}), [
      el('div', null, abs(r2(L.by.avatar / 2 - t / 2), r2(L.bubbleH - t / 2 - edge), t, t, {boxSizing: 'border-box', background: c.panel, borderRight: `${edge}px solid ${c.border}`, borderBottom: `${edge}px solid ${c.border}`, transform: 'rotate(45deg)'})),
      el('div', null, abs(0, 0, B.width, L.bubbleH, {boxSizing: 'border-box', borderRadius: r2(36 * unit), background: c.panel, border: `${edge}px solid ${c.border}`, borderBottomColor: 'transparent'})),
      el('div', null, abs(r2(L.tail * 1.4), r2(L.bubbleH - edge * 2), r2(B.width - L.tail * 1.4 - 36 * unit), edge, {background: c.border})),
      el('div', null, abs(L.pad, 0, L.inner, L.bubbleH, {display: 'flex', alignItems: 'center'}), [
        quoteWords(model, L.inner, {fontFamily: fonts.body, fontWeight: 500, fontSize: L.text.size, lineHeight: '1.3', color: c.textColor}, 'left')
      ])
    ]);
    const by = el('div', null, abs(0, r2(L.bubbleH + L.byGap), B.width, L.by.height, {display: 'flex', alignItems: 'center', gap: L.by.gap}), byline(model, L.by));
    return [el('div', null, abs(B.x, B.y, B.width, L.height), [bubble, by])];
  },
  centered(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    return [column(B.x, B.y, B.width, L.height, [
      flow(`${id}-mark`, L.mark, L.mark, {...hidden, marginBottom: L.markGap, transformOrigin: '50% 50%'}, [iconNode('quote', {size: L.mark, color: c.markColor})]),
      quoteWords(model, B.width, {fontFamily: fonts.display, fontSize: L.text.size, lineHeight: '1.12', color: c.textColor, transformOrigin: '50% 50%'}, 'center'),
      flow(`${id}-rule`, r2(Math.min(B.width * 0.2, 120 * unit)), L.rule, {marginTop: L.ruleGap, borderRadius: L.rule, background: c.ruleColor, transformOrigin: '50% 50%', transform: 'scale(0, 1)'}, []),
      flowText(`${id}-author`, B.width, {...hidden, marginTop: L.nameGap, fontFamily: fonts.body, fontWeight: 650, fontSize: L.name.size, lineHeight: '1.2', color: c.nameColor, textAlign: 'center'}, c.author),
      c.meta ? flowText(`${id}-meta`, B.width, {...hidden, marginTop: L.subGap, fontFamily: fonts.meta, fontSize: L.sub.size, lineHeight: '1.3', color: c.metaColor, textAlign: 'center'}, c.meta) : null
    ].filter(Boolean))];
  }
};

function quoteView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (QUOTE_VIEWS[L.mode]) return QUOTE_VIEWS[L.mode](model);
  const textStyle = {fontFamily: fonts.body, fontWeight: 500, fontSize: L.text.size, lineHeight: '1.3', color: c.textColor};
  const quoteText = [flowText(null, B.width, textStyle, c.quote)];
  if (c.highlight) {
    // A copy of the quote over it, transparent except the highlighted words
    // on a marker, so the browser lays both out the same way.
    const [before, words, rest] = c.parts;
    quoteText.push(el('div', `${id}-highlight`, abs(0, 0, B.width, undefined, {...hidden, margin: 0, whiteSpace: 'normal', overflowWrap: 'break-word', ...textStyle, color: 'transparent'}), [
      before,
      el('span', null, {color: c.highlightInk, background: c.highlightFill, borderRadius: r2(6 * unit), boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'}, [words]),
      rest
    ]));
  }
  return [column(B.x, B.y, B.width, L.height, [
    flow(`${id}-mark`, L.mark, L.mark, {...hidden, marginBottom: L.markGap, transformOrigin: '50% 50%'}, [iconNode('quote', {size: L.mark, color: c.markColor})]),
    flow(`${id}-quote`, B.width, undefined, {...hidden}, quoteText),
    flowText(`${id}-author`, B.width, {...hidden, marginTop: L.nameGap, fontFamily: fonts.body, fontWeight: 650, fontSize: L.name.size, lineHeight: '1.2', color: c.nameColor}, `— ${c.author}`),
    c.meta ? flowText(`${id}-meta`, B.width, {...hidden, marginTop: L.subGap, fontFamily: fonts.meta, fontSize: L.sub.size, lineHeight: '1.3', color: c.metaColor}, c.meta) : null
  ].filter(Boolean), {align: 'start'})];
}

function quoteTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, mode = c.layout.mode;
  if (QUOTE_VIEWS[mode]) {
    if (mode === 'pull') {
      set(ops, `${id}-mark`, start, {scaleX: 1, scaleY: 0});
      tw(ops, `${id}-mark`, rt(Math.max(start, c.t0 - 0.15)), 0.6, 'power3.out', {scaleY: 0}, {scaleY: 1});
      set(ops, `${id}-quote`, start, {opacity: 0, x: r2(40 * unit), y: 0});
      tw(ops, `${id}-quote`, c.t0, 0.55, 'power3.out', {opacity: 0, x: r2(40 * unit)}, {opacity: 1, x: 0});
    } else if (mode === 'bubble') {
      set(ops, `${id}-mark`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.6, scaleY: 0.6});
      tw(ops, `${id}-mark`, rt(Math.max(start, c.t0 - 0.15)), 0.55, 'back.out(1.5)', {opacity: 0, scaleX: 0.6, scaleY: 0.6}, {opacity: 1, scaleX: 1, scaleY: 1});
      rise(ops, model, `${id}-quote`, rt(c.t0 + 0.1), {distance: 12, duration: 0.45});
    } else {
      set(ops, `${id}-mark`, start, {opacity: 0, x: 0, y: r2(-40 * unit), rotation: -20});
      tw(ops, `${id}-mark`, rt(Math.max(start, c.t0 - 0.15)), 0.55, 'back.out(1.6)', {opacity: 0, y: r2(-40 * unit), rotation: -20}, {opacity: 1, y: 0, rotation: 0});
      set(ops, `${id}-quote`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.95, scaleY: 0.95});
      tw(ops, `${id}-quote`, c.t0, 0.6, 'power3.out', {opacity: 0, scaleX: 0.95, scaleY: 0.95}, {opacity: 1, scaleX: 1, scaleY: 1});
      set(ops, `${id}-rule`, start, {scaleX: 0, scaleY: 1});
      tw(ops, `${id}-rule`, rt(c.authorAt - 0.1), 0.45, 'power3.out', {scaleX: 0}, {scaleX: 1});
    }
    if (mode !== 'centered') pop(ops, model, `${id}-avatar`, rt(c.authorAt - 0.08), {scale: 0.4});
    rise(ops, model, `${id}-author`, c.authorAt, {distance: 14});
    if (c.meta && mode === 'centered') rise(ops, model, `${id}-meta`, c.authorAt, {distance: 10});
    if (c.highlight && c.sweep) {
      set(ops, `${id}-highlight`, start, {scaleX: 0, scaleY: 1});
      tw(ops, `${id}-highlight`, c.highlightAt, 0.45, 'power3.out', {scaleX: 0}, {scaleX: 1});
    }
    return;
  }
  pop(ops, model, `${id}-mark`, rt(Math.max(model.start, c.t0 - 0.15)), {scale: 0.5});
  rise(ops, model, `${id}-quote`, c.t0, {distance: 24, duration: 0.5});
  rise(ops, model, `${id}-author`, c.authorAt, {distance: 14});
  if (c.meta) rise(ops, model, `${id}-meta`, c.authorAt, {distance: 10});
  if (c.highlight) {
    set(ops, `${id}-highlight`, model.start, {opacity: 0});
    tw(ops, `${id}-highlight`, c.highlightAt, 0.35, 'power2.out', {opacity: 0}, {opacity: 1});
  }
}

export const quoteCard = {
  id: 'quote-card',
  describe: 'A real quote with its attribution: a quote mark, the words (one phrase can light up on a marker), then "— Name" and their role or where it was said. For a customer, press or expert line the user supplied. Never invent a quote or attribute one to "a customer".',
  params: {quote: 'the exact words ≤ 180', author: 'the named person or organisation ≤ 40 (required; not "a customer")', role: 'title or company ≤ 48 (optional)', source: 'where it was said ≤ 60 (optional)', highlight: 'a phrase from the quote (optional)', at: 'quote time', ...CARD_PARAMS},
  events: ['quote', 'author', 'highlight'],
  timing: cardTiming(['the author follows the quote by 0.45 s; the highlight lands 0.35 s after the author (or on a highlight hit)']),
  mood: ['editorial', 'launch'],
  variants: QUOTE_VARIANTS,
  resolve: resolveQuote, view: quoteView, timeline: quoteTimeline
};

// ---------------------------------------------------------------------------
// excerpt: real lines of code or text with highlights, in a window.

const PLACEHOLDER_TEXT = /lorem ipsum|dolor sit amet|\b(todo|tbd|placeholder)\b/i;

function resolveExcerpt(params, ctx) {
  const b = createCardBase('excerpt', params, ctx, {allowed: ['lines', 'type', 'title', 'source', 'highlightAt', 'at'], required: ['lines', 'source']});
  const {check, u, portrait, theme, colors, start} = b;
  const p = b.params;
  const kind = p.type === undefined ? 'text' : check.oneOf(p.type, 'params.type', ['text', 'code']);
  check.arr(p.lines, 'params.lines', 1, 8);
  const lines = p.lines.map((raw, i) => {
    const entry = typeof raw === 'string' ? {text: raw} : check.obj(raw, `params.lines[${i}]`, ['text', 'highlight'], ['text']);
    if (typeof entry.text !== 'string' || entry.text.length > 64 || /[\u0000-\u0008\u000a-\u001f<>]/.test(entry.text)) check.fail(`params.lines[${i}].text`, 'must be a line of at most 64 characters, as written in the source (no angle brackets)');
    if (PLACEHOLDER_TEXT.test(entry.text)) check.fail(`params.lines[${i}].text`, 'looks like placeholder text; an excerpt shows only real, supplied content');
    return {index: i, text: kind === 'code' ? entry.text.replace(/\t/g, '  ').replace(/\s+$/, '') : entry.text.trim(), highlight: entry.highlight === undefined ? false : check.bool(entry.highlight, `params.lines[${i}].highlight`)};
  });
  if (lines.every(line => !line.text)) check.fail('params.lines', 'needs at least one line with text');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const source = sourceParam(check, p.source, 'params.source', 'the excerpt');
  const sourceText = `Source: ${source}`;
  const family = kind === 'code' ? 'meta' : 'body';
  const variant = (width, k) => {
    const padX = u(36 * Math.min(1, k)), padY = u(28 * Math.min(1, k)), inner = width - padX * 2;
    const head = title ? fitText(check, 'params.title', title, {family: 'meta', width: inner, preferred: u(30 * Math.max(1, k * 0.85)), min: b.min.meta, maxLines: 1}) : null;
    const headH = head ? r2(head.size * 1.3 + u(22)) : 0;
    const sizes = lines.map(line => (line.text ? fitText(check, `params.lines[${line.index}].text`, line.text.trim(), {family, width: inner - u(20), preferred: u((kind === 'code' ? 44 : 48) * k), min: b.min.key, maxLines: kind === 'code' ? 1 : 2}) : null));
    const size = Math.min(...sizes.filter(Boolean).map(s => s.size));
    const lineH = r2(size * (kind === 'code' ? 1.45 : 1.35));
    const rows = sizes.map(s => (s ? s.lines : 1));
    const bodyH = r2(rows.reduce((sum, n) => sum + n * lineH, 0));
    const src = fitText(check, 'params.source', sourceText, {family: 'meta', width, preferred: u(28 * Math.max(1, k * 0.85)), min: b.min.meta, maxLines: 2});
    const sourceGap = u(20 * k);
    const panelH = r2(padY * 2 + headH + bodyH);
    return {padX, padY, inner: r2(inner), head, headH, size, lineH, rows, bodyH, panelH, source: src, sourceGap, height: r2(panelH + sourceGap + src.lines * src.size * 1.3)};
  };
  const measure = (width, maxHeight) => pick([...b.scales.filter(k => k <= 1.25), 0.6].map(k => () => variant(width, k)), maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 940 : 1640)});
  const L = box.layout;
  const t0 = b.timeOf('lines', p.at, 'params.at', 0.05);
  const step = Math.min(0.12, 0.6 / lines.length);
  const shown = lines.map((line, i) => ({...line, time: rt(t0 + i * step)}));
  const marked = lines.some(line => line.highlight);
  b.events.push({id: `${b.id}-lines`, name: 'lines', time: t0, endTime: rt(t0 + step * lines.length + 0.3), role: 'title'});
  let highlightAt = null;
  if (marked) {
    highlightAt = b.timeOf('highlight', p.highlightAt, 'params.highlightAt', Math.min(t0 - start + step * lines.length + 0.5, b.lastEvent));
    b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.45), role: 'emphasis', cue: 'tick'});
  } else if (p.highlightAt !== undefined) check.fail('params.highlightAt', 'needs a line with highlight: true');
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, kind, lines: shown, title, source, sourceText, marked,
    panel: theme.panel, border: theme.border, textColor: theme.foreground, dimColor: theme.muted, titleColor: theme.muted, sourceColor: theme.muted, mark: colors.primary, t0, highlightAt},
  {minTextPx: L.size});
}

function excerptView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  const family = c.kind === 'code' ? fonts.meta : fonts.body;
  let y = L.padY + L.headH;
  const rows = c.lines.map((line, i) => {
    const h = r2(L.rows[i] * L.lineH);
    const top = r2(y);
    y += h;
    const kids = [];
    if (line.highlight) {
      kids.push(el('div', `${id}-mark-${line.index}`, abs(r2(-12 * unit), 0, r2(L.inner + 24 * unit), h, {borderRadius: r2(10 * unit), background: `${c.mark}2e`, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})));
      kids.push(el('div', null, abs(r2(-12 * unit), 0, r2(6 * unit), h, {borderRadius: r2(3 * unit), background: c.mark})));
    }
    kids.push(el('div', null, abs(r2(8 * unit), 0, r2(L.inner - 8 * unit), h, {display: 'flex', alignItems: 'center', margin: 0, fontFamily: family, fontWeight: c.kind === 'code' ? 400 : 500, fontSize: L.size,
      lineHeight: `${r2(L.lineH / L.size)}`, color: c.textColor, whiteSpace: c.kind === 'code' ? 'pre' : 'normal', overflowWrap: 'break-word'}), [line.text || ' ']));
    return el('div', `${id}-line-${line.index}`, abs(L.padX, top, L.inner, h, {...hidden}), kids);
  });
  const head = c.title ? [el('div', null, abs(L.padX, L.padY, L.inner, undefined, {margin: 0, fontFamily: fonts.meta, fontSize: L.head.size, lineHeight: '1.3', color: c.titleColor, whiteSpace: 'nowrap', overflow: 'hidden'}), [c.title]),
    el('div', null, abs(0, r2(L.padY + L.head.size * 1.3 + 10 * unit), B.width, r2(2 * unit), {background: c.border}))] : [];
  return [column(B.x, B.y, B.width, L.height, [
    flow(`${id}-panel`, B.width, L.panelH, {boxSizing: 'border-box', borderRadius: r2(24 * unit), background: c.panel, border: `${r2(2 * unit)}px solid ${c.border}`}, [...head, ...rows]),
    flowText(`${id}-source`, B.width, {...hidden, marginTop: L.sourceGap, fontFamily: fonts.meta, fontSize: L.source.size, lineHeight: '1.3', color: c.sourceColor}, c.sourceText)
  ], {align: 'start'})];
}

function excerptTimeline(model, ops) {
  const {id} = model;
  const c = model.content;
  for (const line of c.lines) {
    const target = `${id}-line-${line.index}`;
    set(ops, target, model.start, {opacity: 0, x: r2(-14 * model.unit), y: 0});
    tw(ops, target, line.time, 0.35, 'power2.out', {opacity: 0, x: r2(-14 * model.unit)}, {opacity: 1, x: 0});
    if (c.marked) {
      // Focus: the other lines dim as the marks sweep in.
      if (line.highlight) {
        set(ops, `${id}-mark-${line.index}`, model.start, {scaleX: 0, scaleY: 1});
        tw(ops, `${id}-mark-${line.index}`, c.highlightAt, 0.45, 'power3.out', {scaleX: 0}, {scaleX: 1});
      } else tw(ops, target, c.highlightAt, 0.35, 'power1.out', {opacity: 1}, {opacity: 0.45});
    }
  }
  rise(ops, model, `${id}-source`, rt(c.t0 + 0.3), {distance: 10});
}

export const excerpt = {
  id: 'excerpt',
  describe: 'A real excerpt in a window: 1–8 lines of code or text exactly as written in the source (README, docs, an article, a commit), revealed line by line; marked lines get a highlight sweep while the rest dim. The source line is required. Never paraphrase or invent lines.',
  params: {lines: '[string | {text ≤ 64 (verbatim), highlight?: boolean}] 1–8', type: 'text (default) | code (monospace, one line each)', title: 'file name or document ≤ 48 (optional)', source: 'where it comes from ≤ 60 (required)', highlightAt: 'seconds from scene start (optional; default after the lines)', at: 'first line time', ...CARD_PARAMS},
  events: ['lines', 'highlight'],
  timing: cardTiming(['lines reveal from at, one every min(0.12, 0.6 / lines) s; the highlight follows 0.5 s after the last']),
  mood: ['editorial', 'launch'],
  resolve: resolveExcerpt, view: excerptView, timeline: excerptTimeline
};
