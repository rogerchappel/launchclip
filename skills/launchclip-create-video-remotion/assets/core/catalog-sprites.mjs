// Illustrated character scenes (`sprite-scene`): a painted background plate
// with one to three illustrated characters standing in it, each a set of
// pre-drawn sprites (one image per pose, plus an optional mouth-open and an
// optional eyes-closed version of every pose, all the same size and
// framing). Where the code-drawn rig (catalog-characters.mjs) builds a
// character from joints, a sprite character is artwork: a cast generated
// once (src/sprite_cast.js) and reused in every scene, so it looks the same
// person throughout.
//
//   plate      the background image, on a slow push, pull or pan
//   cast       1–3 characters: the pose sprite at its spot, swapping poses
//              on cues, the mouth sprite on its spoken words (lip sync by
//              swap), a blink now and then, a slow breath, and parallax
//              against the plate (they sit nearer the camera)
//   props      0–4 images that slide in from an edge at their time
//   card       an optional name card: NAME and a ROLE chip
//
// Files: a character's art is a folder of PNGs with transparent
// backgrounds, assets/cast/<id>/<pose>.png, <pose>-talk.png (mouth open,
// when talk is true) and <pose>-blink.png (eyes closed, when blink is
// true). Without talk sprites a speaking character gets a small jaw bounce
// instead.
//
// Same conventions as the other character modules: one model, {front}
// element tree, renderer-neutral ops, absolute times, `at` in seconds from
// the scene start (word anchors and says "auto" resolve in the story
// resolver, kit/core/story.mjs CAST_MODULES).

import {createBase, r2, rt} from './catalog-b-base.mjs';
import {abs, el, set, tw} from './catalog-b-view.mjs';
import {kenBurnsAt} from './catalog-d-photo-scene.mjs';
import {speechChanges} from './characters/acting.mjs';

export const SPRITE_TIMING = Object.freeze({minDuration: 2, fade: 0.35, poseSwap: 0.08, propSlide: 0.55, cardIn: 0.45, leadOut: 0.4,
  breathPeriod: 3.4, breath: 0.007, bounce: 0.014, blinkEvery: 3.6, blinkLength: 0.13, settle: 0.9, settleZoom: 0.05, pop: 0.045, popLength: 0.32, hop: 18});
const T = SPRITE_TIMING;
const MOVES = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'none'];
const POSITIONS = {1: ['centre'], 2: ['left', 'right'], 3: ['left', 'centre', 'right']};
const SPOT_X = {left: 0.28, centre: 0.5, right: 0.72};
const EDGES = ['left', 'right', 'top', 'bottom', 'none'];
const POSE = /^[a-z][a-z0-9-]{0,31}$/;
const ACTOR_KEYS = ['id', 'art', 'pose', 'cues', 'says', 'talk', 'blink', 'position', 'x', 'height', 'aspect', 'facing', 'depth'];

function assetPath(check, value, path, {images = true} = {}) {
  if (typeof value !== 'string' || !value.startsWith('assets/') || value.split(/[\\/]/).includes('..') || !/^[a-zA-Z0-9_./ -]+$/.test(value)
    || (images && !/\.(png|webp|jpe?g|svg)$/i.test(value))) {
    check.fail(path, images ? `must be a project-local assets/ image (.png, .webp, .jpg, .svg); got ${JSON.stringify(value)}` : `must be a project-local assets/ folder; got ${JSON.stringify(value)}`);
  }
  return value;
}

function castArt(cast, id) {
  const list = Array.isArray(cast) ? cast : Array.isArray(cast?.characters) ? cast.characters : [];
  const entry = list.find(item => item && typeof item === 'object' && item.id === id);
  return typeof entry?.art === 'string' ? entry.art : null;
}

/** The sprite file for a pose: <art>/<pose>[-talk|-blink].png. */
export function spriteSrc(art, pose, variant = null) {
  return `${art.replace(/\/+$/, '')}/${pose}${variant ? `-${variant}` : ''}.png`;
}

/**
 * Which sprite shows when: [{time, pose, face: 'rest'|'talk'|'blink'}] in
 * time order, from the pose cues, the mouth's open/close changes and the
 * blink rhythm (a blink never lands while the mouth is open). Absolute times.
 */
