// Asset inventory for `launchclip make` (src/make/index.js).
//
//   inventoryAssets(dir, {transcribe, probe, speech, frames}) → ASSETS.json document
//
// Every file under --assets is classified, probed and described in one line,
// with a confidence (0–1) and the signals behind it, so routing
// (src/make/routing.js) never needs a model.
//
// Kinds:
//   image   logo | screenshot | product-image
//   video   talking-head | screen-recording | b-roll
//   audio   voiceover | music
//   brand   brand.json (colors, fonts)
//   style   a style pack (style.json, or a folder holding one)
//   notes   .md / .txt brief context
//   other   ignored
//
// Heuristics (all local; documented in the CLI reference, "Make a video headlessly"):
// - Logo vs screenshot: a filename hint (logo, icon, mark, brand, favicon)
//   decides; otherwise an SVG, or a small (≤ 1024 px) image that has an alpha
//   channel or is square-ish (aspect 0.8–1.25), is a logo. Larger or wide
//   images are screenshots; "product", "photo", "hero" or "shot" filename
//   hints make a product image.
// - Speech presence (videos and audio): the audio is band-passed to the voice
//   band (200–3400 Hz) and run through silencedetect. Speech is voiced for 25–
//   97% of the clip and pauses between phrases (at least 2 pauses a minute, or
//   any pause in a clip under 20 s); a music bed is voiced throughout with no
//   pauses, and a silent screen recording has no voiced audio at all.
//   Transcription (local Whisper) then confirms it: at least 0.6 words/s.
// - Camera vs UI (videos with speech): three frames scaled to 64×36 grey; a UI
//   capture is mostly flat (≥ 55% of pixels equal to their right neighbour
//   within 1 level) and has hard edges from text and borders (≥ 6% of
//   neighbour steps over 20 levels); camera footage is noisy (not flat) and a
//   lit set is flat but soft (few hard edges). Face detection is not used.
//   Filename hints (talk, head, podcast, interview, camera, presenter, vlog /
//   screen, demo, ui, capture, walkthrough) override the visual signal.
// - A video with speech that looks like camera footage is a talking head; with
//   speech and a UI look it is a narrated screen recording; without speech it
//   is a screen recording (UI look, or no audio) or b-roll.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ASSETS_VERSION = "launchclip.make-assets.v1";
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
export const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
export const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus"]);
export const NOTES_EXT = new Set([".md", ".txt"]);
// Video formats the story compilers mount directly (kit/core/story.mjs VIDEO_FILE).
export const MOUNTABLE_VIDEO = new Set([".mp4", ".m4v", ".mov", ".webm"]);

const LOGO_HINT = /(^|[^a-z])(logo|logomark|icon|mark|brand|favicon|wordmark)([^a-z]|$)/i;
const PRODUCT_HINT = /(^|[^a-z])(product|photo|hero|packshot|render)([^a-z]|$)/i;
const SCREEN_HINT = /(^|[^a-z])(screen|screencast|demo|ui|capture|walkthrough|recording-ui|app|dashboard)([^a-z]|$)/i;
const CAMERA_HINT = /(^|[^a-z])(talk|talking|head|talkinghead|podcast|interview|camera|cam|selfie|vlog|presenter|speaker|host|founder)([^a-z]|$)/i;
const VOICE_HINT = /(^|[^a-z])(voiceover|voice-over|vo|narration|voice)([^a-z]|$)/i;
const MUSIC_HINT = /(^|[^a-z])(music|bed|track|song|soundtrack|bgm)([^a-z]|$)/i;

/**
 * Inventory a folder. options: {transcribe(file) → whisper-style JSON | null,
 * cache (a previous ASSETS.json document: entries with the same size+mtime
 * are reused, transcripts included), probe, speech, frames (adapters)}.
 * → {schema_version, dir, entries: [...], counts, summary}
 */
