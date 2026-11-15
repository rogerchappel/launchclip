// The light-leak transition: warm light floods in from one side of the
// frame, peaks at the cut and clears, as film fogged by a leak in the camera
// body. Soft orange, red and pale yellow blooms are added to the picture
// (screen blend) while the two plates crossfade under the peak, so nothing
// opaque covers the frame and the frame never dips: the opposite of the
// light-sweep, which falls nearly to black under thin streaks.
// Gradients and a blend mode only (no filters), drawn by the light-sweep's
// layer in both renderers (kit/core/light-sweep.mjs lightSweeps and
// lightSweepHtml hand a leak over to this file) from one custom property,
// --lc-ls (the progress, 0 → 1, linear). Plain ESM, no imports.
// Canonical copy: kit/core/light-leak.mjs. Contract: docs/KIT_CONTRACTS.md,
// "Transitions".
//
//   scene.in = {type: "light-leak", dur: 0.8}   (track-0 scenes, 0.6–1 s: 20 to 30 frames)
//
// No options: the side it enters from and the blooms are seeded by the
// scene's id, so the same story leaks the same light on every render.

export const LIGHT_LEAK = Object.freeze({
  // Warm film light: a deep orange, a red and a pale yellow hot core.
  colors: Object.freeze(['255,138,40', '255,72,28', '255,222,160']),
  // The wash over the whole frame at the peak, and each bloom's peak.
  wash: 0.9, peaks: Object.freeze([0.95, 0.8, 1]),
  // Bloom sizes (shares of the frame's long side) and how far each drifts
  // across the frame over the transition (a share of its width).
  sizes: Object.freeze([1.5, 1.1, 0.8]), drift: 0.45,
  // The light is up by `peak` of the transition and clear by its end; the
  // plates crossfade over `swap` of it, centred on the peak.
  peak: 0.5, swap: 0.3
});

const round = (value, digits = 3) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
// A deterministic 0–1 hash (no Math.random: frames are a function of t).
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const seedOf = (text) => [...String(text ?? '')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 9973, 7);

/** How much of the light shows at progress p (0 → 1): up to the peak, then clear. */
export function lightLeakAt(p) {
  const at = LIGHT_LEAK.peak;
  return round(Math.max(0, Math.min(1, p / at, (1 - p) / (1 - at))), 4);
}

/**
 * The blooms of a leak on a width × height frame, seeded by its id: the side
 * the light enters from (−1 left, 1 right) and, per bloom, its centre at the
 * start, its drift, its size and colour.
 * → {side, blooms: [{x, y, dx, dy, width, height, color, peak}]} (px)
 */
export function lightLeakBlooms(width, height, leak = {}) {
  const seed = seedOf(leak.id) * 0.37, long = Math.max(width, height);
  const h = (i, k) => hash(seed + i * 7 + k);
  const side = h(0, 9) < 0.5 ? -1 : 1;
  const blooms = LIGHT_LEAK.sizes.map((size, i) => ({
    // From just inside its edge, at a seeded height, drifting across and a little up or down.
    x: round(side < 0 ? width * (0.02 + 0.2 * h(i, 1)) : width * (0.98 - 0.2 * h(i, 1)), 1),
    y: round(height * (0.15 + 0.7 * h(i, 2)), 1),
    dx: round(-side * width * LIGHT_LEAK.drift * (0.6 + 0.4 * h(i, 3)), 1),
    dy: round(height * 0.12 * (h(i, 4) - 0.5), 1),
    width: round(long * size * (0.85 + 0.3 * h(i, 5)), 1), height: round(long * size * (1.1 + 0.5 * h(i, 6)), 1),
    color: LIGHT_LEAK.colors[i % LIGHT_LEAK.colors.length], peak: LIGHT_LEAK.peaks[i % LIGHT_LEAK.peaks.length]
  }));
  return { side, blooms };
}

/** The markup (a string, both renderers parse the same) of a leak inside the light-sweep's screen-blended layer. */
export function lightLeakHtml(width, height, leak) {
  const { side, blooms } = lightLeakBlooms(width, height, leak);
  const at = LIGHT_LEAK.peak;
  const show = `clamp(0, min(var(--lc-ls) / ${at}, (1 - var(--lc-ls)) / ${round(1 - at, 4)}), 1)`;
  const [orange, red] = LIGHT_LEAK.colors;
  // The wash: strongest on the side the light enters from, across the whole frame at the peak.
  const wash = `<div class="lc-ls-wash" style="background:linear-gradient(${side < 0 ? 'to right' : 'to left'}, rgba(${orange},1), rgba(${red},0.7) 55%, rgba(${red},0.35));opacity:calc(${LIGHT_LEAK.wash} * ${show})"></div>`;
  const parts = blooms.map((b) => `<div class="lc-ls-wash" style="left:${round(b.x - b.width / 2, 1)}px;top:${round(b.y - b.height / 2, 1)}px;width:${b.width}px;height:${b.height}px;background:radial-gradient(ellipse closest-side, rgba(${b.color},1), rgba(${b.color},0.55) 45%, rgba(${b.color},0));transform:translate(calc(var(--lc-ls) * ${b.dx}px), calc(var(--lc-ls) * ${b.dy}px));opacity:calc(${b.peak} * ${show})"></div>`);
  return `${wash}${parts.join('')}`;
}
