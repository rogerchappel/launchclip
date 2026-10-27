// Catalogue I 3D data objects, devices: device-box (a GPU server or
// appliance on a grid floor: compute cards with spinning fans on its top, a
// screen in front with a live readout counting up and an uptime clock
// ticking once a second). Drawn on the CSS 3D rig in
// kit/core/catalog-i-3d-base.mjs; registered in kit/core/catalog-i-3d.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2, sampleTime} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, mixColor, numberFormat, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, el, label, riseOps, set, tw} from './catalog-h-view.mjs';
import {ORBIT_PARAM, at3d, billboard, boxFaces, camera, cueTime, dropIn, fitScene, floorGlow, floorGrid, glassFaces, group, minScale, orbitOf, rect3d, rigNodes, rigOps, sceneBox, slot, stand, up2} from './catalog-i-3d-base.mjs';

const DEVICE_VARIANTS = Object.freeze(['server', 'appliance']);
// server: a wide chassis with compute cards; appliance: a compact box with one large fan.
const WORLD = {server: {w: 1000, d: 600, h: 96, tilt: 52, heading: -16}, appliance: {w: 560, d: 520, h: 230, tilt: 58, heading: -20}};
const CLOCK = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

function clockText(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function deviceResolve(params, ctx) {
  const b = createHBase('device-box', params, ctx, {allowed: ['name', 'units', 'unitLabel', 'readout', 'clock', 'tone', 'orbit', 'title', 'source', 'at'], required: ['readout'], variants: DEVICE_VARIANTS});
  const {check, u} = b;
  const p = b.params;
  const server = b.variant === 'server';
  const world = WORLD[b.variant];
  const name = p.name === undefined ? null : check.str(p.name, 'params.name', 24);
  const units = p.units === undefined ? (server ? 4 : 1) : check.int(p.units, 'params.units', 1, server ? 8 : 1);
  const unitLabel = p.unitLabel === undefined ? (server ? 'GPU' : null) : check.str(p.unitLabel, 'params.unitLabel', 6);
  check.obj(p.readout, 'params.readout', ['label', 'from', 'to', 'format', 'at', 'duration'], ['label', 'to']);
  const r = p.readout;
  const readout = {label: check.str(r.label, 'params.readout.label', 14), from: r.from === undefined ? 0 : check.num(r.from, 'params.readout.from', 0, 1e12), to: check.num(r.to, 'params.readout.to', 0, 1e12),
    fmt: numberFormat(check, r.format, 'params.readout.format'), at: r.at, duration: r.duration === undefined ? null : check.num(r.duration, 'params.readout.duration', 0.5, 600)};
  let clock = null;
  if (p.clock !== undefined) {
    check.obj(p.clock, 'params.clock', ['label', 'start'], ['start']);
    const m = CLOCK.exec(check.str(p.clock.start, 'params.clock.start', 9));
    if (!m) check.fail('params.clock.start', 'must be H:MM:SS or HH:MM:SS ("03:17:42")');
    clock = {label: p.clock.label === undefined ? 'uptime' : check.str(p.clock.label, 'params.clock.label', 10), start: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])};
  }
  const tone = toneColor(b, p.tone, 'params.tone', 'accent');
  const box = sceneBox(b, p);
  const cam = camera({tilt: world.tilt, perspective: r2(3 * Math.max(box.W, box.H)), orbit: orbitOf(check, p.orbit, 10, world.heading), zoom: [1, 1.08]});

  // The screen stands in front of the chassis, leaning back to face the camera.
  // The clock sits beside the readout when both fit across, else under it.
  const lean = 90 - world.tilt;
  const readLabel = `${readout.label}: `;
  const longest = `${readLabel}${readout.fmt.format(Math.max(readout.from, readout.to))}`;
  const nameSize = name ? Math.max(b.min.meta, u(30)) : 0;
  const nameBox = name ? {w: textWidth(name, nameSize, 'meta') * 1.12 + u(30), h: nameSize * 1.4} : null;
  const across = (text, room, pref) => Math.min(pref, room / textWidth(text, 1, 'display'));
  let layout = null;
  for (const stacked of clock ? [false, true] : [false]) {
    const screen = {w: world.w * (server ? 0.86 : 1.08), h: stacked ? 300 : (server ? 170 : 150), gap: 40};
    const geometry = k => ({w: world.w * k, d: world.d * k, h: world.h * k, sw: screen.w * k, sh: screen.h * k, sy: (world.d / 2 + screen.gap + screen.h * Math.sin(lean * Math.PI / 180)) * k});
    const build = k => {
      const g = geometry(k), points = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const z of [0, g.h]) points.push([sx * g.w / 2, sy * g.d / 2, z]);
      const c = Math.cos(lean * Math.PI / 180), s = Math.sin(lean * Math.PI / 180);
      for (const sx of [-1, 1]) for (const t of [0, g.sh]) points.push([sx * g.sw / 2, g.sy - t * s, t * c]);
      return {points, labels: nameBox ? [{at: [0, -g.d / 2, g.h + u(24)], ...nameBox, ax: 0.5, ay: 1}] : []};
    };
    const fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre});
    const g = geometry(fit.k);
    // Screen text in screen px: the plane faces the camera, so its scale is the magnification.
    const ms = minScale(cam, [0, g.sy, g.sh / 2]);
    const room = g.sw * ms * 0.94 - u(60);
    const rows = stacked ? 2 : 1;
    const readRoom = clock && !stacked ? room * 0.62 : room;
    let size = Math.min(across(longest, readRoom, u(b.portrait ? 80 : 72)), (g.sh * ms / rows - u(30)) / 1.25);
    const clockSize = clock ? Math.min(size * 0.9, across('00:00:00', stacked ? room * 0.6 : room * 0.38 - u(20), size)) : 0;
    if (size >= b.min.key && (!clock || clockSize >= b.min.key)) { layout = {stacked, fit, g, ms, size: Math.floor(size), clockSize: Math.floor(clockSize)}; break; }
  }
  if (!layout) check.fail('params.readout', 'does not fit the screen at key text size; shorten the label or drop the clock');
  const {fit, g, ms, size, clockSize} = layout;
  const clockLabelSize = clock ? Math.max(b.min.meta, u(28)) : 0;

  // Timing
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const buildEnd = rt(buildAt + 0.9);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: 'whoosh-soft'});
  const readAt = cueTime(b, 'readout', readout.at, 'params.readout.at', buildEnd - b.start + 0.2, buildEnd - b.start);
  const readEnd = Math.min(b.end - 0.05, rt(readAt + (readout.duration ?? Math.max(0.8, b.lastEvent + b.start - readAt))));
  b.events.push({id: `${b.id}-readout`, name: 'readout', time: readAt, endTime: readEnd, role: 'emphasis', cue: 'tick'});
  const fmt = v => `${readLabel}${readout.fmt.format(Math.round(v))}`;
  const samples = readout.to === readout.from ? [] : countSamples(b.model, readAt, readEnd - readAt, 'none', readout.from, readout.to, fmt);
  // One set a second for the clock, on whole seconds of the scene.
  const ticks = [];
  if (clock) for (let s = 1; b.start + s < b.end; s++) ticks.push({t: rt(b.start + s), text: clockText(clock.start + s)});
  const content = {variant: b.variant, title: box.tb.title, source: box.tb.source, align: 'center', cam, W: box.W, H: box.H, k: fit.k, ...Object.fromEntries(Object.entries(g).map(([key, v]) => [key, r2(v)])), lean,
    name: name ? {text: name, size: up2(nameSize / Math.min(1, minScale(cam, [0, -g.d / 2, g.h + u(24)])))} : null, units, unitLabel, unitSize: up2(Math.max(b.min.meta, u(26)) / Math.min(1, ms)),
    readout: {initial: fmt(readout.from), size: up2(size / ms), samples, at: readAt}, clock: clock ? {label: clock.label, stacked: layout.stacked, initial: clockText(clock.start), size: up2(clockSize / ms), labelSize: up2(clockLabelSize / ms), ticks} : null,
    tone, buildAt, buildEnd, dropH: r2(160 * u), spin: server ? 1.6 : 0.8};
  return b.finish(content, {minTextPx: r2(Math.min(size, clock ? clockSize : Infinity, box.tb.title ? box.tb.title.size : Infinity))});
}

