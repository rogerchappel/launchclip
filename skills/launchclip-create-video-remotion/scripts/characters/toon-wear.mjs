// The toon body's wider wardrobe (toon.mjs): the rig options added for
// seeded casts. Hair styles, headwear, tops and layers, bottoms, glasses,
// facial hair, jewellery and other accessories, and mobility aids, each as
// shapes for the active pen in the part's own frame:
//
//   head frame   pivot at the neck top, the head centre at (0, g.head.cy)
//   torso frame  pivot at the hip centre, the shoulders at y = -g.torso
//   limb frames  the joint at (0, 0), the limb along +y
//   root frame   the feet's centre at (0, 0) (wheelchair)
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';
import {COVERING_HEADWEAR, HELD_AIDS} from './rig.mjs';

const r1 = value => Math.round(value * 10) / 10;
const group = (children, attrs) => el('g', null, null, children, attrs);
const pts = (list) => list.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + 'Z';

export const has = (p, name) => p.accessories.includes(name);
export const covers = p => COVERING_HEADWEAR.includes(p.headwear);

// ---------------------------------------------------------------------------
// Hair (the styles added after the first fifteen)

/** Hair behind the head for the newer styles, or null when the style is not one of them. */
export function newHairBack(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const top = cy - ry;
  switch (p.hair.style) {
    case 'shoulder': return [P.shape(`M${-rx - 18} ${cy - 10}C${-rx - 24} ${top - 40} ${rx + 24} ${top - 40} ${rx + 18} ${cy - 10}L${rx + 24} ${cy + 120}Q${rx + 26} ${cy + 136} ${rx + 6} ${cy + 134}Q${rx * 0.4} ${cy + 124} 0 ${cy + 126}Q${-rx * 0.4} ${cy + 124} ${-rx - 6} ${cy + 134}Q${-rx - 26} ${cy + 136} ${-rx - 24} ${cy + 120}Z`, 'hair')];
    case 'pigtails': return [-1, 1].flatMap(sx => [
      P.shape(`M${sx * (rx - 4)} ${cy - 30}C${sx * (rx + 46)} ${cy - 40} ${sx * (rx + 62)} ${cy + 40} ${sx * (rx + 40)} ${cy + 116}C${sx * (rx + 24)} ${cy + 70} ${sx * (rx + 4)} ${cy + 20} ${sx * (rx - 10)} ${cy - 6}Z`, 'hair'),
      P.ellipse(sx * (rx + 4), cy - 22, 13, 13, 'accent', {width: 5})
    ]);
    case 'topknot': return [P.ellipse(0, top - 12, 30, 26, 'hair')];
    case 'space-buns': return [-1, 1].map(sx => P.ellipse(sx * rx * 0.62, top + 4, 36, 34, 'hair'));
    case 'twists': return [P.shape(`M${-rx - 14} ${cy}C${-rx - 20} ${top - 34} ${rx + 20} ${top - 34} ${rx + 14} ${cy}L${rx + 16} ${cy + 36}Q${rx + 16} ${cy + 50} ${rx + 2} ${cy + 50}L${-rx - 2} ${cy + 50}Q${-rx - 16} ${cy + 50} ${-rx - 16} ${cy + 36}Z`, 'hair')];
    default: return null;
  }
}

