// Catalogue I 3D data objects, planets: planet-family (a product family as
// celestial bodies, moon, earth, sun, galaxy and more, each with its name
// and tagline, the camera tracking from one to the next on cue over
// parallax star layers; or all in one line-up with the focus moving). The
// bodies are procedural (CSS gradients, no images): a sphere looks the same
// from every angle, so they are discs on a world strip, with surfaces that
// turn, coronas and arms that spin, and stars at fixed seeded places.
// Registered in kit/core/catalog-i-3d.mjs.

import {timingRules} from './catalog-b-base.mjs';
import {hex2} from './catalog-b-view.mjs';
import {VARIANT_PARAM, createHBase, r2, rt, toneColor} from './catalog-h-base.mjs';
import {abs, chromeNodes, chromeOps, el, label, riseOps, set, tw} from './catalog-h-view.mjs';
import {at3d, cueTime, fitSize, rect3d, sceneBox} from './catalog-i-3d-base.mjs';

const PLANET_VARIANTS = Object.freeze(['track', 'lineup']);
export const BODY_KINDS = Object.freeze(['moon', 'ice', 'earth', 'gas', 'sun', 'galaxy']);
// Relative diameters, so a family reads small to large by kind.
const SCALE = {moon: 0.55, ice: 0.68, earth: 0.8, gas: 0.92, sun: 1, galaxy: 1.12};
const PARALLAX = [0.18, 0.42];

