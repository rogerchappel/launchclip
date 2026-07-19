import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  const cinematicNarration = intake.profile?.id === "cinematic"
    ? await readOptionalJson(path.join(workspace, "production", "media", "cinematic-narration.json"), null)
    : null;
  const mediaDir = path.join(workspace, "production", "media");
  const inputHash = semanticHash({ intake, plan, evidence, cinematicNarration, options: safeOptions(options), audio: "production-audio.v3" });
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  if (store.get("creative-plan")?.status !== "succeeded") throw new Error("Creative plan job must succeed before audio production");
  if (intake.profile?.id === "cinematic") {
    if (store.get("cinematic-narration")?.status !== "succeeded" || !cinematicNarration) throw new Error("Cinematic narration timing must succeed before final audio production");
    const timingVerification = await store.verifyOutputs("cinematic-narration");
    if (!timingVerification.ok) throw new Error("Cinematic narration timing artifacts are stale or corrupt");
    if (cinematicNarration.text_sha256 !== sha256(plan.narration.full_text)) throw new Error("Final plan narration does not match the measured cinematic performance");
  }
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
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash });
  else if (current.status === "running" || current.status === "submitted") {
    await store.markStaleFrom([jobId]);
    await store.retry(jobId, { inputHash });
  }
  else if (current.status !== "pending") throw new Error(`Audio job is already ${current.status}`);
  await store.markRunning(jobId);

  try {
    await mkdir(mediaDir, { recursive: true });
    const needsProvider = (!options.noVoice && plan.narration.source === "generated" && !cinematicNarration?.voiceover) || !options.noMusic;
    const provider = adapters.provider ?? (needsProvider ? new ElevenLabsMediaProvider() : null);
    let [voiceover, music, sfx] = await Promise.all([
      prepareVoiceover({ mediaDir, intake, evidence, plan, options: { ...options, preproducedNarration: cinematicNarration }, provider, probeDuration: adapters.probeDuration ?? probeDuration, combineAudio: adapters.combineAudio ?? combineAudioFiles }),
      prepareMusic({ mediaDir, plan, options, provider, combineAudio: adapters.combineAudio ?? combineAudioFiles }),
      prepareSfx({ mediaDir, plan, options, library: adapters.sfxLibrary })
    ]);
    const warnings = [];
    const notes = [];
    if (voiceover?.duration_seconds) {
      const drift = voiceover.duration_seconds - plan.format.duration_seconds;
      if (Math.abs(drift) > Math.max(0.75, plan.format.duration_seconds * 0.03)) {
        if (voiceover.provider === "elevenlabs" && intake.profile?.id !== "cinematic") {
          voiceover = await (adapters.conformNarration ?? conformNarration)(voiceover, plan.format.duration_seconds);
          notes.push(`Narration was conformed by ${drift.toFixed(2)}s to preserve the approved shot timeline.`);
        } else if (intake.profile?.id === "cinematic") {
          warnings.push(`Measured cinematic narration differs from the final plan by ${drift.toFixed(2)}s; regenerate the edit plan instead of time-stretching the performance.`);
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

export async function produceCinematicNarration(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const [intake, story, evidence] = await Promise.all([
    readJson(path.join(workspace, PRODUCTION_PATHS.intake)),
    readJson(path.join(workspace, PRODUCTION_PATHS.story)),
    readOptionalJson(path.join(workspace, PRODUCTION_PATHS.evidence), { items: [] })
  ]);
  if (intake.profile?.id !== "cinematic") throw new Error("Pre-plan narration timing requires the cinematic production profile");
  if (story.narration?.full_text == null) throw new Error("Cinematic story has no approved narration");
  const store = adapters.store ?? await ProductionJobStore.open(workspace, { create: false });
  if (store.get("retention-story")?.status !== "succeeded") throw new Error("Retention story job must succeed before cinematic narration timing");
  const inputHash = semanticHash({ intake, story, evidence, options: safeNarrationOptions(options), narration: "cinematic-narration.v1" });
  const jobId = "cinematic-narration";
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) return cachedCinematicNarration(workspace, verification);
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) {
    await store.markStaleFrom([jobId]);
  }
  const current = store.get(jobId);
  if (!current) await store.add({ id: jobId, kind: jobId, depends_on: ["retention-story"], input_hash: inputHash });
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash });
  else if (current.status === "running" || current.status === "submitted") {
    await store.markStaleFrom([jobId]);
    await store.retry(jobId, { inputHash });
  } else if (current.status !== "pending") throw new Error(`Cinematic narration job is already ${current.status}`);
  await store.markRunning(jobId);

  const mediaDir = path.join(workspace, "production", "media");
  const plan = { narration: story.narration, format: story.format };
  try {
    await mkdir(mediaDir, { recursive: true });
    const provider = !options.noVoice && story.narration.source === "generated"
      ? adapters.provider ?? new ElevenLabsMediaProvider()
      : adapters.provider ?? null;
    const voiceSettings = options.voiceSettings ?? cinematicVoiceSettings(story.narration.delivery);
    const voiceover = options.noVoice
      ? null
      : await prepareVoiceover({
          mediaDir,
          intake,
          evidence,
          plan,
          options: { ...options, voiceSettings },
          provider,
          probeDuration: adapters.probeDuration ?? probeDuration,
          combineAudio: adapters.combineAudio ?? combineAudioFiles
        });
    let words = voiceover?.words ?? (voiceover?.words_path ? await readOptionalJson(voiceover.words_path, []) : []);
    let timingSource = "measured";
    if (options.noVoice) {
      words = estimateStoryWords(story);
      timingSource = "editorial-estimate";
    } else if (!words.length) {
      throw new Error("Cinematic narration requires word-level timing; the narration provider returned no aligned words");
    }
    const wordDuration = Number(words.at(-1)?.end);
    const measuredDuration = voiceover?.duration_seconds ?? (Number.isFinite(wordDuration) && wordDuration > 0 ? wordDuration : story.format.duration_seconds);
    if (!(Number(measuredDuration) > 0)) throw new Error("Cinematic narration timing requires a positive duration");
    const manifest = {
      schema_version: "launchclip.cinematic-narration.v1",
      created_at: new Date().toISOString(),
      timing_source: timingSource,
      narration_source: story.narration.source,
      text_sha256: sha256(story.narration.full_text),
      duration_seconds: round(measuredDuration),
      target_duration_seconds: Number(story.format.duration_seconds),
      drift_seconds: round(measuredDuration - Number(story.format.duration_seconds)),
      word_count: words.length,
      words_path: voiceover?.words_path ?? null,
      words,
      pauses: narrationPauses(words),
      beat_timings: alignStoryBeats(story.narration.beats, words),
      delivery: story.narration.delivery,
      voice_settings: voiceover?.provider === "elevenlabs" ? voiceSettings : null,
      voiceover
    };
    const manifestPath = path.join(mediaDir, "cinematic-narration.json");
    await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const outputPaths = [manifestPath, voiceover?.path, voiceover?.words_path].filter(Boolean);
    const outputs = await Promise.all(outputPaths.map((filePath) => describeJobOutput(workspace, filePath)));
    await store.markSucceeded(jobId, outputs);
    return {
      stage: "cinematic-narration",
      status: "ready",
      workspace,
      manifest: manifestPath,
      voiceover: voiceover?.path ?? null,
      words: voiceover?.words_path ?? null,
      duration_seconds: manifest.duration_seconds,
      timing_source: timingSource,
      cached: false
    };
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

async function prepareVoiceover({ mediaDir, intake, evidence, plan, options, provider, probeDuration, combineAudio }) {
  if (options.noVoice) return null;
  if (options.preproducedNarration?.voiceover) return structuredClone(options.preproducedNarration.voiceover);
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
    let mediaDuration = null;
    try { mediaDuration = await probeDuration(target); }
    catch (error) {
      if (!(Number.isFinite(wordsDuration) && wordsDuration > 0)) throw error;
    }
    const durationSeconds = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : wordsDuration;
    return { provider: "supplied", kind: "narration", path: target, words_path: wordsPath, duration_seconds: durationSeconds, source_resource_id: supplied.id };
  }
  const chunks = splitNarrationText(plan.narration.full_text, Number(options.maxNarrationChars ?? 2_800));
  const outputPath = path.join(mediaDir, "voiceover.mp3");
  const wordsPath = path.join(mediaDir, "voiceover.words.json");
  if (chunks.length === 1) return provider.synthesizeNarration({
    text: chunks[0], voiceId: options.voiceId, modelId: options.voiceModel ?? "eleven_multilingual_v2",
    languageCode: plan.format.language, voiceSettings: options.voiceSettings, outputPath, wordsPath
  });

  const segments = [];
  try {
    for (const [index, text] of chunks.entries()) {
      const segment = await provider.synthesizeNarration({
        text,
        previousText: chunks[index - 1]?.slice(-1_000),
        nextText: chunks[index + 1]?.slice(0, 1_000),
        previousRequestIds: segments.map((entry) => entry.request_id).filter(Boolean).slice(-3),
        voiceId: options.voiceId,
        modelId: options.voiceModel ?? "eleven_multilingual_v2",
        languageCode: plan.format.language,
        voiceSettings: options.voiceSettings,
        outputPath: path.join(mediaDir, `voiceover-${String(index + 1).padStart(3, "0")}.mp3`),
        wordsPath: path.join(mediaDir, `voiceover-${String(index + 1).padStart(3, "0")}.words.json`)
      });
      segments.push(segment);
    }
    await combineAudio(segments.map((entry) => entry.path), outputPath);
    let offset = 0;
    const words = [];
    for (const segment of segments) {
      const segmentWords = Array.isArray(segment.words) ? segment.words : await readOptionalJson(segment.words_path, []);
      for (const word of segmentWords) words.push({ ...word, start: round(Number(word.start) + offset), end: round(Number(word.end) + offset) });
      offset += positiveDuration(segment.duration_seconds, "Narration segment");
    }
    await writeAtomic(wordsPath, `${JSON.stringify(words, null, 2)}\n`);
    return {
      provider: "elevenlabs", kind: "narration", path: outputPath, words_path: wordsPath, words,
      duration_seconds: offset, request_ids: segments.map((entry) => entry.request_id).filter(Boolean),
      model_id: options.voiceModel ?? "eleven_multilingual_v2", voice_id: options.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? null,
      segments: segments.map((entry, index) => ({ index: index + 1, characters: chunks[index].length, duration_seconds: entry.duration_seconds, request_id: entry.request_id ?? null }))
    };
  } finally {
    await Promise.all(segments.flatMap((entry) => [entry.path, entry.words_path]).filter(Boolean).map((entry) => rm(entry, { force: true })));
  }
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

async function prepareMusic({ mediaDir, plan, options, provider, combineAudio }) {
  if (options.noMusic) return null;
  const durations = splitLongDuration(plan.format.duration_seconds, 600);
  const outputPath = path.join(mediaDir, "music.mp3");
  if (durations.length === 1) return provider.composeMusic({
    prompt: plan.audio.music_prompt, durationSeconds: durations[0], modelId: options.musicModel ?? "music_v2",
    forceInstrumental: true, outputPath
  });
  const segments = [];
  try {
    for (const [index, durationSeconds] of durations.entries()) {
      const continuity = ` Long-form segment ${index + 1} of ${durations.length}; preserve the same musical identity and make both boundaries join cleanly.`;
      segments.push(await provider.composeMusic({
        prompt: `${String(plan.audio.music_prompt).slice(0, 4_100 - continuity.length)}${continuity}`, durationSeconds,
        modelId: options.musicModel ?? "music_v2", forceInstrumental: true,
        outputPath: path.join(mediaDir, `music-${String(index + 1).padStart(3, "0")}.mp3`)
      }));
    }
    await combineAudio(segments.map((entry) => entry.path), outputPath);
    return {
      provider: "elevenlabs", kind: "music", path: outputPath, duration_seconds: Number(plan.format.duration_seconds),
      model_id: options.musicModel ?? "music_v2", prompt: plan.audio.music_prompt,
      request_ids: segments.map((entry) => entry.request_id).filter(Boolean), song_ids: segments.map((entry) => entry.song_id).filter(Boolean),
      segments: segments.map((entry, index) => ({ index: index + 1, duration_seconds: durations[index], request_id: entry.request_id ?? null, song_id: entry.song_id ?? null }))
    };
  } finally {
    await Promise.all(segments.map((entry) => entry.path).filter(Boolean).map((entry) => rm(entry, { force: true })));
  }
}

export function splitNarrationText(text, maxCharacters = 2_800) {
  const limit = Math.floor(Number(maxCharacters));
  if (!Number.isFinite(limit) || limit < 100) throw new Error("Narration chunk size must be at least 100 characters");
  const sentences = String(text ?? "").trim().replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (!sentences.length) throw new Error("Narration text is required");
  const pieces = sentences.flatMap((sentence) => sentence.length <= limit ? [sentence] : splitWords(sentence, limit));
  const chunks = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= limit) current = candidate;
    else { if (current) chunks.push(current); current = piece; }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitLongDuration(durationSeconds, maximumSeconds = 600) {
  const duration = positiveDuration(durationSeconds, "Music");
  const maximum = positiveDuration(maximumSeconds, "Music segment maximum");
  const count = Math.ceil(duration / maximum);
  return Array.from({ length: count }, () => duration / count);
}

export async function combineAudioFiles(inputPaths, outputPath, run = execFileAsync) {
  if (!inputPaths.length) throw new Error("Audio concatenation requires at least one input");
  if (inputPaths.length === 1) return copyFile(inputPaths[0], outputPath);
  const inputs = inputPaths.flatMap((entry) => ["-i", path.resolve(entry)]);
  const labels = inputPaths.map((_, index) => `[${index}:a]`).join("");
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", `${labels}concat=n=${inputPaths.length}:v=0:a=1[outa]`, "-map", "[outa]", "-vn", "-c:a", "libmp3lame", "-q:a", "2", path.resolve(outputPath)]);
}

function splitWords(text, limit) {
  const output = [];
  let current = "";
  for (const word of String(text).split(/\s+/)) {
    if (word.length > limit) {
      if (current) { output.push(current); current = ""; }
      for (let index = 0; index < word.length; index += limit) output.push(word.slice(index, index + limit));
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) current = candidate;
    else { output.push(current); current = word; }
  }
  if (current) output.push(current);
  return output;
}

function positiveDuration(value, label) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${label} duration must be positive`);
  return duration;
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
    sfxDir: options.sfxDir ? path.resolve(options.sfxDir) : null, words: options.words ? path.resolve(options.words) : null,
    maxNarrationChars: options.maxNarrationChars ?? null,
    voiceSettings: options.voiceSettings ?? null
  };
}

function safeNarrationOptions(options) {
  return {
    noVoice: Boolean(options.noVoice),
    voiceId: options.voiceId ?? null,
    voiceModel: options.voiceModel ?? null,
    maxNarrationChars: options.maxNarrationChars ?? null,
    voiceSettings: options.voiceSettings ?? null
  };
}

function cinematicVoiceSettings(delivery) {
  const direction = String(delivery ?? "").toLowerCase();
  return {
    stability: /calm|measured|restrained/.test(direction) ? 0.5 : 0.36,
    similarity_boost: 0.78,
    style: /urgent|energetic|fast|punchy|intense/.test(direction) ? 0.55 : 0.4,
    use_speaker_boost: true,
    speed: /slow|deliberate/.test(direction) ? 0.96 : /fast|punchy|urgent/.test(direction) ? 1.06 : 1.02
  };
}

function estimateStoryWords(story) {
  const words = [];
  for (const beat of story.narration?.beats ?? []) {
    const tokens = String(beat.spoken_text ?? "").trim().split(/\s+/).filter(Boolean);
    const start = Number(beat.target_start_seconds);
    const end = Number(beat.target_end_seconds);
    const step = tokens.length ? (end - start) / tokens.length : 0;
    tokens.forEach((word, index) => words.push({ word, start: round(start + index * step), end: round(start + (index + 1) * step) }));
  }
  return words;
}

function narrationPauses(words, minimumGap = 0.12) {
  const pauses = [];
  for (let index = 1; index < words.length; index += 1) {
    const start = Number(words[index - 1].end);
    const end = Number(words[index].start);
    if (end - start >= minimumGap) pauses.push({ start_seconds: round(start), end_seconds: round(end), duration_seconds: round(end - start), after_word_index: index - 1 });
  }
  return pauses;
}

function alignStoryBeats(beats = [], words = []) {
  const alignments = [];
  let cursor = 0;
  for (const [index, beat] of beats.entries()) {
    const count = String(beat.spoken_text ?? "").trim().split(/\s+/).filter(Boolean).length;
    const final = index === beats.length - 1 ? words.length : Math.min(words.length, cursor + count);
    const selected = words.slice(cursor, final);
    alignments.push({
      beat_id: beat.id,
      role: beat.role,
      target_start_seconds: beat.target_start_seconds,
      target_end_seconds: beat.target_end_seconds,
      measured_start_seconds: selected.length ? round(selected[0].start) : null,
      measured_end_seconds: selected.length ? round(selected.at(-1).end) : null,
      first_word_index: selected.length ? cursor : null,
      last_word_index: selected.length ? final - 1 : null
    });
    cursor = final;
  }
  return alignments;
}

async function cachedCinematicNarration(workspace, verification) {
  const manifestPath = path.join(workspace, "production", "media", "cinematic-narration.json");
  const manifest = await readJson(manifestPath);
  return { stage: "cinematic-narration", status: "ready", workspace, manifest: manifestPath, voiceover: manifest.voiceover?.path ?? null, words: manifest.voiceover?.words_path ?? null, duration_seconds: manifest.duration_seconds, timing_source: manifest.timing_source, outputs: verification.outputs, cached: true };
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

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}
