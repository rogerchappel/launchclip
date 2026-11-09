// Rendered candidates for `launchclip make` (docs/MAKE_SKILL_PARITY.md, phase 6).
//
// The create-video skill does not commit to its first idea for the two
// moments that decide a video: the opening, and one risky transition. It
// renders two candidates for each, scores them from the pixels and keeps the
// winner. make does the same, after the storyboard is planned and before the
// draft renders:
//
//   opening     A: the planner's opening scene.
//               B: an opening designed in a separate model call that never
//                  sees A (the brief, the opening line and the catalogue only).
//   transition  the riskiest boundary in the opening stretch (a camera move
//               before a shared-world move before a wipe before a cut; the
//               longest wins a tie).
//               A: the planner's transition. B: a different kind of move.
//
// Each candidate is three stills at delivery size (entry, peak and settle of
// the scene; early, middle and late in the transition's move), rendered by the
// project's renderer from the story with only that one thing changed. They
// are cheap: no encode, no audio and no paid call. A model that can see then
// scores every candidate 0–10 on the skill's ten fields from the frames
// alone; the winner is the highest mean, ties going to the first in order.
//
// The frames and scores are written as the receipt the skill writes
// (qa/rendered-candidates.json, launchclip.subscription-rendered-candidates.v2),
// which cinematic-check validates. A winning B replaces A in storyboard.json.
//
// Not yet: long form (its storyboard comes from the beat map, which a
// candidate would have to change), and footage-led videos, whose opening is
// the recording. make reports those as skipped.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { knownModules, resolveModule } from "@launchclip/core/modules.mjs";
import { TITLE_CARD_MODULES } from "@launchclip/core/skeleton-library.mjs";
import { CAMERA_TRANSITION_TYPES } from "@launchclip/core/transitions.mjs";
import { CANDIDATE_DIR, CANDIDATE_RECEIPT, CANDIDATE_SCORE_TEMPLATE } from "../candidate_receipt.js";
import { SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION, validateRenderedCandidateReceipt } from "../cinematic_evidence.js";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { deriveBoundaries } from "../story.js";
import { catalogueText, filesAllowed } from "./long_form_direct.js";

export const CANDIDATE_SCORE_FIELDS = Object.freeze(Object.keys(CANDIDATE_SCORE_TEMPLATE));
// The risky boundary is looked for in this many seconds from the start.
export const BOUNDARY_WINDOW_SECONDS = 30;
// Where in a scene its three stills are taken (entry, peak, settle).
const SCENE_SHARES = Object.freeze([0.15, 0.5, 0.9]);
// The other move a transition candidate tries, by how the story's camera works.
const ALTERNATIVES = Object.freeze({ world: Object.freeze(["push", "whip-pan", "pull", "orbit"]), cuts: Object.freeze(["push-blur", "light-sweep", "glow-wipe", "fade"]) });
const DEFAULT_TRANSITION_SECONDS = 0.5;

/** --candidates: "on" (default) or "off". */
export function candidatesMode(value) {
  if (value === undefined || value === null || value === "" || value === true) return "on";
  const mode = String(value).toLowerCase();
  if (!["on", "off"].includes(mode)) throw new Error(`--candidates must be on or off; got ${value}`);
  return mode;
}

const baseScenes = (resolved) => (resolved?.scenes ?? []).filter((scene) => (scene.track ?? 0) === 0).sort((a, b) => Number(a.start) - Number(b.start));
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** The opening scene of a resolved story (the first on the base track), or null. */
export function openingScene(resolved) {
  return baseScenes(resolved)[0] ?? null;
}

// How much a transition has to get right: a camera move most, a cut least.
function transitionRisk(scene, mode) {
  const type = scene.in?.type ?? "cut";
  if (type === "cut") return 0;
  if (CAMERA_TRANSITION_TYPES.includes(type) || ((type === "push" || type === "overview") && mode === "world")) return 3;
  if (type === "morph" || typeof scene.in?.from_object === "string") return 2;
  return 1;
}

