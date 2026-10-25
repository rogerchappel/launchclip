// Sonic palettes: the timbre every effect family is drawn in. A family
// builder reads these numbers (pitch, envelopes, waveform, material, noise
// colour) and the palette adds its own finishing chain (band limits, drive,
// bit-crush, tape wobble, chorus) and its room (a convolution reverb from a
// synthetic impulse response), so a whoosh in "organic" and a whoosh in
// "retro-8bit" are different sounds.
//
// Fields:
//   pitch      multiplier on every tonal frequency
//   decay      multiplier on envelope tails
//   attack     multiplier on attack times (soft swells > 1)
//   wave       tonal waveform (dsp.mjs wave(): sine, triangle, square, pulse, saw, soft-saw, fm)
//   material   resonant body partials: glass, metal, wood, rubber, chip, string
//   bright     multiplier on noise band centres and the tick register
//   body       weight of low thumps and subs (0..1)
//   air        weight of breathy high noise (0..1)
//   bend       springiness of pitch (0 none, 1 cartoon)
//   scale      semitone steps melodic cues draw notes from
//   root       base frequency of melodic cues (Hz)
//   band       [highpass, lowpass] of the finishing chain
//   drive      soft saturation (0..1)
//   crush      {bits, samples} bit and sample-rate reduction, or null
//   wobble     {f, d} tape wow (vibrato), or null
//   chorus     true for a gentle stereo chorus
//   space      {seconds, tone, mix} the room's tail length, darkness and wet level, or null
import { SOUND_PALETTES } from './options.mjs';

export const MATERIALS = Object.freeze({
  // Partial ratios and relative decays of a struck body.
  glass: { ratios: [1, 2.32, 4.25, 6.63], decays: [1, 0.7, 0.45, 0.3], gains: [1, 0.45, 0.25, 0.12] },
  metal: { ratios: [1, 1.58, 2.31, 3.17, 4.53], decays: [1, 0.8, 0.6, 0.45, 0.3], gains: [1, 0.7, 0.5, 0.35, 0.2] },
  wood: { ratios: [1, 2.57, 4.1], decays: [1, 0.35, 0.2], gains: [1, 0.35, 0.15] },
  rubber: { ratios: [1, 2, 3], decays: [1, 0.6, 0.35], gains: [1, 0.3, 0.1] },
  chip: { ratios: [1], decays: [1], gains: [1] },
  string: { ratios: [1, 2, 3, 4, 5], decays: [1, 0.75, 0.55, 0.4, 0.3], gains: [1, 0.5, 0.33, 0.2, 0.12] }
});

const MAJOR_PENT = [0, 2, 4, 7, 9, 12, 14, 16];
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 14];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11, 12, 14];
const MINOR_PENT = [0, 3, 5, 7, 10, 12, 15];
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12, 14];

