#!/usr/bin/env node
// Synthesize an original, license-free SFX kit, an optional music bed and an
// optional ambience loop with local FFmpeg only. Nothing is downloaded and no
// provider is called, so the output can ship inside any project.
// Usage:
//   node synth-audio-kit.mjs <out-dir> [--palette <id>] [--seed <s>]
//     [--only whoosh,keystroke] [--with chime,ding]
//     [--bed <seconds>] [--genre <id>] [--bpm 100] [--key A] [--progression 0]
//     [--kick-from <s>] [--kick-to <s>] [--ambience <bed>]
// With no --palette the historic families render exactly as they always
// have; with one, every family is drawn in that palette from the seed. With
// no --genre the bed is the historic pad and kick; with one, it is that
// genre's bed (sound/music.mjs). Option lists: sound/options.mjs.
// Writes <out-dir>/sfx/*.wav, optional <out-dir>/music/bed.wav and
// <out-dir>/ambience/<bed>.wav, and <out-dir>/AUDIO-KIT.json (+ BEATS.json
// when a bed is made).
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { RATE, attack, decay, fmt, glide, layer, noise, rng } from './sound/dsp.mjs';
import { FAMILY_BUILDERS, familySpec } from './sound/families.mjs';
import { palette as paletteTimbre } from './sound/palettes.mjs';
import { AMBIENCE_BEDS, HISTORIC_SFX_FAMILIES, SFX_FAMILY_NAMES, SOUND_PALETTES } from './sound/options.mjs';
import { ambienceSpec } from './sound/ambience.mjs';
import { genreBed } from './sound/music.mjs';

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// SFX kit. Every cue is built from layers: each layer is one aevalsrc source
// (a stereo expression pair) with its own filter chain, gain and start delay,
// and the layers are summed, shaped by a master chain, faded and normalised to
// -3 dBFS peak. Noise comes from FFmpeg's random(k), whose state is seeded per
// variant at sample 0, so every file is deterministic and reproducible.
//
// Families have several variants. Variant 1 keeps the historic file name
// (<family>.wav); further variants are <family>-<n>.wav.

// The expression helpers (noise, glide, envelopes, layer) live in
// sound/dsp.mjs, shared with the palette families.

function keystroke({ seed, click, leaf, thock, body, bottom, plate, clickGain = 0.9, thockGain = 0.85, bottomGain = 0.45, duration = 0.11, rattle = null }) {
  const layers = [
    // Switch click: a very short band-passed noise burst.
    layer(`${noise(0)}*${attack(0.0002)}*${decay(click.decay)}`, { filter: `highpass=f=1500,bandpass=f=${click.freq}:width_type=q:w=0.9`, gain: clickGain * 1.8, seed }),
    // Click leaf ring: a tiny high resonance.
    layer(`sin(2*PI*${leaf}*t)*${decay(0.0016)}*${attack(0.0002)}`, { gain: 0.18, seed }),
    // Thock: the key cap and plate body, a short low pitch drop plus dark noise.
    layer(`(0.75*${glide(thock.from, thock.to, 0.006)}*${decay(body * 0.5)}+0.8*${noise(1)}*${decay(body * 0.4)})*${attack(0.0012)}`, { filter: 'lowpass=f=1500', gain: thockGain, delay: 0.0012, seed }),
    // Plate resonance.
    layer(`sin(2*PI*${plate}*t)*${decay(0.009)}*${attack(0.0005)}`, { gain: 0.1, delay: 0.001, seed }),
    // Bottom-out tick: the stem hitting the housing a few ms after the click.
    layer(`${noise(2)}*${attack(0.0002)}*${decay(0.0014)}`, { filter: 'highpass=f=2200', gain: bottomGain, delay: bottom, seed })
  ];
  if (rattle) layers.push(layer(`${noise(3)}*${attack(0.001)}*${decay(rattle.decay)}`, { filter: `bandpass=f=${rattle.freq}:width_type=q:w=2.5`, gain: rattle.gain, delay: rattle.delay, seed }));
  return { duration, master: 'highpass=f=70,lowpass=f=13000', fade: 0.012, layers };
}

function whoosh({ seed, duration, bands, centres, width, pan = [0.8, 0.2], air = 0.5, phaser = true }) {
  const d = fmt(duration);
  const shape = `pow(sin(PI*min(t/${d},1)),2)`;
  const panL = `(${pan[0]}+${fmt(pan[1] - pan[0])}*t/${d})`;
  const panR = `(${fmt(1 - pan[0])}+${fmt(pan[0] - pan[1])}*t/${d})`;
  const layers = bands.map((freq, index) => {
    const env = `exp(-pow((t-${fmt(centres[index] * duration)})/${fmt(width * duration)},2))*${shape}`;
    return layer(`${noise(index % 8)}*${env}*${panL}`, { right: `${noise((index + 4) % 8)}*${env}*${panR}`, filter: `bandpass=f=${freq}:width_type=q:w=1.1`, gain: 1.2, seed: seed + index });
  });
  layers.push(layer(`${noise(8)}*${shape}*${panL}`, { right: `${noise(9)}*${shape}*${panR}`, filter: 'lowpass=f=260', gain: air, seed: seed + 50 }));
  return { duration, master: `highpass=f=120,lowpass=f=9000${phaser ? ',aphaser=type=t:speed=1.4:decay=0.4' : ''}`, fade: 0.06, layers };
}

