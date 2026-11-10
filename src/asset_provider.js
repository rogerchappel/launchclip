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
//
// Backdrop shots (make --card-backdrops footage): a full-screen card's plate
// may be real footage instead of a stock plate. scenes[i].backdrop =
// {kind: "shot", shows, treatment?: "dim" | "blur" | "tint"} asks for it
// (backdropPrompt; cardBackdrops() fills the card scenes the plan left
// without one). Its request adds role: "background", motion: "low" (a slow,
// steady shot text can sit on) and avoid: [{scene_id, src, asset_id?}] (the
// shots on the scenes either side, so the backdrop is not the shot just cut
// from or to), and is asked after every other shot. The clip that comes back
// is measured (measureFootage: its brightest level and how much it moves)
// and becomes a video plate (kit/core/plates.mjs) whose dim keeps the card's
// text at 4.5:1. A request the app has no shot for borrows a backdrop
// another card in the run already placed (not one beside it, least-used
// first); with none to borrow, the scene keeps the story's stock plate.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { moduleTiming } from "@launchclip/core/modules.mjs";
import { DARK_PLATE_KINDS } from "@launchclip/core/plates.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { bestWindow, normalizeNotes } from "./inventory_notes.js";
import { recordProvided } from "./provided_files.js";
import { MAX_SAME_CARD, SECONDS_PER_TEXT_CARD, TEXT_CARD_MODULES } from "./short_form_checks.js";

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
// Media layouts (kit/core/catalog-d-media-layouts.mjs): module → the param
// paths that may hold a shot request ("*" is each item of a list). They take
// moving footage, except media-list's thumbnails, which show a still.
export const SHOT_LAYOUT_SLOTS = Object.freeze({
  "split-screen": Object.freeze(["media"]),
  "landscape-card": Object.freeze(["media"]),
  "picture-in-picture": Object.freeze(["media"]),
  "media-stat": Object.freeze(["media"]),
  "media-compare": Object.freeze(["left.media", "right.media"]),
  "media-grid": Object.freeze(["items.*.media"]),
  "media-list": Object.freeze(["items.*.media"])
});
const STILL_LAYOUT_SLOTS = new Set(["media-list"]);
export const SHOTS_DIR = "assets/shots";
const IMAGE = /\.(jpe?g|png|webp|svg)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;

// Backdrop shots: their overlay treatments, how many a plan may ask for, the
// shortest card worth one, and the movement (mean frame-to-frame change,
// 0–1) past which the footage is too busy to sit text on.
export const BACKDROP_TREATMENTS = Object.freeze(["dim", "blur", "tint"]);
// Every full-screen card of a short video gets one (a 30–60 s piece has 6–12).
export const MAX_BACKDROP_REQUESTS = 12;
export const BACKDROP_MIN_SECONDS = 1.2;
export const BACKDROP_BUSY_MOTION = 0.08;

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
      layoutShotLine(),
      "The app's library has real footage for this brand, and the app finds or generates each shot for the line the scene sits under, after you plan. Show concrete subjects (places, products, people doing things) as shots, not drawn; keep data, steps and comparisons as motion graphics.",
      "Short-form moves fast: cut to a shot whenever the narration names something real, and as often as it keeps the video fast, dynamic and engaging. Asking for more shots than the app can find is fine: it answers what it can, and you design the rest as motion graphics.",
      footageFirstLine(),
      `Ask for at least ${floor} and up to ${max} shots; make each "shows" specific enough to search for (subject, action, framing), with no brand names or text in the frame.`,
      shotLengthLine()
    ].filter(Boolean).join("\n");
  }
  return [
    "Shots from the app's media library: in a clip, photo-scene or media-window scene you may set params.media to {kind: \"shot\", shows: \"<what the shot must show, concretely>\", type?: \"image\" | \"video\" | \"any\"} instead of an assets/ path. A clip scene shows the shot full frame, cut to its line.",
    cardShotLine(),
    layoutShotLine(),
    "The app finds or generates that shot for the line the scene sits under, after you plan. Ask for one where a real photo or clip of a concrete subject (a place, an object, people doing something) says more than a graphic; keep data, steps and comparisons as motion graphics.",
    `Ask for at most ${max} shots; make each "shows" specific enough to search for (subject, action, framing), with no brand names or text in the frame.`,
    footageFirstLine(),
    shotLengthLine()
  ].filter(Boolean).join("\n");
}

