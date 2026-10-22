import { narrationFile, readStoryEdl } from "./story_loader.js";
import { catalogModules, resolveModule } from "../kit/core/modules.mjs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkLayout, elementsFromEditorialLayout, elementsFromStory, profileGeometry, SAFE_ZONE_PROFILES } from "../kit/core/layout-check.mjs";
import { driftExtent, sceneDrift } from "../kit/core/ambient.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STORY_MODULE = path.join(ROOT, "kit/core/story.mjs");
const EDITORIAL_MODULE = path.join(ROOT, "skills/launchclip-create-video/scripts/editorial-ui-modules.mjs");
// Kept in step with KINDS in editorial-ui-modules.mjs, which does not export it.
const EDITORIAL_KINDS = new Set(["media-window", "checklist", "step-rail", "callout", "audience-grid", "trend-chart", "metric", "progress", "date-card", "status-rack", "code-snippet", "excerpt-window", "focus-flow", "growth-chart"]);
const PARAM_ROLES = new Set(["text", "hero", "media", "caption", "decor"]);

// Geometric layout check for a storyboard.json project. Works for both renderers
// because it reads declared rects and timing, not rendered pixels.
// options.story / options.words: check this (unresolved) story and these
// narration words instead of reading storyboard.json and its NARRATION.json
// (launchclip finish passes its resolved copy).
export async function checkLayoutProject(projectDir, options = {}, adapters = {}) {
  const project = path.resolve(projectDir);
  const storyFile = path.join(project, "storyboard.json");
  if (!options.story && !(await exists(storyFile))) throw new Error(`layout-check needs ${storyFile}; author storyboard.json first`);
  const story = options.story ?? JSON.parse(await readFile(storyFile, "utf8"));
  const storyCore = adapters.storyCore ?? await loadStoryCore();
  if (typeof storyCore.validateStory === "function") {
    const validation = storyCore.validateStory(story);
    if (validation && validation.ok === false) throw new Error(`storyboard.json is invalid:\n- ${validation.errors.join("\n- ")}`);
  }
  const narration = options.words ?? await readOptionalJson(narrationFile(project, story));
  const words = Array.isArray(narration) ? narration : Array.isArray(narration?.words) ? narration.words : [];
  // options.beats: a grid the caller already holds (finish, before BEATS.json is written).
  const beats = options.beats ?? await readOptionalJson(path.join(project, "BEATS.json"));
  const resolved = storyCore.resolveStory(story, { words, beats, edl: await readStoryEdl(project, story) });
  const catalogue = catalogModules();

  const profile = options.profile == null ? null : String(options.profile);
  if (profile && !SAFE_ZONE_PROFILES[profile]) throw new Error(`Unknown --profile ${profile}; use shorts or landscape`);
  const canvas = { width: Number(resolved.format?.width), height: Number(resolved.format?.height) };
  const buildEditorialModule = adapters.buildEditorialModule ?? (await import(pathToFileURL(EDITORIAL_MODULE).href)).buildEditorialModule;

  const warnings = [];
  const specFindings = [];
  const moduleLayout = (scene) => {
    const params = scene.params ?? {};
    if (EDITORIAL_KINDS.has(scene.module)) {
      const aspect = canvas.width > canvas.height ? "16:9" : "9:16";
      try {
        const built = buildEditorialModule({
          ...params,
          id: scene.id,
          kind: scene.module,
          aspect,
          start: Number(scene.start),
          duration: Number(scene.end) - Number(scene.start),
          ...(scene.track !== undefined && params.track === undefined ? { track: scene.track } : {})
        });
        return elementsFromEditorialLayout(built.layout, {
          id: scene.id,
          role: scene.module === "media-window" ? "media" : "text",
          start: Number(scene.start),
          end: Number(scene.end),
          track: scene.track,
          canvas
        });
      } catch (error) {
        specFindings.push({ rule: "module-spec", severity: "error", ids: [scene.id], at: Number(scene.start), detail: `${scene.module}: ${error.message}` });
        return [];
      }
    }
    if (params.rect) {
      return [{
        id: scene.id,
        role: PARAM_ROLES.has(params.role) ? params.role : "text",
        rect: params.rect,
        start: Number(scene.start),
        end: Number(scene.end),
        ...(params.motion && Number.isFinite(params.motion.enterEnd) ? { motion: { enterEnd: params.motion.enterEnd, exitStart: params.motion.exitStart } } : {}),
        ...(params.minTextPx !== undefined ? { minTextPx: params.minTextPx } : {}),
        ...(Array.isArray(params.allowOcclusion) ? { allowOcclusion: params.allowOcclusion } : {}),
        ...(scene.hides_captions === true || params.hidesCaptions === true ? { hidesCaptions: true } : {})
      }];
    }
    // Catalogue modules declare their own geometry in the resolved model.
    if (Object.hasOwn(catalogue, scene.module)) {
      try {
        const model = resolveModule(scene, resolved);
        const role = PARAM_ROLES.has(model.layout?.role) ? model.layout.role : "text";
        return [{
          id: scene.id, role, rect: model.layout.rect, start: Number(scene.start), end: Number(scene.end),
          motion: { enterEnd: model.layout.motion.enterEnd, exitStart: model.layout.motion.exitStart },
          ...(model.minTextPx != null && role !== "decor" ? { minTextPx: model.minTextPx } : {}),
          ...(model.hidesCaptions ? { hidesCaptions: true } : {})
        }];
      } catch (error) {
        specFindings.push({ rule: "module-spec", severity: "error", ids: [scene.id], at: Number(scene.start), detail: `${scene.module}: ${error.message}` });
        return [];
      }
    }
    warnings.push(`scene ${scene.id} (${scene.module}) declares no geometry; skipped. Add params.rect to check it.`);
    return [];
  };

  // Ambient hold drift (kit/core/ambient.mjs): check each drifting scene's
  // largest extent over its render window, computed exactly as both
  // compilers compute the drift they draw, so a drift can never carry key
  // text out of the safe zone, into the caption band or onto a neighbour.
  const ambient = ambientDrift(resolved, canvas);
  const elements = elementsFromStory(resolved, { moduleLayout: (scene, story) => ambient.inflate(scene, moduleLayout(scene, story)), profile });
  // Footage-led: the recording fills the frame under everything (media, never a collision).
  if (resolved.base) elements.unshift({ id: "base", role: "media", rect: { x: 0, y: 0, width: canvas.width, height: canvas.height }, start: 0, end: Number(resolved.resolved?.duration ?? resolved.format?.duration), allowOcclusion: ["*"] });
  const report = checkLayout({ canvas, elements, profile, duration: Number(resolved.resolved?.duration ?? resolved.format?.duration) || undefined });
  const findings = [...specFindings, ...report.findings].sort((a, b) => a.at - b.at);
  return {
    stage: "layout-check",
    project,
    status: findings.some((finding) => finding.severity === "error") ? "failed" : "passed",
    profile: report.profile,
    canvas,
    elements: elements.length,
    errors: findings.filter((finding) => finding.severity === "error").length,
    drifted: ambient.drifted,
    warnings,
    findings
  };
}

