// Earshot sound effects (optional): `--sfx earshot` renders the cue sounds
// from Earshot's sound bank (https://github.com/Leonxlnx/earshot, MIT) instead
// of the kit or library files.
//
// Earshot is a separate Python tool, never a dependency: finish looks for it
// at run time ($LAUNCHCLIP_EARSHOT, else `earshot` on PATH) and, when it is
// missing, keeps the kit sounds with one warning. Only the bank is used: its
// sounds render from code recipes with no models and no network (`earshot sfx
// render`). Earshot's models, search and LLM features are never called.
//
// For each cue whose family has an Earshot mapping:
//   - one bank sound is picked for the family, in turn by time order, so a
//     repeated family walks its members before it repeats one (a repeat past
//     the members gets a new take: another noise seed);
//   - it is rendered (cached by id, length, apex, pitch and seed) and its
//     sync point lands on the cue's visual event: a hit's onset on the frame,
//     a whoosh's loudest moment on the cut, a riser's peak on its landing,
//     each moved by the role's offset (Earshot's launch-preset medians);
//   - its level matches the loudest 10 ms of the file it replaces (a short
//     window, so a 40 ms tick is weighed like a 140 ms one), within ±6 dB,
//     so the tuned mix levels (CUE_LEVELS, the duck) stay as they were.
// A take must pass the same timbre guard as kit and library files (no hiss,
// no noise wash under the voice, src/sfx/timbre.js): a refused take gives way
// to the family's next member, else the cue keeps its file.
// Families with no fitting bank sound (tally, typing, cash, door, ...) keep
// their kit or library file. Fitted bank sounds are recipes measured from
// CC0 recordings: finish lists their credits in AUDIO-MANIFEST.json.
import { execFile } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pinnedCache } from "../state_dirs.js";
import { hashOf, unitHash } from "./library.js";
import { measureTimbre, timbreProblem } from "./timbre.js";

const execFileAsync = promisify(execFile);

export const EARSHOT_HOME = "https://github.com/Leonxlnx/earshot";
// Bump when the render call or the placement changes what a cached file means.
export const EARSHOT_RENDER_SCHEMA = 1;
export const EARSHOT_PROJECT_DIR = path.join(".launchclip", "sfx-earshot");
// The default lead of a transition whoosh: bindCues starts it this long before the cut (CUE_DURATIONS.whoosh * 0.35).
export const TRANSITION_WHOOSH_LEAD = 0.217;
// A take is matched to the file it replaces within these gains (±6 dB): a
// bigger gap means the sounds differ in kind, and the bank's level is kept nearer.
const MIN_MATCH = 0.5;
const MAX_MATCH = 2;
// The level-matching window: short enough for the shortest ticks.
export const LEVEL_WINDOW_S = 0.01;

