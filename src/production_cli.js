import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectEvidence } from "./evidence.js";
import { directFrames, fallbackFramesForVerification } from "./frame_director.js";
import { assembleHyperFrames } from "./hyperframes_assembler.js";
import { buildIntake, writeIntakeManifest } from "./intake.js";
import { planProduction } from "./creative_planner.js";
import { produceAudio } from "./production_audio.js";
import { assertVerificationFresh, renderDraftProduction, renderProduction, verifyProduction } from "./production_render.js";
import { critiqueProduction } from "./production_critic.js";
import { repairProduction } from "./production_repair.js";
import { analyzeSourceMedia } from "./source_media_analysis.js";
import { prepareSourceMedia } from "./production_source_media.js";
import { withProductionLease } from "./job_store.js";
import { resolveProductionEntities } from "./entity_resolution.js";
import { openProductionPreview } from "./production_preview.js";
import { runProductionReview } from "./production_review.js";
import { DEFAULT_NARRATED_MUSIC_VOLUME } from "./production_contracts.js";

export async function runProductionStage(command, target, flags = {}, adapters = {}) {
  if (command === "produce") return runProduction(target, flags, adapters);
  flags = productionFlags(flags);
  if (command === "production-review") return runInteractiveProductionReview(target, flags, adapters);
  const lease = adapters.withProductionLease ?? withProductionLease;
  return lease(target, async () => {
    if (command === "evidence") return collectEvidence(target, evidenceOptions(flags), adapters.evidence);
    if (command === "creative-plan") return (adapters.planProduction ?? planProduction)(target, plannerOptions(flags), adapters.planner);
    if (command === "direct-frames") return (adapters.directFrames ?? directFrames)(target, frameOptions(flags), adapters.frames);
    if (command === "production-audio") return produceAudio(target, audioOptions(flags), adapters.audio);
    if (command === "assemble") return assembleWithProducedAudio(target, flags);
    if (command === "production-verify") return verifyProduction(target, renderOptions(flags));
    if (command === "production-draft") return (adapters.renderDraftProduction ?? renderDraftProduction)(target, renderOptions(flags), adapters.render);
    if (command === "production-preview") return (adapters.openProductionPreview ?? openProductionPreview)(target, previewOptions(flags), adapters.preview);
    if (command === "production-render") return (adapters.renderProduction ?? renderProduction)(target, renderOptions(flags), adapters.render);
    if (command === "production-critique") return (adapters.critiqueProduction ?? critiqueProduction)(target, criticOptions(flags), adapters.critic);
    if (command === "production-repair") return (adapters.repairProduction ?? repairProduction)(target, await standaloneRepairOptions(target, flags, adapters), adapters.repair);
    if (command === "source-media") return (adapters.analyzeSourceMedia ?? analyzeSourceMedia)(target, mediaAnalysisOptions(flags), adapters.mediaAnalysis);
    if (command === "source-preprocess") return (adapters.prepareSourceMedia ?? prepareSourceMedia)(target, sourcePreprocessOptions(flags), adapters.sourcePreprocess);
    if (command === "resolve-entities") return (adapters.resolveProductionEntities ?? resolveProductionEntities)(target, entityOptions(flags));
    throw new Error(`Unknown production stage: ${command}`);
  });
}

