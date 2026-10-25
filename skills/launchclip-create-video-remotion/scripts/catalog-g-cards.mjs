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
import {CARD_PARAMS, after, at, bob, cardTiming, column, createCardBase, flow, flowText, iconParam, iconTile, pick, pop, rise, row, spread} from './catalog-g-base.mjs';
import {ICON_STROKE, iconNode} from './icons.mjs';

const TONES = ['primary', 'accent', 'paper'];
const hidden = {opacity: 0};

// ---------------------------------------------------------------------------
// concept-card: a big word or short phrase, an icon and a sub-line.

function resolveConcept(params, ctx) {
  const b = createCardBase('concept-card', params, ctx, {allowed: ['text', 'icon', 'sub', 'tone', 'at'], required: ['text']});
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
  const measure = (width, maxHeight) => pick([...b.scales.map(k => () => stack(width, k)), ...(glyph ? [1, 0.82].map(k => () => inline(width, k)) : [])], maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : 1100)});
  const L = box.layout;
  const t0 = b.timeOf('word', p.at, 'params.at', 0.55);
  const iconAt = glyph ? rt(Math.max(b.motion.enterEnd - 0.2, t0 - 0.15)) : null;
  const subAt = sub ? after(b, t0, 0.35) : null;
  if (glyph) b.events.push({id: `${b.id}-icon`, name: 'icon', time: iconAt, endTime: rt(iconAt + 0.5), role: 'emphasis', cue: 'pop-soft'});
  b.events.push({id: `${b.id}-word`, name: 'word', time: t0, endTime: rt(t0 + 0.45), role: 'title', cue: 'whoosh'});
  if (sub) b.events.push({id: `${b.id}-sub`, name: 'sub', time: subAt, endTime: rt(subAt + 0.45), role: 'detail'});
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, text, icon: glyph, sub, wordColor, iconColor: colors.primary, subColor: theme.muted, t0, iconAt, subAt},
    {minTextPx: Math.min(L.word.size, L.sub?.size ?? Infinity)});
}

function conceptView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
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

function conceptTimeline(model, ops) {
  const {id} = model;
  const c = model.content;
  if (c.icon) pop(ops, model, `${id}-icon`, c.iconAt);
  rise(ops, model, `${id}-word`, c.t0);
  if (c.sub) rise(ops, model, `${id}-sub`, c.subAt, {distance: 18});
}

export const conceptCard = {
  id: 'concept-card',
  describe: 'A big word or short phrase (≤ 3 words) with an icon from the icon set and a sub-line, on a brand card beside the presenter or full frame. For naming a claim, a problem or a turn ("Security first", "Too slow", "Now: one click").',
  params: {text: 'word or phrase ≤ 28, ≤ 3 words', icon: 'icon name from kit/core/icons.mjs (optional)', sub: 'sub-line ≤ 64 (optional)', tone: 'word colour: paper (default) | primary | accent', at: 'word time', ...CARD_PARAMS},
  events: ['icon', 'word', 'sub'],
  timing: cardTiming(['the icon pops 0.15 s before the word; the sub-line follows it by 0.35 s']),
  mood: ['editorial', 'launch', 'bold'],
  resolve: resolveConcept, view: conceptView, timeline: conceptTimeline
};

// ---------------------------------------------------------------------------
// icon-row: 2–5 icons with labels that build in on their words.

