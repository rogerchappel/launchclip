// Catalogue B module `process-steps`: params → model (resolve), model → static
// element tree (view) and renderer-neutral animation ops (timeline).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.

import {alphaHex, createBase, fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, text, transformString, tw} from './catalog-b-view.mjs';

const color = 'primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)';
const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

// ---------------------------------------------------------------------------
// Model

function resolve(params, ctx) {
  const b = createBase('process-steps', params, ctx, {allowed: ['steps', 'title', 'layout', 'numbered', 'color'], required: ['steps']});
  const {check, u, rect, id, start, portrait} = b;
  const p = b.params;
  const stepsIn = check.arr(p.steps, 'params.steps', 2, 5);
  const layout = p.layout === undefined ? (portrait ? 'vertical' : 'horizontal') : check.oneOf(p.layout, 'params.layout', ['vertical', 'horizontal']);
  const numbered = p.numbered === undefined ? true : check.bool(p.numbered, 'params.numbered');
  const color = b.resolveColor(p.color, 'params.color', 'primary');
  b.requireContrast('ink/step', b.colors.ink, color, 'brand.colors.ink on the step colour');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const W = rect.width, H = rect.height;
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(54), min: b.min.key, maxLines: 2}) : null;
  const titleHeight = titleFit ? titleFit.lines * titleFit.size * 1.12 + u(40) : 0;
  const n = stepsIn.length;
  const firstDefault = 0.7, spacing = (b.lastEvent - 0.4 - firstDefault) / Math.max(1, n - 1);
  const node = r2(u(layout === 'vertical' ? 96 : 104));
  let previous = -Infinity;
  const steps = stepsIn.map((raw, i) => {
    const path = `params.steps[${i}]`;
    const entry = typeof raw === 'string' ? {label: raw} : check.obj(raw, path, ['label', 'detail', 'at'], ['label']);
    const label = check.str(entry.label, `${path}.label`, 32);
    const detail = entry.detail === undefined ? null : check.str(entry.detail, `${path}.detail`, 64);
    const time = b.timeOf(`step-${i}`, entry.at, `${path}.at`, Math.min(b.lastEvent, firstDefault + spacing * i));
    if (time <= previous + 0.35) check.fail(`${path}.at`, `must come at least 0.35 s after the previous step (step ${i} settles at ${Math.round((previous - b.start) * 1000) / 1000} s, step ${i + 1} at ${Math.round((time - b.start) * 1000) / 1000} s in the scene): set it to ${Math.ceil((previous - b.start + 0.36) * 100 - 1e-6) / 100} or later`);
    previous = time;
    return {index: i, label, detail, time, number: String(i + 1)};
  });
  const labelPreferred = b.min.key + u(6), detailSize = r2(Math.max(b.min.meta, u(34)));
  if (layout === 'vertical') {
    const rowHeight = (H - titleHeight) / n;
    const textX = node + u(40), textW = W - textX;
    steps.forEach((s, i) => {
      const fit = fitText(check, `params.steps[${i}].label`, s.label, {family: 'body', width: textW, preferred: labelPreferred, min: b.min.key, maxLines: 2});
      const detailLines = s.detail ? fitText(check, `params.steps[${i}].detail`, s.detail, {family: 'body', width: textW, preferred: detailSize, min: detailSize, maxLines: 2}).lines : 0;
      const textH = fit.lines * fit.size * 1.12 + (detailLines ? u(10) + detailLines * detailSize * 1.3 : 0);
      if (textH > rowHeight - u(12)) check.fail(`params.steps[${i}]`, 'text is too tall for its row; shorten the label or detail');
      const cy = titleHeight + rowHeight * (i + 0.5);
      Object.assign(s, {labelSize: fit.size, labelLines: fit.lines, node: {x: 0, y: r2(cy - node / 2), size: node}, text: {x: r2(textX), y: r2(cy - Math.max(textH, node * 0.5) / 2), width: r2(textW)}, detailSize, detailLines});
    });
  } else {
    const colW = W / n, textW = colW - u(20);
    const nodeY = titleHeight + u(10);
    steps.forEach((s, i) => {
      const fit = fitText(check, `params.steps[${i}].label`, s.label, {family: 'body', width: textW, preferred: labelPreferred, min: b.min.key, maxLines: 2});
      const detailLines = s.detail ? fitText(check, `params.steps[${i}].detail`, s.detail, {family: 'body', width: textW, preferred: detailSize, min: detailSize, maxLines: 3}).lines : 0;
      const cx = colW * (i + 0.5);
      const textY = nodeY + node + u(28);
      if (textY + fit.lines * fit.size * 1.12 + (detailLines ? u(10) + detailLines * detailSize * 1.3 : 0) > H) check.fail(`params.steps[${i}]`, 'text is too tall for the rect');
      Object.assign(s, {labelSize: fit.size, labelLines: fit.lines, node: {x: r2(cx - node / 2), y: r2(nodeY), size: node}, text: {x: r2(cx - textW / 2), y: r2(textY), width: r2(textW)}, detailSize, detailLines});
    });
  }
  // Connectors between consecutive node centres; each fills as the next step lights.
  const track = r2(u(6));
  const connectors = steps.slice(1).map((s, i) => {
    const a = steps[i].node, c = s.node;
    const fillDuration = Math.min(0.45, s.time - steps[i].time - 0.05);
    if (layout === 'vertical') return {index: i, x: r2(a.x + a.size / 2 - track / 2), y: r2(a.y + a.size), width: track, height: r2(c.y - a.y - a.size), time: rt(s.time - fillDuration), duration: rt(fillDuration), axis: 'y'};
    return {index: i, x: r2(a.x + a.size), y: r2(a.y + a.size / 2 - track / 2), width: r2(c.x - a.x - a.size), height: track, time: rt(s.time - fillDuration), duration: rt(fillDuration), axis: 'x'};
  });
  for (const s of steps) {
    s.endTime = rt(s.time + 0.45);
    b.events.push({id: `${id}-step-${s.index}`, name: `step-${s.index}`, time: s.time, endTime: s.endTime, role: 'emphasis', cue: 'tick'});
  }
  steps.forEach((s, i) => { s.doneTime = i + 1 < steps.length ? steps[i + 1].time : null; });
  const content = {layout, numbered, color, glow: alphaHex(color, 0.35), halo: alphaHex(color, 0.22), title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines} : null,
    nodeBorder: r2(u(4)), numberSize: r2(u(layout === 'vertical' ? 44 : 48)), steps, connectors, track, idleOpacity: 0.42};
  return b.finish(content, {minTextPx: Math.min(...steps.map(s => s.labelSize), titleFit ? titleFit.size : Infinity)});
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = [];
  if (c.title) kids.push(el('div', null, abs(0, 0, W, undefined, {margin: 0, fontFamily: fonts.body, fontWeight: 650, fontSize: c.title.size, lineHeight: '1.12', color: theme.foreground, textAlign: c.layout === 'horizontal' ? 'center' : 'left'}), [c.title.text]));
  for (const k of c.connectors) {
    kids.push(el('div', null, abs(k.x, k.y, k.width, k.height, {background: theme.border, borderRadius: c.track / 2})));
    kids.push(el('div', `${id}-connector-${k.index}`, abs(k.x, k.y, k.width, k.height, {background: c.color, borderRadius: c.track / 2, boxShadow: `0 0 ${12 * u}px ${c.glow}`,
      transformOrigin: k.axis === 'y' ? '50% 0%' : '0% 50%', transform: transformString(k.axis === 'y' ? {scaleY: 0} : {scaleX: 0})})));
  }
  for (const s of c.steps) {
    const N = s.node;
    const halo = N.size + 30 * u;
    kids.push(el('div', `${id}-halo-${s.index}`, abs(N.x + N.size / 2 - halo / 2, N.y + N.size / 2 - halo / 2, halo, halo, {boxSizing: 'border-box', borderRadius: '50%', border: `${3 * u}px solid ${c.color}`, background: c.halo, opacity: 0, transform: transformString({scaleX: 0.7, scaleY: 0.7})})));
    const number = (color) => text(null, abs(0, 0, N.size, N.size, {display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: fonts.display, fontSize: c.numberSize, lineHeight: '1', color}), c.numbered ? s.number : '');
    kids.push(el('div', null, abs(N.x, N.y, N.size, N.size, {boxSizing: 'border-box', borderRadius: '50%', background: theme.bg, border: `${c.nodeBorder}px solid ${theme.border}`}), [number(theme.muted)]));
    kids.push(el('div', `${id}-node-${s.index}`, abs(N.x, N.y, N.size, N.size, {borderRadius: '50%', background: c.color, boxShadow: `0 0 ${32 * u}px ${c.glow}`, opacity: 0, transform: transformString({scaleX: 0.6, scaleY: 0.6})}), [number(theme.ink)]));
    const align = c.layout === 'horizontal' ? 'center' : 'left';
    const block = [el('div', null, {margin: 0, fontFamily: fonts.body, fontWeight: 650, fontSize: s.labelSize, lineHeight: '1.12', color: theme.foreground}, [s.label])];
    if (s.detail) block.push(el('div', null, {margin: 0, marginTop: 10 * u, fontFamily: fonts.body, fontWeight: 450, fontSize: s.detailSize, lineHeight: '1.3', color: theme.muted}, [s.detail]));
    kids.push(el('div', `${id}-text-${s.index}`, abs(s.text.x, s.text.y, s.text.width, undefined, {textAlign: align, opacity: c.idleOpacity, transform: transformString(c.layout === 'horizontal' ? {y: 14 * u} : {x: 18 * u})}), block));
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  for (const k of c.connectors) {
    const axis = k.axis === 'y' ? 'scaleY' : 'scaleX';
    set(ops, `${id}-connector-${k.index}`, start, {x: 0, y: 0, scaleX: axis === 'scaleX' ? 0 : 1, scaleY: axis === 'scaleY' ? 0 : 1});
    tw(ops, `${id}-connector-${k.index}`, k.time, k.duration, 'power2.inOut', {[axis]: 0}, {[axis]: 1});
  }
  const offset = c.layout === 'horizontal' ? {x: 0, y: 14 * u} : {x: 18 * u, y: 0};
  for (const s of c.steps) {
    set(ops, `${id}-node-${s.index}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.6, scaleY: 0.6});
    tw(ops, `${id}-node-${s.index}`, s.time, 0.18, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-node-${s.index}`, s.time, 0.45, 'back.out(2)', {scaleX: 0.6, scaleY: 0.6}, {scaleX: 1, scaleY: 1});
    set(ops, `${id}-halo-${s.index}`, start, {opacity: 0, x: 0, y: 0, scaleX: 0.7, scaleY: 0.7});
    tw(ops, `${id}-halo-${s.index}`, s.time + 0.05, 0.5, 'power3.out', {opacity: 0, scaleX: 0.7, scaleY: 0.7}, {opacity: 1, scaleX: 1, scaleY: 1});
    if (s.doneTime !== null) tw(ops, `${id}-halo-${s.index}`, s.doneTime, 0.35, 'power2.out', {opacity: 1}, {opacity: 0});
    set(ops, `${id}-text-${s.index}`, start, {opacity: c.idleOpacity, ...offset, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-text-${s.index}`, s.time + 0.05, 0.4, 'power3.out', {opacity: c.idleOpacity, ...offset}, {opacity: 1, x: 0, y: 0});
  }
}

export const processSteps = {
  id: 'process-steps',
    describe: 'A sequence or mechanism as 2–5 connected numbered nodes that light up in order.',
    params: {steps: '[string | {label ≤ 32, detail? ≤ 64, at?}] 2–5', title: 'string ≤ 48 (optional)', layout: '"vertical" (portrait default) | "horizontal"', numbered: 'boolean (default true)', color, rect},
    events: ['step-<i>'],
  resolve,
  view,
  timeline
};
