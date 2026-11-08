// Event sound design: give the moments that matter a sound that fits what is
// on screen ("coins dropping onto a table", "a rubber stamp pressed onto
// paper") instead of the kit's generic pop or impact.
//
//   --sfx generated  the accent cues the pace pass kept get a described sound,
//                    generated once with ElevenLabs sound effects (PAID) and
//                    reused from the cache and the project lock after that;
//   --sfx kit        the kit and library cues, as before (the default without
//                    ELEVENLABS_API_KEY);
//   --sfx earshot    the cue sounds rendered from Earshot's sound bank when the
//                    earshot tool is installed (src/sfx/earshot.js; free,
//                    offline), else the kit;
//   --sfx off        no sound effects.
//
// What a cue should sound like comes from rules over the cue's event name,
// the scene's on-screen words and the narration around it; a `describe`
// adapter (a model) may name the ones the rules cannot. Only accent cues are
// considered (hits and module events: pops, impacts, ticks, counts), never
// transitions, risers or typing, and at most one generated cue per
// GENERATED_EVERY seconds. A cue with no description, or whose generation
// fails, keeps its kit file. Every generated file is loudness-matched to the
// kit cue it replaces, lands its peak on the event frame, and sits a little
// lower when it falls inside a spoken word.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pinnedCache } from "../state_dirs.js";
import { findEarshot } from "./earshot.js";
import { hashOf } from "./library.js";
import { generateSoundEffect } from "./seed.js";
import { integratedLoudness, processFile } from "./process.js";

export const SFX_MODES = Object.freeze(["generated", "kit", "off", "earshot"]);
export const EVENT_SOUND_MODEL = "eleven_text_to_sound_v2";
export const EVENT_SOUND_FORMAT = "mp3_44100_128";
// The repository's estimate for ElevenLabs sound effects: about 40 credits per
// generated second at roughly $0.22 per 1,000 credits. Check your own plan.
export const USD_PER_SFX_SECOND = 0.009;
// At most one generated cue per this many seconds of video (and at least 2).
export const GENERATED_EVERY = 6;
export const MAX_GENERATED = 12;
export const EVENT_LOCK_FILE = path.join(".launchclip", "sfx-events-lock.json");
export const EVENT_LOCK_DIR = path.join(".launchclip", "sfx-events");
export const EVENT_LOCK_SCHEMA = "launchclip.sfx-events-lock.v1";
// Kit families a described sound may replace: accents, not air or texture.
const ACCENT_FAMILIES = new Set(["pop", "impact", "tick", "thud", "subdrop", "tally", "shimmer", "sparkle", "slide"]);
// A generated sound lands its peak on the event, but starts no more than this early.
const MAX_PRE_ROLL = 0.12;
// Under a spoken word a described sound sits about 3 dB lower.
const UNDER_SPEECH_GAIN = 0.7;

/** "generated" | "kit" | "off" from a flag value; throws on anything else. */
export function parseSfxMode(value) {
  if (value == null || value === "") return null;
  const mode = String(value).toLowerCase();
  if (!SFX_MODES.includes(mode)) throw new Error(`--sfx must be ${SFX_MODES.join(", ")}; got ${value}`);
  return mode;
}

/**
 * The mode a run uses: the flag, else generated with a key and kit without
 * one. earshot falls back to kit when the earshot tool is not installed
 * (`earshot`: its path, found at run time).
 */
export function resolveSfxMode(flag, env = process.env, { fallback = "kit", earshot = findEarshot } = {}) {
  const mode = parseSfxMode(flag);
  const keyed = Boolean(env?.ELEVENLABS_API_KEY);
  if (mode === "generated" && !keyed) return { mode: "kit", warning: "sfx: --sfx generated needs ELEVENLABS_API_KEY; using the kit sounds" };
  if (mode === "earshot") {
    const bin = earshot(env);
    return bin ? { mode, earshot: bin } : { mode: "kit", warning: "sfx: --sfx earshot needs the earshot tool on PATH (or $LAUNCHCLIP_EARSHOT); install it with: uv tool install \"earshot @ git+https://github.com/Leonxlnx/earshot\"; using the kit sounds" };
  }
  if (mode) return { mode };
  return { mode: fallback === "generated" && !keyed ? "kit" : fallback };
}

