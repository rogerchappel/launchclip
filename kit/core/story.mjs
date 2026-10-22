// story.json v1: validate, resolve time anchors, derive boundaries.
//
// Plain ESM with no imports, so it can be bundled into Remotion and copied
// into skills unchanged. The canonical copy lives in kit/core/; see
// docs/KIT_CONTRACTS.md ("story.json v1") for the binding contract.

export const STORY_SCHEMA = "launchclip.story.v1";

export const STORY_LANES = ["motion", "voiceover-motion", "footage-led"];
export const STORY_TRANSITIONS = ["cut", "fade", "push", "whip", "zoom", "iris", "morph"];
export const STORY_DIRECTIONS = ["left", "right", "up", "down"];
export const STORY_CAPTION_STYLES = ["word-highlight", "line", "none"];

const ASPECTS = [["9:16", 9 / 16], ["16:9", 16 / 9], ["1:1", 1], ["4:5", 4 / 5]];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z][a-z0-9_-]{0,59}$/;
const MODULE_ID = /^[a-z][a-z0-9-]{0,59}$/;
const OFFSET = "([+-](?:\\d+(?:\\.\\d+)?|\\.\\d+))?";
const WORD_ANCHOR = new RegExp(`^word:([^#\\s]+?)(?:#(\\d+))?${OFFSET}$`);
const BEAT_ANCHOR = new RegExp(`^(beat|downbeat):(\\d+)${OFFSET}$`);
const NUMERIC = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const EPS = 1e-6;
const TOP_LEVEL = new Set(["schema", "lane", "format", "brand", "audio", "base", "scenes", "overlays", "ending", "title", "notes", "resolved", "meta"]);

// ---------------------------------------------------------------------------
// Anchors

/**
 * Parse a time anchor without resolving it.
 * Returns {kind:"seconds", seconds} | {kind:"word", text, occurrence, offset}
 * | {kind:"beat"|"downbeat", index, offset}, or null when the value is not a
 * syntactically valid anchor.
 */
export function parseAnchor(anchor) {
  if (typeof anchor === "number") return Number.isFinite(anchor) ? { kind: "seconds", seconds: anchor } : null;
  if (typeof anchor !== "string") return null;
  const value = anchor.trim();
  if (NUMERIC.test(value)) return { kind: "seconds", seconds: Number(value) };
  let match = WORD_ANCHOR.exec(value);
  if (match) {
    const text = normalizeWord(match[1]);
    const occurrence = match[2] === undefined ? 1 : Number(match[2]);
    if (!text || occurrence < 1) return null;
    return { kind: "word", text, occurrence, offset: match[3] ? Number(match[3]) : 0 };
  }
  match = BEAT_ANCHOR.exec(value);
  if (match) return { kind: match[1], index: Number(match[2]), offset: match[3] ? Number(match[3]) : 0 };
  return null;
}

export function isAnchor(value) {
  return parseAnchor(value) !== null;
}

/** Resolve one anchor to seconds (rounded to the millisecond). Throws on unknown anchors. */
export function resolveAnchor(anchor, { words = [], beats = null } = {}) {
  const parsed = parseAnchor(anchor);
  if (!parsed) throw new Error(`Invalid time anchor ${JSON.stringify(anchor)}; use seconds, "word:<text>[#n][+/-s]", "beat:<n>" or "downbeat:<n>"`);
  if (parsed.kind === "seconds") return parsed.seconds;
  if (parsed.kind === "word") {
    const matches = findWord(wordList(words), parsed.text);
    if (!matches.length) throw new Error(`Unknown anchor ${anchor}: no narration word matches "${parsed.text}"`);
    if (parsed.occurrence > matches.length) throw new Error(`Unknown anchor ${anchor}: "${parsed.text}" occurs ${matches.length} time${matches.length === 1 ? "" : "s"}`);
    return ms(matches[parsed.occurrence - 1] + parsed.offset);
  }
  const grid = beats && typeof beats === "object" ? beats : null;
  if (!grid) throw new Error(`Unknown anchor ${anchor}: no beats (BEATS.json) supplied`);
  let list;
  let index = parsed.index;
  if (parsed.kind === "downbeat") {
    if (Array.isArray(grid.downbeats)) list = grid.downbeats;
    else { list = grid.beats; index *= 4; }
  } else list = grid.beats;
  if (!Array.isArray(list)) throw new Error(`Unknown anchor ${anchor}: BEATS.json has no ${parsed.kind === "downbeat" ? "downbeats or beats" : "beats"} array`);
  const value = Number(list[index]);
  if (index >= list.length || !Number.isFinite(value)) throw new Error(`Unknown anchor ${anchor}: only ${list.length} ${parsed.kind}s available`);
  return ms(value + parsed.offset);
}

