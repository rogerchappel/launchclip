import assert from "node:assert/strict";
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveStory } from "../kit/core/story.mjs";
import { compileStoryToHyperFrames, mediaLayerTweens } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROMO = path.join(ROOT, "examples", "story", "promo-16x9");

// Regression (npm run eval:renderers, promo-16x9): HyperFrames hoists <video>
// out of the scene layer, so the media-window clip ignored the morph's
// crossfade and the whip out (SSIM 0.83 against Remotion, which keeps it in
// the layer). The layer tweens are now replayed on the hoisted element.
test("mediaLayerTweens replays translation, opacity and blur on root media", () => {
  const element = '<video id="s5-media" class="clip" style="z-index:55;position:absolute;left:360px;top:144px;width:1200px;height:672px"></video>';
  const tweens = [
    { prop: "opacity", from: 0, to: 1, at: 17.6, duration: 0.5, ease: "power2.inOut" },
    { prop: "x", from: 0, to: -1920, at: 22.2, duration: 0.35, ease: "expo.inOut" },
    { prop: "blur", from: 0, to: 24, at: 22.2, duration: 0.175, ease: "power2.in" },
    { prop: "y", from: 1080, to: 0, at: 30, duration: 0.4, ease: "power3.inOut" }
  ];
  const { lines, unsupported } = mediaLayerTweens(element, tweens);
  assert.deepEqual(unsupported, []);
  assert.equal(lines[0], 'tl.fromTo("#s5-media", {"filter":"opacity(0) blur(0px)"}, {"filter":"opacity(1) blur(0px)","duration":0.5,"ease":"power2.inOut","immediateRender":false}, 17.6);');
  assert.match(lines[1], /\{"xPercent":0\}, \{"xPercent":-160,/);
  assert.match(lines[2], /\{"filter":"opacity\(1\) blur\(0px\)"\}, \{"filter":"opacity\(1\) blur\(24px\)"/);
  assert.match(lines[3], /\{"yPercent":160.7143\}, \{"yPercent":0,/);
  const zoom = mediaLayerTweens(element, [{ prop: "scale", from: 0.6, to: 1, at: 1, duration: 0.5, ease: "power3.out" }, { prop: "iris", from: 0, to: 900, at: 2, duration: 0.5, ease: "power2.inOut" }]);
  assert.deepEqual(zoom.unsupported, ["scale", "iris"]);
});

test("the promo's media window follows its morph and whip in HyperFrames", async () => {
  const story = JSON.parse(await readFile(path.join(PROMO, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(PROMO, "NARRATION.json"), "utf8"));
  const { html, warnings } = await compileStoryToHyperFrames(resolveStory(story, { words: narration.words }), { sourceDir: PROMO, write: false });
  assert.deepEqual(warnings.filter((warning) => /root media/.test(warning)), []);
  assert.match(html, /tl\.fromTo\("#s5-media", \{"filter":"opacity\(0\) blur\(0px\)"\}/);
  assert.match(html, /tl\.fromTo\("#s5-media", \{"xPercent":0\}, \{"xPercent":-160,/);
});

// Regression (Terra v7, the overview into chapter-the-anthropic-squeeze):
// HyperFrames hoisted an evidence clip's <video> to the root, outside the
// world camera, so it stayed full-size through pushes, zooms and overviews,
// and the overview's held shot had no clip. A video that is a module's whole
// html now stays in its plate, and the held shot shows its frozen frame.
test("an evidence clip's video rides the world camera and is held in the overview", async () => {
  const dir = path.join(ROOT, "examples", "story", "evidence-world-16x9");
  const story = JSON.parse(await readFile(path.join(dir, "storyboard.json"), "utf8"));
  const { html, warnings } = await compileStoryToHyperFrames(resolveStory(story), { sourceDir: dir, write: false });
  assert.deepEqual(warnings.filter((warning) => /root media/.test(warning)), []);
  const plate = html.slice(html.indexOf('<div id="lc-scene-s2"'), html.indexOf('<div id="lc-scene-s3"'));
  assert.match(plate, /<video id="s2-media" class="clip" data-start="3"[^>]*src="assets\/evidence-static\.mp4"/);
  assert.match(plate, /<\/video><div id="s2-overlay" class="clip"/, "the overlay follows its video inside the plate");
  assert.doesNotMatch(plate, /<video[^>]*z-index/, "no root z-index on a video kept in its plate");
  const held = html.slice(html.indexOf('<div id="lc-scene-s2-held"'));
  assert.match(held, /<img id="s2-held-media" class="lc-unclipped [^"]*" style="[^"]*" src="held\/s2-held\.png"/);
  assert.match(held, /id="s2-held-overlay" class="lc-unclipped/);
  assert.doesNotMatch(held.slice(0, held.indexOf("</div></div>")), /<video/);
});

test("the held evidence frame is written with the project", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "launchclip-held-"));
  try {
    const source = path.join(work, "story");
    await cp(path.join(ROOT, "examples", "story", "evidence-world-16x9"), source, { recursive: true });
    await mkdir(path.join(source, "assets"), { recursive: true });
    await copyFile(path.join(ROOT, "test", "fixtures", "parity", "assets", "evidence-static.mp4"), path.join(source, "assets", "evidence-static.mp4"));
    const story = JSON.parse(await readFile(path.join(source, "storyboard.json"), "utf8"));
    const { files, warnings } = await compileStoryToHyperFrames(resolveStory(story), { sourceDir: source, projectDir: path.join(work, "hf") });
    assert.deepEqual(warnings.filter((warning) => /held frame/.test(warning)), []);
    assert.ok(files.includes("held/"));
    assert.ok(existsSync(path.join(work, "hf", "held", "s2-held.png")));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
