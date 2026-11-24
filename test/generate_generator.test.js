import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveShots } from "../src/asset_provider.js";
import { loadWords } from "../src/finish.js";
import { createCommandProvider, createGenerator, generateSpecs, parseBudget, visionKeyframeCheck } from "../src/generate/generator.js";
import { ledgerCosts, readLedger } from "../src/generate/ledger.js";
import { createFakeProvider } from "./fixtures/generate/fake-provider.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "generate-brief");
const NO_POLL = { image: 0, video: 0 };
const measure = async () => ({ peak: 0.5, motion: 0.01, frames: 4 });

async function project(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-generate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function plan(dir, assets) {
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const words = (await loadWords(dir, story)) ?? [];
  return resolveShots(story, { assets, words, project: dir, measure });
}

const submits = (fake) => fake.calls.filter(([call]) => call === "submit").map(([, id, step]) => `${id.split("-")[0]}:${step}`);

test("the fake provider drives a fixture storyboard through image and video, and a re-run reuses the ledger", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.05, pollsUntilDone: 2 });
  const notes = [];
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, pollMs: NO_POLL, notice: (line) => notes.push(line) });
  const out = await plan(dir, generator);

  // s1 a clip (image → video), s2 a still card slot and s3 an image (image only), s5 a backdrop (video); s4 names a product.
  assert.deepEqual(submits(fake).sort(), ["s1:image", "s1:video", "s2:image", "s3:image", "s5:image", "s5:video"]);
  const scene = (id) => out.storyboard.scenes.find((item) => item.id === id);
  assert.equal(scene("s1").params.media.kind, "video");
  assert.equal(scene("s1").params.media.sourceStart, 0.3);
  assert.ok(existsSync(path.join(dir, scene("s1").params.media.src)));
  assert.equal(scene("s3").params.media.kind, "image");
  assert.match(out.errors.join("\n"), /scene s4.*iPhone/);
  assert.match(notes.join("\n"), /s4-.*not generated.*iPhone/);
  for (const shot of out.shots) assert.equal(shot.source.generated, true, shot.scene_id);
  assert.equal(out.shots.find((shot) => shot.scene_id === "s1").source.licence, "test fixture");
  assert.match(notes.join("\n"), /no vision model is configured/);
  assert.equal(generator.report().quotes.length, 2, "shots, then backdrops, each quoted as a batch");

  const ledger = await readLedger(dir);
  assert.equal(ledger.length, 6);
  assert.ok(ledger.every((entry) => entry.verdict === "accepted" && entry.cost.amount === 0.05 && existsSync(path.join(dir, entry.file))));
  assert.equal((await ledgerCosts(dir)).by_unit.usd, 0.3);

  const again = createFakeProvider({ price: 0.05 });
  const rerun = await plan(dir, createGenerator({ project: dir, image: again, video: again, budget: { usd: 5 }, pollMs: NO_POLL }));
  assert.deepEqual(submits(again), [], "every accepted asset is reused");
  assert.equal(rerun.shots.length, out.shots.length);
  assert.equal((await readLedger(dir)).length, 6);
});

test("spend that passes the budget stops generation and the rest come back null", async (t) => {
  const dir = await project(t);
  // Quoted cheap, billed dear: the budget is enforced on recorded spend, not only the quote.
  const fake = createFakeProvider({ price: 2 });
  const cheap = { ...fake, quote: async () => ({ amount: 0.5, unit: "usd" }) };
  const notes = [];
  const out = await plan(dir, createGenerator({ project: dir, image: cheap, video: cheap, budget: { usd: 3 }, pollMs: NO_POLL, notice: (line) => notes.push(line) }));
  assert.deepEqual(submits(fake), ["s1:image", "s1:video"]);
  assert.equal(out.shots.length, 1);
  assert.match(notes.join("\n"), /the budget is reached/);
  assert.match(notes.join("\n"), /s3-.*not generated, the budget is reached/);
  assert.match(out.storyboard.scenes.find((scene) => scene.id === "s5").backdrop?.kind ?? "", /^(?!shot)/, "the backdrop is not a pending request");
});

