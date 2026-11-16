import test from 'node:test';
import assert from 'node:assert/strict';
import {FLAWS, normalizeRigParams, poseJoints, rigFingerprint} from '@launchclip/core/characters/rig.mjs';
import {characterLook} from '@launchclip/core/characters/cast.mjs';
import {DRAWING_STYLES, drawCharacter, styleGeometry} from '@launchclip/core/characters/styles.mjs';
import {resolveStoryCast} from '@launchclip/core/characters/cues.mjs';
import {applyCharacterSets} from '@launchclip/core/characters/character.mjs';

const PERSON = {build: 'average', skin: 'tan', hair: {style: 'short', color: 'black'}};

const draw = (style, params) => {
  const {colors} = characterLook(params, {style});
  return JSON.stringify(drawCharacter(style, params, colors, {id: 'c', joints: poseJoints('stand', {geometry: styleGeometry(style, params)}), expression: 'neutral', expressions: ['neutral'], static: true}));
};

test('a flaw is a rig param: checked, stored only when set, part of the fingerprint', () => {
  const plain = normalizeRigParams(PERSON);
  assert.equal(plain.flaw, undefined, 'a character made before flaws keeps its params');
  const flawed = normalizeRigParams({...PERSON, flaw: 'brow-scar'});
  assert.equal(flawed.flaw, 'brow-scar');
  assert.notEqual(rigFingerprint(flawed), rigFingerprint(plain));
  assert.throws(() => normalizeRigParams({...PERSON, flaw: 'missing-leg'}), /flaw must be one of/);
  assert.equal(normalizeRigParams({kind: 'cup', flaw: 'cheek-plaster'}).flaw, 'cheek-plaster');
  assert.throws(() => normalizeRigParams({kind: 'cat', flaw: 'dent'}), /flaw must be one of/);
  // A story cast entry and a set path take it too.
  assert.equal(resolveStoryCast({cast: {style: 'flat', characters: [{id: 'sam', flaw: 'cheek-scratch'}]}}).members.get('sam').params.flaw, 'cheek-scratch');
  assert.equal(applyCharacterSets({params: {}}, [{path: 'flaw', value: 'brow-scar'}]).params.flaw, 'brow-scar');
});

test('the rig draws every flaw, on a person and on a kind, in every drawing style', () => {
  for (const base of [PERSON, {kind: 'cat'}, {kind: 'cup'}]) {
    const without = normalizeRigParams(base);
    for (const style of DRAWING_STYLES) {
      const plain = draw(style, without);
      for (const flaw of FLAWS) assert.notEqual(draw(style, normalizeRigParams({...base, flaw})), plain, `${base.kind ?? 'person'} ${style} ${flaw}`);
    }
  }
});
