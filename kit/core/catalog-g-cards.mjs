// Catalogue G cards: concept-card, icon-row, section-card and object-card
// (docs/VIDEO_QUALITY_RFC.md §8). Each exports {id, describe, params, events,
// timing, mood, resolve, view, timeline}; registered in catalog-g.mjs.
//
// Layout: measure() sizes a variant conservatively (catalogue B's advance
// model) for placement; the view lays the content out in flex columns and
// rows (catalog-g-base.mjs column/row/flow), so the browser's real text
// heights decide the spacing in both renderers.

import {fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {CARD_PARAMS, after, at, bob, cardTiming, column, createCardBase, flow, flowText, iconParam, iconTile, pick, pop, rise, row, solidFill, spread, tintBehind, wrapWords} from './catalog-g-base.mjs';
import {ICON_STROKE, iconNode} from './icons.mjs';

const TONES = ['primary', 'accent', 'paper'];
const hidden = {opacity: 0};

// ---------------------------------------------------------------------------
// concept-card: a big word or short phrase, an icon and a sub-line.

// Variants: stacked (the icon over the word, the original), side-icon (a
// solid icon tile beside the word, a rule and the sub-line), banner (the word
// on a brand band that wipes in, the icon on a disc at its end) and marker
// (a big left-set word that a highlighter sweeps under).
export const CONCEPT_VARIANTS = Object.freeze(['stacked', 'side-icon', 'banner', 'marker']);

function resolveConcept(params, ctx) {
  const b = createCardBase('concept-card', params, ctx, {allowed: ['text', 'icon', 'sub', 'tone', 'at'], required: ['text'], variants: CONCEPT_VARIANTS});
  const {check, u, portrait, colors, theme} = b;
  const p = b.params;
  const text = check.str(p.text, 'params.text', 28);
  if (text.split(/\s+/).length > 3) check.fail('params.text', 'must be a word or a short phrase of at most three words');
  const glyph = iconParam(check, p.icon, 'params.icon');
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 64);
  const tone = p.tone === undefined ? 'paper' : check.oneOf(p.tone, 'params.tone', TONES);
  const wordColor = b.resolveColor(tone, 'params.tone', 'paper');
  const fitWord = (width, k) => fitText(check, 'params.text', text, {family: 'display', width, preferred: u((portrait ? 150 : 140) * k), min: u(64), maxLines: 2});
  const fitSub = (width, k) => (sub ? fitText(check, 'params.sub', sub, {family: 'body', width, preferred: u(48 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null);
  const stack = (width, k) => {
    const word = fitWord(width, k), subFit = fitSub(width, k);
    const iconSize = glyph ? u((portrait ? 168 : 150) * k) : 0;
    const out = {mode: 'stack', iconSize, word, sub: subFit, gap: u(28 * k), subGap: u(18 * k)};
    out.height = r2(iconSize + (glyph ? out.gap : 0) + word.lines * word.size * 1.02 + (subFit ? out.subGap + subFit.lines * subFit.size * 1.25 : 0));
    return out;
  };
  // The icon on a tile to the left of the text, for a short room.
  const inline = (width, k) => {
    const textW = r2(width - u(150 * k) - u(32));
    const word = fitWord(textW, k * 0.75), subFit = fitSub(textW, 1);
    const textH = r2(word.lines * word.size * 1.02 + (subFit ? u(14) + subFit.lines * subFit.size * 1.25 : 0));
    const iconSize = r2(Math.min(u(150 * k), Math.max(u(130 * k), textH)));
    return {mode: 'inline', iconSize, word, sub: subFit, gap: u(32), subGap: u(14), textW, height: r2(Math.max(iconSize, textH))};
  };
  // side-icon: a solid tile (or a tall bar with no icon), then the text.
  const side = (width, k) => {
    const tile = glyph ? u((portrait ? 176 : 230) * k) : u(16), gap = u((glyph ? 44 : 40) * k), textW = r2(width - tile - gap);
    const word = fitText(check, 'params.text', text, {family: 'display', width: textW, preferred: u((portrait ? 124 : 132) * k), min: u(64), maxLines: 2});
    const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'body', width: textW, preferred: u(44 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null;
    const rule = u(6), ruleGap = u(24 * k);
    const textH = r2(word.lines * word.size * 1.02 + (subFit ? rule + ruleGap * 2 + subFit.lines * subFit.size * 1.25 : 0));
    return {mode: 'side', tile, gap, textW, word, sub: subFit, rule, ruleGap, textH, height: r2(Math.max(glyph ? tile : 0, textH))};
  };
  // banner: a band across the box, the icon on a disc over its left end.
  const banner = (width, k) => {
    const disc = glyph ? u((portrait ? 176 : 184) * k) : 0, padX = u(44 * k), padY = u(30 * k);
    const bandX = r2(disc / 2), textX = r2(glyph ? disc / 2 + padX * 0.8 : padX), textW = r2(width - bandX - textX - padX);
    const word = fitText(check, 'params.text', text, {family: 'display', width: textW, preferred: u((portrait ? 116 : 120) * k), min: u(64), maxLines: 2});
    const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'body', width: r2(width - bandX), preferred: u(46 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null;
    const bandH = r2(word.lines * word.size * 1.04 + padY * 2), rowH = r2(Math.max(bandH, disc)), subGap = u(30 * k);
    return {mode: 'banner', disc, padX, padY, bandX, textX, textW, word, sub: subFit, bandH, rowH, subGap, height: r2(rowH + (subFit ? subGap + subFit.lines * subFit.size * 1.25 : 0))};
  };
  // marker: a small icon, then the word set left and large with a highlighter
  // under each line, then the sub-line.
  const marker = (width, k) => {
    const iconSize = glyph ? u(96 * k) : 0, iconGap = glyph ? u(26 * k) : 0;
    const word = fitText(check, 'params.text', text, {family: 'display', width: r2(width - u(24)), preferred: u((portrait ? 160 : 150) * k), min: u(64), maxLines: 3});
    const subFit = sub ? fitText(check, 'params.sub', sub, {family: 'body', width, preferred: u(46 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null;
    const subGap = u(30 * k);
    return {mode: 'marker', iconSize, iconGap, word, sub: subFit, subGap, height: r2(iconSize + iconGap + word.lines * word.size * 1.08 + (subFit ? subGap + subFit.lines * subFit.size * 1.25 : 0))};
  };
  const shapes = {'side-icon': side, banner, marker};
  const shaped = shapes[b.variant];
  const original = width => [...b.scales.map(k => () => stack(width, k)), ...(glyph ? [1, 0.82].map(k => () => inline(width, k)) : [])];
  // A variant tries its own shape at every scale; a room too small for it
  // falls back to the original (and then its compact inline form).
  const measure = (width, maxHeight) => pick([...(shaped ? b.scales.map(k => () => shaped(width, k)) : []), ...original(width)], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : b.variant === 'stacked' ? 1100 : 1300)});
  const L = box.layout;
  const t0 = b.timeOf('word', p.at, 'params.at', 0.05);
  const iconAt = glyph ? rt(Math.max(b.start, t0 - 0.15)) : null;
  const subAt = sub ? after(b, t0, 0.35) : null;
  if (glyph) b.events.push({id: `${b.id}-icon`, name: 'icon', time: iconAt, endTime: rt(iconAt + 0.5), role: 'emphasis', cue: 'pop-soft'});
  b.events.push({id: `${b.id}-word`, name: 'word', time: t0, endTime: rt(t0 + 0.45), role: 'title', cue: 'whoosh'});
  if (sub) b.events.push({id: `${b.id}-sub`, name: 'sub', time: subAt, endTime: rt(subAt + 0.45), role: 'detail'});
  const tile = solidFill(b, 'primary', 3);
  const content = {box: {x: box.x, y: box.y, width: box.width}, layout: L, text, icon: glyph, sub, wordColor, iconColor: colors.primary, subColor: theme.muted, t0, iconAt, subAt};
  if (L.mode === 'side') Object.assign(content, {tileFill: tile.fill, tileInk: tile.ink, ruleColor: colors.accent});
  if (L.mode === 'banner') Object.assign(content, {bandFill: tile.fill, bandInk: tile.ink, discFill: theme.bg, discEdge: colors.primary});
  if (L.mode === 'marker') Object.assign(content, {markFill: tintBehind(b, 'accent', wordColor), markLines: wrapWords(text, L.word.size, 'display', r2(box.width - u(24)))});
  return b.finish(content, {minTextPx: Math.min(L.word.size, L.sub?.size ?? Infinity)});
}

function conceptView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (L.mode === 'side' || L.mode === 'banner' || L.mode === 'marker') return CONCEPT_VIEWS[L.mode](model);
  const stacked = L.mode === 'stack';
  const textW = stacked ? B.width : L.textW;
  const align = stacked ? 'center' : 'left';
  const word = flowText(`${id}-word`, textW, {...hidden, fontFamily: fonts.display, fontSize: L.word.size, lineHeight: '1.02', color: c.wordColor, textAlign: align}, c.text);
  const sub = c.sub ? flowText(`${id}-sub`, textW, {...hidden, marginTop: L.subGap, fontFamily: fonts.body, fontWeight: 500, fontSize: L.sub.size, lineHeight: '1.25', color: c.subColor, textAlign: align}, c.sub) : null;
  if (stacked) {
    const glyph = c.icon ? flow(`${id}-icon`, L.iconSize, L.iconSize, {...hidden, marginBottom: L.gap, transformOrigin: '50% 50%'}, [iconNode(c.icon, {size: L.iconSize, color: c.iconColor})]) : null;
    return [column(B.x, B.y, B.width, L.height, [glyph, word, sub].filter(Boolean))];
  }
  const tile = iconTile(`${id}-icon`, c.icon, L.iconSize, c.iconColor, unit, {glyph: 0.58});
  tile.style.opacity = 0;
  return [row(B.x, B.y, B.width, L.height, [tile, flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column'}, [word, sub].filter(Boolean))], {gap: L.gap})];
}

const CONCEPT_VIEWS = {
  side(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const lead = c.icon
      ? flow(`${id}-icon`, L.tile, L.tile, {...hidden, borderRadius: r2(L.tile * 0.26), background: c.tileFill, transformOrigin: '50% 50%'}, [iconNode(c.icon, {x: r2(L.tile * 0.2), y: r2(L.tile * 0.2), size: r2(L.tile * 0.6), color: c.tileInk})])
      : flow(`${id}-bar`, L.tile, L.textH, {borderRadius: L.tile, background: c.tileFill, transformOrigin: '50% 0%', transform: 'scale(1, 0)'}, []);
    const text = flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}, [
      flowText(`${id}-word`, L.textW, {...hidden, fontFamily: fonts.display, fontSize: L.word.size, lineHeight: '1.02', color: c.wordColor}, c.text),
      c.sub ? flow(`${id}-rule`, r2(Math.min(L.textW * 0.4, 180 * unit)), L.rule, {margin: `${L.ruleGap}px 0`, borderRadius: L.rule, background: c.ruleColor, transformOrigin: '0% 50%', transform: 'scale(0, 1)'}, []) : null,
      c.sub ? flowText(`${id}-sub`, L.textW, {...hidden, fontFamily: fonts.body, fontWeight: 500, fontSize: L.sub.size, lineHeight: '1.25', color: c.subColor}, c.sub) : null
    ].filter(Boolean));
    return [row(B.x, B.y, B.width, L.height, [lead, text], {gap: L.gap})];
  },
  banner(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const bandY = r2((L.rowH - L.bandH) / 2), notch = r2(L.bandH * 0.32);
    const kids = [
      el('div', `${id}-band`, abs(L.bandX, bandY, r2(B.width - L.bandX), L.bandH, {background: c.bandFill, clipPath: `polygon(0 0, 100% 0, calc(100% - ${notch}px) 50%, 100% 100%, 0 100%)`, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})),
      el('div', `${id}-word`, abs(r2(L.bandX + L.textX), bandY, L.textW, L.bandH, {...hidden, display: 'flex', alignItems: 'center', margin: 0, fontFamily: fonts.display, fontSize: L.word.size, lineHeight: '1.04', color: c.bandInk, whiteSpace: 'normal', overflowWrap: 'break-word'}), [c.text])
    ];
    if (c.icon) {
      const edge = r2(6 * unit), g = r2(L.disc * 0.52);
      kids.push(el('div', `${id}-icon`, abs(0, r2((L.rowH - L.disc) / 2), L.disc, L.disc, {...hidden, boxSizing: 'border-box', borderRadius: '50%', background: c.discFill, border: `${edge}px solid ${c.discEdge}`, transformOrigin: '50% 50%'}), [
        iconNode(c.icon, {x: r2((L.disc - g) / 2 - edge), y: r2((L.disc - g) / 2 - edge), size: g, color: c.iconColor})
      ]));
    }
    const top = el('div', null, abs(0, 0, B.width, L.rowH), kids);
    const sub = c.sub ? flowText(`${id}-sub`, r2(B.width - L.bandX), {...hidden, marginTop: L.subGap, marginLeft: L.bandX, fontFamily: fonts.body, fontWeight: 500, fontSize: L.sub.size, lineHeight: '1.25', color: c.subColor}, c.sub) : null;
    return [column(B.x, B.y, B.width, L.height, [flow(null, B.width, L.rowH, {}, [top]), sub].filter(Boolean), {align: 'start'})];
  },
  marker(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const inset = r2(12 * unit);
    // One block per line (the measure's own wrap), each with a highlighter
    // band under its words that sweeps in.
    const lines = c.markLines.map((line, i) =>
      el('div', null, {margin: 0, whiteSpace: 'nowrap'}, [
        el('span', null, {position: 'relative', display: 'inline-block', padding: `0 ${inset}px`}, [
          el('div', `${id}-mark-${i}`, abs(0, '54%', '100%', '34%', {borderRadius: r2(6 * unit), background: c.markFill, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})),
          el('span', null, {position: 'relative'}, [line])
        ])
      ]));
    return [column(B.x, B.y, B.width, L.height, [
      c.icon ? flow(`${id}-icon`, L.iconSize, L.iconSize, {...hidden, marginBottom: L.iconGap, marginLeft: inset, transformOrigin: '50% 50%'}, [iconNode(c.icon, {size: L.iconSize, color: c.iconColor})]) : null,
      flow(`${id}-word`, B.width, undefined, {...hidden, fontFamily: fonts.display, fontSize: L.word.size, lineHeight: '1.08', color: c.wordColor}, lines),
      c.sub ? flowText(`${id}-sub`, r2(B.width - inset * 2), {...hidden, marginTop: L.subGap, marginLeft: inset, fontFamily: fonts.body, fontWeight: 500, fontSize: L.sub.size, lineHeight: '1.25', color: c.subColor}, c.sub) : null
    ].filter(Boolean), {align: 'start'})];
  }
};

function conceptTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, mode = c.layout.mode;
  if (mode === 'side') {
    if (c.icon) {
      set(ops, `${id}-icon`, start, {opacity: 0, x: r2(-60 * unit), y: 0, scaleX: 0.8, scaleY: 0.8, rotation: -10});
      tw(ops, `${id}-icon`, c.iconAt, 0.55, 'power3.out', {opacity: 0, x: r2(-60 * unit), scaleX: 0.8, scaleY: 0.8, rotation: -10}, {opacity: 1, x: 0, scaleX: 1, scaleY: 1, rotation: 0});
    } else {
      set(ops, `${id}-bar`, start, {scaleX: 1, scaleY: 0});
      tw(ops, `${id}-bar`, rt(Math.max(start, c.t0 - 0.1)), 0.5, 'power3.out', {scaleY: 0}, {scaleY: 1});
    }
    set(ops, `${id}-word`, start, {opacity: 0, x: r2(40 * unit), y: 0});
    tw(ops, `${id}-word`, c.t0, 0.5, 'power3.out', {opacity: 0, x: r2(40 * unit)}, {opacity: 1, x: 0});
    if (c.sub) {
      set(ops, `${id}-rule`, start, {scaleX: 0, scaleY: 1});
      tw(ops, `${id}-rule`, rt(c.t0 + 0.2), 0.5, 'power3.out', {scaleX: 0}, {scaleX: 1});
      rise(ops, model, `${id}-sub`, c.subAt, {distance: 16});
    }
    return;
  }
  if (mode === 'banner') {
    const wipe = rt(Math.max(start, c.t0 - 0.2));
    set(ops, `${id}-band`, start, {scaleX: 0, scaleY: 1});
    tw(ops, `${id}-band`, wipe, 0.5, 'power3.inOut', {scaleX: 0}, {scaleX: 1});
    if (c.icon) pop(ops, model, `${id}-icon`, c.iconAt, {scale: 0.4, duration: 0.55});
    set(ops, `${id}-word`, start, {opacity: 0, x: 0, y: r2(28 * unit)});
    tw(ops, `${id}-word`, rt(c.t0 + 0.12), 0.45, 'power3.out', {opacity: 0, y: r2(28 * unit)}, {opacity: 1, y: 0});
    if (c.sub) rise(ops, model, `${id}-sub`, c.subAt, {distance: 16});
    return;
  }
  if (mode === 'marker') {
    if (c.icon) {
      set(ops, `${id}-icon`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.5, scaleY: 0.5, rotation: -90});
      tw(ops, `${id}-icon`, c.iconAt, 0.6, 'back.out(1.6)', {opacity: 0, scaleX: 0.5, scaleY: 0.5, rotation: -90}, {opacity: 1, scaleX: 1, scaleY: 1, rotation: 0});
    }
    rise(ops, model, `${id}-word`, c.t0, {distance: 44, duration: 0.6});
    c.markLines.forEach((_, i) => {
      set(ops, `${id}-mark-${i}`, start, {scaleX: 0, scaleY: 1});
      tw(ops, `${id}-mark-${i}`, rt(c.t0 + 0.3 + i * 0.14), 0.5, 'power2.inOut', {scaleX: 0}, {scaleX: 1});
    });
    if (c.sub) {
      set(ops, `${id}-sub`, start, {opacity: 0, x: r2(-24 * unit), y: 0});
      tw(ops, `${id}-sub`, c.subAt, 0.45, 'power3.out', {opacity: 0, x: r2(-24 * unit)}, {opacity: 1, x: 0});
    }
    return;
  }
  if (c.icon) pop(ops, model, `${id}-icon`, c.iconAt);
  rise(ops, model, `${id}-word`, c.t0);
  if (c.sub) rise(ops, model, `${id}-sub`, c.subAt, {distance: 18});
}

export const conceptCard = {
  id: 'concept-card',
  describe: 'A big word or short phrase (≤ 3 words) with an icon from the icon set and a sub-line, on a brand card beside the presenter or full frame. For naming a claim, a problem or a turn ("Security first", "Too slow", "Now: one click").',
  params: {text: 'word or phrase ≤ 28, ≤ 3 words', icon: 'icon name from kit/core/icons.mjs (optional)', sub: 'sub-line ≤ 64 (optional)', tone: 'word colour: paper (default) | primary | accent', at: 'word time', ...CARD_PARAMS},
  events: ['icon', 'word', 'sub'],
  timing: cardTiming(['with no at, the word lands at 0.05 s; the icon pops up to 0.15 s before it and the sub-line follows it by 0.35 s']),
  mood: ['editorial', 'launch', 'bold'],
  variants: CONCEPT_VARIANTS,
  resolve: resolveConcept, view: conceptView, timeline: conceptTimeline
};

// ---------------------------------------------------------------------------
// icon-row: 2–5 icons with labels that build in on their words.

// Variants: tiles (icon tiles in a row or a list, the original), pills
// (capsules with the icon on a solid disc that slide in), orbit (the icons on
// a ring around a hub that fly out from its centre) and list (numbered rows
// between drawn rules).
export const ICON_ROW_VARIANTS = Object.freeze(['tiles', 'pills', 'orbit', 'list']);

function resolveIconRow(params, ctx) {
  const b = createCardBase('icon-row', params, ctx, {allowed: ['items', 'title', 'layout', 'stagger', 'at'], required: ['items'], variants: ICON_ROW_VARIANTS});
  const {check, u, portrait, colors, theme, start, id} = b;
  const p = b.params;
  check.arr(p.items, 'params.items', 2, 5);
  const items = p.items.map((raw, i) => {
    const entry = check.obj(raw, `params.items[${i}]`, ['icon', 'label', 'at'], ['icon', 'label']);
    return {index: i, icon: iconParam(check, entry.icon, `params.items[${i}].icon`), label: check.str(entry.label, `params.items[${i}].label`, 24), at: entry.at};
  });
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const layoutIn = p.layout === undefined ? 'auto' : check.oneOf(p.layout, 'params.layout', ['auto', 'row', 'list']);
  const stagger = p.stagger === undefined ? 0.18 : check.num(p.stagger, 'params.stagger', 0.05, 1);
  const n = items.length;
  const withTitle = (width, k, body) => {
    const t = title ? fitText(check, 'params.title', title, {family: 'body', width, preferred: u(54 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null;
    const titleGap = t ? u(28 * k) : 0;
    return {...body, title: t, titleGap, height: r2((t ? t.lines * t.size * 1.15 + titleGap : 0) + body.height)};
  };
  const fitLabels = (width, k, preferred = 46, maxLines = 2) => items.map(item => fitText(check, `params.items[${item.index}].label`, item.label, {family: 'body', width, preferred: Math.max(b.min.key, u(preferred * Math.max(1, k * 0.9))), min: b.min.key, maxLines}));
  const asRow = (width, k) => {
    const gap = u(28 * k), cell = r2((width - gap * (n - 1)) / n);
    const tile = r2(Math.min(u((portrait ? 150 : 160) * k), cell));
    if (tile < u(110)) return null;
    const labels = fitLabels(cell, k);
    const size = Math.min(...labels.map(l => l.size)), lines = Math.max(...labels.map(l => l.lines));
    return withTitle(width, k, {mode: 'row', gap, cell, tile, labelSize: size, labelGap: u(18 * k), height: r2(tile + u(18 * k) + lines * size * 1.2)});
  };
  const asList = (width, k) => {
    const tile = u((portrait ? 104 : 96) * k), gap = u(22 * k), labelGap = u(28), labelW = r2(width - tile - labelGap);
    const labels = fitLabels(labelW, k, 50);
    const size = Math.min(...labels.map(l => l.size));
    const rowH = r2(Math.max(tile, Math.max(...labels.map(l => l.lines)) * size * 1.2));
    return withTitle(width, k, {mode: 'list', gap, tile, labelSize: size, labelGap, labelW, rowH, height: r2(n * rowH + (n - 1) * gap)});
  };
  // pills: capsules in one row when every label fits a line, else a column.
  const pills = (width, k, across) => {
    const h = u(104 * k), dot = r2(h - u(20)), pad = u(10), gap = u((across ? 24 : 20) * k);
    const pillW = across ? r2((width - gap * (n - 1)) / n) : r2(Math.min(width, u(860 * k)));
    const labelW = r2(pillW - dot - pad - u(26) - u(32));
    if (labelW < u(140)) return null;
    const labels = fitLabels(labelW, k, 44, across ? 1 : 2);
    const size = Math.min(...labels.map(l => l.size)), lines = Math.max(...labels.map(l => l.lines));
    const pillH = r2(Math.max(h, lines * size * 1.2 + u(28)));
    return withTitle(width, k, {mode: 'pills', across, gap, pillW, pillH, dot, pad, labelW, labelSize: size, height: r2(across ? pillH : n * pillH + (n - 1) * gap)});
  };
  // orbit: nodes on a ring around a hub; a label sits outside the ring
  // (above a node in the upper half, else below). In 16:9 the title stands
  // to the left of the ring. null when a label would touch a node, another
  // label or the hub.
  const orbit = (width, maxHeight, k) => {
    const beside = !portrait && title;
    const titleW = beside ? r2(width * 0.34) : width;
    const t = title ? fitText(check, 'params.title', title, {family: beside ? 'display' : 'body', width: titleW, preferred: u((beside ? 84 : 54) * Math.max(1, k * 0.9)), min: b.min.key, maxLines: beside ? 4 : 2}) : null;
    const titleGap = u((beside ? 64 : 28) * k), titleH = t && !beside ? r2(t.lines * t.size * 1.15 + titleGap) : 0;
    const ringX = beside ? r2(titleW + titleGap) : 0, ringW = r2(width - ringX);
    const node = u(120 * k), labelGap = u(14);
    const first = -90 + (n % 2 === 0 ? 180 / n : 0);
    const angles = items.map((_, i) => (first + i * 360 / n) * Math.PI / 180);
    const above = angles.map(a => Math.sin(a) < -0.3);
    const attempt = labelW => {
      const labels = fitLabels(labelW, k, 42);
      const size = Math.min(...labels.map(l => l.size)), lh = r2(Math.max(...labels.map(l => l.lines)) * size * 1.2);
      const top = above.some(Boolean) ? lh + labelGap : 0, foot = above.every(Boolean) ? 0 : lh + labelGap;
      const R = r2(Math.min((ringW - Math.max(node, labelW)) / 2, u(portrait ? 300 : 260) * k, (maxHeight - titleH - top - node - foot) / 2));
      if (R < u(130)) return null;
      const cx = r2(ringX + ringW / 2), cy = r2(titleH + top + node / 2 + R);
      const spots = angles.map((a, i) => ({x: r2(cx + R * Math.cos(a)), y: r2(cy + R * Math.sin(a)), above: above[i]}));
      for (const s_ of spots) s_.labelY = r2(s_.above ? s_.y - node / 2 - labelGap - lh : s_.y + node / 2 + labelGap);
      // Labels on the same level share the room between their nodes.
      let room = labelW;
      for (const one of spots) for (const two of spots) if (one !== two && Math.abs(one.labelY - two.labelY) < lh) room = Math.min(room, r2(Math.abs(one.x - two.x) - u(24)));
      if (room < labelW) return {narrower: room};
      const boxes = spots.flatMap(s_ => [{x: s_.x - node / 2, y: s_.y - node / 2, w: node, h: node}, {x: s_.x - labelW / 2, y: s_.labelY, w: labelW, h: lh}]);
      const hub = r2(Math.min(R * 0.42, u(150 * k)));
      boxes.push({x: cx - hub / 2, y: cy - hub / 2, w: hub, h: hub});
      const touch = (one, two) => one.x < two.x + two.w && two.x < one.x + one.w && one.y < two.y + two.h && two.y < one.y + one.h;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (!(i % 2 === 0 && j === i + 1) && touch(boxes[i], boxes[j])) return null;
      const bottom = Math.max(...boxes.map(box_ => box_.y + box_.h), beside ? t.lines * t.size * 1.15 : 0);
      return {mode: 'orbit', title: t, titleGap, titleH, beside, titleW, node, labelW, labelGap, labelSize: size, lh, R, cx, cy, hub, spots, height: r2(bottom)};
    };
    let labelW = u(300 * Math.min(1.2, k));
    for (let tries = 0; tries < 3; tries++) {
      const out = attempt(labelW);
      if (!out?.narrower) return out;
      labelW = out.narrower;
      if (labelW < u(160)) return null;
    }
    return null;
  };
  // list: numbered rows between rules.
  const numbered = (width, k) => {
    const num = u(84 * k), icon = u(64 * k), gap = u(30 * k), padY = u(18 * k), labelW = r2(width - num - icon - gap * 2);
    const labels = fitLabels(labelW, k, 50);
    const size = Math.min(...labels.map(l => l.size));
    const rowH = r2(Math.max(num * 1.05, Math.max(...labels.map(l => l.lines)) * size * 1.2) + padY * 2);
    return withTitle(width, k, {mode: 'numbered', num, icon, gap, padY, labelW, labelSize: size, rowH, rule: u(2), height: r2(n * rowH + u(2) * (n + 1))});
  };
  const original = width => {
    const rows = b.scales.map(k => () => asRow(width, k)), lists = b.scales.map(k => () => asList(width, k));
    return layoutIn === 'row' ? rows : layoutIn === 'list' ? lists : [...rows, ...lists];
  };
  const own = {
    pills: (width) => [...(layoutIn === 'list' ? [] : b.scales.map(k => () => pills(width, k, true))), ...(layoutIn === 'row' ? [] : b.scales.map(k => () => pills(width, k, false)))],
    orbit: (width, maxHeight) => b.scales.map(k => () => orbit(width, maxHeight, k)),
    list: (width) => b.scales.map(k => () => numbered(width, k))
  }[b.variant];
  const measure = (width, maxHeight) => {
    // A variant tries its own shape first; a room too small falls back to tiles.
    const out = pick([...(own ? own(width, maxHeight) : []), ...original(width)], maxHeight);
    if (!out && layoutIn === 'row') check.fail('params.layout', '"row" does not fit: the labels are too long for the width; use "list"');
    // A list in a panel or rect spreads down it rather than bunching at the top.
    if (out?.mode === 'list' && b.fills) return spread(out, maxHeight, {gap: [n - 1, r2(out.rowH * 0.6)], titleGap: [out.title ? 1 : 0, u(64)]});
    if (out?.mode === 'pills' && !out.across && b.fills) return spread(out, maxHeight, {gap: [n - 1, r2(out.pillH * 0.4)], titleGap: [out.title ? 1 : 0, u(64)]});
    return out;
  };
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : b.variant === 'list' ? 1200 : 1400)});
  const first = b.timeOf('item-0', p.at, 'params.at', 0.05);
  const placed = items.map(item => {
    const time = item.at === undefined ? b.timeOf(`item-${item.index}`, undefined, `params.items[${item.index}].at`, first - start + item.index * stagger) : b.timeOf(`item-${item.index}`, item.at, `params.items[${item.index}].at`, 0);
    b.events.push({id: `${id}-item-${item.index}`, name: `item-${item.index}`, time, endTime: rt(time + 0.5), role: 'emphasis', cue: 'pop'});
    return {...item, time};
  });
  const L = box.layout;
  const dot = solidFill(b, 'primary', 3);
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, title, items: placed, color: colors.primary, labelColor: theme.foreground, titleColor: b.titleColor,
    dotFill: dot.fill, dotInk: dot.ink, panel: theme.panel, border: theme.border, ring: `${colors.primary}80`, numberColor: colors.primary, iconMuted: colors.accent},
  {minTextPx: Math.min(L.labelSize, L.title?.size ?? Infinity)});
}

function iconRowView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (ICON_ROW_VIEWS[L.mode]) return ICON_ROW_VIEWS[L.mode](model);
  const rowMode = L.mode === 'row';
  const label = {fontFamily: fonts.body, fontWeight: 600, fontSize: L.labelSize, lineHeight: '1.2', color: c.labelColor};
  const title = c.title ? flowText(null, B.width, {marginBottom: L.titleGap, fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor, textAlign: rowMode ? 'center' : 'left'}, c.title) : null;
  const items = c.items.map(item => rowMode
    ? flow(`${id}-item-${item.index}`, L.cell, undefined, {...hidden, display: 'flex', flexDirection: 'column', alignItems: 'center', transformOrigin: '50% 30%'}, [
      iconTile(null, item.icon, L.tile, c.color, unit),
      flowText(null, L.cell, {...label, marginTop: L.labelGap, textAlign: 'center'}, item.label)
    ])
    : flow(`${id}-item-${item.index}`, B.width, L.rowH, {...hidden, display: 'flex', alignItems: 'center', gap: L.labelGap, transformOrigin: `${r2(L.tile / 2)}px 50%`}, [
      iconTile(null, item.icon, L.tile, c.color, unit),
      flowText(null, L.labelW, label, item.label)
    ]));
  const group = flow(null, B.width, undefined, rowMode ? {display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: L.gap} : {display: 'flex', flexDirection: 'column', gap: L.gap}, items);
  return [column(B.x, B.y, B.width, L.height, [title, group].filter(Boolean), {align: rowMode ? 'center' : 'start'})];
}

const listTitle = (model, align) => {
  const {fonts} = model;
  const c = model.content, L = c.layout, B = model.content.box;
  return c.title ? flowText(null, B.width, {marginBottom: L.titleGap, fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor, textAlign: align}, c.title) : null;
};

const ICON_ROW_VIEWS = {
  pills(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const items = c.items.map(item => flow(`${id}-item-${item.index}`, L.pillW, L.pillH, {...hidden, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: r2(26 * unit), padding: `0 ${r2(32 * unit)}px 0 ${L.pad}px`,
      borderRadius: r2(L.pillH / 2), background: c.panel, border: `${r2(2 * unit)}px solid ${c.border}`}, [
      flow(`${id}-dot-${item.index}`, L.dot, L.dot, {borderRadius: '50%', background: c.dotFill, transformOrigin: '50% 50%'}, [iconNode(item.icon, {x: r2(L.dot * 0.22), y: r2(L.dot * 0.22), size: r2(L.dot * 0.56), color: c.dotInk})]),
      flowText(null, L.labelW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.labelSize, lineHeight: '1.2', color: c.labelColor}, item.label)
    ]));
    const group = flow(null, B.width, undefined, L.across ? {display: 'flex', justifyContent: 'center', gap: L.gap} : {display: 'flex', flexDirection: 'column', alignItems: 'center', gap: L.gap}, items);
    return [column(B.x, B.y, B.width, L.height, [listTitle(model, 'center'), group].filter(Boolean))];
  },
  orbit(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const kids = [];
    if (c.title) {
      kids.push(L.beside
        ? el('div', null, abs(0, 0, L.titleW, L.height, {display: 'flex', alignItems: 'center'}), [flowText(null, L.titleW, {fontFamily: fonts.display, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor}, c.title)])
        : el('div', null, abs(0, 0, B.width, undefined, {margin: 0, whiteSpace: 'normal', fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', color: c.titleColor, textAlign: 'center'}), [c.title]));
    }
    const ring = r2(3 * unit);
    kids.push(el('div', `${id}-ring`, abs(r2(L.cx - L.R), r2(L.cy - L.R), r2(L.R * 2), r2(L.R * 2), {boxSizing: 'border-box', borderRadius: '50%', border: `${ring}px dashed ${c.ring}`, transformOrigin: '50% 50%'})));
    kids.push(el('div', `${id}-hub`, abs(r2(L.cx - L.hub / 2), r2(L.cy - L.hub / 2), L.hub, L.hub, {borderRadius: '50%', background: c.dotFill, boxShadow: `0 0 0 ${r2(L.hub * 0.14)}px ${c.dotFill}33`, transformOrigin: '50% 50%'})));
    c.items.forEach((item, i) => {
      const spot = L.spots[i], half = L.labelW / 2;
      // The node and its label move as one, from the node's centre.
      const top = Math.min(spot.y - L.node / 2, spot.labelY);
      kids.push(el('div', `${id}-item-${item.index}`, abs(r2(spot.x - half), r2(top), L.labelW, r2(L.node + L.labelGap + L.lh), {...hidden, transformOrigin: `50% ${r2(spot.y - top)}px`}), [
        el('div', null, abs(r2(half - L.node / 2), r2(spot.y - L.node / 2 - top), L.node, L.node, {boxSizing: 'border-box', borderRadius: '50%', background: model.theme.bg, border: `${r2(4 * unit)}px solid ${c.color}`}), [
          iconNode(item.icon, {x: r2(L.node * 0.22 - 4 * unit), y: r2(L.node * 0.22 - 4 * unit), size: r2(L.node * 0.56), color: c.color})
        ]),
        el('div', null, abs(0, r2(spot.labelY - top), L.labelW, L.lh, {display: 'flex', alignItems: spot.above ? 'flex-end' : 'flex-start', justifyContent: 'center'}), [
          flowText(null, L.labelW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.labelSize, lineHeight: '1.2', color: c.labelColor, textAlign: 'center'}, item.label)
        ])
      ]));
    });
    return [el('div', null, abs(B.x, B.y, B.width, L.height), kids)];
  },
  numbered(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const rule = i => flow(`${id}-rule-${i}`, B.width, L.rule, {background: c.border, transformOrigin: '0% 50%', transform: 'scale(0, 1)'}, []);
    const rows = [rule(0)];
    c.items.forEach((item, i) => {
      rows.push(flow(`${id}-item-${item.index}`, B.width, L.rowH, {...hidden, display: 'flex', alignItems: 'center', gap: L.gap}, [
        flowText(null, L.num, {fontFamily: fonts.display, fontSize: r2(L.num * 0.86), lineHeight: '1', color: c.numberColor, whiteSpace: 'nowrap'}, String(i + 1).padStart(2, '0')),
        flowText(null, L.labelW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.labelSize, lineHeight: '1.2', color: c.labelColor}, item.label),
        flow(null, L.icon, L.icon, {}, [iconNode(item.icon, {size: L.icon, color: c.iconMuted})])
      ]));
      rows.push(rule(i + 1));
    });
    return [column(B.x, B.y, B.width, L.height, [listTitle(model, 'left'), ...rows].filter(Boolean), {align: 'start'})];
  }
};

function iconRowTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, mode = c.layout.mode;
  if (mode === 'pills') {
    for (const item of c.items) {
      const target = `${id}-item-${item.index}`, dx = r2((c.layout.across ? 0 : -50) * unit), dy = r2((c.layout.across ? 30 : 0) * unit);
      set(ops, target, start, {opacity: 0, x: dx, y: dy});
      tw(ops, target, item.time, 0.45, 'power3.out', {opacity: 0, x: dx, y: dy}, {opacity: 1, x: 0, y: 0});
      pop(ops, model, `${id}-dot-${item.index}`, rt(item.time + 0.12), {scale: 0.3});
    }
    return;
  }
  if (mode === 'orbit') {
    const L = c.layout, first = c.items[0].time;
    const lead = rt(Math.max(start, first - 0.2));
    set(ops, `${id}-ring`, start, {opacity: 0, scaleX: 0.6, scaleY: 0.6, rotation: -40});
    tw(ops, `${id}-ring`, lead, 0.7, 'power3.out', {opacity: 0, scaleX: 0.6, scaleY: 0.6, rotation: -40}, {opacity: 1, scaleX: 1, scaleY: 1, rotation: 0});
    pop(ops, model, `${id}-hub`, lead, {scale: 0.2, duration: 0.55});
    c.items.forEach((item, i) => {
      // Each node flies out from the hub to its place on the ring.
      const dx = r2(L.cx - L.spots[i].x), dy = r2(L.cy - L.spots[i].y);
      set(ops, `${id}-item-${item.index}`, start, {opacity: 0, x: dx, y: dy, scaleX: 0.4, scaleY: 0.4});
      tw(ops, `${id}-item-${item.index}`, item.time, 0.6, 'back.out(1.4)', {opacity: 0, x: dx, y: dy, scaleX: 0.4, scaleY: 0.4}, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1});
    });
    return;
  }
  if (mode === 'numbered') {
    const lead = rt(Math.max(start, c.items[0].time - 0.15));
    for (let i = 0; i <= c.items.length; i++) {
      set(ops, `${id}-rule-${i}`, start, {scaleX: 0, scaleY: 1});
      tw(ops, `${id}-rule-${i}`, i ? c.items[i - 1].time : lead, 0.5, 'power2.out', {scaleX: 0}, {scaleX: 1});
    }
    for (const item of c.items) {
      set(ops, `${id}-item-${item.index}`, start, {opacity: 0, x: r2(-36 * unit), y: 0});
      tw(ops, `${id}-item-${item.index}`, item.time, 0.45, 'power3.out', {opacity: 0, x: r2(-36 * unit)}, {opacity: 1, x: 0});
    }
    return;
  }
  for (const item of c.items) pop(ops, model, `${id}-item-${item.index}`, item.time, {scale: 0.7});
}

