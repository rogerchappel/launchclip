// Catalogue B module `flow-compare`: params → model (resolve), model → static
// element tree (view) and renderer-neutral animation ops (timeline).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.

import {alphaHex, createBase, fitText, mixColor, r2, rt, timingRules} from './catalog-b-base.mjs';
import {abs, el, hex2, set, text, transformString, tw} from './catalog-b-view.mjs';

const color = 'primary | accent | paper | #rrggbb (contrast ≥ 3:1 on bg)';
const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

// ---------------------------------------------------------------------------
// Model

function resolve(params, ctx) {
  const b = createBase('flow-compare', params, ctx, {allowed: ['top', 'bottom', 'title', 'note'], required: ['top', 'bottom']});
  const {check, u, rect, id, start} = b;
  const p = b.params;
  const lane = (name, fallbackColor) => {
    const raw = check.obj(p[name], `params.${name}`, ['label', 'rate', 'value', 'color', 'at'], ['label', 'rate']);
    return {name, label: check.str(raw.label, `params.${name}.label`, 22), rate: check.num(raw.rate, `params.${name}.rate`, 0.05, 100),
      value: raw.value === undefined ? null : check.str(raw.value, `params.${name}.value`, 10), color: b.resolveColor(raw.color, `params.${name}.color`, fallbackColor), at: raw.at};
  };
  const lanes = [lane('top', 'primary'), lane('bottom', 'accent')];
  if (lanes[0].rate === lanes[1].rate) check.fail('params.bottom.rate', 'must differ from params.top.rate; flow-compare contrasts two rates');
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 48);
  const note = p.note === undefined ? null : check.str(p.note, 'params.note', 60);
  const W = rect.width, H = rect.height;
  const titleFit = title ? fitText(check, 'params.title', title, {family: 'body', width: W, preferred: u(52), min: b.min.key, maxLines: 2}) : null;
  const noteFit = note ? fitText(check, 'params.note', note, {family: 'body', width: W, preferred: b.min.key, min: b.min.key, maxLines: 2}) : null;
  const titleHeight = titleFit ? titleFit.lines * titleFit.size * 1.12 + u(36) : 0;
  const noteHeight = noteFit ? noteFit.lines * noteFit.size * 1.25 + u(30) : 0;
  const maxRate = Math.max(...lanes.map(l => l.rate));
  const labelSize = b.min.key + u(4), tagSize = u(68);
  const rowHead = Math.max(labelSize * 1.2, tagSize * 1.0) + u(18);
  const maxPipe = u(170), minPipe = u(84);
  const blockGap = u(64);
  const pipes = lanes.map(l => r2(minPipe + (maxPipe - minPipe) * Math.sqrt(l.rate / maxRate)));
  const needed = titleHeight + noteHeight + rowHead * 2 + pipes[0] + pipes[1] + blockGap;
  if (needed > H) check.fail('params', 'content is taller than the module rect; drop the title or note');
  let y = titleHeight + (H - needed) / 2;
  const period = r2(u(320));
  const pattern = [{o: 0, dy: -0.18, s: 1}, {o: 0.27, dy: 0.16, s: 0.7}, {o: 0.53, dy: -0.04, s: 0.86}, {o: 0.79, dy: 0.2, s: 0.62}];
  const flowStartDefaults = [0.7, 1.25];
  const outLanes = lanes.map((l, i) => {
    const labelFit = fitText(check, `params.${l.name}.label`, l.label, {family: 'body', width: W * (l.value ? 0.62 : 1), preferred: labelSize, min: b.min.key});
    const tag = l.value ? {text: l.value.toUpperCase(), size: fitText(check, `params.${l.name}.value`, l.value.toUpperCase(), {family: 'display', width: W * 0.36, preferred: tagSize, min: b.min.key}).size} : null;
    const headY = y;
    const pipe = {x: 0, y: r2(y + rowHead), width: r2(W), height: pipes[i]};
    y = pipe.y + pipe.height + blockGap;
    const relative = l.rate / maxRate;
    const speed = r2(u(520) * relative);
    const particleH = r2(pipe.height * 0.26);
    const streak = r2(particleH * (1.2 + 3.2 * relative));
    const innerPad = r2(u(10));
    const inner = {x: innerPad, y: innerPad, width: r2(pipe.width - innerPad * 2), height: r2(pipe.height - innerPad * 2)};
    const count = Math.ceil((inner.width + period) / period) + 1;
    const particles = [];
    for (let k = 0; k < count; k++) for (const pt of pattern) {
      const h = r2(particleH * pt.s), w = r2(streak * pt.s);
      particles.push({x: r2(k * period + pt.o * period - w), y: r2(inner.height / 2 + pt.dy * inner.height - h / 2), width: w, height: h});
    }
    const time = b.timeOf(`${l.name}-flow`, l.at, `params.${l.name}.at`, flowStartDefaults[i]);
    const cycle = rt(period / speed);
    const repeats = Math.max(1, Math.ceil((b.end - time) / cycle));
    b.events.push({id: `${id}-${l.name}-flow`, name: `${l.name}-flow`, time, endTime: rt(time + 0.4), role: 'emphasis', cue: i ? 'whoosh-soft' : 'whoosh'});
    return {name: l.name, label: l.label, labelSize: labelFit.size, tag, color: l.color, rate: l.rate, relative: rt(relative), labelY: r2(headY + (rowHead - u(18) - labelSize * 1.2) / 2), tagY: r2(headY + (rowHead - u(18) - (tag ? tag.size : 0)) / 2),
      pipe, inner, wash: mixColor(l.color, b.theme.bg, 0.1), border: alphaHex(l.color, 0.55), glow: alphaHex(l.color, 0.4), particles, period, speed, cycle, repeats,
      time, fadeDuration: 0.4, chevrons: [0, 1, 2].map(k => ({x: r2(pipe.width - u(30) - (2 - k) * u(26)), opacity: rt(0.35 + 0.3 * k)})), chevronSize: r2(u(22))};
  });
  const content = {title: titleFit ? {text: title, size: titleFit.size, lines: titleFit.lines} : null, note: noteFit ? {text: note, size: noteFit.size, y: r2(H - noteHeight + u(30))} : null, lanes: outLanes};
  return b.finish(content, {minTextPx: Math.min(...outLanes.map(l => l.labelSize), titleFit ? titleFit.size : Infinity)});
}

