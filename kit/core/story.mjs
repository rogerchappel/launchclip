// story.json v1: validate, resolve time anchors, derive boundaries.
//
// Plain ESM with no imports, so it can be bundled into Remotion and copied
// into skills unchanged. The canonical copy lives in kit/core/; see
// docs/KIT_CONTRACTS.md ("story.json v1") for the binding contract.

export const STORY_SCHEMA = "launchclip.story.v1";

export const STORY_LANES = ["motion", "voiceover-motion", "footage-led"];
export const STORY_TRANSITIONS = ["cut", "fade", "push", "whip", "zoom", "iris", "morph", "pan", "pull", "orbit", "whip-pan"];
export const STORY_ENDING_KEYS = Object.freeze(["loop_to", "in", "loop", "final"]);
export const STORY_ENDING_FINALS = Object.freeze(["hold", "fade", "exit"]);
// Camera transitions (kit/core/camera-world.mjs): the camera travels to the
// next scene instead of the layers moving. `push` is a camera dolly only in
// camera.mode "world"; in "cuts" it keeps its slide meaning.
export const STORY_CAMERA_TRANSITIONS = ["pan", "pull", "orbit", "whip-pan"];
export const STORY_CAMERA_MODES = ["cuts", "world"];
export const STORY_CAMERA_LAYOUTS = ["row", "column", "grid", "path", "auto"];
// story.motion.grammar presets (kit/core/grammar.mjs GRAMMAR_NAMES).
export const STORY_GRAMMARS = ["editorial", "snappy", "smooth", "playful", "documentary", "cinematic"];
export const STORY_DIRECTIONS = ["left", "right", "up", "down"];
export const STORY_CAPTION_STYLES = ["word-highlight", "line", "none"];
// Caption presets (kit/core/captions.mjs CAPTION_PRESETS; kept in step by test/caption_presets.test.js).
export const STORY_CAPTION_PRESETS = ["word-highlight", "karaoke-fill", "pop-word", "bounce", "typewriter", "box-highlight", "underline-sweep", "kinetic-stack", "minimal-line", "glow", "outline-heavy", "split-color", "lower-band", "bubble"];
const CAPTION_OPTION_ENUMS = { position: ["bottom", "middle", "top", "auto"], case: ["as-is", "upper", "title"], font: ["display", "body", "meta"], entrance: ["pop", "fade", "slide-up", "slide-left", "scale", "none"], exit: ["fade-up", "fade", "slide-down", "shrink", "none"] };
const CAPTION_COLOR_KEYS = ["idle", "active", "spoken", "accent", "box", "boxText", "plate", "band", "bandEdge", "chip"];
// audio.narration.provider: voice providers `launchclip finish` can synthesise with.
export const STORY_VOICE_PROVIDERS = ["kokoro", "elevenlabs", "supplied", "test"];
// audio.music.provider and audio.music.sync (launchclip finish's music stage).
export const STORY_MUSIC_PROVIDERS = ["synth", "elevenlabs", "file"];
export const STORY_MUSIC_SYNC = ["auto", "off", "cuts", "hits"];
// story.ambient / scenes[i].ambient levels (kit/core/ambient.mjs AMBIENT_LEVELS).
export const STORY_AMBIENT_LEVELS = ["off", "subtle", "standard", "lively"];

