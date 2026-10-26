// The quality gates `finish` adds (docs/VIDEO_QUALITY_RFC.md §11.2): the
// direction map, coverage against the cadence profile, and the face rule,
// plus the opening cut `finish --prototype` renders (§11.1).
//
//   directionGate(ctx)  → {status, file, errors, …}
//   coverageGate(ctx)   → {status, profile, measures, bands, findings}
//   faceGate(ctx)       → {status, source, face_time, findings}
//   qualityFindings(measures, profile) → critic-style findings
//     (missed-opportunity, sparseness) the headless critic carries
//   prototypeCut(resolved, words, {min, max}) → {cut, story} | null
//   prototypeScope({map, words, cut, story, full}) → the map and words
//     inside the prototype window, for the gates above
//
// ctx: {project, resolved, words, layout, style}. Every gate reads only the
// project; none renders or calls a model.
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { DIRECTION_LANES, directionMeasures, validateDirection } from "../kit/core/direction.mjs";
import { storyboardMeasures, unionIntervals } from "../kit/core/cadence.mjs";
import { compareMeasures } from "../kit/core/profiles.mjs";
import { storyBase } from "../kit/core/story.mjs";
import { faceIntervalsFromProbe } from "./cadence_measures.js";
import { profileForStory } from "./profile_store.js";
import { directionFileFor } from "./story_cli.js";
import { TRACK_FILE, readStoryTrack } from "./subject/project.js";

// The measures the coverage gate fails on; the rest of the band is reported.
export const COVERAGE_GATE_MEASURES = Object.freeze(["coverage", "face_time", "longest_undressed_seconds", "longest_without_reset_seconds"]);
export const PROTOTYPE_WINDOW = Object.freeze({ min: 20, max: 30 });
// How far past max a prototype may run to let its last sentence finish.
const PROTOTYPE_OVERRUN = 2;
// Whole-video shares: in a prototype they describe the opening only, so their
// bands are reported (advisory) but do not fail a gate. Run lengths and the
// face rule are local and still do.
export const PROTOTYPE_ADVISORY_MEASURES = Object.freeze(["coverage", "face_time"]);

/** The direction map beside the project's storyboard, or null. */
export async function readProjectDirection(project) {
  const file = directionFileFor(path.join(project, "storyboard.json"));
  if (!existsSync(file)) return { file, map: null };
  return { file, map: JSON.parse(await readFile(file, "utf8")) };
}

/** The profile a project's story is gated against (the map's, the style's, else the lane's). */
export function gateProfile(resolved, { direction = null, style = null, project } = {}) {
  try { return profileForStory(resolved, { direction, style, projectDir: project }); }
  catch (error) { return { profile: null, reason: error.message }; }
}

/**
 * Direction: every line covered by the map and the scenes it names exist
 * (validateDirection against the resolved story). A narrated story in a
 * direction lane fails without a map; a story with no narration skips.
 */
export async function directionGate({ project, resolved, words, direction }) {
  const lane = resolved?.lane;
  if (!DIRECTION_LANES.includes(lane)) return { status: "skipped", reason: `the ${lane} lane has no direction map` };
  const { file, map } = direction ?? await readProjectDirection(project);
  const rel = path.relative(project, file);
  if (!map) {
    if (words?.length) return { status: "failed", file: rel, errors: [`${rel} is missing: a narrated ${lane} story needs a direction map (references/direction-map.md)`] };
    return { status: "skipped", reason: `no ${rel} and no narration words` };
  }
  const check = validateDirection(map, { words: words ?? [], story: resolved, cast: resolved?.cast ?? map.cast ?? null });
  const lines = (map.sections ?? []).reduce((sum, section) => sum + (section.lines?.length ?? 0), 0);
  return { status: check.ok ? "passed" : "failed", file: rel, lines, errors: check.errors.slice(0, 20), warnings: check.warnings.slice(0, 20) };
}

/**
 * Coverage: coverage, face time, the longest undressed run and (long form)
 * the longest run without an attention reset against the profile band, measured exactly from the resolved storyboard (and the
 * direction map's sections and lines when there is one). Other measures in
 * the band are reported and never fail the gate.
 */
