// The asset-provider hook (src/asset_provider.js): with an app's provider,
// the planner may ask for "a shot that shows X" in a photo-scene; the app's
// library or generated shot is written in as a project assets/ path before
// the checks, and a miss becomes a repair note.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { planStoryboard } from "../src/storyboard_planner.js";
import { MAX_SHOT_REQUESTS, SHOT_CARD_SLOTS, normalizeShot, resolveShots, shotNotes, shotPrompt, shotRequestLimit, shotRequests } from "../src/asset_provider.js";
import { createEngine } from "../src/engine/index.js";

const FORMAT = { width: 1080, height: 1920, fps: 30, duration: 6, platform: "youtube-shorts" };
const WORDS = [["Every", 0.2], ["morning", 0.6], ["starts", 1.1], ["here", 1.5], ["with", 3.2], ["coffee", 3.6], ["first", 4.0]].map(([text, start]) => ({ text, start, end: start + 0.3 }));
const AUDIO = { voice: "assets/audio/narration.wav", words: "NARRATION.json", music: { source: "synth", bpm: 96 }, sfx: "auto" };

function story(media) {
  return {
    schema: "launchclip.story.v1",
    title: "Morning",
    lane: "voiceover-motion",
    format: FORMAT,
    brand: DEFAULT_BRAND,
    audio: AUDIO,
    scenes: [
      media
        ? { id: "s1", module: "photo-scene", start: 0, end: "word:with", energy: 1, params: { media, title: "Every morning" } }
        : { id: "s1", module: "hook-title", start: 0, end: "word:with", energy: 1, params: { headline: "Every morning starts here", emphasis: "morning" } },
      { id: "s2", module: "cta", start: "word:with", end: 6, energy: 1, in: { type: "fade", dur: 0.3 }, params: { action: "Coffee first", loop: true } }
    ],
    overlays: [{ type: "captions", style: "word-highlight" }],
    ending: { loop_to: "s1" }
  };
}

const REQUEST = { kind: "shot", shows: "a barista pouring latte art, close up", type: "image" };

function llm(boards) {
  const requests = [];
  return {
    requests,
    async runStructured(request) {
      requests.push(request);
      const board = boards[Math.min(requests.length - 1, boards.length - 1)];
      return { model: "app-model", value: { storyboard_json: JSON.stringify(board) }, usage: { input_tokens: 10, output_tokens: 5 } };
    }
  };
}

const plan = (client, extra) => planStoryboard({ brief: "A calm morning coffee short.", words: WORDS, lane: "voiceover-motion", format: FORMAT, audio: AUDIO, tier: "structured", model: "app-model", client, ...extra });

test("without a provider the planner offers no shot requests", async () => {
  const client = llm([story(null)]);
  const report = await plan(client);
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.doesNotMatch(client.requests[0].instructions, /kind: "shot"/);
  assert.equal(report.shots, undefined);
});

test("a shot request becomes the app's shot, copied into the project, with the line it sits under", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-shots-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const library = path.join(project, "..", `${path.basename(project)}-library.jpg`);
  await writeFile(library, "jpeg bytes");
  t.after(() => rm(library, { force: true }));
  const asked = [];
  const assets = { async findShot(request) { asked.push(request); return { file: library, source: { provider: "app-library", id: "img-42", license: "owned" } }; } };
  const client = llm([story(REQUEST)]);
  const report = await plan(client, { assets, project });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.match(client.requests[0].instructions, /kind: "shot"/);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].shows, REQUEST.shows);
  assert.equal(asked[0].type, "image");
  assert.equal(asked[0].line, "Every morning starts here");
  assert.equal(asked[0].format.aspect, "portrait");
  const media = report.storyboard.scenes[0].params.media;
  assert.equal(media.kind, "image");
  assert.match(media.src, /^assets\/shots\/s1-[0-9a-f]{10}\.jpg$/);
  assert.equal(await readFile(path.join(project, media.src), "utf8"), "jpeg bytes");
  assert.deepEqual(report.shots, [{ scene_id: "s1", request_id: asked[0].id, shows: REQUEST.shows, kind: "image", src: media.src, source: { provider: "app-library", id: "img-42", license: "owned" } }]);
});

