// Drawing style "rubber-hose": an early theatrical-cartoon stick figure. A
// paper-white round face with black oval eyes, tiny brows and mouth and two
// fine curved hair tufts; a short neck; the spine and every limb a single
// narrow pressure-ink stroke (pens.mjs pressureStroke) that bows in a soft
// curve, so a limb reads as one bending hose; small white gloved hands and
// short black curved feet. No clothes: the line is the body. Longer hair
// and headwear keep their line-art shapes (the line style's pen), so a cast
// stays recognisable. Same rig, joints, part ids and acting as every style.
//
// A limb is drawn as a stroke per rig segment (upper arm, forearm), each a
// gentle outward bow with full-width round ends at the joint, because the
// renderers animate joint rotations only: a single curve through the elbow
// would be right for one pose and wrong for every tween.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {asHead, backOfHead, backView, caneLength, face, faceParts, faceView, gazeJoint, glasses, hairBack, hairFront, joint, toonColors, turnJoint} from './toon.mjs';
import {aidSide, covers, headwear, heldAid, wheelchair} from './toon-wear.mjs';
import {linePen} from './style-line.mjs';
import {stickGeometry} from './style-stick.mjs';
import {capsulePath, cubicPoints, mix, pressureStroke} from './pens.mjs';
import {asShadow} from './bounds.mjs';

const r1 = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);

export const HOSE_INK = '#1c1a1f';
export const HOSE_PAPER = '#fdfcf8';
// About a fifth of the figure's height, as the period cartoons draw it.
const HEAD_R = 92;
const OUTLINE = 6;
// Stroke weight per build, rig units (the stick figure's, a little finer).
const WEIGHT = {slim: 15, petite: 15, average: 17, athletic: 18, curvy: 18, broad: 19, stocky: 20, round: 21};
// How far a segment bows out, as a share of its length.
const BOW = 0.07;
// Hair the two tufts stand in for; every other style keeps its line-art hair.
const TUFTED = new Set(['buzz', 'short', 'sidepart', 'undercut', 'quiff', 'spiky', 'curly', 'pixie', 'mohawk', 'cornrows', 'twists']);

// Arms at rest hang a little away from the body, the forearm easing back, so
// the gloves clear the legs and the spine stays one clear line; raised arms
// go wide of the head. Standing, the arms differ a little and the weight
// sits on one leg (geometry.stance), so the figure stands on a line of
// action rather than as a ruler-straight column. Only this style's poses
// (rig.mjs geometry.poses and geometry.stance).
const REST_ARM = {arm: 17, fore: -9};
const POSES = Object.freeze({
  stand: {armL: REST_ARM.arm - 5, foreL: REST_ARM.fore + 4, armR: REST_ARM.arm + 6, foreR: REST_ARM.fore - 12},
  walk: {armL: REST_ARM.arm, foreL: REST_ARM.fore + 6, armR: REST_ARM.arm, foreR: REST_ARM.fore + 6},
  slump: {armL: 12, foreL: -4, armR: 12, foreR: -4},
  point: {armO: REST_ARM.arm, foreO: REST_ARM.fore},
  look: {armO: REST_ARM.arm, foreO: REST_ARM.fore},
  facepalm: {armO: REST_ARM.arm, foreO: REST_ARM.fore},
  'point-self': {armO: REST_ARM.arm, foreO: REST_ARM.fore},
  wave: {armA: 104, foreA: 52, armO: REST_ARM.arm, foreO: REST_ARM.fore},
  cheer: {armL: 112, foreL: 44, armR: 112, foreR: 44}
});

// Knees a little bent, the weight on the left leg (the right one eased).
const STANCE = Object.freeze({stand: {legL: 6, shinL: -4, legR: 2, shinR: 1}});

/** Rubber-hose geometry: the stick figure's rig lengths with a round head. */
export function hoseGeometry(params) {
  const g = stickGeometry(params);
  return {...g, w: WEIGHT[params.build] ?? 17, headR: HEAD_R, headCy: -HEAD_R * 0.96, poses: POSES, stance: STANCE};
}

// The toon face's brow, which this style redraws as a curved pressure stroke.
const BROW = 'M-13 3Q0 -4 13 3';

/**
 * The line pen, with hair (and a headscarf, which is hair) laid in as a soft
 * light gray-taupe holding a trace of its own colour under the ink line,
 * never a solid ink shape: the white face and the thin limbs stay the focus.
 */
