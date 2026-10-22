import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isolateVoiceElevenLabs, isolationCacheDir } from "../src/voice_isolation.js";

const KEY = "sk_test_isolation_key_0123456789";

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-isolation-"));
  const input = path.join(directory, "voice.wav");
  await writeFile(input, Buffer.from("RIFF fake wav bytes"));
  const decoded = [];
  // No FFmpeg: the injected runner records the decode and writes a stand-in.
  const run = async (command, args) => { decoded.push({ command, args }); await writeFile(args.at(-1), "decoded"); return { stdout: "", stderr: "" }; };
  return { directory, input, output: path.join(directory, "isolated.wav"), cacheDir: path.join(directory, "cache"), run, decoded };
}

test("isolation posts multipart audio with the key only in the header, caches by input hash and reuses the cache", async () => {
  const s = await setup();
  const requests = [];
  const notices = [];
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(Buffer.from("ID3 isolated mp3"), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
  const first = await isolateVoiceElevenLabs(s.input, s.output, { env: { ELEVENLABS_API_KEY: KEY }, fetch, run: s.run, cacheDir: s.cacheDir, notice: (line) => notices.push(line), durationSeconds: 12.5 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.elevenlabs.io/v1/audio-isolation");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["xi-api-key"], KEY);
  assert.ok(!requests[0].url.includes(KEY));
  const form = requests[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("file_format"), "other");
  assert.equal(Buffer.from(await form.get("audio").arrayBuffer()).toString(), "RIFF fake wav bytes");
  assert.equal(first.status, "applied");
  assert.equal(first.paid_call, true);
  assert.equal(await readFile(first.cache_file, "utf8"), "ID3 isolated mp3");
  assert.match(notices[0], /paid; POST \/v1\/audio-isolation.*12\.5 s/);
  assert.ok(notices.every((line) => !line.includes(KEY)));
  assert.ok(!JSON.stringify(first).includes(KEY));
  assert.equal(s.decoded[0].command, "ffmpeg");
  assert.equal(s.decoded[0].args.at(-1), s.output);

  const second = await isolateVoiceElevenLabs(s.input, s.output, { env: { ELEVENLABS_API_KEY: KEY }, fetch, run: s.run, cacheDir: s.cacheDir, notice: (line) => notices.push(line) });
  assert.equal(requests.length, 1, "a cached isolation never pays twice");
  assert.equal(second.status, "cached");
  assert.equal(second.paid_call, false);
  assert.match(notices.at(-1), /REUSE cached ElevenLabs isolation/);
  // Even without a key, the cached result is reused.
  const third = await isolateVoiceElevenLabs(s.input, s.output, { env: {}, fetch, run: s.run, cacheDir: s.cacheDir });
  assert.equal(third.status, "cached");
});

test("isolation never sends without a key and scrubs the key from API and network errors", async () => {
  const s = await setup();
  let calls = 0;
  await assert.rejects(() => isolateVoiceElevenLabs(s.input, s.output, { env: {}, fetch: async () => { calls++; }, run: s.run, cacheDir: s.cacheDir }), /needs ELEVENLABS_API_KEY\. Nothing was sent/);
  assert.equal(calls, 0);

  const echo = async () => new Response(`{"detail":"invalid api key ${KEY}"}`, { status: 401 });
  const rejected = await isolateVoiceElevenLabs(s.input, s.output, { env: { ELEVENLABS_API_KEY: KEY }, fetch: echo, run: s.run, cacheDir: s.cacheDir }).catch((error) => error);
  assert.match(rejected.message, /failed \(401\)/);
  assert.match(rejected.message, /\[redacted\]/);
  assert.ok(!rejected.message.includes(KEY));
  assert.ok(!String(rejected.stack).includes(KEY));

  const broken = async () => { throw new Error(`connect ECONNREFUSED with header ${KEY}`); };
  const network = await isolateVoiceElevenLabs(s.input, s.output, { env: { ELEVENLABS_API_KEY: KEY }, fetch: broken, run: s.run, cacheDir: s.cacheDir }).catch((error) => error);
  assert.match(network.message, /request failed: connect ECONNREFUSED/);
  assert.ok(!network.message.includes(KEY));

  const empty = await isolateVoiceElevenLabs(s.input, s.output, { env: { ELEVENLABS_API_KEY: KEY }, fetch: async () => new Response(Buffer.alloc(0), { status: 200 }), run: s.run, cacheDir: s.cacheDir }).catch((error) => error);
  assert.match(empty.message, /empty audio/);
  // Nothing failed was cached.
  assert.deepEqual(await readdir(s.cacheDir).catch(() => []), []);
  await assert.rejects(() => isolateVoiceElevenLabs(s.input, s.output, { env: { ELEVENLABS_API_KEY: KEY }, fetch: echo, run: s.run, cacheDir: s.cacheDir, durationSeconds: 4000 }), /up to 1 hour/);
});

test("isolation cache lives under LAUNCHCLIP_CACHE or the user cache", () => {
  assert.equal(isolationCacheDir({ LAUNCHCLIP_CACHE: "/tmp/lc" }), path.join("/tmp/lc", "elevenlabs", "audio-isolation"));
  assert.match(isolationCacheDir({}), /\.cache[\\/]launchclip[\\/]elevenlabs[\\/]audio-isolation$/);
});