const ASPECTS = [["9:16", 9 / 16], ["16:9", 16 / 9], ["1:1", 1], ["4:5", 4 / 5]];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z][a-z0-9_-]{0,59}$/;
const MODULE_ID = /^[a-z][a-z0-9-]{0,59}$/;
const OFFSET = "([+-](?:\\d+(?:\\.\\d+)?|\\.\\d+))?";
const WORD_ANCHOR = new RegExp(`^word:([^#\\s]+?)(?:#(\\d+))?${OFFSET}$`);
const BEAT_ANCHOR = new RegExp(`^(beat|downbeat):(\\d+)${OFFSET}$`);
const NUMERIC = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const EPS = 1e-6;
// style: a style pack (src/story_style.js merges it before validation);
// motion, camera, ambient, layout: style-driven settings, carried through as data.
const TOP_LEVEL = new Set(["schema", "lane", "format", "brand", "audio", "base", "scenes", "overlays", "ending", "title", "notes", "resolved", "meta", "phase", "cinematic_contract", "style", "motion", "camera", "ambient", "layout", "sections"]);

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
  if (story.phase !== undefined && story.phase !== 2) err("phase must be 2 when set (the phase-2 cinematic contract)");
  if (story.cinematic_contract !== undefined && story.cinematic_contract !== "phase-2") err('cinematic_contract must be "phase-2" when set');
  for (const key of Object.keys(story)) if (!TOP_LEVEL.has(key)) warn(`${key} is not a story.json v1 field and is ignored`);

  if (story.style !== undefined && story.style !== null) {
    const style = story.style;
    if (isObject(style)) {
      if (!nonEmpty(style.name)) err("style.name must name a style pack or a path to its style.json");
      for (const key of ["intro", "outro", "loop"]) if (style[key] !== undefined && typeof style[key] !== "boolean") err(`style.${key} must be true or false`);
    } else if (!nonEmpty(style)) err("style must be a style pack name, a path to a style.json, or {name, intro?, outro?, loop?}");
  }

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
    // audio.mix: the premixed root track; both compilers mount exactly one root audio from it.
    if (audio.mix !== undefined && audio.mix !== null) assetPath(audio.mix, "audio.mix", err);
    if (audio.words !== undefined && audio.words !== null) projectPath(audio.words, "audio.words", err);
    if (audio.music !== undefined && audio.music !== null) {
      if (typeof audio.music === "string") { if (audio.music !== "synth" && audio.music !== "none") assetPath(audio.music, "audio.music", err); }
      else if (!isObject(audio.music)) err("audio.music must be an object, \"synth\", \"none\" or an assets/ path");
      else validateMusic(audio.music, { err, warn });
    }
    if (audio.sfx !== undefined && audio.sfx !== null && !["auto", "none"].includes(audio.sfx) && audio.sfx !== false) err("audio.sfx must be \"auto\", \"none\" or false");
    // audio.narration: text that `launchclip finish` synthesises into audio.voice and audio.words.
    if (audio.narration !== undefined && audio.narration !== null) {
      const narration = audio.narration;
      if (!isObject(narration)) err("audio.narration must be an object with text, and optional provider, voice and speed");
      else {
        if (typeof narration.text !== "string" || !narration.text.trim()) err("audio.narration.text must be a non-empty string");
        else if (narration.text.length > 4000) err(`audio.narration.text must be at most 4000 characters; got ${narration.text.length}`);
        if (narration.provider !== undefined && !STORY_VOICE_PROVIDERS.includes(narration.provider)) err(`audio.narration.provider must be one of ${STORY_VOICE_PROVIDERS.join(", ")}`);
        if (narration.voice !== undefined && !nonEmpty(narration.voice)) err("audio.narration.voice must be a non-empty string");
        if (narration.speed !== undefined && !(typeof narration.speed === "number" && narration.speed >= 0.5 && narration.speed <= 2)) err("audio.narration.speed must be a number between 0.5 and 2");
      }
    }
  }
  // Narration text means the voice and its word timings are synthesised later
  // (launchclip finish), so they are not required yet and word anchors wait.
  const narrated = isObject(audio) && isObject(audio.narration);
  if (story.lane === "voiceover-motion" && !narrated) {
    if (!isObject(audio) || !audio.voice) err("audio.voice is required for the voiceover-motion lane (or set audio.narration to synthesise it)");
    if (!isObject(audio) || !audio.words) err("audio.words (NARRATION.json) is required for the voiceover-motion lane (or set audio.narration to synthesise it)");
  }

  // motion.grammar and camera (kit/core/grammar.mjs, kit/core/camera-world.mjs).
  validateMotion(story.motion, err);
  const camera = validateCamera(story.camera, { err, warn, lane: story.lane });

  // ambient: the ambient-motion control (kit/core/ambient.mjs).
  validateAmbient(story.ambient, "ambient", err);

  // base: the footage-led recording (see validateBase).
  if (story.base !== undefined && story.base !== null) validateBase(story.base, { err, warn, duration, resolved: isObject(story.resolved) });
  if (story.lane === "footage-led" && (story.base === undefined || story.base === null)) err("base is required for the footage-led lane");
  if (story.lane === "footage-led" && isObject(audio) && audio.voice) warn("audio.voice is not mounted in the footage-led lane; the base recording carries the voice (use audio.mix for a music/SFX bed)");
  if (isObject(audio) && audio.mix_volume !== undefined && !(typeof audio.mix_volume === "number" && audio.mix_volume >= 0 && audio.mix_volume <= 1)) err("audio.mix_volume must be a number between 0 and 1");

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
    // Footage-led: track 0 is the base and its full-frame inserts; overlays
    // (and punch-in cameras) sit on track 1 or higher.
    if (scene.insert !== undefined && typeof scene.insert !== "boolean") err(`${path}.insert must be true or false`);
    else if (scene.insert === true && story.lane !== "footage-led") err(`${path}.insert is only for the footage-led lane`);
    else if (story.lane === "footage-led" && Number.isInteger(track)) {
      if (scene.insert === true && track !== 0) err(`${path}.insert scenes cover the base on track 0; remove track or set it to 0`);
      if (scene.insert !== true && track === 0) err(`${path} sits on track 0, which is the base in the footage-led lane; set track to 1 or higher for an overlay, or insert: true for a full-frame insert`);
    }

    // Depth against the cut-out subject (docs/SUBJECT_EFFECTS_RFC.md §5.2).
    if (scene.layer !== undefined) {
      if (!SCENE_LAYERS.includes(scene.layer)) err(`${path}.layer must be one of ${SCENE_LAYERS.join(", ")}`);
      else if (scene.layer !== "front") {
        if (story.lane !== "footage-led") err(`${path}.layer "${scene.layer}" needs the footage-led lane: the subject is the person in the base recording`);
        else if (scene.insert === true) err(`${path}.layer: an insert covers the whole frame, so it cannot sit behind the subject`);
        else if (subjectMode(story.base) === "off") err(`${path}.layer "${scene.layer}" needs the subject, but base.subject is "off"`);
      }
    }

    if (scene.energy !== undefined && !(scene.energy === "build" || (Number.isInteger(scene.energy) && scene.energy >= 0 && scene.energy <= 3))) {
      err(`${path}.energy must be 0, 1, 2, 3 or "build"`);
    }

    validateAmbient(scene.ambient, `${path}.ambient`, err);

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
        cameraTransitionRules(transition, `${path}.in`, { err, lane: story.lane, camera, track });
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
  // Gaps between track-0 scenes are empty plates (no footage base fills them).
  // The compilers hold the previous scene through gaps under 0.5 s; longer
  // gaps show the bare background.
  const plates = byTrack.get(0);
  if (plates && !story.base && plates.length === timing.filter((entry) => entry && entry.track === 0).length) {
    const frame = 1 / (Number(story.format?.fps) > 0 ? Number(story.format.fps) : 30);
    let covered = 0, previous = null;
    for (const entry of plates) {
      if (entry.start - covered > frame + EPS) {
        warn(`empty plate from ${round3(covered)} s to ${round3(entry.start)} s (${previous ? `between ${previous.label} and ${entry.label}` : `before ${entry.label}`}): no scene covers it; ${entry.start - covered < 0.5 - EPS && previous ? 'the previous scene is held through it' : 'the bare background shows'}. Extend the scenes to meet.`);
      }
      if (entry.end > covered) { covered = entry.end; previous = entry; }
    }
  }

  // overlays
  if (story.overlays !== undefined && story.overlays !== null) {
    if (!Array.isArray(story.overlays)) err("overlays must be an array");
    else for (const [index, overlay] of story.overlays.entries()) {
      const path = `overlays[${index}]`;
      if (!isObject(overlay)) { err(`${path} must be an object`); continue; }
      if (!nonEmpty(overlay.type)) err(`${path}.type must be a non-empty string`);
      if (overlay.type === "captions" && overlay.style !== undefined && !STORY_CAPTION_STYLES.includes(overlay.style) && !STORY_CAPTION_PRESETS.includes(overlay.style)) err(`${path}.style must be one of ${STORY_CAPTION_STYLES.join(", ")} or a caption preset (${STORY_CAPTION_PRESETS.join(", ")})`);
      if (overlay.type === "captions") validateCaptionOptions(overlay, path, err);
      if (overlay.type === "captions") {
        if (overlay.src !== undefined && overlay.src !== null) assetPath(overlay.src, `${path}.src`, err);
        if (overlay.hide !== undefined) {
          if (!Array.isArray(overlay.hide)) err(`${path}.hide must be an array of [start, end] ranges`);
          else for (const [h, range] of overlay.hide.entries()) {
            const rangePath = `${path}.hide[${h}]`;
            if (!Array.isArray(range) || range.length !== 2) { err(`${rangePath} must be a [start, end] pair`); continue; }
            const from = anchorField(range[0], `${rangePath}[0]`);
            const to = anchorField(range[1], `${rangePath}[1]`);
            if (from !== null && to !== null && !(from < to)) err(`${rangePath} start must be before its end`);
          }
        }
      } else {
        for (const key of ["src", "hide"]) if (overlay[key] !== undefined) warn(`${path}.${key} is only read for captions overlays`);
      }
      if (overlay.start !== undefined) anchorField(overlay.start, `${path}.start`);
      if (overlay.end !== undefined) anchorField(overlay.end, `${path}.end`);
    }
  }

  // ending
  // ending: {loop_to: "<scene id>", in?} loops; {loop_to: null} or
  // {loop: false} (or no ending) does not, and then `final` says how the last
  // scene ends: "hold" (default: settled, no exit), "fade" (completes its exit
  // to the background by the final frame) or "exit" (plays its own exit,
  // ending at format.duration).
  if (story.ending !== undefined && story.ending !== null) {
    if (!isObject(story.ending)) err("ending must be an object or null");
    else {
      for (const key of Object.keys(story.ending)) if (!STORY_ENDING_KEYS.includes(key)) err(`ending.${key} is not a known ending key (allowed: ${STORY_ENDING_KEYS.join(", ")}); for a held last frame use ending.final: "hold"`);
      const loops = typeof story.ending.loop_to === "string";
      if (story.ending.loop_to !== undefined && story.ending.loop_to !== null) {
        if (typeof story.ending.loop_to !== "string" || !ids.has(story.ending.loop_to)) err(`ending.loop_to must reference a scene id, or be null for no loop; got ${JSON.stringify(story.ending.loop_to)}`);
      }
      if (story.ending.loop !== undefined) {
        if (story.ending.loop !== false) err("ending.loop must be false (no loop); to loop, set ending.loop_to to a scene id");
        else if (loops) err("ending.loop: false contradicts ending.loop_to; drop one");
      }
      if (story.ending.final !== undefined) {
        if (!STORY_ENDING_FINALS.includes(story.ending.final)) err(`ending.final must be one of ${STORY_ENDING_FINALS.join(", ")}`);
        else if (loops) err("ending.final only applies without a loop; a looping story returns to ending.loop_to instead");
      }
      if (story.ending.in !== undefined && story.ending.in !== null) {
        const transition = story.ending.in;
        if (!loops) err("ending.in requires ending.loop_to");
        if (!isObject(transition)) err("ending.in must be an object");
        else {
          if (!STORY_TRANSITIONS.includes(transition.type)) err(`ending.in.type must be one of ${STORY_TRANSITIONS.join(", ")}`);
          if (typeof transition.dur !== "number" || !Number.isFinite(transition.dur) || transition.dur <= 0) err("ending.in.dur must be a positive number of seconds");
          else if (duration !== null && transition.dur >= duration) err("ending.in.dur must be shorter than format.duration");
          if (transition.direction !== undefined && !STORY_DIRECTIONS.includes(transition.direction)) err(`ending.in.direction must be one of ${STORY_DIRECTIONS.join(", ")}`);
          cameraTransitionRules(transition, "ending.in", { err, lane: story.lane, camera, track: 0 });
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

  if (usesWords && !(isObject(audio) && audio.words) && !narrated) warn("word anchors are used but audio.words is not set; pass narration timings when resolving");
  // Footage layouts (kit/core/footage-layout.mjs).
  validateSections(story, { err, warn });

  return { ok: errors.length === 0, errors, warnings };
}

// audio.music as an object: {provider?, prompt?, bpm?, key?, file?, sync?,
// seed?, model?, volume?}; `source` ("synth" or an assets/ path) is the older
// spelling and still accepted.
const MUSIC_KEYS = new Set(["provider", "source", "file", "prompt", "bpm", "key", "sync", "seed", "model", "volume"]);

function validateMusic(music, { err, warn }) {
  for (const key of Object.keys(music)) if (!MUSIC_KEYS.has(key)) warn(`audio.music.${key} is not a music field and is ignored (allowed: ${[...MUSIC_KEYS].join(", ")})`);
  if (music.provider !== undefined && !STORY_MUSIC_PROVIDERS.includes(music.provider)) err(`audio.music.provider must be one of ${STORY_MUSIC_PROVIDERS.join(", ")}`);
  if (music.source !== undefined) {
    if (!nonEmpty(music.source)) err("audio.music.source must be \"synth\" or an assets/ path");
    else if (music.source !== "synth") assetPath(music.source, "audio.music.source", err);
  }
  if (music.file !== undefined) assetPath(music.file, "audio.music.file", err);
  if (music.file !== undefined && nonEmpty(music.source) && music.source !== "synth") err("audio.music.file and audio.music.source name the same track; keep audio.music.file");
  const hasFile = music.file !== undefined || (nonEmpty(music.source) && music.source !== "synth");
  if (music.provider === "file" && !hasFile) err("audio.music.provider \"file\" needs audio.music.file (an assets/ path)");
  if (hasFile && music.provider !== undefined && music.provider !== "file") err(`audio.music.file is only used with provider "file"; got provider "${music.provider}"`);
  if (music.prompt !== undefined) {
    if (!nonEmpty(music.prompt)) err("audio.music.prompt must be a non-empty string");
    else if (music.prompt.length > 2000) err(`audio.music.prompt must be at most 2000 characters; got ${music.prompt.length}`);
    else if (music.provider === "synth" || music.provider === "file" || music.source === "synth" || hasFile) warn("audio.music.prompt is only used by the elevenlabs provider");
  }
  if (music.bpm !== undefined && !(typeof music.bpm === "number" && music.bpm > 0 && music.bpm <= 300)) err("audio.music.bpm must be a number between 1 and 300");
  if (music.key !== undefined && !nonEmpty(music.key)) err("audio.music.key must be a non-empty string");
  if (music.sync !== undefined && !STORY_MUSIC_SYNC.includes(music.sync)) err(`audio.music.sync must be one of ${STORY_MUSIC_SYNC.join(", ")}`);
  if (music.seed !== undefined && !(Number.isInteger(music.seed) && music.seed >= 0 && music.seed <= 4294967295)) err("audio.music.seed must be a non-negative integer");
  if (music.model !== undefined && !nonEmpty(music.model)) err("audio.music.model must be a non-empty string such as \"music_v1\"");
  if (music.volume !== undefined && !(typeof music.volume === "number" && music.volume >= 0 && music.volume <= 1)) err("audio.music.volume must be a number between 0 and 1");
}

function validateCaptionOptions(overlay, path, err) {
  if (overlay.preset !== undefined && overlay.preset !== "none" && !STORY_CAPTION_PRESETS.includes(overlay.preset)) err(`${path}.preset must be one of ${STORY_CAPTION_PRESETS.join(", ")} (or "none")`);
  for (const [key, values] of Object.entries(CAPTION_OPTION_ENUMS)) if (overlay[key] !== undefined && !values.includes(overlay[key])) err(`${path}.${key} must be one of ${values.join(", ")}`);
  for (const key of ["max_words", "max_chars"]) if (overlay[key] !== undefined && !(Number.isInteger(overlay[key]) && overlay[key] >= 1 && overlay[key] <= 40)) err(`${path}.${key} must be an integer between 1 and 40`);
  if (overlay.size !== undefined && !(typeof overlay.size === "number" && overlay.size >= 0.4 && overlay.size <= 2.5)) err(`${path}.size must be a scale between 0.4 and 2.5`);
  if (overlay.offset !== undefined && !(typeof overlay.offset === "number" && Math.abs(overlay.offset) <= 0.5)) err(`${path}.offset must be seconds between -0.5 and 0.5`);
  if (overlay.stroke !== undefined && overlay.stroke !== false && !(typeof overlay.stroke === "number" && overlay.stroke >= 0 && overlay.stroke <= 40)) err(`${path}.stroke must be false or a width in px (0-40)`);
  if (overlay.shadow !== undefined && overlay.shadow !== false && typeof overlay.shadow !== "string") err(`${path}.shadow must be false or a CSS text-shadow`);
  if (overlay.emphasis !== undefined && !(overlay.emphasis === "auto" || overlay.emphasis === "none" || overlay.emphasis === false || (Array.isArray(overlay.emphasis) && overlay.emphasis.every(nonEmpty)))) err(`${path}.emphasis must be "auto", "none", false or a list of words`);
  if (overlay.hide_during_moves !== undefined && !(overlay.hide_during_moves === "auto" || typeof overlay.hide_during_moves === "boolean")) err(`${path}.hide_during_moves must be "auto" (dip out for vertical pans, push, pull and orbit), true (every camera move) or false`);
  if (overlay.keywords !== undefined && !(Array.isArray(overlay.keywords) && overlay.keywords.every(nonEmpty))) err(`${path}.keywords must be a list of words`);
  if (overlay.colors !== undefined) {
    if (!isObject(overlay.colors)) err(`${path}.colors must be an object of brand roles or hex colours`);
    else for (const [key, value] of Object.entries(overlay.colors)) {
      if (!CAPTION_COLOR_KEYS.includes(key)) err(`${path}.colors.${key} is not a caption colour (${CAPTION_COLOR_KEYS.join(", ")})`);
      else if (!nonEmpty(value) || (value.startsWith("#") && !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value))) err(`${path}.colors.${key} must be a brand colour role or a hex colour`);
    }
  }
}

// ---------------------------------------------------------------------------
// Resolution and derived data

/**
 * Deep copy of the story with every time anchor (scene start/end, hit at,
 * overlay start/end) replaced by seconds, scenes sorted by start, plus
 * `resolved: {duration, fps, frames}`.
 */
export function resolveStory(story, { words = [], beats = null, edl = null, subject = null, track = null } = {}) {
  if (!isObject(story)) throw new Error("story must be a JSON object");
  const copy = JSON.parse(JSON.stringify(story));
  // base.subject "auto" → the project's cached mattes for this base (subject:
  // [{src, in, out, info?, plate?, summary?}], from the loader's
  // assets/subject/mattes.json). Explicit mattes only take each matching
  // entry's summary (the framing modules place themselves by).
  if (Array.isArray(subject) && subject.length && copy.base != null && subjectMode(copy.base) === "auto") {
    if (typeof copy.base === "string") copy.base = { src: copy.base };
    copy.base.subject = { mattes: subject.map((matte) => ({ ...matte })).sort((a, b) => a.in - b.in) };
  } else if (Array.isArray(subject) && isObject(copy.base) && subjectMode(copy.base) === "mattes") {
    for (const matte of copy.base.subject.mattes) {
      const entry = subject.find((item) => item.src === matte?.src);
      if (entry?.summary && matte && matte.summary === undefined) matte.summary = entry.summary;
      if (entry?.outline && matte && matte.outline === undefined) matte.outline = entry.outline;
    }
  }
  // base.edl → base.trim from the edit-recording plan's kept segments.
  if (isObject(copy.base) && typeof copy.base.edl === "string" && edl != null && copy.base.trim === undefined) copy.base.trim = edlTrim(edl, "base.edl");
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
    if (Array.isArray(overlay.hide)) overlay.hide = overlay.hide.map((range, h) => Array.isArray(range)
      ? range.map((value, k) => resolve(value, `overlays[${index}].hide[${h}][${k}]`))
      : range);
  });
  if (Array.isArray(copy.sections)) copy.sections.forEach((section, index) => {
    if (!isObject(section)) return;
    if (section.start !== undefined) section.start = resolve(section.start, `sections[${index}].start`);
    if (section.end !== undefined) section.end = resolve(section.end, `sections[${index}].end`);
  });
  copy.scenes = scenes
    .map((scene, index) => ({ scene, index }))
    .sort((a, b) => (Number(a.scene?.start) - Number(b.scene?.start)) || ((a.scene?.track ?? 0) - (b.scene?.track ?? 0)) || a.index - b.index)
    .map((entry) => entry.scene);
  const format = storyFormat(copy);
  copy.resolved = { duration: format.duration, fps: format.fps, frames: Math.round(format.duration * format.fps) };
  // The whole-video head track (the loader's readStoryTrack): {source, fps,
  // frames: [{t, head, body}]}, which subjectContext and the face rule read
  // where no matte covers the time.
  if (isObject(track) && Array.isArray(track.frames) && copy.base != null && subjectMode(copy.base) !== "off") copy.resolved.subjectTrack = track;
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
    // Footage-led: an insert cuts in from the base (from_id null) unless an
    // earlier insert sits on track 0; overlays never hand off to an insert.
    const pool = sameTrack.length ? sameTrack : story.lane === "footage-led" ? [] : before;
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
  // Footage layouts: each layout-shift between sections is a boundary.
  if (story?.lane === "footage-led" && Array.isArray(story?.sections) && story.sections.length) boundaries.push(...(layoutSpans(story)?.boundaries ?? []));
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

// ---------------------------------------------------------------------------
// Motion grammar and camera (kit/core/grammar.mjs, kit/core/camera-world.mjs).
// The same rules as grammarErrors() and resolveCamera() there, kept here so
// this file stays import-free.

const GRAMMAR_KEYS = ["base", "ease", "duration", "overshoot", "stagger", "defaultTransition", "camera", "ambient"];
const EASE_ROLES = ["enter", "exit", "move", "camera", "emphasis"];
const DURATION_ROLES = ["enter", "exit", "transition", "camera"];
const EASE_NAME = /^(none|linear|(power[0-4]|quad|cubic|quart|quint|strong|expo|circ|sine|bounce|back|elastic)(\.(in|out|inOut))?(\(\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))?|steps\(\d+\))$/;

function validateMotion(motion, err) {
  if (motion === undefined || motion === null) return;
  if (!isObject(motion)) { err("motion must be an object {grammar}"); return; }
  for (const key of Object.keys(motion)) if (key !== "grammar") err(`motion.${key} is not supported (allowed: grammar)`);
  const grammar = motion.grammar;
  if (grammar === undefined || grammar === null) return;
  if (typeof grammar === "string") {
    if (!STORY_GRAMMARS.includes(grammar)) err(`motion.grammar must be one of ${STORY_GRAMMARS.join(", ")} or an object {base, ...overrides}`);
    return;
  }
  if (!isObject(grammar)) { err("motion.grammar must be a grammar name or an object {base, ...overrides}"); return; }
  for (const key of Object.keys(grammar)) if (!GRAMMAR_KEYS.includes(key)) err(`motion.grammar.${key} is not supported (allowed: ${GRAMMAR_KEYS.join(", ")})`);
  if (grammar.base !== undefined && !STORY_GRAMMARS.includes(grammar.base)) err(`motion.grammar.base must be one of ${STORY_GRAMMARS.join(", ")}`);
  if (grammar.ease !== undefined) {
    if (!isObject(grammar.ease)) err("motion.grammar.ease must be an object of role → ease name");
    else for (const [role, name] of Object.entries(grammar.ease)) {
      if (!EASE_ROLES.includes(role)) err(`motion.grammar.ease.${role} is not a role (allowed: ${EASE_ROLES.join(", ")})`);
      else if (typeof name !== "string" || !EASE_NAME.test(name.trim())) err(`motion.grammar.ease.${role} must be a GSAP ease name such as "power3.out"`);
    }
  }
  if (grammar.duration !== undefined) {
    if (!isObject(grammar.duration)) err("motion.grammar.duration must be an object of role → seconds");
    else for (const [role, seconds] of Object.entries(grammar.duration)) {
      if (!DURATION_ROLES.includes(role)) err(`motion.grammar.duration.${role} is not a role (allowed: ${DURATION_ROLES.join(", ")})`);
      else if (!(typeof seconds === "number" && seconds >= 0.05 && seconds <= 3)) err(`motion.grammar.duration.${role} must be between 0.05 and 3 seconds`);
    }
  }
  if (grammar.overshoot !== undefined && !(typeof grammar.overshoot === "number" && grammar.overshoot >= 0 && grammar.overshoot <= 0.5)) err("motion.grammar.overshoot must be between 0 and 0.5");
  if (grammar.stagger !== undefined && !(typeof grammar.stagger === "number" && grammar.stagger >= 0.25 && grammar.stagger <= 3)) err("motion.grammar.stagger must be a multiplier between 0.25 and 3");
  if (grammar.ambient !== undefined && !["off", "subtle", "standard", "lively"].includes(grammar.ambient)) err("motion.grammar.ambient must be off, subtle, standard or lively");
  if (grammar.camera !== undefined && !isObject(grammar.camera)) err("motion.grammar.camera must be an object");
}

// → the effective camera mode ("cuts" | "world") for the transition rules.
function validateCamera(camera, { err, warn, lane }) {
  if (camera === undefined || camera === null) return "cuts";
  if (!isObject(camera)) { err("camera must be an object {mode, layout?, spacing?, parallax?, blur?}"); return "cuts"; }
  for (const key of Object.keys(camera)) if (!["mode", "layout", "spacing", "parallax", "blur"].includes(key)) err(`camera.${key} is not supported (allowed: mode, layout, spacing, parallax, blur)`);
  const mode = camera.mode ?? "cuts";
  if (!STORY_CAMERA_MODES.includes(mode)) err(`camera.mode must be one of ${STORY_CAMERA_MODES.join(", ")}`);
  if (camera.layout !== undefined && !STORY_CAMERA_LAYOUTS.includes(camera.layout)) err(`camera.layout must be one of ${STORY_CAMERA_LAYOUTS.join(", ")}`);
  if (camera.spacing !== undefined && !(typeof camera.spacing === "number" && camera.spacing >= 0 && camera.spacing <= 1)) err("camera.spacing must be a number between 0 and 1 (the gap between scenes, as a fraction of the canvas)");
  for (const key of ["parallax", "blur"]) if (camera[key] !== undefined && typeof camera[key] !== "boolean") err(`camera.${key} must be true or false`);
  // A style pack may carry a world camera into any lane; footage-led ignores it.
  if (mode === "world" && lane === "footage-led") { warn("camera.mode \"world\" is ignored in the footage-led lane, which keeps cuts and punch-ins"); return "cuts"; }
  return mode === "world" ? "world" : "cuts";
}

function cameraTransitionRules(transition, path, { err, lane, camera, track }) {
  const type = transition.type;
  const moving = STORY_CAMERA_TRANSITIONS.includes(type) || (type === "push" && camera === "world");
  if (!moving) return;
  if (lane === "footage-led") err(`${path}.type "${type}" moves a world camera; footage-led stories keep cuts and punch-ins`);
  else if (track !== 0) err(`${path}.type "${type}" moves the camera between track-0 scenes; overlays (track ≥ 1) cannot use it`);
}

// ---------------------------------------------------------------------------
// Ambient motion control

// `ambient` is a level string or {level?, background?, drift?}; the same rules
// as kit/core/ambient.mjs ambientErrors(), kept here so this file stays
// import-free.
function validateAmbient(value, path, err) {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    if (!STORY_AMBIENT_LEVELS.includes(value)) err(`${path} must be one of ${STORY_AMBIENT_LEVELS.join(", ")} or an object {level?, background?, drift?}`);
    return;
  }
  if (!isObject(value)) { err(`${path} must be a level string or an object {level?, background?, drift?}`); return; }
  for (const key of Object.keys(value)) if (!["level", "background", "drift"].includes(key)) err(`${path}.${key} is not supported (allowed: level, background, drift)`);
  if (value.level !== undefined && !STORY_AMBIENT_LEVELS.includes(value.level)) err(`${path}.level must be one of ${STORY_AMBIENT_LEVELS.join(", ")}`);
  for (const key of ["background", "drift"]) if (value[key] !== undefined && typeof value[key] !== "boolean") err(`${path}.${key} must be true or false`);
}

