// Silhouettes for the VFX layer's (m) effects (docs/VFX_LAYER_RFC.md §1,
// phase 8), the light half: scan-filling frame-pixel shapes into the actor
// upstream's effects read through o.actor ({mask: {w, h, data}, pixels, x,
// y, w, h, k, head, chest}, feet at 0, 0), a module's card, the stand-in the
// sheets and tests draw round, and the plan's JSON form of an actor. No
// imports, so the HyperFrames runtime bundles it as it is; kit/core/vfx/mask.mjs
// draws cast members into it.
const HEX6 = /^#[0-9a-fA-F]{6}$/;
// the painter's colour word: 0xAABBGGRR (vendor core/color.js hex)
const packed = hex => (0xff000000 | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;

// Even-odd scan fill of one polygon at pixel centres.
function fillPolygon(poly, w, h, plot) {
  const ys = poly.map(p => p[1]), y0 = Math.max(0, Math.ceil(Math.min(...ys) - 0.5)), y1 = Math.min(h - 1, Math.floor(Math.max(...ys) - 0.5));
  for (let y = y0; y <= y1; y += 1) {
    const cy = y + 0.5, xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xa, ya] = poly[i], [xb, yb] = poly[j];
      if ((ya > cy) !== (yb > cy)) xs.push(xa + ((cy - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x += 1) plot(x, y);
  }
}

// A polyline r pixels thick.
function strokeLine(points, r, w, h, plot) {
  for (let i = 1; i < points.length; i += 1) {
    const [xa, ya] = points[i - 1], [xb, yb] = points[i], dx = xb - xa, dy = yb - ya, L = dx * dx + dy * dy || 1;
    for (let y = Math.max(0, Math.floor(Math.min(ya, yb) - r)); y <= Math.min(h - 1, Math.ceil(Math.max(ya, yb) + r)); y += 1)
      for (let x = Math.max(0, Math.floor(Math.min(xa, xb) - r)); x <= Math.min(w - 1, Math.ceil(Math.max(xa, xb) + r)); x += 1) {
        const k = Math.max(0, Math.min(1, ((x + 0.5 - xa) * dx + (y + 0.5 - ya) * dy) / L)), ex = x + 0.5 - xa - k * dx, ey = y + 0.5 - ya - k * dy;
        if (ex * ex + ey * ey <= r * r) plot(x, y);
      }
  }
}

/**
 * The actor upstream's effects expect, from frame-pixel polygons: [{points
 * (frame px), closed, fill, paint (the colour for a non-hex fill), stroke,
 * width (frame px)}] in paint order, the
 * feet at (fx, fy) in frame px, on a grid of `grid` px per art pixel, cut at
 * frame y `cut`. → {w, h, x, y, k, head, chest, mask: {w, h, data: Uint8Array}, pixels:
 * Uint32Array, at: [art x, art y] of the feet} or null when nothing is drawn.
 */
export function silhouette(shapes, {fx, fy, grid, cut = Infinity}) {
  const all = shapes.flatMap(shape => shape.points);
  if (!all.length) return null;
  const left = Math.floor(Math.min(...all.map(p => p[0])) / grid) - 1, top = Math.floor(Math.min(...all.map(p => p[1])) / grid) - 1;
  const w = Math.ceil(Math.max(...all.map(p => p[0])) / grid) + 1 - left, h = Math.ceil(Math.min(cut, Math.max(...all.map(p => p[1]))) / grid) + 1 - top;
  if (!(w > 0 && h > 0)) return null;
  const mask = new Uint8Array(w * h), pixels = new Uint32Array(w * h);
  for (const shape of shapes) {
    const pts = shape.points.map(([x, y]) => [x / grid - left, y / grid - top]);
    const colour = packed([shape.fill, shape.paint, shape.stroke].find(c => HEX6.test(c ?? '')) ?? '#000000');
    const plot = (x, y) => { mask[y * w + x] = 1; pixels[y * w + x] = colour; };
    if (shape.fill !== 'none' && shape.closed !== false && pts.length > 2) fillPolygon(pts, w, h, plot);
    if (shape.stroke && shape.stroke !== 'none' && shape.width / grid >= 0.5) {
      const strokeColour = packed(HEX6.test(shape.stroke) ? shape.stroke : '#000000');
      strokeLine(shape.closed ? [...pts, pts[0]] : pts, shape.width / grid / 2, w, h, (x, y) => { mask[y * w + x] = 1; pixels[y * w + x] = strokeColour; });
    }
  }
  const ax = Math.round(fx / grid), ay = Math.round(fy / grid);
  let headX = 0, headY = h;
  for (let y = 0; y < h && headY === h; y += 1) for (let x = 0; x < w; x += 1) if (mask[y * w + x]) { headX = x; headY = y; break; }
  const x = left - ax, y = top - ay;
  return {w, h, x, y, k: 2, head: [x + headX, y + headY], chest: [x + Math.round(w / 2), y + Math.round(h * 0.3)], mask: {w, h, data: mask}, pixels, at: [ax, ay]};
}

/** A module's silhouette: its card rect in the panel colour, feet at the card's bottom centre. */
export function moduleSilhouette(rect, grid, colour) {
  const {x, y, width, height} = rect;
  return silhouette([{closed: true, fill: colour, points: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]}], {fx: x + width / 2, fy: y + height, grid});
}

const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** A silhouette as plain JSON for the plan: its pixels as base64 (the mask is where a pixel is set: every silhouette pixel is opaque). */
export function vfxActorWire(sil) {
  const {mask, pixels, at, ...rest} = sil;
  return {...rest, pixels: toBase64(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength))};
}

/** The plan's JSON actor back as the o.actor upstream's effects read. */
export function vfxActorFromWire(wire) {
  const bytes = fromBase64(wire.pixels), pixels = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  return {...wire, mask: {w: wire.w, h: wire.h, data: Uint8Array.from(pixels, c => (c ? 1 : 0))}, pixels};
}

let standIn = null;
/** The stand-in silhouette (a head over a body, about upstream's 24 × 38 stock figure), for sheets, peaks and tests: one object, so effects cache its shape once. */
export function vfxStandIn() {
  const ring = (cx, cy, r) => Array.from({length: 16}, (_, i) => [cx + r * Math.cos((i * Math.PI) / 8), cy + r * Math.sin((i * Math.PI) / 8)]);
  standIn ??= silhouette([
    {closed: true, fill: '#5e6a8a', points: [[-9, -26], [9, -26], [8, 0], [-8, 0]]},
    {closed: true, fill: '#f0c8a0', points: ring(0, -32, 6.5)}
  ], {fx: 0, fy: 0, grid: 1});
  return standIn;
}