/**
 * The riskiest boundary between base scenes that starts in the opening
 * stretch: the highest risk, then the longest move, then the earliest.
 * → {scene (the scene the transition enters), boundary_id, at, dur, risk} or
 * null when the story has no second base scene there.
 */
export function riskyBoundary(resolved, { within = BOUNDARY_WINDOW_SECONDS } = {}) {
  const mode = resolved?.camera?.mode === "world" ? "world" : "cuts";
  const declared = new Map(deriveBoundaries(resolved).map((boundary) => [boundary.to_id, boundary]));
  const entries = baseScenes(resolved).slice(1)
    .filter((scene) => Number(scene.start) <= within && declared.has(scene.id))
    .map((scene) => ({ scene, boundary_id: declared.get(scene.id).boundary_id, at: Number(scene.start), dur: Number(scene.in?.dur) || 0, risk: transitionRisk(scene, mode) }));
  return entries.sort((a, b) => b.risk - a.risk || b.dur - a.dur || a.at - b.at)[0] ?? null;
}

/** The other transition a candidate tries at a boundary: a different kind of move that the story's camera can make. */
export function alternativeTransition(scene, resolved) {
  const mode = resolved?.camera?.mode === "world" ? "world" : "cuts";
  const current = scene.in?.type ?? "cut";
  const type = ALTERNATIVES[mode].find((entry) => entry !== current);
  return { type, dur: Number(scene.in?.dur) > 0 ? Number(scene.in.dur) : DEFAULT_TRANSITION_SECONDS };
}

/** The three times (s) a scene's stills are taken at. */
export function sceneTimes(scene) {
  const start = Number(scene.start), end = Number(scene.end);
  return SCENE_SHARES.map((share) => round(start + (end - start) * share));
}

// Where in a move its three stills are taken (early, peak, late). The frames
// before and after a move are the same whichever move it is, and the receipt
// refuses two candidates that share a frame, so all three are inside it.
const MOVE_SHARES = Object.freeze([0.2, 0.5, 0.8]);

/** The three times (s) a transition's stills are taken at: early in the move, at its middle and late in it. */
export function transitionTimes(scene, transition, duration) {
  const at = Number(scene.start);
  const dur = Number(transition?.dur) > 0 ? Number(transition.dur) : DEFAULT_TRANSITION_SECONDS;
  const clamp = (value) => round(Math.max(0, Math.min(value, Math.max(0, duration - 0.05), Number(scene.end) - 0.05)));
  return MOVE_SHARES.map((share) => clamp(at + dur * share));
}

/** A copy of a story with one scene changed. change: {module, params} (a new card, its own states dropped) or {in}. */
export function storyWith(story, sceneId, change) {
  const copy = JSON.parse(JSON.stringify(story));
  const scene = (copy.scenes ?? []).find((entry) => entry.id === sceneId);
  if (!scene) throw new Error(`no scene ${sceneId} in the story`);
  if (change.module) {
    Object.assign(scene, { module: change.module, params: change.params });
    // States, zooms and hits frame the card that was there.
    delete scene.states; delete scene.zooms; delete scene.hits;
  }
  if (change.in) scene.in = change.in;
  return copy;
}

const OPENING_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["module", "params_json", "why"],
  properties: {
    module: { type: "string", description: "The catalogue module for the opening scene." },
    params_json: { type: "string", description: "Its params as a JSON object." },
    why: { type: "string", description: "One sentence: why this image stops the scroll and shows the promise." }
  }
});

const OPENING_ROLE = `You design the opening image of a short video narrated over motion graphics: the first thing the viewer sees while the opening line is spoken. Another designer is solving the same opening separately. You will not see their answer and must not guess at it: solve it from the brief.

- Open on an image of the thing the line is about (the product on screen, a number that moves, an object, a comparison), never on a title card or the line as words.
- The image shows the promise or its proof in the first second, and it develops while the line is spoken.
- One clear focal point that reads on a phone.
- Never invent a figure, a quote, a date or a name: every value comes from the brief or the opening line.
- Only use files listed under "Files the video can show"; never make up a path.
- Respect every param's limits (lengths, item counts).
Return one module from the catalogue below and its params as a JSON string, and nothing else.

# Module catalogue
`;