// [pattern, description, seconds]. The first rule that matches the event name,
// then the scene's words, then the narration around the cue, names the sound.
// Descriptions are concrete, single-event and music-free, so a short
// generation reads as one clean hit.
const COUNT_EVENT = /\b(count|tally|ticker|odometer|counter|increment|number)\b/;
export const EVENT_SOUND_RULES = Object.freeze([
  [/\b(slot|jackpot|casino|spin)\b/, "slot machine reels spinning briefly then stopping with a mechanical clunk", 1.6],
  [/\b(stamp|stamped|approved|denied|rejected|banned|verified|certified)\b/, "single heavy rubber stamp pressed hard onto a sheet of paper on a desk", 0.8],
  [/\b(lock|locked|unlock|padlock|secure|security|vault|safe)\b/, "single metal padlock snapping shut, close and crisp", 0.6],
  [/(\$|€|£)|\b(coins?|cash|money|dollars?|price|cost|paid|pay|budget|revenue|profit|savings?|fee|fines?|invoice)\b/, "a small handful of metal coins dropping onto a wooden table", 1],
  [/\b(crowd|cheer|cheering|fans|audience|applause|celebrate|party)\b/, "short burst of a small crowd cheering and clapping", 1.5],
  [/\b(door|doors|enter|entrance|inside|walk in)\b/, "heavy wooden door swinging open with a short creak", 1.2],
  [/\b(hammer|nail|nails|timber|decking|plank|planks|joist|joists|framing|carpentry)\b/, "single hammer strike driving a nail into a timber plank", 0.7],
  [/\b(drill|screw|screws|bolt|bolts)\b/, "short burst of a cordless drill driving a screw into wood", 1],
  [/\b(saw|cut|cutting)\b/, "short pass of a handsaw cutting through a wooden board", 1],
  [/\b(phone|notification|notifications|dm|dms|comment|comments|inbox)\b/, "single soft phone notification chime", 0.6],
  [/\b(camera|photo|photos|picture|snapshot)\b/, "single camera shutter click", 0.5],
  [/\b(check|checked|checklist|done|complete|completed|tick|ticked)\b/, "single satisfying pen tick on paper, close and dry", 0.5],
  [/\b(clock|deadline|timer|countdown)\b/, "old clock ticking twice then a soft bell ding", 1.2],
  [/\b(water|rain|wet|wash|clean|cleaning|splash|pool)\b/, "short single splash of water", 0.8],
  [/\b(fire|burn|burning|hot|heat|flame)\b/, "match striking and catching fire", 1],
  [/\b(car|truck|ute|drive|engine|road)\b/, "car engine starting and revving briefly", 1.5],
  [/\b(card|cards|drop|drops|land|lands|stack|stacked|pile|paperwork|document|documents)\b/, "a thick card dropping onto a stack of paper on a desk", 0.6],
  [/\b(click|button|tap|select|selected|switch|toggle)\b/, "single satisfying mechanical button click", 0.5]
]);

