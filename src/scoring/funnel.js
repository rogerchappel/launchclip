// Generate wide, keep it varied (docs/SCORING_ROADMAP.md, stage 4).
//
//   writeHooks({topic, brief?, count, model, batchSize?, concurrency?, client?, onBatchError?})
//                                          → [{id, kind: "hook", text, source: "written"}]
//   assembleHooks({parts, count, seed?})  → [{id, kind: "hook", text, source: "assembled"}]
//   shortlist(scoredItems, {perType?, wildcards?, tag?, recent?, similarityLimit?, seed?})
//                                          → {picked, dropped: {failed, near_recent, near_duplicate, over_quota}}
//   runFunnel(target, flags, io?)          → the summary; writes candidates.jsonl, scored.json,
//                                            shortlist.txt and shortlist.json to --out
//
// Writing is the slow step, so it is many small requests side by side to a
// fast model, each with its own slant so the batches do not repeat each other.
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapLimit } from "../concurrency.js";
import { createStructuredClient } from "../model_provider.js";
import { parseRubric, scoreItems } from "../scorer.js";
import { predict } from "./fit.js";
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
export async function writeHooks({ topic, brief = "", count, model = process.env.LAUNCHCLIP_MAKE_MODEL, batchSize = 25, concurrency = 8, requirements = [], client, onBatchError } = {}) {
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
        instructions: `You write opening lines (hooks) for short videos and carousels. Write ${batchSize} distinct hooks on the topic. Each is one sentence a person would say out loud, under 20 words, with no hashtags, emoji or quotation marks. For this batch: ${slant}. Write for ${reader}. No two hooks may share an opening phrase. Invent no statistics about real people or companies.${requirements.length ? ` Every hook must follow these rules:\n- ${requirements.join("\n- ")}` : ""}`,
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

/**
 * What a rubric gates a kind on, as rules a writer can follow. Without them
 * the writer does not know the rubric, and most of what it writes fails it.
 */
export function rubricRequirements(rubric, kind = "hook") {
  return Object.values(rubric.questions)
    .filter((question) => question.type === "noul" && question.gate !== false && (question.on == null || [question.on].flat().includes(kind)))
    .map((question) => `${question.want === false ? "Never" : "Always"}: ${question.criteria?.true ?? question.instructions}`);
}

/**
 * Slots per type from the brand's own results (rows with own: true, a tag and
 * an outlier): of the types with 3 or more posts, the best third gets one
 * more slot and the worst third one fewer. → {type: slots}
 */
export function quotaFromResults(rows, { perType = 3, tag = "hook_type", seed = "" } = {}) {
  const logs = {};
  for (const row of rows) if (row.own && row.outlier > 0 && row.tags?.[tag] != null) (logs[String(row.tags[tag])] ??= []).push(Math.log(row.outlier));
  const draws = Object.entries(logs).filter(([, values]) => values.length >= 3).map(([type, values]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)) || 1;
    // Thompson sampling: each type is judged on a draw from what its results allow, so a type with few posts still gets tried.
    const z = Math.sqrt(-2 * Math.log((draw(seed, `u1:${type}`) + 1) / 2 ** 32)) * Math.cos(2 * Math.PI * (draw(seed, `u2:${type}`) / 2 ** 32));
    return [type, mean + (sd / Math.sqrt(values.length)) * z];
  }).sort((a, b) => b[1] - a[1]);
  const third = Math.floor(draws.length / 3);
  return Object.fromEntries(draws.map(([type], index) => [type, index < third ? perType + 1 : index >= draws.length - third ? Math.max(1, perType - 1) : perType]));
}

function meanPass(item) {
  const shares = Object.values(item.answers ?? {}).map((answer) => answer?.p).filter(Number.isFinite);
  return shares.length ? shares.reduce((sum, p) => sum + p, 0) / shares.length : 0;
}

/**
 * scoredItems: the `items` of a scoreItems report. recent: the brand's last
 * hooks, as text. A filter and a spread, not a ranking by quality.
 * → {picked: [item + {type, wildcard?}], dropped: {failed, near_recent, near_duplicate, over_quota}} (dropped holds ids)
 */
