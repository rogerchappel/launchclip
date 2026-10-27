import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { bindCues, defaultCueFor } from "../src/finish.js";
import { guardCueTimbre, measureTimbre, timbreProblem } from "../src/sfx/timbre.js";
import { TALLY_LANDS_AT } from "../kit/core/sound/options.mjs";
import { mediaSkip } from "./helpers/media.js";

const SR = 48000;
const ROOT = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
// The families that sit under a voice on counts, data and payoffs.
const TONAL = ["tally", "riser", "tick", "pop", "shimmer", "click"];

// A deterministic noise source (no Math.random).
function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 * 2 - 1; };
}

const tone = (seconds, hz) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / SR));
const noise = (seconds, seed = 1) => { const next = rng(seed); return Float32Array.from({ length: Math.round(seconds * SR) }, () => 0.5 * next()); };
// A running mean of 6 keeps noise below about 4 kHz: a wash, not hiss.
const wash = (seconds) => { const raw = noise(seconds, 3); return raw.map((_, i) => raw.slice(Math.max(0, i - 5), i + 1).reduce((a, b) => a + b, 0) / 6); };
// A first difference tilts noise toward the top octave: hiss.
const hiss = (seconds) => { const raw = noise(seconds, 7); return raw.map((value, i) => (i ? value - raw[i - 1] : value)); };

test("measureTimbre tells a tone, a noise wash and hiss apart", () => {
  const sine = measureTimbre([tone(1, 660)], SR);
  assert.ok(sine.hf_share < 0.05 && sine.flatness < 0.01, JSON.stringify(sine));
  const washed = measureTimbre([wash(1.2)], SR);
  assert.ok(washed.hf_share < 0.5 && washed.flatness > 0.05 && washed.loud_seconds > 1, JSON.stringify(washed));
  const top = measureTimbre([hiss(0.2)], SR);
  assert.ok(top.hf_share > 0.6, JSON.stringify(top));
});

test("timbreProblem refuses hiss everywhere and a noise wash outside the airy families", () => {
  const washed = measureTimbre([wash(1.2)], SR);
  assert.match(timbreProblem("riser", washed), /noise wash/);
  assert.match(timbreProblem("tally", washed), /noise wash/);
  assert.equal(timbreProblem("whoosh", washed), null);
  assert.match(timbreProblem("tick", measureTimbre([hiss(0.12)], SR)), /hiss/);
  assert.match(timbreProblem("whoosh", { hf_share: 0.9, flatness: 0.2, loud_seconds: 0.3 }), /hiss/);
  // A short noisy click is not a wash.
  assert.equal(timbreProblem("tick", measureTimbre([wash(0.05)], SR)), null);
  assert.equal(timbreProblem("tally", measureTimbre([tone(1.4, 880)], SR)), null);
});

test("guardCueTimbre swaps a failing file for a passing variant, else drops the cue", async () => {
  const library = { scope: "user", dir: "/lib", manifest: { families: { riser: { variants: [{ file: "riser/riser-1.wav" }, { file: "riser/riser-2.wav" }] } } } };
  const kit = { dir: "/kit", families: { riser: ["riser.wav"], tick: ["tick.wav"] } };
  const verdicts = { "/lib/riser/riser-1.wav": "wash", "/lib/riser/riser-2.wav": "wash", "/kit/riser.wav": "ok", "/kit/tick.wav": "hiss" };
  const timbre = { wash: { hf_share: 0.2, flatness: 0.2, loud_seconds: 1 }, hiss: { hf_share: 0.95, flatness: 0.02, loud_seconds: 0.1 }, ok: { hf_share: 0, flatness: 0, loud_seconds: 1 } };
  const { cues, findings } = await guardCueTimbre([
    { cue: "riser", at: 2, file: "/lib/riser/riser-1.wav", source: "module-event" },
    { cue: "tick", at: 3, file: "/kit/tick.wav", source: "hit" },
    { cue: "pop", at: 4, file: "/kit/pop.wav", source: "hit" }
  ], { libraries: [library], kit, measure: async (file) => timbre[verdicts[file] ?? "ok"] });
  assert.deepEqual(cues.map((cue) => [cue.cue, cue.file]), [["riser", "/kit/riser.wav"], ["pop", "/kit/pop.wav"]]);
  assert.deepEqual(findings.map((finding) => [finding.cue, finding.replacement]), [["riser", "/kit/riser.wav"], ["tick", null]]);
  assert.match(findings[1].problem, /hiss/);
});

test("counts and builds get a tonal tally that lands on the moment", () => {
  assert.equal(defaultCueFor("count"), "tally");
  assert.equal(defaultCueFor("bar-build"), "tally");
  assert.equal(defaultCueFor("tension"), "riser");
  const story = { format: { width: 1080, height: 1920, fps: 30, duration: 10 }, resolved: { duration: 10, fps: 30, frames: 300 }, scenes: [{ id: "s1", module: "x", start: 0, end: 10, hits: [] }] };
  const models = { s1: { id: "s1", events: [{ id: "s1-count", name: "count", time: 2, endTime: 4, cue: "tally" }] } };
  const { cues } = bindCues(story, { models });
  assert.deepEqual(cues.map((cue) => [cue.cue, cue.at]), [["tally", 4 - TALLY_LANDS_AT]]);
});

test("rendered: the kit's tonal families pass the timbre guard in every palette", { skip: mediaSkip(), timeout: 600_000 }, async () => {
  const { decodeAudio } = await import("../src/sfx/process.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-timbre-"));
  try {
    const kit = path.join(ROOT, "skills/launchclip-create-video/scripts/synth-audio-kit.mjs");
    for (const palette of [null, "industrial", "cinematic", "glassy", "retro-8bit"]) {
      const out = path.join(dir, palette ?? "neutral");
      await execFileAsync(process.execPath, [kit, out, ...(palette ? ["--palette", palette, "--seed", "t1", "--only", TONAL.join(",")] : ["--with", "tally"])], { maxBuffer: 1 << 26 });
      const manifest = JSON.parse(await readFile(path.join(out, "AUDIO-KIT.json"), "utf8"));
      for (const cue of manifest.sfx.filter((entry) => TONAL.includes(entry.family))) {
        const { channels, sampleRate } = await decodeAudio(cue.file);
        assert.equal(timbreProblem(cue.family, measureTimbre(channels, sampleRate)), null, `${palette ?? "neutral"} ${cue.name}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
