// Tooling keeps cards off the presenter's face (src/face_clear_fit.js): a
// card over the head is moved beside, above or below it, or resized to fit
// there; a card already clear is left alone; with no face data the default
// head stands in, and the warning says so.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { validateSubjectTrack } from "@launchclip/core/subject.mjs";
import { FACE_CLEAR, fitFaceClear, presenterHeadLocator, sceneBox } from "../src/face_clear_fit.js";
import { parseConstraints } from "../src/constraints.js";
import { appFacesTrack } from "../src/subject/project.js";
import { planStoryboard } from "../src/storyboard_planner.js";

const CANVAS = { width: 1080, height: 1920 };
const GAP = Math.round(FACE_CLEAR.margin * 1080);

function talkingHead(scenes, extra = {}) {
  return {
    schema: "launchclip.story.v1",
    lane: "footage-led",
    format: { width: 1080, height: 1920, fps: 30, duration: 20 },
    base: { src: "assets/recording.mp4" },
    brand: DEFAULT_BRAND,
    overlays: [{ type: "captions", style: "word-highlight" }],
    scenes,
    ...extra
  };
}

// A whole-video head track: the head centred, its top at 18% of the height.
const HEAD = { x: 0.5, y: 0.255, w: 0.24, h: 0.15 };
const track = {
  source: { width: 1080, height: 1920 },
  fps: 10,
  frames: Array.from({ length: 201 }, (_, i) => ({ t: i / 10, head: HEAD, body: { x: 0.5, y: 0.65, w: 0.6, h: 0.7 } }))
};
const headPx = { x: (HEAD.x - HEAD.w / 2) * 1080, y: (HEAD.y - HEAD.h / 2) * 1920, width: HEAD.w * 1080, height: HEAD.h * 1920 };

function overlaps(a, b, by = 0) {
  return Math.min(a.x + a.width, b.x + b.width + by) - Math.max(a.x, b.x - by) > 0 && Math.min(a.y + a.height, b.y + b.height + by) - Math.max(a.y, b.y - by) > 0;
}

function drawn(story, id) {
  const resolved = resolveStory(structuredClone(story), { track });
  return sceneBox(resolved.scenes.find((scene) => scene.id === id), resolved, CANVAS);
}

const hook = { id: "hook", module: "polaroid", track: 1, start: 0.5, end: 3, params: { caption: "Before", tilt: -6 } };
const stat = { id: "stat", module: "count-up", track: 1, start: 5, end: 8, params: { value: 3.5, label: "weeks", decimals: 1 } };

test("the head locator reads the track through the base, and falls back to the default head", () => {
  const measured = presenterHeadLocator(resolveStory(talkingHead([]), { track }));
  assert.equal(measured.source, "track");
  const head = measured.at(1);
  for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(head[key] - headPx[key]) < 1, `${key}: ${head[key]} vs ${headPx[key]}`);
  const guessed = presenterHeadLocator(resolveStory(talkingHead([])));
  assert.equal(guessed.source, "default");
  const fallback = guessed.at(1);
  assert.deepEqual([fallback.x, fallback.y, fallback.width, Math.round(fallback.height * 10) / 10], [432, 576, 216, 249.6]);
  // A story with its subject off has no presenter to keep clear of.
  assert.equal(presenterHeadLocator(resolveStory(talkingHead([], { base: { src: "assets/recording.mp4", subject: "off" } }))), null);
});

