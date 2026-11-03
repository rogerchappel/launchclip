// Footage inventory notes: what an app knows about the media it supplies,
// so the planner chooses clips and in/out points well
// (docs/KIT_CONTRACTS.md "Footage inventory notes").
//
//   readInventoryNotes(root, files) → {notes: Map(path → notes), metadata: [paths], warnings}
//   applyNotes(entry, notes)        → the ASSETS.json entry with `notes` (and a role override)
//   mediaNotesLine(item)            → the asset-manifest text the planner reads
//   snapMediaWindows(story, media)  → videos moved into their usable windows
//   pickMedia(candidates, request)  → the best clip (and window) for a line
//
// Notes come from a sidecar beside the file (`clip.mp4.json`, or `clip.json`
// when only one media file has that stem) or one `inventory.json` at the
// assets root ({version: 1, assets: {"broll/clip.mp4": {...}}} or
// assets: [{src, ...}]); a sidecar's fields win over inventory.json's. Every
// field is optional and advisory: a bad field is a warning and is dropped.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const INVENTORY_FILE = "inventory.json";
export const NOTES_VERSION = 1;
export const NOTE_ORIENTATIONS = Object.freeze(["landscape", "portrait", "square"]);
// Roles an app may assert, per kind (the heuristics' own vocabulary).
export const NOTE_ROLES = Object.freeze({
  video: Object.freeze(["talking-head", "screen-recording", "b-roll"]),
  image: Object.freeze(["logo", "screenshot", "product-image"]),
  audio: Object.freeze(["voiceover", "music"])
});
const NOTE_KEYS = new Set(["src", "description", "subjects", "tags", "windows", "quality", "orientation", "people", "faces", "role"]);
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|svg|mp4|mov|m4v|webm|mkv|wav|mp3|m4a|aac|flac|ogg|opus)$/i;
const ROLE_LABELS = Object.freeze({ "talking-head": "Talking-head recording", "screen-recording": "Screen recording", "b-roll": "B-roll footage", logo: "Logo image", screenshot: "Screenshot", "product-image": "Product image", voiceover: "Voiceover", music: "Music track" });
// A clip below this quality is offered as a last resort.
export const LOW_QUALITY = 0.4;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Normalise one notes object. → {notes | null, warnings}. `where` names it
 * in warnings. Unknown keys and bad values are dropped with a warning.
 */
export function normalizeNotes(raw, where = "notes") {
  const warnings = [];
  if (!isObject(raw)) return { notes: null, warnings: [`${where} must be a JSON object; ignored`] };
  const notes = {};
  for (const key of Object.keys(raw)) if (!NOTE_KEYS.has(key) && key !== "version") warnings.push(`${where}.${key} is not a notes field (${[...NOTE_KEYS].filter((name) => name !== "src").join(", ")}); ignored`);
  if (raw.description !== undefined) {
    if (typeof raw.description === "string" && raw.description.trim()) notes.description = raw.description.trim().replace(/\s+/g, " ").slice(0, 500);
    else warnings.push(`${where}.description must be text; ignored`);
  }
  for (const key of ["subjects", "tags"]) {
    if (raw[key] === undefined) continue;
    const list = Array.isArray(raw[key]) ? raw[key].filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 60)) : null;
    if (!list) warnings.push(`${where}.${key} must be a list of words or phrases; ignored`);
    else if (list.length) notes[key] = [...new Set(list)].slice(0, key === "tags" ? 40 : 20);
  }
  if (raw.quality !== undefined) {
    if (finite(raw.quality) && raw.quality >= 0 && raw.quality <= 1) notes.quality = round2(raw.quality);
    else warnings.push(`${where}.quality must be a number from 0 to 1; ignored`);
  }
  if (raw.orientation !== undefined) {
    if (NOTE_ORIENTATIONS.includes(raw.orientation)) notes.orientation = raw.orientation;
    else warnings.push(`${where}.orientation must be one of ${NOTE_ORIENTATIONS.join(", ")}; ignored`);
  }
  if (raw.people !== undefined) {
    if (typeof raw.people === "boolean" || (Number.isInteger(raw.people) && raw.people >= 0)) notes.people = raw.people;
    else warnings.push(`${where}.people must be true, false or a count; ignored`);
  }
  if (raw.faces !== undefined) {
    if (typeof raw.faces === "boolean") notes.faces = raw.faces;
    else warnings.push(`${where}.faces must be true or false; ignored`);
  }
  if (raw.role !== undefined) {
    if (typeof raw.role === "string" && Object.values(NOTE_ROLES).some((roles) => roles.includes(raw.role))) notes.role = raw.role;
    else warnings.push(`${where}.role must be one of ${[...new Set(Object.values(NOTE_ROLES).flat())].join(", ")}; ignored`);
  }
  if (raw.windows !== undefined) {
    if (!Array.isArray(raw.windows)) warnings.push(`${where}.windows must be a list of {start, end, quality?, note?}; ignored`);
    else {
      const windows = [];
      raw.windows.forEach((window, index) => {
        const at = `${where}.windows[${index}]`;
        if (!isObject(window) || !finite(window.start) || !finite(window.end) || window.start < 0 || window.end <= window.start) { warnings.push(`${at} must be {start, end} seconds with end after start; ignored`); return; }
        const entry = { start: round2(window.start), end: round2(window.end) };
        if (window.quality !== undefined) {
          if (finite(window.quality) && window.quality >= 0 && window.quality <= 1) entry.quality = round2(window.quality);
          else warnings.push(`${at}.quality must be a number from 0 to 1; ignored`);
        }
        const note = window.note ?? window.description;
        if (typeof note === "string" && note.trim()) entry.note = note.trim().slice(0, 160);
        windows.push(entry);
      });
      windows.sort((a, b) => a.start - b.start);
      if (windows.length) notes.windows = windows.slice(0, 50);
    }
  }
  return { notes: Object.keys(notes).length ? notes : null, warnings };
}