// ---------------------------------------------------------------------------
// Footage-led base

export const BASE_FITS = ["cover", "contain"];
const BASE_KEYS = new Set(["src", "source", "start", "trim", "volume", "fit", "focus", "edl", "subject"]);
export const SCENE_LAYERS = ["front", "behind", "split"];
export const SUBJECT_MODES = ["auto", "off"];
const MATTE_KEYS = new Set(["src", "in", "out", "info", "plate", "contours", "summary", "outline"]);
const VIDEO_FILE = /\.(mp4|m4v|mov|webm)$/i;

function validateBase(base, { err, warn, duration, resolved }) {
  if (typeof base === "string") {
    if (assetPath(base, "base", err) && !VIDEO_FILE.test(base)) err(`base must be a video file (.mp4, .m4v, .mov or .webm); got ${JSON.stringify(base)}`);
    return;
  }
  if (!isObject(base)) { err("base must be null, an assets/ video path or an object with src"); return; }
  for (const key of Object.keys(base)) if (!BASE_KEYS.has(key)) err(`base.${key} is not supported (allowed: src, start, trim, volume, fit, focus, edl, subject)`);
  if (base.src !== undefined && base.source !== undefined) err("base.src and base.source name the same file; keep base.src");
  const src = base.src ?? base.source;
  const srcPath = base.src !== undefined || base.source === undefined ? "base.src" : "base.source";
  if (src === undefined) err("base.src is required (an assets/ video path)");
  else if (assetPath(src, srcPath, err) && !VIDEO_FILE.test(src)) err(`${srcPath} must be a video file (.mp4, .m4v, .mov or .webm); got ${JSON.stringify(src)}`);
  if (base.start !== undefined && !(typeof base.start === "number" && Number.isFinite(base.start) && base.start >= 0)) err("base.start must be a non-negative number of source seconds");
  if (base.volume !== undefined && !(typeof base.volume === "number" && base.volume >= 0 && base.volume <= 1)) err("base.volume must be a number between 0 and 1");
  if (base.fit !== undefined && !BASE_FITS.includes(base.fit)) err(`base.fit must be one of ${BASE_FITS.join(", ")}`);
  if (base.focus !== undefined) {
    if (!isObject(base.focus) || Object.keys(base.focus).some((key) => key !== "x" && key !== "y")) err("base.focus must be {x, y} with fractions between 0 and 1");
    else for (const axis of ["x", "y"]) if (!(typeof base.focus[axis] === "number" && base.focus[axis] >= 0 && base.focus[axis] <= 1)) err(`base.focus.${axis} must be a fraction between 0 and 1`);
  }
  if (base.subject !== undefined) validateSubject(base.subject, err);
  if (base.edl !== undefined) {
    if (projectPath(base.edl, "base.edl", err) && !/\.json$/i.test(base.edl)) err(`base.edl must point at an edit-recording plan (edit-plan.json); got ${JSON.stringify(base.edl)}`);
    if (base.trim !== undefined && !resolved) err("base.trim and base.edl both set the cuts; keep one (resolveStory fills trim from edl)");
  }
  if (base.trim !== undefined) {
    if (!Array.isArray(base.trim) || !base.trim.length) err("base.trim must be a non-empty array of [in, out] source ranges");
    else {
      let previous = -Infinity, length = 0;
      base.trim.forEach((range, index) => {
        const path = `base.trim[${index}]`;
        if (!Array.isArray(range) || range.length !== 2 || !range.every((value) => typeof value === "number" && Number.isFinite(value))) { err(`${path} must be an [in, out] pair of source seconds`); return; }
        const [from, to] = range;
        if (from < 0) err(`${path} in must not be negative`);
        if (!(to > from)) err(`${path} out must be after its in`);
        if (from < previous - EPS) err(`${path} starts before the previous range ends; ranges must be in source order without overlap`);
        previous = to;
        length += Math.max(0, to - from);
      });
      if (base.start !== undefined && base.start > 0) err("base.start applies only without base.trim; put the in-point in the first trim range");
      if (duration !== null && length + EPS < duration) warn(`the trimmed base runs ${ms(length)}s, shorter than format.duration (${duration}s); the frames after it show the background`);
    }
  }
}