test("no shot is a repair note, and the replanned scene needs none", async () => {
  const assets = { async findShot() { return null; } };
  const client = llm([story(REQUEST), story(null)]);
  const report = await plan(client, { assets });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.attempts.length, 2);
  assert.ok(report.attempts[0].errors.some((error) => /no shot that shows "a barista pouring latte art/.test(error)), report.attempts[0].errors.join("\n"));
  assert.equal(report.storyboard.scenes[0].module, "hook-title");
  assert.deepEqual(report.shots, []);
});

test("a URL shot keeps an assets/ path in the story and reports the URL for the app's asset resolver", async () => {
  const assets = { findShot: async () => ({ url: "https://media.example/gen/abc.mp4?sig=1", kind: "video", source: { provider: "app-generator", generated: true } }) };
  const found = await resolveShots(story({ kind: "shot", shows: "steam rising from a cup", type: "video" }), { assets, words: WORDS });
  assert.deepEqual(found.errors, []);
  assert.match(found.storyboard.scenes[0].params.media.src, /^assets\/shots\/s1-[0-9a-f]{10}\.mp4$/);
  assert.equal(found.storyboard.scenes[0].params.media.sourceStart, 0);
  assert.equal(found.shots[0].url, "https://media.example/gen/abc.mp4?sig=1");
  assert.equal(shotRequests(found.storyboard).length, 0);
});

test("a shot's notes say what it shows, and its usable window sets where the video starts", async () => {
  const answer = { url: "https://media.example/lib/pour.mp4", kind: "video", duration: 14, description: "Barista pours latte art, close up", windows: [{ start: 0, end: 1.5, quality: 0.3, note: "out of focus" }, { start: 6, end: 11, quality: 0.9, note: "the pour" }], source: { provider: "app-library", id: "v7" } };
  const found = await resolveShots(story({ kind: "shot", shows: "a barista pouring latte art", type: "video" }), { assets: { findShot: async () => answer }, words: WORDS });
  assert.deepEqual(found.errors, []);
  const media = found.storyboard.scenes[0].params.media;
  assert.equal(media.sourceStart, 6, "the higher-quality window that fits the scene");
  assert.deepEqual(found.shots[0].notes, { description: "Barista pours latte art, close up", windows: [{ start: 0, end: 1.5, quality: 0.3, note: "out of focus" }, { start: 6, end: 11, quality: 0.9, note: "the pour" }] });
  assert.equal(found.shots[0].duration, 14);
  assert.deepEqual(found.media, [{ src: media.src, kind: "video", duration: 14, notes: found.shots[0].notes }]);
  // A start of the app's own wins over the windows.
  const pinned = await resolveShots(story({ kind: "shot", shows: "a barista pouring latte art", type: "video" }), { assets: { findShot: async () => ({ ...answer, sourceStart: 2 }) }, words: WORDS });
  assert.equal(pinned.storyboard.scenes[0].params.media.sourceStart, 2);
});

test("shot notes take text, a footage-notes object or the flat fields, and drop what is not a note", () => {
  assert.deepEqual(shotNotes({ notes: "A cup on a sunny table" }), { description: "A cup on a sunny table" });
  assert.deepEqual(shotNotes({ notes: { subjects: ["cup"], people: false, license: "x" }, description: "Cup", window: { start: 1, end: 4 } }), { description: "Cup", subjects: ["cup"], people: false, windows: [{ start: 1, end: 4 }] });
  assert.equal(shotNotes({ file: "/a.jpg" }), null);
  // The flat shape's duration_s is the shot's length; an answer without notes is unchanged.
  assert.equal(normalizeShot({ path: "/a.mp4", source: "library", duration_s: 9 }).duration, 9);
  assert.equal("notes" in normalizeShot({ file: "/a.jpg" }), false);
});

test("a repair pass sees what the app said each shot shows", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-shot-notes-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const assets = { findShot: async () => ({ src: "assets/lib/cup.jpg", kind: "image", description: "An empty cup on a counter, no barista" }) };
  // The first board also breaks a check (an unknown module), so there is a repair.
  const broken = story({ kind: "shot", shows: "a barista pouring latte art", type: "image" });
  broken.scenes[1] = { ...broken.scenes[1], module: "not-a-module" };
  const client = llm([broken, story(null)]);
  const report = await plan(client, { assets, project });
  assert.equal(report.attempts.length, 2);
  const repair = client.requests[1].input;
  assert.match(repair, /Shots the app found for your previous storyboard/);
  assert.match(repair, /- scene s1 \(image\) for "a barista pouring latte art": Notes from the app: An empty cup on a counter, no barista\./);
  // Without notes the repair prompt is as before.
  const plainClient = llm([broken, story(null)]);
  await plan(plainClient, { assets: { findShot: async () => ({ src: "assets/lib/cup.jpg", kind: "image" }) }, project });
  assert.doesNotMatch(plainClient.requests[1].input, /Shots the app found/);
});

