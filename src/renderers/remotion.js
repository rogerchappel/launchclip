import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadStoryModule, readProjectStory } from "../story_loader.js";
import { adapterError, captureCommand, runCommand } from "./command.js";
import { MEZZANINE, encodeRemotionDelivery, renderRemotionAudio, renderRemotionSegments } from "./remotion_segments.js";

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REMOTION_CLI = path.join(path.dirname(require.resolve("@remotion/cli/package.json")), "remotion-cli.js");
const REMOTION_PACKAGE = require("@remotion/cli/package.json");

export const COMPOSITION_ID = "LaunchclipStory";
export const DEFAULT_REMOTION_ENTRY = path.join(PACKAGE_ROOT, "kit", "remotion", "entry.tsx");
export const DEFAULT_LAYOUT_CHECK_MODULE = path.join(PACKAGE_ROOT, "kit", "core", "layout-check.mjs");
const RESOLVED_STORY = path.join(".launchclip", "story.resolved.json");
const LAYOUT_CHECK_EXPORTS = ["checkStoryLayout", "checkLayout", "layoutCheck", "default"];
const BLOCKING_SEVERITIES = new Set(["error", "blocking", "fatal", "major"]);

export function remotionInvocation(args = []) {
  return { command: process.execPath, args: [REMOTION_CLI, ...args], display: ["remotion", ...args] };
}

export function remotionToolInfo() {
  return { version: REMOTION_PACKAGE.version, cli: REMOTION_CLI };
}