/** A small seeded PRNG (mulberry32): the same stars in every renderer and run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function planetResolve(params, ctx) {
  const b = createHBase('planet-family', params, ctx, {allowed: ['bodies', 'tone', 'title', 'source', 'at'], required: ['bodies'], variants: PLANET_VARIANTS});
  const {check, u} = b;
  const p = b.params;
  const track = b.variant === 'track';
  check.arr(p.bodies, 'params.bodies', 2, track ? 5 : 4);
  const bodies = p.bodies.map((body, i) => {
    const path = `params.bodies[${i}]`;
    check.obj(body, path, ['kind', 'name', 'tagline', 'at'], ['kind', 'name']);
    return {kind: check.oneOf(body.kind, `${path}.kind`, BODY_KINDS), name: check.str(body.name, `${path}.name`, 16), tagline: body.tagline === undefined ? null : check.str(body.tagline, `${path}.tagline`, 28), at: body.at};
  });
  const tone = toneColor(b, p.tone, 'params.tone', 'accent');
  const box = sceneBox(b, p);
  const n = bodies.length;
  const W = box.W, H = box.avail;

  // Text: one size for every name and every tagline, fitted to a body's slot.
  const slotW = track ? W * 0.7 : W / n;
  const nameSize = Math.min(...bodies.map((body, i) => fitSize(check, `params.bodies[${i}].name`, body.name.toUpperCase(), {family: 'display', width: slotW * 0.92, preferred: u(b.portrait ? 96 : track ? 88 : 64), min: b.min.key}).size));
  // Taglines take a second line in the narrow line-up slots.
  const tagFits = bodies.map((body, i) => body.tagline ? fitSize(check, `params.bodies[${i}].tagline`, body.tagline, {family: 'body', width: slotW * 0.92, preferred: u(b.portrait ? 50 : 42), min: b.min.key, maxLines: track ? 1 : 2}) : null).filter(Boolean);
  const tagSize = tagFits.length ? Math.min(...tagFits.map(f => f.size)) : 0, tagLines = tagFits.length ? Math.max(...tagFits.map(f => f.lines)) : 0;
  const textH = nameSize * 1.1 + (tagSize ? tagSize * 1.25 * tagLines + u(6) : 0) + u(28);
  const maxD = Math.max(u(120), Math.min(H - textH - u(40), track ? W * 0.6 : (W / n) * 0.9));
  const spacing = track ? r2(W * 0.66) : r2(W / n);
  const largest = Math.max(...bodies.map(body => SCALE[body.kind]));
  // Track shows one body at a time near full size; the line-up keeps them to scale by kind.
  const out = bodies.map((body, i) => ({...body, d: r2(maxD * (track ? 0.75 + 0.25 * SCALE[body.kind] / largest : SCALE[body.kind] / largest)), cx: track ? r2(W / 2 + i * spacing) : r2(spacing * (i + 0.5))}));
  const cy = r2(box.top + (H - textH) / 2);
  out.forEach(body => { body.cy = cy; body.textY = r2(cy + Math.max(...out.map(o => o.d)) / 2 + u(28)); });

  // Timing: one cue per body; the camera (or the focus) moves on each.
  const enter = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: enter, endTime: rt(enter + 0.8), role: 'emphasis', cue: 'whoosh-soft'});
  const first = enter - b.start + 0.3;
  const last = Math.max(first, b.lastEvent - 0.5);
  const gap = n > 1 ? (last - first) / (n - 1) : 0;
  out.forEach((body, i) => {
    body.time = i === 0 ? rt(b.start + first) : cueTime(b, `body-${i}`, body.at, `params.bodies[${i}].at`, first + i * gap, first);
    delete body.at;
    b.events.push({id: `${b.id}-body-${i}`, name: `body-${i}`, time: body.time, endTime: rt(body.time + 0.9), role: 'emphasis', cue: i === 0 ? 'pop' : 'whoosh'});
  });
  for (let i = 1; i < n; i++) if (out[i].time < out[i - 1].time + 0.75 - 1e-6) check.fail(`params.bodies[${i}].at`, 'comes less than 0.75 s after the previous body; space the cues');

  // Stars: two parallax layers, wide enough for the whole track.
  const span = track ? W + spacing * (n - 1) : W;
  const random = rng(0x5eed ^ n);
  const layers = PARALLAX.map((f, k) => {
    const count = Math.round((span * f + W) * H / (k ? 9000 : 5000) / (u(1) || 1));
    const width = r2(W + span * f);
    const stars = Array.from({length: count}, () => [r2(random() * width), r2(random() * box.avail + box.top), r2(u(k ? 3.4 : 2.2) * (0.6 + random())), r2(0.35 + 0.65 * random())]);
    return {factor: f, width, stars};
  });
  const content = {variant: b.variant, title: box.tb.title, source: box.tb.source, align: 'center', W, H: box.H, top: box.top, avail: H, bodies: out, spacing, nameSize, tagSize, tagLines, tone, layers, enter};
  return b.finish(content, {minTextPx: r2(Math.min(nameSize, tagSize || Infinity, box.tb.title ? box.tb.title.size : Infinity))});
}

// ---------------------------------------------------------------------------
// Bodies: procedural surfaces

const disk = (d, style, kids = [], id = null) => el('div', id, abs(0, 0, d, d, {borderRadius: '50%', overflow: 'hidden', ...style}), kids);
const blob = (x, y, w, h, color) => `radial-gradient(ellipse ${r2(w)}% ${r2(h)}% at ${r2(x)}% ${r2(y)}%, ${color} 0%, ${color} 55%, transparent 100%)`;
const SHADE = 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 35%), radial-gradient(circle at 72% 70%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.72) 78%)';

/** Body nodes in a d × d box: the disc and its glow; returns {nodes, spin: [{id, from, to}], slide: [{id, from, to}]}. */
function bodyNodes(id, body, tone, u) {
  const d = body.d;
  const nodes = [], spin = [], slide = [];
  const surface = (sid, w, layers) => el('div', sid, abs(0, 0, r2(w), d, {backgroundImage: layers.join(', '), backgroundSize: `${r2(w / 2)}px ${d}px`, backgroundRepeat: 'repeat-x'}));
  if (body.kind === 'moon' || body.kind === 'ice') {
    const ice = body.kind === 'ice';
    const base = ice ? 'radial-gradient(circle at 35% 30%, #f4fbff 0%, #bfe3f2 45%, #6aa6c4 80%, #2d566b 100%)' : 'radial-gradient(circle at 35% 30%, #ecebe6 0%, #b4b2ac 45%, #6c6a66 78%, #2f2e2c 100%)';
    const marks = ice ? [[30, 40, 60, 6, 'rgba(255,255,255,0.35)'], [60, 62, 70, 5, 'rgba(120,180,210,0.35)']] : [[28, 34, 12, 10, 'rgba(70,68,64,0.55)'], [58, 26, 8, 7, 'rgba(70,68,64,0.5)'], [46, 58, 16, 13, 'rgba(80,78,74,0.45)'], [70, 52, 7, 6, 'rgba(60,58,55,0.5)'], [36, 74, 9, 8, 'rgba(70,68,64,0.4)']];
    const sid = `${id}-surf`;
    nodes.push(disk(d, {background: base, boxShadow: `0 0 ${r2(d * 0.12)}px ${hex2(ice ? '#bfe3f2' : '#ecebe6', 0.25)}`}, [surface(sid, d * 2, [...marks, ...marks.map(([x, y, w, h, c]) => [x + 50 > 100 ? x - 50 : x + 50, y, w, h, c])].map(([x, y, w, h, c]) => blob(x / 2, y, w / 2, h, c))),
      el('div', null, abs(0, 0, d, d, {background: SHADE}))]));
    slide.push({id: sid, from: 0, to: r2(-d * 0.25)});
  } else if (body.kind === 'earth' || body.kind === 'gas') {
    const earth = body.kind === 'earth';
    const sid = `${id}-surf`, cid = `${id}-cloud`;
    const land = earth ? [[18, 38, 18, 22, '#3f8a4f'], [30, 62, 12, 18, '#4e9a52'], [62, 30, 22, 16, '#5a8f3e'], [70, 66, 14, 12, '#c2a46a'], [44, 48, 9, 10, '#3c7d45']] : [];
    const layers = earth ? land.map(([x, y, w, h, c]) => blob(x, y, w, h, c)) : [`repeating-linear-gradient(180deg, #d8b48a 0px, #d8b48a ${r2(d * 0.07)}px, #b9875a ${r2(d * 0.07)}px, #b9875a ${r2(d * 0.12)}px, #e9d2b0 ${r2(d * 0.12)}px, #e9d2b0 ${r2(d * 0.16)}px)`];
    const kids = [el('div', sid, abs(0, 0, r2(d * 2), d, {backgroundImage: layers.join(', '), backgroundSize: `${d}px ${d}px`, backgroundRepeat: 'repeat-x'}))];
    if (earth) kids.push(el('div', cid, abs(0, 0, r2(d * 2), d, {backgroundImage: [[25, 30, 30, 5], [60, 52, 36, 4], [40, 76, 26, 4], [80, 20, 20, 4]].map(([x, y, w, h]) => blob(x, y, w, h, 'rgba(255,255,255,0.75)')).join(', '), backgroundSize: `${d}px ${d}px`, backgroundRepeat: 'repeat-x'})));
    kids.push(el('div', null, abs(0, 0, d, d, {background: SHADE})));
    nodes.push(disk(d, {background: earth ? 'radial-gradient(circle at 40% 35%, #3f8fe0 0%, #1c5fb4 50%, #0b2c63 100%)' : '#c9a072', boxShadow: `0 0 ${r2(d * 0.14)}px ${hex2(earth ? '#5fb4ff' : '#e9c08a', 0.55)}, inset 0 0 ${r2(d * 0.06)}px ${hex2(earth ? '#9fd3ff' : '#f3dcb8', 0.6)}`}, kids));
    slide.push({id: sid, from: 0, to: r2(-d * 0.5)});
    if (earth) slide.push({id: cid, from: 0, to: r2(-d * 0.8)});
    if (!earth) {
      // A ring: an ellipse in front, squashed by a static wrapper.
      nodes.push(el('div', null, abs(r2(-d * 0.35), r2(d * 0.35), r2(d * 1.7), r2(d * 0.3), {borderRadius: '50%', border: `${r2(d * 0.035)}px solid rgba(233,210,176,0.75)`, boxShadow: `0 0 ${r2(d * 0.04)}px rgba(233,210,176,0.5)`, transform: 'rotate(-12deg)'})));
    }
  } else if (body.kind === 'sun') {
    const corona = `${id}-corona`;
    const c = r2(d * 1.9), off = r2((d - c) / 2);
    nodes.push(el('div', corona, abs(off, off, c, c, {borderRadius: '50%', transformOrigin: '50% 50%',
      background: `radial-gradient(circle, rgba(255,214,120,0.55) 0%, rgba(255,170,60,0.22) 38%, rgba(255,140,40,0) 70%), repeating-conic-gradient(from 0deg, rgba(255,200,110,0.18) 0deg 4deg, rgba(255,200,110,0) 4deg 11deg)`,
      maskImage: 'radial-gradient(circle, #000 30%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, #000 30%, transparent 70%)'})));
    nodes.push(disk(d, {background: 'radial-gradient(circle at 45% 42%, #fffdf2 0%, #ffe9a6 28%, #ffc14d 62%, #ff8a1f 100%)', boxShadow: `0 0 ${r2(d * 0.25)}px rgba(255,190,80,0.85), 0 0 ${r2(d * 0.6)}px rgba(255,150,40,0.45)`}));
    spin.push({id: corona, turns: 0.12});
  } else {
    // Galaxy: spiral arms (two conic layers turned apart) masked to a soft disc, tilted by a static squash.
    const g = `${id}-arms`;
    const arms = (a, color) => `conic-gradient(from ${a}deg, transparent 0deg, ${color} 30deg, transparent 75deg, transparent 180deg, ${color} 210deg, transparent 255deg)`;
    nodes.push(el('div', null, abs(0, r2(d * 0.2), d, r2(d * 0.6), {}), [
      el('div', null, abs(0, r2(-d * 0.2), d, d, {transform: 'scale(1, 0.6) rotate(-18deg)', transformOrigin: '50% 50%'}), [
        el('div', g, abs(0, 0, d, d, {borderRadius: '50%', transformOrigin: '50% 50%', backgroundImage: [arms(0, 'rgba(170,190,255,0.55)'), arms(40, 'rgba(120,150,255,0.35)'), arms(80, `${hex2(tone, 0.3)}`), 'radial-gradient(circle, rgba(255,245,225,1) 0%, rgba(255,225,190,0.8) 8%, rgba(160,170,255,0.25) 30%, transparent 60%)'].join(', '),
          maskImage: 'radial-gradient(circle, #000 0%, #000 30%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, #000 30%, transparent 70%)'}))
      ])
    ]));
    spin.push({id: g, turns: 0.08});
  }
  return {nodes, spin, slide};
}

