// Tooling tidies a planned storyboard before it is checked: slips with one
// obvious correction are corrected here, without a model call, and every
// correction is reported (the planner writes each as a "normalise:" warning).
// A repair pass that fixes a number tends to break another one, so these are
// not the model's to fix:
//
// 1. a character alone in a cast scene with a side position stands in the centre;
// 2. two scenes overlapping on a track are trimmed to meet (the earlier one's
//    end, else the later one's start), while both keep their minimum length;
// 3. a cue time just outside its scene moves to the scene's edge;
// 4. a target naming a character who is not in the shot: the character joins
//    a wide shot with room, else the target becomes the side they stand on,
//    else (when the action needs no target) it is dropped;
// 5. a speaker off screen for a small part of their line (a cut a fraction of
//    a second off, a pace fit that took the line's first word): the cut moves
//    so the speaker's scene covers the whole line;
// 6. a direction line naming a scene that is not on its words names the one
//    character scene that is.
//
// What has no single correction stays an error for the repair: a speaker
// absent for most of a line, a cue far outside its scene, scenes that cannot
// both keep their minimum. The modules and the checks stay strict; this only
// rewrites the storyboard (and the map's scene names) the planner returned.

import { moduleTiming } from "@launchclip/core/modules.mjs";
import { CUE_SNAP, castRefId, resolveStory, storyCastIds } from "@launchclip/core/story.mjs";
import { offScreenSpeech, sceneCharacters } from "@launchclip/core/direction.mjs";
import { ACTING } from "@launchclip/core/characters/acting.mjs";
import { TARGET_REQUIRED } from "@launchclip/core/characters/actions.mjs";

const EPS = 1e-6;
// The most a cut moves to keep a speaker on screen (s), and the most it moves
// when the speaker would otherwise miss more than half of the line's words.
export const SPEAKER_SHIFT = 0.75;
export const SPEAKER_NUDGE = 0.4;
// No scene is trimmed shorter than this, whatever its module allows.
const FLOOR = 0.5;
// Most characters a cast scene holds.
const CAST_MAX = 3;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const round = (value) => Math.round(value * 100) / 100;
const floor2 = (value) => Math.floor(value * 100 + 1e-6) / 100;
const ceil2 = (value) => Math.ceil(value * 100 - 1e-6) / 100;
const minimum = (scene) => Math.max(Number(moduleTiming(scene?.module)?.minDuration) || 0, FLOOR);
const trackOf = (scene) => (Number.isInteger(scene?.track) ? scene.track : 0);
const label = (scene, index) => scene?.id ?? `scenes[${index}]`;

/**
 * storyboard: as planned (anchors unresolved); direction: the map, when
 * there is one; words: the narration's words; script: SCRIPT.json, when the
 * story has one (who speaks each line).
 * → {storyboard, direction (copies when anything changed), changed: [what was corrected]}
 */
export function normalisePlan(storyboard, { words = [], beats = null, direction = null, script = null } = {}) {
  if (!isObject(storyboard) || !Array.isArray(storyboard.scenes)) return { storyboard, direction, changed: [] };
  const state = { story: structuredClone(storyboard), map: direction ? structuredClone(direction) : null, changed: [], words: Array.isArray(words) ? words : Array.isArray(words?.words) ? words.words : [], beats, script };
  fitTargets(state);
  fitPositions(state);
  fitOverlaps(state);
  fitSpeakers(state);
  fitLineScenes(state);
  fitCueTimes(state);
  if (!state.changed.length) return { storyboard, direction, changed: [] };
  return { storyboard: state.story, direction: state.map ?? direction, changed: state.changed };
}

// Scene times as the checks will see them ([{start, end}] by scene index), or null when the anchors do not resolve.
function resolved(state) {
  try { return resolveStory(structuredClone(state.story), { words: state.words, beats: state.beats }); } catch { return null; }
}

// ---------------------------------------------------------------------------
// 1. One character stands in the centre

