// Repeated cards rotate their look (src/card_variety.js): the first use keeps
// the style's variant, later uses take the module's other variants in a
// seeded order, and a stated variant wins.
import assert from "node:assert/strict";
import test from "node:test";
import { moduleVariants } from "@launchclip/core/modules.mjs";
import { varyCards } from "../src/card_variety.js";

const card = (id, extra = {}) => ({ id, module: "concept-card", start: 0, end: 3, params: { title: "Really oil it?", ...extra } });
const story = (scenes, title = "Deck materials") => ({ schema: "launchclip.story.v1", title, format: { width: 1080, height: 1920, fps: 30, duration: 30 }, scenes });
const variants = (board) => board.scenes.map((scene) => scene.params.variant);

test("the first use keeps the style's variant; later uses rotate through the others", () => {
  const names = moduleVariants()["concept-card"];
  // One card per variant and one more, so the rotation covers every other variant and wraps.
  const ids = Array.from({ length: names.length + 1 }, (_, i) => `c${i}`);
  const { storyboard, changed } = varyCards(story(ids.map((id) => card(id))), { style: { variants: { "concept-card": "banner" } } });
  const got = variants(storyboard);
  assert.equal(got[0], undefined);
  const rest = got.slice(1, names.length);
  assert.deepEqual([...rest].sort(), names.filter((name) => name !== "banner").sort());
  assert.equal(got[names.length], got[1]); // wraps round
  assert.equal(changed.length, names.length);
});

test("the rotation is deterministic per story and differs between seeds", () => {
  const scenes = ["a", "b", "c", "d"].map((id) => card(id));
  assert.deepEqual(variants(varyCards(story(scenes)).storyboard), variants(varyCards(story(scenes)).storyboard));
  const orders = new Set(["A", "B", "C", "D", "E", "F", "G", "H"].map((title) => variants(varyCards(story(scenes, title)).storyboard).join()));
  assert.ok(orders.size > 1);
});

test("a stated variant wins and an unrelated module is untouched", () => {
  const { storyboard } = varyCards(story([card("a"), card("b", { variant: "stacked" }), { id: "c", module: "clip", params: {} }]));
  assert.equal(storyboard.scenes[1].params.variant, "stacked");
  assert.equal(storyboard.scenes[2].params.variant, undefined);
});

test("the storyboard's own variants beat the style's, and variants: null turns the pass off", () => {
  const { storyboard } = varyCards({ ...story([card("a"), card("b"), card("c"), card("d")]), variants: { "concept-card": "marker" } }, { style: { variants: { "concept-card": "banner" } } });
  assert.ok(!variants(storyboard).includes("marker"));
  const off = { ...story([card("a"), card("b")]), variants: null };
  assert.equal(varyCards(off).storyboard, off);
});
