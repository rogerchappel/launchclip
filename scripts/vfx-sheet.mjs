#!/usr/bin/env node
// The VFX contact sheet (docs/VFX_LAYER_RFC.md §4): every catalogued effect
// at six times through its life (one row each), drawn by the same painter and
// fixed-step driver the renderers use, over a dark background, once per
// palette: the effect's own and ramps from two brand colours. The `pixel`
// render, scaled up nearest-neighbour. Further sheets show the screen
// transitions and the weather loops (their own palette and an amber ramp). A human looks at it before a batch of
// effects merges.
//
//   node scripts/vfx-sheet.mjs [--out qa/vfx] [--scale 2]
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VFX_MODULES, VFX_TRANSITIONS, VFX_WEATHER} from '@launchclip/core/vfx/catalog.mjs';
import {rampOf} from '@launchclip/core/vfx/plan.mjs';
import {clearFrame, composite, createFrame, drawVfx, painterFor, resolveOptions} from '@launchclip/core/vfx/driver.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TILE = [304, 256];
const BG = 0xff1a0f0b; // #0b0f1a as RGBA bytes
export const SHEET_TIMES = [0.04, 0.12, 0.25, 0.45, 0.65, 0.85];
export const SHEET_PALETTES = Object.freeze({own: null, amber: rampOf('#fdb022', '#0b0f1a'), cyan: rampOf('#46d4ff', '#0b0f1a')});

const TRANSITION_MODULES = Object.fromEntries(Object.entries(VFX_TRANSITIONS).map(([type, info]) => [type, info.module]));

/** One sheet's RGBA bytes: a row per effect (the cue effects, or the screen transitions on 320 × 180 tiles), a column per time (fractions of its duration). */
export function sheetPixels(palette, modules = VFX_MODULES, size = TILE) {
  const names = Object.keys(modules), [tw, th] = size;
  const width = tw * SHEET_TIMES.length, height = th * names.length;
  const out = new Uint8ClampedArray(width * height * 4), tile = new Uint8ClampedArray(tw * th * 4);
  const frame = createFrame(tw, th);
  names.forEach((name, row) => {
    const mod = modules[name], [w, h] = mod.meta.size, [ox, oy] = mod.meta.origin;
    const opts = resolveOptions(mod.meta, palette ? {seed: 7, palette} : {seed: 7});
    SHEET_TIMES.forEach((k, col) => {
      clearFrame(frame);
      drawVfx(painterFor(frame).place(Math.round((tw - w) / 2) + ox, Math.round((th - h) / 2) + oy), mod, opts, Math.round(k * mod.meta.duration * 120) / 120, `sheet:${name}`);
      composite(frame, tile, BG);
      for (let y = 0; y < th; y += 1) out.set(tile.subarray(y * tw * 4, (y + 1) * tw * 4), ((row * th + y) * width + col * tw) * 4);
    });
  });
  return {width, height, data: out};
}

function writePng({width, height, data}, file, scale) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', 'pipe:0', '-vf', `scale=${width * scale}:${height * scale}:flags=neighbor`, '-frames:v', '1', file], {input: data});
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${result.stderr}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
  const out = path.resolve(arg('--out', path.join(ROOT, 'qa', 'vfx'))), scale = Number(arg('--scale', 2));
  mkdirSync(out, {recursive: true});
  for (const [name, palette] of Object.entries(SHEET_PALETTES)) {
    const file = path.join(out, `sheet-${name}.png`);
    writePng(sheetPixels(palette), file, scale);
    console.log(`wrote ${file} (rows: ${Object.keys(VFX_MODULES).join(', ')}; columns at ${SHEET_TIMES.join(', ')} of each duration)`);
  }
  const file = path.join(out, 'sheet-transitions.png');
  writePng(sheetPixels(null, TRANSITION_MODULES, [320, 180]), file, scale);
  console.log(`wrote ${file} (rows: ${Object.keys(TRANSITION_MODULES).join(', ')})`);
  for (const [name, palette] of [['own', null], ['amber', SHEET_PALETTES.amber]]) {
    const weather = path.join(out, `sheet-weather-${name}.png`);
    writePng(sheetPixels(palette, VFX_WEATHER, [320, 180]), weather, scale);
    console.log(`wrote ${weather} (rows: ${Object.keys(VFX_WEATHER).join(', ')})`);
  }
}