// With a library to cut from, footage carries the video: text and icon cards
// are the exception (src/short_form_checks.js checks the same limits), and a
// label on a shot says what the shot shows.
function footageFirstLine() {
  return [
    `Footage first: a text or icon card (${TEXT_CARD_MODULES.join(", ")}) is the exception, at most one for every ${SECONDS_PER_TEXT_CARD} s, never two in a row and never the same card module more than ${MAX_SAME_CARD} times. Say the other lines over a shot, with a callout for the key words.`,
    "Ask for what a working library of this subject plausibly holds (the finished result, the work in progress, the people, the place). A specific action or close-up (a product being applied, a material sample) may not exist: the line can still play over related footage.",
    "A callout or grid label names what the shot shows, never what you hoped it would show: the app's notes on each shot say what it shows, and tooling drops a label the notes do not support."
  ].join("\n");
}

// Cards can carry library shots too, so the video shows real footage more often.
function cardShotLine() {
  const slots = Object.entries(SHOT_CARD_SLOTS).map(([id, slot]) => `${id} params.${slot}`).join(", ");
  return [
    `Cards can carry library shots too: the same {kind: "shot", shows, type?} request goes in a card's image slot (${slots}) where a real photo says more than the card's placeholder (a phone or browser showing the product in use, an archive photo, the image on a post). These slots show a still: a video shot lands there as one frame of it. Ask for a person-id image only for a shot of that very person. Count card shots with the rest.`,
    "Vary how footage is framed: show real places, work and products in a clip (full frame, a callout for the key words), a photo-scene (a slow Ken Burns push or pan with a short text line) or one of the media layouts below, keep media-window for a screen or page capture, and change the treatment from one shot to the next. A polaroid is a novelty frame: at most once a video, never two in a row; tooling turns the rest into photo-scene, split-screen and clip inserts."
  ].join("\n");
}

// The media layouts: footage inside the design, with the line's words, a stat or a list beside it.
function layoutShotLine() {
  const slots = Object.entries(SHOT_LAYOUT_SLOTS).map(([id, paths]) => `${id} params.${paths.join(" and params.").replace(/\.\*\./g, "[i].")}`).join(", ");
  return [
    `Media layouts put library footage inside the design, so a footage line can also carry its point: the same {kind: "shot", shows, type?} request goes in ${slots} (media-list's thumbnails show a still).`,
    "Use split-screen when the shot and the line's title, stat or short list share the frame (footage top or bottom on 9:16); landscape-card for a wide shot with a title and a caption or chip (ask for landscape footage); picture-in-picture when a stat or list leads and the footage backs it up; media-compare for two options with footage of each (hardwood vs composite); media-stat for a figure with footage of what it measures, beside it or behind it; media-grid for two to four options shown together (\"three options\"), revealed on their words; media-list for steps or checks with a thumbnail each. Mix them with clip and photo-scene: a short video uses several different frames."
  ].join("\n");
}

// Each shot module's shortest scene, from the modules' own timing tables.
function shotLengthLine() {
  const lengths = SHOT_MODULES.map((id) => [id, Number(moduleTiming(id)?.minDuration)]).filter(([, seconds]) => seconds > 0);
  if (!lengths.length) return "";
  return `A shot scene is no shorter than ${lengths.map(([id, seconds]) => `${seconds} s (${id})`).join(", ")}, measured between the words it is anchored to; one or two spoken words are usually shorter. For a quick list of things, give each item a shot about 2 s long, anchored across its words, or one shot that shows the whole list.`;
}