export async function inventoryAssets(dir, options = {}) {
  const root = path.resolve(dir);
  if (!existsSync(root)) throw new Error(`--assets ${root} does not exist`);
  const adapters = { probe: probeFile, speech: speechProfile, frames: flatnessProfile, transcribe: null, ...options };
  const files = await listFiles(root);
  const cached = new Map((options.cache?.entries ?? []).map((entry) => [entry.path, entry]));
  const entries = [];
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const info = await stat(file);
    const fingerprint = `${info.size}:${Math.round(info.mtimeMs)}`;
    const previous = cached.get(relative);
    if (previous && previous.fingerprint === fingerprint) { entries.push(previous); continue; }
    const entry = await classifyFile(file, relative, adapters);
    entry.fingerprint = fingerprint;
    entry.bytes = info.size;
    entries.push(entry);
  }
  const counts = {};
  for (const entry of entries) {
    const key = entry.role ? `${entry.kind}:${entry.role}` : entry.kind;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { schema_version: ASSETS_VERSION, dir: root, entries, counts, summary: entries.map((entry) => `${entry.path}: ${entry.description}`) };
}

/** Classify one file. → {path, kind, role, confidence, signals, description, media?, transcript?} */
export async function classifyFile(file, relative, adapters = {}) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  const name = base.toLowerCase();
  const probe = adapters.probe ?? probeFile;
  if (name === "brand.json") return brandEntry(file, relative);
  if (name === "style.json") return styleEntry(file, relative);
  if (NOTES_EXT.has(ext)) {
    const text = await readFile(file, "utf8");
    const words = text.split(/\s+/).filter(Boolean).length;
    return { path: relative, kind: "notes", role: "notes", confidence: 1, signals: ["extension"], description: `Brief notes (${words} words): ${firstLine(text)}`, text: text.slice(0, 20_000) };
  }
  if (IMAGE_EXT.has(ext)) return imageEntry(file, relative, ext, await safeProbe(probe, file));
  if (VIDEO_EXT.has(ext)) return videoEntry(file, relative, ext, await safeProbe(probe, file), adapters);
  if (AUDIO_EXT.has(ext)) return audioEntry(file, relative, await safeProbe(probe, file), adapters);
  return { path: relative, kind: "other", role: null, confidence: 1, signals: ["extension"], description: `Unrecognised file (${ext || "no extension"}); ignored` };
}

async function brandEntry(file, relative) {
  let brand = null;
  let error = null;
  try { brand = JSON.parse(await readFile(file, "utf8")); } catch (failure) { error = failure.message; }
  const colors = brand?.colors && typeof brand.colors === "object" ? Object.keys(brand.colors) : [];
  return { path: relative, kind: "brand", role: "brand", confidence: error ? 0.3 : 1, signals: ["filename"], description: error ? `brand.json is not valid JSON (${error}); ignored` : `Brand: ${colors.length} colour roles${brand?.fonts ? `, fonts ${Object.values(brand.fonts).join(", ")}` : ""}${brand?.name ? ` for ${brand.name}` : ""}`, brand: error ? null : brand };
}

async function styleEntry(file, relative) {
  let pack = null;
  try { pack = JSON.parse(await readFile(file, "utf8")); } catch { pack = null; }
  return { path: relative, kind: "style", role: "style", confidence: pack?.name ? 1 : 0.4, signals: ["filename"], description: pack?.name ? `Style pack "${pack.name}"${pack.description ? `: ${String(pack.description).slice(0, 80)}` : ""}` : "style.json without a name; ignored", style_name: pack?.name ?? null };
}

