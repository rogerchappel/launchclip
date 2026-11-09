// A tiny anti-aliased painter for synthetic rgb24 frames, so tests of the
// drawing-traits measurements (src/drawing_traits.js) need no image files.
//
//   const f = canvas(960, 540, [240, 236, 228]);
//   disc(f, 300, 270, 120, [230, 90, 60], { outline: 4, ink: [28, 24, 32] });
//   box(f, 520, 150, 300, 220, [60, 120, 220], { radius: 24 });

export function canvas(width, height, color = [255, 255, 255]) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) { data[i * 3] = color[0]; data[i * 3 + 1] = color[1]; data[i * 3 + 2] = color[2]; }
  return { at: null, width, height, data };
}

const cover = (distance) => Math.max(0, Math.min(1, 0.5 - distance));

/** Paint where `inside(x, y)` (a signed distance, negative inside) says so; color may be a function of (x, y). */
export function paint(frame, [x0, y0, x1, y1], inside, color) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(frame.height, Math.ceil(y1)); y += 1) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(frame.width, Math.ceil(x1)); x += 1) {
    const a = cover(inside(x + 0.5, y + 0.5));
    if (a <= 0) continue;
    const rgb = typeof color === "function" ? color(x, y) : color;
    const i = (y * frame.width + x) * 3;
    for (let c = 0; c < 3; c += 1) frame.data[i + c] = Math.round(frame.data[i + c] * (1 - a) + rgb[c] * a);
  }
  return frame;
}

const discDistance = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const boxDistance = (x0, y0, w, h, radius) => (x, y) => {
  const dx = Math.abs(x - (x0 + w / 2)) - (w / 2 - radius), dy = Math.abs(y - (y0 + h / 2)) - (h / 2 - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
};

function shape(frame, bounds, distance, color, { outline = 0, ink = [28, 24, 32] } = {}) {
  const grown = [bounds[0] - outline - 1, bounds[1] - outline - 1, bounds[2] + outline + 1, bounds[3] + outline + 1];
  if (color) paint(frame, grown, distance, color);
  if (outline) paint(frame, grown, (x, y) => Math.abs(distance(x, y)) - outline / 2, ink);
  return frame;
}

/** A disc; color null draws only its outline. options: {outline (px), ink}. */
export const disc = (frame, cx, cy, r, color, options) => shape(frame, [cx - r, cy - r, cx + r, cy + r], discDistance(cx, cy, r), color, options);

/** A box; options: {radius (corner), outline (px), ink}. */
export const box = (frame, x, y, w, h, color, { radius = 0, ...options } = {}) => shape(frame, [x, y, x + w, y + h], boxDistance(x, y, w, h, radius), color, options);

/** Noise of `amount` luma levels over the frame (or a region [x0, y0, x1, y1]), the same for a seed. */
export function noise(frame, amount, { seed = 1, region = [0, 0, frame.width, frame.height] } = {}) {
  let a = seed >>> 0;
  const random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let y = region[1]; y < region[3]; y += 1) for (let x = region[0]; x < region[2]; x += 1) {
    const n = (random() + random() + random() - 1.5) * 2 * amount;
    const i = (y * frame.width + x) * 3;
    for (let c = 0; c < 3; c += 1) frame.data[i + c] = Math.max(0, Math.min(255, Math.round(frame.data[i + c] + n)));
  }
  return frame;
}

/** A scene of discs and rounded boxes in a few colours: the same layout for every option set. */
export function scene({ outline = 0, radius = 28, discs = true, fill = true, bg = [240, 236, 228], ink = [28, 24, 32], colors = [[230, 90, 60], [60, 120, 220], [250, 200, 60], [70, 170, 120]], width = 960, height = 540 } = {}) {
  const frame = canvas(width, height, bg);
  const tint = (i) => (fill ? (typeof fill === "function" ? fill(colors[i % colors.length], i) : colors[i % colors.length]) : null);
  const options = { outline, ink };
  if (discs) { disc(frame, 170, 150, 95, tint(0), options); disc(frame, 800, 400, 110, tint(1), options); disc(frame, 480, 420, 70, tint(2), options); }
  else { box(frame, 75, 55, 190, 190, tint(0), options); box(frame, 690, 290, 220, 220, tint(1), options); box(frame, 410, 350, 140, 140, tint(2), options); }
  box(frame, 330, 60, 300, 200, tint(3), { ...options, radius });
  box(frame, 90, 330, 220, 150, tint(1), { ...options, radius });
  box(frame, 700, 70, 190, 150, tint(0), { ...options, radius });
  return frame;
}