/**
 * Candidate B for the opening: one model call that sees the brief, the
 * opening line and the catalogue, and never candidate A. options: {client,
 * model, provider, prompt, line (the words spoken over the opening scene),
 * seconds, format, assets: [{src, line}], notes}.
 * → {module, params, why, cost: {cost_usd, usage, model}}; throws when the answer is not a usable card.
 */
export async function designOpening(options = {}) {
  const { client, model = null, provider = null, prompt, line, seconds, format, assets = [], notes = [] } = options;
  if (!client) throw new Error("the opening candidate needs a model client");
  const lines = [
    `Format: ${format.width}×${format.height}. The opening scene runs ${round(seconds, 1)} s.`,
    "",
    "## Brief",
    "",
    String(prompt).trim(),
    "",
    "## The opening line (spoken over this scene)",
    "",
    String(line).trim() || "(no narration over the opening)",
    "",
    "## Files the video can show",
    "",
    ...(assets.length ? assets.map((asset) => `- ${asset.line}`) : ["None: use no media files."])
  ];
  if (notes.length) lines.push("", "## Notes", "", ...notes.map((text) => String(text).trim().slice(0, 4000)));
  const result = await client.runStructured({ instructions: `${OPENING_ROLE}${catalogueText()}\n`, input: `${lines.join("\n")}\n`, schema: OPENING_SCHEMA, schemaName: "launchclip_make_opening_candidate", model: undefined, maxOutputTokens: 4000 });
  const usage = result?.usage ?? {};
  const cost = { cost_usd: estimateModelUsageCost(provider ?? client.provider ?? "openai", result?.model ?? model, usage).estimated_usd, usage, model: result?.model ?? model };
  const fail = (message) => { throw Object.assign(new Error(message), { cost }); };
  const value = result?.value ?? parseText(result?.text);
  const module = String(value?.module ?? "").trim();
  let params = null;
  try { params = JSON.parse(value?.params_json ?? ""); } catch { /* reported below */ }
  if (!knownModules().includes(module)) fail(`the opening candidate named an unknown module (${module || "none"})`);
  if (TITLE_CARD_MODULES.includes(module)) fail(`the opening candidate is a title card (${module})`);
  if (!params || typeof params !== "object" || Array.isArray(params)) fail("the opening candidate's params are not a JSON object");
  if (!filesAllowed(params, new Set(assets.map((asset) => asset.src)))) fail("the opening candidate names a file the video does not have");
  return { module, params, why: String(value?.why ?? "").trim(), cost };
}

/** Whether a scene's module resolves in its story (the same check the renderers make). */
export function sceneResolves(resolved, sceneId) {
  const scene = (resolved.scenes ?? []).find((entry) => entry.id === sceneId);
  try { resolveModule(scene, resolved); return true; } catch { return false; }
}

const JUDGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["candidates", "rationale"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "admissible", "weakness", "scores"],
        properties: {
          id: { type: "string" },
          admissible: { type: "boolean", description: "false for a blank, broken, unreadable or clipped candidate." },
          weakness: { type: "string", description: "The candidate's main weakness, in one sentence, from what the frames show." },
          scores: { type: "object", additionalProperties: false, required: [...CANDIDATE_SCORE_FIELDS], properties: Object.fromEntries(CANDIDATE_SCORE_FIELDS.map((field) => [field, { type: "number", minimum: 0, maximum: 10 }])) }
        }
      }
    },
    rationale: { type: "string", description: "Why the stronger candidate is stronger, from the frames." }
  }
});