export function coverageGate({ resolved, words, map, profile, face = null, prototype = false }) {
  if (!profile) return { status: "skipped", reason: "no cadence profile fits this story" };
  const measures = map && words?.length ? directionMeasures(map, resolved, { words, face }) : storyboardMeasures(resolved, { face });
  const bands = compareMeasures(measures, profile);
  const outside = bands.filter((band) => band.status !== "inside" && COVERAGE_GATE_MEASURES.includes(band.measure));
  const advisory = prototype ? outside.filter((band) => PROTOTYPE_ADVISORY_MEASURES.includes(band.measure)) : [];
  const failing = outside.filter((band) => !advisory.includes(band));
  const findings = qualityFindings(measures, profile);
  return {
    status: failing.length ? "failed" : "passed",
    profile: profile.id,
    provenance: profile.provenance?.kind ?? null,
    measures: {
      coverage: measures.coverage,
      face_time: measures.face_time,
      longest_undressed_seconds: measures.longest_undressed_seconds,
      first_visual_seconds: measures.first_visual_seconds,
      visual_changes_per_min: measures.visual_changes_per_min,
      layout_changes_per_min: measures.layout_changes_per_min,
      subject_effect_share: measures.subject_effect_share,
      ...(profile.measures?.longest_without_reset_seconds ? { longest_without_reset_seconds: measures.longest_without_reset_seconds, resets: measures.reset_times?.length ?? 0 } : {})
    },
    bands: bands.map(({ measure, status, value, band, target }) => ({ measure, status, value, band, target })),
    errors: failing.map((band) => band.detail),
    ...(advisory.length ? { advisory: advisory.map((band) => band.detail) } : {}),
    findings
  };
}

/**
 * Findings the map and the profile prove without looking at pixels, in the
 * critic's shape: a visual line held on the face or the camera alone is a
 * missed opportunity; an undressed run past the profile's ceiling is
 * sparseness.
 */
export function qualityFindings(measures, profile) {
  const findings = [];
  for (const line of measures.missed ?? []) {
    findings.push({ category: "missed-opportunity", severity: "major", at: line.start, words: line.words, message: `${line.intent} line (words ${line.words.join("–")}, ${line.start}–${line.end} s) calls for a visual but plays on the ${line.treatment === "face" ? "presenter" : "camera"} alone; dress it, or say in the map why the face carries it` });
  }
  const limit = profile?.measures?.longest_undressed_seconds?.p90;
  if (limit != null) {
    for (const [start, end] of measures.intervals?.undressed ?? []) {
      if (end - start > limit + 1e-6) findings.push({ category: "sparseness", severity: "major", at: start, message: `${round(end - start)} s with no graphic (${start}–${end} s); ${profile.id} allows at most ${limit} s` });
    }
  }
  // Long form: a run with no layout change, insert or section card past the ceiling.
  const resetLimit = profile?.measures?.longest_without_reset_seconds?.p90;
  if (resetLimit != null) {
    for (const [start, end] of measures.intervals?.unreset ?? []) {
      if (end - start > resetLimit + 1e-6) findings.push({ category: "sparseness", severity: "major", at: start, message: `${round(end - start)} s with no attention reset (${start}–${end} s); ${profile.id} resets at least every ${resetLimit} s: change the layout, make a line an insert, or run launchclip story long-form` });
    }
  }
  return findings;
}

/**
 * Face: the face rule (no front scene over the face for more than 0.3 s,
 * from layout-check) and face time against the profile, over whatever face
 * data exists: a whole-video track, else the presenter probe, else the base
 * itself (the face is taken to be visible wherever the base shows).
 */
