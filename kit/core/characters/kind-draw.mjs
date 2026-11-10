// Drawing the character kinds that are not people (kinds.mjs): animals,
// mascots and objects with faces. Each is a few simple shapes on the rig's
// own joints, with the toon's cute face (toon.mjs face: large glossy eyes,
// a small mouth, blushing cheeks), so one op list acts a person, a cat and a
// coffee cup alike.
//
// Two body plans:
//   headed  a trunk with a head above it (animals, the robot). The head
//           tilts on C-head, turns on C-turn and its features cross it on
//           C-gaze, as a person's do.
//   single  one body that carries the face (mascots, most objects). The
//           face is the "head": it tilts on C-head about its chin and moves
//           across the body for a look; the body leans and squashes on
//           C-torso. Seen from behind, the face is gone.
//
// Part ids are the toon's (toon.mjs): C-body, C-torso, C-breath, C-head,
// C-hb, C-headidle, C-hbidle, C-arm-*, C-fore-*, C-finger-*, C-fingerwrap-*,
// C-leg-*, C-shin-*, C-turn, C-gaze, C-face-*, C-eyes-*, C-mouth-*, C-open-*,
// C-back, C-front, C-face-front.
//
// A kind is drawn at its medium size and then resized (KIND_SIZE_SCALE):
// shapes, pivots and line weights scale; joint values do not, so the op list
// moves every size the same way.
//
// The pen follows the cast's drawing style: flat fills with one even heavy
// outline (the chibi line) for most, line art for line and stick-classic,
// comic ink for outlined, cut paper for paper, soft shading for the shaded
// and realistic styles.
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {asHead, backView, face, faceView, frontView, gazeJoint, svgTransform, turnJoint} from './toon.mjs';
import {asShadow} from './bounds.mjs';
import {flatPen, placed} from './style-flat.mjs';
import {linePen} from './style-line.mjs';
import {outlinedPen} from './style-outlined.mjs';
import {paperPen} from './style-paper.mjs';
import {softShadePen} from './style-soft-shade.mjs';
import {luma} from './pens.mjs';
import {KINDS, KIND_SIZE_SCALE, kindDims, kindGeometry} from './kinds.mjs';

const n = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);

// ---------------------------------------------------------------------------
// Pens

const BASE = 7;
// The outline, in flat's outline widths (the chibi style's line).
const INK = 1.45;
const PAPER = '#fbf9f4';

/** A pen whose outlines and lines are k times as heavy (flat: its limbs and strands too). */
function weighted(pen, k, flat) {
  const out = {
    ...pen,
    shape: (d, fill, o = {}) => pen.shape(d, fill, {...o, width: (o.width ?? BASE) * k}),
    ellipse: (cx, cy, rx, ry, fill, o = {}) => pen.ellipse(cx, cy, rx, ry, fill, {...o, width: (o.width ?? BASE) * k}),
    line: (d, color, width) => pen.line(d, color, width * k)
  };
  if (flat) {
    const ink = BASE * k;
    const limb = (d, fill, width) => [pen.line(d, 'outline', width + ink * 2), pen.line(d, fill, width)];
    out.limb = (length, width, fill, from = 0, place = null) => {
      const nodes = limb(`M0 ${n(from)}L0 ${n(length)}`, fill, width);
      return place ? [placed(nodes, place)] : nodes;
    };
    out.strand = limb;
  }
  return out;
}

const STYLE_PENS = {line: linePen, 'stick-classic': linePen, outlined: outlinedPen, paper: paperPen, 'soft-shade': softShadePen, avatar: softShadePen, lifelike: softShadePen, cinematic: softShadePen};
const LINE_ART = ['line', 'stick-classic'];

/** The pen a kind is drawn with in a drawing style, and the face's pen (lighter by the face's scale). */
function pens(style, colors, faceColors, {id, light}, faceK) {
  const make = STYLE_PENS[style];
  if (!make) {
    const P = weighted(flatPen(colors), INK, true);
    return {P, F: weighted(weighted(flatPen(faceColors), INK, true), 1 / faceK, true)};
  }
  return {P: make(colors, {id, light}), F: weighted(make(faceColors, {id: `${id}-f`, light}), 1 / faceK, false)};
}

// ---------------------------------------------------------------------------
// Paths (absolute M, L, Q, C, Z only: bounds.mjs reads them)