async function standaloneRepairOptions(workspacePath, flags, adapters) {
  const options = repairOptions(flags);
  let verification;
  try {
    verification = JSON.parse(await readFile(path.join(path.resolve(workspacePath), "production", "qa", "verification.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return options;
    throw error;
  }
  if (verification?.status !== "failed") return options;
  if (verification.infrastructure_failed?.length) {
    const error = new Error(`Production repair is blocked because verification failed in the toolchain: ${verification.infrastructure_failed.join(", ")}. Fix the verifier environment and rerun verification.`);
    error.code = "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED";
    error.verification = verification;
    throw error;
  }
  try {
    const recorded = verification.inputs?.options ?? {};
    await (adapters.assertVerificationFresh ?? assertVerificationFresh)(workspacePath, verification, {
      strictAll: recorded.strict_all,
      timeoutMs: recorded.validate_timeout_ms,
      inspectSamples: recorded.inspect_samples,
      snapshotFrames: recorded.snapshot_frames
    });
  } catch (error) {
    if (error?.code === "LAUNCHCLIP_STALE_PRODUCTION_VERIFICATION") return options;
    throw error;
  }
  return { ...options, trigger: "verification", verification };
}

export async function runProduction(source, flags = {}, adapters = {}) {
  flags = productionFlags(flags);
  const normalized = await (adapters.buildIntake ?? buildIntake)(source, flags);
  const workspace = path.resolve(normalized.workspace);
  const lease = adapters.withProductionLease ?? withProductionLease;
  const production = await lease(workspace, async () => {
    const intake = adapters.writeIntake ? await adapters.writeIntake(source, flags) : await writeIntakeManifest(normalized);
    if (path.resolve(intake.workspace) !== workspace) throw new Error(`Intake workspace changed after lease acquisition: expected ${workspace}, got ${intake.workspace}`);
    return runProductionInWorkspace(workspace, flags, adapters);
  });
  if (!flags.review) return production;
  return runInteractiveProductionReview(workspace, flags, adapters, production);
}

async function runInteractiveProductionReview(workspacePath, flags, adapters, initial = null) {
  const workspace = path.resolve(workspacePath);
  const lease = adapters.withProductionLease ?? withProductionLease;
  return (adapters.runProductionReview ?? runProductionReview)(workspace, { initial }, {
    ...adapters.review,
    openPreview: (target) => (adapters.openProductionPreview ?? openProductionPreview)(target, previewOptions(flags), adapters.preview),
    approve: (target) => lease(target, () => (adapters.renderProduction ?? renderProduction)(target, { ...renderOptions(flags), approve: true }, adapters.render)),
    revise: (target, request) => lease(target, () => reviseProduction(target, flags, request, adapters)),
    getStatus: (target) => readProductionReviewStatus(target)
  });
}

async function reviseProduction(workspace, flags, request, adapters) {
  let requestedCritique = null;
  if (request.humanReviewRequest) {
    requestedCritique = await (adapters.critiqueProduction ?? critiqueProduction)(workspace, {
      ...criticOptions(flags),
      humanReviewRequest: request.humanReviewRequest
    }, adapters.critic);
  }
  const inferred = await standaloneRepairOptions(workspace, flags, adapters);
  const repair = await (adapters.repairProduction ?? repairProduction)(workspace, {
    ...inferred,
    ...(request.humanReviewRequest ? { trigger: "critique", verification: null } : {})
  }, adapters.repair);
  if (!repair.repaired?.length && !repair.actions?.plan_revised) {
    return {
      stage: "production-review-revision",
      status: repair.status === "not-needed" ? "awaiting-approval" : "needs-repair",
      workspace,
      requested_critique: requestedCritique,
      repair,
      draft: null
    };
  }
  let audio = null;
  let frames = null;
  if (repair.actions?.plan_revised) {
    const noAudio = Boolean(flags["no-audio"]);
    audio = await (adapters.produceAudio ?? produceAudio)(workspace, {
      ...audioOptions(flags),
      noVoice: noAudio || Boolean(flags["no-voice"]),
      noMusic: noAudio || Boolean(flags["no-music"]),
      noSfx: noAudio || Boolean(flags["no-sfx"])
    }, adapters.audio);
    if (audio.status === "needs-retiming" && !flags["allow-timing-drift"]) {
      throw new Error(`${audio.warnings.join(" ")} Revised narration timing still requires another plan repair.`);
    }
    frames = await (adapters.directFrames ?? directFrames)(workspace, frameOptions(flags), adapters.frames);
  }
  const assembly = adapters.assembleHyperFrames
    ? await adapters.assembleHyperFrames(workspace, await producedAssemblyOptions(workspace, flags))
    : await assembleWithProducedAudio(workspace, flags);
  const draft = await (adapters.renderDraftProduction ?? renderDraftProduction)(workspace, renderOptions(flags), adapters.render);
  return {
    stage: "production-review-revision",
    status: draft.status === "ready" && draft.critique?.verdict === "ship" ? "awaiting-approval" : "needs-repair",
    workspace,
    requested_critique: requestedCritique,
    repair,
    audio,
    frames: frames ? { generated: frames.generated, cached: frames.cached } : null,
    assembly,
    draft,
    critique: draft.critique
  };
}

async function readProductionReviewStatus(workspacePath) {
  const workspace = path.resolve(workspacePath);
  const [verification, critique] = await Promise.all([
    readOptionalJson(path.join(workspace, "production", "qa", "verification.json")),
    readOptionalJson(path.join(workspace, "production", "qa", "critique.json"))
  ]);
  const ready = verification?.status === "passed" && critique?.verdict === "ship";
  return {
    stage: "production-review-status",
    status: ready ? "awaiting-approval" : "needs-repair",
    workspace,
    verification: verification ? { status: verification.status, failed: verification.failed ?? [] } : null,
    critique: critique ? { verdict: critique.verdict, findings: critique.findings?.length ?? 0, summary: critique.summary ?? null } : null
  };
}

async function runProductionInWorkspace(workspace, flags, adapters) {
  const sourcePreprocess = await (adapters.prepareSourceMedia ?? prepareSourceMedia)(workspace, sourcePreprocessOptions(flags), adapters.sourcePreprocess);
  const evidence = await (adapters.collectEvidence ?? collectEvidence)(workspace, evidenceOptions(flags), adapters.evidence);
  const sourceMedia = await (adapters.analyzeSourceMedia ?? analyzeSourceMedia)(workspace, mediaAnalysisOptions(flags), adapters.mediaAnalysis);
  const entityResolution = await (adapters.resolveProductionEntities ?? resolveProductionEntities)(workspace, entityOptions(flags));
  let plan = await (adapters.planProduction ?? planProduction)(workspace, plannerOptions(flags), adapters.planner);
  const noAudio = Boolean(flags["no-audio"]);
  const requestedAudioOptions = {
    ...audioOptions(flags),
    noVoice: noAudio || Boolean(flags["no-voice"]),
    noMusic: noAudio || Boolean(flags["no-music"]),
    noSfx: noAudio || Boolean(flags["no-sfx"])
  };
  let audio = await (adapters.produceAudio ?? produceAudio)(workspace, requestedAudioOptions, adapters.audio);
  if (audio.status === "needs-retiming" && !flags["allow-timing-drift"]) {
    throw new Error(`${audio.warnings.join(" ")} Re-run creative planning with measured narration timing, or pass --allow-timing-drift to inspect the draft.`);
  }
  let frames = await (adapters.directFrames ?? directFrames)(workspace, frameOptions(flags), adapters.frames);
  let assemblyOptions = {
    voiceover: audio.voiceover,
    music: audio.music,
    sfxManifest: audio.sfx,
    musicVolume: numberOr(flags["music-volume"], DEFAULT_NARRATED_MUSIC_VOLUME)
  };
  let assembly = await (adapters.assembleHyperFrames ?? assembleHyperFrames)(workspace, assemblyOptions);
  let draft = null;
  let verification = null;
  let critique = null;
  const repairs = [];
  const localRepairs = [];
  let localVerificationRepairApplied = false;
  const maximumRepairPasses = numberOr(flags["max-repair-passes"], 2);
  while (true) {
    let trigger;
    try {
      draft = await (adapters.renderDraftProduction ?? renderDraftProduction)(workspace, renderOptions(flags), adapters.render);
      verification = draft.verification;
      critique = draft.critique;
      if (!["repair", "replan"].includes(critique.verdict)) break;
      trigger = "critique";
    } catch (error) {
      if (error?.code !== "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED") throw error;
      draft = null;
      critique = null;
      verification = error.verification;
      if (!localVerificationRepairApplied) {
        const localRepair = await (adapters.fallbackFramesForVerification ?? fallbackFramesForVerification)(workspace, verification);
        localVerificationRepairApplied = true;
        if (localRepair.repaired?.length) {
          localRepairs.push(localRepair);
          assembly = await (adapters.assembleHyperFrames ?? assembleHyperFrames)(workspace, assemblyOptions);
          continue;
        }
      }
      trigger = "verification";
    }
    if (repairs.length >= maximumRepairPasses) break;
    const repair = await (adapters.repairProduction ?? repairProduction)(workspace, {
      ...repairOptions(flags),
      trigger,
      verification
    }, adapters.repair);
    repairs.push({ pass: repairs.length + 1, trigger, ...repair });
    if (!repair.repaired?.length && !repair.actions?.plan_revised) break;
    if (repair.actions?.plan_revised) {
      plan = repair.plan ?? plan;
      audio = await (adapters.produceAudio ?? produceAudio)(workspace, requestedAudioOptions, adapters.audio);
      if (audio.status === "needs-retiming" && !flags["allow-timing-drift"]) {
        throw new Error(`${audio.warnings.join(" ")} Revised narration timing still requires another plan repair.`);
      }
      frames = await (adapters.directFrames ?? directFrames)(workspace, frameOptions(flags), adapters.frames);
      assemblyOptions = {
        voiceover: audio.voiceover,
        music: audio.music,
        sfxManifest: audio.sfx,
        musicVolume: numberOr(flags["music-volume"], DEFAULT_NARRATED_MUSIC_VOLUME)
      };
    }
    assembly = await (adapters.assembleHyperFrames ?? assembleHyperFrames)(workspace, assemblyOptions);
  }
  const readyForApproval = draft?.status === "ready" && critique?.verdict === "ship";
  return {
    stage: "produce",
    status: readyForApproval ? "awaiting-approval" : "needs-repair",
    workspace,
    source_preprocess: sourcePreprocess,
    evidence,
    source_media: sourceMedia,
    entity_resolution: entityResolution,
    plan,
    audio,
    frames: { generated: frames.generated, cached: frames.cached },
    assembly,
    draft,
    verification,
    critique,
    local_repairs: localRepairs,
    repairs,
    next: readyForApproval
      ? `Review ${draft.video} and ${verification.snapshots}, then run launchclip production-render ${workspace} --approve.`
      : verification?.status === "failed"
        ? `Review ${verification.qa}; run production-repair after resolving any unscoped verification findings.`
        : `Review ${critique?.critique ?? "production/qa/critique.json"}; resolve remaining findings before final approval.`
  };
}

function entityOptions(flags) {
  return { brandAssetsDir: flags["brand-assets-dir"] };
}

function sourcePreprocessOptions(flags) {
  return {
    trimSilence: !flags["no-trim-silence"],
    silenceDuration: numberOr(flags["silence-duration"], 0.45),
    silencePadding: numberOr(flags["silence-padding"], 0.12),
    crf: numberOr(flags["source-crf"], 18)
  };
}

async function assembleWithProducedAudio(workspace, flags) {
  return assembleHyperFrames(workspace, await producedAssemblyOptions(workspace, flags));
}

async function producedAssemblyOptions(workspace, flags) {
  let audio = null;
  try {
    audio = JSON.parse(await readFile(path.join(path.resolve(workspace), "production", "media", "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    voiceover: audio?.voiceover?.path,
    music: audio?.music?.path,
    sfxManifest: audio?.sfx_manifest,
    musicVolume: numberOr(flags["music-volume"], DEFAULT_NARRATED_MUSIC_VOLUME)
  };
}

function evidenceOptions(flags) {
  return { maxItemChars: numberOr(flags["max-evidence-chars"], 60_000) };
}

function mediaAnalysisOptions(flags) {
  return {
    samples: numberOr(flags["media-samples"], 12),
    columns: numberOr(flags["media-columns"], 4),
    reasoning: flags["media-reasoning"] ?? "high",
    transcriptionModel: flags["transcription-model"] ?? "scribe_v2",
    transcribeAll: Boolean(flags["transcribe-all"]),
    background: !flags.foreground
  };
}

function plannerOptions(flags) {
  return {
    background: !flags.foreground,
    maxOutputTokens: numberOr(flags["max-output-tokens"], 48_000),
    maxAttempts: numberOr(flags["max-attempts"], 3),
    semanticAttempts: numberOr(flags["plan-semantic-attempts"], 2),
    planningMode: flags["planning-mode"] ?? "auto",
    hierarchicalThresholdSeconds: numberOr(flags["hierarchical-threshold"], 180),
    chapterConcurrency: numberOr(flags["chapter-concurrency"], 3),
    outlineMaxOutputTokens: numberOr(flags["outline-max-output-tokens"], 24_000),
    chapterMaxOutputTokens: numberOr(flags["chapter-max-output-tokens"], 40_000),
    visualHistoryDir: flags["visual-history-dir"],
    visualHistoryLimit: numberOr(flags["visual-history-limit"], 8),
    visualSimilarityLimit: numberOr(flags["visual-similarity-limit"], 0.58),
    sfxDir: flags["sfx-dir"]
  };
}

function frameOptions(flags) {
  return {
    background: !flags.foreground,
    concurrency: numberOr(flags.concurrency, 4),
    semanticAttempts: numberOr(flags["semantic-attempts"], 2),
    reasoning: flags["frame-reasoning"] ?? "high",
    routes: stageModelRoutes(flags, "frame"),
    pendingReasoning: flags["pending-frame-reasoning"],
    maxOutputTokens: numberOr(flags["frame-max-output-tokens"], 36_000),
    maxFrameCostUsd: numberOr(flags["max-frame-cost-usd"], undefined),
    allowFallback: Boolean(flags["allow-frame-fallback"])
  };
}

function audioOptions(flags) {
  return {
    noVoice: Boolean(flags["no-voice"]),
    noMusic: Boolean(flags["no-music"]),
    noSfx: Boolean(flags["no-sfx"]),
    voiceId: flags["voice-id"],
    voiceModel: flags["voice-model"],
    musicModel: flags["music-model"],
    sfxDir: flags["sfx-dir"],
    words: flags.words
  };
}

function renderOptions(flags) {
  const policy = modelPolicy(flags);
  return {
    approve: Boolean(flags.approve),
    output: flags.output,
    quality: flags.quality,
    draftQuality: flags["draft-quality"] ?? "draft",
    draftOutput: flags["draft-output"],
    workers: flags.workers,
    inspectSamples: numberOr(flags["inspect-samples"], 15),
    shotInspectConcurrency: numberOr(flags["shot-inspect-concurrency"], 2),
    snapshotFrames: numberOr(flags["snapshot-frames"], 12),
    references: flags["reference-video"],
    durationToleranceSeconds: flags["duration-tolerance"],
    maximumHoldRatio: flags["maximum-hold-ratio"],
    minimumBurstsPerMinute: flags["minimum-bursts-per-minute"],
    musicVolume: flags["music-volume"],
    criticModel: flags["critic-model"] ?? (policy === "quality" ? "gpt-5.6" : "gpt-5.6-terra"),
    criticReasoning: flags["critic-reasoning"] ?? (policy === "quality" ? "xhigh" : "high"),
    criticPro: Boolean(flags["critic-pro"]),
    maxCriticSnapshots: numberOr(flags["critic-snapshots"], 12),
    background: !flags.foreground
  };
}

function previewOptions(flags) {
  return {
    port: flags.port,
    open: !flags["no-open"]
  };
}

function criticOptions(flags) {
  const policy = modelPolicy(flags);
  return {
    model: flags["critic-model"] ?? (policy === "quality" ? "gpt-5.6" : "gpt-5.6-terra"),
    reasoning: flags["critic-reasoning"] ?? (policy === "quality" ? "xhigh" : "high"),
    pro: Boolean(flags["critic-pro"]),
    maxSnapshots: numberOr(flags["critic-snapshots"], 12)
  };
}

function repairOptions(flags) {
  const policy = modelPolicy(flags);
  return {
    model: flags["repair-model"] ?? (policy === "quality" ? "gpt-5.6" : "gpt-5.6-luna"),
    reasoning: flags["repair-reasoning"] ?? (policy === "quality" ? "high" : "medium"),
    routes: stageModelRoutes(flags, "repair"),
    semanticAttempts: numberOr(flags["repair-semantic-attempts"], 2),
    maxSnapshots: numberOr(flags["repair-snapshots"], 8),
    concurrency: numberOr(flags.concurrency, policy === "local-first" ? 1 : 3),
    maxOutputTokens: numberOr(flags["repair-max-output-tokens"], 8_000),
    maxPatchRatio: ratioOr(flags["max-patch-ratio"], .35),
    maxIssuesPerShot: numberOr(flags["repair-issues-per-shot"], 4),
    supportsImages: flags["repair-text-only"] ? false : undefined,
    sourceMode: flags["repair-scoped-source"] ? "scoped" : undefined,
    background: !flags.foreground
  };
}

function stageModelRoutes(flags, stage) {
  const explicit = flags[`${stage}-route`];
  if (explicit != null) return explicit;
  const model = flags[`${stage}-model`] ?? flags.model;
  const provider = flags[`${stage}-provider`];
  const reasoning = flags[`${stage}-reasoning`];
  if (model || provider) return [`${provider ?? "openai"}:${model ?? (provider === "ollama" ? flags["local-model"] ?? "qwen2.5-coder:latest" : "gpt-5.6-luna")}@${reasoning ?? "medium"}`];
  const policy = modelPolicy(flags);
  if (policy === "quality") return ["openai:gpt-5.6@high"];
  const cloud = ["openai:gpt-5.6-luna@medium", "openai:gpt-5.6-terra@high", "openai:gpt-5.6@high"];
  return policy === "local-first" ? [`ollama:${flags["local-model"] ?? "qwen2.5-coder:latest"}@none`, ...cloud] : cloud;
}

function modelPolicy(flags) {
  const policy = String(flags["model-policy"] ?? "cost-aware").trim().toLowerCase();
  if (!["cost-aware", "local-first", "quality"].includes(policy)) throw new Error(`Unsupported --model-policy: ${policy}. Supported: cost-aware, local-first, quality`);
  return policy;
}

function productionFlags(flags) {
  if (!flags["fast-eval"]) return flags;
  return {
    ...flags,
    reasoning: flags.reasoning ?? "high",
    "media-samples": flags["media-samples"] ?? "8",
    "media-reasoning": flags["media-reasoning"] ?? "medium",
    "max-output-tokens": flags["max-output-tokens"] ?? "32000",
    "outline-max-output-tokens": flags["outline-max-output-tokens"] ?? "18000",
    "chapter-max-output-tokens": flags["chapter-max-output-tokens"] ?? "28000",
    "chapter-concurrency": flags["chapter-concurrency"] ?? "3",
    "plan-semantic-attempts": flags["plan-semantic-attempts"] ?? "2",
    "frame-reasoning": flags["frame-reasoning"] ?? "medium",
    "frame-max-output-tokens": flags["frame-max-output-tokens"] ?? "20000",
    "semantic-attempts": flags["semantic-attempts"] ?? "1",
    concurrency: flags.concurrency ?? "1",
    "max-frame-cost-usd": flags["max-frame-cost-usd"] ?? "5",
    "critic-reasoning": flags["critic-reasoning"] ?? "high",
    "critic-snapshots": flags["critic-snapshots"] ?? "8",
    "repair-reasoning": flags["repair-reasoning"] ?? "medium",
    "repair-max-output-tokens": flags["repair-max-output-tokens"] ?? "6000",
    "repair-semantic-attempts": flags["repair-semantic-attempts"] ?? "1",
    "repair-snapshots": flags["repair-snapshots"] ?? "6",
    "snapshot-frames": flags["snapshot-frames"] ?? "6",
    "inspect-samples": flags["inspect-samples"] ?? "9",
    "shot-inspect-concurrency": flags["shot-inspect-concurrency"] ?? "3",
    "max-repair-passes": flags["max-repair-passes"] ?? "1"
  };
}

function numberOr(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Expected a positive number, received ${value}`);
  return number;
}

function ratioOr(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) throw new Error(`Expected a ratio greater than 0 and at most 1, received ${value}`);
  return number;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
