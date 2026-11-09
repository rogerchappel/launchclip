import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { FIXTURE_PAIR, measureProject, parseArguments, runParity } from "../eval/make-parity.mjs";
import { compareProjects, criticMetrics, formatComparison, inferFormat, scriptMetrics, storyMetrics } from "../eval/make-parity-metrics.mjs";

const story = (scenes, format = { width: 1920, height: 1080, duration: 30 }) => ({ format, scenes });
const scene = (id, module, start, end, params = {}, extra = {}) => ({ id, module, start, end, params, ...extra });

test("make parity: story metrics count modules, typography, cuts, events and cards", () => {
  const metrics = storyMetrics(story([
    scene("a", "motion-title", 0, 4, { title: "One" }),
    scene("b", "concept-card", 4, 8, { title: "Two" }),
    scene("c", "concept-card", 8, 12, { title: "Two" }),
    scene("d", "bar-chart", 12, 30, {}, { states: [{ at: 16 }, { at: 20 }] }),
    scene("e", "callout", 14, 18, { title: "Over" }, { track: 1 })
  ]));
  assert.equal(metrics.modules.distinct, 4);
  assert.equal(metrics.modules.per_min, 8);
  assert.equal(metrics.typography.share, 0.6);
  // Three new base scenes after the first in half a minute; the overlay and the two states are events too.
  assert.equal(metrics.cadence.cuts_per_min, 6);
  assert.equal(metrics.cadence.events_per_min, 12);
  assert.equal(metrics.cadence.format, "motion-graphics");
  assert.deepEqual(metrics.cards.repeated_ids, ["c"]);
  assert.equal(metrics.cards.longest_same_module_run, 2);
  // The chart is long but has states of its own, so it is not a held card.
  assert.equal(metrics.cards.held, 0);
  const held = storyMetrics(story([scene("a", "motion-title", 0, 20), scene("b", "bar-chart", 20, 30)]));
  assert.deepEqual(held.cards.held_ids, ["a", "b"]);
});

test("make parity: the cadence format follows the video unless one is named", () => {
  assert.equal(inferFormat(story([], { width: 1080, height: 1920, duration: 40 })), "short-form");
  assert.equal(inferFormat(story([], { width: 1920, height: 1080, duration: 300 })), "long-form");
  assert.equal(storyMetrics(story([scene("a", "callout", 0, 30)]), { format: "long-form" }).cadence.format, "long-form");
  assert.throws(() => storyMetrics({ scenes: [] }), /no duration/);
});

test("make parity: script metrics find hedging, meta-narration and repeated facts", () => {
  const metrics = scriptMetrics("In this video we cover one of four stories. The tool might be faster in some cases. It raised 40 million dollars. Next up, pricing. The company raised 40 million dollars last week. Version 4.5 ships today.");
  assert.equal(metrics.hedging.count, 2);
  assert.deepEqual(metrics.meta_narration.phrases, ["in this video", "one of four stories", "next up"]);
  assert.equal(metrics.repeated_facts.count, 1);
  assert.equal(metrics.repeated_facts.facts[0].fact, "40million");
  assert.equal(metrics.sentences, 6);
  const firm = scriptMetrics("Builds that took nine minutes now take four. The free plan keeps every feature.");
  assert.equal(firm.hedging.count + firm.meta_narration.count + firm.repeated_facts.count, 0);
  assert.equal(scriptMetrics("").hedging.per_100_words, null);
  const said = scriptMetrics("The free plan keeps every single feature you use. Honestly the free plan keeps every single feature you use.");
  assert.equal(said.repeated_facts.facts[0].kind, "sentence");
});

test("make parity: critic metrics read the verdict and the blocking findings", () => {
  assert.deepEqual(criticMetrics(null), { verdict: null, blocking: null, major: null, findings: null, blocking_findings: [] });
  const metrics = criticMetrics({ verdict: "repair", findings: [{ severity: "blocking", message: " Empty frame. " }, { severity: "major" }, { severity: "minor" }] });
  assert.deepEqual([metrics.verdict, metrics.blocking, metrics.major, metrics.findings], ["repair", 1, 1, 3]);
  assert.deepEqual(metrics.blocking_findings, ["Empty frame."]);
});

test("make parity: the fixture pair is measured offline and make is not at parity", async () => {
  const result = await runParity(FIXTURE_PAIR);
  assert.equal(result.comparison.parity, false);
  assert.equal(result.make.story.typography.share > 0.8, true);
  assert.equal(result.skill.story.typography.share <= 0.3, true);
  assert.equal(result.skill.critic.verdict, "ship");
  assert.equal(result.comparison.typography.ok, false);
  for (const id of ["modules_per_min", "typography_share", "hedging", "meta_narration", "repeated_facts", "critic_verdict", "typography_limit"]) assert.ok(result.comparison.misses.includes(id), id);
  const table = formatComparison(result.comparison, { make: "make", skill: "skill" });
  assert.match(table, /NOT AT PARITY/);
  assert.match(table, /MISS typography share/);
  // The skill's cut against itself is at parity.
  const same = await runParity({ make: FIXTURE_PAIR.skill, skill: FIXTURE_PAIR.skill, kind: "news" });
  assert.equal(same.comparison.parity, true);
  assert.match(formatComparison(same.comparison), /AT PARITY/);
});

test("make parity: within 15% or on the better side passes; a missing critique does not count", async () => {
  const skill = await measureProject(FIXTURE_PAIR.skill);
  const near = structuredClone(skill);
  near.story.modules.per_min = skill.story.modules.per_min * 0.9;
  near.story.cadence.events_per_min = skill.story.cadence.events_per_min * 1.1;
  near.script.hedging.per_100_words = 0;
  near.critic = criticMetrics(null);
  const comparison = compareProjects(near, skill, { kind: "product" });
  assert.equal(comparison.parity, true);
  assert.equal(comparison.critic.ok, null);
  assert.equal(comparison.unanswered > 0, true);
  assert.equal(comparison.typography.limit, null);
  const far = structuredClone(skill);
  far.story.cadence.events_per_min = skill.story.cadence.events_per_min * 1.3;
  far.story.modules.per_min = skill.story.modules.per_min * 2;
  assert.deepEqual(compareProjects(far, skill).misses, ["events_per_min"]);
});

test("make parity: the CLI prints the comparison and --strict sets the exit code", () => {
  const out = execFileSync(process.execPath, ["eval/make-parity.mjs"], { encoding: "utf8" });
  assert.match(out, /make-vs-skill parity: NOT AT PARITY/);
  assert.match(out, /visual events per minute/);
  assert.equal(spawnSync(process.execPath, ["eval/make-parity.mjs", "--strict"]).status, 1);
  const json = JSON.parse(execFileSync(process.execPath, ["eval/make-parity.mjs", FIXTURE_PAIR.skill, FIXTURE_PAIR.skill, "--json", "--strict"], { encoding: "utf8" }));
  assert.equal(json.comparison.parity, true);
  assert.deepEqual(parseArguments(["a", "b", "--kind", "news", "--format", "long-form"]), { projects: ["a", "b"], kind: "news", format: "long-form", json: false, strict: false });
  assert.throws(() => parseArguments(["--kind", "gossip"]), /--kind must be one of/);
  assert.throws(() => parseArguments(["a", "b", "c"]), /one project/);
});
