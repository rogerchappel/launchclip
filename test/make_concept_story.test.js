// Concept and story before the script (docs/MAKE_SKILL_PARITY.md, phase 3).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateCinematicStory, validateConceptJudgment, validateConceptSet } from "../src/cinematic_contracts.js";
import { CONCEPT_PATHS, STORY_SPINE_SECONDS, conceptEvidence, conceptIntake, conceptsMode, storyOutlineSection, storyScriptSection, storySeconds } from "../src/make/concept_story.js";
import { runMake } from "../src/make/index.js";
import { makeOptionsFromFlags } from "../src/make/options.js";
import { CONCEPT_SCHEMAS, fakeConcepts, fakeJudgment, fakeStory, withConcepts } from "./helpers/concept_fakes.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const usage = { input_tokens: 3000, output_tokens: 900, total_tokens: 3900 };

test("the frozen concept answers are valid, so the stage's own validators run on them", () => {
  const concepts = fakeConcepts();
  assert.deepEqual(validateConceptSet(concepts, { candidateCount: 5, evidenceIds: ["brief"], resourceIds: [] }).errors, []);
  assert.deepEqual(validateConceptJudgment(fakeJudgment(), concepts).errors, []);
  const input = { format: { duration_seconds: 30, aspect: "16:9", width: 1920, height: 1080, language: "en" }, pacing: { target_word_minimum: 45, target_word_maximum: 82 }, selected_concept: concepts.candidates[1] };
  assert.deepEqual(validateCinematicStory(fakeStory(input), { conceptId: "concept-2", expectedDuration: 30, expectedFormat: { aspect: "16:9", width: 1920, height: 1080, language: "en" }, minimumWpm: 90, maximumWpm: 165, evidenceIds: ["brief"], claimEligibleEvidenceIds: ["brief"], resourceIds: [] }).errors, []);
});

test("the intake and evidence make gives the tournament: the brief and notes may be claimed from, the rules and files are context", () => {
  const intake = conceptIntake({ prompt: "A video", rules: "No superlatives.", format: { width: 1080, height: 1920 }, duration: 40, wpm: 200, model: { provider: "anthropic", model: "claude-opus-4-8", reasoning: "high" } });
  assert.equal(intake.profile.id, "cinematic");
  assert.equal(intake.profile.planning.concept_candidates, 5);
  assert.deepEqual(intake.profile.craft, { target_wpm_minimum: 120, target_wpm_maximum: 220 });
  assert.deepEqual(intake.brief.aspect, { id: "9:16", width: 1080, height: 1920 });
  assert.equal(intake.brief.rules, "No superlatives.");
  assert.deepEqual(intake.model, { provider: "anthropic", id: "claude-opus-4-8", reasoning_effort: "high", reasoning_mode: "standard" });
  const evidence = conceptEvidence({ prompt: "A video", notes: ["It shipped in May."], rules: "No superlatives.", assets: ["assets/ui.mp4 — video"] });
  assert.deepEqual(evidence.items.map((item) => [item.id, item.claims_allowed]), [["brief", true], ["note-1", true], ["rules", false], ["assets", false]]);
  assert.equal(conceptsMode(undefined), "on");
  assert.equal(conceptsMode("OFF"), "off");
  assert.throws(() => conceptsMode("maybe"), /--concepts must be on or off/);
  assert.equal(makeOptionsFromFlags({ concepts: "off" }).concepts, "off");
  assert.equal(storySeconds(45), 45);
  assert.equal(storySeconds(600, { longForm: true }), STORY_SPINE_SECONDS);
  assert.equal(storySeconds(200, { longForm: false }), 200);
});

