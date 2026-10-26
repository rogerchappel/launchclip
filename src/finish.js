// launchclip finish <project>: storyboard project → finished, mastered,
// checked video in one command (STORYBOARD_ENGINE_RFC.md §10 phase 1).
//
//   voice → validate → captions → sound → render → master → evidence → gates → report
//
// The render stage goes through the segment cache (src/render_segments.js):
// unchanged segments of the timeline are reused, so a second pass that edits
// one scene re-renders only the seconds that scene is on screen.
//
// Every stage is idempotent. A stage records the hash of its inputs and of the
// files it wrote in .launchclip/finish-state.json and is reported as `cached`
// (not re-run) while both still match. The user's storyboard.json is never
// rewritten: synthesised voice, words, captions and the mix are set on a copy
// written to .launchclip/finish/storyboard.json (resolved:
// .launchclip/finish/story.resolved.json), which is what gets rendered.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { chunkWords, narrationWords } from "../kit/core/captions.mjs";
import { knownModules, resolveModule } from "../kit/core/modules.mjs";
import { buildTemporalEvidenceSchedule, validateTemporalEvidenceManifest } from "./cinematic_evidence.js";
import { COMPILED_HYPERFRAMES, applySubjectFallback, cinematicMotionExpectations, resolveMusicMix, subjectFallbackLines, subjectMatteGate } from "./cinematic_check.js";
import { coverageGate, directionGate, faceGate, gateProfile, prototypeCut, prototypeScope, readFaceData, readProjectDirection } from "./quality_gates.js";
import { VERSION } from "./doctor.js";
import { analyzeProductionAudio } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { PARTIAL_RENDERERS, SEGMENTS_DIR, renderWithSegments, sceneStills } from "./render_segments.js";
import { getRenderer, resolveRendererName } from "./renderers/index.js";
import { remotionInvocation } from "./renderers/remotion.js";
import { deriveBoundaries, resolveStory, storyBase, storyFormat } from "./story.js";
import { storyChapters } from "../kit/core/story.mjs";
import { ffmetadataChapters, youtubeChapterProblems, youtubeChapters } from "../kit/core/long-form.mjs";
import { directionFileFor, moduleParamErrors, validateStory } from "./story_cli.js";
import { hasExactFile, readStoryEdl } from "./story_loader.js";
import { readStorySubject, readStoryTrack } from "./subject/project.js";
import { applyProjectStyle } from "./story_style.js";
import { storyCadence, styleAdherence, styleProfile } from "./style_adherence.js";
import { analyzeReference } from "./style_reference.js";
import { resolveStyleV2 } from "./style_store.js";
import { storyStyleRequest } from "../kit/core/style.mjs";
import { hyperframesInvocation } from "./toolchain.js";
import { getVoiceProvider, listVoiceProviders } from "./voice/index.js";
import { normalizeLoudness, parseLoudnormJson } from "./voice/supplied.js";
import { applyDensity, densityAmount, densityTyping, eventKey, familySource, kitLibrary, libraryFallbacks, resolveCueFile, resolveLibraries, userLibraryDir } from "./sfx/library.js";
import { AMBIENCE_BEDS, GENRE_SPECS, HISTORIC_SFX_FAMILIES, MUSIC_GENRES, SOUND_PALETTES, ambienceForWorld } from "../kit/core/sound/options.mjs";
import { musicChoice } from "../kit/core/sound/music.mjs";
import { collectTyping, renderTypingTrack, typingSchedule } from "./sfx/typing.js";
import { getMusicProvider, parseMusicSpec, resolveMusicChoice, MUSIC_FLAG_VALUES } from "./music/index.js";
import { lockDecision, musicBrief, readMusicLock, writeMusicLock } from "./music/lock.js";
import { narrationCacheKey, narrationDocument, narrationRequest, synthesizeNarration, voiceCacheDir } from "./voice/narrate.js";
import { dialogueDocument, dialogueGaps, dialogueRequests, synthesizeDialogue } from "./voice/dialogue.js";
import { CANDIDATE_OUTPUT, candidateAudio, FREE_VOICE_PROVIDERS, recordCandidate } from "./candidate_receipt.js";
import { analyzeBeatsFile, beatsDocument, gridFromBpm, transformGrid } from "./music/beats.js";
import { BEAT_SYNC_SCHEMA, chooseAlignment, keyMoments, momentReport, snapStory, summarizeMoments, syncStrategy } from "./music/beat_sync.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = path.join(ROOT, "skills", "launchclip-create-video", "scripts");
const SCRIPT = {
  synth: path.join(SCRIPTS, "synth-audio-kit.mjs"),
  mix: path.join(SCRIPTS, "build-mix.mjs"),
  master: path.join(SCRIPTS, "master-loudness.mjs"),
  evidence: path.join(SCRIPTS, "build-evidence.mjs")
};

export const FINISH_STAGES = ["voice", "validate", "captions", "sound", "render", "master", "evidence", "gates"];
export const FINISH_STATE_VERSION = "launchclip.finish-state.v1";
export const FINISH_REPORT_VERSION = "launchclip.finish.v1";
export const DEFAULT_VOICE_PROVIDER = "kokoro";
export const LOUDNESS_TARGET = Object.freeze({ lufs: -14, tp: -1 });

export const PATHS = Object.freeze({
  state: ".launchclip/finish-state.json",
  copy: ".launchclip/finish/storyboard.json",
  resolved: ".launchclip/finish/story.resolved.json",
  hyperframes: COMPILED_HYPERFRAMES,
  hyperframesPreview: ".launchclip/finish/hyperframes-preview",
  voice: "assets/audio/narration.wav",
  words: "NARRATION.json",
  captions: "assets/captions/captions.json",
  kit: "assets/audio/kit",
  mix: "assets/audio/mix.wav",
  cues: "assets/audio/cues.json",
  typing: "assets/audio/typing.wav",
  sfxManifest: "qa/sfx.json",
  music: "assets/audio/music.mp3",
  musicPrepared: "assets/audio/music.prepared.wav",
  beats: "BEATS.json",
  beatsFallback: "assets/audio/BEATS.json",
  beatSync: "qa/beat-sync.json",
  audioManifest: "AUDIO-MANIFEST.json",
  evidence: "qa/temporal-evidence/manifest.json",
  gates: "qa/finish/gates.json",
  motion: "qa/finish/motion.json",
  segments: SEGMENTS_DIR,
  sceneStills: "qa/finish/scenes",
  audio: "qa/finish/audio.json",
  style: "qa/style-check.json",
  chapters: "renders/chapters.txt",
  chaptersMeta: ".launchclip/finish/chapters.ffmetadata",
  report: "finish.json"
});

// ---------------------------------------------------------------------------
// Sound design: hits and module events → SFX cues, scene energy → music bed.

// The cue families (synth-audio-kit.mjs SFX_FAMILIES, and the SFX library)
// and their mix levels. Keystrokes normally arrive through the typing track.
export const CUE_LEVELS = Object.freeze({
  impact: 0.55, subdrop: 0.5, whoosh: 0.4, riser: 0.35, shimmer: 0.35, pop: 0.35, tick: 0.3, click: 0.3, keystroke: 0.3, "keystroke-space": 0.34, "keystroke-enter": 0.36,
  // The palette families (kit/core/sound/families.mjs).
  swipe: 0.35, slide: 0.35, snap: 0.32, thud: 0.45, chime: 0.3, ding: 0.3, ping: 0.28, glitch: 0.3, "tape-stop": 0.35, "page-turn": 0.35,
  "pen-scribble": 0.3, "camera-shutter": 0.32, cash: 0.3, notification: 0.3, "error-buzz": 0.28, success: 0.32, boing: 0.32, sparkle: 0.28, footstep: 0.35, door: 0.4
});
export const CUE_DURATIONS = Object.freeze({
  whoosh: 0.62, impact: 1.3, riser: 1.4, tick: 0.14, pop: 0.2, shimmer: 1.6, subdrop: 1.8, click: 0.06, keystroke: 0.11, "keystroke-space": 0.16, "keystroke-enter": 0.15,
  swipe: 0.3, slide: 0.5, snap: 0.16, thud: 0.5, chime: 1.6, ding: 1.3, ping: 0.8, glitch: 0.4, "tape-stop": 0.7, "page-turn": 0.6,
  "pen-scribble": 0.9, "camera-shutter": 0.42, cash: 1.3, notification: 0.9, "error-buzz": 0.6, success: 1.4, boing: 0.8, sparkle: 1.2, footstep: 0.32, door: 1
});
const CUE_SPACING = 0.12;
// Ambience beds are normalised to -26 LUFS; this puts them about 6 dB lower
// in the mix, under the music, and the mix ducks them further under speech.
export const AMBIENCE_VOLUME = 0.5;
const WHOOSH_TRANSITIONS = new Set(["push", "whip", "zoom"]);
const EVENT_CUES = [
  [/riser|rise|build|count|tension/, "riser"],
  [/impact|slam|stamp|lock|headline|reveal-hard|hit|plunge/, "impact"],
  [/whoosh|push|whip|zoom|swipe|pan|transition|flow/, "whoosh"],
  [/shimmer|insight|resolve|equilibrium|sparkle/, "shimmer"],
  [/subdrop|drop|payoff|final|outro/, "subdrop"],
  [/tick|settle|step|row|bar|term|value|data|land/, "tick"]
];

// With a style's sound block, event names also reach the palette families.
// (Without one, the historic table alone decides, so old stories sound the same.)
const PALETTE_EVENT_CUES = [
  [/error|fail|denied|wrong|reject/, "error-buzz"],
  [/success|complete|(^|-)(done|win)(-|$)|checkmark|unlock/, "success"],
  [/cash|money|price|revenue|sale|coin|(^|-)pay(-|$)/, "cash"],
  [/notif|message|inbox|alert/, "notification"],
  [/photo|screenshot|shutter|snapshot/, "camera-shutter"],
  [/page-turn|chapter|paper/, "page-turn"],
  [/(^|-)(write|sign|scribble|pen)(-|$)/, "pen-scribble"],
  [/glitch|hack|corrupt|static/, "glitch"],
  [/tape-stop|halt|freeze|rewind/, "tape-stop"],
  [/sparkle|magic|shine/, "sparkle"],
  [/bounce|boing|spring/, "boing"],
  [/(^|-)(swipe|flick)(-|$)/, "swipe"],
  [/(^|-)(slide|drawer|tray)(-|$)/, "slide"],
  [/(^|-)(snap|dock)(-|$)/, "snap"],
  [/thud|stack|heavy/, "thud"],
  [/(^|-)(idea|chime|welcome)(-|$)/, "chime"],
  [/(^|-)(ding|bell)(-|$)/, "ding"],
  [/(^|-)ping(-|$)|sonar|locate/, "ping"],
  [/footstep|(^|-)walk(-|$)/, "footstep"],
  [/(^|-)(door|exit)(-|$)/, "door"]
];

/** Default cue for an event name or role that declares none (palette: the event table includes the palette families). */
export function defaultCueFor(event, { palette = false } = {}) {
  const name = String(event ?? "").toLowerCase();
  if (palette) {
    const found = PALETTE_EVENT_CUES.find(([pattern]) => pattern.test(name));
    if (found) return found[1];
  }
  return EVENT_CUES.find(([pattern]) => pattern.test(name))?.[1] ?? "pop";
}

/**
 * "whoosh-soft" → {cue: "whoosh", gain: 0.6}; unknown base names → null.
 * Modifiers: -soft (quieter), -short (a shorter variant; same kit file).
 */
export function kitCue(name) {
  const lower = String(name ?? "").toLowerCase();
  // Longest family first, so "keystroke-space-soft" is keystroke-space + soft.
  const base = Object.keys(CUE_LEVELS).sort((a, b) => b.length - a.length).find((family) => lower === family || lower.startsWith(`${family}-`));
  if (!base) return null;
  const modifiers = lower.slice(base.length).split("-").filter(Boolean);
  return { cue: base, gain: modifiers.includes("soft") ? 0.6 : 1, modifiers };
}

function eventName(model, event) {
  if (event.name) return event.name;
  const prefix = `${model?.id ?? ""}-`;
  return String(event.id ?? "").startsWith(prefix) ? String(event.id).slice(prefix.length) : String(event.id ?? "");
}

function modelEventFor(model, event) {
  const events = Array.isArray(model?.events) ? model.events : [];
  return events.find((entry) => entry.name === event || entry.id === event || eventName(model, entry) === event || entry.role === event) ?? null;
}

/**
 * Bind one SFX cue to every resolved hit (hit.cue, else the cue of the module
 * event it names, else a default from its event name; palette: true lets the
 * default reach the palette families) and to every module
 * event that carries a `cue`, plus a whoosh under push/whip/zoom transitions.
 * Risers end on their moment. Cues of the same kind closer than 0.12 s merge
 * (hits win). Returns {cues: [{cue, at, volume, shot, intent, source, event}], warnings}.
 */
