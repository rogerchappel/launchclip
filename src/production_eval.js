import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assembleHyperFrames } from "./hyperframes_assembler.js";
import { planProduction } from "./creative_planner.js";
import { collectEvidence } from "./evidence.js";
import { directFrames } from "./frame_director.js";
import { buildIntake, writeIntakeManifest } from "./intake.js";
import { produceAudio } from "./production_audio.js";
import { PRODUCTION_PLAN_VERSION } from "./production_contracts.js";
import { verifyProduction } from "./production_render.js";
import { analyzeSourceMedia } from "./source_media_analysis.js";

const execFileAsync = promisify(execFile);

export const PRODUCTION_EVALUATION_VERSION = "launchclip.production-evaluation.v1";
export const PRODUCTION_EVALUATION_SCENARIOS = Object.freeze([
  "saas-16x9",
  "topic-pdf",
  "supplied-audio",
  "presenter-video",
  "hierarchical-longform"
]);

export async function runProductionEvaluationMatrix(outputPath, options = {}, adapters = {}) {
  const root = path.resolve(outputPath ?? path.join(".launchclip", "eval-matrix", "v1"));
  await prepareOutput(root, Boolean(options.force));
  const createFixtures = adapters.createFixtures ?? createEvaluationFixtures;
  const executeScenario = adapters.executeScenario ?? executeEvaluationScenario;
  const fixtures = await createFixtures(path.join(root, "fixtures"), { run: adapters.run ?? execFileAsync });
  const definitions = evaluationScenarioDefinitions(fixtures, root);
  const selected = selectScenarios(definitions, options.scenarios);
  const startedAt = new Date();
  const scenarios = [];

  for (const definition of selected) {
    const start = Date.now();
    const result = await executeScenario(definition, {
      inspectSamples: Number(options.inspectSamples ?? 7),
      snapshotFrames: Number(options.snapshotFrames ?? 5),
      requireVerificationCache: options.requireVerificationCache !== false
    }, adapters);
    scenarios.push({ ...result, elapsed_ms: Date.now() - start });
  }

  const finishedAt = new Date();
  const report = {
    schema_version: PRODUCTION_EVALUATION_VERSION,
    status: scenarios.every((entry) => entry.status === "passed") ? "passed" : "failed",
    provider_mode: "frozen-no-openai-or-elevenlabs-credentials",
    network_boundary: "HyperFrames projects still load GSAP from jsDelivr; this matrix is keyless, not fully network-isolated.",
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    elapsed_ms: finishedAt.getTime() - startedAt.getTime(),
    scenarios
  };
  const reportPath = path.join(root, "matrix-report.json");
  await writeAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return {
    stage: "production-evaluation",
    status: report.status,
    root,
    report: reportPath,
    scenarios: scenarios.length,
    snapshots: scenarios.flatMap((entry) => entry.snapshots.map((snapshot) => path.join(root, snapshot)))
  };
}

