import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { catalogModules, knownModules } from "../kit/core/modules.mjs";
import { DEFAULT_BRAND } from "../kit/core/planning-prompt.mjs";
import { AnthropicPlannerClient, STORYBOARD_ENVELOPE_SCHEMA, bareModelId, checkStoryboard, createPlannerClient, extractStoryboard, planStoryboard } from "../src/storyboard_planner.js";
import { planStoryCommand } from "../src/story_cli.js";
import { runCli } from "../src/cli.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 12, platform: "youtube-shorts" };
const BRIEF = "Explain why hot coffee cools fast at first and then slowly. Newton's law of cooling. End with a follow prompt.";
const WORDS = [
  ["Why", 0.1], ["does", 0.3], ["coffee", 0.5], ["cool", 0.9], ["fast", 1.3], ["then", 3.1], ["slow", 3.5],
  ["Newton", 4.2], ["named", 4.7], ["the", 5.0], ["law", 5.2], ["of", 5.5], ["cooling", 5.7],
  ["The", 6.6], ["gap", 6.9], ["shrinks", 7.3], ["follow", 9.4], ["for", 9.8], ["more", 10.0]
].map(([text, start]) => ({ text, start, end: start + 0.25 }));
const AUDIO = { voice: "assets/audio/narration.wav", words: "NARRATION.json" };

// A hand-written, valid structured-tier storyboard for the brief.
function goodStoryboard() {
  return {
    schema: "launchclip.story.v1",
    title: "Why coffee cools",
    lane: "voiceover-motion",
    format: FORMAT,
    brand: DEFAULT_BRAND,
    audio: { ...AUDIO, music: { source: "synth", bpm: 96 }, sfx: "auto" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: "word:then", energy: 1, params: { headline: "Why does coffee cool fast?", emphasis: "fast" }, hits: [{ at: "word:fast", event: "emphasis-0" }] },
      { id: "s2", module: "equation-lockup", start: "word:then", end: "word:the#2", energy: 2, in: { type: "push", dur: 0.4, direction: "left" }, params: { name: "Newton's law of cooling", equation: "dT/dt = −k (T − T_room)", note: "rate follows the gap" }, hits: [{ at: "word:law", event: "lockup" }] },
      { id: "s3", module: "checklist", start: "word:the#2", end: "word:follow", energy: 2, in: { type: "whip", dur: 0.3, direction: "up" }, params: { title: "What sets the pace", statusLabels: { pending: "Next", active: "Now", done: "Covered" }, rows: [{ label: "Big gap: fast", status: "done", at: 0.4 }, { label: "Small gap: slow", status: "done", at: 1.1 }] } },
      { id: "s4", module: "cta", start: "word:follow", end: 12, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Follow for more physics", loop: true } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    ending: { loop_to: "s1" }
  };
}

// Deliberate mistakes a weaker model makes: an unknown module, a param that
// breaks a module's limits, raw coordinates in the structured tier, and an
// anchor on a word that is never spoken.
function brokenStoryboard() {
  const story = goodStoryboard();
  story.scenes[0].params.headline = "Why does a hot cup of coffee on your desk cool so quickly at first and then so slowly afterwards?";
  story.scenes[1].module = "formula-card";
  story.scenes[2].params.rect = { x: 0, y: 1500, width: 1080, height: 400 };
  return story;
}

// Storyboard calls are queued responses; the direction-map call (RFC §6.4)
// answers from `direction` (a map, a function, or none: no map, so the
// planner drafts one) and is recorded apart.
function fakeClient(responses, { direction = null } = {}) {
  const calls = [];
  const directionCalls = [];
  return {
    provider: "openai",
    calls,
    directionCalls,
    async runStructured(request) {
      if (request.schemaName === "launchclip_direction") {
        directionCalls.push(request);
        const map = typeof direction === "function" ? direction(request, directionCalls.length) : direction;
        return { model: "gpt-5.6-luna", value: { direction_json: map ? JSON.stringify(map) : "" }, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } };
      }
      calls.push(request);
      const next = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(request) : next;
    }
  };
}

const envelope = (story, usage = { input_tokens: 9000, output_tokens: 1200, total_tokens: 10200 }) => ({ response_id: "resp_1", model: "gpt-5.6-luna", status: "completed", value: { storyboard_json: JSON.stringify(story) }, usage });

