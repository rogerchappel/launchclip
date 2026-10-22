// Voice provider registry for `launchclip finish` (RFC §9).
//
// A provider turns narration text into a WAV plus measured word timings:
//
//   { name, async synthesize({ text, voice, speed, outFile, signal })
//       → { file, words: [{ text, start, end }], sampleRate, duration } }
//
// Providers register a factory (options → provider). The real kokoro,
// elevenlabs and supplied providers live beside this file and are imported
// lazily the first time they synthesize; when their file is missing they fail
// with "provider not installed". The deterministic `test` provider is built in
// so the finish pipeline runs offline.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const factories = new Map();
const LAZY = Object.freeze({ kokoro: "./kokoro.js", elevenlabs: "./elevenlabs.js", supplied: "./supplied.js" });

export function registerVoiceProvider(name, factory) {
  const key = providerKey(name);
  if (typeof factory !== "function") throw new Error(`registerVoiceProvider("${key}") needs a factory function (options → provider)`);
  factories.set(key, factory);
}

export function listVoiceProviders() {
  return [...new Set([...factories.keys(), ...Object.keys(LAZY)])].sort();
}

export function getVoiceProvider(name, options = {}) {
  const key = providerKey(name);
  if (factories.has(key)) return checkProvider(factories.get(key)(options), key);
  if (Object.hasOwn(LAZY, key)) return lazyProvider(key, options);
  throw new Error(`Unknown voice provider "${name}". Available providers: ${listVoiceProviders().join(", ")}`);
}

// A stand-in for a provider whose module loads on first use. Importing the
// module is expected to call registerVoiceProvider(name, factory); a default
// export factory is accepted too.
function lazyProvider(name, options) {
  let loaded = null;
  const load = async () => {
    if (loaded) return loaded;
    const file = path.join(HERE, LAZY[name]);
    if (!existsSync(file)) throw new Error(`Voice provider "${name}" is not installed: ${path.relative(process.cwd(), file) || file} is missing. Use --voice test for an offline placeholder, or supply audio.voice and audio.words.`);
    const module = await import(pathToFileURL(file).href);
    if (!factories.has(name) && typeof module.default === "function") factories.set(name, module.default);
    if (!factories.has(name)) throw new Error(`Voice provider "${name}" is not installed: ${LAZY[name]} did not register a provider`);
    loaded = checkProvider(factories.get(name)(options), name);
    return loaded;
  };
  return {
    name,
    async synthesize(request) {
      return (await load()).synthesize(request);
    }
  };
}

function checkProvider(provider, name) {
  if (!provider || typeof provider.synthesize !== "function") throw new Error(`Voice provider "${name}" has no synthesize() method`);
  return provider;
}

function providerKey(name) {
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) throw new Error(`Voice provider name is required. Available providers: ${listVoiceProviders().join(", ")}`);
  return key;
}

// ---------------------------------------------------------------------------
// Deterministic `test` provider: a quiet sine tone, one syllable-shaped burst
// per word, about 0.32 s per word at speed 1. No network, no FFmpeg.

export const TEST_VOICE = Object.freeze({ secondsPerWord: 0.32, wordFraction: 0.8, leadIn: 0.12, tail: 0.3, sampleRate: 24000, frequency: 196, amplitude: 0.32 });

export function testVoiceTimings(text, { speed = 1 } = {}) {
  const rate = Number(speed) > 0 ? Number(speed) : 1;
  const tokens = String(text ?? "").split(/\s+/).filter(Boolean);
  const slot = TEST_VOICE.secondsPerWord / rate;
  const words = tokens.map((token, index) => {
    const start = TEST_VOICE.leadIn + index * slot;
    return { text: token, start: round(start), end: round(start + slot * TEST_VOICE.wordFraction) };
  });
  const duration = round(TEST_VOICE.leadIn + tokens.length * slot + TEST_VOICE.tail);
  return { words, duration };
}

export function createTestVoiceProvider() {
  return {
    name: "test",
    async synthesize({ text, voice = "tone", speed = 1, outFile, signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? new Error("voice synthesis aborted");
      if (!String(text ?? "").trim()) throw new Error("test voice provider needs narration text");
      if (!outFile) throw new Error("test voice provider needs outFile");
      const { words, duration } = testVoiceTimings(text, { speed });
      const sampleRate = TEST_VOICE.sampleRate;
      const frequency = TEST_VOICE.frequency * (1 + (hashString(String(voice)) % 7) / 24);
      const total = Math.round(duration * sampleRate);
      const pcm = Buffer.alloc(total * 2);
      for (const word of words) {
        const from = Math.round(word.start * sampleRate);
        const to = Math.min(total, Math.round(word.end * sampleRate));
        const length = Math.max(1, to - from);
        for (let i = from; i < to; i += 1) {
          const envelope = Math.sin(Math.PI * ((i - from) / length));
          const t = i / sampleRate;
          const sample = TEST_VOICE.amplitude * envelope * (Math.sin(2 * Math.PI * frequency * t) + 0.3 * Math.sin(4 * Math.PI * frequency * t)) / 1.3;
          pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2);
        }
      }
      const file = path.resolve(outFile);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]));
      return { file, words, sampleRate, duration };
    }
  };
}

function wavHeader(dataBytes, sampleRate, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bits / 8, 28);
  header.writeUInt16LE(channels * bits / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function hashString(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

registerVoiceProvider("test", createTestVoiceProvider);
