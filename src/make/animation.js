// The writers' room for `launchclip make --animation`
// (docs/ANIMATION_PIPELINE_RFC.md §4.1, §6.1): three small structured calls
// and one repair pass turn a prompt into a screenplay, SCRIPT.json version 2
// (kit/core/screenplay.mjs): a script with speakers and silent lines.
//
//   1. writePremise    the premise (want, obstacle, change), who is in it, and
//                      three to five loglines
//   2. judgeLoglines   a second call that sees only the brief and the
//                      loglines, never the writer's notes: it scores each one,
//                      and the best score is the story
//   3. writeScreenplay the script, on the six story beats (and a library
//                      skeleton's structure when one fits)
//   repair             writeScreenplay again with the check's errors, once
//
// writersRoom() runs the three and checks the result (src/script_check.js
// checkScreenplay); repairScreenplay() is the repair pass. Neither touches
// disk or the voice: make's prepare stage (src/make/index.js) caches the
// script, voices it and decides when the one repair is spent.
//
// The model returns every line with the same five fields (strict JSON schemas
// have no optional ones); normalizeScreenplay() turns that into the contract:
// a spoken line {id, speaker, text, playing?} or a silent one {id, speaker:
// null, action, seconds}, with ids l1, l2, … in order.
import { SETS } from "@launchclip/core/characters/sets.mjs";
import { NARRATIVE_BEATS } from "@launchclip/core/direction.mjs";
import { MAX_SILENCE_SECONDS, NARRATOR, SCREENPLAY_GAP, SCREENPLAY_VERSION, SCREENPLAY_WPM, screenplayText } from "@launchclip/core/screenplay.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";
import { TITLE_OPTIONS } from "@launchclip/core/skeleton-library.mjs";
import { checkScreenplay } from "../script_check.js";
import { RULES_HEADING, cleanNarration } from "./script.js";
import { STORY_PROP_IDS, WORLD_KINDS } from "@launchclip/core/worlds/index.mjs";
import { NOT_DRAWN, TOLD, drawableFindings, drawableLines, normalizeShows } from "./drawable.js";

/** The cadence profile whose problem_lands_seconds a screenplay is held to. */
export const ANIMATION_PROFILE = "story-characters";
export const MIN_LOGLINES = 3;
export const MAX_LOGLINES = 5;
/** A character Short has two characters unless the brief names more. */
export const DEFAULT_CAST_SIZE = 2;
export const MAX_CAST_SIZE = 4;
export const VOICE_TYPES = Object.freeze(["female", "male", "either"]);
/** What the judge scores a logline on, 0-10 each. */
export const LOGLINE_CRITERIA = Object.freeze(["hook", "turn", "playable", "brief"]);
// The share of the target length that is speech: the rest is the pauses between lines and the silent lines.
const SPOKEN_SHARE = 0.8;
const ID = /^[a-z][a-z0-9-]{0,23}$/;

const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const clamp = (value) => Math.max(0, Math.min(10, Number(value) || 0));
const round2 = (value) => Math.round(value * 100) / 100;

// The pace a voice speaks at before any take is measured, in words a minute at
// speed 1. Kokoro's is from one measured dialogue: eight short lines ran 177
// wpm at its default speed of 1.2 (a single long take runs faster, about 217,
// but a script is voiced a line at a time). The others keep the contract's
// default until make measures the take.
const VOICE_WPM = Object.freeze({ kokoro: 150 });

/** The pace to write a script for before its take exists: the voice's own, scaled by its speed. */
export function estimatedPace(provider, speed = 1) {
  const base = VOICE_WPM[provider];
  return base ? Math.round(base * (Number(speed) > 0 ? Number(speed) : 1)) : SCREENPLAY_WPM;
}

/** The spoken words a screenplay of this length holds at a speaking pace. */
export function animationWordTarget(duration, wpm = SCREENPLAY_WPM) {
  return Math.max(12, Math.round(Number(duration) * SPOKEN_SHARE * wpm / 60));
}

