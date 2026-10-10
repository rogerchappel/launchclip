import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeMedia } from "./media_trim.js";
import { planRecordingEdit } from "./recording_edit.js";
import { editRecording } from "./recording_edit_media.js";
import { createBrollPlan, renderBrollChecklist } from "./broll_plan.js";

const run = promisify(execFile);

// A local-only bridge shared by the CLI, production preprocessing and agent skill.
export async function prepareRecording(inputPath, options = {}, adapters = {}) {
  if (!options.out) throw new Error("Recording editing requires an output directory (--out)");
  const input = path.resolve(inputPath);
  const directory = path.resolve(options.out);
  const probe = await (adapters.probe ?? probeMedia)(input);
  const durationSeconds = Number(probe.format?.duration);
  if (!(durationSeconds > 0) || !probe.streams?.some((entry) => entry.codec_type === "audio")) {
    throw new Error("Recording editing requires media with audio and a known duration");
  }
  if (!probe.streams.some((entry) => entry.codec_type === "video")) throw new Error("Recording editing requires a video recording with audio");
  const output = path.join(directory, "base-edit.mp4");
  const files = {
    media: output,
    source_transcript: path.join(directory, "source-transcript.json"),
    edit_plan: path.join(directory, "edit-plan.json"),
    transcript: path.join(directory, "transcript.json"),
    words: path.join(directory, "words.json"),
    broll_plan: path.join(directory, "broll-plan.json"),
    broll_checklist: path.join(directory, "BROLL.md")
  };
  const manifestPath = path.join(directory, "recording.json");
  const protectedInputs = [input, options.transcript ? path.resolve(options.transcript) : null].filter(Boolean);
  if ([...Object.values(files), manifestPath].some((file) => protectedInputs.includes(file))) {
    throw new Error("Recording output must not overwrite source media or supplied transcript");
  }
  const policy = {
    takePolicy: options.takePolicy ?? "last",
    silenceDuration: options.trimSilence === false ? null : options.silenceDuration ?? 0.8,
    silencePadding: options.silencePadding ?? 0.15,
    retakeWindow: options.retakeWindow ?? 90,
    minRepeatWords: options.minRepeatWords ?? 6
  };
  const inputHash = await checksum(input);
  const transcriptHash = options.transcript ? await checksum(path.resolve(options.transcript)) : null;
  const requestHash = digest({ version: "recording-workflow.v1", inputHash, transcriptHash, policy, aspect: options.aspect ?? "16:9", model: options.model ?? "base.en", language: options.language ?? "en", crf: options.crf ?? 18 });
  const cached = await readCached(manifestPath, requestHash, files);
  if (cached) return { ...cached, manifest: manifestPath, cached: true };

  const transcript = options.transcript
    ? JSON.parse(await readFile(path.resolve(options.transcript), "utf8"))
    : await (adapters.transcribe ?? transcribeRecording)(input, options);
  const plan = planRecordingEdit(transcript, { ...policy, durationSeconds });
  await mkdir(directory, { recursive: true });
  const rendered = await (adapters.editRecording ?? editRecording)(input, output, plan, { crf: options.crf ?? 18 });
  const editedTranscript = { text: plan.text, words: plan.words, duration_seconds: plan.duration_seconds };
  const broll = createBrollPlan(editedTranscript, { durationSeconds: plan.duration_seconds, aspect: options.aspect ?? "16:9" });
  await writeJson(files.source_transcript, transcript);
  await writeJson(files.edit_plan, plan);
  await writeJson(files.transcript, editedTranscript);
  await writeJson(files.words, plan.words);
  await writeJson(files.broll_plan, broll);
  await writeAtomic(files.broll_checklist, renderBrollChecklist(broll));
  const checksums = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await checksum(file)])));
  const result = {
    schema_version: "launchclip.recording-workflow.v1", stage: "edit-recording", status: "ready",
    input, output, input_hash: requestHash, input_sha256: inputHash,
    output_sha256: checksums.media, source_duration_seconds: durationSeconds,
    duration_seconds: plan.duration_seconds,
    rendered_duration_seconds: rendered.rendered_duration_seconds ?? rendered.duration_seconds ?? plan.duration_seconds,
    take_policy: policy.takePolicy, files, checksums, cached: false
  };
  await writeJson(manifestPath, result);
  return { ...result, manifest: manifestPath };
}

export async function writeBrollPlan(transcriptPath, options = {}) {
  if (!options.out) throw new Error("B-roll planning requires an output directory (--out)");
  const input = path.resolve(transcriptPath);
  const directory = path.resolve(options.out);
  const planPath = path.join(directory, "broll-plan.json");
  const checklist = path.join(directory, "BROLL.md");
  if (input === planPath || input === checklist) throw new Error("B-roll output must not overwrite its transcript");
  const transcript = JSON.parse(await readFile(input, "utf8"));
  const plan = createBrollPlan(transcript, {
    durationSeconds: options.durationSeconds ?? transcript.duration_seconds,
    aspect: options.aspect ?? "16:9"
  });
  await writeJson(planPath, plan);
  await writeAtomic(checklist, renderBrollChecklist(plan));
  return { stage: "broll-plan", status: "ready", plan: planPath, checklist, cards: plan.cards.length };
}

export function recordingOptions(flags = {}) {
  return {
    out: flags.out, transcript: flags["recording-transcript"] ?? flags.transcript,
    trimSilence: !flags["no-trim-silence"], takePolicy: "last",
    silenceDuration: flags["silence-duration"] == null ? 0.8 : Number(flags["silence-duration"]),
    silencePadding: flags["silence-padding"] == null ? 0.15 : Number(flags["silence-padding"]),
    retakeWindow: flags["retake-window"] == null ? 90 : Number(flags["retake-window"]),
    minRepeatWords: flags["min-repeat-words"] == null ? 6 : Number(flags["min-repeat-words"]),
    model: flags["recording-model"] ?? "base.en", language: flags.language ?? "en",
    aspect: flags.aspect ?? "16:9", crf: flags["source-crf"] == null ? 18 : Number(flags["source-crf"])
  };
}

async function transcribeRecording(input, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-recording-transcript-"));
  try {
    try {
      await run("whisper", [input, "--model", options.model ?? "base.en", "--language", options.language ?? "en", "--word_timestamps", "True", "--fp16", "False", "--verbose", "False", "--output_format", "json", "--output_dir", directory], { maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("Local Whisper is not installed. Install openai-whisper or supply --recording-transcript <word-timed.json>; no paid transcription is called.");
      throw error;
    }
    return JSON.parse(await readFile(path.join(directory, `${path.parse(input).name}.json`), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readCached(manifestPath, requestHash, files) {
  try {
    const cached = JSON.parse(await readFile(manifestPath, "utf8"));
    if (cached.input_hash !== requestHash || cached.schema_version !== "launchclip.recording-workflow.v1") return null;
    for (const [key, file] of Object.entries(files)) {
      if (cached.files?.[key] !== file || cached.checksums?.[key] !== await checksum(file)) return null;
    }
    return cached;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function writeJson(file, value) { await writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`); }
async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
