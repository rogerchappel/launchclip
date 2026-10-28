// Kokoro-82M voice provider (Apache-2.0, offline, ONNX on CPU) via kokoro-js.
//
// Word timings need no ASR. The default model is the "timestamped" ONNX
// export of Kokoro-82M v1.0, which returns the duration the model predicted
// for every phoneme token next to the waveform. kokoro-js 1.2.1 discards that
// output, so this provider wraps the model call to keep it, then:
//
//   1. splits the phoneme string into words at spaces and punctuation, and
//      sums the durations of each word's phonemes (the punctuation tokens
//      carry the pauses). As in Kokoro's reference timestamps, the timeline
//      starts 3 frames (75 ms) before the end of the BOS token;
//   2. maps phoneme words to script tokens one-to-one, or with a monotonic
//      dynamic-programming merge when text normalisation changed the word
//      count ("35" -> "thirty five");
//   3. snaps each onset to the nearest RMS energy onset within 50 ms.
//
// If the model returns no durations (for example a non-timestamped export),
// the provider falls back to splitting each synthesised sentence's voiced span
// across its words in proportion to their phoneme counts, then snaps onsets
// within 80 ms. Both paths and their measured accuracy are documented in
// skills/launchclip-cli/references/cli-reference.md ("Voice providers").

import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withSlot } from "../queue.js";
import {
  detectOnsets, finalizeWords, normalizeWord, onsetError, proportionalAlign,
  rmsEnvelope, envelopeLevels, snapOnsets, tokenizeText, writeWav
} from "./words.js";
import { pinnedCache } from "../state_dirs.js";

export const KOKORO_JS_VERSION = "1.2.1";
export const DEFAULT_KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
export const DEFAULT_KOKORO_VOICE = "af_heart";
export const DEFAULT_KOKORO_SPEED = 1.2;
export const KOKORO_SAMPLE_RATE = 24000;

const MODEL_FILES = { fp32: "model.onnx", fp16: "model_fp16.onnx", q8: "model_quantized.onnx", q4: "model_q4.onnx", q4f16: "model_q4f16.onnx", uint8: "model_uint8.onnx" };
const PAUSE_CHARACTERS = new Set(Array.from(';:,.!?¡¿—…"«»“”(){}[]'));
// Kokoro's own timestamp code (kokoro/pipeline.py) starts at max(0, BOS - 3) frames.
const LEAD_TRIM_FRAMES = 3;
const engines = new Map();
let announcedDownload = false;

/** Model cache directory: $LAUNCHCLIP_CACHE/kokoro, else ~/.cache/launchclip/kokoro. */
export function kokoroCacheDir(env = process.env) {
  return pinnedCache("kokoro") ?? (env.LAUNCHCLIP_CACHE ? path.join(env.LAUNCHCLIP_CACHE, "kokoro") : path.join(os.homedir(), ".cache", "launchclip", "kokoro"));
}

export async function isKokoroModelCached({ model = DEFAULT_KOKORO_MODEL, dtype = "fp32", cacheDir = kokoroCacheDir() } = {}) {
  try {
    await access(path.join(cacheDir, model, "onnx", MODEL_FILES[dtype] ?? "model.onnx"));
    return true;
  } catch { return false; }
}

