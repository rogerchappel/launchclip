import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import gsap from "gsap";
import {
  BACKGROUND_KINDS, BACKGROUND_PARAMS, BACKGROUND_COLORS, backgroundContrastFindings, backgroundErrors, backgroundPlan, backgroundTones,
  layerCss, layerStateAt, layerStyle, layerTweens, safeAlpha, sceneBackground, storyBackground
} from "../kit/core/backgrounds.mjs";
import { PANEL_TREATMENTS, contrast, panelErrors, panelFill, panelSurfaceStyle, panelTheme, storyPanel } from "../kit/core/panels.mjs";
import { STORY_BACKGROUND_COLORS, STORY_BACKGROUND_KINDS, STORY_BACKGROUND_PARAMS, STORY_PANEL_TREATMENTS, resolveStory, validateStory } from "../kit/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { cardSurface } from "../kit/core/catalog-g-base.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { captionOptions } from "../kit/core/captions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples", "story", "minimal");
export const DARK = Object.freeze({ bg: "#06070d", primary: "#fdb022", accent: "#46d4ff", ink: "#06070d", paper: "#f2eee6" });
export const LIGHT = Object.freeze({ bg: "#f5f1e8", primary: "#c2410c", accent: "#0e7490", ink: "#f5f1e8", paper: "#1c1917" });

function story(extra = {}, colors = DARK) {
  return {
    schema: "launchclip.story.v1", lane: "motion", title: "Background test",
    format: { width: 1080, height: 1920, fps: 30, duration: 8 },
    brand: { colors: { ...colors }, fonts: { display: "anton" } },
    scenes: [
      { id: "s1", module: "metric", start: 0, end: 4, energy: 1 },
      { id: "s2", module: "metric", start: 4, end: 8, energy: 3 }
    ],
    ...extra
  };
}

// Every param at its min, its max and its default, for every kind.
function paramSets(kind) {
  const spec = BACKGROUND_PARAMS[kind];
  const sets = [{}];
  for (const pick of ["min", "max"]) sets.push(Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, value[pick]])));
  return sets;
}

test("background core is plain ESM that imports only ambient.mjs and panels.mjs, and keeps no clock", async () => {
  for (const file of ["backgrounds.mjs", "panels.mjs"]) {
    const source = await readFile(path.join(ROOT, "kit/core", file), "utf8");
    const imports = [...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((match) => match[1]);
    assert.ok(imports.every((name) => ["./ambient.mjs", "./panels.mjs"].includes(name)), `${file} imports ${imports}`);
    assert.doesNotMatch(source, /\brequire\(|Date\.now|performance\.now|Math\.random/);
  }
});

test("story.mjs keeps the kinds, param ranges, colours and treatments in step", () => {
  assert.deepEqual(STORY_BACKGROUND_KINDS, [...BACKGROUND_KINDS]);
  assert.equal(BACKGROUND_KINDS.length, 12);
  for (const kind of BACKGROUND_KINDS) {
    assert.deepEqual(STORY_BACKGROUND_PARAMS[kind], Object.fromEntries(Object.entries(BACKGROUND_PARAMS[kind]).map(([key, value]) => [key, [value.min, value.max]])), kind);
  }
  assert.deepEqual(STORY_BACKGROUND_COLORS, [...BACKGROUND_COLORS]);
  assert.deepEqual(STORY_PANEL_TREATMENTS, [...PANEL_TREATMENTS]);
});

test("backgroundErrors and validateStory accept the ranges and reject the rest", () => {
  for (const kind of BACKGROUND_KINDS) for (const params of paramSets(kind)) {
    assert.deepEqual(backgroundErrors({ kind, params }), [], `${kind} ${JSON.stringify(params)}`);
    assert.equal(validateStory(story({ background: { kind, params } })).ok, true, `${kind} validates`);
  }
  assert.match(backgroundErrors({ kind: "plaid" })[0], /background\.kind must be one of flat, gradient/);
  assert.match(backgroundErrors({ kind: "gradient", params: { angle: 400 } })[0], /angle must be a number from 0 to 360/);
  assert.match(backgroundErrors({ kind: "flat", params: { angle: 4 } })[0], /takes no params/);
  assert.match(backgroundErrors({ kind: "stripes", params: { color: "ink" } })[0], /color must be one of primary, accent, paper/);
  assert.match(backgroundErrors({ kind: "mesh", extra: 1 })[0], /background\.extra is not supported/);
  const bad = validateStory(story({ background: { kind: "dot-grid", params: { scale: 9 } }, panel: { treatment: "chrome" } }));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => /background\.params\.scale must be a number from 0\.5 to 2/.test(error)), bad.errors.join("\n"));
  assert.ok(bad.errors.some((error) => /panel\.treatment must be one of solid, glass, paper, outline, soft-shadow/.test(error)), bad.errors.join("\n"));
  assert.deepEqual(panelErrors({ treatment: "outline", radius: 12 }), []);
  assert.match(panelErrors({ treatment: "glass", radius: 90 })[0], /radius must be a number from 0 to 48/);
});