export async function faceGate({ project, resolved, layout, profile, prototype = false }) {
  if (!storyBase(resolved)) return { status: "skipped", reason: "no presenter: not footage-led" };
  const data = await readFaceData(project, resolved);
  const measures = storyboardMeasures(resolved, { face: data.intervals });
  // A prototype is gated on its window: layout ran on the whole story.
  const duration = Number(resolved?.resolved?.duration ?? resolved?.format?.duration);
  const findings = (layout?.findings ?? []).filter((finding) => finding.rule === "subject-face" && !(prototype && Number(finding.at) >= duration));
  const band = profile?.measures?.face_time ? compareMeasures({ face_time: measures.face_time }, profile)[0] : null;
  const outside = band && band.status !== "inside" ? [band.detail] : [];
  const errors = [...findings.map((finding) => `${finding.ids.join(", ")} @${finding.at}s: ${finding.detail}`), ...(prototype ? [] : outside)];
  return {
    status: errors.length ? "failed" : "passed",
    source: data.source,
    face_time: measures.face_time,
    ...(band ? { band: band.band, target: band.target } : {}),
    findings: findings.slice(0, 12),
    errors: errors.slice(0, 12),
    ...(prototype && outside.length ? { advisory: outside } : {}),
    ...(data.note ? { note: data.note } : {})
  };
}

/**
 * Face-visible intervals on the edited timeline. → {source, intervals | null, note?}
 * The whole-video track (`launchclip subject track --project`, filed as
 * assets/subject/track.json for this base) wins; else the presenter probe
 * cached in .launchclip/subject/<entry>/probe.json; else none.
 */
export async function readFaceData(project, resolved) {
  let track = null;
  try { track = await readStoryTrack(project, resolved); }
  catch { track = null; /* an invalid track falls through to the probe; layout-check reports it */ }
  if (track?.frames?.length) {
    const step = 1 / (Number(track.fps) > 0 ? Number(track.fps) : 10);
    const samples = track.frames.map((frame) => ({ t: frame.t, head: frame.head }));
    const last = samples.at(-1).t + step;
    return { source: TRACK_FILE, intervals: toTimeline(faceIntervalsFromProbe({ samples, source: { duration: last } }), resolved) };
  }
  const probe = await newestProbe(project);
  if (probe) return { source: probe.rel, intervals: toTimeline(faceIntervalsFromProbe(probe.probe), resolved), note: "face time from the presenter probe (about one frame a second); a whole-video track (launchclip subject track --project) is finer" };
  return { source: "storyboard", intervals: null, note: "no face data: the face is taken to be visible wherever the base shows" };
}

async function newestProbe(project) {
  const root = path.join(project, ".launchclip", "subject");
  if (!existsSync(root)) return null;
  let best = null;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "probe.json");
    if (!existsSync(file)) continue;
    try {
      const probe = JSON.parse(await readFile(file, "utf8"));
      if (!best || String(probe.created_at ?? "") > String(best.probe.created_at ?? "")) best = { probe, rel: path.relative(project, file) };
    } catch { /* skip */ }
  }
  return best;
}

// Source-time intervals → edited-timeline intervals through base.trim (the
// kept source ranges played back to back). Without a trim, source time is
// timeline time.
export function toTimeline(intervals, resolved) {
  const trim = resolved?.base?.trim ?? storyBase(resolved)?.trim;
  if (!Array.isArray(trim) || !trim.length) return intervals;
  const out = [];
  let offset = 0;
  for (const [a, b] of trim) {
    for (const { start, end } of intervals) {
      const from = Math.max(a, start), to = Math.min(b, end);
      if (to > from) out.push([offset + from - a, offset + to - a]);
    }
    offset += b - a;
  }
  return unionIntervals(out).map(([start, end]) => ({ start, end }));
}

// ---------------------------------------------------------------------------
// Prototype (RFC §11.1)

/**
 * The opening cut for `finish --prototype`: a cut between min and max seconds
 * at the end of a narration sentence (else a sentence ending up to
 * PROTOTYPE_OVERRUN s past max, else a scene end, else between two words,
 * else max), and the
 * resolved story trimmed to it: later scenes dropped, the rest clamped, no
 * loop ending. A story no longer than max needs no prototype (null).
 */
