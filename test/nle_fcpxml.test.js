import assert from "node:assert/strict";
import test from "node:test";
import { readFcpxml, validateFcpxml, writeFcpxml } from "../src/nle/fcpxml.js";
import { buildTimeline } from "../src/nle/timeline.js";
import { checkFcpxmlRoundTrip } from "../src/nle/validate.js";
import { parseXml } from "../src/nle/xml.js";
import { assertGolden } from "./fixtures/nle/golden.mjs";
import { SMALL_MODELS, longMotionMedia, longMotionStory, smallFootageStory, smallMedia } from "./fixtures/nle/small-story.mjs";

const small = () => buildTimeline(smallFootageStory(), smallMedia(), { name: "small", models: SMALL_MODELS });

test("FCPXML golden snapshot of the small footage cut", () => {
  const { xml, warnings } = writeFcpxml(small());
  assert.deepEqual(warnings, []);
  assertGolden("small.fcpxml", xml);
});

test("FCPXML is well-formed, structurally valid and round-trips frame for frame", () => {
  const timeline = small();
  const { xml } = writeFcpxml(timeline);
  assert.doesNotThrow(() => parseXml(xml));
  assert.deepEqual(validateFcpxml(xml), []);
  assert.deepEqual(checkFcpxmlRoundTrip(timeline, xml), []);
});

test("FCPXML connected clips use the parent's local time", () => {
  const { xml } = writeFcpxml(small());
  const { root } = parseXml(xml);
  const spine = root.children.find((node) => node.name === "library").children[0].children[0].children[0].children[0];
  const [first, second] = spine.children;
  // V1 segment 2 starts at timeline frame 60 with source in 90 (3 s).
  assert.equal(second.attributes.offset, "2s");
  assert.equal(second.attributes.start, "3s");
  // The insert at timeline 3 s → local 3 + (3 - 2) = 4 s inside segment 2.
  const insert = second.children.find((node) => node.attributes.name === "insert · count-up");
  assert.equal(insert.attributes.offset, "4s");
  assert.equal(insert.attributes.lane, "1");
  // Audio lanes are negative and carry roles; captions sit above the video lanes.
  const music = first.children.find((node) => node.attributes.name === "music bed");
  assert.equal(music.attributes.lane, "-2");
  assert.equal(music.attributes.audioRole, "music");
  assert.equal(music.children[0].name, "adjust-volume");
  const caption = first.children.find((node) => node.name === "caption");
  assert.equal(caption.attributes.role, "SRT?captionFormat=SRT.en");
  assert.equal(caption.attributes.lane, "4");
  // The reference render and the reference mix are disabled.
  const render = first.children.find((node) => node.attributes.name === "finished render");
  assert.equal(render.attributes.enabled, "0");
  assert.equal(render.attributes.srcEnable, "video");
  // The base clip carries the dialogue role (its A1 audio is not duplicated).
  assert.equal(first.attributes.audioRole, "dialogue");
  assert.equal(readFcpxml(xml).clips.filter((clip) => clip.src === "media/rec.mp4").length, 2);
});

test("FCPXML at 29.97 drop-frame: exact rational times and DF timecode", () => {
  const timeline = buildTimeline(longMotionStory(), longMotionMedia(), { name: "long", rate: "29.97", models: { s1: {}, s2: {} } });
  const { xml } = writeFcpxml(timeline);
  assert.match(xml, /frameDuration="1001\/30000s"/);
  assert.match(xml, /tcFormat="DF"/);
  assert.match(xml, /<sequence format="r1" duration="1050049\/15000s"/);
  // s2 starts at frame 1828: 1828 × 1001/30000 s.
  assert.match(xml, /name="s2 · metric" ref="r\d+" lane="2" offset="914914\/15000s"|name="s2 · metric" ref="r\d+" lane="2" offset="457457\/7500s"/);
  assert.deepEqual(validateFcpxml(xml), []);
  assert.deepEqual(checkFcpxmlRoundTrip(timeline, xml), []);
  const read = readFcpxml(xml);
  assert.equal(read.rate.num, 30000);
  assert.equal(read.rate.dropFrame, true);
  assert.equal(read.duration, 2098);
});

test("FCPXML absolute media URLs and escaping", () => {
  const timeline = small();
  const { xml } = writeFcpxml(timeline, { absolute: "/Users/me/My Exports/small" });
  assert.match(xml, /src="file:\/\/\/Users\/me\/My%20Exports\/small\/media\/rec.mp4"/);
  assert.match(xml, /Hello &amp; welcome/);
  assert.match(xml, /from &lt;LaunchClip&gt;/);
  assert.deepEqual(checkFcpxmlRoundTrip(timeline, xml, { absolute: "/Users/me/My Exports/small" }), []);
});

test("validateFcpxml catches broken documents", () => {
  const { xml } = writeFcpxml(small());
  assert.match(validateFcpxml(xml.replace("</spine>", "")).join(), /not well-formed/);
  assert.match(validateFcpxml(xml.replace('ref="r4"', 'ref="r99"')).join(), /unknown asset r99/);
  assert.match(validateFcpxml(xml.replace('duration="2s" start="0s" audioRole="dialogue"', 'duration="61/30s" start="0s" audioRole="dialogue"')).join("\n"), /expected 60|spine/);
  assert.match(validateFcpxml(xml.replace('offset="1/2s"', 'offset="1/7s"')).join(), /frame grid/);
  assert.match(validateFcpxml(xml.replace('version="1.10"', 'version="1.9"')).join(), /version must be 1.10/);
});

test("PNG-sequence overlays are left out of FCPXML with a warning", () => {
  const media = smallMedia();
  for (const key of Object.keys(media.overlays)) media.overlays[key] = { source: `/x/${key}`, kind: "png-sequence", frames: media.overlays[key].frames, pattern: { prefix: "frame-", suffix: ".png", start: 0, padding: 3 } };
  const timeline = buildTimeline(smallFootageStory(), media, { name: "small", models: SMALL_MODELS, overlays: "png" });
  const { xml, warnings } = writeFcpxml(timeline);
  assert.match(warnings.join(), /PNG sequences/);
  assert.deepEqual(validateFcpxml(xml), []);
  assert.deepEqual(checkFcpxmlRoundTrip(timeline, xml), []);
});
