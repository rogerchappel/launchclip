// Beat sync: the musical edit between a story and its music.
//
// Two strategies, chosen by whether the story is narrated:
//
//   align  (voiceover lanes) the narration timing is fixed, so the music
//          moves instead: choose the start offset into the track (and an
//          optional tempo change of at most 3%) so downbeats land on the key
//          moments: the first cut after the hook, the payoff/CTA start, other
//          cuts and high-energy hits.
//   snap   (motion lane, no narration) align the music first, then move
//          numeric scene boundaries to the nearest downbeat and numeric hits
//          to the nearest beat within a tolerance (0.25 s), re-resolving each
//          change and falling back when it breaks a module or the story.
//
// Word-anchored times are never moved off their word, and beat anchors are on
// the grid already. Every decision is recorded for qa/beat-sync.json.
import { resolveModule } from "../../kit/core/modules.mjs";
import { parseAnchor, resolveStory, validateStory } from "../../kit/core/story.mjs";
import { transformGrid } from "./beats.js";

export const BEAT_SYNC_SCHEMA = "launchclip.beat-sync.v1";
export const SNAP_TOLERANCE = 0.25;
export const MAX_TEMPO_CHANGE = 0.03;
export const ON_GRID = 0.05;
const SIGMA = 0.045;
const MIN_SCENE = 0.5;

/** "align" for narrated stories (voice or words present), else "snap"; "off" when sync is off. */
export function syncStrategy(story, { sync = "auto", narrated } = {}) {
  if (sync === "off") return "off";
  const isNarrated = narrated ?? Boolean(story?.audio?.voice || story?.audio?.words || story?.audio?.narration);
  return isNarrated ? "align" : "snap";
}

/**
 * The moments the music should land on, from a resolved story:
 * [{kind: "hook-cut"|"payoff"|"cut"|"hit", at, scene, weight, downbeat}]
 * downbeat: true when the moment wants a downbeat (cuts), false for hits
 * (any beat, with a bonus on a downbeat).
 */
export function keyMoments(story, { hits = true } = {}) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const scenes = baseScenes(story);
  const moments = [];
  const cuts = scenes.filter((scene, index) => index > 0 && scene.start > 0.05 && scene.start < duration - 0.05);
  const payoff = findPayoff(scenes);
  cuts.forEach((scene, index) => {
    const isPayoff = payoff && scene.id === payoff.id;
    moments.push({ kind: isPayoff ? "payoff" : index === 0 ? "hook-cut" : "cut", at: scene.start, scene: scene.id, weight: isPayoff || index === 0 ? 3 : 1.5, downbeat: true });
  });
  if (hits) {
    for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
      const energy = scene.energy === "build" ? 2 : Number(scene.energy ?? 1);
      for (const hit of Array.isArray(scene.hits) ? scene.hits : []) {
        if (typeof hit?.at !== "number") continue;
        const strong = energy >= 2 || /impact|subdrop|drop|slam/.test(String(hit.cue ?? hit.event ?? ""));
        if (!strong) continue;
        if (moments.some((moment) => Math.abs(moment.at - hit.at) < 0.08)) continue;
        moments.push({ kind: "hit", at: hit.at, scene: scene.id, event: hit.event, weight: 1, downbeat: false });
      }
    }
  }
  return moments.sort((a, b) => a.at - b.at);
}

function baseScenes(story) {
  const all = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => typeof scene?.start === "number" && typeof scene?.end === "number");
  const base = all.filter((scene) => (scene.track ?? 0) === 0);
  return (base.length ? base : all).slice().sort((a, b) => a.start - b.start);
}

// The payoff: a cta scene, else the first full-energy scene after the
// midpoint, else the last scene.
function findPayoff(scenes) {
  if (scenes.length < 2) return null;
  const cta = scenes.find((scene) => /cta|end-card|outro/.test(String(scene.module)));
  if (cta) return cta;
  const mid = scenes[0].start + (scenes.at(-1).end - scenes[0].start) / 2;
  return scenes.find((scene) => scene.start >= mid && scene.energy === 3) ?? scenes.at(-1);
}

