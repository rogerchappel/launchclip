import assert from "node:assert/strict";
import test from "node:test";
import { clippedRuns, detectOnsets, encodeWav, familyRules, measure, processSamples, removeDc, toDb } from "../src/sfx/process.js";

const SR = 48000;

// A deterministic noise source (no Math.random).
function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 * 2 - 1; };
}

// One synthetic keystroke: a 0.2 ms attack, a click burst and a short thock.
function keystroke(length = 0.06, seed = 1) {
  const noise = rng(seed);
  const out = new Float32Array(Math.round(length * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const attack = Math.min(t / 0.0002, 1);
    out[i] = attack * (0.7 * noise() * Math.exp(-t / 0.002) + 0.5 * Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t / 0.008));
  }
  return out;
}

function clip(seconds, hits, { floor = 0.0003, dc = 0 } = {}) {
  const out = new Float32Array(Math.round(seconds * SR));
  const noise = rng(99);
  for (let i = 0; i < out.length; i++) out[i] = floor * noise() + dc;
  for (const { at, gain = 0.5, seed = 1 } of hits) {
    const hit = keystroke(0.06, seed);
    const start = Math.round(at * SR);
    for (let i = 0; i < hit.length && start + i < out.length; i++) out[start + i] += hit[i] * gain;
  }
  return out;
}

test("leading silence is trimmed so the transient starts within 5 ms", () => {
  const input = clip(0.5, [{ at: 0.23 }]);
  const result = processSamples([input], SR, "keystroke");
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.measurements.onset_ms <= 5, `onset ${result.measurements.onset_ms} ms`);
  assert.ok(result.measurements.onset_ms >= 0.5, "a short pre-roll is kept before the transient");
  assert.ok(Math.abs(result.stats.trimmed_lead_ms - 229) < 3, `trimmed ${result.stats.trimmed_lead_ms} ms of lead`);
  const onsets = detectOnsets(input, SR, { minGapMs: 45 });
  assert.equal(onsets.length, 1);
  assert.ok(Math.abs(onsets[0].time - 0.23) < 0.0015, `onset found at ${onsets[0].time}`);
});

test("multi-hit clips keep the cleanest single hit, or are rejected", () => {
  // Three keystrokes; the second is buried under the first's ring-out, the
  // third sits alone after silence.
  const input = clip(0.7, [{ at: 0.1, gain: 0.5 }, { at: 0.3, gain: 0.45, seed: 2 }, { at: 0.5, gain: 0.48, seed: 3 }]);
  const result = processSamples([input], SR, "keystroke", { harvest: 3 });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.stats.hits, 3, "all three hits are detected");
  assert.equal(result.measurements.hits, 1, "the kept clip holds one hit");
  assert.ok(result.measurements.duration_ms <= 120);
  assert.equal(result.harvested.length, 3, "harvesting returns each clean hit");
  // Rapid hits where each is cut off by the next (and the clip ends right
  // after the last) leave no clean hit: rejected for a single-hit family.
  const dense = new Float32Array(Math.round(0.312 * SR));
  for (let k = 0; k < 6; k++) {
    const hit = keystroke(0.06, k + 1);
    const start = Math.round((0.05 + k * 0.046) * SR);
    for (let i = 0; i < hit.length && start + i < dense.length; i++) dense[start + i] += hit[i] * 0.4;
  }
  const rejected = processSamples([dense], SR, "keystroke");
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /multi-hit/);
  // Swelling families never split on onsets.
  assert.equal(familyRules("whoosh").single, false);
});

test("the tail is trimmed against the noise floor and faded out", () => {
  const input = clip(0.8, [{ at: 0.05 }], { floor: 0.0002 });
  const result = processSamples([input], SR, "keystroke");
  assert.ok(result.ok);
  const out = result.channels[0];
  assert.ok(result.measurements.duration_ms < 80, `kept ${result.measurements.duration_ms} ms of a 60 ms hit`);
  assert.ok(result.stats.trimmed_tail_ms > 650);
  assert.ok(Math.abs(out.at(-1)) < 1e-3, "the last sample is faded to near silence");
  // The family cap holds even for a long ringing hit.
  const long = new Float32Array(SR);
  for (let i = 0; i < long.length; i++) long[i] = (i > 4800 ? 1 : 0) * Math.sin(2 * Math.PI * 440 * i / SR) * Math.exp(-(i - 4800) / SR / 0.5);
  const capped = processSamples([long], SR, "keystroke");
  assert.ok(capped.measurements.duration_ms <= 120, `keystroke capped at ${capped.measurements.duration_ms} ms`);
  const tick = processSamples([long], SR, "tick");
  assert.ok(tick.measurements.duration_ms <= 150);
});

test("clips are normalised, DC is removed and silent or clipped clips are rejected", () => {
  const quiet = clip(0.3, [{ at: 0.1, gain: 0.05 }], { dc: 0.02 });
  const result = processSamples([quiet, quiet], SR, "keystroke");
  assert.ok(result.ok);
  assert.equal(result.channels.length, 2, "stereo stays stereo");
  assert.equal(result.measurements.peak_db, -3, "peak normalised to the family target");
  assert.ok(result.stats.gain_db > 10);
  assert.ok(Math.abs(result.stats.dc_offset - 0.02) < 0.002, "the DC offset is measured");
  const mean = result.channels[0].reduce((sum, value) => sum + value, 0) / result.channels[0].length;
  assert.ok(Math.abs(mean) < 0.01, "the output has no DC offset");
  assert.ok(Math.abs(removeDc([new Float32Array([1, 1, 1])]).channels[0][0]) < 1e-9);

  const silent = processSamples([new Float32Array(SR / 4).fill(0.0001)], SR, "tick");
  assert.equal(silent.ok, false);
  assert.match(silent.reason, /silent/);

  const hot = clip(0.3, [{ at: 0.05, gain: 0.5 }]);
  for (let k = 0; k < 4; k++) for (let i = 0; i < 6; i++) hot[3000 + k * 400 + i] = 1;
  assert.ok(clippedRuns([hot]) >= 4);
  assert.match(processSamples([hot], SR, "keystroke").reason, /clipped/);
  // Float overs that are not flat-topped are not clipping.
  const overs = new Float32Array(2000).map((_, i) => 1.2 * Math.sin(i / 3));
  assert.equal(clippedRuns([overs]), 0);
});

test("measure reports onset, duration, peak and loudness fields; encodeWav writes PCM", () => {
  const input = clip(0.2, [{ at: 0.002 }], { floor: 0 });
  const measured = measure([input], SR, familyRules("keystroke"));
  for (const key of ["onset_ms", "duration_ms", "peak_db", "peak_at_ms", "rms_db", "hits", "channels", "sample_rate"]) assert.ok(key in measured, key);
  assert.ok(measured.onset_ms >= 1.9 && measured.onset_ms <= 3);
  assert.equal(measured.duration_ms, 200);
  assert.ok(toDb(0.5) < -6 && toDb(0.5) > -6.1);
  const wav = encodeWav([new Float32Array([0, 0.5, -0.5])], SR);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), SR);
  assert.equal(wav.readInt16LE(46), Math.round(0.5 * 32767));
});
