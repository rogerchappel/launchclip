#!/usr/bin/env node
// Subject stage model bake-off (docs/SUBJECT_EFFECTS_RFC.md §4.2).
//
//   node scripts/subject-bakeoff.mjs --clips a.mp4,b.mp4 [--models modnet,mediapipe-selfie,u2net-human]
//     [--variants modnet@0.3] [--key green.mp4] [--frames 90] [--models-dir dir] [--out qa/subject/bakeoff]
//
// For every model (and smoothing variant) on every clip it measures:
//   ms_per_frame   inference plus mask scaling at the clip's resolution
//   flicker        mean |alpha(t) − alpha(t−1)| over the frame, in % (motion adds
//                  the same amount for every model, so compare across a row)
//   stability      summarizeSamples' coverage stability over the frames
//   people         the mode of maskStats' person count
// and, on the --key clip, agreement with a chroma-key reference matte:
//   iou            intersection over union at alpha 128
//   edge_error     mean |alpha − reference| in % within 12 px of the reference edge
// It writes report.json, report.md and sheet-<clip>.png (source | one column per
// model, composited on magenta) under --out. Clips and renders stay local.

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { maskStats, summarizeSamples } from "../kit/core/subject.mjs";
import { readFrames } from "../src/subject/frames.js";
import { ensureModel, subjectModel } from "../src/subject/models.js";
import { createSegmenter } from "../src/subject/segment.js";
import { describeSource } from "../src/subject/stage.js";

const args = parseArgs(process.argv.slice(2));
const clips = list(args.clips);
if (!clips.length) throw new Error("--clips a.mp4,b.mp4 is required");
const variants = [...list(args.models ?? "modnet,mediapipe-selfie,u2net-human"), ...list(args.variants)].map(parseVariant);
const maxFrames = Number(args.frames ?? 90);
const out = path.resolve(args.out ?? "qa/subject/bakeoff");
const sheetTimes = [1, 3, 5];
const SHEET_WIDTH = 270;
await mkdir(out, { recursive: true });

const results = [];
for (const clip of clips) {
  const source = await describeSource(clip);
  const name = path.basename(clip, path.extname(clip));
  const reference = args.key && path.resolve(args.key) === path.resolve(clip) ? await chromaReference(clip, source, maxFrames) : null;
  const sheet = { source: [], columns: [] };
  sheet.source = await sheetFrames(clip, source, null);
  for (const variant of variants) {
    const label = `${variant.id}${variant.shortEdge ? `:${variant.shortEdge}` : ""}${variant.smooth ? `@${variant.smooth}` : ""}`;
    const file = await ensureModel(variant.id, { ...(args["models-dir"] ? { dir: path.resolve(args["models-dir"]) } : {}), log: (line) => console.error(line) });
    const segmenter = await createSegmenter(variant.id, file, { smooth: variant.smooth, shortEdge: variant.shortEdge });
    const statsSize = { width: 270, height: Math.round((270 * source.height) / source.width / 2) * 2 };
    const samples = [];
    let previous = null;
    let flicker = 0;
    let ms = 0;
    let iou = 0;
    let edge = 0;
    let index = 0;
    const columnFrames = [];
    for await (const frame of readFrames(clip, { start: 0, duration: maxFrames / source.fps, width: source.width, height: source.height })) {
      const began = performance.now();
      const alpha = await segmenter.segment(frame, source.width, source.height);
      ms += performance.now() - began;
      const small = downscale(alpha, source.width, source.height, statsSize);
      samples.push({ t: index / source.fps, ...maskStats(small, statsSize.width, statsSize.height) });
      if (previous) flicker += meanAbs(small, previous);
      previous = small;
      if (reference?.[index]) {
        const scored = compare(small, reference[index], statsSize);
        iou += scored.iou;
        edge += scored.edge;
      }
      const at = sheetTimes.findIndex((t) => Math.round(t * source.fps) === index);
      if (at >= 0) columnFrames[at] = composite(frame, alpha, source, SHEET_WIDTH);
      index += 1;
    }
    await segmenter.release();
    const summary = summarizeSamples(samples);
    const row = {
      clip: name, model: label, licence: subjectModel(variant.id).licence, frames: index,
      ms_per_frame: round(ms / index, 1), flicker: round((flicker / Math.max(1, index - 1)) * 100, 3),
      stability: summary.stability, people: summary.people, framing: summary.framing, coverage: summary.coverage,
      ...(reference ? { iou: round(iou / index, 4), edge_error: round((edge / index) * 100, 2) } : {})
    };
    results.push(row);
    sheet.columns.push({ label, frames: columnFrames });
    console.error(`${name} · ${label}: ${row.ms_per_frame} ms/frame, flicker ${row.flicker}%${reference ? `, IoU ${row.iou}, edge ${row.edge_error}%` : ""}`);
  }
  await writeSheet(path.join(out, `sheet-${name}.png`), sheet, source);
}