function imageEntry(file, relative, ext, probe) {
  const stream = probe?.streams?.find((entry) => entry.codec_type === "video") ?? {};
  let width = Number(stream.width) || null;
  let height = Number(stream.height) || null;
  const alpha = /a|pal8/.test(String(stream.pix_fmt ?? "")) && !/^(yuvj?4[24][024]p)$/.test(String(stream.pix_fmt ?? ""));
  const name = path.basename(file);
  const signals = [];
  let role;
  let confidence;
  const largest = Math.max(width ?? 0, height ?? 0);
  const aspect = width && height ? width / height : null;
  const squareish = aspect !== null && aspect >= 0.8 && aspect <= 1.25;
  if (LOGO_HINT.test(name)) { role = "logo"; confidence = 0.95; signals.push("filename:logo"); }
  else if (ext === ".svg") { role = "logo"; confidence = 0.75; signals.push("svg"); }
  else if (largest && largest <= 1024 && (alpha || squareish)) {
    role = "logo";
    confidence = alpha && squareish ? 0.85 : 0.65;
    signals.push(`small:${largest}px`, ...(alpha ? ["alpha"] : []), ...(squareish ? ["square"] : []));
  } else if (PRODUCT_HINT.test(name)) { role = "product-image"; confidence = 0.8; signals.push("filename:product"); }
  else {
    role = "screenshot";
    confidence = largest > 1024 && aspect !== null && (aspect > 1.3 || aspect < 0.77) ? 0.8 : 0.6;
    signals.push(largest ? `size:${width}x${height}` : "no-dimensions");
  }
  const size = width && height ? `${width}×${height}` : "unknown size";
  const description = role === "logo"
    ? `Logo image (${size}${alpha ? ", transparent" : ""}) for the brand lockup or end card`
    : role === "product-image" ? `Product image (${size}) to show in a media window`
      : `Screenshot (${size}) of the product UI to show in a media window`;
  return { path: relative, kind: "image", role, confidence, signals, description, media: { kind: "image", width, height, alpha } };
}

async function videoEntry(file, relative, ext, probe, adapters) {
  const video = probe?.streams?.find((entry) => entry.codec_type === "video") ?? {};
  const audio = probe?.streams?.find((entry) => entry.codec_type === "audio") ?? null;
  const duration = round2(Number(probe?.format?.duration ?? video.duration) || 0);
  const width = Number(video.width) || null;
  const height = Number(video.height) || null;
  const name = path.basename(file);
  const signals = [];
  const speech = audio && duration > 0 ? await (adapters.speech ?? speechProfile)(file, duration) : { voiced_ratio: 0, pauses: 0, speech: false };
  signals.push(audio ? `voiced:${speech.voiced_ratio}` : "no-audio");
  const flat = duration > 0 ? await (adapters.frames ?? flatnessProfile)(file, duration).catch(() => null) : null;
  if (flat) signals.push(`flat:${flat.flat_ratio}`, `edges:${flat.edge_ratio}`);
  let transcript = null;
  if (speech.speech && adapters.transcribe) transcript = await transcribeEntry(file, adapters.transcribe, duration);
  const wordRate = transcript ? transcript.words.length / Math.max(1, duration) : null;
  const hasSpeech = speech.speech && (transcript ? wordRate >= 0.6 : true);
  if (transcript) signals.push(`words:${transcript.words.length}`);
  const uiLike = flat ? isUiLike(flat) : false;
  const cameraHint = CAMERA_HINT.test(name);
  const screenHint = SCREEN_HINT.test(name);
  let role;
  let confidence;
  if (hasSpeech) {
    if (cameraHint || (!screenHint && !uiLike)) {
      role = "talking-head";
      confidence = cameraHint ? 0.9 : transcript ? 0.8 : 0.65;
      signals.push(cameraHint ? "filename:camera" : "camera-look");
    } else {
      role = "screen-recording";
      confidence = screenHint && uiLike ? 0.85 : 0.65;
      signals.push(screenHint ? "filename:screen" : "ui-look", "narrated");
    }
  } else if (screenHint || uiLike || !audio) {
    role = "screen-recording";
    confidence = (screenHint ? 0.35 : 0) + (uiLike ? 0.35 : 0) + (!audio || speech.voiced_ratio < 0.05 ? 0.25 : 0) + 0.05;
    confidence = Math.min(0.95, round2(confidence));
    if (screenHint) signals.push("filename:screen");
    if (uiLike) signals.push("ui-look");
  } else {
    role = "b-roll";
    confidence = 0.55;
  }
  const orientation = width && height ? (width > height ? "landscape" : width < height ? "portrait" : "square") : "unknown";
  const size = width && height ? `${width}×${height}` : "unknown size";
  const description = role === "talking-head"
    ? `Talking-head recording (${duration}s, ${size}, speech${transcript ? `: "${clip(transcript.text, 70)}"` : ""})`
    : role === "screen-recording"
      ? `${hasSpeech ? "Narrated screen recording" : "Screen recording / product demo"} (${duration}s, ${size}${audio ? "" : ", silent"})`
      : `B-roll footage (${duration}s, ${size}, no speech)`;
  const entry = {
    path: relative, kind: "video", role, confidence, signals, description,
    media: { kind: "video", width, height, orientation, duration, has_audio: Boolean(audio), mountable: MOUNTABLE_VIDEO.has(ext) },
    speech: { present: hasSpeech, voiced_ratio: speech.voiced_ratio, pauses: speech.pauses, words_per_second: wordRate === null ? null : round2(wordRate) },
    visual: flat ? { flat_ratio: flat.flat_ratio, edge_ratio: flat.edge_ratio, ui_like: uiLike } : null
  };
  if (transcript) entry.transcript = transcript;
  return entry;
}

