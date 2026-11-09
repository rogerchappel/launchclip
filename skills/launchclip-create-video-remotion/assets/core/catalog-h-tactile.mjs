// Catalogue H tactile modules: the satisfying-motion kit. Things that pile up
// as they are said, numbers that never stop climbing, and objects with
// weight.
//
//   drop-grid     cards, coins or tiles drop into a grid one by one, each
//                 timed to a word ("10 times a day": ten cards), with a fall,
//                 a squash on contact, a contact shadow and a puff of dust;
//                 an optional counter climbs with every landing
//   live-counter  a big figure that keeps ticking up for the whole scene,
//                 with milestones that stamp and burst as it passes them and
//                 an optional delta chip ("+2,312 today")
//   live-bars     raised bars whose values tick up live, each value riding
//                 the end of its bar
//
// The physics, shadows, stamps and seeded particles are in tactile.mjs.
// Every landing, tick, stamp and burst is a model event with a kit cue and an
// `sfx` name (land | tick | stamp | burst) for sound design to map. Registered
// in kit/core/catalog-h.mjs.

import {progress, timingRules} from './catalog-b-base.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, fitText, inkOn, numberFormat, r2, rt, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {TACTILE, burstNodes, burstOps, burstParticles, dropOps, pulseOps, shadowNode, shadowOps, stampOps, tactileDepth, tactileFace} from './tactile.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';
const tone = 'primary | accent | paper | #rrggbb';

/** The burst colours: the brand series, then paper. */
const burstColors = b => [...new Set([...b.series(3), b.colors.paper])];

// ---------------------------------------------------------------------------
// drop-grid

const DROP_VARIANTS = Object.freeze(['cards', 'coins', 'tiles']);
export const DROP_MAX = 40;
const DROP_SHAPE = {cards: 0.78, coins: 1, tiles: 1};
const DROP_CUE = {cards: 'thud', coins: 'tick', tiles: 'snap'};

