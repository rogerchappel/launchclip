import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sceneSeconds } from "../kit/remotion/clock.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

// Regression (npm run eval:renderers, cooling): a scene starting at 5.75 s at
// 30 fps sits in a Sequence from frame 173, and Remotion sampled it at
// 5.75 + local / 30, half a frame behind HyperFrames' absolute frame / 30. In
// the push into that scene the incoming plate trailed HyperFrames by ~160 px
// (SSIM 0.93).
test("scene time is the absolute composition time of the Sequence frame", () => {
  const fps = 30;
  const startFrame = Math.round(5.75 * fps);
  assert.equal(startFrame, 173);
  for (const local of [0, 6, 7, 12]) {
    assert.equal(sceneSeconds(5.75, local, fps, startFrame), (startFrame + local) / fps, `local frame ${local}`);
  }
  // Frame-aligned starts are unchanged.
  assert.equal(sceneSeconds(3, 9, fps, 90), 3 + 9 / fps);
  // Outside StoryComposition (ModuleReview, the frozen loop) time stays model-relative.
  assert.equal(sceneSeconds(5.75, 0, fps, null), 5.75);
});

test("every Remotion scene module reads time through the scene clock", async () => {
  const files = ["kit/remotion/catalog/shared.tsx", "kit/remotion/catalog/CatalogB.tsx", "kit/remotion/modules/shared.tsx", "kit/remotion/modules/shell-b.tsx"];
  for (const file of files) {
    const source = await readFile(path.join(ROOT, file), "utf8");
    assert.match(source, /useSceneTime\(model\.start\)/, file);
    assert.doesNotMatch(source, /model\.start \+ frame \/ fps/, file);
  }
  const composition = await readFile(path.join(ROOT, "kit/remotion/StoryComposition.tsx"), "utf8");
  assert.match(composition, /<SceneStartFrame\.Provider value=\{frames\(entry\.start\)\}>/);
  // Transitions and ambient motion sample the same absolute composition time.
  assert.match(composition, /const t = \(startFrame \+ frame\) \/ fps;/);
  assert.match(composition, /layerStateAt\(t, tweens, getEase\)/);
  assert.match(composition, /<AmbientField blobs=\{field\} t=\{t\} \/>/);
  assert.match(composition, /driftStyle\(drift, t\)/);
});
