// Captions draw above every transition and light layer, in both renderers:
// a light sweep, a dot wipe, the light over the scenes, the medium, a panel's
// flash (inside its scene) and push-blur's smear (a filter on the outgoing
// scene) never pass over a caption's opaque chip, so they cannot lower its
// legibility. A low reading during a transition is the measurement's, not the
// composite's.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DOT_WIPE } from "@launchclip/core/dot-wipe.mjs";
import { LIGHT_SWEEP } from "@launchclip/core/light-sweep.mjs";
import { LIGHT_Z } from "@launchclip/core/lighting.mjs";
import { MEDIUM_Z } from "@launchclip/core/medium.mjs";

test("captions: HyperFrames stacks #lc-captions above the sweep, wipe, light and medium layers", () => {
  const compiler = readFileSync(new URL("../kit/hyperframes/story-compiler.mjs", import.meta.url), "utf8");
  const z = Number(compiler.match(/#lc-captions \{ z-index: (\d+); \}/)?.[1]);
  assert.ok(z > 0, "the compiler sets the captions' z-index");
  for (const [name, layer] of Object.entries({ "light-sweep": LIGHT_SWEEP.z.hyperframes, "dot-wipe": DOT_WIPE.z.hyperframes, light: LIGHT_Z.hyperframes, medium: MEDIUM_Z.hyperframes })) assert.ok(layer < z, `${name} (${layer}) sits under the captions (${z})`);
});

test("captions: Remotion draws WordCaptions after the sweep, light, wipe and medium layers", () => {
  const source = readFileSync(new URL("../kit/remotion/StoryComposition.tsx", import.meta.url), "utf8");
  // Both returns (the camera stack and the flat stack) end with the overlays in this order.
  for (const body of source.split("return (").slice(1).filter((part) => part.includes("<WordCaptions"))) {
    const at = (needle) => body.indexOf(needle);
    const captions = at("<WordCaptions");
    for (const layer of ["sweepLayers", "<LightOver", "wipeLayers", "<MediumLayer"]) assert.ok(at(layer) >= 0 && at(layer) < captions, `${layer} comes before the captions`);
  }
  assert.equal(LIGHT_SWEEP.z.remotion < 100 && DOT_WIPE.z.remotion < 100, true);
});
