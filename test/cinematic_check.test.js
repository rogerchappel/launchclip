import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkCinematicProject } from "../src/cinematic_check.js";
import { SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION, SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION, buildTemporalEvidenceSchedule } from "../src/cinematic_evidence.js";

test("passes a subscription project only with complete cinematic evidence", async () => {
  const project = await fixture({ complete: true });
  const result = await checkCinematicProject(project, { expectAudio: true }, passingAdapters());
  assert.equal(result.status, "ready");
  assert.ok(Object.values(result.gates).every((gate) => gate.ok));
  const receipt = JSON.parse(await readFile(result.readiness, "utf8"));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.profile.lane, "portrait-short");
});

test("fails closed without creative receipts, a critic, or audio provenance", async () => {
  const project = await fixture({ complete: false });
  const adapters = passingAdapters();
  adapters.writeMotionReport = async (_video, output) => {
    const report = { quality: { ok: false, findings: [{ category: "hook", severity: "major", message: "Opening is static." }] }, family: "developing-card" };
    await writeFile(output, `${JSON.stringify(report)}\n`);
    return report;
  };
  const result = await checkCinematicProject(project, { expectAudio: true }, adapters);
  assert.equal(result.status, "needs-repair");
  assert.deepEqual(result.blockers.map((entry) => entry.gate), ["concepts", "story", "narration", "critic"]);
  assert.equal(result.gates.audio.ok, false);
  assert.equal(result.repair_findings.some((entry) => entry.repair_scope === "plan"), true);
  assert.equal(result.repair_findings.some((entry) => entry.repair_scope === "audio"), true);
});

test("keeps legacy projects unchanged but fails a marked project without phase-2 evidence", async () => {
  const project = await fixture({ complete: true, phase2: true });
  const result = await checkCinematicProject(project, { expectAudio: true }, passingAdapters());
  assert.equal(result.status, "needs-repair");
  assert.equal(result.cinematic_contract.marker, "phase-2");
  assert.equal(result.cinematic_contract.status, "failed");
  const verification = JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"));
  assert.equal(verification.schema_version, "launchclip.subscription-verification.v1");
  assert.equal(verification.checks.cinematic_contract.ok, true);
  assert.equal(verification.checks.rendered_candidates.ok, false);
  assert.equal(verification.checks.temporal_evidence.ok, false);
  assert.ok(verification.failed.includes("rendered_candidates"));
  assert.ok(verification.failed.includes("temporal_evidence"));
});

test("passes a marked project only with candidate pixels and hashed temporal evidence", async () => {
  const project = await fixture({ complete: true, phase2: true });
  await writePhase2Evidence(project);
  const result = await checkCinematicProject(project, { expectAudio: true }, passingAdapters());
  assert.equal(result.status, "ready");
  assert.equal(result.cinematic_contract.status, "passed");
  assert.equal(result.cinematic_contract.shared_world_boundary_count, 1);
  assert.equal(result.cinematic_contract.candidate_comparison_count, 2);
  assert.equal(result.cinematic_contract.candidate_count, 4);
  assert.equal(result.cinematic_contract.temporal_entry_count, phase2Schedule().entries.length * 2);
  const verification = JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"));
  assert.equal(verification.checks.rendered_candidates.ok, true);
  assert.equal(verification.checks.temporal_evidence.ok, true);
  assert.equal(verification.checks.critic_citations.ok, true);
});

test("rejects a phase-2 critic that did not review every temporal artifact", async () => {
  const project = await fixture({ complete: true, phase2: true });
  await writePhase2Evidence(project);
  const criticPath = path.join(project, "qa", "critic.json");
  const critic = JSON.parse(await readFile(criticPath, "utf8"));
  critic.evidence_ids_reviewed = critic.evidence_ids_reviewed.slice(1);
  await writeFile(criticPath, JSON.stringify(critic));
  const result = await checkCinematicProject(project, { expectAudio: true }, passingAdapters());
  assert.equal(result.status, "needs-repair");
  const verification = JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"));
  assert.equal(verification.checks.critic_citations.ok, false);
  assert.match(verification.checks.critic_citations.errors.join(" "), /did not review every temporal artifact/);
});

test("rejects phase-2 evidence after the encoded draft changes", async () => {
  const project = await fixture({ complete: true, phase2: true });
  await writePhase2Evidence(project);
  await writeFile(path.join(project, "renders", "draft.mp4"), "changed-video");
  const result = await checkCinematicProject(project, { expectAudio: true }, passingAdapters());
  assert.equal(result.status, "needs-repair");
  const verification = JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"));
  assert.equal(verification.checks.temporal_evidence.ok, false);
  assert.match(verification.checks.temporal_evidence.errors.join(" "), /does not match the current encoded draft/);
});

function passingAdapters() {
  return {
    verifyProject: async () => ({ schema_version: "launchclip.subscription-verification.v1", status: "passed", failed: [] }),
    writeMotionReport: async (_video, output, options) => {
      assert.equal(options.expected.maximum_hold_ratio, .8);
      assert.equal(options.expected.minimum_bursts_per_minute, 20);
      assert.equal(options.expected.minimum_hook_events, 3);
      const report = { quality: { ok: true, findings: [] }, family: "developing-card" };
      await writeFile(output, `${JSON.stringify(report)}\n`);
      return report;
    },
    analyzeProductionAudio: async () => ({ expected_audio: true, stream: { codec_type: "audio" }, output: {}, sources: { voiceover: null, music: null }, cues: [], quality: { ok: true, findings: [] } })
  };
}

