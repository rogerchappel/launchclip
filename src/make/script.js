// Script pass for `launchclip make` (motion lane): the model writes the
// narration, sized to the target duration at about 150 words a minute, from
// the prompt, the notes, the asset descriptions and any transcripts. One
// optional resize pass corrects the length once the real take is measured.
import { estimateModelUsageCost } from "../cost_tracker.js";

export const SCRIPT_VERSION = "launchclip.make-script.v1";
export const WORDS_PER_MINUTE = 150;
// A take more than this far from the target duration triggers one resize pass.
export const RESIZE_TOLERANCE = 0.15;

export const SCRIPT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "narration"],
  properties: {
    title: { type: "string", description: "A short working title (≤ 60 characters)." },
    narration: { type: "string", description: "The complete voiceover text, plain sentences, no stage directions." }
  }
});

const INSTRUCTIONS = `You write voiceover scripts for short product and explainer videos.

Write narration that will be read aloud by a text-to-speech voice:
- Plain spoken sentences. No headings, bullet points, emoji, stage directions, sound cues or speaker labels.
- Open with a hook in the first sentence (a sharp claim, problem or question). End with one clear call to action.
- Concrete and specific: name the product, the problem, what it does, and one or two proof points. Use only facts given in the brief, notes and assets; never invent customers, metrics, prices or quotes. Illustrative numbers must be framed as examples.
- Short sentences (8–16 words) that each carry one idea, so each can own a scene.
- Spell out symbols as they should be spoken ("per cent", not "%"), and keep product names exactly as given.
- Hit the requested word count within ±10%.

Return only the JSON object.`;

/** Target words for a duration at WORDS_PER_MINUTE. */
export function targetWords(duration, wpm = WORDS_PER_MINUTE) {
  return Math.max(8, Math.round(Number(duration) * wpm / 60));
}

/**
 * options: {client, model, provider, prompt, notes: [text], assets: [line], transcripts: [text],
 *   duration, words (target override), resize: {measured_seconds, measured_words, previous}}
 * → {schema_version, title, narration, word_target, word_count, usage, cost_usd, model, response_id}
 */
export async function writeScript(options = {}) {
  const { client, model = null, provider = null, prompt, notes = [], assets = [], transcripts = [], duration, resize = null } = options;
  if (!client) throw new Error("writeScript needs a model client");
  const words = options.words ?? targetWords(duration);
  const lines = [
    `Write the narration for this video, about ${words} words (it should run about ${duration} seconds read at ${WORDS_PER_MINUTE} words a minute).`,
    "",
    "## Prompt",
    "",
    String(prompt).trim()
  ];
  if (notes.length) lines.push("", "## Notes from the assets folder", "", ...notes.map((text) => String(text).trim().slice(0, 6000)));
  if (assets.length) lines.push("", "## Assets the video can show", "", ...assets.map((line) => `- ${line}`));
  if (transcripts.length) lines.push("", "## Transcripts of supplied recordings", "", ...transcripts.map((text) => String(text).trim().slice(0, 4000)));
  if (resize?.previous) {
    lines.push("", "## Resize", "", `Your previous narration (${resize.measured_words} words) measured ${resize.measured_seconds}s when spoken; the target is ${duration}s. Rewrite it to about ${words} words, keeping its structure, hook and call to action.`, "", resize.previous);
  }
  const result = await client.runStructured({ instructions: INSTRUCTIONS, input: `${lines.join("\n")}\n`, schema: SCRIPT_SCHEMA, schemaName: "launchclip_make_script", model: undefined, maxOutputTokens: 6000 });
  const value = result?.value && typeof result.value === "object" ? result.value : parseText(result?.text);
  const narration = cleanNarration(value?.narration);
  if (!narration) throw new Error("the script pass returned no narration text");
  const usage = result?.usage ?? {};
  const cost = estimateModelUsageCost(provider ?? client?.provider ?? "openai", result?.model ?? model, usage);
  return {
    schema_version: SCRIPT_VERSION,
    title: String(value?.title ?? "").trim().slice(0, 80) || "Untitled",
    narration,
    word_target: words,
    word_count: narration.split(/\s+/).filter(Boolean).length,
    usage,
    cost_usd: cost.estimated_usd,
    model: result?.model ?? model,
    response_id: result?.response_id ?? null
  };
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
