// Formats across industries (docs/SCORING_ROADMAP.md, stage 10; guide:
// docs/guide/scoring-compare.md). A post has a format (how it is built) and a
// topic (what it is about). Every niche's library is tagged with one shared
// format rubric, so two niches can be compared tag for tag.
//
//   tagFormats(rows, {rubric?, model?, ...})          → {rows, cost_usd}
//   compareNiches(a, b, {minPosts?, minLift?, ...})   → candidates: formats that do well in a and are rare in b
//   formatWorthTesting(candidates, {from, to})        → the "Worth testing here" section, as markdown
//   runCompare([a.jsonl, b.jsonl], flags, io)         → {a, b, cost_usd, candidates}
//   formatCompare(result)                             → that result as text
//
// A candidate is something to test in the second niche. Nothing here shows
// that a format which goes with good results in one industry does in another.
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SCORER_MODEL, parseRubric } from "../scorer.js";
import { tagPosts, withOutliers } from "./library.js";

export const FORMAT_RUBRIC_FILE = new URL("../../docs/guide/scoring-format-rubric.json", import.meta.url);

const round3 = (value) => Math.round(value * 1000) / 1000;
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** → the shared format rubric, or the one in `file`. */
export async function loadFormatRubric(file) {
  return parseRubric(JSON.parse(await readFile(file ? path.resolve(String(file)) : FORMAT_RUBRIC_FILE, "utf8")));
}

/**
 * Tags each row's words (caption and transcript) with the format rubric and
 * adds the answers to the row's own tags. A row with no words, or with every
 * format tag already, is returned as it is and costs nothing, so a run that
 * stopped can be started again. The picture is never sent: a format tag is a
 * reading of the words.
 */
export async function tagFormats(rows, { rubric, model, fetch = globalThis.fetch, apiKey, concurrency } = {}) {
  rubric ??= await loadFormatRubric();
  const keys = Object.keys(rubric.questions);
  const todo = rows.map((row, index) => ({ row, index, text: row.transcript ?? row.text })).filter(({ row, text }) => (row.caption || text) && !keys.every((key) => row.tags?.[key] != null));
  let cost = 0;
  // tagPosts reports no cost, so it is read from each reply on the way through.
  const counted = async (...call) => {
    const response = await fetch(...call);
    // Read before adding: `cost += await …` would lose replies that land together.
    const reply = response.ok ? await response.clone().json().catch(() => null) : null;
    cost += Number(reply?.usage?.cost) || 0;
    return response;
  };
  // outlier: null stops tagPosts working out outliers over a partial set.
  const tagged = todo.length ? await tagPosts(todo.map(({ row, text }) => ({ caption: row.caption, text, outlier: null })), rubric, { model: model ?? rubric.model ?? process.env.LAUNCHCLIP_SCORER_MODEL ?? DEFAULT_SCORER_MODEL, media: false, fetch: counted, ...(apiKey ? { apiKey } : {}), ...(concurrency ? { concurrency } : {}) }) : [];
  const out = [...rows];
  todo.forEach(({ row, index }, at) => { out[index] = { ...row, tags: { ...row.tags, ...tagged[at].tags }, answers: { ...row.answers, ...tagged[at].answers } }; });
  return { rows: out, cost_usd: Math.round(cost * 1e6) / 1e6 };
}

const wordsOf = (row) => String(row.caption || row.transcript || row.text || "").replace(/\s+/g, " ").trim();
const cut = (text, length = 120) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);

/**
 * a, b: {name, rows}. → the tag values that go with above-normal results in a
 * and are rare in b, highest lift first:
 *   [{question, value, a: {posts, share, median_outlier, lift}, b: {posts, share}, examples: [{url, account, outlier, words}]}]
 *
 * - share: of the niche's posts that carry that question's tag.
 * - lift: the median outlier of a's posts with the value over the median
 *   outlier of all of a's posts. Kept at minLift or more.
 * - minPosts: a's posts with the value and a settled result (an outlier).
 * - Rare in b: a share of rareShare or less, or under a third of a's share.
 * - questions: the tag keys compared. Default: every key both niches carry, so
 *   a tag only one library was given is never read as "absent" from the other.
 * - examples: up to 3 of a's posts with the value, highest outlier first.
 */
export function compareNiches(a, b, { minPosts = 8, minLift = 1.25, rareShare = 0.05, questions } = {}) {
  const measuredRows = (rows) => (rows.every((row) => row.outlier !== undefined) ? rows : withOutliers(rows));
  const rowsA = measuredRows(a.rows);
  const tagKeys = (rows) => new Set(rows.flatMap((row) => Object.keys(row.tags ?? {})));
  const inB = tagKeys(b.rows);
  const keys = questions ?? [...tagKeys(rowsA)].filter((key) => inB.has(key));
  const norm = median(rowsA.map((row) => row.outlier));
  if (!(norm > 0)) return [];
  // Shares are what carry a post to people who do not follow the account.
  const shareRate = (row) => (row.metrics?.views > 0 && Number.isFinite(row.metrics?.shares) ? row.metrics.shares / row.metrics.views : null);
  const rateOf = (rows) => median(rows.map(shareRate).filter((rate) => rate !== null));
  const normRate = rateOf(rowsA);
  const found = [];
  for (const question of keys) {
    const has = (row) => typeof row.tags?.[question] === "string";
    const taggedA = rowsA.filter(has);
    const taggedB = b.rows.filter(has);
    if (!taggedA.length || !taggedB.length) continue;
    for (const [value, group] of Map.groupBy(taggedA, (row) => row.tags[question])) {
      const measured = group.filter((row) => Number.isFinite(row.outlier)).sort((x, y) => y.outlier - x.outlier);
      if (measured.length < minPosts) continue;
      const groupMedian = median(measured.map((row) => row.outlier));
      const lift = groupMedian / norm;
      const shareA = group.length / taggedA.length;
      const postsB = taggedB.filter((row) => row.tags[question] === value).length;
      const shareB = postsB / taggedB.length;
      if (lift < minLift || !(shareB <= rareShare || shareB < shareA / 3)) continue;
      found.push({
        question,
        value,
        a: { posts: group.length, share: round3(shareA), median_outlier: round3(groupMedian), lift: round3(lift), ...(normRate > 0 && rateOf(group) >= 0 ? { share_lift: round3(rateOf(group) / normRate) } : {}) },
        b: { posts: postsB, share: round3(shareB) },
        examples: measured.slice(0, 3).map((row) => ({ url: row.url, account: row.account, outlier: row.outlier, words: cut(wordsOf(row)) }))
      });
    }
  }
  return found.sort((x, y) => y.a.lift - x.a.lift || (y.a.share_lift ?? 0) - (x.a.share_lift ?? 0));
}

