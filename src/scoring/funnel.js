// Generate wide, keep it varied (docs/SCORING_ROADMAP.md, stage 4).
//
//   writeHooks({topic, brief?, count, model, batchSize?, concurrency?, client?, onBatchError?})
//                                          → [{id, kind: "hook", text, source: "written"}]
//   assembleHooks({parts, count, seed?})  → [{id, kind: "hook", text, source: "assembled"}]
//   shortlist(scoredItems, {perType?, wildcards?, tag?, recent?, similarityLimit?, seed?})
//                                          → {picked, dropped: {failed, near_recent, near_duplicate, over_quota}}
//
// Writing is the slow step, so it is many small requests side by side to a
// fast model, each with its own slant so the batches do not repeat each other.
import { createHash } from "node:crypto";
import { mapLimit } from "../concurrency.js";
import { createStructuredClient } from "../model_provider.js";
import { DEFAULT_HOOK_SIMILARITY_LIMIT, hookSimilarity } from "../visual_history.js";

// What a batch is told to lead with. Batch i takes slant i and, once the
// slants have gone round, the next reader, so no two batches share a brief.
export const HOOK_SLANTS = Object.freeze([
  "lead with a specific number or a counted list",
  "name a mistake the reader is making right now",
  "make a contrarian claim that goes against the usual advice",
  "open on one specific moment of a story, in the first person",
  "ask a question with real stakes for the reader",
  "state a concrete result and how long it took",
  "name who it is for in the first three words",
  "open with a warning about what it costs to ignore this",
  "compare two things the reader assumes are the same",
  "reveal something most people in the field get wrong"
]);
const READERS = Object.freeze(["someone new to the subject", "a sceptic who has heard it all before", "a practitioner short on time", "someone who tried this and failed"]);

const HOOKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: { hooks: { type: "array", items: { type: "string" } } }
};

