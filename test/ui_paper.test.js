import assert from "node:assert/strict";
import test from "node:test";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { UI_KINDS, UI_RUNTIME, paintUi } from "@launchclip/core/ui-runtime.mjs";
import { uiRigAt, uiRigProject } from "@launchclip/core/ui-paint.mjs";
import { uiPaperCurve, uiTornPath } from "@launchclip/core/ui-paper.mjs";
import { recorderAvailability } from "../src/demo/record.js";
import { planScore } from "../src/sfx/score.js";
import { mediaSkip } from "./helpers/media.js";

const PAPER_KINDS = ["cutout", "limb", "paper-fold", "paper-sheet", "torn-strip", "tape", "callout-pin"];
const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 10 }, brand: { colors: { bg: "#0a0b08", primary: "#f2bd2e", accent: "#f2bd2e", ink: "#0a0b08", paper: "#efece1" } } };
const scene = (elements, stage) => ({ id: "s1", module: "ui-scene", start: 0, end: 10, params: { elements, ...(stage ? { stage } : {}) } });
const resolve = (elements, stage) => resolveModule(scene(elements, stage), story);
const cutout = (extra = {}) => ({ id: "a", kind: "cutout", rect: { x: 100, y: 400, width: 400, height: 400 }, at: 0, enter: "cut", props: { view: [100, 100], parts: [{ shape: "circle", x: 50, y: 50, r: 40, fill: "accent", shade: { kind: "dots" } }] }, ...extra });
const RIG = { keys: [{ at: 0, rx: 60 }, { at: 2, rx: 0, ease: "back" }], steps: 15, float: 0 };

test("the paper kinds are in the painter and its page source", () => {
  for (const kind of PAPER_KINDS) assert.ok(UI_KINDS.includes(kind), kind);
  for (const name of ["uiCutout", "uiLimb", "uiPaperFold", "uiPaperSheet", "uiTornStrip", "uiTape", "uiCalloutPin", "uiRigAt", "uiRigProject"]) assert.match(UI_RUNTIME, new RegExp(`function ${name}\\b`), name);
});

test("a rig eases between its keys, overshooting into a back key", () => {
  const rig = { keys: [{ at: 0, rx: 60, scale: 0.5 }, { at: 2, rx: 0, scale: 1, ease: "back" }], float: 0 };
  assert.equal(uiRigAt(rig, -1).rx, 60);
  assert.equal(uiRigAt(rig, 5).rx, 0);
  assert.equal(uiRigAt(rig, 5).scale, 1);
  assert.ok(uiRigAt(rig, 1.4).rx < 0, "it swings past its rest");
  const pose = uiRigAt({ keys: [{ at: 0 }], explode: { at: 1, dur: 1 }, float: 0 }, 2);
  assert.equal(pose.explode, 1);
});

test("a rig floats by default, and a float of 0 holds still", () => {
  const moving = { keys: [{ at: 0, rx: 10 }] };
  assert.notEqual(uiRigAt(moving, 1).rx, uiRigAt(moving, 2).rx);
  const held = { keys: [{ at: 0, rx: 10 }], float: 0 };
  assert.equal(uiRigAt(held, 1).rx, uiRigAt(held, 2).rx);
});

test("projecting through a level rig leaves a point where it is", () => {
  const pose = { rx: 0, ry: 0, rz: 0, scale: 1, x: 0, y: 0, explode: 0 };
  assert.deepEqual(uiRigProject(300, 500, 0, pose, 1080, 1920), [300, 500]);
  const lifted = uiRigProject(300, 500, 400, pose, 1080, 1920);
  assert.ok(lifted[0] < 300 && lifted[1] < 500, "something nearer spreads away from the centre");
});

test("curves pass through their points, and torn paths are the same every time", () => {
  const curve = uiPaperCurve([[0, 0], [100, 50], [200, 0]], 20);
  assert.deepEqual(curve[0], [0, 0]);
  assert.deepEqual(curve.at(-1).map(Math.round), [200, 0]);
  assert.equal(uiTornPath(100, 40, 3, 6), uiTornPath(100, 40, 3, 6));
});

