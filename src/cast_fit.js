// Cast fit for the planner's direction map: tooling, not a repair call, for
// the two ways a character story's cues miss the character kit.
//
//   plannedCast({story, style})          the cast the story will have, and
//                                        whether its names are the story's to set
//   normalizeCastCues(map)               free-text poses, expressions and sets
//                                        → the nearest kit value, each reported
//   bindStoryCast(map, planned, {words}) the names the map uses, bound onto a
//                                        style default cast's unused members
//   fitDirectionCast(map, {cast, words}) both, in that order
//
// A seeded style (`launchclip style generate`, make's automatic style) carries
// a generated cast whose names have nothing to do with the story; a story
// about Mia and Sam keeps the looks and voices and takes the names. A cast the
// story or the user defined is never renamed: its cues must use its ids, and
// the direction checks say so.
import { castFromStyle } from "@launchclip/core/characters/generate.mjs";
import { EXPRESSIONS, POSES } from "@launchclip/core/characters/rig.mjs";
import { SETS } from "@launchclip/core/characters/sets.mjs";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * The cast the planned story will have, before the storyboard exists.
 * story: a storyboard the plan starts from (its own cast wins); style: the
 * loaded style pack. → {cast: {style, characters}, source: "story" | "style",
 * bindable} | null. bindable: the cast is a seeded style's generated default,
 * so the story's own names may be bound onto it.
 */
export function plannedCast({ story = null, style = null } = {}) {
  if (isObject(story?.cast) && Array.isArray(story.cast.characters) && story.cast.characters.length) {
    return { cast: clone(story.cast), source: "story", bindable: false };
  }
  if (!isObject(style?.cast)) return null;
  let cast = null;
  try { cast = castFromStyle(style.cast); } catch { return null; }
  if (!cast?.characters?.length) return null;
  // Only a generated pack's members (style-seed) are a default roster; a
  // hand-written pack's cast (a brand mascot, starter ids) is the author's.
  const members = Array.isArray(style.cast.members) ? style.cast.members : [];
  const bindable = isObject(style.generated) && members.length > 0 && members.every((member) => isObject(member) && typeof member.id === "string");
  return { cast, source: "style", bindable };
}

// ---------------------------------------------------------------------------
// Free text → the kit's poses, expressions and sets.
//
// Each table lists keyword stems (regex fragments matched at a word start;
// a trailing \b ends a whole word); the stem that appears earliest in the text
// wins ("hopeful, then wary" → happy), and text with no stem falls back to
// the default (stand, neutral; a set with no match is dropped, since a line
// may name none). Exact kit values pass through unchanged.

export const POSE_KEYWORDS = Object.freeze([
  ["point", ["point", "gestur", "indicat", "accus"]],
  ["wave", ["wave", "waving", "greet"]],
  ["slump", ["slump", "sag", "defeat", "deflat", "exhaust", "collaps"]],
  ["type", ["typing", "types?\\b", "keyboard", "laptop"]],
  ["think", ["think", "ponder", "wonder", "consider", "imagin"]],
  ["cheer", ["cheer", "celebrat", "triumph", "fist"]],
  ["shrug", ["shrug"]],
  ["walk", ["walk", "moving", "steps", "approach", "pacing", "heading"]],
  ["sit", ["sit\\b", "sits\\b", "sitting", "seated"]],
  ["look", ["look", "facing", "gaz", "watch", "glanc", "turn", "staring", "eyes"]],
  ["stretch", ["stretch", "reach"]],
  ["stand", ["stand", "beside", "next to", "leaning", "waiting"]]
]);