function wordList(words) {
  const list = Array.isArray(words) ? words : Array.isArray(words?.words) ? words.words : [];
  return list
    .map((entry) => ({ token: normalizeWord(entry?.text ?? entry?.word ?? ""), start: Number(entry?.start) }))
    .filter((entry) => entry.token && Number.isFinite(entry.start));
}

// Case-insensitive, punctuation-free; internal hyphens survive so that a
// hyphenated anchor can match a hyphenated token.
function normalizeWord(value) {
  return String(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/^-+|-+$/g, "");
}

// Returns the start times of every match, in narration order. A hyphenated
// anchor matches one hyphenated token or the consecutive tokens it joins.
function findWord(tokens, text) {
  const parts = text.split("-").filter(Boolean);
  const starts = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].token === text) { starts.push(tokens[i].start); continue; }
    if (parts.length > 1 && i + parts.length <= tokens.length && parts.every((part, j) => tokens[i + j].token === part)) {
      starts.push(tokens[i].start);
    }
  }
  return starts;
}

function ms(value) {
  return Math.round(value * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Validation

/**
 * Validate a story.json v1 document (resolved or not).
 * modules: optional Set or array of known module ids; unknown ids are errors when given.
 */
export function validateStory(story, { modules } = {}) {
  const errors = [];
  const warnings = [];
  const err = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);
  const known = modules == null ? null : new Set(modules instanceof Set ? [...modules] : Array.isArray(modules) ? modules : []);

  if (!isObject(story)) return { ok: false, errors: ["story must be a JSON object"], warnings };

  if (story.schema !== STORY_SCHEMA) {
    const major = typeof story.schema === "string" && /^launchclip\.story\.v\d+/.test(story.schema);
    err(major ? `schema ${story.schema} is not supported; this tool reads ${STORY_SCHEMA}` : `schema must be "${STORY_SCHEMA}"`);
  }
  for (const key of Object.keys(story)) if (!TOP_LEVEL.has(key)) warn(`${key} is not a story.json v1 field and is ignored`);

  if (!STORY_LANES.includes(story.lane)) err(`lane must be one of ${STORY_LANES.join(", ")}`);

  // format
  let duration = null;
  if (!isObject(story.format)) err("format must be an object with width, height, fps and duration");
  else {
    const { width, height, fps } = story.format;
    if (!Number.isInteger(width) || width <= 0) err("format.width must be a positive integer");
    if (!Number.isInteger(height) || height <= 0) err("format.height must be a positive integer");
    if (!Number.isInteger(fps) || fps <= 0 || fps > 120) err("format.fps must be an integer between 1 and 120");
    if (typeof story.format.duration !== "number" || !Number.isFinite(story.format.duration) || story.format.duration <= 0) err("format.duration must be a positive number of seconds");
    else duration = story.format.duration;
    if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && !aspectName(width, height)) {
      err(`format aspect ${width}x${height} is not supported; use 9:16, 16:9, 1:1 or 4:5`);
    }
    if (story.format.platform !== undefined && !nonEmpty(story.format.platform)) err("format.platform must be a non-empty string");
  }

  // brand
  if (!isObject(story.brand)) err("brand must be an object with colors and fonts");
  else {
    if (!isObject(story.brand.colors) || !Object.keys(story.brand.colors).length) err("brand.colors must be an object of named six-digit hex colors");
    else for (const [name, value] of Object.entries(story.brand.colors)) if (typeof value !== "string" || !HEX.test(value)) err(`brand.colors.${name} must be a six-digit hex color like #1a2b3c`);
    if (!isObject(story.brand.fonts) || !Object.keys(story.brand.fonts).length) err("brand.fonts must be an object of named font families");
    else for (const [name, value] of Object.entries(story.brand.fonts)) if (!nonEmpty(value)) err(`brand.fonts.${name} must be a non-empty font family name`);
  }

  // audio
  const audio = story.audio;
  if (audio !== undefined && audio !== null && !isObject(audio)) err("audio must be an object or null");
  if (isObject(audio)) {
    if (audio.voice !== undefined && audio.voice !== null) assetPath(audio.voice, "audio.voice", err);
    if (audio.words !== undefined && audio.words !== null) projectPath(audio.words, "audio.words", err);
    if (audio.music !== undefined && audio.music !== null) {
      if (typeof audio.music === "string") { if (audio.music !== "synth" && audio.music !== "none") assetPath(audio.music, "audio.music", err); }
      else if (!isObject(audio.music)) err("audio.music must be an object, \"synth\", \"none\" or an assets/ path");
      else {
        if (!nonEmpty(audio.music.source)) err("audio.music.source must be \"synth\" or an assets/ path");
        else if (audio.music.source !== "synth") assetPath(audio.music.source, "audio.music.source", err);
        if (audio.music.bpm !== undefined && !(typeof audio.music.bpm === "number" && audio.music.bpm > 0 && audio.music.bpm <= 300)) err("audio.music.bpm must be a number between 1 and 300");
        if (audio.music.key !== undefined && !nonEmpty(audio.music.key)) err("audio.music.key must be a non-empty string");
      }
    }
    if (audio.sfx !== undefined && audio.sfx !== null && !["auto", "none"].includes(audio.sfx) && audio.sfx !== false) err("audio.sfx must be \"auto\", \"none\" or false");
  }
  if (story.lane === "voiceover-motion") {
    if (!isObject(audio) || !audio.voice) err("audio.voice is required for the voiceover-motion lane");
    if (!isObject(audio) || !audio.words) err("audio.words (NARRATION.json) is required for the voiceover-motion lane");
  }

  // base
  if (story.base !== undefined && story.base !== null) {
    if (typeof story.base === "string") assetPath(story.base, "base", err);
    else if (!isObject(story.base)) err("base must be null, an assets/ path or an object with source");
    else assetPath(story.base.source, "base.source", err);
  }
  if (story.lane === "footage-led" && (story.base === undefined || story.base === null)) err("base is required for the footage-led lane");

  // scenes
  const scenes = Array.isArray(story.scenes) ? story.scenes : null;
  if (!scenes || !scenes.length) err("scenes must be a non-empty array");
  const ids = new Map();
  let usesWords = false;
  const anchorField = (value, path) => {
    const parsed = parseAnchor(value);
    if (!parsed) { err(`${path} must be seconds or a time anchor ("word:<text>[#n]", "beat:<n>", "downbeat:<n>", optional +/-seconds); got ${JSON.stringify(value)}`); return null; }
    if (parsed.kind === "word") usesWords = true;
    if (parsed.kind === "seconds") {
      if (parsed.seconds < 0) err(`${path} must not be negative`);
      return parsed.seconds;
    }
    return null;
  };
  const timing = [];
  const fromObjects = [];
  for (const [index, scene] of (scenes ?? []).entries()) {
    const path = `scenes[${index}]`;
    if (!isObject(scene)) { err(`${path} must be an object`); timing.push(null); continue; }
    const label = typeof scene.id === "string" ? `${path} (${scene.id})` : path;
    if (typeof scene.id !== "string" || !ID.test(scene.id)) err(`${path}.id must be a lowercase identifier like "s1"`);
    else if (ids.has(scene.id)) err(`${path}.id "${scene.id}" duplicates scenes[${ids.get(scene.id)}].id`);
    else ids.set(scene.id, index);

    if (scene.module === "custom") {
      if (scene.source === undefined) err(`${path}.source is required for a custom module (a project-relative path)`);
      else if (projectPath(scene.source, `${path}.source`, err)) warn(`${label} uses a custom module (${scene.source}); custom modules are bespoke-tier only and must stay a pure function of time`);
    } else if (typeof scene.module !== "string" || !MODULE_ID.test(scene.module)) err(`${path}.module must be a catalogue module id like "metric"`);
    else {
      if (known && !known.has(scene.module)) err(`${path}.module "${scene.module}" is not a known module`);
      if (scene.source !== undefined) err(`${path}.source is only allowed with module "custom"`);
    }
    if (scene.params !== undefined && !isObject(scene.params)) err(`${path}.params must be an object`);
    if (isObject(scene.params)) for (const key of ["id", "kind", "aspect", "start", "duration"]) if (key in scene.params) err(`${path}.params.${key} is not allowed; it comes from the scene and the format`);

    const start = scene.start === undefined ? (err(`${path}.start is required`), null) : anchorField(scene.start, `${path}.start`);
    const end = scene.end === undefined ? (err(`${path}.end is required`), null) : anchorField(scene.end, `${path}.end`);
    if (start !== null && end !== null && !(start < end)) err(`${path}.start must be before ${path}.end`);
    if (duration !== null && end !== null && end > duration + EPS) err(`${path}.end (${end}) is beyond format.duration (${duration})`);
    if (duration !== null && start !== null && start >= duration) err(`${path}.start (${start}) is not within format.duration (${duration})`);

    const track = scene.track ?? 0;
    if (!Number.isInteger(track) || track < 0) err(`${path}.track must be a non-negative integer`);

    if (scene.energy !== undefined && !(scene.energy === "build" || (Number.isInteger(scene.energy) && scene.energy >= 0 && scene.energy <= 3))) {
      err(`${path}.energy must be 0, 1, 2, 3 or "build"`);
    }

    if (scene.in !== undefined && scene.in !== null) {
      const transition = scene.in;
      if (!isObject(transition)) err(`${path}.in must be an object`);
      else {
        if (!STORY_TRANSITIONS.includes(transition.type)) err(`${path}.in.type must be one of ${STORY_TRANSITIONS.join(", ")}`);
        if (typeof transition.dur !== "number" || !Number.isFinite(transition.dur) || transition.dur <= 0) err(`${path}.in.dur must be a positive number of seconds`);
        else if (start !== null && end !== null && transition.dur >= end - start) err(`${path}.in.dur (${transition.dur}) must be shorter than the scene (${ms(end - start)}s)`);
        if (transition.direction !== undefined && !STORY_DIRECTIONS.includes(transition.direction)) err(`${path}.in.direction must be one of ${STORY_DIRECTIONS.join(", ")}`);
        if (transition.from_object !== undefined) fromObjects.push({ index, path: `${path}.in.from_object`, value: transition.from_object });
        if (transition.type === "morph" && transition.from_object === undefined) warn(`${label} morphs without in.from_object; name the object handed across the boundary`);
      }
    }

    if (scene.hits !== undefined) {
      if (!Array.isArray(scene.hits)) err(`${path}.hits must be an array`);
      else for (const [h, hit] of scene.hits.entries()) {
        const hitPath = `${path}.hits[${h}]`;
        if (!isObject(hit)) { err(`${hitPath} must be an object`); continue; }
        if (hit.at === undefined) err(`${hitPath}.at is required`);
        else {
          const at = anchorField(hit.at, `${hitPath}.at`);
          if (at !== null && start !== null && end !== null && (at < start - EPS || at > end + EPS)) warn(`${hitPath}.at (${at}) falls outside ${label} [${start}, ${end}]`);
        }
        if (!nonEmpty(hit.event)) err(`${hitPath}.event must be a non-empty string`);
        if (hit.cue !== undefined && !nonEmpty(hit.cue)) err(`${hitPath}.cue must be a non-empty string`);
      }
    }
    timing.push({ index, id: scene.id, label, start, end, track: Number.isInteger(track) ? track : 0 });
  }

  // from_object must name an earlier scene: "s2.gap-bracket" → scene "s2".
  for (const ref of fromObjects) {
    if (typeof ref.value !== "string" || !/^[a-z][a-z0-9_-]*(\.[A-Za-z0-9_-]+)?$/.test(ref.value)) { err(`${ref.path} must look like "<scene-id>.<object>", e.g. "s2.gap-bracket"`); continue; }
    const sceneId = ref.value.split(".")[0];
    const target = timing.find((entry) => entry && entry.id === sceneId);
    const self = timing[ref.index];
    if (!target) err(`${ref.path} references unknown scene "${sceneId}"`);
    else if (target.index === ref.index) err(`${ref.path} must reference an earlier scene, not the scene itself`);
    // With unresolved anchors the order is unknown here; the resolved story is checked again.
    else if (target.start !== null && self && self.start !== null && !(target.start < self.start)) {
      err(`${ref.path} must reference an earlier scene; "${sceneId}" does not come before ${self?.label ?? ref.path}`);
    }
  }

  // Same-track overlaps are forbidden (checked once times are numbers).
  const byTrack = new Map();
  for (const entry of timing) if (entry && entry.start !== null && entry.end !== null) {
    if (!byTrack.has(entry.track)) byTrack.set(entry.track, []);
    byTrack.get(entry.track).push(entry);
  }
  for (const [track, list] of byTrack) {
    list.sort((a, b) => a.start - b.start || a.index - b.index);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start < list[i - 1].end - EPS) err(`${list[i].label} overlaps ${list[i - 1].label} on track ${track}; move one to another track or adjust start/end`);
    }
  }

  // overlays
  if (story.overlays !== undefined && story.overlays !== null) {
    if (!Array.isArray(story.overlays)) err("overlays must be an array");
    else for (const [index, overlay] of story.overlays.entries()) {
      const path = `overlays[${index}]`;
      if (!isObject(overlay)) { err(`${path} must be an object`); continue; }
      if (!nonEmpty(overlay.type)) err(`${path}.type must be a non-empty string`);
      if (overlay.type === "captions" && overlay.style !== undefined && !STORY_CAPTION_STYLES.includes(overlay.style)) err(`${path}.style must be one of ${STORY_CAPTION_STYLES.join(", ")}`);
      if (overlay.start !== undefined) anchorField(overlay.start, `${path}.start`);
      if (overlay.end !== undefined) anchorField(overlay.end, `${path}.end`);
    }
  }

  // ending
  if (story.ending !== undefined && story.ending !== null) {
    if (!isObject(story.ending)) err("ending must be an object or null");
    else {
      if (story.ending.loop_to !== undefined) {
        if (typeof story.ending.loop_to !== "string" || !ids.has(story.ending.loop_to)) err(`ending.loop_to must reference a scene id; got ${JSON.stringify(story.ending.loop_to)}`);
      }
      if (story.ending.in !== undefined && story.ending.in !== null) {
        const transition = story.ending.in;
        if (story.ending.loop_to === undefined) err("ending.in requires ending.loop_to");
        if (!isObject(transition)) err("ending.in must be an object");
        else {
          if (!STORY_TRANSITIONS.includes(transition.type)) err(`ending.in.type must be one of ${STORY_TRANSITIONS.join(", ")}`);
          if (typeof transition.dur !== "number" || !Number.isFinite(transition.dur) || transition.dur <= 0) err("ending.in.dur must be a positive number of seconds");
          else if (duration !== null && transition.dur >= duration) err("ending.in.dur must be shorter than format.duration");
          if (transition.direction !== undefined && !STORY_DIRECTIONS.includes(transition.direction)) err(`ending.in.direction must be one of ${STORY_DIRECTIONS.join(", ")}`);
          if (transition.from_object !== undefined) {
            const sceneId = typeof transition.from_object === "string" ? transition.from_object.split(".")[0] : null;
            if (!sceneId || !ids.has(sceneId)) err(`ending.in.from_object references unknown scene "${sceneId ?? transition.from_object}"`);
          }
          const target = ids.has(story.ending.loop_to) ? scenes[ids.get(story.ending.loop_to)] : null;
          if (target && isObject(target.in)) err(`ending.in conflicts with ${`scenes[${ids.get(story.ending.loop_to)}]`}.in; both declare boundary "${story.ending.loop_to}-in"`);
        }
      }
    }
  }

  if (usesWords && !(isObject(audio) && audio.words)) warn("word anchors are used but audio.words is not set; pass narration timings when resolving");

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Resolution and derived data

