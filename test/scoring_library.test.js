// The post library (src/scoring/library.js) against stand-ins for Apify and
// the hosted decision model: no network, no key, no real posts.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRubric } from "../src/scorer.js";
import { DEFAULT_LIBRARY_MODEL, MAX_INLINE_MEDIA_BYTES, fetchApify, importPosts, parseCsv, tagPosts, withOutliers } from "../src/scoring/library.js";

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

const TAGS = parseRubric({ questions: {
  hook_type: { type: "choice", instructions: "Which opening?", criteria: { number: "", question: "", other: "" } },
  pacing: { type: "score", instructions: "How fast?", criteria: ["Slow", "Medium", "Fast"] },
  face: { type: "noul", instructions: "Is a face on camera?" }
} });

// Answers from the words in the state, the way the model's reply is shaped. Refuses a link under /gone/.
function fakeModel(calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const part = body.state.find((entry) => typeof entry === "object");
    if ((part?.video_url ?? part?.image_url)?.url.includes("/gone/")) return new Response("Cannot fetch content from the provided URL", { status: 400 });
    const words = body.state.filter((entry) => typeof entry === "string").join(" ");
    const hook = /\d/.test(words) ? "number" : /\?/.test(words) ? "question" : "other";
    return new Response(JSON.stringify({ model: body.model, usage: { cost: 0.00001 }, answers: {
      hook_type: { type: "choice", choice: hook, probabilities: { [hook]: 0.9 } },
      pacing: { type: "score", score: 1.8, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 } },
      face: part ? { type: "noul", noul: 0.92 } : { type: "refusal" }
    } }), { status: 200 });
  };
}

test("tagPosts sends words and media as state parts and records every answer as a tag", async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, "cover.png"), Buffer.from([1, 2, 3]));
  await writeFile(path.join(dir, "notes.txt"), "private");
  await writeFile(path.join(dir, "big.png"), Buffer.alloc(MAX_INLINE_MEDIA_BYTES.image + 1));
  const rows = [
    post("a", 100, { caption: "3 fixes", text: "Fix one", media: "https://cdn.example.com/v/abc" }),
    post("a", 200, { caption: "Why?", media: path.join(dir, "cover.png") }),
    post("a", 300, { caption: "Gone", media: "https://cdn.example.com/gone/x.mp4" }),
    post("a", 400, { caption: "Text file", media: path.join(dir, "notes.txt") }),
    post("a", 500, { caption: "Too big", media: path.join(dir, "big.png") }),
    post("a", 600, { media: path.join(dir, "missing.mp4") })
  ];
  const calls = [];
  const tagged = await tagPosts(rows, TAGS, { apiKey: "k", fetch: fakeModel(calls), concurrency: 1 });
  assert.equal(calls[0].model, DEFAULT_LIBRARY_MODEL);
  assert.deepEqual(calls[0].state, ["Caption:\n3 fixes", "Words on screen or spoken:\nFix one", { type: "video_url", video_url: { url: "https://cdn.example.com/v/abc" } }]);
  assert.deepEqual(Object.keys(calls[0].questions.face), ["type", "instructions"]);
  assert.deepEqual(calls[1].state, ["Caption:\nWhy?", { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }]);
  assert.deepEqual(calls.slice(2).map((call) => call.state.length), [2, 1, 1, 1]);
  assert.equal(calls.length, 6, "a post with nothing to read is not sent");
  assert.deepEqual(tagged[0].tags, { hook_type: "number", pacing: 1.8, face: 0.92 });
  assert.deepEqual(tagged[0].answers, { hook_type: { status: "tag", value: "number", p: null }, pacing: { status: "tag", value: 1.8, p: null }, face: { status: "pass", value: 0.92, p: 0.92 } });
  assert.equal(tagged[0].outlier, 0.286);
  assert.deepEqual(tagged.map((row) => row.media_skipped ?? false), [false, false, true, true, true, true]);
  assert.deepEqual(tagged[2].tags, { hook_type: "other", pacing: 1.8, face: null });
  assert.deepEqual([tagged[5].tags, tagged[5].answers], [{}, {}]);

  // A model that takes no video and fetches no links is sent the words only.
  const plain = [];
  const [video, image] = await tagPosts(rows.slice(0, 2), TAGS, { model: "typesafe/jev-1.13", apiKey: "k", fetch: fakeModel(plain), concurrency: 1 });
  assert.deepEqual([plain[0].state.length, video.media_skipped, plain[1].state.length, image.media_skipped], [2, true, 2, undefined]);
  const [off] = await tagPosts(rows.slice(1, 2), TAGS, { media: false, apiKey: "k", fetch: fakeModel() });
  assert.equal(off.media_skipped, true);
  await assert.rejects(tagPosts(rows.slice(0, 1), TAGS, { apiKey: "k", fetch: async () => new Response("no credit", { status: 402 }) }), /answered 402/);
});
