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
import { validateConceptsReceipt, validateStoryReceipt } from "./cinematic_receipts.js";
import { resolveProductionProfile } from "./production_profiles.js";
import { analyzeProductionAudio, evaluateAudioQuality } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { getRenderer, resolveRendererName } from "./renderers/index.js";
import { hasExactFile, readProjectStory } from "./story_loader.js";
import { readStorySubject } from "./subject/project.js";
import { catalogModules, resolveModule } from "../kit/core/modules.mjs";
import { storyBase } from "../kit/core/story.mjs";
import { needsSubject } from "../kit/core/subject-layer.mjs";

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
  // The music gain the mix actually used, so this gate and finish's agree.
  const mixSettings = await resolveMusicMix(project, audioManifest, { musicVolume: options.musicVolume ?? options["music-volume"] });
  const audio = await (adapters.analyzeProductionAudio ?? analyzeProductionAudio)(video, audioManifest, {
    musicVolume: mixSettings.music_volume
  }, adapters.audio);
  audio.mix_settings = mixSettings;
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
  // The subject gate: matte quality per range. It reports; finish is what
  // drops a failing range's scenes to their fallback before rendering.
  const subjectGate = storyboard ? await subjectMatteGate(project, await readStorySubject(project, storyboard.story)) : { status: "skipped", reason: "no storyboard", ranges: [] };
  const contractMarker = storyboard ? readStoryCinematicContractMarker(storyboard.story) : readCinematicContractMarker(html);
  let phase2Evidence = null;
  if (contractMarker) {
    phase2Evidence = await verifyPhase2Evidence(project, duration, video, critique, contractMarker, { ...options, storyModule });
    verification = augmentVerification(verification, phase2Evidence.checks);
  }
  await writeJson(path.join(qaDir, "verification.json"), verification);
  // The creative receipts' minimal schemas (launchclip.concepts.v1 and
  // launchclip.story-receipt.v1): missing required fields fail the gate.
  const conceptsCheck = concepts ? validateConceptsReceipt(concepts) : null;
  const storyCheck = story ? validateStoryReceipt(story, { conceptsChosenId: conceptsCheck?.chosen_id ?? null, duration }) : null;
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
      assembly: { fallback_count: 0, fallbacks: [], provenance: "subscription-agent-authored" },
      receipts: { concepts: conceptsCheck, story: storyCheck }
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
    subject: subjectGate,
    blockers: readiness.blockers,
    repair_findings: readiness.repair_findings,
    receipt_warnings: [...(conceptsCheck?.warnings ?? []).map((message) => `CONCEPTS.json: ${message}`), ...(storyCheck?.warnings ?? []).map((message) => `STORY.json: ${message}`)],
    ...(phase2Evidence ? { cinematic_contract: phase2Evidence.summary } : {})
  };
}

// ---------------------------------------------------------------------------
// Subject gate (docs/SUBJECT_EFFECTS_RFC.md §9): a matte range is only used
// when its cut-out holds steady. A range fails when its subject.json says it
// is unusable, when coverage varies too much across the range (stability, as
// the subject stage measures it), or when any frame collapses (coverage near
// 0, or under a third of the range's median) or jumps (a frame-to-frame
// change over 30% of the median). finish drops a failing range's scenes to
// their front-layer fallback (applySubjectFallback) instead of shipping a
// broken cut-out.
export const MATTE_GATE = Object.freeze({ stability: 0.7, collapse: 0.33, collapseFloor: 0.01, jump: 0.3, jumpFloor: 0.03 });

/**
 * One range's matte quality from its subject.json (launchclip.subject.v1).
 * → {ok, reasons: [string], stability, median, collapsed: [t], jumps: [t]}
 */