test("no background is today's ambient field: blobs, no plan, the same plate rule", () => {
  const plain = story();
  assert.deepEqual(storyBackground(plain), { kind: "blobs", params: {} });
  assert.equal(backgroundPlan(plain), null);
  assert.equal(backgroundPlan(story({ background: { kind: "blobs" } })), null);
  assert.deepEqual(backgroundTones(plain), [DARK.bg]);
  assert.equal(sceneBackground(plain, plain.scenes[0]), true);
  assert.equal(sceneBackground(story({ ambient: "off" }), plain.scenes[0]), false, "blobs follow the field: none at level off");
  // Other kinds are part of the look: drawn (still) at level off, but not under footage or when switched off.
  assert.equal(sceneBackground(story({ ambient: "off", background: { kind: "stripes" } }), plain.scenes[0]), true);
  assert.equal(sceneBackground(story({ ambient: { background: false }, background: { kind: "stripes" } }), plain.scenes[0]), false);
  assert.equal(sceneBackground(story({ lane: "footage-led", background: { kind: "stripes" } }), { id: "o", track: 0 }), false);
  assert.equal(storyPanel(plain), null);
});

test("every kind and param set resolves deterministically, inside its box, on light and dark palettes", () => {
  for (const colors of [DARK, LIGHT]) for (const kind of BACKGROUND_KINDS.filter((name) => name !== "blobs")) for (const params of paramSets(kind)) {
    const s = story({ background: { kind, params } }, colors);
    const plan = backgroundPlan(s);
    assert.deepEqual(plan, backgroundPlan(s), `${kind} is deterministic`);
    assert.equal(plan.kind, kind);
    assert.ok(plan.tones.includes(colors.bg) || kind === "paper");
    for (const layer of plan.layers) {
      // Layers cover the canvas (or sit inside a moving wash) and never ship NaN.
      assert.doesNotMatch(JSON.stringify(layer), /NaN|undefined|Infinity/, `${kind}/${layer.id}`);
      assert.ok(layer.box.width > 0 && layer.box.height > 0);
    }
  }
});

test("colours stay inside the text floor on every tone, for every kind and param set", () => {
  for (const colors of [DARK, LIGHT]) for (const kind of BACKGROUND_KINDS) for (const params of paramSets(kind)) {
    const s = story({ background: { kind, params } }, colors);
    for (const tone of backgroundTones(s)) assert.ok(contrast(colors.paper, tone) >= 4.5 - 1e-9, `${kind} ${JSON.stringify(params)} tone ${tone}: ${contrast(colors.paper, tone).toFixed(2)}`);
    assert.deepEqual(backgroundContrastFindings(s), [], `${kind} passes the gate`);
  }
  // A palette whose bg is already near the floor gets almost nothing laid over it.
  const tight = { ...DARK, bg: "#747474", paper: "#ffffff" };
  assert.ok(contrast(tight.paper, tight.bg) < 4.8);
  assert.ok(safeAlpha(tight, "#ffffff", 0.6) < 0.05);
  assert.equal(safeAlpha(tight, "#000000", 0.3), 0.3, "darkening only helps white text");
});

