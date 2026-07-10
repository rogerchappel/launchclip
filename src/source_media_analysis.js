import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { OpenAIResponsesClient } from "./openai_responses.js";
import { ElevenLabsMediaProvider } from "./production_media.js";
import { PRODUCTION_PATHS } from "./production_contracts.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";

const execFileAsync = promisify(execFile);

export const MEDIA_ANALYSIS_SCHEMA = strictObject({
  resource_id: { type: "string" },
  summary: { type: "string" },
  visible_text: { type: "array", items: { type: "string" } },
  narrative_opportunities: { type: "array", items: { type: "string" } },
  segments: {
    type: "array",
    items: strictObject({
      start_seconds: { type: "number", minimum: 0 },
      end_seconds: { type: "number", exclusiveMinimum: 0 },
      description: { type: "string" },
      proof_value: { type: "string" },
      motion_or_interaction: { type: "string" },
      recommended_usage: { type: "string" }
    })
  },
  quality_warnings: { type: "array", items: { type: "string" } }
});

const ANALYST_INSTRUCTIONS = `Analyze one user-supplied visual resource for a video creative director. The image may be a contact sheet ordered left-to-right, top-to-bottom.

Describe what is visibly present, the sequence of UI states or actions, readable text, proof the asset can honestly support, useful narrative beats, and quality limitations. Do not invent product behavior beyond the pixels. Reference footage can inspire editing but cannot substantiate factual claims. Return only the strict JSON.`;

