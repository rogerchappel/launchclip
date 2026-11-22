// A library of real posts from a niche, tagged and joined to their numbers
// (docs/SCORING_ROADMAP.md, stage 3; guide: docs/guide/scoring-library.md).
//
//   importPosts(source, {platform?})            → post rows
//   fetchApify({actor, input, token?})          → raw items from an Apify actor
//   withOutliers(rows)                          → rows with `outlier`
//   tagPosts(rows, rubric, {model?, ...})       → tagged rows
//   nicheMap(taggedRows), formatNicheMap(map)   → what is crowded, open, and beating its channel
//   runLibrary(action, target, flags, io)       → import | fetch | tag | map
//
// A post row, one JSON object a line in library.jsonl:
//   {id, platform, account, url?, posted_at?, caption?, text?, media?,
//    followers?, paid?, metrics: {views?, likes?, comments?, shares?, saves?}, raw?}
// A tagged row adds tags: {key: value}, answers: {key: {status, value, p}} and
// outlier, plus media_skipped: true when its media could not be sent.
//
// Captions and scraped fields are other people's text. They are sent to the
// model as data and nothing here acts on an answer.
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mapLimit } from "../concurrency.js";
import { ask, judge, parseRubric, questionsFor } from "../scorer.js";

export const APIFY_URL = "https://api.apify.com/v2";

// Where each field of a post row is read from, first match wins. Names are the
// row's own, then Apify's TikTok scraper (clockworks/tiktok-scraper), then its
// Instagram scraper (apify/instagram-scraper). A dotted name also matches the
// flattened column of a CSV export ("authorMeta.name" or "authorMeta/name").
const FIELDS = {
  id: ["id", "shortCode"],
  platform: ["platform"],
  account: ["account", "authorMeta.name", "ownerUsername", "username", "author"],
  url: ["url", "webVideoUrl", "postUrl", "inputUrl"],
  posted_at: ["posted_at", "createTimeISO", "timestamp", "createTime", "date"],
  caption: ["caption", "description"],
  text: ["transcript", "on_screen_text"],
  media: ["media", "videoUrl", "mediaUrls.0", "video_url", "displayUrl", "videoMeta.coverUrl"],
  followers: ["followers", "authorMeta.fans", "followersCount", "ownerFollowersCount"],
  paid: ["paid", "isAd", "isSponsored", "isPaidPartnership"]
};
const METRICS = {
  views: ["metrics.views", "views", "playCount", "videoPlayCount", "videoViewCount", "viewCount"],
  likes: ["metrics.likes", "likes", "diggCount", "likesCount", "likeCount"],
  comments: ["metrics.comments", "comments", "commentCount", "commentsCount"],
  shares: ["metrics.shares", "shares", "shareCount", "sharesCount"],
  saves: ["metrics.saves", "saves", "collectCount", "savesCount"]
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const blank = (value) => value == null || value === "";
// Instagram reports -1 for a hidden count, so a negative number is "unknown".
const count = (value) => (blank(value) || typeof value === "object" || !(Number(value) >= 0) ? undefined : Number(value));
const flag = (value) => value === true || /^(true|1|yes)$/i.test(String(value));

/** RFC 4180 CSV → a list of objects keyed by the header row. */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  const source = String(text).replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") { record.push(field); field = ""; } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field || record.length) records.push([...record, field]);
  const [header = [], ...lines] = records.filter((cells) => cells.some((cell) => cell.trim()));
  return lines.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index] ?? ""])));
}

function pick(row, names, used) {
  for (const name of names) {
    const parts = name.split(".");
    for (const flat of new Set([name, parts.join("/")])) {
      if (!blank(row[flat])) { used.add(flat); return row[flat]; }
    }
    const nested = parts.reduce((value, part) => (value == null ? undefined : value[part]), row);
    if (parts.length > 1 && !blank(nested)) return nested;
  }
  return undefined;
}