test("a polaroid hook over the presenter's face is moved off it", () => {
  const story = talkingHead([hook]);
  assert.ok(overlaps(drawn(story, "hook"), headPx), "the default polaroid sits over the face");
  const { storyboard, moved, kept, source } = fitFaceClear(story, { track });
  assert.equal(source, "track");
  assert.deepEqual(kept, []);
  assert.equal(moved.length, 1);
  assert.match(moved[0], /^hook (resized and )?moved (above|below|to the left of|to the right of) the presenter's (head|face) \(0\.5–3 s\)$/);
  const rect = storyboard.scenes[0].params.rect;
  assert.ok(rect, "the polaroid now has a rect");
  assert.equal(overlaps(drawn(storyboard, "hook"), headPx, GAP / 2 - 1), false, JSON.stringify(rect));
  // Its own params are kept; the input is not mutated.
  assert.equal(storyboard.scenes[0].params.caption, "Before");
  assert.equal(story.scenes[0].params.rect, undefined);
});

test("a stat over the presenter's head is moved off it", () => {
  const story = talkingHead([stat]);
  assert.ok(overlaps(drawn(story, "stat"), headPx));
  const { storyboard, moved } = fitFaceClear(story, { track });
  assert.match(moved.join("\n"), /^stat .*\(5–8 s\)$/);
  assert.equal(overlaps(drawn(storyboard, "stat"), headPx, GAP / 2 - 1), false, JSON.stringify(storyboard.scenes[0].params.rect));
});

test("a card clear of the face, a card behind the presenter and an insert are left alone", () => {
  const below = { ...hook, id: "below", params: { ...hook.params, rect: { x: 80, y: 720, width: 860, height: 440 } } };
  const behind = { ...stat, id: "behind", layer: "behind" };
  const insert = { id: "full", module: "count-up", insert: true, start: 10, end: 13, params: { value: 12, label: "days" } };
  const story = talkingHead([below, behind, insert]);
  assert.equal(overlaps(drawn(story, "below"), headPx), false);
  const { storyboard, moved, kept } = fitFaceClear(story, { track });
  assert.deepEqual(moved, []);
  assert.deepEqual(kept, []);
  assert.equal(storyboard, story, "nothing changed, so the same storyboard comes back");
});

test("with no face data the default head stands in, and the warning says so", () => {
  const { storyboard, moved } = fitFaceClear(talkingHead([stat]));
  assert.match(moved.join("\n"), /^stat .*no face data, so the default head\)$/);
  const head = { x: 432, y: 576, width: 216, height: 249.6 };
  assert.equal(overlaps(drawn(storyboard, "stat"), head, GAP / 2 - 1), false);
});

test("a motion story is not a talking head: nothing to fit", () => {
  const motion = { ...talkingHead([stat]), lane: "motion" };
  delete motion.base;
  assert.deepEqual(fitFaceClear(motion).moved, []);
});

test("the app's face boxes (constraints faces) become a valid head track", () => {
  const parsed = parseConstraints({ version: 1, faces: [{ t: 1, box: { x: 0.38, y: 0.18, width: 0.24, height: 0.15 } }, { t: 0, box: { x: 0.38, y: 0.18, width: 0.24, height: 0.15 } }, { t: 2, box: null }] });
  assert.equal(parsed.ok, true, parsed.errors.join("\n"));
  assert.deepEqual(parsed.constraints.faces.map((face) => face.t), [0, 1, 2]);
  const source = { sha256: "a".repeat(64), width: 1080, height: 1920, fps: 30, duration: 3 };
  const built = appFacesTrack(parsed.constraints.faces, source);
  assert.deepEqual(validateSubjectTrack(built), { ok: true, errors: [] });
  assert.deepEqual(built.frames[0].head, { x: 0.5, y: 0.255, w: 0.24, h: 0.15 });
  assert.equal(built.frames[2].head, null);
  assert.equal(built.fps, 1);
  const bad = parseConstraints({ version: 1, faces: [{ t: 1, box: { x: 0.9, y: 0.1, width: 0.2, height: 0.1 } }, { t: -1, box: null }] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join("\n"), /faces\[0\]\.box must be null or/);
  assert.match(bad.errors.join("\n"), /faces\[1\]\.t must be seconds/);
});

test("the planner moves a hook off the face with the head track, and says so", async () => {
  const words = ["Three", "things", "to", "check", "before", "you", "buy", "a", "camper"].map((text, i) => ({ text, start: 0.2 + i * 0.5, end: 0.6 + i * 0.5 }));
  const board = talkingHead([{ ...hook, start: 0.5, end: 3 }], { format: { width: 1080, height: 1920, fps: 30, duration: 5 }, audio: { words: "NARRATION.json" } });
  const client = { provider: "openai", async runStructured() { return { model: "gpt-5.6-luna", value: { storyboard_json: JSON.stringify(board) }, usage: { input_tokens: 1, output_tokens: 1 } }; } };
  const report = await planStoryboard({ brief: "Three checks before buying.", words, lane: "footage-led", format: board.format, base: board.base.src, audio: board.audio, tier: "guided", model: "openai:gpt-5.6-luna", client, direction: false, maxRepairs: 0, subjectTrack: track });
  assert.ok(report.storyboard, JSON.stringify(report.errors));
  const scene = report.storyboard.scenes.find((entry) => entry.id === "hook");
  assert.ok(scene.params.rect, JSON.stringify(report.warnings));
  assert.equal(overlaps(drawn(report.storyboard, "hook"), headPx, GAP / 2 - 1), false);
  assert.ok(report.warnings.some((warning) => /^face: tooling hook (resized and )?moved/.test(warning)), report.warnings.join("\n"));
});
