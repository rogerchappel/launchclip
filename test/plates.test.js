import assert from "node:assert/strict";
import test from "node:test";
import { PLATE_DEFAULT_TINT, PLATE_KINDS, PLATE_PARAMS, PLATE_TINTS, plateErrors, platePlan, resolvePlate, scenePlatePlan, scenePlateSpec, storyPlateErrors, storyPlatePlan } from "../kit/core/plates.mjs";
import { layerStateAt, layerTweens } from "../kit/core/backgrounds.mjs";
import { contrast } from "../kit/core/panels.mjs";
import { STORY_PLATE_KINDS, resolveStory, validateStory } from "../kit/core/story.mjs";
import { applyStyle, validateStylePack } from "../kit/core/style.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DARK = Object.freeze({ bg: "#05070c", paper: "#f4f7fb", ink: "#05070c", primary: "#38e1ff", accent: "#ff8a3d" });
const LIGHT = Object.freeze({ bg: "#f5f1e8", primary: "#c2410c", accent: "#0e7490", ink: "#f5f1e8", paper: "#1c1917" });

function story(extra = {}, colors = DARK) {
  return {
    schema: "launchclip.story.v1", lane: "motion", title: "Plate test",
    format: { width: 1920, height: 1080, fps: 30, duration: 30 },
    brand: { colors: { ...colors }, fonts: { display: "inter" } },
    chapters: [{ id: "a", title: "One", start: 0 }, { id: "b", title: "Two", start: 10 }, { id: "c", title: "Three", start: 20 }],
    scenes: [
      { id: "s1", module: "motion-title", start: 0, end: 5, params: { text: "One" } },
      { id: "s2", module: "motion-title", start: 5, end: 10, params: { text: "Two" } },
      { id: "s3", module: "motion-title", start: 10, end: 20, params: { text: "Three" } },
      { id: "s4", module: "motion-title", start: 20, end: 30, params: { text: "Four" } }
    ],
    ...extra
  };
}

test("story.mjs keeps its plate kinds in step with plates.mjs", () => {
  assert.deepEqual(STORY_PLATE_KINDS, PLATE_KINDS);
});

test("plateErrors accepts kinds, objects and every param at its bounds", () => {
  for (const kind of PLATE_KINDS) {
    assert.deepEqual(plateErrors(kind), []);
    for (const pick of ["min", "max", "default"]) assert.deepEqual(plateErrors({ kind, params: Object.fromEntries(Object.entries(PLATE_PARAMS).map(([key, value]) => [key, value[pick]])) }), []);
    for (const tint of PLATE_TINTS) assert.deepEqual(plateErrors({ kind, params: { tint } }), []);
  }
  assert.match(plateErrors("mesh")[0], /must be one of hex-shell/);
  assert.match(plateErrors({ kind: "silk", params: { focus: 2 } })[0], /focus must be a number from 0 to 1/);
  assert.match(plateErrors({ kind: "silk", params: { glow: 1 } })[0], /glow is not supported/);
  assert.match(plateErrors({ kind: "silk", cycle: true })[0], /cycle is not supported/);
  assert.deepEqual(plateErrors({ kind: "silk", cycle: true }, "plate", { allowCycle: true }), []);
  assert.match(plateErrors("none")[0], /must be one of/);
  assert.deepEqual(plateErrors("none", "x", { allowNone: true }), []);
});

test("validateStory reports the same plate errors as plates.mjs", () => {
  const bad = story({ plate: { kind: "silk", params: { speed: 3 } } });
  bad.chapters[1].plate = "glitter";
  bad.scenes[0].plate = { kind: "bokeh", params: { tint: "pink" } };
  const errors = validateStory(bad).errors;
  const expected = storyPlateErrors(bad);
  assert.equal(expected.length, 3);
  for (const message of expected) assert.ok(errors.includes(message), `${message} in ${errors.join("; ")}`);
  const good = story({ plate: { kind: "hex-shell", cycle: true } });
  good.chapters[2].plate = "none";
  good.scenes[1].plate = "silk";
  assert.deepEqual(validateStory(good).errors.filter((e) => /plate/.test(e)), []);
});

