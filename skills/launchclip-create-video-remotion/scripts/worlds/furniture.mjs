// Furniture and fittings the inside worlds share: desks, monitors, chairs,
// shelves, cabinets, pendant and desk lamps, plants in pots, framed art,
// curtains and rugs. Each takes the world kit and a position, and draws at
// the kit's detail level. Sizes are canvas px (multiply by k.u).

import {mixColor} from '../catalog-b-base.mjs';
import {f, pts} from './pen.mjs';

/** A desk seen from the front: top at y, legs to floorY. */
export function desk(k, x, y, w, floorY, {color = null, legs = 'metal', drawer = false, depth = 22} = {}) {
  const {p, pal, u} = k;
  const top = color ?? pal.wood;
  const leg = legs === 'metal' ? pal.metalShade : mixColor('#000000', top, 0.2);
  const t = depth * u;
  const out = [p.shadow(x + w / 2, floorY, w * 0.55, 16 * u)];
  for (const lx of [x + 18 * u, x + w - 30 * u]) out.push(p.rect(lx, y + t, 12 * u, floorY - y - t, leg, {}));
  if (drawer) {
    out.push(p.rect(x + w - w * 0.3 - 10 * u, y + t, w * 0.3, (floorY - y - t) * 0.8, mixColor('#000000', top, 0.08), {rx: 4 * u}));
    for (let i = 0; i < 3; i++) out.push(p.rect(x + w - w * 0.15 - 30 * u, y + t + (i + 0.5) * (floorY - y - t) * 0.8 / 3 - 3 * u, 40 * u, 6 * u, pal.metalLight, {rx: 3 * u, stroke: false}));
  }
  out.push(p.rect(x, y, w, t, top, {rx: 4 * u}));
  out.push(p.rect(x, y + t * 0.7, w, t * 0.3, mixColor('#000000', top, 0.18), {stroke: false}));
  out.push(p.sheen(x, y, w, t * 0.5, 0.3));
  return out;
}

/** A monitor on a stand, its screen bottom at y (on a desk top). */
export function monitor(k, cx, y, w, {on = null, content = true} = {}) {
  const {p, pal, u, time} = k;
  const h = w * 0.6;
  const lit = on ?? true;
  const sy = y - h - 30 * u;
  const out = [
    p.rect(cx - w * 0.16, y - 6 * u, w * 0.32, 6 * u, pal.metalShade, {rx: 3 * u}),
    p.rect(cx - 7 * u, y - 32 * u, 14 * u, 28 * u, pal.metalShade, {}),
    p.rect(cx - w / 2, sy, w, h, pal.black, {rx: 8 * u})
  ];
  const inner = [cx - w / 2 + 8 * u, sy + 8 * u, w - 16 * u, h - 16 * u];
  out.push(p.rect(...inner, lit ? (time === 'night' ? '#2a3f6e' : '#cfe0f5') : pal.screenDark, {rx: 4 * u, glow: lit && time === 'night', stroke: false}));
  if (lit && content) {
    const [ix, iy, iw, ih] = inner;
    out.push(p.rect(ix, iy, iw, ih * 0.12, pal.primary, {stroke: false, glow: time === 'night'}));
    for (let i = 0; i < 3; i++) out.push(p.rect(ix + iw * 0.08, iy + ih * (0.25 + i * 0.18), iw * (0.5 - i * 0.1), ih * 0.07, time === 'night' ? '#9fb8e8' : '#8ea6c4', {rx: 2 * u, stroke: false, glow: time === 'night'}));
    out.push(p.rect(ix + iw * 0.64, iy + ih * 0.25, iw * 0.28, ih * 0.5, pal.accent, {rx: 3 * u, stroke: false, opacity: 0.85, glow: time === 'night'}));
    if (time === 'night') out.push(p.glow(cx, sy + h / 2, w * 1.1, '#8fb4ff', 0.22));
  }
  return out;
}

/** An office chair seen from behind or front, seat at y. */
export function chair(k, cx, y, floorY, {color = null, back = true} = {}) {
  const {p, pal, u} = k;
  const c = color ?? mixColor('#000000', pal.fabric, 0.1);
  const out = [p.shadow(cx, floorY, 60 * u, 10 * u)];
  out.push(p.rect(cx - 5 * u, y, 10 * u, floorY - y - 18 * u, pal.metalShade, {}));
  out.push(p.stroke(`M${f(cx - 50 * u)} ${f(floorY - 6 * u)}L${f(cx)} ${f(floorY - 20 * u)}L${f(cx + 50 * u)} ${f(floorY - 6 * u)}`, pal.metalShade, 7));
  for (const s of [-50, 0, 50]) out.push(p.circle(cx + s * u, floorY - 5 * u, 6 * u, pal.black, {}));
  if (back) out.push(p.rect(cx - 46 * u, y - 120 * u, 92 * u, 112 * u, c, {rx: 24 * u}));
  out.push(p.rect(cx - 56 * u, y - 14 * u, 112 * u, 24 * u, mixColor('#000000', c, 0.1), {rx: 12 * u}));
  return out;
}

