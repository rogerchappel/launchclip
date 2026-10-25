// Effect families, parameterised: build(T, r) draws one variant of a family
// in a palette's timbre T (palettes.mjs) with a seeded generator r (dsp.mjs
// rng). The same (family, palette, seed) always gives the same sound; a new
// seed gives a fresh variant in the same character.
//
// A spec is {duration, master, fade, layers, space?} (synth-audio-kit.mjs
// renders it): layers are summed, shaped by master, given the palette's
// finishing chain and room, faded and normalised.
import { attack, decay, fmt, glidePhase, layer, noise, semi, wave } from './dsp.mjs';
import { MATERIALS, paletteChain } from './palettes.mjs';
import { SFX_FAMILY_NAMES } from './options.mjs';

const clampHz = (f) => Math.min(16000, Math.max(30, f));

/** A struck body at f Hz in the palette's material: summed partials, each with its own decay. */
function body(T, r, f, d, { gain = 1, delay = 0, at = 0.0008, shape, bend = T.bend, seed } = {}) {
  const m = MATERIALS[T.material] ?? MATERIALS.glass;
  const waveform = shape ?? (T.material === 'chip' ? 'square' : T.material === 'string' ? T.wave : 'sine');
  const wob = bend > 0 ? `+${fmt(bend * 0.6)}*sin(2*PI*${fmt(r.range(9, 14))}*t)*${decay(d * 0.5)}` : '';
  const voice = (detune) => m.ratios.map((ratio, i) => {
    const freq = clampHz(f * ratio * detune);
    if (freq >= 15000) return null;
    return `${fmt(m.gains[i])}*${wave(waveform, `2*PI*${fmt(freq)}*t${wob}`)}*${decay(Math.max(0.004, d * m.decays[i]))}`;
  }).filter(Boolean).join('+');
  return layer(`(${voice(1)})*${attack(at * T.attack)}`, { right: `(${voice(1.0018)})*${attack(at * T.attack)}`, gain, delay, seed: seed ?? r.seed() });
}

/** Filtered noise with an envelope (expression of t), stereo-decorrelated. */
function hiss(r, env, filter, { gain = 1, delay = 0, k = 0 } = {}) {
  return layer(`${noise(k)}*${env}`, { right: `${noise(k + 1)}*${env}`, filter, gain, delay, seed: r.seed() });
}

/** A tone gliding from f0 to f1 in the palette's waveform. */
function sweep(T, r, f0, f1, tau, env, { gain = 1, delay = 0, shape = T.wave } = {}) {
  return layer(`${wave(shape, glidePhase(clampHz(f0), clampHz(f1), tau))}*${env}`, { right: `${wave(shape, glidePhase(clampHz(f0 * 1.002), clampHz(f1 * 1.002), tau))}*${env}`, gain, delay, seed: r.seed() });
}

/** f folded down by octaves until it sits at or below `max` (keeps bells out of the piercing band). */
const fold = (f, max = 2400) => { let x = f; while (x > max) x /= 2; return x; };
const band = (f, q = 1) => `bandpass=f=${fmt(clampHz(f))}:width_type=q:w=${q}`;
/** A melodic note from the palette's scale: degree steps above the root, octave shift. */
const scaleNote = (T, degree, octave = 0) => fold(T.root * semi(T.scale[Math.min(degree, T.scale.length - 1)] + 12 * octave));

// ---------------------------------------------------------------------------
// The families.

function whoosh(T, r, { short = false } = {}) {
  const duration = (short ? r.range(0.24, 0.34) : r.range(0.45, 0.72)) * Math.sqrt(T.decay);
  const d = fmt(duration);
  const up = r.chance(0.5);
  const count = short ? 3 : r.int(4, 5);
  const lo = (short ? r.range(600, 800) : r.range(280, 420)) * Math.min(1.15, T.bright);
  const bands = Array.from({ length: count }, (_, i) => lo * 2 ** (i * (short ? 1 : 0.95)));
  if (!up) bands.reverse();
  const width = short ? r.range(0.12, 0.16) : r.range(0.16, 0.24);
  const shape = `pow(sin(PI*min(t/${d},1)),2)`;
  const panFrom = r.range(0.15, 0.85);
  const panL = `(${fmt(panFrom)}+${fmt(1 - 2 * panFrom)}*t/${d})`;
  const panR = `(${fmt(1 - panFrom)}+${fmt(2 * panFrom - 1)}*t/${d})`;
  const layers = bands.map((freq, i) => {
    const centre = (0.22 + (0.5 * i) / Math.max(1, count - 1)) * duration;
    const env = `exp(-pow((t-${fmt(centre)})/${fmt(width * duration)},2))*${shape}`;
    return layer(`${noise(i % 4)}*${env}*${panL}`, { right: `${noise((i % 4) + 4)}*${env}*${panR}`, filter: band(freq, 1.1), gain: 1.2, seed: r.seed() });
  });
  layers.push(hiss(r, `${shape}`, `lowpass=f=${fmt(260 + 200 * T.body)}`, { gain: 0.3 + 0.4 * T.air, k: 8 }));
  // A tonal sweep gives the palette's colour: a slide whistle, a glass sweep, a chip zap.
  if (T.bend > 0.5 || ['glass', 'chip', 'string'].includes(T.material)) {
    const f0 = Math.min(1300, (T.material === 'glass' ? 800 : 500) * T.pitch);
    layers.push(sweep(T, r, up ? f0 : f0 * 2.2, up ? f0 * 2.2 : f0, duration * 0.6, shape, { gain: T.material === 'chip' ? 0.25 : 0.1 }));
  }
  if (T.body > 0.8 && !short) layers.push(sweep(T, r, 70, 38, duration, shape, { gain: 0.35, shape: 'sine' }));
  return { duration, master: `highpass=f=${short ? 220 : 110},lowpass=f=${fmt(Math.min(11000, 8000 * T.bright))}${!short && r.chance(0.6) ? ',aphaser=type=t:speed=1.4:decay=0.4' : ''}`, fade: short ? 0.04 : 0.06, layers };
}

