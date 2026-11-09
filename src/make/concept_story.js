// Concept and story before the script (docs/MAKE_SKILL_PARITY.md, phase 3).
//
// The create-video skill does not write a script from the brief in one pass:
// it drafts five concepts, has them judged in a fresh context, writes the
// winner as a story and has an editor tighten it for retention; only then is
// the script written. make does the same with the modules `produce` already
// has: src/concept_tournament.js (five candidates, then a judge that sees
// only the brief, the evidence and the candidates) and src/retention_story.js
// (a writer, then a fresh-context editor with score floors).
//
// Those modules read a production workspace, so make keeps a small one inside
// the project (.launchclip/make/concept: intake.json and evidence.json built
// from the prompt, the notes and the rules) and copies the results out as
// CONCEPTS.json and STORY.json, the files the skill writes. Each of the four
// model calls is a separate call with its own instructions and only its own
// input, which is what "a fresh context" means headless.
//
// A long video's story is a spine of at most STORY_SPINE_SECONDS: the outline
// is derived from its beats, and the chapters are still written one at a time.
//
// A stage that fails (a model that cannot return the structure, or a story
// under the editor's floors after its repair attempt) never fails the video:
// make says so and writes the script from the brief, as before.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { planConceptTournament } from "../concept_tournament.js";
import { PRODUCTION_PATHS } from "../production_contracts.js";
import { writeRetentionStory } from "../retention_story.js";

export const CONCEPT_PATHS = Object.freeze({ workspace: ".launchclip/make/concept", concepts: "CONCEPTS.json", story: "STORY.json" });
export const CONCEPT_CANDIDATES = 5;
// A long video's story is written as a spine this long at most; the outline expands it.
export const STORY_SPINE_SECONDS = 180;
// The story may run this far under and over the script plan's pace (the length is a ceiling, so the floor is low).
const WPM_FLOOR = 0.6;
const WPM_CEILING = 1.1;
// The schema name of each call, as a cost stage.
const COST_STAGES = Object.freeze({ launchclip_cinematic_concept_set: "concept-candidates", launchclip_cinematic_concept_judgment: "concept-judge", launchclip_cinematic_story: "story-draft", launchclip_cinematic_story_edit: "story-edit" });

/** --concepts: "on" (default: concept and story before the script) or "off" (one script pass from the brief). */
export function conceptsMode(value) {
  if (value === undefined || value === null || value === "" || value === true) return "on";
  const mode = String(value).toLowerCase();
  if (!["on", "off"].includes(mode)) throw new Error(`--concepts must be on or off; got ${value}`);
  return mode;
}

/** The seconds the story is written for: the video's, or the spine of a long one. */
export function storySeconds(duration, { longForm = false } = {}) {
  return longForm ? Math.min(Number(duration), STORY_SPINE_SECONDS) : Number(duration);
}

/** The production intake the tournament and the story read, from what make knows. */
export function conceptIntake({ prompt, rules = null, format, duration, wpm, model = {} }) {
  const aspect = format.width === format.height ? "1:1" : format.height > format.width ? "9:16" : "16:9";
  return {
    source: { kind: "prompt", value: String(prompt) },
    brief: {
      prompt: String(prompt),
      audience: "Not stated: infer it from the prompt and the notes.",
      cta: null,
      language: "en",
      duration_seconds: duration,
      aspect: { id: aspect, width: format.width, height: format.height },
      ...(rules ? { rules: String(rules) } : {})
    },
    model: { provider: model.provider ?? "openai", id: model.model ?? null, reasoning_effort: model.reasoning ?? "medium", reasoning_mode: "standard" },
    profile: { id: "cinematic", planning: { concept_candidates: CONCEPT_CANDIDATES }, craft: { target_wpm_minimum: Math.round(wpm * WPM_FLOOR), target_wpm_maximum: Math.round(wpm * WPM_CEILING) } },
    policies: {},
    resources: []
  };
}

/**
 * The evidence the concepts and the story may claim from: the prompt and each
 * note (research's notes among them). The rules and the list of files the
 * video can show are context, never a source for a claim.
 */
