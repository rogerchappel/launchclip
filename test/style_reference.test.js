// Mimic-a-reference analysis on synthetic videos made with ffmpeg (skipped
// when ffmpeg is not installed, like the other media tests).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { colorDistance, STYLE_SCHEMA, validateStylePack } from "../kit/core/style.mjs";
import { validateProfile } from "../kit/core/profiles.mjs";
import { boundariesFromGrayFrames, captionCase, captionsFromDetection, columnCase, compareToStyle, detectCaptions, detectLayouts, downsampleFrame, draftStyleFromReferences, grammarFromPacing, kmeansColors, layoutsFromDetection, overlayEventsFromGrayFrames, paletteClusters, panelShare, profileFromReferences } from "../src/style_reference.js";
import { checkStyleCommand, createStyleFromReferences } from "../src/style_commands.js";
import { mediaSkip } from "./helpers/media.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const skip = hasFfmpeg ? false : "ffmpeg is not installed";

// Shots: [{seconds, bg, boxes: [[color, x, y, w, h]]}] → one H.264 file with hard cuts.
function makeVideo(file, shots, { width = 360, height = 640 } = {}) {
  const inputs = [];
  const filters = [];
  shots.forEach((shot, index) => {
    inputs.push("-f", "lavfi", "-i", `color=c=${shot.bg}:s=${width}x${height}:r=30:d=${shot.seconds}`);
    const boxes = shot.boxes.map(([color, x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`).join(",");
    filters.push(`[${index}:v]${boxes || "null"},format=yuv420p[v${index}]`);
  });
  filters.push(`${shots.map((_, index) => `[v${index}]`).join("")}concat=n=${shots.length}:v=1:a=0[out]`);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", file]);
}

test("k-means finds the dominant and the small deliberate colours", () => {
  const pixels = [
    ...Array.from({ length: 9000 }, () => [16, 32, 48]),
    ...Array.from({ length: 700 }, () => [255, 204, 0]),
    ...Array.from({ length: 300 }, () => [240, 240, 240])
  ];
  const clusters = paletteClusters(pixels);
  assert.equal(clusters[0].hex, "#102030");
  assert.ok(Math.abs(clusters[0].weight - 0.9) < 0.01);
  assert.ok(clusters.some((entry) => colorDistance(entry.hex, "#ffcc00") < 0.02));
  assert.ok(clusters.some((entry) => colorDistance(entry.hex, "#f0f0f0") < 0.02));
  assert.deepEqual(kmeansColors(pixels), kmeansColors(pixels), "deterministic");
});

test("structural boundaries and caption bands from synthetic frames", () => {
  // 6 fps grey frames, 45x80: three 2 s scenes with a panel in a different place each.
  const w = 45, h = 80, fps = 6;
  const frames = [];
  for (let i = 0; i < 36; i += 1) {
    const frame = Buffer.alloc(w * h, 12);
    const scene = Math.floor(i / 12);
    for (let y = 10 + scene * 20; y < 26 + scene * 20; y += 1) for (let x = 5; x < 40; x += 1) frame[y * w + x] = 200;
    frames.push(frame);
  }
  const boundaries = boundariesFromGrayFrames(Buffer.concat(frames), w, h, fps);
  assert.equal(boundaries.length, 2);
  assert.ok(Math.abs(boundaries[0] - 2) < 0.35 && Math.abs(boundaries[1] - 4) < 0.35, boundaries.join(","));

  // Caption-like text: dense bright/dark alternation in the bottom band that changes per frame.
  const cw = 90, ch = 160;
  const captionFrames = Array.from({ length: 8 }, (_, f) => {
    const data = Buffer.alloc(cw * ch * 3, 10);
    for (let y = 108; y < 116; y += 1) for (let x = 10; x < 80; x += 1) {
      const on = ((x + f * 3) % 4) < 2;
      const i = (y * cw + x) * 3;
      data[i] = on ? 255 : 10; data[i + 1] = on ? (x < 30 ? 210 : 255) : 10; data[i + 2] = on ? (x < 30 ? 0 : 255) : 10;
    }
    return { width: cw, height: ch, data };
  });
  const captions = detectCaptions(captionFrames);
  assert.equal(captions.position, "bottom");
  assert.ok(captions.text_height_fraction > 0.03 && captions.text_height_fraction < 0.08);
  assert.ok(captions.highlight && colorDistance(captions.highlight, "#ffd200") < 0.12, `highlight ${captions.highlight}`);
});

test("pacing maps to a grammar", () => {
  assert.equal(grammarFromPacing({ median_shot_seconds: 0.9 }, { activity: 0.5 }).grammar, "snappy");
  assert.equal(grammarFromPacing({ median_shot_seconds: 4.5 }, { activity: 0.3 }).grammar, "editorial");
  assert.equal(grammarFromPacing({ median_shot_seconds: 9 }, { activity: 0.1 }).grammar, "documentary");
});

test("drafts a pack from synthetic reference videos: palette, pacing, report, no media copied", { skip: mediaSkip(skip), timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-ref-"));
  try {
    const fast = path.join(dir, "fast.mp4");
    const colors = ["0xffcc00", "0x33ccff"];
    makeVideo(fast, Array.from({ length: 8 }, (_, i) => ({ seconds: 0.75, bg: "0x102030", boxes: [[colors[i % 2], 40 + (i % 3) * 60, 120 + (i % 4) * 90, 150, 110], ["0xf0f0f0", 60, 470, 240, 30]] })));
    const slow = path.join(dir, "slow.mp4");
    makeVideo(slow, [{ seconds: 5, bg: "0x102030", boxes: [["0xffcc00", 60, 200, 240, 160], ["0xf0f0f0", 60, 470, 240, 30]] }, { seconds: 5, bg: "0x102030", boxes: [["0x33ccff", 60, 120, 240, 260], ["0xf0f0f0", 60, 470, 240, 30]] }]);

    const fastResult = await createStyleFromReferences("fast-cuts", { "from-reference": fast }, { root: path.join(dir, "styles"), cwd: dir });
    const pack = JSON.parse(await readFile(path.join(fastResult.path, "style.json"), "utf8"));
    assert.ok(colorDistance(pack.brand.colors.bg, "#102030") < 0.04, `bg ${pack.brand.colors.bg}`);
    assert.ok(colorDistance(pack.brand.colors.paper, "#f0f0f0") < 0.06, `paper ${pack.brand.colors.paper}`);
    assert.ok([pack.brand.colors.primary, pack.brand.colors.accent].some((hex) => colorDistance(hex, "#ffcc00") < 0.08), `primary/accent ${pack.brand.colors.primary} ${pack.brand.colors.accent}`);
    assert.ok([pack.brand.colors.primary, pack.brand.colors.accent].some((hex) => colorDistance(hex, "#33ccff") < 0.08));
    assert.equal(pack.motion.grammar, "snappy");
    assert.ok(Math.abs(pack.reference_stats.pacing.median_shot_seconds - 0.75) < 0.3, `median ${pack.reference_stats.pacing.median_shot_seconds}`);
    assert.deepEqual((await readdir(fastResult.path)).sort(), ["reference-report.md", "style.json"], "reference media is never copied into the pack");
    assert.equal(pack.references[0].name, "fast.mp4");
    assert.match(pack.references[0].sha256, /^[0-9a-f]{64}$/);
    const report = await readFile(fastResult.report, "utf8");
    for (const heading of ["## Palette", "## Pacing → motion grammar", "## Energy → ambient", "## Captions (approximate)", "## Layouts (approximate)", "## Cadence profile", "## Sound", "## Fonts"]) assert.ok(report.includes(heading), heading);
    assert.equal(pack.schema, STYLE_SCHEMA);
    assert.deepEqual(validateStylePack(pack).errors, []);
    assert.deepEqual(validateProfile(pack.profile).errors, []);
    assert.equal(pack.profile.references, 1);
    assert.ok(Math.abs(pack.profile.measures.shot_seconds.p50 - 0.75) < 0.3, JSON.stringify(pack.profile.measures.shot_seconds));
    assert.ok(pack.profile.measures.visual_changes_per_min.p50 > 30);
    assert.equal(pack.reference_stats.layout_mix.full, 1, "flat synthetic shots with boxes are full-frame");
    assert.equal(fastResult.inferred.profile.id, "fast-cuts-references");
    assert.match(report, /confidence/);

    const slowResult = await createStyleFromReferences("slow-cuts", { "from-reference": slow }, { root: path.join(dir, "styles"), cwd: dir });
    const slowPack = JSON.parse(await readFile(path.join(slowResult.path, "style.json"), "utf8"));
    assert.ok(slowPack.reference_stats.pacing.median_shot_seconds > 4, `slow median ${slowPack.reference_stats.pacing.median_shot_seconds}`);
    assert.notEqual(slowPack.motion.grammar, "snappy");

    // Drift: the slow render checked against the fast pack drifts on pacing.
    const project = path.join(dir, "project");
    execFileSync("mkdir", ["-p", path.join(project, "renders")]);
    execFileSync("cp", [slow, path.join(project, "renders", "final.mp4")]);
    const check = await checkStyleCommand(project, { against: path.join(fastResult.path, "style.json") });
    assert.equal(check.status, "drift");
    assert.ok(check.metrics.some((metric) => metric.metric.startsWith("median shot") && !metric.ok));
    assert.ok(check.metrics.find((metric) => metric.metric === "palette distance").ok, "same palette");
    const same = await checkStyleCommand(project, { against: path.join(slowResult.path, "style.json") });
    assert.equal(same.status, "consistent", JSON.stringify(same.metrics));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compareToStyle without reference stats falls back to palette and grammar", () => {
  const measured = { palette: [{ hex: "#101010", weight: 0.9 }, { hex: "#ffcc00", weight: 0.1 }], pacing: { shot_seconds: { median: 1 }, cut_rate_per_minute: 60 } };
  const result = compareToStyle(measured, { brand: { colors: { bg: "#101010", primary: "#ffcc00" } }, motion: { grammar: "documentary" } });
  assert.equal(result.status, "drift");
  assert.ok(result.metrics.find((metric) => metric.metric === "palette distance").ok);
  assert.equal(draftStyleFromReferences("x", [{ kind: "image", name: "a.png", sha256: "0".repeat(64), width: 1, height: 1, palette: measured.palette }]).pack.motion.grammar, "editorial");
});

// 160x90 RGB frames: footage-like noise on one side, a flat panel on the other.
function layoutFrame(kind, seed) {
  const w = 160, h = 90, data = Buffer.alloc(w * h * 3);
  let state = seed * 9973 + 17;
  const noise = () => { state = (state * 1103515245 + 12345) % 2147483648; return state % 200; };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const border = x < 13 || x >= 147 || y < 8 || y >= 82;
    const flat = kind === "split-right" ? x >= 88 : kind === "split-left" ? x < 72 : kind === "framed" ? border : false;
    const v = flat ? 40 : 30 + noise();
    const i = (y * w + x) * 3;
    data[i] = v; data[i + 1] = flat ? 60 : v; data[i + 2] = flat ? 120 : v;
  }
  return { width: w, height: h, data };
}

test("layout mix from persistent flat panels beside footage", () => {
  const kinds = ["full", "full", "split-right", "split-right", "split-right", "full", "framed", "framed", "split-left", "full"];
  const result = detectLayouts(kinds.map((kind, i) => layoutFrame(kind, i + 1)));
  assert.deepEqual(result.frames, [...kinds.slice(0, 8), "full", "full"], "a one-sample panel is not a layout");
  assert.deepEqual(result.mix, { full: 0.5, "split-right": 0.3, framed: 0.2 });
  assert.equal(result.changes, 4);
  const drafted = layoutsFromDetection([result]);
  assert.equal(drafted.layouts.by_intent.list, "split-right");
  assert.equal(drafted.layouts.by_intent.product, "framed");
  assert.equal(layoutsFromDetection([null]).mix, null);
});

test("caption case from the shape of the text rows, and the quiet preset for sentence case", () => {
  // Edge density per row: capitals are as dense at the top of the line as in the middle; lowercase is not.
  const band = { y0: 0, y1: 40 };
  const rows = (top) => Float64Array.from({ length: 40 }, (_, y) => (y < 10 || y >= 30 ? 0 : y < 15 ? top : 0.4));
  assert.equal(captionCase([rows(0.4), rows(0.38)], band).case, "upper");
  assert.equal(captionCase([rows(0.1), rows(0.12)], band).case, "as-is");
  assert.equal(captionCase([rows(0.26)], band).case, null);
  assert.equal(captionCase([Float64Array.from({ length: 40 })], band).case, null);
  const sentence = { position: "bottom", confidence: 0.5, text_height_fraction: 0.03, highlight: "#ffcc00", case: "as-is", case_ratio: 0.2 };
  assert.equal(captionsFromDetection([sentence], []).captions.preset, "quiet-accent");
  assert.equal(captionsFromDetection([{ ...sentence, highlight: null }], []).captions.preset, "minimal-line");
  assert.equal(captionsFromDetection([{ ...sentence, case: "upper" }], []).captions.preset, "word-highlight");
  assert.deepEqual(captionsFromDetection([sentence], []).treatment, { position: "bottom", case: "as-is", highlight: true, size: 0.71, preset: "quiet-accent" });
});

test("a cadence profile from references: shots pooled, changes per 30 s window", () => {
  const reference = (boundaries, duration, layouts) => ({ kind: "video", name: "r.mp4", width: 1920, height: 1080, duration_seconds: duration, pacing: { duration_seconds: duration, boundaries }, layouts });
  const profile = profileFromReferences("mine", [
    reference([2, 4, 6, 8, 30, 32, 34, 50], 60, { frames: ["full"], changes: 3 }),
    reference([5, 10, 15], 20, { frames: ["full"], changes: 1 }),
    { kind: "image", name: "still.png", width: 10, height: 10 }
  ]);
  assert.deepEqual(validateProfile(profile), { ok: true, errors: [], warnings: [] });
  assert.equal(profile.id, "mine-references");
  assert.equal(profile.format, "footage-led");
  assert.equal(profile.references, 2);
  assert.deepEqual(profile.provenance.sources.map((source) => [source.id, source.rights]), [["ref-01", "own"], ["ref-02", "own"]]);
  assert.deepEqual(profile.duration_seconds, [20, 61]);
  assert.equal(profileFromReferences("x", [reference([1], 10, null)], { format: "motion", rights: "licensed" }).provenance.sources[0].rights, "licensed");
  assert.deepEqual(Object.keys(profile.measures), ["shot_seconds", "visual_changes_per_min", "layout_changes_per_min"]);
  assert.equal(profile.measures.shot_seconds.p50, 5, "the median of 13 pooled shots (six of 2 s, four of 5 s, 10, 16, 22)");
  assert.deepEqual(profile.measures.layout_changes_per_min, { p10: 3, p50: 3, p90: 3 });
  for (const range of Object.values(profile.measures)) assert.ok(range.p10 <= range.p50 && range.p50 <= range.p90);
  assert.equal(profileFromReferences("none", [{ kind: "image" }]), null);
});

// 480x270 RGB frames like the approved reference: a dark warm panel with a
// card and text on one side, the presenter (grainy, with a smooth shirt) on
// the other, and a short left-aligned caption that changes per sample.
function referenceFrame({ panel = null, caption = null, sign = 0, seed = 1 } = {}) {
  const w = 480, h = 270, data = Buffer.alloc(w * h * 3);
  let state = seed * 7919 + 3;
  const grain = () => { state = (state * 1103515245 + 12345) % 2147483648; return (state >> 8) % 40; };
  const set = (x, y, [r, g, b]) => { const i = (y * w + x) * 3; data[i] = r; data[i + 1] = g; data[i + 2] = b; };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const inPanel = panel === "right" ? x >= 250 : panel === "left" ? x < 230 : false;
    if (inPanel) { set(x, y, [24, 20, 18]); continue; }
    // Footage: a grainy room, and a shirt that is smooth but shaded.
    const shirt = Math.abs(x - (panel === "right" ? 120 : panel === "left" ? 360 : 240)) < 70 && y > 150;
    const v = shirt ? 70 + Math.round((y - 150) * 0.35 + (x % 97) * 0.2) : 40 + grain() + ((x * 3 + y) % 50);
    set(x, y, [v, v + 6, v - 4]);
  }
  if (panel) {
    const x0 = panel === "right" ? 280 : 30;
    for (let y = 90; y < 170; y += 1) for (let x = x0; x < x0 + 170; x += 1) set(x, y, [44, 38, 34]);
    for (let y = 110; y < 116; y += 1) for (let x = x0 + 10; x < x0 + 150; x += 1) if (x % 4 < 2) set(x, y, [230, 230, 230]);
  }
  // A sign in the room: held text that moves with the footage.
  for (let y = 30; y < 38; y += 1) for (let x = 60 + sign; x < 130 + sign; x += 1) if (x % 5 < 2) set(x, y, [235, 235, 235]);
  if (caption !== null) {
    const x0 = panel === "right" ? 40 : panel === "left" ? 260 : 40;
    for (let y = 212; y < 220; y += 1) for (let x = x0; x < x0 + 70; x += 1) {
      const on = ((x + caption * 7) % 6) < 2 && (x + caption * 13) % 23 > 3;
      if (on) set(x, y, x > x0 + 50 ? [251, 120, 20] : [240, 240, 236]);
    }
  }
  return { at: seed, width: w, height: h, data };
}

test("splits from a panel side with cards on it beside footage, even with a smooth shirt", () => {
  const right = referenceFrame({ panel: "right" });
  assert.ok(panelShare(right, 288, 480, 0, 270) >= 0.6, "the panel side");
  assert.ok(panelShare(right, 0, 192, 0, 270) <= 0.4, "the footage side, shirt included");
  const kinds = [null, null, "right", "right", "right", "left", "left", null, null, "right"];
  const result = detectLayouts(kinds.map((panel, i) => referenceFrame({ panel, seed: i + 1 })));
  assert.deepEqual(result.frames, ["full", "full", "split-right", "split-right", "split-right", "split-left", "split-left", "full", "full", "full"]);
  assert.equal(result.changes, 3, "into the right split, across to the left, back to full");
});

test("captions: a short line whose words change, not a sign that holds or moves with the footage", () => {
  const panels = [null, null, "right", "right", "left", "left", null, null];
  const frames = panels.map((panel, i) => referenceFrame({ panel, caption: i, sign: panel ? 40 : 0, seed: i + 1 }));
  const layouts = detectLayouts(frames).frames;
  const captions = detectCaptions(frames, { layouts });
  assert.equal(captions.position, "bottom");
  assert.ok(Math.abs(captions.y - 0.8) < 0.03, `y ${captions.y}`);
  assert.equal(captions.change, 1);
  assert.ok(captions.highlight && colorDistance(captions.highlight, "#fb7814") < 0.12, `highlight ${captions.highlight}`);
  const sign = captions.bands.find((band) => band.y < 0.2);
  assert.ok(!sign || sign.change === 0, `the sign holds within a layout: ${JSON.stringify(sign)}`);
  // Without changing words there are no captions.
  assert.equal(detectCaptions(panels.map((panel, i) => referenceFrame({ panel, caption: 0, seed: i + 1 })), { layouts }).position, null);
});

test("caption case from letter-column tops across lines of one size", () => {
  // base 40; capitals start at the cap height (top 20); lowercase at the x-height (26), ascenders at 20.
  const line = (tops) => ({ tops, base: 40 });
  const upper = columnCase([line(Array(60).fill(20)), line([...Array(50).fill(20), ...Array(4).fill(30)]), line(Array(40).fill(21))]);
  assert.equal(upper.case, "upper");
  const lower = columnCase([line([...Array(50).fill(26), ...Array(8).fill(20)]), line(Array(60).fill(26)), line([...Array(40).fill(27), ...Array(10).fill(20)])]);
  assert.equal(lower.case, "as-is", "a line with no tall letters reads against the others' height");
  assert.equal(columnCase([line(Array(20).fill(20))]).case, null, "one line cannot tell");
});

test("overlay events: a card appearing and leaving over moving footage, not a moving hand", () => {
  const w = 160, h = 90, fps = 10, frames = [];
  let state = 5;
  const grain = () => { state = (state * 1103515245 + 12345) % 2147483648; return (state >> 8) % 24; };
  for (let f = 0; f < 80; f += 1) {
    const frame = Buffer.alloc(w * h);
    const t = f / fps;
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      let v = 60 + grain();
      // A hand sweeping back and forth across the right of the frame.
      if (Math.abs(x - (120 + Math.round(25 * Math.sin(t * 3)))) < 8 && y > 40) v = 170;
      // A card from 2 s to 5 s.
      if (t >= 2 && t < 5 && x >= 10 && x < 70 && y >= 10 && y < 50) v = 210;
      frame[y * w + x] = v;
    }
    frames.push(frame);
  }
  const events = overlayEventsFromGrayFrames(Buffer.concat(frames), w, h, fps);
  assert.equal(events.length, 2, events.join(","));
  assert.ok(Math.abs(events[0] - 2) <= 0.2 && Math.abs(events[1] - 5) <= 0.2, events.join(","));
  assert.deepEqual(overlayEventsFromGrayFrames(Buffer.concat(frames), w, h, fps, { exclude: [0, 0.6] }), [], "a card inside the excluded band is left out");
});

test("downsampleFrame averages blocks", () => {
  const data = Buffer.alloc(4 * 2 * 3);
  for (let i = 0; i < 4 * 3; i += 1) data[i] = 200;
  const half = downsampleFrame({ at: 1, width: 4, height: 2, data }, 2);
  assert.equal(half.width, 2);
  assert.equal(half.height, 2);
  assert.equal(half.data[0], 200);
  assert.equal(half.data[2 * 3], 0);
});
