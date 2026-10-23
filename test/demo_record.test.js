// Demo autopilot recorder (src/demo/record.js): pacing, Chromium lookup and
// frame encoding. The end-to-end recording of examples/demo-app lives in
// test/demo_autopilot.test.js and skips when no Chromium is available.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cursorPath, encodeFrames, findChromium, loadPlaywright, locate, recorderAvailability, seededRandom, typingDelays } from "../src/demo/record.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const available = await recorderAvailability();
const needsBrowser = { skip: !available.ok && `recorder unavailable: ${available.reasons.join("; ")}`, timeout: 60000 };

async function withPage(t, html) {
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html);
  return page;
}

test("seededRandom is deterministic per seed", () => {
  const a = seededRandom("create"), b = seededRandom("create"), c = seededRandom("tour");
  const take = (random) => Array.from({ length: 5 }, random);
  const first = take(a);
  assert.deepEqual(first, take(b));
  assert.notDeepEqual(first, take(c));
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

test("cursorPath eases from start to target in 0.35–0.9 s", () => {
  const random = seededRandom("path");
  const short = cursorPath({ x: 100, y: 100 }, { x: 110, y: 104 }, random);
  const long = cursorPath({ x: 0, y: 0 }, { x: 1800, y: 1000 }, random);
  const total = (points) => points.reduce((sum, point) => sum + point.dt, 0);
  assert.ok(Math.abs(total(short) - 0.35) < 1e-6);
  assert.ok(Math.abs(total(long) - 0.9) < 1e-6);
  assert.deepEqual([long.at(-1).x, long.at(-1).y], [1800, 1000]);
  // Eased: the first step is much shorter than a middle step.
  const step = (i) => Math.hypot(long[i].x - (i ? long[i - 1].x : 0), long[i].y - (i ? long[i - 1].y : 0));
  assert.ok(step(0) < step(Math.floor(long.length / 2)) / 4);
});

test("typingDelays are human-paced and seeded", () => {
  const delays = typingDelays("Summer launch", seededRandom("t"));
  assert.equal(delays.length, 13);
  assert.ok(delays.every((ms) => ms >= 45 && ms <= 150));
  assert.ok(delays[6] >= 85, "a space adds a beat");
  assert.deepEqual(delays, typingDelays("Summer launch", seededRandom("t")));
});

test("findChromium prefers LAUNCHCLIP_CHROMIUM and never invents a path", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-chromium-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fake = path.join(dir, "chrome");
  await writeFile(fake, "");
  assert.equal(await findChromium({ env: { LAUNCHCLIP_CHROMIUM: fake } }), fake);
  const found = await findChromium({ env: { PLAYWRIGHT_BROWSERS_PATH: dir } });
  assert.ok(found === null || typeof found === "string");
});

test("loadPlaywright falls back to the Playwright the recorded app's repo installs", async (t) => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "launchclip-repo-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const missing = () => Promise.reject(new Error("Cannot find package 'playwright'"));
  assert.equal(await loadPlaywright({ repo, own: missing }), null);
  const pkg = path.join(repo, "node_modules", "@playwright", "test");
  await mkdir(pkg, { recursive: true });
  await writeFile(path.join(pkg, "package.json"), JSON.stringify({ name: "@playwright/test", main: "index.js" }));
  await writeFile(path.join(pkg, "index.js"), "exports.chromium = { name: 'repo chromium' };");
  assert.deepEqual(await loadPlaywright({ repo, own: missing }), { name: "repo chromium" });
  assert.equal(await loadPlaywright({ own: missing }), null, "no repo, no fallback");
});

test("encodeFrames holds each frame until the next timestamp", { skip: !hasFfmpeg && "ffmpeg is not on PATH" }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-encode-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const frames = [];
  for (const [i, color, at] of [[0, "red", 100], [1, "lime", 100.5], [2, "blue", 101.6]]) {
    const file = path.join(dir, `f${i}.jpg`);
    assert.equal(spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", `color=${color}:s=320x180`, "-frames:v", "1", file]).status, 0);
    frames.push({ file, t: at });
  }
  const out = path.join(dir, "clip.mp4");
  const { duration } = await encodeFrames(frames, 102, out, { fps: 30, width: 320, height: 180 });
  assert.equal(duration, 2);
  const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=nb_read_frames,r_frame_rate", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim();
  assert.equal(probe, "30/1,60");
  // Frame 30 (1.0 s) is still the green frame; frame 50 (1.67 s) is blue.
  const pixel = (n) => spawnSync("ffmpeg", ["-loglevel", "error", "-i", out, "-vf", `select=eq(n\\,${n}),scale=1:1`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout;
  const green = pixel(30), blue = pixel(50);
  assert.ok(green[1] > 180 && green[0] < 80, `frame 30 ${[...green]}`);
  assert.ok(blue[2] > 180 && blue[0] < 80, `frame 50 ${[...blue]}`);
});

test("locate skips hidden duplicates that responsive layouts render first", needsBrowser, async (t) => {
  const page = await withPage(t, `<nav style="display:none"><button id="mobile">Save</button><input id="m" placeholder="Name"></nav>
    <main><button id="desktop">Save</button><input id="d" placeholder="Name"></main>`);
  assert.equal(await locate(page, { type: "click", text: "Save" }).getAttribute("id"), "desktop");
  assert.equal(await locate(page, { type: "click", selector: "button" }).getAttribute("id"), "desktop");
  assert.equal(await locate(page, { type: "type", text: "Name" }).getAttribute("id"), "d");
});
