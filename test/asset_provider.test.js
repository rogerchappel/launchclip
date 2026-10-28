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
import { resolveShots, shotRequests } from "../src/asset_provider.js";
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
