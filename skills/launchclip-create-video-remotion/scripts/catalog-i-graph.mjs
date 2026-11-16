// Catalogue I graph: node-graph, a team of 3–8 nodes (agents, services,
// steps) that flock out of a hub and fan above it on two staggered arcs,
// glowing wires that draw from each node into the hub, and pulses of light
// that run down the wires on the beat and light the hub as they land. At
// `converge` every wire fires at once: the hub takes the hit, the camera
// shakes and the nodes ripple. Every element breathes while it is on screen.
// docs/FLUID_MOTION_RFC.md §5; the motion patterns are kit/core/fluid-motion.mjs.
// Registered through kit/core/catalog-i-explain.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2, svgRoot} from './catalog-b-view.mjs';
import {grammarStagger} from './grammar.mjs';
import {VARIANT_PARAM, createHBase, inkOn, mixColor, textWidth, titleBlock, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, popOps, set, tw} from './catalog-h-view.mjs';
import {iconNode, isIcon} from './icons.mjs';
import {AT, RECT, r2, revealId, rt} from './catalog-i-base.mjs';
import {beatGrid, flockOps, hashUnit, idleAmplitude, idleOps, shakeOps, waveOps} from './fluid-motion.mjs';

const GRAPH_VARIANTS = Object.freeze(['fan']);
// Pulse: dash length (share of the wire) and travel time; a pulse lands on a beat.
export const PULSE = Object.freeze({length: 0.14, travel: 0.6, ease: 'power2.in', flow: 0.6});
const FLOCK = 0.8;

/**
 * Node centres in a fan above a hub at (0, 0): evenly spaced across, on two
 * staggered tiers past four nodes (neighbours alternate, so each only needs
 * half a card of width), drooping towards the ends and tilted outwards. The
 * tier gap grows until no two cards touch and none covers the hub.
 */
function fanLayout(n, {cardW, cardH, hubR, unit}) {
  const pad = 14 * unit, zig = n > 4;
  const tiers = Array.from({length: n}, (_, i) => (!zig ? 0 : n % 2 ? (Math.abs(i - (n - 1) / 2) + 1) % 2 : i % 2));
  const dx = zig ? (cardW + pad) / 2 : cardW + pad, half = Math.max(dx * (n - 1) / 2, 1), sag = cardH * 0.55;
  const lift = hubR + 36 * unit + cardH / 2;
  const place = gap => Array.from({length: n}, (_, i) => {
    const x = (i - (n - 1) / 2) * dx, k = x / half;
    return {x, y: -(lift + tiers[i] * gap) + sag * k * k, rotation: r2(k * 7), tier: tiers[i]};
  });
  const clear = nodes => nodes.every((a, i) => nodes.every((b, j) => j <= i || Math.abs(a.x - b.x) >= cardW + pad - 1e-6 || Math.abs(a.y - b.y) >= cardH + pad - 1e-6));
  let gap = cardH + pad, nodes = place(gap);
  for (let k = 0; k < 200 && !clear(nodes); k++) nodes = place(gap += 4 * unit);
  return nodes;
}

