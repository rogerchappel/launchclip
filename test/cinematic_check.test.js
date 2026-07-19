import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkCinematicProject } from "../src/cinematic_check.js";

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

async function fixture({ complete }) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-cinematic-check-"));
  await mkdir(path.join(project, "renders"), { recursive: true });
  await writeFile(path.join(project, "index.html"), '<div data-composition-id="main" data-duration="45" data-width="1080" data-height="1920"></div>');
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
