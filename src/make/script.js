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
import { MAX_WORDS_PER_SECOND, PACES, SHORT_VIDEO_SECONDS, chooseScriptPlan, scriptPlanLines, scriptRuleLines } from "@launchclip/core/script-formats.mjs";
import { NARRATED_SCRIPT_VERSION, SCREENPLAY_VERSION } from "@launchclip/core/screenplay.mjs";
import { skeletonScriptPlan } from "@launchclip/core/skeleton-library.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { checkScript, countWords, splitSentences } from "../script_check.js";
import { TEASERS } from "../publish_manifest.js";
import { storyScriptSection } from "./concept_story.js";

// SCRIPT.json has two versions (kit/core/screenplay.mjs). This narrated script
// pass writes version 1: a title, one narration string and its beats, whose
// ids are the script skeleton's (hook, problem, cta, …). Version 2 adds
// speakers and silent lines on story beats, and reads a version 1 file as
// all-narrator, so a script written here stays readable.
export const SCRIPT_VERSION = NARRATED_SCRIPT_VERSION;
export { SCREENPLAY_VERSION };
export const WORDS_PER_MINUTE = 150;
// A take more than this far over the target duration triggers one resize pass. The
// duration is a ceiling (docs/MAKE_SKILL_PARITY.md, phase 4): a take that runs
// short is never resized, because the only way to lengthen it is to pad it.
export const RESIZE_TOLERANCE = 0.15;

// The call to action is a field of its own, so a script cannot leave it out:
// when the narration has none, tooling ends the script on this sentence.
const CALL_TO_ACTION_SCHEMA = Object.freeze({ type: "string", description: "The one spoken sentence that asks the viewer to act, word for word as the narration ends on it. It starts with the verb (\"Save this before your next bake.\", \"Follow for the next one.\", \"Try it free at example.com.\", \"Comment DECK and I'll send you the checklist.\"). Empty only when the plan says a call to action is optional and the script has none." });

// title and narration are all an older response carries; title_options and
// beats came with the planning pass and are optional when parsing.
export const SCRIPT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "narration", "title_options", "beats", "call_to_action"],
  properties: {
    call_to_action: CALL_TO_ACTION_SCHEMA,
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

// A fast draft's script (make --speed draft): one streamed call, so only what the draft needs is asked for, in the order a
// host can show it: the title, the narration beat by beat, the call to action. No angle, title scores or post caption.
export const DRAFT_SCRIPT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "beats", "call_to_action"],
  properties: {
    title: SCRIPT_SCHEMA.properties.title,
    beats: { ...SCRIPT_SCHEMA.properties.beats, description: "The narration, split into the plan's beats, in order: the beats' text joined is the whole voiceover." },
    call_to_action: CALL_TO_ACTION_SCHEMA
  }
});

/** The script pass instructions for a fast draft: the same plan and rules, and a short answer. */
export function draftScriptInstructions(plan) {
  return [ROLE, "", "## Plan", "", ...scriptPlanLines(plan), "", "## Rules", "", ...scriptRuleLines(plan).map((line) => `- ${line}`), "", `Output:
- title: a short working title.
- beats: the narration split by beat id, in the plan's order; their text joined is the whole script. Plain spoken sentences only.
- call_to_action: the sentence the narration ends on that asks the viewer to act, word for word.
- Length is a hard limit: ${plan.word_ceiling} words at most, about ${plan.word_target} is right. Tooling cuts whole sentences from a script that is over.
- Return only the JSON object.`].join("\n");
}

/**
 * The sentences of a draft script as its JSON arrives: feed(piece) → the
 * sentences that piece completed, in order. A sentence is complete when its
 * beat's text has closed, or when another sentence has started after it.
 */
export function sentenceStream() {
  let raw = "";
  let sent = 0;
  return {
    feed(piece) {
      raw += String(piece ?? "");
      const done = [];
      const pattern = /"text"\s*:\s*"/g;
      for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
        let end = match.index + match[0].length;
        while (end < raw.length && raw[end] !== "\"") end += raw[end] === "\\" ? 2 : 1;
        const closed = end < raw.length;
        let body = raw.slice(match.index + match[0].length, Math.min(end, raw.length));
        // An escape cut in two by the stream waits for its other half.
        if (!closed) body = body.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
        let text;
        try { text = JSON.parse(`"${body}"`); } catch { break; }
        const sentences = sentencesOf(cleanNarration(text));
        done.push(...(closed ? sentences : sentences.slice(0, -1)));
        if (!closed) break;
        pattern.lastIndex = end + 1;
      }
      const fresh = done.slice(sent);
      sent = Math.max(sent, done.length);
      return fresh;
    }
  };
}

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

