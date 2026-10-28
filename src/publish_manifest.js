// launchclip publish-manifest <project>: publish.json next to the video, the
// metadata a person or an upload agent needs to post it (docs/guide/headless.md,
// "Publishing").
//
//   {title, title_options, description, hashtags, cta: {text, url?}, aspect,
//    duration_seconds, video, cover, cover_frame?, captions?, platforms:
//    {<platform>: {fits, notes, url?}}, warnings}
//
// Titles come from the script (SCRIPT.json, else SCRIPT.md's Titles section: title, and title_options
// when the script writes them), else the storyboard's title. The platform
// fits are hard platform limits, checked against the storyboard's format and
// duration; nothing here calls a network or a model. finish writes it after
// every finished render, and make through finish.
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { COVER_PATH } from "./cover.js";
import { aspectName, coverFrame } from "@launchclip/core/story.mjs";

export const PUBLISH_VERSION = "launchclip.publish.v1";
export const PUBLISH_FILE = "publish.json";
export const PUBLISH_PLATFORMS = Object.freeze(["youtube_shorts", "tiktok", "reels", "youtube", "linkedin", "x"]);
// Listed only when asked for (--platforms app_store,product_hunt).
export const OPTIONAL_PLATFORMS = Object.freeze(["app_store", "product_hunt"]);

// Hard limits (seconds). Shorts: vertical or square, up to 3 minutes; TikTok
// uploads up to 10 minutes; Reels up to 3 minutes; X up to 2 min 20 s without
// Premium; LinkedIn recommends 15-30 s for every placement; App Store app
// previews run 15-30 s.
export const PLATFORM_LIMITS = Object.freeze({
  youtube_shorts: { max: 180 },
  tiktok: { max: 600 },
  reels: { max: 180 },
  x: { max: 140 },
  linkedin: { min: 15, max: 30 },
  app_store: { min: 15, max: 30 }
});

