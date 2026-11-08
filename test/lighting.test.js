import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { LIGHT_OVER_ID, LIGHT_PARAMS, LIGHT_PRESET_NAMES, LIGHT_PRESETS, LIGHT_PULSE_PARAMS, keyEllipse, lightErrors, lightLayerStyle, lightPlan, lightStateAt, lightTweens, litMask, pulseStateAt, storyLight } from "@launchclip/core/lighting.mjs";
import { STORY_LIGHT_PARAMS, STORY_LIGHT_PRESETS, STORY_LIGHT_PULSE_PARAMS, resolveStory, validateStory } from "@launchclip/core/story.mjs";
import { STYLE_SCHEMA, applyStyle, validateStylePack } from "@launchclip/core/style.mjs";
import { backgroundErrors, backgroundPlan } from "@launchclip/core/backgrounds.mjs";
import { contrast, mix } from "@launchclip/core/panels.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

function story(extra = {}) {
  return {
    schema: "launchclip.story.v1", lane: "motion", title: "Lit",
    format: { width: 1080, height: 1920, fps: 30, duration: 6 },
    brand: { colors: { bg: "#0a0b08", paper: "#f4f6ee", ink: "#0a0b08", primary: "#c8ff3a", accent: "#c8ff3a" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
    scenes: [{ id: "a", module: "hook-title", start: 0, end: 6, params: { headline: "Hello" } }],
    ...extra
  };
}

async function minimal() {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  return { base, words };
}

test("the story validator keeps the lighting kit's presets and ranges", () => {
  assert.deepEqual(STORY_LIGHT_PRESETS, LIGHT_PRESET_NAMES);
  const ranges = (spec) => Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, [value.min, value.max]]));
  for (const [layer, spec] of Object.entries(LIGHT_PARAMS)) assert.deepEqual(STORY_LIGHT_PARAMS[layer], ranges(spec), layer);
  assert.deepEqual(Object.keys(STORY_LIGHT_PARAMS), Object.keys(LIGHT_PARAMS));
  assert.deepEqual(STORY_LIGHT_PULSE_PARAMS, ranges(LIGHT_PULSE_PARAMS));
  for (const [name, preset] of Object.entries(LIGHT_PRESETS)) assert.deepEqual(lightErrors(preset), [], name);
});

test("the lighting kit is plain ESM that imports only ambient.mjs, panels.mjs and motion.mjs, and keeps no clock", async () => {
  const source = await readFile(path.join(ROOT, "kit/core/lighting.mjs"), "utf8");
  const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports.sort(), ["./ambient.mjs", "./motion.mjs", "./panels.mjs"]);
  assert.doesNotMatch(source, /\brequire\(|Date\.now|performance\.now|Math\.random|setTimeout|setInterval/);
});

