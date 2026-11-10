// What a character story can show, and the check that a script only turns on
// things from that list (`launchclip make --animation`).
//
// The kit draws everything in code: a story about a starting gate needs a
// starting gate the kit can draw. The writers' room and the designer are given
// the vocabulary (drawableLines), the script names what it turns on
// (SCRIPT.json `shows`), and drawableFindings() fails a script that turns on
// something outside it. The one repair pass then moves the story to the
// nearest drawable thing, or keeps the thing in the narrator's words only
// (`told`), which the report says.
//
//   drawableVocabulary()        → {worlds, sets, props, kinds}
//   drawableLines()             → the vocabulary as prompt lines
//   propsNamed(text)            → the story props a text names, by its words
//   normalizeShows(value)       → a model's `shows` in the contract's shape
//   scriptShows(script)         → {world, things, props, cues}: what the story shows, read from the script
//   drawableFindings(script)    → {errors, warnings} for the script check
//   showsNotes(script)          → lines for the report
import { KINDS, KIND_NAMES } from "@launchclip/core/characters/kinds.mjs";
import { SETS, SET_INFO } from "@launchclip/core/characters/sets.mjs";
import { PROPS, PROP_STATES, STORY_PROP_IDS, WORLD_KINDS, worldCatalogue } from "@launchclip/core/worlds/index.mjs";

/** `shows[].prop` for something only the narrator names. */
export const TOLD = "told";
/** `shows[].prop` for something the kit cannot draw. */
export const NOT_DRAWN = "none";
export const MAX_SHOWN = 6;

// The words a script uses for each story prop, longest first within a prop.
// A bare "gate" is the starting gate only beside racing words (GATE_CONTEXT).
const PROP_WORDS = Object.freeze({
  "starting-gate": ["starting gate", "starting gates", "starting stalls", "start gate", "starting stall", "the stalls"],
  "finish-post": ["winning post", "finishing post", "finish post", "finish line", "finishing line"],
  "hay-bale": ["hay bale", "hay bales", "bale of hay", "hay"],
  bucket: ["water bucket", "feed bucket", "bucket", "pail"],
  saddle: ["saddle"],
  rosette: ["rosette", "ribbon"],
  jump: ["hurdle", "hurdles", "jump", "fence"],
  sign: ["sign"],
  trophy: ["trophy"],
  ball: ["ball"],
  gift: ["gift", "parcel"],
  flag: ["flag"],
  signpost: ["signpost"],
  box: ["cardboard box", "box", "crate"],
  ladder: ["ladder"],
  bench: ["bench"],
  bike: ["bicycle", "bike"],
  tent: ["tent"],
  campfire: ["campfire", "camp fire"],
  balloons: ["balloons", "balloon"],
  kite: ["kite"]
});
const GATE_CONTEXT = /\b(race|races|racing|racetrack|racecourse|starter|starting|foal|colt|filly|mare|stallion|horse|horses|jockey|stalls)\b/i;
// A change of state a scene can cue, by prop: the words that say it happens (not "when it opens": that is talk about it).
const STATE_WORDS = Object.freeze({ "starting-gate": { open: /\b(opens|opened|swings? open|springs? open|flies open|flew open|bursts? open|snaps? open)\b/i } });

const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (haystack, words) => new RegExp(`\\b${escape(words)}\\b`, "i").test(haystack);
// A one-word name ("jump", "sign", "present") is the thing only after a determiner: "the jump", not "to jump".
const named = (haystack, words) => (words.includes(" ") ? wordIn(haystack, words) : new RegExp(`\\b(the|a|an|its|their|his|her|that|this|one|two|three|some)\\s+(?:\\w+\\s+)?${escape(words)}\\b`, "i").test(haystack));

/** What the kit can show: every world, set, story prop and character kind, each with a line about it. */
export function drawableVocabulary() {
  return {
    worlds: worldCatalogue().map((world) => ({ id: world.kind, describe: world.describe })),
    sets: SETS.map((name) => ({ id: name, describe: SET_INFO[name].describe })),
    props: STORY_PROP_IDS.map((id) => ({ id, describe: PROPS[id].label, ...(PROP_STATES[id] ? { states: [...PROP_STATES[id]] } : {}) })),
    kinds: KIND_NAMES.map((name) => ({ id: name, group: KINDS[name].group }))
  };
}