async function audioEntry(file, relative, probe, adapters) {
  const duration = round2(Number(probe?.format?.duration) || 0);
  const name = path.basename(file);
  const speech = duration > 0 ? await (adapters.speech ?? speechProfile)(file, duration) : { voiced_ratio: 0, pauses: 0, speech: false };
  const signals = [`voiced:${speech.voiced_ratio}`, `pauses:${speech.pauses}`];
  let transcript = null;
  if ((speech.speech || VOICE_HINT.test(name)) && adapters.transcribe && !MUSIC_HINT.test(name)) transcript = await transcribeEntry(file, adapters.transcribe, duration);
  const wordRate = transcript ? transcript.words.length / Math.max(1, duration) : null;
  let role;
  let confidence;
  if (VOICE_HINT.test(name)) { role = "voiceover"; confidence = 0.9; signals.push("filename:voice"); }
  else if (MUSIC_HINT.test(name)) { role = "music"; confidence = 0.9; signals.push("filename:music"); }
  else if (speech.speech && (transcript ? wordRate >= 0.6 : true)) { role = "voiceover"; confidence = transcript ? 0.85 : 0.65; }
  else { role = "music"; confidence = speech.voiced_ratio > 0.9 ? 0.75 : 0.5; }
  if (transcript) signals.push(`words:${transcript.words.length}`);
  const description = role === "voiceover"
    ? `Voiceover (${duration}s${transcript ? `: "${clip(transcript.text, 70)}"` : ""})`
    : `Music track (${duration}s)`;
  const entry = { path: relative, kind: "audio", role, confidence, signals, description, media: { kind: "audio", duration }, speech: { present: role === "voiceover", voiced_ratio: speech.voiced_ratio, pauses: speech.pauses, words_per_second: wordRate === null ? null : round2(wordRate) } };
  if (transcript) entry.transcript = transcript;
  return entry;
}

async function transcribeEntry(file, transcribe, duration) {
  try {
    const raw = await transcribe(file);
    const words = wordsFromTranscript(raw);
    return { text: words.map((word) => word.text).join(" "), words, duration_seconds: duration, raw: raw ?? null };
  } catch (error) {
    return { text: "", words: [], duration_seconds: duration, error: String(error?.message ?? error).split("\n")[0] };
  }
}

/** Whisper JSON (segments[].words[]) or a word list → [{text, start, end}]. */
export function wordsFromTranscript(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.words) ? raw.words : (raw?.segments ?? []).flatMap((segment) => segment.words ?? []);
  return list
    .map((entry) => ({ text: String(entry.word ?? entry.text ?? "").trim(), start: Number(entry.start), end: Number(entry.end) }))
    .filter((entry) => entry.text && Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end >= entry.start)
    .map((entry) => ({ text: entry.text, start: round3(entry.start), end: round3(entry.end) }));
}

// ---------------------------------------------------------------------------
// Signals (each replaceable in tests)

