// Text never collides: caption presets that keep a host's look (kinetic
// hierarchy, soft card, weight/spacing/case options, the scrim), captions
// that repeat a card, the caption band over a card's whole time on screen
// and the preset's real line height, footage text clear of the brand frame,
// overview holds that never stack two cards, and world fades that hand over.
import assert from "node:assert/strict";
import test from "node:test";
import { CAPTION_PRESETS, captionEchoHide, captionHierarchy, captionLineExtent, captionOptions, captionPlan, chunkWords, sceneTextWords } from "@launchclip/core/captions.mjs";
import { checkLayout } from "@launchclip/core/layout-check.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { coveredPlates, sceneWindows, transitionTweens } from "@launchclip/core/transitions.mjs";
import { brandFrameLayout } from "@launchclip/core/brand-frame.mjs";

const W = 1080, H = 1920;
const FORMAT = { width: W, height: H, fps: 30, duration: 12 };
const BRAND = { colors: { bg: "#101418", primary: "#8fd4d5", accent: "#8fd4d5", ink: "#0b0b0f", paper: "#ffffff" }, fonts: { display: "anton", body: "outfit", meta: "jetbrains-mono" } };
const timed = (text, from = 0, step = 0.4) => text.split(" ").map((word, i) => ({ text: word, start: from + i * step, end: from + i * step + step - 0.05 }));

