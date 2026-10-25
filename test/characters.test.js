// The character kit (kit/core/characters/): rig params, the starter cast,
// poses and expressions, the drawing, acting ops, story casts and cues.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCESSORIES, BUILDS, EXPRESSIONS, EXPRESSION_TABLE, HAIR_STYLES, POSES, POSE_TABLE, TOPS, normalizeRigParams, poseJoints, rigFingerprint, rigGeometry} from '../kit/core/characters/rig.mjs';
import {STARTER_CAST, STARTER_IDS, characterLook, starterCharacter} from '../kit/core/characters/cast.mjs';
import {SKIN_TONES, castRoles, characterColors} from '../kit/core/characters/palette.mjs';
import {drawFlat} from '../kit/core/characters/style-flat.mjs';
import {characterView} from '../kit/core/characters/view.mjs';
import {ACTING, actingOps, jointTargets, speechChanges} from '../kit/core/characters/acting.mjs';
import {castConsistency, castMember, cueWordIndex, resolveCastCues, resolveStoryCast, sceneCastCues, storyCastErrors, validateCastCues} from '../kit/core/characters/cues.mjs';
import {SETS, layoutSet} from '../kit/core/characters/sets.mjs';
import {frameState} from '../kit/core/catalog-b-view.mjs';

const brand = {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}};
const maya = () => starterCharacter('maya');

test('rig params normalise to a fixed shape and reject unknown parts', () => {
  const params = normalizeRigParams({skin: 'brown', hair: {style: 'curly'}});
  assert.deepEqual(Object.keys(params), ['build', 'height', 'skin', 'hair', 'outfit', 'accessories', 'colors']);
  assert.deepEqual(params.outfit, {top: 'tee', bottom: 'trousers'});
  assert.equal(params.colors.top, 'primary', 'clothes default to brand roles');
  assert.equal(normalizeRigParams({skin: 'tan', hair: {style: 'long'}, outfit: {top: 'dress'}}).outfit.bottom, 'skirt');
  assert.deepEqual(normalizeRigParams({skin: 'tan', hair: {style: 'long'}, accessories: ['glasses', 'beard', 'glasses']}).accessories, ['beard', 'glasses']);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'mullet'}}), /hair\.style must be one of/);
  assert.throws(() => normalizeRigParams({skin: 'green', hair: {style: 'long'}}), /skin must be a skin tone/);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'long'}, wings: true}), /wings is not a rig param/);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'headscarf'}, accessories: ['earrings']}), /under a headscarf/);
  assert.throws(() => normalizeRigParams({skin: 'tan', hair: {style: 'long'}, accessories: ['glasses', 'round-glasses']}), /one pair of glasses/);
  assert.equal(rigFingerprint(params), rigFingerprint(normalizeRigParams({hair: {style: 'curly'}, skin: 'brown'})), 'key order does not change identity');
});

test('the starter cast: about two dozen valid characters with stable, unique ids and a varied mix', () => {
  assert.ok(STARTER_CAST.length >= 24);
  assert.equal(new Set(STARTER_IDS).size, STARTER_IDS.length);
  for (const id of STARTER_IDS) assert.match(id, /^[a-z][a-z0-9-]*$/);
  const all = STARTER_IDS.slice(0, 24).map(id => starterCharacter(id).params);
  const kinds = key => new Set(all.map(p => (typeof p[key] === 'object' ? JSON.stringify(p[key].style ?? p[key].top) : p[key])));
  assert.ok(kinds('skin').size >= 7, 'skin tones across the range');
  assert.equal(kinds('build').size, 5, 'every original build');
  assert.ok(new Set(all.map(p => p.hair.style)).size >= 12, 'hair styles and textures');
  assert.equal(new Set(all.map(p => p.outfit.top)).size, 6, 'every original top');
  for (const accessory of ['glasses', 'hearing-aid', 'beard']) assert.ok(all.some(p => p.accessories.includes(accessory)), accessory);
  assert.ok(all.some(p => p.hair.style === 'headscarf'));
  assert.ok(all.some(p => ['grey', 'silver'].includes(p.hair.color)), 'older characters');
  for (const entry of STARTER_CAST) assert.ok(!/\b(he|she|him|her|his|hers)\b/i.test(entry.summary), `${entry.id}: summaries stay neutral`);
  // The first ids are part of the contract: they never change.
  assert.deepEqual(STARTER_IDS.slice(0, 6), ['maya', 'theo', 'amara', 'kenji', 'fatima', 'diego']);
  assert.ok(Object.keys(SKIN_TONES).length >= 16 && HAIR_STYLES.length >= 26 && ACCESSORIES.length >= 20 && BUILDS.length >= 8 && TOPS.length >= 17);
});

