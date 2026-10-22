import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SUBSCRIPTION_CINEMATIC_CONTRACT,
  buildTemporalEvidenceSchedule,
  declaredBoundariesForProject,
  readCinematicContractMarker,
  readStoryCinematicContractMarker,
  validateRenderedCandidateReceipt,
  validateTemporalEvidenceManifest
} from "./cinematic_evidence.js";
import { assessCinematicReadiness } from "./production_readiness.js";
import { resolveProductionProfile } from "./production_profiles.js";
import { analyzeProductionAudio, evaluateAudioQuality } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { getRenderer, resolveRendererName } from "./renderers/index.js";
import { hasExactFile, readProjectStory } from "./story_loader.js";

// adapters (all optional, for tests and embedding):
//   verifyProject(project, qaDir, options) replaces the renderer check entirely;
//   renderer: a renderer adapter object; run, storyModule, rendererOptions: passed to getRenderer();
//   writeMotionReport, analyzeProductionAudio, motion, audio: the media gates.
export async function checkCinematicProject(projectPath, options = {}, adapters = {}) {
  const project = path.resolve(projectPath);
  const rendererName = adapters.renderer?.name ?? resolveRendererName(project, options.renderer);
  const storyModule = adapters.storyModule ?? options.storyModule;
  const storyboard = await readProjectStory(project, { storyModule });
  const html = hasExactFile(project, "index.html") ? await readFile(path.join(project, "index.html"), "utf8") : null;
  if (!storyboard && html == null) throw new Error(`${project} has neither storyboard.json nor index.html`);
  const format = storyboard?.format ?? {};
  const duration = positiveNumber(options.duration ?? format.duration ?? htmlAttribute(html, "data-duration"), "composition duration");
  const width = positiveNumber(options.width ?? format.width ?? htmlAttribute(html, "data-width"), "composition width");
  const height = positiveNumber(options.height ?? format.height ?? htmlAttribute(html, "data-height"), "composition height");
  const video = projectFile(project, options.video ?? "renders/draft.mp4");
  await access(video);
  const qaDir = projectFile(project, options.qaDir ?? "qa/cinematic");
  await mkdir(qaDir, { recursive: true });

  let verification = adapters.verifyProject
    ? await adapters.verifyProject(project, qaDir, { ...options, renderer: rendererName })
    : await verifyProject(project, qaDir, rendererAdapter(rendererName, adapters, storyModule));
  await writeJson(path.join(qaDir, "verification.json"), verification);

  const { profile, expected } = cinematicMotionExpectations({ duration, width, height });
  const motionPath = path.join(qaDir, "motion.json");
  const motion = await (adapters.writeMotionReport ?? writeMotionReport)(video, motionPath, { expected }, adapters.motion);

  const audioManifest = await optionalProjectFile(project, options.audioManifest ?? "AUDIO-MANIFEST.json");
  const audio = await (adapters.analyzeProductionAudio ?? analyzeProductionAudio)(video, audioManifest, {
    musicVolume: Number(options.musicVolume ?? .15)
  }, adapters.audio);
  if (options.expectAudio && !audioManifest) {
    audio.expected_audio = true;
    audio.quality = evaluateAudioQuality(audio);
    audio.quality.ok = false;
    audio.quality.findings.unshift({
      category: "audio-manifest",
      severity: "major",
      message: "Audio is expected, but AUDIO-MANIFEST.json is missing; voice, music, and SFX provenance cannot be verified."
    });
  }
  const audioPath = path.join(qaDir, "audio.json");
  await writeJson(audioPath, audio);

  const [concepts, story, narration, critique] = await Promise.all([
    readOptionalJson(projectFile(project, options.concepts ?? "CONCEPTS.json")),
    // Exact-case default: on case-insensitive file systems STORY.json would
    // otherwise resolve to the storyboard storyboard.json.
    options.story ? readOptionalJson(projectFile(project, options.story)) : hasExactFile(project, "STORY.json") ? readOptionalJson(path.join(project, "STORY.json")) : null,
    readOptionalJson(projectFile(project, options.narration ?? "NARRATION.json")),
    readOptionalJson(projectFile(project, options.critique ?? "qa/critic.json"))
  ]);
  const contractMarker = storyboard ? readStoryCinematicContractMarker(storyboard.story) : readCinematicContractMarker(html);
  let phase2Evidence = null;
  if (contractMarker) {
    phase2Evidence = await verifyPhase2Evidence(project, duration, video, critique, contractMarker, { ...options, storyModule });
    verification = augmentVerification(verification, phase2Evidence.checks);
  }
  await writeJson(path.join(qaDir, "verification.json"), verification);
  const readinessPath = projectFile(project, options.output ?? "CINEMATIC-READINESS.json");
  const readiness = {
    ...assessCinematicReadiness({
      concepts,
      story,
      narration,
      plan: { format: { duration_seconds: duration, width, height } },
      verification,
      motion,
      audio,
      critique,
      assembly: { fallback_count: 0, fallbacks: [], provenance: "subscription-agent-authored" }
    }),
    profile: { id: profile.id, lane: profile.lane },
    project,
    video,
    receipt: readinessPath
  };
  await writeJson(readinessPath, readiness);
  return {
    stage: "cinematic-check",
    status: readiness.ok ? "ready" : "needs-repair",
    renderer: rendererName,
    format_source: storyboard ? "storyboard.json" : "index.html",
    project,
    video,
    qa: qaDir,
    motion: motionPath,
    audio: audioPath,
    readiness: readinessPath,
    gates: readiness.gates,
    blockers: readiness.blockers,
    repair_findings: readiness.repair_findings,
    ...(phase2Evidence ? { cinematic_contract: phase2Evidence.summary } : {})
  };
}

