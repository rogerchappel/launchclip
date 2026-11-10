// A make run with model calls and renders overlapping writes what a run that sends one call at a time writes
// (src/make/model_calls.js; the recorded run is test/helpers/make_recorded_run.js).
import assert from "node:assert/strict";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { makeOptionsFromFlags } from "../src/make/options.js";
import { PROMPT } from "./helpers/make_fakes.js";
import { SCREENSHOTS, progressEvents, projectFiles, recordedRun, stderrLines } from "./helpers/make_recorded_run.js";

// What a clock writes into a project: left out when two runs are compared.
const CLOCK_KEYS = new Set(["elapsed_ms", "created_at", "updated_at", "started_at", "finished_at", "timings", "model_calls"]);
const timeless = (value) => {
  if (Array.isArray(value)) return value.map(timeless);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !CLOCK_KEYS.has(key)).map(([key, entry]) => [key, timeless(entry)]));
};
// A project's files with the clock taken out of its JSON. The "machine:" notice echoes --concurrency itself, which the two runs set differently.
const comparable = (files) => Object.fromEntries(Object.entries(files).map(([name, text]) => {
  if (!name.endsWith(".json")) return [name, text];
  const json = timeless(JSON.parse(text));
  if (name === "MAKE.json") json.notices = json.notices.filter((line) => !line.startsWith("machine: "));
  return [name, json];
}));

test("overlapping calls write the same project as one call at a time: every file, the costs and the progress lines", async (t) => {
  const [one, many] = await Promise.all([recordedRun({ callMs: 24, stillMs: 6, jitter: true }), recordedRun({ callMs: 24, stillMs: 6, jitter: true })]);
  t.after(() => Promise.all([one.cleanup(), many.cleanup()]));
  const sequential = await one.run({ modelConcurrency: 1, concurrency: 1 });
  const overlapped = await many.run({ modelConcurrency: 4, concurrency: 2 });
  assert.equal(sequential.report.status, "ready", JSON.stringify(sequential.report.stages));
  assert.equal(overlapped.report.status, "ready", JSON.stringify(overlapped.report.stages));

  // The calls really overlapped, within the limit, and the run with a limit of 1 never had two open.
  assert.equal(sequential.peak, 1);
  assert.equal(overlapped.peak, 4);
  assert.deepEqual(overlapped.calls, sequential.calls, "the same calls, started in the same order");
  assert.equal(overlapped.calls.filter((name) => name === "launchclip_asset_description").length, SCREENSHOTS.length + 1);

  // Every file of the project, byte for byte, but for what a clock wrote.
  const [before, after] = [comparable(await projectFiles(one.project, one)), comparable(await projectFiles(many.project, many))];
  assert.deepEqual(Object.keys(after), Object.keys(before));
  for (const name of Object.keys(before)) assert.deepEqual(after[name], before[name], name);
  assert.ok(["ASSETS.json", "CONCEPTS.json", "STORY.json", "SCRIPT.json", "DIRECTION.json", "storyboard.json", "qa/rendered-candidates.json", "MAKE.json", ".launchclip/make-state.json"].every((name) => name in before), Object.keys(before).join(", "));
  assert.deepEqual(overlapped.report.costs, sequential.report.costs, "the same cost items in the same order");

  // The host's view: the same progress lines in the same order, each stage opened before it is closed.
  const events = progressEvents(overlapped.lines);
  assert.deepEqual(events, progressEvents(sequential.lines));
  const stages = Object.keys(overlapped.report.stages);
  assert.deepEqual(events.filter((event) => event.status).map((event) => event.stage), stages);
  assert.deepEqual(events.filter((event) => event.total).map((event) => [event.stage, event.done]), stages.map((stage, index) => [stage, index]));
  const written = (run, recorded) => stderrLines(run.lines, recorded).filter((line) => typeof line !== "string" || !line.startsWith("machine: "));
  assert.deepEqual(written(overlapped, many), written(sequential, one), "progress lines and notices interleave the same way");

  // MAKE.json says where calls overlapped; the timings stay one wall time a stage.
  assert.deepEqual(Object.keys(overlapped.report.timings), [...stages, "total"]);
  const calls = overlapped.report.model_calls;
  assert.deepEqual({ concurrency: calls.concurrency, calls: calls.calls, peak: calls.peak }, { concurrency: 4, calls: sequential.calls.length, peak: 4 });
  assert.deepEqual({ calls: calls.stages.inventory.calls, peak: calls.stages.inventory.peak, overlapped: calls.stages.inventory.overlapped }, { calls: 7, peak: 4, overlapped: 7 });
  assert.deepEqual({ peak: calls.stages.prepare.peak, overlapped: calls.stages.prepare.overlapped }, { peak: 1, overlapped: 0 }, "concept, story and script are a chain: nothing there can overlap");
  assert.deepEqual({ peak: calls.stages.storyboard.peak, overlapped: calls.stages.storyboard.overlapped }, { peak: 1, overlapped: 0 });
  assert.deepEqual(calls.stages.candidates.side_by_side, ["candidate stills: 2 at a time"]);
  assert.deepEqual({ concurrency: sequential.report.model_calls.concurrency, peak: sequential.report.model_calls.peak, overlapped: sequential.report.model_calls.overlapped }, { concurrency: 1, peak: 1, overlapped: 0 });
});