function hosePen(c, id) {
  const tone = mix(c.hair, '#d6d1c2', 0.22);
  // A light hair colour makes the line pen fill paper, which the tone replaces; stubble (an ink wash in line art) is left out.
  const base = linePen({...c, hair: '#d6d1c2', stubble: '#d6d1c2'}, {id});
  const tint = node => (node.attrs && node.attrs.fill && node.attrs.fill !== 'none' ? {...node, attrs: {...node.attrs, fill: tone}} : node);
  return {
    ...base,
    shape: (d, fill, o = {}) => (fill === 'hair' && o.outline !== false ? tint(base.shape(d, fill, o)) : base.shape(d, fill, o)),
    strand: (d, fill, width) => base.strand(d, fill, width).map((node, i) => (fill === 'hair' && i === 1 ? {...node, attrs: {...node.attrs, stroke: tone}} : node)),
    // Pie eyes: a pupil becomes a tall black oval with a pie-cut highlight; its round glint is left out.
    ellipse: (cx, cy, rx, ry, fill, o = {}) => {
      if (fill === 'outline' && o.outline === false && rx >= 8) return pieEye(cx, cy, rx * 0.82, ry * 1.45);
      if (fill === '#ffffff' && o.outline === false && rx < 6) return el('g', null, null, []);
      return fill === 'hair' && o.outline !== false ? tint(base.ellipse(cx, cy, rx, ry, fill, o)) : base.ellipse(cx, cy, rx, ry, fill, o);
    },
    // Brows: an arched stroke that thins at its ends.
    line: (d, color, width) => (d === BROW ? pressureStroke(cubicPoints([-16, 6], [-8, -9], [8, -9], [16, 6], 8), 7.5, HOSE_INK, {seed: 'brow', taper: [0.4, 0.4], tip: 0.3, wobble: 0}) : base.line(d, color, width))
  };
}

/** A tall black oval eye with a pie-cut wedge of white toward the upper right. */
function pieEye(cx, cy, rx, ry) {
  const wedge = `M${r1(cx + rx * 0.08)} ${r1(cy - ry * 0.02)}L${r1(cx + rx * 0.97)} ${r1(cy - ry * 0.22)}Q${r1(cx + rx * 0.86)} ${r1(cy - ry * 0.86)} ${r1(cx + rx * 0.22)} ${r1(cy - ry * 0.96)}Z`;
  return el('g', null, null, [
    el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill: HOSE_INK, stroke: 'none'}),
    el('path', null, null, [], {d: wedge, fill: HOSE_PAPER, stroke: 'none'})
  ]);
}

/** One limb segment from (0, 0) to (0, length) as a bowed pressure stroke. */
function hose(length, width, seed, {taper = [0, 0], bow = -BOW} = {}) {
  const b = bow * length;
  return pressureStroke(cubicPoints([0, 0], [b, length / 3], [b, length * 2 / 3], [0, length], 10), width, HOSE_INK, {seed, taper, tip: 0.45, wobble: 0.12});
}

/**
 * A four-fingered cartoon glove hanging from the wrist at (0, handY): a
 * flared cuff, a palm, three fingers showing and a thumb toward the front,
 * three stitch lines on the back; about half the head's width.
 */
export function hoseGlove(handY) {
  const ink = {fill: HOSE_PAPER, stroke: HOSE_INK, strokeWidth: 4.5};
  const ell = (cx, cy, rx, ry, extra = {}) => el('ellipse', null, null, [], {cx: r1(cx), cy: r1(handY + cy), rx: r1(rx), ry: r1(ry), ...ink, ...extra});
  const palmY = 40;
  // Drawn at 1.18 about the wrist: the period glove is about half the head's width.
  return [group([
    ...[-17, 0, 17].map((x, i) => ell(x, palmY + 26 - Math.abs(x) * 0.25, 10, 17, {transform: `rotate(${(i - 1) * -10} ${r1(x)} ${r1(handY + palmY + 26)})`})),
    ell(0, palmY, 30, 27),
    // Covers the fingers' roots, so they read as one glove.
    el('ellipse', null, null, [], {cx: 0, cy: r1(handY + palmY + 6), rx: 26, ry: 22, fill: HOSE_PAPER, stroke: 'none'}),
    ell(31, palmY - 4, 10, 17, {transform: `rotate(-32 31 ${r1(handY + palmY - 4)})`}),
    el('path', null, null, [], {d: [-9, 0, 9].map(x => `M${x} ${r1(handY + palmY - 12)}L${r1(x * 1.15)} ${r1(handY + palmY + 6)}`).join(''), fill: 'none', stroke: HOSE_INK, strokeWidth: 3, strokeLinecap: 'round'}),
    // The flared cuff.
    el('path', null, null, [], {d: `M-15 ${r1(handY - 2)}L15 ${r1(handY - 2)}L24 ${r1(handY + 16)}Q0 ${r1(handY + 23)} -24 ${r1(handY + 16)}Z`, ...ink, strokeLinejoin: 'round'})
  ], {transform: `translate(0 ${r1(handY)}) scale(1.18) translate(0 ${r1(-handY)})`})];
}