/** The planning-prompt section that offers footage backdrops behind full-screen cards (with a provider and --card-backdrops footage). */
export function backdropPrompt({ max = MAX_BACKDROP_REQUESTS } = {}) {
  return [
    `Card backdrops from the app's media library: a full-screen card (a title, stat, list or comparison scene with no footage of its own) can sit on a slow, calm library clip instead of a stock plate. Set scenes[i].backdrop to {kind: "shot", shows: "<a steady, low-motion shot that sets the scene for the card's topic>", treatment?: "dim" | "blur" | "tint"}.`,
    "dim darkens the footage under the card (the default), blur softens it to an out-of-focus wash, tint lays a brand-coloured gradient over it. The app darkens it as far as the card's text needs to stay readable.",
    `Give every full-screen card one (at most ${max}) rather than a stock plate; choose footage that is calm (a slow pan, a still landscape, a product at rest), never the shot the scene before or after shows, and leave clip, photo-scene and media-window scenes without one (their footage is the frame).`
  ].join("\n");
}

/** The repair note when a storyboard asks for fewer than min shots ("" when it asks for enough). */
export function minShotsError(requested, min) {
  if (!(min > 0) || requested >= min) return "";
  return `shots: ask for at least ${min} shot${min === 1 ? "" : "s"} from the app's library; this storyboard asks for ${requested}. Show concrete subjects (places, products, people doing things) as {kind: "shot"} media in clip, photo-scene, media-window or media layout scenes (split-screen, landscape-card, picture-in-picture, media-compare, media-stat, media-grid, media-list), or in a card's image slot, instead of drawing them`;
}

const isRequest = (media) => media && typeof media === "object" && media.kind === SHOT_REQUEST;

const pathValue = (params, slot) => slot.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), params);
// A card's slot without its value (and without an object left empty by it).
const withoutPath = (params, slot) => {
  const [key, ...rest] = slot.split(".");
  const copy = Array.isArray(params) ? [...params] : { ...(params ?? {}) };
  if (!rest.length) { delete copy[key]; return copy; }
  const inner = withoutPath(copy[key], rest.join("."));
  if (Array.isArray(copy) || Object.keys(inner).length) copy[key] = inner;
  else delete copy[key];
  return copy;
};
const withPath = (params, slot, value) => {
  const [key, ...rest] = slot.split(".");
  const inner = rest.length ? withPath(params?.[key] ?? {}, rest.join("."), value) : value;
  if (Array.isArray(params)) return params.map((item, i) => (String(i) === key ? inner : item));
  return { ...params, [key]: inner };
};

/** A media layout scene's footage slots as concrete param paths ("items.*.media" → "items.0.media", …). */
export function layoutSlots(scene) {
  return (SHOT_LAYOUT_SLOTS[scene?.module] ?? []).flatMap((slot) => {
    if (!slot.includes("*")) return [slot];
    const [list, rest] = slot.split(".*.");
    const items = pathValue(scene.params, list);
    return Array.isArray(items) ? items.map((_, i) => `${list}.${i}.${rest}`) : [];
  });
}

/**
 * Shot requests in a storyboard: [{index, scene, slot, still}]. slot is the
 * param path ("media" in the shot modules, SHOT_CARD_SLOTS in a card); a
 * request anywhere else is still found (at params.media), so it is reported.
 */
export function shotRequests(storyboard) {
  return (storyboard?.scenes ?? []).flatMap((scene, index) => {
    if (SHOT_LAYOUT_SLOTS[scene?.module]) {
      const still = STILL_LAYOUT_SLOTS.has(scene.module);
      return layoutSlots(scene).filter((slot) => isRequest(pathValue(scene.params, slot))).map((slot) => ({ index, scene, slot, still, layout: true }));
    }
    const card = SHOT_CARD_SLOTS[scene?.module];
    if (card && isRequest(pathValue(scene?.params, card))) return [{ index, scene, slot: card, still: true }];
    return isRequest(scene?.params?.media) ? [{ index, scene, slot: "media", still: false }] : [];
  });
}

const isBackdropRequest = (value) => value && typeof value === "object" && !Array.isArray(value) && value.kind === SHOT_REQUEST;

