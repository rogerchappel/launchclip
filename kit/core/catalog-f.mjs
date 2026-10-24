// Catalogue F: the creative set around the presenter (docs/SUBJECT_EFFECTS_RFC.md
// §6.3). Style-gated: these suit bold, playful or premium styles more than a
// plain SaaS launch, so the planner offers them through moods and style packs.
// Contract: docs/KIT_CONTRACTS.md ("Catalogue F").
//
//   glass-word    one big word of extruded glass on the wall behind the
//                 presenter at head height, in perspective, with a light
//                 sweep (behind)
//   orbit-cards   real items on cards circling the presenter's chest, passing
//                 behind them on the far side and in front on the near (split)
//
// Same conventions and view shape as catalogue E ({front, behind, media,
// overlay}; one op list; absolute times).

import {fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, transformString, tw} from './catalog-b-view.mjs';
import {createFootageBase, headRect} from './catalog-c.mjs';
import {media} from './catalog-e.mjs';
import {grammarTweens} from './grammar.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';

// ---------------------------------------------------------------------------
// glass-word (behind): extruded clear letters, turned in perspective, centred
// on the presenter's head so it covers the middle of the word.

function resolveGlassWord(params, ctx) {
  const b = createFootageBase('glass-word', params, ctx, {allowed: ['word', 'tint', 'turn', 'sweep', 'at'], required: ['word'], minDuration: CATALOG_F_TIMING['glass-word'].minDuration});
  const {check, u, canvas, safe, colors, end, duration, portrait} = b;
  const p = b.params;
  const word = check.str(p.word, 'params.word', 10).toUpperCase();
  if (/\s/.test(word)) check.fail('params.word', 'must be one word');
  const tint = p.tint === undefined ? 'clear' : check.oneOf(p.tint, 'params.tint', ['clear', 'primary', 'accent']);
  const turn = p.turn === undefined ? -18 : check.num(p.turn, 'params.turn', -35, 35);
  const sweep = p.sweep === undefined ? true : check.bool(p.sweep, 'params.sweep');
  const t0 = b.timeOf('reveal', p.at, 'params.at', 0.05, {min: 0, max: duration - CATALOG_F_TIMING['glass-word'].leadOut});
  const head = headRect(ctx, canvas, portrait);
  // The word spans 92% of the safe width; turning it shortens its far side.
  const blockW = r2(safe.width * 0.92);
  const fit = fitText(check, 'params.word', word, {family: 'display', width: blockW * 0.9, preferred: u(portrait ? 360 : 300), min: u(140), maxLines: 1});
  const size = fit.size;
  const lineH = r2(size * 0.95);
  const centreY = head.y + head.height * 0.5;
  const y = r2(Math.min(Math.max(centreY - lineH / 2, safe.y), safe.y + safe.height - lineH));
  const rect = {x: r2(safe.x + (safe.width - blockW) / 2), y, width: blockW, height: lineH};
  const glass = tint === 'clear' ? '#ffffff' : colors[tint];
  const settle = rt(t0 + 0.7);
  const sweepAt = rt(settle + 0.15);
  const exitStart = rt(end - 0.4);
  b.events.push({id: `${b.id}-reveal`, name: 'reveal', time: t0, endTime: settle, role: 'title', cue: 'shimmer'});
  if (sweep) b.events.push({id: `${b.id}-sweep`, name: 'sweep', time: sweepAt, endTime: rt(sweepAt + 0.9), role: 'detail'});
  b.model.layer = 'behind';
  const content = {word, tint, glass, turn, sweep, size, lineH, t0, settle, sweepAt, exitStart, depth: 6, step: r2(u(3)), stroke: r2(u(4)), band: r2(u(160)), sway: 2.2};
  return b.finish(content, {rect, role: 'hero', minTextPx: size,
    motion: {enterEnd: settle, exitStart, exitTo: {opacity: 0}}});
}