export const iconRow = {
  id: 'icon-row',
  describe: 'Two to five icons from the icon set, each with a short label, that pop in one by one on their words: a row, or a list when the labels are long or the room is narrow. For lists of features, steps or audiences.',
  params: {items: '[{icon: icon name, label ≤ 24, at?}] 2–5', title: 'string ≤ 48 (optional)', layout: 'auto (default) | row | list', stagger: 'seconds between pops (default 0.18)', at: 'first pop time', ...CARD_PARAMS},
  events: ['item-<i>'],
  timing: cardTiming(['items pop in order; with no at, the first pops at 0.05 s and the rest follow by stagger (default 0.18 s)']),
  mood: ['editorial', 'launch', 'playful'],
  variants: ICON_ROW_VARIANTS,
  resolve: resolveIconRow, view: iconRowView, timeline: iconRowTimeline
};

// ---------------------------------------------------------------------------
// section-card: the brand frame's kicker and a section title.

// Variants: centered (head, kicker, a rule that draws and the title, the
// original), split (a big chapter number beside a rule, the text set left),
// tab (the kicker and number on a solid tab, the title rising line by line
// over a drawn rule) and frame (corner brackets around the kicker and title,
// the number on a disc at the foot).
export const SECTION_VARIANTS = Object.freeze(['centered', 'split', 'tab', 'frame']);

