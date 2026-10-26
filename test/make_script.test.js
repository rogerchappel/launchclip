import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chooseScriptPlan } from "../kit/core/script-formats.mjs";
import { runCli } from "../src/cli.js";
import { runMake } from "../src/make/index.js";
import { SCRIPT_SCHEMA, scriptInstructions, writeScript } from "../src/make/script.js";

const NARRATION = "Stripe payouts never match your books. Ledgerly matches every payout to its invoices. Try Ledgerly free today.";

function scriptClient(value) {
  const requests = [];
  return { requests, client: { provider: "openai", async runStructured(request) { requests.push(request); return { model: "gpt-5.6-luna", value, usage: {} }; } } };
}

test("the script pass prompt is driven by the plan: format, skeleton, goal, awareness, budget and the rules", async () => {
  const { requests, client } = scriptClient({ title: "Ledgerly", narration: NARRATION, title_options: ["Match every Stripe payout automatically", "B", "C"], beats: [{ beat: "hook", text: "Stripe payouts never match your books." }, { beat: "cta", text: "Try Ledgerly free today." }] });
  const plan = chooseScriptPlan({ prompt: "A 30-second launch video for Ledgerly", duration: 30, aspect: "16:9", awareness: "problem" });
  const script = await writeScript({ client, prompt: "A 30-second launch video for Ledgerly", duration: 30, plan });
  const [request] = requests;
  assert.equal(request.schemaName, "launchclip_make_script");
  assert.match(request.instructions, /Format: promo/);
  assert.match(request.instructions, /Skeleton: Launch/);
  assert.match(request.instructions, /Goal: convert\. A concrete outcome beats curiosity bait/);
  assert.match(request.instructions, /Problem-aware/);
  assert.match(request.instructions, /about 75 words .*never more than 82/);
  assert.match(request.instructions, /12 words or fewer/);
  assert.match(request.instructions, /never "and then"/);
  assert.match(request.instructions, /paid off in the final quarter/);
  assert.match(request.instructions, /one number per sentence/);
  assert.match(request.instructions, /grade 7/);
  assert.match(request.instructions, /Exactly one call to action, worded the same/);
  assert.match(request.instructions, /Never invent facts: every number, name, customer, quote/);
  assert.match(request.input, /about 75 words/);
  assert.equal(request.instructions, scriptInstructions(plan));
  assert.deepEqual(script.plan, { format: "promo", goal: "convert", awareness: "problem", skeleton: "launch", wpm: 150, word_target: 75, word_ceiling: 82, reasons: plan.reasons });
  assert.equal(script.word_target, 75);
  assert.deepEqual(script.title_options, ["Match every Stripe payout automatically", "B", "C"]);
  assert.deepEqual(script.beats.map((beat) => beat.beat), ["hook", "cta"]);
});

test("SCRIPT_SCHEMA keeps title and narration and adds title_options and beats (strict: every property required)", () => {
  assert.deepEqual(SCRIPT_SCHEMA.required, ["title", "narration", "title_options", "beats"]);
  assert.equal(SCRIPT_SCHEMA.properties.title.type, "string");
  assert.equal(SCRIPT_SCHEMA.properties.narration.type, "string");
  assert.deepEqual(SCRIPT_SCHEMA.properties.beats.items.required, ["beat", "text"]);
});

test("an older {title, narration} response still parses, from a value or from text", async () => {
  const fromValue = await writeScript({ client: scriptClient({ title: "Ledgerly", narration: NARRATION }).client, prompt: "Why payouts drift", duration: 20 });
  assert.equal(fromValue.narration, NARRATION);
  assert.equal(fromValue.title, "Ledgerly");
  assert.deepEqual(fromValue.title_options, ["Ledgerly"]);
  assert.deepEqual(fromValue.beats, []);
  assert.equal(fromValue.plan.format, "explainer");
  const textClient = { async runStructured() { return { text: `Here you go: ${JSON.stringify({ title: "T", narration: NARRATION })}` }; } };
  assert.equal((await writeScript({ client: textClient, prompt: "x", duration: 20 })).narration, NARRATION);
  // Beats alone are enough: the narration is their text joined.
  const beatsOnly = await writeScript({ client: scriptClient({ title: "T", beats: [{ beat: "Hook", text: "One." }, { beat: "cta", text: "Two." }] }).client, prompt: "x", duration: 20 });
  assert.equal(beatsOnly.narration, "One. Two.");
  assert.equal(beatsOnly.beats[0].beat, "hook");
});

test("a resize keeps the plan and caps the new word target at the ceiling", async () => {
  const { requests, client } = scriptClient({ title: "T", narration: NARRATION });
  const plan = chooseScriptPlan({ prompt: "x", duration: 30, aspect: "9:16", format: "explainer" });
  const resized = await writeScript({ client, prompt: "x", duration: 30, plan, words: 500, resize: { previous: NARRATION, measured_seconds: 12, measured_words: 18 } });
  assert.equal(resized.plan.format, "explainer");
  assert.equal(resized.word_target, 82);
  assert.match(requests[0].input, /Rewrite it to about 82 words/);
});

test("make validates --goal, --format and --awareness before doing any work", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-plan-"));
  try {
    await assert.rejects(runMake("A video", { cwd, format: "vlog" }, { env: {} }), /--format must be one of short-form, long-form, explainer, data-explainer, story, promo; got vlog/);
    await assert.rejects(runMake("A video", { cwd, goal: "fame" }, { env: {} }), /--goal must be one of reach, convert/);
    await assert.rejects(runMake("A video", { cwd, awareness: "very" }, { env: {} }), /--awareness must be one of unaware, problem/);
    const stdout = { write() {} };
    const stderr = { write() {} };
    await assert.rejects(runCli(["make", "A video", "--goal", "fame", "--out", path.join(cwd, "out")], { stdout, stderr }), /--goal must be one of/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("launchclip make passes --goal, --format and --awareness to the script pass and records them", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-plan-"));
  const out = path.join(cwd, "project");
  // The script call is captured, then fails, so make stops after the plan reaches the prompt.
  const requests = [];
  const client = { provider: "openai", async runStructured(request) { requests.push(request); throw new Error("stop after the script request"); } };
  const make = { env: {}, client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, inventory: async (dir) => ({ dir, entries: [], counts: {}, summary: [] }) };
  try {
    await assert.rejects(
      runCli(["make", "A 20-second launch video for Ledgerly", "--goal", "convert", "--format", "data-explainer", "--awareness", "most", "--voice", "test", "--out", out], { stdout: { write() {} }, stderr: { write() {} }, productionAdapters: { make } }),
      /launchclip make failed at the prepare stage/
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0].instructions, /Format: data-explainer/);
    assert.match(requests[0].instructions, /Goal: convert/);
    assert.match(requests[0].instructions, /Most-aware: lead with the offer/);
    const report = JSON.parse(await readFile(path.join(out, "MAKE.json"), "utf8"));
    assert.equal(report.options.goal, "convert");
    assert.equal(report.options.format, "data-explainer");
    assert.equal(report.options.awareness, "most");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
