// Character shots and acting (kit/core/characters/framing.mjs, aim.mjs,
// style-stick.mjs, acting.mjs): framed shots keep faces readable, inside the
// safe zone and above the caption band; a cue cuts in on a character; points
// aim without crossing and stay in the safe zone; seated stick legs never
// cross; idle arms move; hair shows around the face and under headwear.
import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveModule} from '@launchclip/core/modules.mjs';
import {charactersTimeline} from '@launchclip/core/catalog-characters.mjs';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {SHOTS, defaultShot, frameGuides} from '@launchclip/core/characters/framing.mjs';
import {poseJoints, rigGeometry, normalizeRigParams, POSES} from '@launchclip/core/characters/rig.mjs';
import {styleGeometry} from '@launchclip/core/characters/styles.mjs';
import {ACTING} from '@launchclip/core/characters/acting.mjs';
import {hairPeek, stickHairBack} from '@launchclip/core/characters/style-stick.mjs';
import {flatPen} from '@launchclip/core/characters/style-flat.mjs';
import {toonColors} from '@launchclip/core/characters/toon.mjs';

const brand = {colors: {bg: '#f4ead8', primary: '#a8572b', accent: '#2c6e63', ink: '#fffaf0', paper: '#1d1a17'}, fonts: {display: 'anton', body: 'inter', meta: 'jetbrains-mono'}};
const PORTRAIT = {width: 1080, height: 1920}, LANDSCAPE = {width: 1920, height: 1080};
const story = (scenes, {canvas = PORTRAIT, style = 'stick', ids = ['maya', 'theo', 'fatima']} = {}) => ({schema: 'launchclip.story.v1', lane: 'motion', format: {...canvas, fps: 30, duration: 4}, brand, cast: {style, characters: ids.map(id => ({id}))}, scenes});
const castScene = (params, extra = {}) => ({id: 'c', module: 'cast-scene', start: 0, end: 4, params, ...extra});
const model = (scene, opts) => resolveModule(scene, story([scene], opts));
const headTop = actor => actor.floor - actor.marks.top * actor.scale;
const chin = actor => actor.floor - actor.marks.chin * actor.scale;

test('shot framing: medium and close keep every head inside the safe zone, every face above the caption band, and every reach inside the frame', () => {
  for (const canvas of [PORTRAIT, LANDSCAPE]) for (const style of ['stick', 'flat']) for (const set of ['standing', 'sofa', 'kitchen-counter', 'phone']) for (const count of [1, 2, 3]) for (const shot of ['medium', 'close']) {
    const ids = ['maya', 'theo', 'fatima'].slice(0, count);
    const m = model(castScene({set, shot, cast: ids.map(id => ({id}))}), {canvas, style});
    const {safe, band} = frameGuides(canvas);
    const where = `${canvas.width}x${canvas.height} ${style} ${set} ×${count} ${shot}`;
    assert.equal(m.content.shot.name, shot, where);
    for (const actor of m.content.actors) {
      assert.ok(headTop(actor) >= safe.y - 0.5, `${where}: ${actor.id} head top ${headTop(actor)}`);
      assert.ok(chin(actor) <= band.y + 0.5, `${where}: ${actor.id} chin ${chin(actor)} under the caption band ${band.y}`);
      const r = actor.reach;
      assert.ok(r.left >= safe.x - 0.5 && r.right <= safe.x + safe.width + 0.5 && r.top >= safe.y - 0.5 && r.bottom <= canvas.height, `${where}: ${actor.id} reach ${JSON.stringify(r)}`);
    }
  }
});

test('shot framing: a closer shot draws bigger faces, cut at the frame\'s bottom edge; 9:16 people sets default to medium', () => {
  const scale = shot => model(castScene({set: 'standing', shot, cast: [{id: 'maya'}, {id: 'theo'}]})).content.actors[0];
  const [wide, medium, close] = SHOTS.map(scale);
  assert.ok(medium.scale > wide.scale * 1.4, `medium ${medium.scale} vs wide ${wide.scale}`);
  assert.ok(close.scale >= medium.scale);
  // A stick head reads on a phone: at least 200 px across in a medium two-shot.
  assert.ok(2 * 74 * medium.scale >= 200, `head ${2 * 74 * medium.scale} px`);
  assert.ok(medium.floor > PORTRAIT.height, 'medium cuts the figure at the knees, off the bottom edge');
  assert.equal(medium.reach.bottom, PORTRAIT.height);
  // Defaults.
  assert.equal(defaultShot('standing', PORTRAIT), 'medium');
  assert.equal(defaultShot('screen', PORTRAIT), 'wide');
  assert.equal(defaultShot('standing', LANDSCAPE), 'wide');
  assert.equal(model(castScene({set: 'sofa', cast: [{id: 'maya'}, {id: 'theo'}]})).content.shot.name, 'medium');
  assert.equal(model(castScene({set: 'standing', cast: [{id: 'maya', cues: [{at: 1, action: 'walk-to', target: 'right'}]}]})).content.shot.name, 'wide');
  assert.throws(() => model(castScene({set: 'sofa', shot: 'extreme', cast: [{id: 'maya'}]})), /params\.shot/);
  // The furniture comes in by the shot's zoom, about the cast.
  const sofa = model(castScene({set: 'sofa', shot: 'medium', cast: [{id: 'maya'}, {id: 'theo'}]}));
  assert.ok(sofa.content.shot.set.scale > 1.2);
});

