// A card in the caption band: tooling keeps the captions on screen. In order,
// per scene: the content moves out of the band, else the captions move for
// that scene, else they shrink, and only then are they hidden
// (src/caption_band_fit.js). The fixture is the production story that
// shipped with its captions hidden (test/helpers/caption_band_story.js).
import assert from "node:assert/strict";
import test from "node:test";
import { CAPTION_BAND_FIT, captionBandErrors, captionBandWarnings, fitCaptionBand, settleCaptionBand } from "../src/caption_band_fit.js";
import { captionVisibilityGate } from "../src/caption_visibility.js";
import { checkStoryboard, resolveChecked } from "../src/storyboard_planner.js";
import { BAND_WORDS, bandStory, bandStyle } from "./helpers/caption_band_story.js";

const ERROR = "layout: caption-band @0.3s [deck-cover-callouts, captions] deck-cover-callouts sits in the caption band 65,845 853×230 while captions are visible (0.3s–1.4s); move it or set hidesCaptions";
const BAND = { x: 65, y: 845, width: 853, height: 230 };

// The fixture under a caption position and size: the checks a make run uses, and the settled story.
function run({ position = "middle", size = 1.15, tier = "structured", change, from } = {}) {
  const options = { words: BAND_WORDS, tier, style: bandStyle({ position, size }), bandErrors: false };
  const check = (story) => checkStoryboard(story, options);
  const resolve = (story) => resolveChecked(story, options);
  const story = bandStory(change);
  const checked = check(story);
  const settled = from ? { ...fitCaptionBand(story, checked.errors, { resolve, from }) } : settleCaptionBand(story, checked, check, { resolve });
  const scene = (id) => settled.storyboard.scenes.find((entry) => entry.id === id);
  return { story, checked, settled, check, resolve, scene, overlay: settled.storyboard.overlays?.find((entry) => entry.type === "captions") ?? null, gate: captionVisibilityGate(resolve(settled.storyboard), BAND_WORDS) };
}
const clashing = (checked) => captionBandErrors(checked.errors).map((clash) => clash.scene);

test("caption-band errors parse to the card, the captions overlay, the band and the clash window", () => {
  assert.deepEqual(captionBandErrors([ERROR, "layout: safe-zone @1s [s3] off the frame", "params: scenes[0] nope"]), [
    { scene: "deck-cover-callouts", captions: "captions", rect: BAND, start: 0.3, end: 1.4 }
  ]);
});

test("the fixture reproduces the shipped video: seven scenes sit in the middle band, and hiding the captions under each hides most of the narration", () => {
  const { checked, settled, resolve } = run({ from: 4 });
  assert.deepEqual(clashing(checked), ["open-callouts", "boards", "pine-text", "ask", "mix-text", "stat-text", "end"]);
  assert.equal(settled.hidden.length, 7);
  assert.deepEqual([settled.moved, settled.placed], [[], []]);
  const gate = captionVisibilityGate(resolve(settled.storyboard), BAND_WORDS);
  assert.equal(gate.status, "failed");
  assert.ok(gate.share > 0.7, `captions hidden for ${gate.share} of the narration`);
});

test("settled in order, the captions stay on screen for the whole narration and the content is clear of them", () => {
  const { settled, overlay, gate, scene, resolve } = run();
  assert.equal(settled.checked.ok, true, settled.checked.errors.join("\n"));
  assert.deepEqual(settled.hidden, [], "nothing is hidden");
  assert.equal(overlay.hide, undefined);
  assert.deepEqual({ status: gate.status, share: gate.share, scenes: gate.scenes }, { status: "passed", share: 0, scenes: [] });
  // Step 1, a placement param: the clip's label takes its top slot; the split gives the footage less of the frame.
  assert.equal(scene("open").params.position, "top");
  assert.equal(scene("pine").params.share, 0.3);
  // Step 1, a rect: the diagram and the card are re-fitted above the band; the call to action moves there at its own size.
  for (const id of ["boards", "ask", "end"]) {
    const rect = scene(id).params.rect;
    assert.ok(rect.y >= 280 && rect.y + rect.height <= 826 - 24, `${id} sits above the band: ${JSON.stringify(rect)}`);
    assert.deepEqual(scene(id).fitted, ["rect"], "the rect is marked as tooling's, so the structured tier allows it");
  }
  assert.equal(scene("end").params.rect.height, 495, "the call to action keeps its size");
  assert.ok(scene("boards").params.rect.height < 880 && scene("boards").params.rect.height >= 880 * CAPTION_BAND_FIT.minArea);
  // Step 2: the fixed layouts keep their place and the captions move below them, at full size.
  assert.deepEqual(overlay.zones, [
    { start: 15, end: 18, rect: { x: 65, y: 1171, width: 853, height: 269 } },
    { start: 21, end: 24, rect: { x: 65, y: 1171, width: 853, height: 269 } }
  ]);
  assert.deepEqual(captionBandWarnings(settled), [
    'layout: tooling cleared the caption band: open (position "top"); boards (re-fitted above it); pine (share 0.3); ask (re-fitted above it); end (moved above it)',
    "layout: tooling placed captions 15–18 s moved below mix (y 1171); captions 21–24 s moved below stat (y 1171)"
  ]);
  // The scenes that were clear are untouched.
  for (const id of ["hardwood", "wide"]) assert.deepEqual(scene(id), bandStory().scenes.find((entry) => entry.id === id));
  assert.equal(resolve(settled.storyboard).overlays.find((entry) => entry.type === "captions").position, "middle", "the pack still fills the overlay tooling added");
});

