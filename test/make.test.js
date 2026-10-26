import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DEFAULT_BRAND } from "../kit/core/planning-prompt.mjs";
import { runCli } from "../src/cli.js";
import { runHeadlessCritic } from "../src/make/critic.js";
import { assetErrors, audioEnhancementFeature, formatMakeSummary, runMake, slugify } from "../src/make/index.js";
import { selectMakeModel } from "../src/make/models.js";
import { testVoiceTimings } from "../src/voice/index.js";
import { mediaSkip } from "./helpers/media.js";

const run = promisify(execFile);
const PROMPT = "A 6-second launch video for a fictional SaaS called Ledgerly that reconciles Stripe payouts automatically";
// Within the 6-second clock (16 words at 2.75 a second), so the script checks pass.
const NARRATION = "Payouts never match your books. Ledgerly matches each payout to its invoice. Try Ledgerly free.";

// The storyboard a model would return for NARRATION over the test voice.
function storyboard({ duration, media = "assets/ui.mp4", width = 1920, height = 1080 }) {
  return {
    schema: "launchclip.story.v1",
    title: "Ledgerly",
    lane: "motion",
    format: { width, height, fps: 30, duration },
    brand: DEFAULT_BRAND,
    audio: { words: "NARRATION.json" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: "word:ledgerly", energy: 1, params: { headline: "Payouts never match", emphasis: "never" }, hits: [{ at: "word:never", event: "emphasis-0" }] },
      { id: "s2", module: "media-window", start: "word:ledgerly", end: "word:try", energy: 2, in: { type: "fade", dur: 0.3 }, params: { title: "Ledgerly matches every payout", media: { kind: "video", src: media } } },
      { id: "s3", module: "cta", start: "word:try", end: duration, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Try Ledgerly free" } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    grammar: "editorial",
    ending: { loop_to: "s1" }
  };
}

// A fake model: the script pass returns NARRATION; the storyboard pass first
// references a file that is not in the manifest (a repair), then a valid board.
function fakeModel({ vision = false } = {}) {
  const calls = [];
  const directionCalls = [];
  const usage = { input_tokens: 4000, output_tokens: 800, total_tokens: 4800 };
  let boards = 0;
  const client = {
    provider: "openai",
    async runStructured(request) {
      // The direction-map call returns no map, so make drafts DIRECTION.json from the storyboard.
      if (request.schemaName === "launchclip_direction") { directionCalls.push(request); return { model: "gpt-5.6-luna", value: { direction_json: "" }, usage }; }
      calls.push(request);
      if (request.schemaName === "launchclip_make_script") return { model: "gpt-5.6-luna", value: { title: "Ledgerly", narration: NARRATION }, usage };
      if (request.schemaName === "launchclip_storyboard") {
        boards += 1;
        const duration = Number(/"duration":([\d.]+)/.exec(request.input)[1]);
        const width = Number(/"width":(\d+)/.exec(request.input)[1]);
        const height = Number(/"height":(\d+)/.exec(request.input)[1]);
        const board = storyboard({ duration, width, height, media: boards === 1 ? "assets/missing.png" : "assets/ui.mp4" });
        return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage };
      }
      throw new Error(`unexpected schema ${request.schemaName}`);
    }
  };
  return { calls, directionCalls, model: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision } };
}

async function assetsDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-in-"));
  await writeFile(path.join(dir, "ui.mp4"), "not really a video");
  await writeFile(path.join(dir, "logo.png"), "png");
  await writeFile(path.join(dir, "notes.md"), "Ledgerly reconciles Stripe payouts against invoices.\n");
  return dir;
}

// The inventory the classifier would produce for assetsDir() (the classifier
// itself is covered by make_assets.test.js).
const fakeInventory = async (dir) => ({
  schema_version: "launchclip.make-assets.v1",
  dir,
  entries: [
    { path: "logo.png", kind: "image", role: "logo", confidence: 0.95, signals: ["filename:logo"], description: "Logo image (512×512, transparent)", media: { kind: "image", width: 512, height: 512, alpha: true }, fingerprint: "1" },
    { path: "notes.md", kind: "notes", role: "notes", confidence: 1, signals: ["extension"], description: "Brief notes", text: "Ledgerly reconciles Stripe payouts against invoices.", fingerprint: "2" },
    { path: "ui.mp4", kind: "video", role: "screen-recording", confidence: 0.9, signals: ["ui-look", "no-audio"], description: "Screen recording / product demo (4s, 1280×720, silent)", media: { kind: "video", width: 1280, height: 720, duration: 4, orientation: "landscape", has_audio: false, mountable: true }, speech: { present: false }, fingerprint: "3" }
  ],
  counts: {},
  summary: []
});