const sameText = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Items with texts seen before (ignoring case and spacing) left out. `seen` carries over between calls. */
export function dropExactDuplicates(items, seen = new Set()) {
  return items.filter((item) => {
    const key = sameText(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * `count` hooks on a topic, asked for in parallel batches of `batchSize`.
 * model: a route as `make` takes it (provider:model); defaults to
 * LAUNCHCLIP_MAKE_MODEL. client: anything with runStructured(), for tests.
 * A batch that fails is left out and reported to onBatchError; only every
 * batch failing throws. Fewer than `count` come back when batches repeat
 * each other or fail.
 */
export async function writeHooks({ topic, brief = "", count, model = process.env.LAUNCHCLIP_MAKE_MODEL, batchSize = 25, concurrency = 8, client, onBatchError } = {}) {
  if (!String(topic ?? "").trim()) throw new Error("writeHooks needs a topic");
  if (!(count >= 1) || !(batchSize >= 1)) throw new Error(`writeHooks needs count and batchSize of 1 or more; got ${count} and ${batchSize}`);
  if (!client && !model) throw new Error("writeHooks needs a writing model: pass --model provider:model or set LAUNCHCLIP_MAKE_MODEL");
  const writer = client ?? createStructuredClient(model);
  const batches = Array.from({ length: Math.ceil(count / batchSize) }, (_, index) => index);
  let firstError = null;
  const written = await mapLimit(batches, concurrency, async (index) => {
    const slant = HOOK_SLANTS[index % HOOK_SLANTS.length];
    const reader = READERS[Math.floor(index / HOOK_SLANTS.length) % READERS.length];
    try {
      const result = await writer.runStructured({
        instructions: `You write opening lines (hooks) for short videos and carousels. Write ${batchSize} distinct hooks on the topic. Each is one sentence a person would say out loud, under 20 words, with no hashtags, emoji or quotation marks. For this batch: ${slant}. Write for ${reader}. No two hooks may share an opening phrase. Invent no statistics about real people or companies.`,
        input: `Topic: ${String(topic).trim()}${brief.trim() ? `\n\nBrief:\n${brief.trim()}` : ""}`,
        schema: HOOKS_SCHEMA,
        schemaName: "launchclip_hook_batch",
        // Variety is the point of this step, so it does not ask for the most likely answer.
        temperature: 1,
        reasoningEffort: "none",
        maxOutputTokens: 60 * batchSize + 200
      });
      return (result?.value?.hooks ?? []).filter((text) => typeof text === "string").map((text) => text.replace(/\s+/g, " ").trim());
    } catch (error) {
      firstError ??= error;
      onBatchError?.(error, index);
      return null;
    }
  });
  if (written.every((batch) => batch === null)) throw firstError;
  return dropExactDuplicates(written.flat().filter(Boolean).map((text) => ({ text })))
    .slice(0, count)
    .map((item, index) => ({ id: `written-${index + 1}`, kind: "hook", text: item.text, source: "written" }));
}

export const HOOK_SLOTS = Object.freeze({ audience: "audiences", number: "numbers", topic: "topics", payoff: "payoffs" });

// A whole number from a seed and a key: the same pair always gives the same one.
const draw = (seed, key) => createHash("sha1").update(`${seed}:${key}`).digest().readUInt32BE(0);

/** value: the parsed parts file. → the parts, or throws naming every problem. */
export function parseHookParts(value) {
  const errors = [];
  const lists = Object.fromEntries(["openers", ...Object.values(HOOK_SLOTS)].map((name) => [name, value?.[name] ?? []]));
  for (const [name, list] of Object.entries(lists)) {
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string" && typeof entry !== "number")) errors.push(`${name} must be a list of text`);
  }
  if (!errors.length && !lists.openers.length) errors.push('openers needs at least one template, such as "{number} mistakes {audience} make with {topic}"');
  if (!errors.length) {
    for (const opener of lists.openers) {
      for (const [, slot] of String(opener).matchAll(/\{(\w+)\}/g)) {
        if (!HOOK_SLOTS[slot]) errors.push(`opener "${opener}" uses {${slot}}; the slots are ${Object.keys(HOOK_SLOTS).map((name) => `{${name}}`).join(" ")}`);
        else if (!lists[HOOK_SLOTS[slot]].length) errors.push(`opener "${opener}" uses {${slot}}, but ${HOOK_SLOTS[slot]} is empty`);
      }
    }
  }
  if (errors.length) throw new Error(`hook parts: ${errors.join("; ")}`);
  return lists;
}

/**
 * `count` hooks built from parts, with no model: an opener template and a
 * value for each of its slots, drawn by seed, no text twice. The same parts,
 * count and seed give the same hooks. Fewer than `count` come back when the
 * parts cannot make that many.
 */
export function assembleHooks({ parts, count, seed = "" } = {}) {
  const lists = parseHookParts(parts);
  if (!(count >= 1)) throw new Error(`assembleHooks needs a count of 1 or more; got ${count}`);
  const items = [];
  const seen = new Set();
  // shortcut: draws and rejects repeats, which wastes tries only when count is close to every combination the
  // parts can make; the cap on tries ends it then. Enumerate the combinations if parts files grow that tight.
  for (let n = 0; items.length < count && n < count * 50 + 1000; n += 1) {
    const opener = String(lists.openers[draw(seed, `${n}:opener`) % lists.openers.length]);
    const raw = opener.replace(/\{(\w+)\}/g, (_, slot) => {
      const list = lists[HOOK_SLOTS[slot]];
      return String(list[draw(seed, `${n}:${slot}`) % list.length]);
    }).replace(/\s+/g, " ").trim();
    const text = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (!text || seen.has(sameText(text))) continue;
    seen.add(sameText(text));
    items.push({ id: `assembled-${items.length + 1}`, kind: "hook", text, source: "assembled" });
  }
  return items;
}

// The measure `launchclip history check` flags repeated hooks with: 0–1 overlap of content words.
const alike = (a, b) => hookSimilarity({ hook: { text: a } }, { hook: { text: b } });

function meanPass(item) {
  const shares = Object.values(item.answers ?? {}).map((answer) => answer?.p).filter(Number.isFinite);
  return shares.length ? shares.reduce((sum, p) => sum + p, 0) / shares.length : 0;
}

/**
 * scoredItems: the `items` of a scoreItems report. recent: the brand's last
 * hooks, as text. A filter and a spread, not a ranking by quality.
 * → {picked: [item + {type, wildcard?}], dropped: {failed, near_recent, near_duplicate, over_quota}} (dropped holds ids)
 */
export function shortlist(scoredItems, { perType = 3, wildcards = 2, tag = "hook_type", recent = [], similarityLimit = DEFAULT_HOOK_SIMILARITY_LIMIT, seed = "" } = {}) {
  const dropped = { failed: [], near_recent: [], near_duplicate: [], over_quota: [] };
  const near = (item, texts) => texts.some((text) => alike(item.text, text) >= similarityLimit);
  const open = [];
  for (const item of scoredItems) {
    if (item.status === "failed") dropped.failed.push(item.id);
    else if (near(item, recent)) dropped.near_recent.push(item.id);
    else open.push(item);
  }
  // Fewest unsure answers first, then the higher mean pass probability; ties keep the order given.
  open.sort((a, b) => (a.unsure?.length ?? 0) - (b.unsure?.length ?? 0) || meanPass(b) - meanPass(a));
  const picked = [];
  const kept = {};
  const spare = [];
  for (const item of open) {
    const type = String(item.tags?.[tag] ?? "untagged");
    if (near(item, picked.map((entry) => entry.text))) dropped.near_duplicate.push(item.id);
    // The quota is per type because picking the overall top of one scorer makes everything sound alike.
    else if ((kept[type] ?? 0) >= perType) spare.push({ ...item, type });
    else {
      kept[type] = (kept[type] ?? 0) + 1;
      picked.push({ ...item, type });
    }
  }
  // Wildcards: drawn by seed, not by score, from what the quota left out, so the scorer's taste is not the only one on the list.
  let wild = 0;
  for (const item of spare.sort((a, b) => draw(seed, a.id) - draw(seed, b.id))) {
    if (wild < wildcards && !near(item, picked.map((entry) => entry.text))) {
      wild += 1;
      picked.push({ ...item, wildcard: true });
    } else dropped.over_quota.push(item.id);
  }
  return { picked, dropped };
}
