// Synth music genres: licence-free beds drawn in FFmpeg expressions. A genre
// has several chord progressions, instrument voicings, a tempo range and a
// drum feel; sound.music picks {genre, bpm, key, progression} and the seed
// picks the voicing and the small variations (arp shape, fills, swing).
//
// A bed is rendered as stems. Each stem is one cycle of the progression
// (an exact number of bars, so the beat grid stays exact) that the kit loops
// to the full length, then shapes with a full-length envelope by role:
//   always  pads, keys and chords: the whole bed, faded in and out
//   drums   kick, snare, hats: only inside the energy window (kick_from..kick_to)
//   bass    quieter outside the window, full inside it
//   lead    arps and melodies: only inside the window
//   pumped  like always, but ducked on every beat while the drums play (house)
// so the arrangement follows the story's energy exactly as the historic bed's
// kick window does, and BEATS.json stays the plain grid from t = 0.
//
// Notes inside a cycle are found with a balanced if() tree on time, so a
// sample costs log(notes) comparisons rather than one term per note.
import { fmt, rng, semi, wave, tonicHz } from './dsp.mjs';
import { GENRE_SPECS, MUSIC_GENRES, MUSIC_KEYS, normalizeKey } from './options.mjs';

const QUALITY = {
  maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10],
  sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], min9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14]
};

/** Chord tones folded into one octave-and-a-half around the centre, low to high, without repeats. */
function voiceChord(root, quality, centre = 5) {
  const tones = QUALITY[quality].map((interval) => {
    let x = root + interval;
    while (x < centre - 6) x += 12;
    while (x >= centre + 7) x -= 12;
    return x;
  });
  return [...new Set(tones)].sort((a, b) => a - b);
}

/** The root of a chord folded into the bass register (semitones below the tonic). */
const bassRoot = (root) => { let x = root; while (x >= 0) x -= 12; while (x < -12) x += 12; return x; };

// ---------------------------------------------------------------------------
// Instruments: (f, X, dur) → expression of local time X (a string), at unit
// velocity. rel is the release ramp before the note's end.

const env = (X, a) => `min(${X}/${fmt(a)},1)`;
const ex = (X, d) => `exp(-${X}/${fmt(d)})`;