// finish stand-in: records its options and returns a report shaped like finish.json.
function fakeFinish(calls) {
  return async (project, options, adapters) => {
    calls.push({ project, options, adapters });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.ok(story.audio.narration?.text || story.base, "finish gets a narrated or footage-led storyboard");
    await mkdir(path.join(project, "renders"), { recursive: true });
    await writeFile(path.join(project, "renders/draft.mp4"), "video");
    return {
      status: "ready-for-review", seconds: 1.5, final: path.join(project, "renders/draft.mp4"), warnings: [],
      stages: ["voice", "validate", "captions", "sound", "render", "master", "evidence", "gates"].map((name) => ({ name, status: "done", seconds: 0.1 })),
      gates: { layout: { status: "passed" }, loudness: { status: "passed" }, motion: { status: "passed" }, audio: { status: "passed" }, temporal_evidence: { status: "passed" }, critic: { status: "pending", reason: "finish does not produce critic receipts" } }
    };
  };
}

test("make runs the motion lane end to end with a fake model, the test voice and a stub finish; reruns reuse the plan", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-cwd-"));
  try {
    const { calls, model } = fakeModel();
    const finishCalls = [];
    const notices = [];
    const adapters = { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish(finishCalls), notice: (line) => notices.push(line) };
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd }, adapters);
    const project = path.join(cwd, `launchclip-${slugify(PROMPT)}`);
    assert.equal(report.project, project);
    assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
    assert.equal(report.routing.lane, "motion");
    assert.deepEqual(report.routing.media.map((item) => item.path), ["ui.mp4"]);
    assert.equal(report.repairs.used, 1, "the unknown asset path was repaired");
    assert.match(report.repairs.attempts[0].errors.join("\n"), /assets\/missing\.png, which is not in the asset manifest/);
    assert.equal(report.critic.status, "pending");
    assert.equal(report.gates.critic.status, "pending");
    assert.equal(report.final, "renders/draft.mp4");
    assert.ok(report.costs.estimated_usd > 0);
    assert.deepEqual(report.costs.items.map((item) => item.stage), ["script", "direction-0", "direction-repair-1", "storyboard-plan-0", "storyboard-repair-1"], "script, the direction map (and its repair), plan and one repair");
    assert.equal(report.profile.id, "short-motion");
    assert.equal(report.direction.source, "drafted");
    assert.ok(notices.some((line) => /PAID call to openai gpt-5\.6-luna \(script pass/.test(line)));
    for (const file of ["MAKE.json", "ASSETS.json", "BRIEF.md", "SCRIPT.json", "NARRATION.json", "storyboard.json", "DIRECTION.json", "assets/ui.mp4", "assets/logo.png"]) assert.ok(existsSync(path.join(project, file)), file);
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.deepEqual(story.audio.narration, { text: NARRATION, provider: "test" });
    assert.equal(story.lane, "motion");
    assert.equal(story.ending, undefined, "a 16:9 video does not loop back to its hook");
    assert.deepEqual(story.motion, { grammar: "editorial" });
    assert.equal(story.grammar, undefined);
    const expected = Math.round((testVoiceTimings(NARRATION).duration + 0.8) * 10) / 10;
    assert.equal(story.format.duration, expected);
    assert.deepEqual(finishCalls[0].options, { renderer: "remotion", quality: "draft", music: "synth" });
    const brief = await readFile(path.join(project, "BRIEF.md"), "utf8");
    assert.match(brief, /assets\/ui\.mp4 — video, screen-recording/);
    assert.match(brief, /Ledgerly reconciles Stripe payouts/);
    assert.match(brief, /## Facts/);
    assert.match(formatMakeSummary(report), /launchclip make: ready-for-review \(motion lane/);

    // Rerun: script and storyboard are reused, no model calls.
    const before = calls.length;
    const again = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd }, adapters);
    assert.equal(calls.length, before);
    assert.equal(again.stages.storyboard.status, "cached");
    assert.equal(again.script.reused, true);
    // --replan: a new storyboard (the script is still reused).
    await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, replan: true }, adapters);
    assert.equal(calls.filter((call) => call.schemaName === "launchclip_make_script").length, 1);
    assert.ok(calls.filter((call) => call.schemaName === "launchclip_storyboard").length > 2);
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

