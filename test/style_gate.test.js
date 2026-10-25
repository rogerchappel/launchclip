// Style adherence (docs/VIDEO_QUALITY_RFC.md §9.5): `style check` and the
// `finish` style gate. The two-stories test needs ffmpeg, like the other
// media tests.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyStyle, STYLE_V3_DEFAULTS } from "../kit/core/style.mjs";
import { resolveStory } from "../kit/core/story.mjs";
import { primaryShare, primaryUses, storyCadence, styleAdherence, styleProfile } from "../src/style_adherence.js";
import { vividHues } from "../src/style_reference.js";
import { checkStyleCommand, createStyleFromReferences } from "../src/style_commands.js";
import { PATHS, runFinish } from "../src/finish.js";
import { mediaSkip } from "./helpers/media.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

const PACK = {
  schema: "launchclip.style.v3",
  name: "channel",
  brand: { colors: { bg: "#102030", paper: "#f0f0f0", ink: "#102030", primary: "#ffcc00", accent: "#33ccff" } },
  captions: { preset: "word-highlight", lanes: { "footage-led": { preset: "quiet-accent" } } },
  brand_frame: STYLE_V3_DEFAULTS.brand_frame,
  profile: { schema: "launchclip.cadence-profile.v1", id: "channel-references", format: "motion", duration_seconds: [5, 120], references: 1, provenance: { kind: "measured", sources: [{ id: "ref-01", rights: "own" }] }, measures: { shot_seconds: { p10: 1.5, p50: 3, p90: 6 }, visual_changes_per_min: { p10: 10, p50: 20, p90: 40 } } },
  reference_stats: { palette: [{ hex: "#102030", weight: 0.8 }, { hex: "#ffcc00", weight: 0.1 }, { hex: "#f0f0f0", weight: 0.1 }], layout_mix: { full: 0.7, "split-right": 0.3 } }
};

const STORY = async (overrides = {}) => {
  const story = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  return applyStyle(resolveStory({ ...story, style: "channel", overlays: [{ type: "captions" }], frame: { kicker: { label: "Channel" } }, ...overrides }, { words }), PACK).story;
};

const MEASURED = {
  palette: [{ hex: "#112131", weight: 0.78 }, { hex: "#fecb02", weight: 0.12 }, { hex: "#efefef", weight: 0.1 }],
  pacing: { duration_seconds: 60, shot_seconds: { median: 2.8 }, cut_rate_per_minute: 22 },
  captions: { position: "bottom", case: "upper" },
  layouts: { frames: ["full", "full", "split-right"], mix: { full: 0.66, "split-right": 0.34 }, changes: 1 }
};

const failing = (result) => result.checks.filter((entry) => !entry.ok).map((entry) => `${entry.severity}:${entry.check}`);

test("a render that follows its style passes every check", async () => {
  const result = styleAdherence({ story: await STORY(), pack: PACK, measured: MEASURED });
  assert.equal(result.status, "passed", JSON.stringify(result.checks, null, 2));
  assert.deepEqual(failing(result), []);
  assert.deepEqual(result.checks.map((entry) => entry.check), ["palette", "captions", "caption case", "layout mix", "cadence: shot_seconds", "cadence: visual_changes_per_min", "brand frame"]);
});

