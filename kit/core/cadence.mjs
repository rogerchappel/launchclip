// Cadence measures from a resolved storyboard (docs/VIDEO_QUALITY_RFC.md §5.2).
//
//   storyboardMeasures(resolved, {sections, face}) → {coverage, face_time, …,
//     intervals: {graphic, face, undressed}}
//
// For a LaunchClip render these are exact: the storyboard says what is on
// screen and when, so coverage is the union of the designed scenes, face time
// is the base minus the full-frame inserts, and the longest undressed run is
// the longest gap in that union. References have no storyboard; their
// coverage is estimated from pixels (src/cadence_measures.js).
//
// Visual-event cadence (the beat director's planning gate, and the eval
// scorecard on rendered frames):
//
//   CADENCE_BENCHMARK                    the long-form reference's numbers
//   CADENCE_TARGETS[format]              per-format bands; cadenceTarget(format, style)
//   eventStats(events, {duration, cuts}) → {events, per_min, gap, longest_static, cut_gap}
//   cadenceGate(stats, target)           → {ok, checks}; cadenceReport(gate) → text
//
// Pure ESM; imports only kit/core siblings. Canonical copy: kit/core/cadence.mjs.

import { storyBase, storySections } from './story.mjs';
import { isSubjectEffect } from './modules.mjs';

