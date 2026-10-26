import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const RULES = "Audience: finance leads. Never claim Ledgerly is SOC 2 certified. Avoid the word 'seamless'.";

test("make follows a collection's rules in the script pass, the brief and the critic, and joins its brand folder to the assets", async () => {
  const assets = await assetsDir();
  const brand = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-brand-"));
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-rules-"));
  try {
    await writeFile(path.join(brand, "mark.png"), "png");
    await writeFile(path.join(brand, "intro.mp4"), "not a video");
    const brandInventory = async (dir) => ({
      schema_version: "launchclip.make-assets.v1", dir, counts: {}, summary: [],
      entries: [
        { path: "mark.png", kind: "image", role: "logo", confidence: 0.95, signals: ["filename"], description: "Logo image (512×512, transparent)", media: { kind: "image", width: 512, height: 512, alpha: true }, fingerprint: "b1" },
        { path: "intro.mp4", kind: "video", role: "screen-recording", confidence: 0.9, signals: [], description: "Intro clip", media: { kind: "video", width: 1920, height: 1080, duration: 3, mountable: true }, speech: { present: false }, fingerprint: "b2" }
      ]
    });
    const inventory = (dir) => (dir === brand ? brandInventory(dir) : fakeInventory(dir));
    const { calls, model } = fakeModel({ vision: true });
    const criticCalls = [];
    const critic = async (args) => { criticCalls.push(args); return { status: "written", verdict: "ship", findings: 0, reviewed: [], unreviewed: [], warnings: [], model: "gpt-5.6-luna" }; };
    const report = await runMake(PROMPT, { assets, brandAssets: brand, rules: `\n${RULES}\n`, voice: "test", voiceId: "af_heart", music: "synth", cwd, out: "video" }, { env: {}, client: model, inventory, finish: fakeFinish([]), critic, notice() {} });
    assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
    const project = path.join(cwd, "video");

    const script = calls.find((call) => call.schemaName === "launchclip_make_script");
    assert.match(script.input, /## Rules \(the collection's own rules/);
    assert.ok(script.input.includes(RULES));
    const brief = await readFile(path.join(project, "BRIEF.md"), "utf8");
    assert.ok(brief.includes(RULES), "the planner's brief carries the rules");
    assert.ok(calls.find((call) => call.schemaName === "launchclip_storyboard").input.includes(RULES));
    assert.equal(criticCalls[0].rules, RULES);

    // The brand folder's logo joins the inventory; its video never decides the lane.
    const inventoryDoc = JSON.parse(await readFile(path.join(project, "ASSETS.json"), "utf8"));
    assert.ok(inventoryDoc.entries.some((entry) => entry.path === "collection-brand/mark.png" && entry.source === "brand-assets"));
    assert.ok(!inventoryDoc.entries.some((entry) => entry.path === "collection-brand/intro.mp4"));
    assert.ok(existsSync(path.join(project, "assets/collection-brand/mark.png")));
    assert.deepEqual(report.routing.media.map((item) => item.path), ["ui.mp4"]);
    assert.ok(report.routing.logos.some((item) => item.path === "collection-brand/mark.png"));
    assert.equal(report.assets.brand_assets, 1);

    // The collection's voice id reaches the narration.
    assert.equal(report.options.voice_id, "af_heart");
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    assert.equal(story.audio.narration.voice, "af_heart");
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(brand, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
