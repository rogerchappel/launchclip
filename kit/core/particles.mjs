// The particle engine: a frame-pure canvas painter for catalogue I's particle
// and at-scale grid modules (kit/core/catalog-i-particles.mjs). A module's
// resolve() writes a paint plan, plain JSON, into model.content.paint keyed
// by the id of a <canvas> node in its view tree; both renderers then call
// paintParticles(ctx, plan, t) with the absolute composition time on every
// frame (HyperFrames from a proxy tween's onUpdate on the paused timeline,
// Remotion from a layout effect). Contract: docs/KIT_CONTRACTS.md
// ("Particles and paint plans").
//
// Frame-pure: a particle's state is a closed-form function of (plan, t),
// every random choice an integer hash of its index and the layer's seed.
// Nothing is integrated frame to frame, so seeking anywhere draws the same
// pixels in either renderer. What is cached between frames (sampled shapes,
// the token bitmap of a dot field) is derived from the plan alone, and a
// backwards seek rebuilds it.
//
// Layers, drawn in order:
//   field  a count-sized token bitmap (1 px = 1 token) filled in a seeded
//          permutation, drawn through a zoom: individual dots when a token is
//          ≥ 4 px wide, the bitmap scaled (honest density) below that.
//   swarm  particles flying from a scatter into target points (dot-matrix
//          text, or an SVG path sampled at paint time) and dissolving out.
//   ring   an orbiting elliptical ring with a back half and a front half.
//   cloud  a drifting cloud hugging a box, fed by an optional stream.
//   cells  unit grids at scale: fills, stacked colour segments, ticks and a
//          highlighted subset, thousands of cells at a time.
// Budget: every layer stays under ~4 ms at 1080p in Chromium (a
// 1,050,000-token field, 30k swarm particles, 10k cells).
//
// The functions below the RUNTIME line use nothing outside themselves, so
// PARTICLE_RUNTIME (their source) is what HyperFrames inlines into the page.

/** Paint-plan layer kinds. */
export const PAINT_KINDS = Object.freeze(['field', 'swarm', 'ring', 'cloud', 'cells']);
/** The largest token field a dot-field draws (1 px = 1 token in its bitmap). */
export const MAX_FIELD = 2_000_000;

/** '#rrggbb' → [r, g, b]. */
export function rgbOf(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---------------------------------------------------------------------------
// Dot-matrix text: a 5 × 7 LED face, so a number assembles from particles
// with no font loaded and the same targets in Node and both renderers.

const GLYPHS = {
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 17, 31, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28], E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 17, 10, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31], '$': [4, 15, 20, 14, 5, 30, 4], '%': [24, 25, 2, 4, 8, 19, 3], '.': [0, 0, 0, 0, 0, 0, 4], ',': [0, 0, 0, 0, 0, 4, 8],
  '+': [0, 4, 4, 31, 4, 4, 0], '-': [0, 0, 0, 31, 0, 0, 0], '×': [0, 17, 10, 4, 10, 17, 0], '≈': [0, 8, 21, 2, 8, 21, 2], '/': [0, 1, 2, 4, 8, 16, 0],
  ':': [0, 0, 4, 0, 0, 4, 0], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], '#': [10, 10, 31, 10, 31, 10, 10], "'": [4, 4, 8, 0, 0, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0]
};
/** Characters the dot-matrix face draws (letters are upper-cased). */
export const DOT_MATRIX_CHARS = Object.freeze(Object.keys(GLYPHS).join(''));

/** One glyph's lit columns: [first, last] (punctuation is narrow), or null for a space. */
function glyphSpan(rows) {
  const bits = rows.reduce((all, row) => all | row, 0);
  if (!bits) return null;
  let first = 0, last = 4;
  while (!(bits & (16 >> first))) first++;
  while (!(bits & (16 >> last))) last--;
  return [first, last];
}

/** Width of `text` in dot-matrix columns (a 1-column gap between glyphs; a space is 3). */
export function dotMatrixColumns(text) {
  let cols = 0;
  for (const ch of String(text).toUpperCase()) {
    const span = glyphSpan(GLYPHS[ch] ?? GLYPHS[' ']);
    cols += (span ? span[1] - span[0] + 1 : 2) + 1;
  }
  return Math.max(0, cols - 1);
}