function impact({ seed, from, to, body, crack = 900, crackGain = 0.5, tail = 0.12, duration = 1.3 }) {
  return {
    duration,
    master: 'highpass=f=28,lowpass=f=9000,aecho=0.8:0.5:40|85:0.2|0.1',
    fade: 0.2,
    layers: [
      layer(`${glide(from, to, 0.045)}*${decay(body)}*${attack(0.002)}`, { filter: 'lowpass=f=420', gain: 1, seed }),
      layer(`${noise(0)}*${attack(0.0002)}*${decay(0.003)}`, { right: `${noise(1)}*${attack(0.0002)}*${decay(0.003)}`, filter: 'highpass=f=1600', gain: 0.6, seed }),
      layer(`${noise(2)}*${attack(0.0005)}*${decay(0.035)}`, { right: `${noise(3)}*${attack(0.0005)}*${decay(0.035)}`, filter: `bandpass=f=${crack}:width_type=q:w=0.7`, gain: crackGain, seed }),
      layer(`${noise(4)}*${attack(0.01)}*${decay(0.35)}`, { right: `${noise(5)}*${attack(0.01)}*${decay(0.35)}`, filter: 'lowpass=f=1100', gain: tail, seed })
    ]
  };
}

function tick({ seed, f1, f2, decay1 = 0.018, decay2 = 0.012, duration = 0.12 }) {
  return {
    duration,
    master: 'highpass=f=500',
    fade: 0.02,
    layers: [
      layer(`(sin(2*PI*${f1}*t)*${decay(decay1)}+0.4*sin(2*PI*${f2}*t)*${decay(decay2)})*${attack(0.0003)}`, { seed }),
      layer(`${noise(0)}*${attack(0.0002)}*${decay(0.0008)}`, { filter: 'highpass=f=4000', gain: 0.35, seed })
    ]
  };
}

function pop({ seed, from, to, rate, body, duration = 0.18 }) {
  return {
    duration,
    master: 'highpass=f=120',
    fade: 0.03,
    layers: [
      layer(`sin(2*PI*(${to}*t+${fmt((from - to) / rate)}*(1-exp(-${rate}*t))))*${decay(body)}*${attack(0.0008)}`, { seed }),
      layer(`${noise(0)}*${attack(0.0002)}*${decay(0.0015)}`, { filter: 'bandpass=f=2500:width_type=q:w=1', gain: 0.25, seed })
    ]
  };
}

function riser({ seed, duration, base, spread = 1.5, tremolo = 0 }) {
  const d = fmt(duration);
  const k = fmt(Math.log(6) / duration);
  const build = `pow(t/${d},2.4)`;
  const sweep = (f) => `sin(2*PI*${fmt(f)}*(exp(${k}*t)-1)/${k})`;
  const trem = tremolo ? `*(0.6+0.4*sin(2*PI*(${tremolo}*t+${fmt(tremolo * 2)}*t*t)))` : '';
  return {
    duration,
    master: 'highpass=f=150,lowpass=f=11000',
    fade: 0.012,
    layers: [
      layer(`0.55*${sweep(base)}*${build}${trem}`, { right: `0.55*${sweep(base * 1.008)}*${build}${trem}`, seed }),
      layer(`0.3*${sweep(base * spread)}*${build}${trem}`, { right: `0.3*${sweep(base * spread * 1.006)}*${build}${trem}`, seed }),
      layer(`${noise(0)}*pow(t/${d},3)`, { right: `${noise(1)}*pow(t/${d},3)`, filter: 'highpass=f=1800', gain: 0.4, seed }),
      layer(`${noise(2)}*pow(t/${d},4)`, { right: `${noise(3)}*pow(t/${d},4)`, filter: 'bandpass=f=5000:width_type=q:w=0.8', gain: 0.5, seed })
    ]
  };
}

function shimmer({ seed, notes, stagger = 0, duration = 1.6 }) {
  const layers = notes.map((f, index) => layer(`${fmt(0.5 / (1 + index * 0.35))}*(sin(2*PI*${fmt(f)}*t)+0.3*sin(2*PI*${fmt(f * 2.01)}*t)*${decay(0.25)})*${decay(0.38 - index * 0.04)}*${attack(0.002)}`, {
    right: `${fmt(0.5 / (1 + index * 0.35))}*(sin(2*PI*${fmt(f * 1.0012)}*t)+0.3*sin(2*PI*${fmt(f * 2.013)}*t)*${decay(0.25)})*${decay(0.38 - index * 0.04)}*${attack(0.002)}`,
    delay: index * stagger,
    seed
  }));
  layers.push(layer(`${noise(0)}*${attack(0.004)}*${decay(0.18)}`, { right: `${noise(1)}*${attack(0.004)}*${decay(0.18)}`, filter: 'highpass=f=7000', gain: 0.18, seed }));
  return { duration, master: 'aecho=0.8:0.6:70|130:0.3|0.2', fade: 0.3, layers };
}

function subdrop({ seed, from, to, tau, body, harmonics = 0, duration = 1.8 }) {
  return {
    duration,
    master: 'lowpass=f=200',
    fade: 0.3,
    layers: [
      layer(`(${glide(from, to, tau)}+${harmonics}*${glide(from * 2, to * 2, tau)})*${attack(0.02)}*${decay(body)}`, { seed })
    ]
  };
}

