// The long-form look in the director's storyboards (kit/core/beat-director.mjs
// beatMapToStory): a plate per chapter, the glass-explainer panel, the
// subscribe pill at each call to action and the channel watermark.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { beatMapToStory, directLongForm, dryRunWords, windowWords } from "../kit/core/beat-director.mjs";
import { cutShorts } from "../kit/core/cutdown.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { scenePlateSpec } from "../kit/core/plates.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";

const FIXTURE = path.resolve("eval/fixtures/long-form-16min");
const script = readFileSync(path.join(FIXTURE, "SCRIPT.md"), "utf8");
const ledger = JSON.parse(readFileSync(path.join(FIXTURE, "research", "evidence.json"), "utf8"));
const captures = readdirSync(path.join(FIXTURE, "research", "captures")).sort().map((name) => JSON.parse(readFileSync(path.join(FIXTURE, "research", "captures", name), "utf8")));
const timed = dryRunWords(script, { wpm: 155 });
const STRUCTURE = { ctas: [210, 580, 900].map((at) => ({ at, action: "Subscribe for the next breakdown" })), stings: true };
const CHANNEL = { name: "Signal Lab", tagline: "AI, explained weekly" };
const input = { words: timed.words, chapters: timed.chapters, ledger, captures, title: timed.title };
let branded = null, plain = null;
const brandedMap = () => (branded ??= directLongForm(input, { ...STRUCTURE, stingBrand: CHANNEL }));
const plainMap = () => (plain ??= directLongForm(input, STRUCTURE));
const states = (map) => map.chapters.flatMap((chapter) => chapter.shots.flatMap((shot) => shot.states));
const resolves = (story, from, to) => {
  const resolved = resolveStory(story, { words: windowWords(timed.words, from, to) });
  const check = validateStory(resolved);
  assert.equal(check.ok, true, check.errors.join("\n"));
  for (const scene of resolved.scenes) assert.doesNotThrow(() => resolveModule(scene, resolved), scene.id);
  return resolved;
};

test("director look: each chapter keeps one plate and the next chapter changes it", () => {
  const map = plainMap();
  const kinds = map.chapters.map((chapter) => chapter.plate.kind);
  for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1], `chapters ${i - 1} and ${i} share a plate kind`);
  assert.ok(new Set(kinds).size >= 3, "the kinds cycle");
  // A window across a chapter boundary: every scene sits on its chapter's plate, and the plate changes only at the boundary.
  const boundary = map.chapters[2].start, from = boundary - 10, to = boundary + 10;
  const story = resolves(beatMapToStory(map, { from, to }), from, to);
  assert.equal(story.chapters.length, 2);
  const local = boundary - from;
  for (const scene of story.scenes.filter((entry) => (entry.track ?? 0) === 0)) {
    const want = scene.start + 1e-6 >= story.chapters[1].start ? map.chapters[2].plate : map.chapters[1].plate;
    assert.equal(scenePlateSpec(story, scene).kind, want.kind, `${scene.id} at ${scene.start}`);
  }
  assert.ok(story.scenes.some((scene) => Math.abs(scene.start - local) < 3), "a scene starts near the boundary");
  // Inside one chapter, the window's plate is the story's.
  const inside = beatMapToStory(map, { from: map.chapters[1].start + 5, to: map.chapters[1].start + 35 });
  assert.equal(inside.chapters, undefined);
  assert.deepEqual(inside.plate, map.chapters[1].plate);
  assert.equal(beatMapToStory(map, { from: 0, to: 30, plates: false }).plate, undefined);
});

test("director look: glass-explainer names the style and its rim-glass panel; other styles do not", () => {
  const map = plainMap();
  const glass = beatMapToStory(map, { from: 40, to: 70, style: "glass-explainer" });
  assert.equal(glass.style, "glass-explainer");
  assert.equal(glass.panel.treatment, "rim-glass");
  resolves(glass, 40, 70);
  const other = beatMapToStory(map, { from: 40, to: 70 });
  assert.equal(other.style, undefined);
  assert.equal(other.panel, undefined);
});

test("director look: with a channel the stings are logo-stings, each call to action a subscribe pill on track 1, and a watermark spans the video", () => {
  const map = brandedMap();
  assert.deepEqual(map.channel, CHANNEL);
  const all = states(map);
  assert.equal(all[0].module, "logo-sting");
  assert.equal(all[0].params.name, "Signal Lab");
  assert.equal(all.at(-1).module, "logo-sting");
  for (const at of [210, 580, 900]) {
    const from = at - 12, to = at + 12;
    const story = resolves(beatMapToStory(map, { from, to }), from, to);
    const pills = story.scenes.filter((scene) => scene.module === "subscribe-cta");
    assert.equal(pills.length, 1, `one pill at ${at}`);
    assert.equal(pills[0].track, 1);
    // It lands with the clause that carries the call (which covers the slot), at most a clause early.
    const clause = all.find((state) => state.kind === "cta" && state.start - 0.6 <= at && at < state.end);
    assert.ok(Math.abs(pills[0].start - (clause.start - from)) < 1e-6 && pills[0].start <= at - from + 0.6, `the pill lands with the call (${pills[0].start} vs ${at - from})`);
    assert.ok(pills[0].end - pills[0].start >= 4);
    assert.ok(!story.scenes.some((scene) => scene.module === "cta"), "no cta card under the pill");
    const mark = story.scenes.find((scene) => scene.module === "channel-watermark");
    assert.deepEqual([mark.track, mark.start, mark.end], [2, 0, story.format.duration]);
  }
});

test("director look: no channel keeps the cta card, and Shorts cut from the map stay as they were", () => {
  const map = plainMap();
  assert.equal(map.channel, undefined);
  assert.notEqual(states(map)[0].module, "logo-sting");
  assert.equal(states(map)[0].params.text, "Halcyon 2, explained", "without a channel the sting is the video's title");
  const story = beatMapToStory(map, { from: 198, to: 222 });
  assert.ok(!story.scenes.some((scene) => ["subscribe-cta", "channel-watermark"].includes(scene.module)));
  assert.ok(story.scenes.some((scene) => scene.module === "cta"));
  for (const short of cutShorts(brandedMap(), timed.words, { count: 3 })) {
    assert.ok(!short.story.scenes.some((scene) => ["subscribe-cta", "channel-watermark"].includes(scene.module)), short.id);
    assert.equal(short.story.plate, undefined, short.id);
    assert.equal(short.story.chapters, undefined, short.id);
  }
});