async function fixture({ complete, phase2 = false }) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-cinematic-check-"));
  await mkdir(path.join(project, "renders"), { recursive: true });
  const boundary = phase2 ? `<div data-launchclip-sequence-id="world-1" data-launchclip-boundary-id="handoff-1" data-launchclip-transition-kind="shared-world" data-launchclip-transition-start="10" data-launchclip-transition-duration="1"></div>` : "";
  await writeFile(path.join(project, "index.html"), `<div data-composition-id="main" data-duration="45" data-width="1080" data-height="1920"${phase2 ? ' data-launchclip-cinematic-contract="phase-2"' : ""}>${boundary}</div>`);
  await writeFile(path.join(project, "renders", "draft.mp4"), "video");
  if (complete) {
    await mkdir(path.join(project, "qa"), { recursive: true });
    await Promise.all([
      writeFile(path.join(project, "CONCEPTS.json"), JSON.stringify({ selected_id: "concept-4" })),
      writeFile(path.join(project, "STORY.json"), JSON.stringify({ concept_id: "concept-4" })),
      writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ duration_seconds: 45, words: [] })),
      writeFile(path.join(project, "AUDIO-MANIFEST.json"), JSON.stringify({ voiceover: { path: "voice.wav" }, music: null, sfx_manifest: null })),
      writeFile(path.join(project, "qa", "critic.json"), JSON.stringify({ verdict: "ship", findings: [] }))
    ]);
  }
  return project;
}

async function writePhase2Evidence(project) {
  const candidateDir = path.join(project, "qa", "rendered-candidates");
  const temporalDir = path.join(project, "qa", "temporal-evidence");
  await Promise.all([mkdir(candidateDir, { recursive: true }), mkdir(temporalDir, { recursive: true })]);
  const artifactHashes = new Map();
  await Promise.all(["opening-a", "opening-b", "transition-a", "transition-b"].map(async (id) => {
    const artifacts = [];
    for (const phase of ["entry", "peak", "settle"]) {
      const bytes = renderedPng(`${id}-${phase}`);
      const file = `qa/rendered-candidates/${id}-${phase}.png`;
      artifacts.push({ file, sha256: hash(bytes) });
      await writeFile(path.join(project, file), bytes);
    }
    artifactHashes.set(id, artifacts);
  }));
  await writeFile(path.join(project, "qa", "rendered-candidates.json"), JSON.stringify({
    schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
    comparisons: [
      candidateComparison("opening", "opening", ["opening-a", "opening-b"], "opening-b", artifactHashes),
      candidateComparison("handoff-1", "transition", ["transition-a", "transition-b"], "transition-a", artifactHashes, "handoff-1")
    ]
  }));
  const schedule = phase2Schedule();
  const entries = [];
  for (const expected of schedule.entries) {
    for (const source of ["hyperframes", "encoded-draft"]) {
      const evidenceId = `${expected.evidence_id}-${source}`;
      const content = `temporal-${evidenceId}`;
      const file = path.join(temporalDir, `${evidenceId}.png`);
      await writeFile(file, content);
      entries.push({
        ...expected,
        sample_id: expected.evidence_id,
        evidence_id: evidenceId,
        source,
        file: path.relative(project, file),
        sha256: hash(content)
      });
    }
  }
  await writeFile(path.join(temporalDir, "manifest.json"), JSON.stringify({
    schema_version: SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION,
    video_sha256: hash("video"),
    entries
  }));
  await writeFile(path.join(project, "qa", "critic.json"), JSON.stringify({
    verdict: "ship",
    findings: [],
    summary: "Fresh-context review of every required temporal artifact.",
    evidence_ids_reviewed: entries.map((entry) => entry.evidence_id)
  }));
}

function phase2Schedule() {
  return buildTemporalEvidenceSchedule(45, [{
    boundary_id: "handoff-1",
    sequence_id: "world-1",
    kind: "shared-world",
    start_seconds: 10,
    duration_seconds: 1
  }]);
}

function candidateComparison(id, kind, candidateIds, selectedId, artifactHashes, boundaryId) {
  return {
    id,
    kind,
    ...(boundaryId ? { boundary_id: boundaryId } : {}),
    judging_basis: "rendered-pixels-and-motion",
    candidate_order: [...candidateIds],
    selected_candidate_id: selectedId,
    selection_rationale: `${selectedId} wins the deterministic rendered scorecard.`,
    candidates: candidateIds.map((candidateId) => ({
      id: candidateId,
      render_id: `render-${candidateId}`,
      admissible: true,
      artifacts: artifactHashes.get(candidateId),
      scores: candidateScores(candidateId === selectedId ? 9 : 8),
      ...(candidateId === selectedId ? {} : { rejection_reasons: ["Weaker delivery-size hierarchy."] })
    }))
  };
}

function candidateScores(value) {
  return Object.fromEntries([
    "scroll_stop",
    "promise_or_proof_clarity",
    "mobile_hierarchy",
    "art_direction_specificity",
    "depth_materiality",
    "temporal_development",
    "continuity",
    "velocity_blur_shape",
    "crisp_settle",
    "implementation_feasibility"
  ].map((field) => [field, value]));
}

function renderedPng(seed) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  return Buffer.concat([png, Buffer.from(seed)]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
