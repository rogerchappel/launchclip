// launchclip finish <project>: storyboard project → finished, mastered,
// checked video in one command (STORYBOARD_ENGINE_RFC.md §10 phase 1).
//
//   voice → validate → captions → sound → render → master → evidence → gates → report
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
import { resolveModule } from "../kit/core/modules.mjs";
import { buildTemporalEvidenceSchedule, validateTemporalEvidenceManifest } from "./cinematic_evidence.js";
import { cinematicMotionExpectations } from "./cinematic_check.js";
import { VERSION } from "./doctor.js";
import { analyzeProductionAudio } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { getRenderer, resolveRendererName } from "./renderers/index.js";
import { remotionInvocation } from "./renderers/remotion.js";
import { deriveBoundaries, resolveStory, storyFormat } from "./story.js";
import { validateStory } from "./story_cli.js";
import { hasExactFile, readStoryEdl } from "./story_loader.js";
import { hyperframesInvocation } from "./toolchain.js";
import { getVoiceProvider, listVoiceProviders } from "./voice/index.js";
import { normalizeLoudness } from "./voice/supplied.js";

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
  hyperframes: ".launchclip/finish/hyperframes",
  voice: "assets/audio/narration.wav",
  words: "NARRATION.json",
  captions: "assets/captions/captions.json",
  kit: "assets/audio/kit",
  mix: "assets/audio/mix.wav",
  cues: "assets/audio/cues.json",
  sfxManifest: "qa/sfx.json",
  audioManifest: "AUDIO-MANIFEST.json",
  evidence: "qa/temporal-evidence/manifest.json",
  gates: "qa/finish/gates.json",
  motion: "qa/finish/motion.json",
  audio: "qa/finish/audio.json",
  report: "finish.json"
});

// ---------------------------------------------------------------------------
// Sound design: hits and module events → SFX cues, scene energy → music bed.

// The procedural kit's cues (synth-audio-kit.mjs SFX) and their mix levels.
export const CUE_LEVELS = Object.freeze({ impact: 0.55, subdrop: 0.5, whoosh: 0.4, riser: 0.35, shimmer: 0.35, pop: 0.35, tick: 0.3 });
export const CUE_DURATIONS = Object.freeze({ whoosh: 0.62, impact: 1.3, riser: 1.4, tick: 0.14, pop: 0.2, shimmer: 1.6, subdrop: 1.8 });
const CUE_SPACING = 0.12;
const WHOOSH_TRANSITIONS = new Set(["push", "whip", "zoom"]);
const EVENT_CUES = [
  [/riser|rise|build|count|tension/, "riser"],
  [/impact|slam|stamp|lock|headline|reveal-hard|hit|plunge/, "impact"],
  [/whoosh|push|whip|zoom|swipe|pan|transition|flow/, "whoosh"],
  [/shimmer|insight|resolve|equilibrium|sparkle/, "shimmer"],
  [/subdrop|drop|payoff|final|outro/, "subdrop"],
  [/tick|settle|step|row|bar|term|value|data|land/, "tick"]
];

/** Default cue for an event name or role that declares none. */
export function defaultCueFor(event) {
  const name = String(event ?? "").toLowerCase();
  return EVENT_CUES.find(([pattern]) => pattern.test(name))?.[1] ?? "pop";
}

/**
 * "whoosh-soft" → {cue: "whoosh", gain: 0.6}; unknown base names → null.
 * Modifiers: -soft (quieter), -short (a shorter variant; same kit file).
 */
export function kitCue(name) {
  const [base, ...modifiers] = String(name ?? "").toLowerCase().split("-");
  if (!Object.hasOwn(CUE_LEVELS, base)) return null;
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
 * event it names, else a default from its event name) and to every module
 * event that carries a `cue`, plus a whoosh under push/whip/zoom transitions.
 * Risers end on their moment. Cues of the same kind closer than 0.12 s merge
 * (hits win). Returns {cues: [{cue, at, volume, shot, intent, source, event}], warnings}.
 */
