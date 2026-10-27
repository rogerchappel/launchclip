// Catalogue I 3D data objects, stacks: coin-stack (stacks of gold coins, or
// of glass token discs, sized by value: "$1 vs $10", "×3 more tokens"),
// each coin dropping onto its stack in turn while the value counts up.
// Drawn on the CSS 3D rig in kit/core/catalog-i-3d-base.mjs; registered in
// kit/core/catalog-i-3d.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, FORMAT_PARAM, createHBase, mixColor, numberFormat, r2, rt, textWidth, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, countOps, countSamples, el, label, popOps, riseOps, set, tw} from './catalog-h-view.mjs';
import {ORBIT_PARAM, at3d, billboard, camera, cueTime, cylinderFaces, fitScene, fitSize, floorGlow, group, itemIndex, minScale, orbitOf, rect3d, rigNodes, rigOps, sceneBox, slot, stand, up2} from './catalog-i-3d-base.mjs';

const STACK_VARIANTS = Object.freeze(['coins', 'cylinders']);
export const MAX_COINS = 16;
const WORLD = {coins: {r: 62, t: 13, gap: 96, facets: 14, tilt: 62}, cylinders: {r: 70, t: 28, gap: 90, facets: 16, tilt: 64}};

function stackResolve(params, ctx) {
  const b = createHBase('coin-stack', params, ctx, {allowed: ['stacks', 'per', 'format', 'highlight', 'callout', 'tone', 'orbit', 'title', 'source', 'at'], required: ['stacks'], variants: STACK_VARIANTS});
  const {check, u} = b;
  const p = b.params;
  const coins = b.variant === 'coins';
  check.arr(p.stacks, 'params.stacks', 1, 4);
  const fmt = numberFormat(check, p.format, 'params.format');
  const items = p.stacks.map((row, i) => {
    const path = `params.stacks[${i}]`;
    check.obj(row, path, ['label', 'value', 'display', 'count'], ['label', 'value']);
    return {label: check.str(row.label, `${path}.label`, 24), value: check.num(row.value, `${path}.value`, 0, 1e12), display: row.display === undefined ? null : check.str(row.display, `${path}.display`, 10),
      count: row.count === undefined ? null : check.int(row.count, `${path}.count`, 1, MAX_COINS)};
  });
  const max = Math.max(...items.map(item => item.value));
  if (!(max > 0)) check.fail('params.stacks', 'needs at least one value above 0');
  // One coin is worth `per` (default: the tallest stack has 12); a stack's count can be set outright.
  const per = p.per === undefined ? max / 12 : check.num(p.per, 'params.per', max / MAX_COINS, max);
  items.forEach((item, i) => {
    item.coins = item.count ?? Math.max(1, Math.round(item.value / per));
    if (item.coins > MAX_COINS) check.fail(`params.stacks[${i}].value`, `needs ${item.coins} coins at params.per ${per}; at most ${MAX_COINS} (raise params.per)`);
  });
  const tone = toneColor(b, p.tone, 'params.tone', coins ? 'primary' : 'accent');
  const highlight = p.highlight === undefined ? null : itemIndex(check, p.highlight, 'params.highlight', items);
  let callout = null;
  if (p.callout !== undefined) {
    check.obj(p.callout, 'params.callout', ['text', 'stack', 'at'], ['text']);
    callout = {text: check.str(p.callout.text, 'params.callout.text', 10), stack: p.callout.stack === undefined ? items.length - 1 : itemIndex(check, p.callout.stack, 'params.callout.stack', items), at: p.callout.at};
  }

  const box = sceneBox(b, p);
  const world = WORLD[b.variant];
  const n = items.length;
  const cam = camera({tilt: world.tilt, perspective: r2(3 * Math.max(box.W, box.H)), orbit: orbitOf(check, p.orbit, 16), zoom: [1, 1.06]});
  const texts = items.map(item => item.display ?? fmt.format(item.value));
  const pref = {value: u(b.portrait ? 78 : 66), name: u(b.portrait ? 46 : 40)};
  let sizes = items.map(() => ({value: pref.value, name: pref.name}));
  const calloutSize = callout ? Math.max(b.min.key, u(b.portrait ? 96 : 84)) : 0;
  const geometry = k => items.map((item, i) => ({x: (i - (n - 1) / 2) * (2 * world.r + world.gap) * k, r: world.r * k, t: world.t * k, h: item.coins * world.t * k}));
  const labelBox = i => ({w: Math.max(textWidth(texts[i], sizes[i].value, 'display'), textWidth(items[i].label, sizes[i].name, 'body')) + u(16), h: sizes[i].name * 1.2 + sizes[i].value * 1.08 + u(14)});
  const build = k => {
    const stacks = geometry(k);
    const points = [];
    for (const s of stacks) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) for (const z of [0, s.h]) points.push([s.x + dx * s.r, dy * s.r, z]);
    const labels = stacks.map((s, i) => ({at: [s.x, 0, s.h + u(14)], ...labelBox(i), ax: 0.5, ay: 1}));
    if (callout) { const s = stacks[callout.stack]; labels.push({at: [s.x + s.r, 0, s.h * 0.55], w: textWidth(callout.text, calloutSize, 'display') + u(30), h: calloutSize * 1.2, ax: 0, ay: 0.5}); }
    return {points, labels};
  };
  let fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre, kMax: 3});
  let stacks = geometry(fit.k);
  const pitch = n > 1 ? stacks[1].x - stacks[0].x : box.W;
  sizes = items.map((item, i) => {
    const s = minScale(cam, [stacks[i].x, 0, stacks[i].h]);
    const room = pitch * s * 0.95;
    const name = fitSize(check, `params.stacks[${i}].label`, item.label, {family: 'body', width: room, preferred: pref.name, min: b.min.key});
    const value = fitSize(check, `params.stacks[${i}].value`, texts[i], {family: 'display', width: room, preferred: pref.value, min: b.min.key});
    return {value: value.size, name: name.size};
  });
  fit = fitScene(cam, box.W, box.avail, build, {centre: box.centre, kMax: 3});
  stacks = geometry(fit.k);
  let minText = Infinity;
  stacks.forEach((s, i) => {
    const m = minScale(cam, [s.x, 0, s.h]);
    sizes[i] = {value: Math.max(up2(b.min.key / m), sizes[i].value), name: Math.max(up2(b.min.key / m), sizes[i].name)};
    minText = Math.min(minText, sizes[i].value * m, sizes[i].name * m);
  });

  // Timing: stacks fill side by side, every coin dropping onto the one below.
  const buildAt = b.timeOf('build', p.at, 'params.at', 0.5);
  const most = Math.max(...items.map(item => item.coins));
  const drop = 0.42, each = Math.min(0.09, 1.5 / Math.max(1, most - 1));
  const buildEnd = rt(buildAt + each * (most - 1) + drop + 0.2);
  b.events.push({id: `${b.id}-build`, name: 'build', time: buildAt, endTime: buildEnd, role: 'emphasis', cue: coins ? 'tick' : 'pop'});
  const settled = buildEnd - b.start;
  let calloutOut = null;
  if (callout) {
    const time = cueTime(b, 'callout', callout.at, 'params.callout.at', settled + 0.25, settled);
    b.events.push({id: `${b.id}-callout`, name: 'callout', time, endTime: rt(time + 0.5), role: 'emphasis', cue: 'hit-soft'});
    const s = stacks[callout.stack];
    const m = minScale(cam, [s.x + s.r, 0, s.h * 0.55]);
    const size = up2(calloutSize / Math.min(1, m));
    calloutOut = {text: callout.text, stack: callout.stack, time, size, x: r2(s.x + s.r + u(10)), z: r2(s.h * 0.55), w: r2(textWidth(callout.text, size, 'display') + u(30)), h: r2(size * 1.2)};
    minText = Math.min(minText, size * m);
  }
  const out = stacks.map((s, i) => {
    const item = items[i];
    const times = Array.from({length: item.coins}, (_, c) => rt(buildAt + c * each));
    const end = rt(times.at(-1) + drop);
    return {x: r2(s.x), r: r2(s.r), t: r2(s.t), h: r2(s.h), coins: item.coins, times, label: item.label, text: texts[i], size: sizes[i], dropH: r2(s.h + u(260)),
      samples: item.display ? null : countSamples(b.model, buildAt, end - buildAt, 'power1.out', 0, item.value, fmt.format)};
  });
  const content = {variant: b.variant, title: box.tb.title, source: box.tb.source, align: 'center', cam, W: box.W, H: box.H, k: fit.k, stacks: out, tone, highlight, callout: calloutOut, facets: world.facets,
    buildAt, buildEnd, drop, hiTone: b.colors.accent === tone ? b.colors.primary : b.colors.accent};
  return b.finish(content, {minTextPx: r2(Math.min(minText, box.tb.title ? box.tb.title.size : Infinity))});
}