/**
 * Target points for `text` in the dot-matrix face: each lit LED pixel is a
 * sub × sub cluster of particles, centred in the box (x, y, width, height).
 * Returns {pts: [x, y, …] rounded to 0.01 px, pitch (px per LED), width, height}.
 */
export function dotMatrixPoints(text, {x, y, width, height, sub = 3, seed = 1, jitter = 0.18}) {
  const chars = [...String(text).toUpperCase()];
  for (const ch of chars) if (!GLYPHS[ch]) throw new Error(`dot-matrix: no glyph for ${JSON.stringify(ch)}`);
  const cols = dotMatrixColumns(text);
  const pitch = Math.min(width / Math.max(1, cols), height / 7);
  const w = cols * pitch, h = 7 * pitch;
  const x0 = x + (width - w) / 2, y0 = y + (height - h) / 2;
  const pts = [];
  const r = v => Math.round(v * 100) / 100;
  let col = 0, n = 0;
  for (const ch of chars) {
    const rows = GLYPHS[ch], span = glyphSpan(rows);
    if (!span) { col += 3; continue; }
    for (let ry = 0; ry < 7; ry++) for (let cx = span[0]; cx <= span[1]; cx++) {
      if (!(rows[ry] & (16 >> cx))) continue;
      const px = x0 + (col + cx - span[0]) * pitch, py = y0 + ry * pitch;
      for (let sy = 0; sy < sub; sy++) for (let sx = 0; sx < sub; sx++) {
        const jx = (lcHash(n, seed) - 0.5) * jitter, jy = (lcHash(n, seed + 3) - 0.5) * jitter;
        pts.push(r(px + ((sx + 0.5 + jx) / sub) * pitch * 0.86), r(py + ((sy + 0.5 + jy) / sub) * pitch * 0.86));
        n++;
      }
    }
    col += span[1] - span[0] + 2;
  }
  return {pts, pitch: r(pitch), width: r(w), height: r(h)};
}


// ---------------------------------------------------------------------------
// RUNTIME: self-contained from here down.

