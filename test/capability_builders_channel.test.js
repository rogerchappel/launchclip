// The channel builders (kit/core/capability-builders-channel.mjs): logo-sting from the story brand.
import assert from "node:assert/strict";
import test from "node:test";
import { capabilityParams, isPlanned, resolveCapability } from "../kit/core/visual-capabilities.mjs";
import { resolveModule } from "../kit/core/modules.mjs";

const BRAND = { colors: { bg: "#04070d", primary: "#3fd8ff", accent: "#ff9b54", ink: "#04070d", paper: "#f3f8ff" } };
const beat = (brand) => ({ id: "open", text: "Welcome back to Signal Lab.", headline: "Welcome back", ...(brand === undefined ? {} : { brand }), facts: { numbers: [], items: [], dates: [], places: [] } });

test("logo-sting: the channel name, its logo when it is an asset, else a monogram", () => {
  assert.equal(isPlanned("logo-sting"), false);
  assert.deepEqual(capabilityParams("logo-sting", beat({ name: "Signal Lab", tagline: "AI, explained weekly" })), { name: "Signal Lab", tagline: "AI, explained weekly" });
  assert.deepEqual(capabilityParams("logo-sting", beat({ name: "Signal Lab", logo: "assets/brand/logo.svg" })), { name: "Signal Lab", logo: "assets/brand/logo.svg" });
  assert.deepEqual(capabilityParams("logo-sting", beat({ wordmark: "Signal Lab", mark: "assets/brand/mark.png" })), { name: "Signal Lab", logo: "assets/brand/mark.png" });
  // A logo that is not a project image is left out; the module draws the monogram.
  assert.deepEqual(capabilityParams("logo-sting", beat({ name: "Signal Lab", logo: "https://example.com/logo.png" })), { name: "Signal Lab" });
  const params = capabilityParams("logo-sting", beat({ name: "Signal Lab" }));
  const story = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1920, height: 1080, fps: 30, duration: 5 }, brand: BRAND, scenes: [], resolved: { duration: 5, fps: 30 } };
  const scene = { id: "s", module: "logo-sting", start: 0, end: 4.5, params };
  assert.doesNotThrow(() => resolveModule(scene, { ...story, scenes: [scene] }));
});

test("logo-sting: no brand, or a brand with no name, gives no params, so the director falls back", () => {
  assert.equal(capabilityParams("logo-sting", beat()), null);
  assert.equal(capabilityParams("logo-sting", beat({ mark: "assets/brand/mark.png", wordmark: { src: "assets/brand/wordmark.png", ratio: 7 } })), null);
  assert.deepEqual(resolveCapability("logo-sting").chain.slice(0, 1), ["logo-sting"]);
});
