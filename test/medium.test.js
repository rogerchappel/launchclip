import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { MEDIUM_BOIL, MEDIUM_DEFAULTS, MEDIUM_KEYS, MEDIUM_KINDS, MEDIUM_LAYER_ID, mediumDefs, mediumErrors, mediumFilterAt, mediumFromText, mediumPlan, mediumSteps, mediumVariantAt, normalizeMedium } from "../kit/core/medium.mjs";
import { STORY_MEDIUM_KEYS, STORY_MEDIUM_KINDS, resolveStory, validateStory } from "../kit/core/story.mjs";
import { STYLE_SCHEMA, STYLE_V2_SCHEMA, applyStyle, validateStylePack } from "../kit/core/style.mjs";
import { generateStyle, normalizeConstraints, styleSummary } from "../kit/core/style-seed.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { constraintFlags, promptConstraints, promptTone } from "../src/style_seed_store.js";
import { getRenderer } from "../src/renderers/index.js";
import { mediaSkip } from "./helpers/media.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const PAINTED = MEDIUM_KINDS.filter((kind) => kind !== "none");

function story(extra = {}) {
  return {
    schema: "launchclip.story.v1", lane: "motion",
    format: { width: 1080, height: 1920, fps: 30, duration: 4 },
    brand: { colors: { bg: "#101014", paper: "#f2eee6", ink: "#101014", primary: "#fdb022", accent: "#46d4ff" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
    scenes: [{ id: "a", module: "hook-title", start: 0, end: 4, params: { headline: "Hello" } }],
    ...extra
  };
}

async function minimal() {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  return { base, words };
}

test("the story validator keeps the medium kit's kinds and keys", () => {
  assert.deepEqual(STORY_MEDIUM_KINDS, [...MEDIUM_KINDS]);
  assert.deepEqual(STORY_MEDIUM_KEYS, [...MEDIUM_KEYS]);
  assert.deepEqual(Object.keys(MEDIUM_DEFAULTS), PAINTED);
});

test("a medium is a name or {kind, strength, boil, grain}, and every error names the fix", () => {
  for (const value of [undefined, null, "none", ...PAINTED, { kind: "oil" }, { kind: "ink", strength: 0, boil: false, grain: 1 }]) assert.deepEqual(mediumErrors(value), [], JSON.stringify(value));
  assert.match(mediumErrors("watercolor")[0], /"watercolor" is spelled "watercolour" here; use "watercolour"/);
  assert.match(mediumErrors({ kind: "crayon" })[0], /medium\.kind "crayon" is spelled "pastel" here; use "pastel"/);
  assert.match(mediumErrors("acrylic")[0], /must be one of none, oil, watercolour, pastel, ink, gouache/);
  assert.match(mediumErrors(3)[0], /a medium name .* or \{kind, strength\?, boil\?, grain\?\}/);
  const errors = mediumErrors({ kind: "oil", strength: 1.5, grain: -1, boil: "yes", speed: 2 }, "style.medium");
  assert.equal(errors.length, 4);
  assert.ok(errors.some((message) => /style\.medium\.speed is not supported \(allowed: kind, strength, boil, grain\)/.test(message)));
  assert.ok(errors.some((message) => /strength must be a number from 0 to 1/.test(message)));
  assert.ok(errors.some((message) => /grain must be a number from 0 to 1 \(0 turns the paper texture off\)/.test(message)));
  assert.ok(errors.some((message) => /boil must be true or false/.test(message)));
});

test("normalizeMedium fills each medium's dials, and none is no medium", () => {
  assert.equal(normalizeMedium("none"), null);
  assert.equal(normalizeMedium({ kind: "none", strength: 1 }), null);
  assert.equal(normalizeMedium(undefined), null);
  assert.equal(normalizeMedium("watercolor"), null, "an invalid medium paints nothing");
  assert.deepEqual(normalizeMedium("oil"), { kind: "oil", ...MEDIUM_DEFAULTS.oil });
  assert.deepEqual(normalizeMedium({ kind: "ink", boil: false }), { kind: "ink", strength: MEDIUM_DEFAULTS.ink.strength, boil: false, grain: MEDIUM_DEFAULTS.ink.grain });
});

test("style packs and storyboards validate medium the same way", () => {
  const pack = { schema: STYLE_SCHEMA, name: "painted", medium: { kind: "watercolour", strength: 0.4 } };
  assert.deepEqual(validateStylePack(pack).errors, []);
  const bad = validateStylePack({ ...pack, medium: { kind: "watercolor", boil: 1 } });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((message) => /medium\.kind "watercolor" is spelled "watercolour" here/.test(message)));
  assert.ok(bad.errors.some((message) => /medium\.boil must be true or false/.test(message)));
  assert.ok(validateStylePack({ schema: STYLE_V2_SCHEMA, name: "old", medium: "oil" }).warnings.some((message) => /medium is a style v3 field/.test(message)));

  assert.deepEqual(validateStory(story({ medium: "pastel" })).errors, []);
  assert.deepEqual(validateStory(story({ medium: { kind: "gouache", grain: 0 } })).errors, []);
  assert.ok(!validateStory(story({ medium: "oil" })).warnings.some((message) => /medium is not a story/.test(message)));
  const storyErrors = validateStory(story({ medium: { kind: "watercolor", strength: 2, tint: 1 } })).errors;
  assert.ok(storyErrors.some((message) => /medium\.kind "watercolor" is spelled "watercolour" here; use "watercolour"/.test(message)));
  assert.ok(storyErrors.some((message) => /medium\.strength must be a number from 0 to 1/.test(message)));
  assert.ok(storyErrors.some((message) => /medium\.tint is not supported/.test(message)));
});

test("applyStyle fills the story's medium from the pack; the story's own wins and none adds nothing", () => {
  const pack = { schema: STYLE_SCHEMA, name: "painted", medium: { kind: "oil", strength: 0.7 } };
  const merged = applyStyle(story(), pack);
  assert.deepEqual(merged.story.medium, { kind: "oil", strength: 0.7 });
  assert.ok(merged.applied.includes("medium"));
  assert.equal(applyStyle(story({ medium: "ink" }), pack).story.medium, "ink");
  for (const none of ["none", { kind: "none" }]) {
    const out = applyStyle(story(), { ...pack, medium: none });
    assert.equal(out.story.medium, undefined);
    assert.ok(!out.applied.includes("medium"));
  }
  assert.equal(applyStyle(story(), { schema: STYLE_SCHEMA, name: "plain" }).story.medium, undefined);
});

test("the plan boils on threes from the absolute frame, the same at any seek", () => {
  assert.equal(mediumPlan(story()), null);
  assert.equal(mediumPlan(story({ medium: "none" })), null);
  const plan = mediumPlan(story({ medium: "ink" }));
  assert.equal(plan.variants, MEDIUM_BOIL.variants);
  assert.deepEqual(plan.filters, ["lc-medium-0", "lc-medium-1", "lc-medium-2"]);
  assert.deepEqual([0, 1, 2, 3, 5, 6, 8, 9, 12, 299].map((frame) => mediumVariantAt(plan, frame)), [0, 0, 0, 1, 1, 2, 2, 0, 1, 99 % 3]);
  assert.equal(mediumFilterAt(plan, 7), "url(#lc-medium-2)");
  const still = mediumPlan(story({ medium: { kind: "ink", boil: false } }));
  assert.equal(still.variants, 1);
  assert.deepEqual(mediumSteps(still, 4), []);
  assert.equal(mediumFilterAt(still, 7), "url(#lc-medium-0)");

  // Every step sits half a frame before the frame that first shows it.
  const steps = mediumSteps(plan, 4);
  assert.equal(steps.length, 1 + Math.floor(120 / 3));
  assert.deepEqual(steps[0], { time: 0, filter: "url(#lc-medium-0)" });
  assert.deepEqual(steps[1], { time: 0.0833, filter: "url(#lc-medium-1)" });

  // GSAP seeking the steps in any order lands every frame on mediumFilterAt.
  const target = { "--lc-medium-filter": "url(#lc-medium-0)" };
  const tl = gsap.timeline({ paused: true });
  for (const step of steps) tl.set(target, { "--lc-medium-filter": step.filter }, step.time);
  const frames = [...Array(121).keys()];
  for (const frame of [...frames.slice().reverse(), 61, 3, 117, 2, 59, 60, 0, 120]) {
    tl.seek(frame / 30, false);
    assert.equal(target["--lc-medium-filter"], mediumFilterAt(plan, frame), `frame ${frame}`);
  }
  tl.kill();
});

test("each medium's filters are deterministic; drawings differ by seed and the paper never boils", () => {
  for (const kind of PAINTED) {
    const plan = mediumPlan(story({ medium: kind }));
    const defs = mediumDefs(plan);
    assert.equal(defs, mediumDefs(mediumPlan(story({ medium: kind }))), `${kind} is the same every time`);
    assert.doesNotMatch(defs, /NaN|undefined|Infinity/, kind);
    for (const id of plan.filters) assert.match(defs, new RegExp(`<filter id="${id}" x="0" y="0" width="1080" height="1920" filterUnits="userSpaceOnUse"`), kind);
    const drawings = defs.split("<filter ").slice(1);
    assert.equal(new Set(drawings.map((markup) => markup.replace(/id="lc-medium-\d"/, ""))).size, 3, `${kind}: three different drawings`);
    const seeds = (markup) => [...markup.matchAll(/seed="(\d+)" result="([^"]+)"/g)].map(([, seed, result]) => `${result}:${seed}`);
    const still = seeds(drawings[0]).filter((entry) => /^(?:out-n|tooth-raw):/.test(entry));
    for (const markup of drawings.slice(1)) for (const entry of still) assert.ok(seeds(markup).includes(entry), `${kind}: the paper (${entry}) is the same in every drawing`);
  }
  // Strength and grain move the numbers; grain 0 drops the paper.
  const soft = mediumDefs(mediumPlan(story({ medium: { kind: "watercolour", strength: 0.2 } })));
  const strong = mediumDefs(mediumPlan(story({ medium: { kind: "watercolour", strength: 0.9 } })));
  assert.notEqual(soft, strong);
  assert.match(mediumDefs(mediumPlan(story({ medium: "gouache" }))), /result="out-n"/);
  assert.doesNotMatch(mediumDefs(mediumPlan(story({ medium: { kind: "gouache", grain: 0 } }))), /result="out-n"/);
  // Sizes follow the canvas: a 16:9 frame scales by its short side.
  assert.match(mediumDefs(mediumPlan(story({ medium: "oil", format: { width: 1920, height: 1080, fps: 30, duration: 4 } }))), /width="1920" height="1080"/);
});

test("plain words name a medium and the look that goes with it", () => {
  assert.deepEqual(mediumFromText("soft watercolour, dreamy"), { medium: { kind: "watercolour", strength: 0.4 }, tone: "calm", theme: "light", background: { kind: "paper", params: { grain: 0.6, intensity: 0.4 } } });
  assert.equal(mediumFromText("Watercolor travel diary").medium, "watercolour");
  assert.deepEqual(mediumFromText("crayon on paper, for kids"), { medium: "pastel", tone: "playful", theme: "light", background: { kind: "paper", params: { grain: 0.7, intensity: 0.3 } } });
  assert.equal(mediumFromText("inked, like a graphic novel").medium, "ink");
  assert.equal(mediumFromText("inked, like a graphic novel").tone, "serious");
  assert.equal(mediumFromText("oil paint, like the faith shorts").medium, "oil");
  assert.equal(mediumFromText("flat gouache storybook").medium, "gouache");
  assert.deepEqual(mediumFromText("thick impasto, no boil").medium, { kind: "oil", strength: 0.85, boil: false });
  assert.equal(mediumFromText("an oil pastel sketch").medium, "pastel", "an oil pastel is a pastel");
  assert.equal(mediumFromText("dark moody ink drawing").theme, "dark");
  for (const text of ["oil and gas explainer", "soft pastel colours", "car wash promo", "printer ink savings", "a chalkboard lesson", "", null]) assert.equal(mediumFromText(text), null, String(text));
});

test("a described medium becomes a seeded style's constraint; the seed never draws one on its own", () => {
  const constraints = promptConstraints("A 30 second short about rest. Soft watercolour, dreamy.");
  assert.deepEqual(constraints.medium, { kind: "watercolour", strength: 0.4 });
  assert.equal(constraints.theme, "light");
  assert.deepEqual(constraints.background, { kind: "paper", params: { grain: 0.6, intensity: 0.4 } });
  assert.equal(promptConstraints("crayon on paper", { theme: "dark", medium: "ink" }).medium, "ink", "art direction's medium wins");
  assert.equal(promptConstraints("crayon on paper", { theme: "dark" }).theme, "dark", "art direction's theme wins");
  assert.equal(promptConstraints("Our quarterly numbers").medium, undefined);
  assert.equal(promptTone("inked, like a graphic novel"), "serious");
  assert.equal(promptTone("soft watercolour"), "calm");
  assert.equal(promptTone("crayon on paper, for kids"), "playful");
  assert.equal(promptTone("Our quarterly numbers"), null);
  assert.deepEqual(constraintFlags({ medium: "oil" }), { medium: "oil" });

  const plain = generateStyle({ seed: "7f3a91c2" });
  assert.equal(plain.medium, undefined);
  const painted = generateStyle({ seed: "7f3a91c2", constraints: { medium: { kind: "watercolour", strength: 0.4 } } });
  assert.deepEqual(painted.medium, { kind: "watercolour", strength: 0.4 });
  assert.deepEqual(painted.generated.constraints.medium, { kind: "watercolour", strength: 0.4 });
  assert.deepEqual(painted.brand, plain.brand, "the medium pins nothing else");
  assert.match(styleSummary(painted), /, watercolour\)$/);
  assert.deepEqual(validateStylePack(painted).errors, []);
  assert.equal(generateStyle({ seed: "7f3a91c2", constraints: { medium: "none" } }).medium, undefined);
  assert.throws(() => normalizeConstraints({ medium: "watercolor" }), /use "watercolour"/);
});

