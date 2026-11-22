// Keywords in, a library of real posts out (guide: docs/guide/scoring-discover.md).
// Search tools return hits only, and a library of hits cannot show what made
// them hits, so this works in two passes: a keyword search finds the creators,
// then every recent post of theirs is collected, ordinary ones included.
//
//   searchInput(platform, keywords, {limit})                → the search actor's input
//   profileInput(platform, accounts, {perCreator, days})    → the posts actor's input
//   pickCreators(rows, {creators?, minPosts?})              → [{account, platform, hits, best_views, followers?}]
//   discover({keywords, platform?, ...})                    → {keywords, platform, creators, search_rows, rows, warnings}
//   runDiscover(target, flags, io)                          → library.jsonl and creators.json
//
// Everything scraped is other people's text: it is stored as data, and the only
// part passed on is an account name that looks like a handle.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchApify, importPosts, mergeLibrary, withOutliers } from "./library.js";

// The Apify actors run by default, per platform: one for the keyword search,
// one for a creator's posts. Input fields below were read from each actor's
// input schema page on apify.com (November 2026); nothing was run against them.
export const DEFAULT_ACTORS = Object.freeze({
  tiktok: Object.freeze({ search: "clockworks/tiktok-scraper", posts: "clockworks/tiktok-scraper" }),
  instagram: Object.freeze({ search: "apify/instagram-hashtag-scraper", posts: "apify/instagram-post-scraper" })
});
export const HITS_ONLY_SHARE = 1 / 3;

function supported(platform) {
  if (!DEFAULT_ACTORS[platform]) throw new Error(`discover supports ${Object.keys(DEFAULT_ACTORS).join(" and ")}; got "${platform}". For another platform, export its posts and run: launchclip score library import`);
}

/**
 * limit: search results wanted in all, shared evenly between the keywords.
 * Confirmed from the schema pages: tiktok `searchQueries` (array) and
 * `resultsPerPage` (posts per query; `searchSection` is left at its default,
 * Top); instagram-hashtag-scraper `hashtags` (array), `keywordSearch` (true:
 * a keyword may hold spaces), `resultsType` ("posts", the one value its
 * example shows) and `resultsLimit` (per keyword).
 */
export function searchInput(platform, keywords, { limit = 100 } = {}) {
  supported(platform);
  const each = Math.max(1, Math.ceil(limit / keywords.length));
  return platform === "tiktok"
    ? { searchQueries: keywords, resultsPerPage: each }
    : { hashtags: keywords, keywordSearch: true, resultsType: "posts", resultsLimit: each };
}

/**
 * perCreator: posts per account, newest first. days: how far back; 0 for no limit.
 * Confirmed from the schema pages: tiktok `profiles` (array of usernames),
 * `resultsPerPage` (posts per profile), `profileSorting` ("latest", as its
 * example has it), `excludePinnedPosts` and `oldestPostDateUnified` (a string;
 * a number of days is documented, and the page calls it a charged filter);
 * instagram-post-scraper `username` (array), `resultsLimit` (per profile),
 * `skipPinnedPosts` and `onlyPostsNewerThan` ("90 days" style is documented).
 * Pinned posts are left out: a creator pins their hits.
 */
export function profileInput(platform, accounts, { perCreator = 30, days = 90 } = {}) {
  supported(platform);
  return platform === "tiktok"
    ? { profiles: accounts, resultsPerPage: perCreator, profileSorting: "latest", excludePinnedPosts: true, ...(days ? { oldestPostDateUnified: String(days) } : {}) }
    : { username: accounts, resultsLimit: perCreator, skipPinnedPosts: true, ...(days ? { onlyPostsNewerThan: `${days} days` } : {}) };
}

/**
 * rows: post rows from a keyword search. → the accounts behind them, most
 * results first, then best views. minPosts: the fewest results an account needs.
 */
// The search is for creators, not posts: its results are all hits, and only a creator's whole feed shows what their ordinary post looks like.
export function pickCreators(rows, { creators = 15, minPosts = 1 } = {}) {
  // A scraped account name goes into the next actor's input, which also takes URLs: only a plain handle is passed on.
  const named = rows.filter((row) => row.account !== "unknown" && /^[\w.]+$/.test(row.account ?? ""));
  return [...Map.groupBy(named, (row) => `${row.platform}:${row.account}`).values()]
    .map((group) => {
      const followers = Math.max(...group.map((row) => row.followers ?? -1));
      return { account: group[0].account, platform: group[0].platform, hits: group.length, best_views: Math.max(0, ...group.map((row) => row.metrics?.views ?? 0)), ...(followers >= 0 ? { followers } : {}) };
    })
    .filter((creator) => creator.hits >= minPosts)
    .sort((a, b) => b.hits - a.hits || b.best_views - a.best_views)
    .slice(0, creators);
}

