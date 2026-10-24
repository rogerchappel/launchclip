// The room without the presenter: a still "plate" built while a range is
// matted. Every frame adds the pixels the matte calls background; the plate
// is their average, and what the presenter covered in every frame is filled
// from the surrounding room by a push-pull pyramid. dolly-zoom scales this
// plate behind the cut-out, so the presenter's own outline never shows
// around the matte (docs/SUBJECT_EFFECTS_RFC.md §6.2).

// Plates are soft by nature; at most this short edge keeps them small.
export const PLATE_MAX_SHORT_EDGE = 1080;
// Alpha (0–255) below which a pixel counts as room; low, so the matte's soft
// edge (the presenter's colours, partly) stays out of the plate.
const ROOM_ALPHA = 8;

export function plateSize(width, height) {
  const scale = Math.min(1, PLATE_MAX_SHORT_EDGE / Math.min(width, height));
  return { width: Math.max(2, Math.round((width * scale) / 2) * 2), height: Math.max(2, Math.round((height * scale) / 2) * 2) };
}

/**
 * → {add(rgb, alpha, width, height), finish() → {rgb: Buffer, width, height, seen}}
 * frames arrive at the matte size; the plate is sampled down to plateSize.
 * seen: the share of plate pixels that were room in at least one frame.
 */
export function createPlateAccumulator(width, height) {
  const size = plateSize(width, height);
  const pixels = size.width * size.height;
  const sums = new Float32Array(pixels * 3);
  const counts = new Float32Array(pixels);
  const map = new Int32Array(pixels);
  for (let y = 0; y < size.height; y += 1) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size.height));
    for (let x = 0; x < size.width; x += 1) map[y * size.width + x] = sy * width + Math.min(width - 1, Math.floor(((x + 0.5) * width) / size.width));
  }
  return {
    size,
    add(rgb, alpha) {
      for (let i = 0; i < pixels; i += 1) {
        const source = map[i];
        if (alpha[source] >= ROOM_ALPHA) continue;
        sums[i * 3] += rgb[source * 3];
        sums[i * 3 + 1] += rgb[source * 3 + 1];
        sums[i * 3 + 2] += rgb[source * 3 + 2];
        counts[i] += 1;
      }
    },
    finish() {
      const color = new Float32Array(pixels * 3);
      const weight = new Float32Array(pixels);
      let seen = 0;
      for (let i = 0; i < pixels; i += 1) {
        if (counts[i] > 0) {
          seen += 1;
          weight[i] = 1;
          for (let c = 0; c < 3; c += 1) color[i * 3 + c] = sums[i * 3 + c] / counts[i];
        }
      }
      const filled = fillHoles(color, weight, size.width, size.height);
      const rgb = Buffer.alloc(pixels * 3);
      for (let i = 0; i < pixels * 3; i += 1) rgb[i] = Math.max(0, Math.min(255, Math.round(filled[i])));
      return { rgb, width: size.width, height: size.height, seen: Math.round((seen / pixels) * 1e4) / 1e4 };
    }
  };
}

/**
 * Push-pull hole filling. color: RGB floats, weight: 0–1 per pixel (0 = a
 * hole). Each level halves the image, averaging by weight; each hole then
 * takes the coarser level's colour, blended by its own weight. Holes with no
 * known pixel anywhere come out mid-grey. → filled RGB floats.
 */
export function fillHoles(color, weight, width, height) {
  if (width <= 1 && height <= 1) {
    const out = new Float32Array(3);
    for (let c = 0; c < 3; c += 1) out[c] = weight[0] > 0 ? color[c] : 128;
    return out;
  }
  const w2 = Math.max(1, Math.ceil(width / 2));
  const h2 = Math.max(1, Math.ceil(height / 2));
  const coarseColor = new Float32Array(w2 * h2 * 3);
  const coarseWeight = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y += 1) {
    for (let x = 0; x < w2; x += 1) {
      let total = 0;
      const sum = [0, 0, 0];
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const sx = x * 2 + dx, sy = y * 2 + dy;
          if (sx >= width || sy >= height) continue;
          const i = sy * width + sx;
          const w = weight[i];
          total += w;
          for (let c = 0; c < 3; c += 1) sum[c] += color[i * 3 + c] * w;
        }
      }
      const j = y * w2 + x;
      coarseWeight[j] = Math.min(1, total);
      for (let c = 0; c < 3; c += 1) coarseColor[j * 3 + c] = total > 0 ? sum[c] / total : 0;
    }
  }
  const coarse = fillHoles(coarseColor, coarseWeight, w2, h2);
  // The coarser level is sampled bilinearly, so a filled hole is a smooth
  // gradient of the room around it rather than blocks.
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(h2 - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h2 - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(w2 - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w2 - 1, x0 + 1), wx = fx - x0;
      const i = y * width + x;
      const w = Math.min(1, weight[i]);
      for (let c = 0; c < 3; c += 1) {
        const parent = (coarse[(y0 * w2 + x0) * 3 + c] * (1 - wx) + coarse[(y0 * w2 + x1) * 3 + c] * wx) * (1 - wy)
          + (coarse[(y1 * w2 + x0) * 3 + c] * (1 - wx) + coarse[(y1 * w2 + x1) * 3 + c] * wx) * wy;
        out[i * 3 + c] = color[i * 3 + c] * w + parent * (1 - w);
      }
    }
  }
  return out;
}
