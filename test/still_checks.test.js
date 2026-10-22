import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { checkLowerThird, checkStill, checkStillFile, checkTextContrast, contrastRatio, dominantColors } from "../src/still_checks.js";
import { decodePng } from "../src/visual_snapshot.js";

// A 108x192 frame is the 1080x1920 Shorts canvas at 1/10 scale.
const CANVAS = { width: 1080, height: 1920 };
const TEXT_RECT = { x: 100, y: 300, width: 600, height: 200 };

test("computes WCAG contrast ratios", () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  assert.equal(contrastRatio([10, 20, 30], [10, 20, 30]), 1);
  assert.ok(Math.abs(contrastRatio([118, 118, 118], [255, 255, 255]) - 4.54) < 0.01);
});

test("finds background and text colours inside a rect, ignoring anti-aliasing", () => {
  const image = decodePng(frame({ text: [250, 250, 250], surface: [20, 22, 30] }));
  const colors = dominantColors(image, { x: 10, y: 30, width: 60, height: 20 });
  assert.deepEqual(colors.background, [20, 22, 30]);
  assert.deepEqual(colors.foreground, [250, 250, 250]);
  assert.ok(colors.foregroundShare > 0.1);
});

test("flags low contrast text as an error under 3:1 and a warning under 4.5:1", () => {
  const elements = [{ id: "title", role: "text", rect: TEXT_RECT }, { id: "glow", role: "decor", rect: TEXT_RECT }];
  const good = checkTextContrast(decodePng(frame({ text: [255, 255, 255], surface: [10, 10, 10] })), elements, { canvas: CANVAS });
  assert.deepEqual(good.findings, []);
  assert.equal(good.measurements.length, 1);
  assert.ok(good.measurements[0].ratio > 15);

  const weak = checkTextContrast(decodePng(frame({ text: [110, 110, 110], surface: [20, 20, 20] })), elements, { canvas: CANVAS });
  assert.equal(weak.findings[0].severity, "warning");
  assert.match(weak.findings[0].detail, /4\.5:1/);

  const bad = checkTextContrast(decodePng(frame({ text: [90, 90, 90], surface: [20, 20, 20] })), elements, { canvas: CANVAS });
  assert.equal(bad.findings[0].severity, "error");
  assert.deepEqual(bad.findings[0].ids, ["title"]);

  const missing = checkTextContrast(decodePng(frame({ text: null, surface: [20, 20, 20] })), elements, { canvas: CANVAS });
  assert.equal(missing.findings[0].severity, "warning");
  assert.match(missing.findings[0].detail, /no distinct text colour/);
});

test("detects an empty lower third from pixel variance", () => {
  const empty = checkLowerThird(decodePng(frame({ text: [255, 255, 255], surface: [20, 20, 20] })), { canvas: CANVAS, profile: "shorts" });
  assert.equal(empty.applies, true);
  assert.equal(empty.empty, true);
  const filled = checkLowerThird(decodePng(frame({ text: [255, 255, 255], surface: [20, 20, 20], lower: true })), { canvas: CANVAS, profile: "shorts" });
  assert.equal(filled.empty, false);
  assert.ok(filled.lumaStandardDeviation > 4);
  assert.equal(checkLowerThird(decodePng(frame({ text: null, surface: [0, 0, 0] })), { canvas: CANVAS, profile: "landscape" }).applies, false);
});

test("checkStill combines both checks and the file wrapper decodes a PNG", async () => {
  const elements = [{ id: "title", role: "text", rect: TEXT_RECT }];
  const report = checkStill(decodePng(frame({ text: [90, 90, 90], surface: [20, 20, 20] })), elements, { canvas: CANVAS, at: 2.5 });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.findings.map((finding) => [finding.rule, finding.severity, finding.at]), [["contrast", "error", 2.5], ["lower-third-empty", "warning", 2.5]]);

  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-still-"));
  const file = path.join(dir, "still.png");
  await writeFile(file, frame({ text: [255, 255, 255], surface: [10, 10, 10], lower: true }));
  const fromFile = await checkStillFile(file, elements, { canvas: CANVAS });
  assert.equal(fromFile.still, file);
  assert.equal(fromFile.status, "passed");
  assert.deepEqual(fromFile.findings, []);
});

// Dark page, a text card (surface) at TEXT_RECT/10 holding striped "glyphs",
// optional busy content in the lower third.
function frame({ text, surface, lower = false }) {
  return png(108, 192, (x, y) => {
    if (x >= 10 && x < 70 && y >= 30 && y < 50) {
      const glyph = text && y >= 35 && y < 45 && x >= 14 && x < 66 && x % 3 !== 0;
      const edge = text && y >= 35 && y < 45 && x >= 14 && x < 66 && x % 3 === 0;
      if (glyph) return [...text, 255];
      if (edge) return [...surface.map((value, index) => Math.round((value + text[index]) / 2 * 0.3 + value * 0.7)), 255];
      return [...surface, 255];
    }
    if (lower && y >= 95 && y < 140 && x >= 10 && x < 92) return (x + y) % 4 < 2 ? [240, 180, 40, 255] : [30, 90, 200, 255];
    return [...surface, 255];
  });
}

function png(width, height, pixel) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (rowBytes + 1);
    for (let x = 0; x < width; x += 1) Buffer.from(pixel(x, y)).copy(raw, offset + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
}
