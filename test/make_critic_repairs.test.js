import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { RETAKES_SCHEMA, changedScenes, criticImproved, criticProblems, criticRepairBudget, criticRepairRoute, criticScore, failingShots, findingScenes, retakeProblems, retakeRound, retakeStep, retakesDocument, sceneAt, scopedRetake } from "../src/make/critic_repair.js";
import { MAKE_EXIT_CODES, MAKE_NEEDS_REPAIR_EXIT, makeExitCode, parseFlags, runCli } from "../src/cli.js";
import { makeOptionsFromFlags } from "../src/make/options.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const finding = (severity, category = "typography", extra = {}) => ({ id: `f-${severity}`, severity, category, message: `${severity} ${category} problem`, evidence_ids: [], ...extra });
const critiqueResult = (verdict, findings = []) => ({ status: "written", verdict, findings: findings.length, reviewed: 1, unreviewed: 0, warnings: [], model: "gpt-5.6-luna", critique: { verdict, summary: "", findings } });

// The fake model, plus: a storyboard call that carries critic problems gets a
// board with a new s2 headline (a repair the critic can see), a different one each round.
const HEADLINES = ["Every payout, matched", "Every payout, reconciled", "Every payout, in order"];
function repairingModel() {
  const fake = fakeModel({ vision: true });
  const inner = fake.model.client.runStructured.bind(fake.model.client);
  const repairs = [];
  fake.model.client.runStructured = async (request) => {
    const result = await inner(request);
    if (request.schemaName !== "launchclip_storyboard" || !/critic \(|A reviewer watched the last cut/.test(request.input)) return result;
    repairs.push(request.input);
    const board = JSON.parse(result.value.storyboard_json);
    board.scenes[1].params.headline = HEADLINES[(repairs.length - 1) % HEADLINES.length];
    return { ...result, value: { storyboard_json: JSON.stringify(board), direction_json: "" } };
  };
  return { ...fake, repairs };
}

async function make(t, { critic, criticRepairs } = {}) {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-critic-repairs-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const fake = repairingModel();
  const finishCalls = [];
  const criticCalls = [];
  const verdicts = [...critic];
  const criticAdapter = async (args) => { criticCalls.push(args); return verdicts.shift() ?? critiqueResult("ship"); };
  const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", candidates: "off", cwd, out: "video", ...(criticRepairs !== undefined ? { criticRepairs } : {}) }, { env: {}, client: fake.model, inventory: fakeInventory, finish: fakeFinish(finishCalls), critic: criticAdapter, notice() {} });
  const story = JSON.parse(await readFile(path.join(cwd, "video", "storyboard.json"), "utf8"));
  return { report, story, finishCalls, criticCalls, repairs: fake.repairs };
}

test("a critic that asks for a repair gets a round: the planner fixes the scene, only it renders again, and the critic ships", async (t) => {
  const { report, story, finishCalls, criticCalls, repairs } = await make(t, { critic: [critiqueResult("repair", [finding("major")]), critiqueResult("ship")] });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(criticCalls.length, 2);
  assert.equal(repairs.length, 1);
  assert.match(repairs[0], /critic \(major typography\): major typography problem/);
  assert.equal(finishCalls.length, 2);
  assert.deepEqual(finishCalls[1].options.scenes, ["s2"]);
  assert.equal(story.scenes[1].params.headline, "Every payout, matched");
  assert.equal(report.critic.verdict, "ship");
  assert.equal(report.gates.critic.status, "passed");
  assert.equal(report.critic_repairs.length, 1);
  assert.deepEqual({ round: report.critic_repairs[0].round, mode: report.critic_repairs[0].mode, kept: report.critic_repairs[0].kept, before: report.critic_repairs[0].verdict_before, after: report.critic_repairs[0].verdict_after, rendered: report.critic_repairs[0].rendered }, { round: 1, mode: "repair", kept: true, before: "repair", after: "ship", rendered: ["s2"] });
  assert.ok(report.costs.items.some((item) => item.stage.startsWith("critic-1-storyboard-repair")));
  assert.equal(report.options.critic_repairs, 3);
});

test("three rounds by default: each round that helps is kept, and a cut that still does not ship is needs-repair", async (t) => {
  const major = (n) => Array.from({ length: n }, (_, i) => finding("major", "typography", { id: `m${i}` }));
  const { report, story, criticCalls, finishCalls } = await make(t, { critic: [critiqueResult("repair", major(4)), critiqueResult("repair", major(3)), critiqueResult("repair", major(2)), critiqueResult("repair", major(1)), critiqueResult("ship")] });
  assert.equal(criticCalls.length, 4, "the first review and one per round, never a fourth round");
  assert.equal(finishCalls.length, 4);
  assert.deepEqual(report.critic_repairs.map((round) => [round.round, round.kept, round.findings_after.major]), [[1, true, 3], [2, true, 2], [3, true, 1]]);
  assert.equal(story.scenes[1].params.headline, "Every payout, in order");
  assert.equal(report.critic.verdict, "repair");
  assert.equal(report.gates.critic.status, "failed");
  assert.equal(report.status, "needs-repair");
});

test("the CLI exits 2 for a needs-repair video, and 0 with --allow-needs-repair", async (t) => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-needs-repair-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const run = (extra) => {
    const out = [];
    const adapters = { env: {}, client: fakeModel({ vision: true }).model, inventory: fakeInventory, finish: fakeFinish([]), critic: async () => critiqueResult("repair", [finding("major")]), notice() {} };
    const done = runCli(["make", PROMPT, "--assets", assets, "--voice", "test", "--music", "synth", "--out", path.join(cwd, "video"), "--critic-repairs", "0", "--candidates", "off", ...extra], { stdout: { write: (text) => out.push(text) }, stderr: { write() {} }, productionAdapters: { make: adapters } });
    return { done, out };
  };
  const refused = run([]);
  await assert.rejects(refused.done, (error) => {
    assert.equal(error.exitCode, MAKE_NEEDS_REPAIR_EXIT);
    assert.equal(MAKE_NEEDS_REPAIR_EXIT, 2);
    assert.match(error.message, /needs-repair \(critic failed\).*--allow-needs-repair/);
    assert.equal(error.costs, undefined, "the report already carries the costs");
    return true;
  });
  assert.match(refused.out.join(""), /launchclip make: needs-repair/, "the summary is printed before the exit");
  const allowed = run(["--allow-needs-repair"]);
  await allowed.done;
  assert.match(allowed.out.join(""), /launchclip make: needs-repair/);
});