/** Backdrop shot requests in a storyboard: [{index, scene}] (scenes[i].backdrop {kind: "shot"}). */
export function backdropRequests(storyboard) {
  return (storyboard?.scenes ?? []).flatMap((scene, index) => (isBackdropRequest(scene?.backdrop) ? [{ index, scene }] : []));
}

// A scene that is a full-screen card: on track 0, drawn by the module (not a
// shot module, a world or a scene naming footage or a still of its own) and
// on a background (ambient.background not off).
// A stock plate the plan chose for one scene (scenes[i].backdrop or .plate
// {kind: "bokeh"} and the like): with footage backdrops on, a card trades it
// for footage. A wash (a deliberate bright beat), "none", an image or a
// video the plan named stay.
const isStockPlate = (value) => Boolean(value) && typeof value === "object" && DARK_PLATE_KINDS.includes(value.kind);

function isCardScene(story, scene) {
  if ((scene?.track ?? 0) !== 0 || SHOT_MODULES.includes(scene?.module) || scene?.module === "world") return false;
  if ((scene?.backdrop !== undefined && !isStockPlate(scene.backdrop)) || (scene?.plate !== undefined && !isStockPlate(scene.plate))) return false;
  if ((scene?.ambient?.background ?? story?.ambient?.background) === false) return false;
  return !/"(?:assets\/[^"]+\.(?:mp4|webm|mov|jpe?g|png|webp|avif)|kind":"shot)"/i.test(JSON.stringify(scene?.params ?? {}));
}

/**
 * Footage backdrops for the full-screen cards a plan left on a stock plate
 * (none, or one it picked for the scene): up to `max` (less the backdrops it
 * already asks for) of its card scenes at
 * least BACKDROP_MIN_SECONDS long, longest first, each asking for a calm shot
 * of what the narration under it says (or the card's own text, or the brief).
 * → {storyboard (a copy), added: [scene ids]}
 */
export function cardBackdrops(storyboard, { words = [], brief = "", max = MAX_BACKDROP_REQUESTS, treatment = "dim" } = {}) {
  const room = Math.max(0, max - backdropRequests(storyboard).length);
  if (!room || storyboard?.lane === "footage-led") return { storyboard, added: [] };
  const times = sceneTimes(storyboard, words);
  const cards = (storyboard?.scenes ?? []).map((scene, index) => ({ scene, index, span: times.get(scene?.id) }))
    .filter(({ scene, span }) => isCardScene(storyboard, scene) && span && span.end - span.start >= BACKDROP_MIN_SECONDS)
    .sort((a, b) => (b.span.end - b.span.start) - (a.span.end - a.span.start) || a.index - b.index)
    .slice(0, room);
  if (!cards.length) return { storyboard, added: [] };
  const story = structuredClone(storyboard);
  for (const { scene, index, span } of cards) {
    const said = lineUnder(words, span) ?? cardText(scene) ?? String(brief ?? "").trim();
    const { plate: _plate, ...rest } = story.scenes[index];
    story.scenes[index] = { ...rest, backdrop: { kind: SHOT_REQUEST, shows: `a calm, steady shot that sets the scene for: ${said}`.slice(0, 300), treatment } };
  }
  return { storyboard: story, added: cards.map(({ scene }) => scene.id) };
}

