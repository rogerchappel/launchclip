// The script gate (docs/ANIMATION_PIPELINE_RFC.md §8.2): src/script_gate.js.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SCRIPT_GATE_RULES, measuredPace, scriptGate } from "../src/script_gate.js";
import { readProjectStory } from "../src/story_loader.js";

const EXAMPLE = "examples/story/dialogue-9x16";
const BROKEN = "eval/fixtures/animation/broken-script";
const example = () => JSON.parse(readFileSync(path.join(EXAMPLE, "SCRIPT.json"), "utf8"));

test("script gate: the two-character example passes, at the pace its take was voiced", async () => {
  const loaded = await readProjectStory(EXAMPLE);
  const gate = await scriptGate({ project: EXAMPLE, resolved: loaded.resolved, words: loaded.words });
  assert.equal(gate.status, "passed", gate.errors.join("\n"));
  assert.equal(gate.profile, "story-characters");
  assert.equal(gate.wpm_source, "measured");
  assert.equal(gate.wpm, measuredPace(loaded.words, example()));
  assert.equal(gate.duration_source, "story");
  assert.deepEqual(gate.stats.characters, ["maya", "sam"]);
  // Without the storyboard and the words it still reads the contract.
  assert.equal((await scriptGate({ project: EXAMPLE })).status, "passed");
});

test("script gate: a project whose script breaks the contract fails, once per rule", async () => {
  const gate = await scriptGate({ project: BROKEN });
  assert.equal(gate.status, "failed");
  assert.deepEqual([...gate.rules].sort(), ["character-unused", "fits-length", "problem-lands", "speaker-unknown"]);
  for (const rule of gate.rules) assert.ok(SCRIPT_GATE_RULES[rule], rule);
  assert.match(gate.errors.join("\n"), /"boss", who is not in characters/);
  assert.match(gate.errors.join("\n"), /"theo" is listed but never speaks/);
  assert.ok(gate.errors.every((entry) => /Fix: /.test(entry)), "every error says how to fix it");
  assert.equal(gate.duration_source, "script");
});

test("script gate: each rule fails on its own", async () => {
  const run = (change) => { const script = example(); change(script); return scriptGate({ project: EXAMPLE, script }); };
  const unknown = await run((script) => { script.beats[1].lines[0].speaker = "theo"; });
  assert.deepEqual(unknown.rules, ["speaker-unknown"]);
  const unused = await run((script) => { script.characters.push({ id: "theo", role: "witness" }); });
  assert.deepEqual(unused.rules, ["character-unused"]);
  const acts = await run((script) => { script.characters.push({ id: "theo", role: "witness" }); script.beats[1].lines[2].action = "Theo looks up from his desk."; });
  assert.equal(acts.status, "passed", "a character named in a silent line's action acts");
  const long = await run((script) => { script.duration = 8; });
  assert.deepEqual(long.rules, ["fits-length"]);
  const late = await run((script) => {
    script.beats[0].lines[0].text = Array.from({ length: 45 }, () => "word").join(" ");
    script.narration = script.beats.flatMap((beat) => beat.lines).filter((line) => line.text).map((line) => line.text).join(" ");
    script.duration = 60;
  });
  assert.deepEqual(late.rules, ["problem-lands"]);
  const none = await run((script) => { script.beats[1].beat = "attempt"; });
  assert.deepEqual(none.rules, ["problem-missing"]);
});

test("script gate: no script, a narrated script and bad JSON", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "script-gate-"));
  assert.deepEqual(await scriptGate({ project: dir }), { status: "skipped", reason: "no SCRIPT.json" });
  writeFileSync(path.join(dir, "SCRIPT.json"), JSON.stringify({ schema_version: "launchclip.make-script.v1", narration: "One voice reads this.", beats: [{ id: "hook", text: "One voice reads this." }] }));
  const narrated = await scriptGate({ project: dir });
  assert.equal(narrated.status, "skipped");
  assert.match(narrated.reason, /narrated script/);
  writeFileSync(path.join(dir, "SCRIPT.json"), "{ not json");
  const bad = await scriptGate({ project: dir });
  assert.equal(bad.status, "failed");
  assert.match(bad.errors[0], /not valid JSON/);
});
