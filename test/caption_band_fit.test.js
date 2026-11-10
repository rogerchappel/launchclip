import assert from "node:assert/strict";
import test from "node:test";
import { captionBandErrors, captionBandWarning, fitCaptionBand, settleCaptionBand } from "../src/caption_band_fit.js";

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
  assert.equal(fitCaptionBand(story, ["validation: nope"]).storyboard, story);
  assert.equal(fitCaptionBand(null, [ERROR]).hidden.length, 0);
});

test("captions the style pack supplies (a story with no overlays of its own) get an overlay to carry the hidden range", () => {
  const story = { scenes: [] };
  const fitted = fitCaptionBand(story, [ERROR]);
  assert.deepEqual(fitted.storyboard.overlays, [{ type: "captions", hide: [[0.28, 1.42]] }], "no preset or position: the pack still fills those");
  assert.deepEqual(fitted.hidden, ["captions 0.28–1.42 s under deck-cover-callouts"]);
  assert.equal(story.overlays, undefined);
});

test("settling repeats while the check reports a new clash, and reports every range it hid", () => {
  const second = ERROR.replace("@0.3s", "@8.6s").replace("deck-cover-callouts", "choice").replace("(0.3s–1.4s)", "(8.597s–10.336s)");
  // A check that reports one clash at a time, as a fix exposing the next one does.
  const check = (story) => {
    const hide = story.overlays?.[0]?.hide ?? [];
    const errors = hide.length === 0 ? [ERROR] : hide.length === 1 ? [second] : [];
    return { ok: errors.length === 0, errors };
  };
  const story = { scenes: [], overlays: [{ type: "captions" }] };
  const settled = settleCaptionBand(story, check(story), check);
  assert.equal(settled.checked.ok, true);
  assert.deepEqual(settled.storyboard.overlays[0].hide, [[0.28, 1.42], [8.58, 10.36]]);
  assert.equal(captionBandWarning(settled.hidden), "layout: tooling hid captions 0.28–1.42 s under deck-cover-callouts; captions 8.58–10.36 s under choice");
  // Nothing to fit: the storyboard and the check come back as they were.
  const other = { ok: false, errors: ["validation: nope"] };
  const kept = settleCaptionBand(story, other, () => { throw new Error("not checked again"); });
  assert.equal(kept.storyboard, story);
  assert.equal(kept.checked, other);
  assert.deepEqual(kept.hidden, []);
});
