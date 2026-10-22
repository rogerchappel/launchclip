#!/usr/bin/env node
// Build a deliberately noisy talking-head test recording for the audio
// enhancement proof (qa/enhance/). From a clean voice WAV and its sentence
// spans it lays out: leading silence, a first take of sentence 1, a pause,
// the retake of sentence 1, the remaining sentences with long pauses, then
// adds harsh sibilance (+9 dB around 7 kHz), pink noise at the requested
// speech-to-noise ratio and a 60 Hz hum with harmonics, and muxes it over a
// plain video track.
//
//   node scripts/make-noisy-recording.mjs <voice.wav> <out-dir> --spans 0.25-2.47,2.92-6.24,... [--snr 15]

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readWav, writeWav } from "../src/voice/words.js";

const run = promisify(execFile);
const [voice, outDir, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const index = rest.indexOf(`--${name}`); return index >= 0 ? rest[index + 1] : fallback; };
if (!voice || !outDir || !flag("spans")) throw new Error("usage: make-noisy-recording.mjs <voice.wav> <out-dir> --spans a-b,c-d,... [--snr 15]");
const spans = flag("spans").split(",").map((pair) => pair.split("-").map(Number));
const snr = Number(flag("snr", "15"));
const rate = 48000;
await mkdir(outDir, { recursive: true });

const decoded = path.join(outDir, "voice-48k.wav");
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", voice, "-ac", "1", "-ar", String(rate), "-c:a", "pcm_f32le", decoded]);
// Harsh sibilance: a broad lift around 7 kHz.
const harsh = path.join(outDir, "voice-harsh.wav");
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", decoded, "-af", "equalizer=f=7000:t=o:w=1.2:g=9", "-c:a", "pcm_f32le", harsh]);
const { samples } = await readWav(harsh);
const piece = ([start, end]) => samples.slice(Math.round((start - 0.05) * rate), Math.round((end + 0.08) * rate));
const silence = (seconds) => new Float32Array(Math.round(seconds * rate));
const layout = [silence(1.2), piece(spans[0]), silence(1.6), piece(spans[0]), silence(0.5)];
spans.slice(1).forEach((span, index) => layout.push(piece(span), silence(index % 2 ? 0.5 : 1.4)));
layout.push(silence(1.0));
const total = layout.reduce((sum, part) => sum + part.length, 0);
const clean = new Float32Array(total);
let offset = 0;
for (const part of layout) { clean.set(part, offset); offset += part.length; }

// Active-speech RMS (20 ms frames above -50 dBFS).
let power = 0; let frames = 0;
for (let at = 0; at + 960 <= clean.length; at += 960) {
  let sum = 0;
  for (let index = at; index < at + 960; index++) sum += clean[index] ** 2;
  if (sum / 960 > 1e-5) { power += sum / 960; frames++; }
}
const speechRms = Math.sqrt(power / frames);
const noiseRms = speechRms / 10 ** (snr / 20);

// Pink noise (Paul Kellet's filter) at the target RMS, deterministic seed.
let seed = 12345;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 * 2 - 1; };
const pink = new Float32Array(total);
let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
for (let index = 0; index < total; index++) {
  const white = random();
  b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852;
  b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
  pink[index] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; b6 = white * 0.115926;
}
let pinkPower = 0;
for (const value of pink) pinkPower += value * value;
const pinkScale = noiseRms / Math.sqrt(pinkPower / total);
const humLevel = 10 ** (-42 / 20);
const noisy = new Float32Array(total);
for (let index = 0; index < total; index++) {
  const t = index / rate;
  const hum = humLevel * (Math.sin(2 * Math.PI * 60 * t) + 0.5 * Math.sin(2 * Math.PI * 120 * t) + 0.35 * Math.sin(2 * Math.PI * 180 * t) + 0.2 * Math.sin(2 * Math.PI * 240 * t));
  noisy[index] = clean[index] + pink[index] * pinkScale + hum;
}
const cleanFile = path.join(outDir, "clean.wav");
const noisyFile = path.join(outDir, "noisy.wav");
await writeWav(cleanFile, clean, rate);
await writeWav(noisyFile, noisy, rate);
const video = path.join(outDir, "noisy-recording.mp4");
const duration = (total / rate).toFixed(3);
await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0x202830:s=640x360:r=30:d=${duration}`, "-i", noisyFile, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", "-shortest", video]);
console.log(JSON.stringify({ clean: cleanFile, noisy: noisyFile, video, duration_seconds: Number(duration), snr_db: snr, speech_rms_dbfs: Math.round(200 * Math.log10(speechRms)) / 10 }, null, 2));
