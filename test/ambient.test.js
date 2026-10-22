import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import {
  AMBIENT_LEVELS, AMBIENT_PRESETS, ambientErrors, ambientField, ambientSeed, axisSegments, axisValue, blobBackground, blobStateAt, blobTweens,
  blobAlpha, driftBounds, driftEligible, driftExtent, driftGsap, driftPlan, driftStateAt, driftStyle, fieldLevel, levelForEnergy, luma, sceneAmbient, sceneDrift
} from "../kit/core/ambient.mjs";
import { profileGeometry } from "../kit/core/layout-check.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const canvas = { width: 1080, height: 1920 };
const geometry = profileGeometry(canvas);
const inside = (outer, inner, eps = 1e-6) => inner.x >= outer.x - eps && inner.y >= outer.y - eps && inner.x + inner.width <= outer.x + outer.width + eps && inner.y + inner.height <= outer.y + outer.height + eps;

function story(extra = {}) {
  return {
    schema: "launchclip.story.v1", lane: "motion", title: "Ambient test",
    format: { width: 1080, height: 1920, fps: 30, duration: 8 },
    brand: { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", paper: "#f2eee6" }, fonts: { display: "anton" } },
    scenes: [
      { id: "s1", module: "metric", start: 0, end: 4, energy: 1 },
      { id: "s2", module: "metric", start: 4, end: 8, energy: 3 }
    ],
    ...extra
  };
}

test("ambient core is plain ESM that imports only motion.mjs", async () => {
  const source = await readFile(path.join(ROOT, "kit/core/ambient.mjs"), "utf8");
  const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["./motion.mjs"]);
  assert.doesNotMatch(source, /\brequire\(|Date\.now|performance\.now|Math\.random/);
});

test("levels and scene defaults follow energy, lane and overrides", () => {
  assert.deepEqual(AMBIENT_LEVELS, ["off", "subtle", "standard", "lively"]);
  assert.equal(levelForEnergy(0), "subtle");
  assert.equal(levelForEnergy(1), "standard");
  assert.equal(levelForEnergy(3), "lively");
  assert.equal(levelForEnergy("build"), "standard");
  assert.equal(levelForEnergy(undefined), "standard");
  const s = story();
  assert.deepEqual(sceneAmbient(s, s.scenes[0]), { level: "standard", background: true, drift: true });
  assert.deepEqual(sceneAmbient(s, s.scenes[1]), { level: "lively", background: true, drift: true });
  // Story level wins over energy; the scene override wins over the story.
  const set = story({ ambient: { level: "subtle", drift: false } });
  assert.deepEqual(sceneAmbient(set, set.scenes[1]), { level: "subtle", background: true, drift: false });
  assert.deepEqual(sceneAmbient(set, { ...set.scenes[1], ambient: { drift: true, level: "lively" } }), { level: "lively", background: true, drift: true });
  assert.deepEqual(sceneAmbient(set, { ...set.scenes[1], ambient: "off" }), { level: "off", background: false, drift: false });
  assert.deepEqual(sceneAmbient(story({ ambient: "off" }), s.scenes[0]), { level: "off", background: false, drift: false });
  // Footage-led: no field by default; overlays drift, the base and inserts do not.
  const footage = story({ lane: "footage-led" });
  assert.deepEqual(sceneAmbient(footage, { id: "o", track: 1 }), { level: "standard", background: false, drift: true });
  assert.deepEqual(sceneAmbient(footage, { id: "i", track: 0, insert: true }), { level: "standard", background: false, drift: false });
  assert.deepEqual(sceneAmbient(footage, { id: "i", track: 0, insert: true, ambient: { drift: true } }), { level: "standard", background: false, drift: true });
});

test("ambientErrors validates the story and scene control", () => {
  assert.deepEqual(ambientErrors(undefined), []);
  assert.deepEqual(ambientErrors("lively"), []);
  assert.deepEqual(ambientErrors({ level: "subtle", background: false, drift: true }), []);
  assert.match(ambientErrors("wild")[0], /must be one of off, subtle, standard, lively/);
  assert.match(ambientErrors({ level: "loud" }, "scenes[0].ambient")[0], /^scenes\[0\]\.ambient\.level must be one of/);
  assert.match(ambientErrors({ background: "yes" })[0], /ambient\.background must be true or false/);
  assert.match(ambientErrors({ speed: 2 })[0], /ambient\.speed is not supported/);
  assert.match(ambientErrors([1])[0], /level string or an object/);
});

test("the field is deterministic, seeded by the story and skipped when no plate wants it", () => {
  const a = ambientField(story()), b = ambientField(story());
  assert.deepEqual(a, b);
  assert.equal(a.level, "standard", "energies 1 and 3 tie; the calmer level wins");
  assert.equal(a.blobs.length, AMBIENT_PRESETS.standard.field.count);
  assert.notEqual(ambientSeed(story()), ambientSeed(story({ title: "Other" })));
  assert.notDeepEqual(ambientField(story({ title: "Other" })).blobs[0], a.blobs[0]);
  assert.equal(ambientField(story({ ambient: "off" })), null);
  assert.equal(ambientField(story({ ambient: { background: false } })), null);
  assert.equal(ambientField(story({ lane: "footage-led" })), null);
  assert.equal(fieldLevel(story({ ambient: { level: "lively" } })), "lively");
  for (const blob of a.blobs) {
    assert.ok(["#fdb022", "#46d4ff"].includes(blob.color), "brand primary/accent");
    // Every brand gets the same low-contrast field: the blob centre adds `contrast` luma levels over bg.
    const step = Math.abs(luma(blob.color) - luma("#06070d"));
    const wanted = AMBIENT_PRESETS.standard.field.contrast * (Number(blob.id.slice(1)) % 2 ? 0.85 : 1);
    assert.ok(Math.abs(blob.alpha * step - wanted) < 0.1, `${blob.id} adds ${blob.alpha * step} levels`);
    assert.match(blobBackground(blob), /^radial-gradient\(closest-side, rgba\(\d+, \d+, \d+, [\d.]+\) 0%,.* 100%\)$/);
  }
});

test("blob tweens reproduce the field axes exactly under GSAP seeking", () => {
  const field = ambientField(story({ format: { width: 1920, height: 1080, fps: 30, duration: 40 } }));
  for (const blob of field.blobs) {
    const target = { x: 0, y: 0, scale: 1 };
    const tl = gsap.timeline({ paused: true });
    const from = 3.3, to = 37.9;
    for (const tw of blobTweens(blob, from, to)) tl.fromTo(target, { [tw.prop]: tw.from }, { [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false }, tw.at);
    for (const t of [20.2, 3.31, 37.8, 11.7, 5.05, 29.99, 14.0]) {
      tl.seek(t, false);
      const state = blobStateAt(blob, t);
      for (const prop of ["x", "y", "scale"]) assert.ok(Math.abs(target[prop] - state[prop]) < 2e-3, `${blob.id} ${prop} at ${t}: GSAP ${target[prop]} vs ${state[prop]}`);
    }
  }
  // A glide wraps only while the blob is fully off canvas.
  const glide = field.blobs[0].x;
  const reach = Math.abs(glide.to - glide.from) - 1920;
  assert.ok(reach / 2 >= field.blobs[0].size * 0.5, "the wrap happens off canvas");
  const segments = axisSegments(glide, 0, glide.period * 2.5);
  assert.equal(segments[0].at, 0);
  assert.ok(Math.abs(segments[0].from - axisValue(glide, 0)) < 1e-3);
  for (const segment of segments.slice(1)) assert.equal(segment.from, glide.from);
});

test("driftPlan pushes in within the bounds and pulls back when there is no room", () => {
  const bounds = geometry.safeZone;
  const roomy = { x: 200, y: 600, width: 680, height: 400 };
  const push = driftPlan({ rect: roomy, level: "standard", start: 0, end: 5, canvas, bounds });
  assert.equal(push.mode, "push");
  assert.ok(push.scale > 1 && push.scale <= 1 + AMBIENT_PRESETS.standard.scaleMax + 1e-9);
  assert.ok(inside(bounds, driftExtent(roomy, push)));
  assert.ok(push.y !== 0, "a few px of vertical travel");
  assert.deepEqual(push.origin, { x: 540, y: 800 });
  // Full safe width: no horizontal room, so it pulls back and travels into the vertical room.
  const wide = { x: 80, y: 280, width: 860, height: 880 };
  const pull = driftPlan({ rect: wide, level: "standard", start: 0, end: 5, canvas, bounds });
  assert.equal(pull.mode, "pull");
  assert.ok(pull.scale < 1);
  assert.ok(pull.y > 0, "the only room is below");
  assert.ok(inside(bounds, driftExtent(wide, pull)));
  // A pull-back never shrinks key text below the limit.
  const limited = driftPlan({ rect: wide, level: "standard", start: 0, end: 5, canvas, bounds, minTextPx: 44, minTextLimit: 44 });
  assert.equal(limited.scale, 1);
  assert.ok(limited.y > 0);
  // The whole safe zone and no text headroom: nothing to do.
  assert.equal(driftPlan({ rect: { ...bounds }, level: "standard", start: 0, end: 5, canvas, bounds, minTextPx: 44, minTextLimit: 44 }), null);
  assert.equal(driftPlan({ rect: roomy, level: "off", start: 0, end: 5, canvas, bounds }), null);
  // Rates scale with the window and cap at the level maximum.
  const short = driftPlan({ rect: roomy, level: "standard", start: 0, end: 1, canvas, bounds });
  assert.ok(short.scale - 1 < push.scale - 1);
  const long = driftPlan({ rect: roomy, level: "standard", start: 0, end: 60, canvas, bounds });
  assert.ok(long.scale - 1 <= AMBIENT_PRESETS.standard.scaleMax + 1e-9);
  assert.ok(Math.abs(long.y) <= AMBIENT_PRESETS.standard.shiftMax + 1e-9);
});

test("drift bounds keep a rect above the caption band out of it", () => {
  const rect = { x: 200, y: 900, width: 680, height: 280 };
  const bounds = driftBounds(rect, { ...geometry, captions: true });
  assert.equal(bounds.y + bounds.height, geometry.captionBand.y);
  const plan = driftPlan({ rect, level: "lively", start: 0, end: 6, canvas, bounds });
  const extent = driftExtent(rect, plan);
  assert.ok(extent.y + extent.height <= geometry.captionBand.y + 1e-6);
  assert.deepEqual(driftBounds(rect, { ...geometry, captions: false }), geometry.safeZone);
});

test("drift state is identity before the window, linear through it and held after", () => {
  const drift = driftPlan({ rect: { x: 200, y: 600, width: 680, height: 400 }, level: "standard", start: 2, end: 6, canvas, bounds: geometry.safeZone });
  assert.deepEqual(driftStateAt(drift, 1), { x: 0, y: 0, scale: 1 });
  const mid = driftStateAt(drift, 4);
  assert.ok(Math.abs(mid.scale - (1 + (drift.scale - 1) / 2)) < 1e-12);
  assert.deepEqual(driftStateAt(drift, 9), { x: drift.x, y: drift.y, scale: drift.scale });
  assert.deepEqual(driftStateAt(null, 3), { x: 0, y: 0, scale: 1 });
  assert.match(driftStyle(drift, 4).transform, /^translate\(0px, -?[\d.]+px\) scale\(1\.\d+\)$/);
  assert.equal(driftStyle(drift, 4).transformOrigin, "540px 800px");
  // GSAP seeking the drift tween gives the same state.
  const { from, to, position } = driftGsap(drift);
  assert.equal(to.immediateRender, false);
  assert.equal(to.force3D, false);
  const target = { x: 0, y: 0, scale: 1 };
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(target, { x: from.x, y: from.y, scale: from.scale }, { x: to.x, y: to.y, scale: to.scale, duration: to.duration, ease: to.ease, immediateRender: false }, position);
  tl.set({}, {}, 10);
  for (const t of [5.5, 2.2, 3.9, 6.5, 2.0001]) {
    tl.seek(t, false);
    const state = driftStateAt(drift, t);
    for (const prop of ["x", "y", "scale"]) assert.ok(Math.abs(target[prop] - state[prop]) < 2e-5, `${prop} at ${t}`); // GSAP renders 5 decimals
  }
});

test("sceneDrift applies eligibility: placeholders, decor cameras and root videos stay still", () => {
  const s = story();
  const model = { layout: { rect: { x: 200, y: 600, width: 680, height: 400 }, role: "text" }, minTextPx: 60 };
  const drift = sceneDrift(s, s.scenes[0], model, { window: { start: 0, end: 4 }, geometry });
  assert.ok(drift);
  assert.equal(driftEligible(s, s.scenes[0], { ...model, placeholder: true }), false);
  assert.equal(driftEligible(s, s.scenes[0], { ...model, layout: { ...model.layout, role: "decor" } }), false);
  assert.equal(driftEligible(s, { ...s.scenes[0], module: "media-window", params: { media: { kind: "video", src: "assets/a.mp4" } } }, model), false);
  assert.equal(driftEligible(s, { ...s.scenes[0], module: "media-window", params: { media: { kind: "image", src: "assets/a.png" } } }, model), true);
  assert.equal(driftEligible(s, { ...s.scenes[0], ambient: { drift: false } }, model), false);
  assert.equal(driftEligible(s, s.scenes[0], { layout: { rect: null } }), false);
  // Media rects are clamped to the canvas, not the safe zone.
  const media = sceneDrift(s, s.scenes[0], { layout: { rect: { x: 0, y: 300, width: 1080, height: 600 }, role: "media" } }, { window: { start: 0, end: 4 }, geometry });
  assert.ok(inside({ x: 0, y: 0, ...canvas }, driftExtent({ x: 0, y: 300, width: 1080, height: 600 }, media)));
});