// A card's own headline, for a backdrop request with no narration under it.
function cardText(scene) {
  const params = scene?.params ?? {};
  const text = ["title", "text", "headline", "heading", "label", "quote"].map((key) => params[key]).find((value) => typeof value === "string" && value.trim());
  return text ? text.trim() : null;
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
 * the same request is asked once. A provider with concurrency > 1 is asked
 * for every shot at once; otherwise one at a time, in scene order.
 */
export async function resolveShots(storyboard, { assets, words = [], brief = "", format = null, project = null, cache = new Map(), signal, stillFrame = ffmpegStill, measure = measureFootage } = {}) {
  const requests = shotRequests(storyboard);
  const backdrops = backdropRequests(storyboard);
  if (!requests.length && !backdrops.length) return { storyboard, shots: [], media: [], errors: [] };
  const story = structuredClone(storyboard);
  const times = sceneTimes(storyboard, words);
  const width = Number(format?.width ?? storyboard.format?.width) || null;
  const height = Number(format?.height ?? storyboard.format?.height) || null;
  const shots = [];
  const described = [];
  const errors = [];
  const warnings = [];
  // A card's image slot is optional: a shot that can't fill it leaves the
  // card with its own placeholder (a warning), not a failed plan.
  const miss = (still, index, scene, slot, line) => {
    if (!still) { errors.push(line); return; }
    const current = story.scenes[index];
    story.scenes[index] = { ...current, params: withoutPath(current.params, slot) };
    warnings.push(`${line.replace(/; design this scene without one$/, "")}; the ${scene.module} card keeps its placeholder`);
  };
  // Each request, checked and built first, so a provider that takes several
  // at once (assets.concurrency > 1) gets them all in flight before the first
  // answer is placed.
  const asked = [];
  for (const { index, scene, slot, still, layout } of requests) {
    const media = pathValue(scene.params, slot);
    const shows = String(media.shows ?? "").trim();
    const where = `scene ${scene.id ?? index + 1}`;
    if (!still && !layout && !SHOT_MODULES.includes(scene.module)) { errors.push(`${where}: shot requests are for ${SHOT_MODULES.join(", ")} scenes, the media layouts' footage slots (${Object.keys(SHOT_LAYOUT_SLOTS).join(", ")}) and card image slots (${Object.entries(SHOT_CARD_SLOTS).map(([id, at]) => `${id} params.${at}`).join(", ")}), not ${scene.module}`); continue; }
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
      // A landscape-card letterboxes its footage in a 16:9 window: landscape footage fits it without a crop.
      ...(scene.module === "landscape-card" ? { orientation: "landscape" } : {}),
      brief: String(brief ?? "")
    };
    asked.push({ index, scene, slot, still, layout, shows, where, request, key: JSON.stringify([request.shows, request.type, width, height]) });
  }
  const ask = (request) => {
    const answer = Promise.resolve(assets.findShot(request, { signal })).then((shot) => snapshotShot(shot, request, project));
    answer.catch(() => {}); // awaited below; a failure asked ahead is not unhandled
    return answer;
  };
  if (Number(assets.concurrency) > 1) {
    for (const { request, key } of asked) if (!cache.has(key)) cache.set(key, ask(request));
  }
  for (const { index, scene, slot, still, layout, shows, where, request, key } of asked) {
    if (!cache.has(key)) cache.set(key, ask(request));
    let shot;
    try {
      shot = await cache.get(key);
    } catch (error) {
      miss(still, index, scene, slot, `${where}: the app could not find a shot that shows "${shows}" (${error?.message ?? error}); design this scene without one`);
      continue;
    }
    shot = normalizeShot(shot);
    if (!shot) { miss(still, index, scene, slot, `${where}: the app has no shot that shows "${shows}"; design this scene without one`); continue; }
    // A video with usable windows and no start of its own starts in the window that best fits the line.
    const window = shot.notes?.windows?.length && shot.sourceStart == null ? bestWindow(shot.notes, request.duration ?? 3, request.line ?? shows) : null;
    if (window) shot = { ...shot, sourceStart: window.start };
    const known = { ...(shot.notes ? { notes: shot.notes } : {}), ...(shot.duration > 0 ? { duration: shot.duration } : {}) };
    let placed;
    try {
      placed = await placeShot(shot, request, project);
      if (still && placed.kind === "video") placed = await placeStill(shot, placed, request, project, stillFrame);
    } catch (error) {
      miss(still, index, scene, slot, `${where}: ${error.message}`);
      continue;
    }
    const kind = placed.kind;
    // A scene may take several shots (a media layout's slots): each writes into the scene as placed so far.
    const current = story.scenes[index];
    if (still) {
      story.scenes[index] = { ...current, params: withPath(current.params, slot, placed.src) };
      shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind, src: placed.src, slot, ...(placed.from ? { still_of: placed.from } : {}), ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}), ...known });
      continue;
    }
    // A clip crops around the subject: the shot's focus (or a flat crop_hint {x, y}) when the plan set none.
    if (layout) {
      // A layout window crops about the shot's focus, as a clip does.
      const focus = shotFocus(shot);
      story.scenes[index] = { ...current, params: withPath(current.params, slot, { kind, src: placed.src, ...(kind === "video" ? { sourceStart: Number(shot.sourceStart ?? 0) || 0 } : {}), ...(focus ? { focus } : {}) }) };
      shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind, src: placed.src, slot, ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}), ...known });
      if (shot.notes) described.push({ src: placed.src, kind, ...(shot.duration > 0 ? { duration: shot.duration } : {}), notes: shot.notes });
      continue;
    }
    const focus = scene.module === "clip" && scene.params.focus === undefined ? shotFocus(shot) : null;
    story.scenes[index] = { ...scene, params: { ...scene.params, media: { kind, src: placed.src, ...(kind === "video" ? { sourceStart: Number(shot.sourceStart ?? 0) || 0 } : {}) }, ...(focus ? { focus } : {}) } };
    shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind, src: placed.src, ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}), ...known });
    if (shot.notes) described.push({ src: placed.src, kind, ...(shot.duration > 0 ? { duration: shot.duration } : {}), notes: shot.notes });
  }
  // Backdrops last, so the shots either side are known and avoided.
  const context = { assets, words, brief, width, height, times, project, cache, signal, measure, story, shots, warnings };
  const missed = [];
  for (const { index, scene } of backdrops) await resolveBackdrop({ ...context, missed }, index, scene);
  borrowBackdrops(context, missed);
  return { storyboard: story, shots, media: described, errors, warnings };
}

