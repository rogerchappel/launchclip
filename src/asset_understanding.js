// Asset understanding: what each handed-in image and clip shows, so the
// planner places it where the story needs it (docs/KIT_CONTRACTS.md "Footage
// inventory notes", "Described automatically").
//
//   describeInventory(inventory, options) → {described, results, warnings}
//   localDescription(entry, facts)        → notes guessed without a model
//   featuredAssets(media, {prompt})       → the files the user clearly wants shown
//   unusedFeatured(storyboard, featured)  → repair errors ("featured: …")
//
// Every image and video in the inventory ends up with notes
// (src/inventory_notes.js): what it is in a few words (`shows`), a sentence
// (`description`), the key words readable on it (`text`), the story beats it
// suits (`fits`), its orientation and, for a video, the usable time ranges
// (`windows`). Three sources, first match wins per file:
//
//   notes   the caller's own sidecar or inventory.json already says what the
//           file shows (`shows` or `description`): nothing is computed, no
//           model is called. A host application or an agent that can look at
//           the files writes these and skips the model call.
//   vision  the configured model can take images: one call per file (an
//           image, or four frames of a video), cached by the file's SHA-256.
//   local   no model: the file name and folder, the inventory's role, the
//           frame's shape, the stretches of a video where something moves,
//           and the words Tesseract reads when it is installed.
//
// The caller's fields always win over a computed one, field by field. The
// cache holds one JSON per content hash, so a file is described once however
// many projects it is handed to.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { LOW_QUALITY, normalizeNotes } from "./inventory_notes.js";
import { MEDIA_PRESENCE, decodeFrames, mediaPresenceFacts } from "./media_presence.js";
import { pinnedCache } from "./state_dirs.js";

const run = promisify(execFile);

export const UNDERSTANDING_VERSION = 1;
export const DESCRIPTION_MODES = Object.freeze(["auto", "local", "off"]);
// The most files one run sends to the vision model; the rest are described locally.
export const MAX_VISION_FILES = 24;
// Frames of a video the vision model sees, as shares of its length.
const VIDEO_FRAME_SHARES = [0.1, 0.35, 0.65, 0.9];
// The long side of what the vision model sees (px).
const VISION_IMAGE_SIDE = 1024;
const VISION_FRAME_SIDE = 768;
// Local windows: a stretch where something moves counts from this length, and
// windows are given only when the clip is still for at least this share.
const MIN_WINDOW_SECONDS = 1.5;
const STILL_SHARE_FOR_WINDOWS = 0.15;
// With this many showable files or fewer, the user meant every one of them.
export const FEW_ASSETS = 3;

// What an asset is, from the words in its path (or the words read off it).
const SHOW_HINTS = [
  ["pricing page", /\b(pricing|plans?|prices?|billing|subscriptions?|per month|\/mo)\b/],
  ["onboarding flow", /\b(onboard(?:ing)?|sign-?up|welcome|getting-?started|setup|wizard|tour)\b/],
  ["login screen", /\b(log-?in|sign-?in|auth)\b/],
  ["dashboard", /\b(dashboard|analytics|metrics|overview|insights|reports?)\b/],
  ["chart", /\b(charts?|graphs?|plot|trend|growth|stats?)\b/],
  ["settings screen", /\b(settings|preferences|config|account|profile)\b/],
  ["checkout", /\b(checkout|cart|payment|order)\b/],
  ["code or terminal", /\b(code|editor|terminal|cli|ide|console|diff)\b/],
  ["chat or inbox", /\b(chat|inbox|messages?|conversation|thread)\b/],
  ["calendar", /\b(calendar|schedule|booking)\b/],
  ["map", /\b(maps?|route|location)\b/],
  ["landing page", /\b(landing|homepage|home|hero|website|site)\b/],
  ["testimonial", /\b(testimonial|review|quote)\b/],
  ["team or people", /\b(team|people|founders?|staff|customers?|portrait)\b/]
];
const ROLE_SHOWS = Object.freeze({ screenshot: "app screen", "product-image": "product photo", "screen-recording": "screen recording of the product", "talking-head": "person on camera", "b-roll": "b-roll footage" });
// Where each kind of asset usually earns its place in the story.
const FITS = Object.freeze({
  "pricing page": ["the price or offer line", "the call to action"],
  "onboarding flow": ["how it works", "getting started"],
  "login screen": ["getting started"],
  dashboard: ["how it works", "the proof or result line"],
  chart: ["the proof or number line"],
  "settings screen": ["a how-it-works detail"],
  checkout: ["the price or offer line", "the call to action"],
  "code or terminal": ["how it works"],
  "chat or inbox": ["the problem line", "how it works"],
  calendar: ["how it works"],
  map: ["where it happens"],
  "landing page": ["the opening", "the call to action"],
  testimonial: ["the proof line"],
  "team or people": ["who it is for", "the proof line"],
  "app screen": ["how it works"],
  "product photo": ["the opening", "the line that names the product"],
  "screen recording of the product": ["how it works", "the demo line"],
  "person on camera": ["the opening", "the proof line"],
  "b-roll footage": ["under a line it illustrates"]
});

