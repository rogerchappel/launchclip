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
import {cubicPoints, pressureStroke} from './pens.mjs';
import {asShadow} from './bounds.mjs';

const r1 = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);

export const HOSE_INK = '#1c1a1f';
export const HOSE_PAPER = '#fdfcf8';
const HEAD_R = 112;
const OUTLINE = 7;
// Stroke weight per build, rig units (the stick figure's, a little finer).
const WEIGHT = {slim: 13, petite: 13, average: 15, athletic: 16, curvy: 16, broad: 17, stocky: 18, round: 19};
// How far a segment bows out, as a share of its length.
const BOW = 0.07;
// Hair the two tufts stand in for; every other style keeps its line-art hair.
const TUFTED = new Set(['buzz', 'short', 'sidepart', 'undercut', 'quiff', 'spiky', 'curly', 'pixie', 'mohawk', 'cornrows', 'twists']);

/** Rubber-hose geometry: the stick figure's rig lengths with a larger round head. */
export function hoseGeometry(params) {
  const g = stickGeometry(params);
  return {...g, w: WEIGHT[params.build] ?? 15, headR: HEAD_R, headCy: -HEAD_R * 0.96};
}

/** One limb segment from (0, 0) to (0, length) as a bowed pressure stroke. */
function hose(length, width, seed, {taper = [0, 0], bow = -BOW} = {}) {
  const b = bow * length;
  return pressureStroke(cubicPoints([0, 0], [b, length / 3], [b, length * 2 / 3], [0, length], 10), width, HOSE_INK, {seed, taper, tip: 0.45, wobble: 0.12});
}

/** Draw a rubber-hose figure. */
export function drawRubberHose(params, colors, {id, joints: j, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null, facing = 'right', gaze = false, turns = false}) {
  const g = hoseGeometry(params);
  const c = toonColors(colors);
  const P = linePen(c, {id});
  // The toon face's geometry is the rig's; the head is scaled onto the circle below.
  const rig = stickGeometry(params);
  const ctx = {id, g: rig, c, p: params, j, expression, static: isStatic, props, P, facing, eyeScale: 1.2};
  const w = g.w;
  const seed = part => `${id}:${part}`;

  const t = rig.head;
  const sx = r1((HEAD_R / t.rx) * 100) / 100, sy = r1((HEAD_R / t.ry) * 100) / 100;
  const onHead = kids => group(kids, {transform: `translate(0 ${r1(g.headCy)}) scale(${sx} ${sy}) translate(0 ${r1(-t.cy)})`});

  const glove = handY => {
    const gw = 26;
    return [
      el('ellipse', null, null, [], {cx: 0, cy: r1(handY + gw * 0.2), rx: r1(gw), ry: r1(gw * 1.12), fill: HOSE_PAPER, stroke: HOSE_INK, strokeWidth: 4.5}),
      // The thumb, toward the front.
      el('ellipse', null, null, [], {cx: r1(gw * 0.85), cy: r1(handY - gw * 0.1), rx: r1(gw * 0.42), ry: r1(gw * 0.55), fill: HOSE_PAPER, stroke: HOSE_INK, strokeWidth: 4, transform: `rotate(-25 ${r1(gw * 0.85)} ${r1(handY - gw * 0.1)})`}),
      // A cuff line across the wrist.
      el('path', null, null, [], {d: `M${r1(-gw * 0.7)} ${r1(handY - gw * 0.6)}Q0 ${r1(handY - gw * 0.35)} ${r1(gw * 0.7)} ${r1(handY - gw * 0.6)}`, fill: 'none', stroke: HOSE_INK, strokeWidth: 3.5, strokeLinecap: 'round'})
    ];
  };

  const arm = side => {
    const s = side === 'l' ? 'L' : 'R';
    const handY = g.foreArm + g.hand * 0.1;
    const finger = joint(ctx, `finger-${side}`, 0, handY + g.hand * 0.4, {}, [hose(g.hand * 1.1, w * 0.8, seed(`finger-${side}`), {taper: [0, 0.4], bow: 0})]);
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
    const sh = g.shin;
    const shoe = el('path', null, null, [], {d: `M-10 ${r1(sh - 12)}C12 ${r1(sh - 22)} 46 ${r1(sh - 20)} 56 ${r1(sh - 2)}C60 ${r1(sh + 6)} 52 ${r1(sh + 10)} 40 ${r1(sh + 10)}L-6 ${r1(sh + 10)}C-16 ${r1(sh + 10)} -20 ${r1(sh - 6)} -10 ${r1(sh - 12)}Z`, fill: HOSE_INK, stroke: 'none'});
    const shin = joint(ctx, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, [hose(g.shin - 4, w, seed(`shin-${side}`), {bow: BOW * 0.6}), group([shoe], {transform: 'scale(-1 1)'})]);
    return joint(ctx, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, hose(g.thigh, w, seed(`leg-${side}`), {bow: BOW * 0.6})], {mirror: side === 'r'});
  };

  // Two fine curved tufts from the crown, in circle coordinates.
  const top = g.headCy - HEAD_R;
  const tufts = TUFTED.has(params.hair.style) && !params.headwear
    ? [-1, 1].map(k => pressureStroke(cubicPoints([k * 9, top + 6], [k * 6, top - 22], [k * 20, top - 40], [k * 36, top - 38], 10), 8, HOSE_INK, {seed: seed(`tuft${k}`), taper: [0.1, 0.6], tip: 0.35, wobble: 0.1}))
    : [];
  const lineHair = TUFTED.has(params.hair.style) ? [] : covers(params) ? [] : hairFront(ctx);

  const faceNodes = [...new Set([expression, ...expressions])].map(name => face(ctx, name)).filter(Boolean);
  const {jaw, features} = faceParts(ctx, gaze, () => [...faceNodes, ...glasses(ctx)]);
  const headKids = turnJoint(ctx, j, gaze, [
    asHead(el('ellipse', null, null, [], {cx: 0, cy: r1(g.headCy), rx: HEAD_R, ry: HEAD_R, fill: HOSE_PAPER, stroke: HOSE_INK, strokeWidth: OUTLINE})),
    ...tufts,
    onHead([...faceView(ctx, turns, [...jaw, ...gazeJoint(ctx, j, gaze, features)]), ...lineHair, ...backView(ctx, turns, () => backOfHead(ctx)), ...headwear(ctx)])
  ], sx);
  const tilt = {rotation: j.head, y: j.headY};
  const headIdle = joint(ctx, 'headidle', 0, 0, {}, headKids);
  const backHair = TUFTED.has(params.hair.style) || params.headwear === 'turban' ? [] : [onHead(hairBack(ctx))];
  const backIdle = joint(ctx, 'hbidle', 0, 0, {}, backHair);
  const torsoKids = [
    joint(ctx, 'hb', 0, g.neckY, tilt, [backIdle]),
    // The short neck and the spine: one stroke from under the head to the hips.
    group([hose(-g.neckY - 2, w, seed('spine'), {taper: [0, 0.1], bow: 0.03})], {transform: `translate(0 ${r1(g.neckY + 2)})`}),
    joint(ctx, 'head', 0, g.neckY, tilt, [headIdle]),
    arm('l'),
    arm('r')
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