const JUDGE_ROLE = `You are a fresh-context motion-design judge. You are shown rendered frames of candidates for one moment of a video, at delivery size. Judge the pixels only: you have not seen how either was made, and neither is the default.

Each candidate has three frames in time order. For an opening they are its entry, peak and settle. For a transition all three are inside the move: early in it, at its middle and late in it.

Score every candidate from 0 to 10 on:
- scroll_stop: would this stop a thumb.
- promise_or_proof_clarity: is the promise or its proof legible at once.
- mobile_hierarchy: one focal point that reads on a phone; nothing clipped or crowded.
- art_direction_specificity: specific to this subject, not a generic gradient or a slide.
- depth_materiality: light, depth and material rather than flat shapes.
- temporal_development: do the three frames differ in a way that builds.
- continuity: does the picture carry from one frame to the next (for a transition: does something carry across the move).
- velocity_blur_shape: at the middle frame, is the motion readable as motion (blur at speed, not a smear or a freeze).
- crisp_settle: is the last frame sharp and composed (for a transition: is the picture resolving cleanly as the move ends).
- implementation_feasibility: does it look finished, with no broken layout, missing media or placeholder.

Mark a candidate inadmissible only when it is blank, broken, unreadable or clipped. Give each candidate's main weakness in one sentence. Return only the JSON object.`;

/**
 * Score a comparison's candidates from their frames. options: {client, model,
 * provider, kind ("opening"|"transition"), candidates: [{id, frames: [file]}],
 * project, context (one line: what the moment is)}.
 * → {scores: Map(id → {admissible, weakness, scores}), rationale, cost}
 */
export async function judgeCandidates(options = {}) {
  const { client, model = null, provider = null, kind, candidates, project, context = "" } = options;
  const images = [];
  const lines = [`These are candidates for ${kind === "opening" ? "the opening of the video" : "one transition in the video"}. ${context}`.trim(), ""];
  for (const candidate of candidates) {
    lines.push(`Candidate ${candidate.id}: images ${images.length + 1} to ${images.length + candidate.frames.length}, in time order.`);
    for (const file of candidate.frames) images.push({ url: `data:image/png;base64,${(await readFile(path.join(project, file))).toString("base64")}`, detail: "high" });
  }
  const result = await client.runStructured({ instructions: JUDGE_ROLE, input: `${lines.join("\n")}\n`, images, schema: JUDGE_SCHEMA, schemaName: "launchclip_make_candidate_judgment", model: undefined, maxOutputTokens: 4000 });
  const usage = result?.usage ?? {};
  const cost = { cost_usd: estimateModelUsageCost(provider ?? client.provider ?? "openai", result?.model ?? model, usage).estimated_usd, usage, model: result?.model ?? model };
  const value = result?.value ?? parseText(result?.text);
  const scores = new Map();
  for (const entry of Array.isArray(value?.candidates) ? value.candidates : []) {
    const clean = Object.fromEntries(CANDIDATE_SCORE_FIELDS.map((field) => [field, Number(entry?.scores?.[field])]));
    if (Object.values(clean).every((score) => Number.isFinite(score) && score >= 0 && score <= 10)) scores.set(String(entry.id), { admissible: entry.admissible !== false, weakness: String(entry.weakness ?? "").trim(), scores: clean });
  }
  const missing = candidates.filter((candidate) => !scores.has(candidate.id)).map((candidate) => candidate.id);
  if (missing.length) throw Object.assign(new Error(`the judge returned no valid scores for ${missing.join(", ")}`), { cost });
  return { scores, rationale: String(value?.rationale ?? "").trim(), cost };
}

/** The mean of a candidate's ten scores. */
export function meanScore(scores) {
  return round(CANDIDATE_SCORE_FIELDS.reduce((sum, field) => sum + Number(scores[field]), 0) / CANDIDATE_SCORE_FIELDS.length, 2);
}

/** The winner: the highest mean among the admissible candidates, ties to the first in order. order: [ids]. → id or null. */
export function selectCandidate(order, judged) {
  const ranked = order.filter((id) => judged.get(id)?.admissible).sort((a, b) => meanScore(judged.get(b).scores) - meanScore(judged.get(a).scores) || order.indexOf(a) - order.indexOf(b));
  return ranked[0] ?? null;
}