// The shots on the track-0 scenes either side of scene `index` in start
// order: placed this run (shots), or footage the scene names itself.
function neighbourShots(story, index, times, shots) {
  const base = story.scenes.map((scene, i) => ({ scene, i, start: times.get(scene?.id)?.start ?? Number(scene?.start ?? i) }))
    .filter(({ scene }) => (scene?.track ?? 0) === 0).sort((a, b) => a.start - b.start || a.i - b.i);
  const at = base.findIndex(({ i }) => i === index);
  return [base[at - 1], base[at + 1]].filter(Boolean).flatMap(({ scene }) => {
    const placed = shots.filter((shot) => shot.scene_id === scene.id).map((shot) => ({ scene_id: scene.id, src: shot.src, ...(shotAssetId(shot) ? { asset_id: shotAssetId(shot) } : {}) }));
    const own = typeof scene?.params?.media?.src === "string" ? [{ scene_id: scene.id, src: scene.params.media.src }] : [];
    const plate = scene?.backdrop?.kind === "video" && typeof scene.backdrop.params?.src === "string" ? [{ scene_id: scene.id, src: scene.backdrop.params.src }] : [];
    return [...placed, ...(placed.length ? [] : own), ...plate];
  });
}

const shotAssetId = (shot) => {
  const id = shot?.source?.asset_id ?? shot?.source?.id ?? shot?.asset_id;
  return id == null || id === "" ? null : String(id);
};

// The cards whose backdrop request found nothing borrow a backdrop another
// card placed this run: never one a scene beside them shows, least-used
// first, so the run varies; with none to borrow, the story's plate stays.
function borrowBackdrops({ story, times, shots, warnings }, missed) {
  const placed = shots.filter((shot) => shot.slot === "backdrop");
  const uses = new Map(placed.map((shot) => [shot.src, 1]));
  for (const { index, scene, treatment, why } of missed) {
    const avoid = new Set(neighbourShots(story, index, times, shots).map((entry) => entry.src));
    const pick = [...new Map(placed.map((shot) => [shot.src, shot])).values()]
      .filter((shot) => !avoid.has(shot.src))
      .sort((a, b) => (uses.get(a.src) ?? 0) - (uses.get(b.src) ?? 0))[0];
    if (!pick) { warnings.push(`${why}; the card keeps the story's plate`); continue; }
    uses.set(pick.src, (uses.get(pick.src) ?? 0) + 1);
    // The lender's plate as placed (its start and measured peak), under this card's own treatment.
    const lent = story.scenes.find((entry) => entry?.id === pick.scene_id)?.backdrop;
    const backdrop = pick.kind === "image"
      ? { kind: "image", params: { src: pick.src } }
      : { kind: "video", params: { ...(lent?.kind === "video" ? lent.params : { src: pick.src }), treatment } };
    story.scenes[index] = { ...story.scenes[index], backdrop };
    warnings.push(`${why}; it borrows the backdrop ${pick.src} from scene ${pick.scene_id}`);
  }
}

