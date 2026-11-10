// The one limit on model calls in a make run (src/make/model_calls.js), and the pools local work runs in (src/concurrency.js).
import assert from "node:assert/strict";
import test from "node:test";
import { createLimiter, mapLimit } from "../src/concurrency.js";
import { DEFAULT_MODEL_CONCURRENCY, createModelGate, isRateLimit, modelConcurrency, retryAfterMs } from "../src/make/model_calls.js";

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

// A client whose calls stay open until released, so a test decides the order they finish in.
function heldClient() {
  const open = [];
  let inFlight = 0;
  let peak = 0;
  const client = {
    provider: "openai",
    supportsImages: true,
    async runStructured(request) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try { return await new Promise((resolve, reject) => open.push({ request, resolve, reject })); } finally { inFlight -= 1; }
    }
  };
  return { client, open, peak: () => peak };
}

test("--model-concurrency wins over LAUNCHCLIP_MODEL_CONCURRENCY, and both must be a whole number from 1 to 32", () => {
  assert.equal(modelConcurrency(undefined, {}), DEFAULT_MODEL_CONCURRENCY);
  assert.equal(DEFAULT_MODEL_CONCURRENCY, 4);
  assert.equal(modelConcurrency(undefined, { LAUNCHCLIP_MODEL_CONCURRENCY: "2" }), 2);
  assert.equal(modelConcurrency("1", { LAUNCHCLIP_MODEL_CONCURRENCY: "8" }), 1);
  assert.equal(modelConcurrency(6, {}), 6);
  assert.throws(() => modelConcurrency("0", {}), /--model-concurrency must be a whole number from 1 to 32; got 0/);
  assert.throws(() => modelConcurrency(true, {}), /--model-concurrency must be a whole number/);
  assert.throws(() => modelConcurrency("2.5", {}), /--model-concurrency/);
  assert.throws(() => modelConcurrency(undefined, { LAUNCHCLIP_MODEL_CONCURRENCY: "many" }), /LAUNCHCLIP_MODEL_CONCURRENCY must be a whole number from 1 to 32; got many/);
});

test("the gate never has more calls in flight than its limit, starts them in the order asked, and answers each caller with its own result", async () => {
  const { client, open, peak } = heldClient();
  const gate = createModelGate({ limit: 2 });
  const gated = gate.wrap(client);
  assert.equal(gated.provider, "openai", "the client's own fields read through");
  assert.equal(gated.supportsImages, true);
  gate.stage("inventory");
  const answers = [1, 2, 3, 4, 5].map((id) => gated.runStructured({ id }));
  await tick();
  assert.deepEqual(open.map((call) => call.request.id), [1, 2], "two start, three wait");
  // The second call answers first: the third starts, and nothing is mixed up.
  open[1].resolve("two");
  await tick();
  assert.deepEqual(open.map((call) => call.request.id), [1, 2, 3]);
  open[0].resolve("one");
  open[2].resolve("three");
  await tick();
  assert.deepEqual(open.map((call) => call.request.id), [1, 2, 3, 4, 5]);
  open[4].resolve("five");
  open[3].resolve("four");
  assert.deepEqual(await Promise.all(answers), ["one", "two", "three", "four", "five"]);
  assert.equal(peak(), 2);
  assert.deepEqual(gate.report(), { concurrency: 2, calls: 5, peak: 2, overlapped: 5, stages: { inventory: { calls: 5, call_seconds: gate.report().stages.inventory.call_seconds, peak: 2, overlapped: 5 } } });
});

test("a limit of 1 sends one call at a time and reports no overlap; calls are counted under the stage that sent them", async () => {
  const { client, open, peak } = heldClient();
  const gate = createModelGate({ limit: 1 });
  const gated = gate.wrap(client);
  gate.stage("prepare");
  const first = gated.runStructured({ id: 1 });
  const second = gated.runStructured({ id: 2 });
  await tick();
  assert.equal(open.length, 1);
  open[0].resolve("a");
  await first;
  gate.stage("storyboard");
  const third = gated.runStructured({ id: 3 });
  await tick();
  open[1].resolve("b");
  await second;
  await tick();
  open[2].resolve("c");
  await third;
  assert.equal(peak(), 1);
  const report = gate.report();
  assert.deepEqual({ calls: report.calls, peak: report.peak, overlapped: report.overlapped }, { calls: 3, peak: 1, overlapped: 0 });
  assert.deepEqual(Object.fromEntries(Object.entries(report.stages).map(([name, stage]) => [name, stage.calls])), { prepare: 2, storyboard: 1 });
});

test("a rate-limit answer backs off and sends the call again instead of failing the stage", async () => {
  const waits = [];
  const notices = [];
  let clock = 0;
  const attempts = new Map();
  const rateLimited = (headers) => Object.assign(new Error("429 Too Many Requests"), { status: 429, ...(headers ? { headers } : {}) });
  const client = {
    async runStructured({ id }) {
      const seen = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, seen);
      // The first call is refused twice (the second time with Retry-After), the others answer.
      if (id === "a" && seen === 1) throw rateLimited();
      if (id === "a" && seen === 2) throw rateLimited({ "retry-after": "7" });
      return `${id}:${seen}`;
    }
  };
  const gate = createModelGate({ limit: 3, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; }, say: (line) => notices.push(line) });
  const gated = gate.wrap(client);
  gate.stage("prepare");
  assert.deepEqual(await Promise.all(["a", "b", "c"].map((id) => gated.runStructured({ id }))), ["a:3", "b:1", "c:1"]);
  assert.deepEqual(waits, [2000, 7000], "a doubling wait, then the provider's Retry-After");
  assert.equal(notices.length, 2);
  assert.match(notices[0], /rate limit; waiting 2s, then sending the call again \(try 2 of 6\); model calls now run 2 at a time/);
  assert.deepEqual(gate.report().rate_limit, { waits: 2, waited_seconds: 9, concurrency_after: 1 });
  assert.equal(gate.report().calls, 3, "a call sent again is still one call");
});

