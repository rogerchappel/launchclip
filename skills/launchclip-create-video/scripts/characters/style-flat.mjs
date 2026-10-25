// Drawing style "flat": flat fills with a dark outline, rounded limbs and a
// simple friendly face. One function draws any rig params; the rig (rig.mjs)
// supplies the measurements, so builds and heights share every shape.
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
//   C-face-<expression>, C-eyes-<expression> (blinks),
//   C-mouth-<expression> / C-open-<expression> (closed / open mouth)
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {mixColor} from '../catalog-b-base.mjs';
import {expressionParts, rigGeometry} from './rig.mjs';

const OUT = 7;
const r1 = value => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Primitives

const path = (d, fill, c, extra = {}) => el('path', null, null, [], {d, fill: fill ?? 'none', stroke: c === null ? 'none' : (extra.stroke ?? c.outline), strokeWidth: extra.width ?? OUT, strokeLinejoin: 'round', strokeLinecap: 'round', ...(extra.opacity !== undefined ? {opacity: extra.opacity} : {}), ...(extra.rule ? {fillRule: extra.rule} : {})});
const line = (d, color, width) => el('path', null, null, [], {d, fill: 'none', stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round'});
const ellipse = (cx, cy, rx, ry, fill, c, extra = {}) => el('ellipse', null, null, [], {cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, stroke: c === null ? 'none' : (extra.stroke ?? c.outline), strokeWidth: extra.width ?? OUT, ...(extra.opacity !== undefined ? {opacity: extra.opacity} : {})});
const group = (children, attrs) => el('g', null, null, children, attrs);

/** An outlined capsule from (0, 0) to (0, length). */
function capsule(length, width, fill, c, from = 0) {
  const d = `M0 ${r1(from)}L0 ${r1(length)}`;
  return [line(d, c.outline, width + OUT * 2), line(d, fill, width)];
}

/**
 * A joint: the pivot at (x, y) in the parent's frame, then the animated
 * part. In static mode it is a pair of SVG groups with attribute transforms
 * (quick sheets); otherwise a `joint` node that view.mjs turns into divs
 * the op list animates.
 */
function joint(ctx, part, x, y, values, children, {mirror = false} = {}) {
  const id = part ? `${ctx.id}-${part}` : null;
  const transform = {x: values.x ?? 0, y: values.y ?? 0, rotation: values.rotation ?? 0, scaleX: values.scaleX ?? 1, scaleY: values.scaleY ?? 1};
  if (!ctx.static) return {tag: 'joint', id, pivot: {x: r1(x), y: r1(y), mirror}, transform, children};
  const inner = group(children, {...(id ? {id} : {}), transform: svgTransform(transform)});
  return group([inner], {transform: `translate(${r1(x)} ${r1(y)})${mirror ? ' scale(-1 1)' : ''}`});
}

/** SVG attribute form of transformString() (same order: translate, rotate, scale). */
export function svgTransform({x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1}) {
  let out = `translate(${r1(x)} ${r1(y)})`;
  if (rotation) out += ` rotate(${r1(rotation)})`;
  if (scaleX !== 1 || scaleY !== 1) out += ` scale(${scaleX} ${scaleY})`;
  return out;
}

// ---------------------------------------------------------------------------
// Limbs

const LONG_SLEEVES = new Set(['shirt', 'hoodie', 'blazer', 'sweater']);

function arm(ctx, side) {
  const {g, c, p, j} = ctx;
  const s = side === 'l' ? 'L' : 'R';
  const long = LONG_SLEEVES.has(p.outfit.top);
  const sleeve = c.top;
  const hand = g.hand;
  const finger = joint(ctx, `finger-${side}`, 0, g.foreArm + hand * 0.6, {}, [
    ...capsule(hand * 1.25, 15, c.skin, c)
  ]);
  const fingerWrap = ctx.static ? (j[`finger${s}`] ? finger : null) : el('g', `${ctx.id}-fingerwrap-${side}`, {opacity: j[`finger${s}`]}, [finger]);
  const fore = joint(ctx, `fore-${side}`, 0, g.upperArm, {rotation: j[`fore${s}`]}, [
    ...capsule(g.foreArm, g.armW * 0.9, long ? sleeve : c.skin, c),
    ...(long ? [line(`M${r1(-g.armW * 0.45)} ${r1(g.foreArm - 6)}L${r1(g.armW * 0.45)} ${r1(g.foreArm - 6)}`, c.topShade, 6)] : []),
    ...(fingerWrap ? [fingerWrap] : []),
    ellipse(0, g.foreArm + hand * 0.35, hand, hand * 1.04, c.skin, c),
    ...(ctx.props?.[side] ? [group(ctx.props[side], {transform: `translate(0 ${r1(g.foreArm + hand * 0.35)})`})] : [])
  ]);
  const upper = long
    ? capsule(g.upperArm, g.armW, sleeve, c)
    : [...capsule(g.upperArm, g.armW * 0.92, c.skin, c), ...capsule(g.upperArm * 0.5, g.armW + 8, sleeve, c, -4)];
  return joint(ctx, `arm-${side}`, side === 'l' ? -g.armX : g.armX, g.armY, {rotation: j[`arm${s}`], y: j.shoulderY}, [...upper, fore], {mirror: side === 'r'});
}

function leg(ctx, side) {
  const {g, c, j} = ctx;
  const s = side === 'l' ? 'L' : 'R';
  const skirt = ctx.p.outfit.bottom === 'skirt';
  const legColor = c.bottom;
  const shoe = path(`M${r1(-g.legW * 0.55)} ${r1(g.shin - 6)}C${r1(-g.legW * 0.6)} ${r1(g.shin - 30)} ${r1(g.legW * 0.1)} ${r1(g.shin - 30)} ${r1(g.legW * 0.35)} ${r1(g.shin - 10)}C${r1(g.legW * 0.9)} ${r1(g.shin - 4)} ${r1(g.legW * 0.95)} ${r1(g.shin + g.foot)} ${r1(g.legW * 0.5)} ${r1(g.shin + g.foot)}L${r1(-g.legW * 0.5)} ${r1(g.shin + g.foot)}C${r1(-g.legW * 0.75)} ${r1(g.shin + g.foot)} ${r1(-g.legW * 0.75)} ${r1(g.shin + 4)} ${r1(-g.legW * 0.55)} ${r1(g.shin - 6)}Z`, c.shoes, c);
  // Shoes point outward: mirror the shoe on the left leg.
  const shin = joint(ctx, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, [
    ...capsule(g.shin - 10, g.legW * 0.9, legColor, c),
    ...(skirt ? [] : [line(`M${r1(-g.legW * 0.42)} ${r1(g.shin - 16)}L${r1(g.legW * 0.42)} ${r1(g.shin - 16)}`, c.bottomShade, 5)]),
    group([shoe], {transform: 'scale(-1 1)'})
  ]);
  return joint(ctx, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY + 10, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, ...capsule(g.thigh, g.legW, legColor, c)], {mirror: side === 'r'});
}

// ---------------------------------------------------------------------------
// Torso and outfit (torso frame: pivot at the hip centre, up is negative)

function torsoPath(g) {
  const {shoulder: S, waist: W, hip: H, torso: T} = g;
  const r = 30;
  const belly = Math.max(0, W - S) + 6;
  return `M${-S + r} ${-T}L${S - r} ${-T}Q${S} ${-T} ${S} ${-T + r}C${S + belly * 0.4} ${r1(-T * 0.62)} ${W + belly * 0.5} ${r1(-T * 0.3)} ${H} ${-8}L${H} 14Q${H} 22 ${H - 10} 22L${-H + 10} 22Q${-H} 22 ${-H} 14L${-H} -8C${-W - belly * 0.5} ${r1(-T * 0.3)} ${-S - belly * 0.4} ${r1(-T * 0.62)} ${-S} ${-T + r}Q${-S} ${-T} ${-S + r} ${-T}Z`;
}

function outfit(ctx) {
  const {g, c, p} = ctx;
  const T = g.torso;
  const top = p.outfit.top;
  const parts = [];
  const neck = 26;
  if (top === 'tee' || top === 'dress') {
    parts.push(path(`M${-neck} ${-T + 1}Q0 ${-T + 34} ${neck} ${-T + 1}`, c.skin, c, {width: 6}));
  } else if (top === 'sweater') {
    parts.push(path(`M${-neck - 4} ${-T + 1}Q0 ${-T + 38} ${neck + 4} ${-T + 1}`, c.skin, c, {width: 6}));
    parts.push(line(`M${-neck - 6} ${-T + 4}Q0 ${-T + 42} ${neck + 6} ${-T + 4}`, c.topShade, 9));
    parts.push(line(`M${-g.hip + 8} 4L${g.hip - 8} 4`, c.topShade, 9));
  } else if (top === 'shirt') {
    parts.push(path(`M${-neck + 4} ${-T + 1}L0 ${-T + 30}L${neck - 4} ${-T + 1}Z`, c.skin, c, {width: 5}));
    parts.push(path(`M${-neck - 6} ${-T - 4}L${-6} ${-T + 26}L${-neck - 16} ${-T + 22}Z`, c.topLight, c, {width: 5}));
    parts.push(path(`M${neck + 6} ${-T - 4}L${6} ${-T + 26}L${neck + 16} ${-T + 22}Z`, c.topLight, c, {width: 5}));
    parts.push(line(`M0 ${-T + 34}L0 ${-14}`, c.topShade, 4));
    for (const y of [-T + 70, -T + 140, -T + 210]) parts.push(ellipse(0, y, 4, 4, c.topShade, null));
  } else if (top === 'hoodie') {
    parts.push(path(`M${-neck} ${-T + 1}Q0 ${-T + 30} ${neck} ${-T + 1}`, c.skin, c, {width: 6}));
    parts.push(path(`M${-neck - 18} ${-T - 2}Q0 ${-T + 58} ${neck + 18} ${-T - 2}`, null, c, {stroke: c.topShade, width: 14}));
    parts.push(line(`M-14 ${-T + 30}L-16 ${-T + 96}`, c.accent, 5), line(`M14 ${-T + 30}L16 ${-T + 96}`, c.accent, 5));
    parts.push(path(`M${-g.waist * 0.6} ${-T * 0.38}L${g.waist * 0.6} ${-T * 0.38}L${g.waist * 0.75} -10L${-g.waist * 0.75} -10Z`, c.topShade, c, {width: 5}));
  } else if (top === 'blazer') {
    parts.push(path(`M${-neck - 6} ${-T}L0 ${-T * 0.42}L${neck + 6} ${-T}Z`, c.accent, c, {width: 5}));
    parts.push(path(`M${-neck - 8} ${-T}L${-neck - 22} ${-T + 46}L${-12} ${-T + 60}L0 ${-T * 0.42}Z`, c.topShade, c, {width: 5}));
    parts.push(path(`M${neck + 8} ${-T}L${neck + 22} ${-T + 46}L12 ${-T + 60}L0 ${-T * 0.42}Z`, c.topShade, c, {width: 5}));
    parts.push(ellipse(0, -T * 0.32, 5, 5, c.topShade, null));
  }
  if (p.accessories.includes('lanyard')) {
    parts.push(line(`M${-neck + 2} ${-T + 4}L-6 ${-T + 112}M${neck - 2} ${-T + 4}L6 ${-T + 112}`, c.accent, 5));
    parts.push(path(`M-20 ${-T + 110}L20 ${-T + 110}L20 ${-T + 160}L-20 ${-T + 160}Z`, '#f7f5f0', c, {width: 5}));
    parts.push(line(`M-11 ${-T + 128}L11 ${-T + 128}`, c.accent, 6));
  }
  return parts;
}

function skirt(ctx) {
  const {g, c, p} = ctx;
  if (p.outfit.bottom !== 'skirt') return [];
  const fill = p.outfit.top === 'dress' ? c.top : c.bottom;
  const y0 = g.hipY - 6, y1 = g.hipY + g.thigh * 0.82;
  const w0 = g.hip + 4, w1 = g.hip + 34;
  return [path(`M${-w0} ${y0}L${w0} ${y0}L${w1} ${r1(y1 - 10)}Q${w1} ${r1(y1)} ${w1 - 12} ${r1(y1)}L${-w1 + 12} ${r1(y1)}Q${-w1} ${r1(y1)} ${-w1} ${r1(y1 - 10)}Z`, fill, c)];
}

function pelvis(ctx) {
  const {g, c} = ctx;
  if (ctx.p.outfit.bottom === 'skirt') return [];
  const y = g.hipY, H = g.hip;
  return [path(`M${-H} ${y - 20}L${H} ${y - 20}L${H} ${y + 30}Q${H} ${y + 58} ${g.legX} ${y + 58}L${-g.legX} ${y + 58}Q${-H} ${y + 58} ${-H} ${y + 30}Z`, c.bottom, c)];
}

// ---------------------------------------------------------------------------
// Head (head frame: pivot at the neck top, the head centre at (0, cy))

function headShape(g) {
  const {rx, ry, cy} = g.head;
  // A soft egg: wider cheeks, a rounded chin.
  return `M0 ${r1(cy - ry)}C${r1(rx * 0.62)} ${r1(cy - ry)} ${rx} ${r1(cy - ry * 0.55)} ${rx} ${r1(cy - ry * 0.05)}C${rx} ${r1(cy + ry * 0.55)} ${r1(rx * 0.55)} ${r1(cy + ry)} 0 ${r1(cy + ry)}C${r1(-rx * 0.55)} ${r1(cy + ry)} ${-rx} ${r1(cy + ry * 0.55)} ${-rx} ${r1(cy - ry * 0.05)}C${-rx} ${r1(cy - ry * 0.55)} ${r1(-rx * 0.62)} ${r1(cy - ry)} 0 ${r1(cy - ry)}Z`;
}

function ears(ctx) {
  const {g, c, p} = ctx;
  if (p.hair.style === 'headscarf') return [];
  const {rx, cy} = g.head;
  const out = [];
  for (const sx of [-1, 1]) {
    out.push(ellipse(sx * (rx - 2), cy + 14, 17, 23, c.skin, c));
    out.push(line(`M${sx * (rx + 2)} ${cy + 4}Q${sx * (rx + 9)} ${cy + 14} ${sx * (rx + 2)} ${cy + 24}`, c.skinShade, 5));
    if (p.accessories.includes('earrings')) out.push(ellipse(sx * (rx + 1), cy + 44, 6, 6, c.accent, c, {width: 4}));
  }
  if (p.accessories.includes('hearing-aid')) out.push(path(`M${rx + 6} ${cy - 10}Q${rx + 26} ${cy + 2} ${rx + 14} ${cy + 26}`, null, c, {stroke: c.accent, width: 9}));
  return out;
}

const hairFill = (ctx, d, extra) => path(d, ctx.c.hair, ctx.c, extra);

/** Hair behind the head and body (drawn before the torso). */
function hairBack(ctx) {
  const {g, c, p} = ctx;
  const {rx, ry, cy} = g.head;
  const style = p.hair.style;
  const top = cy - ry;
  switch (style) {
    case 'afro': return [ellipse(0, cy - 30, rx * 1.42, ry * 1.18, c.hair, c)];
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
        const d = `M${r1(x)} ${cy - 20}L${r1(x * 1.12)} ${cy + len}`;
        strands.push(line(d, c.outline, fat + OUT * 2), line(d, c.hair, fat));
      }
      return [hairFill(ctx, `M${-rx - 14} ${cy}C${-rx - 20} ${top - 34} ${rx + 20} ${top - 34} ${rx + 14} ${cy}Z`), ...strands];
    }
    case 'ponytail': return [hairFill(ctx, `M${rx * 0.4} ${top + 10}C${rx + 60} ${top - 10} ${rx + 56} ${cy + 60} ${rx + 30} ${cy + 140}C${rx + 10} ${cy + 90} ${rx + 6} ${cy + 20} ${rx * 0.5} ${top + 30}Z`)];
    case 'bun': return [ellipse(0, top - 18, 42, 38, c.hair, c)];
    case 'headscarf': return [path(`M${-rx - 22} ${cy - 20}C${-rx - 30} ${top - 46} ${rx + 30} ${top - 46} ${rx + 22} ${cy - 20}C${rx + 30} ${cy + 70} ${rx + 70} ${cy + 140} ${rx + 76} ${cy + 196}L${-rx - 76} ${cy + 196}C${-rx - 70} ${cy + 140} ${-rx - 30} ${cy + 70} ${-rx - 22} ${cy - 20}Z`, c.hair, c)];
    default: return [];
  }
}

