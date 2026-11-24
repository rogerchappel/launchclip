// Evidence for a post library: what each post says and shows, kept small.
//
//   parseVtt(text)                       → [{start, end, text}] in seconds
//   evidenceOf(row, {vtt?, thumb?, slides?, now?}) → the slim row (pure)
//   slideLinks(row)                      → a photo post's slide image links, in order
//   gatherEvidence(rows, {fetch?, concurrency?, thumbsDir?, slidesDir?, language?, onStep?})
//                                        → {rows, counts}
//   runEvidence(target, flags, io)       → {out, counts}: rewrites the library in place
//
// A row from importPosts carries the scraper's own row under `raw`, which is
// most of the file. This reads what later stages need out of it (hashtags,
// duration, the subtitle and cover links), fetches the subtitle and a small
// cover image while their links still work, and drops `raw`. A photo post
// (a carousel) also gets one sheet of its slides, since the cover alone does
// not show its format.
//
// Slim row: the input row without `raw`, plus
//   {hashtags: [..], transcript?, spoken_hook?, thumb?, slides?,
//    facts: {duration_s?, slideshow?, slides?, original_sound?, has_speech, first_word_s?, words_per_s?},
//    evidence_at}
import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { mapLimit } from "../concurrency.js";

const run = promisify(execFile);
const HOOK_MAX = 200;
const THUMB_WIDTH = 360;
const FETCH_TIMEOUT_MS = 30_000;
// A slide sheet: each slide fitted in a 360×640 cell, six to a row, the first twelve slides.
const SLIDE = { width: 360, height: 640, columns: 6, max: 12 };
const round2 = (value) => Math.round(value * 100) / 100;

