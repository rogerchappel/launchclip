// The six-format scorecard (npm run eval:formats): one row per golden brief,
// one column per metric, each judged against the format's target.
//
//   SCENE_THRESHOLDS                       0.04, 0.08, 0.15 (as measured on the reference)
//   parseSceneTimes(text)                  ffmpeg showinfo → [pts seconds]
//   parseFreezes(text, duration)           ffmpeg freezedetect → [[start, end]]
//   renderedCadence(scenes, {duration, format}) → per-threshold event stats
//   motionOnHold(freezes, duration)        share of the runtime that moves
//   evidenceCoverage(story, {map})         claims shown with a sourced visual
//   moduleVariety(story)                   distinct modules, top share, entropy
//   captionHygiene(story, words, {required}) captions on, readable pace, clean timings
//   avSync(planned, detected, {probe})     planned scene starts that land on a detected change
//   scoreBrief(brief, measures)            → {id, format, checks, score, status}
//   formatScorecard(rows)                  → the table npm run eval:formats prints
//
// Pure: the runner (eval/formats.mjs) renders and runs ffmpeg; this file only
// reads what they produce.

import { CADENCE_BENCHMARK, cadenceGate, cadenceTarget, distribution, eventStats, mergeEvents, unionIntervals } from '../kit/core/cadence.mjs';
import { isClaim } from '../kit/core/beat-director.mjs';

