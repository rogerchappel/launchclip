// The lifelike body, shared by the lifelike and cinematic drawing styles.
// Realistic proportions (about seven and a half heads tall for an adult,
// five for a child), anatomical limb contours, hands with fingers and a
// thumb, shoes with soles, and a face drawn from classic proportions: eyes
// on the head's midline one eye apart, irises, lids and lashes, a nose with
// nostrils and a lit tip, lips with a cupid's bow. Expressions move lids,
// brows, cheeks and mouth. The painter (real-pen.mjs) shades every piece
// from the key light.
//
// It is the same rig as every other style (rig.mjs poses and expressions,
// the same joints and part ids as toon.mjs), so acting.mjs animates it and a
// cast looks like the same people as in flat. Hair, headwear, collars,
// layers and other outfit details are the toon shapes (toon.mjs,
// toon-wear.mjs) painted by the lifelike pen inside a group scaled from the
// toon head or torso onto this one, so every rig option is drawn here too.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {AGE_SHAPE, BUILD_SHAPE, HEIGHT_SCALE, expressionParts, rigGeometry} from './rig.mjs';
import {GREY_HAIR} from './palette.mjs';
import {asShadow} from './bounds.mjs';
import {hairBack, hairFront, joint, outfit, toonColors} from './toon.mjs';
import {aidSide, backpackBack, covers, has, headwear, heldAid, longHem, prostheticForearm, prostheticShin, wheelchair, wristWear} from './toon-wear.mjs';
import {capsulePath, darken, ellipsePath, group, lighten, luma, mix, noise, pathNode, placedGroup, r1, radialGradient, strokeLine} from './pens.mjs';
import {realPen} from './real-pen.mjs';

const LONG = new Set(['shirt', 'hoodie', 'blazer', 'sweater', 'turtleneck', 'cardigan', 'jacket', 'coat', 'lab-coat', 'chef-coat', 'kurta']);
const COVERED_LEGS = new Set(['trousers', 'leggings']);

// ---------------------------------------------------------------------------
// Geometry

/** Realistic measurements for rig params (same fields as rigGeometry). */
export function realGeometry(params) {
  const a = AGE_SHAPE[params.age ?? 'adult'];
  const s = HEIGHT_SCALE[params.height] * a.length;
  const b0 = BUILD_SHAPE[params.build];
  const w = value => Math.round(value * a.width);
  const foot = Math.round(40 * (a.length === 1 ? 1 : (1 + a.length) / 2));
  const thigh = Math.round(236 * s), shin = Math.round(226 * s);
  const hipY = -(thigh + shin + foot);
  const torso = Math.round(300 * s);
  const neck = Math.round(30 * s);
  const ry = Math.round(64 * a.head);
  const shoulder = w(b0.shoulder * 1.1), waist = w(b0.waist * 0.96), hip = w(b0.hip * 1.16);
  const armW = w(b0.arm * 0.8), legW = w(b0.leg * 1.02);
  return {
    real: true, foot, thigh, shin, torso, neck, hipY,
    shoulderY: -torso, shoulder, waist, hip, armW, legW,
    upperArm: Math.round(196 * s), foreArm: Math.round(158 * s), hand: Math.round(88 * s),
    armX: shoulder - armW * 0.5, armY: -torso + armW * 0.95,
    legX: hip * 0.5,
    neckY: -torso - neck * 0.62,
    head: {rx: Math.round(ry * 0.77), ry, cy: -Math.round(ry * 0.94)},
    // Seated, the hips sit about as high as a toon character's, a little below a desk top.
    sitDrop: Math.round(-hipY - 232 * s),
    height: -hipY + torso + neck * 0.62 + ry * 1.94
  };
}

/** Drawn height with hair and headwear (rig units). */
export function realHeight(params) {
  const g = realGeometry(params);
  const k = g.head.ry / 110;
  const hair = {afro: 70, bun: 70, curly: 24, mohawk: 74, spiky: 44, quiff: 52, topknot: 38, 'space-buns': 36}[params.hair.style] ?? 14;
  const hat = {'chef-hat': 150, 'grad-cap': 30, 'beanie': 34, 'bike-helmet': 30, 'hard-hat': 26, 'turban': 40, 'headphones': 24}[params.headwear] ?? 0;
  return Math.round(g.height + Math.max(hair, hat) * k);
}

// ---------------------------------------------------------------------------
// Shapes

/**
 * A tapered limb along +y from `from` to `len`: `w0` wide at the top, `wb`
 * at the belly (a share `at` of the way down) and `w1` at the end, with
 * rounded caps. `lean` pushes the belly to one side (a calf, a biceps).
 */
function limbPath(len, w0, wb, w1, at = 0.3, from = 0, lean = 0) {
  const yb = from + (len - from) * at;
  const a = -w0 / 2, b = -wb / 2, e = -w1 / 2;
  const k0 = w0 * 0.55, k1 = w1 * 0.55;
  const L = lean;
  return `M${r1(a)} ${r1(from)}C${r1(a)} ${r1(from + (yb - from) * 0.45)} ${r1(b - L)} ${r1(yb - (yb - from) * 0.35)} ${r1(b - L)} ${r1(yb)}`
    + `C${r1(b - L)} ${r1(yb + (len - yb) * 0.4)} ${r1(e)} ${r1(len - (len - yb) * 0.3)} ${r1(e)} ${r1(len)}`
    + `C${r1(e)} ${r1(len + k1)} ${r1(-e)} ${r1(len + k1)} ${r1(-e)} ${r1(len)}`
    + `C${r1(-e)} ${r1(len - (len - yb) * 0.3)} ${r1(-b + L * 0.4)} ${r1(yb + (len - yb) * 0.4)} ${r1(-b + L * 0.4)} ${r1(yb)}`
    + `C${r1(-b + L * 0.4)} ${r1(yb - (yb - from) * 0.35)} ${r1(-a)} ${r1(from + (yb - from) * 0.45)} ${r1(-a)} ${r1(from)}`
    + `C${r1(-a)} ${r1(from - k0)} ${r1(a)} ${r1(from - k0)} ${r1(a)} ${r1(from)}Z`;
}

/** The torso's outline (torso frame: hip centre at 0, shoulders at -T). */
function torsoOutline(g, neckW) {
  const {shoulder: S, waist: W, hip: H, torso: T, armW} = g;
  const belly = Math.max(0, W - S * 0.86);
  const side = sx => [
    [sx * neckW, -T - 6],
    [sx * neckW * 2, -T - 1], [sx * S * 0.84, -T + 3], [sx * S, -T + 18],
    [sx * (S + 5), -T + 38], [sx * (S + 2), -T + 64], [sx * (S - armW * 0.28), -T + 86],
    [sx * (S - armW * 0.3), -T * 0.68], [sx * (W + belly * 1.2), -T * 0.55], [sx * (W + belly), -T * 0.4],
    [sx * (W + belly * 0.8), -T * 0.24], [sx * H, -T * 0.12], [sx * H, -6],
    [sx * H, 10], [sx * (H - 2), 22], [sx * (H - 6), 26]
  ];
  const L = side(-1), R = side(1).reverse();
  const curve = pts => pts.reduce((d, p, i) => d + (i % 3 === 0 ? 'C' : ' ') + `${r1(p[0])} ${r1(p[1])}`, '');
  return `M${r1(L[0][0])} ${r1(L[0][1])}${curve(L.slice(1))}Q0 34 ${r1(R[0][0])} ${r1(R[0][1])}${curve(R.slice(1))}Q0 -${r1(T + 2)} ${r1(L[0][0])} ${r1(L[0][1])}Z`;
}

