// A scene for the per-frame rig (docs/rd/per-frame-rig.md): every actor and
// rig prop drawn at time t as one SVG tree, from a plain JSON plan.
//
// CONTRACT (launchclip.rig-scene.v1; the cue compiler writes plans, both
// renderers draw them, the gates measure them):
//
//   rigSceneTree(plan, t, {width, height}, prepared?) → el() SVG node tree
//     (catalog-b-view.mjs `el`), canvas px, transparent background. Pure and
//     seek-safe: the same inputs give an identical tree, whatever was drawn
//     before. Both renderers draw this tree (HyperFrames calls it per frame).
//   rigScenePrepare(plan) → prepared: walk plans, spring checkpoints, carries
//     and the props' flight points, computed once. JSON-serialisable (the
//     HyperFrames page inlines it). With it, a frame costs about the same at
//     any t; the tree is identical with or without it.
//   rigSceneState(plan, t, prepared?) → {actors: [{id, frame, at}], props: [{id, at, scale, holder}]}:
//     the joints (rig units, rigFrame) and prop centres (canvas px) the tree
//     is drawn from, for gates and metrics.
//   validateRigScenePlan(plan) → string[]: what is wrong with a plan ([] when nothing).
//   RIG_FRAME_STYLES: the drawing styles this rig draws (others keep today's rig).
//
//   plan = {
//     schema: 'launchclip.rig-scene.v1',
//     duration?: seconds (checkpoints reach at least this far; default: the last key + 1 s),
//     actors: [{
//       id, character: {params, style}, colors,     (cast.mjs characterLook(...).colors)
//       at: {x, floor, scale},                      canvas px of rig x = 0 and of the ground; px per rig unit
//       track,                                      rig units (rig-frame.mjs rigFrame), see below
//       expressions: [{t, expression}],             the last one at or before t shows
//       mouth?: [{t, viseme}],                      acting.mjs VISEMES names; 'closed' or none: the expression's mouth
//       z?                                          draw order (default: list order); props in hand draw with their holder
//     }],
//     props: [{
//       id, prop,                                   a props.mjs HAND_PROPS name: box, paper-stack, ball, cup, sign, coin
//       path: [{t, at: [x, y]} | {t, holder: {actor, hand: 'l'|'r'}}],
//                                                   at: the prop's centre in canvas px; holder: in that hand at t
//       squash?: [{t, amount, hold, recover}],      flatten (+) / stretch (−) about the prop's bottom
//       colors?: {accent, primary, paper}
//     }]
//   }
//
//   track = {x, facing: 'left'|'right', stance?,
//     facings?: [{t, facing}]                       turns over TURN s from t (a walk also turns to face its travel),
//     walks?: [{start, end, to, stance?, stepLength?}],
//     keys?: [{t, lean?, crouch?, shift?, head?, look?}],   look: 0 front … 1 three-quarter (default: by walk and gesture),
//     hands?: {l|r: [{t, at?: [along the facing, down], bend?, grip?: propId}]},  shoulder-relative;
//                                                   consecutive grip keys lock the hand on that prop's grip
//     feet?: {l|r: [{t, at: [along the facing, down], bend?}]},   hip-relative (kicks, stomps); the foot's place is kept
//     squash?: [{t, amount: −0.6..0.8, hold, recover}]}         a gag: the whole body about the feet, drawn only
//
// Props move like this: between two keys with the same holder the prop stays
// in that hand; between two holders it passes from one hand to the other; a
// run of `at` keys is a smooth curve through them (two equal neighbours
// hold), starting from the hand it left and ending in the hand that takes
// it. A one-hand prop sits in its hand at its grip; a held two-hand prop
// (box, paper-stack) is carried before the chest with both hands on its
// sides. An actor holding a prop carries it: the arm comes forward and stops
// swinging. Seated sets (sit) are not supported; keep today's rig for them.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {VISEMES} from './acting.mjs';
import {characterLook, starterCharacter} from './cast.mjs';
import {HAND_PROPS} from './props.mjs';
import {pathAt, planWalks, rigFrame, springCheckpoints, squashAt} from './rig-frame.mjs';
import {RIG_FRAME_STYLES, drawRigFrame, rigPropNodes, squashTransform} from './rig-frame-draw.mjs';

export {RIG_FRAME_STYLES};
export const RIG_SCENE_SCHEMA = 'launchclip.rig-scene.v1';

