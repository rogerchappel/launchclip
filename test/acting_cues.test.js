// Acting cues (docs/DIRECTION_GUARDRAILS.md §2): actions, targets, facing,
// gaze, stand-up and walk-to on cast-scene and character-cameo.
import test from "node:test";
import assert from "node:assert/strict";
import { frameState } from "../kit/core/catalog-b-view.mjs";
import { charactersTimeline, charactersView } from "../kit/core/catalog-characters.mjs";
import { ACTIONS, gazeOffset, targetError, walkDuration } from "../kit/core/characters/actions.mjs";
import { POSES } from "../kit/core/characters/rig.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { worldFocus } from "../kit/core/worlds/index.mjs";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" } };
const story = (scenes) => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1080, height: 1920, fps: 30, duration: 8 }, cast: { characters: [{ id: "maya" }, { id: "theo" }] }, scenes });
const plate = (params = {}) => ({ id: "w", module: "world", start: 0, end: 8, params: { kind: "city-street", camera: "still", ...params } });
const bench = (cast, set = "park-bench") => ({ id: "c", module: "cast-scene", track: 1, start: 0, end: 8, params: { set, cast } });
const resolve = (scenes) => { const s = story(scenes); return resolveModule(scenes.at(-1), s); };
const ids = (node, out = []) => { if (node?.id) out.push(node.id); for (const child of node?.children ?? []) ids(child, out); return out; };

test("the acting vocabulary: actions, look and stretch poses, target shapes", () => {
  assert.deepEqual(ACTIONS, ["look-far", "turn-to-look", "gaze-at", "point-at", "walk-to", "stand-up", "stretch"]);
  assert.ok(POSES.includes("look") && POSES.includes("stretch"));
  for (const ok of ["far", "street", "left", { prop: "bench" }, { character: "maya" }, { x: 10, y: 20 }]) assert.equal(targetError(ok), null, JSON.stringify(ok));
  for (const bad of ["moon", { prop: 3 }, { x: "a" }, 7]) assert.ok(targetError(bad), JSON.stringify(bad));
  assert.ok(worldFocus("home-desk", { canvas: { width: 1080, height: 1920 } }).window, "an inside world has a window to look at");
});

test("a character with a target faces it and turns its face to it, not the camera", () => {
  const model = resolve([plate(), bench([{ id: "maya", target: "right" }, { id: "theo", target: { character: "maya" } }])]);
  const [maya, theo] = model.content.actors;
  assert.equal(maya.facing, "right");
  assert.ok(maya.states[0].gaze.x > 0);
  assert.equal(theo.states[0].facing, "left", "theo, on the right, faces maya");
  assert.ok(theo.states[0].gaze.x < 0);
  assert.ok(ids(charactersView(model).front).includes("c-c0-gaze"), "the face is drawn on a gaze joint");
  // Without a target nothing changes: no gaze joint, the slot's facing.
  const plain = resolve([plate(), bench([{ id: "maya" }])]);
  assert.equal(plain.content.actors[0].gaze, false);
  assert.ok(!ids(charactersView(plain).front).includes("c-c0-gaze"));
});

test("look-far shades the eyes and looks at the world's far point; the face turns on the cue", () => {
  const model = resolve([plate({ kind: "home-desk" }), bench([{ id: "maya", cues: [{ at: 2, action: "look-far" }] }], "desk-laptop")]);
  const actor = model.content.actors[0];
  assert.equal(actor.states[1].pose, "look");
  assert.equal(actor.states[1].target, "far");
  assert.ok(actor.states[1].gaze.y < 0, "a far look lifts the face");
  const ops = charactersTimeline(model);
  assert.deepEqual(frameState(ops, 1).get("c-c0-gaze"), { x: 0, y: 0, scaleX: 1 });
  // Seated, a far look turns three-quarters: the face swings and narrows.
  assert.equal(actor.states[1].view, "three-quarter");
  const { x, y, scale } = actor.states[1].gaze;
  assert.deepEqual(frameState(ops, 3).get("c-c0-gaze"), { x, y, scaleX: scale });
});