test('brand roles dress the cast; a cast mapping overrides them', () => {
  const look = characterLook(maya().params, {brand});
  assert.equal(look.colors.top, '#fdb022', 'the hoodie wears the brand primary');
  const mapped = characterLook(maya().params, {brand, mapping: {primary: 'teal'}});
  assert.equal(mapped.colors.top, '#1f7a7a');
  assert.equal(look.fingerprint, mapped.fingerprint, 'identity is the params; colours follow the brand');
  assert.notEqual(look.look, mapped.look);
  assert.equal(castRoles(null).primary, '#3d6fd8', 'a default palette without a brand');
  assert.throws(() => characterColors({...maya().params.colors, top: 'mauve'}, castRoles(brand)), /not a palette colour/);
});

test('poses: every named pose resolves, side poses use the facing arm, seated sets force the seated legs', () => {
  const geometry = rigGeometry(maya().params);
  assert.deepEqual(Object.keys(POSE_TABLE), POSES);
  for (const pose of POSES) {
    const j = poseJoints(pose, {geometry});
    for (const key of ['armL', 'foreL', 'armR', 'foreR', 'legL', 'legR', 'head', 'bodyY', 'legScale']) assert.equal(typeof j[key], 'number', `${pose}.${key}`);
  }
  const right = poseJoints('point', {facing: 'right'}), left = poseJoints('point', {facing: 'left'});
  assert.equal(right.armR, 92);
  assert.equal(left.armL, 92);
  assert.equal(right.fingerR, 1);
  assert.equal(left.fingerL, 1);
  const seated = poseJoints('type', {seated: true, geometry});
  assert.equal(seated.lower, 'sit');
  assert.equal(seated.bodyY, geometry.sitDrop);
  assert.equal(poseJoints('walk', {seated: true, geometry}).gesture, null, 'no walking in a chair');
  assert.throws(() => poseJoints('dance'), /unknown pose/);
  assert.deepEqual(Object.keys(EXPRESSION_TABLE), EXPRESSIONS);
});

test('the drawing: joints become animated divs with stable ids; one face per expression', () => {
  const {params} = maya();
  const look = characterLook(params, {brand});
  const joints = poseJoints('stand', {geometry: rigGeometry(params)});
  const view = characterView(drawFlat(params, look.colors, {id: 's-c0', joints, expression: 'happy', expressions: ['happy', 'frustrated']}), {id: 's-c0', x: 100, y: 900, scale: 0.5});
  const ids = new Map();
  const walk = node => { if (node && typeof node === 'object') { if (node.id) ids.set(node.id, node); (node.children ?? []).forEach(walk); } };
  walk(view);
  for (const part of ['body', 'torso', 'breath', 'head', 'hb', 'headidle', 'arm-l', 'fore-l', 'arm-r', 'fore-r', 'leg-l', 'shin-l', 'leg-r', 'shin-r', 'face-happy', 'face-frustrated', 'eyes-happy', 'mouth-happy', 'open-happy']) {
    assert.ok(ids.has(`s-c0-${part}`), part);
  }
  for (const part of ['arm-l', 'fore-r', 'head', 'eyes-happy']) {
    const node = ids.get(`s-c0-${part}`);
    assert.equal(node.tag, 'div', `${part} is an HTML div (GSAP animates SVG transforms differently)`);
    assert.equal(node.style.transformOrigin, '0px 0px', `${part} turns about its pivot`);
  }
  assert.equal(ids.get('s-c0-face-happy').style.opacity, 1);
  assert.equal(ids.get('s-c0-face-frustrated').style.opacity, 0);
  const html = JSON.stringify(view);
  assert.doesNotMatch(html, /"tag":"joint"/);
});

