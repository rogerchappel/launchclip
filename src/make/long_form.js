// Long-form `launchclip make` (docs/LONG_FORM_MAKE_RFC.md): a motion video
// over 3 minutes is written, voiced and planned in chapters, so no step grows
// with the video's length.
//
//   outline (one call: title, chapters with their point, facts and seconds)
//     → chapter scripts (one call each, in order, each handed the last lines
//       of the one before) → a take per chapter → one joined voice and
//       NARRATION.json → the beat director (kit/core/beat-director.mjs) plans
//       the visuals → beatMapToStory → finish.
//
// The model writes words only. Chapter lengths are fitted by tooling, the
// first chapter's measured pace sets every later word target, and a chapter
// more than RESIZE_TOLERANCE off its seconds gets one resize pass.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { cleanNarration, RESIZE_TOLERANCE, RULES_HEADING, WORDS_PER_MINUTE } from "./script.js";

const run = promisify(execFile);

export const LONG_FORM_VERSION = "launchclip.make-long-form.v1";
// Silence between chapter takes, in seconds.
export const CHAPTER_GAP = 0.6;
// A chapter's planned length: long enough to make a point, short enough for one call.
export const CHAPTER_SECONDS = Object.freeze({ min: 45, max: 180 });
export const LONG_FORM_VOICE = "assets/audio/long-form-voice.wav";
const SAMPLE_RATE = 48000;

/** How many chapters a video of `seconds` gets: about one per 90 s, 3 to 12. */
export function chapterCount(seconds) {
  return Math.max(3, Math.min(12, Math.round(Number(seconds) / 90)));
}

const OUTLINE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "title_options", "chapters"],
  properties: {
    title: { type: "string", description: "The video's title (≤ 70 characters)." },
    title_options: { type: "array", description: "Three publish-ready titles, best first, each naming what the video delivers.", items: { type: "string" } },
    chapters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "point", "facts", "seconds"],
        properties: {
          title: { type: "string", description: "A short chapter title (≤ 50 characters), shown on screen." },
          point: { type: "string", description: "The one thing this chapter makes the viewer understand." },
          facts: { type: "array", description: "The concrete names, numbers and dates this chapter uses, taken from the prompt or the notes only.", items: { type: "string" } },
          seconds: { type: "number", description: "How long this chapter runs when read aloud." }
        }
      }
    }
  }
});

const CHAPTER_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["narration"],
  properties: { narration: { type: "string", description: "This chapter's narration only, as plain spoken sentences." } }
});

const VOICE_RULES = `Write narration that will be read aloud by a text-to-speech voice:
- Plain spoken sentences. No headings, bullet points, emoji, stage directions, sound cues or speaker labels.
- Make every sentence concrete: a name, a number, a date or a thing on screen. Keep names exactly as the sources give them.
- Use only facts from the prompt and the notes. Never invent a figure, a quote or a source; leave out anything the notes don't state.`;

const OUTLINE_ROLE = `You outline long-form explainer videos (3 to 20 minutes) for narration over motion graphics. The video is told in chapters; each makes one point with its own facts, and together they build to a payoff.

- The first chapter is a cold open under 40 seconds: the most surprising fact and why it matters, then what the video will cover.
- The last chapter lands the payoff: what it all means and what to watch next.
- Spread the facts so no chapter is thin; a chapter with nothing concrete to say should not exist.
- Chapter seconds add up to the target length.
Return only the JSON object.`;

const CHAPTER_ROLE = `You write one chapter of a long-form explainer video's narration, following an outline someone else wrote. Continue from where the previous chapter left off, without recapping it or greeting the viewer again, and hand on to the next chapter naturally. Only the last chapter closes the video.

${VOICE_RULES}
Return only the JSON object.`;

function sharedContext({ prompt, notes = [], rules = null, assets = [] }) {
  const lines = ["## Prompt", "", String(prompt).trim()];
  if (notes.length) lines.push("", "## Notes from the assets folder", "", ...notes.map((text) => String(text).trim().slice(0, 6000)));
  if (rules && String(rules).trim()) lines.push("", RULES_HEADING, "", String(rules).trim().slice(0, 8000));
  if (assets.length) lines.push("", "## Assets the video can show", "", ...assets.map((line) => `- ${line}`));
  return lines;
}