const output = (titles, plan) => `Output:
- narration: the whole script. beats: the same sentences split by beat id, in the plan's order; their text joined is the narration.
- call_to_action: the sentence the narration ends on that asks the viewer to act, word for word. A script without one is not finished: tooling adds a plain one.
- title: a short working title. title_options: ${titles} publish-ready titles the video pays off.
- Length is a hard limit: ${plan?.word_ceiling ? `${plan.word_ceiling} words at most, about ${plan.word_target} is right` : "the plan's ceiling"}. Count the words of the narration before you answer and cut until it fits; tooling cuts whole sentences from a script that is over, and it will not choose as well as you.
- Return only the JSON object.`;

/** How many title options a plan asks for: five, best first, for a short video; else three. */
export const titleCount = (plan) => (Number(plan?.duration) <= SHORT_VIDEO_SECONDS ? 5 : 3);

/** The script pass instructions for a plan (chooseScriptPlan() or skeletonScriptPlan()). */
export function scriptInstructions(plan) {
  const short = isShort(plan) ? ["", ...ANGLE_LINES, "", ...TITLE_LINES, "", ...POST_LINES(plan)] : [];
  return [ROLE, "", "## Plan", "", ...scriptPlanLines(plan), "", "## Rules", "", ...scriptRuleLines(plan).map((line) => `- ${line}`), ...short, "", output(titleCount(plan) === 5 ? "five, the best first," : "three", plan)].join("\n");
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

// The plan's inputs the script checks read (src/script_check.js).
const planChecks = (plan) => ({ format: plan.format, goal: plan.goal, awareness: plan.awareness, pace: plan.pace, ...(plan.cta?.keyword ? { ctaKeyword: plan.cta.keyword } : {}), ...(plan.series?.choices ? { choices: plan.series.choices } : {}) });
const sentencesOf = (text) => splitSentences(String(text ?? "")).map((sentence) => sentence.text.trim()).filter(Boolean);
const hasNoCta = (narration, plan) => checkScript({ narration, duration: plan.duration, ...planChecks(plan) }).errors.some((error) => error.id === "cta-missing");
const joinOr = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);

/** The plain call to action tooling ends a script on when the writer gave none the checks recognise. */
export function defaultCallToAction(plan) {
  if (plan?.series?.choices?.length) return `Comment ${joinOr(plan.series.choices)}. One word.`;
  if (plan?.cta?.keyword && plan.cta.offer) return `Comment ${String(plan.cta.keyword).toUpperCase()} and I'll send you ${plan.cta.offer}.`;
  return plan?.goal === "convert" ? "Try it today." : "Save this for later.";
}

/**
 * A script cannot omit its call to action: when the checks find none in the
 * narration, it ends on the writer's own call_to_action sentence, or, when
 * that is empty or not an ask the checks recognise, on defaultCallToAction().
 * A story may end without one (kit/core/script-formats.mjs), so a story is
 * left alone. script: {narration, beats}. → {narration, beats, added} (added:
 * the sentence, or null).
 */
export function ensureCallToAction(script, plan, callToAction = "") {
  const narration = String(script?.narration ?? "").trim();
  const beats = Array.isArray(script?.beats) ? script.beats : [];
  if (!narration || !plan || plan.format === "story" || !hasNoCta(narration, plan)) return { narration, beats, added: null };
  const own = sentencesOf(cleanNarration(callToAction)).slice(0, 1).join(" ");
  const sentence = [own, defaultCallToAction(plan)].filter(Boolean).map((text) => (/[.!?]$/.test(text) ? text : `${text}.`)).find((text) => !hasNoCta(`${narration} ${text}`, plan));
  if (!sentence) return { narration, beats, added: null };
  const next = beats.map((entry) => ({ ...entry }));
  if (next.length) next[next.length - 1].text = `${next[next.length - 1].text} ${sentence}`.trim();
  return { narration: `${narration} ${sentence}`, beats: next, added: sentence };
}

/**
 * The word ceiling is a hard limit: a narration over it is cut to fit, whole
 * sentences only (never inside one). The first sentence (the hook) and the
 * last (the call to action) stay. Each cut takes the last sentence of the
 * beat furthest over its own word budget (the call to action not counted),
 * and never a beat's only sentence while another beat has two; so the
 * elaboration goes first and every beat keeps its turn. Without beats the
 * narration is one beat.
 * script: {narration, beats}; plan: {word_ceiling, beats: [{id, words}]}.
 * → {narration, beats, cut: [sentence], words}
 */