const rr = (x0, y0, x1, y1, r) => `M${n(x0 + r)} ${n(y0)}L${n(x1 - r)} ${n(y0)}Q${n(x1)} ${n(y0)} ${n(x1)} ${n(y0 + r)}L${n(x1)} ${n(y1 - r)}Q${n(x1)} ${n(y1)} ${n(x1 - r)} ${n(y1)}L${n(x0 + r)} ${n(y1)}Q${n(x0)} ${n(y1)} ${n(x0)} ${n(y1 - r)}L${n(x0)} ${n(y0 + r)}Q${n(x0)} ${n(y0)} ${n(x0 + r)} ${n(y0)}Z`;
const poly = (...p) => {
  let d = '';
  for (let i = 0; i < p.length; i += 2) d += `${i ? 'L' : 'M'}${n(p[i])} ${n(p[i + 1])}`;
  return `${d}Z`;
};
/** A dome: round above, a soft flat base at y = 22 (w half-width, h tall, the widest point `at` of the way up). */
const dome = (w, h, at = 0.42, r = 58) => `M${-w} ${n(-h * at)}C${-w} ${n(-h * (at + 0.4))} ${n(-w * 0.62)} ${-h} 0 ${-h}C${n(w * 0.62)} ${-h} ${w} ${n(-h * (at + 0.4))} ${w} ${n(-h * at)}L${w} ${n(22 - r * 0.96)}Q${w} 22 ${w - r} 22L${-w + r} 22Q${-w} 22 ${-w} ${n(22 - r * 0.96)}Z`;
/** A five-pointed star with round tips and soft inner corners. */
function starPath(cx, cy, ro, ri, round = 0.7) {
  const at = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const p = ([x, y]) => `${n(x)} ${n(y)}`;
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const tip = at(ro, a), before = at(ri, a - Math.PI / 5), after = at(ri, a + Math.PI / 5);
    d += `${i ? `Q${p(before)} ` : 'M'}${p(mix(before, tip, round))}Q${p(tip)} ${p(mix(after, tip, round))}`;
  }
  const first = at(ri, -Math.PI / 2 - Math.PI / 5), tip0 = at(ro, -Math.PI / 2);
  return `${d}Q${p(first)} ${p(mix(first, tip0, round))}Z`;
}

// ---------------------------------------------------------------------------
// Shapes. Each kind returns its parts at medium size:
//   behind     behind the body (a tail, a sprout), in the torso's frame
//   body       the trunk or the single body
//   front      details on the body's front (hidden when it turns its back)
//   ears       on the head, under its outline            (headed)
//   head       the head's outline (the first shape is the outline)   (headed)
//   marks      on the head, over the outline, under the face (headed)
//   crown      on the head, over the face                (headed)
//   features   under the face, moving with it, in toon face units (the eyes
//              at ±40, 26; the mouth at 0, 54)
//   dy         the face's centre below the head's, in head half-heights
//   look       {limb, hand, foot}: the limbs' colours
// Frames: the torso's has the hips at 0, 0 (up is negative); the head's has
// the head's centre at 0, hc.

/** An animal's trunk (a soft pear) and belly. */
function trunk(d, P, {belly = 'detail'} = {}) {
  const T = d.torso, S = d.shoulder, H = d.hip;
  const path = `M${-S + 34} ${-T}L${S - 34} ${-T}Q${S} ${-T} ${S + 4} ${-T + 40}C${S + 16} ${n(-T * 0.55)} ${H + 10} ${n(-T * 0.28)} ${H} -14L${H} 6Q${H} 26 ${H - 22} 26L${-H + 22} 26Q${-H} 26 ${-H} 6L${-H} -14C${-H - 10} ${n(-T * 0.28)} ${-S - 16} ${n(-T * 0.55)} ${-S - 4} ${-T + 40}Q${-S} ${-T} ${-S + 34} ${-T}Z`;
  return {body: [P.shape(path, 'body')], front: belly ? [P.ellipse(0, -T * 0.4, S * 0.68, T * 0.4, belly, {outline: false})] : []};
}

const muzzle = (F, rx = 32, ry = 22, fill = 'detail') => F.ellipse(0, 52, rx, ry, fill, {outline: false});
const nose = (F, fill, rx = 8.5, ry = 6) => F.ellipse(0, 40, rx, ry, fill, {outline: false});
const beak = F => F.shape('M-10 35Q0 31 10 35Q6 47 0 49Q-6 47 -10 35Z', 'accent', {width: 3.5});
const both = draw => [-1, 1].flatMap(sx => draw(sx));
const FUR = {limb: 'body', hand: 'body', foot: 'body'};