export const EXPRESSION_KEYWORDS = Object.freeze([
  ["delighted", ["delight", "thrill", "overjoy", "ecstat", "joy", "elat"]],
  ["happy", ["happy", "hopeful", "smil", "glad", "relie", "warm", "confident", "proud", "pleased", "content", "kind", "open", "understanding"]],
  ["surprised", ["surpris", "shock", "astonish", "stun", "startl", "amaz", "wide-eyed", "realis", "realiz"]],
  ["frustrated", ["frustrat", "annoy", "defensive", "irritat", "accus", "upset", "exasperat", "indignant", "stubborn", "tense", "fed up", "hurt"]],
  ["confused", ["confus", "wary", "unsure", "uncertain", "puzzl", "doubt", "hesitant", "lost"]],
  ["focused", ["focus", "concentrat", "determin", "certain", "intent", "serious", "careful", "curious", "attentive", "anticipat", "expectant"]],
  ["sad", ["sad", "unhappy", "disappoint", "glum", "miserable", "heartbroken", "lonely", "gloomy", "sorrow", "deject", "downcast", "griev"]],
  ["crying", ["cry", "cries", "tears", "tearful", "sob", "weep"]],
  ["worried", ["worr", "nervous", "anxious", "uneasy", "concern", "apprehens", "fret"]],
  ["scared", ["scared", "afraid", "fear", "terrif", "frighten", "panic", "horrif", "alarm"]],
  ["angry", ["angry", "anger", "furious", "fury", "rage", "raging", "livid", "outrage", "fuming"]],
  ["deadpan", ["deadpan", "unimpress", "unamused", "bored", "blank", "expressionless", "flat\\b"]],
  ["side-eye", ["side-eye", "side eye", "skeptic", "sceptic", "suspicious", "distrust", "dubious", "judging"]],
  ["smirk", ["smirk", "smug", "sly", "cocky", "mischie", "knowing"]],
  ["sheepish", ["sheepish", "embarrass", "awkward", "guilty", "apolog", "bashful", "shy"]],
  ["in-love", ["in love", "in-love", "smitten", "ador", "infatuat", "lovestruck", "swoon"]],
  ["excited", ["excit", "eager", "enthusias", "pumped"]],
  ["laughing", ["laugh", "giggl", "chuckl", "hilari"]],
  ["wink", ["wink", "playful", "cheeky", "flirt"]],
  ["thinking", ["thinking", "thought", "reflect", "ponder", "wonder", "mull", "weigh"]]
]);

export const SET_KEYWORDS = Object.freeze([
  ["kitchen-counter", ["kitchen", "fridge", "sink", "counter", "dishes", "stove", "cook"]],
  ["video-call", ["video call", "video-call", "zoom", "webcam"]],
  ["desk-laptop", ["desk", "laptop", "office", "computer"]],
  ["standing-desk", ["standing desk", "standing-desk"]],
  ["sofa", ["sofa", "couch", "living room", "living-room", "lounge"]],
  ["car", ["car\\b", "driv", "vehicle"]],
  ["park-bench", ["park", "bench", "garden"]],
  ["meeting", ["meeting", "boardroom", "conference"]],
  ["phone", ["phone"]],
  ["podium", ["podium", "lectern"]],
  ["stage", ["stage", "spotlight"]],
  ["screen", ["screen", "monitor", "tv\\b"]]
]);

/** The kit value nearest to free text, by the earliest keyword. → value | fallback */
export function nearestValue(text, table, fallback) {
  const lower = ` ${String(text ?? "").toLowerCase()} `;
  let best = null;
  for (const [value, stems] of table) {
    for (const stem of stems) {
      // A stem starts a word ("point" matches "pointing", not "appoint").
      const at = lower.search(new RegExp(`[^a-z]${stem}`));
      if (at >= 0 && (!best || at < best.at)) best = { value, at };
    }
  }
  return best ? best.value : fallback;
}

export const nearestPose = (text) => nearestValue(text, POSE_KEYWORDS, "stand");
export const nearestExpression = (text) => nearestValue(text, EXPRESSION_KEYWORDS, "neutral");
export const nearestSet = (text) => nearestValue(text, SET_KEYWORDS, null);

function mapLines(map) {
  const out = [];
  (Array.isArray(map?.sections) ? map.sections : []).forEach((section, s) => {
    (Array.isArray(section?.lines) ? section.lines : []).forEach((line, l) => {
      if (isObject(line)) out.push({ line, where: `sections[${s}].lines[${l}]` });
    });
  });
  return out;
}

/**
 * Free-text poses, expressions and sets on a direction map's cast cues →
 * the kit's nearest values. → {map, changed: ["<where>.pose \"…\" → stand", …]}
 */