function resolveSection(params, ctx) {
  const b = createCardBase('section-card', params, ctx, {allowed: ['title', 'kicker', 'number', 'icon', 'at'], required: ['title'], variants: SECTION_VARIANTS});
  const {check, u, portrait, colors, theme} = b;
  const p = b.params;
  const title = check.str(p.title, 'params.title', 48);
  const kicker = p.kicker === undefined ? null : check.str(p.kicker, 'params.kicker', 28).toUpperCase();
  const number = p.number === undefined ? null : check.int(p.number, 'params.number', 1, 99);
  const glyph = iconParam(check, p.icon, 'params.icon');
  if (number !== null && glyph) check.fail('params.icon', 'cannot be used with params.number; pick one');
  const kickerColor = b.resolveColor('primary', 'kicker colour (brand.colors.primary)', 'primary');
  const numberText = number === null ? null : String(number).padStart(2, '0');
  const fitKick = (width, k) => (kicker ? fitText(check, 'params.kicker', kicker, {family: 'meta', width, preferred: u(34 * Math.max(1, k * 0.9)), min: b.min.meta, maxLines: 1}) : null);
  const centered = (width, k) => {
    const head = number !== null ? u((portrait ? 190 : 170) * k) : glyph ? u((portrait ? 140 : 120) * k) : 0;
    const kick = fitKick(width, k);
    const t = fitText(check, 'params.title', title, {family: 'display', width, preferred: u((portrait ? 124 : 120) * k), min: u(64), maxLines: 3});
    const headGap = u(18 * k), kickGap = u(20 * k), rule = u(8), ruleGap = u(30 * k);
    const height = r2(head + (head ? headGap : 0) + (kick ? kick.size * 1.3 + kickGap : 0) + rule + ruleGap + t.lines * t.size * 1.04);
    return {mode: 'centered', head, headGap, kick, kickGap, title: t, rule, ruleGap, height};
  };
  // split: the number (or icon, or a bar) | a rule | kicker and title.
  const split = (width, k) => {
    const lead = number !== null ? u((portrait ? 210 : 300) * k) : glyph ? u((portrait ? 150 : 200) * k) : 0;
    const gap = u(40 * k), rule = u(6), textW = r2(width - lead - (lead ? gap * 2 + rule : 0));
    if (textW < u(320)) return null;
    const kick = fitKick(textW, k), kickGap = u(18 * k);
    const t = fitText(check, 'params.title', title, {family: 'display', width: textW, preferred: u((portrait ? 104 : 116) * k), min: u(64), maxLines: 3});
    const textH = r2((kick ? kick.size * 1.3 + kickGap : 0) + t.lines * t.size * 1.04);
    const numberSize = number !== null ? r2(Math.min(lead / 1.25, u(260 * k))) : 0;
    return {mode: 'split', lead, gap, rule, textW, kick, kickGap, title: t, textH, numberSize, height: r2(Math.max(textH, number !== null ? numberSize * 1.05 : lead))};
  };
  // tab: a solid tab (number · kicker, or the icon), then the title.
  const tab = (width, k) => {
    const label = [numberText, kicker].filter(Boolean).join('  ·  ');
    const pad = u(18 * k), padX = u(26 * k);
    const kick = label ? fitText(check, 'params.kicker', label, {family: 'meta', width: r2(width - padX * 2 - (glyph ? u(60 * k) : 0)), preferred: u(32 * Math.max(1, k * 0.9)), min: b.min.meta, maxLines: 1}) : null;
    const tabH = kick || glyph ? r2(Math.max(kick ? kick.size * 1.3 : 0, glyph ? u(48 * k) : 0) + pad * 2) : 0;
    const t = fitText(check, 'params.title', title, {family: 'display', width, preferred: u((portrait ? 130 : 132) * k), min: u(64), maxLines: 3});
    const tabGap = u(34 * k), ruleGap = u(36 * k), rule = u(4);
    return {mode: 'tab', label, pad, padX, kick, tabH, tabGap, title: t, ruleGap, rule, height: r2(tabH + (tabH ? tabGap : 0) + t.lines * t.size * 1.06 + ruleGap + rule)};
  };
  // frame: corner brackets around the kicker and title; the number (or
  // icon) on a disc over the foot.
  const frame = (width, k) => {
    const pad = u(60 * k), corner = u(64 * k), inner = r2(width - pad * 2);
    const kick = fitKick(inner, k), kickGap = u(22 * k);
    const t = fitText(check, 'params.title', title, {family: 'display', width: inner, preferred: u((portrait ? 116 : 116) * k), min: u(64), maxLines: 3});
    const disc = number !== null || glyph ? u(110 * k) : 0;
    const frameH = r2(pad * 2 + (kick ? kick.size * 1.3 + kickGap : 0) + t.lines * t.size * 1.04 + disc * 0.3);
    return {mode: 'frame', pad, corner, inner, kick, kickGap, title: t, disc, frameH, height: r2(frameH + disc / 2)};
  };
  const shaped = {split, tab, frame}[b.variant];
  const measure = (width, maxHeight) => pick([...(shaped ? b.scales.map(k => () => shaped(width, k)) : []), ...b.scales.map(k => () => centered(width, k))], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : b.variant === 'centered' ? 1300 : 1400)});
  const t0 = b.timeOf('title', p.at, 'params.at', 0.25);
  const kickAt = rt(Math.max(b.start, t0 - 0.25));
  b.events.push({id: `${b.id}-kicker`, name: 'kicker', time: kickAt, endTime: rt(kickAt + 0.45), role: 'detail'});
  b.events.push({id: `${b.id}-title`, name: 'title', time: t0, endTime: rt(t0 + 0.5), role: 'title', cue: 'whoosh'});
  const L = box.layout;
  const solid = solidFill(b, 'primary', 4.5);
  const content = {box: {x: box.x, y: box.y, width: box.width}, layout: L, title, kicker, number: numberText, icon: glyph,
    kickerColor, ruleColor: colors.primary, titleColor: theme.foreground, numberColor: colors.primary, t0, kickAt};
  if (L.mode === 'tab') Object.assign(content, {tabFill: solid.fill, tabInk: solid.ink, lines: wrapWords(title, L.title.size, 'display', box.width), ruleColor: theme.border});
  if (L.mode === 'frame') Object.assign(content, {discFill: solid.fill, discInk: solid.ink});
  return b.finish(content, {minTextPx: L.title.size});
}