const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["shows", "description", "text", "fits", "people", "windows"],
  properties: {
    shows: { type: "string", description: "What the asset is, in two to four words: pricing page, dashboard, onboarding flow, product photo, person on camera, b-roll of a street, bar chart." },
    description: { type: "string", description: "One sentence on what is visibly there." },
    text: { type: "array", items: { type: "string" }, description: "Up to eight key words or short lines readable on screen, exactly as written." },
    fits: { type: "array", items: { type: "string" }, description: "One to three story beats it suits: the opening, the problem line, how it works, the proof or number line, the price or offer line, the call to action." },
    people: { type: "boolean", description: "Whether a person is visible." },
    windows: {
      type: "array",
      description: "For a video only: the time ranges worth showing, from the frame times given. Empty for an image.",
      items: { type: "object", additionalProperties: false, required: ["start", "end", "note"], properties: { start: { type: "number" }, end: { type: "number" }, note: { type: "string" } } }
    }
  }
};

const VISION_INSTRUCTIONS = `You describe one file a user handed in for a short marketing or explainer video, so a director can place it on the right line. Say only what is visibly there: never guess what a product does beyond the pixels. For a video you see a few frames with their times; use those times for the windows and leave windows empty when the frames do not show which parts are worth using. Return the JSON only.`;

/** Where descriptions are cached: one JSON per content hash. */
export function descriptionCacheDir(env = process.env) {
  env = env ?? process.env;
  if (env.LAUNCHCLIP_ASSET_DESCRIPTIONS_DIR) return path.resolve(env.LAUNCHCLIP_ASSET_DESCRIPTIONS_DIR);
  // The process's own setting holds for a caller that passes a bare env (the test runner pins it).
  const own = pinnedCache("asset-descriptions") ?? (process.env.LAUNCHCLIP_ASSET_DESCRIPTIONS_DIR ? path.resolve(process.env.LAUNCHCLIP_ASSET_DESCRIPTIONS_DIR) : null);
  return own ?? (env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "asset-descriptions") : path.join(os.homedir(), ".cache", "launchclip", "asset-descriptions"));
}

/** Whether an inventory entry is one this module describes: a non-logo image or a video. */
export function isDescribable(entry) {
  return (entry?.kind === "image" && entry.role !== "logo") || entry?.kind === "video";
}

/**
 * Describe every image and video of an inventory (src/make/assets.js), in
 * place: entry.notes gains the computed fields under the caller's own, and
 * entry.understanding says where they came from ({source, sha256, cached,
 * model?}). options: {root (the assets folder; default inventory.dir), mode
 * ("auto" | "local" | "off"), client ({runStructured}, used when vision is
 * true), vision, model (its name, for the record), cacheDir, limit,
 * adapters: {hash(file), motion(file, entry) → {moving_spans, duration} | null,
 * ocr(file, entry) → [lines] | null, images(file, entry) → {images: [{url,
 * detail}], times: [seconds]}}, notice(line)}.
 * → {described: [{path, source, cached}], results: [model results, for
 *    costs], warnings, counts: {notes, vision, local}}
 */