export function evaluationScenarioDefinitions(fixtures, root) {
  const workspace = (id) => path.join(root, "scenarios", id);
  return [
    {
      id: "saas-16x9",
      source: "https://launchclip-eval.invalid/product",
      flags: {
        kind: "product", resource: fixtures.screenVideo, aspect: "16:9", duration: "6",
        prompt: "Show how recorded product proof becomes a coherent launch narrative.",
        audience: "SaaS founders", cta: "Start the evaluation", out: workspace("saas-16x9")
      },
      planningMode: "single",
      audioMode: "none",
      expected: { aspect: "16:9", narration: "generated", visualAnalysis: true, screenMedia: true }
    },
    {
      id: "topic-pdf",
      source: fixtures.paperPdf,
      flags: {
        kind: "topic", aspect: "9:16", duration: "6",
        prompt: "Explain the paper's evidence-to-motion idea with a concise visual model.",
        audience: "AI researchers", out: workspace("topic-pdf")
      },
      planningMode: "single",
      audioMode: "none",
      expected: { aspect: "9:16", narration: "generated", pdfEvidence: true }
    },
    {
      id: "supplied-audio",
      source: fixtures.voiceoverAudio,
      flags: {
        kind: "voiceover", transcript: fixtures.voiceoverTranscript, aspect: "9:16", duration: "6",
        prompt: "Build every visual around the authoritative supplied narration.",
        audience: "technical founders", out: workspace("supplied-audio")
      },
      planningMode: "single",
      audioMode: "supplied",
      expected: { aspect: "9:16", narration: "supplied", suppliedAudio: true }
    },
    {
      id: "presenter-video",
      source: "Presenter-guided product narrative",
      flags: {
        kind: "topic", voiceover: fixtures.presenterVideo, transcript: fixtures.presenterTranscript,
        aspect: "9:16", duration: "6", prompt: "Use a presenter and move their layout between narrative beats.",
        audience: "product teams", out: workspace("presenter-video")
      },
      planningMode: "single",
      audioMode: "supplied",
      expected: { aspect: "9:16", narration: "supplied", presenter: true, visualAnalysis: true }
    },
    {
      id: "hierarchical-longform",
      source: fixtures.longformNotes,
      flags: {
        kind: "topic", aspect: "16:9", duration: "180",
        prompt: "Explain the complete source-to-video system as a causal long-form story.",
        audience: "video automation engineers", cta: "Explore the full system", out: workspace("hierarchical-longform")
      },
      planningMode: "hierarchical",
      audioMode: "none",
      expected: { aspect: "16:9", narration: "generated", hierarchical: true }
    }
  ];
}