// One backdrop request → a video plate on the scene (or an image plate for a
// still), or, with no usable shot, the scene back on the story's plate.
async function resolveBackdrop({ assets, words, brief, width, height, times, project, cache, signal, measure, story, shots, warnings, missed = null }, index, scene) {
  const media = scene.backdrop;
  const shows = String(media.shows ?? "").trim();
  const where = `scene ${scene.id ?? index + 1}`;
  const treatment = BACKDROP_TREATMENTS.includes(media.treatment) ? media.treatment : "dim";
  const fallback = (why) => {
    const { backdrop: _backdrop, ...rest } = story.scenes[index];
    story.scenes[index] = rest;
    // With other cards' backdrops still to come, borrowBackdrops may yet give it one.
    if (missed) { missed.push({ index, scene, treatment, why: `${where}: ${why}` }); return; }
    warnings.push(`${where}: ${why}; the card keeps the story's plate`);
  };
  if (!shows) { fallback('a backdrop shot request needs "shows" (what the shot must show)'); return; }
  const span = times.get(scene.id) ?? null;
  const avoid = neighbourShots(story, index, times, shots);
  const request = {
    id: `${scene.id}-backdrop-${createHash("sha256").update(JSON.stringify([shows, width, height, avoid])).digest("hex").slice(0, 10)}`,
    scene_id: scene.id ?? null,
    module: scene.module,
    slot: "backdrop",
    still: false,
    role: "background",
    motion: "low",
    avoid,
    shows,
    type: "video",
    line: lineUnder(words, span),
    start: span?.start ?? null,
    end: span?.end ?? null,
    duration: span ? Math.max(0, span.end - span.start) : null,
    format: { width, height, aspect: width && height ? (width / height >= 1 ? (width / height > 1.2 ? "landscape" : "square") : "portrait") : null },
    brief: String(brief ?? "")
  };
  const key = JSON.stringify(["backdrop", shows, width, height, avoid]);
  if (!cache.has(key)) cache.set(key, Promise.resolve(assets.findShot(request, { signal })));
  let shot;
  try {
    shot = normalizeShot(await cache.get(key));
  } catch (error) {
    fallback(`the app could not find a backdrop shot that shows "${shows}" (${error?.message ?? error})`);
    return;
  }
  if (!shot) { fallback(`the app has no backdrop shot that shows "${shows}"`); return; }
  const id = shotAssetId(shot);
  if (id && avoid.some((entry) => entry.asset_id === id)) { fallback(`the app's backdrop shot is the one a scene beside it shows (${id})`); return; }
  let placed;
  try {
    placed = await placeShot(shot, { ...request, type: "any" }, project);
  } catch (error) {
    fallback(error.message);
    return;
  }
  if (placed.kind === "image") {
    story.scenes[index] = { ...story.scenes[index], backdrop: { kind: "image", params: { src: placed.src } } };
    shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind: "image", src: placed.src, slot: "backdrop", ...(shot.source ? { source: shot.source } : {}) });
    return;
  }
  // Where it plays from: the shot's own start, else its usable window that best fits the line.
  const window = shot.notes?.windows?.length && shot.sourceStart == null ? bestWindow(shot.notes, request.duration ?? 3, request.line ?? shows) : null;
  const start = Math.max(0, Number(shot.sourceStart ?? window?.start ?? 0) || 0);
  const file = project ? path.join(project, placed.src) : shot.file ? path.resolve(String(shot.file)) : null;
  const measured = file ? await measure(file, { start, duration: request.duration ?? 4 }).catch(() => null) : null;
  const params = { src: placed.src, ...(start > 0 ? { start: round3(start) } : {}), treatment, ...(measured ? { peak: measured.peak } : {}) };
  story.scenes[index] = { ...story.scenes[index], backdrop: { kind: "video", params } };
  if (measured && measured.motion > BACKDROP_BUSY_MOTION) warnings.push(`${where}: the backdrop shot moves a lot (motion ${measured.motion}); a calmer shot reads better behind the card`);
  shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind: "video", src: placed.src, slot: "backdrop", treatment, ...(measured ? { footage: measured } : {}), ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}), ...(shot.duration > 0 ? { duration: shot.duration } : {}) });
}

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * How a clip reads as a backdrop, from `duration` s of it at `start`: frames
 * at 2 fps, shrunk to 96 × 96 grey (about the blur a plate gives them) →
 * {peak: the 99th-percentile level 0–1, motion: the mean change between
 * frames 0–1, frames}. Read with ffmpeg.
 */