/**
 * Deep copy of the story with every time anchor (scene start/end, hit at,
 * overlay start/end) replaced by seconds, scenes sorted by start, plus
 * `resolved: {duration, fps, frames}`.
 */
export function resolveStory(story, { words = [], beats = null } = {}) {
  if (!isObject(story)) throw new Error("story must be a JSON object");
  const copy = JSON.parse(JSON.stringify(story));
  const context = { words, beats };
  const resolve = (value, path) => {
    try { return resolveAnchor(value, context); }
    catch (error) { throw new Error(`${path}: ${error.message}`); }
  };
  const scenes = Array.isArray(copy.scenes) ? copy.scenes : [];
  scenes.forEach((scene, index) => {
    if (!isObject(scene)) return;
    const path = `scenes[${index}]`;
    if (scene.start !== undefined) scene.start = resolve(scene.start, `${path}.start`);
    if (scene.end !== undefined) scene.end = resolve(scene.end, `${path}.end`);
    if (Array.isArray(scene.hits)) scene.hits.forEach((hit, h) => {
      if (isObject(hit) && hit.at !== undefined) hit.at = resolve(hit.at, `${path}.hits[${h}].at`);
    });
  });
  if (Array.isArray(copy.overlays)) copy.overlays.forEach((overlay, index) => {
    if (!isObject(overlay)) return;
    if (overlay.start !== undefined) overlay.start = resolve(overlay.start, `overlays[${index}].start`);
    if (overlay.end !== undefined) overlay.end = resolve(overlay.end, `overlays[${index}].end`);
  });
  copy.scenes = scenes
    .map((scene, index) => ({ scene, index }))
    .sort((a, b) => (Number(a.scene?.start) - Number(b.scene?.start)) || ((a.scene?.track ?? 0) - (b.scene?.track ?? 0)) || a.index - b.index)
    .map((entry) => entry.scene);
  const format = storyFormat(copy);
  copy.resolved = { duration: format.duration, fps: format.fps, frames: Math.round(format.duration * format.fps) };
  return copy;
}

