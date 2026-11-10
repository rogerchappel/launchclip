// Drawing traits → what LaunchClip can draw (src/drawing_match.js), the
// distance between two traits blocks (kit/core/style-distance.mjs) and the
// pack `style create --from-reference` drafts from them, on frames painted in
// the test (test/helpers/draw_frames.js).
import assert from "node:assert/strict";
import test from "node:test";

import { DRAWING_STYLES } from "@launchclip/core/characters/styles.mjs";
import { DRAWING_DISTANCE_WEIGHTS, drawingDistanceReport } from "@launchclip/core/style-distance.mjs";
import { validateStylePack } from "@launchclip/core/style.mjs";
import { DRAWING_STYLE_MATCH, mapDrawingTraits, matchDrawingStyle } from "../src/drawing_match.js";
import { DRAWING_STYLE_PROFILES } from "../src/drawing_style_profiles.js";
import { DRAWING_TRAITS_SCHEMA, drawingNumbers, drawingTraits } from "../src/drawing_traits.js";
import { compareDrawing, drawingSampleStory } from "../src/style_compare.js";
import { draftStyleFromReferences } from "../src/style_reference.js";
import { noise, scene } from "./helpers/draw_frames.js";

const block = (frames, motion = null) => drawingTraits(drawingNumbers(frames, motion));
const reference = (name, frames, motion = null) => ({ name, sha256: "0".repeat(64), kind: motion ? "video" : "image", width: 960, height: 540, duration_seconds: motion ? 4 : 0, palette: [{ hex: "#f0ece4", weight: 0.7 }, { hex: "#e65a3c", weight: 0.1 }, { hex: "#3c78dc", weight: 0.1 }, { hex: "#1c1820", weight: 0.1 }], drawing: drawingNumbers(frames, motion) });

test("every measured drawing style is its own nearest match; a style with no profile yet is skipped and named", () => {
  // A style can land in the kit before its profile is measured (node scripts/measure-drawing-styles.mjs): that is reported, not an error.
  const measured = DRAWING_STYLES.filter((name) => DRAWING_STYLE_PROFILES[name]?.outline && DRAWING_STYLE_PROFILES[name]?.fill);
  assert.ok(measured.length >= 10, "the profile table is missing");
  const pending = DRAWING_STYLES.filter((name) => !measured.includes(name));
  for (const name of measured) {
    const match = matchDrawingStyle(DRAWING_STYLE_PROFILES[name]);
    assert.equal(match.name, name);
    assert.equal(match.distance, 0);
    assert.deepEqual(match.unprofiled, pending);
  }
  // No profiles at all: nothing is matched, and mapping says so instead of throwing.
  const traits = DRAWING_STYLE_PROFILES.flat;
  assert.equal(matchDrawingStyle(traits, { profiles: {} }), null);
  const none = mapDrawingTraits({ traits: { ...traits, fill: { ...traits.fill, even_area: 0.8 } }, unmeasured: [] }, { profiles: {}, styles: ["chibi", "chibi-plain"] });
  assert.equal(none.apply.cast, undefined);
  assert.match(none.unmatched.find((entry) => entry.trait === "drawing style").reason, /chibi, chibi-plain/);
});

test("an inked reference matches an inked style, a flat one a style without outlines; a style with no profile is named", () => {
  const inked = matchDrawingStyle(block([scene({ outline: 3 })]).traits);
  assert.ok(DRAWING_STYLE_PROFILES[inked.name].outline.presence > 0.5, `${inked.name} is not an inked style`);
  const plain = matchDrawingStyle(block([scene()]).traits);
  assert.ok(DRAWING_STYLE_PROFILES[plain.name].outline.presence < 0.2, `${plain.name} draws outlines`);
  assert.notEqual(inked.name, plain.name);
  const withNew = matchDrawingStyle(block([scene()]).traits, { styles: [...DRAWING_STYLES, "woodcut"] });
  // Every style with no measured profile yet is named, the new one among them.
  assert.deepEqual(withNew.unprofiled, [...DRAWING_STYLES.filter((style) => !DRAWING_STYLE_PROFILES[style]), "woodcut"]);
  assert.equal(matchDrawingStyle({ palette: {} }), null, "nothing to match on");
});

