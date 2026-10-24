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
//   proof-wall    real quotes, posts and screenshots pin themselves to the
//                 wall behind the presenter; a hero card lands last, in front
//                 on their chest, with a highlighter swipe (behind, or split
//                 with a hero)
//   scrapbook     paper and boiling scribbles replace the room, the presenter
//                 becomes a sticker, ransom-note letters land above them (split)
//
// Same conventions and view shape as catalogue E ({front, behind, media,
// overlay}; one op list; absolute times).

import {fitText, mixColor, r2, rt, textWidth} from './catalog-b-base.mjs';
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
  // The word spans 88% of the safe width (the hero fill rule is 70–90%);
  // turning it shortens its far side.
  const blockW = r2(safe.width * 0.88);
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
// proof-wall (behind): the user's real proof (quotes with their source,
// screenshots) pins itself to the wall behind the presenter, one card every
// few frames; a larger hero card lands last and a highlighter swipes its key
// word. Never invented: every item comes from the brief or the assets.

// Deterministic jitter in [-1, 1] for (seed, k).
const jitter = (seed, k) => {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

function resolveProofWall(params, ctx) {
  const b = createFootageBase('proof-wall', params, ctx, {allowed: ['items', 'hero', 'at', 'every'], required: ['items'], minDuration: CATALOG_F_TIMING['proof-wall'].minDuration});
  const {check, u, canvas, safe, colors, end, duration, portrait} = b;
  const p = b.params;
  check.arr(p.items, 'params.items', 3, 8);
  const items = p.items.map((item, i) => {
    check.obj(item, `params.items[${i}]`, ['text', 'image', 'source'], []);
    if (item.text === undefined && item.image === undefined) check.fail(`params.items[${i}]`, 'needs text (a real quote or headline) or an image (a real screenshot)');
    const image = item.image === undefined ? null : media(check, {src: item.image}, `params.items[${i}].image`);
    if (image && image.kind !== 'image') check.fail(`params.items[${i}].image`, 'must be an image');
    return {index: i, text: item.text === undefined ? null : check.str(item.text, `params.items[${i}].text`, 70), image, source: item.source === undefined ? null : check.str(item.source, `params.items[${i}].source`, 32)};
  });
  for (const item of items) if (item.text && !item.source) check.fail(`params.items[${item.index}].source`, 'is required for a quote or headline: say where it came from');
  let hero = null;
  if (p.hero !== undefined) {
    check.obj(p.hero, 'params.hero', ['text', 'highlight', 'source'], ['text', 'highlight', 'source']);
    const text = check.str(p.hero.text, 'params.hero.text', 48);
    const highlight = check.str(p.hero.highlight, 'params.hero.highlight', 24);
    if (!text.includes(highlight)) check.fail('params.hero.highlight', 'must be a part of params.hero.text');
    hero = {text, highlight, source: check.str(p.hero.source, 'params.hero.source', 32)};
  }
  const every = p.every === undefined ? 0.1 : check.num(p.every, 'params.every', 0.05, 0.4);
  const t0 = b.timeOf('pin', p.at, 'params.at', 0.05, {min: 0, max: duration - CATALOG_F_TIMING['proof-wall'].leadOut - every * items.length});
  const head = headRect(ctx, canvas, portrait);
  // Cards fill a grid over the top of the frame, down past the head (the
  // presenter covers the middle), jittered and tilted.
  const cols = portrait ? 3 : 4;
  const rows = Math.ceil(items.length / cols);
  const top = safe.y, bottom = Math.min(safe.y + safe.height * 0.62, Math.max(head.y + head.height * 1.1, safe.y + safe.height * 0.45));
  const cellW = safe.width / cols, cellH = (bottom - top) / rows;
  const cardW = r2(cellW * 0.86), cardH = r2(Math.min(cellH * 0.86, cardW * 1.1));
  const quoteSize = r2(Math.max(b.min.meta, u(26))), sourceSize = r2(Math.max(b.min.meta * 0.85, u(20)));
  const cards = items.map((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    if (item.text) fitText(check, `params.items[${i}].text`, item.text, {family: 'body', width: cardW - u(28), preferred: quoteSize, min: quoteSize, maxLines: Math.max(2, Math.floor((cardH - u(60)) / (quoteSize * 1.25)))});
    return {...item, x: r2(safe.x + col * cellW + (cellW - cardW) / 2 + jitter(7, i) * u(14)), y: r2(top + row * cellH + (cellH - cardH) / 2 + jitter(11, i) * u(14)), tilt: r2(jitter(5, i) * 5), time: rt(t0 + i * every)};
  });
  let heroCard = null;
  if (hero) {
    const size = r2(Math.max(b.min.key, u(52)));
    const fit = fitText(check, 'params.hero.text', hero.text, {family: 'display', width: safe.width * 0.8 - u(60), preferred: size * 1.2, min: size, maxLines: 2});
    const width = r2(safe.width * 0.8), height = r2(fit.lines * fit.size * 1.15 + u(90));
    // The hero lands in front, on the chest under the face (behind the head
    // it would hide its own highlight), kept above the caption band.
    const y = r2(Math.min(head.y + head.height + u(30), b.band.y - height - u(30)));
    // Wrap the headline greedily, as the renderer will, and find the line
    // and offset of the highlight, measured with the same text metrics.
    const inner = width - u(60);
    const lines = [];
    for (const word of hero.text.split(' ')) {
      const line = lines.length ? `${lines.at(-1)} ${word}` : word;
      if (lines.length && textWidth(line, fit.size, 'display') <= inner) lines[lines.length - 1] = line;
      else lines.push(word);
    }
    // The highlighter wraps the word itself, so each renderer's own text
    // layout places it (measured metrics are only an estimate).
    const text = lines.join('\n');
    const at = text.indexOf(hero.highlight);
    heroCard = {...hero, size: fit.size, lines: lines.length, text, before: at >= 0 ? text.slice(0, at) : text, after: at >= 0 ? text.slice(at + hero.highlight.length) : '', mark: at >= 0,
      rect: {x: r2(safe.x + (safe.width - width) / 2), y, width, height}, time: rt(t0 + items.length * every + 0.25)};
    heroCard.swipeAt = rt(heroCard.time + 0.4);
  }
  const last = heroCard ? rt(heroCard.swipeAt + 0.5) : rt(t0 + items.length * every + 0.4);
  const exitStart = rt(Math.max(last, end - 0.35));
  b.events.push({id: `${b.id}-pin`, name: 'pin', time: t0, endTime: rt(t0 + items.length * every), role: 'emphasis', cue: 'pop'});
  if (heroCard) b.events.push({id: `${b.id}-hero`, name: 'hero', time: heroCard.time, endTime: rt(heroCard.time + 0.4), role: 'payoff', cue: 'impact'});
  b.model.layer = heroCard ? 'split' : 'behind';
  if (heroCard) b.model.parts = {behind: ['wall'], front: ['hero']};
  const content = {cards, hero: heroCard, every, t0, exitStart, cardW, cardH, quoteSize, sourceSize, paper: '#f6f1e7', ink: '#17181c', muted: '#5f6068', mark: mixColor(colors.primary, '#ffffff', 0.85), radius: r2(u(12)), shadow: `0 ${u(12)}px ${u(26)}px #00000066`};
  const rect = {x: r2(safe.x), y: r2(safe.y), width: r2(safe.width), height: r2(bottom - safe.y)};
  return b.finish(content, {rect, role: 'decor', minTextPx: null, motion: {enterEnd: last, exitStart, exitTo: {opacity: 0}}});
}

function proofWallView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content, u = model.unit;
  const kids = c.cards.map(card => el('div', `${id}-card-${card.index}`, abs(card.x, card.y, c.cardW, c.cardH, {boxSizing: 'border-box', borderRadius: c.radius, overflow: 'hidden', background: c.paper, boxShadow: c.shadow,
    opacity: 0, transformOrigin: '50% 50%', transform: transformString({rotation: card.tilt, scaleX: 0.6, scaleY: 0.6})}), card.image
    ? [el('img', null, abs(0, 0, c.cardW, c.cardH, {objectFit: 'cover'}), [], {src: card.image.src, alt: ''}),
      ...(card.source ? [el('div', null, abs(0, c.cardH - c.sourceSize * 1.8, c.cardW, c.sourceSize * 1.8, {background: '#000000a6', color: '#ffffff', fontFamily: fonts.meta, fontSize: c.sourceSize, display: 'flex', alignItems: 'center', padding: `0 ${10 * u}px`, boxSizing: 'border-box', whiteSpace: 'nowrap'}), [card.source])] : [])]
    : [el('div', null, abs(14 * u, 14 * u, c.cardW - 28 * u, c.cardH - 28 * u - c.sourceSize * 1.6, {fontFamily: fonts.body, fontWeight: 600, fontSize: c.quoteSize, lineHeight: '1.25', color: c.ink, overflow: 'hidden'}), [`“${card.text}”`]),
      el('div', null, abs(14 * u, c.cardH - 14 * u - c.sourceSize * 1.3, c.cardW - 28 * u, undefined, {fontFamily: fonts.meta, fontSize: c.sourceSize, color: c.muted, whiteSpace: 'nowrap', overflow: 'hidden'}), [`— ${card.source}`])]));
  if (c.hero) {
    const H = c.hero, R = H.rect;
    const inner = [];
    const words = H.mark
      ? [H.before, el('span', null, {position: 'relative', display: 'inline-block'}, [
        el('span', `${id}-mark`, {position: 'absolute', left: '-0.08em', right: '-0.08em', top: '0.14em', bottom: '0.04em', zIndex: -1, borderRadius: 6 * u, background: c.mark, transformOrigin: '0 50%', transform: transformString({scaleX: 0})}),
        H.highlight
      ]), H.after]
      : [H.text];
    inner.push(el('div', null, abs(30 * u, 30 * u, R.width - 60 * u, undefined, {textAlign: 'center', whiteSpace: 'pre', fontFamily: fonts.display, fontSize: H.size, lineHeight: '1.15', color: c.ink}), words.filter(part => part !== '')));
    inner.push(el('div', null, abs(30 * u, R.height - 30 * u - c.sourceSize * 1.3, R.width - 60 * u, undefined, {textAlign: 'center', fontFamily: fonts.meta, fontSize: c.sourceSize, color: c.muted}), [`— ${H.source}`]));
    const hero = el('div', `${id}-hero`, abs(R.x, R.y, R.width, R.height, {boxSizing: 'border-box', borderRadius: c.radius, background: c.paper, boxShadow: c.shadow, opacity: 0, transformOrigin: '50% 50%', transform: transformString({rotation: -2, scaleX: 0.6, scaleY: 0.6})}), inner);
    return {behind: el('div', `${id}-wall`, abs(0, 0, canvas.width, canvas.height), kids), front: el('div', `${id}-front`, abs(0, 0, canvas.width, canvas.height), [hero])};
  }
  return {behind: el('div', `${id}-wall`, abs(0, 0, canvas.width, canvas.height), kids)};
}

function proofWallTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  for (const card of c.cards) {
    const target = `${id}-card-${card.index}`;
    set(ops, target, start, {opacity: 0, rotation: card.tilt, scaleX: 0.6, scaleY: 0.6});
    tw(ops, target, card.time, 0.08, 'none', {opacity: 0}, {opacity: 1});
    tw(ops, target, card.time, 0.3, 'back.out(2.2)', {scaleX: 0.6, scaleY: 0.6}, {scaleX: 1, scaleY: 1});
  }
  if (c.hero) {
    set(ops, `${id}-hero`, start, {opacity: 0, rotation: -2, scaleX: 0.6, scaleY: 0.6});
    tw(ops, `${id}-hero`, c.hero.time, 0.1, 'none', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-hero`, c.hero.time, 0.4, 'back.out(1.8)', {scaleX: 0.6, scaleY: 0.6}, {scaleX: 1, scaleY: 1});
    if (c.hero.mark) {
      set(ops, `${id}-mark`, start, {scaleX: 0});
      tw(ops, `${id}-mark`, c.hero.swipeAt, 0.35, 'power2.out', {scaleX: 0}, {scaleX: 1});
    }
  }
  for (const target of [`${id}-wall`, ...(c.hero ? [`${id}-front`] : [])]) {
    set(ops, target, start, {opacity: 1});
    tw(ops, target, c.exitStart, 0.35, 'power1.in', {opacity: 1}, {opacity: 0});
  }
}

// ---------------------------------------------------------------------------
// scrapbook (split): off-white paper and crayon scribbles replace the room
// (behind), the presenter becomes a paper sticker (subjectStyle) that slaps
// into place (subjectCamera), and ransom-note letters land one by one above
// their head with a marker ring drawn round them (front). The scribbles boil
// on threes: three jittered copies take turns every third frame.

const SCRIBBLE = [
  // Blue crayon zigzag across the top, a torn yellow strip, pink loops, X marks.
  {kind: 'zigzag', color: '#3557d6', width: 14, y: 0.08, x0: 0.05, x1: 0.95, amp: 0.035, waves: 7},
  {kind: 'strip', color: '#f4c430', y: 0.86, h: 0.07, tilt: -3},
  {kind: 'zigzag', color: '#1f2a5c', width: 6, y: 0.885, x0: 0.12, x1: 0.62, amp: 0.012, waves: 9},
  {kind: 'loops', color: '#ef6aa8', width: 8, y: 0.5, x0: 0.04, x1: 0.2, r: 0.025},
  {kind: 'loops', color: '#ef6aa8', width: 8, y: 0.58, x0: 0.8, x1: 0.96, r: 0.022},
  {kind: 'x', color: '#d6332f', width: 9, x: 0.88, y: 0.2, r: 0.025},
  {kind: 'x', color: '#d6332f', width: 9, x: 0.1, y: 0.33, r: 0.02}
];

function scribblePaths(W, H, variant) {
  const j = (k, amount) => jitter(variant * 31 + 3, k) * amount;
  const out = [];
  SCRIBBLE.forEach((mark, m) => {
    const k = m * 97;
    if (mark.kind === 'zigzag') {
      const n = mark.waves * 2;
      const pts = Array.from({length: n + 1}, (_, i) => `${i ? 'L' : 'M'}${r2((mark.x0 + (mark.x1 - mark.x0) * i / n) * W + j(k + i, 5))} ${r2((mark.y + (i % 2 ? mark.amp : -mark.amp)) * H + j(k + i + 50, 6))}`);
      out.push({d: pts.join(' '), stroke: mark.color, width: mark.width, fill: 'none'});
    } else if (mark.kind === 'strip') {
      const y = mark.y * H, h = mark.h * H, x0 = 0.04 * W, x1 = 0.7 * W;
      const torn = Array.from({length: 9}, (_, i) => `L${r2(x1 + j(k + i, 4) + (i % 2 ? 10 : -6))} ${r2(y + h * i / 8)}`).join(' ');
      out.push({d: `M${r2(x0)} ${r2(y + j(k, 3))} L${r2(x1)} ${r2(y + j(k + 1, 3))} ${torn} L${r2(x0)} ${r2(y + h + j(k + 2, 3))} Z`, stroke: 'none', width: 0, fill: mark.color});
    } else if (mark.kind === 'loops') {
      const n = 4, r = mark.r * W;
      const pts = [];
      for (let i = 0; i <= n * 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const cx = (mark.x0 + (mark.x1 - mark.x0) * i / (n * 12)) * W;
        pts.push(`${i ? 'L' : 'M'}${r2(cx + Math.cos(a) * r + j(k + i, 2.5))} ${r2(mark.y * H + Math.sin(a) * r + j(k + i + 300, 2.5))}`);
      }
      out.push({d: pts.join(' '), stroke: mark.color, width: mark.width, fill: 'none'});
    } else {
      const cx = mark.x * W, cy = mark.y * H, r = mark.r * W;
      out.push({d: `M${r2(cx - r + j(k, 4))} ${r2(cy - r + j(k + 1, 4))} L${r2(cx + r + j(k + 2, 4))} ${r2(cy + r + j(k + 3, 4))} M${r2(cx + r + j(k + 4, 4))} ${r2(cy - r + j(k + 5, 4))} L${r2(cx - r + j(k + 6, 4))} ${r2(cy + r + j(k + 7, 4))}`, stroke: mark.color, width: mark.width, fill: 'none'});
    }
  });
  return out;
}

function resolveScrapbook(params, ctx) {
  const b = createFootageBase('scrapbook', params, ctx, {allowed: ['word', 'sub', 'at'], required: ['word'], minDuration: CATALOG_F_TIMING['scrapbook'].minDuration});
  const {check, u, canvas, safe, colors, start, end, duration, fps, portrait} = b;
  const p = b.params;
  const word = check.str(p.word, 'params.word', 8).toUpperCase();
  if (/\s/.test(word)) check.fail('params.word', 'must be one word, a number or a short claim like 3X or $0');
  const sub = p.sub === undefined ? null : check.str(p.sub, 'params.sub', 20);
  const t0 = b.timeOf('slap', p.at, 'params.at', 0, {min: 0, max: duration - CATALOG_F_TIMING['scrapbook'].leadOut});
  const head = headRect(ctx, canvas, portrait);
  // Letters on mixed chips above the head; each chip its own colour, face and tilt.
  const letters = [...word];
  const gap = u(10);
  const maxChip = (safe.width * 0.92 - gap * (letters.length - 1)) / letters.length;
  const chip = r2(Math.min(u(150), maxChip));
  const subSize = sub ? r2(Math.max(b.min.key * 0.8, u(40))) : 0;
  const block = chip * 1.15 + (sub ? subSize * 1.6 : 0);
  // The sticker settles at `settle` scale, keeping the frame's bottom edge:
  // the letters go above where the head ends up.
  const settle = 0.82;
  const headTop = canvas.height / 2 + (head.y - canvas.height / 2) * settle + (canvas.height / 2) * (1 - settle);
  const top = r2(Math.max(safe.y + u(20), Math.min(headTop - block - u(30), safe.y + safe.height * 0.3)));
  if (chip < b.min.key * 1.3 - 1e-6) check.fail('params.word', 'is too long for the chips; use up to 8 characters');
  const faces = ['display', 'body', 'meta'];
  const swatches = [[colors.primary, colors.ink], ['#ffffff', '#111111'], ['#111111', '#ffffff'], ['#3557d6', '#ffffff']];
  const rowW = letters.length * chip + (letters.length - 1) * gap;
  const x0 = (canvas.width - rowW) / 2;
  const chips = letters.map((char, i) => {
    // Neighbouring chips never share a swatch.
    const [fill, ink] = swatches[(i + (word.length % swatches.length)) % swatches.length];
    return {index: i, char, fill, ink, face: faces[i % faces.length], x: r2(x0 + i * (chip + gap)), y: r2(top + jitter(17, i) * u(10)), tilt: r2(jitter(19, i) * 8), time: rt(t0 + 0.35 + i * 0.12)};
  });
  const ringAt = rt(chips.at(-1).time + 0.25);
  const subAt = rt(ringAt + 0.35);
  // The sticker slaps in: big, then back to a little under full size.
  const slap = t => {
    if (t < t0) return 1;
    const q = Math.min(1, (t - t0) / 0.35);
    const back = 1 + 2.4 * (q - 1) ** 3 + 1.4 * (q - 1) ** 2;
    return 1.12 + (settle - 1.12) * back;
  };
  const samples = [];
  for (let f = Math.ceil(start * fps - 1e-6); f <= Math.floor(end * fps + 1e-6); f++) {
    const t = f / fps;
    const s = t >= end - 0.3 ? 1 : slap(t);
    samples.push({t: rt(t), scale: Math.round(s * 1e5) / 1e5, x: 0, y: r2((canvas.height / 2) * (1 - s)) || 0});
  }
  samples.at(-1).scale = 1;
  samples.at(-1).y = 0;
  b.events.push({id: `${b.id}-slap`, name: 'slap', time: t0, endTime: rt(t0 + 0.35), role: 'emphasis', cue: 'impact'});
  chips.forEach(chipItem => b.events.push({id: `${b.id}-letter-${chipItem.index}`, name: `letter-${chipItem.index}`, time: chipItem.time, endTime: rt(chipItem.time + 0.2), role: 'beat', cue: 'pop-soft'}));
  b.model.layer = 'split';
  b.model.parts = {behind: ['paper', 'scribbles'], front: ['letters']};
  b.model.subjectCamera = {samples};
  b.model.subjectStyle = {outline: r2(u(12)), color: '#ffffff', shadow: true};
  const frames = [];
  for (let f = Math.ceil(start * fps - 1e-6); f <= Math.floor(end * fps + 1e-6); f += 3) frames.push(rt(f / fps));
  const content = {word, sub, chips, chip, subSize, top, rowW, x0, ringAt, subAt, t0, frames, paper: '#f4f0e6', grid: '#c9c2b355', ring: '#d6332f', ink: colors.ink, exitStart: rt(end - 0.3), variants: [0, 1, 2]};
  const rect = {x: r2(Math.max(safe.x, x0 - u(20))), y: r2(Math.max(safe.y, top - u(20))), width: r2(Math.min(safe.width, rowW + u(40))), height: r2(block + u(40))};
  return b.finish(content, {rect, role: 'text', minTextPx: chip * 0.62, motion: {enterEnd: subAt, exitStart: content.exitStart, exitTo: {opacity: 0}}});
}

function scrapbookView(model) {
  const {id, fonts, canvas} = model;
  const c = model.content, u = model.unit;
  const W = canvas.width, H = canvas.height;
  const boil = c.variants.map(v => el('svg', `${id}-boil-${v}`, {position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity: v === 0 ? 1 : 0},
    scribblePaths(W, H, v).map(path => el('path', null, null, [], {d: path.d, stroke: path.stroke, strokeWidth: path.width * u, strokeLinecap: 'round', strokeLinejoin: 'round', fill: path.fill})),
    {width: W, height: H, viewBox: `0 0 ${W} ${H}`, fill: 'none'}));
  const paper = el('div', `${id}-paper`, abs(0, 0, W, H, {background: c.paper, backgroundImage: `linear-gradient(${c.grid} 1px, transparent 1px), linear-gradient(90deg, ${c.grid} 1px, transparent 1px)`, backgroundSize: `${r2(54 * u)}px ${r2(54 * u)}px`, opacity: 0}), boil);
  const chips = c.chips.map(chip => el('div', `${id}-chip-${chip.index}`, abs(chip.x, chip.y, c.chip, c.chip * 1.15, {boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: chip.fill, color: chip.ink,
    fontFamily: fonts[chip.face], fontWeight: chip.face === 'body' ? 800 : 400, fontSize: r2(c.chip * 0.78), lineHeight: '1', boxShadow: `0 ${4 * u}px ${10 * u}px #00000059`, opacity: 0, transformOrigin: '50% 50%', transform: transformString({rotation: chip.tilt, scaleX: 1.6, scaleY: 1.6})}), [chip.char]));
  const ringW = c.rowW + 70 * u, ringH = c.chip * 1.15 + 60 * u;
  const ring = el('svg', null, {position: 'absolute', left: c.x0 - 35 * u, top: c.top - 30 * u, overflow: 'visible'}, [
    el('path', `${id}-ring`, {strokeDasharray: 1, strokeDashoffset: 1}, [], {d: `M${r2(ringW * 0.5)} ${r2(ringH * 0.02)} C${r2(ringW * 1.05)} ${r2(ringH * -0.05)}, ${r2(ringW * 1.04)} ${r2(ringH * 1.05)}, ${r2(ringW * 0.5)} ${r2(ringH * 0.98)} C${r2(ringW * -0.05)} ${r2(ringH * 1.02)}, ${r2(ringW * -0.02)} ${r2(ringH * -0.03)}, ${r2(ringW * 0.56)} ${r2(ringH * 0.06)}`,
      stroke: c.ring, strokeWidth: 7 * u, strokeLinecap: 'round', pathLength: 1, fill: 'none'})
  ], {width: ringW, height: ringH, viewBox: `0 0 ${r2(ringW)} ${r2(ringH)}`, fill: 'none'});
  const front = [ring, ...chips];
  if (c.sub) front.push(el('div', `${id}-sub`, abs(c.x0, c.top + c.chip * 1.15 + 24 * u, c.rowW, undefined, {textAlign: 'center', fontFamily: fonts.display, fontSize: c.subSize, color: c.ink, opacity: 0, transformOrigin: '50% 50%', transform: transformString({scaleX: 0.5, scaleY: 0.5, rotation: -3})}), [c.sub]));
  return {behind: el('div', `${id}-room`, abs(0, 0, W, H), [paper]), front: el('div', `${id}-letters`, abs(0, 0, W, H), front)};
}

function scrapbookTimeline(model, ops) {
  const {id, start} = model;
  const c = model.content;
  set(ops, `${id}-paper`, start, {opacity: 0});
  tw(ops, `${id}-paper`, c.t0, 0.15, 'none', {opacity: 0}, {opacity: 1});
  tw(ops, `${id}-paper`, c.exitStart, 0.3, 'power1.in', {opacity: 1}, {opacity: 0});
  // Boil on threes: the variants take turns every third frame.
  c.frames.forEach((t, i) => c.variants.forEach(v => set(ops, `${id}-boil-${v}`, t, {opacity: i % c.variants.length === v ? 1 : 0})));
  for (const chip of c.chips) {
    const target = `${id}-chip-${chip.index}`;
    set(ops, target, start, {opacity: 0, rotation: chip.tilt, scaleX: 1.6, scaleY: 1.6});
    tw(ops, target, chip.time, 0.06, 'none', {opacity: 0}, {opacity: 1});
    tw(ops, target, chip.time, 0.22, 'power3.out', {scaleX: 1.6, scaleY: 1.6}, {scaleX: 1, scaleY: 1});
  }
  set(ops, `${id}-ring`, start, {strokeDashoffset: 1});
  tw(ops, `${id}-ring`, c.ringAt, 0.45, 'power2.out', {strokeDashoffset: 1}, {strokeDashoffset: 0});
  if (c.sub) {
    set(ops, `${id}-sub`, start, {opacity: 0, rotation: -3, scaleX: 0.5, scaleY: 0.5});
    tw(ops, `${id}-sub`, c.subAt, 0.3, 'back.out(2)', {opacity: 0, scaleX: 0.5, scaleY: 0.5}, {opacity: 1, scaleX: 1, scaleY: 1});
  }
  set(ops, `${id}-letters`, start, {opacity: 1});
  tw(ops, `${id}-letters`, c.exitStart, 0.3, 'power1.in', {opacity: 1}, {opacity: 0});
}

// ---------------------------------------------------------------------------
// Registry

export const CATALOG_F_TIMING = Object.freeze({
  'glass-word': Object.freeze({minDuration: 1.8, leadOut: 1.1}),
  'orbit-cards': Object.freeze({minDuration: 2, leadOut: 1.2}),
  'proof-wall': Object.freeze({minDuration: 2, leadOut: 1.2}),
  scrapbook: Object.freeze({minDuration: 2, leadOut: 1.4})
});
const TIMING_F = {
  'glass-word': {minDuration: 1.8, leadIn: 0, leadOut: 1.1, gaps: [], rules: []},
  'orbit-cards': {minDuration: 2, leadIn: 0, leadOut: 1.2, gaps: [], rules: []},
  'proof-wall': {minDuration: 2, leadIn: 0, leadOut: 1.2, gaps: [], rules: ['at ≤ scene − 1.2 s − every × items']},
  scrapbook: {minDuration: 2, leadIn: 0, leadOut: 1.4, gaps: [], rules: []}
};

const DEFINITIONS = [
  {id: 'glass-word', describe: 'Footage-led, behind the presenter: one big word of extruded clear glass stands on the wall at head height, turned in perspective, and a light sweeps across it; the head covers the middle letters. For naming the one idea or a brand in a premium, tech look.',
    params: {word: 'one word ≤ 10 (uppercased)', tint: 'clear (default) | primary | accent', turn: 'degrees the word turns away (−35–35, default −18)', sweep: 'boolean (default true)', at},
    events: ['reveal', 'sweep'], needs: ['subject'], layer: 'behind', aspects: ['9:16', '16:9'], mood: ['premium', 'cinematic'],
    resolve: resolveGlassWord, view: glassWordView, timeline: glassWordTimeline},
  {id: 'orbit-cards', describe: 'Footage-led, around the presenter: 3–6 real items (screenshots, posts, logos, quotes the user supplied) on cards whip in and circle the presenter\'s chest, passing behind them on the far side and in front on the near. For social proof or "all these tools". Never invent items.',
    params: {items: '[{image?: assets/ image, text?: ≤ 40}] 3–6, each real', speed: 'degrees per second (8–60, default 26)', at},
    events: ['orbit'], needs: ['subject'], layer: 'split', aspects: ['9:16', '16:9'], mood: ['bold', 'playful'],
    resolve: resolveOrbitCards, view: orbitCardsView, timeline: orbitCardsTimeline},
  {id: 'proof-wall', describe: 'Footage-led, around the presenter: real proof pins itself to the wall behind them a card every few frames (quotes and headlines with their source, screenshots), then an optional hero card lands in front, on their chest, with a highlighter swipe on its key word. For "everyone is talking about it" or press and reviews. Never invent items.',
    params: {items: '[{text? ≤ 70 with source ≤ 32, image?: assets/ image, source?}] 3–8, each real', hero: '{text ≤ 48, highlight (a part of text), source} (optional)', every: 'seconds between cards (0.05–0.4, default 0.1)', at},
    events: ['pin', 'hero'], needs: ['subject'], layer: 'split', aspects: ['9:16', '16:9'], mood: ['bold', 'editorial', 'launch'],
    resolve: resolveProofWall, view: proofWallView, timeline: proofWallTimeline},
  {id: 'scrapbook', describe: 'Footage-led, playful: paper and boiling crayon scribbles replace the room, the presenter slaps in as a paper sticker with a white border, and ransom-note letters land above their head with a marker ring and an optional line under them. For a number or claim ("100%", "3X", "$0", "FREE") in a handmade, creator-diary beat.',
    params: {word: 'one word, number or claim ≤ 8 chars', sub: 'a short line under it ≤ 20 (optional)', at},
    events: ['slap', 'letter-<i>'], needs: ['subject'], layer: 'split', aspects: ['9:16', '16:9'], mood: ['playful'],
    resolve: resolveScrapbook, view: scrapbookView, timeline: scrapbookTimeline}
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
