// A real Remotion partial render: segments rendered by frame range, joined
// and encoded once, are frame-identical to a fresh full render.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { narrationWords } from "../kit/core/captions.mjs";
import { renderWithSegments } from "../src/render_segments.js";
import { getRenderer } from "../src/renderers/index.js";
import { resolveStory } from "../src/story.js";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

async function toolsMissing() {
  if (process.env.LAUNCHCLIP_SKIP_REMOTION === "1") return "LAUNCHCLIP_SKIP_REMOTION=1";
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

async function frameCount(file) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]);
  return Number(String(stdout).trim());
}

// Per-frame SSIM (FFmpeg's ssim filter) of two videos of the same size.
async function ssimPerFrame(a, b, dir) {
  const stats = path.join(dir, `ssim-${path.basename(a)}-${path.basename(b)}.txt`);
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", a, "-i", b, "-lavfi", `ssim=stats_file=${stats}`, "-f", "null", "-"]);
  return (await readFile(stats, "utf8")).trim().split("\n").map((line) => Number(line.match(/All:([\d.]+)/)[1]));
}

async function storyOf(project, mutate) {
  const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
  if (mutate) mutate(story);
  const words = narrationWords(JSON.parse(await readFile(path.join(project, "NARRATION.json"), "utf8")));
  return resolveStory(story, { words });
}

test("a Remotion partial render (cached segments + re-rendered ones) equals a fresh full render", { timeout: 900_000 }, async (t) => {
  const missing = await toolsMissing();
  if (missing) { t.skip(`Chrome Headless Shell or FFmpeg is unavailable: ${missing}`); return; }
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-partial-"));
  try {
    const project = path.join(work, "project");
    await cp(MINIMAL, project, { recursive: true });
    const adapter = getRenderer("remotion");
    const render = (story, output, cacheRoot) => renderWithSegments({ project, story, renderer: "remotion", adapter, quality: "draft", output: path.join(work, output), cacheRoot: path.join(work, cacheRoot) });

    const original = await storyOf(project);
    const full = await render(original, "full.mp4", "cache");
    assert.deepEqual([full.segments, full.reused, full.rendered], [4, 0, 4]);

    // Edit s2's copy: only the three segments that show s2 re-render.
    const edited = await storyOf(project, (story) => { story.scenes[1].params.title = "Three fixes"; });
    const partial = await render(edited, "partial.mp4", "cache");
    assert.deepEqual(partial.plan.map((entry) => [entry.id, entry.status]), [["00-s1", "reused"], ["01-s1+s2", "rendered"], ["02-s2", "rendered"], ["03-s2+s1~loop", "rendered"]]);
    t.diagnostic(`full ${full.seconds.total}s (render ${full.seconds.render}s); partial ${partial.seconds.total}s (render ${partial.seconds.render}s), ~${partial.seconds_saved}s saved`);

    // A fresh full render of the edited story through an empty cache.
    const fresh = await render(edited, "fresh.mp4", "fresh-cache");
    assert.equal(fresh.reused, 0);
    const [partialFrames, freshFrames] = [await frameCount(path.join(work, "partial.mp4")), await frameCount(path.join(work, "fresh.mp4"))];
    assert.deepEqual([partialFrames, freshFrames], [180, 180]);
    const ssim = await ssimPerFrame(path.join(work, "partial.mp4"), path.join(work, "fresh.mp4"), work);
    assert.equal(ssim.length, 180);
    const worst = Math.min(...ssim);
    t.diagnostic(`partial vs fresh full: min per-frame SSIM ${worst} over ${ssim.length} frames`);
    assert.ok(worst >= 0.999, `min per-frame SSIM ${worst} at frame ${ssim.indexOf(worst)}`);

    // The soundtrack is muxed once over the whole timeline.
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", path.join(work, "partial.mp4")]);
    const probe = JSON.parse(stdout);
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
    assert.ok(Math.abs(Number(probe.format.duration) - 6) < 0.05);

    // The edit is in the partial render: s2's frames changed, s1's did not.
    const changed = await ssimPerFrame(path.join(work, "full.mp4"), path.join(work, "partial.mp4"), work);
    assert.ok(Math.min(...changed.slice(0, 90)) >= 0.999, "s1 is unchanged");
    assert.ok(Math.min(...changed.slice(102, 179)) < 0.999, "s2's title changed");

    // The single-pass `remotion render` of the same story. Chrome rasterises a
    // few edge pixels (text shadows, glows) a level apart depending on what the
    // tab drew before, and the lossy delivery encode spreads that through the
    // GOP, so this comparison is close rather than identical.
    const legacy = path.join(work, "legacy.mp4");
    await adapter.render(project, legacy, { quality: "draft", story: edited });
    assert.equal(await frameCount(legacy), 180);
    const legacySsim = await ssimPerFrame(path.join(work, "partial.mp4"), legacy, work);
    t.diagnostic(`partial vs single-pass remotion render: min per-frame SSIM ${Math.min(...legacySsim)}`);
    assert.ok(Math.min(...legacySsim) >= 0.99);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
