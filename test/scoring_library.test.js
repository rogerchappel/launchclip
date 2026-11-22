// The post library (src/scoring/library.js) against stand-ins for Apify and
// the hosted decision model: no network, no key, no real posts.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchApify, importPosts, parseCsv, withOutliers } from "../src/scoring/library.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "launchclip-library-"));

// Shaped like one item from Apify's TikTok scraper and one from its Instagram scraper.
const TIKTOK = { id: "7301", text: "3 fixes for slow builds #dev", createTime: 1760000000, createTimeISO: "2025-10-09T08:53:20.000Z", isAd: false, authorMeta: { name: "buildfast", fans: 12000 }, webVideoUrl: "https://www.tiktok.com/@buildfast/video/7301", mediaUrls: ["https://cdn.example.com/7301.mp4"], videoMeta: { duration: 21 }, diggCount: 900, shareCount: 40, playCount: 55000, collectCount: 120, commentCount: 31, isSponsored: true, hashtags: [{ name: "dev" }] };
const INSTAGRAM = { id: "33", type: "Video", shortCode: "Cabc", caption: "Close the books in a day", url: "https://www.instagram.com/p/Cabc/", commentsCount: 12, likesCount: -1, videoPlayCount: 8000, videoViewCount: 5000, timestamp: "2025-09-01T10:00:00.000Z", videoUrl: "https://cdn.example.com/Cabc.mp4", displayUrl: "https://cdn.example.com/Cabc.jpg", ownerUsername: "ledgerly" };

test("importPosts normalises Apify's TikTok and Instagram items and keeps the rest under raw", async () => {
  const [tiktok, instagram, plain] = await importPosts([TIKTOK, INSTAGRAM, { caption: "Mine", text: "Words on screen", account: "@me", views: "1,2" }, { url: "https://x", error: "gone", errorCode: "404" }]);
  assert.deepEqual({ ...tiktok, raw: null }, { id: "7301", platform: "tiktok", account: "buildfast", url: TIKTOK.webVideoUrl, posted_at: "2025-10-09T08:53:20.000Z", caption: TIKTOK.text, media: "https://cdn.example.com/7301.mp4", followers: 12000, paid: true, metrics: { views: 55000, likes: 900, comments: 31, shares: 40, saves: 120 }, raw: null });
  assert.deepEqual(Object.keys(tiktok.raw).sort(), ["authorMeta", "createTime", "hashtags", "isSponsored", "mediaUrls", "videoMeta"]);
  assert.deepEqual({ ...instagram, raw: null }, { id: "33", platform: "instagram", account: "ledgerly", url: INSTAGRAM.url, posted_at: INSTAGRAM.timestamp, caption: INSTAGRAM.caption, media: INSTAGRAM.videoUrl, metrics: { views: 8000, comments: 12 }, raw: null });
  assert.deepEqual(plain, { id: "post-3", platform: "unknown", account: "me", caption: "Mine", text: "Words on screen", metrics: {} });
  assert.equal((await importPosts([{ id: 1, createTime: 1760000000 }], { platform: "TikTok" }))[0].posted_at, "2025-10-09T08:53:20.000Z");
});

test("importPosts reads CSV, JSON and JSONL files", async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, "posts.csv"), '﻿id,ownerUsername,caption,videoPlayCount,authorMeta/fans,isAd\r\na1,ledgerly,"Said ""no"", then\nyes",1200,300,false\r\na2,ledgerly,Plain,,,true\r\n');
  const csv = await importPosts(path.join(dir, "posts.csv"), { platform: "instagram" });
  assert.deepEqual(csv, [{ id: "a1", platform: "instagram", account: "ledgerly", caption: 'Said "no", then\nyes', followers: 300, paid: false, metrics: { views: 1200 } }, { id: "a2", platform: "instagram", account: "ledgerly", caption: "Plain", paid: true, metrics: {} }]);
  assert.deepEqual(parseCsv("a,b\n1,\n"), [{ a: "1", b: "" }]);
  await writeFile(path.join(dir, "posts.json"), JSON.stringify([TIKTOK]));
  await writeFile(path.join(dir, "posts.jsonl"), `${JSON.stringify(TIKTOK)}\n\n${JSON.stringify(INSTAGRAM)}\n`);
  assert.equal((await importPosts(path.join(dir, "posts.json")))[0].id, "7301");
  assert.deepEqual((await importPosts(path.join(dir, "posts.jsonl"))).map((post) => post.platform), ["tiktok", "instagram"]);
  await writeFile(path.join(dir, "one.json"), "{}");
  await assert.rejects(importPosts(path.join(dir, "one.json")), /must hold a JSON array/);
});

test("fetchApify runs the actor with a bearer token and fails clearly without one", async () => {
  const calls = [];
  const items = await fetchApify({ actor: "clockworks/tiktok-scraper", input: { hashtags: ["dev"], resultsPerPage: 5 }, token: "t", fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify([TIKTOK]), { status: 201 }); } });
  assert.equal(calls[0].url, "https://api.apify.com/v2/actors/clockworks~tiktok-scraper/run-sync-get-dataset-items");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(calls[0].init.body), { hashtags: ["dev"], resultsPerPage: 5 });
  assert.equal(items[0].id, "7301");
  await assert.rejects(fetchApify({ actor: "a/b", token: "" }), /APIFY_TOKEN is not set/);
  await assert.rejects(fetchApify({ actor: "a/b", token: "t", fetch: async () => new Response("slow", { status: 408 }) }), /answered 408 \(the run took longer than 300 seconds/);
  await assert.rejects(fetchApify({ actor: "a/b", token: "t", fetch: async () => new Response("{}", { status: 200 }) }), /no list of items/);
});

const NOW = Date.parse("2026-01-10T00:00:00Z");
const post = (account, views, extra = {}) => ({ id: `${account}-${views}`, platform: "tiktok", account, metrics: { views }, ...extra });

test("withOutliers measures a post against its own account, or per follower for a small one", () => {
  const big = [100, 200, 300, 400, 3000].map((views) => post("big", views, { followers: 1000 }));
  const rows = [
    ...big,
    post("big", 9000, { paid: true }),
    post("big", 9000, { posted_at: "2026-01-09T00:00:00Z" }),
    post("big", 600, { posted_at: "2026-01-01T00:00:00Z" }),
    post("small", 500, { followers: 1000 }),
    post("nofollowers", 500),
    { id: "noviews", platform: "tiktok", account: "big", metrics: {} }
  ];
  const outliers = withOutliers(rows, { now: NOW }).map((row) => row.outlier);
  // big's settled views: 100 200 300 400 600 3000, median 350. Views per follower over the set: 0.1 0.2 0.3 0.4 0.5 3, median 0.35.
  assert.deepEqual(outliers, [0.286, 0.571, 0.857, 1.143, 8.571, null, null, 1.714, 1.429, null, null]);
  assert.deepEqual(withOutliers([post("a", 0), post("a", 0), post("a", 0), post("a", 0), post("a", 0)]).map((row) => row.outlier), [null, null, null, null, null]);
});
