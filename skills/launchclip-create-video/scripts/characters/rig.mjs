// The character rig: one parametric 2D body for every character
// (docs/VIDEO_QUALITY_RFC.md §10.5). A character is a set of rig params
// (build, height, skin, hair, outfit, accessories, colours); named poses
// drive its joint angles and named expressions its face. Poses and
// expressions are the only way to direct a character, so every shot of it is
// drawn from the same params and cannot drift.
//
// Coordinates are rig units: the feet stand on y = 0, x = 0 is the body's
// centre line and y grows downward (SVG). An average adult is about 1000
// units tall. Joint angles are degrees; for arms and legs a positive angle
// swings the limb away from the body on its own side (the drawing mirrors
// the sign for the right side), so one pose table serves both sides.
// "Left" and "right" are screen sides.
//
// Imports only sibling kit/core files.

import {COLOR_SLOTS, isColorName} from './palette.mjs';

export const BUILDS = Object.freeze(['slim', 'average', 'athletic', 'broad', 'round']);
export const HEIGHTS = Object.freeze(['short', 'average', 'tall']);
export const HAIR_STYLES = Object.freeze(['bald', 'buzz', 'short', 'sidepart', 'curly', 'afro', 'pixie', 'bob', 'wavy', 'long', 'ponytail', 'bun', 'braids', 'locs', 'headscarf']);
export const TOPS = Object.freeze(['tee', 'shirt', 'hoodie', 'blazer', 'sweater', 'dress']);
export const BOTTOMS = Object.freeze(['trousers', 'skirt']);
export const ACCESSORIES = Object.freeze(['glasses', 'round-glasses', 'beard', 'stubble', 'moustache', 'earrings', 'hearing-aid', 'freckles', 'lanyard']);

export const POSES = Object.freeze(['stand', 'point', 'wave', 'slump', 'type', 'think', 'cheer', 'shrug', 'walk', 'sit']);
export const EXPRESSIONS = Object.freeze(['neutral', 'happy', 'delighted', 'frustrated', 'confused', 'surprised', 'focused']);

const PARAM_KEYS = ['build', 'height', 'skin', 'hair', 'outfit', 'accessories', 'colors'];

// ---------------------------------------------------------------------------
// Params

function fail(path, message) {
  throw new Error(`${path} ${message}`);
}
const oneOf = (value, path, options) => (options.includes(value) ? value : fail(path, `must be one of ${options.join(', ')}; got ${JSON.stringify(value)}`));
const isObj = value => value && typeof value === 'object' && !Array.isArray(value);

/**
 * Validate and normalise rig params. → a new object with every field present
 * and keys in a fixed order, so two equal characters serialise identically.
 *
 *   build        slim | average | athletic | broad | round
 *   height       short | average | tall (default average)
 *   skin         a SKIN_TONES name or hex (the skin colour slot)
 *   hair         {style, color}
 *   outfit       {top, bottom}; colours come from colors.top / bottom / shoes
 *   accessories  ACCESSORIES names (default none)
 *   colors       {top, bottom, shoes, accent?} palette names, brand roles or hex
 */
