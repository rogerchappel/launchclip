// Cast-scene cues → a per-frame rig plan (kit/core/characters/rig-compile.mjs):
// the opt-in (story.cast.rig, params.rig), what each pose and action compiles
// to, contact timing, grips and prop ownership, and the op-list fallbacks.
import test from "node:test";
import assert from "node:assert/strict";
import { charactersTimeline, charactersView } from "@launchclip/core/catalog-characters.mjs";
import { POSES } from "@launchclip/core/characters/rig.mjs";
import { CONTACT } from "@launchclip/core/characters/contact.mjs";
import { storyCastErrors } from "@launchclip/core/characters/cues.mjs";
import { RIG_SCHEMA, compileRigScene } from "@launchclip/core/characters/rig-compile.mjs";
import { rigScenePrepare, rigSceneState, rigSceneTree, validateRigScenePlan } from "@launchclip/core/characters/rig-scene.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { castGate } from "../src/cast.js";
import { measureRigScene, sampleRigScene } from "@launchclip/core/characters/rig-metrics.mjs";
import { RIG_THRESHOLDS } from "../src/rig_gate.js";

const brand = { colors: { bg: "#101820", primary: "#2a9d8f", accent: "#e9c46a", ink: "#101820", paper: "#f4f1ea" } };
const story = (scenes, { style = "stick", rig, characters = [{ id: "maya" }, { id: "theo" }] } = {}) => ({ schema: "launchclip.story.v1", lane: "motion", brand, format: { width: 1920, height: 1080, fps: 30, duration: 10 }, cast: { style, ...(rig ? { rig } : {}), characters }, scenes });
const scene = (params, module = "cast-scene") => ({ id: "c", module, start: 0, end: 10, params: module === "cast-scene" ? { set: "standing", ...params } : params });
const resolve = (params, options = { rig: "frame" }) => { const s = story([scene(params)], options); return resolveModule(s.scenes[0], s); };
const planOf = (params, options) => { const model = resolve(params, options); const plan = model.content.rigScene; assert.ok(plan, `no plan: ${model.content.rigFallback}`); assert.deepEqual(validateRigScenePlan(plan), [], "the plan is valid"); return plan; };
const walkTo = (target, at = 0.3) => ({ at, action: "walk-to", target });
const FRAME = 1 / 30;
const ids = (node, out = []) => { if (node?.id) out.push(node.id); for (const child of node?.children ?? []) ids(child, out); return out; };
// Each actor's grip spans per prop from its hand keys: [{actor, prop, from, to}].
const gripSpans = (plan) => plan.actors.flatMap((a) => {
  const keys = Object.values(a.track.hands).flat().filter((k) => k.grip);
  return [...new Set(keys.map((k) => k.grip))].map((prop) => { const ts = keys.filter((k) => k.grip === prop).map((k) => k.t); return { actor: a.id, prop, from: Math.min(...ts), to: Math.max(...ts) }; });
});

test("the opt-in: ops by default and byte-identical; frame from the story cast or the scene", () => {
  const params = { cast: [{ id: "maya", cues: [walkTo({ character: "theo" }), { at: 3, pose: "wave" }] }, { id: "theo" }] };
  const plain = resolve(params, {});
  assert.equal(plain.content.rigScene, undefined);
  assert.equal(plain.content.rigFallback, undefined);
  assert.equal(JSON.stringify(resolve(params, { rig: "ops" })), JSON.stringify(plain), "cast.rig ops is today's output");
  assert.equal(JSON.stringify(resolve({ ...params, rig: "ops" }, { rig: "frame" })), JSON.stringify(plain), "params.rig ops overrides the story's frame");
  const framed = resolve({ ...params, rig: "frame" }, {});
  assert.equal(framed.content.rigScene.schema, RIG_SCHEMA, "params.rig frame turns it on alone");
  // The rig layer stands where the actors did; their parts and ops are gone, the set's stay.
  const tree = ids(charactersView(framed).front);
  assert.ok(tree.includes("c-rig") && !tree.some((id) => id.startsWith("c-c0")));
  const ops = charactersTimeline(framed);
  assert.ok(!ops.some((op) => op.target.startsWith("c-c")), "no actor ops");
  assert.ok(ops.some((op) => op.target === "c"), "the scene's own fade stays");
  assert.throws(() => resolve({ ...params, rig: "per-frame" }), /params\.rig must be one of ops, frame/);
  assert.deepEqual(storyCastErrors({ rig: "frames", characters: [] }), ['cast.rig must be "ops" (the op list, the default) or "frame" (the per-frame rig)']);
  assert.deepEqual(storyCastErrors({ rig: "frame", characters: [] }), []);
});

