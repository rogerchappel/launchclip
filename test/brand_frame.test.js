// The brand frame (kit/core/brand-frame.mjs, docs/VIDEO_QUALITY_RFC.md §9.2):
// the plan both renderers draw, its safe area for modules, the compilers'
// wiring and the layout-check warning. Rendered parity is in
// test/fixtures/parity-footage/f-frame-*.json (LAUNCHCLIP_PARITY=1).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

import { brandFrameLayout, brandFramePlan, brandFrameRuntime, brandFrameSafe, frameLabels, frameWindows, intersectRects, storyFrame } from "../kit/core/brand-frame.mjs";
import { captionStateAt, indexCaptionTweens } from "../kit/core/captions.mjs";
import { profileGeometry } from "../kit/core/layout-check.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { resolveStory } from "../kit/core/story.mjs";
import { compileStoryToHyperFrames } from "../kit/hyperframes/story-compiler.mjs";
import { brandFrameFindings } from "../src/layout_check.js";

const require = createRequire(import.meta.url);
const { gsap } = require("gsap");
const ROOT = path.resolve(import.meta.dirname, "..");
const MINIMAL = path.join(ROOT, "examples", "story", "minimal");

const story = (frame, overrides = {}) => ({
  title: "Inside Ship Mode",
  format: { width: 1920, height: 1080, duration: 12 },
  resolved: { duration: 12, fps: 30 },
  brand: { colors: { bg: "#101010", paper: "#fafafa", primary: "#ffcc00", accent: "#33ccff" }, fonts: {} },
  scenes: [{ id: "a", start: 0, end: 4 }, { id: "b", start: 4, end: 8 }, { id: "c", start: 9, end: 12 }],
  frame,
  ...overrides
});

test("storyFrame: defaults, the short title as kicker, and off switches", () => {
  assert.equal(storyFrame(story(undefined)), null);
  assert.equal(storyFrame(story(false)), null);
  assert.equal(storyFrame(story({ enabled: false })), null);
  const frame = storyFrame(story({}));
  assert.equal(frame.kicker.label, "Inside Ship Mode", "a short title becomes the kicker");
  assert.equal(frame.kicker.position, "top-left");
  assert.equal(frame.sections.position, "top-right");
  assert.equal(frame.progress, null, "no progress line unless asked");
  assert.equal(storyFrame(story({}, { title: "A very long story title that will not fit in a kicker" })).kicker, null, "a long title is not a kicker");
  assert.equal(storyFrame(story({ kicker: { position: "top-right" } })).sections.position, "top-left", "labels take the other corner");
  assert.equal(storyFrame(story({ kicker: false, progress: true })).kicker, null);
});

test("section labels and show windows follow the story's scenes", () => {
  const frame = { labels: [{ scene: "b", label: "How" }, { start: 0, label: "Why" }, { scene: "missing", label: "Gone" }] };
  assert.deepEqual(frameLabels(story(frame)), [{ start: 0, label: "Why", end: 4 }, { start: 4, label: "How", end: 12 }]);
  assert.deepEqual(frameLabels(story({ ...frame, sections: false })), []);
  assert.deepEqual(frameWindows(story({})), [[0, 12]]);
  assert.deepEqual(frameWindows(story({ show: "scenes" })), [[0, 8], [9, 12]]);
});

test("the safe area leaves the kicker band and the progress line, inside the profile safe zone", () => {
  for (const format of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    const zone = profileGeometry(format).safeZone;
    const s = story({ progress: true, labels: [{ start: 0, label: "Why" }] }, { format: { ...format, duration: 12 } });
    const layout = brandFrameLayout(s, format);
    const safe = brandFrameSafe(s, format);
    assert.deepEqual(safe, layout.safe);
    assert.ok(safe.y >= zone.y + 70 && safe.x === zone.x && safe.width === zone.width, JSON.stringify(safe));
    assert.ok(safe.y + safe.height <= zone.y + zone.height + 1e-6);
    for (const region of layout.regions) assert.equal(intersectRects(region.rect, safe).height, 0, `${region.id} is outside the safe area`);
    const bottom = brandFrameSafe(story({ kicker: { position: "bottom-left" }, sections: false }, { format: { ...format, duration: 12 } }), format);
    assert.equal(bottom.y, zone.y, "a bottom kicker leaves the top free");
    assert.ok(bottom.y + bottom.height < zone.y + zone.height);
  }
  assert.equal(brandFrameSafe(story(undefined)), null);
  assert.deepEqual(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), { x: 5, y: 5, width: 5, height: 5 });
  assert.deepEqual(intersectRects(null, { x: 1, y: 1, width: 1, height: 1 }), { x: 1, y: 1, width: 1, height: 1 });
});