export function bindCues(story, { models } = {}) {
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
      const name = hit.cue ?? event?.cue ?? defaultCueFor(hit.event);
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
    cues.push({ cue: kit.cue, at, volume: round3(CUE_LEVELS[kit.cue] * kit.gain), shot: entry.shot, intent: `${entry.source} ${entry.event}`, source: entry.source, event: entry.event });
  }
  cues.sort((a, b) => a.at - b.at || a.cue.localeCompare(b.cue));
  return { cues, warnings };
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
  const tempo = energy < 1 ? 84 : energy < 2 ? 96 : energy < 2.5 ? 108 : 116;
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

/** audio.music → {kind: "synth"|"file"|"none", file?, bpm?, key?}. Absent means synth. */
export function musicSpec(audio) {
  const music = audio?.music;
  if (music === undefined || music === null || music === "synth") return { kind: "synth" };
  if (music === "none" || music === false) return { kind: "none" };
  if (typeof music === "string") return { kind: "file", file: music };
  if (music.source === "synth") return { kind: "synth", bpm: music.bpm, key: music.key };
  return { kind: "file", file: music.source, bpm: music.bpm, key: music.key };
}

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
  return (Array.isArray(story?.overlays) ? story.overlays : []).find((overlay) => overlay?.type === "captions" && overlay.style !== "none") ?? null;
}

// ---------------------------------------------------------------------------
// Default adapters (each can be replaced in tests)

function defaultAdapters() {
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
    async synthKit(outDir, bed) {
      const args = [SCRIPT.synth, outDir];
      if (bed) args.push("--bed", String(bed.seconds), "--bpm", String(bed.bpm), "--key", String(bed.key), "--kick-from", String(bed.kick_from), "--kick-to", String(bed.kick_to));
      await execFileAsync(process.execPath, args, { maxBuffer: 1 << 26 });
      return JSON.parse(await readFile(path.join(outDir, "AUDIO-KIT.json"), "utf8"));
    },
    async buildMix(options) {
      const { buildMix, normalizeCues } = await import(SCRIPT.mix);
      const cues = normalizeCues(options.cues, options.sfxDir);
      buildMix({ voice: options.voice, music: options.music, cues, duration: options.duration, out: options.out, musicVolume: options.musicVolume });
      return { cues };
    },
    async master(input, output, target) {
      const { masterLoudness } = await import(SCRIPT.master);
      return masterLoudness(input, output, target);
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
    audio: (video, manifest, options) => analyzeProductionAudio(video, manifest, options)
  };
}

// ---------------------------------------------------------------------------
// Pipeline

/**
 * options: {renderer, quality: "draft"|"high", voice: provider name, out, force}
 * adapters: any of defaultAdapters() to replace.
 * Returns the finish.json report; it never throws for a stage failure (the
 * report's status is "failed"), only for an unreadable project.
 */