/** Kept source ranges of an edit-recording plan (launchclip.recording-edit.v1) as [[in, out], …]. */
export function edlTrim(plan, label = "edl") {
  const segments = Array.isArray(plan?.kept_segments) ? plan.kept_segments : null;
  if (!segments || !segments.length) throw new Error(`${label}: the edit plan has no kept_segments (expected an edit-recording edit-plan.json)`);
  if (plan.schema_version !== undefined && plan.schema_version !== "launchclip.recording-edit.v1") throw new Error(`${label}: unsupported edit plan schema ${plan.schema_version}`);
  return segments.map((segment, index) => {
    const from = Number(segment?.source_start_seconds), to = Number(segment?.source_end_seconds);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) throw new Error(`${label}: kept_segments[${index}] needs source_start_seconds < source_end_seconds`);
    return [ms(from), ms(to)];
  });
}

// base.subject: "auto" (default: the project's cached mattes, filled in by
// resolveStory's `subject` option), "off", or explicit {mattes: [{src, in,
// out, info?}]}: alpha videos under assets/ for source ranges of the base.
function validateSubject(subject, err) {
  if (typeof subject === "string") {
    if (!SUBJECT_MODES.includes(subject)) err(`base.subject must be ${SUBJECT_MODES.map((mode) => `"${mode}"`).join(" or ")}, or {mattes: [...]}`);
    return;
  }
  if (!isObject(subject) || Object.keys(subject).some((key) => key !== "mattes")) { err('base.subject must be "auto", "off" or {mattes: [{src, in, out, info?}]}'); return; }
  if (!Array.isArray(subject.mattes)) { err("base.subject.mattes must be a list of {src, in, out, info?}"); return; }
  let previousOut = -Infinity;
  subject.mattes.forEach((matte, index) => {
    const path = `base.subject.mattes[${index}]`;
    if (!isObject(matte)) { err(`${path} must be {src, in, out, info?}`); return; }
    for (const key of Object.keys(matte)) if (!MATTE_KEYS.has(key)) err(`${path}.${key} is not supported (allowed: src, in, out, info, plate, contours)`);
    if (matte.contours !== undefined && assetPath(matte.contours, `${path}.contours`, err) && !/\.json$/i.test(matte.contours)) err(`${path}.contours must be the range's contours .json`);
    if (matte.plate !== undefined && assetPath(matte.plate, `${path}.plate`, err) && !/\.(jpe?g|png|webp)$/i.test(matte.plate)) err(`${path}.plate must be the range's plate image (.jpg, .png or .webp)`);
    if (matte.summary !== undefined && !isObject(matte.summary)) err(`${path}.summary must be an object (resolveStory fills it from info)`);
    if (assetPath(matte.src, `${path}.src`, err) && !/\.webm$/i.test(matte.src)) err(`${path}.src must be an alpha .webm (launchclip subject matte writes one)`);
    if (matte.info !== undefined && assetPath(matte.info, `${path}.info`, err) && !/\.json$/i.test(matte.info)) err(`${path}.info must be the matte's subject.json`);
    const valid = typeof matte.in === "number" && typeof matte.out === "number" && matte.in >= 0 && matte.out > matte.in;
    if (!valid) { err(`${path} needs in and out source seconds with out > in`); return; }
    if (matte.in < previousOut - EPS) err(`${path} overlaps the matte before it; keep mattes in source order without overlap`);
    previousOut = matte.out;
  });
}

