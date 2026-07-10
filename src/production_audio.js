import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { ElevenLabsMediaProvider, LocalSfxLibrary } from "./production_media.js";
import { PRODUCTION_PATHS } from "./production_contracts.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

export async function produceAudio(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const [intake, plan, evidence] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.plan)),
    readOptionalJson(path.join(workspace, PRODUCTION_PATHS.evidence), { items: [] })
  ]);
  const mediaDir = path.join(workspace, "production", "media");
  const inputHash = semanticHash({ intake, plan, evidence, options: safeOptions(options), audio: "production-audio.v1" });
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  if (store.get("creative-plan")?.status !== "succeeded") throw new Error("Creative plan job must succeed before audio production");
  const jobId = "production-audio";
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) return cachedResult(workspace, verification);
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) {
    await store.markStaleFrom([jobId]);
  }
  const current = store.get(jobId);
  if (!current) await store.add({ id: jobId, kind: "production-audio", depends_on: ["creative-plan"], input_hash: inputHash });
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId);
  else if (current.status !== "pending") throw new Error(`Audio job is already ${current.status}`);
  await store.markRunning(jobId);

  try {
    await mkdir(mediaDir, { recursive: true });
    const needsProvider = (!options.noVoice && plan.narration.source === "generated") || !options.noMusic;
    const provider = adapters.provider ?? (needsProvider ? new ElevenLabsMediaProvider() : null);
    let [voiceover, music, sfx] = await Promise.all([
      prepareVoiceover({ mediaDir, intake, evidence, plan, options, provider, probeDuration: adapters.probeDuration ?? probeDuration }),
      prepareMusic({ mediaDir, plan, options, provider }),
      prepareSfx({ mediaDir, plan, options, library: adapters.sfxLibrary })
    ]);
    const warnings = [];
    const notes = [];
    if (voiceover?.duration_seconds) {
      const drift = voiceover.duration_seconds - plan.format.duration_seconds;
      if (Math.abs(drift) > Math.max(0.75, plan.format.duration_seconds * 0.03)) {
        if (voiceover.provider === "elevenlabs") {
          voiceover = await (adapters.conformNarration ?? conformNarration)(voiceover, plan.format.duration_seconds);
          notes.push(`Narration was conformed by ${drift.toFixed(2)}s to preserve the approved shot timeline.`);
        } else {
          warnings.push(`Supplied narration duration differs from the planned timeline by ${drift.toFixed(2)}s; plan to the supplied word timeline before rendering.`);
        }
      }
    }
    const manifest = {
      schema_version: "launchclip.production-audio.v1",
      created_at: new Date().toISOString(),
      voiceover,
      music,
      sfx_manifest: sfx?.manifest ?? null,
      notes,
      warnings
    };
    const manifestPath = path.join(mediaDir, "manifest.json");
    await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const outputPaths = [manifestPath, voiceover?.path, voiceover?.words_path, music?.path, sfx?.manifest, ...(sfx?.cues ?? []).map((cue) => cue.path)].filter(Boolean);
    const outputs = await Promise.all(outputPaths.map((filePath) => describeJobOutput(workspace, filePath)));
    await store.markSucceeded(jobId, outputs);
    return { stage: "production-audio", status: warnings.length ? "needs-retiming" : "ready", workspace, manifest: manifestPath, voiceover: voiceover?.path ?? null, music: music?.path ?? null, sfx: sfx?.manifest ?? null, notes, warnings, cached: false };
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

async function prepareVoiceover({ mediaDir, intake, evidence, plan, options, provider, probeDuration }) {
  if (options.noVoice) return null;
  if (plan.narration.source === "supplied") {
    const supplied = intake.resources.find((entry) => entry.role === "voiceover" && !entry.is_remote);
    if (!supplied) throw new Error("Supplied narration plan has no local voiceover resource");
    const target = path.join(mediaDir, `voiceover${path.extname(supplied.location).toLowerCase() || ".mp3"}`);
    if (path.resolve(supplied.location) !== path.resolve(target)) await copyFile(supplied.location, target);
    const transcriptEvidence = evidence.items?.find((entry) => entry.kind === "voiceover-transcript" && entry.role === "voiceover" && (!entry.provenance || path.resolve(entry.provenance) === path.resolve(supplied.location)));
    const automaticWords = transcriptEvidence?.metadata?.find((entry) => entry.key === "words_path")?.value;
    const sourceWords = options.words ? path.resolve(options.words) : automaticWords;
    const wordsPath = sourceWords ? path.join(mediaDir, "voiceover.words.json") : null;
    let words = [];
    if (wordsPath) {
      await copyFile(path.resolve(sourceWords), wordsPath);
      words = JSON.parse(await readFile(wordsPath, "utf8"));
    }
    const wordsDuration = Number(words.at(-1)?.end);
    const durationSeconds = Number.isFinite(wordsDuration) && wordsDuration > 0 ? wordsDuration : await probeDuration(target);
    return { provider: "supplied", kind: "narration", path: target, words_path: wordsPath, duration_seconds: durationSeconds, source_resource_id: supplied.id };
  }
  return provider.synthesizeNarration({
    text: plan.narration.full_text,
    voiceId: options.voiceId,
    modelId: options.voiceModel ?? "eleven_multilingual_v2",
    languageCode: plan.format.language,
    outputPath: path.join(mediaDir, "voiceover.mp3"),
    wordsPath: path.join(mediaDir, "voiceover.words.json")
  });
}

export async function conformNarration(voiceover, targetDuration, run = execFileAsync) {
  const originalDuration = Number(voiceover.duration_seconds);
  const target = Number(targetDuration);
  if (!(originalDuration > 0) || !(target > 0)) throw new Error("Narration conformance requires positive source and target durations");
  const ratio = originalDuration / target;
  const temporary = `${voiceover.path}.${process.pid}.conformed.mp3`;
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", voiceover.path, "-filter:a", atempoFilter(ratio), "-t", String(target), temporary]);
  await rename(temporary, voiceover.path);
  if (voiceover.words_path) {
    const words = JSON.parse(await readFile(voiceover.words_path, "utf8"));
    const scale = target / originalDuration;
    const conformed = words.map((word) => ({ ...word, start: round(Number(word.start) * scale), end: round(Number(word.end) * scale) }));
    await writeAtomic(voiceover.words_path, `${JSON.stringify(conformed, null, 2)}\n`);
  }
  return { ...voiceover, original_duration_seconds: originalDuration, duration_seconds: target, conformed: true, tempo_ratio: round(ratio) };
}

function atempoFilter(ratio) {
  const stages = [];
  let remaining = ratio;
  while (remaining > 2) { stages.push(2); remaining /= 2; }
  while (remaining < .5) { stages.push(.5); remaining /= .5; }
  stages.push(remaining);
  return stages.map((value) => `atempo=${round(value)}`).join(",");
}

async function probeDuration(filePath) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine supplied narration duration: ${filePath}`);
  return duration;
}

async function prepareMusic({ mediaDir, plan, options, provider }) {
  if (options.noMusic) return null;
  return provider.composeMusic({
    prompt: plan.audio.music_prompt,
    durationSeconds: plan.format.duration_seconds,
    modelId: options.musicModel ?? "music_v2",
    forceInstrumental: true,
    outputPath: path.join(mediaDir, "music.mp3")
  });
}

async function prepareSfx({ mediaDir, plan, options, library }) {
  if (options.noSfx) return null;
  const resolver = library ?? new LocalSfxLibrary(options.sfxDir ?? path.join(PACKAGE_ROOT, "public", "sfx"));
  const resolved = await resolver.resolvePlan(plan);
  const targetDir = path.join(mediaDir, "sfx");
  await mkdir(targetDir, { recursive: true });
  const cues = [];
  for (const [index, cue] of resolved.entries()) {
    const file = `${String(index + 1).padStart(3, "0")}-${slug(cue.id)}${path.extname(cue.path).toLowerCase()}`;
    const target = path.join(targetDir, file);
    await copyFile(cue.path, target);
    cues.push({ ...cue, path: target });
  }
  const manifest = path.join(mediaDir, "sfx.json");
  await writeAtomic(manifest, `${JSON.stringify({ schema_version: "launchclip.sfx-cues.v1", cues }, null, 2)}\n`);
  return { manifest, cues };
}

function safeOptions(options) {
  return {
    noVoice: Boolean(options.noVoice), noMusic: Boolean(options.noMusic), noSfx: Boolean(options.noSfx),
    voiceId: options.voiceId ?? null, voiceModel: options.voiceModel ?? null, musicModel: options.musicModel ?? null,
    sfxDir: options.sfxDir ? path.resolve(options.sfxDir) : null, words: options.words ? path.resolve(options.words) : null
  };
}

async function cachedResult(workspace, verification) {
  const mediaDir = path.join(workspace, "production", "media");
  const manifestPath = path.join(mediaDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return { stage: "production-audio", status: manifest.warnings.length ? "needs-retiming" : "ready", workspace, manifest: manifestPath, voiceover: manifest.voiceover?.path ?? null, music: manifest.music?.path ?? null, sfx: manifest.sfx_manifest, outputs: verification.outputs, notes: manifest.notes ?? [], warnings: manifest.warnings, cached: true };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJson(filePath, fallback) {
  try { return await readJson(filePath); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await rename(tempPath, filePath);
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sfx";
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
