// Script pass for `launchclip make` (motion lane): a planning pass picks the
// format, goal and awareness (kit/core/script-formats.mjs: --format, --goal,
// --awareness, or a deterministic default from the brief), then the model
// writes the narration against that format's beat skeleton and word budget,
// from the prompt, the notes, the asset descriptions and any transcripts. One
// optional repair pass fixes the script checks' errors (src/script_check.js),
// and one optional resize pass trims the length once the real take is
// measured. On a library skeleton (kit/core/skeleton-library.mjs) the script
// is written on its beats. A short video's script pass also finds the angle
// (the crowded take, the subject inventory, three fresh angles; ANGLE.json)
// and scores its five title options, in the same call; the titles are then
// ordered best first by a deterministic score.
import { SHORT_VIDEO_SECONDS, chooseScriptPlan, scriptPlanLines, scriptRuleLines } from "@launchclip/core/script-formats.mjs";
import { skeletonScriptPlan } from "@launchclip/core/skeleton-library.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { TEASERS } from "../publish_manifest.js";
import { storyScriptSection } from "./concept_story.js";

export const SCRIPT_VERSION = "launchclip.make-script.v1";
export const WORDS_PER_MINUTE = 150;
// A take more than this far over the target duration triggers one resize pass. The
// duration is a ceiling (docs/MAKE_SKILL_PARITY.md, phase 4): a take that runs
// short is never resized, because the only way to lengthen it is to pad it.
export const RESIZE_TOLERANCE = 0.15;

// title and narration are all an older response carries; title_options and
// beats came with the planning pass and are optional when parsing.
export const SCRIPT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "narration", "title_options", "beats"],
  properties: {
    title: { type: "string", description: "A short working title (≤ 60 characters)." },
    narration: { type: "string", description: "The complete voiceover text, plain sentences, no stage directions: the beats' text joined in order." },
    title_options: {
      type: "array",
      description: "Three publish-ready titles (five, best first, for a video of 90 s or less; ≤ 70 characters each). For goal=convert the concrete outcome goes in the title; no curiosity bait.",
      items: { type: "string" }
    },
    beats: {
      type: "array",
      description: "The narration split into the plan's beats, in order.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["beat", "text"],
        properties: {
          beat: { type: "string", description: "The beat id from the plan (hook, problem, cta, …)." },
          text: { type: "string", description: "The exact narration sentences of this beat." }
        }
      }
    }
  }
});

// A short video's script pass also returns the angle and the title scores
// (docs/VIRAL_FORMATS_RFC.md §4.2, §3.6): same call, no extra cost.
const ANGLE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["crowded", "inventory", "angles", "chosen"],
  properties: {
    crowded: { type: "string", description: "How this topic is usually done, in one sentence." },
    inventory: { type: "array", description: "Eight to twelve concrete things only this subject has: its place, its numbers, its constraint, the objects in its world.", items: { type: "string" } },
    angles: {
      type: "array",
      description: "Three fresh angles, each built from the inventory.",
      items: { type: "object", additionalProperties: false, required: ["angle", "differs"], properties: { angle: { type: "string", description: "The angle in one sentence." }, differs: { type: "string", description: "How it differs from the crowded take." } } }
    },
    chosen: { type: "integer", description: "The index (0-2) of the angle the script is written on." }
  }
});
const TITLE_SCORES_SCHEMA = Object.freeze({
  type: "array",
  description: "Every title option scored 0-10 on curiosity (a gap that carries self-interest, never confusion), clarity (what the video is, at a glance) and match (it fits the opening image and the hook).",
  items: { type: "object", additionalProperties: false, required: ["title", "curiosity", "clarity", "match"], properties: { title: { type: "string" }, curiosity: { type: "number" }, clarity: { type: "number" }, match: { type: "number" } } }
});

const POST_CAPTION_SCHEMA = Object.freeze({ type: "string", description: "The post text under the video: the hook line, then the list written out in full (one line per item, numbered), then the call to action, then \"Save this\" with a reason. Plain text, line breaks allowed, no hashtags." });

/** The script schema for a plan: a short video's adds the angle, the title scores and the post caption. */
export function scriptSchema(plan) {
  if (!isShort(plan)) return SCRIPT_SCHEMA;
  return { ...SCRIPT_SCHEMA, required: [...SCRIPT_SCHEMA.required, "angle", "title_scores", "post_caption"], properties: { ...SCRIPT_SCHEMA.properties, angle: ANGLE_SCHEMA, title_scores: TITLE_SCORES_SCHEMA, post_caption: POST_CAPTION_SCHEMA } };
}

const isShort = (plan) => Number(plan?.duration) <= SHORT_VIDEO_SECONDS;