export function spriteStates({start, end, pose, cues, speech, talk, blink, seed = 0}) {
  const changes = [{time: start, pose}];
  for (const cue of cues) changes.push({time: cue.time, pose: cue.pose});
  const mouth = speech.map(change => ({time: change.time, open: change.open}));
  const openAt = (t) => { let open = false; for (const m of mouth) { if (m.time <= t + 1e-9) open = m.open; else break; } return open; };
  const blinks = [];
  if (blink) {
    for (let t = start + 0.9 + (seed % 7) * 0.31; t < end - 0.4; t += T.blinkEvery + ((seed + blinks.length) % 3) * 0.45) {
      if (!openAt(t) && !openAt(t + T.blinkLength)) blinks.push(t);
    }
  }
  const times = new Set([start, ...changes.map(c => c.time), ...(talk ? mouth.map(m => m.time) : []), ...blinks, ...blinks.map(t => t + T.blinkLength)]);
  const poseAt = (t) => { let p = pose; for (const c of changes) { if (c.time <= t + 1e-9) p = c.pose; } return p; };
  const blinking = (t) => blinks.some(b => t >= b - 1e-9 && t < b + T.blinkLength - 1e-9);
  const out = [];
  for (const time of [...times].filter(t => t >= start - 1e-9 && t < end).sort((a, b) => a - b)) {
    const face = talk && openAt(time) ? 'talk' : blinking(time) ? 'blink' : 'rest';
    const state = {time: rt(time), pose: poseAt(time), face};
    const last = out[out.length - 1];
    if (!last || last.pose !== state.pose || last.face !== state.face) out.push(state);
  }
  return out;
}

