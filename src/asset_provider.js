// The asset-provider hook: an app that embeds the engine (src/engine) can
// supply real shots inside motion-graphics stories, from its media library or
// generated on demand. With an `assets` provider, planStoryboard tells the
// model it may ask for a shot instead of naming a file:
//
//   {module: "photo-scene", params: {media: {kind: "shot", shows: "a barista
//     pouring latte art, close up", type?: "image" | "video" | "any"}, ...}}
//
// (photo-scene, media-window and clip take media; cards with an image slot
// take one there too, SHOT_CARD_SLOTS, e.g. device-frame params.image or
// social-post params.media.image). Before the storyboard is
// checked, each request goes to provider.findShot(request) with the line it
// sits under; the shot that comes back replaces the request as a project
// assets/ path, so the story contract (assets/ media only) and both renderers
// are unchanged. A card slot shows images only, so a video shot lands there
// as a still frame. No shot (null) becomes a repair note, and the model
// designs that scene without one.
//
// request: {id, scene_id, module, slot (the param path, "media" or e.g.
//   "image"), still (true: the slot shows a still, so a video answer becomes
//   one frame of it), shows, type: "image"|"video"|"any",
//   line (the narration under the scene, when the words are known), start,
//   end, duration (seconds, null when unresolved), format: {width, height,
//   aspect}, brief}
// shot: {kind?: "image"|"video", and one of:
//   src: "assets/…" (already in the project),
//   file: an absolute path the engine copies into <project>/assets/shots/,
//   url: a URL the app serves (the story names assets/shots/<id>.<ext>; the
//     app maps it back, e.g. @launchclip/remotion setAssetResolver),
//   sourceStart?: seconds into a video, focus?: {x, y} 0–1 (where the subject
//   sits, so a clip scene crops around it), source?: {provider, id, license,
//   generated, prompt, ...} (recorded in the plan report), cost_usd?,
//   description?: what the shot shows, notes?: text or footage notes
//   (src/inventory_notes.js: description, subjects, tags, quality, people,
//   faces, windows...), windows?: [{start, end, quality?, note?}] (its usable
//   stretches, seconds into a video), duration?: its length in seconds} | null
// (or the flat shape normalizeShot() accepts). A shot's notes go to the
// planner's repair passes and its usable windows set where a video starts.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { moduleTiming } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { bestWindow, normalizeNotes } from "./inventory_notes.js";

export const SHOT_REQUEST = "shot";
export const SHOT_MODULES = Object.freeze(["photo-scene", "media-window", "clip"]);
// Cards whose image slot may hold a shot request: module → param path. Each
// shows a still, so a video shot lands there as one frame of it.
export const SHOT_CARD_SLOTS = Object.freeze({
  "device-frame": "image",
  "window-chrome": "image",
  polaroid: "image",
  "archive-card": "image",
  "social-post": "media.image",
  "person-id": "image"
});
export const SHOTS_DIR = "assets/shots";
const IMAGE = /\.(jpe?g|png|webp|svg)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;

/** The most shots any plan may ask for, however long (--min-shots' ceiling). */
export const MAX_SHOT_REQUESTS = 24;
// Short-form cuts every few seconds: a plan may ask for about one shot per
// SHOT_SECONDS of video, and never fewer than DEFAULT_SHOT_REQUESTS.
const SHOT_SECONDS = 3;
const DEFAULT_SHOT_REQUESTS = 6;

/** How many shots a plan of this length may ask for (DEFAULT_SHOT_REQUESTS when the length is unknown). */
export function shotRequestLimit(durationSeconds) {
  const seconds = Number(durationSeconds);
  if (!(seconds > 0)) return DEFAULT_SHOT_REQUESTS;
  return Math.min(MAX_SHOT_REQUESTS, Math.max(DEFAULT_SHOT_REQUESTS, Math.ceil(seconds / SHOT_SECONDS)));
}

