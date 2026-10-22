// Caption presets (kit/core/captions.mjs): every preset in both renderers,
// GSAP seek parity of the frame-pure evaluator, backward compatibility, and
// (LAUNCHCLIP_PARITY=1) rendered HyperFrames-vs-Remotion parity per preset.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { CAPTION_ENTRANCES, CAPTION_EXITS, CAPTION_MOTION, CAPTION_PRESET_NAMES, CAPTION_PRESETS, captionBandTop, captionElementStateAt, captionInlineStyle, captionPlan, captionPlanRuntime, captionPresetName, captionStateAt, chunkWords, indexCaptionTweens } from "../kit/core/captions.mjs";
import { CAPTION_POSITION_TOP, captionBandAt } from "../kit/core/layout-check.mjs";
import { resolveStory, STORY_CAPTION_PRESETS, validateStory } from "../kit/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const require = createRequire(import.meta.url);
const { gsap } = require("gsap");
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples", "story", "minimal");
const BRAND = { colors: { bg: "#0a0f1a", paper: "#f7f3e9", primary: "#ffd166", accent: "#06d6a0", ink: "#0a0f1a" }, fonts: { display: "anton", body: "space-grotesk", meta: "jetbrains-mono" } };
const FORMAT = { width: 1080, height: 1920 };
const WORDS = [
  { text: "Small", start: 0.3, end: 0.6 }, { text: "gains", start: 0.65, end: 1.0 }, { text: "every", start: 1.1, end: 1.4 },
  { text: "year.", start: 1.45, end: 1.9 }, { text: "Then", start: 2.0, end: 2.2 }, { text: "72", start: 2.25, end: 2.6 },
  { text: "changes", start: 2.65, end: 3.0 }, { text: "everything", start: 3.05, end: 3.6 }
];
const CHUNKS = chunkWords(WORDS);
const VARIANTS = [{}, { position: "top", case: "title", size: 1.2, offset: -0.05 }, { entrance: "slide-left", exit: "slide-down", max_words: 2, emphasis: ["gains"], colors: { active: "accent", idle: "#ffffff" } }];

test("at least twelve presets, kept in step with the story schema and the layout check", () => {
  assert.ok(CAPTION_PRESET_NAMES.length >= 12);
  assert.deepEqual([...STORY_CAPTION_PRESETS], [...CAPTION_PRESET_NAMES]);
  for (const name of ["word-highlight", "karaoke-fill", "pop-word", "bounce", "typewriter", "box-highlight", "underline-sweep", "kinetic-stack", "minimal-line", "glow", "outline-heavy", "split-color", "lower-band", "bubble"]) assert.ok(CAPTION_PRESETS[name], name);
  for (const format of [FORMAT, { width: 1920, height: 1080 }]) {
    const band = { x: 0, y: 1190, width: 800, height: 230 };
    const landscape = format.width > format.height;
    assert.equal(captionBandAt(band, format, "top").y / format.height, captionBandTop(format, "top"));
    assert.equal(landscape ? CAPTION_POSITION_TOP.landscape : CAPTION_POSITION_TOP.portrait, captionBandTop(format, "top"));
  }
});

