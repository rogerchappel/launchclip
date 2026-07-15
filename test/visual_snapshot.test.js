import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { analyzePng } from "../src/visual_snapshot.js";

test("classifies a flat screenshot as blank", () => {
  const report = analyzePng(png(40, 60, () => [238, 232, 216, 255]));
  assert.equal(report.blank, true);
  assert.equal(report.quantized_colors, 1);
  assert.equal(report.foreground_ratio, 0);
});

test("recognises a sparse terminal-style scene as meaningful detail", () => {
  const report = analyzePng(png(80, 120, (x, y) => {
    const terminal = x >= 10 && x < 70 && y >= 28 && y < 92;
    const prompt = terminal && y >= 48 && y < 53 && x >= 18 && x < 58;
    return prompt ? [80, 235, 170, 255] : terminal ? [15, 20, 28, 255] : [238, 232, 216, 255];
  }));
  assert.equal(report.blank, false);
  assert.ok(report.foreground_ratio > .1);
  assert.ok(report.luma_standard_deviation > 1);
});

test("supports filtered RGBA screenshots and transparent pixels", () => {
  const report = analyzePng(png(32, 32, (x, y) => x === y ? [0, 0, 0, 255] : [0, 0, 0, 0], 1));
  assert.equal(report.blank, false);
  assert.ok(report.edge_ratio > 0);
});

function png(width, height, pixel, filter = 0) {
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (rowBytes + 1);
    raw[offset] = filter;
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < width; x += 1) Buffer.from(pixel(x, y)).copy(row, x * 4);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const above = previous[x];
      const upperLeft = x >= 4 ? previous[x - 4] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft);
      raw[offset + 1 + x] = (row[x] - prediction + 256) & 0xff;
    }
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, typeBuffer, data, Buffer.alloc(4)]);
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}
