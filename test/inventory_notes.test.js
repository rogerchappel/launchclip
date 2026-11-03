import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { applyNotes, bestWindow, matchScore, mediaNotesLine, normalizeNotes, pickMedia, readInventoryNotes, snapMediaWindows } from "../src/inventory_notes.js";
import { inventoryAssets } from "../src/make/assets.js";
import { routeLane } from "../src/make/routing.js";
import { runMake } from "../src/make/index.js";
import { constrainProvider, parseConstraints } from "../src/constraints.js";
import { runStoryCommand } from "../src/story_cli.js";
import { fakeFinish } from "./helpers/make_fakes.js";

test("normalizeNotes keeps the known fields and drops bad ones with a warning", () => {
  const { notes, warnings } = normalizeNotes({ description: "  Ute  on sand ", subjects: ["ute", "beach", 3], tags: "x", windows: [{ start: 4, end: 9, quality: 0.8, note: "drive-by" }, { start: 1, end: 3 }, { start: 5, end: 2 }], quality: 1.4, orientation: "landscape", people: 2, faces: false, role: "b-roll", colour: "red" }, "a.mp4.json");
  assert.deepEqual(notes, { description: "Ute on sand", subjects: ["ute", "beach"], orientation: "landscape", people: 2, faces: false, role: "b-roll", windows: [{ start: 1, end: 3 }, { start: 4, end: 9, quality: 0.8, note: "drive-by" }] });
  const text = warnings.join("\n");
  for (const pattern of [/a\.mp4\.json\.colour is not a notes field/, /tags must be a list/, /quality must be a number from 0 to 1/, /windows\[2\] must be \{start, end\}/]) assert.match(text, pattern);
});

