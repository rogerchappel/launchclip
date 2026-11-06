import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { changedScenes, criticImproved, criticProblems, criticRepairBudget, criticRepairRoute, criticScore, findingScenes, sceneAt } from "../src/make/critic_repair.js";
import { parseFlags } from "../src/cli.js";
import { makeOptionsFromFlags } from "../src/make/options.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const finding = (severity, category = "typography", extra = {}) => ({ id: `f-${severity}`, severity, category, message: `${severity} ${category} problem`, evidence_ids: [], ...extra });
const critiqueResult = (verdict, findings = []) => ({ status: "written", verdict, findings: findings.length, reviewed: 1, unreviewed: 0, warnings: [], model: "gpt-5.6-luna", critique: { verdict, summary: "", findings } });

// The fake model, plus: a storyboard call that carries critic problems gets a
// board with a new s2 headline (a repair the critic can see).
function repairingModel() {
  const fake = fakeModel({ vision: true });
  const inner = fake.model.client.runStructured.bind(fake.model.client);
  const repairs = [];
  fake.model.client.runStructured = async (request) => {
    const result = await inner(request);
    if (request.schemaName !== "launchclip_storyboard" || !/critic \(|A reviewer watched the last cut/.test(request.input)) return result;
    repairs.push(request.input);
    const board = JSON.parse(result.value.storyboard_json);
    board.scenes[1].params.headline = "Every payout, matched";
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
  const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "video", ...(criticRepairs !== undefined ? { criticRepairs } : {}) }, { env: {}, client: fake.model, inventory: fakeInventory, finish: fakeFinish(finishCalls), critic: criticAdapter, notice() {} });
  const story = JSON.parse(await readFile(path.join(cwd, "video", "storyboard.json"), "utf8"));
  return { report, story, finishCalls, criticCalls, repairs: fake.repairs };
}

test("a critic that asks for a repair gets one round: the planner fixes the scene, only it renders again, and the critic ships", async (t) => {
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
  assert.equal(report.options.critic_repairs, 1);
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
  assert.equal(criticRepairBudget(undefined), 1);
  assert.equal(criticRepairBudget("0"), 0);
  assert.equal(criticRepairBudget(9), 3);
  assert.throws(() => criticRepairBudget(-1), /--critic-repairs/);
  assert.equal(makeOptionsFromFlags(parseFlags(["--critic-repairs", "2"])).criticRepairs, 2);

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