async function executeEvaluationScenario(definition, options, adapters) {
  const commandRunner = evaluationCommandRunner(adapters.run ?? execFileAsync, definition);
  const intake = await buildIntake(definition.source, definition.flags, {});
  await writeIntakeManifest(intake);
  const workspace = intake.workspace;
  const client = new FrozenEvaluationClient({ scenarioId: definition.id });
  const evidenceResult = await collectEvidence(workspace, {}, { run: commandRunner, fetch: frozenProductFetch });
  const mediaResult = await analyzeSourceMedia(workspace, { samples: 4, columns: 2, background: false }, { client, run: commandRunner });
  const planResult = await planProduction(workspace, {
    planningMode: definition.planningMode,
    hierarchicalThresholdSeconds: 180,
    chapterConcurrency: 2,
    background: false,
    sfxCatalog: []
  }, { client });
  const audioResult = await produceAudio(workspace, {
    noVoice: definition.audioMode === "none",
    noMusic: true,
    noSfx: true
  });
  if (audioResult.status === "needs-retiming") throw new Error(`${definition.id} produced timing drift: ${audioResult.warnings.join(" ")}`);
  const frameResult = await directFrames(workspace, { concurrency: 2, semanticAttempts: 1, background: false }, { client });
  const assemblyResult = await assembleHyperFrames(workspace, {
    voiceover: audioResult.voiceover,
    music: audioResult.music,
    sfxManifest: audioResult.sfx,
    musicVolume: 0.16
  });
  const verifier = adapters.verifyProduction ?? verifyProduction;
  const verificationOptions = {
    inspectSamples: options.inspectSamples,
    snapshotFrames: options.snapshotFrames,
    shotInspectConcurrency: 2
  };
  const verification = await verifier(workspace, verificationOptions, adapters.verification ?? {});
  const cachedVerification = await verifier(workspace, verificationOptions, adapters.verification ?? {});
  const [finalIntake, evidence, plan, audio, assembly, jobs] = await Promise.all([
    readJson(path.join(workspace, "production", "intake.json")),
    readJson(path.join(workspace, "production", "evidence.json")),
    readJson(path.join(workspace, "production", "plan.json")),
    readJson(path.join(workspace, "production", "media", "manifest.json")),
    readJson(path.join(workspace, "production", "hyperframes", "assembly.json")),
    readJson(path.join(workspace, "production", "jobs.json"))
  ]);
  const assertions = await scenarioAssertions({
    definition, workspace, intake: finalIntake, evidence, plan, audio, assembly, jobs,
    mediaResult, planResult, verification, cachedVerification, requireVerificationCache: options.requireVerificationCache
  });
  const failed = assertions.filter((entry) => !entry.ok);
  if (failed.length) throw new Error(`${definition.id} failed evaluation assertions: ${failed.map((entry) => entry.id).join(", ")}`);
  const snapshots = await snapshotFiles(verification.snapshots, path.dirname(path.dirname(workspace)));
  const report = {
    schema_version: "launchclip.production-evaluation-scenario.v1",
    id: definition.id,
    status: "passed",
    workspace: relative(path.dirname(path.dirname(workspace)), workspace),
    aspect: plan.format.aspect,
    width: plan.format.width,
    height: plan.format.height,
    duration_seconds: plan.format.duration_seconds,
    planning_mode: planResult.planning_mode ?? definition.planningMode,
    narration_source: plan.narration.source,
    resources: finalIntake.resources.map((entry) => ({ id: entry.id, role: entry.role, type: entry.type })),
    evidence_items: evidenceResult.items,
    source_media_analyses: mediaResult.analyses,
    frames: frameResult.frames.length,
    native_checks: verification.failed?.length ? verification.failed : Object.keys((await readJson(path.join(workspace, "production", "qa", "verification.json"))).checks ?? {}),
    verification_cache_reused: Boolean(cachedVerification.cached),
    toolchain: verification.inputs?.toolchain ?? null,
    project: relative(path.dirname(path.dirname(workspace)), assemblyResult.project),
    snapshots,
    assertions,
    frozen_provider_responses: client.requests
  };
  await writeAtomic(path.join(workspace, "production", "evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function scenarioAssertions(context) {
  const { definition, workspace, intake, evidence, plan, audio, assembly, jobs, mediaResult, verification, cachedVerification, requireVerificationCache } = context;
  const frameBundles = await Promise.all(plan.shots.map((shot) => readJson(path.join(workspace, "production", "frames", `${shot.id}.json`))));
  const checks = [
    assertion("requested-aspect", plan.format.aspect === definition.expected.aspect, `${plan.format.width}x${plan.format.height}`),
    assertion("requested-narration-source", plan.narration.source === definition.expected.narration, plan.narration.source),
    assertion("native-verification-passed", verification.status === "ready" && !(verification.failed ?? []).length, verification.status),
    assertion("assembled-all-shots", assembly.shots.length === plan.shots.length, `${assembly.shots.length}/${plan.shots.length}`),
    assertion("frozen-verification-reused", !requireVerificationCache || cachedVerification.cached === true, String(Boolean(cachedVerification.cached)))
  ];
  if (definition.expected.visualAnalysis) checks.push(assertion("visual-media-analyzed", mediaResult.analyses > 0, String(mediaResult.analyses)));
  if (definition.expected.screenMedia) checks.push(assertion(
    "screen-recording-mounted",
    frameBundles.some((bundle) => bundle.root_media_requests.some((request) => request.kind === "video")),
    "root_media_requests"
  ));
  if (definition.expected.pdfEvidence) checks.push(assertion(
    "pdf-ingested-as-evidence",
    evidence.items.some((entry) => entry.kind === "document-text" && /evidence becomes motion/i.test(entry.content)),
    "document-text"
  ));
  if (definition.expected.suppliedAudio) checks.push(assertion(
    "supplied-audio-preserved",
    audio.voiceover?.provider === "supplied" && Boolean(audio.voiceover.path),
    audio.voiceover?.provider ?? "missing"
  ));
  if (definition.expected.presenter) {
    const presenterIds = new Set(intake.resources.filter((entry) => entry.role === "presenter").map((entry) => entry.id));
    const placements = frameBundles.flatMap((bundle) => bundle.root_media_requests.filter((request) => presenterIds.has(request.resource_id)).map((request) => request.placement));
    checks.push(assertion("presenter-visible", plan.shots.some((shot) => shot.presenter.visible), String(plan.shots.filter((shot) => shot.presenter.visible).length)));
    checks.push(assertion("presenter-layout-changes", placements.length >= 2 && new Set(placements.map((entry) => `${entry.x}:${entry.y}:${entry.width}:${entry.height}`)).size >= 2, String(placements.length)));
    checks.push(assertion("presenter-continuous-timeline", frameBundles.every((bundle) => {
      const shot = plan.shots.find((entry) => entry.id === bundle.shot_id);
      return bundle.root_media_requests.filter((request) => presenterIds.has(request.resource_id)).every((request) => request.source_start_seconds === shot.start_seconds + request.start_seconds);
    }), "source_start_seconds"));
  }
  if (definition.expected.hierarchical) {
    const jobEntries = Array.isArray(jobs.jobs) ? jobs.jobs : Object.values(jobs.jobs ?? jobs);
    checks.push(assertion("hierarchical-planning-mode", context.planResult.planning_mode === "hierarchical", context.planResult.planning_mode));
    checks.push(assertion("outline-and-chapters-succeeded", jobEntries.some((entry) => entry.id === "creative-outline" && entry.status === "succeeded") && jobEntries.filter((entry) => entry.id?.startsWith("creative-chapter:") && entry.status === "succeeded").length >= 2, "jobs.json"));
  }
  return checks;
}

class FrozenEvaluationClient {
  constructor({ scenarioId }) {
    this.scenarioId = scenarioId;
    this.requests = [];
  }

  async runStructured(request) {
    const jobId = request.metadata?.job_id ?? request.metadata?.resource_id ?? request.schemaName;
    const responseId = `eval_${this.scenarioId}_${slug(jobId)}_${this.requests.length + 1}`;
    if (request.onSubmitted) await request.onSubmitted({ id: responseId, status: "completed" });
    let value;
    if (request.schemaName === "launchclip_source_media_analysis") value = frozenMediaAnalysis(request);
    else if (request.schemaName === "launchclip_production_plan") value = frozenProductionPlan(JSON.parse(request.input));
    else if (request.schemaName === "launchclip_production_outline") value = frozenLongFormOutline(JSON.parse(request.input));
    else if (request.schemaName === "launchclip_production_chapter") value = frozenLongFormChapter(JSON.parse(request.input));
    else if (request.schemaName === "launchclip_frame_bundle") value = frozenFrameBundle(JSON.parse(request.input), this.scenarioId);
    else throw new Error(`Evaluation fixture has no response for ${request.schemaName ?? jobId}`);
    this.requests.push({ job_id: jobId, schema: request.schemaName, response_id: responseId });
    return { id: responseId, response_id: responseId, model: "frozen-evaluation", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }, value };
  }

  async resumeStructured() {
    throw new Error("Fresh evaluation workspaces must never resume a remote response");
  }
}

function frozenMediaAnalysis(request) {
  const input = JSON.parse(request.input);
  return {
    resource_id: input.resource_id,
    summary: input.role === "presenter" ? "A presenter remains available for beat-specific framing." : "A product interface advances through clear proof states.",
    visible_text: input.role === "presenter" ? [] : ["Workspace", "Evidence", "Motion"],
    narrative_opportunities: ["establish the input", "show the transformation", "land on verified output"],
    segments: [{ start_seconds: 0, end_seconds: 5.5, description: "Synthetic evaluation footage", proof_value: "Exercises real media mounting and contact-sheet analysis", motion_or_interaction: "Visible state changes over time", recommended_usage: "Use as root-owned media proof" }],
    quality_warnings: ["Synthetic fixture; not a creative-quality reference"]
  };
}

function frozenProductionPlan(input) {
  const evidence = [...(input.factual_evidence ?? []), ...(input.non_claim_assets_and_context ?? []), ...(input.creative_references ?? [])];
  const eligibleIds = (input.factual_evidence ?? []).map((entry) => entry.id);
  const evidenceIds = evidence.map((entry) => entry.id).slice(0, 4);
  const duration = Number(input.brief.requested_duration_seconds);
  const format = input.brief.requested_format;
  const resources = input.resources ?? [];
  const presenter = resources.find((entry) => entry.role === "presenter");
  const visual = presenter ?? resources.find((entry) => entry.role === "supporting" && ["video", "image"].includes(entry.type)) ?? resources.find((entry) => entry.role === "supporting");
  const supplied = input.narration?.source === "supplied";
  const cta = input.brief.call_to_action;
  const narration = supplied
    ? input.narration.authoritative_transcript
    : `Evidence becomes a focused narrative. The narrative becomes verified motion.${cta ? ` ${cta}` : ""}`;
  return productionPlan({
    duration, format, narrationSource: supplied ? "supplied" : "generated", narration, cta,
    evidenceIds, eligibleIds, resourceIds: visual ? [visual.id] : [], presenterId: presenter?.id ?? null,
    title: input.source?.title ?? "Evaluation story"
  });
}

function frozenLongFormOutline(input) {
  const duration = Number(input.brief.requested_duration_seconds);
  const midpoint = duration / 2;
  const evidenceIds = (input.evidence_index ?? []).map((entry) => entry.id);
  const resourceIds = (input.resources ?? []).map((entry) => entry.id);
  return {
    schema_version: "launchclip.production-outline.v1",
    project: { title: "The complete source-to-video system", thesis: "Evidence, planning, media, motion, and verification form one causal pipeline", audience_promise: "Understand every production boundary", angle: "Follow the artifact graph", hook: "The video is not the first output; the evidence graph is" },
    format: { aspect: input.brief.requested_format.id, width: input.brief.requested_format.width, height: input.brief.requested_format.height, duration_seconds: duration, language: input.brief.language },
    design: designSystem("Causal artifact graph"),
    narration: { source: input.narration.source, target_wpm: 155, delivery: "measured, technical, and cumulative" },
    audio: audioDirection(),
    rubric: rubric(),
    chapters: [
      { id: "inputs-to-plan", start_seconds: 0, end_seconds: midpoint, purpose: "Establish trusted inputs", narrative_turn: "Raw resources become scoped evidence", opening_state: "Unstructured inputs", closing_state: "A frozen creative model", evidence_ids: evidenceIds, resource_ids: resourceIds, presenter_strategy: "hidden" },
      { id: "plan-to-proof", start_seconds: midpoint, end_seconds: duration, purpose: "Close the production loop", narrative_turn: "The plan becomes motion and measurable QA", opening_state: "Frozen creative model", closing_state: "Verified video project", evidence_ids: evidenceIds, resource_ids: resourceIds, presenter_strategy: "hidden" }
    ]
  };
}

function frozenLongFormChapter(input) {
  const duration = Number(input.chapter.duration_seconds);
  const eligibleIds = (input.evidence ?? []).filter((entry) => entry.claims_allowed && entry.role !== "reference").map((entry) => entry.id);
  const evidenceIds = (input.evidence ?? []).map((entry) => entry.id).slice(0, 4);
  const resourceIds = (input.resources ?? []).map((entry) => entry.id).slice(0, 3);
  const cta = input.required_cta;
  const narration = `${input.chapter.narrative_turn}. The system preserves continuity across this boundary.${cta ? ` ${cta}` : ""}`;
  return productionPlan({
    duration,
    format: { id: input.global.format.aspect, width: input.global.format.width, height: input.global.format.height },
    language: input.global.format.language,
    narrationSource: input.global.narration.source,
    narration,
    cta,
    evidenceIds,
    eligibleIds,
    resourceIds,
    presenterId: null,
    title: input.chapter.purpose,
    project: input.global.project,
    design: input.global.design,
    audio: input.global.audio,
    rubricEntries: input.global.rubric
  });
}

function productionPlan({ duration, format, language = "en", narrationSource, narration, cta, evidenceIds, eligibleIds, resourceIds, presenterId, title, project, design, audio, rubricEntries }) {
  const midpoint = duration / 2;
  const sectionEvidence = eligibleIds.slice(0, 2);
  const presenterResourceIds = presenterId ? [presenterId] : resourceIds;
  return {
    schema_version: PRODUCTION_PLAN_VERSION,
    project: project ?? { title, thesis: "Grounded inputs direct the visual system", audience_promise: "See how the production closes", angle: "Trace evidence into motion", hook: "Every visible beat has an upstream reason" },
    format: { aspect: format.id ?? format.aspect, width: format.width, height: format.height, duration_seconds: duration, language },
    design: design ?? designSystem("Signal path editorial"),
    narration: {
      source: narrationSource,
      full_text: narration,
      target_wpm: 155,
      delivery: "clear, energetic, and evidence-led",
      sections: [
        { id: "setup", text: narration, evidence_ids: sectionEvidence },
        { id: "payoff", text: cta || narration, evidence_ids: sectionEvidence }
      ]
    },
    audio: audio ?? audioDirection(),
    claims: [],
    shots: [
      shot("shot-1", 0, midpoint, "Establish the transformation", narration, ["INPUT", "EVIDENCE"], evidenceIds, presenterResourceIds, Boolean(presenterId), "lower-right presenter with proof above"),
      shot("shot-2", midpoint, duration, "Resolve with verified output", narration, ["PLAN", "MOTION", ...(cta ? [cta] : [])], evidenceIds, presenterResourceIds, Boolean(presenterId), "compact presenter at lower-left beside the result")
    ],
    rubric: rubricEntries ?? rubric()
  };
}

function shot(id, start, end, purpose, voiceover, onScreenText, evidenceIds, resourceIds, presenterVisible, presenterPlacement) {
  const duration = end - start;
  return {
    id, start_seconds: start, end_seconds: end, purpose, voiceover, on_screen_text: onScreenText,
    evidence_ids: evidenceIds, resource_ids: resourceIds,
    presenter: { visible: presenterVisible, placement: presenterVisible ? presenterPlacement : "offstage", size: presenterVisible ? "medium" : "none", treatment: presenterVisible ? "rounded picture-in-picture" : "none" },
    visual: {
      description: "A signal path develops from source artifact to verified frame",
      composition: "Large editorial headline, proof card, and one controlled accent",
      typography: "Bold Arial display with compact technical labels",
      background: "Deep navy field with a soft cyan signal line",
      foreground: "Cream headline and white proof card",
      motion: "Headline is present immediately; proof card accelerates in and settles",
      internal_reveals: [{ at_seconds: Math.min(0.5, duration / 3), action: "reveal the proof card", easing_intent: "accelerate then decelerate", emphasis: "evidence" }]
    },
    transition_out: "carry the signal line into the next state",
    sfx: []
  };
}

function frozenFrameBundle(input, scenarioId) {
  const shot = input.shot;
  const duration = Number(shot.duration_seconds);
  const format = input.format;
  const title = shot.on_screen_text?.[0] ?? "EVIDENCE";
  const label = shot.on_screen_text?.slice(1).join(" → ") || shot.purpose;
  const videoResource = (input.resources ?? []).find((entry) => entry.role === "presenter" && entry.type === "video")
    ?? (input.resources ?? []).find((entry) => entry.type === "video" && entry.role !== "voiceover");
  const presenter = videoResource?.role === "presenter";
  const second = /(?:^|-)2$/.test(shot.id) || /shot-2$/.test(shot.id);
  const placement = presenter
    ? second
      ? { x: format.width * 0.06, y: format.height * 0.64, width: format.width * 0.34, height: format.height * 0.29, object_fit: "cover", border_radius: 34, z_index: 8, treatment: "compact presenter beside result" }
      : { x: format.width * 0.16, y: format.height * 0.56, width: format.width * 0.68, height: format.height * 0.36, object_fit: "cover", border_radius: 42, z_index: 8, treatment: "presenter below proof" }
    : { x: format.width * 0.08, y: format.height * 0.48, width: format.width * 0.84, height: format.height * 0.42, object_fit: "cover", border_radius: 30, z_index: 4, treatment: "product proof window" };
  const mediaDuration = Math.min(duration, 3);
  const rootMediaRequests = videoResource ? [{
    resource_id: videoResource.id,
    kind: "video",
    start_seconds: 0,
    end_seconds: mediaDuration,
    source_start_seconds: shot.start_seconds,
    source_end_seconds: shot.start_seconds + mediaDuration,
    volume: 0,
    placement
  }] : [];
  const heroId = `${shot.id}-hero`;
  const proofId = `${shot.id}-proof`;
  const accentId = `${shot.id}-accent`;
  const html = `<!doctype html>
<html><head></head><body><template>
  <style>
    #root{position:absolute;inset:0;width:${format.width}px;height:${format.height}px;overflow:hidden;font-family:Arial,sans-serif;color:#fff}
    #${shot.id}-background{position:absolute;inset:0;background:linear-gradient(145deg,#06101f 0%,#0b1d32 56%,#113c4b 100%)}
    #${accentId}{position:absolute;left:7%;top:9%;width:18%;height:8px;border-radius:999px;background:#56e6c2;box-shadow:0 0 42px rgba(86,230,194,.45)}
    #${heroId}{position:absolute;left:7%;top:14%;width:86%;font-size:${Math.round(format.width * 0.072)}px;line-height:.94;font-weight:800;letter-spacing:-.055em;color:#f7f1e6}
    #${proofId}{position:absolute;left:7%;top:34%;width:86%;min-height:15%;padding:${Math.round(format.width * 0.026)}px;border:1px solid rgba(255,255,255,.24);border-radius:${Math.round(format.width * 0.018)}px;background:rgba(255,255,255,.11);box-shadow:0 30px 90px rgba(0,0,0,.28);backdrop-filter:blur(18px);font-size:${Math.round(format.width * 0.029)}px;line-height:1.18;font-weight:700;color:#d9fff6}
  </style>
  <div id="root" data-composition-id="${shot.id}" data-start="0" data-duration="${duration}" data-width="${format.width}" data-height="${format.height}">
    <div id="${shot.id}-background" class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
    <div id="${accentId}" class="clip" data-start="0" data-duration="${duration}" data-track-index="1"></div>
    <div id="${heroId}" class="clip" data-start="0" data-duration="${duration}" data-track-index="2">${escapeHtml(title)}</div>
    <div id="${proofId}" class="clip" data-start="0" data-duration="${duration}" data-track-index="3">${escapeHtml(label)}</div>
  </div>
  <script>
    window.__timelines=window.__timelines||{};
    const timeline=gsap.timeline({paused:true});
    timeline.fromTo("#${proofId}",{opacity:0,y:36},{opacity:1,y:0,duration:.65,ease:"power3.out"},.1);
    timeline.fromTo("#${accentId}",{scaleX:.15,transformOrigin:"left center"},{scaleX:1,duration:.8,ease:"power2.inOut"},0);
    window.__timelines["${shot.id}"]=timeline;
  </script>
</template></body></html>`;
  return {
    schema_version: "launchclip.frame-bundle.v1",
    shot_id: shot.id,
    html,
    motion: { assertions: [{ selector: `#${heroId}`, appears_by_seconds: 0, order: null, must_stay_in_frame: true, must_remain_live: false }] },
    root_media_requests: rootMediaRequests,
    evidence_ids: shot.evidence_ids,
    visible_copy: [title, label],
    preserve: [`evaluation scenario: ${scenarioId}`, "exact visible copy"]
  };
}

function designSystem(concept) {
  return {
    concept,
    art_direction: "Editorial signal paths assembled from the subject's own evidence",
    palette_roles: [
      { name: "field", role: "background", color_hint: "deep navy" },
      { name: "paper", role: "primary copy", color_hint: "warm cream" },
      { name: "signal", role: "proof accent", color_hint: "bright mint" }
    ],
    typography: "Bold editorial display paired with compact technical labels",
    texture: "Soft depth and precise borders",
    composition_logic: "One dominant idea, one proof surface, one continuity signal",
    motion_character: "Fast acquisition followed by controlled deceleration",
    density: "Readable, evidence-rich, never decorative for its own sake"
  };
}

function audioDirection() {
  return { music_prompt: "restrained electronic pulse with clear chapter development", music_strategy: "support narrative turns without masking speech", sfx_strategy: "small semantic confirmations only" };
}

function rubric() {
  return [{ id: "evaluation-rubric", criterion: "Every beat advances the evidence-to-output model", measurement: "Each shot changes the visible system state and remains readable in snapshots", severity: "major" }];
}

async function createEvaluationFixtures(directory, { run }) {
  await mkdir(directory, { recursive: true });
  const screenVideo = path.join(directory, "saas-screen.mp4");
  const voiceoverAudio = path.join(directory, "voiceover.wav");
  const presenterVideo = path.join(directory, "presenter.mp4");
  const paperPdf = path.join(directory, "evidence-paper.pdf");
  const voiceoverTranscript = path.join(directory, "voiceover.txt");
  const presenterTranscript = path.join(directory, "presenter.txt");
  const longformNotes = path.join(directory, "longform-notes.md");
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=6", "-vf", "drawbox=x=70:y=60:w=1140:h=600:color=0x07111f@0.92:t=fill,drawbox=x=120:y=120:w=420:h=70:color=0x56e6c2@0.9:t=fill,drawbox=x=120:y=240:w=1040:h=330:color=white@0.82:t=fill", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", screenVideo]);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=6", "-c:a", "pcm_s16le", voiceoverAudio]);
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x27364a:s=720x1280:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=180:sample_rate=48000:duration=6", "-vf", "drawbox=x=170:y=160:w=380:h=380:color=0xf1c7a5:t=fill,drawbox=x=110:y=540:w=500:h=650:color=0x17202d:t=fill", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", presenterVideo]);
  await Promise.all([
    writeFile(paperPdf, minimalPdf("Evidence becomes motion when every visual decision can be traced to a supplied source.")),
    writeFile(voiceoverTranscript, "The supplied voiceover sets the story. Every visual follows its timing."),
    writeFile(presenterTranscript, "The presenter introduces the proof. Then the layout moves aside for the result."),
    writeFile(longformNotes, "# Source-to-video system\n\nEvidence becomes motion through scoped planning, authoritative narration, root-owned media, deterministic frames, and native HyperFrames verification.\n")
  ]);
  return {
    screenVideo, voiceoverAudio, presenterVideo, paperPdf, voiceoverTranscript, presenterTranscript, longformNotes,
    paperText: "Evidence becomes motion when every visual decision can be traced to a supplied source."
  };
}