await writeFile(path.join(out, "report.json"), `${JSON.stringify({ generated_at: new Date().toISOString(), frames_per_clip: maxFrames, results }, null, 2)}\n`);
await writeFile(path.join(out, "report.md"), markdown(results));
console.log(path.join(out, "report.md"));

// ---------------------------------------------------------------------------

async function chromaReference(clip, source, frames) {
  const size = { width: 270, height: Math.round((270 * source.height) / source.width / 2) * 2 };
  const [first] = await collect(readFrames(clip, { start: 0, duration: 1 / source.fps, width: size.width, height: size.height }));
  const key = cornerColour(first, size.width);
  const filter = `chromakey=0x${key}:${args["key-similarity"] ?? 0.13}:0.04,format=yuva420p,alphaextract,scale=${size.width}:${size.height}:flags=area`;
  const raw = await runCapture("ffmpeg", ["-v", "error", "-t", String(frames / source.fps), "-i", clip, "-vf", filter, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
  const frameBytes = size.width * size.height;
  const masks = [];
  for (let offset = 0; offset + frameBytes <= raw.length; offset += frameBytes) masks.push(raw.subarray(offset, offset + frameBytes));
  return masks;
}

function cornerColour(rgb, width) {
  const sums = [0, 0, 0];
  let count = 0;
  for (let y = 4; y < 24; y += 1) for (let x = 4; x < 24; x += 1) {
    for (let c = 0; c < 3; c += 1) sums[c] += rgb[(y * width + x) * 3 + c];
    count += 1;
  }
  return sums.map((sum) => Math.round(sum / count).toString(16).padStart(2, "0")).join("");
}

function compare(alpha, reference, size) {
  let intersection = 0;
  let union = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  const band = 3; // 12 px at 1080 wide ≈ 3 px at 270
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const i = y * size.width + x;
      const a = alpha[i] >= 128;
      const r = reference[i] >= 128;
      if (a && r) intersection += 1;
      if (a || r) union += 1;
      if (nearEdge(reference, size, x, y, band)) {
        edgeSum += Math.abs(alpha[i] - reference[i]) / 255;
        edgeCount += 1;
      }
    }
  }
  return { iou: union ? intersection / union : 1, edge: edgeCount ? edgeSum / edgeCount : 0 };
}

function nearEdge(mask, size, x, y, band) {
  const inside = mask[y * size.width + x] >= 128;
  for (let dy = -band; dy <= band; dy += band) for (let dx = -band; dx <= band; dx += band) {
    const nx = Math.min(size.width - 1, Math.max(0, x + dx));
    const ny = Math.min(size.height - 1, Math.max(0, y + dy));
    if ((mask[ny * size.width + nx] >= 128) !== inside) return true;
  }
  return false;
}

