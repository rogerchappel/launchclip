// Character kinds: what a character is when it is not a person. A person is
// the rig's default (no `kind` in its params, so every person keeps the
// params and fingerprint it always had). Any other kind is an animal, a
// mascot or an object with a face, with its own small parameter set:
//
//   {kind: "cat", size?: "small" | "medium" | "large",
//    colors?: {body?, detail?, accent?}}
//
//   animals  cat, dog, bear, rabbit, fox, frog, penguin, owl
//            (a small body, a big head with ears or a beak, a tail where it reads)
//   mascots  blob, droplet, star, monster
//            (one soft body in the brand's colours, stubby arms and legs)
//   objects  phone, laptop, cup, bulb, robot, coin, book, cloud
//            (an everyday thing with a face, thin arms and legs)
//
// Every kind has the rig's joints and part ids (toon.mjs), so the same poses,
// expressions, gaze, speech and op list act it (kind-draw.mjs draws it). The
// measurements below are rig geometry in the shape every style reports
// (rig.mjs rigGeometry), so sets, framing and aiming place a kind as they
// place a person. Params that belong to a person (hair, outfit, skin, age…)
// are refused by name: a coffee cup has no hair.
//
// Imports only sibling kit/core files.

import {mixColor} from '../catalog-b-base.mjs';
import {OUTLINE, isColorName, resolveColor} from './palette.mjs';

const K = (group, describe, colors, slots, dims) => Object.freeze({group, describe, colors: Object.freeze(colors), slots: Object.freeze(slots), dims: Object.freeze(dims)});

// Limbs. Stubby: short and chunky (animals, mascots). Thin: lines with
// round hands and small shoes (objects).
const STUBBY = {limbs: 'stubby', thigh: 62, shin: 58, foot: 34, legW: 72, upperArm: 92, foreArm: 82, armW: 56, hand: 34};
const SOFT = {limbs: 'stubby', thigh: 50, shin: 48, foot: 30, legW: 66, upperArm: 84, foreArm: 74, armW: 52, hand: 32};
const THIN = {limbs: 'thin', thigh: 80, shin: 76, foot: 16, legW: 17, upperArm: 112, foreArm: 100, armW: 17, hand: 31};

// A headed kind: a trunk (torso tall, shoulder and hip half-widths) with a
// head above it (half-widths rx, ry; its centre `up` above the trunk's top).
// faceK: the face's size over the toon face; top: what stands above the head
// (ears, an antenna).
const headed = (limbs, values) => ({plan: 'headed', ...limbs, torso: 186, shoulder: 90, hip: 100, rx: 200, ry: 184, up: 160, faceK: 2, top: 0, ...values});
// A single-body kind: one shape (half-width w, h tall above the hips) that
// carries the face (centre faceY above the hips, the face area's half-widths
// rx, ry). armY: the shoulders' height above the hips; armX, legX: their
// half-spacing. turn: how far the face moves across the body for a look.
const single = (limbs, values) => ({plan: 'single', ...limbs, faceK: 1.9, turn: 1, top: 0, ...values});