// Collections RFC phase 1: inside a library, a project without --out goes
// under storage.projects, and the library folder (the cwd) gets nothing.
test("make inside a library puts the project under storage.projects and leaves the library folder alone", async () => {
  const assets = await assetsDir();
  const libraryDir = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-library-"));
  const storage = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-storage-"));
  try {
    const { initLibrary, loadLibrary } = await import("../src/library.js");
    await initLibrary(libraryDir, { projects: storage, minFreeGb: 0 });
    const cwd = path.join(libraryDir, "acme");
    await mkdir(cwd);
    const library = await loadLibrary({ cwd, env: {} });
    const { model } = fakeModel();
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, library }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice() {} });
    assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
    assert.equal(report.project, path.join(storage, `launchclip-${slugify(PROMPT)}`));
    assert.equal(report.library, library.file);
    assert.ok(existsSync(path.join(report.project, "storyboard.json")));
    assert.deepEqual((await readdir(libraryDir)).sort(), ["acme", "launchclip.library.json"]);
    assert.deepEqual(await readdir(cwd), []);
    // --out still wins.
    const out = path.join(cwd, "here");
    const again = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, library, out }, { env: {}, client: fakeModel().model, inventory: fakeInventory, finish: fakeFinish([]), notice() {} });
    assert.equal(again.project, out);
  } finally {
    for (const dir of [assets, libraryDir, storage]) await rm(dir, { recursive: true, force: true });
  }
});

test("make inside a library refuses to start on an unmounted drive", async () => {
  const library = { file: "/lib/launchclip.library.json", storage: { projects: `/Volumes/launchclip-missing-${process.pid}/projects`, min_free_gb: 0 } };
  await assert.rejects(runMake(PROMPT, { voice: "test", library }, { env: {}, client: fakeModel().model, notice() {} }), (error) => {
    assert.equal(error.code, "LAUNCHCLIP_STORAGE");
    assert.match(error.message, /^storage\.projects: \/Volumes\/launchclip-missing-\d+ is not mounted/);
    return true;
  });
});