export async function describeInventory(inventory, options = {}) {
  const { mode = "auto", client = null, vision = false, model = null, limit = MAX_VISION_FILES, notice = () => {} } = options;
  const out = { described: [], results: [], warnings: [], counts: { notes: 0, vision: 0, local: 0 } };
  const entries = (inventory?.entries ?? []).filter(isDescribable);
  for (const entry of inventory?.entries ?? []) delete entry.understanding;
  if (mode === "off" || !entries.length) return out;
  const root = options.root ?? inventory?.dir ?? null;
  const cacheDir = options.cacheDir ?? descriptionCacheDir(options.env);
  const adapters = { hash: fileSha256, motion: motionFacts, ocr: tesseractLines, images: visionImages, ...(options.adapters ?? {}) };
  const useVision = mode === "auto" && vision && typeof client?.runStructured === "function";
  let calls = 0;
  let announced = false;
  let limited = false;
  for (const entry of entries) {
    const own = entry.notes ?? null;
    // The caller already says what it shows: theirs stands, nothing is computed.
    if (own?.shows || own?.description) {
      entry.understanding = { source: "notes" };
      out.counts.notes += 1;
      out.described.push({ path: entry.path, source: "notes", cached: false });
      continue;
    }
    const file = root ? path.join(root, entry.path) : null;
    let sha = null;
    try { sha = file ? await adapters.hash(file) : null; } catch { sha = null; }
    if (!sha) continue; // listed but unreadable: it keeps the inventory's own line
    const cacheFile = path.join(cacheDir, `${sha}.json`);
    const cached = await readCache(cacheFile);
    let source = null;
    let notes = null;
    let hit = false;
    let usedModel = null;
    // A vision description made earlier is reused even when this run has no model.
    if (mode !== "local" && cached.vision?.notes) { source = "vision"; notes = cached.vision.notes; usedModel = cached.vision.model ?? null; hit = true; }
    else if (useVision && path.extname(entry.path).toLowerCase() !== ".svg") {
      if (calls >= limit) {
        if (!limited) out.warnings.push(`more than ${limit} files to describe; the rest are described from their names and frames (run again to describe more with the model)`);
        limited = true;
      } else {
        calls += 1;
        if (!announced) { notice(`assets: PAID calls to ${model ?? "the model"} to describe what each new image and clip shows (one per file, cached by content; --asset-descriptions local turns this off)`); announced = true; }
        try {
          const seen = await describeWithVision(file, entry, { client, adapters });
          out.results.push(seen.result);
          if (seen.notes) {
            source = "vision"; notes = seen.notes; usedModel = seen.result?.model ?? model;
            await writeCache(cacheFile, { ...cached, version: UNDERSTANDING_VERSION, vision: { model: usedModel, notes } });
          } else out.warnings.push(`the model returned no usable description of ${entry.path}; described from its name and frames`);
        } catch (error) {
          out.warnings.push(`the model could not describe ${entry.path} (${String(error?.message ?? error).split("\n")[0]}); described from its name and frames`);
        }
      }
    }
    if (!notes) {
      if (cached.local?.notes && cached.local.path === entry.path) { notes = cached.local.notes; hit = true; }
      else {
        const motion = entry.kind === "video" ? await adapters.motion(file, entry).catch(() => null) : null;
        const lines = await Promise.resolve(adapters.ocr(file, entry)).catch(() => null);
        notes = localDescription(entry, { motion, text: lines });
        // The local guess reads the path, so it is cached for this path only.
        await writeCache(cacheFile, { ...cached, version: UNDERSTANDING_VERSION, local: { path: entry.path, notes } }).catch(() => {});
      }
      source = "local";
    }
    const merged = { ...notes, ...(own ?? {}) };
    if (entry.kind !== "video") delete merged.windows;
    entry.notes = merged;
    entry.understanding = { source, sha256: sha, cached: hit, ...(usedModel ? { model: usedModel } : {}) };
    out.counts[source] += 1;
    out.described.push({ path: entry.path, source, cached: hit });
  }
  return out;
}