const SHAPES = {
  cat(d, P, F) {
    const {rx, ry} = d, hc = -d.up, H = d.hip;
    return {
      ...trunk(d, P), look: FUR,
      behind: P.strand(`M${H - 26} -26C${H + 96} -10 ${H + 118} -124 ${H + 62} -176`, 'body', 30),
      ears: both(sx => [P.shape(poly(sx * rx * 0.9, hc - ry * 0.34, sx * rx * 0.68, hc - ry - 84, sx * rx * 0.16, hc - ry * 0.84), 'body'), P.shape(poly(sx * rx * 0.76, hc - ry * 0.62, sx * rx * 0.64, hc - ry - 44, sx * rx * 0.36, hc - ry * 0.86), 'accent', {outline: false})]),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      features: [muzzle(F, 30, 21), nose(F, 'accent', 7.5, 5.5), ...both(sx => [F.line(`M${sx * 68} 45L${sx * 88} 41M${sx * 68} 53L${sx * 88} 55`, 'outline', 3.2)])]
    };
  },
  dog(d, P, F) {
    const {rx, ry} = d, hc = -d.up, H = d.hip;
    return {
      ...trunk(d, P), look: FUR,
      behind: P.strand(`M${H - 20} -40C${H + 50} -50 ${H + 76} -96 ${H + 70} -140`, 'accent', 26),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      marks: both(sx => [P.shape(`M${n(sx * rx * 0.56)} ${n(hc - ry * 0.86)}C${n(sx * rx * 1.14)} ${n(hc - ry * 0.98)} ${n(sx * rx * 1.26)} ${n(hc - ry * 0.1)} ${n(sx * rx * 1.08)} ${n(hc + ry * 0.36)}C${n(sx * rx * 0.94)} ${n(hc + ry * 0.52)} ${n(sx * rx * 0.76)} ${n(hc + ry * 0.2)} ${n(sx * rx * 0.76)} ${n(hc - ry * 0.3)}C${n(sx * rx * 0.76)} ${n(hc - ry * 0.6)} ${n(sx * rx * 0.68)} ${n(hc - ry * 0.76)} ${n(sx * rx * 0.56)} ${n(hc - ry * 0.86)}Z`, 'accent')]),
      features: [muzzle(F, 35, 24), nose(F, 'outline', 9.5, 6.8)]
    };
  },
  bear(d, P, F) {
    const {rx, ry} = d, hc = -d.up;
    return {
      ...trunk(d, P), look: FUR,
      ears: both(sx => [P.ellipse(sx * rx * 0.72, hc - ry * 0.76, 60, 60, 'body'), P.ellipse(sx * rx * 0.72, hc - ry * 0.76, 30, 30, 'detail', {outline: false})]),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      features: [muzzle(F, 37, 26), nose(F, 'accent', 10.5, 7.4)]
    };
  },
  rabbit(d, P, F) {
    const {rx, ry} = d, hc = -d.up, H = d.hip;
    return {
      ...trunk(d, P), look: FUR,
      behind: [P.ellipse(H + 4, -44, 36, 34, 'detail')],
      ears: both(sx => [P.ellipse(sx * rx * 0.42, hc - ry - 84, 46, 130, 'body'), P.ellipse(sx * rx * 0.42, hc - ry - 80, 21, 96, 'accent', {outline: false})]),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      features: [muzzle(F, 30, 21), nose(F, 'accent', 7.5, 5.5)]
    };
  },
  fox(d, P, F) {
    const {rx, ry} = d, hc = -d.up, H = d.hip;
    const cheeks = `M${n(-rx * 0.95)} ${n(hc + ry * 0.36)}C${n(-rx * 0.9)} ${n(hc + ry * 0.76)} ${n(-rx * 0.5)} ${n(hc + ry * 0.95)} 0 ${n(hc + ry * 0.95)}C${n(rx * 0.5)} ${n(hc + ry * 0.95)} ${n(rx * 0.9)} ${n(hc + ry * 0.76)} ${n(rx * 0.95)} ${n(hc + ry * 0.36)}C${n(rx * 0.6)} ${n(hc + ry * 0.4)} ${n(rx * 0.2)} ${n(hc + ry * 0.36)} 0 ${n(hc + ry * 0.2)}C${n(-rx * 0.2)} ${n(hc + ry * 0.36)} ${n(-rx * 0.6)} ${n(hc + ry * 0.4)} ${n(-rx * 0.95)} ${n(hc + ry * 0.36)}Z`;
    return {
      ...trunk(d, P), look: {limb: 'body', hand: 'accent', foot: 'accent'},
      behind: [P.shape(`M${H - 34} -16C${H + 70} 6 ${H + 184} -40 ${H + 160} -160C${H + 150} -214 ${H + 108} -244 ${H + 90} -250C${H + 104} -160 ${H + 40} -96 ${H - 34} -70Z`, 'body'), P.shape(`M${H + 163} -140C${H + 156} -208 ${H + 110} -242 ${H + 90} -250C${H + 98} -206 ${H + 86} -168 ${H + 163} -140Z`, 'detail', {width: 5})],
      ears: both(sx => [P.shape(poly(sx * rx * 0.94, hc - ry * 0.28, sx * rx * 0.62, hc - ry - 112, sx * rx * 0.1, hc - ry * 0.84), 'body'), P.shape(poly(sx * rx * 0.78, hc - ry * 0.62, sx * rx * 0.6, hc - ry - 62, sx * rx * 0.32, hc - ry * 0.88), 'accent', {outline: false})]),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      marks: [P.shape(cheeks, 'detail', {outline: false}), P.ellipse(0, hc, rx, ry, null)],
      features: [nose(F, 'accent', 9, 6.4)]
    };
  },
  frog(d, P, F) {
    const {rx, ry} = d, hc = -d.up;
    return {
      ...trunk(d, P), look: FUR, dy: -0.36,
      ears: both(sx => [P.ellipse(sx * 82, hc - ry * 0.78, 78, 78, 'body')]),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      marks: both(sx => [P.ellipse(sx * 82, hc - ry * 0.78, 71, 71, 'body', {outline: false})]),
      features: []
    };
  },
  penguin(d, P, F) {
    const {rx, ry} = d, hc = -d.up;
    return {
      ...trunk(d, P), look: {limb: 'body', hand: 'body', foot: 'accent'},
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      features: [F.ellipse(-27, 24, 39, 41, 'detail', {outline: false}), F.ellipse(27, 24, 39, 41, 'detail', {outline: false}), F.ellipse(0, 50, 54, 33, 'detail', {outline: false}), beak(F)]
    };
  },
  owl(d, P, F) {
    const {rx, ry} = d, hc = -d.up, T = d.torso;
    const t = trunk(d, P);
    return {
      ...t, look: {limb: 'body', hand: 'body', foot: 'accent'},
      front: [...t.front, ...[-T * 0.56, -T * 0.36].map(y => P.line(`M-30 ${n(y)}Q-15 ${n(y + 14)} 0 ${n(y)}Q15 ${n(y + 14)} 30 ${n(y)}`, 'bodyShade', 6))],
      ears: both(sx => [P.shape(poly(sx * rx * 0.97, hc - ry * 0.3, sx * rx * 1.02, hc - ry * 0.98, sx * rx * 0.5, hc - ry * 0.8), 'body')]),
      head: [P.ellipse(0, hc, rx, ry, 'body')],
      features: [F.ellipse(-40, 25, 32, 34, 'detail', {outline: false}), F.ellipse(40, 25, 32, 34, 'detail', {outline: false}), beak(F)]
    };
  },

  blob(d, P) {
    const {w, h} = d;
    return {
      look: FUR,
      behind: [P.line(`M0 ${-h + 8}Q2 ${-h - 30} 22 ${-h - 42}`, 'outline', 9), P.ellipse(40, -h - 46, 27, 16, 'accent')],
      body: [P.shape(dome(w, h, 0.44, 150), 'body')],
      front: [P.ellipse(-w * 0.5, -h * 0.78, 30, 17, 'bodyLight', {outline: false, opacity: 0.85})]
    };
  },
  droplet(d, P) {
    const {w: R, h} = d, cy = 22 - R;
    const path = `M0 ${-h}C${n(R * 0.36)} ${n(-h * 0.76)} ${R} ${n(cy - R * 0.92)} ${R} ${cy}C${R} ${n(cy + R * 0.56)} ${n(R * 0.56)} ${cy + R} 0 ${cy + R}C${n(-R * 0.56)} ${cy + R} ${-R} ${n(cy + R * 0.56)} ${-R} ${cy}C${-R} ${n(cy - R * 0.92)} ${n(-R * 0.36)} ${n(-h * 0.76)} 0 ${-h}Z`;
    return {
      look: FUR,
      body: [P.shape(path, 'body')],
      front: [P.line(`M${n(-R * 0.56)} ${n(cy - R * 0.62)}Q${n(-R * 0.4)} ${n(cy - R * 1.02)} ${n(-R * 0.2)} ${n(cy - R * 1.24)}`, 'bodyLight', 15)]
    };
  },
  star(d, P) {
    const yc = -200;
    return {
      look: FUR,
      body: [P.shape(starPath(0, yc, 304, 172), 'body')],
      front: [P.line(`M-74 ${yc - 168}Q-50 ${yc - 214} -22 ${yc - 232}`, 'bodyLight', 13)]
    };
  },
  monster(d, P) {
    const {w, h} = d;
    return {
      look: FUR,
      behind: both(sx => [P.shape(`M${n(sx * w * 0.66)} ${n(-h * 0.84)}Q${n(sx * w * 0.62)} ${-h - 50} ${n(sx * w * 0.44)} ${-h - 62}Q${n(sx * w * 0.4)} ${n(-h - 6)} ${n(sx * w * 0.26)} ${n(-h * 0.96)}Z`, 'accent')]),
      body: [P.shape(dome(w, h, 0.5), 'body')],
      front: [P.ellipse(0, -h * 0.17, w * 0.56, h * 0.14, 'detail', {outline: false}), P.ellipse(-w * 0.7, -h * 0.45, 17, 23, 'accent', {outline: false}), P.ellipse(w * 0.72, -h * 0.34, 14, 19, 'accent', {outline: false}), P.ellipse(-w * 0.62, -h * 0.84, 12, 15, 'accent', {outline: false})]
    };
  },

  phone(d, P) {
    const {w, h} = d;
    return {
      look: {limb: 'outline', hand: 'detail', foot: 'accent'},
      behind: [P.shape(rr(w - 8, -h * 0.74, w + 13, -h * 0.58, 6), 'accent')],
      body: [P.shape(rr(-w, -h, w, 22, 46), 'body')],
      front: [P.shape(rr(-w + 26, -h + 40, w - 26, -52, 24), 'detail', {width: 5}), P.shape(rr(-32, -h + 50, 32, -h + 68, 9), 'body', {outline: false}), P.line('M-36 -18L36 -18', 'bodyLight', 8)]
    };
  },
  laptop(d, P) {
    const {w, h} = d;
    return {
      look: {limb: 'outline', hand: 'detail', foot: 'accent'},
      body: [P.shape(rr(-w + 12, -h, w - 12, -84, 28), 'body'), P.shape(`M${-w} -96L${w} -96L${w + 32} -10Q${w + 36} 22 ${w + 6} 22L${-w - 6} 22Q${-w - 36} 22 ${-w - 32} -10Z`, 'body')],
      front: [P.shape(rr(-w + 40, -h + 28, w - 40, -126, 14), 'detail', {width: 5}), P.line(`M${-w + 44} -62L${w - 44} -62M${-w + 30} -30L${w - 30} -30`, 'bodyShade', 10), P.ellipse(0, -h + 14, 5, 5, 'accent', {outline: false})]
    };
  },
  cup(d, P) {
    const {w, h} = d, top = -h + 90, half = y => w - 12 - ((y - top) * 46) / (22 - top);
    return {
      look: {limb: 'outline', hand: 'body', foot: 'accent'},
      body: [
        P.shape(`M${-(w - 12)} ${top}L${w - 12} ${top}L${n(half(0))} 0Q${n(half(22) - 2)} 22 ${n(half(22) - 24)} 22L${n(-half(22) + 24)} 22Q${n(-half(22) + 2)} 22 ${n(-half(0))} 0Z`, 'body'),
        P.shape(rr(-w + 40, -h, w - 40, -h + 50, 22), 'detail'),
        P.shape(rr(-w + 2, -h + 38, w - 2, -h + 96, 20), 'detail'),
        P.ellipse(58, -h + 20, 17, 6, 'detailShade', {outline: false})
      ],
      front: [P.shape(poly(-half(-124), -124, half(-124), -124, half(-50), -50, -half(-50), -50), 'accent', {width: 5})]
    };
  },
  bulb(d, P) {
    const {w: R, h} = d, cy = -h + R;
    return {
      look: {limb: 'outline', hand: 'body', foot: 'accent'},
      behind: [P.line(`M${-R - 30} ${cy - R * 0.74}L${-R - 62} ${cy - R * 0.92}M0 ${-h - 28}L0 ${-h - 66}M${R + 30} ${cy - R * 0.74}L${R + 62} ${cy - R * 0.92}`, 'accent', 13)],
      body: [
        P.shape(rr(-56, -20, 56, 22, 16), 'detailShade'),
        P.shape(rr(-94, -136, 94, -6, 16), 'detail'),
        P.line('M-92 -92L92 -92M-92 -50L92 -50', 'detailShade', 7),
        P.shape(`M-94 -128C-94 -186 ${-R} ${n(cy + R * 0.56)} ${-R} ${cy}C${-R} ${n(cy - R * 0.552)} ${n(-R * 0.552)} ${-h} 0 ${-h}C${n(R * 0.552)} ${-h} ${R} ${n(cy - R * 0.552)} ${R} ${cy}C${R} ${n(cy + R * 0.56)} 94 -186 94 -128Z`, 'body')
      ],
      front: [P.line(`M${n(-R * 0.62)} ${n(cy - R * 0.36)}Q${n(-R * 0.52)} ${n(cy - R * 0.66)} ${n(-R * 0.24)} ${n(cy - R * 0.8)}`, 'bodyLight', 14)]
    };
  },
  robot(d, P) {
    const {rx, ry} = d, hc = -d.up, T = d.torso, S = d.shoulder;
    return {
      look: {limb: 'outline', hand: 'detail', foot: 'accent'},
      body: [P.shape(rr(-34, -T - 24, 34, -T + 14, 8), 'detailShade'), P.shape(rr(-S, -T, S, 24, 30), 'body')],
      front: [P.shape(rr(-S + 40, -T + 44, S - 40, -T + 132, 14), 'detail', {width: 5}), P.ellipse(-S + 74, -T + 88, 15, 15, 'accent', {width: 4}), P.line(`M${S - 100} ${-T + 74}L${S - 58} ${-T + 74}M${S - 100} ${-T + 102}L${S - 58} ${-T + 102}`, 'detailShade', 8)],
      ears: [...both(sx => [P.ellipse(sx * (rx + 4), hc, 17, 36, 'detail')]), P.line(`M0 ${hc - ry + 4}L0 ${hc - ry - 46}`, 'outline', 9), P.ellipse(0, hc - ry - 60, 18, 18, 'accent')],
      head: [P.shape(rr(-rx, hc - ry, rx, hc + ry, 46), 'body')],
      marks: [P.shape(rr(-rx + 28, hc - ry + 30, rx - 28, hc + ry - 26, 32), 'detail', {width: 5})]
    };
  },
  coin(d, P) {
    const {w: R} = d, cy = 22 - R;
    return {
      look: {limb: 'outline', hand: 'detail', foot: 'accent'},
      body: [P.ellipse(0, cy, R, R, 'body'), P.ellipse(0, cy, R - 44, R - 44, 'detail', {width: 5})],
      front: [P.line(`M${n(-R * 0.58)} ${n(cy - R * 0.36)}Q${n(-R * 0.46)} ${n(cy - R * 0.58)} ${n(-R * 0.22)} ${n(cy - R * 0.68)}`, 'bodyLight', 11)]
    };
  },
  book(d, P) {
    const {w, h} = d;
    return {
      look: {limb: 'outline', hand: 'detail', foot: 'accent'},
      behind: [P.shape('M22 0L22 76L38 60L54 76L54 0Z', 'accent', {width: 5})],
      body: [P.shape(rr(-w + 26, -h + 14, w + 12, 22, 10), 'detail'), P.shape(rr(-w, -h, w - 8, 8, 18), 'body'), P.shape(rr(-w + 4, -h + 4, -w + 44, 4, 12), 'bodyShade', {outline: false}), P.line(`M${-w + 46} ${-h + 6}L${-w + 46} 2`, 'outline', 5)],
      front: [P.shape(rr(-w + 66, -h + 62, w - 30, -128, 18), 'detail', {width: 5}), P.line(`M${-w + 100} -86L${w - 64} -86`, 'bodyShade', 9)],
      dx: 14
    };
  },
  cloud(d, P) {
    const m = 1.2, x = v => n(v * m), y = v => n(v * m);
    const path = `M${x(-200)} 22C${x(-296)} 22 ${x(-302)} ${y(-116)} ${x(-216)} ${y(-140)}C${x(-246)} ${y(-256)} ${x(-126)} ${y(-332)} ${x(-40)} ${y(-286)}C${x(6)} ${y(-386)} ${x(150)} ${y(-382)} ${x(172)} ${y(-268)}C${x(264)} ${y(-276)} ${x(302)} ${y(-150)} ${x(238)} ${y(-108)}C${x(294)} ${y(-40)} ${x(250)} 22 ${x(190)} 22Z`;
    return {
      look: {limb: 'outline', hand: 'body', foot: 'accent'},
      body: [P.shape(path, 'body')],
      front: [P.line(`M${x(-150)} -24Q${x(-110)} -4 ${x(-70)} -22M${x(96)} -18Q${x(130)} -2 ${x(162)} -20`, 'detail', 9)]
    };
  }
};