/** A wall shelf at y from x, w wide, with books and a small plant. */
export function shelf(k, x, y, w, {items = true, color = null} = {}) {
  const {p, pal, u, d} = k;
  const c = color ?? pal.woodLight;
  const out = [];
  if (items) {
    let bx = x + 14 * u;
    const colors = [pal.primary, pal.accent, pal.cream, pal.primaryShade, pal.fabric, pal.accentLight];
    while (bx < x + w * 0.62) {
      const bw = p.rnd(12, 24) * u, bh = p.rnd(54, 82) * u;
      const lean = p.rnd() < 0.12;
      out.push(p.rect(bx, y - bh, bw, bh, p.pick(colors), {rx: 2 * u, transform: lean ? `rotate(8 ${f(bx)} ${f(y)})` : undefined}));
      if (d.n >= 1) out.push(p.rect(bx + 2 * u, y - bh + 10 * u, bw - 4 * u, 4 * u, '#ffffff', {opacity: 0.35, stroke: false}));
      bx += bw + 2 * u;
    }
    out.push(...pottedPlant(k, x + w * 0.82, y, 60 * u, {kind: 'trail'}));
  }
  out.push(p.rect(x, y, w, 12 * u, c, {rx: 3 * u}));
  if (d.shadows) out.push(p.rect(x + 6 * u, y + 12 * u, w - 12 * u, 10 * u, pal.shadow, {opacity: pal.shadowAlpha, stroke: false}));
  return out;
}

/** A potted plant standing on y. kind: 'leafy' | 'tall' | 'trail' | 'cactus'. */
export function pottedPlant(k, cx, y, size, {kind = 'leafy', pot = null} = {}) {
  const {p, pal, u} = k;
  const potC = pot ?? mixColor(pal.accent, pal.cream, 0.25);
  const out = [p.shadow(cx, y, size * 0.5, size * 0.08)];
  const ph = size * 0.42, pw = size * 0.46;
  const leaves = [];
  if (kind === 'tall') {
    for (const [ang, len, c] of [[-100, 1.9, pal.foliage], [-70, 2.1, pal.foliageShade], [-120, 1.6, pal.foliageShade], [-85, 2.4, pal.foliageLight], [-55, 1.5, pal.foliage], [-135, 1.2, pal.foliage]]) {
      const a = ang * Math.PI / 180, ex = cx + Math.cos(a) * size * len * 0.5, ey = y - ph + Math.sin(a) * size * len * 0.55;
      const nx = -Math.sin(a) * size * 0.16, ny = Math.cos(a) * size * 0.16;
      leaves.push(p.path(`M${f(cx)} ${f(y - ph)}Q${f((cx + ex) / 2 + nx)} ${f((y - ph + ey) / 2 + ny)} ${f(ex)} ${f(ey)}Q${f((cx + ex) / 2 - nx)} ${f((y - ph + ey) / 2 - ny)} ${f(cx)} ${f(y - ph)}Z`, c, {}));
    }
  } else if (kind === 'cactus') {
    leaves.push(p.rect(cx - size * 0.1, y - ph - size * 0.7, size * 0.2, size * 0.72, pal.foliage, {rx: size * 0.1}));
    leaves.push(p.rect(cx + size * 0.08, y - ph - size * 0.45, size * 0.2, size * 0.1, pal.foliage, {rx: size * 0.05}));
    leaves.push(p.rect(cx + size * 0.2, y - ph - size * 0.62, size * 0.1, size * 0.26, pal.foliage, {rx: size * 0.05}));
  } else if (kind === 'trail') {
    for (const [dx, dy, r] of [[-0.2, -0.05, 0.22], [0.2, -0.08, 0.2], [0, -0.22, 0.24]]) leaves.push(p.circle(cx + dx * size, y - ph + dy * size, r * size, pal.foliage, {}));
    for (const s of [-1, 1]) leaves.push(p.stroke(`M${f(cx + s * pw * 0.4)} ${f(y - ph)}Q${f(cx + s * pw * 0.9)} ${f(y - ph * 0.2)} ${f(cx + s * pw * 0.7)} ${f(y + size * 0.3)}`, pal.foliageShade, 5));
  } else {
    for (const [dx, dy, r, c] of [[-0.24, -0.2, 0.24, pal.foliageShade], [0.24, -0.22, 0.23, pal.foliageShade], [0, -0.42, 0.28, pal.foliage], [-0.12, -0.6, 0.18, pal.foliageLight], [0.14, -0.56, 0.17, pal.foliage]]) leaves.push(p.circle(cx + dx * size, y - ph + dy * size, r * size, c, {}));
  }
  out.push(...leaves);
  out.push(p.path(pts([[cx - pw / 2, y - ph], [cx + pw / 2, y - ph], [cx + pw * 0.38, y], [cx - pw * 0.38, y]]), potC, {}));
  out.push(p.rect(cx - pw * 0.55, y - ph - 4 * u, pw * 1.1, ph * 0.22, mixColor('#000000', potC, 0.1), {rx: 3 * u}));
  out.push(p.shade(cx - pw / 2, y - ph, pw, ph, 'right', 0.25));
  return out;
}

