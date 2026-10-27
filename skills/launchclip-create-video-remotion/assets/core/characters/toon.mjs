// The toon body: the shapes shared by the cartoon drawing styles (flat,
// outlined, paper, soft-shade, line). One builder lays out every part of a
// character from the rig (rig.mjs) and hands each shape to a pen; the pen
// decides how it is drawn (a filled shape with a dark outline, a cut paper
// piece with a drop shadow, a softly shaded piece, a line drawing). So every
// toon style draws the same silhouettes, poses and faces, and a cast looks
// like the same people in any of them.
//
// The drawing is an element tree (kit/core/catalog-b-view.mjs nodes) of SVG
// groups in rig units, feet on y = 0. Every joint is a pair of groups: an
// outer <g transform="translate(…)"> that places the pivot, and an inner
// group with the joint's id whose transform the op list animates (rotation,
// y, scaleY about the pivot). The right side is drawn mirrored
// (scale(-1, 1)), so one positive angle swings either limb outward.
//
// Part ids, for a character id C:
//   C-body (bodyY)  C-torso (lean, squash)  C-breath (idle)
//   C-head, C-hb (head and the hair behind it: tilt, headY), C-headidle, C-hbidle
//   C-arm-l / C-arm-r, C-fore-l / C-fore-r, C-finger-l / C-finger-r
//   C-leg-l / C-leg-r (and legScale), C-shin-l / C-shin-r
//   C-turn (the head turned to look: across, nod), C-gaze (the features
//     across the face; both only for a character with a target)
//   C-face-<expression>, C-eyes-<expression> (blinks),
//   C-mouth-<expression> / C-open-<expression> (closed / open mouth)
//
// A pen ({shape, ellipse, line, limb, ground, defs?}) turns shapes into
// nodes. Colours are named by the character's colour keys (skin, topShade,
// outline, …) or given as hex; the pen resolves them.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {mixColor} from '../catalog-b-base.mjs';
import {expressionParts, rigGeometry} from './rig.mjs';
import {GREY_HAIR} from './palette.mjs';
import {asShadow} from './bounds.mjs';
import {NEW_LONG_SLEEVES, aidSide, backpackBack, bagStraps, covers, faceExtras, headwear, heldAid, longHem, neckwear, newGlasses, newHairBack, newHairFront, newTop, overLayer, prostheticForearm, prostheticShin, wheelchair, wristWear} from './toon-wear.mjs';

const r1 = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);

/** SVG attribute form of transformString() (same order: translate, rotate, scale). */
export function svgTransform({x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1}) {
  let out = `translate(${r1(x)} ${r1(y)})`;
  if (rotation) out += ` rotate(${r1(rotation)})`;
  if (scaleX !== 1 || scaleY !== 1) out += ` scale(${scaleX} ${scaleY})`;
  return out;
}

/**
 * A joint: the pivot at (x, y) in the parent's frame, then the animated
 * part. In static mode it is a pair of SVG groups with attribute transforms
 * (quick sheets); otherwise a `joint` node that view.mjs turns into divs
 * the op list animates.
 */
export function joint(ctx, part, x, y, values, children, {mirror = false} = {}) {
  const id = part ? `${ctx.id}-${part}` : null;
  const transform = {x: values.x ?? 0, y: values.y ?? 0, rotation: values.rotation ?? 0, scaleX: values.scaleX ?? 1, scaleY: values.scaleY ?? 1};
  if (!ctx.static) return {tag: 'joint', id, pivot: {x: r1(x), y: r1(y), mirror}, transform, children};
  const inner = group(children, {...(id ? {id} : {}), transform: svgTransform(transform)});
  return group([inner], {transform: `translate(${r1(x)} ${r1(y)})${mirror ? ' scale(-1 1)' : ''}`});
}

// ---------------------------------------------------------------------------
// Limbs

const LONG_SLEEVES = new Set(['shirt', 'hoodie', 'blazer', 'sweater']);

function arm(ctx, side) {
  const {g, p, j, P} = ctx;
  const s = side === 'l' ? 'L' : 'R';
  const long = LONG_SLEEVES.has(p.outfit.top) || NEW_LONG_SLEEVES.has(p.outfit.top);
  const sleeve = 'top';
  const hand = g.hand;
  const mirror = side === 'r';
  const robot = side === 'r' && p.mobility === 'prosthetic-arm';
  const aid = aidSide(p, ctx.facing) === side ? caneLength(g) : 0;
  const finger = joint(ctx, `finger-${side}`, 0, g.foreArm + hand * 0.6, {}, P.within({mirror}, () => [
    ...P.limb(hand * 1.25, 15, 'skin')
  ]));
  const fingerWrap = ctx.static ? (j[`finger${s}`] ? finger : null) : el('g', `${ctx.id}-fingerwrap-${side}`, {opacity: j[`finger${s}`]}, [finger]);
  const fore = joint(ctx, `fore-${side}`, 0, g.upperArm, {rotation: j[`fore${s}`]}, P.within({mirror}, () => (robot ? [
    ...(fingerWrap ? [fingerWrap] : []),
    ...prostheticForearm(ctx)
  ] : [
    ...P.limb(g.foreArm, g.armW * 0.9, long ? sleeve : 'skin'),
    ...(long ? [P.line(`M${r1(-g.armW * 0.45)} ${r1(g.foreArm - 6)}L${r1(g.armW * 0.45)} ${r1(g.foreArm - 6)}`, 'topShade', 6)] : []),
    ...wristWear(ctx, side),
    ...(fingerWrap ? [fingerWrap] : []),
    P.ellipse(0, g.foreArm + hand * 0.35, hand, hand * 1.04, 'skin')
  ]).concat(
    aid ? [group(heldAid(ctx, aid, -g.foreArm * 0.5), {transform: `translate(0 ${r1(g.foreArm + hand * 0.35)})`})] : [],
    ctx.props?.[side] ? [group(ctx.props[side], {transform: `translate(0 ${r1(g.foreArm + hand * 0.35)})`})] : []
  )));
  const upper = P.within({mirror}, () => (long
    ? P.limb(g.upperArm, g.armW, sleeve)
    : p.outfit.top === 'tank' ? P.limb(g.upperArm, g.armW * 0.92, 'skin')
      : [...P.limb(g.upperArm, g.armW * 0.92, 'skin'), ...P.limb(g.upperArm * 0.5, g.armW + 8, sleeve, -4)]));
  return joint(ctx, `arm-${side}`, side === 'l' ? -g.armX : g.armX, g.armY, {rotation: j[`arm${s}`], y: j.shoulderY}, [...upper, fore], {mirror});
}