function graphResolve(params, ctx) {
  const b = createHBase('node-graph', params, ctx, {allowed: ['nodes', 'hub', 'tone', 'title', 'at', 'converge', 'bpm'], required: ['nodes', 'hub'], variants: GRAPH_VARIANTS});
  const {check, u, rect} = b;
  const p = b.params;
  const color = toneColor(b, p.tone, 'params.tone', 'accent');
  check.arr(p.nodes, 'params.nodes', 3, 8);
  const seen = new Set();
  const palette = b.series(p.nodes.length);
  const nodes = p.nodes.map((raw, i) => {
    const path = `params.nodes[${i}]`;
    const node = typeof raw === 'string' ? {label: raw} : check.obj(raw, path, ['id', 'label', 'icon'], ['label']);
    if (node.icon !== undefined && !isIcon(node.icon)) check.fail(`${path}.icon`, `must be an icon name from kit/core/icons.mjs (got ${JSON.stringify(node.icon)})`);
    return {id: revealId(check, node.id, `${path}.id`, `n${i}`, seen), label: check.str(node.label, `${path}.label`, 14), icon: node.icon ?? 'bot', color: palette[i], index: i};
  });
  const hubRaw = typeof p.hub === 'string' ? {label: p.hub} : check.obj(p.hub, 'params.hub', ['label', 'icon'], ['label']);
  if (hubRaw.icon !== undefined && !isIcon(hubRaw.icon)) check.fail('params.hub.icon', `must be an icon name from kit/core/icons.mjs (got ${JSON.stringify(hubRaw.icon)})`);
  const hub = {label: check.str(hubRaw.label, 'params.hub.label', 16), icon: hubRaw.icon ?? 'sparkles'};
  const bpm = p.bpm === undefined ? 120 : check.num(p.bpm, 'params.bpm', 60, 200);

  // Layout: measured at full size, then scaled once to fit the rect.
  const tb = titleBlock(b, {title: p.title});
  const W = rect.width, H = rect.height - tb.top;
  const hubSize = r2(Math.max(b.min.key, u(46)));
  const hubPillW = r2(textWidth(hub.label, hubSize, 'body', 0.02) + u(60)), hubPillH = r2(hubSize * 1.2 + u(26));
  if (hubPillW > W) check.fail('params.hub.label', 'is too wide for the rect; shorten it');
  const measure = s => {
    const labelSize = r2(Math.max(u(32) * s, 0)), icon = r2(u(66) * s);
    const cardW = r2(Math.max(u(160) * s, Math.max(...nodes.map(n => textWidth(n.label, labelSize, 'body'))) + u(40) * s));
    const cardH = r2(u(30) * s + icon + u(16) * s + labelSize * 1.25 + u(26) * s);
    const hubR = r2(u(100) * s);
    const fan = fanLayout(nodes.length, {cardW, cardH, hubR, unit: b.unit * s});
    const minX = Math.min(-hubPillW / 2, ...fan.map(f => f.x - cardW / 2)), maxX = Math.max(hubPillW / 2, ...fan.map(f => f.x + cardW / 2));
    const minY = Math.min(...fan.map(f => f.y - cardH / 2)), maxY = Math.max(hubR + u(22) + hubPillH, ...fan.map(f => f.y + cardH / 2));
    return {labelSize, icon, cardW, cardH, hubR, fan, minX, maxX, minY, maxY};
  };
  // The hub's label keeps its key size, so shrink the rest in steps until it all fits.
  const fits = M => M.maxX - M.minX <= W + 1e-6 && M.maxY - M.minY <= H + 1e-6;
  let L = measure(1);
  for (let s = Math.min(1, W / (L.maxX - L.minX), H / (L.maxY - L.minY)); !fits(L) && s > 0.3; s *= 0.96) L = measure(s);
  if (!fits(L)) check.fail('params.nodes', 'do not fit the rect; use fewer nodes or shorter labels');
  if (L.labelSize < b.min.meta) check.fail('params.nodes', `labels would be ${L.labelSize}px, under ${b.min.meta}px; use fewer nodes, shorter labels or a larger rect`);
  // Spread the fan to fill the rect (cards keep their size; wires get longer and nothing comes closer).
  const kx = Math.min(1.6, (W - L.cardW) / Math.max(1, Math.max(...L.fan.map(f => Math.abs(f.x))) * 2));
  const ky = Math.min(1.6, (H - (L.maxY - L.minY) + Math.abs(L.minY) - L.cardH / 2) / Math.max(1, Math.abs(L.minY) - L.cardH / 2));
  L.fan = L.fan.map(f => ({...f, x: f.x * Math.max(1, kx), y: f.y * Math.max(1, ky)}));
  L.minY = Math.min(...L.fan.map(f => f.y - L.cardH / 2));
  const hx = r2(W / 2), hy = r2(tb.top + (H - (L.maxY - L.minY)) / 2 - L.minY);
  nodes.forEach((n, i) => Object.assign(n, {cx: r2(hx + L.fan[i].x), cy: r2(hy + L.fan[i].y), rotation: L.fan[i].rotation}));

  // Timing on the beat grid (RFC §8): defaults snap to beats from the scene start.
  const grid = beatGrid(bpm, b.start), beat = grid.beat;
  // A pulse is shorter than a beat, so one wire's pulse is gone before the next one leaves.
  const travel = rt(Math.min(PULSE.travel, beat * 0.9));
  const rel = t => rt(t - b.start);
  const buildAt = b.timeOf('build', p.at, 'params.at', rel(grid.snap(b.start + 0.5)));
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: rt(buildAt + 0.55), role: 'emphasis', cue: 'pop'});
  // Flock order: the middle of the fan first, then outwards.
  const order = [...nodes].sort((a, c) => Math.abs(a.cx - hx) - Math.abs(c.cx - hx) || a.index - c.index);
  const gap = grammarStagger(ctx?.grammar ?? null, beat / 4, {min: 0.06, max: 0.3});
  order.forEach((n, k) => {
    const fallback = rel(buildAt + beat / 2 + k * gap + hashUnit(n.id) * 0.04 + FLOCK * 0.7);
    n.landAt = b.timeOf(`node-${n.id}`, undefined, `params.nodes[${n.index}]`, Math.min(fallback, b.lastEvent), {min: rel(buildAt) + FLOCK * 0.7});
    n.launchAt = rt(n.landAt - FLOCK * 0.7);
    n.wireAt = rt(n.landAt - 0.05);
    b.events.push({id: `${b.id}-node-${n.id}`, name: `node-${n.id}`, time: n.landAt, endTime: rt(n.landAt + 0.4), role: 'emphasis', cue: 'whoosh-soft'});
  });
  const wiresDone = Math.max(...nodes.map(n => n.wireAt + 0.45));
  const bar = beat * 4, latest = b.start + b.lastEvent;
  const barAt = rt(buildAt + Math.ceil((wiresDone + 2 * beat - buildAt) / bar - 1e-6) * bar);
  const floorBeat = rt(b.start + Math.floor((latest - b.start) / beat + 1e-6) * beat);
  // A short scene that has no beat left after the wires converges as soon as they are done.
  const earliest = rt(wiresDone + travel);
  const convergeAt = b.timeOf('converge', p.converge, 'params.converge', rel(barAt <= latest ? barAt : floorBeat >= earliest ? floorBeat : earliest), {min: rel(earliest)});
  b.events.push({id: `${b.id}-converge`, name: 'converge', time: convergeAt, endTime: rt(convergeAt + 0.6), role: 'emphasis', cue: 'impact'});

  // Pulses: one lands per beat, round the wires in fan order, none on a wire still busy;
  // every wire lands together at converge; then the round resumes until the exit.
  const pulses = [];
  const busy = nodes.map(n => n.wireAt + 0.45);
  let next = 0;
  const round = (from, to) => {
    for (let arrive = grid.snap(from); arrive <= to + 1e-6; arrive = rt(arrive + beat)) {
      for (let tries = 0; tries < nodes.length; tries++) {
        const k = (next + tries) % nodes.length;
        if (busy[k] <= arrive - travel - 0.02) { pulses.push({node: k, arrive}); busy[k] = arrive; next = k + 1; break; }
      }
    }
  };
  round(Math.min(...busy) + travel, convergeAt - 2 * beat);
  nodes.forEach((n, k) => { pulses.push({node: k, arrive: convergeAt, converge: true}); busy[k] = convergeAt; });
  round(convergeAt + 2 * beat, b.motion.exitStart - 0.1);
  pulses.sort((a, c) => a.arrive - c.arrive || a.node - c.node);

  const hubColor = color, ink = inkOn(b.colors, hubColor);
  b.requireContrast('hub/label', ink, hubColor, 'params.hub.label on its pill');
  const content = {variant: b.variant, title: tb.title, align: 'center', nodes, hub: {...hub, x: hx, y: hy, r: L.hubR, size: hubSize, pillW: hubPillW, pillH: hubPillH, color: hubColor, ink},
    card: {width: L.cardW, height: L.cardH, icon: L.icon, labelSize: L.labelSize}, pulses, travel, buildAt, convergeAt, beat, bpm, idle: idleAmplitude(ctx?.grammar ?? null, b.unit),
    buildEnd: rt(convergeAt + 0.6), fg: b.theme.foreground, panel: b.theme.panel, bg: b.theme.bg};
  return b.finish(content, {minTextPx: Math.min(hubSize, tb.title ? tb.title.size : Infinity)});
}