function impact(T, r) {
  const fFrom = r.range(110, 170) * T.pitch;
  const fTo = r.range(38, 50) * Math.max(0.75, T.pitch);
  const bodyDecay = r.range(0.22, 0.38) * T.decay;
  const crack = r.range(650, 1300) * T.bright;
  const layers = [
    layer(`${wave(T.material === 'chip' ? 'square' : 'sine', glidePhase(fFrom, fTo, 0.045))}*${decay(bodyDecay)}*${attack(0.002)}`, { filter: 'lowpass=f=420', gain: 0.6 + 0.5 * T.body, seed: r.seed() }),
    hiss(r, `${attack(0.0002)}*${decay(0.003)}`, 'highpass=f=1600', { gain: 0.6, k: 0 }),
    hiss(r, `${attack(0.0005)}*${decay(0.035 * T.decay)}`, band(crack, 0.7), { gain: r.range(0.4, 0.65), k: 2 }),
    hiss(r, `${attack(0.01)}*${decay(0.35 * T.decay)}`, 'lowpass=f=1100', { gain: 0.06 + 0.12 * T.body, k: 4 })
  ];
  if (['metal', 'wood', 'glass'].includes(T.material)) layers.push(body(T, r, r.range(160, 260) * T.pitch, 0.18 * T.decay, { gain: T.material === 'metal' ? 0.35 : 0.22 }));
  return { duration: r.range(1.1, 1.4) * Math.min(1.4, T.decay), master: 'highpass=f=28,lowpass=f=9000', fade: 0.2, layers };
}

function riser(T, r) {
  const duration = r.range(1.2, 1.6);
  const d = fmt(duration);
  const base = r.range(110, 190) * T.pitch;
  const k = Math.log(r.range(4, 7)) / duration;
  const build = `pow(t/${d},2.4)`;
  const phase = (f) => `2*PI*${fmt(f)}*(exp(${fmt(k)}*t)-1)/${fmt(k)}`;
  const trem = r.chance(0.5) ? `*(0.6+0.4*sin(2*PI*(${fmt(r.range(3, 5))}*t+${fmt(r.range(5, 9))}*t*t)))` : '';
  const spread = r.pick([1.5, 2, 1.335]);
  return {
    duration,
    master: 'highpass=f=150,lowpass=f=11000',
    fade: 0.012,
    layers: [
      layer(`0.5*${wave(T.wave, phase(base))}*${build}${trem}`, { right: `0.5*${wave(T.wave, phase(base * 1.008))}*${build}${trem}`, seed: r.seed() }),
      layer(`0.28*${wave(T.wave, phase(base * spread))}*${build}${trem}`, { right: `0.28*${wave(T.wave, phase(base * spread * 1.006))}*${build}${trem}`, seed: r.seed() }),
      hiss(r, `pow(t/${d},3)`, `highpass=f=${fmt(1800 * T.bright)}`, { gain: 0.2 + 0.3 * T.air, k: 0 }),
      hiss(r, `pow(t/${d},4)`, band(5000 * T.bright, 0.8), { gain: 0.25 + 0.35 * T.air, k: 2 })
    ]
  };
}

function tick(T, r) {
  const f1 = Math.min(2400, r.range(1700, 2800) * T.bright * (T.material === 'wood' ? 0.6 : 1));
  const f2 = f1 * r.range(1.45, 1.55);
  const d1 = r.range(0.014, 0.022) * T.decay;
  const shape = T.material === 'chip' ? 'square' : 'sine';
  return {
    duration: 0.12,
    master: 'highpass=f=400',
    fade: 0.02,
    layers: [
      layer(`(${wave(shape, `2*PI*${fmt(f1)}*t`)}*${decay(d1)}+0.4*sin(2*PI*${fmt(f2)}*t)*${decay(d1 * 0.65)})*${attack(0.0003)}`, { seed: r.seed() }),
      hiss(r, `${attack(0.0002)}*${decay(0.0008)}`, `highpass=f=${T.material === 'wood' ? 2000 : 4000}`, { gain: T.material === 'wood' ? 0.6 : 0.35 })
    ]
  };
}