export function conceptEvidence({ prompt, notes = [], rules = null, assets = [] }) {
  const items = [{ id: "brief", kind: "brief", role: "primary", title: "The prompt", content: String(prompt), provenance: "user", claims_allowed: true }];
  notes.forEach((text, index) => items.push({ id: `note-${index + 1}`, kind: "notes", role: "primary", title: `Notes ${index + 1}`, content: String(text), provenance: "user", claims_allowed: true }));
  if (rules) items.push({ id: "rules", kind: "rules", role: "reference", title: "The collection's rules (keep every one)", content: String(rules), provenance: "user", claims_allowed: false });
  if (assets.length) items.push({ id: "assets", kind: "assets", role: "reference", title: "Files the video can show", content: assets.join("\n"), provenance: "tooling", claims_allowed: false });
  return { items };
}

// make's client behind the interface the production stages call: the route's
// model, reasoning and background settings are make's own, so they are dropped.
function stageClient(client, calls) {
  const run = async (request) => {
    const result = await client.runStructured({ instructions: request.instructions, input: request.input, schema: request.schema, schemaName: request.schemaName, model: undefined, maxOutputTokens: request.maxOutputTokens });
    calls.push({ stage: COST_STAGES[request.schemaName] ?? request.schemaName, usage: result?.usage ?? null, model: result?.model ?? null });
    return { value: result?.value ?? parseText(result?.text), response_id: result?.response_id ?? null, model: result?.model ?? null, usage: result?.usage ?? {}, status: "completed" };
  };
  return { runStructured: run, resumeStructured: (_id, request) => run(request) };
}

/**
 * Five concepts judged in a fresh context, then the winner written and
 * edited as a story. options: {project, client, model: {provider, model,
 * reasoning}, prompt, notes, rules, assets (manifest lines), format: {width,
 * height}, duration (the story's seconds), wpm, say}. adapters:
 * {planConceptTournament, writeRetentionStory} (tests).
 * → {tournament, concept (the winner), story, calls: [{stage, usage, model}]}
 * and writes CONCEPTS.json and STORY.json. Throws when a stage fails; calls
 * made before the failure are on error.calls.
 */
export async function planConceptStory(options = {}, adapters = {}) {
  const { project, client, prompt, notes = [], rules = null, assets = [], format, duration, wpm, say } = options;
  if (!client) throw new Error("the concept stage needs a model client");
  const workspace = path.join(project, CONCEPT_PATHS.workspace);
  // A fresh workspace each time the inputs change: the job store there caches by input, and an interrupted job cannot be resumed headless.
  await rm(workspace, { recursive: true, force: true });
  await mkdir(path.join(workspace, "production"), { recursive: true });
  await writeJson(path.join(workspace, PRODUCTION_PATHS.intake), { workspace, ...conceptIntake({ prompt, rules, format, duration, wpm, model: options.model }) });
  await writeJson(path.join(workspace, PRODUCTION_PATHS.evidence), conceptEvidence({ prompt, notes, rules, assets }));
  const calls = [];
  const stage = { client: stageClient(client, calls) };
  try {
    say?.(`model: PAID calls to ${options.model?.provider ?? client.provider} ${options.model?.model ?? ""} (${CONCEPT_CANDIDATES} concepts, then a judge in a fresh context)`.replace("  ", " "));
    await (adapters.planConceptTournament ?? planConceptTournament)(workspace, { background: false }, stage);
    say?.(`model: PAID calls to ${options.model?.provider ?? client.provider} ${options.model?.model ?? ""} (the chosen story, then a retention edit)`.replace("  ", " "));
    await (adapters.writeRetentionStory ?? writeRetentionStory)(workspace, { background: false }, stage);
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { calls });
  }
  const tournament = JSON.parse(await readFile(path.join(workspace, PRODUCTION_PATHS.concepts), "utf8"));
  const story = JSON.parse(await readFile(path.join(workspace, PRODUCTION_PATHS.story), "utf8"));
  await copyFile(path.join(workspace, PRODUCTION_PATHS.concepts), path.join(project, CONCEPT_PATHS.concepts));
  await copyFile(path.join(workspace, PRODUCTION_PATHS.story), path.join(project, CONCEPT_PATHS.story));
  return { tournament, concept: selectedConcept(tournament), story, calls };
}