/** Belt offset (px, ≤ 0) for a flow lane at absolute time t: frame-pure modulo. */
export function flowOffset(lane, t) {
  if (t <= lane.time) return -lane.period;
  const cycles = (t - lane.time) / lane.cycle; // one cycle moves the belt one period
  if (cycles >= lane.repeats) return 0;
  return -lane.period + (cycles - Math.floor(cycles)) * lane.period;
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const W = model.rect.width;
  const kids = [];
  if (c.title) kids.push(el('div', null, abs(0, 0, W, undefined, {margin: 0, fontFamily: fonts.body, fontWeight: 650, fontSize: c.title.size, lineHeight: '1.12', color: theme.foreground}), [c.title.text]));
  for (const lane of c.lanes) {
    kids.push(text(null, abs(0, lane.labelY, undefined, undefined, {fontFamily: fonts.body, fontWeight: 650, fontSize: lane.labelSize, lineHeight: '1.2', color: theme.foreground}), lane.label));
    if (lane.tag) kids.push(text(null, abs(0, lane.tagY, W, undefined, {textAlign: 'right', fontFamily: fonts.display, fontSize: lane.tag.size, lineHeight: '1', color: lane.color, letterSpacing: '0.02em'}), lane.tag.text));
    const P = lane.pipe, I = lane.inner;
    const particles = lane.particles.map(pt => el('div', null, abs(pt.x, pt.y, pt.width, pt.height, {borderRadius: pt.height / 2,
      background: `linear-gradient(90deg, ${hex2(lane.color, 0)} 0%, ${hex2(lane.color, 0.75)} 55%, ${theme.foreground} 100%)`, boxShadow: `0 0 ${16 * u}px ${lane.glow}`})));
    const mask = 'linear-gradient(90deg, transparent 0%, #000 9%, #000 86%, transparent 100%)';
    const chevrons = lane.chevrons.map(ch => el('div', null, abs(ch.x, P.height / 2 - lane.chevronSize / 2, lane.chevronSize, lane.chevronSize, {boxSizing: 'border-box',
      borderTop: `${4 * u}px solid ${lane.color}`, borderRight: `${4 * u}px solid ${lane.color}`, transform: 'rotate(45deg)', opacity: ch.opacity})));
    kids.push(el('div', null, abs(P.x, P.y, P.width, P.height, {boxSizing: 'border-box', borderRadius: P.height / 2, background: lane.wash, border: `${3 * u}px solid ${lane.border}`, boxShadow: `inset 0 0 ${28 * u}px ${lane.glow}`, overflow: 'hidden'}), [
      el('div', null, abs(I.x - 3 * u, I.y - 3 * u, I.width, I.height, {overflow: 'hidden', borderRadius: I.height / 2, WebkitMaskImage: mask, maskImage: mask}), [
        el('div', `${id}-${lane.name}-belt`, abs(0, 0, lane.particles.length ? lane.particles[lane.particles.length - 1].x + lane.period : I.width, I.height, {opacity: 0, transform: transformString({x: -lane.period})}), particles)
      ]),
      ...chevrons
    ]));
  }
  if (c.note) kids.push(el('div', null, abs(0, c.note.y, W, undefined, {margin: 0, textAlign: 'center', fontFamily: fonts.body, fontWeight: 500, fontSize: c.note.size, lineHeight: '1.25', color: theme.muted}), [c.note.text]));
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start} = model;
  for (const lane of model.content.lanes) {
    const target = `${id}-${lane.name}-belt`;
    set(ops, target, start, {opacity: 0, x: -lane.period, y: 0, scaleX: 1, scaleY: 1});
    tw(ops, target, lane.time, lane.fadeDuration, 'power1.out', {opacity: 0}, {opacity: 1});
    ops.push({type: 'loop', target, start: lane.time, cycle: lane.cycle, repeats: lane.repeats, from: {x: -lane.period}, to: {x: 0}});
  }
}

export const flowCompare = {
  id: 'flow-compare',
    describe: 'Two pipes whose particles stream at different rates: "big X → fast, small X → slow".',
    params: {top: `{label, rate (relative > 0), value? (tag such as "fast"), color?, at?}`, bottom: '{label, rate, value?, color?, at?}', title: 'string ≤ 48 (optional)', note: 'string ≤ 60 (optional)', rect},
    events: ['top-flow', 'bottom-flow'],
    timing: timingRules(),
  resolve,
  view,
  timeline
};
