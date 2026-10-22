import assert from "node:assert/strict";
import test from "node:test";
import { readEdl, readSrt, writeEdl, writeSrt } from "../src/nle/edl.js";
import { readOtio, writeOtio } from "../src/nle/otio.js";
import { framesToTimecode } from "../src/nle/time.js";
import { buildTimeline } from "../src/nle/timeline.js";
import { checkEdlRoundTrip, checkOtioRoundTrip } from "../src/nle/validate.js";
import { assertGolden } from "./fixtures/nle/golden.mjs";
import { SMALL_MODELS, longMotionMedia, longMotionStory, smallFootageStory, smallMedia } from "./fixtures/nle/small-story.mjs";

const small = () => buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS });
const long = () => buildTimeline(longMotionStory(), longMotionMedia(), { name: "long", rate: "29.97", models: { s1: {}, s2: {} } });

test("EDL and SRT golden snapshots of the small footage cut", () => {
  const timeline = small();
  const { edl, warnings } = writeEdl(timeline);
  assert.match(warnings.join(), /carries V1 only/);
  assertGolden("small.edl", edl);
  assertGolden("small.srt", writeSrt(timeline));
});

test("EDL round-trips V1 source and record timecode; SRT round-trips captions", () => {
  const timeline = small();
  const { edl } = writeEdl(timeline);
  const srt = writeSrt(timeline);
  assert.deepEqual(checkEdlRoundTrip(timeline, edl, srt), []);
  const read = readEdl(edl, timeline.rate);
  assert.equal(read.dropFrame, false);
  assert.deepEqual(read.events.map((event) => [event.reel, event.channels, ...event.timecodes]), [
    ["REC", "B", "00:00:00:00", "00:00:02:00", "00:00:00:00", "00:00:02:00"],
    ["REC", "B", "00:00:03:00", "00:00:07:00", "00:00:02:00", "00:00:06:00"]
  ]);
  assert.deepEqual(read.events[0].comments, ["FROM CLIP NAME: rec.mp4", "SOURCE FILE: media/rec.mp4"]);
  assert.equal(read.markers.length, timeline.markers.length);
  assert.deepEqual(readSrt(srt).map((entry) => [entry.start, entry.end, entry.text]), [[0.3, 1.2, "Hello & welcome"], [1.2, 2, "from <LaunchClip>"], [4.1, 5.5, "Try it"]]);
});

test("EDL at 29.97 is drop-frame across the minute boundary", () => {
  const timeline = long();
  const { edl } = writeEdl(timeline);
  assert.match(edl, /^FCM: DROP FRAME$/m);
  // V1 is the 70 s plate: 2098 frames. Frame numbers ;00 and ;01 of minute 1
  // are skipped, so drop-frame timecode reads wall-clock time, 00:01:10;00
  // (non-drop would drift to 00:01:09:28).
  assert.equal(framesToTimecode(2098, timeline.rate), "00:01:10;00");
  assert.equal(framesToTimecode(2098, { ...timeline.rate, dropFrame: false }), "00:01:09:28");
  assert.match(edl, /^001 {2}PLATE {4}V {5}C {8}00:00:00;00 00:01:10;00 00:00:00;00 00:01:10;00$/m);
  // The s2 scene marker at frame 1828 (61 s) reads 00:01:01;00 in drop-frame.
  assert.match(edl, /\* LOC: 00:01:01;00 BLUE {3}s2$/m);
  assertGolden("long-2997.edl", edl);
  assert.deepEqual(checkEdlRoundTrip(timeline, edl), []);
});

test("EDL fills V1 gaps with black so record timecode stays continuous", () => {
  const timeline = small();
  const v1 = timeline.tracks.find((track) => track.id === "V1");
  v1.clips[0].start = 10;
  v1.clips[0].duration = 50;
  const { edl } = writeEdl(timeline);
  const read = readEdl(edl, timeline.rate);
  assert.deepEqual(read.events.map((event) => [event.reel, event.recordIn, event.recordOut]), [["BL", 0, 10], ["REC", 10, 60], ["REC", 60, 180]]);
  assert.deepEqual(checkEdlRoundTrip(timeline, edl), []);
});

test("OTIO round-trips tracks, gaps, source ranges and markers", () => {
  for (const timeline of [small(), long()]) {
    const { otio } = writeOtio(timeline);
    assert.deepEqual(checkOtioRoundTrip(timeline, otio), []);
    const read = readOtio(otio);
    assert.equal(read.rate, timeline.rate.fps);
  }
  const doc = JSON.parse(writeOtio(small()).otio);
  assert.equal(doc.OTIO_SCHEMA, "Timeline.1");
  const v3 = doc.tracks.children[2];
  assert.deepEqual(v3.children.map((child) => child.OTIO_SCHEMA), ["Gap.1", "Clip.2", "Gap.1", "Clip.2"]);
  assert.equal(v3.children[1].media_references.DEFAULT_MEDIA.target_url, "media/overlays/callout.mov");
  assert.equal(doc.metadata.launchclip.captions.length, 3);
});
