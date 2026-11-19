// launchclip carousel check <project> [--dest <id>] [--json] (docs/CAROUSELS_RFC.md §6).
// Plan rules come from kit/core/carousel-check.mjs. Per destination, the
// geometry rules (type-size, safe-zone) read each module's declared text box
// at that destination's canvas, as layout-check does, and the pixel rules
// (contrast, cover-thumbnail) measure the rendered slides in carousel/<dest>/.
// Writes carousel/check.json; exit code 1 on any failure.

import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CAROUSEL_DESTINATIONS, CAROUSEL_DESTINATION_IDS, carouselSlides, destinationProblems, isCarousel, slideStem } from "@launchclip/core/carousel.mjs";
import { carouselPlanFindings } from "@launchclip/core/carousel-check.mjs";
import { resolveModule, sceneRenderEnd } from "@launchclip/core/modules.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { applyProjectStyle } from "../story_style.js";

const execFileAsync = promisify(execFile);

// Proposals from the RFC (§6, §13); they need a pass against real feeds.
export const CAP_HEIGHT_RATIO = 0.7; // cap height of a display or text face, as a share of its font size
export const BODY_CAP_SHARE = 0.035;
export const HEADLINE_CAP_SHARE = 0.06;
export const CONTRAST_AA = 4.5;
export const CONTRAST_AA_LARGE = 3;
export const THUMBNAIL_WIDTH = 160;
export const THUMBNAIL_MIN_CAP_PX = 6;
// A pixel counts as ink when it differs from the box's background by at least this ratio.
const INK_RATIO = 1.25;
// Fewer ink pixels than this share of the box: nothing to measure.
const MIN_INK_SHARE = 0.002;
// The ink is the median of this share of the box's pixels, those farthest from
// the background: a glow or gradient behind the type also stands off the
// median, and outnumbers the type, so the median of every candidate is glow.
const INK_TAIL_SHARE = 0.01;

const PIXEL_RULES = ["contrast", "cover-thumbnail"];