/** A fan: a dark well with a spinning rotor (target `${id}`) of `blades` blades. */
function fan(id, x, y, d, tone, u) {
  const rotor = r2(d * 0.86);
  return el('div', null, abs(r2(x - d / 2), r2(y - d / 2), r2(d), r2(d), {borderRadius: '50%', background: 'radial-gradient(circle, #05070c 0%, #0b1018 70%, #1a222e 100%)', boxShadow: `inset 0 0 0 ${r2(3 * u)}px ${hex2(tone, 0.35)}`}), [
    el('div', id, abs(r2((d - rotor) / 2), r2((d - rotor) / 2), rotor, rotor, {borderRadius: '50%', transformOrigin: '50% 50%',
      background: `radial-gradient(circle, #2a3442 0%, #2a3442 16%, transparent 17%), repeating-conic-gradient(from 0deg, ${hex2(tone, 0.55)} 0deg 14deg, #0d131c 14deg 45deg)`}))
  ]);
}

function deviceView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const floor = [floorGrid(`${id}-grid`, c.tone, 0, r2(c.d * 0.15), r2(c.w * 2.6), r2(c.d * 3.4), r2(120 * u), u, 0.2), floorGlow(`${id}-pool`, c.tone, 0, 0, r2(c.w * 1.6), r2(c.d * 1.8), 0.22)];
  const metal = glassFaces(theme, mixColor(theme.bg, c.tone, 0.25), u, {strength: 0.7});
  const top = [];
  const fans = [];
  if (c.variant === 'server') {
    const cols = Math.min(4, c.units), rows = Math.ceil(c.units / cols);
    const pad = r2(c.w * 0.04), cw = r2((c.w - pad * (cols + 1)) / cols), ch = r2((c.d - pad * (rows + 1)) / rows);
    for (let i = 0; i < c.units; i++) {
      const x = r2(pad + (i % cols) * (cw + pad)), y = r2(pad + Math.floor(i / cols) * (ch + pad));
      const fd = r2(Math.min(cw * 0.78, (ch - c.unitSize * 1.6) / 2.15));
      const card = [fan(`${id}-fan${i}a`, cw / 2, r2(fd * 0.55 + pad * 0.4), fd, c.tone, u), fan(`${id}-fan${i}b`, cw / 2, r2(fd * 1.62 + pad * 0.5), fd, c.tone, u)];
      fans.push(`${id}-fan${i}a`, `${id}-fan${i}b`);
      if (c.unitLabel) card.push(label(null, 0, r2(ch - c.unitSize * 1.4), cw, `${c.unitLabel} ${i}`, {size: c.unitSize, family: fonts.meta, color: theme.foreground, align: 'center', spacing: '0.08em'}));
      top.push(el('div', null, abs(x, y, cw, ch, {borderRadius: r2(10 * u), background: `linear-gradient(160deg, #1b2532 0%, #0c1119 100%)`, border: `${r2(2 * u)}px solid ${hex2(c.tone, 0.4)}`, boxSizing: 'border-box'}), card));
    }
  } else {
    const fd = r2(Math.min(c.w, c.d) * 0.72);
    top.push(fan(`${id}-fan0a`, r2(c.w / 2), r2(c.d / 2), fd, c.tone, u));
    fans.push(`${id}-fan0a`);
  }
  const chassis = {...metal, top: {background: `linear-gradient(160deg, #111822 0%, #070a10 100%)`, border: metal.top.border, boxShadow: `inset 0 0 ${r2(30 * u)}px ${hex2(c.tone, 0.25)}`}};
  const body = group(`${id}-g`, boxFaces(`${id}-box`, {w: c.w, h: c.h, d: c.d}, chassis, {top}));
  floor.push(slot(null, 0, 0, [stand([body])]));

  // The screen: a bezel leaning back by `lean`, the readout and the clock on it.
  const bezel = r2(14 * u);
  const sw = c.sw, sh = c.sh;
  const screenKids = [
    el('div', null, abs(0, 0, sw, sh, {borderRadius: r2(18 * u), background: 'linear-gradient(180deg, #121a26 0%, #070b11 100%)', border: `${r2(2 * u)}px solid ${hex2(c.tone, 0.5)}`, boxSizing: 'border-box'})),
    el('div', `${id}-lcd`, abs(bezel, bezel, r2(sw - 2 * bezel), r2(sh - 2 * bezel), {opacity: 0, borderRadius: r2(10 * u), background: `linear-gradient(180deg, ${hex2(c.tone, 0.22)} 0%, ${hex2(c.tone, 0.08)} 100%)`,
      boxShadow: `inset 0 0 ${r2(30 * u)}px ${hex2(c.tone, 0.4)}, 0 0 ${r2(30 * u)}px ${hex2(c.tone, 0.3)}`}))
  ];
  const stacked = c.clock?.stacked;
  const textY = r2((stacked ? sh * 0.3 : sh / 2) - c.readout.size * 0.62);
  screenKids.push(label(`${id}-read`, r2(bezel + 26 * u), textY, r2(sw * (c.clock && !stacked ? 0.62 : 1) - 40 * u), c.readout.initial, {size: c.readout.size, family: fonts.display, color: theme.foreground, extra: {opacity: 0, textShadow: `0 0 ${r2(16 * u)}px ${hex2(c.tone, 0.7)}`}}));
  if (c.clock && stacked) {
    const w = r2(sw - 2 * bezel - 52 * u), x = r2(bezel + 26 * u);
    screenKids.push(el('div', null, abs(x, r2(sh * 0.53), w, 0, {borderTop: `${r2(3 * u)}px dotted ${hex2(theme.foreground, 0.5)}`})));
    screenKids.push(el('div', `${id}-clk`, abs(x, r2(sh * 0.53), w, r2(sh * 0.47), {opacity: 0}), [
      label(null, 0, r2(sh * 0.235 - c.clock.size * 0.55), r2(w * 0.4), c.clock.label, {size: c.clock.labelSize, family: fonts.meta, color: theme.muted, spacing: '0.08em'}),
      label(`${id}-clkt`, 0, r2(sh * 0.235 - c.clock.size * 0.6), w, c.clock.initial, {size: c.clock.size, family: fonts.display, color: theme.foreground, align: 'right'})
    ]));
  } else if (c.clock) {
    const x = r2(sw * 0.64), w = r2(sw * 0.36 - bezel - 20 * u);
    screenKids.push(el('div', null, abs(r2(x - 14 * u), r2(bezel + 20 * u), 0, r2(sh - 2 * bezel - 40 * u), {borderLeft: `${r2(3 * u)}px dotted ${hex2(theme.foreground, 0.5)}`})));
    screenKids.push(el('div', `${id}-clk`, abs(x, 0, w, sh, {opacity: 0}), [
      label(null, 0, r2(sh / 2 - c.clock.size * 0.55 - c.clock.labelSize * 1.3), w, c.clock.label, {size: c.clock.labelSize, family: fonts.meta, color: theme.muted, spacing: '0.08em'}),
      label(`${id}-clkt`, 0, r2(sh / 2 - c.clock.size * 0.45), w, c.clock.initial, {size: c.clock.size, family: fonts.display, color: theme.foreground})
    ]));
  }
  // Status LEDs along the bezel's lower edge.
  for (let i = 0; i < 4; i++) screenKids.push(el('div', `${id}-led${i}`, abs(r2(bezel + 30 * u + i * 26 * u), r2(sh - bezel * 0.75), r2(9 * u), r2(9 * u), {borderRadius: '50%', background: c.tone, boxShadow: `0 0 ${r2(10 * u)}px ${c.tone}`, opacity: 0.35})));
  const screen = el('div', null, abs(r2(-sw / 2), r2(-sh), sw, sh, {transform: `translateZ(${r2(c.sy)}px) rotateX(${c.lean}deg)`, transformOrigin: `${r2(sw / 2)}px ${r2(sh)}px`, transformStyle: 'preserve-3d'}), screenKids);
  floor.push(slot(null, 0, 0, [stand([group(`${id}-sg`, [screen])])]));
  if (c.name) {
    const w = r2(textWidth(c.name.text, c.name.size, 'meta') * 1.12 + 30 * u), h = r2(c.name.size * 1.4);
    floor.push(billboard(`${id}-nbb`, c.cam, [0, r2(-c.d / 2), r2(c.h + 24 * u)], {w, h}, [label(`${id}-name`, 0, 0, w, c.name.text, {size: c.name.size, family: fonts.meta, color: theme.foreground, align: 'center', spacing: '0.12em', extra: {opacity: 0}})]));
  }
  return [...chromeNodes(model), rigNodes(id, c.cam, c.W, c.H, floor)];
}