test("wrong shots are reported, never written in", async () => {
  const cases = [
    [{ src: "../outside.jpg" }, /not an image|not a project assets/],
    [{ url: "https://x.example/page.html" }, /not an image/],
    [{ url: "https://x.example/a.mp4" }, /a video for a image request/],
    [{ file: "/tmp/a.png" }, /no project to copy/]
  ];
  for (const [shot, pattern] of cases) {
    const found = await resolveShots(story(REQUEST), { assets: { findShot: async () => shot }, words: WORDS });
    assert.equal(found.errors.length, 1);
    assert.match(found.errors[0], pattern);
  }
});

test("the engine passes its assets adapter and the project to the planner", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-engine-shots-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const shot = path.join(root, "shot.png");
  await writeFile(shot, "png");
  const engine = createEngine({ workDir: path.join(root, "work"), cacheDir: path.join(root, "cache"), adapters: { llm: llm([story(REQUEST)]), assets: { findShot: async () => ({ file: shot }) } } });
  const report = await engine.planStoryboard({ brief: "A calm morning coffee short.", words: WORDS, lane: "voiceover-motion", format: FORMAT, audio: AUDIO, tier: "structured", model: "app-model", project: "coffee" });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(await readFile(path.join(root, "work", "coffee", report.shots[0].src), "utf8"), "png");
});

// --min-shots: with a provider, a storyboard that asks for too few shots gets a
// repair note; when the repairs run out it is kept with a warning, never failed.
function threeShots() {
  const shot = (shows) => ({ kind: "shot", shows, type: "image" });
  return {
    ...story(null),
    scenes: [
      { id: "s1", module: "photo-scene", start: 0, end: 2, energy: 1, params: { media: shot("a barista grinding coffee beans, close up"), title: "Every morning" } },
      { id: "s2", module: "photo-scene", start: 2, end: 4, energy: 1, in: { type: "fade", dur: 0.3 }, params: { media: shot("steam rising from a fresh espresso"), title: "Starts here" } },
      { id: "s3", module: "photo-scene", start: 4, end: 6, energy: 1, in: { type: "fade", dur: 0.3 }, params: { media: shot("a hand lifting a cup by a sunny window"), title: "Coffee first" } }
    ]
  };
}

async function shotFile(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-min-shots-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "library.jpg");
  await writeFile(file, "jpeg");
  return { project: dir, assets: { findShot: async () => ({ file }) } };
}

test("shotPrompt is unchanged without a minimum and asks for at least min shots with one", () => {
  const optional = shotPrompt();
  assert.equal(shotPrompt({ min: 0 }), optional);
  assert.match(optional, /you may set params\.media/);
  assert.match(optional, /Ask for at most 6 shots/);
  assert.doesNotMatch(optional, /at least/);
  const required = shotPrompt({ min: 3 });
  assert.match(required, /Ask for at least 3 and up to 6 shots/);
  assert.match(required, /library has real footage for this brand/);
  assert.match(required, /places, products, people doing things\) as shots, not drawn/);
  assert.match(required, /as often as it keeps the video fast, dynamic and engaging/);
  assert.match(required, /more shots than the app can find is fine/);
  assert.match(required, /no brand names or text in the frame/);
  assert.match(shotPrompt({ min: 9 }), /at least 6 and up to 6/);
  assert.match(shotPrompt({ min: 1, max: 20 }), /at least 1 and up to 20 shots/);
});

test("a plan may ask for about one shot per 3 seconds, from 6 up to MAX_SHOT_REQUESTS", () => {
  assert.equal(shotRequestLimit(undefined), 6);
  assert.equal(shotRequestLimit(0), 6);
  assert.equal(shotRequestLimit(15), 6);
  assert.equal(shotRequestLimit(30), 10);
  assert.equal(shotRequestLimit(60), 20);
  assert.equal(shotRequestLimit(600), MAX_SHOT_REQUESTS);
  assert.equal(MAX_SHOT_REQUESTS, 24);
});

