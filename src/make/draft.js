// A fast draft of `launchclip make` (--speed draft): a planned, playable
// video as soon as it can be had, with the render left for later.
//
// What the preset changes, for an ordinary (motion) video:
//
//   script      one streamed model call from the brief, on a hard word
//               budget (no concepts, judge, story, retention edit, repair
//               or resize pass); each sentence is handed on as it arrives
//   voice       a take per sentence, several at once, started while the
//               script is still being written; joined into one narration
//   storyboard  rule-made at once (src/make/draft_plan.js), then at most one
//               fast direction call that may recast it and rewrite its
//               acting and its card words; late or invalid, the rule-made
//               plan stands
//   shots       every request is sent to the asset provider at once, each
//               with a short deadline; a late clip's scene is drawn instead
//   stop        after the storyboard: no candidates, no render, no critic
//
// Every check that needs no pixels still runs, and tooling's deterministic
// repairs with them (src/storyboard_planner.js), so a draft is a valid plan.
//
// `--refine` continues a draft project: the script and the voice are kept,
// and the storyboard is planned again the ordinary way.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { KINDS, KIND_NAMES, isFourLegged } from "@launchclip/core/characters/kinds.mjs";
import { EXPRESSIONS, POSES } from "@launchclip/core/characters/rig.mjs";
import { EXPLAINER_CAST_MAX, castFromDirection } from "@launchclip/core/explainer.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { readWav, writeWav } from "../voice/words.js";
import { draftStoryboard } from "./draft_plan.js";

export const DRAFT_VERSION = "launchclip.make-draft.v1";
/** The silence between two sentence takes in the joined narration. */
export const SENTENCE_GAP = 0.12;
/** Sentence takes in flight at once. */
export const DRAFT_VOICE_CONCURRENCY = 4;
/** How long the draft waits for its one direction call (LAUNCHCLIP_DRAFT_DIRECTION_MS; 0 sends none). */
export const DRAFT_DIRECTION_MS = 12_000;
/** How long the draft waits for each shot (LAUNCHCLIP_DRAFT_SHOT_MS). */
export const DRAFT_SHOT_MS = 8_000;
/** The reasoning effort of the draft's calls when --draft-model names none. */
export const DRAFT_REASONING = "low";
/** The model spec of the rule-made plan, in the plan's own report. */
export const RULES_MODEL = "rules:beat-director";

const millis = (value, fallback) => {
  const number = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(number) && number >= 0 ? number : fallback;
};

/** The draft's waits, from the environment. → {directionMs, shotMs} */
export function draftWaits(env = process.env) {
  return { directionMs: millis(env?.LAUNCHCLIP_DRAFT_DIRECTION_MS, DRAFT_DIRECTION_MS), shotMs: millis(env?.LAUNCHCLIP_DRAFT_SHOT_MS, DRAFT_SHOT_MS) || DRAFT_SHOT_MS };
}

/** --draft-model, else LAUNCHCLIP_DRAFT_MODEL, else null (the run's model at low reasoning). */
export function draftModelSpec(flag, env = process.env) {
  const spec = flag != null && flag !== true && String(flag).trim() ? String(flag).trim() : String(env?.LAUNCHCLIP_DRAFT_MODEL ?? "").trim();
  return spec || null;
}

/**
 * Sentence takes joined into one narration: the WAVs end to end with
 * SENTENCE_GAP between them, and the words on one clock.
 * takes: [{file, words, duration}] in order. → {file, words, duration, sampleRate}
 */
export async function joinSentenceTakes(takes, outFile, { gap = SENTENCE_GAP } = {}) {
  if (!takes.length) throw new Error("no sentence takes to join");
  const audio = [];
  for (const take of takes) audio.push(await readWav(take.file));
  const sampleRate = audio[0].sampleRate;
  if (audio.some((entry) => entry.sampleRate !== sampleRate)) throw new Error("the sentence takes have different sample rates");
  const silence = Math.round(gap * sampleRate);
  const total = audio.reduce((sum, entry) => sum + entry.samples.length, 0) + silence * (audio.length - 1);
  const samples = new Float32Array(total);
  const words = [];
  let at = 0;
  audio.forEach((entry, index) => {
    const offset = at / sampleRate;
    samples.set(entry.samples, at);
    for (const word of takes[index].words) words.push({ ...word, start: round3(word.start + offset), end: round3(word.end + offset) });
    at += entry.samples.length + (index < audio.length - 1 ? silence : 0);
  });
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeWav(outFile, samples, sampleRate);
  return { file: outFile, words, duration: round3(total / sampleRate), sampleRate };
}

