// Caption legibility (docs/DIRECTION_GUARDRAILS.md §3): per-line plates,
// the measurement on rendered pixels, predicted plates, and the style rule.
import test from "node:test";
import assert from "node:assert/strict";
import { captionLegiblePlate, captionPlan, captionPresetName } from "@launchclip/core/captions.mjs";
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
  // The first brand colour that reaches 7:1, so the plate stays in the palette.
  assert.equal(captionLegiblePlate("#f4f1ea", brand.colors), "#101820");
  assert.equal(captionLegiblePlate("#101820", brand.colors), "#f4f1ea");
  assert.equal(captionLegiblePlate("#808080", brand.colors), "#0b0d12", "no brand colour reaches 7:1: the most contrast wins");
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

test("on a plate, a preset colour that matches the plate is not read as the text", () => {
  const { lines, options } = captionLines(story({ plates: "all" }), chunks);
  const rect = captionBandRect(options, { width: 1080, height: 1920 });
  const plate = rgb(lines[0].plate);
  const line = { x: 360, y: rect.y + 80, width: 360, height: 70 };
  const under = { x: 330, y: rect.y + 60, width: 420, height: 110, color: plate };
  // The text is the preset's idle colour on its plate; a second preset colour equals the plate.
  const result = lineLegibility(image({ bg: [16, 24, 32], text: rgb(lines[0].colors[0]), rect: line, under }), rect, [lines[0].colors[0], lines[0].plate], { size: options.size, chars: 10, plate: lines[0].plate });
  assert.equal(result.legible, true, JSON.stringify(result));
});

test("a plated line is judged against its plate, even when the night behind it matches the text colour", () => {
  const { lines, options } = captionLines(story({ plates: "all" }), chunks);
  const rect = captionBandRect(options, { width: 1080, height: 1920 });
  const text = rgb(lines[0].colors[0]);
  const line = { x: 360, y: rect.y + 80, width: 360, height: 70 };
  const plate = { x: 330, y: rect.y + 66, width: 420, height: 98, color: rgb(lines[0].plate) };
  // The frame around the plate is the text's own colour (dark text, dark night).
  const result = lineLegibility(image({ bg: text, text, rect: line, under: plate }), rect, lines[0].colors, { size: options.size, chars: 10, plate: lines[0].plate });
  assert.equal(result.onPlate, true);
  assert.equal(result.legible, true, JSON.stringify(result));
});

// The caption's own backing, not the floor around it (the gate used to read
// white text on its dark plate against the tan floor beside the plate).
const TAN = [200, 185, 160];
const blend = (top, bottom, alpha) => top.map((v, i) => Math.round(v * alpha + bottom[i] * (1 - alpha)));

test("a line on its preset plate (85% opaque) is measured against the plate, not the tan floor beside it", () => {
  const s = story({ preset: "typewriter" });
  const { lines, options } = captionLines(s, chunks);
  assert.deepEqual(lines[0].backing, { color: options.colors.plate, alpha: 0xd9 / 255 });
  const rect = captionBandRect(options, s.format);
  const text = rgb(options.colors.idle);
  const line = { x: 360, y: rect.y + 80, width: 360, height: 70 };
  // The plate as rendered: its colour at 85% over the floor.
  const plate = { x: 330, y: rect.y + 64, width: 420, height: 102, color: blend(rgb(options.colors.plate), TAN, 0xd9 / 255) };
  const frame = image({ bg: TAN, text, rect: line, under: plate });
  const backed = lineLegibility(frame, rect, lines[0].colors, { size: options.size, chars: 10, plate: lines[0].backing.color, plateAlpha: lines[0].backing.alpha });
  assert.equal(backed.onPlate, true, JSON.stringify(backed));
  assert.equal(backed.legible, true, JSON.stringify(backed));
  assert.ok(backed.contrast >= 7, JSON.stringify(backed));
});

test("chip captions are measured against each word's chip, not the pale floor between and around the chips", () => {
  // A dark style: white ink on near-black chips (the bubble preset), over a pale grey floor.
  const FLOOR = [170, 180, 190];
  const dark = { ...brand, colors: { ...brand.colors, ink: "#ffffff", paper: "#121212", bg: "#121212" } };
  const s = { ...story({ preset: "bubble" }), brand: dark };
  const { lines, options } = captionLines(s, chunks);
  assert.deepEqual(lines[0].backing, { color: options.colors.chip, alpha: 1 });
  const rect = captionBandRect(options, s.format);
  const ink = rgb(options.colors.idle), chip = rgb(options.colors.chip);
  const width = 1080, height = 1920;
  const draw = (withChips) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const put = (x, y, [r, g, b]) => { const o = (y * width + x) * 4; pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255; };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, FLOOR);
    // Four word chips with the floor between them (gap 0.2 em), hugging the glyphs (3 px above, 5 px below).
    const top = rect.y + 70;
    for (const word of [{ x: 240, w: 130 }, { x: 382, w: 150 }, { x: 544, w: 120 }, { x: 676, w: 150 }]) {
      if (withChips) for (let y = top; y < top + 50; y++) for (let x = word.x; x < word.x + word.w; x++) put(x, y, chip);
      for (let y = top + 3; y < top + 45; y++) for (let x = word.x + 8; x < word.x + word.w - 8; x++) if ((x >> 3) % 2 === 0) put(x, y, ink);
    }
    return { width, height, pixels };
  };
  const backed = lineLegibility(draw(true), rect, lines[0].colors, { size: options.size, chars: 12, plate: lines[0].backing.color });
  assert.equal(backed.onPlate, true, JSON.stringify(backed));
  assert.equal(backed.legible, true, JSON.stringify(backed));
  // Judged against everything around the line (the old reading), the floor between the chips fails it.
  const generic = lineLegibility(draw(true), rect, lines[0].colors, { size: options.size, chars: 12 });
  assert.equal(generic.legible, false, JSON.stringify(generic));
  // With no chips drawn, white on the pale floor does not read, backing or not.
  assert.equal(lineLegibility(draw(false), rect, lines[0].colors, { size: options.size, chars: 12, plate: lines[0].backing.color }).legible, false);
});

test("a plate the same colour as its text still fails: the backing is measured, not assumed", () => {
  const { lines, options } = captionLines(story({ plates: "all" }), chunks);
  const rect = captionBandRect(options, { width: 1080, height: 1920 });
  const text = rgb(lines[0].colors[0]);
  const line = { x: 360, y: rect.y + 80, width: 360, height: 70 };
  // A plate drawn a few levels off the text colour (a light plate under light text).
  const close = text.map((v) => Math.max(0, v - 12));
  const result = lineLegibility(image({ bg: TAN, text, rect: line, under: { x: 330, y: rect.y + 64, width: 420, height: 102, color: close } }), rect, lines[0].colors, { size: options.size, chars: 10, plate: lines[0].backing.color, plateAlpha: lines[0].backing.alpha });
  assert.notEqual(result.legible, true, JSON.stringify(result));
});
