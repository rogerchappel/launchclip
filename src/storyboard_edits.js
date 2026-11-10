// Edit rounds: a storyboard that fails its checks is corrected by small
// edits to the scenes the checks name, not by writing the whole plan again.
//
// A full repair resends the planning prompt (the module catalog, the brief,
// the previous storyboard) and has the model return every scene, blind, for
// each round of slips; an ambitious plan has more places to slip, so the
// richest plans failed most. An agent with the validator does not work that
// way: it reads the errors, changes the one scene that is wrong and checks
// again. This is that loop for the planner: the model is shown the failing
// checks, the scenes they name, where every scene sits and the narration's
// word times, and returns a list of edits. Tooling applies them and runs the
// checks again. The call is a few thousand tokens, so several rounds cost
// less than one repair.
//
// The edits change what is there (a time, an anchor, a track, a param) or
// take a scene out. They do not add scenes or change a scene's module: that
// needs the catalog, and stays the full repair's job.
import { resolveStory } from "@launchclip/core/story.mjs";

export const MAX_EDIT_ROUNDS = 6;
// Rounds in a row that leave as many errors as before, after which the full repair takes over.
export const EDIT_STALL = 2;

export const EDIT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["edits"],
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scene", "op", "path", "value_json"],
        properties: {
          scene: { type: "string" },
          op: { type: "string", enum: ["set", "delete", "remove-scene"] },
          path: { type: "string" },
          value_json: { type: "string" }
        }
      }
    }
  }
});

export const EDIT_INSTRUCTIONS = [
  "You are correcting a video storyboard that failed its checks. The plan is good; do not redesign it. Make the smallest edits that clear every failing check, and keep the plan as rich as it is.",
  "",
  "Return {\"edits\": [...]}. Each edit is {scene, op, path, value_json}:",
  "- op \"set\": set the value at `path` inside that scene to the JSON in `value_json` (a number, a string in quotes, an array or an object). Paths use dots and array indexes: \"start\", \"end\", \"track\", \"params.at\", \"params.cast.0.cues.2.at\", \"params.items\".",
  "- op \"delete\": remove the key or array item at `path` (value_json \"null\").",
  "- op \"remove-scene\": take the whole scene out (path \"\", value_json \"null\"). A last resort: only when a check says to drop the scene, or two scenes cannot both fit.",
  "",
  "Rules:",
  "- `scene` is the scene's id exactly as listed.",
  "- A time is written the way the storyboard already writes it: seconds as a number, or a word anchor string copied from the storyboard's own style. A word that occurs more than once needs its occurrence number, and that number cannot be higher than the times the word occurs; the narration list gives every word with its time.",
  "- Two scenes on the same track cannot overlap: end the earlier one where the later one starts, start the later one later, or move an overlay to a free track.",
  "- When a check gives a window or a minimum (a time that must fall between two values, a card that needs 1.2 s, a walk that needs 0.4 s before the next cue), move the time inside it with a little room; do not sit exactly on the limit.",
  "- When a scene is a little too short, give it time from a neighbour before removing it.",
  "- A params error names the first offending item; the same rule applies to its siblings, so fix them all.",
  "- Change nothing a check does not ask for. You cannot add scenes or change a scene's module here."
].join("\n");

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const round = (value) => Math.round(Number(value) * 100) / 100;

/** The ids of the scenes a list of check errors names (by scenes[N] or by id), in story order. */
export function scenesNamed(storyboard, errors) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  const named = new Set();
  for (const error of errors ?? []) {
    const text = String(error);
    for (const match of text.matchAll(/scenes\[(\d+)\]/g)) { const id = scenes[Number(match[1])]?.id; if (id) named.add(id); }
    for (const scene of scenes) {
      if (!scene?.id) continue;
      const id = String(scene.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // An id that is an ordinary word ("end", "open") counts only where the checks write ids: in brackets, in quotes, or before a bracketed module.
      const plain = /^[a-z]+$/i.test(String(scene.id));
      const pattern = plain ? `\\(${id}[ )]|"${id}"|(^|\\s)${id} \\(` : `(^|[^\\w-])${id}([^\\w-]|$)`;
      if (new RegExp(pattern).test(text)) named.add(scene.id);
    }
  }
  return scenes.map((scene) => scene?.id).filter((id) => named.has(id));
}

