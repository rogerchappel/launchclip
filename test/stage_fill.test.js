import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { STAGE_FILL, checkLayout, elementsFromEditorialLayout, emptiestBand, layoutExtras } from "@launchclip/core/layout-check.mjs";

const BRAND = { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } };
const HEADLINE = { kind: "headline", rect: { x: 90, y: 300, width: 900, height: 130 }, at: 0, enter: "cut", props: { text: "3 FREE TOOLS", size: 96 } };

function resolve(elements, { stage, captions, width = 1080, height = 1920, start = 1, end = 6 } = {}) {
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 }, ...(captions ? { overlays: [{ type: "captions", position: captions }] } : {}) };
  const scene = { id: "s1", module: "ui-scene", start, end, params: { elements, ...(stage ? { stage } : {}) } };
  return resolveModule(scene, { ...story, scenes: [scene] });
}
/** The scene's layout elements, as the planner and story-patch build them. */
function layoutElements(model, { start = 1, end = 6 } = {}) {
  const canvas = model.canvas;
  const extras = layoutExtras(model.layout, { id: "s1", start, end, canvas });
  return [...elementsFromEditorialLayout(model.layout, { id: "s1", role: model.layout.role ?? "text", start, end, canvas, ...(extras.allowOcclusion ? { allowOcclusion: extras.allowOcclusion } : {}) }), ...extras.parts];
}
const fillFindings = (model, opts) => checkLayout({ canvas: model.canvas, elements: layoutElements(model, opts), duration: 10 }).findings.filter((finding) => finding.rule === "stage-fill");

test("emptiestBand: the tallest band no wide-enough rect reaches into", () => {
  const stage = { x: 0, y: 0, width: 1000, height: 1000 };
  assert.deepEqual(emptiestBand(stage, []), { y0: 0, y1: 1000 });
  assert.deepEqual(emptiestBand(stage, [{ x: 0, y: 100, width: 900, height: 300 }, { x: 0, y: 350, width: 900, height: 100 }]), { y0: 450, y1: 1000 });
  assert.deepEqual(emptiestBand(stage, [{ x: 0, y: 0, width: 900, height: 1000 }]), null);
  // A chip-sized rect does not fill a band.
  assert.deepEqual(emptiestBand(stage, [{ x: 0, y: 0, width: 900, height: 400 }, { x: 0, y: 700, width: 100, height: 60 }], 250), { y0: 400, y1: 1000 });
});

test("stage-fill: a headline over one flat panel warns with a repair; a back layer that fills the foot passes", () => {
  const template = resolve([HEADLINE, { kind: "window", rect: { x: 90, y: 480, width: 900, height: 520 }, at: 0, enter: "cut", props: { title: "PREVIEW" } }]);
  const [finding, ...rest] = fillFindings(template);
  assert.equal(rest.length, 0);
  assert.equal(finding.severity, "warning");
  assert.deepEqual(finding.ids, ["s1"]);
  assert.equal(finding.at, 1);
  assert.match(finding.detail, /s1 leaves the foot of its stage empty \(y 1000–1450, 450 px, 37% of the stage y 240–1450\) for 5s \(1s–6s\)/);
  assert.match(finding.detail, /a card-wall at depth 1 with bleed: true/);
  // A bleed card wall behind the panel fills the foot too.
  const wall = { kind: "card-wall", rect: { x: 0, y: 500, width: 1080, height: 1000 }, at: 0, enter: "cut", bleed: true, depth: 1, props: { cards: [{ label: "a" }] } };
  assert.deepEqual(fillFindings(resolve([HEADLINE, wall, { kind: "window", rect: { x: 90, y: 480, width: 900, height: 520 }, at: 0, enter: "cut", props: {} }])), []);
});

test("stage-fill: a short gap (up to 1.5 s) passes, a panel that leaves opens one, and landscape scenes are not checked", () => {
  const panel = (rect, extra = {}) => ({ kind: "window", rect, at: 0, enter: "cut", props: {}, ...extra });
  const top = panel({ x: 90, y: 300, width: 900, height: 560 });
  const low = (at, out) => panel({ x: 90, y: 880, width: 900, height: 560 }, { at, ...(out ? { out } : {}) });
  assert.deepEqual(fillFindings(resolve([top, low(1.4)])), [], "the foot fills within 1.5 s");
  const late = fillFindings(resolve([top, low(2)]));
  assert.equal(late.length, 1);
  assert.match(late[0].detail, /for 2s \(1s–3s\)/);
  const leaves = fillFindings(resolve([top, low(0, 2)]));
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].at, 3.3, "empty once the lower panel has lifted out");
  const wide = resolve([{ ...top, rect: { x: 100, y: 200, width: 900, height: 300 } }], { width: 1920, height: 1080 });
  assert.equal(wide.layout.fill, undefined);
  assert.ok(STAGE_FILL.seconds === 1.5 && STAGE_FILL.maxGapShare === 0.25);
});
