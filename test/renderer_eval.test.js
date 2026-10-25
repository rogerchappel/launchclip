import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTemporalEvidenceSchedule } from "../src/cinematic_evidence.js";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_THRESHOLDS_FILE,
  GOLDEN_STORIES,
  audioOffset,
  buildReport,
  distribution,
  evaluateStory,
  formatSummary,
  loadThresholds,
  parseArguments,
  parseSsimStats,
  paritySchedule,
  rendererEvalExitCode,
  renderMarkdown,
  residualDb,
  runRendererEval,
  selectStories,
  stageStory,
  summarizeParity,
  thresholdsFor
} from "../src/renderer_eval.js";
import { mediaSkip } from "./helpers/media.js";

const format = { duration: 6, fps: 30, width: 1080, height: 1920 };
const boundaries = [
  { boundary_id: "s2-in", sequence_id: null, kind: "ordinary", start_seconds: 3, duration_seconds: 0.4 },
  { boundary_id: "s3-in", sequence_id: "s2", kind: "shared-world", start_seconds: 4.5, duration_seconds: 0.5 }
];

test("paritySchedule quantises the temporal-evidence schedule to unique frames", () => {
  const schedule = paritySchedule(format, boundaries);
  const evidence = buildTemporalEvidenceSchedule(6, boundaries);
  // Every evidence entry lands on exactly one sample.
  assert.equal(schedule.reduce((sum, sample) => sum + sample.evidence_ids.length, 0), evidence.entries.length);
  const frames = schedule.map((sample) => sample.frame);
  assert.deepEqual(frames, [...new Set(frames)].sort((a, b) => a - b));
  assert.ok(frames.every((frame) => frame >= 0 && frame <= 179));
  // Hook samples, the ordinary boundary's three phases and the shared-world morph's seven.
  assert.deepEqual(schedule.slice(0, 3).map((sample) => sample.frame), [0, 8, 15]);
  const morph = schedule.filter((sample) => sample.boundary_ids.includes("s3-in"));
  assert.equal(morph.length, 7);
  assert.deepEqual(morph.map((sample) => sample.frame), [134, 135, 138, 143, 147, 150, 152]);
  assert.ok(morph.find((sample) => sample.frame === 143).roles.includes("peak-speed"));
  const last = schedule.at(-1);
  assert.equal(last.frame, 179);
  assert.ok(last.roles.includes("final-hold"));
  // A plain hook sample keeps a single role.
  const merged = schedule.find((sample) => sample.frame === 120);
  assert.deepEqual(merged.roles, ["hook"]);
  assert.throws(() => paritySchedule({ duration: 6, fps: 0 }, []), /positive fps/);
});

test("summarizeParity ranks the worst samples and summarises the full scan", () => {
  const samples = [
    { frame: 0, at_seconds: 0, ssim: 0.99, roles: ["hook"], evidence_ids: ["hook-001"] },
    { frame: 30, at_seconds: 1, ssim: 0.95, roles: ["hook"], evidence_ids: ["hook-005"] },
    { frame: 90, at_seconds: 3, ssim: 0.98, roles: ["midpoint"], evidence_ids: ["boundary-s2-in-midpoint"] },
    { frame: 120, at_seconds: 4, ssim: null, roles: ["hook"], evidence_ids: ["hook-009"] }
  ];
  const scan = [{ frame: 0, ssim: 0.99 }, { frame: 1, ssim: 0.9 }, { frame: 2, ssim: 0.97 }];
  const summary = summarizeParity(samples, scan, { worst: 2, fps: 30 });
  assert.equal(summary.sample_count, 4);
  assert.equal(summary.min_ssim, 0.95);
  assert.equal(summary.median_ssim, 0.98);
  assert.deepEqual(summary.worst.map((entry) => entry.frame), [30, 90]);
  assert.equal(summary.all_frames.min, 0.9);
  assert.deepEqual(summary.all_frames.worst[0], { frame: 1, at_seconds: 0.0333, ssim: 0.9 });
  assert.equal(summarizeParity([], []).min_ssim, null);
  assert.deepEqual(distribution([3, 1, 2]), { count: 3, min: 1, p05: 1.1, median: 2, mean: 2, max: 3 });
});

