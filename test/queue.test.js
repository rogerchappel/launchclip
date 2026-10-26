import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { acquireSlot, formatQueue, processAlive, projectLabel, queueDir, readQueue, withSlot } from "../src/queue.js";

const JOB = path.join(import.meta.dirname, "fixtures", "queue", "job.mjs");

async function queueEnv(slots = "render:2") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-queue-"));
  return { ...process.env, LAUNCHCLIP_QUEUE: "on", LAUNCHCLIP_QUEUE_DIR: dir, LAUNCHCLIP_SLOTS: slots, LAUNCHCLIP_QUEUE_POLL_MS: "50" };
}

// A real launchclip-like process holding a slot; resolves once it has it
// when untilAcquired, otherwise when it exits.
function startJob(env, kind, label, holdMs) {
  const child = spawn(process.execPath, [JOB, kind, label, String(holdMs)], { env, stdio: ["ignore", "pipe", "pipe"] });
  const job = { child, label, stdout: "", stderr: "", acquired: null, released: null };
  let onAcquired;
  job.acquiredPromise = new Promise((resolve) => { onAcquired = resolve; });
  child.stdout.on("data", (chunk) => {
    job.stdout += chunk;
    const acquired = job.stdout.match(/acquired (\d+)/);
    if (acquired && job.acquired == null) { job.acquired = Number(acquired[1]); onAcquired(); }
    const released = job.stdout.match(/released (\d+)/);
    if (released) job.released = Number(released[1]);
  });
  child.stderr.on("data", (chunk) => { job.stderr += chunk; });
  job.exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  return job;
}

test("three jobs started at once with 2 render slots run 2 and queue the third, which says who holds them", async () => {
  const env = await queueEnv("render:2");
  try {
    const jobs = ["acme/launch", "thoroughbreds-yt/ep-14", "acme/teaser"].map((label) => startJob(env, "render", label, 1200));
    const exits = await Promise.all(jobs.map((job) => job.exited));
    assert.deepEqual(exits.map((exit) => exit.code), [0, 0, 0], jobs.map((job) => job.stderr).join("\n"));
    const byStart = [...jobs].sort((a, b) => a.acquired - b.acquired);
    const [first, second, third] = byStart;
    // Never more than two at once: the third starts only after one of the first two let go.
    assert.ok(third.acquired >= Math.min(first.released, second.released), `third started at ${third.acquired}, before ${Math.min(first.released, second.released)}`);
    assert.ok(second.acquired < first.released, "the first two run together");
    assert.match(third.stderr, /^waiting for a render slot: 2 of 2 in use by (acme\/launch|thoroughbreds-yt\/ep-14|acme\/teaser), (acme\/launch|thoroughbreds-yt\/ep-14|acme\/teaser)$/m);
    // One line per change of holders (it may first see one holder and one job ahead), never a repeat.
    const lines = third.stderr.trim().split("\n");
    assert.ok(lines.every((line, i) => line.startsWith("waiting for a render slot: ") && line !== lines[i - 1]), lines.join("\n"));
    assert.deepEqual((await readdir(env.LAUNCHCLIP_QUEUE_DIR)).filter((name) => name.endsWith(".lock")), []);
  } finally {
    await rm(env.LAUNCHCLIP_QUEUE_DIR, { recursive: true, force: true });
  }
});

test("a killed holder's lock is reclaimed by the job waiting behind it", async () => {
  const env = await queueEnv("render:1");
  try {
    const holder = startJob(env, "render", "acme/killed", 60_000);
    await holder.acquiredPromise;
    const waiter = startJob(env, "render", "acme/next", 50);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(waiter.acquired, null, "the waiter waits while the holder lives");
    assert.match(waiter.stderr, /waiting for a render slot: 1 of 1 in use by acme\/killed/);
    holder.child.kill("SIGKILL");
    assert.equal((await holder.exited).signal, "SIGKILL");
    assert.ok(existsSync(path.join(env.LAUNCHCLIP_QUEUE_DIR, "render-1.lock")), "SIGKILL leaves the lock behind");
    assert.equal((await waiter.exited).code, 0);
    assert.ok(waiter.acquired != null);
  } finally {
    await rm(env.LAUNCHCLIP_QUEUE_DIR, { recursive: true, force: true });
  }
});