function seconds(stamp) {
  const parts = stamp.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** WebVTT text → [{start, end, text}] in seconds. Cue ids, NOTE blocks and inline tags are dropped. */
export function parseVtt(text) {
  const cues = [];
  for (const block of String(text ?? "").replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => line.includes("-->"));
    if (at < 0) continue;
    const [start, rest = ""] = lines[at].split("-->");
    const words = lines.slice(at + 1).join(" ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    const cue = { start: seconds(start), end: seconds(rest.trim().split(/\s+/)[0]), text: words };
    if (words && Number.isFinite(cue.start) && Number.isFinite(cue.end)) cues.push(cue);
  }
  return cues;
}

function hashtagsOf(row) {
  const fromRaw = Array.isArray(row.raw?.hashtags) ? row.raw.hashtags.map((tag) => (typeof tag === "string" ? tag : tag?.name)) : null;
  const names = fromRaw ?? [...String(row.caption ?? "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map((match) => match[1]);
  return [...new Set(names.filter(Boolean).map((name) => String(name).replace(/^#/, "").toLowerCase()))];
}

function spokenHook(cues, transcript) {
  const sentence = transcript.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? cues[0].text;
  return sentence.length > HOOK_MAX ? `${sentence.slice(0, HOOK_MAX - 1).trimEnd()}…` : sentence;
}

/**
 * The slim row for one post. vtt: its subtitle text, when there is one.
 * thumb: the stored cover's path. A row already done (evidence_at, no raw) is
 * returned as it is, so a second run costs nothing.
 */
export function evidenceOf(row, { vtt, thumb, slides, now = new Date() } = {}) {
  if (row.evidence_at && !row.raw) return row;
  const { raw, ...rest } = row;
  const cues = vtt ? parseVtt(vtt) : [];
  const transcript = cues.map((cue) => cue.text).join(" ");
  const facts = {};
  if (Number(raw?.videoMeta?.duration) > 0) facts.duration_s = Number(raw.videoMeta.duration);
  if (typeof raw?.isSlideshow === "boolean") facts.slideshow = raw.isSlideshow;
  if (slideLinks(row).length) facts.slides = slideLinks(row).length;
  if (typeof raw?.musicMeta?.musicOriginal === "boolean") facts.original_sound = raw.musicMeta.musicOriginal;
  facts.has_speech = Boolean(transcript);
  if (transcript) {
    facts.first_word_s = round2(cues[0].start);
    // Pace while speaking: from the first word to the end of the last cue.
    const span = cues.at(-1).end - cues[0].start;
    if (span > 0) facts.words_per_s = round2(transcript.split(/\s+/).length / span);
  }
  return {
    ...rest,
    hashtags: hashtagsOf(row),
    ...(transcript ? { transcript, spoken_hook: spokenHook(cues, transcript) } : {}),
    ...(thumb ? { thumb } : {}),
    ...(slides ? { slides } : {}),
    facts,
    evidence_at: new Date(now).toISOString()
  };
}

const subtitleLink = (row, language) => {
  const links = (row.raw?.videoMeta?.subtitleLinks ?? []).filter((link) => link?.downloadLink || link?.tiktokLink);
  const pick = links.find((link) => String(link.language ?? "").toLowerCase().startsWith(language.toLowerCase())) ?? links[0];
  return pick?.downloadLink || pick?.tiktokLink;
};
/**
 * A photo post's slide image links, in order: TikTok's slideshowImageLinks
 * ({downloadLink, tiktokLink}), Instagram's images (links) or childPosts
 * ({displayUrl}). → [] for a video or a single image.
 */
export function slideLinks(row) {
  const raw = row.raw ?? {};
  const list = [raw.slideshowImageLinks, raw.images, raw.childPosts].find((value) => Array.isArray(value) && value.length) ?? [];
  const links = list.map((entry) => (typeof entry === "string" ? entry : entry?.downloadLink || entry?.tiktokLink || entry?.displayUrl)).filter((link) => /^https:\/\//.test(String(link)));
  return links.length > 1 ? links : [];
}
const coverLink = (row) => row.raw?.videoMeta?.coverUrl || row.raw?.videoMeta?.originalCoverUrl || row.raw?.displayUrl;

async function get(fetch, url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response;
}

/** Downloads a cover and stores a copy at most 360 px wide. → the stored file. The download is deleted. */
async function storeThumb(fetch, url, thumbsDir, id) {
  const name = String(id).replace(/[^\w.-]/g, "_");
  const source = path.join(thumbsDir, `${name}.download`);
  const file = path.join(thumbsDir, `${name}.jpg`);
  try {
    await writeFile(source, Buffer.from(await (await get(fetch, url)).arrayBuffer()));
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", source, "-vf", `scale='min(${THUMB_WIDTH},iw)':-2`, "-frames:v", "1", "-q:v", "8", file]);
    return file;
  } finally {
    await rm(source, { force: true });
  }
}

/** Downloads a post's first slides and stores them as one sheet. → the stored file. The downloads are deleted. */
async function storeSlides(fetch, links, slidesDir, id) {
  const name = String(id).replace(/[^\w.-]/g, "_");
  const shown = links.slice(0, SLIDE.max);
  const cell = (index) => path.join(slidesDir, `${name}-${String(index + 1).padStart(2, "0")}`);
  const file = path.join(slidesDir, `${name}.jpg`);
  try {
    for (const [index, link] of shown.entries()) {
      await writeFile(`${cell(index)}.download`, Buffer.from(await (await get(fetch, link)).arrayBuffer()));
      await run("ffmpeg", ["-y", "-loglevel", "error", "-i", `${cell(index)}.download`, "-vf", `scale=${SLIDE.width}:${SLIDE.height}:force_original_aspect_ratio=decrease,pad=${SLIDE.width}:${SLIDE.height}:(ow-iw)/2:(oh-ih)/2`, "-frames:v", "1", "-q:v", "6", `${cell(index)}.jpg`]);
    }
    const columns = Math.min(shown.length, SLIDE.columns);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-start_number", "1", "-i", path.join(slidesDir, `${name}-%02d.jpg`), "-vf", `tile=${columns}x${Math.ceil(shown.length / columns)}`, "-frames:v", "1", "-q:v", "6", file]);
    return file;
  } finally {
    await Promise.all(shown.flatMap((_, index) => [rm(`${cell(index)}.download`, { force: true }), rm(`${cell(index)}.jpg`, { force: true })]));
  }
}

const hasFfmpeg = () => spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

/**
 * Fetches each post's subtitle and, with a thumbsDir and ffmpeg on PATH, a
 * small copy of its cover; with a slidesDir, one sheet of a photo post's
 * slides. A fetch that fails is counted and the row goes on
 * without it. Rows already done are passed through and not counted.
 * language: the subtitle to prefer, by prefix ("eng" matches "eng-US").
 * onStep(text): a progress line every 25 posts.
 * → {rows, counts: {posts, transcripts, thumbs, slides, subtitle_failures, thumb_failures, slide_failures}}
 */
export async function gatherEvidence(rows, { fetch = globalThis.fetch, concurrency = 8, thumbsDir, slidesDir, language = "eng", onStep = () => {}, now } = {}) {
  const counts = { posts: 0, transcripts: 0, thumbs: 0, slides: 0, subtitle_failures: 0, thumb_failures: 0, slide_failures: 0 };
  const thumbs = Boolean(thumbsDir) && hasFfmpeg();
  const sheets = Boolean(slidesDir) && hasFfmpeg();
  if (sheets) await mkdir(slidesDir, { recursive: true });
  if (thumbs) await mkdir(thumbsDir, { recursive: true });
  const out = await mapLimit(rows, concurrency, async (row) => {
    if (row.evidence_at && !row.raw) return row;
    let vtt;
    let thumb;
    let slides;
    const subtitle = subtitleLink(row, language);
    if (subtitle) {
      try {
        const text = await (await get(fetch, subtitle)).text();
        if (!parseVtt(text).length) throw new Error("no cues");
        vtt = text;
        counts.transcripts += 1;
      } catch {
        counts.subtitle_failures += 1;
      }
    }
    const cover = thumbs && coverLink(row);
    if (cover) {
      try {
        // Stored relative to the library's folder, which holds thumbsDir.
        thumb = path.posix.join(path.basename(thumbsDir), path.basename(await storeThumb(fetch, cover, thumbsDir, row.id)));
        counts.thumbs += 1;
      } catch {
        counts.thumb_failures += 1;
      }
    }
    const links = sheets ? slideLinks(row) : [];
    if (links.length) {
      try {
        slides = path.posix.join(path.basename(slidesDir), path.basename(await storeSlides(fetch, links, slidesDir, row.id)));
        counts.slides += 1;
      } catch {
        counts.slide_failures += 1;
      }
    }
    counts.posts += 1;
    if (counts.posts % 25 === 0) onStep(`Evidence: ${counts.posts} post(s), ${counts.transcripts} transcript(s), ${counts.thumbs} thumb(s)`);
    return evidenceOf(row, { vtt, thumb, slides, now });
  });
  // Slimming drops the links, so a run with the network down would lose them for good: stop before anything is written.
  if (counts.subtitle_failures + counts.thumb_failures >= 5 && counts.transcripts + counts.thumbs === 0) throw new Error("no subtitle or cover could be fetched, so the library is left as it was; check the connection and run it again");
  return { rows: out, counts };
}

const USAGE = "library evidence <library.jsonl> [--text-only] [--concurrency <n>] [--language eng]";

/**
 * `launchclip score library evidence <library.jsonl>`: rewrites the library in
 * place with slim rows. Covers go to thumbs/ and photo posts' slide sheets to
 * slides/ beside it unless --text-only.
 * io: {fetch?, stdout?}. → {out, counts}
 */
export async function runEvidence(target, flags = {}, io = {}) {
  if (!target) throw new Error(`usage: ${USAGE}`);
  const file = path.resolve(String(target));
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const concurrency = flags.concurrency != null ? Number(flags.concurrency) : undefined;
  if (concurrency !== undefined && !(concurrency >= 1)) throw new Error(`--concurrency must be 1 or more; got ${flags.concurrency}`);
  const rows = (await readFile(file, "utf8")).split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  const stdout = io.stdout ?? process.stdout;
  const { rows: slim, counts } = await gatherEvidence(rows, {
    ...(io.fetch ? { fetch: io.fetch } : {}),
    ...(concurrency ? { concurrency } : {}),
    ...(flags["text-only"] || flags.textOnly ? {} : { thumbsDir: path.join(path.dirname(file), "thumbs"), slidesDir: path.join(path.dirname(file), "slides") }),
    ...(flags.language ? { language: String(flags.language) } : {}),
    onStep: (text) => stdout.write(`${text}\n`)
  });
  // Written beside the library then renamed, so a crash never leaves half a file.
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${slim.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await rename(temp, file);
  return { out: file, counts };
}