test("mapping sets only what has a dial and says what has none", () => {
  const twos = { fps: 24, stepping: { frames: 96, shares: { ones: 0, twos: 1, threes: 0, fours: 0 }, hold: 2 }, grain_motion: 0.02 };
  const mapped = mapDrawingTraits(block([noise(scene({ outline: 3, discs: false, radius: 0 }), 6)], twos));
  assert.ok(DRAWING_STYLES.includes(mapDrawingTraits(block([scene({ outline: 3 })])).apply.cast.drawing_style));
  assert.equal(mapped.apply.background.kind, "paper");
  assert.equal(mapped.apply.vocabulary.illustration, "flat");
  assert.equal(mapped.apply.panel_radius, 4);
  const unmatched = mapped.unmatched.map((entry) => entry.trait);
  for (const trait of ["line weight", "outline colour", "grain", "stepping"]) assert.ok(unmatched.includes(trait), `${trait} has no dial and must be reported`);
  assert.match(mapped.unmatched.find((entry) => entry.trait === "stepping").measured, /twos, 12 drawings a second/);
  for (const entry of mapped.matched) assert.ok(entry.confidence > 0 && entry.confidence <= 1 && entry.why);

  // Line art: line illustrations and outline icons.
  const line = mapDrawingTraits(block([scene({ outline: 3, fill: false })]));
  assert.deepEqual(line.apply.vocabulary, { illustration: "line", icon_style: "outline" });

  // A reference unlike every style is not given one.
  const strange = block([scene({ outline: 3 })]);
  const far = mapDrawingTraits(strange, { profiles: { flat: { outline: { presence: 0, line_share: 0 }, fill: { cel: 0.9, shaded: 0.9 } } }, styles: ["flat"] });
  assert.equal(far.apply.cast, undefined);
  assert.match(far.unmatched.find((entry) => entry.trait === "drawing style").reason, new RegExp(`within ${DRAWING_STYLE_MATCH}`));

  // Two styles equally near: neither is set, and the report says which two.
  const near = { outline: { presence: 0.5, line_share: 0.5 }, fill: { cel: 0, shaded: 0 } };
  const toss = mapDrawingTraits(strange, { profiles: { flat: near, line: near, outlined: { outline: { presence: 0, line_share: 0 }, fill: { cel: 0, shaded: 0 } } }, styles: ["flat", "line", "outlined"] });
  assert.equal(toss.apply.cast, undefined);
  assert.match(toss.unmatched.find((entry) => entry.trait === "drawing style").reason, /is as near/);

  // Noise from edge to edge is not a drawing: nothing is set from it.
  const footage = mapDrawingTraits(block([noise(scene(), 40)]));
  assert.equal(footage.apply.cast, undefined);
  assert.equal(footage.apply.background, undefined);
});

test("drawing distance: zero to itself, apart on the trait that differs, unmeasured parts left out", () => {
  const flat = block([scene()]), inked = block([scene({ outline: 4 })]), thin = block([scene({ outline: 2 })]);
  assert.equal(Math.round(Object.values(DRAWING_DISTANCE_WEIGHTS).reduce((a, b) => a + b, 0) * 1000), 1000);
  const same = drawingDistanceReport(inked, inked);
  assert.equal(same.distance, 0);
  assert.deepEqual(same.unmeasured, ["stepping"]);
  const lines = drawingDistanceReport(flat, inked);
  assert.ok(lines.parts.outline > 0.8 && lines.parts.line_weight === 1, JSON.stringify(lines.parts));
  assert.ok(lines.parts.shape < 0.1 && lines.parts.grain === 0);
  const weight = drawingDistanceReport(inked, thin);
  assert.ok(weight.parts.outline < 0.05 && Math.abs(weight.parts.line_weight - 0.5) < 0.1, JSON.stringify(weight.parts));
  assert.ok(lines.distance > weight.distance && weight.distance > 0);
  const round = drawingDistanceReport(block([scene({ discs: false, radius: 0 })]), flat);
  assert.ok(round.parts.shape > 0.7);
  const grain = drawingDistanceReport(block([noise(scene(), 6)]), flat);
  assert.ok(grain.parts.grain > 0.7);
  const twos = (hold) => ({ fps: 24, stepping: { frames: 96, shares: { ones: hold === 1 ? 1 : 0, twos: hold === 2 ? 1 : 0, threes: 0, fours: 0 }, hold }, grain_motion: null });
  assert.equal(drawingDistanceReport(block([scene()], twos(2)), block([scene()], twos(1))).parts.stepping, 1);
});