// ---------------------------------------------------------------------------
// Limbs (each joint's frame: the pivot at 0, 0, the limb hanging down +y)

const J = (id, part, x, y, values, children, mirror = false) => ({tag: 'joint', id: part ? `${id}-${part}` : null, pivot: {x: n(x), y: n(y), mirror},
  transform: {x: values.x ?? 0, y: values.y ?? 0, rotation: values.rotation ?? 0, scaleX: values.scaleX ?? 1, scaleY: values.scaleY ?? 1}, children});

function limbs({id, g, j, P, look, thin, isStatic, props}) {
  const stick = (length, width) => [P.line(`M0 0L0 ${n(length)}`, look.limb, width)];
  const arm = side => {
    const s = side === 'l' ? 'L' : 'R', mirror = side === 'r';
    const handY = g.foreArm + g.hand * 0.35;
    const finger = J(id, `finger-${side}`, 0, g.foreArm + g.hand * 0.6, {}, P.within({mirror}, () => (thin ? stick(g.hand * 1.3, 12) : P.limb(g.hand * 1.25, 15, look.hand))));
    const wrap = isStatic ? (j[`finger${s}`] ? finger : null) : el('g', `${id}-fingerwrap-${side}`, {opacity: j[`finger${s}`]}, [finger]);
    const fore = J(id, `fore-${side}`, 0, g.upperArm, {rotation: j[`fore${s}`]}, P.within({mirror}, () => [
      ...(thin ? stick(g.foreArm, g.armW) : P.limb(g.foreArm, g.armW * 0.92, look.limb)),
      ...(wrap ? [wrap] : []),
      P.ellipse(0, handY, g.hand, g.hand * 1.04, look.hand),
      ...(props?.[side] ? [group(props[side], {transform: `translate(0 ${n(handY)})`})] : [])
    ]));
    const upper = P.within({mirror}, () => (thin ? stick(g.upperArm, g.armW) : P.limb(g.upperArm, g.armW, look.limb)));
    return J(id, `arm-${side}`, side === 'l' ? -g.armX : g.armX, g.armY, {rotation: j[`arm${s}`], y: j.shoulderY}, [...upper, fore], mirror);
  };
  const leg = side => {
    const s = side === 'l' ? 'L' : 'R', mirror = side === 'r';
    // Feet point outward (the leg's own +x is toward the body's centre line).
    const foot = thin ? P.ellipse(-13, g.shin + g.foot - 17, 31, 17, look.foot) : P.ellipse(-g.legW * 0.1, g.shin + g.foot * 0.26, g.legW * 0.68, g.foot * 0.74, look.foot);
    const shin = J(id, `shin-${side}`, 0, g.thigh, {rotation: j[`shin${s}`]}, P.within({mirror}, () => [...(thin ? stick(g.shin, g.legW) : P.limb(g.shin - 8, g.legW * 0.92, look.limb)), foot]));
    const thigh = P.within({mirror}, () => (thin ? stick(g.thigh, g.legW) : P.limb(g.thigh, g.legW, look.limb)));
    return J(id, `leg-${side}`, side === 'l' ? -g.legX : g.legX, g.hipY + 10, {rotation: j[`leg${s}`], scaleY: j.legScale}, [shin, ...thigh], mirror);
  };
  return {arm, leg};
}

