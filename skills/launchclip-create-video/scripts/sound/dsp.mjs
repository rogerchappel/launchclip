// Expression helpers for the procedural synth (FFmpeg aevalsrc). A cue is a
// list of layers: each layer is one stereo expression pair with its own filter
// chain, gain and start delay. Noise comes from FFmpeg's random(k), whose
// state is seeded per layer at sample 0, so every render is reproducible.

export const RATE = 48000;

export const noise = (k) => `(2*random(${k})-1)`;
const seedPrefix = (seeds) => `if(eq(n,0),${seeds.map(([k, value]) => `st(${k},${value})`).join('+')},0)*0+`;
export const fmt = (value) => Number(value.toFixed(6)).toString();
// A sine whose frequency glides exponentially from f0 to f1 with time constant tau.
export const glidePhase = (f0, f1, tau) => `2*PI*(${fmt(f1)}*t+${fmt((f0 - f1) * tau)}*(1-exp(-t/${fmt(tau)})))`;
export const glide = (f0, f1, tau) => `sin(${glidePhase(f0, f1, tau)})`;
export const attack = (seconds) => `min(t/${fmt(seconds)},1)`;
export const decay = (seconds) => `exp(-t/${fmt(seconds)})`;
/** Local time of an event that starts at `at` seconds: 0 before it. */
export const local = (at) => (at > 0 ? `max(t-${fmt(at)},0)` : 't');
/** 1 from `at` on, with a 1 ms ramp so an event never starts with a click. */
export const from = (at) => (at > 0 ? `clip((t-${fmt(at)})/0.001,0,1)` : '1');

/** A layer: expression for L (and optionally R), filters, gain, delay in seconds. */
export function layer(left, { right = left, filter = 'anull', gain = 1, delay = 0, seed = 1 } = {}) {
  const vars = [...new Set([...`${left}|${right}`.matchAll(/random\((\d)\)/g)].map((match) => Number(match[1])))];
  const prefixL = vars.length ? seedPrefix(vars.map((k) => [k, seed * 7919 + k * 104729])) : '';
  const prefixR = vars.length ? seedPrefix(vars.map((k) => [k, seed * 7919 + k * 104729 + 15485863])) : '';
  return { expr: [`${prefixL}${left}`, `${prefixR}${right}`], filter, gain, delay };
}

/**
 * A waveform of a phase expression (radians). The non-sine shapes are short
 * additive series, so they stay band-limited and never alias into fizz.
 */
export function wave(shape, phase) {
  const p = `(${phase})`;
  switch (shape) {
    case 'triangle': return `(sin(${p})-sin(3*${p})/9+sin(5*${p})/25)`;
    case 'square': return `0.85*(sin(${p})+sin(3*${p})/3+sin(5*${p})/5+sin(7*${p})/7+sin(9*${p})/9)`;
    case 'pulse': return `0.8*(sin(${p})+0.8*sin(2*${p})/2+sin(3*${p})/3+0.5*sin(5*${p})/5)`;
    case 'saw': return `0.6*(sin(${p})+sin(2*${p})/2+sin(3*${p})/3+sin(4*${p})/4+sin(5*${p})/5+sin(6*${p})/6)`;
    case 'soft-saw': return `0.7*(sin(${p})+sin(2*${p})/3+sin(3*${p})/6)`;
    case 'fm': return `sin(${p}+0.9*sin(2*${p}))`;
    default: return `sin(${p})`;
  }
}

// ---------------------------------------------------------------------------
// Seeded randomness for parameters (not samples): mulberry32 over an FNV-1a hash.

export function hash32(text) {
  let h = 0x811c9dc5;
  for (const char of String(text)) {
    h ^= char.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small seeded generator: {next, range, int, pick, chance, seed}. */
export function rng(key) {
  let state = hash32(key) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor((hi - lo + 1) * next()),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    /** A seed for random(k) layers (a positive integer). */
    seed: () => 1 + Math.floor(next() * 900000)
  };
}

/** Semitones → frequency ratio. */
export const semi = (n) => 2 ** (n / 12);

/** Note name ("A", "C#") → frequency of that tonic in octave 3 (A3 = 220 Hz). */
export function tonicHz(key, octave = 3) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const index = names.indexOf(key);
  return 440 * 2 ** (((index < 0 ? 9 : index) - 9) / 12 + (octave - 4));
}