function sectionView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  if (SECTION_VIEWS[L.mode]) return SECTION_VIEWS[L.mode](model);
  const ruleW = r2(Math.min(B.width * 0.3, 160 * unit));
  const kids = [];
  if (c.number) kids.push(flowText(`${id}-head`, B.width, {...hidden, marginBottom: L.headGap, fontFamily: fonts.display, fontSize: L.head, lineHeight: '1', color: c.numberColor, textAlign: 'center', transformOrigin: '50% 50%'}, c.number));
  if (c.icon) kids.push(flow(`${id}-head`, L.head, L.head, {...hidden, marginBottom: L.headGap, transformOrigin: '50% 50%'}, [iconNode(c.icon, {size: L.head, color: c.numberColor})]));
  if (c.kicker) kids.push(flowText(`${id}-kicker`, B.width, {...hidden, marginBottom: L.kickGap, fontFamily: fonts.meta, fontSize: L.kick.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.kickerColor, textAlign: 'center'}, c.kicker));
  kids.push(flow(`${id}-rule`, ruleW, L.rule, {marginBottom: L.ruleGap, borderRadius: L.rule, background: c.ruleColor, transformOrigin: '50% 50%', transform: 'scale(0, 1)'}, []));
  kids.push(flowText(`${id}-title`, B.width, {...hidden, fontFamily: fonts.display, fontSize: L.title.size, lineHeight: '1.04', color: c.titleColor, textAlign: 'center'}, c.title));
  return [column(B.x, B.y, B.width, L.height, kids)];
}

