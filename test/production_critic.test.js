import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { critiqueProduction } from "../src/production_critic.js";
import { CRITIQUE_VERSION } from "../src/production_contracts.js";

test("gives an independent GPT-5.6 critic the plan, QA evidence, motion profile, and ordered snapshots", async () => {
  const workspace = await fixture();
  let request;
  const client = { runStructured: async (options) => {
    request = options;
    return { response_id: "resp_critic", model: "gpt-5.6-sol", usage: { total_tokens: 1200 }, value: { schema_version: CRITIQUE_VERSION, verdict: "repair", summary: "The proof is legible but the second beat loses hierarchy.", findings: [{ id: "f-1", severity: "major", category: "composition", shot_ids: ["shot-2"], start_seconds: 5, end_seconds: 8, evidence: "The screenshot and presenter occupy the same visual tier.", repair_scope: "frame", instruction: "Reduce presenter occupancy and give the proof card a dominant scale.", preserve: ["lime proof accent", "exact copy"] }] } };
  } };
  const result = await critiqueProduction(workspace, { background: false }, { client });
  assert.equal(result.status, "needs-repair");
  assert.equal(result.verdict, "repair");
  assert.equal(request.model, "gpt-5.6");
  assert.equal(request.reasoningEffort, "xhigh");
  assert.equal(request.images.length, 2);
  assert.match(request.images[0].url, /^data:image\/png;base64,/);
  const input = JSON.parse(request.input);
  assert.equal(input.temporal_motion_analysis.family, "rapid-hybrid");
  assert.equal(input.time_aligned_audio_analysis.output.integrated_lufs, -14);
  assert.equal(input.deterministic_reports.inspect.stdout.issueCount, 1);
  assert.equal(input.evidence_index[0].content, "The README proves the workflow.");
  assert.equal(input.claim_support[0].evidence[0].id, "ev-1");
  assert.deepEqual(input.snapshot_order, ["001.png", "002.png"]);
  assert.match(await readFile(result.markdown, "utf8"), /Reduce presenter occupancy/);
});

test("rejects unknown shots and a ship verdict containing major findings", async () => {
  const workspace = await fixture();
  const response = (value) => ({ client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", usage: {}, value }) } });
  await assert.rejects(() => critiqueProduction(workspace, {}, response({ schema_version: CRITIQUE_VERSION, verdict: "repair", summary: "bad", findings: [{ id: "f", severity: "major", category: "motion", shot_ids: ["missing"], start_seconds: null, end_seconds: null, evidence: "still", repair_scope: "frame", instruction: "move", preserve: [] }] })), /unknown shot/);

  await assert.rejects(() => critiqueProduction(workspace, {}, { client: { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", usage: {}, value: { schema_version: CRITIQUE_VERSION, verdict: "ship", summary: "not really", findings: [{ id: "f", severity: "major", category: "motion", shot_ids: ["shot-1"], start_seconds: null, end_seconds: null, evidence: "still", repair_scope: "frame", instruction: "move", preserve: [] }] } }) } }), /cannot ship with major/);
});

async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-critic-"));
  const qa = path.join(workspace, "production", "qa");
  const snapshots = path.join(qa, "snapshots");
  await mkdir(snapshots, { recursive: true });
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify({
    project: { title: "Proof" }, format: { duration_seconds: 10 }, design: { concept: "Evidence" }, narration: { full_text: "Proof." }, claims: [{ text: "The workflow is proven", confidence: "verified", qualifier: null, evidence_ids: ["ev-1"] }], rubric: [],
    shots: [{ id: "shot-1" }, { id: "shot-2" }]
  })}\n`);
  await writeFile(path.join(workspace, "production", "evidence.json"), `${JSON.stringify({ items: [{ id: "ev-1", kind: "repository-readme", role: "primary", title: "README", content: "The README proves the workflow.", provenance: "README.md", claims_allowed: true }] })}\n`);
  await writeFile(path.join(qa, "verification.json"), `${JSON.stringify({ failed: [], snapshots })}\n`);
  await writeFile(path.join(qa, "motion.json"), `${JSON.stringify({ family: "rapid-hybrid", motion_bursts_per_minute: 22 })}\n`);
  await writeFile(path.join(qa, "audio.json"), `${JSON.stringify({ output: { integrated_lufs: -14 }, quality: { ok: true, findings: [] } })}\n`);
  await writeFile(path.join(qa, "lint.json"), `${JSON.stringify({ ok: true, stdout: { findings: [] } })}\n`);
  await writeFile(path.join(qa, "validate.json"), `${JSON.stringify({ ok: true, stdout: { errors: [] } })}\n`);
  await writeFile(path.join(qa, "inspect.json"), `${JSON.stringify({ ok: false, stdout: { issueCount: 1, issues: [{ code: "text_occluded", severity: "error" }] } })}\n`);
  await writeFile(path.join(snapshots, "002.png"), "second");
  await writeFile(path.join(snapshots, "001.png"), "first");
  return workspace;
}