const ANGLE_LINES = [
  "## Angle (before you write)",
  "",
  "- crowded: how this topic is usually done, in one sentence (the version the viewer has already scrolled past).",
  "- inventory: eight to twelve concrete things only this subject has (its place, its numbers, its constraint, the objects in its world), from the brief and the assets only.",
  "- angles: three fresh angles built from the inventory, each saying how it differs from the crowded take. chosen: the strongest one's index. Write the script on it; the hook and the share line come from it."
];

const TITLE_LINES = [
  "## Titles",
  "",
  "- title_scores: score every title option 0-10 on curiosity (a gap that carries self-interest, never confusion or a tease), clarity (what the video is, at a glance) and match (it fits the opening image and the hook). Be strict; the order is computed from these."
];

const POST_LINES = (plan) => [
  "## Post caption",
  "",
  `- post_caption: the text posted under the video, so a viewer can save it: line 1 the hook; then every list item or step, numbered, one per line, each with its specific; then the call to action${plan?.cta?.keyword ? ` ("Comment ${plan.cta.keyword} and I'll send you ${plan.cta.offer ?? "…"}")` : plan?.series?.choices?.length ? ` ("Comment ${plan.series.choices.join(", ")}. One word.")` : ""} worded as in the narration; last, "Save this" and why (before your next build, before you pick a builder). Only facts the narration states.`
];

const ROLE = `You write voiceover scripts for short product, explainer and story videos. A planning pass has already chosen the format, goal, awareness and beat skeleton below; write against it.

Write narration that will be read aloud by a text-to-speech voice:
- Plain spoken sentences. No headings, bullet points, emoji, stage directions, sound cues or speaker labels.
- Each sentence can own a scene: make every one concrete, and keep product names exactly as given.
- Teach something: for every option, step or item you name, say at least one thing about it the viewer can use (what it is good at, its trade-off, what it needs). Naming options and moving on says nothing.`;

const output = (titles) => `Output:
- narration: the whole script. beats: the same sentences split by beat id, in the plan's order; their text joined is the narration.
- title: a short working title. title_options: ${titles} publish-ready titles the video pays off.
- Hit the word budget within ±10%. Return only the JSON object.`;

/** How many title options a plan asks for: five, best first, for a short video; else three. */
export const titleCount = (plan) => (Number(plan?.duration) <= SHORT_VIDEO_SECONDS ? 5 : 3);

/** The script pass instructions for a plan (chooseScriptPlan() or skeletonScriptPlan()). */
export function scriptInstructions(plan) {
  const short = isShort(plan) ? ["", ...ANGLE_LINES, "", ...TITLE_LINES, "", ...POST_LINES(plan)] : [];
  return [ROLE, "", "## Plan", "", ...scriptPlanLines(plan), "", "## Rules", "", ...scriptRuleLines(plan).map((line) => `- ${line}`), ...short, "", output(titleCount(plan) === 5 ? "five, the best first," : "three")].join("\n");
}

/**
 * The title options ordered by score, best first: 0.4 × curiosity + 0.35 ×
 * clarity + 0.25 × match (0-10 each), minus 3 for a title over 70 characters
 * and 3 for a tease (publish_manifest TEASERS). Ties keep the model's order.
 * → [{title, curiosity, clarity, match, score}]
 */
export function rankTitles(options, scores = []) {
  const byTitle = new Map((Array.isArray(scores) ? scores : []).map((entry) => [String(entry?.title ?? "").trim(), entry]));
  const clamp = (value) => Math.max(0, Math.min(10, Number(value) || 0));
  return options.map((title, index) => {
    const entry = byTitle.get(title) ?? {};
    const parts = { curiosity: clamp(entry.curiosity), clarity: clamp(entry.clarity), match: clamp(entry.match) };
    const score = 0.4 * parts.curiosity + 0.35 * parts.clarity + 0.25 * parts.match - (title.length > 70 ? 3 : 0) - (TEASERS.test(title) ? 3 : 0);
    return { title, ...parts, score: Math.round(score * 100) / 100, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ index, ...entry }) => entry);
}

/** The angle a model returned, cleaned; null when it returned none. */
export function parseAngle(value) {
  if (!value || typeof value !== "object") return null;
  const text = (item) => String(item ?? "").trim();
  const angles = (Array.isArray(value.angles) ? value.angles : []).map((entry) => ({ angle: text(entry?.angle), differs: text(entry?.differs) })).filter((entry) => entry.angle).slice(0, 3);
  if (!text(value.crowded) || !angles.length) return null;
  const chosen = Number.isInteger(value.chosen) && value.chosen >= 0 && value.chosen < angles.length ? value.chosen : 0;
  return { crowded: text(value.crowded), inventory: (Array.isArray(value.inventory) ? value.inventory : []).map(text).filter(Boolean).slice(0, 12), angles, chosen };
}

