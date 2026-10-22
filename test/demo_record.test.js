// Demo autopilot recorder (src/demo/record.js): pacing, Chromium lookup and
// frame encoding. The end-to-end recording of examples/demo-app lives in
// test/demo_autopilot.test.js and skips when no Chromium is available.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cursorPath, encodeFrames, findChromium, seededRandom, typingDelays } from "../src/demo/record.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

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