const r1 = value => Math.round(value * 10) / 10;
const r3 = value => Math.round(value * 1000) / 1000;
const group = (children, attrs) => el('g', null, null, children, attrs);
const smooth = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const sameHolder = (a, b) => a.actor === b.actor && a.hand === b.hand;
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Every time in the plan, for the checkpoints' reach. */
function sceneEnd(plan) {
  let end = plan.duration ?? 0;
  const see = list => { for (const k of list ?? []) if (Number.isFinite(k.t)) end = Math.max(end, k.t + 1); };
  for (const a of plan.actors) {
    const tr = a.track;
    see(tr.keys); see(tr.facings); see(tr.squash); see(a.expressions); see(a.mouth);
    for (const side of ['l', 'r']) { see(tr.hands?.[side]); see(tr.feet?.[side]); }
    for (const w of tr.walks ?? []) end = Math.max(end, w.end + 1);
  }
  for (const p of plan.props) { see(p.path); see(p.squash); }
  return end;
}

/** The props an actor holds, from the props' paths → [{prop: kind, side, start, end?}]. */
function carriesFor(plan, actorId) {
  const out = [];
  for (const p of plan.props) {
    const keys = p.path;
    for (let i = 0; i < keys.length; i++) {
      const h = keys[i].holder;
      if (!h || h.actor !== actorId) continue;
      let j = i;
      while (keys[j + 1]?.holder && sameHolder(keys[j + 1].holder, h)) j++;
      // Held from the path's first key: held from the start.
      out.push({prop: p.prop, side: h.hand, start: i === 0 ? Math.min(0, keys[0].t) : keys[i].t, ...(j < keys.length - 1 ? {end: keys[j].t} : {})});
      i = j;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A smooth run of points [{t, at}] at t: Catmull-Rom (rig-frame.mjs pathAt), holding where two neighbours are equal. */
function runAt(points, t, pathAt) {
  const n = points.length;
  if (t <= points[0].t) return points[0].at;
  if (t >= points[n - 1].t) return points[n - 1].at;
  let j = 0;
  while (points[j + 1].t < t) j++;
  if (samePoint(points[j].at, points[j + 1].at)) return points[j].at;
  let lo = j, hi = j + 1;
  while (lo > 0 && !samePoint(points[lo - 1].at, points[lo].at)) lo--;
  while (hi < n - 1 && !samePoint(points[hi].at, points[hi + 1].at)) hi++;
  return pathAt(points.slice(lo, hi + 1), t);
}

/** Frames and props at any time, sharing one memo; prepared parts not yet made are made on demand. */
function evaluator(plan, prepared) {
  const actors = new Map(plan.actors.map(a => [a.id, a]));
  const props = new Map(plan.props.map(p => [p.id, p]));
  const frames = new Map(), busy = new Set();
  const toRig = (a, p) => [(p[0] - a.at.x) / a.at.scale, (p[1] - a.at.floor) / a.at.scale];
  const toCanvas = (a, p) => [a.at.x + p[0] * a.at.scale, a.at.floor + p[1] * a.at.scale];

  function frame(id, t) {
    const key = `${id}@${t}`;
    if (frames.has(key)) return frames.get(key);
    const a = actors.get(id), pa = prepared.actors[id];
    // A hand on a prop held by this same actor would ask for this frame again: such a grip is skipped.
    const inner = busy.has(id);
    busy.add(id);
    const grip = inner ? null : (propId, side, tg) => {
      const p = props.get(propId), s = prop(propId, tg);
      if (!p || !s || (s.holder?.actor === id)) return null;
      const def = HAND_PROPS[p.prop];
      const off = def.hands === 2 ? [(side === 'l' ? -1 : 1) * def.w / 2, 0] : [def.grip.x, def.grip.y];
      return toRig(a, [s.at[0] + off[0] * s.scale, s.at[1] + off[1] * s.scale]);
    };
    const fr = rigFrame(a.character, pa.track, t, {plan: pa.walk, checkpoints: pa.checkpoints, grip});
    if (!inner) { busy.delete(id); frames.set(key, fr); }
    return fr;
  }

  /** A prop in a hand at t: {at (canvas), rig (the holder's units), scale, holder}. */
  function held(kind, holder, t) {
    const a = actors.get(holder.actor), fr = frame(holder.actor, t), def = HAND_PROPS[kind];
    const f = fr.facing === 'left' ? -1 : 1;
    const rig = def.hands === 2 && fr.carry?.prop === kind ? fr.carry.at
      : [fr.arms[holder.hand].palm[0] - f * (def.grip?.x ?? 0), fr.arms[holder.hand].palm[1] - (def.grip?.y ?? 0)];
    return {at: toCanvas(a, rig), rig, scale: a.at.scale, holder};
  }

  const scaleOf = p => {
    const h = p.path.find(k => k.holder)?.holder;
    return (actors.get(h?.actor) ?? plan.actors[0])?.at.scale ?? 1;
  };

  /** The runs of `at` keys with the hand they leave and the hand that takes them: [{t0, t1, points}]. */
  function runs(id) {
    const done = prepared.props[id]?.runs;
    if (done) return done;
    const p = props.get(id), keys = p.path, out = [];
    for (let i = 0; i < keys.length; i++) {
      if (!keys[i].at) continue;
      let j = i;
      while (keys[j + 1]?.at) j++;
      const points = keys.slice(i, j + 1).map(k => ({t: k.t, at: k.at}));
      if (keys[i - 1]?.holder) points.unshift({t: keys[i - 1].t, at: held(p.prop, keys[i - 1].holder, keys[i - 1].t).at});
      if (keys[j + 1]?.holder) points.push({t: keys[j + 1].t, at: held(p.prop, keys[j + 1].holder, keys[j + 1].t).at});
      out.push({t0: points[0].t, t1: points.at(-1).t, points});
      i = j;
    }
    prepared.props[id] = {...prepared.props[id], runs: out};
    return out;
  }

  /** A prop at t: {at: its centre (canvas px), scale, holder (when in one hand), rig (in the holder's units)}. */
  function prop(id, t) {
    const p = props.get(id), keys = p.path, scale = scaleOf(p);
    let i = -1;
    while (i + 1 < keys.length && keys[i + 1].t <= t) i++;
    const k = keys[Math.max(0, i)], next = i < 0 ? null : keys[i + 1];
    if (k.holder && (!next || next.holder)) {
      if (!next || sameHolder(next.holder, k.holder) || i < 0) return held(p.prop, k.holder, t);
      // Passed from hand to hand.
      const u = smooth((t - k.t) / (next.t - k.t));
      return {at: lerp2(held(p.prop, k.holder, t).at, held(p.prop, next.holder, t).at, u), scale, holder: null};
    }
    const run = runs(id).find(r => t >= r.t0 && t <= r.t1);
    if (run) return {at: runAt(run.points, t, pathAt), scale, holder: null};
    return {at: (i < 0 ? keys[0] : k).at, scale, holder: null};
  }

  return {frame, prop, runs, toCanvas};
}

/** Precompute what every frame shares (JSON-serialisable). */
export function rigScenePrepare(plan) {
  const end = sceneEnd(plan);
  const prepared = {schema: RIG_SCENE_SCHEMA, end, actors: {}, props: {}};
  for (const a of plan.actors) {
    const track = {...a.track, carries: carriesFor(plan, a.id)};
    const walk = planWalks(track);
    prepared.actors[a.id] = {track, walk, checkpoints: springCheckpoints(a.character, track, end, walk)};
  }
  const ev = evaluator(plan, prepared);
  for (const p of plan.props) ev.runs(p.id);
  return prepared;
}

/** The joints and prop places the tree at t is drawn from. */
export function rigSceneState(plan, t, prepared = rigScenePrepare(plan)) {
  const ev = evaluator(plan, prepared);
  return {
    actors: plan.actors.map(a => ({id: a.id, frame: ev.frame(a.id, t), at: a.at})),
    props: plan.props.map(p => ({id: p.id, ...ev.prop(p.id, t)}))
  };
}

const lastAt = (list, t, name) => (list ?? []).filter(k => k.t <= t + 1e-9).at(-1)?.[name];

/** The scene at time t as an SVG tree (canvas px), with a transparent background. */
export function rigSceneTree(plan, t, {width, height}, prepared = rigScenePrepare(plan)) {
  const ev = evaluator(plan, prepared);
  const propStates = plan.props.map(p => ({p, s: ev.prop(p.id, t)}));
  const propNode = (p, at, scale) => {
    const def = HAND_PROPS[p.prop];
    const sq = squashTransform(squashAt(p.squash, t), [0, def.h / 2]);
    const nodes = rigPropNodes(p.prop, p.colors);
    return group(sq ? [group(nodes, {transform: sq})] : nodes, {transform: `translate(${r1(at[0])} ${r1(at[1])})${scale === 1 ? '' : ` scale(${r3(scale)})`}`});
  };
  const order = plan.actors.map((a, i) => ({a, z: a.z ?? i, i})).sort((x, y) => x.z - y.z || x.i - y.i);
  const kids = order.map(({a}) => {
    const frame = ev.frame(a.id, t);
    // A prop goes with the hand that holds it; a two-hand prop is drawn on the near side, under the near arm.
    const held = {l: [], r: []}, near = frame.facing === 'left' ? 'l' : 'r';
    for (const {p, s} of propStates) if (s.holder?.actor === a.id) held[HAND_PROPS[p.prop].hands === 2 ? near : s.holder.hand].push(propNode(p, s.rig, 1));
    const viseme = lastAt(a.mouth, t, 'viseme');
    const body = drawRigFrame(a.character, a.colors, frame, {id: a.id, expression: lastAt(a.expressions, t, 'expression') ?? 'neutral', viseme: viseme && viseme !== 'closed' ? viseme : null, held});
    return group([body], {transform: `translate(${r1(a.at.x)} ${r1(a.at.floor)}) scale(${r3(a.at.scale)})`});
  });
  for (const {p, s} of propStates) if (!s.holder) kids.push(propNode(p, s.at, s.scale));
  return el('svg', null, {position: 'absolute', left: 0, top: 0}, kids, {width, height, viewBox: `0 0 ${width} ${height}`});
}

// ---------------------------------------------------------------------------
// Validation

const num = v => typeof v === 'number' && Number.isFinite(v);
const point = v => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);

/** What is wrong with a plan: [] when it can be drawn. */
export function validateRigScenePlan(plan) {
  const errors = [];
  const err = (where, what) => errors.push(`${where}: ${what}`);
  if (!plan || typeof plan !== 'object') return ['plan: not an object'];
  if (plan.schema !== RIG_SCENE_SCHEMA) err('schema', `expected ${RIG_SCENE_SCHEMA}`);
  if (plan.duration !== undefined && !(num(plan.duration) && plan.duration >= 0)) err('duration', 'not a time');
  if (!Array.isArray(plan.actors)) err('actors', 'not a list');
  if (!Array.isArray(plan.props)) err('props', 'not a list');
  if (!Array.isArray(plan.actors) || !Array.isArray(plan.props)) return errors;
  // A timed list: each key has a finite t, in order.
  const timed = (where, list, each = () => {}) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return err(where, 'not a list');
    list.forEach((k, i) => {
      if (!k || !num(k.t)) return err(`${where}[${i}]`, 'needs a time t');
      if (i && num(list[i - 1]?.t) && k.t < list[i - 1].t) err(`${where}[${i}]`, 'out of time order');
      each(k, `${where}[${i}]`);
    });
  };
  const squash = (where, list) => timed(where, list, (k, at) => {
    if (!(num(k.amount) && k.amount >= -0.6 && k.amount <= 0.8)) err(at, 'amount must be in −0.6..0.8');
    for (const n of ['hold', 'recover']) if (k[n] !== undefined && !(num(k[n]) && k[n] >= 0)) err(at, `${n} must be ≥ 0`);
  });
  const ids = new Set(plan.actors.map(a => a?.id));
  const propIds = new Set(plan.props.map(p => p?.id));
  if (ids.size !== plan.actors.length) err('actors', 'ids must be unique');
  if (propIds.size !== plan.props.length) err('props', 'ids must be unique');
  plan.actors.forEach((a, n) => {
    const at = `actors[${n}]${a?.id ? ` (${a.id})` : ''}`;
    if (!a || typeof a.id !== 'string' || !a.id) return err(at, 'needs an id');
    if (!a.character?.params || typeof a.character.params !== 'object') err(`${at}.character`, 'needs params');
    if (!RIG_FRAME_STYLES.includes(a.character?.style)) err(`${at}.character.style`, `the per-frame rig draws ${RIG_FRAME_STYLES.join(', ')}`);
    if (!a.colors || typeof a.colors !== 'object') err(`${at}.colors`, 'needs the character colours');
    if (!(a.at && num(a.at.x) && num(a.at.floor) && num(a.at.scale) && a.at.scale > 0)) err(`${at}.at`, 'needs x, floor and a positive scale');
    if (a.z !== undefined && !num(a.z)) err(`${at}.z`, 'not a number');
    timed(`${at}.expressions`, a.expressions ?? [], (k, w) => { if (typeof k.expression !== 'string') err(w, 'needs an expression'); });
    timed(`${at}.mouth`, a.mouth, (k, w) => { if (!(k.viseme in VISEMES)) err(w, `viseme must be one of ${Object.keys(VISEMES).join(', ')}`); });
    const tr = a.track;
    if (!tr || typeof tr !== 'object') return err(`${at}.track`, 'missing');
    if (!num(tr.x)) err(`${at}.track.x`, 'not a number');
    if (!['left', 'right'].includes(tr.facing)) err(`${at}.track.facing`, 'left or right');
    if (tr.sit !== undefined) err(`${at}.track.sit`, 'sitting is not supported by the per-frame rig');
    if (tr.stance !== undefined && !num(tr.stance)) err(`${at}.track.stance`, 'not a number');
    timed(`${at}.track.facings`, tr.facings, (k, w) => { if (!['left', 'right'].includes(k.facing)) err(w, 'facing left or right'); });
    if (tr.walks !== undefined) {
      if (!Array.isArray(tr.walks)) err(`${at}.track.walks`, 'not a list');
      else tr.walks.forEach((w, i) => {
        const wh = `${at}.track.walks[${i}]`;
        if (!(num(w?.start) && num(w?.end) && w.end > w.start)) err(wh, 'needs start < end');
        if (!num(w?.to)) err(wh, 'needs to');
        if (i && num(w?.start) && num(tr.walks[i - 1]?.end) && w.start < tr.walks[i - 1].end) err(wh, 'overlaps the walk before');
      });
    }
    timed(`${at}.track.keys`, tr.keys, (k, w) => {
      for (const c of ['lean', 'crouch', 'shift', 'head', 'look']) if (k[c] !== undefined && !num(k[c])) err(w, `${c} not a number`);
    });
    for (const [limb, grips] of [['hands', true], ['feet', false]]) {
      const sides = tr[limb];
      if (sides === undefined) continue;
      for (const side of Object.keys(sides)) {
        if (!['l', 'r'].includes(side)) { err(`${at}.track.${limb}`, `side ${side}: l or r`); continue; }
        timed(`${at}.track.${limb}.${side}`, sides[side], (k, w) => {
          if (k.at !== undefined && !point(k.at)) err(w, 'at must be [along, down]');
          if (k.bend !== undefined && ![-1, 1].includes(k.bend)) err(w, 'bend must be 1 or -1');
          if (k.grip !== undefined && (!grips || !propIds.has(k.grip))) err(w, grips ? `grip: no prop ${k.grip}` : 'feet cannot grip');
          if (k.at === undefined && !(grips && k.grip !== undefined)) err(w, grips ? 'needs at or grip' : 'needs at');
        });
      }
    }
    squash(`${at}.track.squash`, tr.squash);
  });
  plan.props.forEach((p, n) => {
    const at = `props[${n}]${p?.id ? ` (${p.id})` : ''}`;
    if (!p || typeof p.id !== 'string' || !p.id) return err(at, 'needs an id');
    if (!(p.prop in HAND_PROPS)) err(`${at}.prop`, `one of ${Object.keys(HAND_PROPS).join(', ')}`);
    if (!Array.isArray(p.path) || !p.path.length) return err(`${at}.path`, 'needs at least one key');
    timed(`${at}.path`, p.path, (k, w) => {
      if ((k.at === undefined) === (k.holder === undefined)) return err(w, 'needs one of at or holder');
      if (k.at !== undefined && !point(k.at)) err(w, 'at must be [x, y]');
      if (k.holder !== undefined && !(ids.has(k.holder?.actor) && ['l', 'r'].includes(k.holder?.hand))) err(w, 'holder needs a cast actor and hand l or r');
    });
    squash(`${at}.squash`, p.squash);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// The R&D prototype scene (eval/per-frame-rig, the side-by-side's right half)

/**
 * One rubber-hose oliver: walks left about 0.6 m with the ball in his right
 * hand, settles, turns to face right, anticipates, throws over the top
 * (released at 4.47 s), follows through, settles into an idle. Today's rig
 * acts the same beats (eval/per-frame-rig/today.storyboard.json).
 */
export const PROTOTYPE = Object.freeze({
  id: 'oliver',
  style: 'rubber-hose',
  brand: {primary: '#9a3b2e', accent: '#c9a227', paper: '#fdfcf8', ink: '#1c1a1f', bg: '#e9e1cf'},
  at: {x: 648, floor: 1420.8, scale: 0.864},
  release: {t: 4.47, velocity: [1100, -820], gravity: 2300},
  track: {
    x: 0, facing: 'left', stance: 22,
    walks: [{start: 0.3, end: 1.75, to: -330, stance: 46}],
    facings: [{t: 2.3, facing: 'right'}],
    squash: [{t: 1.8, amount: 0.12, hold: 0.04, recover: 0.32}],
    keys: [
      {t: 0, lean: 0, crouch: 0, shift: 0, head: 0},
      {t: 1.75, lean: 0, crouch: 0, shift: 0},
      {t: 2.15, crouch: 8},
      {t: 2.6, crouch: 0, shift: 6},
      {t: 3.45, lean: 0, crouch: 0, shift: 6, head: 0},
      {t: 4.12, lean: -11, crouch: 30, shift: -34, head: -6},
      {t: 4.3, lean: -12, crouch: 32, shift: -38},
      {t: 4.5, lean: 15, crouch: 14, shift: 30, head: 4},
      {t: 4.8, lean: 10, crouch: 18, shift: 32},
      {t: 5.4, lean: 2, crouch: 4, shift: 10, head: 0},
      // Idle: the weight rocks from the front foot to the back and returns, the body counter-leaning, the head tilting.
      {t: 6.2, shift: -26, crouch: 10, lean: 4, head: -5},
      {t: 7.2, shift: 22, crouch: 4, lean: -1, head: 4},
      {t: 8, shift: 0, crouch: 6, lean: 2, head: 0}
    ],
    hands: {
      r: [
        // The hand swings back and up (the arm straight as it passes behind), cocks behind the head,
        // holds, then whips over the top to release ahead and follows through down and across.
        {t: 3.45, at: [125, 190]},
        {t: 3.7, at: [20, 292]},
        {t: 3.92, at: [-150, 245]},
        {t: 4.06, at: [-282, 100], bend: -1},
        {t: 4.2, at: [-150, -150], bend: -1},
        {t: 4.31, at: [-128, -178], bend: -1},
        {t: 4.4, at: [20, -290], bend: -1},
        {t: 4.47, at: [215, -205]},
        {t: 4.57, at: [288, 40]},
        {t: 4.75, at: [170, 222]},
        {t: 5.05, at: [50, 286]}
      ]
    }
  },
  expressions: [{t: 0, expression: 'happy'}, {t: 4.4, expression: 'delighted'}, {t: 5.6, expression: 'happy'}]
});

/** The prototype as a rig-scene plan: the ball in oliver's right hand, then in flight from the release (gravity, sampled every 0.1 s). style: draw it in another rig style. */
export function prototypePlan(scene = PROTOTYPE, {style = scene.style} = {}) {
  const {params} = starterCharacter(scene.id);
  const colors = characterLook(params, {style, brand: {colors: scene.brand}}).colors;
  const held = {actor: scene.id, hand: 'r'};
  const base = {
    schema: RIG_SCENE_SCHEMA, duration: 8,
    actors: [{id: scene.id, character: {params, style}, colors, at: scene.at, track: scene.track, expressions: scene.expressions}],
    props: [{id: 'ball', prop: 'ball', colors: {accent: scene.brand.accent, primary: scene.brand.primary, paper: scene.brand.paper}, path: [{t: 0, holder: held}, {t: scene.release.t, holder: held}]}]
  };
  const {t, velocity, gravity} = scene.release;
  const p0 = rigSceneState(base, t).props[0].at, k = scene.at.scale;
  const flight = Array.from({length: 12}, (_, i) => {
    const dt = (i + 1) * 0.1;
    return {t: r3(t + dt), at: [r1(p0[0] + velocity[0] * k * dt), r1(p0[1] + (velocity[1] * dt + 0.5 * gravity * dt * dt) * k)]};
  });
  return {...base, props: [{...base.props[0], path: [...base.props[0].path, ...flight]}]};
}