// Remotion renderer adapter (docs/KIT_CONTRACTS.md "Renderer adapter").
// defaults: {run, entry, storyModule, layoutCheck} — each may also be passed per call.
//   entry:       Remotion entry file; otherwise <project>/remotion/entry.tsx, then kit/remotion/entry.tsx
//   storyModule: story module object or path; otherwise kit/core/story.mjs
//   layoutCheck: layout-check module object or path, or false to skip; otherwise kit/core/layout-check.mjs if present
export function createRemotionRenderer(defaults = {}) {
  const option = (opts, name) => opts[name] ?? defaults[name];
  const runner = (opts) => option(opts, "run") ?? runCommand;
  const remotion = (run, args) => {
    const invocation = remotionInvocation(args);
    return captureCommand(run, invocation.command, invocation.args, { cwd: PACKAGE_ROOT });
  };

  const adapter = {
    name: "remotion",

    resolveEntry(projectDir, opts = {}) {
      const explicit = option(opts, "entry");
      const projectEntry = path.join(path.resolve(projectDir), "remotion", "entry.tsx");
      const entry = explicit ? path.resolve(explicit) : existsSync(projectEntry) ? projectEntry : DEFAULT_REMOTION_ENTRY;
      if (!existsSync(entry)) throw new Error(`Remotion entry not found: ${entry}. Add <project>/remotion/entry.tsx or kit/remotion/entry.tsx, or pass an entry override.`);
      return entry;
    },

    // Resolves storyboard.json and writes <project>/.launchclip/story.resolved.json,
    // which is passed to Remotion as --props.
    // opts.story: an already resolved story to render instead of the project's
    // storyboard.json (launchclip finish passes its resolved copy).
    async prepare(projectDir, opts = {}) {
      const project = path.resolve(projectDir);
      const loaded = opts.story ? await injectedStory(opts.story, option(opts, "storyModule")) : await readProjectStory(project, { storyModule: option(opts, "storyModule") });
      if (!loaded) throw new Error(`Remotion projects need storyboard.json: none found in ${project}`);
      let props = loaded.resolved;
      if (opts.fps) props = withFps(props, Number(opts.fps));
      const format = opts.fps ? loaded.module.storyFormat(props) : loaded.format;
      const propsFile = path.join(project, RESOLVED_STORY);
      await mkdir(path.dirname(propsFile), { recursive: true });
      await writeFile(propsFile, `${JSON.stringify(props, null, 2)}\n`);
      return { project, propsFile, props, format, entry: adapter.resolveEntry(project, opts), story: loaded };
    },

    renderArgs({ entry, propsFile, project }, outFile, { quality = "draft", concurrency } = {}) {
      const args = ["render", entry, COMPOSITION_ID, path.resolve(outFile), ...sharedArgs(propsFile, project), "--codec", "h264"];
      if (quality === "draft") args.push("--crf", "28", "--x264-preset", "veryfast");
      if (concurrency != null && concurrency !== "auto") args.push("--concurrency", String(concurrency));
      return args;
    },

    stillArgs({ entry, propsFile, project, format }, seconds, outFile) {
      return ["still", entry, COMPOSITION_ID, path.resolve(outFile), ...sharedArgs(propsFile, project), `--frame=${frameAt(seconds, format)}`];
    },

    // --quiet prints only the composition ids, one per line.
    compositionsArgs({ entry, propsFile, project }) {
      return ["compositions", entry, "--props", propsFile, "--public-dir", project, "--quiet"];
    },

    async render(projectDir, outFile, opts = {}) {
      const prepared = await adapter.prepare(projectDir, opts);
      await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
      const result = await remotion(runner(opts), adapter.renderArgs(prepared, outFile, opts));
      if (!result.ok) throw adapterError("Remotion render", result);
      return { renderer: "remotion", output: path.resolve(outFile), format: prepared.format, props: prepared.propsFile, raw: result };
    },

    // Partial rendering (src/render_segments.js): lossless video-only segments
    // by frame range, through one bundle and one browser.
    // segments: [{startFrame, endFrame (exclusive), output}]; opts.story as in prepare.
    async renderSegments(projectDir, segments, opts = {}) {
      const prepared = await adapter.prepare(projectDir, opts);
      return renderRemotionSegments({ entry: prepared.entry, project: prepared.project, props: prepared.props, segments, kitHash: opts.kitHash, concurrency: opts.concurrency });
    },

    segmentEncoder: () => ({ ...MEZZANINE }),

    // The joined segments → the delivery encode `remotion render` would make.
    encodeDelivery: (input, output, opts = {}) => encodeRemotionDelivery(input, output, opts),

    // The whole soundtrack as Remotion mixes it (audio-only render).
    async renderAudio(projectDir, output, opts = {}) {
      const prepared = await adapter.prepare(projectDir, opts);
      return renderRemotionAudio({ entry: prepared.entry, project: prepared.project, props: prepared.props, output, kitHash: opts.kitHash });
    },

    async still(projectDir, seconds, outFile, opts = {}) {
      const at = Number(seconds);
      if (!Number.isFinite(at) || at < 0) throw new Error(`Invalid still time: ${seconds}`);
      const prepared = await adapter.prepare(projectDir, opts);
      await mkdir(path.dirname(path.resolve(outFile)), { recursive: true });
      const args = adapter.stillArgs(prepared, at, outFile);
      const result = await remotion(runner(opts), args);
      if (!result.ok) throw adapterError("Remotion still", result);
      return { renderer: "remotion", output: path.resolve(outFile), seconds: at, frame: frameAt(at, prepared.format), raw: result };
    },

    // Proves the story bundles (`remotion compositions` must list
    // LaunchclipStory), then runs kit/core/layout-check.mjs when it exists.
    async check(projectDir, opts = {}) {
      const checks = {};
      const findings = [];
      let prepared;
      try {
        prepared = await adapter.prepare(projectDir, opts);
        checks.story = { ok: true };
      } catch (error) {
        checks.story = { ok: false, error: error.message };
        findings.push({ source: "story", severity: "error", message: error.message });
      }
      if (prepared) {
        const result = await remotion(runner(opts), adapter.compositionsArgs(prepared));
        const listed = compositionListed(result);
        checks.compositions = { ...result, ok: result.ok && listed };
        if (!result.ok) findings.push({ source: "remotion-compositions", severity: "error", message: `remotion compositions failed (exit ${result.exit_code})` });
        else if (!listed) findings.push({ source: "remotion-compositions", severity: "error", message: `remotion compositions did not list ${COMPOSITION_ID}` });

        const layoutSource = option(opts, "layoutCheck");
        const layout = layoutSource === undefined
          ? await runProjectLayoutCheck(projectDir)
          : await runLayoutCheck(prepared, layoutSource, { strict: opts.strict ?? true });
        checks.layout = layout.check;
        findings.push(...layout.findings);
      }
      const failed = Object.values(checks).some((entry) => entry.ok === false) || findings.some((entry) => BLOCKING_SEVERITIES.has(String(entry.severity)));
      return { status: failed ? "failed" : "passed", findings, raw: { renderer: "remotion", checks } };
    },

    // Run adapter.prepare(projectDir) first so the props file exists.
    previewCommand(projectDir, opts = {}) {
      const project = path.resolve(projectDir);
      const args = ["studio", adapter.resolveEntry(project, opts), ...sharedArgs(path.join(project, RESOLVED_STORY), project).filter((arg) => arg !== "--overwrite")];
      if (opts.port != null) args.push("--port", String(opts.port));
      const invocation = remotionInvocation(args);
      return [invocation.command, ...invocation.args];
    }
  };
  return adapter;
}