/**
 * Notes for the media files under `root`. files: the absolute paths the
 * inventory lists. → {notes: Map(relative path → notes), metadata: Set of
 * relative paths that are notes (sidecars, inventory.json), warnings}
 */
export async function readInventoryNotes(root, files) {
  const relative = files.map((file) => path.relative(root, file).split(path.sep).join("/"));
  const present = new Set(relative);
  const media = relative.filter((file) => MEDIA_EXT.test(file));
  const notes = new Map();
  const metadata = new Set();
  const warnings = [];
  const merge = (key, value) => notes.set(key, { ...(notes.get(key) ?? {}), ...value });

  if (present.has(INVENTORY_FILE)) {
    metadata.add(INVENTORY_FILE);
    let doc = null;
    try { doc = JSON.parse(await readFile(path.join(root, INVENTORY_FILE), "utf8")); }
    catch (error) { warnings.push(`${INVENTORY_FILE} is not valid JSON (${error.message}); ignored`); }
    if (doc) {
      if (doc.version !== undefined && doc.version !== NOTES_VERSION) warnings.push(`${INVENTORY_FILE} version ${doc.version} is not ${NOTES_VERSION}; read as version ${NOTES_VERSION}`);
      const list = Array.isArray(doc.assets) ? doc.assets.map((item, index) => [isObject(item) ? item.src : null, item, `${INVENTORY_FILE} assets[${index}]`])
        : isObject(doc.assets) ? Object.entries(doc.assets).map(([key, item]) => [key, item, `${INVENTORY_FILE} assets["${key}"]`])
          : null;
      if (!list) warnings.push(`${INVENTORY_FILE} needs assets: {"<path>": {...}} or [{src, ...}]; ignored`);
      for (const [src, item, where] of list ?? []) {
        const key = typeof src === "string" ? assetRelative(src) : null;
        if (!key) { warnings.push(`${where} needs src, a path under the assets folder; ignored`); continue; }
        if (!present.has(key)) { warnings.push(`${where}: ${key} is not in the assets folder; ignored`); continue; }
        const { notes: value, warnings: found } = normalizeNotes(item, where);
        warnings.push(...found);
        if (value) merge(key, value);
      }
    }
  }

  // Sidecars: <file>.json, else <stem>.json when one media file has that stem.
  const byStem = new Map();
  for (const file of media) {
    const stem = file.replace(/\.[^./]+$/, "");
    byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
  }
  for (const file of relative) {
    if (!file.toLowerCase().endsWith(".json") || file === INVENTORY_FILE) continue;
    const bare = file.slice(0, -5);
    const target = present.has(bare) && MEDIA_EXT.test(bare) ? bare : (byStem.get(bare)?.length === 1 ? byStem.get(bare)[0] : null);
    if (!target) continue;
    metadata.add(file);
    let raw;
    try { raw = JSON.parse(await readFile(path.join(root, file), "utf8")); }
    catch (error) { warnings.push(`${file} is not valid JSON (${error.message}); ignored`); continue; }
    const { notes: value, warnings: found } = normalizeNotes(raw, file);
    warnings.push(...found);
    if (value) merge(target, value);
  }
  return { notes, metadata, warnings };
}

