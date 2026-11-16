// Data sonification for the chart modules (IMMERSIVE_SOUND_RFC §5): a chart's
// build plays its data as Karplus-Strong plucks, each note on the frame its
// point draws. Off unless the story asks (audio.sound.sonify: true); finish
// then renders one file per chart scene and drops that scene's tally.
//
// Pitch follows the value in the bed's key: the low third snaps to the major
// pentatonic, the middle to semitones and the top glides freely, so ordinary
// data sounds consonant and extremes sound strained. A note rings until the
// next one (70–750 ms) and a longer gap plucks harder. Shapes: bars, stacks,
// area and sparkline points one note each, panned by x (area and line
// sparklines add a soft glide under the notes); pie slices build a chord;
// radar plays an arpeggio per series; a progress ring climbs to its value.
// A highlight replays its note an octave up.
import { RATE, semi, tonicHz } from './dsp.mjs';
import { karplusStrong } from './music.mjs';
import { normalizeKey } from './options.mjs';
import { getEase } from '../motion.mjs';

export const SONIFY_MODULES = Object.freeze(['bar-chart', 'stacked-bar', 'pie-chart', 'area-chart', 'radar-chart', 'sparkline', 'progress-ring']);

const PENTATONIC = [0, 2, 4, 7, 9];
const RANGE = 24;
const MIN_RING = 0.07, MAX_RING = 0.75;
const MAX_POINTS = 16;
// Peak of a rendered chart, like an SFX variant (−6 dBFS); the mix sets its level.
const PEAK = 0.5;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const spread = (i, n) => (n > 1 ? -0.6 + 1.2 * i / (n - 1) : 0);
const norm = (values, floor = null) => {
  const lo = floor ?? Math.min(...values), hi = Math.max(...values);
  return (v) => (hi > lo ? clamp01((v - lo) / (hi - lo)) : 0.5);
};

/** A value in 0–1 → semitones above the tonic (0–24): pentatonic low, semitones in the middle, free at the top. */
export function pitchSemitones(v) {
  const s = clamp01(v) * RANGE;
  if (v < 1 / 3) {
    const notes = [0, 1, 2].flatMap((octave) => PENTATONIC.map((n) => n + 12 * octave));
    return notes.reduce((best, n) => (Math.abs(n - s) < Math.abs(best - s) ? n : best));
  }
  return v < 2 / 3 ? Math.round(s) : s;
}

/** The tonic of the sonification: the key's note between G3 and F#4. */
function tonic(key) {
  let hz = tonicHz(normalizeKey(key ?? 'C'), 3);
  while (hz < 190) hz *= 2;
  while (hz >= 380) hz /= 2;
  return hz;
}

/** The time an eased reveal from `at` over `duration` reaches progress p (bisection on the ease). */
function revealTime(ease, at, duration, p) {
  const fn = getEase(ease);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) < p) lo = mid; else hi = mid;
  }
  return at + duration * hi;
}

/** At most MAX_POINTS indexes of n, always the first and last. */
function thin(n) {
  const k = Math.ceil(n / MAX_POINTS);
  return Array.from({ length: n }, (_, j) => j).filter((j) => j % k === 0 || j === n - 1);
}

const SHAPES = {
  'bar-chart'(c, p) {
    const values = p.data.map((row) => row.value);
    const v = norm(values, 0);
    const notes = c.bars.map((bar, i) => ({ at: bar.time, v: v(values[i]), pan: spread(i, values.length) }));
    if (c.highlight !== null && c.highlight !== undefined) notes.push({ ...notes[c.highlight], at: c.highlightAt, octave: 1, highlight: true });
    return { notes };
  },
  'stacked-bar'(c, p) {
    const values = c.segments.map((seg) => p.series[seg.series].values[seg.category]);
    const v = norm(values, 0);
    return { notes: c.segments.map((seg, i) => ({ at: seg.time, v: v(values[i]), pan: spread(seg.category, p.categories.length) })) };
  },
  'pie-chart'(c, p) {
    // A chord, slice by slice: each slice adds the next chord tone and rings to the end of the build; a bigger slice plucks harder.
    const CHORD = [0, 4, 7, 12, 16, 19];
    const total = p.data.reduce((sum, row) => sum + row.value, 0);
    const end = Math.max(c.buildEnd, ...c.slices.map((s) => s.time)) + MAX_RING;
    const notes = c.slices.map((slice, i) => ({ at: slice.time, semitones: CHORD[i], vel: 0.45 + 0.4 * clamp01(p.data[i].value / total * 2), ring: Math.min(2, end - slice.time), pan: spread(i, c.slices.length) * 0.5 }));
    if (c.highlight !== null && c.highlight !== undefined) notes.push({ ...notes[c.highlight], at: c.highlightAt, octave: 1, ring: MAX_RING, highlight: true });
    return { notes };
  },
  'area-chart'(c, p) {
    const n = p.labels.length;
    const v = norm(p.series.flatMap((s) => s.values));
    const notes = [], glides = [];
    p.series.forEach((s, i) => {
      const points = thin(n).map((j) => ({ at: revealTime('power2.inOut', c.buildAt, c.reveal, j / (n - 1)), v: v(s.values[j]), pan: spread(j, n), voice: i }));
      notes.push(...points);
      glides.push(points);
    });
    return { notes, glides };
  },
  'radar-chart'(c, p) {
    const values = p.series.flatMap((s) => s.values);
    const v = norm(values, 0);
    const max = p.max ?? Math.max(...values);
    // An arpeggio round the axes, on the frames the dots variant pops its points.
    return { notes: c.shapes.flatMap((shape, i) => p.series[i].values.map((value, j) => ({ at: shape.time + 0.45 + j * 0.04, v: p.max ? clamp01(value / max) : v(value), pan: spread(j, p.axes.length) * 0.5, voice: i }))) };
  },
  sparkline(c, p) {
    const n = p.values.length;
    const v = norm(p.values);
    if (c.bars) return { notes: thin(n).map((j) => ({ at: c.buildAt + 1.0 * j / n, v: v(p.values[j]), pan: spread(j, n) })) };
    const points = thin(n).map((j) => ({ at: revealTime('power2.inOut', c.buildAt, 1.2, j / (n - 1)), v: v(p.values[j]), pan: spread(j, n) }));
    return { notes: points, glides: [points] };
  },
  'progress-ring'(c) {
    // A rising line in tenths of the ring, stopping on the value as the fill lands.
    if (c.segments) {
      const lit = c.segments.map((seg, i) => ({ seg, i })).filter(({ seg }) => seg.on);
      const kept = lit.filter((_, k) => k % 4 === 0 || k === lit.length - 1);
      return { notes: kept.map(({ seg, i }) => ({ at: seg.time, v: (i + 0.5) / c.segments.length, pan: 0 })) };
    }
    const steps = [];
    for (let g = 0.1; g < c.frac - 0.05; g += 0.1) steps.push(g);
    steps.push(c.frac);
    return { notes: steps.map((g) => ({ at: g >= c.frac ? c.fill.at + c.fill.duration : revealTime(c.fill.ease, c.fill.at, c.fill.duration, g / c.frac), v: g, pan: 0 })) };
  }
};