/** Hair over the head for the newer styles, or null when the style is not one of them. */
export function newHairFront(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const top = cy - ry;
  const shaved = d => P.shape(d, 'hair', {outline: false, opacity: 0.45});
  const sides = `M${-rx + 2} ${cy - 4}C${-rx + 2} ${top - 46} ${rx - 2} ${top - 46} ${rx - 2} ${cy - 4}Q${rx * 0.4} ${cy - 50} 0 ${cy - 52}Q${-rx * 0.4} ${cy - 50} ${-rx + 2} ${cy - 4}Z`;
  const shine = d => P.line(d, 'hairLight', 7);
  switch (p.hair.style) {
    case 'undercut': return [
      shaved(sides),
      P.shape(`M${-rx * 0.78} ${top + 30}C${-rx * 0.7} ${top - 34} ${rx * 0.9} ${top - 40} ${rx + 6} ${top + 22}C${rx * 0.7} ${top + 6} ${rx * 0.2} ${top + 14} ${-rx * 0.1} ${top + 40}C${-rx * 0.34} ${top + 30} ${-rx * 0.6} ${top + 34} ${-rx * 0.78} ${top + 30}Z`, 'hair'),
      shine(`M${-rx * 0.1} ${top - 4}Q${rx * 0.3} ${top - 12} ${rx * 0.62} ${top + 4}`)
    ];
    case 'quiff': return [
      P.shape(`M${-rx - 6} ${cy + 4}C${-rx - 10} ${top - 20} ${-rx * 0.6} ${top - 56} ${rx * 0.1} ${top - 52}C${rx * 0.8} ${top - 50} ${rx + 14} ${top - 20} ${rx + 6} ${cy + 4}L${rx - 6} ${cy - 20}C${rx * 0.5} ${cy - 46} ${-rx * 0.2} ${top + 30} ${-rx * 0.5} ${top + 22}C${-rx * 0.7} ${cy - 40} ${-rx + 4} ${cy - 30} ${-rx - 6} ${cy + 4}Z`, 'hair'),
      shine(`M${-rx * 0.4} ${top - 22}Q${rx * 0.05} ${top - 46} ${rx * 0.5} ${top - 30}`)
    ];
    case 'spiky': {
      const n = 7;
      let d = `M${-rx - 6} ${cy + 2}`;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const a = Math.PI * (1 + t);
        const bx = Math.cos(a) * (rx + 4), by = cy - 16 + Math.sin(a) * (ry + 4);
        const sx = Math.cos(a) * (rx + 40), sy = cy - 16 + Math.sin(a) * (ry + 44);
        if (i > 0) d += `L${r1(sx)} ${r1(sy)}`;
        d += `L${r1(bx)} ${r1(by)}`;
      }
      d += `L${rx + 6} ${cy + 2}L${rx - 6} ${cy - 22}Q0 ${cy - 54} ${-rx + 6} ${cy - 22}Z`;
      return [P.shape(d, 'hair')];
    }
    case 'balding': return [-1, 1].map(sx => P.shape(`M${sx * (rx + 4)} ${cy + 26}C${sx * (rx + 10)} ${cy - 20} ${sx * (rx - 4)} ${cy - 50} ${sx * rx * 0.62} ${cy - 66}C${sx * rx * 0.7} ${cy - 40} ${sx * (rx - 12)} ${cy - 10} ${sx * (rx - 10)} ${cy + 26}Z`, 'hair'))
      .concat([P.line(`M${-rx * 0.3} ${top + 22}Q0 ${top + 12} ${rx * 0.3} ${top + 20}`, 'skinLight', 8)]);
    case 'shoulder': return [P.shape(`M${-rx - 10} ${cy + 56}C${-rx - 16} ${top - 30} ${rx + 16} ${top - 30} ${rx + 10} ${cy + 56}L${rx - 2} ${cy + 56}C${rx - 4} ${cy} ${rx * 0.7} ${cy - 44} ${rx * 0.2} ${top + 22}C${-rx * 0.3} ${cy - 30} ${-rx * 0.8} ${cy - 30} ${-rx + 2} ${cy + 56}Z`, 'hair'), shine(`M${-rx * 0.5} ${top + 16}Q${-rx * 0.15} ${top + 2} ${rx * 0.2} ${top + 6}`)];
    case 'pigtails': case 'space-buns': return [P.shape(`M${-rx - 6} ${cy + 6}C${-rx - 12} ${top - 28} ${rx + 12} ${top - 28} ${rx + 6} ${cy + 6}L${rx - 4} ${cy - 10}C${rx * 0.5} ${cy - 50} ${-rx * 0.5} ${cy - 50} ${-rx + 4} ${cy - 10}Z`, 'hair'), P.line(`M0 ${top - 4}L0 ${top + 22}`, 'hairShade', 5)];
    case 'topknot': return [shaved(sides), P.shape(`M${-rx * 0.66} ${top + 40}C${-rx * 0.7} ${top - 12} ${rx * 0.7} ${top - 12} ${rx * 0.66} ${top + 40}Q0 ${top + 24} ${-rx * 0.66} ${top + 40}Z`, 'hair'), P.ellipse(0, top - 6, 14, 7, 'hairShade', {outline: false})];
    case 'cornrows': {
      const rows = [];
      for (let i = 0; i < 6; i++) {
        const x = -rx * 0.72 + i * rx * 0.29;
        rows.push(P.line(`M${r1(x * 0.7)} ${r1(top + 6)}Q${r1(x * 1.08)} ${r1(cy - 40)} ${r1(x * 1.04)} ${r1(cy - 2)}`, 'hairShade', 4));
      }
      return [P.shape(`M${-rx - 2} ${cy + 2}C${-rx - 6} ${top - 34} ${rx + 6} ${top - 34} ${rx + 2} ${cy + 2}C${rx * 0.6} ${cy - 30} ${-rx * 0.6} ${cy - 30} ${-rx - 2} ${cy + 2}Z`, 'hair'), ...rows];
    }
    case 'twists': {
      const out = [P.shape(`M${-rx - 6} ${cy + 4}C${-rx - 12} ${top - 30} ${rx + 12} ${top - 30} ${rx + 6} ${cy + 4}C${rx * 0.6} ${cy - 38} ${-rx * 0.6} ${cy - 38} ${-rx - 6} ${cy + 4}Z`, 'hair')];
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (1.04 + (i * 0.92) / 8);
        const x = Math.cos(a) * (rx - 4), y = cy - 14 + Math.sin(a) * (ry - 2);
        out.push(...P.limb(18, 20, 'hair', 0, {at: [x, y], angle: (a * 180) / Math.PI - 90}));
      }
      return out;
    }
    case 'mohawk': return [shaved(sides), P.shape(`M-24 ${cy - 30}C-30 ${top - 40} -16 ${top - 70} 0 ${top - 74}C16 ${top - 70} 30 ${top - 40} 24 ${cy - 30}Q0 ${cy - 44} -24 ${cy - 30}Z`, 'hair'), P.line(`M-6 ${top - 50}Q4 ${top - 30} 2 ${top - 6}`, 'hairLight', 6)];
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Headwear (head frame, drawn over the hair)

const HEADWEAR_FILL = {'chef-hat': '#fbfaf6', 'sunhat': '#e2c48a', 'grad-cap': '#26272e', 'kippah': 'accent'};
const domeAt = (rx, cy, top, lift = 26, base = 16) => `M${-rx - 8} ${cy - base}C${-rx - 10} ${top - lift} ${rx + 10} ${top - lift} ${rx + 8} ${cy - base}Q0 ${cy - base - 22} ${-rx - 8} ${cy - base}Z`;