test("the HyperFrames compile paints under the frame and captions, and is unchanged without a medium", async () => {
  const { base, words } = await minimal();
  const plain = await compileStoryToHyperFrames(resolveStory(base, { words }), { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(plain.html, /lc-medium|backdrop-filter/);
  for (const none of ["none", { kind: "none", strength: 1 }]) {
    const same = await compileStoryToHyperFrames(resolveStory({ ...base, medium: none }, { words }), { write: false, sourceDir: MINIMAL });
    assert.equal(same.html, plain.html, `medium ${JSON.stringify(none)} is today's render`);
  }
  const { html } = await compileStoryToHyperFrames(resolveStory({ ...base, medium: "watercolour" }, { words }), { write: false, sourceDir: MINIMAL });
  assert.match(html, new RegExp(`<div id="${MEDIUM_LAYER_ID}" data-launchclip-medium="watercolour" aria-hidden="true"></div>`));
  assert.match(html, /#lc-medium \{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; pointer-events: none; z-index: 80000; --lc-medium-filter: url\(#lc-medium-0\); backdrop-filter: var\(--lc-medium-filter\);/);
  assert.equal((html.match(/<filter id="lc-medium-\d"/g) ?? []).length, 3);
  assert.ok(html.indexOf(`id="${MEDIUM_LAYER_ID}"`) < html.indexOf('id="lc-captions"'), "the layer comes before the captions");
  const sets = html.match(/tl\.set\("#lc-medium", \{"--lc-medium-filter":"url\(#lc-medium-\d\)"\}, [\d.]+\);/g) ?? [];
  assert.equal(sets.length, mediumSteps(mediumPlan(resolveStory({ ...base, medium: "watercolour" }, { words })), 6).length);
  // A module review (sceneFilter) has no medium, like ModuleReview.
  const review = await compileStoryToHyperFrames(resolveStory({ ...base, medium: "oil" }, { words }), { write: false, sourceDir: MINIMAL, sceneFilter: "s1" });
  assert.doesNotMatch(review.html, /lc-medium/);
});

test("the Remotion story draws the same layer under its frame and captions", async () => {
  const source = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.match(source, /mediumPlan\(story\)/);
  assert.match(source, /mediumLayerStyle\(plan, frame\)/);
  assert.equal((source.match(/\{medium \? <MediumLayer plan=\{medium\} \/> : null\}\n\s*<BrandFrame/g) ?? []).length, 2, "both paths draw it right before the brand frame");
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

test("Remotion paints a real still in a medium and leaves the captions crisp", { skip: mediaSkip(), timeout: 300_000 }, async (t) => {
  const missing = await chromeAvailable();
  if (missing) { t.skip(`Chrome Headless Shell is unavailable: ${missing}`); return; }
  const { decodePng } = await import("../src/visual_snapshot.js");
  const project = await mkdtemp(path.join(os.tmpdir(), "launchclip-medium-"));
  try {
    await cp(MINIMAL, project, { recursive: true });
    const adapter = getRenderer("remotion");
    const plainFile = path.join(project, "qa", "plain.png");
    await adapter.still(project, 1.5, plainFile);
    const file = path.join(project, "storyboard.json");
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), medium: "oil" }, null, 2));
    const oilFile = path.join(project, "qa", "oil.png");
    await adapter.still(project, 1.5, oilFile);
    const [plain, oil] = [decodePng(await readFile(plainFile)), decodePng(await readFile(oilFile))];
    assert.equal(oil.width, 1080);
    assert.equal(oil.height, 1920);
    const same = (i, d) => Math.abs(plain.pixels[i] - oil.pixels[i]) + Math.abs(plain.pixels[i + 1] - oil.pixels[i + 1]) + Math.abs(plain.pixels[i + 2] - oil.pixels[i + 2]) <= d;
    // The picture is painted: a good share of pixels moved.
    let changed = 0;
    for (let i = 0; i < plain.pixels.length; i += 4) if (!same(i, 6)) changed += 1;
    assert.ok(changed / (plain.width * plain.height) > 0.2, `painted share ${changed / (plain.width * plain.height)}`);
    // The caption ("MINUTES." in amber, over the medium) is not: its glyphs keep their colour.
    let glyphs = 0, kept = 0;
    for (let y = Math.round(plain.height * 0.6); y < Math.round(plain.height * 0.76); y += 1) for (let x = 0; x < plain.width; x += 1) {
      const i = (y * plain.width + x) * 4;
      if (!(plain.pixels[i] > 200 && plain.pixels[i] - plain.pixels[i + 2] > 150)) continue;
      glyphs += 1;
      if (same(i, 6)) kept += 1;
    }
    assert.ok(glyphs > 2000, `caption glyphs found: ${glyphs}`);
    assert.ok(kept / glyphs > 0.95, `caption glyphs kept: ${kept / glyphs}`);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
