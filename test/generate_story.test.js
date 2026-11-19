// Generated story shots and plates (docs/GENERATED_FOOTAGE_RFC.md §3, §4.1,
// §6) through the fake provider, offline: drafts, approval, finals, the budget
// stop, then the hand-in path (src/hand_in.js) decides what is drawn.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { HANDIN_SCHEMA, checkHandIn } from "../src/hand_in.js";
import { generateStoryAssets } from "../src/generate/story.js";
import { readLedger } from "../src/generate/ledger.js";
import { runFinish } from "../src/finish.js";
import { createFakeProvider } from "./fixtures/generate/fake-provider.js";
import { probeFakes, storyProject } from "./helpers/hand_in_project.js";

// No ffmpeg for the animatic's layout frames: the brief only needs the file named.
const hooks = { frame: async () => {} };
const manifest = async (dir) => JSON.parse(await readFile(path.join(dir, "HANDIN.json"), "utf8"));
// The fixture has 10 shots; 6 have two actions each, so they are refused (split them or draw them in code) and stay code-drawn.
const GENERATED = 4;

test("drafts → approval → finals: keyframes checked against the bible, plates once per place, HANDIN.json written", async () => {
  const { dir, bible, story } = await storyProject({ animatic: true });
  const fake = createFakeProvider({ price: 0.1 });
  const judged = [];
  const judge = async (request) => { judged.push(request.kind); return { ok: true }; };
  const asked = [];
  const result = await generateStoryAssets(dir, { image: fake, video: fake, draft: true, budget: { usd: 10 }, judge, ask: async (question) => { asked.push(question); return true; }, hooks });
  assert.equal(result.status, "generated");
  assert.equal(result.shots, GENERATED);
  assert.equal(result.plates, 1);
  assert.ok(asked.some((question) => /^drafts: 4 keyframe\(s\) and draft clip\(s\)/.test(question)), asked.join("\n"));
  // Every keyframe was judged against the bible before any clip: 4 shots and the plate.
  assert.equal(judged.filter((kind) => kind === "whole-shot").length, GENERATED);
  assert.equal(judged.filter((kind) => kind === "plate").length, 1);
  const ledger = await readLedger(dir);
  const count = (step, tier) => ledger.filter((entry) => entry.step === step && entry.tier === tier && entry.verdict === "accepted").length;
  assert.equal(count("image", "draft"), GENERATED + 1, "a keyframe per shot and one plate");
  assert.equal(count("video", "draft"), GENERATED);
  assert.equal(count("video", "final"), GENERATED);
  assert.equal(count("image", "final"), 0, "the finals animate the drafts' keyframes");
  const written = await manifest(dir);
  assert.equal(written.schema, HANDIN_SCHEMA);
  assert.equal(written.bible_hash, bible.hash);
  assert.equal(written.places.length, 1);
  assert.equal(written.places[0].place, "standing");
  assert.equal(written.shots.length, GENERATED);
  assert.ok(written.shots.every((entry) => entry.source.generated === true && entry.source.licence === "test fixture" && /fake:fake-video-final/.test(entry.source.made_with)));
  assert.ok(written.shots.every((entry) => entry.source_start === 0.3 && entry.clip.startsWith("assets/shots/generated/")));
  // From here it is the hand-in path: six shots have no whole shot, so under one look every shot is code-drawn and the plate is used.
  const report = await checkHandIn(dir, { story, ...probeFakes() });
  assert.equal(report.look, "code-drawn");
  assert.equal(report.assets.find((asset) => asset.kind === "plate").status, "used");
  // --look mixed draws each generated shot that passes.
  const mixed = await checkHandIn(dir, { story, look: "mixed", ...probeFakes() });
  assert.equal(mixed.assets.filter((asset) => asset.status === "used" && asset.kind === "whole-shot").length, GENERATED);
  // A second run reuses everything in the ledger: no new paid call.
  const before = fake.calls.filter(([call]) => call === "submit").length;
  await generateStoryAssets(dir, { image: fake, video: fake, draft: true, budget: { usd: 10 }, judge, approved: true, hooks });
  assert.equal(fake.calls.filter(([call]) => call === "submit").length, before);
});

test("--stop-after drafts stops awaiting approval with the drafts in HANDIN.json; --approve drafts makes the finals", async () => {
  const { dir } = await storyProject({ animatic: true });
  const fake = createFakeProvider({ price: 0.1 });
  const stopped = await generateStoryAssets(dir, { image: fake, video: fake, draft: true, budget: { usd: 10 }, stopAfter: "drafts", hooks });
  assert.equal(stopped.status, "awaiting-approval");
  assert.equal(stopped.drafts, GENERATED);
  let written = await manifest(dir);
  assert.ok(written.shots.every((entry) => /video-draft/.test(entry.clip)), "the draft clips, for handin check to look at");
  assert.ok(!fake.calls.some(([call, , step, tier]) => call === "submit" && step === "video" && tier === "final"));
  const approved = await generateStoryAssets(dir, { image: fake, video: fake, draft: true, budget: { usd: 10 }, approved: true, hooks });
  assert.equal(approved.status, "generated");
  written = await manifest(dir);
  assert.ok(written.shots.every((entry) => /video-final/.test(entry.clip)));
});

