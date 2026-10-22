import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  alignWordsToText, detectOnsets, encodeWav, finalizeWords, normalizeWord, onsetError,
  proportionalAlign, readWav, snapOnsets, splitSentences, tokenizeText, validateWords, writeWav
} from "../src/voice/words.js";
import * as kokoro from "../src/voice/kokoro.js";
import * as elevenlabs from "../src/voice/elevenlabs.js";
import * as supplied from "../src/voice/supplied.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

/** Silence with tone bursts at [start, end] seconds. */
function bursts(sampleRate, duration, spans, { amplitude = 0.3, frequency = 220 } = {}) {
  const samples = new Float32Array(Math.round(duration * sampleRate));
  const ramp = Math.round(0.004 * sampleRate);
  for (const [start, end] of spans) {
    const a = Math.round(start * sampleRate);
    const b = Math.round(end * sampleRate);
    for (let index = a; index < b && index < samples.length; index++) {
      const edge = Math.min(1, (index - a) / ramp, (b - index) / ramp);
      samples[index] = amplitude * edge * Math.sin(2 * Math.PI * frequency * index / sampleRate);
    }
  }
  return samples;
}

async function tempDir(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-voice-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// ---------------------------------------------------------------- words.js

test("tokenizeText keeps punctuation on words and folds stray dashes", () => {
  assert.deepEqual(tokenizeText("Hot coffee — cools, fast.  Why?"), ["Hot", "coffee—", "cools,", "fast.", "Why?"]);
  assert.equal(normalizeWord("“That’s,”"), "that's");
  assert.equal(normalizeWord("35."), "35");
  assert.deepEqual(splitSentences("One two. Three? Four"), ["One two.", "Three?", "Four"]);
});

test("proportionalAlign spreads a span by weight", () => {
  const words = proportionalAlign(["a", "bbb"], [1, 3], 1, 3);
  assert.equal(words[0].start, 1);
  assert.equal(words[0].end, 1.5);
  assert.equal(words[1].start, 1.5);
  assert.equal(words[1].end, 3);
});

test("detectOnsets finds burst onsets and snapOnsets moves nearby word starts", () => {
  const sampleRate = 24000;
  const samples = bursts(sampleRate, 2, [[0.3, 0.6], [0.8, 1.1], [1.5, 1.8]]);
  const onsets = detectOnsets(samples, sampleRate);
  assert.equal(onsets.length, 3);
  for (const [index, expected] of [0.3, 0.8, 1.5].entries()) assert.ok(Math.abs(onsets[index] - expected) < 0.015, `onset ${onsets[index]} vs ${expected}`);
  const words = [{ text: "a", start: 0.34, end: 0.6 }, { text: "b", start: 0.95, end: 1.1 }, { text: "c", start: 1.47, end: 1.8 }];
  const { words: snapped, snapped: count } = snapOnsets(words, onsets, { windowSeconds: 0.06 });
  assert.equal(count, 2);
  assert.ok(Math.abs(snapped[0].start - onsets[0]) < 1e-9);
  assert.equal(snapped[1].start, 0.95, "no onset within the window leaves the word alone");
  assert.ok(Math.abs(snapped[2].start - onsets[2]) < 1e-9);
  const error = onsetError(snapped, onsets);
  assert.equal(error.matched, 2);
});

test("validateWords rejects unordered, empty and out-of-range words", () => {
  assert.throws(() => validateWords([{ text: "a", start: 0.5, end: 0.6 }, { text: "b", start: 0.4, end: 0.7 }], 1), /monotonic/);
  assert.throws(() => validateWords([{ text: "a", start: 0.5, end: 1.6 }], 1), /outside/);
  assert.throws(() => validateWords([{ text: " ", start: 0.1, end: 0.2 }], 1), /no text/);
  assert.throws(() => validateWords([{ text: "a", start: 0.2, end: 0.2 }], 1), /ends before/);
  const fixed = finalizeWords([{ text: "a", start: -0.1, end: 0.5 }, { text: "b", start: 0.4, end: 1.3 }], 1);
  assert.deepEqual(fixed, [{ text: "a", start: 0, end: 0.4 }, { text: "b", start: 0.4, end: 1 }]);
});

test("alignWordsToText maps ASR words onto script tokens and fills gaps", () => {
  const heard = [
    { word: " the", start: 0.0, end: 0.2 },
    { word: " gap", start: 0.25, end: 0.5 },
    { word: " is", start: 0.55, end: 0.7 },
    { word: " 70", start: 0.75, end: 1.2 },
    { word: " uh", start: 1.25, end: 1.4 },
    { word: " degrees.", start: 1.5, end: 2.0 }
  ];
  const words = alignWordsToText(heard, "That gap is seventy degrees.");
  assert.deepEqual(words.map((word) => word.text), ["That", "gap", "is", "seventy", "degrees."]);
  assert.equal(words[1].start, 0.25);
  assert.equal(words[4].start, 1.5);
  assert.ok(words[3].start >= words[2].end - 1e-9 && words[3].end <= words[4].start + 1e-9);
  validateWords(words, 2);
});

test("WAV encode and decode round-trip as 16-bit mono", async (t) => {
  const directory = await tempDir(t);
  const samples = bursts(24000, 0.5, [[0.1, 0.4]]);
  const file = await writeWav(path.join(directory, "a.wav"), samples, 24000);
  const decoded = await readWav(file);
  assert.equal(decoded.sampleRate, 24000);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.samples.length, samples.length);
  assert.ok(Math.abs(decoded.samples[3600] - samples[3600]) < 1e-4);
  assert.equal(encodeWav(samples, 24000).length, 44 + samples.length * 2);
});