async function injectedStory(story, storyModule) {
  const module = await loadStoryModule(storyModule);
  if (!story?.resolved || !Array.isArray(story.scenes) || story.scenes.some((scene) => typeof scene?.start !== "number" || typeof scene?.end !== "number")) {
    throw new Error("opts.story must be a resolved story (run resolveStory first)");
  }
  return { file: null, story, resolved: story, format: module.storyFormat(story), module };
}

function sharedArgs(propsFile, project) {
  return ["--props", propsFile, "--public-dir", project, "--overwrite", "--log", "warn"];
}

function withFps(props, fps) {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`Invalid fps: ${fps}`);
  const duration = Number(props?.resolved?.duration ?? props?.format?.duration);
  return {
    ...props,
    format: { ...(props?.format ?? {}), fps },
    resolved: { ...(props?.resolved ?? {}), fps, ...(Number.isFinite(duration) ? { frames: Math.round(duration * fps) } : {}) }
  };
}

export function frameAt(seconds, format) {
  const fps = Number(format?.fps);
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("story format has no valid fps");
  const frame = Math.round(Number(seconds) * fps);
  const total = Math.round(Number(format?.duration) * fps);
  return Math.max(0, Number.isFinite(total) && total > 0 ? Math.min(frame, total - 1) : frame);
}

function compositionListed(result) {
  const text = typeof result.stdout === "string" ? result.stdout : JSON.stringify(result.stdout ?? "");
  return text.split(/\s+/).includes(COMPOSITION_ID);
}

async function runLayoutCheck(prepared, source, { strict }) {
  if (source === false) return { check: { ok: true, skipped: "disabled" }, findings: [] };
  let module = source && typeof source === "object" ? source : null;
  if (!module) {
    const file = path.resolve(String(source ?? DEFAULT_LAYOUT_CHECK_MODULE));
    if (!existsSync(file)) return { check: { ok: true, skipped: `layout check module not found: ${file}` }, findings: [] };
    module = await import(pathToFileURL(file).href);
  }
  const name = LAYOUT_CHECK_EXPORTS.find((entry) => typeof module?.[entry] === "function");
  if (!name) return { check: { ok: false, error: "layout check module exports no check function" }, findings: [{ source: "layout-check", severity: "error", message: `layout check module exports none of ${LAYOUT_CHECK_EXPORTS.join(", ")}` }] };
  try {
    const result = await module[name](prepared.props, { strict, format: prepared.format });
    const findings = normalizeFindings(Array.isArray(result) ? result : result?.findings ?? result?.errors ?? []);
    const ok = result?.ok ?? !findings.some((entry) => BLOCKING_SEVERITIES.has(entry.severity));
    return { check: { ok: ok === true, export: name, finding_count: findings.length, result }, findings };
  } catch (error) {
    return { check: { ok: false, export: name, error: error.message }, findings: [{ source: "layout-check", severity: "error", message: `layout check threw: ${error.message}` }] };
  }
}

// Default: the geometric check from src/layout_check.js over the project's
// storyboard.json, the same one `launchclip layout-check` runs.
async function runProjectLayoutCheck(projectDir) {
  try {
    const { checkLayoutProject } = await import("../layout_check.js");
    const report = await checkLayoutProject(projectDir);
    const findings = (report.findings ?? []).map((entry) => ({ source: "layout-check", ...entry, severity: String(entry.severity ?? "error"), message: `${entry.rule}: ${entry.detail ?? ""}`.trim() }));
    return { check: { ok: report.status !== "failed", export: "checkLayoutProject", finding_count: findings.length, result: report }, findings };
  } catch (error) {
    return { check: { ok: false, export: "checkLayoutProject", error: error.message }, findings: [{ source: "layout-check", severity: "error", message: `layout check threw: ${error.message}` }] };
  }
}

function normalizeFindings(values) {
  return values.map((entry) => typeof entry === "string"
    ? { source: "layout-check", severity: "error", message: entry }
    : { source: "layout-check", ...entry, severity: String(entry?.severity ?? "error").toLowerCase(), message:String(entry?.message ?? entry?.code ?? "layout finding") });
}

export const remotionRenderer = createRemotionRenderer();