/** Hair over the head (drawn after the face). */
function hairFront(ctx) {
  const {g, c, p} = ctx;
  const {rx, ry, cy} = g.head;
  const top = cy - ry;
  const style = p.hair.style;
  const shine = (d) => line(d, c.hairLight, 7);
  switch (style) {
    case 'bald': return [line(`M${-rx * 0.35} ${top + 22}Q${-rx * 0.05} ${top + 12} ${rx * 0.2} ${top + 18}`, c.skinLight, 8)];
    case 'buzz': return [path(`M${-rx + 2} ${cy - 14}C${-rx + 2} ${top - 50} ${rx - 2} ${top - 50} ${rx - 2} ${cy - 14}Q${rx * 0.4} ${cy - 56} 0 ${cy - 58}Q${-rx * 0.4} ${cy - 56} ${-rx + 2} ${cy - 14}Z`, c.hair, null, {opacity: 0.92})];
    case 'short': return [hairFill(ctx, `M${-rx - 6} ${cy + 6}C${-rx - 12} ${top - 30} ${rx + 12} ${top - 30} ${rx + 6} ${cy + 6}L${rx - 6} ${cy - 18}C${rx * 0.5} ${cy - 44} ${-rx * 0.1} ${cy - 30} ${-rx * 0.36} ${cy - 56}C${-rx * 0.6} ${cy - 36} ${-rx + 4} ${cy - 30} ${-rx - 6} ${cy + 6}Z`), shine(`M${-rx * 0.2} ${top + 6}Q${rx * 0.25} ${top - 2} ${rx * 0.5} ${top + 16}`)];
    case 'sidepart': return [hairFill(ctx, `M${-rx - 6} ${cy + 8}C${-rx - 12} ${top - 32} ${rx + 12} ${top - 32} ${rx + 6} ${cy + 8}L${rx - 4} ${cy - 16}C${rx * 0.4} ${cy - 66} ${-rx * 0.2} ${cy - 56} ${-rx * 0.42} ${top + 18}C${-rx * 0.6} ${cy - 50} ${-rx + 2} ${cy - 36} ${-rx - 6} ${cy + 8}Z`), line(`M${-rx * 0.42} ${top + 18}Q${-rx * 0.38} ${top + 6} ${-rx * 0.3} ${top - 2}`, c.hairShade, 5)];
    case 'curly': {
      const bumps = [];
      for (let i = 0; i < 7; i++) {
        const a = Math.PI * (1.05 + (i * 0.9) / 6);
        bumps.push(ellipse(Math.cos(a) * rx * 0.92, cy - 10 + Math.sin(a) * ry * 0.98, 30, 30, c.hair, c));
      }
      return [hairFill(ctx, `M${-rx - 4} ${cy + 4}C${-rx - 10} ${top - 26} ${rx + 10} ${top - 26} ${rx + 4} ${cy + 4}C${rx * 0.6} ${cy - 40} ${-rx * 0.6} ${cy - 40} ${-rx - 4} ${cy + 4}Z`), ...bumps, ellipse(0, top + 18, 40, 26, c.hair, null)];
    }
    case 'afro': return [hairFill(ctx, `M${-rx - 2} ${cy + 10}C${-rx - 4} ${top - 70} ${rx + 4} ${top - 70} ${rx + 2} ${cy + 10}C${rx * 0.7} ${cy - 46} ${-rx * 0.7} ${cy - 46} ${-rx - 2} ${cy + 10}Z`, {width: 0, stroke: 'none'})];
    case 'pixie': return [hairFill(ctx, `M${-rx - 8} ${cy + 20}C${-rx - 14} ${top - 30} ${rx + 14} ${top - 30} ${rx + 8} ${cy + 4}C${rx * 0.3} ${cy - 20} ${-rx * 0.4} ${cy - 30} ${-rx * 0.72} ${cy - 6}C${-rx * 0.86} ${cy + 4} ${-rx * 0.9} ${cy + 14} ${-rx - 8} ${cy + 20}Z`), shine(`M${-rx * 0.1} ${top + 8}Q${rx * 0.3} ${top + 2} ${rx * 0.55} ${top + 20}`)];
    case 'bob': return [hairFill(ctx, `M${-rx - 10} ${cy + 30}C${-rx - 14} ${top - 30} ${rx + 14} ${top - 30} ${rx + 10} ${cy + 30}L${rx - 4} ${cy + 30}L${rx - 8} ${cy - 30}Q0 ${cy - 44} ${-rx + 8} ${cy - 30}L${-rx + 4} ${cy + 30}Z`), shine(`M${-rx * 0.3} ${top + 8}Q${rx * 0.1} ${top} ${rx * 0.4} ${top + 10}`)];
    case 'wavy': case 'long': return [hairFill(ctx, `M${-rx - 10} ${cy + 40}C${-rx - 16} ${top - 30} ${rx + 16} ${top - 30} ${rx + 10} ${cy + 40}L${rx - 2} ${cy + 40}C${rx - 4} ${cy - 10} ${rx * 0.6} ${cy - 40} ${rx * 0.06} ${top + 20}C${-rx * 0.5} ${cy - 40} ${-rx + 2} ${cy - 10} ${-rx + 2} ${cy + 40}Z`), shine(`M${-rx * 0.5} ${top + 16}Q${-rx * 0.2} ${top + 2} ${0} ${top + 4}`)];
    case 'ponytail': case 'bun': return [hairFill(ctx, `M${-rx - 6} ${cy + 6}C${-rx - 12} ${top - 28} ${rx + 12} ${top - 28} ${rx + 6} ${cy + 6}L${rx - 4} ${cy - 10}C${rx * 0.5} ${cy - 50} ${-rx * 0.5} ${cy - 50} ${-rx + 4} ${cy - 10}Z`), line(`M${-rx * 0.4} ${top + 16}Q0 ${top + 4} ${rx * 0.4} ${top + 16}`, c.hairShade, 5)];
    case 'braids': case 'locs': return [hairFill(ctx, `M${-rx - 8} ${cy + 10}C${-rx - 14} ${top - 30} ${rx + 14} ${top - 30} ${rx + 8} ${cy + 10}L${rx - 4} ${cy - 6}C${rx * 0.6} ${cy - 44} ${rx * 0.1} ${cy - 40} 0 ${top + 18}C${-rx * 0.1} ${cy - 40} ${-rx * 0.6} ${cy - 44} ${-rx + 4} ${cy - 6}Z`), line(`M0 ${top + 18}L0 ${top - 6}`, c.hairShade, 5)];
    case 'headscarf': {
      const face = `M0 ${r1(cy - ry * 0.78)}C${r1(rx * 0.62)} ${r1(cy - ry * 0.78)} ${r1(rx * 0.8)} ${r1(cy - ry * 0.3)} ${r1(rx * 0.8)} ${r1(cy + ry * 0.08)}C${r1(rx * 0.8)} ${r1(cy + ry * 0.6)} ${r1(rx * 0.45)} ${r1(cy + ry * 0.92)} 0 ${r1(cy + ry * 0.92)}C${r1(-rx * 0.45)} ${r1(cy + ry * 0.92)} ${r1(-rx * 0.8)} ${r1(cy + ry * 0.6)} ${r1(-rx * 0.8)} ${r1(cy + ry * 0.08)}C${r1(-rx * 0.8)} ${r1(cy - ry * 0.3)} ${r1(-rx * 0.62)} ${r1(cy - ry * 0.78)} 0 ${r1(cy - ry * 0.78)}Z`;
      const outer = `M${-rx - 20} ${cy}C${-rx - 26} ${top - 40} ${rx + 26} ${top - 40} ${rx + 20} ${cy}C${rx + 22} ${cy + 70} ${rx * 0.5} ${cy + ry + 36} 0 ${cy + ry + 40}C${-rx * 0.5} ${cy + ry + 36} ${-rx - 22} ${cy + 70} ${-rx - 20} ${cy}Z`;
      return [path(`${outer}${face}`, c.hair, c, {rule: 'evenodd'}), line(`M${r1(-rx * 0.7)} ${r1(top - 6)}Q0 ${r1(top - 22)} ${r1(rx * 0.7)} ${r1(top - 6)}`, c.hairLight, 7)];
    }
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Faces

const EYE_X = 31;

function eyes(kind, c) {
  const out = [];
  for (const sx of [-1, 1]) {
    const x = sx * EYE_X;
    if (kind === 'dot') out.push(ellipse(x, 0, 9.5, 12, c.outline, null), ellipse(x + 3, -4, 3.2, 3.2, '#ffffff', null));
    else if (kind === 'wide') out.push(ellipse(x, 0, 15, 17, c.eyeWhite, c, {width: 4.5}), ellipse(x, 1, 8, 8.5, c.outline, null), ellipse(x + 3, -3, 2.6, 2.6, '#ffffff', null));
    else if (kind === 'happy') out.push(line(`M${x - 12} 5Q${x} -12 ${x + 12} 5`, c.outline, 6.5));
    else if (kind === 'narrow') out.push(ellipse(x, 2, 9.5, 7, c.outline, null), line(`M${x - 13} ${sx < 0 ? -8 : -3}L${x + 13} ${sx < 0 ? -3 : -8}`, c.outline, 5.5));
    else if (kind === 'squint') out.push(ellipse(x, 1, 9, 8.5, c.outline, null), ellipse(x + 3, -2, 2.6, 2.6, '#ffffff', null), line(`M${x - 12} -6L${x + 12} -6`, c.outline, 5));
  }
  return out;
}

function brows(spec, c, browColor, cy) {
  return spec.map((brow, i) => {
    const sx = i === 0 ? -1 : 1;
    const tilt = brow.tilt * (sx < 0 ? 1 : -1);
    return group([line('M-13 3Q0 -4 13 3', browColor, 7.5)], {transform: `translate(${sx * EYE_X} ${r1(cy - 22 - brow.lift)}) rotate(${tilt})`});
  });
}

const MOUTHS = {
  soft: c => [line('M-14 0Q0 9 14 0', c.outline, 6)],
  smile: c => [line('M-24 -3Q0 19 24 -3', c.outline, 6.5)],
  grin: c => [line('M-28 -6Q0 24 28 -6', c.outline, 7), line('M-31 -9L-26 -4M31 -9L26 -4', c.outline, 5)],
  flat: c => [line('M-13 2L13 2', c.outline, 6)],
  frown: c => [line('M-20 9Q0 -6 20 9', c.outline, 6.5)],
  wavy: c => [line('M-18 2Q-9 -6 0 2Q9 10 18 2', c.outline, 5.5)],
  o: c => [ellipse(0, 2, 9, 11, c.mouth, c, {width: 5})],
  small: c => [ellipse(0, 2, 12, 10, c.mouth, c, {width: 5}), ellipse(0, 7, 6, 3.5, c.tongue, null)],
  grin_open: c => [path('M-26 -5Q0 36 26 -5Z', c.mouth, c, {width: 5.5}), path('M-21 -3L21 -3L18 5L-18 5Z', c.teeth, null), ellipse(0, 15, 10, 5, c.tongue, null)],
  laugh: c => [path('M-32 -7Q0 46 32 -7Z', c.mouth, c, {width: 6}), path('M-27 -5L27 -5L23 4L-23 4Z', c.teeth, null), ellipse(0, 22, 13, 7, c.tongue, null)],
  grimace: c => [path('M-24 -8L24 -8Q28 -8 28 -2L28 6Q28 12 24 12L-24 12Q-28 12 -28 6L-28 -2Q-28 -8 -24 -8Z', c.teeth, c, {width: 5}), line('M-26 2L26 2', c.outline, 3.5)],
  side: c => [ellipse(8, 2, 10, 8, c.mouth, c, {width: 5})],
  gasp: c => [ellipse(0, 4, 15, 19, c.mouth, c, {width: 5.5}), ellipse(0, 14, 8, 5, c.tongue, null)]
};
const mouthShape = (name, c) => (MOUTHS[name === 'grin' ? 'grin' : name] ?? MOUTHS.soft)(c);

function face(ctx, name) {
  const {g, c, p} = ctx;
  const {cy} = g.head;
  const parts = expressionParts(name);
  const browColor = p.hair.style === 'headscarf' ? c.browDark : ['platinum', 'silver', 'grey'].includes(p.hair.color) ? c.hairShade : c.mixBrow;
  const eyeGroup = joint(ctx, `eyes-${name}`, 0, cy + 10, {}, eyes(parts.eyes, c));
  const kids = [];
  if (parts.blush) for (const sx of [-1, 1]) kids.push(ellipse(sx * 52, cy + 36, 15, 9, c.blush, null, {opacity: 0.55}));
  kids.push(eyeGroup, ...brows(parts.brows, c, browColor, cy));
  const mouthY = cy + 47;
  const closed = group(mouthShape(parts.mouth.closed, c), {transform: `translate(0 ${mouthY})`});
  const open = group(mouthShape(parts.mouth.open === 'grin' ? 'grin_open' : parts.mouth.open, c), {transform: `translate(0 ${mouthY})`});
  const show = ctx.expression === name ? 1 : 0;
  if (ctx.static) return show ? group([...kids, closed]) : null;
  return el('g', `${ctx.id}-face-${name}`, {opacity: show}, [
    ...kids,
    el('g', `${ctx.id}-mouth-${name}`, {opacity: show}, [closed]),
    el('g', `${ctx.id}-open-${name}`, {opacity: 0}, [open])
  ]);
}

function facial(ctx) {
  const {g, c, p} = ctx;
  const {rx, ry, cy} = g.head;
  const out = [];
  if (p.accessories.includes('freckles')) for (const [x, y] of [[-48, 26], [-38, 32], [-56, 34], [48, 26], [38, 32], [56, 34]]) out.push(ellipse(x, cy + y, 2.6, 2.6, c.skinShade, null));
  // Beards follow the jaw below the cheeks; the mouth stays clear so the
  // face still acts.
  const jaw = (side, chin, inner) => `M${-rx + 3} ${cy + side}C${-rx + 2} ${cy + 80} ${-44} ${cy + ry + chin} 0 ${cy + ry + chin}C44 ${cy + ry + chin} ${rx - 2} ${cy + 80} ${rx - 3} ${cy + side}L${rx - 16} ${cy + side + 8}C${rx - 22} ${cy + 46} 40 ${cy + inner} 0 ${cy + inner}C-40 ${cy + inner} ${-rx + 22} ${cy + 46} ${-rx + 16} ${cy + side + 8}Z`;
  const hole = `M-29 ${cy + 47}C-29 ${cy + 35} 29 ${cy + 35} 29 ${cy + 47}C29 ${cy + 64} -29 ${cy + 64} -29 ${cy + 47}Z`;
  if (p.accessories.includes('beard')) out.push(path(`${jaw(40, 6, 38)}${hole}`, c.hair, c, {rule: 'evenodd'}));
  if (p.accessories.includes('stubble')) out.push(path(`${jaw(46, 0, 42)}${hole}`, c.stubble, null, {rule: 'evenodd', opacity: 0.55}));
  if (p.accessories.includes('moustache')) out.push(path(`M-27 ${cy + 40}Q-13 ${cy + 27} 0 ${cy + 34}Q13 ${cy + 27} 27 ${cy + 40}Q13 ${cy + 45} 0 ${cy + 40}Q-13 ${cy + 45} -27 ${cy + 40}Z`, c.hair, c, {width: 5}));
  out.push(line(`M-3 ${cy + 14}Q7 ${cy + 26} -4 ${cy + 30}`, c.skinShade, 5.5));
  return out;
}

function glasses(ctx) {
  const {g, c, p} = ctx;
  const cy = g.head.cy + 10;
  const frame = {stroke: c.outline, width: 5.5};
  if (p.accessories.includes('glasses')) {
    return [
      path(`M-53 ${cy - 16}L-11 ${cy - 16}Q-9 ${cy - 16} -9 ${cy - 13}L-11 ${cy + 10}Q-12 ${cy + 16} -18 ${cy + 16}L-46 ${cy + 16}Q-52 ${cy + 16} -53 ${cy + 10}Z`, '#ffffff', c, {...frame, opacity: undefined}),
      path(`M53 ${cy - 16}L11 ${cy - 16}Q9 ${cy - 16} 9 ${cy - 13}L11 ${cy + 10}Q12 ${cy + 16} 18 ${cy + 16}L46 ${cy + 16}Q52 ${cy + 16} 53 ${cy + 10}Z`, '#ffffff', c, frame),
      line(`M-9 ${cy - 8}Q0 ${cy - 13} 9 ${cy - 8}`, c.outline, 5)
    ].map((node, i) => (i < 2 ? {...node, attrs: {...node.attrs, fillOpacity: 0.18}} : node));
  }
  if (p.accessories.includes('round-glasses')) {
    return [ellipse(-EYE_X, cy, 21, 20, '#ffffff', c, {width: 5.5}), ellipse(EYE_X, cy, 21, 20, '#ffffff', c, {width: 5.5}), line(`M-10 ${cy - 4}Q0 ${cy - 10} 10 ${cy - 4}`, c.outline, 5)]
      .map((node, i) => (i < 2 ? {...node, attrs: {...node.attrs, fillOpacity: 0.18}} : node));
  }
  return [];
}

// ---------------------------------------------------------------------------
// The whole character

/**
 * Draw one character.
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
 * → node: a <g> with the feet at (0, 0).
 */
export function drawFlat(params, colors, {id, joints, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null}) {
  const g = rigGeometry(params);
  const c = {...colors, mixBrow: colors.hairShade, browDark: '#33241c', stubble: mixColor(colors.hair, colors.skinShade, 0.35)};
  const ctx = {id, g, c, p: params, j: joints, expression, static: isStatic, props};
  const faceNodes = [...new Set([expression, ...expressions])].map(name => face(ctx, name)).filter(Boolean);
  const headKids = [
    ...ears(ctx),
    path(headShape(g), c.skin, c),
    ...facial(ctx),
    ...faceNodes,
    ...glasses(ctx),
    ...hairFront(ctx)
  ];
  const tilt = {rotation: joints.head, y: joints.headY};
  const headIdle = joint(ctx, 'headidle', 0, 0, {}, headKids);
  const backIdle = joint(ctx, 'hbidle', 0, 0, {}, hairBack(ctx));
  const neckTop = g.neckY;
  const torsoKids = [
    joint(ctx, 'hb', 0, neckTop, tilt, [backIdle]),
    path(`M-19 ${neckTop - 6}L19 ${neckTop - 6}L19 ${-g.torso + 14}L-19 ${-g.torso + 14}Z`, c.skin, c),
    line(`M-17 ${-g.torso + 4}Q0 ${-g.torso + 12} 17 ${-g.torso + 4}`, c.skinShade, 8),
    path(torsoPath(g), c.top, c),
    ...outfit(ctx),
    joint(ctx, 'head', 0, neckTop, tilt, [headIdle]),
    arm(ctx, 'l'),
    arm(ctx, 'r')
  ];
  const breath = joint(ctx, 'breath', 0, 0, {}, torsoKids);
  const torso = joint(ctx, 'torso', 0, g.hipY, {rotation: joints.lean, scaleY: joints.squash}, [breath]);
  const body = joint(ctx, 'body', 0, 0, {y: joints.bodyY}, [leg(ctx, 'l'), leg(ctx, 'r'), ...pelvis(ctx), ...skirt(ctx), torso]);
  return group([ellipse(0, 4, 150, 18, '#000000', null, {opacity: 0.16}), body]);
}

/** Height of the drawn character above the feet, in rig units (with hair). */
export function drawnHeight(params) {
  const g = rigGeometry(params);
  const extra = {afro: 70, bun: 70, curly: 24}[params.hair.style] ?? 14;
  return Math.round(g.height + extra);
}