function lcHash(i, s) {
  let h = Math.imul((i | 0) ^ Math.imul((s | 0) + 0x632be5ab, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function lcEase(name, p) {
  p = p < 0 ? 0 : p > 1 ? 1 : p;
  if (name === 'out') return 1 - (1 - p) * (1 - p) * (1 - p);
  if (name === 'in') return p * p;
  if (name === 'inOut') return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  if (name === 'back') { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
  return p;
}

function lcRgba(rgb, a) {
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a < 0 ? 0 : a > 1 ? 1 : Math.round(a * 1000) / 1000) + ')';
}

function lcCanvas(ctx, w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const doc = ctx.canvas.ownerDocument || document;
  const c = doc.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Zoom keyframes [{t, s, fx, fy}] → the state at t (eased in-out between keys). */
function lcZoom(keys, t) {
  if (!keys || !keys.length) return {s: 1, fx: 0.5, fy: 0.5};
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (t < b.t) {
      // Scale eases in log space, so a 40× pull-back feels even.
      const p = lcEase('inOut', (t - a.t) / (b.t - a.t));
      return {s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p), fx: a.fx + (b.fx - a.fx) * p, fy: a.fy + (b.fy - a.fy) * p};
    }
  }
  return keys[keys.length - 1];
}

/** The fill order of n tokens: a seeded Fisher–Yates shuffle (every token exactly once). */
function lcShuffle(n, seed) {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(lcHash(i, seed) * (i + 1)); const v = order[i]; order[i] = order[j]; order[j] = v; }
  return order;
}

function lcFilled(L, t) {
  const p = lcEase(L.ease || 'none', (t - L.t0) / Math.max(1e-6, L.t1 - L.t0));
  return Math.floor(L.count * p + 1e-9);
}

function lcFieldBitmap(cache, ctx, L, filled) {
  let st = cache.get(L);
  if (!st) {
    const canvas = lcCanvas(ctx, L.cols, L.rows);
    const c2 = canvas.getContext('2d');
    st = {canvas, c2, img: c2.createImageData(L.cols, L.rows), filled: -1, order: L.shuffle ? lcShuffle(L.count, L.seed) : null};
    cache.set(L, st);
  }
  if (st.filled === filled) return st;
  const d = st.img.data, rgb = L.rgb;
  let from = st.filled;
  if (from < 0 || filled < from) {
    // Empty capacity: every slot faintly lit, so the size of the window shows.
    const ea = Math.round((L.empty || 0) * 255);
    for (let i = 0; i < L.count; i++) { const o = i * 4; d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = ea; }
    from = 0;
  }
  for (let k = from; k < filled; k++) {
    const idx = st.order ? st.order[k] : k, o = idx * 4;
    d[o + 3] = 120 + Math.floor(lcHash(idx, L.seed) * 135);
  }
  st.filled = filled;
  st.c2.putImageData(st.img, 0, 0);
  return st;
}

function lcPaintField(ctx, L, t, cache) {
  if (t < L.at) return;
  const appear = Math.min(1, (t - L.at) / 0.35);
  const filled = lcFilled(L, t);
  const st = lcFieldBitmap(cache, ctx, L, filled);
  const z = lcZoom(L.zoom, t);
  const fit = Math.min(L.w / L.cols, L.h / L.rows);
  const s = fit * z.s;
  const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
  // Token (gx, gy) sits at screen cx + (gx − fx·cols)·s; the focus stays inside the grid.
  const ox = cx - z.fx * L.cols * s, oy = cy - z.fy * L.rows * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(L.x, L.y, L.w, L.h); ctx.clip();
  ctx.globalAlpha = appear;
  if (s >= 4) {
    // Close up: one round dot per token, in eight alpha buckets.
    const g0 = Math.max(0, Math.floor((L.x - ox) / s)), g1 = Math.min(L.cols - 1, Math.ceil((L.x + L.w - ox) / s));
    const r0 = Math.max(0, Math.floor((L.y - oy) / s)), r1 = Math.min(L.rows - 1, Math.ceil((L.y + L.h - oy) / s));
    const d = st.img.data, rad = s * 0.36, buckets = [];
    for (let b = 0; b < 8; b++) buckets.push(new Path2D());
    for (let gy = r0; gy <= r1; gy++) {
      const row = gy * L.cols;
      for (let gx = g0; gx <= g1; gx++) {
        const i = row + gx;
        if (i >= L.count) break;
        const a = d[i * 4 + 3];
        if (!a) continue;
        const px = ox + (gx + 0.5) * s, py = oy + (gy + 0.5) * s;
        const path = buckets[a >> 5];
        path.moveTo(px + rad, py); path.arc(px, py, rad, 0, 6.2832);
      }
    }
    for (let b = 0; b < 8; b++) { ctx.fillStyle = lcRgba(L.rgb, (b * 32 + 16) / 255); ctx.fill(buckets[b]); }
  } else {
    ctx.imageSmoothingEnabled = s < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.canvas, ox, oy, L.cols * s, L.rows * s);
  }
  ctx.restore();
}

function lcShapePoints(cache, ctx, L) {
  const hit = cache.get(L);
  if (hit) return hit;
  let pts = L.pts;
  if (!pts && L.shape) {
    // An SVG path sampled on a jittered grid inside its fill (or along its stroke).
    const S = L.shape, vb = S.vb, k = S.size / Math.max(vb[2], vb[3]);
    const w = Math.ceil(vb[2] * k) + 2, h = Math.ceil(vb[3] * k) + 2;
    const off = lcCanvas(ctx, w, h), c2 = off.getContext('2d');
    c2.translate(1, 1); c2.scale(k, k); c2.translate(-vb[0], -vb[1]);
    const path = new Path2D(S.d);
    if (S.mode === 'stroke') { c2.lineWidth = S.sw; c2.lineCap = 'round'; c2.lineJoin = 'round'; c2.strokeStyle = '#fff'; c2.stroke(path); }
    else { c2.fillStyle = '#fff'; c2.fill(path, S.rule || 'nonzero'); }
    const data = c2.getImageData(0, 0, w, h).data;
    const out = [], step = S.step;
    let n = 0;
    for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) {
      const jx = x + (lcHash(n, L.seed + 7) - 0.5) * step * 0.8, jy = y + (lcHash(n, L.seed + 9) - 0.5) * step * 0.8;
      n++;
      const xi = Math.min(w - 1, Math.max(0, Math.round(jx))), yi = Math.min(h - 1, Math.max(0, Math.round(jy)));
      if (data[(yi * w + xi) * 4 + 3] > 110) out.push(S.x + jx - 1, S.y + jy - 1);
    }
    pts = out;
  }
  cache.set(L, pts || []);
  return pts || [];
}

