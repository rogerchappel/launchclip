// Camera landings in a cast scene (kit/core/zooms.mjs LAND,
// kit/core/characters/landing.mjs, docs/KIT_CONTRACTS.md "Zooms inside a
// shot"): the subject lands exactly on its screen anchor, the travel starts
// where the camera is, eases slow → fast → slow with no overshoot, blurs
// only near its peak, holds, and a landing that would break the frame's
// rules fails the scene. Both compilers play the same keys.
import assert from "node:assert/strict";
import test from "node:test";
import { blurAt, cameraOps, cameraPlan, cameraStateAt, opsStateAt, sceneObjectLookup, screenPoint, worldPoint } from "@launchclip/core/camera-world.mjs";
import { frameGuides } from "@launchclip/core/characters/framing.mjs";
import { getEase } from "@launchclip/core/motion.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { STORY_LAND, resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { sceneWindows } from "@launchclip/core/transitions.mjs";
import { LAND, landingMinScale, landingScreen, landingState, shotZooms, zoomOps, zoomStateAt } from "@launchclip/core/zooms.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const W = 1080, H = 1920, FPS = 30;
const SIZE = { width: W, height: H };
const ZOOMS = () => [
  { at: 1, land: "maya", move: "reveal", purpose: "find Maya before she speaks" },
  { at: 4.5, land: "sam", shot: "close", move: "push", purpose: "land on Sam's reaction to the news" },
  { at: 8, land: "maya", shot: "medium", screen: "left-third", move: "cut", purpose: "cut back to Maya for the answer" }
];
const landingStory = ({ mode = "world", zooms = ZOOMS(), mutate = (story) => story } = {}) => mutate({
  schema: "launchclip.story.v1", lane: "motion",
  format: { width: W, height: H, fps: FPS, duration: 10 },
  brand: { colors: { bg: "#14122b", primary: "#6d5dfc", accent: "#ffb547", ink: "#14122b", paper: "#f6f3ee" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
  camera: { mode },
  cast: { style: "flat", characters: [{ id: "maya", position: "left" }, { id: "sam", position: "right" }] },
  scenes: [{ id: "talk", module: "cast-scene", start: 0, end: 10,
    params: { set: "standing", shot: "wide", cast: [{ id: "maya", pose: "stand" }, { id: "sam", pose: "stand", cues: [{ at: 5, pose: "facepalm", expression: "frustrated" }] }] },
    zooms }]
});
const resolved = (options) => resolveStory(landingStory(options));
const solved = (story) => {
  const model = resolveModule(story.scenes[0], story);
  return { model, ...shotZooms(story, sceneWindows(story).scenes[0], model.zoomRects) };
};
const errorsOf = (options) => validateStory(landingStory(options)).errors.join("\n");
const failure = (zooms) => { try { resolveModule(resolved({ zooms }).scenes[0], resolved({ zooms })); return ""; } catch (error) { return error.message; } };

test("landing math: the solved state puts the subject on the anchor; the least scale keeps the view inside the plate", () => {
  const point = { x: 300, y: 700 }, target = landingScreen("right-third", SIZE);
  assert.deepEqual(target, { x: W * 2 / 3, y: H * 0.4 });
  const least = landingMinScale(point, target, SIZE);
  // The subject sits 300 px from the left edge; the anchor 720 px: the view must be 2.4× closer.
  assert.ok(Math.abs(least - 720 / 300) < 1e-5);
  for (const s of [least, 2.7]) {
    const state = landingState(point, target, s, SIZE);
    assert.ok(Math.abs(W / 2 + s * (point.x - state.x) - target.x) < 1e-3 && Math.abs(H / 2 + s * (point.y - state.y) - target.y) < 1e-3);
    assert.ok(state.x - W / (2 * s) >= -1e-6 && state.x + W / (2 * s) <= W + 1e-6 && state.y - H / (2 * s) >= -1e-6 && state.y + H / (2 * s) <= H + 1e-6, `view inside the plate at ${s}`);
  }
  assert.equal(landingMinScale({ x: W / 2, y: H * 0.4 }, landingScreen("center", SIZE), SIZE), 1, "the centre lands at rest");
  assert.deepEqual([STORY_LAND.moves, STORY_LAND.dur, STORY_LAND.hold, STORY_LAND.scale, STORY_LAND.screens], [LAND.moves, LAND.dur, LAND.hold, LAND.scale, Object.keys(LAND.screen)], "story.mjs mirrors LAND");
});

test("validation: a landing needs a move and a purpose, lands only in a cast scene, and holds after it travels", () => {
  assert.equal(errorsOf(), "");
  const bad = (change) => errorsOf({ mutate: (story) => { change(story.scenes[0].zooms, story); return story; } });
  assert.match(bad((z) => { delete z[0].purpose; }), /zooms\[0\]\.purpose is required: why the camera moves/);
  assert.match(bad((z) => { z[0].purpose = "reveal"; }), /purpose is required/);
  assert.match(bad((z) => { z[0].move = "dolly"; }), /move must be one of reveal, push, cut/);
  assert.match(bad((z) => { z[0].screen = "top"; }), /screen must be one of center, left-third, right-third or \[x, y\]/);
  assert.match(bad((z) => { z[0].screen = [0.5, 1.2]; }), /screen must be one of/);
  assert.match(bad((z) => { z[1].scale = 2; }), /takes a shot or a scale, not both/);
  assert.match(bad((z) => { z[2].dur = 1; }), /a cut takes no time/);
  assert.match(bad((z) => { z[0].dur = 5; }), /dur must be 0\.4–3 s/);
  assert.match(bad((z) => { z[0].box = { x: 0, y: 0, width: 100, height: 100 }; }), /lands on its subject; drop box/);
  assert.match(bad((z) => { z[1].at = 2.6; }), /zooms\[0\] holds 0\.2 s; a landing holds at least 0\.6 s after its 1\.4 s move/);
  assert.match(bad((z) => { z[2].at = 9.7; }), /zooms\[2\] holds 0\.3 s; a landing holds at least 0\.6 s/);
  assert.match(bad((z, story) => { story.scenes[0].module = "hook-title"; story.scenes[0].params = { headline: "x" }; }), /land is for cast-scene shots/);
});

test("a landing that would break the frame fails the scene, saying what to change", () => {
  assert.match(failure([{ at: 1, land: "nobody", move: "reveal", purpose: "find someone who is not here" }]), /names nothing in this scene: "nobody" \(it can land on: maya, sam/);
  assert.match(failure([{ at: 1, land: "sam", shot: "close", screen: [0.5, 0.06], move: "push", purpose: "a face pushed off the top" }]), /crown at y .* above the safe zone/);
  assert.match(failure([{ at: 1, land: "sam", shot: "close", screen: [0.5, 0.9], move: "push", purpose: "a face pushed into the captions" }]), /chin at y .* inside the caption band/);
  assert.match(failure([{ at: 1, land: "sam", scale: 1, screen: "left-third", move: "reveal", purpose: "sam across the frame at rest" }]), /the view would leave the plate .* at least/);
  assert.match(failure([{ at: 1, land: "sam", screen: [0.05, 0.4], move: "reveal", purpose: "sam at the far edge" }]), /past the most \(3\)|past the safe zone's sides/);
});

test("the subject lands exactly on its anchor and holds; the travel starts where the camera is, eases slow-fast-slow and never overshoots", () => {
  for (const mode of ["world", "cuts"]) {
    const story = resolved({ mode });
    const { model, keys, zooms, warnings } = solved(story);
    assert.deepEqual(warnings, []);
    assert.equal(zooms.length, 3);
    const ease = getEase;
    const at = (t) => zoomStateAt(keys, t, ease, SIZE);
    const screenOf = (point, state) => ({ x: W / 2 + state.s * (point.x - state.x), y: H / 2 + state.s * (point.y - state.y) });
    for (const [z, zoom] of ZOOMS().entries()) {
      const { point } = model.zoomRects[z];
      const target = landingScreen(zoom.screen, SIZE);
      const done = zoom.at + (zoom.move === "cut" ? LAND.cut : zoom.dur ?? LAND.dur[zoom.move]);
      const hold = z < 2 ? ZOOMS()[z + 1].at - 1e-3 : 9.99;
      for (const t of [done, (done + hold) / 2, hold]) {
        const landed = screenOf(point, at(t));
        assert.ok(Math.abs(landed.x - target.x) < 0.05 && Math.abs(landed.y - target.y) < 0.05, `${mode} ${zoom.land} on ${zoom.screen ?? "center"} at ${t}: ${JSON.stringify(landed)}`);
      }
      // No jump at the start: the frame before and the first frame of the move are where the camera was.
      const before = at(zoom.at - 1e-3), start = at(zoom.at);
      assert.ok(Math.abs(before.x - start.x) < 1e-3 && Math.abs(before.s - start.s) < 1e-6, `${mode} ${z} starts where the camera is`);
    }
    // The travelling moves: zero speed at both ends, fastest in the middle, never past the landing.
    for (const key of keys.filter((item) => item.move === "reveal" || item.move === "push")) {
      const p = (t) => (at(t).x - key.from.x) / (key.to.x - key.from.x);
      const step = key.duration / 200;
      const speed = (t) => Math.abs(p(t + step) - p(t)) / step;
      const startSpeed = speed(key.start), peak = speed(key.start + key.duration / 2 - step / 2), endSpeed = speed(key.start + key.duration - step);
      assert.ok(startSpeed < peak * 0.02 && endSpeed < peak * 0.02, `${key.move}: slow at the ends (${startSpeed.toFixed(4)}, ${endSpeed.toFixed(4)}) vs peak ${peak.toFixed(3)}`);
      let last = -Infinity;
      for (let i = 0; i <= 200; i += 1) {
        const t = key.start + (key.duration * i) / 200, v = p(t);
        assert.ok(v >= last - 1e-9 && v >= -1e-9 && v <= 1 + 1e-9, `${key.move}: monotonic, no overshoot at ${t}`);
        last = v;
        const s = at(t).s;
        assert.ok(s >= Math.min(key.from.s, key.to.s) - 1e-9 && s <= Math.max(key.from.s, key.to.s) + 1e-9, `${key.move}: scale inside its range at ${t}`);
      }
      assert.ok(key.purpose.length >= STORY_LAND.purpose, "the purpose rides on the key");
    }
    // The reveal travels across (lateral), the push comes closer, the cut takes no time.
    const [reveal, push, cut] = keys;
    assert.ok(Math.abs(reveal.to.x - reveal.from.x) > 100);
    assert.ok(push.to.s > push.from.s);
    assert.equal(cut.duration, LAND.cut);
    assert.equal(cut.blur, 0);
    // World mode: back at rest as the shot ends; cuts mode holds inside its own layer.
    assert.equal(keys.length, mode === "world" ? 4 : 3);
  }
});

test("world camera: the landing is a camera move that blurs only near its peak, played the same by the ops both compilers read", () => {
  const story = resolved();
  const plan = cameraPlan(story, { windows: sceneWindows(story), objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value)) });
  assert.equal(plan.drift, null, "a story with landings takes no drift");
  const moves = plan.moves.filter((move) => move.purpose);
  assert.deepEqual(moves.map((move) => move.move), ["reveal", "push", "cut"]);
  // The subject's face lands on screen through the whole camera (placement and all).
  const { model } = solved(story);
  const face = worldPoint(plan.placements.talk, model.zoomRects[1].point);
  const landed = screenPoint(plan, face, 6);
  const target = landingScreen("center", SIZE);
  assert.ok(Math.abs(landed.x - target.x) < 0.1 && Math.abs(landed.y - target.y) < 0.1, JSON.stringify(landed));
  // Blur: none at the slow ends of the travel, some at its peak, none on the cut or while holding.
  const reveal = moves[0];
  const blur = (t) => { const b = blurAt(plan, t); return Math.hypot(b.x, b.y); };
  assert.equal(blur(reveal.start + 1 / FPS), 0);
  assert.equal(blur(reveal.start + reveal.duration - 1 / FPS), 0);
  assert.ok(blur(reveal.start + reveal.duration / 2) > 0, "blurred at peak speed");
  for (const t of [3.5, 7, 8 + 1 / FPS, 9]) assert.equal(blur(t), 0, `still at ${t}`);
  // The ops both compilers play match the frame-pure state.
  const ops = cameraOps(plan);
  for (let f = 0; f < 10 * FPS; f += 7) {
    const t = f / FPS, state = cameraStateAt(plan, t);
    assert.ok(Math.abs(opsStateAt(ops, "zoom", t).scale - state.zoom) < 1e-4, `zoom at ${t}`);
    assert.ok(Math.abs(opsStateAt(ops, "pan", t).x - (W / 2 - state.x)) < 1e-2, `pan at ${t}`);
  }
});

test("cuts mode: the scene's own wrappers play the landing keys, and both compilers build it", async () => {
  const story = resolved({ mode: "cuts" });
  const { keys } = solved(story);
  const ops = zoomOps(keys, SIZE);
  for (let f = 0; f < 10 * FPS; f += 5) {
    const t = f / FPS, state = zoomStateAt(keys, t, getEase, SIZE);
    assert.ok(Math.abs(opsStateAt(ops, "zoom", t).scale - state.s) < 1e-4, `zoom at ${t}`);
    assert.ok(Math.abs(opsStateAt(ops, "pan", t).x - (W / 2 - state.x)) < 1e-2, `pan at ${t}`);
  }
  const cuts = await compileStoryToHyperFrames(resolved({ mode: "cuts" }), { write: false });
  assert.deepEqual(cuts.warnings.filter((warning) => /zoom/.test(warning)), []);
  assert.match(cuts.html, /<div id="lc-zs-talk" class="lc-zoom">/);
  assert.match(cuts.html, /tl\.fromTo\("#lc-zp-talk", \{"x":0,"y":0[^}]*\}, \{"x":216,"y":[\d.]+,"duration":1\.4,"ease":"power3\.inOut"/);
  const world = await compileStoryToHyperFrames(resolved(), { write: false });
  assert.doesNotMatch(world.html, /lc-zoom/);
  assert.match(world.html, /"duration":1\.4,"ease":"power3\.inOut"/);
});

test("a landing in a scene with cue shots is refused (both would reframe it)", () => {
  const zooms = [{ at: 1, land: "maya", move: "reveal", purpose: "find Maya before she speaks" }];
  const story = resolveStory(landingStory({ zooms, mutate: (s) => { s.scenes[0].params.cast[1].cues.push({ at: 7, shot: "close" }); return s; } }));
  assert.throws(() => resolveModule(story.scenes[0], story), /cannot share a scene with cue shots/);
});

test("guides: the landed faces sit inside the safe zone and above the caption band", () => {
  const story = resolved();
  const { model, keys } = solved(story);
  const { safe, band } = frameGuides(SIZE);
  for (const [z, key] of keys.slice(0, 3).entries()) {
    const rect = model.zoomRects[z].rect, s = key.to.s;
    const top = H / 2 + s * (rect.y - key.to.y), chin = H / 2 + s * (rect.y + rect.height - key.to.y);
    assert.ok(top >= safe.y - 0.5 && chin <= band.y + 0.5, `zooms[${z}]: crown ${top}, chin ${chin}`);
  }
});