test("parseSsimStats reads ffmpeg ssim stats lines as zero-based frames", () => {
  const text = "n:1 Y:0.99 U:0.98 V:0.97 All:0.985 (18.2)\nn:2 Y:0.9 U:0.9 V:0.9 All:0.900000 (10.0)\n";
  assert.deepEqual(parseSsimStats(text), [{ frame: 0, ssim: 0.985 }, { frame: 1, ssim: 0.9 }]);
});

test("audioOffset and residualDb find and measure a shifted copy", () => {
  const n = 48000;
  const a = new Float32Array(n);
  let seed = 7;
  for (let i = 0; i < n; i += 1) { seed = (seed * 1103515245 + 12345) % 2147483648; a[i] = Math.sin(i / 9) * 0.3 + (seed / 2147483648 - 0.5) * 0.2; }
  const shift = 1024;
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) b[i] = i >= shift ? a[i - shift] : 0;
  assert.equal(audioOffset(a, b, 48000), shift);
  assert.equal(residualDb(a, b, shift), -Infinity);
  assert.ok(residualDb(a, b, 0) > -3, "unaligned copies barely cancel");
  assert.equal(audioOffset(a, a, 48000), 0);
});

function storyResult(overrides = {}) {
  const renderer = (lufs) => ({
    compile_ms: 10, render_ms: 1000, compile: { warnings: [], placeholders: [] },
    probe: { frames: 180, fps: 30, width: 1080, height: 1920, video_duration: 6, audio: { codec: "aac", sample_rate: 48000, channels: 2 } },
    motion: { ok: true, findings: [], bursts_per_minute: 40 },
    audio: { ok: true, findings: [], integrated_lufs: lufs, true_peak_dbfs: -2 }
  });
  return {
    id: "minimal",
    title: "Minimal",
    format,
    validation: { status: "passed", errors: [], warnings: [] },
    layout: { status: "passed", errors: 0, findings: [] },
    renderers: { hyperframes: { ...renderer(-20), render_ms: 2000 }, remotion: renderer(-20.2) },
    comparison: {
      frames: { hyperframes: 180, remotion: 180, delta: 0 },
      parity: { sample_count: 2, min_ssim: 0.985, median_ssim: 0.99, worst: [{ frame: 96, at_seconds: 3.2, ssim: 0.985, roles: ["midpoint"], evidence_ids: [] }], samples: [{ frame: 0, at_seconds: 0, ssim: 0.995 }, { frame: 96, at_seconds: 3.2, ssim: 0.985 }], all_frames: { min: 0.98, p05: 0.981, median: 0.99, worst: [{ frame: 5, at_seconds: 0.1667, ssim: 0.98 }] }, contact_sheet: "minimal/worst-frames.png" },
      loudness: { lufs_delta: 0.2, true_peak_delta_db: 0 },
      audio: { present: true, streams_match: true, stream_differences: [], pcm_identical: false, offset_ms: 0, residual_db: -40 }
    },
    warnings: [],
    ...overrides
  };
}

