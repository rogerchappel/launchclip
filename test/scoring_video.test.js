// Video signals (src/scoring/video.js) against stand-ins for yt-dlp and the
// probe: no network and no real post. One test runs ffmpeg on a clip it makes.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { contactSheet, contrastSample, cutsOf, parseShowinfo, requireTools, runVideo, sheetTimes, videoSignals } from "../src/scoring/video.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "launchclip-video-test-"));
const post = (account, n, outlier, more = {}) => ({ id: `${account}-${n}`, platform: "tiktok", account, url: `https://example.com/${account}/${n}`, outlier, metrics: { views: 100 * n }, ...more });
// Ten posts with outliers 1..10.
const account = (name, more = () => ({})) => Array.from({ length: 10 }, (_, i) => post(name, i + 1, i + 1, more(i + 1)));

test("contrastSample takes each account's best and worst, and only where there are enough", () => {
  const rows = [...account("a"), ...account("small").slice(0, 3), post("a", 11, null), post("a", 12, 99, { url: undefined })];
  assert.deepEqual(contrastSample(rows, { best: 2, worst: 2 }).map((row) => row.id), ["a-10", "a-9", "a-2", "a-1"]);
  assert.equal(contrastSample(rows).length, 10);
  assert.deepEqual(contrastSample(rows, { best: 6, worst: 5 }), []);
});

test("contrastSample skips rows that are done without reaching for the middle posts", () => {
  const rows = account("a", (n) => (n === 10 || n === 1 ? { facts: { cuts_per_s: 0.4 } } : {}));
  assert.deepEqual(contrastSample(rows, { best: 2, worst: 2 }).map((row) => row.id), ["a-9", "a-2"]);
});

