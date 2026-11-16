// The VFX painter: one frame of a VFX plan (kit/core/vfx/plan.mjs) into two
// art-sized canvases, the colour layer (opaque pixels, normal blending) and
// the light layer (additive glow, drawn with mix-blend-mode: plus-lighter).
// Remotion calls it from VfxCanvas's layout effect; HyperFrames inlines the
// same code as VFX_RUNTIME (kit/core/vfx/runtime.mjs) and calls it from a
// proxy tween's onUpdate. Frame-pure: time snaps to the driver's 1/120 s grid,
// so a renderer's float noise never decides whether a cue has started.
import {VFX_MODULES} from './catalog.mjs';
import {drawVfx} from './driver.mjs';
import {clearFrame, createFrame, painterFor, resolveOptions} from './vendor/core/fx.js';

const prepared = new WeakMap();

function prepare(plan) {
  let ready = prepared.get(plan);
  if (!ready) {
    ready = {
      frame: createFrame(plan.aw, plan.ah),
      cues: plan.cues.map(cue => {
        const mod = VFX_MODULES[cue.effect];
        const opts = resolveOptions(mod.meta, cue.palette ? {seed: cue.seed, palette: cue.palette} : {seed: cue.seed});
        return {cue, mod, opts, key: JSON.stringify(cue)};
      })
    };
    prepared.set(plan, ready);
  }
  return ready;
}

/** Draw the plan's cues at story time t into the frame's colour and light buffers (Node stills and tests use this directly). */
export function drawVfxFrame(plan, t) {
  const {frame, cues} = prepare(plan);
  clearFrame(frame);
  for (const {cue, mod, opts, key} of cues) {
    const local = Math.round((t - cue.start) * 120), left = Math.round((cue.end - t) * 120);
    if (local < 0 || left <= 0) continue;
    const p = painterFor(frame).place(cue.x, cue.y, Boolean(cue.flip), cue.angle ?? 0);
    p.lightK = cue.light ?? 1;
    drawVfx(p, mod, opts, local / 120, key);
  }
  return frame;
}

/**
 * Paint the plan at story time t: colour pixels as they are; light as colour
 * whose alpha is its brightest channel, so plus-lighter adds exactly the
 * light over whatever is under it.
 */
export function paintVfx(colorCtx, lightCtx, plan, t) {
  const frame = drawVfxFrame(plan, t);
  const color = colorCtx.createImageData(plan.aw, plan.ah), light = lightCtx.createImageData(plan.aw, plan.ah);
  const C = frame.color, L = frame.light, cd = color.data, ld = light.data;
  for (let i = 0, j = 0; i < C.length; i += 1, j += 4) {
    const c = C[i];
    if (c >>> 24) { cd[j] = c & 255; cd[j + 1] = (c >>> 8) & 255; cd[j + 2] = (c >>> 16) & 255; cd[j + 3] = c >>> 24; }
    const l = L[i], r = l & 255, g = (l >>> 8) & 255, b = (l >>> 16) & 255, m = Math.max(r, g, b);
    if (m) { ld[j] = (r * 255) / m; ld[j + 1] = (g * 255) / m; ld[j + 2] = (b * 255) / m; ld[j + 3] = m; }
  }
  colorCtx.putImageData(color, 0, 0);
  lightCtx.putImageData(light, 0, 0);
}