/**
 * Notes for one inventory entry without a model. facts: {motion:
 * {moving_spans: [[from, to]], duration} | null, text: [lines] | null}.
 */
export function localDescription(entry, { motion = null, text = null } = {}) {
  const words = String(entry?.path ?? "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, " ");
  const lines = cleanLines(text);
  const read = lines.join(" ").toLowerCase();
  const named = SHOW_HINTS.find(([, pattern]) => pattern.test(words));
  // Words read off a screen say what it is when the name does not; a camera clip's stray words do not.
  const readable = !named && ["screenshot", "screen-recording"].includes(entry?.role) ? SHOW_HINTS.find(([, pattern]) => pattern.test(read)) : null;
  // A person on camera or b-roll stays what the inventory heard and saw, whatever its name says.
  const shows = ["talking-head"].includes(entry?.role) ? ROLE_SHOWS[entry.role] : (named ?? readable)?.[0] ?? ROLE_SHOWS[entry?.role] ?? "image";
  const width = Number(entry?.media?.width), height = Number(entry?.media?.height);
  const orientation = width > 0 && height > 0 ? (width > height ? "landscape" : width < height ? "portrait" : "square") : null;
  const basis = named ? "its file name" : readable ? "the words on it" : "its shape and sound";
  const raw = {
    shows,
    description: `${entry?.kind === "video" ? "A clip" : "An image"} that looks like a ${shows} (from ${basis}; not looked at by a model)`,
    ...(lines.length ? { text: lines } : {}),
    fits: FITS[shows] ?? [],
    ...(orientation ? { orientation } : {}),
    ...(entry?.role === "talking-head" ? { people: true } : {})
  };
  if (entry?.kind === "video") {
    const windows = movingWindows(motion, Number(entry?.media?.duration) || Number(motion?.duration) || 0);
    if (windows.length) raw.windows = windows;
  }
  return normalizeNotes(raw, entry?.path ?? "asset").notes ?? { shows };
}

/** The stretches of a clip where something moves, as windows; none when it moves (or holds still) throughout. */
export function movingWindows(motion, duration) {
  const spans = (motion?.moving_spans ?? []).map(([from, to]) => [Math.max(0, from), duration > 0 ? Math.min(duration, to) : to]).filter(([from, to]) => to - from >= MIN_WINDOW_SECONDS);
  if (!spans.length || !(duration > 0)) return [];
  const moving = spans.reduce((sum, [from, to]) => sum + (to - from), 0);
  if (moving / duration > 1 - STILL_SHARE_FOR_WINDOWS) return [];
  return spans.slice(0, 12).map(([from, to]) => ({ start: Math.round(from * 100) / 100, end: Math.round(to * 100) / 100, note: "something moves on screen" }));
}

function cleanLines(text) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(text) ? text : []) {
    const line = String(raw ?? "").replace(/\s+/g, " ").trim();
    const letters = (line.match(/[\p{L}\p{N}]/gu) ?? []).length;
    // Keep what reads as words: mostly letters and digits, not a stray glyph or a long paragraph.
    if (line.length < 3 || line.length > 80 || letters / line.length < 0.6 || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
    if (out.length >= 8) break;
  }
  return out;
}