// ---------------------------------------------------------------------------
// Resizing and the static form

// Marks a group whose transform sets its own scale (the face, drawn in toon
// face units): resizing multiplies that scale and leaves what is inside.
const UNIT = Symbol('kind-unit');

const moved = (attr, s, unit) => String(attr).replace(/(translate|scale)\(([^)]*)\)/g, (all, fn, args) => (fn === 'translate' || unit
  ? `${fn}(${args.trim().split(/[\s,]+/).map(v => (fn === 'scale' ? Math.round(Number(v) * s * 1000) / 1000 : n(Number(v) * s))).join(' ')})` : all));
const numbers = (d, s) => String(d).replace(/-?\d*\.?\d+/g, v => n(Number(v) * s));

/** A drawing resized by s: shapes, pivots, moves and line weights; joint values stay. */
function resized(node, s) {
  if (!node || typeof node !== 'object' || s === 1) return node;
  if (node.tag === 'joint') return {...node, pivot: {...node.pivot, x: n(node.pivot.x * s), y: n(node.pivot.y * s)}, children: node.children.map(child => resized(child, s))};
  const a = node.attrs ? {...node.attrs} : null;
  if (a) {
    if (a.transform) a.transform = moved(a.transform, s, Boolean(node[UNIT]));
    if (a.d !== undefined) a.d = numbers(a.d, s);
    if (node.tag === 'ellipse' || node.tag === 'circle') for (const key of ['cx', 'cy', 'rx', 'ry', 'r']) if (a[key] !== undefined) a[key] = n(Number(a[key]) * s);
    if (typeof a.strokeWidth === 'number') a.strokeWidth = Math.round(a.strokeWidth * s * 100) / 100;
  }
  return {...node, ...(a ? {attrs: a} : {}), ...(node.children && !node[UNIT] ? {children: node.children.map(child => resized(child, s))} : {})};
}

