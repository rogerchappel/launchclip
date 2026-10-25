import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { audioEnhancementAvailable, cleanFilters, ENHANCE_PRESETS, enhanceRecordingAudio, noiseProfileWindow, validateEnhanceOptions, voiceFilters } from "../src/audio_enhance.js";
import { classifyFrames, detectHum, estimateLag, measureVoice } from "../src/audio_metrics.js";
import { readWav, writeWav } from "../src/voice/words.js";
import { addNoise, syntheticVoice } from "./helpers/synthetic_voice.js";
import { mediaSkip } from "./helpers/media.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const ffmpegOnly = { skip: mediaSkip(hasFfmpeg ? false : "ffmpeg is not installed") };
const RATE = 48000;

async function fixture(name, samples) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-enhance-test-"));
  const file = path.join(directory, `${name}.wav`);
  await writeWav(file, samples, RATE);
  return { directory, file };
}

function downsample(samples, factor = 2) { return Float32Array.from({ length: Math.floor(samples.length / factor) }, (_, index) => samples[index * factor]); }

test("metrics: speech/silence mask, noise floor and SNR follow the mixed-in noise", () => {
  const clean = syntheticVoice();
  const noisy = addNoise(clean, { snrDb: 15, humDb: null });
  const analysis = downsample(noisy);
  const mask = classifyFrames(analysis, 24000);
  assert.ok(mask.silences.length >= 3, "the pauses are detected as silences");
  const measured = measureVoice(analysis, 24000, { mask });
  assert.ok(measured.snr_db > 10 && measured.snr_db < 22, `SNR ${measured.snr_db} near the mixed 15 dB`);
  const quieter = measureVoice(downsample(addNoise(clean, { snrDb: 30, humDb: null })), 24000, { mask });
  assert.ok(measured.noise_floor_dbfs - quieter.noise_floor_dbfs > 12, "15 dB less noise shows as a lower floor");
});

test("metrics: hum detection separates 50 from 60 Hz and ignores plain noise", () => {
  const clean = syntheticVoice();
  const at60 = detectHum(downsample(addNoise(clean, { humHz: 60, humDb: -38 })), 24000);
  assert.equal(at60.detected, true);
  assert.equal(at60.fundamental_hz, 60);
  assert.ok(at60.harmonics.find((entry) => entry.hz === 60).notch);
  const at50 = detectHum(downsample(addNoise(clean, { humHz: 50, humDb: -38 })), 24000);
  assert.equal(at50.fundamental_hz, 50);
  const none = detectHum(downsample(addNoise(clean, { humDb: null })), 24000);
  assert.equal(none.detected, false);
});

test("metrics: lag estimation finds a delayed copy", () => {
  const voice = downsample(syntheticVoice());
  const delayed = new Float32Array(voice.length);
  delayed.set(voice.subarray(0, voice.length - 240), 240);
  assert.equal(estimateLag(voice, delayed, 24000), 240);
  assert.equal(estimateLag(voice, voice, 24000), 0);
});

test("filters: preset choices, profile window and the expander guard", () => {
  assert.throws(() => validateEnhanceOptions({ preset: "loud" }), /--enhance must be one of light, podcast, off/);
  assert.throws(() => validateEnhanceOptions({ voiceIsolation: "magic" }), /--voice-isolation must be one of none, elevenlabs/);
  assert.deepEqual(validateEnhanceOptions({}), { preset: "light", voiceIsolation: "none", targetLufs: -16, truePeak: -1.5 });
  const clean = cleanFilters(ENHANCE_PRESETS.light, { notches: [60, 120], nr: 12, noiseFloor: -45, profile: { start: 0, end: 48000 } }).map((filter) => filter.text);
  assert.deepEqual(clean.slice(0, 3), ["highpass=f=80:poles=2", "bandreject=f=60:width_type=q:width=12", "bandreject=f=120:width_type=q:width=12"]);
  assert.match(clean[3], /^afftdn=nr=12:nf=-35:tn=0$/);
  assert.match(cleanFilters(ENHANCE_PRESETS.light, { nr: 12, noiseFloor: -45, profile: null }).at(-1).text, /tn=1/);
  const light = voiceFilters(ENHANCE_PRESETS.light, { speechLevel: -18, noiseFloor: -50, harsh: false }).map((filter) => filter.name);
  assert.deepEqual(light, ["equalizer", "deesser", "acompressor", "agate"]);
  assert.ok(voiceFilters(ENHANCE_PRESETS.podcast, { speechLevel: -18, noiseFloor: -50, harsh: true }).some((filter) => filter.name === "dynaudnorm"));
  // Speech too close to the floor: no expander, so quiet words are never chopped.
  assert.ok(!voiceFilters(ENHANCE_PRESETS.light, { speechLevel: -30, noiseFloor: -44, harsh: false }).some((filter) => filter.name === "agate"));
  assert.equal(noiseProfileWindow([{ start_seconds: 1, end_seconds: 1.2 }], 480000), null);
  assert.deepEqual(noiseProfileWindow([{ start_seconds: 1, end_seconds: 1.2 }, { start_seconds: 3, end_seconds: 6 }], 480000), { start: 146400, end: 242400 });
});

