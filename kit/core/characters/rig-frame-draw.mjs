// Draws a rigFrame (rig-frame.mjs) as one static SVG tree per frame, in rig
// units. Limbs are drawn from the frame's joints every frame:
// - rubber-hose: a limb is one smooth curve shoulder → elbow → wrist (hip →
//   knee → ankle) in pressure ink, re-bent each frame; the glove, shoe and
//   head are the style's own parts (style-rubber-hose.mjs).
// - stick: two straight segments per limb, an ink edge round the colour of
//   what covers it (sleeves, trousers, skin), round hands, line feet and the
//   style's own head (style-stick.mjs stickHead).
// - stick-classic: the same in one ink line, a paper head, no hands.
// Other drawing styles are not drawn by this rig (RIG_FRAME_STYLES).
//
// The head turns three-quarter toward the facing with the frame's `look`,
// lags the body's bob, and can speak (a viseme). A gag squash scales the
// whole figure about its feet; a step squash scales the upper body about the
// pelvis.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {HOSE_INK, hoseContext, hoseGeometry, hoseGlove, hoseHead, hoseShoe} from './style-rubber-hose.mjs';
import {STICK_LONG_SLEEVES, stickContext, stickGeometry, stickHead} from './style-stick.mjs';
import {GAZE} from './actions.mjs';
import {VISEMES} from './acting.mjs';
import {drawHandProp} from './props.mjs';
import {cubicPoints, pressureStroke} from './pens.mjs';
import {poseJoints} from './rig.mjs';

/** The drawing styles the per-frame rig draws; others keep the op-list rig. */
export const RIG_FRAME_STYLES = Object.freeze(['rubber-hose', 'stick', 'stick-classic']);
// How much of the walk's step squash each style shows (a hose body is rubber; a stick barely gives).
const STEP_SQUASH = {'rubber-hose': 1, stick: 0.4, 'stick-classic': 0.4};
// The stick style's ink edge round a coloured line (style-stick.mjs).
const EDGE = 3.5;

const r1 = value => Math.round(value * 10) / 10;
const r3 = value => Math.round(value * 1000) / 1000;
const group = (children, attrs) => el('g', null, null, children, attrs);
const lerp = (a, b, t) => a + (b - a) * t;

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

/** A squash (+ flattens, − stretches) as a scale about a point, keeping the area: '' when none. */
export function squashTransform(amount, about) {
  if (Math.abs(amount) < 1e-4) return '';
  const sy = Math.max(0.2, 1 - amount), sx = 1 / Math.sqrt(sy);
  return `translate(${r1(about[0])} ${r1(about[1])}) scale(${r3(sx)} ${r3(sy)}) translate(${r1(-about[0])} ${r1(-about[1])})`;
}

/** A hand prop's drawing (props.mjs), centred on the origin, sheets stacked. */
export function rigPropNodes(kind, colors = {}) {
  const {body, layers} = drawHandProp(kind, colors);
  return [...body, ...layers.flat()];
}

/**
 * Draw one frame of a character (rig units, the feet's ground at y = 0).
 * frame: rigFrame's result. options: {id, expression, viseme (acting.mjs
 * VISEMES name), held: nodes drawn between the body and the near arm (a
 * prop in hand, placed in rig units)}.
 */