async function describeWithVision(file, entry, { client, adapters }) {
  const { images, times } = await adapters.images(file, entry);
  if (!images?.length) throw new Error("no frame could be read");
  const duration = Number(entry.media?.duration) || null;
  const input = [
    `File: ${entry.path} (${entry.kind}${entry.media?.width ? `, ${entry.media.width}×${entry.media.height}` : ""}${duration ? `, ${duration} s` : ""}).`,
    `The inventory's guess from its name, shape and sound: ${entry.description}.`,
    entry.kind === "video" ? `You see ${images.length} frames, taken at ${times.map((time) => `${time} s`).join(", ")}.` : "You see the image."
  ].join("\n");
  const result = await client.runStructured({ instructions: VISION_INSTRUCTIONS, input, images, schema: VISION_SCHEMA, schemaName: "launchclip_asset_description", maxOutputTokens: 1200 });
  const value = result?.value ?? parseJsonText(result?.text);
  if (!value || typeof value !== "object") return { notes: null, result };
  const raw = {
    shows: value.shows,
    description: value.description,
    ...(Array.isArray(value.text) && value.text.length ? { text: value.text } : {}),
    ...(Array.isArray(value.fits) && value.fits.length ? { fits: value.fits } : {}),
    ...(typeof value.people === "boolean" ? { people: value.people } : {}),
    ...(entry.kind === "video" && Array.isArray(value.windows) && value.windows.length ? { windows: value.windows.filter((window) => !duration || Number(window?.end) <= duration + 0.5).map((window) => ({ ...window, end: duration ? Math.min(duration, Number(window.end)) : window.end })) } : {})
  };
  const width = Number(entry.media?.width), height = Number(entry.media?.height);
  if (width > 0 && height > 0) raw.orientation = width > height ? "landscape" : width < height ? "portrait" : "square";
  const { notes } = normalizeNotes(raw, entry.path);
  return { notes: notes?.shows || notes?.description ? notes : null, result };
}