export async function run(target, flags = {}, io = {}) {
  const project = path.resolve(target);
  const storyFile = path.join(project, "storyboard.json");
  const raw = JSON.parse(await readFile(storyFile, "utf8").catch(() => { throw new Error(`carousel check needs ${storyFile}`); }));
  const story = (await applyProjectStyle(raw, { projectDir: project })).story;
  if (!isCarousel(story)) throw new Error(`${storyFile} is not a carousel (format.kind "carousel")`);
  const validation = validateStory(story);
  if (validation.ok === false) throw new Error(`storyboard.json is invalid:\n- ${validation.errors.join("\n- ")}`);

  const dests = destinationsFor(story, flags.dest);
  const plan = carouselPlanFindings(story);
  const destinations = [];
  for (const id of dests) destinations.push(await checkDestination(project, story, id));

  const failed = [...plan, ...destinations.flatMap((entry) => entry.findings)].some((finding) => finding.level === "fail");
  const report = { stage: "carousel-check", project, status: failed ? "failed" : "passed", plan, destinations };
  await mkdir(path.join(project, "carousel"), { recursive: true });
  await writeFile(path.join(project, "carousel", "check.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (failed) process.exitCode = 1;
  io.stdout?.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  return report;
}

function destinationsFor(story, flag) {
  const ids = flag ? String(flag).split(",").map((id) => id.trim()).filter(Boolean)
    : story.carousel?.destinations ?? [story.format?.platform].filter((id) => CAROUSEL_DESTINATIONS[id]);
  const list = ids.length ? ids : ["instagram"];
  for (const id of list) if (!CAROUSEL_DESTINATIONS[id]) throw new Error(`unknown destination ${id}; use ${CAROUSEL_DESTINATION_IDS.join(", ")}`);
  return list;
}

async function checkDestination(project, story, id) {
  const dest = CAROUSEL_DESTINATIONS[id];
  const findings = [];
  const { errors, warnings } = destinationProblems(story, id);
  for (const reason of errors) findings.push({ rule: "destination", slide: null, level: "fail", reason });
  for (const reason of warnings) findings.push({ rule: "destination", slide: null, level: "warn", reason });

  const canvas = { width: dest.width, height: dest.height };
  const boxes = declaredTextBoxes(story, canvas);
  const render = await readRender(path.join(project, "carousel", id), story);
  // The render stage may report measured text runs; those win over the declared boxes.
  render?.slides.forEach((slide, i) => { if (Array.isArray(slide.texts) && slide.texts.length && boxes[i]) boxes[i] = { ...boxes[i], texts: slide.texts.map(scaleText(slide, canvas)) }; });
  findings.push(...geometryFindings(boxes, dest));
  if (render) findings.push(...await pixelFindings(boxes, render, canvas));
  return { id, canvas, rendered: Boolean(render), skipped: render ? [] : PIXEL_RULES, findings };
}

/**
 * Each slide's text at a canvas: [{slide, id, role, error?, texts: [{role: "headline" | "body", rect, fontSize}]}].
 * A module declares one box for its text. Its largest font is the cover's
 * headline, or another slide's main text (held to the body size: a list's
 * items are not a headline). Its declared smallest (minTextPx) is a floor for
 * text the slide may not set (an unused eyebrow), so it is not checked; a
 * render that reports measured text runs (render.json texts) checks every run.
 */
export function declaredTextBoxes(story, canvas) {
  const format = { ...story.format, width: canvas.width, height: canvas.height };
  delete format.aspect;
  const resolved = resolveStory({ ...story, format });
  return carouselSlides(resolved).map((scene, i) => {
    const entry = { slide: i + 1, id: scene.id, role: scene.slide?.role ?? null, texts: [] };
    let model;
    try { model = resolveModule(scene, resolved, { end: sceneRenderEnd(resolved, scene) }); }
    catch (error) { return { ...entry, error: `${scene.module}: ${error.message}` }; }
    const rect = model.layout?.rect;
    if (!rect || ["media", "decor"].includes(model.layout?.role)) return entry;
    const sizes = fontSizes(model);
    const largest = Math.max(...sizes, model.minTextPx ?? 0);
    if (largest > 0) entry.texts.push({ role: entry.role === "cover" ? "headline" : "body", rect, fontSize: largest });
    return entry;
  });
}

// Font sizes a resolved module sets: styles' fontSize ("118px") and content's numeric size.
function fontSizes(model) {
  const out = [];
  const walk = (value, key) => {
    if (Array.isArray(value)) value.forEach((item) => walk(item));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
    else if (key === "fontSize" && typeof value === "string" && /^\d+(\.\d+)?px$/.test(value)) out.push(parseFloat(value));
    else if (key === "size" && typeof value === "number" && value > 0) out.push(value);
  };
  walk(model.styles);
  walk(model.content);
  return out;
}

const scaleText = (slide, canvas) => (text) => {
  const sx = slide.width ? canvas.width / slide.width : 1, sy = slide.height ? canvas.height / slide.height : 1;
  return { role: text.role === "headline" ? "headline" : "body", rect: { x: text.rect.x * sx, y: text.rect.y * sy, width: text.rect.width * sx, height: text.rect.height * sy }, fontSize: Number(text.fontSize) * sy };
};

/** type-size and safe-zone on declared boxes. */
export function geometryFindings(boxes, dest) {
  const findings = [];
  const H = dest.height, W = dest.width;
  for (const box of boxes) {
    if (box.error) { findings.push({ rule: "type-size", slide: box.slide, level: "fail", reason: `the slide's module does not lay out at ${W}×${H}: ${box.error}` }); continue; }
    for (const text of box.texts) {
      const cap = text.fontSize * CAP_HEIGHT_RATIO;
      const share = text.role === "headline" ? HEADLINE_CAP_SHARE : BODY_CAP_SHARE;
      if (cap >= share * H) continue;
      findings.push({ rule: "type-size", slide: box.slide, level: "fail", reason: `${text.role} has a cap height of ${round(cap)} px, under ${round(share * H)} px (${round(share * 100)}% of ${H}); set it at ${Math.ceil(share * H / CAP_HEIGHT_RATIO)} px or more` });
    }
    const rect = box.texts[0]?.rect;
    if (!rect) continue;
    const safe = dest.safe;
    const over = {
      top: safe.top * H - rect.y,
      bottom: rect.y + rect.height - (1 - safe.bottom) * H,
      left: safe.left * W - rect.x,
      right: rect.x + rect.width - (1 - safe.right) * W
    };
    const sides = Object.entries(over).filter(([, px]) => px > 0.5);
    if (sides.length) findings.push({ rule: "safe-zone", slide: box.slide, level: "fail", reason: `text runs ${sides.map(([side, px]) => `${round(px)} px into the ${side} zone`).join(", ")} the platform covers` });
  }
  return findings;
}

/** carousel/<dest>/render.json ({slides: [{files: [png, mp4?] | file, still?, width?, height?, texts?}]}) or NN.png per slide; null when nothing is rendered. */
async function readRender(dir, story) {
  const count = carouselSlides(story).length;
  let manifest = null;
  try { manifest = JSON.parse(await readFile(path.join(dir, "render.json"), "utf8")); } catch { /* fall back to NN.png */ }
  const listed = Array.isArray(manifest?.slides) ? manifest.slides : null;
  const slides = [];
  for (let i = 0; i < count; i += 1) {
    const entry = listed?.[i] ?? {};
    const file = path.resolve(dir, entry.still ?? entry.file ?? (Array.isArray(entry.files) ? entry.files.find((name) => /\.(png|jpe?g)$/i.test(name)) : undefined) ?? `${slideStem(i, count)}.png`);
    slides.push((await exists(file)) ? { ...entry, file } : null);
  }
  return slides.some(Boolean) ? { dir, slides: slides.map((slide) => slide ?? {}) } : null;
}

async function pixelFindings(boxes, render, canvas) {
  const findings = [];
  for (const box of boxes) {
    const slide = render.slides[box.slide - 1];
    if (!slide?.file || !box.texts.length) continue;
    const image = await readPixels(slide.file, canvas.width, canvas.height);
    const rect = box.texts[0].rect;
    const ratio = measuredContrast(image, rect);
    const needed = box.texts.some((text) => text.role === "body") ? CONTRAST_AA : CONTRAST_AA_LARGE;
    if (ratio !== null && ratio < needed) findings.push({ rule: "contrast", slide: box.slide, level: "fail", reason: `text measures ${round(ratio)}:1 against what is under it; WCAG AA needs ${needed}:1` });
    if (box.role !== "cover") continue;
    const headline = box.texts.find((text) => text.role === "headline") ?? box.texts[0];
    const scale = THUMBNAIL_WIDTH / canvas.width;
    const cap = headline.fontSize * CAP_HEIGHT_RATIO * scale;
    if (cap < THUMBNAIL_MIN_CAP_PX) findings.push({ rule: "cover-thumbnail", slide: box.slide, level: "fail", reason: `at ${THUMBNAIL_WIDTH} px wide the headline's cap height is ${round(cap)} px; it needs ${THUMBNAIL_MIN_CAP_PX} px (a headline of ${Math.ceil(THUMBNAIL_MIN_CAP_PX / scale / CAP_HEIGHT_RATIO)} px or more)` });
    const thumbHeight = Math.round(canvas.height * scale);
    const thumb = await readPixels(slide.file, THUMBNAIL_WIDTH, thumbHeight);
    const small = measuredContrast(thumb, { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale });
    if (small !== null && small < CONTRAST_AA_LARGE) findings.push({ rule: "cover-thumbnail", slide: box.slide, level: "fail", reason: `at ${THUMBNAIL_WIDTH} px wide the headline measures ${round(small)}:1; it needs ${CONTRAST_AA_LARGE}:1` });
  }
  return findings;
}

/** A PNG (or JPG) scaled to width × height (area filter), as {width, height, data: rgb24}. */
export async function readPixels(file, width, height) {
  const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${width}:${height}:flags=area,format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", maxBuffer: width * height * 3 + 1024 });
  return { width, height, data: stdout };
}

const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (r, g, b) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratioOf = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * WCAG contrast of the text in a box against what is under it, on pixels:
 * the background is the box's median luminance, the ink the median of the
 * INK_TAIL_SHARE of pixels farthest from it, on whichever side more pixels
 * stand off it. null when
 * the box holds no ink. shortcut: one background per box; text over a busy
 * photo needs a per-glyph background, add it when slides set type on imagery.
 */
export function measuredContrast(image, rect) {
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width)), y1 = Math.min(image.height, Math.ceil(rect.y + rect.height));
  const values = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const i = (y * image.width + x) * 3;
    values.push(luminance(image.data[i], image.data[i + 1], image.data[i + 2]));
  }
  if (!values.length) return null;
  const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const bg = median([...values]);
  const lighter = values.filter((v) => ratioOf(v, bg) >= INK_RATIO && v > bg);
  const darker = values.filter((v) => ratioOf(v, bg) >= INK_RATIO && v < bg);
  const ink = lighter.length >= darker.length ? lighter : darker;
  if (ink.length < MIN_INK_SHARE * values.length) return null;
  const tail = ink.sort((a, b) => ratioOf(b, bg) - ratioOf(a, bg)).slice(0, Math.max(1, Math.round(INK_TAIL_SHARE * values.length)));
  return ratioOf(median(tail), bg);
}

export function formatReport(report) {
  const lines = [`carousel check: ${report.status}`];
  const show = (finding) => `  ${finding.level === "fail" ? "FAIL" : "warn"} ${finding.rule}${finding.slide ? ` (slide ${finding.slide})` : ""}: ${finding.reason}`;
  lines.push(report.plan.length ? "plan:" : "plan: every rule passed");
  lines.push(...report.plan.map(show));
  for (const dest of report.destinations) {
    lines.push(`${dest.id} (${dest.canvas.width}×${dest.canvas.height}):${dest.findings.length ? "" : " every rule passed"}`);
    lines.push(...dest.findings.map(show));
    if (dest.skipped.length) lines.push(`  skipped ${dest.skipped.join(", ")}: nothing rendered in carousel/${dest.id}/ (run launchclip carousel render)`);
  }
  return `${lines.join("\n")}\n`;
}

const round = (value) => Math.round(value * 10) / 10;
async function exists(file) { try { await access(file); return true; } catch { return false; } }