function pop(T, r) {
  const fFrom = r.range(200, 340) * T.pitch;
  const fTo = fFrom * r.range(2.1, 2.6) * (1 + T.bend * 0.5);
  const rate = r.range(24, 38);
  const bodyDecay = r.range(0.034, 0.05) * T.decay;
  const phase = `2*PI*(${fmt(fTo)}*t+${fmt((fFrom - fTo) / rate)}*(1-exp(-${fmt(rate)}*t)))`;
  return {
    duration: 0.2,
    master: 'highpass=f=120',
    fade: 0.03,
    layers: [
      layer(`${wave(T.material === 'chip' ? 'square' : T.wave === 'saw' ? 'soft-saw' : 'sine', phase)}*${decay(bodyDecay)}*${attack(0.0008)}`, { seed: r.seed() }),
      hiss(r, `${attack(0.0002)}*${decay(0.0015)}`, band(2500 * T.bright, 1), { gain: 0.25 })
    ]
  };
}

function shimmer(T, r) {
  const start = r.int(0, 2);
  const notes = [0, 2, 4, r.chance(0.5) ? 5 : 3].slice(0, r.int(3, 4)).map((step) => scaleNote(T, start + step, 1));
  const stagger = r.pick([0, 0.04, 0.06]);
  const layers = notes.map((f, i) => body(T, r, f, (0.38 - i * 0.04) * T.decay, { gain: 0.5 / (1 + i * 0.35), delay: i * stagger, at: 0.002, bend: 0 }));
  layers.push(hiss(r, `${attack(0.004)}*${decay(0.18)}`, `highpass=f=${fmt(Math.min(9000, 7000 * T.bright))}`, { gain: 0.1 + 0.12 * T.air }));
  return { duration: 1.6, master: 'anull', fade: 0.3, layers };
}

function subdrop(T, r) {
  const fFrom = r.range(75, 95) * Math.max(0.8, T.pitch);
  const fTo = r.range(30, 34);
  return {
    duration: r.range(1.6, 1.9),
    master: 'lowpass=f=200',
    fade: 0.3,
    layers: [layer(`(${glide(fFrom, fTo, r.range(0.3, 0.45))}+${fmt(T.material === 'chip' ? 0.3 : r.range(0, 0.18))}*${glide(fFrom * 2, fTo * 2, 0.35)})*${attack(0.02)}*${decay(r.range(0.5, 0.62) * T.decay)}`, { seed: r.seed() })]
  };
}

function glide(f0, f1, tau) {
  return `sin(${glidePhase(f0, f1, tau)})`;
}

function click(T, r) {
  const freq = Math.min(3100, r.range(1900, 3100) * T.bright);
  const bodyHz = r.range(430, 780) * T.pitch;
  return {
    duration: 0.06,
    master: 'highpass=f=200',
    fade: 0.01,
    layers: [
      hiss(r, `${attack(0.0001)}*${decay(0.0009)}`, `highpass=f=${fmt(r.range(2600, 4200) * T.bright)}`, { gain: 0.7 }),
      layer(`${wave(T.material === 'chip' ? 'square' : 'sine', `2*PI*${fmt(freq)}*t`)}*${attack(0.0002)}*${decay(0.005 * T.decay)}`, { gain: 0.6, seed: r.seed() }),
      layer(`sin(2*PI*${fmt(bodyHz)}*t)*${attack(0.0005)}*${decay(0.0035 * T.decay)}`, { gain: 0.35, delay: 0.0005, seed: r.seed() })
    ]
  };
}