test('acting: pose changes are eased tweens, gestures return to the pose, mouths follow words', () => {
  const {params} = maya();
  const geometry = rigGeometry(params);
  const ops = [];
  actingOps(ops, {cid: 'c', start: 0, end: 6, geometry, facing: 'right', seated: false, holds: null,
    states: [{time: 0, pose: 'stand', expression: 'neutral'}, {time: 2, pose: 'wave', expression: 'happy'}, {time: 4.5, pose: 'slump', expression: 'frustrated'}],
    expressions: ['neutral', 'happy', 'frustrated'], speech: speechChanges([{from: 0.5, to: 1.5, words: [[0.5, 0.8], [0.9, 1.5]]}])});
  const arm = ops.filter(op => op.target === 'c-arm-r' && op.type === 'tween' && op.start === 2);
  assert.equal(arm.length, 1);
  assert.equal(arm[0].ease, ACTING.poseEase);
  assert.equal(arm[0].duration, ACTING.poseTween);
  const at = t => frameState(ops, t);
  assert.ok(Math.abs(at(2 + ACTING.poseTween).get('c-arm-r').rotation - 148) < 1e-6, 'settles on the wave');
  assert.ok(Math.abs(at(4.5).get('c-fore-r').rotation - 26) < 1e-6, 'the wave loop ends on the pose before the next change');
  assert.ok(Math.abs(at(3.05).get('c-fore-r').rotation - 26) > 1, 'and moves while it holds');
  assert.equal(at(0.6).get('c-open-neutral').opacity, 1, 'mouth open on a word');
  assert.equal(at(0.79).get('c-open-neutral').opacity, 0, 'closed before the word ends');
  assert.equal(at(1.6).get('c-mouth-neutral').opacity, 1);
  assert.equal(at(3).get('c-face-happy').opacity, 1);
  assert.equal(at(3).get('c-face-neutral').opacity, 0);
  assert.ok(ops.some(op => op.target === 'c-eyes-happy' && op.to?.scaleY < 0.2), 'blinks');
  assert.ok(ops.some(op => op.target === 'c-breath'), 'breathes');
  const long = speechChanges([{from: 0, to: 1, words: [[0, 0.6]]}]);
  assert.equal(long.filter(change => change.open).length, 2, 'a long word gets two flaps');
  assert.ok(speechChanges([{from: 0, to: 1}]).length >= 8, 'a range without word timings flaps on a rhythm');
  assert.deepEqual(Object.keys(jointTargets('c', poseJoints('stand'))).length, 14);
});

test('story cast: starters by id, overrides, custom characters, and clear errors', () => {
  const story = {brand, cast: {colors: {primary: 'forest'}, characters: [{id: 'maya', voice: 'af_bella'}, {id: 'sam', from: 'theo', hair: {style: 'curly'}}, {id: 'riley', skin: 'deep', hair: {style: 'locs', color: 'black'}, build: 'athletic'}]}};
  const cast = resolveStoryCast(story);
  assert.deepEqual([...cast.members.keys()], ['maya', 'sam', 'riley']);
  assert.equal(cast.members.get('maya').voice, 'af_bella');
  assert.equal(cast.members.get('sam').params.hair.style, 'curly');
  assert.equal(cast.members.get('sam').params.hair.color, 'brown', 'the starter hair colour is kept');
  assert.equal(cast.members.get('maya').colors.top, '#2f5b47', 'the cast colour mapping');
  assert.throws(() => castMember(cast, 'theo'), /not in the story cast/);
  assert.equal(castMember(resolveStoryCast({brand}), 'theo').starter, true, 'without a cast, starters are allowed');
  assert.match(storyCastErrors({characters: [{id: 'maya'}, {id: 'maya'}]}).join(), /listed twice/);
  assert.match(storyCastErrors({characters: [{id: 'nobody'}]}).join(), /needs its own skin and hair/);
  assert.match(storyCastErrors({characters: [{id: 'x', from: 'zed'}]}).join(), /not a starter/);
  assert.match(storyCastErrors({style: 'oil', characters: []}).join(), /cast\.style/);
  assert.match(storyCastErrors({colors: {primary: 'primary'}, characters: []}).join(), /palette colour or six-digit hex/);
});

