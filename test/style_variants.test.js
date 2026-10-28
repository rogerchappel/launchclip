// Module variants for seeded styles: the frozen per-generator lists
// (kit/core/style-seed-variants.mjs) and the lower-third variants.
import assert from "node:assert/strict";
import test from "node:test";

import { V1_MODULE_VARIANTS, V2_MODULE_VARIANTS } from "@launchclip/core/style-seed-variants.mjs";
import { GENERATOR_V1, generateStyle } from "@launchclip/core/style-seed.mjs";
import { moduleVariants, resolveModule } from "@launchclip/core/modules.mjs";
import { LOWER_THIRD_VARIANTS, catalogCTimeline, catalogCView } from "@launchclip/core/catalog-c.mjs";
import { emitCatalogC } from "../kit/hyperframes/catalog-c.mjs";

const seedAt = (i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(16).padStart(8, "0");

test("every frozen variant list still names variants the catalogue draws", () => {
  const live = moduleVariants();
  for (const table of [V1_MODULE_VARIANTS, V2_MODULE_VARIANTS]) {
    for (const [id, names] of Object.entries(table)) {
      assert.ok(live[id], `${id} is still a module with variants`);
      for (const name of names) assert.ok(live[id].includes(name), `${id}: ${name}`);
      assert.equal(names[0], live[id][0], `${id}: the default stays first`);
    }
  }
  assert.equal(V1_MODULE_VARIANTS["lower-third"], undefined);
  assert.deepEqual(V2_MODULE_VARIANTS["lower-third"], LOWER_THIRD_VARIANTS);
});

test("v1 packs keep v1's modules; v2 packs reach every lower-third variant", () => {
  assert.equal(generateStyle({ seed: "7f3a91c2", generator: GENERATOR_V1 }).variants["lower-third"], undefined);
  const drawn = new Set(Array.from({ length: 40 }, (_, i) => generateStyle({ seed: seedAt(i) }).variants["lower-third"]));
  assert.deepEqual([...drawn].sort(), [...LOWER_THIRD_VARIANTS].sort());
});

const story = (variants, params = {}) => ({
  schema: "launchclip.story.v1", lane: "footage-led", format: { width: 1920, height: 1080, fps: 30, duration: 4 },
  brand: { colors: { bg: "#0b0b0f", paper: "#f5f3ee", ink: "#0b0b0f", primary: "#ffd23f", accent: "#46d4ff" }, fonts: { display: "anton", body: "inter" } },
  ...(variants ? { variants } : {}),
  scenes: [{ id: "lt", module: "lower-third", start: 0, end: 4, params: { name: "Ada Lovelace", title: "Founder", ...params } }]
});
const model = (s) => resolveModule(s.scenes[0], s);

test("lower-third: the style's variant sets the look; params win; the default is the original", () => {
  const original = model(story(null));
  assert.equal(original.content.tone, "dark");
  assert.equal(original.content.outline, false);
  assert.deepEqual(model(story({ "lower-third": "bar" })), original, "bar is the original look");
  assert.equal(model(story({ "lower-third": "band" })).content.tone, "primary");
  assert.equal(model(story({ "lower-third": "pill" })).content.tone, "pill");
  assert.equal(model(story({ "lower-third": "outline" }, { tone: "primary" })).content.tone, "primary", "params.tone wins");
  assert.equal(model(story({ "lower-third": "outline" }, { variant: "band" })).content.tone, "primary", "params.variant wins");
  assert.throws(() => model(story({ "lower-third": "neon" })), /lower-third/);
});

test("lower-third outline: a ringed panel and an underline that draws across, in the shared view both renderers draw", () => {
  const m = model(story({ "lower-third": "outline" }));
  const view = JSON.stringify(catalogCView(m));
  assert.match(view, /solid #ffd23f/);
  const ops = catalogCTimeline(m);
  const bar = ops.filter((op) => op.target === "lt-bar");
  assert.ok(bar.some((op) => op.to?.scaleX === 1), "the underline draws across");
  const html = emitCatalogC(m).html;
  assert.match(html, /lt-bar/);
  assert.match(html, /border:/);
});
