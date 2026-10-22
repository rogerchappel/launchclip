// Shared word-timing helpers for voice providers.
//
// Every provider returns `words: [{ text, start, end }]` in seconds on the
// timeline of the audio file it wrote. These helpers keep that contract the
// same across Kokoro, ElevenLabs and supplied voiceovers: tokenise script text
// the same way, distribute time proportionally when only a span is known,
// snap word onsets to the waveform, and validate the result.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

/** Lower-case, strip surrounding punctuation, keep inner apostrophes and digits. */
export function normalizeWord(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/[^\p{L}\p{N}']+/gu, "");
}

/**
 * Split script text into display tokens. Punctuation stays attached to its
 * word ("first," stays one token), and a free-standing punctuation token such
 * as an em dash joins the preceding word so captions never show it alone.
 */
export function tokenizeText(text) {
  const tokens = [];
  for (const raw of String(text ?? "").normalize("NFKC").split(/\s+/)) {
    if (!raw) continue;
    if (PUNCTUATION_ONLY.test(raw) || !normalizeWord(raw)) {
      if (tokens.length) tokens[tokens.length - 1] += raw;
      continue;
    }
    tokens.push(raw);
  }
  return tokens;
}

/** Split text into sentences on terminal punctuation, keeping the punctuation. */
export function splitSentences(text) {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const parts = source.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) ?? [source];
  return parts.map((part) => part.trim()).filter((part) => normalizeWord(part) || /[\p{L}\p{N}]/u.test(part));
}

/**
 * Distribute [start, end] across tokens by weight (for example phoneme
 * counts). `gap` seconds is reserved between neighbouring words so word ends
 * do not touch the next onset.
 */
export function proportionalAlign(tokens, weights, start, end, { gap = 0 } = {}) {
  if (!Array.isArray(tokens) || !tokens.length) return [];
  if (!(end > start)) throw new Error("proportionalAlign needs end > start");
  const safe = tokens.map((_, index) => Math.max(1, Number(weights?.[index]) || 1));
  const total = safe.reduce((sum, value) => sum + value, 0);
  const span = end - start;
  const gapSize = Math.min(gap, span / tokens.length / 4);
  let cursor = start;
  return tokens.map((text, index) => {
    const length = span * safe[index] / total;
    const word = { text, start: cursor, end: cursor + length - (index < tokens.length - 1 ? gapSize : 0) };
    cursor += length;
    return word;
  });
}

/** RMS level in dB per frame (default 10 ms frames, 5 ms hop). */
export function rmsEnvelope(samples, sampleRate, { frameSeconds = 0.01, hopSeconds = 0.005 } = {}) {
  const frame = Math.max(1, Math.round(frameSeconds * sampleRate));
  const hop = Math.max(1, Math.round(hopSeconds * sampleRate));
  const count = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);
  const db = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    let energy = 0;
    const offset = index * hop;
    for (let sample = 0; sample < frame; sample++) energy += samples[offset + sample] ** 2;
    db[index] = energy > 0 ? Math.max(-120, 10 * Math.log10(energy / frame)) : -120;
  }
  // Each frame is reported at its centre.
  return { db, hopSeconds: hop / sampleRate, offsetSeconds: frame / 2 / sampleRate };
}

/** Noise floor and speech reference levels (20th and 90th percentiles). */
export function envelopeLevels(envelope) {
  const sorted = Array.from(envelope.db).sort((a, b) => a - b);
  if (!sorted.length) return { floor: -120, speech: -120 };
  const pick = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return { floor: pick(0.2), speech: pick(0.9) };
}

/**
 * Energy onsets: frames where the level rises at least `riseDb` above the
 * minimum of the preceding `lookbackSeconds`, while being audible
 * (`minAboveFloorDb` over the noise floor and within `belowSpeechDb` of the
 * speech reference). The onset time is the start of that rise.
 */
