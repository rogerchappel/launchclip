// Contact acting (kit/core/characters/contact.mjs): push, pull, hit, catch,
// lift, drop, throw and give with cause and effect; hand props with grips
// and one owner at a time; the gag squash layer; contact events.
import test from "node:test";
import assert from "node:assert/strict";
import { frameState } from "@launchclip/core/catalog-b-view.mjs";
import { charactersTimeline, charactersView, contactEvents } from "@launchclip/core/catalog-characters.mjs";
import { armReach, handAt, reachArm, shoulderAt } from "@launchclip/core/characters/aim.mjs";
import { CONTACT_ACTIONS } from "@launchclip/core/characters/actions.mjs";
import { CONTACT, CONTACT_KINDS, STRIKE_LEAN, squashError, squashScales } from "@launchclip/core/characters/contact.mjs";
import { HAND_PROP_NAMES, gripPoints } from "@launchclip/core/characters/props.mjs";
import { sceneCastCues, validateCastCues } from "@launchclip/core/characters/cues.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" } };
const story = (scenes, style = "stick") => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1920, height: 1080, fps: 30, duration: 10 }, cast: { style, characters: [{ id: "maya" }, { id: "theo" }] }, scenes });
const scene = (params) => ({ id: "c", module: "cast-scene", start: 0, end: 10, params: { set: "standing", ...params } });
const resolve = (params, style) => { const s = story([scene(params)], style); return resolveModule(s.scenes[0], s); };
const ids = (node, out = []) => { if (node?.id) out.push(node.id); for (const child of node?.children ?? []) ids(child, out); return out; };
const at = (ops, t, target) => frameState(ops, t).get(target);
const walkTo = (who, t = 0.3) => ({ at: t, action: "walk-to", target: who });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("the contact vocabulary: actions, kinds, props", () => {
  assert.deepEqual(CONTACT_ACTIONS, ["push", "pull", "hit", "catch", "lift", "drop", "throw", "give"]);
  assert.deepEqual(CONTACT_KINDS, ["impact", "grip", "release", "land"]);
  assert.deepEqual(HAND_PROP_NAMES, ["box", "paper-stack", "ball", "cup", "sign", "coin"]);
  assert.deepEqual(Object.keys(gripPoints("box", { cx: 100, cy: 50, s: 1 })), ["L", "R"], "a box takes both hands");
  assert.deepEqual(Object.keys(gripPoints("cup", { cx: 100, cy: 50, s: 1, side: "L" })), ["L"], "a cup takes one");
});

test("two-bone reach: the hand lands on a reachable point, bones never stretch past one that is not", () => {
  const g = { upperArm: 150, foreArm: 134, hand: 27, armX: 70, armY: -250, hipY: -376 };
  const actor = { x: 500, floor: 900, scale: 0.5, geometry: g };
  for (const side of ["L", "R"]) for (const lean of [0, 14, -22]) for (const target of [{ x: 600, y: 700 }, { x: 420, y: 650 }, { x: 380, y: 560 }, { x: 900, y: 500 }]) {
    const S = shoulderAt(actor, side, { lean });
    const a = reachArm({ shoulder: S, side, target, geometry: g, scale: 0.5, lean });
    const hand = handAt(S, side, a.arm, a.fore, g, 0.5, lean);
    const dist = Math.hypot(target.x - S.x, target.y - S.y);
    assert.equal(a.reached, dist <= armReach(g) * 0.5 + 0.5, "reached says whether the arm is long enough");
    if (a.reached) close(Math.hypot(hand.x - target.x, hand.y - target.y), 0, 0.5, `${side} ${lean}: the hand is on the point`);
    assert.ok(Math.hypot(hand.x - S.x, hand.y - S.y) <= armReach(g) * 0.5 + 0.01, "the hand never goes past the arm's length");
  }
});

