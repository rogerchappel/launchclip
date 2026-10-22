import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as supplied from "../src/voice/supplied.js";
import { detectOnsets, readWav, writeWav } from "../src/voice/words.js";
import { addNoise, syntheticVoice } from "./helpers/synthetic_voice.js";

const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
const ffmpegOnly = { skip: hasFfmpeg ? false : "ffmpeg is not installed" };

/** Fake ASR: one word per energy onset of the prepared file. */
async function transcribe(file) {
  const { samples, sampleRate } = await readWav(file);
  // One onset per phrase (at least 0.6 s apart), so the words never overlap.
  const onsets = detectOnsets(samples, sampleRate).filter((start, index, all) => index === 0 || start - all[index - 1] > 0.6).slice(0, 3);
  return { words: onsets.map((start, index) => ({ word: ["ship", "it", "today"][index], start: start + 0.01, end: start + 0.3 })) };
}

async function take(name, samples) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "launchclip-supplied-enhance-"));
  const source = path.join(directory, `${name}.wav`);
  await writeWav(source, samples, 48000);
  return { directory, source, outFile: path.join(directory, "voice.wav") };
}

test("supplied voice prep runs the shared chain at the -17 LUFS voiceover target", ffmpegOnly, async () => {
  const t = await take("take", addNoise(syntheticVoice(), { snrDb: 15 }));
  const calls = [];
  const enhanceAudio = async (input, output, options) => {
    calls.push({ input, output, options });
    await copyFile(input, output);
    return { status: "enhanced", chain: [{ stage: "clean" }, { stage: "voice" }, { stage: "level" }], guard: { backoffs: [] }, metrics: { before: { integrated_lufs: -24, snr_db: 15 }, after: { integrated_lufs: -17.1, true_peak_dbtp: -1.6, snr_db: 26 } } };
  };
  const result = await supplied.create({ source: t.source, transcribe, enhanceAudio }).synthesize({ outFile: t.outFile });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.preset, "light");
  assert.equal(calls[0].options.targetLufs, supplied.TARGET_LUFS);
  assert.equal(calls[0].options.truePeakDbtp, supplied.TARGET_TRUE_PEAK);
  assert.equal(calls[0].options.report, false);
  assert.equal(calls[0].output, t.outFile);
  assert.equal(result.prep.loudness_measured_lufs, -17.1);
  assert.equal(result.prep.true_peak_dbtp, -1.6);
  assert.deepEqual(result.prep.enhancement.chain, ["clean", "voice", "level"]);
  assert.equal(result.prep.enhancement.after.snr_db, 26);
});

test("supplied voice prep: --enhance off and an unmeasurable take both fall back to two-pass loudnorm", ffmpegOnly, async () => {
  const t = await take("take", addNoise(syntheticVoice(), { snrDb: 25, humDb: null }));
  let called = 0;
  const off = await supplied.create({ source: t.source, transcribe, enhance: "off", enhanceAudio: async () => { called++; } }).synthesize({ outFile: t.outFile });
  assert.equal(called, 0);
  assert.deepEqual(off.prep.enhancement, { preset: "off", status: "off" });
  assert.ok(Math.abs(off.prep.loudness_measured_lufs - supplied.TARGET_LUFS) < 1, `loudness ${off.prep.loudness_measured_lufs}`);
  const skipped = await supplied.create({ source: t.source, transcribe, enhanceAudio: async (input, output) => { await copyFile(input, output); return { status: "skipped", notes: ["no speech level"] }; } }).synthesize({ outFile: path.join(t.directory, "skipped.wav") });
  assert.equal(skipped.prep.enhancement.status, "skipped");
  assert.ok(Math.abs(skipped.prep.loudness_measured_lufs - supplied.TARGET_LUFS) < 1, `fallback loudness ${skipped.prep.loudness_measured_lufs}`);
});

test("supplied voice prep with the real light chain cleans the take and keeps word timing valid", ffmpegOnly, async () => {
  const t = await take("noisy", addNoise(syntheticVoice(), { snrDb: 15 }));
  const result = await supplied.create({ source: t.source, transcribe }).synthesize({ outFile: t.outFile });
  const { enhancement } = result.prep;
  assert.equal(enhancement.status, "enhanced");
  assert.ok(enhancement.after.snr_db > enhancement.before.snr_db + 5, `SNR ${enhancement.before.snr_db} -> ${enhancement.after.snr_db}`);
  assert.ok(result.prep.true_peak_dbtp <= -1.3);
  assert.ok(result.prep.loudness_measured_lufs <= supplied.TARGET_LUFS + 0.5 && result.prep.loudness_measured_lufs > supplied.TARGET_LUFS - 6);
  assert.equal(result.words.length, 3);
  assert.ok(result.words.every((word) => word.end <= result.duration));
});
