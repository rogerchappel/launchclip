// ElevenLabs voice provider (opt-in). Requires ELEVENLABS_API_KEY.
//
// Uses POST /v1/text-to-speech/{voice_id}/with-timestamps, which returns the
// audio plus per-character start and end times. Characters are grouped back
// into the script's words, so word timings come from the provider's own
// alignment rather than ASR. Audio is requested as raw 24 kHz 16-bit PCM and
// wrapped in a mono WAV, so no transcoding is needed.

import { alignWordsToText, finalizeWords, normalizeWord, tokenizeText, writeWav } from "./words.js";

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
const SAMPLE_RATE = 24000;

export function create(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    name: "elevenlabs",
    async synthesize({ text, voice, speed, outFile, signal } = {}) {
      const apiKey = options.apiKey ?? env.ELEVENLABS_API_KEY;
      if (!apiKey) throw new Error("ElevenLabs voice is opt-in and needs ELEVENLABS_API_KEY. Nothing was sent. Set the key, or use the default Kokoro voice.");
      if (typeof text !== "string" || !text.trim()) throw new Error("ElevenLabs needs non-empty text");
      if (!outFile) throw new Error("ElevenLabs needs outFile");
      const voiceId = voice ?? options.voice ?? env.ELEVENLABS_VOICE_ID;
      if (!voiceId) throw new Error("ElevenLabs needs a voice id (pass voice or set ELEVENLABS_VOICE_ID)");
      if (typeof fetchImpl !== "function") throw new Error("No fetch implementation available");
      const voiceSettings = { ...(options.voiceSettings ?? {}) };
      const effectiveSpeed = speed ?? options.speed;
      // ElevenLabs accepts speed between 0.7 and 1.2.
      if (effectiveSpeed !== undefined) voiceSettings.speed = Math.max(0.7, Math.min(1.2, Number(effectiveSpeed)));
      const body = { text, model_id: options.model ?? DEFAULT_ELEVENLABS_MODEL };
      if (Object.keys(voiceSettings).length) body.voice_settings = voiceSettings;
      const url = `${options.baseUrl ?? ELEVENLABS_API}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=pcm_${SAMPLE_RATE}`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`ElevenLabs with-timestamps request failed (${response.status}): ${detail.slice(0, 300)}`);
      }
      const payload = await response.json();
      if (!payload?.audio_base64) throw new Error("ElevenLabs response has no audio_base64");
      const pcm = Buffer.from(payload.audio_base64, "base64");
      const samples = new Float32Array(Math.floor(pcm.length / 2));
      for (let index = 0; index < samples.length; index++) samples[index] = pcm.readInt16LE(index * 2) / 32768;
      const duration = samples.length / SAMPLE_RATE;
      if (!(duration > 0)) throw new Error("ElevenLabs returned empty audio");
      const alignment = payload.alignment ?? payload.normalized_alignment;
      if (!alignment) throw new Error("ElevenLabs response has no character alignment");
      const words = finalizeWords(wordsFromCharacterAlignment(alignment, text), duration);
      await writeWav(outFile, samples, SAMPLE_RATE);
      return { file: outFile, words, sampleRate: SAMPLE_RATE, duration, provider: "elevenlabs", voice: voiceId, speed: voiceSettings.speed ?? null, model: body.model_id, timing: { method: "provider-character-alignment" } };
    }
  };
}

/**
 * Group character alignment into words and label them with script tokens.
 * Alignment normally echoes the input text one-to-one; otherwise the words
 * are aligned back to the script tokens by edit distance.
 */
export function wordsFromCharacterAlignment(alignment, text) {
  const characters = alignment.characters ?? [];
  const starts = alignment.character_start_times_seconds ?? [];
  const ends = alignment.character_end_times_seconds ?? [];
  if (!characters.length || characters.length !== starts.length || characters.length !== ends.length) throw new Error("ElevenLabs alignment arrays are empty or mismatched");
  const spoken = [];
  let current = null;
  characters.forEach((character, index) => {
    if (/\s/.test(character)) { if (current) spoken.push(current); current = null; return; }
    if (!current) current = { text: "", start: Number(starts[index]), end: Number(ends[index]) };
    current.text += character;
    current.end = Math.max(current.end, Number(ends[index]));
  });
  if (current) spoken.push(current);
  // Drop punctuation-only groups by folding them into the previous word.
  const merged = [];
  for (const word of spoken) {
    if (!normalizeWord(word.text) && merged.length) { merged.at(-1).text += word.text; continue; }
    if (normalizeWord(word.text)) merged.push({ ...word });
  }
  const tokens = tokenizeText(text);
  if (tokens.length === merged.length && tokens.every((token, index) => normalizeWord(token) === normalizeWord(merged[index].text))) {
    return merged.map((word, index) => ({ ...word, text: tokens[index] }));
  }
  return alignWordsToText(merged, text);
}