function planetView(model) {
  const {id, fonts, unit: u, theme} = model;
  const c = model.content;
  const kids = [];
  // Star layers sit under the strip; each moves at its own share of the camera.
  c.layers.forEach((layer, k) => {
    // A few stars get a soft halo, so the field has depth at any scale.
    const shadow = layer.stars.map(([x, y, s, a], j) => `${x}px ${r2(y)}px ${j % 9 === 0 ? r2(s * 2) : 0}px ${r2(s / 2)}px rgba(255,255,255,${a})`).join(', ');
    kids.push(el('div', `${id}-stars${k}`, abs(0, 0, layer.width, c.H, {}), [el('div', null, abs(0, 0, 1, 1, {borderRadius: '50%', boxShadow: shadow}))]));
  });
  const strip = [];
  c.bodies.forEach((body, i) => {
    const {nodes} = bodyNodes(`${id}-b${i}`, body, c.tone, u);
    const half = r2(body.d / 2);
    // The line-up dims with a veil, not opacity, so stars never show through a body.
    const veil = c.variant === 'lineup' ? [el('div', `${id}-veil${i}`, abs(r2(-body.d * 0.01), r2(-body.d * 0.01), r2(body.d * 1.02), r2(body.d * 1.02), {borderRadius: '50%', background: theme.bg, opacity: 0}))] : [];
    strip.push(el('div', `${id}-body${i}`, abs(r2(body.cx - half), r2(body.cy - half), body.d, body.d, {transformOrigin: '50% 50%'}), [...nodes, ...veil]));
    const w = r2(c.variant === 'track' ? c.W * 0.7 : c.spacing);
    strip.push(el('div', `${id}-txt${i}`, abs(r2(body.cx - w / 2), body.textY, w, r2(c.nameSize * 1.1 + c.tagSize * 1.25 * c.tagLines + 6 * u), {opacity: 0}), [
      label(null, 0, 0, w, body.name.toUpperCase(), {size: c.nameSize, family: fonts.display, color: theme.foreground, align: 'center', spacing: '0.08em', lineHeight: 1.1}),
      ...(body.tagline ? [label(null, 0, r2(c.nameSize * 1.1 + 6 * u), w, body.tagline, {size: c.tagSize, family: fonts.body, color: c.tone, align: 'center', weight: 600, wrap: c.tagLines > 1, lineHeight: 1.25})] : [])
    ]));
  });
  kids.push(el('div', `${id}-strip`, abs(0, 0, c.W, c.H, {}), strip));
  return [...chromeNodes(model), el('div', null, abs(0, 0, c.W, c.H, {overflow: 'hidden'}), kids)];
}

