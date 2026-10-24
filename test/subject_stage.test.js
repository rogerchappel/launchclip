// Subject stage runner (src/subject/stage.js): probe and matte on a generated
// clip, with a brightness "segmenter" standing in for the ONNX model, so the
// frame I/O, cache and schemas are tested without model weights.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { validateSubjectInfo, validateSubjectProbe } from "../kit/core/subject.mjs";
import { matteSize, parseRange, rangeDirName, runSubjectMatte, runSubjectProbe } from "../src/subject/stage.js";
import { inputSize, resizeAlpha } from "../src/subject/segment.js";
import { modelStatus, subjectModel } from "../src/subject/models.js";

const execFileAsync = promisify(execFile);
const hasFfmpeg = await execFileAsync("ffmpeg", ["-version"]).then(() => true, () => false);
const needsFfmpeg = { skip: !hasFfmpeg && "ffmpeg unavailable", timeout: 60000 };

// A white "presenter" (head and torso) on black, 180×320 at 10 fps for 3 s.
async function presenterClip(dir) {
  const file = path.join(dir, "clip.mp4");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=180x320:r=10:d=3",
    "-vf", "drawbox=x=64:y=64:w=52:h=52:c=white:t=fill,drawbox=x=20:y=128:w=140:h=192:c=white:t=fill", "-pix_fmt", "yuv420p", "-c:v", "libx264", file]);
  return file;
}

function brightnessSegmenter() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async segment(rgb, width, height) {
      calls += 1;
      const alpha = new Uint8Array(width * height);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = rgb[i * 3] > 128 ? 255 : 0;
      return alpha;
    },
    async release() {}
  };
}

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-subject-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("probe samples the clip, finds one person and caches the result", needsFfmpeg, async (t) => {
  const dir = await tempDir(t);
  const clip = await presenterClip(dir);
  const segmenter = brightnessSegmenter();
  const first = await runSubjectProbe(clip, { cacheDir: path.join(dir, "cache"), segmenter });
  assert.equal(first.cached, false);
  assert.deepEqual(validateSubjectProbe(first.probe).errors, []);
  assert.equal(first.probe.people, "one");
  assert.equal(first.probe.usable, true);
  assert.equal(first.probe.source.width, 180);
  assert.equal(first.probe.samples.length, 3);
  assert.ok(Math.abs(first.probe.head.x - 0.5) < 0.03, `head x ${first.probe.head.x}`);
  assert.match(first.path, /[0-9a-f]{12}-mediapipe-selfie[/\\]probe\.json$/);

  const again = await runSubjectProbe(clip, { cacheDir: path.join(dir, "cache"), segmenter });
  assert.equal(again.cached, true);
  assert.equal(segmenter.calls, 3, "the cached probe runs no inference");
});

test("matte writes an alpha WebM and one subject frame per source frame", needsFfmpeg, async (t) => {
  const dir = await tempDir(t);
  const clip = await presenterClip(dir);
  const result = await runSubjectMatte(clip, { in: 1, out: 2 }, { cacheDir: path.join(dir, "cache"), segmenter: brightnessSegmenter() });
  assert.equal(result.cached, false);
  assert.deepEqual(validateSubjectInfo(result.info).errors, []);
  assert.equal(result.info.frames.length, 10);
  assert.equal(result.info.frames[0].t, 1);
  assert.ok(result.dir.endsWith(path.join("ranges", "1.000-2.000")));
  assert.ok((await stat(result.matte)).size > 0);
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", result.matte]);
  const stream = JSON.parse(stdout).streams[0];
  assert.equal(stream.codec_name, "vp9");
  assert.equal(stream.tags?.alpha_mode ?? stream.tags?.ALPHA_MODE, "1");
  const info = JSON.parse(await readFile(result.subject, "utf8"));
  assert.equal(info.matte, "matte.webm");
  assert.deepEqual(info.matte_size, { width: 180, height: 320 });
  // The plate is the room without the presenter: black where the white figure stood.
  assert.equal(info.plate, "plate.jpg");
  assert.ok((await stat(result.plate)).size > 0);
  assert.ok(info.plate_seen > 0.4 && info.plate_seen < 0.7, `plate_seen ${info.plate_seen}`);
  const cached = await runSubjectMatte(clip, { in: 1, out: 2 }, { cacheDir: path.join(dir, "cache"), segmenter: brightnessSegmenter() });
  assert.equal(cached.cached, true);
});

test("matte rejects a range outside the clip", needsFfmpeg, async (t) => {
  const dir = await tempDir(t);
  const clip = await presenterClip(dir);
  await assert.rejects(runSubjectMatte(clip, { in: 2, out: 1 }, { cacheDir: dir, segmenter: brightnessSegmenter() }), /0 ≤ in < out/);
});