test("resolvePlate fills params and each kind's own tint", () => {
  for (const kind of PLATE_KINDS) {
    const plate = resolvePlate(kind);
    assert.equal(plate.kind, kind);
    assert.equal(plate.params.tint, PLATE_DEFAULT_TINT[kind]);
    for (const [key, spec] of Object.entries(PLATE_PARAMS)) assert.equal(plate.params[key], spec.default);
  }
  assert.equal(resolvePlate({ kind: "silk", params: { tint: "accent" } }).params.tint, "accent");
  assert.equal(resolvePlate(undefined), null);
  assert.equal(resolvePlate("none"), "none");
});

test("a plate holds within a chapter and changes at the next", () => {
  const s = resolveStory(story({ plate: { kind: "silk", cycle: true } }));
  const kinds = s.scenes.map((scene) => scenePlateSpec(s, scene).kind);
  // s1 and s2 share chapter a; b and c take the next kinds round the list.
  assert.deepEqual(kinds, ["silk", "silk", "strands", "bokeh"]);
  assert.equal(scenePlatePlan(s, s.scenes[0]), scenePlatePlan(s, s.scenes[1]), "one plan per plate, so the drift is continuous across the cut");
});

test("scene beats chapter beats story; none falls back to the background", () => {
  const raw = story({ plate: "hex-shell" });
  raw.chapters[1].plate = { kind: "bokeh", params: { tint: "accent" } };
  raw.scenes[1].plate = "silk";
  raw.scenes[3].plate = "none";
  const s = resolveStory(raw);
  assert.deepEqual(s.scenes.map((scene) => scenePlateSpec(s, scene)?.kind ?? null), ["hex-shell", "silk", "bokeh", null]);
  assert.equal(scenePlateSpec(s, s.scenes[2]).params.tint, "accent");
});

test("no plate without one named, on a footage-led story, or with ambient.background false", () => {
  const plain = resolveStory(story());
  assert.equal(scenePlateSpec(plain, plain.scenes[0]), null);
  assert.equal(storyPlatePlan(plain), null);
  const off = resolveStory(story({ plate: "silk", ambient: { background: false } }));
  assert.equal(scenePlateSpec(off, off.scenes[0]), null);
  const scene = { ...plain.scenes[0], ambient: { background: false }, plate: "silk" };
  assert.equal(scenePlateSpec(plain, scene), null);
  assert.equal(scenePlateSpec({ ...plain, lane: "footage-led", plate: "silk" }, plain.scenes[0]), null);
});

test("every plate keeps paper text at 4.5:1 on every tone, on a dark and a light palette", () => {
  for (const colors of [DARK, LIGHT]) for (const kind of PLATE_KINDS) for (const tint of PLATE_TINTS) for (const intensity of [0, 0.5, 1]) {
    const plan = platePlan(story({}, colors), { kind, params: { ...resolvePlate(kind).params, tint, intensity } });
    const floor = Math.min(4.5, contrast(colors.paper, colors.bg) - 0.01);
    for (const tone of plan.tones) assert.ok(contrast(colors.paper, tone) >= floor - 1e-6, `${kind} ${tint} ${intensity}: ${tone} ${contrast(colors.paper, tone)}`);
  }
});

