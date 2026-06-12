import test from "node:test";
import assert from "node:assert/strict";
import { stackLayout, focalDrift } from "../motion-engine/reflow.js";

test("stackLayout with full presence spaces items by size and gap, centered", () => {
  const { centers, total } = stackLayout({ sizes: [100, 100, 100], presences: [1, 1, 1], gap: 20 });
  assert.equal(total, 340);
  assert.equal(centers[1], 0, "middle item sits at the stack center");
  assert.equal(centers[0], -120);
  assert.equal(centers[2], 120);
});

test("stackLayout gives absent items no space — no pre-opened gaps", () => {
  const two = stackLayout({ sizes: [100, 100, 100], presences: [1, 1, 0], gap: 20 });
  assert.equal(two.total, 220, "absent item contributes neither size nor gap");
  const one = stackLayout({ sizes: [100, 100, 100], presences: [1, 0, 0], gap: 20 });
  assert.equal(one.total, 100);
  assert.equal(one.centers[0], -50 + 100 / 2 - 0, "single item is centered");
});

test("stackLayout makes room: earlier items glide up as a newcomer's presence grows", () => {
  let previousFirst = Infinity;
  for (const presence of [0, 0.25, 0.5, 0.75, 1]) {
    const { centers } = stackLayout({ sizes: [100, 100], presences: [1, presence], gap: 20 });
    assert.ok(centers[0] < previousFirst || presence === 0, "first item moves monotonically upward");
    previousFirst = centers[0];
  }
  assert.equal(previousFirst, -60, "settles at the full two-item layout");
});

test("stackLayout tolerates spring overshoot above 1", () => {
  const { total } = stackLayout({ sizes: [100], presences: [1.03] });
  assert.ok(total > 100 && total < 110);
});

test("focalDrift pushes in and pans right-to-left across the scene", () => {
  const start = focalDrift({ frame: 0, fps: 30, seconds: 4 });
  const mid = focalDrift({ frame: 60, fps: 30, seconds: 4 });
  const end = focalDrift({ frame: 120, fps: 30, seconds: 4 });
  assert.equal(start.scale, 1);
  assert.ok(start.panX > 0, "starts right of center");
  assert.equal(Math.round(mid.panX * 1000), 0, "crosses center mid-scene");
  assert.ok(end.scale > 1.04 && end.scale <= 1.05, "settles at the full push-in");
  assert.ok(end.panX < 0, "ends left of center");
  const past = focalDrift({ frame: 200, fps: 30, seconds: 4 });
  assert.equal(past.scale, end.scale, "drift clamps at the scene end");
});
