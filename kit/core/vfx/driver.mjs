// The fixed-step driver (docs/VFX_LAYER_RFC.md §2): makes every vendored
// effect frame-pure. A pure effect draws from t alone. A simulated one
// (create() → {update(dt), draw(p)}) is, at local time t, exactly
// round(t × 120) steps of 1/120 s from a fresh create(), so a frame never
// depends on the frame rate or on how the renderer got there (sequential
// play, a seek, a chunk boundary, a retried frame).
//
// The forward cache keeps the last instance per key (effect, options, seed):
// a later t steps on from it, an earlier t rebuilds from t = 0, the same rule
// the particle runtime uses for its bitmaps. The cached state is a function
// of the step count alone, so the cache changes only the cost, never a pixel.

/** Seconds per simulation step. */
export const VFX_STEP = 1 / 120;
const CACHE_SIZE = 64;
const cache = new Map();

/** Local time an effect draws at, or null when it draws nothing (before its start, or a one-shot at or past its duration). */
export function vfxLocalTime(mod, t) {
  const meta = mod.meta ?? {}, D = meta.duration ?? 1;
  if (!(t >= 0)) return null;
  if (meta.loop) return t % D;
  return t < D ? t : null;
}

/**
 * The effect at local time t: {impl, t} with impl ready to draw (the module
 * itself for a pure effect, a stepped instance for a simulated one), or null
 * when nothing draws. opts are resolved options (vendor resolveOptions); key
 * names the cache slot (null: no cache, a fresh replay).
 */
export function vfxAt(mod, opts, t, key = null) {
  const tt = vfxLocalTime(mod, t);
  if (tt === null) return null;
  if (!mod.create) return {impl: mod, t: tt};
  const n = Math.round(tt * 120);
  let slot = key === null ? null : cache.get(key);
  if (!slot || slot.n > n) {
    slot = {impl: mod.create(opts), n: 0};
    if (key !== null) {
      cache.delete(key);
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value);
      cache.set(key, slot);
    }
  }
  for (; slot.n < n; slot.n += 1) slot.impl.update?.(VFX_STEP, opts);
  return {impl: slot.impl, t: tt};
}

/** Draw an effect at local time t through a placed painter: its back layer, then its front (as upstream's createFx). Returns whether it drew. */
export function drawVfx(painter, mod, opts, t, key = null) {
  const state = vfxAt(mod, opts, t, key);
  if (!state) return false;
  if (state.impl.drawBack) {
    painter.layer = 'back';
    state.impl.drawBack(painter, state.t, opts);
  }
  painter.layer = 'front';
  state.impl.draw(painter, state.t, opts);
  return true;
}

/** Forget every cached instance (tests, and a story change in a long-lived page). */
export function clearVfxCache() {
  cache.clear();
}