function fitPositions({ story, changed }) {
  story.scenes.forEach((scene, index) => {
    const cast = scene?.module === "cast-scene" && Array.isArray(scene.params?.cast) ? scene.params.cast.filter(isObject) : [];
    if (cast.length === 1 && typeof cast[0].position === "string" && !["centre", "center"].includes(cast[0].position)) {
      changed.push(`${label(scene, index)}: ${cast[0].id ?? "its character"} is alone in the shot, so position "${cast[0].position}" became "centre"`);
      cast[0].position = "centre";
    }
    // Two characters have no centre: each takes the side the story's cast gives it.
    if (cast.length === 2) for (const entry of cast) if (["centre", "center"].includes(entry.position)) {
      changed.push(`${label(scene, index)}: two characters share the shot, so ${entry.id ?? "a character"}'s position "${entry.position}" was dropped (it takes its side from the story's cast)`);
      delete entry.position;
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Scenes overlapping on a track

function fitOverlaps(state) {
  const { story, changed } = state;
  const timed = resolved(state);
  if (!timed) return;
  const times = timed.scenes.map((scene) => ({ start: Number(scene.start), end: Number(scene.end) }));
  const tracks = new Map();
  story.scenes.forEach((scene, index) => {
    if (!Number.isFinite(times[index]?.start) || !Number.isFinite(times[index]?.end)) return;
    const track = trackOf(scene);
    if (!tracks.has(track)) tracks.set(track, []);
    tracks.get(track).push(index);
  });
  for (const [track, list] of tracks) {
    list.sort((a, b) => times[a].start - times[b].start || a - b);
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1], b = list[i];
      if (!(times[b].start < times[a].end - EPS)) continue;
      const first = story.scenes[a], second = story.scenes[b];
      if (times[b].start - times[a].start >= minimum(first) - EPS) {
        changed.push(`${label(first, a)} ran ${round(times[a].end - times[b].start)} s into ${label(second, b)} on track ${track}; its end moved ${round(times[a].end)} → ${round(times[b].start)} s`);
        times[a].end = times[b].start;
        first.end = round(times[b].start);
      } else if (times[b].end - times[a].end >= minimum(second) - EPS) {
        changed.push(`${label(second, b)} began ${round(times[a].end - times[b].start)} s inside ${label(first, a)} on track ${track}; its start moved ${round(times[b].start)} → ${round(times[a].end)} s`);
        moveStart(second, times[b].start, times[a].end);
        times[b].start = times[a].end;
      }
      // Neither fits: the overlap stays for the checks to report.
    }
  }
}

// A scene's start moved: times counted from it (numeric cue and speech times of a character scene) keep their place in the video.
function moveStart(scene, from, to) {
  scene.start = round(to);
  const shift = from - round(to);
  if (!isObject(scene.params) || !["cast-scene", "character-cameo"].includes(scene.module) || Math.abs(shift) < EPS) return;
  const moved = (value) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round((value + shift) * 1000) / 1000) : value);
  const actor = (entry) => {
    if (!isObject(entry)) return;
    if (Array.isArray(entry.cues)) for (const cue of entry.cues) if (isObject(cue)) cue.at = moved(cue.at);
    if (Array.isArray(entry.says)) for (const range of entry.says) if (isObject(range)) { range.from = moved(range.from); range.to = moved(range.to); }
  };
  if (Array.isArray(scene.params.cast)) scene.params.cast.forEach(actor);
  if (scene.module === "character-cameo") actor(scene.params);
  if (Array.isArray(scene.params.props)) for (const prop of scene.params.props) if (isObject(prop) && Array.isArray(prop.cues)) for (const cue of prop.cues) if (isObject(cue)) cue.at = moved(cue.at);
}

// ---------------------------------------------------------------------------
// 3. Cue times just outside their scene

