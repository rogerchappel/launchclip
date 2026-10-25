// Drawing styles (kit/core/characters/styles.mjs): every style draws the same
// rig, poses, expressions and acting; the key light; flat stays as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EXPRESSIONS, POSES, poseJoints, rigGeometry} from '../kit/core/characters/rig.mjs';
import {STARTER_CAST, characterLook, starterCharacter} from '../kit/core/characters/cast.mjs';
import {drawFlat} from '../kit/core/characters/style-flat.mjs';
import {DRAWING_STYLES, drawCharacter, styleGeometry, styleHeight} from '../kit/core/characters/styles.mjs';
import {DEFAULT_LIGHT, lightErrors, normalizeLight} from '../kit/core/characters/light.mjs';
import {resolveModule} from '../kit/core/modules.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

// Every starter character in every pose, both facings, static and animated,
// with every expression's face: the flat drawing as it shipped. A change to
// this hash changes how flat casts look in existing videos.
const FLAT_SNAPSHOT = '0bf60bd3effcc7b0';

test('flat draws exactly as it did before the drawing styles', () => {
  const trees = [];
  // The 24 characters that shipped with flat.
  for (const entry of STARTER_CAST.slice(0, 24)) {
    const {params} = starterCharacter(entry.id);
    const {colors} = characterLook(params, {});
    const geometry = rigGeometry(params);
    for (const pose of POSES) for (const facing of ['left', 'right']) for (const isStatic of [true, false]) {
      const joints = poseJoints(pose, {facing, seated: pose === 'sit', geometry});
      trees.push(drawFlat(params, colors, {id: 'x', joints, expression: 'happy', expressions: EXPRESSIONS, static: isStatic}));
    }
  }
  assert.equal(sha(trees), FLAT_SNAPSHOT);
});

test('drawCharacter: flat through the registry is drawFlat; unknown styles are named', () => {
  const {params} = starterCharacter('maya');
  const {colors} = characterLook(params, {});
  const joints = poseJoints('wave', {geometry: rigGeometry(params)});
  const options = {id: 'm', joints, expression: 'happy', expressions: ['happy']};
  assert.deepEqual(drawCharacter('flat', params, colors, options), drawFlat(params, colors, options));
  assert.equal(DRAWING_STYLES[0], 'flat');
  assert.throws(() => drawCharacter('oil-paint', params, colors, options), /unknown drawing style "oil-paint" \(styles: flat/);
  for (const style of DRAWING_STYLES) {
    assert.ok(styleHeight(style, params) > 800, `${style} height`);
    assert.ok(styleGeometry(style, params).sitDrop > 0, `${style} geometry`);
  }
});

test('light: defaults, validation and the direction vector', () => {
  const light = normalizeLight();
  assert.equal(light.dir, DEFAULT_LIGHT.dir);
  assert.ok(light.x < 0 && light.y < 0, 'the default key sits high on the left (y down)');
  assert.deepEqual(normalizeLight({dir: 0, color: '#FFFFFF', intensity: 1}), {dir: 0, color: '#ffffff', intensity: 1, x: 1, y: -0});
  assert.equal(normalizeLight({dir: -90}).dir, 270, 'from below');
  assert.deepEqual(lightErrors({dir: 'left', color: 'white', intensity: 2, glow: 1}), [
    'light.glow is not supported (allowed: dir, color, intensity)',
    'light.dir must be degrees (0 = from the right, 90 = from above, 180 = from the left) or a vector {x, y} from the light toward the subject',
    'light.color must be a six-digit hex',
    'light.intensity must be 0 to 1'
  ]);
  assert.throws(() => normalizeLight([]), /light must be/);
});

test('cast-scene and character-cameo take a light, and reject a bad one', () => {
  const story = {format: {width: 1920, height: 1080, fps: 30, duration: 4}, brand: {colors: {bg: '#06070d', primary: '#fdb022', accent: '#46d4ff', ink: '#06070d', paper: '#f2eee6'}}};
  const scene = params => ({id: 's', module: 'cast-scene', start: 0, end: 4, params: {set: 'phone', cast: [{id: 'maya'}], ...params}});
  const model = resolveModule(scene({light: {dir: 30, intensity: 0.8}}), story);
  assert.equal(model.content.actors[0].light.dir, 30);
  assert.equal(resolveModule(scene({}), story).content.actors[0].light.dir, DEFAULT_LIGHT.dir);
  assert.throws(() => resolveModule(scene({light: {dir: 30, bright: true}}), story), /params\.light.*bright is not supported/);
  const cameo = resolveModule({id: 'c', module: 'character-cameo', start: 0, end: 4, params: {character: 'theo', light: {color: '#a0c0ff'}}}, story);
  assert.equal(cameo.content.actors[0].light.color, '#a0c0ff');
});

test('light: a world\'s vector dir (light toward subject, y down) becomes degrees', () => {
  const sun = normalizeLight({dir: {x: 0.55, y: 0.83}, color: '#fff4e0', intensity: 0.9});
  assert.ok(sun.dir > 120 && sun.dir < 127, `upper-left sun: ${sun.dir}`);
  assert.ok(sun.x < 0 && sun.y < 0, 'toward the light is up and left');
  assert.equal(normalizeLight({dir: {x: -1, y: 0}}).dir, 0, 'light from the right');
  assert.deepEqual(lightErrors({dir: {x: 0, y: 0}}).length, 1);
});

test('cast-styles: a sheet for every style builds from the same cast', async () => {
  const {sheetCast, styleSheetHtml} = await import('../scripts/cast-styles.mjs');
  const cast = sheetCast({seed: 'abc', set: 'family'});
  assert.equal(cast.length, 8);
  for (const style of DRAWING_STYLES) {
    const html = styleSheetHtml(style, cast, {sets: ['phone', 'video-call']});
    assert.match(html, new RegExp(`Drawing style: ${style}`));
    assert.ok(!/undefined|NaN/.test(html), `${style} sheet draws cleanly`);
  }
});
