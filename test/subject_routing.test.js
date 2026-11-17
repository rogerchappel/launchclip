// Subjects (docs/EXPLAINER_CLAIMS_RFC.md §3.2): a direction-map line with a
// subject resolves to footage that shows it, else an illustration, else hero
// type; the headless planner and the skills route through the same function,
// and a subject left on a flat panel, a boxed photo or a gradient is flagged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_BRAND, directionMapReference, planningPrompt, routeSubjects, subjectResolutionLines } from "@launchclip/core/planning-prompt.mjs";
import { SUBJECT_FALLBACK_IS_ERROR, subjectFallbackNotes } from "../src/subject_fallback.js";
import { checkStoryboard } from "../src/storyboard_planner.js";

const SKILLS = ["launchclip-create-video", "launchclip-create-video-remotion"];
const MAP = { schema: "launchclip.direction-map.v1", sections: [{ id: "s1", lines: [
  { words: [0, 4], intent: "claim", treatment: "insert", scenes: ["a"], subject: "chair legs dent it" },
  { words: [5, 9], intent: "claim", treatment: "insert", scenes: ["b"], subject: "the sun greys it in a summer" },
  { words: [10, 12], intent: "number", treatment: "insert", scenes: ["c"], subject: "three hundred dollars a year" },
  { words: [13, 14], intent: "cta", treatment: "insert", scenes: ["d"] }
] }] };
const POINTS = [
  { item: "treated pine", fact: "chair legs dent it", kind: "consequence", words: "chair legs dent it" },
  { item: "hardwood", fact: "the sun greys it in a summer", kind: "consequence", words: "the sun greys it" },
  { item: "composite", fact: "three hundred dollars a year", kind: "number", words: "three hundred dollars a year" }
];
const MEDIA = [{ src: "assets/dent.mp4", kind: "video", description: "A chair dragged across a pine deck leaves dents in the boards" }];

test("a subject no shot shows routes to illustration; one a shot shows keeps the footage; a number is not routed", () => {
  assert.deepEqual(routeSubjects(MAP, { media: MEDIA, points: POINTS }), [
    { words: [0, 4], subject: "chair legs dent it", kind: "consequence", route: "footage", media: "assets/dent.mp4" },
    { words: [5, 9], subject: "the sun greys it in a summer", kind: "consequence", route: "illustration" }
  ]);
  assert.deepEqual(routeSubjects(MAP, { points: POINTS }).map((entry) => entry.route), ["illustration", "illustration"]);
});

test("the headless planner and the skills route subjects alike", async () => {
  const routes = routeSubjects(MAP, { media: MEDIA, points: POINTS });
  const prompt = planningPrompt({ tier: "guided", lane: "voiceover-motion", format: { width: 1080, height: 1920, fps: 30, duration: 20 }, brand: DEFAULT_BRAND, direction: MAP, subjects: routes });
  for (const line of subjectResolutionLines()) assert.ok(prompt.includes(line), line);
  assert.match(prompt, /words \[0, 4\] "chair legs dent it": footage \(assets\/dent\.mp4 shows it\)/);
  assert.match(prompt, /words \[5, 9\] "the sun greys it in a summer": illustration/);
  assert.match(prompt, /wear for decay.*measure for an amount.*count for a duration.*compare for options.*cause for a force.*before-after for a transformation/);
  for (const skill of SKILLS) {
    // The skill's copy of the routing (synced from kit/core) gives the same answer, and its reference states the same rule.
    const copy = await import(fileURLToPath(new URL(`../skills/${skill}/scripts/planning-prompt.mjs`, import.meta.url)));
    assert.deepEqual(copy.routeSubjects(MAP, { media: MEDIA, points: POINTS }), routes, skill);
    const reference = await readFile(fileURLToPath(new URL(`../skills/${skill}/references/direction-map.md`, import.meta.url)), "utf8");
    assert.equal(reference, directionMapReference(), `${skill} has the generated reference`);
    for (const line of subjectResolutionLines()) assert.ok(reference.includes(line), `${skill}: ${line}`);
  }
});

const W = 1080, H = 1920;
const story = (scenes) => ({ format: { width: W, height: H, duration: 6 }, resolved: { duration: 6 }, scenes });
const words = "chair legs dent it badly".split(" ").map((text, i) => ({ text, start: i, end: i + 0.8 }));
const map = { schema: "launchclip.direction-map.v1", sections: [{ id: "s1", lines: [{ words: [0, 4], intent: "claim", treatment: "insert", scenes: ["a"], subject: "chair legs dent it" }] }] };

test("a subject on a boxed photo, a flat panel or an object-card is flagged; an illustration or hero type is not", () => {
  const notes = (scene, rects) => subjectFallbackNotes(story([{ id: "a", start: 0, end: 5, ...scene }]), rects, { direction: map, words });
  assert.match(notes({ module: "photo-scene" }, [{ id: "a", role: "media", rect: { x: 240, y: 600, width: 600, height: 600 }, start: 0, end: 5 }])[0], /boxed photo/);
  assert.match(notes({ module: "object-card" }, [])[0], /object-card/);
  assert.match(notes({ module: "concept-card" }, [{ id: "a", role: "text", rect: { x: 100, y: 400, width: 880, height: 200 }, start: 0, end: 5 }])[0], /flat brand panel/);
  assert.deepEqual(notes({ module: "illustration" }, [{ id: "a-plate", role: "media", rect: { x: 0, y: 0, width: W, height: H }, start: 0, end: 5 }]), []);
  assert.deepEqual(notes({ module: "kinetic-words" }, [{ id: "a", role: "hero", rect: { x: 60, y: 500, width: 960, height: 700 }, start: 0, end: 5 }]), []);
  // A line with no subject is not this check's business.
  assert.deepEqual(subjectFallbackNotes(story([{ id: "a", module: "object-card", start: 0, end: 5 }]), [], { direction: { sections: [{ lines: [{ words: [0, 4] }] }] }, words }), []);
});

test("the planner check warns (this release) when a subject falls back to an object-card", () => {
  const storyboard = {
    schema: "launchclip.story.v1", title: "Decks", lane: "voiceover-motion",
    format: { width: W, height: H, fps: 30, duration: 5, platform: "youtube-shorts" }, brand: DEFAULT_BRAND,
    audio: { voice: "assets/audio/narration.wav", words: "NARRATION.json" },
    scenes: [{ id: "a", module: "object-card", start: 0, end: 5, params: { object: "box", caption: "Chair legs dent it" } }],
    overlays: [{ type: "captions", style: "word-highlight" }]
  };
  const checked = checkStoryboard(structuredClone(storyboard), { words, tier: "advanced", direction: map });
  assert.equal(SUBJECT_FALLBACK_IS_ERROR, false);
  assert.ok(checked.warnings.some((w) => /^subject: words \[0, 4\] "chair legs dent it" .*object-card/.test(w)), checked.warnings.join("\n"));
  assert.ok(!checked.errors.some((e) => e.startsWith("subject:")));
});