test('narrative map cues: validation names every bad part; resolution cues to words', () => {
  const cast = {characters: [{id: 'maya'}, {id: 'theo'}]};
  const line = {words: [3, 6], intent: 'problem', treatment: 'dress', scenes: ['desk-fail'], set: 'desk-laptop', cast: [{id: 'maya', pose: 'slump', expression: 'frustrated', at: 'word:again'}]};
  assert.deepEqual(validateCastCues(line, cast), []);
  const bad = {...line, set: 'kitchen', cast: [{id: 'zoe', pose: 'dance', expression: 'smug', at: 'word: x'}, {id: 'theo', pose: 'walk'}, {id: 'maya'}]};
  const errors = validateCastCues(bad, cast).join('\n');
  for (const part of ['set "kitchen"', '"zoe" is not in the story cast', 'pose "dance"', 'expression "smug"', '.at must be', 'needs a pose or an expression']) assert.ok(errors.includes(part), part);
  assert.match(validateCastCues({set: 'desk-laptop', cast: [{id: 'theo', pose: 'walk'}]}, cast).join(), /walk does not fit/);
  const words = ['It', 'broke', 'down', 'again', 'and', 'again', 'today'].map((text, i) => ({text, start: i * 0.5, end: i * 0.5 + 0.4}));
  assert.equal(cueWordIndex('word:again', line, words), 3);
  assert.equal(cueWordIndex('word:again#2', line, words), 5);
  assert.equal(cueWordIndex('end', line, words), 6);
  assert.throws(() => cueWordIndex('word:never', line, words), /no narration word/);
  assert.deepEqual(resolveCastCues(line, {words}), [{id: 'maya', pose: 'slump', expression: 'frustrated', time: 1.5, word: 3}]);
  const map = {sections: [{id: 's1', lines: [line, {words: [0, 2], scenes: ['other'], cast: [{id: 'theo', pose: 'wave'}]}]}]};
  assert.deepEqual(sceneCastCues(map, 'desk-fail', {words, start: 1}), {set: 'desk-laptop', cues: {maya: [{at: 0.5, pose: 'slump', expression: 'frustrated'}]}});
});

test('consistency: a character drawn from other params or colours is flagged', () => {
  const story = {brand, cast: {characters: [{id: 'maya'}]}};
  const look = castMember(resolveStoryCast(story), 'maya').look;
  const model = (sceneId, actorLook) => ({sceneId, content: {actors: [{id: 'maya', look: actorLook}]}});
  assert.deepEqual(castConsistency(story, [model('a', look), model('b', look)]), []);
  const drifted = look.replace('"curly"', '"afro"');
  const findings = castConsistency(story, [model('a', look), model('b', drifted)]);
  assert.equal(findings.length, 2);
  assert.match(findings[1].detail, /looks different in b than in a/);
  assert.match(castConsistency({cast: {characters: [{id: 'nobody'}]}}, [])[0].detail, /story cast/);
});

test('sets lay out every count in both orientations, inside the frame', () => {
  for (const set of SETS) {
    for (const canvas of [{width: 1920, height: 1080}, {width: 1080, height: 1920}]) {
      for (const count of [1, 2, 3]) {
        const layout = layoutSet(set, {canvas, colors: brand.colors, count, heights: Array(count).fill(1100), screen: set === 'screen' || set === 'meeting'});
        assert.equal(layout.slots.length, count);
        for (const slot of layout.slots) {
          assert.ok(slot.x > 0 && slot.x < canvas.width, `${set} ${count} x`);
          assert.ok(slot.floor - 1100 * slot.scale > 0, `${set} ${canvas.width}x${canvas.height} ${count}: head inside the frame`);
        }
        if (layout.screenRect) assert.ok(layout.screenRect.x >= 0 && layout.screenRect.x + layout.screenRect.width <= canvas.width);
      }
    }
  }
});
