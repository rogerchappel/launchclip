import assert from "node:assert/strict";
import test from "node:test";
import { fcpTime, fcpTimeToFrames, framesToTimecode, parseRate, secondsToFrames, timecodeToFrames } from "../src/nle/time.js";
import { buildTimeline, checkTimeline, overlayPlan, packLanes, timelineSummary } from "../src/nle/timeline.js";
import { SMALL_MODELS, longMotionMedia, longMotionStory, smallFootageStory, smallMedia } from "./fixtures/nle/small-story.mjs";

test("parseRate: exact integer and NTSC rates", () => {
  assert.deepEqual(pick(parseRate(30)), { num: 30, den: 1, timebase: 30, ntsc: false, dropFrame: false });
  assert.deepEqual(pick(parseRate("29.97")), { num: 30000, den: 1001, timebase: 30, ntsc: true, dropFrame: true });
  assert.deepEqual(pick(parseRate("30000/1001", { dropFrame: false })), { num: 30000, den: 1001, timebase: 30, ntsc: true, dropFrame: false });
  assert.deepEqual(pick(parseRate(23.976)), { num: 24000, den: 1001, timebase: 24, ntsc: true, dropFrame: false });
  assert.deepEqual(pick(parseRate("59.94")), { num: 60000, den: 1001, timebase: 60, ntsc: true, dropFrame: true });
  for (const fps of [24, 25, 60]) assert.equal(parseRate(fps).timebase, fps);
  assert.throws(() => parseRate("12.5"), /Unsupported frame rate/);
});

test("drop-frame timecode skips frames 00 and 01 each minute except every tenth", () => {
  const df = parseRate("29.97");
  assert.equal(framesToTimecode(0, df), "00:00:00;00");
  assert.equal(framesToTimecode(1799, df), "00:00:59;29");
  assert.equal(framesToTimecode(1800, df), "00:01:00;02");
  assert.equal(framesToTimecode(17982, df), "00:10:00;00");
  assert.equal(framesToTimecode(17981, df), "00:09:59;29");
  assert.equal(framesToTimecode(107892, df), "01:00:00;00");
  assert.equal(framesToTimecode(1800, parseRate(30)), "00:01:00:00");
  const df60 = parseRate("59.94");
  assert.equal(framesToTimecode(3600, df60), "00:01:00;04");
  for (const rate of [df, df60, parseRate(25), parseRate(24), parseRate("29.97", { dropFrame: false })]) {
    for (let frame = 0; frame < 40000; frame += 37) assert.equal(timecodeToFrames(framesToTimecode(frame, rate), rate), frame);
  }
});

test("FCPXML rational times are exact and reduced", () => {
  const ntsc = parseRate("29.97");
  assert.equal(fcpTime(0, ntsc), "0s");
  assert.equal(fcpTime(1, ntsc), "1001/30000s");
  assert.equal(fcpTime(30, ntsc), "1001/1000s");
  assert.equal(fcpTime(45, parseRate(30)), "3/2s");
  assert.equal(fcpTime(60, parseRate(30)), "2s");
  for (let frame = 0; frame < 5000; frame += 13) assert.equal(fcpTimeToFrames(fcpTime(frame, ntsc), ntsc), frame);
  assert.throws(() => fcpTimeToFrames("1/7s", parseRate(30)), /frame grid/);
  assert.equal(secondsToFrames(61, ntsc), 1828);
});

test("overlayPlan: scenes become alpha clips, cameras become markers, track 0 keeps its plate", () => {
  const plan = overlayPlan(smallFootageStory(), { models: SMALL_MODELS });
  assert.deepEqual(plan.clips.map((clip) => [clip.key, clip.track, clip.start, clip.end, clip.plate]), [
    ["insert", 0, 3, 4.5, true],
    ["callout", 1, 0.5, 2.5, false],
    ["tail", 1, 4, 6, false]
  ]);
  assert.deepEqual(plan.cameras.map((camera) => camera.sceneId), ["cam"]);
});

test("buildTimeline: footage-led base segments point at the recording with in points", () => {
  const timeline = buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS });
  assert.deepEqual(checkTimeline(timeline), []);
  assert.equal(timeline.duration, 180);
  const v1 = timeline.tracks.find((track) => track.id === "V1");
  assert.deepEqual(v1.clips.map((clip) => [clip.start, clip.duration, clip.in]), [[0, 60, 0], [60, 120, 90]]);
  const base = timeline.assets.find((asset) => asset.id === v1.clips[0].asset);
  assert.equal(base.path, "media/rec.mp4");
  assert.equal(base.duration, 240);
  // A1 is the recording's own audio, linked to V1.
  const a1 = timeline.tracks.find((track) => track.id === "A1");
  assert.equal(a1.role, "dialogue");
  assert.deepEqual(a1.clips.map((clip) => [clip.start, clip.duration, clip.in, clip.linked]), [[0, 60, 0, v1.clips[0].id], [60, 120, 90, v1.clips[1].id]]);
  assert.deepEqual(timeline.tracks.map((track) => `${track.id}:${track.name}:${track.enabled}`), [
    "V1:Base footage:true", "V2:Inserts:true", "V3:Overlays 1:true", "V4:Finished render (reference):false",
    "A1:Dialogue (recording):true", "A2:Music:true", "A3:SFX 1:true", "A4:SFX 2:true", "A5:Mix (reference):false"
  ]);
});