export function detectOnsets(samples, sampleRate, { riseDb = 9, lookbackSeconds = 0.04, minAboveFloorDb = 12, belowSpeechDb = 30, minSpacingSeconds = 0.06 } = {}) {
  const envelope = rmsEnvelope(samples, sampleRate);
  const { db, hopSeconds, offsetSeconds } = envelope;
  const { floor, speech } = envelopeLevels(envelope);
  const audible = Math.max(floor + minAboveFloorDb, speech - belowSpeechDb);
  const lookback = Math.max(1, Math.round(lookbackSeconds / hopSeconds));
  const onsets = [];
  let armed = true;
  for (let index = 1; index < db.length; index++) {
    let minimum = Infinity;
    let minimumIndex = index;
    for (let back = Math.max(0, index - lookback); back < index; back++) if (db[back] < minimum) { minimum = db[back]; minimumIndex = back; }
    const rising = db[index] - minimum >= riseDb && db[index] >= audible;
    if (rising && armed) {
      // Walk forward from the trough to the first frame of the rise.
      let start = minimumIndex;
      while (start < index && db[start + 1] - db[minimumIndex] < 3) start++;
      const time = offsetSeconds + start * hopSeconds;
      if (!onsets.length || time - onsets.at(-1) >= minSpacingSeconds) onsets.push(time);
      armed = false;
    }
    if (!rising) armed = true;
  }
  return onsets;
}

/**
 * Move each word start to the nearest energy onset within `windowSeconds`,
 * keeping words ordered and at least `minWordSeconds` long. Words with no
 * nearby onset (connected speech often has none) keep their time.
 */
export function snapOnsets(words, onsets, { windowSeconds = 0.06, minWordSeconds = 0.03 } = {}) {
  const sorted = [...onsets].sort((a, b) => a - b);
  const result = words.map((word) => ({ ...word }));
  let snapped = 0;
  for (let index = 0; index < result.length; index++) {
    const word = result[index];
    const nearest = nearestValue(sorted, word.start);
    if (nearest === null || Math.abs(nearest - word.start) > windowSeconds) continue;
    const previous = result[index - 1];
    const lower = previous ? previous.start + minWordSeconds : 0;
    const upper = word.end - minWordSeconds;
    if (nearest < lower || nearest > upper) continue;
    word.start = nearest;
    if (previous && previous.end > nearest) previous.end = nearest;
    snapped += 1;
  }
  return { words: result, snapped };
}

/**
 * Pull word boundaries off quiet audio. ASR often starts a word at the end of
 * the previous one, so a pause lands inside the next word, and sometimes the
 * boundary sits early, inside the previous word's audio. Two rules:
 *
 *   - a pause of at least `pauseSeconds` inside a word (after its first
 *     frame) is taken as the real boundary: the word starts after it and the
 *     previous word ends before it (stop closures inside a word are shorter);
 *   - quiet of at least `minQuietSeconds` at either edge of a word is trimmed.
 */
export function trimWordsToVoiced(words, envelope, thresholdDb, { minQuietSeconds = 0.05, pauseSeconds = 0.12, minWordSeconds = 0.05 } = {}) {
  const { db, hopSeconds, offsetSeconds } = envelope;
  const frameAt = (time) => Math.max(0, Math.min(db.length - 1, Math.round((time - offsetSeconds) / hopSeconds)));
  const timeAt = (frame) => offsetSeconds + frame * hopSeconds;
  const pauseFrames = Math.ceil(pauseSeconds / hopSeconds);
  let moved = 0;
  const result = [];
  for (const word of words) {
    let start = word.start;
    let end = word.end;
    let first = frameAt(start);
    const last = frameAt(end);
    const previous = result.at(-1);
    if (previous) {
      // Last long pause inside the word that is followed by voice.
      let runStart = -1;
      let boundary = null;
      for (let frame = first + 1; frame <= last; frame++) {
        if (db[frame] < thresholdDb) { if (runStart < 0) runStart = frame; continue; }
        if (runStart >= 0 && frame - runStart >= pauseFrames && db[first] >= thresholdDb) boundary = { quietStart: runStart, voiced: frame };
        runStart = -1;
      }
      if (boundary && timeAt(boundary.voiced) < end - minWordSeconds) {
        previous.end = Math.max(previous.start + minWordSeconds, timeAt(boundary.quietStart));
        start = timeAt(boundary.voiced) - hopSeconds;
        first = frameAt(start);
      }
    }
    let voicedFirst = first;
    while (voicedFirst < last && db[voicedFirst] < thresholdDb) voicedFirst++;
    let voicedLast = last;
    while (voicedLast > voicedFirst && db[voicedLast] < thresholdDb) voicedLast--;
    if (voicedFirst < last && timeAt(voicedFirst) - start >= minQuietSeconds) start = timeAt(voicedFirst) - hopSeconds;
    if (voicedLast > voicedFirst && end - timeAt(voicedLast) >= minQuietSeconds) end = timeAt(voicedLast) + hopSeconds;
    if (end - start < minWordSeconds) { result.push({ ...word }); continue; }
    if (start !== word.start || end !== word.end) moved += 1;
    result.push({ ...word, start, end });
  }
  return { words: result, moved };
}