async function sheetFrames(clip, source) {
  const frames = [];
  const height = sheetHeight(source);
  for (const t of sheetTimes) {
    const [frame] = await collect(readFrames(clip, { start: t, duration: 1 / source.fps, width: SHEET_WIDTH, height }));
    frames.push(frame);
  }
  return frames;
}

// The frame over magenta, scaled to the sheet width.
function composite(frame, alpha, source, width) {
  const height = sheetHeight(source);
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(source.height - 1, Math.floor(((y + 0.5) * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(source.width - 1, Math.floor(((x + 0.5) * source.width) / width));
      const i = sy * source.width + sx;
      const a = alpha[i] / 255;
      const o = (y * width + x) * 3;
      out[o] = Math.round(frame[i * 3] * a + 255 * (1 - a));
      out[o + 1] = Math.round(frame[i * 3 + 1] * a);
      out[o + 2] = Math.round(frame[i * 3 + 2] * a + 255 * (1 - a));
    }
  }
  return out;
}

async function writeSheet(file, sheet, source) {
  const height = sheetHeight(source);
  const columns = [sheet.source, ...sheet.columns.map((column) => column.frames)];
  const width = SHEET_WIDTH * columns.length;
  const buffer = Buffer.alloc(width * height * sheetTimes.length * 3);
  columns.forEach((frames, column) => {
    frames.forEach((frame, row) => {
      if (!frame) return;
      for (let y = 0; y < height; y += 1) frame.copy(buffer, ((row * height + y) * width + column * SHEET_WIDTH) * 3, y * SHEET_WIDTH * 3, (y + 1) * SHEET_WIDTH * 3);
    });
  });
  await runCapture("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${width}x${height * sheetTimes.length}`, "-i", "pipe:0", "-frames:v", "1", file], buffer);
}

function markdown(rows) {
  const keyed = rows.some((row) => row.iou !== undefined);
  const lines = ["# Subject model bake-off", "", `| Clip | Model | ms/frame | Flicker % | Stability | People | Framing${keyed ? " | IoU | Edge error %" : ""} |`, `|---|---|---|---|---|---|---${keyed ? "|---|---" : ""}|`];
  for (const row of rows) lines.push(`| ${row.clip} | ${row.model} | ${row.ms_per_frame} | ${row.flicker} | ${row.stability} | ${row.people} | ${row.framing ?? "—"}${keyed ? ` | ${row.iou ?? ""} | ${row.edge_error ?? ""}` : ""} |`);
  return `${lines.join("\n")}\n`;
}

function downscale(alpha, width, height, size) {
  const out = new Uint8Array(size.width * size.height);
  for (let y = 0; y < size.height; y += 1) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size.height));
    for (let x = 0; x < size.width; x += 1) out[y * size.width + x] = alpha[sy * width + Math.min(width - 1, Math.floor(((x + 0.5) * width) / size.width))];
  }
  return out;
}

function meanAbs(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

async function collect(iterator) {
  const items = [];
  for await (const item of iterator) items.push(Buffer.from(item));
  return items;
}

function runCapture(command, commandArgs, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${command} failed: ${stderr.trim()}`))));
    if (input) child.stdin.end(input);
  });
}

function sheetHeight(source) {
  return Math.round((SHEET_WIDTH * source.height) / source.width / 2) * 2;
}

// "modnet", "modnet@0.3" (smoothing) or "modnet:384@0.3" (inference short edge).
function parseVariant(value) {
  const [head, smooth] = String(value).split("@");
  const [id, shortEdge] = head.split(":");
  return { id, smooth: Number(smooth ?? 0), ...(shortEdge ? { shortEdge: Number(shortEdge) } : {}) };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) parsed[argv[i].replace(/^--/, "")] = argv[i + 1];
  return parsed;
}

function list(value) {
  return value ? String(value).split(",").map((entry) => entry.trim()).filter(Boolean) : [];
}

function round(value, places) {
  return Math.round(value * 10 ** places) / 10 ** places;
}