/** "./assets/broll/a.mp4" → "broll/a.mp4"; null for an absolute path or one that climbs out. */
export function assetRelative(value) {
  let text = String(value ?? "").trim().replace(/\\/g, "/");
  if (!text || text.startsWith("/") || /^[a-z]+:/i.test(text)) return null;
  text = text.replace(/^(\.\/)+/, "").replace(/^assets\//, "");
  if (!text || text.split("/").includes("..")) return null;
  return text;
}

/**
 * The inventory entry with its notes: entry.notes, a role the app asserts
 * (kept in entry.detected so the heuristic is not lost), and the
 * orientation the app gives (a rotated phone clip probes the wrong way).
 * Idempotent: a cached entry is restored to what the heuristics found first.
 */
export function applyNotes(entry, notes) {
  const out = { ...entry };
  if (out.detected) {
    out.role = out.detected.role;
    out.confidence = out.detected.confidence;
    if (out.detected.description !== undefined) out.description = out.detected.description;
    if (out.media && out.detected.orientation !== undefined) out.media = { ...out.media, orientation: out.detected.orientation };
    delete out.detected;
  }
  delete out.notes;
  out.signals = (out.signals ?? []).filter((signal) => !String(signal).startsWith("notes"));
  if (!notes) return out;
  out.notes = notes;
  out.signals = [...out.signals, "notes"];
  const roles = NOTE_ROLES[out.kind] ?? [];
  const role = notes.role && roles.includes(notes.role) && notes.role !== out.role ? notes.role : null;
  const orientation = notes.orientation && out.media && notes.orientation !== out.media.orientation ? notes.orientation : null;
  if (role || orientation) out.detected = { role: out.role, confidence: out.confidence, ...(role ? { description: out.description } : {}), ...(out.media ? { orientation: out.media.orientation } : {}) };
  if (role) {
    out.role = role;
    out.confidence = 1;
    out.signals.push("notes:role");
    out.description = `${ROLE_LABELS[role]} (the app's notes; detected as ${out.detected.role}: ${out.detected.description})`;
  }
  if (orientation) out.media = { ...out.media, orientation };
  return out;
}

/** The notes as manifest text for the planner: what the clip shows, its quality and its usable windows. */
export function mediaNotesLine(item) {
  const notes = item?.notes;
  if (!notes) return "";
  const parts = [];
  if (notes.description) parts.push(notes.description.replace(/[.\s]+$/, ""));
  if (notes.subjects?.length) parts.push(`shows ${notes.subjects.join(", ")}`);
  if (notes.tags?.length) parts.push(`tags ${notes.tags.join(", ")}`);
  if (notes.quality !== undefined) parts.push(`quality ${notes.quality}${notes.quality < LOW_QUALITY ? " (low: use only when nothing better fits the line)" : ""}`);
  if (notes.orientation) parts.push(notes.orientation);
  if (notes.people !== undefined || notes.faces !== undefined) {
    const people = notes.people === true ? "people on screen" : notes.people === false || notes.people === 0 ? "no people" : Number.isInteger(notes.people) ? `${notes.people} ${notes.people === 1 ? "person" : "people"} on screen` : null;
    const faces = notes.faces === true ? "faces visible" : notes.faces === false ? "no faces" : null;
    parts.push([people, faces].filter(Boolean).join(", "));
  }
  if (notes.windows?.length) {
    parts.push(`usable windows ${notes.windows.map((window) => `${window.start}–${window.end} s${window.quality !== undefined ? ` (quality ${window.quality})` : ""}${window.note ? ` "${window.note}"` : ""}`).join(", ")}: set params.media.sourceStart to a window's start and keep the scene no longer than the window, preferring the higher-quality window that matches the line`);
  }
  return parts.filter(Boolean).length ? ` Notes from the app: ${parts.filter(Boolean).join("; ")}.` : "";
}

// ---------------------------------------------------------------------------
// Choosing clips

const STOP = new Set("a an and are as at be but by for from has have he her his i in is it its of on or our she so that the their them they this to was we were what when where which who will with you your just very really into over then than there here not no do does did can could would should about".split(" "));

/** Content words, lightly stemmed: "Driving trucks" → ["driv", "truck"]. */
export function tokens(text) {
  return String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => word.replace(/(ing|ers|er|ed|es|s)$/, "") || word);
}

/** How well notes (and the item's description) match a line's text: shared content words, subjects and tags weighted double. 0 when nothing is shared. */
export function matchScore(item, text, window = null) {
  const line = new Set(tokens(text));
  if (!line.size) return 0;
  const notes = item?.notes ?? {};
  const strong = new Set(tokens([...(notes.subjects ?? []), ...(notes.tags ?? [])].join(" ")));
  const weak = new Set(tokens([notes.description ?? "", item?.description ?? "", window?.note ?? "", String(item?.src ?? item?.path ?? "").split("/").pop().replace(/\.[^.]+$/, "")].join(" ")));
  let score = 0;
  for (const word of line) score += strong.has(word) ? 2 : weak.has(word) ? 1 : 0;
  return score;
}