/** Words on screen for a scene: every string under its params (titles, labels, lines), lower case. */
export function sceneWords(scene, { limit = 600 } = {}) {
  const out = [];
  const walk = (value, depth) => {
    if (out.join(" ").length > limit || depth > 5) return;
    if (typeof value === "string") {
      if (!/^(assets\/|https?:|#|\.\/)/.test(value) && !/\.(mp4|png|jpe?g|webp|wav|mp3|svg)$/i.test(value)) out.push(value);
    } else if (Array.isArray(value)) for (const item of value) walk(item, depth + 1);
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) if (!["src", "file", "media", "font", "color", "colors", "id"].includes(key)) walk(item, depth + 1);
  };
  walk(scene?.params, 0);
  return out.join(" ").toLowerCase().slice(0, limit);
}

/** The narration words from `before` s before to `after` s after a time, lower case. */
export function wordsAround(words, at, { before = 1, after = 1.5 } = {}) {
  return (Array.isArray(words) ? words : [])
    .filter((word) => Number(word.end ?? word.endTime) >= at - before && Number(word.start ?? word.startTime) <= at + after)
    .map((word) => String(word.word ?? word.text ?? ""))
    .join(" ")
    .toLowerCase();
}

/** {prompt, seconds, rule, from} for a cue, or null when no rule names its sound. */
export function describeCueSound(cue, { scene = null, words = [] } = {}) {
  const event = String(cue.event ?? "").toLowerCase().replace(/[-_]/g, " ");
  const onScreen = sceneWords(scene);
  const said = wordsAround(words, Number(cue.at));
  for (const [from, text] of [["event", event], ["screen", onScreen], ["narration", said]]) {
    if (!text) continue;
    for (const [index, [pattern, prompt, seconds]] of EVENT_SOUND_RULES.entries()) {
      if (!pattern.test(text)) continue;
      // A count of money ticks like a register; any other count like a counter.
      if (cue.cue === "tally" || COUNT_EVENT.test(event)) {
        return /coins|money/.test(prompt)
          ? { prompt: "mechanical cash register counter clicking up quickly then a bright bell ding", seconds: 1.4, rule: index, from }
          : { prompt: "mechanical counter wheels clicking up quickly then stopping with a soft clunk", seconds: 1.2, rule: index, from };
      }
      return { prompt, seconds, rule: index, from };
    }
  }
  // A count with no subject still deserves a counter, not a pop.
  if (cue.cue === "tally" || COUNT_EVENT.test(event)) return { prompt: "mechanical counter wheels clicking up quickly then stopping with a soft clunk", seconds: 1.2, rule: null, from: "event" };
  return null;
}

/** How many cues may get a generated sound in a video this long. */
export function generatedBudget(duration) {
  const seconds = Number(duration);
  if (!(seconds > 0)) return 2;
  return Math.max(2, Math.min(MAX_GENERATED, Math.ceil(seconds / GENERATED_EVERY)));
}

/**
 * Which paced cues get a described sound: accent cues from hits first, then
 * module events, earliest first, no two closer than GENERATED_EVERY / 2 s,
 * up to the budget. `describe` (optional, async) names the sounds the rules
 * cannot: it gets [{id, event, family, on_screen, narration}] and returns
 * {id: {prompt, seconds}}. Returns [{index, cue, prompt, seconds, from}].
 */
export async function planEventSounds(cues, { story = null, words = [], duration, describe = null } = {}) {
  const scenes = new Map((Array.isArray(story?.scenes) ? story.scenes : []).map((scene) => [scene.id, scene]));
  const candidates = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => ACCENT_FAMILIES.has(cue.cue) && (cue.source === "hit" || cue.source === "module-event"));
  const rank = ({ cue }) => (cue.source === "hit" ? 0 : 1);
  candidates.sort((a, b) => rank(a) - rank(b) || a.cue.at - b.cue.at);
  const budget = generatedBudget(duration ?? story?.resolved?.duration);
  const spacing = GENERATED_EVERY / 2;
  const chosen = [];
  const unnamed = [];
  for (const candidate of candidates) {
    if (chosen.length + unnamed.length >= budget) break;
    if ([...chosen, ...unnamed].some((other) => Math.abs(other.cue.at - candidate.cue.at) < spacing)) continue;
    const scene = scenes.get(candidate.cue.shot) ?? null;
    const sound = describeCueSound(candidate.cue, { scene, words });
    if (sound) chosen.push({ ...candidate, ...sound });
    else if (describe) unnamed.push({ ...candidate, scene });
  }
  if (unnamed.length && describe) {
    let named = {};
    try {
      named = (await describe(unnamed.map(({ cue, index, scene }) => ({ id: String(index), event: cue.event ?? null, family: cue.cue, on_screen: sceneWords(scene, { limit: 240 }), narration: wordsAround(words, cue.at) })))) ?? {};
    } catch {
      named = {};
    }
    for (const entry of unnamed) {
      const sound = named[String(entry.index)];
      const prompt = typeof sound?.prompt === "string" ? sound.prompt.trim().slice(0, 200) : "";
      if (!prompt) continue;
      const seconds = Math.min(2, Math.max(0.5, Number(sound.seconds) || 1));
      chosen.push({ index: entry.index, cue: entry.cue, prompt, seconds, rule: null, from: "model" });
    }
  }
  return chosen.sort((a, b) => a.cue.at - b.cue.at);
}

