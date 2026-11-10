// A character story's default camera (kit/core/character-camera.mjs): every
// cast scene moves for as long as it is up, with nothing added by the planner.
import assert from "node:assert/strict";
import test from "node:test";
import { cameraOps, cameraPlan, cameraStateAt, captionDipWindows, opsStateAt, sceneObjectLookup } from "@launchclip/core/camera-world.mjs";
import { CHARACTER_CAMERA, characterKeys, characterMove } from "@launchclip/core/character-camera.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { getEase } from "@launchclip/core/motion.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { sceneWindows } from "@launchclip/core/transitions.mjs";
import { shotZooms, zoomOps, zoomStateAt } from "@launchclip/core/zooms.mjs";
import { characterStory, characterWords } from "./helpers/character_story.js";

const resolved = (edit = (story) => story) => resolveStory(edit(characterStory()), { words: characterWords() });
const scene = (story, id) => story.scenes.find((item) => item.id === id);
const size = { width: 1080, height: 1920 };
const FPS = 30;
const withScene = (id, change) => (story) => ({ ...story, scenes: story.scenes.map((item) => (item.id === id ? change(item) : item)) });

test("each cast scene gets the move its shot calls for: a push on a speaker, a drift on a wide shot, a punch-in on a reaction", () => {
  const story = resolved();
  assert.deepEqual(story.scenes.map((item) => characterMove(story, item)), ["wide", "speaker", "wide", "speaker"]);
  // The same framing with nobody speaking is a reaction.
  const quiet = resolved(withScene("mare-reassures", (item) => ({ ...item, params: { ...item.params, cast: item.params.cast.map(({ says, ...actor }) => actor) } })));
  assert.equal(characterMove(quiet, scene(quiet, "mare-reassures")), "reaction");
  const punch = characterKeys(quiet, scene(quiet, "mare-reassures"));
  assert.equal(punch[0].duration <= CHARACTER_CAMERA.punch.seconds + 1e-9, true);
  assert.equal(punch[0].to.s, CHARACTER_CAMERA.punch.scale);
  assert.match(punch[0].ease, /inOut/, "the punch-in eases in and out on the grammar's camera ease");
});

test("the planner adds nothing, and a story can say no: its own zooms, camera.moves false, no bible, or a scene not on a cut", () => {
  const story = resolved();
  assert.ok(story.scenes.every((item) => item.zooms === undefined), "the fixture plans no camera");
  assert.ok(story.scenes.every((item) => characterKeys(story, item).length > 0));
  // A scene's own zooms replace the default move.
  const zoomed = resolved(withScene("foal-questions", (item) => ({ ...item, zooms: [{ at: 2.4, box: { x: 300, y: 700, width: 400, height: 400 } }] })));
  assert.equal(characterMove(zoomed, scene(zoomed, "foal-questions")), null);
  assert.ok(shotZooms(zoomed, sceneWindows(zoomed).scenes.find((entry) => entry.id === "foal-questions")).zooms.length === 1);
  // camera.moves: false is valid and turns every default move off.
  const off = { ...characterStory(), camera: { moves: false } };
  assert.deepEqual(validateStory(off).errors, []);
  const still = resolveStory(off, { words: characterWords() });
  assert.ok(still.scenes.every((item) => characterKeys(still, item).length === 0));
  assert.match(validateStory({ ...characterStory(), camera: { moves: "slow" } }).errors.join("\n"), /camera\.moves must be true or false/);
  // A story with no bible renders as before: no keys, no camera plan.
  const plain = resolved((raw) => { const { bible, ...rest } = raw; return rest; });
  assert.ok(plain.scenes.every((item) => characterKeys(plain, item).length === 0));
  assert.equal(cameraPlan(plain, { windows: sceneWindows(plain) }), null);
  // A scene that dissolves in, and the one before it, keep the camera at rest.
  const dissolved = resolved(withScene("foal-steps-back", (item) => ({ ...item, in: { type: "crossfade", dur: 0.4 } })));
  assert.deepEqual(dissolved.scenes.map((item) => characterMove(dissolved, item)), [null, null, null, "speaker"].map((move, index) => (index === 0 ? "wide" : move)));
});