/** A pendant lamp hanging from the ceiling to y; glows at dusk and night. */
export function pendant(k, cx, y, {size = 60, shade = null, cord = 0} = {}) {
  const {p, pal, u, time} = k;
  const on = time !== 'day';
  const c = shade ?? pal.ink;
  const s = size * u;
  const out = [p.line(cx, cord, cx, y, pal.ink, 2)];
  if (on) out.push(p.glow(cx, y + s * 0.5, s * 5, pal.lampWarm, time === 'night' ? 0.5 : 0.3));
  out.push(p.path(`M${f(cx - s * 0.18)} ${f(y)}L${f(cx + s * 0.18)} ${f(y)}L${f(cx + s * 0.6)} ${f(y + s * 0.5)}L${f(cx - s * 0.6)} ${f(y + s * 0.5)}Z`, c, {}));
  out.push(p.ellipse(cx, y + s * 0.5, s * 0.6, s * 0.1, on ? pal.lamp : mixColor('#ffffff', c, 0.4), {glow: on}));
  if (on && k.d.n >= 1) {
    const cone = p.lin([[0, pal.lamp, time === 'night' ? 0.22 : 0.12], [1, pal.lamp, 0]], cx, y, cx, y + s * 6, {force: true, glow: true});
    out.push(p.path(pts([[cx - s * 0.5, y + s * 0.5], [cx + s * 0.5, y + s * 0.5], [cx + s * 2.6, y + s * 6], [cx - s * 2.6, y + s * 6]]), cone, {glow: true, blend: 'screen'}));
  }
  return out;
}

/** A desk lamp standing on y, its head toward `dir` (1 right, -1 left). */
export function deskLamp(k, cx, y, {size = 90, dir = 1, color = null} = {}) {
  const {p, pal, u, time} = k;
  const on = time !== 'day';
  const c = color ?? pal.primary;
  const s = size * u / 90;
  const out = [p.ellipse(cx, y - 4 * s, 34 * s, 8 * s, c, {})];
  const ex = cx + dir * 36 * s, ey = y - 70 * s, hx = cx + dir * 70 * s, hy = y - 96 * s;
  out.push(p.stroke(`M${f(cx)} ${f(y - 6 * s)}L${f(ex)} ${f(ey)}L${f(hx)} ${f(hy)}`, c, 7 * s));
  if (on) {
    out.push(p.glow(hx + dir * 10 * s, hy + 24 * s, 160 * s, pal.lampWarm, time === 'night' ? 0.55 : 0.3));
    out.push(p.pool(hx + dir * 16 * s, y, 130 * s, 18 * s, pal.lamp, 0.5));
  }
  out.push(p.path(`M${f(hx - 26 * s)} ${f(hy - 12 * s)}L${f(hx + 26 * s)} ${f(hy - 12 * s)}L${f(hx + 34 * s)} ${f(hy + 16 * s)}L${f(hx - 34 * s)} ${f(hy + 16 * s)}Z`, c, {transform: `rotate(${dir * 18} ${f(hx)} ${f(hy)})`}));
  return out;
}