export async function probeFile(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function safeProbe(probe, file) {
  try { return await probe(file); } catch { return null; }
}

/**
 * Voice-band activity: {voiced_ratio, pauses, speech}. Band-pass 200–3400 Hz,
 * silencedetect at -38 dB for 0.25 s; voiced = 1 - silent / duration.
 */
export async function speechProfile(file, duration) {
  let stderr = "";
  try {
    const result = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-vn", "-af", "highpass=f=200,lowpass=f=3400,silencedetect=n=-38dB:d=0.25", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 });
    stderr = String(result.stderr ?? "");
  } catch (error) {
    stderr = String(error?.stderr ?? "");
    if (!stderr) return { voiced_ratio: 0, pauses: 0, speech: false };
  }
  return speechFromSilence(stderr, duration);
}

/** silencedetect output → speech decision (exported for tests). */
export function speechFromSilence(stderr, duration) {
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((match) => Math.max(0, Number(match[1])));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)].map((match) => ({ end: Number(match[1]), length: Number(match[2]) }));
  let silent = ends.reduce((sum, entry) => sum + entry.length, 0);
  if (starts.length > ends.length) silent += Math.max(0, duration - starts.at(-1));
  const voiced = duration > 0 ? Math.max(0, Math.min(1, 1 - silent / duration)) : 0;
  // Interior pauses: silences that start after 0.3 s and end before the tail.
  const pauses = ends.filter((entry) => entry.end - entry.length > 0.3 && entry.end < duration - 0.3).length;
  const perMinute = duration > 0 ? pauses / (duration / 60) : 0;
  const speech = voiced >= 0.25 && voiced <= 0.97 && (perMinute >= 2 || (duration < 20 && pauses >= 1));
  return { voiced_ratio: round2(voiced), pauses, speech };
}

/** The UI-look rule: flat and hard-edged (see the header). */
export function isUiLike({ flat_ratio, edge_ratio = 1 } = {}) {
  return flat_ratio >= 0.55 && edge_ratio >= 0.06;
}

/** Spatial flatness and edge density of three frames at 64×36 grey: {flat_ratio, edge_ratio}. */
export async function flatnessProfile(file, duration) {
  const width = 64, height = 36;
  const ratios = [];
  const edges = [];
  for (const fraction of [0.2, 0.5, 0.8]) {
    const at = Math.max(0, Math.min(duration - 0.05, duration * fraction));
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=area,format=gray`, "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1 << 20 });
    if (stdout.length < width * height) continue;
    ratios.push(flatRatio(stdout, width, height));
    edges.push(flatRatio(stdout, width, height, 20));
  }
  if (!ratios.length) return null;
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  return { flat_ratio: round2(mean(ratios)), edge_ratio: round3(mean(edges)) };
}

/**
 * Fraction of pixels within 1 grey level of their right neighbour; with
 * `edgeAbove`, the fraction whose step to the right neighbour exceeds it.
 */
export function flatRatio(pixels, width, height, edgeAbove = null) {
  let flat = 0, total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const step = Math.abs(pixels[index] - pixels[index + 1]);
      if (edgeAbove === null ? step <= 1 : step > edgeAbove) flat += 1;
      total += 1;
    }
  }
  return total ? flat / total : 0;
}

// ---------------------------------------------------------------------------
// Helpers

async function listFiles(root) {
  const out = [];
  const walk = async (dir, depth) => {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 4) await walk(full, depth + 1); }
      else if (entry.isFile()) out.push(full);
    }
  };
  await walk(root, 0);
  return out;
}

/** A stable hash of an inventory's file list (paths, sizes, mtimes). */
export function inventoryFingerprint(inventory) {
  return createHash("sha256").update(JSON.stringify((inventory?.entries ?? []).map((entry) => [entry.path, entry.fingerprint, entry.kind, entry.role]))).digest("hex").slice(0, 16);
}

function firstLine(text) {
  return clip(String(text).split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "", 80);
}

function clip(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function round2(value) { return Math.round(value * 100) / 100; }
function round3(value) { return Math.round(value * 1000) / 1000; }