test("a repair that does not lower the blocking and major findings is undone and the rounds stop", async (t) => {
  const findings = [finding("major")];
  const { report, story, criticCalls } = await make(t, { criticRepairs: 3, critic: [critiqueResult("repair", findings), critiqueResult("repair", findings), critiqueResult("ship")] });
  assert.equal(criticCalls.length, 2, "no second round after a round that made no progress");
  assert.equal(report.critic_repairs.length, 1);
  assert.equal(report.critic_repairs[0].kept, false);
  assert.equal(story.scenes[1].params.headline, "Ledgerly matches every payout", "the earlier storyboard is restored");
  assert.equal(report.critic.verdict, "repair");
  assert.equal(report.status, "needs-repair");
  assert.ok(report.warnings.some((warning) => /critic repair 1: undone, the earlier cut is kept/.test(warning)));
});

test("--critic-repairs 0 ships the critic's verdict as before", async (t) => {
  const { report, criticCalls, finishCalls } = await make(t, { criticRepairs: 0, critic: [critiqueResult("repair", [finding("major")])] });
  assert.equal(criticCalls.length, 1);
  assert.equal(finishCalls.length, 1);
  assert.equal(report.critic_repairs, undefined);
  assert.equal(report.critic.verdict, "repair");
  assert.ok(report.next_steps.some((step) => /asked for repair/.test(step)));
});