export function create(options = {}) {
  const model = options.model ?? DEFAULT_KOKORO_MODEL;
  const dtype = options.dtype ?? "fp32";
  const cacheDir = options.cacheDir ?? kokoroCacheDir();
  const log = options.log ?? ((message) => process.stderr.write(`${message}\n`));
  let engine = options.engine ?? null;

  async function getEngine() {
    if (engine) return engine;
    const key = `${model}|${dtype}|${cacheDir}`;
    if (!engines.has(key)) engines.set(key, loadKokoroEngine({ model, dtype, cacheDir, log }).catch((error) => { engines.delete(key); throw error; }));
    engine = await engines.get(key);
    return engine;
  }

  const provider = {
    name: "kokoro",
    async synthesize({ text, voice = options.voice ?? DEFAULT_KOKORO_VOICE, speed = options.speed ?? DEFAULT_KOKORO_SPEED, outFile, signal } = {}) {
      if (typeof text !== "string" || !text.trim()) throw new Error("Kokoro needs non-empty text");
      if (!outFile) throw new Error("Kokoro needs outFile");
      if (!(speed > 0)) throw new Error("Kokoro speed must be positive");
      throwIfAborted(signal);
      const tts = await getEngine();
      const sampleRate = tts.sampleRate ?? KOKORO_SAMPLE_RATE;
      const started = Date.now();
      const chunks = [];
      const words = [];
      let cursor = 0;
      let method = "phoneme-durations";
      for await (const chunk of tts.stream(text, { voice, speed })) {
        throwIfAborted(signal);
        const tokens = tokenizeText(chunk.text);
        const chunkSeconds = chunk.samples.length / sampleRate;
        let local = null;
        if (tokens.length && Array.isArray(chunk.durations) && chunk.durations.length === Array.from(chunk.phonemes).length) {
          local = await wordsFromPhonemeDurations(tokens, chunk.phonemes, chunk.durations, chunk.lead ?? 0, { phonemize: tts.phonemize });
        }
        if (tokens.length && !local) {
          method = "proportional-phonemes";
          local = await proportionalChunkWords(tokens, chunk, sampleRate, tts.phonemize);
        }
        for (const word of local ?? []) words.push({ text: word.text, start: cursor + word.start, end: cursor + word.end });
        chunks.push(chunk.samples);
        cursor += chunkSeconds;
      }
      throwIfAborted(signal);
      const samples = concatenate(chunks);
      const duration = samples.length / sampleRate;
      if (!(duration > 0)) throw new Error("Kokoro produced no audio");
      const onsets = detectOnsets(samples, sampleRate);
      const before = onsetError(words, onsets);
      const windowSeconds = options.snapWindowSeconds ?? (method === "phoneme-durations" ? 0.05 : 0.08);
      const { words: snapped, snapped: snappedCount } = snapOnsets(words, onsets, { windowSeconds });
      const finalWords = finalizeWords(snapped, duration);
      const after = onsetError(finalWords, onsets);
      await writeWav(outFile, samples, sampleRate);
      const elapsed = (Date.now() - started) / 1000;
      return {
        file: outFile, words: finalWords, sampleRate, duration,
        provider: "kokoro", voice, speed, model,
        timing: {
          method, snapped_words: snappedCount, onsets_detected: onsets.length,
          onset_error_before_snap_ms: toMs(before.mean_seconds), onset_error_ms: toMs(after.mean_seconds), onset_matched: after.matched
        },
        synthesis_seconds: elapsed, real_time_factor: elapsed / duration
      };
    }
  };
  // Loading and running the model takes a local-model slot of the machine queue.
  const synthesize = provider.synthesize.bind(provider);
  return { ...provider, synthesize: (request) => withSlot("local-model", { label: "kokoro voice", log }, () => synthesize(request)) };
}

/**
 * Word spans from per-phoneme durations. `durations[i]` is the seconds the
 * model spent on `phonemes[i]` (code point index); `lead` is the silence
 * before the first phoneme. Returns null if the mapping is unusable.
 */
export async function wordsFromPhonemeDurations(tokens, phonemes, durations, lead = 0, { phonemize } = {}) {
  const groups = phonemeGroups(phonemes, durations, lead);
  if (!groups.length) return null;
  const expected = await expectedLengths(tokens, phonemize);
  let assignment;
  if (groups.length === tokens.length) assignment = groups.map((_, index) => [index, index]);
  else if (groups.length > tokens.length) assignment = mergeGroups(groups.map((group) => group.length), expected);
  else return proportionalAlign(tokens, expected, groups[0].start, groups.at(-1).end, { gap: 0.02 });
  return tokens.map((text, index) => {
    const [first, last] = assignment[index];
    return { text, start: groups[first].start, end: groups[last].end };
  });
}

/** Split phonemes into words at spaces and pause punctuation, with time spans. */
export function phonemeGroups(phonemes, durations, lead = 0) {
  const characters = Array.from(phonemes);
  const groups = [];
  let time = lead;
  let current = null;
  characters.forEach((character, index) => {
    const length = Number(durations[index]) || 0;
    if (character === " " || PAUSE_CHARACTERS.has(character) || /\s/.test(character)) {
      if (current) { groups.push(current); current = null; }
    } else {
      if (!current) current = { start: time, end: time, length: 0 };
      current.end = time + length;
      current.length += 1;
    }
    time += length;
  });
  if (current) groups.push(current);
  return groups.filter((group) => group.end > group.start);
}

/**
 * Assign consecutive phoneme groups to tokens (each token takes at least one
 * group) minimising squared log-ratio between group and expected lengths.
 */
export function mergeGroups(groupLengths, expected) {
  const G = groupLengths.length;
  const T = expected.length;
  const prefix = [0];
  for (const length of groupLengths) prefix.push(prefix.at(-1) + length);
  const cost = Array.from({ length: T + 1 }, () => new Float64Array(G + 1).fill(Infinity));
  const back = Array.from({ length: T + 1 }, () => new Int32Array(G + 1));
  cost[0][0] = 0;
  for (let t = 1; t <= T; t++) {
    for (let g = t; g <= G - (T - t); g++) {
      for (let k = t - 1; k < g; k++) {
        if (!Number.isFinite(cost[t - 1][k])) continue;
        const ratio = Math.log((prefix[g] - prefix[k] + 1) / (expected[t - 1] + 1));
        const value = cost[t - 1][k] + ratio * ratio;
        if (value < cost[t][g]) { cost[t][g] = value; back[t][g] = k; }
      }
    }
  }
  const assignment = new Array(T);
  for (let t = T, g = G; t > 0; t--) {
    const k = back[t][g];
    assignment[t - 1] = [k, g - 1];
    g = k;
  }
  return assignment;
}

async function expectedLengths(tokens, phonemize) {
  return Promise.all(tokens.map(async (token) => {
    if (phonemize) {
      try {
        const phonemes = await phonemize(token);
        const count = Array.from(String(phonemes)).filter((character) => character !== " " && !PAUSE_CHARACTERS.has(character)).length;
        if (count) return count;
      } catch { /* fall through to letters */ }
    }
    return Math.max(1, normalizeWord(token).length);
  }));
}

