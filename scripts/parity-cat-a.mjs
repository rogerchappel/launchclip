#!/usr/bin/env node
// Throwaway parity verifier for catalogue A, used until scripts/parity.mjs
// lands. For each fixture {story, sceneId, threshold?}, it renders that one
// scene in HyperFrames (a single-module project: root data-composition-id and
// a paused GSAP 3.14.2 timeline on window.__timelines, stills from
// `hyperframes snapshot`) and in Remotion (ModuleReview from
// test/fixtures/parity-entry-cat-a/entry.tsx, stills through the same
// renderStill() that `remotion still` uses), then compares the pairs with
// ffmpeg ssim and writes side-by-side PNGs plus report.json.
//
//   node scripts/parity-cat-a.mjs test/fixtures/parity/a-cat-*.json [--out .tmp/parity-cat-a]
//
// Sample times: enter-mid, settle, every event + 0.4 s, exit-mid (snapped to
// frames). Exits 1 when any pair is below its SSIM threshold (default 0.97).
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MODULES } from "../kit/core/catalog-a.mjs";
import { EMITTERS } from "../kit/hyperframes/catalog-a.mjs";
import { hyperframesInvocation } from "../src/toolchain.js";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "test", "fixtures", "parity-entry-cat-a", "entry.tsx");
const GSAP = path.join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js");

export function sceneContext(story, scene) {
  const format = story.format;
  return {
    id: scene.id, start: Number(scene.start), duration: Number(scene.end) - Number(scene.start),
    format: { width: format.width, height: format.height, fps: format.fps, duration: format.duration },
    brand: story.brand, aspect: format.height > format.width ? "9:16" : "16:9"
  };
}

export function sampleTimes(model) {
  const fps = model.fps, last = model.end - 1 / fps;
  const snap = (t) => Math.min(last, Math.max(model.start, Math.round(t * fps) / fps));
  const times = [
    ["enter-mid", model.start + (model.motion.enterEnd - model.start) / 2],
    ["settle", Math.min(model.motion.enterEnd + .1, model.motion.exitStart - .05)]
  ];
  for (const event of model.events) if (event.time + .4 < model.motion.exitStart) times.push([`${event.id.slice(model.id.length + 1)}+0.4`, event.time + .4]);
  times.push(["exit-mid", model.motion.exitStart + (model.end - model.motion.exitStart) / 2]);
  const seen = new Set();
  return times.map(([label, t]) => ({ label, t: snap(t) })).filter(({ t }) => !seen.has(t) && seen.add(t)).sort((a, b) => a.t - b.t);
}

export function hyperframesProject(story, model) {
  const { html, css, motion } = EMITTERS[model.module](model);
  const { width, height, duration } = story.format;
  const bg = story.brand.colors.bg;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<script src="gsap.min.js"></script>
<style>html,body{margin:0;padding:0;background:${bg}}#main{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${bg}}${css}</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">${html}</div>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
${motion}
tl.set({}, {}, ${duration});
window.__timelines.main = tl;
</script>
</body>
</html>
`;
}

async function ssim(a, b) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"], { maxBuffer: 1 << 24 });
  const match = /All:([0-9.]+)/.exec(stderr);
  if (!match) throw new Error(`ffmpeg ssim produced no score for ${a}`);
  return Number(match[1]);
}

async function sideBySide(a, b, out) {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", a, "-i", b, "-filter_complex", "[0][1]hstack=inputs=2,scale=iw/2:-1", "-frames:v", "1", out]);
}

let bundled = null;
async function remotionStills(story, scene, frames, outDir) {
  const { bundle } = await import("@remotion/bundler");
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  bundled ??= await bundle({ entryPoint: ENTRY, onProgress: () => {} });
  const inputProps = { scene, story };
  const composition = await selectComposition({ serveUrl: bundled, id: "ModuleReview", inputProps, logLevel: "error" });
  const files = [];
  for (const frame of frames) {
    const output = path.join(outDir, `rm-${String(frame).padStart(4, "0")}.png`);
    await renderStill({ composition, serveUrl: bundled, output, frame, inputProps, imageFormat: "png", logLevel: "error", overwrite: true });
    files.push(output);
  }
  return files;
}

async function hyperframesStills(projectDir, times, outDir) {
  const frames = path.join(projectDir, "snapshots");
  await rm(frames, { recursive: true, force: true });
  // Nudge each time 0.4 ms past its frame: snapshot floors seconds × fps, so
  // 7/30 written as 0.2333 would land on frame 6.
  const invocation = hyperframesInvocation(["snapshot", "--at", times.map((t) => (t + 4e-4).toFixed(4)).join(","), "--no-end", "--output", frames, "--describe", "false", projectDir]);
  await run(invocation.command, invocation.args, { cwd: projectDir, maxBuffer: 1 << 26 });
  const files = (await readdir(frames)).filter((name) => /\.png$/i.test(name)).sort();
  if (files.length !== times.length) throw new Error(`hyperframes snapshot wrote ${files.length} frames for ${times.length} times`);
  const out = [];
  for (const [index, name] of files.entries()) {
    const target = path.join(outDir, `hf-${String(index).padStart(2, "0")}.png`);
    await copyFile(path.join(frames, name), target);
    out.push(target);
  }
  return out;
}

export async function verifyFixture(file, { out } = {}) {
  const fixture = JSON.parse(await readFile(file, "utf8"));
  const { story, sceneId } = fixture;
  const scene = story.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error(`${file}: no scene ${sceneId}`);
  const model = MODULES[scene.module].resolve(scene.params ?? {}, sceneContext(story, scene));
  const name = path.basename(file, ".json");
  const outDir = path.resolve(out ?? path.join(ROOT, ".tmp", "parity-cat-a"), name);
  const projectDir = path.join(outDir, "hf-project");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(projectDir, { recursive: true });
  await copyFile(GSAP, path.join(projectDir, "gsap.min.js"));
  await writeFile(path.join(projectDir, "index.html"), hyperframesProject(story, model));
  const samples = sampleTimes(model);
  const hf = await hyperframesStills(projectDir, samples.map((s) => s.t), outDir);
  const rm_ = await remotionStills(story, scene, samples.map((s) => Math.round((s.t - model.start) * model.fps)), outDir);
  const threshold = fixture.threshold?.ssim ?? 0.97;
  const results = [];
  for (const [index, sample] of samples.entries()) {
    const score = await ssim(hf[index], rm_[index]);
    const side = path.join(outDir, `side-${String(index).padStart(2, "0")}-${sample.label.replace(/[^a-z0-9+.-]/gi, "_")}.png`);
    await sideBySide(hf[index], rm_[index], side);
    results.push({ ...sample, ssim: score, pass: score >= threshold, side });
  }
  const report = { fixture: file, module: model.module, sceneId, threshold, results, pass: results.every((r) => r.pass) };
  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : undefined;
  let failed = false;
  for (const file of args) {
    try {
      const report = await verifyFixture(file, { out });
      for (const r of report.results) console.log(`${report.module.padEnd(16)} ${r.label.padEnd(18)} t=${r.t.toFixed(3)} ssim=${r.ssim.toFixed(4)} ${r.pass ? "ok" : "FAIL"}`);
      failed ||= !report.pass;
    } catch (error) {
      console.error(`${file}: ${error.stack ?? error.message}`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
}
