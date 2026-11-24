import assert from "node:assert/strict";
import test from "node:test";
import { limbWeight, medianRatio } from "../eval/limb-weight.mjs";

// A stick figure on white: ring head of radius r, then a body, arms and legs `stroke` px thick.
function stickFigure({ width = 200, height = 240, r = 20, stroke = 5, ring = true } = {}) {
  const gray = new Uint8Array(width * height).fill(240);
  const cx = 100, cy = 30;
  const ink = (x, y) => { if (x >= 0 && y >= 0 && x < width && y < height) gray[Math.round(y) * width + Math.round(x)] = 20; };
  const disc = (x, y, radius) => { for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) if (dx * dx + dy * dy <= radius * radius) ink(x + dx, y + dy); };
  const line = (x0, y0, x1, y1) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i += 1) disc(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, (stroke - 1) / 2); };
  for (let a = 0; a < 360; a += 1) disc(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180), ring ? (stroke - 1) / 2 : 0);
  if (!ring) disc(cx, cy, r);
  line(cx, cy + r, cx, 140); // body
  line(cx, 80, 60, 120); line(cx, 80, 140, 120); // arms
  line(cx, 140, 70, 220); line(cx, 140, 130, 220); // legs
  return { gray, width, height };
}

test("limbWeight reads head width and limb stroke of an upright stick figure", () => {
  const { gray, width, height } = stickFigure();
  const measure = limbWeight(gray, width, height);
  assert.ok(Math.abs(measure.head_px - 45) <= 2, `head ${measure.head_px}`);
  assert.ok(Math.abs(measure.stroke_px - 5) <= 1, `stroke ${measure.stroke_px}`);
  assert.ok(measure.ratio > 0.08 && measure.ratio < 0.14);
});

test("a heavier stroke at the same head width reads as a larger ratio, and filled heads work", () => {
  const thin = stickFigure({ stroke: 3 });
  const thick = stickFigure({ stroke: 9, ring: false });
  const a = limbWeight(thin.gray, thin.width, thin.height);
  const b = limbWeight(thick.gray, thick.width, thick.height);
  assert.ok(b.ratio > a.ratio * 2, `${a.ratio} vs ${b.ratio}`);
  assert.equal(medianRatio([a, { ratio: null }, b, b]), b.ratio);
});

test("a blank frame or one with no head is reported, not guessed", () => {
  assert.equal(limbWeight(new Uint8Array(100 * 100).fill(200), 100, 100).ratio, null);
  const bar = new Uint8Array(100 * 100).fill(240);
  for (let y = 10; y < 90; y += 1) for (let x = 48; x < 53; x += 1) bar[y * 100 + x] = 10;
  assert.match(limbWeight(bar, 100, 100).reason, /no head/);
});