const plan = (client, extra = {}) => planStoryboard({ brief: BRIEF, words: WORDS, lane: "voiceover-motion", format: FORMAT, audio: AUDIO, tier: "structured", model: "openai:gpt-5.6-luna", client, ...extra });

test("success on the first attempt: prompt from the registry, envelope schema, derived editorial rect, usage and cost", async () => {
  const client = fakeClient([envelope(goodStoryboard())]);
  const report = await plan(client);
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.valid_first_attempt, true);
  assert.equal(report.repairs_used, 0);
  assert.equal(client.calls.length, 1);
  const [request] = client.calls;
  assert.deepEqual(request.schema, STORYBOARD_ENVELOPE_SCHEMA);
  // Subject modules are offered only to a footage-led story with a usable presenter.
  const needsSubject = new Set(Object.entries(catalogModules()).filter(([, definition]) => definition.needs?.includes("subject")).map(([id]) => id));
  for (const id of knownModules()) {
    if (needsSubject.has(id)) assert.doesNotMatch(request.instructions, new RegExp(`### ${id} \\(`));
    else assert.match(request.instructions, new RegExp(`### ${id} \\(`));
  }
  assert.match(request.instructions, /coffee@0\.5/);
  assert.match(request.input, /Explain why hot coffee cools/);
  assert.match(request.input, /Phrase hints/);
  // The editorial checklist keeps no rect: its content-derived default passes the layout check.
  assert.equal(report.storyboard.scenes[2].params.rect, undefined);
  assert.equal(report.layout.errors, 0);
  assert.deepEqual(report.attempts[0].modules, ["hook-title", "equation-lockup", "checklist", "cta"]);
  assert.equal(report.usage.total_tokens, 10200);
  assert.equal(report.cost.complete, true);
  assert.ok(report.cost.estimated_usd > 0);
});

test("repair success: the exact validation and tier errors go back, then the fix passes", async () => {
  const client = fakeClient([envelope(brokenStoryboard()), envelope(goodStoryboard())]);
  const report = await plan(client);
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.valid_first_attempt, false);
  assert.equal(report.repairs_used, 1);
  const first = report.attempts[0];
  assert.equal(first.ok, false);
  assert.ok(first.errors.some((entry) => /^validation: scenes\[1\]\.module "formula-card" is not a known module$/.test(entry)), first.errors.join("\n"));
  assert.ok(first.errors.some((entry) => /^tier: scenes\[2\] \(s3\)\.params\.rect is not allowed in the structured tier/.test(entry)));
  const repair = client.calls[1].input;
  for (const entry of first.errors) assert.ok(repair.includes(`- ${entry}`), `repair prompt is missing: ${entry}`);
  assert.match(repair, /formula-card/, "the previous storyboard is sent back");
  assert.match(repair, /thresholds are fixed/);
  assert.equal(report.usage.total_tokens, 20400);
});

test("param errors surface with the param's path, from the module's schema", async () => {
  const story = goodStoryboard();
  story.scenes[0].params.headline = "Why does a hot cup of coffee on your desk cool so quickly at first and then so slowly afterwards?";
  const checked = checkStoryboard(story, { words: WORDS, tier: "structured" });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.includes("validation: scenes[0].params.headline must be at most 90 characters (it has 97)"), checked.errors.join("\n"));
});

test("param errors the schema cannot see surface from the module after the shape is valid", async () => {
  const story = goodStoryboard();
  story.scenes[0].params.emphasis = "kettle";
  const checked = checkStoryboard(story, { words: WORDS, tier: "structured" });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => /^params: scenes\[0\] \(s1\): module "hook-title" params: hook-title: .*emphasis/.test(entry)), checked.errors.join("\n"));
});

test("layout errors from guided-tier coordinates are reported as layout errors", () => {
  const story = goodStoryboard();
  story.scenes[2].params.rect = { x: 90, y: 1100, width: 850, height: 500 };
  const checked = checkStoryboard(story, { words: WORDS, tier: "guided" });
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => /^layout: safe-zone .*\[s3\]/.test(entry)), checked.errors.join("\n"));
  assert.ok(checked.errors.some((entry) => /^layout: caption-band .*\[s3, captions\]/.test(entry)));
  assert.ok(checked.layout.errors >= 2);
});

