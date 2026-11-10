import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { describeInventory, featuredAssets, featuredPrompt, localDescription, movingWindows, unusedFeatured } from "../src/asset_understanding.js";
import { mediaNotesLine, normalizeNotes } from "../src/inventory_notes.js";
import { runMake } from "../src/make/index.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const image = (file, extra = {}) => ({ path: file, kind: "image", role: "screenshot", description: "Screenshot (1920×1080) of the product UI to show in a media window", media: { kind: "image", width: 1920, height: 1080 }, ...extra });
const video = (file, extra = {}) => ({ path: file, kind: "video", role: "screen-recording", description: "Screen recording / product demo (12s, 1080×1920, silent)", media: { kind: "video", width: 1080, height: 1920, duration: 12 }, ...extra });

async function folder(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-understanding-"));
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body);
  return dir;
}

const quiet = { motion: async () => null, ocr: async () => null };

test("normalizeNotes takes shows, text, fits and feature, and the planner's line says them", () => {
  const { notes, warnings } = normalizeNotes({ shows: " Pricing  Page ", text: ["Pro $29/mo", "Start free"], fits: ["the price line"], feature: true }, "pricing.png.json");
  assert.deepEqual(notes, { shows: "pricing page", text: ["Pro $29/mo", "Start free"], fits: ["the price line"], feature: true });
  assert.deepEqual(warnings, []);
  assert.equal(mediaNotesLine({ notes }), ` Notes from the app: a pricing page; on-screen text "Pro $29/mo", "Start free"; fits the price line; the user wants this one in the video.`);
  assert.match(mediaNotesLine({ notes, understanding: { source: "vision" } }), /^ What it shows \(a vision model looked at it\): a pricing page/);
  assert.match(mediaNotesLine({ notes, understanding: { source: "local" } }), /guessed from the file name and frames/);
  assert.match(normalizeNotes({ shows: 3, feature: "yes" }, "x").warnings.join("\n"), /x\.shows must be a few words[\s\S]*x\.feature must be true or false/);
});

test("localDescription reads the file name, the words on screen, the role and the shape", () => {
  const pricing = localDescription(image("screens/pricing-plans.png"));
  assert.equal(pricing.shows, "pricing page");
  assert.deepEqual(pricing.fits, ["the price or offer line", "the call to action"]);
  assert.equal(pricing.orientation, "landscape");
  assert.match(pricing.description, /from its file name; not looked at by a model/);
  // The name says nothing; the words Tesseract read do.
  const read = localDescription(image("IMG_0042.png"), { text: ["Weekly active users", "Dashboard", "|", "~~"] });
  assert.equal(read.shows, "dashboard");
  assert.deepEqual(read.text, ["Weekly active users", "Dashboard"]);
  // Nothing to go on: the inventory's role.
  assert.equal(localDescription(image("IMG_0042.png")).shows, "app screen");
  assert.equal(localDescription(image("hero.jpg", { role: "product-image" })).shows, "landing page");
  assert.equal(localDescription(image("IMG_1.jpg", { role: "product-image" })).shows, "product photo");
  // A person on camera stays one, whatever the file is called.
  const head = localDescription(video("pricing-chat.mp4", { role: "talking-head" }));
  assert.equal(head.shows, "person on camera");
  assert.equal(head.people, true);
});

test("a clip's useful ranges are where something moves, and none when it moves throughout", () => {
  assert.deepEqual(movingWindows({ moving_spans: [[0, 0.5], [3, 7.25], [9, 12]] }, 12), [{ start: 3, end: 7.25, note: "something moves on screen" }, { start: 9, end: 12, note: "something moves on screen" }]);
  assert.deepEqual(movingWindows({ moving_spans: [[0, 11.5]] }, 12), []);
  assert.deepEqual(movingWindows(null, 12), []);
  const clip = localDescription(video("onboarding-demo.mp4"), { motion: { moving_spans: [[2, 6]], duration: 12 } });
  assert.equal(clip.shows, "onboarding flow");
  assert.match(clip.description, /^A clip that looks like an onboarding flow /);
  assert.deepEqual(clip.windows, [{ start: 2, end: 6, note: "something moves on screen" }]);
  assert.equal(clip.orientation, "portrait");
});

