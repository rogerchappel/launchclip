// Caption legibility (docs/DIRECTION_GUARDRAILS.md §3): per-line plates,
// the measurement on rendered pixels, predicted plates, and the style rule.
import test from "node:test";
import assert from "node:assert/strict";
import { captionLegiblePlate, captionPlan, captionPresetName } from "../kit/core/captions.mjs";
import { CAPTION_LEGIBILITY, captionBandRect, captionLines, lineLegibility, measureCaptionLegibility, predictCaptionPlates } from "../src/caption_legibility.js";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const chunks = [
  { id: "cap-001", start: 0, end: 1, words: [{ text: "Hello", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }] },
  { id: "cap-002", start: 1.2, end: 2.4, words: [{ text: "away", start: 1.2, end: 1.6 }, { text: "counts", start: 1.6, end: 2.4 }] }
];
const story = (overlay = {}, scenes = []) => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1080, height: 1920, fps: 30, duration: 4 }, overlays: [{ type: "captions", ...overlay }], scenes });

// A canvas-sized RGBA image filled with `bg`, with a block of `text` glyph
// stripes inside rect (a stand-in for a caption line).
function image({ bg, text, rect, under = null }) {
  const width = 1080, height = 1920;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, [r, g, b]) => { const o = (y * width + x) * 4; pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, bg);
  if (under) for (let y = under.y; y < under.y + under.height; y++) for (let x = under.x; x < under.x + under.width; x++) put(x, y, under.color);
  for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) if ((x >> 3) % 2 === 0) put(x, y, text);
  return { width, height, pixels };
}
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test("plates: named lines get a legibility plate that holds the preset's own text colour", () => {
  const plan = captionPlan(chunks, { type: "captions", plates: ["cap-002"] }, { brand, format: { width: 1080, height: 1920 } });
  assert.deepEqual(plan.nodes.map((node) => node.cls), ["lc-cap", "lc-cap lc-cap-legible"]);
  assert.match(plan.css, /\.lc-cap-legible \{ background: #[0-9a-f]{6}eb;/);
  assert.equal(captionLegiblePlate("#f4f1ea", brand.colors), "#0b0d12");
  assert.equal(captionLegiblePlate("#101820", brand.colors), "#ffffff");
  const all = captionPlan(chunks, { type: "captions", plates: "all" }, { brand, format: { width: 1080, height: 1920 } });
  assert.ok(all.nodes.every((node) => node.cls.includes("lc-cap-legible")));
});

test("a style can never forbid the fix: plates keep the style's preset", () => {
  const s = story({ preset: "quiet-accent", plates: ["cap-001"] });
  assert.equal(captionPresetName(s.overlays[0], s), "quiet-accent");
});

test("legibility is measured on pixels: contrast at the worst quarter and camouflage", () => {
  const { lines, options } = captionLines(story(), chunks);
  const rect = captionBandRect(options, { width: 1080, height: 1920 });
  const line = { x: 360, y: rect.y + 80, width: 360, height: 70 };
  const idle = rgb(options.colors.idle);
  const dark = lineLegibility(image({ bg: [16, 24, 32], text: idle, rect: line }), rect, lines[0].colors, { size: options.size, chars: 10 });
  assert.equal(dark.found, true);
  assert.equal(dark.legible, true, JSON.stringify(dark));
  // The same text on a nearly identical colour does not read.
  const pale = lineLegibility(image({ bg: idle.map((v) => Math.max(0, v - 10)), text: idle, rect: line }), rect, lines[0].colors, { size: options.size, chars: 10 });
  assert.equal(pale.legible, false);
  // Teal words on a teal shirt: the surround shares the text colour.
  const shirt = { x: 300, y: rect.y + 40, width: 480, height: 160, color: idle };
  const camo = lineLegibility(image({ bg: [16, 24, 32], text: idle, rect: line, under: shirt }), rect, lines[0].colors, { size: options.size, chars: 10 });
  assert.ok(camo.camouflage > CAPTION_LEGIBILITY.camouflage && camo.legible === false, JSON.stringify(camo));
  // A hidden line (nothing in its colour) is not found, so it is not judged.
  const none = lineLegibility(image({ bg: [16, 24, 32], text: [16, 24, 32], rect: line }), rect, lines[0].colors, { size: options.size, chars: 10 });
  assert.equal(none.found, false);
});

test("measureCaptionLegibility samples every line in the middle of its words", async () => {
  const s = story();
  const times = [];
  const { options } = captionLines(s, chunks);
  const rect = captionBandRect(options, s.format);
  const frame = async (_video, t) => { times.push(t); return image({ bg: t < 1.1 ? [16, 24, 32] : rgb(options.colors.idle).map((v) => v - 6), text: rgb(options.colors.idle), rect: { x: 360, y: rect.y + 80, width: 360, height: 70 } }); };
  const result = await measureCaptionLegibility("video.mp4", s, { chunks, frame });
  assert.deepEqual(result.failed, ["cap-002"]);
  assert.ok(times[0] >= 0.35 && times[0] <= 0.85 && times[1] >= 1.55 && times[1] <= 2.25, times.join());
});

test("lines whose band crosses a character are plated before the first render", () => {
  const s = story();
  const { options } = captionLines(s, chunks);
  const band = captionBandRect(options, s.format);
  const elements = [
    { id: "cast", role: "media", rect: { x: 100, y: band.y - 200, width: 800, height: 400 }, start: 1, end: 4 },
    { id: "plate", role: "decor", rect: { x: 0, y: 0, width: 1080, height: 1920 }, start: 0, end: 4 },
    { id: "card", role: "text", rect: { x: 100, y: band.y, width: 800, height: 100 }, start: 0, end: 1 }
  ];
  assert.deepEqual(predictCaptionPlates(s, chunks, elements), ["cap-002"]);
});
