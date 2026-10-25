// Character modules (docs/VIDEO_QUALITY_RFC.md §10.5): animated characters
// drawn in code from the rig in kit/core/characters/. Contract:
// docs/KIT_CONTRACTS.md ("Character modules").
//
//   cast-scene       one to three characters in a set (desk-laptop, phone,
//                    meeting, screen), directed by cues: named poses and
//                    expressions at times or narration words, mouths moving
//                    on their spoken words
//   character-cameo  one character beside a card, or alone on a panel (for
//                    a footage-led or explainer beat)
//
// Characters come from the story cast (story.cast, by id) or the starter
// cast; scenes never change how a character looks, only how it acts, so a
// character is the same person in every shot. The screen in a set plays a
// real capture (params.screen: an assets/ image, video or demo-autopilot
// recording), never an invented UI.
//
// Same conventions as catalogue E: {front, media?, overlay?} views from one
// model, one renderer-neutral op list, absolute times, `at` in seconds from
// the scene start (word anchors resolve before the module sees them).

import {createBase, fitText, r2, rt} from './catalog-b-base.mjs';
import {abs, el, svgRoot, tw, set} from './catalog-b-view.mjs';
import {media, mediaNode} from './catalog-e.mjs';
import {EXPRESSIONS, POSES, rigGeometry} from './characters/rig.mjs';
import {drawFlat, drawnHeight} from './characters/style-flat.mjs';
import {characterView} from './characters/view.mjs';
import {ACTING, actingOps, sceneJoints, speechChanges} from './characters/acting.mjs';
import {SETS, SET_INFO, layoutSet, phoneProp} from './characters/sets.mjs';
import {castMember, resolveStoryCast} from './characters/cues.mjs';

export const CHARACTER_TIMING = Object.freeze({
  'cast-scene': {minDuration: 2, leadIn: 0, leadOut: ACTING.poseTween},
  'character-cameo': {minDuration: 2, leadIn: 0, leadOut: ACTING.poseTween}
});
const timingOf = id => ({...CHARACTER_TIMING[id], gaps: [], rules: [
  `a pose change tweens over ${ACTING.poseTween} s; cues may sit anywhere from the scene start to ${ACTING.poseTween} s before its end`,
  'gestures (wave, type, walk, cheer, think) loop while the pose holds'
]});

const ACTOR_KEYS = ['id', 'pose', 'expression', 'facing', 'cues', 'says', 'holds'];

// ---------------------------------------------------------------------------
// Shared: actors