/** "off", "auto" or "mattes" for a story's base (any form). */
export function subjectMode(base) {
  const subject = isObject(base) ? base.subject : undefined;
  if (subject === "off") return "off";
  if (isObject(subject) && Array.isArray(subject.mattes)) return "mattes";
  return "auto";
}

/**
 * The footage-led base of a resolved story, normalised for the compilers, or
 * null. Timeline time maps to trimmed base time: trim ranges play back to back
 * from timeline 0. Boundaries snap to the frame grid so both renderers cut on
 * the same frame.
 * → {src, fit, focus: {x, y}, volume, subject: {mode, mattes: [{src, in, out, info?}]}, segments: [{index, start, end, duration, sourceStart}], length}
 */
export function storyBase(story) {
  const raw = story?.base;
  if (raw === undefined || raw === null) return null;
  const base = typeof raw === "string" ? { src: raw } : raw;
  const src = base.src ?? base.source;
  if (typeof src !== "string") return null;
  const format = storyFormat(story);
  const fps = Number(story?.resolved?.fps ?? format.fps ?? 30);
  const total = Number(story?.resolved?.duration ?? format.duration);
  const snap = (value) => Math.round(value * fps) / fps;
  const from0 = Number(base.start ?? 0);
  const ranges = Array.isArray(base.trim) && base.trim.length ? base.trim : [[from0, from0 + total]];
  const segments = [];
  let clock = 0;
  for (const [from, to] of ranges) {
    if (clock >= total - EPS) break;
    const start = snap(clock);
    const end = Math.min(total, snap(clock + (to - from)));
    if (end - start > EPS) segments.push({ index: segments.length, start: round6(start), end: round6(end), duration: round6(end - start), sourceStart: round6(snap(from)) });
    clock += to - from;
  }
  return {
    src,
    fit: BASE_FITS.includes(base.fit) ? base.fit : "cover",
    focus: { x: Number(base.focus?.x ?? 0.5), y: Number(base.focus?.y ?? 0.5) },
    volume: typeof base.volume === "number" ? base.volume : 1,
    subject: { mode: subjectMode(base), mattes: subjectMode(base) === "mattes" ? base.subject.mattes.map((matte) => ({ src: matte.src, in: Number(matte.in), out: Number(matte.out), ...(matte.info ? { info: matte.info } : {}), ...(matte.plate ? { plate: matte.plate } : {}), ...(isObject(matte.summary) ? { summary: matte.summary } : {}), ...(isObject(matte.outline) ? { outline: matte.outline } : {}) })) : [] },
    segments,
    length: segments.length ? segments[segments.length - 1].end : 0
  };
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function round3(value) {
  return Math.round(value * 1e3) / 1e3;
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

// ---------------------------------------------------------------------------
// Footage layouts (story.sections; geometry and rendering live in
// kit/core/footage-layout.mjs)

export const FOOTAGE_LAYOUTS = Object.freeze(["full", "split-left", "split-right", "framed", "stacked", "insert"]);
export const SECTION_TRANSITIONS = Object.freeze(["layout-shift", "cut"]);
export const PANEL_ROLES = Object.freeze(["bg", "primary", "accent", "paper", "ink"]);
export const ROOM_MODES = Object.freeze(["keep", "dim", "replace"]);
export const LAYOUT_SIDES = Object.freeze({ framed: ["left", "right", "top", "bottom"], stacked: ["top", "bottom"] });
// A layout-shift runs this long by default (seconds), and at most 2 s.
export const LAYOUT_SHIFT = 0.5;
// Room treatments for a section's `room`.
export const SECTION_ROOMS = Object.freeze({ dim: Object.freeze({ dim: 0.55 }), replace: Object.freeze({ hide: true }) });

const SECTION_KEYS = new Set(["id", "start", "end", "layout", "side", "panel", "ring", "room", "zoom", "transition"]);
const SECTION_HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Check story.sections (validateStory calls this). err/warn take a message.
 * Times may be unresolved anchors here; resolved stories are checked again.
 */
export function validateSections(story, { err, warn = () => {} } = {}) {
  const sections = story?.sections;
  if (sections === undefined) return;
  if (!Array.isArray(sections)) { err("sections must be a list of {id, start, end, layout}"); return; }
  if (sections.length && story.lane !== "footage-led") err("sections hold footage layouts, which need the footage-led lane");
  const portrait = Number(story.format?.height) > Number(story.format?.width);
  const ids = new Set();
  let previous = null;
  sections.forEach((section, index) => {
    const path = `sections[${index}]`;
    if (!isObject(section)) { err(`${path} must be {id, start, end, layout}`); return; }
    for (const key of Object.keys(section)) if (!SECTION_KEYS.has(key)) err(`${path}.${key} is not supported (allowed: ${[...SECTION_KEYS].join(", ")})`);
    if (typeof section.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/i.test(section.id)) err(`${path}.id must be a short id (letters, digits, hyphens)`);
    else if (ids.has(section.id)) err(`${path}.id "${section.id}" is used twice`);
    else ids.add(section.id);
    if (!FOOTAGE_LAYOUTS.includes(section.layout)) err(`${path}.layout must be one of ${FOOTAGE_LAYOUTS.join(", ")}`);
    if (section.layout === "stacked" && !portrait) err(`${path}.layout "stacked" is for 9:16; use split-left or split-right in a landscape story`);
    if (section.side !== undefined) {
      const sides = LAYOUT_SIDES[section.layout];
      if (!sides) err(`${path}.side applies only to ${Object.keys(LAYOUT_SIDES).join(" and ")}`);
      else if (!sides.includes(section.side)) err(`${path}.side must be one of ${sides.join(", ")}`);
    }
    if (section.panel !== undefined && !PANEL_ROLES.includes(section.panel) && !SECTION_HEX6.test(String(section.panel))) err(`${path}.panel must be a brand colour (${PANEL_ROLES.join(", ")}) or #rrggbb`);
    if (section.ring !== undefined && !(typeof section.ring === "number" && section.ring >= 0 && section.ring <= 24)) err(`${path}.ring must be 0–24 px`);
    if (section.room !== undefined && !ROOM_MODES.includes(section.room)) err(`${path}.room must be one of ${ROOM_MODES.join(", ")}`);
    if (section.zoom !== undefined && !(typeof section.zoom === "number" && section.zoom >= 1 && section.zoom <= 1.6)) err(`${path}.zoom must be 1–1.6`);
    if (section.transition !== undefined) {
      const transition = section.transition;
      if (!isObject(transition) || !SECTION_TRANSITIONS.includes(transition.type)) err(`${path}.transition must be {type: ${SECTION_TRANSITIONS.map((type) => `"${type}"`).join(" | ")}, dur?}`);
      else if (transition.dur !== undefined && !(typeof transition.dur === "number" && transition.dur > 0 && transition.dur <= 2)) err(`${path}.transition.dur must be > 0 and at most 2 s`);
    }
    if (typeof section.start === "number" && typeof section.end === "number") {
      if (!(section.end > section.start)) err(`${path} needs end after start`);
      else if (previous && section.start < previous.end - EPS) err(`${path} starts before ${previous.id ?? "the section before it"} ends; sections may not overlap`);
      previous = section;
    } else if (section.start === undefined || section.end === undefined) err(`${path} needs start and end (seconds or anchors)`);
    if (section.layout === "full" && (section.panel !== undefined || section.ring !== undefined)) warn(`${path}: a full section has no panel; panel and ring do nothing`);
  });
}

/** Resolved sections, sorted and frame-snapped: [{id, start, end, layout, side, panel (#hex), ring, room, zoom, transition: {type, dur}}]. */
export function storySections(story) {
  const list = Array.isArray(story?.sections) ? story.sections : [];
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const snap = (value) => round6(Math.round(Number(value) * fps) / fps);
  const colors = story?.brand?.colors ?? {};
  return list
    .filter((section) => isObject(section) && typeof section.start === "number" && typeof section.end === "number" && FOOTAGE_LAYOUTS.includes(section.layout))
    .map((section) => ({
      id: section.id,
      start: snap(Math.max(0, section.start)),
      end: snap(Math.min(duration, section.end)),
      layout: section.layout,
      side: section.side ?? defaultSide(section.layout, story),
      panel: SECTION_HEX6.test(String(section.panel)) ? section.panel : colors[section.panel ?? "bg"] ?? colors.bg ?? "#000000",
      ring: typeof section.ring === "number" ? section.ring : section.layout === "framed" ? 6 : 0,
      ringColor: colors.primary ?? "#ffffff",
      room: section.room ?? "keep",
      zoom: typeof section.zoom === "number" ? section.zoom : 1,
      transition: { type: section.transition?.type ?? "layout-shift", dur: Number(section.transition?.dur ?? LAYOUT_SHIFT) }
    }))
    .filter((section) => section.end > section.start + EPS)
    .sort((a, b) => a.start - b.start);
}

function defaultSide(layout, story) {
  // Graphics on top: the caption band runs across the lower half.
  if (layout === "stacked") return "bottom";
  if (layout === "framed") return Number(story?.format?.height) > Number(story?.format?.width) ? "top" : "left";
  return null;
}


/**
 * The timeline as back-to-back layout spans: the sections and the `full`
 * gaps between them, each with the layout-shift that brings it in
 * (`shift: {start, frames}` or null for none or a cut), plus the shifts as
 * boundaries. Null without sections.
 * → {sections, spans, boundaries}
 */
export function layoutSpans(story) {
  const sections = storySections(story);
  if (!sections.length) return null;
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const full = { id: null, layout: "full", side: null, panel: null, ring: 0, zoom: 1, room: "keep", transition: { type: "layout-shift", dur: LAYOUT_SHIFT } };
  const spans = [];
  let clock = 0;
  for (const section of sections) {
    if (section.start > clock + EPS) spans.push({ ...full, start: clock, end: section.start });
    spans.push(section);
    clock = section.end;
  }
  if (clock < duration - EPS) spans.push({ ...full, start: clock, end: duration });
  const key = (span) => (span.layout === "full" ? "full" : JSON.stringify([span.layout, span.side, span.panel, span.ring, span.zoom]));
  const boundaries = [];
  spans.forEach((span, index) => {
    span.shift = null;
    if (index === 0 || key(span) === key(spans[index - 1])) return;
    const frames = span.transition.type === "cut" ? 0 : Math.round(Math.min(span.transition.dur, span.end - span.start, 2) * fps);
    span.shift = { start: span.start, frames };
    if (frames < 1) return;
    const from = spans[index - 1];
    boundaries.push({ boundary_id: span.id ? `${span.id}-layout` : `${from.id}-layout-out`, sequence_id: null, kind: "ordinary", type: "layout-shift", start_seconds: round6(span.start), duration_seconds: round6(frames / fps), from_id: from.id ?? null, to_id: span.id ?? null });
  });
  return { sections, spans, boundaries };
}