const wirePath = (n, hub) => {
  const my = r2((n.cy + hub.y) / 2);
  return `M${n.cx} ${n.cy} C${n.cx} ${my} ${r2(hub.x + (n.cx - hub.x) * 0.3)} ${r2(hub.y - (hub.y - n.cy) * 0.2)} ${hub.x} ${hub.y}`;
};

function graphView(model) {
  const {id, fonts, unit: u} = model;
  const c = model.content, h = c.hub, C = c.card;
  const W = model.rect.width, H = model.rect.height;
  const glow = (color, px) => `drop-shadow(0 0 ${r2(px * u)}px ${color})`;
  const wires = svgRoot(W, H, c.nodes.flatMap(n => {
    const d = wirePath(n, h);
    return [
      el('path', `${id}-wire-${n.id}`, {strokeDasharray: 1, strokeDashoffset: 1, opacity: 0, filter: glow(hex2(n.color, 0.7), 7)}, [], {d, stroke: hex2(n.color, 0.6), strokeWidth: r2(4 * u), strokeLinecap: 'round', fill: 'none', pathLength: 1}),
      el('path', `${id}-flow-${n.id}`, {strokeDasharray: '0.012 0.03', strokeDashoffset: 0, opacity: 0}, [], {d, stroke: mixColor(n.color, '#ffffff', 0.3), strokeWidth: r2(5 * u), strokeLinecap: 'round', fill: 'none', pathLength: 1}),
      el('path', `${id}-pulse-${n.id}`, {strokeDasharray: `${PULSE.length} 2`, strokeDashoffset: PULSE.length, opacity: 0, filter: `${glow(n.color, 10)} ${glow(hex2(n.color, 0.8), 4)}`}, [],
        {d, stroke: mixColor(n.color, '#ffffff', 0.55), strokeWidth: r2(10 * u), strokeLinecap: 'round', fill: 'none', pathLength: 1})
    ];
  }));
  const R = h.r;
  const ring = (rid, r, dash, opacity) => el('div', rid, {...abs(r2(R * 2 - r), r2(R * 2 - r), r2(r * 2), r2(r * 2)), boxSizing: 'border-box', borderRadius: '50%', border: `${r2(2 * u)}px ${dash} ${hex2(h.color, opacity)}`, transformOrigin: '50% 50%'});
  const hubNode = el('div', `${id}-hub`, {...abs(r2(h.x - R * 2), r2(h.y - R * 2), r2(R * 4), r2(R * 4)), opacity: 0, transformOrigin: '50% 50%'}, [
    el('div', `${id}-hub-idle`, {...abs(0, 0, r2(R * 4), r2(R * 4)), transformOrigin: '50% 50%'}, [
      el('div', `${id}-hub-glow`, {...abs(0, 0, r2(R * 4), r2(R * 4)), borderRadius: '50%', background: `radial-gradient(circle, ${hex2(h.color, 0.55)} 0%, ${hex2(h.color, 0.18)} 38%, ${hex2(h.color, 0)} 70%)`, opacity: 0.4}),
      ring(`${id}-orbit-0`, r2(R * 1.55), 'dashed', 0.45),
      ring(`${id}-orbit-1`, r2(R * 1.85), 'dotted', 0.3),
      ring(`${id}-hub-ring`, R, 'solid', 0.95),
      el('div', null, {...abs(R, R, r2(R * 2), r2(R * 2)), boxSizing: 'border-box', borderRadius: '50%', background: `radial-gradient(circle at 50% 35%, ${mixColor(h.color, model.theme.panel, 0.35)}, ${model.theme.panel} 75%)`,
        border: `${r2(4 * u)}px solid ${h.color}`, boxShadow: `0 0 ${r2(40 * u)}px ${hex2(h.color, 0.6)}, inset 0 0 ${r2(30 * u)}px ${hex2(h.color, 0.35)}`}, [
        iconNode(h.icon, {x: r2(R * 0.5), y: r2(R * 0.5), size: R, color: mixColor(h.color, '#ffffff', 0.35)})
      ])
    ])
  ]);
  const pill = el('div', `${id}-hub-label`, {...abs(r2(h.x - h.pillW / 2), r2(h.y + R + 22 * u), h.pillW, h.pillH), boxSizing: 'border-box', borderRadius: 999, background: h.color, boxShadow: `0 0 ${r2(30 * u)}px ${hex2(h.color, 0.6)}`, opacity: 0}, [
    label(null, 0, r2((h.pillH - h.size * 1.2) / 2), h.pillW, h.label.toUpperCase(), {size: h.size, family: fonts.body, color: h.ink, align: 'center', weight: 800, spacing: '0.02em'})
  ]);
  const cards = c.nodes.map(n => el('div', `${id}-node-${n.id}`, {...abs(r2(n.cx - C.width / 2), r2(n.cy - C.height / 2), C.width, C.height), opacity: 0, transformOrigin: '50% 50%'}, [
    el('div', `${id}-node-${n.id}-idle`, {...abs(0, 0, C.width, C.height), transformOrigin: '50% 80%'}, [
      el('div', null, {...abs(0, 0, C.width, C.height), boxSizing: 'border-box', borderRadius: r2(24 * u), background: `linear-gradient(165deg, ${mixColor(n.color, model.theme.panel, 0.16)}, ${model.theme.panel} 70%)`,
        border: `${r2(2.5 * u)}px solid ${hex2(n.color, 0.7)}`, boxShadow: `0 ${r2(14 * u)}px ${r2(34 * u)}px ${hex2('#000000', 0.45)}, 0 0 ${r2(22 * u)}px ${hex2(n.color, 0.25)}`}),
      el('div', `${id}-node-${n.id}-lit`, {...abs(0, 0, C.width, C.height), boxSizing: 'border-box', borderRadius: r2(24 * u), border: `${r2(4 * u)}px solid ${mixColor(n.color, '#ffffff', 0.4)}`, boxShadow: `0 0 ${r2(36 * u)}px ${n.color}, inset 0 0 ${r2(24 * u)}px ${hex2(n.color, 0.5)}`, opacity: 0}),
      iconNode(n.icon, {x: r2((C.width - C.icon) / 2), y: r2(30 * u * C.icon / (66 * u)), size: C.icon, color: n.color, mode: 'duotone'}),
      label(null, 0, r2(C.height - C.labelSize * 1.25 - 24 * u * C.icon / (66 * u)), C.width, n.label, {size: C.labelSize, family: fonts.body, color: c.fg, align: 'center', weight: 700, lineHeight: 1.25})
    ])
  ]));
  return [...chromeNodes(model), el('div', `${id}-cam`, {...abs(0, 0, W, H), transformOrigin: `${h.x}px ${h.y}px`}, [wires, hubNode, pill, ...cards])];
}

function graphTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content, h = c.hub;
  const settle = rt(motion.exitStart - 0.05);
  chromeOps(model, ops);
  // Camera: one slow push into the hub over the scene, and a shake on converge.
  set(ops, `${id}-cam`, start, {x: 0, y: 0, scaleX: 1, scaleY: 1});
  tw(ops, `${id}-cam`, c.buildAt, rt(settle - c.buildAt), 'power1.inOut', {scaleX: 1, scaleY: 1}, {scaleX: 1.05, scaleY: 1.05});
  shakeOps(ops, `${id}-cam`, c.convergeAt, r2(14 * u));
  // Hub: pops in, breathes, its orbits turn; punches on converge.
  popOps(ops, `${id}-hub`, start, c.buildAt, {from: 0.3, duration: 0.55, ease: 'power3.out', fade: 0.2});
  tw(ops, `${id}-hub`, c.convergeAt, 0.5, 'power3.out', {scaleX: 1.2, scaleY: 1.2}, {scaleX: 1, scaleY: 1});
  set(ops, `${id}-hub-label`, start, {opacity: 0, x: 0, y: r2(20 * u)});
  tw(ops, `${id}-hub-label`, rt(c.buildAt + 0.2), 0.45, 'power3.out', {opacity: 0, y: r2(20 * u)}, {opacity: 1, y: 0});
  idleOps(ops, `${id}-hub-idle`, start, rt(c.buildAt + 0.6), settle, c.idle);
  [[0, 50], [1, -35]].forEach(([k, turn]) => {
    set(ops, `${id}-orbit-${k}`, start, {rotation: 0});
    tw(ops, `${id}-orbit-${k}`, c.buildAt, rt(model.end - c.buildAt), 'none', {rotation: 0}, {rotation: turn});
  });
  set(ops, `${id}-hub-ring`, start, {opacity: 0, scaleX: 1, scaleY: 1});
  set(ops, `${id}-hub-glow`, start, {opacity: 0.4});
  // Nodes: flock out of the hub into the fan, then breathe; each wire draws as its node lands.
  flockOps(ops, c.nodes.map(n => ({id: `${id}-node-${n.id}`, x: n.cx, y: n.cy, rotation: n.rotation, at: n.launchAt})), start, {x: h.x, y: h.y}, {duration: FLOCK});
  c.nodes.forEach(n => {
    idleOps(ops, `${id}-node-${n.id}-idle`, start, rt(n.landAt + 0.35), settle, c.idle);
    set(ops, `${id}-node-${n.id}-lit`, start, {opacity: 0});
    set(ops, `${id}-wire-${n.id}`, start, {opacity: 0, strokeDashoffset: 1});
    tw(ops, `${id}-wire-${n.id}`, n.wireAt, 0.45, 'power2.inOut', {opacity: 1, strokeDashoffset: 1}, {opacity: 1, strokeDashoffset: 0});
    set(ops, `${id}-pulse-${n.id}`, start, {opacity: 0, strokeDashoffset: PULSE.length});
    // Work flowing into the hub all the time: dots stream down the wire once it is drawn (continuous, so linear).
    set(ops, `${id}-flow-${n.id}`, start, {opacity: 0, strokeDashoffset: 0});
    tw(ops, `${id}-flow-${n.id}`, rt(n.wireAt + 0.3), 0.3, 'power1.out', {opacity: 0}, {opacity: 0.85});
    tw(ops, `${id}-flow-${n.id}`, rt(n.wireAt + 0.3), rt(model.end - n.wireAt - 0.3), 'none', {strokeDashoffset: 0}, {strokeDashoffset: r2(-PULSE.flow * (model.end - n.wireAt - 0.3))});
  });
  // Pulses: each runs node → hub and lands on its beat; the node's rim lights as it leaves, the hub as it lands.
  for (const pulse of c.pulses) {
    const n = c.nodes[pulse.node], go = rt(pulse.arrive - c.travel);
    set(ops, `${id}-pulse-${n.id}`, go, {opacity: 1});
    tw(ops, `${id}-pulse-${n.id}`, go, c.travel, PULSE.ease, {strokeDashoffset: PULSE.length}, {strokeDashoffset: -1});
    tw(ops, `${id}-node-${n.id}-lit`, go, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-node-${n.id}-lit`, rt(go + 0.12), 0.5, 'power2.out', {opacity: 1}, {opacity: 0});
  }
  for (const arrive of [...new Set(c.pulses.map(pulse => pulse.arrive))]) {
    const big = arrive === c.convergeAt;
    tw(ops, `${id}-hub-ring`, rt(arrive - 0.06), 0.06, 'power1.out', {opacity: 0}, {opacity: 0.95});
    tw(ops, `${id}-hub-ring`, arrive, big ? 0.7 : 0.45, 'power2.out', {opacity: 0.95, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: big ? 2.3 : 1.55, scaleY: big ? 2.3 : 1.55});
    tw(ops, `${id}-hub-glow`, arrive, big ? 0.8 : 0.4, 'power2.out', {opacity: 1}, {opacity: 0.4});
  }
  waveOps(ops, c.nodes.map(n => ({id: `${id}-node-${n.id}`, x: n.cx})), rt(c.convergeAt + 0.04), r2(18 * u));
}

export const nodeGraph = {
  id: 'node-graph',
  describe: 'A team at work: 3–8 nodes (agents, tools, steps) with icons and short labels flock out of a hub ("director", "the model") and fan above it, glowing wires draw into the hub and pulses of light run down them on the beat, lighting the hub as they land; at converge every wire fires at once and the hub takes the hit. Every element keeps moving.',
  params: {nodes: '[label ≤ 14 | {label ≤ 14, icon? (kit/core/icons.mjs, default bot), id? (a reveal id; default n<i>)}] 3–8 (events node-<id>)', hub: 'the lead node: a label ≤ 16, or {label ≤ 16, icon? (default sparkles)}',
    tone: 'the hub and its pill: primary | accent (default) | paper | #rrggbb', title: 'string ≤ 60 (optional)', at: `build start: ${AT}`, converge: `every wire fires at once: ${AT}`,
    bpm: 'beats per minute for default timing, 60–200 (default 120): landings and pulses land on beats, converge on a bar line', variant: VARIANT_PARAM, rect: RECT},
  events: ['build', 'node-<id>', 'converge'], timing: timingRules({rules: ['the hub pops on the first beat after 0.5 s; nodes flock out from the middle of the fan outwards a quarter beat apart', 'a pulse lands on every beat once the wires are drawn; converge falls on the first bar line two beats after the last wire, or the last beat before the exit']}), variants: GRAPH_VARIANTS,
  // Anchors (RFC §7, kit/core/anchors.mjs): the hub as it pops and at converge, each card as it lands.
  anchors: model => [{name: 'hub', element: `${model.id}-hub`, event: 'build'}, {name: 'converge', element: `${model.id}-hub`, event: 'converge'},
    ...model.content.nodes.map(n => ({name: `node-${n.id}`, element: `${model.id}-node-${n.id}`, event: `node-${n.id}`}))],
  resolve: graphResolve, view: graphView, timeline: graphTimeline
};

export const GRAPHS = [nodeGraph];