/**
 * The planning-prompt section that offers shot requests (only with a
 * provider). min > 0 (make --min-shots) means the app has a library to cut
 * to: the text asks for real footage as often as it keeps the video moving,
 * with min as a floor, not a target; with min 0 it is the optional offer.
 * max is shotRequestLimit() for the video's length.
 */
export function shotPrompt({ min = 0, max = DEFAULT_SHOT_REQUESTS } = {}) {
  const floor = Math.min(Math.max(0, Math.floor(Number(min) || 0)), max);
  if (floor > 0) {
    return [
      "Shots from the app's media library: in a clip, photo-scene or media-window scene set params.media to {kind: \"shot\", shows: \"<what the shot must show, concretely>\", type?: \"image\" | \"video\" | \"any\"} instead of an assets/ path. A clip scene shows the shot full frame, cut to its line.",
      cardShotLine(),
      "The app's library has real footage for this brand, and the app finds or generates each shot for the line the scene sits under, after you plan. Show concrete subjects (places, products, people doing things) as shots, not drawn; keep data, steps and comparisons as motion graphics.",
      "Short-form moves fast: cut to a shot whenever the narration names something real, and as often as it keeps the video fast, dynamic and engaging. Asking for more shots than the app can find is fine: it answers what it can, and you design the rest as motion graphics.",
      `Ask for at least ${floor} and up to ${max} shots; make each "shows" specific enough to search for (subject, action, framing), with no brand names or text in the frame.`,
      shotLengthLine()
    ].filter(Boolean).join("\n");
  }
  return [
    "Shots from the app's media library: in a clip, photo-scene or media-window scene you may set params.media to {kind: \"shot\", shows: \"<what the shot must show, concretely>\", type?: \"image\" | \"video\" | \"any\"} instead of an assets/ path. A clip scene shows the shot full frame, cut to its line.",
    cardShotLine(),
    "The app finds or generates that shot for the line the scene sits under, after you plan. Ask for one where a real photo or clip of a concrete subject (a place, an object, people doing something) says more than a graphic; keep data, steps and comparisons as motion graphics.",
    `Ask for at most ${max} shots; make each "shows" specific enough to search for (subject, action, framing), with no brand names or text in the frame.`,
    shotLengthLine()
  ].filter(Boolean).join("\n");
}

// Cards can carry library shots too, so the video shows real footage more often.
function cardShotLine() {
  const slots = Object.entries(SHOT_CARD_SLOTS).map(([id, slot]) => `${id} params.${slot}`).join(", ");
  return `Cards can carry library shots too: the same {kind: "shot", shows, type?} request goes in a card's image slot (${slots}) where a real photo says more than the card's placeholder (a phone or browser showing the product in use, a polaroid of the place, an archive photo, the image on a post). These slots show a still: a video shot lands there as one frame of it. Ask for a person-id image only for a shot of that very person. Count card shots with the rest.`;
}

// Each shot module's shortest scene, from the modules' own timing tables.
function shotLengthLine() {
  const lengths = SHOT_MODULES.map((id) => [id, Number(moduleTiming(id)?.minDuration)]).filter(([, seconds]) => seconds > 0);
  if (!lengths.length) return "";
  return `A shot scene is no shorter than ${lengths.map(([id, seconds]) => `${seconds} s (${id})`).join(", ")}, measured between the words it is anchored to; one or two spoken words are usually shorter. For a quick list of things, give each item a shot about 2 s long, anchored across its words, or one shot that shows the whole list.`;
}

/** The repair note when a storyboard asks for fewer than min shots ("" when it asks for enough). */
export function minShotsError(requested, min) {
  if (!(min > 0) || requested >= min) return "";
  return `shots: ask for at least ${min} shot${min === 1 ? "" : "s"} from the app's library; this storyboard asks for ${requested}. Show concrete subjects (places, products, people doing things) as {kind: "shot"} media in clip, photo-scene or media-window scenes, or in a card's image slot, instead of drawing them`;
}

const isRequest = (media) => media && typeof media === "object" && media.kind === SHOT_REQUEST;