test("stand-up then walk-to: the character rises, walks at a walking pace and stands", () => {
  const model = resolve([plate({ props: ["lamp-post"] }), bench([{ id: "maya", cues: [{ at: 1, action: "stand-up" }, { at: 2, action: "walk-to", target: { prop: "lamp-post" } }] }])]);
  const actor = model.content.actors[0];
  const walk = actor.states.find((state) => state.walk);
  assert.ok(walk && walk.walk.to < 0, "walks left to the lamp post");
  assert.equal(walk.walk.duration, walkDuration(walk.walk.to, actor.scale));
  const arrived = actor.states.at(-1);
  assert.equal(arrived.pose, "stand");
  assert.ok(arrived.standing && arrived.arrive);
  const ops = charactersTimeline(model);
  assert.equal(frameState(ops, 1.9).get("c-c0-walk").x, 0);
  assert.ok(Math.abs(frameState(ops, 7).get("c-c0-walk").x - walk.walk.to) < 1e-6);
  assert.ok(ids(charactersView(model).front).includes("c-c0-walk"));
  assert.ok(actor.reach.left < actor.x + walk.walk.to, "the reach covers where the walk ends");
});

test("acting cues are validated with errors that name the fix", () => {
  const fails = (cast, pattern, set) => assert.throws(() => resolve([plate(), bench(cast, set)]), pattern);
  fails([{ id: "maya", cues: [{ at: 1, action: "point-at" }] }], /target is required for point-at/);
  fails([{ id: "maya", cues: [{ at: 1, action: "walk-to", target: "left" }] }], /needs the character standing: add a stand-up cue/);
  fails([{ id: "maya", cues: [{ at: 1, action: "stand-up" }] }], /stand-up needs a seated set/, "podium");
  fails([{ id: "maya", cues: [{ at: 1, action: "gaze-at", target: { prop: "rocket" } }] }], /target prop "rocket" is not in the world beneath/);
  fails([{ id: "maya", cues: [{ at: 1, action: "dance" }] }], /action must be one of/);
});

test("gaze offsets: toward the target's side, lifted for far points", () => {
  const actor = { x: 300, floor: 1500, height: 1000, scale: 0.5 };
  const canvas = { width: 1080, height: 1920 };
  assert.ok(gazeOffset({ x: 900, y: 1200, far: false }, actor, canvas).x > 0);
  assert.ok(gazeOffset({ x: 0, y: null, far: false }, actor, canvas).x < 0);
  const far = gazeOffset({ x: null, y: 600, far: true }, actor, canvas);
  assert.ok(far.x > 0 && far.y < 0, "a character left of centre looks out to the right and up");
});

test("the acting gate: a line's key action is performed by its character on that line", async () => {
  const { actingGate } = await import("../src/direction_guardrails.js");
  const words = ["Look", "across", "the", "street", "now"].map((text, i) => ({ text, start: 1 + i * 0.4, end: 1.3 + i * 0.4 }));
  const map = (action) => ({ schema: "launchclip.direction-map.v1", sections: [{ id: "s", beat: "resolution", lines: [{ words: [0, 4], intent: "claim", treatment: "insert", scenes: ["c"], cast: [{ id: "maya" }], action }] }] });
  const acted = story([plate(), bench([{ id: "maya", cues: [{ at: 1.5, action: "look-far", target: "street" }] }])]);
  assert.equal(actingGate(acted, { map: map({ verb: "look-far", who: "maya" }), words }).status, "passed");
  // Sitting and smiling at the camera does not look across the street.
  const idle = story([plate(), bench([{ id: "maya", expression: "happy" }])]);
  const failed = actingGate(idle, { map: map({ verb: "look-far", who: "maya", target: "street" }), words });
  assert.equal(failed.status, "failed");
  assert.match(failed.findings[0].detail, /names maya look-far, but cast scenes c on it performs it.*action: "look-far", target: "street"/);
  // Too late: an action after the line (past the slack) does not count.
  const late = story([plate(), bench([{ id: "maya", cues: [{ at: 4.5, action: "look-far" }] }])]);
  assert.equal(actingGate(late, { map: map({ verb: "look-far", who: "maya" }), words }).status, "failed");
  // An explicit facing away from the target fails.
  const away = story([plate(), bench([{ id: "maya", facing: "left", target: "right", cues: [{ at: 1.5, action: "gaze-at", target: "right", facing: "left" }] }])]);
  assert.ok(actingGate(away, { map: map({ verb: "gaze-at", who: "maya" }), words }).findings.some((finding) => finding.rule === "faces-away"));
  assert.equal(actingGate(acted, {}).status, "skipped");
});

