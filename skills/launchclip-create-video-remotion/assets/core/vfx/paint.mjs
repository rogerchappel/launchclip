// The VFX painter: one frame of a VFX plan (kit/core/vfx/plan.mjs) into two
// art-sized canvases, the colour layer (opaque pixels, normal blending) and
// the light layer (additive glow, drawn with mix-blend-mode: plus-lighter).
// Remotion calls it from VfxCanvas's layout effect; HyperFrames inlines the
// same code as VFX_RUNTIME (kit/core/vfx/runtime.mjs) and calls it from a
// proxy tween's onUpdate. Frame-pure: time snaps to the driver's 1/120 s grid,
// so a renderer's float noise never decides whether a cue has started.
import {VFX_DRAWABLE} from './catalog.mjs';
import {drawVfx} from './driver.mjs';
import {clearFrame, createFrame, painterFor, resolveOptions} from './vendor/core/fx.js';

const prepared = new WeakMap();

function prepare(plan) {
  let ready = prepared.get(plan);
  if (!ready) {
    ready = {
      frame: createFrame(plan.aw, plan.ah),
      cues: plan.cues.map(cue => {
        const mod = VFX_DRAWABLE[cue.effect];
        const opts = resolveOptions(mod.meta, {...cue.opts, seed: cue.seed, ...(cue.palette ? {palette: cue.palette} : {})});
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
    const local = Math.round((t - cue.start) * (cue.speed ?? 1) * 120), left = Math.round((cue.end - t) * 120);
    if (local < 0 || left <= 0) continue;
    const p = painterFor(frame).place(cue.x, cue.y, Boolean(cue.flip), cue.angle ?? 0);
    // a screen turned a quarter for a portrait frame: exact, so no rounding noise picks a pixel
    if (cue.quarter) (p.cs = 0), (p.sn = 1);
    p.lightK = cue.light ?? 1;
    p.words = cue.words !== false;
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

// ---- Words: a hit's words as brand-font text (catalog.mjs VFX_WORDS), moved
// by the same function in both renderers, so the two write the same styles.

const r2 = value => Math.round(value * 100) / 100;
const clamp01 = value => Math.min(1, Math.max(0, value));
const outCubic = k => 1 - (1 - k) ** 3;

/** The fixed style of a word's element: placed on its centre in frame pixels, in the brand's display face. */
export function vfxWordBox(word, grid) {
  return {position: 'absolute', left: `${r2(word.x * grid)}px`, top: `${r2(word.y * grid)}px`, fontFamily: word.font, fontSize: `${r2((word.size / 0.7) * grid)}px`, lineHeight: '1', fontWeight: '800', whiteSpace: 'nowrap', color: word.color, textShadow: `0 0.07em 0 ${word.shadow}, 0 0 0.35em ${word.color}`, pointerEvents: 'none', opacity: '0'};
}

/** A word at story time t: {opacity, transform}, offsets in whole art pixels × grid like the effect's own pixels. */
export function vfxWordAt(word, t, grid) {
  const u = Math.round((t - word.start) * 120) / 120, [in0, in1] = word.in, [out0, out1] = word.out;
  if (u < in0 || u >= out1) return {opacity: '0', transform: 'translate(-50%, -50%)'};
  const k = in1 > in0 ? clamp01((u - in0) / (in1 - in0)) : 1, e = outCubic(k), q = clamp01((u - out0) / (out1 - out0));
  let x = 0, y = 0, scale = 1, opacity = 1;
  if (word.enter === 'slam') scale = 1 + 0.7 * (1 - e);
  else if (word.enter === 'drop') (y = -40 * (1 - e)), (opacity = clamp01(k * 3));
  else if (word.enter === 'from-left') x = -32 * (1 - e);
  else if (word.enter === 'from-right') x = 30 * (1 - e);
  if (word.exit === 'pop') scale *= 1 + 0.25 * q;
  else if (word.exit === 'to-right') x += 33 * q * q;
  opacity *= 1 - q;
  if (word.shake && u >= word.shake[0] && u < word.shake[1]) {
    const amp = 2.5 * (1 - (u - word.shake[0]) / (word.shake[1] - word.shake[0]));
    x += Math.round(Math.sin(u * 211 + word.seed) * amp);
    y += Math.round(Math.sin(u * 173 + word.seed * 3) * amp * 0.7);
  }
  return {opacity: String(r2(opacity)), transform: `translate(-50%, -50%) translate(${r2(Math.round(x) * grid)}px, ${r2(Math.round(y) * grid)}px) scale(${r2(scale)})`};
}

/** Style each word element (in plan.words order) for story time t (HyperFrames; Remotion renders vfxWordAt itself). */
export function paintVfxWords(nodes, plan, t) {
  plan.words.forEach((word, i) => {
    const node = nodes[i];
    if (!node) return;
    const {opacity, transform} = vfxWordAt(word, t, plan.grid);
    node.style.opacity = opacity;
    node.style.transform = transform;
  });
}