/** The head: a skull, cheekbones and a jaw that narrows to the chin. */
function headOutline({rx, ry, cy}, jaw = 1) {
  const side = sx => `C${r1(sx * rx * 0.62)} ${r1(cy - ry)} ${r1(sx * rx)} ${r1(cy - ry * 0.62)} ${r1(sx * rx)} ${r1(cy - ry * 0.12)}`
    + `C${r1(sx * rx)} ${r1(cy + ry * 0.28)} ${r1(sx * rx * 0.92 * jaw)} ${r1(cy + ry * 0.5)} ${r1(sx * rx * 0.72 * jaw)} ${r1(cy + ry * 0.7)}`
    + `C${r1(sx * rx * 0.52 * jaw)} ${r1(cy + ry * 0.9)} ${r1(sx * rx * 0.26)} ${r1(cy + ry)} 0 ${r1(cy + ry)}`;
  const right = side(1);
  // The left side, traced back up from the chin.
  const left = `C${r1(-rx * 0.26)} ${r1(cy + ry)} ${r1(-rx * 0.52 * jaw)} ${r1(cy + ry * 0.9)} ${r1(-rx * 0.72 * jaw)} ${r1(cy + ry * 0.7)}`
    + `C${r1(-rx * 0.92 * jaw)} ${r1(cy + ry * 0.5)} ${r1(-rx)} ${r1(cy + ry * 0.28)} ${r1(-rx)} ${r1(cy - ry * 0.12)}`
    + `C${r1(-rx)} ${r1(cy - ry * 0.62)} ${r1(-rx * 0.62)} ${r1(cy - ry)} 0 ${r1(cy - ry)}`;
  return `M0 ${r1(cy - ry)}${right}${left}Z`;
}

/** Eye colour from the character (deterministic): lighter eyes with fair skin and light hair sometimes. */
function irisColor(p, c) {
  const h = noise(JSON.stringify([p.skin, p.hair, p.build, p.height]));
  const lightHair = ['blonde', 'platinum', 'strawberry', 'copper', 'honey', 'ash', 'auburn', 'chestnut'].includes(p.hair.color);
  if (luma(c.skin) > 0.62 && (lightHair || h > 0.6)) return ['#5a7fa8', '#5d7f4f', '#8a6a3a', '#6f8796', '#4f6f8f'][Math.floor(h * 5)];
  return ['#4a2c1a', '#5b3a22', '#3a2416', '#6a4426'][Math.floor(h * 4)];
}

// ---------------------------------------------------------------------------
// The face

// Eye openings per expression eye kind: upper and lower lid heights (shares of the eye height).
const EYES = {
  dot: {up: 0.62, low: 0.42, iris: 1},
  wide: {up: 0.86, low: 0.56, iris: 0.92},
  happy: {up: 0.46, low: -0.02, iris: 1, cheek: true},
  narrow: {up: 0.3, low: 0.34, iris: 1},
  squint: {up: 0.32, low: 0.12, iris: 1, cheek: true}
};

function eye(ctx, sx, kind) {
  const {P, look} = ctx;
  const {ew, eh} = look;
  const spec = EYES[kind] ?? EYES.dot;
  const hw = ew / 2;
  const up = eh * spec.up, low = eh * spec.low;
  // The outer corner sits a touch higher than the inner one.
  const inner = [-sx * hw, 0.6], outer = [sx * hw, -0.8];
  const x0 = Math.min(inner[0], outer[0]), x1 = Math.max(inner[0], outer[0]);
  const yL = x0 === inner[0] ? inner[1] : outer[1], yR = x1 === inner[0] ? inner[1] : outer[1];
  const top = `M${r1(x0)} ${r1(yL)}C${r1(x0 + ew * 0.22)} ${r1(-up * 1.25)} ${r1(x1 - ew * 0.28)} ${r1(-up * 1.3)} ${r1(x1)} ${r1(yR)}`;
  const opening = `${top}C${r1(x1 - ew * 0.3)} ${r1(low * 1.2)} ${r1(x0 + ew * 0.3)} ${r1(low * 1.2)} ${r1(x0)} ${r1(yL)}Z`;
  const clip = P.uid('ec');
  const ir = eh * 0.46 * spec.iris;
  const shift = ctx.look.gaze * ew * 0.08;
  const out = [
    el('clipPath', clip, null, [pathNode(opening, {})]),
    pathNode(opening, {fill: '#f4efe8'}),
    group([
      pathNode(`M${r1(x0)} ${r1(-up * 1.4)}L${r1(x1)} ${r1(-up * 1.4)}L${r1(x1)} ${r1(-up * 0.2)}L${r1(x0)} ${r1(-up * 0.2)}Z`, {fill: '#000000', opacity: 0.12}),
      el('ellipse', null, null, [], {cx: r1(shift), cy: 0, rx: r1(ir), ry: r1(ir), fill: ctx.look.iris, stroke: darken(ctx.look.iris, 0.45), strokeWidth: 0.9}),
      el('ellipse', null, null, [], {cx: r1(shift), cy: 0, rx: r1(ir * 0.62), ry: r1(ir * 0.62), fill: lighten(ctx.look.iris, 0.18), opacity: 0.45}),
      el('ellipse', null, null, [], {cx: r1(shift), cy: 0, rx: r1(ir * 0.44), ry: r1(ir * 0.44), fill: '#120d0e'}),
      el('ellipse', null, null, [], {cx: r1(shift - ir * 0.35 * Math.sign(ctx.look.lx || -1)), cy: r1(-ir * 0.38), rx: r1(ir * 0.24), ry: r1(ir * 0.22), fill: '#ffffff', opacity: 0.9})
    ], {clipPath: `url(#${clip})`}),
    // Upper lid line and lashes, the lower lid, the crease above.
    strokeLine(top, '#221a1c', 2.4),
    strokeLine(`M${r1(outer[0])} ${r1(outer[1])}L${r1(outer[0] + sx * ew * 0.12)} ${r1(outer[1] - eh * 0.28)}`, '#221a1c', 1.6),
    strokeLine(`M${r1(x0 + ew * 0.18)} ${r1(low * 0.95)}Q0 ${r1(low * 1.25 + 0.6)} ${r1(x1 - ew * 0.12)} ${r1(low * 0.8)}`, darken(ctx.c.skin, 0.32), 1.1, {strokeOpacity: 0.7}),
    strokeLine(`M${r1(x0 + ew * 0.12)} ${r1(-up * 1.25 - eh * 0.35)}Q0 ${r1(-up * 1.55 - eh * 0.45)} ${r1(x1 - ew * 0.08)} ${r1(-up * 1.1 - eh * 0.4)}`, darken(ctx.c.skin, 0.25), 1.1, {strokeOpacity: 0.55})
  ];
  return group(out, {transform: `translate(${r1(sx * ctx.look.ex)} 0)`});
}