test("the story reaches the script and the outline as its beats, in order", () => {
  const concept = fakeConcepts().candidates[1];
  const story = fakeStory({ format: { duration_seconds: 30, aspect: "16:9", width: 1920, height: 1080, language: "en" }, pacing: { target_word_minimum: 45, target_word_maximum: 82 }, selected_concept: concept });
  const script = storyScriptSection({ concept, story }).join("\n");
  assert.match(script, /^## Story \(five concepts were judged in a fresh context and this one won/);
  assert.match(script, /Hook: Payouts hide mismatch number 2\./);
  assert.ok(script.indexOf("- hook: Beat1") < script.indexOf("- proof: Beat4") && script.indexOf("- proof: Beat4") < script.indexOf("- payoff: Beat7"));
  assert.match(script, /Add no fact the story does not have\./);
  const outline = storyOutlineSection({ concept, story }).join("\n");
  assert.match(outline, /It is the video's spine in 30 seconds; derive the chapters from it/);
  assert.match(outline, /the chapters follow its turns in order/);
});

async function shortMake(t, { options = {}, wrap = (model) => model } = {}) {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-concepts-make-"));
  t.after(() => Promise.all([rm(assets, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  const seen = [];
  const fake = fakeModel();
  const model = wrap(withConcepts(fake.model, seen));
  const adapters = { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice() {} };
  const run = (extra = {}) => runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, out: "video", ...options, ...extra }, adapters);
  return { run, seen, project: path.join(cwd, "video") };
}

test("short form: five concepts are judged, the winner becomes a story, and the script is written on it", async (t) => {
  const { run, seen, project } = await shortMake(t);
  const report = await run();
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  // Four separate calls, in order, before the script; each sees only its own input.
  assert.deepEqual(seen.slice(0, 5).map((request) => request.schemaName), [...CONCEPT_SCHEMAS, "launchclip_make_script"]);
  const judge = JSON.parse(seen[1].input);
  assert.equal(judge.candidates.length, 5);
  assert.deepEqual(Object.keys(judge).sort(), ["audience", "candidates", "craft_profile", "factual_evidence", "format", "prompt"], "the judge sees the brief, the evidence and the candidates, nothing of how they were written");
  assert.equal(JSON.parse(seen[2].input).selected_concept.id, "concept-2", "the story is written for the top-scored concept");
  assert.equal(seen[0].model, undefined, "the stage runs on make's own model, not the production route's");
  const script = seen[4].input;
  assert.match(script, /## Story \(five concepts were judged/);
  assert.match(script, /Concept: The ledger that closes itself 2\./);
  assert.match(script, /- hook: Beat1/);
  assert.deepEqual(report.concept.selected, { id: "concept-2", title: "The ledger that closes itself 2", hook: "Payouts hide mismatch number 2.", engine: "transformation" });
  assert.equal(report.concept.status, "done");
  assert.equal(report.concept.candidates, 5);
  assert.equal(report.concept.story_beats, 8);
  assert.equal(report.concept.story_scores.hook, 9);
  assert.deepEqual(report.costs.items.slice(0, 5).map((item) => item.stage), ["concept-candidates", "concept-judge", "story-draft", "story-edit", "script"]);
  for (const file of [CONCEPT_PATHS.concepts, CONCEPT_PATHS.story]) assert.ok(existsSync(path.join(project, file)), file);
  const concepts = JSON.parse(await readFile(path.join(project, "CONCEPTS.json"), "utf8"));
  assert.equal(concepts.selected_id, "concept-2");
  assert.equal(concepts.candidates.length, 5);
  // The planner's brief carries the concept's world.
  const brief = await readFile(path.join(project, "BRIEF.md"), "utf8");
  assert.match(brief, /## Concept \(five were judged and this one won/);
  assert.match(brief, /Visual metaphor: A ledger that folds shut 2/);

  // A rerun reuses the concepts, the story and the script: no model call for any of them.
  const before = seen.length;
  const again = await run();
  assert.equal(again.concept.status, "reused");
  assert.equal(again.concept.selected.id, "concept-2");
  assert.ok(!seen.slice(before).some((request) => [...CONCEPT_SCHEMAS, "launchclip_make_script"].includes(request.schemaName)));
  assert.equal(again.script.reused, true);
});

test("--concepts off writes the script from the brief in one pass, as before", async (t) => {
  const { run, seen, project } = await shortMake(t, { options: { concepts: "off" } });
  const report = await run();
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.ok(!seen.some((request) => CONCEPT_SCHEMAS.includes(request.schemaName)));
  assert.deepEqual(report.concept, { status: "off", reason: "--concepts off" });
  assert.ok(!/## Story/.test(seen.find((request) => request.schemaName === "launchclip_make_script").input));
  assert.ok(!existsSync(path.join(project, "CONCEPTS.json")));
});

test("a concept stage that fails is a warning: the script is written from the brief and the calls made are costed", async (t) => {
  // The judge keeps recommending a concept that is not the top score, so its two attempts both fail validation.
  const wrap = (model) => ({ ...model, client: { ...model.client, async runStructured(request) {
    const result = await model.client.runStructured(request);
    return request.schemaName === "launchclip_cinematic_concept_judgment" ? { ...result, value: { ...result.value, recommended_id: "concept-5" } } : result;
  } } });
  const { run, seen } = await shortMake(t, { wrap });
  const report = await run();
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.equal(report.concept.status, "failed");
  assert.match(report.concept.reason, /concept-tournament failed semantic validation after 2 attempts/);
  assert.ok(report.warnings.some((warning) => /the concept and story stage failed .*; the script is written from the brief in one pass/.test(warning)));
  assert.deepEqual(report.costs.items.slice(0, 4).map((item) => item.stage), ["concept-candidates", "concept-judge", "concept-judge", "script"]);
  assert.ok(!/## Story/.test(seen.find((request) => request.schemaName === "launchclip_make_script").input));
  assert.ok(report.script.words > 0);
});

test("long form: the story is a spine of at most three minutes and the outline is derived from it", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-concepts-long-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const seen = [];
  const client = { provider: "openai", async runStructured(request) {
    if (request.schemaName === "launchclip_long_form_outline") return { model: "gpt-5.6-luna", usage, value: { title: "October in AI", title_options: ["October in AI"], chapters: [
      { title: "Cold open", point: "The hook", facts: ["Atlas 2 shipped October 6"], seconds: 60 },
      { title: "The proof", point: "What the scores mean", facts: ["81% on CodeBench"], seconds: 90 },
      { title: "The payoff", point: "What to watch", facts: [], seconds: 60 }
    ] } };
    if (request.schemaName === "launchclip_long_form_chapter") return { model: "gpt-5.6-luna", usage, value: { narration: Array.from({ length: 20 }, () => "Northwind shipped Atlas 2 on October 6.").join(" ") } };
    return { model: "gpt-5.6-luna", usage, value: { states: [] } };
  } };
  const model = withConcepts({ client, provider: "openai", model: "gpt-5.6-luna", spec: "openai:gpt-5.6-luna", vision: false }, seen);
  const finish = async (project) => {
    await mkdir(path.join(project, "renders"), { recursive: true });
    await writeFile(path.join(project, "renders/draft.mp4"), "video");
    return { status: "done", seconds: 1, stages: [], gates: {}, final: path.join(project, "renders/draft.mp4"), warnings: [] };
  };
  const joinVoice = async (files, out) => { await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, "wav"); return out; };
  const report = await runMake("The biggest AI stories of October", { duration: 420, voice: "test", music: "synth", cwd, out: "october", longFormVisuals: "rules" }, { env: {}, client: model, inventory: async (dir) => ({ schema_version: "launchclip.make-assets.v1", dir, entries: [] }), finish, joinVoice, notice() {} });
  assert.notEqual(report.status, "failed", JSON.stringify(report.stages));
  assert.deepEqual(seen.slice(0, 5).map((request) => request.schemaName), [...CONCEPT_SCHEMAS, "launchclip_long_form_outline"]);
  assert.equal(JSON.parse(seen[2].input).format.duration_seconds, 180, "a 7-minute video's story is a 3-minute spine");
  assert.equal(report.concept.story_seconds, 180);
  const outline = seen[4].input;
  assert.match(outline, /## Story \(five concepts were judged .* It is the video's spine in 180 seconds; derive the chapters from it\)/);
  assert.match(outline, /- payoff: Beat7/);
  assert.match(outline, /Do not add a chapter the story has no beat for\./);
  assert.equal(report.script.long_form.chapters.length, 3);
});