/** CONCEPTS.json and STORY.json from an earlier run, or null when either is missing or unreadable. */
export async function readConceptStory(project) {
  const files = [path.join(project, CONCEPT_PATHS.concepts), path.join(project, CONCEPT_PATHS.story)];
  if (!files.every((file) => existsSync(file))) return null;
  try {
    const [tournament, story] = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
    const concept = selectedConcept(tournament);
    return concept && story?.narration?.beats?.length ? { tournament, concept, story, calls: [] } : null;
  } catch { return null; }
}

function selectedConcept(tournament) {
  return (tournament?.candidates ?? []).find((candidate) => candidate.id === tournament.selected_id) ?? null;
}

const beatLine = (beat) => `- ${beat.role}: ${beat.spoken_text} (turn: ${beat.narrative_turn}; on screen: ${beat.visual_noun})`;

/** The story as a section of the script pass's prompt. */
export function storyScriptSection({ concept, story }) {
  return [
    "## Story (five concepts were judged in a fresh context and this one won; an editor then tightened it for retention. Write the script on it)",
    "",
    `Concept: ${concept.title}. ${concept.thesis}`,
    `Hook: ${concept.hook?.spoken_line}`,
    `The question it opens: ${story.open_loop?.question}`,
    "",
    "Its beats, in order:",
    ...story.narration.beats.map(beatLine),
    "",
    "Keep its hook, its order of turns and its payoff, and say each beat's fact once. Fit them to this format's beats and word budget, tightening the wording where the format needs it. Add no fact the story does not have."
  ];
}

/** The story as a section of a long video's outline prompt: the chapters come from its beats. */
export function storyOutlineSection({ concept, story }) {
  return [
    `## Story (five concepts were judged in a fresh context and this one won; an editor then tightened it. It is the video's spine in ${Math.round(story.format?.duration_seconds ?? STORY_SPINE_SECONDS)} seconds; derive the chapters from it)`,
    "",
    `Concept: ${concept.title}. ${concept.thesis}`,
    `Hook: ${concept.hook?.spoken_line}`,
    `The question it opens: ${story.open_loop?.question}`,
    "",
    "Its beats, in order:",
    ...story.narration.beats.map(beatLine),
    "",
    "Outline the video as this story told at length: the cold open is its hook, the chapters follow its turns in order (one or two beats to a chapter, each chapter with the facts that beat needs), and the last chapter lands its payoff. Do not add a chapter the story has no beat for."
  ];
}

/** The concept's visual world, for the storyboard planner's brief and the long-form director's notes. */
export function conceptLookLines({ concept }) {
  const seed = concept?.art_direction_seed;
  if (!seed) return [];
  return [
    `- Concept: ${concept.title}. ${concept.thesis}`,
    `- Visual metaphor: ${seed.visual_metaphor}`,
    `- The world it happens in: ${seed.spatial_world}`,
    `- Motion: ${seed.motion_language}. Transitions: ${seed.transition_logic}`
  ];
}

/** What MAKE.json records: the winner, how it scored, and the editor's scores when the review is there. */
export async function conceptSummary(project, { tournament, concept, story }) {
  const ranking = (tournament.ranking ?? []).find((entry) => entry.candidate_id === concept.id) ?? null;
  let review = null;
  try { review = JSON.parse(await readFile(path.join(project, CONCEPT_PATHS.workspace, PRODUCTION_PATHS.storyReview), "utf8")); } catch { /* a reused story keeps no review */ }
  return {
    file: CONCEPT_PATHS.concepts,
    story: CONCEPT_PATHS.story,
    candidates: tournament.candidates?.length ?? 0,
    selected: { id: concept.id, title: concept.title, hook: concept.hook?.spoken_line ?? null, engine: concept.narrative_engine ?? null, ...(ranking?.score != null ? { score: ranking.score } : {}) },
    story_beats: story.narration.beats.length,
    story_seconds: story.format?.duration_seconds ?? null,
    ...(review?.scores ? { story_scores: review.scores } : {})
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