/** Score of a story-time grid against moments (higher is better). */
export function scoreMoments(moments, grid) {
  let score = 0;
  for (const moment of moments) {
    const toDown = nearest(grid.downbeats, moment.at).distance;
    const toBeat = nearest(grid.beats, moment.at).distance;
    const down = Math.exp(-0.5 * (toDown / SIGMA) ** 2);
    const beat = Math.exp(-0.5 * (toBeat / SIGMA) ** 2);
    score += moment.weight * (moment.downbeat ? Math.max(down, 0.35 * beat) : Math.max(beat * 0.8, down));
  }
  return score;
}

/**
 * Choose the music start offset (seconds trimmed from the track) and tempo.
 * musicGrid: the track's own grid (music time); duration: story length;
 * musicLength: track length; allowTempo: try up to ±3% (atempo).
 * → {offset, tempo, score, baseline, gain, grid (story time), tried}
 */
export function chooseAlignment(musicGrid, moments, { duration, musicLength, allowTempo = true, maxTempo = MAX_TEMPO_CHANGE, maxOffset } = {}) {
  const tempos = [1];
  if (allowTempo) for (let step = 1; step * 0.0025 <= maxTempo + 1e-9; step += 1) tempos.push(1 + step * 0.0025, 1 - step * 0.0025);
  const beat = Number(musicGrid.beat_seconds) || 60 / Number(musicGrid.bpm) || 0.5;
  const bar = beat * 4;
  let best = null;
  let baseline = null;
  let tried = 0;
  for (const tempo of tempos) {
    // The trimmed, re-timed track must still cover the whole story.
    const room = Number.isFinite(musicLength) ? musicLength - duration * tempo : bar;
    const limit = Math.max(0, Math.min(maxOffset ?? bar + beat, room));
    for (let offset = 0; offset <= limit + 1e-9; offset += 0.005) {
      const grid = transformGrid(musicGrid, { offset, tempo, duration });
      const raw = scoreMoments(moments, grid);
      // Prefer the original tempo and smaller offsets when scores tie.
      const score = raw - 0.15 * Math.abs(tempo - 1) / maxTempo - 0.001 * offset;
      tried += 1;
      if (tempo === 1 && offset === 0) baseline = raw;
      if (!best || score > best.score + 1e-9) best = { offset: round3(offset), tempo: round4(tempo), score, raw, grid };
    }
  }
  // A tempo change must earn its keep: at least 5% better than the best at the original tempo.
  if (best && best.tempo !== 1) {
    const plain = chooseAlignment(musicGrid, moments, { duration, musicLength, allowTempo: false, maxOffset });
    if (!(best.raw > plain.score * 1.05)) return { ...plain, tried: tried + plain.tried, rejected_tempo: best.tempo };
  }
  return { offset: best.offset, tempo: best.tempo, score: round3(best.raw), baseline: round3(baseline ?? 0), gain: round3(best.raw - (baseline ?? 0)), grid: best.grid, tried };
}

/**
 * Snap a story's numeric scene boundaries to downbeats (scene cuts) and its
 * numeric hits to beats, within `tolerance` seconds.
 * story: the unresolved finish copy; grid: story-time {beats, downbeats};
 * context: {words, beats} for re-resolving; mode: "auto"|"cuts"|"hits".
 * → {story (new copy), changes, reverted, skipped}
 */