/** $LAUNCHCLIP_CACHE/elevenlabs/sfx-events, else ~/.cache/launchclip/elevenlabs/sfx-events. */
export function eventSoundCacheDir(env = process.env) {
  return pinnedCache("elevenlabs/sfx-events") ?? (env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "elevenlabs", "sfx-events") : path.join(os.homedir(), ".cache", "launchclip", "elevenlabs", "sfx-events"));
}

/** The cache and lock key of one described sound. */
export function eventSoundHash({ prompt, seconds, model = EVENT_SOUND_MODEL, format = EVENT_SOUND_FORMAT }) {
  return hashOf(JSON.stringify({ provider: "elevenlabs", kind: "sfx-event", model, format, prompt, seconds })).slice(0, 32);
}

export function estimateEventSoundCost(seconds) {
  return Math.round(Math.max(0.5, Number(seconds) || 1) * USD_PER_SFX_SECOND * 10000) / 10000;
}

async function readLock(project) {
  try {
    const lock = JSON.parse(await readFile(path.join(project, EVENT_LOCK_FILE), "utf8"));
    return lock?.schema_version === EVENT_LOCK_SCHEMA && lock.sounds ? lock : { schema_version: EVENT_LOCK_SCHEMA, sounds: {} };
  } catch {
    return { schema_version: EVENT_LOCK_SCHEMA, sounds: {} };
  }
}

/**
 * One described sound as a processed project file: the project lock first,
 * then the cache, then a PAID generation. Returns {file, hash, cached, locked,
 * cost_usd, measurements}. Throws when generation fails.
 */
export async function eventSoundFile({ prompt, seconds }, { project, env = process.env, cacheDir = eventSoundCacheDir(env), lock, generate = generateSoundEffect, fetch, notice } = {}) {
  const hash = eventSoundHash({ prompt, seconds });
  const locked = lock?.sounds?.[hash];
  const projectFile = path.join(project, EVENT_LOCK_DIR, `${hash}.wav`);
  if (locked && existsSync(projectFile)) return { file: projectFile, hash, cached: true, locked: true, cost_usd: 0, measurements: locked.measurements ?? null };
  const cacheFile = path.join(cacheDir, `${hash}.mp3`);
  let cost = 0;
  let cached = true;
  if (!existsSync(cacheFile)) {
    cached = false;
    cost = estimateEventSoundCost(seconds);
    notice?.(`sfx: PAID ElevenLabs sound effect "${prompt}" (${seconds} s, about $${cost})`);
    const audio = await generate({ text: prompt, durationSeconds: seconds, promptInfluence: 0.7, modelId: EVENT_SOUND_MODEL, outputFormat: EVENT_SOUND_FORMAT, apiKey: env.ELEVENLABS_API_KEY, ...(fetch ? { fetch } : {}) });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFile, audio);
  }
  await mkdir(path.dirname(projectFile), { recursive: true });
  const processed = await processFile(cacheFile, projectFile, "event").catch((error) => ({ ok: false, reason: error.message }));
  if (!processed.ok) {
    // Unprocessable audio still plays: copy it as is rather than lose the take.
    await copyFile(cacheFile, projectFile.replace(/\.wav$/, ".mp3"));
    return { file: projectFile.replace(/\.wav$/, ".mp3"), hash, cached, locked: false, cost_usd: cost, measurements: null };
  }
  return { file: projectFile, hash, cached, locked: false, cost_usd: cost, measurements: processed.measurements ?? null };
}