test("step 1 is skipped for content that cannot move: a label whose other slot is taken keeps its place and the captions move", () => {
  // A card fills the top of the frame while the clip plays, so the label cannot take the top slot.
  const { settled, overlay, scene } = run({ tier: "bespoke", change: (scenes) => [
    { ...scenes[0], end: 4 },
    { id: "upper", module: "concept-card", track: 1, start: 0, end: 4, energy: 1, params: { text: "Upper", rect: { x: 80, y: 280, width: 860, height: 520 } } }
  ] });
  assert.equal(settled.checked.ok, true, settled.checked.errors.join("\n"));
  assert.equal(scene("open").params.position, undefined);
  assert.deepEqual(settled.moved, []);
  assert.equal(overlay.zones.length, 1);
  assert.match(settled.placed[0], /^captions 0–4 s moved below open \(y 11\d\d\)$/);
  assert.equal(overlay.hide, undefined);
});

test("step 3: with no free band tall enough the captions shrink into the tallest one, never under 70%", () => {
  // Captions in their usual place at 1.8 times the size: the band is taller than any run the picture-in-picture leaves.
  const { settled, overlay, gate } = run({ position: "auto", size: 1.8 });
  assert.equal(settled.checked.ok, true, settled.checked.errors.join("\n"));
  const zone = overlay.zones.find((entry) => entry.start === 15);
  assert.ok(zone.scale >= CAPTION_BAND_FIT.minScale && zone.scale < 1, `scale ${zone.scale}`);
  assert.ok(settled.placed.some((line) => new RegExp(`^captions 15–18 s shrunk to ${Math.round(zone.scale * 100)}% and moved (above|below) mix`).test(line)), settled.placed.join("\n"));
  assert.deepEqual(settled.hidden, []);
  assert.equal(gate.share, 0);
});

// A scene laid out by hand: a diagram that fills the frame, leaving `above` px clear over it.
const diagram = (above) => (scene, resolved, canvas) => (scene.id === "boards"
  ? [{ id: "boards", role: "hero", rect: { x: 80, y: 280 + above, width: 860, height: 1450 - 280 - above }, start: Number(scene.start), end: Number(scene.end) }]
  : []);
const boardsClash = "layout: caption-band @3s [boards, captions] boards sits in the caption band 65,826 853×269 while captions are visible (3s–6s); move it or set hidesCaptions";

test("steps 3 and 4 by geometry: a run of 70% of the band or more takes the captions shrunk; less hides them, and says why", () => {
  const resolve = (story) => resolveChecked(story, { words: BAND_WORDS, style: bandStyle() });
  const story = bandStory((scenes) => [{ ...scenes[1], module: "ui-scene", params: {} }]);
  // 269 px band, 24 px gap: 230 px clear above the diagram leaves a 206 px run (76%).
  const shrunk = fitCaptionBand(story, [boardsClash], { resolve, lay: diagram(230) });
  assert.deepEqual(shrunk.storyboard.overlays, [{ type: "captions", zones: [{ start: 3, end: 6, rect: { x: 65, y: 280, width: 853, height: 206 }, scale: 0.76 }] }]);
  assert.deepEqual(shrunk.changes, ["captions 3–6 s shrunk to 76% and moved above boards (y 280)"]);
  // 200 px clear leaves 176 px (65%): under the floor, so the captions hide for the clash.
  const hid = fitCaptionBand(story, [boardsClash], { resolve, lay: diagram(200) });
  assert.deepEqual(hid.storyboard.overlays, [{ type: "captions", hide: [[2.98, 6.02]] }]);
  assert.deepEqual(hid.hidden, ["captions 2.98–6.02 s under boards: boards cannot move and leaves no other free band 188 px tall above or below it"]);
  assert.deepEqual([hid.moved, hid.placed], [[], []]);
});