// ---------------------------------------------------------------- Kokoro

/**
 * Fake engine: each sentence is a burst per word. Phonemes are "x" repeated
 * per letter, words separated by spaces, with a per-phoneme duration that
 * matches the bursts exactly, like the timestamped model's output.
 */
function fakeKokoroEngine({ withDurations = true, phonemeOverride = null } = {}) {
  const sampleRate = 24000;
  const calls = [];
  return {
    calls,
    sampleRate,
    phonemize: async (word) => "x".repeat(normalizeWord(word).length || 1),
    async *stream(text, options) {
      calls.push({ text, ...options });
      for (const sentence of splitSentences(text)) {
        const tokens = tokenizeText(sentence);
        const lead = 0.1;
        const perPhoneme = 0.05 / options.speed;
        const spans = [];
        let cursor = lead;
        let phonemes = "";
        const durations = [];
        tokens.forEach((token, index) => {
          const length = normalizeWord(token).length;
          spans.push([cursor, cursor + length * perPhoneme]);
          phonemes += "x".repeat(length);
          for (let k = 0; k < length; k++) durations.push(perPhoneme);
          cursor += length * perPhoneme;
          if (index < tokens.length - 1) { phonemes += " "; durations.push(0.06); cursor += 0.06; }
        });
        phonemes += "."; durations.push(0.15); cursor += 0.15;
        const samples = bursts(sampleRate, cursor, spans);
        yield { text: sentence, phonemes: phonemeOverride?.(sentence) ?? phonemes, samples, durations: withDurations ? durations : null, lead, spans };
      }
    }
  };
}

test("Kokoro provider derives word timings from phoneme durations", async (t) => {
  const directory = await tempDir(t);
  const engine = fakeKokoroEngine();
  const provider = kokoro.create({ engine });
  assert.equal(provider.name, "kokoro");
  const outFile = path.join(directory, "voice.wav");
  const result = await provider.synthesize({ text: "Hot coffee cools fast. Why does it crawl?", outFile });
  assert.deepEqual(engine.calls[0], { text: "Hot coffee cools fast. Why does it crawl?", voice: "af_heart", speed: 1.2 });
  assert.equal(result.file, outFile);
  assert.equal(result.sampleRate, 24000);
  assert.deepEqual(result.words.map((word) => word.text), ["Hot", "coffee", "cools", "fast.", "Why", "does", "it", "crawl?"]);
  validateWords(result.words, result.duration);
  assert.equal(result.timing.method, "phoneme-durations");
  // First word starts at the 0.1 s lead; the second sentence starts after the first chunk.
  assert.ok(Math.abs(result.words[0].start - 0.1) < 0.012, `start ${result.words[0].start}`);
  assert.ok(result.timing.onset_error_ms < 15, `onset error ${result.timing.onset_error_ms}`);
  const wav = await readWav(outFile);
  assert.equal(wav.sampleRate, 24000);
  assert.equal(wav.channels, 1);
  assert.ok(Math.abs(wav.duration - result.duration) < 1e-3);
});

test("Kokoro provider merges extra phoneme words when normalisation expands a token", async () => {
  const words = await kokoro.wordsFromPhonemeDurations(
    ["It", "is", "35", "degrees."],
    "ɪt ɪz θɜːɾi faɪv dɪɡɹiːz.",
    Array.from("ɪt ɪz θɜːɾi faɪv dɪɡɹiːz.").map(() => 0.05),
    0.1,
    { phonemize: async (token) => ({ It: "ɪt", is: "ɪz", 35: "θɜːɾi faɪv", "degrees.": "dɪɡɹiːz" })[token] }
  );
  assert.deepEqual(words.map((word) => word.text), ["It", "is", "35", "degrees."]);
  // "35" covers "θɜːɾi faɪv": from the start of θ to the end of v.
  assert.ok(Math.abs(words[2].start - (0.1 + 6 * 0.05)) < 1e-9);
  assert.ok(Math.abs(words[2].end - (0.1 + 16 * 0.05)) < 1e-9);
});

