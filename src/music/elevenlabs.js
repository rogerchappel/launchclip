// ElevenLabs music provider (paid, opt-in). Requires ELEVENLABS_API_KEY.
//
// POST /v1/music ("Compose music") with either a text prompt plus
// music_length_ms and force_instrumental, or a music_v1 composition plan whose
// sections follow the story's energy arc (see prompt.js). The response body is
// the audio file. Every generation is cached by a hash of (prompt or plan,
// length, model, seed, output format) under
// $LAUNCHCLIP_CACHE/elevenlabs/music (default ~/.cache/launchclip/...), and a
// cached track is never generated again.
//
// The API key is read from the environment at call time, sent only in the
// xi-api-key header, and never logged, cached or put in an error message.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMusicRequest } from "./prompt.js";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const MUSIC_ENDPOINT = "/v1/music";
export const DEFAULT_MUSIC_MODEL = "music_v1";
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
// The repository's configured pay-as-you-go estimate (src/cost_tracker.js).
export const USD_PER_GENERATED_MINUTE = 0.15;

/** $LAUNCHCLIP_CACHE/elevenlabs/music, else ~/.cache/launchclip/elevenlabs/music. */
export function musicCacheDir(env = process.env) {
  return env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "elevenlabs", "music") : path.join(os.homedir(), ".cache", "launchclip", "elevenlabs", "music");
}

/** Cache key of one request: sha256 of the prompt or plan, length, model, seed and format. */
export function musicCacheKey(body, outputFormat = DEFAULT_OUTPUT_FORMAT) {
  const identity = {
    prompt: body.prompt ?? null,
    composition_plan: body.composition_plan ?? null,
    music_length_ms: body.music_length_ms ?? planLength(body) ?? null,
    model_id: body.model_id ?? DEFAULT_MUSIC_MODEL,
    seed: body.seed ?? null,
    force_instrumental: body.force_instrumental ?? null,
    output_format: outputFormat
  };
  return createHash("sha256").update(stableJson(identity)).digest("hex").slice(0, 32);
}

function planLength(body) {
  const sections = body?.composition_plan?.sections;
  return Array.isArray(sections) ? sections.reduce((sum, section) => sum + Number(section.duration_ms ?? 0), 0) : null;
}