test("each check fails the way it should", async () => {
  const story = await STORY();
  assert.deepEqual(failing(styleAdherence({ story, pack: PACK, measured: { ...MEASURED, palette: [{ hex: "#ff00ff", weight: 1 }] } })), ["error:palette"]);
  assert.deepEqual(failing(styleAdherence({ story: await STORY({ overlays: [{ type: "captions", style: "glow" }] }), pack: PACK, measured: MEASURED })), ["error:captions"]);
  // The case the storyboard's captions draw is checked, not a guess from the pixels.
  assert.deepEqual(failing(styleAdherence({ story: await STORY({ overlays: [{ type: "captions", case: "as-is" }] }), pack: PACK, measured: MEASURED })), ["warning:caption case"]);
  assert.deepEqual(failing(styleAdherence({ story, pack: PACK, measured: { ...MEASURED, captions: { case: "as-is" } } })), [], "a misread caption band does not warn on our own render");
  assert.deepEqual(failing(styleAdherence({ story, pack: PACK, measured: { ...MEASURED, layouts: { ...MEASURED.layouts, mix: { "split-left": 1 } } } })), ["warning:layout mix"]);
  // Without a storyboard (cadence: null) the render's pixel pacing is gated.
  const slow = styleAdherence({ story, pack: PACK, measured: { ...MEASURED, pacing: { duration_seconds: 60, shot_seconds: { median: 12 }, cut_rate_per_minute: 5 } }, cadence: null });
  assert.equal(slow.status, "failed");
  assert.deepEqual(failing(slow), ["error:cadence: shot_seconds", "error:cadence: visual_changes_per_min"]);
  assert.match(slow.checks.find((entry) => entry.check === "cadence: shot_seconds").detail, /shot_seconds 12 s is above the profile band \(1\.5 s–6 s.*channel-references; measured from the render/);
  // A storyboard that holds a shot too long fails from its own numbers.
  const held = styleAdherence({ story, pack: PACK, measured: MEASURED, cadence: { shot_seconds: { p50: 12 }, visual_changes_per_min: 5, layout_changes_per_min: 0 } });
  assert.deepEqual(failing(held), ["error:cadence: shot_seconds", "error:cadence: visual_changes_per_min"]);
  assert.match(held.checks.find((entry) => entry.check === "cadence: shot_seconds").detail, /from the storyboard/);
  assert.deepEqual(failing(styleAdherence({ story: await STORY({ frame: { kicker: false, sections: false } }), pack: PACK, measured: MEASURED })), ["error:brand frame"]);
  assert.deepEqual(failing(styleAdherence({ story: await STORY({ frame: false }), pack: PACK, measured: MEASURED })), ["warning:brand frame"]);
});

test("footage-led renders only need the brand primary to show; without a profile a grammar only warns", async () => {
  const story = { lane: "footage-led", style: "channel", overlays: [{ type: "captions", preset: "quiet-accent" }], scenes: [], format: { width: 1080, height: 1920, duration: 10 }, resolved: { duration: 10 } };
  const pack = { ...PACK, profile: undefined, reference_stats: undefined, brand_frame: { enabled: false }, motion: { grammar: "snappy" } };
  const result = styleAdherence({ story, pack, measured: { palette: [{ hex: "#3a2a20", weight: 0.9 }, { hex: "#ffcd05", weight: 0.01 }], pacing: { shot_seconds: { median: 9 }, cut_rate_per_minute: 6 } } });
  assert.equal(result.status, "passed", JSON.stringify(result.checks));
  assert.deepEqual(failing(result), ["warning:cadence: median shot vs snappy grammar (s)"]);
  assert.equal(result.checks.find((entry) => entry.check === "palette").ok, true);
  assert.equal(result.checks.find((entry) => entry.check === "captions").expected, "quiet-accent", "the lane's preset");
  assert.equal(await styleProfile(PACK), PACK.profile);
  assert.equal(await styleProfile({ profile: "no-such-profile" }), null);
  assert.equal((await styleProfile({ profile: "short-talking-head" })).id, "short-talking-head", "a shipped profile by id");
});

test("caption case and brand primary come from the storyboard; pixel guesses are notes when unsure", async () => {
  // QA: "caption case looks upper-case" fired on sentence-case quiet-accent captions,
  // and "no colour near the brand primary" on a render with orange icons, kicker and accents.
  const footage = { lane: "footage-led", style: "channel", brand: { colors: PACK.brand.colors }, base: { src: "base.mp4" }, overlays: [{ type: "captions", preset: "quiet-accent", colors: { accent: "primary" } }], frame: { kicker: { label: "Channel" } }, scenes: [{ id: "a", module: "icon-row", start: 1, end: 4 }], format: { width: 1920, height: 1080, fps: 30, duration: 10 }, resolved: { duration: 10, fps: 30 } };
  const pack = { ...PACK, profile: undefined, reference_stats: { captions: { case: "as-is" } } };
  const sparse = { palette: [{ hex: "#3a2a20", weight: 0.95 }, { hex: "#6b5a50", weight: 0.05 }], captions: { position: "bottom", case: "upper", confidence: 0.3 }, vivid: { share: 0.01, hues: new Array(24).fill(0) } };
  const result = styleAdherence({ story: footage, pack, measured: sparse, cadence: null });
  const palette = result.checks.find((entry) => entry.check === "palette");
  assert.equal(palette.ok, true, palette.detail);
  assert.deepEqual(palette.measured, ["captions accent word", "kicker underline", "1 graphic scene"]);
  const textCase = result.checks.find((entry) => entry.check === "caption case");
  assert.equal(textCase.ok, true, textCase.detail);
  assert.equal(textCase.measured, "as-is", "quiet-accent draws sentence case");

  // A storyboard that draws nothing in the primary, and pixels that show none of it, warns.
  const plain = { ...footage, overlays: [{ type: "captions", preset: "quiet-accent", colors: { accent: "paper" } }], frame: { kicker: { label: "Channel", underline: false } }, scenes: [{ id: "p", module: "punch-in", start: 1, end: 3 }] };
  assert.deepEqual(failing(styleAdherence({ story: plain, pack, measured: sparse, cadence: null })).filter((entry) => entry.includes("palette")), ["warning:palette"]);
  // ...but a few percent of the frame in the primary's hue (icons, a kicker) counts.
  const hues = new Array(24).fill(0); hues[3] = 0.012;
  assert.equal(primaryShare({ vivid: { hues } }, "#ffcc00"), 0.012, "#ffcc00 is in the 45–60° bin");
  assert.equal(styleAdherence({ story: plain, pack, measured: { ...sparse, vivid: { share: 0.02, hues } }, cadence: null }).checks.find((entry) => entry.check === "palette").ok, true);

  // Without a storyboard, a low-confidence case reading is a note, and the primary check too.
  const pixelsOnly = styleAdherence({ story: null, pack: { ...pack, captions: { preset: "quiet-accent" } }, measured: { ...sparse, pacing: null } });
  assert.equal(pixelsOnly.checks.find((entry) => entry.check === "caption case").severity, "note");
  assert.equal(styleAdherence({ story: null, pack, measured: { ...sparse, captions: { ...sparse.captions, confidence: 0.7 } } }).checks.find((entry) => entry.check === "caption case").severity, "warning");
  assert.deepEqual(primaryUses(null, "#ffcc00"), []);
});

test("vivid hues see a small accent k-means folds away", () => {
  const width = 100, height = 10;
  const data = Buffer.alloc(width * height * 3, 30);
  for (let i = 0; i < 20; i += 1) { const at = (i * 50) * 3; data[at] = 251; data[at + 1] = 99; data[at + 2] = 2; }
  const { share, hues } = vividHues([{ width, height, data }], { step: 1 });
  assert.equal(share, 0.02);
  assert.equal(hues[1], 0.02, "#fb6302 sits at 23°, the 15–30° bin");
});

test("our own renders take cadence from the storyboard, not a cut detector", async () => {
  // QA: a footage render whose graphics change every few seconds measured
  // 2–5 changes a minute and 15 s shots from ffmpeg scene scores, and failed.
  const story = await STORY();
  const sparsePixels = { ...MEASURED, pacing: { duration_seconds: 60, shot_seconds: { median: 15 }, cut_rate_per_minute: 2.6 } };
  const result = styleAdherence({ story, pack: PACK, measured: sparsePixels });
  assert.equal(result.status, "passed", JSON.stringify(result.checks, null, 2));
  const shot = result.checks.find((entry) => entry.check === "cadence: shot_seconds");
  assert.equal(shot.measured, 3, "the storyboard's 3 s scenes");
  assert.match(shot.detail, /from the storyboard/);
  assert.equal(result.checks.find((entry) => entry.check === "cadence: visual_changes_per_min").measured, 10);

  // Scene starts and ends, camera moves and layout changes all count, as the coverage gate counts them.
  const cadence = storyCadence({ lane: "footage-led", base: { src: "base.mp4" }, format: { width: 1920, height: 1080, fps: 30, duration: 60 }, resolved: { duration: 60, fps: 30 }, sections: [{ id: "s1", start: 20, end: 40, layout: "split-right" }], scenes: [
    { id: "a", module: "concept-card", start: 2, end: 6 },
    { id: "b", module: "punch-in", start: 10, end: 12 },
    { id: "c", module: "icon-row", start: 22, end: 30 }
  ] });
  assert.equal(cadence.visual_changes_per_min, 6, "2, 6, 10, 12, 22, 30");
  assert.equal(cadence.layout_changes_per_min, 2, "into the split at 20 s and out at 40 s");
  assert.equal(storyCadence({ scenes: [] }), null, "an unresolved story has no storyboard cadence");
});

test("finish runs the style gate when the story names a style", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-gate-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
    await mkdir(path.join(project, ".launchclip/styles/channel"), { recursive: true });
    await writeFile(path.join(project, ".launchclip/styles/channel/style.json"), JSON.stringify(PACK));
    await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ ...story, style: "channel", overlays: [{ type: "captions" }], frame: { kicker: { label: "Channel" } } }));
    const touch = async (file, content = "x") => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content); };
    const measured = [];
    const adapters = {
      env: {}, notice() {},
      renderer: () => ({ async render(_project, out) { await touch(out, "video"); return { output: out }; } }),
      async synthKit(outDir) { await touch(path.join(outDir, "AUDIO-KIT.json"), "{}"); return {}; },
      async buildMix(options) { await touch(options.out); return { cues: [] }; },
      async hasAudio() { return true; },
      async master(_input, output, target) { await touch(output, "mastered"); return { target: { integrated_lufs: target.lufs }, output: {}, compliant: true }; },
      async buildEvidence(dir) { await touch(path.join(dir, PATHS.evidence), JSON.stringify({ entries: [] })); return { sheets: [] }; },
      async motion(_video, out) { await touch(out, "{}"); return { quality: { ok: true, findings: [] } }; },
      async audio() { return { quality: { ok: true, findings: [] } }; },
      async styleReference(video) { measured.push(video); return MEASURED; }
    };
    const report = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(report.gates.style.status, "passed", JSON.stringify(report.gates.style));
    assert.equal(report.gates.style.report, "qa/style-check.json");
    assert.equal(measured[0], path.join(project, "renders/draft.mp4"));
    const written = JSON.parse(await readFile(path.join(project, "qa/style-check.json"), "utf8"));
    assert.equal(written.style, "channel");
    assert.ok(written.checks.some((entry) => entry.check === "brand frame" && entry.ok));

    // Sparse pixel pacing alone does not fail our own render: the storyboard says what changes.
    adapters.styleReference = async () => ({ ...MEASURED, pacing: { duration_seconds: 60, shot_seconds: { median: 14 }, cut_rate_per_minute: 4 } });
    await writeFile(path.join(project, ".launchclip/styles/channel/style.json"), JSON.stringify({ ...PACK, description: "edited" }));
    assert.equal((await runFinish(project, { renderer: "remotion" }, adapters)).gates.style.status, "passed");

    // A storyboard slower than the style's band drifts: the gate fails and finish asks for a repair.
    const brisk = { ...PACK.profile, measures: { shot_seconds: { p10: 0.5, p50: 1, p90: 2 }, visual_changes_per_min: { p10: 30, p50: 40, p90: 60 } } };
    await writeFile(path.join(project, ".launchclip/styles/channel/style.json"), JSON.stringify({ ...PACK, profile: brisk }));
    const slow = await runFinish(project, { renderer: "remotion" }, adapters);
    assert.equal(slow.gates.style.status, "failed");
    assert.ok(slow.gates.style.findings.some((line) => /error: cadence: shot_seconds/.test(line)));
    assert.equal(slow.status, "needs-repair");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