/** Joint nodes as SVG groups with attribute transforms (the static form, toon.mjs joint). */
function fixed(node) {
  if (!node || typeof node !== 'object') return node;
  const children = node.children?.map(fixed);
  if (node.tag !== 'joint') return children ? {...node, children} : node;
  const inner = group(children, {...(node.id ? {id: node.id} : {}), transform: svgTransform(node.transform)});
  return group([inner], {transform: `translate(${n(node.pivot.x)} ${n(node.pivot.y)})${node.pivot.mirror ? ' scale(-1 1)' : ''}`});
}

// ---------------------------------------------------------------------------
// The whole character

// The face reads a person's hair for its brows; a kind's brows take its ink.
const FACE_PARAMS = Object.freeze({hair: Object.freeze({style: 'bald', color: 'black'}), accessories: Object.freeze([])});
// How far a three-quarter look carries the face, in toon head units (actions.mjs GAZE.quarter).
const LOOK = 44;
// Kinds whose face sits on the detail colour (a screen, a label, a white face).
const ON_DETAIL = new Set(['fox', 'penguin', 'owl', 'phone', 'laptop', 'robot', 'coin', 'book']);

/**
 * Draw a character of a kind (kinds.mjs) in a drawing style.
 *   params   normalised kind params ({kind, size?, colors})
 *   colors   resolved colours (kinds.mjs kindColors)
 *   options  as toon.mjs drawToon: id, joints, expression, expressions,
 *            static, props, facing, light, gaze, turns
 * → node: a <g> with the feet at (0, 0).
 */