function brow(ctx, sx, spec) {
  const {look} = ctx;
  const bw = look.ew * 1.25;
  const lift = spec.lift * look.headK;
  const tilt = spec.tilt * (sx < 0 ? 1 : -1);
  // Thick at the inner end, tapering outward.
  const ix = -sx * bw * 0.5, ox = sx * bw * 0.5;
  const d = `M${r1(ix)} ${r1(1.8)}C${r1(ix * 0.4)} ${r1(-3.4)} ${r1(ox * 0.5)} ${r1(-4.4)} ${r1(ox)} ${r1(-0.6)}C${r1(ox * 0.5)} ${r1(-2)} ${r1(ix * 0.4)} ${r1(-0.4)} ${r1(ix)} ${r1(3.6)}Z`;
  return group([pathNode(d, {fill: look.brow, opacity: 0.92})], {transform: `translate(${r1(sx * look.ex)} ${r1(look.browY - lift)}) rotate(${r1(tilt)})`});
}

function mouthShape(ctx, name) {
  const {look, c} = ctx;
  const m = look.mw / 2;
  const lipTop = look.lipTop, lipLow = look.lipLow;
  const inside = '#4a1f24', teeth = '#f2ece2', tongue = '#c9666a';
  const line = (d, w = 1.6) => strokeLine(d, darken(lipTop, 0.45), w);
  const lips = (spread = 0, curl = 0) => [
    pathNode(`M${r1(-m - spread)} ${r1(-curl)}C${r1(-m * 0.5)} ${r1(-3 - curl * 0.3)} ${r1(-m * 0.2)} -4.4 0 -2.8C${r1(m * 0.2)} -4.4 ${r1(m * 0.5)} ${r1(-3 - curl * 0.3)} ${r1(m + spread)} ${r1(-curl)}C${r1(m * 0.4)} ${r1(1 - curl * 0.5)} ${r1(-m * 0.4)} ${r1(1 - curl * 0.5)} ${r1(-m - spread)} ${r1(-curl)}Z`, {fill: lipTop}),
    pathNode(`M${r1(-m * 0.9 - spread)} ${r1(0.4 - curl)}C${r1(-m * 0.4)} ${r1(1.6 - curl * 0.5)} ${r1(m * 0.4)} ${r1(1.6 - curl * 0.5)} ${r1(m * 0.9 + spread)} ${r1(0.4 - curl)}C${r1(m * 0.6)} ${r1(6.4 - curl * 0.4)} ${r1(-m * 0.6)} ${r1(6.4 - curl * 0.4)} ${r1(-m * 0.9 - spread)} ${r1(0.4 - curl)}Z`, {fill: lipLow}),
    el('ellipse', null, null, [], {cx: r1(-m * 0.15), cy: r1(3.4 - curl * 0.4), rx: r1(m * 0.28), ry: 1.1, fill: '#ffffff', opacity: 0.28})
  ];
  const open = (w, h, {smile = 0, top = true, tongueOn = true, dx = 0} = {}) => {
    const d = `M${r1(dx - w)} ${r1(-smile)}Q${r1(dx)} ${r1(-h * 0.35 + smile * 0.3)} ${r1(dx + w)} ${r1(-smile)}Q${r1(dx + w * 0.7)} ${r1(h)} ${r1(dx)} ${r1(h)}Q${r1(dx - w * 0.7)} ${r1(h)} ${r1(dx - w)} ${r1(-smile)}Z`;
    const clip = ctx.P.uid('mc');
    return [
      pathNode(d, {fill: lipLow, stroke: lipLow, strokeWidth: 4.2, strokeLinejoin: 'round'}),
      el('clipPath', clip, null, [pathNode(d, {})]),
      pathNode(d, {fill: inside}),
      group([
        ...(top ? [pathNode(`M${r1(dx - w)} ${r1(-h)}L${r1(dx + w)} ${r1(-h)}L${r1(dx + w)} ${r1(h * 0.18 - smile * 0.4)}Q${r1(dx)} ${r1(h * 0.3)} ${r1(dx - w)} ${r1(h * 0.18 - smile * 0.4)}Z`, {fill: teeth})] : []),
        ...(tongueOn ? [el('ellipse', null, null, [], {cx: r1(dx), cy: r1(h * 0.95), rx: r1(w * 0.55), ry: r1(h * 0.42), fill: tongue})] : [])
      ], {clipPath: `url(#${clip})`}),
      strokeLine(`M${r1(dx - w)} ${r1(-smile)}Q${r1(dx)} ${r1(-h * 0.35 + smile * 0.3)} ${r1(dx + w)} ${r1(-smile)}`, lipTop, 3.2)
    ];
  };
  switch (name) {
    case 'smile': return [...lips(0.6, 2.6), line(`M${r1(-m * 1.08)} -3Q0 3.4 ${r1(m * 1.08)} -3`), ...[-1, 1].map(sx => strokeLine(`M${r1(sx * m * 1.15)} -5Q${r1(sx * m * 1.32)} -1 ${r1(sx * m * 1.12)} 2`, darken(c.skin, 0.25), 1.1, {strokeOpacity: 0.6}))];
    case 'grin': return [...open(m * 1.08, 7.5, {smile: 3, tongueOn: false}), ...[-1, 1].map(sx => strokeLine(`M${r1(sx * m * 1.18)} -6Q${r1(sx * m * 1.36)} -1 ${r1(sx * m * 1.12)} 3`, darken(c.skin, 0.25), 1.1, {strokeOpacity: 0.6}))];
    case 'flat': return [...lips(0, 0), line(`M${r1(-m)} 0.4L${r1(m)} 0.4`)];
    case 'frown': return [...lips(-0.5, -2.2), line(`M${r1(-m)} 2.6Q0 -2 ${r1(m)} 2.6`)];
    case 'wavy': return [...lips(0, 0), line(`M${r1(-m)} 0Q${r1(-m / 2)} -2.4 0 0Q${r1(m / 2)} 2.4 ${r1(m)} 0`)];
    case 'o': return open(m * 0.42, 7, {top: false, tongueOn: false});
    case 'small': return open(m * 0.66, 3.6, {tongueOn: false});
    case 'grin_open': return open(m * 1.12, 11, {smile: 3});
    case 'laugh': return open(m * 1.22, 15, {smile: 4});
    case 'grimace': return [pathNode(`M${r1(-m * 1.1)} -3.6L${r1(m * 1.1)} -3.6L${r1(m * 1.1)} 4L${r1(-m * 1.1)} 4Z`, {fill: teeth, stroke: lipLow, strokeWidth: 3.4, strokeLinejoin: 'round'}), strokeLine(`M${r1(-m * 1.05)} 0.2L${r1(m * 1.05)} 0.2`, '#8d8079', 0.9), ...[-0.5, 0, 0.5].map(t => strokeLine(`M${r1(m * t)} -3L${r1(m * t)} 3.4`, '#b8ada3', 0.6))];
    case 'side': return open(m * 0.55, 5, {top: false, dx: m * 0.35});
    case 'gasp': return open(m * 0.62, 13, {top: false});
    default: return [...lips(0, 0.6), line(`M${r1(-m)} 0Q0 1.4 ${r1(m)} 0`, 1.3)];
  }
}