test("a drafted pack keeps the traits beside the other reference stats, and is a valid pack", () => {
  const { pack, report, inferred } = draftStyleFromReferences("inked-look", [reference("a.png", [scene({ outline: 3 })]), reference("b.png", [scene({ outline: 3, discs: false })])]);
  const drawing = pack.reference_stats.drawing;
  assert.equal(drawing.schema, DRAWING_TRAITS_SCHEMA);
  assert.equal(drawing.frames, 2);
  assert.equal(drawing.traits.outline.label, "outlined");
  for (const trait of Object.values(drawing.traits)) assert.ok(typeof trait.confidence === "number");
  assert.ok(drawing.unmeasured.some((entry) => entry.trait === "stepping"));
  assert.ok(drawing.match.matched.length && drawing.match.unmatched.length);
  assert.equal(pack.cast.drawing_style, inferred.drawing.apply.cast.drawing_style);
  assert.equal(pack.background.kind, "flat");
  assert.equal(pack.vocabulary.illustration, "flat");
  assert.equal(pack.vocabulary.icon_tint, "primary", "the vocabulary defaults stay");
  const validation = validateStylePack(pack);
  assert.deepEqual(validation.errors, []);
  assert.match(report, /## Drawing/);
  assert.match(report, /cast\.drawing_style: \*\*/);
  assert.match(report, /### Not matched/);
  assert.match(report, /line weight \(/);
  assert.match(report, /no character, face or design of the reference is copied/);

  // References measured without drawing traits draft as before.
  const { pack: plain, report: plainReport } = draftStyleFromReferences("plain", [{ ...reference("a.png", [scene()]), drawing: null }]);
  assert.equal(plain.reference_stats.drawing, undefined);
  assert.equal(plain.cast, undefined);
  assert.match(plainReport, /## Drawing\n\nNot measured\./);
});

test("compare: a sample drawn like the reference is close; one that is not names the trait and the field", () => {
  const { pack } = draftStyleFromReferences("inked-look", [reference("a.png", [scene({ outline: 3 })])]);
  const close = compareDrawing(pack, block([scene({ outline: 3 })]));
  assert.equal(close.distance, 0);
  assert.ok(close.traits.every((entry) => !entry.apart && !entry.hint));
  const apart = compareDrawing(pack, block([scene({ discs: false, radius: 0 })]));
  const byTrait = Object.fromEntries(apart.traits.map((entry) => [entry.trait, entry]));
  assert.ok(byTrait.outline.apart && /cast\.drawing_style/.test(byTrait.outline.hint));
  assert.ok(byTrait.shape.apart && /layouts\.panel\.radius/.test(byTrait.shape.hint));
  assert.ok(byTrait.line_weight.apart && /No dial/.test(byTrait.line_weight.hint));
  assert.ok(!byTrait.grain.apart);
  assert.deepEqual(apart.unmeasured.map((entry) => entry.trait), ["stepping"]);
  assert.throws(() => compareDrawing({ name: "bare", reference_stats: {} }, block([scene()])), /keeps no drawing traits/);

  // The sample story shows a figure in the pack's drawing style on the style's own backdrop.
  const story = drawingSampleStory(pack);
  assert.equal(story.style, "inked-look");
  assert.equal(story.scenes.filter((entry) => entry.module === "character-cameo").length, 1);
  assert.equal(story.cast.style, undefined, "the pack gives the drawing style");
  assert.ok(!drawingSampleStory({ ...pack, cast: undefined }).scenes.some((entry) => entry.module === "character-cameo"));
});
