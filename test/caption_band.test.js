import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { CAPTION_BAND, CAPTION_CSS, captionBandFor, captionCss } from "../kit/core/captions.mjs";
import { SAFE_ZONE_PROFILES } from "../kit/core/layout-check.mjs";
import { resolveStory } from "../kit/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

function bandPx(band, { width, height }) {
  return { x: Math.round(band.left * width), y: Math.round(band.top * height), width: Math.round((1 - band.left - band.right) * width), height: Math.round(band.height * height) };
}

// Regression (npm run eval:renderers, promo-16x9): both renderers drew 16:9
// captions on the portrait band (top 62%, y 670–800), across the middle of the
// content (over the count-up label and the media window), while layout-check
// checked the landscape band at y 864–1004.
test("the rendered caption band is the layout check's caption band in each orientation", () => {
  for (const [format, profile] of [[{ width: 1080, height: 1920 }, SAFE_ZONE_PROFILES.shorts], [{ width: 1920, height: 1080 }, SAFE_ZONE_PROFILES.landscape]]) {
    const band = bandPx(captionBandFor(format), format);
    const expected = profile.captionBand;
    for (const key of ["x", "y", "width", "height"]) assert.ok(Math.abs(band[key] - expected[key]) <= 1, `${format.width}x${format.height} ${key}: ${band[key]} vs ${expected[key]}`);
  }
  assert.equal(captionBandFor({ width: 1080, height: 1080 }), CAPTION_BAND, "square keeps the Shorts band");
  assert.equal(captionCss({ width: 1080, height: 1920 }), CAPTION_CSS, "portrait CSS is unchanged");
  assert.match(captionCss({ width: 1920, height: 1080 }), /\.lc-captions \{ position: absolute; left: 10%; right: 10%; top: 80%;/);
});

test("a 16:9 story compiles its captions onto the landscape band", async () => {
  const dir = path.join(ROOT, "examples", "story", "promo-16x9");
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(dir, "NARRATION.json"), "utf8"));
  const { html } = await compileStoryToHyperFrames(resolveStory(story, { words: narration.words }), { sourceDir: dir, write: false });
  assert.match(html, /\.lc-captions \{ position: absolute; left: 10%; right: 10%; top: 80%;/);
  const remotion = await readFile(path.join(ROOT, "kit", "remotion", "captions", "WordCaptions.tsx"), "utf8");
  assert.match(remotion, /const B = captionBandFor\(\{ width, height \}\);/);
});
