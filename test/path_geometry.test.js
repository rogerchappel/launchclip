// Path geometry for the hand-drawn reveal: parsing, shapes, transforms, measuring.
import test from "node:test";
import assert from "node:assert/strict";
import { area, bounds, parsePath, pointAt, polylineLength, shapeSubpaths, toPathD, walkShapes } from "../kit/core/path-geometry.mjs";

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} vs ${b}`);

test("bulb icon path parses to two subpaths with a sensible box", () => {
  const subs = parsePath("M9 17.5 V15.5 C7 14.2 5.8 12.1 5.8 9.8 a6.2 6.2 0 0 1 12.4 0 C18.2 12.1 17 14.2 15 15.5 V17.5 Z M9.5 21 L14.5 21");
  assert.equal(subs.length, 2);
  assert.equal(subs[0].closed, true);
  assert.deepEqual(subs[0].points.at(-1), subs[0].points[0]);
  assert.equal(subs[1].closed, false);
  const b = bounds(subs.map((s) => s.points));
  near(b.x, 5.8, 0.05, "x"); near(b.x + b.width, 18.2, 0.05, "right");
  near(b.y, 3.6, 0.05, "top"); near(b.y + b.height, 21, 1e-9, "bottom");
  assert.ok(area(subs[0].points) > 50);
  assert.equal(area(subs[1].points), 0);
});

test("relative arc semicircle is pi * r long", () => {
  const [s] = parsePath("M10 10 a5 5 0 0 1 10 0");
  near(polylineLength(s.points), Math.PI * 5, Math.PI * 5 * 0.01);
  near(Math.min(...s.points.map((p) => p[1])), 5, 0.01, "bulges up");
});

test("circle length is 2 pi r within 1%", () => {
  const [s] = shapeSubpaths({ tag: "circle", attrs: { cx: 50, cy: 50, r: 40 } });
  assert.equal(s.closed, true);
  near(polylineLength(s.points), 2 * Math.PI * 40, 2 * Math.PI * 40 * 0.01);
});

test("rect bounds follow translate and scale through g and svg viewBox", () => {
  const tree = {
    tag: "svg", attrs: { viewBox: "0 0 100 100", width: 200, height: 200 },
    children: [{ tag: "g", attrs: { transform: "translate(10 20) scale(2)" }, children: [
      { tag: "rect", attrs: { x: 0, y: 0, width: 10, height: 5 } },
      { tag: "defs", children: [{ tag: "rect", attrs: { width: 99, height: 99 } }] },
    ] }],
  };
  const shapes = walkShapes(tree);
  assert.equal(shapes.length, 1);
  const b = bounds(shapeSubpaths(shapes[0].node, shapes[0].matrix).map((s) => s.points));
  assert.deepEqual(b, { x: 20, y: 40, width: 40, height: 20 });
  const rounded = shapeSubpaths({ tag: "rect", attrs: { x: 0, y: 0, width: 10, height: 10, rx: 2 } }, [1, 0, 0, 1, 5, 5]);
  assert.deepEqual(bounds(rounded.map((s) => s.points)), { x: 5, y: 5, width: 10, height: 10 });
  assert.deepEqual(shapeSubpaths({ tag: "foo" }), []);
});

test("rotate transform turns a line about its centre", () => {
  const [{ node, matrix }] = walkShapes({ tag: "g", attrs: { transform: "rotate(90 5 0)" }, children: [{ tag: "line", attrs: { x1: 0, y1: 0, x2: 10, y2: 0 } }] });
  const [s] = shapeSubpaths(node, matrix);
  assert.equal(toPathD(s.points), "M5 -5 L5 5");
});

test("pointAt walks a straight line", () => {
  const pts = [[0, 0], [10, 0], [10, 10]];
  assert.deepEqual(pointAt(pts, 0), [0, 0]);
  assert.deepEqual(pointAt(pts, 0.5), [10, 0]);
  assert.deepEqual(pointAt(pts, 1), [10, 10]);
  assert.deepEqual(pointAt([[0, 0], [4, 0]], 0.25), [1, 0]);
  assert.equal(toPathD([[0.04, 1.26], [3, 4]], true), "M0 1.3 L3 4 Z");
});