test('a cameo framed medium or close stands in no floor: its head tops its rect and its body runs off the frame', () => {
  const cameo = shot => resolveModule({id: 'k', module: 'character-cameo', start: 0, end: 4, params: {character: 'maya', panel: false, rect: {x: 80, y: 280, width: 540, height: 880}, ...(shot ? {shot} : {})}}, story([])).content.actors[0];
  const wide = cameo(null), medium = cameo('medium'), close = cameo('close');
  assert.ok(wide.floor <= 280 + 880 + 0.5, 'a wide cameo stands on its rect\'s bottom');
  for (const actor of [medium, close]) {
    assert.ok(actor.scale > wide.scale * 1.3);
    assert.ok(actor.floor > PORTRAIT.height);
    assert.ok(headTop(actor) >= 280 - 0.5);
    assert.ok(chin(actor) <= frameGuides(PORTRAIT).band.y);
  }
  assert.throws(() => resolveModule({id: 'k', module: 'character-cameo', start: 0, end: 4, params: {character: 'maya', cues: [{at: 1, shot: 'close'}]}}, story([])), /shot/);
});

test('a cue shot cuts in on its character (head centred in the safe zone, a hard cut) and the scene\'s shot cuts back', () => {
  const scene = castScene({set: 'standing', shot: 'medium', cast: [{id: 'maya'}, {id: 'theo', cues: [{at: 1, shot: 'close'}, {at: 2.5, shot: 'medium'}]}]});
  const m = model(scene);
  const [cut, back] = m.content.shot.punches;
  assert.equal(cut.time, 1);
  assert.ok(cut.scale > 1.2);
  const theo = m.content.actors[1];
  const head = {x: theo.x * cut.scale + cut.x, y: headTop(theo) * cut.scale + cut.y};
  const {safe} = frameGuides(PORTRAIT);
  assert.ok(Math.abs(head.x - (safe.x + safe.width / 2)) < 2, `head centred in the safe zone at ${head.x}`);
  assert.ok(head.y >= frameGuides(PORTRAIT).safe.y);
  assert.deepEqual(back, {time: 2.5, x: 0, y: 0, scale: 1});
  const ops = charactersTimeline(m).filter(op => op.target === 'c-punch');
  assert.ok(ops.every(op => op.type === 'set'), 'a cut, not a move');
  assert.equal(frameState(ops, 1.5).get('c-punch').scaleX, cut.scale);
  assert.equal(frameState(ops, 3).get('c-punch').scaleX, 1);
});

test('pointing: two characters pointing at each other aim at the chest and never cross arms; pointing outward stays in the safe zone', () => {
  for (const shot of ['wide', 'medium', 'close']) for (const set of ['standing', 'sofa']) {
    const m = model(castScene({set, shot, cast: [{id: 'maya', cues: [{at: 0.5, action: 'point-at', target: {character: 'theo'}}]}, {id: 'theo', cues: [{at: 0.5, action: 'point-at', target: {character: 'maya'}}]}]}));
    const [maya, theo] = m.content.actors;
    const a = maya.states.at(-1).aim, b = theo.states.at(-1).aim;
    assert.ok(a && b, `${shot} ${set}: both aim`);
    assert.equal(a.side, 'R');
    assert.equal(b.side, 'L');
    assert.ok(a.tip.x < b.tip.x - 10, `${shot} ${set}: tips ${a.tip.x} and ${b.tip.x} cross`);
    assert.ok(a.tip.x < theo.x && b.tip.x > maya.x);
  }
  const {safe} = frameGuides(PORTRAIT);
  for (const target of ['right', {x: 1075, y: 300}, {x: 1080, y: 1200}]) {
    const m = model(castScene({set: 'standing', shot: 'wide', cast: [{id: 'theo'}, {id: 'maya', cues: [{at: 0.5, action: 'point-at', target}]}]}));
    const maya = m.content.actors[1];
    const tip = maya.states.at(-1).aim.tip;
    assert.ok(tip.x <= safe.x + safe.width && tip.y >= safe.y, `tip ${JSON.stringify(tip)} for ${JSON.stringify(target)}`);
    assert.ok(maya.reach.right <= safe.x + safe.width + 0.5, `reach ${maya.reach.right}`);
  }
});

