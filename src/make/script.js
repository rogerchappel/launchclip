// Script pass for `launchclip make` (motion lane): a planning pass picks the
// format, goal and awareness (kit/core/script-formats.mjs: --format, --goal,
// --awareness, or a deterministic default from the brief), then the model
// writes the narration against that format's beat skeleton and word budget,
// from the prompt, the notes, the asset descriptions and any transcripts. One
// optional repair pass fixes the script checks' errors (src/script_check.js),
// and one optional resize pass corrects the length once the real take is
// measured. On a library skeleton (kit/core/skeleton-library.mjs) the script
// is written on its beats; a short video asks for five title options, best first.
import { SHORT_VIDEO_SECONDS, chooseScriptPlan, scriptPlanLines, scriptRuleLines } from "../../kit/core/script-formats.mjs";
import { skeletonScriptPlan } from "../../kit/core/skeleton-library.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";

export const SCRIPT_VERSION = "launchclip.make-script.v1";
export const WORDS_PER_MINUTE = 150;
// A take more than this far from the target duration triggers one resize pass.
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

const ROLE = `You write voiceover scripts for short product, explainer and story videos. A planning pass has already chosen the format, goal, awareness and beat skeleton below; write against it.

Write narration that will be read aloud by a text-to-speech voice:
- Plain spoken sentences. No headings, bullet points, emoji, stage directions, sound cues or speaker labels.
- Each sentence can own a scene: make every one concrete, and keep product names exactly as given.`;

const output = (titles) => `Output:
- narration: the whole script. beats: the same sentences split by beat id, in the plan's order; their text joined is the narration.
- title: a short working title. title_options: ${titles} publish-ready titles the video pays off.
- Hit the word budget within ±10%. Return only the JSON object.`;

/** How many title options a plan asks for: five, best first, for a short video; else three. */
export const titleCount = (plan) => (Number(plan?.duration) <= SHORT_VIDEO_SECONDS ? 5 : 3);

/** The script pass instructions for a plan (chooseScriptPlan() or skeletonScriptPlan()). */
export function scriptInstructions(plan) {
  return [ROLE, "", "## Plan", "", ...scriptPlanLines(plan), "", "## Rules", "", ...scriptRuleLines(plan).map((line) => `- ${line}`), "", output(titleCount(plan) === 5 ? "five, the best first," : "three")].join("\n");
}

/** Target words for a duration at WORDS_PER_MINUTE. */
export function targetWords(duration, wpm = WORDS_PER_MINUTE) {
  return Math.max(8, Math.round(Number(duration) * wpm / 60));
}

/**
 * options: {client, model, provider, prompt, notes: [text], rules (a collection's RULES.md text), assets: [line], transcripts: [text],
 *   duration, words (target override), skeleton (a library skeleton: write on its beats), plan (a chooseScriptPlan() result, or its
 *   {format, goal, awareness, aspect, assets} inputs), resize: {measured_seconds, measured_words, previous},
 *   repair: {previous, errors: [{id, message, fix} | text]}}
 * → {schema_version, title, title_options, narration, beats, plan, word_target, word_count,
 *   usage, cost_usd, model, response_id}
 */
/** The heading a collection's RULES.md goes under, in the script pass, the brief and the critic. */
export const RULES_HEADING = "## Rules (the collection's own rules for every video: audience, tone, claims it may and may not make, words to avoid, things it never shows; keep every one)";

export async function writeScript(options = {}) {
  const { client, model = null, provider = null, prompt, notes = [], rules = null, assets = [], transcripts = [], duration, resize = null, repair = null } = options;
  if (!client) throw new Error("writeScript needs a model client");
  const given = options.plan ?? {};
  const planOptions = { prompt, duration, aspect: given.aspect, assets: given.assets, format: given.format, goal: given.goal, awareness: given.awareness, words: options.words };
  const plan = options.skeleton ? skeletonScriptPlan(planOptions, options.skeleton) : chooseScriptPlan({ ...planOptions, skeleton: given.skeleton });
  const words = plan.word_target;
  const lines = [
    `Write the narration for this video, about ${words} words (it should run about ${duration} seconds read at ${plan.wpm} words a minute), as a ${plan.format} script on the ${plan.skeleton} skeleton.`,
    "",
    "## Prompt",
    "",
    String(prompt).trim()
  ];
  if (notes.length) lines.push("", "## Notes from the assets folder", "", ...notes.map((text) => String(text).trim().slice(0, 6000)));
  if (rules && String(rules).trim()) lines.push("", RULES_HEADING, "", String(rules).trim().slice(0, 8000));
  if (assets.length) lines.push("", "## Assets the video can show", "", ...assets.map((line) => `- ${line}`));
  if (transcripts.length) lines.push("", "## Transcripts of supplied recordings", "", ...transcripts.map((text) => String(text).trim().slice(0, 4000)));
  if (resize?.previous) {
    lines.push("", "## Resize", "", `Your previous narration (${resize.measured_words} words) measured ${resize.measured_seconds}s when spoken; the target is ${duration}s. Rewrite it to about ${words} words, keeping its beats, hook and call to action.`, "", resize.previous);
  }
  if (repair?.previous) {
    const errors = [repair.errors ?? []].flat().map((error, index) => `${index + 1}. ${typeof error === "string" ? error : `[${error.id}] ${error.message} Fix: ${error.fix}`}`);
    lines.push("", "## Repair", "", `Your previous narration failed these script checks. Rewrite it to fix every one, keeping the plan's beats and what already works (the hook, the facts from the brief, the length), and return the beats and ${titleCount(plan) === 5 ? "five title options, best first," : "three title options"} again.`, "", ...errors, "", "Previous narration:", "", repair.previous);
  }
  const result = await client.runStructured({ instructions: scriptInstructions(plan), input: `${lines.join("\n")}\n`, schema: SCRIPT_SCHEMA, schemaName: "launchclip_make_script", model: undefined, maxOutputTokens: 6000 });
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
  const title = String(value?.title ?? "").trim().slice(0, 80) || "Untitled";
  const titleOptions = Array.isArray(value?.title_options) ? value.title_options.map((entry) => String(entry ?? "").trim().slice(0, 100)).filter(Boolean).slice(0, titleCount(plan)) : [];
  return {
    schema_version: SCRIPT_VERSION,
    title,
    title_options: titleOptions.length ? titleOptions : [title],
    narration,
    beats,
    plan: { format: plan.format, goal: plan.goal, awareness: plan.awareness, skeleton: plan.skeleton, wpm: plan.wpm, word_target: plan.word_target, word_ceiling: plan.word_ceiling, reasons: given.schema ? given.reasons : plan.reasons, ...(plan.structure ? { structure: { id: plan.structure.id, version: plan.structure.version } } : {}) },
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

/** Whether a measured take needs one resize pass. */
export function needsResize(measuredSeconds, targetSeconds, tolerance = RESIZE_TOLERANCE) {
  return targetSeconds > 0 && Math.abs(measuredSeconds - targetSeconds) / targetSeconds > tolerance;
}

function parseText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