/**
 * Runs the search actor once, picks the creators, then runs the posts actor
 * for `batch` accounts at a time, one run after another (each run has to
 * finish inside Apify's 300 seconds). A batch that fails becomes a warning;
 * it throws only when every batch fails. onStep(text): a progress line a step.
 * → {keywords, platform, creators, search_rows, rows, warnings}: search_rows
 * are the search's own post rows (hits), rows the creators' posts.
 */
export async function discover({ keywords, platform = "tiktok", creators = 15, perCreator = 30, days = 90, searchLimit = 100, searchActor, postsActor, batch = 3, token, fetch, onStep = () => {} } = {}) {
  supported(platform);
  if (!Array.isArray(keywords) || !keywords.length) throw new Error("discover needs at least one keyword");
  const run = async (actor, input) => importPosts(await fetchApify({ actor, input, ...(token ? { token } : {}), ...(fetch ? { fetch } : {}) }), { platform });
  onStep(`Searching ${platform} for ${keywords.join(", ")}`);
  const searchRows = await run(searchActor ?? DEFAULT_ACTORS[platform].search, searchInput(platform, keywords, { limit: searchLimit }));
  const picked = pickCreators(searchRows, { creators });
  if (!picked.length) throw new Error(`the search for ${keywords.join(", ")} found no accounts (${searchRows.length} result(s)); try other keywords`);
  onStep(`${searchRows.length} result(s), ${picked.length} creator(s)`);
  const rows = [];
  const warnings = [];
  const batches = Math.ceil(picked.length / batch);
  for (let index = 0; index < batches; index += 1) {
    const accounts = picked.slice(index * batch, (index + 1) * batch).map((creator) => creator.account);
    onStep(`Posts ${index + 1}/${batches}: ${accounts.join(", ")}`);
    try {
      rows.push(...await run(postsActor ?? DEFAULT_ACTORS[platform].posts, profileInput(platform, accounts, { perCreator, days })));
    } catch (error) {
      warnings.push(`no posts for ${accounts.join(", ")}: ${error.message}`);
    }
  }
  if (warnings.length === batches) throw new Error(`every posts run failed: ${warnings[0]}`);
  return { keywords, platform, creators: picked, search_rows: searchRows, rows, warnings };
}

function whole(flags, name, least) {
  if (flags[name] == null) return undefined;
  const value = Number(flags[name]);
  if (!Number.isInteger(value) || value < least) throw new Error(`--${name} must be a whole number, ${least} or more; got ${flags[name]}`);
  return value;
}

/**
 * target: the keywords as one string, comma separated. flags: platform,
 * creators, per-creator, days, search-limit, search-actor, posts-actor, out
 * (library.jsonl; added to as `library import` does). io: {fetch?, token?, stderr?}.
 * Writes creators.json beside the library.
 * → {out, creators_file, creators, added, count, below_norm_share, warnings}
 */
export async function runDiscover(target, flags = {}, io = {}) {
  const keywords = String(target ?? "").split(",").map((word) => word.trim()).filter(Boolean);
  if (!keywords.length) throw new Error('usage: library discover "<keyword>, <keyword>" [--platform tiktok|instagram] [--creators <n>] [--per-creator <n>] [--days <n>] [--search-limit <n>] [--search-actor <actor>] [--posts-actor <actor>] [--out library.jsonl]');
  const stderr = io.stderr ?? process.stderr;
  const options = { keywords, platform: flags.platform && String(flags.platform).toLowerCase(), creators: whole(flags, "creators", 1), perCreator: whole(flags, "per-creator", 1), days: whole(flags, "days", 0), searchLimit: whole(flags, "search-limit", 1), searchActor: flags["search-actor"], postsActor: flags["posts-actor"], fetch: io.fetch, token: io.token, onStep: (text) => stderr.write(`${text}\n`) };
  // Left-out flags fall to discover's own defaults.
  const found = await discover(Object.fromEntries(Object.entries(options).filter(([, value]) => value != null)));
  const out = path.resolve(String(flags.out ?? "library.jsonl"));
  const library = await mergeLibrary(out, found.rows);
  const creatorsFile = path.join(path.dirname(out), "creators.json");
  await writeFile(creatorsFile, `${JSON.stringify({ keywords, platform: found.platform, creators: found.creators }, null, 2)}\n`);
  const outliers = withOutliers(library).map((row) => row.outlier).filter(Number.isFinite);
  const share = outliers.length ? Math.round((outliers.filter((outlier) => outlier < 1).length / outliers.length) * 1000) / 1000 : null;
  const warnings = [...found.warnings];
  if (share !== null && share < HITS_ONLY_SHARE) warnings.push(`only ${Math.round(share * 100)}% of the posts are below their channel's norm, so this looks like a hits-only library; raise --per-creator or --days so each creator's ordinary posts come too`);
  return { out, creators_file: creatorsFile, creators: found.creators.length, added: found.rows.length, count: library.length, below_norm_share: share, warnings };
}