/** A framed picture on the wall: an abstract print in brand colours. */
export function frameArt(k, x, y, w, h, {kind = 'abstract'} = {}) {
  const {p, pal, u} = k;
  const out = [];
  if (k.d.shadows) out.push(p.rect(x + 6 * u, y + 8 * u, w, h, pal.shadow, {opacity: pal.shadowAlpha * 1.2, stroke: false, rx: 2 * u}));
  out.push(p.rect(x, y, w, h, pal.ink, {rx: 2 * u}));
  out.push(p.rect(x + 10 * u, y + 10 * u, w - 20 * u, h - 20 * u, pal.cream, {stroke: false}));
  const ix = x + 10 * u, iy = y + 10 * u, iw = w - 20 * u, ih = h - 20 * u;
  if (kind === 'landscape') {
    out.push(p.rect(ix, iy, iw, ih * 0.6, pal.accentLight, {stroke: false}));
    out.push(p.circle(ix + iw * 0.7, iy + ih * 0.3, ih * 0.12, pal.accent, {stroke: false}));
    out.push(p.poly([[ix, iy + ih], [ix + iw * 0.4, iy + ih * 0.42], [ix + iw * 0.7, iy + ih * 0.75], [ix + iw, iy + ih * 0.5], [ix + iw, iy + ih]], pal.primary, {stroke: false}));
  } else {
    out.push(p.circle(ix + iw * 0.38, iy + ih * 0.42, Math.min(iw, ih) * 0.24, pal.accent, {stroke: false}));
    out.push(p.rect(ix + iw * 0.48, iy + ih * 0.3, iw * 0.34, ih * 0.52, pal.primary, {stroke: false, opacity: 0.9}));
    out.push(p.line(ix + iw * 0.12, iy + ih * 0.84, ix + iw * 0.88, iy + ih * 0.84, pal.ink, 3));
  }
  return out;
}

/** Curtains either side of a window (x, y, w, h). */
export function curtains(k, x, y, w, h, {color = null} = {}) {
  const {p, pal, u} = k;
  const c = color ?? mixColor(pal.accent, pal.cream, 0.45);
  const out = [p.rect(x - 60 * u, y - 34 * u, w + 120 * u, 10 * u, pal.metalShade, {rx: 5 * u})];
  for (const [sx, dir] of [[x - 54 * u, 1], [x + w + 54 * u, -1]]) {
    const cw = Math.min(110 * u, w * 0.24);
    const ex = sx + dir * cw;
    out.push(p.path(`M${f(sx)} ${f(y - 28 * u)}L${f(ex)} ${f(y - 28 * u)}Q${f(ex - dir * cw * 0.3)} ${f(y + h * 0.5)} ${f(ex + dir * cw * 0.1)} ${f(y + h + 40 * u)}L${f(sx)} ${f(y + h + 40 * u)}Z`, c, {}));
    if (k.d.n >= 1) for (let i = 1; i < 4; i++) out.push(p.line(sx + dir * cw * i / 4, y - 20 * u, sx + dir * cw * i / 4 * 0.9, y + h + 36 * u, mixColor('#000000', c, 0.16), 3, {opacity: 0.7}));
  }
  return out;
}

/** A rug on the floor centred at (cx, cy). */
export function rug(k, cx, cy, w, h, {color = null} = {}) {
  const {p, pal, u} = k;
  const c = color ?? mixColor(pal.primary, pal.cream, 0.32);
  return [
    p.ellipse(cx, cy, w / 2, h / 2, c, {}),
    p.ellipse(cx, cy, w / 2 - 22 * u, h / 2 - 10 * u, 'none', {stroke: mixColor('#ffffff', c, 0.35), sw: 2})
  ];
}

/** Base cabinets with a counter top at y (kitchen, cafe). */
export function counter(k, x, y, w, floorY, {top = null, body = null, doors = 4, toe = true} = {}) {
  const {p, pal, u} = k;
  const tc = top ?? pal.cream, bc = body ?? pal.primary;
  const out = [p.rect(x, y + 20 * u, w, floorY - y - 20 * u, bc, {})];
  const dw = w / doors;
  for (let i = 0; i < doors; i++) {
    out.push(p.rect(x + i * dw + 10 * u, y + 36 * u, dw - 20 * u, floorY - y - 70 * u, mixColor('#ffffff', bc, 0.08), {rx: 6 * u}));
    out.push(p.rect(x + i * dw + dw / 2 - 18 * u, y + 52 * u, 36 * u, 6 * u, pal.metalLight, {rx: 3 * u, stroke: false}));
  }
  if (toe) out.push(p.rect(x, floorY - 18 * u, w, 18 * u, mixColor('#000000', bc, 0.3), {stroke: false}));
  out.push(p.shade(x, y + 20 * u, w, floorY - y - 20 * u, 'bottom', 0.3));
  out.push(p.rect(x - 10 * u, y, w + 20 * u, 22 * u, tc, {rx: 3 * u}));
  out.push(p.sheen(x - 10 * u, y, w + 20 * u, 8 * u, 0.4));
  return out;
}