function glassWordView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content, R = model.rect, u = model.unit;
  const text = (key, style, extra = {}) => el('div', key, abs(0, 0, R.width, c.lineH, {display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
    fontFamily: fonts.display, fontSize: c.size, lineHeight: '0.95', letterSpacing: '0.02em', ...style}), [c.word], extra);
  const layers = [
    // The wall shadow; the extruded body as faint edge lines (glass, not
    // paint); the near-clear face with bright rims; a top highlight.
    text(null, {color: '#00000026', filter: `blur(${r2(12 * u)}px)`, transform: `translate(${r2(20 * u)}px, ${r2(28 * u)}px)`}),
    ...Array.from({length: c.depth}, (_, i) => text(null, {color: 'transparent', WebkitTextStroke: `${r2(c.stroke * 0.7)}px rgba(255, 255, 255, ${r2(0.06 + 0.035 * (c.depth - i))})`,
      transform: `translate(${r2((c.depth - i) * c.step)}px, ${r2((c.depth - i) * c.step * 0.8)}px)`})),
    // No glow behind the letters: a near-clear face shows whatever is under it.
    text(null, {color: `${c.glass}14`, WebkitTextStroke: `${c.stroke}px ${c.glass}e6`}),
    text(null, {color: 'transparent', backgroundImage: `linear-gradient(180deg, #ffffff8c 0%, #ffffff1f 18%, #ffffff00 40%, #ffffff00 80%, ${c.glass}33 100%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text'})
  ];
  if (c.sweep) {
    // A light band moves across; the text inside it counter-moves, so only
    // the band travels.
    layers.push(el('div', `${id}-band`, abs(-c.band, 0, c.band, c.lineH, {overflow: 'hidden', transform: transformString({x: 0})}), [
      el('div', `${id}-band-text`, abs(c.band, 0, R.width, c.lineH, {transform: transformString({x: 0})}), [
        text(null, {color: '#ffffffe6', WebkitTextStroke: `${c.stroke}px #ffffff`, textShadow: `0 0 ${r2(28 * u)}px #ffffff, 0 0 ${r2(60 * u)}px ${c.glass}`})
      ])
    ]));
  }
  const inner = el('div', `${id}-glass`, abs(0, 0, R.width, c.lineH, {opacity: 0, transformOrigin: '50% 60%', transform: transformString({scaleX: 0.94, scaleY: 0.94})}), layers);
  const turned = el('div', null, abs(R.x, R.y, R.width, c.lineH, {transform: `perspective(${r2(1400 * u)}px) rotateY(${c.turn}deg)`, transformOrigin: '50% 50%'}), [inner]);
  return {behind: el('div', `${id}-wall`, abs(0, 0, canvas.width, canvas.height, {overflow: 'hidden'}), [turned])};
}

function glassWordTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-glass`, start, {opacity: 0, scaleX: 0.94, scaleY: 0.94, rotation: 0});
  tw(ops, `${id}-glass`, c.t0, 0.7, 'power3.out', {opacity: 0, scaleX: 0.94, scaleY: 0.94}, {opacity: 1, scaleX: 1, scaleY: 1});
  // A slow sway while it holds.
  let t = c.settle, sign = 1;
  while (t + 1.6 < c.exitStart) {
    tw(ops, `${id}-glass`, rt(t), 1.6, 'sine.inOut', {rotation: sign > 0 ? 0 : c.sway}, {rotation: sign > 0 ? c.sway : 0});
    t += 1.6;
    sign = -sign;
  }
  tw(ops, `${id}-glass`, c.exitStart, 0.4, 'power1.in', {opacity: 1}, {opacity: 0});
  if (c.sweep) {
    const travel = model.rect.width + c.band;
    set(ops, `${id}-band`, start, {x: 0});
    set(ops, `${id}-band-text`, start, {x: 0});
    tw(ops, `${id}-band`, c.sweepAt, 0.9, 'power2.inOut', {x: 0}, {x: travel});
    tw(ops, `${id}-band-text`, c.sweepAt, 0.9, 'power2.inOut', {x: 0}, {x: -travel});
  }
}

// ---------------------------------------------------------------------------
// orbit-cards (split): real items on cards circle the presenter's chest on a
// tilted ring. Each card is drawn twice, once behind the presenter and once
// in front, and shows in the part that matches its side of the ring.

function resolveOrbitCards(params, ctx) {
  const b = createFootageBase('orbit-cards', params, ctx, {allowed: ['items', 'speed', 'at'], required: ['items'], minDuration: CATALOG_F_TIMING['orbit-cards'].minDuration});
  const {check, u, canvas, safe, band, start, end, duration, fps, portrait} = b;
  const p = b.params;
  check.arr(p.items, 'params.items', 3, 6);
  const items = p.items.map((item, i) => {
    check.obj(item, `params.items[${i}]`, ['image', 'text'], []);
    if (item.image === undefined && item.text === undefined) check.fail(`params.items[${i}]`, 'needs an image or text: a real screenshot, post, logo or quote the user supplied');
    const image = item.image === undefined ? null : media(check, {src: item.image}, `params.items[${i}].image`);
    if (image && image.kind !== 'image') check.fail(`params.items[${i}].image`, 'must be an image');
    return {index: i, image, text: item.text === undefined ? null : check.str(item.text, `params.items[${i}].text`, 40)};
  });
  const speed = p.speed === undefined ? 26 : check.num(p.speed, 'params.speed', 8, 60);
  const t0 = b.timeOf('orbit', p.at, 'params.at', 0, {min: 0, max: duration - CATALOG_F_TIMING['orbit-cards'].leadOut});
  const head = headRect(ctx, canvas, portrait);
  const cardW = r2(u(portrait ? 170 : 150)), cardH = r2(cardW * 1.45);
  const textSize = r2(Math.max(b.min.meta, u(26)));
  for (const item of items) {
    if (item.text) fitText(check, `params.items[${item.index}].text`, item.text, {family: 'body', width: cardW - u(24), preferred: textSize, min: textSize, maxLines: 4});
  }
  // The ring: centred on the chest, as wide as the safe zone allows, tilted so
  // it reads as a circle seen from above; kept above the caption band.
  const rx = r2(Math.min(safe.width / 2 - cardW / 2, canvas.width * 0.42));
  const ry = r2(rx * 0.24);
  const cx = r2(head.x + head.width / 2);
  const cy = r2(Math.min(head.y + head.height * 1.5, band.y - ry - cardH / 2 - u(20)));
  const whip = 0.9;
  const exitStart = rt(end - 0.35);
  // Angle: a fast whip that settles into the steady spin; radius eases out.
  const theta = (i, t) => {
    const k = Math.max(0, t - t0);
    return (2 * Math.PI * i) / items.length + Math.PI / 2 + (Math.PI * 1.4) * (1 - Math.exp(-k / 0.35)) + (speed * Math.PI / 180) * k;
  };
  const reach = t => {
    const q = Math.min(1, Math.max(0, (t - t0) / whip));
    return 1 - (1 - q) ** 3;
  };
  const frames = [];
  for (let f = Math.ceil(start * fps - 1e-6); f <= Math.floor(end * fps + 1e-6); f++) frames.push(rt(f / fps));
  const tracks = items.map(item => frames.map(t => {
    const a = theta(item.index, t), r = reach(t);
    const depth = Math.sin(a);
    const fade = t < t0 ? 0 : t >= exitStart ? Math.max(0, 1 - (t - exitStart) / 0.35) : Math.min(1, (t - t0) / 0.2);
    const near = depth > 0;
    return {t, x: r2(cx + rx * r * Math.cos(a) - cardW / 2), y: r2(cy + ry * r * depth - cardH / 2), scale: r2(0.74 + 0.26 * (depth + 1) / 2), opacity: r2(fade * (near ? 1 : 0.72)), near};
  }));
  b.events.push({id: `${b.id}-orbit`, name: 'orbit', time: t0, endTime: rt(t0 + whip), role: 'emphasis', cue: 'whoosh'});
  b.model.layer = 'split';
  b.model.parts = {behind: ['far cards'], front: ['near cards']};
  const content = {items, speed, t0, whip, exitStart, cx, cy, rx, ry, cardW, cardH, textSize, tracks, card: '#ffffff', ink: '#14161c', radius: r2(u(18)), shadow: `0 ${u(14)}px ${u(30)}px #00000080`};
  const rect = {x: r2(cx - rx - cardW / 2), y: r2(cy - ry - cardH * 0.6), width: r2(rx * 2 + cardW), height: r2(ry * 2 + cardH * 1.2)};
  return b.finish(content, {rect, role: 'media', minTextPx: null, motion: {enterEnd: rt(t0 + whip), exitStart, exitTo: {opacity: 0}}});
}