function leg(ctx, side) {
  const {g, j, P} = ctx;
  const s = side === 'l' ? 'L' : 'R';
  const bottom = ctx.p.outfit.bottom;
  const skirt = bottom !== 'trousers';
  const legColor = 'bottom';
  const mirror = side === 'r';
  const shorts = bottom === 'shorts';
  const prosthetic = side === 'l' && ctx.p.mobility === 'prosthetic-leg';
  // Shoes point outward: the shoe is drawn mirrored inside the leg's frame.
  const shoe = P.within({mirror: !mirror}, () => P.shape(`M${r1(-g.legW * 0.55)} ${r1(g.shin - 6)}C${r1(-g.legW * 0.6)} ${r1(g.shin - 30)} ${r1(g.legW * 0.1)} ${r1(g.shin - 30)} ${r1(g.legW * 0.35)} ${r1(g.shin - 10)}C${r1(g.legW * 0.9)} ${r1(g.shin - 4)} ${r1(g.legW * 0.95)} ${r1(g.shin + g.foot)} ${r1(g.legW * 0.5)} ${r1(g.shin + g.foot)}L${r1(-g.legW * 0.5)} ${r1(g.shin + g.foot)}C${r1(-g.legW * 0.75)} ${r1(g.shin + g.foot)} ${r1(-g.legW * 0.75)} ${r1(g.shin + 4)} ${r1(-g.legW * 0.55)} ${r1(g.shin - 6)}Z`, 'shoes'));
  const shin = joint(ctx, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, P.within({mirror}, () => [
    ...(prosthetic ? prostheticShin(ctx, legColor) : P.limb(g.shin - 10, g.legW * 0.9, shorts ? 'skin' : legColor)),
    ...(skirt ? [] : [P.line(`M${r1(-g.legW * 0.42)} ${r1(g.shin - 16)}L${r1(g.legW * 0.42)} ${r1(g.shin - 16)}`, 'bottomShade', 5)]),
    group([shoe], {transform: 'scale(-1 1)'})
  ]));
  const thigh = P.within({mirror}, () => (shorts
    ? [...P.limb(g.thigh, g.legW * 0.94, 'skin'), ...P.limb(g.thigh * 0.62, g.legW + 4, legColor, -6), P.line(`M${r1(-g.legW * 0.5)} ${r1(g.thigh * 0.62)}L${r1(g.legW * 0.5)} ${r1(g.thigh * 0.62)}`, 'bottomShade', 6)]
    : P.limb(g.thigh, bottom === 'leggings' ? g.legW * 0.94 : g.legW, legColor)));
  return joint(ctx, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY + 10, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, ...thigh], {mirror});
}

// ---------------------------------------------------------------------------
// Torso and outfit (torso frame: pivot at the hip centre, up is negative)

export function torsoPath(g) {
  const {shoulder: S, waist: W, hip: H, torso: T} = g;
  const r = 30;
  const belly = Math.max(0, W - S) + 6;
  return `M${-S + r} ${-T}L${S - r} ${-T}Q${S} ${-T} ${S} ${-T + r}C${S + belly * 0.4} ${r1(-T * 0.62)} ${W + belly * 0.5} ${r1(-T * 0.3)} ${H} ${-8}L${H} 14Q${H} 22 ${H - 10} 22L${-H + 10} 22Q${-H} 22 ${-H} 14L${-H} -8C${-W - belly * 0.5} ${r1(-T * 0.3)} ${-S - belly * 0.4} ${r1(-T * 0.62)} ${-S} ${-T + r}Q${-S} ${-T} ${-S + r} ${-T}Z`;
}

export function outfit(ctx) {
  const {g, p, P} = ctx;
  const T = g.torso;
  const top = p.outfit.top;
  const parts = [];
  const neck = 26;
  if (top === 'tee' || top === 'dress') {
    parts.push(P.shape(`M${-neck} ${-T + 1}Q0 ${-T + 34} ${neck} ${-T + 1}`, 'skin', {width: 6}));
  } else if (top === 'sweater') {
    parts.push(P.shape(`M${-neck - 4} ${-T + 1}Q0 ${-T + 38} ${neck + 4} ${-T + 1}`, 'skin', {width: 6}));
    parts.push(P.line(`M${-neck - 6} ${-T + 4}Q0 ${-T + 42} ${neck + 6} ${-T + 4}`, 'topShade', 9));
    parts.push(P.line(`M${-g.hip + 8} 4L${g.hip - 8} 4`, 'topShade', 9));
  } else if (top === 'shirt') {
    parts.push(P.shape(`M${-neck + 4} ${-T + 1}L0 ${-T + 30}L${neck - 4} ${-T + 1}Z`, 'skin', {width: 5}));
    parts.push(P.shape(`M${-neck - 6} ${-T - 4}L${-6} ${-T + 26}L${-neck - 16} ${-T + 22}Z`, 'topLight', {width: 5}));
    parts.push(P.shape(`M${neck + 6} ${-T - 4}L${6} ${-T + 26}L${neck + 16} ${-T + 22}Z`, 'topLight', {width: 5}));
    parts.push(P.line(`M0 ${-T + 34}L0 ${-14}`, 'topShade', 4));
    for (const y of [-T + 70, -T + 140, -T + 210]) parts.push(P.ellipse(0, y, 4, 4, 'topShade', {outline: false}));
  } else if (top === 'hoodie') {
    parts.push(P.shape(`M${-neck} ${-T + 1}Q0 ${-T + 30} ${neck} ${-T + 1}`, 'skin', {width: 6}));
    parts.push(P.shape(`M${-neck - 18} ${-T - 2}Q0 ${-T + 58} ${neck + 18} ${-T - 2}`, null, {stroke: 'topShade', width: 14}));
    parts.push(P.line(`M-14 ${-T + 30}L-16 ${-T + 96}`, 'accent', 5), P.line(`M14 ${-T + 30}L16 ${-T + 96}`, 'accent', 5));
    parts.push(P.shape(`M${-g.waist * 0.6} ${-T * 0.38}L${g.waist * 0.6} ${-T * 0.38}L${g.waist * 0.75} -10L${-g.waist * 0.75} -10Z`, 'topShade', {width: 5}));
  } else if (top === 'blazer') {
    parts.push(P.shape(`M${-neck - 6} ${-T}L0 ${-T * 0.42}L${neck + 6} ${-T}Z`, 'accent', {width: 5}));
    parts.push(P.shape(`M${-neck - 8} ${-T}L${-neck - 22} ${-T + 46}L${-12} ${-T + 60}L0 ${-T * 0.42}Z`, 'topShade', {width: 5}));
    parts.push(P.shape(`M${neck + 8} ${-T}L${neck + 22} ${-T + 46}L12 ${-T + 60}L0 ${-T * 0.42}Z`, 'topShade', {width: 5}));
    parts.push(P.ellipse(0, -T * 0.32, 5, 5, 'topShade', {outline: false}));
  } else parts.push(...newTop(ctx));
  parts.push(...overLayer(ctx), ...neckwear(ctx), ...bagStraps(ctx));
  if (p.accessories.includes('lanyard')) {
    parts.push(P.line(`M${-neck + 2} ${-T + 4}L-6 ${-T + 112}M${neck - 2} ${-T + 4}L6 ${-T + 112}`, 'accent', 5));
    parts.push(P.shape(`M-20 ${-T + 110}L20 ${-T + 110}L20 ${-T + 160}L-20 ${-T + 160}Z`, '#f7f5f0', {width: 5}));
    parts.push(P.line(`M-11 ${-T + 128}L11 ${-T + 128}`, 'accent', 6));
  }
  return parts;
}