function resolveIconRow(params, ctx) {
  const b = createCardBase('icon-row', params, ctx, {allowed: ['items', 'title', 'layout', 'stagger', 'at'], required: ['items']});
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
  const asRow = (width, k) => {
    const gap = u(28 * k), cell = r2((width - gap * (n - 1)) / n);
    const tile = r2(Math.min(u((portrait ? 150 : 160) * k), cell));
    if (tile < u(110)) return null;
    const labels = items.map(item => fitText(check, `params.items[${item.index}].label`, item.label, {family: 'body', width: cell, preferred: u(46 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}));
    const size = Math.min(...labels.map(l => l.size)), lines = Math.max(...labels.map(l => l.lines));
    return withTitle(width, k, {mode: 'row', gap, cell, tile, labelSize: size, labelGap: u(18 * k), height: r2(tile + u(18 * k) + lines * size * 1.2)});
  };
  const asList = (width, k) => {
    const tile = u((portrait ? 104 : 96) * k), gap = u(22 * k), labelGap = u(28), labelW = r2(width - tile - labelGap);
    const labels = items.map(item => fitText(check, `params.items[${item.index}].label`, item.label, {family: 'body', width: labelW, preferred: u(50 * Math.max(1, k * 0.9)), min: b.min.key, maxLines: 2}));
    const size = Math.min(...labels.map(l => l.size));
    const rowH = r2(Math.max(tile, Math.max(...labels.map(l => l.lines)) * size * 1.2));
    return withTitle(width, k, {mode: 'list', gap, tile, labelSize: size, labelGap, labelW, rowH, height: r2(n * rowH + (n - 1) * gap)});
  };
  const measure = (width, maxHeight) => {
    const rows = b.scales.map(k => () => asRow(width, k)), lists = b.scales.map(k => () => asList(width, k));
    const out = pick(layoutIn === 'row' ? rows : layoutIn === 'list' ? lists : [...rows, ...lists], maxHeight);
    if (!out && layoutIn === 'row') check.fail('params.layout', '"row" does not fit: the labels are too long for the width; use "list"');
    // A list in a panel or rect spreads down it rather than bunching at the top.
    return out?.mode === 'list' && b.fills ? spread(out, maxHeight, {gap: [n - 1, r2(out.rowH * 0.6)], titleGap: [out.title ? 1 : 0, u(64)]}) : out;
  };
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : 1400)});
  const first = b.timeOf('item-0', p.at, 'params.at', 0.6);
  const placed = items.map(item => {
    const time = item.at === undefined ? b.timeOf(`item-${item.index}`, undefined, `params.items[${item.index}].at`, first - start + item.index * stagger) : b.timeOf(`item-${item.index}`, item.at, `params.items[${item.index}].at`, 0);
    b.events.push({id: `${id}-item-${item.index}`, name: `item-${item.index}`, time, endTime: rt(time + 0.5), role: 'emphasis', cue: 'pop'});
    return {...item, time};
  });
  const L = box.layout;
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, title, items: placed, color: colors.primary, labelColor: theme.foreground, titleColor: b.titleColor},
    {minTextPx: Math.min(L.labelSize, L.title?.size ?? Infinity)});
}

function iconRowView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
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

function iconRowTimeline(model, ops) {
  for (const item of model.content.items) pop(ops, model, `${model.id}-item-${item.index}`, item.time, {scale: 0.7});
}

export const iconRow = {
  id: 'icon-row',
  describe: 'Two to five icons from the icon set, each with a short label, that pop in one by one on their words: a row, or a list when the labels are long or the room is narrow. For lists of features, steps or audiences.',
  params: {items: '[{icon: icon name, label ≤ 24, at?}] 2–5', title: 'string ≤ 48 (optional)', layout: 'auto (default) | row | list', stagger: 'seconds between pops (default 0.18)', at: 'first pop time', ...CARD_PARAMS},
  events: ['item-<i>'],
  timing: cardTiming(['items pop in order; with no at, the first pops at 0.6 s and the rest follow by stagger (default 0.18 s)']),
  mood: ['editorial', 'launch', 'playful'],
  resolve: resolveIconRow, view: iconRowView, timeline: iconRowTimeline
};

// ---------------------------------------------------------------------------
// section-card: the brand frame's kicker and a section title.