// ---------------------------------------------------------------------------
// Schemas

const line = (description) => ({ type: "string", description });

export const PREMISE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["premise", "characters", "loglines"],
  properties: {
    premise: {
      type: "object",
      additionalProperties: false,
      required: ["want", "obstacle", "change"],
      properties: {
        want: line("What the lead wants, in a few words."),
        obstacle: line("What stands in the way."),
        change: line("What is different at the end.")
      }
    },
    characters: {
      type: "array",
      description: `The cast: ${DEFAULT_CAST_SIZE} characters unless the brief names more (${MAX_CAST_SIZE} at most). Roles, wants and ways of speaking only; never how anyone looks.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "role", "want", "speech", "voice_type"],
        properties: {
          id: line("A short lower-case id (letters, digits, hyphens), such as \"maya\". Never \"narrator\"."),
          name: line("The name the story calls them."),
          role: line("Their job in the story: lead, foil, mentor, …"),
          want: line("What they want in this story."),
          speech: line("How they speak: a few words (short and dry; warm, unhurried)."),
          voice_type: { type: "string", enum: [...VOICE_TYPES], description: "The kind of voice that suits them." }
        }
      }
    },
    loglines: {
      type: "array",
      description: `${MIN_LOGLINES} to ${MAX_LOGLINES} loglines for this premise and cast, each a different way into the story.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["logline", "differs"],
        properties: {
          logline: line("The story in one sentence: who, what goes wrong, what turns it."),
          differs: line("What this one does that the others do not.")
        }
      }
    }
  }
});

export const JUDGE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["scores", "chosen", "reason"],
  properties: {
    scores: {
      type: "array",
      description: "One entry per logline, in the order given.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", ...LOGLINE_CRITERIA],
        properties: {
          index: { type: "integer", description: "The logline's number, from 1." },
          hook: { type: "number", description: "0-10: would a stranger want the next sentence?" },
          turn: { type: "number", description: "0-10: does something change, and is the change earned?" },
          playable: { type: "number", description: "0-10: can the cast play it with a few lines and simple actions in the time, on one or two sets?" },
          brief: { type: "number", description: "0-10: does it do what the brief asks, with nothing the brief does not support?" }
        }
      }
    },
    chosen: { type: "integer", description: "The number of the logline you would make." },
    reason: line("Why, in one sentence.")
  }
});

export const SCREENPLAY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "title_options", "shows", "beats"],
  properties: {
    shows: {
      type: "object",
      additionalProperties: false,
      required: ["world", "things"],
      description: "What the story needs on screen, chosen from the lists of what can be shown.",
      properties: {
        world: { type: "string", enum: ["", ...WORLD_KINDS], description: "The place the story happens in, or \"\" to leave it to the designer." },
        things: {
          type: "array",
          description: "Every object the story turns on: what a viewer must see for it to make sense (the gate that opens, the trophy that is won). [] when it turns on none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "prop"],
            properties: {
              name: line("What the script calls it."),
              prop: { type: "string", enum: [...STORY_PROP_IDS, TOLD, NOT_DRAWN], description: `The listed thing that draws it; "${TOLD}" when only the narrator names it and nothing on screen needs it; "${NOT_DRAWN}" when the story needs to show it and nothing listed draws it.` }
            }
          }
        }
      }
    },
    title: line("A short working title (60 characters at most)."),
    title_options: { type: "array", description: `${TITLE_OPTIONS} publish-ready titles the video pays off, the best first (70 characters at most each).`, items: { type: "string" } },
    beats: {
      type: "array",
      description: `The story in order. Each beat is one of ${NARRATIVE_BEATS.join(", ")}.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["beat", "place", "lines"],
        properties: {
          beat: { type: "string", enum: [...NARRATIVE_BEATS] },
          place: line(`The set the beat plays on: one of ${SETS.join(", ")}, or "" to leave it to the designer.`),
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["speaker", "text", "playing", "action", "seconds"],
              properties: {
                speaker: line("A character id or \"narrator\" for a spoken line; \"\" for a silent line."),
                text: line("The exact words spoken; \"\" for a silent line."),
                playing: line("How a spoken line is played, a few words (never spoken); \"\" for none or for a silent line."),
                action: line("What happens on screen in a silent line, naming who does it; \"\" for a spoken line."),
                seconds: { type: "number", description: `A silent line's length in seconds (above 0, at most ${MAX_SILENCE_SECONDS}); 0 for a spoken line.` }
              }
            }
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Prompts

