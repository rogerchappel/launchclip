// Props: objects placeable in any world, recoloured from the palette and
// drawn at the world's detail level.
//
// A prop is {label, on, h, w, draw(k, x, y, s)}: `on` lists the anchors it
// prefers (surface, counter, ground, floor, wall, sky), most preferred
// first; h and w are its real size in metres; draw takes the world kit, the
// prop's centre x and base y in canvas px, and the anchor's px per metre.
//
// Placement (params.props entries): "laptop" or {id, at?, on?, scale?,
// layer?, flip?}. at: left | centre | right or a share of the width
// (0..1); without it, props fill free slots from the frame edges inward,
// keeping the centre band open for characters and text.

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';
import {tree, lampPost} from './common.mjs';
import {pottedPlant, frameArt, deskLamp, monitor, chair} from './furniture.mjs';
import {car} from './street.mjs';
import {bench} from './outside.mjs';

const P = (label, on, h, w, draw) => ({label, on, h, w, draw});
const SURFACE = ['surface', 'counter', 'ground'];
const GROUND = ['ground', 'floor'];
const FLOOR = ['floor', 'ground'];
const WALL = ['wall', 'ground'];
const SKY = ['sky', 'wall', 'ground'];

// Small helpers in metres: s = px per metre.
const shadowUnder = (k, x, y, w, s) => k.p.shadow(x, y, w * s * 0.6, Math.max(4, w * s * 0.08));
const lit = k => k.time !== 'day';

