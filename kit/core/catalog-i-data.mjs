// Catalogue I data modules: race-bars (2–5 rows that fill like progress bars
// at their own speeds, each timer counting to its finish, then an "N×
// faster" badge on the winner) and small-multiples (a benchmark dashboard:
// 2–6 mini bar charts with one shared legend, each panel lighting up its
// winning bar). Registered through kit/core/catalog-i-explain.mjs.

import {decimalsOf, timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, fitText, inkOn, numberFormat, r2, rt, textWidth, titleBlock} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, el, fadeOps, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {DATA_TONE, dataTone} from './catalog-h-data.mjs';
import {iconNode, isIcon} from './icons.mjs';
import {AT, RECT, glassCard, pillNode} from './catalog-i-base.mjs';

// ---------------------------------------------------------------------------
// race-bars

const RACE_VARIANTS = Object.freeze(['bars', 'lanes']);

function raceResolve(params, ctx) {
  const b = createHBase('race-bars', params, ctx, {allowed: ['rows', 'badge', 'format', 'title', 'source', 'at', 'race', 'badgeAt'], required: ['rows'], variants: RACE_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.rows, 'params.rows', 2, 5);
  const tones = ['neutral', 'primary', 'accent', 'paper', 'neutral'];
  const rows = p.rows.map((row, i) => {
    check.obj(row, `params.rows[${i}]`, ['label', 'time', 'tone', 'icon'], ['label', 'time']);
    if (row.icon !== undefined && !isIcon(row.icon)) check.fail(`params.rows[${i}].icon`, `is not an icon name (got ${JSON.stringify(row.icon)})`);
    return {label: check.str(row.label, `params.rows[${i}].label`, 24), time: check.num(row.time, `params.rows[${i}].time`, 1e-6, 1e9), color: dataTone(b, row.tone, `params.rows[${i}].tone`, tones[i]), icon: row.icon ?? null};
  });
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: Math.max(0, ...rows.map(r => decimalsOf(r.time)))});
  const fastest = rows.reduce((best, r, i) => (r.time < rows[best].time ? i : best), 0);
  const slowest = Math.max(...rows.map(r => r.time));
  const ratio = slowest / rows[fastest].time;
  const auto = `${ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10}× faster`;
  const badgeText = p.badge === false ? null : p.badge === undefined ? (ratio >= 1.15 ? auto : null) : check.str(p.badge, 'params.badge', 24);
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width, H = rect.height - tb.top - tb.bottom;
  const lanes = b.variant === 'lanes';

  // Layout: label (and icon) over each track; the timer at the track's end.
  const labelSize = Math.min(...rows.map((r, i) => fitText(check, `params.rows[${i}].label`, r.label, {family: 'body', width: W * 0.7, preferred: u(48), min: b.min.key}).size));
  const timerSize = r2(Math.max(b.min.key, u(b.portrait ? 52 : 48)));
  const timerW = Math.max(...rows.map(r => textWidth(fmt.format(r.time), timerSize, 'display'))) + u(30);
  const trackH = u((lanes ? 64 : 40) * (b.portrait ? 1.3 : 1));
  const rowH = labelSize * 1.25 + u(12) + trackH;
  const gap = Math.min(u(b.portrait ? 110 : 56), (H - rows.length * rowH) / Math.max(1, rows.length - 1));
  if (gap < u(16)) check.fail('params.rows', 'do not fit the rect; use fewer rows, drop the title or enlarge rect');
  const blockH = rows.length * rowH + (rows.length - 1) * gap;
  const y0 = r2(tb.top + (H - blockH) / 2);
  const iconSize = r2(labelSize * 1.05);
  const track = {x: 0, width: r2(W - timerW)};

  // Timing: the rows land, then the race; each fills at constant speed and
  // finishes in proportion to its time; the slowest takes `race` seconds.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.5), role: 'emphasis', cue: 'whoosh-soft'});
  const raceAt = b.timeOf('race', undefined, 'params.at (race start)', buildAt - b.start + 0.6);
  const room = b.lastEvent - (raceAt - b.start) - (badgeText ? 0.6 : 0.2);
  const race = p.race === undefined ? Math.max(0.8, Math.min(3.2, room)) : check.num(p.race, 'params.race', 0.6, Math.max(0.6, room));
  if (race > room + 1e-6) check.fail('params.race', `leaves no room before the exit; at most ${r2(room)} s`);
  b.events.push({id: `${b.id}-race`, name: 'race', time: raceAt, endTime: rt(raceAt + race), role: 'emphasis', cue: 'riser'});
  const items = rows.map((r, i) => {
    const y = r2(y0 + i * (rowH + gap));
    const duration = rt(race * r.time / slowest);
    const finish = rt(raceAt + duration);
    b.events.push({id: `${b.id}-finish-${i}`, name: `finish-${i}`, time: finish, role: 'emphasis', cue: i === fastest ? 'impact' : 'tick'});
    return {...r, y, labelY: y, trackY: r2(y + labelSize * 1.25 + u(12)), duration, finish, time: rt(buildAt + i * 0.08), winner: i === fastest,
      ink: inkOn(b.colors, r.color), samples: countSamples(b.model, raceAt, duration, 'none', 0, r.time, fmt.format), text: fmt.format(r.time)};
  });
  let badge = null;
  if (badgeText) {
    const at = b.timeOf('badge', p.badgeAt, 'params.badgeAt', Math.min(b.lastEvent, items[fastest].finish - b.start + 0.25), {min: items[fastest].finish - b.start - 1e-6});
    b.events.push({id: `${b.id}-badge`, name: 'badge', time: at, endTime: rt(at + 0.5), role: 'emphasis', cue: 'hit-soft'});
    const size = r2(Math.max(b.min.key, u(44)));
    const w = r2(textWidth(badgeText, size, 'body') + u(48)), h = r2(size * 1.2 + u(22));
    const winner = items[fastest];
    const x = r2(Math.max(0, Math.min(track.width - w, textWidth(winner.label, labelSize, 'body') + (winner.icon ? iconSize + u(14) : 0) + u(28))));
    badge = {text: badgeText, size, box: {x, y: r2(winner.labelY + labelSize * 0.6 - h / 2), width: w, height: h}, at, color: winner.color, ink: inkOn(b.colors, winner.color)};
  }
  const content = {variant: b.variant, title: tb.title, source: tb.source, rows: items, track, trackH, labelSize, timerSize, timerW, iconSize, raceAt, race, badge, buildAt, buildEnd: rt(raceAt + race),
    ink: b.theme.foreground, muted: b.theme.muted, border: b.theme.border, bg: b.theme.bg};
  return b.finish(content, {minTextPx: Math.min(labelSize, timerSize, badge?.size ?? Infinity, tb.title ? tb.title.size : Infinity)});
}

