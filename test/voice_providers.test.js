import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  alignWordsToText, detectOnsets, encodeWav, finalizeWords, normalizeWord, onsetError,
  proportionalAlign, readWav, snapOnsets, splitSentences, tokenizeText, validateWords, writeWav
} from "../src/voice/words.js";

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
