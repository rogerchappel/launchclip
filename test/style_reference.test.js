// Mimic-a-reference analysis on synthetic videos made with ffmpeg (skipped
// when ffmpeg is not installed, like the other media tests).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { colorDistance } from "../kit/core/style.mjs";
import { boundariesFromGrayFrames, compareToStyle, detectCaptions, draftStyleFromReferences, grammarFromPacing, kmeansColors, paletteClusters } from "../src/style_reference.js";
import { checkStyleCommand, createStyleFromReferences } from "../src/style_commands.js";

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

test("drafts a pack from synthetic reference videos: palette, pacing, report, no media copied", { skip, timeout: 120_000 }, async () => {
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
    for (const heading of ["## Palette", "## Pacing → motion grammar", "## Energy → ambient", "## Captions (approximate)", "## Sound", "## Fonts"]) assert.ok(report.includes(heading), heading);
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
