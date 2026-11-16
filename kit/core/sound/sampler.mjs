// The sampler (docs/IMMERSIVE_SOUND_RFC.md §1): plays a genre stem's notes on
// recorded instruments (instruments.mjs) instead of the synth voices in
// music.mjs. Pure JS on Float32Array; reading the files is the caller's job
// (src/music/samples.js), so this module never touches the disk.
//
// For each note it
//   1. picks a zone: cost = semitones to the root + 0.25 per semitone shifted
//      up + 4 × velocity-layer distance; equal-cost zones (round robins) take
//      turns, from a seeded offset, so two repeated notes never share a take;
//   2. transposes by reading the recording at 2^(semitones/12) with a 4-point
//      Hermite interpolator (pitch and length change together);
//   3. extends a sustain the recording is too short for with a crossfaded
//      loop over its steady middle;
//   4. scales by (velocity / layer velocity)^0.6;
//   5. holds for the note and then releases exponentially to −60 dB.
// Notes are summed into one stereo cycle of the progression. A tail that rings
// past the cycle's end wraps to its start, as the kit loops the cycle.
// Written from the RFC's description; no code copied.
import { RATE, rng } from './dsp.mjs';
import { SAMPLED_INSTRUMENTS, SAMPLE_LIBRARIES } from './instruments.mjs';

/**
 * Genre → {stem name: [instrument, dynamic]}: the stems that play sampled
 * when their instrument is installed. dynamic (0–1) is the velocity the stem
 * plays at, which picks the layer (the stem's own level is set by the kit).
 */
export const SAMPLED_GENRES = {
  'orchestral-lite': {
    strings: ['violins-sustain', 0.5],
    pizz: ['violins-pizz', 1],
    celli: ['celli-sustain', 0.5],
    timpani: ['timpani', 0.6],
    celesta: ['glockenspiel', 1]
  },
  'acoustic-pluck': {
    guitar: ['nylon-guitar', 1],
    pad: ['violins-sustain', 0.5],
    bass: ['contrabass-pizz', 0.7],
    shaker: ['shaker', 1]
  }
};

/** An instrument's zones as objects {file, sha256, bytes, root, vel, rr}. */
export function zonesOf(instrument) {
  const spec = SAMPLED_INSTRUMENTS[instrument];
  if (!spec) throw new Error(`Unknown sampled instrument "${instrument}". Instruments: ${Object.keys(SAMPLED_INSTRUMENTS).join(', ')}`);
  return spec.zones.map(([file, sha256, bytes, root, vel, rr]) => ({ file, sha256, bytes, root, vel, rr }));
}

/**
 * Which stems of a genre bed play sampled, given the installed instruments:
 * {stems: {stem: {instrument, dynamic}}, missing: [instrument]} (missing:
 * mapped instruments not installed; those stems stay synth).
 */
export function sampledPlan(bed, installed) {
  const map = SAMPLED_GENRES[bed.genre] ?? {};
  const stems = {};
  const missing = new Set();
  for (const entry of bed.stems) {
    const [instrument, dynamic] = map[entry.name] ?? [];
    if (!instrument) continue;
    if (installed.has(instrument)) stems[entry.name] = { instrument, dynamic };
    else missing.add(instrument);
  }
  return { stems, missing: [...missing] };
}

const midiOf = (f) => (f > 0 ? 69 + 12 * Math.log2(f / 440) : null);

/**
 * Each note's zone, transposition ratio and gain: [{note, zone, ratio, gain}].
 * notes: [{at, dur, f (Hz, 0 = unpitched), vel}]; the loudest note plays at
 * `dynamic`, the rest in proportion.
 */
export function assignZones({ notes, instrument, dynamic = 1, seed = 'launchclip' }) {
  const zones = zonesOf(instrument);
  const r = rng(`${seed}|sampler|${instrument}`);
  const offset = r.int(0, 7);
  const turns = new Map();
  const loudest = Math.max(1e-9, ...notes.map((note) => note.vel));
  return [...notes].sort((a, b) => a.at - b.at).map((note) => {
    const midi = midiOf(note.f);
    const vel = Math.min(1, Math.max(0.01, (dynamic * note.vel) / loudest));
    const cost = (zone) => (zone.root == null || midi == null ? 0 : Math.abs(midi - zone.root) + 0.25 * Math.max(0, midi - zone.root)) + 4 * Math.abs(vel - zone.vel);
    const best = Math.min(...zones.map(cost));
    const ties = zones.filter((zone) => cost(zone) - best < 1e-9).sort((a, b) => a.rr - b.rr || a.file.localeCompare(b.file));
    const key = `${ties[0].root}|${ties[0].vel}`;
    const turn = turns.get(key) ?? offset;
    turns.set(key, turn + 1);
    const zone = ties[turn % ties.length];
    const ratio = zone.root == null || midi == null ? 1 : 2 ** ((midi - zone.root) / 12);
    return { note, zone, ratio, gain: (vel / zone.vel) ** 0.6 };
  });
}

