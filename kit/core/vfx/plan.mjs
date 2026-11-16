// The VFX plan (docs/VFX_LAYER_RFC.md §3a, §4): every scene's `vfx` cues of a
// resolved story, placed on one art-pixel canvas over the whole frame, plain
// JSON both renderers paint from (kit/core/vfx/paint.mjs).
//
// Art pixels: the frame's short side is 180 art pixels (a 6 px grid at 1080p),
// the size the vendored effects are drawn for. The colour and light canvases
// are that small and scaled up nearest-neighbour (the `pixel` render; the
// `smooth` painter is phase 3 of the RFC).
import {hashUnit} from '../fluid-motion.mjs';
import {captionBandFor} from '../captions.mjs';
import {brandFontStacks} from '../fonts.mjs';
import {VFX_COVER_TRANSITIONS, sceneWindows} from '../transitions.mjs';
import {VFX_EFFECTS, VFX_MODULES, VFX_TRANSITIONS, VFX_WORDS} from './catalog.mjs';

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
 * seed, palette?, flip?, angle?, light?, opts?, words?}], words: [...]}, x
 * and y in art pixels, start and end in story seconds (a one-shot ends after
 * its duration, a loop with its scene). A hit with words (VFX_WORDS) gets its
 * effect options in `opts`; unless the story keeps pixel words (vfx.words
 * "pixel"), `words: false` tells the painter to leave the pixel word out and
 * each of its lines joins `words`: {text, x, y, size (art pixels), start,
 * enter, exit, in, out, shake?, seed, color, shadow, font}.
 */
export function vfxPlan(story) {
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  const grid = Math.max(1, Math.round(Math.min(width, height) / VFX_ART_SHORT));
  const aw = Math.ceil(width / grid), ah = Math.ceil(height / grid);
  const colors = story?.brand?.colors ?? {};
  const pixelWords = story?.vfx?.words === 'pixel';
  const font = brandFontStacks(story?.brand).display;
  const cues = [], words = [];
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
      const spec = VFX_WORDS[cue.effect];
      if (spec) {
        const fields = Object.fromEntries(Object.entries(spec.fields).map(([key, fallback]) => [key, typeof cue[key] === 'string' && cue[key] ? cue[key] : fallback]));
        entry.opts = spec.options(fields);
        if (!pixelWords) {
          entry.words = false;
          const ramp = entry.palette ?? mod.meta.options.palette, fill = ramp[Math.round((ramp.length - 1) * 0.85)];
          for (const line of spec.lines) {
            const word = {text: line.text.replace(/\{(\w+)\}/g, (_, key) => fields[key]), x: entry.x + line.dx, y: entry.y + line.dy, size: line.size, start, enter: line.enter, exit: line.exit, in: line.in, out: line.out, seed: entry.seed, color: fill, shadow: ramp[0], font};
            if (line.shake) word.shake = line.shake;
            words.push(word);
          }
        }
      }
      cues.push(entry);
    });
  }
  cues.push(...transitionCues(story, aw, ah, colors));
  return cues.length ? {aw, ah, grid, cues, words} : null;
}