/** Target words for a duration at WORDS_PER_MINUTE. */
export function targetWords(duration, wpm = WORDS_PER_MINUTE) {
  return Math.max(8, Math.round(Number(duration) * wpm / 60));
}

/**
 * options: {client, model, provider, prompt, notes: [text], rules (a collection's RULES.md text), assets: [line], transcripts: [text],
 *   duration, story ({concept, story}: the concept stage's winner; the script is written on it), words (target override), skeleton (a library skeleton: write on its beats), angle (keep this angle: a repair or resize), plan (a chooseScriptPlan() result, or its
 *   {format, goal, awareness, aspect, assets} inputs), resize: {measured_seconds, measured_words, previous},
 *   repair: {previous, errors: [{id, message, fix} | text]}}
 * → {schema_version, title, title_options, narration, beats, plan, word_target, word_count,
 *   usage, cost_usd, model, response_id}
 */
/** The heading a collection's RULES.md goes under, in the script pass, the brief and the critic. */
// What every script and chapter pass is told about its length.
export const LENGTH_CEILING = "The length is a ceiling, not a quota: when the brief has less to say, write fewer words and let the video run shorter. Never pad with recaps, hedges or filler to reach it.";

export const RULES_HEADING = "## Rules (the collection's own rules for every video: audience, tone, claims it may and may not make, words to avoid, things it never shows; keep every one)";

export async function writeScript(options = {}) {
  const { client, model = null, provider = null, prompt, notes = [], rules = null, assets = [], transcripts = [], duration, resize = null, repair = null } = options;
  if (!client) throw new Error("writeScript needs a model client");
  const given = options.plan ?? {};
  const planOptions = { prompt, duration, aspect: given.aspect, assets: given.assets, format: given.format, goal: given.goal, awareness: given.awareness, pace: given.pace, ctaKeyword: given.cta?.keyword ?? given.ctaKeyword, ctaOffer: given.cta?.offer ?? given.ctaOffer, episode: given.series?.episode ?? given.episode, choices: given.series?.choices ?? given.choices, words: options.words };
  const plan = options.skeleton ? skeletonScriptPlan(planOptions, options.skeleton) : chooseScriptPlan({ ...planOptions, skeleton: given.skeleton });
  const words = plan.word_target;
  const lines = [
    `Write the narration for this video, about ${words} words (it should run about ${duration} seconds read at ${plan.wpm} words a minute), as a ${plan.format} script on the ${plan.skeleton} skeleton.`,
    LENGTH_CEILING,
    "",
    "## Prompt",
    "",
    String(prompt).trim()
  ];
  if (notes.length) lines.push("", "## Notes from the assets folder", "", ...notes.map((text) => String(text).trim().slice(0, 6000)));
  if (rules && String(rules).trim()) lines.push("", RULES_HEADING, "", String(rules).trim().slice(0, 8000));
  if (assets.length) lines.push("", "## Assets the video can show", "", ...assets.map((line) => `- ${line}`));
  // The story the concept stage chose and edited (src/make/concept_story.js): the script is written on it.
  if (options.story?.story?.narration?.beats?.length) lines.push("", ...storyScriptSection(options.story));
  if (transcripts.length) lines.push("", "## Transcripts of supplied recordings", "", ...transcripts.map((text) => String(text).trim().slice(0, 4000)));
  // A repair or resize keeps the angle the first pass chose.
  if (options.angle?.angles?.length) {
    const chosen = options.angle.angles[options.angle.chosen] ?? options.angle.angles[0];
    lines.push("", "## Angle (keep it)", "", `Crowded take to avoid: ${options.angle.crowded}`, `The angle this script is written on: ${chosen.angle} (${chosen.differs})`, "Return the same angle object.");
  }
  if (resize?.previous) {
    lines.push("", "## Resize", "", `Your previous narration (${resize.measured_words} words) measured ${resize.measured_seconds}s when spoken; the target is ${duration}s. Rewrite it to about ${words} words, keeping its beats, hook and call to action.`, "", resize.previous);
  }
  if (repair?.previous) {
    const errors = [repair.errors ?? []].flat().map((error, index) => `${index + 1}. ${typeof error === "string" ? error : `[${error.id}] ${error.message} Fix: ${error.fix}`}`);
    lines.push("", "## Repair", "", `Your previous narration failed these script checks. Rewrite it to fix every one, keeping the plan's beats and what already works (the hook, the facts from the brief, the length), and return the beats and ${titleCount(plan) === 5 ? "five title options, best first," : "three title options"} again.`, "", ...errors, "", "Previous narration:", "", repair.previous);
  }
  const result = await client.runStructured({ instructions: scriptInstructions(plan), input: `${lines.join("\n")}\n`, schema: scriptSchema(plan), schemaName: "launchclip_make_script", model: undefined, maxOutputTokens: 6000 });
  const value = result?.value && typeof result.value === "object" ? result.value : parseText(result?.text);
  // Each beat keeps its role from the plan (a library skeleton's share beat is how the structure gate finds it).
  const beats = parseBeats(value?.beats).map((entry) => {
    const role = plan.beats.find((item) => item.id === entry.beat)?.role;
    return role ? { ...entry, role } : entry;
  });
  const narration = cleanNarration(value?.narration) || cleanNarration(beats.map((entry) => entry.text).join(" "));
  if (!narration) throw new Error("the script pass returned no narration text");
  const usage = result?.usage ?? {};
  const cost = estimateModelUsageCost(provider ?? client?.provider ?? "openai", result?.model ?? model, usage);
  let title = String(value?.title ?? "").trim().slice(0, 80) || "Untitled";
  let titleOptions = Array.isArray(value?.title_options) ? value.title_options.map((entry) => String(entry ?? "").trim().slice(0, 100)).filter(Boolean).slice(0, titleCount(plan)) : [];
  // Scored titles go best first, and the best becomes the title publish.json leads with.
  const titleScores = Array.isArray(value?.title_scores) && titleOptions.length ? rankTitles(titleOptions, value.title_scores) : null;
  if (titleScores) {
    titleOptions = titleScores.map((entry) => entry.title);
    title = titleOptions[0];
  }
  const angle = parseAngle(value?.angle);
  const postCaption = cleanCaption(value?.post_caption);
  return {
    schema_version: SCRIPT_VERSION,
    title,
    title_options: titleOptions.length ? titleOptions : [title],
    ...(titleScores ? { title_scores: titleScores } : {}),
    ...(angle ? { angle } : {}),
    ...(postCaption ? { description: postCaption } : {}),
    narration,
    beats,
    plan: { format: plan.format, goal: plan.goal, awareness: plan.awareness, skeleton: plan.skeleton, pace: plan.pace, voice_speed: plan.voice_speed, ...(plan.cta ? { cta: plan.cta } : {}), ...(plan.series ? { series: plan.series } : {}), wpm: plan.wpm, word_target: plan.word_target, word_ceiling: plan.word_ceiling, reasons: given.schema ? given.reasons : plan.reasons, ...(plan.structure ? { structure: { id: plan.structure.id, version: plan.structure.version } } : {}) },
    word_target: words,
    word_count: narration.split(/\s+/).filter(Boolean).length,
    usage,
    cost_usd: cost.estimated_usd,
    model: result?.model ?? model,
    response_id: result?.response_id ?? null
  };
}