/** A gold coin's facet and face styles (metal shading by facet angle). */
function coinStyles(tone, theme, u, a0) {
  const dark = mixColor(tone, '#000000', 0.45), light = mixColor(tone, '#ffffff', 0.35);
  return {
    side: (i, a) => {
      const lit = 0.5 + 0.5 * Math.cos((a + a0 - 35) * Math.PI / 180);
      const c = mixColor(dark, light, lit);
      return {background: `repeating-linear-gradient(90deg, ${c} 0px, ${c} ${r2(3 * u)}px, ${mixColor(c, '#000000', 0.18)} ${r2(3 * u)}px, ${mixColor(c, '#000000', 0.18)} ${r2(5 * u)}px)`};
    },
    top: {background: `radial-gradient(circle at 38% 32%, ${light} 0%, ${tone} 42%, ${mixColor(tone, '#000000', 0.25)} 100%)`, border: `${r2(Math.max(1, 3 * u))}px solid ${mixColor(tone, '#000000', 0.3)}`,
      boxShadow: `inset 0 0 0 ${r2(8 * u)}px ${hex2(light, 0.35)}`},
    bottom: {background: dark}
  };
}

/** A glass token disc's styles. */
function discStyles(tone, theme, u) {
  const rim = mixColor(theme.accent, theme.paper, 0.4);
  return {
    side: (i, a) => {
      const lit = 0.5 + 0.5 * Math.cos((a - 35) * Math.PI / 180);
      return {background: `linear-gradient(180deg, ${hex2(rim, 0.55 + 0.3 * lit)} 0px, ${hex2(tone, 0.18 + 0.25 * lit)} ${r2(4 * u)}px, ${hex2(tone, 0.1 + 0.2 * lit)} 100%)`};
    },
    top: {background: `radial-gradient(circle at 40% 35%, ${hex2(theme.paper, 0.35)} 0%, ${hex2(tone, 0.4)} 45%, ${hex2(tone, 0.22)} 100%)`, border: `${r2(Math.max(1, 2 * u))}px solid ${hex2(rim, 0.9)}`, boxShadow: `0 0 ${r2(24 * u)}px ${hex2(tone, 0.45)}`}
  };
}