const PREMISE_ROLE = `You are the head writer of a room that writes short animated character stories. The characters are drawn in code by a simple rig: they stand, sit, gesture, look, react and talk on one or two plain sets. Stories that work are small and human: one want, one obstacle, one change.

From the brief, decide:
- premise: what the lead wants, what stands in the way, and what is different at the end.
- characters: ${DEFAULT_CAST_SIZE} characters unless the brief names more (${MAX_CAST_SIZE} at most). Give each an id, a name, a role, a want and a way of speaking. Use the names the brief gives. Do not describe how anyone looks: a designer does that later.
- loglines: ${MIN_LOGLINES} to ${MAX_LOGLINES} one-sentence versions of the story for this premise and cast. Make them really different (where it opens, who drives it, what the turn is), not rewordings.

Everything is drawn in code from a fixed kit, listed under "What can be shown". Build every logline on a place and on things from those lists: a story whose turn needs an object the kit cannot draw cannot be made.

Keep every fact, number and product claim to what the brief states. Return only the JSON object.`;

const JUDGE_ROLE = `You judge loglines for a short animated character story. You did not write them. You see the brief and the loglines, nothing else.

Score each logline 0-10 on:
- hook: would a stranger want the next sentence?
- turn: does something change, and is the change earned rather than announced?
- playable: can a few characters play it with a handful of lines and simple actions, in the time given, on one or two plain sets? Crowds, chases, effects and montage score low, and so does a story that turns on an object or a place missing from the list of what can be shown.
- brief: does it do what the brief asks, with no fact, number or claim the brief does not support?

Be strict; most loglines are a 5. The scores decide, so do not round them up to be kind. Then say which one you would make, and why in one sentence. Return only the JSON object.`;

const SCRIPT_ROLE = `You write the script for a short animated character story. The characters are drawn in code by a simple rig on plain sets, and every spoken line is read aloud by a text-to-speech voice.

The shape:
- A narrator carries the story and the characters speak the turns. Give every character at least one line. (Write pure dialogue only when the brief asks for it.)
- A line is spoken or silent. A spoken line has a speaker (a character id, or "narrator"), the exact words in text, and may have a short playing note (how it is said; never spoken). A silent line has speaker "", an action that names who does what, and its seconds. Silent lines are where the acting happens: a look, a pause, a reaction.
- Beats, in story order, each one of: ${NARRATIVE_BEATS.join(", ")}. Every script has a problem beat, and it comes early. Use cta only when the brief asks the viewer to do something.
- Open on a spoken line and close on a spoken line.
- shows: the place the story happens in (world) and every object it turns on (things), each matched to a listed thing that draws it. The story may only turn on what is listed under "What can be shown". When a thing changes on screen (a starting gate that opens), give the change a silent line of its own that says so plainly ("The gate opens.").

The rules:
- Spoken lines are plain speech: no headings, emoji, stage directions, sound cues or speaker labels inside text. Short lines; people interrupt and trail off.
- The first spoken line starts in the story: no greeting, no "in this video", no question about the topic.
- A silent line is at most ${MAX_SILENCE_SECONDS} seconds, and silent lines in a row add up to at most ${MAX_SILENCE_SECONDS} seconds.
- Use only the listed characters and the narrator. Do not describe how anyone looks.
- Facts, numbers, prices, ratings and quotes: only what the brief states. A story does not need a statistic.

Return only the JSON object.`;