function planetTimeline(model, ops) {
  const {id, start, motion, unit: u} = model;
  const c = model.content;
  chromeOps(model, ops);
  const track = c.variant === 'track';
  // The camera: the strip (and each star layer at its share) moves to each body on its cue.
  const pos = i => (track ? -i * c.spacing : 0);
  for (const [target, f] of [[`${id}-strip`, 1], ...c.layers.map((layer, k) => [`${id}-stars${k}`, layer.factor])]) {
    // A slow drift on every hold, so the frame is never still.
    const drift = track || f !== 1 ? r2(-30 * u * f) : 0;
    set(ops, target, start, {x: 0, y: 0});
    let x = 0;
    c.bodies.forEach((body, i) => {
      if (i === 0) return;
      const to = r2(pos(i) * f + drift * i);
      tw(ops, target, body.time, 0.75, 'power3.inOut', {x}, {x: to});
      x = to;
    });
    tw(ops, target, rt(c.bodies.at(-1).time + 0.75), rt(motion.end - c.bodies.at(-1).time - 0.75), 'sine.inOut', {x}, {x: r2(x + drift)});
  }
  c.bodies.forEach((body, i) => {
    const {spin, slide} = bodyNodes(`${id}-b${i}`, body, c.tone, u);
    const span = rt(motion.end - start);
    for (const s of spin) {
      set(ops, s.id, start, {x: 0, y: 0, rotation: 0});
      tw(ops, s.id, start, span, 'none', {rotation: 0}, {rotation: r2(360 * s.turns * span)});
    }
    for (const s of slide) {
      set(ops, s.id, start, {x: s.from, y: 0});
      tw(ops, s.id, start, span, 'none', {x: s.from}, {x: s.to});
    }
    const target = `${id}-body${i}`;
    // Each body swells in as the camera arrives; in the line-up the focus moves and the rest dim.
    set(ops, target, start, {x: 0, y: 0, scaleX: 0.6, scaleY: 0.6, opacity: 0});
    const appear = track ? (i === 0 ? c.enter : rt(Math.max(c.enter, body.time - 0.5))) : rt(c.enter + i * 0.15);
    tw(ops, target, appear, 0.9, 'power3.out', {scaleX: 0.6, scaleY: 0.6, opacity: 0}, {scaleX: 1, scaleY: 1, opacity: 1});
    riseOps(ops, `${id}-txt${i}`, start, rt(body.time + 0.25), r2(20 * u), {duration: 0.5});
    // Track: a body's label leaves as the camera moves on.
    if (track && c.bodies[i + 1]) tw(ops, `${id}-txt${i}`, c.bodies[i + 1].time, 0.4, 'power2.out', {opacity: 1}, {opacity: 0});
    if (!track) {
      const veil = `${id}-veil${i}`, next = c.bodies[i + 1];
      set(ops, veil, start, {opacity: i === 0 ? 0 : 0.68});
      if (i > 0) tw(ops, veil, body.time, 0.5, 'power2.out', {opacity: 0.68}, {opacity: 0});
      if (next) {
        tw(ops, veil, next.time, 0.5, 'power2.out', {opacity: 0}, {opacity: 0.68});
        tw(ops, `${id}-txt${i}`, next.time, 0.5, 'power2.out', {opacity: 1}, {opacity: 0.4});
      }
    }
  });
}

