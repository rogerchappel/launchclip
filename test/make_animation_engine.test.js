// One episode of a series (`make --animation --engine "…"`): the writers'
// room checks the premise before episode one (src/make/animation.js
// checkEngine), and the show bible records the engine it checked.
import assert from "node:assert/strict";
import test from "node:test";
import { ENGINE_SCHEMA, checkEngine, weakEngineMessage } from "../src/make/animation.js";
import { validateMakeOptions } from "../src/make/options.js";
import { room, schemas } from "./helpers/make_animation.js";

const ENGINE = "Every fix Maya ships breaks something else in the office, and Sam always notices first.";
const STRONG = [
  "Maya patches the login page on demo day and the office printer starts printing the error log.",
  "A hotfix for the coffee machine's app locks the whole team out of the building at lunch.",
  "The new intern copies Maya's quick fix into the billing system the night before payday.",
  "Maya fixes Sam's spreadsheet and every meeting in the calendar moves to midnight.",
  "A one-line change takes down the lift while the board is visiting the fourth floor."
];
const WEAK = { episodes: ["Maya ships a fix and it breaks.", "Maya ships another fix and it breaks again.", "Maya ships a fix that breaks again."], holds: false, fix: "Maya has to keep a failing legacy system alive alone while the team that built it is still in the office." };

const client = (answer) => ({ provider: "openai", requests: [], async runStructured(request) { this.requests.push(request); return { model: "gpt-5.6-luna", value: answer, usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }; } });

test("the premise check pitches five episodes from the engine: a strong one holds, a weak one gets a fix", async () => {
  const strong = client({ episodes: STRONG, holds: true, fix: "" });
  const held = await checkEngine({ client: strong, provider: "openai", model: "gpt-5.6-luna", prompt: "Maya keeps breaking things", engine: ENGINE });
  assert.equal(held.ok, true);
  assert.deepEqual(held.engine, { problem: ENGINE, episodes: STRONG });
  assert.equal(strong.requests[0].schema, ENGINE_SCHEMA);
  assert.match(strong.requests[0].input, /## The engine\n\nEvery fix Maya ships/);

  const weak = await checkEngine({ client: client(WEAK), provider: "openai", model: "gpt-5.6-luna", prompt: "Maya keeps breaking things", engine: ENGINE });
  assert.equal(weak.ok, false);
  assert.equal(weak.fix, WEAK.fix);
  assert.match(weakEngineMessage(weak), /the premise check failed before episode one: the room could not pitch 5 different episodes from the engine; the engine is too weak: it gives \d distinct/);
  assert.match(weakEngineMessage(weak), /A stronger engine: Maya has to keep a failing legacy system alive/);
  // The measure decides as well as the call: five pitches of one episode do not hold, whatever the call says.
  const reworded = await checkEngine({ client: client({ episodes: Array(5).fill("Maya ships a fix and it breaks."), holds: true, fix: "" }), engine: ENGINE });
  assert.equal(reworded.ok, false);
});

test("make --engine: a weak engine stops the room before any script is written", async () => {
  const t = await room({ recorded: { launchclip_series_engine: [WEAK] } });
  try {
    const report = await t.make({ engine: ENGINE, stopAfter: "bible" });
    assert.equal(report.status, "failed");
    assert.match(JSON.stringify(report), /the premise check failed before episode one/);
    assert.deepEqual(schemas(t.calls), ["series_engine"], "no premise, loglines or script call");
  } finally { await t.done(); }
});

test("make --engine: a strong engine is pitched once, built on, and recorded in SCRIPT.json and BIBLE.json", async () => {
  const t = await room({ recorded: { launchclip_series_engine: [{ episodes: STRONG, holds: true, fix: "" }] } });
  try {
    const report = await t.make({ engine: ENGINE, stopAfter: "bible" });
    assert.equal(report.status, "awaiting-approval", JSON.stringify(report.stages));
    assert.deepEqual(schemas(t.calls).slice(0, 4), ["series_engine", "premise", "loglines", "script"]);
    assert.match(t.calls[1].input, /## The series engine \(this video is one episode\)\n\nEvery episode turns on this, and it is never solved for good: Every fix Maya ships/);
    const script = await t.read("SCRIPT.json");
    assert.deepEqual(script.engine, { problem: ENGINE, episodes: STRONG });
    assert.equal(script.passes[0].kind, "engine");
    assert.deepEqual((await t.read("BIBLE.json")).engine, { problem: ENGINE, episodes: STRONG });
    // The next episode reads the engine from the bible and does not pitch it again.
    const before = t.calls.length;
    await t.make({ engine: ENGINE, stopAfter: "bible" });
    assert.equal(schemas(t.calls.slice(before)).includes("series_engine"), false);
  } finally { await t.done(); }
});

test("--engine needs a sentence and a character story", () => {
  assert.throws(() => validateMakeOptions({ engine: true, animation: true }), /--engine takes the series engine in one sentence/);
  assert.throws(() => validateMakeOptions({ engine: ENGINE }), /--engine is for a character story: add --animation/);
});
