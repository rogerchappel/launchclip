// launchclip fx <video> <module>: the quick path for "put a masthead on the
// first six seconds" (docs/SUBJECT_EFFECTS_RFC.md §8.1). It builds a
// one-scene footage-led story around the whole clip, mattes the presenter for
// that scene when the module needs them, and runs finish. A thin wrapper over
// story + subject + finish, not a second engine: the project it leaves behind
// is an ordinary story project you can keep editing.
//
//   <out>/
//     assets/<video>          the clip (linked or copied)
//     NARRATION.json          the clip's words, only when --at/--until use word: anchors
//     storyboard.json         one scene: the module over [at, until]
//     renders/draft.mp4       the clip with the effect (finish)

import { copyFile, link, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { knownModules, resolveModule } from "@launchclip/core/modules.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { readProjectStory } from "./story_loader.js";
import { plannedSubjectRanges } from "./subject/plan.js";
import { fileProjectMatte } from "./subject/project.js";
import { describeSource, runSubjectMatte } from "./subject/stage.js";

export const FX_WORDS = "NARRATION.json";
const DEFAULT_SECONDS = 4;
const MAX_SHORT_EDGE = 1080;

/**
 * options: {at, until, for, params (object), layer, captions, style,
 *   renderer, quality, out, music, download}
 * adapters: {describe, transcribe, matte, finish, log}
 * → a JSON-ready report.
 */
export async function runFx(video, module, options = {}, adapters = {}) {
  const log = adapters.log ?? (() => {});
  if (!video) throw new Error("launchclip fx needs a video: launchclip fx clip.mp4 masthead --params '{\"word\":\"Ledgerly\"}'");
  if (!module) throw new Error(`launchclip fx needs a module after the video; one of ${knownModules().join(", ")}`);
  if (!knownModules().includes(module)) throw new Error(`Unknown module ${module}; one of ${knownModules().join(", ")}`);
  const src = path.resolve(video);
  if (!existsSync(src)) throw new Error(`No such video: ${video}`);
  const source = await (adapters.describe ?? describeSource)(src);
  const project = path.resolve(options.out ?? path.join(path.dirname(src), `${path.parse(src).name}.fx`));
  const name = path.basename(src).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const base = `assets/${name}`;
  await mkdir(path.join(project, "assets"), { recursive: true });
  await linkOrCopy(src, path.join(project, base));

  const duration = Math.floor(Number(source.duration) * 1000) / 1000;
  const start = options.at ?? 0;
  const end = options.until ?? (typeof start === "number" && options.for !== undefined ? round3(start + Number(options.for)) : typeof start === "number" ? round3(Math.min(duration, start + DEFAULT_SECONDS)) : null);
  if (end === null) throw new Error("--at is a word anchor, so give --until (seconds or word:<text>) as well");
  // Word anchors and captions need the clip's words.
  const audio = {};
  if ([start, end].some((value) => typeof value === "string") || options.captions) {
    const words = await transcribe(src, adapters, log);
    await writeFile(path.join(project, FX_WORDS), `${JSON.stringify({ schema_version: "launchclip.narration.v1", provider: "recording", text: words.map((word) => word.text).join(" "), duration_seconds: duration, words }, null, 2)}\n`);
    audio.words = FX_WORDS;
  }

  const scene = { id: "fx", module, track: 1, start, end, ...(options.layer ? { layer: options.layer } : {}), ...(options.params && Object.keys(options.params).length ? { params: options.params } : {}) };
  const story = {
    schema: "launchclip.story.v1",
    title: `${module} on ${path.basename(src)}`,
    lane: "footage-led",
    format: { ...canvasFor(source), fps: Math.round(Number(source.fps) || 30), duration },
    ...(options.style ? { style: options.style } : { brand: DEFAULT_BRAND }),
    ...(Object.keys(audio).length ? { audio } : {}),
    base: { src: base, fit: "cover", volume: 1 },
    scenes: [scene],
    overlays: options.captions ? [{ type: "captions", style: options.captions }] : []
  };
  await writeFile(path.join(project, "storyboard.json"), `${JSON.stringify(story, null, 2)}\n`);

  // Validate before any matting or rendering (the loader merges the style
  // and reads the words the anchors need).
  let resolved;
  try {
    ({ resolved } = await readProjectStory(project));
    resolveModule(resolved.scenes[0], resolved);
  } catch (error) {
    throw new Error(`the ${module} scene does not fit this clip: ${String(error?.message ?? error).replace(/^storyboard\.json is invalid: /, "")}`);
  }

  const report = { stage: "fx", video: src, module, project, scene: { start: resolved.scenes[0].start, end: resolved.scenes[0].end }, subject: null, final: null, warnings: [] };
  const ranges = plannedSubjectRanges(resolved, { sourceDuration: duration });
  if (ranges.length) {
    const matte = adapters.matte ?? runSubjectMatte;
    report.subject = { mattes: [] };
    for (const range of ranges) {
      log(`fx: cutting the presenter out of ${range.in}–${range.out} s (local, about 0.2 s a frame)`);
      const result = await matte(path.join(project, base), range, { source, cacheDir: path.join(project, ".launchclip", "subject"), download: options.download !== false, log });
      if (!result.info.usable) report.warnings.push(`the cut-out for ${range.in}–${range.out} s is unreliable (${result.info.reasons.join("; ")}); the effect may show artefacts`);
      const entry = await fileProjectMatte(project, path.join(project, base), result);
      report.subject.mattes.push({ in: entry.in, out: entry.out, src: entry.src, cached: Boolean(result.cached) });
    }
  }

  // With the presenter measured, the module checks itself again against the
  // real framing (a masthead needs headroom; a dolly zoom, a medium shot).
  if (ranges.length) {
    try {
      const measured = (await readProjectStory(project)).resolved;
      resolveModule(measured.scenes[0], measured);
    } catch (error) {
      throw new Error(`the ${module} scene does not fit how you're framed in this clip: ${String(error?.message ?? error)}`);
    }
  }

  log(`fx: rendering ${project} (${options.renderer ?? "default renderer"}, ${options.quality ?? "draft"})`);
  const run = adapters.finish ?? (await import("./finish.js")).runFinish;
  const finish = await run(project, { quality: options.quality ?? "draft", music: options.music ?? "none", ...(options.renderer ? { renderer: options.renderer } : {}) }, { notice: log });
  if (finish.status === "failed") {
    const failed = finish.stages?.find((stage) => stage.status === "failed");
    throw new Error(`finish failed at the ${failed?.name ?? "unknown"} stage: ${String(failed?.error ?? "").split("\n")[0]}`);
  }
  report.final = finish.final ?? null;
  report.warnings.push(...(finish.warnings ?? []));
  return report;
}

export function formatFxReport(report) {
  const lines = [`fx: ${report.module} on ${path.basename(report.video)} from ${report.scene.start} s to ${report.scene.end} s`];
  if (report.subject) lines.push(`presenter cut out: ${report.subject.mattes.map((matte) => `${matte.in}–${matte.out} s${matte.cached ? " (cached)" : ""}`).join(", ")}`);
  lines.push(`video: ${report.final ?? "(not rendered)"}`);
  lines.push(`project: ${report.project} (edit storyboard.json, then launchclip finish ${report.project})`);
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  return `${lines.join("\n")}\n`;
}

/** --params: inline JSON or a .json file. */
export async function readFxParams(value) {
  if (value === undefined || value === true) return {};
  const text = String(value).trim();
  const raw = /^[[{]/.test(text) ? text : await readFile(path.resolve(text), "utf8");
  let params;
  try { params = JSON.parse(raw); } catch (error) { throw new Error(`--params must be a JSON object or a .json file: ${error.message}`); }
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("--params must be a JSON object");
  return params;
}

/** --at / --until: seconds, or a "word:<text>[#n][+/-s]" anchor kept as written. */
export function parseFxTime(value, flag) {
  if (value === undefined || value === true) return undefined;
  const text = String(value);
  if (/^(word|beat|downbeat):/.test(text)) return text;
  const seconds = Number(text);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${flag} must be seconds or word:<text>; got ${text}`);
  return seconds;
}

/** The canvas: the clip's own shape, short edge at most 1080 px, even sizes. */
export function canvasFor(source) {
  const width = Number(source.width), height = Number(source.height);
  const scale = Math.min(1, MAX_SHORT_EDGE / Math.min(width, height));
  const even = (value) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

async function transcribe(src, adapters, log) {
  log("fx: transcribing the clip for word anchors (local Whisper)");
  const raw = await (adapters.transcribe ?? (async (file) => (await import("./recording_workflow.js")).transcribeRecording(file, { model: "base.en", language: "en" })))(src);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.words) ? raw.words : (raw?.segments ?? []).flatMap((segment) => segment.words ?? []);
  const words = list.map((word) => ({ text: String(word.word ?? word.text).trim(), start: Number(word.start), end: Number(word.end) })).filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
  if (!words.length) throw new Error("the clip has no transcribed words, so word: anchors cannot resolve; use seconds for --at and --until");
  return words;
}

async function linkOrCopy(from, to) {
  if (existsSync(to)) return;
  try { await link(from, to); } catch { await copyFile(from, to); }
}

const round3 = (value) => Math.round(value * 1000) / 1000;
