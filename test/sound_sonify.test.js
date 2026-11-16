// Sound phase 4 (docs/IMMERSIVE_SOUND_RFC.md §5, §8): the Karplus-Strong pluck
// and chart sonification. The pluck is deterministic and in tune, every note
// lands within one frame of the data point it plays, and a mix carrying the
// sonification still masters to −14 LUFS / −1 dBTP.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MODULES, VARIANTS, catalogHTimeline } from "@launchclip/core/catalog-h.mjs";
import { frameState } from "@launchclip/core/catalog-b-view.mjs";
import { karplusStrong } from "@launchclip/core/sound/music.mjs";
import { SONIFY_MODULES, chartNotes, pitchSemitones, renderSonification } from "@launchclip/core/sound/sonify.mjs";
import { soundProblems } from "@launchclip/core/sound/options.mjs";
import { SAMPLES } from "../scripts/element-samples.mjs";
import { writeWavFile } from "../src/sfx/process.js";
import { masterLoudness } from "../src/scripts/master-loudness.mjs";

const brand = { colors: { bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const FPS = 30;
const ctx = (aspect) => ({ id: "s", start: 1, duration: 5, format: aspect === "16:9" ? { width: 1920, height: 1080, fps: FPS } : { width: 1080, height: 1920, fps: FPS }, brand, aspect, hits: [] });
const chart = (id, variant, aspect = "9:16") => {
  const params = { ...SAMPLES[id], variant };
  return { params, model: { ...MODULES[id].resolve(params, ctx(aspect)), module: id } };
};
const bytes = (samples) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

test("the pluck is deterministic for its arguments, in tune and dies away", () => {
  const a = karplusStrong({ f: 220, dur: 0.6, vel: 0.8, seed: "x" });
  assert.ok(bytes(a).equals(bytes(karplusStrong({ f: 220, dur: 0.6, vel: 0.8, seed: "x" }))), "same seed, same samples");
  assert.ok(!bytes(a).equals(bytes(karplusStrong({ f: 220, dur: 0.6, vel: 0.8, seed: "y" }))), "another seed, another burst");
  for (const f of [110, 220, 440]) {
    const s = karplusStrong({ f, dur: 1, vel: 0.8 });
    let best = 0, lag = 0;
    for (let L = 40; L < 600; L++) {
      let sum = 0;
      for (let i = 4800; i < 9600; i++) sum += s[i] * s[i + L];
      if (sum > best) { best = sum; lag = L; }
    }
    assert.ok(Math.abs(1200 * Math.log2(48000 / lag / f)) < 10, `${f} Hz measures ${48000 / lag} Hz`);
  }
  const rms = (from, to) => Math.sqrt(a.slice(from, to).reduce((sum, v) => sum + v * v, 0) / (to - from));
  assert.ok(Math.abs(Math.max(...a.map(Math.abs)) - 0.8) < 1e-6, "velocity sets the peak");
  assert.ok(rms(0, 2400) / rms(24000, 26400) > 300, "the string falls by ~60 dB over the note");
  assert.throws(() => karplusStrong({ f: 5, dur: 1 }), /f must be/);
});

test("pitch snaps to the pentatonic low, semitones in the middle, free at the top", () => {
  assert.equal(pitchSemitones(0), 0);
  assert.equal(pitchSemitones(0.2), 4);
  assert.ok([0, 2, 4, 7, 9, 12].includes(pitchSemitones(0.3)));
  assert.equal(pitchSemitones(0.5), 12);
  assert.ok(!Number.isInteger(pitchSemitones(0.9)));
});

// The visual each note plays: discrete elements' tween starts, or a reveal's progress.
const DISCRETE = { "bar-chart": /-bar-\d+$/, "stacked-bar": /-seg-\d+$/, "pie-chart": /-slice-\d+$/, "radar-chart": /-pt-\d+-\d+$/, sparkline: /-bar-\d+$/, "progress-ring": /-seg-\d+$/ };
const REVEAL = { "area-chart": ["-plot", (props) => 1 - props.clipR / 100], sparkline: ["-spark", (props) => 1 - props.clipR / 100], "progress-ring": ["-arc", (props) => 1 - props.strokeDashoffset] };

test("every note of every chart lands within one frame of the data point it plays", () => {
  const frame = 1 / FPS;
  for (const id of SONIFY_MODULES) for (const variant of VARIANTS[id]) for (const aspect of ["9:16", "16:9"]) {
    const { model, params } = chart(id, variant, aspect);
    const ops = catalogHTimeline(model);
    const { notes } = chartNotes(model, params, { key: "A" });
    assert.ok(notes.length >= 3, `${id}/${variant} plays its data`);
    // Radar's polygon and circles draw no dots; their arpeggio keeps the dots variant's times.
    const pointOps = id === "radar-chart" ? catalogHTimeline(chart(id, "dots", aspect).model) : ops;
    const starts = pointOps.filter((op) => op.type === "tween" && DISCRETE[id]?.test(op.target)).map((op) => op.start);
    const reveal = REVEAL[id] && ops.some((op) => op.target === `${model.id}${REVEAL[id][0]}`) ? REVEAL[id] : null;
    // The thresholds a reveal crosses: the x of each data point, or a tenth of the ring and its value.
    const points = id === "progress-ring" ? [...Array.from({ length: 10 }, (_, k) => (k + 1) / 10).filter((g) => g < model.content.frac - 0.05), model.content.frac]
      : id === "area-chart" ? params.labels.map((_, j) => j / (params.labels.length - 1)) : id === "sparkline" ? params.values.map((_, j) => j / (params.values.length - 1)) : [];
    for (const note of notes) {
      const label = `${id}/${variant} ${aspect} note at ${note.at}`;
      if (note.highlight) { assert.ok(Math.abs(note.at - model.content.highlightAt) <= frame, label); continue; }
      if (starts.length && !reveal) { assert.ok(starts.some((at) => Math.abs(at - note.at) <= frame), `${label}: no point draws within a frame`); continue; }
      assert.ok(reveal, `${label}: nothing to check against`);
      const drawn = (t) => REVEAL[id][1](frameState(ops, t).get(`${model.id}${REVEAL[id][0]}`));
      const before = drawn(note.at - frame), after = drawn(note.at + frame);
      assert.ok(points.some((x) => before - 1e-6 <= x && x <= after + 1e-3), `${label}: drawn ${before.toFixed(3)}–${after.toFixed(3)} passes no data point`);
    }
  }
});

test("the sonification renders the same bytes for a seed, peaks at −6 dBFS and starts on its first note", () => {
  const { model, params } = chart("bar-chart", "columns");
  const notes = chartNotes(model, params, { key: "D" });
  const a = renderSonification(notes, { seed: "story" });
  const b = renderSonification(notes, { seed: "story" });
  assert.ok(bytes(a.channels[0]).equals(bytes(b.channels[0])) && bytes(a.channels[1]).equals(bytes(b.channels[1])));
  assert.equal(a.start, Math.min(...notes.notes.map((note) => note.at)));
  const peak = a.channels.reduce((max, c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), max), 0);
  assert.ok(Math.abs(peak - 0.5) < 1e-6, `peak ${peak}`);
  assert.equal(chartNotes({ module: "count-up", content: {} }, {}), null, "only the seven charts sonify");
});

test("sound.sonify is a boolean in the sound block", () => {
  assert.deepEqual(soundProblems({ sonify: true }), []);
  assert.match(soundProblems({ sonify: "yes" })[0], /sonify/);
});

test("a clip carrying the sonification masters to −14 ± 1 LUFS and at most −1 dBTP after AAC", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-sonify-"));
  try {
    const pieces = ["bar-chart", "pie-chart", "sparkline"].map((id) => renderSonification(chartNotes(chart(id, VARIANTS[id][0]).model, SAMPLES[id], { key: "A" }), { seed: id }));
    const files = [];
    for (const [i, piece] of pieces.entries()) {
      files.push(path.join(dir, `s${i}.wav`));
      await writeWavFile(files[i], piece.channels);
    }
    // A quiet bed with the three charts on top, as finish mixes them.
    const clip = path.join(dir, "clip.mov");
    const inputs = files.flatMap((file) => ["-i", file]);
    const placed = files.map((_, i) => `[${i + 2}]adelay=${1000 + i * 2500}:all=1,volume=0.35[c${i}]`).join(";");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=9:r=30", "-f", "lavfi", "-i", "aevalsrc=0.05*sin(2*PI*110*t)|0.05*sin(2*PI*110*t):s=48000:d=9", ...inputs,
      "-filter_complex", `${placed};[1]${files.map((_, i) => `[c${i}]`).join("")}amix=inputs=${files.length + 1}:normalize=0:duration=first[a]`, "-map", "0:v", "-map", "[a]", "-t", "9", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "pcm_f32le", clip]);
    const result = await masterLoudness(clip, path.join(dir, "clip.mp4"));
    assert.ok(Math.abs(result.output.integrated_lufs + 14) <= 1, `${result.output.integrated_lufs} LUFS`);
    assert.ok(result.output.true_peak_dbtp <= -1, `${result.output.true_peak_dbtp} dBTP`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with sound.sonify a chart's build cues no tally (its sonification plays instead); without it nothing changes", async () => {
  const { bindCues, soundSettings } = await import("../src/finish.js");
  const { model } = chart("bar-chart", "columns");
  const story = { scenes: [{ id: "s", start: 1, duration: 5, hits: [] }], resolved: { duration: 10 } };
  const families = (sonify) => bindCues(story, { models: () => model, sonify }).cues.map((cue) => cue.cue);
  assert.ok(families(false).includes("tally"));
  assert.ok(!families(true).includes("tally"));
  assert.equal(soundSettings({}, { audio: { sound: { sonify: true } } }).sonify, true);
  assert.equal(soundSettings({}, {}).sonify, undefined, "off unless the story asks");
});
