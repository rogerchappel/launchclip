import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
  SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION,
  buildTemporalEvidenceSchedule,
  parseDeclaredSequenceBoundaries,
  readCinematicContractMarker,
  validateRenderedCandidateReceipt,
  validateTemporalEvidenceManifest
} from "../src/cinematic_evidence.js";

test("detects only an explicit phase-2 composition-root marker", () => {
  assert.equal(readCinematicContractMarker('<div data-composition-id="main" data-launchclip-cinematic-contract="phase-2"></div>'), "phase-2");
  assert.equal(readCinematicContractMarker('<div data-composition-id="main"></div><span data-launchclip-cinematic-contract="phase-2"></span>'), null);
  assert.equal(readCinematicContractMarker('<div data-composition-id="main"></div>'), null);
});

test("clamps and deduplicates the dense hook schedule", () => {
  const schedule = buildTemporalEvidenceSchedule(1);
  assert.deepEqual(schedule.hook.map((entry) => entry.at_seconds), [0, .25, .5, .75, .95]);
  assert.deepEqual(schedule.timestamps, [0, .25, .5, .75, .95]);
});

test("derives all seven shared-world transition roles", () => {
  const parsed = parseDeclaredSequenceBoundaries(`
    <div data-launchclip-sequence-id="world-1"
      data-launchclip-boundary-id="handoff-1"
      data-launchclip-transition-kind="shared-world"
      data-launchclip-transition-start="4"
      data-launchclip-transition-duration="1"></div>`, 10);
  assert.equal(parsed.ok, true);
  const transition = buildTemporalEvidenceSchedule(10, parsed.boundaries).transitions;
  assert.deepEqual(transition.map((entry) => entry.role), ["before", "departure", "early-acceleration", "peak-speed", "late-deceleration", "settle", "after"]);
  assert.deepEqual(transition.map((entry) => entry.at_seconds), [3.95, 4, 4.2, 4.5, 4.8, 5, 5.05]);
  assert.ok(transition.every((entry) => entry.boundary_id === "handoff-1" && entry.sequence_id === "world-1"));
});

test("rejects invalid and out-of-range declared boundaries", () => {
  const parsed = parseDeclaredSequenceBoundaries(`
    <div data-launchclip-boundary-id="bad"
      data-launchclip-transition-start="9.8"
      data-launchclip-transition-duration="1"></div>`, 10);
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join(" "), /extends beyond/);
});

test("requires two real rendered candidate artifacts and a valid selected ID", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidate-evidence-"));
  await mkdir(path.join(project, "qa", "rendered-candidates"), { recursive: true });
  await Promise.all([
    writeFile(path.join(project, "qa", "rendered-candidates", "a.png"), "candidate-a"),
    writeFile(path.join(project, "qa", "rendered-candidates", "b.png"), "candidate-b")
  ]);
  const receipt = {
    schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
    selected_candidate_id: "candidate-b",
    candidates: [
      { id: "candidate-a", artifacts: ["qa/rendered-candidates/a.png"] },
      { id: "candidate-b", artifacts: ["qa/rendered-candidates/b.png"] }
    ]
  };
  assert.equal((await validateRenderedCandidateReceipt(project, receipt)).ok, true);
  assert.equal((await validateRenderedCandidateReceipt(project, { ...receipt, selected_candidate_id: "missing" })).ok, false);
});

test("validates hashed browser and encoded-draft temporal evidence", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-temporal-evidence-"));
  const evidenceDir = path.join(project, "qa", "temporal-evidence");
  await mkdir(path.join(project, "renders"), { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const video = path.join(project, "renders", "draft.mp4");
  await writeFile(video, "draft-video");
  const schedule = buildTemporalEvidenceSchedule(.3);
  const entries = [];
  for (const [index, expected] of schedule.entries.entries()) {
    const file = path.join(evidenceDir, `${expected.evidence_id}.png`);
    const content = `frame-${index}`;
    await writeFile(file, content);
    entries.push({ ...expected, file: path.relative(project, file), sha256: hash(content), source: index % 2 ? "encoded-draft" : "hyperframes" });
  }
  const manifest = {
    schema_version: SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION,
    video_sha256: hash("draft-video"),
    entries
  };
  assert.equal((await validateTemporalEvidenceManifest(project, manifest, video, schedule)).ok, true);
  assert.equal((await validateTemporalEvidenceManifest(project, { ...manifest, video_sha256: "stale" }, video, schedule)).ok, false);
});

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