export function drawRigFrame(character, colors, frame, {id = 'rig', expression = 'neutral', viseme = null, held = []} = {}) {
  const {params, style} = character;
  if (!RIG_FRAME_STYLES.includes(style)) throw new Error(`the per-frame rig draws ${RIG_FRAME_STYLES.join(', ')}, not ${JSON.stringify(style)}`);
  const hose = style === 'rubber-hose', mono = style === 'stick-classic';
  const g = hose ? hoseGeometry(params) : stickGeometry(params);
  const f = frame.facing === 'left' ? -1 : 1;
  const w = g.w;
  const {pelvis, neck} = frame.joints;

  // The head: the style's own, at the neck (lagging the bob), turned three-quarter toward the facing as the frame looks.
  const j = {...poseJoints('stand', {facing: frame.facing, geometry: g}), gazeX: r1(frame.fc * lerp(GAZE.x * 0.5, GAZE.quarter, frame.look)), gazeScale: r3(lerp(1, GAZE.quarterScale, frame.look))};
  const mouth = viseme ? VISEMES[viseme] ?? null : null;
  const headOptions = {id, joints: j, expression, static: true, facing: frame.facing};
  const ctx = hose ? {...hoseContext(params, colors, headOptions), mouth} : {...stickContext(params, colors, {...headOptions, mono}), mouth};
  const {headIdle, backIdle} = hose ? hoseHead(ctx, [expression], {gaze: true}) : stickHead(ctx, [expression], {gaze: true, mono});
  const headAt = kids => group(kids, {transform: `translate(${r1(neck[0])} ${r1(neck[1] + frame.hbob)}) rotate(${r1(frame.fc * frame.lean * 0.6 + frame.head)})`});

  // Limbs, feet and hands in the style.
  const ink = hose ? HOSE_INK : ctx.c.outline;
  const poly = (...pts) => `M${pts.map(p => `${r1(p[0])} ${r1(p[1])}`).join('L')}`;
  const line = (d, stroke, width) => el('path', null, null, [], {d, fill: 'none', stroke, strokeWidth: r1(width), strokeLinecap: 'round', strokeLinejoin: 'round'});
  const stroke = (points, seed, taper = [0.1, 0]) => pressureStroke(points, w, ink, {seed: `${id}:${seed}`, taper, tip: 0.45, wobble: 0.12});
  // A stick: one ink line (classic) or an ink edge round a coloured core.
  const stick = (d, color, width = w) => (mono ? [line(d, ink, Math.max(7, width * 0.72))] : [line(d, ink, width + EDGE * 2), line(d, color, width)]);
  const along = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
  const c = ctx.c;
  const long = STICK_LONG_SLEEVES.has(params.outfit.top);
  const bare = ['shorts', 'skirt'].includes(params.outfit.bottom);

  const leg = side => {
    const L = frame.legs[side];
    if (hose) {
      const shoe = group([hoseShoe(g.shin)], {transform: `translate(${r1(L.ankle[0])} ${r1(L.ankle[1])}) rotate(${r1(f * L.pitch)}) scale(${f} 1) translate(0 ${-g.shin})`});
      return [stroke(limbCurve(L.hip, L.knee, L.ankle, {side: -f}), `leg-${side}`), shoe];
    }
    const a = f * L.pitch * Math.PI / 180, len = w * (mono ? 1.8 : 2.2);
    const toe = [L.ankle[0] + f * len * Math.cos(a), L.ankle[1] + f * len * Math.sin(a) + 3];
    const thigh = params.outfit.bottom === 'skirt' ? c.skin : params.outfit.bottom === 'shorts' ? c.skin : c.bottom;
    return [
      ...stick(poly(L.hip, L.knee), thigh), ...(params.outfit.bottom === 'shorts' && !mono ? stick(poly(L.hip, along(L.hip, L.knee, 0.55)), c.bottom, w + 3) : []),
      ...stick(poly(L.knee, L.ankle), bare ? c.skin : c.bottom),
      ...(mono ? [line(poly(L.ankle, toe), ink, Math.max(7, w * 0.72))] : [line(poly(L.ankle, toe), ink, w + 2 + EDGE * 2), line(poly(L.ankle, toe), c.shoes === c.skin ? ink : c.shoes, w + 2)])
    ];
  };
  const arm = side => {
    const A = frame.arms[side];
    if (hose) {
      const glove = group(hoseGlove(0), {transform: `translate(${r1(A.wrist[0])} ${r1(A.wrist[1])}) rotate(${r1(-A.glove)}) scale(${f} 1)`});
      return [stroke(limbCurve(A.shoulder, A.elbow, A.wrist, {side: f}), `arm-${side}`), glove];
    }
    const sleeve = long || params.outfit.top === 'tank' ? [] : stick(poly(A.shoulder, along(A.shoulder, A.elbow, 0.42)), c.top, w + 2);
    const upper = params.outfit.top === 'tank' ? c.skin : long ? c.top : c.skin;
    return [
      ...stick(poly(A.shoulder, A.elbow), upper), ...sleeve,
      ...stick(poly(A.elbow, A.wrist), long ? c.top : c.skin),
      ...(mono ? [] : [el('ellipse', null, null, [], {cx: r1(A.palm[0]), cy: r1(A.palm[1]), rx: r1(w * 1.15), ry: r1(w * 1.2), fill: c.skin, stroke: ink, strokeWidth: EDGE})])
    ];
  };

  // The spine: from the hips to under the head, bowed back by the drag still to come.
  const mid = [(pelvis[0] + neck[0]) / 2 - f * (6 + frame.bend), (pelvis[1] + neck[1]) / 2];
  const spine = hose ? [stroke(limbCurve(neck, mid, pelvis, {bow: 0.02}), 'spine', [0, 0.1])] : stick(poly(neck, mid, pelvis), c.top, w + 6);

  const shadow = hose || !mono
    ? el('ellipse', null, null, [], {cx: r1(pelvis[0]), cy: 4, rx: hose ? 80 : 110, ry: hose ? 9 : 14, fill: hose ? HOSE_INK : '#000000', opacity: hose ? 0.14 : 0.12})
    : line(`M${r1(pelvis[0] - 90)} 4L${r1(pelvis[0] + 90)} 4`, ink, 4);
  // The arm on the far side goes behind the body; the near arm (and what it holds) in front.
  const far = f < 0 ? 'r' : 'l', near = far === 'l' ? 'r' : 'l';
  const upperBody = kids => {
    const t = squashTransform(frame.stepSquash * STEP_SQUASH[style], pelvis);
    return t ? [group(kids, {transform: t})] : kids;
  };
  const body = [
    ...upperBody([...arm(far), headAt([backIdle])]),
    ...leg(far), ...leg(near),
    ...upperBody([...spine, ...held, ...arm(near), headAt([headIdle])])
  ];
  const gag = squashTransform(frame.squash, [pelvis[0], 0]);
  return group([shadow, ...(gag ? [group(body, {transform: gag})] : body)]);
}
