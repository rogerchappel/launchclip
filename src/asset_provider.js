// The asset-provider hook: an app that embeds the engine (src/engine) can
// supply real shots inside motion-graphics stories, from its media library or
// generated on demand. With an `assets` provider, planStoryboard tells the
// model it may ask for a shot instead of naming a file:
//
//   {module: "photo-scene", params: {media: {kind: "shot", shows: "a barista
//     pouring latte art, close up", type?: "image" | "video" | "any"}, ...}}
//
// (photo-scene and media-window take media). Before the storyboard is
// checked, each request goes to provider.findShot(request) with the line it
// sits under; the shot that comes back replaces the request as a project
// assets/ path, so the story contract (assets/ media only) and both renderers
// are unchanged. No shot (null) becomes a repair note, and the model designs
// that scene without one.
//
// request: {id, scene_id, module, shows, type: "image"|"video"|"any",
//   line (the narration under the scene, when the words are known), start,
//   end, duration (seconds, null when unresolved), format: {width, height,
//   aspect}, brief}
// shot: {kind?: "image"|"video", and one of:
//   src: "assets/…" (already in the project),
//   file: an absolute path the engine copies into <project>/assets/shots/,
//   url: a URL the app serves (the story names assets/shots/<id>.<ext>; the
//     app maps it back, e.g. @launchclip/remotion setAssetResolver),
//   sourceStart?: seconds into a video, source?: {provider, id, license,
//   generated, prompt, ...} (recorded in the plan report), cost_usd?} | null
// (or the flat shape normalizeShot() accepts).
import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveStory } from "@launchclip/core/story.mjs";

export const SHOT_REQUEST = "shot";
export const SHOT_MODULES = Object.freeze(["photo-scene", "media-window"]);
export const SHOTS_DIR = "assets/shots";
const IMAGE = /\.(jpe?g|png|webp|svg)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;

/** The planning-prompt section that offers shot requests (only with a provider). */
export function shotPrompt({ max = 6 } = {}) {
  return [
    "Shots from the app's media library: in a photo-scene or media-window scene you may set params.media to {kind: \"shot\", shows: \"<what the shot must show, concretely>\", type?: \"image\" | \"video\" | \"any\"} instead of an assets/ path.",
    "The app finds or generates that shot for the line the scene sits under, after you plan. Ask for one where a real photo or clip of a concrete subject (a place, an object, people doing something) says more than a graphic; keep data, steps and comparisons as motion graphics.",
    `Ask for at most ${max} shots; make each "shows" specific enough to search for (subject, action, framing), with no brand names or text in the frame.`
  ].join("\n");
}

const isRequest = (media) => media && typeof media === "object" && media.kind === SHOT_REQUEST;

/** Shot requests in a storyboard: [{index, scene}]. */
export function shotRequests(storyboard) {
  return (storyboard?.scenes ?? []).flatMap((scene, index) => (isRequest(scene?.params?.media) ? [{ index, scene }] : []));
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
 * url?, source?}], errors: ["scene <id>: …"]}. cache: a Map reused across
 * repair attempts, so the same request is asked once.
 */
export async function resolveShots(storyboard, { assets, words = [], brief = "", format = null, project = null, cache = new Map(), signal } = {}) {
  const requests = shotRequests(storyboard);
  if (!requests.length) return { storyboard, shots: [], errors: [] };
  const story = structuredClone(storyboard);
  const times = sceneTimes(storyboard, words);
  const width = Number(format?.width ?? storyboard.format?.width) || null;
  const height = Number(format?.height ?? storyboard.format?.height) || null;
  const shots = [];
  const errors = [];
  for (const { index, scene } of requests) {
    const media = scene.params.media;
    const shows = String(media.shows ?? "").trim();
    const where = `scene ${scene.id ?? index + 1}`;
    if (!SHOT_MODULES.includes(scene.module)) { errors.push(`${where}: shot requests are for ${SHOT_MODULES.join(" and ")} scenes, not ${scene.module}`); continue; }
    if (!shows) { errors.push(`${where}: a shot request needs "shows" (what the shot must show)`); continue; }
    const type = ["image", "video", "any"].includes(media.type) ? media.type : "any";
    const span = times.get(scene.id) ?? null;
    const request = {
      id: `${scene.id}-${createHash("sha256").update(JSON.stringify([shows, type, width, height])).digest("hex").slice(0, 10)}`,
      scene_id: scene.id ?? null,
      module: scene.module,
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
    let placed;
    try {
      placed = await placeShot(shot, request, project);
    } catch (error) {
      errors.push(`${where}: ${error.message}`);
      continue;
    }
    const kind = placed.kind;
    story.scenes[index] = { ...scene, params: { ...scene.params, media: { kind, src: placed.src, ...(kind === "video" ? { sourceStart: Number(shot.sourceStart ?? 0) || 0 } : {}) } } };
    shots.push({ scene_id: scene.id ?? null, request_id: request.id, shows, kind, src: placed.src, ...(shot.url ? { url: String(shot.url) } : {}), ...(shot.source ? { source: shot.source } : {}), ...(shot.cost_usd > 0 ? { cost_usd: shot.cost_usd } : {}) });
  }
  return { storyboard: story, shots, errors };
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
  return {
    ...shot,
    file: shot.file ?? shot.path,
    ...(source ? { source } : {}),
    cost_usd: Number.isFinite(cost) && cost > 0 ? cost : 0
  };
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