export function snapStory(story, grid, { tolerance = SNAP_TOLERANCE, mode = "auto", words = [], beats = null, checkModule = defaultModuleCheck } = {}) {
  let working = clone(story);
  const changes = [];
  const reverted = [];
  const skipped = [];
  const context = { words, beats: beats ?? grid };
  const resolvedNow = () => resolveStory(working, context);
  let resolved;
  try { resolved = resolvedNow(); } catch (error) { return { story: working, changes, reverted, skipped: [{ reason: `story does not resolve: ${error.message}` }] }; }
  const duration = Number(resolved.resolved.duration);

  const attempt = (label, mutate, affected) => {
    const candidate = clone(working);
    mutate(candidate);
    let problem = null;
    try {
      const again = resolveStory(candidate, context);
      const validation = validateStory(again);
      if (!validation.ok) problem = validation.errors[0];
      else for (const id of affected) {
        const scene = again.scenes.find((entry) => entry.id === id);
        if (!scene) continue;
        const message = checkModule(scene, again);
        if (message) { problem = message; break; }
      }
    } catch (error) { problem = error.message; }
    if (problem) { reverted.push({ ...label, reason: problem }); return false; }
    working = candidate;
    changes.push(label);
    return true;
  };

  if (mode === "auto" || mode === "cuts") {
    const count = baseScenes(resolved).length;
    for (let index = 1; index < count; index += 1) {
      // Re-resolve each time: an earlier move changes the previous scene.
      const scenes = baseScenes(resolvedNow());
      const scene = scenes[index];
      const previous = scenes[index - 1];
      if (!scene || !previous) break;
      const at = scene.start;
      if (at <= 0.05 || at >= duration - 0.05) continue;
      const original = findScene(working, scene.id);
      const before = Math.abs(previous.end - at) < 1e-6 ? findScene(working, previous.id) : null;
      const kindStart = anchorKind(original?.start);
      const kindEnd = before ? anchorKind(before.end) : "seconds";
      if (kindStart === "word" || kindEnd === "word") { skipped.push({ kind: "cut", scene: scene.id, at, reason: "word-anchored: stays on its word" }); continue; }
      if (kindStart !== "seconds" || kindEnd !== "seconds") { skipped.push({ kind: "cut", scene: scene.id, at, reason: "beat-anchored: already on the grid" }); continue; }
      const down = nearest(grid.downbeats, at);
      const beatTarget = nearest(grid.beats, at);
      const target = down.distance <= tolerance ? { time: down.value, grid: "downbeat" } : beatTarget.distance <= tolerance ? { time: beatTarget.value, grid: "beat" } : null;
      if (!target) { skipped.push({ kind: "cut", scene: scene.id, at, reason: `no beat within ${tolerance}s` }); continue; }
      if (Math.abs(target.time - at) < 0.002) { skipped.push({ kind: "cut", scene: scene.id, at, reason: `already on a ${target.grid}` }); continue; }
      const to = round3(target.time);
      // Both scenes keep a sane length (and room for the incoming transition).
      const transition = Number(original?.in?.dur ?? 0);
      if (to - previous.start < MIN_SCENE || scene.end - to < Math.max(MIN_SCENE, transition + 0.1)) {
        reverted.push({ kind: "cut", scene: scene.id, from: at, to, grid: target.grid, reason: "a scene would become too short" });
        continue;
      }
      attempt({ kind: "cut", scene: scene.id, previous: before ? previous.id : null, from: at, to, delta: round3(to - at), grid: target.grid }, (candidate) => {
        findScene(candidate, scene.id).start = to;
        if (before) findScene(candidate, previous.id).end = to;
        // A numeric hit left outside its scene by the move comes along to the edge.
        for (const id of [scene.id, previous.id]) {
          const entry = findScene(candidate, id);
          for (const hit of Array.isArray(entry?.hits) ? entry.hits : []) {
            if (anchorKind(hit.at) !== "seconds") continue;
            const value = Number(hit.at);
            if (id === scene.id && value < to) hit.at = to;
            if (id === previous.id && value > to) hit.at = to;
          }
        }
      }, [scene.id, previous.id]);
    }
  }

  if (mode === "auto" || mode === "hits") {
    resolved = resolvedNow();
    for (const scene of Array.isArray(resolved.scenes) ? resolved.scenes : []) {
      const source = findScene(working, scene.id);
      (Array.isArray(scene.hits) ? scene.hits : []).forEach((hit, index) => {
        const raw = source?.hits?.[index]?.at;
        const kind = anchorKind(raw);
        if (kind === "word") { skipped.push({ kind: "hit", scene: scene.id, event: hit.event, at: hit.at, reason: "word-anchored: stays on its word" }); return; }
        if (kind !== "seconds") return;
        const target = nearest(grid.beats, hit.at);
        if (target.distance > tolerance) { skipped.push({ kind: "hit", scene: scene.id, event: hit.event, at: hit.at, reason: `no beat within ${tolerance}s` }); return; }
        if (target.distance < 0.002) return;
        const to = round3(target.value);
        if (to < scene.start - 1e-6 || to > scene.end + 1e-6) { skipped.push({ kind: "hit", scene: scene.id, event: hit.event, at: hit.at, reason: "the nearest beat is outside the scene" }); return; }
        attempt({ kind: "hit", scene: scene.id, event: hit.event, from: hit.at, to, delta: round3(to - hit.at), grid: nearest(grid.downbeats, to).distance < 0.002 ? "downbeat" : "beat" }, (candidate) => {
          findScene(candidate, scene.id).hits[index].at = to;
        }, [scene.id]);
      });
    }
  }
  return { story: working, changes, reverted, skipped };
}

