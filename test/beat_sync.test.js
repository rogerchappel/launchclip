import assert from "node:assert/strict";
import test from "node:test";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { chooseAlignment, keyMoments, momentReport, nearest, scoreMoments, snapStory, summarizeMoments, syncStrategy } from "../src/music/beat_sync.js";
import { gridFromBpm, transformGrid } from "../src/music/beats.js";

const BRAND = { colors: { bg: "#0b1020", primary: "#ffb547", accent: "#4fd1c5", ink: "#0b1020", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };

function motionStory() {
  return {
    schema: "launchclip.story.v1",
    lane: "motion",
    format: { width: 1920, height: 1080, fps: 30, duration: 10 },
    brand: BRAND,
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 3.9, energy: 2, params: { headline: "Ship faster" }, hits: [{ at: 1.1, event: "headline" }] },
      { id: "s2", module: "count-up", start: 3.9, end: 7.1, energy: 3, in: { type: "fade", dur: 0.3 }, params: { value: 80, suffix: "%", label: "less time", countAt: 1.25, countDuration: 0.95 }, hits: [{ at: 5.2, event: "hit" }] },
      { id: "s3", module: "cta", start: 7.1, end: 10, energy: 3, in: { type: "fade", dur: 0.3 }, params: { action: "Try it" } }
    ]
  };
}