function resolveSpriteScene(params, ctx) {
  const b = createBase('sprite-scene', params, ctx, {allowed: ['plate', 'move', 'zoom', 'cast', 'props', 'card', 'enter', 'exit'], required: ['plate', 'cast'], hidesCaptions: false});
  const {check, canvas, fps, start, end, duration, unit, theme, fonts} = b;
  const p = b.params;
  const plate = assetPath(check, p.plate, 'params.plate');
  const move = p.move === undefined ? 'push-in' : check.oneOf(p.move, 'params.move', MOVES);
  const zoom = p.zoom === undefined ? 0.07 : check.num(p.zoom, 'params.zoom', 0.02, 0.15);
  // The video's first scene opens drawn on frame 0 (a cut), not fading up from black.
  const enter = p.enter ?? (start < 1e-6 ? 'cut' : 'fade');
  const fade = {enter: enter === 'cut' ? 0 : T.fade, exit: p.exit === 'cut' ? 0 : T.fade};
  if (p.enter !== undefined) check.oneOf(p.enter, 'params.enter', ['fade', 'cut']);
  if (p.exit !== undefined) check.oneOf(p.exit, 'params.exit', ['fade', 'cut']);

  // The cast: spots by count, unless an actor sets its own x.
  check.arr(p.cast, 'params.cast', 1, 3);
  const ids = p.cast.map(entry => entry?.id);
  if (new Set(ids).size !== ids.length) check.fail('params.cast', 'names a character twice');
  const spots = POSITIONS[p.cast.length];
  const lastCue = duration - T.leadOut;
  const actors = p.cast.map((raw, i) => {
    const path = `params.cast[${i}]`;
    check.obj(raw, path, ACTOR_KEYS, ['id']);
    if (typeof raw.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(raw.id)) check.fail(`${path}.id`, 'must be a lowercase character id');
    // The sprite folder: the actor's own art, else the story cast's entry for it (cast.characters[].art).
    const listed = castArt(ctx.cast, raw.id);
    if (raw.art === undefined && !listed) check.fail(`${path}.art`, `is needed: "${raw.id}" has no art in the story cast (cast.characters[].art, e.g. assets/cast/${raw.id})`);
    const art = assetPath(check, raw.art ?? listed, `${path}.art`, {images: false});
    const pose = raw.pose === undefined ? 'idle' : raw.pose;
    if (typeof pose !== 'string' || !POSE.test(pose)) check.fail(`${path}.pose`, 'must be a pose name (lowercase letters, digits and dashes), the name of a sprite file in its art folder');
    const position = raw.position === undefined ? spots[i] : check.oneOf(raw.position, `${path}.position`, ['left', 'centre', 'right']);
    const x = raw.x === undefined ? SPOT_X[position] : check.num(raw.x, `${path}.x`, 0.12, 0.88);
    const height = raw.height === undefined ? (p.cast.length === 1 ? 0.62 : 0.55) : check.num(raw.height, `${path}.height`, 0.25, 0.9);
    const aspect = raw.aspect === undefined ? 0.75 : check.num(raw.aspect, `${path}.aspect`, 0.3, 1.6);
    const facing = raw.facing === undefined ? 'right' : check.oneOf(raw.facing, `${path}.facing`, ['left', 'right']);
    const depth = raw.depth === undefined ? 0.4 : check.num(raw.depth, `${path}.depth`, 0, 1);
    const talk = raw.talk === undefined ? false : check.bool(raw.talk, `${path}.talk`);
    const blink = raw.blink === undefined ? false : check.bool(raw.blink, `${path}.blink`);
    const cues = raw.cues === undefined ? [] : check.arr(raw.cues, `${path}.cues`, 0, 24).map((cue, j) => {
      check.obj(cue, `${path}.cues[${j}]`, ['at', 'pose'], ['at', 'pose']);
      if (typeof cue.pose !== 'string' || !POSE.test(cue.pose)) check.fail(`${path}.cues[${j}].pose`, 'must be a pose name');
      const at = check.num(cue.at, `${path}.cues[${j}].at`, 0, lastCue);
      return {time: rt(start + at), pose: cue.pose, index: j};
    });
    for (let j = 1; j < cues.length; j++) if (cues[j].time < cues[j - 1].time) check.fail(`${path}.cues[${j}].at`, 'must not be earlier than the previous cue');
    const says = raw.says === undefined || raw.says === 'auto' ? [] : check.arr(raw.says, `${path}.says`, 0, 60).map((range, j) => {
      const where = `${path}.says[${j}]`;
      check.obj(range, where, ['from', 'to', 'words'], ['from', 'to']);
      // A line may run past the cut: its words stop at the scene's end.
      const from = check.num(range.from, `${where}.from`, 0, duration);
      const to = Math.min(duration, check.num(range.to, `${where}.to`, from, duration + 30));
      const words = Array.isArray(range.words) ? range.words.filter(w => Array.isArray(w) && w.length === 2 && Number(w[0]) < duration).map(([s, e]) => [start + Number(s), start + Math.min(duration, Number(e))]) : undefined;
      return {from: start + from, to: start + to, ...(words ? {words} : {})};
    });
    const speech = speechChanges(says);
    // Box: the sprite's frame, its feet on a floor line above the caption band.
    // A sprite is as tall as asked unless its width would crowd the others
    // (a portrait frame fits two side by side only so wide).
    const maxW = canvas.width * {1: 0.86, 2: 0.52, 3: 0.38}[p.cast.length];
    let boxH = canvas.height * height, boxW = boxH * aspect;
    if (boxW > maxW) { boxW = maxW; boxH = boxW / aspect; }
    const floor = Math.min(canvas.height * 0.9, b.safe.y + b.safe.height + canvas.height * 0.1);
    const left = Math.max(0, Math.min(canvas.width - boxW, canvas.width * x - boxW / 2));
    const box = {x: r2(left), y: r2(floor - boxH), width: r2(boxW), height: r2(boxH)};
    const states = spriteStates({start, end, pose, cues, speech, talk, blink, seed: i * 3 + ids.join('').length});
    const poses = [...new Set([pose, ...cues.map(c => c.pose)])];
    for (const c of cues) b.events.push({id: `${b.id}-${raw.id}-cue-${c.index}`, name: `${raw.id}-cue-${c.index}`, time: c.time, role: 'beat'});
    return {id: raw.id, art, pose, poses, position, box, facing, depth, talk, blink, cues, says, speech, states};
  });

  // Props: images sliding in from an edge.
  const props = p.props === undefined ? [] : check.arr(p.props, 'params.props', 0, 4).map((raw, i) => {
    const path = `params.props[${i}]`;
    check.obj(raw, path, ['src', 'at', 'from', 'box'], ['src', 'box']);
    const src = assetPath(check, raw.src, `${path}.src`);
    check.obj(raw.box, `${path}.box`, ['x', 'y', 'width', 'height'], ['x', 'y', 'width', 'height']);
    const f = {x: check.num(raw.box.x, `${path}.box.x`, 0, 0.95), y: check.num(raw.box.y, `${path}.box.y`, 0, 0.95), width: check.num(raw.box.width, `${path}.box.width`, 0.05, 1), height: check.num(raw.box.height, `${path}.box.height`, 0.05, 1)};
    const at = raw.at === undefined ? 0.3 + i * 0.4 : check.num(raw.at, `${path}.at`, 0, lastCue);
    const from = raw.from === undefined ? 'bottom' : check.oneOf(raw.from, `${path}.from`, EDGES);
    return {index: i, src, from, time: rt(start + at), box: {x: r2(f.x * canvas.width), y: r2(f.y * canvas.height), width: r2(f.width * canvas.width), height: r2(f.height * canvas.height)}};
  });
  for (const prop of props) b.events.push({id: `${b.id}-prop-${prop.index}`, name: `prop-${prop.index}`, time: prop.time, role: 'beat'});

  // Name card: NAME over a ROLE chip, above the named character (or the first).
  let card = null;
  if (p.card !== undefined) {
    check.obj(p.card, 'params.card', ['name', 'role', 'at', 'for'], ['name']);
    const name = check.str(p.card.name, 'params.card.name', 24);
    const role = p.card.role === undefined ? null : check.str(p.card.role, 'params.card.role', 32);
    const forId = p.card.for === undefined ? actors[0].id : p.card.for;
    const actor = actors.find(a => a.id === forId);
    if (!actor) check.fail('params.card.for', `must name a character in this scene (${actors.map(a => a.id).join(', ')})`);
    const at = p.card.at === undefined ? 0.5 : check.num(p.card.at, 'params.card.at', 0, lastCue);
    const nameSize = r2(96 * unit), roleSize = r2(Math.max(b.min.key, 34 * unit));
    const width = r2(Math.min(b.safe.width, Math.max(name.length * nameSize * 0.62, (role?.length ?? 0) * roleSize * 0.62) + 48 * unit));
    const height = r2(nameSize * 1.05 + (role ? roleSize * 1.6 + 12 * unit : 0));
    // Upper corner on the character's side (where a story poster names its cast), clear of its face:
    // a character left or centre gets the card top left, one on the right top right.
    const cx = actor.box.x + actor.box.width / 2;
    const x = r2(cx > canvas.width * 0.6 ? b.safe.x + b.safe.width - width : b.safe.x);
    const y = r2(b.safe.y + 24 * unit);
    card = {name, role, time: rt(start + at), box: {x, y, width, height}, nameSize, roleSize, color: theme.primary, chip: theme.ink, chipText: theme.paper};
    b.events.push({id: `${b.id}-card`, name: 'card', time: card.time, role: 'beat'});
  }

  // Per-frame camera: the plate's move, the cast's parallax and breath, a jaw bounce when a character speaks without talk sprites.
  const focus = {x: 0.5, y: 0.45};
  const frames = [];
  const first = Math.ceil(start * fps - 1e-6), last = Math.floor(end * fps + 1e-6);
  for (let frame = first; frame <= last; frame++) {
    const t = frame / fps;
    // Eased so the shot moves most as it opens; it also settles in from a touch closer.
    const linear = Math.min(1, Math.max(0, (t - start) / duration));
    const k = move === 'none' ? {scale: 1, x: 0, y: 0} : kenBurnsAt(move, 1 - (1 - linear) ** 1.6, {zoom, focus, canvas});
    const settle = Math.max(0, 1 - (t - start) / T.settle);
    const scale = k.scale * (1 + T.settleZoom * settle * settle);
    frames.push({t: rt(t), scale: Math.round(scale * 1e5) / 1e5, x: r2(k.x) || 0, y: r2(k.y) || 0});
  }
  const openAt = (speech, t) => { let open = false; for (const m of speech) { if (m.time <= t + 1e-9) open = m.open; else break; } return open; };
  const actorFrames = actors.map((actor, i) => frames.map(f => {
    const g = 1 + actor.depth;
    const breath = T.breath * Math.sin((2 * Math.PI * (f.t - start)) / T.breathPeriod + i * 1.3);
    const bounce = !actor.talk && openAt(actor.speech, f.t) ? T.bounce : 0;
    // A pose swap lands with a small pop and hop, as a cut-out character does.
    const since = actor.cues.reduce((best, cue) => (cue.time <= f.t + 1e-9 ? f.t - cue.time : best), Infinity);
    const pop = since < T.popLength ? Math.sin(Math.PI * since / T.popLength) : 0;
    const scale = (1 + (f.scale - 1) * g) * (1 + T.pop * pop);
    return {t: f.t, x: r2(f.x * g) || 0, y: r2(f.y * g - T.hop * unit * pop) || 0, scaleX: Math.round(scale * 1e5) / 1e5, scaleY: Math.round(scale * (1 + breath + bounce) * 1e5) / 1e5};
  }));

  b.events.push({id: `${b.id}-enter-cast`, name: 'cast', time: rt(start + fade.enter), role: 'enter'});
  const content = {plate, move, zoom, focus, frames, actors, actorFrames, props, card, fade, bleed: r2(48 * unit), origin: {x: r2(focus.x * canvas.width), y: r2(focus.y * canvas.height)}, fontDisplay: fonts.display, fontMeta: fonts.meta};
  const model = b.finish(content, {minTextPx: card ? card.roleSize : b.min.key});
  model.layout.drift = false;
  return model;
}