test("without a draft video model the drafts are the keyframes: no clip is paid for until they are approved", async () => {
  const { dir } = await storyProject({ animatic: true });
  const fake = createFakeProvider({ price: 0.1 });
  const stopped = await generateStoryAssets(dir, { image: fake, video: fake, budget: { usd: 10 }, stopAfter: "drafts", hooks });
  assert.equal(stopped.status, "awaiting-approval");
  assert.ok(!fake.calls.some(([call, , step]) => call === "submit" && step === "video"));
  assert.deepEqual((await manifest(dir)).shots, []);
  assert.equal((await manifest(dir)).places.length, 1);
});

test("a keyframe the bible check rejects is retried with one changed line, then left code-drawn", async () => {
  const { dir } = await storyProject({ animatic: true });
  const fake = createFakeProvider({ price: 0.1 });
  const judge = async (request) => (request.kind === "plate" || request.characters.every((member) => member.id !== "mare") ? { ok: true } : { ok: false, findings: ["the blaze is missing"] });
  const result = await generateStoryAssets(dir, { image: fake, video: fake, budget: { usd: 10 }, judge, approved: true, hooks });
  const ledger = await readLedger(dir);
  const retried = ledger.filter((entry) => entry.verdict === "rejected" && entry.step === "image");
  assert.ok(retried.length >= 3);
  assert.ok(retried.some((entry) => entry.changed === "Fix this: the blaze is missing."));
  assert.ok(result.notes.some((note) => /image not generated after 3 attempts; the shot needs simplifying/.test(note)), result.notes.join("\n"));
  assert.ok(result.shots < GENERATED);
});

test("budget stop → code-drawn: the batch is refused over budget, nothing is made, every shot stays code-drawn", async () => {
  const { dir, story } = await storyProject({ animatic: true });
  const fake = createFakeProvider({ price: 1 });
  const result = await generateStoryAssets(dir, { image: fake, video: fake, budget: { usd: 2 }, approved: true, hooks });
  assert.ok(result.notes.some((note) => /refused: .*budget/.test(note)), result.notes.join("\n"));
  assert.equal(result.shots, 0);
  assert.ok(!fake.calls.some(([call]) => call === "submit"));
  const report = await checkHandIn(dir, { story, ...probeFakes() });
  assert.equal(report.look, "code-drawn");
});

test("budget stop mid-run: spend is held at the budget and the rest fall back to code-drawn", async () => {
  const { dir, story } = await storyProject({ animatic: true });
  // The quote says 0.1 a call; each call really costs 1, so the running budget stops the run partway.
  const fake = { ...createFakeProvider({ price: 0.1 }), async fetch(job, outDir) { const made = await createFakeProvider({ price: 1 }).fetch(job, outDir); return made; } };
  const result = await generateStoryAssets(dir, { image: fake, video: fake, budget: { usd: 3 }, approved: true, hooks });
  assert.match(result.stopped ?? "", /the budget is reached/);
  assert.ok(result.shots < GENERATED);
  const spent = (await readLedger(dir)).reduce((sum, entry) => sum + (entry.cost?.amount ?? 0), 0);
  assert.ok(spent <= 3 + 1, `spent ${spent}`);
  const report = await checkHandIn(dir, { story, ...probeFakes() });
  assert.equal(report.look, "code-drawn");
});

test("finish --generate: drafts stop the run awaiting approval, nothing rendered", async () => {
  const { dir } = await storyProject({ animatic: true });
  const fake = createFakeProvider({ price: 0.1 });
  const report = await runFinish(dir, { renderer: "remotion", generate: "cmd:unused", budget: "10usd", stopAfter: "drafts" }, { env: {}, notice() {}, generateProviders: { image: fake, video: fake }, generateHooks: hooks, handInHooks: probeFakes() });
  assert.equal(report.status, "awaiting-approval");
  assert.equal(report.generate.status, "awaiting-approval");
  assert.ok(report.stages.every((stage) => stage.status === "skipped"));
  assert.ok(report.next_steps.some((step) => /--approve drafts/.test(step)));
});

test("with no --generate flag finish never generates", async () => {
  const { dir } = await storyProject({ animatic: true });
  const report = await runFinish(dir, { renderer: "remotion", planOnly: true }, { env: {}, notice() {}, handInHooks: probeFakes() });
  assert.equal(report.generate, undefined);
  assert.deepEqual(await readLedger(dir), []);
});
