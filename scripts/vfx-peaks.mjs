#!/usr/bin/env node
// Measures each VFX effect's peak: seconds from its start to its brightest
// frame (the most light added; an effect with no light, its most colour),
// sampled at 60 fps with
// its default options, and each screen transition's full cover. The catalogue (kit/core/vfx/catalog.mjs VFX_EFFECTS)
// stores the result; test/vfx_layer.test.js fails when one drifts.
//
//   node scripts/vfx-peaks.mjs
import {fileURLToPath} from 'node:url';
import {VFX_MODULES, VFX_TRANSITIONS} from '@launchclip/core/vfx/catalog.mjs';
import {clearFrame, createFrame, drawVfx, painterFor, resolveOptions} from '@launchclip/core/vfx/driver.mjs';

/** Seconds to the brightest 60 fps frame of an effect at its default options. */
export function measurePeak(mod) {
  const [w, h] = mod.meta.size, [ox, oy] = mod.meta.origin, opts = resolveOptions(mod.meta, {});
  const frame = createFrame(w, h);
  const light = [], color = [];
  for (let f = 0; f / 60 < mod.meta.duration; f += 1) {
    clearFrame(frame);
    drawVfx(painterFor(frame).place(ox, oy), mod, opts, f / 60, 'peak');
    let l = 0, c = 0;
    for (let i = 0; i < frame.light.length; i += 1) {
      const lv = frame.light[i], cv = frame.color[i];
      l += (lv & 255) + ((lv >>> 8) & 255) + ((lv >>> 16) & 255);
      c += (((cv & 255) + ((cv >>> 8) & 255) + ((cv >>> 16) & 255)) * (cv >>> 24)) / 255;
    }
    light.push(l); color.push(c);
  }
  const sums = Math.max(...light) > 0 ? light : color;
  return Math.round((sums.indexOf(Math.max(...sums)) / 60) * 1000) / 1000;
}

/** [first, last] second (at 120 steps a second, to the ms) when a screen transition covers every pixel of its 320 × 180 screen. */
export function measureCover(mod) {
  const frame = createFrame(320, 180), opts = resolveOptions(mod.meta, {}), full = [];
  for (let f = 0; f / 120 < mod.meta.duration; f += 1) {
    clearFrame(frame);
    drawVfx(painterFor(frame).place(0, 0), mod, opts, f / 120, 'cover');
    if (frame.color.every(c => c >>> 24)) full.push(f);
  }
  return full.length ? [full[0], full.at(-1)].map(f => Math.round((f / 120) * 1000) / 1000) : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, mod] of Object.entries(VFX_MODULES)) console.log(`${name}: ${measurePeak(mod)}`);
  for (const [type, info] of Object.entries(VFX_TRANSITIONS)) console.log(`${type}: cover ${JSON.stringify(measureCover(info.module))}`);
}