test("a move is slow, fast, slow with no overshoot, one velocity through its joins, and never leaves the plate", () => {
  for (const edit of [(story) => story, withScene("mare-reassures", (item) => ({ ...item, params: { ...item.params, cast: item.params.cast.map(({ says, ...actor }) => actor) } }))]) {
    const story = resolved(edit);
    for (const item of story.scenes) {
      const keys = characterKeys(story, item);
      const move = characterMove(story, item);
      const at = (t) => zoomStateAt(keys, t, getEase, size);
      const frames = [];
      for (let f = Math.round(item.start * FPS); f < Math.round(item.end * FPS); f += 1) frames.push(at(f / FPS));
      // Inside the plate at every frame, never under its rest scale.
      for (const state of frames) {
        const hw = size.width / (2 * state.s), hh = size.height / (2 * state.s);
        assert.ok(state.s >= 1 - 1e-9 && state.x >= hw - 0.5 && state.x <= size.width - hw + 0.5 && state.y >= hh - 0.5 && state.y <= size.height - hh + 0.5, `${item.id}: the view leaves the plate at ${JSON.stringify(state)}`);
      }
      // No overshoot: the scale only grows and the travel keeps one direction.
      const steps = frames.slice(1).map((state, i) => ({ s: state.s - frames[i].s, x: state.x - frames[i].x }));
      assert.ok(steps.every((step) => step.s >= -1e-9), `${item.id}: the scale never comes back`);
      assert.ok(steps.every((step) => step.x >= -1e-6) || steps.every((step) => step.x <= 1e-6), `${item.id}: the drift keeps its direction`);
      // The slow part (after a reaction's punch): slow at both ends, fastest between, and no jump in speed at a join.
      const speed = steps.map((step) => Math.hypot(step.s * size.width, step.x)).slice(move === "reaction" ? Math.ceil(CHARACTER_CAMERA.punch.seconds * FPS) + 1 : 0);
      const peak = Math.max(...speed);
      assert.ok(speed[0] < peak * 0.5 && speed.at(-1) < peak * 0.5, `${item.id}: eases in and out (${speed[0]}, ${peak}, ${speed.at(-1)})`);
      for (let i = 1; i < speed.length; i += 1) assert.ok(Math.abs(speed[i] - speed[i - 1]) <= peak * 0.2, `${item.id}: the speed jumps at frame ${i} (${speed[i - 1]} → ${speed[i]})`);
      // It moves for the whole scene: across the cruise every frame travels.
      assert.ok(speed.filter((value) => value >= peak * 0.6).length >= speed.length * 0.6, `${item.id}: cruises for most of the scene`);
      // Back at rest as the scene ends.
      assert.deepEqual(at(item.end + 1 / FPS), { x: size.width / 2, y: size.height / 2, s: 1 });
    }
  }
});

test("a slow move covers 3 to 6 percent or more across a hold, by its length", () => {
  const story = resolved();
  for (const item of story.scenes) {
    const keys = characterKeys(story, item).slice(0, -1);
    const first = keys[0].from, last = keys.at(-1).to;
    const travel = Math.abs(last.s - first.s) + Math.abs(last.x - first.x) / size.width;
    assert.ok(travel >= 0.03 && travel <= 0.14, `${item.id} (${characterMove(story, item)}, ${item.end - item.start} s) moves ${travel}`);
  }
});

test("both renderers get the same moves: world mode as camera moves that leave the captions alone, cuts mode as the scene's own zoom", () => {
  // World mode: the moves are the camera's, flagged as zooms inside a shot.
  const world = resolved((raw) => ({ ...raw, camera: { mode: "world" } }));
  const windows = sceneWindows(world);
  const plan = cameraPlan(world, { windows, objects: sceneObjectLookup(world, resolveModule) });
  assert.deepEqual([...new Set(plan.moves.map((move) => move.sceneId))], world.scenes.map((item) => item.id));
  assert.ok(plan.moves.every((move) => move.zoom === true && move.type === "zoom"));
  assert.deepEqual(captionDipWindows(plan), [], "the captions never dip for a move inside a shot");
  // Seek-safe: the ops a compiler turns into GSAP give the frame-pure camera at any time, in any order.
  const ops = cameraOps(plan);
  for (const t of [11.2, 0.05, 6.3, 2.0, 1.99, 4.92, 8.5, 3.1, 0.3]) {
    const state = cameraStateAt(plan, t);
    assert.ok(Math.abs(opsStateAt(ops, "zoom", t).scale - state.zoom) < 1e-4, `zoom at ${t}`);
    assert.ok(Math.abs(opsStateAt(ops, "pan", t).x - (plan.width / 2 - state.x)) < 1e-2, `pan at ${t}`);
  }
  // Each shot starts on its own framing: the cut resets the camera.
  assert.equal(cameraStateAt(plan, 2).zoom, 1);
  assert.ok(cameraStateAt(plan, 1.95).zoom > 1.04);
  // Cuts mode: no camera plan; the same keys drive the scene's zoom wrappers.
  const cuts = resolved();
  assert.equal(cameraPlan(cuts, { windows: sceneWindows(cuts) }), null);
  const entry = sceneWindows(cuts).scenes.find((item) => item.id === "foal-questions");
  const keys = shotZooms(cuts, entry).keys;
  assert.deepEqual(keys, characterKeys(cuts, entry.scene));
  const zoom = zoomOps(keys, size);
  for (const t of [2.1, 3.4, 4.9, 2.0]) assert.ok(Math.abs(opsStateAt(zoom, "zoom", t).scale - zoomStateAt(keys, t, getEase, size).s) < 1e-4, `cuts zoom at ${t}`);
  // The world-mode camera and the cuts-mode wrapper agree on the scale at every frame of the shot.
  for (let f = 61; f < 147; f += 1) assert.ok(Math.abs(cameraStateAt(plan, f / FPS).zoom - zoomStateAt(keys, f / FPS, getEase, size).s) < 1e-4, `frame ${f}`);
});
