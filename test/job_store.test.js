import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeJobOutput, JOB_STORE_VERSION, ProductionJobStore, semanticHash, withProductionLease } from "../src/job_store.js";

test("semantic hashes are stable across key order and ignore lifecycle timestamps", () => {
  const left = semanticHash({ model: "gpt-5.6", input: { b: 2, a: 1 }, updated_at: "first" });
  const right = semanticHash({ updated_at: "second", input: { a: 1, b: 2 }, model: "gpt-5.6" });
  assert.equal(left, right);
});

test("persists a dependency graph and exposes only ready jobs", async () => {
  const workspace = await tempWorkspace();
  const store = await ProductionJobStore.open(workspace);
  await store.add(job("evidence", []));
  await store.add(job("plan", ["evidence"]));

  assert.deepEqual(store.ready().map((entry) => entry.id), ["evidence"]);
  await store.markRunning("evidence");
  await store.markSucceeded("evidence", [], { input_tokens: 100 });
  assert.deepEqual(store.ready().map((entry) => entry.id), ["plan"]);

  const reopened = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(reopened.data.schema_version, JOB_STORE_VERSION);
  assert.equal(reopened.get("evidence").usage.input_tokens, 100);
  assert.ok(reopened.data.revision >= 4);
});

test("records provider state, bounded attempts, sanitized failures, and retries", async () => {
  const workspace = await tempWorkspace();
  const store = await ProductionJobStore.open(workspace);
  await store.add({ ...job("plan", []), max_attempts: 2 });
  await store.markSubmitted("plan", { provider: "openai", response_id: "resp_1", status: "queued" });
  await store.markRunning("plan", { provider: "openai", response_id: "resp_1", status: "in_progress" });
  await store.markFailed("plan", "request failed with sk-super-secret-value-123456");

  assert.equal(store.get("plan").attempt, 1);
  assert.doesNotMatch(store.get("plan").error, /sk-super/);
  await store.retry("plan");
  await store.markRunning("plan");
  await store.markFailed("plan", "second failure");
  await assert.rejects(() => store.retry("plan"), /exhausted/);
});

test("allows response metadata updates while the final permitted attempt is running", async () => {
  const workspace = await tempWorkspace();
  const store = await ProductionJobStore.open(workspace);
  await store.add({ ...job("frame", []), max_attempts: 1 });
  await store.markRunning("frame", { provider: "openai", response_id: null, status: "running" });
  await store.markRunning("frame", { provider: "openai", response_id: "resp_final", status: "queued" });
  assert.equal(store.get("frame").attempt, 1);
  assert.equal(store.get("frame").remote.response_id, "resp_final");
  await store.markSucceeded("frame");
});

test("serializes concurrent job snapshots without losing mutations", async () => {
  const workspace = await tempWorkspace();
  const store = await ProductionJobStore.open(workspace);
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.add(job(`frame-${index}`, []))));
  await Promise.all(store.list().map((entry) => store.markRunning(entry.id)));
  const reopened = await ProductionJobStore.open(workspace, { create: false });
  assert.equal(reopened.list().length, 20);
  assert.ok(reopened.list().every((entry) => entry.status === "running" && entry.attempt === 1));
  assert.equal(reopened.data.revision, 40);
});

test("propagates stale state to descendants", async () => {
  const workspace = await tempWorkspace();
  const store = await ProductionJobStore.open(workspace);
  await store.add(job("evidence", []));
  await store.add(job("plan", ["evidence"]));
  await store.add(job("frame", ["plan"]));
  for (const id of ["evidence", "plan", "frame"]) {
    await store.markRunning(id);
    await store.markSucceeded(id);
  }
  assert.deepEqual(new Set(await store.markStaleFrom(["evidence"])), new Set(["evidence", "plan", "frame"]));
  assert.ok(store.list().every((entry) => entry.status === "stale"));
});

test("checksums outputs and detects tampering", async () => {
  const workspace = await tempWorkspace();
  const outputPath = path.join(workspace, "production", "plan.json");
  await writeFile(outputPath, "first\n");
  const output = await describeJobOutput(workspace, outputPath);
  const store = await ProductionJobStore.open(workspace);
  await store.add(job("plan", []));
  await store.markRunning("plan");
  await store.markSucceeded("plan", [output]);
  assert.equal((await store.verifyOutputs("plan")).ok, true);

  await writeFile(outputPath, "tampered\n");
  const verification = await store.verifyOutputs("plan");
  assert.equal(verification.ok, false);
  assert.equal(verification.outputs[0].matches, false);
});

test("workspace lease rejects concurrent writers and releases cleanly", async () => {
  const workspace = await tempWorkspace();
  await withProductionLease(workspace, async () => {
    await assert.rejects(() => withProductionLease(workspace, async () => {}), /already locked/);
  });
  const value = await withProductionLease(workspace, async () => "released");
  assert.equal(value, "released");
});

test("workspace lease heartbeat prevents an active long run from being stolen after its TTL", async () => {
  const workspace = await tempWorkspace();
  await withProductionLease(workspace, async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    await assert.rejects(() => withProductionLease(workspace, async () => "stolen", { ttlMs: 20, heartbeatMs: 5 }), /already locked/);
  }, { ttlMs: 20, heartbeatMs: 5 });
});

test("rejects dependency cycles and output paths outside the workspace", async () => {
  const workspace = await tempWorkspace();
  const storePath = path.join(workspace, "production", "jobs.json");
  await writeFile(storePath, `${JSON.stringify({
    schema_version: JOB_STORE_VERSION,
    revision: 0,
    jobs: [
      normalizedJob("a", ["b"]),
      normalizedJob("b", ["a"])
    ]
  })}\n`);
  await assert.rejects(() => ProductionJobStore.open(workspace, { create: false }), /cycle/);
  await assert.rejects(() => describeJobOutput(workspace, path.join(workspace, "..", "outside.txt")), /escapes workspace/);
});

function job(id, dependsOn) {
  return { id, kind: id, depends_on: dependsOn, input_hash: semanticHash({ id, dependsOn }) };
}

function normalizedJob(id, dependsOn) {
  return {
    ...job(id, dependsOn),
    status: "pending",
    attempt: 0,
    max_attempts: 3,
    remote: null,
    outputs: [],
    usage: {},
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function tempWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-jobs-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  return workspace;
}