/**
 * A chart scene's notes: {notes: [{at, f, dur, vel, pan, highlight?}], glides:
 * [[{at, f}]]}, times in story seconds; null for a module that is not a chart.
 * model: the resolved module; params: the scene's params; key: the bed's key.
 */
export function chartNotes(model, params, { key = 'C' } = {}) {
  const shape = SHAPES[model?.module];
  if (!shape) return null;
  const root = tonic(key);
  const { notes, glides = [] } = shape(model.content, params);
  const hz = (note) => root * semi((note.semitones ?? pitchSemitones(note.v)) + 12 * (note.octave ?? 0));
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  const out = sorted.map((note, i) => {
    // The ring follows the gap to the next note of the same voice.
    const next = sorted.slice(i + 1).find((other) => (other.voice ?? 0) === (note.voice ?? 0) && other.at > note.at + 1e-6);
    const gap = next ? next.at - note.at : MAX_RING;
    const dur = note.ring ?? Math.min(MAX_RING, Math.max(MIN_RING, gap));
    const vel = note.vel ?? 0.45 + 0.4 * clamp01((gap - MIN_RING) / (MAX_RING - MIN_RING));
    return { at: note.at, f: hz(note), dur, vel, pan: note.pan ?? 0, ...(note.highlight ? { highlight: true } : {}) };
  });
  return { notes: out, glides: glides.filter((line) => line.length > 1).map((line) => line.map((point) => ({ at: point.at, f: hz(point) / 2 }))) };
}

/**
 * Render chart notes to stereo samples: {start (story seconds of sample 0),
 * channels: [L, R]}, peak at −6 dBFS. Deterministic for a seed.
 */
export function renderSonification({ notes, glides = [] }, { seed = 'sonify', rate = RATE } = {}) {
  if (!notes.length) return null;
  const start = Math.min(...notes.map((note) => note.at));
  const end = Math.max(...notes.map((note) => note.at + note.dur)) + 0.05;
  const length = Math.ceil((end - start) * rate);
  const left = new Float32Array(length), right = new Float32Array(length);
  notes.forEach((note, i) => {
    const pluck = karplusStrong({ f: note.f, dur: note.dur, vel: note.vel, seed: `${seed}|${i}`, rate });
    const offset = Math.round((note.at - start) * rate);
    const angle = (note.pan + 1) * Math.PI / 4;
    const gl = Math.cos(angle), gr = Math.sin(angle);
    for (let k = 0; k < pluck.length && offset + k < length; k++) {
      left[offset + k] += pluck[k] * gl;
      right[offset + k] += pluck[k] * gr;
    }
  });
  // The glide: a quiet sine that slides from point to point under the notes.
  for (const line of glides) {
    const a = Math.round((line[0].at - start) * rate), b = Math.round((line.at(-1).at - start) * rate);
    const fadeIn = 0.06 * rate, fadeOut = 0.25 * rate;
    let phase = 0, seg = 0;
    for (let k = a; k < Math.min(length, b + fadeOut); k++) {
      const t = start + k / rate;
      while (seg < line.length - 2 && t >= line[seg + 1].at) seg++;
      const p0 = line[seg], p1 = line[seg + 1];
      const f = p0.f * (p1.f / p0.f) ** clamp01((t - p0.at) / (p1.at - p0.at));
      phase += 2 * Math.PI * f / rate;
      const level = 0.12 * Math.min(1, (k - a) / fadeIn) * (k > b ? 1 - (k - b) / fadeOut : 1);
      const value = level * Math.sin(phase);
      left[k] += value * Math.SQRT1_2;
      right[k] += value * Math.SQRT1_2;
    }
  }
  let peak = 0;
  for (let k = 0; k < length; k++) peak = Math.max(peak, Math.abs(left[k]), Math.abs(right[k]));
  const gain = peak ? PEAK / peak : 0;
  for (let k = 0; k < length; k++) { left[k] *= gain; right[k] *= gain; }
  return { start, channels: [left, right] };
}
