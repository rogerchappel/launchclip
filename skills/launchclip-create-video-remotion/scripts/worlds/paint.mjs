// Paint texture for early-cartoon worlds (detail palette 'early-cartoon',
// the rubber-hose style): the hand-painted surface of period cartoon
// scenery laid over the flat fills, drawn as plain shapes so both renderers
// draw it alike. Plaster walls take a soft stipple, weathering stains with
// drips, hairline cracks and a patch of brick courses where the plaster has
// fallen; floors a stipple and wear; streets cobblestones. Each piece has
// its own seed (the world kind, the canvas and where it sits), so a world
// draws the same every time and the rest of the world's randomness is
// untouched. Stipple dots are one path per tone, so the texture stays a
// handful of nodes.

import {mixColor} from '../catalog-b-base.mjs';
import {seededRandom, hashString} from '../ambient.mjs';
import {f} from './pen.mjs';

/** Is this world painted early-cartoon? */
export const painted = k => k.d.palette === 'early-cartoon';

const randFor = (k, salt) => {
  const rand = seededRandom(hashString(`${k.kind}|${k.W}x${k.H}|paint|${salt}`));
  return (a = 0, b = 1) => a + (b - a) * rand();
};

/** A soft stipple over a box: two tones of tiny dots, each one path. */
export function stipple(k, x0, y0, w, h, base, {density = 1, salt = ''} = {}) {
  const {p, u} = k;
  const r = randFor(k, `st${salt}|${f(x0)}|${f(y0)}`);
  const n = Math.round(Math.min(900, (w * h) / (2600 * u * u)) * density);
  const dots = (count, size) => {
    let d = '';
    for (let i = 0; i < count; i++) {
      const s = r(0.6, 1.4) * size * u, x = x0 + r() * w, y = y0 + r() * h;
      d += `M${f(x)} ${f(y)}h${f(s)}v${f(s)}h${f(-s)}Z`;
    }
    return d;
  };
  return [
    p.path(dots(n, 2.2), mixColor('#000000', base, 0.28), {stroke: false, opacity: 0.32}),
    p.path(dots(Math.round(n * 0.6), 2.6), mixColor('#ffffff', base, 0.3), {stroke: false, opacity: 0.35})
  ];
}

/** An irregular closed blob round (cx, cy). */
function blob(r, cx, cy, rx, ry, points = 11) {
  const out = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2, k = r(0.72, 1.12);
    out.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  // Smooth through the midpoints.
  let d = '';
  for (let i = 0; i < points; i++) {
    const [x1, y1] = out[i], [x2, y2] = out[(i + 1) % points];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    d += i ? `Q${f(x1)} ${f(y1)} ${f(mx)} ${f(my)}` : `M${f(mx)} ${f(my)}`;
  }
  const [x1, y1] = out[0], [x2, y2] = out[1];
  return `${d}Q${f(x1)} ${f(y1)} ${f((x1 + x2) / 2)} ${f((y1 + y2) / 2)}Z`;
}

/** Bricks in courses filling an ellipse round (cx, cy): fallen plaster. */
function brickPatch(k, r, cx, cy, rx, ry) {
  const {p, pal, u} = k;
  const bh = 14 * u, bw = 34 * u;
  const out = [p.path(blob(r, cx, cy, rx * 1.12, ry * 1.18), mixColor('#000000', pal.wall, 0.12), {stroke: false, opacity: 0.55})];
  for (let row = 0, y = cy - ry; y < cy + ry; y += bh, row++) {
    for (let x = cx - rx - (row % 2) * bw / 2; x < cx + rx; x += bw) {
      const mx = x + bw / 2, my = y + bh / 2;
      if (((mx - cx) / rx) ** 2 + ((my - cy) / ry) ** 2 > 0.8 + r(-0.15, 0.15)) continue;
      out.push(p.rect(x + 1.2 * u, y + 1.2 * u, bw - 2.4 * u, bh - 2.4 * u, mixColor('#000000', pal.brick, r(0, 0.14)), {stroke: mixColor('#000000', pal.brick, 0.45), sw: 0.45, rx: 2 * u}));
    }
  }
  return out;
}

