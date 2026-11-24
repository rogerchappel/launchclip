// Library evidence (src/scoring/evidence.js) against a stand-in fetch: no network, no thumbs.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { evidenceOf, gatherEvidence, parseVtt, runEvidence, slideLinks } from "../src/scoring/evidence.js";

const VTT = "WEBVTT\n\n1\n00:00:01.200 --> 00:00:03.000\nNever back a horse\n\nNOTE a comment\n\n00:00:03.000 --> 00:00:05.200 align:start\n<c>on a wet track.</c> Here is\nwhy\n\n01:00:05.200 --> 01:00:06.000\n\n";
const NOW = new Date("2026-11-23T00:00:00.000Z");
const post = { id: "7301", platform: "tiktok", account: "trackside", url: "https://www.tiktok.com/@trackside/video/7301", posted_at: "2026-10-09T08:53:20.000Z", caption: "Wet tracks #Racing #tips", media: "https://cdn.example.com/7301.jpg", followers: 12000, paid: false, metrics: { views: 55000 }, keyword: "racing" };
const tiktok = (id, links = [{ language: "eng-US", downloadLink: `https://subs.example.com/${id}` }]) => ({
  ...post,
  id,
  tags: { hook_type: "warning" },
  outlier: 2.1,
  raw: { videoMeta: { duration: 17, coverUrl: `https://cdn.example.com/${id}.jpg`, subtitleLinks: links }, hashtags: [{ name: "Racing" }, { name: "tips" }, { name: "racing" }], isSlideshow: false, musicMeta: { musicOriginal: true }, isSponsored: false }
});

test("parseVtt reads cues in seconds and skips ids, notes, tags and empty cues", () => {
  assert.deepEqual(parseVtt(VTT), [{ start: 1.2, end: 3, text: "Never back a horse" }, { start: 3, end: 5.2, text: "on a wet track. Here is why" }]);
  assert.deepEqual(parseVtt("WEBVTT\r\n\r\n00:01.000 --> 00:02,500\r\nHi\r\n"), [{ start: 1, end: 2.5, text: "Hi" }]);
  assert.deepEqual(parseVtt("<html>gone</html>"), []);
  assert.deepEqual(parseVtt(undefined), []);
});

