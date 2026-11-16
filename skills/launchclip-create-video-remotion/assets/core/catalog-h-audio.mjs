// audio-visualizer: the finished sound's spectrum as bars, a mirrored line or
// a ring (docs/IMMERSIVE_SOUND_RFC.md §4). Renderers never analyse audio:
// `launchclip finish` measures the mix and its buses into AUDIO_FEATURES.json
// and attaches the five band series a scene reads as story.audio.features
// (kit/core/audio-react.mjs pickAudioFeatures); this module slices the scene's
// frames into a paint plan, and the frame-pure painter (kit/core/particles.mjs,
// kind "spectrum") draws the same pixels in both renderers. Without features
// the bars rest at their floor.

import {VARIANT_PARAM, createHBase, r2} from './catalog-h-base.mjs';
import {timingRules} from './catalog-b-base.mjs';
import {DATA_TONE, dataTone} from './catalog-h-data.mjs';
import {rgbOf} from './particles.mjs';
import {paintCanvas, plan} from './catalog-i-particles.mjs';

export const VISUALIZER_BANDS = Object.freeze(['sub', 'low', 'mid', 'high', 'air']);
export const VISUALIZER_BUSES = Object.freeze(['mix', 'music', 'voice']);
const VARIANTS = Object.freeze(['bars', 'line', 'ring']);
const at = 'seconds from scene start (optional; else a matching hit, else a default)';

/** The scene's band levels, flat [sub, low, mid, high, air] per video frame from round(start × fps). */
export function visualizerBands(features, bus, start, end) {
  const buses = features?.buses;
  const series = VISUALIZER_BANDS.map(band => buses?.[bus]?.[band] ?? buses?.mix?.[band]);
  if (!series.every(Array.isArray)) return null;
  const fps = Number(features.fps) || 30, f0 = Math.round(start * fps), f1 = Math.min(series[0].length, Math.round(end * fps) + 1);
  const bands = [];
  for (let f = f0; f < f1; f++) for (const values of series) bands.push(values[f] ?? 0);
  return {fps, f0, bands};
}

function resolve(params, ctx) {
  const b = createHBase('audio-visualizer', params, ctx, {allowed: ['bus', 'tone', 'bars', 'at'], variants: VARIANTS});
  const {check, rect} = b;
  const p = b.params;
  const bus = p.bus === undefined ? 'mix' : check.oneOf(p.bus, 'params.bus', VISUALIZER_BUSES);
  const n = p.bars === undefined ? (b.variant === 'ring' ? 72 : b.portrait ? 28 : 48) : check.int(p.bars, 'params.bars', 8, 128);
  const color = dataTone(b, p.tone, 'params.tone', 'accent');
  const startAt = b.timeOf('build', p.at, 'params.at', 0.5);
  b.events.push({id: `${b.id}-build`, name: 'build', time: startAt, endTime: r2(startAt + 0.5), role: 'emphasis'});
  const W = rect.width, H = rect.height;
  // Bars and the line sit in a band across the middle; the ring in a centred square.
  const side = Math.min(W, H) * 0.9;
  const box = b.variant === 'ring' ? {x: r2((W - side) / 2), y: r2((H - side) / 2), w: r2(side), h: r2(side)}
    : {x: r2(W * 0.04), y: r2(H * (b.portrait ? 0.32 : 0.2)), w: r2(W * 0.92), h: r2(H * (b.portrait ? 0.36 : 0.6))};
  const data = visualizerBands(ctx.audio, bus, b.start, b.end) ?? {fps: b.fps, f0: Math.round(b.start * b.fps), bands: []};
  const layer = {kind: 'spectrum', shape: b.variant, box, n, rgb: rgbOf(color), stroke: r2(Math.max(2, b.u(4))), floor: 0.04, seed: 23, at: startAt, ...data};
  return b.finish({variant: b.variant, bus, color, live: data.bands.length > 0, paint: {[`${b.id}-paint`]: plan(b, [layer])}});
}

const view = model => [paintCanvas(model)];
const timeline = () => {};

export const audioVisualizer = {
  id: 'audio-visualizer',
  describe: 'The finished sound drawn live: a spectrum of bars, a mirrored line or a ring of bars, bass to air, moving with the mix (or the music or voice bus) frame by frame. Reads AUDIO_FEATURES.json, which `launchclip finish` writes for any story that uses this module.',
  params: {bus: `which sound: ${VISUALIZER_BUSES.join(' | ')} (default mix)`, tone: `the bars: ${DATA_TONE} (default accent)`, bars: 'how many bars, 8–128 (default 28 portrait, 48 landscape, 72 ring)', at: `bars grow in: ${at}`, variant: VARIANT_PARAM},
  events: ['build'], timing: timingRules({rules: ['the bars grow in over 0.5 s from at, then follow the sound every frame']}), variants: VARIANTS,
  resolve, view, timeline
};

export const AUDIO_MODULES = [audioVisualizer];