function keystroke(T, r, kind = 'key') {
  const heavy = kind !== 'key';
  const clickHz = (heavy ? r.range(2600, 3800) : r.range(3400, 5100)) * T.bright;
  const thock = (heavy ? r.range(240, 300) : r.range(310, 400)) * Math.max(0.75, T.pitch);
  const bodyDecay = (heavy ? r.range(0.027, 0.036) : r.range(0.012, 0.02)) * Math.max(0.6, T.decay);
  const seed = r.seed();
  const layers = [
    layer(`${noise(0)}*${attack(0.0002)}*${decay(r.range(0.0019, 0.003))}`, { filter: `highpass=f=1500,${band(clickHz, 0.9)}`, gain: (heavy ? 0.6 : 0.9) * 1.8, seed }),
    layer(`sin(2*PI*${fmt(clickHz * 1.22)}*t)*${decay(0.0016)}*${attack(0.0002)}`, { gain: 0.18, seed }),
    layer(`(0.75*${glide(thock, thock * 0.53, 0.006)}*${decay(bodyDecay * 0.5)}+0.8*${noise(1)}*${decay(bodyDecay * 0.4)})*${attack(0.0012)}`, { filter: 'lowpass=f=1500', gain: heavy ? 1 : 0.85, delay: 0.0012, seed }),
    layer(`sin(2*PI*${fmt(thock * 3.6)}*t)*${decay(0.009)}*${attack(0.0005)}`, { gain: 0.1, delay: 0.001, seed }),
    layer(`${noise(2)}*${attack(0.0002)}*${decay(0.0014)}`, { filter: 'highpass=f=2200', gain: r.range(0.38, 0.6), delay: heavy ? r.range(0.011, 0.0145) : r.range(0.0065, 0.0105), seed })
  ];
  if (T.material === 'chip') layers.push(layer(`${wave('square', `2*PI*${fmt(r.range(900, 1600))}*t`)}*${attack(0.0005)}*${decay(0.012)}`, { gain: 0.25, seed }));
  if (heavy) layers.push(layer(`${noise(3)}*${attack(0.001)}*${decay(r.range(0.012, 0.022))}`, { filter: band(r.range(1500, 2100), 2.5), gain: r.range(0.18, 0.3), delay: r.range(0.003, 0.005), seed }));
  return { duration: kind === 'space' ? 0.17 : heavy ? 0.15 : 0.11, master: 'highpass=f=70,lowpass=f=13000', fade: 0.012, layers, dry: true };
}

function slide(T, r) {
  const duration = r.range(0.4, 0.62) * Math.sqrt(T.decay);
  const d = fmt(duration);
  const env = `${attack(0.03 * T.attack)}*clip((${d}-t)/${fmt(duration * 0.45)},0,1)`;
  const f = r.range(900, 1600) * T.bright;
  const rise = r.range(1.2, 1.6);
  const layers = [
    hiss(r, `${env}*(1-t/${d})`, band(f, 1.6), { gain: 1 }),
    hiss(r, `${env}*(t/${d})`, band(f * rise, 1.6), { gain: 1, k: 2 }),
    hiss(r, `${env}*(0.6+0.4*sin(2*PI*${fmt(r.range(18, 30))}*t))`, `lowpass=f=${fmt(400 + 300 * T.body)}`, { gain: 0.25 + 0.3 * T.body, k: 4 })
  ];
  if (T.bend > 0.5 || T.material === 'chip') layers.push(sweep(T, r, r.range(500, 700) * T.pitch, r.range(1100, 1500) * T.pitch, duration * 0.8, env, { gain: 0.22 }));
  return { duration, master: 'highpass=f=150', fade: 0.04, layers };
}

function snap(T, r) {
  const f = r.range(1900, 2900) * Math.sqrt(T.bright);
  return {
    duration: 0.16,
    master: 'highpass=f=300,lowpass=f=12000',
    fade: 0.02,
    layers: [
      hiss(r, `${attack(0.0003)}*${decay(r.range(0.008, 0.014) * T.decay)}`, band(f, 1.4), { gain: 1.6 }),
      hiss(r, `${attack(0.0001)}*${decay(0.0012)}`, 'highpass=f=3500', { gain: 0.7, k: 2 }),
      layer(`sin(2*PI*${fmt(r.range(900, 1300) * T.pitch)}*t)*${attack(0.0005)}*${decay(0.012 * T.decay)}`, { gain: 0.25, delay: 0.001, seed: r.seed() })
    ]
  };
}

function thud(T, r) {
  const f = r.range(85, 130) * Math.max(0.7, T.pitch);
  return {
    duration: r.range(0.45, 0.6),
    master: 'highpass=f=30,lowpass=f=3500',
    fade: 0.08,
    layers: [
      layer(`${glide(f, f * 0.5, 0.03)}*${attack(0.002)}*${decay(r.range(0.09, 0.14) * T.decay)}`, { gain: 0.8 + 0.3 * T.body, seed: r.seed() }),
      hiss(r, `${attack(0.001)}*${decay(r.range(0.025, 0.04) * T.decay)}`, `lowpass=f=${fmt(r.range(450, 800))}`, { gain: 0.9 }),
      hiss(r, `${attack(0.0003)}*${decay(0.004)}`, band(r.range(700, 1200) * T.bright, 0.9), { gain: 0.3, k: 2 })
    ]
  };
}

function chime(T, r) {
  const start = r.int(0, 2);
  const steps = r.pick([[0, 2, 4], [0, 1, 2], [0, 2, 3, 4], [0, 3]]);
  const gap = r.range(0.07, 0.12);
  const layers = steps.map((step, i) => body(T, r, scaleNote(T, start + step), r.range(0.4, 0.55) * T.decay, { gain: 0.5, delay: i * gap, at: 0.0015, bend: 0 }));
  return { duration: 1.4 + steps.length * gap, master: 'highpass=f=200', fade: 0.35, layers };
}