const DEFS = {
  // -- Desk and table top ---------------------------------------------------
  laptop: P('laptop', SURFACE, 0.24, 0.34, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.34 * s, h = 0.22 * s;
    return [shadowUnder(k, x, y, 0.4, s),
      p.path(pts([[x - w * 0.42, y - 2], [x + w * 0.42, y - 2], [x + w * 0.38, y - h], [x - w * 0.38, y - h]]), pal.metalShade, {}),
      p.path(pts([[x - w * 0.36, y - h * 0.12], [x + w * 0.36, y - h * 0.12], [x + w * 0.32, y - h * 0.9], [x - w * 0.32, y - h * 0.9]]), lit(k) ? '#3a5b9a' : '#c8daf0', {glow: lit(k), stroke: false}),
      p.rect(x - w * 0.24, y - h * 0.72, w * 0.3, h * 0.08, pal.primary, {stroke: false, glow: lit(k)}),
      p.rect(x - w * 0.24, y - h * 0.56, w * 0.44, h * 0.05, lit(k) ? '#9fb8e8' : '#8ea6c4', {stroke: false, glow: lit(k)}),
      lit(k) ? p.glow(x, y - h * 0.5, w * 0.9, '#9fc0ff', 0.25) : null,
      p.rect(x - w / 2, y - 0.012 * s, w, 0.018 * s, pal.metal, {rx: 3 * k.u})];
  }),
  phone: P('phone', SURFACE, 0.15, 0.08, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.075 * s, h = 0.15 * s;
    return [p.rect(x - w / 2, y - h, w, h, pal.black, {rx: w * 0.18}),
      p.rect(x - w * 0.4, y - h * 0.92, w * 0.8, h * 0.84, lit(k) ? '#4a6fb8' : '#bcd3ef', {rx: w * 0.1, stroke: false, glow: lit(k)}),
      p.circle(x, y - h * 0.86, w * 0.06, pal.accent, {stroke: false})];
  }),
  tablet: P('tablet', SURFACE, 0.24, 0.18, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.18 * s, h = 0.24 * s;
    return [p.path(pts([[x - w * 0.5, y], [x + w * 0.5, y], [x + w * 0.42, y - h], [x - w * 0.42, y - h]]), pal.black, {}),
      p.path(pts([[x - w * 0.42, y - h * 0.05], [x + w * 0.42, y - h * 0.05], [x + w * 0.36, y - h * 0.94], [x - w * 0.36, y - h * 0.94]]), pal.accentLight, {glow: lit(k), stroke: false}),
      p.circle(x, y - h * 0.55, w * 0.14, pal.primary, {stroke: false})];
  }),
  mug: P('mug', SURFACE, 0.1, 0.1, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.08 * s, h = 0.1 * s;
    return [shadowUnder(k, x, y, 0.1, s),
      p.stroke(`M${f(x + w * 0.45)} ${f(y - h * 0.75)}Q${f(x + w * 0.95)} ${f(y - h * 0.6)} ${f(x + w * 0.45)} ${f(y - h * 0.25)}`, pal.primary, Math.max(2, 0.012 * s / k.u)),
      p.rect(x - w / 2, y - h, w, h, pal.primary, {rx: w * 0.12}),
      p.shade(x - w / 2, y - h, w, h, 'right', 0.3),
      k.d.n >= 1 ? p.stroke(`M${f(x - w * 0.1)} ${f(y - h * 1.1)}Q${f(x + w * 0.1)} ${f(y - h * 1.4)} ${f(x - w * 0.05)} ${f(y - h * 1.7)}`, '#ffffff', 2, {opacity: 0.5}) : null];
  }),
  'coffee-cup': P('takeaway coffee', SURFACE, 0.14, 0.08, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.08 * s, h = 0.14 * s;
    return [shadowUnder(k, x, y, 0.08, s), p.poly([[x - w * 0.4, y], [x + w * 0.4, y], [x + w * 0.5, y - h * 0.86], [x - w * 0.5, y - h * 0.86]], pal.cream, {}),
      p.rect(x - w * 0.47, y - h * 0.62, w * 0.94, h * 0.26, pal.woodShade, {stroke: false}),
      p.rect(x - w * 0.56, y - h, w * 1.12, h * 0.16, pal.white, {rx: 2 * k.u})];
  }),
  books: P('books', SURFACE, 0.2, 0.3, (k, x, y, s) => {
    const {p, pal} = k;
    const cols = [pal.primary, pal.accent, pal.cream, pal.primaryShade];
    const out = [shadowUnder(k, x, y, 0.3, s)];
    let by = y;
    [[0.3, 0.05], [0.27, 0.045], [0.29, 0.05], [0.25, 0.04]].forEach(([w, h], i) => {
      const bw = w * s, bh = h * s, ox = (i % 2 ? 0.01 : -0.01) * s;
      out.push(p.rect(x - bw / 2 + ox, by - bh, bw, bh, cols[i], {rx: 2 * k.u}));
      if (k.d.n >= 1) out.push(p.rect(x - bw / 2 + ox + bw * 0.86, by - bh * 0.85, bw * 0.1, bh * 0.7, '#ffffff', {opacity: 0.6, stroke: false}));
      by -= bh;
    });
    return out;
  }),
  notebook: P('notebook', SURFACE, 0.02, 0.24, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.24, s), p.rect(x - 0.12 * s, y - 0.025 * s, 0.24 * s, 0.025 * s, pal.accent, {rx: 2 * k.u}), p.rect(x - 0.11 * s, y - 0.03 * s, 0.22 * s, 0.008 * s, pal.white, {stroke: false})];
  }),
  'pen-cup': P('pen cup', SURFACE, 0.18, 0.08, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.08 * s, h = 0.1 * s;
    return [p.line(x - w * 0.2, y - h, x - w * 0.4, y - h * 1.8, pal.primary, 3), p.line(x, y - h, x + w * 0.1, y - h * 1.9, pal.accent, 3), p.line(x + w * 0.2, y - h, x + w * 0.45, y - h * 1.7, pal.ink, 3),
      p.rect(x - w / 2, y - h, w, h, pal.metalShade, {rx: 3 * k.u})];
  }),
  lightbulb: P('lightbulb', SURFACE, 0.3, 0.2, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.1 * s, cy = y - 0.2 * s;
    return [p.glow(x, cy, r * 4, '#ffe28a', lit(k) ? 0.6 : 0.35),
      p.circle(x, cy, r, '#fff1b8', {glow: true}),
      p.stroke(`M${f(x - r * 0.3)} ${f(cy + r * 0.2)}L${f(x - r * 0.15)} ${f(cy - r * 0.2)}L${f(x)} ${f(cy + r * 0.1)}L${f(x + r * 0.15)} ${f(cy - r * 0.2)}L${f(x + r * 0.3)} ${f(cy + r * 0.2)}`, '#e0a020', 2.5, {glow: true}),
      p.rect(x - r * 0.45, cy + r * 0.85, r * 0.9, r * 0.6, pal.metalShade, {rx: 2 * k.u}),
      p.rect(x - r * 0.3, cy + r * 1.45, r * 0.6, y - cy - r * 1.45, pal.metal, {stroke: false})];
  }),
  trophy: P('trophy', SURFACE, 0.32, 0.2, (k, x, y, s) => {
    const {p, pal} = k;
    const gold = pal.g('#f0b632'), goldS = pal.g('#c48a1a');
    const w = 0.2 * s, h = 0.32 * s;
    return [shadowUnder(k, x, y, 0.2, s), p.rect(x - w * 0.4, y - h * 0.16, w * 0.8, h * 0.16, pal.woodShade, {rx: 3 * k.u}),
      p.rect(x - w * 0.07, y - h * 0.42, w * 0.14, h * 0.28, goldS, {}),
      p.stroke(`M${f(x - w * 0.3)} ${f(y - h * 0.88)}Q${f(x - w * 0.62)} ${f(y - h * 0.86)} ${f(x - w * 0.3)} ${f(y - h * 0.6)}M${f(x + w * 0.3)} ${f(y - h * 0.88)}Q${f(x + w * 0.62)} ${f(y - h * 0.86)} ${f(x + w * 0.3)} ${f(y - h * 0.6)}`, gold, 5),
      p.path(`M${f(x - w * 0.34)} ${f(y - h)}L${f(x + w * 0.34)} ${f(y - h)}Q${f(x + w * 0.3)} ${f(y - h * 0.44)} ${f(x)} ${f(y - h * 0.42)}Q${f(x - w * 0.3)} ${f(y - h * 0.44)} ${f(x - w * 0.34)} ${f(y - h)}Z`, gold, {}),
      p.sheen(x - w * 0.3, y - h, w * 0.2, h * 0.5, 0.5),
      k.d.n >= 1 ? p.circle(x, y - h * 0.72, w * 0.08, '#fff6c8', {stroke: false}) : null];
  }),
  coins: P('coins', SURFACE, 0.12, 0.2, (k, x, y, s) => {
    const {p, pal} = k;
    const gold = pal.g('#f0b632'), goldS = pal.g('#c48a1a');
    const out = [shadowUnder(k, x, y, 0.22, s)];
    const r = 0.045 * s, t = 0.012 * s;
    for (const [dx, n] of [[-0.06, 6], [0.04, 9], [0.12, 4]]) for (let i = 0; i < n; i++) {
      const cx = x + dx * s, cy = y - i * t;
      out.push(p.ellipse(cx, cy, r, r * 0.35, goldS, {stroke: k.d.outline ? true : false, sw: 0.5}), p.ellipse(cx, cy - t * 0.6, r, r * 0.35, gold, {stroke: false}));
    }
    return out;
  }),
  'piggy-bank': P('piggy bank', SURFACE, 0.16, 0.22, (k, x, y, s) => {
    const {p, pal} = k;
    const pink = pal.g('#f4a6b8'), w = 0.22 * s, h = 0.16 * s;
    return [shadowUnder(k, x, y, 0.22, s), p.rect(x - w * 0.3, y - h * 0.3, w * 0.12, h * 0.3, pink, {}), p.rect(x + w * 0.16, y - h * 0.3, w * 0.12, h * 0.3, pink, {}),
      p.ellipse(x, y - h * 0.56, w * 0.48, h * 0.42, pink, {}), p.ellipse(x + w * 0.46, y - h * 0.56, w * 0.08, h * 0.12, mixColor('#000000', pink, 0.1), {}),
      p.circle(x + w * 0.24, y - h * 0.72, 2.5 * k.u, pal.ink, {stroke: false}), p.rect(x - w * 0.08, y - h * 0.98, w * 0.16, h * 0.05, pal.ink, {stroke: false})];
  }),
  calculator: P('calculator', SURFACE, 0.16, 0.12, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.12 * s, h = 0.16 * s;
    const out = [p.rect(x - w / 2, y - h, w, h, pal.ink, {rx: 4 * k.u}), p.rect(x - w * 0.4, y - h * 0.9, w * 0.8, h * 0.2, '#b8d8b0', {stroke: false})];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(p.rect(x - w * 0.38 + c * w * 0.27, y - h * 0.6 + r * h * 0.18, w * 0.2, h * 0.12, c === 2 && r === 2 ? pal.accent : pal.metalLight, {stroke: false, rx: 2 * k.u}));
    return out;
  }),
  headphones: P('headphones', SURFACE, 0.18, 0.18, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.08 * s;
    return [p.stroke(`M${f(x - r)} ${f(y - r * 0.8)}A${f(r)} ${f(r * 1.1)} 0 0 1 ${f(x + r)} ${f(y - r * 0.8)}`, pal.ink, 6),
      p.rect(x - r * 1.25, y - r * 1.1, r * 0.5, r * 1.1, pal.primary, {rx: r * 0.2}), p.rect(x + r * 0.75, y - r * 1.1, r * 0.5, r * 1.1, pal.primary, {rx: r * 0.2})];
  }),
  camera: P('camera', SURFACE, 0.12, 0.18, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.18 * s, h = 0.11 * s;
    return [shadowUnder(k, x, y, 0.18, s), p.rect(x - w / 2, y - h, w, h, pal.black, {rx: 4 * k.u}), p.rect(x - w * 0.36, y - h * 1.2, w * 0.24, h * 0.22, pal.black, {rx: 2 * k.u}),
      p.circle(x + w * 0.06, y - h * 0.5, h * 0.36, pal.metalShade, {}), p.circle(x + w * 0.06, y - h * 0.5, h * 0.22, '#3a4a6a', {stroke: false}),
      p.circle(x + w * 0.02, y - h * 0.56, h * 0.06, '#ffffff', {stroke: false, opacity: 0.7}), p.circle(x + w * 0.36, y - h * 0.8, 3 * k.u, '#ff4d4d', {glow: true, stroke: false})];
  }),
  microphone: P('microphone', SURFACE, 0.3, 0.12, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.12, s), p.ellipse(x, y - 0.01 * s, 0.06 * s, 0.015 * s, pal.ink, {}), p.rect(x - 0.008 * s, y - 0.18 * s, 0.016 * s, 0.17 * s, pal.metalShade, {}),
      p.rect(x - 0.035 * s, y - 0.3 * s, 0.07 * s, 0.13 * s, pal.metal, {rx: 0.035 * s}),
      k.d.n >= 1 ? p.line(x - 0.025 * s, y - 0.25 * s, x + 0.025 * s, y - 0.25 * s, pal.metalShade, 1.5) : null];
  }),
  keyboard: P('keyboard', SURFACE, 0.03, 0.42, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.42 * s;
    const out = [p.rect(x - w / 2, y - 0.03 * s, w, 0.03 * s, pal.metalShade, {rx: 3 * k.u})];
    if (k.d.n >= 1) for (let i = 0; i < 14; i++) out.push(p.rect(x - w * 0.46 + i * w * 0.066, y - 0.038 * s, w * 0.05, 0.01 * s, pal.metalLight, {stroke: false}));
    return out;
  }),
  monitor: P('monitor', SURFACE, 0.45, 0.55, (k, x, y, s) => monitor(k, x, y, 0.55 * s)),
  succulent: P('succulent', SURFACE, 0.14, 0.12, (k, x, y, s) => pottedPlant(k, x, y, 0.16 * s, {kind: 'cactus'})),
  globe: P('globe', SURFACE, 0.36, 0.26, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.12 * s, cy = y - 0.2 * s;
    return [shadowUnder(k, x, y, 0.18, s), p.ellipse(x, y - 0.01 * s, 0.07 * s, 0.015 * s, pal.woodShade, {}), p.line(x, y, x, cy + r, pal.woodShade, 4),
      p.circle(x, cy, r, pal.water, {}), p.path(`M${f(x - r * 0.6)} ${f(cy - r * 0.5)}Q${f(x - r * 0.1)} ${f(cy - r * 0.7)} ${f(x)} ${f(cy - r * 0.1)}Q${f(x - r * 0.4)} ${f(cy + r * 0.3)} ${f(x - r * 0.6)} ${f(cy - r * 0.5)}Z`, pal.grass, {stroke: false}),
      p.path(`M${f(x + r * 0.3)} ${f(cy + r * 0.1)}Q${f(x + r * 0.7)} ${f(cy)} ${f(x + r * 0.5)} ${f(cy + r * 0.6)}Z`, pal.grass, {stroke: false}),
      p.stroke(`M${f(x - r * 1.2)} ${f(cy + r * 0.3)}A${f(r * 1.2)} ${f(r * 1.2)} 0 0 0 ${f(x + r * 0.6)} ${f(cy - r * 1.1)}`, pal.metalShade, 3)];
  }),
  hourglass: P('hourglass', SURFACE, 0.24, 0.12, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.12 * s, h = 0.24 * s;
    return [p.rect(x - w / 2, y - 0.02 * s, w, 0.02 * s, pal.woodShade, {}), p.rect(x - w / 2, y - h, w, 0.02 * s, pal.woodShade, {}),
      p.path(`M${f(x - w * 0.36)} ${f(y - h + 0.02 * s)}L${f(x + w * 0.36)} ${f(y - h + 0.02 * s)}L${f(x + w * 0.04)} ${f(y - h / 2)}L${f(x + w * 0.36)} ${f(y - 0.02 * s)}L${f(x - w * 0.36)} ${f(y - 0.02 * s)}L${f(x - w * 0.04)} ${f(y - h / 2)}Z`, mixColor('#ffffff', pal.glass, 0.4), {}),
      p.poly([[x - w * 0.26, y - 0.02 * s], [x + w * 0.26, y - 0.02 * s], [x, y - h * 0.3]], pal.sand, {stroke: false}),
      p.poly([[x - w * 0.18, y - h * 0.8], [x + w * 0.18, y - h * 0.8], [x, y - h * 0.56]], pal.sand, {stroke: false})];
  }),
  'alarm-clock': P('alarm clock', SURFACE, 0.16, 0.14, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.065 * s, cy = y - r - 0.02 * s;
    return [p.line(x - r * 0.6, cy + r * 0.8, x - r * 0.9, y, pal.ink, 3), p.line(x + r * 0.6, cy + r * 0.8, x + r * 0.9, y, pal.ink, 3),
      p.circle(x - r * 0.75, cy - r * 0.85, r * 0.35, pal.accent, {}), p.circle(x + r * 0.75, cy - r * 0.85, r * 0.35, pal.accent, {}),
      p.circle(x, cy, r, pal.accent, {}), p.circle(x, cy, r * 0.8, pal.white, {stroke: false}), p.line(x, cy, x, cy - r * 0.55, pal.ink, 2.5), p.line(x, cy, x + r * 0.4, cy, pal.ink, 2.5)];
  }),
  gift: P('gift box', SURFACE, 0.26, 0.26, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.26 * s, h = 0.2 * s;
    return [shadowUnder(k, x, y, 0.26, s), p.rect(x - w / 2, y - h, w, h, pal.primary, {}), p.rect(x - w * 0.55, y - h - 0.05 * s, w * 1.1, 0.06 * s, pal.primaryLight, {}),
      p.rect(x - w * 0.08, y - h - 0.05 * s, w * 0.16, h + 0.05 * s, pal.accent, {stroke: false}),
      p.path(`M${f(x)} ${f(y - h - 0.05 * s)}Q${f(x - w * 0.4)} ${f(y - h - 0.2 * s)} ${f(x - w * 0.1)} ${f(y - h - 0.06 * s)}M${f(x)} ${f(y - h - 0.05 * s)}Q${f(x + w * 0.4)} ${f(y - h - 0.2 * s)} ${f(x + w * 0.1)} ${f(y - h - 0.06 * s)}`, null, {stroke: pal.accent, sw: 4}),
      p.shade(x - w / 2, y - h, w, h, 'right', 0.3)];
  }),
  jar: P('jar', SURFACE, 0.18, 0.12, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.12 * s, h = 0.16 * s;
    return [shadowUnder(k, x, y, 0.12, s), p.rect(x - w / 2, y - h, w, h, mixColor('#ffffff', pal.glass, 0.4), {rx: w * 0.2, opacity: 0.85}),
      p.rect(x - w * 0.42, y - h * 0.6, w * 0.84, h * 0.56, pal.accentShade, {stroke: false, rx: w * 0.12}),
      p.rect(x - w * 0.42, y - h - 0.03 * s, w * 0.84, 0.035 * s, pal.primary, {rx: 2 * k.u})];
  }),
  cake: P('cake', SURFACE, 0.2, 0.3, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.28 * s, h = 0.14 * s;
    const out = [shadowUnder(k, x, y, 0.34, s), p.ellipse(x, y - 0.01 * s, w * 0.62, 0.02 * s, pal.white, {}), p.rect(x - w / 2, y - h, w, h, pal.cream, {}),
      p.rect(x - w / 2, y - h * 0.55, w, h * 0.14, pal.accent, {stroke: false}),
      p.path(`M${f(x - w / 2)} ${f(y - h)}Q${f(x - w * 0.3)} ${f(y - h * 0.7)} ${f(x - w * 0.1)} ${f(y - h)}Q${f(x + w * 0.1)} ${f(y - h * 0.68)} ${f(x + w * 0.3)} ${f(y - h)}Q${f(x + w * 0.42)} ${f(y - h * 0.75)} ${f(x + w / 2)} ${f(y - h)}Z`, pal.white, {})];
    for (const dx of [-0.25, 0, 0.25]) {
      out.push(p.rect(x + dx * w - 0.006 * s, y - h - 0.06 * s, 0.012 * s, 0.06 * s, pal.primary, {stroke: false}));
      out.push(p.ellipse(x + dx * w, y - h - 0.075 * s, 0.008 * s, 0.015 * s, '#ffc840', {glow: true, stroke: false}));
      if (lit(k)) out.push(p.glow(x + dx * w, y - h - 0.075 * s, 0.05 * s, '#ffc840', 0.5));
    }
    return out;
  }),
  pizza: P('pizza', SURFACE, 0.04, 0.34, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.17 * s;
    const out = [shadowUnder(k, x, y, 0.36, s), p.ellipse(x, y - 0.015 * s, r, r * 0.3, pal.g('#d99a50'), {}), p.ellipse(x, y - 0.02 * s, r * 0.86, r * 0.24, pal.g('#e0503a'), {stroke: false})];
    for (const [dx, dy] of [[-0.4, 0], [0.2, -0.05], [0.5, 0.05], [-0.1, 0.08], [0, -0.1]]) out.push(p.ellipse(x + dx * r, y - 0.02 * s + dy * r, r * 0.1, r * 0.04, pal.g('#f5e2a8'), {stroke: false}));
    return out;
  }),
  bowl: P('bowl', SURFACE, 0.1, 0.24, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.24 * s, h = 0.1 * s;
    return [shadowUnder(k, x, y, 0.24, s), p.ellipse(x, y - h, w / 2, h * 0.22, pal.g('#e8c070'), {}),
      ...[[-0.2, 0.05, pal.grass], [0.1, -0.02, pal.accent], [0.25, 0.04, pal.g('#e04a3a')]].map(([dx, dy, c]) => p.circle(x + dx * w, y - h - 0.02 * s + dy * s, 0.03 * s, c, {stroke: false})),
      p.path(`M${f(x - w / 2)} ${f(y - h)}Q${f(x - w / 2)} ${f(y)} ${f(x)} ${f(y)}Q${f(x + w / 2)} ${f(y)} ${f(x + w / 2)} ${f(y - h)}Z`, pal.primary, {}),
      p.sheen(x - w * 0.4, y - h, w * 0.3, h * 0.6, 0.35)];
  }),
  pan: P('frying pan', SURFACE, 0.06, 0.48, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.14 * s;
    return [shadowUnder(k, x, y, 0.3, s), p.rect(x + r * 0.9, y - 0.05 * s, 0.2 * s, 0.025 * s, pal.ink, {rx: 3 * k.u}),
      p.ellipse(x, y - 0.03 * s, r, r * 0.26, pal.black, {}), p.ellipse(x, y - 0.035 * s, r * 0.82, r * 0.18, '#3a3d44', {stroke: false}),
      p.ellipse(x - r * 0.1, y - 0.04 * s, r * 0.3, r * 0.1, pal.g('#ffd040'), {stroke: false}), p.circle(x - r * 0.1, y - 0.045 * s, r * 0.1, pal.g('#ffb020'), {stroke: false})];
  }),
  pot: P('cooking pot', SURFACE, 0.2, 0.3, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.26 * s, h = 0.18 * s;
    return [shadowUnder(k, x, y, 0.3, s), p.rect(x - w * 0.62, y - h * 0.8, w * 0.14, 0.03 * s, pal.ink, {}), p.rect(x + w * 0.48, y - h * 0.8, w * 0.14, 0.03 * s, pal.ink, {}),
      p.rect(x - w / 2, y - h, w, h, pal.metal, {rx: 4 * k.u}), p.rect(x - w * 0.54, y - h - 0.02 * s, w * 1.08, 0.03 * s, pal.metalShade, {rx: 3 * k.u}),
      p.circle(x, y - h - 0.04 * s, 0.015 * s, pal.ink, {}), p.shade(x - w / 2, y - h, w, h, 'right', 0.3),
      ...(k.d.n >= 1 ? [0, 1].map(i => p.stroke(`M${f(x - w * 0.15 + i * w * 0.3)} ${f(y - h - 0.06 * s)}Q${f(x - w * 0.05 + i * w * 0.3)} ${f(y - h - 0.12 * s)} ${f(x - w * 0.15 + i * w * 0.3)} ${f(y - h - 0.18 * s)}`, '#ffffff', 2.5, {opacity: 0.5})) : [])];
  }),
  'cutting-board': P('cutting board', SURFACE, 0.03, 0.4, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.4, s), p.rect(x - 0.2 * s, y - 0.025 * s, 0.4 * s, 0.025 * s, pal.woodLight, {rx: 4 * k.u}),
      p.circle(x - 0.06 * s, y - 0.045 * s, 0.025 * s, pal.g('#e04a3a'), {}), p.circle(x + 0.02 * s, y - 0.04 * s, 0.018 * s, pal.grass, {}),
      p.path(pts([[x + 0.06 * s, y - 0.03 * s], [x + 0.2 * s, y - 0.03 * s], [x + 0.2 * s, y - 0.045 * s], [x + 0.08 * s, y - 0.05 * s]]), pal.metalLight, {}), p.rect(x + 0.2 * s, y - 0.045 * s, 0.08 * s, 0.018 * s, pal.ink, {rx: 2 * k.u})];
  }),
  bread: P('bread loaf', SURFACE, 0.1, 0.26, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.26 * s, h = 0.1 * s, c = pal.g('#d9a05a');
    return [shadowUnder(k, x, y, 0.26, s), p.path(`M${f(x - w / 2)} ${f(y)}Q${f(x - w / 2)} ${f(y - h)} ${f(x)} ${f(y - h)}Q${f(x + w / 2)} ${f(y - h)} ${f(x + w / 2)} ${f(y)}Z`, c, {}),
      ...[-0.2, 0, 0.2].map(dx => p.line(x + dx * w - w * 0.05, y - h * 0.6, x + dx * w + w * 0.05, y - h * 0.9, mixColor('#ffffff', c, 0.3), 3))];
  }),
  'fruit-bowl': P('fruit bowl', SURFACE, 0.16, 0.3, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.3 * s, h = 0.08 * s;
    return [shadowUnder(k, x, y, 0.3, s),
      p.circle(x - w * 0.18, y - h - 0.03 * s, 0.045 * s, pal.g('#e04a3a'), {}), p.circle(x + w * 0.16, y - h - 0.03 * s, 0.045 * s, pal.g('#f0a020'), {}), p.circle(x, y - h - 0.06 * s, 0.05 * s, pal.grass, {}),
      p.path(`M${f(x + w * 0.05)} ${f(y - h - 0.02 * s)}Q${f(x + w * 0.3)} ${f(y - h - 0.12 * s)} ${f(x + w * 0.42)} ${f(y - h - 0.02 * s)}Q${f(x + w * 0.25)} ${f(y - h - 0.06 * s)} ${f(x + w * 0.05)} ${f(y - h - 0.02 * s)}Z`, pal.g('#f2d040'), {}),
      p.path(`M${f(x - w / 2)} ${f(y - h)}Q${f(x)} ${f(y + h * 0.4)} ${f(x + w / 2)} ${f(y - h)}Z`, pal.accent, {})];
  }),
  teapot: P('teapot', SURFACE, 0.2, 0.3, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.09 * s, cy = y - r;
    return [shadowUnder(k, x, y, 0.26, s), p.stroke(`M${f(x + r * 0.8)} ${f(cy)}Q${f(x + r * 1.5)} ${f(cy - r * 0.2)} ${f(x + r * 1.7)} ${f(cy - r * 0.8)}`, pal.accent, 7),
      p.stroke(`M${f(x - r * 0.9)} ${f(cy - r * 0.5)}Q${f(x - r * 1.6)} ${f(cy)} ${f(x - r * 0.9)} ${f(cy + r * 0.5)}`, pal.accent, 6),
      p.ellipse(x, cy, r * 1.05, r, pal.accent, {}), p.ellipse(x, cy - r * 0.9, r * 0.5, r * 0.15, pal.accentShade, {}), p.circle(x, cy - r * 1.1, r * 0.14, pal.accentShade, {}), p.sheen(x - r * 0.6, cy - r * 0.8, r * 0.4, r, 0.4)];
  }),
  kettle: P('kettle', SURFACE, 0.26, 0.24, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.2 * s, h = 0.2 * s;
    return [shadowUnder(k, x, y, 0.24, s), p.path(pts([[x - w * 0.45, y], [x + w * 0.45, y], [x + w * 0.35, y - h], [x - w * 0.35, y - h]]), pal.metal, {}),
      p.stroke(`M${f(x - w * 0.3)} ${f(y - h)}Q${f(x)} ${f(y - h * 1.5)} ${f(x + w * 0.3)} ${f(y - h)}`, pal.ink, 6),
      p.poly([[x + w * 0.4, y - h * 0.5], [x + w * 0.7, y - h * 0.8], [x + w * 0.66, y - h * 0.86], [x + w * 0.38, y - h * 0.7]], pal.metalShade, {}), p.shade(x - w * 0.45, y - h, w * 0.9, h, 'right', 0.3)];
  }),
  'water-bottle': P('water bottle', SURFACE, 0.26, 0.08, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.075 * s, h = 0.24 * s;
    return [shadowUnder(k, x, y, 0.08, s), p.rect(x - w / 2, y - h, w, h, pal.accent, {rx: w * 0.3}), p.rect(x - w * 0.35, y - h - 0.03 * s, w * 0.7, 0.035 * s, pal.ink, {rx: 2 * k.u}),
      p.rect(x - w / 2, y - h * 0.6, w, h * 0.18, pal.white, {stroke: false, opacity: 0.8}), p.sheen(x - w * 0.4, y - h, w * 0.25, h, 0.5)];
  }),
  apple: P('apple', SURFACE, 0.09, 0.09, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.045 * s;
    return [shadowUnder(k, x, y, 0.09, s), p.path(`M${f(x)} ${f(y - r * 1.6)}Q${f(x - r * 1.3)} ${f(y - r * 2)} ${f(x - r)} ${f(y - r * 0.6)}Q${f(x - r * 0.6)} ${f(y + r * 0.1)} ${f(x)} ${f(y - r * 0.1)}Q${f(x + r * 0.6)} ${f(y + r * 0.1)} ${f(x + r)} ${f(y - r * 0.6)}Q${f(x + r * 1.3)} ${f(y - r * 2)} ${f(x)} ${f(y - r * 1.6)}Z`, pal.g('#d8343a'), {}),
      p.line(x, y - r * 1.6, x + r * 0.2, y - r * 2.2, pal.trunk, 3), p.ellipse(x + r * 0.5, y - r * 2, r * 0.35, r * 0.15, pal.grass, {stroke: false})];
  }),
  candle: P('candle', SURFACE, 0.18, 0.08, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.06 * s, h = 0.14 * s;
    return [p.glow(x, y - h - 0.03 * s, 0.25 * s, pal.lampWarm, lit(k) ? 0.55 : 0.25), p.rect(x - w / 2, y - h, w, h, pal.cream, {rx: 2 * k.u}),
      p.ellipse(x, y - h - 0.03 * s, 0.012 * s, 0.025 * s, '#ffc840', {glow: true}), p.ellipse(x, y - h - 0.024 * s, 0.006 * s, 0.012 * s, '#fff6d0', {glow: true, stroke: false})];
  }),
  'game-controller': P('game controller', SURFACE, 0.05, 0.16, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.16 * s, h = 0.07 * s;
    return [p.path(`M${f(x - w * 0.3)} ${f(y - h)}L${f(x + w * 0.3)} ${f(y - h)}Q${f(x + w * 0.55)} ${f(y - h)} ${f(x + w * 0.5)} ${f(y)}Q${f(x + w * 0.3)} ${f(y)} ${f(x + w * 0.2)} ${f(y - h * 0.3)}L${f(x - w * 0.2)} ${f(y - h * 0.3)}Q${f(x - w * 0.3)} ${f(y)} ${f(x - w * 0.5)} ${f(y)}Q${f(x - w * 0.55)} ${f(y - h)} ${f(x - w * 0.3)} ${f(y - h)}Z`, pal.ink, {}),
      p.circle(x + w * 0.25, y - h * 0.7, w * 0.04, pal.accent, {stroke: false}), p.circle(x + w * 0.33, y - h * 0.55, w * 0.04, pal.primary, {stroke: false}),
      p.rect(x - w * 0.32, y - h * 0.68, w * 0.14, w * 0.04, pal.metalLight, {stroke: false}), p.rect(x - w * 0.27, y - h * 0.82, w * 0.04, w * 0.14, pal.metalLight, {stroke: false})];
  }),
  flowers: P('vase of flowers', SURFACE, 0.4, 0.2, (k, x, y, s) => {
    const {p, pal} = k;
    const out = [shadowUnder(k, x, y, 0.14, s)];
    for (const [dx, h, c] of [[-0.06, 0.34, pal.accent], [0, 0.4, pal.primary], [0.06, 0.32, pal.g('#f27aa0')], [-0.02, 0.28, pal.white]]) {
      out.push(p.line(x, y - 0.12 * s, x + dx * s, y - h * s, pal.foliageShade, 2.5));
      for (let i = 0; i < 5; i++) out.push(p.circle(x + dx * s + Math.cos(i * 1.256) * 0.018 * s, y - h * s + Math.sin(i * 1.256) * 0.018 * s, 0.014 * s, c, {stroke: false}));
      out.push(p.circle(x + dx * s, y - h * s, 0.01 * s, pal.g('#f8d040'), {stroke: false}));
    }
    out.push(p.path(`M${f(x - 0.04 * s)} ${f(y - 0.16 * s)}L${f(x + 0.04 * s)} ${f(y - 0.16 * s)}Q${f(x + 0.08 * s)} ${f(y - 0.06 * s)} ${f(x + 0.05 * s)} ${f(y)}L${f(x - 0.05 * s)} ${f(y)}Q${f(x - 0.08 * s)} ${f(y - 0.06 * s)} ${f(x - 0.04 * s)} ${f(y - 0.16 * s)}Z`, mixColor('#ffffff', pal.glass, 0.3), {}));
    return out;
  }),
  clipboard: P('clipboard', SURFACE, 0.3, 0.22, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.22 * s, h = 0.3 * s;
    const out = [p.rect(x - w / 2, y - h, w, h, pal.woodLight, {rx: 4 * k.u, transform: `rotate(-6 ${f(x)} ${f(y)})`}), p.rect(x - w * 0.42, y - h * 0.9, w * 0.84, h * 0.84, pal.white, {stroke: false, transform: `rotate(-6 ${f(x)} ${f(y)})`})];
    for (let i = 0; i < 4; i++) out.push(p.rect(x - w * 0.32, y - h * (0.72 - i * 0.16), w * (i === 3 ? 0.3 : 0.6), h * 0.04, i === 0 ? pal.primary : pal.metalShade, {stroke: false, transform: `rotate(-6 ${f(x)} ${f(y)})`}));
    out.push(p.rect(x - w * 0.2, y - h * 1.02, w * 0.4, h * 0.08, pal.metalShade, {rx: 3 * k.u, transform: `rotate(-6 ${f(x)} ${f(y)})`}));
    return out;
  }),
  envelope: P('envelope', SURFACE, 0.12, 0.22, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.22 * s, h = 0.13 * s;
    return [p.rect(x - w / 2, y - h, w, h, pal.cream, {}), p.stroke(`M${f(x - w / 2)} ${f(y - h)}L${f(x)} ${f(y - h * 0.4)}L${f(x + w / 2)} ${f(y - h)}`, pal.ink, 2), p.circle(x, y - h * 0.4, 0.015 * s, pal.g('#d8343a'), {stroke: false})];
  }),
  'desk-lamp': P('desk lamp', SURFACE, 0.42, 0.3, (k, x, y, s) => deskLamp(k, x, y, {size: 0.42 * s / k.u, dir: 1, color: k.pal.accent})),

  // -- Floor and ground ----------------------------------------------------
  plant: P('potted plant', FLOOR, 1.1, 0.6, (k, x, y, s) => pottedPlant(k, x, y, 0.5 * s, {kind: 'tall'})),
  'leafy-plant': P('leafy plant', FLOOR, 0.9, 0.7, (k, x, y, s) => pottedPlant(k, x, y, 0.62 * s, {kind: 'leafy'})),
  tree: P('tree', ['ground', 'floor'], 4, 2.4, (k, x, y, s) => tree(k, x, y, 4 * s, {kind: 'round'})),
  'pine-tree': P('pine tree', ['ground', 'floor'], 4.5, 2, (k, x, y, s) => tree(k, x, y, 4.5 * s, {kind: 'pine'})),
  'palm-tree': P('palm tree', ['ground', 'floor'], 5, 3, (k, x, y, s) => tree(k, x, y, 5 * s, {kind: 'palm'})),
  bush: P('bush', GROUND, 0.9, 1.4, (k, x, y, s) => tree(k, x, y, 1.1 * s, {kind: 'bush'})),
  'lamp-post': P('street lamp', GROUND, 3.6, 1, (k, x, y, s) => lampPost(k, x, y, 3.6 * s)),
  bench: P('bench', GROUND, 0.9, 1.6, (k, x, y, s) => bench(k, x - 0.8 * s, y, 1.6 * s)),
  bike: P('bike', GROUND, 1, 1.7, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.33 * s, bx = x - 0.5 * s, fx = x + 0.5 * s, cy = y - r;
    const frame = pal.primary;
    const out = [shadowUnder(k, x, y, 1.7, s)];
    for (const wx of [bx, fx]) {
      out.push(p.circle(wx, cy, r, 'none', {stroke: pal.ink, sw: Math.max(3, 0.03 * s / k.u)}));
      if (k.d.n >= 1) for (let i = 0; i < 6; i++) out.push(p.line(wx, cy, wx + Math.cos(i * 1.047) * r, cy + Math.sin(i * 1.047) * r, pal.metalShade, 1.2));
    }
    const seat = [x - 0.12 * s, y - 0.86 * s], bar = [x + 0.38 * s, y - 0.92 * s], crank = [x, cy];
    out.push(p.stroke(`M${f(bx)} ${f(cy)}L${f(crank[0])} ${f(crank[1])}L${f(seat[0])} ${f(seat[1] + 0.06 * s)}L${f(bx)} ${f(cy)}M${f(seat[0])} ${f(seat[1] + 0.06 * s)}L${f(bar[0] - 0.04 * s)} ${f(bar[1] + 0.1 * s)}L${f(crank[0])} ${f(crank[1])}M${f(bar[0] - 0.04 * s)} ${f(bar[1] + 0.1 * s)}L${f(fx)} ${f(cy)}`, frame, Math.max(4, 0.035 * s / k.u)));
    out.push(p.rect(seat[0] - 0.1 * s, seat[1], 0.2 * s, 0.04 * s, pal.ink, {rx: 0.02 * s}));
    out.push(p.stroke(`M${f(bar[0] - 0.04 * s)} ${f(bar[1] + 0.1 * s)}L${f(bar[0])} ${f(bar[1])}L${f(bar[0] - 0.12 * s)} ${f(bar[1] - 0.02 * s)}`, pal.ink, Math.max(3, 0.03 * s / k.u)));
    out.push(p.circle(crank[0], crank[1], 0.05 * s, pal.metalShade, {}));
    return out;
  }),
  car: P('car', GROUND, 1.4, 4, (k, x, y, s) => car(k, x - 2 * s, y, 4 * s, {color: k.pal.accent, facing: -1})),
  scooter: P('kick scooter', GROUND, 1, 0.9, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.9, s), p.rect(x - 0.4 * s, y - 0.12 * s, 0.7 * s, 0.05 * s, pal.ink, {rx: 0.02 * s}), p.line(x + 0.32 * s, y - 0.1 * s, x + 0.38 * s, y - 0.95 * s, pal.accent, Math.max(4, 0.04 * s / k.u)),
      p.line(x + 0.28 * s, y - 0.95 * s, x + 0.5 * s, y - 0.95 * s, pal.ink, Math.max(4, 0.04 * s / k.u)), p.circle(x - 0.36 * s, y - 0.08 * s, 0.08 * s, pal.black, {}), p.circle(x + 0.34 * s, y - 0.08 * s, 0.08 * s, pal.black, {})];
  }),
  rocket: P('rocket', ['ground', 'floor', 'surface'], 2.4, 1, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.5 * s, h = 2 * s, base = y - 0.25 * s;
    const out = [p.glow(x, y, 0.8 * s, '#ffb040', 0.6)];
    out.push(p.path(`M${f(x - w * 0.3)} ${f(base)}Q${f(x)} ${f(y + 0.3 * s)} ${f(x + w * 0.3)} ${f(base)}Z`, '#ffb040', {glow: true}));
    out.push(p.path(`M${f(x - w * 0.18)} ${f(base)}Q${f(x)} ${f(y + 0.05 * s)} ${f(x + w * 0.18)} ${f(base)}Z`, '#fff1b0', {glow: true, stroke: false}));
    for (const sgn of [-1, 1]) out.push(p.path(pts([[x + sgn * w * 0.5, base - h * 0.3], [x + sgn * w * 0.95, base + 0.02 * s], [x + sgn * w * 0.45, base]]), pal.accent, {}));
    out.push(p.path(`M${f(x - w / 2)} ${f(base)}L${f(x - w / 2)} ${f(base - h * 0.6)}Q${f(x - w / 2)} ${f(base - h * 0.9)} ${f(x)} ${f(base - h)}Q${f(x + w / 2)} ${f(base - h * 0.9)} ${f(x + w / 2)} ${f(base - h * 0.6)}L${f(x + w / 2)} ${f(base)}Z`, pal.white, {}));
    out.push(p.path(`M${f(x - w * 0.42)} ${f(base - h * 0.78)}Q${f(x)} ${f(base - h * 0.86)} ${f(x + w * 0.42)} ${f(base - h * 0.78)}Q${f(x + w * 0.3)} ${f(base - h * 0.95)} ${f(x)} ${f(base - h)}Q${f(x - w * 0.3)} ${f(base - h * 0.95)} ${f(x - w * 0.42)} ${f(base - h * 0.78)}Z`, pal.primary, {stroke: false}));
    out.push(p.circle(x, base - h * 0.55, w * 0.2, pal.accent, {}), p.circle(x, base - h * 0.55, w * 0.12, lit(k) ? '#9fd0ff' : '#cfe6ff', {stroke: false, glow: lit(k)}));
    out.push(p.rect(x - w * 0.12, base - h * 0.12, w * 0.24, h * 0.12, pal.accent, {stroke: false}));
    out.push(p.shade(x - w / 2, base - h, w, h, 'right', 0.25));
    return out;
  }),
  'chart-easel': P('chart easel', GROUND, 1.8, 1, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.8 * s, h = 0.7 * s, top = y - 1.75 * s;
    const out = [shadowUnder(k, x, y, 1, s), p.line(x - 0.36 * s, y, x - 0.1 * s, top, pal.woodShade, Math.max(4, 0.03 * s / k.u)), p.line(x + 0.36 * s, y, x + 0.1 * s, top, pal.woodShade, Math.max(4, 0.03 * s / k.u)), p.line(x, y - 0.1 * s, x, top + h, pal.woodShade, Math.max(3, 0.025 * s / k.u))];
    out.push(p.rect(x - w / 2, top, w, h, pal.white, {}));
    const bars = [0.3, 0.5, 0.42, 0.72, 0.9];
    bars.forEach((v, i) => out.push(p.rect(x - w * 0.38 + i * w * 0.16, top + h * 0.9 - v * h * 0.7, w * 0.1, v * h * 0.7, i === bars.length - 1 ? pal.accent : pal.primary, {stroke: false})));
    out.push(p.stroke(`M${f(x - w * 0.35)} ${f(top + h * 0.7)}L${f(x - w * 0.1)} ${f(top + h * 0.5)}L${f(x + w * 0.1)} ${f(top + h * 0.56)}L${f(x + w * 0.36)} ${f(top + h * 0.16)}`, pal.ink, 3));
    out.push(p.rect(x - w * 0.55, top + h, w * 1.1, 0.04 * s, pal.woodShade, {}));
    return out;
  }),
  whiteboard: P('whiteboard', WALL, 1.2, 1.8, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const w = 1.8 * s, h = 1.1 * s;
    const onWall = anchor === 'wall';
    const top = onWall ? y - h / 2 : y - 1.9 * s;
    const out = [];
    if (!onWall) out.push(shadowUnder(k, x, y, 1.6, s), p.line(x - w * 0.42, y, x - w * 0.42, top + h, pal.metalShade, 5), p.line(x + w * 0.42, y, x + w * 0.42, top + h, pal.metalShade, 5), p.line(x - w * 0.5, y, x - w * 0.34, y, pal.metalShade, 5), p.line(x + w * 0.34, y, x + w * 0.5, y, pal.metalShade, 5));
    out.push(p.rect(x - w / 2, top, w, h, pal.metalLight, {rx: 4 * k.u}), p.rect(x - w / 2 + 0.03 * s, top + 0.03 * s, w - 0.06 * s, h - 0.06 * s, pal.white, {stroke: false}));
    out.push(p.stroke(`M${f(x - w * 0.36)} ${f(top + h * 0.3)}h${f(w * 0.3)}M${f(x - w * 0.36)} ${f(top + h * 0.45)}h${f(w * 0.2)}`, pal.primary, 4, {opacity: 0.7}));
    out.push(p.rect(x + w * 0.05, top + h * 0.2, w * 0.14, h * 0.18, pal.g('#ffe27a'), {stroke: false}), p.rect(x + w * 0.22, top + h * 0.3, w * 0.14, h * 0.18, pal.accentLight, {stroke: false}));
    out.push(p.stroke(`M${f(x - w * 0.3)} ${f(top + h * 0.78)}L${f(x - w * 0.1)} ${f(top + h * 0.62)}L${f(x + w * 0.1)} ${f(top + h * 0.7)}L${f(x + w * 0.3)} ${f(top + h * 0.56)}`, pal.accent, 3, {opacity: 0.8}));
    out.push(p.rect(x - w * 0.3, top + h, w * 0.6, 0.04 * s, pal.metalShade, {}));
    return out;
  }),
  box: P('cardboard box', GROUND, 0.5, 0.6, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.6 * s, h = 0.45 * s, c = pal.g('#c79a62');
    return [shadowUnder(k, x, y, 0.6, s), p.rect(x - w / 2, y - h, w, h, c, {}), p.rect(x - w * 0.1, y - h, w * 0.2, h * 0.4, mixColor('#ffffff', c, 0.3), {stroke: false, opacity: 0.7}),
      p.poly([[x - w / 2, y - h], [x - w * 0.6, y - h * 1.18], [x - w * 0.05, y - h * 1.18], [x, y - h]], mixColor('#000000', c, 0.1), {}),
      p.poly([[x + w / 2, y - h], [x + w * 0.6, y - h * 1.18], [x + w * 0.05, y - h * 1.18], [x, y - h]], mixColor('#ffffff', c, 0.08), {}), p.shade(x - w / 2, y - h, w, h, 'right', 0.25)];
  }),
  boxes: P('stack of boxes', GROUND, 1.1, 0.9, (k, x, y, s) => [...DEFS.box.draw(k, x - 0.18 * s, y, s), ...DEFS.box.draw(k, x + 0.3 * s, y, s * 0.8).slice(1), ...DEFS.box.draw(k, x + 0.04 * s, y - 0.53 * s, s * 0.85).slice(1)]),
  'trash-can': P('bin', GROUND, 0.9, 0.5, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.48 * s, h = 0.82 * s;
    return [shadowUnder(k, x, y, 0.5, s), p.path(pts([[x - w * 0.44, y], [x + w * 0.44, y], [x + w / 2, y - h], [x - w / 2, y - h]]), pal.metalShade, {}),
      ...[-0.25, 0, 0.25].map(dx => p.line(x + dx * w, y - h * 0.1, x + dx * w * 1.1, y - h * 0.9, mixColor('#000000', pal.metalShade, 0.2), 2)),
      p.rect(x - w * 0.56, y - h - 0.06 * s, w * 1.12, 0.07 * s, pal.metal, {rx: 3 * k.u})];
  }),
  'fire-hydrant': P('fire hydrant', GROUND, 0.75, 0.45, (k, x, y, s) => {
    const {p, pal} = k;
    const red = pal.g('#d8343a'), w = 0.28 * s;
    return [shadowUnder(k, x, y, 0.4, s), p.rect(x - w * 0.7, y - 0.06 * s, w * 1.4, 0.06 * s, mixColor('#000000', red, 0.2), {}),
      p.rect(x - w / 2, y - 0.6 * s, w, 0.54 * s, red, {}), p.path(`M${f(x - w * 0.55)} ${f(y - 0.6 * s)}Q${f(x)} ${f(y - 0.82 * s)} ${f(x + w * 0.55)} ${f(y - 0.6 * s)}Z`, red, {}),
      p.rect(x - w * 0.9, y - 0.42 * s, w * 1.8, 0.1 * s, mixColor('#000000', red, 0.1), {rx: 0.04 * s}), p.shade(x - w / 2, y - 0.6 * s, w, 0.54 * s, 'right', 0.3)];
  }),
  'traffic-cone': P('traffic cone', GROUND, 0.7, 0.4, (k, x, y, s) => {
    const {p, pal} = k;
    const o = pal.g('#ff7a1a');
    return [shadowUnder(k, x, y, 0.4, s), p.rect(x - 0.2 * s, y - 0.05 * s, 0.4 * s, 0.05 * s, o, {}), p.poly([[x - 0.15 * s, y - 0.05 * s], [x + 0.15 * s, y - 0.05 * s], [x + 0.03 * s, y - 0.7 * s], [x - 0.03 * s, y - 0.7 * s]], o, {}),
      p.poly([[x - 0.11 * s, y - 0.25 * s], [x + 0.11 * s, y - 0.25 * s], [x + 0.08 * s, y - 0.37 * s], [x - 0.08 * s, y - 0.37 * s]], pal.white, {stroke: false})];
  }),
  mailbox: P('post box', GROUND, 1.3, 0.5, (k, x, y, s) => {
    const {p, pal} = k;
    const c = pal.g('#d8343a'), w = 0.46 * s, h = 1.2 * s;
    return [shadowUnder(k, x, y, 0.5, s), p.path(`M${f(x - w / 2)} ${f(y)}L${f(x - w / 2)} ${f(y - h + w / 2)}A${f(w / 2)} ${f(w / 2)} 0 0 1 ${f(x + w / 2)} ${f(y - h + w / 2)}L${f(x + w / 2)} ${f(y)}Z`, c, {}),
      p.rect(x - w * 0.3, y - h * 0.66, w * 0.6, 0.04 * s, pal.ink, {stroke: false}), p.rect(x - w * 0.56, y - h * 0.86, w * 1.12, 0.05 * s, mixColor('#000000', c, 0.2), {}), p.shade(x - w / 2, y - h, w, h, 'right', 0.3)];
  }),
  suitcase: P('suitcase', FLOOR, 0.75, 0.45, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.42 * s, h = 0.62 * s;
    return [shadowUnder(k, x, y, 0.45, s), p.stroke(`M${f(x - w * 0.2)} ${f(y - h)}L${f(x - w * 0.2)} ${f(y - h - 0.12 * s)}L${f(x + w * 0.2)} ${f(y - h - 0.12 * s)}L${f(x + w * 0.2)} ${f(y - h)}`, pal.metalShade, 4),
      p.rect(x - w / 2, y - h - 0.03 * s, w, h, pal.accent, {rx: 0.05 * s}), ...[-0.25, 0, 0.25].map(dx => p.line(x + dx * w, y - h + 0.02 * s, x + dx * w, y - 0.06 * s, pal.accentShade, 2.5)),
      p.circle(x - w * 0.35, y - 0.02 * s, 0.03 * s, pal.black, {}), p.circle(x + w * 0.35, y - 0.02 * s, 0.03 * s, pal.black, {})];
  }),
  backpack: P('backpack', FLOOR, 0.5, 0.36, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.34 * s, h = 0.48 * s;
    return [shadowUnder(k, x, y, 0.36, s), p.rect(x - w / 2, y - h, w, h, pal.primary, {rx: w * 0.3}), p.rect(x - w * 0.36, y - h * 0.48, w * 0.72, h * 0.4, pal.primaryShade, {rx: w * 0.14}),
      p.path(`M${f(x - w * 0.24)} ${f(y - h)}Q${f(x)} ${f(y - h * 1.18)} ${f(x + w * 0.24)} ${f(y - h)}`, null, {stroke: pal.ink, sw: 3})];
  }),
  briefcase: P('briefcase', FLOOR, 0.4, 0.46, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.46 * s, h = 0.32 * s;
    return [shadowUnder(k, x, y, 0.46, s), p.stroke(`M${f(x - w * 0.16)} ${f(y - h)}L${f(x - w * 0.16)} ${f(y - h - 0.06 * s)}L${f(x + w * 0.16)} ${f(y - h - 0.06 * s)}L${f(x + w * 0.16)} ${f(y - h)}`, pal.woodShade, 5),
      p.rect(x - w / 2, y - h, w, h, pal.woodShade, {rx: 0.03 * s}), p.rect(x - w / 2, y - h * 0.62, w, 0.02 * s, mixColor('#000000', pal.woodShade, 0.25), {stroke: false}), p.rect(x - 0.03 * s, y - h * 0.7, 0.06 * s, 0.05 * s, pal.g('#e8c070'), {stroke: false})];
  }),
  stool: P('stool', FLOOR, 0.75, 0.45, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.45, s), p.line(x - 0.16 * s, y, x - 0.1 * s, y - 0.7 * s, pal.metalShade, 4), p.line(x + 0.16 * s, y, x + 0.1 * s, y - 0.7 * s, pal.metalShade, 4),
      p.line(x - 0.14 * s, y - 0.25 * s, x + 0.14 * s, y - 0.25 * s, pal.metalShade, 3), p.ellipse(x, y - 0.72 * s, 0.2 * s, 0.05 * s, pal.wood, {})];
  }),
  'office-chair': P('office chair', FLOOR, 1.1, 0.7, (k, x, y, s) => {
    // The furniture chair is drawn in canvas units; scale it to this anchor.
    const z = s / (290 * k.u);
    return [k.p.g(chair(k, x, y - 140 * k.u, y, {color: k.pal.primaryShade}), {transform: `translate(${f(x * (1 - z))} ${f(y * (1 - z))}) scale(${Math.round(z * 1000) / 1000})`})];
  }),
  'floor-lamp': P('floor lamp', FLOOR, 1.6, 0.5, (k, x, y, s) => {
    const {p, pal} = k;
    const on = lit(k), top = y - 1.6 * s;
    return [shadowUnder(k, x, y, 0.4, s), p.ellipse(x, y - 0.02 * s, 0.16 * s, 0.03 * s, pal.ink, {}), p.line(x, y, x, top + 0.2 * s, pal.ink, 4),
      on ? p.glow(x, top + 0.12 * s, 0.9 * s, pal.lampWarm, 0.5) : null, on ? p.pool(x, y, 0.8 * s, 0.1 * s, pal.lamp, 0.4) : null,
      p.path(pts([[x - 0.18 * s, top + 0.28 * s], [x + 0.18 * s, top + 0.28 * s], [x + 0.12 * s, top], [x - 0.12 * s, top]]), on ? '#ffe7b8' : pal.cream, {glow: on})];
  }),
  guitar: P('guitar', FLOOR, 1, 0.4, (k, x, y, s) => {
    const {p, pal} = k;
    const c = pal.g('#c9783a');
    return [shadowUnder(k, x, y, 0.4, s), p.rect(x - 0.025 * s, y - 1 * s, 0.05 * s, 0.6 * s, pal.woodShade, {}), p.rect(x - 0.04 * s, y - 1.06 * s, 0.08 * s, 0.1 * s, pal.ink, {rx: 3 * k.u}),
      p.circle(x, y - 0.18 * s, 0.17 * s, c, {}), p.circle(x, y - 0.4 * s, 0.12 * s, c, {}), p.circle(x, y - 0.3 * s, 0.05 * s, pal.ink, {stroke: false}), p.rect(x - 0.07 * s, y - 0.14 * s, 0.14 * s, 0.03 * s, pal.ink, {stroke: false})];
  }),
  ladder: P('ladder', GROUND, 2, 0.6, (k, x, y, s) => {
    const {p, pal} = k;
    const out = [p.line(x - 0.25 * s, y, x - 0.15 * s, y - 2 * s, pal.metal, 6), p.line(x + 0.25 * s, y, x + 0.15 * s, y - 2 * s, pal.metal, 6)];
    for (let i = 1; i < 7; i++) out.push(p.line(x - 0.25 * s + 0.1 * s * i / 7, y - i * 0.28 * s, x + 0.25 * s - 0.1 * s * i / 7, y - i * 0.28 * s, pal.metalShade, 4));
    return out;
  }),
  telescope: P('telescope', GROUND, 1.5, 1, (k, x, y, s) => {
    const {p, pal} = k;
    const hx = x, hy = y - 1.1 * s;
    return [shadowUnder(k, x, y, 0.8, s), p.line(hx, hy, x - 0.4 * s, y, pal.ink, 4), p.line(hx, hy, x + 0.4 * s, y, pal.ink, 4), p.line(hx, hy, x + 0.05 * s, y, pal.ink, 4),
      p.rect(hx - 0.6 * s, hy - 0.1 * s, 1.1 * s, 0.16 * s, pal.white, {rx: 0.05 * s, transform: `rotate(-24 ${f(hx)} ${f(hy)})`}), p.rect(hx + 0.3 * s, hy - 0.12 * s, 0.24 * s, 0.2 * s, pal.primary, {rx: 0.04 * s, transform: `rotate(-24 ${f(hx)} ${f(hy)})`})];
  }),
  tent: P('tent', GROUND, 1.5, 2.4, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 2.4 * s, h = 1.4 * s;
    return [shadowUnder(k, x, y, 2.4, s), p.poly([[x - w / 2, y], [x + w / 2, y], [x, y - h]], pal.accent, {}), p.poly([[x, y - h], [x + w / 2, y], [x + w * 0.1, y]], pal.accentShade, {stroke: false}),
      p.poly([[x - w * 0.12, y], [x + w * 0.12, y], [x, y - h * 0.6]], lit(k) ? '#ffd890' : pal.ink, {glow: lit(k)}), lit(k) ? p.glow(x, y - h * 0.2, w * 0.4, pal.lampWarm, 0.4) : null];
  }),
  campfire: P('campfire', GROUND, 0.6, 0.8, (k, x, y, s) => {
    const {p, pal} = k;
    return [p.glow(x, y - 0.2 * s, 1.6 * s, '#ff9a40', lit(k) ? 0.6 : 0.3), p.pool(x, y, 1.2 * s, 0.14 * s, '#ffb060', 0.5),
      p.line(x - 0.35 * s, y, x + 0.3 * s, y - 0.12 * s, pal.trunk, Math.max(5, 0.08 * s / k.u)), p.line(x + 0.35 * s, y, x - 0.3 * s, y - 0.12 * s, pal.trunk, Math.max(5, 0.08 * s / k.u)),
      p.path(`M${f(x - 0.22 * s)} ${f(y - 0.08 * s)}Q${f(x - 0.25 * s)} ${f(y - 0.4 * s)} ${f(x)} ${f(y - 0.6 * s)}Q${f(x + 0.05 * s)} ${f(y - 0.35 * s)} ${f(x + 0.15 * s)} ${f(y - 0.4 * s)}Q${f(x + 0.25 * s)} ${f(y - 0.2 * s)} ${f(x + 0.22 * s)} ${f(y - 0.08 * s)}Z`, '#ff8a2a', {glow: true}),
      p.path(`M${f(x - 0.1 * s)} ${f(y - 0.08 * s)}Q${f(x - 0.12 * s)} ${f(y - 0.25 * s)} ${f(x)} ${f(y - 0.36 * s)}Q${f(x + 0.12 * s)} ${f(y - 0.22 * s)} ${f(x + 0.1 * s)} ${f(y - 0.08 * s)}Z`, '#ffe07a', {glow: true, stroke: false})];
  }),
  signpost: P('signpost', GROUND, 2, 1, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.4, s), p.rect(x - 0.04 * s, y - 2 * s, 0.08 * s, 2 * s, pal.woodShade, {}),
      p.poly([[x - 0.05 * s, y - 1.85 * s], [x + 0.6 * s, y - 1.85 * s], [x + 0.75 * s, y - 1.72 * s], [x + 0.6 * s, y - 1.6 * s], [x - 0.05 * s, y - 1.6 * s]], pal.primary, {}),
      p.poly([[x + 0.05 * s, y - 1.5 * s], [x - 0.6 * s, y - 1.5 * s], [x - 0.75 * s, y - 1.37 * s], [x - 0.6 * s, y - 1.24 * s], [x + 0.05 * s, y - 1.24 * s]], pal.accent, {})];
  }),
  flag: P('flag', GROUND, 2.4, 0.9, (k, x, y, s) => {
    const {p, pal} = k;
    return [p.line(x, y, x, y - 2.4 * s, pal.metalLight, 4), p.path(`M${f(x)} ${f(y - 2.36 * s)}Q${f(x + 0.4 * s)} ${f(y - 2.5 * s)} ${f(x + 0.8 * s)} ${f(y - 2.3 * s)}L${f(x + 0.8 * s)} ${f(y - 1.86 * s)}Q${f(x + 0.4 * s)} ${f(y - 2.04 * s)} ${f(x)} ${f(y - 1.9 * s)}Z`, pal.primary, {})];
  }),
  umbrella: P('beach umbrella', GROUND, 2.2, 2, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 1 * s, cy = y - 2.1 * s;
    const out = [shadowUnder(k, x, y, 1.6, s), p.line(x, y, x, cy, pal.white, 4)];
    for (let i = 0; i < 6; i++) {
      const a0 = Math.PI + i * Math.PI / 6, a1 = a0 + Math.PI / 6;
      out.push(p.path(`M${f(x)} ${f(cy - r * 0.2)}L${f(x + Math.cos(a0) * r)} ${f(cy + Math.sin(a0) * r * 0.4 + r * 0.2)}L${f(x + Math.cos(a1) * r)} ${f(cy + Math.sin(a1) * r * 0.4 + r * 0.2)}Z`, i % 2 ? pal.white : pal.accent, {}));
    }
    return out;
  }),
  'server-rack': P('server rack', FLOOR, 2, 0.7, (k, x, y, s) => {
    const {p, pal} = k;
    const w = 0.7 * s, h = 2 * s;
    const out = [shadowUnder(k, x, y, 0.8, s), p.rect(x - w / 2, y - h, w, h, pal.g('#20252f'), {rx: 4 * k.u})];
    for (let i = 0; i < 14; i++) {
      out.push(p.rect(x - w * 0.42, y - h + 0.06 * s + i * 0.135 * s, w * 0.84, 0.1 * s, pal.g('#2e3440'), {stroke: false}));
      out.push(p.circle(x + w * 0.32, y - h + 0.11 * s + i * 0.135 * s, 0.012 * s, i % 3 ? '#58f08c' : pal.neonB, {glow: true, stroke: false}));
    }
    return out;
  }),
  robot: P('robot', FLOOR, 1.2, 0.7, (k, x, y, s) => {
    const {p, pal} = k;
    const out = [shadowUnder(k, x, y, 0.7, s)];
    out.push(p.rect(x - 0.18 * s, y - 0.3 * s, 0.1 * s, 0.3 * s, pal.metalShade, {}), p.rect(x + 0.08 * s, y - 0.3 * s, 0.1 * s, 0.3 * s, pal.metalShade, {}));
    out.push(p.rect(x - 0.3 * s, y - 0.8 * s, 0.6 * s, 0.52 * s, pal.white, {rx: 0.08 * s}));
    out.push(p.circle(x, y - 0.56 * s, 0.08 * s, pal.accent, {glow: lit(k)}));
    out.push(p.rect(x - 0.24 * s, y - 1.14 * s, 0.48 * s, 0.32 * s, pal.white, {rx: 0.1 * s}));
    out.push(p.rect(x - 0.18 * s, y - 1.08 * s, 0.36 * s, 0.18 * s, pal.screenDark, {rx: 0.06 * s}));
    out.push(p.circle(x - 0.08 * s, y - 0.99 * s, 0.035 * s, pal.neonB, {glow: true, stroke: false}), p.circle(x + 0.08 * s, y - 0.99 * s, 0.035 * s, pal.neonB, {glow: true, stroke: false}));
    out.push(p.line(x, y - 1.14 * s, x, y - 1.24 * s, pal.metalShade, 3), p.circle(x, y - 1.26 * s, 0.03 * s, pal.primary, {glow: true}));
    out.push(p.line(x - 0.3 * s, y - 0.7 * s, x - 0.42 * s, y - 0.45 * s, pal.metalShade, 6), p.line(x + 0.3 * s, y - 0.7 * s, x + 0.46 * s, y - 0.9 * s, pal.metalShade, 6));
    return out;
  }),
  dumbbell: P('dumbbell', ['floor', 'ground', 'surface'], 0.16, 0.4, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.4, s), p.rect(x - 0.16 * s, y - 0.09 * s, 0.32 * s, 0.03 * s, pal.metalShade, {}),
      p.rect(x - 0.2 * s, y - 0.16 * s, 0.07 * s, 0.16 * s, pal.black, {rx: 0.015 * s}), p.rect(x + 0.13 * s, y - 0.16 * s, 0.07 * s, 0.16 * s, pal.black, {rx: 0.015 * s})];
  }),
  kettlebell: P('kettlebell', FLOOR, 0.3, 0.26, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.3, s), p.path(`M${f(x - 0.08 * s)} ${f(y - 0.18 * s)}Q${f(x)} ${f(y - 0.36 * s)} ${f(x + 0.08 * s)} ${f(y - 0.18 * s)}`, null, {stroke: pal.ink, sw: Math.max(3, 0.025 * s / k.u)}), p.circle(x, y - 0.11 * s, 0.12 * s, pal.ink, {})];
  }),
  ball: P('ball', ['ground', 'floor'], 0.22, 0.22, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.11 * s;
    return [shadowUnder(k, x, y, 0.22, s), p.circle(x, y - r, r, pal.white, {}), p.circle(x, y - r, r * 0.35, pal.ink, {stroke: false}),
      ...[0, 1, 2, 3, 4].map(i => p.circle(x + Math.cos(i * 1.256 - 1.57) * r * 0.78, y - r + Math.sin(i * 1.256 - 1.57) * r * 0.78, r * 0.18, pal.ink, {stroke: false}))];
  }),
  skateboard: P('skateboard', ['ground', 'floor'], 0.12, 0.8, (k, x, y, s) => {
    const {p, pal} = k;
    return [shadowUnder(k, x, y, 0.8, s), p.rect(x - 0.4 * s, y - 0.11 * s, 0.8 * s, 0.035 * s, pal.accent, {rx: 0.02 * s}), p.circle(x - 0.26 * s, y - 0.035 * s, 0.035 * s, pal.white, {}), p.circle(x + 0.26 * s, y - 0.035 * s, 0.035 * s, pal.white, {})];
  }),

  // -- Wall ----------------------------------------------------------------
  clock: P('wall clock', WALL, 0.35, 0.35, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const r = 0.16 * s, cy = anchor === 'wall' ? y : y - 1.6 * s;
    return [p.circle(x, cy, r, pal.white, {stroke: pal.ink, sw: 2}), p.line(x, cy, x, cy - r * 0.62, pal.ink, 3), p.line(x, cy, x + r * 0.45, cy + r * 0.1, pal.ink, 3), p.circle(x, cy, 3 * k.u, pal.accent, {stroke: false})];
  }),
  'framed-art': P('framed picture', WALL, 0.6, 0.5, (k, x, y, s, anchor) => frameArt(k, x - 0.25 * s, (anchor === 'wall' ? y : y - 1.6 * s) - 0.3 * s, 0.5 * s, 0.6 * s, {})),
  poster: P('poster', WALL, 0.8, 0.56, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const w = 0.56 * s, h = 0.8 * s, top = (anchor === 'wall' ? y : y - 1.6 * s) - h / 2;
    return [k.d.shadows ? p.rect(x - w / 2 + 5 * k.u, top + 6 * k.u, w, h, pal.shadow, {opacity: pal.shadowAlpha, stroke: false}) : null, p.rect(x - w / 2, top, w, h, pal.primary, {}),
      p.circle(x, top + h * 0.38, w * 0.26, pal.accent, {stroke: false}), p.rect(x - w * 0.36, top + h * 0.74, w * 0.72, h * 0.05, pal.paper, {stroke: false}), p.rect(x - w * 0.36, top + h * 0.83, w * 0.46, h * 0.04, pal.paper, {stroke: false, opacity: 0.7})];
  }),
  'wall-shelf': P('wall shelf', WALL, 0.4, 1, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const sy = anchor === 'wall' ? y : y - 1.4 * s;
    const out = [];
    let bx = x - 0.48 * s;
    for (const [w, h, c] of [[0.06, 0.26, pal.primary], [0.05, 0.22, pal.accent], [0.07, 0.28, pal.cream], [0.05, 0.2, pal.primaryShade]]) { out.push(p.rect(bx, sy - h * s, w * s, h * s, c, {rx: 2 * k.u})); bx += w * s + 2 * k.u; }
    out.push(...pottedPlant(k, x + 0.32 * s, sy, 0.2 * s, {kind: 'trail'}));
    out.push(p.rect(x - 0.5 * s, sy, s, 0.04 * s, pal.woodLight, {}));
    return out;
  }),
  'neon-sign': P('neon sign', WALL, 0.5, 0.9, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const cy = anchor === 'wall' ? y : y - 1.8 * s;
    const on = true;
    const d1 = `M${f(x - 0.4 * s)} ${f(cy)}Q${f(x - 0.2 * s)} ${f(cy - 0.25 * s)} ${f(x)} ${f(cy)}T${f(x + 0.4 * s)} ${f(cy)}`;
    return [on ? p.glow(x, cy, 0.8 * s, pal.neonA, k.time === 'day' ? 0.15 : 0.4) : null, p.stroke(d1, pal.neonA, 14, {glow: true, opacity: 0.25}), p.stroke(d1, mixColor('#ffffff', pal.neonA, 0.4), 5, {glow: true}),
      p.circle(x, cy - 0.16 * s, 0.07 * s, 'none', {stroke: pal.neonB, sw: 3, glow: true})];
  }),
  calendar: P('calendar', WALL, 0.45, 0.35, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const w = 0.34 * s, h = 0.42 * s, top = (anchor === 'wall' ? y : y - 1.5 * s) - h / 2;
    const out = [p.rect(x - w / 2, top, w, h, pal.white, {}), p.rect(x - w / 2, top, w, h * 0.22, pal.accent, {stroke: false})];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) out.push(p.rect(x - w * 0.42 + c * w * 0.17, top + h * 0.3 + r * h * 0.16, w * 0.12, h * 0.1, r === 2 && c === 3 ? pal.primary : pal.metalLight, {stroke: false}));
    return out;
  }),
  tv: P('wall TV', WALL, 0.7, 1.2, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const w = 1.2 * s, h = 0.68 * s, top = (anchor === 'wall' ? y : y - 1.4 * s) - h / 2;
    return [p.rect(x - w / 2, top, w, h, pal.black, {rx: 4 * k.u}), p.rect(x - w / 2 + 0.03 * s, top + 0.03 * s, w - 0.06 * s, h - 0.06 * s, p.lin([[0, pal.primary], [1, pal.accent]], x - w / 2, top, x + w / 2, top + h), {stroke: false, glow: lit(k), opacity: lit(k) ? 1 : 0.85}),
      lit(k) ? p.glow(x, top + h / 2, w * 0.9, pal.neonA, 0.25) : null, p.sheen(x - w / 2, top, w, h * 0.3, 0.12)];
  }),
  'wall-chart': P('chart poster', WALL, 0.7, 0.9, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const w = 0.9 * s, h = 0.66 * s, top = (anchor === 'wall' ? y : y - 1.5 * s) - h / 2;
    const out = [p.rect(x - w / 2, top, w, h, pal.white, {})];
    [0.3, 0.45, 0.4, 0.62, 0.8].forEach((v, i) => out.push(p.rect(x - w * 0.4 + i * w * 0.17, top + h * 0.9 - v * h * 0.75, w * 0.11, v * h * 0.75, i === 4 ? pal.accent : pal.primary, {stroke: false})));
    out.push(p.line(x - w * 0.44, top + h * 0.9, x + w * 0.44, top + h * 0.9, pal.ink, 2));
    return out;
  }),
  map: P('wall map', WALL, 0.7, 1, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const w = 1 * s, h = 0.64 * s, top = (anchor === 'wall' ? y : y - 1.5 * s) - h / 2;
    return [p.rect(x - w / 2, top, w, h, pal.g('#bfe0f0'), {}),
      p.path(`M${f(x - w * 0.4)} ${f(top + h * 0.3)}Q${f(x - w * 0.25)} ${f(top + h * 0.1)} ${f(x - w * 0.1)} ${f(top + h * 0.3)}Q${f(x - w * 0.15)} ${f(top + h * 0.7)} ${f(x - w * 0.3)} ${f(top + h * 0.8)}Q${f(x - w * 0.45)} ${f(top + h * 0.6)} ${f(x - w * 0.4)} ${f(top + h * 0.3)}Z`, pal.g('#9fcf8a'), {stroke: false}),
      p.path(`M${f(x + w * 0.05)} ${f(top + h * 0.2)}Q${f(x + w * 0.3)} ${f(top + h * 0.05)} ${f(x + w * 0.42)} ${f(top + h * 0.3)}Q${f(x + w * 0.35)} ${f(top + h * 0.55)} ${f(x + w * 0.15)} ${f(top + h * 0.5)}Q${f(x)} ${f(top + h * 0.4)} ${f(x + w * 0.05)} ${f(top + h * 0.2)}Z`, pal.g('#9fcf8a'), {stroke: false}),
      p.circle(x + w * 0.2, top + h * 0.32, 0.03 * s, pal.g('#d8343a'), {stroke: false}), p.stroke(`M${f(x - w * 0.25)} ${f(top + h * 0.45)}Q${f(x)} ${f(top + h * 0.2)} ${f(x + w * 0.2)} ${f(top + h * 0.32)}`, pal.ink, 2, {opacity: 0.6})];
  }),
  dartboard: P('dartboard', WALL, 0.45, 0.45, (k, x, y, s, anchor) => {
    const {p, pal} = k;
    const cy = anchor === 'wall' ? y : y - 1.6 * s, r = 0.2 * s;
    return [p.circle(x, cy, r, pal.ink, {}), p.circle(x, cy, r * 0.8, pal.g('#d8343a'), {stroke: false}), p.circle(x, cy, r * 0.6, pal.cream, {stroke: false}), p.circle(x, cy, r * 0.4, pal.g('#3a8a4a'), {stroke: false}), p.circle(x, cy, r * 0.15, pal.g('#d8343a'), {stroke: false}),
      p.line(x + r * 0.1, cy - r * 0.05, x + r * 0.6, cy - r * 0.4, pal.metalShade, 2)];
  }),

  // -- Sky -----------------------------------------------------------------
  balloons: P('balloons', SKY, 1.6, 0.8, (k, x, y, s) => {
    const {p, pal} = k;
    const out = [];
    for (const [dx, dy, c] of [[-0.22, -1.3, pal.primary], [0.18, -1.45, pal.accent], [0, -1.15, pal.g('#f27aa0')]]) {
      out.push(p.stroke(`M${f(x)} ${f(y)}Q${f(x + dx * s * 0.5)} ${f(y + dy * s * 0.5)} ${f(x + dx * s)} ${f(y + dy * s + 0.2 * s)}`, pal.ink, 1.5));
      out.push(p.ellipse(x + dx * s, y + dy * s, 0.16 * s, 0.2 * s, c, {}), p.ellipse(x + dx * s - 0.05 * s, y + dy * s - 0.07 * s, 0.03 * s, 0.05 * s, '#ffffff', {opacity: 0.5, stroke: false}));
    }
    return out;
  }),
  kite: P('kite', SKY, 1.2, 0.8, (k, x, y, s) => {
    const {p, pal} = k;
    const cy = y - 1.2 * s;
    return [p.stroke(`M${f(x)} ${f(cy + 0.4 * s)}Q${f(x - 0.3 * s)} ${f(cy + 0.8 * s)} ${f(x + 0.1 * s)} ${f(cy + 1.2 * s)}`, pal.ink, 1.5),
      p.poly([[x, cy - 0.4 * s], [x + 0.3 * s, cy], [x, cy + 0.4 * s], [x - 0.3 * s, cy]], pal.accent, {}), p.poly([[x, cy - 0.4 * s], [x + 0.3 * s, cy], [x, cy]], pal.primary, {stroke: false}), p.poly([[x, cy], [x - 0.3 * s, cy], [x, cy + 0.4 * s]], pal.primary, {stroke: false})];
  }),
  drone: P('drone', SKY, 0.3, 0.8, (k, x, y, s) => {
    const {p, pal} = k;
    const cy = y - 0.15 * s;
    const out = [p.rect(x - 0.12 * s, cy - 0.05 * s, 0.24 * s, 0.1 * s, pal.ink, {rx: 0.03 * s}), p.line(x - 0.36 * s, cy - 0.08 * s, x + 0.36 * s, cy - 0.08 * s, pal.ink, 4)];
    for (const dx of [-0.36, 0.36]) out.push(p.ellipse(x + dx * s, cy - 0.11 * s, 0.14 * s, 0.02 * s, pal.metalShade, {opacity: 0.8}));
    out.push(p.circle(x, cy + 0.06 * s, 0.03 * s, pal.neonB, {glow: true, stroke: false}));
    return out;
  }),
  'hot-air-balloon': P('hot-air balloon', SKY, 3, 2, (k, x, y, s) => {
    const {p, pal} = k;
    const r = 0.9 * s, cy = y - 2.2 * s;
    const out = [p.circle(x, cy, r, pal.primary, {})];
    for (const t of [-0.5, 0, 0.5]) out.push(p.ellipse(x + t * r, cy, r * 0.18, r * 0.98, pal.accent, {stroke: false, opacity: t === 0 ? 1 : 0.9}));
    out.push(p.line(x - r * 0.4, cy + r * 0.86, x - 0.15 * s, y - 0.3 * s, pal.ink, 2), p.line(x + r * 0.4, cy + r * 0.86, x + 0.15 * s, y - 0.3 * s, pal.ink, 2));
    out.push(p.rect(x - 0.2 * s, y - 0.32 * s, 0.4 * s, 0.32 * s, pal.woodShade, {rx: 0.04 * s}));
    return out;
  })
};

