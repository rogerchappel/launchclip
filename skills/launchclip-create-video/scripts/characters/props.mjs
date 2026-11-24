// Hand props: small things a cast member holds, hands over, throws, drops
// or lifts (characters/contact.mjs). Each is drawn simply in rig units about
// its centre, so it reads in every style at the cast's scale, and names the
// points a hand grips: hands reach those points (two-bone, aim.mjs), the prop
// is never stuck to a hand, so a hand and the prop it holds share one
// coordinate source.
//
//   w, h      size (rig units; the cast's scale draws it)
//   hands     1 | 2: carried in the facing hand, or in both (by its sides)
//   grip      one-hand props: the hand's centre relative to the prop's centre
//   heavy     resists before it moves (a lift strains first)
//   bouncy    bounces when it lands
//   layers    sheets that lag and spring back on an impact (paper-stack)
//
// Imports only sibling kit/core files.

import {el} from '../catalog-b-view.mjs';

export const HAND_PROPS = Object.freeze({
  box: Object.freeze({w: 170, h: 140, hands: 2, heavy: true, describe: 'a cardboard box (both hands)'}),
  'paper-stack': Object.freeze({w: 160, h: 70, hands: 2, layers: 5, describe: 'a stack of paper whose sheets lag and spring back (both hands)'}),
  ball: Object.freeze({w: 90, h: 90, hands: 1, grip: Object.freeze({x: 0, y: 34}), bouncy: true, describe: 'a ball (bounces)'}),
  cup: Object.freeze({w: 64, h: 78, hands: 1, grip: Object.freeze({x: 0, y: 18}), describe: 'a coffee cup'}),
  sign: Object.freeze({w: 200, h: 330, hands: 1, grip: Object.freeze({x: 0, y: 130}), describe: 'a sign on a stick, held up'}),
  coin: Object.freeze({w: 52, h: 52, hands: 1, grip: Object.freeze({x: 0, y: 14}), describe: 'a coin'})
});
export const HAND_PROP_NAMES = Object.freeze(Object.keys(HAND_PROPS));

const INK = '#1e1c1a';
const LINE = 6;
const shape = (tag, attrs) => el(tag, null, null, [], {stroke: INK, strokeWidth: LINE, strokeLinejoin: 'round', strokeLinecap: 'round', ...attrs});

/**
 * Where each hand goes on a prop centred at (cx, cy) (canvas px; s px per
 * rig unit). mode carry: a one-hand prop in `side`'s hand, a two-hand prop by
 * both sides. mode near: the side of the prop toward `from` (-1 left, 1
 * right), for a handover where two people hold it at once.
 * → {L?: {x, y}, R?: {x, y}}
 */
export function gripPoints(name, {cx, cy, s, side = 'R', mode = 'carry', from = -1}) {
  const p = HAND_PROPS[name];
  const at = (dx, dy) => ({x: cx + dx * s, y: cy + dy * s});
  if (mode === 'near') {
    if (p.hands === 2) return {L: at(from * p.w / 2, -p.h * 0.22), R: at(from * p.w / 2, p.h * 0.22)};
    return {[side]: at(from * p.w * 0.3, p.grip.y)};
  }
  if (p.hands === 2) return {L: at(-p.w / 2, 0), R: at(p.w / 2, 0)};
  return {[side]: at(p.grip.x, p.grip.y)};
}

/**
 * A prop's drawing, centred on the origin (rig units): {body: nodes, layers:
 * [nodes] (paper-stack sheets, bottom first; each its own group so it can lag)}.
 * colors: {accent, primary, paper}.
 */
export function drawHandProp(name, colors = {}) {
  const p = HAND_PROPS[name];
  const accent = colors.accent ?? '#d7372c', primary = colors.primary ?? '#2a9d8f', paper = colors.paper ?? '#f6f3ee';
  const w = p.w, h = p.h;
  if (name === 'box') return {body: [
    shape('rect', {x: -w / 2, y: -h / 2, width: w, height: h, rx: 6, fill: '#c8955a'}),
    shape('path', {d: `M${-w / 2} ${-h / 2 + 30}L${w / 2} ${-h / 2 + 30}`, fill: 'none', strokeWidth: 4}),
    el('rect', null, null, [], {x: -14, y: -h / 2, width: 28, height: 30, fill: '#e8d3a8'})
  ], layers: []};
  if (name === 'paper-stack') {
    const sheet = h / p.layers;
    return {body: [], layers: Array.from({length: p.layers}, (_, k) => [shape('rect', {x: -w / 2 + (k % 2 ? 4 : -3), y: h / 2 - (k + 1) * sheet, width: w, height: sheet, rx: 2, fill: paper, strokeWidth: 4})])};
  }
  if (name === 'ball') return {body: [
    shape('circle', {cx: 0, cy: 0, r: w / 2, fill: accent}),
    shape('path', {d: `M${-w / 2} 0C${-w / 6} -14 ${w / 6} 14 ${w / 2} 0`, fill: 'none', strokeWidth: 4})
  ], layers: []};
  if (name === 'cup') return {body: [
    shape('path', {d: `M${w / 2 - 6} -10C${w / 2 + 22} -10 ${w / 2 + 22} 18 ${w / 2 - 8} 18`, fill: 'none'}),
    shape('path', {d: `M${-w / 2} ${-h / 2}L${w / 2} ${-h / 2}L${w / 2 - 8} ${h / 2}L${-w / 2 + 8} ${h / 2}Z`, fill: paper}),
    el('rect', null, null, [], {x: -w / 2 + 4, y: -8, width: w - 9, height: 18, fill: primary})
  ], layers: []};
  if (name === 'sign') return {body: [
    shape('path', {d: `M0 ${-h / 2 + 100}L0 ${h / 2}`, fill: 'none', stroke: '#8a5a2b', strokeWidth: 14}),
    shape('rect', {x: -w / 2, y: -h / 2, width: w, height: 120, rx: 8, fill: paper}),
    shape('path', {d: `M${-w / 2 + 30} ${-h / 2 + 46}L${w / 2 - 30} ${-h / 2 + 46}M${-w / 2 + 30} ${-h / 2 + 76}L${w / 2 - 70} ${-h / 2 + 76}`, fill: 'none', stroke: accent, strokeWidth: 10})
  ], layers: []};
  return {body: [
    shape('circle', {cx: 0, cy: 0, r: w / 2, fill: '#f2c14e'}),
    shape('circle', {cx: 0, cy: 0, r: w / 2 - 12, fill: 'none', strokeWidth: 3})
  ], layers: []};
}