const SECTION_VIEWS = {
  split(model) {
    const {id, fonts} = model;
    const c = model.content, L = c.layout, B = c.box;
    const text = flow(null, L.textW, undefined, {display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}, [
      c.kicker ? flowText(`${id}-kicker`, L.textW, {...hidden, marginBottom: L.kickGap, fontFamily: fonts.meta, fontSize: L.kick.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.kickerColor}, c.kicker) : null,
      flowText(`${id}-title`, L.textW, {...hidden, fontFamily: fonts.display, fontSize: L.title.size, lineHeight: '1.04', color: c.titleColor}, c.title)
    ].filter(Boolean));
    if (!L.lead) return [row(B.x, B.y, B.width, L.height, [text])];
    const head = c.number
      ? flowText(`${id}-head`, L.lead, {...hidden, fontFamily: fonts.display, fontSize: L.numberSize, lineHeight: '1', color: c.numberColor, textAlign: 'right', whiteSpace: 'nowrap', transformOrigin: '100% 50%'}, c.number)
      : flow(`${id}-head`, L.lead, L.lead, {...hidden, transformOrigin: '50% 50%'}, [iconNode(c.icon, {size: L.lead, color: c.numberColor})]);
    const rule = flow(`${id}-rule`, L.rule, r2(L.height * 0.9), {borderRadius: L.rule, background: c.ruleColor, transformOrigin: '50% 50%', transform: 'scale(1, 0)'}, []);
    return [row(B.x, B.y, B.width, L.height, [head, rule, text], {gap: L.gap})];
  },
  tab(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const kids = [];
    if (L.tabH) {
      kids.push(flow(`${id}-kicker`, undefined, L.tabH, {...hidden, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: r2(14 * unit), padding: `0 ${L.padX}px`, marginBottom: L.tabGap,
        borderRadius: r2(10 * unit), background: c.tabFill, transformOrigin: '0% 100%'}, [
        c.icon ? flow(null, r2(48 * unit), r2(48 * unit), {}, [iconNode(c.icon, {size: r2(48 * unit), color: c.tabInk})]) : null,
        L.kick ? el('div', null, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.meta, fontSize: L.kick.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.tabInk}, [L.label]) : null
      ].filter(Boolean)));
    }
    kids.push(flow(null, B.width, undefined, {fontFamily: fonts.display, fontSize: L.title.size, lineHeight: '1.06', color: c.titleColor}, c.lines.map((line, i) =>
      el('div', `${id}-line-${i}`, {...hidden, position: 'relative', margin: 0, whiteSpace: 'nowrap'}, [line]))));
    kids.push(flow(`${id}-rule`, B.width, L.rule, {marginTop: L.ruleGap, background: c.ruleColor, transformOrigin: '0% 50%', transform: 'scale(0, 1)'}, []));
    return [column(B.x, B.y, B.width, L.height, kids, {align: 'start'})];
  },
  frame(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const edge = r2(5 * unit), k = L.corner;
    const corner = (name, x, y, sides) => el('div', `${id}-corner-${name}`, abs(x, y, k, k, {boxSizing: 'border-box', ...Object.fromEntries(sides.map(side => [`border${side}`, `${edge}px solid ${c.ruleColor}`])),
      transformOrigin: `${x ? '100%' : '0%'} ${y ? '100%' : '0%'}`}));
    const right = r2(B.width - k), bottom = r2(L.frameH - k);
    const kids = [
      corner('tl', 0, 0, ['Top', 'Left']), corner('tr', right, 0, ['Top', 'Right']), corner('bl', 0, bottom, ['Bottom', 'Left']), corner('br', right, bottom, ['Bottom', 'Right']),
      el('div', null, abs(L.pad, 0, L.inner, r2(L.frameH - L.disc * 0.3), {display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}), [
        c.kicker ? flowText(`${id}-kicker`, L.inner, {...hidden, marginBottom: L.kickGap, fontFamily: fonts.meta, fontSize: L.kick.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.kickerColor, textAlign: 'center'}, c.kicker) : null,
        flowText(`${id}-title`, L.inner, {...hidden, fontFamily: fonts.display, fontSize: L.title.size, lineHeight: '1.04', color: c.titleColor, textAlign: 'center', transformOrigin: '50% 50%'}, c.title)
      ].filter(Boolean))
    ];
    if (L.disc) {
      const g = r2(L.disc * 0.5);
      kids.push(el('div', `${id}-head`, abs(r2((B.width - L.disc) / 2), r2(L.frameH - L.disc / 2), L.disc, L.disc, {...hidden, borderRadius: '50%', background: c.discFill, display: 'flex', alignItems: 'center', justifyContent: 'center', transformOrigin: '50% 50%'}), [
        c.number ? el('div', null, {margin: 0, fontFamily: fonts.display, fontSize: r2(L.disc * 0.46), lineHeight: '1', color: c.discInk}, [c.number]) : iconNode(c.icon, {x: r2((L.disc - g) / 2), y: r2((L.disc - g) / 2), size: g, color: c.discInk})
      ]));
    }
    return [el('div', null, abs(B.x, B.y, B.width, L.height), kids)];
  }
};

function sectionTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, mode = c.layout.mode;
  if (mode === 'split') {
    if (c.layout.lead) {
      set(ops, `${id}-head`, start, {opacity: 0, x: 0, y: r2(80 * unit)});
      tw(ops, `${id}-head`, c.kickAt, 0.6, 'power4.out', {opacity: 0, y: r2(80 * unit)}, {opacity: 1, y: 0});
      set(ops, `${id}-rule`, start, {scaleX: 1, scaleY: 0});
      tw(ops, `${id}-rule`, c.kickAt, 0.55, 'power3.out', {scaleY: 0}, {scaleY: 1});
    }
    if (c.kicker) rise(ops, model, `${id}-kicker`, c.kickAt, {distance: 14});
    set(ops, `${id}-title`, start, {opacity: 0, x: r2(48 * unit), y: 0});
    tw(ops, `${id}-title`, c.t0, 0.55, 'power3.out', {opacity: 0, x: r2(48 * unit)}, {opacity: 1, x: 0});
    return;
  }
  if (mode === 'tab') {
    if (c.layout.tabH) {
      set(ops, `${id}-kicker`, start, {opacity: 0, x: 0, y: r2(-24 * unit), scaleX: 1, scaleY: 0.4});
      tw(ops, `${id}-kicker`, c.kickAt, 0.45, 'back.out(1.6)', {opacity: 0, y: r2(-24 * unit), scaleY: 0.4}, {opacity: 1, y: 0, scaleY: 1});
    }
    c.lines.forEach((_, i) => rise(ops, model, `${id}-line-${i}`, rt(c.t0 + i * 0.1), {distance: 50, duration: 0.55}));
    set(ops, `${id}-rule`, start, {scaleX: 0, scaleY: 1});
    tw(ops, `${id}-rule`, rt(c.t0 + 0.15), 0.7, 'power3.inOut', {scaleX: 0}, {scaleX: 1});
    return;
  }
  if (mode === 'frame') {
    for (const name of ['tl', 'tr', 'bl', 'br']) {
      set(ops, `${id}-corner-${name}`, start, {opacity: 0, scaleX: 2.2, scaleY: 2.2});
      tw(ops, `${id}-corner-${name}`, c.kickAt, 0.5, 'power3.out', {opacity: 0, scaleX: 2.2, scaleY: 2.2}, {opacity: 1, scaleX: 1, scaleY: 1});
    }
    if (c.kicker) rise(ops, model, `${id}-kicker`, c.kickAt, {distance: 14});
    set(ops, `${id}-title`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.92, scaleY: 0.92});
    tw(ops, `${id}-title`, c.t0, 0.55, 'power3.out', {opacity: 0, scaleX: 0.92, scaleY: 0.92}, {opacity: 1, scaleX: 1, scaleY: 1});
    if (c.layout.disc) pop(ops, model, `${id}-head`, rt(c.t0 + 0.2), {scale: 0.3});
    return;
  }
  if (c.number || c.icon) pop(ops, model, `${id}-head`, c.kickAt, {scale: 0.75});
  if (c.kicker) rise(ops, model, `${id}-kicker`, c.kickAt, {distance: 14});
  set(ops, `${id}-rule`, start, {scaleX: 0, scaleY: 1});
  tw(ops, `${id}-rule`, c.kickAt, 0.55, 'power3.out', {scaleX: 0}, {scaleX: 1});
  rise(ops, model, `${id}-title`, c.t0, {distance: 34, duration: 0.5});
}