// LaunchClip family → Earshot bank sounds. align: the take's sync point
// (onset, or its loudest moment for air and builds); offset_ms: where that
// point sits against the event (Earshot's launch-preset medians: whoosh peaks
// land ~37 ms after the cut, pop-in thumps ~30 ms after); dur/apex: a shaped
// length and peak time for whooshes (the bank's own otherwise); octave: a
// pitched member is tuned to the music bed's key in this octave.
export const EARSHOT_FAMILIES = Object.freeze({
  whoosh: { ids: ["whoosh_fast/crisp", "whoosh_fast/tight", "whoosh_big/thump_airy", "whoosh_fast/sleeve"], align: "peak", offset_ms: 37, dur: 0.6, apex: 0.22 },
  swipe: { ids: ["swipe/flick", "swish/soft", "swipe/glide"], align: "peak", offset_ms: 20, dur: 0.45, apex: 0.16 },
  slide: { ids: ["swipe/paper", "swipe/cloth"], align: "peak", offset_ms: 20, dur: 0.6, apex: 0.2 },
  "page-turn": { ids: ["swipe/paper"], align: "peak", offset_ms: 0, dur: 0.6, apex: 0.2 },
  // Hits peak within ~60 ms of their onset: the pro_impact members swell for ~180 ms first, so they are left out.
  impact: { ids: ["cut_hit/punch", "cut_hit/kick", "cut_hit/sub"], align: "onset", offset_ms: 0 },
  thud: { ids: ["pro_pop_in/round", "pro_pop_in/deep", "knock/desk"], align: "onset", offset_ms: 30 },
  subdrop: { ids: ["sub_drop/808", "sub_drop/punch"], align: "onset", offset_ms: 0 },
  riser: { ids: ["riser/dark", "pro_riser/air_gate"], align: "peak", offset_ms: 0 },
  shimmer: { ids: ["pro_shimmer/m3", "pro_shimmer/m1"], align: "onset", offset_ms: 0 },
  sparkle: { ids: ["mallet/flourish", "pro_shimmer/m3"], align: "onset", offset_ms: 0 },
  // The bank's own ticks (pro_hover_tick, most hover_tick) are airy 7-9 kHz
  // ticks, 70-99% of their energy above 5 kHz: the timbre guard refuses them
  // under a voice, so ticks, clicks and snaps take the members that pass.
  tick: { ids: ["hover_tick/mid", "fit/tick/domino", "click/double"], align: "onset", offset_ms: 0 },
  click: { ids: ["pro_click/mouse", "click/soft", "fit/click/floss_lid"], align: "onset", offset_ms: 0 },
  snap: { ids: ["toggle/latch", "toggle/on", "toggle/off"], align: "onset", offset_ms: 0 },
  pop: { ids: ["ui_pop/soft", "ui_pop/boop", "pro_pop/bloop", "fit/pop/lip_pop"], align: "onset", offset_ms: 4 },
  "camera-shutter": { ids: ["shutter/dslr", "shutter/quick"], align: "onset", offset_ms: 0 },
  chime: { ids: ["mallet/celesta", "notify/mid_tine"], align: "onset", offset_ms: 0 },
  ding: { ids: ["pro_notify/ding_2045", "pro_notify/ding_1930"], align: "onset", offset_ms: 0 },
  ping: { ids: ["mallet/glock", "pro_notify/ding_2296"], align: "onset", offset_ms: 0 },
  notification: { ids: ["notify/mid_wood", "notify/mid_tine"], align: "onset", offset_ms: 0 },
  success: { ids: ["mallet/up4", "mallet/flourish"], align: "onset", offset_ms: 0 },
  glitch: { ids: ["glitch/mid", "glitch/chirp"], align: "onset", offset_ms: 0 },
  "tape-stop": { ids: ["downlifter/tape"], align: "onset", offset_ms: 0 }
});

// Pitched bank members and the octave their key note sits in (their default pitch's octave).
export const EARSHOT_PITCHED = Object.freeze({
  "mallet/celesta": 5, "mallet/flourish": 5, "mallet/glock": 6, "mallet/up4": 6, "notify/mid_tine": 5, "notify/mid_wood": 5
});

// The bank's fitted sounds: recipes measured from CC0 1.0 recordings on
// Freesound (Earshot docs/CREDITS_FIT.md). CC0 asks for no attribution; the
// recordists are credited anyway.
export const EARSHOT_FIT_CREDITS = Object.freeze({
  "fit/bell/small_bell": { recording: "Small Bell #2", recordist: "steffcaffrey", freesound: 452379 },
  "fit/click/floss_lid": { recording: "Plastic Clicks.flac", recordist: "qubodup", freesound: 167829 },
  "fit/hit/bamboo_tok": { recording: "Bamboo hit", recordist: "michorvath", freesound: 386888 },
  "fit/key.space/thock_space": { recording: "Keychron k10 space_bar", recordist: "Sadiquecat", freesound: 789630 },
  "fit/key/lubed": { recording: "Keyboard typing sounds: Unidentified Technics keyboard", recordist: "zrrion", freesound: 665075 },
  "fit/key/medium": { recording: "mechanical key medium.wav", recordist: "bigmonmulgrew", freesound: 378084 },
  "fit/key/thock": { recording: "Keychron k10 A to + individual keys", recordist: "Sadiquecat", freesound: 789628 },
  "fit/land.light/finger_phone": { recording: "Finger Tapping Phone", recordist: "jentlemen", freesound: 704862 },
  "fit/land.light/finger_wood": { recording: "finger tap table counter wood various.wav", recordist: "kyles", freesound: 452621 },
  "fit/land.light/fingertip_book": { recording: "Light Footsteps On Book", recordist: "IENBA", freesound: 760337 },
  "fit/pop/lip_pop": { recording: "Pop sound", recordist: "deraj", freesound: 202230 },
  "fit/pop/mouth_plop": { recording: "Mouth Plops.wav", recordist: "CapsLok", freesound: 181907 },
  "fit/snap/switch_flip": { recording: "Switch Flip #1", recordist: "IanStarGem", freesound: 278205 },
  "fit/tick/domino": { recording: "Domino pieces hit", recordist: "Macif", freesound: 329098 },
  "fit/whoosh.short/bamboo_swish": { recording: "Short Whoosh, 13x", recordist: "Kinoton", freesound: 427979 }
});