/** Mean absolute distance from word starts to the nearest onset within `maxSeconds`. */
export function onsetError(words, onsets, { maxSeconds = 0.15 } = {}) {
  const sorted = [...onsets].sort((a, b) => a - b);
  const errors = [];
  for (const word of words) {
    const nearest = nearestValue(sorted, word.start);
    if (nearest !== null && Math.abs(nearest - word.start) <= maxSeconds) errors.push(Math.abs(nearest - word.start));
  }
  const mean = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
  const median = errors.length ? [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)] : null;
  return { mean_seconds: mean, median_seconds: median, matched: errors.length, total: words.length };
}

/**
 * Map ASR word timings onto script tokens with a monotonic edit-distance
 * alignment over normalised words. Script tokens the recogniser missed get
 * time interpolated between their matched neighbours.
 */
export function alignWordsToText(recognised, text) {
  const tokens = tokenizeText(text);
  const heard = recognised
    .map((word) => ({ text: String(word.text ?? word.word ?? "").trim(), start: Number(word.start), end: Number(word.end) }))
    .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
  if (!tokens.length) return heard;
  if (!heard.length) throw new Error("Cannot align script text: the transcript has no timed words");
  const a = tokens.map(normalizeWord);
  const b = heard.map((word) => normalizeWord(word.text));
  const rows = a.length + 1;
  const cols = b.length + 1;
  const cost = new Float64Array(rows * cols);
  const move = new Uint8Array(rows * cols); // 1 diagonal, 2 up (skip token), 3 left (skip heard)
  for (let i = 1; i < rows; i++) { cost[i * cols] = i; move[i * cols] = 2; }
  for (let j = 1; j < cols; j++) { cost[j] = j; move[j] = 3; }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const substitution = cost[(i - 1) * cols + j - 1] + wordDistance(a[i - 1], b[j - 1]);
      const up = cost[(i - 1) * cols + j] + 1;
      const left = cost[i * cols + j - 1] + 1;
      let best = substitution; let step = 1;
      if (up < best) { best = up; step = 2; }
      if (left < best) { best = left; step = 3; }
      cost[i * cols + j] = best; move[i * cols + j] = step;
    }
  }
  const matches = new Array(tokens.length).fill(null);
  for (let i = a.length, j = b.length; i > 0 || j > 0;) {
    const step = move[i * cols + j];
    if (step === 1) { matches[i - 1] = heard[j - 1]; i--; j--; }
    else if (step === 2) i--;
    else j--;
  }
  const words = tokens.map((token, index) => (matches[index] ? { text: token, start: matches[index].start, end: matches[index].end } : { text: token, start: null, end: null }));
  // Interpolate unmatched runs between matched anchors.
  for (let index = 0; index < words.length;) {
    if (words[index].start !== null) { index++; continue; }
    let stop = index;
    while (stop < words.length && words[stop].start === null) stop++;
    const before = index > 0 ? words[index - 1].end : Math.max(0, (words[stop]?.start ?? heard[0].start) - 0.3 * (stop - index));
    const after = stop < words.length ? words[stop].start : heard.at(-1).end + 0.3 * (stop - index);
    const span = Math.max(0.03 * (stop - index), after - before);
    const run = proportionalAlign(words.slice(index, stop).map((word) => word.text), words.slice(index, stop).map((word) => normalizeWord(word.text).length), before, before + span);
    for (let k = index; k < stop; k++) words[k] = run[k - index];
    index = stop;
  }
  return words;
}