test("evidenceOf slims a TikTok row: no raw, the row's own fields kept, speech facts from the subtitle", () => {
  const row = evidenceOf(tiktok("7301"), { vtt: VTT, thumb: "thumbs/7301.jpg", now: NOW });
  assert.deepEqual(row, {
    ...post,
    tags: { hook_type: "warning" },
    outlier: 2.1,
    hashtags: ["racing", "tips"],
    transcript: "Never back a horse on a wet track. Here is why",
    spoken_hook: "Never back a horse on a wet track.",
    thumb: "thumbs/7301.jpg",
    facts: { duration_s: 17, slideshow: false, original_sound: true, has_speech: true, first_word_s: 1.2, words_per_s: 2.75 },
    evidence_at: NOW.toISOString()
  });
  // No sentence end: the first cue. A long one is cut.
  assert.equal(evidenceOf(tiktok("1"), { vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nso anyway\n\n00:01.000 --> 00:02.000\nwe went" }).spoken_hook, "so anyway");
  assert.equal(evidenceOf(tiktok("1"), { vtt: `WEBVTT\n\n00:00.000 --> 00:09.000\n${"word ".repeat(80)}` }).spoken_hook.length, 200);
});

test("evidenceOf works without a TikTok raw row, and leaves a finished row alone", () => {
  const instagram = { id: "33", platform: "instagram", account: "ledgerly", caption: "Close the books #Finance #finance #month_end", media: "https://cdn.example.com/Cabc.mp4", metrics: { views: 8000 }, raw: { type: "Video", displayUrl: "https://cdn.example.com/Cabc.jpg" } };
  const { raw, ...kept } = instagram;
  const slim = evidenceOf(instagram, { now: NOW });
  assert.deepEqual(slim, { ...kept, hashtags: ["finance", "month_end"], facts: { has_speech: false }, evidence_at: NOW.toISOString() });
  assert.deepEqual(evidenceOf({ id: "p", platform: "unknown", metrics: {} }, { now: NOW }), { id: "p", platform: "unknown", metrics: {}, hashtags: [], facts: { has_speech: false }, evidence_at: NOW.toISOString() });
  assert.equal(evidenceOf(slim, { vtt: VTT }), slim);
});

test("gatherEvidence prefers the asked language, counts a failed subtitle and skips rows already done", async () => {
  const asked = [];
  const fetch = async (url) => {
    asked.push(url);
    if (url.endsWith("/gone")) return { ok: false, status: 403 };
    if (url.endsWith("/html")) return { ok: true, text: async () => "<html>expired</html>" };
    if (url.endsWith("/throws")) throw new Error("socket hang up");
    return { ok: true, text: async () => VTT };
  };
  const done = evidenceOf(tiktok("done"), { now: NOW });
  const rows = [
    tiktok("a", [{ language: "spa-ES", downloadLink: "https://subs.example.com/a-spa" }, { language: "eng-US", downloadLink: "https://subs.example.com/a-eng" }]),
    tiktok("gone"),
    tiktok("html"),
    tiktok("throws"),
    tiktok("b", [{ language: "por-BR", tiktokLink: "https://subs.example.com/b-por" }]),
    tiktok("silent", []),
    done
  ];
  const steps = [];
  const result = await gatherEvidence(rows, { fetch, concurrency: 2, now: NOW, onStep: (text) => steps.push(text) });
  assert.deepEqual(result.counts, { posts: 6, transcripts: 2, thumbs: 0, slides: 0, subtitle_failures: 3, thumb_failures: 0, slide_failures: 0 });
  assert.deepEqual(asked.sort(), ["https://subs.example.com/a-eng", "https://subs.example.com/b-por", "https://subs.example.com/gone", "https://subs.example.com/html", "https://subs.example.com/throws"]);
  assert.deepEqual(result.rows.map((row) => [row.id, row.facts.has_speech, "raw" in row, "thumb" in row]), [["a", true, false, false], ["gone", false, false, false], ["html", false, false, false], ["throws", false, false, false], ["b", true, false, false], ["silent", false, false, false], ["done", false, false, false]]);
  assert.equal(result.rows[6], done);
});

test("runEvidence rewrites the library in place and a second run fetches nothing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-evidence-"));
  const file = path.join(dir, "library.jsonl");
  await writeFile(file, `${[tiktok("a"), tiktok("silent", [])].map((row) => JSON.stringify(row)).join("\n")}\n`);
  let calls = 0;
  const io = { fetch: async () => ((calls += 1), { ok: true, text: async () => VTT }), stdout: { write() {} } };
  const first = await runEvidence(file, { "text-only": true, concurrency: "2" }, io);
  assert.deepEqual(first, { out: file, counts: { posts: 2, transcripts: 1, thumbs: 0, slides: 0, subtitle_failures: 0, thumb_failures: 0, slide_failures: 0 } });
  const written = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(written.map((row) => [row.id, row.spoken_hook, row.raw]), [["a", "Never back a horse on a wet track.", undefined], ["silent", undefined, undefined]]);
  assert.deepEqual(await readdir(dir), ["library.jsonl"]);
  assert.equal((await runEvidence(file, { "text-only": true }, io)).counts.posts, 0);
  assert.equal(calls, 1);
  await assert.rejects(runEvidence(file, { concurrency: 0 }, io), /--concurrency must be 1 or more/);
  await assert.rejects(runEvidence(path.join(dir, "missing.jsonl"), {}, io), /not found/);
  await assert.rejects(runEvidence(undefined, {}, io), /usage: library evidence/);
});

test("slideLinks reads a photo post's slides from TikTok and Instagram rows, and nothing from a video", () => {
  const link = (n) => `https://cdn.example.com/s${n}.jpg`;
  assert.deepEqual(slideLinks({ raw: { slideshowImageLinks: [{ downloadLink: link(1) }, { tiktokLink: link(2) }, {}] } }), [link(1), link(2)]);
  assert.deepEqual(slideLinks({ raw: { images: [link(1), link(2), "javascript:alert(1)"] } }), [link(1), link(2)]);
  assert.deepEqual(slideLinks({ raw: { images: [], childPosts: [{ displayUrl: link(1) }, { displayUrl: link(2) }] } }), [link(1), link(2)]);
  assert.deepEqual(slideLinks({ raw: { images: [link(1)] } }), []);
  assert.deepEqual(slideLinks(tiktok("7301")), []);
  assert.deepEqual(slideLinks({}), []);
});

test("gatherEvidence stores one sheet of a photo post's slides and counts a failed one", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-slides-"));
  const image = execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=red:s=90x160", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"]);
  const fetch = async (url) => (String(url).includes("gone") ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => image });
  const photo = (id, names) => ({ ...post, id, raw: { isSlideshow: true, slideshowImageLinks: names.map((name) => ({ downloadLink: `https://cdn.example.com/${name}.png` })) } });
  const result = await gatherEvidence([photo("p1", ["a", "b", "c"]), photo("p2", ["a", "gone"])], { fetch, slidesDir: path.join(dir, "slides"), now: NOW });
  assert.deepEqual([result.counts.slides, result.counts.slide_failures], [1, 1]);
  assert.deepEqual(result.rows.map((row) => [row.slides, row.facts.slides]), [["slides/p1.jpg", 3], [undefined, 2]]);
  assert.deepEqual(await readdir(path.join(dir, "slides")), ["p1.jpg"]);
});
