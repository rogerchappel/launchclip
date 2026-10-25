import { narrationFile, readStoryEdl } from "./story_loader.js";
import { readStorySubject } from "./subject/project.js";
import { applyProjectStyle } from "./story_style.js";
import { catalogModules, rectFitHint, resolveModule, subjectDensityFindings } from "../kit/core/modules.mjs";
import { profileForStory } from "./profile_store.js";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkCameraSweeps, checkLayout, elementsFromEditorialLayout, elementsFromStory, profileGeometry, SAFE_ZONE_PROFILES } from "../kit/core/layout-check.mjs";
import { cameraPlan, captionDipWindows, sceneObjectLookup, screenPoint, worldPoint } from "../kit/core/camera-world.mjs";
import { captionDipHidden, captionMoveHide, captionsOverlayOf, chunkWords } from "../kit/core/captions.mjs";
import { driftExtent, sceneDrift } from "../kit/core/ambient.mjs";
import { emptyPlates, sceneWindows } from "../kit/core/transitions.mjs";
import { storyBase } from "../kit/core/story.mjs";
import { checkBehindText, checkSubjectFace, sceneLayerOf, subjectCameraAt, subjectCameraOps, subjectLocator } from "../kit/core/subject-layer.mjs";

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
  const story = (await applyProjectStyle(options.story ?? JSON.parse(await readFile(storyFile, "utf8")), { projectDir: project })).story;
  const storyCore = adapters.storyCore ?? await loadStoryCore();
  if (typeof storyCore.validateStory === "function") {
    const validation = storyCore.validateStory(story);
    if (validation && validation.ok === false) throw new Error(`storyboard.json is invalid:\n- ${validation.errors.join("\n- ")}`);
  }
  const narration = options.words ?? await readOptionalJson(narrationFile(project, story));
  const words = Array.isArray(narration) ? narration : Array.isArray(narration?.words) ? narration.words : [];
  // options.beats: a grid the caller already holds (finish, before BEATS.json is written).
  const beats = options.beats ?? await readOptionalJson(path.join(project, "BEATS.json"));
  const resolved = storyCore.resolveStory(story, { words, beats, edl: await readStoryEdl(project, story), subject: await readStorySubject(project, story) });
  const catalogue = catalogModules();

  const profile = options.profile == null ? null : String(options.profile);
  if (profile && !SAFE_ZONE_PROFILES[profile]) throw new Error(`Unknown --profile ${profile}; use shorts or landscape`);
  const canvas = { width: Number(resolved.format?.width), height: Number(resolved.format?.height) };
  const buildEditorialModule = adapters.buildEditorialModule ?? (await import(pathToFileURL(EDITORIAL_MODULE).href)).buildEditorialModule;

  const warnings = [];
  const specFindings = [];
  const moduleLayout = (scene) => {
    const params = scene.params ?? {};
    if (EDITORIAL_KINDS.has(scene.module) && !adapters.buildEditorialModule) {
      // The same resolver as validate and both compilers (brand defaults,
      // grammar, durations rounded to 1e-6, shared bound tolerance), so the
      // two commands accept and reject the same params.
      try {
        const model = resolveModule(scene, resolved);
        return elementsFromEditorialLayout(model.layout, {
          id: scene.id,
          role: scene.module === "media-window" ? "media" : "text",
          start: Number(scene.start),
          end: Number(scene.end),
          track: scene.track,
          canvas,
          ...(model.minTextPx != null ? { minTextPx: model.minTextPx } : {}),
          ...(model.minSecondaryTextPx != null ? { minSecondaryTextPx: model.minSecondaryTextPx } : {}),
          textRole: model.textRole ?? "key"
        });
      } catch (error) {
        specFindings.push({ rule: "module-spec", severity: "error", ids: [scene.id], at: Number(scene.start), detail: `${scene.module}: ${error.message}` });
        return [];
      }
    }
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
        specFindings.push({ rule: "module-spec", severity: "error", ids: [scene.id], at: Number(scene.start), detail: `${scene.module}: ${error.message}${rectFitHint(scene, resolved, error.message)}` });
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
  // Empty plates: spans where no scene draws anything (a gap in scene timing,
  // or a module that has not drawn yet when the previous one has gone).
  // Footage-led stories show the recording there instead.
  const plateFindings = [];
  if (!resolved.base) {
    try {
      for (const gap of emptyPlates(resolved)) {
        plateFindings.push({ rule: "empty-plate", severity: "warning", ids: [gap.before, gap.after].filter(Boolean), at: gap.from,
          detail: `empty plate from ${gap.from} s to ${gap.to} s (${gap.before ? `after ${gap.before}, ` : ""}before ${gap.after} draws anything); extend the previous scene, move the next scene's first beat earlier, or close the gap` });
      }
    } catch { /* unresolvable windows are reported elsewhere */ }
  }
  let sweepFindings = [];
  try { sweepFindings = cameraSweepFindings(resolved, elements, words, report.captionBand); }
  catch (error) { warnings.push(`camera sweep check skipped: ${error.message}`); }
  // Subject-effect density (RFC §7.5): a warning, never an error. The share
  // is the cadence profile's subject_effect_share ceiling.
  let cadence = null;
  try { cadence = profileForStory(resolved).profile; } catch { cadence = null; }
  const densityFindings = subjectDensityFindings(resolved, { profile: cadence }).map((finding) => ({ rule: "subject-density", severity: "warning", ...finding }));
  let faceFindings = [];
  try { faceFindings = await subjectFaceFindings(project, resolved, elements, warnings); }
  catch (error) { warnings.push(`subject face check skipped: ${error.message}`); }
  let textFindings = [];
  try { textFindings = await subjectTextFindings(project, resolved); }
  catch (error) { warnings.push(`behind-text check skipped: ${error.message}`); }
  const findings = [...specFindings, ...report.findings, ...plateFindings, ...sweepFindings, ...faceFindings, ...textFindings, ...densityFindings].sort((a, b) => a.at - b.at);
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

// Camera moves: sample every frame of every world-camera move, transform each
// visible plate element's declared rect by the camera at that frame, and
// report crossings of the caption band while captions are on screen
// (kit/core/layout-check.mjs checkCameraSweeps). Captions dipped out for the
// move (captions.hide_during_moves, default "auto": vertical pans, dollies and
// orbits) do not count.
export function cameraSweepFindings(resolved, elements, words = [], band = null) {
  const caption = elements.find((element) => element.role === "caption");
  if (!caption) return [];
  const windows = sceneWindows(resolved);
  const plan = cameraPlan(resolved, { windows, objects: sceneObjectLookup(resolved, (scene, value) => resolveModule(scene, value)) });
  if (!plan?.moves.length) return [];
  const overlay = captionsOverlayOf(resolved);
  const captionRect = caption.rect ?? band;
  if (!captionRect) return [];
  // Captions are on screen while a chunk is (narration words), within the
  // overlay's window, outside its hide ranges and the move dips.
  const chunks = words.length ? chunkWords(words).map((chunk) => [chunk.start, chunk.end]) : [[caption.start, caption.end]];
  const holes = [...(caption.hide ?? []), ...captionDipHidden(captionDipWindows(plan, captionMoveHide(overlay)))];
  const captionVisible = subtract(chunks.map(([a, b]) => [Math.max(a, caption.start), Math.min(b, caption.end)]).filter(([a, b]) => b > a), holes);
  const byId = new Map(windows.scenes.map((entry) => [entry.id, entry]));
  const plates = elements.filter((element) => {
    const entry = byId.get(element.id);
    return entry?.plate && plan.placements[element.id] && element.rect && ["text", "hero", "media"].includes(element.role) && !element.hidesCaptions && !overlaps(element.rect, captionRect);
  });
  const step = 1 / plan.fps;
  const frames = [];
  for (const move of plan.moves) {
    const entry = byId.get(move.sceneId);
    const info = { sceneId: move.sceneId, type: move.type, start: move.start, duration: move.duration, direction: entry?.transitionIn?.direction ?? null };
    for (let f = Math.ceil(move.start * plan.fps - 1e-6); f <= Math.floor((move.start + move.duration) * plan.fps + 1e-6); f += 1) {
      const t = f / plan.fps;
      const rects = [];
      for (const element of plates) {
        const scene = byId.get(element.id);
        if (t < Math.max(element.start, scene.start) - 1e-6 || t >= Math.max(element.end, scene.renderEnd) - 1e-6) continue;
        const placement = plan.placements[element.id], r = element.rect;
        const corners = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]
          .map(([x, y]) => screenPoint(plan, worldPoint(placement, { x, y }), t));
        const xs = corners.map((point) => point.x), ys = corners.map((point) => point.y);
        rects.push({ id: element.id, rect: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } });
      }
      frames.push({ t, move: info, rects });
    }
  }
  return checkCameraSweeps({ band: captionRect, frames, captionVisible, step });
}

