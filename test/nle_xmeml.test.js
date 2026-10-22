import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline } from "../src/nle/timeline.js";
import { checkXmemlRoundTrip } from "../src/nle/validate.js";
import { parseXml } from "../src/nle/xml.js";
import { readXmeml, writeXmeml } from "../src/nle/xmeml.js";
import { assertGolden } from "./fixtures/nle/golden.mjs";
import { SMALL_MODELS, longMotionMedia, longMotionStory, smallFootageStory, smallMedia } from "./fixtures/nle/small-story.mjs";

const small = () => buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS });

test("xmeml golden snapshot of the small footage cut", () => {
  const { xml, warnings } = writeXmeml(small());
  assert.deepEqual(warnings, []);
  assertGolden("small.xml", xml);
});

test("xmeml is well-formed and round-trips start/end/in/out on every track", () => {
  const timeline = small();
  const { xml } = writeXmeml(timeline);
  const { root, doctype } = parseXml(xml);
  assert.equal(doctype, "xmeml");
  assert.equal(root.attributes.version, "4");
  assert.deepEqual(checkXmemlRoundTrip(timeline, xml), []);
  const read = readXmeml(xml);
  assert.equal(read.video.length, 4);
  assert.equal(read.audio.length, 5);
  assert.deepEqual(read.video[0].clips.map((clip) => [clip.start, clip.end, clip.in, clip.out, clip.pathurl]), [[0, 60, 0, 60, "media/rec.mp4"], [60, 180, 90, 210, "media/rec.mp4"]]);
  // Each file is described once and referenced by id afterwards.
  assert.equal((xml.match(/<pathurl>media\/rec.mp4<\/pathurl>/g) ?? []).length, 1);
  // Overlays declare straight alpha; the reference track is disabled.
  assert.equal(read.video[2].clips[0].alphatype, "straight");
  assert.equal(read.video[3].enabled, false);
  assert.equal(read.audio[4].enabled, false);
});

test("xmeml links each base clip to its recording audio on A1", () => {
  const { xml } = writeXmeml(small());
  const read = readXmeml(xml);
  const [video] = read.video[0].clips;
  const [audio] = read.audio[0].clips;
  assert.deepEqual(video.links, [video.id, audio.id]);
  assert.deepEqual(audio.links, [video.id, audio.id]);
  assert.match(xml, /<parameterid>level<\/parameterid>[\s\S]*?<value>0.28<\/value>/);
});

test("xmeml at 29.97 uses timebase 30, ntsc TRUE and drop-frame timecode", () => {
  const timeline = buildTimeline(longMotionStory(), longMotionMedia(), { name: "long", rate: "29.97", models: { s1: {}, s2: {} } });
  const { xml } = writeXmeml(timeline);
  assert.match(xml, /<timebase>30<\/timebase>\s*<ntsc>TRUE<\/ntsc>/);
  assert.match(xml, /<string>00:00:00;00<\/string>/);
  assert.match(xml, /<displayformat>DF<\/displayformat>/);
  assert.deepEqual(checkXmemlRoundTrip(timeline, xml), []);
  const read = readXmeml(xml);
  assert.equal(read.rate.num, 30000);
  assert.equal(read.rate.den, 1001);
  assert.equal(read.duration, 2098);
  assert.deepEqual(read.video[2].clips.map((clip) => [clip.start, clip.end]), [[1828, 2098]]);
});

test("xmeml round-trip check notices a shifted clip", () => {
  const timeline = small();
  const { xml } = writeXmeml(timeline);
  const broken = xml.replace("<start>60</start>", "<start>61</start>");
  assert.match(checkXmemlRoundTrip(timeline, broken).join(), /start 61 != 60/);
});

test("xmeml absolute paths use file://localhost URLs", () => {
  const timeline = small();
  const { xml } = writeXmeml(timeline, { absolute: "/tmp/exp" });
  assert.match(xml, /<pathurl>file:\/\/localhost\/tmp\/exp\/media\/rec.mp4<\/pathurl>/);
  assert.deepEqual(checkXmemlRoundTrip(timeline, xml, { absolute: "/tmp/exp" }), []);
});