// Teaser phrasing; a title meant to sell names the concrete outcome instead.
export const TEASERS = /(you won'?t believe|this one (trick|thing)|the secret|wait (for|till) (it|the end)|what happens next|\.\.\.$|…$)/i;
const STOP = new Set(["the", "and", "for", "with", "that", "this", "your", "you", "from", "into", "what", "when", "why", "how", "are", "was", "all", "one", "can", "does", "more", "than", "just", "about", "video"]);

/**
 * The manifest from what the project holds (pure: tests pass the parts).
 * story: storyboard.json; script: SCRIPT.json or null; files: {video, cover,
 * captions} project-relative paths (or null);
 * options: {link, utm (campaign slug, or "auto"), platforms: extra platform
 * ids}.
 */
export function buildPublishManifest({ story, script = null, files = {}, options = {} }) {
  if (!story || typeof story !== "object") throw new Error("publish-manifest needs the project's storyboard.json");
  const warnings = [];
  const format = story.format ?? {};
  const width = Number(format.width), height = Number(format.height);
  const duration = round2(Number(story.resolved?.duration ?? format.duration));
  const aspect = aspectName(width, height) ?? (width && height ? `${width}x${height}` : null);
  const portrait = height > width;
  const upright = height >= width;

  const title = cleanText(script?.title) || cleanText(story.title) || "Untitled";
  const titles = [...new Set([title, ...titleOptions(script?.title_options)])];
  for (const entry of titles) {
    if (entry.length > 100) warnings.push(`title "${entry.slice(0, 40)}…" runs ${entry.length} characters; YouTube allows 100`);
    if (TEASERS.test(entry)) warnings.push(`title "${entry}" teases; a title meant to sell names the concrete outcome`);
  }

  const cta = storyCta(story, script);
  if (options.link) cta.url = String(options.link);
  const link = options.link ? String(options.link) : cta.url ?? null;
  if (/\bup-?votes?\b/i.test(cta.text ?? "")) warnings.push(`the CTA "${cta.text}" asks for upvotes; Product Hunt does not allow that`);
  const campaign = options.utm ? (options.utm === true || options.utm === "auto" ? slug(title) : slug(options.utm)) : null;
  if (campaign && !link) throw new Error("--utm needs a link: pass --link <url> or give the cta scene a URL handle");

  const requested = [...new Set(String(options.platforms ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
  for (const name of requested) if (!PUBLISH_PLATFORMS.includes(name) && !OPTIONAL_PLATFORMS.includes(name)) throw new Error(`unknown platform ${name}; use ${[...PUBLISH_PLATFORMS, ...OPTIONAL_PLATFORMS].join(", ")}`);
  const platforms = {};
  for (const name of [...PUBLISH_PLATFORMS, ...OPTIONAL_PLATFORMS.filter((name) => requested.includes(name))]) {
    const fit = platformFit(name, { duration, aspect, portrait, upright, cta });
    if (link && name !== "product_hunt") fit.url = campaign ? withUtm(link, { source: name, campaign }) : link;
    platforms[name] = fit;
  }

  const hashtags = hashtagList(script?.hashtags ?? story.meta?.hashtags, title);
  if (platforms.youtube_shorts.fits && !hashtags.some((tag) => tag.toLowerCase() === "#shorts")) hashtags.push("#Shorts");
  const frame = coverFrame(story);
  return {
    schema_version: PUBLISH_VERSION,
    title,
    title_options: titles,
    description: description(story, script, cta, link),
    hashtags,
    cta,
    aspect,
    duration_seconds: duration,
    video: files.video ?? null,
    cover: files.cover ?? null,
    ...(typeof frame === "number" ? { cover_frame_seconds: frame } : frame === "first" ? { cover_frame_seconds: 0 } : {}),
    ...(files.captions ? { captions: files.captions } : {}),
    platforms,
    warnings: [...new Set(warnings)]
  };
}

/** Whether the video fits one platform, and why. */
export function platformFit(name, { duration, aspect, portrait, upright, cta = {} }) {
  const limit = PLATFORM_LIMITS[name] ?? {};
  const within = Number.isFinite(duration) && (limit.max === undefined || duration <= limit.max + 1e-6) && (limit.min === undefined || duration >= limit.min - 1e-6);
  const length = `${duration} s`;
  if (name === "youtube_shorts") {
    const fits = within && upright;
    return { fits, notes: fits ? `${length}, ${aspect}: a Short (vertical or square, up to 180 s)` : !upright ? `${aspect} is landscape; Shorts are vertical or square` : `${length} is over the 180 s Shorts limit` };
  }
  if (name === "tiktok") return { fits: within, notes: within ? `${length}${portrait ? "" : `; ${aspect} shows letterboxed in a 9:16 feed`}` : `${length} is over TikTok's 10-minute upload limit` };
  if (name === "reels") {
    const fits = within && portrait;
    return { fits, notes: fits ? `${length}, ${aspect}` : !portrait ? `${aspect}: Reels are vertical (9:16)` : `${length} is over the 3-minute Reels limit` };
  }
  if (name === "youtube") return { fits: Number.isFinite(duration), notes: upright && duration <= 180 ? `${length} vertical: YouTube files it as a Short` : `${length}, ${aspect}` };
  if (name === "linkedin") return { fits: within, notes: within ? `${length}: inside the 15-30 s LinkedIn recommends` : `${length}: LinkedIn recommends 15-30 s for every placement; cut a 15-30 s version` };
  if (name === "x") return { fits: within, notes: within ? `${length}` : `${length} is over the 2 min 20 s X allows without Premium` };
  if (name === "app_store") return { fits: within, notes: within ? `${length}: inside the 15-30 s an App Store app preview allows; export at the device resolution` : `${length}: App Store app previews run 15-30 s` };
  if (name === "product_hunt") {
    const upvote = /\bup-?votes?\b/i.test(cta.text ?? "");
    return { fits: !upvote, notes: `Product Hunt takes the video as a YouTube link: upload it to YouTube first${upvote ? `; the CTA "${cta.text}" asks for upvotes, which Product Hunt does not allow` : ""}` };
  }
  return { fits: within, notes: length };
}

/** url with utm_source=<platform>&utm_medium=video&utm_campaign=<campaign> (existing utm_ tags replaced). */
export function withUtm(url, { source, campaign, medium = "video" }) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`--link must be an absolute URL (https://…); got ${url}`); }
  parsed.searchParams.set("utm_source", source);
  parsed.searchParams.set("utm_medium", medium);
  parsed.searchParams.set("utm_campaign", campaign);
  return parsed.toString();
}

/** Read the project, write <project>/publish.json, return {file, manifest}. */
export async function writePublishManifest(projectPath, options = {}) {
  const project = path.resolve(projectPath);
  const story = await readOptional(path.join(project, "storyboard.json"));
  if (!story) throw new Error(`publish-manifest needs ${path.join(project, "storyboard.json")}`);
  const script = await readProjectScript(project);
  const finish = options.finish ?? await readOptional(path.join(project, "finish.json"));
  const rel = (file) => path.relative(project, path.resolve(project, file)).split(path.sep).join("/");
  const finalVideo = finish?.final && existsSync(finish.final) ? finish.final : ["renders/final.mp4", "renders/draft.mp4"].map((file) => path.join(project, file)).find((file) => existsSync(file)) ?? null;
  const cover = finish?.cover?.file && existsSync(path.join(project, finish.cover.file)) ? finish.cover.file : existsSync(path.join(project, COVER_PATH)) ? COVER_PATH : null;
  const files = { video: finalVideo ? rel(finalVideo) : null, cover, captions: await findCaptions(project) };
  const manifest = buildPublishManifest({ story, script, files, options });
  if (!files.video) manifest.warnings.push("no rendered video yet: run launchclip finish first");
  const file = path.join(project, PUBLISH_FILE);
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return { file, manifest };
}

// A subtitle file the project already has (.srt before .vtt).
async function findCaptions(project) {
  for (const dir of ["renders", "captions", "assets/captions", "."]) {
    let names = [];
    try { names = await readdir(path.join(project, dir)); } catch { continue; }
    const found = names.filter((name) => /\.srt$/i.test(name)).sort()[0] ?? names.filter((name) => /\.vtt$/i.test(name)).sort()[0];
    if (found) return path.posix.join(dir === "." ? "" : dir, found);
  }
  return null;
}

// The CTA: a cta scene's action line and URL handle, else the narration's last sentence.
function storyCta(story, script) {
  const scenes = Array.isArray(story.scenes) ? story.scenes : [];
  const scene = [...scenes].reverse().find((entry) => entry?.module === "cta" && entry.params?.action);
  if (scene) {
    const handle = cleanText(scene.params.handle);
    const url = /^https?:\/\//i.test(handle) ? handle : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(handle) ? `https://${handle}` : null;
    return { text: cleanText(scene.params.action), ...(url ? { url } : {}) };
  }
  const sentences = narrationSentences(story, script);
  const last = sentences.at(-1) ?? "";
  // A loop ending's last line trails into the hook ("So, one more time, from right now:"): it is not a call to action.
  if (story.ending?.loop_to && /[:…—-]\s*$|\.\.\.\s*$/.test(last)) return { text: "" };
  return { text: last };
}

/**
 * The project's script: SCRIPT.json (make) when it exists, else SCRIPT.md
 * (the agent path) read for its title (the first "# " heading, without a
 * "Script:" prefix), its title options (the "## Titles" section: a table's
 * Title column or a numbered or bulleted list, best first, as written) and
 * its narration (the "## Narration" section). null when neither exists.
 */
export async function readProjectScript(project) {
  const json = await readOptional(path.join(project, "SCRIPT.json"));
  if (json) return json;
  let text;
  try { text = await readFile(path.join(project, "SCRIPT.md"), "utf8"); } catch { return null; }
  return parseScriptMarkdown(text);
}

/** SCRIPT.md → {title, title_options, narration, source}. */
export function parseScriptMarkdown(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const section = (pattern) => {
    const start = lines.findIndex((line) => /^##\s/.test(line) && pattern.test(line));
    if (start < 0) return [];
    const end = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };
  const heading = lines.find((line) => /^#\s/.test(line));
  const title = heading ? cleanText(heading.replace(/^#\s+/, "").replace(/^script\s*[:—-]\s*/i, "")) : "";
  const block = section(/titles?\b/i);
  const options = [];
  const header = block.find((line) => /^\s*\|/.test(line) && /title/i.test(line));
  if (header) {
    const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    const column = cells(header).findIndex((cell) => /^title$/i.test(cell));
    for (const line of block.filter((entry) => /^\s*\|/.test(entry) && entry !== header && !/^\s*\|[\s:|-]+\|?\s*$/.test(entry))) {
      const value = cleanText(cells(line)[column]);
      if (value) options.push(value);
    }
  } else {
    for (const line of block) {
      const match = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(line);
      if (match) options.push(cleanText(match[1].replace(/\s+[—-]\s+\d+(\.\d+)?\s*$/, "").replace(/^["“](.+)["”]$/, "$1")));
    }
  }
  const narration = cleanText(section(/narration/i).filter((line) => line.trim() && !/^\s*[|>]/.test(line)).join(" ").replace(/^["“]|["”]$/g, ""));
  return { title: options[0] ?? title, title_options: options, ...(narration ? { narration } : {}), source: "SCRIPT.md" };
}

function description(story, script, cta, link) {
  if (cleanText(script?.description)) return cleanText(script.description);
  const sentences = narrationSentences(story, script);
  const lead = sentences.slice(0, 2).join(" ");
  const close = cta.text && !lead.includes(cta.text) ? cta.text : "";
  return [lead, close, link ?? ""].filter(Boolean).join("\n\n") || cleanText(story.title) || "";
}

function narrationSentences(story, script) {
  const narration = story.audio?.narration;
  const text = cleanText(script?.narration) || cleanText(narration?.text) || (Array.isArray(narration?.lines) ? narration.lines.map((line) => line?.text ?? "").join(" ") : "");
  return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((sentence) => sentence.trim()).filter(Boolean);
}

function titleOptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => cleanText(typeof entry === "string" ? entry : entry?.title ?? entry?.text)).filter(Boolean);
}

function hashtagList(value, title) {
  const given = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : null;
  const words = given ?? String(title).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length >= 4 && !STOP.has(word) && !/^\d+$/.test(word)).slice(0, 3);
  return [...new Set(words.map((word) => String(word).trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean).map((word) => `#${word}`))];
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "video";
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function round2(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

async function readOptional(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}