test("light validates the same way in the kit, the story and the style pack, and every error names the fix", () => {
  const good = { preset: "studio", key: { intensity: 0.5, color: "#ffffff" }, pool: false, pulses: [{ at: 2, radius: 0.3 }] };
  assert.deepEqual(lightErrors(good), []);
  assert.deepEqual(validateStory(story({ light: good })).errors, []);
  assert.deepEqual(validateStylePack({ schema: STYLE_SCHEMA, name: "lit", light: { preset: "studio" } }).errors, []);
  const bad = { preset: "disco", glare: 1, key: { intensity: 2, color: "green", beam: 1 }, haze: 3, pulses: [{ x: 0.5 }, { at: -1, duration: 9 }] };
  const kit = lightErrors(bad);
  const storyErrors = validateStory(story({ light: bad })).errors;
  const packErrors = validateStylePack({ schema: STYLE_SCHEMA, name: "lit", light: bad }).errors;
  for (const pattern of [/light\.preset must be one of none, studio, spot, soft/, /light\.glare is not supported/, /light\.key\.intensity must be a number from 0 to 1/, /light\.key\.color must be accent, primary, paper or #rrggbb/, /light\.key\.beam is not supported/, /light\.haze must be an object or false/, /light\.pulses\[0\]\.at is required/, /light\.pulses\[1\]\.duration must be a number from 0.2 to 4/]) {
    assert.ok(kit.some((message) => pattern.test(message)), `kit: ${pattern}`);
    assert.ok(storyErrors.some((message) => pattern.test(message)), `story: ${pattern}`);
    assert.ok(packErrors.some((message) => pattern.test(message)), `pack: ${pattern}`);
  }
  assert.ok(storyErrors.some((message) => /light\.pulses\[1\]\.at must not be negative/.test(message)));
  assert.ok(validateStory(story({ light: { pulses: Array.from({ length: 25 }, (_, i) => ({ at: i * 0.2 })) } })).errors.some((message) => /at most 24 pulses/.test(message)));
  assert.ok(validateStory(story({ light: "studio" })).errors.some((message) => /light must be an object/.test(message)));
});

test("a pulse's at is seconds or a narration anchor, resolved like other story times", async () => {
  const { base, words } = await minimal();
  const word = words[3];
  const lit = { ...base, light: { preset: "studio", pulses: [{ at: `word:${word.text}` }, { at: 0.5 }] } };
  assert.deepEqual(validateStory(lit).errors, []);
  const resolved = resolveStory(lit, { words });
  assert.equal(resolved.light.pulses[0].at, Math.round(word.start * 1000) / 1000);
  assert.equal(resolved.light.pulses[1].at, 0.5);
  assert.equal(lit.light.pulses[0].at, `word:${word.text}`, "the source story is untouched");
  assert.throws(() => resolveStory({ ...base, light: { pulses: [{ at: "word:nowhere" }] } }, { words }), /light\.pulses\[0\]\.at: Unknown anchor/);
  // storyLight sorts the pulses by time.
  assert.deepEqual(storyLight(resolved).pulses.map((pulse) => pulse.at), [0.5, resolved.light.pulses[0].at]);
});

test("storyLight fills a preset; the story's fields win, false turns a layer off", () => {
  assert.equal(storyLight(story()), null);
  assert.equal(storyLight(story({ light: { preset: "none" } })), null, "none alone is no light");
  assert.equal(storyLight(story({ light: { preset: "studio", key: { intensity: 5 } } })), null, "an invalid light draws nothing");
  assert.equal(storyLight(story({ lane: "footage-led", light: { preset: "studio" } })), null, "the recording is the picture");
  const studio = storyLight(story({ light: { preset: "studio" } }));
  assert.deepEqual(studio.key, { ...LIGHT_PRESETS.studio.key });
  assert.deepEqual(studio.vignette, { ...LIGHT_PRESETS.studio.vignette });
  const own = storyLight(story({ light: { preset: "studio", key: { intensity: 0.2 }, pool: false, haze: false } }));
  assert.equal(own.key.intensity, 0.2);
  assert.equal(own.key.size, LIGHT_PRESETS.studio.key.size);
  assert.equal(own.pool, null);
  assert.equal(own.haze, null);
  // Without a preset only the named layers draw, with the kit's defaults.
  const vignette = storyLight(story({ light: { vignette: {} } }));
  assert.equal(vignette.key, null);
  assert.deepEqual(vignette.vignette, { intensity: LIGHT_PARAMS.vignette.intensity.default });
  // A pulse takes the key's colour unless it names one.
  const pulses = storyLight(story({ light: { key: { color: "paper" }, pulses: [{ at: 1 }, { at: 2, color: "primary" }] } })).pulses;
  assert.deepEqual(pulses.map((pulse) => pulse.color), ["paper", "primary"]);
});

test("the plan is deterministic, layered under and over, and keeps paper text readable", () => {
  const lit = story({ light: { preset: "studio", pulses: [{ at: 2, x: 0.5, y: 0.4, intensity: 1 }] } });
  const plan = lightPlan(lit);
  assert.deepEqual(lightPlan(JSON.parse(JSON.stringify(lit))), plan);
  assert.deepEqual(plan.under.map((layer) => layer.id), ["haze0", "haze1", "haze2", "key", "pool", "pulse0"]);
  assert.deepEqual(plan.over.map((layer) => layer.id), ["wrap", "pulse0", "vignette"]);
  for (const layer of plan.over.filter((item) => item.id !== "vignette")) assert.equal(layer.style.mixBlendMode, "screen", layer.id);
  // The key hangs from the top centre, its box centred on the edge.
  const key = plan.under.find((layer) => layer.id === "key");
  assert.ok(Math.abs(key.box.x + key.box.width / 2 - 540) < 0.01);
  assert.ok(Math.abs(key.box.y + key.box.height / 2) < 0.01);
  // Every alpha a light lays over bg keeps paper at 4.5:1.
  const alpha = (layer) => Math.max(...[...layer.style.background.matchAll(/rgba\(\d+, \d+, \d+, ([\d.]+)\)/g)].map((match) => Number(match[1])));
  const color = (layer) => `#${layer.style.background.match(/rgba\((\d+), (\d+), (\d+)/).slice(1).map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
  for (const layer of plan.under) assert.ok(contrast("#f4f6ee", mix("#0a0b08", color(layer), alpha(layer))) >= 4.5, layer.id);
  // A loud key on a light palette is clamped.
  const bright = lightPlan(story({ brand: { colors: { bg: "#404040", paper: "#ffffff", accent: "#ffffff" } }, light: { key: { intensity: 1 } } }));
  const brightKey = bright.under.find((layer) => layer.id === "key");
  assert.ok(contrast("#ffffff", mix("#404040", "#ffffff", alpha(brightKey))) >= 4.5 - 1e-3);
  assert.ok(alpha(brightKey) < 0.32);
  // No canvas, or no light: no plan.
  assert.equal(lightPlan(story()), null);
  assert.equal(lightPlan({ ...lit, format: {} }), null);
});

test("ambient off stills the drift and the haze; pulses still swell", () => {
  const plan = lightPlan(story({ ambient: { level: "off" }, light: { preset: "studio", pulses: [{ at: 1 }] } }));
  for (const layer of plan.under) assert.deepEqual(layer.axes, {}, layer.id);
  assert.ok(plan.under.find((layer) => layer.id === "pulse0").pulse);
  const moving = lightPlan(story({ light: { preset: "studio" } }));
  assert.deepEqual(Object.keys(moving.under.find((layer) => layer.id === "key").axes).sort(), ["opacity", "scale", "x", "y"]);
});

test("a pulse swells and fades on its envelope and is dark before and after", () => {
  const pulse = { at: 2, rise: 0.36, fall: 0.84 };
  assert.deepEqual(pulseStateAt(pulse, 1.9), { opacity: 0, scale: 0.72 });
  assert.equal(pulseStateAt(pulse, 2).opacity, 0);
  assert.ok(Math.abs(pulseStateAt(pulse, 2.36).opacity - 1) < 1e-9);
  assert.ok(pulseStateAt(pulse, 2.2).opacity > 0.5);
  assert.ok(pulseStateAt(pulse, 2.36).scale > pulseStateAt(pulse, 2.1).scale);
  assert.deepEqual(pulseStateAt(pulse, 3.2), { opacity: 0, scale: 0.72 });
});

test("GSAP plays the tweens to the same state at any seek, in any order (HyperFrames = Remotion)", () => {
  const plan = lightPlan(story({ light: { preset: "studio", pulses: [{ at: 1.2, duration: 1.5 }, { at: 4, duration: 0.6 }] } }));
  const layers = [...plan.under, ...plan.over];
  const tl = gsap.timeline({ paused: true });
  const targets = new Map();
  for (const layer of layers) {
    const start = lightStateAt(layer, 0);
    const target = { x: start.x, y: start.y, scale: start.scale, opacity: start.opacity };
    targets.set(layer, target);
    for (const tw of lightTweens(layer, 0, 6)) tl.fromTo(target, { [tw.prop]: tw.from }, { [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false }, tw.at);
  }
  for (const t of [5.5, 0.3, 1.31, 4.2, 2.6, 0, 1.75, 3.9, 4.45, 1.2]) {
    tl.seek(t);
    for (const layer of layers) {
      const want = lightStateAt(layer, t), got = targets.get(layer);
      for (const prop of ["x", "y", "scale", "opacity"]) {
        // An idle pulse is invisible at either scale.
        if (prop === "scale" && layer.pulse && want.opacity === 0) continue;
        assert.ok(Math.abs(got[prop] - want[prop]) < 2e-3, `${layer.id}.${prop} at ${t}: ${got[prop]} vs ${want[prop]}`);
      }
    }
  }
  // The Remotion style carries the same state.
  const key = plan.under.find((layer) => layer.id === "key");
  const style = lightLayerStyle(key, 3.3);
  const state = lightStateAt(key, 3.3);
  assert.equal(style.opacity, Math.round(state.opacity * 1e5) / 1e5);
  assert.match(style.transform, /^translate\([-\d.]+px, [-\d.]+px\) rotate\(0deg\) scale\([\d.]+\)$/);
});

test("a lit dot grid shows its dots where the key light falls", () => {
  assert.deepEqual(backgroundErrors({ kind: "dot-grid", params: { lit: 0.7 } }), []);
  assert.ok(backgroundErrors({ kind: "dot-grid", params: { lit: 2 } }).some((message) => /lit must be a number from 0 to 1/.test(message)));
  assert.ok(backgroundErrors({ kind: "mesh", params: { lit: 0.5 } }).some((message) => /lit is not supported for mesh/.test(message)));
  assert.deepEqual(validateStory(story({ background: { kind: "dot-grid", params: { lit: 0.7 } } })).errors, []);
  const even = backgroundPlan(story({ background: { kind: "dot-grid" } }));
  assert.equal(even.layers[0].style.maskImage, undefined, "lit 0 is today's even grid");
  const plan = backgroundPlan(story({ background: { kind: "dot-grid", params: { lit: 0.7 } }, light: { preset: "studio", key: { x: 0.3 } } }));
  const mask = plan.layers[0].style.maskImage;
  assert.equal(plan.layers[0].style.WebkitMaskImage, mask);
  assert.match(mask, /at 30% 0%/, "the mask follows the key");
  assert.match(mask, /linear-gradient\(rgba\(0, 0, 0, 0\.3\), rgba\(0, 0, 0, 0\.3\)\)$/, "1 − lit elsewhere");
  // Without a story light the key is the studio preset's; with lit 1 nothing shows away from it.
  assert.match(litMask(story(), 1), /at 50% 0%/);
  assert.doesNotMatch(litMask(story(), 1), /linear-gradient/);
  assert.equal(litMask(story(), 0), null);
  const e = keyEllipse(LIGHT_PRESETS.studio.key);
  assert.ok(e.rx > 0.5 && e.ry > 0.2);
});

test("applyStyle carries a pack's light into the story; the story's own wins", () => {
  const pack = { schema: STYLE_SCHEMA, name: "lit", light: { preset: "studio" } };
  const merged = applyStyle(story(), pack);
  assert.deepEqual(merged.story.light, { preset: "studio" });
  assert.ok(merged.applied.includes("light"));
  assert.deepEqual(applyStyle(story({ light: { preset: "spot" } }), pack).story.light, { preset: "spot" });
  assert.equal(applyStyle(story(), { schema: STYLE_SCHEMA, name: "plain" }).story.light, undefined);
});

test("the HyperFrames compile lights every plate under its content and adds one layer over the scenes", async () => {
  const { base, words } = await minimal();
  const plain = await compileStoryToHyperFrames(resolveStory(base, { words }), { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(plain.html, /lc-light/);
  const none = await compileStoryToHyperFrames(resolveStory({ ...base, light: { preset: "none" } }, { words }), { write: false, sourceDir: MINIMAL });
  assert.equal(none.html, plain.html, "preset none is today's render");
  const lit = resolveStory({ ...base, light: { preset: "studio", pulses: [{ at: 1 }] } }, { words });
  const { html } = await compileStoryToHyperFrames(lit, { write: false, sourceDir: MINIMAL });
  const plates = (html.match(/class="lc-scene lc-plate/g) ?? []).length;
  assert.ok(plates > 0);
  assert.equal((html.match(/data-launchclip-light="under"/g) ?? []).length, plates, "every plate, the loop's clone included");
  // Under: after the background field, before the scene's content.
  const firstUnder = html.indexOf('data-launchclip-light="under"');
  assert.ok(html.lastIndexOf('class="lc-ambient-field"', firstUnder) < firstUnder);
  // Over: once, above the scenes, under the captions, at z 78000.
  assert.equal((html.match(new RegExp(`id="${LIGHT_OVER_ID}"`, "g")) ?? []).length, 1);
  assert.match(html, /id="lc-light-over" data-launchclip-light="over" aria-hidden="true" style="position:absolute;left:0;top:0;width:1080px;height:1920px;overflow:hidden;pointer-events:none;z-index:78000"/);
  assert.ok(html.indexOf(`id="${LIGHT_OVER_ID}"`) < html.indexOf('id="lc-captions"'));
  assert.match(html, /<div id="lc-light-over-vignette" class="lc-light-layer"/);
  assert.match(html, /mix-blend-mode:screen/);
  // The pulse swells on the timeline, in the plates it overlaps and over them.
  assert.match(html, /tl\.fromTo\("#lc-light-over-pulse0", \{"opacity":0,"force3D":false\}, \{"opacity":1,"duration":0\.36,"ease":"sine\.out","immediateRender":false,"force3D":false\}, 1\);/);
  assert.ok((html.match(/tl\.fromTo\("#lc-light-[^"]+-pulse0", \{"opacity":0/g) ?? []).length >= 2);
  // A module review has no light.
  const review = await compileStoryToHyperFrames(lit, { write: false, sourceDir: MINIMAL, sceneFilter: "s1" });
  assert.doesNotMatch(review.html, /lc-light/);
});

test("the Remotion story draws the same layers in the same places", async () => {
  const source = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.match(source, /lightPlan\(story\)/);
  assert.match(source, /lightLayerStyle\(layer, t\)/);
  assert.equal((source.match(/light=\{[^}]*lightFor\([^)]*\)[^}]*\}/g) ?? []).length, 4, "plates, cuts and world paths, and both loops");
  assert.match(source, /\{light\?\.over\.length \? <LightOver plan=\{light\} zIndex=\{LIGHT_Z\.remotion\} \/> : null\}\n\s*\{wipeLayers\}/);
  assert.match(source, /\{light\?\.over\.length \? <LightOver plan=\{light\} zIndex=\{CAMERA_STACK\.scenes\} \/> : null\}/);
});
