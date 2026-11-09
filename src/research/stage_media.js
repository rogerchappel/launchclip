// Staging research's media: the stock and archive items in
// research/assets.json are only links until their files are in the project.
// This downloads each licence-clear item into assets/research/<id>.<ext>
// (where kit modules can load it) and records the path, size and hash back
// on its assets.json entry as `local`. The planner inventory then lists it
// with what it shows, the claim it supports, and its licence and credit
// (researchMediaLines), and publish.json carries the credit of every item
// the storyboard uses (mediaCredits).
//
// Licences are checked again here, not trusted from the file: anything whose
// licence is unknown or not in CLEAR_LICENCES is never staged, and a
// storyboard that references a file under assets/research/ with no cleared
// entry is an error (mediaLicenceErrors).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicFetch } from "./logos.js";
import { rejectReason } from "./media.js";
import { CLEAR_LICENCES, RESEARCH_PATHS } from "./schema.js";

export const MEDIA_DIR = "assets/research";
export const STAGE_DEFAULTS = Object.freeze({ max: 8, maxImageBytes: 15 * 1024 * 1024, maxVideoBytes: 80 * 1024 * 1024, timeoutMs: 60_000 });

const IMAGE_EXT = /\.(jpe?g|png|webp)(?:[?#]|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov)(?:[?#]|$)/i;
const TYPE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/**
 * researchDir: the folder holding assets.json; root: the project.
 * options: {max, maxImageBytes, maxVideoBytes}; adapters: {fetch, log}
 * → {staged: [asset], skipped: [{id, reason}], file}
 */
export async function stageResearchMedia(researchDir, root, options = {}, adapters = {}) {
  const limits = { ...STAGE_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value != null)) };
  const log = adapters.log ?? (() => {});
  const file = path.join(researchDir, RESEARCH_PATHS.assets);
  let manifest;
  try { manifest = JSON.parse(await readFile(file, "utf8")); } catch { return { staged: [], skipped: [], file: null }; }
  const fetcher = adapters.fetch ?? globalThis.fetch;
  const get = (url, maxBytes) => publicFetch(url, { fetch: fetcher, timeoutMs: limits.timeoutMs, maxBytes, log: (line) => log(String(line).replace("research: logo", "research: media")) }).catch(() => null);
  const staged = [], skipped = [];
  let changed = false;
  for (const asset of manifest.assets ?? []) {
    const skip = (reason) => { skipped.push({ id: asset.id, reason }); if (asset.not_staged !== reason) { asset.not_staged = reason; changed = true; } };
    // Never trust the file: the licence is checked again before anything is downloaded.
    const refused = rejectReason(asset);
    if (refused) { skip(refused); continue; }
    if (asset.local && existsSync(path.join(root, asset.local))) { staged.push(asset); continue; }
    if (staged.length >= limits.max) { skip(`over the limit of ${limits.max} staged items`); continue; }
    const video = asset.type === "video";
    const url = await mediaFileUrl(asset, get);
    if (!url) { skip("no direct file to download (open its source page)"); continue; }
    const got = await get(url, video ? limits.maxVideoBytes : limits.maxImageBytes);
    if (!got?.bytes?.length) { skip(`the file could not be downloaded, or is over ${Math.round((video ? limits.maxVideoBytes : limits.maxImageBytes) / 1024 / 1024)} MB`); continue; }
    // The server's own word for the file decides; the URL's ending only when the server gives none.
    const type = got.type.split(";")[0].trim().toLowerCase();
    const ext = TYPE_EXT[type] ?? (!type || type === "application/octet-stream" || type === "binary/octet-stream" ? (url.match(video ? VIDEO_EXT : IMAGE_EXT)?.[1] ?? "").toLowerCase().replace("jpeg", "jpg") : "");
    if (!ext || (video ? !/^(mp4|webm|mov)$/.test(ext) : !/^(jpg|png|webp)$/.test(ext))) { skip(`not ${video ? "a video" : "an image"} file the kit can show (${got.type || "unknown type"})`); continue; }
    const local = `${MEDIA_DIR}/${asset.id}.${ext}`;
    await mkdir(path.join(root, MEDIA_DIR), { recursive: true });
    await writeFile(path.join(root, local), got.bytes);
    Object.assign(asset, { local, bytes: got.bytes.length, sha256: createHash("sha256").update(got.bytes).digest("hex"), downloaded_from: got.url });
    delete asset.not_staged;
    changed = true;
    staged.push(asset);
    log(`research: staged ${local} (${asset.licence.name}; ${asset.attribution})`);
  }
  if (changed) await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return { staged, skipped, file };
}