test("a lock whose PID is gone, or reused by a newer process, is stale; waiting jobs go first come, first served", async () => {
  const env = await queueEnv("local-model:1");
  const dir = env.LAUNCHCLIP_QUEUE_DIR;
  try {
    await mkdir(dir, { recursive: true });
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const old = new Date(Date.now() - 3_600_000).toISOString();
      assert.equal(processAlive(sleeper.pid, os.hostname(), new Date().toISOString()), true);
      assert.equal(processAlive(sleeper.pid, os.hostname(), old), false, "the PID now belongs to a process started after the lock");
      assert.equal(processAlive(999_999_999), false);
      assert.equal(processAlive(1234, "another-host"), true);
      await writeFile(path.join(dir, "local-model-1.lock"), JSON.stringify({ pid: sleeper.pid, host: os.hostname(), slot: "local-model", n: 1, label: "reused pid", started: old }));
      const slot = await acquireSlot("local-model", { env, log: () => {} });
      assert.equal(slot.n, 1);
      await slot.release();
    } finally {
      sleeper.kill();
    }

    // Two waiters: the one queued first gets the slot first.
    const order = [];
    const lines = [];
    const holder = await acquireSlot("local-model", { env, label: "holder", log: () => {} });
    const a = withSlot("local-model", { env, label: "a", log: (line) => lines.push(line) }, async () => { order.push("a"); });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const b = withSlot("local-model", { env, label: "b", log: (line) => lines.push(line) }, async () => { order.push("b"); });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const listed = await readQueue({ env });
    assert.deepEqual(listed.running.map((item) => item.label), ["holder"]);
    assert.deepEqual(listed.waiting.map((item) => item.label), ["a", "b"]);
    assert.match(formatQueue(listed), /local-model: 1 of 1 in use, 2 waiting\n {2}running {2}holder {2}pid \d+ {2}\d+s\n {2}waiting {2}a /);
    assert.ok(lines.includes("waiting for a local-model slot: 1 of 1 in use by holder; 1 job ahead"));
    await holder.release();
    await Promise.all([a, b]);
    assert.deepEqual(order, ["a", "b"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a nested call for a held kind runs straight away; LAUNCHCLIP_QUEUE=off skips the queue", async () => {
  const env = await queueEnv("render:1");
  try {
    const result = await withSlot("render", { env, log: () => {} }, () => withSlot("render", { env, log: () => {} }, async () => "inner"));
    assert.equal(result, "inner");
    const off = { ...env, LAUNCHCLIP_QUEUE: "off" };
    const held = await acquireSlot("render", { env, log: () => {} });
    assert.equal(await withSlot("render", { env: off }, async () => "unqueued"), "unqueued");
    await held.release();
    await assert.rejects(acquireSlot("gpu", { env }), /unknown slot "gpu"/);
  } finally {
    await rm(env.LAUNCHCLIP_QUEUE_DIR, { recursive: true, force: true });
  }
});

test("the queue lives in $LAUNCHCLIP_HOME/queue and names jobs by their last two folders", () => {
  assert.equal(queueDir({ LAUNCHCLIP_HOME: "/data/lc" }), path.join("/data/lc", "queue"));
  assert.equal(queueDir({}), path.join(os.homedir(), ".launchclip", "queue"));
  assert.equal(queueDir({ LAUNCHCLIP_QUEUE_DIR: "/tmp/q", LAUNCHCLIP_HOME: "/data/lc" }), path.resolve("/tmp/q"));
  assert.equal(projectLabel("/Volumes/Video/acme/launch"), "acme/launch");
});

test("launchclip queue lists running and waiting jobs, and --json the report", async () => {
  const env = await queueEnv("render:2");
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const slot = await acquireSlot("render", { label: "acme/launch", log: () => {} });
    const output = [];
    await runCli(["queue"], { stdout: { write: (value) => output.push(value) } });
    assert.match(output.join(""), /render: 1 of 2 in use\n {2}running {2}acme\/launch/);
    output.length = 0;
    await runCli(["queue", "--json"], { stdout: { write: (value) => output.push(value) } });
    const report = JSON.parse(output.join(""));
    assert.equal(report.running[0].label, "acme/launch");
    assert.equal(report.slots.render, 2);
    await slot.release();
  } finally {
    for (const key of Object.keys(env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    await rm(env.LAUNCHCLIP_QUEUE_DIR, { recursive: true, force: true });
  }
});