function briefLines({ prompt, notes = [], rules = null }) {
  const lines = ["## Brief", "", String(prompt).trim()];
  if (notes.length) lines.push("", "## Notes from the assets folder", "", ...notes.map((note) => String(note).trim().slice(0, 6000)));
  if (rules && String(rules).trim()) lines.push("", RULES_HEADING, "", String(rules).trim().slice(0, 8000));
  return lines;
}

const characterLine = (character) => `- ${character.id}${character.name && character.name.toLowerCase() !== character.id ? ` (${character.name})` : ""}: ${[character.role, character.want ? `wants ${character.want}` : "", character.speech ? `speaks ${character.speech}` : ""].filter(Boolean).join("; ")}`;

// ---------------------------------------------------------------------------
// The three calls

async function structured(client, request, { provider, model }) {
  if (!client || typeof client.runStructured !== "function") throw new Error("the writers' room needs a model client");
  const result = await client.runStructured({ ...request, model: undefined });
  const value = result?.value && typeof result.value === "object" ? result.value : parseText(result?.text);
  const usage = result?.usage ?? {};
  const used = result?.model ?? model ?? null;
  return { value, usage, model: used, cost_usd: estimateModelUsageCost(provider ?? client.provider ?? "openai", used, usage).estimated_usd, response_id: result?.response_id ?? null };
}

/**
 * Call 1: the premise, the cast and the loglines.
 * options: {client, provider, model, prompt, notes, rules, duration}
 * → {premise: {want, obstacle, change}, characters: [{id, name?, role, want, speech, voice_type}],
 *    loglines: [{logline, differs}], usage, cost_usd, model}
 */
export async function writePremise(options = {}) {
  const { client, duration } = options;
  const input = [`Open the room on this brief. The video runs about ${duration} seconds.`, "", ...briefLines(options), "", ...drawableLines()].join("\n");
  const result = await structured(client, { instructions: PREMISE_ROLE, input: `${input}\n`, schema: PREMISE_SCHEMA, schemaName: "launchclip_animation_premise", maxOutputTokens: 3000 }, options);
  const value = result.value ?? {};
  const premise = { want: text(value.premise?.want), obstacle: text(value.premise?.obstacle), change: text(value.premise?.change) };
  if (!premise.want || !premise.obstacle) throw new Error("the writers' room returned no premise (a want and an obstacle)");
  const characters = normalizeCharacters(value.characters);
  if (!characters.length) throw new Error("the writers' room returned no characters");
  const loglines = (Array.isArray(value.loglines) ? value.loglines : []).map((entry) => ({ logline: text(entry?.logline), differs: text(entry?.differs) })).filter((entry) => entry.logline).slice(0, MAX_LOGLINES);
  if (!loglines.length) throw new Error("the writers' room returned no loglines");
  return { premise, characters, loglines, usage: result.usage, cost_usd: result.cost_usd, model: result.model, response_id: result.response_id };
}

/** The cast a model returned, cleaned: valid unique ids (made from the name when the id is not one), never "narrator", MAX_CAST_SIZE at most. */
export function normalizeCharacters(value) {
  const characters = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const name = text(entry?.name);
    const id = [entry?.id, name].map(slugId).find((candidate) => candidate && candidate !== NARRATOR && !characters.some((character) => character.id === candidate));
    if (!id) continue;
    const voiceType = VOICE_TYPES.includes(entry?.voice_type) ? entry.voice_type : "either";
    characters.push({ id, ...(name && name.toLowerCase() !== id ? { name } : {}), role: text(entry?.role), want: text(entry?.want), speech: text(entry?.speech), voice_type: voiceType });
    if (characters.length === MAX_CAST_SIZE) break;
  }
  return characters;
}