export function matteQuality(info, limits = MATTE_GATE) {
  const frames = (Array.isArray(info?.frames) ? info.frames : []).filter((frame) => Number.isFinite(frame?.coverage) && Number.isFinite(frame?.t));
  if (!frames.length) return { ok: false, reasons: ["the matte has no measured frames"], stability: 0, median: 0, collapsed: [], jumps: [] };
  const values = frames.map((frame) => frame.coverage);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  const stability = mean > 0 ? Math.min(1, Math.max(0, 1 - deviation / mean)) : 0;
  const floor = Math.max(limits.collapseFloor, median * limits.collapse);
  const step = Math.max(limits.jumpFloor, median * limits.jump);
  const collapsed = frames.filter((frame) => frame.coverage < floor).map((frame) => round3(frame.t));
  const jumps = [];
  for (let i = 1; i < frames.length; i += 1) if (Math.abs(frames[i].coverage - frames[i - 1].coverage) > step) jumps.push(round3(frames[i].t));
  const reasons = [];
  if (info?.usable === false) reasons.push(`the subject stage marked it unusable (${(info.reasons ?? []).join("; ") || "no reason given"})`);
  if (stability < limits.stability) reasons.push(`coverage is unstable across the range (stability ${round3(stability)}, needs ${limits.stability})`);
  if (collapsed.length) reasons.push(`the matte collapses in ${collapsed.length} frame${collapsed.length === 1 ? "" : "s"} (coverage under ${round3(floor)}, first at ${collapsed[0]} s)`);
  if (jumps.length) reasons.push(`coverage jumps by more than ${round3(step)} between frames ${jumps.length} time${jumps.length === 1 ? "" : "s"} (first at ${jumps[0]} s)`);
  return { ok: reasons.length === 0, reasons, stability: round3(stability), median: round3(median), collapsed, jumps };
}

/**
 * The subject gate for a project's mattes (readStorySubject's entries).
 * → {status: "passed" | "failed" | "skipped", reason?, ranges: [{src, in,
 * out, ok, reasons, stability}]}. A range without info cannot be measured
 * and is reported as skipped, never failed.
 */
export async function subjectMatteGate(project, mattes) {
  if (!Array.isArray(mattes) || !mattes.length) return { status: "skipped", reason: "the story uses no mattes", ranges: [] };
  const ranges = [];
  for (const matte of mattes) {
    if (!matte.info) { ranges.push({ src: matte.src, in: matte.in, out: matte.out, ok: true, skipped: true, reasons: ["no subject.json to measure"] }); continue; }
    let info;
    try { info = JSON.parse(await readFile(path.join(project, matte.info), "utf8")); }
    catch (error) { ranges.push({ src: matte.src, in: matte.in, out: matte.out, ok: false, reasons: [`${matte.info} cannot be read (${error.message})`] }); continue; }
    const quality = matteQuality(info);
    ranges.push({ src: matte.src, in: matte.in, out: matte.out, ok: quality.ok, reasons: quality.reasons, stability: quality.stability });
  }
  return { status: ranges.every((range) => range.ok) ? "passed" : "failed", ranges };
}

/**
 * The fallback for failing matte ranges. story: the unresolved story (not
 * changed); resolved: the same story resolved with every matte; failed:
 * [{in, out, src}] source ranges; kept: the mattes that passed.
 * Every scene whose window overlaps a failing range's footage:
 * - a module that needs the subject (it is built round the cut-out, its room
 *   plate or its outline) is skipped: the recording shows there instead;
 * - any other scene on the behind or split layer renders in front;
 * - any other scene whose model still moves, restyles or hides around the
 *   subject (subjectCamera, subjectStyle, room) is skipped.
 * base.subject becomes the explicit list of kept mattes.
 * → {story, changes: [{id, module, action: "front" | "skipped", range}]}
 */