test("matteSize caps the short edge at 1920 and keeps the aspect", () => {
  assert.deepEqual(matteSize({ width: 3840, height: 2160 }), { width: 3414, height: 1920 });
  assert.deepEqual(matteSize({ width: 2160, height: 3840 }), { width: 1920, height: 3414 });
  assert.deepEqual(matteSize({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
});

test("parseRange and rangeDirName", () => {
  assert.deepEqual(parseRange("4-10.5"), { in: 4, out: 10.5 });
  assert.deepEqual(parseRange("0:3"), { in: 0, out: 3 });
  assert.throws(() => parseRange("ten"), /--range must be/);
  assert.equal(rangeDirName({ in: 4, out: 10.5 }), "4.000-10.500");
});

test("model input sizes keep the aspect where the model allows it", () => {
  assert.deepEqual(inputSize(subjectModel("modnet").input.size, 1080, 1920), { width: 512, height: 896 });
  assert.deepEqual(inputSize(subjectModel("modnet").input.size, 1920, 1080), { width: 896, height: 512 });
  assert.deepEqual(inputSize(subjectModel("mediapipe-selfie").input.size, 1080, 1920), { width: 256, height: 256 });
  assert.throws(() => subjectModel("rvm"), /Unknown subject model "rvm"/);
});

test("resizeAlpha scales a float mask to bytes", () => {
  const out = resizeAlpha(new Float32Array([0, 1, 0, 1]), 2, 2, 4, 4);
  assert.equal(out.length, 16);
  assert.equal(out[0], 0);
  assert.equal(out[3], 255);
});

test("modelStatus reports a missing model without the network", async (t) => {
  const dir = await tempDir(t);
  assert.deepEqual(await modelStatus("modnet", { dir }), { id: "modnet", installed: false, models: [{ id: "modnet", path: path.join(dir, "modnet.onnx"), installed: false }] });
  const fused = await modelStatus("modnet-fused", { dir });
  assert.deepEqual(fused.models.map((model) => model.id), ["modnet", "mediapipe-selfie"]);
  assert.equal(fused.installed, false);
});

test("ensureModel refuses a download that fails verification", async (t) => {
  const dir = await tempDir(t);
  const { ensureModel } = await import("../src/subject/models.js");
  const fetchImpl = async () => new Response(new Uint8Array([1, 2, 3]));
  await assert.rejects(ensureModel("mediapipe-selfie", { dir, fetchImpl }), /failed verification/);
  assert.equal((await modelStatus("mediapipe-selfie", { dir })).installed, false);
  await assert.rejects(ensureModel("mediapipe-selfie", { dir, download: false }), /launchclip subject setup --model mediapipe-selfie/);
});

test("launchclip subject probe says how to install a missing model", needsFfmpeg, async (t) => {
  const dir = await tempDir(t);
  const clip = await presenterClip(dir);
  const { runCli } = await import("../src/cli.js");
  const previous = process.env.LAUNCHCLIP_HOME;
  process.env.LAUNCHCLIP_HOME = path.join(dir, "home");
  t.after(() => {
    if (previous === undefined) delete process.env.LAUNCHCLIP_HOME;
    else process.env.LAUNCHCLIP_HOME = previous;
  });
  const sink = { write() {} };
  await assert.rejects(runCli(["subject", "probe", clip, "--no-download", "--cache", path.join(dir, "cache")], { stdout: sink, stderr: sink }), /launchclip subject setup --model mediapipe-selfie/);
  await assert.rejects(runCli(["subject", "matte", clip], { stdout: sink, stderr: sink }), /--range must be/);
});

test("fillHoles fills a hole from its surroundings", async () => {
  const { fillHoles } = await import("../src/subject/plate.js");
  const width = 8, height = 8;
  const color = new Float32Array(width * height * 3).fill(200);
  const weight = new Float32Array(width * height).fill(1);
  for (let y = 2; y < 6; y += 1) for (let x = 2; x < 6; x += 1) { weight[y * width + x] = 0; color.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3); }
  const out = fillHoles(color, weight, width, height);
  assert.ok(Math.abs(out[(4 * width + 4) * 3] - 200) < 1, `centre ${out[(4 * width + 4) * 3]}`);
  assert.equal(out[0], 200, "known pixels keep their colour");
  const empty = fillHoles(new Float32Array(12), new Float32Array(4), 2, 2);
  assert.equal(empty[0], 128, "no known pixel anywhere → mid-grey");
});