export function normalizeRigParams(params, path = 'character') {
  if (!isObj(params)) fail(path, 'must be an object');
  for (const key of Object.keys(params)) if (!PARAM_KEYS.includes(key)) fail(`${path}.${key}`, `is not a rig param (allowed: ${PARAM_KEYS.join(', ')})`);
  const build = oneOf(params.build ?? 'average', `${path}.build`, BUILDS);
  const height = oneOf(params.height ?? 'average', `${path}.height`, HEIGHTS);
  if (!isColorName(params.skin)) fail(`${path}.skin`, 'must be a skin tone name or a six-digit hex');
  if (!isObj(params.hair)) fail(`${path}.hair`, 'must be {style, color}');
  for (const key of Object.keys(params.hair)) if (!['style', 'color'].includes(key)) fail(`${path}.hair.${key}`, 'is not supported (allowed: style, color)');
  const hairStyle = oneOf(params.hair.style, `${path}.hair.style`, HAIR_STYLES);
  const hairColor = params.hair.color ?? 'black';
  if (!isColorName(hairColor)) fail(`${path}.hair.color`, 'must be a hair colour name, brand role or six-digit hex');
  const outfitIn = params.outfit ?? {};
  if (!isObj(outfitIn)) fail(`${path}.outfit`, 'must be {top, bottom}');
  for (const key of Object.keys(outfitIn)) if (!['top', 'bottom'].includes(key)) fail(`${path}.outfit.${key}`, 'is not supported (allowed: top, bottom)');
  const top = oneOf(outfitIn.top ?? 'tee', `${path}.outfit.top`, TOPS);
  const bottom = oneOf(outfitIn.bottom ?? (top === 'dress' ? 'skirt' : 'trousers'), `${path}.outfit.bottom`, BOTTOMS);
  const accessoriesIn = params.accessories ?? [];
  if (!Array.isArray(accessoriesIn)) fail(`${path}.accessories`, 'must be an array');
  const accessories = [...new Set(accessoriesIn.map((name, i) => oneOf(name, `${path}.accessories[${i}]`, ACCESSORIES)))].sort();
  if (accessories.includes('glasses') && accessories.includes('round-glasses')) fail(`${path}.accessories`, 'can have one pair of glasses');
  if (hairStyle === 'headscarf' && (accessories.includes('earrings') || accessories.includes('hearing-aid'))) fail(`${path}.accessories`, 'earrings and hearing aids sit under a headscarf; leave them out');
  const colorsIn = params.colors ?? {};
  if (!isObj(colorsIn)) fail(`${path}.colors`, 'must be an object');
  for (const key of Object.keys(colorsIn)) if (!['top', 'bottom', 'shoes', 'accent'].includes(key)) fail(`${path}.colors.${key}`, 'is not a colour slot (allowed: top, bottom, shoes, accent; skin and hair have their own fields)');
  const colors = {skin: params.skin, hair: hairColor, top: colorsIn.top ?? 'primary', bottom: colorsIn.bottom ?? 'charcoal', shoes: colorsIn.shoes ?? 'black', accent: colorsIn.accent ?? 'accent'};
  for (const slot of COLOR_SLOTS) if (!isColorName(colors[slot])) fail(`${path}.colors.${slot}`, `must be a palette colour, brand role or six-digit hex; got ${JSON.stringify(colors[slot])}`);
  return {build, height, skin: params.skin, hair: {style: hairStyle, color: hairColor}, outfit: {top, bottom}, accessories, colors};
}

/** Stable identity string of normalised params (and the drawing style). */
export function rigFingerprint(params, style = 'flat') {
  return JSON.stringify({style, ...params});
}

// ---------------------------------------------------------------------------
// Geometry

const BUILD_SHAPE = {
  slim: {shoulder: 80, waist: 60, hip: 64, arm: 40, leg: 52},
  average: {shoulder: 92, waist: 74, hip: 74, arm: 46, leg: 58},
  athletic: {shoulder: 106, waist: 72, hip: 74, arm: 52, leg: 62},
  broad: {shoulder: 114, waist: 92, hip: 86, arm: 54, leg: 66},
  round: {shoulder: 100, waist: 108, hip: 100, arm: 52, leg: 68}
};
const HEIGHT_SCALE = {short: 0.93, average: 1, tall: 1.07};

/**
 * Body measurements for rig params. Lengths scale with height; the head does
 * not, so tall and short characters read as the same family.
 */
