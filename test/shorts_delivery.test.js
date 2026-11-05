import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveDeliveryProfile, SHORTS_SAFE_ZONE } from "../src/production_profiles.js";
import { chunkWords, captionRuntime } from "../skills/launchclip-create-video/scripts/word-captions.mjs";
import { SFX, bedExpressions } from "../src/scripts/synth-audio-kit.mjs";
import { parseEbur128Summary, parseLoudnormJson } from "../src/scripts/master-loudness.mjs";
import { AMBIENCE_DUCK, MUSIC_DUCK, duckSettings, mixGraph, normalizeCues } from "../src/scripts/build-mix.mjs";
import { evidenceSchedule } from "../src/scripts/build-evidence.mjs";

const root = path.resolve(import.meta.dirname, "..");
const words = (text, step = 0.3) => text.split(" ").map((word, index) => ({ text: word, start: index * step, end: index * step + step * 0.8 }));

test("resolves the Shorts delivery floor only for portrait short-form", () => {
  const short = resolveDeliveryProfile({ aspect: { orientation: "portrait" }, durationSeconds: 30 });
  assert.equal(short.platform, "youtube-shorts");
  assert.equal(short.captions.default, true);
  assert.equal(short.loop_ending, true);
  assert.deepEqual(short.safe_zone, SHORTS_SAFE_ZONE);
  const landscape = resolveDeliveryProfile({ aspect: { orientation: "landscape" }, durationSeconds: 30 });
  assert.equal(landscape.captions.default, false);
  assert.equal(landscape.loudness.integrated_lufs, -14);
});

test("chunks captions into one-to-three words that break at sentences and pauses", () => {
  const chunks = chunkWords([...words("Coffee cools fast, then slow."), { text: "Newton", start: 3, end: 3.3 }]);
  assert.deepEqual(chunks.map((chunk) => chunk.words.map((word) => word.text).join(" ")), ["Coffee cools fast,", "then slow.", "Newton"]);
  assert.ok(chunks.every((chunk) => chunk.words.length <= 3));
  assert.ok(chunks[0].end <= chunks[1].start, "a chunk holds until the next one starts, never past it");
});