test("plate layers are procedural, blurred SVG with no external files", () => {
  for (const kind of PLATE_KINDS) {
    const plan = platePlan(story(), resolvePlate(kind));
    assert.equal(plan.plate, true);
    const images = plan.layers.map((layer) => layer.style.backgroundImage).filter(Boolean);
    assert.ok(images.length >= 2, `${kind} has depth layers`);
    for (const image of images) {
      assert.match(image, /^url\('data:image\/svg\+xml,/);
      assert.equal(image.split("'").length, 3, "the only single quotes wrap the URI, so it sits in a style attribute");
      assert.match(decodeURIComponent(image), /feGaussianBlur/);
    }
    // Every layer box covers the canvas, so drift never shows an edge.
    for (const layer of plan.layers) assert.ok(layer.box.x <= 0 && layer.box.y <= 0 && layer.box.x + layer.box.width >= 1920 && layer.box.y + layer.box.height >= 1080);
  }
});

test("drift is seek-safe and parallax: near layers travel further than far ones", () => {
  const plan = platePlan(story(), resolvePlate("strands"));
  const reach = (layer) => Math.abs(layer.axes.x?.amp ?? 0);
  const byId = Object.fromEntries(plan.layers.map((layer) => [layer.id, layer]));
  assert.ok(reach(byId.near) > reach(byId.subject) && reach(byId.subject) > reach(byId.far));
  for (const layer of plan.layers) {
    for (const t of [0, 3.3, 17.25]) assert.deepEqual(layerStateAt(layer, t), layerStateAt(layer, t));
    if (Object.keys(layer.axes).length) assert.ok(layerTweens(layer, 2, 14).length > 0, `${layer.id} drifts`);
  }
  const still = platePlan(story({ ambient: "off" }), resolvePlate("strands"));
  for (const layer of still.layers) assert.deepEqual(layerTweens(layer, 0, 10), []);
});

test("the style pack's plate fills a story that has none", () => {
  const pack = { schema: "launchclip.style.v3", name: "plated", brand: { colors: { ...DARK } }, plate: { kind: "bokeh", cycle: true } };
  assert.deepEqual(validateStylePack(pack).errors ?? [], []);
  const merged = applyStyle(story(), pack).story ?? applyStyle(story(), pack);
  assert.deepEqual(merged.plate, { kind: "bokeh", cycle: true });
  const own = applyStyle(story({ plate: "silk" }), pack);
  assert.equal((own.story ?? own).plate, "silk");
  assert.match(validateStylePack({ ...pack, plate: { kind: "nope" } }).errors.join(" "), /plate.kind must be one of/);
});

test("HyperFrames draws each scene's plate and the chapter change", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-plates-"));
  try {
    const s = resolveStory(story({ plate: { kind: "silk", cycle: true } }));
    await compileStoryToHyperFrames(s, { projectDir: dir, sourceDir: dir });
    const html = await readFile(path.join(dir, "index.html"), "utf8");
    const kinds = [...html.matchAll(/data-launchclip-background="([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(kinds, ["silk", "silk", "strands", "bokeh"]);
    assert.match(html, /lc-bg-s1-subject/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("segment digests change with a story or chapter plate, and stay put without one", async () => {
  const { globalSettings, hashValue } = await import("../src/render_segments.js");
  const plain = resolveStory(story());
  assert.equal(globalSettings(plain).plate, undefined, "stories without a plate keep their digests");
  const plated = resolveStory(story({ plate: "silk" }));
  const other = resolveStory(story({ plate: "silk" }));
  other.chapters[1].plate = "bokeh";
  assert.notEqual(hashValue(globalSettings(plated)), hashValue(globalSettings(other)));
});

test("the GSAP tweens of every plate axis reproduce the cosine Remotion draws", () => {
  const sineInOut = (p) => -(Math.cos(Math.PI * p) - 1) / 2;
  for (const kind of PLATE_KINDS) {
    const plan = platePlan(story(), resolvePlate(kind));
    for (const layer of plan.layers) for (const [prop, axis] of Object.entries(layer.axes)) {
      assert.ok(Number.isInteger(axis.phase), `${kind} ${layer.id}.${prop}: phase ${axis.phase} must be whole half turns`);
      const tweens = layerTweens(layer, 0, 30).filter((tw) => tw.prop === prop);
      for (const t of [0.4, 3.3, 7.9, 12.5, 21.75, 29.1]) {
        const tw = tweens.find((entry) => t >= entry.at && t < entry.at + entry.duration);
        const gsap = tw.from + (tw.to - tw.from) * sineInOut((t - tw.at) / tw.duration);
        assert.ok(Math.abs(gsap - layerStateAt(layer, t)[prop]) < 0.01, `${kind} ${layer.id}.${prop} at ${t}: ${gsap} vs ${layerStateAt(layer, t)[prop]}`);
      }
    }
  }
});