// The presenter on the canvas for the subject rules: each matte's
// subject.json (base.subject.mattes[].info), mapped through the base's trims,
// fit and focus, then moved by the subject's camera: the base cameras
// (punch-ins, pans, framed windows), or a module's own subjectCamera while it
// runs. → {at(t) → {head, body} | null, models: Map(scene id → model)}, or
// null without mattes. Ranges without info are skipped with a warning.
async function subjectView(projectDir, resolved, warnings = []) {
  const base = storyBase(resolved);
  if (!base || base.subject.mode !== "mattes") return null;
  const infos = [];
  for (const matte of base.subject.mattes) {
    if (!matte.info) {
      warnings.push(`${matte.src} has no info (its subject.json); the subject checks skip its range`);
      infos.push(null);
      continue;
    }
    infos.push(JSON.parse(await readFile(path.join(projectDir, matte.info), "utf8")));
  }
  const models = new Map();
  for (const scene of resolved.scenes) {
    try { models.set(scene.id, resolveModule(scene, resolved)); } catch { /* reported as module-spec */ }
  }
  const ops = subjectCameraOps([...models.values()]);
  const located = subjectLocator(resolved, infos);
  const canvas = { width: Number(resolved.format?.width), height: Number(resolved.format?.height) };
  const at = (t) => {
    const boxes = located(t);
    const cam = boxes && ops.length ? subjectCameraAt(ops, t) : null;
    if (!boxes || !cam) return boxes;
    const cx = canvas.width / 2, cy = canvas.height / 2, s = cam.scaleX ?? 1;
    const move = (box) => (box ? { x: cx + (box.x - cx) * s + (cam.x ?? 0), y: cy + (box.y - cy) * s + (cam.y ?? 0), width: box.width * s, height: box.height * s } : null);
    return { head: move(boxes.head), body: move(boxes.body) };
  };
  return { at, models };
}