export const sectionCard = {
  id: 'section-card',
  describe: 'A section opener in the brand frame: a kicker ("Part 2", "The fix"), a rule that draws out and a big section title, with an optional chapter number or icon. For the start of each section of a longer video.',
  params: {title: 'section title ≤ 48', kicker: 'string ≤ 28 (optional, uppercased)', number: 'chapter number 1–99 (optional)', icon: 'icon name (optional; not with number)', at: 'title time', ...CARD_PARAMS},
  events: ['kicker', 'title'],
  timing: cardTiming(['the kicker and rule land up to 0.25 s before the title (with no at, at 0.25 s)']),
  mood: ['editorial', 'launch', 'cinematic'],
  variants: SECTION_VARIANTS,
  resolve: resolveSection, view: sectionView, timeline: sectionTimeline
};

// ---------------------------------------------------------------------------
// object-card: a simple illustrated object composed from the icon set and
// brand shapes, with a caption. Objects are drawn in a 240-unit stage.
//
// Shapes: disc {cx, cy, r, tone, alpha}, panel {x, y, w, h, r, tone, alpha},
// ground {cx, cy, rx, ry}, waves {y, tone}, rays {cx, cy, r, tone}. The hero
// is one icon; accents are small icons that pop in after it.

const disc = (tone = 'primary', alpha = 0.16) => ({shape: 'disc', cx: 120, cy: 120, r: 104, tone, alpha});
export const OBJECTS = Object.freeze({
  boat: {shapes: [disc('accent', 0.14), {shape: 'disc', cx: 178, cy: 66, r: 20, tone: 'primary', alpha: 0.9}, {shape: 'waves', y: 186, tone: 'accent'}], hero: {icon: 'boat', x: 50, y: 42, size: 140}, accents: []},
  box: {shapes: [disc(), {shape: 'ground', cx: 120, cy: 206, rx: 74, ry: 12}], hero: {icon: 'box', x: 45, y: 38, size: 150}, accents: [{icon: 'sparkle', x: 22, y: 34, size: 46, tone: 'accent'}, {icon: 'star', x: 182, y: 58, size: 36, tone: 'paper'}]},
  calendar: {shapes: [{shape: 'panel', x: 34, y: 38, w: 172, h: 172, r: 30, tone: 'primary', alpha: 0.14}], hero: {icon: 'calendar-check', x: 50, y: 48, size: 140}, accents: [{icon: 'clock', x: 172, y: 168, size: 50, tone: 'accent'}]},
  laptop: {shapes: [disc(), {shape: 'ground', cx: 120, cy: 196, rx: 90, ry: 10}], hero: {icon: 'laptop', x: 40, y: 34, size: 160}, accents: [{icon: 'code', x: 18, y: 24, size: 48, tone: 'accent'}, {icon: 'chart-bar', x: 178, y: 20, size: 44, tone: 'paper'}]},
  rocket: {shapes: [disc('accent', 0.14), {shape: 'rays', cx: 120, cy: 214, r: 26, tone: 'primary'}], hero: {icon: 'rocket', x: 45, y: 30, size: 150}, accents: [{icon: 'sparkle', x: 186, y: 40, size: 38, tone: 'paper'}, {icon: 'star', x: 24, y: 70, size: 30, tone: 'primary'}]},
  smartphone: {shapes: [disc()], hero: {icon: 'smartphone', x: 45, y: 45, size: 150}, accents: [{icon: 'bell', x: 170, y: 28, size: 46, tone: 'accent'}, {icon: 'heart', x: 22, y: 150, size: 42, tone: 'paper'}]},
  chart: {shapes: [{shape: 'panel', x: 30, y: 40, w: 180, h: 160, r: 26, tone: 'primary', alpha: 0.14}], hero: {icon: 'chart-up', x: 50, y: 50, size: 140}, accents: [{icon: 'arrow-up-right', x: 176, y: 18, size: 48, tone: 'accent'}]},
  shield: {shapes: [disc()], hero: {icon: 'shield-check', x: 40, y: 40, size: 160}, accents: [{icon: 'lock', x: 178, y: 160, size: 44, tone: 'accent'}, {icon: 'sparkle', x: 24, y: 36, size: 38, tone: 'paper'}]},
  mail: {shapes: [disc('accent', 0.14)], hero: {icon: 'mail', x: 45, y: 45, size: 150}, accents: [{icon: 'send', x: 172, y: 22, size: 48, tone: 'primary'}]},
  trophy: {shapes: [disc(), {shape: 'rays', cx: 120, cy: 120, r: 112, tone: 'primary'}], hero: {icon: 'trophy', x: 45, y: 42, size: 150}, accents: [{icon: 'star', x: 26, y: 40, size: 34, tone: 'accent'}, {icon: 'sparkle', x: 180, y: 54, size: 36, tone: 'paper'}]},
  lightbulb: {shapes: [disc('primary', 0.18), {shape: 'rays', cx: 120, cy: 108, r: 112, tone: 'primary'}], hero: {icon: 'lightbulb', x: 45, y: 38, size: 150}, accents: [{icon: 'sparkle', x: 182, y: 40, size: 36, tone: 'accent'}]},
  globe: {shapes: [disc('accent', 0.14)], hero: {icon: 'globe', x: 45, y: 45, size: 150}, accents: [{icon: 'pin', x: 160, y: 24, size: 52, tone: 'primary'}, {icon: 'plane', x: 18, y: 160, size: 44, tone: 'paper'}]},
  team: {shapes: [disc()], hero: {icon: 'users', x: 45, y: 45, size: 150}, accents: [{icon: 'heart', x: 176, y: 30, size: 42, tone: 'accent'}, {icon: 'sparkle', x: 26, y: 40, size: 34, tone: 'paper'}]},
  gift: {shapes: [disc('accent', 0.14), {shape: 'ground', cx: 120, cy: 204, rx: 70, ry: 11}], hero: {icon: 'gift', x: 48, y: 40, size: 144}, accents: [{icon: 'sparkle', x: 178, y: 30, size: 44, tone: 'primary'}, {icon: 'star', x: 24, y: 64, size: 30, tone: 'paper'}]}
});
const STAGE = 240;

