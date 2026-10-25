// Generated casts and the wider rig (kit/core/characters/generate.mjs,
// rig.mjs): character sets, determinism, distinct and valid people, and
// every new option drawn in every style.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AGES, BOTTOMS, GLASSES, HAIR_STYLES, HEADWEAR, MOBILITY, OVERS, TOPS, ACCESSORIES, normalizeRigParams, rigFingerprint, rigGeometry} from '../kit/core/characters/rig.mjs';
import {CHARACTER_SETS, CHARACTER_SET_NAMES, castFromStyle, generateCast} from '../kit/core/characters/generate.mjs';
import {resolveStoryCast, storyCastErrors} from '../kit/core/characters/cues.mjs';
import {characterLook, starterCharacter} from '../kit/core/characters/cast.mjs';
import {sceneJoints} from '../kit/core/characters/acting.mjs';
import {DRAWING_STYLES, drawCharacter, styleGeometry} from '../kit/core/characters/styles.mjs';
import {drawingBounds} from '../kit/core/characters/bounds.mjs';
import {resolveModule} from '../kit/core/modules.mjs';

const palette = {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'};

test('rig: new options are optional and keep old characters identical', () => {
  const old = starterCharacter('maya').params;
  assert.deepEqual(Object.keys(old), ['build', 'height', 'skin', 'hair', 'outfit', 'accessories', 'colors'], 'no new keys on an old character');
  const p = normalizeRigParams({skin: 'umber', hair: {style: 'mohawk', color: 'blue-dye'}, age: 'teen', outfit: {top: 'jersey', bottom: 'shorts', over: 'vest'}, headwear: 'headphones', mobility: 'wheelchair'});
  assert.deepEqual(Object.keys(p), ['build', 'height', 'age', 'skin', 'hair', 'outfit', 'accessories', 'headwear', 'mobility', 'colors']);
  assert.equal(normalizeRigParams({skin: 'tan', hair: {style: 'long'}, age: 'adult'}).age, undefined, 'the default age is left out');
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'long'}, age: 'child', accessories: ['beard']}), /a child has no beard/);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'headscarf'}, headwear: 'cap'}), /does not go over a headscarf/);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'long'}, accessories: ['sunglasses', 'glasses']}), /one pair of glasses/);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'long'}, mobility: 'jetpack'}), /mobility must be one of/);
  assert.ok(rigGeometry(normalizeRigParams({skin: 'tan', hair: {style: 'long'}, age: 'child'})).height < 0.75 * rigGeometry(normalizeRigParams({skin: 'tan', hair: {style: 'long'}})).height, 'children are smaller');
});

test('every rig option draws in every style, inside its bounds', () => {
  const base = {skin: 'medium', hair: {style: 'short'}};
  const variants = [
    ...HAIR_STYLES.map(style => ({hair: {style}})), ...HEADWEAR.map(headwear => ({headwear})), ...TOPS.map(top => ({outfit: {top}})),
    ...BOTTOMS.map(bottom => ({outfit: {bottom}})), ...OVERS.map(over => ({outfit: {over}})), ...ACCESSORIES.map(name => ({accessories: [name]})),
    ...MOBILITY.map(mobility => ({mobility})), ...AGES.map(age => ({age}))
  ];
  for (const style of DRAWING_STYLES) {
    for (const variant of variants) {
      const params = normalizeRigParams({...base, ...variant});
      const {colors} = characterLook(params, {style});
      const geometry = styleGeometry(style, params);
      const joints = sceneJoints('wave', {facing: 'right', geometry, params});
      const drawing = drawCharacter(style, params, colors, {id: 'g', joints, expression: 'happy', expressions: ['happy']});
      const json = JSON.stringify(drawing);
      assert.ok(!/undefined|NaN/.test(json), `${style} ${JSON.stringify(variant)} draws cleanly`);
      const box = drawingBounds(drawing);
      assert.ok(box.bottom >= -1 && box.top < -500 && box.right - box.left < 1400, `${style} ${JSON.stringify(variant)} bounds ${JSON.stringify(box)}`);
    }
  }
});

test('a held cane stays on the floor through every pose; the phone moves to the other hand', () => {
  const params = normalizeRigParams({skin: 'tan', hair: {style: 'short'}, mobility: 'cane'});
  const geometry = rigGeometry(params);
  for (const pose of ['wave', 'cheer', 'shrug', 'type', 'think', 'point']) {
    const j = sceneJoints(pose, {facing: 'right', geometry, params});
    assert.deepEqual([j.armL, j.foreL], [8, 2], `${pose}: the cane arm (left when facing right) rests`);
  }
  const phone = sceneJoints('stand', {facing: 'right', geometry, params, holds: 'phone'});
  assert.equal(phone.foreR, -114, 'the phone is in the facing hand');
  const chair = sceneJoints('stand', {facing: 'right', geometry, params: {...params, mobility: 'wheelchair'}});
  assert.equal(chair.lower, 'sit', 'a wheelchair user sits in a standing set');
});

