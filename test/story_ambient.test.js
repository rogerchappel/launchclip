// Ambient motion in the compilers (kit/core/ambient.mjs): the HyperFrames
// compiler emits the background field and the hold-drift wrapper as seek-safe
// GSAP, and the timeline lands on the same values the Remotion kit evaluates
// per frame.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { ambientField, blobStateAt, driftStateAt, sceneDrift } from "../kit/core/ambient.mjs";
import { profileGeometry } from "../kit/core/layout-check.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";
import { resolveStory } from "../kit/core/story.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples/story/minimal");

async function minimalStory(mutate = (story) => story) {
  const story = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const narration = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8"));
  return resolveStory(mutate(story), { words: narration.words });
}

// Every ambient tween line of a compiled timeline → {selector, from, to, at}.
function ambientTweens(html) {
  const lines = [...html.matchAll(/tl\.fromTo\("(#lc-(?:amb|drift)-[^"]+)", (\{[^}]*\}), (\{[^}]*\}), ([\d.]+)\);/g)];
  return lines.map(([, selector, from, to, at]) => ({ selector, from: JSON.parse(from), to: JSON.parse(to), at: Number(at) }));
}

test("HyperFrames: plates carry the background field and scenes the drift wrapper, as seek-safe GSAP", async () => {
  const story = await minimalStory();
  const { html, warnings } = await compileStoryToHyperFrames(story, { write: false, sourceDir: MINIMAL });
  assert.deepEqual(warnings, []);
  const field = ambientField(story);
  assert.ok(field && field.blobs.length >= 3);
  // s1, s2 and the loop clone are plates: each holds its own copy of the field, under the content.
  for (const id of ["s1", "s2", "s1-loop"]) {
    const layer = new RegExp(`<div id="lc-layer-${id}" class="lc-layer"><div id="lc-amb-field-${id}" class="lc-ambient-field" aria-hidden="true">((?:<div id="lc-amb-${id}-b\\d+" class="lc-ambient-blob" style="[^"]+"></div>)+)</div>`).exec(html);
    assert.ok(layer, `${id} starts with the ambient field`);
    assert.equal(layer[1].match(/lc-ambient-blob/g).length, field.blobs.length);
  }
  // The drift wraps the module content of s1 and s2; the loop clone holds its first state.
  assert.match(html, /<div id="lc-drift-s1" class="lc-drift" style="transform-origin:[\d.]+px [\d.]+px">/);
  assert.match(html, /<div id="lc-drift-s2" class="lc-drift" style="transform-origin:[\d.]+px [\d.]+px">/);
  assert.doesNotMatch(html, /lc-drift-s1-loop/);
  assert.match(html, /\.lc-drift \{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; \}/);
  const tweens = ambientTweens(html);
  assert.ok(tweens.length > 10);
  for (const tw of tweens) {
    assert.equal(tw.to.immediateRender, false, `${tw.selector} is seek-safe`);
    assert.equal(tw.to.force3D, false, `${tw.selector} keeps 2D transforms (crisp text, same pixels as Remotion)`);
    assert.ok(["none", "sine.inOut"].includes(tw.to.ease), `${tw.selector} uses a linear or sine ease`);
  }
  assert.doesNotMatch(html, /onUpdate|Math\.random|Date\.now/);
});

test("HyperFrames: seeking the compiled ambient tweens matches the frame-pure state Remotion draws", async () => {
  const story = await minimalStory();
  const { html } = await compileStoryToHyperFrames(story, { write: false, sourceDir: MINIMAL });
  const field = ambientField(story);
  const geometry = profileGeometry({ width: 1080, height: 1920 });
  const windows = sceneWindows(story);
  const drifts = new Map(windows.scenes.map((entry) => [entry.id, sceneDrift(story, entry.scene, resolveModule(entry.scene, story, { end: entry.renderEnd }), { window: { start: entry.start, end: entry.renderEnd }, geometry })]));
  const targets = new Map();
  const target = (selector) => { if (!targets.has(selector)) targets.set(selector, { x: 0, y: 0, scale: 1 }); return targets.get(selector); };
  const tl = gsap.timeline({ paused: true });
  for (const tw of ambientTweens(html)) {
    const { force3D, ...from } = tw.from;
    const { force3D: _ignored, ...to } = tw.to;
    tl.fromTo(target(tw.selector), from, to, tw.at);
  }
  tl.set({}, {}, story.resolved.duration);
  for (const t of [4.1, 0.5, 5.9, 2.2, 3.05, 1.0, 5.0]) {
    tl.seek(t, false);
    for (const [selector, state] of targets) {
      const blob = /^#lc-amb-([a-z0-9-]+)-(b\d+)$/.exec(selector);
      let expected;
      if (blob) {
        const layer = windows.scenes.find((entry) => entry.id === blob[1]);
        const visible = layer ? t >= layer.start && t < layer.renderEnd : t >= windows.loop.start;
        if (!visible) continue;
        expected = blobStateAt(field.blobs.find((entry) => entry.id === blob[2]), t);
      } else {
        expected = driftStateAt(drifts.get(selector.replace("#lc-drift-", "")), t);
      }
      for (const prop of ["x", "y", "scale"]) assert.ok(Math.abs(state[prop] - expected[prop]) < 2e-3, `${selector} ${prop} at ${t}: GSAP ${state[prop]} vs ${expected[prop]}`);
    }
  }
});

test("HyperFrames: ambient off, background off and module review compile without ambient layers", async () => {
  const off = await minimalStory((story) => ({ ...story, ambient: "off" }));
  const { html } = await compileStoryToHyperFrames(off, { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(html, /<div class="lc-ambient-field"|<div id="lc-drift-/);
  const noField = await minimalStory((story) => ({ ...story, ambient: { background: false } }));
  const second = await compileStoryToHyperFrames(noField, { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(second.html, /<div class="lc-ambient-field"/);
  assert.match(second.html, /<div id="lc-drift-s1"/);
  // A per-scene override turns one scene's drift off.
  const sceneOff = await minimalStory((story) => ({ ...story, scenes: story.scenes.map((scene) => scene.id === "s2" ? { ...scene, ambient: { drift: false } } : scene) }));
  const third = await compileStoryToHyperFrames(sceneOff, { write: false, sourceDir: MINIMAL });
  assert.match(third.html, /<div id="lc-drift-s1"/);
  assert.doesNotMatch(third.html, /<div id="lc-drift-s2"/);
  const review = await compileStoryToHyperFrames(await minimalStory(), { write: false, sourceDir: MINIMAL, sceneFilter: "s1" });
  assert.doesNotMatch(review.html, /<div class="lc-ambient-field"|<div id="lc-drift-/, "a module review has no ambient, like ModuleReview");
});