// Captured from ffmpeg 8 on a 3 s clip with one cut at 1.5 s.
const STDERR = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Duration: 00:00:03.00, start: 0.000000, bitrate: 36 kb/s
[Parsed_showinfo_1 @ 0x760300e340] config in time_base: 1/15360, frame_rate: 30/1
[Parsed_showinfo_1 @ 0x760300e340] n:   0 pts:      0 pts_time:0       duration:    512 duration_time:0.0333333 fmt:yuv420p
[Parsed_showinfo_1 @ 0x760300e340] n:   1 pts:  23040 pts_time:1.5     duration:    512 duration_time:0.0333333 fmt:yuv420p cl:left sar:1/1 s:320x568 i:P iskey:1 type:I checksum:F4A6E3F6
[Parsed_showinfo_1 @ 0x760300e340] color_range:tv color_space:bt470bg color_primaries:unknown color_trc:unknown
[Parsed_showinfo_1 @ 0x760300e340] n:   2 pts:  45568 pts_time:2.966667 duration:    512
`;

test("parseShowinfo reads the duration and the cut times, without the first and last frames", () => {
  assert.deepEqual(parseShowinfo(STDERR), { duration_s: 3, cuts: [1.5] });
  assert.deepEqual(parseShowinfo("  Duration: 01:02:03.50, start"), { duration_s: 3723.5, cuts: [] });
  assert.deepEqual(parseShowinfo("no video here"), { duration_s: null, cuts: [] });
});

test("sheetTimes shows 0, 1 and 3 s, then the next cuts, and pads a video with few cuts", () => {
  assert.deepEqual(sheetTimes([0.5, 2, 4, 6, 8, 10, 12, 14, 16], 20), [0, 1, 3, 4.05, 6.05, 8.05, 10.05, 12.05, 14.05]);
  const few = sheetTimes([1.5], 3);
  assert.equal(few.length, 9);
  assert.ok(few.every((time) => time >= 0 && time <= 2.8));
});

test("requireTools names what is missing and how to install it", async () => {
  const exec = async (name) => { if (name === "yt-dlp") throw Object.assign(new Error("spawn"), { code: "ENOENT" }); };
  await assert.rejects(requireTools(["yt-dlp", "ffmpeg"], exec), /--video needs yt-dlp on PATH: brew install yt-dlp/);
  await requireTools(["ffmpeg"], exec);
});

test("videoSignals records the facts and deletes every video, on success and on failure", async () => {
  const dir = await tmp();
  const work = await tmp();
  const saved = [];
  const steps = [];
  const rows = [...account("a"), post("b", 1, 1)];
  rows[9].facts = { duration_s: 12 };
  const { rows: out, counts } = await videoSignals(rows, {
    dir, tmp: work, best: 2, worst: 2, transcribe: (file) => (file.includes("video") ? " hello there " : ""),
    download: async (row, folder) => {
      const file = path.join(folder, "video.mp4");
      await writeFile(file, "not a video");
      saved.push(file);
      if (row.id === "a-2") throw new Error("HTTP Error 403");
      return file;
    },
    probe: async (file) => { if (file.includes(`${path.sep}0${path.sep}`)) throw new Error("no duration"); return { duration_s: 10, cuts: [2, 4, 7] }; },
    sheet: async (file, target) => writeFile(target, "jpeg"),
    onStep: (step) => steps.push(step)
  });
  assert.deepEqual(counts, { sampled: 4, done: 2, failed: 2, transcribed: 2 });
  assert.equal(saved.length, 4);
  assert.ok(saved.every((file) => !existsSync(file)), "a video was left behind");
  assert.deepEqual(await readdir(work), [], "the working folder was left behind");
  assert.deepEqual(out[9], { ...rows[9], transcript: "hello there", facts: { duration_s: 12, cuts_per_s: 0.3, first_cut_s: 2 }, sheet: "sheets/a-10.jpg" });
  assert.equal(out[8].facts.duration_s, 10);
  assert.equal(await readFile(path.join(dir, "sheets", "a-9.jpg"), "utf8"), "jpeg");
  // Failed and unsampled rows are untouched.
  assert.deepEqual([out[0], out[1], out[5], out[10]], [rows[0], rows[1], rows[5], rows[10]]);
  assert.deepEqual(steps.filter((step) => !step.ok).map((step) => [step.row.id, step.error]).sort(), [["a-1", "no duration"], ["a-2", "HTTP Error 403"]]);
});

test("videoSignals works out the outlier for sampling only and stops before any work when a tool is missing", async () => {
  const dir = await tmp();
  const rows = account("a").map(({ outlier, ...row }) => row);
  const stand = { download: async (row, folder) => path.join(folder, "v.mp4"), probe: async () => ({ duration_s: 4, cuts: [] }), sheet: async () => {}, transcribe: false };
  const { rows: out, counts } = await videoSignals(rows, { dir, best: 1, worst: 1, ...stand });
  assert.deepEqual(counts, { sampled: 2, done: 2, failed: 0, transcribed: 0 });
  assert.deepEqual(out[9], { ...rows[9], facts: { cuts_per_s: 0, first_cut_s: null, duration_s: 4 }, sheet: "sheets/a-10.jpg" });
  assert.equal("outlier" in out[9], false);

  const empty = await tmp();
  const PATH = process.env.PATH;
  process.env.PATH = empty;
  try { await assert.rejects(videoSignals(rows, { dir: empty }), /--video needs yt-dlp and ffmpeg on PATH/); } finally { process.env.PATH = PATH; }
  assert.deepEqual(await readdir(empty), []);
});

test("runVideo rewrites the library in place and resumes", async () => {
  const dir = await tmp();
  const file = path.join(dir, "library.jsonl");
  await writeFile(file, `${account("a").map((row) => JSON.stringify(row)).join("\n")}\n`);
  await writeFile(path.join(dir, "clip.mp4"), "x");
  let downloads = 0;
  const lines = [];
  const io = { stdout: { write: (line) => lines.push(line) }, download: async (row, folder) => { downloads += 1; if (row.id === "a-1") throw new Error("gone"); return path.join(folder, "v.mp4"); } };
  // Without ffmpeg the probe fails for every row: counted, not thrown.
  const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  if (!ffmpeg) return assert.rejects(runVideo(file, {}, io), /needs ffmpeg/);
  const first = await runVideo(file, { best: "1", worst: "1", "no-transcribe": true }, io);
  assert.deepEqual(first, { out: file, counts: { sampled: 2, done: 0, failed: 2, transcribed: 0 } });
  assert.equal(lines.length, 2);
  assert.match(lines.join(""), /a-1: failed: gone/);
  assert.deepEqual((await readdir(dir)).sort(), ["clip.mp4", "library.jsonl"]);
  assert.equal((await readFile(file, "utf8")).trim().split("\n").length, 10);
  await assert.rejects(runVideo(file, { best: "x" }, io), /--best must be a whole number/);
  await assert.rejects(runVideo(path.join(dir, "none.jsonl"), {}, io), /not found/);
  assert.equal(downloads, 2);
});

test("cutsOf and contactSheet on a real clip", { skip: spawnSync("ffmpeg", ["-version"]).status !== 0 && "ffmpeg is not installed" }, async () => {
  const dir = await tmp();
  const clip = path.join(dir, "clip.mp4");
  // 1.5 s of one test pattern, then 1.5 s of another: one cut.
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1.5:size=320x568:rate=30", "-f", "lavfi", "-i", "smptebars=duration=1.5:size=320x568:rate=30", "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-pix_fmt", "yuv420p", clip]);
  const found = await cutsOf(clip);
  assert.deepEqual(found, { duration_s: 3, cuts: [1.5] });
  const out = await contactSheet(clip, path.join(dir, "sheets", "clip.jpg"), found);
  const head = (await readFile(out)).subarray(0, 3);
  assert.deepEqual([...head], [0xff, 0xd8, 0xff]);
  assert.ok(statSync(out).size > 2000 && statSync(out).size < 200 * 1024);
});
