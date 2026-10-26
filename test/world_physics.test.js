// World physics (docs/DIRECTION_GUARDRAILS.md §1): motion classes, sets
// anchored to their plate's camera, same-place cuts, and the physics gate.
import test from "node:test";
import assert from "node:assert/strict";
import { frameState } from "../kit/core/catalog-b-view.mjs";
import { charactersTimeline } from "../kit/core/catalog-characters.mjs";
import { worldTimeline } from "../kit/core/catalog-world.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { MOTION_CLASSES, PROP_MOTION, propMotion } from "../kit/core/physics.mjs";
import { samePlaceCuts, validateStory } from "../kit/core/story.mjs";
import { PROP_IDS, renderWorld } from "../kit/core/worlds/index.mjs";
import { physicsGate } from "../src/direction_guardrails.js";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" } };
const story = (scenes, extra = {}) => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1080, height: 1920, fps: 30, duration: 8 }, cast: { characters: [{ id: "maya" }, { id: "theo" }] }, scenes, ...extra });
const world = (id, start, end, params = {}, extra = {}) => ({ id, module: "world", start, end, params: { kind: "park", camera: { move: "pan-right", amount: 1 }, ...params }, ...extra });
const bench = (id, start, end, params = {}) => ({ id, module: "cast-scene", track: 1, start, end, params: { set: "park-bench", cast: [{ id: "maya" }], ...params } });

test("every prop and world layer has a motion class", () => {
  for (const id of PROP_IDS) assert.ok(MOTION_CLASSES.includes(PROP_MOTION[id]), id);
  assert.equal(propMotion("bench"), "anchored");
  assert.equal(propMotion("drone"), "mobile");
  assert.equal(propMotion("campfire"), "ambient");
  const drawn = renderWorld({ kind: "park", props: ["bench", "kite"], canvas: { width: 1080, height: 1920 } });
  assert.deepEqual(drawn.props.map((prop) => [prop.id, prop.motion]), [["bench", "anchored"], ["kite", "mobile"]]);
});

test("a set standing in a plate moves with the plate's front layer, frame for frame, and never drifts", () => {
  const s = story([world("w", 0, 8), bench("c", 0, 8)], { ambient: { level: "lively" } });
  const plate = resolveModule(s.scenes[0], s), cast = resolveModule(s.scenes[1], s);
  assert.equal(cast.content.follow.plate, "w");
  assert.equal(cast.layout.drift, false);
  const worldOps = worldTimeline(plate), castOps = charactersTimeline(cast);
  for (const t of [0, 1.3, 4, 6.6, 7.9]) {
    const front = frameState(worldOps, t).get("w-front"), cam = frameState(castOps, t).get("c-cam");
    assert.ok(Math.abs(front.x - cam.x) < 1e-6 && Math.abs(front.scaleX - cam.scaleX) < 1e-6, `t=${t}`);
  }
  assert.ok(Math.abs(frameState(worldOps, 7.9).get("w-front").x) > 20, "the plate does pan");
  assert.equal(physicsGate(s).status, "passed");
});

test("a set over a still plate, or drawing its own room, has no follow", () => {
  const still = story([world("w", 0, 8, { camera: "still" }), bench("c", 0, 8)]);
  assert.equal(resolveModule(still.scenes[1], still).content.follow.move, "still");
  const room = story([world("w", 0, 8), bench("c", 0, 8, { backdrop: "room" })]);
  assert.equal(resolveModule(room.scenes[1], room).content.follow, null);
});

test("a cut between two plates of the same place is a validation error and a physics finding", () => {
  const s = story([world("a", 0, 4), world("b", 4, 8, { camera: { move: "pan-left", amount: 1 } })]);
  assert.deepEqual(samePlaceCuts(s), [{ from: "a", to: "b", place: "park at day" }]);
  assert.match(validateStory(s).errors.join("\n"), /same place \(park at day\).*one world scene/);
  assert.equal(physicsGate(s).findings[0].rule, "same-place-cut");
  // A different time, different props or a camera transition is a new shot.
  assert.deepEqual(samePlaceCuts(story([world("a", 0, 4), world("b", 4, 8, { time: "dusk" })])), []);
  assert.deepEqual(samePlaceCuts(story([world("a", 0, 4), world("b", 4, 8, {}, { in: { type: "whip-pan", dur: 0.5, direction: "left" } })])), []);
});

test("the physics gate fails a set that pops in mid-plate or fades over a plate already there", () => {
  const pops = physicsGate(story([world("w", 0, 8), bench("c", 2, 8)]));
  assert.equal(pops.status, "failed");
  assert.ok(pops.findings.some((finding) => finding.rule === "set-pops"));
  const fades = physicsGate(story([world("a", 0, 2, { kind: "city-street" }), world("w", 2, 8), bench("c", 2, 8, { enter: "fade" })]));
  assert.ok(fades.findings.some((finding) => finding.rule === "set-fades"), JSON.stringify(fades.findings));
});

test("in world-camera mode a riding cast still follows its plate through a pan between places", () => {
  const s = story([
    world("street", 0, 4, { kind: "city-street", camera: "drift" }), bench("c1", 0, 4),
    world("park", 4, 8, {}, { in: { type: "pan", dur: 0.8, direction: "left" } }), bench("c2", 4, 8, { cast: [{ id: "theo" }] })
  ], { camera: { mode: "world" } });
  const result = physicsGate(s);
  assert.equal(result.status, "passed", JSON.stringify(result.findings));
});