const pathValue = (params, slot) => slot.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), params);
const withPath = (params, slot, value) => {
  const [key, ...rest] = slot.split(".");
  return { ...params, [key]: rest.length ? withPath(params?.[key] ?? {}, rest.join("."), value) : value };
};

/**
 * Shot requests in a storyboard: [{index, scene, slot, still}]. slot is the
 * param path ("media" in the shot modules, SHOT_CARD_SLOTS in a card); a
 * request anywhere else is still found (at params.media), so it is reported.
 */
export function shotRequests(storyboard) {
  return (storyboard?.scenes ?? []).flatMap((scene, index) => {
    const card = SHOT_CARD_SLOTS[scene?.module];
    if (card && isRequest(pathValue(scene?.params, card))) return [{ index, scene, slot: card, still: true }];
    return isRequest(scene?.params?.media) ? [{ index, scene, slot: "media", still: false }] : [];
  });
}

/** Scene id → {start, end} in seconds, from the story resolved against the words (empty when it cannot resolve yet). */
function sceneTimes(storyboard, words) {
  try {
    const resolved = resolveStory(storyboard, { words });
    return new Map((resolved.scenes ?? []).map((scene) => [scene.id, { start: Number(scene.start), end: Number(scene.end) }]));
  } catch {
    return new Map();
  }
}

function lineUnder(words, times) {
  if (!times || !words?.length) return null;
  const text = words.filter((word) => Number(word.start) < times.end && Number(word.end) > times.start).map((word) => String(word.text ?? word.word ?? "").trim()).filter(Boolean).join(" ");
  return text || null;
}

