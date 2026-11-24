// EXPERIMENTAL (docs/rd/per-frame-rig.md): draws a rigFrame (rig-frame.mjs)
// as one static SVG tree per frame. Limbs are drawn from the frame's joints
// every frame, so a rubber-hose arm is one smooth curve shoulder → elbow →
// wrist (and hip → knee → ankle) in pressure ink, re-bent each frame; a
// stick limb is two straight segments. Gloves, shoes and the head are the
// style's own parts (style-rubber-hose.mjs), so the figure looks the same.
//
// Also the prototype scene (PROTOTYPE): the walk in, the throw and the idle
// the side-by-side render compares with today's rig.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {HOSE_INK, hoseContext, hoseGeometry, hoseGlove, hoseHead, hoseShoe} from './style-rubber-hose.mjs';
import {GAZE} from './actions.mjs';
import {characterLook, starterCharacter} from './cast.mjs';
import {drawHandProp} from './props.mjs';
import {cubicPoints, pressureStroke} from './pens.mjs';
import {rigFrame, planWalks} from './rig-frame.mjs';
import {poseJoints} from './rig.mjs';

const r1 = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);

/**
 * Points along one smooth limb through its middle joint: the quadratic
 * Bézier that passes through the elbow (or knee) halfway, bowed a little
 * when the limb is straight so it still reads as a hose.
 */
export function limbCurve(a, mid, end, {n = 14, bow = 0.05, side = 1} = {}) {
  const m = [(a[0] + end[0]) / 2, (a[1] + end[1]) / 2];
  const len = Math.hypot(end[0] - a[0], end[1] - a[1]) || 1;
  const nx = -(end[1] - a[1]) / len, ny = (end[0] - a[0]) / len;
  const dev = (mid[0] - m[0]) * nx + (mid[1] - m[1]) * ny;
  const min = bow * len;
  // A near-straight limb: the middle joint pushed out to the minimum bow.
  const push = Math.abs(dev) >= min ? 0 : (Math.sign(dev) || side) * min - dev;
  const e = [mid[0] + nx * push, mid[1] + ny * push];
  // The control point that puts the curve's halfway point on the joint: 2E − M.
  const c = [2 * e[0] - m[0], 2 * e[1] - m[1]];
  return cubicPoints(a, [a[0] + (c[0] - a[0]) * 2 / 3, a[1] + (c[1] - a[1]) * 2 / 3], [end[0] + (c[0] - end[0]) * 2 / 3, end[1] + (c[1] - end[1]) * 2 / 3], end, n);
}

/**
 * Draw one frame of a character. frame: rigFrame's result.
 * options: {id, style: 'rubber-hose' | 'stick', expression, colors, props: {ball?}}
 */
export function drawRigFrame(character, colors, frame, {id = 'rig', expression = 'neutral', propColors = {}} = {}) {
  const {params} = character;
  const g = hoseGeometry(params);
  const f = frame.facing === 'left' ? -1 : 1;
  const w = g.w;
  const ink = HOSE_INK;
  const hose = character.style !== 'stick';
  const stroke = (points, seed, taper = [0.1, 0]) => pressureStroke(points, w, ink, {seed: `${id}:${seed}`, taper, tip: 0.45, wobble: 0.12});
  const segment = (a, b, c) => el('path', null, null, [], {d: `M${r1(a[0])} ${r1(a[1])}L${r1(b[0])} ${r1(b[1])}L${r1(c[0])} ${r1(c[1])}`, fill: 'none', stroke: ink, strokeWidth: w * 0.8, strokeLinecap: 'round', strokeLinejoin: 'round'});
  const limb = (a, b, c, seed, side) => (hose ? stroke(limbCurve(a, b, c, {side}), seed) : segment(a, b, c));

  const leg = side => {
    const L = frame.legs[side];
    const shoe = group([hoseShoe(g.shin)], {transform: `translate(${r1(L.ankle[0])} ${r1(L.ankle[1])}) rotate(${r1(f * L.pitch)}) scale(${f} 1) translate(0 ${-g.shin})`});
    return [limb(L.hip, L.knee, L.ankle, `leg-${side}`, -f), shoe];
  };
  const arm = side => {
    const A = frame.arms[side];
    const glove = group(hoseGlove(0), {transform: `translate(${r1(A.wrist[0])} ${r1(A.wrist[1])}) rotate(${r1(-A.glove)}) scale(${f} 1)`});
    return [limb(A.shoulder, A.elbow, A.wrist, `arm-${side}`, f), glove];
  };

  // The head: the style's own, at the neck, turned toward the facing, leaning a little less than the body.
  const j = {...poseJoints('stand', {facing: frame.facing, geometry: g}), gazeX: f * GAZE.x};
  const ctx = hoseContext(params, colors, {id, joints: j, expression, static: true, facing: frame.facing});
  const {headIdle, backIdle} = hoseHead(ctx, [expression], {gaze: true});
  const headAt = kids => group(kids, {transform: `translate(${r1(frame.joints.neck[0])} ${r1(frame.joints.neck[1])}) rotate(${r1(f * frame.lean * 0.6 + frame.head)})`});

  // The spine: one stroke from the hips to under the head, bowed back by the drag still to come.
  const {pelvis, neck} = frame.joints;
  const mid = [(pelvis[0] + neck[0]) / 2 - f * (6 + frame.bend), (pelvis[1] + neck[1]) / 2];
  const spine = hose ? stroke(limbCurve(neck, mid, pelvis, {bow: 0.02}), 'spine', [0, 0.1]) : segment(neck, mid, pelvis);

  const ball = frame.ball ? [group(drawHandProp('ball', propColors).body, {transform: `translate(${r1(frame.ball.at[0])} ${r1(frame.ball.at[1])})`})] : [];
  const shadow = el('ellipse', null, null, [], {cx: r1(pelvis[0]), cy: 4, rx: 80, ry: 9, fill: ink, opacity: 0.14});
  // The arm on the far side goes behind the body; the near arm and the ball in front.
  const far = f < 0 ? 'r' : 'l', near = far === 'l' ? 'r' : 'l';
  return group([shadow, ...arm(far), headAt([backIdle]), ...leg(far), ...leg(near), spine, ...arm(near), headAt([headIdle]), ...ball]);
}