/** A short black curved shoe at the end of a shin `sh` long, its toe toward +x. */
export function hoseShoe(sh) {
  return el('path', null, null, [], {d: `M-14 ${r1(sh - 14)}C14 ${r1(sh - 28)} 66 ${r1(sh - 26)} 78 ${r1(sh - 2)}C82 ${r1(sh + 8)} 72 ${r1(sh + 12)} 56 ${r1(sh + 12)}L-8 ${r1(sh + 12)}C-22 ${r1(sh + 12)} -26 ${r1(sh - 6)} -14 ${r1(sh - 14)}Z`, fill: HOSE_INK, stroke: 'none'});
}

/**
 * The head (paper face, tufts or line-art hair, the face, headwear) and the
 * hair behind it, each on its idle joint, in the head joint's frame (at the
 * neck). ctx: the drawing context drawRubberHose builds.
 */
export function hoseHead(ctx, expressions, {gaze = false, turns = false} = {}) {
  const {id, p: params, j, expression} = ctx;
  const g = hoseGeometry(params);
  const rig = ctx.g;
  const seed = part => `${id}:${part}`;
  const t = rig.head;
  const sx = r1((HEAD_R / t.rx) * 100) / 100, sy = r1((HEAD_R / t.ry) * 100) / 100;
  const onHead = kids => group(kids, {transform: `translate(0 ${r1(g.headCy)}) scale(${sx} ${sy}) translate(0 ${r1(-t.cy)})`});
  // Two fine curved tufts from the crown, in circle coordinates.
  const top = g.headCy - HEAD_R;
  const tufts = TUFTED.has(params.hair.style) && !params.headwear
    ? [-1, 1].map(k => pressureStroke(cubicPoints([k * 8, top + 5], [k * 5, top - 20], [k * 18, top - 36], [k * 32, top - 34], 10), 7, HOSE_INK, {seed: seed(`tuft${k}`), taper: [0.1, 0.6], tip: 0.35, wobble: 0.1}))
    : [];
  const lineHair = TUFTED.has(params.hair.style) ? [] : covers(params) ? [] : hairFront(ctx);

  const faceNodes = [...new Set([expression, ...expressions])].map(name => face(ctx, name)).filter(Boolean);
  const {jaw, features} = faceParts(ctx, gaze, () => [...faceNodes, ...glasses(ctx)]);
  const headKids = turnJoint(ctx, j, gaze, [
    asHead(el('ellipse', null, null, [], {cx: 0, cy: r1(g.headCy), rx: HEAD_R, ry: HEAD_R, fill: HOSE_PAPER, stroke: HOSE_INK, strokeWidth: OUTLINE})),
    ...tufts,
    onHead([...faceView(ctx, turns, [...jaw, ...gazeJoint(ctx, j, gaze, features)]), ...lineHair, ...backView(ctx, turns, () => backOfHead(ctx)), ...headwear(ctx)])
  ], sx);
  const headIdle = joint(ctx, 'headidle', 0, 0, {}, headKids);
  const backHair = TUFTED.has(params.hair.style) || params.headwear === 'turban' ? [] : [onHead(hairBack(ctx))];
  const backIdle = joint(ctx, 'hbidle', 0, 0, {}, backHair);
  return {headIdle, backIdle};
}

/** The pen and drawing context drawRubberHose uses, for a part drawn on its own (hoseHead). */
export function hoseContext(params, colors, {id, joints: j, expression = 'neutral', static: isStatic = true, props = null, facing = 'right'}) {
  const c = toonColors(colors);
  return {id, g: stickGeometry(params), c, p: params, j, expression, static: isStatic, props, P: hosePen(c, id), facing, eyeScale: 1.2};
}

