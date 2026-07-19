import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  SUBSCRIPTION_CINEMATIC_CONTRACT,
  buildTemporalEvidenceSchedule,
  parseDeclaredSequenceBoundaries,
  readCinematicContractMarker,
  validateRenderedCandidateReceipt,
  validateTemporalEvidenceManifest
} from "./cinematic_evidence.js";
import { assessCinematicReadiness } from "./production_readiness.js";
import { resolveProductionProfile } from "./production_profiles.js";
import { analyzeProductionAudio, evaluateAudioQuality } from "./render_audio_analysis.js";
import { writeMotionReport } from "./render_motion_analysis.js";
import { runHyperframes } from "./toolchain.js";

const execFileAsync = promisify(execFile);

export async function checkCinematicProject(projectPath, options = {}, adapters = {}) {
  const project = path.resolve(projectPath);
  const html = await readFile(path.join(project, "index.html"), "utf8");
  const duration = positiveNumber(options.duration ?? htmlAttribute(html, "data-duration"), "composition duration");
  const width = positiveNumber(options.width ?? htmlAttribute(html, "data-width"), "composition width");
  const height = positiveNumber(options.height ?? htmlAttribute(html, "data-height"), "composition height");
  const video = projectFile(project, options.video ?? "renders/draft.mp4");
  await access(video);
  const qaDir = projectFile(project, options.qaDir ?? "qa/cinematic");
  await mkdir(qaDir, { recursive: true });

  let verification = adapters.verifyProject
    ? await adapters.verifyProject(project, qaDir, options)
    : await verifyProject(project, qaDir, options, adapters);
  await writeJson(path.join(qaDir, "verification.json"), verification);

  const orientation = height > width ? "portrait" : width > height ? "landscape" : "square";
  const profile = resolveProductionProfile("cinematic", { aspect: { orientation }, durationSeconds: duration });
  const motionPath = path.join(qaDir, "motion.json");
  const motion = await (adapters.writeMotionReport ?? writeMotionReport)(video, motionPath, {
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
  }, adapters.motion);

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
    readOptionalJson(projectFile(project, options.story ?? "STORY.json")),
    readOptionalJson(projectFile(project, options.narration ?? "NARRATION.json")),
    readOptionalJson(projectFile(project, options.critique ?? "qa/critic.json"))
  ]);
  const contractMarker = readCinematicContractMarker(html);
  let phase2Evidence = null;
  if (contractMarker) {
    phase2Evidence = await verifyPhase2Evidence(project, html, duration, video, critique, contractMarker, options);
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

async function verifyPhase2Evidence(project, html, duration, video, critique, marker, options) {
  const boundaryValidation = parseDeclaredSequenceBoundaries(html, duration);
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

async function verifyProject(project, qaDir, options, adapters) {
  const run = adapters.run ?? runCommand;
  const checks = {};
  for (const [name, args] of [
    ["lint", ["lint", "--json", project]],
    ["check", ["check", "--json", "--strict", "--snapshots", "--at-transitions", project]]
  ]) {
    try {
      const result = await runHyperframes(run, args, { cwd: project });
      const stdout = parseOutput(result.stdout);
      checks[name] = { ok: structuredOk(stdout), exit_code: Number(result.exitCode ?? result.exit_code ?? 0), stdout, stderr: String(result.stderr ?? "") };
    } catch (error) {
      checks[name] = { ok: false, exit_code: Number(error.code ?? error.exitCode ?? 1), stdout: parseOutput(error.stdout), stderr: String(error.stderr ?? error.message ?? "") };
    }
    await writeJson(path.join(qaDir, `${name}.json`), checks[name]);
  }
  const failed = Object.entries(checks).filter(([, value]) => !value.ok).map(([name]) => name);
  return {
    schema_version: "launchclip.subscription-verification.v1",
    status: failed.length ? "failed" : "passed",
    created_at: new Date().toISOString(),
    checks: Object.fromEntries(Object.entries(checks).map(([name, value]) => [name, { ok: value.ok, exit_code: value.exit_code }])),
    failed
  };
}

function structuredOk(value) {
  if (!value || typeof value !== "object") return false;
  let failed = value.ok === false || Number(value.errorCount ?? value.error_count ?? 0) > 0;
  const visit = (entry) => {
    if (failed || entry == null || typeof entry !== "object") return;
    if (entry.ok === false || Number(entry.errorCount ?? entry.error_count ?? 0) > 0) failed = true;
    if (new Set(["error", "blocking", "fatal"]).has(String(entry.severity ?? "").toLowerCase())) failed = true;
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return !failed;
}

function htmlAttribute(html, name) {
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

function parseOutput(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text.slice(0, 40_000); }
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Missing or invalid ${label}`);
  return number;
}

async function runCommand(command, args, options) {
  return execFileAsync(command, args, { ...options, maxBuffer: 1024 * 1024 * 128 });
}
