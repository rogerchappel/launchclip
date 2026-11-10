// The animation scorecard and its parity table (docs/ANIMATION_PIPELINE_RFC.md
// §8.3): eval/formats.mjs --animation, eval/animation-metrics.mjs and
// eval/animation-parity.mjs.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DIALOGUE_MEASURES } from "@launchclip/core/cadence.mjs";
import { ANIMATION_PARITY_METRICS, compareAnimation, designMetrics, formatAnimationScorecard, parityMarkdown, scoreAnimation } from "../eval/animation-metrics.mjs";
import { readReport, runAnimationParity } from "../eval/animation-parity.mjs";
import { animationCommands, evaluateAnimationProject, loadAnimationSuite, parseArguments, runAnimationEval } from "../eval/formats.mjs";

const EXAMPLE = "examples/story/dialogue-9x16";
const suite = await loadAnimationSuite();
const brief = (id) => suite.briefs.find((entry) => entry.id === id);
const temporary = () => mkdtempSync(path.join(os.tmpdir(), "animation-scorecard-"));

// The example, with what a finished run leaves beside it: finish's gates, the critic's verdict and make's report.
function finishedProject(dir, { verdict = "ship", failed = [] } = {}) {
  cpSync(EXAMPLE, dir, { recursive: true });
  mkdirSync(path.join(dir, "qa", "finish"), { recursive: true });
  const gates = Object.fromEntries(["script", "cast", "acting", "layout", "motion"].map((name) => [name, { status: failed.includes(name) ? "failed" : "passed" }]));
  writeFileSync(path.join(dir, "qa", "finish", "gates.json"), JSON.stringify({ ...gates, face: { status: "skipped" } }));
  writeFileSync(path.join(dir, "qa", "critic.json"), JSON.stringify({ verdict, summary: "", findings: verdict === "ship" ? [] : [{ severity: "blocking", category: "acting", message: "nobody reacts" }] }));
  writeFileSync(path.join(dir, "MAKE.json"), JSON.stringify({ status: "ready", started_at: "2026-11-10T00:00:00.000Z", finished_at: "2026-11-10T00:03:20.000Z", costs: { estimated_usd: 0.42, complete: true }, script: { passes: [{ kind: "write" }, { kind: "repair" }] } }));
  return dir;
}

test("animation scorecard: the six briefs, each with what it exercises", () => {
  assert.deepEqual(suite.briefs.map((entry) => entry.id), ["product-fix", "pov", "last-time", "argument", "silent", "trio"]);
  assert.equal(suite.profile, "story-characters");
  assert.deepEqual([suite.aspect, suite.duration_seconds], ["9:16", [30, 45]]);
  for (const entry of suite.briefs) {
    assert.ok(entry.brief.length > 60 && entry.label, entry.id);
    assert.ok(entry.exercises.length >= 3, `${entry.id} says what it exercises`);
    assert.ok(Number.isInteger(entry.expect.characters), `${entry.id} names its cast size`);
  }
  assert.deepEqual([brief("pov").expect.skeleton, brief("last-time").expect.skeleton], ["pov", "last-time"]);
  assert.deepEqual(suite.briefs.map((entry) => entry.expect.characters), [2, 1, 2, 2, 2, 3]);
  // Only a brief with a hand-authored example has a stand-in.
  assert.deepEqual(suite.briefs.filter((entry) => entry.stand_in).map((entry) => entry.id), ["product-fix"]);
});

test("animation scorecard: arguments", () => {
  assert.deepEqual(parseArguments(["--animation", "--path", "make", "--runs", "runs/make", "--project", "pov=/tmp/a=b"]), { render: true, animation: true, path: "make", runs: "runs/make", projects: { pov: "/tmp/a=b" } });
  assert.throws(() => parseArguments(["--runs", "x"]), /go with --animation/);
  assert.throws(() => parseArguments(["--animation", "--project", "pov"]), /<brief id>=<project dir>/);
  const commands = animationCommands(suite, "runs/make");
  assert.equal(commands.length, 6);
  assert.match(commands[1], /^launchclip make "POV: .*" --animation --aspect 9:16 --out runs\/make\/pov$/);
});