function stackView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const floor = [];
  c.stacks.forEach((s, i) => {
    const hi = c.highlight === i;
    floor.push(floorGlow(`${id}-pool${i}`, hi ? c.hiTone : c.tone, s.x, 0, r2(s.r * 4), r2(s.r * 3), hi ? 0.5 : 0.3));
    const coins = [];
    for (let k = 0; k < s.coins; k++) {
      // Coins alternate their facet seam so the edges do not line up.
      const styles = c.variant === 'coins' ? coinStyles(c.tone, theme, u, (k * 37) % 360) : discStyles(hi ? c.hiTone : c.tone, theme, u);
      coins.push(group(`${id}-c${i}-${k}`, cylinderFaces(null, {r: s.r, h: r2(s.t * 0.94), e: r2(k * s.t), n: c.facets}, styles)));
    }
    floor.push(slot(null, s.x, 0, [stand(coins)]));
    const sz = s.size;
    const w = r2(Math.max(textWidth(s.text, sz.value, 'display'), textWidth(s.label, sz.name, 'body')) + 16 * u), h = r2(sz.name * 1.2 + sz.value * 1.08 + 14 * u);
    floor.push(billboard(`${id}-bb${i}`, c.cam, [s.x, 0, r2(s.h + 14 * u)], {w, h}, [
      el('div', `${id}-lb${i}`, abs(0, 0, w, h, {opacity: 0}), [
        label(null, 0, 0, w, s.label, {size: sz.name, family: fonts.body, color: theme.foreground, align: 'center', weight: 600}),
        label(`${id}-v${i}`, 0, r2(sz.name * 1.2 + 4 * u), w, s.text, {size: sz.value, family: fonts.display, color: hi ? c.hiTone : theme.foreground, align: 'center', lineHeight: 1.08})
      ])
    ]));
  });
  if (c.callout) {
    const co = c.callout;
    floor.push(billboard(`${id}-cobb`, c.cam, [co.x, 0, co.z], {w: co.w, h: co.h, ax: 0, ay: 0.5}, [
      label(`${id}-co`, 0, 0, co.w, co.text, {size: co.size, family: fonts.display, color: c.hiTone, lineHeight: 1.2, extra: {opacity: 0, transformOrigin: '0% 50%', textShadow: `0 0 ${r2(24 * u)}px ${hex2(c.hiTone, 0.6)}`}})
    ]));
  }
  return [...chromeNodes(model), rigNodes(id, c.cam, c.W, c.H, floor)];
}