function shapeNode(shape, colors) {
  const fill = (tone, alpha) => `${colors[tone]}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
  if (shape.shape === 'disc') return el('circle', null, null, [], {cx: shape.cx, cy: shape.cy, r: shape.r, fill: fill(shape.tone, shape.alpha)});
  if (shape.shape === 'panel') return el('rect', null, null, [], {x: shape.x, y: shape.y, width: shape.w, height: shape.h, rx: shape.r, fill: fill(shape.tone, shape.alpha)});
  if (shape.shape === 'ground') return el('path', null, null, [], {d: `M${shape.cx - shape.rx} ${shape.cy} a${shape.rx} ${shape.ry} 0 1 0 ${shape.rx * 2} 0 a${shape.rx} ${shape.ry} 0 1 0 ${-shape.rx * 2} 0`, fill: '#00000059'});
  if (shape.shape === 'waves') {
    const wave = y => `M28 ${y} q16 -10 32 0 t32 0 t32 0 t32 0 t32 0 t32 0`;
    return el('path', null, null, [], {d: `${wave(shape.y)} ${wave(shape.y + 18)}`, stroke: colors[shape.tone], strokeWidth: 5, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'});
  }
  if (shape.shape === 'rays') {
    const d = Array.from({length: 12}, (_, i) => {
      const a = (i * 30 - 90) * Math.PI / 180, r0 = shape.r * 0.86, r1 = shape.r;
      return `M${r2(shape.cx + r0 * Math.cos(a))} ${r2(shape.cy + r0 * Math.sin(a))} L${r2(shape.cx + r1 * Math.cos(a))} ${r2(shape.cy + r1 * Math.sin(a))}`;
    }).join(' ');
    return el('path', null, null, [], {d, stroke: colors[shape.tone], strokeOpacity: 0.55, strokeWidth: 5, strokeLinecap: 'round', fill: 'none'});
  }
  throw new Error(`unknown object shape ${shape.shape}`);
}

function resolveObject(params, ctx) {
  const b = createCardBase('object-card', params, ctx, {allowed: ['object', 'caption', 'label', 'at'], required: ['object', 'caption']});
  const {check, u, portrait, colors, theme} = b;
  const p = b.params;
  const name = check.oneOf(p.object, 'params.object', Object.keys(OBJECTS));
  const caption = check.str(p.caption, 'params.caption', 48);
  const label = p.label === undefined ? null : check.str(p.label, 'params.label', 24).toUpperCase();
  const labelColor = b.resolveColor('primary', 'label colour (brand.colors.primary)', 'primary');
  const fitCaption = (w, k) => fitText(check, 'params.caption', caption, {family: 'body', width: w, preferred: u(56 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2});
  const fitLabel = (w, k) => (label ? fitText(check, 'params.label', label, {family: 'meta', width: w, preferred: u(32 * Math.max(1, k * 0.9)), min: b.min.meta, maxLines: 1}) : null);
  const textHeight = (cap, lab, labelGap) => r2(cap.lines * cap.size * 1.2 + (lab ? lab.size * 1.3 + labelGap : 0));
  const stack = (width, k) => {
    const cap = fitCaption(width, k), lab = fitLabel(width, k), labelGap = u(12);
    const stage = r2(Math.min(u((portrait ? 420 : 400) * k), width)), gap = u(26 * k);
    return {mode: 'stack', stage, caption: cap, label: lab, labelGap, gap, textW: width, height: r2(stage + gap + textHeight(cap, lab, labelGap))};
  };
  // Beside the presenter with little height: the object sits left of the text.
  const inline = (width, maxHeight) => {
    const stage = r2(Math.max(u(220), Math.min(maxHeight, u(320)))), gap = u(32), textW = r2(width - stage - gap), labelGap = u(12);
    const cap = fitCaption(textW, 1), lab = fitLabel(textW, 1);
    return {mode: 'inline', stage, caption: cap, label: lab, labelGap, gap, textW, height: r2(Math.max(stage, textHeight(cap, lab, labelGap)))};
  };
  const measure = (width, maxHeight) => pick([...b.scales.map(k => () => stack(width, k)), () => inline(width, maxHeight)], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : 1200)});
  const t0 = b.timeOf('object', p.at, 'params.at', 0.05);
  const object = OBJECTS[name];
  const accents = object.accents.map((accent, i) => ({...accent, index: i, time: after(b, t0, 0.35 + i * 0.12)}));
  const captionAt = after(b, t0, 0.25);
  b.events.push({id: `${b.id}-object`, name: 'object', time: t0, endTime: rt(t0 + 0.55), role: 'emphasis', cue: 'pop'});
  b.events.push({id: `${b.id}-caption`, name: 'caption', time: captionAt, endTime: rt(captionAt + 0.45), role: 'title'});
  const L = box.layout;
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, object: name, shapes: object.shapes, hero: object.hero, accents, caption, label,
    colors: {primary: colors.primary, accent: colors.accent, paper: colors.paper}, captionColor: theme.foreground, labelColor, t0, captionAt}, {minTextPx: L.caption.size});
}

/** The illustration: brand shapes, the hero icon and its accents, in a box of `size` px. */
function objectStage(model, size) {
  const {id} = model;
  const c = model.content;
  const k = size / STAGE;
  const box = (key, item, style, kids) => el('div', key, abs(r2(item.x * k), r2(item.y * k), r2(item.size * k), r2(item.size * k), {...hidden, transformOrigin: '50% 50%', ...style}), kids);
  return flow(null, size, size, {}, [
    el('div', `${id}-stage`, abs(0, 0, size, size, {...hidden, transformOrigin: '50% 50%'}), [
      el('svg', null, abs(0, 0, size, size, {overflow: 'visible'}), c.shapes.map(shape => shapeNode(shape, c.colors)), {width: size, height: size, viewBox: `0 0 ${STAGE} ${STAGE}`, fill: 'none'})
    ]),
    box(`${id}-hero`, c.hero, {transformOrigin: '50% 60%'}, [iconNode(c.hero.icon, {size: r2(c.hero.size * k), color: c.colors.primary, stroke: ICON_STROKE})]),
    ...c.accents.map(accent => box(`${id}-accent-${accent.index}`, accent, {}, [iconNode(accent.icon, {size: r2(accent.size * k), color: c.colors[accent.tone], stroke: ICON_STROKE * 1.1})]))
  ]);
}

function objectView(model) {
  const {id, fonts} = model;
  const c = model.content, L = c.layout, B = c.box;
  const stacked = L.mode === 'stack';
  const align = stacked ? 'center' : 'left';
  const text = flow(`${id}-text`, L.textW, undefined, {...hidden, display: 'flex', flexDirection: 'column', gap: L.labelGap, ...(stacked ? {marginTop: L.gap} : {})}, [
    c.label ? flowText(null, L.textW, {fontFamily: fonts.meta, fontSize: L.label.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.labelColor, textAlign: align}, c.label) : null,
    flowText(null, L.textW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.caption.size, lineHeight: '1.2', color: c.captionColor, textAlign: align}, c.caption)
  ].filter(Boolean));
  return [stacked ? column(B.x, B.y, B.width, L.height, [objectStage(model, L.stage), text]) : row(B.x, B.y, B.width, L.height, [objectStage(model, L.stage), text], {gap: L.gap})];
}

function objectTimeline(model, ops) {
  const {id} = model;
  const c = model.content;
  pop(ops, model, `${id}-stage`, c.t0, {scale: 0.7});
  pop(ops, model, `${id}-hero`, rt(c.t0 + 0.1), {scale: 0.5, duration: 0.6});
  bob(ops, `${id}-hero`, rt(c.t0 + 0.7), model.motion.exitStart, r2(6 * model.unit));
  for (const accent of c.accents) pop(ops, model, `${id}-accent-${accent.index}`, accent.time, {scale: 0.3});
  rise(ops, model, `${id}-text`, c.captionAt);
}

export const objectCard = {
  id: 'object-card',
  describe: `A simple illustrated object built from the icon set and brand shapes (${Object.keys(OBJECTS).join(', ')}), with a caption and an optional label. For naming a product, a deliverable or an idea as a thing ("it ships in a box", "your calendar, handled").`,
  params: {object: Object.keys(OBJECTS).join(' | '), caption: 'string ≤ 48', label: 'string ≤ 24 (optional, uppercased)', at: 'object time', ...CARD_PARAMS},
  events: ['object', 'caption'],
  timing: cardTiming(['with no at, the object pops at 0.05 s; the caption follows it by 0.25 s and accents pop from 0.35 s after it']),
  mood: ['playful', 'launch', 'editorial'],
  resolve: resolveObject, view: objectView, timeline: objectTimeline
};