const INSTRUMENTS = {
  // Two detuned soft saws, a slow swell.
  pad: { rel: 0.3, build: (f, X) => `0.5*(${wave('soft-saw', `2*PI*${fmt(f)}*${X}`)}+${wave('soft-saw', `2*PI*${fmt(f * 1.0045)}*${X}`)})*${env(X, 0.35)}` },
  // A rounder sine pad with a hint of octave, very slow attack (ambient).
  'air-pad': { rel: 0.6, build: (f, X) => `(sin(2*PI*${fmt(f)}*${X})+0.5*sin(2*PI*${fmt(f * 1.003)}*${X})+0.2*sin(2*PI*${fmt(f * 2.001)}*${X}))*${env(X, 1.2)}` },
  // A string section: soft saw with a gentle vibrato that fades in.
  strings: { rel: 0.35, build: (f, X) => `0.6*${wave('soft-saw', `2*PI*${fmt(f)}*${X}-${fmt((0.004 * f) / 5.2)}*min(${X}/0.6,1)*cos(2*PI*5.2*${X})`)}*${env(X, 0.3)}` },
  // Electric piano: a two-operator FM tine with a fading index.
  epiano: { rel: 0.12, build: (f, X) => `(sin(2*PI*${fmt(f)}*${X}+1.1*${ex(X, 0.4)}*sin(2*PI*${fmt(f)}*${X}))*${ex(X, 1.4)}+0.25*sin(2*PI*${fmt(f * 2)}*${X})*${ex(X, 0.35)})*${env(X, 0.003)}` },
  // A soft piano: harmonics that decay faster the higher they are.
  piano: { rel: 0.12, build: (f, X) => `(${[1, 2, 3, 4, 5].map((n) => `${fmt(1 / n ** 1.4)}*sin(2*PI*${fmt(f * n * (1 + 0.0004 * n * n))}*${X})*${ex(X, 1.6 / (0.6 + 0.7 * n))}`).join('+')})*${env(X, 0.003)}` },
  // A plucked string: bright attack, harmonics dying quickly.
  pluck: { rel: 0.08, build: (f, X) => `(${[1, 2, 3, 4, 5, 6].map((n) => `${fmt(1 / n ** 1.2)}*sin(2*PI*${fmt(f * n * (1 + 0.0006 * n * n))}*${X})*${ex(X, 0.9 / (1 + 1.6 * n))}`).join('+')})*${env(X, 0.002)}` },
  pizz: { rel: 0.05, build: (f, X) => `(${[1, 2, 3, 4].map((n) => `${fmt(1 / n ** 1.3)}*sin(2*PI*${fmt(f * n)}*${X})*${ex(X, 0.35 / (1 + 1.4 * n))}`).join('+')})*${env(X, 0.003)}` },
  // A glassy bell (celesta-like).
  bell: { rel: 0.2, build: (f, X) => `(sin(2*PI*${fmt(f)}*${X})*${ex(X, 1.4)}+0.35*sin(2*PI*${fmt(f * 2.76)}*${X})*${ex(X, 0.45)}+0.12*sin(2*PI*${fmt(f * 5.4)}*${X})*${ex(X, 0.15)})*${env(X, 0.002)}` },
  'saw-lead': { rel: 0.06, build: (f, X) => `${wave('saw', `2*PI*${fmt(f)}*${X}`)}*${ex(X, 0.35)}*${env(X, 0.004)}` },
  'square-lead': { rel: 0.03, build: (f, X) => `${wave('square', `2*PI*${fmt(f)}*${X}`)}*(0.55+0.45*${ex(X, 0.12)})*${env(X, 0.002)}` },
  'triangle-bass': { rel: 0.03, build: (f, X) => `${wave('triangle', `2*PI*${fmt(f)}*${X}`)}*${env(X, 0.003)}` },
  'sub-bass': { rel: 0.06, build: (f, X) => `(sin(2*PI*${fmt(f)}*${X})+0.25*sin(2*PI*${fmt(f * 2)}*${X})*${ex(X, 0.25)})*${env(X, 0.006)}` },
  'synth-bass': { rel: 0.05, build: (f, X) => `${wave('saw', `2*PI*${fmt(f)}*${X}`)}*(0.45+0.55*${ex(X, 0.18)})*${env(X, 0.004)}` },
  'upright-bass': { rel: 0.06, build: (f, X) => `(sin(2*PI*${fmt(f)}*${X})+0.45*sin(2*PI*${fmt(f * 2)}*${X})*${ex(X, 0.12)}+0.15*sin(2*PI*${fmt(f * 3)}*${X})*${ex(X, 0.06)})*${ex(X, 0.9)}*${env(X, 0.008)}` },
  // Drums ignore f.
  // The dance kicks carry a short click so the beat cuts through a busy mix.
  kick: { rel: 0.02, build: (_f, X) => `(sin(2*PI*(48*${X}+90*(1-exp(-28*${X}))/28))*${ex(X, 0.125)}+0.3*(2*random(2)-1)*${ex(X, 0.0025)})*${env(X, 0.002)}` },
  'deep-kick': { rel: 0.02, build: (_f, X) => `(sin(2*PI*(44*${X}+160*(1-exp(-40*${X}))/40))*${ex(X, 0.22)}+0.35*(2*random(2)-1)*${ex(X, 0.002)})*${env(X, 0.0015)}` },
  'soft-kick': { rel: 0.02, build: (_f, X) => `sin(2*PI*(52*${X}+60*(1-exp(-22*${X}))/22))*${ex(X, 0.1)}*${env(X, 0.006)}` },
  snare: { rel: 0.02, build: (_f, X) => `(0.7*(2*random(0)-1)*${ex(X, 0.09)}+0.6*sin(2*PI*185*${X})*${ex(X, 0.06)})*${env(X, 0.001)}` },
  clap: { rel: 0.02, build: (_f, X) => `(2*random(0)-1)*(${ex(X, 0.005)}+gte(${X},0.011)*exp(-(${X}-0.011)/0.005)+gte(${X},0.022)*exp(-(${X}-0.022)/0.09))*${env(X, 0.0008)}` },
  rim: { rel: 0.01, build: (_f, X) => `(sin(2*PI*1650*${X})*${ex(X, 0.012)}+0.5*(2*random(0)-1)*${ex(X, 0.004)})*${env(X, 0.0005)}` },
  hat: { rel: 0.01, build: (_f, X) => `(2*random(1)-1)*${ex(X, 0.028)}*${env(X, 0.0008)}` },
  'open-hat': { rel: 0.02, build: (_f, X) => `(2*random(1)-1)*${ex(X, 0.16)}*${env(X, 0.001)}` },
  shaker: { rel: 0.01, build: (_f, X) => `(2*random(1)-1)*${env(X, 0.012)}*${ex(X, 0.045)}` },
  brush: { rel: 0.02, build: (_f, X) => `(2*random(1)-1)*${env(X, 0.02)}*${ex(X, 0.09)}` },
  tom: { rel: 0.03, build: (_f, X) => `sin(2*PI*(70*${X}+60*(1-exp(-18*${X}))/18))*${ex(X, 0.3)}*${env(X, 0.003)}` },
  timpani: { rel: 0.1, build: (f, X) => `(sin(2*PI*${fmt(f)}*${X})+0.4*sin(2*PI*${fmt(f * 1.5)}*${X})*${ex(X, 0.3)}+0.3*(2*random(0)-1)*${ex(X, 0.02)})*${ex(X, 0.7)}*${env(X, 0.004)}` },
  'chip-kick': { rel: 0.01, build: (_f, X) => `${wave('square', `2*PI*(60*${X}+200*(1-exp(-30*${X}))/30)`)}*${ex(X, 0.06)}*${env(X, 0.001)}` },
  'chip-noise': { rel: 0.01, build: (_f, X) => `(2*floor(random(0)*2)-1)*${ex(X, 0.07)}*${env(X, 0.001)}` }
};