function isoDate(value) {
  // A bare number is Unix time: seconds from TikTok, milliseconds from elsewhere.
  const date = /^\d+(\.\d+)?$/.test(String(value)) ? new Date(Number(value) * (Number(value) < 1e11 ? 1000 : 1)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalise(row, index, platform) {
  const used = new Set(["metrics", "raw"]);
  const got = Object.fromEntries(Object.entries(FIELDS).map(([field, names]) => [field, pick(row, names, used)]));
  // TikTok's scraper calls the caption `text`. A row with its own caption keeps `text` for the words on screen or spoken.
  if (!blank(row.text)) { used.add("text"); if (blank(got.caption)) got.caption = row.text; else got.text ??= row.text; }
  const url = blank(got.url) ? undefined : String(got.url);
  const metrics = {};
  for (const [name, names] of Object.entries(METRICS)) {
    const value = names.map((key) => count(pick(row, [key], used))).find((number) => number !== undefined);
    if (value !== undefined) metrics[name] = value;
  }
  const paid = FIELDS.paid.filter((name) => !blank(row[name]));
  const site = platform ?? got.platform ?? (/tiktok\.com/i.test(url ?? "") ? "tiktok" : /instagram\.com/i.test(url ?? "") ? "instagram" : "unknown");
  const raw = { ...(isObject(row.raw) ? row.raw : {}), ...Object.fromEntries(Object.entries(row).filter(([key, value]) => !used.has(key) && !blank(value))) };
  const post = {
    id: String(blank(got.id) ? url ?? `post-${index + 1}` : got.id),
    platform: String(site).toLowerCase(),
    account: blank(got.account) ? "unknown" : String(got.account).replace(/^@/, ""),
    url,
    posted_at: blank(got.posted_at) ? undefined : isoDate(got.posted_at),
    caption: blank(got.caption) ? undefined : String(got.caption),
    text: blank(got.text) ? undefined : String(got.text),
    media: typeof got.media === "string" ? got.media : undefined,
    followers: count(got.followers),
    paid: paid.length ? paid.some((name) => flag(row[name])) : undefined,
    metrics,
    raw: Object.keys(raw).length ? raw : undefined
  };
  return Object.fromEntries(Object.entries(post).filter(([, value]) => value !== undefined));
}

async function readRows(file) {
  const text = await readFile(file, "utf8");
  if (/\.csv$/i.test(file)) return parseCsv(text);
  if (/\.(jsonl|ndjson)$/i.test(file)) return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const value = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error(`${file} must hold a JSON array of posts`);
  return value;
}

/**
 * source: a .csv, .json (an array) or .jsonl file, or a list of raw items
 * (what fetchApify returns). → post rows. Fields that are not recognised are
 * kept under `raw`. platform: set it for every row; otherwise the row's own,
 * or read from its URL.
 */
export async function importPosts(source, { platform } = {}) {
  const rows = Array.isArray(source) ? source : await readRows(path.resolve(String(source)));
  // Apify returns {error, errorCode} items for posts it could not read.
  return rows.filter((row) => isObject(row) && !row.errorCode).map((row, index) => normalise(row, index, platform));
}

/**
 * Runs an Apify actor and waits for its items ("Run Actor synchronously and get
 * dataset items": the run must finish within 300 seconds). actor: "user/name"
 * or "user~name". input: the actor's own input object. → raw items, for
 * importPosts. What you fetch, and each platform's terms, are yours to answer for.
 */
export async function fetchApify({ actor, input = {}, token = process.env.APIFY_TOKEN, fetch = globalThis.fetch } = {}) {
  if (!token) throw new Error("APIFY_TOKEN is not set: fetching posts runs an Apify actor on your own Apify account");
  if (!actor) throw new Error('fetchApify needs an actor, such as "clockworks/tiktok-scraper"');
  const response = await fetch(`${APIFY_URL}/actors/${encodeURIComponent(String(actor).replace("/", "~"))}/run-sync-get-dataset-items`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Apify (${actor}) answered ${response.status}${response.status === 408 ? " (the run took longer than 300 seconds; ask for fewer posts)" : ""}: ${detail}`);
  }
  const items = await response.json();
  if (!Array.isArray(items)) throw new Error(`Apify (${actor}) returned no list of items`);
  return items;
}

export const OUTLIER_MIN_POSTS = 5;
export const OUTLIER_MIN_AGE_DAYS = 3;

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Adds `outlier` to every row: how far a post is above or below what is normal
 * for its own account, so a small channel's hit counts as a hit. 1 is normal,
 * 2 is twice normal.
 *
 * - An account with 5 or more posts in the set: views / the median views of
 *   that account's posts.
 * - A smaller account, when followers are known: (views / followers) / the
 *   median of views / followers over the whole set. Otherwise null.
 * - null for a post under 3 days old (its numbers have not settled), a paid
 *   post (the views were bought) and a post with no view count. These are also
 *   left out of every median. A post with no date is taken as settled.
 */
export function withOutliers(rows, { now = Date.now() } = {}) {
  const views = (row) => row.metrics?.views;
  const settled = (row) => row.paid !== true && Number.isFinite(views(row)) && !(row.posted_at && now - Date.parse(row.posted_at) < OUTLIER_MIN_AGE_DAYS * 86400000);
  const perFollower = (row) => (row.followers > 0 ? views(row) / row.followers : null);
  const channel = (row) => `${row.platform}:${row.account}`;
  const usable = rows.filter(settled);
  const byChannel = Map.groupBy(usable, channel);
  const setNorm = median(usable.map(perFollower));
  return rows.map((row) => {
    let outlier = null;
    if (settled(row)) {
      const own = byChannel.get(channel(row));
      const norm = own.length >= OUTLIER_MIN_POSTS ? median(own.map(views)) : null;
      if (norm > 0) outlier = round3(views(row) / norm);
      else if (norm === null && setNorm > 0 && perFollower(row) !== null) outlier = round3(perFollower(row) / setNorm);
    }
    return { ...row, outlier };
  });
}

// Reads text, images, audio and video, fetches a public https link itself, and
// holds about 262,000 tokens a request.
export const DEFAULT_LIBRARY_MODEL = "google/gemini-decision-1";
// Decision models that take a video part, and those that fetch an https link
// themselves (the rest need the bytes inline). From OpenRouter's Multimodal
// Decisions guide; other models are sent images only, inline.
const VIDEO_MODELS = new Set(["google/gemini-decision-1", "heygen/heygen-decision-1", "heygen/heygen-decision-1-turbo", "cloudflare/clef-omni"]);
const REMOTE_MEDIA_MODELS = new Set(["google/gemini-decision-1", "heygen/heygen-decision-1", "heygen/heygen-decision-1-turbo"]);
// The largest local file sent inline as a data URL. The stricter video models
// take 16 MiB a file and 5 MiB an image; base64 adds a third to the request.
export const MAX_INLINE_MEDIA_BYTES = Object.freeze({ video: 12 * 1024 * 1024, image: 4 * 1024 * 1024 });
const MEDIA_TYPES = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** → the state part for a post's media, or null when this model can't be sent it. */
async function mediaPart(media, model) {
  const remote = /^https:\/\//i.test(media);
  if (!remote && /^[a-z][a-z0-9+.-]*:\/\//i.test(media)) return null;
  const type = MEDIA_TYPES[path.extname(remote ? new URL(media).pathname : media).toLowerCase()];
  // A link with no extension (most platform links) is taken as the video.
  const kind = type ? type.split("/")[0] : remote ? "video" : null;
  if (!kind || (kind === "video" && !VIDEO_MODELS.has(model))) return null;
  let url = media;
  if (remote) {
    if (!REMOTE_MEDIA_MODELS.has(model)) return null;
  } else {
    // Only a file with a media extension is ever read, so a library row can't name some other local file to send.
    const file = path.resolve(media);
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > MAX_INLINE_MEDIA_BYTES[kind]) return null;
    url = `data:${type};base64,${(await readFile(file)).toString("base64")}`;
  }
  return kind === "video" ? { type: "video_url", video_url: { url } } : { type: "image_url", image_url: { url } };
}

/**
 * One request a post: the caption and text, and the media when the model takes
 * it. rubric: from parseRubric. → tagged rows: the row plus tags, answers and
 * outlier (worked out here when the rows have none). Every answer is recorded
 * as a tag, a yes/no as its probability. media_skipped: true marks a post with
 * media that was tagged from its words alone: the model does not take it, the
 * local file is missing or over MAX_INLINE_MEDIA_BYTES, or the link could not
 * be fetched. Pass media: false to tag from words only.
 */
export async function tagPosts(rows, rubric, { model, concurrency = 8, media = true, ...request } = {}) {
  const route = model ?? rubric.model ?? DEFAULT_LIBRARY_MODEL;
  const questions = questionsFor(rubric, "post");
  const send = async (state) => (state.length ? ask({ ...request, model: route, state, questions }) : null);
  return mapLimit(rows.every((row) => row.outlier !== undefined) ? rows : withOutliers(rows), concurrency, async (row) => {
    const words = [row.caption && `Caption:\n${row.caption}`, row.text && `Words on screen or spoken:\n${row.text}`].filter(Boolean);
    const part = media && row.media ? await mediaPart(row.media, route) : null;
    let skipped = Boolean(row.media) && !part;
    let reply;
    try { reply = await send(part ? [...words, part] : words); } catch (error) {
      // A link the model can't fetch (expired, blocked) is refused outright: tag from the words instead.
      if (!part || !/answered 4(00|13|22)/.test(error.message)) throw error;
      skipped = true;
      reply = await send(words);
    }
    const tags = {};
    const answers = {};
    for (const key of reply ? Object.keys(questions) : []) {
      const { status, value, p = null } = judge(rubric.questions[key], reply.answers[key], rubric.pass_at);
      answers[key] = { status, value, p };
      tags[key] = value;
    }
    return { ...row, tags, answers, ...(skipped ? { media_skipped: true } : {}) };
  });
}

export const HIT_OUTLIER = 2;
export const MAP_MIN_MEASURED = 100;
// formatNicheMap's reading of the figures: a value on 30% or more of posts is
// crowded, on 10% or fewer is open, and one seen 3 or more times with a median
// outlier of 1.25 or more beats its channel's norm.
const CROWDED_SHARE = 0.3;
const OPEN_SHARE = 0.1;
const BEATS = { median: 1.25, count: 3 };

// A number is grouped by its nearest whole: a yes/no probability as 1 (yes) or 0 (no), a score as its level.
const tagLabel = (value) => (typeof value === "number" ? String(Math.round(value)) : String(value));

function groupStats(group, total) {
  const measured = group.map((row) => row.outlier).filter(Number.isFinite);
  return {
    count: group.length,
    share: round3(group.length / total),
    median_outlier: measured.length ? round3(median(measured)) : null,
    // Of its posts with an outlier, the share at 2 or more.
    hit_share: measured.length ? round3(measured.filter((outlier) => outlier >= HIT_OUTLIER).length / measured.length) : null
  };
}

/**
 * → {rows, measured, caution?, tags: {key: {value: stats}}, pairs: {key: {"<hook_type> + <value>": stats}}}
 * where stats is {count, share, median_outlier, hit_share}. share is of the
 * whole library. `pairs` is there when the rows carry a hook_type tag.
 * `caution` says when the figures should not be trusted yet.
 */
export function nicheMap(taggedRows) {
  const total = taggedRows.length;
  const tags = {};
  const pairs = {};
  const into = (book, key, label, row) => (((book[key] ??= {})[label] ??= []).push(row));
  for (const row of taggedRows) {
    const hook = row.tags?.hook_type;
    for (const [key, value] of Object.entries(row.tags ?? {})) {
      if (value == null) continue;
      into(tags, key, tagLabel(value), row);
      if (hook != null && key !== "hook_type") into(pairs, key, `${tagLabel(hook)} + ${tagLabel(value)}`, row);
    }
  }
  const summarise = (book) => Object.fromEntries(Object.entries(book).map(([key, groups]) => [key, Object.fromEntries(Object.entries(groups).map(([label, group]) => [label, groupStats(group, total)]))]));
  const outliers = taggedRows.map((row) => row.outlier).filter(Number.isFinite);
  const cautions = [];
  if (outliers.length < MAP_MIN_MEASURED) cautions.push(`only ${outliers.length} post(s) have a settled result; read every figure as a hint until there are ${MAP_MIN_MEASURED}`);
  if (outliers.length && outliers.filter((outlier) => outlier < 1).length < outliers.length / 3) cautions.push("fewer than a third of the posts are below their channel's norm, so this looks like a hits-only library; add the same channels' ordinary and weak posts or the patterns mean nothing");
  return { rows: total, measured: outliers.length, ...(cautions.length ? { caution: cautions.join("; ") } : {}), tags: summarise(tags), ...(Object.keys(pairs).length ? { pairs: summarise(pairs) } : {}) };
}

/** The map as text a person reads: every value of every tag, then what is crowded, open and beating its channel's norm. */
export function formatNicheMap(map) {
  const lines = [`Niche map: ${map.rows} post(s), ${map.measured} with a settled result.`];
  if (map.caution) lines.push(`Caution: ${map.caution}.`);
  const percent = (share) => `${Math.round(share * 100)}%`;
  const beats = (stats) => stats.median_outlier >= BEATS.median && stats.count >= BEATS.count;
  const line = (label, stats) => `  ${label.padEnd(28)} ${percent(stats.share).padStart(4)} of posts (${stats.count})${stats.median_outlier === null ? "" : `, median ${stats.median_outlier}x its channel, ${percent(stats.hit_share)} at ${HIT_OUTLIER}x or more`}`;
  const found = { crowded: [], open: [], beating: [] };
  for (const [key, values] of Object.entries(map.tags)) {
    lines.push("", key);
    for (const [label, stats] of Object.entries(values).sort((a, b) => b[1].count - a[1].count)) {
      lines.push(line(label, stats));
      if (stats.share >= CROWDED_SHARE) found.crowded.push(`${key}=${label}`);
      if (stats.share <= OPEN_SHARE) found.open.push(`${key}=${label}`);
      if (beats(stats)) found.beating.push(`${key}=${label} (${stats.median_outlier}x)`);
    }
  }
  const best = Object.entries(map.pairs ?? {}).flatMap(([key, values]) => Object.entries(values).filter(([, stats]) => beats(stats)).map(([label, stats]) => [`hook_type + ${key}: ${label}`, stats])).sort((a, b) => b[1].median_outlier - a[1].median_outlier).slice(0, 10);
  if (best.length) lines.push("", "Pairs with hook_type that beat their channel's norm", ...best.map(([label, stats]) => line(label, stats)));
  lines.push("", `Crowded (${percent(CROWDED_SHARE)} of posts or more): ${found.crowded.join(", ") || "none"}`, `Open (${percent(OPEN_SHARE)} or fewer; a value no post used is not listed): ${found.open.join(", ") || "none"}`, `Beats its channel's norm (median ${BEATS.median}x or more over ${BEATS.count}+ posts): ${found.beating.join(", ") || "none"}`);
  return `${lines.join("\n")}\n`;
}

const USAGE = "library import <posts.csv|.json|.jsonl> [--platform <name>] [--out library.jsonl] | fetch <apify actor> [--input <input.json>] [--platform <name>] [--out library.jsonl] | tag <library.jsonl> --rubric <rubric.json> [--model <id>] [--concurrency <n>] [--out library.tagged.jsonl] | map <library.tagged.jsonl> [--out map.json]";

async function readJsonl(file) {
  if (!existsSync(file)) throw new Error(`${file} not found`);
  return (await readFile(file, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}
const writeJsonl = (file, rows) => writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);

/**
 * action: "import" | "fetch" | "tag" | "map". io: {stdout?, fetch?}.
 *   import <file>     → library.jsonl          fetch <actor> --input <json> → library.jsonl
 *   tag <library>     → library.tagged.jsonl   map <tagged> → prints the map; --out writes it as JSON
 * import and fetch add to a library that is already there: a post with the same
 * platform and id is replaced, the rest are kept. → {action, out, count}, or the map.
 */
export async function runLibrary(action, target, flags = {}, io = {}) {
  if (!["import", "fetch", "tag", "map"].includes(action) || !target) throw new Error(`usage: ${USAGE}`);
  const out = flags.out ? path.resolve(String(flags.out)) : null;
  if (action === "import" || action === "fetch") {
    const input = action === "fetch" && flags.input ? JSON.parse(await readFile(path.resolve(String(flags.input)), "utf8")) : {};
    const posts = await importPosts(action === "fetch" ? await fetchApify({ actor: target, input, ...(io.fetch ? { fetch: io.fetch } : {}) }) : String(target), { platform: flags.platform });
    const file = out ?? path.resolve("library.jsonl");
    // --own marks the brand's own posts: the fitted layer can weigh them above a competitor's (src/scoring/fit.js).
    if (flags.own) for (const post of posts) post.own = true;
    const merged = new Map([...(existsSync(file) ? await readJsonl(file) : []), ...posts].map((post) => [`${post.platform}:${post.id}`, post]));
    await writeJsonl(file, [...merged.values()]);
    return { action, out: file, count: merged.size, added: posts.length };
  }
  const source = path.resolve(String(target));
  if (action === "tag") {
    if (!flags.rubric) throw new Error(`library tag needs a rubric of tag questions: ${USAGE}`);
    const rubric = parseRubric(JSON.parse(await readFile(path.resolve(String(flags.rubric)), "utf8")));
    const concurrency = flags.concurrency != null ? Number(flags.concurrency) : undefined;
    if (concurrency !== undefined && !(concurrency >= 1)) throw new Error(`--concurrency must be 1 or more; got ${flags.concurrency}`);
    const tagged = await tagPosts(await readJsonl(source), rubric, { model: flags.model, ...(concurrency ? { concurrency } : {}), ...(io.fetch ? { fetch: io.fetch } : {}) });
    const file = out ?? source.replace(/(\.jsonl)?$/i, ".tagged.jsonl");
    await writeJsonl(file, tagged);
    return { action, out: file, count: tagged.length, media_skipped: tagged.filter((row) => row.media_skipped).length };
  }
  const map = nicheMap(await readJsonl(source));
  if (out) await writeFile(out, `${JSON.stringify(map, null, 2)}\n`);
  (io.stdout ?? process.stdout).write(formatNicheMap(map));
  return map;
}
