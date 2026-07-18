import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { probeOpenRouterFreeVisionModels, recordOpenRouterFreeModelOutcome, selectOpenRouterFreeVisionModels } from "./free_model_selector.js";
import { createStructuredClient, parseModelRoute } from "./model_provider.js";
import { ElevenLabsMediaProvider } from "./production_media.js";
import { PRODUCTION_PATHS } from "./production_contracts.js";
import { describeJobOutput, ProductionJobStore, semanticHash } from "./job_store.js";
import { analyzeRenderMotion } from "./render_motion_analysis.js";

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

const ANALYST_INSTRUCTIONS = `Analyze one user-supplied visual resource for a video creative director. Images may include an evenly sampled overview, a dense first-four-second hook strip, and a cut-boundary strip, all ordered left-to-right then top-to-bottom.

Use the supplied real duration, sheet timing, cut times, and motion-burst times when assigning segment timestamps. Never normalize an unknown sequence into placeholder seconds. Describe what is visibly present, the sequence of UI states or actions, readable text, proof the asset can honestly support, useful narrative beats, hook construction, edit cadence, and quality limitations. Do not invent product behavior beyond the pixels. Reference footage can inspire editing but cannot substantiate factual claims. Return only the strict JSON.`;

export async function analyzeSourceMedia(workspacePath, options = {}, adapters = {}) {
  const workspace = path.resolve(workspacePath);
  const intakePath = path.join(workspace, PRODUCTION_PATHS.intake);
  const evidencePath = path.join(workspace, PRODUCTION_PATHS.evidence);
  const mediaDir = path.join(workspace, "production", "source-media");
  const derivedEvidencePath = path.join(mediaDir, "evidence.json");
  const [intake, evidence] = await Promise.all([readJson(intakePath), readJson(evidencePath)]);
  const sourceEvidence = { ...evidence, items: evidence.items.filter((entry) => !/:transcript$|:visual-analysis$/.test(entry.id)) };
  const inputHash = semanticHash({ intake, evidence: sourceEvidence, options: { samples: options.samples ?? 12, columns: options.columns ?? 4, hookSeconds: options.hookSeconds ?? 4, hookFps: options.hookFps ?? 4, reasoning: options.reasoning ?? "high", transcriptionModel: options.transcriptionModel ?? "scribe_v2", transcribeAll: Boolean(options.transcribeAll), stageRemoteReferences: options.stageRemoteReferences !== false }, stage: "source-media-analysis.v4" });
  const store = adapters.store ?? await ProductionJobStore.open(workspace);
  const jobId = "source-media-analysis";
  const existing = store.get(jobId);
  if (existing?.status === "succeeded" && existing.input_hash === inputHash) {
    const verification = await store.verifyOutputs(jobId);
    if (verification.ok) {
      const derived = await readJson(derivedEvidencePath);
      const currentEvidence = await readJson(evidencePath);
      const derivedIds = new Set(derived.items.map((entry) => entry.id));
      currentEvidence.items = [...currentEvidence.items.filter((entry) => !derivedIds.has(entry.id)), ...derived.items];
      await writeAtomic(evidencePath, `${JSON.stringify(currentEvidence, null, 2)}\n`);
      const report = await readJson(path.join(workspace, "production", "source-media", "analysis.json"));
      return { stage: "source-media-analysis", status: "ready", workspace, evidence: evidencePath, report: path.join(workspace, "production", "source-media", "analysis.json"), reference_videos: (report.staged_references ?? []).map((entry) => entry.local_path), resources: report.summary?.resources ?? report.analyses.length, analyses: report.analyses.length, transcripts: report.summary?.transcripts ?? 0, cached: true, ...(report.free_model_selection ? { free_model_selection: report.free_model_selection } : {}) };
    }
    await store.markStaleFrom([jobId]);
  } else if (existing && existing.input_hash !== inputHash) await store.markStaleFrom([jobId]);
  const current = store.get(jobId);
  if (!current) await store.add({ id: jobId, kind: "source-media-analysis", depends_on: [], input_hash: inputHash });
  else if (current.status === "failed" || current.status === "stale") await store.retry(jobId, { inputHash });
  else if (current.status === "running" || current.status === "submitted") {
    await store.markStaleFrom([jobId]);
    await store.retry(jobId, { inputHash });
  }
  else if (current.status !== "pending") throw new Error(`Source media analysis job is already ${current.status}`);
  await store.markRunning(jobId);
  try {
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
  const hasVoiceoverTranscript = evidence.items.some((entry) => entry.kind === "voiceover-transcript" && entry.role === "voiceover");
  const needsTranscript = intake.policies?.supplied_voiceover_is_authoritative && !hasVoiceoverTranscript;
  const transcriber = adapters.transcriber ?? (process.env.ELEVENLABS_API_KEY ? new ElevenLabsMediaProvider() : null);
  if (needsTranscript && !transcriber) throw new Error("Supplied voiceover requires --transcript or ELEVENLABS_API_KEY for Scribe transcription");
  let freeVisionSelection = !adapters.client && usesDiscoveredFreeVision(intake, options)
    ? await selectFreeVisionAnalyst(options, adapters)
    : null;
  let route = parseModelRoute(freeVisionSelection?.routes?.[0], {
    provider: intake.model?.provider ?? "openai",
    model: intake.model?.id ?? "gpt-5.6",
    reasoning: options.reasoning ?? intake.model?.reasoning_effort ?? "high",
    supportsImages: true
  });
  const createClient = adapters.createClient ?? createStructuredClient;
  let client = adapters.client ?? (resources.some((entry) => ["video", "image"].includes(entry.type)) ? createClient(route) : null);
  const newItems = [];
  const analyses = [];

  for (const resource of resources) {
    const shouldTranscribe = (resource.role === "voiceover" || resource.role === "reference" || options.transcribeAll)
      && !(resource.role === "voiceover" && hasVoiceoverTranscript);
    if (shouldTranscribe && ["video", "audio"].includes(resource.type) && transcriber) {
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
    const duration = metadataNumber(evidence.items.find((entry) => entry.id === `resource:${resource.id}`), "duration_seconds");
    const visual = resource.type === "video"
      ? await makeContactSheets(resource, mediaDir, { ...options, durationSeconds: duration }, adapters)
      : { sheets: [{ kind: "image", path: await normalizeVisualImage(resource, mediaDir, adapters) }], temporal_profile: null };
    const visualPath = visual.sheets[0].path;
    const request = {
      model: route.model,
      reasoningEffort: route.reasoning,
      reasoningContext: "current_turn",
      instructions: ANALYST_INSTRUCTIONS,
      input: JSON.stringify({
        resource_id: resource.id,
        role: resource.role,
        type: resource.type,
        duration_seconds: visual.temporal_profile?.duration_seconds ?? duration,
        contact_sheet_order: resource.type === "video" ? "Each sheet is ordered left-to-right then top-to-bottom; use its timing descriptor." : "single image",
        contact_sheets: visual.sheets.map(({ path: _path, ...sheet }) => sheet),
        temporal_profile: visual.temporal_profile
      }),
      images: await Promise.all(visual.sheets.map((sheet) => dataImage(sheet.path))),
      schema: MEDIA_ANALYSIS_SCHEMA,
      schemaName: "launchclip_source_media_analysis",
      background: options.background !== false,
      maxOutputTokens: Number(options.maxOutputTokens ?? 12_000),
      promptCacheKey: "launchclip:source-media-analysis:v1",
      metadata: { resource_id: resource.id, role: resource.role }
    };
    let result;
    try {
      result = await client.runStructured(request);
    } catch (error) {
      if (!freeVisionSelection || adapters.client) throw error;
      const failedModel = freeVisionSelection.selected_model;
      const recordOutcome = adapters.recordOpenRouterFreeModelOutcome ?? recordOpenRouterFreeModelOutcome;
      const probeModels = adapters.probeOpenRouterFreeVisionModels ?? probeOpenRouterFreeVisionModels;
      const rotated = await recordOutcome(freeVisionSelection, { error });
      freeVisionSelection = await probeModels(rotated, {
        timeoutMs: Number(options.freeVisionProbeTimeoutMs ?? 15_000),
        excludeIds: [failedModel]
      });
      route = parseModelRoute(freeVisionSelection.routes[0]);
      client = createClient(route);
      result = await client.runStructured({ ...request, model: route.model, reasoningEffort: route.reasoning });
    }
    if (result.value.resource_id !== resource.id) throw new Error(`Media analysis resource_id must be ${resource.id}`);
    for (const segment of result.value.segments) {
      if (!(segment.end_seconds > segment.start_seconds)) throw new Error(`Media analysis segment must have end > start for ${resource.id}`);
      if (duration && segment.end_seconds > duration + .25) throw new Error(`Media analysis segment exceeds ${resource.id} duration`);
    }
    analyses.push({ resource_id: resource.id, analysis: result.value, contact_sheet: visualPath, contact_sheets: visual.sheets, temporal_profile: visual.temporal_profile, staged_from: resource.staged_from ?? null, response_id: result.response_id, model: result.model });
    newItems.push(evidenceItem({
      id: `resource:${resource.id}:visual-analysis`,
      kind: resource.role === "reference" ? "reference-visual-analysis" : "visual-media-analysis",
      role: resource.role,
      title: `${path.basename(resource.location)} visual analysis`,
      content: JSON.stringify(result.value, null, 2),
      provenance: resource.location,
      sha256: resource.sha256,
      claimsAllowed: resource.role !== "reference",
      metadata: [["contact_sheet", visualPath], ["contact_sheets", JSON.stringify(visual.sheets.map(({ path: sheetPath, ...sheet }) => ({ ...sheet, path: sheetPath })))], ["temporal_profile", visual.temporal_profile ? JSON.stringify(visual.temporal_profile) : null], ["response_id", result.response_id], ["model", result.model]]
    }));
  }
  const ids = new Set(newItems.map((entry) => entry.id));
  evidence.items = [...evidence.items.filter((entry) => !ids.has(entry.id)), ...newItems];
  await writeAtomic(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeAtomic(derivedEvidencePath, `${JSON.stringify({ schema_version: "launchclip.source-media-evidence.v1", items: newItems }, null, 2)}\n`);
  const reportPath = path.join(mediaDir, "analysis.json");
  const transcriptCount = newItems.filter((entry) => /transcript$/.test(entry.kind)).length;
  const freeVisionReceipt = freeVisionSelection ? freeVisionSelectionSummary(freeVisionSelection) : null;
  await writeAtomic(reportPath, `${JSON.stringify({ schema_version: "launchclip.source-media-analysis.v1", analyses, staged_references: stagedReferences, summary: { resources: resources.length, analyses: analyses.length, transcripts: transcriptCount }, ...(freeVisionReceipt ? { free_model_selection: freeVisionReceipt } : {}) }, null, 2)}\n`);
  const candidates = [derivedEvidencePath, reportPath, ...stagedReferences.map((entry) => entry.local_path), ...newItems.flatMap((entry) => entry.metadata.filter((item) => item.key === "words_path").map((item) => item.value))];
  const outputs = await Promise.all([...new Set(candidates)].map((filePath) => describeJobOutput(workspace, filePath)));
  await store.markSucceeded(jobId, outputs);
  return { stage: "source-media-analysis", status: "ready", workspace, evidence: evidencePath, report: reportPath, reference_videos: stagedReferences.map((entry) => entry.local_path), resources: resources.length, analyses: analyses.length, transcripts: transcriptCount, cached: false, ...(freeVisionReceipt ? { free_model_selection: freeVisionReceipt } : {}) };
  } catch (error) {
    await store.markFailed(jobId, error);
    throw error;
  }
}

function usesDiscoveredFreeVision(intake, options) {
  return options.selectFreeVision !== false
    && intake.model?.provider === "openrouter"
    && intake.model?.id === "openrouter/free";
}

async function selectFreeVisionAnalyst(options, adapters) {
  const selectModels = adapters.selectOpenRouterFreeVisionModels ?? selectOpenRouterFreeVisionModels;
  const probeModels = adapters.probeOpenRouterFreeVisionModels ?? probeOpenRouterFreeVisionModels;
  const selectionOptions = {
    statePath: options.freeVisionStatePath,
    topK: options.freeVisionCandidates ?? 3,
    refresh: Boolean(options.refreshFreeVisionModels)
  };
  let selection = await selectModels(selectionOptions);
  const probeOptions = { timeoutMs: Number(options.freeVisionProbeTimeoutMs ?? 15_000) };
  try {
    return await probeModels(selection, probeOptions);
  } catch (error) {
    if (selectionOptions.refresh) throw error;
    selection = await selectModels({ ...selectionOptions, refresh: true });
    return probeModels(selection, probeOptions);
  }
}

function freeVisionSelectionSummary(selection) {
  return {
    source: selection.source,
    state_path: selection.state_path,
    selected_model: selection.selected_model,
    verified_free_at: selection.verified_free_at,
    candidates: (selection.candidates ?? []).map((candidate) => ({ id: candidate.id, score: candidate.score, coverage: candidate.coverage })),
    warnings: [...(selection.warnings ?? [])]
  };
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

async function makeContactSheets(resource, mediaDir, options, adapters) {
  if (adapters.contactSheets) return normalizeContactSheets(await adapters.contactSheets(resource.location, mediaDir, options), resource, options);
  const output = path.join(mediaDir, `${resource.id}.contact-sheet.jpg`);
  if (adapters.contactSheet) {
    await adapters.contactSheet(resource.location, output, options);
    const duration = Number(options.durationSeconds) || null;
    return {
      sheets: [{ kind: "overview", path: output, sample_count: Number(options.samples ?? 12), start_seconds: 0, end_seconds: duration, sampling: "even" }],
      temporal_profile: duration ? { duration_seconds: duration, cuts: [], motion_bursts: [], family: null } : null
    };
  }
  const duration = Number(options.durationSeconds) || await probeDuration(resource.location, adapters.run ?? runCommand);
  const samples = Number(options.samples ?? 12);
  const columns = Number(options.columns ?? 4);
  const rows = Math.ceil(samples / columns);
  const interval = Math.max(.1, duration / samples);
  const run = adapters.run ?? runCommand;
  await run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-i", resource.location,
    "-vf", `fps=1/${interval},scale=480:-2,tile=${columns}x${rows}:padding=8:margin=8`,
    "-frames:v", "1", output
  ]);
  const motion = adapters.analyzeMotion
    ? await adapters.analyzeMotion(resource.location, options)
    : await analyzeRenderMotion(resource.location, {}, adapters.runRaw ? { run, runRaw: adapters.runRaw } : {});
  const sheets = [{ kind: "overview", path: output, sample_count: samples, start_seconds: 0, end_seconds: duration, interval_seconds: interval, sampling: "even" }];
  const hookSeconds = Math.min(duration, Number(options.hookSeconds ?? 4));
  const hookFps = Number(options.hookFps ?? 4);
  if (hookSeconds > .25 && hookFps > 0) {
    const hookFrames = Math.max(1, Math.ceil(hookSeconds * hookFps));
    const hookColumns = Math.min(4, hookFrames);
    const hookRows = Math.ceil(hookFrames / hookColumns);
    const hookPath = path.join(mediaDir, `${resource.id}.hook-strip.jpg`);
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-t", String(hookSeconds), "-i", resource.location,
      "-vf", `fps=${hookFps},scale=480:-2,tile=${hookColumns}x${hookRows}:padding=8:margin=8:nb_frames=${hookFrames}`,
      "-frames:v", "1", hookPath
    ]);
    sheets.push({ kind: "hook", path: hookPath, sample_count: hookFrames, start_seconds: 0, end_seconds: hookSeconds, interval_seconds: 1 / hookFps, sampling: "dense-hook" });
  }
  if (motion.cuts?.length) {
    const cutCount = Math.min(12, motion.cuts.length);
    const cutColumns = Math.min(4, cutCount);
    const cutRows = Math.ceil(cutCount / cutColumns);
    const cutPath = path.join(mediaDir, `${resource.id}.cut-strip.jpg`);
    await run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-i", resource.location,
      "-vf", `select='gte(scene,${Number(motion.cut_threshold ?? .35)})',scale=480:-2,tile=${cutColumns}x${cutRows}:padding=8:margin=8:nb_frames=${cutCount}`,
      "-frames:v", "1", cutPath
    ]);
    sheets.push({ kind: "cuts", path: cutPath, sample_count: cutCount, timestamps_seconds: motion.cuts.slice(0, cutCount), sampling: "detected-cut-boundaries" });
  }
  return {
    sheets,
    temporal_profile: {
      duration_seconds: motion.duration_seconds ?? duration,
      cuts: motion.cuts ?? [],
      cut_rate_per_minute: motion.cut_rate_per_minute ?? 0,
      motion_bursts: [...(motion.motion?.bursts ?? [])].sort((left, right) => Number(right.peak_energy) - Number(left.peak_energy)).slice(0, 12),
      motion_bursts_per_minute: motion.motion_bursts_per_minute ?? 0,
      hold_ratio: motion.motion?.hold_ratio ?? null,
      family: motion.family ?? null
    }
  };
}