// ---------------------------------------------------------------------------
// Note tracks → expressions.

/** A balanced if() tree over sorted, non-overlapping notes [{at, dur, f, vel}]. */
function tree(notes, inst, detune = 1) {
  const spec = INSTRUMENTS[inst];
  const leaf = (note) => {
    const X = `(t-${fmt(note.at)})`;
    const release = `clip((${fmt(note.dur)}-${X})/${fmt(Math.min(spec.rel, note.dur / 2))},0,1)`;
    return `${fmt(note.vel)}*${spec.build(note.f * detune, X, note.dur)}*${release}`;
  };
  const build = (lo, hi) => {
    if (lo > hi) return '0';
    if (lo === hi) return `if(lt(t,${fmt(notes[lo].at)}),0,if(lt(t,${fmt(notes[lo].at + notes[lo].dur)}),${leaf(notes[lo])},0))`;
    const mid = Math.ceil((lo + hi) / 2);
    return `if(lt(t,${fmt(notes[mid].at)}),${build(lo, mid - 1)},${build(mid, hi)})`;
  };
  return notes.length ? build(0, notes.length - 1) : '0';
}

/**
 * Notes for one instrument → a stereo expression pair. Overlapping notes are
 * spread over as many tracks as needed (a tone rings into the next one).
 */
function trackPair(notes, inst, { stereo = 0.0025 } = {}) {
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  const tracks = [];
  for (const note of sorted) {
    const free = tracks.find((track) => track.at(-1).at + track.at(-1).dur <= note.at + 1e-6);
    if (free) free.push(note);
    else tracks.push([note]);
  }
  const sum = (detune) => tracks.map((track) => tree(track, inst, detune)).join('+') || '0';
  return [sum(1), sum(1 + stereo)];
}

// ---------------------------------------------------------------------------
// The arrangement context a genre recipe writes into.