// → {inflate(scene, elements) → elements, drifted: scene ids}. Elements of a
// drifting scene get the drift's extent as their rect, and a pull-back's
// smaller key text as their minTextPx.
function ambientDrift(resolved, canvas) {
  const drifted = [];
  let windows;
  try { windows = new Map(sceneWindows(resolved).scenes.map((entry) => [entry.id, entry])); }
  catch { return { inflate: (scene, elements) => elements, drifted }; }
  const geometry = profileGeometry(canvas);
  const inflate = (scene, produced) => {
    const window = windows.get(scene.id);
    if (!window || !produced) return produced;
    let model;
    try { model = resolveModule(scene, resolved, { end: window.renderEnd }); } catch { return produced; }
    const drift = sceneDrift(resolved, scene, model, { window: { start: window.start, end: window.renderEnd }, geometry });
    if (!drift) return produced;
    drifted.push(scene.id);
    const list = Array.isArray(produced) ? produced : [produced];
    return list.map((element) => element && element.rect ? {
      ...element,
      rect: driftExtent(element.rect, drift),
      ...(element.minTextPx != null && drift.scale < 1 ? { minTextPx: element.minTextPx * drift.scale } : {})
    } : element);
  };
  return { inflate, drifted };
}

export function formatLayoutReport(report) {
  const lines = [`layout-check ${report.status} (${report.profile}, ${report.canvas.width}x${report.canvas.height}, ${report.elements} elements${report.drifted?.length ? `, ${report.drifted.length} with ambient drift` : ""})`];
  for (const finding of report.findings) {
    lines.push(`  ${finding.severity.padEnd(7)} ${finding.rule} @${finding.at}s [${finding.ids.join(", ")}] ${finding.detail}`);
  }
  for (const warning of report.warnings) lines.push(`  note    ${warning}`);
  return `${lines.join("\n")}\n`;
}

async function loadStoryCore() {
  if (!(await exists(STORY_MODULE))) throw new Error(`layout-check needs ${STORY_MODULE} to resolve storyboard.json, and it is missing; install a LaunchClip build that ships kit/core/story.mjs`);
  const module = await import(pathToFileURL(STORY_MODULE).href);
  if (typeof module.resolveStory !== "function") throw new Error(`${STORY_MODULE} does not export resolveStory`);
  return module;
}

async function readOptionalJson(file) {
  if (!(await exists(file))) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