// Modules that move the camera or the room without drawing a graphic: they
// change the picture, so they count as visual changes, but not as coverage.
export const CAMERA_ONLY_MODULES = Object.freeze(['punch-in', 'zoom-through', 'dolly-zoom']);
// Changes closer than this are one visual change.
const MERGE_SECONDS = 0.25;
// Modules that reset attention wherever they play (long form, RFC §10.2).
export const RESET_MODULES = Object.freeze(['section-card']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Whether a scene draws a designed graphic (not only a camera or room move). */
export function isGraphicScene(scene) {
  return Boolean(scene) && !CAMERA_ONLY_MODULES.includes(scene.module);
}

/** Merge [start, end] intervals; returns sorted, non-overlapping intervals. */
export function unionIntervals(intervals) {
  const sorted = intervals.filter(([a, b]) => finite(a) && finite(b) && b > a).map(([a, b]) => [a, b]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [a, b] of sorted) {
    if (out.length && a <= out.at(-1)[1] + 1e-9) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** [start, end] clipped to [0, duration]. */
function clip([a, b], duration) {
  return [Math.max(0, a), Math.min(duration, b)];
}

/** The gaps of a union inside [0, duration]. */
export function gapsOf(union, duration) {
  const gaps = [];
  let cursor = 0;
  for (const [a, b] of union) {
    if (a > cursor + 1e-9) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (duration > cursor + 1e-9) gaps.push([cursor, duration]);
  return gaps;
}

const total = (intervals) => intervals.reduce((sum, [a, b]) => sum + (b - a), 0);

/**
 * Measures for one resolved story (numeric scene times).
 * options:
 *   sections: [{start, end, layout}] (a direction map's sections) for layout changes;
 *   face: optional face data, [{start, end}] intervals where the face is
 *     visible in the base, or a function (t) → boolean; without it the face
 *     is taken to be visible wherever the base shows.
 * Returns the profile measures that a storyboard can answer exactly, plus
 * the intervals they came from.
 */
export function storyboardMeasures(story, { sections = null, face = null } = {}) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  if (!(duration > 0)) throw new Error('storyboardMeasures needs a resolved story with a duration');
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : [])
    .filter((scene) => finite(Number(scene?.start)) && finite(Number(scene?.end)) && Number(scene.end) > Number(scene.start))
    .map((scene) => ({ ...scene, start: Number(scene.start), end: Number(scene.end) }));
  const footage = Boolean(storyBase(story));
  const graphic = unionIntervals(scenes.filter(isGraphicScene).map((scene) => clip([scene.start, scene.end], duration)));
  const undressed = gapsOf(graphic, duration);
  const inserts = unionIntervals(scenes.filter((scene) => scene.insert === true).map((scene) => clip([scene.start, scene.end], duration)));
  let faceIntervals = [];
  if (footage) {
    const shown = gapsOf(inserts, duration);
    faceIntervals = face ? intersect(shown, faceVisible(face, duration)) : shown;
  }
  const changes = visualChanges(scenes, duration);
  const edges = [0, ...changes, duration];
  const shots = [];
  for (let i = 1; i < edges.length; i += 1) if (edges[i] - edges[i - 1] > 1e-6) shots.push(edges[i] - edges[i - 1]);
  const holds = scenes.filter(isGraphicScene).map((scene) => Math.min(duration, scene.end) - Math.max(0, scene.start)).filter((value) => value > 0);
  const subject = unionIntervals(scenes.filter((scene) => isSubjectEffect(scene)).map((scene) => clip([scene.start, scene.end], duration)));
  const minutes = duration / 60;
  const resets = resetTimes(story, scenes, { sections, inserts, duration });
  return {
    duration_seconds: round(duration),
    lane: story?.lane ?? null,
    coverage: round(total(graphic) / duration, 4),
    face_time: footage ? round(total(faceIntervals) / duration, 4) : null,
    longest_undressed_seconds: round(undressed.reduce((max, [a, b]) => Math.max(max, b - a), 0)),
    first_visual_seconds: graphic.length ? round(graphic[0][0]) : null,
    visual_changes_per_min: round(changes.length / minutes, 2),
    shot_seconds: distribution(shots),
    text_hold_seconds: holds.length ? distribution(holds) : null,
    layout_changes_per_min: round(layoutChanges(sections, inserts, duration) / minutes, 2),
    longest_without_reset_seconds: round(resetGaps(resets, duration).reduce((max, [a, b]) => Math.max(max, b - a), 0)),
    reset_times: resets.map((t) => round(t)),
    subject_effect_share: footage ? round(total(subject) / duration, 4) : null,
    intervals: {
      graphic: graphic.map(roundPair),
      undressed: undressed.map(roundPair),
      face: faceIntervals.map(roundPair),
      inserts: inserts.map(roundPair),
      unreset: resetGaps(resets, duration).map(roundPair)
    }
  };
}

// Times where what is on screen changes: every scene start and end strictly
// inside the runtime, merged within MERGE_SECONDS.
function visualChanges(scenes, duration) {
  const times = [];
  for (const scene of scenes) for (const t of [scene.start, scene.end]) if (t > MERGE_SECONDS && t < duration - MERGE_SECONDS) times.push(t);
  times.sort((a, b) => a - b);
  const out = [];
  for (const t of times) if (!out.length || t - out.at(-1) > MERGE_SECONDS) out.push(t);
  return out;
}

/**
 * Attention resets (long form): an insert starting, a section card starting
 * (insert or not), and a change of layout, from the story's footage sections
 * and the direction map's section layouts. → sorted times, merged within
 * MERGE_SECONDS.
 */
export function resetTimes(story, scenes, { sections = null, inserts = [], duration }) {
  const times = [];
  for (const [a] of inserts) times.push(a);
  for (const scene of scenes) if (RESET_MODULES.includes(scene.module)) times.push(scene.start);
  const layouts = (list) => {
    const sorted = list.filter((entry) => finite(Number(entry?.start))).map((entry) => ({ start: Number(entry.start), end: Number(entry.end), layout: entry.layout ?? 'full' })).sort((a, b) => a.start - b.start);
    let previous = 'full', clock = 0;
    for (const entry of sorted) {
      if (entry.start > clock + 1e-6 && previous !== 'full') { times.push(clock); previous = 'full'; }
      if (entry.layout !== previous) times.push(entry.start);
      previous = entry.layout;
      clock = finite(entry.end) ? entry.end : entry.start;
    }
    if (previous !== 'full' && clock < duration - 1e-6) times.push(clock);
  };
  if (Array.isArray(sections)) layouts(sections);
  layouts(storySections(story));
  times.sort((a, b) => a - b);
  const out = [];
  for (const t of times) if (t > MERGE_SECONDS && t < duration - MERGE_SECONDS && (!out.length || t - out.at(-1) > MERGE_SECONDS)) out.push(t);
  return out;
}

/** The runs between resets: [[0, r1], [r1, r2], …, [rn, duration]]. */
export function resetGaps(resets, duration) {
  const edges = [0, ...resets, duration];
  const out = [];
  for (let i = 1; i < edges.length; i += 1) if (edges[i] > edges[i - 1]) out.push([edges[i - 1], edges[i]]);
  return out;
}

// Layout switches: section layouts in order (an insert counts as a switch to
// and from "insert"); with no sections, only the inserts switch layouts.
function layoutChanges(sections, inserts, duration) {
  const timeline = [];
  const list = Array.isArray(sections) ? sections.filter((section) => finite(Number(section?.start))).map((section) => ({ start: Number(section.start), layout: section.layout ?? 'full' })) : [];
  list.sort((a, b) => a.start - b.start);
  if (!list.length || list[0].start > 0) list.unshift({ start: 0, layout: 'full' });
  for (const section of list) timeline.push([section.start, section.layout]);
  for (const [a, b] of inserts) timeline.push([a, 'insert'], [b, null]);
  timeline.sort((x, y) => x[0] - y[0]);
  let count = 0;
  let current = null;
  let sectionLayout = 'full';
  let inInsert = false;
  for (const [t, layout] of timeline) {
    if (t >= duration) break;
    let next;
    if (layout === 'insert') { inInsert = true; next = 'insert'; }
    else if (layout === null) { inInsert = false; next = sectionLayout; }
    else { sectionLayout = layout; next = inInsert ? 'insert' : layout; }
    if (current !== null && next !== current) count += 1;
    current = next;
  }
  return count;
}

function faceVisible(face, duration) {
  if (typeof face === 'function') {
    const step = 0.1;
    const out = [];
    for (let t = 0; t < duration; t += step) if (face(t)) out.push([t, Math.min(duration, t + step)]);
    return unionIntervals(out);
  }
  return unionIntervals((Array.isArray(face) ? face : []).map((entry) => clip([Number(entry.start), Number(entry.end)], duration)));
}

function intersect(a, b) {
  const out = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) {
    const start = Math.max(a0, b0), end = Math.min(a1, b1);
    if (end > start) out.push([start, end]);
  }
  return unionIntervals(out);
}

/** {count, p10, p50, p90, mean} of a list of seconds. */
export function distribution(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, p10: null, p50: null, p90: null, mean: null };
  const q = (p) => {
    const position = (sorted.length - 1) * p;
    const lo = Math.floor(position), hi = Math.ceil(position);
    return round(sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo));
  };
  return { count: sorted.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length) };
}