function context({ genre, bpm, key, progression, seed }) {
  const recipe = RECIPES[genre];
  const r = rng(`${seed}|music|${genre}|${progression}`);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const step = beat / 4;
  let tonic = tonicHz(normalizeKey(key), 3);
  while (tonic > 200) tonic /= 2;
  while (tonic < 100) tonic *= 2;
  const chords = recipe.progressions[progression % recipe.progressions.length];
  const barsPerChord = recipe.barsPerChord(bpm);
  const bars = chords.length * barsPerChord;
  const hz = (semitones, octave = 0) => tonic * semi(semitones + 12 * octave);
  const chordAtBar = (b) => chords[Math.floor(b / barsPerChord) % chords.length];
  const voiced = chords.map(([root, quality]) => voiceChord(root, quality, recipe.centre ?? 5));
  const voicedAtBar = (b) => voiced[Math.floor(b / barsPerChord) % chords.length];
  const human = (vel, amount = 0.12) => vel * (1 - r.range(0, amount));
  const ctx = {
    genre, bpm, key, beat, bar, step, bars, barsPerChord, cycle: bars * bar, r, hz, tonic, chords, voiced, human,
    /** Each chord held (or restruck on `hits` steps of every bar) on every voice. */
    chordNotes({ octave = 1, hits = null, length = null, vel = 0.5, top = 4 } = {}) {
      const notes = [];
      for (let b = 0; b < bars; b++) {
        const tones = voicedAtBar(b).slice(-top);
        if (!hits) {
          if (b % barsPerChord) continue;
          for (const semitone of tones) notes.push({ at: b * bar, dur: bar * barsPerChord, f: hz(semitone, octave), vel: human(vel, 0.05) });
          continue;
        }
        for (const s of hits) for (const semitone of tones) notes.push({ at: b * bar + s * step, dur: (length ?? 2) * step, f: hz(semitone, octave), vel: human(vel) });
      }
      return notes;
    },
    /** Bass: [step, length in steps, interval ("root", "fifth", "octave")] per bar. */
    bassNotes({ pattern, octave = -1, vel = 0.8 }) {
      const notes = [];
      for (let b = 0; b < bars; b++) {
        const root = bassRoot(chordAtBar(b)[0]);
        for (const [s, length, interval = 'root'] of pattern) {
          const semitone = root + (interval === 'fifth' ? 7 : interval === 'octave' ? 12 : 0);
          notes.push({ at: b * bar + s * step, dur: length * step, f: hz(semitone, octave + 1), vel: human(vel, 0.08) });
        }
      }
      return notes;
    },
    /** An arpeggio over the chord tones: order is indexes into the voiced chord, rate in steps. */
    arpNotes({ order, rate = 2, length = null, octave = 1, vel = 0.4, everyBar = null }) {
      const notes = [];
      let i = 0;
      for (let b = 0; b < bars; b++) {
        const tones = voicedAtBar(b);
        for (let s = 0; s < 16; s += rate) {
          if (everyBar && !everyBar.includes(s)) continue;
          const index = order[i++ % order.length];
          const semitone = tones[index % tones.length] + 12 * Math.floor(index / tones.length);
          notes.push({ at: b * bar + s * step, dur: (length ?? rate) * step, f: hz(semitone, octave), vel: human(vel) });
        }
      }
      return notes;
    },
    /** A drum line: steps of every bar (0..15); swing delays the off 8ths (a fraction of a triplet). */
    drumNotes({ steps, vel = 0.8, swing = 0, length = 4, accent = null, skipLastBar = false }) {
      const notes = [];
      for (let b = 0; b < bars; b++) {
        if (skipLastBar && b === bars - 1) continue;
        for (const s of steps) {
          const offbeat = s % 4 === 2 ? swing * (beat / 6) : 0;
          const level = accent ? (accent.includes(s) ? 1 : 0.6) : 1;
          notes.push({ at: b * bar + s * step + offbeat, dur: length * step, f: 0, vel: human(vel * level, 0.15) });
        }
      }
      return notes;
    }
  };
  return ctx;
}

/**
 * A stem: notes played by an instrument, its role, filters, reverb send and
 * level: the loudness (LUFS) the stem plays at on its own. The kit renders
 * one cycle, measures it and sets the gain, so every voicing, progression
 * and seed comes out balanced the same way.
 */
const stem = (name, inst, notes, { role = 'always', level = -24, filter = 'anull', send = 0, stereo } = {}) => ({ name, role, level, filter, send, expr: trackPair(notes, inst, { stereo: stereo ?? (inst.includes('kick') || inst.includes('bass') ? 0 : 0.0025) }) });

// ---------------------------------------------------------------------------
// The genres. barsPerChord(bpm), progressions [[root, quality]...] relative
// to the key's tonic, and build(ctx) → {stems, master, room}.

const slowChords = (bpm) => (bpm < 100 ? 1 : 2);

