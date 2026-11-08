import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { uiStageBox, uiTiltBox } from "@launchclip/core/catalog-i-ui.mjs";
import { ARRANGEMENTS, arrangementSlots } from "@launchclip/core/ui-arrange.mjs";
import { checkLayout, elementsFromEditorialLayout, emptiestBand, layoutExtras } from "@launchclip/core/layout-check.mjs";

const BRAND = { colors: { bg: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a", ink: "#0a0b08", paper: "#f4f6ee" }, fonts: { display: "inter", body: "inter", meta: "jetbrains-mono" } };
const HEADLINE = { kind: "headline", rect: { x: 90, y: 300, width: 900, height: 130 }, at: 0, enter: "cut", props: { text: "3 FREE TOOLS", size: 96 } };
const STAGE = { x: 40, y: 240, width: 1000, height: 1210 };
const REGION = { x: 40, y: 470, width: 1000, height: 980 };
const win = (title) => ({ kind: "window", props: { title } });
const COUNTS = { fan: 5, wall: 10, stack: 4, orbit: 6 };
const arranged = (arrange, n = COUNTS[arrange], extra = {}) => ({ kind: "stack", arrange, rect: REGION, at: 0, enter: "cut", children: Array.from({ length: n }, (_, k) => win(`P${k}`)), ...extra });

function resolve(elements, { stage, captions, width = 1080, height = 1920, start = 1, end = 6 } = {}) {
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 10 }, brand: BRAND, scenes: [], resolved: { duration: 10, fps: 30 }, ...(captions ? { overlays: [{ type: "captions", position: captions }] } : {}) };
  const scene = { id: "s1", module: "ui-scene", start, end, params: { elements, ...(stage ? { stage } : {}) } };
  return resolveModule(scene, { ...story, scenes: [scene] });
}
const shownOf = (element, stage) => uiStageBox(uiTiltBox(element.rect, element.tilt), element.depth, stage, 1080, 1920);
const inside = (outer, r) => r.x >= outer.x - 0.5 && r.y >= outer.y - 0.5 && r.x + r.width <= outer.x + outer.width + 0.5 && r.y + r.height <= outer.y + outer.height + 0.5;

/** The scene's layout elements, as the planner and story-patch build them. */
function layoutElements(model, { start = 1, end = 6 } = {}) {
  const canvas = model.canvas;
  const extras = layoutExtras(model.layout, { id: "s1", start, end, canvas });
  return [...elementsFromEditorialLayout(model.layout, { id: "s1", role: model.layout.role ?? "text", start, end, canvas, ...(extras.allowOcclusion ? { allowOcclusion: extras.allowOcclusion } : {}) }), ...extras.parts];
}
const fillFindings = (model, opts) => checkLayout({ canvas: model.canvas, elements: layoutElements(model, opts), duration: 10 }).findings.filter((finding) => finding.rule === "stage-fill");

test("arrange: every arrangement turns its children into placed top-level panels in depth layers inside its region", () => {
  for (const arrange of ARRANGEMENTS) {
    for (const stage of [undefined, { tilt: 8, dolly: { x: 30, y: 24, scale: 1.05 } }]) {
      const spec = resolve([HEADLINE, arranged(arrange)], { stage }).content.ui["s1-ui"];
      const panels = spec.elements.slice(1);
      assert.equal(panels.length, COUNTS[arrange], `${arrange}: one element a child`);
      assert.ok(panels.every((el) => el.kind === "window" && el.rect && !el.children), `${arrange}: the stack is gone`);
      const [hero, ...back] = panels;
      assert.equal(hero.depth, undefined, `${arrange}: the hero is the front layer`);
      assert.ok(back.every((el) => el.depth > 0 && el.depth <= 1), `${arrange}: the rest sit behind`);
      assert.ok(new Set(back.map((el) => el.depth)).size >= 1 && back.every((el) => el.tilt), `${arrange}: tilted`);
      assert.ok(back.every((el) => el.z < hero.z), `${arrange}: the hero draws on top`);
      for (const el of panels) assert.ok(inside(REGION, shownOf(el, spec.stage)), `${arrange}: ${JSON.stringify(shownOf(el, spec.stage))} inside the region`);
      // The collage fills the region top to bottom: no band of it over a fifth empty.
      const gap = emptiestBand(REGION, panels.map((el) => shownOf(el, spec.stage)));
      assert.ok(!gap || gap.y1 - gap.y0 < REGION.height * 0.2, `${arrange}: largest gap ${gap && gap.y1 - gap.y0}`);
    }
  }
});

test("arrange: the stage is the default region; children enter staggered front to back and the group's entrance carries over", () => {
  const spec = resolve([{ ...arranged("fan", 3), rect: undefined, at: 0.2, enter: "zoom", out: 4.5 }]).content.ui["s1-ui"];
  assert.deepEqual(spec.elements.map((el) => el.at), [0.2, 0.27, 0.34]);
  assert.ok(spec.elements.every((el) => el.enter === "zoom" && el.out === 4.5));
  for (const el of spec.elements) assert.ok(inside(STAGE, shownOf(el, null)));
  // Only the hero's entrance asks for a sound.
  assert.equal(resolve([arranged("fan", 3, { enter: "zoom" })]).events.filter((event) => event.cue).length, 1);
  // A child's own at, enter and z win.
  const own = resolve([arranged("stack", 2, { children: [win("a"), { ...win("b"), at: 1, enter: "left", z: 3 }] })]).content.ui["s1-ui"].elements[1];
  assert.deepEqual([own.at, own.enter, own.z], [1, "left", 3]);
});