function roundPair([a, b]) {
  return [round(a), round(b)];
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Visual-event cadence

// The long-form benchmark: a 16-minute faceless explainer measured with
// ffmpeg scene detection. Events are scene changes over 0.08 at least 1.5 s
// apart; hard cuts are scene changes over 0.25. Most events are builds inside
// a shot (a new state over the same backdrop), not cuts.
export const CADENCE_BENCHMARK = Object.freeze({
  id: 'long-form-reference',
  duration_seconds: 975,
  events: 170,
  per_min: 10.46,
  gap: Object.freeze({ p10: 2.5, p50: 5.2, p90: 9.8 }),
  cuts: 50,
  cut_gap_p50: 19.5,
  sensitive: Object.freeze({ threshold: 0.04, events: 215, p50: 4.2 }),
  thresholds: Object.freeze({ sensitive: 0.04, event: 0.08, cut: 0.25, strong: 0.15 }),
  min_event_gap: 1.5
});

// Per-format bands. Seconds scale with the style (CADENCE_STYLES). gap: the
// seconds between consecutive visual events (p50 band, p10 floor, p90
// ceiling); longest_static: the longest run with no event; cut_gap: the
// seconds between hard cuts (p50 band); states: states per shot.
export const CADENCE_TARGETS = Object.freeze({
  'long-form': Object.freeze({ label: 'Long-form explainer', per_min: Object.freeze({ min: 9, target: 11.5, max: 16 }), gap: Object.freeze({ p10_min: 1.5, p50_min: 4, p50_max: 6.5, p90_max: 10.5 }), longest_static: 14, cut_gap: Object.freeze({ min: 15, max: 25 }), states: Object.freeze({ min: 2, max: 4 }) }),
  'short-form': Object.freeze({ label: 'Short form', per_min: Object.freeze({ min: 18, target: 24, max: 40 }), gap: Object.freeze({ p10_min: 0.8, p50_min: 1.8, p50_max: 3.5, p90_max: 5 }), longest_static: 6, cut_gap: Object.freeze({ min: 4, max: 12 }), states: Object.freeze({ min: 1, max: 3 }) }),
  'talking-head': Object.freeze({ label: 'Talking-head base edit', per_min: Object.freeze({ min: 6, target: 10, max: 18 }), gap: Object.freeze({ p10_min: 1.2, p50_min: 3, p50_max: 8, p90_max: 14 }), longest_static: 20, cut_gap: Object.freeze({ min: 8, max: 30 }), states: Object.freeze({ min: 1, max: 3 }) }),
  'art-direction': Object.freeze({ label: 'Full art direction', per_min: Object.freeze({ min: 10, target: 14, max: 24 }), gap: Object.freeze({ p10_min: 1.2, p50_min: 3, p50_max: 5.5, p90_max: 8 }), longest_static: 10, cut_gap: Object.freeze({ min: 6, max: 20 }), states: Object.freeze({ min: 2, max: 4 }) }),
  'motion-graphics': Object.freeze({ label: 'Motion graphics', per_min: Object.freeze({ min: 14, target: 20, max: 36 }), gap: Object.freeze({ p10_min: 0.8, p50_min: 2, p50_max: 4.5, p90_max: 6.5 }), longest_static: 7, cut_gap: Object.freeze({ min: 4, max: 15 }), states: Object.freeze({ min: 2, max: 4 }) }),
  'animated': Object.freeze({ label: 'Animated short and long form', per_min: Object.freeze({ min: 8, target: 12, max: 22 }), gap: Object.freeze({ p10_min: 1.2, p50_min: 3, p50_max: 6.5, p90_max: 11 }), longest_static: 14, cut_gap: Object.freeze({ min: 6, max: 25 }), states: Object.freeze({ min: 1, max: 4 }) })
});
export const CADENCE_FORMATS = Object.freeze(Object.keys(CADENCE_TARGETS));
// A style stretches or tightens every second in the band (and the event rate inversely).
export const CADENCE_STYLES = Object.freeze({ calm: 1.3, default: 1, energetic: 0.8 });

/** The band for a format and style: seconds × the style's factor, rates ÷ it. */
export function cadenceTarget(format = 'long-form', style = 'default') {
  const base = CADENCE_TARGETS[format];
  if (!base) throw new Error(`no cadence target for format "${format}"; use one of ${CADENCE_FORMATS.join(', ')}`);
  const k = CADENCE_STYLES[style];
  if (!k) throw new Error(`no cadence style "${style}"; use one of ${Object.keys(CADENCE_STYLES).join(', ')}`);
  const s = (value) => round(value * k, 2);
  const r = (value) => round(value / k, 2);
  return {
    format, style, label: base.label,
    per_min: { min: r(base.per_min.min), target: r(base.per_min.target), max: r(base.per_min.max) },
    gap: { p10_min: s(base.gap.p10_min), p50_min: s(base.gap.p50_min), p50_max: s(base.gap.p50_max), p90_max: s(base.gap.p90_max) },
    longest_static: s(base.longest_static),
    cut_gap: { min: s(base.cut_gap.min), max: s(base.cut_gap.max) },
    states: { ...base.states }
  };
}

/** Sorted times with neighbours closer than minGap merged into the first. */
export function mergeEvents(times, minGap = 0) {
  const out = [];
  for (const t of times.filter(finite).sort((a, b) => a - b)) if (!out.length || t - out.at(-1) >= minGap - 1e-9) out.push(t);
  return out;
}

/**
 * Cadence of a list of visual-event times (a planned map's state starts, or
 * scene changes detected on rendered frames). duration: the runtime; cuts:
 * hard-cut times (a subset of events, or detected at a higher threshold).
 * → {duration, events, per_min, gap: distribution, longest_static: {seconds,
 *    at}, cuts, cut_gap: distribution | null}
 */
export function eventStats(events, { duration, cuts = null } = {}) {
  if (!(duration > 0)) throw new Error('eventStats needs a duration');
  const times = mergeEvents(events.filter((t) => t > 0 && t < duration));
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  const edges = [0, ...times, duration];
  let longest = { seconds: 0, at: 0 };
  for (let i = 1; i < edges.length; i += 1) if (edges[i] - edges[i - 1] > longest.seconds) longest = { seconds: round(edges[i] - edges[i - 1]), at: round(edges[i - 1]) };
  const cutTimes = Array.isArray(cuts) ? mergeEvents(cuts.filter((t) => t > 0 && t < duration)) : null;
  const cutGaps = [];
  if (cutTimes) { const ce = [0, ...cutTimes, duration]; for (let i = 1; i < ce.length; i += 1) cutGaps.push(ce[i] - ce[i - 1]); }
  return {
    duration: round(duration),
    events: times.length,
    per_min: round(times.length / (duration / 60), 2),
    gap: distribution(gaps),
    longest_static: longest,
    cuts: cutTimes ? cutTimes.length : null,
    cut_gap: cutTimes ? distribution(cutGaps) : null
  };
}

/**
 * The planning gate: each measure against the target band.
 * → {ok, format, style, checks: [{id, ok, value, want, message}]}
 */
export function cadenceGate(stats, target) {
  const checks = [];
  const check = (id, ok, value, want, message) => checks.push({ id, ok: Boolean(ok), value, want, message });
  const n = (value) => (value === null || value === undefined ? 'n/a' : value);
  check('per_min', stats.per_min >= target.per_min.min && stats.per_min <= target.per_min.max, stats.per_min, `${target.per_min.min}–${target.per_min.max} (target ${target.per_min.target})`, `${stats.events} events, ${stats.per_min}/min`);
  check('gap_p50', stats.gap.p50 !== null && stats.gap.p50 >= target.gap.p50_min && stats.gap.p50 <= target.gap.p50_max, stats.gap.p50, `${target.gap.p50_min}–${target.gap.p50_max} s`, `median ${n(stats.gap.p50)} s between events`);
  check('gap_p10', stats.gap.p10 !== null && stats.gap.p10 >= target.gap.p10_min, stats.gap.p10, `≥ ${target.gap.p10_min} s`, `p10 ${n(stats.gap.p10)} s (events too close to read below this)`);
  check('gap_p90', stats.gap.p90 !== null && stats.gap.p90 <= target.gap.p90_max, stats.gap.p90, `≤ ${target.gap.p90_max} s`, `p90 ${n(stats.gap.p90)} s`);
  check('longest_static', stats.longest_static.seconds <= target.longest_static, stats.longest_static.seconds, `≤ ${target.longest_static} s`, `longest static run ${stats.longest_static.seconds} s at ${stats.longest_static.at} s`);
  if (stats.cut_gap) check('cut_gap_p50', stats.cut_gap.p50 !== null && stats.cut_gap.p50 >= target.cut_gap.min && stats.cut_gap.p50 <= target.cut_gap.max, stats.cut_gap.p50, `${target.cut_gap.min}–${target.cut_gap.max} s`, `${stats.cuts} hard cuts, median ${n(stats.cut_gap.p50)} s apart`);
  return { ok: checks.every((entry) => entry.ok), format: target.format, style: target.style, checks };
}

/** The gate as a short text report, one line per check. */
export function cadenceReport(gate, stats = null) {
  const lines = [`cadence ${gate.ok ? 'passed' : 'FAILED'}: ${gate.format} (${gate.style})`];
  if (stats) lines.push(`  ${stats.events} events in ${stats.duration} s; gaps p10 ${stats.gap.p10} / p50 ${stats.gap.p50} / p90 ${stats.gap.p90} s${stats.cuts !== null ? `; ${stats.cuts} cuts` : ''}`);
  for (const entry of gate.checks) lines.push(`  ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.id.padEnd(15)} ${String(entry.value).padStart(7)}  want ${entry.want}  (${entry.message})`);
  return lines.join('\n');
}