function resolveSection(params, ctx) {
  const b = createCardBase('section-card', params, ctx, {allowed: ['title', 'kicker', 'number', 'icon', 'at'], required: ['title']});
  const {check, u, portrait, colors, theme} = b;
  const p = b.params;
  const title = check.str(p.title, 'params.title', 48);
  const kicker = p.kicker === undefined ? null : check.str(p.kicker, 'params.kicker', 28).toUpperCase();
  const number = p.number === undefined ? null : check.int(p.number, 'params.number', 1, 99);
  const glyph = iconParam(check, p.icon, 'params.icon');
  if (number !== null && glyph) check.fail('params.icon', 'cannot be used with params.number; pick one');
  const kickerColor = b.resolveColor('primary', 'kicker colour (brand.colors.primary)', 'primary');
  const variant = (width, k) => {
    const head = number !== null ? u((portrait ? 190 : 170) * k) : glyph ? u((portrait ? 140 : 120) * k) : 0;
    const kick = kicker ? fitText(check, 'params.kicker', kicker, {family: 'meta', width, preferred: u(34 * Math.max(1, k * 0.9)), min: b.min.meta, maxLines: 1}) : null;
    const t = fitText(check, 'params.title', title, {family: 'display', width, preferred: u((portrait ? 124 : 120) * k), min: u(64), maxLines: 3});
    const headGap = u(18 * k), kickGap = u(20 * k), rule = u(8), ruleGap = u(30 * k);
    const height = r2(head + (head ? headGap : 0) + (kick ? kick.size * 1.3 + kickGap : 0) + rule + ruleGap + t.lines * t.size * 1.04);
    return {head, headGap, kick, kickGap, title: t, rule, ruleGap, height};
  };
  const measure = (width, maxHeight) => pick(b.scales.map(k => () => variant(width, k)), maxHeight);
  const box = b.place(measure, {maxWidth: u(portrait ? 900 : 1300)});
  const t0 = b.timeOf('title', p.at, 'params.at', 0.6);
  const kickAt = rt(Math.max(b.motion.enterEnd - 0.15, t0 - 0.25));
  b.events.push({id: `${b.id}-kicker`, name: 'kicker', time: kickAt, endTime: rt(kickAt + 0.45), role: 'detail'});
  b.events.push({id: `${b.id}-title`, name: 'title', time: t0, endTime: rt(t0 + 0.5), role: 'title', cue: 'whoosh'});
  const L = box.layout;
  return b.finish({box: {x: box.x, y: box.y, width: box.width}, layout: L, title, kicker, number: number === null ? null : String(number).padStart(2, '0'), icon: glyph,
    kickerColor, ruleColor: colors.primary, titleColor: theme.foreground, numberColor: colors.primary, t0, kickAt}, {minTextPx: L.title.size});
}

function sectionView(model) {
  const {id, fonts, unit} = model;
  const c = model.content, L = c.layout, B = c.box;
  const ruleW = r2(Math.min(B.width * 0.3, 160 * unit));
  const kids = [];
  if (c.number) kids.push(flowText(`${id}-head`, B.width, {...hidden, marginBottom: L.headGap, fontFamily: fonts.display, fontSize: L.head, lineHeight: '1', color: c.numberColor, textAlign: 'center', transformOrigin: '50% 50%'}, c.number));
  if (c.icon) kids.push(flow(`${id}-head`, L.head, L.head, {...hidden, marginBottom: L.headGap, transformOrigin: '50% 50%'}, [iconNode(c.icon, {size: L.head, color: c.numberColor})]));
  if (c.kicker) kids.push(flowText(`${id}-kicker`, B.width, {...hidden, marginBottom: L.kickGap, fontFamily: fonts.meta, fontSize: L.kick.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.kickerColor, textAlign: 'center'}, c.kicker));
  kids.push(flow(`${id}-rule`, ruleW, L.rule, {marginBottom: L.ruleGap, borderRadius: L.rule, background: c.ruleColor, transformOrigin: '50% 50%', transform: 'scale(0, 1)'}, []));
  kids.push(flowText(`${id}-title`, B.width, {...hidden, fontFamily: fonts.display, fontSize: L.title.size, lineHeight: '1.04', color: c.titleColor, textAlign: 'center'}, c.title));
  return [column(B.x, B.y, B.width, L.height, kids)];
}

function sectionTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
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
  timing: cardTiming(['the kicker and rule land 0.25 s before the title']),
  mood: ['editorial', 'launch', 'cinematic'],
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
  const t0 = b.timeOf('object', p.at, 'params.at', 0.55);
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
  timing: cardTiming(['the caption follows the object by 0.25 s; accents pop from 0.35 s after it']),
  mood: ['playful', 'launch', 'editorial'],
  resolve: resolveObject, view: objectView, timeline: objectTimeline
};