test("Kokoro provider falls back to proportional phoneme alignment without durations", async (t) => {
  const directory = await tempDir(t);
  const provider = kokoro.create({ engine: fakeKokoroEngine({ withDurations: false }) });
  const result = await provider.synthesize({ text: "Big gap, fast cooling. Small gap, slow cooling.", outFile: path.join(directory, "v.wav"), speed: 1 });
  assert.equal(result.timing.method, "proportional-phonemes");
  assert.equal(result.words.length, 8);
  validateWords(result.words, result.duration);
  assert.ok(result.timing.onset_error_ms < 40);
});

test("Kokoro provider honours voice, speed and abort signals", async (t) => {
  const directory = await tempDir(t);
  const engine = fakeKokoroEngine();
  const provider = kokoro.create({ engine, voice: "am_michael" });
  await provider.synthesize({ text: "Hello there.", speed: 1, outFile: path.join(directory, "a.wav") });
  assert.equal(engine.calls[0].voice, "am_michael");
  assert.equal(engine.calls[0].speed, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.synthesize({ text: "Hello.", outFile: path.join(directory, "b.wav"), signal: controller.signal }), /abort/i);
  await assert.rejects(provider.synthesize({ text: " ", outFile: path.join(directory, "c.wav") }), /non-empty/);
});

test("perPhonemeDurations calibrates token durations to the waveform", () => {
  const vocabulary = new Map([["h", 1], ["i", 2], [" ", 3]]);
  // BOS, h, i, (unknown ʔ gets 0), EOS; 15 frames over 0.3 s is 20 ms a frame.
  const result = kokoro.perPhonemeDurations("hiʔ", { data: [5, 4, 4, 2] }, vocabulary, 0.3);
  assert.deepEqual(result.durations.map((value) => Math.round(value * 1000)), [80, 80, 0]);
  // Like Kokoro's own timestamps, the first phoneme starts 3 frames before the end of BOS.
  assert.ok(Math.abs(result.lead - 0.04) < 1e-9);
  assert.equal(kokoro.perPhonemeDurations("hi", { data: [1, 1] }, vocabulary, 0.3).durations, null);
});

test("Kokoro cache dir respects LAUNCHCLIP_CACHE", () => {
  assert.equal(kokoro.kokoroCacheDir({ LAUNCHCLIP_CACHE: "/tmp/lc" }), path.join("/tmp/lc", "kokoro"));
  assert.equal(kokoro.kokoroCacheDir({}), path.join(os.homedir(), ".cache", "launchclip", "kokoro"));
});

const kokoroReady = await (async () => {
  if (process.env.LAUNCHCLIP_SKIP_KOKORO) return false;
  try { await import("kokoro-js"); } catch { return false; }
  return kokoro.isKokoroModelCached();
})();

test("real Kokoro synthesis produces aligned words", { skip: kokoroReady ? false : "kokoro-js or the Kokoro model is not cached", timeout: 180_000 }, async (t) => {
  const directory = await tempDir(t);
  const provider = kokoro.create({ log: () => {} });
  const result = await provider.synthesize({ text: "Hot coffee cools fast at first, then it crawls.", outFile: path.join(directory, "k.wav") });
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.timing.method, "phoneme-durations");
  assert.equal(result.words.length, 9);
  assert.ok(result.duration > 1.5 && result.duration < 6, `duration ${result.duration}`);
  validateWords(result.words, result.duration);
  assert.ok(result.timing.onset_error_ms === null || result.timing.onset_error_ms < 40, `onset error ${result.timing.onset_error_ms}`);
});

// ---------------------------------------------------------------- ElevenLabs

function alignmentFor(text, secondsPerCharacter = 0.05) {
  const characters = Array.from(text);
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * secondsPerCharacter),
    character_end_times_seconds: characters.map((_, index) => (index + 1) * secondsPerCharacter)
  };
}

test("ElevenLabs refuses to send anything without an API key", async (t) => {
  const directory = await tempDir(t);
  let called = false;
  const provider = elevenlabs.create({ env: {}, fetch: async () => { called = true; } });
  await assert.rejects(provider.synthesize({ text: "Hello", voice: "v", outFile: path.join(directory, "e.wav") }), /ELEVENLABS_API_KEY/);
  assert.equal(called, false);
});