test("a batch is refused without a budget headless, over its budget, or unpriced without a budget", async (t) => {
  const dir = await project(t);
  for (const [options, reason] of [
    [{}, /needs --budget/],
    [{ budget: { usd: 0.05 } }, /would pass the budget of 0.05 usd/],
    [{ budget: { credits: 1000 }, unpriced: true }, /no price in credits and reports no cost.*--max-generations/]
  ]) {
    const fake = createFakeProvider({ price: 0.05 });
    const provider = options.unpriced ? { ...fake, quote: async () => ({ amount: null, unit: "credits" }) } : fake;
    const notes = [];
    const out = await plan(dir, createGenerator({ project: dir, image: provider, video: provider, ...options, pollMs: NO_POLL, notice: (line) => notes.push(line) }));
    assert.deepEqual(submits(fake), []);
    assert.equal(out.shots.length, 0);
    assert.match(notes.join("\n"), reason);
  }
  assert.deepEqual(await readLedger(dir), []);
});

test("attended, the quote is asked about and a yes becomes the budget", async (t) => {
  const dir = await project(t);
  const asked = [];
  const no = createFakeProvider({ price: 0.05 });
  await plan(dir, createGenerator({ project: dir, image: no, video: no, approve: async (text) => { asked.push(text); return false; }, pollMs: NO_POLL }));
  assert.deepEqual(submits(no), []);
  assert.match(asked[0], /generate: 3 shot\(s\), 0.2 usd\. Generate them\?/);

  const yes = createFakeProvider({ price: 0.05 });
  const out = await plan(dir, createGenerator({ project: dir, image: yes, video: yes, approve: async () => true, pollMs: NO_POLL }));
  assert.equal(out.shots.length, 4);
});

test("a rejected keyframe is retried with one changed line, at most MAX_ATTEMPTS times", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.01 });
  const prompts = [];
  const submit = fake.submit;
  fake.submit = (brief, ...rest) => { prompts.push(brief.image.prompt); return submit(brief, ...rest); };
  const check = async () => ({ ok: false, reason: "too dark", change: "Bright daylight." });
  const generator = createGenerator({ project: dir, image: fake, budget: { usd: 5 }, check, pollMs: NO_POLL });
  const request = { id: "x1-abc", scene_id: "x1", shows: "a field of wheat at dawn", type: "image", still: false, format: { width: 1080, height: 1920 } };
  assert.equal(await generator.findShot(request), null);
  assert.equal(prompts.length, 3);
  assert.ok(!prompts[0].includes("Bright daylight."));
  assert.ok(prompts[1].endsWith(" Bright daylight.") && prompts[2].endsWith(" Bright daylight.") && !prompts[2].endsWith("Bright daylight. Bright daylight."));
  const ledger = await readLedger(dir);
  assert.deepEqual(ledger.map((entry) => [entry.attempt, entry.verdict, entry.changed ?? null]), [[1, "rejected", null], [2, "rejected", "Bright daylight."], [3, "rejected", "Bright daylight."]]);
  // The cap holds across runs.
  const later = createFakeProvider({ price: 0.01 });
  assert.equal(await createGenerator({ project: dir, image: later, budget: { usd: 5 }, pollMs: NO_POLL }).findShot(request), null);
  assert.deepEqual(submits(later), []);
});

test("failed attempts cap a shot per model: another video model gets a fresh cap, and every attempt's spend counts", async (t) => {
  const dir = await project(t);
  const request = { id: "x2-abc", scene_id: "x2", shows: "steam rising from a cup", type: "video", format: { width: 1080, height: 1350 }, duration: 3 };
  const make = (video, fail = []) => Object.assign(createFakeProvider({ price: 0.1, fail }), { models: { image: "img", video } });
  const first = make("model-a", ["video"]);
  assert.equal(await createGenerator({ project: dir, image: first, video: first, budget: { usd: 5 }, pollMs: NO_POLL }).findShot(request), null);
  // Out of attempts with model-a, across runs.
  const again = make("model-a");
  assert.equal(await createGenerator({ project: dir, image: again, video: again, budget: { usd: 5 }, pollMs: NO_POLL }).findShot(request), null);
  assert.deepEqual(submits(again).filter((call) => call.endsWith(":video")), []);
  // model-b starts its own count; attempt numbers keep rising so files never collide.
  const other = make("model-b");
  const shot = await createGenerator({ project: dir, image: other, video: other, budget: { usd: 5 }, pollMs: NO_POLL }).findShot(request);
  assert.equal(shot?.kind, "video");
  const videos = (await readLedger(dir)).filter((entry) => entry.step === "video");
  assert.deepEqual(videos.map((entry) => [entry.asked_model, entry.attempt, entry.verdict]), [["model-a", 1, "failed"], ["model-a", 2, "failed"], ["model-a", 3, "failed"], ["model-b", 4, "accepted"]]);
  assert.equal(Math.round((await ledgerCosts(dir)).by_unit.usd * 100) / 100, 0.5, "the keyframe, three failed clips and the made one");
});