function resolveActor(b, raw, path, {cast, seated, slot, setName, enter}) {
  const {check} = b;
  check.obj(raw, path, ACTOR_KEYS, ['id']);
  let member;
  try { member = castMember(cast, raw.id, `${path}.id`); } catch (error) { check.fail(path === 'params' ? 'params.character' : `${path}.id`, error.message.replace(/^\S+ /, '')); }
  const pose = raw.pose === undefined ? (seated ? 'sit' : 'stand') : check.oneOf(raw.pose, `${path}.pose`, POSES);
  const expression = raw.expression === undefined ? 'neutral' : check.oneOf(raw.expression, `${path}.expression`, EXPRESSIONS);
  const facing = raw.facing === undefined ? slot.facing : check.oneOf(raw.facing, `${path}.facing`, ['left', 'right']);
  const holds = raw.holds === undefined ? null : check.oneOf(raw.holds, `${path}.holds`, ['phone']);
  const states = [{time: b.start, pose, expression}];
  const lastCue = b.duration - ACTING.poseTween;
  const cues = raw.cues === undefined ? [] : check.arr(raw.cues, `${path}.cues`, 0, 24);
  const fitsSet = (value, where) => {
    if (value === 'walk' && seated) check.fail(where, `walk does not fit the seated set ${setName}`);
    if (value === 'sit' && !seated) check.fail(where, `sit needs a seated set (desk-laptop or meeting)`);
  };
  fitsSet(pose, `${path}.pose`);
  cues.map((cue, i) => {
    const where = `${path}.cues[${i}]`;
    check.obj(cue, where, ['at', 'pose', 'expression'], ['at']);
    if (cue.pose === undefined && cue.expression === undefined) check.fail(where, 'needs a pose or an expression');
    if (typeof cue.at === 'string') check.fail(`${where}.at`, `${JSON.stringify(cue.at)} is a word anchor that was not resolved; pass narration words to the story resolver or give seconds`);
    const at = check.num(cue.at, `${where}.at`, 0, lastCue);
    if (cue.pose !== undefined) { check.oneOf(cue.pose, `${where}.pose`, POSES); fitsSet(cue.pose, `${where}.pose`); }
    if (cue.expression !== undefined) check.oneOf(cue.expression, `${where}.expression`, EXPRESSIONS);
    return {time: rt(b.start + at), pose: cue.pose, expression: cue.expression};
  }).sort((a, c) => a.time - c.time).forEach(cue => {
    const prev = states[states.length - 1];
    const next = {time: cue.time, pose: cue.pose ?? prev.pose, expression: cue.expression ?? prev.expression};
    if (Math.abs(cue.time - prev.time) < 1e-6) Object.assign(prev, {pose: next.pose, expression: next.expression});
    else if (cue.time - prev.time < ACTING.poseTween - 1e-6 && next.pose !== prev.pose && states.length > 1) check.fail(`${path}.cues`, `pose changes at ${r2(prev.time - b.start)} s and ${r2(cue.time - b.start)} s are closer than ${ACTING.poseTween} s; space them out`);
    else states.push(next);
  });
  // says "auto" resolves to the character's own dialogue words in the story resolver; without words it stays silent.
  const says = raw.says === undefined || raw.says === 'auto' ? [] : check.arr(raw.says, `${path}.says`, 0, 40).map((range, i) => {
    const where = `${path}.says[${i}]`;
    check.obj(range, where, ['from', 'to', 'words'], ['from', 'to']);
    if (typeof range.from === 'string' || typeof range.to === 'string') check.fail(where, 'has unresolved word anchors; pass narration words to the story resolver or give seconds');
    // A line may run across a cut: spoken ranges are clipped to the scene.
    const clip = value => Math.min(Math.max(value, 0), b.duration);
    const from = clip(check.num(range.from, `${where}.from`, -86400, 86400)), to = clip(check.num(range.to, `${where}.to`, -86400, 86400));
    if (to < from) check.fail(`${where}.to`, 'must not be before from');
    const words = range.words === undefined ? null : check.arr(range.words, `${where}.words`, 0, 400).map((w, k) => {
      if (!Array.isArray(w) || w.length !== 2 || !w.every(Number.isFinite) || w[1] < w[0]) check.fail(`${where}.words[${k}]`, 'must be [start, end] seconds');
      return [rt(b.start + clip(w[0])), rt(b.start + clip(w[1]))];
    }).filter(([s, e]) => e > s);
    return {from: rt(b.start + from), to: rt(b.start + to), words};
  });
  const expressions = [...new Set(states.map(state => state.expression))];
  const geometry = rigGeometry(member.params);
  return {id: member.id, name: member.name, voice: member.voice, look: member.look, fingerprint: member.fingerprint, params: member.params, colors: member.colors, style: member.style,
    facing, holds, seated, states, expressions, speech: speechChanges(says), says, height: drawnHeight(member.params), geometry, enter};
}

function actorNode(model, actor, index) {
  const cid = `${model.id}-c${index}`;
  const first = actor.states[0];
  const joints = sceneJoints(first.pose, {...actor, geometry: actor.geometry});
  let props = null;
  if (actor.holds === 'phone') {
    const side = actor.facing === 'left' ? 'r' : 'l';
    props = {[side]: phoneProp(actor.colors, 98)};
  }
  const drawing = drawFlat(actor.params, actor.colors, {id: cid, joints, expression: first.expression, expressions: actor.expressions, props});
  return characterView(drawing, {id: cid, x: actor.x, y: actor.floor, scale: actor.scale});
}

function actorsOps(model, ops) {
  model.content.actors.forEach((actor, index) => {
    actingOps(ops, {...actor, cid: `${model.id}-c${index}`, start: model.start, end: model.end, geometry: actor.geometry});
  });
}

// Root fade (opacity only: a set does not slide), on every hoisted part. A
// scene on the video's first frame is the frame-0 hook: it is already shown
// on frame 0, with no fade in (as hook-title and kinetic-words).
function rootFade(model, ops, ids) {
  const m = model.motion;
  const settled = model.start <= 1 / model.fps + 1e-6;
  for (const id of ids) {
    if (settled) set(ops, id, model.start, {opacity: 1});
    else {
      set(ops, id, model.start, {opacity: 0});
      tw(ops, id, m.enterStart, m.enterDuration, 'power1.out', {opacity: 0}, {opacity: 1});
    }
    tw(ops, id, m.exitStart, m.exitDuration, 'power1.in', {opacity: 1}, {opacity: 0});
    set(ops, id, model.end, {opacity: 0});
  }
}