test("kinetic-hierarchy: small connecting words, one large hero per line glowing in the active colour, no box", () => {
  const roles = captionHierarchy(timed("the 3 boards"));
  assert.deepEqual(roles.map((role) => role.role), ["context", "hero", "body"]);
  assert.equal(captionHierarchy(timed("composite decking boards")).find((role) => role.role === "hero").scale, 1.8);
  const plan = captionPlan(chunkWords(timed("In Australia, hardwood and composite are choices")), { type: "captions", preset: "kinetic-hierarchy", colors: { active: "primary" } }, { brand: BRAND, format: FORMAT });
  const first = plan.nodes[0];
  assert.match(first.children[0].cls, /lc-cap-ctx/);
  assert.match(first.children[1].cls, /lc-cap-hero lc-cap-h\d+/);
  assert.match(plan.css, /\.lc-cap-hero \{[^}]*0 0 48px #8fd4d599/);
  assert.match(plan.css, /text-transform: none/);
  assert.doesNotMatch(plan.css, /lc-cap-box/);
  // Each word arrives at its own start and stays (cumulative), the line fades at its end.
  const word = plan.tweens.filter((tween) => tween.id === `${first.id}-w1`);
  assert.equal(word.length, 1);
  assert.equal(word[0].from.opacity, 0);
});

test("soft-card draws the line on a card in the plate colour; weight, letter spacing and lower case are options", () => {
  const card = captionPlan(chunkWords(timed("pick the right board")), { type: "captions", preset: "soft-card", colors: { plate: "primary", idle: "#18181b" } }, { brand: BRAND, format: FORMAT });
  assert.match(card.css, /\.lc-cap-plate \{ background: #8fd4d5;/);
  assert.ok(card.nodes.every((node) => /lc-cap-plate/.test(node.cls)));
  const o = captionOptions({ type: "captions", preset: "minimal-line", weight: 700, letter_spacing: 0.34, case: "lower" }, { brand: BRAND, format: FORMAT });
  assert.equal(o.weight, 700);
  assert.equal(o.letterSpacing, "0.34em");
  assert.equal(o.case, "lower");
  const base = { schema: "launchclip.story.v1", lane: "motion", format: FORMAT, brand: BRAND, scenes: [{ id: "s1", module: "hook-title", start: 0, end: 4, params: { headline: "Hi" } }] };
  assert.equal(validateStory({ ...base, overlays: [{ type: "captions", preset: "kinetic-hierarchy", weight: 700, letter_spacing: 0.1, case: "lower", plate_style: "scrim" }] }).ok, true);
});

test("a box-less preset is helped to read with a scrim, not a box", () => {
  assert.equal(CAPTION_PRESETS["kinetic-hierarchy"].plateStyle, "scrim");
  const plan = captionPlan(chunkWords(timed("over a bright sky")), { type: "captions", preset: "kinetic-hierarchy", plates: "all" }, { brand: BRAND, format: FORMAT });
  assert.match(plan.css, /\.lc-cap-legible \{ background: radial-gradient/);
  assert.doesNotMatch(plan.css, /\.lc-cap-legible \{[^}]*border-radius/);
  const boxed = captionPlan(chunkWords(timed("over a bright sky")), { type: "captions", preset: "word-highlight", plates: "all" }, { brand: BRAND, format: FORMAT });
  assert.match(boxed.css, /\.lc-cap-legible \{ background: #[0-9a-f]{6}eb;/);
});

test("a caption line that repeats a card on screen is hidden while the card is up", () => {
  const story = { scenes: [
    { id: "cta", module: "cta", start: 9.8, end: 12, params: { headline: "Save this video for your deck plans.", icon: "assets/icons/save.svg" } },
    { id: "list", module: "checklist", start: 0, end: 6, params: { title: "All need care", items: [{ label: "Hardwood" }, { label: "Treated pine" }] } }
  ] };
  assert.deepEqual(sceneTextWords(story.scenes[1].params), ["all", "need", "care", "hardwood", "treated", "pine"]);
  // The checklist names "treated pine" too, but a list keeps its captions.
  const chunks = chunkWords([...timed("treated pine needs", 1), ...timed("Save this video for your deck plans now", 10)]);
  const hidden = captionEchoHide(story, chunks);
  assert.deepEqual(hidden, [[10, 11.2], [11.2, 12.4]]);
  const plan = captionPlan(chunks, { type: "captions", preset: "word-highlight" }, { brand: BRAND, format: FORMAT, story });
  assert.deepEqual(plan.nodes.map((node) => node.children.map((child) => child.text).join(" ")), ["treated pine needs", "plans now"]);
});

test("the caption band counts a card's enter, exit and outgoing hold, and every clash", () => {
  const band = { x: 65, y: 845, width: 853, height: 230 };
  const card = { id: "card", role: "text", rect: { x: 100, y: 800, width: 800, height: 300 }, start: 2, end: 4, shownEnd: 4.6, motion: { enterEnd: 2.5, exitStart: 3.6 } };
  const report = checkLayout({ canvas: { width: W, height: H }, captionBand: band, elements: [card, { id: "captions", role: "caption", rect: band, start: 0, end: 10, hide: [[2.8, 3.2]] }] });
  const clashes = report.findings.filter((finding) => finding.rule === "caption-band");
  // Captions over the enter (2–2.8) and over the exit and the hold under the next scene (3.2–4.6).
  assert.deepEqual(clashes.map((finding) => finding.at), [2, 3.2]);
  assert.match(clashes[1].detail, /3\.2s–4\.6s/);
});

test("a stacked or hero caption line is taller than the band; the band grows to it", () => {
  const stack = captionOptions({ type: "captions", preset: "kinetic-stack", size: 1.15 }, { brand: BRAND, format: FORMAT });
  assert.ok(captionLineExtent(stack, FORMAT) > 230, `${captionLineExtent(stack, FORMAT)}`);
  const quiet = captionOptions({ type: "captions", preset: "minimal-line" }, { brand: BRAND, format: FORMAT });
  assert.ok(captionLineExtent(quiet, FORMAT) < 230);
});

test("footage text keeps clear of the brand frame's kicker", () => {
  const story = resolveStory({
    schema: "launchclip.story.v1", lane: "motion", format: FORMAT, brand: BRAND,
    frame: { enabled: true, logo: "assets/logo.png", kicker: { label: "Brand", position: "top-left", logo: true }, sections: false },
    scenes: [{ id: "shot", module: "clip", start: 0, end: 6, params: { media: { src: "assets/deck.mp4", kind: "video" }, position: "top", callouts: ["Regular care"] } }]
  });
  const kicker = brandFrameLayout(story).regions.find((region) => region.id === "frame-kicker").rect;
  const model = resolveModule(story.scenes[0], story);
  const callouts = model.layout.parts.find((part) => part.id === "callouts").rect;
  assert.ok(callouts.y >= kicker.y + kicker.height - 1e-6, `callouts at y ${callouts.y}, kicker ends at ${kicker.y + kicker.height}`);
});

test("an overview holds only the top shot of each spot, so two cards never stack", () => {
  const story = resolveStory({
    schema: "launchclip.story.v1", lane: "motion", format: { ...FORMAT, duration: 20 }, brand: BRAND, camera: { mode: "world" },
    scenes: [
      { id: "a", module: "hook-title", start: 0, end: 4, params: { headline: "Hardwood" } },
      { id: "b", module: "hook-title", start: 4, end: 8, in: { type: "pan", dur: 0.8, direction: "right" }, params: { headline: "Composite materials" } },
      { id: "c", module: "hook-title", start: 8, end: 12, in: { type: "fade", dur: 0.6 }, params: { headline: "Composite board" } },
      { id: "d", module: "hook-title", start: 12, end: 16, in: { type: "pan", dur: 0.8, direction: "down" }, params: { headline: "Treated pine" } },
      { id: "e", module: "hook-title", start: 16, end: 20, in: { type: "overview", dur: 2.6, span: 4 }, params: { headline: "All need care" } }
    ]
  });
  const windows = sceneWindows(story);
  const byId = Object.fromEntries(windows.scenes.map((entry) => [entry.id, entry]));
  assert.deepEqual([...coveredPlates(windows.scenes.filter((entry) => entry.plate))], ["b"]);
  assert.equal(byId.a.holds.length, 1);
  assert.deepEqual(byId.b.holds, [], "b sits under c (a fade lands on the same spot)");
  assert.equal(byId.c.holds.length, 1);
});

test("world fades hand over: the outgoing plate clears before the incoming one is up", () => {
  const { in: incoming, out } = transitionTweens({ type: "fade", dur: 1 }, { width: W, height: H, mode: "world" });
  assert.ok(out[0].start + out[0].duration <= incoming[0].start + 0.1 + 1e-9);
  for (const type of ["push", "pull"]) {
    const tweens = transitionTweens({ type, dur: 1 }, { width: W, height: H, mode: "world" });
    assert.ok(tweens.out[0].start + tweens.out[0].duration <= tweens.in[0].start + 0.06 + 1e-9, type);
  }
  // Cuts mode keeps the plain crossfade over an opaque plate.
  assert.equal(transitionTweens({ type: "fade", dur: 1 }, { width: W, height: H, mode: "cuts" }).in[0].start, 0);
});

test("a clip's callouts in one slot never overlap: each is gone by its until", async () => {
  const { clipTimeline } = await import("@launchclip/core/catalog-d-clip.mjs");
  const story = resolveStory({
    schema: "launchclip.story.v1", lane: "motion", format: FORMAT, brand: BRAND,
    scenes: [{ id: "shot", module: "clip", start: 0, end: 6, params: { media: { src: "assets/deck.mp4", kind: "video" }, callouts: ["Treated pine", "Composite"] } }]
  });
  const model = resolveModule(story.scenes[0], story);
  const ops = clipTimeline(model).filter((op) => op.type === "tween" && /callout/.test(op.target) && op.to?.opacity !== undefined);
  const [first, second] = model.content.callouts;
  const out = ops.find((op) => op.target === "shot-callout-0" && op.to.opacity === 0);
  const into = ops.find((op) => op.target === "shot-callout-1" && op.to.opacity === 1);
  assert.ok(out.start + out.duration <= first.until + 1e-6, `${out.start} + ${out.duration} > ${first.until}`);
  assert.ok(into.start >= first.until - 1e-6 && second.at === into.start);
});
