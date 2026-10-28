import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyStyle, assignPaletteRoles, checkPackContrast, contrastRatio, nearestBundledFont, STYLE_SCHEMA, stylePromptLines, upgradeV1Pack, validateStylePack } from "@launchclip/core/style.mjs";
import { knownModules, resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { planningPrompt } from "@launchclip/core/planning-prompt.mjs";
import { createStylePack, listBuiltinStyles, loadStylePack, resolveStyleV2, upgradeStylePack, writeStyleV2 } from "../src/style_store.js";
import { applyProjectStyle } from "../src/story_style.js";
import { readProjectStory } from "../src/story_loader.js";
import { runStoryCommand } from "../src/story_cli.js";
import { chooseBed } from "../src/finish.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXPLAINER = path.join(ROOT, "examples", "story", "explainer-9x16");

const pack = (overrides = {}) => ({
  schema: STYLE_SCHEMA,
  name: "channel",
  brand: { colors: { bg: "#101010", paper: "#fafafa", ink: "#101010", primary: "#ffcc00", accent: "#33ccff" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
  motion: { grammar: "snappy" },
  camera: { mode: "world", layout: "row" },
  ambient: { level: "lively" },
  captions: { preset: "outline-heavy", position: "auto" },
  sound: { sfx_density: "low", music: { bpm_range: [120, 130] } },
  modules: { prefer: ["hook-title"], avoid: ["logo-row"], params: { "kinetic-words": { variant: "rise" } } },
  layout: { title_case: true },
  ...overrides
});

const story = (overrides = {}) => ({
  schema: "launchclip.story.v1",
  lane: "motion",
  format: { width: 1080, height: 1920, fps: 30, duration: 6 },
  scenes: [{ id: "s1", module: "hook-title", start: 0, end: 3, params: { headline: "Hello there" } }, { id: "s2", module: "kinetic-words", start: 3, end: 6, params: { words: [{ text: "Fast", at: 0.3 }] } }],
  ...overrides
});

test("validates the v2 schema", () => {
  assert.equal(validateStylePack(pack()).ok, true);
  const bad = validateStylePack({ schema: STYLE_SCHEMA, name: "../x", brand: { colors: { bg: "red" } }, captions: { preset: "sparkle" }, sound: { sfx_density: "loud", music: { bpm_range: [140, 100] } }, ambient: { level: "max" }, intro: { module: "hook-title", duration: 0 } });
  assert.equal(bad.ok, false);
  for (const pattern of [/name/, /brand\.colors\.bg/, /captions\.preset/, /sfx_density/, /bpm_range/, /ambient\.level/, /intro\.duration/]) assert.ok(bad.errors.some((error) => pattern.test(error)), `${pattern} in ${bad.errors.join("; ")}`);
  assert.match(validateStylePack({ schema_version: "launchclip.style-pack.v1", name: "old" }).errors.join(" "), /style upgrade old/);
});

test("applyStyle: explicit story values win, the pack fills gaps and reports what it filled", () => {
  const base = story({ brand: { colors: { primary: "#ff0000" }, fonts: { display: "syne" } }, overlays: [{ type: "captions", style: "word-highlight" }], motion: { grammar: "smooth" } });
  const { story: merged, applied } = applyStyle(base, pack());
  assert.equal(merged.brand.colors.primary, "#ff0000", "story colour wins");
  assert.equal(merged.brand.colors.bg, "#101010", "pack fills a missing colour");
  assert.equal(merged.brand.fonts.display, "syne");
  assert.equal(merged.brand.fonts.body, "inter");
  assert.equal(merged.motion.grammar, "smooth", "story grammar wins");
  assert.deepEqual(merged.camera, { mode: "world", layout: "row" });
  assert.deepEqual(merged.ambient, { level: "lively" });
  assert.equal(merged.overlays[0].style, "word-highlight");
  assert.equal(merged.overlays[0].preset, undefined, "an explicit legacy style is not replaced by the pack preset");
  assert.equal(merged.overlays[0].position, "auto", "other caption options still fill");
  assert.equal(merged.audio.sfx_density, "low");
  assert.deepEqual(merged.audio.music_hints, { bpm_range: [120, 130] });
  assert.equal(merged.scenes[1].params.variant, "rise", "module defaults apply per scene");
  assert.ok(applied.includes("brand.colors.bg") && applied.includes("scenes.s2.params.variant") && !applied.includes("brand.colors.primary"));
  assert.deepEqual(merged.meta.style, { name: "channel", applied });
  assert.equal(base.brand.colors.bg, undefined, "the input is not mutated");
  // Idempotent: a merged story is returned unchanged.
  assert.equal(applyStyle(merged, pack({ brand: { colors: { bg: "#000000" } } })).story, merged);
});

test("applyStyle adds a captions overlay only when the story declares no overlays, and intro/outro only on request", () => {
  assert.deepEqual(applyStyle(story(), pack()).story.overlays, [{ type: "captions", preset: "outline-heavy", position: "auto" }]);
  assert.deepEqual(applyStyle(story({ overlays: [] }), pack()).story.overlays, []);
  assert.equal(applyStyle(story({ overlays: [{ type: "captions" }] }), pack()).story.overlays[0].preset, "outline-heavy");
  const withEnds = pack({ intro: { module: "hook-title", params: { headline: "My channel" }, duration: 1.5 }, outro: { module: "cta", params: { action: "Subscribe" }, duration: 2 } });
  const plain = applyStyle(story(), withEnds).story;
  assert.equal(plain.scenes.length, 2, "no intro or outro unless requested");
  const requested = applyStyle(story({ style: { name: "channel", intro: true, outro: true } }), withEnds).story;
  assert.deepEqual(requested.scenes.map((scene) => [scene.id, scene.start, scene.end]), [["intro", 0, 1.5], ["s1", 1.5, 4.5], ["s2", 4.5, 7.5], ["outro", 7.5, 9.5]]);
  assert.equal(requested.format.duration, 9.5);
  assert.equal(validateStory(requested, { modules: knownModules() }).ok, true);
  const voiced = applyStyle(story({ audio: { voice: "assets/audio/v.wav", words: "NARRATION.json" }, style: { name: "channel", intro: true } }), withEnds);
  assert.equal(voiced.story.scenes[0].id, "s1");
  assert.match(voiced.warnings.join(" "), /intro skipped/);
});

test("resolution order: explicit path, project, home, then built-in", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-v2-"));
  const home = path.join(dir, "home");
  try {
    await writeStyleV2(pack({ name: "editorial-dark", description: "home copy" }), { root: path.join(home, "styles") });
    assert.equal((await resolveStyleV2("editorial-dark", { projectDir: dir, home })).source, "home");
    await writeStyleV2(pack({ name: "editorial-dark", description: "project copy" }), { root: path.join(dir, ".launchclip", "styles") });
    const project = await resolveStyleV2("editorial-dark", { projectDir: dir, home });
    assert.equal(project.source, "project");
    assert.equal(project.pack.description, "project copy");
    assert.equal((await resolveStyleV2("bold-creator", { projectDir: dir, home })).source, "builtin");
    await mkdir(path.join(dir, "styles"), { recursive: true });
    await writeFile(path.join(dir, "styles", "mine.json"), JSON.stringify(pack({ name: "mine" })));
    assert.equal((await resolveStyleV2("./styles/mine.json", { projectDir: dir, home })).source, "path");
    await assert.rejects(resolveStyleV2("nope", { projectDir: dir, home }), /not found.*built-in style/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a storyboard style is merged in the shared read path (validate, loader)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-story-"));
  try {
    const source = JSON.parse(await readFile(path.join(EXPLAINER, "storyboard.json"), "utf8"));
    delete source.brand;
    source.overlays = [{ type: "captions" }];
    source.style = "neon-explainer";
    await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(source));
    await writeFile(path.join(dir, "NARRATION.json"), await readFile(path.join(EXPLAINER, "NARRATION.json")));
    await writeFile(path.join(dir, "DIRECTION.json"), await readFile(path.join(EXPLAINER, "DIRECTION.json")));
    const validation = await runStoryCommand("validate", path.join(dir, "storyboard.json"), {});
    assert.equal(validation.status, "passed", validation.errors.join("; "));
    assert.equal(validation.style.name, "neon-explainer");
    const loaded = await readProjectStory(dir);
    assert.equal(loaded.resolved.brand.colors.primary, "#19f0ff");
    assert.equal(loaded.resolved.overlays[0].preset, "glow");
    assert.equal(loaded.style.source, "builtin");
    const again = await applyProjectStyle(loaded.resolved, { projectDir: dir });
    assert.equal(again.story, loaded.resolved, "merging twice is a no-op");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("v1 packs upgrade to v2 and still load", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-style-upgrade-"));
  try {
    const source = path.join(cwd, "video");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "frame.md"), "# AI news\n\nBackground: #0a0a12\nText: #f4f4f4\nPrimary highlight #ff6a00\nAccent #00c2ff\n\nHeadline font: Bebas Neue\nBody font: Helvetica\nMotion: snappy and punchy.\n");
    await writeFile(path.join(source, "caption-skin.html"), "<template></template>\n");
    await writeFile(path.join(source, "audio.md"), "Lots of SFX, punchy synth stabs.\n");
    await createStylePack("ai-news", { cwd, from: source });
    const inMemory = await resolveStyleV2("ai-news", { projectDir: cwd, home: path.join(cwd, "home") });
    assert.equal(inMemory.upgraded, true);
    assert.match(inMemory.warnings.join(" "), /style upgrade ai-news/);
    const result = await upgradeStylePack("ai-news", { cwd });
    assert.equal(result.status, "upgraded");
    const upgraded = JSON.parse(await readFile(path.join(cwd, ".launchclip", "styles", "ai-news", "style.json"), "utf8"));
    assert.equal(upgraded.schema, STYLE_SCHEMA);
    assert.deepEqual(upgraded.brand.colors, { bg: "#0a0a12", paper: "#f4f4f4", ink: "#0a0a12", primary: "#ff6a00", accent: "#00c2ff" });
    assert.deepEqual(upgraded.brand.fonts, { display: "bebas-neue", body: "inter" });
    assert.equal(upgraded.motion.grammar, "snappy");
    assert.equal(upgraded.captions.preset, "word-highlight");
    assert.equal(upgraded.sound.sfx_density, "high");
    assert.equal(validateStylePack(upgraded).ok, true);
    const legacy = await loadStylePack(path.join(cwd, ".launchclip", "styles", "ai-news"));
    assert.match(legacy.specification, /## Palette/, "v1 readers (intake) still get a specification");
    assert.equal((await upgradeStylePack("ai-news", { cwd })).status, "unchanged");
    assert.equal(upgradeV1Pack({ name: "x", specification: "nothing here" }).pack.schema, STYLE_SCHEMA);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("built-in starter styles validate, pass contrast and merge into a valid story", async () => {
  const builtins = await listBuiltinStyles();
  assert.ok(builtins.length >= 4 && builtins.length <= 6);
  const presets = new Set();
  const displays = new Set();
  const explainer = JSON.parse(await readFile(path.join(EXPLAINER, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(EXPLAINER, "NARRATION.json"), "utf8")).words;
  for (const entry of builtins) {
    const starter = JSON.parse(await readFile(entry.file, "utf8"));
    const validation = validateStylePack(starter, { modules: knownModules() });
    assert.equal(validation.ok, true, `${entry.name}: ${validation.errors.join("; ")}`);
    assert.deepEqual(validation.warnings, [], `${entry.name}: ${validation.warnings.join("; ")}`);
    for (const finding of checkPackContrast(starter)) assert.ok(finding.ok, `${entry.name} ${finding.pair} ${finding.ratio} < ${finding.min}`);
    presets.add(starter.captions.preset);
    displays.add(starter.brand.fonts.display);
    const copy = structuredClone(explainer);
    delete copy.brand;
    copy.overlays = [{ type: "captions" }];
    const merged = applyStyle(copy, starter).story;
    const resolved = resolveStory(merged, { words });
    assert.equal(validateStory(resolved, { modules: knownModules() }).ok, true, entry.name);
    for (const scene of resolved.scenes) resolveModule(scene, resolved);
  }
  assert.equal(presets.size, builtins.length, "each starter has its own caption preset");
  assert.equal(displays.size, builtins.length, "each starter has its own display face");
});

test("palette roles, contrast and nearest fonts", () => {
  const roles = assignPaletteRoles([{ hex: "#0d1117", weight: 0.9 }, { hex: "#58a6ff", weight: 0.04 }, { hex: "#f0f6fc", weight: 0.03 }, { hex: "#3fb950", weight: 0.02 }]);
  assert.equal(roles.colors.bg, "#0d1117");
  assert.equal(roles.colors.paper, "#f0f6fc");
  assert.equal(roles.colors.primary, "#58a6ff");
  assert.equal(roles.colors.accent, "#3fb950");
  const fixed = assignPaletteRoles([{ hex: "#202020", weight: 0.9 }, { hex: "#303030", weight: 0.1 }]);
  assert.ok(contrastRatio(fixed.colors.paper, fixed.colors.bg) >= 4.5, "text is pushed to readable contrast");
  assert.ok(fixed.notes.length > 0);
  assert.equal(nearestBundledFont("Bebas Neue"), "Bebas Neue", "a bundled family is itself");
  assert.equal(nearestBundledFont("League Gothic"), "Oswald");
  assert.equal(nearestBundledFont("Playfair Display"), "Playfair Display");
  assert.equal(nearestBundledFont("Didot"), "Playfair Display");
  assert.equal(nearestBundledFont("Recoleta"), "Fraunces");
  assert.equal(nearestBundledFont("Poppins"), "Outfit");
  assert.equal(nearestBundledFont("Space Grotesk"), "Space Grotesk");
  assert.equal(nearestBundledFont("Comic Unknown", "meta"), "JetBrains Mono");
});

test("the planner prompt carries the style pack", () => {
  const prompt = planningPrompt({ tier: "structured", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 20 }, style: pack() });
  assert.match(prompt, /## Style pack \(keep the channel consistent\)/);
  assert.match(prompt, /Prefer these modules where the script allows: hook-title/);
  assert.match(prompt, /Avoid these modules: logo-row/);
  assert.match(prompt, /outline-heavy preset/);
  assert.ok(stylePromptLines(pack()).some((line) => /Title Case/.test(line)));
  assert.doesNotMatch(planningPrompt({ tier: "structured" }), /Style pack/);
});

test("finish bounds the music bed tempo by the style's bpm range", () => {
  const resolved = { resolved: { duration: 10 }, scenes: [{ start: 0, end: 10, energy: 0 }] };
  assert.equal(chooseBed(resolved, {}).bpm, 84);
  assert.equal(chooseBed(resolved, { bpm_range: [120, 130] }).bpm, 120);
});

test("applyStyle honours loop: false as well as loop: true, and the story's style.loop overrides the pack", () => {
  const story = (extra = {}) => ({ schema: "launchclip.story.v1", lane: "motion", format: { width: 1080, height: 1920, fps: 30, duration: 6 },
    scenes: [{ id: "s1", module: "hook-title", start: 0, end: 6, params: { headline: "Hi" } }], ...extra });
  assert.deepEqual(applyStyle(story(), { loop: true }).story.ending, { loop_to: "s1" });
  const off = applyStyle(story(), { loop: false });
  assert.deepEqual(off.story.ending, { loop: false });
  assert.ok(off.applied.includes("ending.loop"));
  assert.deepEqual(validateStory({ ...off.story, brand: { colors: { bg: "#000000", primary: "#ffffff" }, fonts: { display: "anton" } } }).errors, []);
  // The story's own style.loop wins over the pack, either way.
  assert.deepEqual(applyStyle(story({ style: { name: "dark", loop: false } }), { loop: true }).story.ending, { loop: false });
  assert.deepEqual(applyStyle(story({ style: { name: "dark", loop: true } }), { loop: false }).story.ending, { loop_to: "s1" });
  // An explicit ending always wins, including the no-loop forms.
  assert.deepEqual(applyStyle(story({ ending: { loop_to: null } }), { loop: true }).story.ending, { loop_to: null });
  assert.deepEqual(applyStyle(story({ ending: { final: "fade" } }), { loop: true }).story.ending, { final: "fade" });
  // No loop setting anywhere: no ending is written.
  assert.equal(applyStyle(story(), {}).story.ending, undefined);
});
