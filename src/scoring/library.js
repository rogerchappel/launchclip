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
import { readFile } from "node:fs/promises";
import path from "node:path";

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
