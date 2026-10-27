// Zooms inside a shot (kit/core/zooms.mjs, docs/KIT_CONTRACTS.md "Zooms
// inside a shot"): validation, the world-camera moves, the cuts-mode
// wrappers, GSAP seek parity and both compilers.
import assert from "node:assert/strict";
import test from "node:test";
import gsap from "gsap";
import {
  blurAt, cameraPlan, cameraStateAt, captionDipWindows, containerState, opsStateAt, restState, sceneObjectLookup, screenPoint, worldPoint
} from "../kit/core/camera-world.mjs";
import { getEase } from "../kit/core/motion.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";
import { worldBackdrops } from "../kit/core/world-backdrops.mjs";
import { ZOOM, shotZooms, zoomFitError, zoomFrame, zoomOps, zoomStateAt, zoomTiming } from "../kit/core/zooms.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const W = 1080, H = 1920;
const SIZE = { width: W, height: H };
const BOX = { x: 140, y: 700, width: 600, height: 300 };

// Three shots: a box zoom on a title, a target zoom (bar 0) handing over to a
// second one (bar 2) on a bar chart, and an object zoom into the gauge's gap.
function zoomStory({ mode = "world", grammar = "playful", mutate = (story) => story } = {}) {
  return resolveStory(mutate({
    schema: "launchclip.story.v1", lane: "motion",
    format: { width: W, height: H, fps: 30, duration: 24 },
    brand: { colors: { bg: "#0b1020", primary: "#ff7a59", accent: "#7ce7ff", ink: "#0b1020", paper: "#f5f1ea" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
    motion: { grammar }, camera: { mode },
    plate: { kind: "starfield" },
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 6, params: { headline: "Which model wins on cost?" }, zooms: [{ at: 1.5, box: { ...BOX }, until: 4 }] },
      { id: "s2", module: "bar-chart", start: 6, end: 15, in: { type: "pan", dur: 0.8 }, params: { title: "Score", data: [{ label: "Astra", value: 57.6 }, { label: "Bolt", value: 42 }, { label: "Comet", value: 31 }] },
        zooms: [{ at: 7.5, target: 0 }, { at: 10, target: "bar-2", until: 12.5 }] },
      { id: "s3", module: "gauge-compare", start: 15, end: 24, in: { type: "pan", dur: 0.8, direction: "down" },
        params: { left: { label: "Cold", value: 2400, unit: "ms" }, right: { label: "Warm", value: 300, unit: "ms" }, gap: { label: "Saved", value: 2100, unit: "ms" }, style: "column" },
        zooms: [{ at: 17, object: "gap-bracket", scale: 1.6 }] }
    ]
  }));
}

const lookup = (story) => sceneObjectLookup(story, (scene, value) => resolveModule(scene, value));
const planFor = (story) => cameraPlan(story, { windows: sceneWindows(story), objects: lookup(story) });

