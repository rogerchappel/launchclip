// Narration text → voice WAV + NARRATION.json, shared by `launchclip finish`
// (its voice stage) and `launchclip voice` (measure the real take before the
// storyboard's scenes are frozen).
//
// The request is {text, provider, voice, speed} from audio.narration, with
// per-provider defaults (Kokoro: af_heart at 1.2). Every take is cached by a
// hash of that request (and the normaliser) under <project>/.launchclip/voice,
// or $LAUNCHCLIP_CACHE/voice without a project, so measuring with
// `launchclip voice` and then running finish synthesises once.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_NARRATION_PROVIDER = "kokoro";
// Provider defaults when audio.narration leaves voice or speed out.
export const NARRATION_DEFAULTS = Object.freeze({
  kokoro: Object.freeze({ voice: "af_heart", speed: 1.2 }),
  elevenlabs: Object.freeze({ voice: null, speed: 1 }),
  test: Object.freeze({ voice: null, speed: 1 }),
  supplied: Object.freeze({ voice: null, speed: 1 })
});
const CACHE_VERSION = 1;

/**
 * The synthesis request for audio.narration plus CLI overrides.
 * overrides: {provider, voice, speed, text}
 * → {text, provider, voice, speed}
 */
export function narrationRequest(narration = {}, overrides = {}) {
  const text = String(overrides.text ?? narration?.text ?? "").trim();
  const provider = String(overrides.provider ?? narration?.provider ?? DEFAULT_NARRATION_PROVIDER).toLowerCase();
  const defaults = NARRATION_DEFAULTS[provider] ?? { voice: null, speed: 1 };
  const voice = overrides.voice ?? narration?.voice ?? defaults.voice ?? null;
  const rawSpeed = overrides.speed ?? narration?.speed ?? defaults.speed ?? 1;
  const speed = Number(rawSpeed);
  if (!(speed >= 0.5 && speed <= 2)) throw new Error(`narration speed must be a number between 0.5 and 2; got ${rawSpeed}`);
  return { text, provider, voice, speed };
}

/** Cache key of one take: sha256 of the request and the cache version. */
export function narrationCacheKey(request) {
  const identity = { v: CACHE_VERSION, text: request.text, provider: request.provider, voice: request.voice ?? null, speed: request.speed };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
}

/** <project>/.launchclip/voice, else $LAUNCHCLIP_CACHE/voice, else ~/.cache/launchclip/voice. */
export function voiceCacheDir(project, env = process.env) {
  if (project) return path.join(project, ".launchclip", "voice");
  return env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "voice") : path.join(os.homedir(), ".cache", "launchclip", "voice");
}

/**
 * Synthesise (or reuse) one take into outFile.
 * options: {outFile, cacheDir, voiceProvider(name) → provider, normalizeVoice(input, output) → loudness,
 *   source (the supplied provider's audio file)}
 * Synthesised voices are levelled to the supplied-voiceover loudness (Kokoro
 * arrives near -22 LUFS); the offline test tone and supplied audio are not.
 * → {file, words: [{text, start, end}], duration, sampleRate, loudness, cached, cache_key}
 */