function faceNode(ctx, name) {
  const {look} = ctx;
  const parts = expressionParts(name);
  const kids = [];
  const spec = EYES[parts.eyes] ?? EYES.dot;
  if (parts.blush || spec.cheek) for (const sx of [-1, 1]) kids.push(el('ellipse', null, null, [], {cx: r1(sx * look.ex * 1.15), cy: r1(look.eyeY + look.eh * 3.4), rx: r1(look.ew * 0.8), ry: r1(look.eh * 1.5), fill: `url(#${look.blushGrad})`, opacity: parts.blush ? 0.9 : 0.55}));
  kids.push(joint(ctx, `eyes-${name}`, 0, look.eyeY, {}, [eye(ctx, -1, parts.eyes), eye(ctx, 1, parts.eyes)]));
  kids.push(brow(ctx, -1, parts.brows[0]), brow(ctx, 1, parts.brows[1]));
  const closed = group(mouthShape(ctx, parts.mouth.closed), {transform: `translate(0 ${r1(look.mouthY)})`});
  const open = group(mouthShape(ctx, parts.mouth.open === 'grin' ? 'grin_open' : parts.mouth.open), {transform: `translate(0 ${r1(look.mouthY)})`});
  const show = ctx.expression === name ? 1 : 0;
  if (ctx.static) return show ? group([...kids, closed]) : null;
  return el('g', `${ctx.id}-face-${name}`, {opacity: show}, [
    ...kids,
    el('g', `${ctx.id}-mouth-${name}`, {opacity: show}, [closed]),
    el('g', `${ctx.id}-open-${name}`, {opacity: 0}, [open])
  ]);
}

/** Nose, ears, shading and marks that every expression shares. */
function faceBase(ctx) {
  const {g, p, P, c, look} = ctx;
  const {rx, ry, cy} = g.head;
  const out = [];
  const far = -Math.sign(look.lx || -1); // the side away from the light
  // Eye sockets and the shadow under the brow ridge.
  for (const sx of [-1, 1]) out.push(el('ellipse', null, null, [], {cx: r1(sx * look.ex), cy: r1(look.eyeY - look.eh * 0.6), rx: r1(look.ew * 0.78), ry: r1(look.eh * 1.5), fill: `url(#${look.socketGrad})`}));
  // Nose: the shaded side of the bridge, wings, nostrils, the lit tip.
  const ny = cy + ry * 0.42;
  out.push(strokeLine(`M${r1(far * rx * 0.07)} ${r1(look.eyeY + look.eh * 0.4)}Q${r1(far * rx * 0.13)} ${r1(ny - ry * 0.2)} ${r1(far * rx * 0.16)} ${r1(ny - ry * 0.04)}`, darken(c.skin, 0.28), 2.2, {strokeOpacity: 0.45}));
  out.push(el('ellipse', null, null, [], {cx: r1(far * rx * 0.05), cy: r1(ny + ry * 0.035), rx: r1(rx * 0.2), ry: r1(ry * 0.045), fill: darken(c.skin, 0.3), opacity: 0.32}));
  for (const sx of [-1, 1]) {
    out.push(strokeLine(`M${r1(sx * rx * 0.08)} ${r1(ny - ry * 0.05)}Q${r1(sx * rx * 0.2)} ${r1(ny - ry * 0.03)} ${r1(sx * rx * 0.15)} ${r1(ny + ry * 0.03)}`, darken(c.skin, 0.32), 1.5, {strokeOpacity: 0.6}));
    out.push(el('ellipse', null, null, [], {cx: r1(sx * rx * 0.08), cy: r1(ny + ry * 0.01), rx: r1(rx * 0.045), ry: r1(ry * 0.018), fill: darken(c.skin, 0.55), opacity: 0.7}));
  }
  out.push(el('ellipse', null, null, [], {cx: r1(-far * rx * 0.03), cy: r1(ny - ry * 0.07), rx: r1(rx * 0.04), ry: r1(ry * 0.025), fill: '#ffffff', opacity: 0.16}));
  // The shadow under the lower lip and the philtrum.
  out.push(el('ellipse', null, null, [], {cx: 0, cy: r1(look.mouthY + ry * 0.12), rx: r1(look.mw * 0.36), ry: r1(ry * 0.035), fill: darken(c.skin, 0.25), opacity: 0.3}));
  out.push(strokeLine(`M0 ${r1(ny + ry * 0.06)}L0 ${r1(look.mouthY - ry * 0.06)}`, darken(c.skin, 0.18), 2.4, {strokeOpacity: 0.25}));
  if (p.age === 'senior') {
    for (const sx of [-1, 1]) {
      const x0 = sx * (look.ex + look.ew * 0.62), x1 = x0 + sx * look.ew * 0.25;
      out.push(strokeLine(`M${r1(x0)} ${r1(look.eyeY - 1)}L${r1(x1)} ${r1(look.eyeY - 3)}M${r1(x0)} ${r1(look.eyeY + 2)}L${r1(x1)} ${r1(look.eyeY + 3.5)}`, darken(c.skin, 0.3), 1, {strokeOpacity: 0.5}));
      out.push(strokeLine(`M${r1(sx * rx * 0.2)} ${r1(ny - ry * 0.02)}Q${r1(sx * rx * 0.36)} ${r1(ny + ry * 0.12)} ${r1(sx * rx * 0.34)} ${r1(look.mouthY + ry * 0.04)}`, darken(c.skin, 0.28), 1.2, {strokeOpacity: 0.45}));
    }
    for (const t of [0, 1]) out.push(strokeLine(`M${r1(-rx * 0.4)} ${r1(cy - ry * (0.4 + t * 0.1))}Q0 ${r1(cy - ry * (0.44 + t * 0.1))} ${r1(rx * 0.4)} ${r1(cy - ry * (0.4 + t * 0.1))}`, darken(c.skin, 0.22), 1, {strokeOpacity: 0.4}));
  }
  if (has(p, 'freckles')) for (let i = 0; i < 14; i++) out.push(el('ellipse', null, null, [], {cx: r1((noise(`fx${i}`) - 0.5) * rx * 1.1), cy: r1(ny - ry * 0.12 + noise(`fy${i}`) * ry * 0.16), rx: 1.1, ry: 1.1, fill: darken(c.skin, 0.35), opacity: 0.55}));
  if (has(p, 'bindi')) out.push(el('ellipse', null, null, [], {cx: 0, cy: r1(look.browY - look.eh * 1.2), rx: 2.6, ry: 2.6, fill: '#c8323c'}));
  if (has(p, 'nose-stud')) out.push(el('ellipse', null, null, [], {cx: r1(rx * 0.15), cy: r1(ny - ry * 0.01), rx: 1.6, ry: 1.6, fill: '#f3e6b4'}));
  return out;
}