function orbitCardsView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content;
  const card = (item, part) => el('div', `${id}-${part}-${item.index}`, abs(0, 0, c.cardW, c.cardH, {boxSizing: 'border-box', borderRadius: c.radius, overflow: 'hidden', background: c.card, boxShadow: c.shadow,
    opacity: 0, transformOrigin: '50% 50%'}), item.image
    ? [el('img', null, abs(0, 0, c.cardW, c.cardH, {objectFit: 'cover'}), [], {src: item.image.src, alt: ''})]
    : [el('div', null, abs(12 * model.unit, 12 * model.unit, c.cardW - 24 * model.unit, c.cardH - 24 * model.unit, {display: 'flex', alignItems: 'center', fontFamily: fonts.body, fontWeight: 600, fontSize: c.textSize, lineHeight: '1.25', color: c.ink}), [item.text])]);
  const part = (name) => el('div', `${id}-${name}`, abs(0, 0, canvas.width, canvas.height), c.items.map(item => card(item, name)));
  return {behind: part('far'), front: part('near')};
}

function orbitCardsTimeline(model, ops) {
  const {id} = model;
  const c = model.content;
  c.items.forEach((item, i) => {
    for (const s of c.tracks[i]) {
      const props = {x: s.x, y: s.y, scaleX: s.scale, scaleY: s.scale};
      set(ops, `${id}-far-${item.index}`, s.t, {...props, opacity: s.near ? 0 : s.opacity});
      set(ops, `${id}-near-${item.index}`, s.t, {...props, opacity: s.near ? s.opacity : 0});
    }
  });
}

// ---------------------------------------------------------------------------
// Registry

export const CATALOG_F_TIMING = Object.freeze({
  'glass-word': Object.freeze({minDuration: 1.8, leadOut: 1.1}),
  'orbit-cards': Object.freeze({minDuration: 2, leadOut: 1.2})
});
const TIMING_F = {
  'glass-word': {minDuration: 1.8, leadIn: 0, leadOut: 1.1, gaps: [], rules: []},
  'orbit-cards': {minDuration: 2, leadIn: 0, leadOut: 1.2, gaps: [], rules: []}
};

const DEFINITIONS = [
  {id: 'glass-word', describe: 'Footage-led, behind the presenter: one big word of extruded clear glass stands on the wall at head height, turned in perspective, and a light sweeps across it; the head covers the middle letters. For naming the one idea or a brand in a premium, tech look.',
    params: {word: 'one word ≤ 10 (uppercased)', tint: 'clear (default) | primary | accent', turn: 'degrees the word turns away (−35–35, default −18)', sweep: 'boolean (default true)', at},
    events: ['reveal', 'sweep'], needs: ['subject'], layer: 'behind', aspects: ['9:16', '16:9'], mood: ['premium', 'cinematic'],
    resolve: resolveGlassWord, view: glassWordView, timeline: glassWordTimeline},
  {id: 'orbit-cards', describe: 'Footage-led, around the presenter: 3–6 real items (screenshots, posts, logos, quotes the user supplied) on cards whip in and circle the presenter\'s chest, passing behind them on the far side and in front on the near. For social proof or "all these tools". Never invent items.',
    params: {items: '[{image?: assets/ image, text?: ≤ 40}] 3–6, each real', speed: 'degrees per second (8–60, default 26)', at},
    events: ['orbit'], needs: ['subject'], layer: 'split', aspects: ['9:16', '16:9'], mood: ['bold', 'playful'],
    resolve: resolveOrbitCards, view: orbitCardsView, timeline: orbitCardsTimeline}
];

export const MODULES = Object.fromEntries(DEFINITIONS.map(def => [def.id, {describe: def.describe, params: def.params, events: def.events, timing: TIMING_F[def.id], resolve: def.resolve,
  ...(def.needs ? {needs: def.needs} : {}), ...(def.layer ? {layer: def.layer} : {}), ...(def.aspects ? {aspects: def.aspects} : {}), ...(def.mood ? {mood: def.mood} : {})}]));
const BY_ID = Object.fromEntries(DEFINITIONS.map(def => [def.id, def]));

function definition(model) {
  const def = model && BY_ID[model.module];
  if (!def) throw new Error(`catalogue F: unknown module ${model?.module}`);
  return def;
}

/** {front, behind, media, overlay}: the element trees each layer part draws, at scene start. */
export function catalogFView(model) {
  const view = definition(model).view(model);
  return {front: view.front ?? null, behind: view.behind ?? null, media: view.media ?? null, overlay: view.overlay ?? null};
}

/** Renderer-neutral animation ops for a catalogue F model. */
export function catalogFTimeline(model) {
  const ops = [];
  definition(model).timeline(model, ops);
  if (model.grammar) grammarTweens(ops, model.grammar, {roles: ['emphasis']});
  return ops;
}