/** The request for one edit round. */
export function editRequest({ storyboard, errors, words = [], beats = null, round: number = 1, rounds = MAX_EDIT_ROUNDS }) {
  const scenes = Array.isArray(storyboard?.scenes) ? storyboard.scenes : [];
  let times = null;
  try {
    const resolved = resolveStory(JSON.parse(JSON.stringify(storyboard)), { words, beats });
    times = new Map(resolved.scenes.map((scene) => [scene.id, [scene.start, scene.end]]));
  } catch { /* an anchor does not resolve: the table shows the times as written */ }
  const written = (value) => (value === undefined ? "-" : typeof value === "string" ? JSON.stringify(value) : String(value));
  const table = scenes.map((scene, index) => {
    const span = times?.get(scene.id);
    return `${index} | ${scene.id} | track ${scene.track ?? 0} | ${scene.module} | start ${written(scene.start)} end ${written(scene.end)}${span && Number.isFinite(span[0]) && Number.isFinite(span[1]) ? ` | plays ${round(span[0])}-${round(span[1])} s` : ""}`;
  });
  const named = new Set(scenesNamed(storyboard, errors));
  const failing = scenes.filter((scene) => named.has(scene.id));
  const counts = new Map();
  const spoken = (Array.isArray(words) ? words : []).map((word) => {
    const text = String(word?.text ?? word?.word ?? "").trim();
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return `${text}${counts.get(key) > 1 ? `#${counts.get(key)}` : ""}@${round(word?.start ?? word?.t ?? 0)}`;
  });
  return [
    `## Edit round ${number} of ${rounds}`,
    "",
    "### Failing checks",
    "",
    ...errors.map((entry) => `- ${entry}`),
    "",
    "### Every scene (index | id | track | module | times as written | when it plays)",
    "",
    ...table,
    "",
    `### The scene${failing.length === 1 ? "" : "s"} the checks name`,
    "",
    ...(failing.length ? failing.map((scene) => JSON.stringify(scene)) : ["(the checks name no scene by id or index: read the table)"]),
    ...(spoken.length ? ["", "### Narration (word@seconds; a repeated word carries its occurrence number)", "", spoken.join(" ")] : []),
    ""
  ].join("\n");
}

/** The edits out of a client result: {ok, edits} or {ok: false, error}. */
export function extractEdits(result) {
  let value = result?.value ?? result?.output ?? result;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { return { ok: false, error: "the edits were not valid JSON" }; } }
  if (isObject(value) && Array.isArray(value.edits)) return { ok: true, edits: value.edits.filter(isObject) };
  return { ok: false, error: "no edits list was returned" };
}

/**
 * A copy of the storyboard with the edits applied:
 * {storyboard, applied: ["s3: end → 4.2"], rejected: ["s9: no such scene"]}.
 */
