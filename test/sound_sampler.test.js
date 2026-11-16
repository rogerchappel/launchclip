// Sound phase 5 (docs/IMMERSIVE_SOUND_RFC.md §1, §8): the sampler, the sample
// index, `sound fetch`, credits, and the offline fallback. No test downloads:
// zones are synthetic and fetch is injected.
import test from "node:test";
import { ffmpegMissing, mediaSkip } from "./helpers/media.js";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SAMPLED_INSTRUMENTS, SAMPLE_LIBRARIES } from "@launchclip/core/sound/instruments.mjs";
import { SAMPLED_GENRES, assignZones, creditsText, mixNotes, sampleCredits, sampledPlan, sustainLoop } from "@launchclip/core/sound/sampler.mjs";
import { genreBed } from "@launchclip/core/sound/music.mjs";
import { buildSampleIndex, fetchSamples, installedInstruments, readSampleIndex, resolveTarget } from "../src/music/samples.js";
import { synthGenreBed } from "../src/scripts/synth-audio-kit.mjs";

const RATE = 48000;
const tempDir = () => mkdtemp(path.join(os.tmpdir(), "launchclip-sampler-"));
const bytes = ([l, r]) => Buffer.concat([Buffer.from(l.buffer), Buffer.from(r.buffer)]);
const sine = (hz, seconds, amp = 0.5) => { const x = new Float32Array(Math.round(seconds * RATE)); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE); return [x, x.slice()]; };
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
/** Synthetic audio for any zone: a sine at its root (unpitched: a click). */
const fakeAudio = (seconds = 3) => {
  const cache = new Map();
  return (zone) => {
    if (!cache.has(zone.file)) cache.set(zone.file, zone.root == null ? sine(3000, 0.05) : sine(midiHz(zone.root), seconds));
    return cache.get(zone.file);
  };
};

test("the manifest pins every zone and maps only installed-able instruments", () => {
  for (const [name, spec] of Object.entries(SAMPLED_INSTRUMENTS)) {
    assert.ok(SAMPLE_LIBRARIES[spec.library], `${name}: library`);
    assert.ok(spec.zones.length, `${name}: zones`);
    for (const [file, sha, size, root, vel, rr] of spec.zones) {
      assert.match(sha, /^[0-9a-f]{64}$/, `${name} ${file}`);
      assert.ok(size > 0 && vel > 0 && vel <= 1 && rr >= 1 && (root === null || (root > 20 && root < 110)), `${name} ${file}`);
    }
  }
  for (const library of Object.values(SAMPLE_LIBRARIES)) assert.ok(library.licence && library.licence_url && library.home);
  for (const [genre, stems] of Object.entries(SAMPLED_GENRES)) {
    const names = genreBed({ genre }, "t").stems.map((entry) => entry.name);
    for (const [stem, [instrument]] of Object.entries(stems)) {
      assert.ok(names.includes(stem), `${genre} has a ${stem} stem`);
      assert.ok(SAMPLED_INSTRUMENTS[instrument], instrument);
    }
  }
  assert.deepEqual(resolveTarget("freepats-guitar"), ["nylon-guitar"]);
  assert.throws(() => resolveTarget("nope"), /Unknown sound fetch target/);
});

