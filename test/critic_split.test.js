// VIDEO_TELLS_RFC §4: the critic judges blind, then checks the tooling; recapture; the verdict pass; keep.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CRITIC_CATEGORIES, MAKE_CRITIC_SCHEMA, runHeadlessCritic } from "../src/make/critic.js";
import { criticBriefSection, criticImproved, criticKeepLines, criticRepairRoute } from "../src/make/critic_repair.js";

async function sheetProject(t, { missingSheet = false, story = null } = {}) {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-critic-split-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(path.join(project, "qa/temporal-evidence"), { recursive: true });
  await mkdir(path.join(project, "qa/critic-sheets"), { recursive: true });
  const entries = [0.5, 6].flatMap((at, i) => ["browser-still", "encoded-draft"].map((source) => ({ evidence_id: `s${i}-${source}`, sample_id: `s${i}`, source, at_seconds: at })));
  await writeFile(path.join(project, "qa/temporal-evidence/manifest.json"), JSON.stringify({ entries }));
  const sheets = [{ sheet: "sheet-01.jpg", samples: ["s0", "s1"] }, ...(missingSheet ? [{ sheet: "sheet-02.jpg", samples: ["s9"] }] : [])];
  await writeFile(path.join(project, "qa/critic-sheets/index.json"), JSON.stringify({ sheets }));
  await writeFile(path.join(project, "qa/critic-sheets/sheet-01.jpg"), "jpg");
  if (story) await writeFile(path.join(project, "storyboard.json"), JSON.stringify(story));
  return project;
}

// Answers by schema name; records every request.
function client(answers) {
  const requests = [];
  const queues = Object.fromEntries(Object.entries(answers).map(([name, list]) => [name, [...list]]));
  return { requests, provider: "openai", async runStructured(request) {
    requests.push(request);
    const next = queues[request.schemaName]?.shift();
    if (!next) throw new Error(`unexpected ${request.schemaName}`);
    return { model: "stand-in", value: next, usage: { input_tokens: 10, output_tokens: 5 } };
  } };
}
const major = (id, extra = {}) => ({ id, severity: "major", category: "typography", message: `${id} headline too small`, evidence_ids: ["s0"], ...extra });

test("pass A answers the template question first, reads the direction, and names what to keep; with no tooling findings it is one call", async (t) => {
  assert.equal(Object.keys(MAKE_CRITIC_SCHEMA.properties)[0], "template");
  assert.ok(MAKE_CRITIC_SCHEMA.properties.verdict.enum.includes("recapture"));
  assert.ok(CRITIC_CATEGORIES.includes("specificity"));
  const project = await sheetProject(t, { story: { direction: { product: "a ledger app", character: "exact, warm" }, motion: { thesis: { focal: "the match tick" } } } });
  const model = client({ launchclip_make_critic: [{ template: { swappable: true, why: "any SaaS fits" }, verdict: "repair", summary: "", findings: [major("f1", { category: "specificity" })], keep: ["the tick on s1", " "] }] });
  const result = await runHeadlessCritic({ project, client: model });
  assert.equal(model.requests.length, 1);
  assert.match(model.requests[0].instructions, /First, the template question/);
  assert.match(model.requests[0].input, /The art direction[^\n]*\n {2}\{"product":"a ledger app"/);
  assert.match(model.requests[0].input, /The motion thesis:\n {2}\{"focal":"the match tick"\}/);
  const critique = JSON.parse(await readFile(result.file, "utf8"));
  assert.deepEqual(critique.template, { swappable: true, why: "any SaaS fits" });
  assert.deepEqual(critique.keep, ["the tick on s1"]);
  assert.deepEqual(result.keep, ["the tick on s1"]);
  assert.equal(critique.reviewer.pass, "judge");
  assert.equal(critique.tooling_checks, undefined);
});

test("pass B marks each tooling finding agree or false-positive; unanswered ones stay unchecked; quality findings still count", async (t) => {
  const project = await sheetProject(t);
  const model = client({
    launchclip_make_critic: [{ template: { swappable: false, why: "" }, verdict: "ship", summary: "", findings: [], keep: [] }],
    launchclip_make_critic_check: [{ checks: [{ id: "q1", check: "agree", note: "empty" }, { id: "t1", check: "false-positive", note: "accent is on one chip" }] }]
  });
  const quality = [{ category: "sparseness", severity: "major", at: 6, message: "8 s with no graphic" }];
  const tells = [{ rule: "accent-everywhere", severity: "warning", at: 0.5, detail: "accent on 14% of the frame" }, { rule: "hero-missing", severity: "warning", at: 0, detail: "s1 has no hero" }];
  const result = await runHeadlessCritic({ project, client: model, quality, tells });
  assert.doesNotMatch(model.requests[0].input, /sparseness|accent-everywhere/, "pass A never sees the tooling");
  assert.match(model.requests[1].input, /Your findings:\n {2}none/);
  assert.match(model.requests[1].input, /t2 {2}hero-missing \(warning\) at 0 s/);
  const critique = JSON.parse(await readFile(result.file, "utf8"));
  assert.deepEqual(critique.tooling_checks.map((check) => [check.id, check.source, check.check]), [["q1", "coverage", "agree"], ["t1", "tells", "false-positive"], ["t2", "tells", "unchecked"]]);
  assert.equal(critique.verdict, "repair", "the measured major finding still forbids ship");
});

test("pass B failing leaves the tooling findings unchecked and the review written", async (t) => {
  const project = await sheetProject(t);
  const model = client({ launchclip_make_critic: [{ verdict: "ship", summary: "", findings: [] }] });
  const result = await runHeadlessCritic({ project, client: model, tells: [{ rule: "hero-missing", severity: "warning", at: 0, detail: "x" }] });
  assert.equal(result.status, "written");
  assert.equal(result.verdict, "ship");
  assert.ok(result.warnings.some((warning) => /pass B\) failed/.test(warning)));
  assert.equal(result.critique.tooling_checks[0].check, "unchecked");
});