const extensionOf = (value) => {
  const clean = String(value ?? "").split(/[?#]/)[0];
  const match = /\.([a-z0-9]+)$/i.exec(clean);
  return match ? `.${match[1].toLowerCase()}` : "";
};

/**
 * Asks the provider for every shot request in the storyboard and writes the
 * answers in. → {storyboard (a copy), shots: [{scene_id, shows, src, kind,
 * url?, source?, notes?, duration?}], media: [{src, kind, duration?, notes}]
 * (the placed shots that carry notes, in the planner's media shape),
 * errors: ["scene <id>: …"]}. cache: a Map reused across repair attempts, so
 * the same request is asked once.
 */
export async function resolveShots(storyboard, { assets, words = [], brief = "", format = null, project = null, cache = new Map(), signal, stillFrame = ffmpegStill } = {}) {
  const requests = shotRequests(storyboard);
  if (!requests.length) return { storyboard, shots: [], media: [], errors: [] };
  const story = structuredClone(storyboard);
  const times = sceneTimes(storyboard, words);
  const width = Number(format?.width ?? storyboard.format?.width) || null;
  const height = Number(format?.height ?? storyboard.format?.height) || null;
  const shots = [];
  const described = [];
  const errors = [];
  for (const { index, scene, slot, still } of requests) {
    const media = pathValue(scene.params, slot);
    const shows = String(media.shows ?? "").trim();
    const where = `scene ${scene.id ?? index + 1}`;
    if (!still && !SHOT_MODULES.includes(scene.module)) { errors.push(`${where}: shot requests are for ${SHOT_MODULES.join(", ")} scenes and card image slots (${Object.entries(SHOT_CARD_SLOTS).map(([id, at]) => `${id} params.${at}`).join(", ")}), not ${scene.module}`); continue; }
    if (!shows) { errors.push(`${where}: a shot request needs "shows" (what the shot must show)`); continue; }
    const type = ["image", "video", "any"].includes(media.type) ? media.type : "any";
    const span = times.get(scene.id) ?? null;
    const request = {
      id: `${scene.id}-${createHash("sha256").update(JSON.stringify([shows, type, width, height])).digest("hex").slice(0, 10)}`,
      scene_id: scene.id ?? null,
      module: scene.module,
      slot,
      still,
      shows,
      type,
      line: lineUnder(words, span),
      start: span?.start ?? null,
      end: span?.end ?? null,
      duration: span ? Math.max(0, span.end - span.start) : null,
      format: { width, height, aspect: width && height ? (width / height >= 1 ? (width / height > 1.2 ? "landscape" : "square") : "portrait") : null },
      brief: String(brief ?? "")
    };
    const key = JSON.stringify([request.shows, request.type, width, height]);
    if (!cache.has(key)) cache.set(key, Promise.resolve(assets.findShot(request, { signal })));
    let shot;
    try {
      shot = await cache.get(key);
    } catch (error) {
      errors.push(`${where}: the app could not find a shot that shows "${shows}" (${error?.message ?? error}); design this scene without one`);
      continue;
    }
    shot = normalizeShot(shot);
    if (!shot) { errors.push(`${where}: the app has no shot that shows "${shows}"; design this scene without one`); continue; }
    // A video with usable windows and no start of its own starts in the window that best fits the line.
    const window = shot.notes?.windows?.length && shot.sourceStart == null ? bestWindow(shot.notes, request.duration ?? 3, request.line ?? shows) : null;
    if (window) shot = { ...shot, sourceStart: window.start };
    const known = { ...(shot.notes ? { notes: shot.notes } : {}), ...(shot.duration > 0 ? { duration: shot.duration } : {}) };
    let placed;
    try {
      placed = await placeShot(shot, request, project);
      if (still && placed.kind === "video") placed = await placeStill(shot, placed, request, project, stillFrame);
    } catch (error) {
      errors.push(`${where}: ${error.message}`);
      continue;
    }
    const kind = placed.kind;
    if (still) {
      story.scenes[index] = { ...scene, params: withPath(scene.params, slot, placed.src) };
      shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind, src: placed.src, slot, ...(placed.from ? { still_of: placed.from } : {}), ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}), ...known });
      continue;
    }
    // A clip crops around the subject: the shot's focus (or a flat crop_hint {x, y}) when the plan set none.
    const focus = scene.module === "clip" && scene.params.focus === undefined ? shotFocus(shot) : null;
    story.scenes[index] = { ...scene, params: { ...scene.params, media: { kind, src: placed.src, ...(kind === "video" ? { sourceStart: Number(shot.sourceStart ?? 0) || 0 } : {}) }, ...(focus ? { focus } : {}) } };
    shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind, src: placed.src, ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}), ...known });
    if (shot.notes) described.push({ src: placed.src, kind, ...(shot.duration > 0 ? { duration: shot.duration } : {}), notes: shot.notes });
  }
  return { storyboard: story, shots, media: described, errors };
}

// The flat shape some apps answer with is accepted too: {path (= file), kind,
// source: "library" | "ai" | "none" (none = no shot), asset_id?, provider?,
// model?, cost_usd?, duration_s?, crop_hint?}; its fields go into source.
const FLAT_FIELDS = Object.freeze(["asset_id", "provider", "model", "cost_usd", "duration_s", "crop_hint"]);

export function normalizeShot(shot) {
  if (!shot || typeof shot !== "object" || shot.source === "none") return null;
  const flat = typeof shot.source === "string";
  const source = flat ? { origin: shot.source, ...Object.fromEntries(FLAT_FIELDS.filter((key) => shot[key] != null).map((key) => [key, shot[key]])) } : shot.source;
  const cost = Number(shot.cost_usd ?? source?.cost_usd);
  const duration = Number(shot.duration ?? shot.duration_s);
  const { notes, ...rest } = shot;
  const known = shotNotes(shot);
  return {
    ...rest,
    file: shot.file ?? shot.path,
    ...(source ? { source } : {}),
    cost_usd: Number.isFinite(cost) && cost > 0 ? cost : 0,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
    ...(known ? { notes: known } : {})
  };
}

/**
 * What the app says a shot shows, in the footage-notes shape
 * (src/inventory_notes.js): shot.notes (text, or a notes object), with
 * shot.description and shot.windows (or one shot.window) filling what notes
 * leave out. Fields that are not notes are dropped. → notes | null
 */