function skirt(ctx) {
  const {g, p, P} = ctx;
  if (p.outfit.bottom !== 'skirt' && p.outfit.bottom !== 'long-skirt') return [];
  const fill = p.outfit.top === 'dress' ? 'top' : 'bottom';
  const long = p.outfit.bottom === 'long-skirt';
  const y0 = g.hipY - 6, y1 = long ? r1(g.hipY + (g.thigh + g.shin) * 0.86) : g.hipY + g.thigh * 0.82;
  const w0 = g.hip + 4, w1 = g.hip + (long ? 50 : 34);
  return [P.shape(`M${-w0} ${y0}L${w0} ${y0}L${w1} ${r1(y1 - 10)}Q${w1} ${r1(y1)} ${w1 - 12} ${r1(y1)}L${-w1 + 12} ${r1(y1)}Q${-w1} ${r1(y1)} ${-w1} ${r1(y1 - 10)}Z`, fill)];
}

function pelvis(ctx) {
  const {g, P} = ctx;
  if (ctx.p.outfit.bottom === 'skirt' || ctx.p.outfit.bottom === 'long-skirt') return [];
  const y = g.hipY, H = g.hip;
  return [P.shape(`M${-H} ${y - 20}L${H} ${y - 20}L${H} ${y + 30}Q${H} ${y + 58} ${g.legX} ${y + 58}L${-g.legX} ${y + 58}Q${-H} ${y + 58} ${-H} ${y + 30}Z`, 'bottom')];
}

// ---------------------------------------------------------------------------
// Head (head frame: pivot at the neck top, the head centre at (0, cy))

export function headShape(g) {
  const {rx, ry, cy} = g.head;
  // A soft egg: wider cheeks, a rounded chin.
  return `M0 ${r1(cy - ry)}C${r1(rx * 0.62)} ${r1(cy - ry)} ${rx} ${r1(cy - ry * 0.55)} ${rx} ${r1(cy - ry * 0.05)}C${rx} ${r1(cy + ry * 0.55)} ${r1(rx * 0.55)} ${r1(cy + ry)} 0 ${r1(cy + ry)}C${r1(-rx * 0.55)} ${r1(cy + ry)} ${-rx} ${r1(cy + ry * 0.55)} ${-rx} ${r1(cy - ry * 0.05)}C${-rx} ${r1(cy - ry * 0.55)} ${r1(-rx * 0.62)} ${r1(cy - ry)} 0 ${r1(cy - ry)}Z`;
}

export function ears(ctx) {
  const {g, p, P} = ctx;
  if (p.hair.style === 'headscarf') return [];
  const {rx, cy} = g.head;
  const out = [];
  for (const sx of [-1, 1]) {
    out.push(P.ellipse(sx * (rx - 2), cy + 14, 17, 23, 'skin'));
    out.push(P.line(`M${sx * (rx + 2)} ${cy + 4}Q${sx * (rx + 9)} ${cy + 14} ${sx * (rx + 2)} ${cy + 24}`, 'skinShade', 5));
    if (p.accessories.includes('earrings')) out.push(P.ellipse(sx * (rx + 1), cy + 44, 6, 6, 'accent', {width: 4}));
  }
  if (p.accessories.includes('hearing-aid')) out.push(P.shape(`M${rx + 6} ${cy - 10}Q${rx + 26} ${cy + 2} ${rx + 14} ${cy + 26}`, null, {stroke: 'accent', width: 9}));
  return out;
}

const hairFill = (ctx, d, extra) => ctx.P.shape(d, 'hair', extra);