test("recapture: the critic can ask for it, and a partial set of sheets never ships", async (t) => {
  const asked = await sheetProject(t);
  const said = await runHeadlessCritic({ project: asked, client: client({ launchclip_make_critic: [{ verdict: "recapture", summary: "half the tiles are blank", findings: [] }] }) });
  assert.equal(said.verdict, "recapture");
  const partial = await sheetProject(t, { missingSheet: true });
  const result = await runHeadlessCritic({ project: partial, client: client({ launchclip_make_critic: [{ verdict: "ship", summary: "", findings: [] }] }) });
  assert.equal(result.verdict, "recapture");
  assert.deepEqual(result.critique.missing_evidence, ["sheet sheet-02.jpg is not on disk"]);
});

test("the verdict pass scores the prior blocking and major findings, keeps at most three regressions and forbids ship on partial", async (t) => {
  const prior = { verdict: "repair", findings: [major("f1"), major("f2"), { ...major("f3"), severity: "minor" }], keep: ["the tick"] };
  const project = await sheetProject(t);
  const regression = (id) => ({ id, severity: "minor", category: "motion", message: `${id} new jitter`, evidence_ids: ["s1"] });
  const model = client({ launchclip_make_critic_verdict: [{ summary: "better", scores: [{ id: "f1", status: "resolved", evidence_ids: ["s0"], note: "" }, { id: "f2", status: "partial", evidence_ids: ["s1"], note: "still small on s1" }], regressions: ["r1", "r2", "r3", "r4"].map(regression), keep: [] }] });
  const result = await runHeadlessCritic({ project, client: model, prior });
  assert.equal(model.requests.length, 1);
  assert.equal(model.requests[0].schemaName, "launchclip_make_critic_verdict");
  assert.match(model.requests[0].input, /f1 {2}major typography/);
  assert.doesNotMatch(model.requests[0].input, /f3/, "a minor finding is not scored");
  const critique = result.critique;
  assert.equal(critique.verdict, "repair");
  assert.deepEqual(critique.findings.map((finding) => [finding.id, finding.status ?? null, finding.regression ?? false]), [["f2", "partial", false], ["r1", null, true], ["r2", null, true], ["r3", null, true]]);
  assert.deepEqual(critique.findings[0].evidence_ids, ["s1-browser-still", "s1-encoded-draft"]);
  assert.deepEqual(critique.verdict_pass.scores.map((score) => score.status), ["resolved", "partial"]);
  assert.equal(critique.reviewer.pass, "verdict");

  const clean = client({ launchclip_make_critic_verdict: [{ summary: "", scores: [{ id: "f1", status: "resolved", evidence_ids: [], note: "" }], regressions: [], keep: [] }] });
  const missed = await runHeadlessCritic({ project, client: clean, prior });
  assert.equal(missed.verdict, "repair", "an unscored finding counts as unresolved");
  assert.equal(missed.critique.findings[0].status, "unresolved");
  assert.deepEqual(missed.keep, [], "the answer's own keep list wins");

  const all = client({ launchclip_make_critic_verdict: [{ summary: "", scores: ["f1", "f2"].map((id) => ({ id, status: "resolved", evidence_ids: [], note: "" })), regressions: [] }] });
  const shipped = await runHeadlessCritic({ project, client: all, prior });
  assert.equal(shipped.verdict, "ship");
  assert.deepEqual(shipped.keep, ["the tick"], "with no keep answer the prior's carries over");
});

test("the round logic for recapture and keep", () => {
  assert.equal(criticRepairRoute({ verdict: "recapture" }, [], "s1"), "recapture");
  assert.equal(criticImproved({ verdict: "recapture", blocking: 0, major: 0 }, { verdict: "repair", blocking: 0, major: 2 }), true, "a judged cut beats one that could not be judged");
  assert.equal(criticImproved({ verdict: "repair", blocking: 0, major: 2 }, { verdict: "recapture", blocking: 0, major: 0 }), false);
  assert.deepEqual(criticKeepLines(["the tick", ""]), ["keep (it works; do not lose it): the tick"]);
  assert.match(criticBriefSection(["critic (major typography): small"], ["the tick"]), /Keep these, they work:\n\n- the tick/);
  assert.doesNotMatch(criticBriefSection(["x"]), /Keep these/);
});