function ding(T, r) {
  const f = scaleNote(T, r.int(0, 4));
  return { duration: 1.3, master: 'highpass=f=180', fade: 0.4, layers: [body(T, r, f, r.range(0.45, 0.65) * T.decay, { gain: 0.7, at: 0.001, bend: 0 }), hiss(r, `${attack(0.0002)}*${decay(0.002)}`, `highpass=f=${fmt(5000 * T.bright)}`, { gain: 0.2 })] };
}

function ping(T, r) {
  const f = fold(r.range(1500, 2300) * T.pitch, 2400);
  const shape = T.material === 'chip' ? 'square' : 'sine';
  return {
    duration: 0.8,
    master: 'highpass=f=300',
    fade: 0.25,
    layers: [
      layer(`${wave(shape, glidePhase(f * 1.04, f, 0.02))}*${attack(0.0008 * T.attack)}*${decay(r.range(0.12, 0.2) * T.decay)}`, { right: `${wave(shape, glidePhase(f * 1.042, f * 1.001, 0.02))}*${attack(0.0008 * T.attack)}*${decay(r.range(0.12, 0.2) * T.decay)}`, gain: 0.7, seed: r.seed() }),
      layer(`0.2*sin(2*PI*${fmt(f * 2)}*t)*${decay(0.05)}`, { gain: 0.6, seed: r.seed() })
    ]
  };
}

function glitch(T, r) {
  const duration = r.range(0.3, 0.45);
  const count = r.int(6, 10);
  const layers = [];
  let at = 0;
  for (let i = 0; i < count && at < duration - 0.02; i++) {
    const length = r.range(0.015, 0.05);
    const gate = `between(t,${fmt(at)},${fmt(at + length)})*clip((t-${fmt(at)})/0.001,0,1)*clip((${fmt(at + length)}-t)/0.001,0,1)`;
    if (r.chance(0.55)) {
      const f = r.range(300, 2400) * T.pitch;
      layers.push(layer(`${wave(r.pick(['square', 'saw', 'pulse']), `2*PI*${fmt(f)}*t`)}*${gate}`, { gain: 0.35, seed: r.seed() }));
    } else {
      layers.push(hiss(r, gate, band(r.range(800, 6000) * T.bright, 0.8), { gain: 0.8, k: (i % 3) * 2 }));
    }
    at += length + (r.chance(0.3) ? r.range(0.005, 0.03) : 0);
  }
  return { duration, master: `highpass=f=180,lowpass=f=9000,acrusher=bits=${T.crush ? T.crush.bits : 8}:samples=${r.int(2, 4)}:mode=lin:aa=1:mix=0.6`, fade: 0.02, layers };
}

function tapeStop(T, r) {
  const duration = r.range(0.55, 0.8);
  const d = fmt(duration);
  const chord = [0, r.pick([3, 4]), 7].map((step) => r.range(160, 220) * T.pitch * semi(step));
  // Frequency falls as (1 - t/d)^2: phase = 2π f0 d/3 (1 - (1 - t/d)^3).
  const phase = (f) => `2*PI*${fmt(f * duration / 3)}*(1-pow(max(1-t/${d},0),3))`;
  const env = `${attack(0.003)}*pow(max(1-t/${d},0),0.6)`;
  return {
    duration,
    master: 'highpass=f=40,lowpass=f=5000',
    fade: 0.04,
    layers: [
      ...chord.map((f) => layer(`${wave(T.wave === 'sine' ? 'soft-saw' : T.wave, phase(f))}*${env}`, { right: `${wave(T.wave === 'sine' ? 'soft-saw' : T.wave, phase(f * 1.004))}*${env}`, gain: 0.3, seed: r.seed() })),
      hiss(r, `${env}*pow(max(1-t/${d},0),2)`, `lowpass=f=${fmt(2500 * T.bright)}`, { gain: 0.12 })
    ]
  };
}

function pageTurn(T, r) {
  const duration = r.range(0.5, 0.7);
  const d = fmt(duration);
  const swell = `pow(sin(PI*min(t/${d},1)),1.5)`;
  // Crinkle: sparse random spikes through a resonant band, under a swell.
  const crinkle = `gt(random(0),${fmt(r.range(0.985, 0.993))})*2*(random(1)-0.5)`;
  return {
    duration,
    master: 'highpass=f=250,lowpass=f=11000',
    fade: 0.05,
    layers: [
      layer(`${crinkle}*${swell}`, { right: `gt(random(0),0.988)*2*(random(1)-0.5)*${swell}`, filter: band(r.range(2500, 4000) * T.bright, 0.7), gain: 3, seed: r.seed() }),
      hiss(r, `${swell}*(0.5+0.5*sin(2*PI*${fmt(r.range(7, 12))}*t))`, band(r.range(1800, 3200) * T.bright, 0.9), { gain: 0.7, k: 2 }),
      hiss(r, `exp(-pow((t-${fmt(duration * 0.7)})/${fmt(duration * 0.12)},2))`, `lowpass=f=${fmt(500 + 300 * T.body)}`, { gain: 0.6, k: 4 })
    ]
  };
}