// The face rule (docs/SUBJECT_EFFECTS_RFC.md §9): with base.subject mattes,
// a front-layer element may not cover the presenter's head for more than
// 0.3 s. Behind-layer scenes, captions, decor (punch-in) and modules that set
// model.framesFace are exempt.
export async function subjectFaceFindings(projectDir, resolved, elements, warnings = []) {
  const view = await subjectView(projectDir, resolved, warnings);
  if (!view) return [];
  const depth = new Map(resolved.scenes.map((scene) => {
    const model = view.models.get(scene.id) ?? null;
    return [scene.id, { layer: sceneLayerOf(scene, model).layer, framesFace: Boolean(model?.framesFace) }];
  }));
  const headAt = (t) => view.at(t)?.head ?? null;
  const candidates = elements
    .filter((element) => element.id !== "base" && element.rect && element.role !== "caption" && element.role !== "decor")
    .map((element) => ({ ...element, layer: depth.get(element.id)?.layer ?? "front", framesFace: depth.get(element.id)?.framesFace ?? false }));
  const fps = Number(resolved.resolved?.fps ?? resolved.format?.fps ?? 30);
  return checkSubjectFace({ elements: candidates, headAt, step: 1 / fps });
}

// Repairs for a behind-layer word the presenter covers, by module.
const BEHIND_TEXT_HINTS = {
  masthead: (model) => `Raise or shrink it: set params.baseline lower (now ${model.content.baseline}; 0 stands the letters on the head and shrinks them into the headroom)${model.content.kicker ? ", drop the kicker to give the letters room" : ""}, or use it where the head sits lower (a medium or wide shot)`
};

// Behind-text visibility (docs/SUBJECT_EFFECTS_RFC.md §9): a behind-layer
// module whose definition names its key glyphs (MODULES[id].glyphs, from the
// shared text metrics, not a render) keeps at least 60% of each glyph clear
// of the presenter's head and body at its settle and mid-hold times.
export async function subjectTextFindings(projectDir, resolved, warnings = []) {
  const view = await subjectView(projectDir, resolved, warnings);
  if (!view) return [];
  const catalogue = catalogModules();
  const fps = Number(resolved.resolved?.fps ?? resolved.format?.fps ?? 30);
  const frame = (t) => Math.round(t * fps) / fps;
  const texts = [];
  for (const scene of resolved.scenes) {
    const model = view.models.get(scene.id);
    const glyphs = catalogue[scene.module]?.glyphs;
    if (!model || !glyphs || sceneLayerOf(scene, model).layer !== "behind") continue;
    const settle = Number(model.layout?.motion?.enterEnd ?? scene.start);
    const exit = Number(model.layout?.motion?.exitStart ?? scene.end);
    texts.push({ id: scene.id, module: scene.module, glyphs: glyphs(model), times: [...new Set([frame(settle), frame((settle + Math.max(settle, exit)) / 2)])], hint: BEHIND_TEXT_HINTS[scene.module]?.(model) });
  }
  return checkBehindText({ texts, subjectAt: view.at });
}

function overlaps(a, b) {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

function subtract(spans, holes) {
  let pieces = spans;
  for (const [from, to] of holes) {
    pieces = pieces.flatMap(([a, b]) => (to <= a || from >= b ? [[a, b]] : [[a, from], [to, b]].filter(([x, y]) => y - x > 1e-6)));
  }
  return pieces;
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
      ...(element.minTextPx != null && drift.scale < 1 ? { minTextPx: element.minTextPx * drift.scale } : {}),
      ...(element.minSecondaryTextPx != null && drift.scale < 1 ? { minSecondaryTextPx: element.minSecondaryTextPx * drift.scale } : {})
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