test("motion obeys the ambient level: off is still, faster levels move faster", () => {
  const plan = (level) => backgroundPlan(story({ ambient: level, background: { kind: "dot-grid" } }));
  assert.deepEqual(plan("off").layers[0].axes, {}, "level off draws it still");
  const subtle = plan("subtle").layers[0].axes.x.period, lively = plan("lively").layers[0].axes.x.period;
  assert.ok(lively < subtle, "lively moves faster than subtle");
  assert.deepEqual(backgroundPlan(story({ background: { kind: "dot-grid", params: { speed: 0 } } })).layers[0].axes, {}, "speed 0 is still");
  for (const kind of ["flat", "paper"]) assert.ok(backgroundPlan(story({ background: { kind } })).layers.every((layer) => !Object.keys(layer.axes).length), `${kind} is still`);
});

test("layer tweens reproduce the axes exactly under GSAP seeking", () => {
  for (const kind of ["geometric", "mesh", "topographic", "light-rays", "gradient"]) {
    const plan = backgroundPlan(story({ format: { width: 1920, height: 1080, fps: 30, duration: 40 }, background: { kind } }));
    for (const layer of plan.layers) {
      const target = { x: 0, y: 0, rotation: 0, scale: 1 };
      const tl = gsap.timeline({ paused: true });
      for (const tw of layerTweens(layer, 2.2, 38)) tl.fromTo(target, { [tw.prop]: tw.from }, { [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false }, tw.at);
      for (const t of [20.2, 2.3, 37.8, 11.7, 5.05, 29.99]) {
        tl.seek(t, false);
        const state = layerStateAt(layer, t);
        for (const prop of Object.keys(layer.axes)) assert.ok(Math.abs(target[prop] - state[prop]) < 2e-3, `${kind}/${layer.id} ${prop} at ${t}: GSAP ${target[prop]} vs ${state[prop]}`);
      }
      tl.kill();
    }
  }
});

test("layerCss and layerStyle describe the same box and transform", () => {
  const plan = backgroundPlan(story({ background: { kind: "light-rays" } }));
  const layer = plan.layers[0];
  const css = layerCss(layer, 3.1);
  const style = layerStyle(layer, 3.1);
  assert.match(css, new RegExp(`left:${layer.box.x}px;top:${layer.box.y}px;width:${layer.box.width}px;height:${layer.box.height}px`));
  assert.ok(css.includes(`transform:${style.transform}`));
  assert.match(css, /-webkit-mask-image:radial-gradient/);
  assert.match(style.transform, /^translate\([-\d.]+px, [-\d.]+px\) rotate\([-\d.]+deg\) scale\([\d.]+\)$/);
  const grain = backgroundPlan(story({ background: { kind: "grain-gradient" } })).layers.find((entry) => entry.id === "grain");
  assert.doesNotMatch(layerCss(grain, 0), /"/, "no double quote breaks the style attribute");
  assert.match(layerCss(grain, 0), /opacity:0\.\d+;/);
});

test("panels follow the theme and keep today's card when none is set", () => {
  assert.equal(panelTheme(DARK), "dark");
  assert.equal(panelTheme(LIGHT), "light");
  const solid = panelSurfaceStyle("solid", { colors: DARK, unit: 1, border: "#333333" });
  assert.deepEqual(solid, { boxSizing: "border-box", borderRadius: 32, background: DARK.bg, border: "2px solid #333333", boxShadow: "0 18px 48px #00000073" });
  for (const treatment of PANEL_TREATMENTS) for (const colors of [DARK, LIGHT]) {
    const style = panelSurfaceStyle(treatment, { colors, unit: 2, border: "#333333", radius: 12 });
    assert.equal(style.borderRadius, 24);
    const fill = panelFill(treatment, colors);
    assert.ok(contrast(colors.paper, fill.color) >= 4.5, `${treatment} fill keeps text contrast`);
  }
  assert.match(panelSurfaceStyle("outline", { colors: DARK }).border, new RegExp(DARK.primary));
  assert.match(panelSurfaceStyle("glass", { colors: DARK }).backdropFilter, /^blur\(18px\)$/);
  assert.notEqual(panelSurfaceStyle("soft-shadow", { colors: DARK }).boxShadow, panelSurfaceStyle("soft-shadow", { colors: LIGHT }).boxShadow, "shadows follow the theme");
});

test("catalogue G cards take the story panel; without one the card is unchanged", () => {
  const scene = { id: "card", module: "icon-row", start: 0, end: 4, params: { surface: "card", items: [{ icon: "rocket", label: "Ship" }, { icon: "chart-up", label: "Grow" }] } };
  const plain = story({ scenes: [scene] });
  const model = resolveModule(scene, resolveStory(plain));
  assert.equal(model.panel, undefined);
  const before = cardSurface(model);
  assert.match(JSON.stringify(before), /#00000073/);
  for (const treatment of PANEL_TREATMENTS) {
    const styled = resolveModule(scene, resolveStory(story({ scenes: [scene], panel: { treatment, radius: 8 } })));
    assert.deepEqual(styled.panel, { treatment, radius: 8 });
    const surface = cardSurface(styled);
    assert.equal(surface.style.borderRadius, Math.round(8 * styled.unit * 100) / 100, treatment);
  }
});

test("the gate flags captions and panels that lose contrast on the background", () => {
  // Grey captions without an outline on a light background.
  const s = story({ background: { kind: "mesh", params: { intensity: 1 } }, overlays: [{ type: "captions", preset: "minimal-line", colors: { idle: "#bbbbbb" } }] }, LIGHT);
  const captions = captionOptions(s.overlays[0], { brand: s.brand, format: s.format, story: s });
  const findings = backgroundContrastFindings(s, { captions });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, "background-contrast");
  assert.match(findings[0].detail, /caption words \(#bbbbbb, preset minimal-line\)/);
  // An outlined preset is backed, so it passes.
  const outlined = captionOptions({ type: "captions", preset: "outline-heavy", colors: { idle: "#bbbbbb" } }, { brand: s.brand, format: s.format, story: s });
  assert.deepEqual(backgroundContrastFindings(s, { captions: outlined }), []);
  // Brand-colour captions in paper pass on every kind.
  for (const kind of BACKGROUND_KINDS) {
    const t = story({ background: { kind } }, LIGHT);
    assert.deepEqual(backgroundContrastFindings(t, { captions: captionOptions({ type: "captions", preset: "minimal-line" }, { brand: t.brand, format: t.format, story: t }) }), [], kind);
  }
});

test("the HyperFrames compiler draws background layers in place of the blobs, and nothing changes without one", async () => {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  const plain = await compileStoryToHyperFrames(resolveStory(base, { words }), { write: false, sourceDir: MINIMAL });
  assert.match(plain.html, /class="lc-ambient-blob"/);
  assert.doesNotMatch(plain.html, /lc-bg-layer/);
  const blobs = await compileStoryToHyperFrames(resolveStory({ ...base, background: { kind: "blobs" } }, { words }), { write: false, sourceDir: MINIMAL });
  assert.equal(blobs.html, plain.html, "an explicit blobs background is today's render");
  for (const kind of BACKGROUND_KINDS.filter((name) => name !== "blobs")) {
    const { html } = await compileStoryToHyperFrames(resolveStory({ ...base, background: { kind } }, { words }), { write: false, sourceDir: MINIMAL });
    assert.doesNotMatch(html, /class="lc-ambient-blob"/, kind);
    assert.match(html, new RegExp(`data-launchclip-background="${kind}"`), kind);
    if (kind !== "flat") assert.match(html, /class="lc-bg-layer"/, kind);
  }
});

test("the Remotion story draws the same plan", async () => {
  const source = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.match(source, /backgroundPlan\(story\)/);
  assert.match(source, /sceneBackground\(story, scene\)/);
  assert.match(source, /backgroundLayerStyle\(layer, t\)/);
});