export function rigGeometry(params) {
  const s = HEIGHT_SCALE[params.height];
  const b = BUILD_SHAPE[params.build];
  const foot = 26;
  const thigh = Math.round(180 * s), shin = Math.round(170 * s);
  const hipY = -(thigh + shin + foot);
  const torso = Math.round(268 * s);
  const neck = 30;
  const headR = 110;
  return {
    foot, thigh, shin, torso, neck,
    hipY,
    shoulderY: -torso, // in the torso's frame (pivot at the hip centre)
    shoulder: b.shoulder, waist: b.waist, hip: b.hip,
    armW: b.arm, legW: b.leg,
    upperArm: Math.round(150 * s), foreArm: Math.round(134 * s), hand: Math.round(b.arm * 0.58),
    // Shoulder joints sit inside the torso outline, legs inside the hips.
    armX: b.shoulder - b.arm * 0.42, armY: -torso + b.arm * 0.55,
    legX: b.hip - b.leg * 0.5,
    neckY: -torso - neck * 0.55,
    head: {rx: Math.round(headR * 0.9), ry: headR, cy: -headR * 0.92},
    // Seated: the hips drop by most of a thigh (the thighs point at the camera).
    sitDrop: Math.round(thigh * 0.78),
    height: -hipY + torso + neck + headR * 1.84
  };
}

// ---------------------------------------------------------------------------
// Poses
//
// Each pose: joint angles for the upper body (arm*, fore*: shoulder and
// elbow, l and r) and the lower body (leg*, shin*: hip and knee), head tilt,
// torso lean, small offsets (bodyY: the whole body, headY: the head drop,
// shoulderY: both shoulders), torso squash, which hand points, and an
// optional gesture: a loop of small tweens played while the pose holds.
// `side` poses use the character's facing side for the active arm: `a`
// keys are that arm, `o` the other.

const REST = {arm: 6, fore: 4, leg: 2, shin: 0};

export const POSE_TABLE = Object.freeze({
  stand: {lower: 'stand', upper: {armL: 6, foreL: 4, armR: 6, foreR: 4}},
  point: {lower: 'stand', side: true, upper: {armA: 92, foreA: 4, armO: 6, foreO: 4}, head: 5, lean: -2, finger: 'a'},
  wave: {lower: 'stand', side: true, upper: {armA: 148, foreA: 26, armO: 6, foreO: 4}, head: 4, gesture: {joint: 'foreA', amount: 34, period: 0.42}},
  slump: {lower: 'stand', upper: {armL: 2, foreL: 0, armR: 2, foreR: 0}, head: 7, headY: 16, shoulderY: 10, squash: 0.955, bodyY: 6},
  type: {lower: 'stand', upper: {armL: 18, foreL: -100, armR: 18, foreR: -100}, headY: 6, gesture: {joint: 'fore', amount: 5, period: 0.16, alternate: true}},
  think: {lower: 'stand', side: true, upper: {armA: 122, foreA: 128, armO: 10, foreO: -92}, head: 6, gesture: {joint: 'foreA', amount: 8, period: 0.3}},
  cheer: {lower: 'stand', upper: {armL: 154, foreL: 18, armR: 154, foreR: 18}, head: 0, bodyY: -6, gesture: {joint: 'bodyY', amount: -16, period: 0.36}},
  shrug: {lower: 'stand', upper: {armL: 16, foreL: 92, armR: 16, foreR: 92}, head: 9, shoulderY: -12},
  walk: {lower: 'walk', upper: {armL: 6, foreL: 8, armR: 6, foreR: 8}, gesture: {joint: 'walk', amount: 16, period: 0.6}},
  sit: {lower: 'sit', upper: {armL: 8, foreL: -36, armR: 8, foreR: -36}}
});

const LOWER = {
  stand: {legL: REST.leg, shinL: 0, legR: REST.leg, shinR: 0, legScale: 1, drop: 0},
  walk: {legL: 2, shinL: 0, legR: 2, shinR: 0, legScale: 1, drop: 0},
  sit: {legL: 10, shinL: -10, legR: 10, shinR: -10, legScale: 0.42, drop: 1}
};

/** The joints every pose sets, in a fixed order. */
export const JOINTS = Object.freeze(['armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR', 'head', 'lean', 'headY', 'shoulderY', 'squash', 'bodyY', 'legScale', 'fingerL', 'fingerR']);