export const PALETTES = Object.freeze({
  // The neutral timbre new families use when no palette is set; the
  // historic families keep their own fixed sounds then.
  default: { pitch: 1, decay: 1, attack: 1, wave: 'sine', material: 'glass', bright: 1, body: 0.5, air: 0.5, bend: 0, scale: MAJOR_PENT, root: 880, band: [60, 13000], drive: 0, crush: null, wobble: null, chorus: false, space: { seconds: 0.6, tone: 6000, mix: 0.12 } },
  cinematic: { pitch: 0.7, decay: 1.5, attack: 1.2, wave: 'soft-saw', material: 'metal', bright: 0.8, body: 1, air: 0.6, bend: 0, scale: MINOR_PENT, root: 440, band: [28, 12000], drive: 0.12, crush: null, wobble: null, chorus: false, space: { seconds: 2.4, tone: 4500, mix: 0.32 } },
  glassy: { pitch: 1.45, decay: 1.15, attack: 1, wave: 'sine', material: 'glass', bright: 1.35, body: 0.2, air: 0.8, bend: 0, scale: LYDIAN, root: 1046.5, band: [220, 16000], drive: 0, crush: null, wobble: null, chorus: false, space: { seconds: 1.3, tone: 9000, mix: 0.24 } },
  organic: { pitch: 0.85, decay: 0.8, attack: 1.2, wave: 'triangle', material: 'wood', bright: 0.7, body: 0.65, air: 0.55, bend: 0, scale: MAJOR_PENT, root: 523.25, band: [70, 8500], drive: 0.04, crush: null, wobble: null, chorus: false, space: { seconds: 0.35, tone: 3800, mix: 0.14 } },
  cartoon: { pitch: 1.2, decay: 0.9, attack: 1, wave: 'triangle', material: 'rubber', bright: 0.95, body: 0.5, air: 0.35, bend: 1, scale: MAJOR, root: 659.25, band: [90, 11000], drive: 0, crush: null, wobble: null, chorus: false, space: { seconds: 0.3, tone: 5000, mix: 0.08 } },
  lofi: { pitch: 0.9, decay: 1, attack: 1.3, wave: 'fm', material: 'wood', bright: 0.6, body: 0.55, air: 0.4, bend: 0, scale: DORIAN, root: 587.33, band: [130, 5200], drive: 0.28, crush: { bits: 12, samples: 1 }, wobble: { f: 4.2, d: 0.035 }, chorus: false, space: { seconds: 0.7, tone: 2800, mix: 0.18 } },
  'retro-8bit': { pitch: 1.1, decay: 0.7, attack: 0.6, wave: 'square', material: 'chip', bright: 1, body: 0.45, air: 0.25, bend: 0.4, scale: MAJOR, root: 784, band: [140, 9000], drive: 0, crush: { bits: 6, samples: 2 }, wobble: null, chorus: false, space: null },
  analog: { pitch: 0.95, decay: 1.1, attack: 1, wave: 'saw', material: 'string', bright: 0.8, body: 0.6, air: 0.45, bend: 0.15, scale: MAJOR_PENT, root: 523.25, band: [50, 9000], drive: 0.32, crush: null, wobble: { f: 0.9, d: 0.012 }, chorus: false, space: { seconds: 0.9, tone: 4800, mix: 0.2 } },
  minimal: { pitch: 1.2, decay: 0.45, attack: 0.7, wave: 'sine', material: 'glass', bright: 1.1, body: 0.3, air: 0.25, bend: 0, scale: MAJOR_PENT, root: 1174.66, band: [300, 15000], drive: 0, crush: null, wobble: null, chorus: false, space: null },
  documentary: { pitch: 0.9, decay: 0.9, attack: 1, wave: 'triangle', material: 'wood', bright: 0.85, body: 0.6, air: 0.5, bend: 0, scale: MAJOR_PENT, root: 659.25, band: [60, 10500], drive: 0, crush: null, wobble: null, chorus: false, space: { seconds: 0.28, tone: 5500, mix: 0.12 } },
  synthwave: { pitch: 1, decay: 1.2, attack: 1, wave: 'saw', material: 'string', bright: 1, body: 0.7, air: 0.55, bend: 0.1, scale: MINOR_PENT, root: 659.25, band: [40, 12000], drive: 0.18, crush: null, wobble: null, chorus: true, space: { seconds: 1.5, tone: 6500, mix: 0.28 } },
  soft: { pitch: 1.05, decay: 1.1, attack: 2.2, wave: 'sine', material: 'glass', bright: 0.65, body: 0.4, air: 0.3, bend: 0, scale: MAJOR_PENT, root: 783.99, band: [90, 7000], drive: 0, crush: null, wobble: null, chorus: false, space: { seconds: 1, tone: 4200, mix: 0.24 } },
  industrial: { pitch: 0.8, decay: 0.9, attack: 0.8, wave: 'pulse', material: 'metal', bright: 1.1, body: 0.85, air: 0.5, bend: 0, scale: MINOR_PENT, root: 392, band: [45, 12500], drive: 0.5, crush: null, wobble: null, chorus: false, space: { seconds: 0.55, tone: 7500, mix: 0.2 } }
});

for (const id of SOUND_PALETTES) if (!PALETTES[id]) throw new Error(`sound palette ${id} has no timbre`);

export function palette(id) {
  const entry = PALETTES[id ?? 'default'];
  if (!entry) throw new Error(`Unknown sound palette "${id}". Palettes: ${SOUND_PALETTES.join(', ')}`);
  return { id: id ?? 'default', ...entry };
}

/** The palette's finishing chain (after a family's own master), as an FFmpeg filter string. */
export function paletteChain(T) {
  const parts = [];
  if (T.wobble) parts.push(`vibrato=f=${T.wobble.f}:d=${T.wobble.d}`);
  if (T.drive > 0) parts.push(`volume=${(1 + T.drive * 5).toFixed(2)},asoftclip=type=tanh:oversample=2,volume=${(1 / (1 + T.drive * 2.5)).toFixed(3)}`);
  if (T.crush) parts.push(`acrusher=bits=${T.crush.bits}:samples=${T.crush.samples}:mode=lin:aa=1:mix=0.85`);
  if (T.chorus) parts.push('chorus=0.7:0.9:42|57:0.32|0.26:0.3|0.42:1.6|2.1');
  parts.push(`highpass=f=${T.band[0]},lowpass=f=${T.band[1]}`);
  return parts.join(',');
}