function uiClick({ seed, freq, body, noiseFreq = 3500, duration = 0.06 }) {
  return {
    duration,
    master: 'highpass=f=200',
    fade: 0.01,
    layers: [
      layer(`${noise(0)}*${attack(0.0001)}*${decay(0.0009)}`, { filter: `highpass=f=${noiseFreq}`, gain: 0.7, seed }),
      layer(`sin(2*PI*${freq}*t)*${attack(0.0002)}*${decay(0.005)}`, { gain: 0.6, seed }),
      layer(`sin(2*PI*${body}*t)*${attack(0.0005)}*${decay(0.0035)}`, { gain: 0.35, delay: 0.0005, seed })
    ]
  };
}

// Families, in kit order. intent documents when to use them.
export const SFX_FAMILIES = Object.freeze({
  whoosh: { intent: 'spatial travel, push, whip pan', variants: [
    whoosh({ seed: 11, duration: 0.62, bands: [350, 700, 1400, 2800, 5600], centres: [0.2, 0.32, 0.45, 0.55, 0.62], width: 0.22, pan: [0.85, 0.15] }),
    whoosh({ seed: 12, duration: 0.7, bands: [5200, 2600, 1300, 650, 320], centres: [0.25, 0.38, 0.5, 0.62, 0.72], width: 0.2, pan: [0.2, 0.85], air: 0.7 }),
    whoosh({ seed: 13, duration: 0.45, bands: [500, 1200, 3000, 6500], centres: [0.3, 0.42, 0.52, 0.58], width: 0.16, pan: [0.7, 0.3], air: 0.3, phaser: false })
  ] },
  impact: { intent: 'big reveal, law/headline lock, scene slam', variants: [
    impact({ seed: 21, from: 140, to: 44, body: 0.3 }),
    impact({ seed: 22, from: 170, to: 50, body: 0.22, crack: 1300, crackGain: 0.65, tail: 0.08, duration: 1.1 }),
    impact({ seed: 23, from: 110, to: 38, body: 0.38, crack: 650, crackGain: 0.4, tail: 0.16, duration: 1.4 })
  ] },
  riser: { intent: 'tension into a payoff or rehook (ends on the hit)', variants: [
    riser({ seed: 31, duration: 1.4, base: 180 }),
    riser({ seed: 32, duration: 1.4, base: 120, spread: 2, tremolo: 4 })
  ] },
  tick: { intent: 'counter step, data point lands, small UI state change', variants: [
    tick({ seed: 41, f1: 2200, f2: 3300 }),
    tick({ seed: 42, f1: 1750, f2: 2650, decay1: 0.022 }),
    tick({ seed: 43, f1: 2700, f2: 4100, decay1: 0.014, decay2: 0.009, duration: 0.1 })
  ] },
  pop: { intent: 'object or label appears', variants: [
    pop({ seed: 51, from: 260, to: 600, rate: 30, body: 0.042 }),
    pop({ seed: 52, from: 340, to: 820, rate: 38, body: 0.034 }),
    pop({ seed: 53, from: 200, to: 460, rate: 24, body: 0.05, duration: 0.2 })
  ] },
  shimmer: { intent: 'insight, equilibrium, satisfying resolve', variants: [
    shimmer({ seed: 61, notes: [1046.5, 1567.98, 2093] }),
    shimmer({ seed: 62, notes: [1318.51, 1975.53, 2637.02], stagger: 0.06 }),
    shimmer({ seed: 63, notes: [880, 1318.51, 1760, 2217.46], stagger: 0.04, duration: 1.7 })
  ] },
  subdrop: { intent: 'final payoff weight under the last line', variants: [
    subdrop({ seed: 71, from: 75, to: 30, tau: 0.45, body: 0.62 }),
    subdrop({ seed: 72, from: 95, to: 32, tau: 0.3, body: 0.5, harmonics: 0.18, duration: 1.6 })
  ] },
  click: { intent: 'UI click, toggle, button press', variants: [
    uiClick({ seed: 81, freq: 2400, body: 650 }),
    uiClick({ seed: 82, freq: 1900, body: 520, noiseFreq: 3000 }),
    uiClick({ seed: 83, freq: 3100, body: 780, noiseFreq: 4200, duration: 0.05 }),
    uiClick({ seed: 84, freq: 2100, body: 430, noiseFreq: 2600 })
  ] },
  keystroke: { intent: 'one mechanical key press (typing track)', variants: [
    keystroke({ seed: 91, click: { freq: 4200, decay: 0.0024 }, leaf: 5200, thock: { from: 360, to: 190 }, body: 0.016, bottom: 0.008, plate: 1350 }),
    keystroke({ seed: 92, click: { freq: 3700, decay: 0.0028 }, leaf: 4700, thock: { from: 330, to: 175 }, body: 0.018, bottom: 0.0095, plate: 1180 }),
    keystroke({ seed: 93, click: { freq: 4800, decay: 0.002 }, leaf: 5900, thock: { from: 390, to: 215 }, body: 0.013, bottom: 0.007, plate: 1520, clickGain: 1 }),
    keystroke({ seed: 94, click: { freq: 3400, decay: 0.003 }, leaf: 4400, thock: { from: 310, to: 165 }, body: 0.02, bottom: 0.0105, plate: 1090, thockGain: 0.95 }),
    keystroke({ seed: 95, click: { freq: 4500, decay: 0.0022 }, leaf: 5500, thock: { from: 370, to: 200 }, body: 0.015, bottom: 0.0078, plate: 1420, bottomGain: 0.55 }),
    keystroke({ seed: 96, click: { freq: 3950, decay: 0.0026 }, leaf: 5050, thock: { from: 345, to: 182 }, body: 0.017, bottom: 0.0088, plate: 1260, clickGain: 0.8 }),
    keystroke({ seed: 97, click: { freq: 5100, decay: 0.0019 }, leaf: 6100, thock: { from: 400, to: 225 }, body: 0.012, bottom: 0.0065, plate: 1600, thockGain: 0.75 }),
    keystroke({ seed: 98, click: { freq: 3550, decay: 0.0029 }, leaf: 4550, thock: { from: 320, to: 170 }, body: 0.019, bottom: 0.01, plate: 1130, bottomGain: 0.38 })
  ] },
  'keystroke-space': { intent: 'space bar: heavier, longer key with stabiliser rattle', variants: [
    keystroke({ seed: 101, click: { freq: 2600, decay: 0.003 }, leaf: 3600, thock: { from: 260, to: 120 }, body: 0.032, bottom: 0.013, plate: 820, clickGain: 0.6, thockGain: 1, bottomGain: 0.5, duration: 0.16, rattle: { freq: 1700, decay: 0.018, gain: 0.25, delay: 0.004 } }),
    keystroke({ seed: 102, click: { freq: 2900, decay: 0.0028 }, leaf: 3900, thock: { from: 240, to: 112 }, body: 0.036, bottom: 0.0145, plate: 760, clickGain: 0.55, thockGain: 1, bottomGain: 0.55, duration: 0.17, rattle: { freq: 1500, decay: 0.022, gain: 0.3, delay: 0.005 } })
  ] },
  'keystroke-enter': { intent: 'enter/return: a firmer, heavier key', variants: [
    keystroke({ seed: 111, click: { freq: 3800, decay: 0.0028 }, leaf: 4800, thock: { from: 300, to: 155 }, body: 0.027, bottom: 0.011, plate: 980, clickGain: 1, thockGain: 1, bottomGain: 0.6, duration: 0.15, rattle: { freq: 2100, decay: 0.012, gain: 0.18, delay: 0.003 } }),
    keystroke({ seed: 112, click: { freq: 3500, decay: 0.003 }, leaf: 4500, thock: { from: 285, to: 148 }, body: 0.029, bottom: 0.012, plate: 930, clickGain: 0.95, thockGain: 1, bottomGain: 0.65, duration: 0.15, rattle: { freq: 1900, decay: 0.014, gain: 0.2, delay: 0.0035 } })
  ] }
});