// Shots: [{seconds, bg, boxes: [[color, x, y, w, h]]}] → one H.264 file with hard cuts.
function makeVideo(file, shots, { width = 360, height = 640 } = {}) {
  const inputs = [];
  const filters = [];
  shots.forEach((shot, index) => {
    inputs.push("-f", "lavfi", "-i", `color=c=${shot.bg}:s=${width}x${height}:r=30:d=${shot.seconds}`);
    filters.push(`[${index}:v]${shot.boxes.map(([color, x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`).join(",")},format=yuv420p[v${index}]`);
  });
  filters.push(`${shots.map((_, index) => `[v${index}]`).join("")}concat=n=${shots.length}:v=1:a=0[out]`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", file]);
}

test("two stories in one style pass style check against each other (RFC §13 phase 6)", { skip: mediaSkip(hasFfmpeg ? false : "ffmpeg is not installed"), timeout: 180_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-pair-"));
  try {
    const colors = ["0xffcc00", "0x33ccff"];
    const episode = (file, offset) => makeVideo(file, Array.from({ length: 10 }, (_, i) => ({ seconds: [1.6, 2.4][i % 2], bg: "0x102030", boxes: [[colors[(i + offset) % 2], 40 + ((i + offset) % 3) * 60, 120 + (i % 4) * 90, 150, 110], ["0xf0f0f0", 60, 470, 240, 30]] })));
    const projects = [];
    for (const [name, offset] of [["a", 0], ["b", 1]]) {
      const project = path.join(dir, name);
      await cp(MINIMAL, project, { recursive: true });
      await mkdir(path.join(project, "renders"), { recursive: true });
      episode(path.join(project, "renders/final.mp4"), offset);
      projects.push(project);
    }
    // Each episode drafts a style; each story names the other episode's style.
    const styles = [];
    for (const [i, project] of projects.entries()) {
      const drafted = await createStyleFromReferences(`episode-${i}`, { "from-reference": path.join(project, "renders/final.mp4") }, { root: path.join(dir, "styles"), cwd: dir });
      styles.push(path.join(drafted.path, "style.json"));
    }
    // Each storyboard holds the scenes its render shows: style check counts our own cadence from the storyboard.
    const storyFor = async (project, style, lengths) => {
      const story = JSON.parse(await readFile(path.join(project, "storyboard.json"), "utf8"));
      const { hits, ...template } = story.scenes[0];
      let clock = 0;
      const scenes = lengths.map((seconds, i) => { const scene = { ...template, id: `s${i + 1}`, start: Math.round(clock * 100) / 100, end: Math.round((clock + seconds) * 100) / 100 }; clock += seconds; return scene; });
      await writeFile(path.join(project, "storyboard.json"), JSON.stringify({ ...story, format: { ...story.format, duration: Math.round(clock * 100) / 100 }, scenes, style, overlays: [{ type: "captions" }], frame: { kicker: { label: "Episode" } } }));
    };
    const rhythm = Array.from({ length: 10 }, (_, i) => [1.6, 2.4][i % 2]);
    for (const [i, project] of projects.entries()) await storyFor(project, styles[1 - i], rhythm);
    for (const [i, project] of projects.entries()) {
      const check = await checkStyleCommand(project, { against: styles[1 - i] });
      assert.equal(check.status, "consistent", JSON.stringify(check.checks ?? check.story_error, null, 2));
      assert.ok(check.checks, check.story_error);
      for (const name of ["palette", "captions", "cadence: shot_seconds", "brand frame"]) assert.ok(check.checks.some((entry) => entry.check === name && entry.ok), name);
    }
    // A render in another palette and rhythm drifts.
    makeVideo(path.join(projects[0], "renders/final.mp4"), [{ seconds: 9, bg: "0xf4e9d8", boxes: [["0x8a2be2", 40, 120, 280, 300]] }, { seconds: 9, bg: "0xf4e9d8", boxes: [["0x2e8b57", 40, 220, 280, 300]] }]);
    await storyFor(projects[0], styles[1], [9, 9]);
    const drift = await checkStyleCommand(projects[0], { against: styles[1] });
    assert.equal(drift.status, "drift");
    assert.ok(drift.checks.some((entry) => entry.check === "palette" && !entry.ok), JSON.stringify(drift, null, 1));
    assert.ok(drift.checks.some((entry) => entry.check.startsWith("cadence") && !entry.ok));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