test("evaluateStory passes a matching pair and names each failed threshold", () => {
  const ok = evaluateStory(storyResult(), DEFAULT_THRESHOLDS);
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));
  assert.ok(ok.checks.some((check) => check.id === "parity" && check.ok));

  const bad = storyResult();
  bad.comparison.parity.samples[1].ssim = 0.95;
  bad.comparison.parity.min_ssim = 0.95;
  bad.comparison.frames = { hyperframes: 180, remotion: 182, delta: 2 };
  bad.renderers.remotion.probe.frames = 182;
  bad.comparison.loudness.lufs_delta = 0.8;
  bad.renderers.hyperframes.compile.placeholders = ["s1: no emitter; rendering a placeholder"];
  bad.renderers.remotion.motion = { ok: false, findings: [{ message: "Only 3 bursts." }] };
  bad.layout.errors = 2;
  bad.validation.warnings = ["word anchors without audio.words"];
  const result = evaluateStory(bad, DEFAULT_THRESHOLDS);
  assert.equal(result.ok, false);
  const ids = result.failures.map((failure) => `${failure.id}${failure.renderer ? `:${failure.renderer}` : ""}`).sort();
  assert.deepEqual(ids, ["compile:hyperframes", "duration", "duration:remotion", "layout", "loudness", "motion:remotion", "parity", "validate"]);
  assert.match(result.failures.find((failure) => failure.id === "parity").message, /1 of 2 samples below SSIM 0\.97: 3\.2s=0\.9500/);

  const crashed = evaluateStory({ ...storyResult(), renderers: { hyperframes: { error: "chrome died" } }, comparison: null }, DEFAULT_THRESHOLDS);
  assert.deepEqual(crashed.failures.map((failure) => failure.message), ["hyperframes: chrome died"]);
});

test("thresholds merge defaults, the file and per-story overrides", () => {
  const file = { parity: { min_ssim: 0.99 }, audio: { max_offset_ms: 25 }, stories: { minimal: { gates: { motion: false }, parity: { min_ssim: 0.9 } } } };
  const minimal = thresholdsFor(file, "minimal");
  assert.equal(minimal.parity.min_ssim, 0.9);
  assert.equal(minimal.gates.motion, false);
  assert.equal(minimal.gates.layout, true);
  assert.equal(minimal.audio.max_offset_ms, 25);
  assert.equal(minimal.stories, undefined);
  assert.equal(thresholdsFor(file, "cooling").parity.min_ssim, 0.99);
  assert.equal(thresholdsFor(file, "cooling").gates.motion, true);

  const failing = storyResult();
  failing.renderers.remotion.motion = { ok: false, findings: [{ message: "static" }] };
  failing.comparison.audio.offset_ms = 21.33;
  assert.deepEqual(evaluateStory(failing, file).failures.map((failure) => failure.id), []);
  assert.deepEqual(evaluateStory({ ...failing, id: "cooling" }, file).failures.map((failure) => failure.id).sort(), ["motion", "parity"]);
  const report = evaluateStory({ ...failing, id: "cooling" }, { gates: { motion: "report" } });
  assert.equal(report.ok, true);
  assert.deepEqual(report.advisories.map((entry) => `${entry.id}:${entry.renderer}`), ["motion:remotion"]);
  assert.equal(buildReport([{ ...failing, id: "cooling" }], { thresholds: { gates: { motion: "report" } } }).summary[0].remotion_gates, "pass (motion: report)");
  const offset = evaluateStory({ ...failing, id: "cooling" }, { audio: { max_offset_ms: 10 } });
  assert.ok(offset.failures.some((failure) => failure.id === "audio-offset" && /21\.33 ms/.test(failure.message)));
});

test("the checked-in thresholds file loads and sets the documented limits", async () => {
  const thresholds = await loadThresholds(DEFAULT_THRESHOLDS_FILE);
  const merged = thresholdsFor(thresholds, "promo-16x9");
  assert.equal(merged.parity.min_ssim, 0.97);
  assert.equal(merged.duration.max_delta_frames, 1);
  assert.equal(merged.loudness.max_lufs_delta, 0.5);
  assert.equal(thresholds.schema_version, undefined, "metadata keys are stripped");
  for (const id of Object.keys(thresholds.stories ?? {})) assert.ok(GOLDEN_STORIES.some((story) => story.id === id), `override for unknown story ${id}`);
  // Ambient motion lifts every golden story over the cinematic motion gate, so it is enforced.
  for (const story of GOLDEN_STORIES) {
    const gates = thresholdsFor(thresholds, story.id).gates;
    assert.equal(gates.motion, true, `${story.id} enforces the motion gate`);
    assert.equal(thresholdsFor(thresholds, story.id).parity.min_ssim, 0.97, `${story.id} keeps min SSIM 0.97`);
  }
  assert.ok(GOLDEN_STORIES.some((story) => story.id === "footage"), "the footage-led example is in the eval set");
});

