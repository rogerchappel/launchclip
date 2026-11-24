// Per-frame rig metrics and the rig gate (kit/core/characters/rig-metrics.mjs,
// src/rig_gate.js): a good walk passes; a sliding foot, a stretched bone, a
// dropped grip and a teleporting prop each fail with a clear message.
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveStory } from "@launchclip/core/story.mjs";
import assert from "node:assert/strict";
import { rigFrame } from "@launchclip/core/characters/rig-frame.mjs";
import { prototypePlan } from "@launchclip/core/characters/rig-scene.mjs";
import { measureRigScene, rigFindings, sampleRigScene } from "@launchclip/core/characters/rig-metrics.mjs";
import { RIG_THRESHOLDS, rigGate } from "../src/rig_gate.js";
import { explainGate } from "../src/gate_summary.js";

const PROTO = prototypePlan();
const { character, colors } = PROTO.actors[0];
const AT = { x: 300, floor: 1500, scale: 0.5 };
const actor = (walk = { start: 0.2, end: 1.6, to: 400 }) => ({ id: "ann", character, colors, at: AT, track: { x: 0, facing: "right", walks: [walk], keys: [{ t: 0 }] } });
const plan = (props = [], a = actor()) => ({ schema: "launchclip.rig-scene.v1", actors: [a], props });
const findings = (p, options = {}) => rigFindings(measureRigScene(sampleRigScene(p, { fps: 30, duration: 2, ...options }), RIG_THRESHOLDS), RIG_THRESHOLDS);
const errors = (list) => list.filter((finding) => finding.severity === "error");
// Ann's left palm at 1 s, where a well-placed prop waits for her.
const palmAt1 = sampleRigScene(plan(), { fps: 30, duration: 1 }).actors.ann[30].hands.l;

test("a good walk, and a prop picked up where the hand is, pass", () => {
  const list = findings(plan([{ id: "cup", prop: "cup", path: [{ t: 0, at: palmAt1 }, { t: 1, holder: { actor: "ann", hand: "l" } }] }]));
  assert.deepEqual(errors(list), []);
});

test("the approved prototype passes with no warnings (the thresholds are calibrated on it)", () => {
  assert.deepEqual(findings(PROTO, { duration: 8 }), []);
});

test("a stride the legs cannot reach slides the planted foot", () => {
  const list = errors(findings(plan([], actor({ start: 0.2, end: 0.6, to: 1600, stepLength: 1600 }))));
  assert.ok(list.length && list.every((finding) => finding.rule === "rig-foot-slide"));
  assert.match(list[0].detail, /^ann: the planted (left|right) foot slides \d+(\.\d)? px between [\d.]+ and [\d.]+ s \(limit 3 px\)$/);
});

test("a stretched forearm is bone drift", () => {
  const stretched = (a, t) => {
    const fr = rigFrame(a.character, a.track, t);
    const [e, w] = [fr.joints.elbowR, fr.joints.wristR];
    const k = 1 + 0.05 * t;
    return { ...fr, joints: { ...fr.joints, wristR: [e[0] + (w[0] - e[0]) * k, e[1] + (w[1] - e[1]) * k] } };
  };
  const [finding] = errors(findings(plan(), { frameOf: stretched }));
  assert.equal(finding.rule, "rig-bone-drift");
  assert.match(finding.detail, /^ann: the elbowR-wristR bone changes length by [\d.]+ px \(limit 1 px\)$/);
});

const across = [{ id: "cup", prop: "cup", path: [{ t: 0, at: [900, 1200] }, { t: 0.9, at: [900, 1200] }, { t: 1, holder: { actor: "ann", hand: "l" } }] }];
test("a hand that takes a prop at rest from across the room is a grip loss; a catch on the prop's curve is not", () => {
  const [finding] = errors(findings(plan(across)));
  assert.equal(finding.rule, "rig-grip-loss");
  assert.equal(finding.at, 1);
  assert.match(finding.detail, /^prop cup: the hand is \d+(\.\d)? px from it when it is taken or let go at 1 s \(limit 4 px\)$/);
  // The prototype's ball leaves the hand on its throw: a release and a flight, no grip loss or teleport.
  assert.deepEqual(errors(findings(PROTO, { duration: 5.5 })).filter((f) => f.prop), []);
});

test("an unheld prop that jumps in one frame is a teleport; a slow move between two places is not", () => {
  const moved = findings(plan([{ id: "ball", prop: "ball", path: [{ t: 0, at: [100, 1400] }, { t: 1.5, at: [700, 1400] }] }]));
  assert.deepEqual(errors(moved), []);
  const [finding] = errors(findings(plan([{ id: "ball", prop: "ball", path: [{ t: 0, at: [100, 1400] }, { t: 1, at: [100, 1400] }, { t: 1, at: [900, 1400] }] }])));
  assert.equal(finding.rule, "rig-prop-teleport");
  assert.match(finding.detail, /^prop ball: jumps 800 px in one frame at 1 s with nobody throwing it \(limit 120 px\)$/);
});

test("a joint that is not a number fails", () => {
  const [finding] = errors(findings(plan([], { ...actor(), at: { ...AT, x: NaN } })));
  assert.equal(finding.rule, "rig-nan");
});

test("the rig gate is skipped for today's stories and fails with times, a summary and a next step", () => {
  const today = resolveStory(JSON.parse(readFileSync(new URL("../eval/per-frame-rig/today.storyboard.json", import.meta.url), "utf8")));
  assert.deepEqual(rigGate(today), { status: "skipped", reason: "no scene uses the per-frame rig" });
  const story = { resolved: { fps: 30 }, scenes: [] };
  const good = rigGate(story, { scenes: [{ id: "s1", start: 4, end: 6, plan: plan() }] });
  assert.equal(good.status, "passed");
  assert.equal(good.measured.s1.actors.ann.foot_slide_px, 0);
  const bad = rigGate(story, { scenes: [{ id: "s1", start: 4, end: 6, plan: plan(across) }] });
  assert.equal(bad.status, "failed");
  assert.equal(bad.findings[0].at, 5, "finding times are story seconds");
  assert.deepEqual(bad.findings[0].ids, ["s1"]);
  assert.match(bad.next, /holder key/);
  const explained = explainGate("rig", bad);
  assert.equal(explained.summary, "Something a character holds slips out of their hand (0:05)");
});