/** The credit line for a fitted bank sound, or null for a code recipe. */
export function earshotCredit(id) {
  const fit = EARSHOT_FIT_CREDITS[id];
  if (!fit) return null;
  return { id, recording: fit.recording, recordist: fit.recordist, source: `https://freesound.org/s/${fit.freesound}/`, license: "CC0-1.0", note: "Earshot fit: a recipe measured from the recording; no samples ship" };
}

function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The earshot executable: $LAUNCHCLIP_EARSHOT, else `earshot` on PATH; null when neither exists. */
export function findEarshot(env = process.env) {
  if (env?.LAUNCHCLIP_EARSHOT) return executable(env.LAUNCHCLIP_EARSHOT) ? path.resolve(env.LAUNCHCLIP_EARSHOT) : null;
  for (const dir of String(env?.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, "earshot");
    if (executable(file)) return file;
  }
  return null;
}

/** $LAUNCHCLIP_CACHE/earshot, else ~/.cache/launchclip/earshot. */
export function earshotCacheDir(env = process.env) {
  return pinnedCache("earshot") ?? (env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "earshot") : path.join(os.homedir(), ".cache", "launchclip", "earshot"));
}

/** The family's mapping, or null when Earshot has nothing that fits it. */
export function earshotFamily(family) {
  return EARSHOT_FAMILIES[family] ?? null;
}