test("every standing pose compiles; posed arms become hand targets, gestures loop", () => {
  for (const pose of POSES.filter((p) => p !== "sit")) {
    const plan = planOf({ cast: [{ id: "maya", cues: [{ at: 1, pose }] }] });
    const [maya] = plan.actors;
    const posed = !["stand", "walk", "slump"].includes(pose);
    assert.equal(Object.keys(maya.track.hands).length > 0, posed, `${pose}: hand targets only off the rest pose`);
    // The pose is reached a pose tween after its cue, as the op list's.
    if (posed) assert.ok(Object.values(maya.track.hands).some((keys) => keys.some((k) => Math.abs(k.t - 1.45) < 1e-6)), `${pose} arrives at 1.45 s`);
  }
  // A wave swings the forearm to and fro; the raised hand is above the shoulder (negative down).
  const wave = planOf({ cast: [{ id: "maya", facing: "right", cues: [{ at: 1, pose: "wave" }] }] }).actors[0].track.hands.r;
  const arrived = wave.filter((k) => k.t >= 1.45);
  assert.ok(arrived.every((k) => k.at[1] < 0), "the waving hand is up");
  assert.ok(new Set(arrived.map((k) => k.at.join())).size === 2 && arrived.length > 10, "it alternates between two places while the pose holds");
  // A cheer bounces the body: crouch keys loop.
  const cheer = planOf({ cast: [{ id: "maya", cues: [{ at: 1, pose: "cheer" }] }] }).actors[0].track.keys;
  assert.ok(new Set(cheer.filter((k) => k.t > 1.5).map((k) => k.crouch)).size === 2);
});

test("walks, facings, faces and mouths keep their timing", () => {
  const plan = planOf({ cast: [{ id: "maya", says: [{ from: 4, to: 5, words: [[4, 4.4, "hello"], [4.5, 5, "there"]] }], cues: [walkTo({ character: "theo" }, 0.5), { at: 3, expression: "happy" }, { at: 6, facing: "left", expression: "sad" }] }, { id: "theo" }] });
  const [maya] = plan.actors;
  assert.equal(maya.track.walks.length, 1);
  assert.equal(maya.track.walks[0].start, 0.5);
  assert.ok(maya.track.walks[0].to > 0, "toward theo, on the right");
  assert.deepEqual(maya.track.facings, [{ t: 6, facing: "left" }]);
  assert.deepEqual(maya.expressions, [{ t: 0, expression: "neutral" }, { t: 3, expression: "happy" }, { t: 6, expression: "sad" }]);
  assert.ok(maya.mouth.length > 2 && maya.mouth[0].t === 4 && maya.mouth.at(-1).viseme === "closed");
  assert.deepEqual(maya.at, { x: resolve({ cast: [{ id: "maya" }, { id: "theo" }] }).content.actors[0].x, floor: maya.at.floor, scale: maya.at.scale });
});

test("a contact lands on its cue time: hands for a strike, feet for a kick, a stagger on the target", () => {
  for (const action of ["push", "hit"]) {
    const plan = planOf({ cast: [{ id: "maya", cues: [walkTo({ character: "theo" }), { at: 3, action, target: { character: "theo" } }] }, { id: "theo" }] });
    const [maya, theo] = plan.actors;
    const hand = maya.track.hands.r;
    const T = CONTACT[action];
    assert.ok(hand.some((k) => Math.abs(k.t - 3) <= FRAME), `${action}: a hand key on the contact`);
    assert.ok(hand.some((k) => Math.abs(k.t - (3 - T.strike)) <= FRAME), `${action}: the wind-up before it`);
    const contactKey = hand.find((k) => Math.abs(k.t - 3) <= FRAME), wind = hand.find((k) => Math.abs(k.t - (3 - T.strike)) <= FRAME);
    assert.ok(contactKey.at[0] > wind.at[0], `${action}: the hand winds back, then strikes forward`);
    // The struck character staggers back (away from its facing) and leans back, then recovers.
    const hitKeys = theo.track.keys.filter((k) => k.t > 3 && k.t < 3.5 && k.shift !== undefined);
    assert.ok(hitKeys.some((k) => k.shift < 0 && k.lean < 0), `${action}: theo staggers`);
    assert.equal(theo.track.keys.at(-1).shift, 0, "and recovers");
    assert.equal(theo.expressions.find((e) => e.t === 3)?.expression, "surprised");
    if (action === "hit") assert.ok(theo.track.squash.some((q) => q.t === 3 && q.amount < 0), "a hit squashes the target");
  }
  const kick = planOf({ objects: [{ id: "parcel", prop: "box", at: 0.5 }], cast: [{ id: "maya", cues: [walkTo({ prop: "parcel" }), { at: 2.5, action: "hit", target: { prop: "parcel" } }] }] });
  const foot = kick.actors[0].track.feet.l;
  assert.ok(foot && foot.some((k) => Math.abs(k.t - 2.5) <= FRAME), "something low is kicked: a foot key on the contact");
  assert.ok(kick.props[0].squash.some((q) => q.t === 2.5), "the parcel squashes on the impact");
});

