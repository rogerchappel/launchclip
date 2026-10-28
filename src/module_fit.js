// launchclip module fit <module> --params params.json --aspect 16:9|9:16
//
// Prints the rect a module's content needs, so sizing is not trial and error:
// without params.rect, the rect the module derives from its content (its
// natural size); with params.rect, whether it fits, the minimum height at its
// width and the minimum width at its height. A width table lists the minimum
// height at common widths either way.
import { readFile } from "node:fs/promises";
import { isEditorialKind, knownModules, moduleFit, moduleTiming, resolveModule, timingWindow } from "@launchclip/core/modules.mjs";

const FORMATS = { "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 } };
// A neutral brand for catalogue modules (they need brand colours and fonts);
// --brand or --story supplies the real one.
const DEFAULT_BRAND = { colors: { bg: "#0b0d12", primary: "#ffb020", accent: "#46d4ff", ink: "#0b0d12", paper: "#f2eee6" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } };

export async function runModuleFit(moduleName, flags = {}) {
  if (!moduleName) throw new Error("module fit needs a module id, e.g. launchclip module fit checklist --params params.json --aspect 16:9");
  if (!knownModules().includes(moduleName)) throw new Error(`Unknown module "${moduleName}". Known modules: ${knownModules().join(", ")}`);
  const params = flags.params ? JSON.parse(await readFile(String(flags.params), "utf8")) : {};
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("--params must be a JSON object of the scene's params");
  const storyFile = flags.story ? JSON.parse(await readFile(String(flags.story), "utf8")) : null;
  const aspect = String(flags.aspect ?? (storyFile?.format && storyFile.format.height > storyFile.format.width ? "9:16" : "16:9"));
  if (!FORMATS[aspect]) throw new Error("--aspect must be 16:9 or 9:16");
  const brand = flags.brand ? JSON.parse(await readFile(String(flags.brand), "utf8")) : storyFile?.brand ?? DEFAULT_BRAND;
  const duration = Number(flags.duration ?? 4);
  if (!(duration > 0)) throw new Error("--duration must be a positive number of seconds");
  const format = { ...FORMATS[aspect], fps: 30, duration };
  const scene = { id: "fit", module: moduleName, start: 0, end: duration, params };
  const story = { format, brand, scenes: [scene], ...(storyFile?.style ? { style: storyFile.style } : {}), ...(storyFile?.motion ? { motion: storyFile.motion } : {}) };
  return moduleFitReport(scene, story, { aspect });
}

export function moduleFitReport(scene, story, { aspect } = {}) {
  const duration = Number(scene.end) - Number(scene.start);
  const timing = moduleTiming(scene.module);
  const report = { module: scene.module, aspect, rect: scene.params?.rect ?? null, fits: false, error: null, resolved: null, natural: null, minHeight: null, widthAtHeight: null, widths: [],
    timing: timing ? { ...timing, duration: round(duration), window: timingWindow(timing, duration) } : null };
  try {
    const model = resolveModule(scene, story);
    const rect = model.rect ?? model.layout?.rect;
    report.fits = true;
    report.resolved = rect ? { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) } : null;
    if (isEditorialKind(scene.module) && model.density) {
      report.scale = model.density.scale;
      report.natural = { width: round(model.rect.width), height: Math.ceil(model.density.natural * model.density.scale) };
    } else if (rect) report.natural = { width: round(rect.width), height: round(rect.height) };
  } catch (error) {
    report.error = error.message;
  }
  if (report.rect) {
    const fit = moduleFit(scene, story);
    report.minHeight = fit.minHeight;
    report.widthAtHeight = fit.widthAtHeight;
  }
  const canvas = story.format;
  const widths = aspect === "9:16" ? [600, 700, 840] : [800, 1000, 1200, 1440, 1728];
  for (const width of widths) {
    if (width > canvas.width) continue;
    const { minHeight } = moduleFit(scene, story, { width });
    report.widths.push({ width, minHeight });
  }
  return report;
}

export function formatModuleFit(report) {
  const lines = [];
  const box = (rect) => `${rect.width}×${rect.height}`;
  lines.push(`${report.module} (${report.aspect})`);
  if (report.rect) {
    lines.push(report.fits ? `  rect ${box(report.rect)} fits` : `  rect ${box(report.rect)} does not fit: ${report.error}`);
    if (report.minHeight !== null) lines.push(`  needs ${report.minHeight} px height at width ${report.rect.width}`);
    else lines.push(`  no height fits width ${report.rect.width}`);
    if (report.widthAtHeight) lines.push(`  or width ${report.widthAtHeight.op} ${report.widthAtHeight.value} px at height ${report.rect.height}`);
    else lines.push(`  no width fits height ${report.rect.height}`);
  } else if (report.fits) {
    lines.push(`  natural size ${box(report.natural)}${report.scale ? ` at scale ${report.scale}` : ""}; default rect ${report.resolved.x},${report.resolved.y} ${box(report.resolved)}`);
  } else {
    lines.push(`  does not resolve: ${report.error}`);
  }
  if (report.widths.length) {
    lines.push("  minimum height by width:");
    for (const { width, minHeight } of report.widths) lines.push(`    width ${String(width).padStart(4)} → ${minHeight === null ? "does not fit" : `${minHeight} px`}`);
  }
  const timing = report.timing;
  if (timing) {
    lines.push("  timing:");
    lines.push(`    scene at least ${timing.minDuration} s${timing.duration < timing.minDuration ? ` (this ${timing.duration} s scene is too short)` : ""}`);
    if (timing.window) lines.push(`    at from ${timing.leadIn} s to scene − ${timing.leadOut} s (${timing.window.from}–${timing.window.to} s in a ${timing.duration} s scene)`);
    for (const gap of timing.gaps) lines.push(`    ${gap.between}: at least ${gap.seconds} s apart`);
    for (const rule of timing.rules) lines.push(`    ${rule}`);
  }
  return `${lines.join("\n")}\n`;
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