test("a rerun with overlapping calls reuses everything the first run finished", async (t) => {
  const recorded = await recordedRun({ callMs: 4, jitter: true });
  t.after(() => recorded.cleanup());
  const first = await recorded.run({ modelConcurrency: 4, concurrency: 2 });
  assert.equal(first.report.status, "ready", JSON.stringify(first.report.stages));
  const again = await recorded.run({ modelConcurrency: 4, concurrency: 2 });
  assert.equal(again.report.status, "ready", JSON.stringify(again.report.stages));
  assert.deepEqual(again.calls.slice(first.calls.length), [], "no model call is made again");
  assert.deepEqual({ storyboard: again.report.stages.storyboard.status, candidates: again.report.stages.candidates.status }, { storyboard: "cached", candidates: "cached" });
  assert.equal(again.report.concept.status, "reused");
  assert.equal(again.report.script.reused, true);
  assert.deepEqual(again.report.assets.descriptions, first.report.assets.descriptions);
  assert.equal(again.report.model_calls.calls, 0);
  // And at a limit of 1 the same project is reused the same way: the cache keys do not know the limit.
  const single = await recorded.run({ modelConcurrency: 1, concurrency: 1 });
  assert.deepEqual(single.calls.slice(first.calls.length), []);
  assert.equal(single.report.stages.storyboard.status, "cached");
});

test("--model-concurrency and LAUNCHCLIP_MODEL_CONCURRENCY set the limit; a bad value is refused before anything runs", async (t) => {
  assert.equal(makeOptionsFromFlags({ "model-concurrency": "2" }).modelConcurrency, "2");
  await assert.rejects(runMake(PROMPT, { modelConcurrency: "0" }, { env: {} }), /--model-concurrency must be a whole number from 1 to 32; got 0/);
  await assert.rejects(runMake(PROMPT, {}, { env: { LAUNCHCLIP_MODEL_CONCURRENCY: "lots" } }), /LAUNCHCLIP_MODEL_CONCURRENCY must be a whole number from 1 to 32; got lots/);
  // The default is 4.
  const recorded = await recordedRun({ callMs: 12 });
  t.after(() => recorded.cleanup());
  const run = await recorded.run({ concepts: "off", candidates: "off" });
  assert.equal(run.report.model_calls.concurrency, 4);
  assert.equal(run.peak, 4);
});

test("a rate-limit answer in the middle of a run is waited out: the stage is done, and MAKE.json says how long it waited", async (t) => {
  const recorded = await recordedRun();
  t.after(() => recorded.cleanup());
  const waits = [];
  let refused = 0;
  let skipped = 0;
  const run = await recorded.run({ modelConcurrency: 4, concepts: "off", candidates: "off" });
  assert.equal(run.report.status, "ready");
  const second = await recordedRun();
  t.after(() => second.cleanup());
  // The same run, but the provider refuses the script call twice.
  const limited = await second.run({ modelConcurrency: 4, concepts: "off", candidates: "off" }, {
    // A clock the wait moves forward, so nothing really waits.
    now: () => performance.now() + skipped,
    sleep: async (ms) => { waits.push(Math.round(ms)); skipped += ms; },
    refuse: (request) => request.schemaName === "launchclip_make_script" && (refused += 1) <= 2
  });
  assert.equal(limited.report.status, "ready", JSON.stringify(limited.report.stages));
  assert.equal(limited.report.stages.prepare.status, "done");
  assert.deepEqual(waits, [2000, 4000]);
  assert.deepEqual(limited.report.model_calls.rate_limit, { waits: 2, waited_seconds: 6, concurrency_after: 2 });
  assert.equal(limited.lines.filter((line) => /the provider answered with a rate limit; waiting/.test(line)).length, 2);
  assert.deepEqual(limited.report.costs.items.map((item) => item.stage), run.report.costs.items.map((item) => item.stage), "a call sent again is paid for once");
});