/** The one file to download for an asset, or null: a sized image, a direct video, a NASA or Internet Archive listing resolved. */
export async function mediaFileUrl(asset, get) {
  const video = asset.type === "video";
  const direct = (url) => Boolean(url) && (video ? VIDEO_EXT : IMAGE_EXT).test(url);
  // A sized preview of an image is enough for a 1080p frame and far smaller than the original.
  if (!video && asset.provider === "wikimedia-commons" && direct(asset.preview_url)) return asset.preview_url;
  if (direct(asset.media_url)) return asset.media_url;
  const listing = async (url) => {
    const got = await get(url, 2 * 1024 * 1024);
    try { return JSON.parse(Buffer.from(got.bytes).toString("utf8")); } catch { return null; }
  };
  if (asset.provider === "nasa" && asset.media_url) {
    // NASA's `href` is a JSON list of the item's files.
    const files = (await listing(asset.media_url)) ?? [];
    const wanted = video ? ["~medium.mp4", "~small.mp4", "~mobile.mp4", "~orig.mp4"] : ["~large.jpg", "~medium.jpg", "~orig.jpg"];
    for (const suffix of wanted) {
      const hit = (Array.isArray(files) ? files : []).find((entry) => String(entry).endsWith(suffix));
      if (hit) return String(hit).replace(/^http:/, "https:").replace(/ /g, "%20");
    }
    return null;
  }
  if (asset.provider === "internet-archive") {
    const identifier = String(asset.source_url).split("/details/")[1];
    if (!identifier) return null;
    const meta = await listing(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const files = (meta?.files ?? []).filter((entry) => (video ? /\.mp4$/i : /\.(jpe?g|png)$/i).test(entry.name ?? "") && !/thumb/i.test(entry.name)).sort((a, b) => Number(a.size ?? 0) - Number(b.size ?? 0));
    // The smallest full file: archive films run to gigabytes, and a b-roll plate needs seconds of one.
    const hit = files.find((entry) => Number(entry.size ?? 0) > 200_000) ?? files[0];
    return hit ? `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(hit.name)}` : null;
  }
  return null;
}

/** Whether an assets.json entry may be placed: staged in the project and licence-clear. */
export function placeable(asset) {
  return Boolean(asset?.local?.startsWith(`${MEDIA_DIR}/`)) && CLEAR_LICENCES.includes(asset?.licence?.id) && Boolean(asset?.attribution) && !rejectReason(asset);
}

/**
 * Planner inventory lines for the staged media: what each shows, the claim
 * it supports, its licence and credit, and how to place it.
 * → [{src, kind, line}]
 */
export function researchMediaLines(manifest, ledger = null) {
  const out = [];
  const claims = new Map((ledger?.claims ?? []).map((claim) => [claim.id, claim]));
  const people = manifest?.people ?? [];
  for (const asset of (manifest?.assets ?? []).filter(placeable)) {
    const kind = asset.type === "video" ? "video" : "image";
    const person = people.find((entry) => entry.portrait === asset.id);
    const backed = [...(asset.claims ?? []), ...(person?.claims ?? [])].map((id) => claims.get(id)).filter((claim) => claim?.status === "verified");
    const shows = person ? `portrait of ${person.name}${person.role ? ` (${person.role})` : ""}` : `${kind === "video" ? "archive footage" : "archive photo"} "${String(asset.title ?? "untitled").slice(0, 70)}"`;
    const size = asset.width && asset.height ? `, ${asset.width}×${asset.height}` : "";
    const found = asset.beat ? `, found for the line "${String(asset.beat).slice(0, 80)}"` : asset.query ? `, found for "${asset.query}"` : "";
    const supports = backed.length ? ` Supports ${backed.map((claim) => `claim ${claim.id} ("${String(claim.text).slice(0, 70)}")`).join(" and ")}.` : " Illustration only: it is not evidence for any claim.";
    const media = `{"kind": "${kind}", "src": "${asset.local}"}`;
    const use = `Use as {"module": "media-window", "params": {"title": "…", "media": ${media}}} or a full-bleed {"module": "photo-scene", "params": {"media": ${media}, "lines"?: ["…"]}} on the line it illustrates`;
    out.push({ src: asset.local, kind, licence: asset.licence.id, line: `${asset.local} — ${kind}, ${shows} from ${asset.provider_name ?? asset.provider}${size}${found}.${supports} Licence: ${asset.licence.name}; credit "${asset.attribution}" (publish.json carries it). ${use}.` });
  }
  return out;
}

/** Every assets/research/ path a storyboard references. */
export function researchMediaPaths(story) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === "string") { const clean = value.replace(/^\.\//, ""); if (clean.startsWith(`${MEDIA_DIR}/`)) found.add(clean); return; }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit({ scenes: story?.scenes, overlays: story?.overlays, ending: story?.ending, layers: story?.layers });
  return [...found];
}

/** Errors for research media a storyboard places without a cleared licence on record. */
export function mediaLicenceErrors(story, manifest) {
  const cleared = new Map((manifest?.assets ?? []).filter(placeable).map((asset) => [asset.local, asset]));
  return researchMediaPaths(story).filter((file) => !cleared.has(file)).map((file) => {
    const entry = (manifest?.assets ?? []).find((asset) => asset.local === file);
    return `${file} is placed in the storyboard but ${entry ? `its licence (${entry.licence?.name ?? entry.licence?.id ?? "unknown"}) is not one a video may use` : `has no licence on record in ${RESEARCH_PATHS.dir}/${RESEARCH_PATHS.assets}`}; remove it`;
  });
}

/** The credit of every research item the storyboard uses, for publish.json. → [{asset, title, author, licence, licence_url, source_url, attribution}] */
export function mediaCredits(story, manifest) {
  const byPath = new Map((manifest?.assets ?? []).filter(placeable).map((asset) => [asset.local, asset]));
  return researchMediaPaths(story).map((file) => byPath.get(file)).filter(Boolean).map((asset) => ({ asset: asset.local, title: asset.title ?? null, author: asset.author, licence: asset.licence.name, licence_url: asset.licence.url ?? null, source_url: asset.source_url, attribution: asset.attribution }));
}