function dropResolve(params, ctx) {
  const b = createHBase('drop-grid', params, ctx, {allowed: ['count', 'items', 'columns', 'times', 'cadence', 'counter', 'title', 'source', 'tone', 'slots', 'at'], variants: DROP_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  if ((p.count === undefined) === (p.items === undefined)) check.fail('params', 'needs exactly one of count or items');
  const items = p.items === undefined
    ? Array.from({length: check.int(p.count, 'params.count', 1, DROP_MAX)}, () => ({label: null, image: null}))
    : check.arr(p.items, 'params.items', 1, DROP_MAX).map((item, i) => {
      const path = `params.items[${i}]`;
      if (typeof item === 'string') return {label: check.str(item, path, 16), image: null};
      check.obj(item, path, ['label', 'image']);
      return {label: item.label === undefined ? null : check.str(item.label, `${path}.label`, 16), image: item.image === undefined ? null : check.asset(item.image, `${path}.image`)};
    });
  const n = items.length;
  const shape = DROP_SHAPE[b.variant];
  const fill = toneColor(b, p.tone, 'params.tone', b.variant === 'coins' ? 'primary' : 'accent');
  const ink = inkOn(b.colors, fill);
  const W = rect.width;
  const chrome = titleBlock(b, {title: p.title, source: p.source, width: W});

  // The counter: the number of landed items, climbing with each landing.
  let counter = null;
  if (p.counter !== undefined && p.counter !== false) {
    const raw = p.counter === true ? {} : check.obj(p.counter, 'params.counter', ['prefix', 'suffix', 'label', 'from']);
    const from = raw.from === undefined ? 0 : check.int(raw.from, 'params.counter.from', 0, 1e6);
    const prefix = raw.prefix === undefined ? '' : check.str(raw.prefix, 'params.counter.prefix', 4);
    const suffix = raw.suffix === undefined ? '' : check.str(raw.suffix, 'params.counter.suffix', 8);
    const widest = `${prefix}${from + n}${suffix}`;
    let size = u(b.portrait ? 150 : 120);
    while (size > b.min.key && textWidth(widest, size, 'display') > W * 0.9) size -= 2;
    const cap = raw.label === undefined ? null : fitText(check, 'params.counter.label', check.str(raw.label, 'params.counter.label', 30), {family: 'body', width: W, preferred: Math.max(u(48), b.min.key), min: b.min.key});
    counter = {from, prefix, suffix, size: r2(size), label: cap ? {text: raw.label.trim(), size: cap.size} : null,
      height: r2(size * 1.08 + (cap ? cap.size * 1.25 + u(8) : 0) + u(24))};
  }

  // The grid: the column count that gives the biggest cell in what is left.
  const top = chrome.top + (counter ? counter.height : 0);
  const area = {x: 0, y: top, width: W, height: r2(rect.height - top - chrome.bottom)};
  if (area.height < u(160)) check.fail('params', 'leave too little room for the grid (shorten the title or drop the counter)');
  let best = null;
  const fixed = p.columns === undefined ? null : check.int(p.columns, 'params.columns', 1, 10);
  for (let cols = fixed ?? 1; cols <= (fixed ?? Math.min(10, n)); cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = Math.min(area.width / cols, (area.height / rows) * shape);
    if (!best || cellW > best.cellW) best = {cols, rows, cellW};
  }
  const {cols, rows} = best;
  const cellW = r2(best.cellW), cellH = r2(best.cellW / shape);
  const gap = r2(cellW * 0.12);
  const itemW = r2(cellW - gap), itemH = r2(cellH - gap);
  const gridW = cellW * cols, gridH = cellH * rows;
  const ox = (W - gridW) / 2 + gap / 2, oy = area.y + (area.height - gridH) / 2 + gap / 2;

  // Labels inside the items.
  const labelled = items.filter(item => item.label);
  let labelSize = 0;
  if (labelled.length) {
    labelSize = Math.min(u(40), itemH * (b.variant === 'cards' ? 0.2 : 0.26));
    const room = itemW * 0.84;
    while (labelSize > b.min.meta && labelled.some(item => textWidth(item.label, labelSize, 'body') > room)) labelSize -= 1;
    if (labelSize < b.min.meta) check.fail('params.items', `labels do not fit ${Math.round(room)} px wide items at ${Math.ceil(b.min.meta)} px; shorten them or use fewer items`);
    labelSize = r2(labelSize);
  }

  // Timing: one landing per item, each on its own word when params.times names them.
  const fall = TACTILE.fall;
  const dropH = r2(Math.min(u(260), oy + cellH));
  let times;
  if (p.times !== undefined) {
    check.arr(p.times, 'params.times', n, n);
    times = p.times.map((value, i) => b.timeOf(`drop-${i + 1}`, value, `params.times[${i}]`, 0.55));
    for (let i = 1; i < n; i++) if (times[i] < times[i - 1]) check.fail(`params.times[${i}]`, 'must not be earlier than the drop before it');
  } else {
    const t0 = b.timeOf('build', p.at, 'params.at', 0.55);
    const room = b.start + b.lastEvent - fall - t0;
    const cadence = p.cadence === undefined ? Math.max(0.05, Math.min(0.32, room / Math.max(1, n - 1))) : check.num(p.cadence, 'params.cadence', 0.05, 1.5);
    if (t0 + cadence * (n - 1) > b.start + b.lastEvent + 1e-6) check.fail(p.cadence === undefined ? 'params' : 'params.cadence', `${n} drops do not fit the scene; lengthen it, set a faster cadence or drop fewer items`);
    times = items.map((_, i) => rt(t0 + i * cadence));
  }
  const dust = n <= 24 ? 6 : 3;
  const cells = items.map((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = r2(ox + col * cellW), y = r2(oy + row * cellH);
    const land = rt(times[i] + fall);
    const particles = burstParticles(`${b.id}|drop|${i}`, `${b.id}-d${i}`, {x: x + itemW / 2, y: y + itemH, count: dust, spread: itemW * 0.55, size: u(9), colors: [b.theme.muted, b.colors.paper]});
    return {...item, x, y, time: times[i], land, particles};
  });
  for (const [i, cell] of cells.entries()) b.events.push({id: `${b.id}-land-${i + 1}`, name: `land-${i + 1}`, time: cell.land, role: 'emphasis', cue: DROP_CUE[b.variant], sfx: 'land'});
  const last = cells.at(-1);
  const finale = burstParticles(`${b.id}|finale`, `${b.id}-fin`, {x: ox - gap / 2 + gridW / 2, y: oy + gridH * 0.4, count: 18, spread: Math.min(W, gridW) * 0.6, size: u(16), colors: burstColors(b), kind: 'confetti'});
  b.events.push({id: `${b.id}-filled`, name: 'filled', time: rt(last.land + 0.02), role: 'emphasis', cue: 'sparkle', sfx: 'burst'});

  const content = {variant: b.variant, cells, itemW, itemH, gap, dropH, fill, ink, labelSize, counter, counterY: chrome.top, finale, finaleAt: rt(last.land + 0.02),
    slots: p.slots === undefined ? true : check.bool(p.slots, 'params.slots'), title: chrome.title, source: chrome.source, buildEnd: last.land};
  const minText = Math.min(counter ? counter.size : Infinity, counter?.label ? counter.label.size : Infinity, chrome.title ? chrome.title.size : Infinity);
  return b.finish(content, {minTextPx: Number.isFinite(minText) ? minText : b.min.key});
}

function dropItem(model, cell, i) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const w = c.itemW, h = c.itemH;
  const coin = c.variant === 'coins';
  const depth = r2(Math.max(3, w * (coin ? 0.06 : 0.05)));
  const face = {background: tactileFace(c.fill), boxShadow: tactileDepth(c.fill, depth), borderRadius: coin ? '50%' : r2(w * (c.variant === 'cards' ? 0.1 : 0.16)), overflow: 'hidden', transformOrigin: '50% 100%'};
  const kids = [];
  if (cell.image) kids.push(el('img', null, abs(0, 0, w, c.variant === 'cards' && cell.label ? r2(h * 0.72) : h, {objectFit: 'cover', display: 'block'}), [], {src: cell.image, alt: ''}));
  if (coin) kids.push(el('div', null, abs(r2(w * 0.12), r2(h * 0.12), r2(w * 0.76), r2(h * 0.76), {borderRadius: '50%', border: `${r2(Math.max(2, w * 0.035))}px solid ${c.ink}33`, boxSizing: 'border-box'})));
  if (cell.label) {
    const y = cell.image && c.variant === 'cards' ? r2(h * 0.76) : r2((h - c.labelSize * 1.2) / 2);
    kids.push(label(null, 0, y, w, cell.label, {size: c.labelSize, family: fonts.body, color: c.ink, align: 'center', weight: 750}));
  }
  return el('div', `${id}-i${i}`, {...abs(cell.x, cell.y, w, h), ...face}, kids);
}

function dropView(model) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const out = [...chromeNodes(model)];
  if (c.counter) {
    const k = c.counter;
    out.push(label(`${id}-count`, 0, c.counterY, W, `${k.prefix}${k.from}${k.suffix}`, {size: k.size, family: fonts.display, color: c.fill, align: 'center', lineHeight: 1.08, extra: {opacity: 0, transformOrigin: '50% 60%'}}));
    if (k.label) out.push(label(`${id}-count-label`, 0, r2(c.counterY + k.size * 1.08 + 8 * u), W, k.label.text, {size: k.label.size, family: fonts.body, color: theme.foreground, align: 'center', weight: 650, extra: {opacity: 0}}));
  }
  if (c.slots) c.cells.forEach((cell, i) => out.push(el('div', `${id}-s${i}`, abs(cell.x, cell.y, c.itemW, c.itemH, {boxSizing: 'border-box', border: `${r2(2 * u)}px dashed ${theme.border}`, borderRadius: c.variant === 'coins' ? '50%' : r2(c.itemW * 0.12), opacity: 0}))));
  c.cells.forEach((cell, i) => out.push(shadowNode(`${id}-sh${i}`, cell.x + c.itemW * 0.08, cell.y + c.itemH - c.itemH * 0.05, c.itemW * 0.84, Math.max(6 * u, c.itemH * 0.14))));
  c.cells.forEach((cell, i) => out.push(dropItem(model, cell, i)));
  for (const cell of c.cells) out.push(...burstNodes(cell.particles));
  out.push(...burstNodes(c.finale));
  return out;
}