/** Every kind but a person: its group, a description, default colours, what each colour slot paints, and its measurements. */
export const KINDS = Object.freeze({
  // Animals
  cat: K('animal', 'an upright cat: pointed ears, whiskers, a curled tail', {body: '#8f93a8', detail: '#f6efe6', accent: '#f29aa8'}, {body: 'fur', detail: 'muzzle and belly', accent: 'inner ears and nose'}, headed(STUBBY, {ry: 176, top: 86})),
  dog: K('animal', 'an upright dog: floppy ears, a light muzzle, a short tail', {body: '#d39a5b', detail: '#f8ead3', accent: '#7b4b2c'}, {body: 'fur', detail: 'muzzle and belly', accent: 'ears and tail tip'}, headed(STUBBY, {rx: 192, top: 8})),
  bear: K('animal', 'an upright bear: round ears, a light muzzle, a round belly', {body: '#a06f48', detail: '#efd8b6', accent: '#5f3e29'}, {body: 'fur', detail: 'muzzle, belly and inner ears', accent: 'nose'}, headed(STUBBY, {rx: 204, ry: 188, shoulder: 100, hip: 112, top: 42})),
  rabbit: K('animal', 'an upright rabbit: long ears, a round tail', {body: '#f4efe8', detail: '#ffffff', accent: '#f3a6b4'}, {body: 'fur', detail: 'muzzle, belly and tail', accent: 'inner ears and nose'}, headed(STUBBY, {rx: 186, ry: 176, top: 196})),
  fox: K('animal', 'an upright fox: big pointed ears, white cheeks, a bushy tail', {body: '#e87a30', detail: '#fcf4e8', accent: '#40302b'}, {body: 'fur', detail: 'cheeks, belly and tail tip', accent: 'ear tips, paws and nose'}, headed(STUBBY, {rx: 204, ry: 172, top: 110})),
  frog: K('animal', 'an upright frog: a wide head, eyes on top, a pale belly', {body: '#6fbf5c', detail: '#dcf2bd', accent: '#f08a9b'}, {body: 'skin', detail: 'belly and throat', accent: 'cheeks'}, headed(STUBBY, {rx: 214, ry: 160, up: 138, top: 34})),
  penguin: K('animal', 'a penguin: a dark coat, a white face and belly, an orange beak and feet', {body: '#323746', detail: '#fbf9f4', accent: '#f2a03d'}, {body: 'coat', detail: 'face and belly', accent: 'beak and feet'}, headed(STUBBY, {thigh: 34, shin: 34, legW: 64, torso: 232, upperArm: 100, rx: 186, ry: 172, up: 132, shoulder: 132, hip: 146, top: 0})),
  owl: K('animal', 'an owl: ear tufts, big eye discs, a small beak, wings for arms', {body: '#9d6e4d', detail: '#f3e1c5', accent: '#f2a03d'}, {body: 'feathers', detail: 'eye discs and belly', accent: 'beak and feet'}, headed(STUBBY, {thigh: 40, shin: 38, legW: 62, torso: 216, rx: 206, ry: 176, up: 140, shoulder: 122, hip: 134, top: 16})),
  // Mascots (brand colours)
  blob: K('mascot', 'a round blob with a sprout on top', {body: 'primary', detail: 'paper', accent: 'accent'}, {body: 'the blob', detail: 'its shine', accent: 'the sprout'}, single(SOFT, {w: 232, h: 440, faceK: 2.2, turn: 0.75, faceY: 226, rx: 212, area: 200, ry: 150, armY: 196, armX: 214, legX: 96, top: 62})),
  droplet: K('mascot', 'a droplet: round below, a point on top', {body: 'primary', detail: 'paper', accent: 'accent'}, {body: 'the drop', detail: 'its shine', accent: 'its cheeks'}, single(SOFT, {w: 216, h: 560, faceK: 2.1, turn: 0.7, faceY: 204, rx: 196, area: 186, ry: 150, armY: 190, armX: 204, legX: 92})),
  star: K('mascot', 'a soft five-pointed star', {body: 'accent', detail: 'paper', accent: 'primary'}, {body: 'the star', detail: 'its shine', accent: 'its cheeks'}, single(SOFT, {w: 270, h: 470, faceY: 198, rx: 130, ry: 124, faceK: 1.75, turn: 0.5, armY: 264, armX: 220, legX: 140})),
  monster: K('mascot', 'a little monster: two horns, a pale belly, spots', {body: 'primary', detail: 'paper', accent: 'accent'}, {body: 'fur', detail: 'belly', accent: 'horns and spots'}, single(SOFT, {w: 214, h: 500, faceK: 2.1, turn: 0.7, faceY: 284, rx: 196, area: 186, ry: 140, armY: 230, armX: 204, legX: 100, top: 64})),
  // Objects with faces
  phone: K('object', 'a phone: the face on its screen', {body: 'charcoal', detail: 'paper', accent: 'primary'}, {body: 'the case', detail: 'the screen', accent: 'the side button and shoes'}, single(THIN, {w: 152, h: 520, faceY: 278, rx: 122, area: 112, ry: 150, faceK: 1.6, turn: 0.35, armY: 270, armX: 150, legX: 74})),
  laptop: K('object', 'an open laptop: the face on its screen', {body: '#b9c0cb', detail: 'paper', accent: 'primary'}, {body: 'the shell', detail: 'the screen', accent: 'the light and shoes'}, single(THIN, {w: 236, h: 480, faceY: 290, rx: 190, ry: 138, faceK: 2.1, turn: 0.7, armY: 190, armX: 222, legX: 108})),
  cup: K('object', 'a takeaway coffee cup with a lid', {body: 'white', detail: '#7a5238', accent: 'primary'}, {body: 'the cup', detail: 'the lid', accent: 'the band and shoes'}, single(THIN, {w: 190, h: 500, faceY: 264, rx: 156, ry: 130, faceK: 1.95, turn: 0.55, armY: 232, armX: 158, legX: 82})),
  bulb: K('object', 'a light bulb: the face on the glass', {body: '#ffe58a', detail: '#aab2bc', accent: '#f2a03d'}, {body: 'the glass', detail: 'the screw base', accent: 'the rays and shoes'}, single(THIN, {faceK: 2.1, w: 214, h: 560, faceY: 346, rx: 190, ry: 150, armY: 300, armX: 204, legX: 54, top: 66})),
  robot: K('object', 'a small robot: a square head, an antenna, a chest light', {body: '#b9c2cc', detail: '#eef4fb', accent: 'primary'}, {body: 'the shell', detail: 'the face plate and joints', accent: 'the lights and shoes'}, headed(THIN, {torso: 210, shoulder: 116, hip: 116, rx: 180, ry: 140, up: 150, area: 150, faceK: 1.8, top: 78, upperArm: 104, foreArm: 92})),
  coin: K('object', 'a gold coin', {body: '#f4c24f', detail: '#ffe392', accent: '#c98a1e'}, {body: 'the rim', detail: 'the face of the coin', accent: 'the edge marks and shoes'}, single(THIN, {faceK: 1.9, turn: 0.5, area: 168, w: 226, h: 452, faceY: 208, rx: 176, ry: 150, armY: 204, armX: 220, legX: 88})),
  book: K('object', 'a closed book standing up, with a ribbon', {body: 'primary', detail: 'cream', accent: 'accent'}, {body: 'the cover', detail: 'the pages and label', accent: 'the ribbon and shoes'}, single(THIN, {w: 196, h: 520, faceY: 292, rx: 140, area: 132, ry: 140, faceK: 1.7, turn: 0.45, armY: 250, armX: 190, legX: 90})),
  cloud: K('object', 'a puffy cloud', {body: '#fbfcff', detail: '#dde7f5', accent: 'sky'}, {body: 'the cloud', detail: 'its shade', accent: 'the shoes'}, single(THIN, {faceK: 2.1, turn: 0.75, w: 280, h: 380, faceY: 148, rx: 205, area: 190, ry: 140, armY: 64, armX: 262, legX: 98}))
});