export function drawKind(style, params, colors, {id, joints: j, expression = 'neutral', expressions = [expression], static: isStatic = false, props = null, light = null, gaze = false, turns = false}) {
  const spec = KINDS[params.kind];
  const medium = {kind: params.kind};
  const d = kindDims(medium), g = kindGeometry(medium);
  const s = KIND_SIZE_SCALE[params.size ?? 'medium'];
  const k = d.faceK;
  const lineArt = LINE_ART.includes(style);
  // Line art draws every piece as paper with ink lines.
  const c = lineArt ? {...colors, body: PAPER, detail: PAPER, accent: PAPER, bodyShade: colors.outline, detailShade: colors.outline, accentShade: colors.outline} : colors;
  const on = ON_DETAIL.has(params.kind) ? 'detail' : 'body';
  // A dark face area takes light ink, so the eyes and mouth still read.
  const dark = !lineArt && luma(c[on]) < 0.3;
  const faceColors = {...c, blush: on === 'detail' ? c.blushDetail : c.blush, ...(dark ? {outline: c.inkLight} : {}), mixBrow: dark ? c.inkLight : c.outline, hairShade: c.outline, browDark: c.outline};
  const {P, F} = pens(style, c, faceColors, {id, light}, k);
  const shapes = SHAPES[params.kind](d, P, F);
  const headed = d.plan === 'headed';
  const ctx = {id, static: isStatic};
  // How much of a look the head (or a single body's face) takes, over the toon head's.
  const size = k * (d.turn ?? 1) * s;
  const shift = (headed ? 0.4 : 0.75) * LOOK * k * (d.turn ?? 1);
  // The cheeks keep inside the face area at the widest look.
  const cheek = Math.max(40, Math.min(99, ((d.area ?? d.rx) - 14 * k - shift - 6) / (0.52 * k)));
  const faceCtx = {id, g: {head: {rx: n(cheek), ry: 106, cy: 0}}, c: faceColors, p: FACE_PARAMS, j, expression, static: isStatic, P: F, cute: true, eyeScale: 1};
  const faces = [...new Set([expression, ...expressions])].map(name => face(faceCtx, name)).filter(Boolean);
  // Head frame: the pivot is the head joint's (the trunk's top, or the face area's chin).
  const centre = headed ? -d.up + (shapes.dy ?? 0.16) * d.ry : -d.ry;
  const features = [Object.assign(group([...(shapes.features ?? []), ...faces], {transform: `translate(${n(shapes.dx ?? 0)} ${n(centre - 38 * k)}) scale(${Math.round(k * 1000) / 1000})`}), {[UNIT]: true})];
  const [outline, ...restOfHead] = shapes.head ?? [];
  const headKids = turnJoint(ctx, j, gaze, [
    ...(shapes.ears ?? []),
    ...(outline ? [asHead(outline)] : []),
    ...restOfHead,
    ...(shapes.marks ?? []),
    ...faceView(ctx, turns, gazeJoint(ctx, j, gaze, features, size)),
    ...backView(ctx, turns, () => (headed ? [...SHAPES[params.kind](d, P, F).head] : [])),
    ...(shapes.crown ?? [])
  ], size);
  const tilt = {rotation: j.head, y: j.headY};
  const {arm, leg} = limbs({id, g, j, P, look: shapes.look, thin: d.limbs === 'thin', isStatic, props});
  const torsoKids = [
    J(id, 'hb', 0, g.neckY, tilt, [J(id, 'hbidle', 0, 0, {}, [])]),
    ...(shapes.behind ?? []),
    ...shapes.body,
    ...frontView(ctx, turns, shapes.front ?? []),
    J(id, 'head', 0, g.neckY, tilt, [J(id, 'headidle', 0, 0, {}, headKids)]),
    arm('l'),
    arm('r')
  ];
  const breath = J(id, 'breath', 0, 0, {}, torsoKids);
  const torso = J(id, 'torso', 0, g.hipY, {rotation: j.lean, scaleY: j.squash}, [breath]);
  const body = J(id, 'body', 0, 0, {y: j.bodyY}, [leg('l'), leg('r'), torso]);
  const ground = asShadow(P.ground());
  const defs = [...(P.defs ? P.defs() : []), ...(F.defs ? F.defs() : [])];
  const drawing = resized(group([...defs, ...ground, body]), s);
  return isStatic ? fixed(drawing) : drawing;
}