export async function runFinish(projectPath, options = {}, adapterOverrides = {}) {
  const adapters = { ...defaultAdapters(), ...adapterOverrides };
  const project = path.resolve(projectPath);
  const storyFile = path.join(project, "storyboard.json");
  if (!hasExactFile(project, "storyboard.json")) throw new Error(`launchclip finish needs ${storyFile}; author storyboard.json first`);
  const story = await readJson(storyFile, "storyboard.json");
  const quality = String(options.quality ?? "draft").toLowerCase();
  if (!["draft", "high"].includes(quality)) throw new Error(`--quality must be draft or high; got ${options.quality}`);
  if (options.voice != null && !listVoiceProviders().includes(String(options.voice).toLowerCase())) throw new Error(`Unknown --voice ${options.voice}. Available providers: ${listVoiceProviders().join(", ")}`);
  const rendererName = resolveRendererName(project, options.renderer);
  const out = projectFile(project, options.out ?? (quality === "high" ? "renders/final.mp4" : "renders/draft.mp4"));
  const started = adapters.now();
  const ctx = {
    project,
    story,
    copy: buildFinishCopy(story),
    adapters,
    options: { ...options, quality },
    rendererName,
    quality,
    out,
    raw: path.join(project, ".launchclip", "finish", `render-${quality}.mp4`),
    state: await readState(project),
    warnings: [],
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
    const entry = await runStage(ctx, definition);
    stages.push(entry);
    if (entry.status === "failed") failed = entry.name;
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
      const decision = plan.always ? { action: "run", reason: plan.always } : stageDecision(previous, { inputHash: plan.inputHash, outputs }, { force: ctx.options.force });
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
      const request = { text: narration.text, provider, voice: narration.voice ?? null, speed: narration.speed ?? 1 };
      if (provider === "supplied") request.source = supplied ? await fileHash(path.join(ctx.project, supplied)) : null;
      return { inputHash: hashValue(request), outputs: [PATHS.voice, PATHS.words], request };
    },
    async run(ctx, { request }) {
      const provider = ctx.adapters.voiceProvider(request.provider, {});
      const outFile = path.join(ctx.project, PATHS.voice);
      await mkdir(path.dirname(outFile), { recursive: true });
      const synthesis = { text: request.text, voice: request.voice ?? undefined, speed: request.speed, outFile };
      if (request.provider === "supplied" && ctx.story.audio?.voice) synthesis.source = path.join(ctx.project, ctx.story.audio.voice);
      const result = await provider.synthesize(synthesis);
      if (!result || !Array.isArray(result.words) || !result.words.length) throw new Error(`voice provider "${request.provider}" returned no word timings`);
      const produced = path.resolve(result.file ?? outFile);
      if (produced !== outFile) await copyFile(produced, outFile);
      // Synthesised voices arrive at their engine's level (Kokoro is about
      // -22 LUFS), which leaves too little voice-to-music margin in the mix.
      // Bring them to the -17 LUFS supplied voiceovers already get.
      let loudness = null;
      // The offline "test" voice is a placeholder tone and needs no levelling.
      if (request.provider !== "supplied" && request.provider !== "test") {
        const normalized = `${outFile}.norm.wav`;
        loudness = await ctx.adapters.normalizeVoice(outFile, normalized);
        await rename(normalized, outFile);
      }
      const words = result.words.map((word) => ({ text: String(word.text), start: round3(Number(word.start)), end: round3(Number(word.end)) }));
      const duration = round3(Number(result.duration ?? words.at(-1).end));
      await writeJson(path.join(ctx.project, PATHS.words), {
        schema_version: "launchclip.narration.v1",
        provider: request.provider,
        voice: request.voice,
        speed: request.speed,
        text: request.text,
        sample_rate: result.sampleRate ?? null,
        duration_seconds: duration,
        words
      });
      const format = storyFormat(ctx.copy);
      if (Number.isFinite(format.duration) && duration > format.duration + 0.05) ctx.warnings.push(`narration runs ${duration}s, longer than format.duration (${format.duration}s); the end is cut off`);
      const details = { provider: request.provider, voice: request.voice, speed: request.speed, loudness, duration_seconds: duration, word_count: words.length, voice_file: PATHS.voice, words_file: PATHS.words };
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
      // Footage-led: base.edl (the edit-recording plan) becomes base.trim.
      ctx.edl = await readStoryEdl(ctx.project, ctx.copy);
      const resolved = resolveStory(ctx.copy, { words: ctx.words ?? [], beats: ctx.beats, edl: ctx.edl });
      const second = validateStory(resolved);
      if (!second.ok) throw new Error(`resolved storyboard is invalid:\n- ${second.errors.join("\n- ")}`);
      ctx.warnings.push(...second.warnings);
      ctx.resolved = resolved;
      ctx.boundaries = deriveBoundaries(resolved);
      const { checkLayoutProject } = await import("./layout_check.js");
      const layout = await checkLayoutProject(ctx.project, { story: ctx.copy, words: ctx.words ?? [] });
      ctx.layout = { status: layout.status, profile: layout.profile, errors: layout.errors, elements: layout.elements, warnings: layout.warnings, findings: layout.findings };
      ctx.warnings.push(...layout.warnings.map((message) => `layout: ${message}`));
      await writeResolvedCopy(ctx);
      const details = { scenes: resolved.scenes.length, boundaries: ctx.boundaries.length, words: ctx.words?.length ?? 0, layout: { status: layout.status, profile: layout.profile, errors: layout.errors, warnings: layout.findings.filter((finding) => finding.severity !== "error").length } };
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
      const music = musicSpec(audio);
      const bound = sfxOn ? bindCues(ctx.resolved) : { cues: [], warnings: [] };
      const voice = audio.voice && existsSync(path.join(ctx.project, audio.voice)) ? audio.voice : null;
      if (!bound.cues.length && music.kind === "none") return { skip: voice ? "no SFX or music: the voice is mounted directly" : "no voice, SFX or music to mix" };
      if (music.kind === "file" && !existsSync(path.join(ctx.project, music.file))) throw new Error(`audio.music file not found: ${music.file}`);
      const bed = music.kind === "synth" ? chooseBed(ctx.resolved, music) : music.kind === "file" ? { ...chooseBed(ctx.resolved, music), file: music.file } : null;
      const inputHash = hashValue({
        cues: bound.cues,
        bed,
        music_file: music.kind === "file" ? await fileHash(path.join(ctx.project, music.file)) : null,
        voice: voice ? await fileHash(path.join(ctx.project, voice)) : null,
        duration: ctx.resolved.resolved.duration,
        scripts: [await fileHash(SCRIPT.synth), await fileHash(SCRIPT.mix)]
      });
      return { inputHash, outputs: [PATHS.mix, PATHS.audioManifest, PATHS.sfxManifest], cues: bound.cues, cueWarnings: bound.warnings, bed, music, voice };
    },
    async run(ctx, plan) {
      ctx.warnings.push(...plan.cueWarnings);
      const kitDir = path.join(ctx.project, PATHS.kit);
      const synthBed = plan.music.kind === "synth" ? plan.bed : null;
      const kitKey = hashValue({ bed: synthBed, script: await fileHash(SCRIPT.synth) });
      const previousKit = ctx.state.stages?.sound?.details?.kit_key;
      let kitReused = previousKit === kitKey && existsSync(path.join(kitDir, "AUDIO-KIT.json")) && (!synthBed || existsSync(path.join(kitDir, "music", "bed.wav")));
      if (!kitReused) await ctx.adapters.synthKit(kitDir, synthBed);
      const musicFile = plan.music.kind === "synth" ? path.join(kitDir, "music", "bed.wav") : plan.music.kind === "file" ? path.join(ctx.project, plan.music.file) : null;
      const voiceFile = plan.voice ? path.join(ctx.project, plan.voice) : null;
      const mixFile = path.join(ctx.project, PATHS.mix);
      await writeJson(path.join(ctx.project, PATHS.cues), plan.cues);
      const mixed = await ctx.adapters.buildMix({ voice: voiceFile, music: musicFile, cues: plan.cues, sfxDir: path.join(kitDir, "sfx"), duration: ctx.resolved.resolved.duration, out: mixFile, musicVolume: plan.bed?.volume ?? 0.42 });
      const placed = mixed?.cues ?? plan.cues.map((cue) => ({ ...cue, file: path.join(kitDir, "sfx", `${cue.cue}.wav`) }));
      const sfxManifest = path.join(ctx.project, PATHS.sfxManifest);
      // Same shape build-mix.mjs --sfx-manifest writes; cinematic-check reads it through AUDIO-MANIFEST.json.
      await writeJson(sfxManifest, { cues: placed.map((cue, i) => ({ id: `sfx-${String(i + 1).padStart(2, "0")}-${cue.cue}`, cue: cue.cue, shot_id: cue.shot ?? null, at_seconds: cue.at, volume: cue.volume, intent: cue.intent ?? "", file: path.resolve(cue.file) })) });
      await writeJson(path.join(ctx.project, PATHS.audioManifest), {
        schema_version: "launchclip.audio-manifest.v1",
        generated_by: "launchclip finish",
        mix: { path: mixFile, duration_seconds: ctx.resolved.resolved.duration, ducking: voiceFile && musicFile ? "sidechain under voice" : null },
        voiceover: voiceFile ? { path: voiceFile, provider: ctx.state.stages?.voice?.details?.provider ?? "supplied" } : null,
        music: musicFile ? { path: musicFile, source: plan.music.kind, volume: plan.bed.volume, bpm: plan.bed.bpm, key: plan.bed.key, kick_from: plan.bed.kick_from, kick_to: plan.bed.kick_to, energy: plan.bed.energy } : null,
        sfx_manifest: sfxManifest,
        sfx_kit: path.join(kitDir, "AUDIO-KIT.json"),
        license: "Original procedural synthesis (synth-audio-kit.mjs); no third-party samples."
      });
      const details = {
        mix_file: PATHS.mix,
        cues: plan.cues.length,
        cue_sources: countBy(plan.cues, "source"),
        bed: plan.bed,
        voice: Boolean(voiceFile),
        kit_key: kitKey,
        kit_reused: kitReused
      };
      STAGES[3].restore(ctx, details);
      return details;
    },
    restore(ctx, details) {
      ctx.copy = buildFinishCopy(ctx.copy, { mix: details.mix_file ?? PATHS.mix });
    }
  },
  {
    name: "render",
    async plan(ctx) {
      const resolved = resolveStory(ctx.copy, { words: ctx.words ?? [], beats: ctx.beats ?? null, edl: ctx.edl ?? null });
      ctx.resolved = resolved;
      await writeResolvedCopy(ctx);
      const assets = {};
      for (const asset of collectAssets(resolved)) assets[asset] = await fileHash(path.join(ctx.project, asset));
      const missing = Object.entries(assets).filter(([, hash]) => hash === null).map(([asset]) => asset);
      if (missing.length) ctx.warnings.push(`referenced assets not found: ${missing.join(", ")}`);
      const inputHash = hashValue({ renderer: ctx.rendererName, quality: ctx.quality, story: resolved, assets, words: ctx.words, version: VERSION, kit: await treeFingerprint(path.join(ROOT, "kit")), projectEntry: await fileHash(path.join(ctx.project, "remotion", "entry.tsx")) });
      return { inputHash, outputs: [rel(ctx.project, ctx.raw)] };
    },
    async run(ctx) {
      const adapter = ctx.adapters.renderer(ctx.rendererName);
      await mkdir(path.dirname(ctx.raw), { recursive: true });
      if (ctx.rendererName === "hyperframes") {
        const hfDir = path.join(ctx.project, PATHS.hyperframes);
        const compiled = await ctx.adapters.compileHyperFrames(ctx.resolved, { projectDir: hfDir, sourceDir: ctx.project });
        ctx.warnings.push(...(compiled?.warnings ?? []).filter((message) => !ctx.warnings.includes(message)).map((message) => `hyperframes: ${message}`));
        await adapter.render(hfDir, ctx.raw, { quality: ctx.quality });
        return { renderer: "hyperframes", compiled: PATHS.hyperframes, raw: rel(ctx.project, ctx.raw) };
      }
      await adapter.render(ctx.project, ctx.raw, { quality: ctx.quality, story: ctx.resolved });
      return { renderer: "remotion", raw: rel(ctx.project, ctx.raw) };
    }
  },
  {
    name: "master",
    async plan(ctx) {
      return { inputHash: hashValue({ raw: await fileHash(ctx.raw), target: LOUDNESS_TARGET, script: await fileHash(SCRIPT.master) }), outputs: [rel(ctx.project, ctx.out)] };
    },
    async run(ctx) {
      await mkdir(path.dirname(ctx.out), { recursive: true });
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
  },
  {
    name: "evidence",
    async plan(ctx) {
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
      const inputHash = hashValue({
        video: await fileHash(ctx.out),
        evidence: await fileHash(path.join(ctx.project, PATHS.evidence)),
        audio_manifest: await fileHash(path.join(ctx.project, PATHS.audioManifest)),
        layout: ctx.layout,
        story: ctx.resolved,
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

// The renderer-neutral gates cinematic-check runs, minus the critic: layout
// (geometric, from the validate stage), loudness (master), motion and audio
// analysis of the final MP4, and the temporal evidence manifest.
async function runGates(ctx) {
  const format = storyFormat(ctx.resolved);
  const duration = Number(ctx.resolved.resolved?.duration ?? format.duration);
  const gates = {};
  gates.layout = ctx.layout
    ? { status: ctx.layout.status === "failed" ? "failed" : "passed", profile: ctx.layout.profile, errors: ctx.layout.errors, findings: ctx.layout.findings.slice(0, 20) }
    : { status: "skipped", reason: "layout check did not run" };

  const master = ctx.state.stages?.master?.details;
  gates.loudness = !master
    ? { status: "skipped", reason: "master did not run" }
    : master.mastered === false
      ? { status: "skipped", reason: master.reason }
      : { status: master.loudness?.compliant ? "passed" : "failed", target: master.loudness?.target, output: master.loudness?.output };

  try {
    const motion = await ctx.adapters.motion(ctx.out, path.join(ctx.project, PATHS.motion), { expected: cinematicMotionExpectations({ duration, width: format.width, height: format.height }).expected });
    gates.motion = { status: motion?.quality?.ok ? "passed" : "failed", report: PATHS.motion, findings: (motion?.quality?.findings ?? []).slice(0, 12) };
  } catch (error) {
    gates.motion = { status: "failed", error: error.message };
  }

  try {
    const manifest = existsSync(path.join(ctx.project, PATHS.audioManifest)) ? path.join(ctx.project, PATHS.audioManifest) : null;
    const audio = await ctx.adapters.audio(ctx.out, manifest, { musicVolume: ctx.state.stages?.sound?.details?.bed?.volume ?? 0.15 });
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

  gates.critic = {
    status: "pending",
    reason: "finish does not produce critic receipts",
    next_step: `Have a fresh-context critic review qa/critic-sheets/ and write qa/critic.json (citing the qa/temporal-evidence IDs), then run: launchclip cinematic-check ${ctx.project} --renderer ${ctx.rendererName} --video ${rel(ctx.project, ctx.out)} --expect-audio`
      + (ctx.rendererName === "hyperframes" && !hasExactFile(ctx.project, "index.html") ? ` (HyperFrames checks need the compiled index.html; finish compiled it to ${PATHS.hyperframes})` : "")
  };
  return gates;
}

function buildReport(ctx, stages, { seconds, failed }) {
  const gates = ctx.gates ?? {};
  const gateStatuses = Object.values(gates).map((gate) => gate.status);
  const status = failed ? "failed" : gateStatuses.includes("failed") ? "needs-repair" : "ready-for-review";
  const nextSteps = [];
  if (failed) {
    const entry = stages.find((stage) => stage.name === failed);
    nextSteps.push(`Fix the ${failed} stage (${firstLine(entry?.error)}) and run launchclip finish again; finished stages are reused.`);
  } else {
    for (const [name, gate] of Object.entries(gates)) if (gate.status === "failed") nextSteps.push(`Repair the ${name} gate (see ${gate.report ?? PATHS.gates}).`);
    if (gates.critic?.next_step) nextSteps.push(gates.critic.next_step);
  }
  return {
    schema_version: FINISH_REPORT_VERSION,
    status,
    project: ctx.project,
    story: path.join(ctx.project, "storyboard.json"),
    resolved_copy: PATHS.copy,
    renderer: ctx.rendererName,
    quality: ctx.quality,
    voice: ctx.state.stages?.voice?.details?.provider && stages.find((stage) => stage.name === "voice")?.status !== "skipped" ? ctx.state.stages.voice.details.provider : null,
    final: !failed && existsSync(ctx.out) ? ctx.out : null,
    output: ctx.out,
    seconds,
    stages,
    gates,
    warnings: [...new Set(ctx.warnings)],
    next_steps: nextSteps,
    finished_at: ctx.adapters.clock()
  };
}

/** Human summary of a finish report. */
export function formatFinishSummary(report) {
  const lines = [`launchclip finish: ${report.status} (${report.renderer}, ${report.quality}, ${report.seconds}s)`];
  for (const stage of report.stages) {
    const note = stage.error ? firstLine(stage.error) : stage.reason ?? "";
    lines.push(`  ${stage.name.padEnd(9)} ${stage.status.padEnd(8)} ${String(stage.seconds).padStart(7)}s  ${note}`.trimEnd());
  }
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
// Helpers

async function writeResolvedCopy(ctx) {
  await writeJson(path.join(ctx.project, PATHS.copy), ctx.copy);
  if (ctx.resolved) await writeJson(path.join(ctx.project, PATHS.resolved), ctx.resolved);
}

async function loadWords(project, story) {
  const file = typeof story?.audio?.words === "string" ? path.join(project, story.audio.words) : null;
  if (!file || !existsSync(file)) return null;
  const words = narrationWords(await readJson(file, story.audio.words));
  return words.map((word) => ({ text: String(word.text ?? word.word ?? ""), start: Number(word.start), end: Number(word.end) }));
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