function lcPaintSwarm(ctx, L, t, cache) {
  if (t < L.at - 0.001) return;
  const pts = lcShapePoints(cache, ctx, L);
  const n = pts.length / 2, sd = L.seed, sz = L.size;
  const A = L.assemble, D = L.dissolve;
  const assembled = !A;
  ctx.save();
  ctx.fillStyle = lcRgba(L.rgb, 1);
  for (let i = 0; i < n; i++) {
    const tx = pts[2 * i], ty = pts[2 * i + 1];
    const h1 = lcHash(i, sd), h2 = lcHash(i, sd + 1), h3 = lcHash(i, sd + 2);
    let x = tx, y = ty, alpha = L.alpha * (0.55 + 0.45 * h3);
    if (!assembled) {
      const ang = h1 * 6.2832, r = A.r * Math.sqrt(h2);
      const sx = A.cx + Math.cos(ang) * r, sy = A.cy + Math.sin(ang) * r;
      const p0 = (t - A.t - h3 * A.spread) / A.dur;
      if (p0 <= 0) continue;
      const p = lcEase('out', p0);
      // A slight swirl on the way in: a perpendicular bow that is gone on arrival.
      const bow = Math.sin(Math.PI * p) * (h1 - 0.5) * A.r * 0.35;
      const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1;
      x = sx + dx * p - dy / len * bow; y = sy + dy * p + dx / len * bow;
      alpha *= Math.min(1, p0 * 2.5);
    }
    if (D) {
      const q0 = (t - D.t - h2 * D.spread) / D.dur;
      if (q0 > 0) {
        if (q0 >= 1) continue;
        const q = lcEase('in', q0);
        const ang = h3 * 6.2832;
        x += D.dx * q + Math.cos(ang) * D.r * q * h1;
        y += D.dy * q + Math.sin(ang) * D.r * q * h1;
        alpha *= 1 - q0;
      }
    }
    if (L.shimmer) {
      x += Math.sin(t * (1.3 + h1) + h2 * 6.28) * L.shimmer;
      y += Math.cos(t * (1.1 + h2) + h3 * 6.28) * L.shimmer;
    }
    if (alpha <= 0.004) continue;
    ctx.globalAlpha = alpha;
    const s = sz * (0.7 + 0.6 * h2);
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.restore();
}

function lcPaintRing(ctx, L, t) {
  if (t < L.at) return;
  const cos = Math.cos(L.rot), sin = Math.sin(L.rot), sd = L.seed;
  ctx.save();
  ctx.fillStyle = lcRgba(L.rgb, 1);
  for (let i = 0; i < L.count; i++) {
    const h1 = lcHash(i, sd), h2 = lcHash(i, sd + 1), h3 = lcHash(i, sd + 2), h4 = lcHash(i, sd + 3);
    // Radial spread: a soft band (sum of two uniforms ≈ triangular).
    const k = 1 + (h2 + h3 - 1) * L.width;
    const theta = h1 * 6.2832 + L.omega * (t - L.at) / Math.pow(k, 1.5);
    const sn = Math.sin(theta);
    const front = sn > 0;
    if (L.half === 'front' && !front) continue;
    if (L.half === 'back' && front) continue;
    const ex = Math.cos(theta) * L.rx * k, ey = sn * L.ry * k;
    const x = L.cx + ex * cos - ey * sin, y = L.cy + ex * sin + ey * cos;
    const appear = Math.min(1, Math.max(0, (t - L.at - h4 * L.dur * 0.7) / 0.4));
    if (appear <= 0) continue;
    ctx.globalAlpha = appear * (0.3 + 0.7 * h4) * (front ? 1 : 0.5);
    const s = L.size * (0.6 + 0.8 * h3) * (front ? 1.15 : 0.85);
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.restore();
}

function lcPaintCloud(ctx, L, t) {
  if (t < L.at) return;
  const B = L.box, sd = L.seed, per = 2 * (B.w + B.h);
  ctx.save();
  ctx.fillStyle = lcRgba(L.rgb, 1);
  for (let i = 0; i < L.count; i++) {
    const h1 = lcHash(i, sd), h2 = lcHash(i, sd + 1), h3 = lcHash(i, sd + 2), h4 = lcHash(i, sd + 3), h5 = lcHash(i, sd + 4);
    // A point on the box outline, pushed out along its normal: dense at the edge, thinning outward.
    let u = h1 * per, x, y, nx, ny;
    if (u < B.w) { x = B.x + u; y = B.y; nx = 0; ny = -1; }
    else if ((u -= B.w) < B.h) { x = B.x + B.w; y = B.y + u; nx = 1; ny = 0; }
    else if ((u -= B.h) < B.w) { x = B.x + B.w - u; y = B.y + B.h; nx = 0; ny = 1; }
    else { u -= B.w; x = B.x; y = B.y + B.h - u; nx = -1; ny = 0; }
    const off = (h2 * h2) * L.spread - L.spread * 0.06;
    const side = (h3 - 0.5) * L.spread * 0.5;
    let px = x + nx * off + ny * side, py = y + ny * off + nx * side;
    // Drift: two slow sines per particle.
    px += Math.sin(t * (0.35 + h4 * 0.5) + h5 * 6.28) * L.drift;
    py += Math.cos(t * (0.3 + h5 * 0.45) + h4 * 6.28) * L.drift;
    let alpha = (0.25 + 0.75 * h4) * (1 - h2 * 0.75) * (0.65 + 0.35 * Math.sin(t * (1.5 + h3 * 2.5) + h1 * 40));
    const delay = h5 * L.dur;
    const p0 = (t - L.at - delay) / 0.9;
    if (p0 <= 0) continue;
    if (p0 < 1 && L.from) {
      // Arrives along a bowed path from the stream's source.
      const p = lcEase('out', p0);
      const mx = (L.from.x + px) / 2 + (h3 - 0.5) * L.spread * 2, my = Math.min(L.from.y, py) - L.spread * (0.5 + h1);
      const ix = (1 - p) * (1 - p) * L.from.x + 2 * (1 - p) * p * mx + p * p * px;
      const iy = (1 - p) * (1 - p) * L.from.y + 2 * (1 - p) * p * my + p * p * py;
      px = ix; py = iy;
    }
    alpha *= Math.min(1, p0 * 2);
    if (alpha <= 0.004) continue;
    ctx.globalAlpha = alpha;
    const s = L.size * (0.5 + h3);
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
  }
  ctx.restore();
}

function lcCellXY(G, k) {
  const col = k % G.cols, row = Math.floor(k / G.cols);
  const pitch = G.cell + G.gap;
  const x = G.x + col * pitch;
  const y = G.order === 'bottom-up' ? G.y + (G.rows - 1 - row) * pitch : G.y + row * pitch;
  return [x, y];
}

function lcCellColor(G, k) {
  if (G.segs) for (let i = 0; i < G.segs.length; i++) if (k >= G.segs[i].from && k < G.segs[i].to) return G.segs[i].rgb;
  return G.rgb;
}

function lcPaintCells(ctx, L, t) {
  for (let gi = 0; gi < L.grids.length; gi++) {
    const G = L.grids[gi];
    if (t < G.at) continue;
    const appear = Math.min(1, (t - G.at) / 0.3);
    const span = Math.max(1e-6, G.t1 - G.t0);
    const pf = Math.min(1, Math.max(0, (t - G.t0) / span));
    const filled = Math.floor(G.count * pf + 1e-9);
    const rad = Math.min(G.cell * 0.22, G.radius);
    const settled = new Map();
    ctx.save();
    if (G.empty) {
      ctx.globalAlpha = appear * G.empty;
      ctx.fillStyle = lcRgba(G.rgb, 1);
      const p = new Path2D();
      for (let k = filled; k < G.slots; k++) { const xy = lcCellXY(G, k); p.roundRect(xy[0], xy[1], G.cell, G.cell, rad); }
      ctx.fill(p);
    }
    const H = G.hl;
    const hp = H ? (t - H.t) : -1;
    const dim = H && H.dim && hp > 0 ? 1 - Math.min(1, hp / 0.4) * (1 - H.dim) : 1;
    for (let k = 0; k < filled; k++) {
      const age = t - (G.t0 + span * (k + 1) / G.count);
      let rgb = lcCellColor(G, k), alpha = appear;
      const lit = H && k >= H.from && k < H.to;
      if (lit) {
        const local = hp - (k - H.from) * H.step;
        if (local > 0) { const m = Math.min(1, local / 0.3); rgb = m >= 1 ? H.rgb : [0, 1, 2].map(j => Math.round(rgb[j] + (H.rgb[j] - rgb[j]) * m)); }
      } else alpha *= dim;
      const xy = lcCellXY(G, k);
      if (age < 0.22) {
        const p = lcEase('back', age / 0.22), s = G.cell * (0.35 + 0.65 * p), o = (G.cell - s) / 2;
        ctx.globalAlpha = alpha * Math.min(1, age / 0.1 + 0.2);
        ctx.fillStyle = lcRgba(rgb, 1);
        ctx.beginPath(); ctx.roundRect(xy[0] + o, xy[1] + o, s, s, rad * p); ctx.fill();
        continue;
      }
      const key = rgb.join(',') + '|' + Math.round(alpha * 100);
      let entry = settled.get(key);
      if (!entry) settled.set(key, entry = {rgb, alpha, path: new Path2D()});
      entry.path.roundRect(xy[0], xy[1], G.cell, G.cell, rad);
    }
    settled.forEach(entry => { ctx.globalAlpha = entry.alpha; ctx.fillStyle = lcRgba(entry.rgb, 1); ctx.fill(entry.path); });
    if (G.tick && t > G.tick.t0) {
      const T = G.tick, tspan = Math.max(1e-6, T.t1 - T.t0);
      const ticked = Math.min(T.count, Math.floor(T.count * Math.min(1, (t - T.t0) / tspan) + 1e-9));
      const box = new Path2D(), mark = new Path2D();
      for (let k = 0; k < ticked; k++) {
        const xy = lcCellXY(G, k), c = G.cell;
        box.roundRect(xy[0], xy[1], c, c, rad);
        mark.moveTo(xy[0] + c * 0.24, xy[1] + c * 0.53); mark.lineTo(xy[0] + c * 0.43, xy[1] + c * 0.71); mark.lineTo(xy[0] + c * 0.77, xy[1] + c * 0.31);
      }
      ctx.globalAlpha = appear;
      ctx.fillStyle = lcRgba(T.rgb, 1); ctx.fill(box);
      ctx.strokeStyle = lcRgba(T.ink, 1); ctx.lineWidth = Math.max(1, G.cell * 0.13); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(mark);
    }
    ctx.restore();
  }
}

function paintParticles(ctx, plan, t) {
  const cache = paintParticles.cache || (paintParticles.cache = new WeakMap());
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, plan.width, plan.height);
  if (plan.glow) ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < plan.layers.length; i++) {
    const L = plan.layers[i];
    if (L.kind === 'field') lcPaintField(ctx, L, t, cache);
    else if (L.kind === 'swarm') lcPaintSwarm(ctx, L, t, cache);
    else if (L.kind === 'ring') lcPaintRing(ctx, L, t);
    else if (L.kind === 'cloud') lcPaintCloud(ctx, L, t);
    else if (L.kind === 'cells') lcPaintCells(ctx, L, t);
  }
  if (plan.glow) {
    // Bloom: the frame blurred and added back over itself.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = plan.glow.alpha;
    ctx.filter = 'blur(' + plan.glow.blur + 'px)';
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.restore();
  }
}

const RUNTIME_FUNCTIONS = [lcHash, lcEase, lcRgba, lcCanvas, lcZoom, lcShuffle, lcFilled, lcFieldBitmap, lcPaintField, lcShapePoints, lcPaintSwarm, lcPaintRing, lcPaintCloud, lcCellXY, lcCellColor, lcPaintCells, paintParticles];

/** The painter's source, for HyperFrames to inline: defines window.lcPaintParticles once. */
export const PARTICLE_RUNTIME = `window.lcPaintParticles = window.lcPaintParticles || (function () {\n${RUNTIME_FUNCTIONS.map(String).join('\n')}\nreturn paintParticles;\n})();`;

export {paintParticles, lcShuffle as fillOrder, lcHash as particleHash, lcEase as particleEase, lcCellXY as cellPosition};