async function proportionalChunkWords(tokens, chunk, sampleRate, phonemize) {
  // Voiced span: first to last frame within 35 dB of the chunk's speech level.
  const envelope = rmsEnvelope(chunk.samples, sampleRate);
  const { floor, speech } = envelopeLevels(envelope);
  const threshold = Math.max(floor + 6, speech - 35);
  let first = 0; let last = envelope.db.length - 1;
  while (first < last && envelope.db[first] < threshold) first++;
  while (last > first && envelope.db[last] < threshold) last--;
  const start = envelope.offsetSeconds + first * envelope.hopSeconds;
  const end = Math.max(start + 0.05 * tokens.length, envelope.offsetSeconds + last * envelope.hopSeconds);
  const groups = chunk.phonemes ? phonemeGroups(chunk.phonemes, Array.from(chunk.phonemes).map(() => 1)) : [];
  const weights = groups.length === tokens.length ? groups.map((group) => group.length) : await expectedLengths(tokens, phonemize);
  return proportionalAlign(tokens, weights, start, Math.min(end, chunk.samples.length / sampleRate), { gap: 0.02 });
}

/**
 * Real engine: kokoro-js with the model's phoneme durations retained.
 * kokoro-js is an optionalDependency; installs without it get a clear error.
 */
export async function loadKokoroEngine({ model = DEFAULT_KOKORO_MODEL, dtype = "fp32", cacheDir = kokoroCacheDir(), log = () => {} } = {}) {
  let kokoro; let transformers;
  try {
    kokoro = await import("kokoro-js");
    transformers = await import("@huggingface/transformers");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find (module|package)/.test(String(error?.message))) {
      throw new Error(`Kokoro voice needs the optional dependency kokoro-js@${KOKORO_JS_VERSION}. Install it with: npm install kokoro-js@${KOKORO_JS_VERSION}`);
    }
    throw error;
  }
  transformers.env.cacheDir = cacheDir;
  transformers.env.allowLocalModels = false;
  if (!(await isKokoroModelCached({ model, dtype, cacheDir })) && !announcedDownload) {
    announcedDownload = true;
    log(`Downloading Kokoro-82M (${model}, ${dtype}) to ${cacheDir}. This happens once.`);
  }
  const tts = await kokoro.KokoroTTS.from_pretrained(model, { dtype, device: "cpu" });
  const original = tts.model;
  let last = null;
  // generate_from_ids only calls this.model(inputs); keep the full output.
  tts.model = async (inputs) => { last = await original(inputs); return last; };
  const vocabulary = tts.tokenizer.model?.tokens_to_ids;
  let phonemizer = null;
  const phonemize = async (text) => {
    phonemizer ??= await import("phonemizer");
    return (await phonemizer.phonemize(text, "en-us")).join(" ");
  };
  return {
    sampleRate: KOKORO_SAMPLE_RATE,
    phonemize,
    async *stream(text, { voice, speed }) {
      // kokoro-js 1.2.1 never closes the splitter it makes for a string input,
      // so its stream waits forever after the last sentence; close our own.
      const splitter = new kokoro.TextSplitterStream();
      splitter.push(text);
      splitter.close();
      for await (const chunk of tts.stream(splitter, { voice, speed })) {
        const samples = chunk.audio.audio;
        const sampleRate = chunk.audio.sampling_rate;
        if (sampleRate !== KOKORO_SAMPLE_RATE) throw new Error(`Unexpected Kokoro sample rate ${sampleRate}`);
        yield { text: chunk.text, phonemes: chunk.phonemes, samples, ...perPhonemeDurations(chunk.phonemes, last?.durations, vocabulary, samples.length / sampleRate) };
        last = null;
      }
    }
  };
}

/**
 * Convert the model's per-token durations (BOS, one token per in-vocabulary
 * phoneme, EOS) into seconds per phoneme code point. The frame length is
 * calibrated per chunk so the durations sum to the waveform length.
 */
export function perPhonemeDurations(phonemes, durationTensor, vocabulary, seconds) {
  if (!durationTensor || !vocabulary) return { durations: null, lead: 0 };
  const raw = Array.from(durationTensor.data ?? durationTensor, Number);
  const characters = Array.from(phonemes);
  const known = characters.map((character) => vocabulary.has(character));
  const tokenCount = known.filter(Boolean).length;
  if (raw.length !== tokenCount + 2) return { durations: null, lead: 0 };
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return { durations: null, lead: 0 };
  const unit = seconds / total;
  let cursor = 1;
  const durations = known.map((isKnown) => (isKnown ? raw[cursor++] * unit : 0));
  return { durations, lead: Math.max(0, raw[0] - LEAD_TRIM_FRAMES) * unit, frame_seconds: unit };
}

function concatenate(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("Voice synthesis aborted"), { name: "AbortError" });
}

function toMs(seconds) { return seconds === null ? null : Math.round(seconds * 10000) / 10; }