test("syncStrategy: narrated stories align the music, motion stories snap, off is off", () => {
  assert.equal(syncStrategy({ audio: {} }), "snap");
  assert.equal(syncStrategy({ audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json" } }), "align");
  assert.equal(syncStrategy({ audio: { narration: { text: "hi" } } }), "align");
  assert.equal(syncStrategy({ audio: {} }, { narrated: true }), "align");
  assert.equal(syncStrategy({ audio: { voice: "x" } }, { sync: "off" }), "off");
});

test("keyMoments names the hook cut, the payoff and strong hits", () => {
  const moments = keyMoments(resolveStory(motionStory()));
  assert.deepEqual(moments.map((moment) => [moment.kind, moment.at, moment.scene]), [["hit", 1.1, "s1"], ["hook-cut", 3.9, "s2"], ["hit", 5.2, "s2"], ["payoff", 7.1, "s3"]]);
  assert.deepEqual(keyMoments(resolveStory(motionStory()), { hits: false }).map((moment) => moment.kind), ["hook-cut", "payoff"]);
});

test("snap: cuts move to downbeats (or beats) within the tolerance and hits to beats", () => {
  const story = motionStory();
  story.scenes[1].params.countAt = 0.9; // leaves room, so every move is valid
  const grid = gridFromBpm(120, 12); // beats every 0.5 s, downbeats every 2 s
  const result = snapStory(story, grid);
  assert.deepEqual(result.changes.map((change) => [change.kind, change.scene, change.from, change.to, change.grid]), [
    ["cut", "s2", 3.9, 4, "downbeat"],
    ["cut", "s3", 7.1, 7, "beat"],
    ["hit", "s1", 1.1, 1, "beat"]
  ]);
  // s2's hit moved with its scene (+0.1 s, to 5.3); the count-up times its
  // "hit" event from its own params, so snapping the hit would desync it.
  assert.equal(result.story.scenes[1].hits[0].at, 5.3);
  assert.equal(result.reverted.length, 1);
  assert.match(result.reverted[0].reason, /module event "hit" is timed by the module's params/);
  // Shared boundaries move together, the user's object is untouched and the result validates.
  assert.equal(result.story.scenes[0].end, 4);
  assert.equal(result.story.scenes[1].start, 4);
  assert.equal(result.story.scenes[1].end, 7);
  assert.equal(story.scenes[1].start, 3.9);
  assert.ok(validateStory(resolveStory(result.story)).ok);
  assert.ok(result.changes.every((change) => Math.abs(change.delta) <= 0.25));
  // A hit with no module event of its own (pure sound) snaps freely.
  const free = motionStory();
  free.scenes[1].params.countAt = 0.9;
  free.scenes[1].hits[0].event = "whoosh-accent";
  assert.ok(snapStory(free, grid).changes.some((change) => change.kind === "hit" && change.scene === "s2" && change.to === 5.5));
});

test("snap: a move that breaks a module's params falls back and is recorded", () => {
  const result = snapStory(motionStory(), gridFromBpm(120, 12));
  const reverted = result.reverted.find((entry) => entry.scene === "s3");
  assert.ok(reverted, JSON.stringify(result.reverted));
  assert.match(reverted.reason, /count-up.*countAt \+ params\.countDuration/);
  assert.equal(result.story.scenes[2].start, 7.1, "the boundary stays where it was");
  assert.equal(result.story.scenes[1].start, 4, "other moves still apply");
  // An injected module check rejects one scene.
  const strict = snapStory(motionStory(), gridFromBpm(120, 12), { checkModule: (scene) => (scene.id === "s1" ? "s1 rejects every change" : null) });
  assert.ok(strict.reverted.some((entry) => entry.scene === "s2" && /s1 rejects/.test(entry.reason)));
  assert.equal(strict.story.scenes[1].start, 3.9);
});

test("snap: the tolerance bounds every move; word and beat anchors never move", () => {
  const story = motionStory();
  story.scenes[1].params.countAt = 0.9;
  // 100 BPM from 0.45 s: beats at 3.45 and 4.05, so none within 0.1 s of 3.9.
  const tight = snapStory(story, gridFromBpm(100, 12, { start: 0.45 }), { tolerance: 0.1 });
  assert.ok(tight.changes.every((change) => Math.abs(change.delta) <= 0.1));
  assert.ok(tight.skipped.some((entry) => entry.scene === "s2" && entry.kind === "cut" && /no beat within 0.1s/.test(entry.reason)));

  const anchored = motionStory();
  anchored.audio = { words: "NARRATION.json" };
  anchored.scenes[0].end = "word:ship";
  anchored.scenes[1].start = "word:ship";
  anchored.scenes[2].start = "beat:14";
  anchored.scenes[1].end = "beat:14";
  anchored.scenes[0].hits[0].at = "word:faster";
  const words = [{ text: "Ship", start: 3.9, end: 4.2 }, { text: "faster", start: 1.1, end: 1.5 }];
  const result = snapStory(anchored, gridFromBpm(120, 12), { words });
  assert.equal(result.changes.filter((change) => change.kind === "cut").length, 0);
  assert.equal(result.story.scenes[1].start, "word:ship");
  assert.equal(result.story.scenes[0].hits[0].at, "word:faster");
  assert.ok(result.skipped.some((entry) => entry.scene === "s2" && /word-anchored/.test(entry.reason)));
  assert.ok(result.skipped.some((entry) => entry.kind === "hit" && /word-anchored/.test(entry.reason)));
  assert.ok(result.skipped.some((entry) => entry.scene === "s3" && /beat-anchored/.test(entry.reason)));
  // Mode "cuts" leaves hits alone.
  const cutsOnly = snapStory({ ...motionStory(), scenes: motionStory().scenes.map((scene) => ({ ...scene, params: { ...scene.params, countAt: 0.9 } })) }, gridFromBpm(120, 12), { mode: "cuts" });
  assert.ok(cutsOnly.changes.every((change) => change.kind === "cut"));
});

test("align: the start offset puts downbeats on the hook cut and the payoff", () => {
  const moments = keyMoments(resolveStory(motionStory()), { hits: false });
  // 100 BPM track whose first downbeat is at 0.3 s; bars are 2.4 s.
  const music = gridFromBpm(100, 12.5, { start: 0.3 });
  const alignment = chooseAlignment(music, moments, { duration: 10, musicLength: 12.5, allowTempo: false });
  assert.equal(alignment.tempo, 1);
  assert.ok(alignment.score > alignment.baseline);
  const report = momentReport(moments, alignment.grid);
  // 3.9 and 7.1 are 3.2 s apart, not a whole number of 2.4 s bars: the payoff wins (weight tie → earlier offset).
  assert.ok(report.some((entry) => entry.on_downbeat), JSON.stringify(report));
});

test("align: a small tempo change (≤ 3%) lands two key moments on downbeats", () => {
  // Cuts 4.12 s apart; at 120 BPM two bars are 4 s, so the music must slow by about 2.9%.
  const story = motionStory();
  story.scenes[0].end = 4; story.scenes[1].start = 4; story.scenes[1].end = 8.12; story.scenes[2].start = 8.12;
  const moments = keyMoments(resolveStory(story), { hits: false });
  const music = gridFromBpm(120, 13);
  const plain = chooseAlignment(music, moments, { duration: 10, musicLength: 13, allowTempo: false });
  const stretched = chooseAlignment(music, moments, { duration: 10, musicLength: 13 });
  assert.ok(stretched.tempo < 1 && stretched.tempo >= 0.97, `tempo ${stretched.tempo}`);
  const summary = summarizeMoments(momentReport(moments, stretched.grid));
  assert.equal(summary.key_moments_on_downbeat, 2, JSON.stringify(momentReport(moments, stretched.grid)));
  assert.ok(stretched.score > plain.score * 1.05);
  // The re-timed track still covers the story.
  assert.ok((13 - stretched.offset) / stretched.tempo >= 10);
});

test("align never changes the story: transformGrid only moves the music", () => {
  const grid = transformGrid(gridFromBpm(120, 12), { offset: 0.25, tempo: 1, duration: 10 });
  assert.equal(grid.beats[0], 0.25);
  assert.equal(nearest(grid.downbeats, 4).value, 3.75);
  assert.ok(scoreMoments([{ at: 3.75, weight: 1, downbeat: true }], grid) > 0.99);
});
