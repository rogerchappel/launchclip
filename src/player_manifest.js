// The player manifest: every file a browser player needs to play a planned
// story before any render (launchclip make --stop-after storyboard, launchclip
// finish --plan-only), each with its role, size and content hash, so a host
// can upload them and point the kit's asset resolver at the URLs
// (kit/remotion/README.md: storyPlayerProps, setAssetResolver).
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLAYER_MANIFEST_FILE = "PLAYER-MANIFEST.json";
export const PLAYER_MANIFEST_VERSION = "launchclip.player-manifest.v1";

// What a browser preview of the plan does not show: these exist only after a render.
export const PREVIEW_DIFFERENCES = Object.freeze([
  "loudness: the audio is the unmastered mix; the render masters it to -14 LUFS / -1 dBTP",
  "caption plates measured on rendered frames: a line found illegible in the render gets a plate and a second pass",
  "pixel gates (motion, audio, temporal evidence, style, caption legibility, the opening's pixels) and the critic run on the rendered video only",
  "candidates: the rendered comparison of the opening and one transition does not run on a planned story",
  "the cover and publish.json are written with the rendered video"
]);

/** Every project path a resolved story names: assets/…, audio.words and the captions file, sorted. */
export function storyFilePaths(story) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === "string") { if (/^(\.\/)?assets\//.test(value)) found.add(value.replace(/^\.\//, "")); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(story);
  if (typeof story?.audio?.words === "string" && !/^[a-z]+:\/\//i.test(story.audio.words)) found.add(story.audio.words.replace(/^\.\//, ""));
  for (const overlay of Array.isArray(story?.overlays) ? story.overlays : []) if (typeof overlay?.src === "string" && !/^[a-z]+:\/\//i.test(overlay.src)) found.add(overlay.src.replace(/^\.\//, ""));
  return [...found].sort();
}

function roleOf(file, story) {
  const audio = story?.audio ?? {};
  if (file === audio.mix) return "mix";
  if (file === audio.voice) return "narration";
  if (file === audio.words) return "words";
  if ((story?.overlays ?? []).some((overlay) => overlay?.type === "captions" && overlay.src === file)) return "captions";
  if (file === story?.base?.src) return "base";
  if (file.startsWith("assets/subject/")) return "subject";
  return "media";
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve));
  return hash.digest("hex");
}

async function entry(project, file, role, player) {
  const full = path.join(project, file);
  return { path: file, role, bytes: (await stat(full)).size, sha256: await sha256(full), player };
}

/**
 * Writes <project>/PLAYER-MANIFEST.json for a planned story.
 * story: the resolved story's project path; resolved: the story itself;
 * stems: [{path, role}] files the player does not fetch (they are inside the
 * mix) but a host may want (the music bed, the cue list);
 * audio: what the mix holds. → the manifest.
 */
export async function writePlayerManifest(project, { story, resolved, stems = [], audio = null, clock = () => new Date().toISOString() }) {
  const format = resolved?.format ?? {};
  const files = [await entry(project, story, "story", true)];
  const missing = [];
  const named = storyFilePaths(resolved);
  for (const file of named) {
    if (existsSync(path.join(project, file))) files.push(await entry(project, file, roleOf(file, resolved), true));
    else missing.push(file);
  }
  for (const stem of stems) {
    if (!stem?.path || named.includes(stem.path) || files.some((item) => item.path === stem.path) || !existsSync(path.join(project, stem.path))) continue;
    files.push(await entry(project, stem.path, stem.role, false));
  }
  const manifest = {
    schema_version: PLAYER_MANIFEST_VERSION,
    story,
    format: { width: format.width ?? null, height: format.height ?? null, fps: Number(resolved?.resolved?.fps ?? format.fps ?? 30), duration: Number(resolved?.resolved?.duration ?? format.duration) || null },
    files,
    missing,
    bytes: files.filter((item) => item.player).reduce((sum, item) => sum + item.bytes, 0),
    audio,
    not_in_preview: [...PREVIEW_DIFFERENCES],
    written_at: clock()
  };
  await writeFile(path.join(project, PLAYER_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
