// Catalogue G looks beyond the box: the concept-card and icon-row variants
// that drop the filled card (docs/KIT_CONTRACTS.md, "Module variants").
// concept-card: free (type straight on the footage, an accent rule hugging
// the word's widest line), scrim (centred type on a soft pool of the brand
// background), glass (a frosted plate), sticker (a tilted paper note under a
// strip of tape). icon-row: chips (outline capsules that wrap), ticks (free
// display type with a tick or the item's icon), glass (rows on a frosted
// plate), tags (paper tags stacked askew).
//
// Each look has a measure(width, k) → layout (mode = the variant name), a
// view and a timeline, and breathes once in (fluid-motion.mjs idleOps on an
// `-idle` node), so it never sits still on a cutaway. The card surface never
// draws under a look: the look is its own surface (catalog-g-cards.mjs sets
// the model's surface to plate).

import {contrastRatio, fitText, r2, rt, textWidth} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {flow, flowText, inkOn, pop, rise} from './catalog-g-base.mjs';
import {idleAmplitude, idleFor, idleOps} from './fluid-motion.mjs';
import {iconNode} from './icons.mjs';

export const CONCEPT_LOOKS = Object.freeze(['free', 'scrim', 'glass', 'sticker']);
export const ICON_ROW_LOOKS = Object.freeze(['chips', 'ticks', 'glass', 'tags']);

const hidden = {opacity: 0};
const STICKER_TILT = -3;
const TAG_TILTS = [-4, 3, -2, 4, -3];
const shade = u => `0 ${r2(2 * u)}px ${r2(22 * u)}px #00000073`;
// Lines a look draws one block each (fitText's own wrap), so a rule or a
// shrink-wrapped box measures the widest real line, not the column.
const lineNodes = rows => rows.map(line => el('div', null, {margin: 0, whiteSpace: 'nowrap'}, [line]));
const idleOf = (b, ctx, height) => idleFor(idleAmplitude(ctx?.grammar ?? null, b.unit), height);
const settleOf = model => rt(model.motion.exitStart - 0.05);
const accentOn = b => (contrastRatio(b.colors.accent, b.colors.bg) >= 3 ? b.colors.accent : b.colors.primary);

// ---------------------------------------------------------------------------
// concept-card