function ears(ctx) {
  const {g, p, P, c} = ctx;
  if (p.hair.style === 'headscarf') return [];
  const {rx, ry, cy} = g.head;
  const out = [];
  for (const sx of [-1, 1]) {
    const d = `M${r1(sx * rx * 0.94)} ${r1(cy - ry * 0.16)}C${r1(sx * rx * 1.2)} ${r1(cy - ry * 0.26)} ${r1(sx * rx * 1.24)} ${r1(cy + ry * 0.3)} ${r1(sx * rx * 0.96)} ${r1(cy + ry * 0.36)}Z`;
    out.push(P.piece(d, c.skin, {rim: false, width: 1.4}));
    out.push(strokeLine(`M${r1(sx * rx * 1.0)} ${r1(cy - ry * 0.1)}C${r1(sx * rx * 1.14)} ${r1(cy - ry * 0.12)} ${r1(sx * rx * 1.12)} ${r1(cy + ry * 0.2)} ${r1(sx * rx * 1.0)} ${r1(cy + ry * 0.24)}`, darken(c.skin, 0.32), 1.4, {strokeOpacity: 0.7}));
    if (has(p, 'earrings')) out.push(el('ellipse', null, null, [], {cx: r1(sx * rx * 1.03), cy: r1(cy + ry * 0.42), rx: 2.6, ry: 2.6, fill: '#e3c068', stroke: '#9c7b2c', strokeWidth: 0.8}));
  }
  if (has(p, 'hearing-aid')) out.push(strokeLine(`M${r1(rx * 1.1)} ${r1(cy - ry * 0.2)}Q${r1(rx * 1.3)} ${r1(cy)} ${r1(rx * 1.12)} ${r1(cy + ry * 0.24)}`, c.accent, 4.4));
  return out;
}

function facialHair(ctx) {
  const {g, p, P, c, look} = ctx;
  const {rx, ry, cy} = g.head;
  const out = [];
  const hair = c.hair;
  const mouthHole = `M${r1(-look.mw * 0.62)} ${r1(look.mouthY)}C${r1(-look.mw * 0.62)} ${r1(look.mouthY - ry * 0.12)} ${r1(look.mw * 0.62)} ${r1(look.mouthY - ry * 0.12)} ${r1(look.mw * 0.62)} ${r1(look.mouthY)}C${r1(look.mw * 0.62)} ${r1(look.mouthY + ry * 0.12)} ${r1(-look.mw * 0.62)} ${r1(look.mouthY + ry * 0.12)} ${r1(-look.mw * 0.62)} ${r1(look.mouthY)}Z`;
  const jaw = (top, chin) => `M${r1(-rx * 0.97)} ${r1(cy + ry * top)}C${r1(-rx * 0.96)} ${r1(cy + ry * 0.5)} ${r1(-rx * 0.6)} ${r1(cy + ry * chin)} 0 ${r1(cy + ry * chin)}C${r1(rx * 0.6)} ${r1(cy + ry * chin)} ${r1(rx * 0.96)} ${r1(cy + ry * 0.5)} ${r1(rx * 0.97)} ${r1(cy + ry * top)}L${r1(rx * 0.84)} ${r1(cy + ry * (top + 0.06))}C${r1(rx * 0.7)} ${r1(cy + ry * 0.4)} ${r1(rx * 0.34)} ${r1(look.mouthY - ry * 0.1)} 0 ${r1(look.mouthY - ry * 0.16)}C${r1(-rx * 0.34)} ${r1(look.mouthY - ry * 0.1)} ${r1(-rx * 0.7)} ${r1(cy + ry * 0.4)} ${r1(-rx * 0.84)} ${r1(cy + ry * (top + 0.06))}Z`;
  const tex = (d) => [P.piece(d, hair, {rule: 'evenodd', width: 1.4}), ...P.strands(d, hair, 'evenodd', 'beard')];
  if (has(p, 'stubble')) out.push(pathNode(`${jaw(0.08, 1.04)}${mouthHole}`, {fill: mix(hair, c.skin, 0.4), opacity: 0.38, fillRule: 'evenodd'}));
  if (has(p, 'beard')) out.push(...tex(`${jaw(0.02, 1.14)}${mouthHole}`));
  if (has(p, 'long-beard')) out.push(...tex(`${jaw(0.02, 1.75)}${mouthHole}`));
  if (has(p, 'goatee')) out.push(...tex(`M${r1(-look.mw * 0.5)} ${r1(look.mouthY + ry * 0.1)}Q0 ${r1(look.mouthY + ry * 0.06)} ${r1(look.mw * 0.5)} ${r1(look.mouthY + ry * 0.1)}Q${r1(look.mw * 0.42)} ${r1(cy + ry * 1.08)} 0 ${r1(cy + ry * 1.1)}Q${r1(-look.mw * 0.42)} ${r1(cy + ry * 1.08)} ${r1(-look.mw * 0.5)} ${r1(look.mouthY + ry * 0.1)}Z`));
  if (has(p, 'moustache') || has(p, 'goatee') || has(p, 'beard') || has(p, 'long-beard')) {
    const y = look.mouthY - ry * 0.05;
    out.push(...tex(`M${r1(-look.mw * 0.66)} ${r1(y + ry * 0.04)}Q${r1(-look.mw * 0.3)} ${r1(y - ry * 0.12)} 0 ${r1(y - ry * 0.06)}Q${r1(look.mw * 0.3)} ${r1(y - ry * 0.12)} ${r1(look.mw * 0.66)} ${r1(y + ry * 0.04)}Q${r1(look.mw * 0.3)} ${r1(y + ry * 0.01)} 0 ${r1(y + ry * 0.02)}Q${r1(-look.mw * 0.3)} ${r1(y + ry * 0.01)} ${r1(-look.mw * 0.66)} ${r1(y + ry * 0.04)}Z`));
  }
  if (has(p, 'sideburns')) for (const sx of [-1, 1]) out.push(...tex(`M${r1(sx * rx * 0.98)} ${r1(cy - ry * 0.18)}L${r1(sx * rx * 0.82)} ${r1(cy - ry * 0.18)}L${r1(sx * rx * 0.84)} ${r1(cy + ry * 0.3)}L${r1(sx * rx * 0.98)} ${r1(cy + ry * 0.26)}Z`));
  return out;
}