/** The vocabulary as prompt lines, under a heading. */
export function drawableLines({ heading = "## What can be shown (the kit draws these and nothing else)" } = {}) {
  const v = drawableVocabulary();
  return [
    heading,
    "",
    `- Places (world): ${v.worlds.map((world) => world.id).join(", ")}.`,
    `- Sets (place): ${v.sets.map((set) => set.id).join(", ")}.`,
    `- Things (prop): ${v.props.map((prop) => (prop.states ? `${prop.id} (${prop.states.join(", then ")})` : prop.id)).join(", ")}.`,
    `- Characters: people, and ${v.kinds.map((kind) => kind.id).join(", ")}.`,
    "",
    "A story may only turn on a place, a thing or a character from these lists. Anything else can be said by the narrator but never seen: nobody can look at it, hold it, wait for it or walk through it."
  ];
}

/** The story props a text names, by its words: [{prop, name (the words found)}], in PROP_WORDS order. */
export function propsNamed(value) {
  const haystack = text(value);
  const out = [];
  for (const [prop, words] of Object.entries(PROP_WORDS)) {
    const found = words.find((entry) => named(haystack, entry));
    if (found) out.push({ prop, name: found });
  }
  if (!out.some((entry) => entry.prop === "starting-gate") && named(haystack, "gate") && GATE_CONTEXT.test(haystack)) out.unshift({ prop: "starting-gate", name: "gate" });
  // "signpost" also reads as "sign", "hay bale" as "hay": the longer name wins.
  return out.filter((entry) => !(entry.prop === "sign" && out.some((other) => other.prop === "signpost")));
}

/** A model's `shows` in the contract's shape: {world: kind | null, things: [{name, prop: id | "told" | null}]}. */
export function normalizeShows(value) {
  const world = WORLD_KINDS.includes(value?.world) ? value.world : null;
  const things = [];
  for (const entry of Array.isArray(value?.things) ? value.things : []) {
    const name = text(entry?.name).slice(0, 60);
    if (!name || things.some((thing) => thing.name.toLowerCase() === name.toLowerCase())) continue;
    const prop = STORY_PROP_IDS.includes(entry?.prop) ? entry.prop : entry?.prop === TOLD ? TOLD : null;
    things.push({ name, prop });
    if (things.length === MAX_SHOWN) break;
  }
  return { world, things };
}

const lineText = (line) => (line.speaker === null ? line.action : line.text) ?? "";
const allLines = (script) => (script?.beats ?? []).flatMap((beat) => beat.lines ?? []);
const storyText = (script) => [script?.title, script?.logline, script?.premise?.want, script?.premise?.obstacle, script?.premise?.change, ...allLines(script).map(lineText)].map(text).filter(Boolean).join(" . ");

/**
 * What a script shows, read from the script: the things it names (`shows`,
 * each matched to the kit by its words when the writer gave no prop), the
 * story props its own words name that it left out, and the cue for a prop
 * that changes state (the silent line where the gate opens).
 * → {world, things: [{name, prop: id | "told" | null}], props: [ids], cues: [{prop, state, line}]}
 */
export function scriptShows(script) {
  const declared = normalizeShows(script?.shows);
  const things = declared.things.map((thing) => (thing.prop === null ? { ...thing, prop: propsNamed(`the ${thing.name}`)[0]?.prop ?? null } : thing));
  // What the script's own words name: a script written before `shows` existed still shows its gate.
  for (const found of propsNamed(storyText(script))) {
    if (!things.some((thing) => thing.prop === found.prop || wordIn(thing.name, found.name))) things.push({ name: found.name, prop: found.prop });
  }
  const props = [...new Set(things.map((thing) => thing.prop).filter((prop) => prop && prop !== TOLD))];
  const cues = [];
  for (const prop of props) {
    for (const [state, pattern] of Object.entries(STATE_WORDS[prop] ?? {})) {
      const lines = allLines(script);
      // An action line first (it is what happens on screen), then a narrator's line.
      const line = lines.find((entry) => entry.speaker === null && pattern.test(entry.action ?? "")) ?? lines.find((entry) => entry.speaker === "narrator" && pattern.test(entry.text ?? "") && !/\b(when|if|until|once|before)\b[^.?!]*$/i.test((entry.text ?? "").split(pattern)[0]));
      if (line) cues.push({ prop, state, line: line.id });
    }
  }
  return { world: declared.world, things, props, cues };
}

/**
 * The script check's findings on what the story shows.
 * - undrawable (error): the story turns on something the kit cannot draw.
 * - told-acted (error): something only the narrator may name is acted on in a silent line.
 * - told-not-shown (warning): the narrator carries a thing the kit cannot draw.
 */
