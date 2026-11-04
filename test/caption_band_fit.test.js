import assert from "node:assert/strict";
import test from "node:test";
import { captionBandErrors, fitCaptionBand } from "../src/caption_band_fit.js";

const ERROR = "layout: caption-band @0.3s [deck-cover-callouts, captions] deck-cover-callouts sits in the caption band 65,845 853×230 while captions are visible (0.3s–1.4s); move it or set hidesCaptions";

test("caption-band errors parse to the card, the captions overlay and the clash window", () => {
  assert.deepEqual(captionBandErrors([ERROR, "layout: safe-zone @1s [s3] off the frame", "params: scenes[0] nope"]), [
    { scene: "deck-cover-callouts", captions: "captions", start: 0.3, end: 1.4 }
  ]);
});

test("the captions are hidden over each clash, once, and other overlays are left alone", () => {
  const story = { scenes: [], overlays: [{ type: "progress" }, { id: "captions", type: "captions", hide: [[5, 6]] }] };
  const second = ERROR.replace("@0.3s", "@8.6s").replace("deck-cover-callouts", "choice").replace("(0.3s–1.4s)", "(8.597s–10.336s)");
  const fitted = fitCaptionBand(story, [ERROR, second]);
  assert.deepEqual(fitted.storyboard.overlays[1].hide, [[5, 6], [0.28, 1.42], [8.58, 10.36]]);
  assert.deepEqual(fitted.storyboard.overlays[0], { type: "progress" });
  assert.deepEqual(fitted.hidden, ["captions 0.28–1.42 s under deck-cover-callouts", "captions 8.58–10.36 s under choice"]);
  assert.equal(story.overlays[1].hide.length, 1, "the planner's storyboard is not mutated");
  // Already hidden: nothing changes.
  const again = fitCaptionBand(fitted.storyboard, [ERROR]);
  assert.equal(again.storyboard, fitted.storyboard);
  assert.deepEqual(again.hidden, []);
});

test("no captions overlay or no clash: the storyboard comes back as is", () => {
  const story = { scenes: [], overlays: [{ type: "progress" }] };
  assert.equal(fitCaptionBand(story, [ERROR]).storyboard, story);
  assert.equal(fitCaptionBand({ scenes: [] }, [ERROR]).hidden.length, 0);
  assert.equal(fitCaptionBand(story, ["validation: nope"]).storyboard, story);
});