test("readInventoryNotes merges inventory.json with sidecars (a sidecar wins), by full name or by a unique stem", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-notes-"));
  try {
    await mkdir(path.join(dir, "broll"), { recursive: true });
    for (const file of ["broll/a.mp4", "broll/b.mov", "broll/c.mp4", "broll/c.png", "photo.jpg"]) await writeFile(path.join(dir, file), "x");
    await writeFile(path.join(dir, "inventory.json"), JSON.stringify({ version: 1, assets: { "broll/a.mp4": { description: "From the inventory", quality: 0.3 }, "assets/photo.jpg": { tags: ["hero"] }, "gone.mp4": { quality: 1 } } }));
    await writeFile(path.join(dir, "broll/a.mp4.json"), JSON.stringify({ quality: 0.9 }));
    await writeFile(path.join(dir, "broll/b.json"), JSON.stringify({ subjects: ["dog"] }));
    await writeFile(path.join(dir, "broll/c.json"), JSON.stringify({ subjects: ["ambiguous"] }));
    const files = ["broll/a.mp4", "broll/a.mp4.json", "broll/b.mov", "broll/b.json", "broll/c.mp4", "broll/c.png", "broll/c.json", "photo.jpg", "inventory.json"].map((file) => path.join(dir, file));
    const { notes, metadata, warnings } = await readInventoryNotes(dir, files);
    assert.deepEqual(notes.get("broll/a.mp4"), { description: "From the inventory", quality: 0.9 });
    assert.deepEqual(notes.get("broll/b.mov"), { subjects: ["dog"] });
    assert.deepEqual(notes.get("photo.jpg"), { tags: ["hero"] });
    assert.equal(notes.has("broll/c.mp4"), false, "c.json is ambiguous between c.mp4 and c.png");
    assert.deepEqual([...metadata].sort(), ["broll/a.mp4.json", "broll/b.json", "inventory.json"]);
    assert.match(warnings.join("\n"), /gone\.mp4 is not in the assets folder/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyNotes asserts a role and orientation, keeps what the heuristics found, and is idempotent", () => {
  const entry = { path: "clip.mp4", kind: "video", role: "talking-head", confidence: 0.65, signals: ["camera-look"], description: "Talking-head recording (8s)", media: { kind: "video", width: 1920, height: 1080, orientation: "landscape" } };
  const noted = applyNotes(entry, { role: "b-roll", orientation: "portrait", quality: 0.8 });
  assert.equal(noted.role, "b-roll");
  assert.equal(noted.confidence, 1);
  assert.equal(noted.media.orientation, "portrait");
  assert.deepEqual(noted.detected, { role: "talking-head", confidence: 0.65, description: "Talking-head recording (8s)", orientation: "landscape" });
  assert.equal(noted.description, "B-roll footage (the app's notes; detected as talking-head: Talking-head recording (8s))");
  assert.deepEqual(noted.signals, ["camera-look", "notes", "notes:role"]);
  assert.deepEqual(applyNotes(noted, { role: "b-roll", orientation: "portrait", quality: 0.8 }), noted);
  const cleared = applyNotes(noted, null);
  assert.equal(cleared.role, "talking-head");
  assert.equal(cleared.media.orientation, "landscape");
  assert.equal(cleared.notes, undefined);
  assert.equal(cleared.description, "Talking-head recording (8s)");
  assert.equal(applyNotes({ path: "logo.png", kind: "image", role: "logo", signals: [] }, { role: "b-roll" }).role, "logo", "a role from another kind is ignored");
});

test("routing: a b-roll note keeps a clip with ambient speech out of the base, and quality ranks the media", () => {
  const video = (file, extra = {}) => ({ path: file, kind: "video", role: "b-roll", confidence: 0.6, signals: [], description: file, media: { kind: "video", duration: 8, width: 1080, height: 1920, orientation: "portrait", mountable: true }, speech: { present: false }, ...extra });
  const routing = routeLane({ entries: [
    video("host.mp4", { role: "talking-head", speech: { present: true }, media: { kind: "video", duration: 30, width: 1080, height: 1920, orientation: "portrait", mountable: true } }),
    video("windy.mp4", { speech: { present: true }, notes: { role: "b-roll", quality: 0.6 }, media: { kind: "video", duration: 60, width: 1080, height: 1920, orientation: "portrait", mountable: true } }),
    video("plain.mp4"),
    video("best.mp4", { notes: { quality: 0.95 } })
  ] });
  assert.equal(routing.base.path, "host.mp4", "the longer windy clip is b-roll by its notes");
  assert.deepEqual(routing.media.map((item) => item.path), ["best.mp4", "windy.mp4", "plain.mp4"]);
  assert.deepEqual(routing.media[0].notes, { quality: 0.95 });
  assert.equal(routing.ignored.length, 0);
});

test("the manifest line, window choice, scoring and snapping use the notes", () => {
  const item = { src: "assets/broll/ute.mp4", kind: "video", duration: 20, notes: { description: "Ute crossing corrugations", subjects: ["ute"], tags: ["corrugations", "dirt road"], quality: 0.3, people: 1, faces: false, windows: [{ start: 2, end: 4, quality: 0.6 }, { start: 8, end: 15, quality: 0.9, note: "wheel close-up" }] } };
  const line = mediaNotesLine(item);
  assert.match(line, /Notes from the app: Ute crossing corrugations; shows ute; tags corrugations, dirt road; quality 0\.3 \(low: use only when nothing better fits the line\); 1 person on screen, no faces; usable windows 2–4 s \(quality 0\.6\), 8–15 s \(quality 0\.9\) "wheel close-up": set params\.media\.sourceStart/);
  assert.equal(bestWindow(item.notes, 5).start, 8, "the only window long enough");
  assert.equal(bestWindow(item.notes, 1).start, 8, "both fit: the higher quality wins");
  assert.ok(matchScore(item, "Corrugations shake a ute apart") > matchScore(item, "The view from the beach"));
  const other = { src: "assets/broll/beach.mp4", kind: "video", duration: 12, notes: { subjects: ["beach"], quality: 0.8 } };
  assert.equal(pickMedia([item, other], { text: "Beach driving at low tide", need: 4 }).item.src, "assets/broll/beach.mp4");
  assert.equal(pickMedia([item, other], { text: "Corrugations on a dirt road", need: 4 }).item.src, "assets/broll/ute.mp4");
  assert.equal(pickMedia([item, other], { text: "Beach driving", need: 4, prefer: new Set(["assets/broll/ute.mp4"]) }).item.src, "assets/broll/ute.mp4");
  const story = { scenes: [
    { id: "a", module: "photo-scene", insert: true, start: 1, end: 6, params: { media: { src: "assets/broll/ute.mp4", kind: "video", sourceStart: 0 } } },
    { id: "b", module: "photo-scene", insert: true, start: 7, end: 9, params: { media: { src: "assets/broll/ute.mp4", kind: "video", sourceStart: 9 } } }
  ] };
  const snapped = snapMediaWindows(story, [item], { times: new Map([["a", { start: 1, end: 6 }], ["b", { start: 7, end: 9 }]]) });
  assert.equal(snapped.storyboard.scenes[0].params.media.sourceStart, 8);
  assert.equal(snapped.storyboard.scenes[1].params.media.sourceStart, 9, "already inside a window");
  assert.equal(snapped.moved.length, 1);
  assert.equal(story.scenes[0].params.media.sourceStart, 0, "the input is not changed");
});

test("constrainProvider tells the provider what to avoid and refuses a never_use shot", async () => {
  const constraints = parseConstraints({ version: 1, media: { never_use: ["broll/banned.mp4", { id: "lib-9" }] } }).constraints;
  const requests = [];
  const answers = [{ file: "/library/assets/broll/banned.mp4" }, { path: "/library/other.mp4", source: "library", asset_id: "lib-9" }, { file: "/library/ok.mp4" }];
  const notices = [];
  const provider = constrainProvider({ async findShot(request) { requests.push(request); return answers[requests.length - 1]; }, close() { notices.push("closed"); } }, constraints, { assetsDir: "/library/assets", notice: (line) => notices.push(line) });
  assert.equal(await provider.findShot({ id: "r1", scene_id: "s1" }), null);
  assert.equal(await provider.findShot({ id: "r2", scene_id: "s2" }), null);
  assert.deepEqual(await provider.findShot({ id: "r3", scene_id: "s3" }), { file: "/library/ok.mp4" });
  assert.deepEqual(requests[0].never_use, ["broll/banned.mp4", "id:lib-9"]);
  await provider.close();
  assert.match(notices.join("\n"), /refused the asset provider's shot for s1 \(broll\/banned\.mp4 is never_use\)/);
  assert.ok(notices.includes("closed"));
});

// A --base-edited footage-led make over a real inventory: notes from a
// sidecar and inventory.json, a constraints.json with a hidden range,
// must_use and never_use, and a model that ignores all of it.
test("make honours constraints.json and footage notes end to end (base-edited footage)", async () => {
  const assets = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-constraints-"));
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-constraints-out-"));
  try {
    await mkdir(path.join(assets, "broll"), { recursive: true });
    for (const file of ["host.mp4", "broll/pinned.mp4", "broll/beach.mp4", "broll/banned.mp4", "broll/windy.mp4"]) await writeFile(path.join(assets, file), file);
    await writeFile(path.join(assets, "constraints.json"), JSON.stringify({ version: 1, ranges: [{ start: 3, end: 6, picture: "hidden", reason: "voiceover_only" }], media: { must_use: [{ src: "broll/pinned.mp4", reason: "pinned" }], never_use: ["broll/banned.mp4"] } }));
    await writeFile(path.join(assets, "broll/pinned.mp4.json"), JSON.stringify({ description: "Camper on corrugations", tags: ["corrugations"], windows: [{ start: 2, end: 9, quality: 0.9 }] }));
    await writeFile(path.join(assets, "inventory.json"), JSON.stringify({ version: 1, assets: { "broll/windy.mp4": { role: "b-roll", description: "Wind noise over a beach drive" }, "broll/beach.mp4": { quality: 0.7 } } }));
    const words = ["Slide-on", "campers", "ride.", "Corrugations", "shake", "caravans.", "Weight", "sits", "low.", "See", "the", "build."].map((text, i) => ({ text, start: [0.2, 0.7, 1.2, 3.0, 3.6, 4.0, 5.4, 6.0, 6.6, 9.0, 9.4, 9.8][i], end: [0.2, 0.7, 1.2, 3.0, 3.6, 4.0, 5.4, 6.0, 6.6, 9.0, 9.4, 9.8][i] + 0.35 }));
    const transcriptFile = path.join(out, "..", `${path.basename(out)}-words.json`);
    await writeFile(transcriptFile, JSON.stringify({ words }));
    const speaking = new Set(["host.mp4", "windy.mp4"]);
    const inventory = (dir, options) => inventoryAssets(dir, {
      ...options,
      probe: async (file) => ({ format: { duration: path.basename(file) === "host.mp4" ? 12 : 10 }, streams: [{ codec_type: "video", width: 1080, height: 1920 }, ...(speaking.has(path.basename(file)) ? [{ codec_type: "audio" }] : [])] }),
      speech: async (file) => ({ voiced_ratio: 0.6, pauses: 4, speech: speaking.has(path.basename(file)) }),
      frames: async () => ({ flat_ratio: 0.1, edge_ratio: 0.01 }),
      transcribe: null
    });
    const requests = [];
    const client = { provider: "openai", async runStructured(request) {
      requests.push(request);
      if (request.schemaName === "launchclip_direction") return { model: "gpt-5.6-luna", value: { direction_json: JSON.stringify({ schema: "launchclip.direction-map.v1", sections: [{ id: "s1", lines: [{ words: [0, 2], intent: "hook", treatment: "dress", scenes: ["hook"] }, { words: [3, 5], intent: "problem", treatment: "face", why: "x" }, { words: [6, 8], intent: "claim", treatment: "face", why: "x" }, { words: [9, 11], intent: "cta", treatment: "face", why: "x" }] }] }) }, usage: {} };
      const board = { schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1080, height: 1920, fps: 30, duration: 12 }, brand: DEFAULT_BRAND, audio: { words: "NARRATION.json" }, base: "assets/host.mp4",
        scenes: [{ id: "hook", module: "emphasis-caption", track: 1, start: 0.2, end: 2, params: { text: "Built tough" } }], overlays: [{ type: "captions" }] };
      return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage: {} };
    } };
    const report = await runMake("Why slide-on campers handle corrugations", { assets, out, voice: "test", baseEdited: true, baseTranscript: transcriptFile, maxRepairs: 1 }, { env: {}, client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, inventory, finish: fakeFinish([]), notice() {}, subject: { probe: async () => { throw new Error("no subject runtime in tests"); } } });
    await rm(transcriptFile, { force: true });
    assert.equal(report.status, "ready-for-review", JSON.stringify(report.stages));
    assert.equal(report.routing.base.path, "host.mp4");
    assert.deepEqual(report.routing.media.map((item) => item.path).sort(), ["broll/beach.mp4", "broll/pinned.mp4", "broll/windy.mp4"], "windy is b-roll by its notes; banned is never inventoried");
    assert.deepEqual(report.constraints, { file: "CONSTRAINTS.json", source: path.join(assets, "constraints.json"), ranges: 1, must_use: ["broll/pinned.mp4"], never_use: ["broll/banned.mp4"], excluded: ["broll/banned.mp4"] });
    const inventoryDoc = JSON.parse(await readFile(path.join(out, "ASSETS.json"), "utf8"));
    assert.ok(!inventoryDoc.entries.some((entry) => entry.path === "broll/banned.mp4" || entry.path.endsWith(".json")));
    assert.equal(existsSync(path.join(out, "assets/broll/banned.mp4")), false, "never_use media is not copied into the project");
    const storyboardCall = requests.find((request) => request.schemaName === "launchclip_storyboard");
    assert.match(storyboardCall.input, /assets\/broll\/pinned\.mp4 — video, screen-recording.*Notes from the app: Camper on corrugations; tags corrugations; usable windows 2–9 s \(quality 0\.9\)/);
    assert.match(storyboardCall.instructions, /## Constraints from the app/);
    const story = JSON.parse(await readFile(path.join(out, "storyboard.json"), "utf8"));
    const hidden = story.scenes.find((scene) => scene.id === "hidden-1");
    assert.equal(hidden.insert, true);
    assert.equal(hidden.params.media.src, "assets/broll/pinned.mp4");
    assert.equal(hidden.params.media.sourceStart, 2);
    const map = JSON.parse(await readFile(path.join(out, "DIRECTION.json"), "utf8"));
    assert.deepEqual(map.sections[0].lines.map((line) => line.treatment), ["dress", "insert", "insert", "face"]);
    // The project validates clean against the copy make wrote.
    const validation = await runStoryCommand("validate", path.join(out, "storyboard.json"));
    assert.ok(!validation.errors.some((entry) => entry.startsWith("constraints:")), validation.errors.join("\n"));
    assert.equal(validation.constraints.status, "passed");
    // A run without constraints removes the stale copy.
    await rm(path.join(assets, "constraints.json"));
    await runMake("Why slide-on campers handle corrugations", { assets, out, voice: "test", baseEdited: true, baseTranscript: transcriptFile, maxRepairs: 0 }, { env: {}, client: { client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, inventory, finish: fakeFinish([]), notice() {}, subject: { probe: async () => { throw new Error("no subject runtime in tests"); } } }).catch(() => null);
    assert.equal(existsSync(path.join(out, "CONSTRAINTS.json")), false);
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(out, { recursive: true, force: true });
  }
});