test("make stops with one clear line when its project folder disappears mid-job", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-cwd-"));
  try {
    const finish = async (project) => {
      await rm(project, { recursive: true, force: true });
      throw new Error(`ENOENT: no such file or directory, open '${project}/renders/draft.mp4'`);
    };
    await assert.rejects(runMake(PROMPT, { assets, voice: "test", music: "synth", cwd }, { env: {}, client: fakeModel().model, inventory: fakeInventory, finish, notice() {} }),
      /StorageError: launchclip make stopped during finish: .* disappeared\. Reconnect it and run the same command again/);
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

// The script pass first returns a script that fails the checks (a greeting,
// an invented user count); the repair pass returns NARRATION unless `stuck`.
function scriptRepairModel({ stuck = false } = {}) {
  const fake = fakeModel();
  const inner = fake.model.client.runStructured.bind(fake.model.client);
  const scriptRequests = [];
  fake.model.client.runStructured = async (request) => {
    if (request.schemaName !== "launchclip_make_script") return inner(request);
    scriptRequests.push(request);
    const narration = scriptRequests.length === 1 || stuck ? "Hey there, Ledgerly is trusted by 10,000 teams. Try Ledgerly free." : NARRATION;
    return { model: "gpt-5.6-luna", value: { title: "Ledgerly", narration }, usage: { input_tokens: 4000, output_tokens: 800 } };
  };
  return { ...fake, scriptRequests };
}

test("make runs the script checks after the script pass and repairs errors once", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-check-"));
  try {
    const { model, scriptRequests } = scriptRepairModel();
    const notices = [];
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice: (line) => notices.push(line) });
    assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
    assert.equal(scriptRequests.length, 2, "one write and one repair");
    assert.deepEqual(report.costs.items.slice(0, 2).map((item) => item.stage), ["script", "script-repair"]);
    const repair = scriptRequests[1].input;
    assert.match(repair, /## Repair/);
    assert.match(repair, /\[opener-filler\]/);
    assert.match(repair, /\[fact-trace\] "10,000" is not in the brief/);
    assert.match(repair, /\[social-proof\]/);
    assert.match(repair, /Previous narration:\n\nHey there, Ledgerly is trusted by 10,000 teams/);
    assert.equal(scriptRequests[1].instructions, scriptRequests[0].instructions, "the repair writes against the same plan");
    assert.deepEqual(scriptRequests[1].schema.required, ["title", "narration", "title_options", "beats"]);
    assert.ok(notices.some((line) => /script check error\(s\) \(fact-trace, social-proof, opener-filler\); one repair pass/.test(line)), notices.join("\n"));
    const script = JSON.parse(await readFile(path.join(report.project, "SCRIPT.json"), "utf8"));
    assert.deepEqual(script.passes.map((pass) => pass.kind), ["write", "repair"]);
    assert.deepEqual(script.passes[1].errors, ["fact-trace", "social-proof", "opener-filler"]);
    assert.equal(script.narration, NARRATION);
    assert.equal(script.check.schema_version, "launchclip.script-check.v1");
    assert.equal(script.plan.format, "promo");
    assert.equal(script.check.stats.format, script.plan.format, "the check uses the plan's format");
    assert.equal(report.script.plan.format, "promo");
    assert.equal(script.check.ok, true);
    assert.equal(report.script.check.ok, true);
    assert.deepEqual(report.script.check.errors, []);
    assert.ok(!report.warnings.some((line) => /script check/.test(line)));
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("errors left after the one repair pass are a warning, not a failure", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-check-"));
  try {
    const { model, scriptRequests } = scriptRepairModel({ stuck: true });
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice() {} });
    assert.equal(scriptRequests.filter((request) => request.input.includes("## Repair")).length, 1, "never more than one repair pass");
    assert.equal(report.script.check.ok, false);
    assert.deepEqual(report.script.check.errors, ["fact-trace", "social-proof", "opener-filler"]);
    assert.ok(report.warnings.some((line) => /^the script still fails 3 script check\(s\): fact-trace: "10,000" is not in the brief/.test(line)), report.warnings.join("\n"));
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a bare-prompt make uses a seeded style, keeps it on reruns, and --seed picks the look", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-seed-"));
  try {
    const { model } = fakeModel();
    const notices = [];
    // No logo and no brand.json: nothing says what the video should look like.
    const inventory = async (dir) => { const base = await fakeInventory(dir); return { ...base, entries: base.entries.filter((entry) => entry.role !== "logo") }; };
    const adapters = { env: {}, client: model, inventory, finish: fakeFinish([]), notice: (line) => notices.push(line), clock: () => "2026-10-26T00:00:00.000Z" };
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "bare" }, adapters);
    assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
    assert.equal(report.style.source, "generated");
    assert.match(report.style.name, /^seed-[0-9a-f]{8}$/);
    const project = path.join(cwd, "bare");
    const pack = JSON.parse(await readFile(path.join(project, ".launchclip", "styles", report.style.name, "style.json"), "utf8"));
    assert.equal(pack.generated.seed, report.style.seed);
    assert.equal(pack.generated.tone, "energetic", "the prompt's launch wording sets the tone");
    assert.match(report.style.summary, new RegExp(`^seed ${report.style.seed} \\(`));
    assert.ok(notices.includes(`style: ${report.style.summary}. Reroll with launchclip style reroll`), notices.join("\n"));
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.equal(story.style, report.style.name);
    assert.deepEqual(story.brand, pack.brand);
    assert.equal(story.motion.grammar, pack.motion.grammar, "the pack's grammar wins over the planner's");
    assert.deepEqual(story.overlays.find((overlay) => overlay.type === "captions").preset, pack.captions.preset);

    // A rerun keeps the project's look.
    const again = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "bare" }, adapters);
    assert.equal(again.style.name, report.style.name);
    assert.equal(again.stages.storyboard.status, "cached");

    // --seed picks exactly that look; --style and --seed together are refused.
    const seeded = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "seeded", seed: "7f3a91c2" }, adapters);
    assert.equal(seeded.style.name, "seed-7f3a91c2");
    await assert.rejects(runMake(PROMPT, { assets, voice: "test", cwd, seed: "7f3a91c2", style: "editorial-dark" }, adapters), /--seed or --style, not both/);
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("make routes footage to footage-led and uses the base edit's output and words", async () => {
  const assets = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-footage-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-out-"));
  try {
    await writeFile(path.join(assets, "founder.mp4"), "recording");
    const words = ["Ledgerly", "matches", "every", "payout", "automatically.", "Try", "it", "today."].map((text, i) => ({ word: text, start: 0.3 + i * 0.5, end: 0.7 + i * 0.5 }));
    const inventory = async (dir) => ({ dir, entries: [{ path: "founder.mp4", kind: "video", role: "talking-head", confidence: 0.9, signals: ["camera-look"], description: "Talking-head recording", media: { kind: "video", width: 720, height: 1280, duration: 6, orientation: "portrait", mountable: true }, speech: { present: true }, transcript: { text: "x", words: words.map((w) => ({ text: w.word, start: w.start, end: w.end })) }, fingerprint: "1" }], counts: {}, summary: [] });
    const recordings = [];
    const prepareRecording = async (input, options) => {
      recordings.push({ input, options });
      await mkdir(options.out, { recursive: true });
      await writeFile(path.join(options.out, "base-edit.mp4"), "edited");
      await writeFile(path.join(options.out, "transcript.json"), JSON.stringify({ words, duration_seconds: 4.4 }));
      return { status: "ready", output: path.join(options.out, "base-edit.mp4"), duration_seconds: 4.4, rendered_duration_seconds: 4.4, source_duration_seconds: 6, files: { transcript: path.join(options.out, "transcript.json") }, manifest: path.join(options.out, "recording.json") };
    };
    const client = {
      provider: "openai",
      async runStructured(request) {
        if (request.schemaName === "launchclip_direction") return { model: "gpt-5.6-luna", value: { direction_json: "" }, usage: { input_tokens: 1, output_tokens: 1 } };
        assert.equal(request.schemaName, "launchclip_storyboard", "footage-led has no script pass");
        assert.match(request.input, /base: "assets\/base-edit\.mp4"/);
        const board = { schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1080, height: 1920, fps: 30, duration: 4.4 }, brand: DEFAULT_BRAND, audio: { words: "NARRATION.json" }, base: "assets/base-edit.mp4",
          scenes: [{ id: "c1", module: "emphasis-caption", track: 1, start: "word:every", end: "word:try", params: { text: "Every payout" } }],
          overlays: [{ type: "captions", style: "word-highlight" }] };
        return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage: { input_tokens: 10, output_tokens: 10 } };
      }
    };
    const finishCalls = [];
    const report = await runMake("Dress my founder clip", { assets, out, voice: "test" }, { env: {}, client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, inventory, prepareRecording, finish: fakeFinish(finishCalls), notice() {} });
    assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
    assert.equal(report.routing.lane, "footage-led");
    assert.equal(report.routing.aspect, "9:16");
    assert.equal(recordings.length, 1);
    assert.equal(report.base_edit.status, "ready");
    assert.equal(report.base_edit.edited_seconds, 4.4);
    assert.equal(typeof report.base_edit.enhancement.available, "boolean");
    const story = JSON.parse(await readFile(path.join(out, "storyboard.json"), "utf8"));
    assert.equal(story.base, "assets/base-edit.mp4");
    assert.equal(story.audio.narration, undefined);
    const narration = JSON.parse(await readFile(path.join(out, "NARRATION.json"), "utf8"));
    assert.equal(narration.words[0].text, "Ledgerly");
    assert.ok(existsSync(path.join(out, "assets/base-edit.mp4")));
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("a base edit that needs semantic review uses the candidate edit and leaves a pending base_edit_qa gate", async () => {
  const assets = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-review-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-review-out-"));
  try {
    await writeFile(path.join(assets, "founder.mp4"), "recording");
    const words = ["Ledgerly", "matches", "every", "payout", "today."].map((text, i) => ({ word: text, start: 0.3 + i * 0.5, end: 0.7 + i * 0.5 }));
    const inventory = async (dir) => ({ dir, entries: [{ path: "founder.mp4", kind: "video", role: "talking-head", confidence: 0.9, signals: ["camera-look"], description: "Talking-head recording", media: { kind: "video", width: 720, height: 1280, duration: 4, orientation: "portrait", mountable: true }, speech: { present: true }, transcript: { text: "x", words: [] }, fingerprint: "1" }], counts: {}, summary: [] });
    const prepareRecording = async (input, options) => {
      const attempt = path.join(options.out, "qa/attempt-1");
      await mkdir(attempt, { recursive: true });
      await writeFile(path.join(attempt, "video.mp4"), "candidate");
      await writeFile(path.join(attempt, "plan.json"), JSON.stringify({ words, duration_seconds: 3.2 }));
      return { status: "needs-semantic-review", candidate: path.join(attempt, "video.mp4"), source_duration_seconds: 4, duration_seconds: 3.2, files: { plan: path.join(attempt, "plan.json") }, qa: { issues: [{ kind: "unconfirmed-boundary", start_seconds: 1.2, explanation: "No verified quiet separator was found. Review it." }] } };
    };
    const client = { provider: "openai", async runStructured() {
      const board = { schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1080, height: 1920, fps: 30, duration: 3.2 }, brand: DEFAULT_BRAND, audio: { words: "NARRATION.json" }, base: "assets/base-edit.mp4",
        scenes: [{ id: "c1", module: "emphasis-caption", track: 1, start: "word:every", end: "word:today", params: { text: "Every payout" } }], overlays: [{ type: "captions", style: "word-highlight" }] };
      return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage: {} };
    } };
    const report = await runMake("Dress my clip", { assets, out, voice: "test" }, { env: {}, client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, inventory, prepareRecording, finish: fakeFinish([]), notice() {} });
    assert.equal(report.base_edit.status, "candidate");
    assert.equal(await readFile(path.join(out, "assets/base-edit.mp4"), "utf8"), "candidate");
    assert.equal(report.gates.base_edit_qa.status, "pending");
    assert.match(report.gates.base_edit_qa.issues[0], /unconfirmed-boundary @1\.2s: No verified quiet separator was found/);
    assert.equal(report.status, "ready-for-review");
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});