const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

/**
 * Render one candidate's stills into qa/rendered-candidates/<id>/.
 * still(resolvedStory, seconds, outFile, {dir}) renders one frame.
 * → {id, frames: [project-relative files], artifacts: [{file, sha256}], render_id}
 */
export async function renderCandidate({ project, id, story, times, fps = 30, still }) {
  const dir = path.join(project, CANDIDATE_DIR, id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const frames = [];
  for (const at of times) {
    const file = path.join(dir, `frame-${String(Math.round(at * fps)).padStart(4, "0")}.png`);
    await still(story, at, file, { dir });
    frames.push(path.relative(project, file).split(path.sep).join("/"));
  }
  const artifacts = [];
  for (const file of frames) artifacts.push({ file, sha256: await sha256(path.join(project, file)) });
  return { id, frames, artifacts, render_id: `${id}-${createHash("sha256").update(artifacts.map((entry) => entry.sha256).join("")).digest("hex").slice(0, 12)}` };
}

/**
 * A still(story, seconds, outFile, {dir}) for the project's renderer: one
 * frame of a resolved story. Remotion takes the story as props; HyperFrames
 * is compiled once per candidate folder.
 */
export async function rendererStill({ project, renderer }) {
  const { getRenderer } = await import("../renderers/index.js");
  const adapter = getRenderer(renderer);
  const compiled = new Set();
  return async (story, at, out, { dir }) => {
    if (renderer !== "hyperframes") return adapter.still(project, at, out, { story, propsFile: path.join(dir, "story.resolved.json") });
    const hf = path.join(dir, "hyperframes");
    if (!compiled.has(hf)) {
      const { compileStoryToHyperFrames } = await import("../../kit/hyperframes/story-compiler.mjs");
      await compileStoryToHyperFrames(story, { projectDir: hf, sourceDir: project });
      compiled.add(hf);
    }
    return adapter.still(hf, at, out);
  };
}

/**
 * One comparison of the receipt, from its rendered and judged candidates.
 * candidates: [{id, artifacts, render_id, source}] in order; judged: Map(id →
 * {admissible, weakness, scores}); selected: the winner's id.
 */
export function comparisonEntry({ id, kind, boundary = null, candidates, judged, selected, rationale }) {
  const winner = judged.get(selected);
  return {
    id, kind, ...(kind === "transition" ? { boundary_id: boundary } : {}),
    judging_basis: "rendered-pixels-and-motion",
    candidate_order: candidates.map((candidate) => candidate.id),
    candidates: candidates.map((candidate) => {
      const verdict = judged.get(candidate.id);
      const lost = candidate.id !== selected;
      return {
        id: candidate.id,
        render_id: candidate.render_id,
        admissible: verdict.admissible,
        source: candidate.source,
        artifacts: candidate.artifacts,
        scores: verdict.scores,
        ...(lost ? { rejection_reason: verdict.weakness || `scored ${meanScore(verdict.scores)} against ${meanScore(winner.scores)}` } : {})
      };
    }),
    selected_candidate_id: selected,
    selection_rationale: rationale || `Highest mean score from the rendered frames (${meanScore(winner.scores)}).`
  };
}

/** Write qa/rendered-candidates.json and check it as cinematic-check would. → {file, ok, errors} */
export async function writeReceipt(project, comparisons, { boundaryIds = null } = {}) {
  const receipt = { schema_version: SUBSCRIPTION_CANDIDATE_RECEIPT_VERSION, comparisons };
  const file = path.join(project, CANDIDATE_RECEIPT);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);
  const validation = await validateRenderedCandidateReceipt(project, receipt, boundaryIds ? { boundaryIds } : {});
  return { file: CANDIDATE_RECEIPT, ok: validation.ok, errors: validation.errors ?? [] };
}

function parseText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
