import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { alignmentToWords, ElevenLabsMediaProvider, LocalSfxLibrary } from "../src/production_media.js";

test("converts ElevenLabs character alignment into exact word timings", () => {
  const words = alignmentToWords({
    characters: ["H", "i", " ", "t", "h", "e", "r", "e"],
    character_start_times_seconds: [0, .1, .2, .3, .4, .5, .6, .7],
    character_end_times_seconds: [.1, .2, .3, .4, .5, .6, .7, .8]
  });
  assert.deepEqual(words, [{ word: "Hi", start: 0, end: .2 }, { word: "there", start: .3, end: .8 }]);
});

test("generates timed narration and model-directed instrumental music through ElevenLabs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-media-"));
  const requests = [];
  const responses = [
    jsonResponse({
      audio_base64: Buffer.from("voice").toString("base64"),
      normalized_alignment: { characters: ["G", "o"], character_start_times_seconds: [0, .1], character_end_times_seconds: [.1, .2] }
    }, { "request-id": "req_voice" }),
    binaryResponse(Buffer.from("music"), { "song-id": "song_1", "request-id": "req_music" })
  ];
  const provider = new ElevenLabsMediaProvider({ apiKey: "test-key", fetch: async (url, init) => { requests.push({ url, init }); return responses.shift(); } });
  const voicePath = path.join(directory, "voice.mp3");
  const voice = await provider.synthesizeNarration({ text: "Go", voiceId: "voice_1", outputPath: voicePath });
  const music = await provider.composeMusic({ prompt: "A restrained technical pulse that resolves cleanly", durationSeconds: 30, outputPath: path.join(directory, "music.mp3") });

  assert.equal((await readFile(voicePath)).toString(), "voice");
  assert.deepEqual(voice.words, [{ word: "Go", start: 0, end: .2 }]);
  assert.equal(voice.request_id, "req_voice");
  assert.equal(music.song_id, "song_1");
  assert.match(requests[0].url, /text-to-speech\/voice_1\/with-timestamps/);
  assert.deepEqual(JSON.parse(requests[1].init.body), { prompt: "A restrained technical pulse that resolves cleanly", music_length_ms: 30000, model_id: "music_v2", force_instrumental: true });
});

test("transcribes supplied audio or presenter video with Scribe word timestamps", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-transcribe-"));
  const filePath = path.join(directory, "take.mp4");
  await writeFile(filePath, "media");
  let request;
  const provider = new ElevenLabsMediaProvider({
    apiKey: "test-key",
    fetch: async (url, init) => {
      request = { url, init };
      return jsonResponse({ text: "Hello world", language_code: "en", words: [{ type: "word", text: "Hello", start: 0.1, end: 0.4, speaker_id: "speaker_0" }] });
    }
  });
  const result = await provider.transcribe({ filePath });
  assert.equal(result.text, "Hello world");
  assert.deepEqual(result.words, [{ word: "Hello", start: .1, end: .4, speaker_id: "speaker_0" }]);
  assert.match(request.url, /speech-to-text$/);
  assert.ok(request.init.body instanceof FormData);
});

test("resolves model-authored cues against the local SFX library and preserves timing intent", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-sfx-"));
  await Promise.all(["tick.wav", "cinematic_boom.wav", "fast_whoosh.wav"].map((name) => writeFile(path.join(directory, name), name)));
  const library = new LocalSfxLibrary(directory);
  const resolved = await library.resolvePlan({ shots: [{ id: "shot-1", start_seconds: 5, sfx: [{ at_seconds: 1.25, cue: "soft evidence click", intent: "mark proof", volume: .3 }] }] });
  assert.equal(resolved[0].id, "tick");
  assert.equal(resolved[0].at_seconds, 6.25);
  assert.equal(resolved[0].intent, "mark proof");
  await assert.rejects(() => library.resolve("underwater dolphin chorus"), /No local SFX matches/);
});

function jsonResponse(value, headers = {}) {
  return { ok: true, status: 200, headers: { get: (name) => headers[String(name).toLowerCase()] ?? null }, json: async () => value, text: async () => JSON.stringify(value) };
}

function binaryResponse(value, headers = {}) {
  return { ok: true, status: 200, headers: { get: (name) => headers[String(name).toLowerCase()] ?? null }, arrayBuffer: async () => value, text: async () => "" };
}
