// Discovery (src/scoring/discover.js) against a stand-in for Apify that plays
// both the search actor and the posts actor: no network, no token, no real posts.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_ACTORS, discover, pickCreators, profileInput, runDiscover, searchInput } from "../src/scoring/discover.js";
import { importPosts } from "../src/scoring/library.js";

// Shaped like items from clockworks/tiktok-scraper, and from Apify's Instagram hashtag and post scrapers.
const tiktok = (id, name, playCount, fans = 1000) => ({ id: String(id), text: `post ${id} #bread`, createTimeISO: "2026-01-05T10:00:00.000Z", isAd: false, authorMeta: { name, fans }, webVideoUrl: `https://www.tiktok.com/@${name}/video/${id}`, diggCount: 10, shareCount: 1, playCount, collectCount: 2, commentCount: 3 });
const instagram = (id, ownerUsername, videoPlayCount) => ({ id: String(id), type: "Video", shortCode: `C${id}`, caption: `post ${id}`, url: `https://www.instagram.com/p/C${id}/`, commentsCount: 2, likesCount: 30, videoPlayCount, timestamp: "2026-01-05T10:00:00.000Z", ownerUsername });

const SEARCH = [tiktok(1, "ana", 900), tiktok(2, "ana", 50000), tiktok(3, "bo", 70000), tiktok(4, "cy", 800), tiktok(5, "cy", 600), tiktok(6, "cy", 700), tiktok(7, "dee", 100), { id: "8", text: "no author", playCount: 99999 }];
const ORDINARY = [100, 200, 300, 400, 3000];