test("standing, a far look turns the character's back to the camera; the back of the head replaces the face", () => {
  const model = resolve([plate(), bench([{ id: "maya", cues: [{ at: 1, action: "look-far", target: "street" }, { at: 4, action: "gaze-at", target: "left" }] }], "standing")]);
  const actor = model.content.actors[0];
  assert.deepEqual(actor.states.map((state) => state.view), ["front", "back", "three-quarter"]);
  assert.equal(actor.turns, true);
  assert.ok(ids(charactersView(model).front).includes("c-c0-back") && ids(charactersView(model).front).includes("c-c0-front"));
  const ops = charactersTimeline(model);
  assert.equal(frameState(ops, 0.5).get("c-c0-back").opacity, 0);
  assert.equal(frameState(ops, 2).get("c-c0-back").opacity, 1);
  assert.equal(frameState(ops, 2).get("c-c0-front").opacity, 0);
  assert.equal(frameState(ops, 5).get("c-c0-back").opacity, 0, "turning back to a side look shows the face again");
  // The standing set has no furniture in a world, and nothing in hand.
  assert.deepEqual(model.content.front, []);
  assert.equal(actor.holds, null);
  // A cue may name the view.
  const named = resolve([plate(), bench([{ id: "maya", cues: [{ at: 1, action: "look-far", view: "three-quarter" }] }], "standing")]);
  assert.equal(named.content.actors[0].states[1].view, "three-quarter");
});

test("the acting gate fails a look that faces the camera, and a card over what a character looks at", async () => {
  const { actingGate } = await import("../src/direction_guardrails.js");
  const words = ["Look", "across", "the", "street", "now"].map((text, i) => ({ text, start: 1 + i * 0.4, end: 1.3 + i * 0.4 }));
  const map = (action) => ({ schema: "launchclip.direction-map.v1", sections: [{ id: "s", beat: "resolution", lines: [{ words: [0, 4], intent: "claim", treatment: "insert", scenes: ["c"], cast: [{ id: "maya" }], action }] }] });
  const front = story([plate(), bench([{ id: "maya", cues: [{ at: 1.5, action: "look-far", view: "front" }] }], "standing")]);
  assert.ok(actingGate(front, { map: map({ verb: "look-far", who: "maya" }), words }).findings.some((finding) => finding.rule === "look-unread"));
  const s = story([plate(), bench([{ id: "maya", cues: [{ at: 1.5, action: "look-far", target: "street" }] }], "standing")]);
  const actor = resolveModule(s.scenes[1], s).content.actors[0];
  const point = actor.states[1].point;
  const card = (y) => ({ id: "card", role: "text", rect: { x: 80, y, width: 860, height: 300 }, start: 0, end: 8 });
  const hidden = actingGate(s, { map: map({ verb: "look-far", who: "maya" }), words, rects: [card(point.y - 100)] });
  assert.ok(hidden.findings.some((finding) => finding.rule === "look-target-hidden"), JSON.stringify(hidden.findings));
  assert.equal(actingGate(s, { map: map({ verb: "look-far", who: "maya" }), words, rects: [card(point.y - 600)] }).status, "passed");
});

test("look-target-hidden stops at the look's own scene: a card over the next place does not count", async () => {
  const { actingGate } = await import("../src/direction_guardrails.js");
  const s = story([plate({ kind: "home-desk" }), bench([{ id: "maya", cues: [{ at: 1, action: "stand-up" }, { at: 1.5, action: "look-far", target: "window" }] }], "desk-laptop")]);
  s.scenes[1].end = 4; s.scenes[0].end = 4;
  const map = { schema: "launchclip.direction-map.v1", sections: [{ id: "s", lines: [] }] };
  const later = { id: "card", role: "text", rect: { x: 80, y: 290, width: 860, height: 600 }, start: 4.2, end: 8 };
  assert.equal(actingGate(s, { map, words: [], rects: [later] }).findings.filter((finding) => finding.rule === "look-target-hidden").length, 0);
});
