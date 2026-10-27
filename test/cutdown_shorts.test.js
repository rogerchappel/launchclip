import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHORTS_FORMAT, chooseShortWindows, cutShorts } from "../kit/core/cutdown.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { TITLE_CARD_MODULES } from "../kit/core/skeleton-library.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";

const FIXTURE = path.resolve("eval/fixtures/long-form-16min");
const map = JSON.parse(readFileSync(path.join(FIXTURE, "BEATMAP.json"), "utf8"));
const words = JSON.parse(readFileSync(path.join(FIXTURE, "NARRATION.json"), "utf8")).words;

test("shorts: windows open on a hook-able clause, one per chapter, never overlapping", () => {
  const windows = chooseShortWindows(map, words, { count: 5 });
  assert.equal(windows.length, 5);
  assert.equal(new Set(windows.map((entry) => entry.chapter)).size, 5);
  for (const a of windows) {
    assert.ok(a.end - a.start >= 20 && a.end - a.start <= 50);
    for (const b of windows) if (a !== b) assert.ok(a.end <= b.start || b.end <= a.start);
  }
});

test("shorts: 3–5 vertical Shorts at short-form cadence, opening on an image and looping", () => {
  const shorts = cutShorts(map, words, { count: 4 });
  assert.equal(shorts.length, 4);
  assert.ok(cutShorts(map, words, { count: 9 }).length <= 5);
  for (const short of shorts) {
    assert.equal(short.report.gate.ok, true, `${short.id}: ${JSON.stringify(short.report.gate.checks.filter((check) => !check.ok))}`);
    const { story } = short;
    assert.deepEqual([story.format.width, story.format.height], [SHORTS_FORMAT.width, SHORTS_FORMAT.height]);
    assert.ok(!TITLE_CARD_MODULES.includes(story.scenes[0].module), story.scenes[0].module);
    assert.equal(story.ending.loop_to, story.scenes[0].id);
    assert.ok(story.overlays.some((overlay) => overlay.type === "captions"));
    const validation = validateStory(story);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    const resolved = resolveStory(story, { words: short.words });
    for (const scene of resolved.scenes) assert.doesNotThrow(() => resolveModule(scene, resolved), `${short.id} ${scene.id} ${scene.module}`);
    // The Short's words are its window's, on its own clock.
    assert.ok(short.words[0].start < 1 && short.words.at(-1).end <= story.format.duration);
  }
  assert.ok(shorts.some((short) => short.skeleton), "a library skeleton fits at least one Short");
});
