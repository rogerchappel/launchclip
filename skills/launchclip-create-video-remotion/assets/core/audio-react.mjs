// Audio-reactive layers: a glow, a level bar and a pulse that move with the
// finished sound. Opt-in per story as audio.react {glow?, bar?, pulse?}, each
// true or {bus?, series?, strength?}. `launchclip finish` measures the final
// mix and its buses once (src/scripts/audio-features.mjs → AUDIO_FEATURES.json)
// and attaches the series these layers read as story.audio.features; this
// file turns them into per-frame [opacity, scaleX, scaleY] for each layer, so
// Remotion and HyperFrames index the same numbers by frame and draw the same
// pixels by construction (docs/IMMERSIVE_SOUND_RFC.md §4). The camera never
// reacts, and nothing here analyses audio.
//
//   glow   the light's key glow (or a top-centre glow in the accent) swells
//          with the music's sub band (kicks);
//   bar    a thin level bar along the bottom edge follows the mix loudness;
//   pulse  a soft ring blooms at the centre on the music's onsets.
//
// The layers sit with the light's over group (LIGHT_Z), screen-blended, under
// the VFX, wipes, medium, brand frame and captions. Without features the
// layers are not drawn.

import { LIGHT_Z, glow, lightPlan, palette, rgba, textSafeAlpha } from './lighting.mjs';

export const AUDIO_REACT_KINDS = Object.freeze(['glow', 'bar', 'pulse']);
export const AUDIO_REACT_BUSES = Object.freeze(['mix', 'music', 'voice']);
export const AUDIO_REACT_SERIES = Object.freeze(['loud', 'sub', 'low', 'mid', 'high', 'air', 'onset']);
export const AUDIO_REACT_DEFAULTS = Object.freeze({
  glow: Object.freeze({ bus: 'music', series: 'sub', strength: 0.6 }),
  bar: Object.freeze({ bus: 'mix', series: 'loud', strength: 0.85 }),
  pulse: Object.freeze({ bus: 'music', series: 'onset', strength: 0.5 })
});
export const AUDIO_REACT_Z = LIGHT_Z;
export const AUDIO_REACT_ID = 'lc-audio-react';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const round = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