test("repair exhaustion: stops after two repairs and reports the last errors", async () => {
  const story = goodStoryboard();
  story.scenes[3].start = "word:subscribe";
  const client = fakeClient([envelope(story)]);
  const report = await plan(client);
  assert.equal(report.status, "failed");
  assert.equal(client.calls.length, 3);
  assert.equal(report.repairs_used, 2);
  assert.deepEqual(report.attempts.map((entry) => entry.kind), ["plan", "repair", "repair"]);
  assert.ok(report.errors.some((entry) => /^anchors: scenes\[3\]\.start: Unknown anchor word:subscribe/.test(entry)), report.errors.join("\n"));
  assert.match(client.calls[2].input, /## Repair 2 of 2/);
  assert.ok(report.storyboard, "the last candidate is kept for inspection");
});

test("unparseable output counts as an attempt and asks for JSON", async () => {
  const client = fakeClient([
    { model: "m", value: { storyboard_json: "Sure! Here is the storyboard: {\"schema\": " }, usage: {} },
    { model: "m", text: `Here you go:\n\`\`\`json\n${JSON.stringify(goodStoryboard())}\n\`\`\``, usage: {} }
  ]);
  const report = await plan(client);
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.match(report.attempts[0].errors[0], /^json: could not parse a storyboard JSON object/);
  assert.match(client.calls[1].input, /Sure! Here is the storyboard/);
});

test("fixed inputs are pinned: a changed lane or format is reset with a warning", async () => {
  const story = goodStoryboard();
  story.lane = "motion";
  story.format = { ...FORMAT, duration: 40 };
  delete story.audio.voice;
  const report = await plan(fakeClient([envelope(story)]));
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.storyboard.lane, "voiceover-motion");
  assert.equal(report.storyboard.format.duration, 12);
  assert.equal(report.storyboard.audio.voice, AUDIO.voice);
  assert.ok(report.warnings.some((entry) => /lane was changed by the model/.test(entry)));
});

test("custom modules are bespoke-only", () => {
  const story = goodStoryboard();
  story.scenes[1] = { id: "s2", module: "custom", source: "modules/Cooling.tsx", start: "word:then", end: "word:the#2" };
  assert.ok(checkStoryboard(story, { words: WORDS, tier: "guided" }).errors.some((entry) => /^tier: .*"custom", which only the bespoke tier may use/.test(entry)));
  const bespoke = checkStoryboard(story, { words: WORDS, tier: "bespoke" });
  assert.equal(bespoke.ok, true, bespoke.errors.join("\n"));
});

test("a transport failure stops without repairs", async () => {
  const report = await plan(fakeClient([new Error("openrouter chat completions failed (503): busy")]));
  assert.equal(report.status, "failed");
  assert.equal(report.attempts.length, 1);
  assert.match(report.errors[0], /^model: openrouter chat completions failed/);
});

test("extractStoryboard accepts envelopes, direct objects, fenced and prose-wrapped text", () => {
  const story = { schema: "launchclip.story.v1", scenes: [] };
  assert.deepEqual(extractStoryboard({ value: { storyboard_json: JSON.stringify(story) } }).storyboard, story);
  assert.deepEqual(extractStoryboard({ value: story }).storyboard, story);
  assert.deepEqual(extractStoryboard({ text: `\`\`\`json\n${JSON.stringify(story)}\n\`\`\`` }).storyboard, story);
  assert.deepEqual(extractStoryboard({ text: `Here: ${JSON.stringify(story)} done. {"x": "}"}` }).storyboard, story);
  assert.equal(extractStoryboard({ text: "no json" }).ok, false);
});

test("createPlannerClient needs a model and keys, and the Anthropic adapter maps usage", async () => {
  assert.throws(() => createPlannerClient(""), /No planner model/);
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try { assert.throws(() => createPlannerClient("anthropic:claude-test"), /ANTHROPIC_API_KEY is not set/); }
  finally { if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved; }
  const created = createPlannerClient("openrouter:vendor/model", { createClient: (route) => ({ route, runStructured() {} }) });
  assert.equal(created.provider, "openrouter");
  assert.equal(created.model, "vendor/model");

  const sdk = { messages: { create: async (body) => ({ id: "msg_1", model: body.model, content: [{ type: "text", text: JSON.stringify({ schema: "launchclip.story.v1" }) }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } }) } };
  const client = new AnthropicPlannerClient({ model: "claude-test", sdk });
  const result = await client.runStructured({ instructions: "sys", input: "brief" });
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 5, total_tokens: 15, cached_tokens: 2 });
  assert.equal(extractStoryboard(result).storyboard.schema, "launchclip.story.v1");
});

