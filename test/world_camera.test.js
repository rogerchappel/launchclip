import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import {
  CAMERA_STACK, ridesPlate, rideWorldPlates,
  blurAt, cameraActive, cameraOps, cameraPlan, cameraStateAt, containerState, layoutDirection, objectRectFromModel, opsStateAt,
  overlayOps, PARALLAX, placementCentre, resolveCamera, restState, sceneObjectLookup, screenPoint, worldLayout, worldPoint
} from "../kit/core/camera-world.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { resolveStory, validateStory } from "../kit/core/story.mjs";
import { sceneWindows, transitionTweens } from "../kit/core/transitions.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const W = 1080, H = 1920;

// A five-plate world story with every camera move, plus one overlay.
function worldStory({ camera = { mode: "world" }, grammar = "playful", mutate = (story) => story } = {}) {
  const story = {
    schema: "launchclip.story.v1", lane: "motion",
    format: { width: W, height: H, fps: 30, duration: 20 },
    brand: { colors: { bg: "#0b1020", primary: "#ff7a59", accent: "#7ce7ff", ink: "#0b1020", paper: "#f5f1ea" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
    motion: { grammar }, camera,
    scenes: [
      { id: "s1", module: "hook-title", start: 0, end: 4, energy: 1, params: { headline: "Why is the second visit instant?" } },
      { id: "s2", module: "count-up", start: 4, end: 8, energy: 2, in: { type: "pan", dur: 0.8, direction: "right" }, params: { value: 2.4, decimals: 1, suffix: "s", label: "First load" } },
      { id: "s3", module: "gauge-compare", start: 8, end: 12, energy: 2, in: { type: "pan", dur: 0.8, direction: "down" },
        params: { left: { label: "Cold", value: 2400, unit: "ms" }, right: { label: "Warm", value: 300, unit: "ms" }, gap: { label: "Saved", value: 2100, unit: "ms" }, style: "column" } },
      { id: "s4", module: "process-steps", start: 12, end: 16, energy: 2, in: { type: "push", dur: 0.9, from_object: "s3.gap-bracket" }, params: { steps: ["Ask", "Check", "Hit", "Serve"] } },
      { id: "s5", module: "cta", start: 16, end: 20, energy: 3, in: { type: "orbit", dur: 0.8, direction: "right" }, params: { action: "Follow for part two" } },
      { id: "o1", module: "count-up", track: 1, start: 3, end: 6, energy: 1, params: { value: 7, label: "Overlay", rect: { x: 120, y: 300, width: 800, height: 620 } } }
    ],
    ending: { loop_to: "s1", in: { type: "whip-pan", dur: 0.4 } }
  };
  return resolveStory(mutate(story));
}

const lookup = (story) => sceneObjectLookup(story, (scene, value) => resolveModule(scene, value));
const planFor = (story) => cameraPlan(story, { windows: sceneWindows(story), objects: lookup(story) });

test("story validation accepts motion.grammar, camera and the camera transitions, and rejects misuse", () => {
  const story = worldStory();
  assert.deepEqual(validateStory(story).errors, []);
  const bad = (mutate) => validateStory(worldStory({ mutate })).errors.join("\n");
  assert.match(bad((s) => { s.camera = { mode: "orbit" }; return s; }), /camera\.mode must be one of cuts, world/);
  assert.match(bad((s) => { s.camera.spacing = 3; return s; }), /camera\.spacing/);
  assert.match(bad((s) => { s.motion = { grammar: "bouncy" }; return s; }), /motion\.grammar must be one of/);
  assert.match(bad((s) => { s.motion = { grammar: { base: "snappy", ease: { enter: "wobble.out" } } }; return s; }), /motion\.grammar\.ease\.enter/);
  assert.match(bad((s) => { s.scenes[5].in = { type: "pan", dur: 0.4 }; return s; }), /overlays \(track ≥ 1\) cannot use it/);
  assert.deepEqual(validateStory(worldStory({ grammar: { base: "smooth", stagger: 1.4, ease: { camera: "power2.inOut" } } })).errors, []);
  // A style pack may carry a world camera into the footage-led lane: it is
  // ignored there (cuts and punch-ins), with a warning.
  assert.equal(resolveCamera({ lane: "footage-led", camera: { mode: "world" } }).mode, "cuts");
});

test("resolveCamera defaults and cameraActive", () => {
  assert.deepEqual(resolveCamera({}), { mode: "cuts", layout: "auto", spacing: 0.12, parallax: false, blur: null });
  assert.deepEqual(resolveCamera({ camera: { mode: "world", blur: true } }), { mode: "world", layout: "auto", spacing: 0.12, parallax: true, blur: true });
  assert.equal(cameraActive(worldStory()), true);
  assert.equal(cameraActive(worldStory({ camera: { mode: "cuts" }, mutate: (s) => { for (const scene of s.scenes) delete scene.in; delete s.ending.in; return s; } })), false);
  // A cuts story with one pan still gets a camera; push stays a slide in cuts.
  assert.equal(cameraActive(worldStory({ camera: { mode: "cuts" }, mutate: (s) => { for (const scene of s.scenes) if (scene.in?.type !== "pan") delete scene.in; s.scenes[2].in = { type: "push", dur: 0.5 }; delete s.ending.in; return s; } })), true);
});

test("world layout places plates by direction, turns orbits, nests pushes inside the named object and returns home for the loop", () => {
  const story = worldStory();
  const windows = sceneWindows(story);
  const objects = lookup(story);
  const { placements, loop } = worldLayout(story, windows, { objects });
  const size = { width: W, height: H };
  assert.deepEqual(placements.get("s1"), { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.deepEqual(placements.get("s2"), { x: 1209.6, y: 0, scale: 1, rotation: 0 }, "pan right: one canvas plus 12% spacing to the right");
  assert.deepEqual(placements.get("s3"), { x: 1209.6, y: 2150.4, scale: 1, rotation: 0 }, "pan down");
  // push: s4 sits inside the gauge's gap bracket, scaled down.
  const bracket = objects("s3", "gap-bracket");
  assert.ok(bracket && bracket.width > 0, "gauge-compare exposes its gap bracket");
  const s4 = placements.get("s4");
  assert.ok(s4.scale < 1 / 1.59 && s4.scale > 1 / 3.21, `dolly scale ${s4.scale}`);
  const focus = worldPoint(placements.get("s3"), { x: bracket.x + bracket.width / 2, y: bracket.y + bracket.height / 2 });
  const centre = placementCentre(s4, size);
  assert.ok(Math.hypot(centre.x - focus.x, centre.y - focus.y) < 0.01, "the pushed plate is centred on the object");
  // orbit: beside s4 at its scale, turned 9°.
  const s5 = placements.get("s5");
  assert.equal(s5.rotation, 9);
  assert.equal(s5.scale, s4.scale);
  assert.deepEqual(loop, placements.get("s1"), "a camera ending travels home to the loop scene");
  // A plain fade stacks the incoming plate on the outgoing one.
  const faded = worldStory({ mutate: (s) => { s.scenes[1].in = { type: "fade", dur: 0.4 }; return s; } });
  assert.deepEqual(worldLayout(faded, sceneWindows(faded), { objects: lookup(faded) }).placements.get("s2"), placements.get("s1"));
  // Layout defaults fill a missing direction.
  assert.deepEqual([0, 1, 2, 3].map((i) => layoutDirection("grid", i, 5)), ["right", "right", "down", "left"]);
  assert.deepEqual([0, 1, 2].map((i) => layoutDirection("path", i, 4)), ["right", "down", "right"]);
  assert.equal(layoutDirection("column", 0, 3), "down");
  assert.equal(objectRectFromModel({ layout: { rect: { x: 1, y: 2, width: 3, height: 4 } } }, "missing").width, 3);
});

test("at rest the camera frames each plate exactly; moves use the grammar's camera ease", () => {
  const story = worldStory();
  const plan = planFor(story);
  assert.equal(plan.mode, "world");
  assert.deepEqual(plan.moves.map((move) => [move.sceneId, move.type, move.ease]), [
    ["s2", "pan", "back.inOut(1.6)"], ["s3", "pan", "back.inOut(1.6)"], ["s4", "push", "back.inOut(1.6)"], ["s5", "orbit", "back.inOut(1.6)"], ["s1-loop", "whip-pan", "back.inOut(1.2)"]
  ]);
  for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
    const placement = plan.placements[id];
    const entry = story.scenes.find((scene) => scene.id === id);
    const t = entry.start + (entry.in?.dur ?? 0) + 0.5;
    assert.deepEqual(cameraStateAt(plan, t), restState(placement, { width: W, height: H }));
    // The plate's corners land on the canvas corners (up to the drift).
    const corner = screenPoint({ ...plan, drift: null }, worldPoint(placement, { x: W, y: H }), t);
    assert.ok(Math.abs(corner.x - W) < 1e-3 && Math.abs(corner.y - H) < 1e-3, `${id} corner ${corner.x},${corner.y}`);
  }
  // By default whip-pans blur fully and, in playful (and snappy), every other
  // move blurs at the grammar's moderate moveBlur; editorial keeps them sharp.
  assert.deepEqual(plan.moves.map((move) => move.blur), [0.5, 0.5, 0.5, 0.5, 1]);
  assert.deepEqual(planFor(worldStory({ grammar: "editorial" })).moves.map((move) => move.blur), [0, 0, 0, 0, 1]);
  assert.equal(planFor(worldStory({ camera: { mode: "world", blur: true } })).moves.every((move) => move.blur === 1), true);
  assert.equal(planFor(worldStory({ camera: { mode: "world", blur: false } })).moves.every((move) => move.blur === 0), true);
});

test("the camera path is continuous in position and velocity at every move boundary, and never fully still", () => {
  const plan = planFor(worldStory());
  const probe = { x: W / 2, y: H / 2 };
  const at = (t) => screenPoint(plan, probe, t);
  const velocity = (t, h = 1e-4) => { const a = at(t - h), b = at(t + h); return { x: (b.x - a.x) / (2 * h), y: (b.y - a.y) / (2 * h) }; };
  let peak = 0;
  for (let t = 0.01; t < plan.duration; t += 1 / 60) { const v = velocity(t); peak = Math.max(peak, Math.hypot(v.x, v.y)); }
  for (const move of plan.moves) {
    for (const boundary of [move.start, move.start + move.duration]) {
      if (boundary >= plan.duration - 1e-6) continue;
      const before = at(boundary - 1e-6), after = at(boundary + 1e-6);
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.01, `${move.sceneId} position jumps at ${boundary}`);
      const vb = velocity(boundary - 2e-3, 1e-3), va = velocity(boundary + 2e-3, 1e-3);
      assert.ok(Math.hypot(va.x - vb.x, va.y - vb.y) < peak * 0.01, `${move.sceneId} velocity jumps at ${boundary}: ${JSON.stringify(vb)} → ${JSON.stringify(va)} (peak ${peak})`);
    }
  }
  // Drift: the camera keeps moving between moves.
  let still = 0;
  for (let f = 1; f < plan.duration * 30; f += 1) {
    const a = at((f - 1) / 30), b = at(f / 30);
    const world = containerState(plan, f / 30).drift, prev = containerState(plan, (f - 1) / 30).drift;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-3 && Math.abs(world.scale - prev.scale) < 1e-7) still += 1;
  }
  assert.equal(still, 0, "no frame repeats the previous camera state");
  // The drift loops: the last frame returns to the first frame's offset.
  assert.ok(Math.abs(containerState(plan, plan.duration).drift.x - containerState(plan, 0).drift.x) < 1e-9);
});

test("GSAP seeking the camera ops matches the frame-pure camera function, in any order", () => {
  const story = worldStory({ camera: { mode: "world", blur: true } });
  const plan = planFor(story);
  const overlay = sceneWindows(story).scenes.find((entry) => entry.id === "o1");
  const parallax = overlayOps(plan, { start: overlay.start, end: overlay.renderEnd });
  assert.ok(parallax.length > 1, "the overlay spans the first pan");
  const targets = { pan: { x: 0, y: 0 }, zoom: { scale: 1, rotation: 0 }, drift: { x: 0, y: 0, scale: 1 }, background: { x: 0, y: 0, scale: 1, rotation: 0 }, blur: { x: 0, y: 0 }, overlay: { x: 0, y: 0 } };
  const tl = gsap.timeline({ paused: true });
  for (const op of [...plan.ops, ...parallax]) {
    const target = targets[op.target];
    if (op.type === "set") tl.set(target, { ...op.props }, op.time);
    else tl.fromTo(target, { ...op.from }, { ...op.to, duration: op.duration, ease: op.ease, immediateRender: false }, op.start);
  }
  tl.set({}, {}, plan.duration);
  const times = [7.3, 0.2, 4.4, 19.8, 12.45, 4.05, 8.4, 16.33, 2.1, 12.9, 19.65, 0.9, 4.8].concat(Array.from({ length: 40 }, (_, i) => ((i * 7919) % 2000) / 100));
  for (const t of times) {
    tl.seek(t, false);
    const state = containerState(plan, t);
    const expected = { pan: state.pan, zoom: state.zoom, drift: state.drift, background: state.background, blur: blurAt(plan, t), overlay: opsStateAt(parallax, "overlay", t) };
    for (const [name, values] of Object.entries(expected)) {
      for (const [key, value] of Object.entries(values)) {
        if (name === "overlay" && t < overlay.start) continue;
        assert.ok(Math.abs(targets[name][key] - value) < 1e-3, `${name}.${key} at ${t}: GSAP ${targets[name][key]} vs frame-pure ${value}`);
        if (name !== "blur" && name !== "overlay") assert.ok(Math.abs(opsStateAt(plan.ops, name, t)[key] - value) < 1e-3, `ops ${name}.${key} at ${t}`);
      }
    }
  }
});

test("parallax: the background moves at 0.3×, plates at 1×, overlays at 1.15× the camera", () => {
  const story = worldStory();
  const plan = planFor(story);
  const pan = plan.moves[0]; // s1 → s2, a pure horizontal pan
  const mid = pan.start + pan.duration / 2;
  const a = containerState(plan, pan.start), b = containerState(plan, mid);
  const plate = b.pan.x - a.pan.x;
  assert.ok(Math.abs(plate) > 100, "the plates moved");
  assert.ok(Math.abs((b.background.x - a.background.x) / plate - PARALLAX.background) < 1e-9);
  assert.equal(PARALLAX.plate, 1);
  const overlay = sceneWindows(story).scenes.find((entry) => entry.id === "o1");
  const ops = overlayOps(plan, { start: overlay.start, end: overlay.renderEnd });
  const extra = opsStateAt(ops, "overlay", mid).x - opsStateAt(ops, "overlay", pan.start).x;
  assert.ok(Math.abs((plate + extra) / plate - PARALLAX.overlay) < 1e-6, `overlay ratio ${(plate + extra) / plate}`);
  assert.equal(planFor(worldStory({ camera: { mode: "world", parallax: false } })).parallax, null);
  assert.equal(planFor(worldStory({ camera: { mode: "cuts" } })).parallax, null, "cuts stories have no depth layer");
});

test("motion blur is velocity-shaped and exactly zero at rest", () => {
  const plan = planFor(worldStory({ camera: { mode: "world", blur: true } }));
  const moving = (t) => plan.moves.some((move) => t > move.start && t <= move.start + move.duration + 1 / plan.fps + 1e-6);
  let peak = 0;
  for (let f = 0; f <= plan.duration * plan.fps; f += 1) {
    const t = f / plan.fps, blur = blurAt(plan, t);
    if (!moving(t)) assert.deepEqual(blur, { x: 0, y: 0 }, `blur at rest at ${t}`);
    peak = Math.max(peak, blur.x, blur.y);
  }
  assert.ok(peak > 4, `peak blur ${peak}`);
  // A horizontal pan blurs along x only; the vertical pan along y.
  const horizontal = plan.moves[0], vertical = plan.moves[1];
  const mid = (move) => blurAt(plan, Math.round((move.start + move.duration / 2) * plan.fps) / plan.fps);
  assert.ok(mid(horizontal).x > 1 && mid(horizontal).y < mid(horizontal).x * 0.2, JSON.stringify(mid(horizontal)));
  assert.ok(mid(vertical).y > 1 && mid(vertical).x < mid(vertical).y * 0.2, JSON.stringify(mid(vertical)));
  // Editorial default: whip-pans only.
  const defaults = planFor(worldStory({ grammar: "editorial" }));
  assert.ok(defaults.blurSamples.length > 0 && defaults.blurSamples.every((sample) => sample.t >= defaults.moves.at(-1).start));
  // Playful default: a moderate blur on the pans (half the shutter, half the
  // cap), still exactly zero at rest, and the whip-pan at full strength.
  const playful = planFor(worldStory());
  const at = (p, move) => blurAt(p, Math.round((move.start + move.duration / 2) * p.fps) / p.fps);
  assert.ok(at(playful, playful.moves[0]).x > 1, JSON.stringify(at(playful, playful.moves[0])));
  assert.ok(Math.abs(at(playful, playful.moves[0]).x - at(plan, horizontal).x / 2) < 0.6, `${at(playful, playful.moves[0]).x} vs ${at(plan, horizontal).x}`);
  assert.ok(Math.max(...playful.blurSamples.map((s) => Math.max(s.x, s.y))) <= 18);
  for (let f = 0; f <= playful.duration * playful.fps; f += 1) {
    const t = f / playful.fps;
    const moving = playful.moves.some((move) => t > move.start && t <= move.start + move.duration + 1 / playful.fps + 1e-6);
    if (!moving) assert.deepEqual(blurAt(playful, t), { x: 0, y: 0 }, `playful blur at rest at ${t}`);
  }

});

test("camera transitions keep their layers still and dollies crossfade; world mode fades layered reveals out", () => {
  const size = { width: W, height: H };
  assert.deepEqual(transitionTweens({ type: "pan", dur: 0.6, direction: "right" }, size), { type: "pan", duration: 0.6, camera: true, in: [], out: [] });
  const push = transitionTweens({ type: "push", dur: 1 }, { ...size, mode: "world" });
  assert.deepEqual(push.in.map((tw) => [tw.prop, tw.from, tw.to]), [["opacity", 0, 1]]);
  assert.deepEqual(push.out.map((tw) => [tw.prop, tw.from, tw.to]), [["opacity", 1, 0]]);
  assert.deepEqual(transitionTweens({ type: "push", dur: 0.5, direction: "left" }, size).in.map((tw) => tw.prop), ["x"], "push stays a slide in cuts mode");
  assert.deepEqual(transitionTweens({ type: "fade", dur: 0.4 }, { ...size, mode: "world" }).out.map((tw) => [tw.prop, tw.from, tw.to]), [["opacity", 1, 0]]);
  assert.deepEqual(transitionTweens({ type: "fade", dur: 0.4 }, size).out, []);
});

test("compilers: world stories get one camera container, cuts stories without camera transitions are unchanged", async () => {
  const story = worldStory();
  const { html, warnings } = await compileStoryToHyperFrames(story, { write: false });
  assert.deepEqual(warnings.filter((warning) => /camera|placeholder/.test(warning)), []);
  assert.equal((html.match(/id="lc-camera"/g) ?? []).length, 1);
  assert.match(html, /<div id="lc-cam-drift" class="lc-cam"><div id="lc-cam-zoom" class="lc-cam"><div id="lc-cam-pan" class="lc-cam"><div id="lc-scene-s1"/);
  assert.match(html, /id="lc-world-bg"/);
  assert.match(html, /\.lc-world-plate > \.lc-layer \{ background: transparent; \}/);
  assert.match(html, /tl\.fromTo\("#lc-cam-pan", \{"x":0,"y":0,"force3D":false\}, \{"x":-1209\.6,"y":0,"duration":0\.8,"ease":"back\.inOut\(1\.6\)","immediateRender":false,"force3D":false\}, 4\);/);
  assert.match(html, /<div id="lc-par-o1" class="lc-parallax">/);
  assert.match(html, /tl\.set\("#lc-cam-blur-k", \{ attr: \{ stdDeviation: "/);
  assert.match(html, /style="z-index:20;transform-origin:0 0;transform:translate\(1209\.6px, 0px\)"/);
  // Every op became one GSAP call (blur sets write two).
  const plan = planFor(story);
  const calls = plan.ops.reduce((sum, op) => sum + (op.target === "blur" ? 2 : 1), 0);
  assert.equal((html.match(/tl\.(set|fromTo)\("#lc-(cam-pan|cam-zoom|cam-drift|world-bg|cam-blur-k|camera)"/g) ?? []).length, calls);
  assert.equal(cameraOps(plan).length, plan.ops.length);
  // The minimal golden (cuts, no camera transition) has no camera at all.
  const minimal = resolveStory(JSON.parse(await readFile(path.join(ROOT, "examples/story/minimal/storyboard.json"), "utf8")), { words: JSON.parse(await readFile(path.join(ROOT, "examples/story/minimal/NARRATION.json"), "utf8")).words });
  assert.equal(planFor(minimal), null);
  assert.doesNotMatch((await compileStoryToHyperFrames(minimal, { write: false, sourceDir: path.join(ROOT, "examples/story/minimal") })).html, /lc-camera|lc-cam-/);
});

test("world mode stacks overlays above the camera: a cast on track 1 is never under a track-0 world plate", async () => {
  assert.ok(CAMERA_STACK.scenes > CAMERA_STACK.camera);
  const dir = path.join(ROOT, "examples/story/world-cast-16x9");
  const story = resolveStory(JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8")));
  const { html } = await compileStoryToHyperFrames(story, { write: false, sourceDir: dir });
  assert.match(html, new RegExp(`\\.lc-camera \\{[^}]*z-index: ${CAMERA_STACK.camera};`));
  const z = Number(html.match(/data-launchclip-scene="pair"[^>]*style="z-index:(\d+)/)[1]);
  assert.ok(z >= CAMERA_STACK.scenes, `cast-scene z-index ${z}`);
  // Remotion: overlays, the frame and the captions sit in one layer at CAMERA_STACK.scenes, after the camera.
  const tsx = await readFile(path.join(ROOT, "kit/remotion/StoryComposition.tsx"), "utf8");
  const world = tsx.slice(tsx.indexOf("<CameraWorld plan={plan}"));
  assert.match(world, /<\/CameraWorld>\s*\{\/\*[^*]*\*\/\}\s*<AbsoluteFill style=\{\{ zIndex: CAMERA_STACK\.scenes \}\}>\s*\{layers\.filter\(\(layer: any\) => !layer\.entry\.plate && !layer\.entry\.rides\)/);
});

test("world mode: a cast standing in a world plate rides it inside the camera, with cut entry and exit", async () => {
  const { sceneWindows } = await import("../kit/core/transitions.mjs");
  const dir = path.join(ROOT, "examples/story/world-ride-9x16");
  const story = resolveStory(JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8")));
  assert.equal(ridesPlate(story, story.scenes.find((s) => s.id === "pair")), "street");
  assert.equal(ridesPlate(story, story.scenes.find((s) => s.id === "bench")), "park");
  assert.equal(ridesPlate({ ...story, camera: { mode: "cuts" } }, story.scenes.find((s) => s.id === "pair")), null);
  const windows = rideWorldPlates(story, sceneWindows(story));
  const byId = Object.fromEntries(windows.scenes.map((e) => [e.id, e]));
  // The street's rider is held through the pan into the park, like its plate.
  assert.equal(byId.pair.rides, "street");
  assert.equal(byId.pair.renderEnd, byId.street.renderEnd);
  assert.ok(byId.street.renderEnd > 3.2);
  const model = resolveModule(story.scenes.find((s) => s.id === "pair"), story, { end: byId.pair.renderEnd });
  assert.deepEqual([model.content.entry, model.content.exit], [{ type: "cut" }, { type: "cut" }]);
  // HyperFrames: riders sit inside the camera at their plate's placement, with no parallax wrapper.
  const { html } = await compileStoryToHyperFrames(story, { write: false, sourceDir: dir });
  const camera = html.slice(html.indexOf('id="lc-cam-pan"'));
  assert.match(camera, /data-launchclip-scene="pair"/);
  assert.match(camera, /data-launchclip-scene="bench"/);
  assert.doesNotMatch(html, /id="lc-par-pair"/);
  // Remotion: riders render with the plates inside CameraWorld.
  const tsx = await readFile(path.join(ROOT, "kit/remotion/StoryComposition.tsx"), "utf8");
  assert.match(tsx, /layers\.filter\(\(layer: any\) => layer\.entry\.plate \|\| layer\.entry\.rides\)/);
});