test("a zone tooling placed that the check still fails is withdrawn and the captions hide there", () => {
  const resolve = (story) => resolveChecked(story, { words: BAND_WORDS, style: bandStyle() });
  const story = { ...bandStory((scenes) => [scenes[5]]), overlays: [{ type: "captions", zones: [{ start: 15, end: 18, rect: { x: 65, y: 1171, width: 853, height: 269 } }] }] };
  const again = fitCaptionBand(story, ["layout: caption-band @15s [mix-text, captions@placed-1] mix-text sits in the caption band 65,1171 853×269 while captions are visible (15s–18s); move it or set hidesCaptions"], { resolve });
  assert.deepEqual(again.storyboard.overlays, [{ type: "captions", hide: [[14.98, 18.02]] }]);
  assert.match(again.hidden[0], /under mix-text: the band tooling moved them to is not clear either$/);
});

test("without a way to lay the story out, or from step 4, the captions are hidden over each clash, once", () => {
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
  assert.deepEqual(again.changes, []);
});

test("no captions overlay or no clash: the storyboard comes back as is", () => {
  const story = { scenes: [], overlays: [{ type: "progress" }] };
  assert.equal(fitCaptionBand(story, [ERROR]).storyboard, story);
  assert.equal(fitCaptionBand(story, ["validation: nope"]).storyboard, story);
  assert.equal(fitCaptionBand(null, [ERROR]).hidden.length, 0);
});

test("captions the style pack supplies (a story with no overlays of its own) get an overlay only when a range or a zone has to be written", () => {
  const story = { scenes: [] };
  const fitted = fitCaptionBand(story, [ERROR]);
  assert.deepEqual(fitted.storyboard.overlays, [{ type: "captions", hide: [[0.28, 1.42]] }], "no preset or position: the pack still fills those");
  assert.equal(story.overlays, undefined);
  // Content moves alone leave the story without one.
  const { settled } = run({ change: (scenes) => [scenes[0], scenes[1]] });
  assert.equal(settled.moved.length, 2);
  assert.equal(settled.storyboard.overlays, undefined);
});

test("settling takes a round again from the next step when its moves leave the checks with other errors", () => {
  const { story, checked, check, resolve } = run();
  // A check that fails any card tooling gave a rect: content moves by rect are refused, param moves are not.
  const strict = (candidate) => {
    const result = check(candidate);
    const errors = [...result.errors, ...candidate.scenes.filter((scene) => scene.params?.rect).map((scene) => `collision: ${scene.id} was moved onto something`)];
    return { ...result, ok: errors.length === 0, errors };
  };
  const settled = settleCaptionBand(story, checked, strict, { resolve });
  assert.equal(settled.checked.ok, true, settled.checked.errors.join("\n"));
  assert.deepEqual(settled.moved, [], "the round with rect moves was not kept");
  assert.equal(settled.placed.length, 7, "every clash had its captions moved instead");
  assert.deepEqual(settled.hidden, []);
  // Nothing to fit: the storyboard and the check come back as they were.
  const other = { ok: false, errors: ["validation: nope"] };
  const kept = settleCaptionBand(story, other, () => { throw new Error("not checked again"); }, { resolve });
  assert.equal(kept.storyboard, story);
  assert.equal(kept.checked, other);
  assert.deepEqual(kept.changes, []);
});

for (const [position, size] of [["middle", 1.4], ["top", 1.15], ["top", 1.6], ["low", 1.15], ["auto", 1.4], ["auto", 1.8], ["bottom", 1.15]]) {
  test(`captions ${position} at size ${size}: the fixture settles with nothing hidden`, () => {
    const { checked, settled, gate, overlay } = run({ position, size });
    assert.equal(settled.checked.ok, true, settled.checked.errors.join("\n"));
    assert.deepEqual(settled.hidden, []);
    assert.equal(gate.share, 0);
    assert.equal(settled.changes.length > 0, clashing(checked).length > 0);
    for (const zone of overlay?.zones ?? []) assert.ok(zone.rect.y >= 0 && zone.rect.y + zone.rect.height <= 1920 && (zone.scale ?? 1) >= CAPTION_BAND_FIT.minScale);
  });
}

test("captions are not moved twice for one clash: a zone already over it, or an overlay with its own rect, hides instead", () => {
  const resolve = (story) => resolveChecked(story, { words: BAND_WORDS, style: bandStyle() });
  const mixClash = "layout: caption-band @15s [mix-text, captions] mix-text sits in the caption band 65,826 853×269 while captions are visible (15s–18s); move it or set hidesCaptions";
  const zoned = { ...bandStory((scenes) => [scenes[5]]), overlays: [{ type: "captions", zones: [{ start: 15, end: 18, rect: { x: 65, y: 1171, width: 853, height: 269 } }] }] };
  const again = fitCaptionBand(zoned, [mixClash], { resolve });
  assert.deepEqual(again.placed, []);
  assert.match(again.hidden[0], /^captions 14\.98–18\.02 s under mix-text: moving the captions for this scene did not clear it$/);
  const own = { ...bandStory((scenes) => [scenes[5]]), overlays: [{ type: "captions", rect: { x: 65, y: 826, width: 853, height: 269 } }] };
  assert.match(fitCaptionBand(own, [mixClash], { resolve }).hidden[0], /the captions have a rect of their own$/);
});