test("a failing stage is reported with the next step, and the CLI exits non-zero", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-fail-"));
  try {
    const report = await runMake("A video", { out, voice: "test" }, { env: {}, notice() {} });
    assert.equal(report.status, "failed");
    assert.equal(report.failed_stage, "model");
    assert.match(report.next_steps[0], /OPENAI_API_KEY or ANTHROPIC_API_KEY/);
    assert.ok(existsSync(path.join(out, "MAKE.json")));
    const stdout = { text: "", write(chunk) { this.text += chunk; } };
    const stderr = { write() {} };
    const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, LAUNCHCLIP_MAKE_MODEL: process.env.LAUNCHCLIP_MAKE_MODEL };
    for (const key of Object.keys(saved)) delete process.env[key];
    try {
      await assert.rejects(runCli(["make", "A video", "--out", out], { stdout, stderr }), /launchclip make failed at the model stage/);
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
    }
    assert.match(stdout.text, /launchclip make: failed/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("model selection, asset checks and the enhancement feature check", async () => {
  assert.deepEqual(selectMakeModel("anthropic:claude-opus-4-8", {}), { spec: "anthropic:claude-opus-4-8", source: "--model" });
  assert.equal(selectMakeModel(undefined, { LAUNCHCLIP_MAKE_MODEL: "openrouter:a/b" }).spec, "openrouter:a/b");
  assert.equal(selectMakeModel(undefined, { OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" }).spec, "openai:gpt-5.6-luna");
  assert.equal(selectMakeModel(undefined, { ANTHROPIC_API_KEY: "y" }).spec, "anthropic:claude-opus-4-8");
  assert.throws(() => selectMakeModel(undefined, {}), /needs a model/);
  const errors = assetErrors({ scenes: [{ params: { media: { src: "assets/a.png" } } }, { params: { media: { src: "assets/ok.png" } } }] }, new Set(["assets/ok.png"]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /scenes\[0\]\.params\.media\.src references assets\/a\.png/);
  const feature = await audioEnhancementFeature();
  assert.equal(typeof feature.available, "boolean");
});

test("the headless critic writes qa/critic.json citing manifest evidence ids", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-critic-"));
  try {
    await mkdir(path.join(project, "qa/temporal-evidence"), { recursive: true });
    await mkdir(path.join(project, "qa/critic-sheets"), { recursive: true });
    const entries = ["hook-001", "hook-002"].flatMap((sample, i) => ["browser-still", "encoded-draft"].map((source) => ({ sample_id: sample, evidence_id: `${sample}-${source}`, source, role: "hook", at_seconds: i * 0.5 })));
    await writeFile(path.join(project, "qa/temporal-evidence/manifest.json"), JSON.stringify({ entries }));
    await writeFile(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets: [{ sheet: "sheet-01.jpg", samples: ["hook-001", "hook-002"] }] }));
    await writeFile(path.join(project, "qa/critic-sheets/sheet-01.jpg"), "jpg");
    const requests = [];
    const client = { provider: "openai", async runStructured(request) { requests.push(request); return { model: "gpt-5.6-luna", value: { verdict: "ship", summary: "Clean.", findings: [{ id: "f1", severity: "major", category: "typography", message: "Headline clipped.", evidence_ids: ["hook-001", "nope"] }] }, usage: { input_tokens: 1000, output_tokens: 100 } }; } };
    const result = await runHeadlessCritic({ project, client, model: "gpt-5.6-luna", provider: "openai" });
    assert.equal(result.status, "written");
    assert.equal(result.verdict, "repair", "ship with a major finding is recorded as repair");
    assert.equal(requests[0].images.length, 1);
    assert.match(requests[0].input, /hook-001-browser-still/);
    const critique = JSON.parse(await readFile(path.join(project, "qa/critic.json"), "utf8"));
    assert.deepEqual(critique.evidence_ids_reviewed.sort(), entries.map((entry) => entry.evidence_id).sort());
    assert.deepEqual(critique.findings[0].evidence_ids, ["hook-001-browser-still", "hook-001-encoded-draft"]);
    assert.ok(result.warnings.some((line) => /unknown evidence id nope/.test(line)));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

async function chromeAvailable() {
  try {
    await run("ffmpeg", ["-version"]);
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

test("end to end: make renders a real Remotion draft with a fake model, the test voice and the synth bed", { skip: mediaSkip(), timeout: 900_000 }, async (t) => {
  const missing = process.env.LAUNCHCLIP_SKIP_REMOTION === "1" ? "LAUNCHCLIP_SKIP_REMOTION=1" : await chromeAvailable();
  if (missing) { t.skip(`Chrome Headless Shell or FFmpeg is unavailable: ${missing}`); return; }
  const assets = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-e2e-in-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-e2e-out-"));
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=1280x720:r=30", "-t", "4", "-pix_fmt", "yuv420p", path.join(assets, "ui.mp4")]);
    const { model } = fakeModel();
    const report = await runMake(PROMPT, { assets, out, voice: "test", music: "synth", renderer: "remotion" }, { env: {}, client: model, transcribe: async () => null, notice() {} });
    t.diagnostic(`make took ${report.timings.total}s: ${Object.entries(report.timings).map(([name, s]) => `${name} ${s}s`).join(", ")}`);
    assert.notEqual(report.status, "failed", JSON.stringify({ stages: report.stages, next: report.next_steps }));
    assert.equal(report.routing.lane, "motion");
    assert.equal(report.final, "renders/draft.mp4");
    const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "json", path.join(out, "renders/draft.mp4")])).stdout);
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
    assert.equal(probe.streams.find((stream) => stream.codec_type === "video").width, 1920);
    assert.equal(report.gates.temporal_evidence.status, "passed", JSON.stringify(report.gates));
    assert.equal(report.gates.critic.status, "pending");
    assert.ok(existsSync(path.join(out, "qa/critic-sheets/index.json")));
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
