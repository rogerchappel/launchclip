// Beat-director builders for the code-evidence modules
// (kit/core/capability-builders-code.mjs): evidence.data from
// src/evidence/github.js passes through with the clause's token boxed and
// timed, every output resolves in 16:9 and 9:16, and no data means no params.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capabilityParams, isPlanned } from "../kit/core/visual-capabilities.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { commitCardParams, diffViewParams, prCardParams, sourceParams } from "../src/evidence/github.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/github/${name}`, import.meta.url), "utf8")).data;
const commit = fixture("github-rogerchappel-launchclip-commit-c3ec4a11.json");
const pull = { pull: fixture("github-rogerchappel-launchclip-pull-82.json"), files: fixture("github-rogerchappel-launchclip-pull-82-files.json") };
const PR = { module: "repo-pr-card", params: prCardParams(pull, { token: "openrouter/free" }) };
const COMMIT = { module: "commit-card", params: commitCardParams(commit, { token: "gpt-5.5", repo: "rogerchappel/launchclip" }) };
const DIFF = { module: "diff-view", params: diffViewParams(commit.files, { token: "gpt-5.5" }) };
const BRAND = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };

const beat = (text, data, extra = {}) => ({ id: "b1", text, headline: "Receipt", start: 10, end: 16, facts: { numbers: [], items: [], dates: [] }, evidence: { claim: "c1", status: "verified", source: { url: "https://github.com/rogerchappel/launchclip" }, ...(data ? { data } : {}) }, ...extra });

function resolves(module, params) {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const scene = { id: "s", module, start: 0, end: 6, params };
    const story = { schema: "launchclip.story.v1", lane: "motion", format: { width, height, fps: 30, duration: 6 }, brand: BRAND, scenes: [scene], resolved: { duration: 6, fps: 30 } };
    assert.doesNotThrow(() => resolveModule(scene, story), `${module} at ${width}x${height}`);
  }
}

test("code builders: every code-evidence module has a builder now", () => {
  for (const id of ["repo-pr-card", "commit-card", "diff-view", "evidence-chain", "date-pinned-timeline", "terminal-session"]) assert.equal(isPlanned(id), false, id);
});

test("code builders: no evidence.data, no params (nothing is typed from narration)", () => {
  const said = beat("They merged pull request 82 in rogerchappel/launchclip and the diff swaps gpt-5.5 in", null);
  for (const id of ["repo-pr-card", "commit-card", "diff-view", "evidence-chain", "date-pinned-timeline", "terminal-session"]) assert.equal(capabilityParams(id, said), null, id);
  // Data meant for another module is not borrowed.
  assert.equal(capabilityParams("repo-pr-card", beat("x", COMMIT)), null);
  assert.equal(capabilityParams("commit-card", beat("x", PR)), null);
});

test("code builders: a PR passes through, the clause's token boxed on its word", () => {
  const params = capabilityParams("repo-pr-card", beat("Two days later the free router shows up in the provider code", PR));
  assert.equal(params.number, 82);
  assert.deepEqual(params.lines, PR.params.lines, "lines verbatim");
  assert.equal(params.highlight, "openrouter/free", "\"free\" names the mapped token");
  assert.ok(params.highlightAt > 1.5 && params.highlightAt < 6 - 0.75, `timed to the word: ${params.highlightAt}`);
  resolves("repo-pr-card", params);
  // The raw mapping (params alone) works too; an early word keeps the module's default timing.
  const early = capabilityParams("repo-pr-card", beat("Free routing, merged in July", PR.params));
  assert.equal(early.highlight, "openrouter/free");
  assert.equal(early.highlightAt, undefined);
});

test("code builders: a commit card and its diff, the focus stepping to the token's row", () => {
  const said = "The default flipped from o4-mini to gpt-5.5 in one line";
  const card = capabilityParams("commit-card", beat(said, COMMIT));
  assert.equal(card.sha, COMMIT.params.sha);
  assert.equal(card.highlight, "gpt-5.5");
  resolves("commit-card", card);
  const diff = capabilityParams("diff-view", beat(said, DIFF));
  const row = diff.lines.findIndex((line) => line.startsWith("+") && line.includes("gpt-5.5"));
  assert.ok(diff.focus.some((f) => f.row === row || (f.rows && f.rows[0] <= row && row <= f.rows[1])), JSON.stringify(diff.focus));
  resolves("diff-view", diff);
  // A commit's mapping can feed the diff too.
  resolves("diff-view", capabilityParams("diff-view", beat("o4-mini goes", COMMIT)));
});

test("code builders: an evidence chain trims each source round the shared token", () => {
  const data = { token: "openrouter/free", sources: [{ module: "source", params: sourceParams("pr", PR.params, { lines: 6 }) }, { module: "repo-pr-card", params: { ...PR.params, number: 83 } }, { kind: "excerpt", file: "docs/guide/advanced.md", lines: ["  --critic-route openrouter:openrouter/free@none \\", "  --repair-route openrouter:openrouter/free@none"], startLine: 333 }] };
  const params = capabilityParams("evidence-chain", beat("The same free router appears in three places", data));
  assert.equal(params.sources.length, 3);
  assert.ok(params.sources.every((s) => s.highlight === "openrouter/free" && s.lines.length <= 2));
  resolves("evidence-chain", params);
  // Sources without the token drop out; fewer than two is no chain.
  assert.equal(capabilityParams("evidence-chain", beat("x", { token: "gpt-9", sources: data.sources })), null);
});

test("code builders: dated sources on a day axis, or the why-now summary", () => {
  const cards = [{ date: "2026-07-16", label: "Free repairs", module: "source", params: sourceParams("pr", PR.params, { lines: 4 }) }, { date: "2026-05-01", label: "Default model", module: "commit-card", params: COMMIT.params }];
  const axis = capabilityParams("date-pinned-timeline", beat("It started in June and spread by July", { cards: [cards[0], { ...cards[0], date: "2026-07-18", label: "Again" }] }));
  assert.deepEqual([axis.from, axis.to], ["2026-07-15", "2026-07-19"]);
  assert.ok(axis.cards.every((c) => c.lines.length <= 2));
  resolves("date-pinned-timeline", axis);
  // Sorted by date; a span past 45 days does not fit the axis.
  assert.equal(capabilityParams("date-pinned-timeline", beat("x", { cards })), null);
  const summary = capabilityParams("date-pinned-timeline", beat("So why now? Two clues in three days", { cards: [cards[0], { ...cards[0], date: "2026-07-17", label: "Again" }] }));
  assert.equal(summary.variant, "summary");
  resolves("date-pinned-timeline", summary);
});

test("code builders: a recorded terminal session, its token boxed", () => {
  const data = { title: "launchclip — zsh", steps: [{ cmd: "git show --stat c3ec4a11 --format=%s", output: ["direct: default OpenAI model to gpt-5.5"] }, { cmd: "npm test", output: [{ status: "PASS", time: "9.0 ms", text: "parseGithubRef" }] }], timer: { to: 220 } };
  const params = capabilityParams("terminal-session", beat("Run git show on c3ec4a11 and the suite passes", data));
  assert.equal(params.highlight, "c3ec4a11");
  assert.equal(params.steps.length, 2);
  resolves("terminal-session", params);
  assert.equal(capabilityParams("terminal-session", beat("x", { steps: [{ output: ["no command"] }] })), null);
});
