// Catalogue B module `gauge-compare`: params → model (resolve), model → static
// element tree (view) and renderer-neutral animation ops (timeline).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.

import {CATALOG_B_STYLE, alphaHex, createBase, decimalsOf, fitText, formatNumber, frameSamples, mixColor, niceStep, overlaps, parseExpression, progress, r2, rt, textWidth, ticks, withUnit} from './catalog-b-base.mjs';
import {abs, el, hex2, sampleTime, set, svgRoot, text, transformString, tw} from './catalog-b-view.mjs';

const color = 'primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)';
const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

// ---------------------------------------------------------------------------
// Model

function resolve(params, ctx) {
  const b = createBase('gauge-compare', params, ctx, {allowed: ['left', 'right', 'gap', 'scale', 'title', 'style', 'decimals'], required: ['left', 'right']});
  const {check, u, rect, id, start, fps} = b;
  const p = b.params;
  const style = p.style === undefined ? 'thermometer' : check.oneOf(p.style, 'params.style', ['thermometer', 'column']);
  const side = (name, fallbackColor) => {
    const raw = check.obj(p[name], `params.${name}`, ['label', 'value', 'unit', 'color', 'at'], ['label', 'value']);
    return {label: check.str(raw.label, `params.${name}.label`, 16), value: check.num(raw.value, `params.${name}.value`, -1e6, 1e6),
      unit: raw.unit === undefined ? '' : check.str(raw.unit, `params.${name}.unit`, 8), color: b.resolveColor(raw.color, `params.${name}.color`, fallbackColor), at: raw.at};
  };
  const L = side('left', 'primary'), R = side('right', 'accent');
  if (L.unit !== R.unit) check.fail('params.right.unit', `must match params.left.unit ("${L.unit}") so the gauges share a scale`);
  const unit = L.unit;
  const decimals = p.decimals === undefined ? Math.max(decimalsOf(L.value), decimalsOf(R.value)) : check.int(p.decimals, 'params.decimals', 0, 2);
  let scaleMin = Math.min(0, L.value, R.value), scaleMax = Math.max(L.value, R.value);
  scaleMax = Math.ceil(scaleMax * 1.08 / niceStep(scaleMax - scaleMin, 5)) * niceStep(scaleMax - scaleMin, 5);
  if (p.scale !== undefined) {
    check.obj(p.scale, 'params.scale', ['min', 'max'], ['min', 'max']);
    scaleMin = check.num(p.scale.min, 'params.scale.min', -1e6, Math.min(L.value, R.value));
    scaleMax = check.num(p.scale.max, 'params.scale.max', Math.max(L.value, R.value), 1e6);
    if (!(scaleMax > scaleMin)) check.fail('params.scale', 'max must be greater than min');
  }
  const diff = Math.abs(L.value - R.value);
  let gap = null;
  if (p.gap !== false) {
    const raw = p.gap === undefined ? {} : check.obj(p.gap, 'params.gap', ['object', 'label', 'value', 'unit', 'at']);
    const object = raw.object === undefined ? 'gap-bracket' : raw.object;
    if (typeof object !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(object)) check.fail('params.gap.object', 'must be a lowercase object name such as gap-bracket');
    const value = raw.value === undefined ? diff : check.num(raw.value, 'params.gap.value', 0, 1e6);
    if (Math.abs(value - diff) > Math.max(1e-6, diff * 0.005)) check.fail('params.gap.value', `is ${value} but |left.value − right.value| is ${formatNumber(diff, decimals)}`);
    const gapUnit = raw.unit === undefined ? unit : check.str(raw.unit, 'params.gap.unit', 8);
    if (gapUnit !== unit) check.fail('params.gap.unit', `must match the gauge unit ("${unit}")`);
    gap = {object, label: raw.label === undefined ? 'Gap' : check.str(raw.label, 'params.gap.label', 12), value, unit, at: raw.at};
  }
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);

  const W = rect.width, H = rect.height;
  // Event timing
  const avail = b.lastEvent - 0.6;
  const leftTime = b.timeOf('left-fill', L.at, 'params.left.at', 0.6);
  const rightTime = b.timeOf('right-fill', R.at, 'params.right.at', Math.min(b.lastEvent, Math.max(leftTime - start + 0.9, 0.6 + avail * 0.32)));
  const fillDuration = 1.0, fillEase = 'power3.out';
  let gapTime = null;
  if (gap) gapTime = b.timeOf('gap-bracket', gap.at, 'params.gap.at', Math.min(b.lastEvent - 0.4, Math.max(rightTime - start + 1.0, 0.6 + avail * 0.68)), {max: b.lastEvent - 0.4});
  if (gap && gapTime < Math.max(leftTime, rightTime) + 0.35 - 1e-9) check.fail('params.gap.at', 'must come at least 0.35 s after both gauges start filling');

  // Geometry (rect-local)
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(52), min: b.min.key, maxLines: 1}) : null;
  const titleHeight = titleFit ? titleFit.size * 1.2 + u(28) : 0;
  const labelSize = b.min.key + u(4), readoutSize = u(116);
  const colX = [W * 0.19, W * 0.81];
  const colWidth = W * 0.36;
  const tubeW = r2(u(style === 'thermometer' ? 118 : 150)), bulbD = style === 'thermometer' ? r2(u(196)) : 0;
  const top = titleHeight + labelSize * 1.2 + u(6) + readoutSize * 1.02 + u(22);
  const tubeBottom = H - (style === 'thermometer' ? bulbD * 0.82 : u(6));
  const tubeHeight = tubeBottom - top;
  if (tubeHeight < u(300)) check.fail('params', 'leaves too little height for the gauges; drop the title or enlarge rect');
  const inset = r2(u(style === 'thermometer' ? 20 : 16));
  // value→y mapping range; a thermometer's fill continues into the bulb.
  const spanTop = top + inset + u(6), spanBottom = style === 'thermometer' ? tubeBottom : tubeBottom - inset;
  const extra = bulbD ? r2(bulbD * 0.3) : 0;
  const valueY = v => spanBottom - (v - scaleMin) / (scaleMax - scaleMin) * (spanBottom - spanTop);
  const fmtValue = v => withUnit(formatNumber(v, decimals), unit);
  const gauges = [L, R].map((g, i) => {
    const name = i ? 'right' : 'left';
    const labelFit = fitText(check, `params.${name}.label`, g.label, {family: 'body', width: colWidth, preferred: labelSize, min: b.min.key});
    const readoutFit = fitText(check, `params.${name}.value`, fmtValue(g.value), {family: 'display', width: colWidth + u(40), preferred: readoutSize, min: u(72)});
    const time = i ? rightTime : leftTime;
    const fraction = (g.value - scaleMin) / (scaleMax - scaleMin);
    const majorStep = niceStep(scaleMax - scaleMin, 5);
    const tickMarks = ticks(scaleMin, scaleMax, 10).map(v => ({y: r2(valueY(v)), major: Math.abs(v / majorStep - Math.round(v / majorStep)) < 1e-6}));
    const samples = frameSamples(time, time + fillDuration, fps, t => ({text: fmtValue(scaleMin + (g.value - scaleMin) * progress(t, time, fillDuration, fillEase))}));
    return {name, label: g.label, labelSize: labelFit.size, value: g.value, text: fmtValue(g.value), initialText: fmtValue(scaleMin), readoutSize: readoutFit.size, color: g.color,
      glow: alphaHex(g.color, 0.4), highlight: mixColor('#ffffff', g.color, 0.38), cx: r2(colX[i]), labelY: r2(titleHeight), readoutY: r2(titleHeight + labelSize * 1.2 + u(6)),
      tube: {x: r2(colX[i] - tubeW / 2), y: r2(top), width: tubeW, height: r2(tubeHeight)},
      bulb: bulbD ? {x: r2(colX[i] - bulbD / 2), y: r2(tubeBottom - bulbD * 0.18), size: bulbD} : null,
      // The fill grows from its bottom edge (transform-origin bottom).
      fill: {x: r2(colX[i] - tubeW / 2 + inset), y: r2(spanTop), width: r2(tubeW - inset * 2), height: r2(spanBottom - spanTop + extra),
        scaleFrom: rt(extra / (spanBottom - spanTop + extra)), scaleTo: rt((extra + fraction * (spanBottom - spanTop)) / (spanBottom - spanTop + extra))},
      level: r2(valueY(g.value)), ticks: tickMarks, time, endTime: rt(time + fillDuration), duration: fillDuration, ease: fillEase, samples};
  });
  for (const g of gauges) {
    b.events.push({id: `${id}-${g.name}-fill`, name: `${g.name}-fill`, time: g.time, endTime: g.endTime, role: 'emphasis', cue: 'riser-short'});
  }
  let bracket = null;
  if (gap) {
    const x = r2(W / 2), yTop = Math.min(gauges[0].level, gauges[1].level), yBottom = Math.max(gauges[0].level, gauges[1].level);
    const cap = u(18);
    const topSide = gauges[0].level <= gauges[1].level ? -1 : 1; // -1: the top level belongs to the left gauge
    const text = withUnit(formatNumber(gap.value, decimals), gap.unit);
    const valueSize = fitText(check, 'params.gap.value', text, {family: 'display', width: W * 0.34, preferred: u(88), min: b.min.key}).size;
    const labelText = gap.label.toUpperCase();
    const pill = {width: r2(Math.max(textWidth(text, valueSize, 'display'), textWidth(labelText, u(26), 'meta', 0.14)) + u(48)), height: r2(valueSize * 1.02 + u(26) * 1.3 + u(26))};
    pill.x = r2(x - pill.width / 2);
    pill.y = r2(Math.min(Math.max((yTop + yBottom) / 2 - pill.height / 2, 0), H - pill.height));
    const leftEdge = gauges[0].tube.x + gauges[0].tube.width + u(10), rightEdge = gauges[1].tube.x - u(10);
    if (pill.x < leftEdge || pill.x + pill.width > rightEdge) check.fail('params.gap', `label "${text}" is too wide for the space between the gauges`);
    bracket = {object: gap.object, label: labelText, labelSize: r2(u(26)), text, valueSize, x, yTop: r2(yTop), yBottom: r2(yBottom), cap: r2(cap),
      path: `M${r2(x + topSide * cap)} ${r2(yTop)} L${x} ${r2(yTop)} L${x} ${r2(yBottom)} L${r2(x - topSide * cap)} ${r2(yBottom)}`,
      strokeWidth: r2(u(5)), color: b.theme.paper,
      levels: gauges.map((g, i) => ({x: r2(i ? x : g.tube.x + g.tube.width + u(6)), y: g.level, width: r2(i ? g.tube.x - u(6) - x : x - (g.tube.x + g.tube.width + u(6))), color: g.color})),
      pill, time: gapTime, levelTime: gapTime, bracketTime: rt(gapTime + 0.1), pillTime: rt(gapTime + 0.25), endTime: rt(gapTime + 0.7)};
    const rectCanvas = {x: r2(rect.x + Math.min(pill.x, x - cap)), y: r2(rect.y + Math.min(yTop, pill.y)), width: r2(Math.max(pill.width, cap + pill.width / 2)), height: r2(Math.max(yBottom, pill.y + pill.height) - Math.min(yTop, pill.y))};
    bracket.rectCanvas = rectCanvas;
    b.model.objects[gap.object] = {rect: rectCanvas, color: b.theme.paper, time: gapTime};
    b.events.push({id: `${id}-gap-bracket`, name: 'gap-bracket', time: gapTime, endTime: bracket.endTime, role: 'emphasis', cue: 'riser-short', object: gap.object});
  }
  const content = {style, title: titleFit ? {text: title, size: titleFit.size} : null, scale: {min: scaleMin, max: scaleMax}, unit, decimals, gauges, bracket,
    tubeFill: b.theme.panel, tubeBorder: b.theme.border, tubeBorderWidth: r2(u(3))};
  return b.finish(content, {minTextPx: Math.min(...gauges.map(g => g.labelSize), titleFit ? titleFit.size : Infinity, bracket ? bracket.valueSize : Infinity)});
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = [];
  if (c.title) kids.push(text(null, abs(0, 0, W, undefined, {textAlign: 'center', fontFamily: fonts.body, fontWeight: 650, fontSize: c.title.size, lineHeight: '1.2', color: theme.foreground}), c.title.text));
  const svg = [];
  c.gauges.forEach((g, i) => {
    const colW = W * 0.4;
    kids.push(text(null, abs(g.cx - colW / 2, g.labelY, colW, undefined, {textAlign: 'center', fontFamily: fonts.body, fontWeight: 650, fontSize: g.labelSize, lineHeight: '1.2', color: theme.foreground}), g.label));
    kids.push(text(`${id}-${g.name}-readout`, abs(g.cx - colW / 2 - 20 * u, g.readoutY, colW + 40 * u, undefined, {textAlign: 'center', fontFamily: fonts.display, fontSize: g.readoutSize, lineHeight: '1.02', color: g.color}), g.initialText));
    const T = g.tube;
    // Ticks on the outer side of each tube.
    for (const tick of g.ticks) {
      const w = (tick.major ? 22 : 12) * u;
      const x = i === 0 ? T.x - 10 * u - w : T.x + T.width + 10 * u;
      kids.push(el('div', null, abs(x, tick.y - u, w, 2 * u, {background: tick.major ? theme.muted : theme.border})));
    }
    kids.push(el('div', null, abs(T.x, T.y, T.width, T.height, {boxSizing: 'border-box', borderRadius: T.width / 2, background: c.tubeFill, border: `${c.tubeBorderWidth}px solid ${c.tubeBorder}`})));
    const F = g.fill;
    kids.push(el('div', `${id}-${g.name}-fill`, abs(F.x, F.y, F.width, F.height, {borderRadius: F.width / 2, background: `linear-gradient(90deg, ${g.color} 0%, ${g.highlight} 34%, ${g.color} 68%)`,
      boxShadow: `0 0 ${24 * u}px ${g.glow}`, transformOrigin: '50% 100%', transform: transformString({scaleY: F.scaleFrom})})));
    if (g.bulb) {
      kids.push(el('div', null, abs(g.bulb.x, g.bulb.y, g.bulb.size, g.bulb.size, {borderRadius: '50%', background: `radial-gradient(circle at 34% 30%, ${g.highlight} 0%, ${g.color} 46%, ${g.color} 100%)`, boxShadow: `0 0 ${56 * u}px ${g.glow}`})));
      kids.push(el('div', null, abs(g.bulb.x + g.bulb.size * 0.24, g.bulb.y + g.bulb.size * 0.2, g.bulb.size * 0.2, g.bulb.size * 0.2, {borderRadius: '50%', background: hex2('#ffffff', 0.35)})));
    }
    kids.push(el('div', null, abs(T.x + T.width * 0.24, T.y + T.width * 0.4, Math.max(2, T.width * 0.1), T.height - T.width * 0.8, {borderRadius: 99, background: hex2('#ffffff', 0.14)})));
  });
  if (c.bracket) {
    const B = c.bracket;
    B.levels.forEach((level, i) => kids.push(el('div', `${id}-level-${i}`, abs(level.x, level.y - 1.5 * u, level.width, 3 * u, {
      background: `repeating-linear-gradient(90deg, ${level.color} 0px, ${level.color} ${10 * u}px, transparent ${10 * u}px, transparent ${18 * u}px)`, transformOrigin: i === 0 ? '0% 50%' : '100% 50%', transform: transformString({scaleX: 0})}))));
    svg.push(el('path', `${id}-bracket`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: B.path, stroke: B.color, strokeWidth: B.strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', pathLength: 1}));
    kids.push(svgRoot(W, model.rect.height, svg));
    const pill = B.pill;
    kids.push(el('div', `${id}-${B.object}`, abs(pill.x, pill.y, pill.width, pill.height, {boxSizing: 'border-box', borderRadius: 26 * u, background: theme.bg, border: `${2 * u}px solid ${hex2(theme.foreground, 0.32)}`,
      boxShadow: `0 ${12 * u}px ${36 * u}px #00000099`, opacity: 0, transform: transformString({scaleX: 0.6, scaleY: 0.6}), transformOrigin: '50% 50%'}), [
      text(null, abs(0, 13 * u, pill.width, undefined, {textAlign: 'center', fontFamily: fonts.meta, fontSize: B.labelSize, lineHeight: '1.3', letterSpacing: '0.14em', color: theme.muted}), B.label),
      text(null, abs(0, 13 * u + B.labelSize * 1.3, pill.width, undefined, {textAlign: 'center', fontFamily: fonts.display, fontSize: B.valueSize, lineHeight: '1.02', color: theme.foreground}), B.text)
    ]));
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  for (const g of c.gauges) {
    set(ops, `${id}-${g.name}-fill`, start, {x: 0, y: 0, scaleX: 1, scaleY: g.fill.scaleFrom});
    tw(ops, `${id}-${g.name}-fill`, g.time, g.duration, g.ease, {scaleY: g.fill.scaleFrom}, {scaleY: g.fill.scaleTo});
    set(ops, `${id}-${g.name}-readout`, start, {text: g.initialText});
    for (const s of g.samples) set(ops, `${id}-${g.name}-readout`, sampleTime(s.t), {text: s.text});
  }
  if (c.bracket) {
    const B = c.bracket;
    B.levels.forEach((_, i) => {
      set(ops, `${id}-level-${i}`, start, {x: 0, y: 0, scaleX: 0, scaleY: 1});
      tw(ops, `${id}-level-${i}`, B.levelTime + i * 0.06, 0.35, 'power2.out', {scaleX: 0}, {scaleX: 1});
    });
    set(ops, `${id}-bracket`, start, {strokeDashoffset: 1});
    tw(ops, `${id}-bracket`, B.bracketTime, 0.45, 'power3.out', {strokeDashoffset: 1}, {strokeDashoffset: 0});
    set(ops, `${id}-${B.object}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.6, scaleY: 0.6});
    tw(ops, `${id}-${B.object}`, B.pillTime, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-${B.object}`, B.pillTime, 0.45, 'back.out(1.6)', {scaleX: 0.6, scaleY: 0.6}, {scaleX: 1, scaleY: 1});
  }
}

export const gaugeCompare = {
  id: 'gauge-compare',
    describe: 'Two thermometer (or column) gauges fill to their values with count-up readouts, then a bracket measures the gap between them (shared object for morphs).',
    params: {left: `{label, value, unit?, color? (${color}), at? (${at})}`, right: '{label, value, unit?, color?, at?} — same unit as left',
      gap: '{object? ("gap-bracket"), label? ("Gap"), value? (must equal |left − right|), unit?, at?} or false', scale: '{min, max} (optional, default 0..nice max)',
      title: 'string ≤ 48 (optional)', style: '"thermometer" | "column"', decimals: 'integer 0–2', rect},
    events: ['left-fill', 'right-fill', 'gap-bracket'],
  resolve,
  view,
  timeline
};