/** File name of a family variant (1-based): variant 1 keeps <family>.wav. */
export function variantFileName(family, variant) {
  return variant <= 1 ? `${family}.wav` : `${family}-${variant}.wav`;
}

/** Every kit file: [{name, family, variant, duration, intent, spec}]. */
export const SFX_VARIANTS = Object.freeze(Object.entries(SFX_FAMILIES).flatMap(([family, { intent, variants }]) => variants.map((spec, index) => ({
  name: variantFileName(family, index + 1).replace(/\.wav$/, ''),
  family,
  variant: index + 1,
  duration: spec.duration,
  intent,
  spec
}))));

// The historic cue vocabulary (variant 1 of each original family), kept for
// callers that look a cue up by name.
export const SFX = Object.freeze(Object.fromEntries(['whoosh', 'impact', 'riser', 'tick', 'pop', 'shimmer', 'subdrop'].map((family) => {
  const spec = SFX_FAMILIES[family].variants[0];
  return [family, { duration: spec.duration, intent: SFX_FAMILIES[family].intent, expr: spec.layers.flatMap((entry) => entry.expr), layers: spec.layers, master: spec.master }];
})));

// Palette kits. With a palette, every family (historic and new) is drawn in
// that palette's timbre from the seed: (family, palette, seed) → fresh but
// in-character variants under the same file names. With no palette the
// historic families keep their fixed sounds above, and the newer families
// render in the neutral "default" timbre.
export const DEFAULT_KIT_SEED = 'launchclip';

/**
 * The kit's files: [{name, family, variant, duration, intent, spec}].
 * palette: a SOUND_PALETTES id or null; seed: the variant seed;
 * families: the families to render (default: every family with a palette,
 * the historic kit without one).
 */
export function kitVariants({ palette = null, seed = DEFAULT_KIT_SEED, families = null } = {}) {
  if (palette && !SOUND_PALETTES.includes(palette)) throw new Error(`Unknown sound palette "${palette}". Palettes: ${SOUND_PALETTES.join(', ')}`);
  const wanted = families ?? (palette ? SFX_FAMILY_NAMES : HISTORIC_SFX_FAMILIES);
  const unknown = wanted.filter((family) => !SFX_FAMILY_NAMES.includes(family));
  if (unknown.length) throw new Error(`Unknown SFX famil${unknown.length === 1 ? 'y' : 'ies'} ${unknown.join(', ')}. Families: ${SFX_FAMILY_NAMES.join(', ')}`);
  const timbre = paletteTimbre(palette ?? 'default');
  const entries = [];
  for (const family of SFX_FAMILY_NAMES) {
    if (!wanted.includes(family)) continue;
    if (!palette && SFX_FAMILIES[family]) {
      entries.push(...SFX_VARIANTS.filter((entry) => entry.family === family));
      continue;
    }
    const { intent, variants } = FAMILY_BUILDERS[family];
    for (let variant = 1; variant <= variants; variant++) {
      const spec = familySpec(family, timbre, rng(`${seed}|${timbre.id}|${family}|${variant}`), rng(`${seed}|${timbre.id}|kit`));
      entries.push({ name: variantFileName(family, variant).replace(/\.wav$/, ''), family, variant, duration: spec.duration, intent, spec });
    }
  }
  return entries;
}