function deviceTimeline(model, ops) {
  const {id, start, motion} = model;
  const c = model.content;
  chromeOps(model, ops);
  rigOps(ops, id, c.cam, start, motion.enterStart, motion.end, c.name ? [`${id}-nbb`] : []);
  if (c.name) riseOps(ops, `${id}-name`, start, rt(c.buildAt + 0.5), r2(14 * model.unit));
  for (const target of [`${id}-grid`, `${id}-pool`]) {
    set(ops, target, start, {opacity: 0});
    tw(ops, target, motion.enterStart, 0.9, 'power1.out', {opacity: 0}, {opacity: 1});
  }
  dropIn(ops, `${id}-g`, start, c.buildAt, c.dropH, {duration: 0.65});
  dropIn(ops, `${id}-sg`, start, rt(c.buildAt + 0.25), c.dropH, {duration: 0.65});
  // The screen powers on, then the readout counts and the clock ticks.
  const on = rt(c.buildAt + 0.75);
  set(ops, `${id}-lcd`, start, {opacity: 0});
  tw(ops, `${id}-lcd`, on, 0.12, 'power1.out', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-lcd`, rt(on + 0.12), 0.1, 'power1.in', {opacity: 1}, {opacity: 0.55});
  tw(ops, `${id}-lcd`, rt(on + 0.22), 0.2, 'power1.out', {opacity: 0.55}, {opacity: 1});
  for (const target of [`${id}-read`, ...(c.clock ? [`${id}-clk`] : [])]) {
    set(ops, target, start, {opacity: 0});
    tw(ops, target, rt(on + 0.3), 0.3, 'power1.out', {opacity: 0}, {opacity: 1});
  }
  if (c.readout.samples.length) countOps(ops, `${id}-read`, start, c.readout.initial, c.readout.samples);
  if (c.clock) {
    set(ops, `${id}-clkt`, start, {text: c.clock.initial});
    for (const tick of c.clock.ticks) set(ops, `${id}-clkt`, sampleTime(tick.t), {text: tick.text});
  }
  // LEDs blink in a fixed pattern; fans spin at a constant rate.
  for (let i = 0; i < 4; i++) for (let t = rt(on + 0.3 + i * 0.17); t < motion.exitStart; t = rt(t + 0.9 + i * 0.23)) {
    tw(ops, `${id}-led${i}`, t, 0.08, 'none', {opacity: 0.35}, {opacity: 1});
    tw(ops, `${id}-led${i}`, rt(t + 0.08), 0.3, 'power1.out', {opacity: 1}, {opacity: 0.35});
  }
  const turns = r2(360 * c.spin * (motion.end - start));
  for (const fanId of fanIds(model)) {
    set(ops, fanId, start, {x: 0, y: 0, rotation: 0});
    tw(ops, fanId, start, rt(motion.end - start), 'none', {rotation: 0}, {rotation: turns});
  }
}

function fanIds(model) {
  const c = model.content;
  if (c.variant !== 'server') return [`${model.id}-fan0a`];
  return Array.from({length: c.units}, (_, i) => [`${model.id}-fan${i}a`, `${model.id}-fan${i}b`]).flat();
}

export const deviceBox = {
  id: 'device-box',
  describe: 'A GPU server (or a compact appliance with one big fan) in 3D on a glowing grid floor: compute cards with spinning fans on top, and a screen in front that powers on to a live readout counting up ("requests: 0 → 1,284") beside an uptime clock ticking once a second.',
  params: {readout: `{label ≤ 14 ("requests"), to, from? (default 0), format? (${FORMAT_PARAM}), at?, duration? (seconds; default to the end of the scene)} the counter on the screen`,
    clock: '{start "HH:MM:SS", label? ≤ 10 (default "uptime")} a clock that ticks once a second (optional)', name: 'string ≤ 24, a label floating over the device ("INFERENCE NODE 01") (optional)',
    units: 'server: compute cards on top, 1–8 (default 4)', unitLabel: 'server: the card label ≤ 6 ("GPU" → "GPU 0", "GPU 1"…)', tone: 'glow tone: primary | accent | paper | #rrggbb (default accent)',
    orbit: ORBIT_PARAM, title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `the device lands: ${at3d}`, variant: VARIANT_PARAM, rect: rect3d},
  events: ['build', 'readout'], timing: timingRules({rules: ['the device lands from at and its screen powers on within about 1.2 s', 'the readout counts from its at to the end of the scene; the clock ticks on whole seconds']}), variants: DEVICE_VARIANTS,
  resolve: deviceResolve, view: deviceView, timeline: deviceTimeline
};

export const DEVICE_MODULES = [deviceBox];