export const SCORECARD_SCHEMA = 'launchclip.format-scorecard.v1';
export const SCENE_THRESHOLDS = Object.freeze([0.04, 0.08, 0.15]);
// The threshold the cadence gate reads (the reference's "distinct visual events").
export const EVENT_THRESHOLD = 0.08;
// Per-format floors for the metrics that are not cadence.
export const METRIC_TARGETS = Object.freeze({
  motion_on_hold: Object.freeze({ 'long-form': 0.85, 'short-form': 0.9, 'talking-head': 0.95, 'art-direction': 0.85, 'motion-graphics': 0.9, animated: 0.85 }),
  evidence_coverage: 0.6,
  variety: Object.freeze({ distinct_share_min: 0.35, top_share_max: 0.4 }),
  caption_words_per_second_max: 4.2,
  av_sync: Object.freeze({ matched_min: 0.6, offset_ms_max: 120, duration_delta_ms_max: 250 })
});
// Formats whose captions are required (watched muted, or a voice to read along with).
export const CAPTIONS_REQUIRED = Object.freeze(['short-form', 'talking-head', 'long-form']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** pts_time values from an ffmpeg `select='gt(scene,T)',showinfo` run's stderr. */
export function parseSceneTimes(text) {
  const out = [];
  for (const match of String(text ?? '').matchAll(/pts_time:\s*([0-9.]+)/g)) out.push(Number(match[1]));
  return out.filter(finite).sort((a, b) => a - b);
}

/** Frozen intervals from an ffmpeg freezedetect run's stderr (an open freeze runs to the end). */
export function parseFreezes(text, duration) {
  const out = [];
  let open = null;
  for (const line of String(text ?? '').split('\n')) {
    const start = line.match(/freeze_start:\s*([0-9.]+)/);
    const end = line.match(/freeze_end:\s*([0-9.]+)/);
    if (start) open = Number(start[1]);
    if (end && open !== null) { out.push([open, Number(end[1])]); open = null; }
  }
  if (open !== null && finite(duration)) out.push([open, duration]);
  return out;
}

/**
 * Event cadence from scene detection at each threshold: changes merged when
 * closer than the format's floor (1.5 s for long form, as on the reference),
 * the gate on EVENT_THRESHOLD, hard cuts from the highest threshold.
 * scenes: {"0.04": [t…], "0.08": […], "0.15": […]}.
 */
export function renderedCadence(scenes, { duration, format = 'long-form', style = 'default' } = {}) {
  const target = cadenceTarget(format, style);
  const gap = Math.min(CADENCE_BENCHMARK.min_event_gap, target.gap.p10_min);
  const strongest = String(Math.max(...SCENE_THRESHOLDS));
  const cuts = mergeEvents(scenes[strongest] ?? [], gap);
  const thresholds = {};
  for (const threshold of SCENE_THRESHOLDS) {
    const events = mergeEvents(scenes[String(threshold)] ?? [], gap);
    thresholds[threshold] = eventStats(events, { duration, cuts });
  }
  const stats = thresholds[EVENT_THRESHOLD];
  return { target, merge_seconds: gap, thresholds, gate: cadenceGate(stats, target) };
}

/** Share of the runtime that is not frozen (motion on every hold). */
export function motionOnHold(freezes, duration) {
  const frozen = unionIntervals(freezes).reduce((sum, [a, b]) => sum + Math.max(0, Math.min(duration, b) - Math.max(0, a)), 0);
  return { share: round(1 - frozen / duration, 4), frozen_seconds: round(frozen), longest_freeze: round(unionIntervals(freezes).reduce((max, [a, b]) => Math.max(max, b - a), 0)) };
}

// Modules whose scene states a number or a quote (a claim a viewer could check).
const CLAIM_MODULES = new Set(['stat-card', 'count-up', 'odometer', 'percent-fill', 'unit-grid', 'pie-chart', 'number-line', 'bar-chart', 'leaderboard', 'compare', 'gauge-compare', 'comparison-table', 'quote-card', 'metric', 'trend-chart', 'growth-chart', 'growth-line', 'area-chart', 'stacked-bar', 'sparkline', 'funnel-chart', 'waterfall', 'progress', 'progress-ring', 'map-highlight', 'archive-card', 'proof-wall', 'feed-frame', 'excerpt', 'excerpt-window', 'media-window']);

/**
 * Claims shown with a sourced visual. With a beat map, from its states
 * (isClaim, evidence.source); otherwise from the storyboard: a claim scene
 * (a number, a quote, a capture) is sourced when it carries params.source,
 * params.note, a media capture or a frame source note over it.
 * → {claims, sourced, coverage | null}
 */
export function evidenceCoverage(story, { map = null } = {}) {
  if (map) {
    const states = (map.chapters ?? []).flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
    const claims = states.filter(isClaim);
    const sourced = claims.filter((state) => state.evidence?.source);
    return { claims: claims.length, sourced: sourced.length, coverage: claims.length ? round(sourced.length / claims.length, 3) : null };
  }
  const notes = (story?.frame?.sources ?? []).filter((entry) => entry && typeof entry === 'object');
  const scenes = (story?.scenes ?? []).filter((scene) => CLAIM_MODULES.has(scene.module));
  const sourced = scenes.filter((scene) => {
    const p = scene.params ?? {};
    if (p.source || p.note || p.sources || p.media?.src || p.citation) return true;
    return notes.some((note) => note.scene === scene.id || (finite(Number(note.start)) && Number(note.start) <= Number(scene.start) && (note.end === undefined || Number(note.end) >= Number(scene.end))));
  });
  return { claims: scenes.length, sourced: sourced.length, coverage: scenes.length ? round(sourced.length / scenes.length, 3) : null };
}

/** Distinct modules over scenes, the most used module's share and normalised entropy. */
export function moduleVariety(story) {
  const scenes = (story?.scenes ?? []).filter((scene) => scene?.module && scene.module !== 'custom');
  const counts = {};
  for (const scene of scenes) counts[scene.module] = (counts[scene.module] ?? 0) + 1;
  const n = scenes.length;
  const ids = Object.keys(counts);
  const entropy = ids.length > 1 ? -ids.reduce((sum, id) => sum + (counts[id] / n) * Math.log(counts[id] / n), 0) / Math.log(ids.length) : 0;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { scenes: n, modules: ids.length, distinct_share: n ? round(ids.length / n, 3) : null, top: top ? { id: top[0], share: round(top[1] / n, 3) } : null, entropy: round(entropy, 3) };
}

/**
 * Caption hygiene: captions on where the format needs them, a readable pace
 * (peak words per second over any 2 s window), and clean word timings (in
 * order, positive length, no overlaps). → {on, required, peak_wps, problems, ok}
 */
export function captionHygiene(story, words, { required = false } = {}) {
  const on = (story?.overlays ?? []).some((overlay) => overlay?.type === 'captions' && overlay.style !== 'none');
  const list = (Array.isArray(words) ? words : words?.words ?? []).map((word) => ({ text: String(word.text ?? word.word ?? ''), start: Number(word.start), end: Number(word.end) }));
  const problems = [];
  if (required && !on) problems.push('no captions on a format watched muted');
  let bad = 0, overlaps = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (!(list[i].end > list[i].start)) bad += 1;
    if (i && list[i].start < list[i - 1].end - 1e-3) overlaps += 1;
  }
  if (bad) problems.push(`${bad} word${bad === 1 ? '' : 's'} with no length`);
  if (overlaps) problems.push(`${overlaps} overlapping word${overlaps === 1 ? '' : 's'}`);
  let peak = 0;
  for (let i = 0, j = 0; i < list.length; i += 1) {
    while (list[j].start < list[i].start - 2) j += 1;
    peak = Math.max(peak, (i - j + 1) / 2);
  }
  if (on && peak > METRIC_TARGETS.caption_words_per_second_max) problems.push(`captions peak at ${peak} words/s (> ${METRIC_TARGETS.caption_words_per_second_max})`);
  return { on, required, words: list.length, peak_wps: round(peak, 2), problems, ok: problems.length === 0 };
}