function eyewear(ctx) {
  const {p, look} = ctx;
  const kind = ['glasses', 'round-glasses', 'sunglasses', 'cat-eye-glasses'].find(name => has(p, name));
  if (!kind) return [];
  const frame = '#26222a';
  const {ex, ew, eh, eyeY} = look;
  const w = ew * 0.82, h = eh * 1.5;
  const lens = sx => {
    const cx = sx * ex;
    if (kind === 'round-glasses') return ellipsePath(cx, eyeY + 0.5, w * 0.92, w * 0.88);
    if (kind === 'cat-eye-glasses') return `M${r1(cx - w)} ${r1(eyeY - h * (sx < 0 ? 1.05 : 0.7))}L${r1(cx + w)} ${r1(eyeY - h * (sx < 0 ? 0.7 : 1.05))}Q${r1(cx + w * 0.95)} ${r1(eyeY + h * 0.9)} ${r1(cx)} ${r1(eyeY + h * 0.9)}Q${r1(cx - w * 0.95)} ${r1(eyeY + h * 0.9)} ${r1(cx - w)} ${r1(eyeY - h * (sx < 0 ? 1.05 : 0.7))}Z`;
    return `M${r1(cx - w)} ${r1(eyeY - h * 0.8)}L${r1(cx + w)} ${r1(eyeY - h * 0.8)}Q${r1(cx + w)} ${r1(eyeY + h * 0.95)} ${r1(cx)} ${r1(eyeY + h * 0.95)}Q${r1(cx - w)} ${r1(eyeY + h * 0.95)} ${r1(cx - w)} ${r1(eyeY - h * 0.8)}Z`;
  };
  const dark = kind === 'sunglasses';
  return [
    ...[-1, 1].map(sx => pathNode(lens(sx), {fill: dark ? '#1b1d24' : '#ffffff', fillOpacity: dark ? 0.92 : 0.12, stroke: frame, strokeWidth: kind === 'cat-eye-glasses' ? 2.8 : 2, strokeLinejoin: 'round'})),
    ...(dark ? [-1, 1].map(sx => strokeLine(`M${r1(sx * ex - w * 0.5)} ${r1(eyeY - h * 0.3)}L${r1(sx * ex - w * 0.1)} ${r1(eyeY - h * 0.6)}`, '#ffffff', 1.4, {strokeOpacity: 0.35})) : []),
    strokeLine(`M${r1(-ex + w)} ${r1(eyeY - h * 0.45)}Q0 ${r1(eyeY - h * 0.8)} ${r1(ex - w)} ${r1(eyeY - h * 0.45)}`, frame, 1.8),
    ...[-1, 1].map(sx => strokeLine(`M${r1(sx * (ex + w))} ${r1(eyeY - h * 0.6)}L${r1(sx * ctx.g.head.rx * 0.98)} ${r1(eyeY - h * 0.5)}`, frame, 1.8))
  ];
}

// ---------------------------------------------------------------------------
// Limbs

function hand(ctx, side, wristY) {
  const {g, c, P} = ctx;
  const hw = g.armW * 0.62, pl = g.hand * 0.5, fl = g.hand * 0.5;
  const y0 = wristY - 3;
  const skin = c.skin;
  const out = [P.piece(`M${r1(-hw * 0.46)} ${r1(y0)}L${r1(hw * 0.46)} ${r1(y0)}C${r1(hw * 0.56)} ${r1(y0 + pl * 0.4)} ${r1(hw * 0.6)} ${r1(y0 + pl * 0.8)} ${r1(hw * 0.54)} ${r1(y0 + pl)}L${r1(-hw * 0.54)} ${r1(y0 + pl)}C${r1(-hw * 0.6)} ${r1(y0 + pl * 0.8)} ${r1(-hw * 0.56)} ${r1(y0 + pl * 0.4)} ${r1(-hw * 0.46)} ${r1(y0)}Z`, skin, {form: 'cyl', width: 1.3, rimWidth: 3})];
  const lengths = [0.78, 0.96, 1, 0.88];
  const tilt = [7, 2, -2, -6];
  for (let i = 0; i < 4; i++) {
    const x = -hw * 0.39 + (i * hw * 0.78) / 3;
    const fw = hw * 0.25;
    out.push(placedGroup([P.piece(capsulePath(0, fl * lengths[i] - fw * 0.5, fw), skin, {form: 'cyl', width: 1.1, rim: false})], {at: [x, y0 + pl - fw * 0.4], angle: tilt[i]}));
  }
  // The thumb, toward the body's midline.
  out.push(placedGroup([P.piece(capsulePath(0, fl * 0.62, hw * 0.3), skin, {form: 'cyl', width: 1.1, rim: false})], {at: [hw * 0.46, y0 + pl * 0.28], angle: -26}));
  // Knuckle shading.
  out.push(strokeLine(`M${r1(-hw * 0.48)} ${r1(y0 + pl * 0.94)}Q0 ${r1(y0 + pl * 1.02)} ${r1(hw * 0.48)} ${r1(y0 + pl * 0.94)}`, darken(skin, 0.3), 1, {strokeOpacity: 0.45}));
  return out;
}

function arm(ctx, side) {
  const {g, p, j, P, c} = ctx;
  const s = side === 'l' ? 'L' : 'R';
  const mirror = side === 'r';
  const top = p.outfit.top;
  const long = LONG.has(top);
  const tank = top === 'tank';
  const robot = side === 'r' && p.mobility === 'prosthetic-arm';
  const W = g.armW;
  const wristY = g.foreArm;
  const handY = wristY + g.hand * 0.3;
  const aid = aidSide(p, ctx.facing) === side ? (-(g.hipY + g.armY) - g.upperArm * 0.99 - g.foreArm * 0.98 - g.hand * 0.3) / 0.985 : 0;
  return P.within({mirror, falloff: ctx.falloff.torso}, () => {
    const finger = joint(ctx, `finger-${side}`, 0, wristY + g.hand * 0.42, {}, [P.piece(capsulePath(0, g.hand * 0.66, W * 0.17), c.skin, {form: 'cyl', width: 1.1, rim: false})]);
    const fingerWrap = ctx.static ? (j[`finger${s}`] ? finger : null) : el('g', `${ctx.id}-fingerwrap-${side}`, {opacity: j[`finger${s}`]}, [finger]);
    const foreKids = robot ? [...(fingerWrap ? [fingerWrap] : []), group(prostheticForearm(ctx), {})] : [
      P.piece(limbPath(g.foreArm, W * 0.86, W * 0.9, W * 0.56, 0.25, 0, 1.5), c.skin, {form: 'cyl'}),
      ...(long ? [
        P.piece(limbPath(g.foreArm * 0.9, W * 1.02, W * 0.98, W * 0.84, 0.3), c.top, {form: 'cyl'}),
        P.piece(`M${r1(-W * 0.44)} ${r1(g.foreArm * 0.84)}L${r1(W * 0.44)} ${r1(g.foreArm * 0.84)}L${r1(W * 0.42)} ${r1(g.foreArm * 0.94)}L${r1(-W * 0.42)} ${r1(g.foreArm * 0.94)}Z`, darken(c.top, 0.1), {rim: false, width: 1}),
        strokeLine(`M${r1(-W * 0.3)} ${r1(g.foreArm * 0.2)}Q${r1(W * 0.05)} ${r1(g.foreArm * 0.3)} ${r1(W * 0.34)} ${r1(g.foreArm * 0.22)}`, darken(c.top, 0.3), 1.4, {strokeOpacity: 0.4})
      ] : []),
      ...wristWear(ctx, side),
      ...(fingerWrap ? [fingerWrap] : []),
      ...hand(ctx, side, wristY)
    ];
    if (aid) foreKids.push(group([group(heldAid(ctx, aid / 0.5, -g.foreArm * 1.0), {transform: 'scale(0.5 0.5)'})], {transform: `translate(0 ${r1(handY)})`}));
    if (ctx.props?.[side]) foreKids.push(group([group(ctx.props[side], {transform: 'scale(0.62 0.62)'})], {transform: `translate(0 ${r1(handY)})`}));
    const fore = joint(ctx, `fore-${side}`, 0, g.upperArm, {rotation: j[`fore${s}`]}, foreKids);
    const upper = [P.piece(limbPath(g.upperArm, W * 0.92, W * 1.04, W * 0.8, 0.3, -4, 2), c.skin, {form: 'cyl'})];
    if (long) upper.push(P.piece(limbPath(g.upperArm + 6, W * 1.02, W * 1.12, W * 0.98, 0.3, -6), c.top, {form: 'cyl', edge: false, rim: false}), strokeLine(`M${r1(-W * 0.4)} ${r1(g.upperArm * 0.92)}Q0 ${r1(g.upperArm * 1.0)} ${r1(W * 0.42)} ${r1(g.upperArm * 0.9)}`, darken(c.top, 0.3), 1.4, {strokeOpacity: 0.45}));
    else if (!tank) upper.push(P.piece(limbPath(g.upperArm * 0.46, W * 1.06, W * 1.2, W * 1.16, 0.4, -6), c.top, {form: 'cyl', edge: false, rim: false}), strokeLine(`M${r1(-W * 0.58)} ${r1(g.upperArm * 0.44)}L${r1(W * 0.58)} ${r1(g.upperArm * 0.44)}`, darken(c.top, 0.28), 1.6, {strokeOpacity: 0.5}));
    return joint(ctx, `arm-${side}`, side === 'l' ? -g.armX : g.armX, g.armY, {rotation: j[`arm${s}`], y: j.shoulderY}, [...upper, fore], {mirror});
  });
}