function slugId(value) {
  const id = String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^[^a-z]+|-+$/g, "").slice(0, 24).replace(/-+$/, "");
  return ID.test(id) ? id : null;
}

/**
 * Call 2: the loglines judged by a call that sees only the brief and the
 * loglines. The story is the best total score; a tie goes to the judge's own
 * pick, then to the earlier logline.
 * options: {client, provider, model, prompt, notes, rules, duration, loglines: [{logline}]}
 * → {chosen (index from 0), logline, scores: [{index, hook, turn, playable, brief, score}], reason, usage, cost_usd, model}
 */
export async function judgeLoglines(options = {}) {
  const { client, duration, loglines = [] } = options;
  if (!loglines.length) throw new Error("judgeLoglines needs loglines");
  const input = [`Judge these loglines for a video of about ${duration} seconds.`, "", ...briefLines(options), "", ...drawableLines(), "", "## Loglines", "", ...loglines.map((entry, index) => `${index + 1}. ${entry.logline}`)].join("\n");
  const result = await structured(client, { instructions: JUDGE_ROLE, input: `${input}\n`, schema: JUDGE_SCHEMA, schemaName: "launchclip_animation_loglines", maxOutputTokens: 1500 }, options);
  const picked = rankLoglines(loglines, result.value);
  return { ...picked, usage: result.usage, cost_usd: result.cost_usd, model: result.model, response_id: result.response_id };
}

/** The judge's answer as a choice: scores per logline (a logline it skipped scores 0), the best total, ties to its own pick. */
export function rankLoglines(loglines, value) {
  const given = new Map((Array.isArray(value?.scores) ? value.scores : []).map((entry) => [Number(entry?.index) - 1, entry]));
  const own = Number.isInteger(value?.chosen) && value.chosen >= 1 && value.chosen <= loglines.length ? value.chosen - 1 : null;
  const scores = loglines.map((_, index) => {
    const entry = given.get(index) ?? {};
    const parts = Object.fromEntries(LOGLINE_CRITERIA.map((key) => [key, clamp(entry[key])]));
    return { index, ...parts, score: round2(LOGLINE_CRITERIA.reduce((sum, key) => sum + parts[key], 0) / LOGLINE_CRITERIA.length) };
  });
  const scored = given.size > 0;
  const best = scored ? [...scores].sort((a, b) => b.score - a.score || (b.index === own) - (a.index === own) || a.index - b.index)[0].index : own ?? 0;
  return { chosen: best, logline: loglines[best].logline, scores, judge_pick: own, reason: text(value?.reason) };
}

/**
 * Call 3 (and the repair pass): the script.
 * options: {client, provider, model, prompt, notes, rules, duration, wpm, words (target override),
 *   premise, characters, logline, skeleton (a library skeleton, or null),
 *   structure (its prompt lines), repair: {previous (a screenplay), errors: [{id, message, fix, line?}], measured?: {seconds, wpm}}}
 * → a screenplay: {schema_version, title, logline, premise, characters, beats, narration, title_options,
 *    word_target, word_count, usage, cost_usd, model}
 */