export function normalizeCastCues(map) {
  if (!isObject(map)) return { map, changed: [] };
  const out = clone(map);
  const changed = [];
  for (const { line, where } of mapLines(out)) {
    if (typeof line.set === "string" && !SETS.includes(line.set)) {
      const set = nearestSet(line.set);
      changed.push(`${where}.set "${line.set}" → ${set ?? "(none)"}`);
      if (set) line.set = set;
      else delete line.set;
    }
    if (!Array.isArray(line.cast)) continue;
    line.cast.forEach((cue, i) => {
      if (!isObject(cue)) return;
      if (typeof cue.pose === "string" && !POSES.includes(cue.pose)) {
        const pose = nearestPose(cue.pose);
        changed.push(`${where}.cast[${i}].pose "${cue.pose}" → ${pose}`);
        cue.pose = pose;
      }
      if (typeof cue.expression === "string" && !EXPRESSIONS.includes(cue.expression)) {
        const expression = nearestExpression(cue.expression);
        changed.push(`${where}.cast[${i}].expression "${cue.expression}" → ${expression}`);
        cue.expression = expression;
      }
    });
  }
  return { map: out, changed };
}

const slug = (text) => String(text ?? "").trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const bare = (text) => String(text ?? "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

// The display name for a bound id: the narration's own spelling of it when
// it is spoken ("Mia"), else the id in title case ("partner-a" → "Partner A").
function displayName(id, words) {
  for (const word of Array.isArray(words) ? words : []) {
    const text = bare(word?.text ?? word?.word ?? "");
    if (text && slug(text) === id) return text === text.toUpperCase() && text.length > 1 ? text[0] + text.slice(1).toLowerCase() : text;
  }
  return id.split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

/**
 * Bind the character names a direction map uses onto a style default cast:
 * each name the cast does not have (in order of first appearance, cues
 * before action.who) takes the next member no cue names, keeping its look
 * and voice and taking the name as its id and name. Cue ids and action.who
 * are rewritten to the bound ids ("Mia" → "mia"). A cast that is not
 * bindable is returned unchanged. Names are never used to guess a look.
 * → {map, cast: {style, characters}, bound: [{from, to, name}]}
 */
export function bindStoryCast(map, planned, { words = [] } = {}) {
  if (!planned?.cast || !isObject(map)) return { map, cast: planned?.cast ?? null, bound: [] };
  const cast = clone(planned.cast);
  if (!planned.bindable) return { map, cast, bound: [] };
  const out = clone(map);
  const ids = new Set(cast.characters.map((member) => member.id));
  const named = [];
  const note = (value) => {
    if (typeof value !== "string" || /^@\d+$/.test(value)) return;
    const id = ids.has(value) ? value : slug(value);
    if (id && !named.includes(id)) named.push(id);
  };
  const lines = mapLines(out);
  for (const { line } of lines) for (const cue of Array.isArray(line.cast) ? line.cast : []) note(cue?.id);
  for (const { line } of lines) note(line.action?.who);
  const used = new Set(named.filter((id) => ids.has(id)));
  const free = cast.characters.filter((member) => !used.has(member.id));
  const bound = [];
  for (const id of named) {
    if (ids.has(id)) continue;
    const member = free.shift();
    if (!member) break;
    bound.push({ from: member.id, to: id, name: displayName(id, words) });
    member.id = id;
    member.name = bound.at(-1).name;
  }
  // Cue ids and action.who in the bound spelling.
  const finalIds = new Set(cast.characters.map((member) => member.id));
  const respell = (value) => (typeof value === "string" && !finalIds.has(value) && finalIds.has(slug(value)) ? slug(value) : value);
  for (const { line } of lines) {
    for (const cue of Array.isArray(line.cast) ? line.cast : []) if (isObject(cue)) cue.id = respell(cue.id);
    if (isObject(line.action)) {
      line.action.who = respell(line.action.who);
      if (typeof line.action.target === "string") line.action.target = respell(line.action.target);
    }
  }
  return { map: out, cast, bound };
}

/**
 * The planner's cast fit on one direction map: normalise the cues, then bind
 * the story's names when the cast allows it. → {map, cast, bound, warnings}
 */
export function fitDirectionCast(map, { cast = null, words = [] } = {}) {
  const normalized = normalizeCastCues(map);
  const bound = bindStoryCast(normalized.map, cast, { words });
  const warnings = [
    ...normalized.changed.map((entry) => `cast: tooling mapped DIRECTION.json ${entry}`),
    ...bound.bound.map((entry) => `cast: tooling bound the story's "${entry.name}" to the style cast's ${entry.from} (look and voice kept)`)
  ];
  return { map: bound.map, cast: bound.cast, bound: bound.bound, warnings };
}