export function applySubjectFallback(story, resolved, { failed = [], kept = [] } = {}) {
  const copy = JSON.parse(JSON.stringify(story));
  const changes = [];
  if (!failed.length || !copy.base || typeof copy.base !== "object") return { story: copy, changes };
  const base = storyBase(resolved);
  // Timeline windows that show each failing range's footage.
  const windows = [];
  for (const range of failed) {
    for (const segment of base?.segments ?? []) {
      const from = Math.max(range.in, segment.sourceStart), to = Math.min(range.out, segment.sourceStart + segment.duration);
      if (to > from) windows.push({ range, start: segment.start + (from - segment.sourceStart), end: segment.start + (to - segment.sourceStart) });
    }
  }
  const catalogue = catalogModules();
  const byId = new Map(resolved.scenes.map((scene) => [scene.id, scene]));
  const skipped = new Set();
  for (const scene of copy.scenes ?? []) {
    const timed = byId.get(scene.id);
    if (!timed) continue;
    const hit = windows.find((window) => Number(timed.start) < window.end - 1e-6 && Number(timed.end) > window.start + 1e-6);
    if (!hit) continue;
    let model = null;
    try { model = resolveModule(timed, resolved); } catch { /* unresolvable scenes are reported by validation */ }
    const layered = (scene.layer ?? model?.layer ?? "front") !== "front";
    if (!layered && !needsSubject(timed, model)) continue;
    const range = `${hit.range.in}–${hit.range.out} s`;
    if (catalogue[scene.module]?.needs?.includes("subject") || model?.subjectCamera || model?.subjectStyle || model?.room) {
      skipped.add(scene.id);
      changes.push({ id: scene.id, module: scene.module, action: "skipped", range });
    } else {
      scene.layer = "front";
      changes.push({ id: scene.id, module: scene.module, action: "front", range });
    }
  }
  copy.scenes = (copy.scenes ?? []).filter((scene) => !skipped.has(scene.id));
  copy.base.subject = { mattes: kept.map(({ src, in: from, out, info, plate, contours }) => ({ src, in: from, out, ...(info ? { info } : {}), ...(plate ? { plate } : {}), ...(contours ? { contours } : {}) })) };
  return { story: copy, changes };
}

/** One line per fallback change, for warnings. */
export function subjectFallbackLines(changes) {
  return changes.map((change) => change.action === "skipped"
    ? `${change.id} (${change.module}) is skipped: the presenter matte for ${change.range} failed the subject gate, and the module needs the cut-out`
    : `${change.id} (${change.module}) renders in front: the presenter matte for ${change.range} failed the subject gate`);
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

// The music bed gain cinematic-check (and finish's audio gate) assume when
// estimating the voice-to-music margin. The mix scales the music track by
// this volume, so the estimate is only right with the volume that was used.
export const DEFAULT_MUSIC_VOLUME = .15;

/**
 * The music mix a project was built with, most specific first:
 *   1. options.musicVolume (--music-volume, or the --musicVolume alias);
 *   2. AUDIO-MANIFEST.json music.volume (finish writes the bed volume there);
 *   3. finish.json's sound stage bed.volume (or options.soundDetails);
 *   4. DEFAULT_MUSIC_VOLUME (0.15) for a manual mix with none of these.
 * -> {music_volume, source, music_file, ducking}
 */
export async function resolveMusicMix(project, manifestPath, options = {}) {
  const manifest = manifestPath ? await readOptionalJson(manifestPath).catch(() => null) : null;
  const explicit = options.musicVolume;
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    const value = Number(explicit);
    if (!Number.isFinite(value) || value <= 0 || value > 4) throw new Error(`--music-volume must be a number above 0 and at most 4 (the linear gain the mix applied to the music); got ${explicit}`);
    return mixResult(value, "--music-volume", manifest);
  }
  const fromManifest = Number(manifest?.music?.volume);
  if (Number.isFinite(fromManifest) && fromManifest > 0) return mixResult(fromManifest, "AUDIO-MANIFEST.json music.volume", manifest);
  const sound = options.soundDetails !== undefined
    ? options.soundDetails
    : (await readOptionalJson(path.join(project, "finish.json")).catch(() => null))?.stages?.find?.((stage) => stage?.name === "sound")?.details;
  const fromFinish = Number(sound?.bed?.volume);
  if (Number.isFinite(fromFinish) && fromFinish > 0) return mixResult(fromFinish, options.soundDetails !== undefined ? "finish sound stage bed.volume" : "finish.json sound stage bed.volume", manifest);
  return mixResult(DEFAULT_MUSIC_VOLUME, "default (no --music-volume, AUDIO-MANIFEST.json music.volume or finish.json)", manifest);
}

function mixResult(volume, source, manifest) {
  return { music_volume: volume, source, music_file: manifest?.music?.path ?? null, ducking: manifest?.mix?.ducking ?? null };
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