export function shotNotes(shot) {
  const given = typeof shot?.notes === "string" ? { description: shot.notes } : shot?.notes && typeof shot.notes === "object" && !Array.isArray(shot.notes) ? { ...shot.notes } : {};
  if (given.description === undefined && typeof shot?.description === "string") given.description = shot.description;
  if (given.windows === undefined && Array.isArray(shot?.windows)) given.windows = shot.windows;
  if (given.windows === undefined && shot?.window && typeof shot.window === "object") given.windows = [shot.window];
  if (!Object.keys(given).length) return null;
  const { version: _version, src: _src, ...raw } = given;
  return normalizeNotes(Object.fromEntries(Object.entries(raw).filter(([key]) => SHOT_NOTE_KEYS.includes(key))), "shot notes").notes;
}
const SHOT_NOTE_KEYS = Object.freeze(["description", "subjects", "tags", "quality", "orientation", "people", "faces", "role", "windows"]);

/** A shot's subject point {x, y} (0–1 fractions) from shot.focus or a flat crop_hint, else null. */
function shotFocus(shot) {
  const hint = shot.focus ?? shot.crop_hint ?? shot.source?.crop_hint;
  const x = Number(hint?.x), y = Number(hint?.y);
  return hint && typeof hint === "object" && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

/**
 * One frame of a video shot, for a slot that shows a still: written beside
 * the shot as assets/shots/<id>.jpg, from just after its sourceStart.
 * → {kind: "image", src, from (the video)}
 */
async function placeStill(shot, placed, request, project, stillFrame) {
  if (!project) throw new Error("the app returned a video for a card's image slot, but the plan has no project to take a still into");
  const video = shot.file && !shot.src ? path.resolve(String(shot.file)) : shot.src || shot.file ? path.join(project, placed.src) : null;
  if (!video) throw new Error(`the app returned a video by URL for a card's image slot (${slotName(request)}); return an image, or a video file to take a still from`);
  const src = `${SHOTS_DIR}/${request.id}-still.jpg`;
  const target = path.join(project, src);
  await mkdir(path.dirname(target), { recursive: true });
  const at = Math.max(0, Number(shot.sourceStart ?? 0) || 0) + 0.5;
  await stillFrame(video, at, target);
  return { kind: "image", src, from: placed.src };
}

const slotName = (request) => `${request.module} params.${request.slot}`;

/** Writes the frame of `video` at `at` seconds (or its first frame, when the video is shorter) to `target`. */
export async function ffmpegStill(video, at, target) {
  const run = (seconds) => promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-q:v", "2", target]);
  // Past the end ffmpeg writes nothing (and may exit non-zero): take the first frame then.
  await run(at).catch(() => null);
  const size = await stat(target).then((info) => info.size, () => 0);
  if (!size) await run(0);
}

async function placeShot(shot, request, project) {
  const from = shot.src ?? shot.file ?? shot.url;
  if (!from) throw new Error("the app's shot has no src, file or url");
  const ext = extensionOf(from);
  const kind = shot.kind ?? (VIDEO.test(ext) ? "video" : IMAGE.test(ext) ? "image" : null);
  if (!["image", "video"].includes(kind) || !(kind === "video" ? VIDEO : IMAGE).test(ext)) throw new Error(`the app's shot ${from} is not an image (.jpg, .png, .webp, .svg) or video (.mp4, .webm, .mov)`);
  if (request.type !== "any" && request.type !== kind) throw new Error(`the app returned a ${kind} for a ${request.type} request`);
  if (shot.src) {
    const src = String(shot.src);
    if (!src.startsWith("assets/") || src.split(/[\\/]/).includes("..")) throw new Error(`the app's shot src ${src} is not a project assets/ path`);
    return { kind, src };
  }
  const src = `${SHOTS_DIR}/${request.id}${ext}`;
  if (shot.file) {
    if (!project) throw new Error("the app returned a shot file, but the plan has no project to copy it into");
    const target = path.join(project, src);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.resolve(String(shot.file)), target);
  }
  return { kind, src };
}
