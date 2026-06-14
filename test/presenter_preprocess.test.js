import assert from "node:assert/strict";
import test from "node:test";
import { atempoFilter, buildVideoFilter, parseSilenceDetect } from "../src/presenter_preprocess.js";

test("builds a vertical presenter crop filter", () => {
  assert.equal(
    buildVideoFilter({ inputWidth: 1280, inputHeight: 720, outputWidth: 720, outputHeight: 1280, speed: 1.08 }),
    "crop=404:720:438:0,scale=720:1280,setpts=PTS/1.08"
  );
});

test("allows crop override for off-center presenter framing", () => {
  assert.equal(
    buildVideoFilter({ inputWidth: 1280, inputHeight: 720, outputWidth: 720, outputHeight: 1280, cropX: "500", speed: 1.1 }),
    "crop=404:720:500:0,scale=720:1280,setpts=PTS/1.1"
  );
});

test("chains atempo filters for speeds outside ffmpeg single-filter range", () => {
  assert.equal(atempoFilter(3.2), "atempo=2,atempo=1.6000");
  assert.equal(atempoFilter(0.25), "atempo=0.5,atempo=0.5000");
});

test("parses leading and trailing silence into a trim range", () => {
  const stderr = `
[silencedetect @ abc] silence_start: 0
[silencedetect @ abc] silence_end: 1.25 | silence_duration: 1.25
[silencedetect @ abc] silence_start: 9.4
[silencedetect @ abc] silence_end: 10.0 | silence_duration: 0.6
`;
  assert.deepEqual(parseSilenceDetect(stderr, 10, 0.1), {
    start: 1.35,
    end: 9.3,
    leadingSilence: { start: 0, end: 1.25 },
    trailingSilence: { start: 9.4, end: 10 }
  });
});