export async function measureFootage(file, { start = 0, duration = 4 } = {}) {
  const size = 96;
  const { stdout } = await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, start)), "-t", String(Math.max(0.5, duration)), "-i", file, "-vf", `fps=2,scale=${size}:${size},format=gray`, "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  return footageStats(stdout, size * size);
}

/** Grey frames of `pixels` bytes each, back to back → {peak, motion, frames} (see measureFootage). */
export function footageStats(bytes, pixels) {
  const frames = Math.floor((bytes?.length ?? 0) / pixels);
  if (!frames) return null;
  const histogram = new Array(256).fill(0);
  let change = 0;
  for (let f = 0; f < frames; f += 1) {
    for (let i = 0; i < pixels; i += 1) {
      const value = bytes[f * pixels + i];
      histogram[value] += 1;
      if (f) change += Math.abs(value - bytes[(f - 1) * pixels + i]);
    }
  }
  let seen = 0, peak = 255;
  const cut = frames * pixels * 0.99;
  for (let v = 0; v < 256; v += 1) { seen += histogram[v]; if (seen >= cut) { peak = v; break; } }
  return { peak: Math.round((peak / 255) * 1000) / 1000, motion: frames > 1 ? Math.round((change / ((frames - 1) * pixels * 255)) * 1000) / 1000 : 0, frames };
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

// An answer naming a file is copied into the project the moment it arrives.
// An app may write every answer to one path (a scratch file it reuses), and a
// cached answer is placed again on each repair pass: a copy taken later would
// show whatever the app wrote there last. → the answer, with src for file.
async function snapshotShot(answer, request, project) {
  const shot = normalizeShot(answer);
  if (!shot?.file || shot.src || !project) return answer;
  const ext = extensionOf(shot.file);
  if (!IMAGE.test(ext) && !VIDEO.test(ext)) return answer;
  const src = `${SHOTS_DIR}/${request.id}${ext}`;
  const target = path.join(project, src);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.resolve(String(shot.file)), target);
  // Kept by content, so a later run that finds this file in its --assets folder knows the provider fetched it (src/provided_files.js).
  await recordProvided(project, { file: target, src, request, shot: { kind: shot.kind ?? (VIDEO.test(ext) ? "video" : "image"), notes: shot.notes ?? null } });
  const { file: _file, path: _path, ...rest } = answer;
  return { ...rest, src };
}

async function placeShot(shot, request, project) {
  const from = shot.src ?? shot.file ?? shot.url;
  if (!from) throw new Error("the app's shot has no src, file or url");
  const ext = extensionOf(from);
  const kind = shot.kind ?? (VIDEO.test(ext) ? "video" : IMAGE.test(ext) ? "image" : null);
  if (!["image", "video"].includes(kind) || !(kind === "video" ? VIDEO : IMAGE).test(ext)) throw new Error(`the app's shot ${from} is not an image (.jpg, .png, .webp, .svg) or video (.mp4, .webm, .mov)`);
  if (request.type !== "any" && request.type !== kind && !(request.still && kind === "video")) throw new Error(`the app returned a ${kind} for a ${request.type} request`);
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
