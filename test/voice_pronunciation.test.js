import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPronunciation, normalizePronunciation, restoreWords } from "../src/voice/pronunciation.js";
import { narrationCacheKey, narrationDocument, narrationRequest, normalizeVoiceSettings, synthesizeNarration } from "../src/voice/narrate.js";
import { createTestVoiceProvider } from "../src/voice/index.js";
import * as elevenlabs from "../src/voice/elevenlabs.js";
import { validateStory } from "../kit/core/story.mjs";

async function tempDir(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-pronounce-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("applyPronunciation respells whole words, keeps their punctuation and groups them back", () => {
  const spoken = applyPronunciation("Query it with SQL, then ship to AWS. Next.js ships too.", { sql: "sequel", AWS: "A W S", "Next.js": "next jay ess" });
  assert.equal(spoken.text, "Query it with sequel, then ship to A W S. next jay ess ships too.");
  assert.deepEqual(spoken.groups.map((group) => [group.tokens, group.spoken]), [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 3], [1, 3], [1, 1], [1, 1]]);
  // A word that only contains a term is not respelled.
  assert.equal(applyPronunciation("SQLite is fine", { SQL: "sequel" }).text, "SQLite is fine");
  // A multi-word term matches as a phrase.
  assert.equal(applyPronunciation("Use Launch Clip now", { "launch clip": "lornch clip" }).text, "Use lornch clip now");
});

test("restoreWords folds the spoken words back onto the script's words", () => {
  const text = "Ship to AWS today.";
  const spoken = applyPronunciation(text, { AWS: "A W S" });
  const words = [["Ship", 0, 0.2], ["to", 0.2, 0.3], ["A", 0.3, 0.4], ["W", 0.4, 0.5], ["S", 0.5, 0.6], ["today.", 0.6, 0.9]].map(([t, start, end]) => ({ text: t, start, end }));
  assert.deepEqual(restoreWords(words, text, spoken), [{ text: "Ship", start: 0, end: 0.2 }, { text: "to", start: 0.2, end: 0.3 }, { text: "AWS", start: 0.3, end: 0.6 }, { text: "today.", start: 0.6, end: 0.9 }]);
  // A take that does not match the spoken words one-to-one is aligned to the script.
  const off = restoreWords(words.slice(0, 5), text, spoken);
  assert.deepEqual(off.map((word) => word.text), ["Ship", "to", "AWS", "today."]);
});

test("pronunciation and voice settings are validated and only join the cache key when set", () => {
  assert.throws(() => normalizePronunciation(["SQL"]), /must be an object/);
  assert.throws(() => normalizePronunciation({ SQL: "" }), /non-empty string/);
  assert.throws(() => normalizeVoiceSettings({ stability: 2 }), /stability must be a number from 0 to 1/);
  assert.throws(() => normalizeVoiceSettings({ warmth: 0.4 }), /unknown setting "warmth"/);
  assert.throws(() => normalizeVoiceSettings({ speaker_boost: "yes" }), /true or false/);
  const plain = narrationRequest({ text: "Hello there.", provider: "elevenlabs" });
  assert.deepEqual(Object.keys(plain), ["text", "provider", "voice", "speed"]);
  assert.equal(narrationCacheKey(plain), narrationCacheKey(narrationRequest({ text: "Hello there.", provider: "elevenlabs", pronunciation: {}, settings: {} })));
  const tuned = narrationRequest({ text: "Hello there.", provider: "elevenlabs", settings: { stability: 0.4, similarity: 0.8, style: 0.1, speaker_boost: true }, pronunciation: { hello: "huh-low" } });
  assert.deepEqual(tuned.settings, { stability: 0.4, similarity: 0.8, style: 0.1, speaker_boost: true });
  assert.notEqual(narrationCacheKey(tuned), narrationCacheKey(plain));
});

test("synthesizeNarration speaks the respelled text but returns the script's words", async (t) => {
  const directory = await tempDir(t);
  const seen = [];
  const testVoice = createTestVoiceProvider();
  const voiceProvider = () => ({ name: "test", synthesize: (request) => { seen.push(request); return testVoice.synthesize(request); } });
  const request = narrationRequest({ text: "Deploy to AWS with SQL.", provider: "test", pronunciation: { AWS: "A W S", SQL: "sequel" }, settings: { stability: 0.5 } });
  const take = await synthesizeNarration(request, { outFile: path.join(directory, "n.wav"), voiceProvider });
  assert.equal(seen[0].text, "Deploy to A W S with sequel.");
  assert.deepEqual(seen[0].settings, { stability: 0.5 });
  assert.deepEqual(take.words.map((word) => word.text), ["Deploy", "to", "AWS", "with", "SQL."]);
  const aws = take.words[2];
  assert.ok(aws.end - aws.start > take.words[1].end - take.words[1].start, "AWS spans its three spoken letters");
  const document = narrationDocument(request, take);
  assert.equal(document.text, "Deploy to AWS with SQL.", "NARRATION.json (and so the captions) keep the script's spelling");
  assert.deepEqual(document.pronunciation, { AWS: "A W S", SQL: "sequel" });
});

test("ElevenLabs sends voice settings under its own names", async (t) => {
  const directory = await tempDir(t);
  const text = "Hot coffee.";
  const characters = Array.from(text);
  const alignment = { characters, character_start_times_seconds: characters.map((_, i) => i * 0.05), character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.05) };
  const bodies = [];
  const fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ audio_base64: Buffer.alloc(24000 * 2).toString("base64"), alignment }) };
  };
  const provider = elevenlabs.create({ env: { ELEVENLABS_API_KEY: "test-key", ELEVENLABS_VOICE_ID: "v1" }, fetch });
  await provider.synthesize({ text, speed: 1, settings: { stability: 0.3, similarity: 0.9, style: 0.2, speaker_boost: false }, outFile: path.join(directory, "e.wav") });
  assert.deepEqual(bodies[0].voice_settings, { speed: 1, stability: 0.3, similarity_boost: 0.9, style: 0.2, use_speaker_boost: false });
  await provider.synthesize({ text, outFile: path.join(directory, "f.wav") });
  assert.equal(bodies[1].voice_settings, undefined, "no settings, no voice_settings");
});

test("story validation accepts audio.narration pronunciation and settings, and names bad ones", () => {
  const story = (narration) => ({ format: { width: 1080, height: 1920, fps: 30, duration: 4 }, audio: { narration: { text: "Ship to AWS.", ...narration } }, scenes: [{ id: "s1", module: "kinetic-title", start: 0, end: 4, params: { text: "Ship" } }] });
  const errors = (narration) => validateStory(story(narration)).errors.filter((error) => /narration/.test(error));
  assert.deepEqual(errors({ pronunciation: { AWS: "A W S" }, settings: { stability: 0.5, speaker_boost: true } }), []);
  assert.match(errors({ pronunciation: { AWS: 3 } }).join("\n"), /pronunciation must be an object/);
  assert.match(errors({ settings: { stability: 3 } }).join("\n"), /settings\.stability must be a number from 0 to 1/);
  assert.match(errors({ settings: { warmth: 1 } }).join("\n"), /settings\.warmth must be one of/);
});