/** Plaster: stipple, weathering stains with drips, cracks and one brick patch. */
export function paintWall(k, x0, y0, w, h, base, {salt = '', bricks = true} = {}) {
  const {p, u, pal} = k;
  const r = randFor(k, `wall${salt}|${f(x0)}|${f(y0)}|${f(w)}`);
  const out = [...stipple(k, x0, y0, w, h, base, {salt})];
  const stains = Math.max(2, Math.round(w / (700 * u)));
  for (let i = 0; i < stains; i++) {
    const cx = x0 + r(0.05, 0.95) * w, cy = y0 + r(0.15, 0.9) * h, rx = r(50, 120) * u, ry = r(30, 70) * u;
    out.push(p.path(blob(r, cx, cy, rx, ry), mixColor('#000000', base, 0.2), {stroke: false, opacity: 0.16}));
    // A drip running down from it.
    const dx = cx + r(-0.5, 0.5) * rx, len = r(60, 160) * u;
    out.push(p.path(`M${f(dx - 6 * u)} ${f(cy)}Q${f(dx - 4 * u)} ${f(cy + len * 0.6)} ${f(dx)} ${f(cy + len)}Q${f(dx + 4 * u)} ${f(cy + len * 0.6)} ${f(dx + 7 * u)} ${f(cy)}Z`, mixColor('#000000', base, 0.22), {stroke: false, opacity: 0.12}));
  }
  const cracks = Math.max(1, Math.round(w / (900 * u)));
  for (let i = 0; i < cracks; i++) {
    let x = x0 + r(0.05, 0.95) * w, y = y0 + r(0.05, 0.6) * h, d = `M${f(x)} ${f(y)}`;
    for (let s = 0; s < 5; s++) { x += r(-22, 22) * u; y += r(14, 30) * u; d += `L${f(x)} ${f(y)}`; }
    out.push(p.stroke(d, pal.ink, 1.3, {opacity: 0.45}));
  }
  if (bricks && h > 160 * u) out.push(...brickPatch(k, r, x0 + r(0.1, 0.9) * w, y0 + r(0.25, 0.7) * h, r(60, 110) * u, r(34, 56) * u));
  return out;
}

/** A floor or ground band: stipple and a few worn patches. */
export function paintFloor(k, x0, y0, w, h, base, {salt = ''} = {}) {
  const {p, u} = k;
  const r = randFor(k, `floor${salt}|${f(y0)}`);
  const out = [...stipple(k, x0, y0, w, h, base, {salt, density: 0.8})];
  for (let i = 0; i < 3; i++) out.push(p.path(blob(r, x0 + r(0.1, 0.9) * w, y0 + r(0.3, 0.8) * h, r(90, 200) * u, r(16, 40) * u), mixColor('#000000', base, 0.18), {stroke: false, opacity: 0.12}));
  return out;
}

/** Cobblestones from y0 to y1: rows of rounded stones that grow toward the viewer, one path per row. */
export function cobbles(k, x0, y0, w, y1, base, {salt = ''} = {}) {
  const {p, u} = k;
  const r = randFor(k, `cob${salt}|${f(y0)}`);
  const out = [...stipple(k, x0, y0, w, y1 - y0, base, {salt, density: 0.7})];
  for (let y = y0, rowH = 11 * u, row = 0; y < y1; y += rowH, rowH *= 1.16, row++) {
    let d = '';
    for (let x = x0 - r(0, rowH * 1.6); x < x0 + w; ) {
      const sw = rowH * r(1.3, 2.1), g = rowH * 0.14, rr = rowH * 0.35;
      const a = x + g, b = x + sw - g, t = y + g, bt = Math.min(y1, y + rowH) - g;
      d += `M${f(a + rr)} ${f(t)}L${f(b - rr)} ${f(t)}Q${f(b)} ${f(t)} ${f(b)} ${f(t + rr)}L${f(b)} ${f(bt - rr)}Q${f(b)} ${f(bt)} ${f(b - rr)} ${f(bt)}L${f(a + rr)} ${f(bt)}Q${f(a)} ${f(bt)} ${f(a)} ${f(bt - rr)}L${f(a)} ${f(t + rr)}Q${f(a)} ${f(t)} ${f(a + rr)} ${f(t)}Z`;
      x += sw;
    }
    out.push(p.path(d, row % 2 ? mixColor('#ffffff', base, 0.06) : mixColor('#000000', base, 0.04), {stroke: mixColor('#000000', base, 0.42), sw: 0.5, opacity: 0.85}));
  }
  return out;
}