test("a rig and the paper kinds validate, and carry through to the painter's spec", () => {
  const model = resolve([cutout({ lift: 120 }), { id: "b", kind: "torn-strip", screen: true, rect: { x: 100, y: 260, width: 880, height: 92 }, at: 0, enter: "cut", props: { text: "HELLO *WORLD*", size: 54 } }], { rig: RIG });
  const spec = Object.values(model.content.ui)[0];
  assert.equal(spec.stage.rig.steps, 15);
  assert.equal(spec.elements[0].lift, 120);
  assert.equal(spec.elements[1].screen, true);
});

test("a world element may run off the stage on a rig, but a flat one still must fit", () => {
  const wide = cutout({ rect: { x: -100, y: 100, width: 1300, height: 1700 } });
  assert.doesNotThrow(() => resolve([wide], { rig: RIG }));
  assert.throws(() => resolve([{ ...wide, screen: true }], { rig: RIG }), /must sit on the stage/);
  assert.throws(() => resolve([wide]), /must sit on the stage/);
});

test("the paper kinds refuse what they cannot draw", () => {
  const bad = (element, pattern) => assert.throws(() => resolve([cutout(), element], { rig: RIG }), pattern);
  const rect = { x: 100, y: 400, width: 400, height: 300 };
  bad({ kind: "cutout", rect, at: 0, props: { parts: [] } }, /non-empty array of shapes/);
  bad({ kind: "cutout", rect, at: 0, props: { parts: [{ shape: "star" }] } }, /shape must be one of|must be one of/);
  bad({ kind: "cutout", rect, at: 0, props: { parts: [{ shape: "path", d: "M0 0<script>" }] } }, /path commands/);
  bad({ kind: "cutout", rect, at: 0, props: { parts: [{ shape: "path", d: "M0 0 L9 9", shade: { kind: "dots" } }] } }, /needs the box/);
  bad({ kind: "limb", rect, at: 0, props: { path: [[0, 0]] } }, /at least two/);
  bad({ kind: "limb", rect, at: 0, props: { path: [[0, 0], [900, 10]] } }, /outside its rect/);
  bad({ kind: "paper-fold", rect, at: 0, props: { panels: [{ title: "A" }] } }, /2–12 panels/);
  bad({ kind: "torn-strip", rect: { x: 100, y: 400, width: 200, height: 60 }, at: 0, props: { text: "MUCH TOO LONG FOR THIS STRIP", size: 54 } }, /needs about/);
  assert.throws(() => resolve([cutout()], { rig: { keys: [] } }), /non-empty array/);
  assert.throws(() => resolve([cutout()], { rig: { keys: [{ at: 2 }, { at: 1 }] } }), /must not be before/);
});

test("a cut-out's text is escaped, and a part stays away until its time", () => {
  const host = { innerHTML: "" };
  const spec = { start: 0, width: 1080, height: 1920, unit: 1, theme: { bg: "#000000", ink: "#ffffff", accent: "#ff0000", alert: "#ff0000", muted: "#888888", soft: "#cccccc" }, fonts: { display: "Inter", body: "Inter", mono: "Mono" }, stage: { rig: RIG, duration: 10 }, elements: [{ id: "a", kind: "cutout", rect: { x: 0, y: 0, width: 200, height: 200 }, at: 0, enter: "cut", props: { view: [100, 100], edge: 0, parts: [{ shape: "text", x: 50, y: 50, size: 20, text: "<b>x</b>" }, { shape: "circle", x: 50, y: 50, r: 44, fill: "#123456", at: 5 }] } }] };
  paintUi(host, spec, 1);
  assert.ok(!host.innerHTML.includes("<b>x</b>"));
  assert.ok(host.innerHTML.includes("&lt;b&gt;"));
  assert.ok(!host.innerHTML.includes("#123456"));
  paintUi(host, spec, 6);
  assert.ok(host.innerHTML.includes("#123456"));
});