/**
 * An asset provider that answers every request at once and gives up on a
 * late one: findShot resolves null after `ms`, and the request is counted in
 * `late`. Its concurrency is high so the planner sends all its requests
 * before it waits for the first (src/asset_provider.js resolveShots).
 */
export function deadlineProvider(provider, ms, { concurrency = 16, onLate = () => {} } = {}) {
  const late = [];
  return {
    concurrency: Math.max(2, Number(provider.concurrency) || 0, concurrency),
    late,
    findShot(request, options) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { late.push(request.id); onLate(request); resolve(null); }, ms);
        Promise.resolve().then(() => provider.findShot(request, options)).then((shot) => { clearTimeout(timer); resolve(shot); }, (error) => { clearTimeout(timer); reject(error); });
      });
    },
    close: () => provider.close?.()
  };
}

/** A planner client that answers with a storyboard made by rule: no map, and the storyboard as it is. */
export function ruleClient(storyboard) {
  return {
    provider: "rules",
    async runStructured(request) {
      if (request.schemaName === "launchclip_direction") return { model: RULES_MODEL, value: { direction_json: "" }, usage: {} };
      return { model: RULES_MODEL, value: { storyboard_json: JSON.stringify(storyboard) }, usage: {} };
    }
  };
}

// ---------------------------------------------------------------------------
// The one fast direction call.

const CASTABLE = KIND_NAMES.filter((name) => !isFourLegged(name));

export const DRAFT_DIRECTION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["cast", "scenes"],
  properties: {
    cast: {
      type: "array",
      description: `One to ${EXPLAINER_CAST_MAX} characters that carry the idea: the subject itself as an object with a face, its parts or forces as mascots.`,
      items: { type: "object", additionalProperties: false, required: ["id", "kind", "plays"], properties: { id: { type: "string", description: "A short lowercase name for the part it plays (cloud, drop)." }, kind: { type: "string", enum: CASTABLE }, plays: { type: "string", description: "What it stands for in this video, in a few words." } } }
    },
    scenes: {
      type: "array",
      description: "One entry per character scene you change, by the scene's id. Leave a scene out to keep it.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "character", "pose", "expression", "title", "kicker"],
        properties: {
          id: { type: "string" },
          character: { type: "string", description: "A cast id, or empty to keep the character." },
          pose: { type: "string", description: `One of ${POSES.join(", ")}; or empty to keep it.` },
          expression: { type: "string", description: `One of ${EXPRESSIONS.join(", ")}; or empty to keep it.` },
          title: { type: "string", description: "The card's words: the line in three to seven words, from the narration's own words; or empty to keep them." },
          kicker: { type: "string", description: "One or two words over the title, or empty for none." }
        }
      }
    }
  }
});

const DIRECTION_ROLE = `You direct a short explainer video that characters carry. A storyboard has already been made by rule from the narration: one scene a line, a character beside a card that says the line in a few words. You get one quick pass to make it better. You cannot move, add or remove scenes.

- cast: choose who carries the idea. Make the subject itself a character (the thing being explained, as an object with a face) and give its parts, causes or forces a mascot each. One to ${EXPLAINER_CAST_MAX} characters; every one plays something the narration names.
- scenes: for each character scene, say which character is in it, how it acts the line (pose and expression say the line's feeling: confused at the question, surprised at the turn, delighted at the payoff), and the card's words. The same character should not hold the same pose in two scenes in a row.
- Card words come from the narration's own words: never a fact, a number or a name the script does not have.
- Answer fast: change what helps and leave the rest.`;

const directionInstructions = () => [DIRECTION_ROLE, "", `kind is one of: ${CASTABLE.map((kind) => `${kind} (${String(KINDS[kind].describe).replace(/^an? /, "")})`).join("; ")}.`].join("\n");

/**
 * The draft's one direction call. → {answer, usage, cost_usd, model}; throws
 * when the call fails (the rule-made plan then stands).
 * options: {client, model, provider, reasoning, prompt, lines ([{start, end,
 * text}]), storyboard (the rule-made one), signal (aborted when the draft
 * stops waiting)}. The call is streamed where the client can, so no poll
 * interval is added to it.
 */