function fitCueTimes(state) {
  const { story, changed } = state;
  const timed = resolved(state);
  if (!timed) return;
  story.scenes.forEach((scene, index) => {
    if (!["cast-scene", "character-cameo"].includes(scene?.module) || !isObject(scene.params)) return;
    const duration = Number(timed.scenes[index]?.end) - Number(timed.scenes[index]?.start);
    if (!(duration > 0)) return;
    const last = Math.floor(Math.max(0, duration - ACTING.poseTween) * 1000) / 1000;
    const actors = scene.module === "cast-scene" ? (Array.isArray(scene.params.cast) ? scene.params.cast : []) : [scene.params];
    for (const entry of actors) {
      if (!isObject(entry) || !Array.isArray(entry.cues)) continue;
      for (const cue of entry.cues) {
        if (!isObject(cue) || typeof cue.at !== "number" || !Number.isFinite(cue.at)) continue;
        const to = cue.at < 0 && cue.at >= -CUE_SNAP ? 0 : cue.at > last + EPS && cue.at <= duration + CUE_SNAP ? last : null;
        if (to === null) continue;
        changed.push(`${label(scene, index)}: ${entry.id ?? entry.character ?? "a character"}'s cue at ${cue.at} s is outside the ${round(duration)} s scene (a cue lands between 0 and ${last} s); it moved to ${to} s`);
        cue.at = to;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 4. Targets naming a character who is not in the shot

function fitTargets({ story, changed }) {
  const ids = storyCastIds(story);
  const members = new Map((Array.isArray(story.cast?.characters) ? story.cast.characters : []).filter(isObject).map((member) => [member.id, member]));
  const side = (id) => (["left", "right"].includes(members.get(id)?.position) ? members.get(id).position : null);
  story.scenes.forEach((scene, index) => {
    if (!["cast-scene", "character-cameo"].includes(scene?.module) || !isObject(scene.params)) return;
    const cameo = scene.module === "character-cameo";
    const actors = cameo ? [scene.params] : Array.isArray(scene.params.cast) ? scene.params.cast : [];
    const present = () => (cameo ? [castRefId(scene.params.character, ids)] : actors.filter(isObject).map((entry) => castRefId(entry.id, ids)));
    for (const entry of [...actors]) {
      if (!isObject(entry)) continue;
      const who = castRefId(entry.id ?? entry.character, ids);
      const holders = [{ holder: entry, action: null }, ...(Array.isArray(entry.cues) ? entry.cues.filter(isObject).map((cue) => ({ holder: cue, action: cue.action ?? null })) : [])];
      for (const { holder, action } of holders) {
        const named = isObject(holder.target) && typeof holder.target.character === "string" ? castRefId(holder.target.character, ids) : null;
        if (!named || named === who || present().includes(named)) continue;
        const where = `${label(scene, index)}: ${who ?? "a character"}'s target ${named} is not in the shot`;
        // A wide shot with room takes the character the action is about.
        if (!cameo && members.has(named) && scene.params.shot === "wide" && actors.length < CAST_MAX) {
          actors.push({ id: named });
          changed.push(`${where}; ${named} joined it (a wide shot with room)`);
          continue;
        }
        const to = side(named) ?? (side(who) === "left" ? "right" : side(who) === "right" ? "left" : null);
        if (to) {
          holder.target = to;
          changed.push(`${where}; the target became "${to}"${side(named) ? `, the side ${named} stands on` : ""}`);
        } else if (!TARGET_REQUIRED.includes(action)) {
          delete holder.target;
          changed.push(`${where}; the target was dropped`);
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 5. A speaker off screen for a small part of their line

// Every narrative line a speaker is partly unseen on: [{speaker, missing: [word indexes], count, …}], and the unseen words in all.
function unseen(state, timed) {
  const found = [];
  for (const section of Array.isArray(state.map?.sections) ? state.map.sections : []) {
    if (!isObject(section) || section.beat === undefined || !Array.isArray(section.lines)) continue;
    for (const line of section.lines) {
      if (!isObject(line) || (typeof line.why === "string" && line.why.trim())) continue;
      found.push(...offScreenSpeech(line, { words: state.words, story: timed, script: state.script }).map((entry) => ({ ...entry, range: line.words })));
    }
  }
  return { found, total: found.reduce((sum, entry) => sum + entry.missing.length, 0) };
}

function fitSpeakers(state) {
  if (!state.map || !state.words.length) return;
  for (let pass = 0; pass < 12; pass += 1) {
    const timed = resolved(state);
    if (!timed) return;
    const before = unseen(state, timed);
    let moved = false;
    for (const entry of before.found) {
      const attempt = coverLine(state, timed, entry);
      if (!attempt) continue;
      const after = resolveStoryOf(attempt.story, state);
      // Kept only when fewer words are spoken unseen: a cut moved for one speaker never takes the picture from another.
      if (!after || unseen({ ...state, story: attempt.story }, after).total >= before.total) continue;
      state.story = attempt.story;
      state.changed.push(attempt.note);
      moved = true;
      break;
    }
    if (!moved) return;
  }
}

function resolveStoryOf(story, state) {
  try { return resolveStory(structuredClone(story), { words: state.words, beats: state.beats }); } catch { return null; }
}

// One speaker's unseen words on one line → the storyboard with the cut moved, or null when that is not a small move.
function coverLine(state, timed, entry) {
  const { words } = state;
  const spoken = [];
  for (let i = entry.words[0]; i <= entry.words[1]; i += 1) if (!words[i]?.speaker || words[i].speaker === entry.speaker) spoken.push(i);
  const missing = entry.missing;
  const head = missing.every((index, k) => index === spoken[k]);
  const tail = missing.every((index, k) => index === spoken[spoken.length - missing.length + k]);
  if (!head && !tail) return null;
  const scenes = timed.scenes.map((scene, index) => ({ index, start: Number(scene.start), end: Number(scene.end), who: sceneCharacters(scene), track: trackOf(scene) }))
    .filter((scene) => Number.isFinite(scene.start) && Number.isFinite(scene.end));
  const total = Number(timed.resolved?.duration ?? timed.format?.duration);
  const said = `"${entry.text.slice(0, 40)}"`;
  for (const atHead of [...(head ? [true] : []), ...(tail ? [false] : [])]) {
    const next = structuredClone(state.story);
    if (atHead) {
      // The speaker's scene starts after the line does: its start moves back to the line's first unseen word.
      const cut = floor2(Number(words[missing[0]].start));
      const shot = scenes.filter((scene) => scene.who.includes(entry.speaker) && scene.start > cut + EPS && scene.end > Number(words[missing[missing.length - 1]].end)).sort((a, b) => a.start - b.start)[0];
      if (!shot || !small(shot.start - cut, missing, entry)) continue;
      let fits = true;
      for (const other of scenes) {
        if (other.index === shot.index || other.track !== shot.track || !(other.end > cut + EPS) || !(other.start < shot.start)) continue;
        if (cut - other.start < minimum(next.scenes[other.index]) - EPS) { fits = false; break; }
        next.scenes[other.index].end = cut;
      }
      if (!fits) continue;
      moveStart(next.scenes[shot.index], shot.start, cut);
      return { story: next, note: `the cut to ${label(next.scenes[shot.index], shot.index)} moved ${round(shot.start)} → ${cut} s, so ${entry.speaker} is on screen for all of ${said}` };
    }
    // The speaker's scene ends before the line does: its end moves out to the line's last unseen word.
    const cut = Math.min(ceil2(Number(words[missing[missing.length - 1]].end)), Number.isFinite(total) ? total : Infinity);
    const shot = scenes.filter((scene) => scene.who.includes(entry.speaker) && scene.end < cut - EPS && scene.start < Number(words[missing[0]].start)).sort((a, b) => b.end - a.end)[0];
    if (!shot || !small(cut - shot.end, missing, entry)) continue;
    let fits = true;
    for (const other of scenes) {
      if (other.index === shot.index || other.track !== shot.track || !(other.start < cut - EPS) || !(other.end > shot.end)) continue;
      if (other.end - cut < minimum(next.scenes[other.index]) - EPS) { fits = false; break; }
      moveStart(next.scenes[other.index], other.start, cut);
    }
    if (!fits) continue;
    next.scenes[shot.index].end = cut;
    return { story: next, note: `the cut out of ${label(next.scenes[shot.index], shot.index)} moved ${round(shot.end)} → ${cut} s, so ${entry.speaker} is on screen for all of ${said}` };
  }
  return null;
}

// A small move: under SPEAKER_SHIFT for half of the line's words or fewer, under SPEAKER_NUDGE for more (a short line whose cut is a fraction of a second off).
function small(shift, missing, entry) {
  if (!(shift > 0)) return false;
  return shift <= (missing.length * 2 <= entry.count ? SPEAKER_SHIFT : SPEAKER_NUDGE) + EPS;
}

// ---------------------------------------------------------------------------
// 6. Direction lines naming a scene that is not on their words

function fitLineScenes(state) {
  const { map, words, changed } = state;
  if (!map || !Array.isArray(map.sections) || !words.length) return;
  const timed = resolved(state);
  if (!timed) return;
  const scenes = timed.scenes.map((scene) => ({ id: scene.id, start: Number(scene.start), end: Number(scene.end), cast: sceneCharacters(scene).length > 0 })).filter((scene) => typeof scene.id === "string" && Number.isFinite(scene.start) && Number.isFinite(scene.end));
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  map.sections.forEach((section, s) => {
    if (!isObject(section) || !Array.isArray(section.lines)) return;
    section.lines.forEach((line, l) => {
      const range = line?.words;
      if (!isObject(line) || !Array.isArray(line.scenes) || !line.scenes.length || !(Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] >= range[0] && range[1] < words.length)) return;
      const start = Number(words[range[0]].start), end = Number(words[range[1]].end);
      if (!(end > start)) return;
      const on = (id) => { const scene = byId.get(id); return Boolean(scene) && scene.start < end && scene.end > start; };
      const off = line.scenes.filter((id) => typeof id === "string" && !on(id));
      if (!off.length) return;
      const where = `direction ${section.id ?? `sections[${s}]`} line ${l + 1}`;
      const kept = line.scenes.filter((id) => typeof id === "string" && on(id));
      if (kept.length) {
        line.scenes = kept;
        changed.push(`${where} named ${off.join(", ")}, which ${off.length === 1 ? "is" : "are"} not on its words (${round(start)}–${round(end)} s); it keeps ${kept.join(", ")}`);
        return;
      }
      // The one character scene on screen for at least half of the line's words.
      const covering = scenes.filter((scene) => scene.cast && Math.min(scene.end, end) - Math.max(scene.start, start) >= (end - start) / 2);
      if (covering.length !== 1) return;
      line.scenes = [covering[0].id];
      changed.push(`${where} named ${off.join(", ")}, which ${off.length === 1 ? "is" : "are"} not on its words (${round(start)}–${round(end)} s); it names ${covering[0].id}, the character scene that is`);
    });
  });
}