test("ElevenLabs uses with-timestamps and turns character alignment into words", async (t) => {
  const directory = await tempDir(t);
  const text = "Hot coffee, cools fast.";
  const pcm = Buffer.alloc(24000 * 2 * 2); // 2 s of silence
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ audio_base64: pcm.toString("base64"), alignment: alignmentFor(text) }) };
  };
  const provider = elevenlabs.create({ env: { ELEVENLABS_API_KEY: "test-key", ELEVENLABS_VOICE_ID: "voice123" }, fetch });
  const outFile = path.join(directory, "e.wav");
  const result = await provider.synthesize({ text, speed: 1.5, outFile });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v1\/text-to-speech\/voice123\/with-timestamps\?output_format=pcm_24000$/);
  assert.equal(requests[0].init.headers["xi-api-key"], "test-key");
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.text, text);
  assert.equal(body.voice_settings.speed, 1.2, "speed is clamped to the provider range");
  assert.deepEqual(result.words.map((word) => word.text), ["Hot", "coffee,", "cools", "fast."]);
  assert.deepEqual(result.words[1], { text: "coffee,", start: 0.2, end: 0.55 });
  assert.equal(result.duration, 2);
  assert.equal((await readWav(outFile)).sampleRate, 24000);
});

test("ElevenLabs surfaces HTTP errors", async (t) => {
  const directory = await tempDir(t);
  const provider = elevenlabs.create({ apiKey: "k", fetch: async () => ({ ok: false, status: 401, text: async () => "invalid key" }) });
  await assert.rejects(provider.synthesize({ text: "Hi", voice: "v", outFile: path.join(directory, "e.wav") }), /401.*invalid key/);
});

// ---------------------------------------------------------------- Supplied

/** Fake ASR: one recognised word per energy burst in the prepared file. */
function burstTranscriber(labels) {
  return async (file) => {
    const { samples, sampleRate } = await readWav(file);
    const onsets = detectOnsets(samples, sampleRate);
    return { segments: [{ words: onsets.map((start, index) => ({ word: ` ${labels[index] ?? "x"}`, start: start + 0.02, end: start + 0.4 })) }] };
  };
}

test("supplied voiceover trims edges, tightens long pauses, normalises loudness and aligns words", { skip: hasFfmpeg ? false : "ffmpeg is not installed" }, async (t) => {
  const directory = await tempDir(t);
  const sampleRate = 48000;
  // 0.8 s lead, word, 1.5 s pause (tightened), word, 0.3 s pause (kept), word, 1.0 s tail.
  const spans = [[0.8, 1.3], [2.8, 3.3], [3.6, 4.1]];
  const source = await writeWav(path.join(directory, "take.wav"), bursts(sampleRate, 5.1, spans, { amplitude: 0.05 }), sampleRate);
  const provider = supplied.create({ source, transcribe: burstTranscriber(["hello", "big", "world"]) });
  const outFile = path.join(directory, "voice.wav");
  const result = await provider.synthesize({ text: "Hello, big world.", outFile });
  assert.equal(result.provider, "supplied");
  assert.equal(result.sampleRate, 48000);
  // 0.05 air + 0.5 + 0.35 + 0.5 + 0.3 + 0.5 + 0.05 air
  assert.ok(Math.abs(result.duration - 2.25) < 0.06, `duration ${result.duration}`);
  assert.equal(result.prep.pauses_tightened, 1);
  assert.ok(Math.abs(result.prep.leading_trim_seconds - 0.75) < 0.03);
  assert.ok(Math.abs(result.prep.loudness_measured_lufs - supplied.TARGET_LUFS) < 1.5, `loudness ${result.prep.loudness_measured_lufs}`);
  assert.deepEqual(result.words.map((word) => word.text), ["Hello,", "big", "world."]);
  validateWords(result.words, result.duration);
  // Onsets are snapped back from the ASR's +20 ms to the energy onset.
  assert.ok(Math.abs(result.words[0].start - 0.05) < 0.02, `first onset ${result.words[0].start}`);
  assert.ok(result.timing.onset_error_ms < 5);
  assert.ok((await stat(outFile)).size > 44);
  await assert.rejects(supplied.create({ source }).synthesize({ outFile: source }), /overwrite/);
});

test("planPauseEdit only shortens pauses longer than 0.6 s", () => {
  const sampleRate = 16000;
  const samples = bursts(sampleRate, 4, [[0.5, 1], [1.5, 2], [3, 3.5]]);
  const plan = supplied.planPauseEdit(samples, sampleRate, { threshold_db: -40, silence_intervals: [{ start_seconds: 1, end_seconds: 1.5 }, { start_seconds: 2, end_seconds: 3 }] });
  assert.equal(plan.tightened, 1);
  assert.equal(plan.keep.length, 2);
  assert.ok(Math.abs(plan.keep[0].end - 2.175) < 1e-9);
  assert.ok(Math.abs(plan.keep[1].start - 2.825) < 1e-9);
  const edited = supplied.applyPauseEdit(samples, sampleRate, plan.keep);
  assert.ok(Math.abs(edited.length / sampleRate - (plan.keep[0].end - plan.keep[0].start + plan.keep[1].end - plan.keep[1].start)) < 1e-3);
});