test("zoom validation: one of box, target or object; scale range; inside the plate and the safe area; no overlap; never during the entry move; hold", () => {
  assert.deepEqual(validateStory(zoomStory()).errors, []);
  const bad = (change) => validateStory(zoomStory({ mutate: (story) => { change(story); return story; } })).errors.join("\n");
  assert.match(bad((s) => { s.scenes[0].zooms[0].target = 1; }), /needs exactly one of box, target or object/);
  assert.match(bad((s) => { s.scenes[0].zooms[0].scale = 3.5; }), /scale must be a number from 1\.15 to 3/);
  assert.match(bad((s) => { s.scenes[0].zooms[0].box = { x: 900, y: 0, width: 400, height: 200 }; }), /box must sit inside the scene's 1080×1920 plate/);
  assert.match(bad((s) => { s.scenes[0].zooms[0].box = { x: 0, y: 0, width: 300, height: 200 }; }), /leaves the safe area/);
  assert.match(bad((s) => { s.scenes[1].zooms[0].at = 6.5; }), /falls during the shot's entry move \(until 6\.8 s\)/);
  assert.match(bad((s) => { s.scenes[1].zooms[0].until = 9.6; }), /overlaps zooms\[1\]/);
  assert.match(bad((s) => { s.scenes[0].zooms[0].until = 2.8; }), /holds 0\.5 s; a zoom holds at least 1\.2 s/);
  assert.match(bad((s) => { s.scenes[0].zooms[0].until = 5.5; }), /must leave 0\.8 s to ease out/);
  assert.match(bad((s) => { s.scenes[0].zooms.push({ at: 1, box: { ...BOX } }); }), /must come after zooms\[0\]\.at/);
  assert.match(bad((s) => { s.scenes[0].zooms[0].wobble = true; }), /zooms\[0\]\.wobble is not supported/);
  assert.match(bad((s) => { s.scenes.push({ id: "o1", module: "count-up", track: 1, start: 2, end: 5, params: { value: 3, label: "x" }, zooms: [{ at: 3, box: { ...BOX } }] }); }), /only a track-0 shot zooms/);
  // Anchors resolve like hits.
  const anchored = resolveStory({ ...zoomStory(), resolved: undefined, scenes: [{ ...zoomStory().scenes[0], zooms: [{ at: "word:cost", box: { ...BOX }, until: "word:cost+2" }] }] }, { words: [{ text: "cost", start: 1.2, end: 1.6 }] });
  assert.deepEqual(anchored.scenes[0].zooms[0], { at: 1.2, box: BOX, until: 3.2 });
});

test("framing: the default scale fills the frame, the centre is clamped to the plate, and the safe-area check", () => {
  const frame = zoomFrame({ x: 340, y: 860, width: 400, height: 200 }, undefined, SIZE);
  assert.equal(frame.scale, round(Math.min(0.7 * W / 400, 0.7 * H / 200), 4));
  assert.deepEqual(frame.centre, { x: 540, y: 960 });
  assert.equal(zoomFitError(frame, SIZE), null);
  // Near the edge the view stops at the plate's edge instead of showing past it.
  const edge = zoomFrame({ x: 60, y: 200, width: 200, height: 100 }, 2, SIZE);
  assert.deepEqual(edge.centre, { x: W / 4, y: H / 4 });
  assert.equal(edge.screen.x, 120);
  assert.match(zoomFitError(zoomFrame({ x: 0, y: 0, width: 200, height: 100 }, 2, SIZE), SIZE), /leaves the safe area/);
  assert.equal(zoomFrame(BOX, 3, SIZE).scale, 3);
  // Timing: the grammar's camera duration clamped to 0.5–0.8 s, with its ease.
  assert.deepEqual(zoomTiming({ motion: { grammar: "playful" } }), { duration: 0.75, ease: "back.inOut(1.6)" });
  assert.deepEqual(zoomTiming({ motion: { grammar: "smooth" } }), { duration: ZOOM.move.max, ease: "sine.inOut" });
  assert.deepEqual(zoomTiming({ motion: { grammar: "snappy" } }), { duration: 0.55, ease: "back.inOut(1.2)" });
});

test("targets and objects resolve to plate rects on the model", () => {
  const story = zoomStory();
  const objects = lookup(story);
  const [bar0, bar2] = objects.zoomRects("s2");
  assert.ok(bar0.rect.width > 0 && bar0.rect.height > 0, JSON.stringify(bar0));
  assert.ok(bar2.rect.x > bar0.rect.x, "bar 2 sits right of bar 0");
  const model = resolveModule(story.scenes.find((scene) => scene.id === "s3"), story);
  assert.deepEqual(objects.zoomRects("s3")[0].rect, { ...model.objects["gap-bracket"].rect });
  // A missing object or a module without targets is dropped with a warning.
  const broken = zoomStory({ mutate: (s) => { s.scenes[2].zooms[0].object = "nope"; s.scenes[0].zooms = [{ at: 1.5, target: 0 }]; return s; } });
  const plan = planFor(broken);
  assert.equal(plan.warnings.length, 2);
  assert.match(plan.warnings.join("\n"), /s1: zooms\[0\] skipped: .*has no state targets/);
  assert.match(plan.warnings.join("\n"), /s3: zooms\[0\] skipped: .*has no object "nope"/);
  assert.equal(plan.moves.filter((move) => move.zoom && move.sceneId !== "s2").length, 0);
});

test("world mode: zooms are camera moves inside the shot, eased in and out with the grammar, and the box lands where its framing says", () => {
  const story = zoomStory();
  const plan = planFor(story);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.moves.map((move) => [move.sceneId, move.type, move.start, move.duration, move.ease]), [
    ["s1", "zoom", 1.5, 0.75, "back.inOut(1.6)"], ["s1", "zoom", 4, 0.75, "back.inOut(1.6)"],
    ["s2", "pan", 6, 0.8, "back.inOut(1.6)"],
    // bar 0, handed straight over to bar 2, out at until.
    ["s2", "zoom", 7.5, 0.75, "back.inOut(1.6)"], ["s2", "zoom", 10, 0.75, "back.inOut(1.6)"], ["s2", "zoom", 12.5, 0.75, "back.inOut(1.6)"],
    ["s3", "pan", 15, 0.8, "back.inOut(1.6)"],
    // No until and no next zoom: back at rest as the shot ends.
    ["s3", "zoom", 17, 0.75, "back.inOut(1.6)"], ["s3", "zoom", 23.25, 0.75, "back.inOut(1.6)"]
  ]);
  // At rest inside a zoom: the box's centre (clamped) is the canvas centre and
  // its corners sit where zoomFrame puts them.
  const still = { ...plan, drift: null };
  const rects = lookup(story).zoomRects("s2");
  for (const [id, rect, scale, t] of [["s1", BOX, undefined, 3], ["s2", rects[0].rect, undefined, 9], ["s2", rects[1].rect, undefined, 11.5], ["s3", lookup(story).zoomRects("s3")[0].rect, 1.6, 20]]) {
    const placement = plan.placements[id];
    const frame = zoomFrame(rect, scale, SIZE);
    const rest = restState(placement, SIZE);
    assert.deepEqual(cameraStateAt(plan, t).zoom, round(rest.zoom * frame.scale, 6), `${id} zoom at ${t}`);
    const corner = screenPoint(still, worldPoint(placement, { x: rect.x + rect.width, y: rect.y + rect.height }), t);
    assert.ok(Math.abs(corner.x - (frame.screen.x + frame.screen.width)) < 0.05 && Math.abs(corner.y - (frame.screen.y + frame.screen.height)) < 0.05, `${id} corner ${corner.x},${corner.y} vs ${JSON.stringify(frame.screen)}`);
  }
  // Back at rest between zooms and before the next shot's move.
  for (const [id, t] of [["s1", 5.5], ["s2", 14], ["s3", 16.5]]) assert.deepEqual(cameraStateAt(plan, t), restState(plan.placements[id], SIZE), `${id} at rest at ${t}`);
  // Captions are outside the camera: zooms never dip them.
  assert.deepEqual(captionDipWindows(plan, true).map((dip) => dip.start), [6, 15]);
  // The backdrops still enter on the moves between shots, and follow the zooms.
  const backdrops = worldBackdrops(story, plan, sceneWindows(story));
  assert.deepEqual(backdrops.segments.map((segment) => segment.entry.type), ["first"]);
  assert.ok(backdrops.ops.filter((op) => op.target === "backdrop-0" && op.type === "tween").length >= 7, "the backdrop follows every move");
  // Grammar timing: snappy zooms take 0.55 s.
  assert.ok(planFor(zoomStory({ grammar: "snappy" })).moves.filter((move) => move.zoom).every((move) => move.duration === 0.55 && move.ease === "back.inOut(1.2)"));
});

test("world mode: GSAP seeking the camera ops with zooms matches the frame-pure camera", () => {
  const plan = planFor(zoomStory({ mutate: (s) => ({ ...s, camera: { mode: "world", blur: true } }) }));
  const targets = { pan: { x: 0, y: 0 }, zoom: { scale: 1, rotation: 0 }, drift: { x: 0, y: 0, scale: 1 }, background: { x: 0, y: 0, scale: 1, rotation: 0 }, blur: { x: 0, y: 0 } };
  const tl = gsap.timeline({ paused: true });
  for (const op of plan.ops) {
    const target = targets[op.target];
    if (op.type === "set") tl.set(target, { ...op.props }, op.time);
    else tl.fromTo(target, { ...op.from }, { ...op.to, duration: op.duration, ease: op.ease, immediateRender: false }, op.start);
  }
  tl.set({}, {}, plan.duration);
  const times = [9, 1.9, 23.6, 3, 10.3, 0.2, 12.9, 17.4, 4.3, 7.6].concat(Array.from({ length: 40 }, (_, i) => ((i * 7919) % 2400) / 100));
  for (const t of times) {
    tl.seek(t, false);
    const state = containerState(plan, t);
    const expected = { pan: state.pan, zoom: state.zoom, drift: state.drift, background: state.background, blur: blurAt(plan, t) };
    for (const [name, values] of Object.entries(expected)) {
      for (const [key, value] of Object.entries(values)) assert.ok(Math.abs(targets[name][key] - value) < 1e-3, `${name}.${key} at ${t}: GSAP ${targets[name][key]} vs frame-pure ${value}`);
    }
  }
});

test("cuts mode: the wrappers reproduce the world camera's zoom math, and GSAP seeking them matches the frame-pure state", () => {
  const story = zoomStory({ mode: "cuts" });
  // Cuts mode: the pans still move the camera, but the scenes zoom themselves.
  assert.equal(planFor(story).moves.some((move) => move.zoom), false);
  const entry = sceneWindows(story).scenes.find((item) => item.id === "s2");
  const { keys } = shotZooms(story, entry, lookup(story).zoomRects("s2"));
  const ops = zoomOps(keys, SIZE);
  // The same story in world mode puts s2's plate point on the same pixel.
  const world = planFor(zoomStory());
  const placement = world.placements.s2;
  const probe = { x: 300, y: 1200 };
  for (const t of [7.4, 7.9, 9, 10.3, 11.5, 12.8, 13.5]) {
    const z = opsStateAt(ops, "zoom", t), p = opsStateAt(ops, "pan", t);
    const cuts = { x: W / 2 + z.scale * (probe.x + p.x - W / 2), y: H / 2 + z.scale * (probe.y + p.y - H / 2) };
    const state = zoomStateAt(keys, t, getEase, SIZE);
    assert.ok(Math.abs(cuts.x - (W / 2 + state.s * (probe.x - state.x))) < 1e-3, `cuts ${t}`);
    const seen = screenPoint({ ...world, drift: null }, worldPoint(placement, probe), t);
    assert.ok(Math.abs(seen.x - cuts.x) < 0.05 && Math.abs(seen.y - cuts.y) < 0.05, `world ${seen.x},${seen.y} vs cuts ${cuts.x},${cuts.y} at ${t}`);
  }
  const targets = { pan: { x: 0, y: 0 }, zoom: { scale: 1, rotation: 0 } };
  const tl = gsap.timeline({ paused: true });
  for (const op of ops) {
    if (op.type === "set") tl.set(targets[op.target], { ...op.props }, op.time);
    else tl.fromTo(targets[op.target], { ...op.from }, { ...op.to, duration: op.duration, ease: op.ease, immediateRender: false }, op.start);
  }
  tl.set({}, {}, 15);
  for (const t of [12.9, 8, 0.5, 10.2, 7.8, 14.9, 11, 7.5, 13.2]) {
    tl.seek(t, false);
    for (const name of ["pan", "zoom"]) for (const [key, value] of Object.entries(opsStateAt(ops, name, t))) assert.ok(Math.abs(targets[name][key] - value) < 1e-3, `${name}.${key} at ${t}`);
  }
});

test("compilers: cuts mode wraps a zooming plate's layer; world mode moves the camera instead", async () => {
  const cuts = await compileStoryToHyperFrames(zoomStory({ mode: "cuts" }), { write: false });
  assert.deepEqual(cuts.warnings.filter((warning) => /zoom/.test(warning)), []);
  assert.match(cuts.html, /<div id="lc-zs-s1" class="lc-zoom"><div id="lc-zp-s1" class="lc-zoom"><div id="lc-layer-s1" class="lc-layer">/);
  assert.match(cuts.html, /\.lc-plate > \.lc-zoom > \.lc-zoom > \.lc-layer \{ background: #0b1020; \}/);
  assert.match(cuts.html, /tl\.fromTo\("#lc-zs-s2", \{"scale":1,"rotation":0,"force3D":false\}, \{"scale":[\d.]+,"rotation":0,"duration":0\.75,"ease":"back\.inOut\(1\.6\)","immediateRender":false,"force3D":false\}, 7\.5\);/);
  const world = await compileStoryToHyperFrames(zoomStory(), { write: false });
  assert.doesNotMatch(world.html, /lc-zoom/);
  assert.match(world.html, /move\(s\)/);
  assert.match(world.html, /tl\.fromTo\("#lc-cam-zoom", \{"scale":1,"rotation":0,"force3D":false\}, \{"scale":1\.26,"rotation":0,"duration":0\.75,"ease":"back\.inOut\(1\.6\)","immediateRender":false,"force3D":false\}, 1\.5\);/);
  // A story without zooms compiles exactly as before.
  const plain = zoomStory({ mode: "cuts", mutate: (s) => { for (const scene of s.scenes) delete scene.zooms; return s; } });
  assert.doesNotMatch((await compileStoryToHyperFrames(plain, { write: false })).html, /lc-zoom/);
});

function round(value, digits = 4) { const f = 10 ** digits; return Math.round(value * f) / f; }