test("give: the giver alone, both hands in the shared window, then the receiver", () => {
  const plan = planOf({ cast: [{ id: "maya", holds: "box", cues: [walkTo({ character: "theo" }, 0.5), { at: 3, action: "give", target: { character: "theo" } }] }, { id: "theo" }] });
  const shared = CONTACT.give.shared;
  const box = plan.props.find((p) => p.id === "box");
  // Held by maya until theo takes hold, passed hand to hand while both hold it, theo's from her release.
  assert.deepEqual(box.path.map((k) => [k.t, k.holder?.actor]), [[0, "maya"], [3, "maya"], [3 + shared, "theo"]]);
  // Grip keys reach for a prop until the hand takes it: maya carries it (no grip keys); theo's hand locks on it from the contact until he takes it.
  const spans = gripSpans(plan);
  assert.equal(spans.find((s) => s.actor === "maya"), undefined);
  const theo = spans.find((s) => s.actor === "theo");
  assert.ok(Math.abs(theo.from - 3) < 1e-6 && Math.abs(theo.to - (3 + shared)) < 1e-6, "theo grips it through the shared window");
});

test("a throw flies an arc into the catcher's hands; lift, drop and pull move the prop", () => {
  const plan = planOf({ objects: [{ id: "parcel", prop: "box", at: 0.5 }], cast: [{ id: "maya", cues: [walkTo({ prop: "parcel" }), { at: 4, action: "lift", target: { prop: "parcel" } }, { at: 6, action: "throw", target: { character: "theo" } }] }, { id: "theo", cues: [{ at: 8, action: "drop" }] }] });
  const parcel = plan.props[0];
  const holders = parcel.path.filter((k) => k.holder).map((k) => [k.t, k.holder.actor]);
  // A key where each hand takes it and where it lets go: same-holder keys keep it in hand (rig-scene.mjs).
  assert.deepEqual(holders.map(([, a]) => a), ["maya", "maya", "theo", "theo"]);
  assert.ok(holders[0][0] >= 4 && holders[0][0] <= 4.3, "lifted on the cue, as the hold at the bottom ends");
  const rest = parcel.path.filter((k) => k.at && k.t < holders[0][0]);
  assert.deepEqual(rest.at(-1).at, rest.at(-2).at, "it rests (two equal neighbours) until just before the pick-up");
  assert.ok(holders[0][0] - rest.at(-1).t <= 0.15, "the resting key is just before the pick-up");
  const flight = parcel.path.filter((k) => k.at && k.t > holders[1][0] && k.t < holders[2][0]);
  assert.equal(flight.length, 1, "hand to hand: the flight's top between the release and the catch");
  assert.ok(flight[0].t - holders[1][0] >= 0.1 - 1e-6 && holders[2][0] - flight.at(-1).t >= 0.1 - 1e-6, "the rig's curve leaves the release hand and enters the catching hand");
  const state = (t) => rigSceneState(plan, t, prepared).props[0].at;
  const prepared = rigScenePrepare(plan);
  const apex = Math.min(...flight.map((k) => k.at[1]));
  assert.ok(apex < state(holders[1][0])[1] - 50 && apex < state(holders[2][0])[1] - 50, "up and over: an arc from hand to hand");
  // The prop never jumps: at most a throw's speed between 30 fps frames, from the pick-up to the floor.
  const measured = measureRigScene(sampleRigScene(plan, { fps: 30, duration: 10, prepared }), RIG_THRESHOLDS);
  assert.deepEqual(measured.props.parcel.grip.filter((g) => g.px > RIG_THRESHOLDS.errors.grip_loss_px), [], "the hand is on the parcel when it lifts it");
  assert.equal(measured.props.parcel.teleports.length, 0);
  for (let t = 3.5; t < 9.5; t += FRAME) { const a = state(t), b = state(t + FRAME); assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 120, `no jump at ${t.toFixed(2)} s`); }
  const landed = parcel.path.at(-1);
  assert.ok(landed.t > 8 && landed.at, "dropped, it falls to the floor");
  assert.ok(parcel.squash.some((q) => Math.abs(q.t - holders[2][0]) < 1e-6), "the catch squashes it");
  // Never in two hands outside a handover.
  const spans = gripSpans(plan);
  for (const a of spans) for (const b of spans) if (a !== b && a.prop === b.prop) assert.ok(a.to <= b.from + 1e-6 || b.to <= a.from + 1e-6, `${a.actor} and ${b.actor} never hold it at once`);
  const pull = planOf({ objects: [{ id: "cart", prop: "box", at: 0.2 }], cast: [{ id: "theo", cues: [walkTo({ prop: "cart" }, 1), { at: 5, action: "pull", target: { prop: "cart" } }] }] });
  const cart = pull.props[0];
  assert.ok(!cart.path.some((k) => k.holder), "a pulled prop stays on the floor");
  assert.notDeepEqual(cart.path[0].at, cart.path.at(-1).at, "and slides");
  assert.ok(Object.values(pull.actors[0].track.hands).flat().some((k) => k.grip === "cart" && k.t === 5), "the hand grips it on the contact");
});