test("buildTimeline: overlays, SFX lanes, captions and markers", () => {
  const timeline = buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS });
  const track = (id) => timeline.tracks.find((entry) => entry.id === id);
  assert.deepEqual(track("V2").clips.map((clip) => [clip.sceneId, clip.start, clip.duration]), [["insert", 90, 45]]);
  assert.deepEqual(track("V3").clips.map((clip) => [clip.sceneId, clip.start, clip.duration]), [["callout", 15, 60], ["tail", 120, 60]]);
  assert.equal(timeline.assets.find((asset) => asset.name === "callout").path, "media/overlays/callout.mov");
  // The whoosh (0.9 s, 0.62 s long) overlaps the tick at 1.0 s: two SFX lanes.
  assert.deepEqual(track("A3").clips.map((clip) => [clip.name, clip.start, clip.duration, clip.volume]), [["sfx-01-whoosh", 27, 18, 0.4], ["sfx-03-tick", 124, 4, 0.3]]);
  assert.deepEqual(track("A4").clips.map((clip) => [clip.name, clip.start]), [["sfx-02-tick", 30]]);
  assert.equal(track("A3").role, "effects");
  assert.equal(track("A2").clips[0].volume, 0.28);
  // One shared tick asset for both tick cues.
  assert.equal(timeline.assets.filter((asset) => asset.name === "tick").length, 1);
  assert.deepEqual(timeline.captions.clips.map((clip) => [clip.start, clip.duration, clip.text]), [[9, 27, "Hello & welcome"], [36, 24, "from <LaunchClip>"], [123, 42, "Try it"]]);
  assert.deepEqual(timeline.markers.map((marker) => `${marker.frame}:${marker.kind}:${marker.name}`), [
    "15:scene:callout", "30:scene:cam", "30:camera:cam: camera", "30:hit:callout: point", "90:scene:insert", "105:hit:insert: hit", "120:scene:tail"
  ]);
  assert.ok(timeline.warnings.some((warning) => /camera move/.test(warning)));
  assert.ok(timeline.warnings.some((warning) => /snapped to the nearest frame/.test(warning)));
  assert.ok(timeline.warnings.some((warning) => /720x1280|base.fit/.test(warning)) === false, "same aspect: no conform warning");
  assert.match(timelineSummary(timeline), /V1 {3}Base footage \[video\]: 2 clips/);
});

test("buildTimeline: --overlays none enables the finished render as the picture", () => {
  const timeline = buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS, overlays: "none" });
  assert.deepEqual(checkTimeline(timeline), []);
  const videos = timeline.tracks.filter((track) => track.kind === "video");
  assert.deepEqual(videos.map((track) => [track.id, track.name, track.enabled]), [["V1", "Base footage", true], ["V2", "Finished render", true]]);
  assert.equal(videos[1].clips[0].videoOnly, true);
});

test("buildTimeline: motion lane plate, staircase lanes for transitions, 29.97 frames", () => {
  const story = longMotionStory();
  const timeline = buildTimeline(story, longMotionMedia(), { name: "long", rate: "29.97", models: { s1: {}, s2: {} } });
  assert.deepEqual(checkTimeline(timeline), []);
  assert.equal(timeline.rate.dropFrame, true);
  assert.equal(timeline.duration, secondsToFrames(70, timeline.rate));
  assert.equal(timeline.duration, 2098);
  const videos = timeline.tracks.filter((track) => track.kind === "video");
  assert.deepEqual(videos.map((track) => track.name), ["Plate", "Scenes 1", "Scenes 2"]);
  // s1 stays on screen through s2's 0.5 s fade; s2 draws above it.
  assert.deepEqual(videos[1].clips.map((clip) => [clip.sceneId, clip.start, clip.duration]), [["s1", 0, secondsToFrames(61.5, timeline.rate)]]);
  assert.deepEqual(videos[2].clips.map((clip) => [clip.sceneId, clip.start, clip.duration]), [["s2", 1828, 270]]);
  assert.equal(timeline.tracks.find((track) => track.id === "A1").name, "Voice");
});

test("packLanes: stacked packing climbs above every overlapping clip", () => {
  const items = [{ start: 0, end: 10 }, { start: 8, end: 20 }, { start: 18, end: 30 }, { start: 40, end: 50 }];
  assert.deepEqual(packLanes(items).map((lane) => lane.length), [3, 1]);
  assert.deepEqual(packLanes(items, { stack: true }).map((lane) => lane.map((item) => item.start)), [[0, 40], [8], [18]]);
});

test("checkTimeline flags overlaps, fractional frames and clips past their asset", () => {
  const timeline = buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS });
  const v3 = timeline.tracks.find((track) => track.id === "V3");
  v3.clips[1].start = 40;
  v3.clips[0].in = 0.5;
  timeline.tracks.find((track) => track.id === "V1").clips[1].in = 200;
  const problems = checkTimeline(timeline).join("\n");
  assert.match(problems, /overlaps/);
  assert.match(problems, /not a whole frame/);
  assert.match(problems, /runs past rec.mp4/);
});

function pick(rate) {
  return { num: rate.num, den: rate.den, timebase: rate.timebase, ntsc: rate.ntsc, dropFrame: rate.dropFrame };
}