test("launchclip story plan writes storyboard.json and the plan report", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-plan-"));
  try {
    await writeFile(path.join(dir, "brief.md"), BRIEF);
    await writeFile(path.join(dir, "NARRATION.json"), JSON.stringify({ words: WORDS }));
    const client = fakeClient([envelope(brokenStoryboard()), envelope(goodStoryboard())]);
    // The default brand, so the fixed storyboard is not checked against a seeded style's fonts.
    await writeFile(path.join(dir, "brand.json"), JSON.stringify(DEFAULT_BRAND));
    const result = await planStoryCommand({ brief: path.join(dir, "brief.md"), narration: path.join(dir, "NARRATION.json"), out: path.join(dir, "storyboard.json"), duration: "12", brand: path.join(dir, "brand.json") }, { client });
    assert.equal(result.status, "passed");
    assert.equal(result.lane, "voiceover-motion");
    assert.equal(result.repairs_used, 1);
    const written = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
    assert.equal(written.audio.words, "NARRATION.json");
    assert.equal(written.audio.voice, "assets/audio/narration.wav");
    const report = JSON.parse(await readFile(path.join(dir, ".launchclip/storyboard-plan.json"), "utf8"));
    assert.equal(report.schema_version, "launchclip.storyboard-plan.v1");
    assert.equal(report.attempts.length, 2);

    // Through the CLI entry point, with exhaustion: no storyboard.json, a rejected candidate.
    const stdout = { text: "", write(chunk) { this.text += chunk; } };
    const failing = fakeClient([envelope(brokenStoryboard())]);
    await assert.rejects(
      runCli(["story", "plan", "--brief", path.join(dir, "brief.md"), "--out", path.join(dir, "second.json"), "--duration", "12"], { stdout, productionAdapters: { story: { client: failing } } }),
      /story plan failed after 3 attempt\(s\)/
    );
    assert.equal(failing.calls.length, 3);
    await assert.rejects(readFile(path.join(dir, "second.json")));
    assert.ok(JSON.parse(await readFile(path.join(dir, "second.rejected.json"), "utf8")).scenes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the client gets the bare model id, not the provider:model@reasoning route", async () => {
  assert.equal(bareModelId("openai:gpt-5.6-luna@medium"), "gpt-5.6-luna");
  assert.equal(bareModelId("anthropic:claude-opus-4-8"), "claude-opus-4-8");
  assert.equal(bareModelId("openrouter:vendor/model"), "vendor/model");
  assert.equal(bareModelId("gpt-5.6"), "gpt-5.6");
  assert.equal(bareModelId(null), null);
  const client = fakeClient([envelope(goodStoryboard())]);
  await plan(client);
  assert.equal(client.calls[0].model, "gpt-5.6-luna");
});

test("extraCheck errors go back to the model as repairs", async () => {
  const client = fakeClient([envelope(goodStoryboard()), envelope(goodStoryboard())]);
  let calls = 0;
  const report = await plan(client, { extraCheck: () => (calls++ === 0 ? ["scenes[0] references assets/missing.png, which is not in the asset manifest"] : []) });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.repairs_used, 1);
  assert.match(client.calls[1].input, /assets: scenes\[0\] references assets\/missing\.png/);
});

// ---------------------------------------------------------------------------
// The direction map first (docs/VIDEO_QUALITY_RFC.md §6.4)

const MAP = {
  schema: "launchclip.direction-map.v1",
  profile: "short-motion",
  sections: [{ id: "s1", title: "Cooling", lines: [
    { words: [0, 4], intent: "hook", treatment: "insert", scenes: ["s1"] },
    { words: [5, 12], intent: "claim", treatment: "insert", scenes: ["s2"] },
    { words: [13, 15], intent: "claim", treatment: "insert", scenes: ["s3"] },
    { words: [16, 18], intent: "cta", treatment: "insert", scenes: ["s4"] }
  ] }]
};
const SHORT_MOTION = JSON.parse(await readFile(new URL("../kit/profiles/short-motion.json", import.meta.url), "utf8"));