function penScribble(T, r) {
  const duration = r.range(0.7, 1.1);
  const d = fmt(duration);
  const rate = r.range(5, 8);
  const strokes = `pow(abs(sin(PI*${fmt(rate)}*t+${fmt(r.range(0.3, 0.5))}*sin(2*PI*${fmt(rate * 0.37)}*t))),3)`;
  const env = `${attack(0.02)}*clip((${d}-t)/0.08,0,1)`;
  return {
    duration,
    master: 'highpass=f=600,lowpass=f=10000',
    fade: 0.04,
    layers: [
      hiss(r, `${strokes}*${env}`, band(r.range(3200, 4800) * T.bright, 1.3), { gain: 1.2 }),
      hiss(r, `${strokes}*${env}*(0.7+0.3*random(4))`, band(r.range(1400, 2000), 2), { gain: 0.5, k: 2 })
    ]
  };
}

function cameraShutter(T, r) {
  const second = r.range(0.055, 0.11);
  const clack = (delay, gain) => [
    hiss(r, `${attack(0.0002)}*${decay(r.range(0.004, 0.007))}`, band(r.range(2200, 3500) * T.bright, 1.2), { gain: 1.4 * gain, delay }),
    layer(`(sin(2*PI*${fmt(r.range(1100, 1500))}*t)+0.5*sin(2*PI*${fmt(r.range(2600, 3300))}*t))*${attack(0.0003)}*${decay(0.008)}`, { gain: 0.25 * gain, delay, seed: r.seed() }),
    hiss(r, `${attack(0.0008)}*${decay(0.018)}`, `lowpass=f=900`, { gain: 0.35 * gain, delay, k: 2 })
  ];
  const layers = [...clack(0, 1), ...clack(second, 0.8)];
  if (!['glass', 'chip'].includes(T.material) && r.chance(0.6)) {
    const start = second + 0.03;
    layers.push(layer(`${wave('saw', `2*PI*${fmt(r.range(180, 260))}*t`)}*${attack(0.01)}*clip((0.16-t)/0.03,0,1)*between(t,0,0.16)`, { filter: band(1800, 1), gain: 0.12, delay: start, seed: r.seed() }));
  }
  return { duration: 0.42, master: 'highpass=f=150,lowpass=f=12000', fade: 0.05, layers };
}

function cash(T, r) {
  const f = scaleNote(T, r.int(2, 4), 1);
  const ring = r.range(0.35, 0.5) * T.decay;
  const tines = ['metal', 'glass', 'chip'].includes(T.material) ? T : { ...T, material: 'metal' };
  return {
    duration: 1.3,
    master: 'highpass=f=120',
    fade: 0.35,
    layers: [
      hiss(r, `${attack(0.0005)}*${decay(0.02)}`, band(r.range(900, 1400), 0.8), { gain: 1 }),
      layer(`${glide(160, 90, 0.02)}*${attack(0.001)}*${decay(0.05)}`, { gain: 0.45, seed: r.seed() }),
      body(tines, r, f, ring, { gain: 0.42, delay: r.range(0.06, 0.09), bend: 0 }),
      body(tines, r, f * semi(r.pick([4, 5, 7])), ring * 1.2, { gain: 0.42, delay: r.range(0.14, 0.19), bend: 0 })
    ]
  };
}

function notification(T, r) {
  const first = scaleNote(T, r.int(0, 3));
  const interval = r.pick([5, 7, 4, 12]);
  const gap = r.range(0.09, 0.14);
  return {
    duration: 0.9,
    master: 'highpass=f=200',
    fade: 0.25,
    layers: [
      body(T, r, first, r.range(0.16, 0.24) * T.decay, { gain: 0.55, at: 0.002, bend: 0 }),
      body(T, r, first * semi(interval), r.range(0.24, 0.32) * T.decay, { gain: 0.55, delay: gap, at: 0.002, bend: 0 })
    ]
  };
}

function errorBuzz(T, r) {
  const f = r.range(130, 190) * Math.max(0.8, Math.min(1.2, T.pitch));
  const pulse = r.range(0.1, 0.14);
  const gap = r.range(0.05, 0.08);
  const shape = T.material === 'chip' ? 'square' : r.pick(['pulse', 'saw', 'square']);
  const one = (delay) => layer(`${wave(shape, `2*PI*${fmt(f)}*t`)}*${attack(0.004)}*clip((${fmt(pulse)}-t)/0.012,0,1)`, { right: `${wave(shape, `2*PI*${fmt(f * 1.006)}*t`)}*${attack(0.004)}*clip((${fmt(pulse)}-t)/0.012,0,1)`, gain: 0.5, delay, seed: r.seed() });
  const layers = [one(0), one(pulse + gap)];
  if (r.chance(0.5)) layers.push(one(2 * (pulse + gap)));
  return { duration: 0.6, master: 'highpass=f=90,lowpass=f=2600', fade: 0.04, layers, dry: true };
}