test("modules receive the frame's safe area as model.frame.safe only when the story has a frame", async () => {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  const plain = resolveStory(base, { words });
  assert.equal(resolveModule(plain.scenes[0], plain).frame, undefined);
  const framed = resolveStory({ ...base, frame: { kicker: { label: "Minimal" } } }, { words });
  assert.deepEqual(resolveModule(framed.scenes[0], framed).frame, { safe: brandFrameSafe(framed) });
});

const PLANS = [
  story({ progress: true, logo: "assets/logo.svg", labels: [{ start: 0, label: "Why" }, { scene: "b", label: "How" }, { scene: "c", label: "Try it" }] }),
  story({ show: "scenes", kicker: { position: "top-right", underline: false }, progress: { position: "top", thickness: 8, color: "accent" }, labels: [{ scene: "c", label: "End" }] })
];

test("the plan is seek-safe: unique ids, known targets, one immediate render, `to` after a prior tween", () => {
  for (const s of PLANS) {
    const plan = brandFramePlan(s);
    const ids = [];
    const walk = (node) => { ids.push(node.id); (node.children ?? []).forEach(walk); };
    plan.nodes.forEach(walk);
    assert.equal(new Set(ids).size, ids.length);
    const seen = new Set();
    for (const tween of [...plan.tweens].sort((a, b) => a.at - b.at)) {
      assert.ok(ids.includes(tween.id), tween.id);
      for (const prop of Object.keys(tween.to)) {
        const key = `${tween.id}.${prop}`;
        if (tween.ir) assert.ok(!seen.has(key), `${key} renders immediately after an earlier tween`);
        if (!tween.from) assert.ok(seen.has(key), `${key} is a to() without a prior tween`);
        seen.add(key);
      }
    }
    assert.doesNotMatch(brandFrameRuntime(plan), /autoAlpha|visibility|onUpdate|\.call\(|Math\.random|Date\.now/);
  }
  assert.ok(brandFramePlan(PLANS[0]).nodes[0].children[0].children[0].children.some((node) => node.tag === "img" && node.src === "assets/logo.svg"));
  assert.match(brandFramePlan(PLANS[1]).css, /\.lc-frame-progress \{[^}]*top: 0; height: 8px/);
});

test("the frame-pure evaluator (Remotion) matches a real GSAP timeline seeked to every frame", () => {
  for (const s of PLANS) {
    const plan = brandFramePlan(s);
    const targets = new Map();
    const target = (id) => { if (!targets.has(id)) targets.set(id, {}); return targets.get(id); };
    const seed = { opacity: 0, y: 0, scaleX: 0 };
    for (const tween of plan.tweens) for (const key of Object.keys(tween.to)) if (!(key in target(tween.id))) target(tween.id)[key] = seed[key];
    const tl = gsap.timeline({ paused: true });
    for (const tween of plan.tweens) {
      const vars = { ...tween.to, duration: tween.dur, ease: tween.ease };
      if (tween.from) { if (!tween.ir) vars.immediateRender = false; tl.fromTo(target(tween.id), { ...tween.from }, vars, tween.at); }
      else tl.to(target(tween.id), vars, tween.at);
    }
    const index = indexCaptionTweens(plan.tweens);
    let worst = 0;
    for (let frame = 0; frame <= 12 * 30; frame += 1) {
      const t = frame / 30;
      tl.seek(t, false);
      for (const [id, values] of captionStateAt(plan, t, index)) for (const [key, value] of Object.entries(values)) worst = Math.max(worst, Math.abs(value - targets.get(id)[key]) / (key === "y" ? 50 : 1));
    }
    tl.kill();
    assert.ok(worst < 0.002, `evaluator differs from GSAP by ${worst}`);
  }
});

test("the HyperFrames compiler mounts the frame under the captions, and the Remotion story draws the same plan", async () => {
  const base = JSON.parse(await readFile(path.join(MINIMAL, "storyboard.json"), "utf8"));
  const words = JSON.parse(await readFile(path.join(MINIMAL, "NARRATION.json"), "utf8")).words;
  const plain = await compileStoryToHyperFrames(resolveStory(base, { words }), { write: false, sourceDir: MINIMAL });
  assert.doesNotMatch(plain.html, /lc-frame/, "no frame, no frame markup");
  const framed = await compileStoryToHyperFrames(resolveStory({ ...base, frame: { kicker: { label: "Minimal" }, progress: true } }, { words }), { write: false, sourceDir: MINIMAL });
  assert.match(framed.html, /<div id="lc-frame-root" aria-hidden="true"><\/div>/);
  assert.match(framed.html, /window\.mountBrandFrame\(tl, document\.getElementById\("lc-frame-root"\)\);/);
  assert.match(framed.html, /#lc-frame-root \{[^}]*z-index: 90000; \}/);
  assert.ok(framed.html.indexOf("lc-frame-root") < framed.html.indexOf('id="lc-captions"'), "the frame sits under the captions");
  const isolated = await compileStoryToHyperFrames(resolveStory({ ...base, frame: { kicker: { label: "Minimal" } } }, { words }), { write: false, sourceDir: MINIMAL, sceneFilter: base.scenes[0].id });
  assert.doesNotMatch(isolated.html, /lc-frame-root/, "a module review has no frame");
  const component = await readFile(path.join(ROOT, "kit", "remotion", "frame", "BrandFrame.tsx"), "utf8");
  assert.match(component, /brandFramePlan\(story/);
  assert.match(component, /captionElementStateAt\(index, node\.id, t\)/);
  const composition = await readFile(path.join(ROOT, "kit", "remotion", "StoryComposition.tsx"), "utf8");
  assert.equal(composition.match(/<BrandFrame story=\{story\} \/>\s*\n\s*\{overlay && Array\.isArray\(__captions\)/g)?.length, 2, "both story layouts draw the frame just before the captions");
});

test("layout-check warns when key text overlaps the frame", () => {
  const s = story({ labels: [{ start: 0, label: "Why" }] });
  const layout = brandFrameLayout(s);
  const kicker = layout.regions[0].rect;
  const findings = brandFrameFindings(s, [
    { id: "headline", role: "text", rect: { x: kicker.x + 10, y: kicker.y + 10, width: 400, height: 120 }, start: 1, end: 3 },
    { id: "photo", role: "media", rect: { x: 0, y: 0, width: 1920, height: 1080 }, start: 0, end: 12 },
    { id: "body", role: "text", rect: { ...layout.safe }, start: 0, end: 12 }
  ], { width: 1920, height: 1080 });
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.severity, finding.ids]), [["brand-frame", "warning", ["headline", "frame-kicker"]]]);
  assert.deepEqual(brandFrameFindings(story(undefined), [{ id: "x", role: "text", rect: { x: 0, y: 0, width: 1920, height: 1080 } }], { width: 1920, height: 1080 }), []);
});

test("inside a footage layout panel, model.frame.safe is the panel safe area narrowed by the frame", async () => {
  const { readProjectStory } = await import("../src/story_loader.js");
  const { layoutAt } = await import("../kit/core/footage-layout.mjs");
  const { resolved } = await readProjectStory(path.join(ROOT, "examples/story/layouts-wide"));
  const framed = { ...resolved, frame: { kicker: { label: "Layouts" } } };
  const scene = framed.scenes.find((entry) => entry.id === "list");
  const panel = layoutAt(framed, Number(scene.start)).safe;
  assert.deepEqual(resolveModule(scene, framed).frame.safe, intersectRects(panel, brandFrameSafe(framed)));
  const outside = framed.scenes.find((entry) => !layoutAt(framed, Number(entry.start)));
  if (outside) assert.deepEqual(resolveModule(outside, framed).frame.safe, brandFrameSafe(framed), "no section: the frame's safe area alone");
});
