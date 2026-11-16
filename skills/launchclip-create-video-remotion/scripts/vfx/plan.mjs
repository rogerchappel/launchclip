// The VFX plan (docs/VFX_LAYER_RFC.md §3a, §4): every scene's `vfx` cues of a
// resolved story, placed on one art-pixel canvas over the whole frame, plain
// JSON both renderers paint from (kit/core/vfx/paint.mjs).
//
// Art pixels: the frame's short side is 180 art pixels (a 6 px grid at 1080p),
// the size the vendored effects are drawn for. The colour and light canvases
// are that small and scaled up nearest-neighbour (the `pixel` render; the
// `smooth` painter is phase 3 of the RFC).
import {hashUnit} from '../fluid-motion.mjs';
import {VFX_EFFECTS, VFX_MODULES} from './catalog.mjs';

/** Stacking: over the scenes and the light's over group, under the dot wipes, light sweeps, frame and captions. */
export const VFX_Z = Object.freeze({hyperframes: 78500, remotion: 47});
/** Art pixels on the frame's short side. */
export const VFX_ART_SHORT = 180;

const r3 = value => Math.round(value * 1000) / 1000;
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hexOf = rgb => `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, k) => hexOf(rgbOf(a).map((v, i) => v + (rgbOf(b)[i] - v) * k));

/**
 * An 8-step ramp, dark to bright, for one brand colour: shadows mixed from
 * the background up to the colour, then highlights up to white (the order
 * every vendored effect's palette follows; resolveOptions resamples it).
 */
export function rampOf(color, bg = '#000000') {
  return [mix(bg, color, 0.35), mix(bg, color, 0.6), mix(bg, color, 0.82), color, mix(color, '#ffffff', 0.25), mix(color, '#ffffff', 0.5), mix(color, '#ffffff', 0.75), '#ffffff'];
}

/**
 * The plan for a resolved story (every cue's `at` in story seconds), or null
 * when no scene has cues: {aw, ah, grid, cues: [{effect, start, end, x, y,
 * seed, palette?, flip?, angle?, light?}]}, x and y in art pixels, start and
 * end in story seconds (a one-shot ends after its duration, a loop with its
 * scene).
 */
export function vfxPlan(story) {
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  const grid = Math.max(1, Math.round(Math.min(width, height) / VFX_ART_SHORT));
  const aw = Math.ceil(width / grid), ah = Math.ceil(height / grid);
  const colors = story?.brand?.colors ?? {};
  const cues = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    (Array.isArray(scene?.vfx) ? scene.vfx : []).forEach((cue, index) => {
      const info = VFX_EFFECTS[cue.effect], mod = VFX_MODULES[cue.effect];
      if (!info) throw new Error(`${scene.id}: unknown vfx effect ${JSON.stringify(cue.effect)}`);
      if (typeof cue.at !== 'number') throw new Error(`vfxPlan needs a resolved story; ${scene.id} has an unresolved vfx at ${JSON.stringify(cue.at)}`);
      const start = r3(cue.at - (cue.align === 'start' ? 0 : info.peak));
      const entry = {
        effect: cue.effect,
        start,
        end: r3(mod.meta.loop ? Number(scene.end) : start + mod.meta.duration),
        x: Math.round((cue.x ?? 0.5) * aw),
        y: Math.round((cue.y ?? 0.5) * ah),
        seed: Number.isInteger(cue.seed) ? cue.seed : 1 + Math.floor(hashUnit(`${scene.id}:vfx:${index}`) * 999_983)
      };
      if (cue.color !== undefined) {
        const color = HEX6.test(cue.color) ? cue.color : colors[cue.color];
        if (!HEX6.test(String(color))) throw new Error(`${scene.id}: vfx color ${JSON.stringify(cue.color)} is not a brand colour or #rrggbb`);
        entry.palette = rampOf(color, HEX6.test(String(colors.bg)) ? colors.bg : '#000000');
      }
      if (cue.flip) entry.flip = true;
      if (cue.angle) entry.angle = r3((cue.angle * Math.PI) / 180);
      if (cue.light !== undefined) entry.light = cue.light;
      cues.push(entry);
    });
  }
  return cues.length ? {aw, ah, grid, cues} : null;
}

/** Sound cues for a resolved story's VFX: [{scene_id, at, cue}] at each effect's peak (sfx "auto": its paired family; "none": silent). */
export function vfxSounds(story) {
  const sounds = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    for (const cue of Array.isArray(scene?.vfx) ? scene.vfx : []) {
      const info = VFX_EFFECTS[cue?.effect];
      if (!info || typeof cue.at !== 'number' || cue.sfx === 'none') continue;
      sounds.push({scene_id: scene.id, at: r3(cue.align === 'start' ? cue.at + info.peak : cue.at), cue: cue.sfx === undefined || cue.sfx === 'auto' ? info.sfx : cue.sfx, effect: cue.effect});
    }
  }
  return sounds;
}