/** The VFX covers among a story's transitions: [{type, sceneId, start, dur, color?}] (plates and the loop ending). */
export function vfxTransitions(story) {
  const covers = scene => VFX_COVER_TRANSITIONS.includes(scene?.in?.type);
  if (!(Array.isArray(story?.scenes) && story.scenes.some(covers)) && !covers(story?.ending)) return [];
  const windows = sceneWindows(story), out = [];
  for (const entry of [...windows.scenes, ...(windows.loop ? [{...windows.loop, plate: true, id: `${windows.loop.sceneId}-loop`, scene: {in: story.ending.in}}] : [])]) {
    const type = entry.transitionIn?.type;
    if (!entry.plate || !VFX_COVER_TRANSITIONS.includes(type) || !(entry.transitionIn.dur > 0)) continue;
    out.push({type, sceneId: entry.id, start: entry.start, dur: entry.transitionIn.dur, color: entry.scene?.in?.color});
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * When a VFX cover transition hides the frame, in story seconds: {start,
 * full: [from, to], end}. The effect runs from start to end and covers every
 * pixel over `full` (the plan's timing; kit/core/transition-frames.mjs reads it).
 */
export function vfxCoverSpan(type, start, dur) {
  const info = VFX_TRANSITIONS[type], D = info.module.meta.duration, speed = D / dur, middle = (info.cover[0] + info.cover[1]) / 2;
  const from = start + dur / 2 - middle / speed;
  return {start: from, full: [from + info.cover[0] / speed, from + info.cover[1] / speed], end: from + D / speed};
}

/**
 * Plan cues for the VFX covers: each effect sped up to fit its whole life
 * into the transition, the middle of its full cover on the midpoint (where
 * the plates swap). The 320 × 180 screen sits centred on the art canvas,
 * turned a quarter for a portrait frame (`quarter`).
 */
function transitionCues(story, aw, ah, colors) {
  return vfxTransitions(story).map(transition => {
    const info = VFX_TRANSITIONS[transition.type], D = info.module.meta.duration, speed = D / transition.dur;
    const start = r3(vfxCoverSpan(transition.type, transition.start, transition.dur).start);
    const portrait = ah > aw;
    const entry = {
      effect: transition.type,
      start,
      end: r3(start + D / speed),
      speed: Math.round(speed * 1e6) / 1e6,
      x: portrait ? Math.round((aw + 180) / 2) : Math.round((aw - 320) / 2),
      y: portrait ? Math.round((ah - 320) / 2) : Math.round((ah - 180) / 2),
      seed: 1 + Math.floor(hashUnit(`${transition.sceneId}:in`) * 999_983),
      // the cover: a #rrggbb or a brand colour by name, by default the brand's ink (a near-black without one)
      opts: {color: [transition.color, colors[transition.color], colors[transition.color === undefined ? 'ink' : '']].find(c => HEX6.test(String(c))) ?? '#0b0a10'}
    };
    const glow = [colors.accent, colors.primary].find(c => HEX6.test(String(c)));
    if (info.brand && glow) entry.palette = rampOf(glow, HEX6.test(String(colors.bg)) ? colors.bg : '#000000');
    if (portrait) entry.quarter = true;
    return entry;
  });
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
    // a VFX cover transition: its paired sound as it starts to cover
    const cover = VFX_TRANSITIONS[scene?.in?.type];
    if (cover && typeof scene.start === 'number') sounds.push({scene_id: scene.id, at: r3(scene.start), cue: cover.sfx, effect: scene.in.type});
  }
  return sounds;
}

/** Cue rules (docs/VFX_LAYER_RFC.md §4): at most this many effect peaks in any `window` seconds; one hit with words a scene is a planner rule only. */
export const VFX_CUE_RULES = Object.freeze({crowd: 3, window: 1, words: 1});

/**
 * The cue rules for a resolved story, as motion-check findings ({rule,
 * severity, at, ids, detail}), all warnings: vfx-crowd (more than three
 * effect peaks within 1 s) and vfx-over-caption (an effect centred in the caption band of a captioned story).
 */
export function vfxCueFindings(story) {
  const findings = [], peaks = [];
  // shortcut: the default caption band; a story that moves its captions (top, lower-third) is not followed yet
  const band = captionBandFor(story?.format), captioned = Array.isArray(story?.overlays) && story.overlays.some(overlay => overlay?.type === 'captions');
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    const cues = (Array.isArray(scene?.vfx) ? scene.vfx : []).filter(cue => VFX_EFFECTS[cue?.effect] && typeof cue.at === 'number');
    for (const cue of cues) {
      const at = r3(cue.align === 'start' ? cue.at + VFX_EFFECTS[cue.effect].peak : cue.at);
      peaks.push({at, id: scene.id, effect: cue.effect});
      const y = cue.y ?? 0.5;
      if (captioned && y > band.top && y < band.top + band.height) findings.push({rule: 'vfx-over-caption', severity: 'warning', at, ids: [scene.id], detail: `${scene.id}: ${cue.effect} is centred in the caption band (y ${y}); move it above ${band.top} or below ${r3(band.top + band.height)}`});
    }
  }
  peaks.sort((a, b) => a.at - b.at);
  for (let i = 0; i + VFX_CUE_RULES.crowd < peaks.length; i += 1) {
    const run = peaks.slice(i, i + VFX_CUE_RULES.crowd + 1);
    if (run.at(-1).at - run[0].at > VFX_CUE_RULES.window + 1e-9) continue;
    findings.push({rule: 'vfx-crowd', severity: 'warning', at: run[0].at, ids: [...new Set(run.map(peak => peak.id))], detail: `${run.length} effects peak within ${VFX_CUE_RULES.window} s (${run.map(peak => `${peak.effect} ${peak.at}s`).join(', ')}); at most ${VFX_CUE_RULES.crowd}, so each one reads`});
    i += VFX_CUE_RULES.crowd; // one finding per crowd
  }
  return findings;
}