test("arrange: a panel's own children shrink to the size it was given and enter no earlier than it", () => {
  const child = { kind: "waveform", rect: { x: 40, y: 100, width: 900, height: 400 }, at: 0, props: {} };
  const spec = resolve([arranged("wall", 4, { children: [win("hero"), win("a"), win("b"), { ...win("c"), children: [child] }] })]).content.ui["s1-ui"];
  const card = spec.elements[3];
  const inner = card.children[0];
  assert.ok(inner.rect.x + inner.rect.width <= card.rect.width && inner.rect.y + inner.rect.height <= card.rect.height, "fits its card");
  assert.ok(Math.abs(inner.rect.width / inner.rect.height - 900 / 400) < 0.02, "keeps its proportions");
  assert.equal(inner.at, card.at);
});

test("arrange: the hero keeps clear of the caption band when the region has room", () => {
  for (const captions of ["low", "middle"]) {
    const model = resolve([arranged("orbit")], { captions });
    const band = model.content.captionBand;
    for (const arrange of ARRANGEMENTS) {
      const hero = resolve([arranged(arrange)], { captions }).content.ui["s1-ui"].elements[0];
      const r = shownOf(hero, null);
      assert.ok(r.y + r.height <= band.y + 0.5 || r.y >= band.y + band.height - 0.5, `${arrange} hero ${JSON.stringify(r)} clear of the ${captions} band ${band.y}–${band.y + band.height}`);
    }
  }
  // The slots alone: with no band the hero sits mid-region.
  const [hero] = arrangementSlots("orbit", 3, REGION, null);
  assert.ok(Math.abs(hero.rect.y + hero.rect.height / 2 - (REGION.y + REGION.height / 2)) < 1);
});

test("arrange: validated with repair messages", () => {
  assert.throws(() => resolve([arranged("spiral")]), /arrange must be one of/);
  assert.throws(() => resolve([{ ...arranged("fan"), kind: "window" }]), /set kind "stack"/);
  assert.throws(() => resolve([arranged("fan", 1)]), /must list 2–5 panels for arrange "fan"/);
  assert.throws(() => resolve([arranged("wall", 17)]), /must list 3–16 panels/);
  assert.throws(() => resolve([arranged("fan", 2, { children: [win("a"), { ...win("b"), rect: { x: 0, y: 0, width: 100, height: 100 } }] })]), /children\[1\]\.rect is set by arrange "fan"; drop it/);
  assert.throws(() => resolve([arranged("fan", 2, { children: [win("a"), { ...win("b"), depth: 0.5 }] })]), /depth is set by arrange/);
  assert.throws(() => resolve([arranged("fan", 2, { children: [win("a"), { kind: "headline", props: { text: "HI" } }] })]), /an arrangement places panels/);
  assert.throws(() => resolve([arranged("fan", 3, { rect: { x: 2000, y: 0, width: 400, height: 400 } })]), /must overlap the stage/);
  assert.throws(() => resolve([arranged("fan", 3, { props: {} })]), /params\.elements\[0\]/);
  // Errors inside a child name its path.
  assert.throws(() => resolve([arranged("fan", 2, { children: [win("a"), { kind: "window", props: {}, enter: "spin" }] })]), /params\.elements\[0\]\.children\[1\]\.enter/);
  // A panel with a minimum size is never fitted below it.
  const meter = resolve([arranged("fan", 3, { children: [{ kind: "meter", props: {} }, win("a"), { kind: "meter", props: {} }] })]).content.ui["s1-ui"].elements;
  assert.ok(meter[0].rect.width >= 560 && meter[2].rect.height >= 320);
});

test("arrange: every arrangement under a headline fills the stage (no stage-fill finding)", () => {
  for (const arrange of ARRANGEMENTS) {
    for (const stage of [undefined, { tilt: 8, dolly: { x: 30, y: 24, scale: 1.05 } }]) assert.deepEqual(fillFindings(resolve([HEADLINE, arranged(arrange)], { stage })), [], arrange);
  }
});

test("arrange: an element listed after an arranged stack draws over its cards, one listed before stays behind", () => {
  const chip = { kind: "chip", rect: { x: 400, y: 900, width: 280, height: 80 }, at: 1, props: { text: "HI" } };
  const burst = { kind: "burst", at: 1.5, props: { target: "s-0" } };
  const elements = resolve([{ ...chip, id: "before" }, arranged("fan", 3, { id: "s" }), burst, { ...chip, id: "after" }, { ...chip, id: "own", z: 5 }]).content.ui["s1-ui"].elements;
  const byId = Object.fromEntries(elements.map((el) => [el.id ?? el.kind, el]));
  const hero = byId["s-0"];
  assert.equal(byId.before.z, undefined, "listed before the stack: no z, behind its cards");
  assert.ok(byId.burst.z > hero.z && byId.after.z > hero.z, "listed after: above the hero");
  assert.equal(byId.own.z, 5, "its own z wins");
});