/**
 * Joint values for a named pose. facing: 'left' | 'right' (which arm a side
 * pose uses). seated: force the seated lower body (desk and meeting sets).
 * → {armL, foreL, …, gesture: {joint: resolved joint name, …} | null}
 */
export function poseJoints(name, {facing = 'right', seated = false, geometry} = {}) {
  const pose = POSE_TABLE[name];
  if (!pose) throw new Error(`unknown pose ${JSON.stringify(name)} (poses: ${POSES.join(', ')})`);
  const a = facing === 'left' ? 'L' : 'R', o = a === 'L' ? 'R' : 'L';
  const upper = {};
  for (const [key, value] of Object.entries(pose.upper)) upper[key.replace(/A$/, a).replace(/O$/, o)] = value;
  const lowerName = seated ? 'sit' : pose.lower;
  const lower = LOWER[lowerName];
  const drop = lower.drop && geometry ? geometry.sitDrop : 0;
  const joints = {
    armL: upper.armL, foreL: upper.foreL, armR: upper.armR, foreR: upper.foreR,
    legL: lower.legL, shinL: lower.shinL, legR: lower.legR, shinR: lower.shinR,
    head: (pose.head ?? 0) * (pose.side && facing === 'left' ? -1 : 1), lean: (pose.lean ?? 0) * (facing === 'left' ? -1 : 1),
    headY: pose.headY ?? 0, shoulderY: pose.shoulderY ?? 0, squash: pose.squash ?? 1,
    bodyY: (pose.bodyY ?? 0) + drop, legScale: lower.legScale,
    fingerL: pose.finger === 'a' && a === 'L' ? 1 : 0, fingerR: pose.finger === 'a' && a === 'R' ? 1 : 0
  };
  let gesture = null;
  if (pose.gesture && !(seated && pose.gesture.joint === 'walk')) {
    const joint = pose.gesture.joint.replace(/A$/, a);
    gesture = {...pose.gesture, joint};
  }
  return {...joints, lower: lowerName, gesture};
}

// ---------------------------------------------------------------------------
// Expressions: the face parts each one draws (style-neutral descriptions;
// the drawing style turns them into shapes).
//
//   eyes   dot | wide | happy (closed arcs) | narrow (half lids) | squint
//   brows  [left, right]: {lift (units up), tilt (deg, + = inner end down)}
//   mouth  closed and open shapes: smile | grin | flat | frown | wavy | o | small

export const EXPRESSION_TABLE = Object.freeze({
  neutral: {eyes: 'dot', brows: [{lift: 0, tilt: 0}, {lift: 0, tilt: 0}], mouth: {closed: 'soft', open: 'small'}},
  happy: {eyes: 'dot', brows: [{lift: 5, tilt: -4}, {lift: 5, tilt: -4}], mouth: {closed: 'smile', open: 'grin'}, blush: true},
  delighted: {eyes: 'happy', brows: [{lift: 12, tilt: -8}, {lift: 12, tilt: -8}], mouth: {closed: 'grin', open: 'laugh'}, blush: true},
  frustrated: {eyes: 'narrow', brows: [{lift: -6, tilt: 18}, {lift: -6, tilt: 18}], mouth: {closed: 'frown', open: 'grimace'}},
  confused: {eyes: 'dot', brows: [{lift: 12, tilt: -10}, {lift: -4, tilt: 10}], mouth: {closed: 'wavy', open: 'side'}},
  surprised: {eyes: 'wide', brows: [{lift: 18, tilt: -4}, {lift: 18, tilt: -4}], mouth: {closed: 'o', open: 'gasp'}},
  focused: {eyes: 'squint', brows: [{lift: -3, tilt: 8}, {lift: -3, tilt: 8}], mouth: {closed: 'flat', open: 'small'}}
});

export function expressionParts(name) {
  const parts = EXPRESSION_TABLE[name];
  if (!parts) throw new Error(`unknown expression ${JSON.stringify(name)} (expressions: ${EXPRESSIONS.join(', ')})`);
  return parts;
}
