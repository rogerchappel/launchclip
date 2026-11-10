import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { LOOK_FURNITURE_ID, LOOK_INFO, LOOK_KEYS, LOOK_LAYER_ID, LOOK_NAMES, LOOK_STEP, LOOK_UNDER_ID, applyLook, lookCss, lookPlaneStyle, lookStageCss, lookUnderMarkup, lookDefs, lookErrors, lookFromText, lookPlan, lookPresets, lookPrimitives, lookStepEase, lookStepFrame, lookStepped, lookSteps, lookVariantAt, lookVarsAt, normalizeLook, stepFrame, stepIndex } from "@launchclip/core/look.mjs";
import { LOOKS, lookCastOptions } from "@launchclip/core/looks/index.mjs";
import { asciiCell } from "@launchclip/core/looks/ascii-terminal.mjs";
import { isometricFit } from "@launchclip/core/looks/isometric-layers.mjs";
import { rand } from "@launchclip/core/looks/parts.mjs";
import { STORY_LOOK_KEYS, STORY_LOOK_NAMES, resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { applyStyle, contrastRatio, validateStylePack } from "@launchclip/core/style.mjs";
import { generateStyle, normalizeConstraints, styleSummary } from "@launchclip/core/style-seed.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { constraintFlags, promptConstraints } from "../src/style_seed_store.js";
import { getRenderer } from "../src/renderers/index.js";
import { mediaSkip } from "./helpers/media.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const NAMED = LOOK_NAMES.filter((name) => name !== "none");
const COLORS = { bg: "#101014", paper: "#f2eee6", ink: "#101014", primary: "#fdb022", accent: "#46d4ff" };

// Two characters, a world and a card: the scene every look is checked on.
function story(extra = {}) {
  return {
    schema: "launchclip.story.v1", lane: "motion", title: "Rollback plan",
    format: { width: 1080, height: 1920, fps: 30, duration: 6 },
    brand: { colors: { ...COLORS }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
    world: { kind: "office" },
    cast: { characters: [{ id: "maya", position: "left" }, { id: "theo", position: "right" }] },
    scenes: [
      { id: "room", module: "world", start: 0, end: 3, params: { camera: "drift" } },
      { id: "street", module: "world", start: 3, end: 6, params: { kind: "city-street" } },
      { id: "pair", module: "cast-scene", track: 1, start: 0, end: 6, params: { set: "standing", cast: [{ id: "maya", pose: "point", expression: "happy" }, { id: "theo", pose: "wave", cues: [{ at: 3, pose: "think", expression: "surprised" }] }] } },
      { id: "idea", module: "concept-card", track: 2, start: 1.5, end: 6, params: { text: "Test the rollback", icon: "rocket", tone: "primary" } }
    ],
    ...extra
  };
}
const planOf = (look, extra = {}) => lookPlan(resolveStory(applyLook(story({ look, ...extra })).story));

async function minimal() {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  return { base, words };
}

test("the story validator keeps the look kit's names and keys", () => {
  assert.deepEqual(STORY_LOOK_NAMES, [...LOOK_NAMES]);
  assert.deepEqual(STORY_LOOK_KEYS, [...LOOK_KEYS]);
  assert.deepEqual(Object.keys(LOOK_INFO), NAMED);
  for (const name of NAMED) assert.ok(LOOK_INFO[name].describe.length > 40, `${name} says what it shows`);
});

test("a look is a name or {name, strength, step, furniture, palette, labels}, and every error names the fix", () => {
  for (const value of [undefined, null, "none", ...NAMED, { name: "hologram" }, { name: "blueprint", strength: 0.5, step: 12, furniture: false, palette: "brand", labels: ["Sheet A"] }, { name: "paper-cutout", step: false }]) assert.deepEqual(lookErrors(value), [], JSON.stringify(value));
  assert.match(lookErrors("holo")[0], /"holo" is called "hologram" here; use "hologram"/);
  assert.match(lookErrors({ name: "cyberpunk" })[0], /look\.name "cyberpunk" is called "neon-night" here/);
  assert.match(lookErrors("sepia")[0], /must be one of none, blueprint, hologram/);
  assert.match(lookErrors(3)[0], /a look name .* or \{name, strength\?, step\?, furniture\?, palette\?, labels\?\}/);
  const errors = lookErrors({ name: "thermal", strength: 2, step: 30, furniture: "no", palette: "mine", labels: ["x".repeat(40)], glow: 1 }, "style.look");
  assert.equal(errors.length, 6);
  assert.ok(errors.some((message) => /style\.look\.glow is not supported \(allowed: name, strength, step, furniture, palette, labels\)/.test(message)));
  assert.ok(errors.some((message) => new RegExp(`step must be false or the drawings a second .* ${LOOK_STEP.min} to ${LOOK_STEP.max} \\(12 animates on twos\\)`).test(message)));
  assert.ok(errors.some((message) => /palette must be "look" .* or "brand"/.test(message)));
  // The import-free story validator agrees.
  assert.equal(validateStory({ ...story({ look: "hologram" }) }).errors.filter((message) => /look/.test(message)).length, 0);
  assert.ok(validateStory(story({ look: "sepia" })).errors.some((message) => /^look must be one of/.test(message)));
  assert.ok(validateStory(story({ look: { name: "thermal", step: 40 } })).errors.some((message) => /look\.step/.test(message)));
});

test("normalizeLook fills each look's defaults, and none is no look", () => {
  assert.equal(normalizeLook("none"), null);
  assert.equal(normalizeLook({ name: "none", strength: 1 }), null);
  assert.equal(normalizeLook(undefined), null);
  assert.equal(normalizeLook("holo"), null, "an invalid look changes nothing");
  assert.deepEqual(normalizeLook("hologram"), { name: "hologram", strength: 1, step: 0, furniture: true, palette: "look", labels: [] });
  assert.equal(normalizeLook("paper-cutout").step, 12, "paper cutout animates on twos");
  assert.equal(normalizeLook({ name: "paper-cutout", step: false }).step, 0);
  assert.equal(lookPlan(story()), null);
  assert.equal(lookPlan(story({ look: "none" })), null);
});

test("applyLook fills the look's presets under the story's own values", () => {
  const bare = story({ look: "hologram" });
  delete bare.brand.colors;
  const filled = applyLook(bare);
  assert.equal(filled.story.brand.colors.bg, lookPresets("hologram").colors.bg);
  assert.equal(filled.story.world.time, "night");
  assert.equal(filled.story.world.kind, "office", "the story's world stays");
  assert.ok(filled.applied.includes("brand.colors.bg") && filled.applied.includes("world.time"));
  assert.equal(bare.world.time, undefined, "the input is not changed");
  // The story's own colours, style and time win.
  const own = applyLook(story({ look: "paper-cutout", cast: { style: "chibi", characters: [{ id: "maya" }] }, world: { kind: "park", time: "dusk" } })).story;
  assert.deepEqual(own.brand.colors, COLORS);
  assert.equal(own.cast.style, "chibi");
  assert.equal(own.world.time, "dusk");
  assert.deepEqual(own.background, lookPresets("paper-cutout").background);
  // palette "brand" brings no colours.
  assert.equal(lookPresets({ name: "hologram", palette: "brand" }).colors, undefined);
  // No look: the same object back.
  const plain = story();
  assert.equal(applyLook(plain).story, plain);
  assert.deepEqual(applyLook(plain).applied, []);
});

test("a style pack's look reaches the story: the story's values, then the look's, then the pack's", () => {
  const pack = { schema: "launchclip.style.v3", name: "t", brand: { colors: { bg: "#202020", paper: "#ffffff", ink: "#202020", primary: "#ff0000", accent: "#00ff00" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } }, cast: { drawing_style: "flat" }, world: { kind: "park", time: "day" }, look: "paper-cutout" };
  assert.deepEqual(validateStylePack(pack).errors, []);
  assert.ok(validateStylePack({ ...pack, look: "holo" }).errors.some((message) => /use "hologram"/.test(message)));
  const bare = story();
  delete bare.brand.colors;
  delete bare.world;
  const merged = applyStyle(bare, pack).story;
  assert.equal(merged.look, "paper-cutout");
  assert.equal(merged.brand.colors.bg, lookPresets("paper-cutout").colors.bg, "the look's palette wins over the pack's");
  assert.equal(merged.cast.style, "paper", "and its drawing style");
  assert.equal(merged.world.kind, "park");
  // The story's own look wins over the pack's, and its time of day over the pack's world.
  const named = applyStyle({ ...bare, look: "hologram" }, pack).story;
  assert.equal(named.look, "hologram");
  assert.equal(named.world.time, "night");
  assert.equal(named.cast.style, "flat", "hologram names no drawing style, so the pack's stays");
  // A story with its own colours and style keeps them.
  const own = applyStyle(story({ cast: { style: "chibi", characters: [{ id: "maya" }] } }), pack).story;
  assert.deepEqual(own.brand.colors, COLORS);
  assert.equal(own.cast.style, "chibi");
  // No look anywhere: nothing about a look is applied.
  const { look: _look, ...plainPack } = pack;
  const plain = applyStyle(bare, plainPack);
  assert.equal(plain.story.look, undefined);
  assert.ok(!plain.applied.some((entry) => /look/.test(entry)));
});

test("every look's palette passes the text contrast the modules check", () => {
  for (const name of NAMED) {
    const colors = lookPresets(name).colors;
    if (!colors) continue;
    assert.ok(contrastRatio(colors.paper, colors.bg) >= 4.5, `${name}: paper on bg ${contrastRatio(colors.paper, colors.bg)}`);
    assert.ok(contrastRatio(colors.ink, colors.primary) >= 3, `${name}: ink on primary ${contrastRatio(colors.ink, colors.primary)}`);
    assert.ok(contrastRatio(colors.primary, colors.bg) >= 3, `${name}: primary on bg ${contrastRatio(colors.primary, colors.bg)}`);
  }
});

test("every look resolves the test scene: two characters, a world and a card", () => {
  for (const name of NAMED) {
    const resolved = resolveStory(applyLook(story({ look: name })).story);
    assert.deepEqual(validateStory(resolved).errors, [], name);
    for (const scene of resolved.scenes) {
      assert.equal(resolveModule(scene, resolved).module, scene.module, `${name}: ${scene.id} resolves (not the placeholder)`);
    }
    const plan = lookPlan(resolved);
    assert.equal(plan.name, name);
    assert.equal(plan.shots.length, 2);
    assert.ok(plan.cues.some((cue) => cue.expression === "surprised" && Math.abs(cue.at - 3) < 1e-6), "the cast's cues are in story seconds");
  }
});

test("a grade ends in out, names each result once and reads only what exists", () => {
  for (const name of NAMED) {
    const plan = planOf(name);
    if (!plan.grade) { assert.equal(lookDefs(plan), "", name); continue; }
    assert.equal(plan.filters.length, plan.variants);
    assert.equal((lookDefs(plan).match(/<filter id="lc-look-\d+"/g) ?? []).length, plan.variants, name);
    for (let v = 0; v < plan.variants; v += 1) {
      const markup = lookPrimitives(plan, v);
      const results = [...markup.matchAll(/ result="([^"]+)"/g)].map((match) => match[1]);
      assert.equal(new Set(results).size, results.length, `${name} drawing ${v}: a result is named twice`);
      assert.equal(results.at(-1), "out", `${name} drawing ${v} ends in out`);
      const known = new Set(["SourceGraphic", "SourceAlpha", ...results]);
      for (const match of markup.matchAll(/ in2?="([^"]+)"/g)) assert.ok(known.has(match[1]), `${name} drawing ${v} reads ${match[1]}`);
      assert.doesNotMatch(markup, /NaN|undefined|Infinity/, `${name} drawing ${v}`);
    }
    // strength under 1 mixes the grade back toward the clean frame.
    assert.match(lookPrimitives(planOf({ name, strength: 0.5 }), 0), /in="out" in2="SourceGraphic" operator="arithmetic" k1="0" k2="0\.5" k3="0\.5" k4="0" result="mixed"><\/feComposite>$/);
  }
});

test("furniture is the look's own, can be left out, and blends nothing", () => {
  for (const name of NAMED) {
    const plan = planOf(name);
    if (!LOOKS[name].furniture) { assert.equal(plan.furniture, null, name); continue; }
    assert.ok(plan.furniture.html.length > 0 && plan.furniture.css.length > 0, name);
    assert.doesNotMatch(plan.furniture.html + plan.furniture.css, /NaN|undefined|Infinity/, name);
    // A blend against the scenes would differ between the renderers' stacking contexts.
    assert.doesNotMatch(plan.furniture.css, /mix-blend-mode/, name);
    assert.doesNotMatch(plan.furniture.html, /<script|\son[a-z]+=/i, name);
    assert.equal(planOf({ name, furniture: false }).furniture, null, name);
    assert.match(lookCss(plan), new RegExp(`#${LOOK_FURNITURE_ID} \\{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; pointer-events: none; z-index: 82000;`));
  }
  // Labels reach the furniture, escaped.
  assert.match(planOf({ name: "hologram", labels: ["A<B"] }).furniture.html, /A&lt;B/);
  assert.match(planOf({ name: "blueprint", labels: ["Sheet set"] }).furniture.html, /SHEET SET/);
});

test("every look is deterministic: the same story gives the same plan, drawings and variables", () => {
  for (const name of NAMED) {
    const a = planOf(name), b = planOf(name);
    assert.equal(lookDefs(a), lookDefs(b), name);
    assert.deepEqual(a.furniture, b.furniture, name);
    for (const frame of [0, 1, 7, 44, 89, 179]) assert.deepEqual(lookVarsAt(a, frame), lookVarsAt(b, frame), `${name} frame ${frame}`);
    // A different story is a different seed where the look draws from one.
    assert.equal(rand(a.seed, 3), rand(b.seed, 3));
  }
  assert.notEqual(rand("a", 1), rand("a", 2));
  assert.ok(Array.from({ length: 200 }, (_, i) => rand("seed", i)).every((value) => value >= 0 && value < 1));
});

test("seek safety: the timeline steps up to any frame give that frame's variables", () => {
  for (const name of NAMED) {
    const plan = planOf(name);
    const steps = lookSteps(plan, 6);
    if (!plan.grade && !plan.furniture) { assert.deepEqual(steps, [], name); continue; }
    assert.equal(steps[0].time, 0, name);
    for (const frame of [0, 1, 2, 3, 29, 30, 31, 90, 91, 133, 179]) {
      const state = {};
      for (const step of steps) if (step.time <= frame / plan.fps + 1e-9) Object.assign(state, step.vars);
      assert.deepEqual(state, lookVarsAt(plan, frame), `${name} at frame ${frame}`);
    }
    // Every change sits half a frame before the frame that shows it.
    for (const step of steps.slice(1)) assert.ok(Math.abs((step.time * plan.fps) % 1 - 0.5) < 0.01, `${name} step at ${step.time}`);
    // The drawing is one of the plan's, at any frame, in any order.
    for (const frame of [179, 3, 60, 0]) assert.ok(lookVariantAt(plan, frame) >= 0 && lookVariantAt(plan, frame) < Math.max(1, plan.variants), name);
  }
});

test("stepping holds the picture on whole frames, twelve drawings a second at 30 fps", () => {
  const held = Array.from({ length: 31 }, (_, frame) => stepFrame(frame, 30, 12));
  assert.deepEqual(held.slice(0, 11), [0, 0, 0, 3, 3, 5, 5, 5, 8, 8, 10]);
  assert.equal(new Set(held.slice(0, 30)).size, 12, "twelve drawings in a second");
  assert.equal(held[30], 30, "a second lands on a step");
  for (let frame = 0; frame < 600; frame += 1) {
    const at = stepFrame(frame, 30, 12);
    assert.ok(at <= frame && frame - at <= 2, `frame ${frame} holds ${at}`);
    assert.ok(at >= stepFrame(Math.max(0, frame - 1), 30, 12), "never steps back");
    assert.equal(stepFrame(at, 30, 12), at, "a held frame holds itself");
  }
  assert.equal(stepIndex(29, 30, 12), 11);
  assert.equal(stepFrame(17, 24, 12), 16, "on twos at 24 fps");
  assert.equal(stepFrame(17, 30, 0), 17, "no step: every frame");
  assert.equal(stepFrame(17, 30, 30), 17);
  const paper = planOf("paper-cutout");
  assert.ok(lookStepped(paper));
  assert.equal(lookStepFrame(paper, 94), 93);
  assert.ok(!lookStepped(planOf({ name: "paper-cutout", step: false })));
  assert.ok(!lookStepped(planOf("hologram")));
  // Footage is never stepped.
  assert.ok(!lookStepped(lookPlan({ ...story({ look: "paper-cutout" }), base: { src: "assets/a.mp4" } })));
  // Within a step the jitter drawing holds, and it changes at the next.
  assert.equal(lookVariantAt(paper, 93), lookVariantAt(paper, 94));
  assert.notEqual(lookVariantAt(paper, 94), lookVariantAt(paper, 95));
});

test("the stepped ease holds a GSAP scene timeline on the same frames, seeking forward or back", () => {
  const plan = planOf("paper-cutout");
  // eslint-disable-next-line no-new-func
  const ease = new Function(`return ${lookStepEase(plan)}`)();
  const picture = gsap.timeline({ paused: true });
  const box = { x: 0 };
  picture.fromTo(box, { x: 0 }, { x: 600, duration: 6, ease: "none", immediateRender: false }, 0);
  const tl = gsap.timeline({ paused: true });
  tl.fromTo(picture, { time: 0 }, { time: 6, duration: 6, ease, immediateRender: false }, 0);
  for (const frame of [0, 1, 2, 3, 4, 94, 93, 95, 179, 50, 7, 0]) {
    tl.seek(frame / 30, false);
    assert.ok(Math.abs(picture.time() - lookStepFrame(plan, frame) / 30) < 1e-6, `frame ${frame}: ${picture.time()}`);
    assert.ok(Math.abs(box.x - (lookStepFrame(plan, frame) / 30) * 100) < 1e-4, `frame ${frame}: x ${box.x}`);
  }
});

test("a look's cast options reach the cast's drawing, and nothing changes without a look", () => {
  assert.deepEqual(lookCastOptions("paper-cutout"), { pins: true });
  assert.deepEqual(lookCastOptions({ name: "paper-cutout" }), { pins: true });
  for (const value of [undefined, null, "none", "hologram", "toString", 3]) assert.equal(lookCastOptions(value), null, String(value));
  const scene = (look) => {
    const resolved = resolveStory(applyLook(story({ ...(look ? { look } : {}), cast: { style: "paper", characters: [{ id: "maya" }, { id: "theo" }] } })).story);
    return resolveModule(resolved.scenes.find((entry) => entry.id === "pair"), resolved);
  };
  assert.equal(scene(null).content.castDraw, undefined, "no look: the model is as it was");
  assert.equal(scene("hologram").content.castDraw, undefined);
  assert.deepEqual(scene("anime-cel").content.castDraw, { face: "cute" });
  assert.deepEqual(scene("paper-cutout").content.castDraw, { pins: true });
});

test("watercolour is the medium plus a pencil under it, held at the boil's rate; anime cel inks and bands the whole frame", async () => {
  const water = planOf("watercolour");
  assert.deepEqual(lookPresets("watercolour").medium, { kind: "watercolour", strength: 0.6, grain: 0.3 });
  assert.equal(lookPresets({ name: "watercolour", strength: 0.5 }).medium.strength, 0.3, "strength scales the paint");
  assert.equal(applyLook(story({ look: "watercolour", medium: "oil" })).story.medium, "oil", "the story's own medium wins");
  assert.ok(water.under, "the pencil lies under the wash");
  assert.equal(water.step, 10);
  assert.equal(lookStepFrame(water, 61), 60);
  // The pencil is redrawn with the medium's boil: a new drawing every three frames.
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((frame) => lookVariantAt(water, frame)), [0, 0, 0, 1, 1, 1, 2]);
  const { base, words } = await minimal();
  const { html } = await compileStoryToHyperFrames(resolveStory(applyLook({ ...base, look: "watercolour" }).story, { words }), { write: false, sourceDir: MINIMAL });
  assert.ok(html.indexOf(`id="${LOOK_LAYER_ID}"`) < html.indexOf('id="lc-medium"'), "the grade comes before the medium");
  assert.match(html, /#lc-look \{[^}]*z-index: 79900;/);
  assert.ok(!planOf("hologram").under);

  const cel = planOf("anime-cel");
  assert.deepEqual(lookCastOptions("anime-cel"), { face: "cute" });
  assert.equal(lookPresets("anime-cel").cast.style, "soft-shade");
  assert.match(lookPrimitives(cel, 0), /type="table" tableValues="0 0 0 0 0\.167 /, "brightness in bands");
  // Speed lines fire for half a second when a cue turns a character surprised (2.5 s into the cast scene), on twos.
  const speed = (frame) => { const vars = lookVarsAt(cel, frame); return [vars["--lc-look-speed-a"], vars["--lc-look-speed-b"]]; };
  assert.deepEqual(speed(89), [0, 0]);
  assert.deepEqual(speed(90).map((value) => value > 0), [true, false]);
  assert.deepEqual(speed(92).map((value) => value > 0), [false, true]);
  assert.deepEqual(speed(94).map((value) => value > 0), [true, false]);
  assert.deepEqual(speed(107), [0, 0]);
  // A character who starts a scene surprised is not a reaction.
  const calm = lookPlan(resolveStory(applyLook(story({ look: "anime-cel", scenes: story().scenes.map((scene) => (scene.id === "pair" ? { ...scene, params: { ...scene.params, cast: [{ id: "maya", expression: "surprised" }] } } : scene)) })).story));
  for (let frame = 0; frame < 180; frame += 1) assert.equal(lookVarsAt(calm, frame)["--lc-look-speed-a"] + lookVarsAt(calm, frame)["--lc-look-speed-b"], 0, `frame ${frame}`);
});

test("ASCII terminal is a real conversion: cells, nine characters by brightness, a typed command", () => {
  const plan = planOf("ascii-terminal");
  const cell = asciiCell(plan.unit);
  assert.deepEqual(cell, { p: 3, rx: 9, ry: 13, cw: 19, ch: 27 });
  for (const unit of [0.5, 0.667, 1, 2]) { const c = asciiCell(unit); assert.ok(c.cw % 2 === 1 && c.ch % 2 === 1 && c.cw >= 5 * c.p && c.ch >= 7 * c.p, `unit ${unit}`); }
  const markup = lookPrimitives(plan, 0);
  assert.equal((markup.match(/<feImage /g) ?? []).length, 9, "one bitmap tile per character");
  assert.equal((markup.match(/type="discrete"/g) ?? []).length, 9 * 3, "one brightness band per character");
  assert.match(markup, /operator="dilate" radius="9 13"/, "a cell's sample spread over the cell");
  assert.doesNotMatch(markup, /font-family|<text/, "its own bitmap font, so every machine draws the same characters");
  assert.equal(applyLook(story({ look: "ascii-terminal" })).story.world.time, "night");
  // The command types at the start of each shot (24 characters a second after 0.2 s) and the cursor blinks.
  assert.equal(lookVarsAt(plan, 0)["--lc-look-typed"], 0);
  assert.equal(lookVarsAt(plan, 21)["--lc-look-typed"], 12);
  assert.equal(lookVarsAt(plan, 90)["--lc-look-typed"], 0, "a new shot types again");
  assert.deepEqual([0, 7, 8, 15].map((frame) => lookVarsAt(plan, frame)["--lc-look-cursor"]), [1, 1, 0, 1]);
  assert.match(planOf({ name: "ascii-terminal", labels: ["tail -f deploy.log"] }).furniture.html, /tail -f deploy\.log/);
});

test("the looks a filter cannot fully make say so in their name and their description", () => {
  assert.match(LOOK_INFO["clay-2d"].honest, /not 3D clay/);
  assert.match(LOOK_INFO["isometric-layers"].honest, /not 3D models/);
  for (const name of NAMED.filter((entry) => !["clay-2d", "isometric-layers"].includes(entry))) assert.equal(LOOK_INFO[name].honest, null, name);
  assert.match(lookErrors("claymation")[0], /"claymation" is called "clay-2d" here/);
  assert.match(lookErrors("isometric")[0], /"isometric" is called "isometric-layers" here/);
  const clay = planOf("clay-2d");
  assert.equal(clay.step, 12);
  for (let frame = 0; frame < 120; frame += 1) if (lookStepFrame(clay, frame) !== lookStepFrame(clay, frame + 1)) assert.notEqual(lookVariantAt(clay, frame), lookVariantAt(clay, frame + 1), `the wobble changes at frame ${frame + 1}`);
  assert.match(lookPrimitives(clay, 0), /<feDiffuseLighting /);
});

test("isometric layers stages every scene layer with one affine transform, and only without a camera", async () => {
  const plan = planOf("isometric-layers");
  assert.ok(!plan.grade && plan.stage);
  assert.deepEqual(Object.keys(plan.stage.planes).sort(), ["idea", "pair", "room", "street"]);
  for (const plane of Object.values(plan.stage.planes)) assert.match(plane.transform, /^matrix\(0\.\d+, -0\.\d+, 0, 0\.\d+, [\d.]+, [\d.]+\)$/);
  assert.notEqual(plan.stage.planes.room.transform, plan.stage.planes.pair.transform, "a higher track stands in front");
  assert.equal(plan.stage.planes.room.transform, plan.stage.planes.street.transform);
  assert.deepEqual(lookPlaneStyle(plan, "room"), { transformOrigin: "0 0", transform: plan.stage.planes.room.transform, filter: plan.stage.planes.room.filter });
  assert.deepEqual(lookPlaneStyle(plan, "nope"), {});
  assert.deepEqual(lookPlaneStyle(planOf("hologram"), "room"), {});
  // Every layer's corners stay on the canvas, in both formats.
  for (const format of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) for (const tracks of [1, 2, 3]) {
    const fit = isometricFit(format, tracks);
    for (let track = 0; track < tracks; track += 1) for (const [x, y] of [[0, 0], [format.width, 0], [0, format.height], [format.width, format.height]]) {
      const sx = fit.x - 0.7071 * fit.s * 0.1 * format.width * track + 0.7071 * fit.s * x, sy = fit.y + 0.4082 * fit.s * 0.1 * format.width * track - 0.4082 * fit.s * x + 0.8165 * fit.s * y;
      assert.ok(sx >= -1 && sx <= format.width + 1 && sy >= -1 && sy <= format.height + 1, `${format.width}x${format.height} track ${track} corner ${x},${y} lands at ${Math.round(sx)},${Math.round(sy)}`);
    }
  }
  assert.equal(applyLook(story({ look: "isometric-layers" })).story.camera.mode, "cuts");
  assert.equal(applyLook(story({ look: "isometric-layers", camera: { mode: "world" } })).story.camera.mode, "world", "the story's own camera wins");
  assert.match(plan.furniture.html, /lc-look-iso-card/);
  assert.equal(plan.icons[0], "rocket", "the cards carry the story's own icons");
  const { base, words } = await minimal();
  const resolved = resolveStory(applyLook({ ...base, look: "isometric-layers" }).story, { words });
  const { html } = await compileStoryToHyperFrames(resolved, { write: false, sourceDir: MINIMAL });
  assert.match(html, /#lc-scene-s1, #lc-scene-s1-loop, #lc-scene-s1-behind \{ transform-origin: 0 0; transform: matrix\(/);
  assert.ok(html.indexOf(`id="${LOOK_UNDER_ID}"`) > 0 && html.indexOf(`id="${LOOK_UNDER_ID}"`) < html.indexOf('id="lc-scene-s1"'), "the floor is under every scene");
  assert.equal(lookStageCss(planOf("hologram")), "");
  assert.equal(lookUnderMarkup(planOf("hologram")), "");
  // Under a world camera the scenes ride the camera's plates: no stage.
  const world = await compileStoryToHyperFrames(resolveStory({ ...base, look: "isometric-layers", camera: { mode: "world" } }, { words }), { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(world.html, new RegExp(`${LOOK_UNDER_ID}|#lc-scene-s1, `));
  assert.match(world.html, /lc-look-iso-card/, "the cards still float");
});

test("plain words name a look, and a subject does not", () => {
  assert.equal(lookFromText("A 30 second short as a hologram"), "hologram");
  assert.equal(lookFromText("blueprint style explainer of our API"), "blueprint");
  assert.equal(lookFromText("thermal camera view of a server room"), "thermal");
  assert.equal(lookFromText("a cyberpunk city short"), "neon-night");
  assert.equal(lookFromText("paper cutout story for kids"), "paper-cutout");
  assert.equal(lookFromText("an anime short about a launch"), "anime-cel");
  assert.equal(lookFromText("ASCII art version of the demo"), "ascii-terminal");
  assert.equal(lookFromText("a claymation short"), "clay-2d");
  assert.equal(lookFromText("an isometric explainer"), "isometric-layers");
  assert.equal(lookFromText("a clay pottery studio promo"), null);
  assert.equal(lookFromText("watercolour and pencil, hand drawn"), "watercolour");
  assert.equal(lookFromText("soft watercolour, dreamy"), null, "watercolour alone names the medium (mediumFromText)");
  for (const text of ["our blueprint for growth", "a neon sign shop promo", "heat map of sales", "use the paper-collage style", "a company that makes holograms", "", null]) assert.equal(lookFromText(text), null, String(text));
});

test("a described look becomes a seeded style's constraint; the seed never draws one on its own", () => {
  assert.equal(promptConstraints("A 30 second short about uptime, as a hologram").look, "hologram");
  assert.equal(promptConstraints("as a hologram", { look: "thermal" }).look, "thermal", "art direction's look wins");
  assert.equal(promptConstraints("Our quarterly numbers").look, undefined);
  assert.deepEqual(constraintFlags({ look: "blueprint" }), { look: "blueprint" });
  const plain = generateStyle({ seed: "7f3a91c2" });
  assert.equal(plain.look, undefined);
  const looked = generateStyle({ seed: "7f3a91c2", constraints: { look: "hologram" } });
  assert.equal(looked.look, "hologram");
  assert.deepEqual(looked.brand, plain.brand, "the look pins nothing else in the pack");
  assert.match(styleSummary(looked), /, hologram\)$/);
  assert.deepEqual(validateStylePack(looked).errors, []);
  assert.equal(generateStyle({ seed: "7f3a91c2", constraints: { look: "none" } }).look, undefined);
  assert.throws(() => normalizeConstraints({ look: "holo" }), /use "hologram"/);
});

test("the HyperFrames compile draws the look under the frame and captions, and is unchanged without one", async () => {
  const { base, words } = await minimal();
  const plain = await compileStoryToHyperFrames(resolveStory(base, { words }), { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(plain.html, /lc-look|lcPicture/);
  for (const none of ["none", { name: "none", strength: 1 }]) {
    const same = await compileStoryToHyperFrames(resolveStory({ ...base, look: none }, { words }), { write: false, sourceDir: MINIMAL });
    assert.equal(same.html, plain.html, `look ${JSON.stringify(none)} is today's render`);
  }
  const resolved = resolveStory({ ...base, look: "hologram" }, { words });
  const plan = lookPlan(resolved);
  const { html } = await compileStoryToHyperFrames(resolved, { write: false, sourceDir: MINIMAL });
  assert.match(html, new RegExp(`<div id="${LOOK_LAYER_ID}" data-launchclip-look="hologram" aria-hidden="true" style="--lc-look-filter:url\\(#lc-look-0\\)`));
  assert.match(html, new RegExp(`<div id="${LOOK_FURNITURE_ID}" data-launchclip-look="hologram" data-layout-ignore="true" data-layout-allow-overflow="true" data-layout-allow-overlap="true" aria-hidden="true"`), "the layout audit leaves the furniture out");
  assert.match(html, /#lc-look \{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; pointer-events: none; z-index: 81000; backdrop-filter: var\(--lc-look-filter\);/);
  assert.equal((html.match(/<filter id="lc-look-\d"/g) ?? []).length, plan.variants);
  assert.ok(html.indexOf(`id="${LOOK_FURNITURE_ID}"`) < html.indexOf('id="lc-captions"'), "the look comes before the captions");
  assert.ok(html.indexOf(`id="${LOOK_LAYER_ID}"`) < html.indexOf(`id="${LOOK_FURNITURE_ID}"`), "the grade is under its furniture");
  const sets = html.match(/tl\.set\("#lc-look, #lc-look-furniture", \{[^}]+\}, [\d.]+\);/g) ?? [];
  assert.equal(sets.length, lookSteps(plan, resolved.resolved.duration).length);
  assert.doesNotMatch(html, /lcPicture/, "hologram is not stepped");
  // With the medium: the medium, then the look.
  const both = await compileStoryToHyperFrames(resolveStory({ ...base, look: "thermal", medium: "ink" }, { words }), { write: false, sourceDir: MINIMAL });
  assert.ok(both.html.indexOf('id="lc-medium"') < both.html.indexOf(`id="${LOOK_LAYER_ID}"`));
  // A stepped look runs the scenes on their own timeline; the look, the frame and the captions stay on the story's.
  const stepped = await compileStoryToHyperFrames(resolveStory({ ...base, look: "paper-cutout" }, { words }), { write: false, sourceDir: MINIMAL });
  assert.match(stepped.html, /const lcPicture = gsap\.timeline\(\{ paused: true \}\);\n\s*\(\(tl\) => \{/);
  assert.match(stepped.html, /\}\)\(lcPicture\);\n\s*lcPicture\.render\(0, true, true\);\n\s*tl\.fromTo\(lcPicture, \{ time: 0 \}, \{ time: 6, duration: 6, ease: \(p\) => /);
  const body = stepped.html.slice(stepped.html.indexOf("})(lcPicture);"));
  assert.match(body, /tl\.set\("#lc-look", /);
  assert.match(body, /window\.mountCaptions\(tl, /);
  assert.match(stepped.html, /window\.__timelines\["[^"]+"\] = tl;/, "the story timeline is still the one registered");
  // A module review (sceneFilter) has no look, like ModuleReview.
  const review = await compileStoryToHyperFrames(resolveStory({ ...base, look: "hologram" }, { words }), { write: false, sourceDir: MINIMAL, sceneFilter: "s1" });
  assert.doesNotMatch(review.html, /lc-look/);
});

test("the Remotion story draws the same layers after the medium and freezes the picture on steps", async () => {
  const source = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.match(source, /lookPlan\(story\)/);
  assert.match(source, /lookVarsAt\(plan, Math\.floor\(\(frame \* plan\.fps\) \/ fps \+ 1e-6\)\)/);
  assert.match(source, /<Freeze key=\{key\} frame=\{pictureFrame\}>/);
  assert.match(source, /lookStepFrame\(look, Math\.floor\(frame \/ rate \+ 1e-6\)\) \* rate/);
  assert.equal((source.match(/\{look \? <LookLayer plan=\{look\} \/> : null\}\n\s*<BrandFrame/g) ?? []).length, 2, "both paths draw it right before the brand frame");
  assert.equal((source.match(/\{picture\(feelWrap\(<>/g) ?? []).length, 2, "both paths freeze the scenes");
  assert.match(source, /style=\{lookPlaneStyle\(look, entry\.scene\.id\) as React\.CSSProperties\}/, "a scene's Sequence takes its stage transform");
  assert.match(source, /\{look\?\.stage \? <div [^\n]*lookUnderMarkup\(look\)/, "the floor is drawn before the scenes, on the path with no camera");
});

async function chromeAvailable() {
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser();
    return null;
  } catch (error) {
    return error.message;
  }
}

test("Remotion draws a real still in a look and leaves the captions crisp", { skip: mediaSkip(), timeout: 300_000 }, async (t) => {
  const missing = await chromeAvailable();
  if (missing) { t.skip(`Chrome Headless Shell is unavailable: ${missing}`); return; }
  const { decodePng } = await import("../src/visual_snapshot.js");
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-look-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapter = getRenderer("remotion");
    const plainFile = path.join(project, "qa", "plain.png");
    await adapter.still(project, 1.5, plainFile);
    const file = path.join(project, "storyboard.json");
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), look: "thermal" }, null, 2));
    const lookFile = path.join(project, "qa", "thermal.png");
    await adapter.still(project, 1.5, lookFile);
    const [plain, graded] = [decodePng(await readFile(plainFile)), decodePng(await readFile(lookFile))];
    const same = (i, d) => Math.abs(plain.pixels[i] - graded.pixels[i]) + Math.abs(plain.pixels[i + 1] - graded.pixels[i + 1]) + Math.abs(plain.pixels[i + 2] - graded.pixels[i + 2]) <= d;
    let changed = 0;
    for (let i = 0; i < plain.pixels.length; i += 4) if (!same(i, 6)) changed += 1;
    assert.ok(changed / (plain.width * plain.height) > 0.5, `graded share ${changed / (plain.width * plain.height)}`);
    // The caption ("MINUTES." in amber, over the look) keeps its colour. Its fill lets a
    // few levels of what is behind it through, so the ground's new colour moves it a little.
    let glyphs = 0, kept = 0;
    for (let y = Math.round(plain.height * 0.6); y < Math.round(plain.height * 0.76); y += 1) for (let x = 0; x < plain.width; x += 1) {
      const i = (y * plain.width + x) * 4;
      if (!(plain.pixels[i] > 200 && plain.pixels[i] - plain.pixels[i + 2] > 150)) continue;
      glyphs += 1;
      if (same(i, 24)) kept += 1;
    }
    assert.ok(glyphs > 2000, `caption glyphs found: ${glyphs}`);
    assert.ok(kept / glyphs > 0.95, `caption glyphs kept: ${kept / glyphs}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
