import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export class ElevenLabsMediaProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!this.apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
    this.baseUrl = String(options.baseUrl ?? "https://api.elevenlabs.io/v1").replace(/\/$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async synthesizeNarration(options) {
    const text = String(options.text ?? "").trim();
    if (!text) throw new Error("Narration text is required");
    const voiceId = String(options.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "").trim();
    if (!voiceId) throw new Error("ElevenLabs narration requires voiceId or ELEVENLABS_VOICE_ID");
    const outputPath = path.resolve(options.outputPath);
    const query = new URLSearchParams({ output_format: options.outputFormat ?? "mp3_44100_128" });
    const response = await this.request(`/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: options.modelId ?? "eleven_multilingual_v2",
        ...(options.languageCode ? { language_code: options.languageCode } : {}),
        ...(options.voiceSettings ? { voice_settings: options.voiceSettings } : {}),
        ...(options.previousText ? { previous_text: String(options.previousText) } : {}),
        ...(options.nextText ? { next_text: String(options.nextText) } : {}),
        ...(options.previousRequestIds?.length ? { previous_request_ids: options.previousRequestIds.map(String).slice(-3) } : {})
      })
    }, "json");
    if (!response.data.audio_base64) throw new Error("ElevenLabs narration response contained no audio");
    const audio = Buffer.from(response.data.audio_base64, "base64");
    const alignment = response.data.normalized_alignment ?? response.data.alignment;
    const words = alignmentToWords(alignment);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, audio);
    const wordsPath = options.wordsPath ? path.resolve(options.wordsPath) : `${outputPath}.words.json`;
    await writeFile(wordsPath, `${JSON.stringify(words, null, 2)}\n`);
    return {
      provider: "elevenlabs",
      kind: "narration",
      path: outputPath,
      words_path: wordsPath,
      words,
      duration_seconds: words.at(-1)?.end ?? 0,
      bytes: audio.length,
      request_id: response.requestId,
      model_id: options.modelId ?? "eleven_multilingual_v2",
      voice_id: voiceId
    };
  }

  async composeMusic(options) {
    const prompt = String(options.prompt ?? "").trim();
    if (!prompt) throw new Error("Music prompt is required");
    const durationSeconds = Number(options.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 600) throw new Error("Music duration must be between 3 and 600 seconds");
    const outputPath = path.resolve(options.outputPath);
    const outputFormat = options.outputFormat ?? "mp3_48000_192";
    const response = await this.request(`/music?output_format=${encodeURIComponent(outputFormat)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        music_length_ms: Math.round(durationSeconds * 1000),
        model_id: options.modelId ?? "music_v2",
        force_instrumental: options.forceInstrumental !== false
      })
    }, "arrayBuffer");
    const audio = Buffer.from(response.data);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, audio);
    return {
      provider: "elevenlabs",
      kind: "music",
      path: outputPath,
      bytes: audio.length,
      duration_seconds: durationSeconds,
      song_id: response.songId,
      request_id: response.requestId,
      model_id: options.modelId ?? "music_v2",
      prompt
    };
  }

  async transcribe(options) {
    const filePath = path.resolve(options.filePath);
    const file = await readFile(filePath);
    const form = new FormData();
    form.append("file", new Blob([file]), path.basename(filePath));
    form.append("model_id", options.modelId ?? "scribe_v2");
    form.append("timestamps_granularity", "word");
    if (options.languageCode) form.append("language_code", options.languageCode);
    const response = await this.request("/speech-to-text", { method: "POST", body: form }, "json");
    const words = (response.data.words ?? []).filter((entry) => entry.type === "word").map((entry) => ({
      word: String(entry.text).trim(),
      start: Number(entry.start),
      end: Number(entry.end),
      speaker_id: entry.speaker_id == null ? null : String(entry.speaker_id)
    }));
    return {
      provider: "elevenlabs",
      kind: "transcript",
      text: String(response.data.text ?? "").trim(),
      words,
      language_code: response.data.language_code ?? null,
      request_id: response.requestId,
      model_id: options.modelId ?? "scribe_v2"
    };
  }

  async request(endpoint, init, responseType) {
    const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: { "xi-api-key": this.apiKey, ...(init.headers ?? {}) }
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ElevenLabs API failed (${response.status}): ${sanitize(detail).slice(0, 800)}`);
    }
    const data = responseType === "arrayBuffer" ? await response.arrayBuffer() : await response.json();
    return {
      data,
      requestId: response.headers?.get?.("request-id") ?? response.headers?.get?.("x-request-id") ?? null,
      songId: response.headers?.get?.("song-id") ?? null
    };
  }
}

export class LocalSfxLibrary {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.entries = null;
  }

  async catalog() {
    if (this.entries) return this.entries;
    const files = (await readdir(this.directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(?:wav|mp3|m4a|aac|flac)$/i.test(entry.name))
      .map((entry) => ({
        id: path.basename(entry.name, path.extname(entry.name)),
        path: path.join(this.directory, entry.name),
        tokens: tokens(path.basename(entry.name, path.extname(entry.name)))
      }));
    if (!files.length) throw new Error(`No sound effects found in ${this.directory}`);
    this.entries = files;
    return files;
  }

  async resolve(cue) {
    const wanted = tokens(cue);
    const entries = await this.catalog();
    const ranked = entries.map((entry) => ({
      ...entry,
      score: [...wanted].reduce((score, token) => score + (entry.tokens.has(token) ? 2 : [...entry.tokens].some((candidate) => candidate.includes(token) || token.includes(candidate)) ? 1 : 0), 0)
    })).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    if (!ranked[0]?.score) throw new Error(`No local SFX matches cue: ${cue}`);
    return { id: ranked[0].id, path: ranked[0].path, cue: String(cue), score: ranked[0].score };
  }

  async resolvePlan(plan) {
    const output = [];
    for (const shot of plan.shots ?? []) {
      for (const cue of shot.sfx ?? []) {
        const match = await this.resolve(cue.cue);
        output.push({
          ...match,
          shot_id: shot.id,
          at_seconds: shot.start_seconds + cue.at_seconds,
          volume: cue.volume,
          intent: cue.intent
        });
      }
    }
    return output;
  }
}

export function alignmentToWords(alignment) {
  const characters = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  if (!characters.length || characters.length !== starts.length || characters.length !== ends.length) return [];
  const output = [];
  let current = null;
  for (let index = 0; index < characters.length; index += 1) {
    const character = String(characters[index]);
    if (/\s/.test(character)) {
      if (current) output.push(current);
      current = null;
      continue;
    }
    if (!current) current = { word: character, start: Number(starts[index]), end: Number(ends[index]) };
    else {
      current.word += character;
      current.end = Number(ends[index]);
    }
  }
  if (current) output.push(current);
  return output.filter((entry) => entry.word && Number.isFinite(entry.start) && Number.isFinite(entry.end));
}

function tokens(value) {
  const aliases = new Map([["click", "tick"], ["clicks", "tick"], ["impact", "boom"], ["hit", "boom"], ["swoosh", "whoosh"], ["transition", "whoosh"], ["success", "bell"]]);
  return new Set(String(value).toLowerCase().split(/[^a-z0-9]+/).filter((entry) => entry.length > 2).map((entry) => aliases.get(entry) ?? entry));
}

function sanitize(value) {
  return String(value ?? "").replace(/(?:xi-api-key[\s"':=]+|sk-)[a-z0-9_-]{12,}/gi, "[REDACTED]");
}
