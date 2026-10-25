import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { probeMedia } from "./media_trim.js";
import { normalizeRecordingTranscript, planRecordingEdit } from "./recording_edit.js";
import { createBrollPlan, renderBrollChecklist } from "./broll_plan.js";
import { analyzeRecordingAudio, refineRecordingEditPlan } from "./recording_audio.js";
import { identifySemanticRetakes, validateSemanticRetakes } from "./semantic_retakes.js";
import { measureFrameLevels, mergeConsensusTranscripts } from "./recording_consensus.js";
import { inspectRecordingJoins, runRecordingQa } from "./recording_qa_workflow.js";
import { AUDIO_ENHANCE_ENGINE_FILES, enhanceRecordingAudio, validateEnhanceOptions } from "./audio_enhance.js";

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
    audio_analysis: path.join(directory, "audio-analysis.json"),
    semantic_retakes: path.join(directory, "semantic-retakes.json"),
    rendered_transcript: path.join(directory, "rendered-transcript.json"),
    qa_report: path.join(directory, "recording-qa.json"),
    audio_enhance: path.join(directory, "audio-enhance.json"),
    broll_plan: path.join(directory, "broll-plan.json"),
    broll_checklist: path.join(directory, "BROLL.md")
  };
  // Two local recognisers by default (recordingOptions); a supplied primary
  // transcript joins a consensus only with a supplied second transcript.
  const consensusModel = options.consensusModel && options.consensusModel !== "none" ? options.consensusModel : null;
  const consensus = options.consensusTranscript ? true : Boolean(consensusModel && !options.transcript);
  if (consensus && !options.consensusTranscript && consensusModel === (options.model ?? "base.en")) throw new Error("Consensus transcription needs a second, different model (--consensus-model)");
  if (consensus) files.consensus_inputs = path.join(directory, "consensus-inputs.json");
  const manifestPath = path.join(directory, "recording.json");
  const protectedInputs = [input, options.transcript ? path.resolve(options.transcript) : null, options.consensusTranscript ? path.resolve(options.consensusTranscript) : null, options.retakeDecisions ? path.resolve(options.retakeDecisions) : null, options.qaDecisions ? path.resolve(options.qaDecisions) : null].filter(Boolean);
  if ([...Object.values(files), manifestPath].some((file) => protectedInputs.includes(file))) {
    throw new Error("Recording output must not overwrite source media or supplied transcript");
  }
  const policy = {
    takePolicy: options.takePolicy ?? "last",
    silenceDuration: options.trimSilence === false ? null : options.silenceDuration ?? 0.8,
    silencePadding: options.silencePadding ?? 0.15,
    retakeWindow: options.retakeWindow ?? 90,
    minRepeatWords: options.minRepeatWords ?? 6,
    removeFillers: options.removeFillers !== false,
    audioSilence: options.audioSilence !== false && options.trimSilence !== false,
    audioSilenceDuration: options.audioSilenceDuration ?? 0.4,
    audioSilencePadding: options.audioSilencePadding ?? 0.08,
    audioThresholdDb: options.audioThresholdDb ?? null
  };
  const inputHash = await checksum(input);
  const transcriptHash = options.transcript ? await checksum(path.resolve(options.transcript)) : null;
  const consensusTranscriptHash = options.consensusTranscript ? await checksum(path.resolve(options.consensusTranscript)) : null;
  if (options.retakeDecisions && options.retakeModel) throw new Error("Choose supplied retake decisions or a local retake model, not both");
  const retakeDecisionsHash = options.retakeDecisions ? await checksum(path.resolve(options.retakeDecisions)) : null;
  const qaDecisionsHash = options.qaDecisions ? await checksum(path.resolve(options.qaDecisions)) : null;
  const engineHash = digest(await Promise.all(["recording_workflow.js", "recording_edit.js", "recording_edit_media.js", "recording_audio.js", "semantic_retakes.js", "recording_consensus.js", "recording_qa_workflow.js", "recording_qa.js", "recording_qa_repair.js"].map(async (name) => readFile(new URL(name, import.meta.url), "utf8"))));
  const candidateHash = digest({ version: "recording-workflow.v3", qaModel: options.qaModel ?? null, qaBaseUrl: options.qaBaseUrl ?? null, qaAttempts: options.qaAttempts ?? 3, qaTranscriptionModel: options.qaTranscriptionModel ?? "base.en", engineHash, inputHash, transcriptHash, consensus: consensus ? { model: options.consensusTranscript ? null : consensusModel, transcriptHash: consensusTranscriptHash } : null, retakeDecisionsHash, retakeModel: options.retakeModel ?? null, retakeBaseUrl: options.retakeBaseUrl ?? null, policy, aspect: options.aspect ?? "16:9", model: options.model ?? "base.en", language: options.language ?? "en", crf: options.crf ?? 18 });
  // Audio clean-up runs after the cuts are QA'd, so it keys the published
  // edit but not the QA session: changing --enhance reuses the QA evidence.
  const { preset: enhancePreset, voiceIsolation } = validateEnhanceOptions({ preset: options.enhance, voiceIsolation: options.voiceIsolation });
  const enhancement = { preset: enhancePreset, voice_isolation: voiceIsolation, engine: enhancePreset === "off" && voiceIsolation === "none" ? null : digest(await Promise.all(AUDIO_ENHANCE_ENGINE_FILES.map(async (name) => readFile(new URL(name, import.meta.url), "utf8")))) };
  const requestHash = digest({ candidateHash, qaDecisionsHash, enhancement });
  const cached = await readCached(manifestPath, requestHash, files);
  if (cached) {
    const transcript = JSON.parse(await readFile(files.transcript, "utf8"));
    await ensureCaptureTracker(files, transcript, { durationSeconds: cached.duration_seconds, aspect: options.aspect ?? "16:9" });
    return { ...cached, manifest: manifestPath, cached: true };
  }
  try {
    await stat(output);
    throw new Error("Recording output exists without a matching complete cache. Use a new output directory to preserve existing media and capture progress.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }

  const session = await readQaSession(directory, candidateHash);
  let consensusInputs = null;
  let transcript;
  if (session && (consensus || !options.transcript)) transcript = await readSessionTranscript(files.source_transcript, session);
  else {
    const primary = options.transcript ? JSON.parse(await readFile(path.resolve(options.transcript), "utf8")) : await (adapters.transcribe ?? transcribeRecording)(input, options);
    if (!consensus) transcript = primary;
    else {
      const secondary = options.consensusTranscript
        ? JSON.parse(await readFile(path.resolve(options.consensusTranscript), "utf8"))
        : await (adapters.transcribe ?? transcribeRecording)(input, { ...options, model: consensusModel });
      const models = [options.transcript ? "supplied-transcript" : options.model ?? "base.en", options.consensusTranscript ? "supplied-consensus-transcript" : consensusModel];
      const levels = await (adapters.measureFrameLevels ?? measureFrameLevels)(input, { durationSeconds });
      transcript = mergeConsensusTranscripts(primary, secondary, { models, levels });
      consensusInputs = { schema_version: "launchclip.recording-consensus-inputs.v1", models, transcripts: [primary, secondary] };
    }
  }
  const semantic = options.retakeDecisions
    ? validateSemanticRetakes(JSON.parse(await readFile(path.resolve(options.retakeDecisions), "utf8")), normalizeRecordingTranscript(transcript), { retakeWindow: policy.retakeWindow })
    : options.retakeModel
      ? await (adapters.identifySemanticRetakes ?? identifySemanticRetakes)(transcript, { durationSeconds, retakeWindow: policy.retakeWindow, model: options.retakeModel, baseUrl: options.retakeBaseUrl }, adapters.semantic)
      : { status: "not-requested", retakes: [], restarts: [], removals: [] };
  const editPlan = planRecordingEdit(transcript, { ...policy, silenceDuration: policy.audioSilence ? null : policy.silenceDuration, durationSeconds, semanticRetakes: semantic.retakes, semanticRestarts: semantic.restarts ?? [] });
  const agreement = transcript.consensus;
  const basePlan = agreement ? { ...editPlan, transcript_consensus: { models: agreement.models, tolerance_seconds: agreement.tolerance_seconds, disagreements: agreement.disagreements } } : editPlan;
  const audio = policy.audioSilence
    ? await (adapters.analyzeRecordingAudio ?? analyzeRecordingAudio)(input, {
        durationSeconds, boundaryPlan: basePlan, silenceDuration: policy.audioSilenceDuration,
        silencePadding: policy.audioSilencePadding,
        ...(policy.audioThresholdDb == null ? {} : { thresholdDb: policy.audioThresholdDb })
      })
    : { status: "disabled", source_duration_seconds: durationSeconds };
  let plan = policy.audioSilence ? refineRecordingEditPlan(basePlan, audio, { silencePadding: policy.audioSilencePadding }) : basePlan;
  await readCaptureTracker(files, { text: plan.text, words: plan.words, duration_seconds: plan.duration_seconds }, { durationSeconds: plan.duration_seconds, aspect: options.aspect ?? "16:9" });
  await mkdir(directory, { recursive: true });
  await writeJson(files.source_transcript, transcript);
  if (consensusInputs) await writeJson(files.consensus_inputs, consensusInputs);
  const qa = await runRecordingQa(input, plan, {
    directory, requestHash: candidateHash, sourceTranscript: transcript,
    maxAttempts: options.qaAttempts ?? 3, model: options.qaModel, baseUrl: options.qaBaseUrl,
    transcriptionModel: options.qaTranscriptionModel ?? "base.en", language: options.language ?? "en", crf: options.crf ?? 18,
    ...(options.qaDecisions ? { decisions: JSON.parse(await readFile(path.resolve(options.qaDecisions), "utf8")) } : {})
  }, { ...adapters, transcribeRendered: adapters.transcribeRendered ?? transcribeRecording });
  if (qa.status !== "passed") {
    await writeJson(files.qa_report, qa.report);
    return { schema_version: "launchclip.recording-workflow.v1", stage: "edit-recording", status: qa.status,
      input, input_hash: requestHash, source_duration_seconds: durationSeconds, duration_seconds: qa.plan.duration_seconds,
      candidate: qa.files.media, qa_attempts: qa.attempts, qa: qa.report, files: { ...qa.files, source_transcript: files.source_transcript },
      next_action: qa.status === "needs-semantic-review" ? "The active agent should review the saved rendered transcript, joins and source context, write an evidence-bound QA receipt, then rerun with --qa-decisions. Standalone users can explicitly select --qa-model for local Ollama." : "Inspect the timed QA issues. No safe automatic repair remains; the candidate is preserved and has not been published as the base edit." };
  }
  plan = qa.plan;
  const editedTranscript = { text: plan.text, words: plan.words, duration_seconds: plan.duration_seconds };
  await readCaptureTracker(files, editedTranscript, { durationSeconds: plan.duration_seconds, aspect: options.aspect ?? "16:9" });
  const audioEnhancement = await enhanceBaseEdit(qa, plan, output, files.audio_enhance, { preset: enhancePreset, voiceIsolation, source: input }, adapters);
  const rendered = { rendered_duration_seconds: qa.rendered_duration_seconds };
  await writeJson(files.rendered_transcript, JSON.parse(await readFile(qa.files.rendered_transcript, "utf8")));
  await writeJson(files.qa_report, qa.report);
  await writeJson(files.edit_plan, plan);
  await writeJson(files.transcript, editedTranscript);
  await writeJson(files.words, plan.words);
  await writeJson(files.audio_analysis, audio);
  await writeJson(files.semantic_retakes, semantic);
  await ensureCaptureTracker(files, editedTranscript, { durationSeconds: plan.duration_seconds, aspect: options.aspect ?? "16:9" });
  const checksums = Object.fromEntries(await Promise.all(Object.entries(files).filter(([key]) => !key.startsWith("broll_")).map(async ([key, file]) => [key, await checksum(file)])));
  const result = {
    schema_version: "launchclip.recording-workflow.v1", stage: "edit-recording", status: "ready",
    input, output, input_hash: requestHash, input_sha256: inputHash,
    output_sha256: checksums.media, source_duration_seconds: durationSeconds,
    duration_seconds: plan.duration_seconds,
    rendered_duration_seconds: rendered.rendered_duration_seconds ?? rendered.duration_seconds ?? plan.duration_seconds,
    take_policy: policy.takePolicy, filler_cleanup: policy.removeFillers,
    audio_silence: policy.audioSilence, semantic_retakes: semantic.retakes.length, semantic_restarts: (semantic.restarts ?? []).length,
    ...(agreement ? { transcript_consensus: { models: agreement.models, agreed_words: agreement.agreed_words, disagreements: agreement.disagreements.length } } : {}),
    audio_enhancement: audioEnhancement,
    qa_status: "passed", qa_attempts: qa.attempts, qa_session: qa.files.qa_session,
    files, checksums, cached: false
  };
  await writeJson(manifestPath, result);
  return { ...result, manifest: manifestPath };
}

/**
 * Clean up the accepted candidate's audio into the base edit, after the cuts
 * passed QA. The enhanced media is published only when every join still
 * passes the acoustic join QA and the duration is unchanged; otherwise the
 * accepted candidate is published untouched and the reason is recorded.
 */
async function enhanceBaseEdit(qa, plan, output, reportPath, enhance, adapters) {
  const summary = { preset: enhance.preset, voice_isolation: enhance.voiceIsolation, report: reportPath };
  if (enhance.preset === "off" && enhance.voiceIsolation === "none") {
    await link(qa.files.media, output);
    await writeJson(reportPath, { schema_version: "launchclip.audio-enhance.v1", status: "off", preset: "off", voice_isolation: { requested: "none", status: "not-requested" }, input: qa.files.media, output, notes: ["--enhance off: the QA-accepted candidate is the base edit"] });
    return { ...summary, status: "off" };
  }
  const notice = adapters.notice ?? ((line) => process.stderr.write(`${line}\n`));
  const enhanced = path.join(path.dirname(output), `.base-edit.enhanced-${randomUUID()}.mp4`);
  try {
    const noiseProfile = enhance.source ? removedPauseWindow(plan) : null;
    const report = await (adapters.enhanceRecordingAudio ?? enhanceRecordingAudio)(qa.files.media, enhanced, { preset: enhance.preset, voiceIsolation: enhance.voiceIsolation, report: false, notice, ...(noiseProfile ? { noiseProfile: { file: enhance.source, ...noiseProfile } } : {}) });
    let status = report.status;
    let reason = null;
    let joins = null;
    if (status === "enhanced") {
      // Re-run the acoustic join QA on the enhanced media: processing must
      // not introduce a click or discontinuity at any accepted join.
      joins = await inspectRecordingJoins(enhanced, plan, adapters);
      const acceptedJoins = qa.files.acoustic ? JSON.parse(await readFile(qa.files.acoustic, "utf8")) : { issues: [] };
      const accepted = new Set((acceptedJoins.issues ?? []).map((issue) => issue.segment_index));
      const introduced = (joins.issues ?? []).filter((issue) => !accepted.has(issue.segment_index));
      const probe = await (adapters.probe ?? probeMedia)(enhanced);
      const duration = Number(probe.format?.duration);
      const expected = qa.rendered_duration_seconds ?? plan.duration_seconds;
      if (introduced.length) reason = `enhanced audio introduced ${introduced.length} join issue(s) at segment(s) ${introduced.map((issue) => issue.segment_index).join(", ")}`;
      else if (joins.checked === false) reason = "join QA could not check every join of the enhanced audio";
      else if (!(Math.abs(duration - expected) <= 0.05)) reason = `enhanced media duration ${duration}s differs from the accepted ${expected}s`;
      if (reason) status = "reverted";
    }
    if (status === "enhanced") await rename(enhanced, output);
    else await link(qa.files.media, output);
    if (reason) notice(`audio enhance: reverted to the unenhanced base edit (${reason})`);
    await writeJson(reportPath, { ...report, status, output, ...(reason ? { revert_reason: reason } : {}), join_qa: joins ? { checked: joins.checked, total_joins: joins.total_joins, issues: joins.issues ?? [] } : null });
    return { ...summary, status, ...(reason ? { revert_reason: reason } : {}), voice_isolation_status: report.voice_isolation?.status ?? null, paid_isolation_call: Boolean(report.voice_isolation?.paid_call) };
  } finally {
    await rm(enhanced, { force: true });
  }
}

/**
 * The edit removes the take's pauses, so the original recording holds the
 * longest noise-only stretches: the middle of the longest measured pause the
 * edit cut (at most 2 s) is where the denoiser learns its noise profile.
 */
export function removedPauseWindow(plan) {
  const pauses = (plan.removed_segments ?? []).filter((segment) => ["waveform-silence", "silence"].includes(segment.reason) && segment.source_end_seconds - segment.source_start_seconds >= 0.45);
  const longest = pauses.sort((a, b) => (b.source_end_seconds - b.source_start_seconds) - (a.source_end_seconds - a.source_start_seconds))[0];
  if (!longest) return null;
  const start = longest.source_start_seconds + 0.1;
  return { start_seconds: start, end_seconds: Math.min(longest.source_end_seconds - 0.1, start + 2) };
}

export async function writeBrollPlan(transcriptPath, options = {}) {
  if (!options.out) throw new Error("B-roll planning requires an output directory (--out)");
  const input = path.resolve(transcriptPath);
  const directory = path.resolve(options.out);
  const planPath = path.join(directory, "broll-plan.json");
  const checklist = path.join(directory, "BROLL.md");
  if (input === planPath || input === checklist) throw new Error("B-roll output must not overwrite its transcript");
  const transcript = JSON.parse(await readFile(input, "utf8"));
  const plan = await ensureCaptureTracker({ broll_plan: planPath, broll_checklist: checklist }, transcript, {
    durationSeconds: options.durationSeconds ?? transcript.duration_seconds,
    aspect: options.aspect ?? "16:9"
  });
  return { stage: "broll-plan", status: "ready", plan: planPath, checklist, cards: plan.cards.length };
}

export function recordingOptions(flags = {}) {
  return {
    out: flags.out, transcript: flags["recording-transcript"] ?? flags.transcript,
    trimSilence: !flags["no-trim-silence"], takePolicy: "last",
    removeFillers: !flags["keep-fillers"], audioSilence: !flags["no-audio-silence"],
    retakeDecisions: flags["retake-decisions"], retakeModel: flags["retake-model"], retakeBaseUrl: flags["retake-base-url"],
    audioSilenceDuration: flags["audio-silence-duration"] == null ? 0.4 : Number(flags["audio-silence-duration"]),
    audioSilencePadding: flags["audio-silence-padding"] == null ? 0.08 : Number(flags["audio-silence-padding"]),
    audioThresholdDb: flags["audio-threshold-db"] == null ? undefined : Number(flags["audio-threshold-db"]),
    silenceDuration: flags["silence-duration"] == null ? 0.8 : Number(flags["silence-duration"]),
    silencePadding: flags["silence-padding"] == null ? 0.15 : Number(flags["silence-padding"]),
    retakeWindow: flags["retake-window"] == null ? 90 : Number(flags["retake-window"]),
    minRepeatWords: flags["min-repeat-words"] == null ? 6 : Number(flags["min-repeat-words"]),
    model: flags["recording-model"] ?? "base.en", language: flags.language ?? "en",
    consensusModel: flags["consensus-model"] ?? "small.en", consensusTranscript: flags["consensus-transcript"],
    qaModel: flags["qa-model"], qaBaseUrl: flags["qa-base-url"], qaDecisions: flags["qa-decisions"],
    qaAttempts: flags["qa-attempts"] == null ? 3 : Number(flags["qa-attempts"]),
    qaTranscriptionModel: flags["qa-recording-model"] ?? "base.en",
    enhance: flags.enhance ?? "light", voiceIsolation: flags["voice-isolation"] ?? "none",
    aspect: flags.aspect ?? "16:9", crf: flags["source-crf"] == null ? 18 : Number(flags["source-crf"])
  };
}

export async function transcribeRecording(input, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-recording-transcript-"));
  try {
    try {
      await run("whisper", [input, "--model", options.model ?? "base.en", "--language", options.language ?? "en", "--word_timestamps", "True", "--condition_on_previous_text", "False", "--initial_prompt", "Transcribe speech verbatim, including audible hesitation words um, uh, erm, er and false starts.", "--fp16", "False", "--verbose", "False", "--output_format", "json", "--output_dir", directory], { maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      if (error.code === "ENOENT") throw new Error("Local Whisper is not installed. Install openai-whisper or supply --recording-transcript <word-timed.json>; no paid transcription is called.");
      throw error;
    }
    return JSON.parse(await readFile(path.join(directory, `${path.parse(input).name}.json`), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readQaSession(directory, requestHash) {
  try {
    const session = JSON.parse(await readFile(path.join(directory, "qa", "session.json"), "utf8"));
    if (session.request_hash !== requestHash) throw new Error("Recording QA session belongs to different input, settings or engine. Use a fresh output directory.");
    return session;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function readSessionTranscript(file, session) {
  const transcript = JSON.parse(await readFile(file, "utf8"));
  if (digest(transcript) !== session.source_transcript_hash) throw new Error("Saved source transcript changed; use a fresh output directory.");
  return transcript;
}

async function readCached(manifestPath, requestHash, files) {
  try {
    const cached = JSON.parse(await readFile(manifestPath, "utf8"));
    if (cached.input_hash !== requestHash || cached.schema_version !== "launchclip.recording-workflow.v1") return null;
    for (const [key, file] of Object.entries(files)) {
      if (key.startsWith("broll_")) continue;
      if (cached.files?.[key] !== file || cached.checksums?.[key] !== await checksum(file)) return null;
    }
    return cached;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function ensureCaptureTracker(files, transcript, options) {
  const { existing, timelineHash } = await readCaptureTracker(files, transcript, options);
  const plan = existing ?? { ...createBrollPlan(transcript, options), source_timeline_hash: timelineHash };
  if (!existing) await writeJson(files.broll_plan, plan);
  try { await readFile(files.broll_checklist); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeAtomic(files.broll_checklist, renderBrollChecklist(plan));
  }
  return plan;
}

async function readCaptureTracker(files, transcript, options) {
  const timelineHash = digest({ transcript, ...options });
  let existing;
  try { existing = JSON.parse(await readFile(files.broll_plan, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing && existing.source_timeline_hash !== timelineHash) {
    throw new Error("B-roll tracker belongs to a different transcript or timeline. Use a new output directory to preserve recorded capture progress.");
  }
  if (!existing) {
    try {
      await readFile(files.broll_checklist);
      throw new Error("B-roll checklist already exists without its plan. Use a new output directory.");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { existing, timelineHash };
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
