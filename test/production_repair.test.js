import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProductionJobStore, semanticHash } from "../src/job_store.js";
import { FRAME_BUNDLE_VERSION } from "../src/production_contracts.js";
import { repairProduction } from "../src/production_repair.js";

test("repairs only criticised frames, preserves the frame contract, and invalidates assembly", async () => {
  const workspace = await fixture();
  let request;
  const client = { runStructured: async (options) => {
    request = options;
    return { response_id: "resp_repair", model: "gpt-5.6-sol", status: "completed", usage: { total_tokens: 500 }, value: bundle("shot-2", "Repaired proof hierarchy") };
  } };
  const result = await repairProduction(workspace, { background: false, concurrency: 2 }, { client });
  assert.equal(result.status, "repaired");
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-2"]);
  assert.equal(JSON.parse(request.input).findings[0].id, "f-1");
  assert.match(JSON.stringify(JSON.parse(request.input).findings[0].preserve), /exact copy/);
  assert.equal(request.images.length, 1);
  assert.match(await readFile(result.repaired[0].html, "utf8"), /Repaired proof hierarchy/);
  const store = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(store.get("frame:shot-1").status, "succeeded");
  assert.equal(store.get("frame:shot-2").status, "succeeded");
  assert.equal(store.get("hyperframes-assembly").status, "stale");
});

test("refuses frame-level repair when the critic requires script, audio, or plan changes", async () => {
  const workspace = await fixture({ repairScope: "script" });
  await assert.rejects(() => repairProduction(workspace, {}, { client: {} }), /broader work/);
});

test("repairs supported assembly findings while reporting unrelated audio blockers", async () => {
  const workspace = await fixture({ includeAudio: true, repairScope: "assembly" });
  const client = { runStructured: async () => ({ response_id: "r", model: "gpt-5.6", status: "completed", usage: {}, value: bundle("shot-2", "Assembly repaired") }) };
  const result = await repairProduction(workspace, {}, { client });
  assert.equal(result.status, "partially-repaired");
  assert.deepEqual(result.repaired.map((entry) => entry.shot_id), ["shot-2"]);
  assert.deepEqual(result.blockers.map((entry) => entry.repair_scope), ["audio"]);
});

test("resumes a persisted background repair response without another submission", async () => {
  const workspace = await fixture();
  const store = await ProductionJobStore.open(workspace, { create: false });
  await store.markStaleFrom(["frame:shot-2"]);
  await store.retry("frame:shot-2");
  await store.markRunning("frame:shot-2", { provider: "openai", response_id: "repair_saved", status: "in_progress" });
  let resumed = 0;
  const client = {
    runStructured: async () => { throw new Error("must not submit a duplicate repair"); },
    resumeStructured: async (responseId) => { resumed += 1; assert.equal(responseId, "repair_saved"); return { response_id: responseId, model: "gpt-5.6", status: "completed", value: bundle("shot-2", "Resumed repair"), usage: {} }; }
  };
  const result = await repairProduction(workspace, {}, { client, store });
  assert.equal(result.repaired.length, 1);
  assert.equal(resumed, 1);
});

function bundle(id, copy = "Proof") {
  return {
    schema_version: FRAME_BUNDLE_VERSION, shot_id: id,
    html: `<!doctype html><html><head></head><body><template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="${id}" data-start="0" data-duration="5" data-width="1080" data-height="1920"><div id="${id}-proof" class="clip" data-start="0" data-duration="5">${copy}</div></div><script>window.__timelines=window.__timelines||{};const timeline=gsap.timeline({paused:true});window.__timelines["${id}"]=timeline;</script></template></body></html>`,
    motion: { assertions: [{ selector: `#${id}-proof`, appears_by_seconds: 1, order: 1, must_stay_in_frame: true, must_remain_live: true }] },
    root_media_requests: [], evidence_ids: ["ev-1"], visible_copy: [copy], preserve: ["exact copy"]
  };
}

async function fixture(options = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-repair-"));
  const production = path.join(workspace, "production");
  const frames = path.join(production, "frames");
  const snapshots = path.join(production, "qa", "snapshots");
  await Promise.all([mkdir(frames, { recursive: true }), mkdir(snapshots, { recursive: true })]);
  const shot = (id, start, end) => ({ id, start_seconds: start, end_seconds: end, evidence_ids: ["ev-1"], resource_ids: [] });
  const plan = { design: { concept: "Proof" }, format: { width: 1080, height: 1920 }, shots: [shot("shot-1", 0, 5), shot("shot-2", 5, 10)] };
  await writeFile(path.join(production, "intake.json"), `${JSON.stringify({ resources: [] })}\n`);
  await writeFile(path.join(production, "evidence.json"), `${JSON.stringify({ items: [{ id: "ev-1", title: "README", provenance: "README.md" }] })}\n`);
  await writeFile(path.join(production, "plan.json"), `${JSON.stringify(plan)}\n`);
  for (const id of ["shot-1", "shot-2"]) {
    const prior = bundle(id);
    await writeFile(path.join(frames, `${id}.json`), `${JSON.stringify(prior)}\n`);
    await writeFile(path.join(frames, `${id}.html`), prior.html);
    await writeFile(path.join(frames, `${id}.motion.json`), `${JSON.stringify(prior.motion)}\n`);
  }
  const findings = [{ id: "f-1", severity: "major", category: "composition", shot_ids: ["shot-2"], repair_scope: options.repairScope ?? "frame", instruction: "Make proof dominant", preserve: ["exact copy"] }];
  if (options.includeAudio) findings.push({ id: "f-audio", severity: "major", category: "audio", shot_ids: ["shot-1", "shot-2"], repair_scope: "audio", instruction: "Measure the mix", preserve: [] });
  await writeFile(path.join(production, "qa", "critique.json"), `${JSON.stringify({
    verdict: "repair",
    findings
  })}\n`);
  await writeFile(path.join(snapshots, "001.png"), "snapshot");
  const store = await ProductionJobStore.open(workspace);
  await store.add({ id: "creative-plan", kind: "creative-plan", depends_on: [], input_hash: semanticHash(plan) });
  await store.markRunning("creative-plan"); await store.markSucceeded("creative-plan");
  for (const id of ["shot-1", "shot-2"]) {
    await store.add({ id: `frame:${id}`, kind: "frame", depends_on: ["creative-plan"], input_hash: semanticHash({ id }) });
    await store.markRunning(`frame:${id}`); await store.markSucceeded(`frame:${id}`);
  }
  await store.add({ id: "hyperframes-assembly", kind: "assembly", depends_on: ["frame:shot-1", "frame:shot-2"], input_hash: semanticHash({ assembly: true }) });
  await store.markRunning("hyperframes-assembly"); await store.markSucceeded("hyperframes-assembly");
  return workspace;
}