export function prototypeCut(resolved, words = [], { min = PROTOTYPE_WINDOW.min, max = PROTOTYPE_WINDOW.max } = {}) {
  const duration = Number(resolved?.resolved?.duration ?? resolved?.format?.duration);
  if (!(duration > max)) return null;
  const target = (min + max) / 2;
  const candidates = [];
  const sentenceEnd = (word) => /[.!?]["”']?$/.test(String(word?.text ?? ""));
  for (const word of words ?? []) if (sentenceEnd(word) && Number(word.end) >= min && Number(word.end) <= max) candidates.push(Number(word.end) + 0.2);
  // No sentence ends inside the window: let a sentence that ends just past it
  // finish rather than cutting it off mid-word.
  if (!candidates.length) {
    const late = (words ?? []).find((word) => sentenceEnd(word) && Number(word.end) > max && Number(word.end) <= max + PROTOTYPE_OVERRUN);
    if (late) candidates.push(Number(late.end) + 0.2);
  }
  if (!candidates.length) for (const scene of resolved.scenes ?? []) if ((scene.track ?? 0) === 0 && Number(scene.end) >= min && Number(scene.end) <= max) candidates.push(Number(scene.end));
  // Else the last word that ends inside the window, so the cut falls between words.
  if (!candidates.length) {
    const list = words ?? [];
    const index = list.findLastIndex((word) => Number(word.end) >= min && Number(word.end) <= max);
    if (index >= 0) candidates.push(Math.min(Number(list[index].end) + 0.2, Number(list[index + 1]?.start ?? Infinity), max));
  }
  const cut = round(candidates.length ? candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0] : max);
  const story = JSON.parse(JSON.stringify(resolved));
  story.scenes = story.scenes.filter((scene) => Number(scene.start) < cut - 0.05).map((scene) => {
    const end = Math.min(Number(scene.end), cut);
    const hits = Array.isArray(scene.hits) ? scene.hits.filter((hit) => !Number.isFinite(Number(hit.at)) || Number(hit.at) <= end) : scene.hits;
    return { ...scene, end, ...(hits ? { hits } : {}) };
  });
  story.format = { ...story.format, duration: cut };
  if (story.resolved) story.resolved = { ...story.resolved, duration: cut };
  delete story.ending;
  return { cut, duration, story };
}

/**
 * The direction map and narration inside a prototype window, so the gates
 * judge the opening the prototype renders rather than the whole story. cut:
 * the window's end (s); story: the trimmed story; full: the whole resolved
 * story. Words starting before the cut are kept (a prefix, so line indexes
 * stay valid); lines starting inside the window are kept and clamped to those
 * words, naming only scenes the window shows (a name in neither story stays,
 * so validation still reports it). A dressed or inserted line whose scenes all
 * fall after the cut ends the window. Sections left with no lines are dropped.
 * → {map, words, lines}
 */
export function prototypeScope({ map, words = [], cut, story, full = story }) {
  const list = Array.isArray(words) ? words : [];
  let count = list.findIndex((word) => !(Number(word?.start) < cut - 1e-6));
  if (count < 0) count = list.length;
  if (!map || !Array.isArray(map.sections)) return { map, words: list.slice(0, count), lines: 0 };
  const shown = new Set((story?.scenes ?? []).map((scene) => scene.id));
  const known = new Set((full?.scenes ?? []).map((scene) => scene.id));
  const sections = [];
  let lines = 0;
  for (const section of map.sections) {
    if (Number.isFinite(section?.start) && section.start >= cut) break;
    const kept = [];
    for (const line of Array.isArray(section?.lines) ? section.lines : []) {
      const range = line?.words;
      if (!Array.isArray(range) || !(range[0] < count)) break;
      const named = Array.isArray(line.scenes) ? line.scenes.filter((id) => shown.has(id) || !known.has(id)) : line.scenes;
      if (Array.isArray(line.scenes) && line.scenes.length && !named.length && (line.treatment === "dress" || line.treatment === "insert")) { count = range[0]; break; }
      kept.push({ ...line, words: [range[0], Math.min(range[1], count - 1)], ...(named !== undefined ? { scenes: named } : {}) });
    }
    if (kept.length) {
      sections.push({ ...section, lines: kept, ...(Number.isFinite(section.end) && section.end > cut ? { end: cut } : {}) });
      lines += kept.length;
    }
    if (kept.length < (section?.lines?.length ?? 0)) break;
  }
  return { map: { ...map, sections }, words: list.slice(0, count), lines };
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