/** Hair behind the head and body (drawn before the torso). */
export function hairBack(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const style = p.hair.style;
  const top = cy - ry;
  switch (style) {
    case 'afro': return [P.ellipse(0, cy - 30, rx * 1.42, ry * 1.18, 'hair')];
    case 'bob': return [hairFill(ctx, `M${-rx - 20} ${cy - 10}C${-rx - 26} ${top - 40} ${rx + 26} ${top - 40} ${rx + 20} ${cy - 10}L${rx + 22} ${cy + 66}Q${rx + 22} ${cy + 80} ${rx + 6} ${cy + 80}L${-rx - 6} ${cy + 80}Q${-rx - 22} ${cy + 80} ${-rx - 22} ${cy + 66}Z`)];
    case 'wavy': return [hairFill(ctx, `M${-rx - 18} ${cy - 10}C${-rx - 24} ${top - 40} ${rx + 24} ${top - 40} ${rx + 18} ${cy - 10}C${rx + 34} ${cy + 40} ${rx + 10} ${cy + 80} ${rx + 30} ${cy + 130}Q${rx} ${cy + 150} ${rx - 20} ${cy + 140}L${-rx + 20} ${cy + 140}Q${-rx} ${cy + 150} ${-rx - 30} ${cy + 130}C${-rx - 10} ${cy + 80} ${-rx - 34} ${cy + 40} ${-rx - 18} ${cy - 10}Z`)];
    case 'long': return [hairFill(ctx, `M${-rx - 16} ${cy - 10}C${-rx - 22} ${top - 40} ${rx + 22} ${top - 40} ${rx + 16} ${cy - 10}L${rx + 24} ${cy + 196}Q${rx + 24} ${cy + 210} ${rx + 8} ${cy + 210}L${-rx - 8} ${cy + 210}Q${-rx - 24} ${cy + 210} ${-rx - 24} ${cy + 196}Z`)];
    case 'braids': case 'locs': {
      const fat = style === 'locs' ? 22 : 15;
      const n = style === 'locs' ? 7 : 9;
      const len = style === 'locs' ? 150 : 200;
      const strands = [];
      for (let i = 0; i < n; i++) {
        const x = -rx - 6 + (i * (2 * rx + 12)) / (n - 1);
        strands.push(...P.strand(`M${r1(x)} ${cy - 20}L${r1(x * 1.12)} ${cy + len}`, 'hair', fat));
      }
      return [hairFill(ctx, `M${-rx - 14} ${cy}C${-rx - 20} ${top - 34} ${rx + 20} ${top - 34} ${rx + 14} ${cy}Z`), ...strands];
    }
    case 'ponytail': return [hairFill(ctx, `M${rx * 0.4} ${top + 10}C${rx + 60} ${top - 10} ${rx + 56} ${cy + 60} ${rx + 30} ${cy + 140}C${rx + 10} ${cy + 90} ${rx + 6} ${cy + 20} ${rx * 0.5} ${top + 30}Z`)];
    case 'bun': return [P.ellipse(0, top - 18, 42, 38, 'hair')];
    case 'headscarf': return [P.shape(`M${-rx - 22} ${cy - 20}C${-rx - 30} ${top - 46} ${rx + 30} ${top - 46} ${rx + 22} ${cy - 20}C${rx + 30} ${cy + 70} ${rx + 70} ${cy + 140} ${rx + 76} ${cy + 196}L${-rx - 76} ${cy + 196}C${-rx - 70} ${cy + 140} ${-rx - 30} ${cy + 70} ${-rx - 22} ${cy - 20}Z`, 'hair')];
    default: return newHairBack(ctx) ?? [];
  }
}

