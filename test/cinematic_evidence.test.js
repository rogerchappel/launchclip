import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
  SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION,
  buildTemporalEvidenceSchedule,
  parseDeclaredSequenceBoundaries,
  readCinematicContractMarker,
  TEMPORAL_EVIDENCE_SOURCES,
  canonicalTemporalEvidenceSource,
  declaredBoundariesForProject,
  readStoryCinematicContractMarker,
  validateRenderedCandidateReceipt,
  validateTemporalEvidenceManifest
} from "../src/cinematic_evidence.js";
import * as storyModule from "./fixtures/story-stub.mjs";

test("detects only an explicit phase-2 composition-root marker", () => {
  assert.equal(readCinematicContractMarker('<div data-composition-id="main" data-launchclip-cinematic-contract="phase-2"></div>'), "phase-2");
  assert.equal(readCinematicContractMarker('<div data-composition-id="main"></div><span data-launchclip-cinematic-contract="phase-2"></span>'), null);
  assert.equal(readCinematicContractMarker('<div data-composition-id="main"></div>'), null);
});

test("clamps and deduplicates the dense hook schedule", () => {
  const schedule = buildTemporalEvidenceSchedule(1);
  assert.deepEqual(schedule.hook.map((entry) => entry.at_seconds), [0, .25, .5, .75, .95]);
  assert.deepEqual(schedule.timestamps, [0, .25, .5, .75, .95]);
  assert.deepEqual(schedule.final_hold, { evidence_id: "final-hold", role: "final-hold", at_seconds: .95, boundary_id: null, sequence_id: null });
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

test("requires independent opening and transition rendered-candidate comparisons", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-candidate-evidence-"));
  await mkdir(path.join(project, "qa", "rendered-candidates"), { recursive: true });
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
  const receipt = {
    schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
    comparisons: [
      comparison("opening", "opening", ["opening-a", "opening-b"], "opening-b", artifactHashes),
      comparison("handoff-1", "transition", ["transition-a", "transition-b"], "transition-a", artifactHashes, "boundary-1")
    ]
  };
  const valid = await validateRenderedCandidateReceipt(project, receipt, { boundaryIds: ["boundary-1"] });
  assert.equal(valid.ok, true);
  assert.equal(valid.comparison_count, 2);
  assert.equal(valid.candidate_count, 4);
  assert.equal((await validateRenderedCandidateReceipt(project, {
    schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION,
    selected_candidate_id: "opening-b",
    candidates: receipt.comparisons[0].candidates
  })).ok, false);
  assert.equal((await validateRenderedCandidateReceipt(project, receipt, { boundaryIds: ["other-boundary"] })).ok, false);
  const wrongWinner = structuredClone(receipt);
  wrongWinner.comparisons[0].selected_candidate_id = "opening-a";
  wrongWinner.comparisons[0].candidates[1].rejection_reasons = ["Incorrectly rejected."];
  assert.match((await validateRenderedCandidateReceipt(project, wrongWinner, { boundaryIds: ["boundary-1"] })).errors.join(" "), /deterministic score winner/);
  const staleHash = structuredClone(receipt);
  staleHash.comparisons[0].candidates[0].artifacts[0].sha256 = "stale";
  assert.match((await validateRenderedCandidateReceipt(project, staleHash, { boundaryIds: ["boundary-1"] })).errors.join(" "), /stale or invalid file hash/);
  const nonnumericScore = structuredClone(receipt);
  nonnumericScore.comparisons[0].candidates[0].scores.scroll_stop = null;
  assert.match((await validateRenderedCandidateReceipt(project, nonnumericScore, { boundaryIds: ["boundary-1"] })).errors.join(" "), /invalid scroll_stop score/);
  const reusedPixels = structuredClone(receipt);
  reusedPixels.comparisons[1].candidates[0].artifacts = structuredClone(reusedPixels.comparisons[0].candidates[0].artifacts);
  assert.match((await validateRenderedCandidateReceipt(project, reusedPixels, { boundaryIds: ["boundary-1"] })).errors.join(" "), /reuses rendered pixels from opening-a in opening/);
  const outside = await mkdtemp(path.join(os.tmpdir(), "launchclip-outside-evidence-"));
  const outsidePixels = renderedPng("outside");
  await writeFile(path.join(outside, "outside.png"), outsidePixels);
  await symlink(path.join(outside, "outside.png"), path.join(project, "qa", "rendered-candidates", "outside.png"));
  const symlinkedPixels = structuredClone(receipt);
  symlinkedPixels.comparisons[0].candidates[0].artifacts[0] = { file: "qa/rendered-candidates/outside.png", sha256: hash(outsidePixels) };
  assert.match((await validateRenderedCandidateReceipt(project, symlinkedPixels, { boundaryIds: ["boundary-1"] })).errors.join(" "), /path escapes project through a symbolic link/);
  const textArtifact = structuredClone(receipt);
  const text = "not rendered pixels";
  await writeFile(path.join(project, textArtifact.comparisons[0].candidates[0].artifacts[0].file), text);
  textArtifact.comparisons[0].candidates[0].artifacts[0].sha256 = hash(text);
  assert.match((await validateRenderedCandidateReceipt(project, textArtifact, { boundaryIds: ["boundary-1"] })).errors.join(" "), /not a recognized rendered image or video/);
});

for (const browserSource of ["browser-still", "hyperframes"]) test(`requires hashed browser and encoded-draft evidence for every temporal sample (${browserSource} source)`, async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-temporal-evidence-"));
  const evidenceDir = path.join(project, "qa", "temporal-evidence");
  await mkdir(path.join(project, "renders"), { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const video = path.join(project, "renders", "draft.mp4");
  await writeFile(video, "draft-video");
  const schedule = buildTemporalEvidenceSchedule(.3);
  const entries = [];
  for (const expected of schedule.entries) {
    for (const source of [browserSource, "encoded-draft"]) {
      const evidenceId = `${expected.evidence_id}-${source}`;
      const file = path.join(evidenceDir, `${evidenceId}.png`);
      const content = renderedPng(`frame-${evidenceId}`);
      await writeFile(file, content);
      entries.push({ ...expected, sample_id: expected.evidence_id, evidence_id: evidenceId, source, file: path.relative(project, file), sha256: hash(content) });
    }
  }
  const manifest = {
    schema_version: SUBSCRIPTION_TEMPORAL_EVIDENCE_VERSION,
    video_sha256: hash("draft-video"),
    entries
  };
  assert.equal((await validateTemporalEvidenceManifest(project, manifest, video, schedule)).ok, true);
  assert.equal((await validateTemporalEvidenceManifest(project, { ...manifest, entries: entries.slice(1) }, video, schedule)).ok, false);
  const outOfRange = structuredClone(manifest);
  outOfRange.entries[0].at_seconds = 99;
  assert.match((await validateTemporalEvidenceManifest(project, outOfRange, video, schedule)).errors.join(" "), /out-of-range timestamp/);
  assert.equal((await validateTemporalEvidenceManifest(project, { ...manifest, video_sha256: "stale" }, video, schedule)).ok, false);
  const unsupported = structuredClone(manifest);
  unsupported.entries[0].source = "screenshot";
  assert.match((await validateTemporalEvidenceManifest(project, unsupported, video, schedule)).errors.join(" "), /unsupported evidence source/);
  // A legacy and a current browser artifact for the same sample are two browser stills, not one.
  const duplicated = structuredClone(manifest);
  const browserEntry = duplicated.entries.find((entry) => entry.source === browserSource);
  duplicated.entries.push({ ...browserEntry, evidence_id: `${browserEntry.sample_id}-dup`, source: browserSource === "hyperframes" ? "browser-still" : "hyperframes" });
  assert.match((await validateTemporalEvidenceManifest(project, duplicated, video, schedule)).errors.join(" "), /requires exactly one browser-still artifact/);
});

test("writes browser-still and accepts hyperframes only as a legacy alias", () => {
  assert.deepEqual(TEMPORAL_EVIDENCE_SOURCES, ["browser-still", "encoded-draft"]);
  assert.equal(canonicalTemporalEvidenceSource("browser-still"), "browser-still");
  assert.equal(canonicalTemporalEvidenceSource("hyperframes"), "browser-still");
  assert.equal(canonicalTemporalEvidenceSource("encoded-draft"), "encoded-draft");
  assert.equal(canonicalTemporalEvidenceSource("remotion"), null);
  assert.equal(canonicalTemporalEvidenceSource("toString"), null);
});

test("derives declared boundaries from story.json before index.html", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-story-boundaries-"));
  await writeFile(path.join(project, "index.html"), '<div data-composition-id="main" data-duration="9" data-width="1080" data-height="1920"><i data-launchclip-boundary-id="html-1" data-launchclip-transition-start="2" data-launchclip-transition-duration=".5"></i></div>');
  const fromHtml = await declaredBoundariesForProject(project, { storyModule });
  assert.equal(fromHtml.source, "index.html");
  assert.deepEqual(fromHtml.boundaries.map((entry) => entry.boundary_id), ["html-1"]);
  assert.equal(fromHtml.format.duration, 9);

  await writeFile(path.join(project, "NARRATION.json"), JSON.stringify({ words: [{ text: "cools", start: 4.2, end: 4.6 }] }));
  await writeFile(path.join(project, "story.json"), JSON.stringify(storyFixture()));
  const fromStory = await declaredBoundariesForProject(project, { storyModule });
  assert.equal(fromStory.source, "story.json");
  assert.equal(fromStory.ok, true);
  assert.deepEqual(fromStory.format, { duration: 8, width: 1080, height: 1920, fps: 30 });
  assert.deepEqual(fromStory.boundaries, [
    { boundary_id: "s2-in", sequence_id: null, kind: "ordinary", start_seconds: 3, duration_seconds: .4, from_id: "s1", to_id: "s2" },
    { boundary_id: "s3-in", sequence_id: "s2", kind: "shared-world", start_seconds: 4.2, duration_seconds: .6, from_id: "s2", to_id: "s3" }
  ]);
  const schedule = buildTemporalEvidenceSchedule(fromStory.format.duration, fromStory.boundaries);
  assert.equal(schedule.transitions.filter((entry) => entry.boundary_id === "s3-in").length, 7);

  const late = storyFixture();
  late.scenes[2].in.dur = 9;
  await writeFile(path.join(project, "story.json"), JSON.stringify(late));
  assert.match((await declaredBoundariesForProject(project, { storyModule })).errors.join(" "), /s3-in extends beyond the composition duration/);
});

test("ignores a creative STORY.json and explains a missing story module", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-story-missing-"));
  await writeFile(path.join(project, "index.html"), '<div data-composition-id="main" data-duration="5"></div>');
  await writeFile(path.join(project, "STORY.json"), JSON.stringify({ concept_id: "concept-1" }));
  assert.equal((await declaredBoundariesForProject(project, { storyModule: path.join(project, "nope.mjs") })).source, "index.html");
  const storyProject = await mkdtemp(path.join(os.tmpdir(), "launchclip-story-missing-"));
  await writeFile(path.join(storyProject, "story.json"), JSON.stringify(storyFixture()));
  await assert.rejects(declaredBoundariesForProject(storyProject, { storyModule: path.join(storyProject, "nope.mjs") }), /story\.json support requires .*nope\.mjs.*kit\/core\/story\.mjs/s);
});

