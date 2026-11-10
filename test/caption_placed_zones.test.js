// Zones a captions overlay places itself (overlay.zones): for those seconds
// the lines sit in the zone's rect instead of the band, in both renderers
// (captionPlan), in the layout check and over any footage or cast zone.
import assert from "node:assert/strict";
import test from "node:test";
import { captionPlan, chunkWords } from "@launchclip/core/captions.mjs";
import { layoutCaptionZones, placedCaptionZones, storyCaptionZones, withPlacedZones } from "@launchclip/core/cast-captions.mjs";
import { elementsFromStory } from "@launchclip/core/layout-check.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { validateStory } from "@launchclip/core/story.mjs";

const RECT = { x: 65, y: 1180, width: 853, height: 230 };
const story = (zones, extra = {}) => ({
  schema: "launchclip.story.v1", title: "Zones", lane: "motion", brand: DEFAULT_BRAND,
  format: { width: 1080, height: 1920, fps: 30, duration: 9 }, resolved: { duration: 9 },
  scenes: [{ id: "a", module: "hook-title", start: 0, end: 9, params: { headline: "A title" } }],
  overlays: [{ type: "captions", preset: "kinetic-hierarchy", position: "middle", size: 1.15, zones, ...extra }]
});
const words = Array.from({ length: 27 }, (_, i) => ({ text: `w${i}`, start: i / 3, end: i / 3 + 0.3 }));

test("an overlay's zones are read in order, with a scale only when it shrinks the lines", () => {
  const zones = placedCaptionZones(story([{ start: 6, end: 9, rect: RECT, scale: 0.8 }, { start: 3, end: 6, rect: RECT }, { start: 2, end: 1, rect: RECT }, { start: 0, end: 1 }]));
  assert.deepEqual(zones, [
    { section: "placed-2", start: 3, end: 6, rect: RECT, placed: true },
    { section: "placed-1", start: 6, end: 9, rect: RECT, scale: 0.8, placed: true }
  ]);
  assert.deepEqual(placedCaptionZones(story(undefined)), []);
  assert.deepEqual(placedCaptionZones(story([{ start: 3, end: 6, rect: RECT }], { rect: RECT })), [], "an overlay with its own rect places every line already");
});

test("a placed zone cuts any other zone back to the seconds it does not cover", () => {
  const value = story([{ start: 3, end: 6, rect: RECT }]);
  const other = [{ section: "s", start: 0, end: 9, rect: { x: 0, y: 0, width: 500, height: 200 } }];
  const merged = withPlacedZones(value, other);
  assert.deepEqual(merged.map((zone) => [zone.section, zone.start, zone.end]), [["s#1", 0, 3], ["placed-1", 3, 6], ["s#2", 6, 9]]);
  assert.equal(withPlacedZones(story(undefined), other), other);
  assert.deepEqual(storyCaptionZones(value, { captions: other }).map((zone) => zone.section), ["s#1", "placed-1", "s#2"]);
  assert.deepEqual(layoutCaptionZones(value).map((zone) => zone.section), ["placed-1"]);
});

test("lines spoken in a placed zone are drawn in its rect, at its scale; the others keep the band", () => {
  const value = story([{ start: 3, end: 6, rect: RECT, scale: 0.8 }]);
  const overlay = value.overlays[0];
  const plan = captionPlan(chunkWords(words), overlay, { brand: value.brand, format: value.format, story: value, zones: storyCaptionZones(value, null) });
  const zoned = plan.nodes.filter((node) => / lc-cap-z1/.test(node.cls ?? node.className ?? JSON.stringify(node)));
  assert.ok(zoned.length > 0 && zoned.length < plan.nodes.length, "only the lines spoken from 3 to 6 s are in the zone");
  // The band sits at the middle (top 44%); the zone's box is given against it.
  assert.match(plan.css, /\.lc-captions \{[^}]*top: 44%/);
  const rule = /\.lc-cap\.lc-cap-z1 \{([^}]*)\}/.exec(plan.css)?.[1] ?? "";
  assert.match(rule, /font-size: [\d.]+px/);
  const size = Number(/font-size: ([\d.]+)px/.exec(rule)[1]);
  assert.ok(Math.abs(size - plan.options.size * 0.8) < 0.02, `${size} is 80% of ${plan.options.size}`);
  // The same plan without a scale keeps the preset's size.
  const full = captionPlan(chunkWords(words), { ...overlay, zones: [{ start: 3, end: 6, rect: RECT }] }, { brand: value.brand, format: value.format, story: value, zones: [{ start: 3, end: 6, rect: RECT }] });
  assert.doesNotMatch(/\.lc-cap\.lc-cap-z1 \{([^}]*)\}/.exec(full.css)[1], /font-size/);
});

test("the layout check measures the captions in the zone, and the band is clear for those seconds", () => {
  const value = story([{ start: 3, end: 6, rect: RECT }]);
  const elements = elementsFromStory(value, { moduleLayout: () => [], captionZones: layoutCaptionZones(value) });
  const band = elements.find((element) => element.id === "captions");
  assert.deepEqual(band.hide, [[3, 6]]);
  assert.equal(band.rect.y, 960 - band.rect.height / 2);
  assert.deepEqual(elements.find((element) => element.id === "captions@placed-1"), { id: "captions@placed-1", role: "caption", rect: RECT, start: 3, end: 6 });
});

test("validation: zones are {start, end, rect, scale?} in seconds and px", () => {
  const errors = (zones) => validateStory(story(zones)).errors.filter((line) => line.includes("zones"));
  assert.deepEqual(errors([{ start: 3, end: 6, rect: RECT, scale: 0.8 }]), []);
  assert.equal(errors([{ start: 6, end: 3, rect: RECT }]).length, 1);
  assert.equal(errors([{ start: 3, end: 6, rect: { x: 0, y: 0, width: 0, height: 10 } }]).length, 1);
  assert.equal(errors([{ start: 3, end: 6, rect: RECT, scale: 0.5 }]).length, 1);
  assert.equal(errors("low").length, 1);
});
