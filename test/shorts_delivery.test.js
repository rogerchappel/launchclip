import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveDeliveryProfile, SHORTS_SAFE_ZONE } from "../src/production_profiles.js";
import { chunkWords, captionRuntime } from "../skills/launchclip-create-video/scripts/word-captions.mjs";
import { SFX, bedExpressions } from "../skills/launchclip-create-video/scripts/synth-audio-kit.mjs";
import { parseEbur128Summary, parseLoudnormJson } from "../skills/launchclip-create-video/scripts/master-loudness.mjs";

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