test("minShots asks for shots, repairs a storyboard with too few and ends with the requests", async (t) => {
  const { project, assets } = await shotFile(t);
  const client = llm([story(null), threeShots()]);
  const report = await plan(client, { assets, project, minShots: 3 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.match(client.requests[0].instructions, /Ask for at least 3 and up to 6 shots/);
  assert.equal(report.attempts.length, 2);
  assert.ok(report.attempts[0].errors.includes("shots: ask for at least 3 shots from the app's library; this storyboard asks for 0. Show concrete subjects (places, products, people doing things) as {kind: \"shot\"} media in clip, photo-scene or media-window scenes, or in a card's image slot, instead of drawing them"), report.attempts[0].errors.join("\n"));
  assert.match(client.requests[1].input, /ask for at least 3 shots from the app's library; this storyboard asks for 0/);
  assert.equal(report.attempts[1].ok, true, report.attempts[1].errors.join("\n"));
  assert.deepEqual(report.shot_counts, { min: 3, requested: 3, answered: 3 });
  assert.equal(report.shots.length, 3);
});

test("a model that never adds shots keeps the best storyboard with a warning, not a failure", async () => {
  const assets = { findShot: async () => null };
  const client = llm([story(null)]);
  const report = await plan(client, { assets, minShots: 2, maxRepairs: 2 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.attempts.length, 3);
  assert.ok(report.attempts.every((attempt) => !attempt.ok && attempt.errors.some((error) => /ask for at least 2 shots/.test(error))));
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((warning) => /shots: the storyboard asks for 0 shots, fewer than the 2 wanted, after 2 repairs; kept the best storyboard/.test(warning)), report.warnings.join("\n"));
  assert.deepEqual(report.shot_counts, { min: 2, requested: 0, answered: 0 });
  assert.equal(report.storyboard.scenes[0].module, "hook-title");
});

test("minShots counts requests, not answers", async () => {
  const assets = { findShot: async () => null };
  const client = llm([threeShots(), story(null)]);
  const report = await plan(client, { assets, minShots: 3, maxRepairs: 1 });
  // Three requests meet the minimum; the misses are the usual repair notes.
  assert.ok(!report.attempts[0].errors.some((error) => /ask for at least/.test(error)), report.attempts[0].errors.join("\n"));
  assert.ok(report.attempts[0].errors.some((error) => /no shot that shows/.test(error)));
});

test("minShots is clamped to the most a plan may ask for, with a warning", async (t) => {
  const { project, assets } = await shotFile(t);
  const client = llm([threeShots()]);
  const report = await plan(client, { assets, project, minShots: 10, maxRepairs: 0 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.match(client.requests[0].instructions, /Ask for at least 6 and up to 6 shots/);
  assert.ok(report.warnings.some((warning) => /minShots 10 is more than a plan may ask for; using 6/.test(warning)));
  assert.equal(report.shot_counts.min, 6);
});

test("minShots is ignored without an asset provider", async () => {
  const client = llm([story(null)]);
  const report = await plan(client, { minShots: 3 });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.equal(report.attempts.length, 1);
  assert.doesNotMatch(client.requests[0].instructions, /kind: "shot"/);
  assert.equal(report.shot_counts, undefined);
  assert.ok(report.warnings.some((warning) => /minShots 3 ignored: there is no asset provider/.test(warning)));
});

// Cards with an image slot (SHOT_CARD_SLOTS) take shot requests too.
function cardStory(module, params) {
  const board = story(null);
  board.scenes[0] = { id: "s1", module, start: 0, end: "word:with", energy: 1, params };
  return board;
}

test("a card's image slot takes a shot request and gets the app's image as an assets/ path", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-card-shots-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const library = path.join(project, "..", `${path.basename(project)}-cafe.jpg`);
  await writeFile(library, "jpeg bytes");
  t.after(() => rm(library, { force: true }));
  const asked = [];
  const assets = { async findShot(request) { asked.push(request); return { file: library, source: { provider: "app-library", id: "img-7" } }; } };
  const client = llm([cardStory("polaroid", { image: { kind: "shot", shows: "a sunlit corner cafe with a striped awning" }, caption: "Every morning" })]);
  const report = await plan(client, { assets, project });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.match(client.requests[0].instructions, /Cards can carry library shots too/);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].module, "polaroid");
  assert.equal(asked[0].slot, "image");
  assert.equal(asked[0].still, true);
  assert.equal(asked[0].line, "Every morning starts here");
  const image = report.storyboard.scenes[0].params.image;
  assert.match(image, /^assets\/shots\/s1-[0-9a-f]{10}\.jpg$/);
  assert.equal(await readFile(path.join(project, image), "utf8"), "jpeg bytes");
  assert.equal(report.shots[0].slot, "image");
});

test("every card slot is found, nested slots included, and written back as a plain path", async () => {
  const assets = { findShot: async () => ({ src: "assets/library/hands.jpg", kind: "image" }) };
  for (const [module, slot] of Object.entries(SHOT_CARD_SLOTS)) {
    const request = { kind: "shot", shows: "hands typing on a laptop" };
    const params = slot === "media.image" ? { media: { image: request, layout: "side" } } : { image: request };
    const board = cardStory(module, params);
    assert.deepEqual(shotRequests(board).map(({ slot: at, still }) => ({ at, still })), [{ at: slot, still: true }], module);
    const found = await resolveShots(board, { assets, words: WORDS });
    assert.deepEqual(found.errors, [], module);
    const value = slot.split(".").reduce((node, key) => node[key], found.storyboard.scenes[0].params);
    assert.equal(value, "assets/library/hands.jpg", module);
    if (slot === "media.image") assert.equal(found.storyboard.scenes[0].params.media.layout, "side", "sibling params are kept");
    assert.equal(shotRequests(found.storyboard).length, 0);
  }
});

test("a video shot in a card's image slot lands as a still frame of it", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-card-still-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  const frames = [];
  const stillFrame = async (video, at, target) => { frames.push({ video, at }); await writeFile(target, "still bytes"); };
  const assets = { findShot: async () => ({ src: "assets/library/pour.mp4", kind: "video", sourceStart: 2 }) };
  const board = cardStory("device-frame", { device: "phone", image: { kind: "shot", shows: "a phone showing a coffee order app", type: "video" } });
  const found = await resolveShots(board, { assets, words: WORDS, project, stillFrame });
  assert.deepEqual(found.errors, []);
  const image = found.storyboard.scenes[0].params.image;
  assert.match(image, /^assets\/shots\/s1-[0-9a-f]{10}-still\.jpg$/);
  assert.equal(await readFile(path.join(project, image), "utf8"), "still bytes");
  assert.deepEqual(frames, [{ video: path.join(project, "assets/library/pour.mp4"), at: 2.5 }]);
  assert.deepEqual({ kind: found.shots[0].kind, still_of: found.shots[0].still_of }, { kind: "image", still_of: "assets/library/pour.mp4" });
  // A video by URL cannot give a still here; that is a repair note, not a broken card.
  const byUrl = await resolveShots(board, { assets: { findShot: async () => ({ url: "https://media.example/pour.mp4", kind: "video" }) }, words: WORDS, project, stillFrame });
  assert.match(byUrl.errors[0], /video by URL for a card's image slot \(device-frame params\.image\)/);
  assert.equal(byUrl.storyboard.scenes[0].params.image.kind, "shot");
});

test("a shot request outside a shot module or card slot is still refused, and the module schema stays strict", async () => {
  const assets = { findShot: async () => ({ src: "assets/library/hands.jpg", kind: "image" }) };
  const found = await resolveShots(cardStory("hook-title", { headline: "Every morning", media: { kind: "shot", shows: "a cup" } }), { assets, words: WORDS });
  assert.match(found.errors[0], /shot requests are for photo-scene, media-window, clip scenes and card image slots \(.*polaroid params\.image.*\), not hook-title/);
  // An unanswered card request is not an assets/ path, so the card's own check fails and the plan repairs it.
  const client = llm([cardStory("polaroid", { image: { kind: "shot", shows: "a cafe" } }), story(null)]);
  const report = await plan(client, { assets: { findShot: async () => null } });
  assert.equal(report.status, "passed", report.errors.join("\n"));
  assert.ok(report.attempts[0].errors.some((error) => /params\.image must be a project-local assets\/ path/.test(error)), report.attempts[0].errors.join("\n"));
});

test("shotPrompt tells the planner that cards carry library shots", () => {
  for (const text of [shotPrompt(), shotPrompt({ min: 3 })]) {
    assert.match(text, /Cards can carry library shots too/);
    for (const [module, slot] of Object.entries(SHOT_CARD_SLOTS)) assert.ok(text.includes(`${module} params.${slot}`), module);
    assert.match(text, /a video shot lands there as one frame of it/);
  }
});