/** Draw a rubber-hose figure. */
export function drawRubberHose(params, colors, {id, joints: j, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null, facing = 'right', gaze = false, turns = false}) {
  const g = hoseGeometry(params);
  // The toon face's geometry is the rig's; the head is scaled onto the circle (hoseHead).
  const ctx = hoseContext(params, colors, {id, joints: j, expression, static: isStatic, props, facing});
  const rig = ctx.g;
  const w = g.w;
  const seed = part => `${id}:${part}`;
  const glove = hoseGlove;

  const arm = side => {
    const s = side === 'l' ? 'L' : 'R';
    const handY = g.foreArm + g.hand * 0.1;
    // Pointing: one gloved finger out past the others.
    const finger = joint(ctx, `finger-${side}`, 0, handY + 70, {}, [el('path', null, null, [], {d: capsulePath(0, 46, 20), fill: HOSE_PAPER, stroke: HOSE_INK, strokeWidth: 4.5})]);
    const fingerWrap = isStatic ? (j[`finger${s}`] ? finger : null) : el('g', `${id}-fingerwrap-${side}`, {opacity: j[`finger${s}`]}, [finger]);
    const aid = aidSide(params, facing) === side ? caneLength(rig) : 0;
    const fore = joint(ctx, `fore-${side}`, 0, g.upperArm, {rotation: j[`fore${s}`]}, [joint(ctx, `foreidle-${side}`, 0, 0, {}, [
      hose(g.foreArm, w, seed(`fore-${side}`)),
      ...(fingerWrap ? [fingerWrap] : []),
      ...glove(handY),
      ...(aid ? [group([group(heldAid(ctx, aid / 0.8, -g.foreArm * 0.5), {transform: 'scale(0.8 0.8)'})], {transform: `translate(0 ${r1(handY)})`})] : []),
      ...(props?.[side] ? [group(props[side], {transform: `translate(0 ${r1(handY)})`})] : [])
    ])]);
    return joint(ctx, `arm-${side}`, side === 'l' ? -g.armX : g.armX, g.armY, {rotation: j[`arm${s}`], y: j.shoulderY}, [joint(ctx, `armidle-${side}`, 0, 0, {}, [hose(g.upperArm, w, seed(`arm-${side}`), {taper: [0.12, 0]}), fore])], {mirror: side === 'r'});
  };

  const leg = side => {
    const s = side === 'l' ? 'L' : 'R';
    // A short black curved shoe, toward the front (drawn mirrored, as the stick figure's foot).
    const shoe = hoseShoe(g.shin);
    const shin = joint(ctx, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, [hose(g.shin - 4, w, seed(`shin-${side}`), {bow: BOW * 0.6}), group([shoe], {transform: 'scale(-1 1)'})]);
    return joint(ctx, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, hose(g.thigh, w, seed(`leg-${side}`), {bow: BOW * 0.6})], {mirror: side === 'r'});
  };

  const {headIdle, backIdle} = hoseHead(ctx, expressions, {gaze, turns});
  const tilt = {rotation: j.head, y: j.headY};
  const torsoKids = [
    joint(ctx, 'hb', 0, g.neckY, tilt, [backIdle]),
    // The short neck and the spine: one stroke from under the head to the hips.
    group([hose(-g.neckY - 2, w, seed('spine'), {taper: [0, 0.1], bow: 0.07})], {transform: `translate(0 ${r1(g.neckY + 2)})`}),
    // The arms go behind the head: a hand raised to the head reads as touching it, never as a stroke across the face.
    arm('l'),
    arm('r'),
    joint(ctx, 'head', 0, g.neckY, tilt, [headIdle])
  ];
  const breath = joint(ctx, 'breath', 0, 0, {}, torsoKids);
  const torso = joint(ctx, 'torso', 0, g.hipY, {rotation: j.lean, scaleY: j.squash}, [breath]);
  const body = joint(ctx, 'body', 0, 0, {y: j.bodyY}, [leg('l'), leg('r'), torso]);
  const chair = params.mobility === 'wheelchair' ? wheelchair(ctx) : [];
  const ground = el('ellipse', null, null, [], {cx: 0, cy: 4, rx: 80, ry: 9, fill: HOSE_INK, opacity: 0.14});
  return group([...asShadow([ground]), ...chair, body]);
}

export function hoseHeight(params) {
  const g = hoseGeometry(params);
  const hat = {'chef-hat': 110, 'grad-cap': 24, 'beanie': 26, 'bike-helmet': 24, 'hard-hat': 20, 'turban': 30}[params.headwear] ?? 0;
  const hair = TUFTED.has(params.hair.style) && !params.headwear ? 44 : ({afro: 52, bun: 52, topknot: 28, 'space-buns': 27}[params.hair.style] ?? 10);
  return Math.round(-g.hipY + g.torso + g.neck * 0.7 + HEAD_R * 1.96 + Math.max(hat, hair));
}

export const STYLE = {draw: drawRubberHose, height: hoseHeight, geometry: hoseGeometry, describe: 'an early-cartoon rubber-hose figure: a paper-white round face with oval eyes and two hair tufts, the spine and limbs single bending strokes of pressure ink, white gloved hands and black curved shoes'};