export function bindCues(story, { models, palette = false } = {}) {
  const warnings = [];
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  const modelFor = models ?? ((scene) => {
    try { return resolveModule(scene, story); } catch { return null; }
  });
  const raw = [];
  for (const scene of scenes) {
    const model = typeof modelFor === "function" ? modelFor(scene) : modelFor?.[scene.id] ?? null;
    for (const hit of Array.isArray(scene.hits) ? scene.hits : []) {
      if (typeof hit?.at !== "number") throw new Error(`bindCues needs a resolved story; ${scene.id} has an unresolved hit`);
      const event = model ? modelEventFor(model, hit.event) : null;
      const name = hit.cue ?? event?.cue ?? defaultCueFor(hit.event, { palette });
      raw.push({ name, at: hit.at, end: event?.endTime, source: "hit", shot: scene.id, event: hit.event, explicit: hit.cue !== undefined });
    }
    for (const event of Array.isArray(model?.events) ? model.events : []) {
      if (!event?.cue || !Number.isFinite(Number(event.time))) continue;
      raw.push({ name: event.cue, at: Number(event.time), end: Number.isFinite(Number(event.endTime)) ? Number(event.endTime) : undefined, source: "module-event", shot: scene.id, event: eventName(model, event) || event.role || "event" });
    }
    if (scene.in && WHOOSH_TRANSITIONS.has(scene.in.type)) {
      raw.push({ name: "whoosh", at: Math.max(0, scene.start - CUE_DURATIONS.whoosh * 0.35), source: "transition", shot: scene.id, event: `${scene.in.type}-in` });
    }
  }
  const order = { hit: 0, "module-event": 1, transition: 2 };
  raw.sort((a, b) => order[a.source] - order[b.source] || a.at - b.at);
  const cues = [];
  for (const entry of raw) {
    const kit = kitCue(entry.name);
    if (!kit) {
      warnings.push(`${entry.shot}: cue "${entry.name}" (${entry.source} ${entry.event}) is not in the procedural kit (${Object.keys(CUE_LEVELS).join(", ")}); skipped`);
      continue;
    }
    // A riser builds into its moment: it ends on the event (or its endTime).
    const anchor = kit.cue === "riser" ? (entry.end ?? entry.at) - CUE_DURATIONS.riser * (kit.modifiers.includes("short") ? 0.6 : 0.95) : entry.at;
    const at = round3(Math.max(0, anchor));
    if (Number.isFinite(duration) && at >= duration - 0.05) {
      warnings.push(`${entry.shot}: cue ${kit.cue} at ${at}s falls after the end of the video; skipped`);
      continue;
    }
    if (cues.some((cue) => cue.cue === kit.cue && Math.abs(cue.at - at) < CUE_SPACING)) continue;
    const cue = { cue: kit.cue, at, volume: round3(CUE_LEVELS[kit.cue] * kit.gain), shot: entry.shot, intent: `${entry.source} ${entry.event}`, source: entry.source, event: entry.event, optional: entry.source !== "hit" };
    // A riser lands on its moment; library risers are re-anchored on their measured peak.
    if (kit.cue === "riser") cue.lands_at = round3(entry.end ?? entry.at);
    cues.push(cue);
  }
  cues.sort((a, b) => a.at - b.at || a.cue.localeCompare(b.cue));
  return { cues, warnings };
}

/**
 * Cue → file: each bound cue gets a file from the first SFX source that has
 * its family (explicit library, project library, user library, procedural
 * kit), with a variant picked deterministically from the story id and the
 * event, so repeats vary and renders stay reproducible. A library riser is
 * re-anchored so its measured peak lands on its moment.
 */
export function resolveCueFiles(cues, { libraries = [], kit = null, storyId = "" } = {}) {
  return cues.map((cue) => {
    const resolved = resolveCueFile(cue, { libraries, kit, key: eventKey(storyId, cue) });
    if (!resolved) return cue;
    const placed = { ...cue, file: resolved.file, sfx_source: resolved.scope, sfx_origin: resolved.source, variant: resolved.variant };
    const peak = Number(resolved.measurements?.peak_at_ms);
    if (cue.cue === "riser" && Number.isFinite(cue.lands_at) && Number.isFinite(peak)) placed.at = round3(Math.max(0, cue.lands_at - peak / 1000));
    return placed;
  });
}

/** Keystroke banks for the typing track: {key, space, enter, word} → [{file, measurements}]. */
export function typingBanks(libraries, kit) {
  const bank = (family) => {
    const source = familySource(family, libraries, kit);
    return source ? source.files.map((file, index) => ({ file, measurements: source.measurements[index], scope: source.scope, source: source.source })) : [];
  };
  return { key: bank("keystroke"), space: bank("keystroke-space"), enter: bank("keystroke-enter"), word: bank("click") };
}

function firstKeyPerShot(keystrokes) {
  const seen = new Set();
  return keystrokes.filter((key) => key.kind !== "word" && !seen.has(key.shot) && seen.add(key.shot));
}

/** The licence line for the SFX actually used. origins: Set of "procedural" | "elevenlabs" | ... */
export function sfxLicense(origins) {
  const parts = ["Original procedural synthesis (synth-audio-kit.mjs); no third-party samples."];
  if (origins.has("elevenlabs")) parts.push("Some SFX were generated with ElevenLabs sound effects (launchclip sfx seed); their use is governed by the ElevenLabs terms of service.");
  const other = [...origins].filter((origin) => !["procedural", "elevenlabs"].includes(origin));
  if (other.length) parts.push(`Other SFX library sources: ${other.join(", ")}.`);
  return parts.join(" ");
}

// The music part of AUDIO-MANIFEST.json's licence line.
function musicLicense(kind) {
  if (kind === "elevenlabs") return "Music: generated with the ElevenLabs Music API under the account holder's ElevenLabs terms; see THIRD_PARTY_NOTICES.md.";
  if (kind === "file") return "Music: supplied by the project; its licence is the project's responsibility.";
  return null;
}

function sceneModels(story) {
  const cache = new Map();
  return (scene) => {
    if (!cache.has(scene.id)) {
      let model = null;
      try { model = resolveModule(scene, story); } catch { model = null; }
      cache.set(scene.id, model);
    }
    return cache.get(scene.id);
  };
}

function energyValue(energy) {
  if (energy === "build") return 2;
  return Number.isInteger(energy) ? energy : 1;
}

/**
 * The music bed for a story from its scene energy (0 calm … 3 full, "build"):
 * tempo and level follow the duration-weighted mean energy, and the kick plays
 * across the scenes at energy 2 or more (from the end of a "build" scene).
 * music: audio.music ({source, bpm, key}); explicit bpm and key win.
 */
export function chooseBed(story, music = {}) {
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const scenes = (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => (scene.track ?? 0) === 0);
  const pool = scenes.length ? scenes : (story?.scenes ?? []);
  let weighted = 0;
  let total = 0;
  for (const scene of pool) {
    const length = Math.max(0, Number(scene.end) - Number(scene.start));
    weighted += energyValue(scene.energy) * length;
    total += length;
  }
  const energy = total > 0 ? round3(weighted / total) : 1;
  let tempo = energy < 1 ? 84 : energy < 2 ? 96 : energy < 2.5 ? 108 : 116;
  // A style's music bpm_range bounds the energy-derived tempo.
  const range = Array.isArray(music?.bpm_range) && music.bpm_range.length === 2 ? music.bpm_range.map(Number) : null;
  if (range && range.every(Number.isFinite)) tempo = Math.round(Math.min(range[1], Math.max(range[0], tempo)));
  const loud = pool.filter((scene) => scene.energy === "build" || energyValue(scene.energy) >= 2);
  const starts = loud.map((scene) => (scene.energy === "build" ? Number(scene.end) : Number(scene.start)));
  const kickFrom = loud.length ? round3(Math.min(...starts)) : duration;
  const kickTo = loud.length ? round3(Math.max(...loud.map((scene) => Number(scene.end)))) : duration;
  return {
    seconds: duration,
    bpm: Number(music?.bpm) > 0 ? Number(music.bpm) : tempo,
    key: typeof music?.key === "string" && music.key ? music.key : "A",
    kick_from: kickFrom,
    kick_to: Math.max(kickFrom, kickTo),
    volume: round3(0.24 + 0.04 * energy),
    energy
  };
}

/**
 * The style pack's sound block (kit/core/sound/options.mjs), with the
 * story's audio.sound over it, resolved for one finish run:
 * {active, palette, seed, genre, key, bpm, progression, ambience, world,
 * density, warnings}. active is false when the block sets none of palette,
 * music.genre or ambience: then finish sounds exactly as it always has.
 * The seed is sound.seed, else the generated style's seed, else the style
 * name, else the story id.
 */
export function soundSettings(pack, story) {
  const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  const fromPack = object(pack?.sound);
  const fromStory = object(story?.audio?.sound);
  const sound = { ...fromPack, ...fromStory, music: { ...object(fromPack.music), ...object(fromStory.music) } };
  const warnings = [];
  const known = (value, list, label) => {
    if (value === undefined || value === null) return null;
    if (list.includes(value)) return value;
    warnings.push(`sound.${label} "${value}" is not one of ${list.join(", ")}; ignored`);
    return null;
  };
  const palette = known(sound.palette, SOUND_PALETTES, "palette");
  const genre = known(sound.music.genre, MUSIC_GENRES, "music.genre");
  const world = Object.keys(object(story?.world)).length ? story.world : Object.keys(object(pack?.world)).length ? pack.world : null;
  let ambience = null;
  if (sound.ambience === "auto") ambience = ambienceForWorld(world);
  else if (sound.ambience !== undefined && sound.ambience !== "none") ambience = known(sound.ambience, AMBIENCE_BEDS, "ambience");
  return {
    active: Boolean(palette || genre || ambience),
    palette,
    seed: String(sound.seed ?? pack?.generated?.seed ?? pack?.name ?? story?.id ?? "launchclip"),
    genre,
    key: typeof sound.music.key === "string" && sound.music.key ? sound.music.key : null,
    bpm: Number(sound.music.bpm) > 0 ? Number(sound.music.bpm) : null,
    progression: Number.isInteger(sound.music.progression) ? sound.music.progression : null,
    ambience,
    world,
    density: sound.sfx_density ?? null,
    warnings
  };
}

/** synth-audio-kit.mjs flags for a kit request {palette, seed, only, with, ambience} (null: none). */
export function kitArgs(kit) {
  if (!kit) return [];
  const args = [];
  if (kit.palette) args.push("--palette", kit.palette);
  if (kit.seed) args.push("--seed", kit.seed);
  if (kit.only?.length) args.push("--only", kit.only.join(","));
  if (kit.with?.length) args.push("--with", kit.with.join(","));
  if (kit.ambience) args.push("--ambience", kit.ambience);
  return args;
}

/**
 * audio.music → {kind: "synth"|"file"|"elevenlabs"|"none", file?, bpm?, key?, volume?}.
 * Absent means synth here; the run-time default (ElevenLabs when a key is
 * set) is resolveMusicChoice() in src/music/index.js.
 */
export function musicSpec(audio) {
  const music = audio?.music;
  if (music === undefined || music === null || music === "synth") return { kind: "synth" };
  if (music === "none" || music === false) return { kind: "none" };
  if (typeof music === "string") return music === "elevenlabs" ? { kind: "elevenlabs" } : { kind: "file", file: music };
  const spec = parseMusicSpec(music);
  // The bed's gain (0–1) is the story's to set, as finish's own plan reads it (musicPlanSpec).
  const volume = music.volume !== undefined ? { volume: music.volume } : {};
  if (spec.provider === "file") return { kind: "file", file: spec.file, bpm: music.bpm, key: music.key, ...volume };
  return { kind: spec.provider ?? "synth", bpm: music.bpm, key: music.key, ...volume };
}

// Loudness the generated or supplied music is brought to before mixing, so
// audio.music volume means the same for every provider (the synth bed peaks
// at about this level once mixed).
export const MUSIC_LUFS = -16;

// ---------------------------------------------------------------------------
// Stage bookkeeping

/**
 * Whether a stage must run: "run" when forced, never run, its inputs changed,
 * or an output is missing or changed since it was written; otherwise "cached".
 * previous: the stage's finish-state record; current: {inputHash, outputs:
 * {relativePath: sha256|null}} (null = missing).
 */
export function stageDecision(previous, current, { force = false } = {}) {
  if (force) return { action: "run", reason: "forced" };
  if (!previous) return { action: "run", reason: "not run before" };
  if (previous.input_hash !== current.inputHash) return { action: "run", reason: "inputs changed" };
  for (const [file, hash] of Object.entries(current.outputs ?? {})) {
    if (hash === null) return { action: "run", reason: `${file} is missing` };
    if (previous.outputs?.[file] !== hash) return { action: "run", reason: `${file} changed since it was written` };
  }
  return { action: "cached", reason: "inputs and outputs unchanged" };
}

