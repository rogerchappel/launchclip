// The long-form copy pass (docs/LONG_FORM_MAKE_RFC.md §5.3): the beat
// director's states carry rule-made words ("Lineage tells Northlight"). One
// model call per chunk (≤ 180 s) rewrites the on-screen words and figures of
// its states from the narration and the notes. The module, the timing and the
// number of items are the director's: a rewrite that changes them, or that
// the module rejects, keeps the rule-made params, so a bad answer never fails
// the video.
import { DEFAULT_BRAND, moduleCatalogue } from "@launchclip/core/planning-prompt.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { estimateModelUsageCost } from "../cost_tracker.js";

// Changes that carry the card before on (a hold, a focus step) have no words of their own.
const CARRIED = new Set(["hold", "focus", "guide"]);
// State kinds tooling writes (stings, calls to action): never rewritten.
const FIXED_KINDS = new Set(["sting", "cta"]);
const TIMING_KEYS = new Set(["at", "doneAt", "start", "end"]);
const CONCURRENCY = 3;

const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["states"],
  properties: {
    states: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "params_json"],
        properties: {
          id: { type: "string" },
          params_json: { type: "string", description: "The state's params as a JSON object, same keys, items and timings, with better words." }
        }
      }
    }
  }
});

const ROLE = `You write the on-screen words for a long explainer video's motion graphics. Each state below is one card on screen while the narration line beside it is spoken; a planner already chose the module, its layout and its timing, and filled the params with rough words taken from the line.

Rewrite each state's params so the card says something a viewer understands at a glance:
- Short, specific labels and headlines: names, numbers and dates from the narration line or the notes. Never invent a figure; a chart only shows values the narration or the notes state, otherwise relabel it with what they do say.
- Keep every key the params have, keep the same number of items, and keep every "at" and "doneAt" exactly. Change words and values only.
- Respect the module's limits (lengths, counts) given beside it.
- If a state's params already read well, return them unchanged.
Return every state, with its params as a JSON string, and nothing else.`;

/**
 * Rewrite the copy of every chunk not already rewritten. options: {client,
 * model, provider, map (the beat map: rewritten in place), words, notes,
 * format, brand, done (chunk keys already rewritten), say}.
 * → {chunks: [{id, key, changed, kept, reused, cost_usd, usage, model}]}
 */
export async function rewriteLongFormCopy(options = {}) {
  const { map, done = new Set() } = options;
  const docs = new Map(moduleCatalogue().map((entry) => [entry.id, entry]));
  const statesOf = chunkStates(map);
  const jobs = map.chunks.map((chunk) => async () => {
    if (done.has(chunk.key)) { chunk.copy = true; return { id: chunk.id, key: chunk.key, reused: true, changed: 0, kept: 0 }; }
    const states = statesOf.get(chunk.id) ?? [];
    if (!states.length) { chunk.copy = true; return { id: chunk.id, key: chunk.key, reused: false, changed: 0, kept: 0 }; }
    const result = await rewriteChunk({ ...options, chunk, states, docs });
    chunk.copy = true;
    return { id: chunk.id, key: chunk.key, reused: false, ...result };
  });
  return { chunks: await limited(jobs, CONCURRENCY) };
}

/** The states each chunk owns, by chunk id: the ones with words of their own. */
export function chunkStates(map) {
  const byShot = new Map();
  for (const chapter of map.chapters ?? []) for (const shot of chapter.shots ?? []) byShot.set(shot.id, shot);
  return new Map((map.chunks ?? []).map((chunk) => [chunk.id, chunk.shots
    .flatMap((id) => byShot.get(id)?.states ?? [])
    .filter((state) => state.params && !CARRIED.has(state.change) && !FIXED_KINDS.has(state.kind))]));
}

async function rewriteChunk({ client, model = null, provider = null, chunk, states, docs, notes = [], format, brand, say }) {
  if (!client) throw new Error("the copy pass needs a model client");
  say?.(`model: PAID call to ${provider ?? client.provider} ${model} (on-screen copy, chunk ${chunk.id}, ${states.length} cards)`);
  const lines = [
    `Chunk ${chunk.id}: ${states.length} cards.`,
    "",
    ...states.flatMap((state) => {
      const doc = docs.get(state.module);
      const limits = (doc?.params ?? []).filter((param) => !param.tuning).map((param) => `${param.name}: ${param.text}`).join("; ");
      return [`## ${state.id} (${state.module}, ${round(state.end - state.start)} s)`, `Narration: ${state.text}`, `Module: ${doc?.describe ?? state.module}`, `Limits: ${limits}`, `Params: ${JSON.stringify(state.params)}`, ""];
    })
  ];
  if (notes.length) lines.push("## Notes", "", ...notes.map((text) => String(text).trim().slice(0, 6000)));
  const result = await client.runStructured({ instructions: ROLE, input: `${lines.join("\n")}\n`, schema: SCHEMA, schemaName: "launchclip_long_form_copy", model: undefined, maxOutputTokens: 8000 });
  const usage = result?.usage ?? {};
  const cost = estimateModelUsageCost(provider ?? client.provider ?? "openai", result?.model ?? model, usage).estimated_usd;
  const answers = new Map((Array.isArray(result?.value?.states) ? result.value.states : []).map((entry) => [String(entry?.id ?? ""), entry?.params_json]));
  let changed = 0, kept = 0;
  for (const state of states) {
    const next = parseParams(answers.get(state.id));
    if (next && sameShape(state.params, next) && fits(state.module, next, state.end - state.start, format, brand)) {
      if (JSON.stringify(next) !== JSON.stringify(state.params)) { state.params = next; changed += 1; }
    } else kept += 1;
  }
  return { changed, kept, cost_usd: cost, usage, model: result?.model ?? model };
}

function parseParams(text) {
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

/**
 * Whether a rewrite kept the planner's structure: the same keys, the same
 * number of items in every list, and every timing value unchanged.
 */
export function sameShape(before, after) {
  if (Array.isArray(before)) return Array.isArray(after) && before.length === after.length && before.every((item, i) => sameShape(item, after[i]));
  if (before && typeof before === "object") {
    if (!after || typeof after !== "object" || Array.isArray(after)) return false;
    const keys = Object.keys(before);
    if (keys.length !== Object.keys(after).length || !keys.every((key) => key in after)) return false;
    return keys.every((key) => (TIMING_KEYS.has(key) ? before[key] === after[key] : sameShape(before[key], after[key])));
  }
  // Leaves may change value, not kind (a number stays a number).
  return typeof before === typeof after;
}

function fits(module, params, seconds, format, brand) {
  const duration = Math.max(1, round(seconds));
  const scene = { id: "copy-check", module, start: 0, end: duration, params };
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: format.width, height: format.height, fps: 30, duration }, brand: brand ?? DEFAULT_BRAND, scenes: [scene], resolved: { duration, fps: 30 } };
  try { resolveModule(scene, story); return true; } catch { return false; }
}

async function limited(jobs, size) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

function round(value) { return Math.round(value * 100) / 100; }