export async function writeScreenplay(options = {}) {
  const { client, duration, premise, characters = [], logline, repair = null } = options;
  if (!characters.length) throw new Error("writeScreenplay needs the characters");
  const wpm = Number(options.wpm) > 0 ? Number(options.wpm) : SCREENPLAY_WPM;
  const words = options.words ?? animationWordTarget(duration, wpm);
  const silent = Math.max(1, Math.round(Number(duration) * (1 - SPOKEN_SHARE) * 10) / 10);
  const lines = [
    `Write the script for this story. It runs about ${duration} seconds: about ${words} spoken words in total (the voice reads about ${Math.round(wpm)} words a minute, and lines sit ${SCREENPLAY_GAP} seconds apart), and at most ${silent} seconds of silent lines.`,
    "",
    ...briefLines(options),
    "",
    "## The story",
    "",
    `Logline: ${logline}`,
    `Premise: ${premise.want ? `the lead wants ${premise.want}` : ""}${premise.obstacle ? `; in the way: ${premise.obstacle}` : ""}${premise.change ? `; at the end: ${premise.change}` : ""}.`,
    "",
    "## Characters (speaker ids)",
    "",
    ...characters.map(characterLine),
    `- ${NARRATOR}: tells the story between the characters' lines.`,
    "",
    ...drawableLines()
  ];
  if (options.structure?.length) lines.push("", "## Structure (build the story beats on it)", "", ...options.structure.map((entry) => `- ${entry}`));
  if (options.problemLandsSeconds != null) lines.push("", `The problem beat must start within ${options.problemLandsSeconds} seconds: keep the setup to a line or two.`);
  if (repair?.previous) {
    const errors = [repair.errors ?? []].flat().map((error, index) => `${index + 1}. [${error.id}]${error.line ? ` (line ${error.line})` : ""} ${error.message} Fix: ${error.fix}`);
    lines.push("", "## Repair", "", `${repair.measured ? `Your previous script was voiced: it ran ${repair.measured.seconds} seconds at ${Math.round(repair.measured.wpm)} words a minute. ` : ""}It failed these checks. Rewrite it to fix every one, keeping the story, the characters and the lines that already work.`, "", ...errors, "", "Previous script:", "", scriptForPrompt(repair.previous));
  }
  const result = await structured(client, { instructions: SCRIPT_ROLE, input: `${lines.join("\n")}\n`, schema: SCREENPLAY_SCHEMA, schemaName: "launchclip_animation_script", maxOutputTokens: 6000 }, options);
  const play = normalizeScreenplay(result.value, { characters, premise, logline });
  if (!play.narration) throw new Error("the writers' room returned a script with no spoken line");
  return { ...play, word_target: words, word_count: play.narration.split(/\s+/).filter(Boolean).length, usage: result.usage, cost_usd: result.cost_usd, model: result.model, response_id: result.response_id };
}

/**
 * A model's script in the contract's shape (launchclip.make-script.v2). Lines
 * get ids l1, l2, … in order; a line with no speaker is silent; empty lines
 * and empty beats are dropped; beats in a row with the same name are joined;
 * a place the kit has no set for is left out. Whether it is a good script is
 * the validator's question, not this function's: an unknown speaker or beat
 * is kept so the check can name it.
 */
export function normalizeScreenplay(value, { characters = [], premise = null, logline = "" } = {}) {
  const beats = [];
  let count = 0;
  // A speaker written as the character's name is that character.
  const byName = new Map(characters.filter((character) => character.name).map((character) => [character.name.toLowerCase(), character.id]));
  for (const entry of Array.isArray(value?.beats) ? value.beats : []) {
    const lines = [];
    for (const item of Array.isArray(entry?.lines) ? entry.lines : []) {
      const named = text(item?.speaker).toLowerCase();
      const speaker = byName.get(named) ?? named;
      const spoken = cleanLine(item?.text, [named, speaker]);
      const action = text(item?.action);
      if (speaker && speaker !== "null" && speaker !== "none" && spoken) {
        const playing = text(item?.playing);
        lines.push({ speaker, text: spoken, ...(playing ? { playing } : {}) });
      } else if (action) {
        const seconds = Number(item?.seconds);
        lines.push({ speaker: null, action, seconds: seconds > 0 ? Math.round(seconds * 10) / 10 : 1 });
      }
    }
    if (!lines.length) continue;
    const beat = text(entry?.beat).toLowerCase();
    const place = SETS.includes(text(entry?.place)) ? text(entry.place) : null;
    const last = beats.at(-1);
    if (last && last.beat === beat && (last.place ?? null) === place) last.lines.push(...lines);
    else beats.push({ beat, ...(place ? { place } : {}), lines });
  }
  for (const beat of beats) beat.lines = beat.lines.map((entry) => ({ id: `l${(count += 1)}`, ...entry }));
  const title = text(value?.title).slice(0, 80) || "Untitled";
  const options = (Array.isArray(value?.title_options) ? value.title_options : []).map((entry) => text(entry).slice(0, 100)).filter(Boolean).slice(0, TITLE_OPTIONS);
  const play = { schema_version: SCREENPLAY_VERSION, title, logline: text(logline), ...(premise ? { premise } : {}), characters, shows: normalizeShows(value?.shows), beats };
  return { ...play, narration: screenplayText(play), title_options: options.length ? options : [title] };
}