/** Throws unless words are non-empty, ordered, positive-length and inside the audio. */
export function validateWords(words, duration, { tolerance = 1e-3 } = {}) {
  if (!Array.isArray(words)) throw new Error("words must be an array");
  if (!(duration > 0)) throw new Error("duration must be positive");
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  words.forEach((word, index) => {
    const label = `word ${index} (${JSON.stringify(word?.text)})`;
    if (typeof word?.text !== "string" || !word.text.trim()) throw new Error(`${label} has no text`);
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) throw new Error(`${label} has non-finite timing`);
    if (word.start < -tolerance || word.end > duration + tolerance) throw new Error(`${label} lies outside the audio (0-${duration.toFixed(3)} s)`);
    if (word.end <= word.start) throw new Error(`${label} ends before it starts`);
    if (word.start < previousStart - tolerance || word.start < previousEnd - tolerance) throw new Error(`${label} is not monotonic`);
    previousStart = word.start;
    previousEnd = word.end;
  });
  return words;
}

/** Clamp into the audio, enforce order, round to milliseconds. */
export function finalizeWords(words, duration) {
  const limit = Math.floor(duration * 1000) / 1000;
  const result = [];
  for (const word of words) {
    const previous = result.at(-1);
    let start = Math.min(Math.max(0, round3(word.start)), round3(limit - 0.001));
    if (previous) {
      start = Math.max(start, round3(previous.start + 0.001));
      if (previous.end > start) previous.end = start;
    }
    const end = Math.min(limit, Math.max(round3(word.end), round3(start + 0.001)));
    result.push({ text: word.text, start, end });
  }
  return validateWords(result, duration);
}

// ---------------------------------------------------------------------------
// WAV I/O (PCM 16/24/32-bit and float32, any channel count, mixed to mono).

export async function readWav(source) {
  const buffer = Buffer.isBuffer(source) ? source : await readFile(source);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a RIFF/WAVE file");
  let offset = 12;
  let format = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    let size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "data" && (size === 0xffffffff || body + size > buffer.length)) size = buffer.length - body;
    if (id === "fmt ") {
      let audioFormat = buffer.readUInt16LE(body);
      if (audioFormat === 0xfffe && size >= 26) audioFormat = buffer.readUInt16LE(body + 24);
      format = { audioFormat, channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!format) throw new Error("WAV data chunk precedes fmt chunk");
      const { audioFormat, channels, bits, sampleRate } = format;
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++) {
          const at = body + (frame * channels + channel) * bytes;
          if (audioFormat === 3 && bits === 32) sum += buffer.readFloatLE(at);
          else if (audioFormat === 1 && bits === 16) sum += buffer.readInt16LE(at) / 32768;
          else if (audioFormat === 1 && bits === 24) sum += buffer.readIntLE(at, 3) / 8388608;
          else if (audioFormat === 1 && bits === 32) sum += buffer.readInt32LE(at) / 2147483648;
          else throw new Error(`Unsupported WAV encoding (format ${audioFormat}, ${bits}-bit)`);
        }
        samples[frame] = sum / channels;
      }
      return { sampleRate, channels, samples, duration: frames / sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV file has no data chunk");
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index] || 0));
    data.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export async function writeWav(file, samples, sampleRate) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, encodeWav(samples, sampleRate));
  return file;
}

function nearestValue(sorted, value) {
  if (!sorted.length) return null;
  let low = 0; let high = sorted.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1; else high = middle;
  }
  const candidate = sorted[low];
  const before = low > 0 ? sorted[low - 1] : null;
  return before !== null && Math.abs(before - value) <= Math.abs(candidate - value) ? before : candidate;
}

function wordDistance(left, right) {
  if (left === right) return 0;
  if (!left || !right) return 1;
  // Partial credit for near spellings ("ok" / "okay", "35" / "thirty-five" does not match).
  const longest = Math.max(left.length, right.length);
  return Math.min(1, levenshtein(left, right) / longest) * 1.2;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const saved = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[right.length];
}

function round3(value) { return Math.round(value * 1000) / 1000; }