test("animation scorecard: with no run it scores the stand-in example and says so", async () => {
  const out = temporary();
  const report = await runAnimationEval({ out });
  assert.equal(report.path, null);
  assert.deepEqual(report.results.map((result) => result.status), ["scored", "not-run", "not-run", "not-run", "not-run", "not-run"]);
  const [first] = report.results;
  assert.equal(first.stand_in, EXAMPLE);
  assert.deepEqual(Object.fromEntries(Object.entries(first.metrics.contracts).map(([name, entry]) => [name, entry.status])), { script: "valid", bible: "missing", direction: "valid", storyboard: "valid" });
  assert.deepEqual(first.metrics.story.lines_per_character, { maya: 3, sam: 3, narrator: 2 });
  // The new measures are in the report, each against its band.
  for (const name of DIALOGUE_MEASURES) {
    assert.equal(typeof first.metrics.cadence.measures[name], "number", name);
    assert.ok(first.metrics.cadence.bands.some((band) => band.measure === name), `${name} is compared with the profile`);
  }
  assert.equal(first.metrics.cadence.provenance, "seed");
  // Nothing a run would have recorded is made up.
  assert.deepEqual([first.metrics.gates, first.metrics.critic, first.metrics.cost, first.metrics.design], [null, null, null, null]);
  const markdown = readFileSync(path.join(out, "report.md"), "utf8");
  assert.match(markdown, /Stand-in:\*\* scored from the hand-authored example/);
  assert.match(markdown, /\| speaker_turns_per_min \| 14\.63 \|/);
  assert.match(markdown, /\*\*Not run:\*\* no project given for this brief/);
  assert.match(formatAnimationScorecard(report.results), /pov\s+– not run/);
  // A path's run never falls back to the stand-in.
  await assert.rejects(runAnimationEval({ path: "make", out }), /needs that path's finished projects/);
});

test("animation scorecard: a finished project reports its gates, critic, repairs and cost", async () => {
  const runs = temporary();
  finishedProject(path.join(runs, "product-fix"), { failed: ["motion"] });
  const report = await runAnimationEval({ path: "make", runs, out: path.join(runs, "out") });
  const [first, second] = report.results;
  assert.equal(first.status, "scored");
  assert.equal(first.stand_in, undefined);
  assert.deepEqual(first.metrics.gates, { passed: ["acting", "cast", "layout", "script"], failed: ["motion"], not_checked: ["face"], retake_rounds_before: null });
  assert.deepEqual(first.metrics.critic, { verdict: "ship", blocking: 0, major: 0, findings: 0, retake_rounds: null });
  assert.deepEqual(first.metrics.cost, { status: "ready", estimated_usd: 0.42, complete: true, seconds: 200 });
  assert.equal(first.metrics.contracts.script.repairs, 1);
  const status = Object.fromEntries(first.score.checks.map((check) => [check.id, check.status]));
  assert.deepEqual([status.gates, status.critic, status.characters, status.length], ["fail", "pass", "pass", "fail"]);
  assert.equal(second.status, "not-run");
  assert.match(second.reason, /no finished project at .*pov/);
  assert.equal((await readReport(path.join(runs, "out", "report.json"), "make")).path, "make");
  await assert.rejects(readReport(path.join(runs, "out", "report.json"), "skill"), /report for the make path, not for skill/);
});

test("animation scorecard: each brief's own expectations are checked", async () => {
  const { metrics } = await evaluateAnimationProject(brief("product-fix"), EXAMPLE, suite);
  const status = (id) => Object.fromEntries(scoreAnimation(brief(id), metrics, suite).checks.map((check) => [check.id, check.status]));
  // The two-character dialogue is not a silent story, a cast of one, or a trio.
  assert.deepEqual([status("silent").silent_share, status("silent").spoken_lines], ["fail", "fail"]);
  assert.deepEqual([status("pov").characters, status("pov").skeleton], ["fail", "warn"]);
  assert.deepEqual([status("trio").characters, status("trio").quietest_share], ["fail", "fail"]);
  assert.equal(status("argument").speaker_turns, "pass");
  assert.deepEqual(designMetrics({ cast: { characters: [{ id: "a", must_keep: ["headscarf"] }, { id: "b", must_keep: ["glasses"] }] } }), { characters: 2, with_must_keep: 2, must_keep_distinct: true });
  assert.equal(designMetrics({ cast: { characters: [{ id: "a", must_keep: ["glasses"] }, { id: "b", must_keep: ["glasses"] }] } }).must_keep_distinct, false);
  assert.equal(designMetrics(null), null);
});

test("animation parity: within 15%, the same gates and a verdict no worse", async () => {
  const runs = temporary();
  const { metrics: skill } = await evaluateAnimationProject(brief("product-fix"), finishedProject(path.join(runs, "skill")), suite);
  const { metrics: make } = await evaluateAnimationProject(brief("product-fix"), finishedProject(path.join(runs, "make")), suite);
  const same = compareAnimation(make, skill);
  assert.equal(same.parity, true);
  assert.deepEqual(same.outside, []);
  assert.equal(same.rows.length, ANIMATION_PARITY_METRICS.length);
  // 10% fewer turns is inside the line; 40% fewer is not.
  const turns = (factor) => ({ ...make, cadence: { ...make.cadence, measures: { ...make.cadence.measures, speaker_turns_per_min: make.cadence.measures.speaker_turns_per_min * factor } } });
  assert.equal(compareAnimation(turns(0.9), skill).parity, true);
  const far = compareAnimation(turns(0.6), skill);
  assert.deepEqual([far.parity, far.outside], [false, ["cadence.measures.speaker_turns_per_min"]]);
  // Fewer repair passes than the skill is not a miss; more is.
  const repairs = (count) => ({ ...make, contracts: { ...make.contracts, script: { ...make.contracts.script, repairs: count } } });
  assert.deepEqual([compareAnimation(repairs(0), skill).parity, compareAnimation(repairs(3), skill).outside], [true, ["contracts.script.repairs"]]);
  // Cost is shown and never decides parity.
  assert.equal(compareAnimation({ ...make, cost: { ...make.cost, estimated_usd: 9 } }, skill).parity, true);
  // A gate only one path passes, or a worse verdict, is not parity.
  assert.equal(compareAnimation({ ...make, gates: { ...make.gates, passed: ["cast"], failed: ["script"] } }, skill).gates.status, "differ");
  assert.equal(compareAnimation({ ...make, critic: { ...make.critic, verdict: "repair" } }, skill).parity, false);
  assert.equal(compareAnimation(make, { ...skill, critic: { ...skill.critic, verdict: "repair" } }).critic.status, "no-worse");
  // With no critic on one side nothing failed, and nothing is claimed.
  const unknown = compareAnimation({ ...make, critic: null }, skill);
  assert.deepEqual([unknown.parity, unknown.critic.status], [null, "unmeasured"]);
});

test("animation parity: the committed table is the not-yet-run table, and a run fills only what it measured", async () => {
  const missing = path.join(temporary(), "none.json");
  const empty = await runAnimationParity({ make: missing, skill: missing });
  assert.deepEqual([empty.ran, empty.parity], [0, false]);
  assert.equal(readFileSync("benchmarks/ANIMATION_PARITY.md", "utf8"), empty.markdown, "run npm run eval:animation-parity");
  assert.match(empty.markdown, /\*\*Status: NOT YET RUN\.\*\*/);
  assert.equal(empty.markdown.match(/\| not run \|$/gm).length, 6);
  assert.doesNotMatch(empty.markdown, /^\| [^|]+ \| [^|]*\d[^|]* \|/m, "no number in an unrun table's make column");

  const runs = temporary();
  finishedProject(path.join(runs, "make", "product-fix"));
  finishedProject(path.join(runs, "skill", "product-fix"), { verdict: "repair" });
  const reports = {};
  for (const route of ["make", "skill"]) {
    await runAnimationEval({ path: route, runs: path.join(runs, route), out: path.join(runs, "out", route) });
    reports[route] = path.join(runs, "out", route, "report.json");
  }
  const partial = await runAnimationParity({ ...reports, generated: "2026-11-10" });
  assert.deepEqual([partial.ran, partial.parity], [1, false], "one brief of six is not parity");
  assert.equal(partial.briefs[0].comparison.parity, true);
  assert.match(partial.markdown, /\*\*Status: PARTIAL: 1 of 6 briefs run on both paths\.\*\*/);
  assert.match(partial.markdown, /\| speaker turns per minute \| 14\.63 \| 14\.63 \| 0% \| yes \|/);
  assert.match(partial.markdown, /\| model cost \(USD\) \| 0\.42 \| 0\.42 \| 0% \| shown only \|/);
  assert.equal(partial.markdown.match(/^Not run: neither path/gm).length, 5);
  assert.equal(parityMarkdown({ briefs: suite.briefs, suite }), empty.markdown);
});