/** "D#" + "mallet/glock" → "D#6"; null for an unpitched sound or no key. */
export function earshotPitch(id, key) {
  const octave = EARSHOT_PITCHED[id];
  const note = String(key ?? "").trim().match(/^([A-Ga-g])([#b]?)/);
  if (!octave || !note) return null;
  return `${note[1].toUpperCase()}${note[2]}${octave}`;
}

/**
 * When a cue's visual event happens: a transition whoosh starts `lead` s
 * before its cut, a riser lands on lands_at, every other cue is on its frame.
 */
export function cueEventTime(cue, { lead = TRANSITION_WHOOSH_LEAD } = {}) {
  if (cue.cue === "riser" && Number.isFinite(Number(cue.lands_at))) return Number(cue.lands_at);
  if (cue.source === "transition") return round3(Number(cue.at) + lead);
  return Number(cue.at);
}

/**
 * The render request for every cue Earshot can sound: [{index, family, id,
 * dur, apex, pitch, seed, event_at, align, offset_ms}]. Members are taken in
 * turn per family (time order, starting from a story-seeded member); a turn
 * past the members asks for a new take (a seed).
 */
export function planEarshotCues(cues, { storyId = "", key = null, lead = TRANSITION_WHOOSH_LEAD } = {}) {
  const order = cues.map((cue, index) => ({ cue, index })).sort((a, b) => a.cue.at - b.cue.at);
  const turns = new Map();
  const plan = [];
  for (const { cue, index } of order) {
    if (cue.source === "typing") continue;
    const family = earshotFamily(cue.cue);
    if (!family) continue;
    const turn = turns.get(cue.cue) ?? 0;
    turns.set(cue.cue, turn + 1);
    const start = Math.floor(unitHash(`${storyId}|earshot|${cue.cue}`) * family.ids.length);
    const id = family.ids[(start + turn) % family.ids.length];
    const round = Math.floor(turn / family.ids.length);
    plan.push({
      index,
      family: cue.cue,
      id,
      dur: family.dur ?? null,
      apex: family.apex ?? null,
      pitch: earshotPitch(id, key),
      seed: round > 0 ? Math.floor(unitHash(`${storyId}|${id}|${round}`) * 2 ** 31) : null,
      event_at: cueEventTime(cue, { lead }),
      align: family.align,
      offset_ms: family.offset_ms
    });
  }
  return plan.sort((a, b) => a.index - b.index);
}

/** The cache key of one render. */
export function earshotRenderKey({ id, dur = null, apex = null, pitch = null, seed = null }) {
  return hashOf(JSON.stringify({ provider: "earshot", schema: EARSHOT_RENDER_SCHEMA, id, dur, apex, pitch, seed })).slice(0, 24);
}

/** The `earshot sfx render` arguments for one request. */
export function earshotRenderArgs({ id, dur = null, apex = null, pitch = null, seed = null }, out) {
  const args = ["sfx", "render", id, "-o", out, "--json"];
  if (dur != null) args.push("--dur", String(dur));
  if (apex != null) args.push("--apex", String(apex));
  if (pitch != null) args.push("--pitch", String(pitch));
  if (seed != null) args.push("--seed", String(seed));
  return args;
}

/**
 * Where a take plays: its sync point (onset, or peak for align "peak") on
 * the event moved by offset_ms. A take that would start before 0 starts at 0
 * with its head trimmed (offset), so the sync point still lands.
 * Returns {at, offset, sync_at}.
 */
export function placeEarshotTake(entry, meta) {
  const point = entry.align === "peak" ? Number(meta?.peak_s) : Number(meta?.onset_s);
  const into = Number.isFinite(point) && point > 0 ? point : 0;
  const syncAt = Number(entry.event_at) + (Number(entry.offset_ms) || 0) / 1000;
  const start = syncAt - into;
  return start >= 0 ? { at: round3(start), offset: 0, sync_at: round3(syncAt) } : { at: 0, offset: round3(-start), sync_at: round3(syncAt) };
}

/** Gain that brings a take's loudest window to the replaced file's, clamped; 1 when either is unknown. */
export function matchGain(referenceDb, takeDb) {
  if (!Number.isFinite(referenceDb) || !Number.isFinite(takeDb)) return 1;
  return Math.min(MAX_MATCH, Math.max(MIN_MATCH, 10 ** ((referenceDb - takeDb) / 20)));
}

/** Loudest `window` s RMS of a file in dBFS (mono sum), via ffmpeg decode. */
export async function loudestWindowDb(file, { window = LEVEL_WINDOW_S } = {}) {
  const { decodeAudio } = await import("./process.js");
  const { channels, sampleRate } = await decodeAudio(file);
  const frames = channels[0].length;
  const win = Math.max(1, Math.round(sampleRate * window));
  const hop = Math.max(1, Math.round(win / 4));
  let best = 0;
  for (let start = 0; start < Math.max(1, frames - win + 1); start += hop) {
    let sum = 0;
    const end = Math.min(frames, start + win);
    for (let i = start; i < end; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i];
      sample /= channels.length;
      sum += sample * sample;
    }
    best = Math.max(best, sum / Math.max(1, end - start));
  }
  return best > 0 ? 10 * Math.log10(best) : -Infinity;
}

/** Why a take may not play under a voice (timbre.js), or null. */
export async function takeTimbreProblem(family, file) {
  const { decodeAudio } = await import("./process.js");
  const { channels, sampleRate } = await decodeAudio(file);
  return timbreProblem(family, measureTimbre(channels, sampleRate));
}

/** Run `earshot sfx render` and return {meta} from its JSON. */
export async function runEarshotRender(bin, request, out) {
  const { stdout } = await execFileAsync(bin, earshotRenderArgs(request, out), { maxBuffer: 1 << 24, timeout: 120000 });
  const result = JSON.parse(String(stdout));
  return { meta: result.meta ?? {} };
}

/**
 * One take as a project file: the project copy, then the cache, then a render.
 * Returns {file, key, meta, cached}.
 */
export async function earshotTake(request, { bin, project, cacheDir, render = runEarshotRender }) {
  const key = earshotRenderKey(request);
  const projectFile = path.join(project, EARSHOT_PROJECT_DIR, `${key}.wav`);
  const projectMeta = projectFile.replace(/\.wav$/, ".json");
  if (existsSync(projectFile) && existsSync(projectMeta)) return { file: projectFile, key, meta: JSON.parse(await readFile(projectMeta, "utf8")), cached: true };
  const cacheFile = path.join(cacheDir, `${key}.wav`);
  const cacheMeta = cacheFile.replace(/\.wav$/, ".json");
  let cached = true;
  if (!existsSync(cacheFile) || !existsSync(cacheMeta)) {
    cached = false;
    await mkdir(cacheDir, { recursive: true });
    let rendered;
    try {
      rendered = await render(bin, request, cacheFile);
    } catch (error) {
      // A pitch the recipe cannot take is not worth losing the sound over.
      if (request.pitch == null) throw error;
      rendered = await render(bin, { ...request, pitch: null }, cacheFile);
    }
    await writeFile(cacheMeta, `${JSON.stringify({ request, ...pick(rendered.meta) }, null, 2)}\n`);
  }
  await mkdir(path.dirname(projectFile), { recursive: true });
  await copyFile(cacheFile, projectFile);
  await copyFile(cacheMeta, projectMeta);
  return { file: projectFile, key, meta: JSON.parse(await readFile(projectMeta, "utf8")), cached };
}

function pick(meta = {}) {
  const out = {};
  for (const name of ["id", "seed", "sr", "onset_s", "peak_s", "end_s", "dur_s", "peak_db", "lufs_m_max"]) if (meta[name] !== undefined) out[name] = meta[name];
  if (meta.checks) out.checks_ok = Boolean(meta.checks.ok);
  return out;
}

/**
 * Give the cues Earshot takes. Returns {cues, rendered: [{at, event_at,
 * sync_at, family, id, ...}], refused: [{id, family, problem}], credits,
 * warnings}. A cue Earshot cannot sound (no mapping, failed renders, every
 * member refused by the timbre guard) keeps its file; a missing binary keeps all.
 */
export async function applyEarshotSounds(cues, { project, env = process.env, bin = findEarshot(env), storyId = "", key = null, lead = TRANSITION_WHOOSH_LEAD, cacheDir = earshotCacheDir(env), render = runEarshotRender, level = loudestWindowDb, timbre = takeTimbreProblem } = {}) {
  const out = cues.map((cue) => ({ ...cue }));
  const warnings = [];
  const rendered = [];
  const credits = new Map();
  if (!bin) return { cues: out, rendered, refused: [], credits: [], warnings: ["sfx: --sfx earshot needs the earshot tool (uv tool install earshot from github.com/Leonxlnx/earshot); using the kit sounds"] };
  const plan = planEarshotCues(out, { storyId, key, lead });
  const takes = new Map();
  const refused = [];
  const takeFor = async (request) => {
    const renderKey = earshotRenderKey(request);
    if (!takes.has(renderKey)) {
      let take;
      try {
        take = await earshotTake(request, { bin, project, cacheDir, render });
        const problem = await timbre(request.family, take.file).catch(() => null);
        if (problem) take = { refused: problem };
      } catch (error) {
        take = { error: String(error?.message ?? error).split("\n")[0] };
      }
      takes.set(renderKey, take);
    }
    return takes.get(renderKey);
  };
  for (const planned of plan) {
    const cue = out[planned.index];
    // The planned member first, then the family's others in order.
    const ids = EARSHOT_FAMILIES[planned.family].ids;
    const order = [planned.id, ...ids.slice(ids.indexOf(planned.id) + 1), ...ids.slice(0, ids.indexOf(planned.id))];
    let entry = null;
    let take = null;
    const problems = [];
    for (const id of order) {
      const request = id === planned.id ? planned : { ...planned, id, pitch: earshotPitch(id, key) };
      const candidate = await takeFor(request);
      if (candidate.error || candidate.refused) {
        problems.push(`${id}: ${candidate.error ?? candidate.refused}`);
        if (candidate.refused && !refused.some((item) => item.id === id)) refused.push({ id, family: planned.family, problem: candidate.refused });
        continue;
      }
      entry = request;
      take = candidate;
      break;
    }
    if (!take) {
      warnings.push(`sfx: earshot had no usable take for ${cue.cue} at ${cue.at}s (${problems.join("; ")}); kept the ${cue.sfx_source ?? "kit"} sound`);
      continue;
    }
    const reference = cue.file && existsSync(cue.file) ? await level(cue.file).catch(() => null) : null;
    const own = await level(take.file).catch(() => null);
    const gain = matchGain(reference, own);
    const placed = placeEarshotTake(entry, take.meta);
    const { offset: _drop, ...rest } = cue;
    out[entry.index] = {
      ...rest,
      at: placed.at,
      ...(placed.offset > 0 ? { offset: placed.offset } : {}),
      volume: round3(cue.volume * gain),
      file: take.file,
      sfx_source: "earshot",
      sfx_origin: EARSHOT_FIT_CREDITS[entry.id] ? "earshot-fit" : "earshot",
      variant: null,
      replaced: cue.file ? path.basename(cue.file) : cue.cue,
      earshot: { id: entry.id, key: take.key, event_at: entry.event_at, sync_at: placed.sync_at, align: entry.align, ...(entry.pitch ? { pitch: entry.pitch } : {}), ...(entry.seed != null ? { seed: entry.seed } : {}) },
      intent: `${cue.intent ?? ""} → earshot ${entry.id}`.trim()
    };
    rendered.push({ at: placed.at, event_at: entry.event_at, sync_at: placed.sync_at, family: entry.family, id: entry.id, align: entry.align, pitch: entry.pitch, seed: entry.seed, gain: round3(gain), cached: take.cached, file: path.relative(project, take.file) });
    const credit = earshotCredit(entry.id);
    if (credit) credits.set(entry.id, credit);
  }
  return { cues: out, rendered, refused, credits: [...credits.values()], warnings };
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