// ---------------------------------------------------------------------------
// The prototype scene: the side-by-side's right half.

const AT = Object.freeze({x: 648, floor: 1420.8, scale: 0.864});

/**
 * Walk in about 0.8 m (four steps) with planted feet, stop, anticipation, an arced
 * throw with follow-through, a settle, then an idle with weight shifts.
 * Today's rig acts the same beats (eval/per-frame-rig/today.storyboard.json).
 */
export const PROTOTYPE = Object.freeze({
  id: 'oliver',
  style: 'rubber-hose',
  brand: {primary: '#9a3b2e', accent: '#c9a227', paper: '#fdfcf8', ink: '#1c1a1f', bg: '#e9e1cf'},
  track: {
    x: 0, facing: 'left', stance: 22,
    walks: [{start: 0.3, end: 1.75, to: -449, stance: 46, stepLength: 150}],
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
      l: [
        // The hand swings back and up (the arm straight as it passes behind), cocks behind the head,
        // holds, then whips over the top to release ahead and follows through down and across.
        {t: 3.5, at: [14, 296]},
        {t: 3.9, at: [-150, 245]},
        {t: 4.06, at: [-282, 100], bend: -1},
        {t: 4.2, at: [-150, -150], bend: -1},
        {t: 4.31, at: [-128, -178], bend: -1},
        {t: 4.4, at: [20, -290], bend: -1},
        {t: 4.47, at: [215, -205]},
        {t: 4.57, at: [288, 40]},
        {t: 4.75, at: [170, 222]},
        {t: 5.05, at: [50, 286]}
      ]
    },
    ball: {side: 'l', release: 4.47, velocity: [1100, -820], gravity: 2300}
  },
  expressions: [{t: 0, expression: 'happy'}, {t: 4.4, expression: 'delighted'}, {t: 5.6, expression: 'happy'}],
  at: AT
});

/** The prototype character, its colours and the walk plan (shared by every frame). */
export function prototypeCast(scene = PROTOTYPE) {
  const starter = starterCharacter(scene.id);
  const look = characterLook(starter.params, {style: scene.style, brand: {colors: scene.brand}});
  const character = {params: starter.params, style: scene.style};
  return {character, colors: look.colors, plan: planWalks(scene.track)};
}

/** The prototype at time t as an SVG tree (canvas px), with a transparent background. */
export function prototypeTree(t, {width = 1080, height = 1920} = {}, scene = PROTOTYPE, cast = prototypeCast(scene)) {
  const frame = rigFrame(cast.character, scene.track, t, cast.plan);
  const expression = scene.expressions.filter(e => e.t <= t + 1e-9).at(-1)?.expression ?? 'neutral';
  const body = drawRigFrame(cast.character, cast.colors, frame, {id: scene.id, expression, propColors: {accent: scene.brand.accent, primary: scene.brand.primary, paper: scene.brand.paper}});
  const {x, floor, scale} = scene.at;
  return el('svg', null, {position: 'absolute', left: 0, top: 0}, [group([body], {transform: `translate(${x} ${floor}) scale(${scale})`})], {width, height, viewBox: `0 0 ${width} ${height}`});
}