test("buildReport shapes the summary, markdown and exit code", () => {
  const report = buildReport([storyResult(), storyResult({ id: "promo-16x9", error: "stage failed" })], { thresholds: {}, quality: "draft", out: "/tmp/eval" });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.failed_stories, ["promo-16x9"]);
  assert.equal(rendererEvalExitCode(report), 1);
  const row = report.summary[0];
  assert.deepEqual({ id: row.id, status: row.status, hf: row.hyperframes_render_s, rm: row.remotion_render_s, ratio: row.speed_ratio, min: row.min_ssim, gates: [row.hyperframes_gates, row.remotion_gates] },
    { id: "minimal", status: "passed", hf: 2, rm: 1, ratio: 2, min: 0.985, gates: ["pass", "pass"] });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /\| minimal \| 2\.0 s \| 1\.0 s \| 2\.00× \| 0\.9850 \| 0\.9900 \| 3\.2s \| pass \| pass \| pass \|/);
  assert.match(markdown, /!\[minimal worst frames\]\(minimal\/worst-frames\.png\)/);
  assert.match(markdown, /## promo-16x9[\s\S]*\*\*Eval error:\*\* stage failed/);
  assert.match(formatSummary(report), /FAIL promo-16x9[\s\S]*story eval failed: stage failed/);
  assert.equal(rendererEvalExitCode(buildReport([storyResult()], {})), 0);
});

test("parseArguments and selectStories validate the CLI surface", () => {
  assert.deepEqual(parseArguments(["--stories", "minimal,cooling", "--quality", "draft", "--out", "qa/x", "--worst=2"]), { stories: ["minimal", "cooling"], quality: "draft", out: "qa/x", worst: 2 });
  assert.throws(() => parseArguments(["--bogus"]), /Unknown renderer-eval option/);
  assert.throws(() => parseArguments(["--out"]), /Missing value for --out/);
  assert.deepEqual(selectStories(["minimal"]).map((story) => story.id), ["minimal"]);
  assert.equal(selectStories([]).length, GOLDEN_STORIES.length);
  assert.throws(() => selectStories(["nope"]), /Unknown story nope/);
});