test("hit: a wind-up, a fast strike landing on at, a follow-through; the target recoils, squashes and looks surprised", () => {
  const model = resolve({ cast: [{ id: "maya", cues: [walkTo({ character: "theo" }), { at: 3, action: "hit", target: { character: "theo" } }] }, { id: "theo" }] });
  const [maya, theo] = model.content.actors;
  const T = CONTACT.hit;
  const phases = maya.states.filter((s) => s.contact);
  assert.deepEqual(phases.map((s) => s.time), [3 - T.strike - T.wind, 3 - T.strike, 3 + T.hold].map((t) => Math.round(t * 1e4) / 1e4));
  assert.equal(phases[1].tween, T.strike, "the strike arrives on at");
  assert.ok(Math.sign(phases[0].body.lean) === -Math.sign(phases[1].body.lean), "the wind-up leans against the strike");
  assert.deepEqual(contactEvents(model), [{ at: 3, actor: "maya", action: "hit", kind: "impact", target: { character: "theo" } }]);
  assert.ok(model.events.some((e) => e.name === "maya-impact-0" && e.time === 3), "the impact is a timeline event");
  // The struck character: its gag layer staggers away and squashes, then settles; its face changes on the contact.
  const ops = charactersTimeline(model);
  const gag = "c-c1-gag";
  assert.ok(ids(charactersView(model).front).includes(gag));
  assert.ok(at(ops, 3.1, gag).x > 0, "theo, on the right, is knocked to the right");
  assert.ok(at(ops, 3.04, gag).scaleX < 1, "a squash on the impact");
  assert.deepEqual([at(ops, 9, gag).x, at(ops, 9, gag).rotation, at(ops, 9, gag).scaleX, at(ops, 9, gag).scaleY], [0, 0, 1, 1], "and back to rest");
  assert.ok(theo.states.some((s) => s.time === 3 && s.expression === "surprised") && theo.expressions.includes("surprised"));
  assert.equal(at(ops, 3.2, "c-c1-face-surprised").opacity, 1);
});