function evaluationCommandRunner(run, definition) {
  return async (command, args, options) => {
    if (command === "pdftotext") return { stdout: "Evidence becomes motion when every visual decision can be traced to a supplied source.\n", stderr: "" };
    return run(command, args, options);
  };
}

async function frozenProductFetch(url) {
  if (new URL(url).hostname !== "launchclip-eval.invalid") throw new Error(`Evaluation fetch refused unexpected URL: ${url}`);
  return {
    ok: true,
    status: 200,
    text: async () => "<!doctype html><title>Launchclip Evaluation SaaS</title><meta name=description content='Turns screen evidence into verified motion'><main><h1>Evidence to motion</h1><p>Recorded product proof becomes a structured launch narrative.</p></main>"
  };
}

function minimalPdf(text) {
  const escaped = String(text).replace(/([\\()])/g, "\\$1");
  const stream = `BT /F1 16 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function selectScenarios(definitions, requested) {
  const values = requested == null ? [] : Array.isArray(requested) ? requested : [requested];
  if (!values.length) return definitions;
  const selected = definitions.filter((entry) => values.includes(entry.id));
  const unknown = values.filter((value) => !definitions.some((entry) => entry.id === value));
  if (unknown.length) throw new Error(`Unknown evaluation scenario: ${unknown.join(", ")}. Supported: ${PRODUCTION_EVALUATION_SCENARIOS.join(", ")}`);
  return selected;
}

async function prepareOutput(root, force) {
  try {
    await stat(root);
    if (!force) throw new Error(`Evaluation output already exists: ${root}. Pass --force to replace it.`);
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: true });
}

async function snapshotFiles(directory, root) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  return files.map((entry) => relative(root, entry));
}

function assertion(id, ok, evidence) { return { id, ok: Boolean(ok), evidence: String(evidence ?? "") }; }
function relative(root, target) { return path.relative(path.resolve(root), path.resolve(target)).split(path.sep).join("/"); }
function slug(value) { return String(value ?? "response").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "response"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
async function readJson(filePath) { return JSON.parse(await readFile(filePath, "utf8")); }

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, filePath);
}

function parseArguments(argv) {
  const options = { scenarios: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--force") { options.force = true; continue; }
    if (token === "--no-cache-check") { options.requireVerificationCache = false; continue; }
    if (["--out", "--scenario", "--inspect-samples", "--snapshot-frames"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      if (token === "--out") options.out = value;
      else if (token === "--scenario") options.scenarios.push(value);
      else if (token === "--inspect-samples") options.inspectSamples = Number(value);
      else options.snapshotFrames = Number(value);
      continue;
    }
    throw new Error(`Unknown evaluation option: ${token}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  runProductionEvaluationMatrix(options.out, options)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; });
}