function dropTimeline(model, ops) {
  const {id, start, motion, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  if (c.counter) {
    const k = c.counter;
    riseOps(ops, `${id}-count`, start, motion.enterStart + 0.1, r2(20 * u));
    if (k.label) riseOps(ops, `${id}-count-label`, start, motion.enterStart + 0.2, r2(14 * u));
    c.cells.forEach((cell, i) => {
      set(ops, `${id}-count`, cell.land, {text: `${k.prefix}${k.from + i + 1}${k.suffix}`});
      pulseOps(ops, `${id}-count`, cell.land, i === c.cells.length - 1 ? 0.18 : 0.08);
    });
  }
  if (c.slots) c.cells.forEach((_, i) => {
    set(ops, `${id}-s${i}`, start, {opacity: 0});
    tw(ops, `${id}-s${i}`, rt(motion.enterStart + 0.05 + i * 0.012), 0.35, 'power1.out', {opacity: 0}, {opacity: 1});
  });
  c.cells.forEach((cell, i) => {
    shadowOps(ops, `${id}-sh${i}`, start, cell.time);
    dropOps(ops, `${id}-i${i}`, start, cell.time, c.dropH);
    burstOps(ops, cell.particles, start, cell.land);
  });
  burstOps(ops, c.finale, start, c.finaleAt);
}

export const dropGrid = {
  id: 'drop-grid',
  describe: 'Things pile up as they are said: 1–40 cards, coins or tiles drop into a grid one by one ("10 times a day": ten cards land), each with a weighted fall, a squash on contact, a contact shadow and a puff of dust, over faint empty slots; an optional counter climbs with every landing, and confetti bursts when the grid fills. Time each drop to its word with params.times.',
  params: {count: `1–${DROP_MAX} items (or items)`, items: `[label ≤ 16 | {label?, image? (assets/… photo)}] 1–${DROP_MAX} (or count)`, columns: 'columns 1–10 (optional; default the layout with the biggest items)',
    times: `[number] 1–${DROP_MAX}, seconds from scene start, one per item, rising: each drop on its word (optional)`, cadence: 'seconds between drops 0.05–1.5 (optional, when times is not set; default fits the scene)',
    counter: 'true | {prefix? ≤ 4, suffix? ≤ 8 ("×"), label? ≤ 30, from?} a big count above the grid that climbs with each landing (optional)', title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)',
    tone: `item colour (${tone}; default primary for coins, accent otherwise)`, slots: 'faint empty slots that the items fill (default true)', at: `first drop when times is not set: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build', 'land-N', 'filled'], variants: DROP_VARIANTS,
  timing: timingRules({rules: ['each item lands TACTILE.fall s after its drop time; time drops to the words that count them', 'the last item lands before the exit']}),
  resolve: dropResolve, view: dropView, timeline: dropTimeline
};

// ---------------------------------------------------------------------------
// live-counter

const LIVE_VARIANTS = Object.freeze(['plain', 'panel', 'ticket']);
const PACES = {steady: 'none', accelerate: 'power2.in', ease: 'power2.out'};

function liveResolve(params, ctx) {
  const b = createHBase('live-counter', params, ctx, {allowed: ['from', 'to', 'format', 'label', 'pace', 'milestones', 'delta', 'tone', 'at'], required: ['to'], variants: LIVE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const to = check.num(p.to, 'params.to', 0, 1e15);
  const from = p.from === undefined ? 0 : check.num(p.from, 'params.from', 0, to);
  const fmt = numberFormat(check, p.format, 'params.format');
  const pace = p.pace === undefined ? 'steady' : check.oneOf(p.pace, 'params.pace', Object.keys(PACES));
  const color = toneColor(b, p.tone, 'params.tone', 'primary');
  const W = rect.width;
  const widest = fmt.format(to).length >= fmt.format(from).length ? fmt.format(to) : fmt.format(from);
  if (widest.length > 16) check.fail('params.to', `formats to ${widest.length} characters; at most 16 fit (try format.compact)`);
  const boxed = b.variant !== 'plain';
  const pad = boxed ? u(44) : 0;
  const cap = p.label === undefined ? null : fitText(check, 'params.label', check.str(p.label, 'params.label', 40), {family: 'meta', width: W - 2 * pad, preferred: Math.max(u(48), b.min.key), min: b.min.key});
  let size = u(b.portrait ? 210 : 180);
  // The figure is sized for its widest value, so it never jumps as it climbs.
  while (size > b.min.key && (textWidth(widest, size, 'display') * 1.06 + 2 * pad > W || size * 1.2 + 2 * pad > rect.height * 0.6)) size -= 2;
  if (size < b.min.key) check.fail('params.to', 'does not fit the rect');
  size = r2(size);
  const figureW = r2(Math.min(W, textWidth(widest, size, 'display') * 1.06 + 2 * pad));
  const capH = cap ? r2(cap.size * 1.3 + u(14)) : 0;
  let delta = null;
  if (p.delta !== undefined) {
    const raw = typeof p.delta === 'string' ? {text: p.delta} : check.obj(p.delta, 'params.delta', ['text', 'at'], ['text']);
    const text = check.str(raw.text, 'params.delta.text', 16);
    const dSize = r2(Math.max(b.min.key, u(46)));
    delta = {text, size: dSize, w: r2(textWidth(text, dSize, 'body') + u(40)), h: r2(dSize * 1.5), at: raw.at};
  }
  const blockH = r2(capH + size * 1.2 + 2 * pad + (delta ? delta.h + u(26) : 0));
  const y0 = r2((rect.height - blockH) / 2);
  const box = {x: r2((W - figureW) / 2), y: r2(y0 + capH), w: figureW, h: r2(size * 1.2 + 2 * pad)};

  // The count runs from `at` to just before the exit: it never stops on screen.
  const t0 = b.timeOf('count', p.at, 'params.at', 0.55);
  const t1 = rt(b.motion.exitStart - 0.05);
  if (t1 - t0 < 0.8) check.fail('params.at', 'leaves under 0.8 s of counting; lengthen the scene or start earlier');
  const ease = PACES[pace];
  b.events.push({id: `${b.id}-count`, name: 'count', time: t0, endTime: t1, role: 'emphasis', cue: 'tally', sfx: 'tick'});
  const valueAt = t => from + (to - from) * progress(t, t0, t1 - t0, ease);
  const milestones = (p.milestones === undefined ? [] : check.arr(p.milestones, 'params.milestones', 1, 4)).map((value, i) => {
    const path = `params.milestones[${i}]`;
    check.num(value, path, from, to);
    if (!(value > from && value < to)) check.fail(path, 'must lie between from and to');
    // When the count passes it: a bisection on the eased count.
    let lo = t0, hi = t1;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (valueAt(mid) < value) lo = mid; else hi = mid; }
    return {value, time: rt(hi)};
  }).sort((a, z) => a.time - z.time);
  for (let i = 1; i < milestones.length; i++) if (milestones[i].time - milestones[i - 1].time < 0.45) check.fail('params.milestones', 'are passed under 0.45 s apart; space them out');
  const bursts = milestones.map((m, i) => {
    b.events.push({id: `${b.id}-milestone-${i + 1}`, name: `milestone-${i + 1}`, time: m.time, role: 'emphasis', cue: 'snap', sfx: 'stamp'});
    return burstParticles(`${b.id}|milestone|${i}`, `${b.id}-m${i}`, {x: W / 2, y: box.y + box.h / 2, count: 14, spread: Math.min(W, figureW) * 0.55, size: u(14), colors: burstColors(b), kind: 'confetti'});
  });
  if (delta) {
    delta.time = b.timeOf('delta', delta.at, 'params.delta.at', Math.min(b.lastEvent, t0 - b.start + 0.8));
    b.events.push({id: `${b.id}-delta`, name: 'delta', time: delta.time, role: 'emphasis', cue: 'pop', sfx: 'stamp'});
  }
  const samples = countSamples(b.model, t0, rt(t1 - t0), ease, from, to, value => fmt.format(value));
  const panel = b.variant === 'ticket' ? b.colors.paper : b.theme.panel;
  const content = {variant: b.variant, size, box, pad, color: b.variant === 'ticket' ? inkOn(b.colors, panel) : color, panel,
    label: cap ? {text: p.label.trim(), size: cap.size, y: y0} : null, initial: fmt.format(from), samples, milestones, bursts,
    delta: delta ? {...delta, x: r2((W - delta.w) / 2), y: r2(box.y + box.h + u(26)), fill: b.colors.accent, ink: inkOn(b.colors, b.colors.accent)} : null};
  return b.finish(content, {minTextPx: Math.min(size, cap ? cap.size : Infinity, delta ? delta.size : Infinity)});
}

function liveView(model) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const out = [];
  if (c.label) out.push(label(`${id}-label`, 0, c.label.y, W, c.label.text.toUpperCase(), {size: c.label.size, family: fonts.meta, color: theme.muted, align: 'center', spacing: '0.12em', extra: {opacity: 0}}));
  const B = c.box;
  const frame = c.variant === 'plain' ? {} : {background: c.variant === 'ticket' ? tactileFace(c.panel) : c.panel, borderRadius: r2(c.size * 0.16), boxShadow: tactileDepth(c.panel, Math.max(4, c.size * 0.05)),
    border: c.variant === 'panel' ? `${r2(2 * u)}px solid ${theme.border}` : 'none', boxSizing: 'border-box'};
  out.push(el('div', `${id}-box`, {...abs(B.x, B.y, B.w, B.h), ...frame, opacity: 0, transformOrigin: '50% 50%'}, [
    label(`${id}-value`, 0, c.pad, B.w, c.initial, {size: c.size, family: fonts.display, color: c.color, align: 'center', lineHeight: 1.2, extra: {fontVariantNumeric: 'tabular-nums'}})
  ]));
  if (c.delta) {
    const d = c.delta;
    out.push(el('div', `${id}-delta`, {...abs(d.x, d.y, d.w, d.h), background: tactileFace(d.fill), boxShadow: tactileDepth(d.fill, Math.max(3, d.size * 0.08)), borderRadius: r2(d.h / 2), opacity: 0, transformOrigin: '50% 50%'},
      [label(null, 0, r2((d.h - d.size * 1.2) / 2), d.w, d.text, {size: d.size, family: fonts.body, color: d.ink, align: 'center', weight: 800})]));
  }
  for (const burst of c.bursts) out.push(...burstNodes(burst));
  return out;
}

function liveTimeline(model, ops) {
  const {id, start, motion, unit: u} = model;
  const c = model.content;
  if (c.label) riseOps(ops, `${id}-label`, start, motion.enterStart + 0.05, r2(14 * u));
  popOps(ops, `${id}-box`, start, motion.enterStart, {from: 0.7, duration: 0.5});
  countOps(ops, `${id}-value`, start, c.initial, c.samples);
  c.milestones.forEach((m, i) => {
    pulseOps(ops, `${id}-box`, m.time, 0.12);
    burstOps(ops, c.bursts[i], start, m.time);
  });
  if (c.delta) stampOps(ops, `${id}-delta`, start, c.delta.time, {tilt: -3});
}

export const liveCounter = {
  id: 'live-counter',
  describe: 'A big figure that never stops climbing: it ticks up from `from` to `to` for the whole scene (steady, accelerating or easing), on a plain, panel or ticket face; milestones stamp the figure and burst confetti as the count passes them, and an optional delta chip ("+2,312 today") stamps in beside it.',
  params: {to: 'number ≥ from, required', from: 'start value (default 0)', format: FORMAT_PARAM, label: 'string ≤ 40 above the figure, shown in caps (optional)', pace: 'steady | accelerate | ease (default steady)',
    milestones: '[values between from and to] 1–4, at least 0.45 s apart as the count passes them (optional)', delta: 'string ≤ 16 or {text ≤ 16, at?} a chip that stamps in under the figure (optional)',
    tone: `figure colour (${tone}; default primary)`, at: `count start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['count', 'milestone-N', 'delta'], variants: LIVE_VARIANTS,
  timing: timingRules({rules: ['the count runs from at until just before the exit, so the figure is moving whenever it is on screen']}),
  resolve: liveResolve, view: liveView, timeline: liveTimeline
};

// ---------------------------------------------------------------------------
// live-bars

const BARS_VARIANTS = Object.freeze(['slabs', 'flat']);

function barsResolve(params, ctx) {
  const b = createHBase('live-bars', params, ctx, {allowed: ['rows', 'format', 'title', 'source', 'at', 'max'], required: ['rows'], variants: BARS_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.rows, 'params.rows', 2, 6);
  const fmt = numberFormat(check, p.format, 'params.format');
  const series = b.series(p.rows.length);
  const rows = p.rows.map((row, i) => {
    const path = `params.rows[${i}]`;
    check.obj(row, path, ['label', 'from', 'to', 'tone'], ['label', 'to']);
    const to = check.num(row.to, `${path}.to`, 0, 1e15);
    const from = row.from === undefined ? 0 : check.num(row.from, `${path}.from`, 0, to);
    return {label: check.str(row.label, `${path}.label`, 24), from, to, color: row.tone === undefined ? series[i] : toneColor(b, row.tone, `${path}.tone`)};
  });
  const max = p.max === undefined ? Math.max(...rows.map(row => row.to)) : check.num(p.max, 'params.max', Math.max(...rows.map(row => row.to)), 1e15);
  if (!(max > 0)) check.fail('params.rows', 'need at least one value above 0');
  const W = rect.width;
  const chrome = titleBlock(b, {title: p.title, source: p.source, width: W});
  const area = {y: chrome.top, height: rect.height - chrome.top - chrome.bottom};
  const n = rows.length;
  const slot = area.height / n;
  const nameSize = r2(Math.max(b.min.key, Math.min(u(40), slot * 0.22)));
  const barH = r2(Math.min(u(110), slot * 0.5));
  if (barH < u(28)) check.fail('params.rows', 'leave bars thinner than 28 px; use fewer rows or a taller rect');
  const valueSize = r2(Math.max(b.min.key, Math.min(u(48), barH * 0.62)));
  const widestValue = Math.max(...rows.map(row => textWidth(fmt.format(row.to), valueSize, 'display')));
  const track = r2(W - widestValue - u(28));
  if (track < W * 0.4) check.fail('params.format', 'values are too wide to leave room for the bars');
  rows.forEach(row => { if (textWidth(row.label, nameSize, 'body') > W) check.fail('params.rows', `label ${JSON.stringify(row.label)} is too wide`); });
  const t0 = b.timeOf('build', p.at, 'params.at', 0.55);
  const t1 = rt(b.motion.exitStart - 0.05);
  if (t1 - t0 < 0.8) check.fail('params.at', 'leaves under 0.8 s for the bars to climb');
  b.events.push({id: `${b.id}-build`, name: 'build', time: t0, endTime: t1, role: 'emphasis', cue: 'tally', sfx: 'tick'});
  const minW = r2(barH * 0.6);
  const out = rows.map((row, i) => {
    const y = r2(area.y + slot * i + (slot - nameSize * 1.25 - barH - u(10)) / 2);
    const w = value => r2(minW + (track - minW) * (value / max));
    return {...row, y, barY: r2(y + nameSize * 1.25 + u(10)), w0: w(row.from), w1: w(row.to), initial: fmt.format(row.from),
      samples: countSamples(b.model, t0, rt(t1 - t0), 'none', row.from, row.to, value => fmt.format(value))};
  });
  const content = {variant: b.variant, rows: out, barH, nameSize, valueSize, track, t0, t1, title: chrome.title, source: chrome.source};
  return b.finish(content, {minTextPx: Math.min(nameSize, valueSize, chrome.title ? chrome.title.size : Infinity)});
}

function barsView(model) {
  const {id, fonts, theme, unit: u} = model;
  const c = model.content;
  const out = [...chromeNodes(model)];
  c.rows.forEach((row, i) => {
    out.push(label(`${id}-n${i}`, 0, row.y, model.rect.width, row.label, {size: c.nameSize, family: fonts.body, color: theme.foreground, weight: 650, extra: {opacity: 0}}));
    const depth = c.variant === 'slabs' ? Math.max(4, c.barH * 0.12) : 0;
    const face = c.variant === 'slabs' ? {background: tactileFace(row.color), boxShadow: tactileDepth(row.color, depth)} : {background: row.color};
    out.push(el('div', `${id}-b${i}`, {...abs(0, row.barY, row.w1, c.barH), ...face, borderRadius: r2(c.barH * 0.22), transformOrigin: '0% 50%'}));
    out.push(label(`${id}-v${i}`, r2(row.w1 + 14 * u), r2(row.barY + (c.barH - c.valueSize * 1.15) / 2), r2(c.track + 28 * u), row.initial,
      {size: c.valueSize, family: fonts.display, color: theme.foreground, lineHeight: 1.15, extra: {opacity: 0, fontVariantNumeric: 'tabular-nums'}}));
  });
  return out;
}

function barsTimeline(model, ops) {
  const {id, start, motion, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.rows.forEach((row, i) => {
    const enter = rt(motion.enterStart + 0.06 * i);
    riseOps(ops, `${id}-n${i}`, start, enter, r2(14 * u));
    // The bar is drawn at its final width and scaled, so it grows from its left edge.
    const s0 = r2(row.w0 / row.w1);
    set(ops, `${id}-b${i}`, start, {opacity: 0, scaleX: s0, scaleY: 1});
    tw(ops, `${id}-b${i}`, enter, 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-b${i}`, c.t0, rt(c.t1 - c.t0), 'none', {scaleX: s0}, {scaleX: 1});
    // The value rides the end of its bar.
    set(ops, `${id}-v${i}`, start, {opacity: 0, x: r2(row.w0 - row.w1)});
    tw(ops, `${id}-v${i}`, enter, 0.3, 'power2.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-v${i}`, c.t0, rt(c.t1 - c.t0), 'none', {x: r2(row.w0 - row.w1)}, {x: 0});
    countOps(ops, `${id}-v${i}`, start, row.initial, row.samples);
  });
}

export const liveBars = {
  id: 'live-bars',
  describe: 'Raised bars whose values tick up live for the whole scene: 2–6 rows, each bar growing from its start value to its end value while the number riding its end counts with it; thick tactile slabs or flat bars. For views, sales or totals climbing in real time.',
  params: {rows: '[{label ≤ 24, to ≥ 0, from? (default 0), tone? (primary | accent | paper | #rrggbb)}] 2–6', format: FORMAT_PARAM, max: 'the value of a full bar (optional; default the largest to)',
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `climb start: ${at}`, variant: VARIANT_PARAM, rect},
  events: ['build'], variants: BARS_VARIANTS,
  timing: timingRules({rules: ['the bars climb from at until just before the exit']}),
  resolve: barsResolve, view: barsView, timeline: barsTimeline
};

export const TACTILE_MODULES = [dropGrid, liveCounter, liveBars];