export async function analyzeSourceMedia(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const intakePath = path.join(workspace, PRODUCTION_PATHS.intake);
  const evidencePath = path.join(workspace, PRODUCTION_PATHS.evidence);
  const [intake, evidence] = await Promise.all([readJson(intakePath), readJson(evidencePath)]);
  const sourceEvidence = { ...evidence, items: evidence.items.filter((entry) => !/:transcript$|:visual-analysis$/.test(entry.id)) };
  const inputHash = semanticHash({ intake, evidence: sourceEvidence, options: { samples: options.samples ?? 12, columns: options.columns ?? 4, reasoning: options.reasoning ?? "high", transcriptionModel: options.transcriptionModel ?? "scribe_v2", transcribeAll: Boolean(options.transcribeAll), stageRemoteReferences: options.stageRemoteReferences !== false }, stage: "source-media-analysis.v1" });
  const store = adapters.store ?? await ProductionJobStore.open(workspace);
  const jobId = "source-media-analysis";
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) {
      const report = await readJson(path.join(workspace, "production", "source-media", "analysis.json"));
      return { stage: "source-media-analysis", status: "ready", workspace, evidence: evidencePath, report: path.join(workspace, "production", "source-media", "analysis.json"), reference_videos: (report.staged_references ?? []).map((entry) => entry.local_path), resources: report.summary?.resources ?? report.analyses.length, analyses: report.analyses.length, transcripts: report.summary?.transcripts ?? 0, cached: true };
    }
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) await store.markStaleFrom([jobId]);
  const current = store.get(jobId);
  if (!current) await store.add({ id: jobId, kind: "source-media-analysis", depends_on: [], input_hash: inputHash });
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId);
  else if (current.status === "running" || current.status === "submitted") {
    await store.markStaleFrom([jobId]);
    await store.retry(jobId);
  }
  else if (current.status !== "pending") throw new Error(`Source media analysis job is already ${current.status}`);
  await store.markRunning(jobId);
  try {
  const mediaDir = path.join(workspace, "production", "source-media");
  await mkdir(mediaDir, { recursive: true });
  const resources = intake.resources.filter((entry) => !entry.is_remote && ["video", "image", "audio"].includes(entry.type));
  const stagedReferences = [];
  for (const resource of intake.resources.filter((entry) => entry.role === "reference" && entry.is_remote && isSupportedVideoReference(entry.location))) {
    if (options.stageRemoteReferences === false) continue;
    const stagedPath = adapters.stageReference
      ? await adapters.stageReference(resource, mediaDir, options)
      : await stageVideoReference(resource, mediaDir, adapters.run ?? runCommand);
    const staged = { ...resource, type: "video", location: stagedPath, is_remote: false, staged_from: resource.location };
    resources.push(staged);
    stagedReferences.push({ resource_id: resource.id, source_url: resource.location, local_path: stagedPath });
  }
  const needsTranscript = intake.policies?.supplied_voiceover_is_authoritative && !evidence.items.some((entry) => entry.kind === "voiceover-transcript");
  const transcriber = adapters.transcriber ?? (process.env.ELEVENLABS_API_KEY ? new ElevenLabsMediaProvider() : null);
  if (needsTranscript && !transcriber) throw new Error("Supplied voiceover requires --transcript or ELEVENLABS_API_KEY for Scribe transcription");
  const client = adapters.client ?? (resources.some((entry) => ["video", "image"].includes(entry.type)) ? new OpenAIResponsesClient() : null);
  const newItems = [];
  const analyses = [];

  for (const resource of resources) {
    if ((resource.role === "voiceover" || resource.role === "reference" || options.transcribeAll) && ["video", "audio"].includes(resource.type) && transcriber) {
      const transcript = await transcriber.transcribe({ filePath: resource.location, modelId: options.transcriptionModel ?? "scribe_v2", languageCode: intake.brief.language });
      const wordsPath = path.join(mediaDir, `${resource.id}.words.json`);
      await writeAtomic(wordsPath, `${JSON.stringify(transcript.words, null, 2)}\n`);
      const isVoiceover = resource.role === "voiceover";
      const duration = Number(transcript.words.at(-1)?.end ?? 0);
      const wordCount = transcript.words.length;
      newItems.push(evidenceItem({
        id: `resource:${resource.id}:transcript`,
        kind: isVoiceover ? "voiceover-transcript" : "media-transcript",
        role: isVoiceover ? "voiceover" : resource.role,
        title: `${path.basename(resource.location)} transcript`,
        content: transcript.text,
        provenance: resource.location,
        sha256: resource.sha256,
        claimsAllowed: !isVoiceover && resource.role !== "reference",
        metadata: [["words_path", wordsPath], ["language", transcript.language_code ?? ""], ["provider", transcript.provider], ["word_count", wordCount], ["words_per_minute", duration > 0 ? Math.round(wordCount * 60 / duration) : null]]
      }));
    }
    if (!["video", "image"].includes(resource.type)) continue;
    const visualPath = resource.type === "video"
      ? await makeContactSheet(resource, mediaDir, options, adapters)
      : resource.location;
    const result = await client.runStructured({
      model: intake.model?.id ?? "gpt-5.6",
      reasoningEffort: options.reasoning ?? "high",
      reasoningContext: "current_turn",
      instructions: ANALYST_INSTRUCTIONS,
      input: JSON.stringify({ resource_id: resource.id, role: resource.role, type: resource.type, contact_sheet_order: resource.type === "video" ? "left-to-right then top-to-bottom, evenly sampled" : "single image" }),
      images: [await dataImage(visualPath)],
      schema: MEDIA_ANALYSIS_SCHEMA,
      schemaName: "launchclip_source_media_analysis",
      background: options.background !== false,
      maxOutputTokens: Number(options.maxOutputTokens ?? 12_000),
      promptCacheKey: "launchclip:source-media-analysis:v1",
      metadata: { resource_id: resource.id, role: resource.role }
    });
    if (result.value.resource_id !== resource.id) throw new Error(`Media analysis resource_id must be ${resource.id}`);
    const duration = metadataNumber(evidence.items.find((entry) => entry.id === `resource:${resource.id}`), "duration_seconds");
    for (const segment of result.value.segments) {
      if (!(segment.end_seconds > segment.start_seconds)) throw new Error(`Media analysis segment must have end > start for ${resource.id}`);
      if (duration && segment.end_seconds > duration + .25) throw new Error(`Media analysis segment exceeds ${resource.id} duration`);
    }
    analyses.push({ resource_id: resource.id, analysis: result.value, contact_sheet: visualPath, staged_from: resource.staged_from ?? null, response_id: result.response_id, model: result.model });
    newItems.push(evidenceItem({
      id: `resource:${resource.id}:visual-analysis`,
      kind: resource.role === "reference" ? "reference-visual-analysis" : "visual-media-analysis",
      role: resource.role,
      title: `${path.basename(resource.location)} visual analysis`,
      content: JSON.stringify(result.value, null, 2),
      provenance: resource.location,
      sha256: resource.sha256,
      claimsAllowed: resource.role !== "reference",
      metadata: [["contact_sheet", visualPath], ["response_id", result.response_id], ["model", result.model]]
    }));
  }
  const ids = new Set(newItems.map((entry) => entry.id));
  evidence.items = [...evidence.items.filter((entry) => !ids.has(entry.id)), ...newItems];
  await writeAtomic(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const reportPath = path.join(mediaDir, "analysis.json");
  const transcriptCount = newItems.filter((entry) => /transcript$/.test(entry.kind)).length;
  await writeAtomic(reportPath, `${JSON.stringify({ schema_version: "launchclip.source-media-analysis.v1", analyses, staged_references: stagedReferences, summary: { resources: resources.length, analyses: analyses.length, transcripts: transcriptCount } }, null, 2)}\n`);
  const candidates = [evidencePath, reportPath, ...stagedReferences.map((entry) => entry.local_path), ...newItems.flatMap((entry) => entry.metadata.filter((item) => item.key === "words_path").map((item) => item.value))];
  const outputs = await Promise.all([...new Set(candidates)].map((filePath) => describeJobOutput(workspace, filePath)));
  await store.markSucceeded(jobId, outputs);
  return { stage: "source-media-analysis", status: "ready", workspace, evidence: evidencePath, report: reportPath, reference_videos: stagedReferences.map((entry) => entry.local_path), resources: resources.length, analyses: analyses.length, transcripts: transcriptCount, cached: false };
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

async function stageVideoReference(resource, mediaDir, run) {
  const directory = path.join(mediaDir, "references");
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, `${resource.id}.mp4`);
  await run("yt-dlp", [
    "--no-playlist", "--match-filter", "duration <= 900",
    "--format", "bv*[height<=1080]+ba/b[height<=1080]",
    "--merge-output-format", "mp4", "--output", output, resource.location
  ]);
  const info = await stat(output);
  if (!info.isFile() || !info.size) throw new Error(`Reference staging produced no video: ${resource.location}`);
  return output;
}

function isSupportedVideoReference(value) {
  return /^https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch|shorts\/)|youtu\.be\/)/i.test(String(value ?? ""));
}