test("light preset: lowers the noise floor, keeps speech-band energy, notches hum, levels safely and keeps every sample in place", ffmpegOnly, async () => {
  const noisy = addNoise(syntheticVoice(), { snrDb: 15, humDb: -40 });
  const { directory, file } = await fixture("noisy", noisy);
  const output = path.join(directory, "light.wav");
  const report = await enhanceRecordingAudio(file, output, { preset: "light" });
  assert.equal(report.status, "enhanced");
  const { before, after, change } = report.metrics;
  assert.ok(change.snr_db >= 6, `SNR improves by at least 6 dB (got ${change.snr_db})`);
  const clean = report.guard.checks.find((check) => check.passed);
  assert.ok(clean.noise_floor_change_db <= -8, `denoise lowers the floor by at least 8 dB before levelling (got ${clean.noise_floor_change_db})`);
  assert.ok(clean.speech_band_change_db >= -1.5, `speech-band energy kept within 1.5 dB (got ${clean.speech_band_change_db})`);
  assert.equal(before.hum.detected, true);
  assert.deepEqual(report.chain[0].hum_notches_hz.slice(0, 1), [60]);
  const humBefore = before.hum.harmonics.find((entry) => entry.hz === 60).prominence_db;
  const humAfter = after.hum.fundamentals_db[60];
  assert.ok(humBefore - humAfter >= 6, `60 Hz hum drops at least 6 dB against its neighbourhood (${humBefore} -> ${humAfter})`);
  // -16 LUFS unless reaching it would need more than the preset's 6 dB of
  // limiting (this synthetic voice is peak-dense); then it is delivered
  // quieter and says so, never squashed.
  const level = report.chain.find((stage) => stage.stage === "level");
  if (level.limiting_capped) {
    assert.ok(after.integrated_lufs < -16 && after.integrated_lufs > -24, `capped loudness ${after.integrated_lufs}`);
    assert.match(report.notes.join(" "), /needs more than 6 dB of limiting/);
  } else assert.ok(Math.abs(after.integrated_lufs - -16) <= 0.5, `loudness ${after.integrated_lufs}`);
  assert.ok(after.true_peak_dbtp <= -1.3, `true peak ${after.true_peak_dbtp}`);
  assert.equal(report.alignment.residual_lag_ms, 0);
  const written = await readWav(output);
  assert.equal(written.samples.length, noisy.length);
  const saved = JSON.parse(await readFile(path.join(directory, "audio-enhance.json"), "utf8"));
  assert.equal(saved.schema_version, "launchclip.audio-enhance.v1");
  assert.equal(saved.preset, "light");
});