const KEYS = { C: 130.81, D: 146.83, E: 164.81, F: 174.61, G: 196, A: 110 };
// i - VI - III - VII in a minor key, written as semitone offsets from the tonic.
const PROGRESSION = [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 10]];

export function bedExpressions({ seconds, bpm = 100, key = 'A', kickFrom = 0, kickTo = seconds }) {
  const root = KEYS[key] ?? KEYS.A;
  const beat = 60 / bpm;
  const chordLength = beat * 8;
  const cycle = chordLength * PROGRESSION.length;
  const terms = [];
  PROGRESSION.forEach((chord, index) => {
    const start = index * chordLength;
    // Smooth 0.35s cross-fade window for this chord inside each progression cycle.
    const local = `mod(t,${cycle.toFixed(4)})-${start.toFixed(4)}`;
    const window = `(clip((${local})/0.35+1,0,1)*clip((${chordLength.toFixed(4)}-(${local}))/0.35,0,1))`;
    const voices = chord.map((semi) => {
      const f = root * 2 ** (semi / 12);
      return `sin(2*PI*${f.toFixed(3)}*t)+sin(2*PI*${(f * 1.0045).toFixed(3)}*t)+0.35*sin(2*PI*${(f * 2.002).toFixed(3)}*t)`;
    }).join('+');
    terms.push(`${window}*(${voices})`);
  });
  const swell = `(0.55+0.45*sin(2*PI*t/${(beat * 4).toFixed(4)}-PI/2)*0.5+0.225)`;
  const fade = `min(t/1.2,1)*clip((${seconds}-t)/1.6,0,1)`;
  const pad = `0.11*${fade}*${swell}*(${terms.join('+')})`;
  const tb = `mod(t,${beat.toFixed(5)})`;
  const gate = `between(t,${kickFrom},${kickTo})`;
  const kick = `0.5*${gate}*sin(2*PI*(48*${tb}+90*(1-exp(-28*${tb}))/28))*exp(-8*${tb})*min(${tb}/0.003,1)`;
  const th = `mod(t+${(beat / 2).toFixed(5)},${beat.toFixed(5)})`;
  const hat = `0.16*${gate}*(random(0)*2-1)*exp(-70*${th})`;
  return { pad, kick, hat, beat };
}

async function ffmpeg(args) {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
}

async function peakNormalize(input, output, peakDb) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', input, '-af', 'astats=measure_overall=Peak_level:measure_perchannel=0', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const peak = Number(stderr.match(/Peak level dB:\s*(-?[\d.]+)/)?.[1] ?? 0);
  await ffmpeg(['-i', input, '-af', `volume=${(peakDb - peak).toFixed(2)}dB`, '-ar', String(RATE), '-ac', '2', '-c:a', 'pcm_s16le', output]);
  return peakDb;
}

/**
 * The filter graph that sums a cue's layers into [out]. A cue with a room
 * (spec.space) takes one more input, its impulse response, and mixes a
 * convolution reverb under the dry sound.
 */
export function cueGraph(spec) {
  const parts = spec.layers.map((entry, index) => {
    const delay = Math.round(entry.delay * RATE);
    return `[${index}]${entry.filter},volume=${entry.gain}${delay > 0 ? `,adelay=${delay}S:all=1` : ''}[l${index}]`;
  });
  const fadeStart = Math.max(0, spec.duration - spec.fade);
  const sum = `${spec.layers.map((_, index) => `[l${index}]`).join('')}amix=inputs=${spec.layers.length}:normalize=0,${spec.master}`;
  const tail = `atrim=0:${spec.duration},afade=t=out:st=${fadeStart.toFixed(4)}:d=${spec.fade.toFixed(4)}[out]`;
  if (!spec.space) {
    parts.push(`${sum},${tail}`);
    return parts.join(';');
  }
  const ir = spec.layers.length;
  parts.push(`${sum},asplit=2[dry][send]`);
  parts.push(`[${ir}]highpass=f=180,lowpass=f=${spec.space.tone}[ir]`);
  parts.push(`[send][ir]afir=irnorm=2,volume=${fmt(spec.space.mix * 0.5)}[wet]`);
  parts.push(`[dry][wet]amix=inputs=2:normalize=0:duration=first,${tail}`);
  return parts.join(';');
}

/** The aevalsrc of a room's impulse response: decorrelated noise with an RT60 of `seconds`. */
export function roomImpulse(space, seed = 1) {
  const tau = fmt(space.seconds / 6.9);
  const room = layer(`${noise(0)}*exp(-t/${tau})*min(t/0.004,1)`, { right: `${noise(1)}*exp(-t/${tau})*min(t/0.004,1)`, seed });
  return `aevalsrc=exprs='${room.expr.join('|')}':s=${RATE}:d=${fmt(space.seconds)}`;
}