// ---------------------------------------------------------------------------
// View and timeline

const spriteId = (model, actor, pose, face) => `${model.id}-${actor.id}-${pose}-${face}`;

export function spriteSceneView(model) {
  const {id, canvas} = model;
  const c = model.content;
  const B = c.bleed;
  const kids = [el('img', `${id}-plate`, abs(-B, -B, canvas.width + 2 * B, canvas.height + 2 * B, {objectFit: 'cover', transformOrigin: `${r2(c.origin.x + B)}px ${r2(c.origin.y + B)}px`}), [], {src: c.plate, alt: ''})];
  for (const prop of c.props) kids.push(el('img', `${id}-prop-${prop.index}`, abs(prop.box.x, prop.box.y, prop.box.width, prop.box.height, {objectFit: 'contain', opacity: 0}), [], {src: prop.src, alt: ''}));
  for (const actor of c.actors) {
    const faces = ['rest', ...(actor.talk ? ['talk'] : []), ...(actor.blink ? ['blink'] : [])];
    const sprites = [];
    for (const pose of actor.poses) for (const face of faces) {
      sprites.push(el('img', spriteId(model, actor, pose, face), {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center bottom', opacity: 0},
        [], {src: spriteSrc(actor.art, pose, face === 'rest' ? null : face), alt: ''}));
    }
    const flip = actor.facing === 'left' ? {transform: 'scaleX(-1)'} : {};
    const inner = el('div', `${id}-${actor.id}-flip`, {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', ...flip}, sprites);
    const ox = r2(c.origin.x - actor.box.x), oy = r2(actor.box.height);
    kids.push(el('div', `${id}-${actor.id}`, abs(actor.box.x, actor.box.y, actor.box.width, actor.box.height, {transformOrigin: `${ox}px ${oy}px`, filter: 'drop-shadow(0 18px 24px #00000066)'}), [inner]));
  }
  if (c.card) {
    const k = c.card;
    const lines = [el('div', null, {fontFamily: c.fontDisplay, fontSize: k.nameSize, lineHeight: '1.05', fontWeight: 900, textTransform: 'uppercase', color: k.color, textShadow: '0 6px 18px #000000aa', whiteSpace: 'nowrap'}, [k.name])];
    if (k.role) lines.push(el('div', null, {display: 'inline-block', marginTop: r2(12 * model.unit), padding: `${r2(6 * model.unit)}px ${r2(16 * model.unit)}px`, fontFamily: c.fontMeta, fontSize: k.roleSize, letterSpacing: '0.12em', textTransform: 'uppercase', background: k.chip, color: k.chipText, borderRadius: r2(8 * model.unit), whiteSpace: 'nowrap'}, [k.role]));
    kids.push(el('div', `${id}-card`, abs(k.box.x, k.box.y, k.box.width, k.box.height, {opacity: 0}), lines));
  }
  return {front: el('div', id, abs(0, 0, canvas.width, canvas.height, {opacity: 0, overflow: 'hidden'}), kids), media: null, overlay: null};
}

const at = (t) => Math.max(0, Math.round((t - 0.0005) * 1e6) / 1e6);

export function spriteSceneTimeline(model, ops = []) {
  const {id, start, end} = model;
  const c = model.content;
  set(ops, id, start, {opacity: c.fade.enter ? 0 : 1});
  if (c.fade.enter) tw(ops, id, start, c.fade.enter, 'power2.out', {opacity: 0}, {opacity: 1});
  if (c.fade.exit) tw(ops, id, rt(end - c.fade.exit), c.fade.exit, 'power2.in', {opacity: 1}, {opacity: 0});
  set(ops, id, end, {opacity: 0});
  for (const f of c.frames) ops.push({type: 'set', target: `${id}-plate`, time: at(f.t), props: {x: f.x, y: f.y, scaleX: f.scale, scaleY: f.scale}});
  c.actors.forEach((actor, i) => {
    for (const f of c.actorFrames[i]) ops.push({type: 'set', target: `${id}-${actor.id}`, time: at(f.t), props: {x: f.x, y: f.y, scaleX: f.scaleX, scaleY: f.scaleY}});
    // One sprite visible at a time: every change hides the last and shows the next.
    let shown = null;
    for (const state of actor.states) {
      const next = spriteId(model, actor, state.pose, state.face);
      if (shown) set(ops, shown, state.time, {opacity: 0});
      set(ops, next, state.time, {opacity: 1});
      shown = next;
    }
  });
  for (const prop of c.props) {
    const target = `${id}-prop-${prop.index}`;
    const d = model.unit * 420;
    const from = {left: {x: -d, y: 0}, right: {x: d, y: 0}, top: {x: 0, y: -d}, bottom: {x: 0, y: d}, none: {x: 0, y: 0}}[prop.from];
    set(ops, target, start, {opacity: 0, x: from.x, y: from.y});
    tw(ops, target, prop.time, 0.18, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, target, prop.time, T.propSlide, 'back.out(1.4)', {x: from.x, y: from.y}, {x: 0, y: 0});
  }
  if (c.card) {
    const target = `${id}-card`;
    const rise = r2(36 * model.unit);
    set(ops, target, start, {opacity: 0, y: rise, scaleX: 0.92, scaleY: 0.92});
    tw(ops, target, c.card.time, T.cardIn, 'back.out(1.6)', {opacity: 0, y: rise, scaleX: 0.92, scaleY: 0.92}, {opacity: 1, y: 0, scaleX: 1, scaleY: 1});
  }
  return ops;
}

export const SPRITE_SCENE = {
  id: 'sprite-scene',
  resolve: resolveSpriteScene, view: spriteSceneView, timeline: spriteSceneTimeline,
  describe: 'An illustrated story scene: a painted background plate on a slow push or pan, with one to three illustrated characters (a generated sprite cast: a picture per pose, plus mouth-open and eyes-closed versions) standing in it, swapping poses on cues, lip-syncing their own dialogue lines by sprite swap, blinking and breathing, with parallax against the plate; props slide in; an optional name card (NAME and ROLE). For animated stories with a recurring cast and dialogue.',
  params: {
    plate: '"assets/…" the background image (.png|.webp|.jpg)',
    move: 'push-in|pull-out|pan-left|pan-right|none (default push-in), over the whole scene',
    zoom: '0.02–0.15 (default 0.07)',
    cast: '[{id, art?: "assets/cast/<id>" (the folder of <pose>.png, <pose>-talk.png, <pose>-blink.png; default the story cast entry\'s art), pose? (default idle), cues?: [{at, pose}], says?: [{from, to}] | "auto" (its own dialogue lines), talk?: true when <pose>-talk.png exists (else a jaw bounce), blink?: true when <pose>-blink.png exists, position?: left|centre|right, x?: 0.12–0.88, height?: 0.25–0.9 of the frame (default 0.62 alone, 0.55 in a group), aspect?: sprite width/height (default 0.75), facing?: left|right (left mirrors the sprite), depth?: 0–1 parallax (default 0.4)}] 1–3',
    props: '[{src: "assets/…", box: {x, y, width, height} fractions of the frame, at?, from?: left|right|top|bottom|none}] 0–4',
    card: '{name ≤ 24, role? ≤ 32, at?, for?: a cast id (default the first)}: a name card in the upper corner on that character\'s side',
    enter: 'fade|cut (default fade; cut when the scene opens the video)', exit: 'fade|cut (default fade)'
  },
  events: ['cast', '<character>-cue-<i>', 'prop-<i>', 'card']
};