test("a library is asked first and only its misses are generated", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.05 });
  const library = { findShot: async (request) => (request.scene_id === "s3" ? { kind: "image", file: path.join(FIXTURE, "..", "parity", "assets", "testsrc.png"), source: { provider: "library" } } : null) };
  const out = await plan(dir, createGenerator({ project: dir, image: fake, video: fake, library, budget: { usd: 5 }, pollMs: NO_POLL }));
  assert.ok(!submits(fake).includes("s3:image"));
  assert.ok(submits(fake).includes("s1:image"));
  assert.equal(out.shots.find((shot) => shot.scene_id === "s3").source.provider, "library");
});

test("cmd: a command speaking JSON lines is a provider", async (t) => {
  const dir = await project(t);
  const png = path.join(FIXTURE, "..", "parity", "assets", "testsrc.png");
  const script = path.join(dir, "gen.mjs");
  await writeFile(script, `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, op } = JSON.parse(line);
  console.log(JSON.stringify(op === "quote" ? { id, amount: 0.02, unit: "usd" } : { id, file: ${JSON.stringify(png)}, model: "local-test", licence: "CC0" }));
});`);
  const provider = createCommandProvider(`node ${JSON.stringify(script)}`, { cwd: dir, notice: () => {} });
  t.after(() => provider.close());
  const generator = createGenerator({ project: dir, image: provider, budget: { usd: 1 }, pollMs: NO_POLL });
  const shot = await generator.findShot({ id: "x2-abc", scene_id: "x2", shows: "a field of wheat at dawn", type: "image", format: { width: 1080, height: 1920 } });
  assert.equal(shot.kind, "image");
  assert.equal(shot.source.licence, "CC0");
  assert.equal(shot.source.made_with, "cmd:local-test");
  assert.deepEqual((await readLedger(dir)).map((entry) => entry.cost), [{ amount: 0.02, unit: "usd" }]);
});

test("flags parse into provider specs and budgets", () => {
  assert.equal(generateSpecs({}), null);
  assert.deepEqual(generateSpecs({ generate: "fal", image: "fal:fal-ai/flux/dev", video: "fal:fal-ai/kling" }), { image: { provider: "fal", model: "fal-ai/flux/dev" }, video: { provider: "fal", model: "fal-ai/kling" }, draftVideo: null });
  assert.deepEqual(generateSpecs({ generate: "cmd:node gen.mjs --x" }).image, { provider: "cmd", model: "node gen.mjs --x" });
  assert.throws(() => generateSpecs({ generate: "midjourney" }), /must name fal, elevenlabs, local, cmd/);
  assert.throws(() => generateSpecs({ video: "fal:x" }), /keyframe provider/);
  assert.deepEqual(parseBudget("5"), { usd: 5 });
  assert.deepEqual(parseBudget("2.5usd,200credits"), { usd: 2.5, credits: 200 });
  assert.equal(parseBudget(undefined), null);
  assert.throws(() => parseBudget("lots"), /<n>\[usd\|credits\]/);
});

test("with no video provider, video requests are left alone and the rest are stills", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.05 });
  const notes = [];
  const out = await plan(dir, createGenerator({ project: dir, image: fake, budget: { usd: 5 }, pollMs: NO_POLL, notice: (line) => notes.push(line) }));
  assert.deepEqual(submits(fake).sort(), ["s2:image", "s3:image"]);
  assert.match(notes.join("\n"), /s1-.*no video provider/);
  assert.ok(out.shots.every((shot) => shot.kind === "image"));
});

test("the vision check passes a keyframe that shows the subject with no text, and returns the fix line otherwise", async () => {
  const answers = [{ shows_subject: true, has_text_or_logo: false, finding: "", change: "" }, { shows_subject: true, has_text_or_logo: true, finding: "a sign with words", change: "No signs anywhere." }];
  const seen = [];
  const client = { runStructured: async (call) => { seen.push(call); return { value: answers.shift() }; } };
  const check = visionKeyframeCheck(client, { readImage: async () => "data:image/png;base64,AA==" });
  const request = { shows: "a field of wheat at dawn" };
  assert.deepEqual(await check({ file: "k.png", request }), { ok: true, reason: null, change: null });
  assert.deepEqual(await check({ file: "k.png", request }), { ok: false, reason: "a sign with words", change: "No signs anywhere." });
  assert.match(seen[0].input, /a field of wheat at dawn/);
  assert.equal(seen[0].images[0].url, "data:image/png;base64,AA==");
});

