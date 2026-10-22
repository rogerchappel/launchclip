import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import gsap from "gsap";
import { compileStoryToHyperFrames, COMPOSITION_ID } from "../kit/hyperframes/story-compiler.mjs";
import { brandModuleDefaults, contrastRatio, knownModules, placeholderModel, resolveModule } from "../kit/core/modules.mjs";
import { layerStateAt, sceneWindows, transitionTweens, TRANSITION_TYPES } from "../kit/core/transitions.mjs";
import { parseOutput } from "../src/renderers/command.js";
import { getEase } from "../kit/core/motion.mjs";
import { EDITORIAL_KINDS } from "../kit/core/editorial-core.mjs";
import { brandFontStacks, fontFaceRule, fontFamilyName, projectFontFamilies, registryFontFaces } from "../kit/core/fonts.mjs";
import { deriveBoundaries, resolveStory, validateStory } from "../kit/core/story.mjs";
import { parseDeclaredSequenceBoundaries } from "../src/cinematic_evidence.js";
import { runCli } from "../src/cli.js";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");
const HYPERFRAMES_CLI = require.resolve("hyperframes/dist/cli.js");

async function minimalStory(mutate = (story) => story) {
  const story = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8"));
  return resolveStory(mutate(story), { words: narration.words });
}

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("compiles the minimal story into a HyperFrames project that follows the runtime contract", async () => {
  const out = await tempDir("launchclip-hf-compile-");
  try {
    const story = await minimalStory();
    const result = await compileStoryToHyperFrames(story, { projectDir: out, sourceDir: MINIMAL });
    const html = await readFile(path.join(out, "index.html"), "utf8");
    assert.equal(html, result.html);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.files, ["assets/", "fonts/", "index.html"]);
    assert.ok((await stat(path.join(out, "assets/audio/mix.wav"))).size > 1000, "assets are copied beside index.html");

    // Fonts: every project family from the bundled registry, as local files.
    const faces = registryFontFaces(projectFontFamilies(story.brand));
    assert.ok(faces.length >= 9);
    for (const face of faces) {
      assert.ok((await stat(path.join(out, "fonts", face.file))).size > 10_000, `${face.file} is copied into fonts/`);
      assert.ok(html.includes(fontFaceRule(face, `fonts/${face.file}`)), `${face.family} ${face.style} is declared`);
    }
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|<link rel="stylesheet"/, "no font is fetched over the network");
    assert.match(html, /for \(const face of document\.fonts\) face\.load\(\)/, "every declared face starts loading before the fonts.ready wait");

    // One root composition, one paused timeline registered under its id.
    assert.match(html, new RegExp(`<div id="launchclip-root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="6" data-width="1080" data-height="1920" data-fps="30" data-launchclip-cinematic-contract="phase-2"`));
    assert.equal(html.match(/gsap\.timeline\(\{ paused: true \}\)/g).length, 2, "the root timeline plus the loop clone's held sub-timeline");
    assert.equal(html.match(/window\.__timelines\["launchclip-story"\] = tl;/g).length, 1);
    assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@3\.14\.2\/dist\/gsap\.min\.js"><\/script>/);
    assert.doesNotMatch(html, /Math\.random|Date\.now|onUpdate|setTimeout|<template/);

    // Exactly one root audio, from audio.mix, as a direct child of the root.
    assert.equal(html.match(/<audio\b/g).length, 1);
    assert.match(html, /<audio id="lc-audio" class="clip" src="assets\/audio\/mix\.wav" data-start="0" data-duration="6" data-media-start="0" data-volume="1" data-track-index="0"><\/audio>/);

    // Scenes: emitter output inside a layer, on distinct tracks while they overlap.
    assert.match(html, /<div id="lc-scene-s1" class="lc-scene lc-plate"[^>]*data-launchclip-render-end="3\.4"/, "s1 is held through s2's 0.4 s fade");
    assert.match(html, /<section id="s1" class="clip" data-start="0" data-duration="3\.4" data-track-index="2"/);
    assert.match(html, /<section id="s2" class="clip" data-start="3" data-duration="3" data-track-index="4"/);
    assert.match(html, /tl\.fromTo\("#lc-layer-s2", \{"opacity":0\}, \{"opacity":1,"duration":0\.4,"ease":"power1\.inOut","immediateRender":false\}, 3\);/);
    assert.match(html, /tl\.set\("#s1-number", \{textContent:"12"\}/, "the metric emitter motion is on the root timeline");

    // Phase-2 boundaries round-trip through the evidence parser.
    const parsed = parseDeclaredSequenceBoundaries(html, 6);
    assert.equal(parsed.ok, true, parsed.errors.join("; "));
    assert.deepEqual(parsed.boundaries.map((entry) => ({ ...entry, sequence_id: entry.sequence_id ?? null })), deriveBoundaries(story));
    assert.deepEqual(result.boundaries, deriveBoundaries(story));

    // Captions chunked from NARRATION.json words, mounted on the root timeline.
    assert.match(html, /var CHUNKS = \[\{"id":"cap-001","start":0\.3/);
    assert.match(html, /window\.mountCaptions\(tl, document\.getElementById\("lc-captions"\), \{ hide: \[\] \}\);/);
    assert.match(html, /--cap-active: #fdb022/);
    assert.match(html, /\.lc-captions \{ position: absolute; left: 6%; right: 15%; top: 62%/);

    // Loop ending: an unclipped s1 clone held at its first state on the last frame.
    const clone = html.match(/<div id="lc-scene-s1-loop"[\s\S]*?<\/section><\/div><\/div>/)[0];
    assert.doesNotMatch(clone, /class="clip|data-start=|data-track-index=/);
    assert.match(html, /tl\.fromTo\(loopTl, \{ time: 0 \}, \{ time: 0,/);

    // Brand fonts: role stacks with fallbacks.
    assert.match(html, /--lc-font-display: 'Anton', 'STIX Two Math', sans-serif;/);
    assert.match(html, /--cap-font: 'Anton'/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the compiled minimal project passes hyperframes lint", async () => {
  const out = await tempDir("launchclip-hf-lint-");
  try {
    await compileStoryToHyperFrames(await minimalStory(), { projectDir: out, sourceDir: MINIMAL });
    const { stdout } = await run(process.execPath, [HYPERFRAMES_CLI, "lint", "--json", out], { cwd: out });
    const report = parseOutput(stdout);
    assert.equal(report?.ok, true, stdout);
    assert.equal(report.errorCount, 0);
    assert.equal(report.warningCount, 0, stdout);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("sceneFilter compiles one scene on the background, like ModuleReview", async () => {
  const story = await minimalStory();
  const { html, boundaries, warnings } = await compileStoryToHyperFrames(story, { sourceDir: MINIMAL, sceneFilter: "s2", write: false });
  assert.deepEqual(warnings, []);
  assert.deepEqual(boundaries, []);
  assert.match(html, /id="lc-scene-s2"/);
  assert.doesNotMatch(html, /id="lc-scene-s1"|lc-scene-s1-loop|<audio|mountCaptions|data-launchclip-boundary-id/);
  assert.match(html, /<section id="s2" class="clip" data-start="3" data-duration="3"/);
  assert.doesNotMatch(html, /#lc-layer-s2/, "no transition tweens in isolation");
  assert.match(html, /data-duration="6"/, "absolute story times and duration are kept");
  const many = await compileStoryToHyperFrames(story, { sourceDir: MINIMAL, sceneFilter: (scene) => scene.id === "s1", write: false });
  assert.match(many.html, /id="lc-scene-s1"/);
  await assert.rejects(compileStoryToHyperFrames(story, { sourceDir: MINIMAL, sceneFilter: ["nope"], write: false }), /matched no scene/);
});

test("unknown modules render a labelled placeholder and a warning; invalid stories throw", async () => {
  const story = await minimalStory((value) => {
    value.scenes[0].module = "not-a-module";
    value.scenes[0].params = { rect: { x: 90, y: 380, width: 900, height: 620 } };
    value.scenes[1].params.rows[0].at = 99;
    return value;
  });
  const { html, warnings } = await compileStoryToHyperFrames(story, { sourceDir: MINIMAL, write: false });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /s1: .*module "not-a-module" is not a known module; rendering a placeholder/);
  assert.match(warnings[1], /s2: .*params: row\.at/);
  assert.match(html, /<section id="s1" class="clip lc-placeholder" data-start="0" data-duration="3\.4" data-track-index="2" data-launchclip-placeholder="not-a-module" style="left:90px;top:380px;width:900px;height:620px"><div class="lc-placeholder-label">Missing module: not-a-module<\/div>/);
  assert.match(html, /data-launchclip-placeholder="checklist"/);
  assert.match(html, /\.lc-placeholder \{ position: absolute;[^}]*border: 4px dashed #ff5a36/);

  const broken = await minimalStory((value) => { value.scenes[1].in = { type: "spin", dur: 0.4 }; return value; });
  await assert.rejects(compileStoryToHyperFrames(broken, { write: false }), /scenes\[1\]\.in\.type must be one of/);
  await assert.rejects(compileStoryToHyperFrames({ ...story, resolved: undefined }, { write: false }), /needs a resolved story/);
});

test("typed transitions hold the outgoing plate and move both layers by the shared tween table", async () => {
  const story = await minimalStory((value) => { value.scenes[1].in = { type: "push", dur: 0.5, direction: "left" }; return value; });
  const { html } = await compileStoryToHyperFrames(story, { sourceDir: MINIMAL, write: false });
  assert.match(html, /tl\.fromTo\("#lc-layer-s2", \{"x":1080\}, \{"x":0,"duration":0\.5,"ease":"power3\.inOut","immediateRender":false\}, 3\);/);
  assert.match(html, /tl\.fromTo\("#lc-layer-s1", \{"x":0\}, \{"x":-1080,"duration":0\.5,"ease":"power3\.inOut","immediateRender":false\}, 3\);/);
  assert.match(html, /tl\.fromTo\("#lc-scene-s1", \{ opacity: 1 \}, \{ opacity: 0, duration: 0, immediateRender: false \}, 3\.4995\);/);

  const { scenes } = sceneWindows(story);
  assert.deepEqual(scenes.map((entry) => [entry.id, entry.renderEnd]), [["s1", 3.5], ["s2", 6]]);

  const iris = transitionTweens({ type: "iris", dur: 0.6 }, { width: 1080, height: 1920 });
  assert.deepEqual(iris.in.map((tw) => [tw.prop, tw.from, tw.to]), [["iris", 0, 1104]]);
  assert.deepEqual(transitionTweens({ type: "cut", dur: 0.3 }, { width: 1080, height: 1920 }), { type: "cut", duration: 0, in: [], out: [] });
  const up = transitionTweens({ type: "whip", dur: 0.4, direction: "up" }, { width: 1080, height: 1920 });
  assert.deepEqual(up.in.map((tw) => [tw.prop, tw.from, tw.to]), [["y", 1920, 0], ["blur", 0, 24], ["blur", 24, 0]]);
});

test("frame-pure layer states match GSAP seeking the same tweens", () => {
  for (const type of TRANSITION_TYPES) {
    const tweens = transitionTweens({ type, dur: 0.6, direction: "right" }, { width: 1080, height: 1920 });
    for (const role of ["in", "out"]) {
      const list = tweens[role].map((tw) => ({ ...tw, at: 2 + tw.start }));
      if (!list.length) continue;
      const target = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, iris: 0 };
      const tl = gsap.timeline({ paused: true });
      for (const tw of list) tl.fromTo(target, { [tw.prop]: tw.from }, { [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false }, tw.at);
      tl.set({}, {}, 4);
      // Seek out of order, as renderers do.
      for (const t of [2.45, 2.05, 2.6, 2.3, 2.15, 2.59, 2.0001]) {
        tl.seek(t, false);
        const state = layerStateAt(t, list, getEase);
        for (const tw of list) {
          const expected = target[tw.prop];
          const actual = tw.prop === "iris" && state.iris === null ? tw.to : state[tw.prop];
          assert.ok(Math.abs(actual - expected) < 1e-6, `${type} ${role} ${tw.prop} at ${t}: ${actual} vs GSAP ${expected}`);
        }
      }
    }
  }
});

test("resolveModule adds brand defaults and the registry fields to editorial models", async () => {
  const story = await minimalStory();
  const model = resolveModule(story.scenes[0], story, { track: 6, end: 3.4 });
  assert.equal(model.module, "metric");
  assert.equal(model.sceneId, "s1");
  assert.equal(model.hidesCaptions, false);
  assert.equal(model.track, 6);
  assert.equal(model.duration, 3.4);
  assert.equal(model.accent, "#fdb022");
  assert.deepEqual(model.theme, { surface: "#06070d", foreground: "#f2eee6", muted: "#989694", border: "#303134", accentText: "#fdb022" });
  for (const key of ["enterStart", "enterEnd", "exitStart", "end", "enterFrom", "exitTo", "enterEase", "exitEase"]) assert.ok(key in model.motion, key);
  assert.ok(Array.isArray(model.events) && model.layout.canvas.width === 1080);

  const explicit = resolveModule({ ...story.scenes[0], params: { ...story.scenes[0].params, accent: "#46d4ff" } }, story);
  assert.equal(explicit.accent, "#46d4ff");
  assert.deepEqual(brandModuleDefaults({ colors: { bg: "#ffffff", paper: "#111111", primary: "#ffe066" } }).theme.accentText, "#111111", "a low-contrast primary falls back to paper");
  assert.ok(contrastRatio("#000000", "#ffffff") > 20);

  assert.throws(() => resolveModule({ ...story.scenes[0], module: "nope" }, story), /^Error: scenes\[0\] \(s1\): module "nope" is not a known module$/);
  assert.throws(() => resolveModule({ ...story.scenes[1], params: { title: "x" } }, story), /^Error: scenes\[1\] \(s2\): module "checklist" params:/);
  const square = { ...story, format: { ...story.format, width: 1080, height: 1080 } };
  assert.throws(() => resolveModule(story.scenes[0], square), /editorial modules need a 1080x1920/);
  assert.deepEqual(knownModules().slice(0, EDITORIAL_KINDS.length), EDITORIAL_KINDS);
  const placeholder = placeholderModel({ id: "x_1", module: "odd", start: 1, end: 2 }, story, "why");
  assert.equal(placeholder.id, "x-1");
  assert.deepEqual(placeholder.rect, { x: 86, y: 576, width: 908, height: 576 });
});

test("story validation reads audio.mix and the captions overlay src and hide", async () => {
  const story = await minimalStory();
  story.overlays = [{ type: "captions", style: "word-highlight", src: "assets/captions/captions.json", hide: [[1, 2]] }];
  assert.deepEqual(validateStory(story).errors, []);
  assert.deepEqual(validateStory({ ...story, audio: { mix: "/abs/mix.wav" } }).errors, ['audio.mix must be a project-relative path without "..", a leading slash or a URL scheme; got "/abs/mix.wav"']);
  const bad = { ...story, overlays: [{ type: "captions", src: "captions.json", hide: [[2, 1], "x"] }] };
  assert.deepEqual(validateStory(bad).errors, [
    'overlays[0].src must be a project-relative path under assets/; got "captions.json"',
    "overlays[0].hide[0] start must be before its end",
    "overlays[0].hide[1] must be a [start, end] pair"
  ]);
  assert.match(validateStory(story, { modules: knownModules() }).ok ? "ok" : "no", /ok/);
  const anchored = resolveStory({ ...story, overlays: [{ type: "captions", hide: [["word:twelve", 3]] }] }, { words: JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words });
  assert.deepEqual(anchored.overlays[0].hide, [[2.3, 3]]);
});

test("brand fonts resolve to family names and role stacks", () => {
  assert.equal(fontFamilyName("space-grotesk"), "Space Grotesk");
  assert.equal(fontFamilyName("jetbrains-mono"), "JetBrains Mono");
  assert.equal(fontFamilyName("Inter Tight"), "Inter Tight");
  const stacks = brandFontStacks({ fonts: { display: "anton", body: "space-grotesk" } });
  assert.deepEqual(stacks.families, ["Anton", "Space Grotesk"]);
  assert.equal(stacks.meta, "'JetBrains Mono', 'STIX Two Math', monospace");
});

test("launchclip story compile --renderer hyperframes writes the project and reports boundaries", async () => {
  const out = await tempDir("launchclip-hf-cli-");
  try {
    let text = "";
    await runCli(["story", "compile", MINIMAL, "--renderer", "hyperframes", "--out", out], { stdout: { write: (chunk) => { text += chunk; } }, stderr: { write() {} } });
    const result = JSON.parse(text);
    assert.equal(result.status, "compiled");
    assert.equal(result.composition_id, COMPOSITION_ID);
    assert.deepEqual(result.boundaries.map((entry) => entry.boundary_id), ["s2-in"]);
    assert.deepEqual(result.warnings, []);
    assert.ok((await stat(path.join(out, "index.html"))).size > 1000);
    await assert.rejects(runCli(["story", "compile", MINIMAL], { stdout: { write() {} }, stderr: { write() {} } }), /needs --renderer/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the skill copy of the compiler produces the same project as kit/hyperframes", async () => {
  const story = await minimalStory();
  const kit = await compileStoryToHyperFrames(story, { sourceDir: MINIMAL, write: false });
  const copy = await import("../skills/launchclip-create-video/scripts/story-compiler.mjs");
  const skill = await copy.compileStoryToHyperFrames(story, { sourceDir: MINIMAL, write: false });
  assert.equal(skill.html, kit.html);
  const source = await readFile(path.join(ROOT, "skills/launchclip-create-video-remotion/scripts/story-compiler.mjs"), "utf8");
  assert.match(source, /from '\.\/hyperframes-catalog-a\.mjs'/);
  assert.match(source, /from '\.\/modules\.mjs'/);
});

test("compiles a copied example without touching the source tree", async () => {
  const project = await tempDir("launchclip-hf-copy-");
  try {
    await cp(MINIMAL, project, { recursive: true });
    const result = await compileStoryToHyperFrames(await minimalStory(), { projectDir: path.join(project, "hyperframes"), sourceDir: project });
    assert.ok(result.files.includes("index.html"));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("fonts outside the registry use frozen assets/fonts files, else warn and keep the bundled role family", async () => {
  const source = await tempDir("launchclip-hf-frozen-font-");
  try {
    await cp(path.join(MINIMAL, "assets"), path.join(source, "assets"), { recursive: true });
    const story = await minimalStory((value) => ({ ...value, brand: { ...value.brand, fonts: { display: "poppins", body: "space-grotesk" } } }));
    const missing = await compileStoryToHyperFrames(story, { projectDir: source, sourceDir: source, write: false });
    assert.equal(missing.warnings.filter((line) => /font "Poppins" is not in the LaunchClip font registry/.test(line)).length, 1);
    assert.match(missing.html, /--lc-font-display: 'Poppins', 'Anton', 'STIX Two Math', sans-serif;/);
    await cp(path.join(ROOT, "node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2"), path.join(source, "assets/fonts/poppins-700.woff2"));
    const frozen = await compileStoryToHyperFrames(story, { projectDir: source, sourceDir: source, write: false });
    assert.ok(!frozen.warnings.some((line) => /Poppins/.test(line)), frozen.warnings.join("\n"));
    assert.match(frozen.html, /@font-face \{ font-family: 'Poppins'; src: url\("assets\/fonts\/poppins-700\.woff2"\) format\("woff2"\); font-weight: 700;/);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
});