function normalizeContactSheets(value, resource, options) {
  if (!value?.sheets?.length) throw new Error(`Temporal contact-sheet adapter produced no sheets for ${resource.id}`);
  return {
    sheets: value.sheets.map((sheet, index) => ({ kind: String(sheet.kind ?? (index ? `detail-${index}` : "overview")), ...sheet, path: path.resolve(sheet.path) })),
    temporal_profile: value.temporal_profile ?? (Number(options.durationSeconds) ? { duration_seconds: Number(options.durationSeconds), cuts: [], motion_bursts: [], family: null } : null)
  };
}

async function normalizeVisualImage(resource, mediaDir, adapters) {
  if (/\.(?:png|jpe?g|gif|webp)$/i.test(resource.location)) return resource.location;
  const output = path.join(mediaDir, `${resource.id}.image.png`);
  if (adapters.rasterizeImage) await adapters.rasterizeImage(resource.location, output);
  else await rasterizeImageWithLocalTools(resource.location, output, adapters.run ?? runCommand);
  const info = await stat(output);
  if (!info.isFile() || !info.size) throw new Error(`Image rasterization produced no PNG: ${resource.location}`);
  return output;
}

async function rasterizeImageWithLocalTools(source, output, run) {
  const attempts = [
    ["magick", [source, "-background", "none", "-resize", "1920x1920>", output]],
    ["convert", [source, "-background", "none", "-resize", "1920x1920>", output]],
    ["sips", ["-s", "format", "png", source, "--out", output]]
  ];
  const failures = [];
  for (const [command, args] of attempts) {
    try { await run(command, args); return; } catch (error) { failures.push(`${command}: ${error.message}`); }
  }
  throw new Error(`Rasterizing ${source} requires ImageMagick (magick/convert) or macOS sips. ${failures.join("; ")}`);
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
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".gif" ? "image/gif" : "image/jpeg";
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
