import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectEvidence } from "./evidence.js";
import { directFrames } from "./frame_director.js";
import { assembleHyperFrames } from "./hyperframes_assembler.js";
import { buildIntake, writeIntakeManifest } from "./intake.js";
import { planProduction } from "./creative_planner.js";
import { produceAudio } from "./production_audio.js";
import { assertVerificationFresh, renderDraftProduction, renderProduction, verifyProduction } from "./production_render.js";
import { critiqueProduction, FREE_VISION_UNAVAILABLE_CODE } from "./production_critic.js";
import { repairProduction } from "./production_repair.js";
import { analyzeSourceMedia } from "./source_media_analysis.js";
import { prepareSourceMedia } from "./production_source_media.js";
import { withProductionLease } from "./job_store.js";
import { resolveProductionEntities } from "./entity_resolution.js";
import { openProductionPreview } from "./production_preview.js";
import { runProductionReview } from "./production_review.js";
import { DEFAULT_NARRATED_MUSIC_VOLUME } from "./production_contracts.js";
import { probeOpenRouterFreeModels, recordOpenRouterFreeModelOutcome, selectOpenRouterFreeModels } from "./free_model_selector.js";

export async function runProductionStage(command, target, flags = {}, adapters = {}) {
  if (command === "produce") return runProduction(target, flags, adapters);
  flags = productionFlags(flags);
  if (command === "production-review") return runInteractiveProductionReview(target, flags, adapters);
  const lease = adapters.withProductionLease ?? withProductionLease;
  return lease(target, async () => {
    if (command === "evidence") return collectEvidence(target, evidenceOptions(flags), adapters.evidence);
    if (command === "creative-plan") return (adapters.planProduction ?? planProduction)(target, plannerOptions(flags), adapters.planner);
    if (command === "direct-frames") return runFrameDirection(target, flags, adapters);
    if (command === "production-audio") return produceAudio(target, audioOptions(flags), adapters.audio);
    if (command === "assemble") return assembleWithProducedAudio(target, flags);
    if (command === "production-verify") return verifyProduction(target, renderOptions(flags));
    if (command === "production-draft") return (adapters.renderDraftProduction ?? renderDraftProduction)(target, renderOptions(flags), adapters.render);
    if (command === "production-preview") return (adapters.openProductionPreview ?? openProductionPreview)(target, previewOptions(flags), adapters.preview);
    if (command === "production-render") return (adapters.renderProduction ?? renderProduction)(target, renderOptions(flags), adapters.render);
    if (command === "production-critique") return (adapters.critiqueProduction ?? critiqueProduction)(target, criticOptions(flags), adapters.critic);
    if (command === "production-repair") return runProductionRepair(target, flags, await standaloneRepairOptions(target, flags, adapters), adapters);
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

async function runProductionRepair(workspace, flags, options, adapters) {
  const repair = adapters.repairProduction ?? repairProduction;
  if (!usesDiscoveredFreeRepair(flags)) return repair(workspace, options, adapters.repair);

  const selection = await selectLiveOpenRouterFreeModels(flags, adapters);
  const repairRoutes = [...selection.routes];
  if (!repairRoutes.some((route) => /^openrouter:openrouter\/free(?:@|$)/i.test(route))) repairRoutes.push("openrouter:openrouter/free@none");
  const selectedOptions = {
    ...options,
    provider: "openrouter",
    model: selection.selected_model,
    reasoning: "none",
    routes: repairRoutes,
    supportsImages: false,
    sourceMode: "scoped"
  };
  const result = await repair(workspace, selectedOptions, adapters.repair);
  return { ...result, free_model_selection: freeModelSelectionSummary(selection) };
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
  const inferred = await standaloneRepairOptions(workspace, flags, adapters);
  let requestedCritique = null;
  if (request.humanReviewRequest) {
    requestedCritique = await (adapters.critiqueProduction ?? critiqueProduction)(workspace, {
      ...criticOptions(flags),
      humanReviewRequest: request.humanReviewRequest
    }, adapters.critic);
  }
  const repair = await runProductionRepair(workspace, flags, {
    ...inferred,
    ...(request.humanReviewRequest ? { trigger: "critique", verification: null } : {})
  }, adapters);
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
    frames = await runFrameDirection(workspace, flags, adapters);
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
    frames: frames ? { generated: frames.generated, cached: frames.cached, ...(frames.free_model_selection ? { free_model_selection: frames.free_model_selection } : {}) } : null,
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
  let frames = await runFrameDirection(workspace, flags, adapters);
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
  const maximumRepairPasses = numberOr(flags["max-repair-passes"], 2);
  let visionReviewRequested = false;
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
      trigger = "verification";
    }
    if (repairs.length >= maximumRepairPasses) {
      draft = await renderVisionSupervisedDraft(workspace, flags, adapters);
      verification = draft.verification;
      critique = draft.critique;
      break;
    }
    if (trigger === "verification" && repairs.length > 0 && !visionReviewRequested) {
      try {
        critique = await (adapters.critiqueProduction ?? critiqueProduction)(workspace, criticOptions(flags), adapters.critic);
      } catch (error) {
        if (flags["model-policy"] !== "free" || error?.code !== FREE_VISION_UNAVAILABLE_CODE) throw error;
        draft = await renderVisionSupervisedDraft(workspace, flags, adapters, error);
        verification = draft.verification;
        critique = draft.critique;
        break;
      }
      visionReviewRequested = true;
      if (!["repair", "replan"].includes(critique.verdict)) {
        draft = await renderVisionSupervisedDraft(workspace, flags, adapters);
        verification = draft.verification;
        critique = draft.critique;
        break;
      }
      trigger = "critique";
    }
    const repair = await runProductionRepair(workspace, flags, {
      ...repairOptions(flags),
      trigger,
      verification
    }, adapters);
    repairs.push({ pass: repairs.length + 1, trigger, ...repair });
    if (!repair.repaired?.length && !repair.actions?.plan_revised) break;
    if (repair.actions?.plan_revised) {
      plan = repair.plan ?? plan;
      audio = await (adapters.produceAudio ?? produceAudio)(workspace, requestedAudioOptions, adapters.audio);
      if (audio.status === "needs-retiming" && !flags["allow-timing-drift"]) {
        throw new Error(`${audio.warnings.join(" ")} Revised narration timing still requires another plan repair.`);
      }
      frames = await runFrameDirection(workspace, flags, adapters);
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
  if (!readyForApproval && ["repair", "replan"].includes(critique?.verdict)) {
    frames = await rotateCritiqueRejectedFreeModel(frames, adapters);
  }
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
    frames: { generated: frames.generated, cached: frames.cached, ...(frames.free_model_selection ? { free_model_selection: frames.free_model_selection } : {}) },
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

function renderVisionSupervisedDraft(workspace, flags, adapters, visionUnavailableError = null) {
  return (adapters.renderDraftProduction ?? renderDraftProduction)(workspace, {
    ...renderOptions(flags),
    allowContentVerificationFailures: true,
    allowFreeVisionUnavailable: flags["model-policy"] === "free",
    ...(visionUnavailableError ? { visionUnavailableError } : {})
  }, adapters.render);
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

async function runFrameDirection(workspace, flags, adapters) {
  const direct = adapters.directFrames ?? directFrames;
  const options = frameOptions(flags);
  if (!usesDiscoveredFreeFrames(flags)) return direct(workspace, options, adapters.frames);

  const recordOutcome = adapters.recordOpenRouterFreeModelOutcome ?? recordOpenRouterFreeModelOutcome;
  const probeModels = adapters.probeOpenRouterFreeModels ?? probeOpenRouterFreeModels;
  let selection = await selectLiveOpenRouterFreeModels(flags, adapters);
  options.routes = selection.routes;
  options.stableRouteCache = true;
  options.leanPrompt = true;
  options.sceneBlueprint = true;
  options.fallbackMode = "error";
  options.allowFallback = false;
  options.failClosedConcurrency = Math.min(options.concurrency, numberOr(flags["free-scene-concurrency"], 3));
  options.blueprintSemanticAttempts = numberOr(flags["blueprint-semantic-attempts"], 2);
  options.blueprintMaxOutputTokens = numberOr(flags["blueprint-max-output-tokens"], 3_000);
  options.blueprintTemperature = numberOr(flags["blueprint-temperature"], .45);
  options.blueprintRepairTemperature = numberOr(flags["blueprint-repair-temperature"], .15);
  options.frameTemperature = numberOr(flags["frame-temperature"], .4);
  options.frameRepairTemperature = numberOr(flags["frame-repair-temperature"], .1);
  if (Number.isFinite(Number(selection.max_completion_tokens)) && Number(selection.max_completion_tokens) > 0) {
    options.maxOutputTokens = Math.min(options.maxOutputTokens, Number(selection.max_completion_tokens));
  }
  const attemptedModelIds = new Set(selection.routes.map(openRouterRouteModelId));
  while (true) {
    try {
      const result = await direct(workspace, options, adapters.frames);
      const observedResult = { ...result, frames: (result.frames ?? []).filter((frame) => !frame.recovered) };
      let recorded = selection;
      try {
        recorded = await recordOutcome(selection, { result: observedResult }) ?? selection;
      } catch (error) {
        recorded = { ...selection, warnings: [...(selection.warnings ?? []), `Could not update free-model outcome state: ${error.message}`] };
      }
      return { ...result, free_model_selection: freeModelSelectionSummary(recorded) };
    } catch (error) {
      let rotated = selection;
      try {
        rotated = await recordOutcome(selection, { error }) ?? selection;
      } catch (stateError) {
        error.free_model_state_error = stateError.message;
      }
      const remaining = (rotated.candidates ?? []).filter((candidate) => !attemptedModelIds.has(candidate.id));
      if (!remaining.length) throw error;
      try {
        selection = await probeModels(rotated, {
          timeoutMs: numberOr(flags["free-model-probe-timeout-ms"], 15_000),
          excludeIds: [...attemptedModelIds],
          stopAfterFirstSuccess: true
        });
      } catch (probeError) {
        error.free_model_probe_error = probeError.message;
        throw error;
      }
      options.routes = selection.routes.filter((route) => !attemptedModelIds.has(openRouterRouteModelId(route)));
      if (!options.routes.length) throw error;
      if (Number.isFinite(Number(selection.max_completion_tokens)) && Number(selection.max_completion_tokens) > 0) {
        options.maxOutputTokens = Math.min(options.maxOutputTokens, Number(selection.max_completion_tokens));
      }
      for (const route of options.routes) attemptedModelIds.add(openRouterRouteModelId(route));
    }
  }
}

function openRouterRouteModelId(route) {
  return String(route).replace(/^openrouter:/, "").replace(/@[^@]+$/, "");
}

async function rotateCritiqueRejectedFreeModel(frames, adapters) {
  if (!frames?.free_model_selection?.state_path) return frames;
  const recordOutcome = adapters.recordOpenRouterFreeModelOutcome ?? recordOpenRouterFreeModelOutcome;
  try {
    const selection = await recordOutcome(frames.free_model_selection, { error: new Error("The authored frames did not pass production critique") });
    return { ...frames, free_model_selection: freeModelSelectionSummary(selection ?? frames.free_model_selection) };
  } catch (error) {
    return {
      ...frames,
      free_model_selection: {
        ...frames.free_model_selection,
        warnings: [...(frames.free_model_selection.warnings ?? []), `Could not rotate the critique-rejected free model: ${error.message}`]
      }
    };
  }
}

function usesDiscoveredFreeFrames(flags) {
  return modelPolicy(flags) === "free"
    && flags["frame-route"] == null
    && flags["frame-model"] == null
    && flags["frame-provider"] == null
    && flags.model == null;
}

function usesDiscoveredFreeRepair(flags) {
  return modelPolicy(flags) === "free"
    && flags["repair-route"] == null
    && flags["repair-model"] == null
    && flags["repair-provider"] == null
    && flags.model == null;
}

function usesDiscoveredFreeCritic(flags) {
  return modelPolicy(flags) === "free"
    && flags["critic-route"] == null
    && flags["critic-model"] == null
    && flags["critic-provider"] == null
    && flags.model == null;
}

async function selectLiveOpenRouterFreeModels(flags, adapters) {
  const selectModels = adapters.selectOpenRouterFreeModels ?? selectOpenRouterFreeModels;
  const probeModels = adapters.probeOpenRouterFreeModels ?? probeOpenRouterFreeModels;
  const selectionOptions = {
    statePath: flags["free-model-state"],
    topK: flags["free-model-candidates"] ?? 5,
    refresh: Boolean(flags["refresh-free-models"]),
    role: "visual-code-author",
    contract: "frame-director.v5"
  };
  let selection = await selectModels(selectionOptions);
  if (!selection?.routes?.length) throw new Error("OpenRouter free-model selection returned no visual-code routes");
  const probeOptions = { timeoutMs: numberOr(flags["free-model-probe-timeout-ms"], 15_000) };
  try {
    return await probeModels(selection, probeOptions);
  } catch (error) {
    if (selectionOptions.refresh) throw error;
    selection = await selectModels({ ...selectionOptions, refresh: true });
    if (!selection?.routes?.length) throw new Error("OpenRouter free-model refresh returned no visual-code routes", { cause: error });
    return probeModels(selection, probeOptions);
  }
}

function freeModelSelectionSummary(selection) {
  return {
    source: selection.source,
    state_path: selection.state_path,
    selected_model: selection.selected_model,
    verified_free_at: selection.verified_free_at,
    candidates: (selection.candidates ?? []).map((candidate) => ({ id: candidate.id, score: candidate.score, coverage: candidate.coverage })),
    warnings: [...(selection.warnings ?? [])]
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
    freeVisionStatePath: flags["free-vision-model-state"],
    freeVisionCandidates: numberOr(flags["free-vision-model-candidates"], 3),
    refreshFreeVisionModels: Boolean(flags["refresh-free-vision-models"] || flags["refresh-free-models"]),
    freeVisionProbeTimeoutMs: numberOr(flags["free-vision-probe-timeout-ms"], 15_000),
    background: !flags.foreground
  };
}

function plannerOptions(flags) {
  const free = modelPolicy(flags) === "free";
  return {
    background: !flags.foreground,
    maxOutputTokens: numberOr(flags["max-output-tokens"], free ? 20_000 : 48_000),
    evidenceChars: numberOr(flags["plan-evidence-chars"], free ? 48_000 : 220_000),
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
    freeModelStatePath: flags["free-model-state"],
    freeModelCandidates: numberOr(flags["free-model-candidates"], 5),
    refreshFreeModels: Boolean(flags["refresh-free-models"]),
    freeModelProbeTimeoutMs: numberOr(flags["free-model-probe-timeout-ms"], 15_000),
    freeModelRequestTimeoutMs: numberOr(flags["free-model-request-timeout-ms"], 180_000),
    freeSemanticFallbacks: numberOr(flags["free-plan-semantic-fallbacks"], 1),
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
    criticRoute: singleModelRoute(flags["critic-route"] ?? (policy === "free" ? "openrouter:openrouter/free@none" : undefined), "--critic-route"),
    criticModel: flags["critic-model"] ?? (policy === "quality" ? "gpt-5.6" : "gpt-5.6-terra"),
    criticReasoning: flags["critic-reasoning"] ?? (policy === "quality" ? "xhigh" : "high"),
    criticPro: Boolean(flags["critic-pro"]),
    maxCriticSnapshots: numberOr(flags["critic-snapshots"], 12),
    selectFreeVision: usesDiscoveredFreeCritic(flags),
    freeVisionStatePath: flags["free-vision-model-state"],
    freeVisionCandidates: numberOr(flags["free-vision-model-candidates"], 3),
    refreshFreeVisionModels: Boolean(flags["refresh-free-vision-models"] || flags["refresh-free-models"]),
    freeVisionProbeTimeoutMs: numberOr(flags["free-vision-probe-timeout-ms"], 15_000),
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
    route: singleModelRoute(flags["critic-route"] ?? (policy === "free" ? "openrouter:openrouter/free@none" : undefined), "--critic-route"),
    model: flags["critic-model"] ?? (policy === "quality" ? "gpt-5.6" : "gpt-5.6-terra"),
    reasoning: flags["critic-reasoning"] ?? (policy === "quality" ? "xhigh" : "high"),
    pro: Boolean(flags["critic-pro"]),
    maxSnapshots: numberOr(flags["critic-snapshots"], 12),
    selectFreeVision: usesDiscoveredFreeCritic(flags),
    freeVisionStatePath: flags["free-vision-model-state"],
    freeVisionCandidates: numberOr(flags["free-vision-model-candidates"], 3),
    refreshFreeVisionModels: Boolean(flags["refresh-free-vision-models"] || flags["refresh-free-models"]),
    freeVisionProbeTimeoutMs: numberOr(flags["free-vision-probe-timeout-ms"], 15_000)
  };
}

function repairOptions(flags) {
  const policy = modelPolicy(flags);
  const routes = stageModelRoutes(flags, "repair");
  const leanFreeRoute = isOpenRouterFreeRoute(routes);
  return {
    provider: flags["repair-provider"] ?? (policy === "free" ? "openrouter" : undefined),
    model: flags["repair-model"] ?? (policy === "free" ? "openrouter/free" : policy === "quality" ? "gpt-5.6" : "gpt-5.6-luna"),
    reasoning: flags["repair-reasoning"] ?? (policy === "free" ? "none" : policy === "quality" ? "high" : "medium"),
    routes,
    semanticAttempts: numberOr(flags["repair-semantic-attempts"], 2),
    maxSnapshots: numberOr(flags["repair-snapshots"], 8),
    concurrency: numberOr(flags.concurrency, policy === "local-first" ? 1 : 3),
    maxOutputTokens: numberOr(flags["repair-max-output-tokens"], 8_000),
    maxPatchRatio: ratioOr(flags["max-patch-ratio"], .35),
    maxIssuesPerShot: numberOr(flags["repair-issues-per-shot"], 4),
    supportsImages: flags["repair-text-only"] || leanFreeRoute ? false : undefined,
    sourceMode: flags["repair-scoped-source"] || leanFreeRoute ? "scoped" : undefined,
    background: !flags.foreground
  };
}

function isOpenRouterFreeRoute(routes) {
  const values = Array.isArray(routes) ? routes : [routes];
  return values.length > 0 && values.every((route) => /^openrouter:(?:openrouter\/free|[^@]+:free)(?:@|$)/i.test(String(route ?? "")));
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
  if (policy === "free") return ["openrouter:openrouter/free@none"];
  const cloud = ["openai:gpt-5.6-luna@medium", "openai:gpt-5.6-terra@high", "openai:gpt-5.6@high"];
  return policy === "local-first" ? [`ollama:${flags["local-model"] ?? "qwen2.5-coder:latest"}@none`, ...cloud] : cloud;
}

function modelPolicy(flags) {
  const policy = String(flags["model-policy"] ?? "cost-aware").trim().toLowerCase();
  if (!["cost-aware", "local-first", "quality", "free"].includes(policy)) throw new Error(`Unsupported --model-policy: ${policy}. Supported: cost-aware, local-first, quality, free`);
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

function singleModelRoute(value, label) {
  if (Array.isArray(value)) throw new Error(`${label} accepts one pinned route`);
  return value;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