function usageCost(result, client, provider, model) {
  const usage = result?.usage ?? {};
  return { usage, cost_usd: estimateModelUsageCost(provider ?? client?.provider ?? "openai", result?.model ?? model, usage).estimated_usd, model: result?.model ?? model };
}

/**
 * The outline. options: {client, model, provider, prompt, notes, rules, assets, duration}.
 * → {title, title_options, chapters: [{title, point, facts, seconds}], usage, cost_usd, model}, fitted to the duration.
 */
export async function writeOutline(options = {}) {
  const { client, model = null, provider = null, duration } = options;
  if (!client) throw new Error("writeOutline needs a model client");
  const count = chapterCount(duration);
  const input = [
    `Outline a ${Math.round(duration / 60)}-minute video (${duration} seconds) in about ${count} chapters, each ${CHAPTER_SECONDS.min}–${CHAPTER_SECONDS.max} seconds.`,
    "",
    ...sharedContext(options)
  ].join("\n");
  const result = await client.runStructured({ instructions: OUTLINE_ROLE, input: `${input}\n`, schema: OUTLINE_SCHEMA, schemaName: "launchclip_long_form_outline", model: undefined, maxOutputTokens: 6000 });
  const value = result?.value && typeof result.value === "object" ? result.value : null;
  const outline = fitOutline(value, duration);
  return { ...outline, ...usageCost(result, client, provider, model) };
}

/**
 * Tooling's half of the outline: clean titles, drop chapters with no point,
 * and fit the seconds so they add up to the duration with every chapter
 * between CHAPTER_SECONDS.min and .max. Throws only when fewer than two
 * chapters are left.
 */
export function fitOutline(value, duration) {
  const title = String(value?.title ?? "").trim().slice(0, 80) || "Untitled";
  const options = Array.isArray(value?.title_options) ? value.title_options.map((entry) => String(entry ?? "").trim().slice(0, 100)).filter(Boolean).slice(0, 3) : [];
  const chapters = (Array.isArray(value?.chapters) ? value.chapters : [])
    .map((entry) => ({
      title: String(entry?.title ?? "").trim().slice(0, 60),
      point: String(entry?.point ?? "").trim().slice(0, 400),
      facts: Array.isArray(entry?.facts) ? entry.facts.map((fact) => String(fact ?? "").trim().slice(0, 300)).filter(Boolean).slice(0, 12) : [],
      seconds: Number(entry?.seconds) > 0 ? Number(entry.seconds) : 0
    }))
    .filter((entry) => entry.title && entry.point);
  if (chapters.length < 2) throw new Error(`the outline has ${chapters.length} usable chapter(s); a long video needs at least 2`);
  // Missing seconds share the rest evenly; then every chapter scales to the duration and is clamped.
  const given = chapters.reduce((sum, entry) => sum + entry.seconds, 0);
  const missing = chapters.filter((entry) => !entry.seconds);
  for (const entry of missing) entry.seconds = Math.max(CHAPTER_SECONDS.min, (duration - given) / missing.length);
  const total = chapters.reduce((sum, entry) => sum + entry.seconds, 0);
  for (const entry of chapters) entry.seconds = Math.round(Math.max(CHAPTER_SECONDS.min, Math.min(CHAPTER_SECONDS.max, entry.seconds * duration / total)));
  return { title, title_options: options.length ? [...new Set([title, ...options])].slice(0, 3) : [title], chapters };
}

/**
 * One chapter's narration. options: {client, model, provider, prompt, notes,
 * rules, assets, outline, index, previous (the last sentences before this
 * chapter), words (target), resize: {previous, measured_words, measured_seconds}}.
 * → {narration, word_count, word_target, usage, cost_usd, model}
 */