/**
 * Where and how loud a described sound plays in place of a kit cue: its peak
 * on the event (pre-roll at most MAX_PRE_ROLL), its loudness matched to the
 * kit file it replaces, and UNDER_SPEECH_GAIN lower inside a spoken word.
 */
export function placeEventSound(cue, { measurements = null, kitLufs = null, words = [] } = {}) {
  const peak = Number(measurements?.peak_at_ms);
  const preRoll = Number.isFinite(peak) && peak > 0 ? Math.min(MAX_PRE_ROLL, peak / 1000) : 0;
  const lufs = Number(measurements?.loudness_lufs);
  const match = Number.isFinite(lufs) && Number.isFinite(Number(kitLufs)) ? Math.min(2, Math.max(0.25, 10 ** ((Number(kitLufs) - lufs) / 20))) : 1;
  const speaking = (Array.isArray(words) ? words : []).some((word) => Number(word.start ?? word.startTime) <= cue.at && cue.at <= Number(word.end ?? word.endTime));
  const volume = Math.round(cue.volume * match * (speaking ? UNDER_SPEECH_GAIN : 1) * 1000) / 1000;
  return { at: Math.round(Math.max(0, cue.at - preRoll) * 1000) / 1000, volume, pre_roll: Math.round(preRoll * 1000) / 1000, under_speech: speaking };
}

/**
 * Give the planned cues their generated files. Returns {cues, generated:
 * [{at, shot, event, prompt, seconds, from, hash, cached, cost_usd}], cost_usd,
 * warnings}; a cue whose sound cannot be had keeps its kit file.
 */
export async function applyEventSounds(cues, plan, { project, env = process.env, words = [], cacheDir, generate, fetch, notice, loudness = integratedLoudness } = {}) {
  const out = cues.map((cue) => ({ ...cue }));
  const warnings = [];
  const generated = [];
  if (!plan.length) return { cues: out, generated, cost_usd: 0, warnings };
  const lock = await readLock(project);
  const byPrompt = new Map();
  for (const entry of plan) {
    const key = `${entry.prompt}|${entry.seconds}`;
    let sound = byPrompt.get(key);
    if (!sound) {
      try {
        sound = await eventSoundFile(entry, { project, env, cacheDir, lock, generate, fetch, notice });
      } catch (error) {
        sound = { error: String(error?.message ?? error).split("\n")[0] };
      }
      byPrompt.set(key, sound);
      if (!sound.error) lock.sounds[sound.hash] = { prompt: entry.prompt, seconds: entry.seconds, file: path.relative(project, sound.file), measurements: sound.measurements };
    }
    const cue = out[entry.index];
    if (sound.error) {
      warnings.push(`sfx: the generated sound for ${cue.cue} at ${cue.at}s ("${entry.prompt}") failed (${sound.error}); kept the kit sound`);
      continue;
    }
    const kitLufs = cue.file && existsSync(cue.file) ? await loudness(cue.file, 2000).catch(() => null) : null;
    const placed = placeEventSound(cue, { measurements: sound.measurements, kitLufs, words });
    out[entry.index] = { ...cue, ...placed, file: sound.file, sfx_source: "generated", sfx_origin: "elevenlabs", replaced: cue.cue, prompt: entry.prompt, intent: `${cue.intent ?? ""} → "${entry.prompt}"`.trim() };
    generated.push({ at: placed.at, shot: cue.shot ?? null, event: cue.event ?? null, replaced: cue.cue, prompt: entry.prompt, seconds: entry.seconds, from: entry.from, hash: sound.hash, cached: sound.cached, locked: sound.locked, cost_usd: generated.some((item) => item.hash === sound.hash) ? 0 : sound.cost_usd });
  }
  await mkdir(path.join(project, ".launchclip"), { recursive: true });
  await writeFile(path.join(project, EVENT_LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  const cost = Math.round(generated.reduce((sum, item) => sum + item.cost_usd, 0) * 10000) / 10000;
  return { cues: out, generated, cost_usd: cost, warnings };
}
