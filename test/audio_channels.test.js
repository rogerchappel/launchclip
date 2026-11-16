// The compiler reads a mix's channel count from its own header (a WAV fmt
// chunk, an MP4 mp4a sample entry), so a mono mix is declared 3 dB down the
// same way on a machine without ffprobe (kit/hyperframes/story-compiler.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { mp4aChannels, wavChannels } from "../kit/hyperframes/story-compiler.mjs";

test("channel counts come from the file's own header, and anything else is unknown", async () => {
  assert.equal(await wavChannels("examples/story/minimal/assets/audio/mix.wav"), 1);
  assert.equal(await mp4aChannels("examples/story/promo-16x9/assets/audio/mix.m4a"), 1);
  // A video with no audio track, a non-WAV file and a missing file are unknown (ffprobe decides).
  assert.equal(await mp4aChannels("examples/story/promo-16x9/assets/media/editor.mp4"), null);
  assert.equal(await wavChannels("package.json"), null);
  assert.equal(await wavChannels("missing.wav"), null);
});