// The motion gate's expectations for a rendered cinematic MP4, shared with
// the renderer eval (src/renderer_eval.js) so both judge motion the same way.
export function cinematicMotionExpectations({ duration, width, height }) {
  const orientation = height > width ? "portrait" : width > height ? "landscape" : "square";
  const profile = resolveProductionProfile("cinematic", { aspect: { orientation }, durationSeconds: duration });
  return {
    profile,
    expected: {
      duration_seconds: duration,
      width,
      height,
      duration_tolerance_seconds: .15,
      maximum_hold_ratio: .8,
      minimum_bursts_per_minute: 20,
      minimum_change_energy_p50: .35,
      minimum_change_energy_p50_by_family: { "developing-card": .15 },
      minimum_flow_velocity_p90: 2,
      maximum_first_motion_seconds: .35,
      hook_window_seconds: profile.craft.hook_window_seconds,
      minimum_hook_events: profile.craft.minimum_hook_material_changes
    }
  };
}

async function verifyPhase2Evidence(project, duration, video, critique, marker, options) {
  const boundaryValidation = await declaredBoundariesForProject(project, { duration, storyModule: options.storyModule });
  const schedule = buildTemporalEvidenceSchedule(duration, boundaryValidation.boundaries);
  const [candidateReceipt, temporalManifest] = await Promise.all([
    readOptionalJson(projectFile(project, options.renderedCandidatesReceipt ?? "qa/rendered-candidates.json")),
    readOptionalJson(projectFile(project, options.temporalEvidenceManifest ?? "qa/temporal-evidence/manifest.json"))
  ]);
  const contract = marker === SUBSCRIPTION_CINEMATIC_CONTRACT
    ? { ok: true, errors: [] }
    : { ok: false, errors: [`Unsupported cinematic contract marker: ${marker}`] };
  const boundaryErrors = [...boundaryValidation.errors];
  if (boundaryValidation.ok && !boundaryValidation.boundaries.length) boundaryErrors.push("Phase-2 requires at least one declared transition boundary");
  const sharedWorldCount = boundaryValidation.boundaries.filter((entry) => entry.kind === "shared-world").length;
  if (boundaryValidation.ok && boundaryValidation.boundaries.length && !sharedWorldCount) boundaryErrors.push("Phase-2 requires at least one declared shared-world boundary");
  const boundaries = {
    ok: boundaryErrors.length === 0,
    errors: boundaryErrors,
    count: boundaryValidation.boundaries.length,
    shared_world_count: sharedWorldCount
  };
  const renderedCandidates = candidateReceipt
    ? await validateRenderedCandidateReceipt(project, candidateReceipt, { boundaryIds: boundaryValidation.boundaries.map((entry) => entry.boundary_id) })
    : { ok: false, errors: ["Phase-2 rendered candidate receipt is missing"], candidate_count: 0, artifacts: [] };
  const temporal = temporalManifest
    ? await validateTemporalEvidenceManifest(project, temporalManifest, video, schedule)
    : { ok: false, errors: ["Phase-2 temporal evidence manifest is missing"], entry_count: 0, expected_count: schedule.entries.length };
  const criticCitations = validateCriticCitations(critique, temporalManifest);
  const checks = {
    cinematic_contract: compactEvidenceCheck(contract),
    declared_boundaries: compactEvidenceCheck(boundaries),
    rendered_candidates: compactEvidenceCheck(renderedCandidates),
    temporal_evidence: compactEvidenceCheck(temporal),
    critic_citations: compactEvidenceCheck(criticCitations)
  };
  return {
    checks,
    summary: {
      marker,
      status: Object.values(checks).every((entry) => entry.ok) ? "passed" : "failed",
      boundary_count: boundaryValidation.boundaries.length,
      shared_world_boundary_count: sharedWorldCount,
      expected_temporal_samples: schedule.entries.length,
      candidate_comparison_count: renderedCandidates.comparison_count ?? 0,
      candidate_count: renderedCandidates.candidate_count ?? 0,
      temporal_entry_count: temporal.entry_count ?? 0
    }
  };
}