test("direction: the planner asks for the map first, then plans the storyboard against it", async () => {
  const client = fakeClient([envelope(goodStoryboard())], { direction: MAP });
  const report = await plan(client, { direction: true, profile: SHORT_MOTION });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(client.directionCalls.length, 1);
  assert.match(client.directionCalls[0].instructions, /You author DIRECTION\.json/);
  assert.match(client.directionCalls[0].instructions, /- \[0, 4\] hook: "Why does coffee cool fast"/, "the lines come pre-split with the shared intent rules");
  assert.match(client.directionCalls[0].instructions, /## Cadence profile \(short-motion\)/);
  assert.match(client.calls[0].instructions, /## Direction map \(plan the storyboard against it\)/);
  assert.match(client.calls[0].instructions, /"scenes":\["s2"\]/);
  assert.deepEqual(report.direction, MAP);
  assert.equal(report.direction_source, "model");
  assert.equal(report.profile, "short-motion");
  assert.equal(report.cadence.coverage, 1);
  assert.equal(report.direction_attempts.length, 1);
  assert.equal(report.usage.total_tokens, 150 + 10200, "the direction call is counted");
});

test("direction: the repair loop repairs both the map and the storyboard", async () => {
  const wrong = structuredClone(MAP);
  wrong.sections[0].lines[1].scenes = ["equation"];
  const fixed = structuredClone(MAP);
  const client = fakeClient([envelope(goodStoryboard()), (request) => ({ model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(goodStoryboard()), direction_json: JSON.stringify(fixed) }, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, request })], { direction: wrong });
  const report = await plan(client, { direction: true, profile: SHORT_MOTION });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.repairs_used, 1);
  assert.match(report.attempts[0].errors.join("\n"), /direction: .*names scene "equation", which is not in the storyboard/);
  assert.match(client.calls[1].input, /Current direction map/);
  assert.deepEqual(client.calls[1].schema.required, ["storyboard_json", "direction_json"]);
  assert.deepEqual(report.direction, fixed);
});

test("direction: a map that fails its own checks is repaired before the storyboard", async () => {
  const gap = structuredClone(MAP);
  gap.sections[0].lines.splice(2, 1);
  const client = fakeClient([envelope(goodStoryboard())], { direction: (request, n) => (n === 1 ? gap : MAP) });
  const report = await plan(client, { direction: true, profile: SHORT_MOTION });
  assert.equal(report.status, "passed");
  assert.equal(client.directionCalls.length, 2);
  assert.match(client.directionCalls[1].input, /every line needs an entry: words \[13, 15\]/);
  assert.deepEqual(report.direction_attempts.map((entry) => entry.kind), ["direction", "direction-repair"]);
});

test("direction: with no map from the model, one is drafted from the storyboard and flagged", async () => {
  const client = fakeClient([envelope(goodStoryboard())]);
  const report = await plan(client, { direction: true, profile: SHORT_MOTION });
  assert.equal(report.status, "passed");
  assert.equal(report.direction_source, "drafted");
  assert.equal(report.direction.schema, "launchclip.direction-map.v1");
  assert.ok(report.warnings.some((warning) => /drafted from the storyboard/.test(warning)));
});

test("direction: coverage outside the profile band fails the plan so the loop repairs it", () => {
  const tight = { ...SHORT_MOTION, id: "tight", measures: { coverage: { p10: 0.2, p50: 0.4, p90: 0.5 }, shot_seconds: { p10: 0.1, p50: 0.2, p90: 0.3 } } };
  const result = checkStoryboard(goodStoryboard(), { words: WORDS, tier: "structured", direction: MAP, profile: tight });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /cadence: coverage 100% is above the profile band .*hold more lines on the presenter/);
  assert.match(result.warnings.join("\n"), /cadence: shot_seconds .* above the profile band/, "the rest of the band only warns");
  const advisory = checkStoryboard(goodStoryboard(), { words: WORDS, tier: "structured", direction: MAP, profile: tight, bandErrors: false });
  assert.equal(advisory.ok, true);
});