function success(T, r) {
  const start = r.int(0, 1);
  const steps = r.pick([[0, 2, 4], [0, 2, 4, 5], [0, 4, 5], [0, 2, 5]]);
  const gap = r.range(0.08, 0.11);
  const layers = steps.map((step, i) => body(T, r, scaleNote(T, start + step), (i === steps.length - 1 ? 0.5 : 0.18) * T.decay, { gain: 0.48, delay: i * gap, at: 0.0015, bend: 0 }));
  layers.push(hiss(r, `${attack(0.004)}*${decay(0.25)}`, `highpass=f=${fmt(7000 * Math.min(1.2, T.bright))}`, { gain: 0.06 + 0.08 * T.air, delay: (steps.length - 1) * gap }));
  return { duration: 1.2 + steps.length * gap, master: 'highpass=f=180', fade: 0.35, layers };
}

function boing(T, r) {
  const f0 = r.range(140, 240) * T.pitch;
  const vib = r.range(9, 14);
  const depth = r.range(0.25, 0.4);
  const tau = r.range(0.18, 0.28) * T.decay;
  // Frequency rising from f0 and wobbling at vib Hz, the wobble dying away.
  const phase = `2*PI*(${fmt(f0)}*t+${fmt(f0 * r.range(0.15, 0.35))}*t*t)-${fmt((depth * f0) / vib)}*exp(-t/${fmt(tau)})*cos(2*PI*${fmt(vib)}*t)`;
  const env = `${attack(0.002)}*${decay(r.range(0.2, 0.3) * T.decay)}`;
  return {
    duration: 0.8,
    master: 'highpass=f=80,lowpass=f=6000',
    fade: 0.12,
    layers: [layer(`${wave(T.material === 'chip' ? 'square' : 'triangle', phase)}*${env}`, { gain: 0.8, seed: r.seed() }), hiss(r, `${attack(0.0005)}*${decay(0.01)}`, `lowpass=f=1200`, { gain: 0.3 })]
  };
}

function sparkle(T, r) {
  const count = r.int(6, 10);
  const span = r.range(0.45, 0.7);
  const layers = [];
  for (let i = 0; i < count; i++) {
    const at = (span * i) / count + r.range(0, span / count);
    const f = fold(scaleNote(T, r.int(0, T.scale.length - 1), 1) * (T.material === 'chip' ? 1 : r.pick([1, 2])), 3000);
    const pan = r.range(0.2, 0.8);
    const tone = `${wave(T.material === 'chip' ? 'square' : 'sine', `2*PI*${fmt(f)}*t`)}*${attack(0.001)}*${decay(r.range(0.05, 0.12) * T.decay)}`;
    layers.push(layer(`${fmt(pan)}*${tone}`, { right: `${fmt(1 - pan)}*${tone}`, gain: 0.32 + 0.15 * (1 - i / count), delay: at, seed: r.seed() }));
  }
  layers.push(hiss(r, `${attack(0.05)}*${decay(0.3)}`, `highpass=f=${fmt(Math.min(10000, 8000 * T.bright))}`, { gain: 0.05 + 0.08 * T.air }));
  return { duration: span + 0.7, master: 'highpass=f=500', fade: 0.3, layers };
}

function footstep(T, r) {
  const toe = r.range(0.03, 0.06);
  const crunch = T.material === 'wood' ? 0.4 : r.range(0.5, 0.9);
  const step = (delay, gain) => [
    hiss(r, `${attack(0.001)}*${decay(r.range(0.018, 0.03))}`, `lowpass=f=${fmt(r.range(300, 500))}`, { gain: 1.1 * gain, delay }),
    layer(`${glide(r.range(90, 130), 55, 0.02)}*${attack(0.001)}*${decay(0.04)}`, { gain: 0.45 * gain * (0.5 + T.body), delay, seed: r.seed() }),
    hiss(r, `${attack(0.0008)}*${decay(r.range(0.012, 0.02))}`, band(r.range(1200, 2400) * T.bright, 0.8), { gain: crunch * gain * 0.8, delay, k: 2 })
  ];
  return { duration: 0.32, master: 'highpass=f=40,lowpass=f=8000', fade: 0.05, layers: [...step(0, 1), ...step(toe, 0.6)] };
}

