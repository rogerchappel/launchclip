// Optional ElevenLabs voice isolation for recorded voice (opt-in, paid).
//
// POST https://api.elevenlabs.io/v1/audio-isolation, multipart/form-data with
// the audio as `audio` (file_format "other": an encoded WAV), auth by the
// xi-api-key header; the response body is the isolated audio (MP3). ElevenLabs
// bills it by audio length (about 1,000 credits per minute at the time of
// writing) and accepts files up to 500 MB and 1 hour.
//
// It is only ever called when the caller asks for it (--voice-isolation
// elevenlabs), and every result is cached by the SHA-256 of the exact audio
// sent, so a rerun of the same edit never pays twice. The API key is read
// from the environment, sent only in the request header and scrubbed from
// every error message.

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const ELEVENLABS_ISOLATION_ENDPOINT = "/v1/audio-isolation";
export const ISOLATION_CACHE_VERSION = "elevenlabs-audio-isolation.v1";
const MAX_SECONDS = 3600;
const MAX_BYTES = 500 * 1024 * 1024;

export function isolationCacheDir(env = process.env) {
  return env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "elevenlabs", "audio-isolation") : path.join(os.homedir(), ".cache", "launchclip", "elevenlabs", "audio-isolation");
}

/**
 * Isolate the voice in `inputWav` (a mono PCM WAV) and decode the result to
 * `outputWav` (mono float WAV at `sampleRate`). Returns a receipt; never
 * includes the key.
 */
export async function isolateVoiceElevenLabs(inputWav, outputWav, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const run = options.run ?? execute;
  const notice = options.notice ?? (() => {});
  const apiKey = env.ELEVENLABS_API_KEY;
  const scrub = (text) => apiKey ? String(text).split(apiKey).join("[redacted]") : String(text);
  const audio = await readFile(inputWav);
  if (audio.length > MAX_BYTES) throw new Error("ElevenLabs voice isolation accepts files up to 500 MB; nothing was sent");
  const seconds = Number.isFinite(options.durationSeconds) ? options.durationSeconds : null;
  if (seconds !== null && seconds > MAX_SECONDS) throw new Error("ElevenLabs voice isolation accepts up to 1 hour of audio; nothing was sent");
  const hash = createHash("sha256").update(ISOLATION_CACHE_VERSION).update(audio).digest("hex");
  const cacheDir = options.cacheDir ?? isolationCacheDir(env);
  const cacheFile = path.join(cacheDir, `${hash}.mp3`);
  let cached = false;
  try { cached = (await stat(cacheFile)).size > 0; } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (cached) {
    notice(`voice isolation: REUSE cached ElevenLabs isolation for this exact audio; no paid call (${cacheFile})`);
  } else {
    if (!apiKey) throw new Error("ElevenLabs voice isolation is opt-in and needs ELEVENLABS_API_KEY. Nothing was sent. Set the key, or use --voice-isolation none.");
    if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available for ElevenLabs voice isolation");
    notice(`voice isolation: ElevenLabs Audio Isolation API (paid; POST ${ELEVENLABS_ISOLATION_ENDPOINT}, billed by audio length${seconds === null ? "" : `: ${seconds.toFixed(1)} s`}) — cached by input hash in ${cacheDir}`);
    const form = new FormData();
    form.append("audio", new Blob([audio], { type: "audio/wav" }), "voice.wav");
    form.append("file_format", "other");
    let response;
    try {
      response = await fetchImpl(`${options.baseUrl ?? "https://api.elevenlabs.io"}${ELEVENLABS_ISOLATION_ENDPOINT}`, { method: "POST", headers: { "xi-api-key": apiKey, Accept: "audio/mpeg" }, body: form, signal: options.signal });
    } catch (error) {
      throw new Error(`ElevenLabs voice isolation request failed: ${scrub(error?.message ?? error)}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ElevenLabs voice isolation failed (${response.status}): ${scrub(detail).slice(0, 300)}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) throw new Error("ElevenLabs voice isolation returned empty audio");
    await mkdir(cacheDir, { recursive: true });
    const temporary = `${cacheFile}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, body); await rename(temporary, cacheFile); } finally { await rm(temporary, { force: true }); }
  }
  await run("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", cacheFile, "-ac", "1", "-ar", String(options.sampleRate ?? 48000), "-c:a", "pcm_f32le", outputWav], { maxBuffer: 8 * 1024 * 1024 });
  return { provider: "elevenlabs", endpoint: ELEVENLABS_ISOLATION_ENDPOINT, status: cached ? "cached" : "applied", paid_call: !cached, cache_key: hash, cache_file: cacheFile, audio_seconds: seconds };
}
