// The reading gradient (kit/core/reading-gradient.mjs): one CSS gradient both
// renderers draw over a photo or video, from the brand's palette tokens.
import assert from "node:assert/strict";
import test from "node:test";
import { readingColor, readingGradient, readingGradientErrors } from "@launchclip/core/reading-gradient.mjs";
import { platePlan, resolvePlate } from "@launchclip/core/plates.mjs";
import { contrast, mix } from "@launchclip/core/panels.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { validateStory } from "@launchclip/core/story.mjs";
import { slideContinuity } from "@launchclip/core/carousel-continuity.mjs";
import { CAROUSEL_TEMPLATES, layoutCarousel, templateProblems } from "@launchclip/core/carousel-templates.mjs";

const colors = { bg: "#10140f", primary: "#e0a33a", paper: "#f4efe6" };
const brand = { colors: { ...colors, accent: "#8fd3c8", ink: "#10140f" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const story = (extra = {}) => ({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1350, fps: 30, duration: 4 }, brand, scenes: [], ...extra });

test("the gradient is solid from its edge to the first stop and clear from the second, in a palette colour", () => {
  const css = readingGradient({ direction: "bottom", stops: [0.6, 0.9], opacity: 0.9 }, colors);
  assert.match(css, /^linear-gradient\(0deg, #10140fe6 0%, #10140fe6 60%, .* #10140f00 90%, #10140f00 100%\)$/);
  assert.match(readingGradient({ direction: "top" }, colors), /^linear-gradient\(180deg,/);
  assert.equal(readingGradient({ direction: "full", opacity: 0.6 }, colors), "#10140f99", "full is the flat layer");
  const both = readingGradient({ direction: "both", stops: [0.2, 0.5], opacity: 1 }, colors);
  assert.match(both, /#10140fff 0%.*#10140f00 50%.*#10140fff 100%\)$/, "solid at both edges, clear in the middle");
  assert.equal(readingColor({ color: "primary" }, colors), "#e0a33a");
  assert.equal(readingColor({ color: "ground", tint: 0.3 }, colors), mix(colors.bg, colors.primary, 0.3), "a ground tinted by the primary");
  assert.match(readingGradient({ stops: [0, 0.4] }, colors, { edge: "right" }), /^linear-gradient\(270deg,/, "a seam anchors it");
});

test("a malformed gradient is refused field by field", () => {
  assert.deepEqual(readingGradientErrors({ color: "primary", tint: 0.2, direction: "both", stops: [0.1, 0.5], opacity: 1 }), []);
  const errors = readingGradientErrors({ color: "#000000", tint: 0.9, direction: "left", stops: [0.8, 0.4], opacity: 0.1, hue: 1 }, "g").join("\n");
  for (const field of ["g.hue", "g.color", "g.tint", "g.direction", "g.opacity", "g.stops"]) assert.ok(errors.includes(field), field);
  assert.match(readingGradientErrors({ direction: "both", stops: [0.3, 0.7] }).join(), /clear by 0.5/);
});

test("an image plate draws the gradient in place of its flat dim and reports the solid end's tone", () => {
  const gradient = { direction: "bottom", stops: [0.6, 0.95], opacity: 0.9 };
  const plan = platePlan(story(), resolvePlate({ kind: "image", params: { src: "assets/p.jpg", blur: 0, gradient } }));
  const dim = plan.layers.find((layer) => layer.id === "dim");
  assert.equal(dim.style.background, readingGradient(gradient, plan.colors));
  assert.equal(dim.style.opacity, undefined);
  assert.ok(plan.tones.includes(mix("#ffffff", plan.colors.bg, 0.9)));
  const flat = platePlan(story(), resolvePlate({ kind: "image", params: { src: "assets/p.jpg", dim: 0.6 } }));
  assert.equal(flat.layers.find((layer) => layer.id === "dim").style.opacity, 0.6, "{dim} stays a flat layer");
});

test("a video plate holds the gradient's solid end to the contrast floor", () => {
  const gradient = { direction: "bottom", stops: [0.6, 1], opacity: 0.4 };
  const plan = platePlan(story(), resolvePlate({ kind: "video", params: { src: "assets/clip.mp4", gradient, peak: 1 } }));
  const dim = plan.layers.find((layer) => layer.id === "dim");
  assert.ok(plan.params.dim > 0.4, "raised above the asked opacity on bright footage");
  assert.equal(dim.style.background, readingGradient({ ...gradient, opacity: plan.params.dim }, plan.colors));
  assert.ok(contrast(plan.colors.paper, mix("#ffffff", plan.colors.bg, plan.params.dim)) >= 4.5);
});

test("the story validator, photo-scene, split-screen and the panorama take a gradient", () => {
  const gradient = { color: "ground", stops: [0.5, 0.9], opacity: 0.85 };
  const plated = story({ scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, plate: { kind: "video", params: { src: "assets/clip.mp4", gradient } }, params: { headline: "Oil a deck" } }] });
  assert.ok(!validateStory(plated).errors.some((e) => /gradient/.test(e)), validateStory(plated).errors.join("\n"));
  const bad = story({ scenes: [{ ...plated.scenes[0], plate: { kind: "image", params: { src: "assets/p.jpg", gradient: { stops: [1, 0] } } } }] });
  assert.ok(validateStory(bad).errors.some((e) => /plate\.params\.gradient\.stops/.test(e)));

  const photo = { id: "p", module: "photo-scene", start: 0, end: 4, params: { media: "assets/p.jpg", lines: ["Oil a deck"], align: "center", gradient } };
  const scene = resolveModule(photo, story({ scenes: [photo] }));
  assert.equal(scene.content.scrim, "gradient");
  assert.equal(scene.content.scrimBackground, readingGradient(gradient, { bg: colors.bg, primary: colors.primary }));

  const split = { id: "s", module: "split-screen", start: 0, end: 4, params: { media: "assets/p.jpg", variant: "top", title: "Oil a deck", fade: { stops: [0, 0.4], opacity: 1 } } };
  const panel = resolveModule(split, story({ scenes: [split] }));
  const blend = panel.content.decor.find((d) => d.key === "blend");
  assert.match(blend.style.background, /^linear-gradient\(0deg, #10140fff 0%/, "solid at the seam under a top photo");

  const pano = story({ format: { kind: "carousel", width: 1080, height: 1350, fps: 30, duration: 4 }, carousel: { arc: "story", panorama: { src: "assets/pano.jpg", slides: [1, 2], reading: gradient } }, scenes: [{ id: "a" }, { id: "b" }] });
  assert.equal(slideContinuity(pano, "b").panorama.reading, readingGradient(gradient, brand.colors));
});

test("templates: reading takes a gradient or a panel fade", () => {
  for (const id of ["cinematic-dark", "cinematic-light", "numbered-steps", "caption-block", "photo-essay"]) assert.deepEqual(templateProblems(id), [], id);
  const broken = { ...CAROUSEL_TEMPLATES["cinematic-dark"], reading: { dim: 0.6, gradient: { opacity: 2 }, panel: { direction: "top" } } };
  const errors = templateProblems("x", broken).join("\n");
  assert.match(errors, /dim \(a flat layer\) or gradient/);
  assert.match(errors, /reading\.gradient\.opacity/);
  assert.match(errors, /reading\.panel takes no direction/);
  const slides = [{ role: "cover", headline: "How to reset your week", photo: "assets/p.jpg" }, { role: "body", headline: "Clear the desk" }];
  const steps = layoutCarousel("numbered-steps", slides, { brand });
  assert.deepEqual(steps.scenes[0].params.fade, CAROUSEL_TEMPLATES["numbered-steps"].reading.panel, "the cover photo fades into its panel");
});