/** Hair over the head (drawn after the face). */
export function hairFront(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const top = cy - ry;
  const style = p.hair.style;
  const shine = (d) => P.line(d, 'hairLight', 7);
  switch (style) {
    case 'bald': return [P.line(`M${-rx * 0.35} ${top + 22}Q${-rx * 0.05} ${top + 12} ${rx * 0.2} ${top + 18}`, 'skinLight', 8)];
    case 'buzz': return [P.shape(`M${-rx + 2} ${cy - 14}C${-rx + 2} ${top - 50} ${rx - 2} ${top - 50} ${rx - 2} ${cy - 14}Q${rx * 0.4} ${cy - 56} 0 ${cy - 58}Q${-rx * 0.4} ${cy - 56} ${-rx + 2} ${cy - 14}Z`, 'hair', {outline: false, opacity: 0.92})];
    case 'short': return [hairFill(ctx, `M${-rx - 6} ${cy + 6}C${-rx - 12} ${top - 30} ${rx + 12} ${top - 30} ${rx + 6} ${cy + 6}L${rx - 6} ${cy - 18}C${rx * 0.5} ${cy - 44} ${-rx * 0.1} ${cy - 30} ${-rx * 0.36} ${cy - 56}C${-rx * 0.6} ${cy - 36} ${-rx + 4} ${cy - 30} ${-rx - 6} ${cy + 6}Z`), shine(`M${-rx * 0.2} ${top + 6}Q${rx * 0.25} ${top - 2} ${rx * 0.5} ${top + 16}`)];
    case 'sidepart': return [hairFill(ctx, `M${-rx - 6} ${cy + 8}C${-rx - 12} ${top - 32} ${rx + 12} ${top - 32} ${rx + 6} ${cy + 8}L${rx - 4} ${cy - 16}C${rx * 0.4} ${cy - 66} ${-rx * 0.2} ${cy - 56} ${-rx * 0.42} ${top + 18}C${-rx * 0.6} ${cy - 50} ${-rx + 2} ${cy - 36} ${-rx - 6} ${cy + 8}Z`), P.line(`M${-rx * 0.42} ${top + 18}Q${-rx * 0.38} ${top + 6} ${-rx * 0.3} ${top - 2}`, 'hairShade', 5)];
    case 'curly': {
      const bumps = [];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.05 + (i * 0.9) / 6);
        bumps.push(P.ellipse(Math.cos(a) * rx * 0.92, cy - 10 + Math.sin(a) * ry * 0.98, 30, 30, 'hair'));
      }
      return [hairFill(ctx, `M${-rx - 4} ${cy + 4}C${-rx - 10} ${top - 26} ${rx + 10} ${top - 26} ${rx + 4} ${cy + 4}C${rx * 0.6} ${cy - 40} ${-rx * 0.6} ${cy - 40} ${-rx - 4} ${cy + 4}Z`), ...bumps, P.ellipse(0, top + 18, 40, 26, 'hair', {outline: false})];
    }
    case 'afro': return [hairFill(ctx, `M${-rx - 2} ${cy + 10}C${-rx - 4} ${top - 70} ${rx + 4} ${top - 70} ${rx + 2} ${cy + 10}C${rx * 0.7} ${cy - 46} ${-rx * 0.7} ${cy - 46} ${-rx - 2} ${cy + 10}Z`, {width: 0, stroke: 'none'})];
    case 'pixie': return [hairFill(ctx, `M${-rx - 8} ${cy + 20}C${-rx - 14} ${top - 30} ${rx + 14} ${top - 30} ${rx + 8} ${cy + 4}C${rx * 0.3} ${cy - 20} ${-rx * 0.4} ${cy - 30} ${-rx * 0.72} ${cy - 6}C${-rx * 0.86} ${cy + 4} ${-rx * 0.9} ${cy + 14} ${-rx - 8} ${cy + 20}Z`), shine(`M${-rx * 0.1} ${top + 8}Q${rx * 0.3} ${top + 2} ${rx * 0.55} ${top + 20}`)];
    case 'bob': return [hairFill(ctx, `M${-rx - 10} ${cy + 30}C${-rx - 14} ${top - 30} ${rx + 14} ${top - 30} ${rx + 10} ${cy + 30}L${rx - 4} ${cy + 30}L${rx - 8} ${cy - 30}Q0 ${cy - 44} ${-rx + 8} ${cy - 30}L${-rx + 4} ${cy + 30}Z`), shine(`M${-rx * 0.3} ${top + 8}Q${rx * 0.1} ${top} ${rx * 0.4} ${top + 10}`)];
    case 'wavy': case 'long': return [hairFill(ctx, `M${-rx - 10} ${cy + 40}C${-rx - 16} ${top - 30} ${rx + 16} ${top - 30} ${rx + 10} ${cy + 40}L${rx - 2} ${cy + 40}C${rx - 4} ${cy - 10} ${rx * 0.6} ${cy - 40} ${rx * 0.06} ${top + 20}C${-rx * 0.5} ${cy - 40} ${-rx + 2} ${cy - 10} ${-rx + 2} ${cy + 40}Z`), shine(`M${-rx * 0.5} ${top + 16}Q${-rx * 0.2} ${top + 2} ${0} ${top + 4}`)];
    case 'ponytail': case 'bun': return [hairFill(ctx, `M${-rx - 6} ${cy + 6}C${-rx - 12} ${top - 28} ${rx + 12} ${top - 28} ${rx + 6} ${cy + 6}L${rx - 4} ${cy - 10}C${rx * 0.5} ${cy - 50} ${-rx * 0.5} ${cy - 50} ${-rx + 4} ${cy - 10}Z`), P.line(`M${-rx * 0.4} ${top + 16}Q0 ${top + 4} ${rx * 0.4} ${top + 16}`, 'hairShade', 5)];
    case 'braids': case 'locs': return [hairFill(ctx, `M${-rx - 8} ${cy + 10}C${-rx - 14} ${top - 30} ${rx + 14} ${top - 30} ${rx + 8} ${cy + 10}L${rx - 4} ${cy - 6}C${rx * 0.6} ${cy - 44} ${rx * 0.1} ${cy - 40} 0 ${top + 18}C${-rx * 0.1} ${cy - 40} ${-rx * 0.6} ${cy - 44} ${-rx + 4} ${cy - 6}Z`), P.line(`M0 ${top + 18}L0 ${top - 6}`, 'hairShade', 5)];
    case 'headscarf': {
      const face = `M0 ${r1(cy - ry * 0.78)}C${r1(rx * 0.62)} ${r1(cy - ry * 0.78)} ${r1(rx * 0.8)} ${r1(cy - ry * 0.3)} ${r1(rx * 0.8)} ${r1(cy + ry * 0.08)}C${r1(rx * 0.8)} ${r1(cy + ry * 0.6)} ${r1(rx * 0.45)} ${r1(cy + ry * 0.92)} 0 ${r1(cy + ry * 0.92)}C${r1(-rx * 0.45)} ${r1(cy + ry * 0.92)} ${r1(-rx * 0.8)} ${r1(cy + ry * 0.6)} ${r1(-rx * 0.8)} ${r1(cy + ry * 0.08)}C${r1(-rx * 0.8)} ${r1(cy - ry * 0.3)} ${r1(-rx * 0.62)} ${r1(cy - ry * 0.78)} 0 ${r1(cy - ry * 0.78)}Z`;
      const outer = `M${-rx - 20} ${cy}C${-rx - 26} ${top - 40} ${rx + 26} ${top - 40} ${rx + 20} ${cy}C${rx + 22} ${cy + 70} ${rx * 0.5} ${cy + ry + 36} 0 ${cy + ry + 40}C${-rx * 0.5} ${cy + ry + 36} ${-rx - 22} ${cy + 70} ${-rx - 20} ${cy}Z`;
      return [P.shape(`${outer}${face}`, 'hair', {rule: 'evenodd'}), P.line(`M${r1(-rx * 0.7)} ${r1(top - 6)}Q0 ${r1(top - 22)} ${r1(rx * 0.7)} ${r1(top - 6)}`, 'hairLight', 7)];
    }
    default: return newHairFront(ctx) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Faces

const EYE_X = 31;

function eyes(kind, P) {
  const out = [];
  for (const sx of [-1, 1]) {
    const x = sx * EYE_X;
    if (kind === 'dot') out.push(P.ellipse(x, 0, 9.5, 12, 'outline', {outline: false}), P.ellipse(x + 3, -4, 3.2, 3.2, '#ffffff', {outline: false}));
    else if (kind === 'wide') out.push(P.ellipse(x, 0, 15, 17, 'eyeWhite', {width: 4.5}), P.ellipse(x, 1, 8, 8.5, 'outline', {outline: false}), P.ellipse(x + 3, -3, 2.6, 2.6, '#ffffff', {outline: false}));
    else if (kind === 'happy') out.push(P.line(`M${x - 12} 5Q${x} -12 ${x + 12} 5`, 'outline', 6.5));
    else if (kind === 'narrow') out.push(P.ellipse(x, 2, 9.5, 7, 'outline', {outline: false}), P.line(`M${x - 13} ${sx < 0 ? -8 : -3}L${x + 13} ${sx < 0 ? -3 : -8}`, 'outline', 5.5));
    else if (kind === 'squint') out.push(P.ellipse(x, 1, 9, 8.5, 'outline', {outline: false}), P.ellipse(x + 3, -2, 2.6, 2.6, '#ffffff', {outline: false}), P.line(`M${x - 12} -6L${x + 12} -6`, 'outline', 5));
  }
  return out;
}

function brows(spec, P, browColor, cy) {
  return spec.map((brow, i) => {
    const sx = i === 0 ? -1 : 1;
    const tilt = brow.tilt * (sx < 0 ? 1 : -1);
    return group([P.line('M-13 3Q0 -4 13 3', browColor, 7.5)], {transform: `translate(${sx * EYE_X} ${r1(cy - 22 - brow.lift)}) rotate(${tilt})`});
  });
}