export const PROPS = Object.freeze(DEFS);
export const PROP_IDS = Object.freeze(Object.keys(DEFS));
export const PROP_KEYS = Object.freeze(['id', 'at', 'on', 'scale', 'layer', 'flip']);
export const PROP_ANCHORS = Object.freeze(['surface', 'counter', 'ground', 'floor', 'wall', 'sky', 'road', 'far', 'parapet']);
export const PROP_LAYERS = Object.freeze(['back', 'mid', 'front']);
const AT = {left: 0.12, centre: 0.5, center: 0.5, right: 0.88};
// Free slots, edges inward: the centre band stays open for characters and text.
const SLOTS = [0.12, 0.88, 0.24, 0.76, 0.34, 0.66, 0.06, 0.94, 0.42, 0.58, 0.5];

/** A placement entry → {id, at, on, scale, layer, flip} (throws on unknown values). */
export function propEntry(entry, path = 'props') {
  const given = typeof entry === 'string' ? {id: entry} : entry;
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error(`${path} must be a prop id or {id, at?, on?, scale?, layer?, flip?}`);
  // null means unset (a normalised entry passes through unchanged).
  const raw = Object.fromEntries(Object.entries(given).filter(([, value]) => value !== null));
  for (const key of Object.keys(raw)) if (!PROP_KEYS.includes(key)) throw new Error(`${path}.${key} is not a prop field (${PROP_KEYS.join(', ')})`);
  if (!PROPS[raw.id]) throw new Error(`${path}.id ${JSON.stringify(raw.id)} is not a prop (props: ${PROP_IDS.join(', ')})`);
  if (raw.at !== undefined && !(raw.at in AT) && !(typeof raw.at === 'number' && raw.at >= 0 && raw.at <= 1)) throw new Error(`${path}.at must be left, centre, right or a share of the width from 0 to 1`);
  if (raw.on !== undefined && !PROP_ANCHORS.includes(raw.on)) throw new Error(`${path}.on must be one of ${PROP_ANCHORS.join(', ')}`);
  if (raw.scale !== undefined && !(typeof raw.scale === 'number' && raw.scale >= 0.25 && raw.scale <= 4)) throw new Error(`${path}.scale must be a number from 0.25 to 4`);
  if (raw.layer !== undefined && !PROP_LAYERS.includes(raw.layer)) throw new Error(`${path}.layer must be one of ${PROP_LAYERS.join(', ')}`);
  if (raw.flip !== undefined && typeof raw.flip !== 'boolean') throw new Error(`${path}.flip must be true or false`);
  return {id: raw.id, at: raw.at ?? null, on: raw.on ?? null, scale: raw.scale ?? 1, layer: raw.layer ?? null, flip: raw.flip === true};
}

