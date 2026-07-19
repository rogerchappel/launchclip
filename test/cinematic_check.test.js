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
  assert.equal(result.cinematic_contract.candidate_count, 2);
  assert.equal(result.cinematic_contract.temporal_entry_count, buildTemporalEvidenceSchedule(45).entries.length);
  const verification = JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"));
  assert.equal(verification.checks.rendered_candidates.ok, true);
  assert.equal(verification.checks.temporal_evidence.ok, true);
  assert.equal(verification.checks.critic_citations.ok, true);
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
  await writeFile(path.join(project, "index.html"), `<div data-composition-id="main" data-duration="45" data-width="1080" data-height="1920"${phase2 ? ' data-launchclip-cinematic-contract="phase-2"' : ""}></div>`);
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
  await Promise.all([
    writeFile(path.join(candidateDir, "candidate-a.png"), "candidate-a"),
    writeFile(path.join(candidateDir, "candidate-b.png"), "candidate-b")
  ]);
  await writeFile(path.join(project, "qa", "rendered-candidates.json"), JSON.stringify({
    schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
    selected_candidate_id: "candidate-b",
    candidates: [
      { id: "candidate-a", artifacts: ["qa/rendered-candidates/candidate-a.png"] },
      { id: "candidate-b", artifacts: ["qa/rendered-candidates/candidate-b.png"] }
    ]
  }));
  const schedule = buildTemporalEvidenceSchedule(45);
  const entries = [];
  for (const [index, expected] of schedule.entries.entries()) {
    const content = `temporal-${index}`;
    const file = path.join(temporalDir, `${expected.evidence_id}.png`);
    await writeFile(file, content);
    entries.push({
      ...expected,
      source: index % 2 ? "encoded-draft" : "hyperframes",
      file: path.relative(project, file),
      sha256: hash(content)
    });
  }
  await writeFile(path.join(temporalDir, "manifest.json"), JSON.stringify({
    schema_version: SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION,
    video_sha256: hash("video"),
    entries
  }));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