function castEvents(b, actors) {
  actors.forEach(actor => actor.states.slice(1).forEach((state, i) => {
    b.events.push({id: `${b.id}-${actor.id}-cue-${i}`, name: `${actor.id}-cue-${i}`, time: state.time, endTime: rt(state.time + ACTING.poseTween), role: 'detail'});
  }));
}

// ---------------------------------------------------------------------------
// cast-scene

function resolveCastScene(params, ctx) {
  const b = createBase('cast-scene', params, ctx, {allowed: ['set', 'screen', 'cast'], required: ['set', 'cast'], hidesCaptions: false});
  const {check, canvas} = b;
  const p = b.params;
  const setName = check.oneOf(p.set, 'params.set', SETS);
  const info = SET_INFO[setName];
  const screen = p.screen === undefined ? null : media(check, p.screen, 'params.screen');
  if (info.screen === 'required' && !screen) check.fail('params.screen', `is required for the ${setName} set: a real capture (an assets/ image or video, or a demo-autopilot recording); the set never invents a UI`);
  if (info.screen === 'none' && screen) check.fail('params.screen', `is not used by the ${setName} set (screens: ${SETS.filter(name => SET_INFO[name].screen !== 'none').join(', ')})`);
  check.arr(p.cast, 'params.cast', 1, 3);
  let cast;
  try { cast = resolveStoryCast({cast: ctx.cast ?? null, brand: ctx.brand}); } catch (error) { check.fail('story.cast', error.message); }
  const ids = p.cast.map(entry => entry?.id);
  if (new Set(ids).size !== ids.length) check.fail('params.cast', 'names a character twice');
  // Heights first (the set scales to the tallest), then the layout.
  const heights = p.cast.map((entry, i) => {
    try { return drawnHeight(castMember(cast, entry?.id, `params.cast[${i}].id`).params); } catch { return 1000; }
  });
  const layout = layoutSet(setName, {canvas, colors: b.colors, count: p.cast.length, heights, screen: Boolean(screen), unit: b.unit});
  const actors = p.cast.map((raw, i) => {
    const slot = layout.slots[i];
    const actor = resolveActor(b, raw, `params.cast[${i}]`, {cast, seated: layout.seated, slot, setName, enter: b.start});
    // The phone set: the first character holds the phone unless someone else is given it.
    if (setName === 'phone' && i === 0 && !p.cast.some(entry => entry?.holds !== undefined)) actor.holds = 'phone';
    return {...actor, x: slot.x, floor: slot.floor, scale: slot.scale};
  });
  castEvents(b, actors);
  const tops = actors.map(actor => actor.floor - (actor.height + (layout.seated ? -actor.geometry.sitDrop : 0)) * actor.scale);
  const rect = {x: r2(Math.max(0, Math.min(...actors.map(a => a.x)) - 220 * actors[0].scale)), y: r2(Math.max(0, Math.min(...tops))), width: 0, height: 0};
  rect.width = r2(Math.min(canvas.width, Math.max(...actors.map(a => a.x)) + 220 * actors[0].scale) - rect.x);
  rect.height = r2(Math.min(canvas.height, layout.floor) - rect.y);
  b.model.layer = 'front';
  const content = {set: setName, seated: layout.seated, back: layout.back, front: layout.front, screenRect: layout.screenRect, media: screen, actors, colors: layout.colors};
  const model = b.finish(content, {minTextPx: b.min.key});
  // A set fills the frame: fade in place rather than slide.
  model.motion = {...model.motion, enterFrom: {opacity: 0, x: 0, y: 0, scale: 1}, exitTo: {opacity: 0, x: 0, y: 0, scale: 1}};
  model.layout = {...model.layout, rect, role: 'media', minTextPx: null};
  model.minTextPx = null;
  return model;
}