function raceView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  const W = model.rect.width;
  const lanes = c.variant === 'lanes';
  c.rows.forEach((r, i) => {
    const kid = [];
    let lx = 0;
    if (r.icon) { kid.push(iconNode(r.icon, {x: 0, y: r2(c.labelSize * 0.1), size: c.iconSize, color: r.color})); lx = r2(c.iconSize + 14 * u); }
    kid.push(label(null, lx, 0, r2(c.track.width - lx), r.label, {size: c.labelSize, family: fonts.body, color: c.ink, weight: 650, lineHeight: 1.25}));
    kids.push(el('div', `${id}-row-${i}`, abs(0, r.labelY, W, r2(r.trackY - r.labelY + c.trackH), {opacity: 0}), [
      ...kid,
      el('div', null, abs(0, r2(r.trackY - r.labelY), c.track.width, c.trackH, {borderRadius: lanes ? r2(14 * u) : c.trackH, background: c.border, overflow: 'hidden'}), [
        el('div', `${id}-fill-${i}`, abs(0, 0, c.track.width, c.trackH, {borderRadius: lanes ? r2(14 * u) : c.trackH, background: lanes ? `linear-gradient(90deg, ${hex2(r.color, 0.35)}, ${r.color})` : r.color,
          transformOrigin: '0% 50%', transform: 'scale(0, 1)', ...(r.winner ? {boxShadow: `0 0 ${r2(22 * u)}px ${hex2(r.color, 0.7)}`} : {})}))
      ])
    ]));
    kids.push(label(`${id}-timer-${i}`, r2(c.track.width + 20 * u), r2(r.trackY + c.trackH / 2 - c.timerSize * 0.6), r2(c.timerW - 20 * u), '0', {size: c.timerSize, family: fonts.display, color: r.winner ? r.color : c.ink, lineHeight: 1.2, extra: {opacity: 0}}));
    if (r.winner) {
      const d = r2(c.trackH * 0.7);
      kids.push(el('div', `${id}-flag-${i}`, abs(r2(c.track.width - d - 10 * u), r2(r.trackY + (c.trackH - d) / 2), d, d, {borderRadius: '50%', background: r.ink, opacity: 0}), [
        iconNode('check', {x: r2(d * 0.15), y: r2(d * 0.15), size: r2(d * 0.7), color: r.color, stroke: 3})
      ]));
    }
  });
  if (c.badge) kids.push(pillNode(`${id}-badge`, c.badge.box, c.badge.text, {size: c.badge.size, family: fonts.body, color: c.badge.ink, background: c.badge.color, glow: {blur: r2(26 * u), color: hex2(c.badge.color, 0.6)}, weight: 800, extra: {opacity: 0}}));
  return kids;
}

function raceTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.rows.forEach((r, i) => {
    riseOps(ops, `${id}-row-${i}`, start, r.time, r2(20 * u));
    set(ops, `${id}-fill-${i}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
    tw(ops, `${id}-fill-${i}`, c.raceAt, r.duration, 'none', {scaleX: 0}, {scaleX: 1});
    set(ops, `${id}-timer-${i}`, start, {opacity: 0});
    tw(ops, `${id}-timer-${i}`, rt(c.raceAt - 0.15), 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    countOps(ops, `${id}-timer-${i}`, start, c.rows[i].samples[0]?.text ?? '0', r.samples);
    if (r.winner) popOps(ops, `${id}-flag-${i}`, start, r.finish, {from: 0.3, duration: 0.4, ease: 'back.out(2.4)'});
  });
  if (c.badge) popOps(ops, `${id}-badge`, start, c.badge.at, {from: 0.5, duration: 0.5, ease: 'back.out(2)'});
}

export const raceBars = {
  id: 'race-bars',
  describe: 'A race: 2–5 rows fill like progress bars at their own speeds, each timer counting to its finish, the fastest ticking first; then an "N× faster" badge lands on the winner ("3× faster", "1h 26m vs 4h 10m").',
  params: {rows: `[{label ≤ 24, time (how long it takes, any unit), tone? (${DATA_TONE}), icon?}] 2–5`, badge: 'string ≤ 24 on the winner (optional; default "N× faster" from the times; false for none)',
    format: `the timers: ${FORMAT_PARAM}`, race: 'seconds the slowest row takes to fill (optional; default up to 3.2 s, fitting the scene)', badgeAt: `the badge: ${AT}`,
    title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'race', 'finish-<i>', 'badge'], timing: timingRules({rules: ['rows land from at, the race starts 0.6 s later; each row finishes in proportion to its time', 'the badge follows the winner\'s finish']}), variants: RACE_VARIANTS,
  resolve: raceResolve, view: raceView, timeline: raceTimeline
};

// ---------------------------------------------------------------------------
// small-multiples

const MULTI_VARIANTS = Object.freeze(['glass', 'flat']);

function multiResolve(params, ctx) {
  const b = createHBase('small-multiples', params, ctx, {allowed: ['series', 'panels', 'format', 'title', 'source', 'at', 'highlightAt', 'columns'], required: ['series', 'panels'], variants: MULTI_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  check.arr(p.series, 'params.series', 2, 4);
  const palette = b.series(p.series.length);
  const series = p.series.map((s, i) => {
    const raw = typeof s === 'string' ? {label: s} : check.obj(s, `params.series[${i}]`, ['label', 'tone'], ['label']);
    return {label: check.str(raw.label, `params.series[${i}].label`, 20), color: raw.tone === undefined ? palette[i] : dataTone(b, raw.tone, `params.series[${i}].tone`)};
  });
  check.arr(p.panels, 'params.panels', 2, 6);
  const panels = p.panels.map((panel, i) => {
    check.obj(panel, `params.panels[${i}]`, ['title', 'values', 'highlight', 'note'], ['title', 'values']);
    check.arr(panel.values, `params.panels[${i}].values`, series.length, series.length);
    const values = panel.values.map((v, j) => check.num(v, `params.panels[${i}].values[${j}]`, 0, 1e12));
    const best = values.reduce((k, v, j) => (v > values[k] ? j : k), 0);
    return {title: check.str(panel.title, `params.panels[${i}].title`, 24), values, highlight: panel.highlight === undefined ? best : check.int(panel.highlight, `params.panels[${i}].highlight`, 0, series.length - 1),
      note: panel.note === undefined ? null : check.str(panel.note, `params.panels[${i}].note`, 16)};
  });
  const fmt = numberFormat(check, p.format, 'params.format', {decimals: Math.max(0, ...panels.flatMap(panel => panel.values.map(decimalsOf)))});
  const tb = titleBlock(b, {title: p.title, source: p.source});
  const W = rect.width;
  const n = panels.length;
  const cols = p.columns === undefined ? (b.portrait ? (n <= 2 ? 1 : 2) : Math.min(n, n === 4 ? 2 : 3)) : check.int(p.columns, 'params.columns', 1, n);
  const gridRows = Math.ceil(n / cols);
  const legendSize = r2(Math.max(b.min.meta, u(30)));
  const legendH = r2(legendSize * 1.4 + u(22));
  const gap = u(28);
  const top = tb.top + legendH;
  const H = rect.height - top - tb.bottom;
  const cellW = (W - gap * (cols - 1)) / cols, cellH = (H - gap * (gridRows - 1)) / gridRows;
  const pad = u(24);
  const titleSize = Math.min(u(40), ...panels.map((panel, i) => fitText(check, `params.panels[${i}].title`, panel.title, {family: 'body', width: cellW - 2 * pad, preferred: u(40), min: b.min.meta}).size));
  const valueSize = r2(Math.max(b.min.meta, u(30)));
  const plotTop = pad + titleSize * 1.25 + u(10) + valueSize * 1.3;
  const plotH = cellH - plotTop - pad;
  if (plotH < u(70)) check.fail('params.panels', 'leave too little height for the bars; use fewer panels, more columns or drop the title');
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const step = Math.min(0.18, 1 / n);
  const buildEnd = rt(buildAt + step * (n - 1) + 0.8);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'tally'});
  const highlightAt = b.timeOf('highlight', p.highlightAt, 'params.highlightAt', Math.min(b.lastEvent, buildEnd - b.start + 0.4), {min: buildAt - b.start + 0.2});
  b.events.push({id: `${b.id}-highlight`, name: 'highlight', time: highlightAt, endTime: rt(highlightAt + 0.5), role: 'emphasis', cue: 'hit-soft'});
  const S = series.length;
  const items = panels.map((panel, i) => {
    const x = r2((i % cols) * (cellW + gap)), y = r2(top + Math.floor(i / cols) * (cellH + gap));
    const max = Math.max(...panel.values) || 1;
    const slot = (cellW - 2 * pad) / S;
    const barW = r2(Math.min(slot * 0.68, u(90)));
    const t0 = rt(buildAt + i * step);
    return {...panel, box: {x, y, width: r2(cellW), height: r2(cellH)}, t0,
      bars: panel.values.map((v, j) => {
        const h = r2(Math.max(u(4), plotH * v / max * 0.92));
        const bx = r2(pad + slot * j + (slot - barW) / 2);
        return {x: bx, width: barW, height: h, y: r2(plotTop + plotH - h), color: series[j].color, text: fmt.format(v), time: rt(t0 + 0.15 + j * 0.06), winner: j === panel.highlight};
      })};
  });
  const content = {variant: b.variant, title: tb.title, source: tb.source, series, panels: items, legendSize, legendY: r2(tb.top), titleSize, valueSize, pad, plotTop, plotH, buildAt, buildEnd, highlightAt,
    ink: b.theme.foreground, muted: b.theme.muted, border: b.theme.border, accent: b.colors.accent};
  return b.finish(content, {minTextPx: tb.title ? tb.title.size : b.min.key});
}

function multiView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content;
  const kids = chromeNodes(model);
  let lx = 0;
  c.series.forEach((s, j) => {
    const w = r2(c.legendSize * 1.1 + textWidth(s.label, c.legendSize, 'body') + 40 * u);
    kids.push(el('div', `${id}-legend-${j}`, abs(r2(lx), c.legendY, w, r2(c.legendSize * 1.4), {opacity: 0}), [
      el('div', null, abs(0, r2(c.legendSize * 0.25), r2(c.legendSize * 0.85), r2(c.legendSize * 0.85), {borderRadius: r2(6 * u), background: s.color})),
      label(null, r2(c.legendSize * 0.85 + 12 * u), 0, undefined, s.label, {size: c.legendSize, family: fonts.body, color: c.ink, weight: 600, lineHeight: 1.4})
    ]));
    lx += w;
  });
  c.panels.forEach((panel, i) => {
    const B = panel.box, pre = `${id}-m${i}`;
    const inner = [label(null, c.pad, c.pad, r2(B.width - 2 * c.pad), panel.title, {size: c.titleSize, family: fonts.body, color: c.ink, weight: 700, lineHeight: 1.25}),
      el('div', null, abs(c.pad, r2(c.plotTop + c.plotH), r2(B.width - 2 * c.pad), r2(2 * u), {background: c.border}))];
    panel.bars.forEach((bar, j) => {
      inner.push(el('div', `${pre}-bar-${j}`, abs(bar.x, bar.y, bar.width, bar.height, {borderRadius: `${r2(8 * u)}px ${r2(8 * u)}px 0 0`, background: bar.color, transformOrigin: '50% 100%', transform: 'scale(1, 0)',
})));
      if (bar.winner) {
        inner.push(el('div', `${pre}-glow-${j}`, abs(r2(bar.x - 6 * u), r2(bar.y - 6 * u), r2(bar.width + 12 * u), r2(bar.height + 6 * u), {boxSizing: 'border-box', borderRadius: `${r2(12 * u)}px ${r2(12 * u)}px 0 0`,
          border: `${r2(3 * u)}px solid ${bar.color}`, borderBottom: 'none', boxShadow: `0 0 ${r2(24 * u)}px ${hex2(bar.color, 0.65)}`, opacity: 0})));
        inner.push(label(`${pre}-val-${j}`, r2(bar.x - 60 * u), r2(bar.y - c.valueSize * 1.3 - 8 * u), r2(bar.width + 120 * u), bar.text, {size: c.valueSize, family: fonts.display, color: bar.color, align: 'center', extra: {opacity: 0}}));
      }
    });
    if (panel.note) inner.push(label(`${pre}-note`, c.pad, r2(c.pad + c.titleSize * 1.25 + 4 * u), r2(B.width - 2 * c.pad), panel.note, {size: c.valueSize, family: fonts.meta, color: c.muted, extra: {opacity: 0}}));
    const card = c.variant === 'glass' ? glassCard(`${pre}-card`, model, {x: B.x, y: B.y, width: B.width, height: B.height}, c.accent, inner, {radius: 20, extra: {opacity: 0}})
      : el('div', `${pre}-card`, {...abs(B.x, B.y, B.width, B.height), boxSizing: 'border-box', borderRadius: r2(16 * u), background: model.theme.panel, opacity: 0}, inner);
    kids.push(card);
  });
  return kids;
}

function multiTimeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  c.series.forEach((_, j) => riseOps(ops, `${id}-legend-${j}`, start, rt(c.buildAt - 0.15 + j * 0.06), r2(10 * u)));
  c.panels.forEach((panel, i) => {
    const pre = `${id}-m${i}`;
    popOps(ops, `${pre}-card`, start, panel.t0, {from: 0.94, duration: 0.45, ease: 'power3.out', fade: 0.25});
    if (panel.note) riseOps(ops, `${pre}-note`, start, rt(panel.t0 + 0.2), 0);
    panel.bars.forEach((bar, j) => {
      set(ops, `${pre}-bar-${j}`, start, {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 0});
      tw(ops, `${pre}-bar-${j}`, bar.time, 0.6, 'power3.out', {scaleY: 0}, {scaleY: 1});
      if (bar.winner) {
        set(ops, `${pre}-glow-${j}`, start, {opacity: 0});
        tw(ops, `${pre}-glow-${j}`, c.highlightAt, 0.4, 'power2.out', {opacity: 0}, {opacity: 1});
        riseOps(ops, `${pre}-val-${j}`, start, rt(c.highlightAt + 0.1), r2(12 * u));
      } else fadeOps(ops, `${pre}-bar-${j}`, c.highlightAt, 1, 0.38, 0.4);
    });
  });
}

export const smallMultiples = {
  id: 'small-multiples',
  describe: 'A benchmark dashboard: 2–6 mini bar charts (one per test) in a grid of glass cards under one shared legend; the bars grow panel by panel, then each panel lights its winning bar with a glow and its value while the rest dim.',
  params: {series: `[label | {label ≤ 20, tone? (${DATA_TONE})}] 2–4, the shared legend (one bar per series in every panel)`,
    panels: '[{title ≤ 24, values: [number per series], highlight? (series index; default the largest), note? ≤ 16}] 2–6', columns: 'integer (optional; default 1–2 in portrait, 2–3 in landscape)',
    format: FORMAT_PARAM, highlightAt: `the highlight: ${AT}`, title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `build start: ${AT}`, variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'highlight'], timing: timingRules({rules: ['panels land up to 0.18 s apart from at, bars grow in 0.6 s', 'the highlight follows the build']}), variants: MULTI_VARIANTS,
  resolve: multiResolve, view: multiView, timeline: multiTimeline
};

export const DATA_I = [raceBars, smallMultiples];