test("a contact out of arm's length is an error that says to move, never a stretched arm", () => {
  assert.throws(() => resolve({ cast: [{ id: "maya", cues: [{ at: 3, action: "push", target: { character: "theo" } }] }, { id: "theo" }] }), /push at 3 s: maya's hand cannot reach theo, even with a step in \(bones never stretch\); walk-to/);
  assert.throws(() => resolve({ cast: [{ id: "maya", cues: [walkTo({ character: "theo" }), { at: 2.6, action: "hit", target: { character: "theo" } }, { at: 2.9, action: "gaze-at", target: "left" }] }, { id: "theo" }] }), /hit at 2.6 s plays from .* cue at 2.9 s falls inside it/);
  // A cue that only changes the face lands inside the chain and keeps the phase's arms.
  const face = resolve({ cast: [{ id: "maya", cues: [walkTo({ character: "theo" }), { at: 2.6, action: "hit", target: { character: "theo" } }, { at: 2.63, expression: "angry" }] }, { id: "theo" }] });
  const angry = face.content.actors[0].states.find((s) => s.expression === "angry");
  assert.ok(angry.time === 2.63 && angry.arms && angry.contact, "the face changes mid-strike, the arm keeps striking");
  assert.throws(() => resolve({ cast: [{ id: "maya", holds: "ball", cues: [{ at: 0.1, action: "throw" }] }, { id: "theo" }] }), /throw at 0.1 s winds up from .*before the scene starts/);
});

test("give: the giver alone, then both hands on the prop, then the receiver alone", () => {
  const model = resolve({ cast: [{ id: "maya", holds: "box", cues: [walkTo({ character: "theo" }, 0.5), { at: 3, action: "give", target: { character: "theo" } }] }, { id: "theo" }] });
  const T = CONTACT.give;
  assert.deepEqual(contactEvents(model).map((e) => [e.at, e.actor, e.kind]), [[3, "theo", "grip"], [3 + T.shared, "maya", "release"]]);
  const ops = charactersTimeline(model);
  const box = (t) => at(ops, t, "c-obj-box");
  const [maya, theo] = model.content.actors;
  // Before: carried by maya (her hands on it in every state, walking too); the box goes where she does.
  assert.ok(maya.states.filter((s) => s.time < 2).every((s) => s.arms), "maya's hands are on the box while she carries it");
  assert.ok(box(1.5).x > box(0).x + 50, "the box travels with her walk");
  // Shared: both actors' hands are on the box, which holds still between them.
  close(box(3).x, box(3 + T.shared).x, 0.01, "the box is still while both hold it");
  assert.ok(box(3).x > maya.x && box(3).x < theo.x, "between them");
  const holding = (actor, t) => actor.states.filter((s) => s.time <= t).at(-1).arms;
  assert.ok(holding(maya, 3.1) && holding(theo, 3.1), "both hold it");
  // After: theo alone carries it; maya's arms are her own again.
  assert.ok(!holding(maya, 5) && holding(theo, 5));
  close(box(5).x, theo.x + (theo.states.at(-1).facing === "left" ? -30 : 30) * theo.scale, 1, "the box sits in theo's carry");
});

test("lift and drop: bend to it, grip on at, carry; let go, it falls, lands, squashes and its sheets spring back", () => {
  const model = resolve({ objects: [{ id: "stack", prop: "paper-stack", at: 0.5 }], cast: [{ id: "maya", cues: [walkTo({ prop: "stack" }), { at: 3, action: "lift", target: { prop: "stack" } }, { at: 5, action: "drop" }] }, { id: "theo" }] });
  const events = contactEvents(model);
  assert.deepEqual(events.map((e) => [e.actor, e.action, e.kind]), [["maya", "lift", "grip"], ["maya", "drop", "release"], ["maya", "drop", "land"]]);
  const maya = model.content.actors[0];
  const bent = maya.states.find((s) => s.contact && s.time < 3);
  assert.ok(Math.abs(bent.body.lean) >= 20, "she bends over to reach the floor");
  const ops = charactersTimeline(model);
  const stack = (t) => at(ops, t, "c-obj-stack");
  const floorY = stack(0).y;
  assert.ok(stack(4).y < floorY - 50, "carried up off the floor");
  const land = events[2].at;
  close(stack(land).y, floorY, 0.5, "it lands back on the floor");
  assert.ok(at(ops, land + 0.05, "c-obj-stack-sq").scaleY < 1, "and squashes as it lands");
  assert.ok(at(ops, land + 0.1, "c-obj-stack-l4").y < 0, "the top sheet lifts and lags");
  assert.deepEqual(at(ops, 9.5, "c-obj-stack-l4"), { x: 0, y: 0 }, "then settles");
});

test("push and pull a prop on the floor: it slides away, then comes back toward the puller", () => {
  const model = resolve({ objects: [{ id: "crate", prop: "box", at: 0.5 }], cast: [{ id: "maya", cues: [walkTo({ prop: "crate" }), { at: 3, action: "push", target: { prop: "crate" } }, { at: 5, action: "pull", target: { prop: "crate" } }] }, { id: "theo" }] });
  const ops = charactersTimeline(model);
  const x = (t) => at(ops, t, "c-obj-crate").x;
  assert.ok(x(3.6) > x(2.9) + 20, "the push slides it away (maya faces right)");
  assert.ok(x(6) < x(4.5) - 10, "the pull hauls it back");
  assert.ok(at(ops, 3.03, "c-obj-crate-sq").scaleX < 1, "it squashes on the impact");
  assert.deepEqual(contactEvents(model).map((e) => e.kind), ["impact", "grip", "release"]);
});

test("throw to a character is a pass caught on time; a catch cue times the throw to land on it", () => {
  const pass = resolve({ cast: [{ id: "maya", holds: "ball", cues: [{ at: 2, action: "throw", target: { character: "theo" } }] }, { id: "theo", cues: [{ at: 5, action: "throw", target: "left" }] }] });
  assert.deepEqual(contactEvents(pass).map((e) => [e.actor, e.action, e.kind]), [["maya", "throw", "release"], ["theo", "catch", "grip"], ["theo", "throw", "release"], ["theo", "throw", "land"]]);
  const ops = charactersTimeline(pass);
  const grip = contactEvents(pass)[1].at;
  assert.ok(at(ops, (2 + grip) / 2, "c-obj-ball").y < at(ops, 2, "c-obj-ball").y, "it arcs up between them");
  assert.ok(Math.abs(at(ops, grip, "c-obj-ball").rotation) === 360, "one turn in flight");
  const caught = resolve({ cast: [{ id: "maya", holds: "ball" }, { id: "theo", cues: [{ at: 2.5, action: "catch", target: { character: "maya" } }] }] });
  const events = contactEvents(caught);
  assert.equal(events.find((e) => e.kind === "grip").at, 2.5, "the ball reaches theo's hands on the catch cue");
  assert.ok(events.find((e) => e.kind === "release").at < 2.5);
  // Each phase names the action it plays (the acting gate reads it): the catch makes maya throw.
  const [mayaQ, theoQ] = caught.content.actors;
  assert.ok(mayaQ.states.some((s) => s.acts === "throw") && theoQ.states.some((s) => s.acts === "catch"));
  assert.equal(theoQ.states.find((s) => s.acts === "catch").facing, "left", "theo, on the right, faces the throw");
  assert.throws(() => resolve({ cast: [{ id: "maya", cues: [{ at: 2, action: "throw" }] }, { id: "theo" }] }), /throw at 2 s: maya holds nothing/);
});

test("gag squash: a planned whole-body flatten on its own layer; the bones keep their lengths", () => {
  assert.equal(squashError({ amount: 0.4 }), null);
  assert.match(squashError({ amount: 1.2 }), /amount must be/);
  assert.match(squashError({ amount: 0.3, wobble: 1 }), /not supported/);
  const model = resolve({ cast: [{ id: "maya", cues: [{ at: 2, expression: "surprised", squash: { amount: 0.4, hold: 0.3, recover: 0.5 } }] }] });
  const ops = charactersTimeline(model);
  const { scaleX, scaleY } = squashScales(0.4);
  assert.deepEqual(at(ops, 2.2, "c-c0-gag"), { scaleX, scaleY }, "flat from the entry through the hold");
  assert.deepEqual(at(ops, 3.5, "c-c0-gag"), { scaleX: 1, scaleY: 1 }, "recovered");
  assert.ok(ops.filter((op) => /-c0-(torso|leg-[lr]|arm-[lr])$/.test(op.target)).every((op) => op.type === "set" || JSON.stringify(op.from) === JSON.stringify(op.to) || !("scaleY" in (op.to ?? {})) || op.to.scaleY === 1), "the rig's own joints are not squashed by the gag");
  // A carried prop goes down with the squashed body.
  const carrying = resolve({ cast: [{ id: "maya", holds: "box", cues: [{ at: 2, squash: { amount: 0.4 } }] }] });
  const boxOps = charactersTimeline(carrying);
  assert.ok(at(boxOps, 2.2, "c-obj-box").y > at(boxOps, 1.5, "c-obj-box").y + 20, "the box drops with her");
  close(at(boxOps, 4, "c-obj-box").y, at(boxOps, 1.5, "c-obj-box").y, 0.01, "and comes back up");
  const late = model.duration - 0.5;
  assert.throws(() => resolve({ cast: [{ id: "maya", cues: [{ at: late, squash: { amount: 0.4 } }] }] }), new RegExp(`squash at ${late} s lasts .* past the scene's end`));
});

test("both renderers draw contacts from one op list: every op targets a drawn element with transform props only", () => {
  const model = resolve({ objects: [{ id: "stack", prop: "paper-stack", at: 0.5 }], cast: [{ id: "maya", holds: "ball", cues: [{ at: 2, action: "throw", target: { character: "theo" } }, { at: 4.2, squash: { amount: -0.3 } }] }, { id: "theo", cues: [{ at: 6, action: "drop" }] }] });
  const drawn = new Set(ids(charactersView(model).front));
  for (const op of model.content.contact.ops) {
    assert.ok(drawn.has(op.target), `${op.target} is drawn`);
    for (const key of Object.keys({ ...op.props, ...op.to })) assert.ok(["x", "y", "rotation", "scaleX", "scaleY"].includes(key), `${key} is a shared transform prop`);
  }
});

test("direction-map cues carry actions, targets and squashes", () => {
  const cast = { characters: [{ id: "maya" }, { id: "theo" }] };
  assert.deepEqual(validateCastCues({ cast: [{ id: "maya", action: "hit", target: { character: "theo" }, squash: { amount: 0.3 } }] }, cast), []);
  assert.deepEqual(validateCastCues({ cast: [{ id: "maya", action: "smack" }, { id: "theo", action: "push" }] }, cast), ['line.cast[0].action "smack" is not an action (look-far, turn-to-look, gaze-at, point-at, walk-to, stand-up, stretch, push, pull, hit, catch, lift, drop, throw, give)', "line.cast[1].target is required for push"]);
  const words = [{ text: "and", start: 1, end: 1.2 }, { text: "smack", start: 1.5, end: 1.9 }];
  const map = { sections: [{ lines: [{ words: [0, 1], scenes: ["c"], cast: [{ id: "maya", at: "word:smack", action: "hit", target: { character: "theo" } }] }] }] };
  assert.deepEqual(sceneCastCues(map, "c", { words }).cues.maya, [{ at: 1.5, action: "hit", target: { character: "theo" } }]);
});

test("a pushed prop stops short of whoever stands in its way, and later actions and walks find it where it was left", () => {
  const model = resolve({ shot: "wide", objects: [{ id: "block", prop: "box", at: 0.45 }], cast: [{ id: "maya", cues: [walkTo({ prop: "block" }), { at: 2, action: "push", target: { prop: "block" } }, { at: 3.2, action: "push", target: { prop: "block" } }, { at: 4.4, action: "push", target: { prop: "block" } }] }, { id: "theo", cues: [{ at: 5.6, action: "walk-to", target: { prop: "block" } }, { at: 7.2, action: "pull", target: { prop: "block" } }] }] });
  const ops = charactersTimeline(model);
  const [, theo] = model.content.actors;
  const block = (t) => at(ops, t, "c-obj-block").x;
  assert.ok(block(5.5) + 85 * theo.scale < theo.x - 10, "the block stops before theo, never through him");
  // Theo walks to where the block is now (beside it), not where it started, and pulls it toward himself.
  const arrived = theo.states.find((s) => s.arrive);
  assert.ok(Math.abs(theo.x + arrived.x - block(5.5)) < Math.abs(theo.x - block(0)), "the walk aims at the block where it was left");
  assert.equal(theo.states.find((s) => s.contact && s.time < 7.2).facing, "left");
  assert.ok(block(8.5) > block(7), "the pull hauls it toward theo");
});

test("a strike never leans past STRIKE_LEAN: a prop on the floor is kicked, and one a stride away is stepped to", () => {
  const model = resolve({ objects: [{ id: "crate", prop: "box", at: 0.5 }], cast: [{ id: "maya", cues: [walkTo({ prop: "crate" }), { at: 3, action: "hit", target: { prop: "crate" } }, { at: 4.5, action: "push", target: { prop: "crate" } }, { at: 6, action: "push", target: { prop: "crate" } }] }, { id: "theo", position: "left" }] });
  const maya = model.content.actors.find((a) => a.id === "maya");
  const phases = maya.states.filter((s) => s.contact);
  assert.ok(phases.every((s) => Math.abs(s.body?.lean ?? 0) <= STRIKE_LEAN), "no dive");
  const kick = phases.find((s) => Math.abs(s.time - (3 - CONTACT.hit.strike)) < 1e-6);
  const leg = maya.states[0].facing === "left" || kick.facing === "left" ? "legL" : "legR";
  assert.ok(kick.body[leg] > 10 && !kick.arms, "the strike is the facing leg's, not a hand's");
  // The crate slid away after the first push: the second steps in one stride before winding up.
  const step = maya.states.find((s) => s.walk && s.time > 5);
  assert.ok(step && Math.abs(step.walk.to - step.walk.from) > 0, "a step in");
  assert.equal(maya.states.at(-1).x, step.walk.to, "and stays where it stepped");
  assert.throws(() => resolve({ cast: [{ id: "maya", cues: [{ at: 3, action: "hit", target: { character: "theo" } }] }, { id: "theo" }] }), /even with a step in/);
});

test("walks and what they carry ease in and out, never linear", () => {
  const model = resolve({ cast: [{ id: "maya", holds: "box", cues: [walkTo({ character: "theo" })] }, { id: "theo" }] });
  const moves = charactersTimeline(model).filter((op) => op.type === "tween" && /-(walk|obj-box)$/.test(op.target) && ("x" in (op.to ?? {})));
  assert.ok(moves.length >= 2 && moves.every((op) => op.ease !== "none"));
});

test("a throw cue and the catch cue it answers are one throw; a catch says it drives the thrower's throw", () => {
  const pair = resolve({ cast: [{ id: "maya", holds: "ball", cues: [{ at: 2, action: "throw", target: { character: "theo" } }] }, { id: "theo" }] });
  const lands = contactEvents(pair).find((e) => e.kind === "grip").at;
  const agreed = resolve({ cast: [{ id: "maya", holds: "ball", cues: [{ at: 2, action: "throw", target: { character: "theo" } }] }, { id: "theo", cues: [{ at: lands, action: "catch", target: { character: "maya" } }] }] });
  assert.deepEqual(contactEvents(agreed), contactEvents(pair));
  assert.throws(() => resolve({ cast: [{ id: "maya", holds: "ball", cues: [{ at: 2, action: "throw", target: { character: "theo" } }] }, { id: "theo", cues: [{ at: lands + 0.5, action: "catch", target: { character: "maya" } }] }] }), /lands in theo's hands at .*give only one of them/);
  assert.throws(() => resolve({ cast: [{ id: "maya", holds: "ball", cues: [{ at: 2.3, action: "gaze-at", target: "left" }] }, { id: "theo", cues: [{ at: 2.6, action: "catch", target: { character: "maya" } }] }] }), /theo's catch makes maya throw, released at .*leave out maya's own throw cue/);
});