export function headwear(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const top = cy - ry;
  const fill = HEADWEAR_FILL[p.headwear] ?? 'accent';
  switch (p.headwear) {
    case 'cap': return [
      P.shape(domeAt(rx, cy, top, 34, 26), fill),
      P.line(`M0 ${top - 6}L0 ${cy - 46}`, 'accentShade', 4),
      P.ellipse(0, top - 8, 9, 6, 'accentShade', {outline: false}),
      P.shape(`M${-rx * 0.9} ${cy - 40}Q0 ${cy - 16} ${rx * 0.9} ${cy - 40}Q${rx * 0.94} ${cy - 30} ${rx * 0.74} ${cy - 24}Q0 ${cy - 2} ${-rx * 0.74} ${cy - 24}Q${-rx * 0.94} ${cy - 30} ${-rx * 0.9} ${cy - 40}Z`, 'accentShade')
    ];
    case 'beanie': return [
      P.shape(`M${-rx - 10} ${cy - 20}C${-rx - 14} ${top - 52} ${rx + 14} ${top - 52} ${rx + 10} ${cy - 20}Z`, fill),
      P.shape(`M${-rx - 12} ${cy - 44}Q0 ${cy - 58} ${rx + 12} ${cy - 44}L${rx + 12} ${cy - 14}Q0 ${cy - 28} ${-rx - 12} ${cy - 14}Z`, 'accentShade'),
      ...[-0.5, 0, 0.5].map(t => P.line(`M${r1(rx * t)} ${cy - 50}L${r1(rx * t)} ${cy - 22}`, 'accent', 4)),
      P.ellipse(0, top - 30, 18, 16, 'accentShade')
    ];
    case 'beret': return [P.shape(`M${-rx - 20} ${cy - 46}C${-rx - 10} ${top - 46} ${rx + 30} ${top - 40} ${rx + 26} ${cy - 56}Q${rx * 0.2} ${cy - 30} ${-rx - 20} ${cy - 46}Z`, fill), P.ellipse(rx * 0.2, top - 26, 7, 6, 'accentShade', {outline: false})];
    case 'bucket-hat': return [
      P.shape(`M${-rx - 34} ${cy - 18}Q0 ${cy - 46} ${rx + 34} ${cy - 18}L${rx + 18} ${cy - 46}Q0 ${cy - 66} ${-rx - 18} ${cy - 46}Z`, 'accentShade'),
      P.shape(`M${-rx - 10} ${cy - 40}C${-rx - 8} ${top - 40} ${rx + 8} ${top - 40} ${rx + 10} ${cy - 40}Q0 ${cy - 58} ${-rx - 10} ${cy - 40}Z`, fill)
    ];
    case 'sunhat': return [
      P.shape(`M${-rx - 80} ${cy - 30}Q0 ${cy - 70} ${rx + 80} ${cy - 30}Q${rx + 40} ${cy - 14} 0 ${cy - 22}Q${-rx - 40} ${cy - 14} ${-rx - 80} ${cy - 30}Z`, fill),
      P.shape(`M${-rx + 2} ${cy - 46}C${-rx} ${top - 44} ${rx} ${top - 44} ${rx - 2} ${cy - 46}Q0 ${cy - 60} ${-rx + 2} ${cy - 46}Z`, fill),
      P.shape(`M${-rx + 2} ${cy - 46}Q0 ${cy - 60} ${rx - 2} ${cy - 46}L${rx - 4} ${cy - 62}Q0 ${cy - 76} ${-rx + 4} ${cy - 62}Z`, 'accent', {width: 5})
    ];
    case 'chef-hat': return [
      P.shape(`M${-rx + 4} ${cy - 40}L${-rx - 10} ${top - 70}C${-rx - 40} ${top - 120} ${-rx * 0.3} ${top - 150} 0 ${top - 118}C${rx * 0.3} ${top - 150} ${rx + 40} ${top - 120} ${rx + 10} ${top - 70}L${rx - 4} ${cy - 40}Z`, fill),
      P.line(`M${-rx * 0.4} ${top - 96}Q${-rx * 0.3} ${top - 60} ${-rx * 0.36} ${top - 20}M${rx * 0.4} ${top - 96}Q${rx * 0.3} ${top - 60} ${rx * 0.36} ${top - 20}`, '#d9d6cf', 5),
      P.shape(`M${-rx - 6} ${cy - 66}Q0 ${cy - 80} ${rx + 6} ${cy - 66}L${rx + 6} ${cy - 30}Q0 ${cy - 44} ${-rx - 6} ${cy - 30}Z`, fill)
    ];
    case 'hard-hat': return [
      P.shape(`M${-rx - 6} ${cy - 30}C${-rx - 8} ${top - 52} ${rx + 8} ${top - 52} ${rx + 6} ${cy - 30}Z`, fill),
      P.shape(`M-14 ${top - 26}L14 ${top - 26}L12 ${cy - 34}L-12 ${cy - 34}Z`, 'accentShade', {width: 5}),
      P.shape(`M${-rx - 26} ${cy - 30}Q0 ${cy - 46} ${rx + 26} ${cy - 30}L${rx + 24} ${cy - 18}Q0 ${cy - 32} ${-rx - 24} ${cy - 18}Z`, fill)
    ];
    case 'surgical-cap': return [
      P.shape(`M${-rx - 8} ${cy - 10}C${-rx - 12} ${top - 44} ${rx + 12} ${top - 44} ${rx + 8} ${cy - 10}Q${rx * 0.5} ${cy - 40} 0 ${cy - 42}Q${-rx * 0.5} ${cy - 40} ${-rx - 8} ${cy - 10}Z`, fill),
      P.line(`M${-rx * 0.5} ${cy - 44}Q0 ${cy - 52} ${rx * 0.5} ${cy - 44}`, 'accentShade', 5)
    ];
    case 'headband': return [P.shape(`M${-rx - 4} ${cy - 30}Q0 ${cy - 62} ${rx + 4} ${cy - 30}L${rx + 3} ${cy - 54}Q0 ${cy - 86} ${-rx - 3} ${cy - 54}Z`, fill, {width: 6})];
    case 'turban': return [
      P.shape(`M${-rx - 14} ${cy - 14}C${-rx - 26} ${top - 66} ${rx + 26} ${top - 66} ${rx + 14} ${cy - 14}Q${rx * 0.4} ${cy - 40} 0 ${cy - 26}Q${-rx * 0.4} ${cy - 40} ${-rx - 14} ${cy - 14}Z`, fill),
      P.line(`M${-rx - 4} ${cy - 30}Q${-rx * 0.2} ${top - 6} ${rx * 0.8} ${top - 10}`, 'accentShade', 6),
      P.line(`M${rx + 4} ${cy - 34}Q${rx * 0.4} ${top + 10} ${-rx * 0.4} ${top + 16}`, 'accentLight', 5)
    ];
    case 'kippah': return [P.shape(`M${-rx * 0.5} ${top + 14}Q0 ${top - 18} ${rx * 0.5} ${top + 14}Q0 ${top + 4} ${-rx * 0.5} ${top + 14}Z`, fill, {width: 5})];
    case 'headphones': return [
      P.shape(`M${-rx - 12} ${cy}C${-rx - 20} ${top - 50} ${rx + 20} ${top - 50} ${rx + 12} ${cy}`, null, {stroke: 'outline', width: 18}),
      P.shape(`M${-rx - 12} ${cy}C${-rx - 20} ${top - 50} ${rx + 20} ${top - 50} ${rx + 12} ${cy}`, null, {outline: true, stroke: 'accent', width: 8}),
      ...[-1, 1].map(sx => P.shape(`M${sx * (rx - 8)} ${cy - 30}L${sx * (rx + 22)} ${cy - 26}Q${sx * (rx + 30)} ${cy + 14} ${sx * (rx + 22)} ${cy + 54}L${sx * (rx - 8)} ${cy + 50}Z`, '#2a2d36'))
    ];
    case 'grad-cap': return [
      P.shape(`M${-rx * 0.82} ${cy - 54}C${-rx * 0.84} ${top - 6} ${rx * 0.84} ${top - 6} ${rx * 0.82} ${cy - 54}Q0 ${cy - 66} ${-rx * 0.82} ${cy - 54}Z`, fill),
      P.shape(`M${-rx - 40} ${top + 8}L0 ${top - 26}L${rx + 40} ${top + 8}L0 ${top + 34}Z`, fill),
      P.line(`M0 ${top + 4}L${rx + 18} ${top + 14}L${rx + 22} ${top + 60}`, 'accent', 5),
      P.ellipse(rx + 22, top + 64, 7, 9, 'accent', {outline: false})
    ];
    case 'bike-helmet': return [
      P.shape(`M${-rx - 14} ${cy - 20}C${-rx - 18} ${top - 56} ${rx + 18} ${top - 56} ${rx + 14} ${cy - 20}Q${rx * 0.5} ${cy - 34} 0 ${cy - 30}Q${-rx * 0.5} ${cy - 34} ${-rx - 14} ${cy - 20}Z`, fill),
      ...[-0.42, 0, 0.42].map(t => P.shape(`M${r1(rx * t - 10)} ${top - 20}L${r1(rx * t + 10)} ${top - 20}L${r1(rx * t * 1.2 + 8)} ${cy - 50}L${r1(rx * t * 1.2 - 8)} ${cy - 50}Z`, 'accentShade', {width: 4})),
      P.line(`M${-rx + 8} ${cy - 24}Q${-rx + 2} ${cy + 30} ${-rx * 0.5} ${cy + 76}M${rx - 8} ${cy - 24}Q${rx - 2} ${cy + 30} ${rx * 0.5} ${cy + 76}`, '#2a2d36', 4)
    ];
    default: return [];
  }
}