const DEFAULT_LAYER = {surface: 'front', counter: 'mid', ground: 'mid', floor: 'mid', wall: 'back', sky: 'back', road: 'front', far: 'mid', parapet: 'front'};

/**
 * Place props on a world's anchors. → [{id, anchor, x, y, scale, layer,
 * rect, nodes}] in draw order. Unknown anchors fall back along the prop's
 * preference list, then to the ground.
 */
export function placeProps(k, anchors, entries = []) {
  const used = {};
  const out = [];
  entries.forEach((entry, i) => {
    const e = propEntry(entry, `props[${i}]`);
    const def = PROPS[e.id];
    const anchorName = (e.on && anchors[e.on] ? e.on : null) ?? def.on.find(name => anchors[name]) ?? 'ground';
    const a = anchors[anchorName] ?? anchors.ground;
    const s = a.ppm * e.scale;
    const w = def.w * s;
    let x;
    if (e.at !== null) x = (typeof e.at === 'number' ? e.at : AT[e.at]) * k.W;
    else {
      const taken = used[anchorName] ??= [];
      const fits = fx => {
        const cx = fx * k.W;
        return cx - w / 2 >= a.x0 - w * 0.25 && cx + w / 2 <= a.x1 + w * 0.25 && taken.every(([l, r]) => cx + w / 2 <= l || cx - w / 2 >= r);
      };
      const slot = SLOTS.find(fits) ?? SLOTS[taken.length % SLOTS.length];
      x = slot * k.W;
    }
    x = Math.round(x * 10) / 10;
    (used[anchorName] ??= []).push([x - w / 2, x + w / 2]);
    const y = a.y;
    const layer = e.layer ?? a.layer ?? DEFAULT_LAYER[anchorName] ?? 'mid';
    k.p.at(layer);
    let nodes = def.draw(k, x, y, s, anchorName).flat(Infinity).filter(Boolean);
    if (e.flip) nodes = [k.p.g(nodes, {transform: `translate(${f(2 * x)} 0) scale(-1 1)`})];
    const h = def.h * s;
    const top = anchorName === 'wall' ? y - h / 2 : y - h;
    out.push({id: e.id, anchor: anchorName, x, y, scale: Math.round(s * 1000) / 1000, layer, rect: {x: Math.round(x - w / 2), y: Math.round(top), width: Math.round(w), height: Math.round(h)}, nodes});
  });
  return out;
}