/**
 * Transition boundaries of a resolved story, in the shape of
 * parseDeclaredSequenceBoundaries() (src/cinematic_evidence.js).
 * One boundary per scene with `in`, plus the loop boundary when
 * `ending.in` is set (from the last scene back to `ending.loop_to`).
 */
export function deriveBoundaries(story) {
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  for (const [index, scene] of scenes.entries()) {
    if (typeof scene?.start !== "number" || typeof scene?.end !== "number") throw new Error(`deriveBoundaries needs a resolved story; scenes[${index}] has unresolved start/end (run resolveStory first)`);
  }
  const ordered = scenes.map((scene, index) => ({ scene, index })).sort((a, b) => a.scene.start - b.scene.start || a.index - b.index);
  const boundaries = [];
  for (const { scene } of ordered) {
    if (!isObject(scene.in)) continue;
    const track = scene.track ?? 0;
    const before = ordered.filter(({ scene: other }) => other !== scene && other.start < scene.start - EPS);
    const sameTrack = before.filter(({ scene: other }) => (other.track ?? 0) === track);
    const pool = sameTrack.length ? sameTrack : before;
    const previous = pool.reduce((best, entry) => (!best || entry.scene.end > best.scene.end + EPS || (Math.abs(entry.scene.end - best.scene.end) <= EPS && entry.scene.start > best.scene.start)) ? entry : best, null);
    boundaries.push(boundary(scene.id, previous?.scene.id ?? null, scene.in, scene.start));
  }
  const ending = story?.ending;
  if (isObject(ending) && isObject(ending.in) && typeof ending.loop_to === "string") {
    const duration = storyFormat(story).duration;
    const last = ordered.filter(({ scene }) => (scene.track ?? 0) === 0);
    const pool = last.length ? last : ordered;
    const final = pool.reduce((best, entry) => (!best || entry.scene.end >= best.scene.end) ? entry : best, null);
    boundaries.push(boundary(ending.loop_to, final?.scene.id ?? null, ending.in, ms(duration - ending.in.dur)));
  }
  return boundaries.sort((a, b) => a.start_seconds - b.start_seconds);
}