// A spoken line's words: markdown and stage directions out (as the narrated script pass does), and the speaker's own label when the model repeats it.
function cleanLine(value, speakers = []) {
  let spoken = cleanNarration(value);
  for (const speaker of speakers.filter(Boolean)) {
    if (spoken.toLowerCase().startsWith(`${speaker}:`)) spoken = spoken.slice(speaker.length + 1).trim();
  }
  return spoken;
}

// The previous script as a model reads it back in a repair.
function scriptForPrompt(script) {
  const things = (script.shows?.things ?? []).map((thing) => `${thing.name} = ${thing.prop ?? NOT_DRAWN}`);
  return [...(script.shows ? [`shows: world ${script.shows.world ?? "(the designer's choice)"}; things ${things.join(", ") || "none"}`] : []), ...scriptBeatsForPrompt(script)].join("\n");
}

function scriptBeatsForPrompt(script) {
  return (script.beats ?? []).map((beat) => [`${beat.beat}${beat.place ? ` (${beat.place})` : ""}:`, ...beat.lines.map((entry) => entry.speaker === null ? `  ${entry.id} [silent, ${entry.seconds}s] ${entry.action}` : `  ${entry.id} ${entry.speaker}: ${entry.text}${entry.playing ? ` (${entry.playing})` : ""}`)].join("\n"));
}

// ---------------------------------------------------------------------------
// The room

/** What the screenplay is checked against: the contract, the script checks on the spoken text, and what the story shows. */
export function checkAnimationScript(script, { duration, wpm, problemLandsSeconds, brief } = {}) {
  const check = checkScreenplay({ script, duration, ...(wpm ? { wpm } : {}), problemLandsSeconds, brief });
  // And what it shows: every object the story turns on must be one the kit draws (src/make/drawable.js).
  const drawable = drawableFindings(script);
  const errors = [...check.errors, ...drawable.errors];
  return { ...check, ok: errors.length === 0, errors, warnings: [...check.warnings, ...drawable.warnings] };
}

/**
 * The three calls, in order, and the first check.
 * options: {client, provider, model, prompt, notes, rules, assets (brief lines for the fact check), duration,
 *   skeleton, structure, problemLandsSeconds, say (a notice per paid call)}
 * → {script, check, calls: [{stage, usage, cost_usd, model}]}
 * script carries `loglines` (every option with its scores, and which was chosen) and `passes`.
 */
export async function writersRoom(options = {}) {
  const say = options.say ?? (() => {});
  const calls = [];
  const paid = (what) => say(`model: PAID call to ${options.provider} ${options.model} (writers' room: ${what})`);
  paid("premise and loglines");
  const room = await writePremise(options);
  calls.push({ stage: "premise", ...usageOf(room) });
  paid(`${room.loglines.length} loglines judged in a fresh context`);
  const judged = await judgeLoglines({ ...options, loglines: room.loglines });
  calls.push({ stage: "loglines", ...usageOf(judged) });
  paid(`script, about ${animationWordTarget(options.duration, options.wpm)} spoken words`);
  const written = await writeScreenplay({ ...options, premise: room.premise, characters: room.characters, logline: judged.logline });
  calls.push({ stage: "script", ...usageOf(written) });
  const script = {
    ...playOf(written),
    loglines: { chosen: judged.chosen, reason: judged.reason, options: room.loglines.map((entry, index) => ({ ...entry, ...scoreOf(judged.scores[index]) })) },
    passes: [
      { kind: "premise", cost_usd: room.cost_usd },
      { kind: "loglines", options: room.loglines.length, chosen: judged.chosen, cost_usd: judged.cost_usd },
      { kind: "write", words: written.word_count, cost_usd: written.cost_usd }
    ]
  };
  return { script, check: checkAnimationScript(script, checkOptions(options)), calls };
}