const MOUTHS = {
  soft: P => [P.line('M-14 0Q0 9 14 0', 'outline', 6)],
  smile: P => [P.line('M-24 -3Q0 19 24 -3', 'outline', 6.5)],
  grin: P => [P.line('M-28 -6Q0 24 28 -6', 'outline', 7), P.line('M-31 -9L-26 -4M31 -9L26 -4', 'outline', 5)],
  flat: P => [P.line('M-13 2L13 2', 'outline', 6)],
  frown: P => [P.line('M-20 9Q0 -6 20 9', 'outline', 6.5)],
  wavy: P => [P.line('M-18 2Q-9 -6 0 2Q9 10 18 2', 'outline', 5.5)],
  o: P => [P.ellipse(0, 2, 9, 11, 'mouth', {width: 5})],
  small: P => [P.ellipse(0, 2, 12, 10, 'mouth', {width: 5}), P.ellipse(0, 7, 6, 3.5, 'tongue', {outline: false})],
  grin_open: P => [P.shape('M-26 -5Q0 36 26 -5Z', 'mouth', {width: 5.5}), P.shape('M-21 -3L21 -3L18 5L-18 5Z', 'teeth', {outline: false}), P.ellipse(0, 15, 10, 5, 'tongue', {outline: false})],
  laugh: P => [P.shape('M-32 -7Q0 46 32 -7Z', 'mouth', {width: 6}), P.shape('M-27 -5L27 -5L23 4L-23 4Z', 'teeth', {outline: false}), P.ellipse(0, 22, 13, 7, 'tongue', {outline: false})],
  grimace: P => [P.shape('M-24 -8L24 -8Q28 -8 28 -2L28 6Q28 12 24 12L-24 12Q-28 12 -28 6L-28 -2Q-28 -8 -24 -8Z', 'teeth', {width: 5}), P.line('M-26 2L26 2', 'outline', 3.5)],
  side: P => [P.ellipse(8, 2, 10, 8, 'mouth', {width: 5})],
  gasp: P => [P.ellipse(0, 4, 15, 19, 'mouth', {width: 5.5}), P.ellipse(0, 14, 8, 5, 'tongue', {outline: false})]
};
const mouthShape = (name, P) => (MOUTHS[name] ?? MOUTHS.soft)(P);

export function face(ctx, name) {
  const {g, p, P} = ctx;
  const {cy} = g.head;
  const parts = expressionParts(name);
  const browColor = p.hair.style === 'headscarf' ? 'browDark' : GREY_HAIR.includes(p.hair.color) ? 'hairShade' : 'mixBrow';
  const eyeGroup = joint(ctx, `eyes-${name}`, 0, cy + 10, {}, eyes(parts.eyes, P));
  const kids = [];
  if (parts.blush) for (const sx of [-1, 1]) kids.push(P.ellipse(sx * 52, cy + 36, 15, 9, 'blush', {outline: false, opacity: 0.55}));
  kids.push(eyeGroup, ...brows(parts.brows, P, browColor, cy));
  const mouthY = cy + 47;
  const closed = group(mouthShape(parts.mouth.closed, P), {transform: `translate(0 ${mouthY})`});
  const open = group(mouthShape(parts.mouth.open === 'grin' ? 'grin_open' : parts.mouth.open, P), {transform: `translate(0 ${mouthY})`});
  const show = ctx.expression === name ? 1 : 0;
  if (ctx.static) return show ? group([...kids, closed]) : null;
  return el('g', `${ctx.id}-face-${name}`, {opacity: show}, [
    ...kids,
    el('g', `${ctx.id}-mouth-${name}`, {opacity: show}, [closed]),
    el('g', `${ctx.id}-open-${name}`, {opacity: 0}, [open])
  ]);
}

/**
 * The face's marks and facial hair. jaw: undefined draws them all; 'only'
 * just the hair that follows the jaw (beard, stubble), which stays on the
 * head when the face turns to look (turnedHead); 'none' all but that.
 */
export function facial(ctx, {jaw: part} = {}) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const out = [];
  const marks = part !== 'only', jawHair = part !== 'none';
  if (marks && p.accessories.includes('freckles')) for (const [x, y] of [[-48, 26], [-38, 32], [-56, 34], [48, 26], [38, 32], [56, 34]]) out.push(P.ellipse(x, cy + y, 2.6, 2.6, 'skinShade', {outline: false}));
  // Beards follow the jaw below the cheeks; the mouth stays clear so the
  // face still acts.
  const jaw = (side, chin, inner) => `M${-rx + 3} ${cy + side}C${-rx + 2} ${cy + 80} ${-44} ${cy + ry + chin} 0 ${cy + ry + chin}C44 ${cy + ry + chin} ${rx - 2} ${cy + 80} ${rx - 3} ${cy + side}L${rx - 16} ${cy + side + 8}C${rx - 22} ${cy + 46} 40 ${cy + inner} 0 ${cy + inner}C-40 ${cy + inner} ${-rx + 22} ${cy + 46} ${-rx + 16} ${cy + side + 8}Z`;
  const hole = `M-29 ${cy + 47}C-29 ${cy + 35} 29 ${cy + 35} 29 ${cy + 47}C29 ${cy + 64} -29 ${cy + 64} -29 ${cy + 47}Z`;
  if (jawHair && p.accessories.includes('beard')) out.push(P.shape(`${jaw(40, 6, 38)}${hole}`, 'hair', {rule: 'evenodd'}));
  if (jawHair && p.accessories.includes('stubble')) out.push(P.shape(`${jaw(46, 0, 42)}${hole}`, 'stubble', {outline: false, rule: 'evenodd', opacity: 0.55}));
  if (!marks) return out;
  if (p.accessories.includes('moustache')) out.push(P.shape(`M-27 ${cy + 40}Q-13 ${cy + 27} 0 ${cy + 34}Q13 ${cy + 27} 27 ${cy + 40}Q13 ${cy + 45} 0 ${cy + 40}Q-13 ${cy + 45} -27 ${cy + 40}Z`, 'hair', {width: 5}));
  out.push(P.line(`M-3 ${cy + 14}Q7 ${cy + 26} -4 ${cy + 30}`, 'skinShade', 5.5));
  return out;
}