test("stageStory copies a loose story beside its narration and drops audio it does not ship", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-stage-"));
  try {
    const cooling = GOLDEN_STORIES.find((story) => story.id === "cooling");
    const staged = await stageStory(cooling, path.join(out, "cooling"));
    const story = JSON.parse(await readFile(staged.storyFile, "utf8"));
    assert.equal(story.audio.voice, undefined);
    assert.equal(story.lane, "motion");
    assert.ok(staged.warnings.some((warning) => /audio\.voice assets\/audio\/narration\.wav/.test(warning)));
    assert.ok(JSON.parse(await readFile(path.join(staged.project, "cooling.NARRATION.json"), "utf8")).words.length > 10);

    const minimal = await stageStory(GOLDEN_STORIES.find((entry) => entry.id === "minimal"), path.join(out, "minimal"));
    assert.deepEqual(minimal.warnings, []);
    assert.ok((await readFile(path.join(minimal.project, "assets", "audio", "mix.wav"))).length > 1000);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("runRendererEval drives injected renders end to end and writes both reports", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-renderer-eval-"));
  try {
    let clock = 0;
    const calls = [];
    const probe = { frames: 180, fps: 30, width: 1080, height: 1920, video_duration: 6, audio: { codec: "aac", sample_rate: 48000, channels: 2 } };
    const adapters = {
      now: () => (clock += 500),
      stage: async (definition, project) => { calls.push(["stage", definition.id]); return { project, storyFile: path.join(project, "storyboard.json"), warnings: [] }; },
      validate: async () => ({ status: "passed", errors: [], warnings: [] }),
      layout: async () => ({ status: "passed", errors: 0, findings: [] }),
      loadStory: async () => ({ title: "Injected", format, boundaries }),
      compile: async (name) => { calls.push(["compile", name]); return { warnings: [] }; },
      render: async (name, project, file, options) => { calls.push(["render", name, options.quality]); await writeFile(file, "mp4"); },
      probe: async () => probe,
      motion: async () => ({ quality: { ok: true, findings: [] }, motion_bursts_per_minute: 30 }),
      audio: async () => ({ quality: { ok: true, findings: [] }, output: { integrated_lufs: -19, true_peak_dbfs: -2 } }),
      extractFrames: async (video, frames, dir, prefix) => new Map(frames.map((frame) => [frame, path.join(dir, `${prefix}-${frame}.png`)])),
      ssimPair: async (a) => (/-143\.png$/.test(a) ? 0.96 : 0.99),
      ssimScan: async () => [{ frame: 0, ssim: 0.99 }, { frame: 143, ssim: 0.96 }],
      contactSheet: async (pairs, file) => { calls.push(["sheet", pairs.length]); return file; },
      compareAudio: async () => ({ present: true, streams_match: true, stream_differences: [], pcm_identical: false, offset_ms: 0, residual_db: -45 })
    };
    const report = await runRendererEval({ stories: ["minimal"], out, quality: "draft", thresholdsFile: null, worst: 3 }, adapters);
    assert.deepEqual(calls, [["stage", "minimal"], ["compile", "hyperframes"], ["render", "hyperframes", "draft"], ["compile", "remotion"], ["render", "remotion", "draft"], ["sheet", 3]]);
    assert.equal(report.status, "failed");
    const story = report.stories[0];
    assert.equal(story.renderers.hyperframes.render_ms, 500);
    assert.equal(story.comparison.parity.min_ssim, 0.96);
    assert.equal(story.comparison.parity.worst[0].frame, 143);
    assert.deepEqual(story.evaluation.failures.map((failure) => failure.id), ["parity"]);
    assert.equal(story.comparison.parity.contact_sheet, path.join("minimal", "worst-frames.png"));
    const written = JSON.parse(await readFile(path.join(out, "report.json"), "utf8"));
    assert.equal(written.schema_version, "launchclip.renderer-eval.v1");
    assert.match(await readFile(path.join(out, "report.md"), "utf8"), /\| minimal \| 0\.5 s \| 0\.5 s \| 1\.00× \| 0\.9600 \|/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

async function chromeAvailable() {
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

test("eval:renderers renders examples/story/minimal with both renderers and matches them", { skip: mediaSkip(), timeout: 600_000 }, async (t) => {
  const missing = await chromeAvailable();
  if (missing) { t.skip(`Chrome Headless Shell is unavailable: ${missing}`); return; }
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { t.skip("FFmpeg is unavailable"); return; }
  const out = await mkdtemp(path.join(os.tmpdir(), "launchclip-renderer-eval-e2e-"));
  try {
    const report = await runRendererEval({ stories: ["minimal"], out, quality: "draft" });
    const story = report.stories[0];
    assert.equal(story.error, undefined);
    for (const name of ["hyperframes", "remotion"]) {
      assert.equal(story.renderers[name].error, undefined, `${name}: ${story.renderers[name].error}`);
      assert.equal(story.renderers[name].probe.frames, 180);
      assert.ok(story.renderers[name].render_ms > 0);
    }
    assert.equal(story.comparison.frames.delta, 0);
    assert.ok(story.comparison.parity.sample_count >= 10);
    assert.ok(story.comparison.parity.min_ssim >= 0.97, `min SSIM ${story.comparison.parity.min_ssim}`);
    assert.equal(story.comparison.audio.streams_match, true);
    assert.ok(story.comparison.loudness.lufs_delta <= 0.5);
    assert.equal(story.evaluation.ok, true, JSON.stringify(story.evaluation.failures));
    assert.match(await readFile(path.join(out, "report.md"), "utf8"), /\| minimal \|/);
    const sheet = await readFile(path.join(out, "minimal", "worst-frames.png"));
    assert.equal(sheet.subarray(1, 4).toString("ascii"), "PNG");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