export async function draftDirection({ client, model = null, provider = null, reasoning = DRAFT_REASONING, prompt, lines, storyboard, signal = null }) {
  const scenes = storyboard.scenes.map((scene, index) => {
    const seconds = (scene.end - scene.start).toFixed(1);
    const params = scene.params ?? {};
    const what = scene.module === "character-cameo" ? `character ${params.character}, ${params.pose}/${params.expression}, card "${params.card?.title ?? ""}"` : scene.module === "cast-scene" ? `${(params.cast ?? []).map((member) => member.id).join(" and ")} together` : scene.module;
    return `- ${scene.id} (${scene.module}, ${seconds} s; room for ${titleRoom(scene)} card words): "${lines[index]?.text ?? ""}" → ${what}`;
  });
  const input = ["## Brief", "", String(prompt).trim(), "", "## Scenes (id, module, length: the narration under it → what the rule-made plan shows)", "", ...scenes, "", `The rule-made cast: ${storyboard.cast.characters.map((member) => `${member.id} (${member.kind ?? "a person"})`).join(", ")}.`].join("\n");
  const result = await client.runStructured({ instructions: directionInstructions(), input: `${input}\n`, schema: DRAFT_DIRECTION_SCHEMA, schemaName: "launchclip_draft_direction", model: model ?? undefined, reasoningEffort: reasoning, maxOutputTokens: 2500, onDelta: () => {}, ...(signal ? { signal } : {}) });
  const value = result?.value && typeof result.value === "object" ? result.value : parseObject(result?.text);
  const cost = estimateModelUsageCost(provider ?? client?.provider ?? "openai", result?.model ?? model, result?.usage ?? {});
  return { answer: value, usage: result?.usage ?? {}, cost_usd: cost.estimated_usd, model: result?.model ?? model };
}

const titleRoom = (scene) => Math.max(2, Math.min(7, Math.floor((scene.end - scene.start - 0.8) / 0.22)));
const wordCount = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;

/**
 * The rule-made plan with a direction answer applied: the cast it chose (when
 * the kit can draw it), then each named scene's character, acting and card
 * words, each kept only when it is one the kit has and the scene has room for.
 * rule: draftStoryboard()'s inputs. → {storyboard, fallbacks, explainer
 * ({cast, roles}), changed: [what]} or null when the answer changes nothing.
 */
export function applyDraftDirection(rule, answer) {
  if (!answer || typeof answer !== "object") return null;
  const changed = [];
  const chosen = Array.isArray(answer.cast) && answer.cast.length ? castFromDirection({ cast: { characters: answer.cast } }) : null;
  const draft = draftStoryboard({ ...rule, ...(chosen ? { cast: chosen.cast } : {}) });
  if (chosen) changed.push(`cast: ${chosen.cast.characters.map((member) => `${member.id} (${member.kind ?? "starter"})`).join(", ")}`);
  const ids = new Set(draft.storyboard.cast.characters.map((member) => member.id));
  const retouch = (scene) => {
    const next = (Array.isArray(answer.scenes) ? answer.scenes : []).find((entry) => entry?.id === scene.id);
    if (!next || scene.module !== "character-cameo") return scene;
    const params = { ...scene.params, card: { ...(scene.params.card ?? {}) } };
    const before = JSON.stringify(params);
    if (ids.has(next.character)) params.character = next.character;
    if (POSES.includes(next.pose)) params.pose = next.pose;
    if (EXPRESSIONS.includes(next.expression)) params.expression = next.expression;
    const title = String(next.title ?? "").replace(/\s+/g, " ").trim();
    if (title && wordCount(title) <= titleRoom(scene)) params.card.title = title;
    const kicker = String(next.kicker ?? "").replace(/\s+/g, " ").trim();
    if (kicker && wordCount(kicker) <= 2 && wordCount(kicker) + wordCount(params.card.title) <= titleRoom(scene)) params.card.kicker = kicker;
    // A cue that repeats the pose the scene now opens on says nothing: it takes the pose the scene had.
    if (params.cues?.length && params.cues[0].pose === params.pose) params.cues = [{ ...params.cues[0], pose: scene.params.pose, expression: scene.params.expression }];
    if (JSON.stringify(params) === before) return scene;
    changed.push(`${scene.id}: ${params.character}, ${params.pose}/${params.expression}, "${params.card.title}"`);
    return { ...scene, params };
  };
  const scenes = draft.storyboard.scenes.map(retouch);
  const fallbacks = Object.fromEntries(Object.entries(draft.fallbacks).map(([id, scene]) => [id, retouch(scene)]));
  if (!changed.length) return null;
  return { storyboard: { ...draft.storyboard, scenes }, fallbacks, explainer: chosen ? { cast: chosen.cast, roles: chosen.roles } : null, changed };
}

/** Whether a project's voice cache already holds a take (src/voice/narrate.js). */
export function takeCached(cacheDir, key) {
  return Boolean(cacheDir) && existsSync(path.join(cacheDir, `${key}.wav`)) && existsSync(path.join(cacheDir, `${key}.json`));
}

function parseObject(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

function round3(value) { return Math.round(value * 1000) / 1000; }