function shoe(ctx, y) {
  const {g, c, P} = ctx;
  const sw = g.legW * 0.5, b = y + g.foot;
  const color = c.shoes;
  const upper = `M${r1(-sw * 0.62)} ${r1(y + 2)}C${r1(-sw * 0.7)} ${r1(y - 6)} ${r1(sw * 0.2)} ${r1(y - 8)} ${r1(sw * 0.4)} ${r1(y + 4)}C${r1(sw * 1.2)} ${r1(y + g.foot * 0.35)} ${r1(sw * 1.5)} ${r1(b - g.foot * 0.3)} ${r1(sw * 1.42)} ${r1(b - 5)}L${r1(-sw * 0.72)} ${r1(b - 5)}C${r1(-sw * 0.8)} ${r1(b - g.foot * 0.5)} ${r1(-sw * 0.78)} ${r1(y + g.foot * 0.3)} ${r1(-sw * 0.62)} ${r1(y + 2)}Z`;
  return [
    P.piece(upper, color, {width: 1.6}),
    pathNode(`M${r1(-sw * 0.76)} ${r1(b - 7)}L${r1(sw * 1.46)} ${r1(b - 7)}Q${r1(sw * 1.5)} ${r1(b)} ${r1(sw * 1.3)} ${r1(b)}L${r1(-sw * 0.66)} ${r1(b)}Q${r1(-sw * 0.82)} ${r1(b)} ${r1(-sw * 0.76)} ${r1(b - 7)}Z`, {fill: luma(color) > 0.6 ? '#d9d4cc' : darken(color, 0.45)}),
    strokeLine(`M${r1(sw * 0.1)} ${r1(y + 6)}L${r1(sw * 0.55)} ${r1(y + 10)}M${r1(sw * 0.2)} ${r1(y + 12)}L${r1(sw * 0.7)} ${r1(y + 16)}`, luma(color) > 0.6 ? '#9b958d' : lighten(color, 0.3), 1.2, {strokeOpacity: 0.7})
  ];
}

function leg(ctx, side) {
  const {g, p, j, P, c} = ctx;
  const s = side === 'l' ? 'L' : 'R';
  const mirror = side === 'r';
  const bottom = p.outfit.bottom;
  const covered = COVERED_LEGS.has(bottom);
  const prosthetic = side === 'l' && p.mobility === 'prosthetic-leg';
  const L = g.legW;
  return P.within({mirror, falloff: ctx.falloff.legs}, () => {
    const shinKids = prosthetic ? [group(prostheticShin(ctx, 'bottom'), {})] : covered ? [
      P.piece(limbPath(g.shin, L * 0.74, L * 0.7, bottom === 'leggings' ? L * 0.42 : L * 0.58, 0.3, -8), c.bottom, {form: 'cyl'}),
      strokeLine(`M${r1(-L * 0.3)} ${r1(g.shin * 0.08)}Q0 ${r1(g.shin * 0.14)} ${r1(L * 0.32)} ${r1(g.shin * 0.06)}`, darken(c.bottom, 0.3), 1.4, {strokeOpacity: 0.4})
    ] : [P.piece(limbPath(g.shin, L * 0.62, L * 0.7, L * 0.36, 0.28, -6, 3), c.skin, {form: 'cyl'})];
    const shin = joint(ctx, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, [...shinKids, group(shoe(ctx, g.shin), {transform: 'scale(-1 1)'})]);
    const thigh = [];
    if (covered) thigh.push(P.piece(limbPath(g.thigh, L * 1.06, L * 1.02, L * 0.76, 0.2, -10), c.bottom, {form: 'cyl'}), strokeLine(`M${r1(-L * 0.2)} ${r1(g.thigh * 0.55)}Q${r1(L * 0.05)} ${r1(g.thigh * 0.75)} ${r1(-L * 0.05)} ${r1(g.thigh * 0.95)}`, darken(c.bottom, 0.3), 1.3, {strokeOpacity: 0.35}));
    else {
      thigh.push(P.piece(limbPath(g.thigh, L, L * 0.96, L * 0.62, 0.2, -8), c.skin, {form: 'cyl'}));
      if (bottom === 'shorts') thigh.push(P.piece(limbPath(g.thigh * 0.56, L * 1.14, L * 1.14, L * 1.08, 0.4, -12), c.bottom, {form: 'cyl'}));
    }
    return joint(ctx, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY + 10, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, ...thigh], {mirror});
  });
}