export async function writeChapter(options = {}) {
  const { client, model = null, provider = null, outline, index, previous = null, words, resize = null } = options;
  if (!client) throw new Error("writeChapter needs a model client");
  const chapter = outline.chapters[index];
  const last = index === outline.chapters.length - 1;
  const lines = [
    `Write chapter ${index + 1} of ${outline.chapters.length}, "${chapter.title}", in about ${words} words (about ${chapter.seconds} seconds read aloud).`,
    "",
    "## This chapter",
    "",
    `Point: ${chapter.point}`,
    ...(chapter.facts.length ? ["Facts to use:", ...chapter.facts.map((fact) => `- ${fact}`)] : []),
    "",
    "## The whole outline",
    "",
    `Video: ${outline.title}`,
    ...outline.chapters.map((entry, i) => `${i + 1}. ${entry.title}: ${entry.point}${i === index ? "  ← this chapter" : ""}`),
    "",
    previous ? `## Where the previous chapter ended\n\n${previous}` : "## This is the opening chapter: start on the hook, with no greeting.",
    ...(last ? ["", "This is the last chapter: land the payoff and close the video in one or two sentences."] : []),
    "",
    ...sharedContext(options)
  ];
  if (resize?.previous) lines.push("", "## Resize", "", `Your previous version (${resize.measured_words} words) ran ${resize.measured_seconds}s when spoken; the chapter should run about ${chapter.seconds}s. Rewrite it to about ${words} words, keeping its facts and its handoff.`, "", resize.previous);
  const result = await client.runStructured({ instructions: CHAPTER_ROLE, input: `${lines.join("\n")}\n`, schema: CHAPTER_SCHEMA, schemaName: "launchclip_long_form_chapter", model: undefined, maxOutputTokens: 4000 });
  const narration = cleanNarration(result?.value?.narration);
  if (!narration) throw new Error(`the chapter pass returned no narration for chapter ${index + 1} ("${chapter.title}")`);
  return { narration, word_count: wordCount(narration), word_target: words, ...usageCost(result, client, provider, model) };
}

export function wordCount(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}

/** The word target for `seconds` at a measured pace (words per minute), else the default. */
export function chapterWords(seconds, wpm = WORDS_PER_MINUTE) {
  return Math.max(40, Math.round(seconds * (wpm || WORDS_PER_MINUTE) / 60));
}

/** Whether a chapter's take is far enough off its seconds for one resize pass. */
export function chapterNeedsResize(measured, target) {
  return target > 0 && Math.abs(measured - target) / target > RESIZE_TOLERANCE;
}

/** The last two sentences of a narration: the next chapter's handoff. */
export function narrationTail(text) {
  const sentences = String(text ?? "").match(/[^.!?]+[.!?]+["”’)]?/g) ?? [String(text ?? "")];
  return sentences.slice(-2).map((sentence) => sentence.trim()).join(" ");
}

/**
 * Chapter takes on one clock: each take's words offset by the takes and gaps
 * before it. takes: [{id, title, duration, words}]. → {words, chapters: [{id,
 * title, start, end}], duration}; a chapter after the first starts just before
 * its first word, as the beat director expects.
 */
export function joinTakes(takes, gap = CHAPTER_GAP) {
  const words = [];
  const chapters = [];
  let offset = 0;
  takes.forEach((take, i) => {
    const start = i === 0 ? 0 : round3(Math.max(0, offset - 0.2));
    for (const word of take.words) words.push({ ...word, start: round3(word.start + offset), end: round3(word.end + offset) });
    chapters.push({ id: take.id, title: take.title, start, end: round3(offset + take.duration) });
    offset += take.duration + (i < takes.length - 1 ? gap : 0);
  });
  return { words, chapters, duration: round3(offset) };
}

/** Chapter ids the beat director and the story use: c1-<slug>, unique. */
export function chapterId(title, index) {
  const slug = String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return `c${index + 1}${slug ? `-${slug}` : ""}`;
}

/** SCRIPT.md for a long video: `# Title`, then `## Chapter` over its narration (parseScript reads it). */
export function scriptMarkdown(title, chapters) {
  return `# ${title}\n\n${chapters.map((chapter) => `## ${chapter.title}\n\n${chapter.narration}\n`).join("\n")}`;
}

/** Join chapter takes (WAV files) into one voice track with CHAPTER_GAP of silence between them. */
export async function joinVoice(files, out, { gap = CHAPTER_GAP, runCommand = run } = {}) {
  const parts = files.map((_, i) => `[${i}:a]aresample=${SAMPLE_RATE},aformat=channel_layouts=mono${i < files.length - 1 ? `,apad=pad_dur=${gap}` : ""}[a${i}]`);
  const filter = `${parts.join(";")};${files.map((_, i) => `[a${i}]`).join("")}concat=n=${files.length}:v=0:a=1[out]`;
  await runCommand("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...files.flatMap((file) => ["-i", file]), "-filter_complex", filter, "-map", "[out]", "-ar", String(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", out], { maxBuffer: 8 * 1024 * 1024 });
  return out;
}

function round3(value) { return Math.round(value * 1000) / 1000; }
