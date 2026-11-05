// Footage inserts vary their frame (src/insert_variety.js): a polaroid at
// most once a video (none for a serious style, two for a playful one), no
// two inserts in a row in the same frame, and a converted insert the library
// has no shot for goes back to its card.
import assert from "node:assert/strict";
import test from "node:test";
import { validateModuleParams } from "@launchclip/core/module-schemas.mjs";
import { restoreMisses, varyInserts, noveltyCap } from "../src/insert_variety.js";

const shot = (shows) => ({ kind: "shot", shows, type: "image" });
const polaroid = (id, start, caption, extra = {}) => ({ id, module: "polaroid", start, end: start + 3, params: { image: shot(`${caption} close-up`), caption }, ...extra });
const card = (id, start) => ({ id, module: "compare", start, end: start + 3, params: { title: "Two ways" } });
const story = (scenes) => ({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 30 }, scenes });

test("a run of polaroids becomes varied footage inserts", () => {
  const { storyboard, changed, originals } = varyInserts(story([polaroid("a", 0, "Beyond looks"), polaroid("b", 3, "Beyond looks"), card("c", 6), polaroid("d", 9, "Regular oiling")]));
  assert.deepEqual(storyboard.scenes.map((scene) => scene.module), ["polaroid", "photo-scene", "compare", "photo-scene"]);
  assert.equal(changed.length, 2);
  assert.match(changed[0], /scene b: polaroid → photo-scene \(at most 1 polaroid frame a video\)/);
  assert.deepEqual([...originals.keys()], ["b", "d"]);
  const b = storyboard.scenes[1];
  // The shot request moves to params.media and may come back as a video.
  assert.deepEqual(b.params.media, { kind: "shot", shows: "Beyond looks close-up" });
  assert.deepEqual(b.params.lines, [{ text: "Beyond looks" }]);
  assert.equal(b.params.scrim, "bottom");
  // Each converted Ken Burns scene moves differently.
  assert.notEqual(b.params.move, storyboard.scenes[3].params.move);
  for (const scene of [b, storyboard.scenes[3]]) assert.equal(scene.start !== undefined && scene.end !== undefined, true);
});

test("converted inserts alternate so no two in a row share a treatment", () => {
  const { storyboard } = varyInserts(story([polaroid("a", 0, "One"), polaroid("b", 3, "Two"), polaroid("c", 6, "Three"), polaroid("d", 9, "Four")]));
  const modules = storyboard.scenes.map((scene) => scene.module);
  assert.deepEqual(modules, ["polaroid", "photo-scene", "clip", "photo-scene"]);
  for (let i = 1; i < modules.length; i += 1) assert.notEqual(modules[i], modules[i - 1]);
  const clip = storyboard.scenes[2].params;
  assert.deepEqual(clip.media, { kind: "shot", shows: "Three close-up" });
  assert.deepEqual(clip.callouts, [{ text: "Three" }]);
  // From a card, a clip fades in and out rather than cutting.
  assert.deepEqual([clip.enter, clip.exit], ["fade", "fade"]);
});

test("the playfulness dial sets how many polaroids a video may keep", () => {
  assert.equal(noveltyCap(null), 1);
  assert.equal(noveltyCap({ dials: { playfulness: 0.2 } }), 0);
  assert.equal(noveltyCap({ dials: { playfulness: 0.8 } }), 2);
  const scenes = [polaroid("a", 0, "One"), card("x", 3), polaroid("b", 6, "Two")];
  assert.deepEqual(varyInserts(story(scenes), { style: { dials: { playfulness: 0.1 } } }).storyboard.scenes.map((scene) => scene.module), ["photo-scene", "compare", "photo-scene"]);
  assert.deepEqual(varyInserts(story(scenes), { style: { dials: { playfulness: 0.9 } } }).storyboard.scenes.map((scene) => scene.module), ["polaroid", "compare", "polaroid"]);
});

test("a short insert becomes a clip, not a jolt of Ken Burns, and skips a callout it has no time for", () => {
  const short = { ...polaroid("b", 3, "Quick"), end: 4.5 };
  const { storyboard } = varyInserts(story([polaroid("a", 0, "One"), short]));
  assert.equal(storyboard.scenes[1].module, "clip");
  assert.equal(storyboard.scenes[1].params.callouts, undefined);
});

test("an overlay polaroid changes variant instead of going full frame", () => {
  const { storyboard, changed } = varyInserts(story([polaroid("a", 0, "One", { track: 1 }), polaroid("b", 3, "Two", { track: 1 })]));
  assert.deepEqual(storyboard.scenes.map((scene) => [scene.module, scene.params.variant]), [["polaroid", undefined], ["polaroid", "pinned"]]);
  assert.match(changed[0], /variant → pinned/);
});

test("cards that name what they show keep their kind; footage between inserts breaks a run", () => {
  const phone = (id, start) => ({ id, module: "device-frame", start, end: start + 3, params: { image: shot("the app") } });
  const clip = { id: "c", module: "clip", start: 6, end: 9, params: { media: shot("the site") } };
  const { storyboard, changed } = varyInserts(story([phone("a", 0), phone("b", 3), clip, polaroid("d", 9, "One")]));
  assert.deepEqual(storyboard.scenes.map((scene) => scene.module), ["device-frame", "device-frame", "clip", "polaroid"]);
  assert.equal(storyboard.scenes[1].params.variant, "dark");
  assert.equal(changed.length, 1);
});

test("a storyboard with nothing to vary comes back unchanged", () => {
  const input = story([polaroid("a", 0, "One"), card("b", 3)]);
  const out = varyInserts(input);
  assert.equal(out.storyboard, input);
  assert.deepEqual(out.changed, []);
});

test("converted scenes pass their module's params check", () => {
  const { storyboard } = varyInserts(story([polaroid("a", 0, "One"), polaroid("b", 3, "Beyond looks"), polaroid("c", 6, "Regular oiling")]));
  for (const scene of storyboard.scenes.slice(1)) {
    const params = { ...scene.params, media: { kind: "image", src: "assets/shots/x.jpg" } };
    assert.deepEqual(validateModuleParams(scene.module, params), [], scene.module);
  }
});

test("a converted insert the library has no shot for goes back to its card", () => {
  const planned = story([polaroid("a", 0, "One"), polaroid("b", 3, "Two")]);
  const { storyboard, originals } = varyInserts(planned);
  const { storyboard: kept, errors, restored } = restoreMisses(storyboard, ['scene b: the app has no shot that shows "Two close-up"; design this scene without one', "scene z: something else"], originals);
  assert.deepEqual(restored, ["b"]);
  assert.deepEqual(errors, ["scene z: something else"]);
  assert.equal(kept.scenes[1].module, "polaroid");
  assert.equal(kept.scenes[1].params.image, undefined);
  assert.equal(kept.scenes[1].params.caption, "Two");
});