test("podcast preset levels a quiet second speaker closer to the first", ffmpegOnly, async () => {
  const voice = syntheticVoice();
  // The last phrase is 10 dB quieter, like a second, distant speaker.
  const uneven = Float32Array.from(voice, (value, index) => index / RATE >= 6.2 ? value * 0.316 : value);
  const { directory, file } = await fixture("uneven", addNoise(uneven, { snrDb: 25, humDb: null }));
  const spread = async (name) => {
    const output = path.join(directory, `${name}.wav`);
    await enhanceRecordingAudio(file, output, { preset: name, report: false });
    const samples = (await readWav(output)).samples;
    const rms = (start, end) => { let sum = 0; for (let index = Math.round(start * RATE); index < Math.round(end * RATE); index++) sum += samples[index] ** 2; return 10 * Math.log10(sum / ((end - start) * RATE)); };
    return rms(3.5, 5.3) - rms(6.5, 7.5);
  };
  const light = await spread("light");
  const podcast = await spread("podcast");
  assert.ok(podcast < light - 1, `podcast narrows the level gap (light ${light.toFixed(1)} dB, podcast ${podcast.toFixed(1)} dB)`);
});

test("over-processing guard backs denoise off and records why", ffmpegOnly, async () => {
  const { directory, file } = await fixture("guard", addNoise(syntheticVoice(), { snrDb: 15, humDb: null }));
  const report = await enhanceRecordingAudio(file, path.join(directory, "guarded.wav"), { preset: "light", presetOverrides: { denoise_nr_db: 60, max_flatness_change_log2: 0.4 }, report: false });
  assert.equal(report.status, "enhanced");
  assert.ok(report.guard.backoffs.length >= 1);
  assert.equal(report.guard.backoffs[0].from_nr_db, 60);
  assert.match(report.guard.backoffs[0].reasons.join(" "), /flatness changed/);
  const accepted = report.guard.checks.find((check) => check.passed);
  assert.ok(accepted.denoise_nr_db < 60);
  assert.equal(report.chain.find((stage) => stage.stage === "clean").denoise_nr_db, accepted.denoise_nr_db);
});

test("a noise-only window from the original take can supply the denoise profile", ffmpegOnly, async () => {
  const { directory, file } = await fixture("edited", addNoise(syntheticVoice(), { snrDb: 15, humDb: null }));
  const reference = path.join(directory, "original.wav");
  await writeWav(reference, addNoise(new Float32Array(48000 * 3).fill(0).map((_, index) => index > 48000 * 2 ? 0.05 * Math.sin(index / 7) : 0), { snrDb: 15, humDb: null, seed: 7 }), 48000);
  const report = await enhanceRecordingAudio(file, path.join(directory, "profiled.wav"), { noiseProfile: { file: reference, start_seconds: 0.2, end_seconds: 1.8 }, report: false });
  assert.equal(report.status, "enhanced");
  assert.equal(report.detections.noise_profile.source, "reference");
  assert.equal(report.detections.noise_profile.file, reference);
  assert.ok(Number.isFinite(report.detections.noise_profile.noise_floor_dbfs));
  assert.equal(report.chain.find((stage) => stage.stage === "clean").noise_profile, true);
  assert.equal((await readWav(path.join(directory, "profiled.wav"))).samples.length, 8 * 48000);
  await assert.rejects(() => enhanceRecordingAudio(file, path.join(directory, "bad.wav"), { noiseProfile: { file: reference, start_seconds: 1, end_seconds: 1.1 }, report: false }), /at least 0.25 s/);
});

test("loudness reaches a delivery target; off preset and unmeasurable audio", ffmpegOnly, async () => {
  const noisy = addNoise(syntheticVoice(), { snrDb: 20, humDb: null });
  const { directory, file } = await fixture("source", noisy);
  const report = await enhanceRecordingAudio(file, path.join(directory, "target.wav"), { preset: "light", targetLufs: -20, report: false });
  assert.ok(Math.abs(report.metrics.after.integrated_lufs - -20) <= 0.5, `delivery target -20 LUFS (got ${report.metrics.after.integrated_lufs})`);
  const off = await enhanceRecordingAudio(file, path.join(directory, "off.wav"), { preset: "off", report: false });
  assert.equal(off.status, "off");
  assert.deepEqual(await readFile(path.join(directory, "off.wav")), await readFile(file));
  const flat = await fixture("flat", Float32Array.from({ length: RATE * 3 }, (_, index) => 0.1 * Math.sin(2 * Math.PI * 440 * index / RATE)));
  const skipped = await enhanceRecordingAudio(flat.file, path.join(flat.directory, "flat-out.wav"), { report: false });
  assert.equal(skipped.status, "skipped");
  await assert.rejects(() => enhanceRecordingAudio(file, file), /must differ/);
});