test("point-at aims the hand at its target and turns the head", () => {
  const plan = planOf({ cast: [{ id: "maya", facing: "right", cues: [{ at: 1, action: "point-at", target: { x: 1700, y: 200 } }] }] });
  const hand = plan.actors[0].track.hands.r.find((k) => k.t > 1.4);
  assert.ok(hand.at[0] > 150 && hand.at[1] < 100, "the arm reaches out and up toward it");
});

test("scenes the per-frame rig cannot play keep the op list, with a warning", () => {
  const params = { cast: [{ id: "maya" }] };
  const flat = resolve(params, { rig: "frame", style: "flat" });
  assert.match(flat.content.rigFallback, /the flat drawing style has no per-frame rig/);
  assert.equal(flat.content.rigScene, undefined);
  assert.ok(charactersTimeline(flat).some((op) => op.target.startsWith("c-c0")), "the op list plays it");
  assert.match(resolve({ set: "sofa", cast: [{ id: "maya" }] }).content.rigFallback, /does not sit/);
  assert.match(resolve({ cast: [{ id: "comet" }] }, { rig: "frame", characters: [{ id: "comet" }] }).content.rigFallback, /comet is a stallion/);
  const cameoStory = story([scene({ character: "maya" }, "character-cameo")], { rig: "frame" });
  const cameo = resolveModule(cameoStory.scenes[0], cameoStory);
  assert.match(cameo.content.rigFallback, /character-cameo draws its character on the op list/);
  const gateStory = story([scene(params)], { rig: "frame", style: "flat" });
  const { warnings } = castGate(gateStory);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^c: the per-frame rig falls back to the op list: the flat drawing style has no per-frame rig/);
  assert.equal(castGate(story([scene(params)])).warnings, undefined, "no warnings without the opt-in");
});

test("a person shared with the scene before waits for the way in; one shared with the next leaves on the way out", () => {
  const model = resolve({ cast: [{ id: "maya" }, { id: "theo" }] });
  const plan = compileRigScene({ actors: model.content.actors, start: 0, duration: 10, prefix: "c", single: { arrive: { ids: ["maya"], at: 0.4 }, leave: { ids: ["theo"], at: 10 } } });
  assert.deepEqual(validateRigScenePlan(plan), []);
  assert.deepEqual(plan.actors[0].visible, [{ t: 0, visible: false }, { t: 0.4, visible: true }]);
  assert.deepEqual(plan.actors[1].visible, [{ t: 10, visible: false }]);
  const drawn = (t) => rigSceneTree(plan, t, { width: 1920, height: 1080 }).children.length;
  assert.equal(drawn(0.2), 1, "maya is hidden until the way in has passed");
  assert.equal(drawn(1), 2);
  assert.equal(drawn(10), 1, "theo has gone with the way out");
});