async function makeContactSheet(resource, mediaDir, options, adapters) {
  const output = path.join(mediaDir, `${resource.id}.contact-sheet.jpg`);
  if (adapters.contactSheet) {
    await adapters.contactSheet(resource.location, output, options);
    return output;
  }
  const duration = await probeDuration(resource.location, adapters.run ?? runCommand);
  const samples = Number(options.samples ?? 12);
  const columns = Number(options.columns ?? 4);
  const rows = Math.ceil(samples / columns);
  const interval = Math.max(.1, duration / samples);
  await (adapters.run ?? runCommand)("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", resource.location,
    "-vf", `fps=1/${interval},scale=480:-2,tile=${columns}x${rows}:padding=8:margin=8`,
    "-frames:v", "1", output
  ]);
  return output;
}

async function probeDuration(filePath, run) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
  const duration = Number(String(stdout).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Could not determine media duration: ${filePath}`);
  return duration;
}

function evidenceItem({ id, kind, role, title, content, provenance, sha256, claimsAllowed, metadata }) {
  return { id, kind, role, title, content, provenance, sha256: sha256 ?? null, claims_allowed: Boolean(claimsAllowed), truncated: false, metadata: metadata.filter((entry) => entry[1] != null && entry[1] !== "").map(([key, value]) => ({ key, value: String(value) })) };
}

function metadataNumber(item, key) {
  const value = item?.metadata?.find((entry) => entry.key === key)?.value;
  return value == null ? null : Number(value);
}

async function dataImage(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { url: `data:${mime};base64,${(await readFile(filePath)).toString("base64")}`, detail: "original" };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, filePath);
}

function strictObject(properties) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

async function runCommand(command, args) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 64 });
}