/** 4-point Hermite read of x at fractional position p (0 past the ends). */
function hermite(x, p) {
  const i = Math.floor(p);
  const t = p - i;
  const xm1 = x[i - 1] ?? 0, x0 = x[i] ?? 0, x1 = x[i + 1] ?? 0, x2 = x[i + 2] ?? 0;
  const c1 = 0.5 * (x1 - xm1);
  const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
  const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * t + c2) * t + c1) * t + x0;
}

/**
 * A sustained recording lengthened to `need` samples: it plays up to 80 % of
 * its length, then loops back over its steady middle (35–80 %) with an
 * equal-power crossfade at every seam.
 * shortcut: the seam is not aligned to the pitch period; section strings hide
 * it, a solo sustain would need the RFC's period-aligned grain splice.
 */
export function sustainLoop(channels, need, rate = RATE) {
  const length = channels[0].length;
  const a = Math.floor(0.35 * length);
  const b = Math.floor(0.8 * length);
  const fade = Math.max(1, Math.min(Math.round(0.15 * rate), Math.floor((b - a) / 4)));
  return channels.map((x) => {
    const out = new Float32Array(Math.max(need, length));
    let n = b - fade;
    out.set(x.subarray(0, n));
    while (n < need) {
      for (let i = 0; i < fade && n < out.length; i++, n++) {
        const t = (i + 0.5) / fade;
        out[n] = x[b - fade + i] * Math.cos(0.5 * Math.PI * t) + x[a + i] * Math.sin(0.5 * Math.PI * t);
      }
      const body = Math.min(b - fade - (a + fade), out.length - n);
      out.set(x.subarray(a + fade, a + fade + body), n);
      n += body;
    }
    return out;
  });
}

/**
 * Sum assigned notes into one stereo cycle: [L, R] Float32Array of
 * round(cycle × rate) samples. audio(zone) returns that zone's decoded
 * [L, R] at `rate`.
 */
export function mixNotes(assigned, { cycle, instrument, audio, rate = RATE }) {
  const spec = SAMPLED_INSTRUMENTS[instrument];
  const total = Math.round(cycle * rate);
  const out = [new Float32Array(total), new Float32Array(total)];
  const release = Math.round(spec.release * rate);
  for (const { note, zone, ratio, gain } of assigned) {
    const hold = Math.round(note.dur * rate);
    const span = hold + release;
    let channels = audio(zone);
    if (spec.kind === 'sustain' && hold * ratio > 0.8 * channels[0].length) channels = sustainLoop(channels, Math.ceil(span * ratio) + 4, rate);
    const n = Math.min(span, Math.floor((channels[0].length - 2) / ratio));
    const start = Math.round(note.at * rate);
    for (let i = 0; i < n; i++) {
      const env = gain * (i < hold ? 1 : 10 ** ((-3 * (i - hold)) / release));
      const at = (start + i) % total;
      out[0][at] += env * hermite(channels[0], i * ratio);
      out[1][at] += env * hermite(channels[1], i * ratio);
    }
  }
  return out;
}

/**
 * The libraries behind a set of instruments, for credits:
 * [{library, title, author, licence, licence_url, home, credit_required, instruments}].
 */
export function sampleCredits(instruments) {
  const byLibrary = new Map();
  for (const name of [...new Set(instruments)].sort()) {
    const library = SAMPLED_INSTRUMENTS[name].library;
    if (!byLibrary.has(library)) byLibrary.set(library, []);
    byLibrary.get(library).push(name);
  }
  return [...byLibrary.keys()].sort().map((library) => {
    const { title, author, licence, licence_url, home, credit_required } = SAMPLE_LIBRARIES[library];
    return { library, title, author, licence, licence_url, home, credit_required, instruments: byLibrary.get(library) };
  });
}

/** renders/credits.txt: required attributions first, then thanks to the CC0 libraries. */
export function creditsText(credits) {
  if (!credits.length) return '';
  const line = (c) => `${c.title}, by ${c.author}. ${c.licence.replace(/-/g, ' ')} (${c.licence_url}). ${c.home}\n  Instruments: ${c.instruments.join(', ')}`;
  const required = credits.filter((c) => c.credit_required);
  const thanks = credits.filter((c) => !c.credit_required);
  const parts = ['Music samples used in this render', ''];
  if (required.length) parts.push('Attribution (required by the licence):', ...required.map(line), '');
  if (thanks.length) parts.push('With thanks (public domain, no attribution required):', ...thanks.map(line), '');
  return parts.join('\n');
}