export const KIND_NAMES = Object.freeze(Object.keys(KINDS));
export const KIND_GROUPS = Object.freeze(['animal', 'mascot', 'object']);
/** The kind names of one group (animal, mascot, object). */
export const kindsOf = group => KIND_NAMES.filter(name => KINDS[name].group === group);
export const KIND_SIZES = Object.freeze(['small', 'medium', 'large']);
export const KIND_SIZE_SCALE = Object.freeze({small: 0.84, medium: 1, large: 1.14});
export const KIND_COLOR_SLOTS = Object.freeze(['body', 'detail', 'accent']);
const KIND_KEYS = ['kind', 'size', 'colors'];

/** True for params (raw or normalised) of a kind other than a person. */
export const isKind = params => Boolean(params) && typeof params === 'object' && params.kind !== undefined && params.kind !== null && params.kind !== 'person';

/** "a cat", "an owl": a kind in a sentence. */
export const kindPhrase = name => `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;

function fail(path, message) {
  throw new Error(`${path} ${message}`);
}

/**
 * Validate and normalise the params of a kind. → {kind, size?, colors: {body,
 * detail, accent}} with keys in a fixed order (size only when not medium).
 * A person's params (hair, outfit, skin…) are refused by name.
 */
export function normalizeKindParams(params, path = 'character') {
  const kind = params.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind)) fail(`${path}.kind`, `must be person or one of ${KIND_NAMES.join(', ')}; got ${JSON.stringify(kind)}`);
  const takes = `${kindPhrase(kind)} takes kind, size and colors {${KIND_COLOR_SLOTS.join(', ')}}`;
  for (const key of Object.keys(params)) if (!KIND_KEYS.includes(key)) fail(`${path}.${key}`, `does not apply to ${kindPhrase(kind)} (${takes})`);
  const size = params.size ?? 'medium';
  if (!KIND_SIZES.includes(size)) fail(`${path}.size`, `must be one of ${KIND_SIZES.join(', ')}; got ${JSON.stringify(size)}`);
  const given = params.colors ?? {};
  if (!given || typeof given !== 'object' || Array.isArray(given)) fail(`${path}.colors`, 'must be an object');
  for (const key of Object.keys(given)) if (!KIND_COLOR_SLOTS.includes(key)) fail(`${path}.colors.${key}`, `is not a colour slot of ${kindPhrase(kind)} (allowed: ${KIND_COLOR_SLOTS.join(', ')})`);
  const colors = {};
  for (const slot of KIND_COLOR_SLOTS) {
    colors[slot] = given[slot] ?? KINDS[kind].colors[slot];
    if (!isColorName(colors[slot])) fail(`${path}.colors.${slot}`, `must be a palette colour, brand role or six-digit hex; got ${JSON.stringify(colors[slot])}`);
  }
  return {kind, ...(size !== 'medium' ? {size} : {}), colors};
}

const shade = (hex, amount = 0.18) => mixColor(OUTLINE, hex, amount);
const light = (hex, amount = 0.22) => mixColor('#ffffff', hex, amount);

/**
 * Every colour a kind's drawing uses, from its three slots: the slots, their
 * shades, and the face's colours (the same mouth, tongue and teeth as a
 * person's; a blush for a face on the body and one for a face on the detail).
 */
export function kindColors(colors, roles) {
  const out = {};
  for (const slot of KIND_COLOR_SLOTS) out[slot] = resolveColor(colors[slot], roles, `colors.${slot}`);
  return {
    ...out,
    outline: OUTLINE,
    bodyShade: shade(out.body, 0.2),
    bodyLight: light(out.body, 0.3),
    detailShade: shade(out.detail, 0.16),
    accentShade: shade(out.accent, 0.2),
    accentLight: light(out.accent, 0.25),
    blush: mixColor('#e5575f', out.body, 0.34),
    blushDetail: mixColor('#e5575f', out.detail, 0.34),
    inkLight: '#fbf7ef',
    mouth: mixColor(OUTLINE, '#7a2b33', 0.55),
    tongue: '#e0787a',
    teeth: '#fbf8f2',
    eyeWhite: '#fbf9f5'
  };
}

// Raised and face-touching arms restated for a big head on a small body (as the chibi style does).
const HEADED_POSES = Object.freeze({
  wave: {armA: 96, foreA: 58},
  cheer: {armL: 102, foreL: 52, armR: 102, foreR: 52},
  stretch: {armL: 110, foreL: 44, armR: 110, foreR: 44},
  look: {armA: 104, foreA: 96},
  think: {armA: 70, foreA: 118, armO: 10, foreO: -70},
  facepalm: {armA: 86, foreA: 128}
});
// A single body's arms sit at its sides and are shorter than it is wide, so
// a pose that puts a hand on the face or folds the arms does the nearest
// thing they reach: think and look touch the hand to the body's edge beside
// the face, facepalm covers the near eye's side, arms-crossed and
// hands-on-hips rest both hands on the front, point-self points at the body.
const SINGLE_POSES = Object.freeze({
  wave: {armA: 128, foreA: 22},
  cheer: {armL: 138, foreL: 16, armR: 138, foreR: 16},
  stretch: {armL: 152, foreL: 8, armR: 152, foreR: 8},
  look: {armA: 132, foreA: 118},
  think: {armA: 96, foreA: 146, armO: 10, foreO: -64},
  facepalm: {armA: 112, foreA: 152},
  'arms-crossed': {armL: 22, foreL: -112, armR: 22, foreR: -106},
  'hands-on-hips': {armL: 38, foreL: -96, armR: 38, foreR: -96},
  'point-self': {armA: 58, foreA: -150},
  shrug: {armL: 34, foreL: 78, armR: 34, foreR: 78}
});
// Thin legs come forward and apart when seated (as a stick figure's do).
const THIN_SIT = Object.freeze({legL: 22, shinL: -10, legR: 22, shinR: -10});

const scaled = (dims, s) => Object.fromEntries(Object.entries(dims).map(([key, value]) => [key, typeof value === 'number' && !['faceK', 'turn'].includes(key) ? Math.round(value * s * 10) / 10 : value]));

/** A kind's measurements at its size, in rig units (KINDS[kind].dims scaled). */
export function kindDims(params) {
  const spec = KINDS[params.kind];
  if (!spec) throw new Error(`unknown character kind ${JSON.stringify(params.kind)} (kinds: ${KIND_NAMES.join(', ')})`);
  const s = KIND_SIZE_SCALE[params.size ?? 'medium'];
  return {...scaled(spec.dims, s), faceK: spec.dims.faceK * s, s};
}

/**
 * Rig geometry for a kind, in the shape rigGeometry returns: the legs, the
 * hips, where the shoulders and the head sit, the head's half-widths and the
 * seat drop, so poses, sets, framing and aiming treat it as they do a
 * person. A single body's "head" is its face area.
 */
export function kindGeometry(params) {
  const d = kindDims(params);
  const hipY = -(d.thigh + d.shin + d.foot);
  const limbs = {foot: d.foot, thigh: d.thigh, shin: d.shin, hipY, armW: d.armW, legW: d.legW, upperArm: d.upperArm, foreArm: d.foreArm, hand: d.hand, sitDrop: Math.round(d.thigh * 0.78), ...(d.limbs === 'thin' ? {sitLegs: THIN_SIT} : {})};
  if (d.plan === 'headed') {
    return {...limbs, torso: d.torso, neck: 0, shoulderY: -d.torso, shoulder: d.shoulder, waist: d.hip, hip: d.hip,
      armX: d.shoulder - d.armW * 0.42, armY: -d.torso + Math.max(d.armW * 0.55, 18 * d.s), legX: d.hip - Math.max(d.legW, 44 * d.s) * 0.5 - (d.limbs === 'thin' ? 22 * d.s : 0),
      neckY: -d.torso, head: {rx: d.rx, ry: d.ry, cy: -d.up}, poses: HEADED_POSES,
      height: -hipY + d.torso + d.up + d.ry};
  }
  const torso = d.faceY - d.ry;
  return {...limbs, torso, neck: 0, shoulderY: -d.armY, shoulder: d.w, waist: d.w, hip: d.w,
    armX: d.armX, armY: -d.armY, legX: d.legX,
    neckY: -torso, head: {rx: d.rx, ry: d.ry, cy: -d.ry}, poses: SINGLE_POSES,
    height: -hipY + d.h};
}

/** Drawn height above the feet in rig units, with ears, horns or an antenna. */
export function kindHeight(params) {
  return Math.round(kindGeometry(params).height + kindDims(params).top);
}

// How a set sizes a kind (styles.mjs stageHeight). A set sizes its cast by
// its tallest member and gives each a slot a person fits: a person about
// KIND_STAGE.height tall reaches about KIND_STAGE.reach to each side. So a
// kind counts as no shorter than a person (a cat is never blown up to a
// person's height) and as taller the wider it reaches (an open laptop is
// twice as wide as a person, so the set stands further back for it).
export const KIND_STAGE = Object.freeze({height: 1000, reach: 196});