/** The looks' measures for one concept card: {free, scrim, glass, sticker}(width, k). */
export function conceptLooks(b, {text, glyph, sub}) {
  const {check, u, portrait} = b;
  const word = (width, preferred, maxLines = 3) => fitText(check, 'params.text', text, {family: 'display', width, preferred, min: u(64), maxLines});
  const subFit = (width, k) => (sub ? fitText(check, 'params.sub', sub, {family: 'body', width, preferred: u(46 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}) : null);
  const subH = s => (s ? s.lines * s.size * 1.25 : 0);
  return {
    free(width, k) {
      const iconSize = glyph ? u(84 * k) : 0, iconGap = glyph ? u(22 * k) : 0;
      const w = word(width, u((portrait ? 170 : 150) * k)), s = subFit(width, k);
      const rule = u(8), ruleGap = u(22 * k);
      return {mode: 'free', iconSize, iconGap, word: w, sub: s, rule, ruleGap,
        height: r2(iconSize + iconGap + w.lines * w.size * 1.02 + ruleGap + rule + (s ? ruleGap + subH(s) : 0))};
    },
    scrim(width, k) {
      const iconSize = glyph ? u(96 * k) : 0, iconGap = glyph ? u(24 * k) : 0;
      const w = word(width, u((portrait ? 150 : 140) * k)), s = subFit(width, k), subGap = u(20 * k);
      return {mode: 'scrim', iconSize, iconGap, word: w, sub: s, subGap, height: r2(iconSize + iconGap + w.lines * w.size * 1.02 + (s ? subGap + subH(s) : 0))};
    },
    glass(width, k) {
      const padX = u(52 * k), padY = u(48 * k), inner = r2(width - padX * 2);
      if (inner < u(320)) return null;
      const iconSize = glyph ? u(88 * k) : 0, iconGap = glyph ? u(24 * k) : 0;
      const w = word(inner, u((portrait ? 124 : 112) * k)), s = subFit(inner, k), subGap = u(18 * k);
      return {mode: 'glass', padX, padY, inner, iconSize, iconGap, word: w, sub: s, subGap,
        height: r2(padY * 2 + iconSize + iconGap + w.lines * w.size * 1.02 + (s ? subGap + subH(s) : 0))};
    },
    sticker(width, k) {
      const noteW = r2(Math.min(width * 0.9, u((portrait ? 840 : 900) * k))), padX = u(56 * k), padY = u(56 * k), inner = r2(noteW - padX * 2);
      if (inner < u(320)) return null;
      const iconSize = glyph ? u(72 * k) : 0, iconGap = glyph ? u(18 * k) : 0;
      const w = word(inner, u((portrait ? 132 : 120) * k)), s = subFit(inner, k), subGap = u(16 * k);
      const noteH = r2(padY * 2 + iconSize + iconGap + w.lines * w.size * 1.02 + (s ? subGap + subH(s) : 0));
      // The tilt swings the corners out by about sin(3°) of the width.
      const slack = r2(noteW * Math.sin(Math.abs(STICKER_TILT) * Math.PI / 180) + u(24));
      return {mode: 'sticker', noteW, padX, padY, inner, iconSize, iconGap, word: w, sub: s, subGap, noteH, height: r2(noteH + slack)};
    }
  };
}

/** Content a concept look adds to the model (colours and its breath). */
export function conceptLookContent(b, ctx, L) {
  const {colors} = b;
  const out = {idle: idleOf(b, ctx, L.height), ruleColor: accentOn(b), shadow: shade(b.unit)};
  if (L.mode === 'scrim') out.pool = colors.bg;
  if (L.mode === 'glass') Object.assign(out, {glassFill: `${colors.paper}1c`, glassEdge: `${colors.paper}47`});
  if (L.mode === 'sticker') {
    const ink = inkOn(b, colors.paper).color;
    Object.assign(out, {noteFill: colors.paper, noteInk: ink, tape: `${colors.accent}b3`});
  }
  return out;
}

const conceptWord = (model, color, align, shadow) => el('div', `${model.id}-word`, {...hidden, position: 'relative', flex: 'none', margin: 0, fontFamily: model.fonts.display,
  fontSize: model.content.layout.word.size, lineHeight: '1.02', color, textAlign: align, ...(shadow ? {textShadow: shadow} : {})}, lineNodes(model.content.layout.word.rows));
const conceptSub = (model, width, style) => flowText(`${model.id}-sub`, width, {...hidden, fontFamily: model.fonts.body, fontWeight: 500,
  fontSize: model.content.layout.sub.size, lineHeight: '1.25', ...style}, model.content.sub);
const conceptIcon = (model, size, color, style = {}) => flow(`${model.id}-icon`, size, size, {...hidden, transformOrigin: '50% 50%', ...style}, [iconNode(model.content.icon, {size, color})]);

export const CONCEPT_LOOK_VIEWS = {
  free(model) {
    const {id} = model;
    const c = model.content, L = c.layout, B = c.box;
    // The word and its rule in one shrink-wrapped column: the rule is as wide
    // as the word's widest line, whatever the browser sets.
    const marked = el('div', null, {position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'stretch'}, [
      conceptWord(model, c.wordColor, 'left', c.shadow),
      el('div', `${id}-rule`, {position: 'relative', height: L.rule, marginTop: L.ruleGap, borderRadius: L.rule, background: c.ruleColor, transformOrigin: '0% 50%', transform: 'scale(0, 1)'})
    ]);
    return [el('div', `${id}-idle`, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start'}), [
      c.icon ? conceptIcon(model, L.iconSize, c.ruleColor, {marginBottom: L.iconGap}) : null,
      marked,
      c.sub ? conceptSub(model, B.width, {marginTop: L.ruleGap, color: c.wordColor, textShadow: c.shadow}) : null
    ].filter(Boolean))];
  },
  scrim(model) {
    const {id, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const extX = r2(160 * unit), extY = r2(150 * unit);
    const pool = el('div', `${id}-scrim`, abs(r2(B.x - extX), r2(B.y - extY), r2(B.width + extX * 2), r2(L.height + extY * 2), {
      opacity: 0, background: `radial-gradient(closest-side, ${c.pool}eb 0%, ${c.pool}b3 55%, ${c.pool}00 100%)`, transformOrigin: '50% 50%'}), [], {'data-layout-allow-overflow': 'true'});
    return [pool, el('div', `${id}-idle`, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'}), [
      c.icon ? conceptIcon(model, L.iconSize, c.ruleColor, {marginBottom: L.iconGap}) : null,
      conceptWord(model, c.wordColor, 'center', null),
      c.sub ? conceptSub(model, B.width, {marginTop: L.subGap, color: c.subColor, textAlign: 'center'}) : null
    ].filter(Boolean))];
  },
  glass(model) {
    const {id, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    return [el('div', `${id}-idle`, abs(B.x, B.y, B.width, L.height), [
      el('div', `${id}-plate`, abs(0, 0, B.width, L.height, {opacity: 0, boxSizing: 'border-box', borderRadius: r2(36 * unit), background: c.glassFill,
        border: `${r2(2 * unit)}px solid ${c.glassEdge}`, backdropFilter: `blur(${r2(22 * unit)}px) saturate(1.4)`, boxShadow: `0 ${r2(24 * unit)}px ${r2(60 * unit)}px #00000059`, transformOrigin: '50% 50%'})),
      el('div', null, abs(L.padX, L.padY, L.inner, r2(L.height - L.padY * 2), {display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start'}), [
        c.icon ? conceptIcon(model, L.iconSize, c.ruleColor, {marginBottom: L.iconGap}) : null,
        conceptWord(model, c.wordColor, 'left', null),
        c.sub ? conceptSub(model, L.inner, {marginTop: L.subGap, color: c.subColor}) : null
      ].filter(Boolean))
    ])];
  },
  sticker(model) {
    const {id, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const tapeW = r2(150 * unit), tapeH = r2(44 * unit);
    return [el('div', `${id}-idle`, abs(B.x, B.y, B.width, L.height, {display: 'flex', alignItems: 'center', justifyContent: 'center'}), [
      el('div', `${id}-note`, {...hidden, position: 'relative', flex: 'none', boxSizing: 'border-box', width: L.noteW, padding: `${L.padY}px ${L.padX}px`,
        background: c.noteFill, boxShadow: `0 ${r2(20 * unit)}px ${r2(44 * unit)}px #00000066`, transformOrigin: '50% 40%'}, [
        el('div', `${id}-tape`, abs(r2((L.noteW - tapeW) / 2), r2(-tapeH / 2), tapeW, tapeH, {background: c.tape, transformOrigin: '50% 50%', transform: 'scale(0, 1)'})),
        c.icon ? flow(null, L.iconSize, L.iconSize, {marginBottom: L.iconGap}, [iconNode(c.icon, {size: L.iconSize, color: c.noteInk})]) : null,
        flow(`${id}-word`, L.inner, undefined, {opacity: 0, fontFamily: model.fonts.display, fontSize: L.word.size, lineHeight: '1.02', color: c.noteInk}, lineNodes(L.word.rows)),
        c.sub ? conceptSub(model, L.inner, {marginTop: L.subGap, color: c.noteInk}) : null
      ].filter(Boolean))
    ])];
  }
};

export function conceptLookTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, L = c.layout;
  const lead = rt(Math.max(start, c.t0 - 0.2));
  if (L.mode === 'scrim') {
    set(ops, `${id}-scrim`, start, {opacity: 0, scaleX: 0.85, scaleY: 0.85});
    tw(ops, `${id}-scrim`, lead, 0.7, 'power2.out', {opacity: 0, scaleX: 0.85, scaleY: 0.85}, {opacity: 1, scaleX: 1, scaleY: 1});
  }
  if (L.mode === 'glass') {
    set(ops, `${id}-plate`, start, {opacity: 0, scaleX: 0.92, scaleY: 0.92});
    tw(ops, `${id}-plate`, lead, 0.55, 'power3.out', {opacity: 0, scaleX: 0.92, scaleY: 0.92}, {opacity: 1, scaleX: 1, scaleY: 1});
  }
  if (L.mode === 'sticker') {
    const from = {opacity: 0, x: 0, y: r2(-70 * unit), rotation: -14, scaleX: 1.12, scaleY: 1.12};
    set(ops, `${id}-note`, start, from);
    tw(ops, `${id}-note`, lead, 0.6, 'power3.out', from, {opacity: 1, y: 0, rotation: STICKER_TILT, scaleX: 1, scaleY: 1});
    set(ops, `${id}-tape`, start, {scaleX: 0, scaleY: 1});
    tw(ops, `${id}-tape`, rt(lead + 0.4), 0.3, 'power2.out', {scaleX: 0}, {scaleX: 1});
    set(ops, `${id}-word`, start, {opacity: 0});
    tw(ops, `${id}-word`, rt(Math.max(c.t0, lead + 0.25)), 0.3, 'power1.out', {opacity: 0}, {opacity: 1});
  } else {
    if (c.icon) pop(ops, model, `${id}-icon`, c.iconAt, {scale: 0.4});
    rise(ops, model, `${id}-word`, c.t0, {distance: 40, duration: 0.55});
  }
  if (L.mode === 'free') {
    set(ops, `${id}-rule`, start, {scaleX: 0, scaleY: 1});
    tw(ops, `${id}-rule`, rt(c.t0 + 0.25), 0.55, 'power3.inOut', {scaleX: 0}, {scaleX: 1});
  }
  if (c.sub) rise(ops, model, `${id}-sub`, c.subAt, {distance: 18});
  // The breath starts as the word lands (it moves the whole look, the word's own rise is on its node).
  idleOps(ops, `${id}-idle`, start, c.t0, settleOf(model), c.idle);
}

// ---------------------------------------------------------------------------
// icon-row

/** The looks' measures for one icon row: {chips, ticks, glass, tags}(width, k). */
export function iconRowLooks(b, {items, title}) {
  const {check, u, portrait} = b;
  const n = items.length, icons = items.every(item => item.icon);
  // An eyebrow over the items: the title in the body face, upper case.
  const eyebrow = (width, k) => {
    if (!title) return {title: null, titleGap: 0, titleH: 0};
    const t = fitText(check, 'params.title', title.toUpperCase(), {family: 'body', width: r2(width * 0.9), preferred: u(48 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2});
    const titleGap = u(26 * k);
    return {title: t, titleGap, titleH: r2(t.lines * t.size * 1.15 + titleGap)};
  };
  const labels = (width, preferred, family = 'body', maxLines = 1) => {
    const fits = items.map(item => fitText(check, `params.items[${item.index}].label`, item.label, {family, width, preferred: Math.max(b.min.key, preferred), min: b.min.key, maxLines}));
    return {size: Math.min(...fits.map(f => f.size)), lines: Math.max(...fits.map(f => f.lines))};
  };
  return {
    chips(width, k) {
      const head = eyebrow(width, k);
      const padX = u(34 * k), padY = u(18 * k), gap = u(18 * k), glyph = u(44 * k), glyphGap = u(16 * k);
      const chrome = item => padX * 2 + (item.icon ? glyph + glyphGap : 0);
      const {size} = labels(r2(width - padX * 2 - glyph - glyphGap), u(46 * k));
      const chipH = r2(Math.max(size * 1.2, glyph) + padY * 2);
      // Greedy rows under the advance model (it overestimates, so the browser never needs more).
      let rows = 1, used = 0;
      for (const item of items) {
        const w = textWidth(item.label, size, 'body') + chrome(item);
        if (used && used + gap + w > width) { rows += 1; used = w; } else used += (used ? gap : 0) + w;
      }
      return {mode: 'chips', ...head, padX, padY, gap, glyph, glyphGap, labelSize: size, chipH, rows, height: r2(head.titleH + rows * chipH + (rows - 1) * gap)};
    },
    ticks(width, k) {
      const head = eyebrow(width, k);
      const fit = labels(width - u(80 * k), u((portrait ? 96 : 84) * k), 'display', 2);
      const mark = r2(Math.min(u(72 * k), fit.size * 0.8)), markGap = u(26 * k), labelW = r2(width - mark - markGap), gap = u(14 * k);
      const {size, lines} = labels(labelW, fit.size, 'display', 2);
      const rowH = r2(Math.max(mark, lines * size * 1.04));
      return {mode: 'ticks', ...head, icons, mark, markGap, labelW, labelSize: size, rowH, gap, height: r2(head.titleH + n * rowH + (n - 1) * gap)};
    },
    glass(width, k) {
      const padX = u(44 * k), padY = u(30 * k), inner = r2(width - padX * 2);
      const head = eyebrow(inner, k);
      const glyph = u(56 * k), glyphGap = u(26 * k), rowPad = u(20 * k), labelW = r2(inner - glyph - glyphGap);
      if (labelW < u(200)) return null;
      const {size, lines} = labels(labelW, u(46 * k), 'body', 2);
      const rowH = r2(Math.max(glyph, lines * size * 1.2) + rowPad * 2);
      return {mode: 'glass', ...head, padX, padY, inner, icons, glyph, glyphGap, rowPad, labelW, labelSize: size, rowH, rule: Math.max(1, u(2)), height: r2(padY * 2 + head.titleH + n * rowH)};
    },
    tags(width, k) {
      const head = eyebrow(width, k);
      const padX = u(32 * k), padY = u(12 * k), glyph = u(52 * k), glyphGap = u(16 * k), gap = u(24 * k);
      const {size} = labels(r2(width * 0.84 - padX * 2 - (icons ? glyph + glyphGap : 0)), u((portrait ? 84 : 76) * k), 'display', 1);
      const tagH = r2(Math.max(size * 1.15, icons ? glyph : 0) + padY * 2);
      return {mode: 'tags', ...head, padX, padY, glyph, glyphGap, gap, labelSize: size, tagH, height: r2(head.titleH + n * tagH + (n - 1) * gap + u(24))};
    }
  };
}

/** Content an icon-row look adds to the model. */
export function iconRowLookContent(b, ctx, L) {
  const {colors} = b;
  const out = {idle: idleOf(b, ctx, L.mode === 'chips' ? L.chipH : L.mode === 'tags' ? L.tagH : L.height), accent: accentOn(b), shadow: shade(b.unit)};
  if (L.mode === 'chips') Object.assign(out, {chipFill: `${colors.bg}a6`});
  if (L.mode === 'glass') Object.assign(out, {glassFill: `${colors.paper}1c`, glassEdge: `${colors.paper}47`, hairline: `${colors.paper}2e`});
  if (L.mode === 'tags') Object.assign(out, {tagFill: colors.paper, tagInk: inkOn(b, colors.paper).color, tilts: TAG_TILTS});
  return out;
}

const eyebrowNode = (model, width, align, color) => {
  const c = model.content, L = c.layout;
  return c.title ? flowText(null, width, {marginBottom: L.titleGap, fontFamily: model.fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15',
    letterSpacing: '0.04em', color, textAlign: align}, c.title.toUpperCase()) : null;
};
// The item's icon, or (with none) its number: never a stand-in icon.
const glyphOrNumber = (model, item, size, color) => (item.icon
  ? iconNode(item.icon, {size, color})
  : el('div', null, {margin: 0, width: size, lineHeight: `${size}px`, textAlign: 'center', fontFamily: model.fonts.display, fontSize: r2(size * 0.62), color}, [String(item.index + 1).padStart(2, '0')]));

export const ICON_ROW_LOOK_VIEWS = {
  chips(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const chips = c.items.map(item => el('div', `${id}-item-${item.index}`, {...hidden, position: 'relative', flex: 'none', transformOrigin: '50% 50%'}, [
      el('div', `${id}-item-${item.index}-idle`, {boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: L.glyphGap, height: L.chipH, padding: `0 ${L.padX}px`,
        borderRadius: r2(L.chipH / 2), background: c.chipFill, border: `${r2(3 * unit)}px solid ${c.color}`, backdropFilter: `blur(${r2(10 * unit)}px)`}, [
        item.icon ? flow(null, L.glyph, L.glyph, {}, [iconNode(item.icon, {size: L.glyph, color: c.color})]) : null,
        el('div', null, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.body, fontWeight: 600, fontSize: L.labelSize, lineHeight: '1.2', color: c.labelColor}, [item.label])
      ].filter(Boolean))
    ]));
    return [el('div', null, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'}), [
      eyebrowNode(model, B.width, 'center', c.accent),
      el('div', null, {position: 'relative', width: B.width, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: L.gap}, chips)
    ].filter(Boolean))];
  },
  ticks(model) {
    const {id, fonts} = model;
    const c = model.content, L = c.layout, B = c.box;
    const rows = c.items.map(item => flow(`${id}-item-${item.index}`, B.width, L.rowH, {...hidden, display: 'flex', alignItems: 'center', gap: L.markGap}, [
      flow(`${id}-mark-${item.index}`, L.mark, L.mark, {transformOrigin: '50% 50%'}, [L.icons ? iconNode(item.icon, {size: L.mark, color: c.accent}) : iconNode('check', {size: L.mark, color: c.accent, stroke: 3})]),
      flow(null, L.labelW, undefined, {margin: 0, fontFamily: fonts.display, fontSize: L.labelSize, lineHeight: '1.04', color: c.titleColor, textShadow: c.shadow, whiteSpace: 'normal'}, [item.label])
    ]));
    return [el('div', `${id}-idle`, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: L.gap}), [
      c.title ? flowText(null, B.width, {marginBottom: r2(L.titleGap - L.gap), fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', letterSpacing: '0.04em', color: c.accent, textShadow: c.shadow}, c.title.toUpperCase()) : null,
      ...rows
    ].filter(Boolean))];
  },
  glass(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const rows = c.items.map((item, i) => flow(`${id}-item-${item.index}`, L.inner, L.rowH, {...hidden, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: L.glyphGap,
      ...(i < c.items.length - 1 ? {borderBottom: `${L.rule}px solid ${c.hairline}`} : {})}, [
      flow(null, L.glyph, L.glyph, {}, [glyphOrNumber(model, item, L.glyph, c.color)]),
      flowText(null, L.labelW, {fontFamily: fonts.body, fontWeight: 600, fontSize: L.labelSize, lineHeight: '1.2', color: c.labelColor}, item.label)
    ]));
    return [el('div', `${id}-idle`, abs(B.x, B.y, B.width, L.height), [
      el('div', `${id}-plate`, abs(0, 0, B.width, L.height, {opacity: 0, boxSizing: 'border-box', borderRadius: r2(32 * unit), background: c.glassFill,
        border: `${r2(2 * unit)}px solid ${c.glassEdge}`, backdropFilter: `blur(${r2(22 * unit)}px) saturate(1.4)`, boxShadow: `0 ${r2(24 * unit)}px ${r2(60 * unit)}px #00000059`, transformOrigin: '50% 50%'})),
      el('div', null, abs(L.padX, L.padY, L.inner, r2(L.height - L.padY * 2), {display: 'flex', flexDirection: 'column', justifyContent: 'center'}), [eyebrowNode(model, L.inner, 'left', c.accent), ...rows].filter(Boolean))
    ])];
  },
  tags(model) {
    const {id, fonts, unit} = model;
    const c = model.content, L = c.layout, B = c.box;
    const tags = c.items.map(item => el('div', `${id}-item-${item.index}`, {...hidden, position: 'relative', flex: 'none', transformOrigin: '50% 50%'}, [
      el('div', `${id}-item-${item.index}-idle`, {boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: L.glyphGap, height: L.tagH, padding: `0 ${L.padX}px`,
        background: c.tagFill, boxShadow: `0 ${r2(12 * unit)}px ${r2(28 * unit)}px #00000059`}, [
        item.icon ? flow(null, L.glyph, L.glyph, {}, [iconNode(item.icon, {size: L.glyph, color: c.tagInk})]) : null,
        el('div', null, {margin: 0, whiteSpace: 'nowrap', fontFamily: fonts.display, fontSize: L.labelSize, lineHeight: '1.15', color: c.tagInk}, [item.label])
      ].filter(Boolean))
    ]));
    return [el('div', null, abs(B.x, B.y, B.width, L.height, {display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: L.gap}), [
      c.title ? flowText(null, B.width, {marginBottom: r2(L.titleGap - L.gap), fontFamily: fonts.body, fontWeight: 700, fontSize: L.title.size, lineHeight: '1.15', letterSpacing: '0.04em', color: c.accent, textAlign: 'center'}, c.title.toUpperCase()) : null,
      ...tags
    ].filter(Boolean))];
  }
};

export function iconRowLookTimeline(model, ops) {
  const {id, start, unit} = model;
  const c = model.content, L = c.layout, settle = settleOf(model);
  const first = c.items[0].time;
  const lead = rt(Math.max(start, first - 0.2));
  if (L.mode === 'glass') {
    set(ops, `${id}-plate`, start, {opacity: 0, scaleX: 0.92, scaleY: 0.92});
    tw(ops, `${id}-plate`, lead, 0.55, 'power3.out', {opacity: 0, scaleX: 0.92, scaleY: 0.92}, {opacity: 1, scaleX: 1, scaleY: 1});
  }
  c.items.forEach((item, i) => {
    const target = `${id}-item-${item.index}`;
    if (L.mode === 'chips') {
      pop(ops, model, target, item.time, {scale: 0.6, duration: 0.45});
      idleOps(ops, `${target}-idle`, start, rt(item.time + 0.3), settle, c.idle);
    } else if (L.mode === 'tags') {
      const tilt = c.tilts[i % c.tilts.length];
      const from = {opacity: 0, x: 0, y: r2(-48 * unit), rotation: tilt * 3, scaleX: 1.15, scaleY: 1.15};
      set(ops, target, start, from);
      tw(ops, target, item.time, 0.5, 'power3.out', from, {opacity: 1, y: 0, rotation: tilt, scaleX: 1, scaleY: 1});
      idleOps(ops, `${target}-idle`, start, rt(item.time + 0.3), settle, c.idle);
    } else {
      set(ops, target, start, {opacity: 0, x: r2(-40 * unit), y: 0});
      tw(ops, target, item.time, 0.45, 'power3.out', {opacity: 0, x: r2(-40 * unit)}, {opacity: 1, x: 0});
      if (L.mode === 'ticks') pop(ops, model, `${id}-mark-${item.index}`, rt(item.time + 0.1), {scale: 0.3});
    }
  });
  if (L.mode === 'ticks' || L.mode === 'glass') idleOps(ops, `${id}-idle`, start, first, settle, c.idle);
}