export async function synthesizeNarration(request, { outFile, cacheDir = null, voiceProvider, normalizeVoice, source } = {}) {
  if (!request?.text) throw new Error("narration text is empty: set audio.narration.text (or pass --text)");
  if (!outFile) throw new Error("synthesizeNarration needs outFile");
  await mkdir(path.dirname(outFile), { recursive: true });
  const cacheable = request.provider !== "supplied" && cacheDir;
  const key = narrationCacheKey(request);
  const cachedWav = cacheable ? path.join(cacheDir, `${key}.wav`) : null;
  const cachedMeta = cacheable ? path.join(cacheDir, `${key}.json`) : null;
  if (cacheable && existsSync(cachedWav) && existsSync(cachedMeta)) {
    const meta = JSON.parse(await readFile(cachedMeta, "utf8"));
    if (Array.isArray(meta.words) && meta.words.length) {
      if (path.resolve(cachedWav) !== path.resolve(outFile)) await copyFile(cachedWav, outFile);
      return { file: outFile, words: meta.words, duration: meta.duration_seconds, sampleRate: meta.sample_rate ?? null, loudness: meta.loudness ?? null, cached: true, cache_key: key };
    }
  }
  const provider = voiceProvider(request.provider, {});
  const synthesis = { text: request.text, voice: request.voice ?? undefined, speed: request.speed, outFile };
  if (request.provider === "supplied" && source) synthesis.source = source;
  const result = await provider.synthesize(synthesis);
  if (!result || !Array.isArray(result.words) || !result.words.length) throw new Error(`voice provider "${request.provider}" returned no word timings`);
  const produced = path.resolve(result.file ?? outFile);
  if (produced !== path.resolve(outFile)) await copyFile(produced, outFile);
  let loudness = null;
  if (request.provider !== "supplied" && request.provider !== "test" && typeof normalizeVoice === "function") {
    const normalized = `${outFile}.norm.wav`;
    loudness = await normalizeVoice(outFile, normalized);
    await rename(normalized, outFile);
  }
  const words = result.words.map((word) => ({ text: String(word.text), start: round3(Number(word.start)), end: round3(Number(word.end)) }));
  const duration = round3(Number(result.duration ?? words.at(-1).end));
  if (cacheable) {
    await mkdir(cacheDir, { recursive: true });
    await copyFile(outFile, cachedWav);
    await writeFile(cachedMeta, `${JSON.stringify({ schema_version: "launchclip.voice-cache.v1", request, words, duration_seconds: duration, sample_rate: result.sampleRate ?? null, loudness }, null, 2)}\n`);
  }
  return { file: outFile, words, duration, sampleRate: result.sampleRate ?? null, loudness, cached: false, cache_key: key };
}

/** The NARRATION.json document (launchclip.narration.v1) for a take. */
export function narrationDocument(request, take) {
  return {
    schema_version: "launchclip.narration.v1",
    provider: request.provider,
    voice: request.voice,
    speed: request.speed,
    text: request.text,
    sample_rate: take.sampleRate ?? null,
    duration_seconds: take.duration,
    words: take.words
  };
}

/**
 * Sentence-level timing for sizing scenes: one row per sentence (split after
 * words ending in . ! or ?), with its first and last word times.
 * → [{index, start, end, duration, words, first_word, text}]
 */
export function narrationSentences(words = []) {
  const rows = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    const start = current[0].start;
    const end = current.at(-1).end;
    rows.push({ index: rows.length + 1, start, end, duration: round3(end - start), words: current.length, first_word: current[0].text, text: current.map((word) => word.text).join(" ") });
    current = [];
  };
  for (const word of words) {
    current.push(word);
    if (/[.!?]["'”’)]*$/.test(String(word.text))) flush();
  }
  flush();
  return rows;
}

/** A plain-text report: duration, word count, rate and the sentence timing table. */
export function formatNarrationReport({ request, take, narrationFile, voiceFile }) {
  const sentences = narrationSentences(take.words);
  const wpm = take.duration > 0 ? Math.round(take.words.length / take.duration * 60) : 0;
  const lines = [
    `voice: ${request.provider}${request.voice ? ` ${request.voice}` : ""} at speed ${request.speed}${take.cached ? " (cached take)" : ""}`,
    `duration: ${take.duration.toFixed(2)} s   words: ${take.words.length}   rate: ${wpm} wpm`,
    `narration: ${narrationFile}`,
    `audio: ${voiceFile}`,
    "",
    "  #  start    end      dur   anchor              text"
  ];
  for (const row of sentences) {
    const anchor = `word:${row.first_word.replace(/[^\p{L}\p{N}'-]/gu, "").toLowerCase()}`;
    const text = row.text.length > 60 ? `${row.text.slice(0, 57)}...` : row.text;
    lines.push(`${String(row.index).padStart(3)}  ${row.start.toFixed(2).padStart(6)}  ${row.end.toFixed(2).padStart(6)}  ${row.duration.toFixed(2).padStart(6)}   ${anchor.padEnd(18)}  ${text}`);
  }
  lines.push("", "Size format.duration to the duration plus a short tail, give each beat its sentence's span, and anchor scene starts and hits to words (word:<text>) rather than seconds.");
  return `${lines.join("\n")}\n`;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