function defaultModuleCheck(scene, story) {
  if (scene.module === "custom") return null;
  try { resolveModule(scene, story); return null; } catch (error) { return error.message; }
}

/**
 * Where the key moments sit against a grid after sync, for the report:
 * [{kind, scene, at, nearest_downbeat, downbeat_delta, nearest_beat, beat_delta, on_downbeat, on_beat}]
 */
export function momentReport(moments, grid) {
  return moments.map((moment) => {
    const down = nearest(grid.downbeats, moment.at);
    const beat = nearest(grid.beats, moment.at);
    return {
      kind: moment.kind,
      scene: moment.scene,
      ...(moment.event ? { event: moment.event } : {}),
      at: round3(moment.at),
      nearest_downbeat: Number.isFinite(down.value) ? round3(down.value) : null,
      downbeat_delta: Number.isFinite(down.value) ? round3(moment.at - down.value) : null,
      nearest_beat: Number.isFinite(beat.value) ? round3(beat.value) : null,
      beat_delta: Number.isFinite(beat.value) ? round3(moment.at - beat.value) : null,
      on_downbeat: down.distance <= ON_GRID,
      on_beat: beat.distance <= ON_GRID
    };
  });
}

/** Counts for the report summary. */
export function summarizeMoments(report) {
  const cuts = report.filter((entry) => entry.kind !== "hit");
  const hits = report.filter((entry) => entry.kind === "hit");
  return {
    cuts: cuts.length,
    cuts_on_downbeat: cuts.filter((entry) => entry.on_downbeat).length,
    cuts_on_beat: cuts.filter((entry) => entry.on_beat).length,
    hits: hits.length,
    hits_on_beat: hits.filter((entry) => entry.on_beat).length,
    key_moments_on_downbeat: report.filter((entry) => (entry.kind === "hook-cut" || entry.kind === "payoff") && entry.on_downbeat).length,
    key_moments: report.filter((entry) => entry.kind === "hook-cut" || entry.kind === "payoff").length
  };
}

function anchorKind(value) {
  return parseAnchor(value)?.kind ?? null;
}

function findScene(story, id) {
  return (Array.isArray(story?.scenes) ? story.scenes : []).find((scene) => scene?.id === id) ?? null;
}

/** Nearest value in a sorted list → {value, distance}. */
export function nearest(list, t) {
  if (!Array.isArray(list) || !list.length) return { value: NaN, distance: Infinity };
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid] <= t) lo = mid; else hi = mid;
  }
  const a = list[lo];
  const b = list[hi];
  return Math.abs(a - t) <= Math.abs(b - t) ? { value: a, distance: Math.abs(a - t) } : { value: b, distance: Math.abs(b - t) };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round3(value) { return Math.round(value * 1000) / 1000; }
function round4(value) { return Math.round(value * 10000) / 10000; }
