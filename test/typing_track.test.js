import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "../kit/core/modules.mjs";
import { assignVariants, collectTyping, keyKind, mixTyping, pitchShift, thinKeys, typingSchedule } from "../src/sfx/typing.js";

// A code-snippet scene with two typed lines, resolved through the real module.
const story = {
  schema: "launchclip.story.v1",
  format: { width: 1080, height: 1920, fps: 30, duration: 8 },
  resolved: { duration: 8, fps: 30, frames: 240 },
  brand: { colors: { bg: "#0d1117", primary: "#58a6ff", accent: "#3fb950", ink: "#0d1117", paper: "#f0f6fc" }, fonts: { display: "anton", meta: "jetbrains-mono" } },
  scenes: [{
    id: "s1", module: "code-snippet", start: 0, end: 8,
    params: { title: "Cache", rect: { x: 90, y: 600, width: 900, height: 420 }, code: { language: "yaml", typing: true, lines: [
      { at: 0.5, typeDuration: 0.6, tokens: [{ text: "cache:", type: "keyword" }, { text: " npm", type: "string" }] },
      { at: 1.5, typeDuration: 0.5, tokens: [{ text: "run: ci", type: "plain" }] }
    ] } }
  }]
};
const models = (scene) => resolveModule(scene, story);

test("one keystroke per visible character, at its charTime, plus enter between lines", () => {
  const model = models(story.scenes[0]);
  const lines = model.content.lines;
  const { chars } = collectTyping(story, { models });
  const typed = chars.filter((entry) => entry.char !== "\n");
  assert.equal(typed.length, lines[0].charTimes.length + lines[1].charTimes.length);
  assert.deepEqual(typed.filter((entry) => entry.line === 0).map((entry) => entry.at), lines[0].charTimes);
  assert.deepEqual(typed.filter((entry) => entry.line === 0).map((entry) => entry.char).join(""), "cache: npm");
  const enters = chars.filter((entry) => entry.char === "\n");
  assert.equal(enters.length, 1, "one return between the two lines, none after the last");
  assert.ok(enters[0].at > lines[0].charTimes.at(-1) && enters[0].at < lines[1].charTimes[0]);
  // 10 + 7 characters typed in 0.6 s and 0.5 s stay under 25 keys/s, so all survive.
  const schedule = typingSchedule({ chars }, { seed: "story" });
  assert.equal(schedule.filter((entry) => entry.kind !== "enter").length, 17);
  assert.equal(schedule.filter((entry) => entry.kind === "space").length, 2);
  assert.equal(schedule.filter((entry) => entry.kind === "enter").length, 1);
  assert.deepEqual(schedule, typingSchedule({ chars }, { seed: "story" }), "the schedule is deterministic");
});

test("the rate cap thins fast typing deterministically and keeps word breaks", () => {
  // 120 characters in one second: far over the 25 keys/s cap.
  const chars = Array.from({ length: 120 }, (_, index) => ({ at: index / 120, char: index % 6 === 5 ? " " : "a", shot: "s1", line: 0, index }));
  const kept = thinKeys(chars, 25);
  assert.ok(kept.length <= 26 && kept.length >= 20, `kept ${kept.length}`);
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i].at - kept[i - 1].at;
    const heavy = keyKind(kept[i].char) !== "key";
    assert.ok(gap >= (heavy ? 0.6 : 1) / 25 - 1e-9, `gap ${gap}`);
  }
  assert.ok(kept.some((entry) => entry.char === " "), "spaces survive thinning");
  assert.deepEqual(thinKeys(chars, 25), kept);
  const schedule = typingSchedule({ chars }, { seed: "x", maxRate: 15 });
  assert.ok(schedule.length <= 16);
});

test("spaces and newlines use heavier keys; level and pitch jitter stay in range", () => {
  assert.equal(keyKind(" "), "space");
  assert.equal(keyKind("\n"), "enter");
  assert.equal(keyKind("x"), "key");
  const chars = Array.from({ length: 40 }, (_, index) => ({ at: index * 0.1, char: index % 4 === 3 ? " " : "k", shot: "s1", line: 0, index }));
  const schedule = typingSchedule({ chars }, { seed: "jitter" });
  for (const entry of schedule) {
    assert.ok(Math.abs(entry.semitones) <= 1.5);
    assert.ok(Math.abs(entry.gainDb) <= 1.5);
  }
  assert.ok(new Set(schedule.map((entry) => entry.semitones)).size > 10, "pitch varies per key");
  const placed = assignVariants(schedule, { key: 4, space: 2 });
  const keys = placed.filter((entry) => entry.kind === "key");
  for (let i = 1; i < keys.length; i++) assert.notEqual(keys[i].variant, keys[i - 1].variant, "no immediate repeat of a key variant");
  // Heavier keys are louder in the mix.
  const tone = (amp) => ({ channels: [new Float32Array(480).fill(amp), new Float32Array(480).fill(amp)], onsetMs: 0 });
  const { channels, keystrokes } = mixTyping([
    { at: 0.1, kind: "key", pick: 0.1, gainDb: 0, semitones: 0 },
    { at: 0.3, kind: "space", pick: 0.1, gainDb: 0, semitones: 0 },
    { at: 0.5, kind: "enter", pick: 0.1, gainDb: 0, semitones: 0 }
  ], { key: [tone(1)], space: [tone(1)], enter: [tone(1)] }, { duration: 1 });
  const at = (seconds) => channels[0][Math.round(seconds * 48000) + 10];
  assert.ok(at(0.3) > at(0.1) && at(0.5) > at(0.3));
  assert.equal(keystrokes.length, 3);
  assert.equal(pitchShift(new Float32Array(1200), 12).length, 600, "+12 semitones halves the length");
});

test("keys land their transient on the scheduled time", () => {
  const click = new Float32Array(480);
  click[96] = 1; // transient 2 ms into the file
  const { channels } = mixTyping([{ at: 0.5, kind: "key", pick: 0, gainDb: 0, semitones: 0 }], { key: [{ channels: [click, click], onsetMs: 2 }] }, { duration: 1, gains: { key: 1 } });
  const peak = channels[0].reduce((best, value, index) => (value > channels[0][best] ? index : best), 0);
  assert.equal(peak, 24000);
});

test("per-word kinetic text gets soft word ticks, skipped near keystrokes", () => {
  const words = [{ at: 1, shot: "s2", word: "word-1" }, { at: 1.02, shot: "s2", word: "word-2" }, { at: 2, shot: "s2", word: "word-3" }];
  const chars = [{ at: 2.01, char: "a", shot: "s1", line: 0, index: 0 }];
  const schedule = typingSchedule({ chars, words }, { seed: "w" });
  assert.deepEqual(schedule.map((entry) => [entry.kind, entry.at]), [["word", 1], ["key", 2.01]]);
  assert.equal(typingSchedule({ chars, words }, { seed: "w", words: false }).length, 1);
  // An emphasis-caption exposes word-<i> events.
  const emphasis = { ...story, format: { ...story.format }, scenes: [{ id: "e1", module: "emphasis-caption", start: 0, end: 3, params: { text: "Ship it now" } }] };
  const collected = collectTyping(emphasis, { models: (scene) => resolveModule(scene, emphasis) });
  assert.equal(collected.words.length, 2, "words 1 and 2 (word 0 is the cued pop)");
});