export function drawableFindings(script) {
  const errors = [], warnings = [];
  const shows = scriptShows(script);
  const near = STORY_PROP_IDS.slice(0, 12).join(", ");
  for (const thing of shows.things) {
    if (thing.prop === null) {
      errors.push({ id: "undrawable", message: `The story turns on "${thing.name}", which the kit cannot draw, so it would never appear on screen.`, fix: `Rewrite the story around the nearest thing that can be shown (${near}, …) and list that in shows; or, when nothing is near, let only the narrator name "${thing.name}" (no character looks at it, touches it or waits for it, and no silent line needs it) and list it with prop "${TOLD}".` });
    } else if (thing.prop === TOLD) {
      const acted = allLines(script).find((line) => line.speaker === null && nameIn(line.action, thing.name));
      if (acted) errors.push({ id: "told-acted", line: acted.id, message: `"${thing.name}" cannot be drawn, but the silent line ${acted.id} needs it on screen ("${text(acted.action)}").`, fix: `Give that moment to a narrator's line, or act it with something that can be shown (${near}, …).` });
      else warnings.push({ id: "told-not-shown", message: `"${thing.name}" cannot be drawn: only the narrator names it, and it never appears on screen.`, fix: "Nothing to do if the story reads without seeing it; else rewrite it around something the kit can draw." });
    }
  }
  return { errors, warnings, shows };
}

// Does a line name a thing? Its whole name, or its last word ("the old water pump" → "pump").
function nameIn(value, name) {
  const words = text(name).toLowerCase().split(" ").filter((word) => word.length > 2 && !["the", "old", "big", "new"].includes(word));
  return wordIn(text(value), text(name)) || (words.length > 0 && wordIn(text(value), words.at(-1)));
}

// A word as the story's anchors read it (kit/core/story.mjs normalizeWord).
const token = (value) => String(value).toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}-]+/gu, "").replace(/^-+|-+$/g, "");

/**
 * When a cue's line plays, as a story time anchor on the narration's words
 * ("word:<text>#n+s"). A silent line plays in the pause after the spoken line
 * before it, so it is anchored on a word of that line: the last one the
 * script says only once (else its last word, by occurrence), plus the time
 * the rest of the line takes. A spoken line is anchored on its first word.
 * → an anchor, or 0.5 (seconds) for a silent line that opens the script.
 */
export function lineAnchor(script, lineId) {
  const lines = allLines(script);
  const index = lines.findIndex((line) => line.id === lineId);
  if (index < 0) return null;
  const spoken = lines.map((line, i) => ({ i, words: line.speaker === null ? [] : text(line.text).split(" ").map(token).filter(Boolean) }));
  const all = spoken.flatMap((entry) => entry.words.map((word, k) => ({ word, line: entry.i, k })));
  const occurrence = (line, k) => all.filter((entry) => entry.word === spoken[line].words[k] && (entry.line < line || (entry.line === line && entry.k <= k))).length;
  const count = (word) => all.filter((entry) => entry.word === word).length;
  if (lines[index].speaker !== null) return spoken[index].words.length ? `word:${spoken[index].words[0]}#${occurrence(index, 0)}` : null;
  const before = spoken.slice(0, index).reverse().find((entry) => entry.words.length);
  if (!before) return 0.5;
  const words = before.words;
  let k = words.length - 1;
  for (let j = words.length - 1; j >= Math.max(0, words.length - 5); j--) if (count(words[j]) === 1) { k = j; break; }
  // About 0.3 s a word to the line's end, then a beat into the pause.
  const offset = Math.round((0.3 * (words.length - k) + 0.35) * 100) / 100;
  return `word:${words[k]}#${occurrence(before.i, k)}+${offset}`;
}

/** Lines for the run's report: what the story shows, and what it only tells. */
export function showsNotes(script) {
  const shows = scriptShows(script);
  const notes = [];
  const shown = shows.things.filter((thing) => thing.prop && thing.prop !== TOLD);
  if (shown.length) notes.push(`the story shows ${shown.map((thing) => (thing.name.replace(/\s+/g, "-") === thing.prop ? thing.prop : `${thing.name} (${thing.prop})`)).join(", ")}`);
  for (const cue of shows.cues) notes.push(`${cue.prop} becomes ${cue.state} on line ${cue.line}`);
  for (const thing of shows.things) {
    if (thing.prop === TOLD) notes.push(`"${thing.name}" cannot be drawn: the narrator carries it and it is never on screen`);
    if (thing.prop === null) notes.push(`"${thing.name}" cannot be drawn and the script still turns on it: it will not appear on screen`);
  }
  const moved = (script?.passes ?? []).filter((pass) => pass.kind === "repair" && (pass.errors ?? []).some((id) => id === "undrawable" || id === "told-acted"));
  if (moved.length) notes.push("the script was rewritten once so that it only turns on things the kit can draw");
  return notes;
}