export function glasses(ctx) {
  const {g, p, P} = ctx;
  const cy = g.head.cy + 10;
  const frame = {stroke: 'outline', width: 5.5, fillOpacity: 0.18};
  if (p.accessories.includes('glasses')) {
    return [
      P.shape(`M-53 ${cy - 16}L-11 ${cy - 16}Q-9 ${cy - 16} -9 ${cy - 13}L-11 ${cy + 10}Q-12 ${cy + 16} -18 ${cy + 16}L-46 ${cy + 16}Q-52 ${cy + 16} -53 ${cy + 10}Z`, '#ffffff', frame),
      P.shape(`M53 ${cy - 16}L11 ${cy - 16}Q9 ${cy - 16} 9 ${cy - 13}L11 ${cy + 10}Q12 ${cy + 16} 18 ${cy + 16}L46 ${cy + 16}Q52 ${cy + 16} 53 ${cy + 10}Z`, '#ffffff', frame),
      P.line(`M-9 ${cy - 8}Q0 ${cy - 13} 9 ${cy - 8}`, 'outline', 5)
    ];
  }
  if (p.accessories.includes('sunglasses') || p.accessories.includes('cat-eye-glasses')) return newGlasses(ctx);
  if (p.accessories.includes('round-glasses')) {
    return [P.ellipse(-EYE_X, cy, 21, 20, '#ffffff', {width: 5.5, fillOpacity: 0.18}), P.ellipse(EYE_X, cy, 21, 20, '#ffffff', {width: 5.5, fillOpacity: 0.18}), P.line(`M-10 ${cy - 4}Q0 ${cy - 10} 10 ${cy - 4}`, 'outline', 5)];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The whole character

/** The character's colours plus the few the toon face derives. */
export function toonColors(colors) {
  return {...colors, mixBrow: colors.hairShade, browDark: '#33241c', stubble: mixColor(colors.hair, colors.skinShade, 0.35), accentLight: mixColor('#ffffff', colors.accent, 0.25)};
}

/**
 * Draw one toon character with a pen.
 *   params      normalised rig params (rig.mjs normalizeRigParams)
 *   colors      resolved colours (palette.mjs characterColors)
 *   options.id  DOM id prefix for its parts
 *   options.joints      initial joint values (rig.mjs poseJoints)
 *   options.expression  the expression shown first
 *   options.expressions every expression the scene uses (each gets a face)
 *   options.props       {l?, r?}: shapes held in that hand (hand at the origin)
 *   options.static      true: transforms as SVG attributes, only the shown
 *                       face drawn (cast sheets); false: CSS transforms the
 *                       op list animates
 *   makePen     (colors, {id}) → pen
 * → node: a <g> with the feet at (0, 0).
 */
export function drawToon(params, colors, {id, joints, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null, facing = 'right', light = null, gaze = false, turns = false}, makePen) {
  const g = rigGeometry(params);
  const c = toonColors(colors);
  const P = makePen(c, {id, light});
  const ctx = {id, g, c, p: params, j: joints, expression, static: isStatic, props, P, facing};
  const faceNodes = [...new Set([expression, ...expressions])].map(name => face(ctx, name)).filter(Boolean);
  const {jaw, features} = faceParts(ctx, gaze, () => [...faceNodes, ...glasses(ctx)]);
  const headKids = [
    ...ears(ctx),
    ...turnJoint(ctx, joints, gaze, [
      asHead(P.shape(headShape(g), 'skin')),
      ...faceView(ctx, turns, [...jaw, ...gazeJoint(ctx, joints, gaze, features)]),
      ...(covers(params) ? [] : hairFront(ctx)),
      ...backView(ctx, turns, () => backOfHead(ctx)),
      ...headwear(ctx)
    ])
  ];
  const tilt = {rotation: joints.head, y: joints.headY};
  const headIdle = joint(ctx, 'headidle', 0, 0, {}, headKids);
  const backIdle = joint(ctx, 'hbidle', 0, 0, {}, params.headwear === 'turban' ? [] : hairBack(ctx));
  const neckTop = g.neckY;
  const torsoKids = [
    joint(ctx, 'hb', 0, neckTop, tilt, [backIdle]),
    P.shape(`M-19 ${neckTop - 6}L19 ${neckTop - 6}L19 ${-g.torso + 14}L-19 ${-g.torso + 14}Z`, 'skin'),
    P.line(`M-17 ${-g.torso + 4}Q0 ${-g.torso + 12} 17 ${-g.torso + 4}`, 'skinShade', 8),
    ...backpackBack(ctx),
    P.shape(torsoPath(g), 'top'),
    ...longHem(ctx),
    ...frontView(ctx, turns, outfit(ctx)),
    joint(ctx, 'head', 0, neckTop, tilt, [headIdle]),
    arm(ctx, 'l'),
    arm(ctx, 'r')
  ];
  const breath = joint(ctx, 'breath', 0, 0, {}, torsoKids);
  const torso = joint(ctx, 'torso', 0, g.hipY, {rotation: joints.lean, scaleY: joints.squash}, [breath]);
  const body = joint(ctx, 'body', 0, 0, {y: joints.bodyY}, [leg(ctx, 'l'), leg(ctx, 'r'), ...pelvis(ctx), ...skirt(ctx), torso]);
  const ground = asShadow(P.ground());
  const chair = params.mobility === 'wheelchair' ? wheelchair(ctx) : [];
  // Defs last: the pen gathers gradients while drawing every other part.
  const defs = P.defs ? P.defs() : [];
  return group([...defs, ...ground, ...chair, body]);
}

/**
 * How a look (the gaze offset, actions.mjs GAZE, in toon head units) turns
 * the head: a share of it moves the head itself toward the target (`turn`:
 * head across, nod up or down), and a further share moves the features
 * across the face (`gaze`, inside the turn; never up or down, so the mouth
 * keeps clear of the chin). The face share stays well short of the face's
 * edge, so every feature keeps inside the head's outline at the widest look,
 * in every style.
 */
export const HEAD_TURN = Object.freeze({head: 0.35, nod: 0.5, face: 0.4});

/** Marks a node as the head's outline (for bounds checks); a symbol, so drawings stay byte-identical. */
export const HEAD = Symbol('character-head');
export const asHead = node => (node && typeof node === 'object' ? Object.assign(node, {[HEAD]: true}) : node);

const k3 = value => Math.round(value * 1000) / 1000;

// A joint at the head's origin whose animated offset counts a share of its
// value ({x, y}): a static scale round the joint, undone inside it. Both
// renderers apply group scales the same way (view.mjs), so the op list is
// the same for every style.
function sharedJoint(ctx, part, share, values, children) {
  const kx = k3(share.x), ky = k3(share.y);
  if (kx === 1 && ky === 1) return joint(ctx, part, 0, 0, values, children);
  const undo = value => Math.round(10000 / value) / 10000;
  return group([joint(ctx, part, 0, 0, values, [group(children, {transform: `scale(${undo(kx)} ${undo(ky)})`})])], {transform: `scale(${kx} ${ky})`});
}

/**
 * The head of a character with a target turns toward it: everything drawn
 * on the head (outline, the face, hair over it, headwear) sits on a `turn`
 * joint that moves HEAD_TURN.head of the gaze across and HEAD_TURN.nod of it
 * up or down. The ears stay where they are, so the far ear slips behind the
 * turned head and the near one shows, as a real turn does. size: the head's
 * width over the toon head's (the gaze is measured on the toon head).
 * Without a gaze, the parts as before.
 */
export function turnJoint(ctx, joints, on, parts, size = 1) {
  return on ? [sharedJoint(ctx, 'turn', {x: HEAD_TURN.head * size, y: HEAD_TURN.nod * size}, {x: joints.gazeX ?? 0, y: joints.gazeY ?? 0}, parts)] : parts;
}

/**
 * The face's features on a `gaze` joint (a character with a target), inside
 * the turned head: they move HEAD_TURN.face of the gaze further across the
 * face toward what it looks at, narrowed for a three-quarter view
 * (gazeScale). size as turnJoint. Without a gaze the features are drawn as
 * before.
 */
export function gazeJoint(ctx, joints, on, features, size = 1) {
  return on ? [sharedJoint(ctx, 'gaze', {x: HEAD_TURN.face * size, y: 1}, {x: joints.gazeX ?? 0, scaleX: joints.gazeScale ?? 1}, features)] : features;
}

/**
 * The face's parts for a look: hair on the jaw separately (it stays on the
 * turned head, at its edge) from the features that move across the face.
 * Without a gaze, all in the features, drawn in the order they always were.
 * then(): the parts drawn after (faces, glasses).
 */
export function faceParts(ctx, on, then = () => []) {
  if (!on) return {jaw: [], features: [...facial(ctx), ...faceExtras(ctx), ...then()]};
  const jaw = [...facial(ctx, {jaw: 'only'}), ...faceExtras(ctx, {jaw: 'only'})];
  return {jaw, features: [...facial(ctx, {jaw: 'none'}), ...faceExtras(ctx, {jaw: 'none'}), ...then()]};
}

/**
 * The back of the head, for a character seen from behind (a look into the
 * distance): the head in skin with the hair over it down to the nape, which
 * covers the face. Bald heads stay skin.
 */
export function backOfHead(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const parts = [P.shape(headShape(g), 'skin')];
  if (p.hair.style !== 'bald') {
    // Hair over the whole back of the head down to a low nape, so no bare
    // oval reads as a face; a balding crown keeps a skin patch on top.
    const nape = r1(cy + ry * 0.72);
    parts.push(P.shape(`M${-rx - 4} ${r1(cy + ry * 0.45)}C${-rx - 5} ${r1(cy - ry * 0.6)} ${r1(-rx * 0.62)} ${r1(cy - ry - 6)} 0 ${r1(cy - ry - 6)}C${r1(rx * 0.62)} ${r1(cy - ry - 6)} ${rx + 5} ${r1(cy - ry * 0.6)} ${rx + 4} ${r1(cy + ry * 0.45)}C${r1(rx * 0.7)} ${nape} ${r1(-rx * 0.7)} ${nape} ${-rx - 4} ${r1(cy + ry * 0.45)}Z`, 'hair'));
    if (p.hair.style === 'balding') parts.push(P.ellipse(0, r1(cy - ry * 0.55), r1(rx * 0.5), r1(ry * 0.3), 'skin', {outline: false}));
  }
  // The nape's shadow line where the head meets the neck.
  parts.push(P.line(`M${r1(-rx * 0.35)} ${r1(cy + ry * 0.86)}Q0 ${r1(cy + ry * 0.94)} ${r1(rx * 0.35)} ${r1(cy + ry * 0.86)}`, 'skinShade', 5));
  return parts;
}

/**
 * View groups for a character that turns away (actor.turns): the back of
 * the head over the face, hidden until the turn ({id}-back), and the front
 * details of the clothes (tie, buttons, pockets) shown until it ({id}-front).
 * A character that never turns draws as before.
 */
export function backView(ctx, on, draw) {
  if (!on || ctx.static) return [];
  return [el('g', `${ctx.id}-back`, {opacity: 0}, draw())];
}

/** The face (features, beard, glasses) of a character that turns away: hidden from behind ({id}-face-front). */
export function faceView(ctx, on, parts) {
  if (!on || ctx.static) return parts;
  return [el('g', `${ctx.id}-face-front`, {opacity: 1}, parts)];
}

export function frontView(ctx, on, parts) {
  if (!on || ctx.static) return parts;
  return [el('g', `${ctx.id}-front`, {opacity: 1}, parts)];
}

/**
 * A held cane's length from the hand to the floor, with the arm at its rest
 * angle (acting.mjs keeps the aid's arm there).
 */
export function caneLength(g) {
  const a = 10 * Math.PI / 180;
  const handY = g.hipY + g.armY + g.upperArm * Math.cos(8 * Math.PI / 180) + (g.foreArm + g.hand * 0.35) * Math.cos(a);
  return Math.max(120, -handY / Math.cos(a));
}

/** Height of the drawn character above the feet, in rig units (with hair). */
export function toonHeight(params) {
  const g = rigGeometry(params);
  const extra = {afro: 70, bun: 70, curly: 24, mohawk: 74, spiky: 44, quiff: 52, topknot: 38, 'space-buns': 36}[params.hair.style] ?? 14;
  const hat = {'chef-hat': 150, 'grad-cap': 30, 'beanie': 34, 'bike-helmet': 30, 'hard-hat': 26, 'turban': 40, 'headphones': 24}[params.headwear] ?? 0;
  return Math.round(g.height + Math.max(extra, hat));
}