export function shortlist(scoredItems, { perType = 3, wildcards = 2, tag = "hook_type", recent = [], similarityLimit = DEFAULT_HOOK_SIMILARITY_LIMIT, seed = "", quota = {}, rank = null } = {}) {
  const dropped = { failed: [], near_recent: [], near_duplicate: [], over_quota: [] };
  const near = (item, texts) => texts.some((text) => alike(item.text, text) >= similarityLimit);
  const open = [];
  for (const item of scoredItems) {
    if (item.status === "failed") dropped.failed.push(item.id);
    else if (near(item, recent)) dropped.near_recent.push(item.id);
    else open.push(item);
  }
  // Fewest unsure answers first, then the higher mean pass probability; ties keep the order given.
  // rank: a fitted model's prediction per id (src/scoring/fit.js); when given, real results order the list before the scorer does.
  open.sort((a, b) => (rank?.[b.id] ?? 0) - (rank?.[a.id] ?? 0) || (a.unsure?.length ?? 0) - (b.unsure?.length ?? 0) || meanPass(b) - meanPass(a));
  const picked = [];
  const kept = {};
  const spare = [];
  for (const item of open) {
    const type = String(item.tags?.[tag] ?? "untagged");
    if (near(item, picked.map((entry) => entry.text))) dropped.near_duplicate.push(item.id);
    // The quota is per type because picking the overall top of one scorer makes everything sound alike.
    else if ((kept[type] ?? 0) >= (quota[type] ?? perType)) spare.push({ ...item, type });
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

const USAGE = "<topic|brief.md> [--count <n>] [--assemble <parts.json>] [--rubric <rubric.json>] [--recent <hooks.txt>] [--per-type <n>] [--wildcards <n>] [--model <provider:model>] [--scorer-model <id>] [--concurrency <n>] [--results <own.tagged.jsonl>] [--fit <model.json>] [--formats <niche|worth-testing.json>] [--seed <text>] [--out <dir>]";
const STARTER_RUBRIC = fileURLToPath(new URL("../../docs/guide/scoring-rubric.json", import.meta.url));

function wholeNumber(flags, name, fallback, least) {
  if (flags[name] == null) return fallback;
  const value = Number(flags[name]);
  if (!Number.isInteger(value) || value < least) throw new Error(`--${name} must be a whole number, ${least} or more; got ${flags[name]}`);
  return value;
}

/**
 * Write or assemble hooks on a topic, score them, and shortlist a spread.
 * target: a topic, or a brief file (its first line is the topic). With
 * --assemble the hooks are assembled; with --count as well, written too.
 * io: {client (a writer with runStructured), fetch, apiKey}, for tests.
 * Writes candidates.jsonl, scored.json, shortlist.txt and shortlist.json to
 * --out (default ./funnel). → {topic, out, models, counts, seconds, cost_usd,
 * warnings, shortlist}
 */
export async function runFunnel(target, flags = {}, io = {}) {
  if (!String(target ?? "").trim()) throw new Error(`the hook funnel needs a topic or a brief file: ${USAGE}`);
  const file = path.resolve(String(target));
  const isBrief = existsSync(file) && statSync(file).isFile();
  const brief = isBrief ? await readFile(file, "utf8") : "";
  const topic = isBrief ? (brief.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? path.basename(file)) : String(target).trim();
  const count = wholeNumber(flags, "count", 200, 1);
  const perType = wholeNumber(flags, "per-type", 3, 1);
  const wildcards = wholeNumber(flags, "wildcards", 2, 0);
  const seed = String(flags.seed ?? "");
  const rubricFile = flags.rubric ? path.resolve(String(flags.rubric)) : STARTER_RUBRIC;
  const rubric = parseRubric(JSON.parse(await readFile(rubricFile, "utf8")));
  // --formats <niche|worth-testing.json>: formats borrowed from other niches (launchclip score niche writes the file). Only their names and the shared rubric's own descriptions reach the writer, never scraped words.
  let formats = "";
  if (flags.formats) {
    const { nichesDir } = await import("./niche.js");
    const { loadFormatRubric } = await import("./compare.js");
    const formatsFile = existsSync(String(flags.formats)) ? path.resolve(String(flags.formats)) : path.join(nichesDir(flags), String(flags.formats), "worth-testing.json");
    if (!existsSync(formatsFile)) throw new Error(`--formats: ${formatsFile} not found; run launchclip score niche for this niche after collecting another one`);
    const criteria = (await loadFormatRubric()).questions;
    const lines = JSON.parse(await readFile(formatsFile, "utf8")).slice(0, 8).map((entry) => `- ${String(entry.value).replace(/_/g, " ")}${criteria[entry.question]?.criteria?.[entry.value] ? `: ${criteria[entry.question].criteria[entry.value]}` : ""}`);
    if (lines.length) formats = `Formats to write in. They do well in other industries and are rare in this one. Spread the hooks evenly across them, keeping each format's shape and changing only the subject:\n${[...new Set(lines)].join("\n")}`;
  }
  const parts = flags.assemble ? parseHookParts(JSON.parse(await readFile(path.resolve(String(flags.assemble)), "utf8"))) : null;
  const recent = flags.recent ? (await readFile(path.resolve(String(flags.recent)), "utf8")).split("\n").map((line) => line.trim()).filter(Boolean) : [];
  const writes = !parts || flags.count != null;
  const model = flags.model ?? process.env.LAUNCHCLIP_MAKE_MODEL;

  const seconds = {};
  const started = performance.now();
  const since = (from) => Math.round(performance.now() - from) / 1000;
  const timed = async (step, work) => {
    const from = performance.now();
    try { return await work(); } finally { seconds[step] = since(from); }
  };
  const warnings = [];

  // The writing client reports tokens, not money; the router's own figure is read off each reply on its way through.
  let writeCost = 0;
  const fetchImpl = io.fetch ?? globalThis.fetch;
  const costed = async (...request) => {
    const response = await fetchImpl(...request);
    // Read first, add after: batches overlap, and `+=` across an await loses the others' figures.
    const cost = Number((await response.clone().json().catch(() => null))?.usage?.cost) || 0;
    writeCost += cost;
    return response;
  };
  const written = writes ? await timed("write", () => writeHooks({
    topic, brief: [brief, formats].filter(Boolean).join("\n\n"), count, model, requirements: rubricRequirements(rubric),
    client: io.client ?? (model ? createStructuredClient(model, { fetch: costed }) : undefined),
    onBatchError: (error, index) => warnings.push(`writing batch ${index + 1} failed: ${error.message}`)
  })) : [];
  const assembled = parts ? await timed("assemble", () => assembleHooks({ parts, count, seed })) : [];
  const candidates = dropExactDuplicates([...written, ...assembled]);

  const out = path.resolve(String(flags.out ?? "funnel"));
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "candidates.jsonl"), candidates.map((item) => `${JSON.stringify(item)}\n`).join(""));

  const report = await timed("score", () => scoreItems(candidates, rubric, {
    model: flags["scorer-model"],
    concurrency: wholeNumber(flags, "concurrency", 32, 1),
    context: isBrief ? { brief } : { topic },
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...(io.apiKey ? { apiKey: io.apiKey } : {})
  }));
  await writeFile(path.join(out, "scored.json"), `${JSON.stringify({ ...report, rubric: rubricFile }, null, 2)}\n`);

  const tag = flags.tag ? String(flags.tag) : "hook_type";
  const jsonl = async (file) => (await readFile(path.resolve(String(file)), "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  // Stage 6: the brand's own results move slots between types, and a fitted model that has earned it orders the list.
  const quota = flags.results ? quotaFromResults(await jsonl(flags.results), { perType, tag, seed }) : {};
  let rank = null;
  if (flags.fit) {
    const fitted = JSON.parse(await readFile(path.resolve(String(flags.fit)), "utf8"));
    const missing = [...new Set(fitted.schema.columns.map((column) => column.key))].filter((key) => !rubric.questions[key]);
    if (!fitted.usable) warnings.push(`--fit ${flags.fit} is not usable yet (${fitted.reasons.join("; ")}), so it did not order the shortlist`);
    else if (missing.length) warnings.push(`--fit ${flags.fit} was trained on questions this rubric does not ask (${missing.join(", ")}), so it did not order the shortlist`);
    else rank = Object.fromEntries(predict(fitted, report.items).map((entry) => [entry.id, entry.predicted_outlier]));
  }
  const options = { perType, wildcards, recent, seed, tag, quota, rank };
  const chosen = await timed("shortlist", () => shortlist(report.items, options));
  await writeFile(path.join(out, "shortlist.json"), `${JSON.stringify({ topic, per_type: perType, wildcards, seed, recent: recent.length, ...chosen }, null, 2)}\n`);
  await writeFile(path.join(out, "shortlist.txt"), chosen.picked.map((item) => `${item.text}\n`).join(""));
  seconds.total = since(started);

  const dollars = (value) => Math.round(value * 1e6) / 1e6;
  return {
    topic,
    out,
    models: { writer: writes ? (io.client ? io.client.model ?? null : model) : null, scorer: report.model },
    counts: {
      written: written.length,
      assembled: assembled.length,
      candidates: candidates.length,
      ...report.counts,
      near_recent: chosen.dropped.near_recent.length,
      near_duplicate: chosen.dropped.near_duplicate.length,
      over_quota: chosen.dropped.over_quota.length,
      shortlisted: chosen.picked.length,
      wildcards: chosen.picked.filter((item) => item.wildcard).length
    },
    seconds,
    // write is what the router reported; a host that reports no cost counts as 0.
    cost_usd: { write: dollars(writeCost), score: report.cost_usd, total: dollars(writeCost + report.cost_usd) },
    warnings,
    quota,
    ranked_by_results: Boolean(rank),
    shortlist: chosen.picked.map((item) => ({ id: item.id, type: item.type, text: item.text, ...(item.wildcard ? { wildcard: true } : {}) }))
  };
}