export function create(options = {}) {
  const env = options.env ?? process.env;
  const cacheDir = options.cacheDir ?? musicCacheDir(env);
  const outputFormat = options.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  return {
    name: "elevenlabs",
    paid: true,
    cacheDir,
    /** The request for a story without sending it (for previews and cache lookups). */
    request(story, params = {}) {
      return buildMusicRequest(story, { model: options.model ?? env.ELEVENLABS_MUSIC_MODEL ?? DEFAULT_MUSIC_MODEL, ...params });
    },
    /**
     * Whether generate() would be a cache hit, without sending anything.
     * → {cached, cache_key, cache_file, length_ms, cost_usd_estimate}
     */
    cacheStatus(story, params = {}) {
      const request = this.request(story, params);
      const key = musicCacheKey(request.body, outputFormat);
      const cacheFile = path.join(cacheDir, `${key}${extensionFor(outputFormat)}`);
      return { cached: existsSync(cacheFile), cache_key: key, cache_file: cacheFile, length_ms: request.length_ms, cost_usd_estimate: round4(request.length_ms / 60000 * USD_PER_GENERATED_MINUTE) };
    },
    /**
     * Generate (or reuse) the track for a story and copy it to outFile.
     * force: true skips the cache and generates (paid) even on a hit.
     * params: {seconds, bpm, prompt?, seed?, model?, narrated}
     * → {file, cached, cache_file, cache_key, request: {mode, body (no key), length_ms, bpm, arc}, generated_seconds, cost_usd, song_id}
     */
    async generate(story, params = {}, { outFile, signal, force = false } = {}) {
      if (!outFile) throw new Error("ElevenLabs music needs outFile");
      const request = this.request(story, params);
      const key = musicCacheKey(request.body, outputFormat);
      const cacheFile = path.join(cacheDir, `${key}${extensionFor(outputFormat)}`);
      const metaFile = path.join(cacheDir, `${key}.json`);
      const summary = { mode: request.mode, body: request.body, length_ms: request.length_ms, bpm: request.bpm, arc: request.arc, tone: request.tone };
      await mkdir(path.dirname(outFile), { recursive: true });
      if (!force && existsSync(cacheFile)) {
        await copyFile(cacheFile, outFile);
        const meta = await readFile(metaFile, "utf8").then(JSON.parse).catch(() => ({}));
        return { file: outFile, cached: true, cache_file: cacheFile, cache_key: key, request: summary, generated_seconds: 0, cost_usd: 0, song_id: meta.song_id ?? null, model: request.body.model_id };
      }
      const apiKey = options.apiKey ?? env.ELEVENLABS_API_KEY;
      if (!apiKey) throw new Error("ElevenLabs music is opt-in and needs ELEVENLABS_API_KEY. Nothing was sent. Set the key (for example in .env), or use --music synth.");
      const fetchImpl = options.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");
      const url = `${options.baseUrl ?? ELEVENLABS_API}${MUSIC_ENDPOINT}?output_format=${encodeURIComponent(outputFormat)}`;
      let response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg, application/octet-stream" },
          body: JSON.stringify(request.body),
          signal
        });
      } catch (error) {
        throw new Error(`ElevenLabs music request failed: ${redact(error?.message ?? String(error), apiKey)}`);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`ElevenLabs music request failed (${response.status}): ${redact(detail, apiKey).slice(0, 400)}`);
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) throw new Error("ElevenLabs music returned an empty file");
      const headers = pickHeaders(response.headers);
      const generatedSeconds = request.length_ms / 1000;
      const meta = {
        schema_version: "launchclip.music-cache.v1",
        provider: "elevenlabs",
        endpoint: `POST ${MUSIC_ENDPOINT}`,
        output_format: outputFormat,
        request: summary,
        song_id: headers["song-id"] ?? headers["x-song-id"] ?? null,
        response_headers: headers,
        generated_seconds: generatedSeconds,
        cost_usd_estimate: round4(generatedSeconds / 60 * USD_PER_GENERATED_MINUTE),
        bytes: audio.length,
        created_at: new Date().toISOString()
      };
      await mkdir(cacheDir, { recursive: true });
      // Write to a temporary name first so an interrupted run never leaves a
      // truncated file that later looks like a cache hit.
      const temporary = `${cacheFile}.${process.pid}.tmp`;
      await writeFile(temporary, audio);
      await rename(temporary, cacheFile);
      await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
      await copyFile(cacheFile, outFile);
      return { file: outFile, cached: false, cache_file: cacheFile, cache_key: key, request: summary, generated_seconds: generatedSeconds, cost_usd: meta.cost_usd_estimate, song_id: meta.song_id, model: request.body.model_id };
    }
  };
}

function extensionFor(outputFormat) {
  return outputFormat.startsWith("mp3") ? ".mp3" : outputFormat.startsWith("pcm") ? ".pcm" : outputFormat.startsWith("opus") ? ".opus" : ".bin";
}

// Response headers worth keeping (ids and usage); never request headers.
function pickHeaders(headers) {
  const kept = {};
  if (!headers || typeof headers.forEach !== "function") return kept;
  headers.forEach((value, name) => {
    if (/song|request-id|character|credit|cost|usage|history-item/i.test(name)) kept[name.toLowerCase()] = value;
  });
  return kept;
}

/** Remove any occurrence of the key from text. */
export function redact(text, secret) {
  const value = String(text ?? "");
  return secret && secret.length >= 4 ? value.split(secret).join("[redacted]") : value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