/**
 * The one repair pass: the script rewritten against the check's findings.
 * options: writersRoom's, plus {script, errors, measured?: {seconds, wpm}}
 * → {script, check, calls}
 */
export async function repairScreenplay(options = {}) {
  const { script, errors = [], measured = null } = options;
  (options.say ?? (() => {}))(`script: ${errors.length} script check finding(s) (${[...new Set(errors.map((error) => error.id))].join(", ")}); one repair pass (PAID call to ${options.provider} ${options.model})`);
  const wpm = measured?.wpm ?? options.wpm;
  const written = await writeScreenplay({ ...options, wpm, premise: script.premise, characters: script.characters, logline: script.logline, repair: { previous: script, errors, measured } });
  const repaired = { ...playOf(written), loglines: script.loglines, passes: [...(script.passes ?? []), { kind: "repair", words: written.word_count, errors: errors.map((error) => error.id), ...(measured ? { measured_seconds: measured.seconds } : {}), cost_usd: written.cost_usd }] };
  return { script: repaired, check: checkAnimationScript(repaired, checkOptions({ ...options, wpm })), calls: [{ stage: "script-repair", ...usageOf(written) }] };
}

const checkOptions = (options) => ({ duration: options.duration, wpm: options.wpm, problemLandsSeconds: options.problemLandsSeconds, brief: { prompt: options.prompt, notes: options.notes ?? [], assets: options.assets ?? [] } });
const usageOf = (result) => ({ usage: result.usage, cost_usd: result.cost_usd, model: result.model });
const scoreOf = (entry) => Object.fromEntries(Object.entries(entry ?? {}).filter(([key]) => key !== "index"));
// The screenplay a call returned, without the call's own receipt.
const playOf = (written) => Object.fromEntries(Object.entries(written).filter(([key]) => !["usage", "cost_usd", "model", "response_id"].includes(key)));

// ---------------------------------------------------------------------------
// Voices

// Kokoro voices a character can borrow until the show bible gives each its own
// (the bible owns a character's voice; this is a stand-in, in a fixed order).
const KOKORO_STAND_INS = Object.freeze({
  female: ["af_bella", "bf_emma", "af_nova", "af_sarah"],
  male: ["am_michael", "bm_george", "am_adam", "am_eric"],
  either: ["af_river", "am_echo", "af_sky", "am_puck"]
});

/**
 * A stand-in cast for voicing a screenplay before the show bible exists:
 * [{id, voice}] in the story cast's shape (src/voice/dialogue.js). Under
 * Kokoro every character gets a voice of its own, by voice_type, that is not
 * the narrator's; any other provider has no voice ids to hand out, so each
 * character's voice is null and the narrator's voice speaks for them.
 */
export function standInCast(characters = [], { provider = "kokoro", narratorVoice = null } = {}) {
  const taken = new Set(narratorVoice ? [narratorVoice] : []);
  return characters.map((character) => {
    if (provider !== "kokoro") return { id: character.id, voice: null };
    const pools = [KOKORO_STAND_INS[character.voice_type] ?? KOKORO_STAND_INS.either, ...Object.values(KOKORO_STAND_INS)];
    const voice = pools.flat().find((candidate) => !taken.has(candidate)) ?? null;
    if (voice) taken.add(voice);
    return { id: character.id, voice };
  });
}

function parseText(value) {
  if (typeof value !== "string") return null;
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(value.slice(start, end + 1)); } catch { return null; }
}