const percent = (share) => (share > 0 && share < 0.005 ? "under 1%" : `${Math.round(share * 100)}%`);
// One decimal reads as a figure a person would say; the result keeps three.
const times = (value) => Math.round(value * 10) / 10;
const posts = (count) => `${count} post${count === 1 ? "" : "s"}`;

/**
 * candidates: from compareNiches(from, to). → the "Worth testing here" section
 * of a niche's report. rubric (optional) supplies each format's description.
 */
export function formatWorthTesting(candidates, { from = "the other niche", to = "this niche", rubric } = {}) {
  const lines = ["## Worth testing here", ""];
  if (!candidates.length) return `${lines.join("\n")}\nNothing stood out: no format that goes with above-normal results in ${from} is rare in ${to}.\n`;
  lines.push(`Formats that go with above-normal results in ${from} and are rare in ${to}.`, "");
  for (const { question, value, a, b, examples } of candidates) {
    const meaning = rubric?.questions?.[question]?.criteria?.[value];
    const links = examples.map((post) => (post.url ? `[@${post.account} at ${times(post.outlier)}x](${post.url})` : `@${post.account} at ${times(post.outlier)}x`)).join(", ");
    lines.push(`- **${question}: ${value}**${meaning ? `. ${meaning}` : "."} In ${from}: ${posts(a.posts)} (${percent(a.share)}), with a median of ${times(a.median_outlier)}x their own account's normal, ${times(a.lift)} times the median for that library. In ${to}: ${posts(b.posts)} (${percent(b.share)}).${links ? ` Examples: ${links}.` : ""}`);
  }
  lines.push("", `None of these has been tested in ${to}. Doing well in one industry is no evidence for another: try each one and let your own results decide.`);
  return `${lines.join("\n")}\n`;
}

/** The result of runCompare as text. */
export function formatCompare(result) {
  const { a, b } = result;
  return `Compared ${a.name} (${posts(a.posts)}, ${a.tagged} with format tags) with ${b.name} (${posts(b.posts)}, ${b.tagged} with format tags).${result.cost_usd ? ` Tagging cost $${result.cost_usd}.` : ""}\n\n${formatWorthTesting(result.candidates, { from: a.name, to: b.name, rubric: result.rubric })}`;
}

// out/horse-racing/library.jsonl is named for its folder; any other file for itself.
const nicheName = (file) => (/^library(\.tagged)?\.jsonl$/i.test(path.basename(file)) ? path.basename(path.dirname(file)) : path.basename(file).replace(/(\.tagged)?\.jsonl$/i, ""));

/**
 * `launchclip score library compare <a.jsonl> <b.jsonl> [--rubric file] [--model id] [--json]`
 * Lists the formats that do well in a and are rare in b. A library with rows
 * that lack format tags is tagged first and the tags are written back to its
 * file. io: {stdout?, fetch?}. → {a, b, cost_usd, candidates}, where a and b
 * are {name, file, posts, tagged}.
 */
export async function runCompare(args = [], flags = {}, io = {}) {
  if (args.length !== 2) throw new Error("usage: launchclip score library compare <a.jsonl> <b.jsonl> [--rubric <rubric.json>] [--model <id>] [--json]");
  const rubric = await loadFormatRubric(flags.rubric);
  const keys = Object.keys(rubric.questions);
  let cost = 0;
  const niches = [];
  for (const target of args) {
    const file = path.resolve(String(target));
    if (!existsSync(file)) throw new Error(`${file} not found`);
    const before = (await readFile(file, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
    const { rows, cost_usd: spent } = await tagFormats(before, { rubric, model: flags.model, ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.apiKey ? { apiKey: io.apiKey } : {}) });
    cost += spent;
    if (rows.some((row, index) => row !== before[index])) {
      // Written beside the library and renamed, so a stop mid-write leaves the old file whole.
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
      await rename(temp, file);
    }
    niches.push({ name: nicheName(file), file, rows });
  }
  const [a, b] = niches;
  const summary = ({ name, file, rows }) => ({ name, file, posts: rows.length, tagged: rows.filter((row) => keys.every((key) => row.tags?.[key] != null)).length });
  const result = { a: summary(a), b: summary(b), cost_usd: Math.round(cost * 1e6) / 1e6, candidates: compareNiches(a, b, { questions: keys }) };
  (io.stdout ?? process.stdout).write(flags.json ? `${JSON.stringify(result, null, 2)}\n` : formatCompare({ ...result, rubric }));
  return result;
}