/** Plays Apify: a search input gets `search`, a profiles input gets `views.length` posts an account. failFor: an account whose run fails. */
function fakeApify({ search = SEARCH, item = tiktok, views = ORDINARY, failFor } = {}) {
  const calls = [];
  let running = 0;
  const fetch = async (url, init) => {
    const input = JSON.parse(init.body);
    const call = { actor: url.match(/actors\/([^/]+)\//)[1].replace("~", "/"), input, overlapped: running > 0 };
    calls.push(call);
    running += 1;
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    const accounts = input.profiles ?? input.username;
    if (!accounts) return new Response(JSON.stringify(search), { status: 201 });
    if (accounts.includes(failFor)) return new Response("run timed out", { status: 408 });
    return new Response(JSON.stringify(accounts.flatMap((name) => views.map((count, index) => item(`${name}${index}`, name, count)))), { status: 201 });
  };
  return { fetch, calls };
}

test("searchInput and profileInput build each default actor's input", () => {
  assert.deepEqual(DEFAULT_ACTORS, { tiktok: { search: "clockworks/tiktok-scraper", posts: "clockworks/tiktok-scraper" }, instagram: { search: "apify/instagram-hashtag-scraper", posts: "apify/instagram-post-scraper" } });
  assert.deepEqual(searchInput("tiktok", ["sourdough", "home baking"], { limit: 100 }), { searchQueries: ["sourdough", "home baking"], resultsPerPage: 50 });
  assert.deepEqual(searchInput("instagram", ["sourdough", "home baking", "rye"], { limit: 100 }), { hashtags: ["sourdough", "home baking", "rye"], keywordSearch: true, resultsType: "posts", resultsLimit: 34 });
  assert.deepEqual(profileInput("tiktok", ["ana", "bo"], { perCreator: 30, days: 90 }), { profiles: ["ana", "bo"], resultsPerPage: 30, profileSorting: "latest", excludePinnedPosts: true, oldestPostDateUnified: "90" });
  assert.deepEqual(profileInput("instagram", ["ana"], { perCreator: 12, days: 30 }), { username: ["ana"], resultsLimit: 12, skipPinnedPosts: true, onlyPostsNewerThan: "30 days" });
  assert.deepEqual(profileInput("instagram", ["ana"], { perCreator: 12, days: 0 }), { username: ["ana"], resultsLimit: 12, skipPinnedPosts: true });
  assert.throws(() => searchInput("youtube", ["x"]), /supports tiktok and instagram.*library import/);
  assert.throws(() => profileInput("youtube", ["x"]), /supports tiktok and instagram/);
});

test("pickCreators ranks accounts by results, then best views, and passes on plain handles only", async () => {
  const rows = await importPosts([...SEARCH, tiktok(9, "https://evil.example/x", 5e6), tiktok(10, "a b", 5e6)]);
  assert.deepEqual(pickCreators(rows), [
    { account: "cy", platform: "tiktok", hits: 3, best_views: 800, followers: 1000 },
    { account: "ana", platform: "tiktok", hits: 2, best_views: 50000, followers: 1000 },
    { account: "bo", platform: "tiktok", hits: 1, best_views: 70000, followers: 1000 },
    { account: "dee", platform: "tiktok", hits: 1, best_views: 100, followers: 1000 }
  ]);
  assert.deepEqual(pickCreators(rows, { creators: 2, minPosts: 2 }).map((creator) => creator.account), ["cy", "ana"]);
  assert.deepEqual(pickCreators(await importPosts([instagram(1, "ana", 500), { ...instagram(2, "ana", 0), videoPlayCount: undefined }])), [{ account: "ana", platform: "instagram", hits: 2, best_views: 500 }]);
});

test("discover searches once, then collects the creators' posts a batch at a time", async () => {
  const { fetch, calls } = fakeApify();
  const steps = [];
  const found = await discover({ keywords: ["sourdough"], token: "t", fetch, perCreator: 5, onStep: (text) => steps.push(text) });
  assert.deepEqual(calls.map((call) => call.input), [
    { searchQueries: ["sourdough"], resultsPerPage: 100 },
    { profiles: ["cy", "ana", "bo"], resultsPerPage: 5, profileSorting: "latest", excludePinnedPosts: true, oldestPostDateUnified: "90" },
    { profiles: ["dee"], resultsPerPage: 5, profileSorting: "latest", excludePinnedPosts: true, oldestPostDateUnified: "90" }
  ]);
  assert.ok(calls.every((call) => call.actor === "clockworks/tiktok-scraper" && !call.overlapped));
  assert.deepEqual({ ...found, search_rows: found.search_rows.length, rows: found.rows.length, creators: found.creators.map((creator) => creator.account) }, { keywords: ["sourdough"], platform: "tiktok", creators: ["cy", "ana", "bo", "dee"], search_rows: 8, rows: 20, warnings: [] });
  assert.deepEqual(found.rows[0], { id: "cy0", platform: "tiktok", account: "cy", url: "https://www.tiktok.com/@cy/video/cy0", posted_at: "2026-01-05T10:00:00.000Z", caption: "post cy0 #bread", followers: 1000, paid: false, metrics: { views: 100, likes: 10, comments: 3, shares: 1, saves: 2 }, raw: { authorMeta: { name: "cy", fans: 1000 } } });
  assert.deepEqual(steps, ["Searching tiktok for sourdough", "8 result(s), 4 creator(s)", "Posts 1/2: cy, ana, bo", "Posts 2/2: dee"]);

  const other = fakeApify();
  await discover({ keywords: ["rye"], creators: 2, batch: 1, searchActor: "me/search", postsActor: "me/posts", token: "t", fetch: other.fetch });
  assert.deepEqual(other.calls.map((call) => [call.actor, call.input.profiles]), [["me/search", undefined], ["me/posts", ["cy"]], ["me/posts", ["ana"]]]);
});

test("discover: a failed batch is a warning, and only every batch failing throws", async () => {
  const found = await discover({ keywords: ["sourdough"], token: "t", fetch: fakeApify({ failFor: "ana" }).fetch });
  assert.deepEqual(found.rows.map((row) => row.account).filter((account, index, all) => all.indexOf(account) === index), ["dee"]);
  assert.equal(found.warnings.length, 1);
  assert.match(found.warnings[0], /^no posts for cy, ana, bo: Apify \(clockworks\/tiktok-scraper\) answered 408/);
  await assert.rejects(discover({ keywords: ["sourdough"], creators: 3, token: "t", fetch: fakeApify({ failFor: "ana" }).fetch }), /every posts run failed: no posts for cy, ana, bo/);
  await assert.rejects(discover({ keywords: ["sourdough"], token: "t", fetch: fakeApify({ search: [{ id: "8", text: "no author" }] }).fetch }), /found no accounts \(1 result\(s\)\)/);
  await assert.rejects(discover({ keywords: [], token: "t" }), /at least one keyword/);
  await assert.rejects(discover({ keywords: ["x"], platform: "youtube", token: "t" }), /supports tiktok and instagram/);
  await assert.rejects(discover({ keywords: ["x"], token: "", fetch: fakeApify().fetch }), /APIFY_TOKEN is not set/);
});

test("runDiscover adds to the library that is there, writes creators.json and warns on a hits-only library", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-discover-"));
  const out = path.join(dir, "library.jsonl");
  const kept = { id: "old", platform: "tiktok", account: "zed", metrics: { views: 5 } };
  const replaced = { id: "cy0", platform: "tiktok", account: "cy", caption: "stale", metrics: { views: 1 } };
  await writeFile(out, `${JSON.stringify(kept)}\n${JSON.stringify(replaced)}\n`);
  const lines = [];
  const io = (apify) => ({ fetch: apify.fetch, token: "t", stderr: { write: (text) => lines.push(text) } });
  const apify = fakeApify();
  const summary = await runDiscover(" sourdough, home baking ,", { out, creators: "2", "per-creator": "5", days: "0", "search-limit": "40" }, io(apify));
  // Each account's posts run 100 to 3000 views, so two in five sit below its norm.
  assert.deepEqual(summary, { out, creators_file: path.join(dir, "creators.json"), creators: 2, added: 10, count: 11, below_norm_share: 0.4, warnings: [] });
  assert.deepEqual(apify.calls.map((call) => call.input), [{ searchQueries: ["sourdough", "home baking"], resultsPerPage: 20 }, { profiles: ["cy", "ana"], resultsPerPage: 5, profileSorting: "latest", excludePinnedPosts: true }]);
  const library = (await readFile(out, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(library[0], kept);
  assert.equal(library[1].caption, "post cy0 #bread");
  assert.deepEqual(JSON.parse(await readFile(summary.creators_file, "utf8")), { keywords: ["sourdough", "home baking"], platform: "tiktok", creators: [{ account: "cy", platform: "tiktok", hits: 3, best_views: 800, followers: 1000 }, { account: "ana", platform: "tiktok", hits: 2, best_views: 50000, followers: 1000 }] });
  assert.equal(lines[0], "Searching tiktok for sourdough, home baking\n");

  // Instagram, into a new library where every post is at or above its account's norm.
  const hits = fakeApify({ search: [instagram(1, "ana", 9000), instagram(2, "ana", 100)], item: instagram, views: [100, 100, 100, 100, 100, 900] });
  const second = await runDiscover("sourdough", { platform: "Instagram", out: path.join(dir, "ig", "..", "ig.jsonl") }, io(hits));
  assert.deepEqual(hits.calls.map((call) => [call.actor, call.input]), [["apify/instagram-hashtag-scraper", { hashtags: ["sourdough"], keywordSearch: true, resultsType: "posts", resultsLimit: 100 }], ["apify/instagram-post-scraper", { username: ["ana"], resultsLimit: 30, skipPinnedPosts: true, onlyPostsNewerThan: "90 days" }]]);
  assert.deepEqual({ ...second, warnings: null }, { out: path.join(dir, "ig.jsonl"), creators_file: path.join(dir, "creators.json"), creators: 1, added: 6, count: 6, below_norm_share: 0, warnings: null });
  assert.match(second.warnings[0], /^only 0% of the posts are below their channel's norm, so this looks like a hits-only library/);

  await assert.rejects(runDiscover(" , ", {}, io(fakeApify())), /usage: library discover/);
  await assert.rejects(runDiscover("x", { creators: "0" }, io(fakeApify())), /--creators must be a whole number, 1 or more; got 0/);
});