function validateCriticCitations(critique, manifest) {
  const findings = Array.isArray(critique?.findings) ? critique.findings : [];
  const evidenceIds = new Set((manifest?.entries ?? []).map((entry) => entry?.evidence_id ?? entry?.id).filter(Boolean));
  const reviewed = Array.isArray(critique?.evidence_ids_reviewed) ? critique.evidence_ids_reviewed : [];
  const reviewedIds = new Set(reviewed.filter((entry) => typeof entry === "string" && entry));
  const errors = [];
  if (!reviewedIds.size) errors.push("critic cites no reviewed temporal evidence IDs");
  const unknownReviewed = [...reviewedIds].filter((id) => !evidenceIds.has(id));
  if (unknownReviewed.length) errors.push(`critic cites unknown reviewed evidence IDs: ${unknownReviewed.join(", ")}`);
  const unreviewed = [...evidenceIds].filter((id) => !reviewedIds.has(id));
  if (unreviewed.length) errors.push(`critic did not review every temporal artifact: ${unreviewed.join(", ")}`);
  for (const [index, finding] of findings.entries()) {
    const cited = Array.isArray(finding?.evidence_ids) ? finding.evidence_ids : [];
    if (!cited.length) errors.push(`critic finding ${index + 1} cites no temporal evidence IDs`);
    else if (cited.some((id) => !evidenceIds.has(id))) errors.push(`critic finding ${index + 1} cites unknown temporal evidence IDs`);
  }
  return { ok: errors.length === 0, errors, finding_count: findings.length, evidence_count: evidenceIds.size, reviewed_count: reviewedIds.size };
}

function compactEvidenceCheck(value) {
  return { ...value, ok: value.ok === true };
}

function augmentVerification(verification, phase2Checks) {
  const failed = [...new Set([
    ...(verification?.failed ?? []),
    ...Object.entries(phase2Checks).filter(([, value]) => !value.ok).map(([name]) => name)
  ])];
  return {
    ...verification,
    schema_version: verification?.schema_version ?? "launchclip.subscription-verification.v1",
    status: failed.length ? "failed" : "passed",
    checks: { ...(verification?.checks ?? {}), ...phase2Checks },
    failed
  };
}

function rendererAdapter(name, adapters, storyModule) {
  if (adapters.renderer) return adapters.renderer;
  return getRenderer(name, { run: adapters.run, storyModule, ...(adapters.rendererOptions ?? {}) });
}

// Runs the renderer adapter's check and records each sub-check as
// <qaDir>/<name>.json (lint.json and check.json for HyperFrames;
// storyboard.json, compositions.json and layout.json for Remotion).
async function verifyProject(project, qaDir, renderer) {
  let result;
  try {
    result = await renderer.check(project, { strict: true });
  } catch (error) {
    result = { status: "failed", findings: [{ source: renderer.name, severity: "error", message: error.message }], raw: { checks: { [`${renderer.name}-check`]: { ok: false, error: error.message } } } };
  }
  const checks = result?.raw?.checks && typeof result.raw.checks === "object" ? result.raw.checks : {};
  for (const [name, value] of Object.entries(checks)) await writeJson(path.join(qaDir, `${name}.json`), value);
  const failed = Object.entries(checks).filter(([, value]) => value?.ok !== true).map(([name]) => name);
  if (result?.status !== "passed" && !failed.length) failed.push(`${renderer.name}-check`);
  return {
    schema_version: "launchclip.subscription-verification.v1",
    status: failed.length ? "failed" : "passed",
    renderer: renderer.name,
    created_at: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(checks).map(([name, value]) => [name, { ok: value?.ok === true, ...(value?.exit_code != null ? { exit_code: value.exit_code } : {}) }])),
    findings: Array.isArray(result?.findings) ? result.findings : [],
    failed
  };
}

function htmlAttribute(html, name) {
  if (html == null) return undefined;
  return String(html).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

function projectFile(project, value) {
  return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(project, String(value));
}

async function optionalProjectFile(project, value) {
  const file = projectFile(project, value);
  try { await access(file); return file; } catch { return null; }
}

async function readOptionalJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}


function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Missing or invalid ${label}`);
  return number;
}