test("video input keeps its video stream and duration", ffmpegOnly, async () => {
  const { directory, file } = await fixture("video-audio", addNoise(syntheticVoice({ seconds: 8 }), { snrDb: 15 }));
  const video = path.join(directory, "take.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=160x90:r=25:d=8", "-i", file, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
  const output = path.join(directory, "take-enhanced.mp4");
  const report = await enhanceRecordingAudio(video, output, { report: false });
  assert.equal(report.status, "enhanced");
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { encoding: "utf8" }));
  assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
  assert.ok(Math.abs(Number(probe.format.duration) - 8) < 0.1);
  assert.ok((await stat(output)).size > 0);
});

test("voice isolation runs before the chain, is realigned to the source grid and failures fall back to the chain", ffmpegOnly, async () => {
  const noisy = addNoise(syntheticVoice(), { snrDb: 15, humDb: null });
  const { directory, file } = await fixture("isolate", noisy);
  const calls = [];
  // A stand-in for the API that returns the clean voice 30 ms late (codec priming).
  const isolate = async (input, output, options) => {
    calls.push({ input, options: { durationSeconds: options.durationSeconds } });
    const clean = syntheticVoice();
    const late = new Float32Array(clean.length);
    late.set(clean.subarray(0, clean.length - 1440), 1440);
    await writeWav(output, late, RATE);
    return { provider: "elevenlabs", status: "applied", paid_call: true, cache_file: "cached.mp3" };
  };
  const report = await enhanceRecordingAudio(file, path.join(directory, "isolated.wav"), { preset: "light", voiceIsolation: "elevenlabs", report: false }, { isolate });
  assert.equal(calls.length, 1);
  assert.ok(Math.abs(calls[0].options.durationSeconds - 8) < 0.01);
  assert.equal(report.voice_isolation.status, "applied");
  assert.ok(Math.abs(report.voice_isolation.alignment_shift_ms - 30) <= 0.1, `realigned by ${report.voice_isolation.alignment_shift_ms} ms`);
  assert.equal(report.chain[0].stage, "isolation");
  assert.ok(report.metrics.after_isolation.snr_db > report.metrics.before.snr_db + 10);
  const failed = await enhanceRecordingAudio(file, path.join(directory, "fallback.wav"), { preset: "light", voiceIsolation: "elevenlabs", report: false }, { isolate: async () => { throw new Error("ElevenLabs voice isolation failed (401): invalid key"); } });
  assert.equal(failed.status, "enhanced");
  assert.equal(failed.voice_isolation.status, "failed");
  assert.match(failed.notes.join(" "), /continuing with the FFmpeg chain/);
});

test("feature check reports missing FFmpeg filters without throwing", async () => {
  const filters = ["highpass", "bandreject", "afftdn", "asendcmd", "equalizer", "deesser", "agate", "acompressor", "dynaudnorm", "alimiter", "loudnorm", "volume", "atrim", "apad", "concat"];
  const listing = (names) => async () => ({ stdout: `Filters:\n${names.map((name) => ` TS ${name}  A->A  x`).join("\n")}\n` });
  const ready = await audioEnhancementAvailable({ run: listing(filters), env: { ELEVENLABS_API_KEY: "secret-value" } });
  assert.equal(ready.available, true);
  assert.deepEqual(ready.presets, ["light", "podcast", "off"]);
  assert.equal(ready.default_preset, "light");
  assert.equal(ready.voice_isolation.elevenlabs.configured, true);
  assert.ok(!JSON.stringify(ready).includes("secret-value"));
  const partial = await audioEnhancementAvailable({ run: listing(filters.filter((name) => name !== "afftdn")), env: {} });
  assert.equal(partial.available, false);
  assert.deepEqual(partial.missing, ["afftdn"]);
  const missing = await audioEnhancementAvailable({ run: async () => { throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }); }, env: {} });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "FFmpeg is not installed");
});
