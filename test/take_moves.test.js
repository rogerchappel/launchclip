import assert from "node:assert/strict";
import test from "node:test";
import { validateStory } from "@launchclip/core/story.mjs";
import { TAKE_MOVES, addTakeMoves } from "../src/take_moves.js";

const words = Array.from({ length: 40 }, (_, index) => ({ text: index % 8 === 7 ? "done." : "word", start: index * 0.5, end: index * 0.5 + 0.4 }));

function talkingHead(scenes = [], extra = {}) {
  return { schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1080, height: 1920, fps: 30, duration: 20 }, brand: { colors: { bg: "#0b1020", primary: "#ff7a59", accent: "#7ce7ff", ink: "#0b1020", paper: "#f5f1ea" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } }, base: { src: "assets/recording.mp4" }, scenes, ...extra };
}

test("a still take gets punch-ins on phrase starts, alternating scales, with plain take between", () => {
  const { storyboard, added } = addTakeMoves(talkingHead(), { words });
  const moves = storyboard.scenes.filter((scene) => scene.module === "punch-in");
  assert.equal(moves.length, added.length);
  assert.ok(moves.length >= 3, `${moves.length} moves in 20 s`);
  assert.deepEqual(moves.slice(0, 2).map((move) => move.params.scale), [...TAKE_MOVES.scales]);
  for (const [index, move] of moves.entries()) {
    assert.ok(move.end - move.start >= TAKE_MOVES.min && move.end <= 20, `${move.id} ${move.start}-${move.end}`);
    assert.ok(words.some((word) => word.start === move.start), `${move.id} starts on a word`);
    if (index) assert.ok(move.start - moves[index - 1].end >= TAKE_MOVES.plain - TAKE_MOVES.snap - 1e-6, "plain take between two moves");
  }
  assert.deepEqual(validateStory(storyboard).errors, []);
  // A calm pace leaves longer holds.
  assert.ok(addTakeMoves(talkingHead(), { words, pace: "calm" }).added.length < moves.length);
});

test("no move where the presenter is off screen, where the camera already moves, or outside a talking head", () => {
  const insert = { id: "chart", module: "stat-card", insert: true, start: 0, end: 9, params: { value: "87%", label: "of runs", source: "Example" } };
  const planned = { id: "p", module: "punch-in", track: 1, start: 10, end: 19.5, params: {} };
  const { storyboard, added } = addTakeMoves(talkingHead([insert, planned]), { words });
  assert.deepEqual(added, []);
  assert.equal(storyboard.scenes.length, 2);
  const moves = addTakeMoves(talkingHead([insert]), { words }).storyboard.scenes.filter((scene) => scene.id.startsWith("take-move"));
  assert.ok(moves.length && moves.every((move) => move.start >= 9 + TAKE_MOVES.margin && move.track === 1));
  assert.deepEqual(addTakeMoves({ ...talkingHead(), lane: "motion", base: undefined }, { words }).added, []);
});