function stackTimeline(model, ops) {
  const {id, start, unit: u, motion} = model;
  const c = model.content;
  chromeOps(model, ops);
  rigOps(ops, id, c.cam, start, motion.enterStart, motion.end, [...c.stacks.map((_, i) => `${id}-bb${i}`), ...(c.callout ? [`${id}-cobb`] : [])]);
  c.stacks.forEach((s, i) => {
    set(ops, `${id}-pool${i}`, start, {opacity: 0});
    tw(ops, `${id}-pool${i}`, s.times[0], 0.6, 'power1.out', {opacity: 0}, {opacity: 1});
    s.times.forEach((t, k) => {
      const target = `${id}-c${i}-${k}`;
      // Hidden (a point) until its drop, then it falls from above the stack and bounces in.
      set(ops, target, start, {x: 0, y: 0, scaleX: 0.001, scaleY: 0.001});
      set(ops, target, t, {scaleX: 1, scaleY: 1, y: -s.dropH});
      tw(ops, target, t, c.drop, 'bounce.out', {y: -s.dropH}, {y: 0});
    });
    riseOps(ops, `${id}-lb${i}`, start, rt(s.times[0] + 0.1), r2(18 * u), {duration: 0.4});
    if (s.samples) countOps(ops, `${id}-v${i}`, start, s.samples[0].text, s.samples);
  });
  if (c.callout) popOps(ops, `${id}-co`, start, c.callout.time, {from: 0.5, duration: 0.5});
}

export const coinStack = {
  id: 'coin-stack',
  describe: 'Stacks sized by value under a slow orbiting camera: 1–4 stacks of gold coins ("$1 vs $10"), or of glass token discs (variant cylinders, "×3 more tokens"), each coin dropping onto its stack in turn while the value counts up, with an optional callout ("×10") beside one stack.',
  params: {stacks: `[{label ≤ 24, value ≥ 0, display? ≤ 10 (the label text instead of the formatted value), count? 1–${MAX_COINS} (coins in the stack; default value / per)}] 1–4`,
    per: `the value of one coin (default: the tallest stack has 12; at most ${MAX_COINS} per stack)`, format: FORMAT_PARAM, highlight: 'index or label of the stack that glows (optional)',
    callout: `{text ≤ 10 ("×10"), stack? (index or label, default the last), at?} a big number beside a stack (event callout)`, tone: 'coin or glass tone: primary | accent | paper | #rrggbb (default primary for coins, accent for cylinders)',
    orbit: ORBIT_PARAM, title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `first drop: ${at3d}`, variant: VARIANT_PARAM, rect: rect3d},
  events: ['build', 'callout'], timing: timingRules({rules: ['coins drop one per stack level, all stacks together, within about 2 s from at', 'the callout follows the build']}), variants: STACK_VARIANTS,
  resolve: stackResolve, view: stackView, timeline: stackTimeline
};

export const STACK_MODULES = [coinStack];