/**
 * The best usable window for a scene `need` seconds long: one at least that
 * long when there is one, the highest quality first, then the best note
 * match, then the earliest. → window | null (no windows).
 */
export function bestWindow(notes, need, text = "") {
  const windows = notes?.windows ?? [];
  if (!windows.length) return null;
  const quality = (window) => window.quality ?? notes.quality ?? 0.5;
  const ranked = [...windows].sort((a, b) => {
    const fitA = a.end - a.start >= need - 1e-6 ? 1 : 0, fitB = b.end - b.start >= need - 1e-6 ? 1 : 0;
    if (fitA !== fitB) return fitB - fitA;
    if (!fitA && b.end - b.start !== a.end - a.start) return (b.end - b.start) - (a.end - a.start);
    if (quality(b) !== quality(a)) return quality(b) - quality(a);
    const match = matchScore({ notes: {} }, text, b) - matchScore({ notes: {} }, text, a);
    return match || a.start - b.start;
  });
  return ranked[0];
}

/**
 * Pick the clip for a line. candidates: [{src, kind, duration?, width?,
 * height?, notes?, description?}]. request: {text, need (seconds),
 * orientation (the video's), used (Set of srcs already in the story),
 * prefer (Set of srcs to favour, e.g. unplaced must_use)}.
 * → {item, window, score} | null
 */
export function pickMedia(candidates, { text = "", need = 3, orientation = null, used = new Set(), prefer = new Set() } = {}) {
  let best = null;
  for (const item of candidates ?? []) {
    if (!item?.src || !["image", "video"].includes(item.kind)) continue;
    const notes = item.notes ?? {};
    const window = item.kind === "video" ? bestWindow(notes, need, text) : null;
    const quality = window?.quality ?? notes.quality ?? 0.5;
    let score = matchScore(item, text, window) * 2 + quality * 3;
    if (prefer.has(item.src)) score += 100;
    if (used.has(item.src)) score -= 4;
    const own = notes.orientation ?? orientationOf(item);
    if (orientation && own && own === orientation) score += 1;
    if (item.kind === "video") score += 0.5;
    const length = window ? window.end - window.start : Number(item.duration) || null;
    if (item.kind === "video" && length !== null && length < need) score -= 2;
    if (!best || score > best.score + 1e-9) best = { item, window, score: round2(score) };
  }
  return best;
}

function orientationOf(item) {
  const width = Number(item?.width), height = Number(item?.height);
  if (!(width > 0 && height > 0)) return null;
  return width > height ? "landscape" : width < height ? "portrait" : "square";
}

/** The canvas's orientation: format {width, height}. */
export function formatOrientation(format) {
  return orientationOf(format);
}

/**
 * Move each video scene's in point into the clip's usable windows: a scene
 * whose [sourceStart, sourceStart + duration] is not inside a window gets the
 * best window's start (bestWindow). times: Map(scene id → {start, end}).
 * media: the candidates with notes. → {storyboard (a copy), moved: [text]}
 */
export function snapMediaWindows(storyboard, media, { times = new Map(), words = [] } = {}) {
  const bySrc = new Map((media ?? []).filter((item) => item?.notes?.windows?.length).map((item) => [item.src, item]));
  if (!bySrc.size || !Array.isArray(storyboard?.scenes)) return { storyboard, moved: [] };
  const story = structuredClone(storyboard);
  const moved = [];
  story.scenes.forEach((scene) => {
    const media = scene?.params?.media;
    const src = typeof media === "string" ? media : media?.src;
    const item = typeof src === "string" ? bySrc.get(src.replace(/^\.\//, "")) : null;
    if (!item || (typeof media === "object" && media.kind && media.kind !== "video")) return;
    const span = times.get(scene.id);
    const need = span ? Math.max(0, span.end - span.start) : 3;
    const from = typeof media === "object" && finite(media.sourceStart) ? media.sourceStart : 0;
    if (item.notes.windows.some((window) => from >= window.start - 1e-6 && from + Math.min(need, window.end - window.start) <= window.end + 1e-6)) return;
    const text = span ? words.filter((word) => Number(word.start) < span.end && Number(word.end) > span.start).map((word) => word.text ?? word.word ?? "").join(" ") : "";
    const window = bestWindow(item.notes, need, text);
    if (!window) return;
    scene.params = { ...scene.params, media: { ...(typeof media === "object" ? media : { src, kind: "video" }), sourceStart: window.start } };
    moved.push(`${scene.id}'s ${src} from ${from} s to ${window.start} s (usable window ${window.start}–${window.end} s)`);
  });
  return { storyboard: moved.length ? story : storyboard, moved };
}

/** Whether a path names a media file the notes can describe. */
export function isMediaPath(file) {
  return MEDIA_EXT.test(String(file ?? ""));
}
