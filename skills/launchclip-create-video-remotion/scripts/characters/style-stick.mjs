// Drawing style "stick": a stick figure. Lines for the body and limbs, a
// round head, and nothing more than a person needs to stay recognisable:
// each line is inked and coloured by what covers it (the shirt along the
// spine and sleeves, trousers down the legs, skin where it shows), skirts are
// a simple flare, and the head wears the character's own hair, face, glasses
// and headwear (the toon shapes, scaled onto the circle). Builds change the
// line weight. Same rig, joints and part ids as the toon styles (toon.mjs),
// so the acting is identical.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {mixColor} from '../catalog-b-base.mjs';
import {rigGeometry} from './rig.mjs';
import {backOfHead, backView, face, faceView, facial, gazeJoint, glasses, hairBack, hairFront, joint, toonColors} from './toon.mjs';
import {aidSide, covers, faceExtras, headwear, heldAid, wheelchair} from './toon-wear.mjs';
import {flatPen} from './style-flat.mjs';
import {linePen} from './style-line.mjs';
import {caneLength} from './toon.mjs';
import {asShadow} from './bounds.mjs';

const r1 = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);
const line = (d, stroke, width, extra = {}) => el('path', null, null, [], {d, fill: 'none', stroke, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', ...extra});

const WEIGHT = {slim: 9, petite: 9, average: 11, athletic: 12, curvy: 12, broad: 13, stocky: 14, round: 15};
const HEAD_R = 74;
const EDGE = 3.5;
const LONG = new Set(['shirt', 'hoodie', 'blazer', 'sweater', 'turtleneck', 'cardigan', 'jacket', 'coat', 'lab-coat', 'chef-coat', 'kurta']);

/** A stick: an ink edge round a coloured core, from (0, from) to (0, to). */
function inkedStick(color, ink, w, from, to) {
  const d = `M0 ${r1(from)}L0 ${r1(to)}`;
  return [line(d, ink, w + EDGE * 2), line(d, color, w)];
}

/** Stick geometry: the rig's lengths (so poses and seats match), a round head. */
export function stickGeometry(params) {
  const g = rigGeometry(params);
  const w = WEIGHT[params.build] ?? 11;
  return {...g, w, headR: HEAD_R, headCy: -HEAD_R * 0.96, armX: w * 0.4, armY: -g.torso + 8, legX: w * 0.55, neckY: -g.torso - g.neck * 0.7};
}

/** Paper for the classic stick figure's head and skirts (the line style's paper). */
const PAPER = '#fbf9f4';

/**
 * Draw a stick figure. mono: the classic black-and-white figure: one ink
 * line for every limb and the spine, a white head, no hands or colour, and
 * the hair, face and headwear in line art.
 */
export function drawStick(params, colors, {id, joints: j, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null, facing = 'right', gaze = false, turns = false}, {mono = false} = {}) {
  const g = stickGeometry(params);
  const c = toonColors(colors);
  const P = mono ? linePen(c, {id}) : flatPen(c);
  const ink = c.outline;
  // Classic: every stick is one ink line; coloured: an ink edge round the colour of what covers it.
  const stick = mono ? (_color, _ink, width, from, to) => [line(`M0 ${r1(from)}L0 ${r1(to)}`, ink, Math.max(7, width * 0.72))] : inkedStick;
  const toonG = rigGeometry(params);
  const ctx = {id, g: toonG, c, p: params, j, expression, static: isStatic, props, P, facing};
  const w = g.w;
  const top = c.top, bottom = c.bottom, skin = c.skin;
  const long = LONG.has(params.outfit.top);
  const bare = ['shorts', 'skirt'].includes(params.outfit.bottom);

  // Toon head parts scaled from the toon egg onto the circle.
  const t = toonG.head;
  const sx = r1((HEAD_R / t.rx) * 100) / 100, sy = r1((HEAD_R / t.ry) * 100) / 100;
  const onHead = kids => group(kids, {transform: `translate(0 ${r1(g.headCy)}) scale(${sx} ${sy}) translate(0 ${r1(-t.cy)})`});

  // Arms: shoulder at the top of the spine.
  const arm = side => {
    const s = side === 'l' ? 'L' : 'R';
    const mirror = side === 'r';
    const handY = g.foreArm + g.hand * 0.2;
    const finger = joint(ctx, `finger-${side}`, 0, handY + g.hand * 0.4, {}, [line(`M0 0L0 ${r1(g.hand * 1.2)}`, ink, w * 0.6)]);
    const fingerWrap = isStatic ? (j[`finger${s}`] ? finger : null) : el('g', `${id}-fingerwrap-${side}`, {opacity: j[`finger${s}`]}, [finger]);
    const aid = aidSide(params, facing) === side ? caneLength(toonG) : 0;
    const fore = joint(ctx, `fore-${side}`, 0, g.upperArm, {rotation: j[`fore${s}`]}, [
      ...stick(long ? top : skin, ink, w, 0, g.foreArm),
      ...(fingerWrap ? [fingerWrap] : []),
      ...(mono ? [] : [el('ellipse', null, null, [], {cx: 0, cy: r1(handY), rx: r1(w * 1.15), ry: r1(w * 1.2), fill: skin, stroke: ink, strokeWidth: EDGE})]),
      ...(aid ? [group([group(heldAid(ctx, aid / 0.8, -g.foreArm * 0.5), {transform: 'scale(0.8 0.8)'})], {transform: `translate(0 ${r1(handY)})`})] : []),
      ...(props?.[side] ? [group(props[side], {transform: `translate(0 ${r1(handY)})`})] : [])
    ]);
    const upper = long || params.outfit.top === 'tank' ? stick(params.outfit.top === 'tank' ? skin : top, ink, w, 0, g.upperArm) : [...stick(skin, ink, w, 0, g.upperArm), ...stick(top, ink, w + 2, 0, g.upperArm * 0.42)];
    return joint(ctx, `arm-${side}`, side === 'l' ? -g.armX : g.armX, g.armY, {rotation: j[`arm${s}`], y: j.shoulderY}, [...upper, fore], {mirror});
  };

  // Legs: hip at the base of the spine.
  const leg = side => {
    const s = side === 'l' ? 'L' : 'R';
    const shinColor = bare || params.mobility === 'prosthetic-leg' && side === 'l' ? (params.mobility === 'prosthetic-leg' && side === 'l' ? '#aab2bc' : skin) : bottom;
    const foot = line(`M0 ${r1(g.shin)}L${r1(w * 2.2)} ${r1(g.shin + 4)}`, c.shoes === skin ? ink : c.shoes, w + 2);
    const shin = joint(ctx, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, [
      ...stick(shinColor, ink, params.mobility === 'prosthetic-leg' && side === 'l' ? w * 0.6 : w, 0, g.shin),
      group(mono ? [line(`M0 ${r1(g.shin)}L${r1(w * 1.8)} ${r1(g.shin + 2)}`, ink, Math.max(7, w * 0.72))] : [line(`M0 ${r1(g.shin)}L${r1(w * 2.2)} ${r1(g.shin + 4)}`, ink, w + 2 + EDGE * 2), foot], {transform: 'scale(-1 1)'})
    ]);
    const thigh = params.outfit.bottom === 'shorts' ? [...stick(skin, ink, w, 0, g.thigh), ...stick(bottom, ink, w + 3, 0, g.thigh * 0.55)] : stick(params.outfit.bottom === 'skirt' ? skin : bottom, ink, w, 0, g.thigh);
    return joint(ctx, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, ...thigh], {mirror: side === 'r'});
  };

  // Skirts and dresses: a flare from the waist.
  const flare = [];
  if (['skirt', 'long-skirt'].includes(params.outfit.bottom)) {
    const fill = params.outfit.top === 'dress' ? top : bottom;
    const len = params.outfit.bottom === 'long-skirt' ? (g.thigh + g.shin) * 0.86 : g.thigh * 0.8;
    const y0 = g.hipY - 16, y1 = r1(g.hipY + len), x1 = r1(params.outfit.bottom === 'long-skirt' ? 78 : 62);
    flare.push(el('path', null, null, [], {d: `M-10 ${r1(y0)}L10 ${r1(y0)}L${x1} ${y1}L${-x1} ${y1}Z`, fill: mono ? PAPER : fill, stroke: ink, strokeWidth: mono ? 6 : EDGE, strokeLinejoin: 'round'}));
  }

  const faceNodes = [...new Set([expression, ...expressions])].map(name => face(ctx, name)).filter(Boolean);
  const headKids = [
    el('ellipse', null, null, [], {cx: 0, cy: r1(g.headCy), rx: HEAD_R, ry: HEAD_R, fill: mono ? PAPER : skin, stroke: ink, strokeWidth: 6}),
    onHead([...faceView(ctx, turns, gazeJoint(ctx, j, gaze, [...facial(ctx), ...faceExtras(ctx), ...faceNodes, ...glasses(ctx)])), ...(covers(params) ? [] : hairFront(ctx)), ...backView(ctx, turns, () => backOfHead(ctx)), ...headwear(ctx)])
  ];
  const tilt = {rotation: j.head, y: j.headY};
  const headIdle = joint(ctx, 'headidle', 0, 0, {}, headKids);
  const backIdle = joint(ctx, 'hbidle', 0, 0, {}, params.headwear === 'turban' ? [] : [onHead(hairBack(ctx))]);
  const spine = stick(top, ink, w + 6, -g.torso + 2, -6);
  const torsoKids = [
    joint(ctx, 'hb', 0, g.neckY, tilt, [backIdle]),
    line(`M0 ${r1(-g.torso)}L0 ${r1(g.neckY + 4)}`, ink, w * 0.7),
    ...spine,
    joint(ctx, 'head', 0, g.neckY, tilt, [headIdle]),
    arm('l'),
    arm('r')
  ];
  const breath = joint(ctx, 'breath', 0, 0, {}, torsoKids);
  const torso = joint(ctx, 'torso', 0, g.hipY, {rotation: j.lean, scaleY: j.squash}, [breath]);
  const body = joint(ctx, 'body', 0, 0, {y: j.bodyY}, [leg('l'), leg('r'), ...flare, torso]);
  const chair = params.mobility === 'wheelchair' ? wheelchair(ctx) : [];
  const ground = mono ? line('M-90 4L90 4', ink, 4, {opacity: 0.35}) : el('ellipse', null, null, [], {cx: 0, cy: 4, rx: 110, ry: 14, fill: mixColor('#000000', c.skin, 1), opacity: 0.12});
  return group([...asShadow([ground]), ...chair, body]);
}

export function stickHeight(params) {
  const g = stickGeometry(params);
  const hat = {'chef-hat': 110, 'grad-cap': 24, 'beanie': 26, 'bike-helmet': 24, 'hard-hat': 20, 'turban': 30}[params.headwear] ?? 0;
  const hair = {afro: 52, bun: 52, curly: 18, mohawk: 55, spiky: 33, quiff: 39, topknot: 28, 'space-buns': 27}[params.hair.style] ?? 10;
  return Math.round(-g.hipY + g.torso + g.neck * 0.7 + HEAD_R * 1.96 + Math.max(hat, hair));
}

export const STYLE_CLASSIC = {draw: (params, colors, options) => drawStick(params, colors, options, {mono: true}), height: stickHeight, geometry: stickGeometry, describe: 'a classic black-and-white stick figure: one ink line per limb, a white head, the character\'s hair and face in line art'};

export const STYLE = {draw: drawStick, height: stickHeight, geometry: stickGeometry, describe: 'a stick figure: coloured lines for body and clothes, a round head with the character\'s own hair and face'};