/**
 * Audio/visual sync: the planned scene starts (the resolved storyboard's)
 * that land on a detected change within toleranceMs, the median offset of
 * those that do, and the audio stream's length against the video's.
 */
export function avSync(planned, detected, { probe = null, toleranceMs = 250, duration = null } = {}) {
  const times = planned.filter((t) => finite(t) && t > 0.3 && (!finite(duration) || t < duration - 0.3));
  const offsets = [];
  for (const t of times) {
    let best = null;
    for (const d of detected) if (Math.abs(d - t) * 1000 <= toleranceMs && (best === null || Math.abs(d - t) < Math.abs(best - t))) best = d;
    if (best !== null) offsets.push(Math.abs(best - t) * 1000);
  }
  const audio = probe?.audio ?? null;
  const videoDuration = probe?.video_duration ?? null;
  return {
    planned: times.length,
    matched: offsets.length,
    matched_share: times.length ? round(offsets.length / times.length, 3) : null,
    offset_ms_p50: offsets.length ? round(distribution(offsets).p50, 1) : null,
    audio: audio ? { duration_delta_ms: finite(videoDuration) ? round(Math.abs(audio.duration - videoDuration) * 1000, 1) : null } : null
  };
}

/**
 * Score one brief's measures against its format. measures: {cadence
 * (renderedCadence), plan (cadence gate of the plan, optional), motion,
 * evidence, variety, layout: {errors, warnings}, captions, sync}. Each check
 * is pass, warn (within 15% of the line) or fail; n/a is skipped.
 * → {id, format, label, checks: [{id, status, value, want}], score, status}
 */