async function synthCue(entry, directory) {
  const { spec } = entry;
  const raw = path.join(directory, `.${entry.name}.raw.wav`);
  const output = path.join(directory, `${entry.name}.wav`);
  const inputs = spec.layers.flatMap((layerSpec) => ['-f', 'lavfi', '-i', `aevalsrc=exprs='${layerSpec.expr.join('|')}':s=${RATE}:d=${spec.duration}`]);
  if (spec.space) inputs.push('-f', 'lavfi', '-i', roomImpulse(spec.space, entry.variant * 31 + entry.name.length));
  await ffmpeg([...inputs, '-filter_complex', cueGraph(spec), '-map', '[out]', '-ac', '2', raw]);
  await peakNormalize(raw, output, -3);
  await run('rm', ['-f', raw]);
  return { name: entry.name, family: entry.family, variant: entry.variant, file: output, duration_seconds: spec.duration, intent: entry.intent };
}

/** Integrated loudness (LUFS) of a file, by ebur128. */
async function measureLufs(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const value = Number(stderr.slice(stderr.lastIndexOf('Summary:')).match(/I:\s*(-?[\d.]+) LUFS/)?.[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Bring a file to `lufs` integrated loudness as 16-bit stereo. A plain gain
 * (no limiter: its look-ahead would shift a loop and click at the seam).
 */
async function loudnessNormalize(input, output, lufs) {
  const measured = await measureLufs(input);
  const gain = measured === null ? 0 : lufs - measured;
  await ffmpeg(['-i', input, '-af', `volume=${gain.toFixed(2)}dB`, '-ar', String(RATE), '-ac', '2', '-c:a', 'pcm_s16le', output]);
  return { measured, gain };
}

// Ambience beds play far under narration; they are normalised to this
// loudness so every bed sits at the same level in the mix.
export const AMBIENCE_LUFS = -26;

/**
 * The filter graph of an ambience bed: layers summed (plus the room), then
 * the overhang past `seconds` cross-faded (equal power) over the head, so
 * the file loops seamlessly.
 */
export function ambienceGraph(spec) {
  const L = spec.seconds;
  const X = spec.crossfade;
  const parts = spec.layers.map((entry, index) => `[${index}]${entry.filter},volume=${entry.gain}[l${index}]`);
  const sum = `${spec.layers.map((_, index) => `[l${index}]`).join('')}amix=inputs=${spec.layers.length}:normalize=0,${spec.master}`;
  if (spec.space) {
    const ir = spec.layers.length;
    parts.push(`${sum},asplit=2[dry][send]`, `[${ir}]highpass=f=180,lowpass=f=${spec.space.tone}[ir]`, `[send][ir]afir=irnorm=2,volume=${fmt(spec.space.mix * 0.5)}[wet]`, '[dry][wet]amix=inputs=2:normalize=0:duration=first[sum]');
  } else parts.push(`${sum}[sum]`);
  parts.push(
    '[sum]asplit=3[a][b][c]',
    `[a]atrim=0:${X},asetpts=PTS-STARTPTS,afade=t=in:d=${X}:curve=qsin[head]`,
    `[b]atrim=${L}:${L + X},asetpts=PTS-STARTPTS,afade=t=out:d=${X}:curve=qsin[over]`,
    '[head][over]amix=inputs=2:normalize=0[joined]',
    `[c]atrim=${X}:${L},asetpts=PTS-STARTPTS[body]`,
    '[joined][body]concat=n=2:v=0:a=1[out]'
  );
  return parts.join(';');
}

/** Render one ambience bed loop to <directory>/<name>.wav. */
export async function synthAmbience(name, directory, { seed = DEFAULT_KIT_SEED } = {}) {
  const spec = ambienceSpec(name, seed);
  await mkdir(directory, { recursive: true });
  const raw = path.join(directory, `.${name}.raw.wav`);
  const output = path.join(directory, `${name}.wav`);
  const length = spec.seconds + spec.crossfade;
  const inputs = spec.layers.flatMap((entry) => ['-f', 'lavfi', '-i', `aevalsrc=exprs='${entry.expr.join('|')}':s=${RATE}:d=${length}`]);
  if (spec.space) inputs.push('-f', 'lavfi', '-i', roomImpulse(spec.space, name.length * 17));
  await ffmpeg([...inputs, '-filter_complex', ambienceGraph(spec), '-map', '[out]', '-ac', '2', '-c:a', 'pcm_f32le', raw]);
  const level = await loudnessNormalize(raw, output, AMBIENCE_LUFS);
  await run('rm', ['-f', raw]);
  return { name, file: output, loop_seconds: spec.seconds, lufs: AMBIENCE_LUFS, measured_lufs: level.measured, seed };
}

// Genre beds (sound/music.mjs), in two passes. First each stem's cycle is
// rendered on its own and measured, and its gain set so it plays at the
// stem's level (LUFS): every voicing, progression and seed is balanced the
// same way. Then the cycles are looped to the bed's length, shaped by their
// role's envelope (see music.mjs), sent to a convolution room and summed; a
// limiter only guards the peaks.

/** The full-length envelope of a stem role, as an aevalsrc expression. */
export function roleEnvelope(role, { seconds, kickFrom, kickTo, beat, pump = 0 }) {
  const fade = `min(t/1.2,1)*clip((${fmt(seconds)}-t)/1.6,0,1)`;
  const open = kickTo > kickFrom;
  const win = open ? `clip((t-${fmt(kickFrom - 0.03)})/0.03,0,1)*clip((${fmt(kickTo + 0.15)}-t)/0.15,0,1)` : '0';
  if (role === 'drums' || role === 'lead') return `${fade}*${win}`;
  if (role === 'bass') return `${fade}*(0.35+0.65*${win})`;
  if (role === 'pumped' && pump > 0) {
    const m = `mod(t,${fmt(beat)})`;
    return `${fade}*(1-${fmt(pump)}*${win}*exp(-${m}/0.1)*min(${m}/0.004,1))`;
  }
  return fade;
}

/** The filter script that renders one stem's cycle (sources included), output [o]. */
export function stemCycleGraph(bed, entry) {
  return `aevalsrc=exprs='${entry.expr[0]}|${entry.expr[1]}':s=${RATE}:d=${fmt(bed.cycle)},${entry.filter}[o]`;
}

/**
 * The filter script of a genre bed. Inputs 0..n-1 are the stems' cycle files
 * in order; gains[i] is each stem's linear gain. Output [o].
 */
export function genreGraph(bed, { seconds, kickFrom, kickTo, gains }) {
  const total = Math.round(seconds * RATE);
  const cycleSamples = Math.round(bed.cycle * RATE);
  const parts = [];
  const roles = [...new Set(bed.stems.map((entry) => entry.role))];
  roles.forEach((role) => {
    const users = bed.stems.filter((entry) => entry.role === role).length;
    const expr = roleEnvelope(role, { seconds, kickFrom, kickTo, beat: bed.beat, pump: bed.pump });
    parts.push(`aevalsrc=exprs='${expr}|${expr}':s=${RATE}:d=${fmt(seconds)},asplit=${users}${Array.from({ length: users }, (_, i) => `[env-${role}-${i}]`).join('')}`);
  });
  const used = Object.fromEntries(roles.map((role) => [role, 0]));
  const dry = [];
  const sends = [];
  bed.stems.forEach((entry, index) => {
    const envelope = `[env-${entry.role}-${used[entry.role]++}]`;
    const routed = entry.send > 0 && bed.room;
    parts.push(`[${index}]aloop=loop=-1:size=${cycleSamples},atrim=end_sample=${total},asetpts=N/SR/TB[cyc${index}]`);
    parts.push(`[cyc${index}]${envelope}amultiply,volume=${fmt(gains[index])}${routed ? `,asplit=2[dry${index}][snd${index}]` : `[dry${index}]`}`);
    dry.push(`[dry${index}]`);
    if (routed) {
      parts.push(`[snd${index}]volume=${fmt(entry.send)}[send${index}]`);
      sends.push(`[send${index}]`);
    }
  });
  if (bed.crackle > 0) {
    // Faded like the bed: unseeded random() can fire on the very first sample.
    const fade = roleEnvelope('always', { seconds, kickFrom, kickTo, beat: bed.beat });
    parts.push(`aevalsrc=exprs='${fade}*gt(random(0),0.9992)*(2*random(1)-1)|${fade}*gt(random(2),0.9992)*(2*random(3)-1)':s=${RATE}:d=${fmt(seconds)},highpass=f=1500,lowpass=f=6000,volume=${fmt(bed.crackle * 40)}[crackle]`);
    dry.push('[crackle]');
  }
  let inputs = dry.join('');
  let count = dry.length;
  if (sends.length) {
    const tau = fmt(bed.room.seconds / 6.9);
    parts.push(`${sends.join('')}amix=inputs=${sends.length}:normalize=0[sends]`);
    parts.push(`aevalsrc=exprs='(2*random(0)-1)*exp(-t/${tau})*min(t/0.006,1)|(2*random(1)-1)*exp(-t/${tau})*min(t/0.006,1)':s=${RATE}:d=${fmt(bed.room.seconds)},highpass=f=200,lowpass=f=${bed.room.tone}[ir]`);
    parts.push(`[sends][ir]afir=irnorm=2,volume=${fmt(bed.room.mix)}[wet]`);
    inputs += '[wet]';
    count += 1;
  }
  parts.push(`${inputs}amix=inputs=${count}:normalize=0:duration=first,${bed.master},alimiter=limit=0.85:level=0:latency=1,atrim=end_sample=${total}[o]`);
  return parts.join(';\n');
}

/** Render a genre bed to <directory>/bed.wav; returns the BEATS fields. */
export async function synthGenreBed(directory, { seconds, genre, bpm, key, progression, kickFrom = 0, kickTo = seconds, seed = DEFAULT_KIT_SEED }) {
  const bed = genreBed({ genre, bpm, key, progression }, seed);
  const work = path.join(directory, '.stems');
  await mkdir(work, { recursive: true });
  const cycles = await pool(bed.stems, 4, async (entry, index) => {
    const script = path.join(work, `${index}.filtergraph`);
    const file = path.join(work, `${index}-${entry.name}.wav`);
    await writeFile(script, stemCycleGraph(bed, entry));
    await ffmpeg(['-filter_complex_script', script, '-map', '[o]', '-ac', '2', '-c:a', 'pcm_f32le', file]);
    const lufs = await measureLufs(file);
    return { file, gain: lufs === null ? 0 : 10 ** ((entry.level - lufs) / 20) };
  });
  const output = path.join(directory, 'bed.wav');
  const script = path.join(work, 'bed.filtergraph');
  await writeFile(script, genreGraph(bed, { seconds, kickFrom, kickTo, gains: cycles.map((cycle) => cycle.gain) }));
  await ffmpeg([...cycles.flatMap((cycle) => ['-i', cycle.file]), '-filter_complex_script', script, '-map', '[o]', '-ar', String(RATE), '-ac', '2', '-c:a', 'pcm_s16le', output]);
  await rm(work, { recursive: true, force: true });
  const beats = [];
  for (let t = 0; t < seconds; t += bed.beat) beats.push(Math.round(t * 1000) / 1000);
  return { file: output, bpm: bed.bpm, key: bed.key, genre: bed.genre, progression: bed.progression, beat_seconds: bed.beat, beats, downbeats: beats.filter((_, i) => i % 4 === 0), kick_from: kickFrom, kick_to: kickTo };
}

async function synthBed(directory, options) {
  const { pad, kick, hat, beat } = bedExpressions(options);
  const output = path.join(directory, 'bed.wav');
  const d = options.seconds;
  await ffmpeg([
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${pad}':s=${RATE}:d=${d}`,
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${kick}':s=${RATE}:d=${d}`,
    '-f', 'lavfi', '-i', `aevalsrc=exprs='${hat}':s=${RATE}:d=${d}`,
    '-filter_complex',
    '[0]lowpass=f=2400,aecho=0.8:0.7:120|240:0.25|0.15[p];[1]lowpass=f=900[k];[2]highpass=f=7000[h];[p][k][h]amix=inputs=3:normalize=0,alimiter=limit=0.7:level=0,pan=stereo|c0=c0|c1=c0[o]',
    '-map', '[o]', '-ar', String(RATE), '-c:a', 'pcm_s16le', output
  ]);
  const beats = [];
  for (let t = 0; t < d; t += beat) beats.push(Math.round(t * 1000) / 1000);
  return { file: output, bpm: options.bpm, beat_seconds: beat, beats, downbeats: beats.filter((_, i) => i % 4 === 0), kick_from: options.kickFrom, kick_to: options.kickTo };
}

/** Run async jobs with at most `limit` at a time; results keep their order. */
async function pool(items, limit, job) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const list = (value) => value?.split(',').map((name) => name.trim()).filter(Boolean);

async function main(argv) {
  const [outDir, ...rest] = argv;
  if (!outDir) throw new Error('usage: synth-audio-kit.mjs <out-dir> [--palette <id>] [--seed <s>] [--only a,b] [--with a,b] [--bed seconds] [--bpm N] [--kick-from s] [--kick-to s] [--key A]');
  const flag = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };
  const sfxDir = path.join(outDir, 'sfx');
  await mkdir(sfxDir, { recursive: true });
  const palette = flag('--palette') ?? null;
  const seed = flag('--seed') ?? DEFAULT_KIT_SEED;
  // --only picks families from the full list; --with adds families to the default set.
  const only = list(flag('--only'));
  const extra = list(flag('--with')) ?? [];
  const families = only ?? (extra.length ? [...new Set([...(palette ? SFX_FAMILY_NAMES : HISTORIC_SFX_FAMILIES), ...extra])] : null);
  const entries = kitVariants({ palette, seed, families });
  const cues = await pool(entries, 6, (entry) => synthCue(entry, sfxDir));
  const kitFamilies = {};
  for (const cue of cues) (kitFamilies[cue.family] ??= []).push(path.basename(cue.file));
  const kit = { schema_version: 'launchclip.synth-audio-kit.v1', license: 'Original procedural synthesis; no third-party samples.', sample_rate: RATE, ...(palette ? { palette, seed } : {}), sfx: cues, families: kitFamilies, music: null };
  const ambience = flag('--ambience');
  if (ambience && ambience !== 'none') {
    if (!AMBIENCE_BEDS.includes(ambience)) throw new Error(`Unknown ambience bed "${ambience}". Beds: ${AMBIENCE_BEDS.join(', ')}`);
    const bed = await synthAmbience(ambience, path.join(outDir, 'ambience'), { seed });
    kit.ambience = { name: bed.name, file: bed.file, loop_seconds: bed.loop_seconds, lufs: bed.lufs };
  }
  if (flag('--bed')) {
    const seconds = Number(flag('--bed'));
    const musicDir = path.join(outDir, 'music');
    await mkdir(musicDir, { recursive: true });
    const kickFrom = Number(flag('--kick-from') ?? 0);
    const kickTo = Number(flag('--kick-to') ?? seconds);
    const genre = flag('--genre');
    const bed = genre
      ? await synthGenreBed(musicDir, { seconds, genre, bpm: flag('--bpm') !== undefined ? Number(flag('--bpm')) : undefined, key: flag('--key'), progression: flag('--progression') !== undefined ? Number(flag('--progression')) : undefined, kickFrom, kickTo, seed })
      : await synthBed(musicDir, { seconds, bpm: Number(flag('--bpm') ?? 100), key: flag('--key') ?? 'A', kickFrom, kickTo });
    kit.music = { file: bed.file, bpm: bed.bpm, ...(genre ? { genre: bed.genre, key: bed.key, progression: bed.progression } : {}) };
    await writeFile(path.join(outDir, 'BEATS.json'), `${JSON.stringify({ schema_version: 'launchclip.beats.v1', source: bed.file, ...bed }, null, 2)}\n`);
  }
  await writeFile(path.join(outDir, 'AUDIO-KIT.json'), `${JSON.stringify(kit, null, 2)}\n`);
  console.log(JSON.stringify({ sfx: cues.map((cue) => cue.name), music: kit.music?.file ?? null }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