// ---------------------------------------------------------------------------
// Face extras

/**
 * Wrinkles, sideburns, beards and marks. jaw: as toon.mjs facial ('only':
 * the hair on the jaw, chin and temples, which stays on a turned head;
 * 'none': the rest).
 */
export function faceExtras(ctx, {jaw: part} = {}) {
  const {g, p, P} = ctx;
  const {cy} = g.head;
  const out = [];
  if (part === 'only') return [...jawExtras(ctx), ...goateeChin(ctx)];
  if (p.age === 'senior') {
    for (const sx of [-1, 1]) {
      out.push(P.line(`M${sx * 58} ${cy + 2}L${sx * 68} ${cy - 2}M${sx * 58} ${cy + 10}L${sx * 69} ${cy + 12}`, 'skinShade', 3.5));
      out.push(P.line(`M${sx * 30} ${cy + 30}Q${sx * 40} ${cy + 44} ${sx * 36} ${cy + 58}`, 'skinShade', 3.5));
    }
  }
  if (part !== 'none') out.push(...jawExtras(ctx), ...goateeChin(ctx));
  if (has(p, 'goatee')) out.push(P.shape(`M-25 ${cy + 40}Q-12 ${cy + 30} 0 ${cy + 35}Q12 ${cy + 30} 25 ${cy + 40}Q12 ${cy + 44} 0 ${cy + 40}Q-12 ${cy + 44} -25 ${cy + 40}Z`, 'hair', {width: 4.5}));
  if (has(p, 'bindi')) out.push(P.ellipse(0, cy - 20, 5.5, 5.5, '#c8323c', {outline: false}));
  if (has(p, 'nose-stud')) out.push(P.ellipse(9, cy + 27, 3.4, 3.4, '#f3e6b4', {outline: false}));
  return out;
}

// Sideburns and a long beard: they follow the head's edge, not the features.
function jawExtras(ctx) {
  const {g, p, P} = ctx;
  const {rx, ry, cy} = g.head;
  const out = [];
  if (has(p, 'sideburns')) for (const sx of [-1, 1]) out.push(P.shape(`M${sx * (rx - 18)} ${cy - 20}L${sx * (rx - 2)} ${cy - 20}L${sx * (rx - 4)} ${cy + 34}L${sx * (rx - 16)} ${cy + 30}Z`, 'hair', {width: 5}));
  if (has(p, 'long-beard')) out.push(P.shape(`M${-rx + 3} ${cy + 36}C${-rx + 2} ${cy + 90} -54 ${cy + ry + 70} 0 ${cy + ry + 84}C54 ${cy + ry + 70} ${rx - 2} ${cy + 90} ${rx - 3} ${cy + 36}L${rx - 16} ${cy + 44}C${rx - 22} ${cy + 46} 40 ${cy + 36} 0 ${cy + 36}C-40 ${cy + 36} ${-rx + 22} ${cy + 46} ${-rx + 16} ${cy + 44}ZM-29 ${cy + 47}C-29 ${cy + 35} 29 ${cy + 35} 29 ${cy + 47}C29 ${cy + 64} -29 ${cy + 64} -29 ${cy + 47}Z`, 'hair', {rule: 'evenodd'}), P.line(`M-16 ${cy + ry + 20}Q-10 ${cy + ry + 50} -4 ${cy + ry + 66}M16 ${cy + ry + 20}Q10 ${cy + ry + 50} 4 ${cy + ry + 66}`, 'hairShade', 4));
  return out;
}