export function scoreBrief(brief, measures) {
  const checks = [];
  const add = (id, status, value, want) => checks.push({ id, status, value, want });
  const band = (value, ok, near) => (value === null || value === undefined ? 'n/a' : ok ? 'pass' : near ? 'warn' : 'fail');
  const c = measures.cadence;
  if (c) {
    const s = c.thresholds[EVENT_THRESHOLD];
    const t = c.target;
    add('events_per_min', band(s.per_min, s.per_min >= t.per_min.min && s.per_min <= t.per_min.max, s.per_min >= t.per_min.min * 0.85 && s.per_min <= t.per_min.max * 1.15), s.per_min, `${t.per_min.min}–${t.per_min.max}`);
    add('gap_p50', band(s.gap.p50, s.gap.p50 >= t.gap.p50_min && s.gap.p50 <= t.gap.p50_max, s.gap.p50 >= t.gap.p50_min * 0.85 && s.gap.p50 <= t.gap.p50_max * 1.15), s.gap.p50, `${t.gap.p50_min}–${t.gap.p50_max} s`);
    add('gap_p90', band(s.gap.p90, s.gap.p90 <= t.gap.p90_max, s.gap.p90 <= t.gap.p90_max * 1.15), s.gap.p90, `≤ ${t.gap.p90_max} s`);
    add('longest_static', band(s.longest_static.seconds, s.longest_static.seconds <= t.longest_static, s.longest_static.seconds <= t.longest_static * 1.15), s.longest_static.seconds, `≤ ${t.longest_static} s`);
  }
  if (measures.plan) add('plan_cadence', measures.plan.ok ? 'pass' : 'fail', measures.plan.ok ? 'ok' : measures.plan.checks.filter((check) => !check.ok).map((check) => check.id).join(','), 'gate');
  if (measures.motion) {
    const floor = METRIC_TARGETS.motion_on_hold[brief.format] ?? 0.85;
    add('motion_on_hold', band(measures.motion.share, measures.motion.share >= floor, measures.motion.share >= floor - 0.1), measures.motion.share, `≥ ${floor}`);
  }
  if (measures.evidence) add('evidence', band(measures.evidence.coverage, measures.evidence.coverage >= METRIC_TARGETS.evidence_coverage, measures.evidence.coverage >= METRIC_TARGETS.evidence_coverage - 0.15), measures.evidence.coverage, `≥ ${METRIC_TARGETS.evidence_coverage}`);
  if (measures.variety) {
    const v = measures.variety, t = METRIC_TARGETS.variety;
    add('variety', band(v.distinct_share, v.distinct_share >= t.distinct_share_min && (v.top?.share ?? 0) <= t.top_share_max, v.distinct_share >= t.distinct_share_min * 0.8), v.distinct_share, `≥ ${t.distinct_share_min}, top ≤ ${t.top_share_max}`);
  }
  if (measures.layout) add('layout', measures.layout.errors ? 'fail' : measures.layout.warnings ? 'warn' : 'pass', measures.layout.errors, '0 errors');
  if (measures.captions) add('captions', measures.captions.ok ? 'pass' : measures.captions.required && !measures.captions.on ? 'fail' : 'warn', measures.captions.ok ? 'ok' : measures.captions.problems.join('; '), measures.captions.required ? 'on, ≤ 4.2 w/s' : '≤ 4.2 w/s');
  if (measures.sync) {
    const t = METRIC_TARGETS.av_sync;
    const s = measures.sync;
    const ok = s.matched_share === null || (s.matched_share >= t.matched_min && (s.offset_ms_p50 ?? 0) <= t.offset_ms_max && (s.audio?.duration_delta_ms ?? 0) <= t.duration_delta_ms_max);
    add('av_sync', s.matched_share === null ? 'n/a' : ok ? 'pass' : s.matched_share >= t.matched_min - 0.15 ? 'warn' : 'fail', s.matched_share, `≥ ${t.matched_min} of scene starts within 250 ms`);
  }
  const judged = checks.filter((check) => check.status !== 'n/a');
  const points = judged.reduce((sum, check) => sum + (check.status === 'pass' ? 1 : check.status === 'warn' ? 0.5 : 0), 0);
  const score = judged.length ? Math.round((points / judged.length) * 100) : null;
  const status = judged.some((check) => check.status === 'fail') ? 'fail' : judged.some((check) => check.status === 'warn') ? 'warn' : 'pass';
  return { id: brief.id, format: brief.format, label: brief.label, checks, score, status };
}

/** The scorecard as a fixed-width table: a row per brief, a column per metric. */
export function formatScorecard(rows) {
  const columns = ['events_per_min', 'gap_p50', 'gap_p90', 'longest_static', 'plan_cadence', 'motion_on_hold', 'evidence', 'variety', 'layout', 'captions', 'av_sync'];
  const short = { events_per_min: 'ev/min', gap_p50: 'gap p50', gap_p90: 'gap p90', longest_static: 'static', plan_cadence: 'plan', motion_on_hold: 'motion', evidence: 'evidence', variety: 'variety', layout: 'layout', captions: 'captions', av_sync: 'a/v sync' };
  const mark = { pass: '✓', warn: '~', fail: '✗', 'n/a': '·' };
  const cell = (check) => {
    if (!check) return '·';
    const value = typeof check.value === 'number' ? String(check.value) : check.status === 'pass' ? '' : '';
    return `${mark[check.status]} ${value}`.trim();
  };
  const head = ['format'.padEnd(16), 'score'.padStart(5), ...columns.map((id) => short[id].padEnd(10))].join(' ');
  const lines = [head, '-'.repeat(head.length)];
  for (const row of rows) {
    const byId = Object.fromEntries(row.checks.map((check) => [check.id, check]));
    lines.push([row.format.padEnd(16), String(row.score ?? '–').padStart(5), ...columns.map((id) => cell(byId[id]).slice(0, 10).padEnd(10))].join(' '));
  }
  lines.push('', '✓ pass  ~ within 15% of the line  ✗ fail  · not measured for this format');
  const notes = rows.flatMap((row) => row.checks.filter((check) => check.status === 'fail' || check.status === 'warn').map((check) => `  ${row.format}: ${check.id} ${check.value} (want ${check.want})`));
  if (notes.length) lines.push('', 'misses:', ...notes);
  return lines.join('\n');
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