function hips(ctx) {
  const {g, p, P, c} = ctx;
  const y = g.hipY, H = g.hip;
  return P.within({falloff: ctx.falloff.legs * 0.6}, () => {
    if (p.outfit.bottom === 'skirt' || p.outfit.bottom === 'long-skirt') {
      const long = p.outfit.bottom === 'long-skirt';
      const fill = p.outfit.top === 'dress' ? c.top : c.bottom;
      const y1 = r1(y + (long ? (g.thigh + g.shin) * 0.88 : g.thigh * 0.72));
      const w1 = H + (long ? 44 : 30);
      const d = `M${r1(-H + 4)} ${r1(y - 26)}L${r1(H - 4)} ${r1(y - 26)}C${r1(H + 6)} ${r1(y)} ${r1(w1 - 6)} ${r1(y1 - 60)} ${r1(w1)} ${r1(y1 - 4)}Q${r1(w1 * 0.5)} ${r1(y1 + 6)} 0 ${r1(y1)}Q${r1(-w1 * 0.5)} ${r1(y1 + 6)} ${r1(-w1)} ${r1(y1 - 4)}C${r1(-w1 + 6)} ${r1(y1 - 60)} ${r1(-H - 6)} ${r1(y)} ${r1(-H + 4)} ${r1(y - 26)}Z`;
      return [P.piece(d, fill), ...[-0.45, 0.1, 0.55].map(t => strokeLine(`M${r1(t * H * 0.6)} ${r1(y + 10)}Q${r1(t * w1 * 0.8)} ${r1((y + y1) / 2)} ${r1(t * w1 * 0.92)} ${r1(y1 - 6)}`, darken(fill, 0.28), 1.6, {strokeOpacity: 0.4}))];
    }
    const d = `M${r1(-H)} ${r1(y - 28)}L${r1(H)} ${r1(y - 28)}C${r1(H + 3)} ${r1(y + 6)} ${r1(H)} ${r1(y + 30)} ${r1(g.legX + g.legW * 0.5)} ${r1(y + 44)}L${r1(4)} ${r1(y + 56)}L${r1(-4)} ${r1(y + 56)}L${r1(-g.legX - g.legW * 0.5)} ${r1(y + 44)}C${r1(-H)} ${r1(y + 30)} ${r1(-H - 3)} ${r1(y + 6)} ${r1(-H)} ${r1(y - 28)}Z`;
    return [P.piece(d, c.bottom), strokeLine(`M0 ${r1(y - 20)}L0 ${r1(y + 40)}`, darken(c.bottom, 0.3), 1.3, {strokeOpacity: 0.4})];
  });
}

// ---------------------------------------------------------------------------
// Assembly

/**
 * Draw one lifelike character (options as toon.mjs drawToon, plus light).
 * style options: {cinematic, falloff: {torso, legs}}.
 */
export function drawReal(params, colors, {id, joints, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null, facing = 'right', light = null}, {cinematic = false, falloff = {torso: 0, legs: 0}} = {}) {
  const g = realGeometry(params);
  const toonG = rigGeometry(params);
  const c = toonColors(colors);
  const P = realPen(c, {id, light, cinematic});
  const lx = light?.x ?? -0.57;
  const {rx, ry, cy} = g.head;
  const ew = rx * 0.36, eh = ew * 0.42;
  const grey = GREY_HAIR.includes(params.hair.color) || params.hair.style === 'headscarf' || params.hair.style === 'bald';
  const look = {
    ex: rx * 0.41, ew, eh, eyeY: cy + ry * 0.04, browY: cy + ry * 0.04 - eh * 2.3, mouthY: cy + ry * 0.63, mw: rx * 0.6,
    headK: ry / 110 * 0.8, lx, gaze: facing === 'left' ? -1 : 1,
    iris: irisColor(params, c),
    brow: grey ? darken(c.hairShade ?? c.hair, 0.15) : darken(c.hair, 0.12),
    lipTop: mix('#8e3f44', c.skin, 0.5), lipLow: mix('#b9625f', c.skin, 0.45)
  };
  look.blushGrad = P.def('rblush', defId => radialGradient(defId, {}, [[0, mix('#e0625f', c.skin, 0.4), 0.55], [1, c.skin, 0]]));
  look.socketGrad = P.def('rsocket', defId => radialGradient(defId, {cy: 0.6}, [[0, darken(c.skin, 0.3), 0.32], [1, darken(c.skin, 0.3), 0]]));
  const ctx = {id, g, c, p: params, j: joints, expression, static: isStatic, props, P, facing, look, falloff};
  // Toon parts (hair, headwear, outfit details) painted by this pen on a toon-shaped frame, scaled onto this body.
  const toonCtx = {...ctx, g: toonG};
  const t = toonG.head;
  // Toon hair sits a little inside its egg's outline; a touch larger, it covers the scalp here.
  const onHead = (kids, grow = 1.06) => group(kids, {transform: `translate(0 ${r1(cy)}) scale(${r1((rx / t.rx) * grow * 1000) / 1000} ${r1((ry / t.ry) * (grow + 0.02) * 1000) / 1000}) translate(0 ${r1(-t.cy)})`});
  const onTorso = kids => group(kids, {transform: `scale(${r1((g.shoulder / toonG.shoulder) * 920) / 1000} ${r1((g.torso / toonG.torso) * 1000) / 1000})`});

  const faces = [...new Set([expression, ...expressions])].map(name => faceNode(ctx, name)).filter(Boolean);
  const headKids = [
    ...ears(ctx),
    P.piece(headOutline(g.head, params.build === 'round' || params.build === 'stocky' ? 1.08 : 1), c.skin, {width: 1.6}),
    ...faceBase(ctx),
    ...facialHair(ctx),
    ...faces,
    ...eyewear(ctx),
    ...(covers(params) ? [] : [onHead(hairFront(toonCtx))]),
    onHead(headwear(toonCtx), 1.02)
  ];
  const tilt = {rotation: joints.head, y: joints.headY};
  const headIdle = joint(ctx, 'headidle', 0, 0, {}, headKids);
  const backIdle = joint(ctx, 'hbidle', 0, 0, {}, params.headwear === 'turban' ? [] : [onHead(hairBack(toonCtx))]);
  const neckW = rx * 0.48;
  const torsoKids = P.within({falloff: falloff.torso}, () => [
    joint(ctx, 'hb', 0, g.neckY, tilt, [backIdle]),
    P.piece(`M${r1(-neckW)} ${r1(-g.torso + 12)}L${r1(-neckW * 0.9)} ${r1(g.neckY - 6)}L${r1(neckW * 0.9)} ${r1(g.neckY - 6)}L${r1(neckW)} ${r1(-g.torso + 12)}Z`, c.skin, {form: 'cyl', rim: false}),
    el('ellipse', null, null, [], {cx: 0, cy: r1(g.neckY + 4), rx: r1(neckW * 1.05), ry: r1(ry * 0.16), fill: darken(c.skin, 0.4), opacity: 0.35}),
    onTorso(backpackBack(toonCtx)),
    P.piece(torsoOutline(g, neckW), c.top),
    ...[-1, 1].map(sx => strokeLine(`M${r1(sx * (g.shoulder - g.armW * 0.25))} ${r1(-g.torso + 90)}Q${r1(sx * g.waist * 0.7)} ${r1(-g.torso * 0.62)} ${r1(sx * g.waist * 0.5)} ${r1(-g.torso * 0.5)}`, darken(c.top, 0.3), 1.6, {strokeOpacity: 0.38})),
    onTorso([...longHem(toonCtx), ...outfit(toonCtx)]),
    joint(ctx, 'head', 0, g.neckY, tilt, [headIdle]),
    arm(ctx, 'l'),
    arm(ctx, 'r')
  ]);
  const breath = joint(ctx, 'breath', 0, 0, {}, torsoKids);
  const torso = joint(ctx, 'torso', 0, g.hipY, {rotation: joints.lean, scaleY: joints.squash}, [breath]);
  const body = joint(ctx, 'body', 0, 0, {y: joints.bodyY}, [leg(ctx, 'l'), leg(ctx, 'r'), ...hips(ctx), torso]);
  const ground = asShadow(P.ground(g.hip * 1.6));
  const chair = params.mobility === 'wheelchair' ? [group(wheelchair(ctx), {})] : [];
  const defs = P.defs();
  return group([...defs, ...ground, ...chair, body]);
}