function door(T, r) {
  const latch = r.range(0.11, 0.18);
  return {
    duration: 1,
    master: 'highpass=f=35,lowpass=f=8000',
    fade: 0.2,
    layers: [
      layer(`${glide(r.range(90, 120), 48, 0.03)}*${attack(0.002)}*${decay(r.range(0.12, 0.18) * T.decay)}`, { gain: 0.9, seed: r.seed() }),
      hiss(r, `${attack(0.002)}*${decay(0.06 * T.decay)}`, `lowpass=f=${fmt(r.range(600, 900))}`, { gain: 0.9 }),
      hiss(r, `${attack(0.003)}*${decay(0.25 * T.decay)}`, band(r.range(250, 400), 2), { gain: 0.25, k: 2 }),
      hiss(r, `${attack(0.0002)}*${decay(0.004)}`, band(r.range(2500, 3500), 1.5), { gain: 0.9, delay: latch, k: 4 }),
      layer(`(sin(2*PI*${fmt(r.range(1600, 2100))}*t)+0.5*sin(2*PI*${fmt(r.range(3400, 4200))}*t))*${attack(0.0003)}*${decay(0.01)}`, { gain: 0.2, delay: latch, seed: r.seed() })
    ]
  };
}

/** family → {intent, variants (count with a palette), build(T, r)}. */
export const FAMILY_BUILDERS = Object.freeze({
  whoosh: { intent: 'spatial travel, push, whip pan', variants: 3, build: (T, r) => whoosh(T, r) },
  impact: { intent: 'big reveal, law/headline lock, scene slam', variants: 3, build: impact },
  riser: { intent: 'tension into a payoff or rehook (ends on the hit)', variants: 2, build: riser },
  tick: { intent: 'counter step, data point lands, small UI state change', variants: 3, build: tick },
  pop: { intent: 'object or label appears', variants: 3, build: pop },
  shimmer: { intent: 'insight, equilibrium, satisfying resolve', variants: 3, build: shimmer },
  subdrop: { intent: 'final payoff weight under the last line', variants: 2, build: subdrop },
  click: { intent: 'UI click, toggle, button press', variants: 4, build: click },
  keystroke: { intent: 'one mechanical key press (typing track)', variants: 6, build: (T, r) => keystroke(T, r, 'key') },
  'keystroke-space': { intent: 'space bar: heavier, longer key with stabiliser rattle', variants: 2, build: (T, r) => keystroke(T, r, 'space') },
  'keystroke-enter': { intent: 'enter/return: a firmer, heavier key', variants: 2, build: (T, r) => keystroke(T, r, 'enter') },
  swipe: { intent: 'a quick card or screen swipe', variants: 3, build: (T, r) => whoosh(T, r, { short: true }) },
  slide: { intent: 'an object slides into place', variants: 3, build: slide },
  snap: { intent: 'a snap into place, finger snap, quick lock', variants: 3, build: snap },
  thud: { intent: 'something heavy lands softly', variants: 3, build: thud },
  chime: { intent: 'a pleasant little arpeggio: idea, unlock, welcome', variants: 3, build: chime },
  ding: { intent: 'one bell note: done, correct, attention', variants: 3, build: ding },
  ping: { intent: 'a short bright ping: highlight, location, sonar', variants: 3, build: ping },
  glitch: { intent: 'a digital stutter: error, hack, data corruption', variants: 3, build: glitch },
  'tape-stop': { intent: 'everything grinds to a halt: a twist, a stop', variants: 2, build: tapeStop },
  'page-turn': { intent: 'paper turns: a new chapter, a document', variants: 3, build: pageTurn },
  'pen-scribble': { intent: 'writing or signing', variants: 3, build: penScribble },
  'camera-shutter': { intent: 'a photo is taken, a screenshot', variants: 3, build: cameraShutter },
  cash: { intent: 'money in: a sale, revenue, a price', variants: 3, build: cash },
  notification: { intent: 'a message arrives', variants: 3, build: notification },
  'error-buzz': { intent: 'wrong, denied, failed', variants: 3, build: errorBuzz },
  success: { intent: 'it worked: a win, a check mark', variants: 3, build: success },
  boing: { intent: 'a springy bounce, a playful pop-up', variants: 3, build: boing },
  sparkle: { intent: 'magic, polish, something new and shiny', variants: 3, build: sparkle },
  footstep: { intent: 'a step: someone walks in', variants: 3, build: footstep },
  door: { intent: 'a door closes: an exit, an entrance, an ending', variants: 2, build: door }
});

for (const name of SFX_FAMILY_NAMES) if (!FAMILY_BUILDERS[name]) throw new Error(`sfx family ${name} has no builder`);

/**
 * A family's spec in a palette with the palette's chain and room applied.
 * A palette room extends the duration so its tail is not cut.
 */
export function familySpec(family, T, r) {
  const entry = FAMILY_BUILDERS[family];
  if (!entry) throw new Error(`Unknown SFX family "${family}"`);
  const spec = entry.build(T, r);
  const space = spec.dry ? null : T.space;
  const tail = space ? Math.min(space.seconds * 0.6, 1.4) : 0;
  const { dry, ...rest } = spec;
  return { ...rest, duration: Number((spec.duration + tail).toFixed(3)), master: `${spec.master},${paletteChain(T)}`, fade: spec.fade + tail * 0.5, ...(space ? { space } : {}) };
}