/** Errors in an audio.react block ([] when valid or absent). */
export function audioReactErrors(value, path = 'audio.react') {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object {glow?, bar?, pulse?}`];
  const errors = [];
  for (const [kind, spec] of Object.entries(value)) {
    const where = `${path}.${kind}`;
    if (!AUDIO_REACT_KINDS.includes(kind)) { errors.push(`${where} is not a reactive layer; use ${AUDIO_REACT_KINDS.join(', ')}`); continue; }
    if (typeof spec === 'boolean') continue;
    if (!isObject(spec)) { errors.push(`${where} must be true, false or {bus?, series?, strength?}`); continue; }
    if (spec.bus !== undefined && !AUDIO_REACT_BUSES.includes(spec.bus)) errors.push(`${where}.bus must be one of ${AUDIO_REACT_BUSES.join(', ')}`);
    if (spec.series !== undefined && !AUDIO_REACT_SERIES.includes(spec.series)) errors.push(`${where}.series must be one of ${AUDIO_REACT_SERIES.join(', ')}`);
    if (spec.strength !== undefined && !(typeof spec.strength === 'number' && spec.strength >= 0 && spec.strength <= 1)) errors.push(`${where}.strength must be a number from 0 to 1`);
  }
  return errors;
}

/** The {bus, series} pairs a story's audio.react reads (what finish attaches from AUDIO_FEATURES.json). */
export function audioReactNeeds(story) {
  return reactSpecs(story).map(({ bus, series }) => ({ bus, series }));
}

function reactSpecs(story) {
  const react = story?.audio?.react;
  if (!isObject(react)) return [];
  return AUDIO_REACT_KINDS.filter((kind) => react[kind]).map((kind) => ({ kind, ...AUDIO_REACT_DEFAULTS[kind], ...(isObject(react[kind]) ? react[kind] : {}) }));
}

const VISUALIZER_BANDS = ['sub', 'low', 'mid', 'high', 'air'];

/**
 * Every {bus, series} the story reads from AUDIO_FEATURES.json: its
 * audio.react layers and the bands of each audio-visualizer scene
 * (kit/core/catalog-h-audio.mjs). Empty when nothing reacts, so finish skips
 * measuring.
 */
export function audioFeatureNeeds(story) {
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => scene?.module === 'audio-visualizer');
  const bands = scenes.flatMap((scene) => VISUALIZER_BANDS.map((series) => ({ bus: AUDIO_REACT_BUSES.includes(scene.params?.bus) ? scene.params.bus : 'mix', series })));
  return [...audioReactNeeds(story), ...bands];
}

/** Only the series a story reads, from a full AUDIO_FEATURES.json (a missing bus falls back to the mix). */
export function pickAudioFeatures(story, features) {
  if (!features?.buses?.mix) return null;
  const buses = {};
  for (const { bus, series } of audioFeatureNeeds(story)) {
    const from = features.buses[bus]?.[series] ? bus : 'mix';
    (buses[from] ??= {})[series] = features.buses[from][series];
  }
  return { fps: features.fps, frames: features.frames, buses };
}

/**
 * The reactive layers for a story → {id, layers: [{id, kind, style, frames}]}
 * or null. style is the static inline CSS (position, size, background, blend);
 * frames[f] = [opacity, scaleX, scaleY] at feature frame f (fps: the features' rate).
 */
export function audioReactPlan(story) {
  const specs = reactSpecs(story);
  const features = story?.audio?.features;
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!specs.length || !features?.buses || !(W > 0 && H > 0)) return null;
  const colors = palette(story);
  const short = Math.min(W, H);
  const key = lightPlan(story)?.under.find((layer) => layer.id === 'key');
  const layers = [];
  for (const spec of specs) {
    const values = features.buses[spec.bus]?.[spec.series] ?? features.buses.mix?.[spec.series];
    if (!Array.isArray(values)) continue;
    const k = spec.strength;
    if (spec.kind === 'glow') {
      const box = key?.box ?? { x: -0.1 * W, y: -0.45 * H, width: 1.2 * W, height: 0.9 * H };
      const alpha = textSafeAlpha(colors, colors.accent, 0.45);
      layers.push({ id: 'glow', kind: 'glow', style: { left: box.x, top: box.y, width: box.width, height: box.height, transformOrigin: '50% 50%', background: glow(colors.accent, alpha), mixBlendMode: 'screen' },
        frames: values.map((v) => [round(k * v), round(1 + 0.08 * v), round(1 + 0.08 * v)]) });
    } else if (spec.kind === 'bar') {
      const height = Math.max(4, Math.round(H * 0.006));
      layers.push({ id: 'bar', kind: 'bar', style: { left: 0, top: H - height, width: W, height, transformOrigin: '0% 50%', background: colors.accent },
        frames: values.map((v) => [round(k), round(v), 1]) });
    } else {
      const r = Math.round(0.3 * short);
      const alpha = textSafeAlpha(colors, colors.accent, 0.6);
      layers.push({ id: 'pulse', kind: 'pulse', style: { left: W / 2 - r, top: H / 2 - r, width: 2 * r, height: 2 * r, transformOrigin: '50% 50%', borderRadius: '50%', background: `radial-gradient(closest-side, transparent 52%, ${rgba(colors.accent, alpha)} 72%, transparent 100%)`, mixBlendMode: 'screen' },
        frames: values.map((v) => [round(k * v), round(0.85 + 0.3 * v), round(0.85 + 0.3 * v)]) });
    }
  }
  return layers.length ? { id: AUDIO_REACT_ID, fps: Number(features.fps) || 30, layers } : null;
}

/** A layer's [opacity, scaleX, scaleY] at time t (the frame round(t × fps), held at the ends). */
export function audioReactValues(layer, t, fps) {
  const f = Math.max(0, Math.min(layer.frames.length - 1, Math.round(t * fps)));
  return layer.frames[f] ?? [0, 1, 1];
}

/** A layer's inline style at time t (both renderers). */
export function audioReactStyle(layer, t, fps) {
  const [opacity, sx, sy] = audioReactValues(layer, t, fps);
  return { position: 'absolute', pointerEvents: 'none', ...layer.style, opacity, transform: `scale(${sx}, ${sy})` };
}

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const UNITLESS = new Set(['opacity']);

/** The same style as inline CSS text (HyperFrames markup). */
export function audioReactCss(layer, t, fps) {
  return Object.entries(audioReactStyle(layer, t, fps)).map(([key, value]) => `${kebab(key)}:${typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : value}`).join(';');
}