function boundary(toId, fromId, transition, start) {
  const sequenceId = typeof transition.from_object === "string" ? transition.from_object.split(".")[0] : null;
  const shared = transition.type === "morph" || sequenceId !== null;
  return {
    boundary_id: `${toId}-in`,
    sequence_id: sequenceId,
    kind: shared ? "shared-world" : "ordinary",
    start_seconds: start,
    duration_seconds: transition.dur,
    from_id: fromId,
    to_id: toId
  };
}

export function storyFormat(story) {
  const format = isObject(story?.format) ? story.format : {};
  return { duration: format.duration, width: format.width, height: format.height, fps: format.fps };
}

/** Hits of a resolved story: [{scene_id, at, event, cue?}] sorted by at. */
export function storyHits(story) {
  const hits = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    for (const hit of Array.isArray(scene?.hits) ? scene.hits : []) {
      if (typeof hit?.at !== "number") throw new Error(`storyHits needs a resolved story; ${scene.id} has an unresolved hit at ${JSON.stringify(hit?.at)}`);
      const entry = { scene_id: scene.id, at: hit.at, event: hit.event };
      if (hit.cue !== undefined) entry.cue = hit.cue;
      hits.push(entry);
    }
  }
  return hits.map((hit, index) => ({ hit, index })).sort((a, b) => a.hit.at - b.hit.at || a.index - b.index).map((entry) => entry.hit);
}

/** "9:16" | "16:9" | "1:1" | "4:5" | null */
export function aspectName(width, height) {
  const ratio = width / height;
  const match = ASPECTS.find(([, value]) => Math.abs(ratio - value) / value < 0.01);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Helpers

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function projectPath(value, path, err) {
  if (!nonEmpty(value)) { err(`${path} must be a project-relative path`); return false; }
  if (value.startsWith("/") || value.startsWith("\\") || /^[a-zA-Z]:/.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.split(/[\\/]/).includes("..")) {
    err(`${path} must be a project-relative path without "..", a leading slash or a URL scheme; got ${JSON.stringify(value)}`);
    return false;
  }
  return true;
}

function assetPath(value, path, err) {
  if (!projectPath(value, path, err)) return false;
  if (!value.replace(/^\.\//, "").startsWith("assets/")) { err(`${path} must be a project-relative path under assets/; got ${JSON.stringify(value)}`); return false; }
  return true;
}