test("reads the phase-2 marker from a story", () => {
  assert.equal(readStoryCinematicContractMarker({ phase: 2 }), "phase-2");
  assert.equal(readStoryCinematicContractMarker({ cinematic_contract: "phase-2" }), "phase-2");
  assert.equal(readStoryCinematicContractMarker({ cinematic_contract: "phase-3" }), "phase-3");
  assert.equal(readStoryCinematicContractMarker({ phase: 1 }), null);
  assert.equal(readStoryCinematicContractMarker(null), null);
});

function storyFixture() {
  return {
    schema: "launchclip.story.v1",
    format: { width: 1080, height: 1920, fps: 30, duration: 8 },
    scenes: [
      { id: "s1", module: "metric", start: 0, end: 3 },
      { id: "s2", module: "callout", start: 3, end: "word:cools", in: { type: "push", dur: .4 } },
      { id: "s3", module: "growth-chart", start: "word:cools", end: 8, in: { type: "zoom", dur: .6, from_object: "s2.badge" } }
    ]
  };
}

function comparison(id, kind, candidateIds, selectedId, artifactHashes, boundaryId) {
  return {
    id,
    kind,
    ...(boundaryId ? { boundary_id: boundaryId } : {}),
    judging_basis: "rendered-pixels-and-motion",
    candidate_order: [...candidateIds],
    selected_candidate_id: selectedId,
    selection_rationale: `${selectedId} has the strongest rendered lifecycle.`,
    candidates: candidateIds.map((candidateId, index) => ({
      id: candidateId,
      render_id: `render-${candidateId}`,
      admissible: true,
      artifacts: artifactHashes.get(candidateId),
      scores: candidateScores(candidateId === selectedId ? 9 : 8 - index * .1),
      ...(candidateId === selectedId ? {} : { rejection_reasons: ["Weaker hierarchy at delivery size."] })
    }))
  };
}

function candidateScores(value) {
  return {
    scroll_stop: value,
    promise_or_proof_clarity: value,
    mobile_hierarchy: value,
    art_direction_specificity: value,
    depth_materiality: value,
    temporal_development: value,
    continuity: value,
    velocity_blur_shape: value,
    crisp_settle: value,
    implementation_feasibility: value
  };
}

function renderedPng(seed) {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  return Buffer.concat([png, Buffer.from(seed)]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