test("the index lists an instrument only when all its zones are on disk at their pinned size", async () => {
  const dir = await tempDir();
  try {
    assert.equal(readSampleIndex(dir), null);
    assert.equal(installedInstruments(dir).size, 0);
    const shaker = SAMPLED_INSTRUMENTS.shaker;
    for (const [file, , size] of shaker.zones) {
      const full = path.join(dir, shaker.library, ...file.split("/"));
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, Buffer.alloc(size));
    }
    const index = await buildSampleIndex(dir);
    assert.deepEqual(Object.keys(index.instruments), ["shaker"]);
    assert.equal(index.instruments.shaker.zones.length, 8);
    assert.deepEqual(index.libraries.map((library) => library.licence), ["CC0-1.0"]);
    assert.deepEqual([...installedInstruments(dir)], ["shaker"]);
    // A zone deleted after indexing: the instrument is no longer installed.
    await rm(path.join(dir, shaker.library, ...shaker.zones[0][0].split("/")));
    assert.equal(installedInstruments(dir).size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sound fetch asks first and keeps nothing whose SHA-256 does not match", async () => {
  const dir = await tempDir();
  try {
    let asked = null;
    const declined = await fetchSamples("shaker", { dir, confirm: (plan) => { asked = plan; return false; }, fetch: () => assert.fail("downloaded before the answer") });
    assert.equal(declined.cancelled, true);
    assert.equal(asked.files.length, 8);
    assert.ok(asked.bytes > 300000 && asked.bytes < 400000);
    const urls = [];
    const fetch = async (url) => { urls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) }; };
    await assert.rejects(fetchSamples("shaker", { dir, confirm: () => true, fetch }), /SHA-256/);
    assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/sgossner\/VSCO-2-CE\/[0-9a-f]{40}\/VSCO%201%20Percussion\//);
    assert.equal(existsSync(path.join(dir, "vsco2-ce")), false, "nothing kept");
    assert.equal(installedInstruments(dir).size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("zones: nearest root and layer, round robins take turns, transposition is in tune", () => {
  const notes = Array.from({ length: 4 }, (_, i) => ({ at: i * 0.25, dur: 0.1, f: 0, vel: 1 }));
  const shakes = assignZones({ notes, instrument: "shaker", seed: "s" }).map((pick) => pick.zone.rr);
  for (let i = 1; i < shakes.length; i++) assert.notEqual(shakes[i], shakes[i - 1], `round robin ${shakes}`);
  const [soft] = assignZones({ notes: [{ at: 0, dur: 1, f: 440, vel: 0.3 }, { at: 1, dur: 1, f: 440, vel: 1 }], instrument: "violins-sustain", dynamic: 0.5 });
  assert.equal(soft.zone.vel, 0.5, "the soft layer for a soft note");
  // 440 Hz on the violins (roots 69 = A4 exists): no shift.
  const [a4] = assignZones({ notes: [{ at: 0, dur: 1, f: 440, vel: 1 }], instrument: "violins-sustain", dynamic: 1 });
  assert.equal(a4.zone.root, 69);
  assert.ok(Math.abs(a4.ratio - 1) < 1e-9);
  // A note between roots is transposed onto pitch: count zero crossings.
  const f = midiHz(70.5);
  const picks = assignZones({ notes: [{ at: 0, dur: 1, f, vel: 1 }], instrument: "violins-sustain", dynamic: 1 });
  const [left] = mixNotes(picks, { cycle: 2, instrument: "violins-sustain", audio: fakeAudio() });
  let crossings = 0;
  for (let i = Math.round(0.2 * RATE); i < Math.round(0.8 * RATE); i++) if (left[i - 1] < 0 && left[i] >= 0) crossings++;
  assert.ok(Math.abs(crossings / 0.6 - f) < 3, `${crossings / 0.6} Hz vs ${f}`);
});

test("a sampled stem renders byte-identically for the same seed", () => {
  const bed = genreBed({ genre: "orchestral-lite", bpm: 100, key: "D", progression: 1 }, "seed-a");
  const render = () => bed.stems.filter((entry) => SAMPLED_GENRES["orchestral-lite"][entry.name]).map((entry) => {
    const [instrument, dynamic] = SAMPLED_GENRES["orchestral-lite"][entry.name];
    return bytes(mixNotes(assignZones({ notes: entry.notes, instrument, dynamic, seed: "seed-a" }), { cycle: bed.cycle, instrument, audio: fakeAudio() }));
  });
  const [a, b] = [render(), render()];
  assert.equal(a.length, 5);
  a.forEach((buffer, i) => assert.ok(buffer.equals(b[i]), `stem ${i}`));
  assert.ok(a.every((buffer) => buffer.some((byte) => byte !== 0)), "every sampled stem sounds");
});

test("a 10 s extended sustain drifts under 1.5 dB with no sample jump over 0.05", () => {
  // A steady bowed-like tone (partials plus a little seeded bow noise), 2 s long, stretched to 10 s.
  const x = new Float32Array(2 * RATE);
  const partials = [[220, 0.2], [440.4, 0.08], [661.1, 0.05], [882.3, 0.03]];
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  for (let i = 0; i < x.length; i++) {
    for (const [hz, amp] of partials) x[i] += amp * Math.sin((2 * Math.PI * hz * i) / RATE);
    x[i] += 0.02 * noise();
  }
  const [long] = sustainLoop([x, x], 10 * RATE);
  const window = RATE / 2;
  const levels = [];
  for (let start = 0; start + window <= 10 * RATE; start += window) {
    let sum = 0;
    for (let i = start; i < start + window; i++) sum += long[i] ** 2;
    levels.push(10 * Math.log10(sum / window));
  }
  assert.ok(Math.max(...levels) - Math.min(...levels) < 1.5, `drift ${(Math.max(...levels) - Math.min(...levels)).toFixed(2)} dB`);
  let jump = 0;
  for (let i = 1; i < 10 * RATE; i++) jump = Math.max(jump, Math.abs(long[i] - long[i - 1]));
  assert.ok(jump < 0.05, `jump ${jump}`);
});

test("credits: CC0 libraries get a thanks line naming the instruments; nothing used, no file", () => {
  const credits = sampleCredits(["nylon-guitar", "violins-sustain", "shaker", "violins-sustain"]);
  assert.deepEqual(credits.map((credit) => credit.library), ["freepats-guitar", "vsco2-ce"]);
  assert.deepEqual(credits[1].instruments, ["shaker", "violins-sustain"]);
  const text = creditsText(credits);
  assert.match(text, /With thanks \(public domain, no attribution required\):/);
  assert.match(text, /VS Chamber Orchestra: Community Edition, by Versilian Studios.*CC0 1\.0/);
  assert.match(text, /FreePats Spanish Classical Guitar/);
  assert.doesNotMatch(text, /Attribution \(required/);
  assert.equal(creditsText([]), "");
});

test("offline: a sampled genre with nothing fetched renders on synth and says so once", { skip: mediaSkip(ffmpegMissing()) }, async () => {
  const dir = await tempDir();
  try {
    assert.deepEqual(sampledPlan(genreBed({ genre: "acoustic-pluck" }, "t"), new Set()).stems, {});
    assert.deepEqual(sampledPlan(genreBed({ genre: "house" }, "t"), new Set()), { stems: {}, missing: [] });
    const out = path.join(dir, "music");
    await mkdir(out);
    const bed = await synthGenreBed(out, { seconds: 3, genre: "acoustic-pluck", bpm: 110, key: "G", progression: 0, instruments: path.join(dir, "no-samples") });
    assert.ok(existsSync(bed.file));
    assert.deepEqual(bed.instruments, {});
    assert.deepEqual(bed.credits, []);
    assert.match(bed.fallback, /acoustic-pluck plays synth in place of nylon-guitar, violins-sustain, contrabass-pizz, shaker.*launchclip sound fetch core/);
    assert.ok((await readFile(bed.file)).length > 3 * RATE * 2 * 2 * 0.9);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
