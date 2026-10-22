// The project's music lock: once `launchclip finish` has a paid ElevenLabs
// track, it records it in <project>/.launchclip/music-lock.json and reuses it
// while the music brief is unchanged. Scene timing is not part of the brief,
// so moving cuts only re-runs beat sync and alignment against the same track.
//
// The brief: provider, model, the user's prompt, the target BPM, the
// style-pack hints, the seed, narrated vs not, and the length bucket (the
// locked track must cover the story plus a second and run at most 8 bars
// past it). Anything else (scene boundaries, energy segment times, words)
// never triggers a new generation. --music-regenerate ignores the lock.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { barMs, normalizeHints } from "./prompt.js";

export const MUSIC_LOCK_SCHEMA = "launchclip.music-lock.v1";
export const MUSIC_LOCK_FILE = path.join(".launchclip", "music-lock.json");
export const MUSIC_LOCK_DIR = path.join(".launchclip", "music");
// The locked track must run at least this far past the story's end.
export const LOCK_MIN_TAIL_MS = 1000;
// ...and at most this many bars past it before a longer story outgrows it.
export const LOCK_MAX_EXTRA_BARS = 8;

/**
 * The music brief: the inputs that decide what the track sounds like. Hints
 * are normalised so their spelling does not matter.
 */
export function musicBrief({ provider = "elevenlabs", model = null, prompt = null, bpm, hints = null, seed = null, narrated = false } = {}) {
  const style = normalizeHints(hints);
  return {
    provider,
    model: model ?? null,
    prompt: prompt ? String(prompt).trim() : null,
    bpm: Math.round(Number(bpm)) || null,
    style_hints: { prompt_hints: style.promptHints, bpm_range: style.bpmRange, energy_curve: style.energyCurve },
    seed: Number.isInteger(seed) ? seed : null,
    narrated: Boolean(narrated)
  };
}

export function briefHash(brief) {
  return createHash("sha256").update(stableJson(brief)).digest("hex").slice(0, 16);
}

/** The range of story durations (ms) a track of lengthMs at bpm serves. */
export function lengthBucket(lengthMs, bpm) {
  return { min_story_ms: Math.max(0, Math.round(lengthMs - LOCK_MAX_EXTRA_BARS * barMs(bpm))), max_story_ms: Math.round(lengthMs - LOCK_MIN_TAIL_MS) };
}

export async function readMusicLock(project) {
  try {
    const lock = JSON.parse(await readFile(path.join(project, MUSIC_LOCK_FILE), "utf8"));
    return lock?.schema_version === MUSIC_LOCK_SCHEMA ? lock : null;
  } catch {
    return null;
  }
}

/**
 * Whether the lock serves this run.
 * → {reuse: true, lock} or {reuse: false, lock, reason, changed: [brief keys]}
 */
export function lockDecision(lock, { brief, durationMs, project, regenerate = false }) {
  if (regenerate) return { reuse: false, lock, reason: "--music-regenerate", changed: [] };
  if (!lock) return { reuse: false, lock: null, reason: "no music lock yet (first generation for this project)", changed: [] };
  const changed = Object.keys({ ...brief, ...lock.brief }).filter((key) => stableJson(brief[key]) !== stableJson(lock.brief?.[key]));
  if (changed.length) return { reuse: false, lock, reason: `the music brief changed (${changed.join(", ")})`, changed };
  const bucket = lock.length_bucket ?? lengthBucket(lock.length_ms, lock.bpm);
  if (durationMs > bucket.max_story_ms) return { reuse: false, lock, reason: `the story (${(durationMs / 1000).toFixed(2)} s) outgrew the locked track (serves up to ${(bucket.max_story_ms / 1000).toFixed(2)} s)`, changed: ["length"] };
  if (durationMs < bucket.min_story_ms) return { reuse: false, lock, reason: `the story (${(durationMs / 1000).toFixed(2)} s) is much shorter than the locked track (serves ${(bucket.min_story_ms / 1000).toFixed(2)} s and up)`, changed: ["length"] };
  if (!lock.file || !existsSync(path.join(project, lock.file))) return { reuse: false, lock, reason: `the locked file ${lock.file ?? "(none)"} is missing`, changed: [] };
  return { reuse: true, lock };
}

/**
 * Record a generated track: copy it into .launchclip/music/ (so the project
 * keeps it even if the user cache is cleared) and write the lock.
 */
export async function writeMusicLock(project, { brief, sourceFile, cacheKey, cacheFile = null, bpm, lengthMs, mode = null, songId = null, clock = () => new Date().toISOString() }) {
  const extension = path.extname(sourceFile) || ".mp3";
  const relFile = path.join(MUSIC_LOCK_DIR, `${cacheKey}${extension}`);
  await mkdir(path.join(project, MUSIC_LOCK_DIR), { recursive: true });
  if (path.resolve(sourceFile) !== path.resolve(project, relFile)) await copyFile(sourceFile, path.join(project, relFile));
  const lock = {
    schema_version: MUSIC_LOCK_SCHEMA,
    note: "finish reuses this track while the music brief is unchanged; scene timing only re-runs beat sync. Delete this file or pass --music-regenerate for a new (paid) track.",
    provider: brief.provider,
    request_hash: cacheKey,
    brief_hash: briefHash(brief),
    brief,
    file: relFile.split(path.sep).join("/"),
    cache_file: cacheFile,
    bpm,
    length_ms: lengthMs,
    length_bucket: lengthBucket(lengthMs, bpm),
    mode,
    song_id: songId,
    created_at: clock()
  };
  await writeFile(path.join(project, MUSIC_LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  return lock;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
