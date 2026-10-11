import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { trimMediaSilence } from "./media_trim.js";
import { prepareRecording } from "./recording_workflow.js";

export const SOURCE_PREPROCESS_VERSION = "launchclip.source-preprocess.v1";

export async function prepareSourceMedia(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const intakePath = path.join(workspace, "production", "intake.json");
  const reportPath = path.join(workspace, "production", "source-media", "preprocess.json");
  const intake = JSON.parse(await readFile(intakePath, "utf8"));
  const source = (intake.resources ?? []).find((entry) => entry.role === "voiceover" && !entry.is_remote && ["video", "audio"].includes(entry.type));
  if (source && (options.editRecording || source.recording_edit)) {
    const input = path.resolve(source.derived_from ?? source.location);
    const recordingOptions = options.editRecording ? { ...options.recording, trimSilence: options.trimSilence } : source.recording_edit.options;
    const recording = await (adapters.prepareRecording ?? prepareRecording)(input, {
      ...recordingOptions,
      out: path.join(workspace, "production", "source-media", "recording-edit")
    }, adapters.recording);
    if (recording.status !== "ready") {
      const report = { ...recording, schema_version: SOURCE_PREPROCESS_VERSION, stage: "source-preprocess", changed: false };
      await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      return { ...report, report: reportPath };
    }
    await applyPreparedResource(intake, intakePath, source.location, recording.output, recording.rendered_duration_seconds, recording.output_sha256);
    for (const resource of intake.resources) {
      if (["voiceover", "presenter"].includes(resource.role) && resource.location === recording.output) {
        resource.recording_edit = { manifest: recording.manifest, options: recordingOptions };
      }
    }
    // Replace raw transcript resources so planning never consumes rejected takes.
    const transcripts = intake.resources.filter((entry) => entry.role === "voiceover-transcript");
    if (!transcripts.length) {
      const id = `recording-edited-transcript-${source.id}`;
      transcripts.push({ id, role: "voiceover-transcript", type: "text", is_remote: false });
      intake.resources.push(transcripts[0]);
    }
    for (const resource of transcripts) {
      resource.derived_from = resource.derived_from ?? resource.location ?? input;
      resource.location = recording.files.transcript;
      resource.source = recording.files.transcript;
      resource.media_location = recording.output;
      resource.type = "text";
      resource.is_remote = false;
      resource.sha256 = await sha256File(recording.files.transcript);
      resource.size_bytes = (await stat(recording.files.transcript)).size;
    }
    await writeAtomic(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
    const report = { ...recording, schema_version: SOURCE_PREPROCESS_VERSION, stage: "source-preprocess", changed: recording.output !== input, recording_edit: recording.manifest };
    await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ...report, report: reportPath };
  }
  if (!source || options.trimSilence === false) {
    const report = {
      schema_version: SOURCE_PREPROCESS_VERSION,
      stage: "source-preprocess",
      status: "not-applicable",
      reason: !source ? "No local authoritative voiceover media." : "Silence trimming disabled.",
      input: source?.location ?? null,
      output: source?.location ?? null,
      changed: false
    };
    await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return { ...report, report: reportPath };
  }

  const input = path.resolve(source.derived_from ?? source.location);
  const inputSha256 = source.derived_from ? await sha256File(input) : source.sha256 ?? await sha256File(input);
  const trimOptions = {
    silenceDuration: numberOr(options.silenceDuration, 0.45),
    silencePadding: numberOr(options.silencePadding, 0.12),
    crf: numberOr(options.crf, 18)
  };
  const inputHash = hashJson({ version: SOURCE_PREPROCESS_VERSION, input: inputSha256, trimOptions });
  const extension = source.type === "video" ? ".mp4" : ".m4a";
  const preparedDir = path.join(workspace, "production", "source-media", "prepared");
  const output = path.join(preparedDir, `${safeId(source.id)}-${inputHash.slice(0, 12)}${extension}`);

  const cached = await validCachedReport(reportPath, inputHash);
  if (cached) {
    await applyPreparedResource(intake, intakePath, source.location, cached.output, cached.rendered_duration_seconds, cached.output_sha256);
    return { ...cached, report: reportPath, cached: true };
  }

  const trim = adapters.trimMediaSilence
    ? await adapters.trimMediaSilence(input, output, trimOptions)
    : await trimMediaSilence(input, output, trimOptions);
  const prepared = trim.changed ? trim.output : input;
  const info = await stat(prepared);
  const outputSha256 = trim.changed ? await sha256File(prepared) : inputSha256;
  await applyPreparedResource(intake, intakePath, source.location, prepared, trim.rendered_duration_seconds, outputSha256, info.size);
  const report = {
    schema_version: SOURCE_PREPROCESS_VERSION,
    stage: "source-preprocess",
    status: "ready",
    input,
    output: prepared,
    changed: trim.changed,
    cached: false,
    input_hash: inputHash,
    input_sha256: inputSha256,
    output_sha256: outputSha256,
    trim: trim.trim,
    source_duration_seconds: trim.source_duration_seconds,
    rendered_duration_seconds: trim.rendered_duration_seconds
  };
  await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, report: reportPath };
}

async function applyPreparedResource(intake, intakePath, originalLocation, prepared, duration, sha256, knownSize = null) {
  const info = knownSize == null ? await stat(prepared) : null;
  const sizeBytes = knownSize ?? info.size;
  for (const resource of intake.resources ?? []) {
    if (resource.location !== originalLocation && resource.derived_from !== originalLocation) continue;
    if (!new Set(["voiceover", "presenter"]).has(resource.role)) continue;
    resource.derived_from = resource.derived_from ?? resource.location;
    resource.location = prepared;
    resource.source = prepared;
    resource.size_bytes = sizeBytes;
    resource.sha256 = sha256;
  }
  if (intake.source?.kind === "voiceover" && intake.source.location === originalLocation) {
    intake.source.derived_from = intake.source.derived_from ?? intake.source.location;
    intake.source.location = prepared;
    intake.source.value = prepared;
  }
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) intake.brief.duration_seconds = Number(duration);
  await writeAtomic(intakePath, `${JSON.stringify(intake, null, 2)}\n`);
}

async function validCachedReport(reportPath, inputHash) {
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (report.schema_version !== SOURCE_PREPROCESS_VERSION || report.input_hash !== inputHash || !report.output) return null;
    const info = await stat(report.output);
    if (!info.isFile()) return null;
    if (report.output_sha256 && await sha256File(report.output) !== report.output_sha256) return null;
    return report;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeId(value) {
  return String(value ?? "source").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "source";
}

function numberOr(value, fallback) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid source preprocessing number: ${value}`);
  return number;
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, filePath);
}