test("caption runtime is seek-safe and never animates visibility", () => {
  const runtime = captionRuntime(chunkWords(words("Big gap, fast.")));
  assert.match(runtime, /window\.mountCaptions/);
  assert.doesNotMatch(runtime, /autoAlpha|visibility|Math\.random|Date\.now/);
  assert.doesNotMatch(runtime, /color: 'var\(/, "GSAP cannot tween CSS variable colour strings");
});

test("procedural audio kit covers the cue vocabulary with deterministic expressions", () => {
  assert.deepEqual(Object.keys(SFX).sort(), ["impact", "pop", "riser", "shimmer", "subdrop", "tick", "whoosh"]);
  for (const spec of Object.values(SFX)) assert.doesNotMatch(spec.expr.join("|"), /Math\.random/);
  const bed = bedExpressions({ seconds: 30, bpm: 120, kickFrom: 10, kickTo: 20 });
  assert.equal(bed.beat, 0.5);
  assert.match(bed.kick, /between\(t,10,20\)/);
});

test("parses two-pass loudnorm measurements", () => {
  const parsed = parseLoudnormJson('noise\n{\n "input_i" : "-19.2",\n "input_tp" : "-3.1",\n "target_offset" : "0.1"\n}\n');
  assert.equal(parsed.input_i, "-19.2");
  assert.deepEqual(parseEbur128Summary("  Integrated loudness:\n    I:         -14.1 LUFS\n  True peak:\n    Peak:       -0.8 dBFS\n"), { integrated_lufs: -14.1, true_peak_dbtp: -0.8 });
});

test("subscription skill links the Shorts delivery floor", async () => {
  const skill = await readFile(path.join(root, "skills/launchclip-create-video/SKILL.md"), "utf8");
  const reference = await readFile(path.join(root, "skills/launchclip-create-video/references/shorts-delivery.md"), "utf8");
  assert.match(skill, /references\/shorts-delivery\.md/);
  assert.match(reference, /−14 LUFS/);
  assert.match(reference, /word-captions\.mjs/);
  assert.match(reference, /synth-audio-kit\.mjs/);
});

test("builds a ducked mix graph with event-bound SFX", () => {
  const cues = normalizeCues([{ cue: "whoosh", at: 5.72, volume: 0.5 }, { file: "hit.wav", at: 1 }], "sfx");
  assert.equal(cues[0].file, path.resolve("sfx/whoosh.wav"));
  assert.equal(cues[1].cue, "hit");
  const graph = mixGraph({ cues, duration: 10, hasVoice: true, hasMusic: true });
  assert.match(graph, /sidechaincompress/);
  assert.match(graph, /\[2\]adelay=5720:all=1,volume=0\.5\[s0\]/);
  assert.match(graph, /amix=inputs=4:normalize=0/);
  assert.doesNotMatch(mixGraph({ cues: [], duration: 10, hasVoice: false, hasMusic: true }), /sidechaincompress/);
  assert.throws(() => normalizeCues([{ cue: "tick" }], "sfx"), /non-negative "at"/);
  // An offset starts the file part-way in (a tally fitted to a short count).
  const fitted = normalizeCues([{ cue: "tally", at: 2, volume: 0.16, offset: 0.6 }], "sfx");
  assert.match(mixGraph({ cues: fitted, duration: 10, hasVoice: false, hasMusic: false }), /\[0\]atrim=start=0\.6,asetpts=PTS-STARTPTS,afade=t=in:d=0\.004,adelay=2000:all=1,volume=0\.16\[s0\]/);
});

test("a speech key ducks the bed without being mixed in", () => {
  const graph = mixGraph({ cues: [], duration: 9, hasVoice: false, hasMusic: true, hasKey: true, keySegments: [{ sourceStart: 1, duration: 4 }, { sourceStart: 6, duration: 5 }] });
  assert.match(graph, /\[0\]atrim=start=1:duration=4,asetpts=PTS-STARTPTS\[kc0\];\[0\]atrim=start=6:duration=5,asetpts=PTS-STARTPTS\[kc1\];\[kc0\]\[kc1\]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo\[key\]/);
  assert.match(graph, /\[1\]volume=0\.42\[bedraw\]/);
  assert.match(graph, /\[bedraw\]\[keypad\]sidechaincompress/);
  assert.match(graph, /\[bed\]amix=inputs=1:/, "the key itself is not in the mix");
  // A voice keys as before; the key is then ignored.
  assert.equal(mixGraph({ cues: [], duration: 9, hasVoice: true, hasMusic: true }), mixGraph({ cues: [], duration: 9, hasVoice: true, hasMusic: true, hasKey: false }));
  assert.match(mixGraph({ cues: [], duration: 9, hasVoice: false, hasMusic: true, hasKey: true }), /\[0\]anull,aformat=channel_layouts=stereo\[key\]/);
});

test("derives the phase-2 evidence schedule from declared boundaries", () => {
  const html = '<div id="root" data-composition-id="main" data-duration="12"><div data-launchclip-sequence-id="b" data-launchclip-boundary-id="b1" data-launchclip-transition-kind="shared-world" data-launchclip-transition-start="5" data-launchclip-transition-duration="0.5"></div></div>';
  const schedule = evidenceSchedule(html);
  assert.equal(schedule.entries.filter((entry) => entry.boundary_id === "b1").length, 7);
  assert.equal(schedule.final_hold.at_seconds, 11.95);
  assert.throws(() => evidenceSchedule("<div></div>"), /data-duration/);
});

test("the music ducks about 12 dB under a voice, not out of hearing", () => {
  const graph = mixGraph({ cues: [], duration: 10, hasVoice: true, hasMusic: true, hasAmbience: true });
  assert.match(graph, /\[bedraw\]\[keypad\]sidechaincompress=threshold=0\.1:ratio=3:attack=30:release=400:makeup=1\[bed\]/);
  assert.match(graph, /\[ambraw\]\[akeypad\]sidechaincompress=threshold=0\.1:ratio=2\.5:attack=40:release=600:makeup=1\[amb\]/);
  // A voice at about -17.5 dBFS sits ~2.5 dB over a 0.1 (-20 dB) threshold, so the duck takes
  // only a few dB off the bed and the bed's own volume keeps it ~12 dB under the voice.
  const reduction = (thresholdDb, voiceDb, ratio) => (voiceDb - thresholdDb) * (1 - 1 / ratio);
  const db = (gain) => 20 * Math.log10(gain);
  assert.ok(reduction(db(MUSIC_DUCK.threshold), -17.5, MUSIC_DUCK.ratio) < 2);
  assert.ok(AMBIENCE_DUCK.ratio <= MUSIC_DUCK.ratio);
});

test("--music-duck sets the depth: a share of the bed's level in pauses, 1 for none", () => {
  assert.equal(duckSettings(null), MUSIC_DUCK);
  assert.equal(duckSettings(1), null);
  const deep = duckSettings(0.2);
  const mid = duckSettings(0.42);
  // A deeper duck starts lower: the voice sits further over its threshold.
  assert.ok(deep.threshold < mid.threshold && mid.threshold < duckSettings(0.7).threshold);
  assert.equal(mid.ratio, 4);
  assert.match(mixGraph({ cues: [], duration: 10, hasVoice: true, hasMusic: true, musicDuck: 0.42 }), new RegExp(`sidechaincompress=threshold=${mid.threshold}:ratio=4:`));
  const none = mixGraph({ cues: [], duration: 10, hasVoice: true, hasMusic: true, musicDuck: 1 });
  assert.doesNotMatch(none, /\[bedraw\]\[keypad\]sidechaincompress/);
  assert.match(none, /\[key\]anullsink;\[bedraw\]anull\[bed\]/);
});