function parseJsonText(text) {
  if (typeof text !== "string") return null;
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Signals (each replaceable through options.adapters)

async function fileSha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Where a clip moves, read at media_presence.js's grid and rate (the first two minutes). */
async function motionFacts(file, entry) {
  const duration = Math.min(MEDIA_PRESENCE.maxSeconds, Number(entry?.media?.duration) || 0);
  if (!(duration > 0)) return null;
  const decoded = await decodeFrames(file, { kind: "video", start: 0, duration, fps: MEDIA_PRESENCE.fps });
  const facts = decoded ? mediaPresenceFacts(decoded.frames, { width: decoded.width, height: decoded.height, fps: MEDIA_PRESENCE.fps }) : null;
  return facts ? { moving_spans: facts.moving_spans, duration } : null;
}

let tesseract;
/** The lines Tesseract reads off an image (or a clip's middle frame); null when it is not installed. */
async function tesseractLines(file, entry) {
  if (tesseract === undefined) tesseract = await run("tesseract", ["--version"]).then(() => true, () => false);
  if (!tesseract || /\.svg$/i.test(file)) return null;
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-ocr-"));
  try {
    const frame = path.join(temp, "frame.png");
    const at = entry?.kind === "video" ? Math.max(0, (Number(entry.media?.duration) || 0) / 2) : 0;
    await run("ffmpeg", ["-v", "error", "-nostdin", ...(entry?.kind === "video" ? ["-ss", String(at)] : []), "-i", file, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", frame]);
    const { stdout } = await run("tesseract", [frame, "stdout", "--psm", "11"], { maxBuffer: 1 << 22 });
    return stdout.split("\n");
  } catch {
    return null;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** The image (scaled down), or four frames of a video, as data URLs. → {images, times} */
async function visionImages(file, entry) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "launchclip-describe-"));
  try {
    const video = entry.kind === "video";
    const duration = Number(entry.media?.duration) || 0;
    const times = video ? VIDEO_FRAME_SHARES.map((share) => Math.round(duration * share * 10) / 10) : [0];
    const side = video ? VISION_FRAME_SIDE : VISION_IMAGE_SIDE;
    const images = [];
    const kept = [];
    for (const [index, time] of times.entries()) {
      const frame = path.join(temp, `frame-${index}.jpg`);
      try {
        await run("ffmpeg", ["-v", "error", "-nostdin", ...(video ? ["-ss", String(time)] : []), "-i", file, "-frames:v", "1", "-vf", `scale='if(gte(iw,ih),min(${side},iw),-2)':'if(gte(iw,ih),-2,min(${side},ih))'`, "-q:v", "4", frame]);
        images.push({ url: `data:image/jpeg;base64,${(await readFile(frame)).toString("base64")}`, detail: video ? "low" : "high" });
        kept.push(time);
      } catch { /* a frame past the end: the others still describe the clip */ }
    }
    return { images, times: kept };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function readCache(file) {
  try {
    const doc = JSON.parse(await readFile(file, "utf8"));
    return doc?.version === UNDERSTANDING_VERSION ? doc : {};
  } catch { return {}; }
}

async function writeCache(file, doc) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(doc, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Featured assets

const SHOW_VERBS = /\b(show|shows|showing|feature|features|featuring|use|using|include|including|highlight|highlighting|walk through|demo|open on|open with|start with|end on|end with)\b/;

/**
 * The handed-in files the user clearly meant to be in the video, each with
 * the reason. media: [{src, kind, notes?, understanding?}] (the files a scene
 * can show). A file is featured when its notes say so (`feature: true`), the
 * prompt names it (its file name), the prompt asks to show what it is and it
 * is the only file that is one, or it is one of FEW_ASSETS or fewer handed
 * in. A file the notes call low quality is never featured by the last two.
 * → [{src, reason}]
 */
export function featuredAssets(media, { prompt = "" } = {}) {
  const list = (media ?? []).filter((item) => item?.src && ["image", "video"].includes(item.kind));
  const text = ` ${String(prompt ?? "").toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ")} `;
  const sentences = String(prompt ?? "").toLowerCase().split(/(?<=[.!?])\s+|\n+/);
  const byShows = new Map();
  for (const item of list) if (item.notes?.shows) byShows.set(item.notes.shows, [...(byShows.get(item.notes.shows) ?? []), item]);
  const out = [];
  for (const item of list) {
    const base = String(item.src).split("/").pop().toLowerCase();
    const stem = base.replace(/\.[a-z0-9]+$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const low = item.notes?.quality !== undefined && item.notes.quality < LOW_QUALITY;
    const shows = item.notes?.shows;
    let reason = null;
    if (item.notes?.feature === true) reason = "its notes say to feature it";
    else if (item.notes?.feature === false) reason = null;
    else if (text.includes(` ${base} `) || (stem.length >= 5 && /\s/.test(stem) && text.replace(/\./g, " ").includes(` ${stem} `))) reason = "the prompt names it";
    else if (!low && shows && byShows.get(shows).length === 1 && sentences.some((sentence) => SHOW_VERBS.test(sentence) && sentence.includes(shows))) reason = `the prompt asks to show the ${shows}`;
    else if (!low && list.length <= FEW_ASSETS) reason = list.length === 1 ? "it is the only file handed in" : `it is one of only ${list.length} files handed in`;
    if (reason) out.push({ src: item.src, reason, ...(shows ? { shows } : {}) });
  }
  return out;
}

/** Every string in a storyboard that names a file: the srcs its scenes show. */
export function storyboardSources(storyboard) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === "string") { if (/^(\.\/)?assets\//.test(value)) found.add(value.replace(/^\.\//, "")); }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(storyboard?.scenes ?? []);
  return found;
}

/**
 * The featured files no scene shows, as repair errors ("featured: …"). A
 * storyboard that fails only these still ships, with the errors as warnings.
 */
export function unusedFeatured(storyboard, featured = []) {
  if (!featured?.length || !Array.isArray(storyboard?.scenes)) return [];
  const used = storyboardSources(storyboard);
  return featured.filter((item) => !used.has(item.src)).map((item) => `featured: ${item.src}${item.shows ? ` (a ${item.shows})` : ""} is not in the storyboard, and ${item.reason}. Give it a scene on the line it fits best, used the way the asset list says to use it.`);
}

/** The planner's prompt section naming the featured files. */
export function featuredPrompt(featured = []) {
  if (!featured?.length) return "";
  return ["## Files the user wants in the video", "", "Each of these must appear in at least one scene, on the line it fits best:", "", ...featured.map((item) => `- ${item.src}${item.shows ? ` (a ${item.shows})` : ""}: ${item.reason}.`)].join("\n");
}