test("the paper steps while the camera stays smooth", () => {
  const host = { innerHTML: "" };
  const spec = { start: 0, width: 1080, height: 1920, unit: 1, theme: { bg: "#000000", ink: "#ffffff", accent: "#ff0000", alert: "#ff0000", muted: "#888888", soft: "#cccccc" }, fonts: { display: "Inter", body: "Inter", mono: "Mono" }, stage: { rig: { keys: [{ at: 0, rx: 60 }, { at: 2, rx: 0 }], steps: 15, float: 0 }, duration: 10 }, elements: [{ id: "l", kind: "limb", rect: { x: 0, y: 0, width: 500, height: 500 }, at: 0, enter: "cut", props: { path: [[0, 0], [400, 400]], growAt: 0, growDur: 2, sway: 0 } }] };
  const limbOf = (t) => { paintUi(host, spec, t); return host.innerHTML.match(/<path d="[^"]+"/)[0]; };
  const cameraOf = (t) => { paintUi(host, spec, t); return host.innerHTML.match(/rotateX\([^)]+\)/)[0]; };
  assert.equal(limbOf(1), limbOf(1 + 1 / 30), "one drawing holds for two video frames");
  assert.notEqual(cameraOf(1), cameraOf(1 + 1 / 30));
});

test("the score follows the paper: a map creases open, a limb slides out, flaps snap up", () => {
  const { cues } = planScore({ scenes: [{ id: "s", start: 0, end: 10, energy: 2, params: { elements: [
    { kind: "paper-fold", at: 1, rect: { x: 0, y: 0, width: 800, height: 200 }, props: { openAt: 1, panels: [{}, {}, {}] } },
    { kind: "limb", at: 3, rect: { x: 0, y: 0, width: 800, height: 800 }, props: { growAt: 3, path: [[0, 0], [9, 9]] } },
    { kind: "paper-sheet", at: 0, rect: { x: 0, y: 0, width: 800, height: 800 }, props: { flaps: 100, flapAt: 5 } }
  ] } }], format: { width: 1080 }, resolved: { duration: 10 } }, { seed: "s" });
  assert.equal(cues.filter((cue) => cue.intent.includes("crease")).length, 3);
  assert.ok(cues.some((cue) => cue.intent.includes("limb slides") && cue.at === 3));
  assert.equal(cues.filter((cue) => cue.intent.includes("side panel")).length, 2);
});

const available = await recorderAvailability();
const needsBrowser = { skip: mediaSkip(!available.ok && `Chromium unavailable: ${available.reasons.join("; ")}`), timeout: 120000 };

test("a pin's projection lands where Chromium actually draws the point", needsBrowser, async (t) => {
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.setContent('<html><body style="margin:0"><div id="h" style="position:relative;width:1080px;height:1920px"></div></body></html>');
  await page.addScriptTag({ content: UI_RUNTIME });
  const pose = { keys: [{ at: 0, rx: 50, ry: -20, rz: -25, scale: 0.8, x: 30, y: -40 }], float: 0 };
  const spec = { start: 0, width: 1080, height: 1920, unit: 1, theme: { bg: "#000000", ink: "#ffffff", accent: "#ff0000", alert: "#ff0000", muted: "#888888", soft: "#cccccc" }, fonts: { display: "Inter", body: "Inter", mono: "Mono" }, stage: { rig: pose, duration: 10 }, elements: [{ id: "p", kind: "tape", lift: 200, rect: { x: 700, y: 400, width: 2, height: 2 }, at: 0, enter: "cut", props: {} }] };
  const box = await page.evaluate((s) => {
    window.lcPaintUi(document.getElementById("h"), s, 1);
    const r = document.querySelector('[data-ui="p"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, spec);
  const [x, y] = uiRigProject(701, 401, 200, uiRigAt(pose, 1), 1080, 1920);
  assert.ok(Math.abs(box.x - x) < 3 && Math.abs(box.y - y) < 3, `drawn at ${box.x},${box.y}; projected ${x},${y}`);
});
