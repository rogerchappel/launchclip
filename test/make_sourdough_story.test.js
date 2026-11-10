// The story stage of a one-prompt explainer, replayed from a real run
// (test/fixtures/make-sourdough: "A 30-second explainer on why sourdough needs
// a starter"). That run's stage failed twice and was abandoned. The fixtures
// are the run's own intake, evidence, winning concept and the two drafts the
// model returned, as recorded.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CINEMATIC_STORY_EDIT_VERSION, normalizeCinematicStory, storyStructureRules, validateCinematicStory } from "../src/cinematic_contracts.js";
import { CONCEPT_BUDGET_SECONDS, GENERAL_KNOWLEDGE_ID, conceptEvidence, planConceptStory } from "../src/make/concept_story.js";
import { writeRetentionStory } from "../src/retention_story.js";

const FIXTURES = new URL("./fixtures/make-sourdough/", import.meta.url);
const fixture = async (name) => JSON.parse(await readFile(new URL(name, FIXTURES), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const PROMPT = "A 30-second explainer on why sourdough needs a starter";

// The validation context the stage builds from an intake and its evidence.
function contextFor(intake, evidence, conceptId) {
  return {
    conceptId,
    expectedDuration: intake.brief.duration_seconds,
    expectedFormat: { aspect: intake.brief.aspect.id, width: intake.brief.aspect.width, height: intake.brief.aspect.height, language: intake.brief.language },
    minimumWpm: intake.profile.craft.target_wpm_minimum,
    maximumWpm: intake.profile.craft.target_wpm_maximum,
    requestedCta: null,
    suppliedTranscript: null,
    evidenceIds: evidence.items.map((entry) => entry.id),
    claimEligibleEvidenceIds: evidence.items.filter((entry) => entry.claims_allowed && entry.role !== "reference").map((entry) => entry.id),
    resourceIds: []
  };
}

// What a corrected draft looks like: the recorded first draft with the two things its errors named.
function corrected(draft) {
  const story = clone(draft);
  story.narration.beats.find((beat) => beat.id === "b3").role = "proof";
  story.narration.beats.find((beat) => beat.id === "b5").role = "escalation";
  for (const claim of story.claims) claim.evidence_ids = [GENERAL_KNOWLEDGE_ID];
  return story;
}

const edit = (story) => ({ schema_version: CINEMATIC_STORY_EDIT_VERSION, verdict: "ready", scores: { hook: 9, compression: 8, curiosity: 9, clarity: 9, proof: 8, payoff: 9, speakability: 8, visuality: 9 }, findings: [], story });

async function workspaceWith(evidence) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-sourdough-story-"));
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeFile(path.join(workspace, "production", "intake.json"), JSON.stringify({ ...(await fixture("intake.json")), workspace }));
  await writeFile(path.join(workspace, "production", "evidence.json"), JSON.stringify(evidence));
  await writeFile(path.join(workspace, "production", "concepts.json"), JSON.stringify(await fixture("concepts.json")));
  return workspace;
}

test("reproduced: with the prompt as the only evidence, both recorded drafts fail exactly as the run reported", async () => {
  const [intake, evidence, first, second] = await Promise.all([fixture("intake.json"), fixture("evidence.json"), fixture("story-draft-attempt-1.json"), fixture("story-draft-attempt-2.json")]);
  assert.deepEqual(evidence.items.map((item) => item.id), ["brief"], "the run's evidence was the one-line prompt");
  const context = contextFor(intake, evidence, "c2");
  // The first draft is a sound story: it states common knowledge, which nothing in the evidence lets it cite.
  assert.deepEqual(validateCinematicStory(first.candidate, context).errors, first.errors);
  assert.deepEqual(first.errors.filter((error) => /requires evidence_ids/.test(error)).length, 3);
  // Told to cite evidence that does not exist, the repair is a refusal written as narration: every structure rule fails at once.
  assert.match(second.candidate.narration.full_text, /cannot be completed from the supplied evidence/);
  assert.equal(second.candidate.narration.beats.length, 1);
  assert.deepEqual(validateCinematicStory(second.candidate, context).errors, second.errors);
  assert.equal(second.errors.length, 8);
});

test("the cause is fixed at the evidence: make lets the story cite general knowledge of the subject, never a specific", async () => {
  const evidence = conceptEvidence({ prompt: PROMPT });
  assert.deepEqual(evidence.items.map((item) => [item.id, item.claims_allowed]), [["brief", true], [GENERAL_KNOWLEDGE_ID, true]]);
  const general = evidence.items.find((item) => item.id === GENERAL_KNOWLEDGE_ID);
  assert.match(general.content, /how it works/);
  assert.match(general.content, /It does not cover specifics: a figure, a date, a price, a named person, product, study or source, a quote/);
  // The recorded first draft, its claims citing that item, has one error left: the role the writer was never told it needed.
  const [intake, first] = await Promise.all([fixture("intake.json"), fixture("story-draft-attempt-1.json")]);
  const cited = clone(first.candidate);
  for (const claim of cited.claims) claim.evidence_ids = [GENERAL_KNOWLEDGE_ID];
  assert.deepEqual(validateCinematicStory(cited, contextFor(intake, evidence, "c2")).errors, ["stories of 20 seconds or longer require escalation"]);
});

test("the writer is told the structure the checker holds it to, in the checker's own terms", () => {
  const rules = storyStructureRules(30).join("\n");
  for (const wanted of [/The first beat has role "hook"/, /role "proof"/, /role "payoff"/, /role "rehook"/, /role "escalation"/, /At least six beats/, /the last ends at 30/]) assert.match(rules, wanted);
  const short = storyStructureRules(15).join("\n");
  assert.doesNotMatch(short, /midpoint|At least one beat has role "escalation"|six beats/, "a 15-second story is not held to the long rules, so it is not told them");
});

test("replayed: the recorded first draft is repaired with its exact errors and the stage succeeds", async (t) => {
  const first = await fixture("story-draft-attempt-1.json");
  const workspace = await workspaceWith(conceptEvidence({ prompt: PROMPT }));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const calls = [];
  const client = { runStructured: async (request) => {
    const input = JSON.parse(request.input);
    calls.push({ job: request.metadata.job_id, input, instructions: request.instructions });
    const drafts = calls.filter((call) => call.job === "retention-story-draft").length;
    const value = request.metadata.job_id === "retention-story" ? edit(input.draft_story) : drafts === 1 ? clone(first.candidate) : corrected(first.candidate);
    return { response_id: `r${calls.length}`, model: "recorded", status: "completed", value, usage: {} };
  } };
  const result = await writeRetentionStory(workspace, { background: false }, { client });
  assert.equal(result.status, "ready");
  assert.deepEqual(calls.map((call) => call.job), ["retention-story-draft", "retention-story-draft", "retention-story"]);
  // The first request already carries the rules and the evidence a claim may cite.
  assert.ok(calls[0].input.structure_requirements.some((line) => /role "escalation"/.test(line)));
  assert.ok(calls[0].input.factual_evidence.some((item) => item.id === GENERAL_KNOWLEDGE_ID));
  assert.match(calls[0].instructions, /never write a note about missing sources, a request for more evidence or a refusal as narration/);
  // The repair is handed the draft and each failure, word for word.
  assert.deepEqual(calls[1].input.validation_errors_to_repair, first.errors);
  assert.equal(calls[1].input.prior_attempt.narration.beats.length, 7);
  assert.ok(calls[2].input.structure_requirements.length > 0, "the editor is held to the same structure");
  const story = JSON.parse(await readFile(result.story, "utf8"));
  assert.deepEqual(story.narration.beats.map((beat) => beat.role), ["hook", "promise", "proof", "rehook", "escalation", "payoff", "closing_reframe"]);
});

test("bookkeeping never costs a retry: tooling derives what a story repeats from its own beats", async (t) => {
  const [intake, first] = await Promise.all([fixture("intake.json"), fixture("story-draft-attempt-1.json")]);
  const evidence = conceptEvidence({ prompt: PROMPT });
  const context = contextFor(intake, evidence, "c2");
  const sloppy = corrected(first.candidate);
  sloppy.narration.target_wpm = 150;
  sloppy.narration.full_text = "A summary that is not the beats.";
  sloppy.narration.beats[2].target_start_seconds = 9;
  sloppy.narration.beats.at(-1).target_end_seconds = 29;
  sloppy.open_loop.midpoint_rehook_beat_id = null;
  sloppy.open_loop.resolved_by_beat_id = "unresolved";
  sloppy.format.aspect = "9:16";
  assert.ok(validateCinematicStory(sloppy, context).errors.length >= 5);
  const tidy = normalizeCinematicStory(sloppy, context);
  assert.deepEqual(validateCinematicStory(tidy, context).errors, []);
  assert.deepEqual(tidy.narration.beats.map((beat) => beat.spoken_text), sloppy.narration.beats.map((beat) => beat.spoken_text), "no word is changed");
  assert.deepEqual(tidy.claims, sloppy.claims, "claims and their evidence are never touched");
  assert.equal(tidy.open_loop.midpoint_rehook_beat_id, "b4");
  assert.equal(tidy.open_loop.resolved_by_beat_id, "b6");
  // The recorded refusal stays a failure: nothing here invents a story.
  const second = await fixture("story-draft-attempt-2.json");
  assert.ok(validateCinematicStory(normalizeCinematicStory(second.candidate, context), context).errors.length >= 5);
  // And through the stage: one writer call, not two.
  const workspace = await workspaceWith(evidence);
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const jobs = [];
  const client = { runStructured: async (request) => {
    jobs.push(request.metadata.job_id);
    const input = JSON.parse(request.input);
    return { response_id: `n${jobs.length}`, model: "recorded", status: "completed", value: request.metadata.job_id === "retention-story" ? edit(input.draft_story) : clone(sloppy), usage: {} };
  } };
  await writeRetentionStory(workspace, { background: false }, { client });
  assert.deepEqual(jobs, ["retention-story-draft", "retention-story"]);
});

test("a stage that is going wrong stops at its budget: no call starts after it", async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-sourdough-budget-"));
  t.after(() => rm(project, { recursive: true, force: true }));
  assert.equal(CONCEPT_BUDGET_SECONDS, 300);
  let clock = 0;
  const started = [];
  const client = { provider: "openai", runStructured: async (request) => { started.push(request.schemaName); return { value: {}, usage: {} }; } };
  // Stand-ins for the two stages: each makes one call through the stage's client, and the first takes six minutes.
  const adapters = {
    now: () => clock,
    planConceptTournament: async (_workspace, _options, stage) => { await stage.client.runStructured({ schemaName: "launchclip_cinematic_concept_set" }); clock += 360_000; },
    writeRetentionStory: async (_workspace, _options, stage) => { await stage.client.runStructured({ schemaName: "launchclip_cinematic_story" }); }
  };
  await assert.rejects(
    planConceptStory({ project, client, prompt: PROMPT, format: { width: 1080, height: 1920 }, duration: 30, wpm: 150 }, adapters),
    (error) => /passed its 300 s budget before story-draft \(360 s in\)/.test(error.message) && error.calls.length === 1
  );
  assert.deepEqual(started, ["launchclip_cinematic_concept_set"], "the story call was never sent");
});