test("an unpriced provider is held to its call cap, even with a budget, across runs", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0 });
  // No price, no cost: the shape of a provider whose spend can't be counted.
  const unpriced = { ...fake, quote: async () => ({ amount: null, unit: "credits" }), fetch: async (...args) => { const { cost: _cost, ...rest } = await fake.fetch(...args); return rest; } };
  const notes = [];
  const out = await plan(dir, createGenerator({ project: dir, image: unpriced, video: unpriced, budget: { credits: 1000 }, maxCalls: 3, pollMs: NO_POLL, notice: (line) => notes.push(line) }));
  assert.deepEqual(submits(fake), ["s1:image", "s1:video", "s2:image"]);
  assert.equal(out.shots.length, 2);
  assert.match(notes.join("\n"), /cap of 3 unpriced call\(s\) is reached/);
  const ledger = await readLedger(dir);
  assert.equal(ledger.length, 3);
  assert.ok(ledger.every((entry) => entry.cost_unknown === true));

  // Headless with only the cap is allowed, and the cap is not reset by a re-run.
  const again = createFakeProvider({ price: 0 });
  const later = { ...again, quote: async () => ({ amount: null, unit: "credits" }) };
  await plan(dir, createGenerator({ project: dir, image: later, video: later, maxCalls: 3, pollMs: NO_POLL }));
  assert.deepEqual(submits(again), []);
});

test("a provider that spends only local seconds runs headless with no budget, cap or approval", async (t) => {
  for (const amount of [12, null]) {
    const dir = await project(t);
    // Like the local adapter: a rate may be missing from the quote, but fetch reports the seconds it took.
    const fake = createFakeProvider({ price: amount ?? 3, unit: "seconds" });
    const provider = { ...fake, quote: async () => ({ amount, unit: "seconds" }) };
    const notes = [];
    const out = await plan(dir, createGenerator({ project: dir, image: provider, video: provider, pollMs: NO_POLL, notice: (line) => notes.push(line) }));
    assert.ok(out.shots.length > 0, notes.join("\n"));
    assert.match(notes.join("\n"), amount ? /quote: .*\d+ seconds; local time only/ : /unknown seconds; local time only/);
  }
});

test("continuity: a brief with continue_from starts on the last kept frame of that shot's clip, and the ledger says so", async (t) => {
  const dir = await project(t);
  const fake = createFakeProvider({ price: 0.05 });
  const starts = new Map();
  const submit = fake.submit;
  fake.submit = async (brief, step, tier, options) => { if (step === "video") starts.set(brief.id, options.startFrame); return submit(brief, step, tier, options); };
  const grabbed = [];
  const frame = async (video, seconds, out) => { grabbed.push({ video, seconds }); await writeFile(out, "png"); };
  const brief = (id, extra = {}) => ({ id, kind: "story", steps: ["image", "video"], image: { prompt: id, negative: "", width: 64, height: 64, references: [] }, video: { prompt: id, audio: "none", seconds: 2, pad_seconds: 0.3, fps: 10, ...extra }, brief_hash: `sha256:${id}` });
  const notes = [];
  const generator = createGenerator({ project: dir, image: fake, video: fake, budget: { usd: 5 }, pollMs: NO_POLL, frame, notice: (line) => notes.push(line) });
  const ask = (id, extra) => generator.findShot({ id, role: "story", storyBrief: brief(id, extra) });
  // c continues from a shot that has no clip in this run: it falls back to its own keyframe.
  const [a, b, c] = await Promise.all([ask("a"), ask("b", { continue_from: "a" }), ask("c", { continue_from: "zzz" })]);
  assert.ok(a && b && c, notes.join("\n"));
  assert.deepEqual(grabbed, [{ video: a.file, seconds: 2.2 }], "the last kept frame: pad + seconds − one frame");
  assert.equal(starts.get("b"), path.join(dir, "assets/shots/generated/b/start-from-a.png"));
  assert.match(starts.get("c"), /image-final-1/);
  assert.match(notes.join("\n"), /c: starts from its own keyframe; zzz has no clip/);
  const videos = (await readLedger(dir)).filter((entry) => entry.step === "video");
  assert.deepEqual(videos.find((entry) => entry.shot === "b").start_frame, { shot: "a", at: 2.2 });
  assert.ok(videos.every((entry) => entry.retained.in === 0.3 && entry.retained.out === 2.3));
  assert.ok(!videos.find((entry) => entry.shot === "a").start_frame);
});