export function fitWordBudget(script, plan) {
  const ceiling = Number(plan?.word_ceiling);
  const given = Array.isArray(script?.beats) && script.beats.length ? script.beats : [{ beat: null, text: String(script?.narration ?? "") }];
  const groups = given.map((entry) => ({ entry, sentences: sentencesOf(entry.text) }));
  const total = () => groups.reduce((sum, group) => sum + group.sentences.reduce((n, text) => n + countWords(text), 0), 0);
  const cut = [];
  const whole = () => ({ narration: groups.flatMap((group) => group.sentences).join(" "), beats: script?.beats?.length ? groups.filter((group) => group.sentences.length).map((group) => ({ ...group.entry, text: group.sentences.join(" ") })) : [], cut, words: total() });
  if (!(ceiling > 0) || total() <= ceiling) return { narration: String(script?.narration ?? "").trim(), beats: Array.isArray(script?.beats) ? script.beats : [], cut, words: total() };
  const budgets = new Map((plan.beats ?? []).map((item) => [item.id, Number(item.words) || 0]));
  const lastGroup = groups.length - 1;
  // The sentences of a beat that carry its turn: all of them, but the script's last sentence (the call to action) is not one of the last beat's.
  const own = (group, index) => (index === lastGroup ? group.sentences.slice(0, -1) : group.sentences);
  while (total() > ceiling) {
    const spare = groups.some((group, index) => own(group, index).length > 1);
    let pick = null;
    groups.forEach((group, index) => {
      const mine = own(group, index);
      // What may go: never the script's first sentence, and never a beat's only sentence while another beat has two.
      const from = index === 0 ? 1 : 0;
      if (mine.length <= from || (spare && mine.length < 2)) return;
      const words = mine.reduce((n, text) => n + countWords(text), 0);
      const over = words - (budgets.get(group.entry.beat) ?? words / 2);
      if (!pick || over > pick.over) pick = { group, at: mine.length - 1, over };
    });
    if (!pick) break;
    cut.push(pick.group.sentences.splice(pick.at, 1)[0]);
  }
  return whole();
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
    `Write the narration for this video, about ${words} words and never more than ${plan.word_ceiling} (it should run about ${duration} seconds read at ${plan.wpm} words a minute), as a ${plan.format} script on the ${plan.skeleton} skeleton.`,
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
    lines.push("", "## Repair", "", `Your previous narration failed these script checks. Rewrite it to fix every one, keeping the plan's beats and what already works (the hook, the facts from the brief), inside the word ceiling of ${plan.word_ceiling}, and return the beats and ${titleCount(plan) === 5 ? "five title options, best first," : "three title options"} again.`, "", ...errors, "", "Previous narration:", "", repair.previous);
  }
  // draft ({reasoning?, onSentence?}): a fast draft's one call (make --speed draft), streamed where the client can, each sentence handed over as it completes.
  const draft = options.draft ?? null;
  const stream = draft ? sentenceStream() : null;
  const result = await client.runStructured(draft
    ? { instructions: draftScriptInstructions(plan), input: `${lines.join("\n")}\n`, schema: DRAFT_SCRIPT_SCHEMA, schemaName: "launchclip_make_draft_script", model: draft.model ?? undefined, maxOutputTokens: 3000, ...(draft.reasoning ? { reasoningEffort: draft.reasoning } : {}), onDelta: (piece) => { for (const sentence of stream.feed(piece)) draft.onSentence?.(sentence); } }
    : { instructions: scriptInstructions(plan), input: `${lines.join("\n")}\n`, schema: scriptSchema(plan), schemaName: "launchclip_make_script", model: undefined, maxOutputTokens: 6000 });
  const value = result?.value && typeof result.value === "object" ? result.value : parseText(result?.text);
  // Each beat keeps its role from the plan (a library skeleton's share beat is how the structure gate finds it).
  const beats = parseBeats(value?.beats).map((entry) => {
    const role = plan.beats.find((item) => item.id === entry.beat)?.role;
    return role ? { ...entry, role } : entry;
  });
  const written = cleanNarration(value?.narration) || cleanNarration(beats.map((entry) => entry.text).join(" "));
  if (!written) throw new Error("the script pass returned no narration text");
  // The two things a script cannot get wrong: it ends on a call to action, and it fits the word ceiling (cut by whole sentences).
  const asked = ensureCallToAction({ narration: written, beats }, plan, value?.call_to_action);
  const fitted = fitWordBudget(asked, plan);
  const narration = fitted.narration;
  beats.splice(0, beats.length, ...fitted.beats);
  const fit = asked.added || fitted.cut.length ? { ...(asked.added ? { call_to_action_added: asked.added } : {}), ...(fitted.cut.length ? { cut: fitted.cut, words_before: countWords(asked.narration) } : {}) } : null;
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
    ...(fit ? { fit } : {}),
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

/**
 * The clock the final script check runs on, for a measured take. A take that
 * runs short is checked at the length it runs, and it is its own proof that
 * the words fit that time: a voice that reads faster than the plan's pace
 * (Kokoro at 1.2×) is held to the rate it spoke at, never told its words
 * "cannot be read" in the seconds it read them in. → {duration, limits?}
 */
export function takeClock({ narration, seconds, target, pace = null }) {
  if (!runsShort(seconds, target)) return { duration: target };
  const duration = Math.max(1, Math.round(seconds));
  const spoken = Math.ceil(countWords(String(narration ?? "")) / duration * 100) / 100;
  return { duration, limits: { wordsPerSecond: Math.max(PACES[pace]?.ceiling ?? MAX_WORDS_PER_SECOND, spoken) } };
}

function parseText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