export const planetFamily = {
  id: 'planet-family',
  describe: 'A product family as celestial bodies: 2–5 procedural moon, ice world, earth, ringed gas giant, sun or galaxy, each with its name and tagline ("LUNA · light, fast, cheap"), the camera tracking from one to the next on cue over parallax star layers; the lineup variant shows 2–4 side by side and moves the focus while the rest dim. Surfaces turn, coronas and spiral arms spin.',
  params: {bodies: `[{kind (${BODY_KINDS.join(' | ')}), name ≤ 16 (set in capitals), tagline? ≤ 28, at? (its cue; the first shows with the build)}] 2–5 (lineup: 2–4), small to large reads best`,
    tone: 'tagline tone: primary | accent | paper | #rrggbb (default accent)', title: 'string ≤ 60 (optional)', source: 'string ≤ 80 (optional)', at: `the first body: ${at3d}`, variant: VARIANT_PARAM, rect: rect3d},
  events: ['build', 'body-0', 'body-1', 'body-2', 'body-3', 'body-4'], timing: timingRules({rules: ['the first body shows with the build', 'each next body on its cue, at least 0.75 s apart (default: spread to the end of the scene)']}), variants: PLANET_VARIANTS,
  resolve: planetResolve, view: planetView, timeline: planetTimeline
};

export const PLANET_MODULES = [planetFamily];