const RECIPES = {
  ambient: {
    barsPerChord: () => 2,
    progressions: [
      [[0, 'add9'], [9, 'min7'], [5, 'maj7'], [7, 'sus4']],
      [[0, 'maj7'], [4, 'min7'], [5, 'maj9'], [5, 'min7']],
      [[9, 'min9'], [5, 'maj7'], [0, 'add9'], [7, 'sus2']],
      [[0, 'sus2'], [2, 'add9'], [9, 'min7'], [5, 'maj7']]
    ],
    build(c) {
      const sparkle = c.r.pick(['bell', 'pluck', 'piano']);
      const order = c.r.pick([[0, 2, 1, 3, 4, 2], [0, 1, 2, 3, 2, 1], [4, 2, 0, 3, 1]]);
      return {
        stems: [
          stem('pad', 'air-pad', c.chordNotes({ vel: 0.35 }), { level: -20, filter: 'lowpass=f=2200', send: 0.8 }),
          stem('sparkle', sparkle, c.arpNotes({ order, rate: c.r.pick([4, 6]), length: 8, octave: 2, vel: 0.22 }), { level: -26, filter: 'highpass=f=250,lowpass=f=5000', send: 1 }),
          stem('bass', 'sub-bass', c.bassNotes({ pattern: [[0, 16]], vel: 0.55 }), { role: 'bass', level: -23, filter: 'lowpass=f=300' }),
          stem('pulse', 'soft-kick', c.drumNotes({ steps: [0, 8], vel: 0.6 }), { role: 'drums', level: -24, filter: 'lowpass=f=600' }),
          stem('shaker', 'shaker', c.drumNotes({ steps: [2, 6, 10, 14], vel: 0.25 }), { role: 'drums', level: -34, filter: 'bandpass=f=6000:width_type=q:w=0.8,lowpass=f=9000' })
        ],
        room: { seconds: 3.5, tone: 3500, mix: 0.6 },
        master: 'highpass=f=30'
      };
    }
  },
  'lo-fi': {
    barsPerChord: () => 1,
    progressions: [
      [[2, 'min9'], [7, 'dom7'], [0, 'maj9'], [9, 'min7']],
      [[5, 'maj7'], [4, 'min7'], [2, 'min7'], [0, 'maj7']],
      [[0, 'maj7'], [9, 'min9'], [2, 'min7'], [7, 'sus4']],
      [[9, 'min9'], [2, 'min9'], [7, 'dom7'], [0, 'maj9']]
    ],
    build(c) {
      const keys = c.r.pick(['epiano', 'piano']);
      const comp = c.r.pick([[0, 7], [0, 6, 10], [2, 10]]);
      const swing = c.r.range(0.45, 0.7);
      return {
        stems: [
          stem('keys', keys, c.chordNotes({ hits: comp, length: 5, vel: 0.42 }), { level: -20, filter: 'lowpass=f=3200', send: 0.4 }),
          stem('bass', 'upright-bass', c.bassNotes({ pattern: [[0, 6], [7, 3, c.r.pick(['root', 'fifth'])], [10, 5, 'fifth']], vel: 0.75 }), { role: 'bass', level: -21, filter: 'lowpass=f=700' }),
          stem('kick', 'soft-kick', c.drumNotes({ steps: [0, 7, 10], vel: 0.85, accent: [0] }), { role: 'drums', level: -21, filter: 'lowpass=f=900' }),
          stem('snare', 'snare', c.drumNotes({ steps: [4, 12], vel: 0.55 }), { role: 'drums', level: -26, filter: 'highpass=f=180,lowpass=f=4500', send: 0.3 }),
          stem('hats', 'hat', c.drumNotes({ steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: 0.35, swing, accent: [0, 4, 8, 12] }), { role: 'drums', level: -32, filter: 'highpass=f=5000,lowpass=f=8500' })
        ],
        // Dusty tape: a slow wow and a soft top.
        master: 'vibrato=f=0.6:d=0.012,lowpass=f=6500,highpass=f=35',
        room: { seconds: 1.2, tone: 3000, mix: 0.3 },
        crackle: 0.012
      };
    }
  },
  house: {
    barsPerChord: () => 1,
    centre: 7,
    progressions: [
      [[0, 'min7'], [8, 'maj7'], [3, 'maj'], [10, 'maj']],
      [[0, 'min9'], [0, 'min9'], [5, 'min9'], [5, 'min9']],
      [[0, 'min7'], [10, 'maj'], [8, 'maj7'], [10, 'sus4']],
      [[8, 'maj9'], [10, 'add9'], [0, 'min7'], [0, 'min9']]
    ],
    build(c) {
      const stabs = c.r.pick([[2, 6, 10, 14], [3, 6, 11, 14], [2, 10]]);
      const keys = c.r.pick(['epiano', 'pad', 'piano']);
      return {
        stems: [
          stem('stabs', keys, c.chordNotes({ hits: stabs, length: 2, vel: 0.4 }), { role: 'pumped', level: -24, filter: 'highpass=f=180,lowpass=f=4200', send: 0.35 }),
          stem('pad', 'pad', c.chordNotes({ vel: 0.18 }), { role: 'pumped', level: -26, filter: 'lowpass=f=1800', send: 0.5 }),
          stem('bass', 'synth-bass', c.bassNotes({ pattern: [[2, 2], [6, 2], [10, 2, c.r.pick(['root', 'octave'])], [14, 2]], vel: 0.7 }), { role: 'bass', level: -21, filter: 'lowpass=f=520' }),
          stem('kick', 'deep-kick', c.drumNotes({ steps: [0, 4, 8, 12], vel: 0.95, accent: [0] }), { role: 'drums', level: -17, filter: 'lowpass=f=5000' }),
          stem('clap', 'clap', c.drumNotes({ steps: [4, 12], vel: 0.6 }), { role: 'drums', level: -25, filter: 'bandpass=f=1300:width_type=q:w=0.9', send: 0.4 }),
          stem('hats', 'open-hat', c.drumNotes({ steps: [2, 6, 10, 14], vel: 0.35, length: 2 }), { role: 'drums', level: -31, filter: 'highpass=f=6500,lowpass=f=11000' }),
          stem('ticks', 'hat', c.drumNotes({ steps: [1, 3, 5, 7, 9, 11, 13, 15], vel: 0.18 }), { role: 'drums', level: -34, filter: 'highpass=f=7500,lowpass=f=11000' })
        ],
        master: 'highpass=f=30',
        room: { seconds: 1.4, tone: 4500, mix: 0.25 },
        pump: 0.55
      };
    }
  },
  synthwave: {
    barsPerChord: slowChords,
    progressions: [
      [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']],
      [[8, 'maj7'], [10, 'maj'], [0, 'min'], [0, 'min']],
      [[0, 'min'], [5, 'min'], [8, 'maj'], [7, 'maj']],
      [[0, 'min7'], [10, 'maj'], [8, 'maj'], [10, 'sus4']]
    ],
    build(c) {
      const order = c.r.pick([[0, 1, 2, 3], [0, 2, 1, 3], [0, 1, 2, 1], [0, 2, 3, 2]]);
      return {
        stems: [
          stem('pad', 'pad', c.chordNotes({ vel: 0.32 }), { level: -21, filter: 'lowpass=f=2600,chorus=0.7:0.9:45|60:0.35|0.28:0.3|0.4:1.4|1.9', send: 0.6 }),
          stem('arp', 'saw-lead', c.arpNotes({ order, rate: 2, length: 2, octave: 1, vel: 0.28 }), { role: 'lead', level: -25, filter: 'lowpass=f=3200', send: 0.5 }),
          stem('bass', 'synth-bass', c.bassNotes({ pattern: [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, 2, i % 2 ? 'octave' : 'root']), vel: 0.6 }), { role: 'bass', level: -22, filter: 'lowpass=f=650' }),
          stem('kick', 'kick', c.drumNotes({ steps: [0, 8], vel: 0.95, accent: [0] }), { role: 'drums', level: -19, filter: 'lowpass=f=5000' }),
          stem('snare', 'snare', c.drumNotes({ steps: [4, 12], vel: 0.65 }), { role: 'drums', level: -24, filter: 'highpass=f=160,lowpass=f=6000', send: 1 }),
          stem('hats', 'hat', c.drumNotes({ steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: 0.3 }), { role: 'drums', level: -31, filter: 'highpass=f=6500,lowpass=f=10000' })
        ],
        master: 'highpass=f=30',
        room: { seconds: 2.2, tone: 5000, mix: 0.35 }
      };
    }
  },
  'acoustic-pluck': {
    barsPerChord: slowChords,
    progressions: [
      [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
      [[0, 'maj'], [5, 'maj'], [9, 'min'], [7, 'maj']],
      [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']],
      [[0, 'add9'], [4, 'min'], [5, 'maj'], [7, 'sus4']]
    ],
    build(c) {
      const order = c.r.pick([[0, 2, 1, 2, 3, 2, 1, 2], [0, 1, 2, 3, 2, 1, 2, 3], [0, 2, 3, 2, 1, 2, 3, 2]]);
      return {
        stems: [
          stem('guitar', 'pluck', c.arpNotes({ order, rate: 2, length: 6, octave: 1, vel: 0.5 }), { level: -20, filter: 'highpass=f=120,lowpass=f=5200', send: 0.35 }),
          stem('pad', 'strings', c.chordNotes({ vel: 0.12 }), { level: -27, filter: 'lowpass=f=2000', send: 0.6 }),
          stem('bass', 'upright-bass', c.bassNotes({ pattern: [[0, 7], [8, 7, c.r.pick(['root', 'fifth'])]], vel: 0.65 }), { role: 'bass', level: -23, filter: 'lowpass=f=600' }),
          stem('kick', 'soft-kick', c.drumNotes({ steps: [0, 8], vel: 0.7 }), { role: 'drums', level: -23, filter: 'lowpass=f=800' }),
          stem('rim', 'rim', c.drumNotes({ steps: [4, 12], vel: 0.4 }), { role: 'drums', level: -29, filter: 'highpass=f=600,lowpass=f=6000', send: 0.3 }),
          stem('shaker', 'shaker', c.drumNotes({ steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: 0.3, accent: [2, 6, 10, 14] }), { role: 'drums', level: -31, filter: 'bandpass=f=5500:width_type=q:w=0.7,lowpass=f=9000' })
        ],
        master: 'highpass=f=35',
        room: { seconds: 1.1, tone: 4000, mix: 0.25 }
      };
    }
  },
  'cinematic-pulse': {
    barsPerChord: () => 2,
    progressions: [
      [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'sus4']],
      [[0, 'min'], [0, 'min'], [8, 'add9'], [8, 'maj7']],
      [[0, 'min'], [7, 'min'], [8, 'maj'], [5, 'min']],
      [[8, 'maj'], [10, 'maj'], [0, 'min'], [0, 'sus2']]
    ],
    build(c) {
      const ostinato = c.r.pick([[0, 0, 1, 0], [0, 1, 0, 2], [0, 0, 2, 1]]);
      return {
        stems: [
          stem('strings', 'strings', c.chordNotes({ vel: 0.35 }), { level: -20, filter: 'lowpass=f=2400', send: 0.7 }),
          stem('pulse', 'pizz', c.arpNotes({ order: ostinato, rate: 2, length: 2, octave: 0, vel: 0.5 }), { role: 'bass', level: -24, filter: 'highpass=f=90,lowpass=f=2400', send: 0.4 }),
          stem('low', 'sub-bass', c.bassNotes({ pattern: [[0, 16]], vel: 0.6 }), { role: 'bass', level: -23, filter: 'lowpass=f=200' }),
          stem('heartbeat', 'soft-kick', c.drumNotes({ steps: [0, 4, 8, 12], vel: 0.8, accent: [0, 8] }), { role: 'drums', level: -22, filter: 'lowpass=f=900' }),
          stem('boom', 'tom', c.drumNotes({ steps: c.r.pick([[0, 10], [0, 6, 8], [0, 3, 8, 11]]), vel: 0.9, accent: [0] }), { role: 'drums', level: -23, filter: 'lowpass=f=700', send: 0.5 }),
          stem('tick', 'rim', c.drumNotes({ steps: [2, 6, 10, 14], vel: 0.25 }), { role: 'drums', level: -33, filter: 'highpass=f=900,lowpass=f=6000' })
        ],
        master: 'highpass=f=28',
        room: { seconds: 3, tone: 3500, mix: 0.45 }
      };
    }
  },
  chiptune: {
    barsPerChord: () => 1,
    progressions: [
      [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
      [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']],
      [[5, 'maj'], [7, 'maj'], [4, 'min'], [9, 'min']],
      [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']]
    ],
    build(c) {
      const order = c.r.pick([[0, 1, 2, 3, 2, 1], [0, 2, 1, 3], [0, 1, 2, 4, 2, 1, 0, 3]]);
      return {
        stems: [
          stem('chords', 'square-lead', c.chordNotes({ hits: [0, 3, 6, 10, 12], length: 2, vel: 0.16, top: 3 }), { level: -24, filter: 'lowpass=f=3500' }),
          stem('arp', 'square-lead', c.arpNotes({ order, rate: 1, length: 1, octave: 1, vel: 0.2 }), { role: 'lead', level: -25, filter: 'lowpass=f=4200' }),
          stem('bass', 'triangle-bass', c.bassNotes({ pattern: [[0, 2], [2, 2, 'octave'], [4, 2], [6, 2, 'octave'], [8, 2], [10, 2, 'octave'], [12, 2, 'fifth'], [14, 2, 'octave']], vel: 0.7 }), { role: 'bass', level: -22, filter: 'lowpass=f=1500' }),
          stem('kick', 'chip-kick', c.drumNotes({ steps: [0, 4, 8, 12], vel: 0.7, accent: [0, 8] }), { role: 'drums', level: -19, filter: 'lowpass=f=2000' }),
          stem('noise', 'chip-noise', c.drumNotes({ steps: [4, 12], vel: 0.5, length: 3 }), { role: 'drums', level: -26, filter: 'highpass=f=1200,lowpass=f=7000' }),
          stem('hats', 'chip-noise', c.drumNotes({ steps: [2, 6, 10, 14], vel: 0.2, length: 1 }), { role: 'drums', level: -32, filter: 'highpass=f=5000,lowpass=f=9000' })
        ],
        master: 'highpass=f=40,acrusher=bits=8:samples=1:mode=lin:aa=1:mix=0.5',
        room: null
      };
    }
  },
  'jazz-hop': {
    barsPerChord: () => 1,
    progressions: [
      [[0, 'min9'], [5, 'min9'], [10, 'dom7'], [3, 'maj9']],
      [[2, 'min7'], [7, 'dom7'], [0, 'min9'], [0, 'min9']],
      [[8, 'maj7'], [7, 'min7'], [5, 'min7'], [0, 'min9']],
      [[0, 'min9'], [8, 'maj9'], [5, 'min9'], [7, 'min7']]
    ],
    build(c) {
      const comp = c.r.pick([[0, 6, 11], [2, 7, 14], [0, 10]]);
      const swing = c.r.range(0.55, 0.8);
      return {
        stems: [
          stem('keys', c.r.pick(['epiano', 'piano']), c.chordNotes({ hits: comp, length: 4, vel: 0.4 }), { level: -20, filter: 'lowpass=f=3600', send: 0.45 }),
          stem('bass', 'upright-bass', c.bassNotes({ pattern: [[0, 4], [4, 4, 'fifth'], [8, 4, 'octave'], [12, 4, c.r.pick(['fifth', 'root'])]], vel: 0.7 }), { role: 'bass', level: -21, filter: 'lowpass=f=800' }),
          stem('kick', 'soft-kick', c.drumNotes({ steps: [0, 10], vel: 0.85, accent: [0] }), { role: 'drums', level: -21, filter: 'lowpass=f=900' }),
          stem('snare', 'snare', c.drumNotes({ steps: [4, 12], vel: 0.5 }), { role: 'drums', level: -25, filter: 'highpass=f=200,lowpass=f=5000', send: 0.35 }),
          stem('brush', 'brush', c.drumNotes({ steps: [0, 2, 4, 6, 8, 10, 12, 14], vel: 0.3, swing, accent: [0, 4, 8, 12] }), { role: 'drums', level: -33, filter: 'bandpass=f=4500:width_type=q:w=0.6,lowpass=f=8000' })
        ],
        master: 'vibrato=f=0.45:d=0.008,lowpass=f=7500,highpass=f=35',
        room: { seconds: 1.3, tone: 3200, mix: 0.3 },
        crackle: 0.006
      };
    }
  },
  'orchestral-lite': {
    barsPerChord: slowChords,
    progressions: [
      [[0, 'maj'], [5, 'maj'], [9, 'min'], [7, 'maj']],
      [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
      [[5, 'maj'], [0, 'maj'], [7, 'maj'], [9, 'min']],
      [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'sus4']]
    ],
    build(c) {
      const order = c.r.pick([[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1]]);
      return {
        stems: [
          stem('strings', 'strings', c.chordNotes({ vel: 0.32 }), { level: -20, filter: 'lowpass=f=2800', send: 0.7 }),
          stem('pizz', 'pizz', c.arpNotes({ order, rate: 2, length: 2, octave: 1, vel: 0.4 }), { role: 'lead', level: -24, filter: 'highpass=f=150,lowpass=f=4000', send: 0.5 }),
          stem('celli', 'strings', c.bassNotes({ pattern: [[0, 8], [8, 8, c.r.pick(['root', 'fifth'])]], vel: 0.45 }), { role: 'bass', level: -25, filter: 'lowpass=f=900', send: 0.4 }),
          stem('timpani', 'timpani', c.bassNotes({ pattern: [[0, 8]], octave: 0, vel: 0.6 }), { role: 'drums', level: -24, filter: 'lowpass=f=600', send: 0.6 }),
          stem('celesta', 'bell', c.arpNotes({ order: [0, 2, 3, 1], rate: 8, length: 8, octave: 2, vel: 0.12 }), { role: 'lead', level: -30, filter: 'lowpass=f=5000', send: 0.8 })
        ],
        master: 'highpass=f=30',
        room: { seconds: 2.8, tone: 3800, mix: 0.45 }
      };
    }
  }
};

for (const genre of MUSIC_GENRES) if (!RECIPES[genre]) throw new Error(`music genre ${genre} has no recipe`);

/** {genre, bpm, key, progression} with defaults filled and values clamped. */
export function musicChoice({ genre, bpm, key, progression } = {}, seed = 'launchclip') {
  if (!MUSIC_GENRES.includes(genre)) throw new Error(`Unknown music genre "${genre}". Genres: ${MUSIC_GENRES.join(', ')}`);
  const spec = GENRE_SPECS[genre];
  const r = rng(`${seed}|music-choice|${genre}`);
  const tempo = Number.isFinite(Number(bpm)) && Number(bpm) > 0 ? Number(bpm) : Math.round(r.range(spec.bpm[0], spec.bpm[1]));
  const tonic = key ? normalizeKey(key) : r.pick(spec.keys);
  if (!MUSIC_KEYS.includes(tonic)) throw new Error(`Unknown key "${key}". Keys: ${MUSIC_KEYS.join(', ')}`);
  const index = Number.isInteger(progression) ? progression : r.int(0, spec.progressions - 1);
  return { genre, bpm: tempo, key: tonic, progression: index % spec.progressions };
}

/**
 * A genre bed's render plan: {genre, bpm, key, progression, beat, cycle,
 * stems: [{name, role, level, filter, send, expr: [L, R]}], master, room,
 * pump, crackle}.
 */
export function genreBed(choice, seed = 'launchclip') {
  const full = musicChoice(choice, seed);
  const ctx = context({ ...full, seed });
  const built = RECIPES[full.genre].build(ctx);
  return {
    ...full,
    beat: ctx.beat,
    cycle: ctx.cycle,
    stems: built.stems,
    master: built.master,
    room: built.room ?? null,
    pump: built.pump ?? 0,
    crackle: built.crackle ?? 0
  };
}