// A goatee's tuft on the chin (its moustache is with the mouth).
function goateeChin(ctx) {
  const {g, p, P} = ctx;
  const {ry, cy} = g.head;
  return has(p, 'goatee') ? [P.shape(`M-22 ${cy + 64}Q0 ${cy + 58} 22 ${cy + 64}Q20 ${cy + ry + 12} 0 ${cy + ry + 16}Q-20 ${cy + ry + 12} -22 ${cy + 64}Z`, 'hair', {width: 5})] : [];
}

export function newGlasses(ctx) {
  const {g, p, P} = ctx;
  const cy = g.head.cy + 10;
  if (has(p, 'sunglasses')) {
    return [
      ...[-1, 1].map(sx => P.shape(`M${sx * 56} ${cy - 16}L${sx * 9} ${cy - 16}Q${sx * 8} ${cy + 6} ${sx * 20} ${cy + 16}L${sx * 42} ${cy + 16}Q${sx * 56} ${cy + 10} ${sx * 56} ${cy - 16}Z`, '#1e2129', {width: 5.5})),
      P.line(`M-9 ${cy - 10}Q0 ${cy - 14} 9 ${cy - 10}`, 'outline', 5),
      ...[-1, 1].map(sx => P.line(`M${sx * 46} ${cy - 8}L${sx * 38} ${cy + 2}`, '#ffffff', 3.5))
    ];
  }
  if (has(p, 'cat-eye-glasses')) {
    return [
      ...[-1, 1].map(sx => P.shape(`M${sx * 60} ${cy - 24}L${sx * 10} ${cy - 14}Q${sx * 8} ${cy + 10} ${sx * 22} ${cy + 15}L${sx * 42} ${cy + 15}Q${sx * 54} ${cy + 8} ${sx * 60} ${cy - 24}Z`, '#ffffff', {stroke: 'outline', width: 6.5, fillOpacity: 0.18})),
      P.line(`M-10 ${cy - 8}Q0 ${cy - 13} 10 ${cy - 8}`, 'outline', 5)
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Tops (the newer ones), layers and neckwear (torso frame)

export const NEW_LONG_SLEEVES = new Set(['turtleneck', 'cardigan', 'jacket', 'coat', 'lab-coat', 'chef-coat', 'kurta']);
/** Tops that run down past the hips. */
export const LONG_TOPS = Object.freeze({coat: 0.62, 'lab-coat': 0.7, kurta: 0.56});

/** The long hem below the torso for coats, lab coats and kurtas (drawn before the details). */
export function longHem(ctx) {
  const {g, p, P} = ctx;
  const share = LONG_TOPS[p.outfit.top];
  if (!share) return [];
  const H = g.hip, y1 = r1(g.thigh * share);
  const w1 = H + 18;
  const hem = [P.shape(`M${-H} -6L${H} -6L${w1} ${y1 - 10}Q${w1} ${y1} ${w1 - 10} ${y1}L${-w1 + 10} ${y1}Q${-w1} ${y1} ${-w1} ${y1 - 10}Z`, 'top')];
  if (p.outfit.top !== 'kurta') hem.push(P.line(`M0 -4L0 ${y1}`, 'topShade', 5));
  else hem.push(P.line(`M${-w1 + 4} ${y1 - 12}L${w1 - 4} ${y1 - 12}`, 'topShade', 5));
  return hem;
}

export function newTop(ctx) {
  const {g, p, P} = ctx;
  const T = g.torso;
  const neck = 26;
  const parts = [];
  const vee = depth => P.shape(`M${-neck - 2} ${-T + 1}L0 ${-T + depth}L${neck + 2} ${-T + 1}Z`, 'skin', {width: 5});
  switch (p.outfit.top) {
    case 'polo':
      parts.push(P.shape(`M${-neck + 6} ${-T + 1}L0 ${-T + 40}L${neck - 6} ${-T + 1}Z`, 'skin', {width: 5}));
      parts.push(P.shape(`M${-neck - 8} ${-T - 6}L-4 ${-T + 22}L${-neck - 22} ${-T + 26}Z`, 'topLight', {width: 5}));
      parts.push(P.shape(`M${neck + 8} ${-T - 6}L4 ${-T + 22}L${neck + 22} ${-T + 26}Z`, 'topLight', {width: 5}));
      parts.push(P.line(`M0 ${-T + 40}L0 ${-T + 92}`, 'topShade', 4));
      for (const y of [-T + 56, -T + 80]) parts.push(P.ellipse(0, y, 4, 4, 'topShade', {outline: false}));
      break;
    case 'tank':
      for (const sx of [-1, 1]) parts.push(P.shape(`M${sx * (g.shoulder + 2)} ${-T - 2}L${sx * (neck + 16)} ${-T - 2}Q${sx * (g.shoulder * 0.86)} ${-T + 50} ${sx * (g.shoulder + 4)} ${-T + 92}Z`, 'skin', {width: 5}));
      parts.push(P.shape(`M${-neck - 4} ${-T}Q0 ${-T + 50} ${neck + 4} ${-T}Z`, 'skin', {width: 5}));
      break;
    case 'turtleneck':
      parts.push(P.shape(`M-30 ${-T + 6}L-28 ${-T - 34}Q0 ${-T - 42} 28 ${-T - 34}L30 ${-T + 6}Q0 ${-T + 14} -30 ${-T + 6}Z`, 'top'));
      for (const y of [-T - 22, -T - 10]) parts.push(P.line(`M-26 ${y}Q0 ${y + 6} 26 ${y}`, 'topShade', 4));
      break;
    case 'cardigan':
      parts.push(P.shape(`M${-neck - 6} ${-T}L0 ${-T + 12}L${neck + 6} ${-T}L${neck + 4} 16L${-neck - 4} 16Z`, 'accent', {width: 5}));
      parts.push(P.shape(`M${-neck - 4} ${-T + 1}Q0 ${-T + 30} ${neck + 4} ${-T + 1}Z`, 'skin', {width: 5}));
      for (const sx of [-1, 1]) parts.push(P.line(`M${sx * (neck + 6)} ${-T}L${sx * (neck - 2)} 16`, 'topShade', 7));
      for (const y of [-T + 70, -T + 130, -T + 190]) parts.push(P.ellipse(-neck + 2, y, 5, 5, 'topShade', {outline: false}));
      break;
    case 'jacket':
      parts.push(vee(34));
      for (const sx of [-1, 1]) parts.push(P.shape(`M${sx * (neck + 4)} ${-T - 6}L${sx * (neck + 24)} ${-T - 2}L${sx * 10} ${-T + 50}L${sx * 4} ${-T + 34}Z`, 'topShade', {width: 5}));
      parts.push(P.line(`M0 ${-T + 40}L0 12`, 'outline', 4));
      for (const sx of [-1, 1]) parts.push(P.line(`M${sx * 22} ${-T * 0.32}L${sx * (g.waist * 0.72)} ${-T * 0.34}`, 'topShade', 6));
      break;
    case 'coat':
      parts.push(vee(40));
      for (const sx of [-1, 1]) parts.push(P.shape(`M${sx * (neck + 6)} ${-T - 4}L${sx * (neck + 34)} ${-T + 8}L${sx * 18} ${-T + 80}L${sx * 2} ${-T + 46}Z`, 'topShade', {width: 5}));
      for (const sx of [-1, 1]) for (const y of [-T + 110, -T + 170]) parts.push(P.ellipse(sx * 20, y, 6, 6, 'topShade', {outline: false}));
      break;
    case 'scrubs':
      parts.push(P.shape(`M${-neck - 2} ${-T + 1}L0 ${-T + 52}L${neck + 2} ${-T + 1}Z`, 'skin', {width: 5}));
      parts.push(P.shape(`M${g.shoulder * 0.28} ${-T + 70}L${g.shoulder * 0.72} ${-T + 70}L${g.shoulder * 0.7} ${-T + 112}L${g.shoulder * 0.3} ${-T + 112}Z`, 'topShade', {width: 4.5}));
      break;
    case 'lab-coat':
      parts.push(P.shape(`M${-neck - 2} ${-T}L0 ${-T + 70}L${neck + 2} ${-T}Z`, 'accent', {width: 5}));
      parts.push(P.shape(`M${-neck + 6} ${-T + 1}L0 ${-T + 28}L${neck - 6} ${-T + 1}Z`, 'skin', {width: 4}));
      for (const sx of [-1, 1]) parts.push(P.shape(`M${sx * (neck + 4)} ${-T - 4}L${sx * (neck + 30)} ${-T + 10}L${sx * 6} ${-T + 96}L${sx * 2} ${-T + 70}Z`, 'topShade', {width: 5}));
      parts.push(P.line(`M${g.shoulder * 0.3} ${-T + 92}L${g.shoulder * 0.7} ${-T + 92}`, 'topShade', 5));
      parts.push(P.line(`M${g.shoulder * 0.42} ${-T + 80}L${g.shoulder * 0.42} ${-T + 100}`, 'accent', 5));
      break;
    case 'chef-coat':
      parts.push(P.shape(`M-28 ${-T + 4}L-28 ${-T - 18}Q0 ${-T - 24} 28 ${-T - 18}L28 ${-T + 4}Z`, 'top'));
      parts.push(P.line(`M-26 ${-T + 2}L${g.waist * 0.5} 10`, 'topShade', 5));
      for (const sx of [-1, 1]) for (const y of [-T + 60, -T + 120, -T + 180]) parts.push(P.ellipse(sx * 26 + 8, y, 6, 6, 'topShade', {outline: true, width: 3}));
      break;
    case 'jersey':
      parts.push(P.shape(`M${-neck - 2} ${-T + 1}L0 ${-T + 40}L${neck + 2} ${-T + 1}Z`, 'skin', {width: 5}));
      parts.push(P.line(`M${-neck - 6} ${-T}L0 ${-T + 46}L${neck + 6} ${-T}`, 'accent', 8));
      for (const sx of [-1, 1]) parts.push(P.line(`M${sx * (g.shoulder - 6)} ${-T + 60}L${sx * (g.hip - 4)} 10`, 'accent', 8));
      break;
    case 'kurta':
      parts.push(P.shape(`M-24 ${-T + 1}Q0 ${-T + 24} 24 ${-T + 1}Z`, 'skin', {width: 5}));
      parts.push(P.line(`M0 ${-T + 12}L0 ${-T + 96}`, 'topShade', 5));
      parts.push(P.line(`M-12 ${-T + 12}Q-16 ${-T + 60} -10 ${-T + 96}M12 ${-T + 12}Q16 ${-T + 60} 10 ${-T + 96}`, 'accent', 4));
      for (const y of [-T + 36, -T + 60, -T + 84]) parts.push(P.ellipse(0, y, 3.5, 3.5, 'accent', {outline: false}));
      break;
    default: break;
  }
  return parts;
}

/** A layer over the top: an apron, a vest or a hi-vis vest (torso frame; an apron runs down the thighs). */
export function overLayer(ctx) {
  const {g, p, P} = ctx;
  const T = g.torso, S = g.shoulder, H = g.hip;
  switch (p.outfit.over) {
    case 'apron': {
      const y1 = r1(g.thigh * 0.66);
      return [
        P.line(`M-26 ${-T + 40}Q0 ${-T - 6} 26 ${-T + 40}`, 'accentShade', 6),
        P.shape(`M-34 ${-T + 44}L34 ${-T + 44}L${g.waist * 0.72} ${-T * 0.36}L${H + 10} ${y1 - 10}Q${H + 10} ${y1} ${H} ${y1}L${-H} ${y1}Q${-H - 10} ${y1} ${-H - 10} ${y1 - 10}L${-g.waist * 0.72} ${-T * 0.36}Z`, 'accent'),
        P.line(`M${-g.waist - 4} ${-T * 0.36}L${g.waist + 4} ${-T * 0.36}`, 'accentShade', 7),
        P.shape(`M-30 ${-T * 0.22}L30 ${-T * 0.22}L28 ${-T * 0.06}L-28 ${-T * 0.06}Z`, 'accentShade', {width: 4.5})
      ];
    }
    case 'vest': case 'hi-vis': {
      const fill = p.outfit.over === 'hi-vis' ? '#e9f23c' : 'accent';
      const out = [-1, 1].map(sx => P.shape(`M${sx * 30} ${-T}L${sx * (S - 10)} ${-T}Q${sx * (S - 2)} ${-T + 60} ${sx * (S + 2)} ${-T + 96}C${sx * (g.waist + 8)} ${-T * 0.4} ${sx * (H + 4)} ${-T * 0.2} ${sx * (H + 2)} 18L${sx * 12} 18L${sx * 12} ${-T + 120}Z`, fill));
      if (p.outfit.over === 'hi-vis') for (const y of [-T * 0.52, -T * 0.22]) out.push(P.line(`M${-H + 2} ${r1(y)}L-14 ${r1(y)}M14 ${r1(y)}L${H - 2} ${r1(y)}`, '#d8dce2', 12));
      return out;
    }
    default: return [];
  }
}

const NECK_OPEN = new Set(['tee', 'dress', 'tank', 'sweater', 'hoodie', 'scrubs', 'jersey', 'polo', 'cardigan']);

export function neckwear(ctx) {
  const {g, p, P} = ctx;
  const T = g.torso;
  const out = [];
  if (has(p, 'necklace') && NECK_OPEN.has(p.outfit.top)) out.push(P.line(`M-24 ${-T + 2}Q0 ${-T + 40} 24 ${-T + 2}`, '#e8c568', 3.5), P.ellipse(0, -T + 26, 6, 7, '#e8c568', {width: 3.5}));
  if (has(p, 'tie')) out.push(P.shape(`M-9 ${-T + 18}L9 ${-T + 18}L6 ${-T + 32}L14 ${-T + 150}L0 ${-T + 172}L-14 ${-T + 150}L-6 ${-T + 32}Z`, 'accent', {width: 5}));
  if (has(p, 'bowtie')) out.push(P.shape(`M0 ${-T + 22}L-30 ${-T + 8}L-30 ${-T + 40}ZM0 ${-T + 22}L30 ${-T + 8}L30 ${-T + 40}Z`, 'accent', {width: 5}), P.ellipse(0, -T + 22, 8, 9, 'accentShade', {width: 4}));
  if (has(p, 'scarf')) out.push(P.shape(`M-40 ${-T - 10}Q0 ${-T + 30} 40 ${-T - 10}L42 ${-T + 18}Q0 ${-T + 58} -42 ${-T + 18}Z`, 'accent'), P.shape(`M10 ${-T + 30}L40 ${-T + 30}L44 ${-T + 140}L18 ${-T + 136}Z`, 'accent'), P.line(`M20 ${-T + 120}L42 ${-T + 122}`, 'accentShade', 5));
  if (has(p, 'stethoscope')) out.push(P.line(`M-30 ${-T + 2}Q-34 ${-T + 70} -10 ${-T + 120}M30 ${-T + 2}Q34 ${-T + 70} 10 ${-T + 120}`, '#3a3f4b', 5), P.line(`M-10 ${-T + 120}Q0 ${-T + 136} 10 ${-T + 120}M0 ${-T + 132}L0 ${-T + 158}`, '#3a3f4b', 5), P.ellipse(0, -T + 166, 11, 11, '#c9ccd4', {width: 4.5}));
  return out;
}

export function bagStraps(ctx) {
  const {g, p, P} = ctx;
  const T = g.torso;
  const out = [];
  if (has(p, 'backpack')) for (const sx of [-1, 1]) out.push(P.line(`M${r1(sx * g.shoulder * 0.34)} ${-T - 2}Q${r1(sx * g.shoulder * 0.4)} ${-T + 80} ${r1(sx * g.shoulder * 0.46)} ${-T + 150}`, '#3a3f4b', 12));
  if (has(p, 'crossbody-bag')) out.push(P.line(`M${-g.shoulder * 0.55} ${-T - 2}L${g.hip * 0.82} ${-T * 0.08}`, 'accentShade', 8), P.shape(`M${g.hip * 0.4} ${-T * 0.14}L${g.hip + 10} ${-T * 0.14}L${g.hip + 12} ${T * 0.1}L${g.hip * 0.4 - 2} ${T * 0.1}Z`, 'accent', {width: 5}), P.line(`M${g.hip * 0.4} ${-T * 0.04}L${g.hip + 10} ${-T * 0.04}`, 'accentShade', 4));
  return out;
}

/** The pack itself, behind the torso. */
export function backpackBack(ctx) {
  const {g, p, P} = ctx;
  if (!has(p, 'backpack')) return [];
  const T = g.torso, w = g.shoulder - 8;
  return [P.shape(`M${-w} ${-T + 10}Q${-w} ${-T - 44} ${-w + 34} ${-T - 44}L${w - 34} ${-T - 44}Q${w} ${-T - 44} ${w} ${-T + 10}L${w} ${-T * 0.3}L${-w} ${-T * 0.3}Z`, 'accent')];
}

// ---------------------------------------------------------------------------
// Limbs

/** A watch on the left wrist (forearm frame). */
export function wristWear(ctx, side) {
  const {g, p, P} = ctx;
  if (side !== 'l' || !has(p, 'watch')) return [];
  const y = g.foreArm - 12;
  return [P.shape(`M${r1(-g.armW * 0.5)} ${y - 8}L${r1(g.armW * 0.5)} ${y - 8}L${r1(g.armW * 0.5)} ${y + 8}L${r1(-g.armW * 0.5)} ${y + 8}Z`, '#3a3f4b', {width: 4}), P.ellipse(0, y, 9, 9, '#e7e2d6', {width: 3.5})];
}

/** Which hand holds a cane or crutch: the one away from the facing side. */
export const aidSide = (p, facing) => (HELD_AIDS.includes(p.mobility) ? (facing === 'left' ? 'r' : 'l') : null);

/**
 * A held mobility aid in the hand's frame (the hand at the origin, the
 * forearm along +y), reaching the floor `length` away. The cuff of a
 * forearm crutch sits up the forearm at `cuffY` (negative).
 */
export function heldAid(ctx, length, cuffY) {
  const {p, P} = ctx;
  const L = r1(length);
  if (p.mobility === 'cane') return [P.line(`M-26 -8Q-26 -24 -8 -22L0 -14L0 ${L}`, 'outline', 17), P.line(`M-26 -8Q-26 -24 -8 -22L0 -14L0 ${L}`, '#8a5a36', 9)];
  if (p.mobility === 'white-cane') return [P.line(`M0 -16L0 ${L}`, 'outline', 13), P.line(`M0 -16L0 ${L}`, '#f6f4ee', 6), P.line(`M0 ${r1(L - 70)}L0 ${L}`, '#c8323c', 6)];
  return [
    P.line(`M0 ${r1(cuffY)}L0 ${L}`, 'outline', 15), P.line(`M0 ${r1(cuffY)}L0 ${L}`, '#9aa3ad', 7),
    P.shape(`M-16 ${r1(cuffY - 10)}Q0 ${r1(cuffY - 22)} 16 ${r1(cuffY - 10)}L16 ${r1(cuffY + 6)}Q0 ${r1(cuffY - 6)} -16 ${r1(cuffY + 6)}Z`, '#5a616d', {width: 4.5}),
    P.line('M-18 0L14 0', 'outline', 15), P.line('M-18 0L14 0', '#3a3f4b', 8)
  ];
}

/** A prosthetic forearm and hand (forearm frame), replacing the arm's own. */
export function prostheticForearm(ctx) {
  const {g, P} = ctx;
  const len = g.foreArm, w = g.armW * 0.8, hand = g.hand;
  return [
    ...P.limb(len * 0.34, g.armW * 0.95, '#3a3f4b'),
    ...P.limb(len, w * 0.72, '#aab2bc', len * 0.3),
    P.line(`M0 ${r1(len * 0.42)}L0 ${r1(len * 0.92)}`, '#d7dce2', 4),
    P.shape(`M${r1(-hand * 0.85)} ${r1(len - 4)}L${r1(hand * 0.85)} ${r1(len - 4)}L${r1(hand * 0.9)} ${r1(len + hand * 1.1)}Q0 ${r1(len + hand * 1.5)} ${r1(-hand * 0.9)} ${r1(len + hand * 1.1)}Z`, '#8d96a1'),
    P.line(`M${r1(-hand * 0.4)} ${r1(len + hand * 0.4)}L${r1(-hand * 0.4)} ${r1(len + hand * 1.1)}M${r1(hand * 0.4)} ${r1(len + hand * 0.4)}L${r1(hand * 0.4)} ${r1(len + hand * 1.1)}`, '#5a616d', 4)
  ];
}

/** A prosthetic shin (shin frame) with the trouser leg cuffed at the knee. */
export function prostheticShin(ctx, legColor) {
  const {g, p, P} = ctx;
  const covered = ['trousers', 'leggings'].includes(p.outfit.bottom);
  const L = g.shin;
  return [
    ...P.limb(L * 0.3, g.legW * 0.92, covered ? legColor : '#2c2f36'),
    ...(covered ? [P.line(`M${r1(-g.legW * 0.5)} ${r1(L * 0.3)}L${r1(g.legW * 0.5)} ${r1(L * 0.3)}`, 'bottomShade', 9)] : []),
    ...P.limb(L - 18, g.legW * 0.24, '#aab2bc', L * 0.3),
    P.ellipse(0, L * 0.34, g.legW * 0.24, 9, '#5a616d', {width: 4})
  ];
}

// ---------------------------------------------------------------------------
// Wheelchair (root frame, behind the body)

/** A wheelchair seen from the front, behind a seated character. */
export function wheelchair(ctx) {
  const {g, P} = ctx;
  const seat = g.hipY + g.sitDrop;
  const foot = r1(g.hipY + 10 + g.sitDrop + (g.thigh + g.shin + g.foot - 10) * 0.42);
  const W = g.hip + 34, r = r1(-seat * 0.56);
  const frame = '#4a505c', tyre = '#23252b', metal = '#b8bec8';
  const out = [];
  // Backrest and handles.
  out.push(P.shape(pts([[-g.hip - 10, seat - g.torso * 0.62], [g.hip + 10, seat - g.torso * 0.62], [g.hip + 14, seat + 6], [-g.hip - 14, seat + 6]]), frame));
  for (const sx of [-1, 1]) out.push(P.line(`M${sx * (g.hip + 12)} ${r1(seat + 4)}L${sx * (g.hip + 12)} ${r1(seat - g.torso * 0.7)}L${sx * (g.hip + 30)} ${r1(seat - g.torso * 0.74)}`, tyre, 10));
  // Wheels at each side.
  for (const sx of [-1, 1]) {
    out.push(P.ellipse(sx * W, -r, r * 0.3, r, tyre));
    out.push(P.ellipse(sx * W, -r, r * 0.2, r * 0.8, metal, {width: 4}));
    out.push(P.line(`M${sx * W} ${r1(-r * 1.7)}L${sx * W} ${r1(-r * 0.3)}`, frame, 4));
  }
  // Seat, front posts, footplate and casters.
  out.push(P.shape(pts([[-g.hip - 18, seat - 10], [g.hip + 18, seat - 10], [g.hip + 18, seat + 20], [-g.hip - 18, seat + 20]]), frame));
  for (const sx of [-1, 1]) {
    out.push(P.line(`M${sx * (g.hip + 8)} ${r1(seat + 18)}L${sx * (g.hip - 4)} ${foot}`, metal, 8));
    out.push(P.ellipse(sx * (g.hip + 2), -18, 10, 18, tyre));
    out.push(P.line(`M${sx * (g.hip + 2)} ${foot}L${sx * (g.hip + 2)} -30`, metal, 6));
  }
  out.push(P.shape(pts([[-g.hip - 6, foot - 4], [g.hip + 6, foot - 4], [g.hip + 2, foot + 12], [-g.hip - 2, foot + 12]]), metal, {width: 5}));
  return out;
}

export const isPlacedGroup = (children, transform) => group(children, {transform});