test("describeInventory: the caller's notes win, the model describes the rest once per content, and no model means a local guess", async () => {
  const dir = await folder({ "pricing.png": "A", "IMG_7.png": "B", "walk.mp4": "C", "logo.png": "L" });
  const cacheDir = path.join(dir, ".cache");
  const entries = () => [
    image("pricing.png", { notes: { description: "Our three plans", feature: true } }),
    image("IMG_7.png", { notes: { tags: ["q3"] } }),
    video("walk.mp4"),
    { path: "logo.png", kind: "image", role: "logo", description: "Logo image" }
  ];
  const calls = [];
  const client = {
    async runStructured(request) {
      calls.push(request);
      const isVideo = /walk\.mp4/.test(request.input);
      return { value: { shows: isVideo ? "Onboarding flow" : "Dashboard", description: isVideo ? "A new user sets up a workspace." : "A dashboard of weekly revenue.", text: isVideo ? [] : ["Revenue", "$12,480"], fits: ["how it works"], people: false, windows: isVideo ? [{ start: 1.2, end: 7.8, note: "types a workspace name" }, { start: 10, end: 99, note: "past the end" }] : [{ start: 0, end: 1, note: "not a video" }] }, usage: { input_tokens: 900, output_tokens: 80 }, model: "seer-1" };
    }
  };
  const adapters = { ...quiet, images: async (file, entry) => ({ images: [{ url: "data:image/jpeg;base64,AA==", detail: "low" }], times: entry.kind === "video" ? [1.2] : [0] }) };
  try {
    const inventory = { dir, entries: entries() };
    const first = await describeInventory(inventory, { client, vision: true, model: "openai:seer-1", cacheDir, adapters });
    assert.deepEqual(first.counts, { notes: 1, vision: 2, local: 0 });
    assert.equal(calls.length, 2, "one call per file the caller did not describe; none for the logo");
    assert.equal(first.results.length, 2);
    const [pricing, shot, walk, logo] = inventory.entries;
    assert.deepEqual(pricing.understanding, { source: "notes" });
    assert.deepEqual(pricing.notes, { description: "Our three plans", feature: true });
    // The model's fields sit under the caller's own.
    assert.deepEqual(shot.notes, { shows: "dashboard", description: "A dashboard of weekly revenue.", text: ["Revenue", "$12,480"], fits: ["how it works"], people: false, orientation: "landscape", tags: ["q3"] });
    assert.equal(shot.understanding.source, "vision");
    assert.equal(shot.understanding.model, "seer-1");
    assert.match(shot.understanding.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(walk.notes.windows, [{ start: 1.2, end: 7.8, note: "types a workspace name" }]);
    assert.equal(logo.understanding, undefined);
    assert.match(calls[1].input, /You see 1 frames, taken at 1\.2 s/);
    assert.equal((await readdir(cacheDir)).length, 2);

    // Same content again, even with no model at all: the cached description, no call.
    const again = { dir, entries: entries() };
    const second = await describeInventory(again, { cacheDir, adapters: quiet });
    assert.equal(calls.length, 2);
    assert.deepEqual(second.described.map((item) => [item.source, item.cached]), [["notes", false], ["vision", true], ["vision", true]]);
    assert.equal(again.entries[1].notes.shows, "dashboard");

    // local never uses the model's description; off touches nothing.
    const local = { dir, entries: entries() };
    const third = await describeInventory(local, { mode: "local", client, vision: true, cacheDir, adapters: quiet });
    assert.deepEqual(third.counts, { notes: 1, vision: 0, local: 2 });
    assert.equal(local.entries[1].notes.shows, "app screen");
    assert.equal(local.entries[1].understanding.source, "local");
    const off = { dir, entries: entries() };
    assert.deepEqual((await describeInventory(off, { mode: "off", client, vision: true, cacheDir })).described, []);
    assert.deepEqual(off.entries[1].notes, { tags: ["q3"] });
    assert.equal(calls.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("describeInventory falls back to a local guess when the model fails, and past the per-run limit", async () => {
  const dir = await folder({ "a-dashboard.png": "1", "b-pricing.png": "2", "c.png": "3" });
  try {
    const inventory = { dir, entries: [image("a-dashboard.png"), image("b-pricing.png"), image("c.png")] };
    let calls = 0;
    const client = { async runStructured() { calls += 1; if (calls === 1) throw new Error("429 rate limited\nretry later"); return { value: { shows: "pricing page", description: "Three plans.", text: [], fits: [], people: false, windows: [] } }; } };
    const result = await describeInventory(inventory, { client, vision: true, limit: 2, cacheDir: path.join(dir, ".cache"), adapters: { ...quiet, images: async () => ({ images: [{ url: "data:image/jpeg;base64,AA==" }], times: [0] }) } });
    assert.deepEqual(inventory.entries.map((entry) => [entry.understanding.source, entry.notes.shows]), [["local", "dashboard"], ["vision", "pricing page"], ["local", "app screen"]]);
    assert.equal(calls, 2);
    assert.match(result.warnings.join("\n"), /could not describe a-dashboard\.png \(429 rate limited\)[\s\S]*more than 2 files to describe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("describeInventory stops asking a model that keeps failing", async () => {
  const dir = await folder({ "a.png": "1", "b.png": "2", "c.png": "3", "d.png": "4" });
  try {
    const inventory = { dir, entries: ["a.png", "b.png", "c.png", "d.png"].map((file) => image(file)) };
    let calls = 0;
    const client = { async runStructured() { calls += 1; throw new Error("401 Incorrect API key"); } };
    const result = await describeInventory(inventory, { client, vision: true, cacheDir: path.join(dir, ".cache"), adapters: { ...quiet, images: async () => ({ images: [{ url: "data:image/jpeg;base64,AA==" }], times: [0] }) } });
    assert.equal(calls, 2, "two failures in a row and the rest are not sent");
    assert.deepEqual(result.counts, { notes: 0, vision: 0, local: 4 });
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0], /could not describe a\.png \(401 Incorrect API key\)/);
    assert.match(result.warnings[1], /the model failed again on b\.png; the remaining files are described from their names and frames/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("describeInventory asks about several files at once and writes what asking one at a time writes", async () => {
  const names = ["a.png", "b.png", "c.png", "d.png", "e.png", "twin-of-a.png"];
  const describe = async (concurrency, { failing = false } = {}) => {
    const dir = await folder(Object.fromEntries(names.map((name, index) => [name, name.startsWith("twin") ? "0" : String(index)])));
    try {
      const inventory = { dir, entries: names.map((file) => image(file)) };
      const order = [];
      let inFlight = 0;
      let peak = 0;
      const client = {
        async runStructured(request) {
          const file = /File: (\S+)/.exec(request.input)[1];
          order.push(file);
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          // Later files answer sooner, so answers arrive out of order.
          await new Promise((resolve) => setTimeout(resolve, 30 - names.indexOf(file) * 5));
          inFlight -= 1;
          if (failing && ["b.png", "c.png"].includes(file)) throw new Error("503 the model is down");
          return { value: { shows: `screen ${file}`, description: `What ${file} shows.`, text: [], fits: [], people: false, windows: [] }, usage: { input_tokens: 900, output_tokens: 80 }, model: "seer-1" };
        }
      };
      const result = await describeInventory(inventory, { client, vision: true, concurrency, cacheDir: path.join(dir, ".cache"), adapters: { ...quiet, images: async () => ({ images: [{ url: "data:image/jpeg;base64,AA==" }], times: [0] }) } });
      return { result, order, peak, entries: inventory.entries.map((entry) => ({ path: entry.path, notes: entry.notes, understanding: entry.understanding })) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const one = await describe(1);
  const four = await describe(4);
  assert.equal(one.peak, 1);
  assert.equal(four.peak, 4);
  assert.deepEqual(four.order, one.order, "the files are asked about in the same order");
  assert.deepEqual(four.order, ["a.png", "b.png", "c.png", "d.png", "e.png"], "the twin's bytes are a.png's: it is never sent");
  assert.deepEqual(four.entries, one.entries);
  assert.deepEqual(four.result, one.result);
  assert.deepEqual(four.entries.at(-1).understanding.cached, true, "the twin takes a.png's description from the cache, as it does one at a time");

  // Two failures in a row stop the asking. Calls already started ahead are not used: the result is the same.
  const oneDown = await describe(1, { failing: true });
  const fourDown = await describe(4, { failing: true });
  assert.deepEqual(oneDown.order, ["a.png", "b.png", "c.png"]);
  assert.deepEqual(fourDown.order, ["a.png", "b.png", "c.png", "d.png", "e.png"], "d and e were already in flight when c failed");
  assert.deepEqual(fourDown.entries, oneDown.entries);
  assert.deepEqual({ ...fourDown.result, results: fourDown.result.results.length }, { ...oneDown.result, results: oneDown.result.results.length + 2 }, "the two unused answers are dropped, and their cost is still counted");
  assert.deepEqual(fourDown.entries.map((entry) => entry.understanding.source), ["vision", "local", "local", "local", "local", "vision"]);
});

test("featuredAssets: the notes, a file the prompt names, the one file that is what the prompt asks to show, or a handful handed in", () => {
  const many = [
    { src: "assets/pricing.png", kind: "image", notes: { shows: "pricing page" } },
    { src: "assets/dash-1.png", kind: "image", notes: { shows: "dashboard" } },
    { src: "assets/dash-2.png", kind: "image", notes: { shows: "dashboard" } },
    { src: "assets/team offsite.jpg", kind: "image" },
    { src: "assets/hero.mp4", kind: "video", notes: { feature: true } },
    { src: "assets/song.mp3", kind: "audio" }
  ];
  assert.deepEqual(featuredAssets(many, { prompt: "A 30-second launch video. Show the pricing page near the end, and the dashboard too." }), [
    { src: "assets/pricing.png", reason: "the prompt asks to show the pricing page", shows: "pricing page" },
    { src: "assets/hero.mp4", reason: "its notes say to feature it" }
  ], "two files are dashboards, so neither is clearly the one meant");
  assert.deepEqual(featuredAssets(many, { prompt: "Use dash-2.png and the team offsite photo" }).map((item) => [item.src, item.reason]), [["assets/dash-2.png", "the prompt names it"], ["assets/team offsite.jpg", "the prompt names it"], ["assets/hero.mp4", "its notes say to feature it"]]);
  // The pricing page is mentioned, but nobody asked to show it.
  assert.deepEqual(featuredAssets(many.slice(0, 4), { prompt: "Explain why our pricing page converts" }), []);
  const few = [{ src: "assets/a.png", kind: "image" }, { src: "assets/b.mp4", kind: "video", notes: { quality: 0.2 } }, { src: "assets/c.png", kind: "image", notes: { feature: false } }];
  assert.deepEqual(featuredAssets(few, { prompt: "A launch video" }), [{ src: "assets/a.png", reason: "it is one of only 3 files handed in" }]);
  assert.deepEqual(featuredAssets([few[0]], {}), [{ src: "assets/a.png", reason: "it is the only file handed in" }]);
});

test("unusedFeatured flags a featured file no scene shows, wherever a scene would name it", () => {
  const featured = [{ src: "assets/pricing.png", reason: "the prompt asks to show the pricing page", shows: "pricing page" }, { src: "assets/a.mp4", reason: "it is one of only 2 files handed in" }];
  const story = { scenes: [{ id: "s1", module: "kinetic-headline", params: { lines: ["Stop guessing"] } }, { id: "s2", module: "media-grid", params: { items: [{ media: { kind: "video", src: "./assets/a.mp4" } }] } }] };
  const errors = unusedFeatured(story, featured);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^featured: assets\/pricing\.png \(a pricing page\) is not in the storyboard, and the prompt asks to show the pricing page\. Give it a scene/);
  story.scenes.push({ id: "s3", module: "media-window", params: { media: { kind: "image", src: "assets/pricing.png" } } });
  assert.deepEqual(unusedFeatured(story, featured), []);
  assert.deepEqual(unusedFeatured(story, []), []);
  assert.match(featuredPrompt(featured), /## Files the user wants in the video[\s\S]*- assets\/pricing\.png \(a pricing page\): the prompt asks to show the pricing page\./);
});

test("make describes the handed-in files, tells the planner, and warns when a featured file is left out", async () => {
  const assets = await assetsDir();
  await writeFile(path.join(assets, "pricing-page.png"), "png bytes");
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-understanding-out-"));
  const inventory = async (dir) => {
    const base = await fakeInventory(dir);
    base.entries.push({ path: "pricing-page.png", kind: "image", role: "screenshot", confidence: 0.8, signals: ["size:1920x1080"], description: "Screenshot (1920×1080) of the product UI to show in a media window", media: { kind: "image", width: 1920, height: 1080, alpha: false }, fingerprint: "4" });
    return base;
  };
  try {
    const { calls, model } = fakeModel();
    const report = await runMake(PROMPT, { assets, out, voice: "test", music: "synth", maxRepairs: 1 }, { env: {}, client: model, inventory, finish: fakeFinish([]), notice() {} });
    assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
    // No model that can see: both files are described locally, and ASSETS.json says so.
    assert.deepEqual(report.assets.descriptions, { notes: 0, vision: 0, local: 2 });
    const saved = JSON.parse(await readFile(path.join(out, "ASSETS.json"), "utf8"));
    const pricing = saved.entries.find((entry) => entry.path === "pricing-page.png");
    assert.equal(pricing.notes.shows, "pricing page");
    assert.equal(pricing.understanding.source, "local");
    assert.equal(saved.entries.find((entry) => entry.path === "logo.png").understanding, undefined);
    // The director reads what each file shows and where it fits.
    const board = calls.find((request) => request.schemaName === "launchclip_storyboard");
    assert.match(board.input, /assets\/pricing-page\.png — image, screenshot[^\n]*What it likely shows[^\n]*a pricing page[^\n]*fits the price or offer line/);
    assert.match(board.instructions, /## Files the user wants in the video[\s\S]*assets\/pricing-page\.png \(a pricing page\): it is one of only 2 files handed in/);
    // The fake plan never shows the pricing page: repaired once, then shipped with a warning.
    assert.deepEqual(report.assets.featured.map((item) => item.src), ["assets/ui.mp4", "assets/pricing-page.png"]);
    assert.deepEqual(report.assets.unused_featured, ["assets/pricing-page.png"]);
    assert.match(report.warnings.join("\n"), /featured: assets\/pricing-page\.png \(a pricing page\) is not in the storyboard/);
    // --asset-descriptions off: the inventory as it was, and no featured check.
    const off = await runMake(PROMPT, { assets, out: `${out}-off`, voice: "test", music: "synth", assetDescriptions: "off" }, { env: {}, client: fakeModel().model, inventory, finish: fakeFinish([]), notice() {} });
    assert.equal(off.assets.descriptions, undefined);
    assert.equal(off.assets.featured, undefined);
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
    await rm(`${out}-off`, { recursive: true, force: true });
  }
});