test("every preset builds a seek-safe plan: unique ids, known targets, one immediate render, `to` after a prior tween", () => {
  for (const preset of CAPTION_PRESET_NAMES) for (const variant of VARIANTS) {
    const plan = captionPlan(CHUNKS, { type: "captions", preset, ...variant }, { brand: BRAND, format: FORMAT });
    const ids = [];
    const walk = (node) => { ids.push(node.id); (node.children ?? []).forEach(walk); };
    plan.nodes.forEach(walk);
    assert.equal(new Set(ids).size, ids.length, `${preset}: duplicate ids`);
    assert.ok(plan.nodes.length > 0 && plan.tweens.length > 0, preset);
    const known = new Set(ids);
    const seen = new Map();
    for (const tween of [...plan.tweens].sort((a, b) => a.at - b.at)) {
      assert.ok(known.has(tween.id), `${preset}: tween targets unknown ${tween.id}`);
      assert.ok(tween.dur > 0, `${preset}: ${tween.id} has no duration`);
      for (const prop of Object.keys(tween.to)) {
        const key = `${tween.id}.${prop}`;
        if (tween.ir) assert.ok(!seen.has(key), `${preset}: ${key} renders immediately after an earlier tween`);
        if (!tween.from) assert.ok(seen.has(key), `${preset}: ${key} is a to() without a prior tween`);
        seen.set(key, true);
      }
    }
    assert.match(plan.css, /\.lc-captions \{/);
    assert.doesNotMatch(captionPlanRuntime(plan), /autoAlpha|visibility|onUpdate|\.call\(|Math\.random|Date\.now/);
  }
});

test("the frame-pure evaluator matches a real GSAP timeline seeked to every frame", () => {
  const parse = (value) => String(value).startsWith("#") ? [1, 3, 5].map((i) => parseInt(String(value).slice(i, i + 2), 16)) : String(value).match(/[\d.]+/g).slice(0, 3).map(Number);
  for (const preset of CAPTION_PRESET_NAMES) for (const variant of VARIANTS) {
    const plan = captionPlan(CHUNKS, { type: "captions", preset, ...variant }, { brand: BRAND, format: FORMAT });
    const targets = new Map();
    const target = (id) => { if (!targets.has(id)) targets.set(id, {}); return targets.get(id); };
    // Plain-object targets seeded with the CSS starting values.
    const seed = { opacity: 0, x: 0, y: 0, scale: 1, scaleX: 1, width: 0, color: plan.options.colors.idle, backgroundColor: plan.options.colors.chip };
    for (const tween of plan.tweens) for (const key of Object.keys(tween.to)) if (!(key in target(tween.id))) target(tween.id)[key] = seed[key];
    const tl = gsap.timeline({ paused: true });
    for (const tween of plan.tweens) {
      const vars = { ...tween.to, duration: tween.dur, ease: tween.ease };
      if (tween.from) { if (!tween.ir) vars.immediateRender = false; tl.fromTo(target(tween.id), { ...tween.from }, vars, tween.at); }
      else tl.to(target(tween.id), vars, tween.at);
    }
    const index = indexCaptionTweens(plan.tweens);
    let worst = 0;
    for (let frame = 0; frame <= 4.2 * 30; frame += 1) {
      const t = frame / 30;
      tl.seek(t, false);
      for (const [id, values] of captionStateAt(plan, t, index)) for (const [key, value] of Object.entries(values)) {
        const actual = targets.get(id)[key];
        if (typeof value === "number") worst = Math.max(worst, Math.abs(value - actual) / (key === "width" ? 100 : key === "x" || key === "y" ? 50 : 1));
        else worst = Math.max(worst, ...parse(value).map((channel, i) => Math.abs(channel - parse(actual)[i]) / 255));
      }
    }
    tl.kill();
    assert.ok(worst < 0.002, `${preset} ${JSON.stringify(variant)}: evaluator differs from GSAP by ${worst}`);
  }
});

test("inline styles follow GSAP's transform order", () => {
  assert.deepEqual(captionInlineStyle({ opacity: 0.5, y: 26, scale: 0.86 }), { opacity: 0.5, transform: "translate(0px, 26px) scale(0.86, 0.86)" });
  assert.deepEqual(captionInlineStyle({ scaleX: 0.25, width: 40 }), { width: "40%", transform: "translate(0px, 0px) scale(0.25, 1)" });
  const plan = captionPlan(CHUNKS, { type: "captions" }, { brand: BRAND, format: FORMAT });
  assert.deepEqual(captionElementStateAt(indexCaptionTweens(plan.tweens), "cap-001", 0), { opacity: 0, y: 26, scale: 0.86 }, "the line pop renders its from-state immediately");
});

test("backward compatible: legacy styles, defaults and word-highlight timing", () => {
  assert.equal(captionPresetName({ type: "captions" }), "word-highlight");
  assert.equal(captionPresetName({ type: "captions", style: "word-highlight" }), "word-highlight");
  assert.equal(captionPresetName({ type: "captions", style: "line" }), "minimal-line");
  assert.equal(captionPresetName({ type: "captions", style: "none" }), null);
  assert.equal(captionPresetName({ type: "captions", style: "glow" }), "glow", "style may name a preset");
  assert.equal(captionPresetName({ type: "captions", preset: "bubble", style: "word-highlight" }), "bubble", "preset wins over style");
  const legacy = captionPlan(CHUNKS, { type: "captions", style: "word-highlight" }, { brand: BRAND, format: FORMAT });
  assert.deepEqual(legacy.tweens, captionPlan(CHUNKS, { type: "captions", preset: "word-highlight" }, { brand: BRAND, format: FORMAT }).tweens);
  // The original runtime's motion, unchanged.
  const line = legacy.tweens.find((tween) => tween.id === "cap-001" && tween.from);
  assert.deepEqual(line.from, { ...CAPTION_MOTION.lineIn.from });
  assert.equal(line.dur, CAPTION_MOTION.lineIn.duration);
  assert.equal(line.ease, CAPTION_MOTION.lineIn.ease);
  const word = legacy.tweens.find((tween) => tween.id === "cap-001-w0" && tween.from);
  assert.equal(word.at, Math.round((WORDS[0].start - CAPTION_MOTION.wordOn.lead) * 10000) / 10000);
  assert.deepEqual(word.to, { color: BRAND.colors.primary, scale: CAPTION_MOTION.wordOn.scale });
  assert.deepEqual(CAPTION_ENTRANCES.pop.from, CAPTION_MOTION.lineIn.from);
  assert.deepEqual(CAPTION_EXITS["fade-up"].to, CAPTION_MOTION.lineOut.to);
  assert.equal(legacy.nodes.length, CHUNKS.length, "word-highlight keeps the default chunking");
  assert.ok(captionPlan(CHUNKS, { type: "captions", preset: "minimal-line" }, { brand: BRAND, format: FORMAT }).nodes.length < CHUNKS.length, "minimal-line re-chunks into longer lines");
});

test("the captions overlay validates presets and options", () => {
  const base = { schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 4 }, brand: BRAND, scenes: [{ id: "s1", module: "hook-title", start: 0, end: 4, params: { headline: "Hi" } }] };
  assert.equal(validateStory({ ...base, overlays: [{ type: "captions", preset: "glow", position: "top", case: "upper", max_words: 4, size: 1.2, emphasis: ["hi"], colors: { active: "accent", idle: "#ffffff" }, entrance: "scale", exit: "shrink", offset: -0.05, stroke: false }] }).ok, true);
  const bad = validateStory({ ...base, overlays: [{ type: "captions", preset: "sparkle", position: "left", case: "lower", max_words: 0, size: 9, colors: { glow: "#fff" }, entrance: "spin", offset: 2, style: "fancy" }] });
  for (const pattern of [/preset/, /position/, /case/, /max_words/, /size/, /colors\.glow/, /entrance/, /offset/, /\.style/]) assert.ok(bad.errors.some((error) => pattern.test(error)), `${pattern}: ${bad.errors.join("; ")}`);
});

test("every preset compiles into the HyperFrames project and the Remotion component draws the same plan", async () => {
  const story = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  for (const preset of CAPTION_PRESET_NAMES) {
    const resolved = resolveStory({ ...story, overlays: [{ type: "captions", preset }] }, { words });
    const { html } = await compileStoryToHyperFrames(resolved, { sourceDir: MINIMAL, write: false });
    assert.match(html, new RegExp(`caption preset ${preset}\\)`));
    assert.match(html, /window\.mountCaptions\(tl, document\.getElementById\("lc-captions"\)\);/);
    const plan = captionPlan(chunkWords(words), resolved.overlays[0], { brand: resolved.brand, format: resolved.format, story: resolved });
    assert.ok(html.includes(`var TWEENS = ${JSON.stringify(plan.tweens)};`), `${preset}: the compiled tweens are the shared plan`);
  }
  const none = resolveStory({ ...story, overlays: [{ type: "captions", preset: "none" }] }, { words });
  assert.doesNotMatch((await compileStoryToHyperFrames(none, { sourceDir: MINIMAL, write: false })).html, /mountCaptions/);
  const component = await readFile(path.join(ROOT, "kit", "remotion", "captions", "WordCaptions.tsx"), "utf8");
  assert.match(component, /captionPlan\(chunks, own, \{ brand, format: \{ width, height \}, story, hide/);
  assert.match(component, /captionElementStateAt\(index, node\.id, t\)/);
  assert.match(component, /<style>\{plan\.css\}<\/style>/);
});

const fixtures = readdirSync(path.join(ROOT, "test", "fixtures", "parity-captions")).filter((name) => name.endsWith(".json")).sort();

test("a parity fixture exists for every preset", async () => {
  const presets = await Promise.all(fixtures.map(async (file) => JSON.parse(await readFile(path.join(ROOT, "test", "fixtures", "parity-captions", file), "utf8")).preset));
  assert.deepEqual(presets.sort(), [...CAPTION_PRESET_NAMES].sort());
});

test("caption parity: every preset, HyperFrames vs Remotion stills at word boundaries and mid-animation", { skip: process.env.LAUNCHCLIP_PARITY === "1" ? false : "set LAUNCHCLIP_PARITY=1 to render caption parity fixtures", timeout: 1_800_000 }, async () => {
  const { captionFixtures, runCaptionParitySuite } = await import("../scripts/parity-captions.mjs");
  const reports = await runCaptionParitySuite(await captionFixtures());
  for (const report of reports) for (const sample of report.samples) assert.ok(sample.pass, `${report.preset} ${sample.name}: ssim ${sample.ssim} < ${report.threshold.ssim} (see ${report.outDir}/${sample.sideBySide})`);
});