test("a replan verdict plans afresh with the findings in the brief and renders everything", async (t) => {
  const { report, finishCalls, repairs } = await make(t, { critic: [critiqueResult("replan", [finding("blocking", "narrative")]), critiqueResult("ship")] });
  assert.equal(report.critic_repairs[0].mode, "replan");
  assert.match(repairs[0], /## A reviewer watched the last cut/);
  assert.equal(finishCalls[1].options.scenes, undefined);
  assert.equal(report.critic_repairs[0].rendered, "all");
  assert.equal(report.critic.verdict, "ship");
});

test("the round logic: budget, score, progress, scene mapping, routing and changed scenes", () => {
  assert.equal(criticRepairBudget("0"), 0);
  assert.equal(criticRepairBudget(9), 3);
  assert.throws(() => criticRepairBudget(-1), /--critic-repairs/);
  assert.equal(makeOptionsFromFlags(parseFlags(["--critic-repairs", "2"])).criticRepairs, 2);
  assert.equal(criticRepairBudget(undefined), 3);
  assert.equal(parseFlags(["--allow-needs-repair"])["allow-needs-repair"], true);

  const before = criticScore({ verdict: "repair", findings: [finding("blocking"), finding("major"), finding("minor")] });
  assert.deepEqual(before, { verdict: "repair", blocking: 1, major: 1, minor: 1, total: 3 });
  assert.equal(criticImproved(before, { verdict: "repair", blocking: 0, major: 1, minor: 5 }), true);
  assert.equal(criticImproved(before, { verdict: "repair", blocking: 1, major: 1, minor: 0 }), false);
  assert.equal(criticImproved(before, { verdict: "ship", blocking: 0, major: 0, minor: 4 }), true);

  const scenes = [{ id: "hook", start: 0, end: 2 }, { id: "body", start: 2, end: 6 }, { id: "label", start: 2.5, end: 4, track: 1 }];
  assert.equal(sceneAt(scenes, 3), "body");
  assert.equal(sceneAt(scenes, 9), null);
  const mapped = findingScenes([finding("major", "narrative", { evidence_ids: ["e1", "e2", "unknown"] })], [{ evidence_id: "e1", at_seconds: 0.5 }, { evidence_id: "e2", at_seconds: 3 }], scenes);
  assert.deepEqual(mapped[0].scenes, ["hook", "body"]);
  assert.equal(criticRepairRoute({ verdict: "repair" }, mapped, "hook"), "replan", "a hook problem replans");
  assert.equal(criticRepairRoute({ verdict: "repair" }, mapped, "intro"), "repair");
  assert.equal(criticRepairRoute({ verdict: "replan" }, [], "hook"), "replan");
  assert.match(criticProblems([finding("minor"), ...mapped])[0], /^critic \(major narrative, scenes hook, body\)/);

  const story = { format: { duration: 6 }, scenes: [{ id: "a", start: 0, end: 2, params: { t: 1 } }, { id: "b", start: 2, end: 6, params: { t: 1 } }] };
  const edited = structuredClone(story);
  edited.scenes[1].params.t = 2;
  assert.deepEqual(changedScenes(story, edited), ["b"]);
  const retimed = structuredClone(edited);
  retimed.scenes[0].end = 3;
  assert.equal(changedScenes(story, retimed), null);
  const restyled = { ...structuredClone(story), grammar: "snappy" };
  assert.equal(changedScenes(story, restyled), null);
});

test("the animation path's exit codes: distinct by default, and other videos keep today's", () => {
  const animation = { routing: { kind: "animation" } };
  assert.deepEqual(MAKE_EXIT_CODES, { ready: 0, failed: 1, "needs-repair": 2, "awaiting-approval": 3, "ready-for-review": 4 });
  assert.deepEqual(["ready", "failed", "needs-repair", "awaiting-approval", "ready-for-review", "stopped"].map((status) => makeExitCode({ ...animation, status })), [0, 1, 2, 3, 4, 0]);
  assert.deepEqual(["ready", "failed", "needs-repair", "awaiting-approval", "ready-for-review"].map((status) => makeExitCode({ routing: { lane: "motion" }, status })), [0, 1, 2, 0, 0], "no existing caller breaks");
  assert.equal(makeExitCode({ ...animation, status: "needs-repair" }, { allowNeedsRepair: true }), 0);
  assert.equal(makeExitCode({ ...animation, status: "ready-for-review" }, { allowNeedsRepair: true }), 4, "--allow-needs-repair is about needs-repair only");
});

test("the retake logic: failing shots, the cheapest step, a scoped storyboard and the record", () => {
  const shots = [{ id: "desk", frames: 65, beats: ["setup"] }, { id: "ask", frames: 191, beats: ["problem", "attempt"] }, { id: "test", frames: 142, beats: ["turn"] }, { id: "push", frames: 40, beats: ["attempt"] }];
  const acting = finding("major", "acting", { id: "a1", scenes: ["ask"] });
  const minor = finding("minor", "acting", { id: "m1", scenes: ["desk"] });
  const twoShots = finding("blocking", "lip-sync", { id: "l1", scenes: ["test", "ask", "gone"] });

  assert.deepEqual(failingShots([acting, minor, twoShots], shots), [
    { id: "test", frames: 142, beats: ["turn"], findings: ["l1"], categories: ["lip-sync"] },
    { id: "ask", frames: 191, beats: ["problem", "attempt"], findings: ["a1", "l1"], categories: ["acting", "lip-sync"] }
  ], "blocking and major only, the smallest shot first, unknown scenes left out");

  // Step 1: redirect the shots the findings name.
  assert.deepEqual(retakeStep({ verdict: "repair" }, [acting, minor], shots), { step: "redirect", shots: ["ask"], failing: ["ask"], beats: [], reason: "a finding names the shot" });
  // Step 3: the beat, when the critic asks for a replan, the story is wrong there, or a redirect did not fix it.
  assert.deepEqual(retakeStep({ verdict: "replan" }, [acting], shots), { step: "replan-beat", shots: ["ask", "push"], failing: ["ask"], beats: ["problem", "attempt"], reason: "the critic asked for a replan" });
  assert.equal(retakeStep({ verdict: "repair" }, [finding("major", "narrative", { scenes: ["test"] })], shots).step, "replan-beat");
  const again = retakeStep({ verdict: "repair" }, [acting], shots, [{ step: "redirect", shots: ["ask"], kept: true }]);
  assert.deepEqual([again.step, again.reason], ["replan-beat", "the shot was redirected and still fails"]);
  assert.equal(retakeStep({ verdict: "repair" }, [acting, twoShots], shots, [{ step: "redirect", shots: ["ask"], kept: true }]).step, "redirect", "a shot not yet redirected keeps the round on step 1");
  assert.deepEqual(retakeStep({ verdict: "repair" }, [minor, finding("major", "narrative", { scenes: [] })], shots), { step: null, shots: [], failing: [], beats: [], reason: "the blocking and major findings name no shot" });

  // Only the named scenes are taken, and their timing holds.
  const before = { title: "t", scenes: [{ id: "a", start: 0, end: "word:x", params: { pose: "stand" } }, { id: "b", start: "word:x", end: 6, track: 1, params: { pose: "stand" } }] };
  const after = { title: "changed", scenes: [{ id: "a", start: 0, end: 3, params: { pose: "point" } }, { id: "b", start: "word:x", end: 6, track: 0, params: { pose: "wave" } }, { id: "c", start: 6, end: 7 }] };
  const scoped = scopedRetake(before, after, ["b"]);
  assert.deepEqual(scoped.story, { title: "t", scenes: [before.scenes[0], { id: "b", start: "word:x", end: 6, track: 1, params: { pose: "wave" } }] });
  assert.deepEqual(scoped.changed, ["b"]);
  assert.deepEqual(scoped.ignored, ["scene a is outside the retake", "new scene c"]);
  assert.deepEqual(scopedRetake(before, { scenes: [{ ...before.scenes[0], end: 2 }] }, ["a"]), { story: before, changed: [], ignored: ["scene a's start and end (the animatic locked the timing)"] });

  assert.deepEqual(retakeProblems([acting, minor], ["ask"]), ["critic (major acting, scene ask): major acting problem"]);
  const plan = retakeStep({ verdict: "repair" }, [acting, minor], shots);
  const round = retakeRound({ round: 1, plan, findings: [acting, minor], before: criticScore({ verdict: "repair", findings: [acting, minor] }) });
  assert.deepEqual({ round: round.round, step: round.step, shots: round.shots, findings: round.findings, verdict_before: round.verdict_before, kept: round.kept }, { round: 1, step: "redirect", shots: ["ask"], findings: [{ id: "a1", severity: "major", category: "acting", message: "major acting problem", shots: ["ask"] }], verdict_before: "repair", kept: false });
  assert.deepEqual(retakesDocument([round], { review: "animatic", verdict: "repair" }), { schema: RETAKES_SCHEMA, review: "animatic", limit: 3, status: "needs-repair", verdict: "repair", rounds: [round] });
  assert.equal(retakesDocument([], { verdict: "ship" }).status, "ship");
  assert.equal(RETAKES_SCHEMA, "launchclip.retakes.v1");
});