test("while one call waits out a rate limit, the calls behind it wait too", async () => {
  let clock = 0;
  const order = [];
  let refused = false;
  const client = {
    async runStructured({ id }) {
      order.push(`${id}@${clock}`);
      if (id === "a" && !refused) { refused = true; throw Object.assign(new Error("openai chat completions failed (429): slow down"), {}); }
      return id;
    }
  };
  const gate = createModelGate({ limit: 1, now: () => clock, sleep: async (ms) => { clock += ms; } });
  const gated = gate.wrap(client);
  await Promise.all(["a", "b"].map((id) => gated.runStructured({ id })));
  assert.deepEqual(order, ["a@0", "a@2000", "b@2000"]);
});

test("a provider that keeps refusing fails the call after its retries; other errors are never retried", async () => {
  let calls = 0;
  const gate = createModelGate({ limit: 2, retries: 2, now: () => 0, sleep: async () => {} });
  const refusing = gate.wrap({ async runStructured() { calls += 1; throw Object.assign(new Error("rate limit exceeded"), { status: 429 }); } });
  await assert.rejects(refusing.runStructured({}), /rate limit exceeded/);
  assert.equal(calls, 3, "the first try and two more");
  calls = 0;
  const broken = gate.wrap({ async runStructured() { calls += 1; throw new Error("OpenAI Responses API failed (400): bad schema"); } });
  await assert.rejects(broken.runStructured({}), /bad schema/);
  assert.equal(calls, 1);
  // The spending limit is not a rate limit: it is never waited out.
  const capped = gate.wrap({ async runStructured() { calls += 1; throw Object.assign(new Error("API spending reached the $2.00 limit"), { code: "LAUNCHCLIP_COST_LIMIT" }); } });
  await assert.rejects(capped.runStructured({}), /spending reached/);
  assert.equal(calls, 2);
});

test("rate limits are told from other failures, and Retry-After is read from plain or Headers objects", () => {
  assert.equal(isRateLimit(Object.assign(new Error("nope"), { status: 429 })), true);
  assert.equal(isRateLimit(new Error("openrouter chat completions failed (429): Rate limit reached")), true);
  assert.equal(isRateLimit(new Error("Too Many Requests")), true);
  assert.equal(isRateLimit(new Error("OpenAI Responses API failed (500): overloaded")), false);
  assert.equal(isRateLimit(Object.assign(new Error("rate limit"), { code: "LAUNCHCLIP_COST_LIMIT" })), false);
  assert.equal(isRateLimit(null), false);
  assert.equal(retryAfterMs({ headers: { "retry-after": "3" } }), 3000);
  assert.equal(retryAfterMs({ headers: new Headers({ "retry-after": "1.5" }) }), 1500);
  assert.equal(retryAfterMs({ headers: { "retry-after": "600" } }), 60000, "never longer than a minute");
  assert.equal(retryAfterMs(new Error("no headers")), null);
});

test("mapLimit keeps results in item order whatever finishes first, and throws the earliest item's error", async () => {
  let inFlight = 0;
  let peak = 0;
  const slowFirst = async (item, index) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await tick(10 - index * 2);
    inFlight -= 1;
    return item * 2;
  };
  assert.deepEqual(await mapLimit([1, 2, 3, 4, 5], 3, slowFirst), [2, 4, 6, 8, 10]);
  assert.equal(peak, 3);
  assert.deepEqual(await mapLimit([], 3, slowFirst), []);
  await assert.rejects(mapLimit([1, 2, 3], 3, async (item) => { await tick(item === 1 ? 5 : 1); throw new Error(`item ${item}`); }), /item 1/, "the first item's error, though the others failed sooner");
  // A limit of 1 is a plain loop: nothing starts after a failure.
  const started = [];
  await assert.rejects(mapLimit([1, 2, 3], 1, async (item) => { started.push(item); if (item === 2) throw new Error("stop"); }), /stop/);
  assert.deepEqual(started, [1, 2]);
});

test("a limiter starts tasks in the order they were handed in, at most its limit at once", async () => {
  const run = createLimiter(2);
  const events = [];
  const task = (name, ms) => run(async () => { events.push(`start ${name}`); await tick(ms); events.push(`end ${name}`); return name; });
  assert.deepEqual(await Promise.all([task("a", 12), task("b", 2), task("c", 2)]), ["a", "b", "c"]);
  assert.deepEqual(events, ["start a", "start b", "end b", "start c", "end c", "end a"]);
  await assert.rejects(run(async () => { throw new Error("task failed"); }), /task failed/);
  assert.equal(await run(() => "still runs"), "still runs");
});
