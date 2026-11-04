// Caption highlight colours over footage (kit/core/captions.mjs
// captionHighlightColor): an active, spoken or accent colour that would not
// read as text over footage is replaced, and a colour the story set
// explicitly is reported.
import assert from "node:assert/strict";
import test from "node:test";

import { CAPTION_FOOTAGE_CONTRAST, CAPTION_HIGHLIGHT_CONTRAST, CAPTION_HIGHLIGHT_DISTANCE, CAPTION_SHADOW_BACKDROP, captionColorWarnings, captionContrast, captionHighlightColor, captionOptions } from "@launchclip/core/captions.mjs";
import { validateStory } from "../src/story_cli.js";

const GREEN = { primary: "#1f5a3a", accent: "#2e7d4f", paper: "#ffffff", ink: "#0b0b0f", bg: "#0e1a12" };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((c, i) => c - rgb(b)[i]));
const readsOverFootage = (hex, idle = "#ffffff") => captionContrast(hex, CAPTION_SHADOW_BACKDROP) >= CAPTION_FOOTAGE_CONTRAST && distance(hex, idle) >= CAPTION_HIGHLIGHT_DISTANCE;

test("a dark brand primary as the active word is lightened toward a readable tint of itself", () => {
  const o = captionOptions({ type: "captions", preset: "word-highlight" }, { brand: { colors: GREEN } });
  assert.notEqual(o.colors.active, GREEN.primary);
  assert.ok(readsOverFootage(o.colors.active), `${o.colors.active} reads over footage`);
  const [r, g, b] = rgb(o.colors.active);
  assert.ok(g > r && g > b, "the tint stays green");
  assert.deepEqual(o.colorFixes.map(({ key, from, via, explicit }) => ({ key, from, via, explicit })), [{ key: "active", from: GREEN.primary, via: "tint", explicit: false }]);
});

test("a dark accent is guarded where the preset draws accent words", () => {
  const o = captionOptions({ type: "captions", preset: "quiet-accent" }, { brand: { colors: GREEN } });
  assert.ok(readsOverFootage(o.colors.accent));
  assert.deepEqual(o.colorFixes.map((fix) => fix.key), ["accent"]);
  // minimal-line draws no accent words and no active colour: nothing changes.
  assert.deepEqual(captionOptions({ type: "captions", preset: "minimal-line" }, { brand: { colors: GREEN } }).colorFixes, []);
});

test("the brand colour that contrasts most replaces a highlight that does not read", () => {
  const brand = { colors: { ...GREEN, accent: "#ffd84a" } };
  const o = captionOptions({ type: "captions", preset: "word-highlight" }, { brand });
  assert.equal(o.colors.active, "#ffd84a");
  assert.equal(o.colorFixes[0].via, "brand");
});

test("a highlight too close to the idle colour is replaced even when it is light", () => {
  const out = captionHighlightColor("#fafafa", { idle: "#ffffff", brandColors: { primary: "#fafafa", accent: "#46d4ff" } });
  assert.deepEqual(out, { color: "#46d4ff", via: "brand" });
});

test("readable highlights are kept, and the default brand colours pass untouched", () => {
  assert.deepEqual(captionHighlightColor("#ffd23f", {}), { color: "#ffd23f", via: "kept" });
  assert.deepEqual(captionOptions({ type: "captions" }, {}).colorFixes, []);
  assert.deepEqual(captionOptions({ type: "captions", preset: "split-color" }, { brand: { colors: { primary: "#ffcc00", accent: "#46d4ff" } } }).colorFixes, []);
});

test("on a plate or band the highlight is judged against that colour", () => {
  // Over a light band a dark highlight reads: kept.
  assert.deepEqual(captionHighlightColor("#1f5a3a", { idle: "#0b0b0f", under: "#f2f2f2" }), { color: "#1f5a3a", via: "kept" });
  // Over a light band a light highlight does not: darkened toward a tint that reads.
  const out = captionHighlightColor("#c8f0d8", { idle: "#0b0b0f", under: "#f2f2f2" });
  assert.equal(out.via, "tint");
  assert.ok(captionContrast(out.color, "#f2f2f2") >= CAPTION_HIGHLIGHT_CONTRAST);
});

test("with nothing that reads, the highlight falls back to the default", () => {
  // Grey on a grey band beside black idle text: every darker tint either stays too faint or comes too close to the idle black.
  const out = captionHighlightColor("#767676", { key: "accent", idle: "#000000", under: "#767676", brandColors: {} });
  assert.equal(out.via, "default");
  assert.equal(out.color, "#46d4ff");
});

test("explicit caption colours a story sets are guarded and reported by validation", () => {
  const story = {
    schema: "launchclip.story.v1",
    lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration: 4 },
    brand: { colors: { primary: "#ffcc00" } },
    scenes: [{ id: "s1", start: 0, end: 4, module: "title-card", params: { title: "Hello" } }],
    overlays: [{ type: "captions", colors: { active: "#123d22" } }]
  };
  const o = captionOptions(story.overlays[0], { brand: story.brand });
  assert.equal(o.colors.active, "#ffcc00");
  const warnings = captionColorWarnings(story);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /captions\.colors\.active #123d22 .*using #ffcc00/);
  const validation = validateStory(story);
  assert.ok(validation.warnings.some((line) => line.startsWith("captions.colors.active #123d22")), validation.warnings.join("\n"));
  // A brand role the story names is guarded too, but not reported as the story's own colour.
  assert.deepEqual(captionColorWarnings({ ...story, brand: { colors: GREEN }, overlays: [{ type: "captions" }] }), []);
});