export function hashValue(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

async function fileHash(file) {
  try { return createHash("sha256").update(await readFile(file)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT" || error.code === "EISDIR") return null; throw error; }
}

/**
 * The finish copy: the user's story with the fields finish fills in. Never
 * mutates `story`. updates: {voice, words, captions, mix} project paths.
 */
export function buildFinishCopy(story, { voice, words, captions, mix } = {}) {
  const copy = JSON.parse(JSON.stringify(story));
  if (voice || words || mix) copy.audio = { ...(copy.audio ?? {}) };
  if (voice) copy.audio.voice = voice;
  if (words) copy.audio.words = words;
  if (mix) copy.audio.mix = mix;
  if (captions) {
    const overlay = captionsOverlay(copy);
    if (overlay) overlay.src = captions;
  }
  return copy;
}

function captionsOverlay(story) {
  return (Array.isArray(story?.overlays) ? story.overlays : []).find((overlay) => overlay?.type === "captions" && overlay.style !== "none" && overlay.preset !== "none") ?? null;
}

// ---------------------------------------------------------------------------
// Default adapters (each can be replaced in tests)

export function defaultAdapters() {
  return {
    now: () => performance.now(),
    clock: () => new Date().toISOString(),
    voiceProvider: (name, options) => getVoiceProvider(name, options),
    normalizeVoice: (input, output) => normalizeLoudness(input, output),
    renderer: (name) => getRenderer(name),
    async compileHyperFrames(resolved, options) {
      const { compileStoryToHyperFrames } = await import("../kit/hyperframes/story-compiler.mjs");
      return compileStoryToHyperFrames(resolved, options);
    },
    env: process.env,
    notice: (line) => process.stderr.write(`${line}\n`),
    musicProvider: (name, options) => getMusicProvider(name, options),
    analyzeBeats: (file, options) => analyzeBeatsFile(file, options),
    prepareMusic: (input, output, options) => prepareMusicTrack(input, output, options),
    async synthKit(outDir, bed, kit = null) {
      const args = [SCRIPT.synth, outDir];
      if (bed) args.push("--bed", String(bed.seconds), "--bpm", String(bed.bpm), "--key", String(bed.key), "--kick-from", String(bed.kick_from), "--kick-to", String(bed.kick_to));
      if (bed?.genre) args.push("--genre", bed.genre, "--progression", String(bed.progression));
      args.push(...kitArgs(kit));
      await execFileAsync(process.execPath, args, { maxBuffer: 1 << 26 });
      return JSON.parse(await readFile(path.join(outDir, "AUDIO-KIT.json"), "utf8"));
    },
    renderTyping: (schedule, banks, options) => renderTypingTrack(schedule, banks, options),
    async buildMix(options) {
      const { buildMix, normalizeCues } = await import(SCRIPT.mix);
      const cues = normalizeCues(options.cues, options.sfxDir);
      buildMix({ voice: options.voice, music: options.music, ambience: options.ambience, cues, duration: options.duration, out: options.out, musicVolume: options.musicVolume, ambienceVolume: options.ambienceVolume });
      return { cues };
    },
    async master(input, output, target) {
      const { masterLoudness } = await import(SCRIPT.master);
      return masterLoudness(input, output, target);
    },
    async cutChapter(input, output, { start, end }) {
      await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-to", String(end), "-i", input, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output], { maxBuffer: 1 << 24 });
    },
    async muxChapters(input, metadata, output) {
      await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-f", "ffmetadata", "-i", metadata, "-map", "0", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", "-movflags", "+faststart", output], { maxBuffer: 1 << 24 });
    },
    async hasAudio(file) {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
      return String(stdout).trim().length > 0;
    },
    async buildEvidence(project, options) {
      const { buildEvidence } = await import(SCRIPT.evidence);
      return buildEvidence(project, options);
    },
    motion: (video, out, options) => writeMotionReport(video, out, options),
    audio: (video, manifest, options) => analyzeProductionAudio(video, manifest, options),
    // The style gate's measurements (loudness has its own gate, so no audio pass).
    styleReference: (video) => analyzeReference(video, {}, { audio: async () => ({ output: {} }) }),
    resolveStyle: (request, options) => resolveStyleV2(request, options)
  };
}

// ---------------------------------------------------------------------------
// Pipeline

/**
 * options: {renderer, quality: "draft"|"high", voice: provider name, music:
 * "synth"|"elevenlabs"|"none", musicHints (style-pack sound.music hints for
 * the ElevenLabs brief), out, force, musicRegenerate (ignore the music lock
 * and the cache: a new, paid ElevenLabs generation; --music-regenerate),
 *   scenes: scene ids (or "s3,s4") whose render segments re-render, re-running
 *     master, evidence and gates, with before/after stills (--scene);
 *   previewScene: render only that scene to renders/scene-<id>.mp4 and stop
 *     (--preview-scene),
 *   chapter: a chapter id: its render segments re-render (the rest are
 *     reused), the master is stitched from all of them, and the chapter is
 *     also written alone to renders/chapters/<id>.mp4 (--chapter)}
 * adapters: any of defaultAdapters() to replace.
 * Returns the finish.json report; it never throws for a stage failure (the
 * report's status is "failed"), only for an unreadable project.
 */
export async function runFinish(projectPath, options = {}, adapterOverrides = {}) {
  const adapters = { ...defaultAdapters(), ...adapterOverrides };
  const project = path.resolve(projectPath);
  const storyFile = path.join(project, "storyboard.json");
  if (!hasExactFile(project, "storyboard.json")) throw new Error(`launchclip finish needs ${storyFile}; author storyboard.json first`);
  // The style pack is merged into the working copy; storyboard.json stays as written.
  const styled = await applyProjectStyle(await readJson(storyFile, "storyboard.json"), { projectDir: project });
  const story = styled.story;
  const quality = String(options.quality ?? "draft").toLowerCase();
  if (!["draft", "high"].includes(quality)) throw new Error(`--quality must be draft or high; got ${options.quality}`);
  if (options.voice != null && !listVoiceProviders().includes(String(options.voice).toLowerCase())) throw new Error(`Unknown --voice ${options.voice}. Available providers: ${listVoiceProviders().join(", ")}`);
  if (options.music != null && !MUSIC_FLAG_VALUES.includes(String(options.music).toLowerCase())) throw new Error(`Unknown --music ${options.music}. Use one of ${MUSIC_FLAG_VALUES.join(", ")}`);
  const rendererName = resolveRendererName(project, options.renderer);
  // --candidate <id>: a cheap draft candidate with no paid calls (synth or no
  // music, a cached or free voice, else the test voice; no evidence or gates),
  // recorded into the rendered-candidate receipt (src/candidate_receipt.js).
  const candidateNotes = [];
  if (options.candidate != null && options.candidate !== false) {
    if (quality !== "draft") throw new Error("--candidate renders drafts only; drop --quality high");
    if (options.voice != null && !FREE_VOICE_PROVIDERS.includes(String(options.voice).toLowerCase())) throw new Error(`--candidate makes no paid calls, so it cannot use --voice ${options.voice}; use kokoro, supplied or test (or drop --voice to reuse a cached take)`);
    if (options.musicRegenerate) throw new Error("--candidate makes no paid calls; drop --music-regenerate");
    const narration = story.audio?.narration;
    let request = null;
    try { request = narration && typeof narration === "object" && narration.text ? narrationRequest(narration, options.voice ? { provider: options.voice } : {}) : null; } catch { request = null; }
    const cachedTake = Boolean(request) && existsSync(path.join(voiceCacheDir(project), `${narrationCacheKey(request)}.wav`));
    const audio = candidateAudio({ narrationProvider: request?.provider, cachedTake, musicFlag: options.music, musicSpecProvider: parseMusicSpec(story.audio?.music).provider });
    options = { ...options, music: audio.music, ...(audio.voice ? { voice: audio.voice } : {}) };
    candidateNotes.push(...audio.notes);
  }
  const candidate = options.candidate != null && options.candidate !== false ? String(options.candidate) : null;
  const iteration = iterationOptions(story, options);
  // --prototype: render only the opening 20–30 s (RFC §11.1), to its own file.
  const prototype = Boolean(options.prototype);
  if (prototype && candidate) throw new Error("use --prototype or --candidate, not both");
  if (prototype && (iterationOptions(story, options).scenes.length || options.previewScene || iteration.chapter)) throw new Error("--prototype renders the opening; drop --scene, --preview-scene and --chapter");
  if (candidate && iteration.chapter) throw new Error("use --candidate or --chapter, not both");
  const out = projectFile(project, options.out ?? (candidate ? CANDIDATE_OUTPUT : prototype ? `renders/prototype${quality === "high" ? "-high" : ""}.mp4` : quality === "high" ? "renders/final.mp4" : "renders/draft.mp4"));
  const started = adapters.now();
  const ctx = {
    project,
    story,
    copy: buildFinishCopy(story),
    adapters,
    options: { ...options, quality, ...iteration },
    forceStages: new Set([...(iteration.scenes.length || iteration.chapter ? ["render", "master", "evidence", "gates"] : []), ...(options.musicRegenerate ? ["sound"] : [])]),
    halt: null,
    preview: null,
    rendererName,
    quality,
    out,
    raw: path.join(project, ".launchclip", "finish", `render-${prototype ? "prototype-" : ""}${quality}.mp4`),
    prototype: prototype ? { requested: true } : null,
    state: await readState(project),
    warnings: [...(styled.style?.warnings ?? []), ...candidateNotes],
    candidate,
    style: styled.style,
    words: null,
    resolved: null,
    gates: null
  };
  const stages = [];
  let failed = null;
  for (const definition of STAGES) {
    if (failed) {
      stages.push({ name: definition.name, status: "blocked", reason: `${failed} failed`, seconds: 0, outputs: [] });
      continue;
    }
    if (ctx.halt) {
      stages.push({ name: definition.name, status: "skipped", reason: ctx.halt, seconds: 0, outputs: [] });
      continue;
    }
    const entry = await runStage(ctx, definition);
    stages.push(entry);
    if (entry.status === "failed") failed = entry.name;
  }
  if (candidate && !failed && existsSync(out)) {
    const fps = Number(ctx.resolved?.resolved?.fps ?? ctx.resolved?.format?.fps ?? 30);
    const duration = Number(ctx.resolved?.resolved?.duration ?? ctx.resolved?.format?.duration);
    const into = options.into ? path.resolve(options.into) : project;
    ctx.candidateReceipt = await (adapters.recordCandidate ?? recordCandidate)({
      into, id: candidate, comparison: options.comparison, kind: options.kind, boundary: options.boundary, at: options.at,
      video: out, fps, duration, source: path.relative(into, project).split(path.sep).join("/") || "."
    });
  }
  const report = buildReport(ctx, stages, { seconds: round3((adapters.now() - started) / 1000), failed });
  await writeJson(path.join(project, PATHS.report), report);
  return report;
}

async function runStage(ctx, definition) {
  const started = ctx.adapters.now();
  const entry = { name: definition.name, status: "done", reason: null, seconds: 0, outputs: [] };
  try {
    const plan = await definition.plan(ctx);
    if (plan.skip) {
      entry.status = "skipped";
      entry.reason = plan.skip;
      if (plan.details) entry.details = plan.details;
    } else {
      const outputs = {};
      for (const file of plan.outputs ?? []) outputs[file] = await fileHash(path.join(ctx.project, file));
      const previous = ctx.state.stages?.[definition.name];
      const decision = plan.always ? { action: "run", reason: plan.always } : stageDecision(previous, { inputHash: plan.inputHash, outputs }, { force: ctx.options.force || ctx.forceStages.has(definition.name) });
      entry.reason = decision.reason;
      entry.outputs = plan.outputs ?? [];
      if (decision.action === "cached") {
        entry.status = "cached";
        entry.details = previous.details ?? {};
        definition.restore?.(ctx, previous.details ?? {});
      } else {
        const details = (await definition.run(ctx, plan)) ?? {};
        entry.details = details;
        if (!plan.always) {
          const written = {};
          for (const file of plan.outputs ?? []) written[file] = await fileHash(path.join(ctx.project, file));
          const missing = Object.entries(written).filter(([, hash]) => hash === null).map(([file]) => file);
          if (missing.length) throw new Error(`${definition.name} did not write ${missing.join(", ")}`);
          ctx.state.stages[definition.name] = { input_hash: plan.inputHash, outputs: written, details, completed_at: ctx.adapters.clock() };
          await writeState(ctx.project, ctx.state);
        }
      }
    }
  } catch (error) {
    entry.status = "failed";
    entry.error = error.message;
  }
  entry.seconds = round3((ctx.adapters.now() - started) / 1000);
  return entry;
}

const STAGES = [
  {
    name: "voice",
    async plan(ctx) {
      const narration = ctx.copy.audio?.narration;
      if (!narration || typeof narration !== "object") {
        if (ctx.options.voice) ctx.warnings.push(`--voice ${ctx.options.voice} ignored: storyboard.json has no audio.narration text`);
        return { skip: "no audio.narration" };
      }
      const provider = String(ctx.options.voice ?? narration.provider ?? DEFAULT_VOICE_PROVIDER).toLowerCase();
      const supplied = ctx.story.audio?.voice;
      const previous = ctx.state.stages?.voice;
      const generatedBefore = previous && Object.hasOwn(previous.outputs ?? {}, supplied);
      if (supplied && supplied !== PATHS.voice && provider !== "supplied" && !ctx.options.voice && existsSync(path.join(ctx.project, supplied))) {
        return { skip: `audio.voice is supplied (${supplied}); pass --voice to synthesise audio.narration instead` };
      }
      if (supplied === PATHS.voice && !generatedBefore && provider !== "supplied" && !ctx.options.voice && existsSync(path.join(ctx.project, supplied))) {
        return { skip: `audio.voice is supplied (${supplied}) and was not synthesised by finish; pass --voice to resynthesise` };
      }
      // Provider defaults fill voice and speed (Kokoro: af_heart at 1.2), the
      // same request `launchclip voice` measures, so its cached take is reused.
      if (Array.isArray(narration.lines)) {
        // Dialogue: one take per line in its speaker's voice (src/voice/dialogue.js).
        const dialogue = dialogueRequests(ctx.copy, ctx.options.voice ? { provider } : {});
        const gaps = dialogueGaps(ctx.copy);
        return { inputHash: hashValue({ dialogue, gaps }), outputs: [PATHS.voice, PATHS.words], request: { dialogue, gaps } };
      }
      const request = narrationRequest(narration, { provider });
      if (provider === "supplied") request.source = supplied ? await fileHash(path.join(ctx.project, supplied)) : null;
      return { inputHash: hashValue(request), outputs: [PATHS.voice, PATHS.words], request };
    },
    async run(ctx, { request }) {
      const outFile = path.join(ctx.project, PATHS.voice);
      if (request.dialogue) {
        const take = await synthesizeDialogue(request.dialogue, { outFile, cacheDir: voiceCacheDir(ctx.project), voiceProvider: ctx.adapters.voiceProvider, normalizeVoice: ctx.adapters.normalizeVoice, gap: request.gaps });
        const first = request.dialogue[0].request;
        await writeJson(path.join(ctx.project, PATHS.words), dialogueDocument(ctx.copy, request.dialogue, take));
        const details = { provider: first.provider, voice: null, voices: [...new Set(take.lines.map((line) => `${line.speaker}:${line.voice}`))], speed: first.speed, duration_seconds: take.duration, word_count: take.words.length, voice_file: PATHS.voice, words_file: PATHS.words, cached_take: take.cached };
        STAGES[0].restore(ctx, details);
        return details;
      }
      // Synthesised voices arrive at their engine's level (Kokoro is about
      // -22 LUFS), which leaves too little voice-to-music margin in the mix,
      // so synthesizeNarration brings them to the -17 LUFS supplied
      // voiceovers get (the offline test tone is left alone). Takes are
      // cached in .launchclip/voice, shared with `launchclip voice`.
      const take = await synthesizeNarration(request, {
        outFile,
        cacheDir: voiceCacheDir(ctx.project),
        voiceProvider: ctx.adapters.voiceProvider,
        normalizeVoice: ctx.adapters.normalizeVoice,
        source: request.provider === "supplied" && ctx.story.audio?.voice ? path.join(ctx.project, ctx.story.audio.voice) : undefined
      });
      const { words, duration, loudness } = take;
      await writeJson(path.join(ctx.project, PATHS.words), narrationDocument(request, take));
      const format = storyFormat(ctx.copy);
      if (Number.isFinite(format.duration) && duration > format.duration + 0.05) ctx.warnings.push(`narration runs ${duration}s, longer than format.duration (${format.duration}s); the end is cut off`);
      const details = { provider: request.provider, voice: request.voice, speed: request.speed, loudness, duration_seconds: duration, word_count: words.length, voice_file: PATHS.voice, words_file: PATHS.words, cached_take: take.cached };
      STAGES[0].restore(ctx, details);
      return details;
    },
    restore(ctx, details) {
      ctx.copy = buildFinishCopy(ctx.copy, { voice: details.voice_file ?? PATHS.voice, words: details.words_file ?? PATHS.words });
    }
  },
  {
    name: "validate",
    async plan() {
      return { always: "validation always runs (it is fast)", outputs: [] };
    },
    async run(ctx) {
      const validation = validateStory(ctx.copy);
      if (!validation.ok) throw new Error(`storyboard is invalid:\n- ${validation.errors.join("\n- ")}`);
      ctx.warnings.push(...validation.warnings);
      ctx.words = await loadWords(ctx.project, ctx.copy);
      ctx.beats = await readOptionalJson(path.join(ctx.project, "BEATS.json"));
      if (!ctx.beats && JSON.stringify(ctx.copy.scenes ?? []).includes("beat:")) {
        // The music (and its BEATS.json) is made in the sound stage; until then
        // beat anchors resolve on a provisional grid at the requested tempo.
        const bpm = Number(ctx.copy.audio?.music?.bpm) > 0 ? Number(ctx.copy.audio.music.bpm) : 100;
        ctx.beats = { ...gridFromBpm(bpm, Number(ctx.copy.format?.duration) || 60), provisional: true };
        ctx.warnings.push(`BEATS.json is missing; beat anchors use a provisional ${bpm} BPM grid until the sound stage writes it`);
      }
      // Footage-led: base.edl (the edit-recording plan) becomes base.trim.
      ctx.edl = await readStoryEdl(ctx.project, ctx.copy);
      // base.subject "auto": the mattes filed in assets/subject/mattes.json.
      ctx.subject = await readStorySubject(ctx.project, ctx.copy);
      // The whole-video head track (assets/subject/track.json).
      ctx.track = await readStoryTrack(ctx.project, ctx.copy);
      // The subject gate: a matte range whose cut-out is unstable or
      // collapses is not used; its scenes fall back (cinematic_check.js).
      ctx.subjectGate = await subjectMatteGate(ctx.project, ctx.subject);
      if (ctx.subjectGate.status === "failed") {
        const failed = ctx.subjectGate.ranges.filter((range) => !range.ok);
        const kept = ctx.subject.filter((matte) => !failed.some((range) => range.src === matte.src));
        for (const range of failed) ctx.warnings.push(`subject gate: the matte for ${range.in}–${range.out} s is not used (${range.reasons.join("; ")})`);
        const withAll = resolveStory(ctx.copy, { words: ctx.words ?? [], beats: ctx.beats, edl: ctx.edl, subject: ctx.subject, track: ctx.track });
        const fallback = applySubjectFallback(ctx.copy, withAll, { failed, kept });
        ctx.copy = fallback.story;
        ctx.subject = kept.length ? kept : null;
        ctx.subjectGate = { ...ctx.subjectGate, status: "fallback", changes: fallback.changes };
        ctx.warnings.push(...subjectFallbackLines(fallback.changes).map((line) => `subject gate: ${line}`));
      }
      const resolved = resolveStory(ctx.copy, { words: ctx.words ?? [], beats: ctx.beats, edl: ctx.edl, subject: ctx.subject, track: ctx.track });
      const second = validateStory(resolved);
      // A scene whose params do not resolve would render as a "Missing
      // module" placeholder, so it fails here as it does in story validate.
      const invalid = [...second.errors, ...moduleParamErrors(resolved)];
      if (invalid.length) throw new Error(`resolved storyboard is invalid:\n- ${invalid.join("\n- ")}`);
      ctx.warnings.push(...second.warnings);
      ctx.resolved = resolved;
      ctx.boundaries = deriveBoundaries(resolved);
      // Character stories: the cast resolves and every character is the same
      // person in every scene (src/cast.js castGate).
      const { castGate } = await import("./cast.js");
      ctx.castGate = castGate(resolved, { direction: await readOptionalJson(path.join(ctx.project, "DIRECTION.json")) });
      if (ctx.castGate.status === "failed") throw new Error(`cast check failed:\n- ${ctx.castGate.findings.slice(0, 8).map((finding) => finding.detail).join("\n- ")}`);
      const { checkLayoutProject } = await import("./layout_check.js");
      const layout = await checkLayoutProject(ctx.project, { story: ctx.copy, words: ctx.words ?? [], beats: ctx.beats ?? undefined });
      ctx.layout = { status: layout.status, profile: layout.profile, errors: layout.errors, elements: layout.elements, warnings: layout.warnings, findings: layout.findings };
      ctx.warnings.push(...layout.warnings.map((message) => `layout: ${message}`));
      if (ctx.prototype) applyPrototype(ctx);
      await writeResolvedCopy(ctx);
      const details = { scenes: ctx.resolved.scenes.length, boundaries: ctx.boundaries.length, words: ctx.words?.length ?? 0, subject: ctx.subjectGate, cast: ctx.castGate, layout: { status: layout.status, profile: layout.profile, errors: layout.errors, warnings: layout.findings.filter((finding) => finding.severity !== "error").length } };
      if (layout.status === "failed") {
        const lines = layout.findings.filter((finding) => finding.severity === "error").slice(0, 8).map((finding) => `${finding.rule} @${finding.at}s [${finding.ids.join(", ")}] ${finding.detail ?? ""}`.trim());
        const error = new Error(`layout check failed (${layout.errors} error${layout.errors === 1 ? "" : "s"}):\n- ${lines.join("\n- ")}`);
        throw error;
      }
      return details;
    }
  },
  {
    name: "captions",
    async plan(ctx) {
      const userOverlay = captionsOverlay(ctx.story);
      if (!userOverlay) return { skip: "no captions overlay" };
      if (userOverlay.src) return { skip: `captions overlay has src (${userOverlay.src})` };
      if (!ctx.words?.length) return { skip: "no narration words to caption" };
      return { inputHash: hashValue({ words: ctx.words, chunking: "chunkWords@default" }), outputs: [PATHS.captions] };
    },
    async run(ctx) {
      const chunks = chunkWords(ctx.words);
      await writeJson(path.join(ctx.project, PATHS.captions), { schema_version: "launchclip.word-captions.v1", chunks });
      const covered = chunks.reduce((sum, chunk) => sum + chunk.words.length, 0);
      const details = { chunks: chunks.length, words: covered, captions_file: PATHS.captions };
      STAGES[2].restore(ctx, details);
      return details;
    },
    restore(ctx, details) {
      ctx.copy = buildFinishCopy(ctx.copy, { captions: details.captions_file ?? PATHS.captions });
    }
  },
  {
    name: "sound",
    async plan(ctx) {
      if (ctx.story.audio?.mix) return { skip: `audio.mix is supplied (${ctx.story.audio.mix})` };
      const audio = ctx.copy.audio ?? {};
      const sfxOn = !(audio.sfx === "none" || audio.sfx === false);
      // The style's sound block: palette, music genre, ambience, density.
      const sound = soundSettings(await stylePack(ctx), ctx.copy);
      const choice = resolveMusicChoice(audio, { flag: ctx.options.music, env: ctx.adapters.env ?? process.env });
      const music = musicPlanSpec(choice);
      // --sfx-density wins over the style pack's sound.sfx_density (audio.sfx_density).
      const density = String(ctx.options.sfxDensity ?? audio.sfx_density ?? sound.density ?? "normal").toLowerCase();
      try { densityAmount(density); } catch { throw new Error(`--sfx-density must be low, normal, high or a number from 0 to 1; got ${ctx.options.sfxDensity ?? audio.sfx_density ?? sound.density}`); }
      const storyId = String(ctx.story.id ?? ctx.story.title ?? path.basename(ctx.project));
      const models = sceneModels(ctx.resolved);
      const bound = sfxOn ? bindCues(ctx.resolved, { models, palette: Boolean(sound.palette) }) : { cues: [], warnings: [] };
      bound.cues = applyDensity(bound.cues, density, storyId);
      const typing = sfxOn ? typingSchedule(collectTyping(ctx.resolved, { models }), { seed: storyId, ...densityTyping(density) }) : [];
      const libraries = sfxOn ? await resolveLibraries({ project: ctx.project, library: ctx.options.sfxLibrary ?? (audio.sfx_library ? path.resolve(ctx.project, audio.sfx_library) : undefined), home: ctx.options.sfxHome }) : [];
      // One line when a cue family is missing from every SFX library and falls
      // back to the procedural kit (it would sound unlike the library's set).
      const used = [...bound.cues.map((cue) => cue.cue), ...(typing.length ? ["keystroke", "keystroke-space", "keystroke-enter", "click"] : [])];
      const fallbacks = libraryFallbacks(used, libraries);
      if (fallbacks.length) ctx.warnings.push(`sfx: ${fallbacks.join(", ")} ${fallbacks.length === 1 ? "is" : "are"} not in the SFX library (${libraries.map((library) => library.dir === userLibraryDir({ home: ctx.options.sfxHome }) ? "~/.launchclip/sfx" : library.dir).join(", ")}), so ${fallbacks.length === 1 ? "it uses" : "they use"} the procedural kit; fill only the missing families with: launchclip sfx seed --missing`);
      const voice = audio.voice && existsSync(path.join(ctx.project, audio.voice)) ? audio.voice : null;
      if (!bound.cues.length && !typing.length && music.kind === "none" && !sound.ambience) return { skip: voice ? "no SFX or music: the voice is mounted directly" : "no voice, SFX or music to mix" };
      if (music.kind === "file" && !existsSync(path.join(ctx.project, music.file))) throw new Error(`audio.music file not found: ${music.file}`);
      const bed = music.kind === "none" ? null : { ...chooseBed(ctx.resolved, { ...music, bpm_range: audio.music_hints?.bpm_range }), ...(music.kind === "file" ? { file: music.file } : {}), ...(Number(music.volume) >= 0 && music.volume !== undefined ? { volume: Number(music.volume) } : {}) };
      // A genre (sound.music.genre) shapes the synth bed: the story's own
      // bpm and key win, then the style's, then the energy tempo held inside
      // the genre's range and a key the seed picks.
      if (bed && music.kind === "synth" && sound.genre) {
        const [low, high] = GENRE_SPECS[sound.genre].bpm;
        const bpm = Number(music.bpm) > 0 ? Number(music.bpm) : sound.bpm ?? Math.round(Math.min(high, Math.max(low, bed.bpm)));
        const key = typeof music.key === "string" && music.key ? music.key : sound.key ?? undefined;
        const picked = musicChoice({ genre: sound.genre, bpm, key, progression: sound.progression ?? undefined }, sound.seed);
        Object.assign(bed, { bpm: picked.bpm, key: picked.key, genre: picked.genre, progression: picked.progression });
      }
      // The kit request: with a palette every used family renders in it from
      // the seed; without one the historic kit renders as always, plus any
      // newer family a cue names (in the neutral timbre).
      const families = [...new Set(used)].sort();
      const extra = families.filter((family) => !HISTORIC_SFX_FAMILIES.includes(family));
      const kit = sound.active || extra.length ? {
        palette: sound.palette,
        seed: sound.active ? sound.seed : null,
        only: sound.palette ? (families.length ? families : ["tick"]) : null,
        with: sound.palette ? null : extra,
        ambience: sound.ambience
      } : null;
      ctx.warnings.push(...sound.warnings);
      // ElevenLabs: the music lock (.launchclip/music-lock.json) keeps the
      // project's track while the music brief is unchanged; otherwise the
      // request (no network, bar-quantised) names the cached track. Either
      // way the stage hashes the track's identity, so scene timing alone
      // re-runs beat sync but never asks for a new generation.
      let request = null;
      let provider = null;
      let lock = null;
      let trackKey = null;
      if (music.kind === "elevenlabs") {
        provider = await ctx.adapters.musicProvider("elevenlabs", { env: ctx.adapters.env ?? process.env, model: music.model });
        const params = musicParams(music, bed, Boolean(voice), ctx.options.musicHints ?? audio.music_hints);
        const built = provider.request(ctx.resolved, params);
        const brief = musicBrief({ provider: "elevenlabs", model: built.body?.model_id ?? music.model ?? null, prompt: music.prompt, bpm: built.bpm, hints: params.hints, seed: music.seed, narrated: Boolean(voice) });
        lock = { ...lockDecision(await readMusicLock(ctx.project), { brief, durationMs: Number(ctx.resolved.resolved.duration) * 1000, project: ctx.project, regenerate: Boolean(ctx.options.musicRegenerate) }), brief, params };
        trackKey = lock.reuse ? lock.lock.request_hash : (provider.cacheStatus?.(ctx.resolved, params)?.cache_key ?? hashValue(built.body));
        request = { track: trackKey, bpm: lock.reuse ? lock.lock.bpm : built.bpm };
        bed.bpm = request.bpm;
      }
      const sync = { mode: choice.sync ?? "auto", strategy: music.kind === "none" ? "off" : syncStrategy(ctx.copy, { sync: choice.sync, narrated: Boolean(voice) }) };
      const inputHash = hashValue({
        cues: bound.cues,
        bed,
        music: { kind: music.kind, request, sync, lufs: music.kind === "synth" ? null : MUSIC_LUFS },
        music_file: music.kind === "file" ? await fileHash(path.join(ctx.project, music.file)) : null,
        voice: voice ? await fileHash(path.join(ctx.project, voice)) : null,
        duration: ctx.resolved.resolved.duration,
        timing: sync.strategy === "snap" ? storyTiming(ctx.copy) : null,
        scripts: [await fileHash(SCRIPT.synth), await treeFingerprint(path.join(SCRIPTS, "sound")), await fileHash(SCRIPT.mix), await fileHash(path.join(ROOT, "src", "music", "beats.js")), await fileHash(path.join(ROOT, "src", "music", "beat_sync.js"))],
        kit: kit ?? undefined,
        sfx: { density, typing, libraries: libraries.map((library) => ({ scope: library.scope, dir: library.dir, families: hashValue(library.manifest.families) })) }
      });
      const outputs = [PATHS.mix, PATHS.audioManifest, PATHS.sfxManifest, ...(typing.length ? [PATHS.typing] : [])];
      if (music.kind !== "none") outputs.push(PATHS.beatSync, await beatsTarget(ctx.project));
      return { inputHash, outputs, sfxOn, cues: bound.cues, cueWarnings: [...choice.warnings, ...bound.warnings], bed, music, choice, voice, provider, lock, trackKey, sync, typing, libraries, storyId, density, sound, kit };
    },
    async run(ctx, plan) {
      ctx.warnings.push(...plan.cueWarnings);
      const kitDir = path.join(ctx.project, PATHS.kit);
      const synthBed = plan.music.kind === "synth" ? plan.bed : null;
      const kitKey = hashValue({ bed: synthBed, script: await fileHash(SCRIPT.synth), sound: await treeFingerprint(path.join(SCRIPTS, "sound")), ...(plan.kit ? { kit: plan.kit } : {}) });
      const previousKit = ctx.state.stages?.sound?.details?.kit_key;
      const ambienceFile = plan.sound.ambience ? path.join(kitDir, "ambience", `${plan.sound.ambience}.wav`) : null;
      let kitReused = previousKit === kitKey && existsSync(path.join(kitDir, "AUDIO-KIT.json")) && (!synthBed || existsSync(path.join(kitDir, "music", "bed.wav"))) && (!ambienceFile || existsSync(ambienceFile));
      if (!kitReused) await ctx.adapters.synthKit(kitDir, synthBed, plan.kit);
      const voiceFile = plan.voice ? path.join(ctx.project, plan.voice) : null;
      const duration = Number(ctx.resolved.resolved.duration);
      // Music: generate or reuse the track, analyse its beats, then beat sync.
      const track = await resolveMusicTrack(ctx, plan, kitDir);
      const synced = track ? await beatSync(ctx, plan, track, { duration }) : null;
      const musicFile = synced?.file ?? null;
      // Snapping moved scenes and hits: bind the SFX cues and the typing track
      // to the moved times.
      let boundCues = plan.cues;
      let typingPlan = plan.typing;
      if (synced?.changed && plan.sfxOn) {
        const models = sceneModels(ctx.resolved);
        boundCues = applyDensity(bindCues(ctx.resolved, { models, palette: Boolean(plan.sound.palette) }).cues, plan.density, plan.storyId);
        typingPlan = typingSchedule(collectTyping(ctx.resolved, { models }), { seed: plan.storyId, ...densityTyping(plan.density) });
      }
      const mixFile = path.join(ctx.project, PATHS.mix);
      // SFX cue → file: library first (explicit, project, user), then the kit.
      const kit = kitLibrary(path.join(kitDir, "sfx"), await readOptionalJson(path.join(kitDir, "AUDIO-KIT.json")));
      const cues = resolveCueFiles(boundCues, { libraries: plan.libraries, kit, storyId: plan.storyId });
      let typing = null;
      if (typingPlan.length) {
        const rendered = await ctx.adapters.renderTyping(typingPlan, typingBanks(plan.libraries, kit), { out: path.join(ctx.project, PATHS.typing), duration });
        typing = { file: path.join(ctx.project, PATHS.typing), keystrokes: rendered.keystrokes, counts: rendered.counts };
        cues.push({ cue: "typing", at: 0, volume: 1, shot: null, intent: `typing track (${rendered.keystrokes.length} keys)`, source: "typing", file: typing.file });
      }
      await writeJson(path.join(ctx.project, PATHS.cues), cues);
      const mixed = await ctx.adapters.buildMix({ voice: voiceFile, music: musicFile, ambience: ambienceFile, cues, sfxDir: path.join(kitDir, "sfx"), duration, out: mixFile, musicVolume: plan.bed?.volume ?? 0.42, ...(ambienceFile ? { ambienceVolume: AMBIENCE_VOLUME } : {}) });
      const placed = (mixed?.cues ?? cues).map((cue, index) => ({ ...cues[index], ...cue, file: cues[index]?.file ?? cue.file ?? path.join(kitDir, "sfx", `${cue.cue}.wav`) }));
      const sfxManifest = path.join(ctx.project, PATHS.sfxManifest);
      // Same shape build-mix.mjs --sfx-manifest writes; cinematic-check reads it through AUDIO-MANIFEST.json.
      // The typing track is listed as one cue per typed line (its first key) plus the full keystroke schedule.
      const typingCues = typing ? firstKeyPerShot(typing.keystrokes).map((key) => ({ cue: "typing", shot: key.shot, at: key.at, volume: 1, intent: "typing track", file: typing.file })) : [];
      const listed = [...placed.filter((cue) => cue.source !== "typing"), ...typingCues].sort((a, b) => a.at - b.at);
      await writeJson(sfxManifest, {
        cues: listed.map((cue, i) => ({ id: `sfx-${String(i + 1).padStart(2, "0")}-${cue.cue}`, cue: cue.cue, shot_id: cue.shot ?? null, at_seconds: cue.at, volume: cue.volume, intent: cue.intent ?? "", file: path.resolve(cue.file), source: cue.sfx_source ?? (cue.cue === "typing" ? "typing" : "kit"), variant: cue.variant ?? null })),
        typing: typing ? { file: typing.file, counts: typing.counts, keystrokes: typing.keystrokes } : null,
        density: plan.density,
        libraries: plan.libraries.map((library) => ({ scope: library.scope, manifest: library.file }))
      });
      const origins = new Set(cues.map((cue) => cue.sfx_origin).filter(Boolean));
      if (typing) for (const kind of Object.values(typingBanks(plan.libraries, kit))) for (const entry of kind) origins.add(entry.source);
      await writeJson(path.join(ctx.project, PATHS.audioManifest), {
        schema_version: "launchclip.audio-manifest.v1",
        generated_by: "launchclip finish",
        mix: { path: mixFile, duration_seconds: duration, ducking: voiceFile && musicFile ? "sidechain under voice" : null },
        voiceover: voiceFile ? { path: voiceFile, provider: ctx.state.stages?.voice?.details?.provider ?? "supplied" } : null,
        music: musicFile ? {
          path: musicFile,
          source: plan.music.kind,
          provider: plan.music.kind,
          volume: plan.bed.volume,
          bpm: plan.bed.bpm,
          key: plan.bed.key,
          kick_from: plan.bed.kick_from,
          kick_to: plan.bed.kick_to,
          energy: plan.bed.energy,
          original: track.original ? rel(ctx.project, track.original) : null,
          analysed_bpm: synced.grid?.bpm ?? null,
          beats: synced.beats_file,
          beat_sync: PATHS.beatSync,
          alignment: synced.alignment ? { offset: synced.alignment.offset, tempo: synced.alignment.tempo } : null,
          generation: track.generation ?? null,
          ...(plan.bed.genre ? { genre: plan.bed.genre, progression: plan.bed.progression } : {})
        } : null,
        ...(ambienceFile ? { ambience: { path: ambienceFile, bed: plan.sound.ambience, world: plan.sound.world, volume: AMBIENCE_VOLUME, ducking: voiceFile ? "sidechain under voice" : null } } : {}),
        ...(plan.sound.active ? { sound: { palette: plan.sound.palette, seed: plan.sound.seed, genre: plan.bed?.genre ?? null, ambience: plan.sound.ambience } } : {}),
        sfx_manifest: sfxManifest,
        sfx_kit: path.join(kitDir, "AUDIO-KIT.json"),
        sfx_libraries: plan.libraries.map((library) => ({ scope: library.scope, manifest: library.file })),
        license: [sfxLicense(origins), musicLicense(plan.music.kind)].filter(Boolean).join(" ")
      });
      const details = {
        mix_file: PATHS.mix,
        cues: cues.length,
        cue_sources: countBy(cues, "source"),
        bed: plan.bed,
        music: musicFile ? { provider: plan.music.kind, file: rel(ctx.project, musicFile), cached: track.cached ?? null, generation: track.generation ?? null } : null,
        sync: synced?.summary ?? null,
        timing: synced?.changed ? storyTiming(ctx.copy) : null,
        layout: synced?.changed ? ctx.layout : null,
        beats_file: synced?.beats_file ?? null,
        voice: Boolean(voiceFile),
        kit_key: kitKey,
        kit_reused: kitReused,
        sfx_density: plan.density,
        sfx_sources: countBy(cues.map((cue) => ({ scope: cue.sfx_source ?? (cue.source === "typing" ? "typing" : "kit") })), "scope"),
        typing_keys: typing ? typing.keystrokes.length : 0,
        ...(plan.sound.active ? { sound: { palette: plan.sound.palette, seed: plan.sound.seed, genre: plan.bed?.genre ?? null, ambience: plan.sound.ambience } } : {})
      };
      STAGES[3].restore(ctx, details);
      return details;
    },
    restore(ctx, details) {
      ctx.copy = buildFinishCopy(ctx.copy, { mix: details.mix_file ?? PATHS.mix });
      // Re-apply the beat-snapped timing the stage chose (it lives only in the copy).
      if (details.timing) {
        ctx.copy = applyTiming(ctx.copy, details.timing);
        if (details.layout) ctx.layout = details.layout;
      }
    }
  },
  {
    name: "render",
    async plan(ctx) {
      const resolved = resolveStory(ctx.copy, { words: ctx.words ?? [], beats: ctx.beats ?? null, edl: ctx.edl ?? null, subject: ctx.subject ?? null, track: ctx.track ?? null });
      ctx.resolved = resolved;
      await writeResolvedCopy(ctx);
      const assets = {};
      for (const asset of collectAssets(resolved)) assets[asset] = await fileHash(path.join(ctx.project, asset));
      const missing = Object.entries(assets).filter(([, hash]) => hash === null).map(([asset]) => asset);
      if (missing.length) ctx.warnings.push(`referenced assets not found: ${missing.join(", ")}`);
      if (ctx.options.previewScene) return { always: `--preview-scene ${ctx.options.previewScene} renders that scene only`, outputs: [] };
      const inputHash = hashValue({ renderer: ctx.rendererName, quality: ctx.quality, story: resolved, assets, words: ctx.words, version: VERSION, kit: await treeFingerprint(path.join(ROOT, "kit")), projectEntry: await fileHash(path.join(ctx.project, "remotion", "entry.tsx")) });
      return { inputHash, outputs: [rel(ctx.project, ctx.raw)] };
    },
    async run(ctx) {
      const adapter = ctx.adapters.renderer(ctx.rendererName);
      const tools = ctx.adapters.segmentTools;
      if (ctx.options.previewScene) {
        const output = path.join(ctx.project, previewPath(ctx.options.previewScene));
        const segments = await renderStory(ctx, adapter, { output, previewScene: ctx.options.previewScene });
        ctx.preview = { scene: ctx.options.previewScene, output };
        ctx.halt = `--preview-scene ${ctx.options.previewScene}: only that scene was rendered; the final is untouched`;
        return { renderer: ctx.rendererName, preview: rel(ctx.project, output), segments };
      }
      await mkdir(path.dirname(ctx.raw), { recursive: true });
      const scenes = ctx.options.scenes;
      const stillsDir = path.join(ctx.project, PATHS.sceneStills);
      const before = scenes.length && existsSync(ctx.raw) ? await sceneStills(ctx.resolved, ctx.raw, scenes, stillsDir, { suffix: "before", tools }).catch(() => []) : [];
      // --chapter: every segment inside the chapter re-renders; the rest come from the cache and the master is stitched from all of them.
      if (ctx.options.chapter) ctx.chapter = chapterWindow(ctx.resolved, ctx.options.chapter);
      const segments = await renderStory(ctx, adapter, { output: ctx.raw, scenes, range: ctx.chapter?.frames ?? null });
      if (scenes.length && segments?.mode === "whole") ctx.warnings.push(`partial rendering is Remotion-only: --scene ${scenes.join(",")} re-rendered the whole ${ctx.rendererName} video`);
      if (ctx.chapter && segments?.mode === "whole") ctx.warnings.push(`partial rendering is Remotion-only: --chapter ${ctx.chapter.id} re-rendered the whole ${ctx.rendererName} video`);
      if (ctx.chapter) ctx.chapter.segments = segments ? { forced: segments.forced, reused: segments.reused, total: segments.segments } : null;
      const details = { renderer: ctx.rendererName, raw: rel(ctx.project, ctx.raw), ...(ctx.rendererName === "hyperframes" ? { compiled: PATHS.hyperframes } : {}), ...(segments ? { segments } : {}) };
      if (scenes.length) details.scene_stills = await compareStills(ctx, scenes, before, stillsDir, tools);
      return details;
    }
  },
  {
    name: "master",
    async plan(ctx) {
      const chapters = deliveryChapters(ctx);
      return { inputHash: hashValue({ raw: await fileHash(ctx.raw), target: LOUDNESS_TARGET, script: await fileHash(SCRIPT.master), chapters: chapters.length ? chapters : undefined }), outputs: [rel(ctx.project, ctx.out), ...(chapters.length ? [PATHS.chapters] : [])] };
    },
    async run(ctx) {
      await mkdir(path.dirname(ctx.out), { recursive: true });
      const details = await masterDelivery(ctx);
      const chapters = await writeChapters(ctx);
      // --chapter also writes that chapter on its own, cut from the stitched master.
      if (ctx.chapter) {
        const output = path.join(ctx.project, chapterPath(ctx.chapter.id));
        await mkdir(path.dirname(output), { recursive: true });
        await ctx.adapters.cutChapter(ctx.out, output, { start: ctx.chapter.start, end: ctx.chapter.end });
        ctx.chapter.output = chapterPath(ctx.chapter.id);
      }
      return { ...details, ...(chapters ? { chapters } : {}), ...(ctx.chapter?.output ? { chapter: ctx.chapter } : {}) };
    },
    restore(ctx, details) {
      ctx.chapters = details.chapters ?? null;
    }
  },
  {
    name: "evidence",
    async plan(ctx) {
      if (ctx.candidate) return { skip: "candidate render: evidence skipped" };
      return { inputHash: hashValue({ video: await fileHash(ctx.out), story: ctx.resolved, renderer: ctx.rendererName, script: await fileHash(SCRIPT.evidence) }), outputs: [PATHS.evidence] };
    },
    async run(ctx) {
      const remotion = remotionInvocation([]);
      const hyperframes = hyperframesInvocation([]);
      const result = await ctx.adapters.buildEvidence(ctx.project, {
        video: ctx.out,
        renderer: ctx.rendererName,
        story: ctx.resolved,
        stillsProject: ctx.rendererName === "hyperframes" ? path.join(ctx.project, PATHS.hyperframes) : undefined,
        commands: { remotion: [remotion.command, ...remotion.args], hyperframes: [hyperframes.command, ...hyperframes.args] },
        sheets: true
      });
      return { manifest: PATHS.evidence, samples: result?.samples ?? null, artifacts: result?.artifacts ?? null, sheets: (result?.sheets ?? []).map((sheet) => `qa/critic-sheets/${sheet}`) };
    }
  },
  {
    name: "gates",
    async plan(ctx) {
      if (ctx.candidate) return { skip: "candidate render: judge it from the pixels (no gates)" };
      const inputHash = hashValue({
        video: await fileHash(ctx.out),
        evidence: await fileHash(path.join(ctx.project, PATHS.evidence)),
        audio_manifest: await fileHash(path.join(ctx.project, PATHS.audioManifest)),
        // The direction and coverage gates read the map.
        direction: await fileHash(directionFileFor(path.join(ctx.project, "storyboard.json"))),
        layout: ctx.layout,
        story: ctx.resolved,
        style: ctx.style?.file ? await fileHash(ctx.style.file) : ctx.style?.name ?? null,
        version: VERSION
      });
      return { inputHash, outputs: [PATHS.gates] };
    },
    async run(ctx) {
      const gates = await runGates(ctx);
      ctx.gates = gates;
      await writeJson(path.join(ctx.project, PATHS.gates), gates);
      return { gates };
    },
    restore(ctx, details) {
      ctx.gates = details.gates ?? null;
    }
  }
];

// ---------------------------------------------------------------------------
// Master: loudness, then the chapters (long form, RFC §10.2)

async function masterDelivery(ctx) {
  if (!(await ctx.adapters.hasAudio(ctx.raw))) {
    await copyFile(ctx.raw, ctx.out);
    return { mastered: false, reason: "the render has no audio stream", output: rel(ctx.project, ctx.out) };
  }
  // Master to a temporary file so a failed pass never leaves a half-written deliverable.
  const temporary = path.join(path.dirname(ctx.out), `.${path.basename(ctx.out, path.extname(ctx.out))}.mastering${path.extname(ctx.out) || ".mp4"}`);
  const result = await ctx.adapters.master(ctx.raw, temporary, { lufs: LOUDNESS_TARGET.lufs, tp: LOUDNESS_TARGET.tp });
  await rename(temporary, ctx.out);
  if (!result.compliant) ctx.warnings.push(`mastered loudness is ${result.output?.integrated_lufs} LUFS / ${result.output?.true_peak_dbtp} dBTP; target ${LOUDNESS_TARGET.lufs} LUFS, ≤ ${LOUDNESS_TARGET.tp} dBTP`);
  return { mastered: true, output: rel(ctx.project, ctx.out), loudness: result };
}

/** The story's chapters for delivery ([] for a prototype, a candidate or a preview). */
export function deliveryChapters(ctx) {
  if (ctx.prototype || ctx.candidate || !ctx.resolved) return [];
  return storyChapters(ctx.resolved).map(({ id, title, start, end }) => ({ id, title, start, end }));
}

// renders/chapters.txt (the YouTube description's chapter list) and the
// chapters muxed into the delivery MP4 (stream copy).
async function writeChapters(ctx) {
  const chapters = deliveryChapters(ctx);
  if (!chapters.length) return null;
  const duration = Number(ctx.resolved.resolved?.duration ?? ctx.resolved.format?.duration);
  const text = path.join(ctx.project, PATHS.chapters);
  await mkdir(path.dirname(text), { recursive: true });
  await writeFile(text, youtubeChapters(chapters));
  const meta = path.join(ctx.project, PATHS.chaptersMeta);
  await mkdir(path.dirname(meta), { recursive: true });
  await writeFile(meta, ffmetadataChapters(chapters, { duration, title: ctx.resolved.title ?? null }));
  const temporary = path.join(path.dirname(ctx.out), `.${path.basename(ctx.out, path.extname(ctx.out))}.chapters${path.extname(ctx.out) || ".mp4"}`);
  await ctx.adapters.muxChapters(ctx.out, meta, temporary);
  await rename(temporary, ctx.out);
  const problems = youtubeChapterProblems(chapters, duration);
  if (problems.length) ctx.warnings.push(`chapters: YouTube would not show them (${problems.join("; ")})`);
  ctx.chapters = { file: PATHS.chapters, list: chapters, youtube: problems.length ? "ignored" : "ok", problems };
  return ctx.chapters;
}

// ---------------------------------------------------------------------------
// Render: the segment cache (src/render_segments.js)

// --prototype: trim the resolved story to its opening cut. The later stages
// (sound, render, master, evidence, gates) all work on the trimmed copy.
function applyPrototype(ctx) {
  const cut = prototypeCut(ctx.resolved, ctx.words ?? []);
  if (!cut) {
    ctx.prototype = { requested: true, cut: null, duration: Number(ctx.resolved.resolved?.duration) };
    ctx.warnings.push(`--prototype: the story is ${ctx.prototype.duration} s, so the prototype is the whole video`);
    return;
  }
  ctx.copy = cut.story;
  ctx.fullResolved = ctx.resolved;
  ctx.resolved = resolveStory(ctx.copy, { words: ctx.words ?? [], beats: ctx.beats, edl: ctx.edl, subject: ctx.subject });
  ctx.boundaries = deriveBoundaries(ctx.resolved);
  ctx.prototype = { requested: true, cut: cut.cut, duration: cut.duration };
}

/** --scene / --preview-scene / --chapter → {scenes: [ids], previewScene: id|null, chapter: id|null}, checked against the story. */
export function iterationOptions(story, options = {}) {
  const list = (value) => (Array.isArray(value) ? value : value == null || value === false ? [] : [value]).flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
  const scenes = [...new Set(list(options.scenes ?? options.scene))];
  const preview = list(options.previewScene);
  const chapter = list(options.chapter);
  if (preview.length > 1) throw new Error(`--preview-scene takes one scene id; got ${preview.join(", ")}`);
  if (preview.length && scenes.length) throw new Error("use --scene or --preview-scene, not both");
  if (chapter.length > 1) throw new Error(`--chapter takes one chapter id; got ${chapter.join(", ")}`);
  if (chapter.length && (scenes.length || preview.length)) throw new Error("--chapter re-renders a whole chapter; drop --scene and --preview-scene");
  const ids = (Array.isArray(story?.scenes) ? story.scenes : []).map((scene) => scene?.id);
  for (const id of [...scenes, ...preview]) {
    if (!ids.includes(id)) throw new Error(`unknown scene "${id}"; storyboard.json has ${ids.join(", ")}`);
  }
  if (chapter.length) {
    const chapters = (Array.isArray(story?.chapters) ? story.chapters : []).map((entry) => entry?.id);
    if (!chapters.length) throw new Error("--chapter needs chapters in storyboard.json; run launchclip story long-form first");
    if (!chapters.includes(chapter[0])) throw new Error(`unknown chapter "${chapter[0]}"; storyboard.json has ${chapters.join(", ")}`);
  }
  return { scenes, previewScene: preview[0] ?? null, chapter: chapter[0] ?? null };
}

/** The chapter --chapter names, in the resolved story, with its frame range. → {id, title, start, end, frames: [a, b)} */
export function chapterWindow(resolved, id) {
  const chapter = storyChapters(resolved).find((entry) => entry.id === id);
  if (!chapter) throw new Error(`chapter "${id}" is not in the resolved story`);
  const fps = Number(resolved.resolved?.fps ?? resolved.format?.fps ?? 30);
  return { id: chapter.id, title: chapter.title, start: chapter.start, end: chapter.end, frames: [Math.round(chapter.start * fps), Math.round(chapter.end * fps)] };
}

/** Where --chapter writes the chapter on its own. */
export function chapterPath(id) {
  return `renders/chapters/${id}.mp4`;
}

export function previewPath(sceneId) {
  return `renders/scene-${sceneId}.mp4`;
}

// Remotion renders through the segment cache; HyperFrames renders whole
// videos, cached by hash, and a --preview-scene without a cached whole
// render compiles and renders only that scene's window; an adapter without
// renderSegments (a custom or injected Remotion adapter) renders the whole
// story directly.
async function renderStory(ctx, adapter, { output, scenes = [], previewScene = null, range = null }) {
  const common = { project: ctx.project, story: ctx.resolved, renderer: ctx.rendererName, adapter, quality: ctx.quality, output, scenes, previewScene, range, tools: ctx.adapters.segmentTools, now: ctx.adapters.now };
  if (ctx.rendererName === "hyperframes") {
    const compileAndRender = async (dir, file, extra = {}) => {
      const hfDir = path.join(ctx.project, dir);
      const compiled = await ctx.adapters.compileHyperFrames(ctx.resolved, { projectDir: hfDir, sourceDir: ctx.project, ...extra });
      ctx.compiledPlaceholders = (compiled?.warnings ?? []).filter((message) => /rendering a placeholder$/.test(message));
      ctx.warnings.push(...(compiled?.warnings ?? []).filter((message) => !ctx.warnings.includes(message)).map((message) => `hyperframes: ${message}`));
      await adapter.render(hfDir, file, { quality: ctx.quality });
    };
    return renderWithSegments({
      ...common,
      renderWhole: (file) => compileAndRender(PATHS.hyperframes, file),
      renderWindow: (file, { start, end }) => compileAndRender(PATHS.hyperframesPreview, file, { window: [start, end] })
    });
  }
  if (PARTIAL_RENDERERS.includes(ctx.rendererName) && typeof adapter.renderSegments === "function") return renderWithSegments(common);
  if (previewScene) throw new Error(`--preview-scene needs a renderer adapter that renders frame ranges; the ${ctx.rendererName} adapter in use has no renderSegments`);
  await adapter.render(ctx.project, output, { quality: ctx.quality, story: ctx.resolved });
  return null;
}

// Before/after stills of each --scene, side by side: the eye check for a
// second-pass fix.
async function compareStills(ctx, scenes, before, dir, tools) {
  const after = await sceneStills(ctx.resolved, ctx.raw, scenes, dir, { suffix: "after", tools });
  const out = [];
  for (const still of after) {
    const previous = before.find((entry) => entry.scene === still.scene);
    let compare = null;
    if (previous) {
      compare = path.join(dir, `${still.scene}-before-after.png`);
      try { await (tools?.sideBySide ?? defaultSideBySide)(previous.file, still.file, compare); } catch { compare = null; }
    }
    out.push({ scene: still.scene, seconds: still.seconds, before: previous ? rel(ctx.project, previous.file) : null, after: rel(ctx.project, still.file), compare: compare ? rel(ctx.project, compare) : null });
  }
  return out;
}

async function defaultSideBySide(left, right, output) {
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", left, "-i", right, "-filter_complex", "[0][1]hstack=inputs=2,scale=iw/2:-2", "-frames:v", "1", output]);
}

// The renderer-neutral gates cinematic-check runs, minus the critic: layout
// (geometric, from the validate stage), loudness (master), motion and audio
// analysis of the final MP4, the temporal evidence manifest, and (when the
// story names a style) style adherence (src/style_adherence.js).
async function runGates(ctx) {
  const format = storyFormat(ctx.resolved);
  const duration = Number(ctx.resolved.resolved?.duration ?? format.duration);
  const gates = {};
  gates.placeholders = placeholderGate(ctx);
  gates.layout = ctx.layout
    ? { status: ctx.layout.status === "failed" ? "failed" : "passed", profile: ctx.layout.profile, errors: ctx.layout.errors, findings: ctx.layout.findings.slice(0, 20) }
    : { status: "skipped", reason: "layout check did not run" };
  // The subject gate never fails the render: a failing matte range has
  // already fallen back (status "fallback", with the scene changes).
  const subjectGate = ctx.subjectGate ?? ctx.state.stages?.validate?.details?.subject;
  if (subjectGate && subjectGate.status !== "skipped") gates.subject = subjectGate;
  const castGate = ctx.castGate ?? ctx.state.stages?.validate?.details?.cast;
  if (castGate && castGate.status !== "skipped") gates.cast = castGate;

  const master = ctx.state.stages?.master?.details;
  gates.loudness = !master
    ? { status: "skipped", reason: "master did not run" }
    : master.mastered === false
      ? { status: "skipped", reason: master.reason }
      : { status: master.loudness?.compliant ? "passed" : "failed", target: master.loudness?.target, output: master.loudness?.output };

  try {
    // The motion floors are the cadence profile's bands (a locked-off talking
    // head barely moves; a motion explainer must).
    const { profile } = gateProfile(ctx.resolved, { direction: (await readProjectDirection(ctx.project)).map, style: await stylePack(ctx), project: ctx.project });
    const motion = await ctx.adapters.motion(ctx.out, path.join(ctx.project, PATHS.motion), { expected: cinematicMotionExpectations({ duration, width: format.width, height: format.height, profile }).expected });
    gates.motion = { status: motion?.quality?.ok ? "passed" : "failed", report: PATHS.motion, ...(profile ? { profile: profile.id } : {}), findings: (motion?.quality?.findings ?? []).slice(0, 12) };
  } catch (error) {
    gates.motion = { status: "failed", error: error.message };
  }

  try {
    const manifest = existsSync(path.join(ctx.project, PATHS.audioManifest)) ? path.join(ctx.project, PATHS.audioManifest) : null;
    // The same music volume cinematic-check resolves, so the two gates agree.
    const mixSettings = await resolveMusicMix(ctx.project, manifest, { soundDetails: ctx.state.stages?.sound?.details ?? null });
    const audio = await ctx.adapters.audio(ctx.out, manifest, { musicVolume: mixSettings.music_volume });
    if (audio && typeof audio === "object") audio.mix_settings = mixSettings;
    await writeJson(path.join(ctx.project, PATHS.audio), audio);
    gates.audio = { status: audio?.quality?.ok ? "passed" : "failed", report: PATHS.audio, manifest: manifest ? PATHS.audioManifest : null, findings: (audio?.quality?.findings ?? []).slice(0, 12) };
  } catch (error) {
    gates.audio = { status: "failed", error: error.message };
  }

  try {
    const manifest = await readOptionalJson(path.join(ctx.project, PATHS.evidence));
    if (!manifest) gates.temporal_evidence = { status: "failed", error: `${PATHS.evidence} is missing` };
    else {
      const schedule = buildTemporalEvidenceSchedule(duration, deriveBoundaries(ctx.resolved));
      const result = await validateTemporalEvidenceManifest(ctx.project, manifest, ctx.out, schedule);
      gates.temporal_evidence = { status: result.ok ? "passed" : "failed", entries: result.entry_count, expected: result.expected_count, errors: result.errors.slice(0, 12) };
    }
  } catch (error) {
    gates.temporal_evidence = { status: "failed", error: error.message };
  }

  // Style (RFC §9.5): when the story names a style, the render must follow it.
  if (ctx.style) {
    try {
      const request = storyStyleRequest(ctx.story ?? ctx.resolved)?.name ?? ctx.style.name;
      const { pack } = await ctx.adapters.resolveStyle(ctx.style.file ?? request, { projectDir: ctx.project });
      const measured = await ctx.adapters.styleReference(ctx.out);
      // Cadence from the storyboard (and the direction map's sections), as the coverage gate counts it.
      const { map } = await readProjectDirection(ctx.project);
      const check = styleAdherence({ story: ctx.resolved, pack, measured, profile: await styleProfile(pack), cadence: storyCadence(ctx.resolved, { map, words: ctx.words ?? [] }) });
      await writeJson(path.join(ctx.project, PATHS.style), { style: ctx.style.name, video: rel(ctx.project, ctx.out), ...check });
      gates.style = { status: check.status, style: ctx.style.name, report: PATHS.style, findings: check.checks.filter((entry) => !entry.ok).map((entry) => `${entry.severity}: ${entry.check}: ${entry.detail}`).slice(0, 12) };
    } catch (error) {
      gates.style = { status: "failed", style: ctx.style.name, error: error.message };
    }
  }

  // The quality gates (VIDEO_QUALITY_RFC §11.2): the direction map, coverage
  // against the cadence profile, and the face rule over whatever face data exists.
  try {
    const read = await readProjectDirection(ctx.project);
    const { profile } = gateProfile(ctx.resolved, { direction: read.map, style: await stylePack(ctx), project: ctx.project });
    // --prototype: the gates judge the opening it renders, so the map and the
    // narration are cut to the lines and scenes inside the window.
    const prototype = Boolean(ctx.prototype?.cut);
    const scope = prototype ? prototypeScope({ map: read.map, words: ctx.words ?? [], cut: ctx.prototype.cut, story: ctx.resolved, full: ctx.fullResolved }) : { map: read.map, words: ctx.words ?? [] };
    const direction = { ...read, map: scope.map };
    gates.direction = await directionGate({ project: ctx.project, resolved: ctx.resolved, words: scope.words, direction });
    const face = storyBase(ctx.resolved) ? await readFaceData(ctx.project, ctx.resolved) : null;
    gates.coverage = coverageGate({ resolved: ctx.resolved, words: scope.words, map: gates.direction.status === "passed" ? direction.map : null, profile, face: face?.intervals ?? null, prototype });
    if (storyBase(ctx.resolved)) gates.face = await faceGate({ project: ctx.project, resolved: ctx.resolved, layout: ctx.layout, profile, prototype });
    if (prototype) for (const name of ["direction", "coverage", "face"]) if (gates[name]) gates[name].scope = `prototype: the opening ${ctx.prototype.cut} s`;
  } catch (error) {
    gates.direction ??= { status: "failed", error: error.message };
  }

  gates.critic = {
    status: "pending",
    reason: "finish does not produce critic receipts",
    next_step: `Have a fresh-context critic review qa/critic-sheets/ and write qa/critic.json (citing the qa/temporal-evidence IDs), then run: launchclip cinematic-check ${ctx.project} --renderer ${ctx.rendererName} --video ${rel(ctx.project, ctx.out)} --expect-audio`
  };
  return gates;
}

/**
 * Placeholders: no scene may ship as a labelled "Missing module" card. A
 * scene renders as one when its module is unknown to the kit, when its params
 * do not resolve, when it is a custom module under HyperFrames (custom
 * modules are Remotion-only), or when the HyperFrames compiler reported
 * falling back for it (an emitter failure).
 */
export function placeholderScenes(resolved, { renderer, compileWarnings = [] } = {}) {
  const known = new Set(knownModules());
  const scenes = [];
  for (const scene of Array.isArray(resolved?.scenes) ? resolved.scenes : []) {
    if (scene?.module === "custom") {
      if (renderer === "hyperframes") scenes.push({ id: scene.id, module: scene.module, reason: "custom modules render only in Remotion" });
      continue;
    }
    if (!known.has(scene?.module)) { scenes.push({ id: scene?.id, module: scene?.module ?? null, reason: `module "${scene?.module}" is not a known module` }); continue; }
    try { resolveModule(scene, resolved); }
    catch (error) { scenes.push({ id: scene.id, module: scene.module, reason: error.message }); }
  }
  for (const message of compileWarnings) {
    const id = String(message).match(/^(?:hyperframes: )?([^:\s]+):/)?.[1];
    if (id && !scenes.some((entry) => entry.id === id)) scenes.push({ id, module: resolved?.scenes?.find((scene) => scene.id === id)?.module ?? null, reason: String(message).replace(/^(?:hyperframes: )?[^:\s]+: /, "").replace(/; rendering a placeholder$/, "") });
  }
  return scenes;
}

function placeholderGate(ctx) {
  const scenes = placeholderScenes(ctx.resolved, { renderer: ctx.rendererName, compileWarnings: ctx.compiledPlaceholders ?? [] });
  return {
    status: scenes.length ? "failed" : "passed",
    scenes: scenes.slice(0, 20),
    errors: scenes.slice(0, 12).map((entry) => `${entry.id} (${entry.module ?? "no module"}) renders as a "Missing module" placeholder: ${entry.reason}`)
  };
}

// The story's style pack (for its cadence profile), resolved once per run.
async function stylePack(ctx) {
  if (!ctx.style) return null;
  if (ctx.stylePack !== undefined) return ctx.stylePack;
  try {
    const request = storyStyleRequest(ctx.story ?? ctx.resolved)?.name ?? ctx.style.name;
    ctx.stylePack = (await ctx.adapters.resolveStyle(ctx.style.file ?? request, { projectDir: ctx.project })).pack ?? null;
  } catch { ctx.stylePack = null; }
  return ctx.stylePack;
}

function buildReport(ctx, stages, { seconds, failed }) {
  const gates = ctx.gates ?? {};
  const gateStatuses = Object.values(gates).map((gate) => gate.status);
  const status = failed ? "failed" : ctx.preview ? "preview" : ctx.candidate ? "candidate" : ctx.prototype ? "prototype" : gateStatuses.includes("failed") ? "needs-repair" : "ready-for-review";
  const nextSteps = [];
  const render = stages.find((stage) => stage.name === "render");
  if (failed) {
    const entry = stages.find((stage) => stage.name === failed);
    nextSteps.push(`Fix the ${failed} stage (${firstLine(entry?.error)}) and run launchclip finish again; finished stages are reused.`);
  } else {
    for (const [name, gate] of Object.entries(gates)) if (gate.status === "failed") nextSteps.push(`Repair the ${name} gate (see ${gate.report ?? PATHS.gates}).`);
    if (gates.critic?.next_step) nextSteps.push(gates.critic.next_step);
  }
  if (!failed && ctx.candidateReceipt) nextSteps.push(`Score candidate ${ctx.candidate} (0-10 per field) in ${ctx.candidateReceipt.receipt} from its frames, then set selected_candidate_id (highest mean, ties by candidate_order), selection_rationale and a rejection_reason for each loser.`);
  if (!failed && ctx.prototype) nextSteps.push(`Review the prototype (${rel(ctx.project, ctx.out)}${ctx.prototype.cut ? `, the opening ${ctx.prototype.cut} s of ${ctx.prototype.duration} s` : ""}) for style, layout, density and sound; when it is right, run launchclip finish ${ctx.project} for the whole video.`);
  if (!failed && ctx.preview) nextSteps.push(`Look at ${rel(ctx.project, ctx.preview.output)}; when it is right, run launchclip finish ${ctx.project} --scene ${ctx.preview.scene} to re-render it into the final.`);
  return {
    schema_version: FINISH_REPORT_VERSION,
    status,
    project: ctx.project,
    story: path.join(ctx.project, "storyboard.json"),
    resolved_copy: PATHS.copy,
    renderer: ctx.rendererName,
    quality: ctx.quality,
    style: ctx.style ? { name: ctx.style.name, source: ctx.style.source, file: ctx.style.file, applied: ctx.style.applied.length } : null,
    voice: ctx.state.stages?.voice?.details?.provider && stages.find((stage) => stage.name === "voice")?.status !== "skipped" ? ctx.state.stages.voice.details.provider : null,
    final: !failed && !ctx.preview && existsSync(ctx.out) ? ctx.out : null,
    output: ctx.out,
    ...(ctx.preview ? { preview: { scene: ctx.preview.scene, output: ctx.preview.output } } : {}),
    ...(ctx.candidate ? { candidate: { id: ctx.candidate, ...(ctx.candidateReceipt ?? {}) } } : {}),
    ...(ctx.prototype ? { prototype: { cut: ctx.prototype.cut ?? null, duration: ctx.prototype.duration ?? null } } : {}),
    ...(ctx.options.scenes?.length ? { scenes: ctx.options.scenes, scene_stills: render?.details?.scene_stills ?? [] } : {}),
    ...(ctx.chapters ? { chapters: ctx.chapters } : {}),
    ...(ctx.chapter ? { chapter: { id: ctx.chapter.id, title: ctx.chapter.title, start: ctx.chapter.start, end: ctx.chapter.end, output: ctx.chapter.output ?? null, segments: ctx.chapter.segments ?? null } } : {}),
    seconds,
    stages,
    gates,
    warnings: [...new Set(ctx.warnings)],
    next_steps: nextSteps,
    finished_at: ctx.adapters.clock()
  };
}

/** "10 segments: 8 reused, 2 rendered (~11.3s saved)" */
export function segmentSummary(segments) {
  if (segments.mode === "window") return `scene window only (frames ${segments.frames.start}–${segments.frames.end}; ${segments.renderer} has no frame range, so the preview compiles just that stretch)`;
  if (segments.mode === "whole") return `whole-video cache (${segments.renderer} has no frame range): ${segments.reused ? `reused${segments.seconds_saved ? ` (~${segments.seconds_saved}s saved)` : ""}` : "rendered"}`;
  const forced = segments.forced ? `, ${segments.forced} forced by --scene or --chapter` : "";
  return `${segments.segments} segments: ${segments.reused} reused, ${segments.rendered} rendered${forced}${segments.reused ? ` (~${segments.seconds_saved}s saved)` : ""}`;
}

/** Human summary of a finish report. */
export function formatFinishSummary(report) {
  const lines = [`launchclip finish: ${report.status} (${report.renderer}, ${report.quality}, ${report.seconds}s)`];
  for (const stage of report.stages) {
    const note = stage.error ? firstLine(stage.error) : stage.reason ?? "";
    lines.push(`  ${stage.name.padEnd(9)} ${stage.status.padEnd(8)} ${String(stage.seconds).padStart(7)}s  ${note}`.trimEnd());
    const segments = stage.name === "render" ? stage.details?.segments : null;
    if (segments) lines.push(`            ${segmentSummary(segments)}`);
  }
  if (report.preview) lines.push(`preview: ${report.preview.output}`);
  if (report.chapter) lines.push(`chapter ${report.chapter.id} (${report.chapter.title}, ${report.chapter.start}–${report.chapter.end} s): ${report.chapter.segments ? `${report.chapter.segments.forced} of ${report.chapter.segments.total} segments re-rendered, ` : ""}master stitched${report.chapter.output ? `, ${report.chapter.output}` : ""}`);
  if (report.chapters) lines.push(`chapters: ${report.chapters.list.length} in ${report.chapters.file} and the MP4${report.chapters.problems.length ? ` (YouTube would not show them: ${report.chapters.problems.join("; ")})` : ""}`);
  if (report.candidate?.receipt) lines.push(`candidate ${report.candidate.id} (${report.candidate.comparison}): ${report.candidate.artifacts.join(", ")} -> ${report.candidate.receipt}`);
  for (const still of report.scene_stills ?? []) lines.push(`scene ${still.scene} @${still.seconds}s: ${still.compare ?? still.after}${still.compare ? " (before | after)" : ""}`);
  const gates = Object.entries(report.gates ?? {});
  if (gates.length) {
    lines.push("gates:");
    for (const [name, gate] of gates) lines.push(`  ${name.padEnd(17)} ${gate.status}${gate.error ? `  ${firstLine(gate.error)}` : ""}`);
  }
  if (report.final) lines.push(`final: ${report.final}`);
  for (const warning of report.warnings ?? []) lines.push(`warning: ${warning}`);
  for (const step of report.next_steps ?? []) lines.push(`next: ${step}`);
  lines.push(`report: ${path.join(report.project, PATHS.report)}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Music: provider → track → beats → beat sync (the sound stage's music part)

// The music decision as the sound stage plans with it.
function musicPlanSpec(choice) {
  const spec = { kind: choice.provider, sync: choice.sync ?? "auto" };
  for (const key of ["file", "bpm", "key", "prompt", "seed", "model", "volume"]) if (choice[key] !== undefined) spec[key] = choice[key];
  return spec;
}

function musicParams(music, bed, narrated, hints) {
  const params = { seconds: bed.seconds, bpm: bed.bpm, narrated };
  if (music.prompt) params.prompt = music.prompt;
  if (Number.isInteger(music.seed)) params.seed = music.seed;
  if (music.model) params.model = music.model;
  if (hints) params.hints = hints;
  return params;
}

// Where finish writes BEATS.json: the project root (so beat:n anchors
// resolve) unless the user authored a root BEATS.json, which is never
// overwritten.
async function beatsTarget(project) {
  const root = await readOptionalJson(path.join(project, PATHS.beats)).catch(() => null);
  return !root || root.generated_by === "launchclip finish" ? PATHS.beats : PATHS.beatsFallback;
}

/** Scene timing fields of a story copy: {sceneId: {start, end, hits: [at…]}} (anchors kept as written). */
export function storyTiming(story) {
  const timing = {};
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (!scene?.id) continue;
    timing[scene.id] = { start: scene.start, end: scene.end, hits: (Array.isArray(scene.hits) ? scene.hits : []).map((hit) => hit?.at) };
  }
  return timing;
}

/** A copy of story with the timing fields from storyTiming() applied. */
export function applyTiming(story, timing) {
  const copy = JSON.parse(JSON.stringify(story));
  for (const scene of Array.isArray(copy.scenes) ? copy.scenes : []) {
    const entry = timing?.[scene?.id];
    if (!entry) continue;
    if (entry.start !== undefined) scene.start = entry.start;
    if (entry.end !== undefined) scene.end = entry.end;
    (Array.isArray(scene.hits) ? scene.hits : []).forEach((hit, index) => { if (entry.hits?.[index] !== undefined) hit.at = entry.hits[index]; });
  }
  return copy;
}

// Generate or reuse the track and know its beat grid (music time).
// → {file, original, grid, length, exactGrid, cached, generation} or null
async function resolveMusicTrack(ctx, plan, kitDir) {
  const duration = Number(ctx.resolved.resolved.duration);
  if (plan.music.kind === "none") return null;
  if (plan.music.kind === "synth") {
    // The procedural bed's grid is exact: its own BEATS.json, else from its tempo.
    const kitBeats = await readOptionalJson(path.join(kitDir, "BEATS.json")).catch(() => null);
    const grid = Array.isArray(kitBeats?.beats) && kitBeats.beats.length ? kitBeats : gridFromBpm(plan.bed.bpm, duration);
    return { file: path.join(kitDir, "music", "bed.wav"), original: null, grid, length: duration, exactGrid: true, cached: null, generation: null };
  }
  if (plan.music.kind === "elevenlabs") {
    const outFile = path.join(ctx.project, PATHS.music);
    const decision = plan.lock;
    if (decision?.reuse) {
      // The locked track: no request at all, so no spend.
      const locked = decision.lock;
      await mkdir(path.dirname(outFile), { recursive: true });
      await copyFile(path.join(ctx.project, locked.file), outFile);
      ctx.adapters.notice?.(`music: REUSE locked ElevenLabs track ${locked.file} (music brief unchanged; no paid generation). Scene timing changes only re-run beat sync; pass --music-regenerate for a new track.`);
      const grid = await analyse(ctx, outFile, locked.bpm);
      return {
        file: outFile,
        original: outFile,
        grid,
        length: grid?.duration ?? locked.length_ms / 1000,
        exactGrid: false,
        cached: true,
        generation: { provider: "elevenlabs", endpoint: "POST /v1/music", mode: locked.mode ?? null, requested_bpm: locked.bpm, length_ms: locked.length_ms, cached: true, locked: true, lock_file: ".launchclip/music-lock.json", request_hash: locked.request_hash, cache_file: locked.cache_file ?? null, generated_seconds: 0, cost_usd_estimate: 0, song_id: locked.song_id ?? null }
      };
    }
    const provider = plan.provider ?? await ctx.adapters.musicProvider("elevenlabs", { env: ctx.adapters.env ?? process.env, model: plan.music.model });
    const params = decision?.params ?? musicParams(plan.music, plan.bed, Boolean(plan.voice), ctx.options.musicHints ?? ctx.copy.audio?.music_hints);
    const force = Boolean(ctx.options.musicRegenerate);
    const status = provider.cacheStatus?.(ctx.resolved, params) ?? null;
    const why = decision?.reason ? ` (${decision.reason})` : "";
    if (status && status.cached && !force) {
      ctx.adapters.notice?.(`music: REUSE cached ElevenLabs track for this exact request${why}; no paid generation (${status.cache_file})`);
    } else if (status) {
      ctx.adapters.notice?.(`music: PAID ElevenLabs generation of ${(status.length_ms / 1000).toFixed(1)} s (about $${status.cost_usd_estimate})${why}; it will be cached in ${provider.cacheDir} and locked for this project`);
    } else {
      ctx.adapters.notice?.(`music: ElevenLabs Music API (paid; POST /v1/music)${why} — generations are cached in ${provider.cacheDir}`);
    }
    const result = await provider.generate(ctx.resolved, params, { outFile, force });
    ctx.adapters.notice?.(result.cached ? `music: cache hit, no new generation (${result.cache_file})` : `music: generated ${result.generated_seconds}s (about $${result.cost_usd}); cached as ${result.cache_file}`);
    if (decision?.brief) {
      const written = await writeMusicLock(ctx.project, { brief: decision.brief, sourceFile: outFile, cacheKey: plan.trackKey ?? result.cache_key, cacheFile: result.cache_file ?? null, bpm: result.request?.bpm ?? plan.bed.bpm, lengthMs: result.request?.length_ms ?? Math.round(Number(ctx.resolved.resolved.duration) * 1000 + 2000), mode: result.request?.mode ?? null, songId: result.song_id ?? null, clock: ctx.adapters.clock });
      ctx.adapters.notice?.(`music: locked ${written.file} in .launchclip/music-lock.json; later runs reuse it while the music brief (provider, model, prompt, BPM, style hints, length bucket) is unchanged`);
    }
    const grid = await analyse(ctx, outFile, plan.bed.bpm);
    return {
      file: outFile,
      original: outFile,
      grid,
      length: grid?.duration ?? (result.request?.length_ms ?? 0) / 1000,
      exactGrid: false,
      cached: result.cached,
      generation: { provider: "elevenlabs", endpoint: "POST /v1/music", mode: result.request?.mode, model: result.model, requested_bpm: result.request?.bpm, length_ms: result.request?.length_ms, arc: result.request?.arc, cached: result.cached, cache_file: result.cache_file, generated_seconds: result.generated_seconds, cost_usd_estimate: result.cost_usd, song_id: result.song_id }
    };
  }
  const file = path.join(ctx.project, plan.music.file);
  const grid = await analyse(ctx, file, Number(plan.music.bpm) > 0 ? Number(plan.music.bpm) : null);
  return { file, original: file, grid, length: grid?.duration ?? null, exactGrid: false, cached: true, generation: null };
}

async function analyse(ctx, file, bpmHint) {
  try {
    return await ctx.adapters.analyzeBeats(file, { bpmHint });
  } catch (error) {
    ctx.warnings.push(`music: beat analysis of ${rel(ctx.project, file)} failed (${firstLine(error.message)}); the music is mixed without beat sync`);
    return null;
  }
}

// Choose the music offset/tempo (align), snap the copy's cuts and hits (snap),
// prepare the track, write BEATS.json and qa/beat-sync.json.
async function beatSync(ctx, plan, track, { duration }) {
  const strategy = track.grid ? plan.sync.strategy : "off";
  const mode = plan.sync.mode === "off" ? "off" : plan.sync.mode;
  const momentsBefore = keyMoments(ctx.resolved, { hits: mode !== "cuts" });
  let alignment = { offset: 0, tempo: 1, score: null, baseline: null, gain: 0, tried: 0 };
  if (track.grid && strategy !== "off" && !track.exactGrid && mode !== "hits") {
    // Before snapping, prefer grids that bring cuts within the snap tolerance.
    alignment = chooseAlignment(track.grid, momentsBefore, { duration, musicLength: track.length ?? duration + 2, allowTempo: true, sigma: strategy === "snap" ? 0.12 : undefined });
  }
  let file = track.file;
  if (!track.exactGrid) {
    file = path.join(ctx.project, PATHS.musicPrepared);
    await ctx.adapters.prepareMusic(track.file, file, { offset: alignment.offset, tempo: alignment.tempo, duration, lufs: MUSIC_LUFS });
  }
  const storyGrid = track.grid ? transformGrid(track.grid, { offset: alignment.offset, tempo: alignment.tempo, duration }) : null;
  const beatsFile = await beatsTarget(ctx.project);
  const ownsRoot = beatsFile === PATHS.beats;
  if (!ownsRoot) ctx.warnings.push(`BEATS.json is user-authored, so finish wrote the music's grid to ${PATHS.beatsFallback}; beat anchors keep using BEATS.json`);
  if (storyGrid) {
    const document = beatsDocument(storyGrid, {
      generated_by: "launchclip finish",
      source: rel(ctx.project, file),
      music_source: track.original ? rel(ctx.project, track.original) : rel(ctx.project, track.file),
      provider: plan.music.kind,
      alignment: { offset: alignment.offset, tempo: alignment.tempo },
      analysis: track.exactGrid ? { method: "synth bed grid (exact)" } : { bpm: track.grid.bpm, confidence: track.grid.confidence ?? null, method: track.grid.method ?? null },
      duration
    });
    await writeJson(path.join(ctx.project, beatsFile), document);
    if (ownsRoot) ctx.beats = document;
  }
  const beatsForAnchors = ownsRoot ? storyGrid : ctx.beats;
  let changes = [];
  let reverted = [];
  let skipped = [];
  let changed = false;
  if (storyGrid && strategy === "snap" && mode !== "off") {
    const before = ctx.copy;
    const result = snapStory(ctx.copy, storyGrid, { mode, words: ctx.words ?? [], beats: beatsForAnchors });
    ({ changes, reverted, skipped } = result);
    if (changes.length) {
      // Re-validate and re-run layout-check on the snapped copy; fall back
      // to the unsnapped timing when either fails.
      const resolved = resolveStory(result.story, { words: ctx.words ?? [], beats: beatsForAnchors });
      const validation = validateStory(resolved);
      const { checkLayoutProject } = await import("./layout_check.js");
      const layout = validation.ok ? await checkLayoutProject(ctx.project, { story: result.story, words: ctx.words ?? [], beats: beatsForAnchors ?? undefined }) : null;
      const layoutBroke = layout && layout.status === "failed" && ctx.layout?.status !== "failed";
      if (!validation.ok || layoutBroke) {
        const reason = !validation.ok ? `the snapped story is invalid: ${validation.errors[0]}` : `layout-check failed after snapping: ${layout.findings.find((finding) => finding.severity === "error")?.rule ?? "error"}`;
        reverted = [...reverted, ...changes.map((change) => ({ ...change, reason }))];
        changes = [];
        ctx.copy = before;
      } else {
        ctx.copy = result.story;
        ctx.resolved = resolved;
        ctx.boundaries = deriveBoundaries(resolved);
        ctx.layout = { status: layout.status, profile: layout.profile, errors: layout.errors, elements: layout.elements, warnings: layout.warnings, findings: layout.findings };
        changed = true;
        await writeResolvedCopy(ctx);
      }
    }
  }
  const moments = storyGrid ? momentReport(keyMoments(ctx.resolved, { hits: mode !== "cuts" }), storyGrid) : [];
  const summary = summarizeMoments(moments);
  const requestedBpm = Number(plan.bed?.bpm) || null;
  const report = {
    schema_version: BEAT_SYNC_SCHEMA,
    generated_by: "launchclip finish",
    strategy,
    mode,
    lane: ctx.copy.lane,
    narrated: Boolean(plan.voice),
    music: {
      provider: plan.music.kind,
      file: rel(ctx.project, file),
      original: track.original ? rel(ctx.project, track.original) : null,
      requested_bpm: requestedBpm,
      analysed_bpm: track.grid?.bpm ?? null,
      bpm_error: requestedBpm && track.grid?.bpm ? Math.round((track.grid.bpm - requestedBpm) * 100) / 100 : null,
      confidence: track.grid?.confidence ?? null,
      beats_file: storyGrid ? beatsFile : null
    },
    alignment: { offset: alignment.offset, tempo: alignment.tempo, score: alignment.score, baseline: alignment.baseline, gain: alignment.gain, candidates: alignment.tried ?? 0, ...(alignment.rejected_tempo ? { rejected_tempo: alignment.rejected_tempo } : {}) },
    summary,
    moments,
    changes,
    reverted,
    skipped,
    notes: strategy === "align" ? ["Narration timing is fixed: the music moved (offset/tempo); no story time changed."] : strategy === "snap" ? ["Second-timed cuts snap to downbeats and hits to beats within 0.25 s; word and beat anchors never move."] : ["Beat sync is off."]
  };
  await writeJson(path.join(ctx.project, PATHS.beatSync), report);
  return {
    file,
    grid: track.grid ? { bpm: track.grid.bpm, confidence: track.grid.confidence ?? null } : null,
    alignment,
    changed,
    beats_file: storyGrid ? beatsFile : null,
    summary: { strategy, mode, offset: alignment.offset, tempo: alignment.tempo, analysed_bpm: track.grid?.bpm ?? null, changes: changes.length, reverted: reverted.length, ...summary, report: PATHS.beatSync }
  };
}

/**
 * Trim `offset` seconds from the start, change tempo by `tempo` (atempo),
 * cut to the story length plus a short tail and bring the track to `lufs`
 * (two-pass loudnorm). Writes 48 kHz stereo PCM.
 */
export async function prepareMusicTrack(input, output, { offset = 0, tempo = 1, duration, lufs = MUSIC_LUFS } = {}) {
  const chain = [];
  if (Math.abs(tempo - 1) > 1e-4) chain.push(`atempo=${tempo.toFixed(4)}`);
  const length = Number(duration) > 0 ? Number(duration) + 0.5 : null;
  const head = ["-hide_banner", "-nostdin", "-ss", String(Math.max(0, offset)), "-i", input];
  const tail = length ? ["-t", length.toFixed(3)] : [];
  const filter = `loudnorm=I=${lufs}:TP=-2:LRA=11`;
  const first = await execFileAsync("ffmpeg", [...head, ...tail, "-af", [...chain, `${filter}:print_format=json`].join(","), "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const measured = parseLoudnormJson(first.stderr);
  const apply = `${filter}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  await mkdir(path.dirname(output), { recursive: true });
  await execFileAsync("ffmpeg", [...head, ...tail, "-y", "-af", [...chain, apply].join(","), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output], { maxBuffer: 1 << 26 });
  return { output, offset, tempo, input_lufs: Number(measured.input_i), target_lufs: lufs };
}

// ---------------------------------------------------------------------------
// Helpers

async function writeResolvedCopy(ctx) {
  await writeJson(path.join(ctx.project, PATHS.copy), ctx.copy);
  if (ctx.resolved) await writeJson(path.join(ctx.project, PATHS.resolved), ctx.resolved);
}

async function loadWords(project, story) {
  const file = typeof story?.audio?.words === "string" ? path.join(project, story.audio.words) : null;
  if (!file || !existsSync(file)) return null;
  const words = narrationWords(await readJson(file, story.audio.words));
  // A dialogue's words keep their speaker (character scenes' says: "auto").
  return words.map((word) => ({ text: String(word.text ?? word.word ?? ""), start: Number(word.start), end: Number(word.end), ...(typeof word.speaker === "string" ? { speaker: word.speaker } : {}) }));
}

// Every assets/ path referenced anywhere in the resolved story.
function collectAssets(story) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === "string") { if (/^(\.\/)?assets\//.test(value)) found.add(value.replace(/^\.\//, "")); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(story);
  return [...found].sort();
}

// Path, size and mtime of every file under a directory: a cheap fingerprint
// so kit code changes invalidate cached renders.
async function treeFingerprint(directory) {
  const entries = [];
  const walk = async (dir) => {
    let names;
    try { names = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        entries.push(`${path.relative(directory, full)}:${info.size}:${Math.round(info.mtimeMs)}`);
      }
    }
  };
  await walk(directory);
  return hashValue(entries.join("\n"));
}

async function readState(project) {
  const state = await readOptionalJson(path.join(project, PATHS.state));
  if (state?.schema_version === FINISH_STATE_VERSION && state.stages && typeof state.stages === "object") return state;
  return { schema_version: FINISH_STATE_VERSION, stages: {} };
}

async function writeState(project, state) {
  await writeJson(path.join(project, PATHS.state), state);
}

function countBy(list, key) {
  const counts = {};
  for (const item of list) counts[item[key]] = (counts[item[key]] ?? 0) + 1;
  return counts;
}

function projectFile(project, value) {
  return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(project, String(value));
}

function rel(project, file) {
  const relative = path.relative(project, file);
  return relative.startsWith("..") ? file : relative;
}

function firstLine(value) {
  return String(value ?? "").split("\n")[0];
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

async function readJson(file, label) {
  let text;
  try { text = await readFile(file, "utf8"); }
  catch { throw new Error(`Cannot read ${label}: ${file}`); }
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`${label} is not valid JSON (${file}): ${error.message}`); }
}

async function readOptionalJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