// Leg geometry as the view draws it: rotate(leg) scaleY(legScale) on the
// thigh's joint, the shin rotated at the knee inside it; the right side mirrored.
function legPoints(g, j, side) {
  const s = side === 'L' ? 1 : -1;
  const th = (j[`leg${side}`] * Math.PI) / 180, sh = (j[`shin${side}`] * Math.PI) / 180;
  const local = [[0, 0], [0, g.thigh], [-Math.sin(sh) * g.shin, g.thigh + Math.cos(sh) * g.shin]];
  return local.map(([x, y]) => {
    const sy = y * j.legScale;
    const wx = x * Math.cos(th) - sy * Math.sin(th), wy = x * Math.sin(th) + sy * Math.cos(th);
    return {x: (side === 'L' ? -g.legX : g.legX) + s * wx, y: wy};
  });
}

test('a seated stick figure sits with its legs apart, the shins never crossing', () => {
  const params = normalizeRigParams({build: 'average', skin: 'brown', hair: {style: 'short', color: 'copper'}});
  for (const style of ['stick', 'stick-classic']) {
    const g = styleGeometry(style, params);
    const j = poseJoints('sit', {facing: 'right', seated: true, geometry: g});
    const [hipL, kneeL, footL] = legPoints(g, j, 'L'), [hipR, kneeR, footR] = legPoints(g, j, 'R');
    assert.ok(kneeL.x < hipL.x && kneeR.x > hipR.x, `${style}: the knees part`);
    assert.ok(footL.x < -g.w && footR.x > g.w, `${style}: the feet stay apart (${footL.x}, ${footR.x})`);
    assert.ok(footL.x < kneeL.x + 2 && footR.x > kneeR.x - 2, `${style}: the shins drop down, not in`);
  }
  // The toon styles keep their own seat.
  const flat = poseJoints('sit', {facing: 'right', seated: true, geometry: rigGeometry(params)});
  assert.deepEqual([flat.legL, flat.shinL], [10, -10]);
});

test('the acting poses exist in every style, and a stick figure\'s arms and body never hold still', () => {
  for (const pose of ['arms-crossed', 'hands-on-hips', 'facepalm', 'lean-in', 'point-self']) assert.ok(POSES.includes(pose));
  const m = model(castScene({set: 'standing', cast: [{id: 'maya', pose: 'arms-crossed'}]}));
  const ops = charactersTimeline(m);
  for (const part of ['armidle-l', 'armidle-r', 'foreidle-l', 'foreidle-r']) {
    const list = ops.filter(op => op.target === `c-c0-${part}`);
    assert.ok(list.length >= 1, part);
    // Seek-safe and bounded: any frame gives a rotation inside the swing.
    for (const t of [0.3, 1.1, 2.2, 3.7]) {
      const value = frameState(list, t).get(`c-c0-${part}`)?.rotation ?? 0;
      assert.ok(Math.abs(value) <= Math.max(ACTING.armDeg, ACTING.foreDeg) + 1e-9, `${part} at ${t}: ${value}`);
    }
  }
  // The sway starts from upright (no pop) and stays small.
  const body = ops.filter(op => op.target === 'c-c0-breath' && op.to?.rotation !== undefined);
  assert.ok(body.length && body[0].from.rotation === 0);
  // Toon styles are unchanged.
  const flat = charactersTimeline(model(castScene({set: 'standing', cast: [{id: 'maya'}]}), {style: 'flat'}));
  assert.equal(flat.filter(op => /idle-[lr]$/.test(op.target)).length, 0);
});

test('stick identity: hair shows under headwear and braids hang around the face', () => {
  const colors = toonColors({hair: '#b5512a', hairShade: '#7a3519', hairLight: '#d47a4e', outline: '#1d1a17', skin: '#f1c7a5', skinShade: '#d9a585', accent: '#22305a', accentShade: '#161f3c'});
  const P = flatPen(colors);
  const ctx = params => ({g: rigGeometry(params), p: params, P});
  const sam = normalizeRigParams({build: 'athletic', skin: 'fair', hair: {style: 'short', color: 'copper'}, headwear: 'cap', accessories: ['stubble']});
  assert.equal(hairPeek(ctx(sam)).length, 2, 'a lock of hair each side of the cap');
  assert.equal(hairPeek(ctx({...sam, headwear: 'beanie'})).length, 2, 'even a covering hat shows the hair colour');
  assert.equal(hairPeek(ctx({...sam, hair: {style: 'bald', color: 'copper'}})).length, 0);
  assert.equal(hairPeek(ctx({...sam, headwear: undefined})).length, 0);
  // Braids: strands only at the sides, outside the face.
  const mia = normalizeRigParams({build: 'average', skin: 'deep', hair: {style: 'braids', color: 'auburn'}});
  const {rx} = rigGeometry(mia).head;
  const strands = JSON.stringify(stickHairBack(ctx(mia))).match(/M(-?[\d.]+) -?[\d.]+L/g).map(d => Math.abs(Number(d.slice(1).split(' ')[0])));
  assert.ok(strands.length >= 6);
  assert.ok(strands.every(x => x >= rx * 0.6 - 0.5), `strand roots ${strands.join(', ')} clear of the face (rx ${rx})`);
});