test('generateCast: deterministic, valid, distinct, and shaped by the set', () => {
  for (const set of CHARACTER_SET_NAMES) {
    const a = generateCast({seed: '7f3a91c2', set, count: 6, palette});
    assert.deepEqual(a, generateCast({seed: '7f3a91c2', set, count: 6, palette}), `${set}: same seed, same cast`);
    assert.notDeepEqual(a, generateCast({seed: '7f3a91c3', set, count: 6, palette}), `${set}: another seed, another cast`);
    assert.deepEqual(storyCastErrors({characters: a}), [], `${set}: a valid story cast`);
    assert.equal(new Set(a.map(m => m.id)).size, 6, `${set}: unique ids`);
    assert.equal(new Set(a.map(({id, name, voice, ...params}) => rigFingerprint(normalizeRigParams(params)))).size, 6, `${set}: distinct people`);
    assert.ok(new Set(a.map(m => m.skin)).size >= 4, `${set}: skin tones spread across the range`);
  }
  const chefs = generateCast({seed: 'abc', set: 'chefs', count: 8});
  assert.ok(chefs.filter(m => m.outfit.top === 'chef-coat').length >= 4, 'chefs wear chef coats');
  assert.ok(generateCast({seed: 'abc', set: 'kids', count: 5}).every(m => m.age === 'child'), 'kids are children');
  assert.ok(generateCast({seed: 'abc', set: 'seniors', count: 5}).every(m => m.age === 'senior'), 'seniors are older');
  assert.ok(generateCast({seed: 'abc', set: 'medical', count: 6}).every(m => ['scrubs', 'lab-coat'].includes(m.outfit.top)), 'medical teams wear scrubs or lab coats');
  for (const set of CHARACTER_SET_NAMES) assert.ok(CHARACTER_SETS[set].describe && CHARACTER_SETS[set].props.length, `${set} describes itself and its props`);
  assert.throws(() => generateCast({seed: 'x', set: 'pirates'}), /unknown character set "pirates"/);
  assert.throws(() => generateCast({set: 'kids'}), /needs a seed/);
});

test('generated casts: thousands of distinct people over seeds, with the rarer options present', () => {
  const people = new Set();
  const seen = {mobility: new Set(), headwear: new Set(), age: new Set(), glasses: 0};
  for (const set of CHARACTER_SET_NAMES) for (let k = 0; k < 60; k++) {
    for (const m of generateCast({seed: k.toString(16).padStart(8, '0'), set, count: 4, palette})) {
      people.add(JSON.stringify({...m, id: 0, name: 0, voice: 0}));
      if (m.mobility) seen.mobility.add(m.mobility);
      if (m.headwear) seen.headwear.add(m.headwear);
      seen.age.add(m.age ?? 'adult');
      if (m.accessories.some(name => GLASSES.includes(name))) seen.glasses++;
    }
  }
  assert.ok(people.size >= 2600, `${people.size} distinct people`);
  assert.ok(seen.mobility.size >= 5 && seen.headwear.size >= 10 && seen.age.size === 4 && seen.glasses > 300);
});

test('castFromStyle reads a seeded style pack cast; a generated cast plays a scene in any style', () => {
  const members = generateCast({seed: '7f3a91c2', set: 'startup-founders', count: 3, palette});
  const cast = castFromStyle({drawing_style: 'flat', set: 'startup-founders', members});
  assert.equal(cast.style, 'flat');
  assert.equal(resolveStoryCast({cast}).members.size, 3);
  assert.deepEqual(castFromStyle({drawing_style: 'flat', characters: ['maya']}).characters, [{id: 'maya'}]);
  assert.throws(() => castFromStyle({drawing_style: 'oil'}), /drawing_style must be one of/);
  for (const style of DRAWING_STYLES) {
    const story = {format: {width: 1920, height: 1080, fps: 30, duration: 4}, brand: {colors: palette}, cast: {...cast, style}};
    const model = resolveModule({id: 's', module: 'cast-scene', start: 0, end: 4, params: {set: 'phone', cast: members.map(m => ({id: m.id}))}}, story);
    assert.equal(model.content.actors.length, 3);
    assert.ok(model.content.actors.every(actor => actor.style === style));
  }
});

test('balanced casts: a woman and a man, and a light-skinned person, in every cast of two or more', async () => {
  const {SKIN_ORDER} = await import('../kit/core/characters/palette.mjs');
  const light = SKIN_ORDER.slice(0, Math.ceil(SKIN_ORDER.length / 3));
  for (const set of CHARACTER_SET_NAMES) for (let k = 0; k < 40; k++) for (const count of [2, 3, 6]) {
    const cast = generateCast({seed: `b${k}`, set, count});
    assert.ok(cast.some(m => light.includes(m.skin)), `${set} ${k} ${count}: a light skin tone`);
    const kinds = new Set(cast.map(m => m.voice.slice(1, 2)));
    assert.ok(kinds.has('f') && kinds.has('m'), `${set} ${k} ${count}: women and men`);
  }
});

test('the starter cast includes white men and women, children and a teen', () => {
  for (const id of ['oliver', 'hannah', 'ben', 'lily', 'kofi', 'max']) assert.ok(starterCharacter(id), id);
  assert.equal(starterCharacter('ben').params.age, 'child');
  assert.equal(starterCharacter('max').params.age, 'teen');
  assert.deepEqual(generateCast({seed: 'x', set: 'kids', count: 12}).filter(m => ['oliver', 'hannah', 'ben', 'lily', 'kofi', 'max'].includes(m.id)), [], 'generated ids never reuse a starter id');
});