/** The beats a model returned, cleaned; [] for a response without them. */
function parseBeats(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({ beat: String(entry?.beat ?? "").trim().toLowerCase(), text: cleanNarration(entry?.text) }))
    .filter((entry) => entry.beat && entry.text);
}

/** Strip markdown and stage directions a model may add anyway; the voice reads every character. */
export function cleanNarration(text) {
  return String(text ?? "")
    .replace(/\[[^\]]*\]|\([^)]*(?:pause|music|sfx|beat)[^)]*\)/gi, " ")
    .replace(/[*_#`>]+/g, " ")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3900);
}

/** A post caption: markdown and hashtags out, line breaks kept (one list item a line), at most 2,000 characters. */
export function cleanCaption(text) {
  return String(text ?? "")
    .replace(/[*_`>]+/g, "")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2000);
}

/**
 * The narration speed for a take: the voice settings' own speed wins; else an
 * ElevenLabs voice speaks at the plan's pace (plan.voice_speed). Kokoro and
 * the other providers keep their own defaults.
 */
export function planVoiceSpeed(provider, plan, given) {
  if (given !== undefined && given !== null) return given;
  return provider === "elevenlabs" && plan?.voice_speed != null ? plan.voice_speed : undefined;
}

/** Whether a measured take runs far enough over its target for one resize pass. A short take never does: the video runs shorter. */
export function needsResize(measuredSeconds, targetSeconds, tolerance = RESIZE_TOLERANCE) {
  return targetSeconds > 0 && (measuredSeconds - targetSeconds) / targetSeconds > tolerance;
}

/** Whether a take runs short of its target by more than the tolerance (reported, never padded). */
export function runsShort(measuredSeconds, targetSeconds, tolerance = RESIZE_TOLERANCE) {
  return targetSeconds > 0 && (targetSeconds - measuredSeconds) / targetSeconds > tolerance;
}

function parseText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