function castSceneView(model) {
  const {id, canvas} = model;
  const c = model.content;
  const W = canvas.width, H = canvas.height;
  const back = svgRoot(W, H, c.back);
  const actors = c.actors.map((actor, i) => actorNode(model, actor, i));
  const front = svgRoot(W, H, c.front);
  const r = c.screenRect;
  const screen = c.media ? mediaNode(id, r, c.media, {origin: {x: r.x + r.width / 2, y: r.y + r.height / 2}}) : null;
  // An image screen stays inside the scene's one tree (both renderers nest it
  // the same way); only a video is split out, for HyperFrames to hoist.
  if (!c.media || c.media.kind !== 'video') return {front: el('div', id, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden'}), [back, ...(screen ? [{...screen, style: {...screen.style, opacity: 1}}] : []), ...actors, front]), media: null, overlay: null};
  return {
    front: el('div', id, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden'}), [back]),
    media: screen,
    overlay: el('div', `${id}-overlay`, abs(0, 0, W, H, {opacity: 0, overflow: 'hidden', pointerEvents: 'none'}), [...actors, front])
  };
}

function castSceneTimeline(model, ops) {
  const ids = [model.id];
  if (model.content.media?.kind === 'video') ids.push(`${model.id}-media`, `${model.id}-overlay`);
  rootFade(model, ops, ids);
  actorsOps(model, ops);
}

// ---------------------------------------------------------------------------
// character-cameo

function resolveCameo(params, ctx) {
  const b = createBase('character-cameo', params, ctx, {allowed: ['character', ...ACTOR_KEYS.filter(key => key !== 'id'), 'side', 'card', 'panel'], required: ['character']});
  const {check, rect, u, portrait} = b;
  const p = b.params;
  let cast;
  try { cast = resolveStoryCast({cast: ctx.cast ?? null, brand: ctx.brand}); } catch (error) { check.fail('story.cast', error.message); }
  const side = p.side === undefined ? 'left' : check.oneOf(p.side, 'params.side', ['left', 'right']);
  const panel = p.panel === undefined ? !p.card : check.bool(p.panel, 'params.panel');
  let card = null;
  if (p.card !== undefined) {
    check.obj(p.card, 'params.card', ['kicker', 'title', 'body'], ['title']);
    card = {kicker: p.card.kicker === undefined ? null : check.str(p.card.kicker, 'params.card.kicker', 32), title: check.str(p.card.title, 'params.card.title', 64), body: p.card.body === undefined ? null : check.str(p.card.body, 'params.card.body', 140)};
  }
  const actorRaw = {id: p.character, ...Object.fromEntries(ACTOR_KEYS.filter(key => key !== 'id' && p[key] !== undefined).map(key => [key, p[key]]))};
  const facingDefault = side === 'left' ? 'right' : 'left';
  // Character area: a column beside the card (landscape) or under it (portrait).
  const area = !card ? {...rect}
    : portrait ? {x: rect.x, y: r2(rect.y + rect.height * 0.34), width: rect.width, height: r2(rect.height * 0.66)}
      : {x: side === 'left' ? rect.x : r2(rect.x + rect.width * 0.64), y: rect.y, width: r2(rect.width * 0.36), height: rect.height};
  const probe = resolveActor(b, actorRaw, 'params', {cast, seated: false, slot: {facing: facingDefault}, setName: 'cameo', enter: b.start});
  const pad = u(10);
  const scale = r2(Math.min((area.height - pad * 2) / probe.height, (area.width - pad * 2) / 620) * 1000) / 1000;
  const x = r2(card && portrait ? (side === 'left' ? area.x + area.width * 0.28 : area.x + area.width * 0.72) : area.x + area.width / 2);
  const floor = r2(area.y + area.height - pad);
  const actor = {...probe, x, floor, scale};
  let cardBox = null;
  if (card) {
    const box = portrait ? {x: rect.x, y: rect.y, width: rect.width, height: r2(rect.height * 0.32)}
      : {x: side === 'left' ? r2(rect.x + rect.width * 0.38) : rect.x, y: r2(rect.y + rect.height * 0.12), width: r2(rect.width * 0.6), height: r2(rect.height * 0.76)};
    const inner = box.width - u(56) * 2;
    const kickerSize = r2(Math.max(b.min.meta, u(28)));
    const title = fitText(check, 'params.card.title', card.title, {family: 'display', width: inner, preferred: u(portrait ? 92 : 84), min: b.min.key, maxLines: 3});
    const body = card.body ? fitText(check, 'params.card.body', card.body, {family: 'body', width: inner, preferred: u(40), min: b.min.meta, maxLines: 4}) : null;
    cardBox = {...box, pad: u(56), kickerSize, titleSize: title.size, titleLines: title.lines, bodySize: body?.size ?? null, radius: u(32)};
  }
  castEvents(b, [actor]);
  b.model.layer = 'front';
  const content = {actors: [actor], card, cardBox, panel: panel ? {x: r2(x - Math.min(area.width / 2, 340 * scale * 1.3)), y: area.y, width: r2(Math.min(area.width, 680 * scale * 1.3)), height: area.height, radius: u(36)} : null, side};
  return b.finish(content, {minTextPx: card ? cardBox.titleSize : b.min.key});
}

function cameoView(model) {
  const {id, canvas, theme, fonts} = model;
  const c = model.content;
  const kids = [];
  if (c.panel) kids.push(el('div', `${id}-panel`, abs(c.panel.x, c.panel.y, c.panel.width, c.panel.height, {borderRadius: c.panel.radius, background: theme.panel, border: `${r2(2 * model.unit)}px solid ${theme.border}`})));
  if (c.card) {
    const B = c.cardBox;
    const lines = [];
    if (c.card.kicker) lines.push(el('div', null, {fontFamily: fonts.meta, fontSize: B.kickerSize, letterSpacing: '0.14em', textTransform: 'uppercase', color: theme.accent, marginBottom: r2(18 * model.unit)}, [c.card.kicker]));
    lines.push(el('div', null, {fontFamily: fonts.display, fontSize: B.titleSize, lineHeight: '1.04', color: theme.foreground}, [c.card.title]));
    if (c.card.body) lines.push(el('div', null, {fontFamily: fonts.body, fontSize: B.bodySize, lineHeight: '1.3', color: theme.muted, marginTop: r2(22 * model.unit)}, [c.card.body]));
    kids.push(el('div', `${id}-card`, abs(B.x, B.y, B.width, B.height, {boxSizing: 'border-box', padding: B.pad, borderRadius: B.radius, background: theme.panel, border: `${r2(2 * model.unit)}px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', boxShadow: `0 ${r2(24 * model.unit)}px ${r2(60 * model.unit)}px #00000059`}), lines));
  }
  kids.push(actorNode(model, c.actors[0], 0));
  return {front: el('div', id, abs(0, 0, canvas.width, canvas.height, {opacity: 0}), kids), media: null, overlay: null};
}

function cameoTimeline(model, ops) {
  rootFade(model, ops, [model.id]);
  const c = model.content;
  if (c.card) {
    const rise = r2(30 * model.unit);
    set(ops, `${model.id}-card`, model.start, {opacity: 0, y: rise});
    tw(ops, `${model.id}-card`, rt(model.start + 0.15), 0.5, 'power3.out', {opacity: 0, y: rise}, {opacity: 1, y: 0});
  }
  actorsOps(model, ops);
}

// ---------------------------------------------------------------------------
// Registry

const DEFINITIONS = {
  'cast-scene': {resolve: resolveCastScene, view: castSceneView, timeline: castSceneTimeline,
    describe: 'One to three animated characters in a set (desk-laptop, phone, meeting, screen), acting on cues: named poses and expressions at times or narration words, mouths moving on their lines. The screen set plays a real capture.',
    params: {set: SETS.join(' | '), screen: '{src: "assets/…(image|video|demo-autopilot .mp4)", sourceStart?, fit?} (required for screen, optional for meeting)', cast: `[{id, pose?, expression?, facing?: left|right, cues?: [{at, pose?, expression?}], says?: [{from, to}] | "auto" (its own dialogue lines), holds?: phone}] 1–3; poses: ${POSES.join(', ')}; expressions: ${EXPRESSIONS.join(', ')}`},
    events: ['<character>-cue-<i>']},
  'character-cameo': {resolve: resolveCameo, view: cameoView, timeline: cameoTimeline,
    describe: 'One animated character beside a card (kicker, title, body) or alone on a panel, for a beat in a footage-led or explainer video.',
    params: {character: 'a cast or starter character id', pose: POSES.filter(p => p !== 'sit').join(' | '), expression: EXPRESSIONS.join(' | '), facing: 'left | right', cues: '[{at, pose?, expression?}]', says: '[{from, to}] | "auto"', side: 'left | right (where the character stands)', card: '{kicker?, title ≤ 64, body? ≤ 140}', panel: 'boolean (default: true without a card)'},
    events: ['<character>-cue-<i>']}
};

export const MODULES = Object.fromEntries(Object.entries(DEFINITIONS).map(([id, def]) => [id, {describe: def.describe, params: def.params, events: def.events, timing: timingOf(id), resolve: def.resolve}]));

function definition(model) {
  const def = model && DEFINITIONS[model.module];
  if (!def) throw new Error(`character modules: unknown module ${model?.module}`);
  return def;
}

/** {front, media, overlay} element trees for a character model. */
export function charactersView(model) {
  return definition(model).view(model);
}

/** Renderer-neutral animation ops for a character model. */
export function charactersTimeline(model) {
  const ops = [];
  definition(model).timeline(model, ops);
  return ops;
}