export function applyEdits(storyboard, edits) {
  const story = JSON.parse(JSON.stringify(storyboard));
  const applied = [];
  const rejected = [];
  for (const edit of Array.isArray(edits) ? edits : []) {
    const id = String(edit?.scene ?? "");
    const index = story.scenes.findIndex((scene) => scene?.id === id);
    if (index < 0) { rejected.push(`${id || "(no scene)"}: no such scene`); continue; }
    if (edit.op === "remove-scene") {
      if (story.scenes.length <= 1) { rejected.push(`${id}: the only scene cannot be removed`); continue; }
      story.scenes.splice(index, 1);
      applied.push(`${id}: removed`);
      continue;
    }
    const keys = String(edit.path ?? "").split(".").map((key) => key.trim()).filter(Boolean);
    if (!keys.length) { rejected.push(`${id}: ${edit.op} needs a path`); continue; }
    if (keys[0] === "id" || keys[0] === "module") { rejected.push(`${id}: ${keys[0]} cannot be edited`); continue; }
    if (keys.some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) { rejected.push(`${id}: bad path ${edit.path}`); continue; }
    let target = story.scenes[index];
    let reachable = true;
    for (const key of keys.slice(0, -1)) {
      if (target[key] === undefined && edit.op === "set" && !Array.isArray(target)) target[key] = {};
      target = target[key];
      if (target === null || typeof target !== "object") { reachable = false; break; }
    }
    if (!reachable) { rejected.push(`${id}: ${edit.path} is not in the scene`); continue; }
    const leaf = keys[keys.length - 1];
    if (edit.op === "delete") {
      if (Array.isArray(target)) { if (!/^\d+$/.test(leaf) || Number(leaf) >= target.length) { rejected.push(`${id}: ${edit.path} is not in the scene`); continue; } target.splice(Number(leaf), 1); }
      else if (leaf in target) delete target[leaf];
      else { rejected.push(`${id}: ${edit.path} is not in the scene`); continue; }
      applied.push(`${id}: ${edit.path} deleted`);
      continue;
    }
    if (edit.op !== "set") { rejected.push(`${id}: unknown op ${edit.op}`); continue; }
    let value;
    try { value = JSON.parse(String(edit.value_json)); } catch { value = String(edit.value_json ?? ""); }
    if (Array.isArray(target) && !/^\d+$/.test(leaf)) { rejected.push(`${id}: ${edit.path} is not an array index`); continue; }
    target[leaf] = value;
    applied.push(`${id}: ${edit.path} → ${typeof value === "object" ? JSON.stringify(value).slice(0, 80) : value}`);
  }
  return { storyboard: story, applied, rejected };
}

// The slips an edit can clear: a time, an anchor, a length, a position, a value from a short list, a param to take off.
// Anything that needs a new scene, another module or a change to the direction map (an unknown module, a card too
// many, a scene held so long its line needs a second shot, a missing shot, a map line) is the full repair's, which
// has the catalog.
const EDITABLE = [
  /overlaps scenes\[\d+\]/,
  /at once \(/,
  /Unknown anchor|anchor .*occurs \d+ times/i,
  /must fall between|before the next cue|must be seconds|must be before scenes\[|start must be before/,
  /duration must be between|needs a scene of at least/,
  /^reading: /,
  /closer than [\d.]+ s|space them out/,
  /off the canvas/,
  /must be at most \d+ (characters|words|items)/,
  /must be one of /,
  /is not allowed in the \w+ tier; remove it/,
  /needs params\.\w+/,
  /^pace: /
];

/** Whether every check error is a slip an edit round can clear (see EDITABLE); one that is not sends the plan to the full repair. */
export function editable(errors) {
  return Array.isArray(errors) && errors.length > 0 && errors.every((entry) => EDITABLE.some((pattern) => pattern.test(String(entry))));
}

// Where an error is, without what it measured: its first two parts (the check and the place), less quoted values
// and decimals, so "on screen for 1.12 s" and "for 1.15 s", or two wrong words on one anchor, are the same error.
const place = (error) => String(error).split(": ").slice(0, 2).join(": ").replace(/"[^"]*"/g, '""').replace(/word:[^\s:;,)]+/g, "word:").replace(/\d+\.\d+/g, "#");

/**
 * Whether an edit round moved the plan on: it passes, or at least one of the places it was given an error at is
 * clear and the plan has no more errors than before. Clearing one slip often shows the next one (an anchor fixed,
 * the next anchor found), so an error somewhere else in the same number is progress, not a stall.
 */
export function editProgress(before, after) {
  if (!after.length) return true;
  const left = new Set(after.map(place));
  return after.length <= before.length && before.some((entry) => !left.has(place(entry)));
}
